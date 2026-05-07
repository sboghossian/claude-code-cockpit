'use strict';

// Permissions-audit log tests. Covers the four cases listed in the launch
// brief acceptance criteria:
//   1. append (atomic, redacted detail) → readAuditTail returns it
//   2. tail-N order (newest first across rotated files)
//   3. rotation kicks in when the hot file crosses the threshold
//   4. searchAudit walks rotated files (substring, case-insensitive)
//
// We redirect the log path to a per-test tmpdir via __setLogPathForTests so
// the suite never touches the user's real ~/.claude/.cockpit/audit.log.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const audit = require('../out/auditLog.js');

function tmpLogPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-audit-'));
  return path.join(dir, 'audit.log');
}

test('appendAuditEvent + readAuditTail roundtrip', () => {
  const restore = audit.__setLogPathForTests(tmpLogPath());
  try {
    audit.__resetForTests();
    audit.__setLogPathForTests(tmpLogPath());
    audit.setAuditEnabled(true);
    audit.appendAuditEvent({
      ts: 1000,
      kind: 'net.outbound',
      detail: { host: 'api.github.com' },
      worktree: 'permissions-audit',
    });
    audit.appendAuditEvent({
      ts: 2000,
      kind: 'net.outbound',
      detail: { host: 'roadmap.dashable.dev' },
      worktree: 'permissions-audit',
    });
    const tail = audit.readAuditTail(10);
    assert.equal(tail.length, 2);
    // Newest first.
    assert.equal(tail[0].ts, 2000);
    assert.equal(tail[1].ts, 1000);
    assert.equal(tail[0].detail.host, 'roadmap.dashable.dev');
  } finally {
    restore();
    audit.__resetForTests();
  }
});

test('readAuditTail respects N and returns newest first across rotation', () => {
  const file = tmpLogPath();
  const restore = audit.__setLogPathForTests(file);
  try {
    audit.setAuditEnabled(true);
    // 1000 events, each ~80 bytes — well under any threshold. Rotate
    // manually after 500 to simulate the multi-file case.
    for (let i = 0; i < 500; i++) {
      audit.appendAuditEvent({ ts: i, kind: 'net.outbound', detail: { host: `h${i}.example.com` } });
    }
    // Force rotation: lower threshold to current size, append one more.
    const stat = fs.statSync(file);
    const lower = audit.__setMaxBytesForTests(stat.size);
    try {
      audit.appendAuditEvent({ ts: 500, kind: 'net.outbound', detail: { host: 'h500.example.com' } });
    } finally {
      lower();
    }
    // After rotation, hot file has 1 entry; .1 has 500.
    for (let i = 501; i < 1000; i++) {
      audit.appendAuditEvent({ ts: i, kind: 'net.outbound', detail: { host: `h${i}.example.com` } });
    }
    // tail-3 should pull the last three (997, 998, 999) all from the hot file.
    const tail3 = audit.readAuditTail(3);
    assert.equal(tail3.length, 3);
    assert.deepEqual(tail3.map((e) => e.ts), [999, 998, 997]);
    // tail-510 has to walk into the rotated file.
    const tail510 = audit.readAuditTail(510);
    assert.equal(tail510.length, 510);
    // First event is the newest.
    assert.equal(tail510[0].ts, 999);
    // Last event walked from rotated file.
    assert.equal(tail510[509].ts, 990 - 500); // 999 - 509 = 490
  } finally {
    restore();
    audit.__resetForTests();
  }
});

test('rotation creates audit.log.1 when threshold is crossed', () => {
  const file = tmpLogPath();
  const restore = audit.__setLogPathForTests(file);
  try {
    audit.setAuditEnabled(true);
    // Threshold of 500 bytes — a few events will trip rotation.
    const lowerMax = audit.__setMaxBytesForTests(500);
    try {
      // First batch fills under the limit.
      audit.appendAuditEvent({ ts: 1, kind: 'net.outbound', detail: { host: 'a.example.com' } });
      audit.appendAuditEvent({ ts: 2, kind: 'net.outbound', detail: { host: 'b.example.com' } });
      // Now grow past 500 bytes.
      for (let i = 3; i < 30; i++) {
        audit.appendAuditEvent({ ts: i, kind: 'net.outbound', detail: { host: `r${i}.example.com` } });
      }
    } finally {
      lowerMax();
    }
    // Rotation should have produced audit.log.1 alongside the hot file.
    assert.equal(fs.existsSync(`${file}.1`), true, 'rotated file audit.log.1 should exist');
    // The hot file still exists with the events that came AFTER rotation.
    assert.equal(fs.existsSync(file), true, 'hot file should still exist after rotation');
  } finally {
    restore();
    audit.__resetForTests();
  }
});

test('searchAudit walks rotated files and is case-insensitive', () => {
  const file = tmpLogPath();
  const restore = audit.__setLogPathForTests(file);
  try {
    audit.setAuditEnabled(true);
    audit.appendAuditEvent({ ts: 1, kind: 'net.outbound', detail: { host: 'api.github.com' } });
    audit.appendAuditEvent({ ts: 2, kind: 'net.outbound', detail: { host: 'roadmap.dashable.dev' } });
    audit.appendAuditEvent({ ts: 3, kind: 'mcp.call', detail: { server: 'figma' } });
    const lower = audit.__setMaxBytesForTests(1);
    try {
      audit.appendAuditEvent({ ts: 4, kind: 'net.outbound', detail: { host: 'AnotherDomain.com' } });
    } finally {
      lower();
    }
    const hits = audit.searchAudit('domain');
    // Case-insensitive match against AnotherDomain.com.
    assert.ok(hits.some((e) => e.ts === 4), 'searchAudit should find AnotherDomain.com');
    const allOutbound = audit.searchAudit('net.outbound');
    assert.ok(allOutbound.length >= 3, 'searchAudit should return all net.outbound entries');
  } finally {
    restore();
    audit.__resetForTests();
  }
});

test('outboundDomainTail rolls up by host with count + lastSeen', () => {
  const file = tmpLogPath();
  const restore = audit.__setLogPathForTests(file);
  try {
    audit.setAuditEnabled(true);
    audit.appendAuditEvent({ ts: 100, kind: 'net.outbound', detail: { host: 'api.github.com' } });
    audit.appendAuditEvent({ ts: 200, kind: 'net.outbound', detail: { host: 'roadmap.dashable.dev' } });
    audit.appendAuditEvent({ ts: 300, kind: 'net.outbound', detail: { host: 'api.github.com' } });
    audit.appendAuditEvent({ ts: 400, kind: 'mcp.call', detail: { server: 'figma' } });
    const out = audit.outboundDomainTail(10);
    assert.equal(out.length, 2, 'two unique hosts');
    const gh = out.find((e) => e.host === 'api.github.com');
    assert.ok(gh, 'github roll-up exists');
    assert.equal(gh.count, 2);
    assert.equal(gh.lastSeenMs, 300);
    // Sorted by lastSeenMs desc → github first.
    assert.equal(out[0].host, 'api.github.com');
  } finally {
    restore();
    audit.__resetForTests();
  }
});

test('appendAuditEvent is a no-op when audit is disabled', () => {
  const file = tmpLogPath();
  const restore = audit.__setLogPathForTests(file);
  try {
    audit.setAuditEnabled(false);
    audit.appendAuditEvent({ ts: 1, kind: 'net.outbound', detail: { host: 'should-not-appear.example.com' } });
    assert.equal(fs.existsSync(file), false, 'audit log file should not be created when disabled');
    audit.setAuditEnabled(true);
    audit.appendAuditEvent({ ts: 2, kind: 'net.outbound', detail: { host: 'should-appear.example.com' } });
    const tail = audit.readAuditTail(10);
    assert.equal(tail.length, 1);
    assert.equal(tail[0].ts, 2);
  } finally {
    restore();
    audit.__resetForTests();
  }
});

test('serialize redacts oversized lines but preserves ts + kind', () => {
  const file = tmpLogPath();
  const restore = audit.__setLogPathForTests(file);
  try {
    audit.setAuditEnabled(true);
    // 16 KB of payload — exceeds the 8 KB MAX_LINE_BYTES cap.
    const huge = 'x'.repeat(16 * 1024);
    audit.appendAuditEvent({
      ts: 999,
      kind: 'net.outbound',
      detail: { host: 'big.example.com', payload: huge },
    });
    const tail = audit.readAuditTail(1);
    assert.equal(tail.length, 1);
    assert.equal(tail[0].ts, 999);
    assert.equal(tail[0].kind, 'net.outbound');
    assert.equal(tail[0].detail.truncated, true);
    assert.ok(typeof tail[0].detail.originalBytes === 'number');
    assert.equal(tail[0].detail.host, undefined, 'oversized payload must NOT leak through');
  } finally {
    restore();
    audit.__resetForTests();
  }
});
