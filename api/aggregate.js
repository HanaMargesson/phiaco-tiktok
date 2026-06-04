// api/aggregate.js
// Read all OAuth-connected TT creators + their stored videos from KV.

import { kv } from '@vercel/kv';

const CACHE_TTL_SECONDS = 60;

function normalizePeriod(raw) {
  if (raw === 'lifetime' || raw === '0') return 'lifetime';
  const n = parseInt(raw, 10);
  if (n === 7 || n === 28 || n === 90) return n;
  return 28;
}
function periodLabel(period) {
  if (period === 'lifetime') return 'lifetime';
  return `last_${period}_days`;
}

export default async function handler(req, res) {
  const secret = req.headers['x-phia-secret'] || req.query.secret;
  if (secret !== process.env.PHIA_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const period = normalizePeriod(req.query.period);
  const cacheKey = `tt:aggregate:cache:${period}`;
  const debug = req.query.debug === '1';

  if (!debug && req.query.bust !== '1') {
    const cached = await kv.get(cacheKey);
    if (cached) {
      return res.json({ ...cached, cached: true, cacheAge: Math.floor((Date.now() - new Date(cached.generatedAt).getTime()) / 1000) });
    }
  }

  try {
    const handles = (await kv.smembers('tt:c:index')) || [];
    const debugInfo = { handles, perHandle: {} };
    const cutoffSeconds = (period === 'lifetime') ? 0 : Math.floor((Date.now() - period * 86400 * 1000) / 1000);
    const perCreator = [];

    for (const handle of handles) {
      const rec = await kv.get(`tt:c:${handle}`);
      if (!rec) continue;
      const videosBundle = await kv.get(`tt:c:videos:${handle}`);
      const videos = videosBundle?.videos || [];

      if (debug) {
        debugInfo.perHandle[handle] = {
          hasRecord: !!rec,
          recKeys: Object.keys(rec || {}),
          hasVideosBundle: !!videosBundle,
          videoCount: videos.length,
          firstVideoSample: videos[0] || null,
          videoFetchedAt: videosBundle?.fetchedAt || null
        };
      }

      const filtered = (period === 'lifetime') ? videos : videos.filter(v => (v.createTime || 0) > cutoffSeconds);
      const periodStats = {
        videos: filtered.length,
        views: filtered.reduce((s, v) => s + (v.views || 0), 0),
        likes: filtered.reduce((s, v) => s + (v.likes || 0), 0),
        comments: filtered.reduce((s, v) => s + (v.comments || 0), 0),
        shares: filtered.reduce((s, v) => s + (v.shares || 0), 0)
      };

      perCreator.push({
        handle: rec.handle,
        nickname: rec.nickname,
        avatarUrl: rec.avatarUrl,
        bio: rec.bio,
        profileUrl: rec.profileUrl,
        verified: rec.verified,
        followerCount: rec.followerCount || 0,
        followingCount: rec.followingCount || 0,
        likesCount: rec.likesCount || 0,
        videoCount: rec.videoCount || 0,
        recentPeriod: periodStats,
        recentVideos: videos.slice(0, 12)
      });
    }

    const totals = {
      followers: perCreator.reduce((s, c) => s + (c.followerCount || 0), 0),
      likesLifetime: perCreator.reduce((s, c) => s + (c.likesCount || 0), 0),
      videosLifetime: perCreator.reduce((s, c) => s + (c.videoCount || 0), 0),
      videosPeriod: perCreator.reduce((s, c) => s + (c.recentPeriod.videos || 0), 0),
      viewsPeriod: perCreator.reduce((s, c) => s + (c.recentPeriod.views || 0), 0),
      likesPeriod: perCreator.reduce((s, c) => s + (c.recentPeriod.likes || 0), 0),
      commentsPeriod: perCreator.reduce((s, c) => s + (c.recentPeriod.comments || 0), 0),
      sharesPeriod: perCreator.reduce((s, c) => s + (c.recentPeriod.shares || 0), 0)
    };

    const result = {
      generatedAt: new Date().toISOString(),
      period: periodLabel(period),
      periodValue: period,
      creatorCount: perCreator.length,
      totals,
      creators: perCreator,
      source: 'oauth',
      cached: false
    };

    if (debug) result._debug = debugInfo;
    else await kv.set(cacheKey, result, { ex: CACHE_TTL_SECONDS });
    res.json(result);
  } catch (err) {
    console.error('aggregate error:', err);
    res.status(500).json({ error: err.message });
  }
}
