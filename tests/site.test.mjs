import test from 'node:test';
import assert from 'node:assert/strict';
import { HOURS, validEvent, validFlag, latestPerSlot, flagsPerSlot, flagAbbreviations, flagLabel, trendSeries, dayAverage, dayMode, levelFromScore, recentDates, toCsv } from '../site/lib.js';

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
const flag = (hour, name, id = `f-${hour}-${name}`) => ({
  id, date: '2026-10-21', hour, flag: name, recordedAt: `2026-10-21T${String(hour).padStart(2, '0')}:06:00.000Z`,
});
test('flags are validated separately from energy readings', () => {
  assert.equal(validFlag(flag(9, 'coffee')), true);
  assert.equal(validFlag(flag(9, 'Coffee')), false);
  assert.equal(validFlag(flag(8, 'coffee')), false);
  assert.equal(validFlag(ev(9, 'high')), false);
  assert.equal(validEvent(flag(9, 'coffee')), false);
});
test('collects every distinct flag tapped in an hour, ignoring repeat taps', () => {
  const slots = flagsPerSlot([flag(9, 'lam'), flag(9, 'coffee'), flag(9, 'lam', 'again'), flag(21, 'ris')]);
  assert.deepEqual(slots.get('2026-10-21|9'), ['coffee', 'lam']);
  assert.deepEqual(slots.get('2026-10-21|21'), ['ris']);
  assert.equal(slots.get('2026-10-21|10'), undefined);
});
test('abbreviates flags to their initial, lengthening only where initials collide', () => {
  assert.deepEqual(flagAbbreviations(['lam', 'coffee', 'ris']), { coffee: 'C', lam: 'L', ris: 'R' });
  assert.deepEqual(flagAbbreviations(['lam', 'lunch', 'coffee']), { coffee: 'C', lam: 'La', lunch: 'Lu' });
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
test('exports energy readings and flags to CSV with quoted fields', () => {
  assert.equal(
    toCsv([
      { id: 'a"b', date: '2026-10-21', hour: 23, energy: 'low', recordedAt: '2026-10-22T04:05:00.000Z' },
      { id: 'c', date: '2026-10-21', hour: 23, flag: 'ris', recordedAt: '2026-10-22T04:06:00.000Z' },
    ]),
    '"date","hour","energy","flag","recordedAt","id"\r\n' +
    '"2026-10-21","23","low","","2026-10-22T04:05:00.000Z","a""b"\r\n' +
    '"2026-10-21","23","","ris","2026-10-22T04:06:00.000Z","c"',
  );
});
test('flags read as something you ate', () => {
  assert.equal(flagLabel('lam'), 'ate LAM');
  assert.equal(flagLabel('coffee'), 'ate COFFEE');
});
test('the trend leaves out today, which is still incomplete, oldest day first', () => {
  const slots = latestPerSlot([
    ev(9, 'high', { date: '2026-10-19' }), ev(9, 'low', { date: '2026-10-21' }), ev(9, 'avg', { date: '2026-10-22' }),
  ]);
  assert.deepEqual(trendSeries(slots, ['2026-10-22', '2026-10-21', '2026-10-20', '2026-10-19'], '2026-10-22'), [
    { date: '2026-10-19', score: 3 }, { date: '2026-10-20', score: null }, { date: '2026-10-21', score: 1 },
  ]);
});
const modeOf = (...levels) => dayMode(latestPerSlot(levels.map((level, i) => ev(9 + i, level))), '2026-10-21')?.level;
test('a day is labelled with its most common level', () => {
  assert.equal(modeOf('high', 'high', 'low', 'avg'), 'high');
  assert.equal(modeOf('low', 'avg', 'low'), 'low');
  assert.equal(modeOf('avg'), 'avg');
});
test('a high/low tie is labelled avg', () => {
  assert.equal(modeOf('high', 'low'), 'avg');
  assert.equal(modeOf('high', 'high', 'low', 'low', 'avg'), 'avg');
});
test('a tie with avg goes to the other level', () => {
  assert.equal(modeOf('high', 'avg'), 'high');
  assert.equal(modeOf('avg', 'low', 'avg', 'low'), 'low');
});
test('a three-way tie is labelled avg', () => {
  assert.equal(modeOf('high', 'avg', 'low'), 'avg');
});
test('mode counts each level, null when unanswered', () => {
  const slots = latestPerSlot([ev(9, 'high'), ev(10, 'high'), ev(11, 'low')]);
  assert.deepEqual(dayMode(slots, '2026-10-21'), { level: 'high', counts: { high: 2, avg: 0, low: 1 }, count: 3 });
  assert.equal(dayMode(slots, '2026-10-20'), null);
});
