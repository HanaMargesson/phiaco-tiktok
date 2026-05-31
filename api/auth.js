// api/auth.js
// Start the TikTok OAuth flow.
// Redirects creator to TikTok login + consent screen.
//
// Usage:
//   GET /auth?secret=phiaco-secret-2026   -> redirect to TT auth URL

import { kv } from '@vercel/kv';

const TT_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const SCOPES = ['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.list'];

export default async function handler(req, res) {
  const secret = req.query.secret;
  if (secret !== process.env.PHIA_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI;
  if (!clientKey || !redirectUri) {
    return res.status(500).json({ error: 'TT env vars not configured' });
  }

  // CSRF state - store in KV for callback verification (5 min TTL).
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  await kv.set(`tt:state:${state}`, { createdAt: Date.now() }, { ex: 300 });

  const params = new URLSearchParams({
    client_key: clientKey,
    scope: SCOPES.join(','),
    response_type: 'code',
    redirect_uri: redirectUri,
    state
  });

  res.redirect(302, `${TT_AUTH_URL}?${params.toString()}`);
}
