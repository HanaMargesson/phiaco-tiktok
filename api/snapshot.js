// api/snapshot.js
// Daily cron — captures point-in-time stats for every connected TT creator.
// Stored as tt:snapshot:{handle}:{YYYY-MM-DD} for velocity (growth-over-time) charts.
//
// Triggered:
//   - Vercel cron daily at 9 AM UTC (vercel.json)
//   - Manually: GET /snapshot?secret=...

import { kv } from '@vercel/kv';

const TIKWM_USER_INFO = 'https://tikwm.com/api/user/info';
const TIKWM_USER_POSTS = 'https://tikwm.com/api/user/posts';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://tikwm.com',
  'Referer': 'https://tikwm.com/'
};

export const config = { runtime: 'edge' };

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function tikwmPost(url, params) {
  const body = new URLSearchParams(params).toString();
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const text = await r.text();
    try {
      return JSON.parse(text);
    } catch {
      return { error: 'non_json', status: r.status };
    }
  } catch (e) {
    return { error: e.message };
  }
}

async function snapshotCreator(handle) {
  // Fetch profile
  const infoD = await tikwmPost(TIKWM_USER_INFO, { unique_id: handle });
  if (infoD.code !== 0 || !infoD.data?.user) {
    return { handle, status: 'profile_failed', error: infoD.error || infoD.msg };
  }
  const u = infoD.data.user;
  const s = infoD.data.stats || {};

  // Fetch recent videos (30 most recent)
  const postsD = await tikwmPost(TIKWM_USER_POSTS, { unique_id: handle, count: 30, cursor: 0 });
  const videos = (postsD.data?.videos || []).map(v => ({
    videoId: v.video_id,
    createTime: v.create_time,
    views: v.play_count || 0,
    likes: v.digg_count || 0,
    comments: v.comment_count || 0,
    shares: v.share_count || 0
  }));

  const recent28dCutoff = Math.floor((Date.now() - 28 * 86400 * 1000) / 1000);
  const recent28d = videos.filter(v => v.createTime > recent28dCutoff);
  const sum = (arr, k) => arr.reduce((a, v) => a + (v[k] || 0), 0);

  const snapshot = {
    handle: u.uniqueId,
    capturedAt: Date.now(),
    capturedDate: today(),
    // Lifetime counters
    followerCount: s.followerCount || 0,
    followingCount: s.followingCount || 0,
    likesCount: s.heartCount || s.heart || 0,
    videoCount: s.videoCount || 0,
    verified: !!u.verified,
    // 28-day window
    last28d: {
      videos: recent28d.length,
      views: sum(recent28d, 'views'),
      likes: sum(recent28d, 'likes'),
      comments: sum(recent28d, 'comments'),
      shares: sum(recent28d, 'shares')
    },
    // All recent (up to 30) for per-video tracking
    recentVideoStats: videos.slice(0, 30)
  };

  // Store snapshot keyed by date
  await kv.set(`tt:snapshot:${u.uniqueId}:${today()}`, snapshot, { ex: 60 * 86400 }); // 60-day TTL
  // Also keep latest pointer
  await kv.set(`tt:snapshot:${u.uniqueId}:latest`, snapshot);
  // Add date to creator's snapshot history index
  await kv.sadd(`tt:snapshot:${u.uniqueId}:dates`, today());

  return { handle: u.uniqueId, status: 'captured', followers: snapshot.followerCount, videos: snapshot.videoCount };
}

export default async function handler(req) {
  const url = new URL(req.url);
  const params = url.searchParams;

  // Allow Vercel cron OR manual secret
  const isCron = req.headers.get('user-agent')?.includes('vercel-cron');
  if (!isCron && params.get('secret') !== process.env.PHIA_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const handles = (await kv.smembers('tt:c:index')) || [];
    if (!handles.length) {
      return json({ ok: true, capturedAt: new Date().toISOString(), total: 0, results: [] });
    }

    // Sequential to respect tikwm rate limits (~1 req/sec)
    const results = [];
    for (const h of handles) {
      try {
        results.push(await snapshotCreator(h));
      } catch (e) {
        results.push({ handle: h, status: 'error', error: e.message });
      }
    }

    return json({
      ok: true,
      capturedAt: new Date().toISOString(),
      date: today(),
      total: results.length,
      summary: results.reduce((acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      }, {}),
      results
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
