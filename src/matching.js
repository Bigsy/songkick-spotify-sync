// Exact key: case, Unicode form and whitespace only.
export function normalizeName(name) {
  return String(name).normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

// Loose key: also ignores Latin accents, punctuation, spacing, "&"/"+" vs "and" and a leading "The".
export function looseName(name) {
  const words = String(name).normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').normalize('NFC').toLowerCase()
    .replace(/[&+]/gu, ' and ').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words[0] === 'the' && words.length > 1) words.shift();
  return words.join('') || normalizeName(name);
}

export function artistURL(value, site) {
  const url = new URL(value, site === 'songkick' ? 'https://www.songkick.com' : undefined);
  const spotify = site === 'spotify';
  if (!spotify && site !== 'songkick') throw new Error('Unknown artist site.');
  const match = url.pathname.match(spotify
    ? /^\/artist\/([A-Za-z0-9]{22})\/?$/
    : /^\/artists\/([1-9]\d*)(?:-[a-zA-Z0-9-]+)?\/?$/);
  if (url.protocol !== 'https:' || url.hostname !== (spotify ? 'open.spotify.com' : 'www.songkick.com') ||
      url.port || url.username || url.password || !match) {
    throw new Error(`Enter a valid ${site} artist profile URL.`);
  }
  return { id: match[1], url: `${url.origin}${url.pathname.replace(/\/$/, '')}` };
}

export function validCandidates(candidates) {
  const unique = new Map();
  for (const candidate of candidates) {
    const parsed = artistURL(candidate.url, 'songkick');
    if (candidate.id !== parsed.id || typeof candidate.name !== 'string' || !candidate.name.trim()) {
      throw new Error('Invalid Songkick candidate.');
    }
    unique.set(parsed.id, { id: parsed.id, url: parsed.url, name: candidate.name.trim(),
      detail: String(candidate.detail || ''), state: candidate.state || 'unknown' });
  }
  return [...unique.values()];
}

// Songkick disambiguates same-named artists with a trailing "(PDX)", "(US)" and so on.
// Billing variants such as "(DJ Set)" are the same artist and are ignored.
const BILLING = /^(?:dj set|dj|live|live set|acoustic|solo|full band)$/i;
function disambiguates(candidateName, key) {
  const match = String(candidateName).match(/^(.*\S)\s*\(([^)]+)\)\s*$/u);
  return Boolean(match && looseName(match[1]) === key && !BILLING.test(match[2].trim()));
}
function billingVariant(candidateName, key) {
  const match = String(candidateName).match(/^(.*\S)\s*\(([^)]+)\)\s*$/u);
  return Boolean(match && looseName(match[1]) === key && BILLING.test(match[2].trim()));
}

function distance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = row;
  }
  return previous[b.length];
}

// Sorts one artist's search results into how much attention they need:
//   exact   one candidate with the same spelling: added without asking
//   similar one candidate that differs only in punctuation, accents or "The": ticked, shown for a glance
//   choose  several plausible artists share the name: the user picks one or none
//   maybe   only near-miss spellings (typos, plurals): offered, never ticked
//   none    nothing resembling the name
export function classify(artist, candidates) {
  const key = looseName(artist.name);
  const exactKey = normalizeName(artist.name);
  const pool = candidates.filter(candidate => !billingVariant(candidate.name, key));
  const close = pool.filter(candidate => looseName(candidate.name) === key);
  const exact = close.filter(candidate => normalizeName(candidate.name) === exactKey);
  const others = pool.filter(candidate => disambiguates(candidate.name, key));
  if (!others.length && exact.length === 1) return { tier: 'exact', pick: exact[0], options: [exact[0]] };
  if (!others.length && close.length === 1) return { tier: 'similar', pick: close[0], options: close };
  if (close.length || others.length) return { tier: 'choose', pick: null, options: [...close, ...others] };
  const limit = key.length >= 12 ? 2 : key.length >= 8 ? 1 : 0;
  const near = limit ? pool.filter(candidate => distance(key, looseName(candidate.name)) <= limit) : [];
  return near.length ? { tier: 'maybe', pick: null, options: near } : { tier: 'none', pick: null, options: [] };
}

// Any tracked artist with the same exact or loose name counts as already on Songkick.
// Wrongly treating an artist as tracked only means it is not added, so this errs towards quiet.
export function trackedIndex(tracked) {
  const ids = new Set();
  const exact = new Map();
  const loose = new Map();
  const add = (map, key, artist) => map.set(key, [...(map.get(key) || []), artist]);
  for (const artist of validCandidates(tracked)) {
    ids.add(artist.id);
    add(exact, normalizeName(artist.name), artist);
    add(loose, looseName(artist.name), artist);
  }
  return {
    ids,
    find(name) {
      if (exact.has(normalizeName(name))) return { how: 'exact', artists: exact.get(normalizeName(name)) };
      return loose.has(looseName(name)) ? { how: 'similar', artists: loose.get(looseName(name)) } : null;
    },
  };
}
