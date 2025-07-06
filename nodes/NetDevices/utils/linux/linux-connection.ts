import { BaseConnection, DeviceCredentials, CommandResult } from '../base-connection';

export class LinuxConnection extends BaseConnection {
    private shellPrompt: string = '';
    private rootUser: boolean = false;
    private initialPromptDetected: boolean = false;

    constructor(credentials: DeviceCredentials) {
        super(credentials);
    }

    protected async sessionPreparation(): Promise<void> {
        // Create shell channel
        await this.createLinuxShellChannel();
        
        // Wait for initial prompt detection
        await this.waitForInitialPrompt();
        
        if (this.fastMode) {
            // Fast mode: minimal setup
            await this.setBasePrompt();
        } else {
            // Standard mode: full setup
            await this.setBasePrompt();
            
            // Check if we're root user
            await this.checkRootUser();
            
            // Set shell options
            await this.setShellOptions();
        }
    }

    private async createLinuxShellChannel(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.client.shell((err, channel) => {
                if (err) {
                    reject(err);
                    return;
                }

                this.currentChannel = channel;
                this.currentChannel.setEncoding(this.encoding);
                
                // Set up data listener for initial prompt detection
                let initialBuffer = '';
                const initialPromptTimeout = this.fastMode ? 5000 : 10000;
                
                const initialPromptTimer = setTimeout(() => {
                    if (!this.initialPromptDetected) {
                        // If no prompt detected, proceed anyway
                        this.initialPromptDetected = true;
                        resolve();
                    }
                }, initialPromptTimeout);

                const onInitialData = (data: string) => {
                    initialBuffer += data;
                    
                    // Check for various Linux prompt patterns
                    if (this.detectLinuxPrompt(initialBuffer)) {
                        this.initialPromptDetected = true;
                        clearTimeout(initialPromptTimer);
                        this.currentChannel.removeListener('data', onInitialData);
                        resolve();
                    }
                };

                this.currentChannel.on('data', onInitialData);
                
                // Also set a minimum wait time for channel setup
                const minWaitTime = this.fastMode ? 150 : 400;
                setTimeout(() => {
                    if (!this.initialPromptDetected) {
                        // Minimum wait completed, check if we have any data
                        if (initialBuffer.length > 0) {
                            this.initialPromptDetected = true;
                            clearTimeout(initialPromptTimer);
                            this.currentChannel.removeListener('data', onInitialData);
                            resolve();
                        }
                    }
                }, minWaitTime);
            });
        });
    }

    private async waitForInitialPrompt(): Promise<void> {
        if (this.initialPromptDetected) {
            return;
        }

        // Give additional time for prompt detection if needed
        return new Promise((resolve) => {
            const timeout = this.fastMode ? 2000 : 4000;
            setTimeout(() => {
                this.initialPromptDetected = true;
                resolve();
            }, timeout);
        });
    }

    private detectLinuxPrompt(buffer: string): boolean {
        // Common Linux prompt patterns
        const promptPatterns = [
            /\$\s*$/m,           // $ at end of line
            /#\s*$/m,           // # at end of line (root)
            />\s*$/m,           // > at end of line
            /\]\s*\$\s*$/m,     // ]$ pattern
            /\]\s*#\s*$/m,      // ]# pattern
            /~\s*\$\s*$/m,      // ~$ pattern
            /~\s*#\s*$/m,       // ~# pattern
            /@.*:\s*\$\s*$/m,   // user@host:$ pattern
            /@.*:\s*#\s*$/m,    // user@host:# pattern
            /@.*:\s*~\s*\$\s*$/m, // user@host:~$ pattern
            /@.*:\s*~\s*#\s*$/m,  // user@host:~# pattern
        ];

        return promptPatterns.some(pattern => pattern.test(buffer));
    }

    protected async setBasePrompt(): Promise<void> {
        try {
            // Send a return to get the current prompt
            await this.writeChannel(this.returnChar);
            const output = await this.readChannel(4000); // Increased timeout
            
            if (!output.trim()) {
                // If no output, try sending a newline
                await this.writeChannel(this.newline);
                const newOutput = await this.readChannel(3000);
                if (newOutput.trim()) {
                    this.extractPromptFromOutput(newOutput);
                } else {
                    // Fallback: set a generic prompt
                    this.setFallbackPrompt();
                }
            } else {
                this.extractPromptFromOutput(output);
            }
        } catch (error) {
            // If prompt detection fails, use fallback
            this.setFallbackPrompt();
        }
    }

    private extractPromptFromOutput(output: string): void {
        // Extract the base prompt from the output
        const lines = output.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        
        // Remove common prompt terminators to get base prompt
        this.basePrompt = lastLine.replace(/[>#$%]\s*$/, '').trim();
        this.shellPrompt = lastLine.trim();
        
        // Set enabled and config prompts (not applicable for Linux)
        this.enabledPrompt = this.basePrompt + '#';
        this.configPrompt = this.basePrompt + '#';
    }

    private setFallbackPrompt(): void {
        // Set generic fallback prompts
        this.basePrompt = 'linux';
        this.shellPrompt = 'linux$';
        this.enabledPrompt = 'linux#';
        this.configPrompt = 'linux#';
    }

    private async checkRootUser(): Promise<void> {
        try {
            const result = await this.sendCommand('whoami');
            if (result.success && result.output.includes('root')) {
                this.rootUser = true;
            }
        } catch (error) {
            // If whoami fails, assume non-root
            this.rootUser = false;
        }
    }

    private async setShellOptions(): Promise<void> {
        try {
            // Set shell to not exit on error (for command execution)
            await this.writeChannel('set +e' + this.newline);
            await this.readChannel(1000);
            
            // Set prompt for better parsing
            await this.writeChannel('export PS1="\\u@\\h:\\w\\$ "' + this.newline);
            await this.readChannel(1000);
        } catch (error) {
            // If this fails, it's not critical
        }
    }

    async sendCommand(command: string): Promise<CommandResult> {
        try {
            if (!this.isConnected || !this.currentChannel) {
                throw new Error('Not connected to device');
            }

            // Send the command
            await this.writeChannel(command + this.newline);
            
            // Use optimized timeout with better handling
            const timeout = this.fastMode ? 4000 : 8000;
            
            // Wait for response with appropriate timeout
            const output = await this.readUntilPromptEnhanced(timeout);
            
            // Clean up the output
            const cleanOutput = this.sanitizeOutput(output, command);

            return {
                command,
                output: cleanOutput,
                success: true
            };

        } catch (error) {
            return {
                command,
                output: '',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    private async readUntilPromptEnhanced(timeout: number = 8000): Promise<string> {
        return new Promise((resolve, reject) => {
            let buffer = '';
            let timeoutId: NodeJS.Timeout;
            
            // Enhanced prompt patterns for Linux
            const linuxPromptPatterns = [
                this.basePrompt,
                this.shellPrompt,
                /\$\s*$/,           // $ at end
                /#\s*$/,           // # at end
                />\s*$/,           // > at end
                /\]\s*\$\s*$/,     // ]$ pattern
                /\]\s*#\s*$/,      // ]# pattern
                /@.*:\s*\$\s*$/,   // user@host:$ pattern
                /@.*:\s*#\s*$/,    // user@host:# pattern
                /@.*:\s*~\s*\$\s*$/,  // user@host:~$ pattern
                /@.*:\s*~\s*#\s*$/,   // user@host:~# pattern
            ];

            const onData = (data: string) => {
                buffer += data;
                
                // Check for any prompt pattern match
                const hasPrompt = linuxPromptPatterns.some(pattern => {
                    if (typeof pattern === 'string') {
                        return buffer.includes(pattern);
                    } else {
                        return pattern.test(buffer);
                    }
                });
                
                if (hasPrompt) {
                    cleanup();
                    resolve(buffer);
                    return;
                }
                
                // Additional check for command completion indicators
                const lines = buffer.split('\n');
                const lastLine = lines[lines.length - 1];
                
                // Check if last line looks like a prompt
                if (lastLine.length > 0 && this.detectLinuxPrompt(lastLine)) {
                    cleanup();
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
                reject(new Error(`Timeout waiting for prompt after ${timeout}ms. Buffer: ${buffer.slice(-200)}`));
            }, timeout);

            if (this.currentChannel) {
                this.currentChannel.on('data', onData);
                this.currentChannel.on('error', onError);
            } else {
                cleanup();
                reject(new Error('No active channel available'));
            }
        });
    }

    async sendConfig(configCommands: string[]): Promise<CommandResult> {
        try {
            if (!this.isConnected || !this.currentChannel) {
                throw new Error('Not connected to device');
            }

            let allOutput = '';
            
            // Send each configuration command
            for (const command of configCommands) {
                await this.writeChannel(command + this.newline);
                const output = await this.readChannel(3000);
                allOutput += output;
                
                // Check for common error patterns
                if (output.includes('Permission denied') || 
                    output.includes('command not found') || 
                    output.includes('No such file or directory')) {
                    throw new Error(`Configuration error on command "${command}": ${output}`);
                }
            }
            
            // Clean up the output
            const cleanOutput = this.sanitizeOutput(allOutput, configCommands.join('; '));

            return {
                command: configCommands.join('; '),
                output: cleanOutput,
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
        // For Linux, we can show system configuration files
        return await this.sendCommand('cat /etc/os-release && echo "---" && uname -a');
    }

    async saveConfig(): Promise<CommandResult> {
        // For Linux, configuration is typically saved automatically
        return await this.sendCommand('sync && echo "Configuration synchronized"');
    }

    async rebootDevice(): Promise<CommandResult> {
        try {
            let command = 'reboot';
            
            // If not root, try with sudo
            if (!this.rootUser) {
                command = 'sudo reboot';
            }
            
            await this.writeChannel(command + this.newline);
            
            // Wait for any response
            const output = await this.readChannel(5000);
            
            return {
                command: command,
                output: output,
                success: true
            };
        } catch (error) {
            return {
                command: 'reboot',
                output: '',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    protected sanitizeOutput(output: string, command: string): string {
        // Escape special regex characters in the command
        const escapedCommand = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Remove the command echo
        let cleanOutput = output.replace(new RegExp(escapedCommand, 'g'), '');
        
        // Remove shell prompts
        const escapedShellPrompt = this.shellPrompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        cleanOutput = cleanOutput.replace(new RegExp(escapedShellPrompt, 'g'), '');
        
        // Remove common shell artifacts
        cleanOutput = cleanOutput.replace(/\[.*?\]/g, ''); // Remove ANSI sequences
        cleanOutput = cleanOutput.replace(/\$\s*$/gm, ''); // Remove trailing $
        cleanOutput = cleanOutput.replace(/#\s*$/gm, ''); // Remove trailing #
        
        // Remove extra whitespace and newlines
        cleanOutput = cleanOutput.replace(/^\s+|\s+$/g, '');
        cleanOutput = cleanOutput.replace(/\r\n/g, '\n');
        cleanOutput = cleanOutput.replace(/\r/g, '\n');
        cleanOutput = cleanOutput.replace(/\n\s*\n/g, '\n');
        
        return cleanOutput;
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