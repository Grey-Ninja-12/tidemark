// Tidemark user interface. Reads and writes through store.js; sync.js keeps devices in step.
import * as store from './store.js';
import * as sync from './sync.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const el = {
  auth: $('#auth'), app: $('#app'), nav: $('#nav'), bar: $('#bar'), list: $('#list'),
  pane: $('#pane'), settings: $('#settings'), toast: $('#toast'), scrim: $('#scrim'),
};

const PREFS_KEY = 'tidemark.prefs';
const prefs = { view: 'active', sort: 'deadline', theme: 'system', category: null };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch { /* defaults */ }
const savePrefs = () => localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
const ui = { search: '', sel: null, draft: null, remAdd: null, cal: null, push: 'off', pushStep: null, pushError: null, colorFor: null, defaultsFor: null, installEvent: null, authMode: 'signin', forceAuth: false };

const VIEWS = { active: 'To do', today: 'Due today', started: 'Started', completed: 'Completed', notes: 'Notes' };
const STATUS = { todo: 'To do', started: 'Started', completed: 'Completed' };
const NEXT_STATUS = { todo: 'started', started: 'completed', completed: 'todo' };
const PRIORITY = ['None', 'Low', 'Medium', 'High'];
const REMINDERS = [[0, 'At the deadline'], [10, '10 minutes before'], [60, '1 hour before'], [1440, '1 day before'], [2880, '2 days before'], [10080, '1 week before']];
const COLORS = ['#0B6B78', '#2F7FB5', '#3D5AA8', '#7A4FA3', '#B04A9C', '#B8436B', '#B8322A', '#C2601A', '#A8690A', '#7D8A1E', '#4E7D2B', '#5A6E78'];
// A random colour that stays readable on both light and dark backgrounds.
function randomColor(not) {
  for (;;) {
    const h = Math.floor(Math.random() * 360), s = 0.5 + Math.random() * 0.2, l = 0.38 + Math.random() * 0.1;
    const f = (n) => { const k = (n + h / 30) % 12; const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(c * 255).toString(16).padStart(2, '0'); };
    const hex = `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
    if (hex !== not) return hex;
  }
}
const GROUPS = [['overdue', 'Overdue'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'Next 7 days'], ['later', 'Later'], ['none', 'No deadline']];

const ICON = {
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.21 4.82L10.58 1.90L13.42 1.90L13.79 4.82A7.4 7.4 0 0 1 15.81 5.66L18.14 3.85L20.15 5.86L18.34 8.19A7.4 7.4 0 0 1 19.18 10.21L22.10 10.58L22.10 13.42L19.18 13.79A7.4 7.4 0 0 1 18.34 15.81L20.15 18.14L18.14 20.15L15.81 18.34A7.4 7.4 0 0 1 13.79 19.18L13.42 22.10L10.58 22.10L10.21 19.18A7.4 7.4 0 0 1 8.19 18.34L5.86 20.15L3.85 18.14L5.66 15.81A7.4 7.4 0 0 1 4.82 13.79L1.90 13.42L1.90 10.58L4.82 10.21A7.4 7.4 0 0 1 5.66 8.19L3.85 5.86L5.86 3.85L8.19 5.66A7.4 7.4 0 0 1 10.21 4.82Z"/><circle cx="12" cy="12" r="3.2"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14.5" rx="1.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3H7l3-3-1-6zM12 13v7"/></svg>',
};

// ---------- dates ----------

const DAY = 864e5;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const dayDiff = (d) => Math.round((startOfDay(d) - startOfDay(new Date())) / DAY);
const fmtTime = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const fmtWeekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const fmtDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const fmtDateYear = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtNow = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const shortDate = (d) => (new Date(d).getFullYear() === new Date().getFullYear() ? fmtDate : fmtDateYear).format(new Date(d));

const isOverdue = (t) => Boolean(t.due_at) && t.status !== 'completed' && new Date(t.due_at) < new Date();
function bucket(t) {
  if (!t.due_at) return 'none';
  if (isOverdue(t)) return 'overdue';
  const n = dayDiff(t.due_at);
  return n <= 0 ? 'today' : n === 1 ? 'tomorrow' : n <= 7 ? 'week' : 'later';
}
function dueLabel(t) {
  const d = new Date(t.due_at);
  const n = dayDiff(d);
  const time = t.due_all_day ? '' : ', ' + fmtTime.format(d);
  if (isOverdue(t)) {
    const ms = Date.now() - d;
    if (t.due_all_day || ms >= DAY) {
      const days = Math.max(1, t.due_all_day ? -n : Math.floor(ms / DAY));
      return days === 1 ? '1 day overdue' : `${days} days overdue`;
    }
    const h = Math.floor(ms / 36e5);
    return h >= 1 ? `${h} h overdue` : `${Math.max(1, Math.floor(ms / 6e4))} min overdue`;
  }
  if (n === 0) return 'Today' + time;
  if (n === 1) return 'Tomorrow' + time;
  if (n > 1 && n <= 7) return fmtWeekday.format(d) + time;
  return shortDate(d) + time;
}
function dueClass(t) {
  if (t.status === 'completed') return '';
  if (isOverdue(t)) return 'overdue';
  return new Date(t.due_at) - Date.now() < DAY ? 'soon' : '';
}

function setDue(t, dateStr, timeStr) {
  if (!dateStr) { t.due_at = null; t.due_all_day = true; }
  else if (timeStr) { t.due_at = new Date(`${dateStr}T${timeStr}`).toISOString(); t.due_all_day = false; }
  else { t.due_at = new Date(`${dateStr}T23:59:59`).toISOString(); t.due_all_day = true; }
}

// "1 hour before", "3 days before", "At the deadline"
const UNITS = [[10080, 'week'], [1440, 'day'], [60, 'hour'], [1, 'minute']];
function offsetLabel(minutes) {
  const preset = REMINDERS.find(([v]) => v === minutes);
  if (preset) return preset[1];
  const [size, unit] = UNITS.find(([u]) => minutes % u === 0);
  const n = minutes / size;
  return `${n} ${unit}${n === 1 ? '' : 's'} before`;
}
const reminderLabel = (r) => (r.at ? `${fmtFullDate.format(new Date(r.at))} at ${fmtTime.format(new Date(r.at))}` : offsetLabel(r.minutes));
function addReminder(t, r) {
  const list = t.reminders || [];
  const same = r.at ? list.some((x) => x.at && Date.parse(x.at) === Date.parse(r.at)) : list.some((x) => !x.at && x.minutes === r.minutes);
  if (same) return false;
  t.reminders = [...list, { id: store.uid(), ...r }];
  return true;
}
// ---------- category defaults ----------

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // menus list Monday first
const clockLabel = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return fmtTime.format(new Date(2000, 0, 1, h, m)); };

// The deadline a category gives a task created now, as [date, time] for setDue(), or null.
function categoryDue(c, now = new Date()) {
  const d = new Date(now);
  if (c.def_due_kind === 'days' && c.def_due_days != null) {
    d.setDate(d.getDate() + c.def_due_days);
  } else if (c.def_due_kind === 'weekday' && c.def_due_weekday != null) {
    let add = (c.def_due_weekday - d.getDay() + 7) % 7;
    if (add === 0 && c.def_due_time) { // today is that weekday: use today only if the time is still ahead
      const [h, m] = c.def_due_time.split(':').map(Number);
      if (h * 60 + m <= now.getHours() * 60 + now.getMinutes()) add = 7;
    }
    d.setDate(d.getDate() + add);
  } else return null;
  return [localDate(d), c.def_due_time || ''];
}

// Several categories combine: the highest priority, the earliest deadline, and all their reminders.
function combinedDefaults(ids) {
  let priority = 0, due = null, stamp = Infinity;
  const reminders = [];
  for (const c of (ids || []).map(category).filter(Boolean)) {
    priority = Math.max(priority, c.def_priority || 0);
    const d = categoryDue(c);
    const at = d && new Date(`${d[0]}T${d[1] || '23:59:59'}`).getTime();
    if (d && at < stamp) { due = d; stamp = at; }
    for (const m of c.def_reminders || []) if (!reminders.includes(m)) reminders.push(m);
  }
  return { priority, due, reminders };
}

// Gives a task the defaults of these categories for every setting it doesn't have yet,
// and adds their reminders. Returns what was filled in.
function applyCategoryDefaults(t, ids) {
  const d = combinedDefaults(ids);
  const filled = { priority: false, deadline: false, reminders: [] };
  if (d.priority && !t.priority) { t.priority = d.priority; filled.priority = true; }
  if (d.due && !t.due_at) { setDue(t, ...d.due); filled.deadline = true; }
  t.reminders ??= [];
  for (const minutes of d.reminders) {
    if (addReminder(t, { minutes })) filled.reminders.push(t.reminders[t.reminders.length - 1].id);
  }
  return filled;
}
function filledText(f) {
  const parts = [];
  if (f.priority) parts.push('priority');
  if (f.deadline) parts.push('deadline');
  if (f.reminders.length) parts.push(f.reminders.length === 1 ? '1 reminder' : `${f.reminders.length} reminders`);
  return parts.join(', ');
}
// In the new-task form, settings that came from categories are swapped when the categories change,
// unless the user has changed them by hand since.
function touched(t, what) { if (t._auto) t._auto[what] = false; }
function swapDraftCategory(t) {
  const auto = t._auto || { reminders: [] };
  if (auto.priority) t.priority = 0;
  if (auto.deadline) setDue(t, '', '');
  t.reminders = (t.reminders || []).filter((r) => !auto.reminders.includes(r.id));
  t._auto = applyCategoryDefaults(t, t.category_ids);
}

function defaultsSummary(c) {
  const parts = [];
  if (c.def_priority) parts.push(`${PRIORITY[c.def_priority].toLowerCase()} priority`);
  const at = c.def_due_time ? ` at ${clockLabel(c.def_due_time)}` : '';
  if (c.def_due_kind === 'days' && c.def_due_days != null) {
    parts.push(`due ${c.def_due_days === 0 ? 'the same day' : c.def_due_days === 1 ? '1 day later' : `${c.def_due_days} days later`}${at}`);
  }
  if (c.def_due_kind === 'weekday' && c.def_due_weekday != null) parts.push(`due the next ${WEEKDAYS[c.def_due_weekday]}${at}`);
  const rems = [...(c.def_reminders || [])].sort((a, b) => b - a).map((m) => offsetLabel(m).toLowerCase());
  if (rems.length) parts.push(`${rems.length === 1 ? 'reminder' : 'reminders'} ${rems.join(' and ')}`);
  return parts.length ? `New tasks: ${parts.join(', ')}.` : '';
}

// ---------- calendar (weeks start on Monday) ----------

const fmtFullDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtMonth = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const fmtDayName = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const fmtDayLong = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const MONDAY_FIRST = Array.from({ length: 7 }, (_, i) => fmtDayName.format(new Date(2026, 10, 16 + i))); // 16 Nov 2026 is a Monday

const calSelected = (t, target) => (target === 'remind' ? ui.remAdd?.date || '' : t.due_at ? localDate(new Date(t.due_at)) : '');
const calOpen = (t, target) => ui.cal?.id === t.id && ui.cal.target === target;
function calendarHtml(selectedDay) {
  const { y, m } = ui.cal;
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7; // days shown from the previous month, counting from Monday
  const today = localDate(new Date());
  const tomorrow = localDate(new Date(Date.now() + DAY));
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(y, m, 1 - lead + i);
    const v = localDate(d);
    cells += `<button type="button" data-act="cal-day" data-value="${v}" class="${d.getMonth() !== m ? 'other' : ''}${v === today ? ' today' : ''}" aria-pressed="${v === selectedDay}" aria-label="${esc(fmtDayLong.format(d))}">${d.getDate()}</button>`;
  }
  return `
    <div class="cal" role="group" aria-label="Choose a date">
      <div class="cal-head">
        <button type="button" class="icon small" data-act="cal-move" data-value="-1" aria-label="Previous month">${ICON.prev}</button>
        <span>${esc(fmtMonth.format(first))}</span>
        <button type="button" class="icon small" data-act="cal-move" data-value="1" aria-label="Next month">${ICON.next}</button>
      </div>
      <div class="cal-grid">${MONDAY_FIRST.map((n) => `<span>${esc(n)}</span>`).join('')}${cells}</div>
      <div class="cal-foot">
        <button type="button" class="btn small" data-act="cal-day" data-value="${today}">Today</button>
        <button type="button" class="btn small" data-act="cal-day" data-value="${tomorrow}">Tomorrow</button>
      </div>
    </div>`;
}
function renderCalendar() {
  const t = selected();
  if (!t) return;
  for (const box of el.pane.querySelectorAll('[data-cal]')) {
    const target = box.dataset.cal;
    box.innerHTML = calOpen(t, target) ? calendarHtml(calSelected(t, target)) : '';
    $(`[data-act="pick-date"][data-target="${target}"]`, el.pane)?.setAttribute('aria-expanded', calOpen(t, target));
  }
  const due = $('[data-date-label="due"]', el.pane);
  if (due) due.textContent = t.due_at ? fmtFullDate.format(new Date(t.due_at)) : 'Choose a date';
  const rem = $('[data-date-label="remind"]', el.pane);
  if (rem) rem.textContent = ui.remAdd?.date ? fmtFullDate.format(new Date(`${ui.remAdd.date}T12:00`)) : 'Choose a date';
}
function closeCalendar() { if (ui.cal) { ui.cal = null; renderCalendar(); } }

function setStatus(t, status) {
  t.status = status;
  const now = store.nowIso();
  if (status === 'todo') { t.started_at = null; t.completed_at = null; }
  if (status === 'started') { t.started_at ??= now; t.completed_at = null; }
  if (status === 'completed') t.completed_at = now;
}

// ---------- data for the current view ----------

const category = (id) => { const c = id && store.get('categories', id); return c && !c.deleted ? c : null; };
const matches = (text) => !ui.search || text.toLowerCase().includes(ui.search.toLowerCase());

function visibleTasks() {
  let rows = store.list('tasks');
  if (prefs.view === 'completed') rows = rows.filter((t) => t.status === 'completed');
  else rows = rows.filter((t) => t.status !== 'completed');
  if (prefs.view === 'today') rows = rows.filter((t) => ['overdue', 'today'].includes(bucket(t)));
  if (prefs.view === 'started') rows = rows.filter((t) => t.status === 'started');
  if (prefs.category) rows = rows.filter((t) => t.category_ids.includes(prefs.category));
  rows = rows.filter((t) => matches(`${t.title}\n${t.notes}\n${(t.subtasks || []).map((s) => s.title).join('\n')}`));

  const due = (t) => (t.due_at ? Date.parse(t.due_at) : Infinity);
  const created = (t) => Date.parse(t.created_at);
  if (prefs.view === 'completed') return rows.sort((a, b) => Date.parse(b.completed_at || b.updated_at) - Date.parse(a.completed_at || a.updated_at));
  if (prefs.sort === 'priority') return rows.sort((a, b) => b.priority - a.priority || due(a) - due(b) || created(a) - created(b));
  if (prefs.sort === 'newest') return rows.sort((a, b) => created(b) - created(a));
  return rows.sort((a, b) => due(a) - due(b) || b.priority - a.priority || created(a) - created(b));
}

function visibleNotes() {
  let rows = store.list('notes');
  if (prefs.category) rows = rows.filter((n) => n.category_ids.includes(prefs.category));
  rows = rows.filter((n) => matches(`${n.title}\n${n.body}`));
  return rows.sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.updated_at) - Date.parse(a.updated_at));
}

// ---------- navigation ----------

function syncLabel() {
  const n = store.pendingCount();
  switch (sync.status.state) {
    case 'local': return ['local', 'This device only'];
    case 'offline': return ['offline', n ? `Offline, ${n} to upload` : 'Offline'];
    case 'syncing': return ['busy', 'Syncing'];
    case 'error': return ['error', 'Sync problem'];
    case 'signedout': return ['error', 'Signed out'];
    case 'synced': return n ? ['busy', `${n} to upload`] : ['ok', 'Synced'];
    default: return ['busy', 'Connecting'];
  }
}

function renderNav() {
  const draft = $('.nav-add input', el.nav);
  const keep = draft ? { value: draft.value, focus: document.activeElement === draft } : null;

  const tasks = store.list('tasks');
  const open = tasks.filter((t) => t.status !== 'completed');
  const counts = {
    active: open.length,
    today: open.filter((t) => ['overdue', 'today'].includes(bucket(t))).length,
    started: open.filter((t) => t.status === 'started').length,
    completed: tasks.length - open.length,
    notes: store.list('notes').length,
  };
  const cats = store.list('categories').sort((a, b) => a.name.localeCompare(b.name));
  const [dot, label] = syncLabel();

  el.nav.innerHTML = `
    <div class="nav-brand"><img src="icons/icon-192.png" alt="" width="28" height="28">Tidemark</div>
    <ul class="nav-list">
      ${Object.entries(VIEWS).map(([key, name]) => `
        <li${key === 'notes' ? ' class="nav-gap"' : ''}><button class="nav-item" data-view="${key}" ${prefs.view === key ? 'aria-current="page"' : ''}>
          <span>${name}</span><span class="count">${counts[key] || ''}</span></button></li>`).join('')}
    </ul>
    <h2 class="nav-head">Categories</h2>
    <ul class="nav-list">
      <li><button class="nav-item" data-cat="" aria-pressed="${!prefs.category}"><span>All</span></button></li>
      ${cats.map((c) => `
        <li><button class="nav-item" data-cat="${c.id}" aria-pressed="${prefs.category === c.id}">
          <span><i class="dot" style="background:${esc(c.color)}"></i>${esc(c.name)}</span></button></li>`).join('')}
    </ul>
    <form class="nav-add" data-form="add-category">
      <input name="name" placeholder="New category" aria-label="New category name" maxlength="40" autocomplete="off">
      <button class="icon" aria-label="Add category">${ICON.plus}</button>
    </form>
    <div class="nav-foot">
      <button class="sync-chip" data-act="settings" title="${esc(sync.status.error || label)}"><i class="sync-dot ${dot}"></i>${esc(label)}</button>
      <button class="icon" data-act="settings" aria-label="Settings">${ICON.gear}</button>
    </div>`;

  if (keep) {
    const input = $('.nav-add input', el.nav);
    input.value = keep.value;
    if (keep.focus) input.focus();
  }
}

function setNavOpen(open) {
  scheduleGuard();
  el.nav.classList.toggle('open', open);
  el.scrim.hidden = !open;
}

function renderBar() {
  const notes = prefs.view === 'notes';
  const cat = category(prefs.category);
  el.bar.innerHTML = `
    <div class="bar-top">
      <button class="icon menu" data-act="menu" aria-label="Open menu">${ICON.menu}</button>
      <h1 class="view-title">${VIEWS[prefs.view]}${cat ? `<span class="view-cat"><i class="dot" style="background:${esc(cat.color)}"></i>${esc(cat.name)}</span>` : ''}</h1>
    </div>
    <div class="bar-tools">
      ${notes ? `<button class="btn primary" data-act="new-note">New note</button>`
        : prefs.view === 'completed' ? ''
        : `<form class="quick" data-form="quick-add">
             <input name="title" placeholder="Add a task" aria-label="Add a task" autocomplete="off" maxlength="300" enterkeyhint="done">
             <button class="btn primary">Add</button>
             <button type="button" class="btn" data-act="new-task-details">Add with details</button>
           </form>`}
      <label class="search">${ICON.search}<input type="search" data-input="search" placeholder="Search" aria-label="Search" value="${esc(ui.search)}"></label>
      ${notes || prefs.view === 'completed' ? '' : `
        <label class="sort"><span class="sr">Sort by</span>
          <select data-input="sort">
            ${[['deadline', 'By deadline'], ['priority', 'By priority'], ['newest', 'Newest first']].map(([v, l]) => `<option value="${v}" ${prefs.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select></label>`}
    </div>`;
}

// ---------- lists ----------

const categoriesOf = (row) => (row.category_ids || []).map(category).filter(Boolean);
const catTags = (row) => categoriesOf(row).map((c) => `<span class="cat"><i class="dot" style="background:${esc(c.color)}"></i>${esc(c.name)}</span>`).join('');

function taskRow(t) {
  const subs = t.subtasks || [];
  const done = subs.filter((s) => s.done).length;
  const next = STATUS[NEXT_STATUS[t.status]].toLowerCase();
  const selected = ui.sel?.kind === 'tasks' && ui.sel.id === t.id;
  return `
    <li class="task${selected ? ' selected' : ''}" data-id="${t.id}" data-status="${t.status}">
      <button class="status" data-act="cycle" title="${STATUS[t.status]}. Click to mark as ${next}." aria-label="${esc(t.title || 'Untitled task')}: ${STATUS[t.status]}. Mark as ${next}."></button>
      <button class="task-open" data-act="open">
        <span class="task-title">${t.title ? esc(t.title) : '<em>Untitled task</em>'}</span>
        <span class="task-meta">
          ${t.due_at ? `<span class="due ${dueClass(t)}">${esc(dueLabel(t))}</span>` : ''}
          ${t.status === 'started' ? '<span class="tag-started">Started</span>' : ''}
          ${t.priority ? `<span class="pri pri-${t.priority}" title="${PRIORITY[t.priority]} priority"><i></i><i></i><i></i><span>${PRIORITY[t.priority]}</span></span>` : ''}
          ${catTags(t)}
          ${subs.length ? `<span>${done}/${subs.length} steps</span>` : ''}
        </span>
      </button>
    </li>`;
}

const nowLine = () => `<li class="now-line" aria-label="Current time"><span>Now</span><time>${esc(fmtNow.format(new Date()))}</time></li>`;

function emptyState() {
  if (ui.search) return `Nothing matches “${esc(ui.search)}”.`;
  const cat = category(prefs.category);
  const inCat = cat ? ` in ${esc(cat.name)}` : '';
  return {
    active: `No open tasks${inCat}. Type one in the box above and press Enter.`,
    today: `Nothing is due today${inCat}.`,
    started: `No tasks in progress${inCat}. Click the circle next to a task once to mark it started.`,
    completed: `No completed tasks${inCat} yet. Click a task's circle twice to finish it.`,
    notes: `No notes${inCat} yet. Choose “New note” to write one.`,
  }[prefs.view];
}

function renderTasks() {
  const rows = visibleTasks();
  if (!rows.length) { el.list.innerHTML = `<p class="empty">${emptyState()}</p>`; return; }
  const grouped = prefs.sort === 'deadline' && prefs.view !== 'completed';
  if (!grouped) { el.list.innerHTML = `<ul class="tasks">${rows.map(taskRow).join('')}</ul>`; return; }

  const by = Object.fromEntries(GROUPS.map(([k]) => [k, []]));
  rows.forEach((t) => by[bucket(t)].push(t));
  let html = '';
  for (const [key, title] of GROUPS) {
    if (by[key].length) {
      html += `<li class="group group-${key}"><h2>${title}<span class="count">${by[key].length}</span></h2><ul class="tasks">${by[key].map(taskRow).join('')}</ul></li>`;
    }
    if (key === 'overdue') html += nowLine(); // the tide mark: everything above it is late
  }
  el.list.innerHTML = `<ul class="groups">${html}</ul>`;
}

function renderNotes() {
  const rows = visibleNotes();
  if (!rows.length) { el.list.innerHTML = `<p class="empty">${emptyState()}</p>`; return; }
  el.list.innerHTML = `<ul class="notes">${rows.map((n) => {
    const selected = ui.sel?.kind === 'notes' && ui.sel.id === n.id;
    return `
      <li class="note${selected ? ' selected' : ''}" data-id="${n.id}">
        <button class="note-open" data-act="open-note">
          <span class="note-title">${n.pinned ? `<span class="pinned" title="Pinned">${ICON.pin}</span>` : ''}${n.title ? esc(n.title) : '<em>Untitled note</em>'}</span>
          <span class="note-body">${esc(n.body.slice(0, 220))}</span>
          <span class="task-meta"><span>Edited ${esc(shortDate(n.updated_at))}</span>${catTags(n)}</span>
        </button>
      </li>`;
  }).join('')}</ul>`;
}

const renderList = () => (prefs.view === 'notes' ? renderNotes() : renderTasks());

// ---------- detail pane ----------

const selected = () => (ui.sel?.draft ? ui.draft : ui.sel ? store.get(ui.sel.kind, ui.sel.id) : null);
const isDraft = (row) => Boolean(row) && row === ui.draft;
// Saves an edit made in the detail pane. A task that has not been created yet only lives in ui.draft.
function commit(kind, row) { if (!isDraft(row)) store.save(kind, row); }
function categoryChips(row) {
  const cats = store.list('categories').sort((a, b) => a.name.localeCompare(b.name));
  if (!cats.length) return '<span class="hint">No categories yet. Add one from the menu.</span>';
  return cats.map((c) => `<button type="button" class="chip" data-act="toggle-cat" data-value="${c.id}" aria-pressed="${row.category_ids.includes(c.id)}"><i class="dot" style="background:${esc(c.color)}"></i>${esc(c.name)}</button>`).join('');
}

function reminderAddArea(t) {
  const mode = ui.remAdd?.id === t.id ? ui.remAdd.mode : null;
  return `
    <select data-field="rem-add" aria-label="Add a reminder"></select>
    ${mode === 'custom' ? `
    <div class="rem-new">
      <input type="number" inputmode="numeric" min="1" max="999" step="1" value="${ui.remAdd.amount ?? 3}" data-field="rem-amount" aria-label="How many">
      <select data-field="rem-unit" aria-label="Unit">
        ${[['1', 'minutes'], ['60', 'hours'], ['1440', 'days'], ['10080', 'weeks']].map(([v, l]) => `<option value="${v}" ${String(ui.remAdd.unit ?? 60) === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <span>before the deadline</span>
      <button type="button" class="btn small primary" data-act="rem-add-custom">Add</button>
      <button type="button" class="link" data-act="rem-cancel">Cancel</button>
    </div>` : ''}
    ${mode === 'exact' ? `
    <div class="rem-new">
      <button type="button" class="date-btn" data-act="pick-date" data-target="remind" aria-expanded="${calOpen(t, 'remind')}">${ICON.calendar}<span data-date-label="remind">${esc(fmtFullDate.format(new Date(`${ui.remAdd.date}T12:00`)))}</span></button>
      <input type="time" data-field="rem-time" aria-label="Reminder time" value="${esc(ui.remAdd.time || '09:00')}">
      <button type="button" class="btn small primary" data-act="rem-add-exact">Add</button>
      <button type="button" class="link" data-act="rem-cancel">Cancel</button>
    </div>
    <div data-cal="remind">${calOpen(t, 'remind') ? calendarHtml(calSelected(t, 'remind')) : ''}</div>` : ''}`;
}

// The list of reminders, the "Add a reminder" menu and the hint below them.
function renderReminders(t) {
  const times = store.remindTimes(t);
  const whenOf = (r) => {
    if (r.at) return new Date(r.at);
    if (!t.due_at) return null;
    const base = new Date(t.due_at);
    if (t.due_all_day) base.setHours(9, 0, 0, 0);
    return new Date(base.getTime() - r.minutes * 60000);
  };
  const rows = (t.reminders || []).map((r) => ({ r, when: whenOf(r) }))
    .sort((a, b) => (a.when ? a.when.getTime() : Infinity) - (b.when ? b.when.getTime() : Infinity));
  $('[data-rems]', el.pane).innerHTML = rows.map(({ r, when }) => {
    const note = !when ? 'needs a deadline' : when < new Date() ? 'passed' : r.at ? '' : `${dayDiff(when) === 0 ? 'today' : shortDate(when)} at ${fmtTime.format(when)}`;
    return `<li class="rem${when && when < new Date() ? ' past' : ''}"><span>${esc(reminderLabel(r))}</span>${note ? `<span class="rem-when">${esc(note)}</span>` : ''}<button type="button" class="icon small" data-act="rem-remove" data-value="${r.id}" aria-label="Remove reminder ${esc(reminderLabel(r))}">${ICON.close}</button></li>`;
  }).join('');

  const has = (m) => (t.reminders || []).some((r) => !r.at && r.minutes === m);
  $('[data-field="rem-add"]', el.pane).innerHTML = `
    <option value="">${t.reminders?.length ? 'Add another reminder…' : 'Add a reminder…'}</option>
    <optgroup label="Before the deadline">
      ${REMINDERS.map(([v, l]) => `<option value="${v}" ${has(v) ? 'disabled' : ''}>${l}</option>`).join('')}
      <option value="custom">Other amount…</option>
    </optgroup>
    <option value="exact">At a date and time…</option>`;

  let hint = '';
  if (t.reminders?.length) {
    if (ui.push !== 'on') hint = 'Notifications are off on this device. Turn them on in Settings.';
    else if (t.status === 'completed') hint = 'Completed tasks do not send reminders.';
    else if (times.length && t.due_all_day && t.reminders.some((r) => !r.at)) hint = 'Deadlines without a time count from 09:00.';
  }
  $('[data-hint="remind"]', el.pane).textContent = hint;
}

let pendingSave = null;
const saveTimer = debounce(() => flushSave(), 350);
function saveSoon(kind, id) {
  if (ui.draft && id === ui.draft.id) return;
  if (pendingSave && pendingSave.id !== id) flushSave();
  pendingSave = { kind, id };
  saveTimer();
}
function flushSave() {
  if (!pendingSave) return;
  const { kind, id } = pendingSave;
  pendingSave = null;
  const row = store.get(kind, id);
  if (row) store.save(kind, row);
}

function open(kind, id) {
  if (ui.sel?.draft) discardDraft();
  flushSave();
  ui.sel = { kind, id };
  renderPane();
  renderList();
}
// The "Add with details" form: a task that is only saved when "Create task" is pressed.
function startDraft(fields) {
  if (ui.sel?.draft) discardDraft(false);
  flushSave();
  ui.draft = { ...store.DEFAULTS.tasks(), id: store.uid(), created_at: store.nowIso(), deleted: false, ...fields };
  ui.draft._auto = applyCategoryDefaults(ui.draft, ui.draft.category_ids);
  ui.sel = { kind: 'tasks', id: ui.draft.id, draft: true };
  renderPane(); renderList();
  const title = $('.title-input', el.pane);
  if (!ui.draft.title) title?.focus();
}
function createDraft() {
  const d = ui.draft;
  if (!d) return;
  if (!d.title.trim()) {
    $('.title-input', el.pane)?.focus();
    toast('Give the task a title first.');
    return;
  }
  ui.draft = null; ui.sel = null;
  const { _auto, ...fields } = d;
  store.create('tasks', { ...fields, created_at: store.nowIso() });
  renderPane(); renderList();
  toast('Task created.');
}
function discardDraft(offerUndo = true) {
  const d = ui.draft;
  ui.draft = null; ui.sel = null;
  renderPane(); renderList();
  const hasContent = d && (d.title.trim() || d.notes.trim() || d.subtasks.length || d.due_at || d.reminders.length);
  if (offerUndo && hasContent) {
    toast('New task discarded.', { label: 'Undo', run: () => { ui.draft = d; ui.sel = { kind: 'tasks', id: d.id, draft: true }; renderPane(); } });
  }
}

function closePane() {
  if (ui.sel?.draft) { discardDraft(); return; }
  flushSave();
  const row = selected();
  // An item opened and left completely blank was a false start: don't keep it.
  if (row && !row.deleted) {
    const blank = ui.sel.kind === 'tasks' ? !row.title.trim() && !row.notes.trim() && !(row.subtasks || []).length
      : !row.title.trim() && !row.body.trim();
    if (blank) store.remove(ui.sel.kind, row.id);
  }
  ui.sel = null;
  renderPane();
  renderList();
}

// Redraws part of the screen without losing the scroll position or the focused control,
// so the view doesn't jump back to the top after each click.
function focusKey(root) {
  const a = document.activeElement;
  if (!a || a === root || !root.contains(a)) return null;
  const own = ['data-act', 'data-value', 'data-cat-def', 'data-field', 'data-cat-name', 'data-input']
    .filter((n) => a.hasAttribute(n)).map((n) => `[${n}="${CSS.escape(a.getAttribute(n))}"]`).join('');
  if (!own) return null;
  const cat = a.closest('[data-cat-id]');
  return (cat ? `[data-cat-id="${CSS.escape(cat.dataset.catId)}"] ` : '') + own;
}
function redraw(root, scroller, html) {
  const box = root.querySelector(scroller);
  const top = box ? box.scrollTop : 0;
  const key = focusKey(root);
  root.innerHTML = html;
  const nb = root.querySelector(scroller);
  if (nb) nb.scrollTop = top;
  if (key) root.querySelector(key)?.focus({ preventScroll: true });
}

function renderPane() {
  const row = selected();
  if (!row || row.deleted) { ui.sel = null; el.pane.hidden = true; el.pane.innerHTML = ''; delete el.pane.dataset.row; return; }
  el.pane.hidden = false;
  const html = ui.sel.kind === 'tasks' ? taskPane(row) : notePane(row);
  if (el.pane.dataset.row === row.id) redraw(el.pane, '.pane-body', html);   // same item: keep place
  else el.pane.innerHTML = html;                                            // another item: start at the top
  el.pane.dataset.row = row.id;
  el.pane.querySelectorAll('textarea[data-grow]').forEach(grow);
  if (ui.sel.kind === 'tasks') paneState(row);
  scheduleGuard();
}

const paneHead = (what, draft = false) => `
  <div class="pane-head">
    <button class="icon" data-act="close" aria-label="${draft ? 'Discard new task' : 'Close'}">${ICON.back}</button>
    <span class="pane-kind">${what}</span>
    ${draft ? '' : `<button class="icon danger" data-act="delete" aria-label="Delete ${what.toLowerCase()}" title="Delete">${ICON.trash}</button>`}
  </div>`;

function taskPane(t) {
  const d = t.due_at ? new Date(t.due_at) : null;
  const draft = isDraft(t);
  return `
    ${paneHead(draft ? 'New task' : 'Task', draft)}
    <div class="pane-body">
      <textarea class="title-input" data-field="title" data-grow rows="1" placeholder="Task title" aria-label="Task title" maxlength="300">${esc(t.title)}</textarea>

      <div class="seg" role="group" aria-label="Status">
        ${Object.entries(STATUS).map(([k, l]) => `<button data-act="status" data-value="${k}">${l}</button>`).join('')}
      </div>

      <div class="field"><span class="label" id="lbl-pri">Priority</span>
        <div class="seg small" role="group" aria-labelledby="lbl-pri">
          ${PRIORITY.map((l, i) => `<button data-act="priority" data-value="${i}">${l}</button>`).join('')}
        </div>
      </div>

      <div class="field"><span class="label">Deadline</span>
        <div class="row">
          <button type="button" class="date-btn" data-act="pick-date" data-target="due" aria-expanded="${calOpen(t, 'due')}">${ICON.calendar}<span data-date-label="due">${d ? esc(fmtFullDate.format(d)) : 'Choose a date'}</span></button>
          <input type="hidden" data-field="due-date" value="${d ? localDate(d) : ''}">
          <input type="time" data-field="due-time" aria-label="Deadline time (optional)" value="${d && !t.due_all_day ? localTime(d) : ''}">
          <button class="link" data-act="clear-due">Clear</button>
        </div>
        <div data-cal="due">${calOpen(t, 'due') ? calendarHtml(calSelected(t, 'due')) : ''}</div>
      </div>

      <div class="field"><span class="label">Reminders</span>
        <ul class="rems" data-rems></ul>
        <div class="rem-add">${reminderAddArea(t)}</div>
        <span class="hint" data-hint="remind"></span>
      </div>

      <div class="field"><span class="label">Categories</span>
        <div class="chips">${categoryChips(t)}</div>
      </div>

      <div class="field"><span class="label">Steps</span>
        <ul class="subs"></ul>
        <form class="sub-add" data-form="add-sub">
          <input name="title" placeholder="Add a step" aria-label="Add a step" autocomplete="off" maxlength="200">
        </form>
      </div>

      <label class="field"><span class="label">Notes</span>
        <textarea data-field="notes" data-grow rows="4" placeholder="Details, links, anything you need for this task">${esc(t.notes)}</textarea>
      </label>

      <p class="stamps" data-stamps></p>
    </div>
    ${draft ? `<div class="pane-foot">
      <button class="btn" data-act="close">Discard</button>
      <button class="btn primary" data-act="create-draft">Create task</button>
    </div>` : ''}`;
}

// Updates the parts of the task pane that depend on other fields, without rebuilding the
// inputs (rebuilding would steal focus while typing).
function paneState(t) {
  el.pane.querySelectorAll('[data-act="status"]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.value === t.status));
  el.pane.querySelectorAll('[data-act="priority"]').forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.value) === t.priority));
  const hasDue = Boolean(t.due_at);
  $('[data-field="due-time"]', el.pane).disabled = !hasDue;
  $('[data-act="clear-due"]', el.pane).hidden = !hasDue;
  renderReminders(t);

  if (isDraft(t)) { $('[data-stamps]', el.pane).textContent = 'Nothing is saved until you choose “Create task”.'; renderSubs(t); return; }
  const stamps = [`Created ${shortDate(t.created_at)}`];
  if (t.started_at) stamps.push(`started ${shortDate(t.started_at)}`);
  if (t.completed_at) stamps.push(`completed ${shortDate(t.completed_at)}`);
  $('[data-stamps]', el.pane).textContent = stamps.join(', ') + '.';
  renderSubs(t);
}

function renderSubs(t) {
  const ul = $('.subs', el.pane);
  if (document.activeElement?.matches?.('.sub input[type="text"]')) return; // typing in a step: leave the list alone
  ul.innerHTML = (t.subtasks || []).map((s) => `
    <li class="sub${s.done ? ' done' : ''}" data-sub="${s.id}">
      <input type="checkbox" data-sub-field="done" ${s.done ? 'checked' : ''} aria-label="Done: ${esc(s.title)}">
      <input type="text" data-sub-field="title" value="${esc(s.title)}" aria-label="Step" maxlength="200">
      <button class="icon small" data-act="remove-sub" aria-label="Remove step">${ICON.close}</button>
    </li>`).join('');
}

function notePane(n) {
  return `
    ${paneHead('Note')}
    <div class="pane-body note-pane">
      <textarea class="title-input" data-field="title" data-grow rows="1" placeholder="Note title" aria-label="Note title" maxlength="300">${esc(n.title)}</textarea>
      <div class="row note-tools">
        <div class="chips grow" role="group" aria-label="Categories">${categoryChips(n)}</div>
        <button class="btn" data-act="pin" aria-pressed="${n.pinned}">${ICON.pin}<span>${n.pinned ? 'Pinned' : 'Pin'}</span></button>
      </div>
      <textarea class="note-input" data-field="body" placeholder="Write your note" aria-label="Note text">${esc(n.body)}</textarea>
    </div>`;
}

function grow(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; }

// ---------- toast ----------

let toastTimer;
function toast(message, action) {
  clearTimeout(toastTimer);
  el.toast.innerHTML = `<span>${esc(message)}</span>${action ? `<button class="link">${esc(action.label)}</button>` : ''}`;
  el.toast.hidden = false;
  if (action) $('button', el.toast).onclick = () => { action.run(); el.toast.hidden = true; };
  toastTimer = setTimeout(() => (el.toast.hidden = true), action ? 7000 : 4000);
}

// ---------- settings ----------

function applyTheme() {
  const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('meta[name="theme-color"]').content = dark ? '#0E1A21' : '#0B6B78';
}

async function openSettings() {
  ui.push = await sync.pushState().catch(() => 'off');
  renderSettings();
  if (!el.settings.open) el.settings.showModal();
  scheduleGuard();
}

function renderSettings() {
  const s = sync.status;
  const n = store.pendingCount();
  const remembered = sync.rememberedUser();
  const account = !sync.configured
    ? `<p>Sync is not set up, so everything stays on this device. Follow README.md to connect a free Supabase project, then your tasks and notes appear on every device you sign in on.</p>`
    : sync.user
      ? `<p>Signed in as <strong>${esc(sync.user.email)}</strong>.</p>
         <p class="hint">${s.state === 'error' ? esc(s.error) : s.state === 'offline' ? 'You are offline. Changes are saved here and upload when you reconnect.' : n ? `${n} change${n === 1 ? '' : 's'} waiting to upload.` : s.lastSync ? `Last synced at ${fmtTime.format(s.lastSync)}.` : ''}</p>
         <div class="row"><button class="btn" data-act="sync-now">Sync now</button><button class="btn" data-act="sign-out">Sign out</button></div>`
      : `<p>${remembered ? `Signed out. Your data for ${esc(remembered.email)} is still on this device and will sync after you sign in again.` : 'Not signed in.'}</p>
         <div class="row"><button class="btn primary" data-act="sign-in-again">Sign in</button></div>`;

  const pushText = {
    unsupported: 'This browser cannot show push notifications.',
    unconfigured: 'Reminders need sync to be set up first (see README.md).',
    blocked: 'Notifications are blocked for this app. Allow them in the browser or system settings, then come back.',
    off: 'Get a notification on this device when a reminder is due, even if Tidemark is closed.',
    on: 'Reminders are on for this device.',
  }[ui.push];
  const pushButtons = ui.pushStep ? `<button class="btn primary" disabled>${esc(ui.pushStep)}</button>`
    : ui.push === 'off' ? `<button class="btn primary" data-act="push-on" ${sync.user ? '' : 'disabled'}>Turn on reminders</button>`
    : ui.push === 'on' ? `<button class="btn" data-act="push-test">Send a test reminder</button><button class="btn" data-act="push-off">Turn off</button>` : '';

  const cats = store.list('categories').sort((a, b) => a.name.localeCompare(b.name));

  redraw(el.settings, '.dialog-body', `
    <div class="dialog-head"><h2 id="settings-title">Settings</h2><button class="icon" data-act="close-settings" aria-label="Close settings">${ICON.close}</button></div>
    <div class="dialog-body">
      <section><h3>Account and sync</h3>${account}</section>
      <section><h3>Reminders</h3><p>${pushText}</p><div class="row">${pushButtons}</div>${ui.pushError ? `<p class="error-text" role="alert">${esc(ui.pushError)}</p>` : ''}</section>
      <section><h3>Categories</h3>
        ${cats.length ? `<p class="hint">Click a colour dot to change it. Use “Defaults” to give new tasks in a category a priority, deadline and reminder.</p><ul class="cat-edit">${cats.map((c) => `
          <li data-cat-id="${c.id}">
            <div class="cat-row">
              <button class="swatch" data-act="cat-color" style="background:${esc(c.color)}" aria-expanded="${ui.colorFor === c.id}" aria-label="Choose colour for ${esc(c.name)}" title="Choose colour"></button>
              <input type="text" data-cat-name value="${esc(c.name)}" aria-label="Category name" maxlength="40">
              <button class="btn small" data-act="cat-defaults" aria-expanded="${ui.defaultsFor === c.id}">Defaults</button>
              <button class="icon small danger" data-act="cat-delete" aria-label="Delete category ${esc(c.name)}">${ICON.trash}</button>
            </div>
            ${ui.defaultsFor === c.id ? defaultsPanel(c) : defaultsSummary(c) ? `<p class="hint cat-summary">${esc(defaultsSummary(c))}</p>` : ''}
            ${ui.colorFor === c.id ? `
            <div class="palette" role="group" aria-label="Colour for ${esc(c.name)}">
              ${COLORS.map((col) => `<button class="swatch small" data-act="cat-set-color" data-value="${col}" style="background:${col}" aria-pressed="${col.toUpperCase() === c.color.toUpperCase()}" aria-label="Colour ${col}"></button>`).join('')}
              <label class="btn small">Custom<input type="color" data-cat-custom value="${esc(c.color)}" class="sr"></label>
              <button class="btn small" data-act="cat-random">Random</button>
            </div>` : ''}
          </li>`).join('')}</ul>` : '<p class="hint">No categories yet. Add one from the menu.</p>'}
      </section>
      <section><h3>Appearance</h3>
        <div class="seg small" role="group" aria-label="Theme">
          ${[['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button data-act="theme" data-value="${v}" aria-pressed="${prefs.theme === v}">${l}</button>`).join('')}
        </div>
      </section>
      <section><h3>Backup</h3>
        <p class="hint">Save everything to a file, or load a file you saved earlier.</p>
        <div class="row"><button class="btn" data-act="export">Save backup file</button><label class="btn">Load backup file<input type="file" accept="application/json,.json" data-input="import" hidden></label></div>
      </section>
      ${ui.installEvent ? `<section><h3>Install</h3><p class="hint">Add Tidemark to this device so it opens in its own window.</p><div class="row"><button class="btn primary" data-act="install">Install Tidemark</button></div></section>` : ''}
    </div>`);
}

function defaultsPanel(c) {
  const kind = c.def_due_kind || '';
  return `
    <div class="cat-defaults" role="group" aria-label="Defaults for ${esc(c.name)}">
      <p class="hint">New tasks in ${esc(c.name)} start with these. A task moved into ${esc(c.name)} gets the ones it doesn't have yet; nothing you set yourself is replaced.</p>
      <div class="field"><span class="label" id="dp-${c.id}">Priority</span>
        <div class="seg small" role="group" aria-labelledby="dp-${c.id}">
          ${PRIORITY.map((l, i) => `<button data-act="cat-def-priority" data-value="${i}" aria-pressed="${(c.def_priority || 0) === i}">${l}</button>`).join('')}
        </div>
      </div>
      <label class="field"><span class="label">Deadline</span>
        <select data-cat-def="kind">
          <option value="" ${kind === '' ? 'selected' : ''}>No default deadline</option>
          <option value="days" ${kind === 'days' ? 'selected' : ''}>A number of days after the task is made</option>
          <option value="weekday" ${kind === 'weekday' ? 'selected' : ''}>The next chosen day of the week</option>
        </select>
      </label>
      ${kind === 'days' ? `
      <label class="field"><span class="label">Days after the task is made (0 = the same day)</span>
        <input type="number" inputmode="numeric" min="0" max="365" step="1" data-cat-def="days" value="${c.def_due_days ?? 1}">
      </label>` : ''}
      ${kind === 'weekday' ? `
      <label class="field"><span class="label">Day of the week</span>
        <select data-cat-def="weekday">${WEEK_ORDER.map((d) => `<option value="${d}" ${c.def_due_weekday === d ? 'selected' : ''}>${WEEKDAYS[d]}</option>`).join('')}</select>
      </label>` : ''}
      ${kind ? `
      <div class="field"><span class="label">Time (optional)</span>
        <div class="row"><input type="time" data-cat-def="time" aria-label="Deadline time" value="${esc(c.def_due_time || '')}">${c.def_due_time ? '<button class="link" data-act="cat-def-no-time">No time</button>' : ''}</div>
      </div>` : ''}
      <div class="field"><span class="label">Reminders (before the deadline; choose any number)</span>
        <div class="chips">
          ${[...new Set([...REMINDERS.map(([v]) => v), ...(c.def_reminders || [])])].sort((a, b) => a - b)
            .map((m) => `<button type="button" class="chip" data-act="cat-def-rem" data-value="${m}" aria-pressed="${(c.def_reminders || []).includes(m)}">${esc(offsetLabel(m))}</button>`).join('')}
        </div>
        <div class="rem-new">
          <input type="number" inputmode="numeric" min="1" max="999" step="1" value="3" data-cat-def="rem-amount" aria-label="How many">
          <select data-cat-def="rem-unit" aria-label="Unit">
            ${[['1', 'minutes'], ['60', 'hours'], ['1440', 'days'], ['10080', 'weeks']].map(([v, l]) => `<option value="${v}" ${v === '60' ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          <span>before</span>
          <button type="button" class="btn small" data-act="cat-def-rem-add">Add</button>
        </div>
      </div>
      ${defaultsSummary(c) ? `<p class="hint">${esc(defaultsSummary(c))}</p>` : ''}
    </div>`;
}

// Background refresh of an open settings dialog, skipped while a name is being typed in it.
function refreshSettings() {
  if (el.settings.open && !document.activeElement?.matches?.('#settings input, #settings select')) renderSettings();
}

// ---------- sign-in screen ----------

function showScreen() {
  const signedIn = !sync.configured || sync.user || (sync.rememberedUser() && !ui.forceAuth);
  el.auth.hidden = Boolean(signedIn);
  el.app.hidden = !signedIn;
  if (!signedIn) setAuthMode(ui.authMode);
}

function setAuthMode(mode) {
  ui.authMode = mode;
  const text = {
    signin: ['Sign in to see your tasks and notes on this device.', 'Sign in'],
    signup: ['Create your account. Use the same email and password on every device.', 'Create account'],
    reset: ['Enter your email and we will send a link to set a new password.', 'Send reset link'],
    newpass: ['Choose a new password.', 'Save new password'],
  }[mode];
  $('#auth-lead').textContent = text[0];
  $('#auth-submit').textContent = text[1];
  $('#auth-email-field').hidden = mode === 'newpass';
  $('#auth-password-field').hidden = mode === 'reset';
  $('#auth-password-label').textContent = mode === 'newpass' ? 'New password' : mode === 'signup' ? 'Password (8 characters or more)' : 'Password';
  $('#auth-password').autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
  $('[data-auth="signup"]').hidden = mode !== 'signin';
  $('[data-auth="reset"]').hidden = mode !== 'signin';
  $('[data-auth="signin"]').hidden = mode === 'signin' || mode === 'newpass';
  $('[data-auth="back"]').hidden = !(ui.forceAuth && sync.rememberedUser());
  $('#auth-msg').textContent = '';
}

async function submitAuth(e) {
  e.preventDefault();
  const email = $('#auth-email').value.trim();
  const password = $('#auth-password').value;
  const msg = $('#auth-msg');
  const button = $('#auth-submit');
  msg.className = 'auth-msg';
  if (ui.authMode !== 'newpass' && !/^\S+@\S+\.\S+$/.test(email)) { msg.textContent = 'Enter your email address.'; return; }
  if (ui.authMode !== 'reset' && password.length < 8 && ui.authMode !== 'signin') { msg.textContent = 'Use a password with at least 8 characters.'; return; }
  if (ui.authMode === 'signin' && !password) { msg.textContent = 'Enter your password.'; return; }
  button.disabled = true;
  try {
    if (ui.authMode === 'signin') await sync.signIn(email, password);
    else if (ui.authMode === 'signup') {
      const { needsConfirmation } = await sync.signUp(email, password);
      if (needsConfirmation) { setAuthMode('signin'); msg.className = 'auth-msg ok'; msg.textContent = 'Account created. Open the confirmation email we sent, then sign in here.'; }
    } else if (ui.authMode === 'reset') {
      await sync.sendPasswordReset(email);
      msg.className = 'auth-msg ok'; msg.textContent = 'Reset link sent. Open it on this device.';
    } else {
      await sync.setPassword(password);
      ui.forceAuth = false; ui.authMode = 'signin';
      showScreen(); toast('Password saved.');
    }
    $('#auth-password').value = '';
  } catch (err) {
    const m = err?.message || String(err);
    msg.textContent = /Invalid login credentials/i.test(m) ? 'That email and password do not match an account.'
      : /Email not confirmed/i.test(m) ? 'Confirm your email first: open the link in the email we sent.'
      : /Failed to fetch|NetworkError/i.test(m) ? 'Could not reach the server. Check your connection. If the app has been unused for a week, the Supabase project may be paused.'
      : m;
  } finally { button.disabled = false; }
}

// ---------- events ----------

function renderAll() { renderNav(); renderBar(); renderList(); renderPane(); }

function setView(view) {
  rememberView(view, prefs.category);
  if (ui.sel?.draft && view === 'notes') discardDraft();
  flushSave();
  prefs.view = view; savePrefs();
  if (ui.sel && (ui.sel.kind === 'notes') !== (view === 'notes')) ui.sel = null;
  setNavOpen(false);
  renderAll();
}

const ACTIONS = {
  menu: () => setNavOpen(true),
  settings: () => { setNavOpen(false); openSettings(); },
  'close-settings': () => el.settings.close(),
  close: () => closePane(),

  open: (b) => open('tasks', b.closest('[data-id]').dataset.id),
  'open-note': (b) => open('notes', b.closest('[data-id]').dataset.id),
  'new-task-details': () => {
    const input = $('.quick input');
    const fields = { title: input?.value.trim() || '', category_ids: prefs.category ? [prefs.category] : [] };
    if (prefs.view === 'today') setDue(fields, localDate(new Date()), '');
    if (prefs.view === 'started') setStatus(fields, 'started');
    if (input) input.value = '';
    startDraft(fields);
  },
  'create-draft': () => createDraft(),
  'new-note': () => {
    const n = store.create('notes', { category_ids: prefs.category ? [prefs.category] : [] });
    open('notes', n.id);
    $('.title-input', el.pane)?.focus();
  },

  cycle: (b) => {
    const t = store.get('tasks', b.closest('[data-id]').dataset.id);
    const before = t.status;
    setStatus(t, NEXT_STATUS[before]);
    store.save('tasks', t);
    if (t.status === 'completed') toast('Completed.', { label: 'Undo', run: () => { setStatus(t, before); store.save('tasks', t); } });
  },
  status: (b) => { const t = selected(); setStatus(t, b.dataset.value); commit('tasks', t); paneState(t); },
  priority: (b) => { const t = selected(); touched(t, 'priority'); t.priority = Number(b.dataset.value); commit('tasks', t); paneState(t); },
  'clear-due': () => {
    const t = selected(); touched(t, 'deadline'); setDue(t, '', '');
    $('[data-field="due-date"]', el.pane).value = ''; $('[data-field="due-time"]', el.pane).value = '';
    ui.cal = null;
    commit('tasks', t); paneState(t); renderCalendar();
  },
  'toggle-cat': (b) => {
    const row = selected();
    const kind = ui.sel.kind;
    const id = b.dataset.value;
    const adding = !row.category_ids.includes(id);
    row.category_ids = adding ? [...row.category_ids, id] : row.category_ids.filter((x) => x !== id);
    if (kind === 'tasks' && isDraft(row)) { swapDraftCategory(row); renderPane(); return; }
    let filled = null;
    if (kind === 'tasks' && adding) filled = filledText(applyCategoryDefaults(row, [id]));
    commit(kind, row);
    renderPane();
    if (filled) toast(`Added from ${category(id).name}: ${filled}.`);
  },
  'rem-remove': (b) => {
    const t = selected();
    t.reminders = t.reminders.filter((r) => r.id !== b.dataset.value);
    commit('tasks', t); renderReminders(t);
  },
  'rem-cancel': () => { ui.remAdd = null; ui.cal = null; renderPane(); },
  'rem-add-custom': () => {
    const t = selected();
    const n = Math.round(Number($('[data-field="rem-amount"]', el.pane).value));
    const unit = Number($('[data-field="rem-unit"]', el.pane).value);
    if (!Number.isFinite(n) || n < 1) { toast('Enter how long before the deadline, for example 3.'); return; }
    const minutes = Math.min(n * unit, 366 * 1440);
    if (!addReminder(t, { minutes })) { toast('That reminder is already there.'); return; }
    ui.remAdd = null;
    commit('tasks', t); renderPane();
  },
  'rem-add-exact': () => {
    const t = selected();
    const time = $('[data-field="rem-time"]', el.pane).value || '09:00';
    const at = new Date(`${ui.remAdd.date}T${time}`);
    if (at < new Date()) { toast('That time has already passed. Choose a later one.'); return; }
    if (!addReminder(t, { at: at.toISOString() })) { toast('That reminder is already there.'); return; }
    ui.remAdd = null; ui.cal = null;
    commit('tasks', t); renderPane();
  },
  'pick-date': (b) => {
    const t = selected();
    const target = b.dataset.target || 'due';
    if (calOpen(t, target)) { closeCalendar(); return; }
    const from = calSelected(t, target);
    const d = from ? new Date(`${from}T12:00`) : new Date();
    ui.cal = { id: t.id, target, y: d.getFullYear(), m: d.getMonth() };
    renderCalendar();
  },
  'cal-move': (b) => {
    const d = new Date(ui.cal.y, ui.cal.m + Number(b.dataset.value), 1);
    ui.cal.y = d.getFullYear(); ui.cal.m = d.getMonth();
    renderCalendar();
    $(`[data-act="cal-move"][data-value="${b.dataset.value}"]`, el.pane)?.focus();
  },
  'cal-day': (b) => {
    const t = selected();
    if (b.closest('[data-cal]')?.dataset.cal === 'remind') {
      ui.remAdd.date = b.dataset.value;
      ui.cal = null; renderCalendar();
      $('[data-act="pick-date"][data-target="remind"]', el.pane)?.focus();
      return;
    }
    $('[data-field="due-date"]', el.pane).value = b.dataset.value;
    touched(t, 'deadline');
    setDue(t, b.dataset.value, $('[data-field="due-time"]', el.pane).value);
    ui.cal = null;
    commit('tasks', t); paneState(t); renderCalendar();
    $('[data-act="pick-date"][data-target="due"]', el.pane)?.focus();
  },
  'remove-sub': (b) => {
    const t = selected(); const id = b.closest('.sub').dataset.sub;
    t.subtasks = t.subtasks.filter((s) => s.id !== id);
    commit('tasks', t); renderSubs(t);
  },
  pin: () => { const n = selected(); n.pinned = !n.pinned; store.save('notes', n); renderPane(); },
  delete: () => {
    const { kind, id } = ui.sel;
    pendingSave = null;
    store.remove(kind, id);
    ui.sel = null; renderPane(); renderList();
    toast(kind === 'tasks' ? 'Task deleted.' : 'Note deleted.', { label: 'Undo', run: () => store.restore(kind, id) });
  },

  theme: (b) => { prefs.theme = b.dataset.value; savePrefs(); applyTheme(); renderSettings(); },
  'sync-now': async () => { await sync.sync(); renderSettings(); },
  'sign-out': async () => {
    const n = store.pendingCount();
    if (n && !confirm(`${n} change${n === 1 ? ' has' : 's have'} not been uploaded yet and will be lost if you sign out now. Sign out anyway?`)) return;
    el.settings.close();
    await sync.signOut();
  },
  'sign-in-again': () => { el.settings.close(); ui.forceAuth = true; ui.authMode = 'signin'; showScreen(); },
  'push-on': async () => {
    if (ui.pushStep) return;
    ui.pushError = null;
    ui.pushStep = 'Starting…'; renderSettings();
    try {
      await sync.enablePush((step) => { ui.pushStep = step; renderSettings(); });
      toast('Reminders are on for this device.');
    } catch (e) { ui.pushError = e?.message || String(e); }
    ui.pushStep = null;
    openSettings();
  },
  'push-off': async () => {
    try { await sync.disablePush(); } catch (e) { toast(e.message); }
    openSettings();
  },
  'push-test': async () => {
    try {
      const r = await sync.sendTestPush();
      toast(r?.sent ? `Test sent to ${r.sent} device${r.sent === 1 ? '' : 's'}. It should appear within a few seconds.`
        : r?.devices ? 'The push service refused the test. Check that the VAPID keys in config.js and in the function secrets belong together; the function log in Supabase shows the reason.'
        : 'The server found no devices with reminders turned on.');
    } catch (e) { toast('Test failed: ' + e.message); }
  },
  'cat-color': (b) => {
    const id = b.closest('[data-cat-id]').dataset.catId;
    ui.colorFor = ui.colorFor === id ? null : id;
    renderSettings();
  },
  'cat-defaults': (b) => {
    const id = b.closest('[data-cat-id]').dataset.catId;
    ui.defaultsFor = ui.defaultsFor === id ? null : id;
    renderSettings();
  },
  'cat-def-priority': (b) => {
    const c = store.get('categories', b.closest('[data-cat-id]').dataset.catId);
    c.def_priority = Number(b.dataset.value) || null; store.save('categories', c); renderSettings();
  },
  'cat-def-rem': (b) => {
    const c = store.get('categories', b.closest('[data-cat-id]').dataset.catId);
    const m = Number(b.dataset.value);
    const list = c.def_reminders || [];
    c.def_reminders = list.includes(m) ? list.filter((x) => x !== m) : [...list, m];
    store.save('categories', c); renderSettings();
  },
  'cat-def-rem-add': (b) => {
    const li = b.closest('[data-cat-id]');
    const c = store.get('categories', li.dataset.catId);
    const n = Math.round(Number($('[data-cat-def="rem-amount"]', li).value));
    if (!Number.isFinite(n) || n < 1) { toast('Enter how long before the deadline, for example 3.'); return; }
    const m = Math.min(n * Number($('[data-cat-def="rem-unit"]', li).value), 366 * 1440);
    if (!(c.def_reminders || []).includes(m)) c.def_reminders = [...(c.def_reminders || []), m];
    store.save('categories', c); renderSettings();
  },
  'cat-def-no-time': (b) => {
    const c = store.get('categories', b.closest('[data-cat-id]').dataset.catId);
    c.def_due_time = null; store.save('categories', c); renderSettings();
  },
  'cat-set-color': (b) => {
    const c = store.get('categories', b.closest('[data-cat-id]').dataset.catId);
    c.color = b.dataset.value; store.save('categories', c); renderSettings();
  },
  'cat-random': (b) => {
    const c = store.get('categories', b.closest('[data-cat-id]').dataset.catId);
    c.color = randomColor(c.color); store.save('categories', c); renderSettings();
  },
  'cat-delete': (b) => {
    const id = b.closest('[data-cat-id]').dataset.catId;
    // Tasks and notes keep existing; they just lose the label.
    for (const kind of ['tasks', 'notes']) {
      store.list(kind).filter((r) => r.category_ids.includes(id)).forEach((r) => { r.category_ids = r.category_ids.filter((x) => x !== id); store.save(kind, r); });
    }
    store.remove('categories', id);
    if (prefs.category === id) { prefs.category = null; savePrefs(); }
    renderSettings(); renderAll();
  },
  export: () => {
    const blob = new Blob([JSON.stringify(store.exportAll(), null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `tidemark-backup-${localDate(new Date())}.json` });
    a.click(); URL.revokeObjectURL(a.href);
  },
  install: async () => { await ui.installEvent.prompt(); ui.installEvent = null; renderSettings(); },
};

document.addEventListener('click', (e) => {
  if (ui.cal && !e.target.closest('[data-cal], [data-act="pick-date"]')) closeCalendar(); // click outside the calendar
  const act = e.target.closest('[data-act]');
  if (act) { e.preventDefault(); ACTIONS[act.dataset.act]?.(act); return; }
  const view = e.target.closest('[data-view]');
  if (view) { setView(view.dataset.view); return; }
  const cat = e.target.closest('[data-cat]');
  if (cat) { rememberView(prefs.view, cat.dataset.cat || null); prefs.category = cat.dataset.cat || null; savePrefs(); setNavOpen(false); renderAll(); return; }
  const auth = e.target.closest('[data-auth]');
  if (auth) {
    if (auth.dataset.auth === 'back') { ui.forceAuth = false; showScreen(); } else setAuthMode(auth.dataset.auth);
    return;
  }
  if (e.target === el.scrim) setNavOpen(false);
  if (e.target === el.settings) el.settings.close(); // click on the backdrop
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const input = form.elements[0];
  const value = input.value.trim();
  if (!value) return;
  if (form.dataset.form === 'quick-add') {
    const fields = { title: value, category_ids: prefs.category ? [prefs.category] : [] };
    if (prefs.view === 'today') setDue(fields, localDate(new Date()), '');
    if (prefs.view === 'started') setStatus(fields, 'started');
    applyCategoryDefaults(fields, fields.category_ids);
    store.create('tasks', fields);
    input.value = '';
  } else if (form.dataset.form === 'add-category') {
    const used = store.list('categories').map((c) => c.color);
    input.value = ''; // before creating: the rail redraws and carries over whatever is typed
    const c = store.create('categories', { name: value, color: COLORS.find((x) => !used.includes(x)) || COLORS[0] });
    prefs.category = c.id; savePrefs(); renderAll();
  } else if (form.dataset.form === 'add-sub') {
    const t = selected();
    t.subtasks = [...(t.subtasks || []), { id: store.uid(), title: value, done: false }];
    commit('tasks', t);
    input.value = '';
    renderSubs(t);
  }
});

function onField(e) {
  const target = e.target;
  if (target.dataset.input === 'search') { ui.search = target.value; renderList(); return; }
  if (target.dataset.input === 'sort') { prefs.sort = target.value; savePrefs(); renderList(); return; }
  if (target.dataset.input === 'import') { importFile(target.files[0]); target.value = ''; return; }

  if (target.matches('[data-cat-custom]')) {
    const li = target.closest('[data-cat-id]');
    const c = store.get('categories', li.dataset.catId);
    $('.swatch', li).style.background = target.value; // live preview while the picker is open
    if (e.type === 'change') { c.color = target.value.toUpperCase(); store.save('categories', c); }
    return;
  }
  if (target.matches('[data-cat-def]')) {
    const c = store.get('categories', target.closest('[data-cat-id]').dataset.catId);
    const v = target.value;
    switch (target.dataset.catDef) {
      case 'kind':
        c.def_due_kind = v || null;
        if (v === 'days') c.def_due_days ??= 1;
        if (v === 'weekday') c.def_due_weekday ??= 5;
        break;
      case 'days': {
        const n = Math.round(Number(v));
        if (v === '' || !Number.isFinite(n)) return;           // wait until a number is typed
        c.def_due_days = Math.min(365, Math.max(0, n));
        if (e.type !== 'change') { saveSoon('categories', c.id); return; }
        break;
      }
      case 'weekday': c.def_due_weekday = Number(v); break;
      case 'time': if (e.type !== 'change') return; c.def_due_time = v || null; break;
      case 'rem-amount': case 'rem-unit': return; // read when "Add" is pressed
    }
    flushSave();
    store.save('categories', c);
    renderSettings();
    return;
  }
  if (target.matches('[data-cat-name]')) {
    const c = store.get('categories', target.closest('[data-cat-id]').dataset.catId);
    c.name = target.value.trim() || c.name;
    saveSoon('categories', c.id);
    return;
  }

  const row = selected();
  if (!row || !el.pane.contains(target)) return;
  const kind = ui.sel.kind;

  if (target.dataset.subField) {
    const sub = row.subtasks.find((s) => s.id === target.closest('.sub').dataset.sub);
    if (target.dataset.subField === 'done') {
      sub.done = target.checked;
      target.closest('.sub').classList.toggle('done', sub.done);
      commit(kind, row);
    } else { sub.title = target.value; saveSoon(kind, row.id); }
    return;
  }

  switch (target.dataset.field) {
    case 'title': row.title = target.value.replace(/\n/g, ' '); grow(target); saveSoon(kind, row.id); break;
    case 'notes': row.notes = target.value; grow(target); saveSoon(kind, row.id); break;
    case 'body': row.body = target.value; saveSoon(kind, row.id); break;
    case 'rem-add': {
      const v = target.value;
      if (!v) break;
      if (v === 'custom') ui.remAdd = { id: row.id, mode: 'custom' };
      else if (v === 'exact') {
        const base = row.due_at ? new Date(row.due_at) : new Date();
        ui.remAdd = { id: row.id, mode: 'exact', date: localDate(base), time: row.due_at && !row.due_all_day ? localTime(new Date(new Date(row.due_at) - 36e5)) : '09:00' };
      } else {
        ui.remAdd = null;
        addReminder(row, { minutes: Number(v) });
        commit(kind, row);
      }
      renderPane();
      break;
    }
    case 'rem-amount': if (ui.remAdd) ui.remAdd.amount = target.value; break;
    case 'rem-unit': if (ui.remAdd) ui.remAdd.unit = target.value; break;
    case 'rem-time': if (ui.remAdd) ui.remAdd.time = target.value; break;
    case 'due-date':
    case 'due-time':
      if (e.type !== 'change') return;
      touched(row, 'deadline');
      setDue(row, $('[data-field="due-date"]', el.pane).value, $('[data-field="due-time"]', el.pane).value);
      commit(kind, row); paneState(row); break;
  }
}
document.addEventListener('input', onField);
document.addEventListener('change', (e) => { if (/^(date|time|color|number)$/.test(e.target.type)) onField(e); });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !el.settings.open) {
    if (ui.cal) { const target = ui.cal.target; closeCalendar(); $(`[data-act="pick-date"][data-target="${target}"]`, el.pane)?.focus(); }
    else if (el.nav.classList.contains('open')) setNavOpen(false);
    else if (ui.sel) closePane();
  }
  if (e.key === 'Enter' && e.target.matches?.('.title-input')) {
    e.preventDefault();
    if (ui.sel?.draft && ui.sel.kind === 'tasks') createDraft(); else e.target.blur();
  }
});

async function importFile(file) {
  if (!file) return;
  try {
    const count = await store.importAll(JSON.parse(await file.text()));
    toast(`Loaded ${count} item${count === 1 ? '' : 's'} from the backup.`);
    renderSettings();
  } catch (e) { toast(e instanceof SyntaxError ? 'That file is not a Tidemark backup.' : e.message); }
}

$('#auth-form').addEventListener('submit', submitAuth);
el.settings.addEventListener('close', () => { flushSave(); ui.colorFor = null; ui.defaultsFor = null; ui.pushError = null; scheduleGuard(); });
// Escape, or the phone's back gesture, first closes an open colour or defaults panel inside Settings.
el.settings.addEventListener('cancel', (e) => {
  if (ui.defaultsFor || ui.colorFor) { e.preventDefault(); ui.defaultsFor = null; ui.colorFor = null; renderSettings(); }
});

// ---------- phone back button ----------
// Android's back button (and Alt+Left on a PC) steps back through what is open: the calendar,
// a panel inside Settings, Settings, the side menu, a reminder being added, the task or note,
// then the views you came through. Only when nothing is left does it leave the app.
// This works with a single extra history entry (the "guard") that is there whenever there is
// something to go back to. Pressing back uses it up; the app then closes one thing and puts the
// guard back if more is open.
const viewTrail = [];
function rememberView(view, categoryId) {
  const last = { view: prefs.view, category: prefs.category };
  if (last.view === view && last.category === categoryId) return;
  viewTrail.push(last);
  if (viewTrail.length > 30) viewTrail.shift();
}
function topLayer() {
  if (ui.cal) return 'calendar';
  if (el.settings.open) return ui.defaultsFor || ui.colorFor ? 'settings-panel' : 'settings';
  if (el.nav.classList.contains('open')) return 'menu';
  if (ui.sel && ui.remAdd) return 'reminder';
  if (ui.sel) return 'pane';
  if (viewTrail.length) return 'view';
  return null;
}
function closeLayer(layer) {
  switch (layer) {
    case 'calendar': closeCalendar(); break;
    case 'settings-panel': ui.defaultsFor = null; ui.colorFor = null; renderSettings(); break;
    case 'settings': el.settings.close(); break;
    case 'menu': setNavOpen(false); break;
    case 'reminder': ui.remAdd = null; renderPane(); break;
    case 'pane': closePane(); break;
    case 'view': {
      const v = viewTrail.pop();
      flushSave();
      if (ui.sel?.draft && v.view === 'notes') discardDraft();
      if (ui.sel && (ui.sel.kind === 'notes') !== (v.view === 'notes')) ui.sel = null;
      prefs.view = v.view; prefs.category = category(v.category) ? v.category : null; savePrefs();
      renderAll();
      break;
    }
  }
}
const back = { ignore: 0, timer: 0 };
const onGuard = () => history.state?.tidemarkGuard === true;
function updateGuard() {
  const needed = topLayer() !== null;
  if (needed && !onGuard()) history.pushState({ tidemarkGuard: true }, '');
  else if (!needed && onGuard()) { back.ignore++; history.back(); } // nothing left: remove the guard
}
function scheduleGuard() { clearTimeout(back.timer); back.timer = setTimeout(updateGuard, 0); }
window.addEventListener('popstate', () => {
  if (back.ignore) { back.ignore--; return; }
  const layer = topLayer();
  if (layer) closeLayer(layer);
  scheduleGuard();
});
for (const type of ['click', 'keydown', 'input', 'submit']) document.addEventListener(type, scheduleGuard);

// Data changed (here or on another device): redraw what could be affected.
store.bus.addEventListener('change', (e) => {
  const d = e.detail || {};
  renderNav();
  renderList();
  if (d.kind === 'categories') { renderBar(); refreshSettings(); }
  if (d.remote && ui.sel) {
    const row = selected();
    if (!row || row.deleted) { ui.sel = null; renderPane(); }
    else if (!el.pane.contains(document.activeElement)) renderPane();
  }
});
store.bus.addEventListener('error', () => toast('Could not save on this device. Storage may be full or blocked.'));
sync.bus.addEventListener('status', () => { renderNav(); refreshSettings(); });
sync.bus.addEventListener('auth', () => { if (sync.user) ui.forceAuth = false; showScreen(); renderAll(); refreshSettings(); });
sync.bus.addEventListener('recovery', () => { ui.forceAuth = true; ui.authMode = 'newpass'; showScreen(); });

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); ui.installEvent = e; });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
window.addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); else renderList(); });
setInterval(() => { if (!document.hidden) { renderList(); renderNav(); } }, 60_000); // keeps "Now" and due labels current

// Links from notifications and app shortcuts.
function handleHash() {
  const hash = location.hash.slice(1);
  if (!/^(task=|new-task$|new-note$)/.test(hash)) return; // leave sign-in links for Supabase to read
  history.replaceState(null, '', location.pathname + location.search);
  if (hash.startsWith('task=')) openTaskById(hash.slice(5), true);
  else if (hash === 'new-task') { setView('active'); ACTIONS['new-task-details'](); }
  else if (hash === 'new-note') { setView('notes'); ACTIONS['new-note'](); }
}
// A reminder can arrive for a task this device has not downloaded yet: sync once and retry.
async function openTaskById(id, retry) {
  const t = store.get('tasks', id);
  if (t && !t.deleted) {
    prefs.view = t.status === 'completed' ? 'completed' : 'active';
    prefs.category = null; ui.search = '';
    renderAll(); open('tasks', t.id);
  } else if (retry) { await sync.sync(); setTimeout(() => openTaskById(id, false), 1500); }
}
window.addEventListener('hashchange', handleHash);

// ---------- start ----------

async function start() {
  applyTheme();
  if (!VIEWS[prefs.view]) prefs.view = 'active';
  try { await store.load(); }
  catch { document.body.innerHTML = '<p class="empty">Tidemark cannot open its storage in this browser window. Private or incognito windows often block it.</p>'; return; }
  if (prefs.category && !category(prefs.category)) prefs.category = null;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service worker failed', e));
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'open-task') openTaskById(e.data.id, true);
    });
  }

  await sync.init();
  showScreen();
  renderAll();
  handleHash();
  sync.pushState().then((s) => { ui.push = s; }).catch(() => {});
}
start();
