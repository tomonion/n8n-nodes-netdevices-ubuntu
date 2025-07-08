import { BaseConnection, DeviceCredentials, CommandResult } from '../base-connection';
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
    private shellPrompt: string = '';
    private rootUser: boolean = false;
    private initialPromptDetected: boolean = false;

    constructor(credentials: DeviceCredentials) {
        super(credentials);
    }

    protected async sessionPreparation(): Promise<void> {
        Logger.debug('Starting Linux session preparation', {
            host: this.credentials.host,
            fastMode: this.fastMode
        });

        try {
            // Create shell channel with timeout
            await this.createLinuxShellChannel();
            
            // Wait for initial prompt detection with shorter timeout
            await this.waitForInitialPrompt();
            
            if (this.fastMode) {
                // Fast mode: minimal setup with aggressive timeouts
                Logger.debug('Fast mode: performing minimal session setup');
                await this.setBasePromptFast();
            } else {
                // Standard mode: full setup with optimized timeouts
                Logger.debug('Standard mode: performing full session setup');
                await this.setBasePrompt();
                
                // Check if we're root user (non-blocking)
                this.checkRootUser().catch(() => {
                    Logger.debug('Root user check failed, assuming non-root');
                    this.rootUser = false;
                });
                
                // Set shell options (non-blocking)
                this.setShellOptions().catch(() => {
                    Logger.debug('Shell options setup failed, continuing anyway');
                });
            }
            
            Logger.debug('Linux session preparation completed successfully');
        } catch (error) {
            Logger.error('Linux session preparation failed', {
                error: error instanceof Error ? error.message : String(error),
                host: this.credentials.host
            });
            throw error;
        }
    }

    private async createLinuxShellChannel(): Promise<void> {
        return new Promise((resolve, reject) => {
            const channelTimeout = this.fastMode ? 3000 : 5000;
            
            Logger.debug('Creating Linux shell channel', {
                timeout: channelTimeout,
                fastMode: this.fastMode
            });

            const timeoutId = setTimeout(() => {
                Logger.error('Shell channel creation timeout', {
                    timeout: channelTimeout,
                    host: this.credentials.host
                });
                reject(new Error(`Shell channel creation timeout after ${channelTimeout}ms`));
            }, channelTimeout);

            this.client.shell((err, channel) => {
                clearTimeout(timeoutId);
                
                if (err) {
                    Logger.error('Failed to create shell channel', {
                        error: err.message,
                        host: this.credentials.host
                    });
                    reject(err);
                    return;
                }

                this.currentChannel = channel;
                this.currentChannel.setEncoding(this.encoding);
                
                Logger.debug('Shell channel created successfully');
                
                // Set up data listener for initial prompt detection
                let initialBuffer = '';
                const initialPromptTimeout = this.fastMode ? 2000 : 4000;
                
                const initialPromptTimer = setTimeout(() => {
                    if (!this.initialPromptDetected) {
                        Logger.debug('Initial prompt timeout, proceeding anyway', {
                            bufferLength: initialBuffer.length,
                            bufferSample: initialBuffer.slice(-100)
                        });
                        this.initialPromptDetected = true;
                        this.currentChannel.removeListener('data', onInitialData);
                        resolve();
                    }
                }, initialPromptTimeout);

                const onInitialData = (data: string) => {
                    initialBuffer += data;
                    
                    Logger.debug('Received initial data', {
                        dataLength: data.length,
                        totalBufferLength: initialBuffer.length,
                        dataSample: data.slice(-50)
                    });
                    
                    // Check for various Linux prompt patterns
                    if (this.detectLinuxPrompt(initialBuffer)) {
                        Logger.debug('Linux prompt detected in initial data');
                        this.initialPromptDetected = true;
                        clearTimeout(initialPromptTimer);
                        this.currentChannel.removeListener('data', onInitialData);
                        resolve();
                    }
                };

                this.currentChannel.on('data', onInitialData);
                
                // Also set a minimum wait time for channel setup
                const minWaitTime = this.fastMode ? 100 : 200;
                setTimeout(() => {
                    if (!this.initialPromptDetected && initialBuffer.length > 0) {
                        Logger.debug('Minimum wait completed with data, proceeding', {
                            bufferLength: initialBuffer.length
                        });
                        this.initialPromptDetected = true;
                        clearTimeout(initialPromptTimer);
                        this.currentChannel.removeListener('data', onInitialData);
                        resolve();
                    }
                }, minWaitTime);
            });
        });
    }

    private async waitForInitialPrompt(): Promise<void> {
        if (this.initialPromptDetected) {
            Logger.debug('Initial prompt already detected');
            return;
        }

        // Give minimal additional time for prompt detection
        const waitTime = this.fastMode ? 500 : 1000;
        
        Logger.debug('Waiting for initial prompt', { waitTime });
        
        return new Promise((resolve) => {
            setTimeout(() => {
                Logger.debug('Initial prompt wait completed');
                this.initialPromptDetected = true;
                resolve();
            }, waitTime);
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
            Logger.debug('Setting shell options for clean command execution');
            
            // Set shell to not exit on error (for command execution)
            await this.writeChannel('set +e' + this.newline);
            await this.readChannel(1000);
            
            // Set a clean, consistent prompt for better parsing
            await this.writeChannel('export PS1="\\u@\\h:\\w\\$ "' + this.newline);
            await this.readChannel(1000);
            
            // Clear any remaining output from setup commands
            await this.writeChannel('clear' + this.newline);
            await this.readChannel(1000);
            
            // Send a final newline to ensure we're at a clean prompt
            await this.writeChannel(this.newline);
            const finalOutput = await this.readChannel(1000);
            
            Logger.debug('Shell options set successfully', {
                finalOutputLength: finalOutput.length,
                finalOutputSample: finalOutput.slice(-50)
            });
            
        } catch (error) {
            Logger.debug('Failed to set shell options, continuing anyway', {
                error: error instanceof Error ? error.message : String(error)
            });
            // If this fails, it's not critical - continue with default shell
        }
    }

    async sendCommand(command: string): Promise<CommandResult> {
        try {
            if (!this.isConnected || !this.currentChannel) {
                throw new Error('Not connected to device');
            }

            Logger.debug('Sending command', { command, fastMode: this.fastMode });

            // Clear any pending data in the channel first
            await this.readChannel(100).catch(() => {}); // Drain any pending data
            
            // Send the command
            await this.writeChannel(command + this.newline);
            
            // Add a longer delay to ensure command starts executing
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // Use optimized timeout with better handling
            const timeout = this.fastMode ? 6000 : 12000; // Increased timeout
            
            Logger.debug('Waiting for command output', { command, timeout });
            
            // Wait for response with appropriate timeout
            const output = await this.readUntilPromptEnhanced(timeout);
            
            Logger.debug('Command output received', {
                command,
                outputLength: output.length,
                outputSample: output.slice(0, 200)
            });
            
            // Clean up the output
            const cleanOutput = this.sanitizeOutput(output, command);
            
            Logger.debug('Command output cleaned', {
                command,
                cleanOutputLength: cleanOutput.length,
                cleanOutputSample: cleanOutput.slice(0, 200)
            });

            return {
                command,
                output: cleanOutput,
                success: true
            };

        } catch (error) {
            Logger.error('Command execution failed', {
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

    private async readUntilPromptEnhanced(timeout: number = 8000): Promise<string> {
        return new Promise((resolve, reject) => {
            let buffer = '';
            let timeoutId: NodeJS.Timeout;
            let commandExecutionStarted = false;
            let lastDataTime = Date.now();
            
            // More specific prompt patterns that indicate command completion
            const commandCompletePatterns = [
                /ubuntu@[^:]+:[^$#>]*[$#>]\s*$/,  // ubuntu@host:path$ pattern
                /root@[^:]+:[^$#>]*[$#>]\s*$/,    // root@host:path$ pattern
                /[^@]+@[^:]+:[^$#>]*[$#>]\s*$/,   // user@host:path$ pattern
                /\[[^\]]+\]\s*[$#>]\s*$/,        // [user@host] pattern
                /^\s*[$#>]\s*$/,                 // Simple prompt at start of line
            ];

            const onData = (data: string) => {
                buffer += data;
                lastDataTime = Date.now();
                
                Logger.debug('Received data chunk', {
                    dataLength: data.length,
                    bufferLength: buffer.length,
                    dataSample: data.slice(0, 100),
                    commandExecutionStarted
                });
                
                // Check if we've received some actual content (not just prompt echo)
                if (!commandExecutionStarted) {
                    // Look for signs that command execution has started
                    const lines = buffer.split('\n');
                    if (lines.length > 1 || buffer.length > 100) {
                        commandExecutionStarted = true;
                        Logger.debug('Command execution detected');
                    }
                }
                
                // Only check for completion if we've seen command execution start
                if (commandExecutionStarted) {
                    const lines = buffer.split('\n');
                    const lastLine = lines[lines.length - 1];
                    
                    // Check if the last line matches a command completion pattern
                    const isComplete = commandCompletePatterns.some(pattern => {
                        const match = pattern.test(lastLine);
                        if (match) {
                            Logger.debug('Command completion pattern matched', {
                                pattern: pattern.toString(),
                                lastLine: lastLine.slice(0, 100)
                            });
                        }
                        return match;
                    });
                    
                    if (isComplete) {
                        // Wait a bit more to ensure we got all output
                        setTimeout(() => {
                            cleanup();
                            Logger.debug('Command execution completed', {
                                bufferLength: buffer.length,
                                finalSample: buffer.slice(-200)
                            });
                            resolve(buffer);
                        }, 50);
                        return;
                    }
                }
                
                // Fallback: if we haven't seen new data for a while and buffer looks complete
                if (commandExecutionStarted && buffer.length > 0) {
                    const timeSinceLastData = Date.now() - lastDataTime;
                    if (timeSinceLastData > 500) { // 500ms of no new data
                        const lines = buffer.split('\n');
                        const lastLine = lines[lines.length - 1];
                        
                        // Check if it looks like a prompt
                        if (lastLine.includes('@') && (lastLine.includes('$') || lastLine.includes('#'))) {
                            cleanup();
                            Logger.debug('Command execution completed (fallback)', {
                                bufferLength: buffer.length,
                                finalSample: buffer.slice(-200)
                            });
                            resolve(buffer);
                            return;
                        }
                    }
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
                Logger.error('Command execution timeout', {
                    timeout,
                    bufferLength: buffer.length,
                    bufferSample: buffer.slice(-200),
                    commandExecutionStarted
                });
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
        Logger.debug('Sanitizing output', {
            command,
            originalLength: output.length,
            originalSample: output.slice(0, 200)
        });
        
        // Split into lines for better processing
        let lines = output.split(/\r?\n/);
        
        // Remove the command echo line (usually the first line containing the command)
        const escapedCommand = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        lines = lines.filter(line => {
            const containsCommand = new RegExp(escapedCommand, 'i').test(line);
            const isCommandEcho = containsCommand && line.trim().endsWith(command);
            return !isCommandEcho;
        });
        
        // Remove PS1 export commands and shell setup artifacts
        lines = lines.filter(line => {
            return !line.match(/export\s+PS1=/) && 
                   !line.match(/PS1=/) &&
                   !line.match(/set\s+[+-][a-z]+/);
        });
        
        // Remove terminal control sequences and ANSI codes
        lines = lines.map(line => {
            return line
                .replace(/\[?\?2004[lh]/g, '') // Bracketed paste mode
                .replace(/\[\?[0-9]+[lh]/g, '') // Other terminal control sequences
                .replace(/\x1b\[[0-9;]*[mK]/g, '') // ANSI escape sequences
                .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '') // Other ANSI sequences
                .replace(/\x1b\[[0-9;?]*[hlr]/g, ''); // Terminal mode sequences
        });
        
        // Remove prompt lines (last line is usually the prompt)
        if (lines.length > 0) {
            const lastLine = lines[lines.length - 1];
            // Remove if it looks like a prompt
            if (lastLine.match(/^[^@]*@[^:]*:[^$#>]*[$#>]\s*$/) || 
                lastLine.match(/^\[[^\]]*\]\s*[$#>]\s*$/) ||
                lastLine.match(/^\s*[$#>]\s*$/)) {
                lines.pop();
            }
        }
        
        // Remove empty lines at the beginning and end
        while (lines.length > 0 && lines[0].trim() === '') {
            lines.shift();
        }
        while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
            lines.pop();
        }
        
        // Join back and final cleanup
        let cleanOutput = lines.join('\n');
        
        // Remove any remaining control characters
        cleanOutput = cleanOutput.replace(/[\x00-\x1F\x7F]/g, '');
        
        // Final trim
        cleanOutput = cleanOutput.trim();
        
        Logger.debug('Output sanitized', {
            command,
            cleanLength: cleanOutput.length,
            cleanSample: cleanOutput.slice(0, 200),
            linesRemoved: output.split(/\r?\n/).length - lines.length
        });
        
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

    private async setBasePromptFast(): Promise<void> {
        try {
            Logger.debug('Setting base prompt in fast mode');
            
            // In fast mode, use a very short timeout for prompt detection
            await this.writeChannel(this.returnChar);
            const output = await this.readChannel(1500); // Reduced timeout
            
            if (output.trim()) {
                this.extractPromptFromOutput(output);
                Logger.debug('Fast prompt detection successful', {
                    basePrompt: this.basePrompt,
                    shellPrompt: this.shellPrompt
                });
            } else {
                // Use fallback immediately in fast mode
                this.setFallbackPrompt();
                Logger.debug('Using fallback prompt in fast mode');
            }
        } catch (error) {
            Logger.debug('Fast prompt detection failed, using fallback', {
                error: error instanceof Error ? error.message : String(error)
            });
            this.setFallbackPrompt();
        }
    }
} 