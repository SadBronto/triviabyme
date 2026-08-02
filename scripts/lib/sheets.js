// Minimal Google Sheets client - copied from TWC's netlify/functions/lib/sheets.js.
// TBM has no live functions at all (no login, no dynamic backend - see the
// project README), so this lives under scripts/lib instead of
// netlify/functions/lib; it's only ever used at build time by the page
// generator, reading the same spreadsheet TWC's own site writes to.
const { google } = require('googleapis');

const SPREADSHEET_ID = '1maC3ams54tWLhNoZFLeY1J-kdQDoi3aXbBqwcpx6l2I';

function getSheetsClient(scopes) {
  const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: scopes || ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

module.exports = { SPREADSHEET_ID, getSheetsClient };
