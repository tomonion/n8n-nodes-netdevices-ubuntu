import { Client, ConnectConfig } from 'ssh2';
import { BaseConnection, DeviceCredentials } from './base-connection';

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
    private tunnelStream: any;
    private jumpHostConnected: boolean = false;

    constructor(credentials: DeviceCredentials) {
        super(credentials);
        this.jumpHostClient = new Client();
        this.setupJumpHostEventHandlers();
    }

    private setupJumpHostEventHandlers(): void {
        this.jumpHostClient.on('error', (error) => {
            Logger.error('Jump host connection error', {
                jumpHost: this.credentials.jumpHostHost,
                error: error.message
            });
        });

        this.jumpHostClient.on('end', () => {
            Logger.info('Jump host connection ended', {
                jumpHost: this.credentials.jumpHostHost
            });
            this.jumpHostConnected = false;
        });

        this.jumpHostClient.on('close', () => {
            Logger.info('Jump host connection closed', {
                jumpHost: this.credentials.jumpHostHost
            });
            this.jumpHostConnected = false;
        });
    }

    async connect(): Promise<void> {
        Logger.debug('Starting jump host connection process', {
            jumpHost: this.credentials.jumpHostHost,
            target: this.credentials.host,
            jumpHostAuthMethod: this.credentials.jumpHostAuthMethod,
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
                jumpHost: this.credentials.jumpHostHost,
                target: this.credentials.host
            });

        } catch (error) {
            Logger.error('Jump host connection failed', {
                jumpHost: this.credentials.jumpHostHost,
                target: this.credentials.host,
                error: error instanceof Error ? error.message : String(error)
            });
            await this.cleanup();
            throw error;
        }
    }

    private async connectToJumpHost(): Promise<void> {
        return new Promise((resolve, reject) => {
            Logger.debug('Preparing jump host SSH connection configuration', {
                jumpHost: this.credentials.jumpHostHost,
                port: this.credentials.jumpHostPort,
                username: this.credentials.jumpHostUsername,
                connectionTimeout: this.timeout,
                authMethod: this.credentials.jumpHostAuthMethod,
                hasPrivateKey: !!this.credentials.jumpHostPrivateKey,
                hasPassphrase: !!this.credentials.jumpHostPassphrase,
                hasPassword: !!this.credentials.jumpHostPassword
            });

            const connectConfig: ConnectConfig = {
                host: this.credentials.jumpHostHost!,
                port: this.credentials.jumpHostPort!,
                username: this.credentials.jumpHostUsername!,
                readyTimeout: this.timeout,
                algorithms: this.getOptimizedAlgorithms()[0] // Use first algorithm set
            };

            // Configure jump host authentication
            if (this.credentials.jumpHostAuthMethod === 'privateKey') {
                if (!this.credentials.jumpHostPrivateKey) {
                    Logger.error('Jump host SSH private key is missing for private key authentication');
                    reject(new Error('Jump host SSH private key is required for private key authentication'));
                    return;
                }
                
                // Validate private key format
                if (!this.credentials.jumpHostPrivateKey.includes('-----BEGIN') || 
                    !this.credentials.jumpHostPrivateKey.includes('-----END')) {
                    Logger.error('Jump host private key format is invalid', {
                        keyLength: this.credentials.jumpHostPrivateKey.length,
                        hasBeginMarker: this.credentials.jumpHostPrivateKey.includes('-----BEGIN'),
                        hasEndMarker: this.credentials.jumpHostPrivateKey.includes('-----END')
                    });
                    reject(new Error('Jump host SSH private key must be in PEM format (include -----BEGIN and -----END markers)'));
                    return;
                }
                
                connectConfig.privateKey = this.credentials.jumpHostPrivateKey;
                
                // Handle passphrase - only add if it's not empty
                if (this.credentials.jumpHostPassphrase && this.credentials.jumpHostPassphrase.trim() !== '') {
                    connectConfig.passphrase = this.credentials.jumpHostPassphrase;
                    Logger.debug('Using passphrase for jump host private key', {
                        passphraseLength: this.credentials.jumpHostPassphrase.length
                    });
                } else {
                    Logger.debug('No passphrase provided for jump host private key');
                }
                
                connectConfig.tryKeyboard = false;
                
                Logger.debug('Configured jump host SSH private key authentication', {
                    keyLength: this.credentials.jumpHostPrivateKey.length,
                    hasPassphrase: !!connectConfig.passphrase,
                    tryKeyboard: connectConfig.tryKeyboard
                });
            } else {
                if (!this.credentials.jumpHostPassword) {
                    Logger.error('Jump host password is missing for password authentication');
                    reject(new Error('Jump host password is required for password authentication'));
                    return;
                }
                connectConfig.password = this.credentials.jumpHostPassword;
                
                Logger.debug('Configured jump host SSH password authentication', {
                    passwordLength: this.credentials.jumpHostPassword.length
                });
            }

            Logger.debug('Connecting to jump host', {
                jumpHost: this.credentials.jumpHostHost,
                port: this.credentials.jumpHostPort,
                username: this.credentials.jumpHostUsername,
                authMethod: this.credentials.jumpHostAuthMethod
            });

            this.jumpHostClient.connect(connectConfig);

            this.jumpHostClient.once('ready', () => {
                Logger.info('Jump host connection established', {
                    jumpHost: this.credentials.jumpHostHost,
                    username: this.credentials.jumpHostUsername
                });
                this.jumpHostConnected = true;
                resolve();
            });

            this.jumpHostClient.once('error', (error) => {
                Logger.error('Jump host connection failed', {
                    jumpHost: this.credentials.jumpHostHost,
                    error: error.message,
                    authMethod: this.credentials.jumpHostAuthMethod
                });
                reject(error);
            });
        });
    }

    private async createOutboundTunnel(): Promise<void> {
        return new Promise((resolve, reject) => {
            Logger.debug('Creating outbound tunnel', {
                jumpHost: this.credentials.jumpHostHost,
                target: `${this.credentials.host}:${this.credentials.port}`
            });

            // Create tunnel from jump host to target device
            this.jumpHostClient.forwardOut(
                '127.0.0.1', 0, // Source address and port
                this.credentials.host, this.credentials.port, // Target address and port
                (err, stream) => {
                    if (err) {
                        Logger.error('Tunnel creation failed', {
                            jumpHost: this.credentials.jumpHostHost,
                            target: `${this.credentials.host}:${this.credentials.port}`,
                            error: err.message
                        });
                        reject(err);
                        return;
                    }

                    this.tunnelStream = stream;
                    Logger.info('Outbound tunnel created successfully', {
                        jumpHost: this.credentials.jumpHostHost,
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
                Logger.info('Target device connection established through jump host', {
                    target: this.credentials.host,
                    username: this.credentials.username
                });
                this.isConnected = true;
                resolve();
            });

            this.client.once('error', (error) => {
                Logger.error('Target device connection through jump host failed', {
                    target: this.credentials.host,
                    error: error.message
                });
                reject(error);
            });
        });
    }

    async disconnect(): Promise<void> {
        Logger.debug('Disconnecting jump host connection', {
            jumpHost: this.credentials.jumpHostHost,
            target: this.credentials.host
        });

        await super.disconnect();
        await this.cleanup();
    }

    private async cleanup(): Promise<void> {
        Logger.debug('Cleaning up jump host resources', {
            jumpHost: this.credentials.jumpHostHost,
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
            jumpHost: this.credentials.jumpHostHost
        };
    }
} 