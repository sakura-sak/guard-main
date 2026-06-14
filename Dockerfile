FROM node:20-bookworm-slim AS deps

WORKDIR /app

# Установка системных зависимостей для native модулей (ldapts может требовать)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    openssl \
    && rm -rf /var/lib/apt/lists/*

# Установка зависимостей (включая dev-зависимости, нужные для сборки)
COPY package.json package-lock.json ./
RUN npm config set fetch-retries 5 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && npm config set fetch-timeout 300000 \
 && (npm ci --legacy-peer-deps --no-audit --no-fund \
     || (echo "npm ci failed, retrying…" && sleep 5 && npm ci --legacy-peer-deps --no-audit --no-fund))


FROM node:20-bookworm-slim AS builder

WORKDIR /app
ENV NODE_ENV=production

# Копируем node_modules, затем исходники
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prisma client must match runtime OpenSSL (Debian bookworm = 3.0.x)
RUN npx prisma generate

# Сборка Next.js приложения
RUN npm run build

# После сборки чистим dev-зависимости, чтобы рантайм-образ был легче
RUN npm prune --omit=dev

# Regenerate client after prune so query engine binaries are present in runner
RUN npx prisma generate


FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

# Prisma requires OpenSSL at runtime (db push / client)
RUN apt-get update && apt-get install -y openssl \
    && rm -rf /var/lib/apt/lists/*

# Создаем директорию для данных (файлы, база документов, логи)
RUN mkdir -p /app/data/uploads /app/data/reports /app/data/logs && \
    chmod -R 755 /app/data

# Копируем только то, что нужно для запуска
COPY package.json package-lock.json* ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/prisma ./prisma

# Директория с файлами/БД будет монтироваться как volume
VOLUME ["/app/data"]

EXPOSE 3000

CMD ["npm", "run", "start"]

