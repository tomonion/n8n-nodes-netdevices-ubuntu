# Jump Host Support Guide

This guide explains how to use the jump host (bastion server) feature in the NetDevices node for n8n.

## Overview

Jump hosts are commonly used in enterprise environments to provide secure access to network devices that are not directly accessible from the internet or management network. The jump host acts as a secure gateway through which you can access internal network devices.

## How It Works

The jump host implementation uses SSH tunneling to create a secure connection:

1. **Connect to Jump Host**: Establishes SSH connection to the jump host (bastion server)
2. **Create Tunnel**: Creates an outbound SSH tunnel from jump host to target device
3. **Connect Through Tunnel**: Establishes SSH connection to target device through the tunnel
4. **Transparent Operation**: All commands and responses work exactly like a direct connection

## Configuration

### Enable Jump Host

1. In your n8n credentials, set **"Use Jump Host"** to `true`
2. Configure the jump host settings in the **"Jump Host Configuration"** section

### Jump Host Settings

| Setting | Description | Required |
|---------|-------------|----------|
| **Jump Host Hostname/IP** | The hostname or IP address of the jump host | Yes |
| **Jump Host Port** | SSH port for the jump host (default: 22) | Yes |
| **Jump Host Username** | Username for jump host authentication | Yes |
| **Jump Host Authentication Method** | Password or SSH Private Key | Yes |
| **Jump Host Password** | Password for jump host (if using password auth) | Yes* |
| **Jump Host SSH Private Key** | Private key for jump host (if using key auth) | Yes* |
| **Jump Host Private Key Passphrase** | Passphrase for private key (if required) | No |

*Required based on authentication method

### Target Device Settings

The target device settings remain the same as direct connections:

- **Hostname/IP**: The internal network device you want to access
- **Port**: SSH port of the target device
- **Username**: Username for target device authentication
- **Authentication Method**: Password or SSH Private Key
- **Device Type**: Type of network device (Cisco, Juniper, etc.)

## Authentication Scenarios

### Scenario 1: Password Authentication for Both
```json
{
  "host": "192.168.10.100",
  "username": "admin",
  "password": "device123",
  "authMethod": "password",
  "useJumpHost": true,
  "jumpHost": {
    "host": "10.0.0.1",
    "username": "jumpuser",
    "password": "jump123",
    "authMethod": "password"
  }
}
```

### Scenario 2: Key Authentication for Jump Host, Password for Target
```json
{
  "host": "192.168.10.100",
  "username": "admin",
  "password": "device123",
  "authMethod": "password",
  "useJumpHost": true,
  "jumpHost": {
    "host": "10.0.0.1",
    "username": "jumpuser",
    "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n...",
    "authMethod": "privateKey"
  }
}
```

### Scenario 3: Key Authentication for Both
```json
{
  "host": "192.168.10.100",
  "username": "admin",
  "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n...",
  "authMethod": "privateKey",
  "useJumpHost": true,
  "jumpHost": {
    "host": "10.0.0.1",
    "username": "jumpuser",
    "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n...",
    "authMethod": "privateKey"
  }
}
```

## Usage Examples

### Basic Command Execution
```javascript
// The node automatically handles jump host connection
const result = await connection.sendCommand('show version');
```

### Configuration Commands
```javascript
// Configuration commands work transparently
const configResult = await connection.sendConfig([
  'interface GigabitEthernet1/0/1',
  'description Test Interface',
  'no shutdown'
]);
```

### Device Operations
```javascript
// All device operations work the same way
const config = await connection.getCurrentConfig();
await connection.saveConfig();
await connection.rebootDevice();
```

## Troubleshooting

### Common Issues

#### 1. Jump Host Connection Failed
**Error**: "Jump host connection failed"
**Solutions**:
- Verify jump host hostname/IP and port
- Check jump host credentials
- Ensure jump host is accessible from your network
- Check firewall rules

#### 2. Tunnel Creation Failed
**Error**: "Tunnel creation failed"
**Solutions**:
- Verify target device is accessible from jump host
- Check target device hostname/IP and port
- Ensure jump host has network access to target device
- Check firewall rules between jump host and target

#### 3. Target Connection Failed
**Error**: "Target connection failed through tunnel"
**Solutions**:
- Verify target device credentials
- Check target device SSH service is running
- Ensure target device allows connections from jump host

#### 4. Authentication Issues
**Error**: "Authentication failed"
**Solutions**:
- Double-check usernames and passwords/keys
- Verify private key format (OpenSSH format)
- Check if passphrase is required for private keys
- Ensure SSH keys are properly configured

### Debug Mode

Enable SSH debugging by setting the environment variable:
```bash
export SSH_DEBUG=true
```

This will provide detailed SSH connection logs for troubleshooting.

### Connection Flow

The connection process follows this sequence:
1. Validate jump host configuration
2. Connect to jump host using jump host credentials
3. Create outbound tunnel from jump host to target device
4. Connect to target device through tunnel using target credentials
5. Establish shell session on target device

## Security Considerations

### Best Practices

1. **Use SSH Keys**: Prefer SSH key authentication over passwords
2. **Limit Access**: Restrict jump host access to authorized users only
3. **Network Segmentation**: Use jump hosts in DMZ or secure network segments
4. **Regular Updates**: Keep jump hosts updated with security patches
5. **Audit Logs**: Monitor jump host access logs

### Credential Security

- Jump host and target device credentials are stored securely in n8n
- Passwords and private keys are encrypted
- No credentials are logged in debug output
- Connections are properly cleaned up on disconnect

## Performance Notes

- Jump host connections add a small latency overhead
- Connection establishment takes slightly longer due to multi-hop setup
- Command execution performance is similar to direct connections
- Connection pooling is not supported for jump hosts (future enhancement)

## Limitations

### Current Limitations
- Single jump host only (no multi-hop chains)
- No connection pooling for jump hosts
- No SSH agent forwarding
- No connection reuse for jump hosts

### Future Enhancements
- Multiple jump host support
- Connection pooling for jump hosts
- SSH agent forwarding
- Connection reuse optimization
- Dynamic jump host selection

## Support

For issues with jump host functionality:
1. Check the troubleshooting section above
2. Enable SSH debugging for detailed logs
3. Verify network connectivity and firewall rules
4. Test jump host connectivity manually first
5. Review n8n logs for detailed error information 