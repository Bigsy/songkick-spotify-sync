(() => {
  if (globalThis.__spotifySongkickCollector) return;
  globalThis.__spotifySongkickCollector = true;
  let active = null;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const gridSelector = '[role="grid"][aria-label="Your Library"]';
  const titleSelector = '[id^="listrow-title-spotify:artist:"]';

  async function library() {
    // Spotify renders the library a few seconds after a tab (re)load.
    for (let i = 0; i < 40 && !document.querySelector(gridSelector); i++) await wait(200);
    const grid = document.querySelector(gridSelector);
    if (!grid) throw new Error('Open Spotify, sign in, and expand Your Library.');
    if (!document.querySelector('[aria-label="Artists"][aria-checked="true"]')) {
      // The Artists chip only filters the library view; selecting it changes nothing in the account.
      const chip = document.querySelector('[aria-label="Artists"][aria-checked="false"]');
      if (!chip) throw new Error('Select the Artists filter in Your Library first.');
      chip.click();
      for (let i = 0; i < 20 && !document.querySelector('[aria-label="Artists"][aria-checked="true"]'); i++) await wait(100);
      if (!document.querySelector('[aria-label="Artists"][aria-checked="true"]')) throw new Error('Select the Artists filter in Your Library first.');
      await wait(500);
      return library();
    }
    const navigation = grid.closest('nav') || document.querySelector('[role="navigation"]');
    if (navigation && [...navigation.querySelectorAll('input')].some(input => input.value.trim())) {
      throw new Error('Clear the search in Your Library to scan all followed artists.');
    }
    const viewport = grid.closest('[data-overlayscrollbars-viewport]');
    if (!viewport || viewport.clientHeight < 50) throw new Error('Expand Your Library so the artist list is visible.');
    const total = Number(grid.getAttribute('aria-rowcount'));
    if (!Number.isSafeInteger(total) || total < 1) throw new Error('Spotify did not expose a usable artist count. The library may be empty or still loading.');
    return { grid, viewport, total };
  }

  async function scan(run) {
    const artists = new Map();
    const positions = new Map();
    let total = null;
    let complete = false;
    let reason = 'Scan stopped before completeness could be verified.';
    let lastProgress = 0;
    try {
      const current = await library();
      total = current.total;
      const collect = () => {
        let fresh = 0;
        const grid = document.querySelector(gridSelector);
        if (!grid) throw new Error('Spotify library closed during scanning. Scan is partial.');
        if (Number(grid.getAttribute('aria-rowcount')) !== total) throw new Error('Artist count changed during scanning. Retry once the library settles.');
        for (const title of grid.querySelectorAll(titleSelector)) {
          const id = title.id.slice('listrow-title-spotify:artist:'.length);
          const name = title.textContent.trim();
          const index = Number(title.closest('[role="row"]')?.getAttribute('aria-rowindex'));
          if (!/^[A-Za-z0-9]{22}$/.test(id) || !name || !Number.isInteger(index) || index < 1 || index > total) {
            throw new Error('Spotify artist markup changed. Scan is partial.');
          }
          if (positions.has(index) && positions.get(index) !== id) throw new Error('Library order changed during scanning. Retry with a stable sort.');
          if (!positions.has(index)) fresh++;
          positions.set(index, id);
          artists.set(id, { id, name, url: `https://open.spotify.com/artist/${id}` });
        }
        return fresh;
      };
      // Waits only until newly scrolled rows render, instead of a fixed delay per step.
      const settle = async () => {
        for (let i = 0; i < 25 && !run.cancelled; i++) {
          await wait(i < 3 ? 60 : 120);
          if (collect() > 0) return true;
        }
        return false;
      };
      const progress = async () => {
        if (Date.now() - lastProgress < 700) return;
        lastProgress = Date.now();
        await chrome.runtime.sendMessage({ type: 'SPOTIFY_PROGRESS', runId: run.id, count: artists.size, total }).catch(() => { run.cancelled = true; });
      };
      const { viewport } = current;
      viewport.scrollTop = 0;
      await wait(300);
      collect();
      let stalls = 0;
      for (let step = 0; step < 4000 && !run.cancelled && positions.size < total; step++) {
        const bottom = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 2;
        if (bottom) break;
        viewport.scrollTop += Math.floor(viewport.clientHeight * 0.8);
        stalls = await settle() ? 0 : stalls + 1;
        if (stalls >= 8) break;
        await progress();
      }
      // Revisit any row positions that virtualisation skipped past.
      for (let pass = 0; pass < 3 && !run.cancelled && positions.size < total; pass++) {
        const rowHeight = viewport.scrollHeight / total;
        for (let index = 1; index <= total && !run.cancelled; index++) {
          if (positions.has(index)) continue;
          viewport.scrollTop = Math.max(0, (index - 1) * rowHeight - viewport.clientHeight / 3);
          await settle();
        }
      }
      if (run.cancelled) reason = 'Cancelled. Collected artists are kept as a partial scan.';
      else if (positions.size === total && artists.size === total) {
        complete = true;
        reason = `Collected all ${total} artists Spotify reports.`;
      } else reason = `Collected ${artists.size} of ${total} artists. Completeness is unverified; sync again.`;
    } catch (error) { reason = error.message; }
    return { artists: [...artists.values()], total, complete, reason };
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
    if (message?.type === 'SPOTIFY_PING') {
      respond({ ok: true, result: { ready: true } });
    } else if (message?.type === 'SPOTIFY_CANCEL') {
      if (active && active.id === message.runId) active.cancelled = true;
      respond({ ok: true });
    } else if (message?.type === 'SPOTIFY_SCAN' && typeof message.runId === 'string') {
      if (active) { respond({ ok: false, error: 'A Spotify scan is already running.' }); return; }
      active = { id: message.runId, cancelled: false };
      scan(active).then(result => respond({ ok: true, result })).catch(error => respond({ ok: false, error: error.message })).finally(() => { active = null; });
      return true;
    }
  });
})();
