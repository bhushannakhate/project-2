# syntax=docker/dockerfile:1

FROM node:24-alpine AS frontend-build
WORKDIR /frontend
COPY --from=frontend package*.json ./
RUN npm ci
COPY --from=frontend . .

ARG VITE_API_BASE_URL=
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_GA4_MEASUREMENT_ID=

ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_FIREBASE_API_KEY=${VITE_FIREBASE_API_KEY} \
    VITE_FIREBASE_AUTH_DOMAIN=${VITE_FIREBASE_AUTH_DOMAIN} \
    VITE_FIREBASE_PROJECT_ID=${VITE_FIREBASE_PROJECT_ID} \
    VITE_FIREBASE_APP_ID=${VITE_FIREBASE_APP_ID} \
    VITE_GA4_MEASUREMENT_ID=${VITE_GA4_MEASUREMENT_ID}

RUN npm run build

FROM node:22-alpine AS backend-dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY --from=backend-dependencies /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
COPY --from=frontend-build /frontend/dist ./public
EXPOSE 8080
CMD ["npm", "start"]
