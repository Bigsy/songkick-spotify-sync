// Store screenshots only: fakes the extension APIs so the real sync page renders fictional
// demo artists. render.mjs injects this before sync.js; it is not part of the extension.
(() => {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = list => list[Math.floor(random() * list.length)];
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const spotifyId = () => Array.from({ length: 22 }, () => pick(chars)).join('');
  let nextSongkick = 4100000;
  const slug = name => name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'artist';
  const sk = (name, events = 0) => { const id = String(nextSongkick += 7919); return { id, name, url: `https://www.songkick.com/artists/${id}-${slug(name)}`, detail: `ARTIST ${name} ${events} upcoming events`, state: 'untracked' }; };
  const sp = name => { const id = spotifyId(); return { id, name, url: `https://open.spotify.com/artist/${id}` }; };

  const first = ['Velvet', 'Northern', 'Paper', 'Hollow', 'Silver', 'Neon', 'Amber', 'Winter', 'Golden', 'Coastal', 'Electric', 'Pale', 'Lunar', 'Crimson', 'Faded', 'Tidal', 'Copper', 'Midnight', 'Gentle', 'Distant', 'Violet', 'Autumn', 'Rusted', 'Bright', 'Sleepy'];
  const second = ['Harbour', 'Orchard', 'Signals', 'Pilots', 'Kites', 'Hearts', 'Rivers', 'Satellites', 'Choir', 'Parade', 'Echoes', 'Fields', 'Gardens', 'Machines', 'Ghosts', 'Horses', 'Swimmers', 'Sparrows', 'Weather', 'Telephones', 'Postcards', 'Lighthouse', 'Commune', 'Estates', 'Holiday'];
  const used = new Set();
  const generated = count => {
    const names = [];
    while (names.length < count) {
      const name = random() < .3 ? `The ${pick(first)} ${pick(second)}` : `${pick(first)} ${pick(second)}`;
      if (!used.has(name.replace(/^The /, ''))) { used.add(name.replace(/^The /, '')); names.push(name); }
    }
    return names;
  };

  const state = { version: 2, artists: [], scan: null, tracked: { artists: [], complete: true }, searches: {}, choices: {}, selection: {}, results: {}, mode: null };
  const add = (name, candidates) => { const artist = sp(name); state.artists.push(artist); if (candidates) state.searches[artist.id] = { candidates, at: 1 }; return artist; };

  for (const name of generated(356)) { const artist = add(name); state.tracked.artists.push(sk(name)); void artist; }
  for (const name of generated(41)) { const artist = add(name); const target = sk(name, Math.floor(random() * 4)); state.results[artist.id] = { ...target, status: 'added', at: 1 }; }
  const similar = [['Paper Lanterns.', 'Paper Lanterns', 3], ['Moth & Moon', 'Moth and Moon', 0], ['Nightswim', 'Night Swim', 1], ["st. elmo's window", "St Elmo's Window", 0],
    ['The Quiet Arcade', 'Quiet Arcade', 2], ['CÖRAL BLOOM', 'Coral Bloom', 0], ['Lowlight!', 'Lowlight', 4], ['Glasshouse Kids', 'Glass House Kids', 0]];
  const similarArtists = similar.map(([name, match, events]) => add(name, [sk(match, events), sk(`${match.split(' ')[0]} Society`)]));
  state.selection[similarArtists[2].id] = '';
  const choose = [['Harbour Lights', [['Harbour Lights', 2], ['Harbour Lights (UK)', 0], ['Harbour Lights (AUS)', 1]]],
    ['Juniper', [['Juniper', 0], ['Juniper (CA)', 5]]], ['Low Tide Club', [['Low-Tide Club', 3], ['Lowtide Club', 0]]], ['Wren', [['Wren', 0], ['Wren (US)', 2], ['Wren (Leeds)', 1]]]];
  const chooseArtists = choose.map(([name, options]) => add(name, options.map(([option, events]) => sk(option, events))));
  const none = [['Seafoam Radio', [['Seafoam Radios', 0]]], ['Kettle Drum Summer', []], ['Bicycle Weather', [['Bicycle Thief', 2]]], ['Oh, Marigold', []], ['Tinfoil Telescope', []],
    ['Ferris & the Wheels', []], ['Lake Effect Choir', [['Lake Effect Choirs', 0]]], ['Soft Machinery', []], ['Porchlight Sessions', []], ['Hazel Grove', []], ['Quarter Moon Motel', []],
    ['Driftwood Ensemble', []], ['Sunday Static', []], ['Minor Planets', []]];
  for (const [name, options] of none) add(name, options.map(([option, events]) => sk(option, events)));
  const dismissed = add('Static Orchard', [sk('Static Orchard (NZ)')]);
  state.choices[dismissed.id] = { skip: true };
  state.scan = { complete: true, count: state.artists.length, total: state.artists.length, reason: `Collected all ${state.artists.length} artists Spotify reports.`, at: 1 };
  state.tracked.total = state.tracked.artists.length + 41;

  const scenario = new URLSearchParams(location.search).get('demo') || 'needs';
  if (scenario === 'choose') state.selection[chooseArtists[1].id] = state.searches[chooseArtists[1].id].candidates[1].id;
  if (scenario === 'progress') {
    // Mid-sync: the tracked list is read, new artists are still being looked up.
    for (const artist of state.artists.slice(356)) { delete state.searches[artist.id]; delete state.results[artist.id]; delete state.choices[artist.id]; }
    state.selection = {};
  }

  const noop = () => {};
  // Headless Chrome does not reliably grant Web Locks; the demo page is always the owner.
  Object.defineProperty(navigator, 'locks', { value: { request: (name, options, callback) => callback({ name }) } });
  window.chrome = {
    storage: { local: { get: async () => ({ spotifySongkickSync: structuredClone(state) }), set: async () => {} } },
    runtime: { id: 'demo', getURL: path => `/${path}`, onMessage: { addListener: noop }, sendMessage: async () => {} },
    tabs: { query: async () => [], sendMessage: async () => { throw new Error('demo'); } },
  };

  const $ = id => document.getElementById(id);
  // scrollIntoView would also scroll the frame around this page, so scroll only this document.
  const scrollToElement = (element, margin) => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - margin);
  const after = () => {
    if (scenario === 'needs') $('status').textContent = 'Added 41 artists to Songkick. 12 need you below.';
    if (scenario === 'choose') {
      $('status').textContent = 'Added 41 artists to Songkick. 12 need you below.';
      scrollToElement($('choose-block'), 24);
    }
    if (scenario === 'none') {
      $('status').textContent = 'Nothing new to add automatically.';
      $('none-group').open = true;
      setTimeout(() => scrollToElement($('none-group'), 16), 50);
    }
    if (scenario === 'progress') {
      $('status').textContent = 'Looking up artists on Songkick · 23 of 68';
      $('progress').hidden = false;
      $('progress').max = 68;
      $('progress').value = 23;
      $('stop').hidden = false;
      $('sync').disabled = true;
    }
  };
  window.addEventListener('load', () => setTimeout(after, 150));
})();
