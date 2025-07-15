import { BaseConnection, DeviceCredentials, CommandResult } from '../base-connection';

export class PaloAltoConnection extends BaseConnection {
    private inConfigMode: boolean = false;
    private readonly promptPattern = /[>#]/;

    constructor(credentials: DeviceCredentials) {
        super(credentials);
    }

    protected async sessionPreparation(): Promise<void> {
        // Create shell channel
        await this.createPaloAltoShellChannel();
        
        if (this.fastMode) {
            // Fast mode: minimal setup
            await this.setBasePrompt();
        } else {
            // Standard mode: full setup
            await Promise.all([
                this.setTerminalWidth(),
                this.disablePaging(),
                this.setScriptingMode(),
            ]);
            
            await this.setBasePrompt();
            
            // PA devices can be really slow--try to make sure we are caught up
            await this.writeChannel('show system info' + this.newline);
            await this.readChannel(3000);
            await this.readUntilPrompt(undefined, 5000);
        }
    }

    private async createPaloAltoShellChannel(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.client.shell((err, channel) => {
                if (err) {
                    reject(err);
                    return;
                }

                this.currentChannel = channel;
                this.currentChannel.setEncoding(this.encoding);
                
                // Optimized wait time for faster channel setup
                const waitTime = this.fastMode ? 200 : 600;
                setTimeout(() => {
                    resolve();
                }, waitTime);
            });
        });
    }

    protected async setTerminalWidth(): Promise<void> {
        try {
            await this.writeChannel('set cli terminal width 500' + this.newline);
            await this.readChannel(2000);
        } catch (error) {
            // If this fails, it's not critical
        }
    }

    protected async disablePaging(): Promise<void> {
        try {
            await this.writeChannel('set cli pager off' + this.newline);
            await this.readChannel(2000);
        } catch (error) {
            // If this fails, it's not critical
        }
    }

    protected async setScriptingMode(): Promise<void> {
        try {
            await this.writeChannel('set cli scripting-mode on' + this.newline);
            await this.readChannel(2000);
        } catch (error) {
            // If this fails, it's not critical
        }
    }

    protected async setBasePrompt(): Promise<void> {
        // Send a return to get the current prompt
        await this.writeChannel(this.returnChar);
        const output = await this.readChannel(3000);
        
        // Extract the base prompt from the output
        const lines = output.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        
        // Remove common prompt terminators to get base prompt
        this.basePrompt = lastLine.replace(/[>#]\s*$/, '').trim();
        
        // Set enabled and config prompts based on base prompt
        this.enabledPrompt = this.basePrompt + '>';
        this.configPrompt = this.basePrompt + '#';
    }

    protected async enterConfigMode(): Promise<void> {
        try {
            await this.writeChannel('configure' + this.newline);
            const output = await this.readChannel(3000);
            
            if (output.includes('#') || output.includes('[edit')) {
                this.inConfigMode = true;
            } else {
                throw new Error('Failed to enter configuration mode');
            }
        } catch (error) {
            throw new Error(`Failed to enter configuration mode: ${error}`);
        }
    }

    protected async exitConfigMode(): Promise<void> {
        if (!this.inConfigMode) {
            return;
        }
        
        try {
            await this.writeChannel('exit' + this.newline);
            const output = await this.readChannel(3000);
            
            if (output.includes('>') && !output.includes('#') && !output.includes('[edit')) {
                this.inConfigMode = false;
            } else {
                throw new Error('Failed to exit configuration mode');
            }
        } catch (error) {
            throw new Error(`Failed to exit configuration mode: ${error}`);
        }
    }

    async sendCommand(command: string): Promise<CommandResult> {
        try {
            if (!this.isConnected || !this.currentChannel) {
                throw new Error('Not connected to device');
            }

            // Send the command
            await this.writeChannel(command + this.newline);
            
            // Use optimized timeout - PA devices can be slow
            const timeout = this.fastMode ? 8000 : 15000;
            
            // Wait for response with appropriate timeout
            const output = await this.readUntilPrompt(undefined, timeout);
            
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
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    async sendConfig(configCommands: string[]): Promise<CommandResult> {
        try {
            if (!this.isConnected || !this.currentChannel) {
                throw new Error('Not connected to device');
            }

            // Enter configuration mode
            await this.enterConfigMode();

            let fullOutput = '';
            
            // Send each configuration command
            for (const command of configCommands) {
                await this.writeChannel(command + this.newline);
                const output = await this.readChannel(3000);
                fullOutput += output;
            }

            // Exit configuration mode
            await this.exitConfigMode();

            // Clean up the output
            const cleanOutput = this.sanitizeOutput(fullOutput, configCommands.join('\n'));

            return {
                command: configCommands.join('\n'),
                output: cleanOutput,
                success: true
            };
        } catch (error) {
            // Try to exit config mode if we're still in it
            try {
                if (this.inConfigMode) {
                    await this.exitConfigMode();
                }
            } catch (exitError) {
                // Ignore exit errors
            }

            return {
                command: configCommands.join('\n'),
                output: '',
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    async commit(
        comment: string = '',
        force: boolean = false,
        partial: boolean = false,
        deviceAndNetwork: boolean = false,
        policyAndObjects: boolean = false,
        vsys: string = '',
        noVsys: boolean = false
    ): Promise<CommandResult> {
        try {
            if (!this.isConnected || !this.currentChannel) {
                throw new Error('Not connected to device');
            }

            // Validate parameters
            if ((deviceAndNetwork || policyAndObjects || vsys || noVsys) && !partial) {
                throw new Error("'partial' must be True when using deviceAndNetwork or policyAndObjects or vsys or noVsys.");
            }

            // Enter configuration mode
            await this.enterConfigMode();

            // Build commit command
            let commandString = 'commit';
            const commitMarker = 'configuration committed successfully';
            
            if (comment) {
                commandString += ` description "${comment}"`;
            }
            if (force) {
                commandString += ' force';
            }
            if (partial) {
                commandString += ' partial';
                if (vsys) {
                    commandString += ` ${vsys}`;
                }
                if (deviceAndNetwork) {
                    commandString += ' device-and-network';
                }
                if (policyAndObjects) {
                    commandString += ' policy-and-objects';
                }
                if (noVsys) {
                    commandString += ' no-vsys';
                }
                commandString += ' excluded';
            }

            // Send commit command
            await this.writeChannel(commandString + this.newline);
            
            // Wait for commit to complete (can take a while)
            const output = await this.readUntilPrompt(undefined, 120000); // 2 minutes timeout
            
            // Exit configuration mode
            await this.exitConfigMode();

            // Check if commit was successful
            if (!output.toLowerCase().includes(commitMarker)) {
                throw new Error(`Commit failed with the following errors:\n\n${output}`);
            }

            return {
                command: commandString,
                output: this.sanitizeOutput(output, commandString),
                success: true
            };
        } catch (error) {
            // Try to exit config mode if we're still in it
            try {
                if (this.inConfigMode) {
                    await this.exitConfigMode();
                }
            } catch (exitError) {
                // Ignore exit errors
            }

            return {
                command: 'commit',
                output: '',
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    async getCurrentConfig(): Promise<CommandResult> {
        return this.sendCommand('show config running');
    }

    async saveConfig(): Promise<CommandResult> {
        // Palo Alto doesn't have a traditional save command like Cisco
        // Configuration is automatically saved when committed
        return this.sendCommand('show config saved');
    }

    async rebootDevice(): Promise<CommandResult> {
        try {
            if (!this.isConnected || !this.currentChannel) {
                throw new Error('Not connected to device');
            }

            // Send reboot command
            await this.writeChannel('request restart system' + this.newline);
            
            // Wait for confirmation prompt
            const output = await this.readChannel(5000);
            
            if (output.toLowerCase().includes('yes/no') || output.toLowerCase().includes('y/n')) {
                // Send confirmation
                await this.writeChannel('yes' + this.newline);
                await this.readChannel(3000);
            }

            return {
                command: 'request restart system',
                output: this.sanitizeOutput(output, 'request restart system'),
                success: true
            };
        } catch (error) {
            return {
                command: 'request restart system',
                output: '',
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    protected sanitizeOutput(output: string, command: string): string {
        // Remove the command from the output
        let cleanOutput = output.replace(command, '').trim();
        
        // Remove prompt patterns
        cleanOutput = cleanOutput.replace(new RegExp(this.promptPattern.source + '\\s*$', 'g'), '');
        
        // Remove context items like [edit]
        cleanOutput = this.stripContextItems(cleanOutput);
        
        // Remove ANSI escape codes
        cleanOutput = cleanOutput.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
        
        // Remove extra whitespace
        cleanOutput = cleanOutput.replace(/\n\s*\n/g, '\n').trim();
        
        return cleanOutput;
    }

    private stripContextItems(output: string): string {
        // Strip PaloAlto-specific output like [edit]
        const stringsToStrip = [/\[edit.*\]/];
        
        const lines = output.split('\n');
        const lastLine = lines[lines.length - 1];
        
        for (const pattern of stringsToStrip) {
            if (pattern.test(lastLine)) {
                return lines.slice(0, -1).join('\n');
            }
        }
        
        return output;
    }

    isInConfigMode(): boolean {
        return this.inConfigMode;
    }

    async cleanup(): Promise<void> {
        try {
            // Exit configuration mode if we're in it
            if (this.inConfigMode) {
                await this.exitConfigMode();
            }
        } catch (error) {
            // Ignore cleanup errors
        }
        
        // Always try to send final 'exit'
        try {
            await this.writeChannel('exit' + this.newline);
        } catch (error) {
            // Ignore exit errors
        }
        
        await this.disconnect();
    }
} 