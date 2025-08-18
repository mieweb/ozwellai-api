# Release Process

This document explains how to release new versions of the Ozwell API project.

## TL;DR

**Interactive Release (Recommended):**
```bash
./scripts/release.sh
```

**Manual Release:**
```bash
# 1. Create and push tag
git tag v1.0.4 && git push origin v1.0.4

# 2. Create GitHub release (triggers automatic publishing)
gh release create v1.0.4 --title "v1.0.4" --notes "Release notes here"
```

**Debug Issues:**
```bash
# Test the complete release process locally
./scripts/release.sh

# Test individual publishing steps
DRY_RUN=true ./scripts/publish-client.sh 1.0.0
```

## Overview

The Ozwell API project uses an interactive, script-first release process with automatic publishing to npm and JSR. This provides:

- **Interactive Release Script**: `./scripts/release.sh` guides you through the entire process
- **Explicit "go" button**: Only publish when you create a GitHub release
- **Immutable provenance**: Each release is tied to a specific git tag with cryptographic attestation
- **Version validation**: Automatic semantic version checking and suggestions
- **Release notes generation**: Auto-generated from git history with editing capabilities
- **Cross-platform publishing**: Simultaneous npm and JSR publishing with full provenance

## Release Methods

### Method 1: Interactive Script (Recommended)

Run the interactive release script:

```bash
./scripts/release.sh
```

The script will:
1. ✅ Check prerequisites (git status, authentication, etc.)
2. 📝 Help you select the next version (suggests patch increment)
3. 📖 Generate release notes from git history
4. 🏷️ Create and push git tag
5. 🎉 Create GitHub release (triggers automated publishing)

### Method 2: Manual Process

If you prefer manual control:

#### 1. Create a Git Tag

Create a semantic version tag. The tag must match the pattern `v{major}.{minor}.{patch}`:

```bash
git tag v1.0.4
git push origin v1.0.4
```

#### 2. Create a GitHub Release

```bash
# Using GitHub CLI (recommended)
gh release create v1.0.4 --title "v1.0.4" --notes "Release notes here"

# Or via web interface at:
# https://github.com/mieweb/ozwellai-api/releases/new
```

#### 3. Automated Publishing

Once the release is created, GitHub Actions automatically:
- ✅ Runs complete test suite
- 📦 Publishes TypeScript client to npm
- 🦕 Publishes to JSR with cryptographic provenance
- 🐳 Publishes reference server Docker images

## Script Features

The interactive release script (`./scripts/release.sh`) provides:

### ✅ Prerequisites Check
- Validates git repository state and working directory cleanliness
- Ensures you're on the correct branch (warns if not `main`)
- Checks GitHub CLI availability and authentication
- Verifies all dependencies are installed

### 📝 Interactive Version Selection
- Shows current version from git tags
- Suggests next patch version automatically
- Validates semantic version format (major.minor.patch)
- Prevents duplicate tags and provides helpful error messages
- Supports pre-release versions (beta, rc, alpha)

### 📖 Release Notes Generation
- Auto-generates notes with commit history since last release
- Includes standard publishing information
- Allows editing with your preferred editor (`$EDITOR` or nano)
- Templates with consistent formatting

### 🏷️ Git Tag Management
- Creates annotated git tags with proper messages
- Pushes tags to origin automatically
- Follows `v1.0.0` format for consistency

### 🎉 GitHub Release Creation
- Uses GitHub CLI when available for seamless integration
- Falls back to manual instructions with specific URLs
- Includes formatted release notes
- Triggers automated publishing workflow immediately

## Local Testing

You can test parts of the release process locally:

### Test the Release Script
```bash
# Run the interactive script (will stop before actually creating releases)
./scripts/release.sh
```

### Test Individual Components
```bash
# Test the publishing workflow (dry run - won't actually publish)
DRY_RUN=true ./scripts/publish-client.sh 1.0.4

# Test TypeScript client build
cd clients/typescript && npm run build

# Test reference server
cd reference-server && npm test
```

### Verify Current State
```bash
# Check current version
git tag -l --sort=-version:refname | head -n1

# Check repository status
git status

# Verify authentication
gh auth status
```

## Verification

After the workflow completes, verify packages were published:

- **npm**: https://www.npmjs.com/package/@ozwell/api
- **JSR**: https://jsr.io/@ozwell/api (with green "Has provenance" badge)
- **Docker**: GitHub Container Registry for reference server

## Pre-release Versions

For beta/RC releases, use pre-release tags:

```bash
git tag v1.0.0-beta.1
git push origin v1.0.0-beta.1
```

When creating the GitHub release, check the "Set as a pre-release" option.

## Troubleshooting

### Script Issues

#### "Working directory is not clean"
```bash
# Check what files are modified
git status

# Commit or stash changes
git add -A && git commit -m "Prepare for release"
# OR
git stash
```

#### "Tag already exists"
```bash
# List existing tags
git tag -l

# Delete local tag if needed
git tag -d v1.0.4

# Delete remote tag if needed (careful!)
git push origin --delete v1.0.4
```

#### "GitHub CLI not authenticated"
```bash
# Authenticate with GitHub
gh auth login

# Verify authentication
gh auth status
```

### Workflow Issues

#### Publishing Failures
- Test locally: `DRY_RUN=true ./scripts/publish-client.sh 1.0.4`
- Check that the `NPM_TOKEN` secret is configured in GitHub repository settings
- Verify JSR permissions are properly set in workflow
- Ensure package names aren't already taken

#### Build Failures
- Check TypeScript compilation: `cd clients/typescript && npm run build`
- Verify all tests pass: `cd clients/typescript && npm test`
- Confirm dependencies are installed: `npm ci`

#### Version Validation Failures
- Use the release script for automatic validation: `./scripts/release.sh`
- Ensure tags follow semantic versioning (e.g., `v1.0.4`, not `version-1.0`)
- Check that there are no extra characters or spaces in tags

### Recovery Steps

If a release partially fails:

1. **Tag created but GitHub release failed**: Create the GitHub release manually
2. **npm publishing failed**: Re-run the workflow or check npm token configuration  
3. **JSR publishing failed**: Verify deno.json configuration and workflow permissions

For major issues, you can always delete tags and start over:
```bash
# Delete tag locally and remotely
git tag -d v1.0.4
git push origin --delete v1.0.4

# Start fresh with a new version
./scripts/release.sh
```

## Workflow Architecture

For detailed information about our CI/CD architecture, including workflow relationships, reusable patterns, and the complete publishing pipeline, see [**Workflow Architecture**](.github/ARCHITECTURE.md).

**Quick Summary:**
- **CI workflows** run on every push/PR for fast feedback
- **Publish workflows** run only on GitHub releases for controlled publishing  
- **Reusable test workflows** ensure consistency across all pipelines
- **Script-first approach** allows local testing before pushing changes

**Key Scripts:**
- `./scripts/release.sh` - Interactive release with version selection and GitHub release creation
- `./scripts/publish-client.sh` - Publish TypeScript client to npm and JSR
- Various test and build scripts for local development and CI/CD

This script-first approach ensures that all release operations can be performed and tested locally, making debugging easier and reducing dependency on external services.
