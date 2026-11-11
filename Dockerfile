# Use a supported Node LTS runtime and current patched Alpine packages.
FROM node:24.22.2-alpine3.24@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8

# Install init tooling and pull in the latest patched Alpine packages.
RUN apk upgrade --no-cache && \
    apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy package files as root
COPY package.json package-lock.json* ./

# Install dependencies from lockfile for reproducible builds
RUN npm ci --omit=dev && \
    npm cache clean --force

# Copy application code
COPY --chown=nodejs:nodejs . .

# The runtime image does not need the full npm CLI or the development manifest.
RUN node -e "const fs = require('node:fs'); const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')); fs.writeFileSync('package.json', JSON.stringify({ name: pkg.name, version: pkg.version, type: pkg.type, private: true }, null, 2) + '\n');" && \
    rm -f package-lock.json && \
    rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack && \
    rm -rf /usr/local/lib/node_modules/npm

# Remove sensitive files if they exist
RUN rm -f .env .env.* && \
    rm -rf .git

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3001

# Runtime-configurable health check so worker and api can share one image safely.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http=require('http'); const port=process.env.HEALTHCHECK_PORT||process.env.PORT||3001; const path=process.env.HEALTHCHECK_PATH||'/api/health'; const url='http://127.0.0.1:'+port+path; http.get(url, (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start application (ESM)
CMD ["node", "src/app/server.js"]
