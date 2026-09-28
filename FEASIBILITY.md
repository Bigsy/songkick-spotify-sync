# Browser feasibility and verification

Checked 2026-09-28 in the user's normal Chrome Beta profile. The user enabled remote debugging and signed in. Development connection: Chrome DevTools MCP with `--autoConnect --channel=beta --categoryExtensions`. This is not required by the installed extension.

## Spotify: verified rendered interface

- Direct `/collection/artists` navigation did not provide a standalone artist list; it redirected. The working source is **Your Library → Artists**, in list view, with the library search empty.
- Filter: `[aria-label="Artists"][aria-checked="true"]`.
- Grid: `[role="grid"][aria-label="Your Library"]` with `aria-rowcount`.
- Titles: `[id^="listrow-title-spotify:artist:"]`; the suffix is the 22-character artist ID. Read the title's text and its closest `[role="row"]` → `aria-rowindex`. No artist link is required in this view.
- Scroll container: the grid's closest `[data-overlayscrollbars-viewport]` ancestor.
- Rows are virtualized. A read-only inspection collected 951 unique artists and every row position from 1 through 951. The installed extension subsequently collected all 952 artists after the authorized test addition.
- Completion requires the scroll bottom, an unchanged positive total, all unique IDs, and every row index. A stalled list is partial. Cancellation, absent filter, and count changes are tested with DOM-shaped test doubles.
- Both **Recents** and **Recently Added** exist in the library sort menu. Recently Added was selected for the development session.

## Songkick: verified rendered interface

- Search form uses GET `/search`, parameter `query`; the artist filter adds `type=artists`.
- Search container: `.search.event-listings`; rows: `li.artist`; identity link: `p.summary a.search-link[data-resource-name="artist"]`, with `data-id` and an `/artists/<numeric-id>-<slug>` href. `.subject` provides visible details.
- Searches can contain multiple same/similar names. `kickass` returned unrelated alternatives; no candidate was automatically confirmed. Search automation reads the first page and offers manual search/profile selection for more results.
- Artist heading: `h1`. Controls: `button.artist-track-button[data-artist-id="<id>"]`.
- Untracked: button value `Track artist`, no `selected` class, containing form action `/trackings`.
- Tracked: button value `Tracking`, `selected` class, form action `/trackings/untrack`.
- These form paths are checked as DOM state, never requested directly. The extension clicks the normal Track button only after all untracked indicators agree.
- Login links point to `accounts.songkick.com/session/new`. Login is manual; the extension has no access to that host.
- Tracked list: `/tracker/artists`, `ul.un-tracker li`, each containing an artist link and `input[name="subject_ids[]"]` with its ID. Only identity fields are read; the untracking form is never submitted.
- The page reports “You’re tracking 1583 artists.” The first page contains 50 entries, with `.pagination a.next_page[rel="next"]` linking to the next page. The final page has `.pagination .next_page.disabled`; the adapter also requires the unique-ID count to equal the reported total before declaring completion. The installed extension read all 32 pages and verified all 1583 unique artists.

## Live checks completed

- Loaded the unpacked extension in Chrome Beta, ID `iimphnofplconofphhnppemiebdepmdg`.
- The extension scanned 952/952 Spotify artists with all positions accounted for.
- The extension searched and parsed live Songkick candidates, including tracked artists and ambiguous/missing matches, and added an artist through its own Sync (see below).
- A second sync page was prevented from taking control by a Web Lock.
- The user authorized a test artist if necessary. Hania Rani was followed on Spotify (`14YzutUdMwS9yTnI0IFBaD`) and tracked on Songkick (`9229214`) by hand in the browser, before any automation existed. Spotify showed Following and its total increased from 951 to 952. Songkick showed Tracking, including after reload. Both additions remain in place; no removals were performed.

## Review on 2026-09-28 (version 0.2.0)

- The Track control is a plain form: `POST /trackings` with `utf8`, `authenticity_token`, `relationship_type=concerts`, `tracking_context=default`, `subject_id`, `subject_type=Artist`, `success_url`. The button has no `name`. Search results contain the same form for each candidate.
- Songkick artist pages carry no Spotify ID or MusicBrainz ID, so matching has to be by name.
- Fetched page timings: search ~340 ms, tracked-list page ~415 ms, artist page ~550 ms; three tracked-list pages in parallel ~440 ms in total. Tracked-list pages are `/tracker/artists?page=N`, 50 per page. The "You're tracking N artists." text has line breaks inside it in the raw HTML, so whitespace is normalized before matching.
- An artist URL without a slug (`/artists/10370676`) redirects to the slug form; profile reads accept that redirect.
- A read-only search of all 266 unsearched artists parsed every result page. The `.search.event-listings` container is present even with no results.
- 127 exact matches were tracked by sending the form (3, verified, then 124); each re-read as Tracking and the tracked total rose by exactly 127. The extension's own Sync then added Bonobo and verified it via the tracked list.
- A full extension sync took ~110 s: Spotify tab reload and a 952-artist scan (~15 s), tracked list (~5 s), 146 searches at two in flight (~75 s), one addition plus a tracked-list re-read (~10 s).
- The Spotify scanner now waits only until newly scrolled rows render, then revisits any skipped row positions. It completed 952/952.

## Verification limits

Automated tests use pure functions and DOM-shaped test doubles, not captured full pages. They exercise Unicode/whitespace handling, match tiers and ambiguous names, URL/ID validation, bucket and selection logic, deduplication, retry behavior, tracked-list pagination, virtualized scans, cancellation, login expiry and challenges, and never posting for tracked artists or unexpected forms. They do not reproduce every live network failure.

Live rate limiting, logout during a run, and tab closure during a tracking request are still unverified live. The implementation stops on these failures and retains progress, but those live failure cases are not claimed as verified.
