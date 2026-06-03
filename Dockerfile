cat > /mnt/user-data/outputs/ytdlp-api/Dockerfile << 'EOF'
# ── Base image ────────────────────────────────────────────────
FROM node:20-slim

# ── Install dependencies ───────────────────────────────────────
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# ── Install yt-dlp via pip (more reliable than wget binary) ───
RUN pip3 install -U yt-dlp --break-system-packages

# ── Verify ────────────────────────────────────────────────────
RUN yt-dlp --version

# ── App setup ─────────────────────────────────────────────────
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./

EXPOSE 3000
CMD ["node", "server.js"]
EOF
echo "Done"
