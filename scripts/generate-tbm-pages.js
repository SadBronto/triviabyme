// Build-time static site generator for TriviaByMe (TBM). Runs as the Netlify
// build command - reads the same Google Sheet triviawriterscoop.com (TWC)
// already owns and writes to, and produces plain static HTML. No login, no
// write access, no live backend of any kind: TBM never lets anyone add or
// edit an event directly. Hosts add/edit their events on TWC; the next TBM
// build picks up whatever's in the sheet at that point.
//
// TBM's entire purpose is driving awareness of TWC (see the project's
// README), so this isn't subtle: TWC's own navy/gold brand colors, TWC's
// logo in the header, a real "what is TWC Certified" section up front, TWC
// Certified events sorted first everywhere, host directory links, and a
// substantial "About the Co-Op" footer - not a thin banner afterthought.
//
// Same fail-safe policy as TWC's own generator: if the Sheets fetch fails,
// log a warning and exit 0 without touching any files, so a bad build never
// takes the whole site down.

const fs = require('fs');
const path = require('path');
const {
  slugify, escapeHtml, titleCase, formatLocationLabel,
  fetchInPersonEvents, fetchTbmCrawlerEvents, fetchBusinessProfilesByUserId, attachDirectoryLinks,
  buildLocationTree, eventJsonLd, TWC_SITE_URL,
} = require('trivia-events-shared');
const { SPREADSHEET_ID, getSheetsClient } = require('./lib/sheets');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const STATIC_DIR = path.join(__dirname, '..', 'static');
const SITE_URL = 'https://triviabyme.com';
const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function writeFileEnsured(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function renderEventCard(e, city) {
  const jsonLd = JSON.stringify(eventJsonLd(e, city)).replace(/</g, '\\u003c');
  const directoryLink = e.directoryUrl
    ? `<a class="directory-link" href="${escapeHtml(e.directoryUrl)}" target="_blank" rel="noopener">See ${escapeHtml(e.companyName || e.hostName)}'s full profile on TWC &rarr;</a>`
    : '';
  return `
      <div class="event-card">
        <h3>${escapeHtml(e.venueName || e.companyName || 'Trivia Night')}${e.certified ? ' <span class="badge">TWC Certified</span>' : ''}</h3>
        <p class="event-meta">${escapeHtml(e.day)} ${escapeHtml(e.time)} ${escapeHtml(e.timezone)}${e.frequency ? ' - ' + escapeHtml(e.frequency) : ''}</p>
        <p class="event-host">Hosted by ${escapeHtml(e.companyName || e.hostName)}</p>
        ${e.address ? `<p class="event-address">${escapeHtml(e.address)}</p>` : ''}
        ${directoryLink}
        <script type="application/ld+json">${jsonLd}</script>
      </div>`;
}

// Groups a city's events by day of week (Monday-first, matching the sign-up
// form's own dropdown order) so a page with a dozen-plus events reads as
// scannable day sections instead of one long undifferentiated list. Any day
// value that doesn't match the 7 known names (bad/legacy data) still gets
// shown, grouped under "Other", rather than silently dropped.
function renderDayGroupedEvents(sortedEvents, city) {
  const byDay = new Map();
  sortedEvents.forEach((e) => {
    const key = DAY_ORDER.includes(e.day) ? e.day : 'Other';
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(e);
  });

  return [...DAY_ORDER, 'Other']
    .filter((day) => byDay.has(day))
    .map((day) => {
      const heading = day === 'Other' ? 'Other Trivia Nights' : `${day} Night Trivia`;
      const cards = byDay.get(day).map((e) => renderEventCard(e, city)).join('\n');
      return `<h2 class="day-heading">${escapeHtml(heading)}</h2>\n<div class="event-grid">\n${cards}\n</div>`;
    }).join('\n');
}

// public/ is fully rebuilt from scratch every run (see main()), since every
// page in it is generated - but that means hand-authored assets (currently
// just the favicon) need a permanent home outside public/ that survives the
// wipe, copied back in as the last build step. Add any future static asset
// to static/ and it'll show up the same way.
function copyStaticAssets() {
  if (!fs.existsSync(STATIC_DIR)) return;
  for (const file of fs.readdirSync(STATIC_DIR)) {
    fs.copyFileSync(path.join(STATIC_DIR, file), path.join(PUBLIC_DIR, file));
  }
}

// Namespaces region/city slugs by country so e.g. the US state "Georgia"
// and the country "Georgia" can never collide into the same output file -
// a real risk once regions are grouped by country instead of assumed unique.
function buildTbmTree(events) {
  const { cities, regions } = buildLocationTree(events);
  const countrySlugOf = (countryName) => slugify(countryName) || 'other';

  const countryMap = new Map(); // countrySlug -> { slug, label, regions: [] }
  regions.forEach((r) => {
    const countrySlug = countrySlugOf(r.country);
    if (!countryMap.has(countrySlug)) {
      countryMap.set(countrySlug, { slug: countrySlug, label: formatLocationLabel(r.country), regions: [] });
    }
    r.tbmSlug = `${countrySlug}-${r.slug}`;
    countryMap.get(countrySlug).regions.push(r);
  });

  cities.forEach((c) => {
    const countrySlug = countrySlugOf(c.country);
    c.tbmRegionSlug = `${countrySlug}-${c.regionSlug}`;
    c.tbmSlug = `${c.citySlug}-${c.tbmRegionSlug}`;
  });

  return { cities, regions, countries: Array.from(countryMap.values()) };
}

// ---- Shared page chrome ------------------------------------------------
// Colors are TWC's own (navy #1e3a5f, gold #c5a572) on purpose, not "inspired
// by" - matching exactly is what makes TBM read as the same family at a
// glance, which does more for brand recognition than any amount of banner
// text.

function pageShell({ title, description, canonicalPath, bodyHtml, extraHead = '', extraScripts = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE_URL}${canonicalPath}">
<link rel="canonical" href="${SITE_URL}${canonicalPath}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
${extraHead}
<style>
*{box-sizing:border-box;}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8f9fa;color:#1e3a5f;margin:0;display:flex;flex-direction:column;min-height:100vh;}
a{color:inherit;}
.container{max-width:900px;margin:0 auto;padding:0 1.5rem;flex:1;width:100%;}
header.site-header{background:#1e3a5f;color:white;padding:0.85rem 0;}
header.site-header .container{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.75rem;}
.logo{font-size:1.4rem;font-weight:800;text-decoration:none;color:white;letter-spacing:-0.02em;}
.logo span{color:#c5a572;}
nav.site-nav a{color:white;text-decoration:none;font-size:0.9rem;font-weight:600;margin-left:1.25rem;opacity:0.9;}
nav.site-nav a:hover{opacity:1;text-decoration:underline;}
main{padding:2rem 0 3rem;}
h1{font-size:2rem;margin:0 0 0.5rem;}
h2{font-size:1.25rem;}
p.lede{color:#555;font-size:1.05rem;}
.crumbs{font-size:0.85rem;color:#888;margin-bottom:1rem;}
.crumbs a{text-decoration:none;color:#1e3a5f;font-weight:600;}
.crumbs a:hover{text-decoration:underline;}
.card{background:white;border-radius:12px;padding:1.5rem;box-shadow:0 2px 10px rgba(30,58,95,0.08);}
.country-group{margin-bottom:1.75rem;}
.country-group h2{border-bottom:2px solid #c5a572;padding-bottom:0.35rem;margin-bottom:0.75rem;}
.count{color:#888;font-size:0.85rem;font-weight:400;}
ul.link-grid{list-style:none;padding:0;margin:0;columns:2;gap:1rem;}
ul.link-grid li{background:white;border-radius:10px;padding:0.8rem 1.1rem;margin-bottom:0.6rem;box-shadow:0 2px 8px rgba(30,58,95,0.07);break-inside:avoid;}
ul.link-grid li a{font-weight:700;text-decoration:none;color:#1e3a5f;}
ul.link-grid li a:hover{text-decoration:underline;}
.day-heading{font-size:1.15rem;color:#1e3a5f;margin:1.75rem 0 0.75rem;padding-bottom:0.35rem;border-bottom:2px solid #c5a572;}
.day-heading:first-of-type{margin-top:1rem;}
.event-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1rem;margin-bottom:0.5rem;}
.event-card{background:white;border-radius:12px;padding:1.25rem 1.5rem;box-shadow:0 2px 10px rgba(30,58,95,0.08);}
.event-card h3{margin:0 0 0.4rem;color:#1e3a5f;}
.event-meta,.event-host,.event-address{margin:0.2rem 0;color:#555;font-size:0.92rem;}
.badge{display:inline-block;background:#c5a572;color:#1e3a5f;font-size:0.7rem;font-weight:800;padding:0.15rem 0.55rem;border-radius:4px;vertical-align:middle;}
.certified-note{font-size:0.85rem;color:#555;margin:0 0 1.25rem;padding:0.7rem 1rem;background:rgba(197,165,114,0.15);border-left:3px solid #c5a572;border-radius:6px;}
.certified-note a{color:#1e3a5f;font-weight:700;}
.directory-link{display:inline-block;margin-top:0.3rem;font-size:0.85rem;font-weight:700;color:#1e3a5f;text-decoration:none;}
.directory-link:hover{text-decoration:underline;}
.host-cta{margin-top:2.5rem;padding:1.5rem;background:#1e3a5f;color:white;border-radius:12px;text-align:center;}
.host-cta a{display:inline-block;margin-top:0.75rem;background:#c5a572;color:#1e3a5f;font-weight:800;text-decoration:none;padding:0.65rem 1.5rem;border-radius:8px;}
.action-row{display:flex;gap:1rem;margin-bottom:1.25rem;align-items:stretch;flex-wrap:wrap;}
.action-col{flex:1;min-width:160px;display:flex;flex-direction:column;justify-content:space-between;gap:0.6rem;}
.report-box{background:#1e3a5f;color:white;padding:0.75rem 1rem;border-radius:12px;text-align:center;}
.report-box p{margin:0;font-size:0.85rem;}
.report-box a{display:inline-block;margin-top:0.55rem;background:#c5a572;color:#1e3a5f;font-weight:800;text-decoration:none;padding:0.5rem 1.1rem;border-radius:8px;font-size:0.85rem;}
.action-col #locateBtn{background:#1e3a5f;color:white;border:none;border-radius:8px;padding:0.6rem 1rem;font-weight:700;font-size:0.85rem;cursor:pointer;}
.action-col #locateBtn:hover{background:#16304d;}
.hero-cta{flex:2;min-width:240px;background:#1e3a5f;color:white;padding:0.9rem 1.25rem;border-radius:12px;text-align:center;}
@media (max-width:640px){.action-row{flex-direction:column;}.action-col{display:contents;}.hero-cta{order:1;}.report-box{order:2;}.action-col #locateBtn{order:3;}}
.hero-cta p{margin:0.3rem 0 0;font-size:0.85rem;color:#c9d4e0;}
.hero-cta a{display:inline-block;margin-top:0.65rem;background:#c5a572;color:#1e3a5f;font-weight:800;text-decoration:none;padding:0.55rem 1.1rem;border-radius:8px;font-size:0.85rem;}
footer.site-footer{background:#152c48;color:#c9d4e0;padding:2.5rem 0;margin-top:auto;font-size:0.9rem;}
footer.site-footer .twc-about{display:flex;gap:1.25rem;align-items:flex-start;padding-bottom:1.5rem;margin-bottom:1.5rem;border-bottom:1px solid rgba(255,255,255,0.15);}
footer.site-footer .twc-about img{height:56px;width:56px;border-radius:10px;background:white;padding:4px;flex-shrink:0;}
footer.site-footer .twc-about h3{color:white;margin:0 0 0.4rem;font-size:1.05rem;}
footer.site-footer a{color:white;font-weight:700;text-decoration:none;}
footer.site-footer a:hover{text-decoration:underline;}
footer.site-footer .footer-links{display:flex;gap:1.5rem;flex-wrap:wrap;margin-top:1rem;font-size:0.85rem;}
</style>
</head>
<body>
<header class="site-header">
<div class="container">
<a class="logo" href="/">Trivia<span>ByMe</span></a>
<nav class="site-nav"><a href="/">Find Trivia</a><a href="${TWC_SITE_URL}/business-directory.html">Business Directory</a><a href="${TWC_SITE_URL}/">Trivia Writers' Co-Op</a></nav>
</div>
</header>
<main class="container">
${bodyHtml}
</main>
<footer class="site-footer">
<div class="container">
<div class="twc-about">
<img src="${TWC_SITE_URL}/logo.png" alt="Trivia Writers' Co-Op logo">
<div>
<h3>About the Trivia Writers' Co-Op</h3>
<p style="margin:0;">TriviaByMe exists to help you find local trivia nights. Look for the <span class="badge" style="vertical-align:baseline;">TWC Certified</span> badge - it means that host has been vetted for reliability and quality by the <a href="${TWC_SITE_URL}/">Trivia Writers' Co-Op</a>, the organization dedicated to raising the bar for trivia quality worldwide.</p>
</div>
</div>
<p>Run trivia nights yourself? <a href="${TWC_SITE_URL}/input.html">Add your event on TWC</a> to get listed here too.</p>
<div class="footer-links">
<a href="${TWC_SITE_URL}/about-us.html">About TWC</a>
<a href="${TWC_SITE_URL}/business-directory.html">Business Directory</a>
<a href="${TWC_SITE_URL}/endorsements.html">Endorsements</a>
<a href="/privacy.html">Privacy</a>
<a href="/terms.html">Terms</a>
</div>
</div>
</footer>
${extraScripts}
</body>
</html>
`;
}

function hostCta() {
  return `<div class="host-cta">
<strong>Host a trivia night?</strong>
<p style="margin:0.4rem 0 0;">Add it free - Co-Op member or not, no account needed.</p>
<a href="${TWC_SITE_URL}/input.html">Add your event on TWC &rarr;</a>
</div>`;
}

// Compact version of the same CTA, for the homepage hero row (see
// renderTopIndex) - same message and link as hostCta(), just in a narrower
// box that sits in the action row instead of spanning full width.
function hostCtaCompact() {
  return `<div class="hero-cta">
<strong>Host a trivia night?</strong>
<p>Add it free - Co-Op member or not, no account needed.</p>
<a href="${TWC_SITE_URL}/input.html">Add your event on TWC &rarr;</a>
</div>`;
}

// ---- Map (homepage only) -------------------------------------------------
// Same technique TWC's own map already uses in production: Leaflet +
// Leaflet.markercluster + OpenStreetMap tiles, no API key needed for any of
// it. Pin data comes from a small static events.json written alongside the
// pages (see main()) - only events with real lat/lng end up in it, so a
// missing/blank coordinate just quietly skips that one event on the map
// instead of breaking anything (it's still fully browsable via the country/
// region/city pages below).

// A 5-point star polygon on a 24x24 viewBox (outer radius 10, inner
// radius 4, centered at 12,12).
const STAR_100 = '12,2 14.35,8.76 21.51,8.91 15.8,13.24 17.88,20.09 12,16 6.12,20.09 8.2,13.24 2.49,8.91 9.65,8.76';

// Every pin (and every cluster) is a circle - matching the reference image
// the user sent directly: a plain navy circle, with a gold star glyph
// centered inside for a TWC Certified event, nothing extra for anything
// else. Replaces an earlier approach that made the whole pin star-shaped
// for certified events - that made the (necessarily muted) gold read as
// LESS prominent than a plain navy circle, not more, since a star fills
// less of its own bounding box and its outline no longer matched every
// other pin's. Putting the star as a small glyph ON a normal circular pin
// sidesteps that: the outer silhouette and its contrast ring are identical
// for every pin regardless of certified status, so nothing about shape or
// size is fighting for attention - only the glyph inside says "certified."
// Shared between the static legend swatch (rendered here, once, at build
// time) and the client-side marker icon (MAP_SCRIPT's own copy below,
// which has to be a literal string since it runs in the browser, not here
// - keep the two in sync).
function starGlyph(sizePx) {
  return '<svg width="' + sizePx + '" height="' + sizePx + '" viewBox="0 0 24 24" style="display:block;"><polygon points="' + STAR_100 + '" fill="#c5a572"/></svg>';
}
function pinHtml(sizePx, fillColor, inner) {
  return '<div style="width:' + sizePx + 'px;height:' + sizePx + 'px;border-radius:50%;background:' + fillColor + ';box-shadow:0 0 0 1.5px rgba(255,255,255,0.75),0 0 0 3px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;">' + (inner || '') + '</div>';
}

const MAP_HEAD = `
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H" crossorigin="anonymous" />
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" integrity="sha384-pmjIAcz2bAn0xukfxADbZIb3t8oRT9Sv0rvO+BR5Csr6Dhqq+nZs59P0pPKQJkEV" crossorigin="anonymous" />
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css" integrity="sha384-wgw+aLYNQ7dlhK47ZPK7FRACiq7ROZwgFNg0m04avm4CaXS+Z9Y7nMu8yNjBKYC+" crossorigin="anonymous" />
<style>
#map{height:480px;border-radius:12px;box-shadow:0 2px 10px rgba(30,58,95,0.1);margin-bottom:0.75rem;}
.map-legend{display:flex;gap:1.25rem;align-items:center;font-size:0.85rem;color:#555;margin-bottom:2rem;flex-wrap:wrap;}
.map-legend .swatch{display:inline-flex;margin-right:0.35rem;vertical-align:middle;}
.map-legend .swatch svg{display:block;}
.map-legend .swatch.regular{display:inline-block;width:12px;height:12px;border-radius:50%;background:#1e3a5f;border:1.5px solid rgba(255,255,255,0.75);box-shadow:0 0 0 3px rgba(0,0,0,0.25);margin-right:0.35rem;vertical-align:middle;}
/* Leaflet.markercluster's own default cluster icon (colored by count -
   green/yellow/orange-red - left completely alone below) gets the same
   softened outside ring every other pin gets - box-shadow never overlaps
   the element's own background, so the count number and count-based color
   are untouched.

   REAL BUG, found live (2026-08-26): position:relative used to be set
   directly on .marker-cluster itself, to give the absolutely-positioned
   certified corner badge something to anchor to. .marker-cluster is the
   SAME element Leaflet's own core CSS marks position:absolute on (via
   .leaflet-marker-icon) to precisely place every cluster on the map -
   both are single-class selectors of equal specificity, and this stylesheet
   loads after Leaflet's, so this rule was silently winning and overwriting
   absolute with relative on every cluster icon. With position:relative,
   the transform Leaflet still applies for the correct coordinate became an
   offset from wherever normal DOM document-flow put the element instead of
   from a fixed, absolute origin - which put clusters at wildly wrong,
   unpredictable positions (confirmed live: US clusters rendering stacked
   vertically off the coast of South America) while leaving individual pins
   (which never carry the .marker-cluster class) completely unaffected -
   exactly the "TWC pins are fine, clustered pins are wrong" pattern
   reported, since the vast majority of multi-pin clusters are crawler-
   sourced simply by sheer data volume, not because of anything tied to
   being certified.

   Fixed by giving the badge its own dedicated wrapper (.cluster-wrap,
   below) to anchor to, so .marker-cluster's own position is never
   touched. Verified the fix directly: same real ~3500-event dataset,
   before vs after - before, clusters landed near the equator/Atlantic
   regardless of real location; after, every US cluster sits in its own
   correct region (Pacific NW/California/Midwest/Texas/Southeast), matching
   the coordinates already confirmed correct in the underlying data. */
.marker-cluster div{box-shadow:0 0 0 1.5px rgba(255,255,255,0.75),0 0 0 3px rgba(0,0,0,0.25);}
.marker-cluster .cluster-wrap{position:relative;width:40px!important;height:40px!important;margin:0!important;background:none!important;box-shadow:none!important;}
/* The corner badge is a div too, which would otherwise inherit
   .marker-cluster div's own 30px size / margin / count-color background
   rules above (that selector matches ANY div inside, not just Leaflet's
   own count div) - reset every one of those back to what the badge's own
   inline style actually wants. */
.marker-cluster .cert-badge{width:18px!important;height:18px!important;margin:0!important;background:#1e3a5f!important;box-shadow:0 0 0 1.5px #fff!important;}
</style>`;

const MAP_SCRIPT = `
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH" crossorigin="anonymous"></script>
<script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js" integrity="sha384-eXVCORTRlv4FUUgS/xmOyr66XBVraen8ATNLMESp92FKXLAMiKkerixTiBvXriZr" crossorigin="anonymous"></script>
<script>
(function () {
  function escapeHtml(v) {
    const d = document.createElement('div');
    d.textContent = v == null ? '' : String(v);
    return d.innerHTML;
  }
  // Literal copy of generate-tbm-pages.js's own starGlyph()/pinHtml() -
  // has to be duplicated as a string since this whole block runs in the
  // browser, not at build time. Keep the two in sync.
  const STAR_100 = '12,2 14.35,8.76 21.51,8.91 15.8,13.24 17.88,20.09 12,16 6.12,20.09 8.2,13.24 2.49,8.91 9.65,8.76';
  function starGlyph(sizePx) {
    return '<svg width="' + sizePx + '" height="' + sizePx + '" viewBox="0 0 24 24" style="display:block;"><polygon points="' + STAR_100 + '" fill="#c5a572"/></svg>';
  }
  function pinHtml(sizePx, fillColor, inner) {
    return '<div style="width:' + sizePx + 'px;height:' + sizePx + 'px;border-radius:50%;background:' + fillColor + ';box-shadow:0 0 0 1.5px rgba(255,255,255,0.75),0 0 0 3px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;">' + (inner || '') + '</div>';
  }
  function pinIcon(sizePx, fillColor, inner) {
    return L.divIcon({ className: '', html: pinHtml(sizePx, fillColor, inner), iconSize: [sizePx, sizePx], iconAnchor: [sizePx / 2, sizePx / 2] });
  }
  fetch('/events.json').then((r) => r.json()).then((events) => {
    const map = L.map('map', {
      // worldCopyJump removed - it exists to let panning jump seamlessly
      // across the antimeridian when there's no hard boundary stopping
      // you, which maxBounds below already does, making it pointless here.
      // (Tested directly whether it was also misprojecting far-side-of-
      // the-world markers, since that's what a previous zoom-out fix
      // seemed to expose - it wasn't: a controlled side-by-side test with
      // worldCopyJump on vs off produced pixel-identical marker positions
      // both ways. Leaving it off anyway since it's genuinely unneeded.)
      maxBounds: [[-90, -180], [90, 180]],
      maxBoundsViscosity: 1.0,
      // Reverted to minZoom 2 (was briefly 1, to let the whole world fit
      // in view at once) - the real problem zooming out that far exposed
      // wasn't marker projection, it was Leaflet.markercluster's own
      // cluster-anchor behavior: a cluster's icon isn't positioned at its
      // members' geographic centroid, so at world-scale zoom a large
      // cluster can visually land somewhere that looks entirely
      // disconnected from where its events actually are (hit live:
      // Australia-sized clusters appearing to sit off the coast of South
      // America/West Africa). That was always going to happen at zoom 1 -
      // it just was never reachable, and therefore never visible, before
      // minZoom allowed it. Not seeing the whole world in one glance is a
      // smaller problem than a map that looks broken.
      minZoom: 2,
    }).setView([39.8283, -98.5795], 4);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      noWrap: true,
      bounds: [[-85, -180], [85, 180]],
      minZoom: 2,
      maxZoom: 18,
    }).addTo(map);

    const CLUSTER_COLORS = { small: '#6ecc39', medium: '#f0c20c', large: '#f18017' };
    function clusterBucket(count) {
      if (count < 10) return 'small';
      if (count < 100) return 'medium';
      return 'large';
    }
    const cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      // A fixed pixel radius covers a proportionally HUGE real-world
      // distance at low zoom - at zoom 2, 70px was merging markers on
      // opposite coasts (thousands of miles apart) into one cluster with
      // a single anchor point, which is why big clusters looked like they
      // were floating over the ocean instead of over the country they
      // actually represent - not a data bug (checked directly: the
      // underlying coordinates are correct), just too aggressive a radius
      // for how zoomed-out the map allows. Tighter at low zoom, normal
      // (unchanged) from zoom 4 up, where 70px covers a much smaller,
      // reasonable real-world area.
      maxClusterRadius: function (zoom) {
        if (zoom <= 2) return 15;
        if (zoom === 3) return 30;
        return 70;
      },
      // A cluster containing at least one TWC Certified event gets a small
      // navy-and-gold star badge in the corner, on top of its normal
      // count-colored circle (the exact green/yellow/orange-red scheme
      // Leaflet.markercluster's own default CSS uses, see CLUSTER_COLORS -
      // untouched, still what a non-certified cluster looks like too) - the
      // count stays front and center and readable either way. Zooming in
      // and having a cluster split apart naturally drops the badge off any
      // resulting sub-cluster/individual pin that turns out to have no
      // certified event in it.
      iconCreateFunction: function (c) {
        const count = c.getChildCount();
        const bucket = clusterBucket(count);
        const hasCertified = c.getAllChildMarkers().some(function (m) { return m.certified; });
        // Wrapped in .cluster-wrap (position:relative, see MAP_HEAD) rather
        // than putting position:relative on .marker-cluster itself - that
        // element is the one Leaflet's own CSS needs to keep as
        // position:absolute to place the cluster correctly at all (real
        // bug this fixes, see MAP_HEAD's own comment on .marker-cluster).
        const html = '<div class="cluster-wrap"><div><span>' + count + '</span></div>'
          + (hasCertified
            ? '<div class="cert-badge" style="position:absolute;top:-4px;right:-4px;border-radius:50%;display:flex;align-items:center;justify-content:center;">' + starGlyph(12) + '</div>'
            : '')
          + '</div>';
        return L.divIcon({
          html: html,
          className: 'marker-cluster marker-cluster-' + bucket,
          iconSize: [40, 40],
        });
      },
    });
    events.forEach((e) => {
      // Every pin is the same navy circle - a TWC Certified event just
      // gets a gold star glyph centered inside it, nothing else changes.
      const size = e.certified ? 24 : 18;
      const inner = e.certified ? starGlyph(Math.round(size * 0.62)) : null;
      const icon = pinIcon(size, '#1e3a5f', inner);
      const marker = L.marker([e.lat, e.lng], { icon: icon });
      marker.certified = e.certified;
      const certifiedBadge = e.certified ? '<img src="${TWC_SITE_URL}/TWCSeal.png" style="width:26px;height:26px;float:right;">' : '';
      const directoryLink = e.directoryUrl ? '<a href="' + e.directoryUrl + '" target="_blank" rel="noopener" style="display:block;margin-top:0.4rem;font-weight:700;color:#1e3a5f;font-size:0.85rem;">See full profile on TWC &rarr;</a>' : '';
      marker.bindPopup(
        '<div style="min-width:200px;">' + certifiedBadge +
        '<div style="font-weight:700;color:#1e3a5f;">' + escapeHtml(e.venueName) + '</div>' +
        '<div style="color:#555;font-size:0.85rem;margin:0.2rem 0;">Hosted by ' + escapeHtml(e.hostName) + '</div>' +
        '<div style="font-size:0.85rem;color:#555;">' + escapeHtml(e.day) + ' ' + escapeHtml(e.time) + ' ' + escapeHtml(e.timezone) + '</div>' +
        directoryLink +
        '<a href="' + e.cityUrl + '" style="display:block;margin-top:0.4rem;font-weight:700;color:#1e3a5f;font-size:0.85rem;">More trivia in ' + escapeHtml(e.city) + ' &rarr;</a>' +
        '</div>'
      );
      cluster.addLayer(marker);
    });
    map.addLayer(cluster);

    document.getElementById('locateBtn').addEventListener('click', () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition((pos) => {
        map.setView([pos.coords.latitude, pos.coords.longitude], 11);
      });
    });
  }).catch(() => {
    document.getElementById('map').innerHTML = '<p style="padding:1rem;color:#888;">Map temporarily unavailable.</p>';
  });
})();
</script>`;

function mapSection() {
  return `
<div id="map"></div>
<div class="map-legend"><span><span class="swatch">${pinHtml(16, '#1e3a5f', starGlyph(10))}</span>TWC Certified</span><span><span class="swatch regular"></span>Everything else</span><span style="color:#888;">Numbered clusters are colored by how many pins are inside</span></div>`;
}

// ---- Page renderers -----------------------------------------------------

function renderTopIndex(countries) {
  const groups = countries
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((c) => {
      const totalEvents = c.regions.reduce((s, r) => s + r.cities.reduce((s2, ci) => s2 + ci.events.length, 0), 0);
      if (c.regions.length === 1 && c.regions[0].label === c.label) {
        return `<section class="country-group"><h2><a href="/${c.regions[0].tbmSlug}.html">${escapeHtml(c.label)}</a> <span class="count">(${totalEvents})</span></h2></section>`;
      }
      const sorted = c.regions.slice().sort((a, b) => a.label.localeCompare(b.label));
      const links = sorted.map((r) => {
        const n = r.cities.reduce((s, ci) => s + ci.events.length, 0);
        return `<li><a href="/${r.tbmSlug}.html">${escapeHtml(r.label)} (${n})</a></li>`;
      }).join('\n');
      return `<section class="country-group"><h2>${escapeHtml(c.label)} <span class="count">(${totalEvents})</span></h2><ul class="link-grid">\n${links}\n</ul></section>`;
    })
    .join('\n');

  const body = `
<h1>Find a Trivia Night Near You</h1>
<p class="lede">Find trivia nights near you, courtesy of the <a href="${TWC_SITE_URL}/">Trivia Writers' Co-Op</a>.</p>
<div class="action-row">
<div class="action-col">
<div class="report-box">
<p>See something wrong with a listing?</p>
<a href="${TWC_SITE_URL}/contact.html">Let us know &rarr;</a>
</div>
<button id="locateBtn" type="button">&#128205; Use My Location</button>
</div>
${hostCtaCompact()}
</div>
${mapSection()}
<h2 style="border-bottom:2px solid #c5a572;padding-bottom:0.35rem;">Or browse by location</h2>
${groups}
`;
  return pageShell({
    title: 'Find Trivia Nights Near You - TriviaByMe',
    description: "Find trivia nights near you, courtesy of the Trivia Writers' Co-Op.",
    canonicalPath: '/',
    bodyHtml: body,
    extraHead: MAP_HEAD,
    extraScripts: MAP_SCRIPT,
  });
}

function renderCountryPage(country) {
  const sorted = country.regions.slice().sort((a, b) => a.label.localeCompare(b.label));
  const totalEvents = sorted.reduce((s, r) => s + r.cities.reduce((s2, c) => s2 + c.events.length, 0), 0);
  const links = sorted.map((r) => {
    const n = r.cities.reduce((s, c) => s + c.events.length, 0);
    return `<li><a href="/${r.tbmSlug}.html">${escapeHtml(r.label)} (${n})</a></li>`;
  }).join('\n');

  const body = `
<p class="crumbs"><a href="/">All Countries</a></p>
<h1>Trivia Nights in ${escapeHtml(country.label)}</h1>
<p class="lede">${totalEvents} trivia night${totalEvents === 1 ? '' : 's'} across ${sorted.length} ${sorted.length === 1 ? 'region' : 'regions'}.</p>
<ul class="link-grid">
${links}
</ul>
${hostCta()}
`;
  return pageShell({
    title: `Trivia Nights in ${country.label} - TriviaByMe`,
    description: `Browse trivia nights across ${country.label}.`,
    canonicalPath: `/${country.slug}.html`,
    bodyHtml: body,
  });
}

function renderRegionPage(region, countryLabel) {
  const cityLinks = region.cities
    .slice()
    .sort((a, b) => a.city.localeCompare(b.city))
    .map((c) => `<li><a href="/${c.tbmSlug}.html">${escapeHtml(titleCase(c.city))} (${c.events.length})</a></li>`)
    .join('\n');
  const totalEvents = region.cities.reduce((sum, c) => sum + c.events.length, 0);

  const body = `
<p class="crumbs"><a href="/">All Countries</a> &rsaquo; <a href="/${slugify(countryLabel)}.html">${escapeHtml(countryLabel)}</a></p>
<h1>Trivia Nights in ${escapeHtml(region.label)}</h1>
<p class="lede">${totalEvents} trivia night${totalEvents === 1 ? '' : 's'} across ${region.cities.length} ${region.cities.length === 1 ? 'city' : 'cities'}.</p>
<ul class="link-grid">
${cityLinks}
</ul>
${hostCta()}
`;
  return pageShell({
    title: `Trivia Nights in ${region.label} - TriviaByMe`,
    description: `${totalEvents} trivia night${totalEvents === 1 ? '' : 's'} across ${region.cities.length} ${region.cities.length === 1 ? 'city' : 'cities'} in ${region.label}.`,
    canonicalPath: `/${region.tbmSlug}.html`,
    bodyHtml: body,
  });
}

function renderCityPage(city, countryLabel, regionLabel) {
  const placeName = regionLabel && regionLabel !== countryLabel
    ? `${titleCase(city.city)}, ${regionLabel}`
    : `${titleCase(city.city)}, ${countryLabel}`;

  // TWC Certified first, always - the badge should mean something here more
  // than anywhere else, since surfacing it is the entire point of TBM.
  const sortedEvents = city.events.slice().sort((a, b) => (b.certified ? 1 : 0) - (a.certified ? 1 : 0));
  const hasCertified = sortedEvents.some((e) => e.certified);
  const certifiedExplainer = hasCertified
    ? `<p class="certified-note"><span class="badge">TWC Certified</span> What does "TWC Certified" mean? These hosts are vetted by the <a href="${TWC_SITE_URL}/">Trivia Writers' Co-Op</a> for quality and reliability.</p>`
    : '';

  const eventRows = renderDayGroupedEvents(sortedEvents, city);

  const crumbLabel = regionLabel && regionLabel !== countryLabel ? regionLabel : countryLabel;
  const crumbSlug = regionLabel && regionLabel !== countryLabel ? city.tbmRegionSlug : slugify(countryLabel);

  const lede = `Looking for something to do in ${escapeHtml(placeName)} this week? Maybe one of these awesome trivia nights can provide some entertainment for you!`;

  const body = `
<p class="crumbs"><a href="/">All Countries</a> &rsaquo; <a href="/${slugify(countryLabel)}.html">${escapeHtml(countryLabel)}</a> &rsaquo; <a href="/${crumbSlug}.html">${escapeHtml(crumbLabel)}</a></p>
<h1>${escapeHtml(placeName)} Trivia Nights</h1>
<p class="lede">${lede}</p>
${certifiedExplainer}
${eventRows}
${hostCta()}
`;
  return pageShell({
    title: `${placeName} Trivia Nights - TriviaByMe`,
    description: `Looking for something to do in ${placeName} this week? Maybe one of these awesome trivia nights can provide some entertainment for you!`,
    canonicalPath: `/${city.tbmSlug}.html`,
    bodyHtml: body,
  });
}

function regenerateSitemap(tree) {
  const urls = [
    { loc: '/', priority: '1.0' },
    ...tree.countries.map((c) => ({ loc: `/${c.regions.length === 1 && c.regions[0].label === c.label ? c.regions[0].tbmSlug : c.slug}.html`, priority: '0.8' })),
    ...tree.regions.map((r) => ({ loc: `/${r.tbmSlug}.html`, priority: '0.6' })),
    ...tree.cities.map((c) => ({ loc: `/${c.tbmSlug}.html`, priority: '0.6' })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>\n    <loc>${SITE_URL}${u.loc}</loc>\n    <priority>${u.priority}</priority>\n  </url>`).join('\n')}
</urlset>
`;
  fs.writeFileSync(path.join(PUBLIC_DIR, 'sitemap.xml'), xml);
}

// One row per event that has real coordinates - the homepage map's only data
// source. Events without lat/lng are simply absent from the map but still
// fully reachable via the country/region/city pages.
function writeEventsJson(cities) {
  const rows = [];
  cities.forEach((city) => {
    city.events.forEach((e) => {
      if (typeof e.lat !== 'number' || typeof e.lng !== 'number' || Number.isNaN(e.lat) || Number.isNaN(e.lng)) return;
      rows.push({
        lat: e.lat,
        lng: e.lng,
        venueName: e.venueName || e.companyName || 'Trivia Night',
        hostName: e.companyName || e.hostName,
        day: e.day,
        time: e.time,
        timezone: e.timezone,
        certified: e.certified,
        source: e.source,
        directoryUrl: e.directoryUrl || null,
        city: titleCase(city.city),
        cityUrl: `/${city.tbmSlug}.html`,
      });
    });
  });
  fs.writeFileSync(path.join(PUBLIC_DIR, 'events.json'), JSON.stringify(rows));
  return rows.length;
}

async function main() {
  console.log('[generate-tbm-pages] Fetching events and business profiles...');
  const sheets = getSheetsClient(['https://www.googleapis.com/auth/spreadsheets.readonly']);
  const [rawEvents, profilesByUserId] = await Promise.all([
    fetchInPersonEvents(sheets, SPREADSHEET_ID),
    fetchBusinessProfilesByUserId(sheets, SPREADSHEET_ID),
  ]);
  // Tagged 'twc' vs 'crawler' (carried into events.json, see writeEventsJson
  // below) purely as a data provenance marker - the map itself only ever
  // distinguishes on e.certified, not on where a listing came from.
  const twcEvents = attachDirectoryLinks(rawEvents, profilesByUserId).map((e) => ({ ...e, source: 'twc' }));

  // Crawler-sourced events (see trivia-events-shared's fetchTbmCrawlerEvents
  // for the full story) - TBM only, TWC's own generator never calls this.
  // Isolated in its own try/catch: a problem reading the "TBM" tab (missing,
  // malformed, still empty) should degrade to "just show TWC's real events,
  // like before this feature existed," never take down the whole build the
  // way the file-level fail-safe (see bottom of this file) would.
  let crawlerEvents = [];
  try {
    crawlerEvents = (await fetchTbmCrawlerEvents(sheets, SPREADSHEET_ID)).map((e) => ({ ...e, source: 'crawler' }));
  } catch (err) {
    console.warn('[generate-tbm-pages] Could not read TBM tab, continuing without crawler events:', err.message);
  }

  const events = [...twcEvents, ...crawlerEvents];
  console.log(`[generate-tbm-pages] ${twcEvents.length} TWC events + ${crawlerEvents.length} crawler events = ${events.length} total, ${profilesByUserId.size} business profiles.`);

  const tree = buildTbmTree(events);
  console.log(`[generate-tbm-pages] ${tree.countries.length} countries, ${tree.regions.length} regions, ${tree.cities.length} cities.`);

  fs.rmSync(PUBLIC_DIR, { recursive: true, force: true });
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });

  writeFileEnsured(path.join(PUBLIC_DIR, 'index.html'), renderTopIndex(tree.countries));

  tree.countries.forEach((country) => {
    // Single-region countries (no state data at all) skip their own
    // intermediate page - the region page (which already carries the
    // country's own name as its label) covers it, same special case as the
    // top index.
    if (country.regions.length === 1 && country.regions[0].label === country.label) return;
    writeFileEnsured(path.join(PUBLIC_DIR, `${country.slug}.html`), renderCountryPage(country));
  });

  tree.regions.forEach((region) => {
    writeFileEnsured(path.join(PUBLIC_DIR, `${region.tbmSlug}.html`), renderRegionPage(region, formatLocationLabel(region.country)));
  });

  tree.cities.forEach((city) => {
    // city.state is already canonical (buildLocationTree's own
    // canonicalState() output, not raw input) - reformatting it here was
    // the same redundant-and-wrong double-format bug fixed in
    // trivia-events-shared's buildLocationTree (see that repo's own
    // commit): titleCase capitalizes every word, turning a correct
    // "Newfoundland and Labrador" into a wrong "Newfoundland And Labrador".
    writeFileEnsured(path.join(PUBLIC_DIR, `${city.tbmSlug}.html`), renderCityPage(city, formatLocationLabel(city.country), city.state || formatLocationLabel(city.country)));
  });

  const mappedCount = writeEventsJson(tree.cities);
  console.log(`[generate-tbm-pages] ${mappedCount} events have coordinates and will appear on the map.`);

  regenerateSitemap(tree);
  copyStaticAssets();
  console.log('[generate-tbm-pages] Done.');
}

if (require.main === module) {
  main().catch((err) => {
    console.warn('[generate-tbm-pages] Skipped - failed to generate pages:', err.message);
    process.exit(0);
  });
}

module.exports = { buildTbmTree, renderTopIndex, renderCountryPage, renderRegionPage, renderCityPage, writeEventsJson };
