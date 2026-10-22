// A zero-build, read-only GitHub Pages client.
// The ntfy topic and GitHub Actions secret never reach this code.
import { ZONE, HOURS, LEVELS, validEvent, latestPerSlot, dayAverage, dayShift, recentDates, chicagoNow, toCsv } from './lib.js';

const PAGE_SIZE = 14;
const LEVEL_NAMES = { high: 'High', avg: 'Avg', low: 'Low' };
const BLOCK_STYLES = {
  high: 'bg-level-high',
  avg: 'bg-level-avg',
  low: 'bg-level-low',
  none: 'border border-neutral-300 dark:border-neutral-700',
  future: 'bg-neutral-100 dark:bg-neutral-800/60',
};
const $ = (id) => document.getElementById(id);
const state = { events: [], days: PAGE_SIZE, selected: null, updatedAt: null, demo: new URLSearchParams(location.search).get('demo') === '1' };

const shortHour = (hour) => `${hour % 12 || 12}${hour < 12 ? 'a' : 'p'}`;
const longHour = (hour) => `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;
const dayLabel = (day) => new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  .format(new Date(`${day}T12:00:00Z`));
const clockTime = (date) => new Intl.DateTimeFormat('en-US', { timeStyle: 'short', timeZone: ZONE }).format(date);

function el(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function levelTag(average) {
  if (!average) return el('span', 'text-xs text-neutral-400 dark:text-neutral-600', '—');
  const tag = el('span', 'inline-flex items-center gap-1.5 text-xs font-medium');
  tag.title = `${average.score.toFixed(2)} / 3 across ${average.count} check-in${average.count === 1 ? '' : 's'}`;
  tag.append(el('i', `h-2.5 w-2.5 rounded-[2px] bg-level-${average.level}`), LEVEL_NAMES[average.level]);
  return tag;
}

function slotStatus(snapshot, date, hour) {
  const event = snapshot.slots.get(`${date}|${hour}`);
  if (event) return { kind: event.energy, event };
  const future = date > snapshot.now.date || (date === snapshot.now.date && hour > snapshot.now.hour);
  return { kind: future ? 'future' : 'none' };
}

function blocks(snapshot, date, size) {
  const grid = el('div', `grid grid-cols-[repeat(15,minmax(0,1fr))] ${size === 'lg' ? 'gap-[3px]' : 'gap-[2px]'}`);
  for (const hour of HOURS) {
    const { kind } = slotStatus(snapshot, date, hour);
    const selected = state.selected?.date === date && state.selected?.hour === hour;
    const block = el('button', [
      'block w-full transition-transform active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
      size === 'lg' ? 'h-10 rounded-[3px]' : 'h-5 rounded-[2px]',
      BLOCK_STYLES[kind],
      selected ? 'ring-2 ring-neutral-900 ring-offset-1 ring-offset-white dark:ring-white dark:ring-offset-neutral-900' : '',
    ].join(' '));
    block.type = 'button';
    block.dataset.key = `${date}|${hour}`;
    block.setAttribute('aria-pressed', String(selected));
    block.setAttribute('aria-label', `${dayLabel(date)}, ${longHour(hour)}: ${LEVEL_NAMES[kind] ? `${LEVEL_NAMES[kind]} energy` : kind === 'future' ? 'upcoming' : 'no response'}`);
    block.addEventListener('click', () => {
      state.selected = selected ? null : { date, hour };
      render(block.dataset.key);
    });
    grid.append(block);
  }
  return grid;
}

function detailText(snapshot, { date, hour }) {
  const { kind, event } = slotStatus(snapshot, date, hour);
  if (!event) return `${longHour(hour)} · ${kind === 'future' ? 'Upcoming' : 'No response'}`;
  const taps = state.events.filter((e) => e.date === date && e.hour === hour).length;
  return `${longHour(hour)} · ${LEVEL_NAMES[kind]} · answered ${clockTime(new Date(event.recordedAt))}${taps > 1 ? ' (changed)' : ''}`;
}

function renderToday(snapshot) {
  const today = snapshot.now.date;
  $('today-date').textContent = dayLabel(today);
  $('today-average').replaceChildren(levelTag(dayAverage(snapshot.slots, today)));
  $('today-blocks').replaceChildren(...blocks(snapshot, today, 'lg').children);

  let detail;
  if (state.selected?.date === today) detail = detailText(snapshot, state.selected);
  else {
    const latest = [...HOURS].reverse().map((hour) => snapshot.slots.get(`${today}|${hour}`)).find(Boolean);
    detail = latest ? `Latest: ${LEVEL_NAMES[latest.energy]} at ${longHour(latest.hour)}`
      : snapshot.now.hour < HOURS[0] ? `First check-in at ${longHour(HOURS[0])}` : 'No check-ins yet today';
  }
  $('today-detail').textContent = detail;
}

function renderHistory(snapshot) {
  const rows = snapshot.dates.slice(1).map((date, index) => {
    const row = el('li', 'py-2');
    row.append(el('p', 'mb-1 text-xs text-neutral-500 dark:text-neutral-400', index === 0 ? `Yesterday · ${dayLabel(date)}` : dayLabel(date)));
    const line = el('div', 'grid grid-cols-[1fr_3rem] items-center gap-2');
    const tag = levelTag(dayAverage(snapshot.slots, date));
    tag.classList.add('justify-self-end');
    line.append(blocks(snapshot, date, 'sm'), tag);
    row.append(line);
    if (state.selected?.date === date) row.append(el('p', 'mt-1.5 text-xs text-neutral-700 dark:text-neutral-300', detailText(snapshot, state.selected)));
    return row;
  });
  $('history').replaceChildren(...rows);

  const earliest = state.events.reduce((min, e) => (e.date < min ? e.date : min), snapshot.now.date);
  $('show-more').hidden = snapshot.dates[snapshot.dates.length - 1] <= earliest;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderTrend(snapshot) {
  const root = $('trend-chart');
  const dates = [...snapshot.dates].reverse();
  const values = dates.map((date) => dayAverage(snapshot.slots, date)?.score ?? null);
  $('trend-range').textContent = `Last ${dates.length} days`;
  if (!values.some((value) => value !== null)) {
    root.replaceChildren(el('p', 'py-8 text-center text-sm', 'Shows up after your first check-in.'));
    return;
  }

  const width = Math.max(240, root.clientWidth), height = 140, left = 30, right = 4, top = 6, bottom = 20;
  const x = (i) => left + (i / Math.max(1, values.length - 1)) * (width - left - right);
  const y = (score) => top + ((3 - score) / 2) * (height - top - bottom);
  const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'block', role: 'img', 'aria-label': 'Daily average energy, low (1) to high (3)' });
  for (const [score, label] of [[3, 'High'], [2, 'Avg'], [1, 'Low']]) {
    chart.append(svg('line', { x1: left, x2: width - right, y1: y(score), y2: y(score), stroke: 'currentColor', 'stroke-opacity': 0.3, 'stroke-dasharray': '2 4' }));
    chart.append(svg('text', { x: 0, y: y(score) + 3.5, fill: 'currentColor', 'font-size': 10 }, label));
  }
  const line = svg('g', { class: 'text-neutral-700 dark:text-neutral-300' });
  let segment = [];
  const flush = () => {
    if (segment.length > 1) line.append(svg('path', { d: segment.map(([px, py], i) => `${i ? 'L' : 'M'}${px} ${py}`).join(''), fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    segment = [];
  };
  values.forEach((value, i) => (value === null ? flush() : segment.push([x(i), y(value)])));
  flush();
  values.forEach((value, i) => {
    if (value === null) return;
    const dot = svg('circle', { cx: x(i), cy: y(value), r: values.length > 45 ? 1.75 : 2.75, fill: 'currentColor' });
    dot.append(svg('title', {}, `${dayLabel(dates[i])}: ${value.toFixed(2)} / 3`));
    line.append(dot);
  });
  chart.append(line);
  chart.append(svg('text', { x: left, y: height - 4, fill: 'currentColor', 'font-size': 10 }, dayLabel(dates[0]).replace(/^\w+, /, '')));
  chart.append(svg('text', { x: width - right, y: height - 4, fill: 'currentColor', 'font-size': 10, 'text-anchor': 'end' }, 'Today'));
  root.replaceChildren(chart);
}

function renderSyncStatus() {
  const status = $('sync-status');
  if (state.demo) { status.textContent = 'Demo data'; return; }
  if (!state.updatedAt) return;
  const sameDay = chicagoNow(state.updatedAt).date === chicagoNow().date;
  status.textContent = `Updated ${sameDay ? '' : `${dayLabel(chicagoNow(state.updatedAt).date).replace(/^\w+, /, '')}, `}${clockTime(state.updatedAt)}`;
}

function render(focusKey) {
  const now = chicagoNow();
  const snapshot = { now, dates: recentDates(now.date, state.days), slots: latestPerSlot(state.events) };
  renderToday(snapshot);
  renderHistory(snapshot);
  renderTrend(snapshot);
  renderSyncStatus();
  if (focusKey) document.querySelector(`[data-key="${focusKey}"]`)?.focus();
}

function makeDemo() {
  const now = chicagoNow();
  const events = [];
  for (let d = 0; d < 45; d++) {
    const date = dayShift(now.date, -d);
    for (const hour of HOURS) {
      if ((d === 0 && hour > now.hour) || ((d * 7 + hour * 3) % 13) < 3) continue;
      const value = (d * 5 + hour * 11 + Math.floor(hour / 3)) % 8 + ((d * 3) % 5) - 2;
      events.push({ id: `demo-${date}-${hour}`, date, hour, energy: value < 2 ? 'low' : value < 6 ? 'avg' : 'high',
        recordedAt: new Date(Date.parse(`${date}T${String(hour).padStart(2, '0')}:07:00-05:00`)).toISOString() });
    }
  }
  return events;
}

async function refresh() {
  if (state.demo) {
    state.events = makeDemo();
    render();
    return;
  }
  try {
    const response = await fetch(`./data/events.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.json();
    if (!Array.isArray(raw)) throw new Error('unexpected data file');
    state.events = raw.filter(validEvent);
    const modified = Date.parse(response.headers.get('last-modified') ?? '');
    const latest = state.events.reduce((max, e) => (e.recordedAt > max ? e.recordedAt : max), '');
    state.updatedAt = !Number.isNaN(modified) ? new Date(modified) : latest ? new Date(latest) : null;
    $('load-error').hidden = true;
  } catch (error) {
    $('sync-status').textContent = 'Offline';
    $('load-error').textContent = `Couldn't load readings (${error.message}). Retrying every 5 minutes.`;
    $('load-error').hidden = false;
  }
  render();
}

function exportCsv() {
  const url = URL.createObjectURL(new Blob([toCsv(state.events)], { type: 'text/csv;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: 'energy-tracker.csv' });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

for (const axis of document.querySelectorAll('.hour-axis')) {
  axis.replaceChildren(...HOURS.map((hour) => el('span', 'whitespace-nowrap', hour % 3 === 0 ? shortHour(hour) : '')));
}
$('show-more').addEventListener('click', () => { state.days += PAGE_SIZE; render(); });
$('export-csv').addEventListener('click', exportCsv);
let resizeFrame;
addEventListener('resize', () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => render());
});
refresh();
if (!state.demo) setInterval(refresh, 5 * 60_000);
