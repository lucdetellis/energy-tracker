import test from 'node:test';
import assert from 'node:assert/strict';
import { publicEvent } from '../scripts/build.mjs';

test('public site data keeps energy readings, dropping unknown fields', () => {
  assert.deepEqual(
    publicEvent({ id: 'a', date: '2026-10-21', hour: 9, energy: 'high', recordedAt: '2026-10-21T14:00:00.000Z', topic: 'secret' }),
    { id: 'a', date: '2026-10-21', hour: 9, energy: 'high', recordedAt: '2026-10-21T14:00:00.000Z' },
  );
});
test('public site data keeps flags', () => {
  assert.deepEqual(
    publicEvent({ id: 'b', date: '2026-10-21', hour: 9, flag: 'coffee', recordedAt: '2026-10-21T14:01:00.000Z' }),
    { id: 'b', date: '2026-10-21', hour: 9, flag: 'coffee', recordedAt: '2026-10-21T14:01:00.000Z' },
  );
});
