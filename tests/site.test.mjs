import test from 'node:test';
import assert from 'node:assert/strict';
import { HOURS, validEvent, latestPerSlot, dayAverage, levelFromScore, recentDates, toCsv } from '../site/lib.js';

const ev = (hour, energy, extra = {}) => ({
  id: `id-${hour}-${energy}`, date: '2026-10-21', hour, energy, recordedAt: `2026-10-21T${String(hour).padStart(2, '0')}:05:00.000Z`, ...extra,
});

test('tracks 15 hourly slots from 9 AM through 11 PM inclusive', () => {
  assert.deepEqual(HOURS, [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
});
test('accepts 11 PM events and rejects hours outside the window', () => {
  assert.equal(validEvent(ev(23, 'high')), true);
  assert.equal(validEvent(ev(8, 'high')), false);
  assert.equal(validEvent(ev(24, 'high')), false);
  assert.equal(validEvent(ev(12, 'medium')), false);
});
test('latest selection wins for a slot, ntfy ID breaking timestamp ties', () => {
  const slots = latestPerSlot([
    ev(10, 'low', { id: 'a', recordedAt: '2026-10-21T15:01:00.000Z' }),
    ev(10, 'high', { id: 'b', recordedAt: '2026-10-21T15:03:00.000Z' }),
    ev(10, 'avg', { id: 'c', recordedAt: '2026-10-21T15:02:00.000Z' }),
    ev(11, 'avg', { id: 'x', recordedAt: '2026-10-21T16:00:00.000Z' }),
    ev(11, 'low', { id: 'y', recordedAt: '2026-10-21T16:00:00.000Z' }),
  ]);
  assert.equal(slots.get('2026-10-21|10').energy, 'high');
  assert.equal(slots.get('2026-10-21|11').energy, 'low');
});
test('rounds a daily score to the nearest level', () => {
  assert.equal(levelFromScore(1), 'low');
  assert.equal(levelFromScore(1.49), 'low');
  assert.equal(levelFromScore(1.5), 'avg');
  assert.equal(levelFromScore(2.49), 'avg');
  assert.equal(levelFromScore(2.5), 'high');
  assert.equal(levelFromScore(3), 'high');
});
test('averages a day over answered hours only, null when unanswered', () => {
  const slots = latestPerSlot([ev(9, 'high'), ev(10, 'high'), ev(23, 'low')]);
  assert.deepEqual(dayAverage(slots, '2026-10-21'), { score: 7 / 3, level: 'avg', count: 3 });
  assert.equal(dayAverage(slots, '2026-10-20'), null);
});
test('lists recent dates newest first, across month boundaries', () => {
  assert.deepEqual(recentDates('2026-11-02', 4), ['2026-11-02', '2026-11-01', '2026-10-31', '2026-10-30']);
});
test('exports every event to CSV with quoted fields', () => {
  assert.equal(
    toCsv([{ id: 'a"b', date: '2026-10-21', hour: 23, energy: 'low', recordedAt: '2026-10-22T04:05:00.000Z' }]),
    '"date","hour","energy","recordedAt","id"\r\n"2026-10-21","23","low","2026-10-22T04:05:00.000Z","a""b"',
  );
});
