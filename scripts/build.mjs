/** Copies sanitized, versioned history into the statically served site. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../data/events.json', import.meta.url));
const destination = fileURLToPath(new URL('../site/data/events.json', import.meta.url));
const events = JSON.parse(await readFile(source, 'utf8'));
if (!Array.isArray(events)) throw new Error('Expected data/events.json to be an array');

// Explicit field allowlist: no ntfy topic, HTTP URL, tokens or raw payloads.
const publicEvents = events.map(({ id, date, hour, energy, recordedAt }) => ({
  id,
  date,
  hour,
  energy,
  recordedAt,
}));
await mkdir(fileURLToPath(new URL('../site/data/', import.meta.url)), { recursive: true });
await writeFile(destination, `${JSON.stringify(publicEvents)}\n`, 'utf8');
console.log(`Prepared GitHub Pages data (${publicEvents.length} events).`);
