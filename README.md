# ytdlp-api — by Vinay

YouTube download API using yt-dlp. Deploy on Railway.

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server status check |
| GET | `/info?url=` | Get video info + quality list |
| GET | `/download?url=&itag=` | Get direct download URL |
| GET | `/stream?url=&itag=` | Redirect to video stream |

## Example

```
GET /info?url=https://youtube.com/watch?v=dQw4w9WgXcQ

{
  "id": "dQw4w9WgXcQ",
  "title": "Rick Astley - Never Gonna Give You Up",
  "uploader": "Rick Astley",
  "duration": "3:33",
  "thumb": "https://...",
  "qualities": [
    { "label": "1080p", "itag": "137", "url": "https://...", "ext": "mp4" },
    { "label": "720p",  "itag": "136", "url": "https://...", "ext": "mp4" },
    { "label": "480p",  "itag": "135", "url": "https://...", "ext": "mp4" },
    { "label": "360p",  "itag": "134", "url": "https://...", "ext": "mp4" },
    { "label": "Audio Only", "itag": "140", "url": "https://...", "ext": "mp3" }
  ]
}
```

## Deploy on Railway

### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "ytdlp-api by Vinay"
git remote add origin https://github.com/YOUR_USERNAME/ytdlp-api.git
git push -u origin main
```

### Step 2 — Deploy on Railway
1. Go to https://railway.app
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your repo
4. Railway auto-detects Dockerfile ✅

### Step 3 — Set Environment Variables on Railway
| Variable | Value |
|----------|-------|
| `ALLOWED_ORIGIN` | `https://your-site.pages.dev` |
| `PORT` | (Railway sets this automatically) |

### Step 4 — Get your API URL
Railway gives you a URL like:
`https://ytdlp-api-production-xxxx.up.railway.app`

Use this in your LinkToVideo website.
