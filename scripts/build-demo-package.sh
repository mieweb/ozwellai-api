#!/bin/bash
set -euo pipefail

# Build and package demo site for deployment
# Creates a tarball with landing page files ready for deployment

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Building demo site package..."

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
