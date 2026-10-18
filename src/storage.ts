import type { Shot } from './types';
const DB_NAME = 'frame-photo-assistant';
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('shots', { keyPath: 'id' });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
export async function loadShots(): Promise<Shot[]> {
  const db = await openDatabase();
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction('shots', 'readonly');
    const req = tx.objectStore('shots').getAll();
    req.onsuccess = () => resolve((req.result as Shot[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    req.onerror = () => reject(req.error);
  }); } finally { db.close(); }
}
export async function saveShot(shot: Shot) {
  const db = await openDatabase();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('shots', 'readwrite'); tx.objectStore('shots').put(shot);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
export async function deleteShot(id: string) {
  const db = await openDatabase();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('shots', 'readwrite'); tx.objectStore('shots').delete(id);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  }); } finally { db.close(); }
}
