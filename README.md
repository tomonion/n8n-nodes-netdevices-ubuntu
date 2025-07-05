# n8n-nodes-demo-weather9

This is an n8n community node for fetching weather data using the OpenWeatherMap API.

![n8n](https://raw.githubusercontent.com/n8n-io/n8n/master/assets/n8n-logo.png)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Operations

- **Current Weather**: Get current weather data for a location
- **5 Day Forecast**: Get 5-day weather forecast for a location

## Location Options

- **City Name**: Search by city name (e.g., "Berlin")
- **City ID**: Use OpenWeatherMap city ID
- **Coordinates**: Use latitude and longitude coordinates
- **Zip Code**: Use zip code with country code (e.g., "10115,de")

## Credentials

This node requires an OpenWeatherMap API key. You can get one by:

1. Creating an account at [OpenWeatherMap](https://openweathermap.org/api)
2. Getting your free API key
3. Adding the API key to your n8n credentials

## Configuration

1. **Operation**: Choose between Current Weather or 5 Day Forecast
2. **Format**: Choose temperature and speed units (Imperial, Metric, or Scientific)
3. **Location Selection**: Choose how to specify the location
4. **Location Details**: Enter the city name, coordinates, etc. based on your selection
5. **Language**: (Optional) Two-letter language code for the response

## Example Usage

### Get Current Weather for Berlin
- Operation: Current Weather
- Format: Metric
- Location Selection: City Name
- City Name: Berlin

### Get 5-Day Forecast for New York
- Operation: 5 Day Forecast
- Format: Imperial
- Location Selection: City Name  
- City Name: New York

## Resources

- [OpenWeatherMap API Documentation](https://openweathermap.org/api)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)

## Version

0.1.0

## License

[MIT](LICENSE.md)
