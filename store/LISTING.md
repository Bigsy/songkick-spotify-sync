# Chrome Web Store listing

Everything the Developer Dashboard asks for, ready to paste. Regenerate the images with `node store/render.mjs` and build the upload zip with `npm run package`.

## Before submitting

- **Name and trademarks.** "Spotify" and "Songkick" are other companies' trademarks. Store review, and Spotify's brand guidelines, can object to them in an extension's name or promo art. A safer pattern is a name of your own with the services described in the text, for example *Gig Sync: follow your Spotify artists on Songkick*. The assets use no Spotify or Songkick logos or brand colours. If you rename, change `name` in `manifest.json` and the text in `store/frame.html`, then re-render.
- **Site terms.** The extension reads pages and submits Songkick's Track form from your own signed-in tabs. Check you are comfortable with both sites' terms for automated use before publishing publicly.
- **Robustness for other people.** Selectors assume the English Spotify and Songkick interfaces and Spotify's list-view library. See [FEASIBILITY.md](../FEASIBILITY.md).
- A Chrome Web Store developer account has a one-off registration fee.

## Store listing tab

**Name** (max 75): Spotify to Songkick

**Summary** (max 132):
Add the artists you follow on Spotify to your Songkick tracked artists in one click, using your own signed-in tabs.

**Description:**

```
Follow hundreds of artists on Spotify but never hear when they tour? Spotify to Songkick adds the artists you follow on Spotify to your Songkick tracked artists, so Songkick can alert you when they play near you.

HOW IT WORKS
• Press Sync. The extension reads the artists in your Spotify library, reads your full Songkick tracked list, and looks up anything new on Songkick.
• Every artist with exactly one same-spelled match on Songkick is added for you.
• Only the few that need you are shown: near-identical names arrive pre-ticked for a quick glance, and when several Songkick artists share a name you pick the right one once.
• Artists Songkick doesn't list yet stay visible, with near-miss spellings to check and a way to paste the right Songkick link.

FAST
A first sync of about a thousand artists takes around two minutes. Later syncs only look up artists you've followed since.

PRIVATE BY DESIGN
• Works entirely in your browser, using the Spotify and Songkick tabs you're already signed in to. No accounts, API keys or servers.
• Nothing is sent to the developer or anyone else. Your data stays in local extension storage and can be cleared at any time.
• It only ever adds: it never unfollows on Spotify or untracks on Songkick.

NOTES
• Needs the English Spotify web player with Your Library in list view, and a signed-in Songkick tab.
• Not affiliated with, endorsed by or sponsored by Spotify or Songkick.
```

**Category:** Lifestyle › Entertainment

**Language:** English

**Graphic assets** (all in `store/out/`):

| Field | File | Size |
|---|---|---|
| Store icon | `store-icon-128.png` | 128×128 (96×96 artwork, 16 px padding) |
| Screenshots | `screenshot-1-needs.png` … `screenshot-4-none.png` | 1280×800, 24-bit PNG, no alpha |
| Small promo tile | `promo-small-440x280.png` | 440×280 |
| Marquee promo tile | `promo-marquee-1400x560.png` | 1400×560 (optional) |

Screenshots use fictional demo artists (`store/demo.js`), not a real library.

**Official URL / homepage:** https://github.com/Bigsy/songkick-spotify-sync

**Support URL:** https://github.com/Bigsy/songkick-spotify-sync/issues

## Privacy practices tab

**Single purpose:**
Adds the artists a user follows on Spotify to that user's Songkick tracked artists.

**Permission justifications:**

- `storage`: Saves the user's scanned artist list, Songkick search results, match choices and progress locally, so a sync can resume and later syncs only look up new artists.
- Host permission `https://open.spotify.com/*`: Reads the followed-artist names and IDs from the Your Library list in the user's own Spotify tab. Nothing on Spotify is changed.
- Host permission `https://www.songkick.com/*`: Reads the user's tracked-artist list, search results and artist pages from their Songkick tab, and submits Songkick's own Track form for the artists the user adds.

**Remote code:** No, I am not using remote code. All code is packaged with the extension.

**Data usage:** The extension handles *website content* (artist names and IDs shown on Spotify and Songkick pages). It is processed and stored only on the user's device and is never transmitted to the developer or third parties. Tick the three certifications: not sold to third parties, not used for purposes unrelated to the single purpose, not used for creditworthiness or lending.

**Privacy policy URL:** https://github.com/Bigsy/songkick-spotify-sync/blob/main/store/PRIVACY.md

## Package tab

Upload `dist/spotify-to-songkick.zip` from `npm run package`. It contains only the extension files (manifest, background, sync page, content scripts, icons), not tests or store assets.
