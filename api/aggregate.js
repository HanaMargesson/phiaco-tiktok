// api/aggregate.js
// Bulk fetch of all connected TT creators' stats â refreshed every 5 min via KV cache.
// Each period (7 / 28 / 90 / lifetime) is cached separately.
//
// Usage:
//   GET /aggregate?secret=...
//   GET /aggregate?secret=...&period=7|28|90|lifetime
//   GET /aggregate?secret=...&bust=1

import { kv } from '@vercel/kv';

const USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';
const VIDEO_LIST_URL = 'https://open.tiktokapis.com/v2/video/list/';
const USER_FIELDS = 'open_id,union_id,avatar_url,avatar_url_100,display_name,bio_description,profile_deep_link,is_verified,follower_count,following_count,likes_count,video_count,username';
const VIDEO_FIELDS = 'id,create_time,cover_image_url,share_url,video_description,duration,view_count,like_count,comment_count,share_count';
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

async function fetchUserInfo(rec) {
  try {
    const r = await fetch(`${USER_INFO_URL}?fields=${USER_FIELDS}`, {
      headers: { Authorization: `Bearer ${rec.accessToken}` }
    });
    const d = await r.json();
    return d?.data?.user || null;
  } catch (e) {
    return null;
  }
}

async function fetchAllVideos(rec, maxItems) {
  const videos = [];
  let cursor = null;
  let pageCount = 0;
  const MAX_PAGES = Math.ceil(maxItems / 20);

  while (pageCount < MAX_PAGES && videos.length < maxItems) {
    try {
      const body = { max_count: 20 };
      if (cursor) body.cursor = cursor;
      const r = await fetch(`${VIDEO_LIST_URL}?fields=${VIDEO_FIELDS}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${rec.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      const d = await r.json();
      if (d.error?.code && d.error.code !== 'ok') break;
      const items = d?.data?.videos || [];
      videos.push(...items);
      if (!d?.data?.has_more) break;
      cursor = d.data.cursor;
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
    const openIds = (await kv.smembers('tt:index')) || [];
    const records = openIds.length ? await kv.mget(...openIds.map(id => `tt:creator:${id}`)) : [];
    const validCreators = records.filter(Boolean);

    const cutoffSeconds = (period === 'lifetime') ? 0 : Math.floor((Date.now() - period * 86400 * 1000) / 1000);
    const videoLimit = (period === 'lifetime') ? LIFETIME_VIDEO_CAP : (period === 90 ? 60 : 30);

    const perCreator = await Promise.all(validCreators.map(async (rec) => {
      const out = {
        openId: rec.openId,
        username: rec.username,
        displayName: rec.displayName,
        avatarUrl: rec.avatarUrl100 || rec.avatarUrl,
        profileDeepLink: rec.profileDeepLink,
        isVerified: rec.isVerified,
        followerCount: rec.followerCount || 0,
        followingCount: rec.followingCount || 0,
        likesCount: rec.likesCount || 0,
        videoCount: rec.videoCount || 0,
        recentPeriod: { videos: 0, views: 0, likes: 0, comments: 0, shares: 0 },
        recentVideos: [],
        errors: []
      };

      // 1. Refresh user info
      const fresh = await fetchUserInfo(rec);
      if (fresh) {
        out.followerCount = fresh.follower_count ?? out.followerCount;
        out.followingCount = fresh.following_count ?? out.followingCount;
        out.likesCount = fresh.likes_count ?? out.likesCount;
        out.videoCount = fresh.video_count ?? out.videoCount;
        out.displayName = fresh.display_name || out.displayName;
        out.avatarUrl = fresh.avatar_url_100 || fresh.avatar_url || out.avatarUrl;
        out.isVerified = fresh.is_verified ?? out.isVerified;
        // Persist back to KV
        await kv.set(`tt:creator:${rec.openId}`, {
          ...rec,
          followerCount: out.followerCount,
          followingCount: out.followingCount,
          likesCount: out.likesCount,
          videoCount: out.videoCount,
          displayName: out.displayName,
          avatarUrl: fresh.avatar_url || rec.avatarUrl,
          avatarUrl100: fresh.avatar_url_100 || rec.avatarUrl100,
          isVerified: out.isVerified,
          lastRefreshedAt: Date.now()
        });
      } else {
        out.errors.push('user_info_failed');
      }

      // 2. Fetch videos with period filter
      const videos = await fetchAllVideos(rec, videoLimit);
      const filtered = (period === 'lifetime')
        ? videos
        : videos.filter(v => (v.create_time || 0) > cutoffSeconds);

      out.recentPeriod.videos = filtered.length;
      filtered.forEach(v => {
        out.recentPeriod.views += (v.view_count || 0);
        out.recentPeriod.likes += (v.like_count || 0);
        out.recentPeriod.comments += (v.comment_count || 0);
        out.recentPeriod.shares += (v.share_count || 0);
      });

      // Top 5 most recent for preview
      out.recentVideos = videos.slice(0, 5).map(v => ({
        id: v.id,
        videoDescription: v.video_description,
        createTime: v.create_time,
        coverImageUrl: v.cover_image_url,
        shareUrl: v.share_url,
        duration: v.duration,
        views: v.view_count || 0,
        likes: v.like_count || 0,
        comments: v.comment_count || 0,
        shares: v.share_count || 0
      }));

      return out;
    }));

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
      cached: false
    };

    await kv.set(cacheKey, result, { ex: CACHE_TTL_SECONDS });
    res.json(result);
  } catch (err) {
    console.error('aggregate error:', err);
    res.status(500).json({ error: err.message });
  }
}
