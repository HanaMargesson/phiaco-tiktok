// api/callback.js
// OAuth callback - exchange the authorization code for access + refresh tokens,
// then fetch + store the creator's basic profile.
//
// TikTok returns: access_token (24h), refresh_token (365d), open_id, scope.
// We persist everything keyed by open_id and indexed by username.

import { kv } from '@vercel/kv';

const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';
const USER_FIELDS = 'open_id,union_id,avatar_url,avatar_url_100,display_name,bio_description,profile_deep_link,is_verified,follower_count,following_count,likes_count,video_count,username';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const { code, state, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(renderError(`TikTok error: ${error} - ${error_description || ''}`));
  }
  if (!code || !state) {
    return res.status(400).send(renderError('Missing code or state in callback.'));
  }

  // CSRF check
  const stored = await kv.get(`tt:state:${state}`);
  if (!stored) {
    return res.status(400).send(renderError('Invalid or expired state. Try connecting again.'));
  }
  await kv.del(`tt:state:${state}`);

  try {
    // 1. Exchange code for tokens
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY,
        client_secret: process.env.TIKTOK_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: process.env.TIKTOK_REDIRECT_URI
      })
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error || !tokenData.access_token) {
      return res.status(400).send(renderError(`Token exchange failed: ${tokenData.error_description || tokenData.error || 'unknown'}`));
    }

    const {
      access_token,
      expires_in,        // seconds, ~86400 (24h)
      refresh_token,
      refresh_expires_in, // seconds, ~31536000 (365d)
      open_id,
      scope
    } = tokenData;

    const now = Date.now();
    const accessExpiresAt = now + (expires_in * 1000);
    const refreshExpiresAt = now + (refresh_expires_in * 1000);

    // 2. Fetch user profile
    const userRes = await fetch(`${USER_INFO_URL}?fields=${USER_FIELDS}`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const userData = await userRes.json();
    const user = userData?.data?.user || {};

    // 3. Store creator record
    const record = {
      openId: open_id,
      unionId: user.union_id,
      username: user.username || open_id,
      displayName: user.display_name,
      bioDescription: user.bio_description,
      profileDeepLink: user.profile_deep_link,
      isVerified: user.is_verified,
      avatarUrl: user.avatar_url,
      avatarUrl100: user.avatar_url_100,
      followerCount: user.follower_count || 0,
      followingCount: user.following_count || 0,
      likesCount: user.likes_count || 0,
      videoCount: user.video_count || 0,
      accessToken: access_token,
      refreshToken: refresh_token,
      accessExpiresAt,
      refreshExpiresAt,
      scope,
      connectedAt: now,
      lastRefreshedAt: now
    };

    await kv.set(`tt:creator:${open_id}`, record);
    await kv.sadd('tt:index', open_id);
    if (user.username) {
      await kv.set(`tt:username:${user.username}`, open_id);
    }

    // Also write dashboard-compatible record + fetch videos for the dashboard KV namespace.
    const dashboardRecord = {
      handle: record.username,
      nickname: record.displayName,
      bio: record.bioDescription,
      avatarUrl: record.avatarUrl100 || record.avatarUrl,
      verified: record.isVerified,
      profileUrl: record.profileDeepLink || `https://www.tiktok.com/@${record.username}`,
      followerCount: record.followerCount,
      followingCount: record.followingCount,
      likesCount: record.likesCount,
      videoCount: record.videoCount,
      openId: record.openId,
      addedAt: now,
      lastRefreshedAt: now,
      source: 'oauth'
    };
    await kv.set(`tt:c:${record.username}`, dashboardRecord);
    await kv.sadd('tt:c:index', record.username);

    // Fetch videos via TT API so dashboard modal has them.
    try {
      const VIDEO_LIST_URL = 'https://open.tiktokapis.com/v2/video/list/';
      const VIDEO_FIELDS = 'id,cover_image_url,share_url,video_description,duration,create_time,view_count,like_count,comment_count,share_count';
      const videoRes = await fetch(`${VIDEO_LIST_URL}?fields=${VIDEO_FIELDS}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_count: 20 })
      });
      const videoData = await videoRes.json();
      const videos = (videoData?.data?.videos || []).map(v => ({
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
      await kv.set(`tt:c:videos:${record.username}`, { videos, fetchedAt: now });
    } catch (e) {
      console.error('video fetch failed (non-fatal):', e.message);
    }

// === Phase 2: dual-write to Phia internal Supabase ===
    try {
      const { encryptToken } = await import('../lib/token-crypto.js');
      const { safeUpsert, lookupPersonIdByTtHandle, isSupabaseEnabled } = await import('../lib/supabase.js');
      if (isSupabaseEnabled()) {
        const personId = await lookupPersonIdByTtHandle(record.username);
        if (personId) {
          await safeUpsert('tiktok_account_info', {
            person_id: personId,
            open_id: record.openId,
            union_id: record.unionId || null,
            handle: record.username,
            display_name: record.displayName || null,
            bio_description: record.bioDescription || null,
            profile_deep_link: record.profileDeepLink || null,
            avatar_url: record.avatarUrl100 || record.avatarUrl || null,
            is_verified: !!record.isVerified,
            access_token: encryptToken(record.accessToken),
            access_expires_at: new Date(record.accessExpiresAt).toISOString(),
            refresh_token: encryptToken(record.refreshToken),
            refresh_expires_at: new Date(record.refreshExpiresAt).toISOString(),
            scope: record.scope || null,
            follower_count: record.followerCount || 0,
            following_count: record.followingCount || 0,
            likes_count: record.likesCount || 0,
            video_count: record.videoCount || 0,
            status: 'active',
            last_error: null,
            connected_at: new Date(record.connectedAt).toISOString(),
            last_refreshed_at: new Date(record.lastRefreshedAt).toISOString(),
            disconnected_at: null,
          }, 'open_id');
        } else {
          console.warn('[supabase] No marketing.people row for @' + record.username + ' — TT dual-write skipped');
        }
      }
    } catch (e) {
      console.error('[supabase] TT callback dual-write threw:', e?.message);
    }

    res.status(200).send(renderSuccess(record));
  } catch (err) {
    console.error('callback error:', err);
    res.status(500).send(renderError(err.message));
  }
}

function renderSuccess(rec) {
  return `<!doctype html>
<html><head><meta charset="UTF-8"><title>Connected &middot; Phia TT</title>
<style>
  body{font-family:-apple-system,sans-serif;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:40px}
  .card{background:#fff;color:#000;border-radius:2px;padding:48px;max-width:480px;text-align:center;border:1px solid #e0e0e0}
  .avatar{width:80px;height:80px;border-radius:50%;margin:0 auto 16px;display:block}
  h1{font-family:Georgia,serif;font-size:28px;margin:0 0 8px;font-weight:400}
  .handle{font-family:'SF Mono',Menlo,monospace;font-size:13px;color:#666;letter-spacing:0.05em}
  .stat{font-size:22px;font-weight:500;margin-top:4px}
  .label{font-family:monospace;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#666}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:24px 0}
  .blue{color:#0843CB}
  a{color:#0843CB;text-decoration:none;border-bottom:1px solid #0843CB;font-family:monospace;font-size:12px;letter-spacing:0.05em;text-transform:uppercase}
</style></head>
<body><div class="card">
  ${rec.avatarUrl100 ? `<img src="${rec.avatarUrl100}" class="avatar" alt="">` : ''}
  <h1 class="blue">Connected &check;</h1>
  <div class="handle">@${rec.username}</div>
  <div class="grid">
    <div><div class="label">Followers</div><div class="stat">${(rec.followerCount||0).toLocaleString()}</div></div>
    <div><div class="label">Videos</div><div class="stat">${(rec.videoCount||0).toLocaleString()}</div></div>
    <div><div class="label">Likes</div><div class="stat">${(rec.likesCount||0).toLocaleString()}</div></div>
  </div>
  <p style="color:#666;font-size:13px;margin:24px 0 0">You can close this tab.</p>
  <p style="margin-top:24px"><a href="/">&rarr; View Dashboard</a></p>
</div></body></html>`;
}

function renderError(msg) {
  return `<!doctype html><html><head><meta charset="UTF-8"><title>Error &middot; Phia TT</title>
<style>body{font-family:sans-serif;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:40px}
.card{background:#fff;color:#000;padding:40px;max-width:480px;border-radius:2px;border-left:3px solid #e22}
h1{margin:0 0 8px;font-size:20px;color:#e22}
p{font-family:monospace;font-size:13px;color:#444}</style></head>
<body><div class="card"><h1>Connection failed</h1><p>${msg}</p></div></body></html>`;
}
