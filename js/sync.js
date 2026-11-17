// Sign-in, two-way sync with Supabase, and push-notification subscription.
// The app never waits on this file: it reads and writes local data, and this keeps it in step.
import { idb } from './db.js';
import * as store from './store.js';

const cfg = window.TIDEMARK_CONFIG || {};
export const configured = Boolean(cfg.supabaseUrl && cfg.supabaseKey);
export const bus = new EventTarget();
const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

export let client = null;
export let user = null; // { id, email } once signed in
export const status = { state: configured ? 'idle' : 'local', error: null, lastSync: null };

const OWNER_KEY = 'tidemark.owner'; // whose data is stored on this device
const COLUMNS = Object.fromEntries(
  store.KINDS.map((k) => [k, ['id', 'created_at', 'updated_at', 'deleted', ...Object.keys(store.DEFAULTS[k]())]])
);

function setStatus(state, error = null) {
  status.state = state;
  status.error = error;
  if (state === 'synced') status.lastSync = new Date();
  emit('status');
}

// The account this device last signed in with. Lets the app open offline without asking again.
export function rememberedUser() {
  try { return JSON.parse(localStorage.getItem(OWNER_KEY)); } catch { return null; }
}

export async function init() {
  if (!configured) return;
  client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  // Supabase asks that no other client calls run inside this callback, hence the timeout.
  client.auth.onAuthStateChange((event, session) => setTimeout(() => onAuth(event, session), 0));

  store.bus.addEventListener('dirty', debounce(() => sync(), 800));
  window.addEventListener('online', () => sync());
  window.addEventListener('offline', () => setStatus('offline'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  setInterval(() => { if (!document.hidden) sync(); }, 60_000);
}

async function onAuth(event, session) {
  if (event === 'PASSWORD_RECOVERY') emit('recovery');
  if (session?.user) {
    const next = { id: session.user.id, email: session.user.email };
    const prev = rememberedUser();
    const firstTime = !user || user.id !== next.id;
    user = next;
    if (firstTime) {
      if (prev && prev.id !== next.id) await store.wipe();   // another account's data
      else if (!prev) await store.markAllDirty();            // made before signing in: upload it
      localStorage.setItem(OWNER_KEY, JSON.stringify(next));
      emit('auth');
      listenForChanges();
      refreshPush();
    }
    sync();
  } else if (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') {
    // No valid session. If this device already holds someone's data, keep showing it
    // (the app must open offline) and offer to sign in again.
    user = null;
    stopListening();
    if (rememberedUser()) setStatus(navigator.onLine ? 'signedout' : 'offline');
    emit('auth');
  }
}

// ---------- account ----------

export async function signIn(email, password) {
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(email, password) {
  const { data, error } = await client.auth.signUp({
    email, password, options: { emailRedirectTo: location.origin + location.pathname },
  });
  if (error) throw error;
  return { needsConfirmation: !data.session };
}

export async function sendPasswordReset(email) {
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  if (error) throw error;
}

export async function setPassword(password) {
  const { error } = await client.auth.updateUser({ password });
  if (error) throw error;
}

export async function signOut() {
  try { await disablePush(); } catch { /* offline: the server drops dead subscriptions itself */ }
  stopListening();
  await client.auth.signOut().catch(() => {});
  localStorage.removeItem(OWNER_KEY);
  user = null;
  await store.wipe();
  setStatus('idle');
  emit('auth');
}

// ---------- sync ----------

let running = false;
let queued = false;

export async function sync() {
  if (!client || !user) return;
  if (running) { queued = true; return; }
  if (!navigator.onLine) { setStatus('offline'); return; }
  running = true;
  setStatus('syncing');
  try {
    for (const kind of store.KINDS) await pull(kind);
    for (const kind of store.KINDS) await push(kind);
    setStatus('synced');
  } catch (e) {
    console.warn('Sync failed', e);
    setStatus(navigator.onLine ? 'error' : 'offline', friendly(e));
  } finally {
    running = false;
    if (queued) { queued = false; sync(); }
  }
}

// Download rows the server stamped after our last visit. The 5-second overlap covers writes
// that were still in flight; applying a row twice is harmless.
async function pull(kind) {
  const cursor = await idb.metaGet('cursor:' + kind);
  const from = cursor ? new Date(Date.parse(cursor) - 5000).toISOString() : null;
  const PAGE = 500;
  let newest = cursor;
  for (let offset = 0; ; offset += PAGE) {
    let q = client.from(kind).select('*');
    if (from) q = q.gt('synced_at', from); // filters must come before order/range in supabase-js
    const { data, error } = await q.order('synced_at').order('id').range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (data.length) {
      await store.applyRemote(kind, data);
      const last = data[data.length - 1].synced_at;
      if (!newest || Date.parse(last) > Date.parse(newest)) newest = last;
    }
    if (data.length < PAGE) break;
  }
  if (newest && newest !== cursor) await idb.metaSet('cursor:' + kind, newest);
}

// Upload local edits. The database keeps whichever version was edited last (see schema.sql).
async function push(kind) {
  const rows = store.dirty(kind);
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const sent = chunk.map((r) => ({ id: r.id, updated_at: r.updated_at }));
    const payload = chunk.map((r) => Object.fromEntries(COLUMNS[kind].map((c) => [c, r[c] ?? null])));
    const { error } = await client.from(kind).upsert(payload, { onConflict: 'id' });
    if (error) throw error;
    await store.markClean(kind, sent);
  }
}

let channel = null;
function listenForChanges() {
  stopListening();
  channel = client
    .channel('tidemark-changes')
    .on('postgres_changes', { event: '*', schema: 'public' }, debounce(() => sync(), 400))
    .subscribe();
}
function stopListening() {
  if (channel) client.removeChannel(channel);
  channel = null;
}

function friendly(e) {
  const m = e?.message || String(e);
  if (/relation .* does not exist|schema cache|PGRST205/i.test(m)) return 'The database tables are missing. Run supabase/schema.sql in your Supabase project.';
  if (/JWT|401|Invalid API key|apikey/i.test(m)) return 'Supabase rejected the key in config.js, or your sign-in has expired.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Could not reach Supabase. If you have not used the app for a week, the free project may be paused: restore it in the Supabase dashboard.';
  return m;
}

// ---------- push notifications ----------

export const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function pushState() {
  if (!pushSupported()) return 'unsupported';
  if (!configured || !cfg.vapidPublicKey) return 'unconfigured';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

export async function enablePush() {
  if (!user) throw new Error('Sign in first.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked for this app. Allow them in your browser or system settings.');
  const reg = await navigator.serviceWorker.ready;
  const key = b64urlToBytes(cfg.vapidPublicKey);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameBytes(new Uint8Array(sub.options.applicationServerKey ?? []), key)) {
    await sub.unsubscribe(); // the key in config.js changed
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await saveSubscription(sub);
}

export async function disablePush() {
  const reg = await navigator.serviceWorker?.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  if (client && user) await client.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

// Browsers occasionally rotate a subscription, so re-register it on every sign-in.
async function refreshPush() {
  try {
    if ((await pushState()) === 'on') {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await saveSubscription(sub);
    }
  } catch (e) { console.warn('Could not refresh push subscription', e); }
}

async function saveSubscription(sub) {
  const j = sub.toJSON();
  const { error } = await client.from('push_subscriptions').upsert(
    { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, device: deviceLabel() },
    { onConflict: 'endpoint' }
  );
  if (error) throw error;
}

// Asks the server to push a test message to every device signed in to this account.
export async function sendTestPush() {
  const { data, error } = await client.functions.invoke('send-reminders', { body: { test: true } });
  if (error) {
    let detail = error.message;
    try { detail = (await error.context.json()).error || detail; } catch { /* keep message */ }
    throw new Error(detail);
  }
  return data;
}

function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : 'Browser';
  return `${os} ${browser}`;
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
