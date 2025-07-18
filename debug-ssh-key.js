#!/usr/bin/env node

/**
 * Debug script to test SSH key formatting and validation
 * Usage: node debug-ssh-key.js "your-ssh-key-content"
 */

const { formatSSHPrivateKey, validateSSHPrivateKey } = require('./dist/nodes/NetDevices/utils/base-connection');

function debugSSHKey(keyContent) {
    console.log('=== SSH Key Debug ===');
    console.log('Original key length:', keyContent.length);
    console.log('Original key starts with -----BEGIN:', keyContent.includes('-----BEGIN'));
    console.log('Original key ends with -----END:', keyContent.includes('-----END'));
    console.log('Original key contains newlines:', keyContent.includes('\n'));
    console.log('Original key contains carriage returns:', keyContent.includes('\r'));
    
    // Show first and last 50 characters
    console.log('First 50 chars:', keyContent.substring(0, 50));
    console.log('Last 50 chars:', keyContent.substring(keyContent.length - 50));
    
    try {
        console.log('\n=== Validation Test ===');
        validateSSHPrivateKey(keyContent);
        console.log('✅ Key validation passed');
        
        console.log('\n=== Formatting Test ===');
        const formattedKey = formatSSHPrivateKey(keyContent);
        console.log('✅ Key formatting successful');
        console.log('Formatted key length:', formattedKey.length);
        console.log('Formatted key starts with -----BEGIN:', formattedKey.includes('-----BEGIN'));
        console.log('Formatted key ends with -----END:', formattedKey.includes('-----END'));
        
        // Show first and last 50 characters of formatted key
        console.log('Formatted first 50 chars:', formattedKey.substring(0, 50));
        console.log('Formatted last 50 chars:', formattedKey.substring(formattedKey.length - 50));
        
    } catch (error) {
        console.log('❌ Error:', error.message);
        console.log('Error details:', error);
    }
}

// Check if key content was provided as argument
if (process.argv.length < 3) {
    console.log('Usage: node debug-ssh-key.js "your-ssh-key-content"');
    console.log('Example: node debug-ssh-key.js "-----BEGIN RSA PRIVATE KEY-----\\nMIIEpAIBAAKCAQEA...\\n-----END RSA PRIVATE KEY-----"');
    process.exit(1);
}

const keyContent = process.argv[2];
debugSSHKey(keyContent); 