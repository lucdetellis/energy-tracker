import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseNotification, mergeEvents, fetchResponses, collect } from '../scripts/collect.mjs';

const topic = 'test_response_topic_123456789';
function message(id = 'abc12345', body = 'energy_2026-10-19_20_high', time = 1792450000) {
  return { event: 'message', id, message: body, time, topic };
}
function mockFetch(messages, opts = {}) {
  return async (url, request) => {
    assert.equal(url.hostname, 'ntfy.sh');
    assert.equal(url.pathname, `/${topic}/json`);
    assert.equal(url.searchParams.get('poll'), '1');
    assert.equal(url.searchParams.get('since'), '11h');
    assert.ok(request.signal);
    return new Response(messages.map((msg) => JSON.stringify(msg)).join('\n') + '\n', {
      status: opts.status ?? 200,
      headers: opts.headers,
    });
  };
}

test('parses 9 AM High reading, preserving date, hour and timestamp', () => {
  assert.deepEqual(parseNotification(message('abc12345', 'energy_2026-10-19_09_high')), {
    id: 'abc12345', date: '2026-10-19', hour: 9, energy: 'high', recordedAt: new Date(1792450000 * 1000).toISOString(),
  });
});
test('parses evening Low and Average readings', () => {
  assert.equal(parseNotification(message('abc12345', 'energy_2026-10-19_21_low')).energy, 'low');
  assert.equal(parseNotification(message('abc12346', 'energy_2026-10-19_12_avg')).energy, 'avg');
});
test('accepts 10 PM and 11 PM readings, the last hours of the 9a-11p window', () => {
  assert.equal(parseNotification(message('abc12345', 'energy_2026-10-19_22_high')).hour, 22);
  assert.equal(parseNotification(message('abc12346', 'energy_2026-10-19_23_low')).hour, 23);
});
test('parses a flag answer as a flag event', () => {
  assert.deepEqual(parseNotification(message('abc12345', 'flag_2026-10-21_09_coffee')), {
    id: 'abc12345', date: '2026-10-21', hour: 9, flag: 'coffee', recordedAt: new Date(1792450000 * 1000).toISOString(),
  });
});
test('accepts flag names it has never seen, so the flag list can change without a collector update', () => {
  assert.equal(parseNotification(message('abc12345', 'flag_2026-10-21_23_melatonin2')).flag, 'melatonin2');
});
test('rejects malformed and out-of-window flags', () => {
  for (const body of ['flag_2026-10-21_08_lam', 'flag_2026-10-21_24_lam', 'flag_2026-10-21_09_', 'flag_2026-10-21_09_Lam', 'flag_2026-10-21_09_lam-x', 'flag_2026-10-21_09_2lam']) {
    assert.equal(parseNotification(message('abc12345', body)), null, body);
  }
});
test('rejects out of-window, malformed, invalid-date and unrelated messages', () => {
  for (const body of ['energy_2026-10-19_08_high','energy_2026-10-19_24_low','energy_2026-02-30_09_low','energy_2026-10-19_9_high','energy_2026-10-19_09_medium','Energy Tracker','energy_2026-10-19_09_high\nmore']) {
    assert.equal(parseNotification(message('abc12345', body)), null, body);
  }
  assert.equal(parseNotification({ ...message(), event: 'open' }), null);
  assert.equal(parseNotification({ ...message(), id: '!' }), null);
  assert.equal(parseNotification({ ...message(), time: '1792450000' }), null);
});
test('replay merges by ntfy ID and keeps original content for an ID', () => {
  const previous = { id: 'abc12345', date: '2026-10-19', hour: 9, energy: 'high', recordedAt: '2026-10-19T09:00:00.000Z' };
  const newer = { id: 'abc12346', date: '2026-10-19', hour: 9, energy: 'avg', recordedAt: '2026-10-19T09:01:00.000Z' };
  assert.deepEqual(mergeEvents([previous], [{ ...previous, energy: 'low' }, newer, newer]), [previous, newer]);
});
test('polls ntfy with bounded rolling cache window and keeps only valid event messages', async () => {
  const events = await fetchResponses(topic, mockFetch([message(), message('abc12346', 'other'), { event: 'open', id: 'ignored1' }]));
  assert.equal(events.length, 1);
  assert.equal(events[0].energy, 'high');
});
test('does not expose secret topic in HTTP error', async () => {
  await assert.rejects(fetchResponses(topic, mockFetch([], { status: 429 })), (error) => {
    assert.equal(error.message, 'ntfy returned HTTP 429');
    assert.ok(!error.message.includes(topic));
    return true;
  });
});
test('refuses truncated ntfy history', async () => {
  await assert.rejects(fetchResponses(topic, mockFetch([], { headers: { 'x-messages-truncated': '1' } })), /truncated/);
});
test('rejects invalid/missing topic before making a request', async () => {
  await assert.rejects(fetchResponses('https://ntfy.sh/a'), /topic name/);
  await assert.rejects(fetchResponses('', () => { throw Error('must not call'); }), /topic name/);
});
test('rejects malformed newline-delimited data instead of partially collecting', async () => {
  await assert.rejects(fetchResponses(topic, async () => new Response('{not json\n')), /malformed/);
});
test('persists new readings, remains idempotent on repeated polls, then adds corrections', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'energy-collector-'));
  const path = join(dir, 'events.json');
  try {
    await writeFile(path, '[]\n');
    const first = await collect({ topic, filePath: path, fetchImpl: mockFetch([message()]) });
    assert.deepEqual(first, { added: 1, total: 1 });
    const second = await collect({ topic, filePath: path, fetchImpl: mockFetch([message()]) });
    assert.deepEqual(second, { added: 0, total: 1 });
    const third = await collect({ topic, filePath: path, fetchImpl: mockFetch([message(), message('abc12346', 'energy_2026-10-19_20_low')]) });
    assert.deepEqual(third, { added: 1, total: 2 });
    assert.equal(JSON.parse(await readFile(path, 'utf8')).length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('fails when secret is missing and does not change saved history', async () => {
  await assert.rejects(collect({ topic: '' }), /Missing Actions secret/);
});
