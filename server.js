const express = require("express");
const cors    = require("cors");
const { execFile, spawn } = require("child_process");
const path    = require("path");
const https   = require("https");

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── CORS ─────────────────────────────────────────────────────
   Allow your Cloudflare Pages domain + localhost for dev.
   Set ALLOWED_ORIGIN env var on Railway to your real domain.
────────────────────────────────────────────────────────────── */
const ALLOWED = (process.env.ALLOWED_ORIGIN || "*").split(",").map(s => s.trim());

app.use(cors({
  origin: (origin, cb) => {
    if (ALLOWED.includes("*") || !origin || ALLOWED.includes(origin)) {
      cb(null, true);
    } else {
      cb(new Error("CORS blocked: " + origin));
    }
  },
  methods: ["GET", "OPTIONS"],
}));

app.use(express.json());

/* ── yt-dlp binary path ───────────────────────────────────────
   On Railway (Docker), yt-dlp is installed to /usr/local/bin.
   Locally you can override with YTDLP_PATH env var.
────────────────────────────────────────────────────────────── */
const YTDLP = process.env.YTDLP_PATH || "yt-dlp";

/* ── Helpers ─────────────────────────────────────────────────── */

/** Validate YouTube URL — accepts all common formats */
function isYouTubeURL(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
    return (
      h === "youtube.com" ||
      h === "youtu.be"    ||
      h === "music.youtube.com"
    );
  } catch { return false; }
}

/** Run yt-dlp and return stdout as string */
function ytdlp(args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let stdout = "", stderr = "";
    const proc = spawn(YTDLP, args);

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("yt-dlp timed out"));
    }, timeoutMs);

    proc.stdout.on("data", d => { stdout += d.toString(); });
    proc.stderr.on("data", d => { stderr += d.toString(); });

    proc.on("close", code => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        /* Extract the useful part of the error message */
        const msg = stderr.split("\n")
          .filter(l => l.includes("ERROR") || l.includes("error"))
          .join(" ") || stderr.slice(-300);
        reject(new Error(msg || `yt-dlp exited with code ${code}`));
      }
    });

    proc.on("error", err => {
      clearTimeout(timer);
      reject(new Error("yt-dlp not found. Is it installed? " + err.message));
    });
  });
}

/** Map yt-dlp height → quality label */
function heightToLabel(h) {
  if (!h) return null;
  if (h >= 1080) return "1080p";
  if (h >= 720)  return "720p";
  if (h >= 480)  return "480p";
  if (h >= 360)  return "360p";
  if (h >= 240)  return "240p";
  return h + "p";
}

/** Format seconds → HH:MM:SS or MM:SS */
function fmtSecs(s) {
  s = Math.round(s || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
  return `${m}:${String(ss).padStart(2,"0")}`;
}

/** Format bytes → human readable */
function fmtBytes(b) {
  if (!b) return null;
  if (b > 1e9) return (b / 1e9).toFixed(1) + " GB";
  if (b > 1e6) return (b / 1e6).toFixed(1) + " MB";
  return (b / 1e3).toFixed(0) + " KB";
}

/* ── GET /health ─────────────────────────────────────────────── */
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "ytdlp-api by Vinay", time: new Date().toISOString() });
});

/* ── GET /info?url= ──────────────────────────────────────────── */
app.get("/info", async (req, res) => {
  const { url } = req.query;

  if (!url)              return res.status(400).json({ error: "Missing ?url= parameter" });
  if (!isYouTubeURL(url)) return res.status(400).json({ error: "Only YouTube URLs are supported" });

  try {
    /* Fetch full JSON metadata from yt-dlp */
    const raw = await ytdlp([
      "--dump-json",
      "--no-playlist",
      "--no-warnings",
      "--extractor-args", "youtube:skip=dash,translated_subs",
      url,
    ], 25000);

    const data = JSON.parse(raw);

    /* ── Build quality list ─────────────────────────────────── */
    const WANTED_HEIGHTS = [1080, 720, 480, 360];
    const qualityMap = {};   /* height → best format entry */

    for (const fmt of (data.formats || [])) {
      /* Skip audio-only, storyboards, or formats without a direct URL */
      if (!fmt.url)                  continue;
      if (fmt.vcodec === "none")     continue;
      if (!fmt.height)               continue;

      const label = heightToLabel(fmt.height);
      if (!label) continue;

      /* Keep the highest-tbr (total bitrate) format for each label */
      const existing = qualityMap[label];
      if (!existing || (fmt.tbr || 0) > (existing.tbr || 0)) {
        qualityMap[label] = fmt;
      }
    }

    /* Audio-only: best opus or mp4a */
    const audioFmts = (data.formats || []).filter(f =>
      f.url && f.vcodec === "none" && f.acodec !== "none"
    ).sort((a, b) => (b.abr || 0) - (a.abr || 0));
    const bestAudio = audioFmts[0] || null;

    /* Build qualities array */
    const qualities = WANTED_HEIGHTS
      .map(h => {
        const label = h + "p";
        const fmt   = qualityMap[label];
        if (!fmt) return null;
        return {
          label,
          itag:     fmt.format_id,
          url:      fmt.url,
          ext:      fmt.ext || "mp4",
          filesize: fmtBytes(fmt.filesize || fmt.filesize_approx),
          fps:      fmt.fps || null,
          vcodec:   fmt.vcodec || null,
        };
      })
      .filter(Boolean);

    /* Add audio-only option */
    if (bestAudio) {
      qualities.push({
        label:    "Audio Only",
        itag:     bestAudio.format_id,
        url:      bestAudio.url,
        ext:      "mp3",
        filesize: fmtBytes(bestAudio.filesize || bestAudio.filesize_approx),
        fps:      null,
        vcodec:   null,
        abr:      bestAudio.abr || null,
      });
    }

    /* ── Best thumbnail ─────────────────────────────────────── */
    const thumbs  = (data.thumbnails || []).sort((a, b) => (b.preference || 0) - (a.preference || 0));
    const thumb   = thumbs[0]?.url ||
      `https://img.youtube.com/vi/${data.id}/hqdefault.jpg`;

    res.json({
      id:         data.id,
      title:      data.title,
      uploader:   data.uploader || data.channel || "",
      duration:   fmtSecs(data.duration),
      durationRaw: data.duration || 0,
      thumb,
      viewCount:  data.view_count  || 0,
      likeCount:  data.like_count  || 0,
      uploadDate: data.upload_date || "",
      description: (data.description || "").slice(0, 300),
      qualities,
    });

  } catch (err) {
    console.error("[/info]", err.message);

    /* User-friendly error messages */
    let msg = err.message;
    if (msg.includes("Video unavailable"))       msg = "This video is unavailable or deleted.";
    else if (msg.includes("Private video"))      msg = "This video is private.";
    else if (msg.includes("age-restricted"))     msg = "This video is age-restricted.";
    else if (msg.includes("not a bot"))          msg = "YouTube is rate-limiting this server. Try again in a minute.";
    else if (msg.includes("timed out"))          msg = "Request timed out. Try again.";

    res.status(500).json({ error: msg });
  }
});

/* ── GET /download?url=&itag= ────────────────────────────────── */
app.get("/download", async (req, res) => {
  const { url, itag, title } = req.query;

  if (!url)               return res.status(400).json({ error: "Missing ?url= parameter" });
  if (!isYouTubeURL(url)) return res.status(400).json({ error: "Only YouTube URLs are supported" });

  try {
    /* If itag provided, get direct URL for that specific format */
    const args = [
      "--get-url",
      "--no-playlist",
      "--no-warnings",
    ];

    if (itag) {
      args.push("-f", itag);
    } else {
      /* Default: best mp4 up to 1080p */
      args.push("-f", "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best");
    }

    args.push(url);

    const streamUrl = await ytdlp(args, 20000);
    const lines = streamUrl.split("\n").filter(Boolean);

    res.json({
      url:   lines[0] || null,
      url2:  lines[1] || null, /* Sometimes video + audio are separate streams */
      itag:  itag || "auto",
    });

  } catch (err) {
    console.error("[/download]", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /stream?url=&itag= — pipe video directly ───────────── */
app.get("/stream", async (req, res) => {
  const { url, itag } = req.query;

  if (!url)               return res.status(400).json({ error: "Missing ?url= parameter" });
  if (!isYouTubeURL(url)) return res.status(400).json({ error: "Only YouTube URLs are supported" });

  try {
    /* Get the direct URL first */
    const args = ["--get-url", "--no-playlist", "--no-warnings"];
    if (itag) args.push("-f", itag);
    else      args.push("-f", "best[ext=mp4][height<=720]/best");
    args.push(url);

    const streamUrl = (await ytdlp(args, 20000)).split("\n")[0];
    if (!streamUrl) throw new Error("No stream URL found");

    /* Redirect to the direct URL — browser handles download */
    res.redirect(302, streamUrl);

  } catch (err) {
    console.error("[/stream]", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ── 404 ────────────────────────────────────────────────────── */
app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    endpoints: ["/health", "/info?url=", "/download?url=&itag=", "/stream?url=&itag="],
  });
});

/* ── Start ──────────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`✅ ytdlp-api running on port ${PORT}`);
  console.log(`   CORS allowed: ${ALLOWED.join(", ")}`);
});
