FROM node:20-bookworm-slim AS base

WORKDIR /app

# Prisma runtime needs OpenSSL in slim images.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps

COPY package*.json ./
RUN npm ci

FROM base AS build

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY prisma.config.ts ./
COPY nest-cli.json tsconfig*.json ./
COPY prisma ./prisma
COPY src ./src
COPY templates ./templates
COPY ops ./ops

# Ensure Prisma client is generated for the current platform.
RUN npx prisma generate
RUN npm run build

# Keep runtime image small while preserving generated Prisma client artifacts.
RUN npm prune --omit=dev

FROM base AS runner

ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/templates ./templates
COPY --from=build /app/ops ./ops

# Runtime writable directories are usually mounted, but create them so local runs work.
RUN mkdir -p /app/storage /app/logs/yearly-cleanup

EXPOSE 3000

CMD ["node", "dist/src/main"]
