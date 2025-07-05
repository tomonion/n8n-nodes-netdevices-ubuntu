import { Client, ConnectConfig } from 'ssh2';
import { EventEmitter } from 'events';

export interface DeviceCredentials {
    host: string;
    port: number;
    username: string;
    password: string;
    deviceType: string;
    timeout?: number;
    keepAlive?: boolean;
}

export interface CommandResult {
    command: string;
    output: string;
    success: boolean;
    error?: string;
}

export class BaseConnection extends EventEmitter {
    protected client: Client;
    protected credentials: DeviceCredentials;
    protected isConnected: boolean = false;
    protected currentChannel: any = null;
    protected basePrompt: string = '';
    protected enabledPrompt: string = '';
    protected configPrompt: string = '';
    protected timeout: number = 30000;
    protected encoding: string = 'utf8';
    protected newline: string = '\n';
    protected returnChar: string = '\r';

    constructor(credentials: DeviceCredentials) {
        super();
        this.credentials = credentials;
        this.client = new Client();
        this.timeout = credentials.timeout || 30000;
        this.setupEventHandlers();
    }

    private setupEventHandlers(): void {
        this.client.on('ready', () => {
            this.isConnected = true;
            this.emit('ready');
        });

        this.client.on('error', (error) => {
            this.isConnected = false;
            this.emit('error', error);
        });

        this.client.on('end', () => {
            this.isConnected = false;
            this.emit('end');
        });

        this.client.on('close', () => {
            this.isConnected = false;
            this.emit('close');
        });
    }

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            const connectConfig: ConnectConfig = {
                host: this.credentials.host,
                port: this.credentials.port,
                username: this.credentials.username,
                password: this.credentials.password,
                readyTimeout: this.timeout,
                keepaliveInterval: this.credentials.keepAlive ? 30000 : undefined,
                algorithms: {
                    serverHostKey: ['ssh-rsa', 'ssh-dss', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521'],
                    cipher: ['aes128-ctr', 'aes192-ctr', 'aes256-ctr', 'aes128-gcm', 'aes256-gcm'],
                    hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1'],
                    kex: ['diffie-hellman-group14-sha256', 'diffie-hellman-group16-sha512', 'diffie-hellman-group18-sha512']
                }
            };

            this.client.once('ready', () => {
                this.sessionPreparation()
                    .then(() => resolve())
                    .catch(reject);
            });

            this.client.once('error', reject);

            this.client.connect(connectConfig);
        });
    }

    async disconnect(): Promise<void> {
        return new Promise((resolve) => {
            if (this.currentChannel) {
                this.currentChannel.end();
                this.currentChannel = null;
            }

            if (this.client) {
                this.client.once('close', () => {
                    this.isConnected = false;
                    resolve();
                });
                this.client.end();
            } else {
                resolve();
            }
        });
    }

    protected async sessionPreparation(): Promise<void> {
        // Create shell channel
        await this.createShellChannel();
        
        // Set base prompt
        await this.setBasePrompt();
        
        // Disable paging
        await this.disablePaging();
        
        // Set terminal width
        await this.setTerminalWidth();
    }

    private async createShellChannel(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.client.shell((err, channel) => {
                if (err) {
                    reject(err);
                    return;
                }

                this.currentChannel = channel;
                this.currentChannel.setEncoding(this.encoding);
                resolve();
            });
        });
    }

    protected async setBasePrompt(): Promise<void> {
        // Send a return to get the current prompt
        await this.writeChannel(this.returnChar);
        const output = await this.readChannel();
        
        // Extract the base prompt from the output
        const lines = output.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        
        // Remove common prompt terminators to get base prompt
        this.basePrompt = lastLine.replace(/[>#$%]\s*$/, '');
        
        // Set enabled and config prompts based on base prompt
        this.enabledPrompt = this.basePrompt + '#';
        this.configPrompt = this.basePrompt + '(config)#';
    }

    protected async disablePaging(): Promise<void> {
        // Default implementation - override in vendor classes
        // This is a stub that can be overridden
    }

    protected async setTerminalWidth(): Promise<void> {
        // Default implementation - override in vendor classes
        // This is a stub that can be overridden
    }

    protected async writeChannel(data: string): Promise<void> {
        return new Promise((resolve) => {
            if (this.currentChannel) {
                this.currentChannel.write(data);
                // Small delay to ensure data is sent
                global.setTimeout(resolve, 50);
            } else {
                resolve();
            }
        });
    }

    protected async readChannel(timeout: number = 3000): Promise<string> {
        return new Promise((resolve) => {
            let buffer = '';
            let timeoutId: NodeJS.Timeout;

            const onData = (data: string) => {
                buffer += data;
            };

            const cleanup = () => {
                if (this.currentChannel) {
                    this.currentChannel.removeListener('data', onData);
                }
                if (timeoutId) {
                    global.clearTimeout(timeoutId);
                }
            };

            timeoutId = global.setTimeout(() => {
                cleanup();
                resolve(buffer);
            }, timeout);

            if (this.currentChannel) {
                this.currentChannel.on('data', onData);
            } else {
                cleanup();
                resolve('');
            }
        });
    }

    protected async readUntilPrompt(expectedPrompt?: string, timeout: number = 10000): Promise<string> {
        return new Promise((resolve) => {
            let buffer = '';
            let timeoutId: NodeJS.Timeout;
            const prompt = expectedPrompt || this.basePrompt;

            const onData = (data: string) => {
                buffer += data;
                
                // Check if we've received the expected prompt
                if (buffer.includes(prompt)) {
                    cleanup();
                    resolve(buffer);
                }
            };

            const cleanup = () => {
                if (this.currentChannel) {
                    this.currentChannel.removeListener('data', onData);
                }
                if (timeoutId) {
                    global.clearTimeout(timeoutId);
                }
            };

            timeoutId = global.setTimeout(() => {
                cleanup();
                resolve(buffer);
            }, timeout);

            if (this.currentChannel) {
                this.currentChannel.on('data', onData);
            } else {
                cleanup();
                resolve('');
            }
        });
    }

    async sendCommand(command: string): Promise<CommandResult> {
        try {
            if (!this.isConnected || !this.currentChannel) {
                throw new Error('Not connected to device');
            }

            // Send the command
            await this.writeChannel(command + this.newline);
            
            // Wait for response
            const output = await this.readUntilPrompt();
            
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
                const output = await this.readUntilPrompt();
                allOutput += output;
            }
            
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
            return {
                command: configCommands.join('; '),
                output: '',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    protected async enterConfigMode(): Promise<void> {
        // Default implementation - override in vendor classes
        await this.writeChannel('configure terminal' + this.newline);
        await this.readUntilPrompt();
    }

    protected async exitConfigMode(): Promise<void> {
        // Default implementation - override in vendor classes
        await this.writeChannel('exit' + this.newline);
        await this.readUntilPrompt();
    }

    protected sanitizeOutput(output: string, command: string): string {
        // Remove the command echo
        let cleanOutput = output.replace(new RegExp(command, 'g'), '');
        
        // Remove prompts
        cleanOutput = cleanOutput.replace(new RegExp(this.basePrompt + '[>#$%]', 'g'), '');
        cleanOutput = cleanOutput.replace(new RegExp(this.enabledPrompt, 'g'), '');
        cleanOutput = cleanOutput.replace(new RegExp(this.configPrompt, 'g'), '');
        
        // Remove extra whitespace and newlines
        cleanOutput = cleanOutput.replace(/^\s+|\s+$/g, '');
        cleanOutput = cleanOutput.replace(/\r\n/g, '\n');
        cleanOutput = cleanOutput.replace(/\r/g, '\n');
        
        return cleanOutput;
    }

    async getCurrentConfig(): Promise<CommandResult> {
        // Default implementation - override in vendor classes
        return await this.sendCommand('show configuration');
    }

    async saveConfig(): Promise<CommandResult> {
        // Default implementation - override in vendor classes
        return await this.sendCommand('save configuration');
    }

    async rebootDevice(): Promise<CommandResult> {
        // Default implementation - override in vendor classes
        return await this.sendCommand('reboot');
    }

    // Utility methods
    isAlive(): boolean {
        return this.isConnected;
    }

    getDeviceType(): string {
        return this.credentials.deviceType;
    }

    getHost(): string {
        return this.credentials.host;
    }
} 