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
    protected basePrompt: string = '';
    private rootUser: boolean = false;

    constructor(credentials: DeviceCredentials) {
        super(credentials);
    }

    public async sessionPreparation(): Promise<void> {
        Logger.debug('Starting Linux session preparation', {
            host: this.credentials.host,
            fastMode: this.fastMode
        });

        try {
            // Create shell channel
            await this.createLinuxShellChannel();

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
                // Add a small delay to allow the banner to be received
                setTimeout(() => {
                    Logger.debug('Shell channel created successfully');
                    resolve();
                }, 2000);
            });
        });
    }

    private stripAnsi(str: string): string {
        // ANSI escape codes can interfere with prompt detection.
        // This regex strips them from the output.
        return str.replace(/[\u001b\u009b][[()#;?]*.{0,2}(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
    }

    protected async setBasePrompt(): Promise<void> {
        Logger.debug('Setting base prompt using Netmiko-style pattern matching.');
        
        // Send a newline to ensure a prompt is available
        await this.writeChannel(this.newline);
        
        // Use a generic regex to find any common Linux prompt
        const linuxPromptRegex = '[#$>]\\s*$';
        let output = '';
        try {
            output = await this.readUntilPattern(linuxPromptRegex, 5000, true);
        } catch(e) {
             Logger.warn('Could not find prompt with initial method. Trying a second time.');
             // Clear buffer before trying again
             await this.readChannel(100).catch(()=>{});
             await this.writeChannel(this.newline);
             output = await this.readUntilPattern(linuxPromptRegex, 5000, true);
        }

        const cleanOutput = this.stripAnsi(output);
        const lines = cleanOutput.trim().split('\n');
        const newPrompt = lines[lines.length - 1].trim();

        if (newPrompt) {
            this.basePrompt = newPrompt;
            Logger.info('Determined base prompt', { basePrompt: this.basePrompt });
        } else {
            // Final fallback if all methods fail
            Logger.error('All prompt detection methods failed. Using a generic regex as a last resort.');
            this.basePrompt = linuxPromptRegex;
        }

        // Disable paging after finding prompt
        await this.disablePaging();
    }

    async sendCommand(command: string): Promise<CommandResult> {
        return new Promise((resolve, reject) => {
            if (!this.isConnected || !this.client) {
                const err = new Error('Not connected to device');
                Logger.error('sendCommand: ' + err.message);
                return reject(err);
            }

            Logger.debug('Executing Linux command via client.exec()', { command });

            let output = '';
            let errorOutput = '';
            let streamClosed = false;
            let timeoutId: NodeJS.Timeout;

            const cleanup = () => {
                if (timeoutId) clearTimeout(timeoutId);
            };

            this.client.exec(command, (err, stream) => {
                if (err) {
                    Logger.error('sendCommand: Failed to execute command', { command, error: err.message });
                    cleanup();
                    return reject(err);
                }

                timeoutId = setTimeout(() => {
                    const msg = `sendCommand: Command timeout after ${this.commandTimeout}ms`;
                    Logger.error(msg, { command });
                    cleanup();
                    stream.close(); // Close the stream on timeout
                    reject(new Error(msg));
                }, this.commandTimeout);

                stream.on('data', (data: Buffer) => {
                    const chunk = data.toString('utf8');
                    output += chunk;
                    Logger.debug('sendCommand: stdout data received', { command, length: chunk.length });
                });

                stream.stderr.on('data', (data: Buffer) => {
                    const chunk = data.toString('utf8');
                    errorOutput += chunk;
                    Logger.warn('sendCommand: stderr data received', { command, length: chunk.length });
                });

                stream.on('close', (code: number, signal: string) => {
                    if (streamClosed) return;
                    streamClosed = true;

                    Logger.debug('sendCommand: stream closed', { command, code, signal });
                    cleanup();

                    if (errorOutput && !output) {
                         // If there's only stderr, treat it as an error
                        resolve({
                            command,
                            output: this.stripAnsi(errorOutput).trim(),
                            success: false,
                            error: `Command failed with exit code ${code || 'N/A'}`
                        });
                    } else {
                        // Otherwise, return stdout (and stderr if present)
                        const fullOutput = errorOutput ? `${output}\n--- STDERR ---\n${errorOutput}` : output;
                        resolve({
                            command,
                            output: this.stripAnsi(fullOutput).trim(),
                            success: code === 0,
                            error: code !== 0 ? `Command failed with exit code ${code || 'N/A'}` : undefined
                        });
                    }
                });

                stream.on('error', (streamErr: Error) => {
                     Logger.error('sendCommand: stream error', { command, error: streamErr.message });
                     cleanup();
                     reject(streamErr);
                });
            });
        });
    }

    private async readUntilPattern(pattern: string, timeout: number = 10000, isRegex: boolean = false): Promise<string> {
        let buffer = '';
        
        // If the pattern is not a regex, we still use regex but escape the pattern
        const promptRegex = isRegex ? new RegExp(pattern) : new RegExp(this.escapeRegex(pattern));

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                cleanup();
                const msg = `Timeout waiting for pattern: ${pattern}. Last buffer content: ${buffer.slice(-1000)}`;
                Logger.error('Read until pattern timeout', {
                    pattern,
                    timeout,
                    bufferLength: buffer.length,
                    bufferSample: buffer.slice(-1000),
                });
                reject(new Error(msg));
            }, timeout);

            const onData = (data: Buffer) => {
                const chunk = data.toString('utf8');
                buffer += chunk;
                Logger.debug('readUntilPattern: data received', { length: chunk.length, totalBuffer: buffer.length });
                // Check for the prompt pattern. A small delay can help stabilize reading on busy channels.
                setTimeout(() => {
                    if (this.currentChannel && promptRegex.test(buffer)) {
                        Logger.debug('readUntilPattern: prompt found', { pattern });
                        cleanup();
                        resolve(buffer);
                    }
                }, 50);
            };

            const onError = (err: Error) => {
                Logger.error('readUntilPattern: onError event', {
                    error: err.message,
                    stack: err.stack,
                    isChannel: !!this.currentChannel,
                    isReadable: this.currentChannel ? this.currentChannel.readable : false,
                    isWritable: this.currentChannel ? this.currentChannel.writable : false,
                    isDestroyed: this.currentChannel ? this.currentChannel.destroyed : false,
                });
                cleanup();
                reject(err);
            };

            const onClose = () => {
                Logger.warn('readUntilPattern: onClose event. Channel is closing.', {
                    isChannel: !!this.currentChannel,
                    isReadable: this.currentChannel ? this.currentChannel.readable : false,
                    isWritable: this.currentChannel ? this.currentChannel.writable : false,
                    isDestroyed: this.currentChannel ? this.currentChannel.destroyed : false,
                    bufferLength: buffer.length,
                    bufferSample: buffer.slice(-200),
                });
                cleanup();
                // We check the buffer here one last time. It's possible data arrived right before the close event.
                if (promptRegex.test(buffer)) {
                    Logger.debug('readUntilPattern: prompt found in buffer after onClose event.');
                    resolve(buffer);
                } else {
                    reject(new Error('Channel closed while waiting for pattern.'));
                }
            };

            const cleanup = () => {
                clearTimeout(timeoutId);
                if (this.currentChannel) {
                    this.currentChannel.removeListener('data', onData);
                    this.currentChannel.removeListener('error', onError);
                    this.currentChannel.removeListener('close', onClose);
                }
            };

            if (this.currentChannel) {
                this.currentChannel.on('data', onData);
                this.currentChannel.on('error', onError);
                this.currentChannel.on('close', onClose);
                Logger.debug('readUntilPattern: Listeners attached.');
            } else {
                cleanup();
                reject(new Error('No active channel available for reading.'));
            }
        });
    }

    protected async readChannel(timeout: number = 2000): Promise<string> {
        return new Promise((resolve, reject) => {
            let buffer = '';
            let timeoutId: NodeJS.Timeout;

            const onData = (data: Buffer) => {
                buffer += data.toString('utf8');
            };

            const cleanup = () => {
                if(this.currentChannel) {
                    this.currentChannel.removeListener('data', onData);
                }
                clearTimeout(timeoutId);
            };

            timeoutId = setTimeout(() => {
                cleanup();
                resolve(buffer);
            }, timeout);

            if (this.currentChannel) {
                this.currentChannel.on('data', onData);
            } else {
                reject(new Error('No active channel to read from.'));
            }
        });
    }

    protected escapeRegex(str: string): string {
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
        if (commandIndex !== -1) {
            lines.splice(commandIndex, 1);
        }

        // Remove prompt line (last line)
        if (lines.length > 0) {
            const lastLine = lines[lines.length - 1];
            
            // The prompt might be a regex, so test it appropriately
            const promptPattern = new RegExp(this.basePrompt);
            const promptFound = promptPattern.test(lastLine);

            if (promptFound) {
                lines.pop();
            }
        }

        // Re-join and trim
        return lines.join('\n').trim();
    }
    
    /**
     * Disables terminal paging to prevent command output from being paused.
     * This is equivalent to 'terminal length 0' or similar commands.
     * For Linux, we try to set an unlimited history and disable pagination.
     */
    protected async disablePaging(): Promise<void> {
        Logger.debug('Disabling terminal paging for Linux');
        
        // These commands might not work on all systems, but are common.
        const commands = [
            'stty -echo', // Disable echo
            'stty cols 512', // Set a large column width
            'export HISTSIZE=0', // Disable history limit
            'export HISTFILESIZE=0', // Disable history file limit
        ];

        for (const cmd of commands) {
            await this.writeChannel(cmd + this.newline);
            await new Promise(resolve => setTimeout(resolve, 150)); // Small delay
        }
        
        // Clear buffer after setting these
        await this.readChannel(500);
        
        Logger.debug('Terminal paging disabled.');
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