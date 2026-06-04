// api/refresh.js
// Refresh TikTok access tokens for all connected creators.
// Triggered:
//   - Vercel cron every 6h
//   - Manually: GET /refresh?secret=...
//
// TT access tokens expire in 24h, refresh tokens in 365d.
// We refresh proactively when access expires in < 2h.

import { kv } from '@vercel/kv';

const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const REFRESH_THRESHOLD_MS = 26 * 60 * 60 * 1000; // 26h (daily cron, refresh all tokens proactively)

export default async function handler(req, res) {
  // Allow either Vercel cron header or manual ?secret=...
  const isCron = req.headers['user-agent']?.includes('vercel-cron') || req.headers['x-vercel-cron'];
  if (!isCron && req.query.secret !== process.env.PHIA_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const openIds = (await kv.smembers('tt:index')) || [];
    const records = openIds.length ? await kv.mget(...openIds.map(id => `tt:creator:${id}`)) : [];
    const now = Date.now();
    const results = [];

    for (const rec of records) {
      if (!rec) continue;
      const timeUntilExpiry = (rec.accessExpiresAt || 0) - now;
      // Skip if still valid for > threshold (unless forced via ?force=1)
      if (req.query.force !== '1' && timeUntilExpiry > REFRESH_THRESHOLD_MS) {
        results.push({ openId: rec.openId, username: rec.username, status: 'skipped', validForMs: timeUntilExpiry });
        continue;
      }
      // Check if refresh token is still valid
      if ((rec.refreshExpiresAt || 0) < now) {
        results.push({ openId: rec.openId, username: rec.username, status: 'refresh_expired' });
        continue;
      }

      try {
        const r = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_key: process.env.TIKTOK_CLIENT_KEY,
            client_secret: process.env.TIKTOK_CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: rec.refreshToken
          })
        });
        const d = await r.json();
        if (d.error || !d.access_token) {
          results.push({ openId: rec.openId, username: rec.username, status: 'failed', error: d.error_description || d.error });
          continue;
        }
        const updated = {
          ...rec,
          accessToken: d.access_token,
          refreshToken: d.refresh_token || rec.refreshToken,
          accessExpiresAt: now + (d.expires_in * 1000),
          refreshExpiresAt: now + ((d.refresh_expires_in || 31536000) * 1000),
          lastRefreshedAt: now
        };
        await kv.set(`tt:creator:${rec.openId}`, updated);
        results.push({ openId: rec.openId, username: rec.username, status: 'refreshed' });
      } catch (e) {
        results.push({ openId: rec.openId, username: rec.username, status: 'error', error: e.message });
      }
    }

    res.json({
      refreshedAt: new Date().toISOString(),
      total: results.length,
      summary: results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {}),
      results
    });
  } catch (err) {
    console.error('refresh error:', err);
    res.status(500).json({ error: err.message });
  }
}
