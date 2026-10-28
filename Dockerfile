FROM node:20-bullseye-slim

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install clean production dependencies
RUN npm ci --omit=dev

# Copy application files
COPY . .

# Railway automatically sets PORT (defaults to 8080 in config)
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
