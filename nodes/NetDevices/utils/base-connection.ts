import { Client, ConnectConfig } from 'ssh2';
import { EventEmitter } from 'events';

export interface DeviceCredentials {
    host: string;
    port: number;
    username: string;
    password?: string;
    authMethod: 'password' | 'privateKey';
    privateKey?: string;
    passphrase?: string;
    deviceType: string;
    timeout?: number;
    keepAlive?: boolean;
    fastMode?: boolean;
    commandTimeout?: number;
    reuseConnection?: boolean;
    connectionPooling?: boolean;
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
    protected timeout: number = 10000;
    protected encoding: string = 'utf8';
    protected newline: string = '\n';
    protected returnChar: string = '\r';
    protected fastMode: boolean = false;
    protected commandTimeout: number = 8000;
    protected reuseConnection: boolean = false;
    protected connectionPooling: boolean = false;
    protected lastActivity: number = Date.now();

    // Static connection pool for reusing connections
    private static connectionPool: Map<string, BaseConnection> = new Map();
    private static poolCleanupInterval: NodeJS.Timeout | null = null;

    constructor(credentials: DeviceCredentials) {
        super();
        this.credentials = credentials;
        this.client = new Client();
        this.timeout = credentials.timeout || 10000;
        this.fastMode = credentials.fastMode || false;
        this.commandTimeout = credentials.commandTimeout || 8000;
        this.reuseConnection = credentials.reuseConnection || false;
        this.connectionPooling = credentials.connectionPooling || false;
        this.setupEventHandlers();
        this.setupConnectionPooling();
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
        // Check for existing connection in pool
        if (this.connectionPooling || this.reuseConnection) {
            const connectionKey = this.getConnectionKey();
            const existingConnection = BaseConnection.connectionPool.get(connectionKey);
            
            if (existingConnection && existingConnection.isAlive()) {
                // Reuse existing connection
                this.client = existingConnection.client;
                this.currentChannel = existingConnection.currentChannel;
                this.isConnected = true;
                this.basePrompt = existingConnection.basePrompt;
                this.lastActivity = Date.now();
                return;
            }
        }

        // Use optimized algorithms for faster connection
        const algorithmConfigs = this.getOptimizedAlgorithms();

        for (let i = 0; i < algorithmConfigs.length; i++) {
            try {
                await this.tryConnect(algorithmConfigs[i]);
                
                // Add to connection pool if enabled
                if (this.connectionPooling) {
                    const connectionKey = this.getConnectionKey();
                    BaseConnection.connectionPool.set(connectionKey, this);
                }
                
                return;
            } catch (error) {
                if (i === algorithmConfigs.length - 1) {
                    throw error;
                }
                // Continue to next algorithm configuration
            }
        }
    }

    private async tryConnect(algorithms: any): Promise<void> {
        return new Promise((resolve, reject) => {
            // Use faster timeout for connection attempts
            const connectionTimeout = this.fastMode ? 
                Math.min(this.timeout, 8000) : this.timeout;

            const connectConfig: ConnectConfig = {
                host: this.credentials.host,
                port: this.credentials.port,
                username: this.credentials.username,
                readyTimeout: connectionTimeout,
                keepaliveInterval: this.credentials.keepAlive ? 
                    (this.fastMode ? 60000 : 30000) : undefined,
                algorithms: algorithms,
                // Optimize settings for faster connection
                hostHash: 'md5'
            };

            // Configure authentication method
            if (this.credentials.authMethod === 'privateKey') {
                if (!this.credentials.privateKey) {
                    reject(new Error('SSH private key is required for private key authentication'));
                    return;
                }
                connectConfig.privateKey = this.credentials.privateKey;
                if (this.credentials.passphrase) {
                    connectConfig.passphrase = this.credentials.passphrase;
                }
            } else {
                if (!this.credentials.password) {
                    reject(new Error('Password is required for password authentication'));
                    return;
                }
                connectConfig.password = this.credentials.password;
            }

            // Set up timeout for the entire connection process
            const timeoutId = setTimeout(() => {
                this.client.removeAllListeners();
                reject(new Error(`Connection timeout after ${connectionTimeout}ms`));
            }, connectionTimeout);

            this.client.once('ready', () => {
                clearTimeout(timeoutId);
                this.lastActivity = Date.now();
                this.sessionPreparation()
                    .then(() => resolve())
                    .catch(reject);
            });

            this.client.once('error', (error) => {
                clearTimeout(timeoutId);
                reject(error);
            });

            this.client.connect(connectConfig);
        });
    }

    async disconnect(): Promise<void> {
        return new Promise((resolve) => {
            // If connection pooling is enabled, don't actually disconnect
            if (this.connectionPooling && this.isAlive()) {
                this.lastActivity = Date.now();
                resolve();
                return;
            }

            // Graceful channel closure
            if (this.currentChannel) {
                this.currentChannel.end();
                this.currentChannel = null;
            }

            if (this.client) {
                // Set a timeout for disconnect operation
                const disconnectTimeout = setTimeout(() => {
                    this.isConnected = false;
                    resolve();
                }, this.fastMode ? 2000 : 5000);

                this.client.once('close', () => {
                    clearTimeout(disconnectTimeout);
                    this.isConnected = false;
                    
                    // Remove from connection pool if it exists
                    if (this.connectionPooling) {
                        const connectionKey = this.getConnectionKey();
                        BaseConnection.connectionPool.delete(connectionKey);
                    }
                    
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
        
        if (this.fastMode) {
            // Fast mode: minimal setup for better performance
            await this.setBasePrompt();
        } else {
            // Standard mode: full setup
            // Run setup operations in parallel for better performance
            await Promise.all([
                this.setBasePrompt(),
                this.disablePaging(),
                this.setTerminalWidth(),
            ]);
        }
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
                
                // Reduced wait time for faster channel setup
                const waitTime = this.fastMode ? 200 : 500;
                setTimeout(() => {
                    resolve();
                }, waitTime);
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
        return new Promise((resolve, reject) => {
            let buffer = '';
            let timeoutId: NodeJS.Timeout;
            const prompt = expectedPrompt || this.basePrompt;
            
            // Use shorter timeout in fast mode
            const actualTimeout = this.fastMode ? Math.min(timeout, 5000) : timeout;
            
            // Smart prompt patterns for faster detection
            const promptPatterns = [
                prompt,
                prompt + '#',
                prompt + '>',
                prompt + '$',
                prompt + '%'
            ];

            const onData = (data: string) => {
                buffer += data;
                
                // Check for any prompt pattern match
                const hasPrompt = promptPatterns.some(p => buffer.includes(p));
                
                if (hasPrompt) {
                    cleanup();
                    resolve(buffer);
                    return;
                }
                
                // Fast mode: also check for common prompt endings
                if (this.fastMode) {
                    const lines = buffer.split('\n');
                    const lastLine = lines[lines.length - 1];
                    if (lastLine.match(/[>#$%]\s*$/)) {
                        cleanup();
                        resolve(buffer);
                        return;
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
                    global.clearTimeout(timeoutId);
                }
            };

            timeoutId = global.setTimeout(() => {
                cleanup();
                reject(new Error(`Timeout waiting for prompt after ${actualTimeout}ms. Buffer: ${buffer.slice(-200)}`));
            }, actualTimeout);

            if (this.currentChannel) {
                this.currentChannel.on('data', onData);
                this.currentChannel.on('error', onError);
            } else {
                cleanup();
                reject(new Error('No active channel available'));
            }
        });
    }

    async sendCommand(command: string): Promise<CommandResult> {
        try {
            if (!this.isConnected || !this.currentChannel) {
                throw new Error('Not connected to device');
            }

            // Update activity timestamp for connection pooling
            this.lastActivity = Date.now();

            // Send the command
            await this.writeChannel(command + this.newline);
            
            // Use optimized timeout based on mode
            const timeout = this.fastMode ? Math.min(this.commandTimeout, 5000) : this.commandTimeout;
            
            // Wait for response with timeout
            const output = await this.readUntilPrompt(undefined, timeout);
            
            // Clean up the output
            const cleanOutput = this.sanitizeOutput(output, command);

            // In fast mode, skip extensive error checking for simple commands
            if (this.fastMode && command.startsWith('show')) {
                return {
                    command,
                    output: cleanOutput,
                    success: true
                };
            }

            // Check for common error patterns in output
            const errorPatterns = [
                /invalid command/i,
                /command not found/i,
                /syntax error/i,
                /unknown command/i,
                /access denied/i,
                /permission denied/i,
                /authentication failed/i,
                /connection lost/i,
                /timeout/i,
                /error:/i,
                /failed/i
            ];

            const hasError = errorPatterns.some(pattern => pattern.test(cleanOutput));
            
            if (hasError) {
                return {
                    command,
                    output: cleanOutput,
                    success: false,
                    error: 'Command execution returned an error'
                };
            }

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
            let hasError = false;
            let errorMessage = '';
            
            // Send each configuration command
            for (const command of configCommands) {
                try {
                    await this.writeChannel(command + this.newline);
                    const output = await this.readUntilPrompt(undefined, this.timeout);
                    allOutput += output;
                    
                    // Check for error patterns in each command output
                    const errorPatterns = [
                        /invalid command/i,
                        /syntax error/i,
                        /unknown command/i,
                        /access denied/i,
                        /permission denied/i,
                        /error:/i,
                        /failed/i,
                        /incomplete command/i,
                        /ambiguous command/i
                    ];
                    
                    if (errorPatterns.some(pattern => pattern.test(output))) {
                        hasError = true;
                        errorMessage = `Error in command: ${command}`;
                        break;
                    }
                } catch (cmdError) {
                    hasError = true;
                    errorMessage = `Failed to execute command: ${command} - ${cmdError}`;
                    break;
                }
            }
            
            // Always try to exit configuration mode
            try {
                await this.exitConfigMode();
            } catch (exitError) {
                // If we can't exit config mode, this is a serious error
                hasError = true;
                errorMessage = errorMessage || `Failed to exit configuration mode: ${exitError}`;
            }
            
            // Clean up the output
            const cleanOutput = this.sanitizeOutput(allOutput, configCommands.join('; '));

            return {
                command: configCommands.join('; '),
                output: cleanOutput,
                success: !hasError,
                error: hasError ? errorMessage : undefined
            };

        } catch (error) {
            // Try to exit config mode on error
            try {
                await this.exitConfigMode();
            } catch (exitError) {
                // Ignore exit errors during error handling
            }
            
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
        // Escape special regex characters in the command
        const escapedCommand = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Remove the command echo
        let cleanOutput = output.replace(new RegExp(escapedCommand, 'g'), '');
        
        // Remove prompts (escape special chars in prompts too)
        const escapedBasePrompt = this.basePrompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapedEnabledPrompt = this.enabledPrompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapedConfigPrompt = this.configPrompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        cleanOutput = cleanOutput.replace(new RegExp(escapedBasePrompt + '[>#$%]', 'g'), '');
        cleanOutput = cleanOutput.replace(new RegExp(escapedEnabledPrompt, 'g'), '');
        cleanOutput = cleanOutput.replace(new RegExp(escapedConfigPrompt, 'g'), '');
        
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
        return this.isConnected && this.currentChannel && !this.currentChannel.destroyed;
    }

    async healthCheck(): Promise<boolean> {
        try {
            if (!this.isAlive()) {
                return false;
            }
            
            // Send a simple command to check if the connection is responsive
            await this.writeChannel(this.returnChar);
            const response = await this.readChannel(5000);
            
            // If we get any response, the connection is alive
            return response.length > 0;
        } catch (error) {
            return false;
        }
    }

    getDeviceType(): string {
        return this.credentials.deviceType;
    }

    getHost(): string {
        return this.credentials.host;
    }

    getConnectionInfo(): { host: string; port: number; deviceType: string; connected: boolean } {
        return {
            host: this.credentials.host,
            port: this.credentials.port,
            deviceType: this.credentials.deviceType,
            connected: this.isAlive()
        };
    }

    private setupConnectionPooling(): void {
        // Start cleanup interval if not already running
        if (this.connectionPooling && !BaseConnection.poolCleanupInterval) {
            BaseConnection.poolCleanupInterval = setInterval(() => {
                this.cleanupConnectionPool();
            }, 300000); // Clean up every 5 minutes
        }
    }

    private cleanupConnectionPool(): void {
        const now = Date.now();
        const maxIdleTime = 600000; // 10 minutes

        for (const [key, connection] of BaseConnection.connectionPool.entries()) {
            if (now - connection.lastActivity > maxIdleTime) {
                connection.disconnect();
                BaseConnection.connectionPool.delete(key);
            }
        }
    }

    private getConnectionKey(): string {
        return `${this.credentials.host}:${this.credentials.port}:${this.credentials.username}`;
    }

    // Get optimized SSH algorithms for faster connection
    private getOptimizedAlgorithms(): any[] {
        if (this.fastMode) {
            // Ultra-fast algorithms for speed-critical operations
            return [
                {
                    serverHostKey: ['ssh-rsa', 'ecdsa-sha2-nistp256'],
                    cipher: ['aes128-ctr', 'aes128-cbc'],
                    hmac: ['hmac-sha1'],
                    kex: ['diffie-hellman-group14-sha1', 'ecdh-sha2-nistp256']
                }
            ];
        } else {
            // Balanced algorithms for reliability and speed
            return [
                {
                    serverHostKey: [
                        'ssh-rsa', 'rsa-sha2-256', 'ecdsa-sha2-nistp256', 
                        'ecdsa-sha2-nistp384', 'ssh-ed25519'
                    ],
                    cipher: [
                        'aes128-ctr', 'aes192-ctr', 'aes256-ctr',
                        'aes128-cbc', 'aes192-cbc'
                    ],
                    hmac: ['hmac-sha2-256', 'hmac-sha1'],
                    kex: [
                        'diffie-hellman-group14-sha256', 'ecdh-sha2-nistp256',
                        'diffie-hellman-group14-sha1'
                    ]
                },
                // Fallback
                {
                    serverHostKey: ['ssh-rsa'],
                    cipher: ['aes128-cbc'],
                    hmac: ['hmac-sha1'],
                    kex: ['diffie-hellman-group1-sha1']
                }
            ];
        }
    }

    // Static method to force cleanup connection pool
    static forceCleanupConnectionPool(): void {
        for (const [key, connection] of BaseConnection.connectionPool.entries()) {
            connection.disconnect();
            BaseConnection.connectionPool.delete(key);
        }
        
        if (BaseConnection.poolCleanupInterval) {
            clearInterval(BaseConnection.poolCleanupInterval);
            BaseConnection.poolCleanupInterval = null;
        }
    }

    // Static method to get connection pool status
    static getConnectionPoolStatus(): { totalConnections: number; connections: string[] } {
        return {
            totalConnections: BaseConnection.connectionPool.size,
            connections: Array.from(BaseConnection.connectionPool.keys())
        };
    }
} 