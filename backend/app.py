import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

import instaloader
import requests
import yt_dlp
from flask import Flask, jsonify, request, send_file, after_this_request
from flask_cors import CORS

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024
allowed_origin = os.environ.get("FRONTEND_ORIGIN", "*")
CORS(app, resources={r"/api/*": {"origins": allowed_origin}})

YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com"}
INSTAGRAM_HOSTS = {"instagram.com", "www.instagram.com", "m.instagram.com"}
FACEBOOK_HOSTS = {"facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "fb.watch"}
SHORTCODE_RE = re.compile(r"/(?:reel|reels|p|tv)/([A-Za-z0-9_-]+)")
active_jobs = set()
jobs_lock = threading.Lock()
MAX_ACTIVE_JOBS = int(os.environ.get("MAX_ACTIVE_JOBS", "2"))


def identify_source(value):
    try:
        parsed = urlparse(value)
        host = (parsed.hostname or "").lower()
        if parsed.scheme not in {"http", "https"}:
            return None
        if host in YOUTUBE_HOSTS and parsed.path:
            return "youtube"
        if host in INSTAGRAM_HOSTS and SHORTCODE_RE.search(parsed.path):
            return "instagram"
        if host in FACEBOOK_HOSTS and parsed.path not in {"", "/"}:
            return "facebook"
    except Exception:
        pass
    return None


def schedule_cleanup(temp_dir, job_id):
    def remove_later():
        time.sleep(120)
        shutil.rmtree(temp_dir, ignore_errors=True)
        with jobs_lock:
            active_jobs.discard(job_id)
    threading.Thread(target=remove_later, daemon=True).start()


def resolve_instagram_video(url, temp_dir, media_format):
    """Resolve public Instagram video posts using the project's earlier Instaloader approach."""
    match = SHORTCODE_RE.search(urlparse(url).path)
    if not match:
        raise RuntimeError("Paste a valid Instagram Reel or video post URL.")

    loader = instaloader.Instaloader(
        quiet=True,
        download_pictures=False,
        download_videos=False,
        download_video_thumbnails=False,
        save_metadata=False,
        download_comments=False,
    )
    post = instaloader.Post.from_shortcode(loader.context, match.group(1))

    video_url = None
    if post.typename == "GraphSidecar":
        for node in post.get_sidecar_nodes():
            if node.is_video and node.video_url:
                video_url = node.video_url
                break
    elif post.is_video:
        video_url = post.video_url

    if not video_url:
        raise RuntimeError("No public video was found. This may be an image-only, private, or unavailable post.")

    output = Path(temp_dir) / "instagram_video.mp4"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36",
        "Referer": "https://www.instagram.com/",
    }
    with requests.get(video_url, headers=headers, stream=True, timeout=(20, 120)) as response:
        response.raise_for_status()
        content_type = response.headers.get("Content-Type", "").lower()
        if "video" not in content_type and "octet-stream" not in content_type:
            raise RuntimeError("Instagram did not return a video file. Please resolve the Reel again later.")
        with output.open("wb") as file:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    file.write(chunk)

    if output.stat().st_size < 1024:
        raise RuntimeError("The video download was incomplete. Please try again.")

    if media_format == "mp3":
        audio_output = Path(temp_dir) / "instagram_audio.mp3"
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", str(output), "-vn", "-b:a", "192k", str(audio_output)],
            capture_output=True, text=True, timeout=180,
        )
        if result.returncode != 0 or not audio_output.exists():
            raise RuntimeError("MP3 conversion failed. Check that FFmpeg is installed on the backend.")
        return audio_output, (post.caption or "instagram-video").strip()[:100]

    return output, (post.caption or "instagram-video").strip()[:100]


def resolve_youtube_facebook(url, source, temp_dir, media_format, quality):
    template = str(Path(temp_dir) / "%(title).80s_%(id)s.%(ext)s")
    if media_format == "mp3":
        opts = {
            "format": "bestaudio/best",
            "outtmpl": template,
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "restrictfilenames": True,
            "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}],
            "socket_timeout": 30,
            "retries": 3,
            "extractor_retries": 2,
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
            "outtmpl": template,
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "restrictfilenames": True,
            "socket_timeout": 30,
            "retries": 3,
            "extractor_retries": 2,
        }

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        title = info.get("title") or f"{source}-video"

    candidates = [p for p in Path(temp_dir).iterdir() if p.is_file()]
    if not candidates:
        raise RuntimeError("The media file was not created. The source may not offer this format.")
    return max(candidates, key=lambda p: p.stat().st_size), title


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "service": "VFX DOWNLOADER API", "instagram": "Instaloader", "youtube_facebook": "yt-dlp"})


@app.post("/api/download")
def download():
    data = request.get_json(silent=True) or {}
    url = str(data.get("url", "")).strip()
    media_format = str(data.get("format", "mp4")).lower()
    quality = str(data.get("quality", "best"))

    source = identify_source(url)
    if not source:
        return jsonify(error="Use a supported YouTube, public Instagram Reel/post, or Facebook video URL."), 400
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
    try:
        if source == "instagram":
            file_path, title = resolve_instagram_video(url, temp_dir, media_format)
        else:
            file_path, title = resolve_youtube_facebook(url, source, temp_dir, media_format, quality)

        safe_title = re.sub(r"[^A-Za-z0-9._-]+", "_", title).strip("._")[:70] or "vfx-download"
        filename = f"{safe_title}.{media_format}"

        @after_this_request
        def cleanup(response):
            schedule_cleanup(temp_dir, job_id)
            return response

        return send_file(
            file_path,
            as_attachment=True,
            download_name=filename,
            mimetype="audio/mpeg" if media_format == "mp3" else "video/mp4",
        )
    except instaloader.exceptions.PrivateProfileNotFollowedException:
        shutil.rmtree(temp_dir, ignore_errors=True)
        with jobs_lock:
            active_jobs.discard(job_id)
        return jsonify(error="This Instagram account is private. Only public posts are supported."), 403
    except instaloader.exceptions.LoginRequiredException:
        shutil.rmtree(temp_dir, ignore_errors=True)
        with jobs_lock:
            active_jobs.discard(job_id)
        return jsonify(error="Instagram requires login for this post. Login-restricted posts are not supported."), 403
    except instaloader.exceptions.TooManyRequestsException:
        shutil.rmtree(temp_dir, ignore_errors=True)
        with jobs_lock:
            active_jobs.discard(job_id)
        return jsonify(error="Instagram is rate-limiting requests. Wait a while and try again."), 429
    except Exception as exc:
        shutil.rmtree(temp_dir, ignore_errors=True)
        with jobs_lock:
            active_jobs.discard(job_id)
        app.logger.exception("Download failed for %s", source)
        message = str(exc).lower()
        if "ffmpeg" in message or "ffmpeg" in str(exc):
            error = "FFmpeg is required for MP3 conversion and high-quality video merging. Check the backend build."
        elif "private" in message or "login" in message or "cookie" in message:
            error = "This post is private or login-restricted. Only publicly accessible media is supported."
        elif "429" in message or "too many requests" in message:
            error = "The platform is rate-limiting requests. Wait a while and try again."
        else:
            error = "Could not download this media. It may be unavailable, restricted, or temporarily blocked. Try again later."
        return jsonify(error=error), 422


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")))
