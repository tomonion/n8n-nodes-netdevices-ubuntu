import { BaseConnection } from '../base-connection';
import { DeviceCredentials, CommandResult } from '../index';

// Try to import n8n's LoggerProxy for proper logging
let Logger: any;
try {
    Logger = require('n8n-workflow').LoggerProxy;
} catch (error) {
    // Fallback to console if LoggerProxy is not available
    Logger = {
        debug: (...args: any[]) => console.log('[DEBUG]', ...args),
        info: (...args: any[]) => console.log('[INFO]', ...args),
        warn: (...args: any[]) => console.warn('[WARN]', ...args),
        error: (...args: any[]) => console.error('[ERROR]', ...args)
    };
}

export class LinuxConnection extends BaseConnection {
    private promptPattern: string = '[$#]';
    protected basePrompt: string = '';
    private rootUser: boolean = false;

    constructor(credentials: DeviceCredentials) {
        super(credentials);
    }

    protected async sessionPreparation(): Promise<void> {
        Logger.debug('Starting Linux session preparation', {
            host: this.credentials.host,
            fastMode: this.fastMode
        });

        try {
            // Create shell channel
            await this.createLinuxShellChannel();
            
            // Test channel read and find prompt (like Netmiko's _test_channel_read)
            await this.testChannelRead();
            
            // Set base prompt
            await this.setBasePrompt();
            
            Logger.debug('Linux session preparation completed successfully');

        } catch (error) {
            Logger.error('Linux session preparation failed', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    private async createLinuxShellChannel(): Promise<void> {
        return new Promise((resolve, reject) => {
            Logger.debug('Creating Linux shell channel');
            
            if (!this.client) {
                reject(new Error('SSH client not available'));
                return;
            }

            this.client.shell((err: Error | undefined, channel: any) => {
                if (err) {
                    Logger.error('Failed to create shell channel', { error: err.message });
                    reject(err);
                    return;
                }

                this.currentChannel = channel;
                Logger.debug('Shell channel created successfully');
                resolve();
            });
        });
    }

    private async testChannelRead(): Promise<void> {
        Logger.debug('Testing channel read to detect initial prompt');
        
        // Wait a bit for initial data
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Read initial data
        const initialData = await this.readChannel(2000).catch(() => '');
        Logger.debug('Initial channel data received', {
            dataLength: initialData.length,
            dataSample: initialData.slice(-100)
        });
    }

    protected async setBasePrompt(): Promise<void> {
        Logger.debug('Setting base prompt for Linux');
        
        try {
            // Send a simple command to get the current prompt
            await this.writeChannel(this.newline);
            const output = await this.readUntilPattern(this.promptPattern, 5000);
            
            // Extract the base prompt from the output
            const lines = output.trim().split('\n');
            const lastLine = lines[lines.length - 1];
            
            // Remove the prompt terminator to get base prompt
            this.basePrompt = lastLine.replace(/[$#]\s*$/, '').trim();
            
            Logger.debug('Base prompt set', {
                basePrompt: this.basePrompt,
                promptPattern: this.promptPattern
            });
            
        } catch (error) {
            Logger.warn('Failed to set base prompt, using fallback', {
                error: error instanceof Error ? error.message : String(error)
            });
            this.basePrompt = 'linux';
        }
    }

    async sendCommand(command: string): Promise<CommandResult> {
        try {
            if (!this.isConnected || !this.currentChannel) {
                throw new Error('Not connected to device');
            }

            Logger.debug('Sending Linux command', { command });

            // Phase 1: Send command and wait for command echo (like Netmiko's command_echo_read)
            await this.writeChannel(command + this.newline);
            
            const commandEcho = await this.readUntilPattern(this.escapeRegex(command), 10000);
            Logger.debug('Command echo received', {
                command,
                echoLength: commandEcho.length
            });

            // Phase 2: Read until prompt returns (like Netmiko's read_until_pattern for prompt)
            const promptOutput = await this.readUntilPattern(this.promptPattern, 10000);
            Logger.debug('Prompt output received', {
                command,
                outputLength: promptOutput.length
            });

            // Combine the outputs
            const fullOutput = commandEcho + promptOutput;
            
            // Clean up the output
            const cleanOutput = this.sanitizeOutput(fullOutput, command);

            return {
                command,
                output: cleanOutput,
                success: true
            };

        } catch (error) {
            Logger.error('Linux command execution failed', {
                command,
                error: error instanceof Error ? error.message : String(error)
            });
            
            return {
                command,
                output: '',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    private async readUntilPattern(pattern: string, timeout: number = 10000): Promise<string> {
        return new Promise((resolve, reject) => {
            let buffer = '';
            let timeoutId: NodeJS.Timeout;
            const loopDelay = 10; // 10ms like Netmiko

            const onData = (data: string) => {
                buffer += data;
                
                // Check if pattern is found (like Netmiko's re.search)
                const regex = new RegExp(pattern);
                if (regex.test(buffer)) {
                    cleanup();
                    Logger.debug('Pattern found', {
                        pattern,
                        bufferLength: buffer.length,
                        bufferSample: buffer.slice(-200)
                    });
                    resolve(buffer);
                    return;
                }
            };

            const onError = (error: Error) => {
                cleanup();
                reject(error);
            };

            const cleanup = () => {
                if (this.currentChannel) {
                    this.currentChannel.removeListener('data', onData);
                    this.currentChannel.removeListener('error', onError);
                }
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
            };

            timeoutId = setTimeout(() => {
                cleanup();
                const msg = `Pattern not detected: ${pattern} in output. Buffer: ${buffer.slice(-200)}`;
                Logger.error('Read until pattern timeout', {
                    pattern,
                    timeout,
                    bufferLength: buffer.length,
                    bufferSample: buffer.slice(-200)
                });
                reject(new Error(msg));
            }, timeout);

            if (this.currentChannel) {
                this.currentChannel.on('data', onData);
                this.currentChannel.on('error', onError);
                
                // Start the read loop with small delay (like Netmiko)
                const readLoop = () => {
                    if (timeoutId) {
                        setTimeout(readLoop, loopDelay);
                    }
                };
                readLoop();
            } else {
                cleanup();
                reject(new Error('No active channel available'));
            }
        });
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    protected sanitizeOutput(output: string, command: string): string {
        Logger.debug('Sanitizing Linux output', {
            command,
            originalLength: output.length
        });

        // Split into lines
        let lines = output.split(/\r?\n/);

        // Remove command echo line (first line that contains the command)
        const commandIndex = lines.findIndex(line => line.includes(command));
        if (commandIndex >= 0) {
            lines.splice(commandIndex, 1);
        }

        // Remove prompt lines (lines ending with $ or #)
        lines = lines.filter(line => {
            const trimmed = line.trim();
            return !trimmed.match(/[$#]\s*$/) || trimmed.length > 50; // Keep long lines even if they end with $/#
        });

        // Remove ANSI escape sequences
        lines = lines.map(line => 
            line.replace(/\x1b\[[0-9;]*[mK]/g, '')
                .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
                .replace(/\[?\?2004[lh]/g, '')
        );

        // Remove empty lines at start and end
        while (lines.length > 0 && lines[0].trim() === '') {
            lines.shift();
        }
        while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
            lines.pop();
        }

        const cleanOutput = lines.join('\n').trim();
        
        Logger.debug('Output sanitized', {
            command,
            cleanLength: cleanOutput.length,
            originalLines: output.split(/\r?\n/).length,
            cleanLines: lines.length
        });

        return cleanOutput;
    }

    async sendConfig(configCommands: string[]): Promise<CommandResult> {
        try {
            let allOutput = '';
            
            for (const command of configCommands) {
                const result = await this.sendCommand(command);
                if (!result.success) {
                    throw new Error(`Command failed: ${command} - ${result.error}`);
                }
                allOutput += result.output + '\n';
            }

            return {
                command: configCommands.join('; '),
                output: allOutput.trim(),
                success: true
            };

        } catch (error) {
            return {
                command: configCommands.join('; '),
                output: '',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    async getCurrentConfig(): Promise<CommandResult> {
        return await this.sendCommand('cat /etc/os-release && echo "---" && uname -a');
    }

    async saveConfig(): Promise<CommandResult> {
        return await this.sendCommand('sync && echo "Configuration synchronized"');
    }

    async rebootDevice(): Promise<CommandResult> {
        const command = this.rootUser ? 'reboot' : 'sudo reboot';
        return await this.sendCommand(command);
    }

    // Linux-specific utility methods
    isRootUser(): boolean {
        return this.rootUser;
    }

    async executeAsRoot(command: string): Promise<CommandResult> {
        if (this.rootUser) {
            return await this.sendCommand(command);
        } else {
            return await this.sendCommand('sudo ' + command);
        }
    }

    async getSystemInfo(): Promise<CommandResult> {
        return await this.sendCommand('uname -a && cat /etc/os-release');
    }

    async getProcessList(): Promise<CommandResult> {
        return await this.sendCommand('ps aux');
    }

    async getDiskUsage(): Promise<CommandResult> {
        return await this.sendCommand('df -h');
    }

    async getMemoryInfo(): Promise<CommandResult> {
        return await this.sendCommand('free -h');
    }

    async getNetworkInterfaces(): Promise<CommandResult> {
        return await this.sendCommand('ip addr show');
    }

    async getServiceStatus(serviceName: string): Promise<CommandResult> {
        return await this.sendCommand(`systemctl status ${serviceName}`);
    }

    async startService(serviceName: string): Promise<CommandResult> {
        return await this.executeAsRoot(`systemctl start ${serviceName}`);
    }

    async stopService(serviceName: string): Promise<CommandResult> {
        return await this.executeAsRoot(`systemctl stop ${serviceName}`);
    }

    async restartService(serviceName: string): Promise<CommandResult> {
        return await this.executeAsRoot(`systemctl restart ${serviceName}`);
    }
} 