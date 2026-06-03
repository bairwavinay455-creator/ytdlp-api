# ── Base image ────────────────────────────────────────────────
FROM node:20-slim

# ── Install yt-dlp + ffmpeg ────────────────────────────────────
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    wget \
    curl \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Install latest yt-dlp binary
RUN wget -q https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -O /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp

# Verify installation
RUN yt-dlp --version

# ── App setup ─────────────────────────────────────────────────
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

# ── Railway sets PORT automatically ───────────────────────────
EXPOSE 3000

CMD ["node", "server.js"]
