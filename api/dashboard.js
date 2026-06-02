// api/dashboard.js
// Phia TikTok command center — server-rendered HTML, client-side data fetch.
// Mirror of IG/YT dashboards in Phia design system.

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(HTML);
}

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Phia · TikTok Center</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=DM+Serif+Display&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --phia-blue: #0843CB;
      --phia-cream: #F7F7F5;
      --phia-black: #0A0A0A;
      --phia-gray: #666;
      --phia-light-gray: #E0E0E0;
      --phia-success: #16a34a;
      --font-display: 'DM Serif Display', Georgia, serif;
      --font-sans: 'Inter', -apple-system, sans-serif;
      --font-mono: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--font-sans); background: #fff; color: var(--phia-black); line-height: 1.5; }
    a { color: var(--phia-blue); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .container { max-width: 1280px; margin: 0 auto; padding: 32px 24px; }

    /* Top nav */
    .nav { display: flex; align-items: center; justify-content: space-between; padding-bottom: 24px; border-bottom: 1px solid var(--phia-light-gray); margin-bottom: 32px; }
    .nav-brand { font-family: var(--font-display); font-size: 24px; font-weight: 400; }
    .nav-brand .dot { color: var(--phia-blue); }
    .nav-tabs { display: flex; gap: 4px; background: var(--phia-cream); padding: 4px; border-radius: 4px; }
    .nav-tab { padding: 8px 16px; font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--phia-gray); background: transparent; border: none; border-radius: 3px; cursor: pointer; text-decoration: none; }
    .nav-tab.active { background: #fff; color: var(--phia-blue); font-weight: 500; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }

    /* Header */
    .header { margin-bottom: 32px; }
    .header h1 { font-family: var(--font-display); font-size: 48px; font-weight: 400; line-height: 1.1; margin-bottom: 8px; }
    .header h1 .blue { color: var(--phia-blue); }
    .header .subtitle { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--phia-gray); }

    /* Period toggle */
    .period-tabs { display: flex; gap: 4px; margin-bottom: 24px; background: var(--phia-cream); padding: 4px; border-radius: 4px; width: fit-content; }
    .period-tab { padding: 8px 18px; font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--phia-gray); background: transparent; border: none; border-radius: 3px; cursor: pointer; transition: all 0.15s; }
    .period-tab:hover { color: var(--phia-black); }
    .period-tab.active { background: #fff; color: var(--phia-blue); font-weight: 500; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }

    /* Hero stats panel */
    .hero { background: var(--phia-black); color: #fff; border-radius: 2px; padding: 40px 32px; margin-bottom: 32px; }
    .hero-label { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.6); margin-bottom: 16px; }
    .hero-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 32px; }
    .hero-stat .label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.5); margin-bottom: 8px; }
    .hero-stat .value { font-family: var(--font-display); font-size: 36px; line-height: 1; }

    /* Totals strip */
    .totals { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px; }
    .stat-card { background: var(--phia-cream); border-radius: 2px; padding: 20px; }
    .stat-card .label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--phia-gray); margin-bottom: 8px; }
    .stat-card .value { font-size: 24px; font-weight: 500; }
    .stat-card .sub { font-family: var(--font-mono); font-size: 10px; color: var(--phia-gray); margin-top: 4px; }

    /* Section header */
    .section-header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 16px; }
    .section-header h2 { font-family: var(--font-display); font-size: 24px; font-weight: 400; }
    .section-header .count { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--phia-gray); }

    /* Creator grid */
    .creators { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .creator-card { background: #fff; border: 1px solid var(--phia-light-gray); border-radius: 2px; padding: 20px; cursor: pointer; transition: border-color 0.15s, transform 0.15s; }
    .creator-card:hover { border-color: var(--phia-blue); transform: translateY(-2px); }
    .creator-top { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .creator-avatar { width: 48px; height: 48px; border-radius: 50%; background: var(--phia-cream); overflow: hidden; flex-shrink: 0; }
    .creator-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .creator-info { flex: 1; min-width: 0; }
    .creator-name { font-weight: 600; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .creator-handle { font-family: var(--font-mono); font-size: 11px; color: var(--phia-gray); }
    .creator-stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; padding-top: 12px; border-top: 1px solid var(--phia-light-gray); }
    .creator-stat .label { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--phia-gray); margin-bottom: 4px; }
    .creator-stat .value { font-size: 14px; font-weight: 500; }

    /* Live status bar */
    .live-status { background: var(--phia-cream); border-left: 3px solid var(--phia-blue); padding: 12px 16px; font-family: var(--font-mono); font-size: 11px; color: var(--phia-gray); margin-bottom: 32px; display: flex; align-items: center; gap: 8px; }
    .live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--phia-success); animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }

    /* Empty state */
    .empty { text-align: center; padding: 64px 24px; background: var(--phia-cream); border-radius: 2px; }
    .empty h3 { font-family: var(--font-display); font-size: 28px; font-weight: 400; margin-bottom: 8px; }
    .empty p { color: var(--phia-gray); margin-bottom: 24px; }
    .empty code { background: #fff; padding: 8px 12px; border-radius: 2px; font-family: var(--font-mono); font-size: 12px; display: inline-block; border: 1px solid var(--phia-light-gray); }

    /* Loading */
    .loading { text-align: center; padding: 64px; color: var(--phia-gray); font-family: var(--font-mono); font-size: 12px; }

    /* Modal */
    .modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: none; align-items: center; justify-content: center; z-index: 100; padding: 24px; }
    .modal-bg.open { display: flex; }
    .modal { background: #fff; border-radius: 2px; max-width: 800px; width: 100%; max-height: 90vh; overflow-y: auto; padding: 32px; }
    .modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
    .modal-header h2 { font-family: var(--font-display); font-size: 28px; font-weight: 400; }
    .modal-close { background: none; border: none; font-size: 24px; cursor: pointer; color: var(--phia-gray); }
    .modal-creator { display: flex; align-items: center; gap: 16px; padding: 16px; background: var(--phia-cream); border-radius: 2px; margin-bottom: 24px; }
    .modal-creator img { width: 64px; height: 64px; border-radius: 50%; object-fit: cover; }
    .modal-creator .name { font-weight: 600; font-size: 18px; }
    .modal-creator .handle { font-family: var(--font-mono); font-size: 12px; color: var(--phia-gray); margin-top: 2px; }
    .modal-creator .bio { font-size: 13px; color: var(--phia-gray); margin-top: 6px; }
    .video-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
    .video-card { background: #fff; border: 1px solid var(--phia-light-gray); border-radius: 2px; overflow: hidden; cursor: pointer; transition: border-color 0.15s; text-decoration: none; color: inherit; display: block; }
    .video-card:hover { border-color: var(--phia-blue); text-decoration: none; }
    .video-cover { width: 100%; aspect-ratio: 9/16; object-fit: cover; background: var(--phia-cream); display: block; }
    .video-info { padding: 10px; }
    .video-title { font-size: 12px; line-height: 1.3; height: 2.6em; overflow: hidden; margin-bottom: 8px; }
    .video-stats { display: flex; gap: 8px; font-family: var(--font-mono); font-size: 10px; color: var(--phia-gray); }
    .video-stats span { display: flex; align-items: center; gap: 2px; }

    @media (max-width: 768px) {
      .hero-grid, .totals { grid-template-columns: repeat(2, 1fr); }
      .header h1 { font-size: 36px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <nav class="nav">
      <div class="nav-brand">phia<span class="dot">.</span></div>
      <div class="nav-tabs">
        <a href="https://phiaco-oauth.vercel.app/" class="nav-tab">Instagram</a>
        <a href="https://phiaco-youtube.vercel.app/" class="nav-tab">YouTube</a>
        <a href="/" class="nav-tab active">TikTok</a>
      </div>
    </nav>

    <div class="header">
      <h1>TikTok <span class="blue">Center</span></h1>
      <div class="subtitle period-label-short">Last 28 days</div>
    </div>

    <div class="period-tabs">
      <button class="period-tab active" data-period="28" onclick="setPeriod(28)">28D</button>
      <button class="period-tab" data-period="7" onclick="setPeriod(7)">7D</button>
      <button class="period-tab" data-period="90" onclick="setPeriod(90)">90D</button>
      <button class="period-tab" data-period="lifetime" onclick="setPeriod('lifetime')">LIFETIME</button>
    </div>

    <div class="live-status">
      <span class="live-dot"></span>
      <span id="live-status-text">Loading aggregate stats…</span>
    </div>

    <div id="content">
      <div class="loading">Fetching creator data…</div>
    </div>
  </div>

  <div class="modal-bg" id="modal" onclick="if(event.target.id==='modal') closeModal()">
    <div class="modal">
      <div class="modal-header">
        <h2 id="modal-title">Creator</h2>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div id="modal-body"></div>
    </div>
  </div>

  <script>
    window.currentPeriod = '28';

    function fmt(n) {
      if (n == null) return '0';
      if (n >= 1e9) return (n/1e9).toFixed(1) + 'B';
      if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
      if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
      return n.toLocaleString();
    }

    function setPeriod(p) {
      window.currentPeriod = String(p);
      document.querySelectorAll('.period-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.period === window.currentPeriod);
      });
      const labels = document.querySelectorAll('.period-label-short');
      const pretty = window.currentPeriod === 'lifetime' ? 'Lifetime' : ('Last ' + window.currentPeriod + ' days');
      labels.forEach(el => el.textContent = pretty);
      loadAggregate(true);
    }

    async function loadAggregate(bust) {
      const url = '/aggregate?secret=phiaco-secret-2026&period=' + window.currentPeriod + (bust ? '&bust=1' : '');
      try {
        const r = await fetch(url);
        const d = await r.json();
        render(d);
      } catch (e) {
        document.getElementById('content').innerHTML = '<div class="empty"><h3>Error loading data</h3><p>' + e.message + '</p></div>';
      }
    }

    function render(d) {
      const status = document.getElementById('live-status-text');
      const periodLabel = d.periodValue === 'lifetime' ? 'lifetime' : ('last ' + d.periodValue + ' days');
      status.textContent = 'Live · ' + d.creatorCount + ' creators · ' + periodLabel + ' · refreshed ' + new Date(d.generatedAt).toLocaleTimeString();

      if (!d.creators || !d.creators.length) {
        document.getElementById('content').innerHTML = \`
          <div class="empty">
            <h3>No creators connected yet</h3>
            <p>Add creators via the admin endpoint:</p>
            <code>/admin?secret=...&action=add&handle=stylewithchails</code>
          </div>
        \`;
        return;
      }

      const t = d.totals;
      const html = \`
        <div class="hero">
          <div class="hero-label">All connected creators · \${periodLabel}</div>
          <div class="hero-grid">
            <div class="hero-stat">
              <div class="label">Total followers</div>
              <div class="value">\${fmt(t.followers)}</div>
            </div>
            <div class="hero-stat">
              <div class="label">Views (period)</div>
              <div class="value">\${fmt(t.viewsPeriod)}</div>
            </div>
            <div class="hero-stat">
              <div class="label">Likes (period)</div>
              <div class="value">\${fmt(t.likesPeriod)}</div>
            </div>
            <div class="hero-stat">
              <div class="label">Videos (period)</div>
              <div class="value">\${fmt(t.videosPeriod)}</div>
            </div>
          </div>
        </div>

        <div class="totals">
          <div class="stat-card">
            <div class="label">Lifetime videos</div>
            <div class="value">\${fmt(t.videosLifetime)}</div>
            <div class="sub">across all creators</div>
          </div>
          <div class="stat-card">
            <div class="label">Lifetime likes</div>
            <div class="value">\${fmt(t.likesLifetime)}</div>
          </div>
          <div class="stat-card">
            <div class="label">Comments (period)</div>
            <div class="value">\${fmt(t.commentsPeriod)}</div>
          </div>
          <div class="stat-card">
            <div class="label">Shares (period)</div>
            <div class="value">\${fmt(t.sharesPeriod)}</div>
          </div>
        </div>

        <div class="section-header">
          <h2>Creators</h2>
          <span class="count">\${d.creatorCount} CONNECTED</span>
        </div>

        <div class="creators">
          \${d.creators.map(c => \`
            <div class="creator-card" onclick='openCreator(\${JSON.stringify(c.handle)})'>
              <div class="creator-top">
                <div class="creator-avatar">\${c.avatarUrl ? '<img src="' + c.avatarUrl + '" alt="">' : ''}</div>
                <div class="creator-info">
                  <div class="creator-name">\${c.nickname || c.handle}\${c.verified ? ' ✓' : ''}</div>
                  <div class="creator-handle">@\${c.handle}</div>
                </div>
              </div>
              <div class="creator-stats">
                <div class="creator-stat">
                  <div class="label">Followers</div>
                  <div class="value">\${fmt(c.followerCount)}</div>
                </div>
                <div class="creator-stat">
                  <div class="label">Videos</div>
                  <div class="value">\${fmt(c.recentPeriod.videos)}</div>
                </div>
                <div class="creator-stat">
                  <div class="label">Views</div>
                  <div class="value">\${fmt(c.recentPeriod.views)}</div>
                </div>
              </div>
            </div>
          \`).join('')}
        </div>
      \`;
      document.getElementById('content').innerHTML = html;
      window._lastData = d;
    }

    function openCreator(handle) {
      const c = window._lastData.creators.find(x => x.handle === handle);
      if (!c) return;
      document.getElementById('modal-title').textContent = 'Recent videos';
      const body = \`
        <div class="modal-creator">
          \${c.avatarUrl ? '<img src="' + c.avatarUrl + '" alt="">' : ''}
          <div>
            <div class="name">\${c.nickname || c.handle}\${c.verified ? ' ✓' : ''}</div>
            <div class="handle"><a href="\${c.profileUrl || ('https://www.tiktok.com/@' + c.handle)}" target="_blank">@\${c.handle}</a> · \${fmt(c.followerCount)} followers · \${fmt(c.videoCount)} lifetime videos</div>
            \${c.bio ? '<div class="bio">' + c.bio.replace(/</g,'&lt;') + '</div>' : ''}
          </div>
        </div>
        <div class="video-list">
          \${(c.recentVideos || []).map(v => \`
            <a href="\${v.shareUrl}" target="_blank" class="video-card">
              <img class="video-cover" src="\${v.cover || ''}" alt="" loading="lazy">
              <div class="video-info">
                <div class="video-title">\${(v.title || '').replace(/</g,'&lt;')}</div>
                <div class="video-stats">
                  <span>▶ \${fmt(v.views)}</span>
                  <span>♥ \${fmt(v.likes)}</span>
                  <span>💬 \${fmt(v.comments)}</span>
                </div>
              </div>
            </a>
          \`).join('')}
        </div>
      \`;
      document.getElementById('modal-body').innerHTML = body;
      document.getElementById('modal').classList.add('open');
    }

    function closeModal() {
      document.getElementById('modal').classList.remove('open');
    }

    loadAggregate(false);
  </script>
</body>
</html>`;
