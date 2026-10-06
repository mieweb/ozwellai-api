# Multi-stage build for OzwellAI Reference Server
FROM node:22-alpine AS builder

# Set working directory
WORKDIR /app

# @mieweb/harness-core is a private git dependency; npm fetches it over SSH, so the build
# needs git + openssh and a credential that can read mieweb/harness-core. Build with one of:
#   docker build --secret id=harness_core_ssh_key,src=<private-key-file> ...
#   docker build --secret id=github_token,src=<file-with-fine-grained-PAT> ...
RUN apk add --no-cache git openssh-client

# Copy package files for better caching
COPY spec/package*.json ./spec/
COPY reference-server/package*.json ./reference-server/
COPY scripts/ci/git-auth-harness-core.sh ./scripts/ci/

# Install dependencies
RUN cd spec && npm ci --only=production
RUN --mount=type=secret,id=harness_core_ssh_key --mount=type=secret,id=github_token \
    HARNESS_CORE_SSH_KEY="$(cat /run/secrets/harness_core_ssh_key 2>/dev/null || true)" \
    HARNESS_CORE_TOKEN="$(cat /run/secrets/github_token 2>/dev/null || true)" \
    sh -c '. ./scripts/ci/git-auth-harness-core.sh; cd reference-server && npm ci --only=production' && \
    rm -rf /root/.gitconfig /root/.ssh

# Copy source code
COPY spec/ ./spec/
COPY reference-server/ ./reference-server/

# Build the spec first
RUN cd spec && npm run build

# Build the reference server
RUN cd reference-server && npm run build

# Production stage
FROM node:22-alpine AS production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S ozwell -u 1001

RUN apk add --no-cache git openssh-client

# Set working directory
WORKDIR /app

# Copy built application
COPY --from=builder --chown=ozwell:nodejs /app/spec/dist ./spec/dist
COPY --from=builder --chown=ozwell:nodejs /app/spec/package*.json ./spec/
COPY --from=builder --chown=ozwell:nodejs /app/reference-server/dist ./reference-server/dist
COPY --from=builder --chown=ozwell:nodejs /app/reference-server/package*.json ./reference-server/
COPY --from=builder --chown=ozwell:nodejs /app/reference-server/data ./reference-server/data

# Install only production dependencies
RUN cd spec && npm ci --only=production && npm cache clean --force
COPY --from=builder /app/scripts/ci/git-auth-harness-core.sh ./scripts/ci/
RUN --mount=type=secret,id=harness_core_ssh_key --mount=type=secret,id=github_token \
    HARNESS_CORE_SSH_KEY="$(cat /run/secrets/harness_core_ssh_key 2>/dev/null || true)" \
    HARNESS_CORE_TOKEN="$(cat /run/secrets/github_token 2>/dev/null || true)" \
    sh -c '. ./scripts/ci/git-auth-harness-core.sh; cd reference-server && npm ci --only=production && npm cache clean --force' && \
    rm -rf /root/.gitconfig /root/.ssh ./scripts/ci

# Switch to non-root user
USER ozwell

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Start the server
WORKDIR /app/reference-server
CMD ["npm", "start"]
