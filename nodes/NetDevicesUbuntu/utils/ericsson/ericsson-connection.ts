import { BaseConnection, DeviceCredentials, CommandResult } from '../base-connection';

export class EricssonConnection extends BaseConnection {
	private enablePassword: string = '';
	private inEnableMode: boolean = false;
	private inConfigMode: boolean = false;

	constructor(credentials: DeviceCredentials & { enablePassword?: string }) {
		super(credentials);
		this.enablePassword = credentials.enablePassword || credentials.password || '';
	}

	public async sessionPreparation(): Promise<void> {
		await this.createEricssonShellChannel();

		if (this.fastMode) {
			await this.setBasePrompt();
		} else {
			await Promise.all([this.setTerminalWidth(), this.disablePaging()]);

			await this.setBasePrompt();

			await this.checkAndEnterEnableMode();
		}
	}

	private async createEricssonShellChannel(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.client.shell((err, channel) => {
				if (err) {
					reject(err);
					return;
				}

				this.currentChannel = channel;
				this.currentChannel.setEncoding(this.encoding);

				const waitTime = this.fastMode ? 200 : 600;
				setTimeout(() => {
					resolve();
				}, waitTime);
			});
		});
	}

	protected async setTerminalWidth(): Promise<void> {
		try {
			await this.writeChannel('terminal width 511' + this.newline);
			await this.readChannel(2000);
		} catch (error) {
			// If this fails, it's not critical
		}
	}

	protected async disablePaging(): Promise<void> {
		try {
			await this.writeChannel('terminal length 0' + this.newline);
			await this.readChannel(2000);
		} catch (error) {
			// If this fails, it's not critical
		}
	}

	protected async setBasePrompt(): Promise<void> {
		await this.writeChannel(this.returnChar);
		const output = await this.readChannel(3000);

		const lines = output.trim().split('\n');
		const lastLine = lines[lines.length - 1];

		this.basePrompt = lastLine.replace(/[>#$%]\s*$/, '').trim();

		this.enabledPrompt = this.basePrompt + '#';
		this.configPrompt = this.basePrompt + '(config)#';
	}

	private async checkAndEnterEnableMode(): Promise<void> {
		await this.writeChannel(this.returnChar);
		const output = await this.readChannel(2000);

		if (output.includes('#')) {
			this.inEnableMode = true;
			return;
		}

		await this.enterEnableMode();
	}

	private async enterEnableMode(): Promise<void> {
		try {
			await this.writeChannel('enable 15' + this.newline);

			let output = await this.readChannel(3000);

			if (output.toLowerCase().includes('password:') || output.toLowerCase().includes('password')) {
				await this.writeChannel(this.enablePassword + this.newline);
				output = await this.readChannel(3000);
			}

			if (output.includes('#')) {
				this.inEnableMode = true;
			} else {
				throw new Error('Failed to enter enable mode');
			}
		} catch (error) {
			throw new Error(`Failed to enter enable mode: ${error}`);
		}
	}

	protected async enterConfigMode(): Promise<void> {
		if (!this.inEnableMode) {
			await this.enterEnableMode();
		}

		try {
			await this.writeChannel('configure' + this.newline);
			const output = await this.readChannel(3000);

			if (output.includes('(config)')) {
				this.inConfigMode = true;
			} else {
				throw new Error('Failed to enter configuration mode');
			}
		} catch (error) {
			throw new Error(`Failed to enter configuration mode: ${error}`);
		}
	}

	protected async exitConfigMode(): Promise<void> {
		if (!this.inConfigMode) {
			return;
		}

		try {
			await this.writeChannel('end' + this.newline);
			const output = await this.readChannel(3000);

			if (output.includes('#') && !output.includes('(config)')) {
				this.inConfigMode = false;
			} else {
				throw new Error('Failed to exit configuration mode');
			}
		} catch (error) {
			throw new Error(`Failed to exit configuration mode: ${error}`);
		}
	}

	async sendCommand(command: string): Promise<CommandResult> {
		try {
			if (!this.isConnected || !this.currentChannel) {
				throw new Error('Not connected to device');
			}

			if (!this.fastMode) {
				if (!this.inEnableMode && !command.startsWith('show') && command !== 'enable') {
					await this.enterEnableMode();
				}
			}

			await this.writeChannel(command + this.newline);

			const timeout = this.fastMode ? 5000 : 10000;

			const output = await this.readUntilPrompt(undefined, timeout);

			const cleanOutput = this.sanitizeOutput(output, command);

			return {
				command,
				output: cleanOutput,
				success: true,
			};
		} catch (error) {
			return {
				command,
				output: '',
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			};
		}
	}

	async sendConfig(configCommands: string[]): Promise<CommandResult> {
		try {
			if (!this.isConnected || !this.currentChannel) {
				throw new Error('Not connected to device');
			}

			await this.enterConfigMode();

			let allOutput = '';

			for (const command of configCommands) {
				await this.writeChannel(command + this.newline);
				const output = await this.readChannel(3000);
				allOutput += output;

				if (output.includes('Invalid input') || output.includes('% ')) {
					throw new Error(`Configuration error on command "${command}": ${output}`);
				}
			}

			await this.exitConfigMode();

			const cleanOutput = this.sanitizeOutput(allOutput, configCommands.join('; '));

			return {
				command: configCommands.join('; '),
				output: cleanOutput,
				success: true,
			};
		} catch (error) {
			if (this.inConfigMode) {
				try {
					await this.exitConfigMode();
				} catch (exitError) {
					// Ignore exit errors if we're already handling an error
				}
			}

			return {
				command: configCommands.join('; '),
				output: '',
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			};
		}
	}

	async getCurrentConfig(): Promise<CommandResult> {
		return await this.sendCommand('show running-config');
	}

	async saveConfig(): Promise<CommandResult> {
		try {
			await this.writeChannel('save config' + this.newline);

			let output = await this.readChannel(5000);

			if (output.includes('?')) {
				await this.writeChannel('yes' + this.newline);
				output += await this.readChannel(5000);
			}

			return {
				command: 'save config',
				output: output,
				success: true,
			};
		} catch (error) {
			return {
				command: 'save config',
				output: '',
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			};
		}
	}

	async rebootDevice(): Promise<CommandResult> {
		try {
			await this.writeChannel('reload' + this.newline);

			let output = await this.readChannel(5000);

			if (output.includes('[confirm]') || output.includes('?')) {
				await this.writeChannel(this.newline);
				output += await this.readChannel(5000);
			}

			return {
				command: 'reload',
				output: output,
				success: true,
			};
		} catch (error) {
			return {
				command: 'reload',
				output: '',
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			};
		}
	}

	protected sanitizeOutput(output: string, command: string): string {
		const lines = output.split('\n');
		if (lines.length > 0 && lines[0].includes(command)) {
			lines.shift();
		}

		if (lines.length > 0) {
			const lastLine = lines[lines.length - 1];
			const promptRegex = new RegExp(`^${this.escapeRegex(this.basePrompt)}[>#$]`);
			if (promptRegex.test(lastLine)) {
				lines.pop();
			}
		}

		return lines.join('\n').trim();
	}
}
