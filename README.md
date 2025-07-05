# n8n-nodes-netdevices

A TypeScript-based n8n custom node that provides Netmiko-like functionality for managing network devices via SSH. This node allows you to interact with network infrastructure including Cisco and Juniper routers, switches, and Linux servers directly from n8n workflows.

## Features

- **Multi-vendor support**: Cisco IOS/IOS-XE/NX-OS/ASA, Juniper JunOS/SRX, and Linux servers
- **Secure SSH connections**: Uses the ssh2 library for reliable and secure connections
- **Vendor-specific handling**: Automatically handles device-specific behaviors like enable mode, configuration mode, and command prompts
- **TypeScript implementation**: Full TypeScript support with proper typing and error handling
- **Modular architecture**: Clean separation between base functionality and vendor-specific implementations

## Supported Device Types

### Cisco Platforms
- **Cisco IOS**: Traditional Cisco routers and switches
- **Cisco IOS-XE**: Modern Cisco devices running IOS-XE
- **Cisco IOS-XR**: Service provider routers with commit-based configuration
- **Cisco NX-OS**: Cisco Nexus data center switches
- **Cisco ASA**: Cisco ASA firewall appliances
- **Cisco SG300**: Small business switch series

### Other Vendors
- **Juniper JunOS**: Juniper routers and switches
- **Juniper SRX**: Juniper SRX firewall series
- **Linux**: Linux servers and network appliances
- **Generic**: Basic SSH connection for other devices

## Operations

### Send Command
Send a single command to the device and receive the output.
- **Use case**: Running show commands, getting device status
- **Example**: `show version`, `show interfaces`, `show ip route`

### Send Config
Send multiple configuration commands to the device.
- **Use case**: Configuring interfaces, VLANs, routing protocols
- **Example**: 
  ```
  interface GigabitEthernet1/0/1
  description Test Interface
  no shutdown
  ```

### Get Running Config
Retrieve the current running configuration from the device.
- **Use case**: Backup configurations, compliance checking

### Save Config
Save the current configuration to startup/persistent storage.
- **Use case**: Making configuration changes permanent

### Reboot Device
Restart the network device.
- **Use case**: Applying configuration changes that require a reboot

## Installation

1. Install the node package:
   ```bash
   npm install n8n-nodes-netdevices
   ```

2. Restart n8n to load the new node.

## Configuration

### Credentials
The node uses the "Net Devices API" credential type with the following fields:

- **Hostname/IP**: The IP address or hostname of the device
- **Port**: SSH port (default: 22)
- **Username**: SSH username
- **Password**: SSH password
- **Device Type**: Select from supported device types
- **Enable Password**: (Cisco only) Password for privileged mode
- **Connection Timeout**: Connection timeout in seconds
- **Keep Alive**: Whether to send keep-alive packets

### Advanced Options
- **Command Timeout**: Timeout for individual commands
- **Auto Disconnect**: Whether to disconnect after execution
- **Retry Count**: Number of connection retry attempts

## Usage Examples

### Basic Command Execution
```json
{
  "operation": "sendCommand",
  "command": "show version"
}
```

### Configuration Changes
```json
{
  "operation": "sendConfig",
  "configCommands": "interface GigabitEthernet1/0/1\ndescription Test Interface\nno shutdown"
}
```

### Get Device Configuration
```json
{
  "operation": "getRunningConfig"
}
```

### Platform-Specific Examples

#### Cisco IOS-XR VLAN Configuration
```json
{
  "operation": "sendConfig",
  "configCommands": "interface GigabitEthernet0/0/0/1\nencapsulation dot1q 100\nipv4 address 192.168.100.1/24\nno shutdown"
}
```

#### Cisco SG300 VLAN Creation
```json
{
  "operation": "sendConfig", 
  "configCommands": "vlan database\nvlan 100\nvlan name 100 \"Production_VLAN\"\nexit\ninterface gi1\nswitchport mode access\nswitchport access vlan 100"
}
```

## Architecture

The node is built with a modular architecture inspired by Python's Netmiko library, organized using vendor-specific directories:

### Directory Structure

```
nodes/NetDevices/utils/
├── base-connection.ts          # Core SSH functionality
├── connection-dispatcher.ts    # Factory for creating connections
├── index.ts                   # Main exports
├── cisco/                     # Cisco vendor implementation
│   ├── cisco-connection.ts
│   └── index.ts
├── juniper/                   # Juniper vendor implementation
│   ├── juniper-connection.ts
│   └── index.ts
└── linux/                     # Linux vendor implementation
    ├── linux-connection.ts
    └── index.ts
```

### Core Components

- **BaseConnection**: Core SSH functionality and common methods
- **CiscoConnection**: Cisco IOS/IOS-XE/NX-OS/ASA handling (enable mode, prompts)
- **CiscoIOSXRConnection**: Cisco IOS-XR specific handling (commit-based config)
- **CiscoSG300Connection**: Cisco SG300 series specific handling
- **JuniperConnection**: Juniper-specific handling (CLI mode, commit)
- **LinuxConnection**: Linux server management
- **ConnectionDispatcher**: Factory for creating appropriate connection types

### Adding New Vendors

See [VENDOR_GUIDE.md](VENDOR_GUIDE.md) for detailed instructions on adding support for new network device vendors following the established patterns.

## Error Handling

The node includes comprehensive error handling:
- Connection failures with retry logic
- Command execution errors
- Device-specific error detection
- Graceful disconnection on errors

## Development

### Prerequisites
- Node.js 18+
- TypeScript
- n8n development environment

### Building
```bash
npm install
npm run build
```

### Linting
```bash
npm run lint
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Run linting and build checks
6. Submit a pull request

## License

MIT License - see LICENSE.md for details

## Acknowledgments

This project was inspired by the Python Netmiko library and aims to bring similar functionality to the Node.js/TypeScript ecosystem for use with n8n automation workflows.
