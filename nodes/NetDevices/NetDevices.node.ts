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
						displayName: 'Command Timeout',
						name: 'commandTimeout',
						type: 'number',
						default: 30,
						description: 'Timeout for command execution in seconds',
					},
					{
						displayName: 'Auto Disconnect',
						name: 'autoDisconnect',
						type: 'boolean',
						default: true,
						description: 'Whether to automatically disconnect after command execution',
					},
					{
						displayName: 'Retry Count',
						name: 'retryCount',
						type: 'number',
						default: 1,
						description: 'Number of retry attempts if command fails',
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
        try {
            // Get advanced options
            const advancedOptions = this.getNodeParameter('advancedOptions', i, {}) as IDataObject;
            const autoDisconnect = (advancedOptions.autoDisconnect as boolean) !== false;
            const retryCount = (advancedOptions.retryCount as number) || 1;

            // Prepare device credentials
            const deviceCredentials: DeviceCredentials = {
                host: credentials.host as string,
                port: credentials.port as number,
                username: credentials.username as string,
                password: credentials.password as string,
                deviceType: credentials.deviceType as string,
                timeout: ((credentials.timeout as number) || 30) * 1000, // Convert to milliseconds
                keepAlive: credentials.keepAlive as boolean,
            };

            // Add enable password for Cisco devices
            if (credentials.enablePassword) {
                (deviceCredentials as any).enablePassword = credentials.enablePassword;
            }

            let connection;
            let result: CommandResult;

            // Create connection with retry logic
            for (let attempt = 1; attempt <= retryCount; attempt++) {
                try {
                    connection = ConnectHandler(deviceCredentials);
                    await connection.connect();
                    break;
                } catch (error) {
                    if (attempt === retryCount) {
                        throw new NodeOperationError(
                            this.getNode(),
                            `Failed to connect to device after ${retryCount} attempts: ${error}`,
                            { itemIndex: i },
                        );
                    }
                    // Wait before retry
                    await new Promise<void>(resolve => global.setTimeout(resolve, 2000));
                }
            }

            try {
                // Execute the requested operation
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
                        result = await connection!.sendCommand(command);
                        break;

                    case 'sendConfig':
                        const configCommands = this.getNodeParameter('configCommands', i) as string;
                        if (!configCommands) {
                            throw new NodeOperationError(
                                this.getNode(),
                                'Configuration commands are required for sendConfig operation',
                                { itemIndex: i },
                            );
                        }
                        // Split commands by newline and filter out empty lines
                        const commands = configCommands.split('\n')
                            .map(cmd => cmd.trim())
                            .filter(cmd => cmd.length > 0);
                        result = await connection!.sendConfig(commands);
                        break;

                    case 'getRunningConfig':
                        result = await connection!.getCurrentConfig();
                        break;

                    case 'saveConfig':
                        result = await connection!.saveConfig();
                        break;

                    case 'rebootDevice':
                        result = await connection!.rebootDevice();
                        break;

                    default:
                        throw new NodeOperationError(
                            this.getNode(),
                            `The operation "${operation}" is not supported!`,
                            { itemIndex: i },
                        );
                }

                // Prepare the output data
                const outputData: IDataObject = {
                    success: result.success,
                    command: result.command,
                    output: result.output,
                    deviceType: connection!.getDeviceType(),
                    host: connection!.getHost(),
                    timestamp: new Date().toISOString(),
                };

                if (!result.success && result.error) {
                    outputData.error = result.error;
                }

                const executionData = this.helpers.constructExecutionMetaData(
                    this.helpers.returnJsonArray(outputData),
                    { itemData: { item: i } },
                );
                returnData.push(...executionData);

            } finally {
                // Disconnect from device if auto-disconnect is enabled
                if (connection && autoDisconnect) {
                    try {
                        await connection.disconnect();
                    } catch (error) {
                        // Ignore disconnect errors
                    }
                }
            }

        } catch (error) {
            if (this.continueOnFail()) {
                const errorData = {
                    error: error instanceof Error ? error.message : 'Unknown error',
                    success: false,
                    timestamp: new Date().toISOString(),
                };
                returnData.push({ json: errorData });
                continue;
            }
            throw error;
        }
    }

    return [returnData];
    }
}