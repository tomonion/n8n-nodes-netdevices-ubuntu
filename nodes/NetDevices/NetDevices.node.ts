import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

import { NodeOperationError } from 'n8n-workflow';
import { ConnectHandler, DeviceCredentials, CommandResult } from './utils';

export class NetDevices implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Net Devices',
        name: 'netDevices',
        icon: 'file:netdevices-icon.svg',
        group: ['transform'],
        version: 1,
        description: 'Manage network devices via SSH',
        defaults: {
            name: 'Net Devices',
        },
        usableAsTool: true,
        inputs: ['main'] as any,
        outputs: ['main'] as any,
        credentials: [
            {
                displayName: 'netDevicesApi',
                name: 'netDevicesApi',
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
						default: 30,
						description: 'Timeout for command execution in seconds',
						typeOptions: {
							minValue: 5,
							maxValue: 300,
						},
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
						default: 30,
						description: 'Timeout for establishing connection in seconds',
						typeOptions: {
							minValue: 5,
							maxValue: 300,
						},
					},
					{
						displayName: 'Fail on Error',
						name: 'failOnError',
						type: 'boolean',
						default: true,
						description: 'Whether to fail the workflow on command errors (if false, errors are returned as data)',
					},
					{
						displayName: 'Retry Delay',
						name: 'retryDelay',
						type: 'number',
						default: 2,
						description: 'Delay between retry attempts in seconds',
						typeOptions: {
							minValue: 1,
							maxValue: 30,
						},
					},
				],
			},
        ]
    }

async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    const credentials = await this.getCredentials('netDevicesApi');
    const operation = this.getNodeParameter('operation', 0);

    for (let i = 0; i < items.length; i++) {
        const startTime = Date.now();
        let connection: any = null;
        
        // Get advanced options with improved defaults
        const advancedOptions = this.getNodeParameter('advancedOptions', i, {}) as IDataObject;
        const autoDisconnect = (advancedOptions.autoDisconnect as boolean) !== false;
        const connectionRetryCount = Math.max(1, (advancedOptions.connectionRetryCount as number) || 3);
        const commandRetryCount = Math.max(1, (advancedOptions.commandRetryCount as number) || 2);
        const retryDelay = Math.max(1, (advancedOptions.retryDelay as number) || 2) * 1000;
        const connectionTimeout = Math.max(5, (advancedOptions.connectionTimeout as number) || 30) * 1000;
        const commandTimeout = Math.max(5, (advancedOptions.commandTimeout as number) || 30) * 1000;
        const failOnError = (advancedOptions.failOnError as boolean) !== false;
        
        try {

            // Prepare device credentials with proper timeout
            const deviceCredentials: DeviceCredentials = {
                host: credentials.host as string,
                port: credentials.port as number,
                username: credentials.username as string,
                authMethod: (credentials.authMethod as 'password' | 'privateKey') || 'password',
                deviceType: credentials.deviceType as string,
                timeout: connectionTimeout,
                keepAlive: credentials.keepAlive as boolean,
            };

            // Add authentication-specific fields
            if (deviceCredentials.authMethod === 'privateKey') {
                deviceCredentials.privateKey = credentials.privateKey as string;
                if (credentials.passphrase) {
                    deviceCredentials.passphrase = credentials.passphrase as string;
                }
            } else {
                deviceCredentials.password = credentials.password as string;
            }

            // Add enable password for Cisco devices
            if (credentials.enablePassword) {
                (deviceCredentials as any).enablePassword = credentials.enablePassword;
            }

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
                         throw new NodeOperationError(
                             this.getNode(),
                             result.error || 'Command execution failed',
                             { itemIndex: i },
                         );
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
            // Always ensure proper cleanup
            if (connection && autoDisconnect) {
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