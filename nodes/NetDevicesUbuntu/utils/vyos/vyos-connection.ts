import { CiscoConnection } from '../cisco/cisco-connection';
import { NoEnable } from '../no-enable';

class VyosConnectionBase extends CiscoConnection {
	/**
	 * Prepare the session for VyOS devices.
	 */
	public async sessionPreparation(): Promise<void> {
		await this.createShellChannel();

		await Promise.all([this.setTerminalWidth(), this.disablePaging()]);

		await this.setBasePrompt();
	}

	/**
	 * Enter configuration mode.
	 */
	protected async enterConfigMode(): Promise<void> {
		if (this.inConfigMode) {
			return;
		}

		try {
			await this.writeChannel('configure' + this.newline);
			const output = await this.readUntilPrompt('[edit]', 3000);

			if (output.includes('[edit]')) {
				this.inConfigMode = true;
			} else {
				throw new Error('Failed to enter configuration mode');
			}
		} catch (error) {
			throw new Error(`Failed to enter configuration mode: ${error}`);
		}
	}

	/**
	 * Exit configuration mode.
	 */
	protected async exitConfigMode(): Promise<void> {
		if (!this.inConfigMode) {
			return;
		}

		try {
			await this.writeChannel('exit' + this.newline);
			let output = await this.readChannel(3000);

			if (output.includes('Cannot exit: configuration modified')) {
				await this.writeChannel('exit discard' + this.newline);
				output = await this.readUntilPrompt(undefined, 3000);
			}

			if (!output.includes('[edit]')) {
				this.inConfigMode = false;
			} else {
				throw new Error('Failed to exit configuration mode');
			}
		} catch (error) {
			throw new Error(`Failed to exit configuration mode: ${error}`);
		}
	}

	/**
	 * Commit the configuration.
	 */
	public async commit(): Promise<string> {
		try {
			await this.enterConfigMode();
			await this.writeChannel('commit' + this.newline);

			const output = await this.readUntilPrompt(undefined, 120000);

			if (output.includes('Failed to generate committed config') || output.includes('Commit failed')) {
				throw new Error(`Commit failed with following errors:\n\n${output}`);
			}
			return output;
		} catch (error) {
			throw new Error(`Failed to commit configuration: ${error}`);
		}
	}

	/**
	 * Save the configuration.
	 */
	public async saveConfig(): Promise<any> {
		try {
			await this.enterConfigMode();
			await this.writeChannel('save' + this.newline);
			const output = await this.readUntilPrompt(undefined, 30000);
			await this.exitConfigMode();

			if (!output.includes('Done')) {
				throw new Error(`Save failed with following errors:\n\n${output}`);
			}
			return {
				command: 'save',
				output: output,
				success: true,
			};
		} catch (error) {
			throw new Error(`Failed to save configuration: ${error}`);
		}
	}

	/**
	 * Sets the base prompt for the device.
	 */
	protected async setBasePrompt(): Promise<void> {
		await this.writeChannel(this.returnChar);
		const output = await this.readChannel(3000);

		const lines = output.trim().split('\n');
		const lastLine = lines[lines.length - 1];

		this.basePrompt = lastLine.replace(/[>#$]\s*$/, '').trim();

		this.enabledPrompt = this.basePrompt + '#';
		this.configPrompt = this.basePrompt + '[edit]';
	}
}

export const VyosConnection = NoEnable(VyosConnectionBase);
