# ---- Build Stage ----
FROM node:20-alpine AS build

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy only dependency files for caching
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy the rest of the source code
COPY . .

# Build the TypeScript code
RUN pnpm run build

# ---- Production Stage ----
FROM node:20-alpine AS prod

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy only production dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

# Copy built code and public assets
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/.env.example ./

# Expose the port (default 3000, can be overridden by .env)
EXPOSE 3000

# Start the application
CMD ["node", "dist/main.js"]
