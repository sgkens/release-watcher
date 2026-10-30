FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY package.json ./
ENV NODE_ENV=production PORT=4317 RW_DB=/app/data/release-watcher.db
VOLUME /app/data
EXPOSE 4317
CMD ["bun", "server/index.ts"]
