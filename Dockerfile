# Gordon CLI - AI-powered crypto trading terminal
# Multi-stage build for minimal image size

FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY src/ src/
COPY prompts/ prompts/
COPY assets/ assets/
COPY tsconfig.json ./

# Build (if applicable)
# RUN bun run build

# ─── Production stage ───
FROM oven/bun:1-alpine

WORKDIR /app

# Create non-root user for security
RUN addgroup -S gordon && adduser -S gordon -G gordon

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/prompts ./prompts
COPY --from=builder /app/assets ./assets
COPY --from=builder /app/tsconfig.json ./

# Gordon stores data in ~/.gordon — mount a volume for persistence
ENV GORDON_HOME=/data
RUN mkdir -p /data && chown gordon:gordon /data
VOLUME ["/data"]

USER gordon

ENTRYPOINT ["bun", "--config=/app/assets/bunfig.runtime.toml", "--no-env-file", "run", "src/entry.ts"]
