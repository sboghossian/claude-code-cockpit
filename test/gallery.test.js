'use strict';

// Phase 1: feat/launch-skill-gallery tests. Loaded via the auto-discovery
// loop in claudeData.test.js — drop-in addition, no package.json change.
//
// IMPORTANT: lazy-require the module under test inside each test() so the
// HOME pin in claudeData.test.js is applied first. Top-level requires would
// load claudeData (and therefore capture os.homedir()) BEFORE the pin.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// validateInstallUrl ----------------------------------------------------------

test('gallery.validateInstallUrl accepts well-formed https URLs', () => {
  const gallery = require('../out/gallery.js');
  const v = gallery.validateInstallUrl('https://raw.githubusercontent.com/foo/bar/main/SKILL.md');
  assert.equal(v.ok, true);
  assert.equal(v.href, 'https://raw.githubusercontent.com/foo/bar/main/SKILL.md');
});

test('gallery.validateInstallUrl rejects non-HTTPS URLs', () => {
  const gallery = require('../out/gallery.js');
  const v = gallery.validateInstallUrl('http://example.com/SKILL.md');
  assert.equal(v.ok, false);
  assert.match(v.reason, /https/i);
});

test('gallery.validateInstallUrl rejects garbage', () => {
  const gallery = require('../out/gallery.js');
  for (const bad of ['', 'not a url', 'file:///etc/passwd', 'javascript:alert(1)', null]) {
    const v = gallery.validateInstallUrl(bad);
    assert.equal(v.ok, false, `expected reject for ${JSON.stringify(bad)}`);
  }
});

// inferSkillName --------------------------------------------------------------

test('gallery.inferSkillName slugs github raw URL pointing at SKILL.md', () => {
  const gallery = require('../out/gallery.js');
  const name = gallery.inferSkillName(
    'https://raw.githubusercontent.com/sboghossian/cockpit-skills/main/forkcast/SKILL.md',
  );
  assert.equal(name, 'forkcast');
});

test('gallery.inferSkillName falls back to last segment when no SKILL.md', () => {
  const gallery = require('../out/gallery.js');
  const name = gallery.inferSkillName('https://example.com/skills/MyCool_Skill');
  assert.equal(name, 'mycool-skill');
});

// formatShareManifest ---------------------------------------------------------

test('gallery.formatShareManifest round-trips frontmatter', () => {
  const gallery = require('../out/gallery.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-share-'));
  const skillDir = path.join(tmp, 'office-hours');
  fs.mkdirSync(skillDir, { recursive: true });
  const skillFile = path.join(skillDir, 'SKILL.md');
  const original =
    `---\nname: office-hours\ndescription: Forcing questions for early-stage builders.\n---\n# Office Hours\n\nBody text.\n`;
  fs.writeFileSync(skillFile, original);

  const item = {
    id: 'skill-user:office-hours',
    kind: 'skill-user',
    name: 'office-hours',
    description: 'Forcing questions for early-stage builders.',
    origin: 'user',
    filePath: skillFile,
    useCount: 0,
  };
  const out = gallery.formatShareManifest(item);

  // Header is a markdown comment that must NOT shadow the frontmatter.
  assert.match(out.text, /^<!-- claude-cockpit:gallery share v1/);
  // Original frontmatter + body MUST be preserved verbatim after the header.
  assert.ok(out.text.endsWith(original), 'share text must end with original skill body');

  // Round-trip: dropping the comment and parsing the rest must yield the same
  // name/description we put in.
  const stripped = out.text.replace(/^<!--[\s\S]*?-->\n/, '');
  const fmMatch = /^---\s*\n([\s\S]*?)\n---/m.exec(stripped);
  assert.ok(fmMatch, 'frontmatter survived the comment header prepend');
  const fields = {};
  for (const line of fmMatch[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  assert.equal(fields.name, 'office-hours');
  assert.equal(fields.description, 'Forcing questions for early-stage builders.');
  assert.match(out.publishUrl, /github\.com\/sboghossian\/cockpit-skills/);
});

// installFromUrl: SHA256 mismatch + happy path -------------------------------
// We inject a fake fetcher so the test stays hermetic — no network, no certs.

test('gallery.installFromUrl rejects when SHA256 does not match preview', async () => {
  const gallery = require('../out/gallery.js');
  const body = '---\nname: foo\ndescription: bar\n---\n# Hello\n';
  const fakeFetcher = async () => ({ status: 200, body });
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-install-mismatch-'));

  await assert.rejects(
    () => gallery.installFromUrl({
      url: 'https://example.com/skills/foo/SKILL.md',
      expectedSha256: '0'.repeat(64), // wrong on purpose
      rootOverride: tmpRoot,
      fetcher: fakeFetcher,
    }),
    /SHA256 mismatch/i,
  );
});

test('gallery.installFromUrl writes file when SHA256 matches', async () => {
  const gallery = require('../out/gallery.js');
  const body = '---\nname: foo\ndescription: bar\n---\n# Hello\n';
  const fakeFetcher = async () => ({ status: 200, body });
  const correctSha = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-install-ok-'));

  const result = await gallery.installFromUrl({
    url: 'https://example.com/skills/foo/SKILL.md',
    expectedSha256: correctSha,
    rootOverride: tmpRoot,
    fetcher: fakeFetcher,
  });

  assert.equal(result.inferredName, 'foo');
  assert.ok(fs.existsSync(result.filePath), 'install wrote SKILL.md');
  assert.equal(fs.readFileSync(result.filePath, 'utf8'), body);
  // Contained in the override root — never escapes.
  assert.ok(result.filePath.startsWith(tmpRoot + path.sep));
});

test('gallery.installFromUrl rejects 5xx responses', async () => {
  const gallery = require('../out/gallery.js');
  const fakeFetcher = async () => ({ status: 503, body: 'Service Unavailable' });
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-install-5xx-'));
  await assert.rejects(
    () => gallery.installFromUrl({
      url: 'https://example.com/skills/foo/SKILL.md',
      expectedSha256: '0'.repeat(64),
      rootOverride: tmpRoot,
      fetcher: fakeFetcher,
    }),
    /503/,
  );
});

test('gallery.installFromUrl rejects non-HTTPS URLs before fetching', async () => {
  const gallery = require('../out/gallery.js');
  let called = false;
  const fakeFetcher = async () => {
    called = true;
    return { status: 200, body: '' };
  };
  await assert.rejects(
    () => gallery.installFromUrl({
      url: 'http://example.com/SKILL.md',
      expectedSha256: '',
      rootOverride: os.tmpdir(),
      fetcher: fakeFetcher,
    }),
    /https/i,
  );
  assert.equal(called, false, 'fetcher must not run for non-https URLs');
});

// gallerySummary --------------------------------------------------------------

test('gallery.gallerySummary returns numeric counts', () => {
  const gallery = require('../out/gallery.js');
  const sum = gallery.gallerySummary(undefined);
  assert.equal(typeof sum.skillCount, 'number');
  assert.equal(typeof sum.agentCount, 'number');
  assert.equal(typeof sum.totalCount, 'number');
  assert.equal(sum.totalCount, sum.skillCount + sum.agentCount);
});
