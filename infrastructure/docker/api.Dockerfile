FROM node:22-alpine AS build
WORKDIR /app

# Install workspace dependencies from the monorepo root
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/types/package.json packages/types/
COPY packages/config/package.json packages/config/
COPY packages/auth/package.json packages/auth/
COPY packages/utils/package.json packages/utils/
COPY services/api/package.json services/api/
RUN npm install --workspaces --if-present

# Build the API
COPY packages ./packages
COPY services/api ./services/api
RUN npm run build -w services/api

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 4000
CMD ["node", "services/api/dist/index.js"]
