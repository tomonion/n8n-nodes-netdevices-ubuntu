# SSH Timeout Troubleshooting Guide

This guide helps resolve SSH timeout issues when connecting to network devices and Linux servers using the NetDevices node.

## Common Error Messages

- `Timeout waiting for prompt after 8000ms. Buffer:`
- `Connection timeout after X seconds`
- `Command execution failed after 2 attempts`
- `SSH timeout server not responding`

## Root Causes and Solutions

### 1. SSH Key Authentication Issues

**Problem**: SSH key authentication fails or takes too long to establish.

**Solutions**:
- Ensure your SSH private key is properly formatted (OpenSSH format)
- Verify the corresponding public key is in the server's `~/.ssh/authorized_keys`
- Check that the SSH key doesn't have a passphrase (or provide the passphrase)
- Test SSH connection manually: `ssh -i /path/to/key user@host`

**Example SSH Key Format**:
```
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAABlwAAAAdzc2gtcn
...
-----END OPENSSH PRIVATE KEY-----
```

### 2. Linux Server Prompt Detection

**Problem**: The node cannot detect the Linux shell prompt after connection.

**Solutions**:
- Enable "Fast Mode" in advanced options for quicker prompt detection
- Increase command timeout in advanced options (try 15000ms)
- Ensure your shell prompt is standard (avoid custom PS1 with special characters)
- Check if your server has a MOTD (Message of the Day) that might interfere

**Supported Prompt Patterns**:
- `user@hostname:~$`
- `user@hostname:~#`
- `[user@hostname ~]$`
- `[user@hostname ~]#`
- Simple `$` or `#` prompts

### 3. Connection Configuration Issues

**Problem**: SSH connection parameters are not optimized for your server.

**Solutions**:
- Verify host IP address and port (default: 22)
- Check firewall rules on both client and server
- Ensure SSH service is running on the target server
- Try connecting with different SSH algorithms

**Debug Connection Issues**:
Set environment variable `SSH_DEBUG=true` to enable SSH debugging:
```bash
export SSH_DEBUG=true
```

### 4. Network and Firewall Issues

**Problem**: Network connectivity or firewall blocking SSH connections.

**Solutions**:
- Test basic connectivity: `ping hostname`
- Check if SSH port is open: `telnet hostname 22`
- Verify firewall rules allow SSH traffic
- Check if SSH is running: `systemctl status ssh` (on target server)

### 5. Server Performance Issues

**Problem**: Server is slow to respond due to high load or resource constraints.

**Solutions**:
- Increase connection timeout (try 20000ms)
- Increase command timeout (try 15000ms)
- Enable "Fast Mode" for basic operations
- Check server load: `top` or `htop`

## Advanced Configuration

### Recommended Settings for Different Scenarios

#### Standard Linux Servers
```json
{
  "timeout": 10000,
  "commandTimeout": 8000,
  "fastMode": false,
  "keepAlive": true
}
```

#### High-Latency Networks
```json
{
  "timeout": 20000,
  "commandTimeout": 15000,
  "fastMode": false,
  "keepAlive": true
}
```

#### Quick Operations
```json
{
  "timeout": 8000,
  "commandTimeout": 5000,
  "fastMode": true,
  "keepAlive": false
}
```

### SSH Key Authentication Best Practices

1. **Use OpenSSH format keys** (not PuTTY format)
2. **Generate keys with strong algorithms**:
   ```bash
   ssh-keygen -t ed25519 -C "your_email@example.com"
   # or
   ssh-keygen -t rsa -b 4096 -C "your_email@example.com"
   ```
3. **Copy public key to server**:
   ```bash
   ssh-copy-id -i ~/.ssh/id_ed25519.pub user@hostname
   ```
4. **Test connection**:
   ```bash
   ssh -i ~/.ssh/id_ed25519 user@hostname
   ```

## Debugging Steps

### 1. Test Manual SSH Connection
```bash
# Test with verbose output
ssh -v user@hostname

# Test with specific key
ssh -i /path/to/key user@hostname

# Test with specific port
ssh -p 2222 user@hostname
```

### 2. Check SSH Server Configuration
On the target server, check `/etc/ssh/sshd_config`:
```bash
# Common settings that might cause issues
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
PasswordAuthentication no  # If using key auth only
PermitRootLogin yes        # If connecting as root
```

### 3. Check SSH Client Logs
Enable SSH debugging in n8n:
```bash
export SSH_DEBUG=true
# Restart n8n to see SSH debug output
```

### 4. Verify Network Connectivity
```bash
# Test basic connectivity
ping hostname

# Test SSH port
nmap -p 22 hostname

# Test with telnet
telnet hostname 22
```

## Common Solutions Summary

| Issue | Solution |
|-------|----------|
| Timeout after 8000ms | Increase commandTimeout to 15000ms |
| Connection timeout | Increase timeout to 20000ms |
| Key authentication fails | Verify key format and authorized_keys |
| Prompt not detected | Enable fastMode or check shell prompt |
| Network issues | Check firewall and SSH service status |
| Server overloaded | Increase timeouts and check server load |

## Getting Help

If you continue to experience issues:

1. **Check the error logs** in n8n for detailed error messages
2. **Test manual SSH connection** to isolate the issue
3. **Enable SSH debugging** with `SSH_DEBUG=true`
4. **Verify server configuration** and network connectivity
5. **Try different timeout values** based on your network conditions

## Related Resources

- [SSH Key Authentication Guide](./SSH_KEY_AUTH_GUIDE.md)
- [Performance Optimization Guide](./PERFORMANCE_OPTIMIZATION_GUIDE.md)
- [Error Handling Guide](./ERROR_HANDLING_GUIDE.md)
- [Vendor-Specific Configuration](./VENDOR_GUIDE.md) 