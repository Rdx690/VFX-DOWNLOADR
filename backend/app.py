import os
import re
import tempfile
import threading
from pathlib import Path
from urllib.parse import urlparse

from flask import Flask, jsonify, request, send_file, after_this_request
from flask_cors import CORS
import yt_dlp

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024
allowed_origin = os.environ.get("FRONTEND_ORIGIN", "*")
CORS(app, resources={r"/api/*": {"origins": allowed_origin}})

YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com"}
INSTAGRAM_HOSTS = {"instagram.com", "www.instagram.com", "m.instagram.com"}
FACEBOOK_HOSTS = {"facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "fb.watch"}
active_jobs = set()
jobs_lock = threading.Lock()
MAX_ACTIVE_JOBS = int(os.environ.get("MAX_ACTIVE_JOBS", "2"))


def supported_source(value: str):
    """Return the supported source name after strict hostname/path validation."""
    try:
        parsed = urlparse(value)
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https":
            return None
        if host in YOUTUBE_HOSTS and parsed.path:
            return "youtube"
        if host in INSTAGRAM_HOSTS and re.search(r"/(reel|reels|p|tv)/", parsed.path):
            return "instagram"
        if host in FACEBOOK_HOSTS and parsed.path not in {"", "/"}:
            return "facebook"
        return None
    except Exception:
        return None


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "service": "VFX DOWNLOADER API"})


@app.post("/api/download")
def download():
    data = request.get_json(silent=True) or {}
    url = str(data.get("url", "")).strip()
    media_format = str(data.get("format", "mp4")).lower()
    quality = str(data.get("quality", "best"))

    source = supported_source(url)
    if not source:
        return jsonify(error="Use a supported HTTPS YouTube, public Instagram Reel, or public Facebook video URL."), 400
    if media_format not in {"mp3", "mp4"}:
        return jsonify(error="Choose MP3 or MP4."), 400
    if quality not in {"best", "2160", "1440", "1080", "720"}:
        return jsonify(error="Unsupported quality selection."), 400

    job_id = threading.get_ident()
    with jobs_lock:
        if len(active_jobs) >= MAX_ACTIVE_JOBS:
            return jsonify(error="The downloader is busy. Please try again in a minute."), 429
        active_jobs.add(job_id)

    temp_dir = tempfile.mkdtemp(prefix="vfxdl_")
    output_template = str(Path(temp_dir) / "%(title).80s_%(id)s.%(ext)s")
    try:
        if media_format == "mp3":
            opts = {
                "format": "bestaudio/best",
                "outtmpl": output_template,
                "noplaylist": True,
                "quiet": True,
                "no_warnings": True,
                "restrictfilenames": True,
                "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}],
                "socket_timeout": 25,
                "retries": 1,
            }
        else:
            if quality == "best":
                fmt = "bestvideo[height<=2160]+bestaudio/best[height<=2160]/best"
            else:
                h = int(quality)
                fmt = f"bestvideo[height<={h}]+bestaudio/best[height<={h}]/best[height<={h}]"
            opts = {
                "format": fmt,
                "merge_output_format": "mp4",
                "outtmpl": output_template,
                "noplaylist": True,
                "quiet": True,
                "no_warnings": True,
                "restrictfilenames": True,
                "socket_timeout": 25,
                "retries": 1,
            }

        # Instagram/Facebook support is limited to public media accessible without login/cookies.
        # Extraction may fail if a platform requires authentication or changes its endpoints.
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
            title = info.get("title") or (f"{source}-video" if source in {"instagram", "facebook"} else "vfx-download")

        candidates = [p for p in Path(temp_dir).iterdir() if p.is_file()]
        if not candidates:
            raise RuntimeError("The media file was not created. The source may not offer this format.")
        file_path = max(candidates, key=lambda p: p.stat().st_size)
        safe_title = re.sub(r"[^A-Za-z0-9._-]+", "_", title).strip("._")[:70] or "vfx-download"
        filename = f"{safe_title}.{media_format}"

        @after_this_request
        def cleanup(response):
            # Keep the temporary file available while the response is being sent.
            def remove_later():
                import time
                time.sleep(120)
                import shutil
                shutil.rmtree(temp_dir, ignore_errors=True)
                with jobs_lock:
                    active_jobs.discard(job_id)
            threading.Thread(target=remove_later, daemon=True).start()
            return response

        return send_file(file_path, as_attachment=True, download_name=filename, mimetype="audio/mpeg" if media_format == "mp3" else "video/mp4")
    except Exception as exc:
        import shutil
        shutil.rmtree(temp_dir, ignore_errors=True)
        with jobs_lock:
            active_jobs.discard(job_id)
        message = str(exc)
        if "ffmpeg" in message.lower():
            message = "FFmpeg is required for MP3 conversion and high-quality MP4 merging. Check the Render build."
        elif "private" in message.lower() or "login" in message.lower() or "cookies" in message.lower():
            message = "This post is private or login-restricted. Only publicly accessible media is supported; no login or privacy bypass is provided."
        else:
            message = "Could not process this video. It may be unavailable, restricted, unsupported, or temporarily blocked. Try a permitted public video."
        return jsonify(error=message), 422


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")))
