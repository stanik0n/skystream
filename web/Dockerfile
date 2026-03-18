FROM node:20-alpine

WORKDIR /app

# Copy dependency manifests first for better layer caching
COPY package.json package-lock.json* ./

RUN npm install

# Copy the rest of the source
COPY . .

EXPOSE 5173

# Vite dev server — suitable for development; replace with multi-stage
# build (npm run build + nginx) for a production deployment.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
