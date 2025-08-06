import { BaseConnection, DeviceCredentials, CommandResult } from '../base-connection';

export class CienaSaosConnection extends BaseConnection {

    constructor(credentials: DeviceCredentials) {
        super(credentials);
    }

    public async sessionPreparation(): Promise<void> {
        await this.createCienaShellChannel();
        await this.setBasePrompt();
        await this.disablePaging();
    }

    private async createCienaShellChannel(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.client.shell((err, channel) => {
                if (err) {
                    reject(err);
                    return;
                }
                this.currentChannel = channel;
                this.currentChannel.setEncoding(this.encoding);
                setTimeout(() => resolve(), this.fastMode ? 200 : 600);
            });
        });
    }

    protected async setBasePrompt(): Promise<void> {
        await this.writeChannel(this.returnChar);
        const output = await this.readChannel(3000);
        const lines = output.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        // Remove trailing prompt terminator
        this.basePrompt = lastLine.replace(/[>$#]\s*$/, '').trim();
        this.enabledPrompt = this.basePrompt + '>'; // Not used, but for completeness
        this.configPrompt = this.basePrompt + '#'; // Not used, but for completeness
    }

    protected async disablePaging(): Promise<void> {
        try {
            await this.writeChannel('system shell session set more off' + this.newline);
            await this.readChannel(2000);
        } catch (error) {
            // Not critical
        }
    }

    async saveConfig(): Promise<CommandResult> {
        try {
            await this.writeChannel('configuration save' + this.newline);
            const output = await this.readUntilPrompt(undefined, 10000);
            return {
                command: 'configuration save',
                output: this.sanitizeOutput(output, 'configuration save'),
                success: true
            };
        } catch (error) {
            return {
                command: 'configuration save',
                output: '',
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    // No enable/config mode for Ciena SAOS
    protected async enterConfigMode(): Promise<void> { return; }
    protected async exitConfigMode(): Promise<void> { return; }
    isInConfigMode(): boolean { return false; }

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
} 