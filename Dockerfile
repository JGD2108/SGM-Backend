FROM node:20-bookworm-slim AS base

WORKDIR /app

# Prisma runtime on slim images needs OpenSSL.
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

# prisma.config.ts requires DATABASE_URL at config-load time.
ARG BUILD_DATABASE_URL=postgresql://user:password@localhost:5432/sgm?schema=public
ENV DATABASE_URL=${BUILD_DATABASE_URL}

RUN npx prisma generate
RUN npm run build
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

RUN mkdir -p /app/storage /app/logs/yearly-cleanup

EXPOSE 3000

CMD ["node", "dist/src/main"]
