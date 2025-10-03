import type { Icon, ICredentialType, INodeProperties } from 'n8n-workflow';
import { ConnectionDispatcher } from '../nodes/NetDevicesUbuntu/utils/index';

export class NetDevicesUbuntuApi implements ICredentialType {
	name = 'netDevicesUbuntuApi';   // unique internal name
	displayName = 'Net Devices Ubuntu API'; // shown in n8n

	documentationUrl = 'https://github.com/tomonion/n8n-nodes-netdevices-ubuntu';
	icon: Icon = 'file:netdevices-ubuntu-icon.svg';

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
			displayName: 'Authentication Method',
			name: 'authMethod',
			type: 'options',
			options: [
				{ name: 'Password', value: 'password' },
				{ name: 'SSH Private Key', value: 'privateKey' },
			],
			default: 'password',
			required: true,
			description: 'The authentication method to use for SSH connection',
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			displayOptions: { show: { authMethod: ['password'] } },
			description: 'The password for SSH authentication',
		},
		{
			displayName: 'SSH Private Key',
			name: 'privateKey',
			type: 'string',
			typeOptions: { password: true, rows: 5 },
			default: '',
			required: true,
			displayOptions: { show: { authMethod: ['privateKey'] } },
			description: 'Paste the entire key including -----BEGIN and -----END lines',
		},
		{
			displayName: 'Private Key Passphrase',
			name: 'passphrase',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			displayOptions: { show: { authMethod: ['privateKey'] } },
			description: 'Passphrase for the SSH private key (if any)',
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
				show: { deviceType: ['cisco_ios', 'cisco_ios_xe', 'cisco_nxos', 'cisco_asa'] },
			},
			description: 'Enable password for Cisco devices (optional)',
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
		{
			displayName: 'Use Jump Host',
			name: 'useJumpHost',
			type: 'boolean',
			default: false,
			description: 'Whether to connect through a jump host (bastion server)',
		},
		{
			displayName: 'Jump Host Hostname/IP',
			name: 'jumpHostHost',
			type: 'string',
			default: '',
			required: true,
			displayOptions: { show: { useJumpHost: [true] } },
			description: 'The hostname or IP address of the jump host',
		},
		{
			displayName: 'Jump Host Port',
			name: 'jumpHostPort',
			type: 'number',
			default: 22,
			required: true,
			displayOptions: { show: { useJumpHost: [true] } },
			description: 'SSH port number for the jump host',
		},
		{
			displayName: 'Jump Host Username',
			name: 'jumpHostUsername',
			type: 'string',
			default: '',
			required: true,
			displayOptions: { show: { useJumpHost: [true] } },
			description: 'Username for jump host authentication',
		},
		{
			displayName: 'Jump Host Authentication Method',
			name: 'jumpHostAuthMethod',
			type: 'options',
			options: [
				{ name: 'Password', value: 'password' },
				{ name: 'SSH Private Key', value: 'privateKey' },
			],
			default: 'password',
			required: true,
			displayOptions: { show: { useJumpHost: [true] } },
			description: 'Authentication method for the jump host',
		},
		{
			displayName: 'Jump Host Password',
			name: 'jumpHostPassword',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			displayOptions: {
				show: { useJumpHost: [true], jumpHostAuthMethod: ['password'] },
			},
			description: 'Password for jump host authentication',
		},
		{
			displayName: 'Jump Host SSH Private Key',
			name: 'jumpHostPrivateKey',
			type: 'string',
			typeOptions: { password: true, rows: 5 },
			default: '',
			required: true,
			displayOptions: {
				show: { useJumpHost: [true], jumpHostAuthMethod: ['privateKey'] },
			},
			description: 'Private key for jump host authentication',
		},
		{
			displayName: 'Jump Host Private Key Passphrase',
			name: 'jumpHostPassphrase',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			displayOptions: {
				show: { useJumpHost: [true], jumpHostAuthMethod: ['privateKey'] },
			},
			description: 'Passphrase for the jump host private key (if any)',
		},
	];
}
