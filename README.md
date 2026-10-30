# VFX DOWNLOADER — by SOURAJIT VFX

Premium responsive media utility project. The frontend is deployed on **Vercel**; the media-processing API runs separately on **Render** because Vercel serverless functions are not suitable for long-running FFmpeg jobs and multi-gigabyte 4K file responses.

## Important use restriction
This project is intended only for media you own or are authorized to download. It does not bypass private access, DRM, login restrictions, or platform protections. Follow YouTube's terms and applicable copyright law. Some videos cannot be downloaded through third-party tools; availability is not guaranteed.

## Project layout
- `frontend/` — Vite static frontend for Vercel
- `backend/` — Flask + yt-dlp + FFmpeg API for Render

## 1. Deploy backend to Render
1. Push this project to GitHub.
2. In Render, create a new **Web Service** from the repository.
3. Set Root Directory to `backend`.
4. Build Command: `bash build.sh`
5. Start Command: `gunicorn --workers 1 --threads 4 --timeout 600 app:app`
6. Choose a plan with enough memory, CPU, disk and request duration for large media. Free/sleeping services are not suitable for dependable 4K processing.
7. Add environment variable `FRONTEND_ORIGIN` with your Vercel domain, e.g. `https://your-project.vercel.app`.
8. FFmpeg must be installed on the Render host. If the chosen runtime does not include it, use a Docker service and install `ffmpeg` via apt.

## 2. Deploy frontend to Vercel
1. Import the GitHub repository into Vercel.
2. Set Root Directory to `frontend`.
3. Framework preset: Vite.
4. Build command: `npm run build`.
5. Output directory: `dist`.
6. Add environment variable `VITE_API_BASE_URL` = your Render service URL, e.g. `https://vfx-downloader-api.onrender.com`.
7. Redeploy after setting the variable.

## Local development
Frontend:
```bash
cd frontend
npm install
cp .env.example .env
# Edit VITE_API_BASE_URL to your API URL
npm run dev
```
Backend:
```bash
cd backend
pip install -r requirements.txt
# Install FFmpeg separately and ensure `ffmpeg` is on PATH
python app.py
```

## Operational notes
- 4K processing is resource-intensive and depends on source formats, FFmpeg, CPU, memory and available disk.
- Large files may exceed browser, host, proxy, or service limits. Test with short videos first.
- The API accepts HTTPS YouTube URLs, public Instagram Reel/video-post URLs, and public Facebook video URLs (including fb.watch links). Private/login-restricted posts are not supported. No playlist URLs are processed. Platform extraction can change or require authentication, so successful downloads are not guaranteed.
- This is a starter deployment. Add authentication, per-IP rate limiting, job queues, storage quotas, monitoring and abuse controls before public production use.
