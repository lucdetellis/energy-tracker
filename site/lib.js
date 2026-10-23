// Pure data helpers shared by the dashboard (app.js) and tests. No DOM access.

export const ZONE = 'America/Chicago';
export const HOURS = Array.from({ length: 15 }, (_, index) => index + 9);
export const LEVELS = { low: 1, avg: 2, high: 3 };

export function validEvent(e) {
  return Boolean(e) && typeof e.id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date) &&
    HOURS.includes(e.hour) && Object.prototype.hasOwnProperty.call(LEVELS, e.energy) &&
    typeof e.recordedAt === 'string' && !Number.isNaN(Date.parse(e.recordedAt));
}

// Flag names are open-ended (the sender's list may change); same shape as the collector accepts.
export function validFlag(e) {
  return Boolean(e) && typeof e.id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date) &&
    HOURS.includes(e.hour) && typeof e.flag === 'string' && /^[a-z][a-z0-9]{0,23}$/.test(e.flag) &&
    typeof e.recordedAt === 'string' && !Number.isNaN(Date.parse(e.recordedAt));
}

export function flagsPerSlot(flags) {
  const slots = new Map();
  for (const { date, hour, flag } of flags) {
    const key = `${date}|${hour}`;
    if (!slots.has(key)) slots.set(key, new Set());
    slots.get(key).add(flag);
  }
  return new Map([...slots].map(([key, names]) => [key, [...names].sort()]));
}

// Shortest prefix that tells each flag apart: lam/coffee/ris -> L/C/R.
export function flagAbbreviations(names) {
  const unique = [...new Set(names)].sort();
  return Object.fromEntries(unique.map((name) => {
    let length = 1;
    while (length < name.length && unique.some((other) => other !== name && other.startsWith(name.slice(0, length)))) length++;
    return [name, name[0].toUpperCase() + name.slice(1, length)];
  }));
}

// Deliberately goofy wording: lam -> "ate LAM".
export const flagLabel = (flag) => `ate ${flag.toUpperCase()}`;

export function latestPerSlot(events) {
  const slots = new Map();
  for (const event of events) {
    const key = `${event.date}|${event.hour}`;
    const previous = slots.get(key);
    // Most recent selection wins; ntfy message ID breaks timestamp ties.
    if (!previous || event.recordedAt > previous.recordedAt ||
       (event.recordedAt === previous.recordedAt && event.id > previous.id)) slots.set(key, event);
  }
  return slots;
}

export function levelFromScore(score) {
  return score < 1.5 ? 'low' : score < 2.5 ? 'avg' : 'high';
}

export function dayAverage(slots, date) {
  const answers = HOURS.map((hour) => slots.get(`${date}|${hour}`)).filter(Boolean);
  if (!answers.length) return null;
  const score = answers.reduce((sum, event) => sum + LEVELS[event.energy], 0) / answers.length;
  return { score, level: levelFromScore(score), count: answers.length };
}

// Daily scores for the trend chart, oldest first. Today is still in progress, so it's left out.
export function trendSeries(slots, dates, today) {
  return dates.filter((date) => date !== today).reverse()
    .map((date) => ({ date, score: dayAverage(slots, date)?.score ?? null }));
}

export function dayShift(day, offset) {
  const date = new Date(`${day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function recentDates(today, count) {
  return Array.from({ length: count }, (_, i) => dayShift(today, -i));
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});
export function chicagoNow(date = new Date()) {
  const parts = Object.fromEntries(partsFormatter.formatToParts(date).map(({ type, value }) => [type, value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

export function toCsv(events) {
  const rows = [['date', 'hour', 'energy', 'flag', 'recordedAt', 'id'],
    ...events.map(({ date, hour, energy = '', flag = '', recordedAt, id }) => [date, String(hour), energy, flag, recordedAt, id])];
  return rows.map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n');
}
