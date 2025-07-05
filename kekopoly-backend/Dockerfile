# Frontend build stage
FROM node:18-alpine AS frontend-builder

WORKDIR /frontend
COPY ../kekopoly-frontend/package*.json ./
RUN npm install

COPY ../kekopoly-frontend/ ./
RUN npm run build

# Backend build stage
FROM golang:1.21-alpine AS backend-builder

WORKDIR /app
RUN apk add --no-cache git

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s" \
    -o kekopoly-server .

# Final stage
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

# Copy backend binary and config
COPY --from=backend-builder /app/kekopoly-server .
COPY --from=backend-builder /app/config/config.yaml ./config/

# Copy frontend build
COPY --from=frontend-builder /frontend/dist ./frontend/dist

# Create non-root user and set permissions
RUN addgroup -S appgroup && \
    adduser -S appuser -G appgroup && \
    chown -R appuser:appgroup /app

USER appuser

# Expose the application port
EXPOSE 8080

# Set healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O- http://localhost:8080/health || exit 1

# Define entry point
ENTRYPOINT ["/app/kekopoly-server"]