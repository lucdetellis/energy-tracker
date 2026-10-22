// A zero-dependency, read-only GitHub Pages client.
// The ntfy topic and GitHub Actions secret never reach this code.

const ZONE = 'America/Chicago';
const HOURS = Array.from({ length: 13 }, (_, index) => index + 9);
const LEVELS = { low: 1, avg: 2, high: 3 };
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});
const $ = (id) => document.getElementById(id);
const state = { events: [], days: 14, selected: null, demo: new URLSearchParams(location.search).get('demo') === '1' };

function chicagoParts(date = new Date()) {
  const parts = Object.fromEntries(dateFormatter.formatToParts(date).map(({ type, value }) => [type, value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}
function dayShift(day, offset) {
  const date = new Date(`${day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
function dayLabel(day) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${day}T12:00:00Z`));
}
function fullDay(day) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${day}T12:00:00Z`));
}
function hourLabel(hour) {
  return `${hour % 12 || 12}${hour < 12 ? 'am' : 'pm'}`;
}
function fullTime(iso) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: ZONE }).format(new Date(iso));
}
function validEvent(e) {
  return e && typeof e.id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date) &&
    Number.isInteger(e.hour) && e.hour >= 9 && e.hour <= 21 &&
    Object.hasOwn(LEVELS, e.energy) && typeof e.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(e.recordedAt));
}
function demoRecordedAt(day, hour) {
  // Use the same Chicago timezone as the actual tracker (including DST).
  const probe = new Date(`${day}T12:00:00.000Z`);
  const zoneName = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, timeZoneName: 'shortOffset' })
    .formatToParts(probe).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT-5';
  const offsetHours = Number(/^GMT([+-]\d+)$/.exec(zoneName)?.[1] ?? -5);
  const recordedAt = new Date(`${day}T00:10:00.000Z`);
  recordedAt.setUTCHours(hour - offsetHours);
  return recordedAt.toISOString();
}
function makeDemo() {
  const today = chicagoParts();
  const results = [];
  for (let d = 29; d >= 0; d--) {
    const date = dayShift(today.date, -d);
    for (const hour of HOURS) {
      if (d === 0 && hour > today.hour) continue;
      if (((d * 7 + hour * 3) % 13) < 3) continue;
      const value = ((d * 5 + hour * 11 + Math.floor(hour / 3)) % 8);
      const energy = value < 2 ? 'low' : value < 6 ? 'avg' : 'high';
      results.push({ id: `demo-${date}-${hour}`, date, hour, energy,
        recordedAt: demoRecordedAt(date, hour) });
    }
  }
  return results;
}
function datesInRange(n) {
  const today = chicagoParts().date;
  return Array.from({ length: n }, (_, i) => dayShift(today, i - n + 1));
}
function getSlots(events) {
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
function getSnapshot() {
  const dates = datesInRange(state.days);
  const slots = getSlots(state.events);
  const today = chicagoParts();
  let elapsed = 0;
  for (const day of dates) {
    if (day < today.date) elapsed += HOURS.length;
    else if (day === today.date) elapsed += Math.max(0, Math.min(21, today.hour) - 8);
  }
  const readings = dates.flatMap((day) => HOURS.map((hour) => slots.get(`${day}|${hour}`)).filter(Boolean));
  const totals = { low: 0, avg: 0, high: 0 };
  for (const event of readings) totals[event.energy]++;
  const typical = Object.entries(totals).sort((a, b) => b[1] - a[1] || LEVELS[b[0]] - LEVELS[a[0]])[0];
  return { dates, slots, readings, elapsed, totals, typical: typical?.[1] ? typical[0] : null, today };
}

function renderStats(snapshot) {
  $('stat-checkins').textContent = snapshot.readings.length.toLocaleString();
  $('stat-checkins-detail').textContent = `Recorded in the last ${state.days} days`;
  $('stat-rate').textContent = snapshot.elapsed ? `${Math.round(100 * snapshot.readings.length / snapshot.elapsed)}%` : '—';
  $('stat-typical').textContent = snapshot.typical ? snapshot.typical === 'avg' ? 'Average' :
    snapshot.typical[0].toUpperCase() + snapshot.typical.slice(1) : '—';
  $('stat-typical-detail').textContent = snapshot.typical ? `${snapshot.totals[snapshot.typical]} check-ins at this level` : 'No answers yet';
}
function node(tag, className, content) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (content !== undefined) el.textContent = content;
  return el;
}
function renderHeatmap(snapshot) {
  const root = $('heatmap');
  const frag = document.createDocumentFragment();
  frag.appendChild(node('span', 'heat-label', ''));
  for (const hour of HOURS) frag.appendChild(node('span', 'heat-hour', hourLabel(hour).replace('am','a').replace('pm','p')));
  for (const day of snapshot.dates) {
    frag.appendChild(node('span', 'heat-label', dayLabel(day)));
    for (const hour of HOURS) {
      const key = `${day}|${hour}`;
      const event = snapshot.slots.get(key);
      const future = day === snapshot.today.date && hour > snapshot.today.hour;
      const level = event?.energy ?? 'none';
      const cell = node('button', 'heat-cell');
      cell.type = 'button';
      cell.dataset.level = level;
      cell.setAttribute('role', 'gridcell');
      if (future) cell.classList.add('is-future');
      if (state.selected?.date === day && state.selected?.hour === hour) cell.classList.add('is-selected');
      const description = `${fullDay(day)}, ${hourLabel(hour)}: ${event ? `${level} energy` : future ? 'upcoming' : 'no response'}`;
      cell.setAttribute('aria-label', description);
      cell.title = description;
      cell.addEventListener('click', () => {
        state.selected = { date: day, hour };
        renderDetail(snapshot);
        root.querySelector('.is-selected')?.classList.remove('is-selected');
        cell.classList.add('is-selected');
      });
      frag.appendChild(cell);
    }
  }
  root.replaceChildren(frag);
}
function renderDetail(snapshot) {
  const root = $('slot-detail');
  const { selected } = state;
  if (!selected) {
    root.replaceChildren(node('p', 'detail-empty', 'Choose a square on the map to inspect that hour.'));
    return;
  }
  const event = snapshot.slots.get(`${selected.date}|${selected.hour}`);
  root.replaceChildren();
  root.appendChild(node('span', 'detail-date', fullDay(selected.date)));
  root.appendChild(node('p', 'detail-time', hourLabel(selected.hour)));
  if (event) {
    const pill = node('span', `energy-pill ${event.energy}`, event.energy === 'avg' ? 'Average energy' : `${event.energy[0].toUpperCase()}${event.energy.slice(1)} energy`);
    root.appendChild(pill);
    const corrections = state.events.filter((e) => e.date === selected.date && e.hour === selected.hour).length;
    root.appendChild(node('p', 'detail-meta', `Responded ${fullTime(event.recordedAt)}. ${corrections > 1 ? `${corrections} selections logged; latest shown.` : 'One selection logged.'}`));
  } else {
    root.appendChild(node('span', 'energy-pill', 'No response'));
    root.appendChild(node('p', 'detail-meta', 'No energy level was recorded for this hour.'));
  }
}
const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}, content = null) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  if (content !== null) el.textContent = content;
  return el;
}
function renderTrend(snapshot) {
  const root = $('trend-chart');
  root.replaceChildren();
  const values = snapshot.dates.map((date) => {
    const events = HOURS.map((hour) => snapshot.slots.get(`${date}|${hour}`)).filter(Boolean);
    return events.length ? events.reduce((sum, event) => sum + LEVELS[event.energy], 0) / events.length : null;
  });
  if (!values.some((value) => value !== null)) {
    root.appendChild(node('p', '', 'Your energy trend will appear after the first check-in.'));
    return;
  }

  const width = 680, height = 205, left = 52, right = 13, top = 18, bottom = 42;
  const x = (i) => left + (i / Math.max(1, values.length - 1)) * (width - left - right);
  const y = (score) => top + ((3 - score) / 2) * (height - top - bottom);
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Average daily energy levels from low (1) to high (3)' });
  for (const [score, label] of [[3, 'High'], [2, 'Avg'], [1, 'Low']]) {
    svg.appendChild(svgEl('line', { x1: left, y1: y(score), x2: width - right, y2: y(score), stroke: '#e7eee7', 'stroke-dasharray': '3 7' }));
    svg.appendChild(svgEl('text', { x: 0, y: y(score) + 4, fill: '#9baa9f', 'font-size': '12', 'font-family': 'system-ui' }, label));
  }
  let segment = [];
  function flush() {
    if (segment.length > 1) svg.appendChild(svgEl('path', { d: segment.map(([px, py], index) => `${index ? 'L' : 'M'} ${px} ${py}`).join(' '), stroke: '#629f84', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    segment = [];
  }
  values.forEach((value, i) => value === null ? flush() : segment.push([x(i), y(value)]));
  flush();
  values.forEach((value, i) => {
    if (value === null) return;
    const dot = svgEl('circle', { cx: x(i), cy: y(value), r: state.days > 30 ? 2.4 : 3.7, fill: '#629f84', stroke: '#fff', 'stroke-width': 1.4 });
    dot.appendChild(svgEl('title', {}, `${fullDay(snapshot.dates[i])}: ${value.toFixed(2)} / 3`));
    svg.appendChild(dot);
  });
  for (const i of [...new Set([0, Math.floor((values.length - 1) / 2), values.length - 1])]) {
    svg.appendChild(svgEl('text', { x: x(i), y: height - 8, fill: '#9baa9f', 'font-size': '11', 'font-family': 'system-ui', 'text-anchor': i === 0 ? 'start' : i === values.length - 1 ? 'end' : 'middle' }, dayLabel(snapshot.dates[i])));
  }
  root.appendChild(svg);
}
function render() {
  const snapshot = getSnapshot();
  renderStats(snapshot);
  renderHeatmap(snapshot);
  renderTrend(snapshot);
  renderDetail(snapshot);
}
function exportCsv() {
  const rows = [['date','hour','energy','recordedAt','id'], ...state.events
    .map(({ date, hour, energy, recordedAt, id }) => [date, String(hour), energy, recordedAt, id])];
  const csv = rows.map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const objectUrl = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = 'energy-tracker.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
async function refresh() {
  if (state.demo) {
    state.events = makeDemo();
    $('sync-status').textContent = 'Demo · sample data';
    render();
    return;
  }
  try {
    const response = await fetch(`./data/events.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.json();
    if (!Array.isArray(raw)) throw new Error('Unexpected data file');
    state.events = raw.filter(validEvent);
    $('load-error').hidden = true;
    $('sync-status').textContent = 'Archive connected';
    render();
  } catch (error) {
    $('sync-status').textContent = 'Sync unavailable';
    $('load-error').textContent = `Could not refresh archived readings (${error.message}). The dashboard will retry automatically.`;
    $('load-error').hidden = false;
    render();
  }
}
$('range-select').addEventListener('change', (event) => { state.days = Number(event.target.value); render(); });
$('export-csv').addEventListener('click', exportCsv);
refresh();
if (!state.demo) setInterval(refresh, 5 * 60_000);
