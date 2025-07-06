# SSH Key Authentication Guide

This guide explains how to use SSH key-based authentication with the n8n NetDevices node.

## Overview

The NetDevices node now supports two authentication methods:
- **Password Authentication**: Traditional username/password authentication
- **SSH Private Key Authentication**: Key-based authentication using SSH private keys

## Setting Up SSH Key Authentication

### 1. Authentication Method Selection

When configuring your NetDevices credentials, you'll see an "Authentication Method" dropdown with two options:
- **Password**: Use username/password authentication
- **SSH Private Key**: Use SSH key-based authentication

### 2. Password Authentication

For password authentication, simply:
1. Select "Password" as the authentication method
2. Enter your username and password
3. The password field will be shown and required

### 3. SSH Private Key Authentication

For SSH key authentication:
1. Select "SSH Private Key" as the authentication method
2. Enter your username
3. Paste your complete SSH private key content in the "SSH Private Key" field
4. Optionally enter a passphrase if your private key is encrypted

#### SSH Private Key Field Details

- **Format**: The field accepts the complete SSH private key content
- **Size**: The field is configured with 5 rows for easy pasting of multi-line keys
- **Content**: Paste the entire key including the `-----BEGIN` and `-----END` lines
- **Security**: The field is marked as password-type for security (content is hidden)

#### Supported Key Formats

The implementation supports all SSH key formats supported by the Node.js `ssh2` library:
- RSA keys (`-----BEGIN RSA PRIVATE KEY-----`)
- OpenSSH format (`-----BEGIN OPENSSH PRIVATE KEY-----`)
- DSA keys (`-----BEGIN DSA PRIVATE KEY-----`)
- ECDSA keys (`-----BEGIN EC PRIVATE KEY-----`)
- Ed25519 keys (`-----BEGIN PRIVATE KEY-----`)

#### Private Key Passphrase

- **Optional**: Only required if your private key is encrypted with a passphrase
- **Security**: The passphrase field is marked as password-type for security
- **Leave Empty**: If your private key has no passphrase, leave this field empty

## Example SSH Private Key

```
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA7gUYx5hSKKpnOgOFEGwvr5gXlZKmkJJ7JJqQlEEjwUcIZHkP
...
[key content]
...
wKBgQDEW9qN4+8jKGJQKGFJKGJQKGFJKGJQKGFJKGJQKGFJKGJQKGFJKGJQKGFJ
-----END RSA PRIVATE KEY-----
```

## Security Considerations

1. **Key Storage**: Private keys are stored securely in n8n's credential system
2. **No File Paths**: The implementation does not support file paths or reading from `.ssh` directories for security reasons
3. **Content Only**: Only the key content itself is supported, not file references
4. **Encryption**: All credential fields are encrypted in n8n's database

## Troubleshooting

### Common Issues

1. **"SSH private key is required"**: Ensure you've pasted the complete private key content
2. **"Password is required"**: When using password auth, ensure the password field is filled
3. **Connection failures**: Verify your private key format and ensure it matches the target server

### Key Format Validation

Make sure your private key:
- Includes the full `-----BEGIN` and `-----END` lines
- Has no extra whitespace or characters
- Is in a format supported by the ssh2 library
- Matches the public key installed on the target device

## Migration from Password to Key Authentication

To migrate existing password-based credentials to key authentication:

1. Edit your existing NetDevices credential
2. Change the "Authentication Method" from "Password" to "SSH Private Key"
3. The password field will be hidden and the SSH key fields will appear
4. Paste your private key content and optionally add a passphrase
5. Save the credential

## Benefits of SSH Key Authentication

- **Enhanced Security**: No passwords transmitted over the network
- **No Password Expiration**: Keys don't expire like passwords might
- **Automation Friendly**: Better suited for automated workflows
- **Audit Trail**: Key-based access can be more easily tracked and managed 