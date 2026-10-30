import './style.css';

const API = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const app = document.querySelector('#app');

app.innerHTML = `
  <div class="app-shell">
    <header class="brand">
      <div class="brand-mark">V</div>
      <h1>VFX DOWNLOADER</h1>
      <p>by Sourajit VFX · neon glass edition</p>
    </header>

    <main class="glass-card">
      <div class="segmented" role="tablist" aria-label="Choose a platform">
        <button class="active" type="button" data-tab="youtube" role="tab" aria-selected="true">YouTube</button>
        <button type="button" data-tab="instagram" role="tab" aria-selected="false">Instagram</button>
        <button type="button" data-tab="facebook" role="tab" aria-selected="false">Facebook</button>
      </div>

      <form id="downloadForm">
        <div class="input-row">
          <div class="input-wrap">
            <input id="urlInput" type="url" placeholder="Paste a public YouTube video URL…" spellcheck="false" autocomplete="url" required>
          </div>
          <button id="fetchBtn" class="neon-btn" type="submit">Download</button>
        </div>

        <div class="options">
          <div class="option">
            <label for="formatSelect">FORMAT</label>
            <select id="formatSelect">
              <option value="mp4">MP4 · Video</option>
              <option value="mp3">MP3 · Audio</option>
            </select>
          </div>
          <div class="option" id="qualityWrap">
            <label for="qualitySelect">VIDEO QUALITY</label>
            <select id="qualitySelect">
              <option value="best">Best available · up to 4K</option>
              <option value="2160">2160p · 4K</option>
              <option value="1440">1440p · 2K</option>
              <option value="1080">1080p · Full HD</option>
              <option value="720">720p · HD</option>
            </select>
          </div>
        </div>

        <label class="consent">
          <input id="consentCheck" type="checkbox" required>
          <span>I own this content or have permission to download it, and will respect the platform's terms and copyright.</span>
        </label>
      </form>

      <div class="status-area" role="status" aria-live="polite">
        <div id="statusText" class="status-text">Ready when you are.</div>
        <div class="progress-track"><div id="progressFill" class="progress-fill"></div></div>
      </div>
      <div id="result" class="result"></div>
    </main>

    <section class="feature-grid" aria-label="Features">
      <article><span>▣</span><b>Three platforms</b><p>YouTube, Instagram and Facebook public video links.</p></article>
      <article><span>♫</span><b>MP4 + MP3</b><p>Choose video or audio output.</p></article>
      <article><span>✧</span><b>Up to 4K</b><p>Quality depends on the source and available formats.</p></article>
    </section>

    <p class="footnote">Only for media you own or are authorized to download. Private/login-restricted posts and DRM-protected media are not supported. Respect platform terms and copyright rules.</p>
    <footer>VFX DOWNLOADER · Crafted by SOURAJIT VFX</footer>
  </div>
`;

const form = document.querySelector('#downloadForm');
const urlInput = document.querySelector('#urlInput');
const fetchBtn = document.querySelector('#fetchBtn');
const formatSelect = document.querySelector('#formatSelect');
const qualityWrap = document.querySelector('#qualityWrap');
const qualitySelect = document.querySelector('#qualitySelect');
const statusText = document.querySelector('#statusText');
const progressFill = document.querySelector('#progressFill');
const consentCheck = document.querySelector('#consentCheck');
const result = document.querySelector('#result');

let activePlatform = 'youtube';
const placeholders = {
  youtube: 'Paste a public YouTube video URL…',
  instagram: 'Paste a public Instagram Reel or video URL…',
  facebook: 'Paste a public Facebook video URL…'
};

document.querySelectorAll('[data-tab]').forEach((tab) => {
  tab.addEventListener('click', () => {
    activePlatform = tab.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach((item) => {
      const selected = item === tab;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-selected', String(selected));
    });
    urlInput.placeholder = placeholders[activePlatform];
    urlInput.value = '';
    result.replaceChildren();
    setStatus('Ready when you are.', 'idle');
  });
});

formatSelect.addEventListener('change', () => {
  qualityWrap.hidden = formatSelect.value === 'mp3';
});

function setStatus(message, state = 'idle') {
  statusText.textContent = message;
  statusText.className = `status-text ${state}`;
  progressFill.className = 'progress-fill';
  if (state === 'loading') progressFill.classList.add('indeterminate');
  if (state === 'success') progressFill.style.width = '100%';
  else progressFill.style.width = '0%';
}

function isMatchingPlatform(rawUrl, platform) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
    if (platform === 'youtube') return ['youtube.com', 'youtu.be', 'm.youtube.com', 'music.youtube.com'].includes(host);
    if (platform === 'instagram') return host === 'instagram.com' || host.endsWith('.instagram.com');
    if (platform === 'facebook') return host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.watch';
  } catch {
    return false;
  }
  return false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  result.replaceChildren();

  if (!API) {
    setStatus('Backend is not configured. Add VITE_API_BASE_URL in Vercel using your deployed API URL.', 'error');
    return;
  }

  const url = urlInput.value.trim();
  if (!isMatchingPlatform(url, activePlatform)) {
    setStatus(`That link does not look like a supported ${activePlatform} URL. Check the selected platform and try again.`, 'error');
    return;
  }

  if (!consentCheck.checked) {
    setStatus('Please confirm that you own this content or have permission to download it.', 'error');
    return;
  }

  const selectedFormat = formatSelect.value;
  const quality = qualitySelect.value;
  fetchBtn.disabled = true;
  fetchBtn.textContent = 'Preparing…';
  setStatus('Checking the link and preparing your file. Large or 4K downloads can take a while.', 'loading');

  try {
    const response = await fetch(`${API}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format: selectedFormat, quality })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Download request failed (${response.status}).`);
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
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    setStatus('Your file is ready. Check your device downloads.', 'success');
  } catch (error) {
    setStatus(error.message || 'Could not prepare this media. Please try again later.', 'error');
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.textContent = 'Download';
  }
});
