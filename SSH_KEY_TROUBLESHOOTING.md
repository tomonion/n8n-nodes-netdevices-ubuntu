# SSH Key Troubleshooting Guide

This guide helps you resolve SSH key format issues in the NetDevices node.

## Common SSH Key Issues

### 1. "SSH private key must be in proper PEM format" Error

This error occurs when the SSH key doesn't have the correct format. Here's how to fix it:

#### Check Your Key Format

Your SSH private key should look like this:

**RSA Key:**
```
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA7gUYx5hSKKpnOgOFEGwvr5gXlZKmkJJ7JJqQlEEjwUcIZHkP
... (many lines of base64 encoded content) ...
wKBgQDEW9qN4+8jKGJQKGFJKGJQKGFJKGJQKGFJKGJQKGFJKGJQKGFJKGJQKGFJ
-----END RSA PRIVATE KEY-----
```

**OpenSSH Key:**
```
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAlwAAAAdzc2gtcn
... (many lines of base64 encoded content) ...
-----END OPENSSH PRIVATE KEY-----
```

**Ed25519 Key:**
```
-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg...
... (many lines of base64 encoded content) ...
-----END PRIVATE KEY-----
```

#### Common Problems and Solutions

1. **Missing BEGIN/END markers**
   - **Problem**: Key content without `-----BEGIN` and `-----END` lines
   - **Solution**: Add the appropriate markers based on your key type

2. **Wrong line endings**
   - **Problem**: Windows line endings (`\r\n`) or mixed line endings
   - **Solution**: The node automatically normalizes line endings

3. **Extra whitespace**
   - **Problem**: Extra spaces or tabs at the beginning/end
   - **Solution**: The node automatically trims whitespace

4. **Incomplete key**
   - **Problem**: Only part of the key was copied
   - **Solution**: Copy the entire key including BEGIN and END markers

## How to Debug Your SSH Key

### Using the Debug Script

1. **Build the project first:**
   ```bash
   npm run build
   ```

2. **Test your SSH key:**
   ```bash
   node debug-ssh-key.js "your-ssh-key-content-here"
   ```

3. **Example usage:**
   ```bash
   node debug-ssh-key.js "-----BEGIN RSA PRIVATE KEY-----
   MIIEpAIBAAKCAQEA7gUYx5hSKKpnOgOFEGwvr5gXlZKmkJJ7JJqQlEEjwUcIZHkP
   ... (your key content) ...
   -----END RSA PRIVATE KEY-----"
   ```

### Manual Debugging Steps

1. **Check key length**: SSH keys should be at least 500 characters long
2. **Verify markers**: Look for `-----BEGIN` and `-----END` markers
3. **Check line breaks**: Ensure proper line breaks between sections
4. **Remove extra content**: Don't include file paths or comments

## Getting Your SSH Key

### From SSH Key File

If you have an SSH key file (e.g., `~/.ssh/id_rsa`):

```bash
# View the key content
cat ~/.ssh/id_rsa

# Copy the entire output including BEGIN and END markers
```

### From SSH Agent

If your key is loaded in SSH agent:

```bash
# List loaded keys
ssh-add -l

# Export a specific key (replace with your key path)
ssh-add -L
```

### Generate New SSH Key

If you need to generate a new key:

```bash
# Generate RSA key
ssh-keygen -t rsa -b 4096 -f ~/.ssh/my_key

# Generate Ed25519 key (recommended)
ssh-keygen -t ed25519 -f ~/.ssh/my_key

# Generate OpenSSH format key
ssh-keygen -t rsa -b 4096 -m PEM -f ~/.ssh/my_key
```

## Testing Your Key

### Test with SSH Command

Before using in n8n, test your key with SSH:

```bash
# Test connection with your key
ssh -i ~/.ssh/your_key username@hostname

# Test jump host connection
ssh -J username@jumphost username@target
```

### Test Key Format

Use OpenSSL to validate your key:

```bash
# For RSA keys
openssl rsa -in ~/.ssh/your_key -check

# For OpenSSH keys
ssh-keygen -l -f ~/.ssh/your_key
```

## Jump Host Specific Issues

### Jump Host Key Format

When using jump hosts, ensure:

1. **Jump host key is properly formatted** (same requirements as target key)
2. **Jump host key is authorized** on the jump host server
3. **Target key is authorized** on the target device
4. **Jump host can reach target** (network connectivity)

### Common Jump Host Problems

1. **"Jump host SSH private key validation failed"**
   - Check jump host key format
   - Ensure key is copied completely

2. **"Authentication failed"**
   - Verify jump host key is authorized
   - Check jump host username/password

3. **"Connection refused"**
   - Verify jump host SSH service is running
   - Check firewall rules

## n8n Credential Configuration

### Proper Credential Setup

1. **Enable "Use Jump Host"** if connecting through a bastion
2. **Select "SSH Private Key"** as authentication method
3. **Paste complete key** including BEGIN and END markers
4. **Add passphrase** if your key is encrypted
5. **Test connection** using n8n's credential test feature

### Credential Test

Use n8n's built-in credential testing:

1. Go to **Credentials** in n8n
2. Find your **Net Devices API** credential
3. Click **Test** button
4. Check the test results for specific errors

## Advanced Debugging

### Enable SSH Debug Logging

Set environment variable to enable detailed SSH logging:

```bash
export SSH_DEBUG=true
```

### Check n8n Logs

Look for SSH-related errors in n8n logs:

```bash
# If running n8n locally
n8n start

# Check console output for SSH errors
```

### Common Error Messages

| Error Message | Cause | Solution |
|---------------|-------|----------|
| "SSH private key must be in proper PEM format" | Missing BEGIN/END markers | Add proper key headers |
| "Private key appears to be too short" | Incomplete key copied | Copy entire key content |
| "Private key must start with -----BEGIN marker" | No BEGIN marker | Add appropriate BEGIN line |
| "Private key must end with proper -----END marker" | No END marker | Add appropriate END line |
| "Authentication failed" | Key not authorized | Add public key to server |
| "Connection refused" | SSH service not running | Check SSH service status |

## Still Having Issues?

If you're still experiencing problems:

1. **Use the debug script** to validate your key format
2. **Test with SSH command line** to verify connectivity
3. **Check server logs** for authentication errors
4. **Verify network connectivity** between all hosts
5. **Ensure proper permissions** on SSH key files

## Support

For additional help:

1. Check the [GitHub repository](https://github.com/arpit-patel1/n8n-nodes-netdevices)
2. Review the [Jump Host Guide](JUMP_HOST_GUIDE.md)
3. Check the [SSH Key Authentication Guide](SSH_KEY_AUTH_GUIDE.md) 