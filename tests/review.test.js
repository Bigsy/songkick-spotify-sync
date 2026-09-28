import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewer, selectionFor, automaticTargets, selectedTargets, counts } from '../src/review.js';

const sp = (n, name) => ({ id: String(n).padStart(22, '0'), name, url: `https://open.spotify.com/artist/${String(n).padStart(22, '0')}` });
const sk = (id, name, state = 'untracked') => ({ id: String(id), name, url: `https://www.songkick.com/artists/${id}`, state, detail: '' });
const base = () => ({ artists: [], tracked: { artists: [] }, searches: {}, choices: {}, selection: {}, results: {} });

function library() {
  const state = base();
  const artists = {
    exact: sp(1, 'Arranged in April'), similar: sp(2, 'gavin m'), choose: sp(3, 'Growing Pains'),
    none: sp(4, 'Chinese Cigarettes'), tracked: sp(5, 'Jank'), unsearched: sp(6, 'New band'), maybe: sp(7, 'minor issue'),
  };
  state.artists = Object.values(artists);
  state.tracked.artists = [sk(50, 'The Jank')];
  state.searches[artists.exact.id] = { candidates: [sk(10, 'Arranged In April')] };
  state.searches[artists.similar.id] = { candidates: [sk(20, 'Gavin M.')] };
  state.searches[artists.choose.id] = { candidates: [sk(30, 'growing pains'), sk(31, 'Growing Pains (PDX)')] };
  state.searches[artists.none.id] = { candidates: [] };
  state.searches[artists.maybe.id] = { candidates: [sk(70, 'Minor Issues')] };
  return { state, artists };
}

test('every artist lands in exactly one bucket', () => {
  const { state } = library();
  assert.deepEqual(counts(state), { exact: 1, similar: 1, choose: 1, none: 2, tracked: 1, unsearched: 1 });
});

test('only exact matches, prior choices and retries run automatically', () => {
  const { state, artists } = library();
  assert.deepEqual(automaticTargets(state).map(item => item.target.id), ['10']);
  state.choices[artists.choose.id] = { id: '31', name: 'Growing Pains (PDX)', url: 'https://www.songkick.com/artists/31' };
  state.results[artists.similar.id] = { id: '20', name: 'Gavin M.', url: 'https://www.songkick.com/artists/20', status: 'failed', error: 'x' };
  assert.deepEqual(automaticTargets(state).map(item => item.target.id).sort(), ['10', '20', '31']);
});

test('added, dismissed and already tracked artists never run again', () => {
  const { state, artists } = library();
  state.results[artists.exact.id] = { id: '10', status: 'added' };
  state.choices[artists.choose.id] = { skip: true };
  const view = reviewer(state);
  assert.equal(view(artists.exact).bucket, 'added');
  assert.equal(view(artists.choose).bucket, 'skipped');
  assert.equal(automaticTargets(state).length, 0);
  // A chosen artist that is already in the tracked list counts as tracked.
  state.tracked.artists.push(sk(30, 'growing pains'));
  state.choices[artists.choose.id] = { id: '30', name: 'growing pains', url: 'https://www.songkick.com/artists/30' };
  assert.equal(reviewer(state)(artists.choose).bucket, 'tracked');
});

test('a tracked candidate from search results is treated as tracked', () => {
  const { state, artists } = library();
  state.searches[artists.exact.id] = { candidates: [sk(10, 'Arranged In April', 'tracked')] };
  assert.equal(reviewer(state)(artists.exact).bucket, 'tracked');
});

test('similar matches start ticked; unticking dismisses them on Add', () => {
  const { state, artists } = library();
  const view = reviewer(state)(artists.similar);
  assert.equal(selectionFor(state, artists.similar, view), '20');
  assert.deepEqual(selectedTargets(state).targets.map(item => item.target.id), ['20']);
  state.selection[artists.similar.id] = '';
  assert.deepEqual(selectedTargets(state), { targets: [], skips: [artists.similar.id] });
});

test('choices need an explicit pick; "none" dismisses, no answer leaves it open', () => {
  const { state, artists } = library();
  assert.equal(selectedTargets(state).targets.some(item => item.artist.id === artists.choose.id), false);
  assert.equal(selectedTargets(state).skips.includes(artists.choose.id), false);
  state.selection[artists.choose.id] = '31';
  assert.ok(selectedTargets(state).targets.some(item => item.target.id === '31'));
  state.selection[artists.choose.id] = '';
  assert.ok(selectedTargets(state).skips.includes(artists.choose.id));
  state.selection[artists.maybe.id] = '70';
  assert.ok(selectedTargets(state).targets.some(item => item.target.id === '70'));
  state.selection[artists.choose.id] = 'not-an-option';
  assert.equal(selectedTargets(state).targets.some(item => item.artist.id === artists.choose.id), false);
});

test('two Spotify artists that resolve to one Songkick artist are added once', () => {
  const { state } = library();
  const twin = sp(8, 'Arranged In April');
  state.artists.push(twin);
  state.searches[twin.id] = { candidates: [sk(10, 'Arranged In April')] };
  assert.equal(automaticTargets(state).length, 1);
});
