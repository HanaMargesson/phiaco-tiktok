// api/snapshot.js
// Daily cron — captures point-in-time stats for every OAuth-connected TT creator.
// Calls TT API directly using stored access_tokens (no more tikwm scraping).
// Stored as tt:snapshot:{handle}:{YYYY-MM-DD} for velocity (growth-over-time) charts.

import { kv } from '@vercel/kv';

const USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';
const VIDEO_LIST_URL = 'https://open.tiktokapis.com/v2/video/list/';
const USER_FIELDS = 'open_id,union_id,avatar_url,display_name,follower_count,following_count,likes_count,video_count,bio_description,is_verified';
const VIDEO_FIELDS = 'id,cover_image_url,share_url,video_description,duration,create_time,view_count,like_count,comment_count,share_count';

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function snapshotCreator(handle) {
  const rec = await kv.get(`tt:c:${handle}`);
  if (!rec?.openId) return { handle, status: 'no_record_or_openid' };

  const tokenRec = await kv.get(`tt:creator:${rec.openId}`);
  if (!tokenRec?.accessToken) return { handle, status: 'no_token' };
  const access_token = tokenRec.accessToken;

  // Fetch fresh profile
  let userData = {};
  try {
    const r = await fetch(`${USER_INFO_URL}?fields=${USER_FIELDS}`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const d = await r.json();
    if (d.error?.code && d.error.code !== 'ok') {
      return { handle, status: 'user_info_failed', error: d.error.message || d.error.code };
    }
    userData = d?.data?.user || {};
  } catch (e) {
    return { handle, status: 'user_info_error', error: e.message };
  }

  // Fetch videos
  let videos = [];
  try {
    const r = await fetch(`${VIDEO_LIST_URL}?fields=${VIDEO_FIELDS}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ max_count: 20 })
    });
    const d = await r.json();
    videos = (d?.data?.videos || []).map(v => ({
      videoId: v.id,
      title: v.video_description,
      cover: v.cover_image_url,
      duration: v.duration,
      createTime: v.create_time,
      views: v.view_count || 0,
      likes: v.like_count || 0,
      comments: v.comment_count || 0,
      shares: v.share_count || 0,
      shareUrl: v.share_url
    }));
  } catch (e) {
    // Non-fatal — snapshot what we have
  }

  const cutoff28d = Math.floor((Date.now() - 28 * 86400 * 1000) / 1000);
  const recent28d = videos.filter(v => v.createTime > cutoff28d);
  const sum = (arr, k) => arr.reduce((a, v) => a + (v[k] || 0), 0);

  const snapshot = {
    handle,
    capturedAt: Date.now(),
    capturedDate: today(),
    followerCount: userData.follower_count || 0,
    followingCount: userData.following_count || 0,
    likesCount: userData.likes_count || 0,
    videoCount: userData.video_count || 0,
    verified: !!userData.is_verified,
    last28d: {
      videos: recent28d.length,
      views: sum(recent28d, 'views'),
      likes: sum(recent28d, 'likes'),
      comments: sum(recent28d, 'comments'),
      shares: sum(recent28d, 'shares')
    },
    recentVideoStats: videos.slice(0, 30)
  };

  // Store snapshot (60-day TTL)
  await kv.set(`tt:snapshot:${handle}:${today()}`, snapshot, { ex: 60 * 86400 });
  await kv.set(`tt:snapshot:${handle}:latest`, snapshot);
  await kv.sadd(`tt:snapshot:${handle}:dates`, today());

  // Also refresh the canonical creator record with latest stats
  await kv.set(`tt:c:${handle}`, {
    ...rec,
    followerCount: snapshot.followerCount,
    followingCount: snapshot.followingCount,
    likesCount: snapshot.likesCount,
    videoCount: snapshot.videoCount,
    lastRefreshedAt: Date.now()
  });
  if (videos.length > 0) {
    await kv.set(`tt:c:videos:${handle}`, { videos, fetchedAt: Date.now() });
  }

  return {
    handle,
    status: 'captured',
    followers: snapshot.followerCount,
    videoCount: snapshot.videoCount,
    last28dVideos: snapshot.last28d.videos
  };
}

export default async function handler(req, res) {
  const isCron = req.headers['user-agent']?.includes('vercel-cron');
  if (!isCron && req.query.secret !== process.env.PHIA_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const handles = (await kv.smembers('tt:c:index')) || [];
    if (!handles.length) {
      return res.json({ ok: true, capturedAt: new Date().toISOString(), total: 0, results: [] });
    }

    const results = [];
    for (const h of handles) {
      try {
        results.push(await snapshotCreator(h));
      } catch (e) {
        results.push({ handle: h, status: 'error', error: e.message });
      }
    }

    return res.json({
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
    console.error('snapshot error:', err);
    return res.status(500).json({ error: err.message });
  }
}
