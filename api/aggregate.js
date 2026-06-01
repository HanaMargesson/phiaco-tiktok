// api/aggregate.js
// Bulk fetch of all TT creators (scraped via tikwm.com) â refreshed every 5 min via KV cache.
// Each period (7 / 28 / 90 / lifetime) is cached separately.
//
// Usage:
//   GET /aggregate?secret=...
//   GET /aggregate?secret=...&period=7|28|90|lifetime
//   GET /aggregate?secret=...&bust=1

import { kv } from '@vercel/kv';

const TIKWM_USER_INFO = 'https://tikwm.com/api/user/info';
const TIKWM_USER_POSTS = 'https://tikwm.com/api/user/posts';
const CACHE_TTL_SECONDS = 300; // 5 min
const LIFETIME_VIDEO_CAP = 500;

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

async function fetchProfileFresh(handle) {
  try {
    const r = await fetch(`${TIKWM_USER_INFO}?unique_id=${encodeURIComponent(handle)}`);
    const d = await r.json();
    if (d.code !== 0 || !d.data?.user) return null;
    const u = d.data.user;
    const s = d.data.stats || {};
    return {
      handle: u.uniqueId,
      nickname: u.nickname,
      bio: u.signature,
      avatarUrl: u.avatarMedium || u.avatarLarger || u.avatarThumb,
      verified: !!u.verified,
      profileUrl: `https://www.tiktok.com/@${u.uniqueId}`,
      followerCount: s.followerCount || 0,
      followingCount: s.followingCount || 0,
      likesCount: s.heartCount || s.heart || 0,
      videoCount: s.videoCount || 0
    };
  } catch (e) {
    return null;
  }
}

async function fetchAllVideos(handle, maxItems) {
  const videos = [];
  let cursor = 0;
  let pageCount = 0;
  const MAX_PAGES = Math.ceil(maxItems / 30);

  while (pageCount < MAX_PAGES && videos.length < maxItems) {
    try {
      const url = `${TIKWM_USER_POSTS}?unique_id=${encodeURIComponent(handle)}&count=30&cursor=${cursor}`;
      const r = await fetch(url);
      const d = await r.json();
      if (d.code !== 0) break;
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
        shareUrl: `https://www.tiktok.com/@${handle}/video/${v.video_id}`
      }));
      videos.push(...items);
      if (!d.data?.hasMore) break;
      cursor = d.data?.cursor || 0;
      pageCount++;
    } catch (e) {
      break;
    }
  }

  return videos.slice(0, maxItems);
}

export default async function handler(req, res) {
  const secret = req.headers['x-phia-secret'] || req.query.secret;
  if (secret !== process.env.PHIA_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const period = normalizePeriod(req.query.period);
  const cacheKey = `tt:aggregate:cache:${period}`;

  if (req.query.bust !== '1') {
    const cached = await kv.get(cacheKey);
    if (cached) {
      return res.json({ ...cached, cached: true, cacheAge: Math.floor((Date.now() - new Date(cached.generatedAt).getTime()) / 1000) });
    }
  }

  try {
    const handles = (await kv.smembers('tt:c:index')) || [];
    const records = handles.length ? await kv.mget(...handles.map(h => `tt:c:${h}`)) : [];
    const validCreators = records.filter(Boolean);

    const cutoffSeconds = (period === 'lifetime') ? 0 : Math.floor((Date.now() - period * 86400 * 1000) / 1000);
    const videoLimit = (period === 'lifetime') ? LIFETIME_VIDEO_CAP : (period === 90 ? 60 : 30);

    // Throttle: tikwm rate limits ~1 req/sec. Sequential to be safe.
    const perCreator = [];
    for (const rec of validCreators) {
      const out = {
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
        recentPeriod: { videos: 0, views: 0, likes: 0, comments: 0, shares: 0 },
        recentVideos: [],
        errors: []
      };

      // 1. Refresh profile (latest follower/likes counts)
      const fresh = await fetchProfileFresh(rec.handle);
      if (fresh) {
        out.followerCount = fresh.followerCount;
        out.followingCount = fresh.followingCount;
        out.likesCount = fresh.likesCount;
        out.videoCount = fresh.videoCount;
        out.nickname = fresh.nickname || out.nickname;
        out.avatarUrl = fresh.avatarUrl || out.avatarUrl;
        // Persist back
        await kv.set(`tt:c:${rec.handle}`, {
          ...rec,
          followerCount: out.followerCount,
          followingCount: out.followingCount,
          likesCount: out.likesCount,
          videoCount: out.videoCount,
          nickname: out.nickname,
          avatarUrl: out.avatarUrl,
          lastRefreshedAt: Date.now()
        });
      } else {
        out.errors.push('profile_refresh_failed');
      }

      // 2. Fetch videos with period filter
      const videos = await fetchAllVideos(rec.handle, videoLimit);
      const filtered = (period === 'lifetime')
        ? videos
        : videos.filter(v => (v.createTime || 0) > cutoffSeconds);

      out.recentPeriod.videos = filtered.length;
      filtered.forEach(v => {
        out.recentPeriod.views += (v.views || 0);
        out.recentPeriod.likes += (v.likes || 0);
        out.recentPeriod.comments += (v.comments || 0);
        out.recentPeriod.shares += (v.shares || 0);
      });

      // Top 5 most recent
      out.recentVideos = videos.slice(0, 5);

      perCreator.push(out);
    }

    const totals = {
      followers: 0,
      likesLifetime: 0,
      videosLifetime: 0,
      videosPeriod: 0,
      viewsPeriod: 0,
      likesPeriod: 0,
      commentsPeriod: 0,
      sharesPeriod: 0
    };
    perCreator.forEach(c => {
      totals.followers += c.followerCount || 0;
      totals.likesLifetime += c.likesCount || 0;
      totals.videosLifetime += c.videoCount || 0;
      totals.videosPeriod += c.recentPeriod.videos || 0;
      totals.viewsPeriod += c.recentPeriod.views || 0;
      totals.likesPeriod += c.recentPeriod.likes || 0;
      totals.commentsPeriod += c.recentPeriod.comments || 0;
      totals.sharesPeriod += c.recentPeriod.shares || 0;
    });

    const result = {
      generatedAt: new Date().toISOString(),
      period: periodLabel(period),
      periodValue: period,
      creatorCount: perCreator.length,
      totals,
      creators: perCreator,
      source: 'tikwm',
      cached: false
    };

    await kv.set(cacheKey, result, { ex: CACHE_TTL_SECONDS });
    res.json(result);
  } catch (err) {
    console.error('aggregate error:', err);
    res.status(500).json({ error: err.message });
  }
}
