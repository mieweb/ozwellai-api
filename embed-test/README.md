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

Multiple demos showing MCP tool execution via iframe-sync and postMessage:

**Landing Page** (`/`)
- Live event log showing complete message flow
- Architecture diagram and integration guide
- Three MCP tools: update name, address, zip code
- Mode switching between mock AI (default) and Ollama

**Tic-Tac-Toe** (`/tictactoe.html`)
- Play tic-tac-toe using natural language
- Two MCP tools: make_move, reset_game
- AI opponent with strategic logic
- Game over detection with animations
- Mode switching between mock AI (default) and Ollama

## Mode Switching

Change one line to switch between mock AI and Ollama:

**Landing page:** Edit `public/landing.html` line 186
**Tic-tac-toe:** Edit `public/tictactoe.html` line 101

```javascript
const AI_MODE = 'mock';   // Keyword-based responses, no dependencies
const AI_MODE = 'ollama'; // Real LLM (requires Ollama + llama3.1:8b model)
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` or `EMBED_TEST_PORT` | `8080` | Server port |
| `REFERENCE_SERVER_URL` | `http://localhost:3000` | Reference server base URL |

## Pages

- `/` - Landing page demo (mock AI by default)
- `/landing.html` - Same as root
- `/tictactoe.html` - Tic-tac-toe game demo (mock AI by default)

For full widget documentation: [../reference-server/embed/README.md](../reference-server/embed/README.md)
