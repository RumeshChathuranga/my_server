FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

# Assuming the app runs on a port, though package.json doesn't specify one. Defaulting to 3000.
# If your app runs on a different port, change this.
EXPOSE 3000

CMD ["npm", "start"]
