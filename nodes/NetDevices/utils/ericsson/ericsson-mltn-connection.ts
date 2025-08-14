import { BaseConnection, DeviceCredentials, CommandResult } from '../base-connection';
import { NoEnable } from '../no-enable';

export class EricssonMinilinkConnection extends NoEnable(BaseConnection) {
	constructor(credentials: DeviceCredentials) {
		super(credentials);
	}

	public async sessionPreparation(): Promise<void> {
		await this.createShellChannel();
		await this.specialLoginHandler();
		await this.setBasePrompt();
	}

	private async specialLoginHandler(): Promise<void> {
		const usernamePrompt = await this.readUntilPrompt('User:', 20000);
		if (usernamePrompt.includes('User:')) {
			await this.writeChannel(this.credentials.username + this.newline);
		} else {
			throw new Error('Did not receive username prompt');
		}

		const passwordPrompt = await this.readUntilPrompt('Password:', 5000);
		if (passwordPrompt.includes('Password:')) {
			if (this.credentials.password) {
				await this.writeChannel(this.credentials.password + this.newline);
			} else {
				throw new Error('Password is required for this device');
			}
		} else {
			throw new Error('Did not receive password prompt');
		}
	}

	protected async enterConfigMode(): Promise<void> {
		await this.writeChannel('config' + this.newline);
		const output = await this.readUntilPrompt('(config)#');
		if (!output.includes('(config)#')) {
			throw new Error('Failed to enter config mode');
		}
	}

	protected async exitConfigMode(): Promise<void> {
		await this.writeChannel('exit' + this.newline);
		const output = await this.readUntilPrompt('>');
		if (output.includes('(config)#')) {
			throw new Error('Failed to exit config mode');
		}
	}

	async saveConfig(): Promise<CommandResult> {
		return await this.sendCommand('write');
	}

	// Since there is no enable mode, override these methods
	public async checkAndEnterEnableMode(): Promise<void> {
		return;
	}

	public async enterEnableMode(): Promise<void> {
		return;
	}

	public async exitEnableMode(): Promise<string> {
		return '';
	}
}
