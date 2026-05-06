// Polished side-by-side hero banner — Now + Mac panels with a header.
// Output: /tmp/cockpit-hero-banner.html
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'media', 'sidebar.css'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'media', 'sidebar.js'), 'utf8');

// Reuse the rich snapshot from render-hero.js by requiring it. Easier: inline.
delete require.cache[require.resolve('./render-hero.js')];
// We can't import the snapshot directly because render-hero.js has no exports.
// Easiest: read the file and eval the snap definition. But cleanest: redefine here.
// Instead, just spawn render-hero.js and reuse its output isn't possible without
// refactor. We re-declare the snap inline (already done in render-hero.js).
// For brevity, this script reads the rendered single-panel HTML and tiles it.

const heroPath = '/tmp/cockpit-hero.html';
if (!fs.existsSync(heroPath)) {
  console.error('Run scripts/render-hero.js first to produce', heroPath);
  process.exit(1);
}

// Build a banner that loads two iframes pointing to two variants of the
// rendered HTML — one showing 'now', one showing 'mac' (state.activeTab).
// We achieve this by passing the active tab via a query string fragment.

const heroHtml = fs.readFileSync(heroPath, 'utf8');
// Inject a global to override the initial tab from URL hash.
const augmented = heroHtml.replace(
  "let __state = { activeTab: 'now' };",
  "let __state = { activeTab: (location.hash || '#now').slice(1) || 'now' };"
);
fs.writeFileSync(heroPath, augmented);

const banner = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body {
    margin: 0;
    background: #0d0d0d;
    background-image:
      radial-gradient(circle at 20% 30%, rgba(78, 163, 224, 0.08), transparent 50%),
      radial-gradient(circle at 80% 70%, rgba(124, 58, 237, 0.08), transparent 50%);
    min-height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif;
    color: #e8e8e8;
    padding: 50px 40px;
    box-sizing: border-box;
  }
  .header {
    max-width: 1180px;
    margin: 0 auto 40px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .brand-mark {
    width: 56px; height: 56px;
    border-radius: 14px;
    background: linear-gradient(135deg, #4ea3e0 0%, #7c3aed 100%);
    display: flex; align-items: center; justify-content: center;
    font-size: 30px;
    box-shadow: 0 8px 24px rgba(78, 163, 224, 0.25);
  }
  .brand-text h1 {
    font-size: 34px;
    margin: 0 0 4px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .brand-text p {
    margin: 0;
    color: #9a9a9a;
    font-size: 14px;
    letter-spacing: 0.01em;
  }
  .tagline {
    font-size: 13px;
    color: #9a9a9a;
    text-align: right;
    line-height: 1.5;
    max-width: 280px;
  }
  .tagline strong { color: #e8e8e8; }
  .panels {
    max-width: 1180px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 28px;
  }
  .panel-wrap {
    border-radius: 14px;
    overflow: hidden;
    background: #1e1e1e;
    border: 1px solid #303030;
    box-shadow: 0 24px 60px rgba(0,0,0,0.4);
    position: relative;
  }
  .panel-wrap::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 14px;
    pointer-events: none;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
  }
  .panel-label {
    position: absolute;
    top: 14px;
    right: 14px;
    background: rgba(0,0,0,0.6);
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 4px 10px;
    border-radius: 99px;
    z-index: 10;
    backdrop-filter: blur(8px);
  }
  iframe {
    border: 0;
    display: block;
    width: 100%;
    height: 1220px;
  }
  .footer {
    max-width: 1180px;
    margin: 36px auto 0;
    text-align: center;
    color: #6a6a6a;
    font-size: 12px;
    letter-spacing: 0.04em;
  }
  .footer strong { color: #b0b0b0; }
  .pills {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
    margin-top: 14px;
  }
  .pill {
    padding: 6px 14px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 99px;
    font-size: 12px;
    color: #c8c8c8;
    letter-spacing: 0.01em;
  }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <div class="brand-mark">⌘</div>
      <div class="brand-text">
        <h1>Claude Cockpit</h1>
        <p>The personal-OS HUD for Claude Code · VSCode-native · 100% local</p>
      </div>
    </div>
    <div class="tagline">
      Surfaces the state Claude Code already writes to disk.<br/>
      <strong>Plus your Mac.</strong> Plus your Obsidian. Plus claude.ai.
    </div>
  </div>

  <div class="panels">
    <div class="panel-wrap">
      <div class="panel-label">Now</div>
      <iframe src="file://${heroPath}#now" loading="eager"></iframe>
    </div>
    <div class="panel-wrap">
      <div class="panel-label">Mac</div>
      <iframe src="file://${heroPath}#mac" loading="eager"></iframe>
    </div>
  </div>

  <div class="footer">
    <strong>14 tabs</strong> · Now · Mac · Watchtower · Agents · Chat · Search · Obsidian · Memory · Prompts · Skills · Projects · Files · Config · Help
    <div class="pills">
      <span class="pill">Live token + cost burn</span>
      <span class="pill">Cross-project session heartbeat</span>
      <span class="pill">Mac system health</span>
      <span class="pill">App usage tracker</span>
      <span class="pill">Obsidian save-session</span>
      <span class="pill">Global session search</span>
      <span class="pill">Pinnable memory</span>
      <span class="pill">Budget caps</span>
      <span class="pill">Prompt library</span>
      <span class="pill">RTK savings</span>
      <span class="pill">Tunnel browser</span>
      <span class="pill">Plain-language Help</span>
    </div>
  </div>

  <script>
    void ${JSON.stringify({ unused: 'kept for parity' })};
    // The CSS/JS noted unused vars above just so prettifiers don't strip the include.
    /* hooks for future enhancements:
       - swap iframes to Watchtower / Obsidian for alternative banners
       - add hostname overlay for personalization
    */
    /* eslint-disable */
    void (${JSON.stringify(css.length)});
    void (${JSON.stringify(js.length)});
  </script>
</body>
</html>`;

const out = '/tmp/cockpit-hero-banner.html';
fs.writeFileSync(out, banner);
console.log('wrote', out, '(' + banner.length + ' bytes)');
