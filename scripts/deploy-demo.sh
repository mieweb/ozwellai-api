#!/bin/bash
set -euo pipefail

# Deploy landing page demo site
# This script deploys the landing page to the demo server using PM2
# Can be run locally for testing or by CI workflows

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LANDING_PAGE_DIR="$PROJECT_ROOT/landing-page"

echo "🚀 Deploying demo site..."
echo "📁 Working directory: $LANDING_PAGE_DIR"

# Change to landing page directory
cd "$LANDING_PAGE_DIR"

# Install dependencies
echo "📦 Installing dependencies..."
npm ci

# Verify code syntax before deploying
echo "🔍 Verifying server code syntax..."
node --check server.js || { echo "❌ server.js syntax check failed!"; exit 1; }

# Check that all critical public assets exist
echo "✅ Checking critical assets..."
critical_assets=(
    "public/landing.html"
    "public/landing.js"
    "public/demo.css"
    "public/tictactoe.html"
    "public/tictactoe-app.js"
    "public/tictactoe.css"
)

for asset in "${critical_assets[@]}"; do
    if [[ ! -f "$asset" ]]; then
        echo "❌ Missing $asset!"
        exit 1
    fi
    echo "  ✓ $asset"
done

# Restart landing page server with environment variable
echo "🔄 Restarting PM2 service..."
pm2 stop embedtest || true
pm2 delete embedtest || true

# Set reference server URL (use provided value or default)
REFERENCE_SERVER_URL="${REFERENCE_SERVER_URL:-https://ozwellai-reference-server.opensource.mieweb.org}"
echo "🌐 Using reference server: $REFERENCE_SERVER_URL"

REFERENCE_SERVER_URL=$REFERENCE_SERVER_URL pm2 start server.js --name embedtest
pm2 save

# Verify deployment
echo "📊 PM2 Status:"
pm2 status

echo "✅ Demo site deployed successfully!"
echo ""
echo "Next steps:"
echo "  • Visit the demo site to verify it's working"
echo "  • Check PM2 logs with: pm2 logs embedtest"
