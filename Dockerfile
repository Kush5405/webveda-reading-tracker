FROM node:20-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/tracker.db

WORKDIR /app

# Install production deps. better-sqlite3 normally downloads a prebuilt binary;
# build tools are installed only as a fallback for source builds, then removed
# in the same layer so they don't bloat the image.
COPY package*.json ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && npm ci --omit=dev \
    && npm cache clean --force \
    && apt-get purge -y --auto-remove python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY server/ ./server/
COPY public/ ./public/

# Writable data directory for the SQLite file, owned by the unprivileged user
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]FROM node:20-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/tracker.db

WORKDIR /app

# Install production deps. better-sqlite3 normally downloads a prebuilt binary;
# build tools are installed only as a fallback for source builds, then removed
# in the same layer so they don't bloat the image.
COPY package*.json ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && npm ci --omit=dev \
    && npm cache clean --force \
    && apt-get purge -y --auto-remove python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY server/ ./server/
COPY public/ ./public/

# Writable data directory for the SQLite file, owned by the unprivileged user
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
