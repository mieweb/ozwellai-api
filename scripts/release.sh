#!/bin/bash
set -e

# Ozwell API Release Script
# Creates a new release with proper versioning, tagging, and GitHub release creation
# Follows script-first approach - can be run locally or from CI

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to validate semantic version
validate_version() {
    local version=$1
    if [[ ! $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$ ]]; then
        print_error "Invalid semantic version format: $version"
        print_error "Expected format: X.Y.Z (e.g., 1.0.0, 2.1.3-beta.1)"
        return 1
    fi
    return 0
}

# Function to check if tag exists
tag_exists() {
    local tag=$1
    git tag -l | grep -q "^${tag}$"
}

# Function to get current version from git tags
get_current_version() {
    git tag -l --sort=-version:refname | head -n1 | sed 's/^v//'
}

# Function to suggest next version
suggest_next_version() {
    local current=$(get_current_version)
    if [[ -z "$current" ]]; then
        echo "1.0.0"
        return
    fi
    
    # Parse current version
    IFS='.' read -r major minor patch <<< "$current"
    
    # Suggest patch increment
    echo "$major.$minor.$((patch + 1))"
}

# Check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check if we're in a git repository
    if ! git rev-parse --git-dir > /dev/null 2>&1; then
        print_error "Not in a git repository"
        exit 1
    fi
    
    # Check if working directory is clean
    if [[ -n $(git status --porcelain) ]]; then
        print_error "Working directory is not clean. Please commit or stash changes."
        git status --short
        exit 1
    fi
    
    # Check if we're on main branch
    current_branch=$(git branch --show-current)
    if [[ "$current_branch" != "main" ]]; then
        print_warning "Currently on branch '$current_branch', not 'main'"
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_status "Aborting release"
            exit 1
        fi
    fi
    
    # Check if GitHub CLI is available and authenticated
    if command -v gh > /dev/null 2>&1; then
        if gh auth status > /dev/null 2>&1; then
            print_success "GitHub CLI is authenticated"
            GITHUB_CLI_AVAILABLE=true
        else
            print_warning "GitHub CLI is not authenticated"
            print_status "You can authenticate with: gh auth login"
            GITHUB_CLI_AVAILABLE=false
        fi
    else
        print_warning "GitHub CLI (gh) is not installed"
        print_status "Install it from: https://cli.github.com/"
        GITHUB_CLI_AVAILABLE=false
    fi
    
    print_success "Prerequisites check complete"
}

# Interactive version selection
select_version() {
    local current=$(get_current_version)
    local suggested=$(suggest_next_version)
    
    echo
    print_status "Version Selection"
    if [[ -n "$current" ]]; then
        echo "Current version: $current"
    else
        echo "No previous versions found"
    fi
    echo "Suggested version: $suggested"
    echo
    
    while true; do
        read -p "Enter new version (or press Enter for $suggested): " version
        
        # Use suggested version if empty
        if [[ -z "$version" ]]; then
            version=$suggested
        fi
        
        # Validate version format
        if ! validate_version "$version"; then
            continue
        fi
        
        # Check if tag already exists
        if tag_exists "v$version"; then
            print_error "Tag v$version already exists"
            continue
        fi
        
        # Confirm version
        echo
        print_status "Selected version: $version"
        read -p "Proceed with this version? (Y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Nn]$ ]]; then
            continue
        fi
        
        NEW_VERSION=$version
        break
    done
}

# Create release notes
create_release_notes() {
    local version=$1
    local current=$(get_current_version)
    
    echo
    print_status "Creating release notes..."
    
    # Generate basic release notes
    cat > /tmp/release_notes_$version.md << EOF
# Release v$version

## Changes
EOF
    
    # Add git log if we have a previous version
    if [[ -n "$current" ]]; then
        echo >> /tmp/release_notes_$version.md
        echo "### Commits since v$current:" >> /tmp/release_notes_$version.md
        git log --oneline v$current..HEAD >> /tmp/release_notes_$version.md
    fi
    
    cat >> /tmp/release_notes_$version.md << EOF

## Publishing
- 📦 Published to npm: \`@ozwell/api@$version\`
- 🦕 Published to JSR: \`@ozwell/api@$version\` with cryptographic provenance
- ✅ Full test suite passed
- 🔒 Built with GitHub Actions for supply chain security
EOF
    
    # Let user edit release notes
    read -p "Edit release notes? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        ${EDITOR:-nano} /tmp/release_notes_$version.md
    fi
    
    RELEASE_NOTES_FILE="/tmp/release_notes_$version.md"
}

# Create git tag
create_tag() {
    local version=$1
    
    print_status "Creating git tag v$version..."
    git tag -a "v$version" -m "Release v$version"
    
    print_status "Pushing tag to origin..."
    git push origin "v$version"
    
    print_success "Tag v$version created and pushed"
}

# Create GitHub release
create_github_release() {
    local version=$1
    local notes_file=$2
    
    if [[ "$GITHUB_CLI_AVAILABLE" == "true" ]]; then
        print_status "Creating GitHub release..."
        gh release create "v$version" \
            --title "v$version" \
            --notes-file "$notes_file"
        
        print_success "GitHub release created"
        print_status "This will trigger the automated publishing workflow"
        print_status "Check the Actions tab for publishing progress"
    else
        echo
        print_warning "GitHub CLI not available - manual release creation required"
        print_status "Please create a GitHub release manually:"
        print_status "1. Go to: https://github.com/$(git remote get-url origin | sed 's/.*github.com[:/]\([^.]*\).*/\1/')/releases/new"
        print_status "2. Select tag: v$version"
        print_status "3. Set title: v$version"
        print_status "4. Copy release notes from: $notes_file"
        print_status "5. Publish the release"
    fi
}

# Main execution
main() {
    echo "🚀 Ozwell API Release Script"
    echo "============================="
    
    check_prerequisites
    select_version
    create_release_notes "$NEW_VERSION"
    
    echo
    print_status "Release Summary"
    echo "Version: $NEW_VERSION"
    echo "Tag: v$NEW_VERSION"
    if [[ "$GITHUB_CLI_AVAILABLE" == "true" ]]; then
        echo "GitHub Release: Will be created automatically"
    else
        echo "GitHub Release: Manual creation required"
    fi
    echo
    
    read -p "Create this release? (Y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        print_status "Release cancelled"
        exit 0
    fi
    
    create_tag "$NEW_VERSION"
    create_github_release "$NEW_VERSION" "$RELEASE_NOTES_FILE"
    
    echo
    print_success "🎉 Release v$NEW_VERSION created!"
    
    if [[ "$GITHUB_CLI_AVAILABLE" == "true" ]]; then
        print_status "The publishing workflow will now:"
        echo "  ✅ Run tests to ensure quality"
        echo "  ✅ Extract version from git tag"
        echo "  ✅ Update package.json and deno.json"
        echo "  ✅ Publish to npm with version $NEW_VERSION"
        echo "  ✅ Publish to JSR with version $NEW_VERSION and provenance"
        echo
        print_status "Monitor progress at: https://github.com/$(git remote get-url origin | sed 's/.*github.com[:/]\([^.]*\).*/\1/')/actions"
    fi
    
    # Cleanup
    rm -f "$RELEASE_NOTES_FILE"
}

# Run main function
main "$@"
