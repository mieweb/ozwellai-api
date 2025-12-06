#!/bin/bash
set -euo pipefail

# Run E2E tests for the landing page with Playwright
# This script handles the complete E2E test setup and execution

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SPEC_DIR="$PROJECT_ROOT/spec"
REF_SERVER_DIR="$PROJECT_ROOT/reference-server"
CLIENT_DIR="$PROJECT_ROOT/clients/typescript"
LANDING_DIR="$PROJECT_ROOT/landing-page"

echo "🧪 Running Landing Page E2E Tests..."

# Build spec first
echo "📦 Building spec..."
cd "$SPEC_DIR"
if [[ ! -d "node_modules" ]]; then
    npm ci
fi
npm run build

# Build TypeScript client
echo "📦 Building TypeScript client..."
cd "$CLIENT_DIR"
if [[ ! -d "node_modules" ]]; then
    npm ci
fi
npm run build
npm link

# Build reference server
echo "📦 Building reference server..."
cd "$REF_SERVER_DIR"
if [[ ! -d "node_modules" ]]; then
    npm ci
fi
npm link ozwellai
npm run build

# Install landing page dependencies and Playwright
echo "📦 Installing landing page dependencies..."
cd "$LANDING_DIR"
if [[ ! -d "node_modules" ]]; then
    npm ci
fi

# Install Playwright browsers
echo "🌐 Installing Playwright browsers..."
npx playwright install chromium --with-deps

# Run E2E tests
echo "🎭 Running Playwright E2E tests..."
npm test

echo "✅ E2E tests completed successfully!"
