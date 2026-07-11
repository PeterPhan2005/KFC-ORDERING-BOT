FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json tsconfig.json ./
COPY src ./src
COPY assets ./assets
COPY migrations ./migrations
COPY scripts ./scripts

RUN npm ci
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts ./scripts

EXPOSE 3000

CMD ["node", "dist/index.js"]
