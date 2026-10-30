import './style.css';

const API = (import.meta.env.VITE_API_BASE_URL || 'https://vfxsave.onrender.com').replace(/\/$/, '');
const app = document.querySelector('#app');

app.innerHTML = `
  <div class="app-shell">
    <header class="brand">
      <div class="brand-mark">V</div>
      <h1>VFX DOWNLOADER</h1>
      <p>Paste link. Choose format. Download.</p>
    </header>

    <main class="glass-card">
      <form id="downloadForm">
        <div class="input-wrap">
          <input id="urlInput" type="url" placeholder="Paste Instagram, YouTube or Facebook link…" spellcheck="false" autocomplete="url" required>
        </div>
        <div class="simple-options">
          <label for="formatSelect">FORMAT</label>
          <select id="formatSelect">
            <option value="mp4">MP4 · Video</option>
            <option value="mp3">MP3 · Audio</option>
          </select>
        </div>
        <button id="fetchBtn" class="neon-btn" type="submit">DOWNLOAD</button>
      </form>

      <div class="status-area" role="status" aria-live="polite">
        <div id="statusText" class="status-text">Ready.</div>
        <div class="progress-track"><div id="progressFill" class="progress-fill"></div></div>
      </div>
    </main>
    <footer>VFX DOWNLOADER · SOURAJIT VFX</footer>
  </div>
`;

const form = document.querySelector('#downloadForm');
const urlInput = document.querySelector('#urlInput');
const fetchBtn = document.querySelector('#fetchBtn');
const formatSelect = document.querySelector('#formatSelect');
const statusText = document.querySelector('#statusText');
const progressFill = document.querySelector('#progressFill');

function setStatus(message, state = 'idle') {
  statusText.textContent = message;
  statusText.className = `status-text ${state}`;
  progressFill.className = 'progress-fill';
  progressFill.style.width = state === 'success' ? '100%' : '0%';
  if (state === 'loading') progressFill.classList.add('indeterminate');
}

function supportedUrl(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    return parsed.protocol === 'https:' && (
      ['youtube.com', 'youtu.be', 'm.youtube.com', 'music.youtube.com'].includes(host) ||
      host === 'instagram.com' || host.endsWith('.instagram.com') ||
      ['facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.watch'].includes(host) ||
      host.endsWith('.facebook.com')
    );
  } catch {
    return false;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = urlInput.value.trim();
  if (!supportedUrl(url)) {
    setStatus('Paste a valid Instagram, YouTube or Facebook link.', 'error');
    return;
  }

  fetchBtn.disabled = true;
  fetchBtn.textContent = 'PLEASE WAIT…';
  setStatus('Preparing your download…', 'loading');

  try {
    const response = await fetch(`${API}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format: formatSelect.value, quality: 'best' })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Download failed (${response.status}).`);
    }

    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const utfName = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    const plainName = disposition.match(/filename="?([^";]+)"?/i);
    const filename = utfName ? decodeURIComponent(utfName[1]) : (plainName?.[1] || `vfx-download.${formatSelect.value}`);
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    setStatus('Download started! Check your Downloads folder.', 'success');
  } catch (error) {
    setStatus(error.message || 'Download failed. Please try again.', 'error');
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.textContent = 'DOWNLOAD';
  }
});
