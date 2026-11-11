# Verity Voice server: the browser demo and, when configured, the carrier endpoints.
# Build from the voice/ folder:  docker build -t verity-voice .
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# tsx (a regular dependency) runs the TypeScript sources directly; there is no separate build
# step to drift from them.
RUN npm ci --omit=dev
COPY src ./src
COPY fixtures ./fixtures
USER node
ENV PORT=3000
EXPOSE 3000
CMD ["node_modules/.bin/tsx", "src/server/index.ts"]
