import { BaseConnection, DeviceCredentials } from './base-connection';
import { JumpHostConnection } from './jump-host-connection';

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
		error: (...args: any[]) => console.error('[ERROR]', ...args),
	};
}

/**
 * A specialized JumpHostConnection that wraps a device-specific connection
 * to ensure that session preparation methods are correctly called.
 */
export class DeviceSpecificJumpHostConnection extends JumpHostConnection {
	private deviceConnection: BaseConnection;

	constructor(credentials: DeviceCredentials, deviceConnection: BaseConnection) {
		super(credentials);
		this.deviceConnection = deviceConnection;

		// Link the underlying client and channels for seamless integration
		this.deviceConnection.client = this.client;
		this.deviceConnection.currentChannel = this.currentChannel;
	}

	/**
	 * Overrides the base session preparation to delegate to the specific
	 * device connection instance, ensuring correct setup (e.g., shell creation).
	 */
	public async sessionPreparation(): Promise<void> {
		Logger.debug('Delegating session preparation to device-specific connection', {
			deviceType: this.credentials.deviceType,
			hasClient: !!this.client,
			isConnected: this.isConnected,
			jumpHostConnected: this.jumpHostConnected
		});

		// Ensure we have an active SSH connection before session preparation
		if (!this.client || !this.isConnected) {
			Logger.error('SSH client not ready for session preparation', {
				hasClient: !!this.client,
				isConnected: this.isConnected,
				jumpHostConnected: this.jumpHostConnected,
				deviceType: this.credentials.deviceType
			});
			throw new Error('SSH connection not established before session preparation');
		}

		// Synchronize the client and channel before preparation
		this.deviceConnection.client = this.client;
		this.deviceConnection.currentChannel = this.currentChannel;
		
		// Ensure device connection shares the same connection state
		this.deviceConnection.isConnected = this.isConnected;

		try {
			// Delegate the call to the actual device-specific implementation
			await this.deviceConnection.sessionPreparation();

			// Re-synchronize after preparation to capture the created channel
			this.currentChannel = this.deviceConnection.currentChannel;

			if (!this.currentChannel) {
				Logger.error('Session preparation failed to create a channel', {
					deviceType: this.credentials.deviceType,
					hasClient: !!this.client,
					isConnected: this.isConnected
				});
				throw new Error('Failed to create a valid shell channel during session preparation.');
			}

			Logger.debug('Session preparation delegated successfully', {
				hasChannel: !!this.currentChannel,
				channelType: this.currentChannel.constructor.name,
				deviceType: this.credentials.deviceType
			});
		} catch (sessionError) {
			Logger.error('Device-specific session preparation failed', {
				deviceType: this.credentials.deviceType,
				error: sessionError instanceof Error ? sessionError.message : String(sessionError),
				hasClient: !!this.client,
				isConnected: this.isConnected
			});
			throw sessionError;
		}
	}
}
