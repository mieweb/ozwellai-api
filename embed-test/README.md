# Ozwell Chat Widget - Embed Test Host

Demo server showing the chat widget integration.

## Quick Start

```bash
npm install
PORT=8080 REFERENCE_SERVER_URL=https://ozwellai-reference-server.opensource.mieweb.org npm start
```

Visit http://localhost:8080

### Deployment with PM2 (Limited Resources)

For containers with limited memory:

```bash
PORT=8080 REFERENCE_SERVER_URL=https://ozwellai-reference-server.opensource.mieweb.org \
  pm2 start server.js --name embedtest --max-memory-restart 300M
pm2 save
pm2 startup  # Follow printed command
```

## Live Demo

https://ozwellai-embedtest.opensource.mieweb.org

## What This Does

Minimal Express server demonstrating widget integration:
- Serves demo page with widget embedded
- Shows widget events in real-time
- Demonstrates `window.OzwellChatConfig` setup

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` or `EMBED_TEST_PORT` | `8080` | Server port |
| `REFERENCE_SERVER_URL` | `http://localhost:3000` | Reference server base URL |

## Integration Example

See `public/index.html` for working example of widget setup and event handling.

For full widget documentation: [../reference-server/embed/README.md](../reference-server/embed/README.md)
