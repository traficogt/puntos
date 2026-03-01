# Use specific version for reproducibility
FROM node:20.11.0-alpine3.19

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

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
