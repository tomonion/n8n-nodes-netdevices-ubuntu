import { Client, ConnectConfig } from 'ssh2';
import { BaseConnection, DeviceCredentials, JumpHostConfig } from './base-connection';

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

export class JumpHostConnection extends BaseConnection {
    private jumpHostClient: Client;
    private jumpHostConfig: JumpHostConfig;
    private tunnelStream: any;
    private jumpHostConnected: boolean = false;

    constructor(credentials: DeviceCredentials) {
        super(credentials);
        this.jumpHostConfig = credentials.jumpHost!;
        this.jumpHostClient = new Client();
        this.setupJumpHostEventHandlers();
    }

    private setupJumpHostEventHandlers(): void {
        this.jumpHostClient.on('error', (error) => {
            Logger.error('Jump host connection error', {
                jumpHost: this.jumpHostConfig.host,
                error: error.message
            });
        });

        this.jumpHostClient.on('end', () => {
            Logger.info('Jump host connection ended', {
                jumpHost: this.jumpHostConfig.host
            });
            this.jumpHostConnected = false;
        });

        this.jumpHostClient.on('close', () => {
            Logger.info('Jump host connection closed', {
                jumpHost: this.jumpHostConfig.host
            });
            this.jumpHostConnected = false;
        });
    }

    async connect(): Promise<void> {
        Logger.debug('Starting jump host connection process', {
            jumpHost: this.jumpHostConfig.host,
            target: this.credentials.host,
            jumpHostAuthMethod: this.jumpHostConfig.authMethod,
            targetAuthMethod: this.credentials.authMethod
        });

        try {
            // 1. Connect to jump host
            await this.connectToJumpHost();
            
            // 2. Create outbound tunnel
            await this.createOutboundTunnel();
            
            // 3. Connect to target through tunnel
            await this.connectThroughTunnel();
            
            Logger.info('Jump host connection established successfully', {
                jumpHost: this.jumpHostConfig.host,
                target: this.credentials.host
            });

        } catch (error) {
            Logger.error('Jump host connection failed', {
                jumpHost: this.jumpHostConfig.host,
                target: this.credentials.host,
                error: error instanceof Error ? error.message : String(error)
            });
            await this.cleanup();
            throw error;
        }
    }

    private async connectToJumpHost(): Promise<void> {
        return new Promise((resolve, reject) => {
            const connectConfig: ConnectConfig = {
                host: this.jumpHostConfig.host,
                port: this.jumpHostConfig.port,
                username: this.jumpHostConfig.username,
                readyTimeout: this.timeout,
                algorithms: this.getOptimizedAlgorithms()[0] // Use first algorithm set
            };

            // Configure jump host authentication
            if (this.jumpHostConfig.authMethod === 'privateKey') {
                connectConfig.privateKey = this.jumpHostConfig.privateKey;
                if (this.jumpHostConfig.passphrase) {
                    connectConfig.passphrase = this.jumpHostConfig.passphrase;
                }
                connectConfig.tryKeyboard = false;
            } else {
                connectConfig.password = this.jumpHostConfig.password;
            }

            Logger.debug('Connecting to jump host', {
                jumpHost: this.jumpHostConfig.host,
                port: this.jumpHostConfig.port,
                username: this.jumpHostConfig.username,
                authMethod: this.jumpHostConfig.authMethod
            });

            this.jumpHostClient.connect(connectConfig);

            this.jumpHostClient.once('ready', () => {
                Logger.info('Jump host connection established', {
                    jumpHost: this.jumpHostConfig.host,
                    username: this.jumpHostConfig.username
                });
                this.jumpHostConnected = true;
                resolve();
            });

            this.jumpHostClient.once('error', (error) => {
                Logger.error('Jump host connection failed', {
                    jumpHost: this.jumpHostConfig.host,
                    error: error.message
                });
                reject(error);
            });
        });
    }

    private async createOutboundTunnel(): Promise<void> {
        return new Promise((resolve, reject) => {
            Logger.debug('Creating outbound tunnel', {
                jumpHost: this.jumpHostConfig.host,
                target: `${this.credentials.host}:${this.credentials.port}`
            });

            // Create tunnel from jump host to target device
            this.jumpHostClient.forwardOut(
                '127.0.0.1', 0, // Source address and port
                this.credentials.host, this.credentials.port, // Target address and port
                (err, stream) => {
                    if (err) {
                        Logger.error('Tunnel creation failed', {
                            jumpHost: this.jumpHostConfig.host,
                            target: `${this.credentials.host}:${this.credentials.port}`,
                            error: err.message
                        });
                        reject(err);
                        return;
                    }

                    this.tunnelStream = stream;
                    Logger.info('Outbound tunnel created successfully', {
                        jumpHost: this.jumpHostConfig.host,
                        target: `${this.credentials.host}:${this.credentials.port}`
                    });
                    resolve();
                }
            );
        });
    }

    private async connectThroughTunnel(): Promise<void> {
        return new Promise((resolve, reject) => {
            Logger.debug('Connecting to target through tunnel', {
                target: this.credentials.host,
                username: this.credentials.username,
                authMethod: this.credentials.authMethod
            });

            // Use the tunnel stream to create SSH connection to target
            const connectConfig: ConnectConfig = {
                sock: this.tunnelStream, // Use tunnel stream instead of host/port
                username: this.credentials.username,
                readyTimeout: this.timeout,
                algorithms: this.getOptimizedAlgorithms()[0]
            };

            // Configure target device authentication
            if (this.credentials.authMethod === 'privateKey') {
                connectConfig.privateKey = this.credentials.privateKey;
                if (this.credentials.passphrase) {
                    connectConfig.passphrase = this.credentials.passphrase;
                }
                connectConfig.tryKeyboard = false;
            } else {
                connectConfig.password = this.credentials.password;
            }

            // Connect through tunnel
            this.client.connect(connectConfig);

            this.client.once('ready', () => {
                Logger.info('Target connection established through tunnel', {
                    target: this.credentials.host,
                    jumpHost: this.jumpHostConfig.host
                });
                resolve();
            });

            this.client.once('error', (error) => {
                Logger.error('Target connection failed through tunnel', {
                    target: this.credentials.host,
                    jumpHost: this.jumpHostConfig.host,
                    error: error.message
                });
                reject(error);
            });
        });
    }

    async disconnect(): Promise<void> {
        Logger.debug('Disconnecting jump host connection', {
            jumpHost: this.jumpHostConfig.host,
            target: this.credentials.host
        });

        await super.disconnect();
        await this.cleanup();
    }

    private async cleanup(): Promise<void> {
        Logger.debug('Cleaning up jump host resources', {
            jumpHost: this.jumpHostConfig.host,
            target: this.credentials.host
        });

        // Close tunnel stream
        if (this.tunnelStream) {
            this.tunnelStream.end();
            this.tunnelStream = null;
        }

        // Close jump host connection
        if (this.jumpHostClient && this.jumpHostConnected) {
            this.jumpHostClient.end();
            this.jumpHostConnected = false;
        }
    }

    // Override to provide jump host specific info
    getConnectionInfo(): { host: string; port: number; deviceType: string; connected: boolean; jumpHost?: string } {
        const baseInfo = super.getConnectionInfo();
        return {
            ...baseInfo,
            jumpHost: this.jumpHostConfig.host
        };
    }
} 