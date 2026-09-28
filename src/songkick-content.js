(() => {
  if (globalThis.__spotifySongkickReader) return;
  globalThis.__spotifySongkickReader = true;
  // Reads fetch Songkick's own server-rendered pages from this tab (same origin, your session)
  // instead of navigating it, which is about ten times faster and leaves the tab alone.
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const text = node => (node?.textContent || '').replace(/\s+/gu, ' ').trim();
  let tracking = false;
  // Stops the whole run: signed out, rate limited, or unreachable. Other errors affect one artist.
  const stop = message => Object.assign(new Error(message), { fatal: true });

  function guard(doc) {
    if (doc.querySelector('a[href*="accounts.songkick.com/session/new"]')) throw stop('Sign in to Songkick, then sync again.');
    if (/too many requests|rate limit|verify you are human|access denied|unusual traffic|checking your browser/i.test(text(doc.body).slice(0, 6000))) {
      throw stop('Songkick is limiting access or asking for verification. Resolve it in the Songkick tab and try again later.');
    }
  }
  async function load(path, pattern) {
    let response;
    try { response = await fetch(path, { credentials: 'same-origin' }); }
    catch { throw stop('Songkick did not respond. Check you are signed in, then sync again.'); }
    if (response.status === 429) throw stop('Songkick is rate limiting. Wait a few minutes and try again.');
    if (!response.ok) throw new Error(`Songkick returned HTTP ${response.status}.`);
    const url = new URL(response.url);
    if (url.origin !== location.origin) throw stop('Songkick redirected away from songkick.com. Check you are signed in.');
    if (!pattern.test(url.pathname)) throw new Error('Songkick redirected to an unexpected page.');
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    guard(doc);
    return { doc, url };
  }

  function controlState(button) {
    if (!button || button.disabled) return 'unknown';
    const action = button.form?.getAttribute('action');
    if (button.value === 'Tracking' && button.classList.contains('selected') && action === '/trackings/untrack') return 'tracked';
    if (button.value === 'Track artist' && !button.classList.contains('selected') && action === '/trackings') return 'untracked';
    return 'unknown';
  }
  async function profile(id) {
    const { doc, url } = await load(`/artists/${id}`, new RegExp(`^/artists/${id}(?:-[a-zA-Z0-9-]+)?/?$`));
    const controls = [...doc.querySelectorAll(`button.artist-track-button[data-artist-id="${id}"]`)];
    const states = new Set(controls.map(controlState));
    if (!controls.length || states.size !== 1 || states.has('unknown')) throw new Error('Songkick tracking controls are missing or inconsistent. Nothing was changed.');
    const name = text(doc.querySelector('h1'));
    if (!name) throw new Error('Songkick artist name is missing.');
    return { id, name, url: location.origin + url.pathname, state: [...states][0], button: controls[0] };
  }

  async function search(query) {
    const path = `/search?${new URLSearchParams({ query, type: 'artists' })}`;
    const { doc } = await load(path, /^\/search$/);
    const container = doc.querySelector('.search.event-listings');
    if (!container) {
      if (/no results|didn[’']t find|did not find|0 results/i.test(text(doc.body))) return { candidates: [] };
      throw new Error('Songkick search markup changed.');
    }
    const candidates = [...container.querySelectorAll('li.artist')].map(row => {
      const link = row.querySelector('p.summary a.search-link[data-resource-name="artist"]');
      if (!link) throw new Error('Songkick search markup changed.');
      return { id: link.getAttribute('data-id'), name: text(link), url: new URL(link.getAttribute('href'), location.origin).href,
        detail: text(row.querySelector('.subject')), state: controlState(row.querySelector('button.artist-track-button')) };
    });
    return { candidates };
  }

  function trackedEntries(doc) {
    const list = doc.querySelector('ul.un-tracker');
    const count = text(doc.body).match(/You[’']re tracking ([\d,]+) artists?\./);
    if (!list || !count) throw new Error('Songkick tracked-list markup changed.');
    const artists = [...list.querySelectorAll('li')].map(row => {
      const anchor = row.querySelector('a[href^="/artists/"]');
      const checkbox = row.querySelector('input[name="subject_ids[]"]');
      if (!anchor || !checkbox || !text(anchor)) throw new Error('A tracked artist could not be read.');
      return { id: checkbox.value, name: text(anchor), url: new URL(anchor.getAttribute('href'), location.origin).href };
    });
    return { artists, total: Number(count[1].replaceAll(',', '')) };
  }
  async function trackedList() {
    const first = trackedEntries((await load('/tracker/artists', /^\/tracker\/artists$/)).doc);
    const byId = new Map(first.artists.map(artist => [artist.id, artist]));
    const pages = first.artists.length ? Math.ceil(first.total / first.artists.length) : 1;
    const queue = Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 2);
    const worker = async () => {
      for (let page = queue.shift(); page; page = queue.shift()) {
        const result = trackedEntries((await load(`/tracker/artists?page=${page}`, /^\/tracker\/artists$/)).doc);
        if (result.total !== first.total) throw new Error('Your Songkick tracked list changed while it was being read. Sync again.');
        for (const artist of result.artists) byId.set(artist.id, artist);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    const artists = [...byId.values()];
    const complete = artists.length === first.total;
    return { artists, total: first.total, complete,
      reason: complete ? `Read all ${first.total} tracked artists.` : `Read ${artists.length} of ${first.total} tracked artists.` };
  }

  // Sends Songkick's own Track form, exactly as its button would. Only a form whose action is
  // /trackings is ever sent; an artist already showing Tracking is left alone.
  async function track(id) {
    if (tracking) throw new Error('Another tracking action is running.');
    tracking = true;
    try {
      const before = await profile(id);
      if (before.state === 'tracked') return { status: 'already-tracked', name: before.name, url: before.url };
      const form = before.button.form;
      const data = new FormData(form);
      if (form.getAttribute('action') !== '/trackings' || form.method !== 'post' ||
          data.get('subject_id') !== id || data.get('subject_type') !== 'Artist') {
        throw new Error('Unexpected Songkick Track form. Nothing was changed.');
      }
      if (before.button.name) data.append(before.button.name, before.button.value);
      const response = await fetch('/trackings', { method: 'POST', body: new URLSearchParams(data), credentials: 'same-origin', redirect: 'manual' });
      if (response.status === 429) throw stop('Songkick is rate limiting. Wait a few minutes and try again.');
      if (!response.ok && response.type !== 'opaqueredirect') throw new Error(`Songkick returned HTTP ${response.status} when tracking.`);
      for (let attempt = 0; attempt < 3; attempt++) {
        await wait(300 * (attempt + 1));
        const after = await profile(id);
        if (after.state === 'tracked') return { status: 'added', name: after.name, url: after.url };
      }
      throw new Error('Songkick did not show Tracking afterwards. The next sync checks again before retrying.');
    } finally { tracking = false; }
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
    if (!['SONGKICK_PING', 'SONGKICK_SEARCH', 'SONGKICK_PROFILE', 'SONGKICK_TRACK', 'SONGKICK_TRACKED'].includes(message?.type)) return;
    Promise.resolve().then(() => {
      if (message.type === 'SONGKICK_PING') return { ready: true };
      if (message.type === 'SONGKICK_TRACKED') return trackedList();
      if (message.type === 'SONGKICK_SEARCH') {
        if (typeof message.query !== 'string' || !message.query.trim() || message.query.length > 300) throw new Error('Invalid search.');
        return search(message.query.trim());
      }
      if (typeof message.id !== 'string' || !/^[1-9]\d*$/.test(message.id)) throw new Error('Invalid artist ID.');
      if (message.type === 'SONGKICK_TRACK') return track(message.id);
      return profile(message.id).then(({ button, ...result }) => result);
    }).then(result => respond({ ok: true, result }), error => respond({ ok: false, error: error.message, fatal: Boolean(error.fatal) }));
    return true;
  });
})();
