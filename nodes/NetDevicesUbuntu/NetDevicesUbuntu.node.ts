import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

import { NodeOperationError } from 'n8n-workflow';
import { ConnectHandler, CommandResult } from './utils/index';

// Add logging support
let Logger: any;
try {
    // Try to import n8n's LoggerProxy for proper logging
    const { LoggerProxy } = require('n8n-workflow');
    Logger = LoggerProxy;
} catch (error) {
    // Fallback to console logging if n8n LoggerProxy is not available
    Logger = {
        debug: console.log,
        info: console.log,
        warn: console.warn,
        error: console.error
    };
}

export class NetDevicesUbuntu implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Net Devices Ubuntu',
		name: 'netDevicesUbuntu', // unique
		icon: 'file:ubuntu_red_variant.svg',
		group: ['transform'],
		version: 1,
		description: 'Manage network devices via SSH from N8N on Ubuntu Base Image',
		defaults: { name: 'Net Devices Ubuntu' },
		usableAsTool: true,
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				displayName: 'Net Devices Ubuntu API',
				name: 'netDevicesUbuntuApi', // <-- must match credential
				required: true,
            }
        ],
        
        properties: [
            // Required properties
            {
                displayName: 'Operation',
                name: 'operation',
                type: 'options',
                noDataExpression: true,
                required: true,
                options: [
					{
						name: 'Get Running Config',
						value: 'getRunningConfig',
						description: 'Get the current running configuration',
						action: 'Get the current running configuration',
					},
					{
						name: 'Reboot Device',
						value: 'rebootDevice',
						description: 'Reboot the network device',
						action: 'Reboot the network device',
					},
					{
						name: 'Save Config',
						value: 'saveConfig',
						description: 'Save the current configuration',
						action: 'Save the current configuration',
					},
					{
						name: 'Send Command',
						value: 'sendCommand',
						description: 'Send a command to the device and get the response',
						action: 'Send a command to the device',
					},
					{
						name: 'Send Config',
						value: 'sendConfig',
						description: 'Send configuration commands to the device',
						action: 'Send configuration commands to the device',
					},
				],
				default: 'sendCommand',
            },
			// ----------------------------------
			//         Send Command Options
			// ----------------------------------
			{
				displayName: 'Command',
				name: 'command',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['sendCommand'],
					},
				},
				description: 'The command to send to the device',
				placeholder: 'show version',
			},
			// ----------------------------------
			//         Send Config Options
			// ----------------------------------
			{
				displayName: 'Configuration Commands',
				name: 'configCommands',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['sendConfig'],
					},
				},
				description: 'Configuration commands to send (one per line)',
				placeholder: 'interface GigabitEthernet1/0/1\ndescription Test Interface\nno shutdown',
				typeOptions: {
					rows: 5,
				},
			},
			// ----------------------------------
			//         Advanced Options
			// ----------------------------------
			{
				displayName: 'Advanced Options',
				name: 'advancedOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Auto Disconnect',
						name: 'autoDisconnect',
						type: 'boolean',
						default: true,
						description: 'Whether to automatically disconnect after command execution',
					},
					{
						displayName: 'Command Retry Count',
						name: 'commandRetryCount',
						type: 'number',
						default: 2,
						description: 'Number of retry attempts for command failures',
						typeOptions: {
							minValue: 1,
							maxValue: 5,
						},
					},
					{
						displayName: 'Command Timeout',
						name: 'commandTimeout',
						type: 'number',
						default: 10,
						description: 'Timeout for command execution in seconds',
						typeOptions: {
							minValue: 2,
							maxValue: 300,
						},
					},
					{
						displayName: 'Connection Pooling',
						name: 'connectionPooling',
						type: 'boolean',
						default: false,
						description: 'Whether to enable connection pooling for better performance',
					},
					{
						displayName: 'Connection Retry Count',
						name: 'connectionRetryCount',
						type: 'number',
						default: 3,
						description: 'Number of retry attempts for connection failures',
						typeOptions: {
							minValue: 1,
							maxValue: 10,
						},
					},
					{
						displayName: 'Connection Timeout',
						name: 'connectionTimeout',
						type: 'number',
						default: 15,
						description: 'Timeout for establishing connection in seconds',
						typeOptions: {
							minValue: 3,
							maxValue: 300,
						},
					},
					{
						displayName: 'Fail on Error',
						name: 'failOnError',
						type: 'boolean',
						default: true,
						description: 'Whether to fail the workflow on command errors',
					},
					{
						displayName: 'Fast Mode',
						name: 'fastMode',
						type: 'boolean',
						default: false,
						description: 'Whether to enable fast mode for simple commands (skips setup steps)',
					},
					{
						displayName: 'Retry Delay',
						name: 'retryDelay',
						type: 'number',
						default: 2,
						description: 'Delay between retry attempts in seconds',
						typeOptions: {
							minValue: 1,
							maxValue: 60,
						},
					},
					{
						displayName: 'Reuse Connection',
						name: 'reuseConnection',
						type: 'boolean',
						default: false,
						description: 'Whether to reuse existing connections when possible',
					},
				],
			},
        ]
    }

async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    const credentials = await this.getCredentials('netDevicesUbuntuApi');
    const operation = this.getNodeParameter('operation', 0);

    Logger.debug('NetDevices node execution started', {
        operation,
        itemCount: items.length,
        host: credentials.host,
        username: credentials.username,
        authMethod: credentials.authMethod,
        deviceType: credentials.deviceType,
        hasPassword: !!credentials.password,
        hasPrivateKey: !!credentials.privateKey,
        hasPassphrase: !!credentials.passphrase,
        passphraseValue: credentials.passphrase ? `"${credentials.passphrase}"` : 'undefined',
        passphraseLength: credentials.passphrase ? String(credentials.passphrase).length : 0
    });

    for (let i = 0; i < items.length; i++) {
        const startTime = Date.now();
        let connection: any = null;
        
        // Get advanced options with improved defaults
        const advancedOptions = this.getNodeParameter('advancedOptions', i, {}) as IDataObject;
        const autoDisconnect = (advancedOptions.autoDisconnect as boolean) !== false;
        const connectionRetryCount = Math.max(1, (advancedOptions.connectionRetryCount as number) || 3);
        const commandRetryCount = Math.max(1, (advancedOptions.commandRetryCount as number) || 2);
        const retryDelay = Math.max(1, (advancedOptions.retryDelay as number) || 2) * 1000;
        const connectionTimeout = Math.max(5, (advancedOptions.connectionTimeout as number) || 15) * 1000;
        const commandTimeout = Math.max(5, (advancedOptions.commandTimeout as number) || 10) * 1000;
        const failOnError = (advancedOptions.failOnError as boolean) !== false;
        const fastMode = (advancedOptions.fastMode as boolean) || false;
        const connectionPooling = (advancedOptions.connectionPooling as boolean) || false;
        const reuseConnection = (advancedOptions.reuseConnection as boolean) || false;

        Logger.debug('Processing item with advanced options', {
            itemIndex: i,
            operation,
            autoDisconnect,
            connectionRetryCount,
            commandRetryCount,
            connectionTimeout: connectionTimeout / 1000,
            commandTimeout: commandTimeout / 1000,
            fastMode,
            connectionPooling,
            reuseConnection
        });
        
        // Configure device credentials with optimization options
        const deviceCredentials: any = {
            host: credentials.host as string,
            port: credentials.port as number,
            username: credentials.username as string,
            authMethod: credentials.authMethod as 'password' | 'privateKey',
            deviceType: credentials.deviceType as string,
            timeout: connectionTimeout / 1000,
            keepAlive: true,
            fastMode: fastMode,
            commandTimeout: commandTimeout,
            connectionPooling: connectionPooling,
            reuseConnection: reuseConnection,
        };

        // Add authentication-specific fields based on method
        if (deviceCredentials.authMethod === 'privateKey') {
            deviceCredentials.privateKey = credentials.privateKey as string;
            // Only set passphrase if it's not empty or undefined
            if (credentials.passphrase && String(credentials.passphrase).trim() !== '') {
                deviceCredentials.passphrase = credentials.passphrase as string;
            }
            // Don't set password for key auth
        } else {
            deviceCredentials.password = credentials.password as string;
            // Don't set privateKey or passphrase for password auth
        }

        // Add enable password for Cisco devices
        if (credentials.enablePassword) {
            (deviceCredentials as any).enablePassword = credentials.enablePassword;
        }

        // Add jump host fields if useJumpHost is enabled
        if (credentials.useJumpHost) {
            deviceCredentials.useJumpHost = true;
            deviceCredentials.jumpHostHost = credentials.jumpHostHost;
            deviceCredentials.jumpHostPort = credentials.jumpHostPort;
            deviceCredentials.jumpHostUsername = credentials.jumpHostUsername;
            deviceCredentials.jumpHostAuthMethod = credentials.jumpHostAuthMethod;
            deviceCredentials.jumpHostPassword = credentials.jumpHostPassword;
            deviceCredentials.jumpHostPrivateKey = credentials.jumpHostPrivateKey;
            deviceCredentials.jumpHostPassphrase = credentials.jumpHostPassphrase;
        }

        Logger.debug('Configured device credentials', {
            host: deviceCredentials.host,
            port: deviceCredentials.port,
            username: deviceCredentials.username,
            authMethod: deviceCredentials.authMethod,
            deviceType: deviceCredentials.deviceType,
            hasPassword: !!deviceCredentials.password,
            hasPrivateKey: !!deviceCredentials.privateKey,
            hasPassphrase: !!deviceCredentials.passphrase,
            passphraseLength: deviceCredentials.passphrase ? deviceCredentials.passphrase.length : 0,
            timeout: deviceCredentials.timeout,
            fastMode: deviceCredentials.fastMode,
            connectionPooling: deviceCredentials.connectionPooling,
            reuseConnection: deviceCredentials.reuseConnection
        });

                try {

            // Connection with retry logic and timeout
            let connectionError: Error | null = null;
            
            for (let attempt = 1; attempt <= connectionRetryCount; attempt++) {
                try {
                    connection = ConnectHandler(deviceCredentials);
                    
                    // Add connection timeout wrapper
                    const connectPromise = connection.connect();
                    const timeoutPromise = new Promise<never>((_, reject) => {
                        global.setTimeout(() => {
                            reject(new Error(`Connection timeout after ${connectionTimeout / 1000} seconds`));
                        }, connectionTimeout);
                    });
                    
                    await Promise.race([connectPromise, timeoutPromise]);
                    connectionError = null;
                    break;
                    
                } catch (error) {
                    connectionError = error instanceof Error ? error : new Error(String(error));
                    
                    if (attempt === connectionRetryCount) {
                        throw new NodeOperationError(
                            this.getNode(),
                            `Failed to connect to device ${credentials.host} after ${connectionRetryCount} attempts. Last error: ${connectionError.message}`,
                            { itemIndex: i, description: `Connection attempts: ${attempt}/${connectionRetryCount}` },
                        );
                    }
                    
                    // Wait before retry with exponential backoff
                    const delay = retryDelay * Math.pow(2, attempt - 1);
                    await new Promise<void>(resolve => global.setTimeout(resolve, delay));
                }
            }

            let result: CommandResult;
            let commandError: Error | null = null;

            // Command execution with retry logic and timeout
            for (let attempt = 1; attempt <= commandRetryCount; attempt++) {
                try {
                    // Create command execution promise with timeout
                    const executeCommand = async (): Promise<CommandResult> => {
                        switch (operation) {
                            case 'sendCommand':
                                const command = this.getNodeParameter('command', i) as string;
                                                                 if (!command) {
                                     throw new NodeOperationError(
                                         this.getNode(),
                                         'Command parameter is required for sendCommand operation',
                                         { itemIndex: i },
                                     );
                                 }
                                return await connection.sendCommand(command);

                            case 'sendConfig':
                                const configCommands = this.getNodeParameter('configCommands', i) as string;
                                                                 if (!configCommands) {
                                     throw new NodeOperationError(
                                         this.getNode(),
                                         'Configuration commands are required for sendConfig operation',
                                         { itemIndex: i },
                                     );
                                 }
                                const commands = configCommands.split('\n')
                                    .map(cmd => cmd.trim())
                                    .filter(cmd => cmd.length > 0);
                                return await connection.sendConfig(commands);

                            case 'getRunningConfig':
                                return await connection.getCurrentConfig();

                            case 'saveConfig':
                                return await connection.saveConfig();

                            case 'rebootDevice':
                                return await connection.rebootDevice();

                                                         default:
                                 throw new NodeOperationError(
                                     this.getNode(),
                                     `The operation "${operation}" is not supported!`,
                                     { itemIndex: i },
                                 );
                        }
                    };

                    // Add command timeout wrapper
                    const commandPromise = executeCommand();
                    const timeoutPromise = new Promise<never>((_, reject) => {
                        global.setTimeout(() => {
                            reject(new Error(`Command timeout after ${commandTimeout / 1000} seconds`));
                        }, commandTimeout);
                    });

                    result = await Promise.race([commandPromise, timeoutPromise]);
                    
                    // Check if command was successful
                    if (!result.success) {
                        // If the command failed, but we have the result, break the loop and proceed
                        commandError = new Error(result.error || 'Command execution failed without a specific error');
                        break;
                    }
                    
                    commandError = null;
                    break;
                    
                } catch (error) {
                    commandError = error instanceof Error ? error : new Error(String(error));
                    
                    if (attempt === commandRetryCount) {
                        if (failOnError) {
                            throw new NodeOperationError(
                                this.getNode(),
                                `Command execution failed after ${commandRetryCount} attempts: ${commandError.message}`,
                                { itemIndex: i, description: `Command attempts: ${attempt}/${commandRetryCount}` },
                            );
                        } else {
                            // Return error as data instead of throwing
                            result = {
                                command: operation,
                                output: '',
                                success: false,
                                error: commandError.message,
                            };
                            break;
                        }
                    }
                    
                    // Wait before retry
                    await new Promise<void>(resolve => global.setTimeout(resolve, retryDelay));
                }
            }

            // Prepare the output data
            const executionTime = Date.now() - startTime;
            const outputData: IDataObject = {
                success: result!.success,
                command: result!.command,
                output: result!.output,
                deviceType: connection.getDeviceType(),
                host: connection.getHost(),
                timestamp: new Date().toISOString(),
                executionTime: executionTime,
                connectionRetries: connectionRetryCount,
                commandRetries: commandRetryCount,
            };

            if (!result!.success && result!.error) {
                outputData.error = result!.error;
            }

            const executionData = this.helpers.constructExecutionMetaData(
                this.helpers.returnJsonArray(outputData),
                { itemData: { item: i } },
            );
            returnData.push(...executionData);

        } catch (error) {
            // Ensure we always disconnect on error
            if (connection && autoDisconnect) {
                try {
                    await connection.disconnect();
                } catch (disconnectError) {
                    // Ignore disconnect errors
                }
            }

            if (this.continueOnFail()) {
                const executionTime = Date.now() - startTime;
                const errorData = {
                    error: error instanceof Error ? error.message : 'Unknown error',
                    success: false,
                    timestamp: new Date().toISOString(),
                    executionTime: executionTime,
                    host: credentials.host,
                    operation: operation,
                };
                returnData.push({ json: errorData });
                continue;
            }
            throw error;
        } finally {
            // Only disconnect if autoDisconnect is enabled and we're not reusing the connection
            // This prevents premature disconnection when the connection should remain active
            if (connection && autoDisconnect && !deviceCredentials.reuseConnection) {
                try {
                    await connection.disconnect();
                } catch (disconnectError) {
                    // Ignore disconnect errors during cleanup
                }
            }
        }
    }

    return [returnData];
    }
}