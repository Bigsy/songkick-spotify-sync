import { classify, trackedIndex } from './matching.js';

// Where each Spotify artist stands, derived from saved data only:
//   added / tracked         nothing to do
//   exact / queued / retry  handled automatically by the next run
//   similar / choose        needs the user (similar is pre-ticked)
//   none / skipped          not on Songkick, or dismissed by the user
//   unsearched              not looked up yet
export function reviewer(state) {
  const index = state.tracked?.artists ? trackedIndex(state.tracked.artists) : null;
  return artist => {
    const result = state.results[artist.id];
    if (result?.status === 'added') return { bucket: 'added', target: result };
    const choice = state.choices[artist.id];
    if (choice?.skip) return { bucket: 'skipped' };
    const known = index?.find(artist.name);
    if (choice?.id && index?.ids.has(choice.id)) return { bucket: 'tracked', how: 'chosen', artists: [choice] };
    if (known && !choice?.id) return { bucket: 'tracked', how: known.how, artists: known.artists };
    if (result) return { bucket: 'retry', target: result, error: result.error };
    if (choice?.id) return { bucket: 'queued', target: choice };
    const search = state.searches[artist.id];
    if (!search || search.error) return { bucket: 'unsearched', error: search?.error };
    const match = classify(artist, search.candidates);
    if (match.pick?.state === 'tracked') return { bucket: 'tracked', how: match.tier, artists: [match.pick] };
    if (match.tier === 'exact') return { bucket: 'exact', target: match.pick };
    if (match.tier === 'similar') return { bucket: 'similar', target: match.pick, options: match.options };
    if (match.tier === 'choose') return { bucket: 'choose', options: match.options };
    return { bucket: 'none', options: match.options };
  };
}

// The current tick for a row that needs the user. Similar matches start ticked.
export function selectionFor(state, artist, view) {
  if (Object.hasOwn(state.selection, artist.id)) return state.selection[artist.id];
  return view.bucket === 'similar' ? view.target.id : null;
}

// Targets for an automatic run: exact matches plus anything chosen, interrupted or failed.
export function automaticTargets(state) {
  const view = reviewer(state);
  return uniqueTargets(state.artists.map(artist => ({ artist, view: view(artist) }))
    .filter(({ view }) => ['exact', 'queued', 'retry'].includes(view.bucket))
    .map(({ artist, view }) => ({ artist, target: view.target })));
}

// Targets the user ticked, plus rows they left unticked (returned as skips).
export function selectedTargets(state) {
  const view = reviewer(state);
  const targets = [];
  const skips = [];
  for (const artist of state.artists) {
    const current = view(artist);
    if (!['similar', 'choose', 'none'].includes(current.bucket)) continue;
    const picked = selectionFor(state, artist, current);
    const target = (current.options || []).find(option => option.id === picked);
    if (target) targets.push({ artist, target });
    else if (current.bucket === 'similar' || (current.bucket === 'choose' && picked === '')) skips.push(artist.id);
  }
  return { targets: uniqueTargets(targets), skips };
}

function uniqueTargets(items) {
  const seen = new Set();
  return items.filter(({ target }) => !seen.has(target.id) && seen.add(target.id));
}

export function counts(state) {
  const view = reviewer(state);
  const totals = {};
  for (const artist of state.artists) {
    const { bucket } = view(artist);
    totals[bucket] = (totals[bucket] || 0) + 1;
  }
  return totals;
}
