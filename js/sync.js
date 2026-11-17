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
  // Only the project address is wanted. Strip anything after it, such as the "/rest/v1/" the
  // dashboard sometimes shows, which would make every request go to a path that does not exist.
  let url = String(cfg.supabaseUrl).trim();
  try { url = new URL(url).origin; } catch { /* leave as typed; the error message will point here */ }
  client = window.supabase.createClient(url, cfg.supabaseKey.trim(), {
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
  if (/def_(priority|due|remind)|PGRST204/i.test(m)) return 'The database needs an update for category defaults. Run supabase/schema.sql again in the Supabase SQL Editor.';
  if (/relation .* does not exist|schema cache|PGRST205/i.test(m)) return 'The database tables are missing. Run supabase/schema.sql in your Supabase project.';
  if (/JWT|401|Invalid API key|apikey/i.test(m)) return 'Supabase rejected the key in config.js, or your sign-in has expired.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Could not reach Supabase. If you have not used the app for a week, the free project may be paused: restore it in the Supabase dashboard.';
  return m;
}

// ---------- push notifications ----------

export const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// Every step below has a time limit. Some browsers (Samsung Internet among them) can leave one
// of these calls hanging without an error, and then the button would seem to do nothing.
const withTimeout = (promise, ms, message) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);

const isSamsung = () => /SamsungBrowser/i.test(navigator.userAgent);
const unblockHelp = () => isSamsung()
  ? 'In Samsung Internet open Settings, find Notifications (under "Sites and downloads"), and allow this site. Also check Android Settings → Notifications → App notifications → Samsung Internet is on.'
  : 'Allow notifications for this site in the browser settings, and check that the browser itself may send notifications in Android or Windows settings.';

export async function pushState() {
  if (!pushSupported()) return 'unsupported';
  if (!configured || !cfg.vapidPublicKey) return 'unconfigured';
  if (Notification.permission === 'denied') return 'blocked';
  try {
    const reg = await withTimeout(navigator.serviceWorker.getRegistration(), 4000, 'timeout');
    const sub = await withTimeout(reg ? reg.pushManager.getSubscription() : Promise.resolve(null), 4000, 'timeout');
    return sub && Notification.permission === 'granted' ? 'on' : 'off';
  } catch { return 'off'; }
}

// Handles both the current promise form and the older callback form of requestPermission.
function askPermission() {
  if (Notification.permission === 'granted') return Promise.resolve('granted');
  return new Promise((resolve) => {
    const p = Notification.requestPermission(resolve);
    if (p && typeof p.then === 'function') p.then(resolve, () => resolve('denied'));
  });
}

async function workerRegistration() {
  let reg = await withTimeout(navigator.serviceWorker.getRegistration(), 5000, 'no-worker');
  if (!reg) reg = await navigator.serviceWorker.register('./sw.js');
  if (reg.active) return reg;
  return withTimeout(navigator.serviceWorker.ready, 15000, 'no-worker');
}

export async function enablePush(onStep = () => {}) {
  if (!user) throw new Error('Sign in first.');

  onStep('Asking for permission…');
  const permission = await withTimeout(askPermission(), 30000,
    'No permission prompt appeared. ' + unblockHelp());
  if (permission === 'denied') throw new Error('Notifications are blocked for Tidemark. ' + unblockHelp());
  if (permission !== 'granted') throw new Error('The permission prompt was closed. Tap the button again and choose Allow.');

  onStep('Starting the background worker…');
  let reg;
  try { reg = await workerRegistration(); }
  catch { throw new Error('The app\'s background worker did not start. Close Tidemark completely, open it again while online, and try once more.'); }

  onStep('Registering this device…');
  const key = b64urlToBytes(cfg.vapidPublicKey);
  let sub = await withTimeout(reg.pushManager.getSubscription(), 8000, 'timeout').catch(() => null);
  if (sub) {
    const current = sub.options?.applicationServerKey;
    if (current && !sameBytes(new Uint8Array(current), key)) { await sub.unsubscribe().catch(() => {}); sub = null; } // key in config.js changed
  }
  if (!sub) {
    try {
      sub = await withTimeout(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }), 20000, 'timeout');
    } catch (e) {
      const why = e?.message === 'timeout' ? 'did not answer' : `refused (${e?.name || 'error'}: ${e?.message || e})`;
      throw new Error(`The browser's push service ${why}. ` + (isSamsung()
        ? 'Samsung Internet sometimes fails here. Update Samsung Internet in the Galaxy Store and try again, or install Tidemark from Chrome instead.'
        : 'Check that you are online and try again.'));
    }
  }

  onStep('Saving…');
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
      const reg = await workerRegistration();
      const sub = await withTimeout(reg.pushManager.getSubscription(), 8000, 'timeout');
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
