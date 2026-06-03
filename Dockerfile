FROM node:20-slim

RUN apt-get update && apt-get install -y 
python3 
python3-pip 
ffmpeg 
&& rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir yt-dlp

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

EXPOSE 3000

CMD ["node", "server.js"]
