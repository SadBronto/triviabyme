// Scheduled (see netlify.toml) - periodically kicks off a fresh deploy so
// TBM's pages pick up whatever is currently in the Sheet (both TWC's own
// Form Responses tab and the crawler's TBM tab) without needing a code
// push. Real friction this fixes: TBM is a fully static site with no
// backend of any kind, so pasting a corrected CSV into the TBM tab (or a
// TWC member adding a new event) did nothing on its own - the live site
// only ever changed when someone pushed a commit to this repo, which
// nobody but Claude was doing. Same pattern as TWC's own
// trigger-location-pages-rebuild.js.
//
// Netlify Build Hooks can only be created from the site dashboard (Site
// configuration > Build & deploy > Build hooks) - there's no way to
// provision one from code, so this reads the resulting URL from an env
// var and simply does nothing (loudly logged, not thrown) until that's
// set up on TBM's own Netlify site (a separate site from TWC's, so TWC's
// existing build hook won't do - this needs its own).
exports.handler = async () => {
  const hookUrl = process.env.NETLIFY_BUILD_HOOK_URL;

  if (!hookUrl) {
    console.log('trigger-tbm-rebuild: NETLIFY_BUILD_HOOK_URL not set, skipping.');
    return { statusCode: 200, body: 'Skipped - no build hook configured.' };
  }

  try {
    const response = await fetch(hookUrl, { method: 'POST' });
    console.log('trigger-tbm-rebuild: build hook responded', response.status);
    return { statusCode: 200, body: `Triggered, hook responded ${response.status}` };
  } catch (error) {
    console.error('trigger-tbm-rebuild: failed to call build hook', error);
    return { statusCode: 500, body: error.message };
  }
};
