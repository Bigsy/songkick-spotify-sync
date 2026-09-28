import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, looseName, artistURL, validCandidates, classify, trackedIndex } from '../src/matching.js';

const sk = (id, name, detail = '') => ({ id: String(id), name, url: `https://www.songkick.com/artists/${id}`, detail });
const tier = (name, candidates) => classify({ name }, candidates);

test('exact and loose name keys', () => {
  assert.equal(normalizeName('  BJÖRK   Live '), normalizeName('björk live'));
  assert.notEqual(normalizeName('Björk'), normalizeName('Bjork'));
  for (const [a, b] of [['Daïtro', 'Daitro'], ['Mom Jeans.', 'Mom Jeans'], ['Jank', 'The Jank'], ['Xingfoo&Roy', 'Xingfoo and Roy'], ['LaterGator', 'Later Gator']]) {
    assert.equal(looseName(a), looseName(b), `${a} ~ ${b}`);
  }
  assert.notEqual(looseName('Growing Pains'), looseName('Growing Pains (PDX)'));
  assert.equal(looseName('The'), 'the');
  assert.equal(looseName('!!!'), '!!!');
  assert.equal(looseName('死んだ僕の彼女'), '死んだ僕の彼女');
});

test('validates artist URLs and rejects external hosts, actions, credentials, and malformed IDs', () => {
  assert.deepEqual(artistURL('https://www.songkick.com/artists/9229214-hania-rani?x=y#bio', 'songkick'), { id: '9229214', url: 'https://www.songkick.com/artists/9229214-hania-rani' });
  assert.equal(artistURL('/artists/10370676', 'songkick').url, 'https://www.songkick.com/artists/10370676');
  for (const url of ['javascript:alert(1)', 'http://www.songkick.com/artists/1', 'https://www.songkick.com.evil.test/artists/1', 'https://www.songkick.com@evil.test/artists/1', 'https://user@www.songkick.com/artists/1', 'https://www.songkick.com:444/artists/1', 'https://www.songkick.com/trackings/untrack', 'https://www.songkick.com/artists/1/events', 'https://www.songkick.com/artists/0']) {
    assert.throws(() => artistURL(url, 'songkick'), url);
  }
  assert.throws(() => artistURL('https://open.spotify.com/artist/not-an-id', 'spotify'));
  assert.throws(() => validCandidates([{ ...sk(1, 'Love'), id: '9' }]));
  assert.equal(validCandidates([sk(1, 'Love'), sk(1, 'Love')]).length, 1);
});

test('one same-spelled candidate is an exact match, even among unrelated names', () => {
  const result = tier('Arranged in April', [sk(10370676, 'Arranged In April'), sk(2, 'Gone in April'), sk(3, 'Dead in April')]);
  assert.equal(result.tier, 'exact');
  assert.equal(result.pick.id, '10370676');
  // Songkick often lists the same band twice; the one spelled like Spotify wins.
  assert.equal(tier('Topbunk', [sk(1, 'Topbunk'), sk(2, 'Top Bunk')]).pick.id, '1');
  // Billing variants are the same artist, not competing ones.
  assert.equal(tier('Bonobo', [sk(1, 'Bonobo'), sk(2, 'Bonobo (DJ Set)'), sk(3, 'Bonobo (Live set)')]).tier, 'exact');
});

test('punctuation-only differences are similar, never exact', () => {
  const result = tier('gavin m', [sk(1, 'Gavin M.'), sk(2, 'Gavin Mikhail')]);
  assert.equal(result.tier, 'similar');
  assert.equal(result.pick.id, '1');
  assert.equal(tier('told', [sk(1, 'T.O.L.D.')]).tier, 'similar');
});

test('same-named artists and Songkick disambiguations need a choice', () => {
  assert.equal(tier('Growing Pains', [sk(1, 'growing pains'), sk(2, 'Growing Pains (PDX)')]).tier, 'choose');
  assert.equal(tier('Love', [sk(1, 'Love'), sk(2, 'LOVE')]).tier, 'choose');
  assert.equal(tier('Kidcrash', [sk(1, 'The Kidcrash'), sk(2, 'Kid Crash')]).tier, 'choose');
  const only = tier("You'll Live", [sk(1, "You'll Live (US)")]);
  assert.equal(only.tier, 'choose');
  assert.equal(only.pick, null);
});

test('near misses are offered but never picked; unrelated results are none', () => {
  const near = tier('minor issue', [sk(1, 'Minor Issues')]);
  assert.equal(near.tier, 'maybe');
  assert.equal(near.pick, null);
  assert.equal(tier('Sparce', [sk(1, 'Space'), sk(2, 'Sparse')]).tier, 'none');
  assert.equal(tier('Chinese Cigarettes', []).tier, 'none');
});

test('tracked index finds exact and similar names', () => {
  const index = trackedIndex([sk(1, 'Björk'), sk(2, 'The Jank'), sk(3, 'Love'), sk(4, 'Love')]);
  assert.equal(index.find('BJÖRK').how, 'exact');
  assert.equal(index.find('Jank').how, 'similar');
  assert.equal(index.find('Love').artists.length, 2);
  assert.equal(index.find('New artist'), null);
  assert.ok(index.ids.has('2'));
});
