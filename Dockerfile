# ==============================================================================
# Multi-Stage Dockerfile for Carpschool Autonomous School Server
# Stage 1: Dependencies Builder (deps)
# Stage 2: Source Compilation Builder (builder)
# Stage 3: Minimal Production Runtime (runner)
# ==============================================================================

# --- Stage 1: Dependencies Builder ---
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
RUN npm install

# --- Stage 2: Compilation Builder ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN npm prune --omit=dev

# --- Stage 3: Minimal Production Runner ---
FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production
ENV PORT=5000

USER node

COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/package.json ./package.json

EXPOSE 5000

ENTRYPOINT ["dumb-init", "node", "dist/main.js"]
