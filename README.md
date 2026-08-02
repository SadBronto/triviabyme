# TriviaByMe (TBM)

A static site for finding real, active trivia nights, built to drive awareness of the [Trivia Writers' Co-Op](https://triviawriterscoop.com) (TWC). TriviaByMe is a separate brand/entity from TWC by design (mass-market discovery vs. a niche writers' co-op), but it exists specifically to put TWC in front of as many people as possible - see `docs/strategy.md` if this repo ever needs the full rationale copied over from TWC's own project notes.

## What this is (and isn't)

- **Static only.** Every page is plain HTML generated at build time. There is no live backend, no database, no API.
- **No login, ever.** Not Discord, not anything. Adding or editing a trivia night only ever happens on TWC (`triviawriterscoop.com/input.html`). TBM only reads.
- **Read-only against TWC's own data.** The build script reads the same Google Sheet TWC already writes to (`Form Responses 1` for events, `Business Profiles` for directory links) using a read-only scope. A member editing their event on TWC shows up here automatically on the next build - no code change needed.
- **TWC-forward by design.** TWC Certified events sort first everywhere. Every host with a TWC business-directory profile gets a direct link to it. A persistent banner and footer credit TWC on every page. This isn't incidental - it's the entire point of this site existing.

## Local development

```bash
npm install
GOOGLE_SHEETS_CREDENTIALS='<paste the same JSON TWC uses>' node scripts/generate-tbm-pages.js
```

Generated output lands in `public/` - open `public/index.html` directly, or serve the folder with any static file server.

## Deploying

This is meant to be its own Netlify site (separate from TWC's), pointed at `triviabyme.com`:

1. Create a new Netlify site from this repo.
2. Build command and publish directory are already set in `netlify.toml`.
3. Add `GOOGLE_SHEETS_CREDENTIALS` as an environment variable (Site configuration > Environment variables) - same value as TWC's own site uses for that variable.
4. Point `triviabyme.com`'s DNS at the new Netlify site (at your domain registrar - Netlify's site settings will show you exactly what record to add).

## Shared code with TWC

`scripts/lib/events-data.js` and `scripts/lib/sheets.js` are copied from TWC's repo (`scripts/lib/events-data.js` there). These are two separate git repos on purpose, so this can't be a real cross-repo import - if the matching/filtering/grouping logic in TWC's copy changes, copy the updated file here too (and vice versa). The file's own header comment says the same thing.
