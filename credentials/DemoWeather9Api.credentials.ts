import type { Icon, ICredentialType, INodeProperties } from 'n8n-workflow';

export class DemoWeather9Api implements ICredentialType {
	name = 'demoWeather9Api';
	// icon
	displayName = 'Demo Weather 9 API';

	documentationUrl = 'https://openweathermap.org/api';
	icon: Icon = 'file:weather-icon.svg';
	properties: INodeProperties[] = [
		{
			displayName: 'Access Token',
			name: 'accessToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
		},
	];
}
