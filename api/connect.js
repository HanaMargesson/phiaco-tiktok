// api/connect.js
// Public landing page for creators to authorize phia on TikTok.
//
//   GET /connect        -> render Phia-branded landing page with "Connect TikTok" button
//   GET /connect?go=1   -> create CSRF state, redirect to TT OAuth URL
//
// No secret required — the secret gate stays on /auth for programmatic use.

import { kv } from '@vercel/kv';

const TT_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const SCOPES = ['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.list'];

export default async function handler(req, res) {
  // OAuth initiation path
  if (req.query.go === '1') {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const redirectUri = process.env.TIKTOK_REDIRECT_URI;
    if (!clientKey || !redirectUri) {
      return res.status(500).send('TT env vars not configured');
    }
    const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
    await kv.set(`tt:state:${state}`, { createdAt: Date.now() }, { ex: 300 });
    const params = new URLSearchParams({
      client_key: clientKey,
      scope: SCOPES.join(','),
      response_type: 'code',
      redirect_uri: redirectUri,
      state
    });
    return res.redirect(302, `${TT_AUTH_URL}?${params.toString()}`);
  }

  // Landing page
  res.setHeader('Content-Type', 'text/html');
  res.send(LANDING_PAGE);
}

const LANDING_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>phia — connect your TikTok</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Roboto+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {
  --foreground-primary: #000000;
  --foreground-secondary: #525252;
  --foreground-tertiary: #666666;
  --foreground-inverse: #FFFFFF;
  --background-primary: #FFFFFF;
  --background-secondary: #F7F7F5;
  --background-tertiary: #EFEFEF;
  --phia-blue: #0843CB;
  --phia-blue-100: #EEF4FE;
  --border-primary: #E5E5E5;
  --font-sans: -apple-system, BlinkMacSystemFont, "Inter", "Helvetica Neue", Arial, sans-serif;
  --font-serif: "DM Serif Display", "GT Super Display", "Times New Roman", Times, serif;
  --font-mono: "Roboto Mono", "SF Mono", Menlo, monospace;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: var(--font-sans);
  color: var(--foreground-primary);
  background: var(--background-tertiary);
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.card {
  background: var(--background-primary);
  max-width: 480px;
  width: 100%;
  border-radius: 4px;
  padding: 48px 40px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.04);
}
.logo {
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 40px;
  color: var(--phia-blue);
  letter-spacing: -1px;
  line-height: 1;
  margin-bottom: 8px;
}
.eyebrow {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--foreground-tertiary);
  margin-bottom: 24px;
}
h1 {
  font-family: var(--font-serif);
  font-size: 36px;
  font-weight: 400;
  line-height: 1.1;
  letter-spacing: -0.5px;
  margin-bottom: 16px;
}
p.lede {
  font-size: 15px;
  line-height: 1.55;
  color: var(--foreground-secondary);
  margin-bottom: 32px;
}
.scopes {
  background: var(--background-secondary);
  border-left: 2px solid var(--phia-blue);
  padding: 20px 22px;
  margin-bottom: 32px;
  border-radius: 0 2px 2px 0;
}
.scopes-head {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--foreground-tertiary);
  margin-bottom: 12px;
}
.scope-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 8px;
  font-size: 13px;
  line-height: 1.4;
  color: var(--foreground-secondary);
}
.scope-row:last-child { margin-bottom: 0; }
.scope-icon {
  color: var(--phia-blue);
  font-size: 14px;
  line-height: 1.4;
  flex-shrink: 0;
}
.cta {
  display: block;
  width: 100%;
  padding: 16px 24px;
  background: var(--foreground-primary);
  color: var(--foreground-inverse);
  text-align: center;
  text-decoration: none;
  font-family: var(--font-sans);
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0.02em;
  border: none;
  border-radius: 2px;
  cursor: pointer;
  transition: background 0.15s;
}
.cta:hover { background: var(--phia-blue); }
.cta-icon {
  display: inline-block;
  margin-right: 8px;
  vertical-align: middle;
}
.footnote {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--foreground-tertiary);
  text-align: center;
  margin-top: 20px;
  line-height: 1.5;
}
.footnote a {
  color: var(--foreground-tertiary);
  text-decoration: underline;
}
@media (max-width: 540px) {
  .card { padding: 36px 28px; }
  h1 { font-size: 28px; }
  .logo { font-size: 32px; }
}
</style>
</head>
<body>
  <div class="card">
    <div class="logo">phia</div>
    <div class="eyebrow">creator integration</div>

    <h1>Connect your TikTok to phia.</h1>

    <p class="lede">
      You're part of phia's creator partnership program. Authorizing this integration lets us pull your public TikTok stats into our private analytics dashboard so we can track how our collabs perform.
    </p>

    <div class="scopes">
      <div class="scopes-head">what we access</div>
      <div class="scope-row"><span class="scope-icon">→</span><span><strong>Profile:</strong> display name, avatar, bio, verified status</span></div>
      <div class="scope-row"><span class="scope-icon">→</span><span><strong>Stats:</strong> follower count, video count, total likes</span></div>
      <div class="scope-row"><span class="scope-icon">→</span><span><strong>Videos:</strong> public video list + view / like / comment / share counts</span></div>
    </div>

    <p class="lede" style="font-size:13px;margin-bottom:24px;color:var(--foreground-tertiary)">
      We never post on your behalf, never message anyone, never access DMs or drafts. You can revoke access anytime in your TikTok settings.
    </p>

    <a class="cta" href="/connect?go=1">
      <span class="cta-icon">↗</span> Connect TikTok
    </a>

    <div class="footnote">
      Powered by phia &middot; <a href="https://phia.com/privacy" target="_blank" rel="noreferrer">Privacy</a>
    </div>
  </div>
</body>
</html>`;
