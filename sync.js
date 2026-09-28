import { artistURL, validCandidates } from './src/matching.js';
import { reviewer, selectionFor, automaticTargets, selectedTargets, counts } from './src/review.js';

const $ = id => document.getElementById(id);
const KEY = 'spotifySongkickSync';
const fresh = () => ({ version: 2, artists: [], scan: null, tracked: null, searches: {}, choices: {}, selection: {}, results: {}, mode: null });
let state = fresh();
let busy = false;
let owner = false;
let stopping = false;
let scanRun = null;
let writes = Promise.resolve();
let lastSave = 0;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const fatal = message => Object.assign(new Error(message), { fatal: true });

function say(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
function progress(done, total) {
  $('progress').hidden = total === undefined;
  if (total !== undefined) { $('progress').max = Math.max(total, 1); $('progress').value = done; }
}
function save() {
  const snapshot = structuredClone(state);
  lastSave = Date.now();
  writes = writes.catch(() => {}).then(() => chrome.storage.local.set({ [KEY]: snapshot }));
  return writes;
}
const saveSoon = () => (Date.now() - lastSave > 1500 ? save() : Promise.resolve());

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function link(text, url, site, className) {
  let href;
  try { href = site ? artistURL(url, site).url : url; } catch { return element('span', text, className); }
  const node = element('a', text, className);
  node.href = href;
  node.target = '_blank';
  node.rel = 'noreferrer';
  return node;
}
const searchURL = name => `https://www.songkick.com/search?${new URLSearchParams({ query: name, type: 'artists' })}`;
const upcoming = candidate => candidate.detail?.match(/(\d+) upcoming events?/)?.[1];

// ---- Site tabs -------------------------------------------------------------------------

async function send(tabId, payload) {
  let response;
  try { response = await chrome.tabs.sendMessage(tabId, payload); }
  catch { throw fatal('A site tab stopped responding. Reload it and sync again.'); }
  if (!response?.ok) throw Object.assign(new Error(response?.error || 'The site tab did not respond.'), { fatal: Boolean(response?.fatal) });
  return response.result;
}
async function loaded(tabId) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw fatal('A site tab was closed.');
    if (tab.status === 'complete') return;
    await wait(250);
  }
  throw fatal('A site tab took too long to load.');
}
// Uses the most recently used tab for each site. A tab opened before the extension was
// installed or reloaded has no content script yet, so it is reloaded once.
async function siteTab(site) {
  const spotify = site === 'spotify';
  const tabs = await chrome.tabs.query({ url: spotify ? 'https://open.spotify.com/*' : 'https://www.songkick.com/*' });
  let tab = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  if (!tab) {
    if (spotify) {
      await chrome.tabs.create({ url: 'https://open.spotify.com/' });
      $('setup').hidden = false;
      throw fatal('Opened Spotify. Sign in and show Your Library, then press Sync again.');
    }
    tab = await chrome.tabs.create({ url: 'https://www.songkick.com/tracker/artists', active: false });
    await loaded(tab.id);
  }
  const ping = { type: spotify ? 'SPOTIFY_PING' : 'SONGKICK_PING' };
  try { await send(tab.id, ping); } catch {
    say(`Reloading the ${spotify ? 'Spotify' : 'Songkick'} tab so the extension can reach it…`);
    await chrome.tabs.reload(tab.id);
    await loaded(tab.id);
    await wait(spotify ? 3000 : 300);
    await send(tab.id, ping);
  }
  return tab.id;
}

// ---- Work ------------------------------------------------------------------------------

async function task(mode, work) {
  if (busy || !owner) return;
  busy = true;
  stopping = false;
  state.mode = mode;
  render();
  try { await save(); await work(); }
  catch (error) { say(error.message, true); }
  finally {
    state.mode = null;
    busy = false;
    scanRun = null;
    progress();
    try { await save(); } catch { say('Could not save progress. Check Chrome storage before continuing.', true); }
    render();
  }
}

async function scanSpotify() {
  const tabId = await siteTab('spotify');
  scanRun = { id: crypto.randomUUID(), tabId };
  say('Reading your followed artists on Spotify…');
  progress(0, state.scan?.total || 1);
  const result = await send(tabId, { type: 'SPOTIFY_SCAN', runId: scanRun.id });
  const artists = result.artists.map(artist => {
    const parsed = artistURL(artist.url, 'spotify');
    if (parsed.id !== artist.id || typeof artist.name !== 'string') throw new Error('Invalid Spotify scan data.');
    return { id: parsed.id, name: artist.name, url: parsed.url };
  });
  if (!artists.length) { $('setup').hidden = false; throw new Error(result.reason); }
  // A partial scan still helps (it only ever adds), but never drops artists from a previous complete one.
  const known = new Map(result.complete ? [] : state.artists.map(artist => [artist.id, artist]));
  for (const artist of artists) known.set(artist.id, artist);
  state.artists = [...known.values()];
  state.scan = { complete: result.complete, reason: result.reason, total: result.total, count: artists.length, at: Date.now() };
  $('setup').hidden = result.complete;
  await save();
}
chrome.runtime.onMessage.addListener((payload, sender) => {
  if (!owner || !scanRun || payload?.type !== 'SPOTIFY_PROGRESS' || payload.runId !== scanRun.id ||
      sender.id !== chrome.runtime.id || sender.tab?.id !== scanRun.tabId) return;
  if (Number.isInteger(payload.count) && Number.isInteger(payload.total)) {
    say(`Reading your followed artists on Spotify · ${payload.count} of ${payload.total}`);
    progress(payload.count, payload.total);
  }
});

async function readTracked(tabId) {
  say('Reading your Songkick tracked artists…');
  const result = await send(tabId, { type: 'SONGKICK_TRACKED' });
  state.tracked = { artists: validCandidates(result.artists).map(({ id, name, url }) => ({ id, name, url })),
    total: result.total, complete: result.complete, reason: result.reason, at: Date.now() };
  await save();
  return state.tracked;
}

async function searchAll(tabId) {
  const view = reviewer(state);
  const pending = state.artists.filter(artist => view(artist).bucket === 'unsearched');
  let done = 0;
  let failures = 0;
  const worker = async () => {
    for (let artist = pending.shift(); artist && !stopping; artist = pending.shift()) {
      try {
        const result = await send(tabId, { type: 'SONGKICK_SEARCH', query: artist.name });
        state.searches[artist.id] = { candidates: validCandidates(result.candidates), at: Date.now() };
        failures = 0;
      } catch (error) {
        state.searches[artist.id] = { candidates: [], error: error.message, at: Date.now() };
        if (error.fatal || ++failures >= 3) { stopping = true; throw error; }
      }
      done++;
      say(`Looking up artists on Songkick · ${done} of ${done + pending.length}`);
      progress(done, done + pending.length);
      await saveSoon();
      await wait(250);
    }
  };
  if (!pending.length) return;
  await Promise.all([worker(), worker()]);
  await save();
}

async function addAll(tabId, targets) {
  const run = [];
  for (const [i, { artist, target }] of targets.entries()) {
    if (stopping) break;
    say(`Adding ${target.name} to Songkick · ${i + 1} of ${targets.length}`);
    progress(i, targets.length);
    // Saved before acting, so an interruption is rechecked (never repeated blindly) next time.
    state.results[artist.id] = { id: target.id, name: target.name, url: target.url, status: 'pending', at: Date.now() };
    await save();
    try {
      const outcome = await send(tabId, { type: 'SONGKICK_TRACK', id: target.id });
      Object.assign(state.results[artist.id], { status: 'added', name: outcome.name, url: outcome.url, error: null });
      run.push(artist.id);
    } catch (error) {
      Object.assign(state.results[artist.id], { status: 'failed', error: error.message });
      if (error.fatal) { await save(); throw error; }
    }
    await save();
    render();
    await wait(600);
  }
  if (!run.length) return 0;
  // Independent check: every addition must appear in the tracked list itself.
  const tracked = await readTracked(tabId);
  const ids = new Set(tracked.artists.map(artist => artist.id));
  let verified = 0;
  for (const id of run) {
    if (ids.has(state.results[id].id)) verified++;
    else Object.assign(state.results[id], { status: 'failed', error: 'Not in your Songkick tracked list afterwards.' });
  }
  await save();
  return verified;
}

async function sync() {
  await scanSpotify();
  render();
  if (stopping) return finish(0);
  const songkick = await siteTab('songkick');
  await readTracked(songkick);
  render();
  await searchAll(songkick);
  render();
  const added = stopping ? 0 : await addAll(songkick, automaticTargets(state));
  finish(added);
}
async function addSelected() {
  const { targets, skips } = selectedTargets(state);
  for (const id of skips) { state.choices[id] = { skip: true }; delete state.selection[id]; }
  for (const { artist, target } of targets) { state.choices[artist.id] = { id: target.id, name: target.name, url: target.url }; delete state.selection[artist.id]; }
  await save();
  render();
  const songkick = await siteTab('songkick');
  finish(await addAll(songkick, automaticTargets(state)));
}
async function addByLink(artist) {
  const value = prompt(`Paste the Songkick artist link for ${artist.name}:`);
  if (!value) return;
  const target = artistURL(value.trim(), 'songkick');
  const songkick = await siteTab('songkick');
  const profile = await send(songkick, { type: 'SONGKICK_PROFILE', id: target.id });
  state.choices[artist.id] = { id: profile.id, name: profile.name, url: profile.url };
  delete state.results[artist.id];
  finish(await addAll(songkick, [{ artist, target: state.choices[artist.id] }]));
}
function finish(added) {
  const totals = counts(state);
  const needs = (totals.similar || 0) + (totals.choose || 0) + (totals.retry || 0);
  const parts = [added ? `Added ${added} artist${added === 1 ? '' : 's'} to Songkick.` : stopping ? 'Stopped.' : 'Nothing new to add automatically.'];
  if (needs) parts.push(`${needs} need${needs === 1 ? 's' : ''} you below.`);
  if (state.scan && !state.scan.complete) parts.push(state.scan.reason);
  say(parts.join(' '));
}

// ---- Rendering -------------------------------------------------------------------------

const matches = artist => artist.name.toLowerCase().includes($('filter').value.trim().toLowerCase());
function persist() { render(); save().catch(error => say(error.message, true)); }

function spotifyName(artist) {
  return link(artist.name, artist.url, 'spotify', 'name');
}
function candidateLink(candidate) {
  const wrap = element('span');
  wrap.append(link(candidate.name, candidate.url, 'songkick'));
  const events = upcoming(candidate);
  if (events && events !== '0') wrap.append(element('span', ` · ${events} upcoming`, 'meta'));
  return wrap;
}
function similarRow(artist, view, locked) {
  const li = element('li');
  const label = element('label');
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = selectionFor(state, artist, view) === view.target.id;
  check.disabled = locked;
  check.setAttribute('aria-label', `Add ${view.target.name} for ${artist.name}`);
  check.onchange = () => { state.selection[artist.id] = check.checked ? view.target.id : ''; persist(); };
  label.append(check, element('span', artist.name, 'name'));
  li.append(label, element('span', '→', 'arrow'), candidateLink(view.target));
  return li;
}
function chooseRow(artist, view, locked) {
  const li = element('li');
  li.append(spotifyName(artist), link('search ↗', searchURL(artist.name), undefined, 'meta'));
  const options = element('div', undefined, 'options');
  const picked = selectionFor(state, artist, view);
  for (const candidate of [...view.options, { id: '', name: 'None of these' }]) {
    const label = element('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = `choose-${artist.id}`;
    radio.checked = picked === candidate.id;
    radio.disabled = locked;
    radio.onchange = () => { state.selection[artist.id] = candidate.id; persist(); };
    label.append(radio, candidate.id ? candidateLink(candidate) : element('span', candidate.name, 'meta'));
    options.append(label);
  }
  li.append(options);
  return li;
}
function retryRow(artist, view) {
  const li = element('li');
  li.append(spotifyName(artist), element('span', '→', 'arrow'), link(view.target.name, view.target.url, 'songkick'));
  if (view.error) li.append(element('span', view.error, 'error-text'));
  return li;
}
function noneRow(artist, view, locked) {
  const li = element('li');
  li.append(spotifyName(artist));
  if (view.bucket === 'skipped') {
    li.append(element('span', 'dismissed', 'meta'));
    const undo = element('button', 'Undo', 'link');
    undo.disabled = locked;
    undo.onclick = () => { delete state.choices[artist.id]; delete state.selection[artist.id]; persist(); };
    li.append(undo);
    return li;
  }
  const picked = selectionFor(state, artist, view);
  for (const candidate of view.options || []) {
    const label = element('label', undefined, 'meta');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = picked === candidate.id;
    check.disabled = locked;
    check.onchange = () => { if (check.checked) state.selection[artist.id] = candidate.id; else delete state.selection[artist.id]; persist(); };
    label.append(check, element('span', 'maybe '), candidateLink(candidate));
    li.append(label);
  }
  li.append(link('search ↗', searchURL(artist.name), undefined, 'meta'));
  const paste = element('button', 'paste link', 'link');
  paste.disabled = locked;
  paste.onclick = () => task('link', () => addByLink(artist));
  li.append(paste);
  return li;
}
function simpleRow(artist, view) {
  const li = element('li');
  li.append(spotifyName(artist));
  const target = view.target || view.artists?.[0];
  if (target) li.append(element('span', '→', 'arrow'), link(target.name, target.url, 'songkick'));
  if (view.how === 'similar') li.append(element('span', 'similar name', 'meta'));
  return li;
}

function fill(list, rows, limit = Infinity) {
  const shown = rows.slice(0, limit);
  $(list).replaceChildren(...shown);
  if (rows.length > shown.length) $(list).append(element('li', `${rows.length - shown.length} more; use Find an artist to narrow this down.`, 'more'));
}
function render() {
  const locked = busy || !owner;
  const view = reviewer(state);
  const groups = {};
  for (const artist of state.artists) {
    const current = view(artist);
    (groups[current.bucket] ||= []).push({ artist, view: current });
  }
  const size = bucket => groups[bucket]?.length || 0;
  const needs = size('similar') + size('choose') + size('retry');
  const pending = size('unsearched') + size('exact') + size('queued');

  $('sync').disabled = locked;
  $('sync').textContent = state.artists.length ? 'Sync' : 'Start';
  $('stop').hidden = !busy;
  $('stop').disabled = !owner || stopping;
  $('clear').disabled = locked;

  const chip = (value, label, attention) => {
    const li = element('li', undefined, attention ? 'attention' : '');
    li.append(element('strong', String(value)), document.createTextNode(label));
    return li;
  };
  $('summary').replaceChildren(...(state.artists.length ? [
    chip(state.artists.length, 'followed on Spotify'),
    chip(size('tracked') + size('added'), 'on Songkick'),
    ...(size('added') ? [chip(size('added'), 'added by this tool')] : []),
    ...(needs ? [chip(needs, 'need you', true)] : []),
    ...(size('none') + size('skipped') ? [chip(size('none') + size('skipped'), 'not on Songkick')] : []),
    ...(pending ? [chip(pending, 'left to check', true)] : []),
  ] : []));

  const { targets } = selectedTargets(state);
  $('needs').hidden = !needs;
  $('needs-count').textContent = needs;
  $('add').textContent = targets.length ? `Add ${targets.length} to Songkick` : 'Save choices';
  $('add').disabled = locked;
  const visible = bucket => (groups[bucket] || []).filter(({ artist }) => matches(artist));
  for (const [bucket, make] of [['similar', similarRow], ['choose', chooseRow], ['retry', retryRow]]) {
    $(`${bucket}-block`).hidden = !size(bucket);
    fill(bucket, visible(bucket).map(({ artist, view: current }) => make(artist, current, locked)));
  }
  const noneRows = [...visible('none'), ...visible('skipped')];
  const setGroup = (id, list, rows, total) => {
    $(id).querySelector('.count').textContent = total;
    $(id).hidden = !total;
    // Long lists are only built while open.
    if ($(id).open || $('filter').value) fill(list, rows, 200); else $(list).replaceChildren();
  };
  setGroup('none-group', 'none', noneRows.map(({ artist, view: current }) => noneRow(artist, current, locked)), size('none') + size('skipped'));
  setGroup('added-group', 'added', visible('added').map(({ artist, view: current }) => simpleRow(artist, current)), size('added'));
  setGroup('tracked-group', 'tracked', visible('tracked').map(({ artist, view: current }) => simpleRow(artist, current)), size('tracked'));
  $('filter').hidden = !state.artists.length;
  $('scan-detail').textContent = state.scan
    ? `Spotify: ${state.scan.complete ? 'complete' : 'partial'} scan, ${state.scan.count} artists${state.tracked ? ` · Songkick: ${state.tracked.total} tracked` : ''}. Saved in this Chrome profile.`
    : 'Saved in this Chrome profile.';
}

$('sync').onclick = () => task('sync', sync);
$('add').onclick = () => task('add', addSelected);
$('stop').onclick = () => {
  stopping = true;
  if (scanRun) chrome.tabs.sendMessage(scanRun.tabId, { type: 'SPOTIFY_CANCEL', runId: scanRun.id }).catch(() => {});
  say('Stopping after the current step…');
  render();
};
$('filter').oninput = () => render();
for (const id of ['none-group', 'added-group', 'tracked-group']) $(id).ontoggle = () => render();
$('clear').onclick = () => {
  if (!confirm('Clear saved scans, choices and history? Your Spotify and Songkick accounts are not changed.')) return;
  task('clear', async () => { state = fresh(); await save(); say('Local data cleared.'); });
};

// Only one extension page can own work at a time, even across windows.
await new Promise(resolve => {
  navigator.locks.request('spotify-songkick-controller', { ifAvailable: true }, async lock => {
    owner = Boolean(lock);
    resolve();
    if (lock) await new Promise(() => {});
  });
});
try {
  const stored = (await chrome.storage.local.get(KEY))[KEY];
  if (stored?.version === 2) state = { ...fresh(), ...stored };
  if (owner) {
    const interrupted = state.mode;
    state.mode = null;
    await save();
    if (interrupted) say('The last run was interrupted. Press Sync to pick up where it left off.');
    else say(state.artists.length ? 'Press Sync to check for new Spotify artists.' : 'Press Start to read your Spotify artists and match them on Songkick.');
  } else say('Another sync page is open. Use that one, or close it and reload this page.', true);
  $('setup').hidden = Boolean(state.scan?.complete);
} catch (error) { owner = false; say(`Could not load saved progress: ${error.message}`, true); }
render();
