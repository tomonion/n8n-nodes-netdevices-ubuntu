import { BaseConnection, DeviceCredentials, CommandResult } from '../base-connection';

export class JuniperConnection extends BaseConnection {
    private inCliMode: boolean = false;
    private inConfigMode: boolean = false;
    private inShellMode: boolean = false;

    constructor(credentials: DeviceCredentials) {
        super(credentials);
    }

    protected async sessionPreparation(): Promise<void> {
        // Create shell channel
        await this.createJuniperShellChannel();
        
        // Enter CLI mode if we're in shell
        await this.enterCliMode();
        
        // Set terminal width
        await this.setTerminalWidth();
        
        // Disable paging and other CLI settings
        await this.disablePaging();
        
        // Set base prompt
        await this.setBasePrompt();
    }

    private async createJuniperShellChannel(): Promise<void> {
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

    private async enterCliMode(): Promise<void> {
        // Check if we're already in CLI mode
        await this.writeChannel(this.returnChar);
        let output = await this.readChannel(3000);
        
        const mode = this.determineMode(output);
        
        if (mode === 'shell') {
            this.inShellMode = true;
            this.inCliMode = false;
            
            // Enter CLI mode
            await this.writeChannel('cli' + this.newline);
            output = await this.readChannel(3000);
            
            if (output.includes('>') || output.includes('#')) {
                this.inCliMode = true;
                this.inShellMode = false;
            }
        } else if (mode === 'cli') {
            this.inCliMode = true;
            this.inShellMode = false;
        }
    }

    private determineMode(data: string): 'shell' | 'cli' {
        // Shell patterns: root@hostname, %, $
        if (data.match(/root@/) || data.match(/%/) || data.match(/\$/)) {
            return 'shell';
        }
        // CLI patterns: > or #
        if (data.includes('>') || data.includes('#')) {
            return 'cli';
        }
        return 'cli'; // Default to CLI
    }

    protected async setTerminalWidth(): Promise<void> {
        try {
            await this.writeChannel('set cli screen-width 511' + this.newline);
            const output = await this.readChannel(2000);
            
            // Check for success message
            if (!output.includes('Screen width set to')) {
                // Try alternate command
                await this.writeChannel('set cli screen-width 511' + this.newline);
                await this.readChannel(2000);
            }
        } catch (error) {
            // If this fails, it's not critical
        }
    }

    protected async disablePaging(): Promise<void> {
        try {
            // Disable complete-on-space
            await this.writeChannel('set cli complete-on-space off' + this.newline);
            await this.readChannel(2000);
            
            // Set screen length to 0 (disable paging)
            await this.writeChannel('set cli screen-length 0' + this.newline);
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
        this.configPrompt = this.basePrompt + '#';
    }

    protected async enterConfigMode(): Promise<void> {
        if (!this.inCliMode) {
            await this.enterCliMode();
        }
        
        try {
            await this.writeChannel('configure' + this.newline);
            const output = await this.readChannel(3000);
            
            if (output.includes('Entering configuration mode') || output.includes('[edit]')) {
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
            await this.writeChannel('exit configuration-mode' + this.newline);
            let output = await this.readChannel(3000);
            
            // Check for uncommitted changes
            if (output.includes('Exit with uncommitted changes')) {
                await this.writeChannel('yes' + this.newline);
                output = await this.readChannel(3000);
            }
            
            if (output.includes('>') && !output.includes('[edit]')) {
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

            // Ensure we're in CLI mode
            if (!this.inCliMode) {
                await this.enterCliMode();
            }

            // Send the command
            await this.writeChannel(command + this.newline);
            
            // Wait for response with appropriate timeout
            const output = await this.readUntilPrompt(undefined, 15000);
            
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

    async sendConfig(configCommands: string[]): Promise<CommandResult> {
        try {
            if (!this.isConnected || !this.currentChannel) {
                throw new Error('Not connected to device');
            }

            // Enter configuration mode
            await this.enterConfigMode();
            
            let allOutput = '';
            
            // Send each configuration command
            for (const command of configCommands) {
                await this.writeChannel(command + this.newline);
                const output = await this.readChannel(3000);
                allOutput += output;
                
                // Check for configuration errors
                if (output.includes('error:') || output.includes('syntax error')) {
                    throw new Error(`Configuration error on command "${command}": ${output}`);
                }
            }
            
            // Commit the configuration
            await this.commitConfig();
            
            // Exit configuration mode
            await this.exitConfigMode();
            
            // Clean up the output
            const cleanOutput = this.sanitizeOutput(allOutput, configCommands.join('; '));

            return {
                command: configCommands.join('; '),
                output: cleanOutput,
                success: true
            };

        } catch (error) {
            // Try to exit config mode if we're still in it
            if (this.inConfigMode) {
                try {
                    await this.exitConfigMode();
                } catch (exitError) {
                    // Ignore exit errors if we're already handling an error
                }
            }
            
            return {
                command: configCommands.join('; '),
                output: '',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    async commitConfig(comment?: string): Promise<CommandResult> {
        try {
            if (!this.inConfigMode) {
                throw new Error('Not in configuration mode');
            }

            let commitCommand = 'commit';
            if (comment) {
                commitCommand += ` comment "${comment}"`;
            }

            await this.writeChannel(commitCommand + this.newline);
            const output = await this.readChannel(10000); // Commit can take longer
            
            if (output.includes('commit complete')) {
                return {
                    command: commitCommand,
                    output: output,
                    success: true
                };
            } else {
                throw new Error('Commit failed');
            }
        } catch (error) {
            return {
                command: 'commit',
                output: '',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    async getCurrentConfig(): Promise<CommandResult> {
        return await this.sendCommand('show configuration');
    }

    async saveConfig(): Promise<CommandResult> {
        // In JunOS, configurations are saved when committed
        return await this.sendCommand('show configuration | display set');
    }

    async rebootDevice(): Promise<CommandResult> {
        try {
            // Send request system reboot
            await this.writeChannel('request system reboot' + this.newline);
            
            // Wait for confirmation prompt
            let output = await this.readChannel(5000);
            
            // If we see a confirmation prompt, respond with yes
            if (output.includes('Reboot the system?') || output.includes('[yes,no]')) {
                await this.writeChannel('yes' + this.newline);
                output += await this.readChannel(5000);
            }
            
            return {
                command: 'request system reboot',
                output: output,
                success: true
            };
        } catch (error) {
            return {
                command: 'request system reboot',
                output: '',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    protected sanitizeOutput(output: string, command: string): string {
        // Remove the command echo
        let cleanOutput = output.replace(new RegExp(command, 'g'), '');
        
        // Remove Juniper-specific prompts
        cleanOutput = cleanOutput.replace(new RegExp(this.basePrompt + '[>#$%]', 'g'), '');
        cleanOutput = cleanOutput.replace(/\[edit\]/g, '');
        
        // Remove common Juniper CLI artifacts
        cleanOutput = cleanOutput.replace(/Entering configuration mode/g, '');
        cleanOutput = cleanOutput.replace(/Exiting configuration mode/g, '');
        cleanOutput = cleanOutput.replace(/commit complete/g, '');
        cleanOutput = cleanOutput.replace(/Screen width set to \d+/g, '');
        cleanOutput = cleanOutput.replace(/Disabling complete-on-space/g, '');
        cleanOutput = cleanOutput.replace(/Screen length set to \d+/g, '');
        
        // Remove extra whitespace and newlines
        cleanOutput = cleanOutput.replace(/^\s+|\s+$/g, '');
        cleanOutput = cleanOutput.replace(/\r\n/g, '\n');
        cleanOutput = cleanOutput.replace(/\r/g, '\n');
        cleanOutput = cleanOutput.replace(/\n\s*\n/g, '\n');
        
        return cleanOutput;
    }

    // Juniper-specific utility methods
    isInCliMode(): boolean {
        return this.inCliMode;
    }

    isInConfigMode(): boolean {
        return this.inConfigMode;
    }

    isInShellMode(): boolean {
        return this.inShellMode;
    }

    async enterShellMode(): Promise<void> {
        if (this.inShellMode) {
            return;
        }

        if (this.inCliMode) {
            await this.writeChannel('start shell' + this.newline);
            const output = await this.readChannel(3000);
            
            if (output.includes('$') || output.includes('%')) {
                this.inShellMode = true;
                this.inCliMode = false;
            }
        }
    }

    async returnToCliMode(): Promise<void> {
        if (this.inCliMode) {
            return;
        }

        if (this.inShellMode) {
            await this.writeChannel('exit' + this.newline);
            const output = await this.readChannel(3000);
            
            if (output.includes('>') || output.includes('#')) {
                this.inCliMode = true;
                this.inShellMode = false;
            }
        }
    }
} 