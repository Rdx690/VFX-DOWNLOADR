import './style.css';

const API = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const app = document.querySelector('#app');

app.innerHTML = `
  <div class="ambient a1"></div><div class="ambient a2"></div>
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="#"><span class="brandmark">V</span><span><b>VFX DOWNLOADER</b><small>POWERED BY SOURAJIT VFX</small></span></a>
      <span class="top-pill"><i></i> MEDIA TOOLKIT</span>
    </header>
    <main>
      <div class="eyebrow">✦ CREATOR MEDIA WORKSPACE</div>
      <h1>Your media.<br><span>Your format. Your choice.</span></h1>
      <p class="intro">Prepare MP4 video or MP3 audio from supported public YouTube videos, Instagram Reels and Facebook videos you own or have permission to save. Choose the best available quality, up to 4K where available.</p>
      <section class="panel">
        <form id="downloadForm">
          <label for="url">VIDEO URL</label>
          <div class="urlrow">
            <input id="url" type="url" placeholder="Paste a YouTube, Instagram or Facebook video link…" required autocomplete="url" />
            <button id="submit" type="submit">Continue <span>↗</span></button>
          </div>
          <div class="options">
            <div class="option"><label for="format">FORMAT</label><select id="format"><option value="mp4">MP4 · Video</option><option value="mp3">MP3 · Audio</option></select></div>
            <div class="option" id="qualityWrap"><label for="quality">VIDEO QUALITY</label><select id="quality"><option value="best">Best available · up to 4K</option><option value="2160">2160p · 4K</option><option value="1440">1440p · 2K</option><option value="1080">1080p · Full HD</option><option value="720">720p · HD</option></select></div>
          </div>
          <label class="consent"><input id="consent" type="checkbox" required /><span>I own this content or have permission to download it, and will respect the platform's terms and copyright.</span></label>
        </form>
        <div id="status" class="status" role="status" aria-live="polite"></div>
        <div id="result" class="result"></div>
      </section>
      <div class="feature-grid">
        <article><span>▣</span><b>YouTube + Instagram + Facebook</b><p>Supported public video links from all three platforms.</p></article>
        <article><span>♫</span><b>MP4 + MP3</b><p>Choose video or audio output.</p></article>
        <article><span>✧</span><b>Up to 4K</b><p>Quality depends on the source and available formats.</p></article>
        <article><span>⌁</span><b>Responsive design</b><p>Designed for mobile, tablet and desktop.</p></article>
      </div>
      <aside class="notice"><b>Important:</b> Use only content you own or are authorized to download. Private/login-restricted posts and DRM-protected media are not supported. This tool does not bypass privacy or platform protections. Respect YouTube, Instagram and Facebook terms and copyright rules. Instagram or Facebook extraction can fail when login is required or their public endpoints change.</aside>
    </main>
    <footer><b>VFX DOWNLOADER</b> <span>·</span> Crafted by SOURAJIT VFX <span>·</span> Independent project</footer>
  </div>
`;

const form = document.querySelector('#downloadForm');
const format = document.querySelector('#format');
const qualityWrap = document.querySelector('#qualityWrap');
const statusBox = document.querySelector('#status');
const result = document.querySelector('#result');
const submit = document.querySelector('#submit');

format.addEventListener('change', () => {
  qualityWrap.hidden = format.value === 'mp3';
});

function status(message, type = 'info') {
  statusBox.className = `status visible ${type}`;
  statusBox.textContent = message;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  result.replaceChildren();
  if (!API) {
    status('Backend is not configured yet. Set VITE_API_BASE_URL in Vercel to your deployed Render API URL.', 'error');
    return;
  }
  if (!document.querySelector('#consent').checked) {
    status('Please confirm you have the rights to download this content.', 'error');
    return;
  }
  const url = document.querySelector('#url').value.trim();
  const selectedFormat = format.value;
  const quality = document.querySelector('#quality').value;
  submit.disabled = true;
  submit.innerHTML = '<span class="spinner"></span> Preparing…';
  status('Checking the URL and preparing your file. Large or 4K files can take a while.', 'info');
  try {
    const response = await fetch(`${API}/api/download`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({url, format: selectedFormat, quality})
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${response.status})`);
    }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match?.[1] || `vfx-download.${selectedFormat}`;
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    status('Your file is ready. Check your device downloads.', 'success');
  } catch (error) {
    status(error.message || 'Could not prepare this media. Try again later.', 'error');
  } finally {
    submit.disabled = false;
    submit.innerHTML = 'Continue <span>↗</span>';
  }
});
