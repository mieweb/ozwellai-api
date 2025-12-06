#!/bin/bash
# Start both the reference server and landing page server for embed testing
# Kills any existing processes on the required ports first

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

REFERENCE_PORT=${REFERENCE_PORT:-3000}
LANDING_PORT=${LANDING_PORT:-8080}
OLLAMA_PORT=${OLLAMA_PORT:-11434}
OLLAMA_BASE_URL=${OLLAMA_BASE_URL:-"http://127.0.0.1:$OLLAMA_PORT"}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Starting Ozwell development servers...${NC}"

# Check if Ollama is running
check_ollama() {
    if curl -s --connect-timeout 2 "$OLLAMA_BASE_URL/api/tags" > /dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

OLLAMA_AVAILABLE=false
if check_ollama; then
    OLLAMA_AVAILABLE=true
    echo -e "${GREEN}✓ Ollama detected at $OLLAMA_BASE_URL${NC}"
    # Get available models
    OLLAMA_MODELS=$(curl -s "$OLLAMA_BASE_URL/api/tags" 2>/dev/null | grep -o '"name":"[^"]*"' | head -5 | sed 's/"name":"//g' | sed 's/"//g' | tr '\n' ', ' | sed 's/,$//')
    if [ -n "$OLLAMA_MODELS" ]; then
        echo -e "${BLUE}  Available models: $OLLAMA_MODELS${NC}"
    fi
else
    echo -e "${YELLOW}⚠ Ollama not detected (checked $OLLAMA_BASE_URL)${NC}"
    echo -e "${YELLOW}  Using mock responses. Start Ollama for real AI responses.${NC}"
fi

# Function to kill process on a port
kill_port() {
    local port=$1
    local pids=$(lsof -ti :$port 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo -e "${YELLOW}Killing existing process(es) on port $port: $pids${NC}"
        echo "$pids" | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
}

# Kill existing processes on both ports
kill_port $REFERENCE_PORT
kill_port $LANDING_PORT

# Install and build the TypeScript client (reference server depends on it)
echo -e "${GREEN}Installing and building TypeScript client...${NC}"
cd "$PROJECT_ROOT/clients/typescript"
npm install
npm run build

# Start reference server
echo -e "${GREEN}Starting reference server on port $REFERENCE_PORT...${NC}"
cd "$PROJECT_ROOT/reference-server"
npm install
OLLAMA_BASE_URL="$OLLAMA_BASE_URL" npm run dev &
REFERENCE_PID=$!

# Wait for reference server to start
sleep 2

# Start landing page server
echo -e "${GREEN}Starting landing page server on port $LANDING_PORT...${NC}"
cd "$PROJECT_ROOT/landing-page"
npm install
REFERENCE_SERVER_URL="http://localhost:$REFERENCE_PORT" node server.js &
LANDING_PID=$!

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Servers started!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "Reference server: ${YELLOW}http://localhost:$REFERENCE_PORT${NC}"
echo -e "Landing page:     ${YELLOW}http://localhost:$LANDING_PORT${NC}"
echo ""
echo -e "Embed widget:     ${YELLOW}http://localhost:$REFERENCE_PORT/embed/ozwell-loader.js${NC}"
echo ""
if [ "$OLLAMA_AVAILABLE" = true ]; then
    echo -e "${GREEN}Ollama:           ✓ Connected at $OLLAMA_BASE_URL${NC}"
    echo -e "${BLUE}  Tip: Use 'Authorization: Bearer ollama' header to proxy to Ollama${NC}"
else
    echo -e "${YELLOW}Ollama:           ✗ Not running (mock responses enabled)${NC}"
    echo -e "${BLUE}  Tip: Start Ollama with 'ollama serve' for real AI responses${NC}"
fi
echo ""
echo -e "Press ${RED}Ctrl+C${NC} to stop both servers"
echo ""

# Handle Ctrl+C to kill both servers
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down servers...${NC}"
    kill $REFERENCE_PID 2>/dev/null || true
    kill $LANDING_PID 2>/dev/null || true
    exit 0
}

trap cleanup SIGINT SIGTERM

# Wait for both processes
wait
