# Use a current Node 20 + Alpine base with recent security fixes.
FROM node:20-alpine3.21

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

# Health check (routes are mounted under /api)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start application (ESM)
CMD ["node", "src/app/server.js"]
