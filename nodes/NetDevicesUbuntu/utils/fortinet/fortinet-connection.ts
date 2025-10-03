import { BaseConnection, DeviceCredentials, CommandResult } from '../base-connection';

export class FortinetConnection extends BaseConnection {
    private vdoms: boolean = false;
    private osVersion: string = '';
    private originalOutputMode: string = '';
    private outputMode: string = '';
    private inConfigGlobal: boolean = false;

    constructor(credentials: DeviceCredentials) {
        super(credentials);
        // Override SSH algorithms for FortiGate compatibility
        this.setupFortiGateAlgorithms();
    }

    private setupFortiGateAlgorithms(): void {
        // Store original method
        const originalGetOptimizedAlgorithms = this.getOptimizedAlgorithms.bind(this);
        
        // Override with FortiGate-specific algorithms
        this.getOptimizedAlgorithms = () => {
            const fortiGateAlgorithms = {
                serverHostKey: ['ssh-rsa', 'ecdsa-sha2-nistp256'],
                cipher: ['aes128-ctr', 'aes128-cbc', 'aes192-cbc', 'aes256-cbc'],
                hmac: ['hmac-sha1', 'hmac-sha2-256'],
                kex: [
                    'diffie-hellman-group14-sha1',
                    'diffie-hellman-group-exchange-sha1',
                    'diffie-hellman-group-exchange-sha256',
                    'diffie-hellman-group1-sha1'
                ]
            };
            
            // Return FortiGate algorithms first, then fallback
            return [fortiGateAlgorithms, ...originalGetOptimizedAlgorithms()];
        };
    }

    public async sessionPreparation(): Promise<void> {
        try {
            // Create shell channel
            await this.createFortinetShellChannel();
            
            // Handle banner and get to prompt
            await this.handleBanner();
            
            // Set base prompt
            await this.setBasePrompt();
            
            // Detect device capabilities
            await this.detectVDOMs();
            await this.determineOSVersion();
            await this.detectOutputMode();
            
            // Disable paging
            await this.disablePaging();
            
        } catch (error) {
            throw new Error(`FortiGate session preparation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async createFortinetShellChannel(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.client.shell((err, channel) => {
                if (err) {
                    reject(err);
                    return;
                }
                this.currentChannel = channel;
                this.currentChannel.setEncoding(this.encoding);
                // FortiGate needs more time for shell initialization
                setTimeout(() => resolve(), this.fastMode ? 500 : 1000);
            });
        });
    }

    private async handleBanner(): Promise<void> {
        try {
            // Read initial data with longer timeout for FortiGate banner detection
            const data = await this.readChannel(5000);
            
            // Handle "to accept" banner (post-login banner)
            if (data.includes('to accept')) {
                await this.writeChannel('a' + this.returnChar);
                await this.readChannel(3000);
            }
            
            // Handle other common banner types
            if (data.includes('Press any key to continue') || data.includes('Press Enter to continue')) {
                await this.writeChannel(this.returnChar);
                await this.readChannel(3000);
            }
            
            // Handle welcome banners
            if (data.includes('Welcome') || data.includes('FortiGate') || data.includes('FortiOS')) {
                // Send return to get to prompt
                await this.writeChannel(this.returnChar);
                await this.readChannel(3000);
            }
            
        } catch (error) {
            // Banner handling is optional, continue on failure
            console.warn('Banner handling failed, continuing:', error);
        }
    }

    protected async setBasePrompt(): Promise<void> {
        try {
            // Send return to get a clean prompt
            await this.writeChannel(this.returnChar);
            const output = await this.readChannel(3000);
            
            // Parse output to find the prompt
            const lines = output.trim().split('\n');
            let prompt = '';
            
            // Look for the last line that contains a prompt character
            for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i].trim();
                if (line.match(/[#$]\s*$/)) {
                    prompt = line.replace(/[#$]\s*$/, '').trim();
                    break;
                }
            }
            
            // Fallback: try to detect prompt from device hostname or output
            if (!prompt) {
                const hostnameMatch = output.match(/FortiGate-(\S+)/i) || 
                                   output.match(/(\S+)\s*[#$]/);
                if (hostnameMatch) {
                    prompt = hostnameMatch[1];
                } else {
                    prompt = 'FortiGate';
                }
            }
            
            this.basePrompt = prompt;
            this.enabledPrompt = this.basePrompt + '#';
            this.configPrompt = this.basePrompt + '#';
            
        } catch (error) {
            throw new Error(`Failed to set base prompt: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async detectVDOMs(): Promise<void> {
        try {
            const result = await this.sendCommand('get system status | grep Virtual');
            const output = result.output.toLowerCase();
            this.vdoms = output.includes('virtual domain configuration: multiple') ||
                        output.includes('virtual domain configuration: enable') ||
                        output.includes('virtual domain configuration: split-task');
        } catch (error) {
            this.vdoms = false;
        }
    }

    private async determineOSVersion(): Promise<void> {
        try {
            const result = await this.sendCommand('get system status | grep Version');
            const output = result.output;
            if (output.match(/Version: .* (v[78]\.)/)) {
                this.osVersion = 'v7_or_later';
            } else if (output.match(/Version: .* (v[654]\.)/)) {
                this.osVersion = 'v6_or_earlier';
            } else {
                this.osVersion = 'unknown';
            }
        } catch (error) {
            this.osVersion = 'unknown';
        }
    }

    private async detectOutputMode(): Promise<void> {
        try {
            if (this.osVersion === 'v6_or_earlier') {
                this.originalOutputMode = await this.getOutputModeV6();
            } else {
                this.originalOutputMode = await this.getOutputModeV7();
            }
            this.outputMode = this.originalOutputMode;
        } catch (error) {
            this.originalOutputMode = 'more';
            this.outputMode = 'more';
        }
    }

    private async getOutputModeV6(): Promise<string> {
        if (this.vdoms) {
            await this.enterConfigGlobal();
        }

        const result = await this.sendCommand('show full-configuration system console');
        const output = result.output;

        if (this.vdoms) {
            await this.exitConfigGlobal();
        }

        const match = output.match(/^\s+set output (\S+)\s*$/m);
        if (match && ['more', 'standard'].includes(match[1])) {
            return match[1];
        }
        return 'more';
    }

    private async getOutputModeV7(): Promise<string> {
        if (this.vdoms) {
            await this.enterConfigGlobal();
        }

        const result = await this.sendCommand('get system console');
        const output = result.output;

        if (this.vdoms) {
            await this.exitConfigGlobal();
        }

        const match = output.match(/output\s+:\s+(\S+)\s*$/m);
        if (match && ['more', 'standard'].includes(match[1])) {
            return match[1];
        }
        return 'more';
    }

    private async enterConfigGlobal(): Promise<void> {
        try {
            await this.writeChannel('config global' + this.newline);
            const output = await this.readChannel(3000);
            if (output.includes('#')) {
                this.inConfigGlobal = true;
            } else {
                throw new Error('Failed to enter config global mode');
            }
        } catch (error) {
            throw new Error('Netmiko may require config global access to properly disable output paging. Alternatively you can try configuring configure system console -> set output standard.');
        }
    }

    private async exitConfigGlobal(): Promise<void> {
        if (!this.inConfigGlobal) {
            return;
        }

        try {
            await this.writeChannel('end' + this.newline);
            const output = await this.readChannel(3000);
            if (!output.includes('config global')) {
                this.inConfigGlobal = false;
            } else {
                throw new Error('Failed to exit config global mode');
            }
        } catch (error) {
            throw new Error('Unable to properly exit config global mode.');
        }
    }

    protected async disablePaging(): Promise<void> {
        if (this.outputMode === 'standard') {
            return; // Already correct
        }

        try {
            if (this.vdoms) {
                await this.enterConfigGlobal();
            }

            const commands = [
                'config system console',
                'set output standard',
                'end'
            ];

            for (const command of commands) {
                await this.writeChannel(command + this.newline);
                await this.readChannel(2000);
            }

            this.outputMode = 'standard';

            if (this.vdoms) {
                await this.exitConfigGlobal();
            }
        } catch (error) {
            // Paging disable may fail with certain roles
            console.warn('Failed to disable paging, continuing:', error);
        }
    }

    async sendCommand(command: string): Promise<CommandResult> {
        try {
            if (!this.isConnected || !this.currentChannel) {
                throw new Error('Not connected to device');
            }

            await this.writeChannel(command + this.newline);
            // FortiGate commands may take longer, especially for complex operations
            const timeout = this.fastMode ? 10000 : 20000;
            const output = await this.readUntilPrompt(undefined, timeout);
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

            // Fortinet doesn't use traditional config mode
            let fullOutput = '';
            
            for (const command of configCommands) {
                await this.writeChannel(command + this.newline);
                const output = await this.readChannel(3000);
                fullOutput += output;
            }

            const cleanOutput = this.sanitizeOutput(fullOutput, configCommands.join('\n'));

            return {
                command: configCommands.join('\n'),
                output: cleanOutput,
                success: true
            };
        } catch (error) {
            return {
                command: configCommands.join('\n'),
                output: '',
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    async getCurrentConfig(): Promise<CommandResult> {
        return this.sendCommand('show full-configuration');
    }

    async saveConfig(): Promise<CommandResult> {
        // Fortinet doesn't have a traditional save command
        // Configuration is typically saved automatically
        return {
            command: 'save config',
            output: 'Fortinet configuration is typically saved automatically',
            success: true
        };
    }

    async rebootDevice(): Promise<CommandResult> {
        try {
            if (!this.isConnected || !this.currentChannel) {
                throw new Error('Not connected to device');
            }

            await this.writeChannel('execute reboot' + this.newline);
            const output = await this.readChannel(5000);
            
            if (output.toLowerCase().includes('yes/no') || output.toLowerCase().includes('y/n')) {
                await this.writeChannel('yes' + this.newline);
                await this.readChannel(3000);
            }

            return {
                command: 'execute reboot',
                output: this.sanitizeOutput(output, 'execute reboot'),
                success: true
            };
        } catch (error) {
            return {
                command: 'execute reboot',
                output: '',
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    protected sanitizeOutput(output: string, command: string): string {
        const lines = output.split('\n');
        // Remove the command echo, which is usually the first line
        if (lines.length > 0 && lines[0].includes(command)) {
            lines.shift();
        }

        // Remove the prompt, which is the last line
        if (lines.length > 0) {
            const lastLine = lines[lines.length - 1];
            const promptRegex = new RegExp(`^${this.escapeRegex(this.basePrompt)}[>#$]`);
            if (promptRegex.test(lastLine)) {
                lines.pop();
            }
        }

        return lines.join('\n').trim();
    }

    // No traditional config mode for Fortinet
    protected async enterConfigMode(): Promise<void> { return; }
    protected async exitConfigMode(): Promise<void> { return; }
    isInConfigMode(): boolean { return false; }

    async cleanup(): Promise<void> {
        try {
            // Re-enable paging if it was originally set to more
            if (this.originalOutputMode === 'more') {
                if (this.vdoms) {
                    await this.enterConfigGlobal();
                }

                const commands = [
                    'config system console',
                    'set output more',
                    'end'
                ];

                for (const command of commands) {
                    await this.writeChannel(command + this.newline);
                    await this.readChannel(2000);
                }

                if (this.vdoms) {
                    await this.exitConfigGlobal();
                }
            }
        } catch (error) {
            // Ignore cleanup errors
        }

        await this.disconnect();
    }

    // Getters for device information
    hasVDOMs(): boolean {
        return this.vdoms;
    }

    getOSVersion(): string {
        return this.osVersion;
    }

    getOutputMode(): string {
        return this.outputMode;
    }
} 