import { Client, ConnectConfig } from 'ssh2';
import { BaseConnection, DeviceCredentials, formatSSHPrivateKey, validateSSHPrivateKey } from './base-connection';

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
        this.setupTargetConnectionEventHandlers();
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

    private setupTargetConnectionEventHandlers(): void {
        // Override the base class event handlers to prevent premature disconnection
        this.client.removeAllListeners();
        
        this.client.on('ready', () => {
            Logger.debug('Target connection ready through jump host', {
                target: this.credentials.host,
                jumpHost: this.credentials.jumpHostHost
            });
            this.isConnected = true;
            this.lastActivity = Date.now();
            this.emit('ready');
        });

        this.client.on('error', (error) => {
            Logger.error('Target connection error through jump host', {
                target: this.credentials.host,
                jumpHost: this.credentials.jumpHostHost,
                error: error.message
            });
            this.isConnected = false;
            this.emit('error', error);
        });

        this.client.on('end', () => {
            Logger.debug('Target connection ended through jump host', {
                target: this.credentials.host,
                jumpHost: this.credentials.jumpHostHost
            });
            this.isConnected = false;
            this.emit('end');
        });

        this.client.on('close', () => {
            Logger.debug('Target connection closed through jump host', {
                target: this.credentials.host,
                jumpHost: this.credentials.jumpHostHost
            });
            this.isConnected = false;
            this.emit('close');
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

            // Use the same algorithm selection logic as base connection
            const algorithms = this.getOptimizedAlgorithms();
            Logger.debug('Trying jump host SSH connection with algorithm configurations', {
                algorithmCount: algorithms.length,
                authMethod: this.credentials.jumpHostAuthMethod
            });

            // Try each algorithm configuration
            let lastError: Error | null = null;
            let algorithmIndex = 0;

            const tryNextAlgorithm = () => {
                if (algorithmIndex >= algorithms.length) {
                    Logger.error('All jump host SSH algorithm configurations failed', {
                        jumpHost: this.credentials.jumpHostHost,
                        authMethod: this.credentials.jumpHostAuthMethod,
                        lastError: lastError?.message
                    });
                    reject(lastError || new Error('All SSH algorithm configurations failed'));
                    return;
                }

                const currentAlgorithms = algorithms[algorithmIndex];
                Logger.debug('Attempting jump host connection with algorithm config', {
                    algorithmIndex: algorithmIndex + 1,
                    total: algorithms.length,
                    algorithms: currentAlgorithms
                });

                this.tryJumpHostConnectWithConfig(currentAlgorithms)
                    .then(() => {
                        Logger.info('Jump host connection established with algorithm config', {
                            algorithmIndex: algorithmIndex + 1,
                            jumpHost: this.credentials.jumpHostHost
                        });
                        resolve();
                    })
                    .catch((error) => {
                        lastError = error;
                        algorithmIndex++;
                        Logger.warn('Jump host connection failed with algorithm config', {
                            algorithmIndex: algorithmIndex,
                            jumpHost: this.credentials.jumpHostHost,
                            error: error.message
                        });
                        // Try next algorithm configuration
                        setTimeout(tryNextAlgorithm, 100);
                    });
            };

            tryNextAlgorithm();
        });
    }

    private async tryJumpHostConnectWithConfig(algorithms: any): Promise<void> {
        return new Promise((resolve, reject) => {
            const connectConfig: ConnectConfig = {
                host: this.credentials.jumpHostHost!,
                port: this.credentials.jumpHostPort!,
                username: this.credentials.jumpHostUsername!,
                readyTimeout: this.timeout,
                algorithms: algorithms
            };

            // Configure jump host authentication
            if (this.credentials.jumpHostAuthMethod === 'privateKey') {
                if (!this.credentials.jumpHostPrivateKey) {
                    Logger.error('Jump host SSH private key is missing for private key authentication');
                    reject(new Error('Jump host SSH private key is required for private key authentication'));
                    return;
                }
                
                try {
                    // Validate and format the jump host private key
                    validateSSHPrivateKey(this.credentials.jumpHostPrivateKey);
                    let normalizedKey = formatSSHPrivateKey(this.credentials.jumpHostPrivateKey);
                    
                    Logger.debug('Jump host private key validation and formatting successful', {
                        originalLength: this.credentials.jumpHostPrivateKey.length,
                        formattedLength: normalizedKey.length,
                        hasBeginMarker: normalizedKey.includes('-----BEGIN'),
                        hasEndMarker: normalizedKey.includes('-----END')
                    });
                    
                    // Additional debugging for ssh2 compatibility
                    const keyLines = normalizedKey.split('\n');
                    Logger.debug('Jump host private key format details', {
                        totalLines: keyLines.length,
                        firstLine: keyLines[0]?.substring(0, 50),
                        lastLine: keyLines[keyLines.length - 1]?.substring(0, 50),
                        hasEmptyLines: keyLines.some(line => line.trim() === ''),
                        lineLengths: keyLines.map(line => line.length).slice(0, 5)
                    });
                    
                    // Try to detect and fix common ssh2 compatibility issues
                    if (normalizedKey.includes('-----BEGIN OPENSSH PRIVATE KEY-----')) {
                        // OpenSSH keys sometimes need special handling
                        Logger.debug('Detected OpenSSH format key, ensuring proper formatting');
                        // Ensure no extra whitespace in OpenSSH keys
                        normalizedKey = normalizedKey.replace(/\n\s*\n/g, '\n').trim() + '\n';
                    } else if (normalizedKey.includes('-----BEGIN RSA PRIVATE KEY-----')) {
                        // RSA keys need proper line wrapping
                        Logger.debug('Detected RSA format key, ensuring proper line wrapping');
                        
                        // Check if this is a single-line key that needs to be properly formatted
                        const lines = normalizedKey.split('\n');
                        if (lines.length === 1) {
                            // Single line key - need to extract and reformat
                            const keyContent = normalizedKey;
                            const beginMatch = keyContent.match(/-----BEGIN RSA PRIVATE KEY-----(.*)-----END RSA PRIVATE KEY-----/);
                            if (beginMatch) {
                                const content = beginMatch[1].trim().replace(/\s/g, '');
                                // Re-wrap content in 64-character lines
                                const wrappedContent = content.match(/.{1,64}/g)?.join('\n') || content;
                                normalizedKey = `-----BEGIN RSA PRIVATE KEY-----\n${wrappedContent}\n-----END RSA PRIVATE KEY-----`;
                                
                                Logger.debug('Reformatted single-line RSA key', {
                                    originalLength: keyContent.length,
                                    newLength: normalizedKey.length,
                                    contentLines: wrappedContent.split('\n').length
                                });
                            }
                        } else {
                            // Multi-line key - check if it needs rewrapping
                            const header = lines[0];
                            const footer = lines[lines.length - 1];
                            const content = lines.slice(1, -1).join('').replace(/\s/g, '');
                            
                            // Re-wrap content in 64-character lines
                            const wrappedContent = content.match(/.{1,64}/g)?.join('\n') || content;
                            normalizedKey = `${header}\n${wrappedContent}\n${footer}`;
                        }
                    }
                    
                    connectConfig.privateKey = normalizedKey;
                } catch (keyError) {
                    Logger.error('Jump host private key validation failed', {
                        error: keyError instanceof Error ? keyError.message : String(keyError),
                        keyLength: this.credentials.jumpHostPrivateKey.length,
                        hasBeginMarker: this.credentials.jumpHostPrivateKey.includes('-----BEGIN'),
                        hasEndMarker: this.credentials.jumpHostPrivateKey.includes('-----END')
                    });
                    reject(new Error(`Jump host SSH private key validation failed: ${keyError instanceof Error ? keyError.message : String(keyError)}`));
                    return;
                }
                
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

            try {
                this.jumpHostClient.connect(connectConfig);
            } catch (error) {
                Logger.error('Failed to initiate jump host SSH connection', {
                    error: error instanceof Error ? error.message : String(error),
                    errorStack: error instanceof Error ? error.stack : undefined,
                    jumpHost: this.credentials.jumpHostHost,
                    port: this.credentials.jumpHostPort,
                    authMethod: this.credentials.jumpHostAuthMethod,
                    connectConfigKeys: Object.keys(connectConfig).filter(key => key !== 'privateKey' && key !== 'password' && key !== 'passphrase')
                });
                reject(error);
                return;
            }

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
                    errorStack: error.stack,
                    authMethod: this.credentials.jumpHostAuthMethod,
                    errorLevel: (error as any).level,
                    errorDescription: (error as any).description
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

            // Set up timeout for the connection
            const timeoutId = setTimeout(() => {
                Logger.error('Target connection timeout through tunnel', {
                    target: this.credentials.host,
                    timeout: this.timeout
                });
                reject(new Error(`Target connection timeout after ${this.timeout}ms`));
            }, this.timeout);

            // Connect through tunnel
            this.client.once('ready', () => {
                clearTimeout(timeoutId);
                Logger.info('Target device connection established through jump host', {
                    target: this.credentials.host,
                    username: this.credentials.username
                });
                
                // Ensure the connection state is properly set
                this.isConnected = true;
                this.lastActivity = Date.now();
                
                Logger.debug('Connection state after tunnel connection', {
                    isConnected: this.isConnected,
                    jumpHostConnected: this.jumpHostConnected,
                    target: this.credentials.host,
                    jumpHost: this.credentials.jumpHostHost
                });
                
                resolve();
            });

            this.client.once('error', (error) => {
                clearTimeout(timeoutId);
                Logger.error('Target device connection through jump host failed', {
                    target: this.credentials.host,
                    error: error.message,
                    errorStack: error.stack
                });
                reject(error);
            });

            try {
                this.client.connect(connectConfig);
            } catch (error) {
                clearTimeout(timeoutId);
                Logger.error('Failed to initiate target connection through tunnel', {
                    error: error instanceof Error ? error.message : String(error),
                    target: this.credentials.host
                });
                reject(error);
            }
        });
    }

    // Override the isConnected check to ensure both jump host and target are connected
    public isConnectedAndReady(): boolean {
        // More flexible connection check - prioritize basic connection state
        const basicConnected = this.isConnected && this.jumpHostConnected;
        const tunnelOk = this.tunnelStream && !this.tunnelStream.destroyed && 
                         this.tunnelStream.readable && this.tunnelStream.writable;
        
        // For debugging: log detailed state
        Logger.debug('Jump host connection status check', {
            isConnected: this.isConnected,
            jumpHostConnected: this.jumpHostConnected,
            hasTunnel: !!this.tunnelStream,
            tunnelDestroyed: this.tunnelStream ? this.tunnelStream.destroyed : 'no-tunnel',
            tunnelReadable: this.tunnelStream ? this.tunnelStream.readable : 'no-tunnel',
            tunnelWritable: this.tunnelStream ? this.tunnelStream.writable : 'no-tunnel',
            basicConnected: basicConnected,
            tunnelOk: tunnelOk,
            target: this.credentials.host,
            jumpHost: this.credentials.jumpHostHost,
            deviceType: this.credentials.deviceType
        });
        
        // For Linux devices, basic connection is sufficient (uses exec)
        // For network devices like NX-OS, we need both basic connection and active tunnel
        if (this.isLinuxDevice()) {
            return basicConnected;
        } else {
            return basicConnected && tunnelOk;
        }
    }

    // Check if this is a Linux device
    private isLinuxDevice(): boolean {
        return this.credentials.deviceType.toLowerCase() === 'linux';
    }

    // Override sendCommand to use appropriate method for device type
    async sendCommand(command: string): Promise<any> {
        // Enhanced connection check - verify tunnel is still active
        const tunnelIsActive = this.tunnelStream && !this.tunnelStream.destroyed && 
                              this.tunnelStream.readable && this.tunnelStream.writable;
        
        if (!this.isConnected || !this.jumpHostConnected || !tunnelIsActive) {
            const error = `Not connected to device. Connected states: target=${this.isConnected}, jumpHost=${this.jumpHostConnected}, tunnelActive=${tunnelIsActive}`;
            Logger.error('Jump host sendCommand failed - connection check', {
                isConnected: this.isConnected,
                jumpHostConnected: this.jumpHostConnected,
                tunnelActive: tunnelIsActive,
                target: this.credentials.host,
                jumpHost: this.credentials.jumpHostHost,
                deviceType: this.credentials.deviceType
            });
            throw new Error(error);
        }
        
        Logger.debug('Executing command through jump host', {
            command,
            target: this.credentials.host,
            jumpHost: this.credentials.jumpHostHost,
            deviceType: this.credentials.deviceType,
            isLinux: this.isLinuxDevice(),
            connectionStatus: this.isConnectedAndReady()
        });
        
        // For Linux devices, use exec() method instead of shell interaction
        if (this.isLinuxDevice()) {
            return await this.sendLinuxCommand(command);
        }
        
        // For Cisco NX-OS devices, use enhanced shell-based approach with longer timeout
        if (this.credentials.deviceType === 'cisco_nxos') {
            return await this.sendNxosCommand(command);
        }
        
        // For other devices, use the standard shell-based approach
        return await super.sendCommand(command);
    }

    // Linux-specific command execution through jump host
    private async sendLinuxCommand(command: string): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.client) {
                const err = new Error('SSH client not available for command execution');
                Logger.error('sendLinuxCommand: ' + err.message, {
                    target: this.credentials.host,
                    jumpHost: this.credentials.jumpHostHost
                });
                return reject(err);
            }

            Logger.debug('Executing Linux command via client.exec() through jump host', { 
                command,
                target: this.credentials.host,
                jumpHost: this.credentials.jumpHostHost
            });

            let output = '';
            let errorOutput = '';
            let streamClosed = false;
            let timeoutId: NodeJS.Timeout;

            const cleanup = () => {
                if (timeoutId) clearTimeout(timeoutId);
            };

            this.client.exec(command, (err, stream) => {
                if (err) {
                    Logger.error('sendLinuxCommand: Failed to execute command through jump host', { 
                        command, 
                        error: err.message,
                        target: this.credentials.host,
                        jumpHost: this.credentials.jumpHostHost
                    });
                    cleanup();
                    return reject(err);
                }

                timeoutId = setTimeout(() => {
                    const msg = `sendLinuxCommand: Command timeout after ${this.commandTimeout}ms`;
                    Logger.error(msg, { 
                        command,
                        target: this.credentials.host,
                        jumpHost: this.credentials.jumpHostHost
                    });
                    cleanup();
                    stream.close();
                    reject(new Error(msg));
                }, this.commandTimeout);

                stream.on('data', (data: Buffer) => {
                    const chunk = data.toString('utf8');
                    output += chunk;
                    Logger.debug('sendLinuxCommand: stdout data received through jump host', { 
                        command, 
                        length: chunk.length,
                        target: this.credentials.host
                    });
                });

                stream.stderr.on('data', (data: Buffer) => {
                    const chunk = data.toString('utf8');
                    errorOutput += chunk;
                    Logger.warn('sendLinuxCommand: stderr data received through jump host', { 
                        command, 
                        length: chunk.length,
                        target: this.credentials.host
                    });
                });

                stream.on('close', (code: number, signal: string) => {
                    if (streamClosed) return;
                    streamClosed = true;

                    Logger.debug('sendLinuxCommand: stream closed through jump host', { 
                        command, 
                        code, 
                        signal,
                        target: this.credentials.host,
                        jumpHost: this.credentials.jumpHostHost
                    });
                    cleanup();

                    // Update activity timestamp
                    this.lastActivity = Date.now();

                    if (errorOutput && !output) {
                        // If there's only stderr, treat it as an error
                        resolve({
                            command,
                            output: this.stripAnsi(errorOutput).trim(),
                            success: false,
                            error: `Command failed with exit code ${code || 'N/A'}`
                        });
                    } else {
                        // Otherwise, return stdout (and stderr if present)
                        const fullOutput = errorOutput ? `${output}\n--- STDERR ---\n${errorOutput}` : output;
                        resolve({
                            command,
                            output: this.stripAnsi(fullOutput).trim(),
                            success: code === 0,
                            error: code !== 0 ? `Command failed with exit code ${code || 'N/A'}` : undefined
                        });
                    }
                });

                stream.on('error', (streamErr: Error) => {
                    Logger.error('sendLinuxCommand: stream error through jump host', { 
                        command, 
                        error: streamErr.message,
                        target: this.credentials.host,
                        jumpHost: this.credentials.jumpHostHost
                    });
                    cleanup();
                    reject(streamErr);
                });
            });
        });
    }

    // NX-OS specific command execution through jump host with enhanced timeout handling
    private async sendNxosCommand(command: string): Promise<any> {
        try {
            if (!this.isConnected || !this.currentChannel) {
                throw new Error('Not connected to device');
            }

            Logger.debug('Executing NX-OS command through jump host', {
                command,
                target: this.credentials.host,
                jumpHost: this.credentials.jumpHostHost,
                deviceType: this.credentials.deviceType
            });

            // Send the command
            await this.writeChannel(command + this.newline);
            
            // Use longer timeout for NX-OS commands through jump host (15 seconds)
            const timeout = this.fastMode ? 10000 : 15000;
            
            // Wait for response with NX-OS-specific timeout
            const output = await this.readUntilPrompt(undefined, timeout);
            
            // Clean up the output
            const cleanOutput = this.sanitizeOutput(output, command);

            return {
                command,
                output: cleanOutput,
                success: true
            };

        } catch (error) {
            Logger.error('NX-OS command execution failed through jump host', {
                command,
                target: this.credentials.host,
                jumpHost: this.credentials.jumpHostHost,
                error: error instanceof Error ? error.message : String(error)
            });
            
            return {
                command,
                output: '',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    // Helper method to strip ANSI escape codes (copied from LinuxConnection)
    private stripAnsi(str: string): string {
        return str.replace(/[\u001b\u009b][[()#;?]*.{0,2}(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
    }

    async disconnect(): Promise<void> {
        Logger.debug('Disconnecting jump host connection', {
            jumpHost: this.credentials.jumpHostHost,
            target: this.credentials.host,
            isConnected: this.isConnected,
            jumpHostConnected: this.jumpHostConnected
        });

        // Don't call super.disconnect() until we clean up our resources
        // This prevents premature cleanup of the tunnel
        await this.cleanup();
        await super.disconnect();
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

    // Override to use jump host authentication method for algorithm selection
    protected getOptimizedAlgorithms(): any[] {
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
            // Optimized algorithms for SSH key authentication
            const keyBasedAlgorithms = {
                serverHostKey: [
                    'ssh-rsa', 'rsa-sha2-256', 'rsa-sha2-512',
                    'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521',
                    'ssh-ed25519'
                ],
                cipher: [
                    'aes128-ctr', 'aes192-ctr', 'aes256-ctr',
                    'aes128-gcm@openssh.com', 'aes256-gcm@openssh.com',
                    'aes128-cbc', 'aes192-cbc'
                ],
                hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1'],
                kex: [
                    'curve25519-sha256', 'curve25519-sha256@libssh.org',
                    'diffie-hellman-group16-sha512', 'diffie-hellman-group18-sha512',
                    'diffie-hellman-group14-sha256', 'ecdh-sha2-nistp256',
                    'diffie-hellman-group14-sha1'
                ]
            };

            // Password-based algorithms (more conservative)
            const passwordBasedAlgorithms = {
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
            };

            // Choose algorithm set based on jump host authentication method
            const primaryAlgorithms = this.credentials.jumpHostAuthMethod === 'privateKey' 
                ? keyBasedAlgorithms 
                : passwordBasedAlgorithms;

            return [
                primaryAlgorithms,
                // Fallback for older systems
                {
                    serverHostKey: ['ssh-rsa'],
                    cipher: ['aes128-cbc'],
                    hmac: ['hmac-sha1'],
                    kex: ['diffie-hellman-group1-sha1']
                }
            ];
        }
    }
} 