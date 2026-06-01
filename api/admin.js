// api/admin.js
// Manage TT creator list (scraped via tikwm.com, no OAuth required).
//
// Usage:
//   GET /admin?secret=...&action=list
//   GET /admin?secret=...&action=add&handle=stylewithchails
//   GET /admin?secret=...&action=remove&handle=stylewithchails
//   GET /admin?secret=...&action=refresh&handle=stylewithchails

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

function cleanHandle(raw) {
  if (!raw) return null;
  return String(raw).trim().replace(/^@+/, '').toLowerCase();
}

async function tikwmPost(url, params) {
  const body = new URLSearchParams(params).toString();
  const r = await fetch(url, {
    method: 'POST',
    headers: { ...BROWSER_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`tikwm returned non-JSON (status ${r.status}): ${text.slice(0, 200)}`);
  }
}

async function fetchProfile(handle) {
  const d = await tikwmPost(TIKWM_USER_INFO, { unique_id: handle });
  if (d.code !== 0 || !d.data?.user) {
    throw new Error(`tikwm user/info failed: ${d.msg || JSON.stringify(d).slice(0, 200)}`);
  }
  const u = d.data.user;
  const s = d.data.stats || {};
  return {
    handle: u.uniqueId,
    nickname: u.nickname,
    bio: u.signature,
    avatarUrl: u.avatarMedium || u.avatarLarger || u.avatarThumb,
    verified: !!u.verified,
    isUnderAge18: !!u.isUnderAge18,
    privateAccount: !!u.privateAccount,
    secUid: u.secUid,
    userId: u.id,
    createTime: u.createTime,
    profileUrl: `https://www.tiktok.com/@${u.uniqueId}`,
    followerCount: s.followerCount || 0,
    followingCount: s.followingCount || 0,
    likesCount: s.heartCount || s.heart || 0,
    videoCount: s.videoCount || 0
  };
}

async function fetchVideos(handle, count = 30, cursor = 0) {
  const d = await tikwmPost(TIKWM_USER_POSTS, { unique_id: handle, count, cursor });
  if (d.code !== 0) return { videos: [], hasMore: false, cursor: 0 };
  const items = (d.data?.videos || []).map(v => ({
    videoId: v.video_id,
    title: v.title,
    cover: v.cover || v.origin_cover,
    duration: v.duration,
    createTime: v.create_time,
    views: v.play_count || 0,
    likes: v.digg_count || 0,
    comments: v.comment_count || 0,
    shares: v.share_count || 0,
    collects: v.collect_count || 0,
    downloads: v.download_count || 0,
    shareUrl: `https://www.tiktok.com/@${handle}/video/${v.video_id}`
  }));
  return {
    videos: items,
    hasMore: !!d.data?.hasMore,
    cursor: d.data?.cursor || 0
  };
}

async function addOrRefresh(handle) {
  const profile = await fetchProfile(handle);
  const { videos } = await fetchVideos(profile.handle, 30, 0);
  const now = Date.now();
  const record = {
    ...profile,
    recentVideosCount: videos.length,
    addedAt: now,
    lastRefreshedAt: now,
    source: 'tikwm'
  };
  await kv.set(`tt:c:${profile.handle}`, record);
  await kv.set(`tt:c:videos:${profile.handle}`, { videos, fetchedAt: now }, { ex: 3600 });
  await kv.sadd('tt:c:index', profile.handle);
  return { creator: record, videoSample: videos.slice(0, 3) };
}

export default async function handler(req, res) {
  if (req.query.secret !== process.env.PHIA_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const action = (req.query.action || 'list').toLowerCase();
  const handle = cleanHandle(req.query.handle);

  try {
    if (action === 'list') {
      const handles = (await kv.smembers('tt:c:index')) || [];
      if (!handles.length) return res.json({ count: 0, creators: [] });
      const recs = await kv.mget(...handles.map(h => `tt:c:${h}`));
      const creators = recs.filter(Boolean).map(r => ({
        handle: r.handle,
        nickname: r.nickname,
        verified: r.verified,
        followers: r.followerCount,
        videos: r.videoCount,
        likes: r.likesCount,
        addedAt: r.addedAt,
        lastRefreshedAt: r.lastRefreshedAt
      }));
      return res.json({ count: creators.length, creators });
    }

    if (action === 'add' || action === 'refresh') {
      if (!handle) return res.status(400).json({ error: 'Missing ?handle=...' });
      const result = await addOrRefresh(handle);
      return res.json({ ok: true, action, ...result });
    }

    if (action === 'remove') {
      if (!handle) return res.status(400).json({ error: 'Missing ?handle=...' });
      await kv.srem('tt:c:index', handle);
      await kv.del(`tt:c:${handle}`);
      await kv.del(`tt:c:videos:${handle}`);
      for (const p of [7, 28, 90, 'lifetime']) await kv.del(`tt:aggregate:cache:${p}`);
      return res.json({ ok: true, action, handle });
    }

    return res.status(400).json({ error: 'Unknown action. Use list | add | remove | refresh' });
  } catch (err) {
    console.error('admin error:', err);
    res.status(500).json({ error: err.message });
  }
}
