/**
 * Polls the ntfy response topic, retaining only parsed and validated energy
 * readings and flags. The topic is read from an Actions secret; it is never published.
 *
 * Retention/recovery: we replay an 11-hour window, deduplicate by ntfy ID,
 * and save the full, growing history in Git. This is not an exact-once queue;
 * a long outage or an ntfy cache reset can still lose uncaptured responses.
 */
import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA_FILE = fileURLToPath(new URL('../data/events.json', import.meta.url));
const RESPONSE_PATTERN = /^(energy|flag)_(\d{4}-\d{2}-\d{2})_(\d{2})_([a-z][a-z0-9]{0,23})$/;
const ENERGY_LEVELS = new Set(['high', 'avg', 'low']);
const ID_PATTERN = /^[a-zA-Z0-9_-]{4,128}$/;
const TOPIC_PATTERN = /^[a-zA-Z0-9_-]{8,200}$/;
const CACHE_WINDOW = '11h';
const MAX_RESPONSE_BYTES = 2_000_000;

function validDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
}

export function parseNotification(notification) {
  if (!notification || notification.event !== 'message') return null;
  if (!ID_PATTERN.test(notification.id ?? '')) return null;
  if (typeof notification.message !== 'string') return null;
  const match = RESPONSE_PATTERN.exec(notification.message.trim());
  if (!match) return null;

  // Flag names are open-ended so the sender's flag list can change freely.
  const [, kind, date, hourText, answer] = match;
  const hour = Number(hourText);
  if (!validDate(date) || hour < 9 || hour > 23) return null;
  if (kind === 'energy' && !ENERGY_LEVELS.has(answer)) return null;
  if (!Number.isSafeInteger(notification.time) || notification.time <= 0) return null;
  const recordedAt = new Date(notification.time * 1000);
  if (Number.isNaN(recordedAt.valueOf())) return null;

  return {
    id: notification.id,
    date,
    hour,
    [kind]: answer,
    recordedAt: recordedAt.toISOString(),
  };
}

export function mergeEvents(existing, incoming) {
  if (!Array.isArray(existing)) throw new Error('data/events.json must contain an array');
  const byId = new Map();
  // Stored events take precedence if a repeat ID has conflicting content.
  for (const event of [...existing, ...incoming]) {
    if (!event || typeof event.id !== 'string') {
      throw new Error('Found malformed event in history');
    }
    if (!byId.has(event.id)) byId.set(event.id, event);
  }
  return [...byId.values()].sort((a, b) =>
    a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id),
  );
}

export async function fetchResponses(topic, fetchImpl = fetch) {
  if (!TOPIC_PATTERN.test(topic ?? '')) {
    throw new Error('NTFY_RESPONSE_TOPIC must be a topic name (at least 8 URL-safe characters), not a URL');
  }
  const url = new URL(`https://ntfy.sh/${encodeURIComponent(topic)}/json`);
  url.searchParams.set('poll', '1');
  url.searchParams.set('since', CACHE_WINDOW);

  const response = await fetchImpl(url, {
    headers: { Accept: 'application/x-ndjson' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`ntfy returned HTTP ${response.status}`);
  if (response.headers.get('x-messages-truncated') === '1') {
    throw new Error('ntfy response was truncated; unable to collect safely');
  }

  const body = await response.text();
  if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) {
    throw new Error('ntfy response was unexpectedly large');
  }

  const notifications = [];
  for (const raw of body.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('ntfy returned malformed newline-delimited JSON');
    }
    const event = parseNotification(parsed);
    if (event) notifications.push(event);
  }
  return notifications;
}

export async function collect({
  topic = process.env.NTFY_RESPONSE_TOPIC,
  filePath = DATA_FILE,
  fetchImpl = fetch,
} = {}) {
  if (!topic) throw new Error('Missing Actions secret NTFY_RESPONSE_TOPIC');
  const existing = JSON.parse(await readFile(filePath, 'utf8'));
  const incoming = await fetchResponses(topic, fetchImpl);
  const merged = mergeEvents(existing, incoming);
  const added = merged.length - existing.length;
  if (added > 0) {
    // Atomic replacement avoids leaving a partial JSON file behind.
    const temp = `${filePath}.tmp`;
    await writeFile(temp, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    await rename(temp, filePath);
  }
  return { added, total: merged.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { added, total } = await collect();
    console.log(`Energy responses: ${added} new; ${total} recorded total.`);
  } catch (error) {
    // Deliberately avoid outputting the topic or full subscription URL.
    console.error(`Collector failed: ${error.message}`);
    process.exitCode = 1;
  }
}
