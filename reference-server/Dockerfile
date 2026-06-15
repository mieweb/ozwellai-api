# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY spec/package*.json ./spec/
COPY clients/typescript/package*.json ./clients/typescript/
COPY reference-server/package*.json ./reference-server/

RUN cd spec && npm ci
RUN cd clients/typescript && npm ci
RUN cd reference-server && npm ci

COPY spec/ ./spec/
COPY clients/typescript/ ./clients/typescript/
COPY reference-server/ ./reference-server/

RUN cd spec && npm run build
RUN cd clients/typescript && npm run build
RUN cd reference-server \
  && npm run build \
  && npm prune --omit=dev \
  && npm cache clean --force

FROM node:20-bookworm-slim AS production

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATA_DIR=/data
ENV DB_PATH=/data/ozwell.db

WORKDIR /app

RUN groupadd --gid 1001 ozwell \
  && useradd --uid 1001 --gid ozwell --home-dir /app --shell /usr/sbin/nologin ozwell \
  && mkdir -p /data /app \
  && chown -R ozwell:ozwell /data /app

COPY --from=build --chown=ozwell:ozwell /app/spec/package*.json ./spec/
COPY --from=build --chown=ozwell:ozwell /app/spec/dist ./spec/dist
COPY --from=build --chown=ozwell:ozwell /app/clients/typescript/package*.json ./clients/typescript/
COPY --from=build --chown=ozwell:ozwell /app/clients/typescript/dist ./clients/typescript/dist
COPY --from=build --chown=ozwell:ozwell /app/reference-server/package*.json ./reference-server/
COPY --from=build --chown=ozwell:ozwell /app/reference-server/node_modules ./reference-server/node_modules
COPY --from=build --chown=ozwell:ozwell /app/reference-server/dist ./reference-server/dist
COPY --from=build --chown=ozwell:ozwell /app/reference-server/embed ./reference-server/embed

USER ozwell

WORKDIR /app/reference-server

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "start"]
