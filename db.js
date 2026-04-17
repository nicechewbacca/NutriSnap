const DB_NAME = 'nutrisnap-db';
const DB_VERSION = 1;
let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = event => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('profile')) {
          db.createObjectStore('profile', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meals')) {
          const store = db.createObjectStore('meals', { keyPath: 'id', autoIncrement: true });
          store.createIndex('by_date', 'date', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

async function saveProfile(profile) {
  const db = await getDB();
  const tx = db.transaction('profile', 'readwrite');
  await tx.objectStore('profile').put({ ...profile, id: 1 });
  return tx.complete;
}

async function getProfile() {
  const db = await getDB();
  const tx = db.transaction('profile', 'readonly');
  return tx.objectStore('profile').get(1);
}

async function addMeal(meal) {
  const db = await getDB();
  const tx = db.transaction('meals', 'readwrite');
  await tx.objectStore('meals').add(meal);
  return tx.complete;
}

async function getMealsByDate(dateStr) {
  const db = await getDB();
  const tx = db.transaction('meals', 'readonly');
  const index = tx.objectStore('meals').index('by_date');
  const range = IDBKeyRange.only(dateStr);
  return new Promise((resolve, reject) => {
    const req = index.getAll(range);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
