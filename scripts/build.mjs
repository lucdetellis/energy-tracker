/** Copies sanitized, versioned history into the statically served site. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicit field allowlist: no ntfy topic, HTTP URL, tokens or raw payloads.
// An event carries either `energy` or `flag`.
export const publicEvent = ({ id, date, hour, energy, flag, recordedAt }) => ({
  id,
  date,
  hour,
  ...(energy === undefined ? {} : { energy }),
  ...(flag === undefined ? {} : { flag }),
  recordedAt,
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = fileURLToPath(new URL('../data/events.json', import.meta.url));
  const destination = fileURLToPath(new URL('../site/data/events.json', import.meta.url));
  const events = JSON.parse(await readFile(source, 'utf8'));
  if (!Array.isArray(events)) throw new Error('Expected data/events.json to be an array');

  const publicEvents = events.map(publicEvent);
  await mkdir(fileURLToPath(new URL('../site/data/', import.meta.url)), { recursive: true });
  await writeFile(destination, `${JSON.stringify(publicEvents)}\n`, 'utf8');
  console.log(`Prepared GitHub Pages data (${publicEvents.length} events).`);
}
