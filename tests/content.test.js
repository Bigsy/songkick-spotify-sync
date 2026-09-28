import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const spotifyCode = await readFile(new URL('../src/spotify-content.js', import.meta.url), 'utf8');
const songkickCode = await readFile(new URL('../src/songkick-content.js', import.meta.url), 'utf8');
const extensionURL = 'chrome-extension://test/';
function runtime() {
  let listener;
  const api = { id: 'test', getURL: path => extensionURL + path,
    onMessage: { addListener: fn => { listener = fn; } }, sendMessage: async () => {} };
  return { api, call: (message, sender = { id: 'test', url: extensionURL + 'sync.html' }) => new Promise(resolve => listener(message, sender, resolve)), get listener() { return listener; } };
}
const plain = value => JSON.parse(JSON.stringify(value));

// A DOM-shaped double of the Songkick pages the content script fetches.
const doc = ({ one = {}, all = {}, body = '' }) => ({ body: { textContent: body }, querySelector: s => one[s] ?? all[s]?.[0] ?? null, querySelectorAll: s => all[s] || [] });
class FormData {
  constructor(form) { this.map = new Map(Object.entries(form.fields)); }
  get(key) { return this.map.get(key) ?? null; }
  append(key, value) { this.map.set(key, value); }
  [Symbol.iterator]() { return this.map[Symbol.iterator](); }
}
function songkick({ tracked = false, confirms = true, login = false, action = null, subject = null, challenge = false, trackedTotal = 120, trackedPages = [50, 50, 20] } = {}) {
  const rt = runtime();
  const posts = [];
  const artistPage = id => {
    const button = {
      value: tracked ? 'Tracking' : 'Track artist', disabled: false, name: '',
      classList: { contains: name => tracked && name === 'selected' },
      form: { method: 'post', getAttribute: () => action || (tracked ? '/trackings/untrack' : '/trackings'),
        fields: { authenticity_token: 'x', subject_id: subject || id, subject_type: 'Artist' } },
    };
    return doc({ body: challenge ? 'Too many requests. Verify you are human.' : '',
      one: { h1: { textContent: 'Artist' }, ...(login ? { 'a[href*="accounts.songkick.com/session/new"]': {} } : {}) },
      all: { [`button.artist-track-button[data-artist-id="${id}"]`]: [button] } });
  };
  const trackerPage = page => {
    const start = trackedPages.slice(0, page - 1).reduce((a, b) => a + b, 0);
    const rows = Array.from({ length: trackedPages[page - 1] || 0 }, (_, i) => {
      const id = String(start + i + 1);
      return { querySelector: s => s.startsWith('a[') ? { textContent: `Artist ${id}`, getAttribute: () => `/artists/${id}-artist` } : { value: id } };
    });
    return doc({ body: `Artists You’re tracking\n ${trackedTotal} artists.`, one: { 'ul.un-tracker': { querySelectorAll: () => rows } } });
  };
  const fetch = async (path, init = {}) => {
    const url = new URL(path, 'https://www.songkick.com');
    if (init.method === 'POST') {
      posts.push(Object.fromEntries(init.body));
      if (confirms) tracked = true;
      return { ok: false, status: 0, type: 'opaqueredirect' };
    }
    const artist = url.pathname.match(/^\/artists\/(\d+)$/);
    const page = artist ? artistPage(artist[1]) : trackerPage(Number(url.searchParams.get('page') || 1));
    return { ok: true, status: 200, url: artist ? `${url.origin}${url.pathname}-artist` : url.href, text: async () => page };
  };
  const DOMParser = class { parseFromString(page) { return page; } };
  vm.runInNewContext(songkickCode, { chrome: { runtime: rt.api }, fetch, DOMParser, FormData, URL, URLSearchParams,
    location: { origin: 'https://www.songkick.com' }, setTimeout: fn => fn() });
  return { ...rt, posts };
}

test('already tracked artists are never posted to or toggled off', async () => {
  const site = songkick({ tracked: true });
  assert.deepEqual(plain(await site.call({ type: 'SONGKICK_TRACK', id: '123' })).result.status, 'already-tracked');
  assert.equal(site.posts.length, 0);
});
test('one addition sends the Track form once and is re-read before counting', async () => {
  const site = songkick();
  assert.equal((await site.call({ type: 'SONGKICK_TRACK', id: '123' })).result.status, 'added');
  assert.equal((await site.call({ type: 'SONGKICK_TRACK', id: '123' })).result.status, 'already-tracked');
  assert.equal(site.posts.length, 1);
  assert.equal(site.posts[0].subject_id, '123');
});
test('unexpected forms, logout and challenges stop without posting', async () => {
  for (const [options, fatal] of [[{ action: '/unexpected' }, false], [{ subject: '999' }, false], [{ login: true }, true], [{ challenge: true }, true]]) {
    const site = songkick(options);
    const response = await site.call({ type: 'SONGKICK_TRACK', id: '123' });
    assert.equal(response.ok, false, JSON.stringify(options));
    assert.equal(response.fatal, fatal, JSON.stringify(options));
    assert.equal(site.posts.length, 0);
  }
});
test('a post without a confirmed Tracking state is a failure', async () => {
  const site = songkick({ confirms: false });
  const response = await site.call({ type: 'SONGKICK_TRACK', id: '123' });
  assert.equal(response.ok, false);
  assert.match(response.error, /did not show Tracking/);
  assert.equal(site.posts.length, 1);
});
test('messages from a content page cannot invoke tracking; IDs are validated', async () => {
  const site = songkick();
  let responded = false;
  site.listener({ type: 'SONGKICK_TRACK', id: '123' }, { id: 'test', url: 'https://www.songkick.com/' }, () => { responded = true; });
  assert.equal(responded, false);
  assert.equal((await site.call({ type: 'SONGKICK_TRACK', id: '1/../untrack' })).ok, false);
  assert.equal(site.posts.length, 0);
});
test('the tracked list reads every page and checks the reported total', async () => {
  const complete = plain((await songkick().call({ type: 'SONGKICK_TRACKED' })).result);
  assert.equal(complete.complete, true);
  assert.equal(complete.artists.length, 120);
  const partial = plain((await songkick({ trackedPages: [50, 50, 10] }).call({ type: 'SONGKICK_TRACKED' })).result);
  assert.equal(partial.complete, false);
  assert.equal(partial.artists.length, 110);
});

function spotify({ gap = false, changed = false, filter = true, cancel = false, disconnected = false } = {}) {
  const rt = runtime();
  let top = 0;
  const viewport = { clientHeight: 100, scrollHeight: 250, get scrollTop() { return top; }, set scrollTop(value) { top = Math.max(0, Math.min(value, 150)); } };
  const grid = {
    getAttribute: () => changed && top > 0 ? '7' : '6',
    closest: selector => selector === 'nav' ? { querySelectorAll: () => [] } : viewport,
    querySelectorAll: () => {
      const start = Math.min(4, Math.floor(top / 75) * 2);
      return [start + 1, start + 2].filter(index => !(gap && index === 3)).map(index => ({
        id: 'listrow-title-spotify:artist:' + String(index).padStart(22, '0'), textContent: `Artist ${index}`,
        closest: () => ({ getAttribute: () => String(index) }),
      }));
    },
  };
  const document = { querySelector: selector => selector.includes('role="grid"') ? grid : filter ? {} : null };
  rt.api.sendMessage = async () => { if (disconnected) throw new Error('Controller closed'); if (cancel) await rt.call({ type: 'SPOTIFY_CANCEL', runId: 'run' }); };
  vm.runInNewContext(spotifyCode, { chrome: { runtime: rt.api }, document, setTimeout: fn => fn() });
  return rt;
}
test('virtualized collection requires all stable IDs and row positions', async () => {
  const result = (await spotify().call({ type: 'SPOTIFY_SCAN', runId: 'run' })).result;
  assert.equal(result.complete, true);
  assert.equal(result.artists.length, 6);
  const partial = (await spotify({ gap: true }).call({ type: 'SPOTIFY_SCAN', runId: 'run' })).result;
  assert.equal(partial.complete, false);
  assert.equal(partial.artists.length, 5);
});
test('changed count, absent filter, and cancellation never claim completeness', async () => {
  for (const options of [{ changed: true }, { filter: false }, { cancel: true }, { disconnected: true }]) {
    const result = (await spotify(options).call({ type: 'SPOTIFY_SCAN', runId: 'run' })).result;
    assert.equal(result.complete, false, JSON.stringify(options));
    assert.ok(result.reason);
  }
});
