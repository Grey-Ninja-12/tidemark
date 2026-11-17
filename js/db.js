// Small promise wrapper around IndexedDB. Everything the app shows is stored here first,
// which is what makes it work offline.
const NAME = 'tidemark';
const STORES = ['tasks', 'notes', 'categories'];
let opening;

function open() {
  return (opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) req.result.createObjectStore(s, { keyPath: 'id' });
      req.result.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

async function tx(stores, mode, work) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let req;
    t.oncomplete = () => resolve(req?.result);
    t.onerror = t.onabort = () => reject(t.error);
    req = work(t);
  });
}

export const idb = {
  all: (store) => tx(store, 'readonly', (t) => t.objectStore(store).getAll()),
  put: (store, row) => tx(store, 'readwrite', (t) => t.objectStore(store).put(row)),
  putMany: (store, rows) =>
    tx(store, 'readwrite', (t) => {
      const os = t.objectStore(store);
      rows.forEach((r) => os.put(r));
    }),
  metaGet: (key) => tx('meta', 'readonly', (t) => t.objectStore('meta').get(key)),
  metaSet: (key, value) => tx('meta', 'readwrite', (t) => t.objectStore('meta').put(value, key)),
  clear: () =>
    tx([...STORES, 'meta'], 'readwrite', (t) => {
      for (const s of [...STORES, 'meta']) t.objectStore(s).clear();
    }),
};
