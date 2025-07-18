#!/usr/bin/env node

/**
 * Test script to verify single-line SSH key formatting
 */

const { formatSSHPrivateKey, validateSSHPrivateKey } = require('./dist/nodes/NetDevices/utils/base-connection');

function testSingleLineKey() {
    console.log('=== Testing Single-Line SSH Key Formatting ===');
    
    // Simulate a single-line RSA key (like what you're experiencing)
    const singleLineKey = '-----BEGIN RSA PRIVATE KEY----- MIIJKQIBAAKCAgEAvD1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ -----END RSA PRIVATE KEY-----';
    
    console.log('Original key format:');
    console.log('Length:', singleLineKey.length);
    console.log('Lines:', singleLineKey.split('\n').length);
    console.log('First 100 chars:', singleLineKey.substring(0, 100));
    console.log('Last 100 chars:', singleLineKey.substring(singleLineKey.length - 100));
    
    try {
        console.log('\n=== Formatting Test ===');
        const formattedKey = formatSSHPrivateKey(singleLineKey);
        
        console.log('Formatted key:');
        console.log('Length:', formattedKey.length);
        const lines = formattedKey.split('\n');
        console.log('Lines:', lines.length);
        console.log('First line:', lines[0]);
        console.log('Second line:', lines[1]?.substring(0, 50));
        console.log('Last line:', lines[lines.length - 1]);
        
        // Check if ssh2 would be able to parse this format
        const hasProperFormat = lines.length > 1 && 
                               lines[0].includes('-----BEGIN') &&
                               lines[lines.length - 1].includes('-----END');
        
        console.log('\n=== Format Validation ===');
        console.log('✅ Multi-line format:', hasProperFormat);
        console.log('✅ Proper BEGIN marker:', lines[0].includes('-----BEGIN RSA PRIVATE KEY-----'));
        console.log('✅ Proper END marker:', lines[lines.length - 1].includes('-----END RSA PRIVATE KEY-----'));
        console.log('✅ Content lines count:', lines.length - 2);
        
        // Test line lengths (should be 64 chars or less for content lines)
        const contentLines = lines.slice(1, -1);
        const longLines = contentLines.filter(line => line.length > 64);
        console.log('✅ Proper line wrapping:', longLines.length === 0);
        if (longLines.length > 0) {
            console.log('❌ Long lines found:', longLines.map(line => line.length));
        }
        
    } catch (error) {
        console.log('❌ Error formatting key:', error.message);
    }
}

testSingleLineKey(); 