// Pure data helpers shared by the dashboard (app.js) and tests. No DOM access.

export const ZONE = 'America/Chicago';
export const HOURS = Array.from({ length: 15 }, (_, index) => index + 9);
export const LEVELS = { low: 1, avg: 2, high: 3 };

export function validEvent(e) {
  return Boolean(e) && typeof e.id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date) &&
    HOURS.includes(e.hour) && Object.prototype.hasOwnProperty.call(LEVELS, e.energy) &&
    typeof e.recordedAt === 'string' && !Number.isNaN(Date.parse(e.recordedAt));
}

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
  const rows = [['date', 'hour', 'energy', 'recordedAt', 'id'],
    ...events.map(({ date, hour, energy, recordedAt, id }) => [date, String(hour), energy, recordedAt, id])];
  return rows.map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n');
}
