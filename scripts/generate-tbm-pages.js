// Build-time static site generator for TriviaByMe (TBM). Runs as the Netlify
// build command - reads the same Google Sheet triviawriterscoop.com (TWC)
// already owns and writes to, and produces plain static HTML. No login, no
// write access, no live backend of any kind: TBM never lets anyone add or
// edit an event directly. Hosts add/edit their events on TWC; the next TBM
// build picks up whatever's in the sheet at that point.
//
// TBM's entire purpose is driving awareness of TWC (see the project's
// README), so every page here: sorts TWC Certified events first, links each
// host straight to their real TWC business-directory profile when one
// exists, and carries a persistent "part of the Trivia Writers' Co-Op
// network" mark - not a footer afterthought, an actual brand element.
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
// (a real logo, etc.) to static/ and it'll show up the same way.
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

function pageShell({ title, description, canonicalPath, bodyHtml }) {
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
<style>
*{box-sizing:border-box;}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#faf7ff;color:#241b3a;margin:0;display:flex;flex-direction:column;min-height:100vh;}
a{color:inherit;}
.container{max-width:820px;margin:0 auto;padding:0 1.5rem;flex:1;width:100%;}
header.site-header{background:#3d1f75;color:white;padding:1rem 0;}
header.site-header .container{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.75rem;}
.logo{font-size:1.4rem;font-weight:800;text-decoration:none;color:white;letter-spacing:-0.02em;}
.logo span{color:#ff7a59;}
nav.site-nav a{color:white;text-decoration:none;font-size:0.9rem;font-weight:600;margin-left:1.25rem;opacity:0.9;}
nav.site-nav a:hover{opacity:1;text-decoration:underline;}
.twc-banner{background:#ff7a59;color:#241b3a;font-size:0.85rem;font-weight:600;text-align:center;padding:0.55rem 1rem;}
.twc-banner a{color:#241b3a;text-decoration:underline;}
main{padding:2rem 0 3rem;}
h1{font-size:2rem;margin:0 0 0.5rem;}
h2{font-size:1.25rem;}
p.lede{color:#5a4d78;font-size:1.05rem;}
.crumbs{font-size:0.85rem;color:#7a6d99;margin-bottom:1rem;}
.crumbs a{text-decoration:none;color:#5a3fb8;font-weight:600;}
.crumbs a:hover{text-decoration:underline;}
.card{background:white;border-radius:12px;padding:1.5rem;box-shadow:0 2px 10px rgba(61,31,117,0.08);}
.country-group{margin-bottom:1.75rem;}
.country-group h2{border-bottom:2px solid #ff7a59;padding-bottom:0.35rem;margin-bottom:0.75rem;}
.count{color:#8a7dab;font-size:0.85rem;font-weight:400;}
ul.link-grid{list-style:none;padding:0;margin:0;columns:2;gap:1rem;}
ul.link-grid li{background:white;border-radius:10px;padding:0.8rem 1.1rem;margin-bottom:0.6rem;box-shadow:0 2px 8px rgba(61,31,117,0.07);break-inside:avoid;}
ul.link-grid li a{font-weight:700;text-decoration:none;color:#3d1f75;}
ul.link-grid li a:hover{text-decoration:underline;}
.event-card{background:white;border-radius:12px;padding:1.25rem 1.5rem;margin-bottom:1rem;box-shadow:0 2px 10px rgba(61,31,117,0.08);}
.event-card h3{margin:0 0 0.4rem;color:#3d1f75;}
.event-meta,.event-host,.event-address{margin:0.2rem 0;color:#5a4d78;font-size:0.92rem;}
.badge{display:inline-block;background:#ff7a59;color:#241b3a;font-size:0.7rem;font-weight:800;padding:0.15rem 0.55rem;border-radius:4px;vertical-align:middle;}
.certified-note{font-size:0.85rem;color:#5a4d78;margin:0 0 1.25rem;padding:0.7rem 1rem;background:rgba(255,122,89,0.12);border-left:3px solid #ff7a59;border-radius:6px;}
.certified-note a{color:#3d1f75;font-weight:700;}
.directory-link{display:inline-block;margin-top:0.3rem;font-size:0.85rem;font-weight:700;color:#5a3fb8;text-decoration:none;}
.directory-link:hover{text-decoration:underline;}
.host-cta{margin-top:2.5rem;padding:1.5rem;background:#3d1f75;color:white;border-radius:12px;text-align:center;}
.host-cta a{display:inline-block;margin-top:0.75rem;background:#ff7a59;color:#241b3a;font-weight:800;text-decoration:none;padding:0.65rem 1.5rem;border-radius:8px;}
footer.site-footer{background:#241b3a;color:#cabfe6;padding:2rem 0;margin-top:auto;font-size:0.85rem;}
footer.site-footer a{color:white;font-weight:700;text-decoration:none;}
footer.site-footer a:hover{text-decoration:underline;}
</style>
</head>
<body>
<div class="twc-banner">TriviaByMe is part of the <a href="${TWC_SITE_URL}/">Trivia Writers' Co-Op</a> network - the people behind trivia quality worldwide.</div>
<header class="site-header">
<div class="container">
<a class="logo" href="/">Trivia<span>ByMe</span></a>
<nav class="site-nav"><a href="/">Find Trivia</a><a href="${TWC_SITE_URL}/business-directory.html">Business Directory</a></nav>
</div>
</header>
<main class="container">
${bodyHtml}
</main>
<footer class="site-footer">
<div class="container">
<p>TriviaByMe helps you find real, active trivia nights near you. Every listing here is run by a member or venue in good standing with the <a href="${TWC_SITE_URL}/">Trivia Writers' Co-Op</a> - the organization dedicated to raising the bar for trivia quality worldwide.</p>
<p>Run trivia nights yourself? <a href="${TWC_SITE_URL}/input.html">Add your event on TWC</a> to get listed here too.</p>
</div>
</footer>
</body>
</html>
`;
}

function hostCta() {
  return `<div class="host-cta">
<strong>Host a trivia night?</strong>
<p style="margin:0.4rem 0 0;">Get listed here and show off your Trivia Writers' Co-Op credibility.</p>
<a href="${TWC_SITE_URL}/input.html">Add your event on TWC &rarr;</a>
</div>`;
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
<p class="lede">Browse real, active trivia nights by country, then state or province. Certified hosts - verified members of the Trivia Writers' Co-Op - are highlighted everywhere you see them.</p>
${groups}
${hostCta()}
`;
  return pageShell({
    title: 'Find Trivia Nights Near You - TriviaByMe',
    description: 'Browse real, active trivia nights by country, state, or province.',
    canonicalPath: '/',
    bodyHtml: body,
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

module.exports = { buildTbmTree, renderTopIndex, renderCountryPage, renderRegionPage, renderCityPage };
