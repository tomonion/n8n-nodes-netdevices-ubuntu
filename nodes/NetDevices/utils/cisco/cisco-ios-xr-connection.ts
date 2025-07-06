import { BaseConnection, DeviceCredentials, CommandResult } from '../base-connection';

export class CiscoIOSXRConnection extends BaseConnection {
    private inConfigMode: boolean = false;

    constructor(credentials: DeviceCredentials) {
        super(credentials);
    }

    protected async sessionPreparation(): Promise<void> {
        // Create shell channel
        await this.createIOSXRShellChannel();
        
        // Set terminal width and length
        await this.setTerminalSettings();
        
        // Set base prompt
        await this.setBasePrompt();
    }

    private async createIOSXRShellChannel(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.client.shell((err, channel) => {
                if (err) {
                    reject(err);
                    return;
                }

                this.currentChannel = channel;
                this.currentChannel.setEncoding(this.encoding);
                
                // Wait a bit for the channel to be ready
                global.setTimeout(() => {
                    resolve();
                }, 1000);
            });
        });
    }

    protected async setTerminalSettings(): Promise<void> {
        try {
            // IOS-XR uses different terminal commands
            await this.writeChannel('terminal length 0' + this.newline);
            await this.readChannel(2000);
            
            await this.writeChannel('terminal width 511' + this.newline);
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
        this.basePrompt = lastLine.replace(/[>#$%]\s*$/, '').trim();
        
        // Set config prompt based on base prompt
        this.configPrompt = this.basePrompt + '(config)#';
    }

    protected async enterConfigMode(): Promise<void> {
        try {
            await this.writeChannel('configure terminal' + this.newline);
            const output = await this.readChannel(3000);
            
            if (output.includes('(config)#')) {
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
            
            if (output.includes('#') && !output.includes('(config)#')) {
                this.inConfigMode = false;
            } else {
                // Try 'end' command as alternative
                await this.writeChannel('end' + this.newline);
                const endOutput = await this.readChannel(3000);
                if (endOutput.includes('#') && !endOutput.includes('(config)#')) {
                    this.inConfigMode = false;
                } else {
                    throw new Error('Failed to exit configuration mode');
                }
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
            
            // Use optimized timeout - reduced from 15000
            const timeout = this.fastMode ? 5000 : 10000;
            
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
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    async sendConfig(commands: string[]): Promise<CommandResult> {
        try {
            if (!this.isConnected || !this.currentChannel) {
                throw new Error('Not connected to device');
            }

            let fullOutput = '';
            let allCommands = commands.join('\n');

            // Enter configuration mode
            await this.enterConfigMode();
            
            // Send each command
            for (const command of commands) {
                await this.writeChannel(command + this.newline);
                const output = await this.readChannel(3000);
                fullOutput += output;
            }

            // IOS-XR requires explicit commit
            await this.writeChannel('commit' + this.newline);
            const commitOutput = await this.readChannel(5000);
            fullOutput += commitOutput;

            // Exit configuration mode
            await this.exitConfigMode();

            // Clean up the output
            const cleanOutput = this.sanitizeOutput(fullOutput, allCommands);

            return {
                command: allCommands,
                output: cleanOutput,
                success: true
            };

        } catch (error) {
            // Try to exit config mode on error
            try {
                await this.exitConfigMode();
            } catch (exitError) {
                // Ignore exit errors
            }

            return {
                command: commands.join('\n'),
                output: '',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    async getCurrentConfig(): Promise<CommandResult> {
        return await this.sendCommand('show running-config');
    }

    async saveConfig(): Promise<CommandResult> {
        // IOS-XR doesn't use 'write memory', config is saved with commit
        return await this.sendCommand('show configuration commit changes last 1');
    }

    async rebootDevice(): Promise<CommandResult> {
        try {
            await this.writeChannel('reload' + this.newline);
            let output = await this.readChannel(5000);
            
            // Look for confirmation prompts
            if (output.includes('confirm') || output.includes('Proceed')) {
                await this.writeChannel('yes' + this.newline);
                output += await this.readChannel(5000);
            }
            
            return {
                command: 'reload',
                output: output,
                success: true
            };
        } catch (error) {
            return {
                command: 'reload',
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
        
        // Remove IOS-XR specific prompts and artifacts
        const escapedBasePrompt = this.basePrompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        cleanOutput = cleanOutput.replace(new RegExp(escapedBasePrompt + '[>#$%]', 'g'), '');
        cleanOutput = cleanOutput.replace(/RP\/\d+\/\w+\/CPU\d+:/g, '');
        
        // Remove extra whitespace and newlines
        cleanOutput = cleanOutput.replace(/^\s+|\s+$/g, '');
        cleanOutput = cleanOutput.replace(/\r\n/g, '\n');
        cleanOutput = cleanOutput.replace(/\r/g, '\n');
        cleanOutput = cleanOutput.replace(/\n\s*\n/g, '\n');
        
        return cleanOutput;
    }

    isInConfigMode(): boolean {
        return this.inConfigMode;
    }
} 