#!/bin/bash
set -euo pipefail

# Build and package reference server for deployment
# Creates a tarball with all pre-built artifacts ready for deployment

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "📦 Building deployment package for reference server..."

# Create deploy package directory
DEPLOY_DIR="$PROJECT_ROOT/deploy-package"
rm -rf "$DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR/reference-server"
mkdir -p "$DEPLOY_DIR/clients/typescript"
mkdir -p "$DEPLOY_DIR/spec"

# Copy workspace root manifests so remote npm ci uses the root lockfile.
cp "$PROJECT_ROOT/package.json" "$DEPLOY_DIR/"
cp "$PROJECT_ROOT/package-lock.json" "$DEPLOY_DIR/"

# Copy spec (needed as local dependency)
echo "  Copying spec..."
cp -r "$PROJECT_ROOT/spec/dist" "$DEPLOY_DIR/spec/"
cp "$PROJECT_ROOT/spec/package.json" "$DEPLOY_DIR/spec/"

# Copy typescript client (needed as local dependency)
echo "  Copying typescript client..."
cp -r "$PROJECT_ROOT/clients/typescript/dist" "$DEPLOY_DIR/clients/typescript/"
cp "$PROJECT_ROOT/clients/typescript/package.json" "$DEPLOY_DIR/clients/typescript/"

# Copy reference server built files
echo "  Copying reference server..."
cp -r "$PROJECT_ROOT/reference-server/dist" "$DEPLOY_DIR/reference-server/"
cp "$PROJECT_ROOT/reference-server/package.json" "$DEPLOY_DIR/reference-server/"
cp "$PROJECT_ROOT/reference-server/package-lock.json" "$DEPLOY_DIR/reference-server/"

# Copy runtime assets (embed files, etc.)
if [[ -d "$PROJECT_ROOT/reference-server/embed" ]]; then
    cp -r "$PROJECT_ROOT/reference-server/embed" "$DEPLOY_DIR/reference-server/"
fi

# Ship the exact harness-core CI installed, for hosts that cannot fetch it from GitHub.
for candidate in "$PROJECT_ROOT/reference-server/node_modules/@mieweb/harness-core" "$PROJECT_ROOT/node_modules/@mieweb/harness-core"; do
    if [[ -f "$candidate/package.json" ]]; then
        echo "  Copying harness-core from $candidate..."
        mkdir -p "$DEPLOY_DIR/vendor-deps"
        rsync -a --exclude node_modules "$candidate/" "$DEPLOY_DIR/vendor-deps/harness-core/"
        break
    fi
done

# Create tarball
TARBALL="$PROJECT_ROOT/reference-server-build.tar.gz"
echo "  Creating tarball..."
tar -czvf "$TARBALL" -C "$DEPLOY_DIR" .

# Show package contents
echo ""
echo "�� Package contents:"
tar -tzvf "$TARBALL"

# Cleanup
rm -rf "$DEPLOY_DIR"

echo ""
echo "✅ Deployment package created: $TARBALL"
