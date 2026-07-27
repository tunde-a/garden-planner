const DB_NAME = 'GardenPlannerDB';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('plants')) {
        db.createObjectStore('plants', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('gardenPlants')) {
        const store = db.createObjectStore('gardenPlants', { keyPath: 'id' });
        store.createIndex('name', 'name');
      }
      if (!db.objectStoreNames.contains('tasks')) {
        const store = db.createObjectStore('tasks', { keyPath: 'id' });
        store.createIndex('plantId', 'plantId');
      }
      if (!db.objectStoreNames.contains('subTasks')) {
        const store = db.createObjectStore('subTasks', { keyPath: 'id' });
        store.createIndex('taskId', 'taskId');
      }
      if (!db.objectStoreNames.contains('recurringTasks')) {
        db.createObjectStore('recurringTasks', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function put(storeName, item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function remove(storeName, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getByIndex(storeName, indexName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    const request = index.getAll(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function seedPlants(plantData) {
  const existing = await getAll('plants');
  if (existing.length > 0) return;
  const db = await openDB();
  const tx = db.transaction('plants', 'readwrite');
  const store = tx.objectStore('plants');
  for (const plant of plantData) {
    store.put(plant);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export { openDB, getAll, put, remove, getByIndex, seedPlants };
