#!/bin/bash
set -euo pipefail

# Build and package demo site for deployment
# Creates a tarball with landing page files ready for deployment

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Building demo site package..."

# The build host needs Node.js 20+, npm, and Git for the pinned controller package.
# Include dev dependencies even on production hosts: esbuild generates assets
# that are intentionally not checked into Git or rebuilt by the deployed server.
npm --prefix "$PROJECT_ROOT/landing-page" ci --include=dev
npm --prefix "$PROJECT_ROOT/landing-page" run build:browser-tools
for ASSET in browser-tools-bundle.js browser-tools-bundle.css; do
  if [[ ! -s "$PROJECT_ROOT/landing-page/public/$ASSET" ]]; then
    echo "Missing browser tools asset after build: $ASSET" >&2
    exit 1
  fi
done

DEPLOY_DIR="$PROJECT_ROOT/deploy-package-demo"
rm -rf "$DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR/landing-page/public"

# Copy landing page files
cp "$PROJECT_ROOT/landing-page/server.js" "$DEPLOY_DIR/landing-page/"
cp "$PROJECT_ROOT/landing-page/package.json" "$DEPLOY_DIR/landing-page/"
cp "$PROJECT_ROOT/landing-page/package-lock.json" "$DEPLOY_DIR/landing-page/"
cp -r "$PROJECT_ROOT/landing-page/public/"* "$DEPLOY_DIR/landing-page/public/"

# Create tarball
TARBALL="$PROJECT_ROOT/landing-page-build.tar.gz"
tar -czf "$TARBALL" -C "$DEPLOY_DIR" .

# Cleanup
rm -rf "$DEPLOY_DIR"

echo "Demo package created: $TARBALL"
