import { BaseConnection, DeviceCredentials, CommandResult } from '../base-connection';

export class CiscoSG300Connection extends BaseConnection {
    private inConfigMode: boolean = false;
    private inEnableMode: boolean = false;
    private enablePassword: string = '';

    constructor(credentials: DeviceCredentials & { enablePassword?: string }) {
        super(credentials);
        this.enablePassword = credentials.enablePassword || credentials.password || '';
    }

    protected async sessionPreparation(): Promise<void> {
        // Create shell channel
        await this.createSG300ShellChannel();
        
        // Set terminal settings
        await this.setTerminalSettings();
        
        // Set base prompt
        await this.setBasePrompt();
        
        // Check if we need to enter enable mode
        await this.checkAndEnterEnableMode();
    }

    private async createSG300ShellChannel(): Promise<void> {
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

    protected async setTerminalSettings(): Promise<void> {
        try {
            // SG300 uses different terminal commands
            await this.writeChannel('terminal datadump' + this.newline);
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
        
        // Set enabled and config prompts based on base prompt
        this.enabledPrompt = this.basePrompt + '#';
        this.configPrompt = this.basePrompt + '(config)#';
    }

    private async checkAndEnterEnableMode(): Promise<void> {
        // Check current prompt to see if we're already in enable mode
        await this.writeChannel(this.returnChar);
        const output = await this.readChannel(2000);
        
        if (output.includes('#')) {
            this.inEnableMode = true;
            return;
        }
        
        // Try to enter enable mode
        await this.enterEnableMode();
    }

    private async enterEnableMode(): Promise<void> {
        try {
            await this.writeChannel('enable' + this.newline);
            
            // Wait for password prompt or enable prompt
            let output = await this.readChannel(3000);
            
            // If we see "Password:" or "password:", send the enable password
            if (output.toLowerCase().includes('password:') || output.toLowerCase().includes('password')) {
                await this.writeChannel(this.enablePassword + this.newline);
                output = await this.readChannel(3000);
            }
            
            // Check if we're now in enable mode
            if (output.includes('#')) {
                this.inEnableMode = true;
            } else {
                throw new Error('Failed to enter enable mode');
            }
        } catch (error) {
            throw new Error(`Failed to enter enable mode: ${error}`);
        }
    }

    protected async enterConfigMode(): Promise<void> {
        if (!this.inEnableMode) {
            await this.enterEnableMode();
        }
        
        try {
            await this.writeChannel('configure' + this.newline);
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

            // In fast mode, skip enable mode check for show commands
            if (!this.fastMode) {
                // Ensure we're in enable mode for most commands
                if (!this.inEnableMode && !command.startsWith('show') && command !== 'enable') {
                    await this.enterEnableMode();
                }
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
        // SG300 uses different command syntax
        return await this.sendCommand('show running-config');
    }

    async saveConfig(): Promise<CommandResult> {
        // SG300 uses 'copy running-config startup-config'
        return await this.sendCommand('copy running-config startup-config');
    }

    async rebootDevice(): Promise<CommandResult> {
        try {
            await this.writeChannel('reload' + this.newline);
            let output = await this.readChannel(5000);
            
            // Look for confirmation prompts
            if (output.includes('confirm') || output.includes('[Y/N]')) {
                await this.writeChannel('y' + this.newline);
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
        
        // Remove SG300-specific prompts and artifacts
        const escapedBasePrompt = this.basePrompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        cleanOutput = cleanOutput.replace(new RegExp(escapedBasePrompt + '[>#$%]', 'g'), '');
        
        // Remove extra whitespace and newlines
        cleanOutput = cleanOutput.replace(/^\s+|\s+$/g, '');
        cleanOutput = cleanOutput.replace(/\r\n/g, '\n');
        cleanOutput = cleanOutput.replace(/\r/g, '\n');
        cleanOutput = cleanOutput.replace(/\n\s*\n/g, '\n');
        
        return cleanOutput;
    }

    isInEnableMode(): boolean {
        return this.inEnableMode;
    }

    isInConfigMode(): boolean {
        return this.inConfigMode;
    }
} 