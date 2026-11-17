// In-memory copy of all tasks, notes and categories, backed by IndexedDB.
// Every local edit marks the row "_dirty" so the sync engine knows to upload it.
import { idb } from './db.js';

export const KINDS = ['tasks', 'notes', 'categories'];
export const state = { tasks: new Map(), notes: new Map(), categories: new Map() };
export const bus = new EventTarget();
const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

export const uid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

// Field lists double as the column lists sent to the server.
export const DEFAULTS = {
  tasks: () => ({
    title: '', notes: '', priority: 0, status: 'todo',
    due_at: null, due_all_day: true, remind_offset: null, remind_at: null,
    category_id: null, subtasks: [], started_at: null, completed_at: null,
  }),
  notes: () => ({ title: '', body: '', category_id: null, pinned: false }),
  categories: () => ({
    name: '', color: '#0B6B78',
    // Defaults for tasks in this category. Deadline: "days" = N days after creation, "weekday" = next given weekday (0 = Sunday).
    def_priority: null, def_due_kind: null, def_due_days: null, def_due_weekday: null, def_due_time: null, def_remind_offset: null,
  }),
};

export async function load() {
  for (const kind of KINDS) {
    state[kind] = new Map((await idb.all(kind)).map((r) => [r.id, r]));
  }
}

export const get = (kind, id) => state[kind].get(id);
export const list = (kind) => [...state[kind].values()].filter((r) => !r.deleted);

export function create(kind, fields = {}) {
  const row = { id: uid(), ...DEFAULTS[kind](), created_at: nowIso(), deleted: false, ...fields };
  return save(kind, row);
}

export function save(kind, row) {
  row.updated_at = nowIso();
  row._dirty = 1;
  state[kind].set(row.id, row);
  idb.put(kind, row).catch((e) => emit('error', e));
  emit('change', { kind, id: row.id, remote: false });
  emit('dirty');
  return row;
}

export function remove(kind, id) {
  const row = get(kind, id);
  if (!row) return;
  row.deleted = true;
  save(kind, row);
}

export function restore(kind, id) {
  const row = get(kind, id);
  if (!row) return;
  row.deleted = false;
  save(kind, row);
}

// Rows downloaded from the server. A local edit that is newer than the server copy is kept
// (it will be uploaded next); otherwise the server copy wins.
export async function applyRemote(kind, rows) {
  const changed = [];
  for (const remote of rows) {
    const local = state[kind].get(remote.id);
    if (local) {
      const lt = Date.parse(local.updated_at), rt = Date.parse(remote.updated_at);
      if (local._dirty && lt > rt) continue;
      if (!local._dirty && lt === rt) continue;
    }
    const { user_id, synced_at, ...fields } = remote;
    const row = { ...DEFAULTS[kind](), ...fields, _dirty: 0 };
    state[kind].set(row.id, row);
    changed.push(row);
  }
  if (changed.length) {
    await idb.putMany(kind, changed);
    emit('change', { kind, remote: true, ids: changed.map((r) => r.id) });
  }
  return changed.length;
}

export const dirty = (kind) => [...state[kind].values()].filter((r) => r._dirty);
export const pendingCount = () => KINDS.reduce((n, k) => n + dirty(k).length, 0);

// Called after a successful upload. A row edited again while the upload was in flight
// has a newer updated_at and stays dirty.
export async function markClean(kind, sent) {
  const cleaned = [];
  for (const s of sent) {
    const cur = state[kind].get(s.id);
    if (cur && cur.updated_at === s.updated_at) {
      cur._dirty = 0;
      cleaned.push(cur);
    }
  }
  if (cleaned.length) await idb.putMany(kind, cleaned);
}

export async function markAllDirty() {
  for (const kind of KINDS) {
    const rows = [...state[kind].values()];
    rows.forEach((r) => (r._dirty = 1));
    if (rows.length) await idb.putMany(kind, rows);
  }
  emit('dirty');
}

export async function wipe() {
  await idb.clear();
  for (const kind of KINDS) state[kind] = new Map();
  emit('change', { remote: true });
}

export function exportAll() {
  const strip = ({ _dirty, ...r }) => r;
  return {
    app: 'tidemark', version: 1, exported_at: nowIso(),
    tasks: list('tasks').map(strip), notes: list('notes').map(strip), categories: list('categories').map(strip),
  };
}

export async function importAll(data) {
  if (!data || data.app !== 'tidemark') throw new Error('This file is not a Tidemark backup.');
  let count = 0;
  for (const kind of KINDS) {
    for (const r of data[kind] ?? []) {
      if (!r || typeof r.id !== 'string') continue;
      const row = { ...DEFAULTS[kind](), created_at: nowIso(), ...r, deleted: false, updated_at: nowIso(), _dirty: 1 };
      state[kind].set(row.id, row);
      await idb.put(kind, row);
      count++;
    }
  }
  emit('change', { remote: true });
  emit('dirty');
  return count;
}
