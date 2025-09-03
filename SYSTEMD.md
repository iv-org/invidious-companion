# Systemd Service Installation

This directory contains a systemd service file for running invidious-companion as a system service.

## Prerequisites

1. Create a dedicated user and group:
```bash
sudo useradd -r -s /bin/false invidious
```

2. Create necessary directories:
```bash
sudo mkdir -p /home/invidious/invidious-companion
sudo mkdir -p /home/invidious/tmp
sudo mkdir -p /var/tmp/youtubei.js
sudo chown -R invidious:invidious /home/invidious
sudo chown invidious:invidious /var/tmp/youtubei.js
```

## Installation

1. Compile the invidious-companion binary:
```bash
deno task compile
```

2. Copy the binary to the service directory:
```bash
sudo cp invidious_companion /home/invidious/invidious-companion/
sudo chown invidious:invidious /home/invidious/invidious-companion/invidious_companion
sudo chmod +x /home/invidious/invidious-companion/invidious_companion
```

3. Copy configuration if needed:
```bash
# Copy your config.toml to /home/invidious/invidious-companion/config/config.toml
# Or use environment variables in the service file
```

4. Install the systemd service:
```bash
sudo cp invidious-companion.service /etc/systemd/system/
sudo systemctl daemon-reload
```

5. Enable and start the service:
```bash
sudo systemctl enable invidious-companion.service
sudo systemctl start invidious-companion.service
```

## Configuration

The service is configured to:
- Run as the `invidious` user for security
- Use a Unix domain socket at `/home/invidious/tmp/invidious-companion.sock`
- Cache YouTube data in `/var/tmp/youtubei.js`
- Apply strict security restrictions similar to inv_sig_helper
- Use Tor SOCKS proxy for YouTube requests (optional)

You can modify the environment variables in the service file or use a configuration file.

### Proxy Configuration

The service is pre-configured to use a Tor SOCKS proxy to bypass potential network restrictions when accessing YouTube. To use this feature:

1. Install and start Tor:
```bash
sudo apt install tor
sudo systemctl enable tor@default
sudo systemctl start tor@default
```

2. The service file includes proxy configuration for:
   - Tor daemon: `PROXY=socks5://127.0.0.1:9050` (default)
   - Tor Browser: `PROXY=socks5://127.0.0.1:9150` (alternative)

3. To disable proxy, comment out or remove the `Environment=PROXY=...` line in the service file.

Other supported proxy formats:
- HTTP proxy: `PROXY=http://proxy.example.com:8080`
- HTTPS proxy: `PROXY=https://proxy.example.com:8080`
- SOCKS4 proxy: `PROXY=socks4://127.0.0.1:1080`

## Monitoring

Check service status:
```bash
sudo systemctl status invidious-companion.service
```

View logs:
```bash
sudo journalctl -u invidious-companion.service -f
```