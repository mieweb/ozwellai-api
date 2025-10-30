# Ozwell Public API Specification Repository

**ALWAYS follow these instructions first and fallback to additional search and context gathering only if the information in the instructions is incomplete or found to be in error.**

## Repository Overview
This public repository for Ozwell API is the canonical reference for the API, enabling both internal and external teams to build against a stable, well-documented contract.
The Ozwell API specification project is an open and reliable source of truth for all Ozwell API interactions. All types and endpoints are defined using [Zod](https://github.com/colinhacks/zod), ensuring type safety, clarity, and consistency. 

## Working Effectively
Make sure your code fits within the Planned Directory Structure (from README.md)
Use a single TypeScript codebase with ESM-first design, build outputs for both ESM and CJS along with type definitions, publish to npm for Node users, and also publish to JSR to provide first-class DX for Deno, while ensuring compatibility by testing across Node and Deno in CI.

## Documentation Preferences

### Diagrams and Visual Documentation
- **Always use Mermaid diagrams** instead of ASCII art for workflow diagrams, architecture diagrams, and flowcharts
- Use appropriate Mermaid diagram types:
  - `graph TB` or `graph LR` for workflow architectures
  - `flowchart TD` for process flows
  - `sequenceDiagram` for API interactions
  - `gitgraph` for branch/release strategies
- Include styling with `classDef` for better visual hierarchy
- Add descriptive comments and emojis for clarity
- Reference `.github/ARCHITECTURE.md` as an example of preferred Mermaid diagram style

### Documentation Standards
- Keep documentation DRY (Don't Repeat Yourself) - reference other docs instead of duplicating
- Use clear cross-references between related documentation files
- Update the main architecture document when workflow structure changes

## Working with GitHub Actions Workflows

### Development Philosophy
- **Script-first approach**: All workflows should call scripts that can be run locally
- **Local development parity**: Developers should be able to run the exact same commands locally as CI runs
- **Simple workflows**: GitHub Actions should be thin wrappers around scripts, not contain complex logic
- **Easy debugging**: When CI fails, developers can reproduce the issue locally by running the same script

### Script-Based Workflow Pattern
Instead of putting logic in YAML files, create scripts that workflows call:

```bash
# Local development - run the same commands as CI
./scripts/lint.sh
./scripts/build.sh  
./scripts/test.sh

# CI just calls the same scripts
# In GitHub Actions: run: ./scripts/test.sh
```

### Workflow Development Best Practices
- **Create executable scripts** in `/scripts/` directory for all CI operations
- **Make scripts cross-platform** (use Node.js scripts or bash with compatibility considerations)
- **Test scripts locally first** before creating workflows that call them
- **Keep workflows simple**: Just environment setup + script execution
- **Use consistent script naming**: `lint.sh`, `build.sh`, `test.sh`, `publish.sh`

### Local Testing Strategy
Prefer running scripts directly over using `act`:

```bash
# Instead of: act -W .github/workflows/typescript-client-ci.yml
# Do this: 
cd clients/typescript
../../scripts/lint.sh
../../scripts/build.sh
../../scripts/test.sh
```

### Script Development Process
1. **Design**: Plan what the script needs to do
2. **Implement**: Create the script in `/scripts/` directory
3. **Test locally**: Run the script in different environments/directories
4. **Make executable**: `chmod +x scripts/script-name.sh`
5. **Create workflow**: Simple YAML that calls the script
6. **Document**: Add script usage to component README

### Script Guidelines
- Make scripts idempotent (safe to run multiple times)
- Include proper error handling with meaningful exit codes
- Accept parameters for customization (working directory, test patterns, etc.)
- Print clear status messages for debugging
- Work from any directory (use relative paths properly)


## Working with Specifications

### When Creating Zod Definitions
- Update the `/spec` directory first.
- Use TypeScript files with `.ts` extension
- Follow Zod best practices for type definitions
- Document any Ozwell-specific extensions clearly

### When Adding New Endpoints
- Always reference the OpenAI API documentation for compatibility
- Add IndexedCP-specific endpoints separately from OpenAI-compatible ones
- Include conversation management endpoints for multi-user scenarios
- Document the purpose and usage of each endpoint

### When Setting Up Build System
- Use Node.js/npm ecosystem (inferred from .gitignore patterns)
- Include TypeScript compilation for Zod definitions
- Set up OpenAPI generation from Zod schemas
- Configure linting and formatting tools

## Validation Steps

### Before Making Changes
- Read README.md thoroughly to understand current project state
- Check if planned directories exist yet: `ls -la`
- Understand which development phase the repository is in

### After Creating New Structure
- Validate directory structure matches README.md documentation
- Ensure new files follow the established patterns
- Update documentation if directory structure changes

### Future Build/Test Commands (When Implemented)
These commands will be added once the build system is established:
- Install dependencies: `npm install` (when package.json exists)
- Run type checking: `npm run type-check` (when configured)
- Generate OpenAPI docs: `npm run generate-docs` (when configured)  
- Run validation: `npm run validate` (when configured)
- Run tests: `npm test` (when test suite exists)

## Key Files and Locations

### Current Files
- `README.md` - Project overview and planned structure
- `LICENSE` - Apache 2.0 license
- `.gitignore` - Node.js focused ignore patterns
- `.github/copilot-instructions.md` - This file
- `.github/ARCHITECTURE.md` - Workflow architecture documentation with Mermaid diagrams
- `.github/workflows/` - GitHub Actions CI/CD workflows
- `RELEASE.md` - Release process documentation

### Implemented Locations
- `/spec/` - Core API type definitions (Zod schemas) ✅
- `/reference-server/` - Fastify test server implementation ✅
- `/clients/typescript/` - TypeScript client library ✅

### Future Important Locations
- `/scripts/` - Build, test, and deployment scripts (CI calls these) 🎯
- `/clients/python/` - Python client library
- `/tests/` - Test cases and fixtures
- `CONTRIBUTING.md` - Contribution guidelines (planned)

## Common Tasks

### Repository Exploration
```bash
# View all files
ls -la

# Find all markdown files  
find . -name "*.md" -type f

# Check for development indicators
grep -r "TODO\|HACK\|FIXME" . || true

# View project overview
cat README.md | head -20
```

Always reference README.md for the most current project status and priorities.
