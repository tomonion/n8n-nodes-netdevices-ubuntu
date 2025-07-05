import type { Icon, ICredentialType, INodeProperties } from 'n8n-workflow';
import { ConnectionDispatcher } from '../nodes/NetDevices/utils/index';

export class netDevicesApi implements ICredentialType {
	name = 'netDevicesApi';
	displayName = 'Net Devices API';

	documentationUrl = 'https://github.com/arpit-patel1/n8n-nodes-netdevices';
	icon: Icon = 'file:netdevices-icon.svg';
	properties: INodeProperties[] = [
		{
			displayName: 'Hostname/IP',
			name: 'host',
			type: 'string',
			default: '',
			required: true,
			description: 'The hostname or IP address of the network device',
		},
		{
			displayName: 'Port',
			name: 'port',
			type: 'number',
			default: 22,
			required: true,
			description: 'The SSH port number (default: 22)',
		},
		{
			displayName: 'Username',
			name: 'username',
			type: 'string',
			default: '',
			required: true,
			description: 'The username for SSH authentication',
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'The password for SSH authentication',
		},
		{
			displayName: 'Device Type',
			name: 'deviceType',
			type: 'options',
			options: ConnectionDispatcher.getDeviceTypeOptions(),
			default: 'cisco_ios',
			required: true,
			description: 'The type of network device',
		},
		{
			displayName: 'Enable Password',
			name: 'enablePassword',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			displayOptions: {
				show: {
					deviceType: ['cisco_ios', 'cisco_ios_xe', 'cisco_nxos', 'cisco_asa'],
				},
			},
			description: 'The enable password for Cisco devices (optional, uses login password if not provided)',
		},
		{
			displayName: 'Connection Timeout',
			name: 'timeout',
			type: 'number',
			default: 30,
			description: 'Connection timeout in seconds (default: 30)',
		},
		{
			displayName: 'Keep Alive',
			name: 'keepAlive',
			type: 'boolean',
			default: true,
			description: 'Send keep-alive packets to maintain the connection',
		},
	];
}
