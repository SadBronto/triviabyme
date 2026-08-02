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
  fetchInPersonEvents, fetchBusinessProfilesByUserId, attachDirectoryLinks,
  buildLocationTree, eventJsonLd, TWC_SITE_URL,
} = require('./lib/events-data');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const STATIC_DIR = path.join(__dirname, '..', 'static');
const SITE_URL = 'https://triviabyme.com';

function writeFileEnsured(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
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
.event-card{background:white;border-radius:12px;padding:1.25rem 1.5rem;margin-bottom:1rem;box-shadow:0 2px 10px rgba(30,58,95,0.08);}
.event-card h3{margin:0 0 0.4rem;color:#1e3a5f;}
.event-meta,.event-host,.event-address{margin:0.2rem 0;color:#555;font-size:0.92rem;}
.badge{display:inline-block;background:#c5a572;color:#1e3a5f;font-size:0.7rem;font-weight:800;padding:0.15rem 0.55rem;border-radius:4px;vertical-align:middle;}
.certified-note{font-size:0.85rem;color:#555;margin:0 0 1.25rem;padding:0.7rem 1rem;background:rgba(197,165,114,0.15);border-left:3px solid #c5a572;border-radius:6px;}
.certified-note a{color:#1e3a5f;font-weight:700;}
.directory-link{display:inline-block;margin-top:0.3rem;font-size:0.85rem;font-weight:700;color:#1e3a5f;text-decoration:none;}
.directory-link:hover{text-decoration:underline;}
.host-cta{margin-top:2.5rem;padding:1.5rem;background:#1e3a5f;color:white;border-radius:12px;text-align:center;}
.host-cta a{display:inline-block;margin-top:0.75rem;background:#c5a572;color:#1e3a5f;font-weight:800;text-decoration:none;padding:0.65rem 1.5rem;border-radius:8px;}
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
<p style="margin:0;">TriviaByMe exists to help you find real, active trivia nights. Look for the <span class="badge" style="vertical-align:baseline;">TWC Certified</span> badge - it means that host has been vetted for reliability and quality by the <a href="${TWC_SITE_URL}/">Trivia Writers' Co-Op</a>, the organization dedicated to raising the bar for trivia quality worldwide, not just anyone with a microphone.</p>
</div>
</div>
<p>Run trivia nights yourself? <a href="${TWC_SITE_URL}/input.html">Add your event on TWC</a> to get listed here too.</p>
<div class="footer-links">
<a href="${TWC_SITE_URL}/about-us.html">About TWC</a>
<a href="${TWC_SITE_URL}/business-directory.html">Business Directory</a>
<a href="${TWC_SITE_URL}/endorsements.html">Endorsements</a>
<a href="${TWC_SITE_URL}/input.html">Add Your Event</a>
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
<p style="margin:0.4rem 0 0;">Add it free, no account needed. Want to edit it later? Log in with Discord on TWC and claim your listing.</p>
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
const MAP_HEAD = `
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H" crossorigin="anonymous" />
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" integrity="sha384-pmjIAcz2bAn0xukfxADbZIb3t8oRT9Sv0rvO+BR5Csr6Dhqq+nZs59P0pPKQJkEV" crossorigin="anonymous" />
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css" integrity="sha384-wgw+aLYNQ7dlhK47ZPK7FRACiq7ROZwgFNg0m04avm4CaXS+Z9Y7nMu8yNjBKYC+" crossorigin="anonymous" />
<style>
#map{height:480px;border-radius:12px;box-shadow:0 2px 10px rgba(30,58,95,0.1);margin-bottom:0.75rem;}
.map-legend{display:flex;gap:1.25rem;align-items:center;font-size:0.85rem;color:#555;margin-bottom:2rem;flex-wrap:wrap;}
.map-legend .swatch{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:0.35rem;vertical-align:middle;}
.map-legend .swatch.certified{background:#c5a572;}
.map-legend .swatch.regular{background:#1e3a5f;}
#locateBtn{background:#1e3a5f;color:white;border:none;border-radius:8px;padding:0.5rem 1rem;font-weight:700;font-size:0.85rem;cursor:pointer;margin-bottom:0.75rem;}
#locateBtn:hover{background:#16304d;}
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
  fetch('/events.json').then((r) => r.json()).then((events) => {
    const map = L.map('map', {
      worldCopyJump: true,
      maxBounds: [[-90, -180], [90, 180]],
      maxBoundsViscosity: 1.0,
      minZoom: 2,
    }).setView([39.8283, -98.5795], 4);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      noWrap: true,
      bounds: [[-85, -180], [85, 180]],
      minZoom: 2,
      maxZoom: 18,
    }).addTo(map);

    const cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 70 });
    events.forEach((e) => {
      const marker = L.marker([e.lat, e.lng], {
        icon: L.divIcon({
          className: '',
          html: '<div style="width:16px;height:16px;border-radius:50%;background:' + (e.certified ? '#c5a572' : '#1e3a5f') + ';border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>',
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        }),
      });
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
<button id="locateBtn" type="button">&#128205; Use My Location</button>
<div id="map"></div>
<div class="map-legend"><span><span class="swatch certified"></span>TWC Certified</span><span><span class="swatch regular"></span>Other listed trivia night</span></div>`;
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
<p class="lede">Real, active trivia nights near you, brought to you by the <a href="${TWC_SITE_URL}/">Trivia Writers' Co-Op</a>. TWC Certified hosts - verified members held to real quality standards - are highlighted everywhere you see them.</p>
${mapSection()}
<h2 style="border-bottom:2px solid #c5a572;padding-bottom:0.35rem;">Or browse by country</h2>
${groups}
${hostCta()}
`;
  return pageShell({
    title: 'Find Trivia Nights Near You - TriviaByMe',
    description: 'Browse real, active trivia nights on an interactive map, or by country, state, or province.',
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
  const count = city.events.length;

  // TWC Certified first, always - the badge should mean something here more
  // than anywhere else, since surfacing it is the entire point of TBM.
  const sortedEvents = city.events.slice().sort((a, b) => (b.certified ? 1 : 0) - (a.certified ? 1 : 0));
  const hasCertified = sortedEvents.some((e) => e.certified);
  const certifiedExplainer = hasCertified
    ? `<p class="certified-note"><span class="badge">TWC Certified</span> events are run by verified members of the <a href="${TWC_SITE_URL}/">Trivia Writers' Co-Op</a>, held to real quality and reliability standards - not just anyone with a microphone.</p>`
    : '';

  const eventRows = sortedEvents.map((e) => {
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
  }).join('\n');

  const crumbLabel = regionLabel && regionLabel !== countryLabel ? regionLabel : countryLabel;
  const crumbSlug = regionLabel && regionLabel !== countryLabel ? city.tbmRegionSlug : slugify(countryLabel);

  const body = `
<p class="crumbs"><a href="/">All Countries</a> &rsaquo; <a href="/${slugify(countryLabel)}.html">${escapeHtml(countryLabel)}</a> &rsaquo; <a href="/${crumbSlug}.html">${escapeHtml(crumbLabel)}</a></p>
<h1>Trivia Nights in ${escapeHtml(placeName)}</h1>
<p class="lede">${count === 1 ? "There's one trivia night we know of here." : `There are ${count} trivia nights we know of here.`}</p>
${certifiedExplainer}
${eventRows}
${hostCta()}
`;
  return pageShell({
    title: `Trivia Nights in ${placeName} - TriviaByMe`,
    description: `${count} trivia night${count === 1 ? '' : 's'} in ${placeName}.`,
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
  const [rawEvents, profilesByUserId] = await Promise.all([
    fetchInPersonEvents(),
    fetchBusinessProfilesByUserId(),
  ]);
  const events = attachDirectoryLinks(rawEvents, profilesByUserId);
  console.log(`[generate-tbm-pages] ${events.length} events, ${profilesByUserId.size} business profiles.`);

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
    writeFileEnsured(path.join(PUBLIC_DIR, `${city.tbmSlug}.html`), renderCityPage(city, formatLocationLabel(city.country), city.state ? formatLocationLabel(city.state) : formatLocationLabel(city.country)));
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
