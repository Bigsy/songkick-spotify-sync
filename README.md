# Spotify to Songkick

A personal Manifest V3 Chrome extension that adds the artists you follow on Spotify to your Songkick tracked artists, using your signed-in browser tabs. Plain JavaScript; no API keys, hosted backend, build step, or runtime dependencies.

## Install and update

1. Open `chrome://extensions` in the Chrome profile where you use both sites.
2. Enable **Developer mode**, click **Load unpacked**, and select this directory.
3. Click the extension icon to open the sync page.

After changing files, click **Reload** on the extension card. The sync page reopens by itself, and the next sync reloads any Spotify or Songkick tab that predates the update. Saved progress survives reloads.

## Using it

1. Sign in to Spotify and Songkick. In Spotify, keep **Your Library** expanded in list view with its search box empty. The scanner selects the **Artists** filter itself.
2. Press **Sync**. It reads every artist you follow on Spotify, reads your whole Songkick tracked list, looks up anything new on Songkick, and adds every artist with exactly one same-spelled match. A full first sync of ~950 artists takes about two minutes; later syncs only look up new artists.
3. **Needs you** lists the rest:
   - **Similar name**: one match that differs only in punctuation, accents or a leading "The" (e.g. "gavin m" → "Gavin M."). These are ticked; untick any that look wrong.
   - **Pick the right one**: several Songkick artists share the name, or Songkick disambiguates them ("Growing Pains (PDX)"). Choose one or **None of these**.
   - **Couldn't add yet**: failures, retried on the next sync.
   Press **Add N to Songkick**. Unticked or "None" rows are dismissed and not suggested again (Undo is under **Not on Songkick**).
4. **Not on Songkick** lists artists with no plausible match, with a Songkick search link, any near-miss spellings as unticked "maybe" options, and **paste link** to add a specific Songkick artist page.

Artists already in your tracked list under the same or a similar name are left alone and shown under **Already on Songkick**.

## Safety and data

- It only ever adds. It never unfollows on Spotify or untracks on Songkick. It never sends a form unless its action is Songkick's `/trackings` (Track) and the artist currently shows **Track artist**.
- Songkick reads use same-origin fetches of Songkick's own pages from your Songkick tab, not tab navigation. Adding sends the artist page's own Track form, exactly as its button does. Each addition is re-read on the artist page, and the whole tracked list is re-read at the end; anything missing is marked failed and retried next time.
- Signed out, rate limited, or verification pages stop the run immediately. Resolve it in the tab, then sync again.
- Each addition is saved as pending before it is sent, so an interruption is rechecked on the next sync rather than repeated blindly. Only one sync page can run at a time.
- **Clear local data** removes the saved scans, choices and history (`chrome.storage.local`, not Chrome sync). It does not change either account. No cookies, passwords or session tokens are read or stored.
- Site redesigns, non-English labels, or a collapsed/grid Spotify library can require adapter updates.

## Permissions

`storage` persists local progress. Site access is limited to `https://open.spotify.com/*` and `https://www.songkick.com/*`. No cookies, scripting, broad tabs, or login-host access.

## Development

Run `npm test` with Node.js 20 or later. Tests cover name matching and match tiers, bucket and selection logic, URL validation, the Track form safety checks, tracked-list pagination, and the virtualized Spotify scan, using pure logic and DOM-shaped test doubles. They do not prove current live-site behaviour; see [FEASIBILITY.md](FEASIBILITY.md) for what was checked live and [PLAN.md](PLAN.md) for scope and decisions.
