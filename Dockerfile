FROM node:24-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production PORT=8787 STATIC_DIRECTORY=/app/dist DATABASE_PATH=/data/dwellence.sqlite
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server ./server
EXPOSE 8787
VOLUME ["/data"]
CMD ["npm", "start"]
