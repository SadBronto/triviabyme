// Shared Sheets-reading/event-shaping logic, used by TWC's own location-page
// generator (scripts/generate-location-pages.js) and copied into the
// TriviaByMe (TBM) repo's generator too. Keeping this in one file within TWC
// means both call sites can be kept identical by copying this one file over,
// instead of the two generators quietly drifting apart on what counts as a
// valid event or how a place gets grouped.
//
// This is TBM's copy of that file, kept as close to identical as possible.
// One deliberate difference: the Sheets client require path below points at
// ./sheets (this repo has no netlify/functions dir at all - TBM has no live
// backend, login, or write access of any kind) instead of TWC's
// netlify/functions/lib/sheets. If you change matching/filtering/grouping
// logic here, port it back into TWC's scripts/lib/events-data.js too.

const TWC_SITE_URL = 'https://triviawriterscoop.com';

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics after NFD split
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function titleCase(text) {
  return String(text || '').replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// Short all-caps values (state codes, "USA") are almost certainly
// abbreviations, not words - title-casing "TX" into "Tx" reads as a typo,
// not as tidied-up capitalization. Leave those alone; only tidy up values
// that look like actual multi-letter names.
function formatLocationLabel(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  if (raw.length <= 3 && raw === raw.toUpperCase()) return raw;
  return titleCase(raw);
}

// Builds the public URL to a host's TWC business-directory profile, given
// the slug from the "Business Profiles" sheet tab. Used by both TWC's own
// city pages and TBM's listings - TBM's whole reason to exist is driving
// this exact link in front of as many people as possible.
function businessDirectoryUrl(slug) {
  return slug ? `${TWC_SITE_URL}/business/${encodeURIComponent(slug)}` : null;
}

async function fetchInPersonEvents() {
  // Required at call time (not top of file) so a missing/broken dependency
  // can't crash an npm install step before this function's own try/catch
  // ever gets a chance to run.
  const { SPREADSHEET_ID, getSheetsClient } = require('./sheets');
  const sheets = getSheetsClient(['https://www.googleapis.com/auth/spreadsheets.readonly']);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Form Responses 1!A2:U',
  });
  const rows = response.data.values || [];
  return rows
    .map((row) => ({
      submittedBy: (row[2] || '').trim(), // Discord user ID - joins to Business Profiles' userId column
      hostName: (row[3] || '').trim(),
      companyName: (row[4] || '').trim(),
      venueName: (row[5] || '').trim(),
      day: (row[6] || '').trim(),
      time: (row[7] || '').trim(),
      timezone: (row[8] || '').trim(),
      frequency: (row[9] || '').trim(),
      eventType: (row[11] || 'Trivia').trim(),
      address: (row[12] || '').trim(),
      city: (row[13] || '').trim(),
      state: (row[14] || '').trim(),
      country: (row[16] || 'USA').trim(),
      lat: row[17] ? Number(row[17]) : null,
      lng: row[18] ? Number(row[18]) : null,
      certified: (row[19] || '').toLowerCase() === 'yes',
    }))
    // The sheet mixes event types (trivia, karaoke, bingo, etc.) - the main
    // map page hides non-trivia events by default (index.html's
    // showNonTrivia toggle) and these pages are specifically titled "Trivia
    // Nights", so listing a karaoke night here would be actively wrong, not
    // just imprecise.
    .filter((e) => e.hostName && e.city && e.eventType.toLowerCase() === 'trivia');
}

// Maps a submitter's Discord user ID to their TWC business-directory slug/
// name, so an event can link straight to the host's real profile instead of
// just naming them as plain text. Read-only, same spreadsheet TWC already
// owns - no new credentials needed, just the existing GOOGLE_SHEETS_CREDENTIALS
// with read access to this one additional tab.
async function fetchBusinessProfilesByUserId() {
  const { SPREADSHEET_ID, getSheetsClient } = require('./sheets');
  const sheets = getSheetsClient(['https://www.googleapis.com/auth/spreadsheets.readonly']);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Business Profiles!A2:Z',
  });
  const rows = response.data.values || [];
  const byUserId = new Map();
  rows.forEach((row) => {
    const userId = (row[2] || '').trim();
    const slug = (row[25] || '').trim();
    const businessName = (row[3] || '').trim();
    if (userId && slug) byUserId.set(userId, { slug, businessName, directoryUrl: businessDirectoryUrl(slug) });
  });
  return byUserId;
}

// Attaches a `directoryUrl` (or null) to each event by joining on
// submittedBy - separate from fetchInPersonEvents so callers who don't need
// directory links (or don't want the extra Sheets read) can skip it.
function attachDirectoryLinks(events, profilesByUserId) {
  return events.map((e) => ({
    ...e,
    directoryUrl: e.submittedBy ? (profilesByUserId.get(e.submittedBy)?.directoryUrl ?? null) : null,
  }));
}

// Groups events into cities, then rolls cities up into states/countries.
// A city always gets its own page if it has at least one real event - see
// the file header for why that's the right threshold here. States/countries
// exist purely as browse hubs so the city pages aren't orphaned (a page
// with no internal links pointing to it is hard for a search engine to
// find even when it's listed in the sitemap).
function buildLocationTree(events) {
  const cities = new Map();
  events.forEach((e) => {
    const key = `${e.country}|${e.state}|${e.city}`;
    if (!cities.has(key)) {
      cities.set(key, { country: e.country, state: e.state, city: e.city, events: [] });
    }
    cities.get(key).events.push(e);
  });

  const cityList = Array.from(cities.values()).map((c) => {
    const stateSlug = c.state ? slugify(c.state) : '';
    const countrySlug = slugify(c.country) || 'other';
    const citySlug = slugify(c.city) || 'city';
    const regionSlug = stateSlug || countrySlug;
    return {
      ...c,
      citySlug,
      regionSlug,
      pageSlug: `${citySlug}-${regionSlug}`,
    };
  });

  const regions = new Map(); // regionSlug -> { label, country, state, cities: [] }
  cityList.forEach((c) => {
    if (!regions.has(c.regionSlug)) {
      regions.set(c.regionSlug, {
        slug: c.regionSlug,
        label: c.state ? formatLocationLabel(c.state) : formatLocationLabel(c.country),
        country: c.country,
        cities: [],
      });
    }
    regions.get(c.regionSlug).cities.push(c);
  });

  return { cities: cityList, regions: Array.from(regions.values()) };
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// UTC offset (minutes, ISO sign convention) that `timeZone` observes at the
// given instant - read off the zone's own wall-clock rendering of that
// instant rather than a fixed constant, so DST is handled correctly.
function offsetMinutesAt(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const hour = parts.hour === '24' ? '00' : parts.hour;
  const asIfUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +hour, +parts.minute, +parts.second);
  return Math.round((asIfUTC - instant.getTime()) / 60000);
}

function formatOffset(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

// ISO 8601 startDate for the next upcoming occurrence of a weekly recurring
// event, from the plain-language fields the sign-up form collects (day
// name, "7:00 PM"-style time, IANA timezone). Google's Event rich-result
// eligibility requires startDate - this is the minimum viable version of
// that (one occurrence, not a full recurrence rule).
function nextOccurrenceISO(dayName, timeStr, timezone) {
  const targetDow = WEEKDAY_NAMES.indexOf(dayName);
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(timeStr || '').trim());
  if (targetDow < 0 || !m || !timezone) return undefined;
  let hour = parseInt(m[1], 10) % 12;
  if (/PM/i.test(m[3])) hour += 12;
  const minute = parseInt(m[2], 10);

  let todayParts;
  try {
    todayParts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
    }).formatToParts(new Date()).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  } catch (e) {
    return undefined; // invalid/unrecognized timezone string
  }
  const todayDow = WEEKDAY_SHORT.indexOf(todayParts.weekday);
  if (todayDow < 0) return undefined;
  const daysAhead = (targetDow - todayDow + 7) % 7;

  const targetDate = new Date(Date.UTC(+todayParts.year, +todayParts.month - 1, +todayParts.day + daysAhead, 12, 0, 0));
  const offset = offsetMinutesAt(targetDate, timezone);
  const localAsUTC = Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), hour, minute, 0);
  return new Date(localAsUTC).toISOString().slice(0, 19) + formatOffset(offset);
}

function eventJsonLd(event, city) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: `${event.eventType || 'Trivia'} Night at ${event.venueName || event.companyName || 'TBD'}`,
    startDate: nextOccurrenceISO(event.day, event.time, event.timezone),
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
    location: {
      '@type': 'Place',
      name: event.venueName || undefined,
      address: {
        '@type': 'PostalAddress',
        addressLocality: city.city,
        addressRegion: city.state || undefined,
        addressCountry: city.country,
      },
    },
    organizer: event.companyName ? { '@type': 'Organization', name: event.companyName } : undefined,
    description: `${event.day || ''} ${event.time || ''} ${event.timezone || ''}`.trim() || undefined,
  };
}

module.exports = {
  TWC_SITE_URL,
  slugify,
  escapeHtml,
  titleCase,
  formatLocationLabel,
  businessDirectoryUrl,
  fetchInPersonEvents,
  fetchBusinessProfilesByUserId,
  attachDirectoryLinks,
  buildLocationTree,
  eventJsonLd,
};
