// IndexedDB Database for Finance Tracker
//
// Data safety rules (see also syncMerge.js):
//   - Every write goes through `locked()` and ends in `afterWrite()`, which
//     marks local data as changed, refreshes the localStorage backup and
//     schedules a cloud sync. No write path may skip it.
//   - A record is only ever removed by an explicit user delete, which also
//     records a tombstone so the deletion syncs to other devices.
//   - Sync merges local and cloud by id; it never replaces one side with the
//     other wholesale.
import { v4 as uuidv4 } from 'uuid';
import { isSupabaseConfigured, isSignedIn, readCloudRow, writeCloudRow } from './supabase';
import {
  RECORD_KEYS, mergeDatasets, datasetsEqual, toCloudDocument, stableStringify,
  flattenCategories, groupCategories,
} from './syncMerge';
import { parseDate, inMonth } from '../utils/dates';

const DB_NAME = 'FinanceTrackerDB';
const DB_VERSION = 5;

let db = null;

// Default categories with monthly budgets
const DEFAULT_CATEGORIES = {
  income: [
    { name: 'ხელფასი', icon: '💼', color: '#22c55e', budget: 0 },
  ],
  expense: [
    { name: 'ტაქსი', icon: '🚕', color: '#f97316', budget: 0 },
    { name: 'პირადი', icon: '👤', color: '#f59e0b', budget: 0 },
    { name: 'ობი', icon: '🏪', color: '#22c55e', budget: 0 },
    { name: 'გაუთვალისწინებელი', icon: '❓', color: '#14b8a6', budget: 0 },
    { name: 'გადასახადები', icon: '📄', color: '#06b6d4', budget: 0 },
    { name: 'მარკეტი', icon: '🛒', color: '#0ea5e9', budget: 0 },
    { name: 'WM / ჩართე', icon: '📱', color: '#3b82f6', budget: 0 },
    { name: 'ბინის ხარჯები', icon: '🏠', color: '#6366f1', budget: 0 },
    { name: 'დანაზოგი', icon: '💎', color: '#8b5cf6', budget: 0 },
    { name: 'Gamefound', icon: '🎮', color: '#a855f7', budget: 0 },
    { name: 'საწვავი', icon: '⛽', color: '#84cc16', budget: 0 },
    { name: 'სესხი', icon: '🏦', color: '#eab308', budget: 0 },
  ],
};

// Stores that hold user data and travel with export/backup/sync.
// `categories` is handled separately because it is grouped in exports.
const DATA_STORES = [...RECORD_KEYS, 'categories'];

// Initialize the database
export const initDB = () => {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      db = request.result;
      // Another tab upgrading the schema must not be blocked by this one.
      db.onversionchange = () => { db.close(); db = null; };
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains('transactions')) {
        const transactionStore = database.createObjectStore('transactions', { keyPath: 'id' });
        transactionStore.createIndex('date', 'date', { unique: false });
        transactionStore.createIndex('type', 'type', { unique: false });
        transactionStore.createIndex('categoryId', 'categoryId', { unique: false });
      }
      if (!database.objectStoreNames.contains('categories')) {
        database.createObjectStore('categories', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('wishlist')) {
        database.createObjectStore('wishlist', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('settings')) {
        database.createObjectStore('settings', { keyPath: 'key' });
      }
      // v2 — no UI any more, but existing records are kept and synced.
      if (!database.objectStoreNames.contains('stocks')) {
        const stocksStore = database.createObjectStore('stocks', { keyPath: 'id' });
        stocksStore.createIndex('symbol', 'symbol', { unique: false });
      }
      // v3 — no UI any more, but existing records are kept and synced.
      if (!database.objectStoreNames.contains('recurringTransactions')) {
        const recurringStore = database.createObjectStore('recurringTransactions', { keyPath: 'id' });
        recurringStore.createIndex('nextDueDate', 'nextDueDate', { unique: false });
        recurringStore.createIndex('isActive', 'isActive', { unique: false });
      }
      if (!database.objectStoreNames.contains('savingsGoals')) {
        database.createObjectStore('savingsGoals', { keyPath: 'id' });
      }
      // v4 — per-category, per-month budgets
      if (!database.objectStoreNames.contains('monthlyBudgets')) {
        database.createObjectStore('monthlyBudgets', { keyPath: 'id' });
      }
      // v5 — per-month category snapshots
      if (!database.objectStoreNames.contains('monthlyCategories')) {
        database.createObjectStore('monthlyCategories', { keyPath: 'id' });
      }
    };
  });
};

// Generic DB operations
const getStore = (storeName, mode = 'readonly') => {
  const transaction = db.transaction(storeName, mode);
  return transaction.objectStore(storeName);
};

const promisify = (request, value) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(value === undefined ? request.result : value);
  request.onerror = () => reject(request.error);
});

const getAllFromStore = (storeName) => promisify(getStore(storeName).getAll());
const getFromStore = (storeName, id) => promisify(getStore(storeName).get(id));
const putToStore = (storeName, item) => promisify(getStore(storeName, 'readwrite').put(item), item);

// Several puts/deletes across stores as one atomic IndexedDB transaction:
// either all of them land or none do.
const runAtomic = (storeNames, fn) => new Promise((resolve, reject) => {
  const tx = db.transaction(storeNames, 'readwrite');
  const stores = Object.fromEntries(storeNames.map(s => [s, tx.objectStore(s)]));
  fn(stores);
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
});

// ============================================
// Write serialisation
// ============================================
// All writes (and the local half of a sync) run one at a time, so a sync can
// never interleave with a user edit and overwrite it.

let writeChain = Promise.resolve();
const withLock = (fn) => {
  const run = writeChain.then(fn);
  writeChain = run.catch(() => {});
  return run;
};
const locked = (fn) => (...args) => withLock(async () => {
  await initDB();
  return fn(...args);
});

// ============================================
// Change tracking, tombstones, local backup
// ============================================

const CHANGE_SEQ_KEY = 'finance_change_seq';
const SYNCED_SEQ_KEY = 'finance_synced_seq';
const LEGACY_MTIME_KEY = 'finance_local_mtime';
const BACKUP_KEY = 'finance_backup';
const SNAPSHOT_KEYS = ['finance_pre_sync_snapshot', 'finance_pre_sync_snapshot_2', 'finance_pre_sync_snapshot_3'];

const readInt = (key) => {
  try { return parseInt(localStorage.getItem(key) || '0', 10) || 0; } catch { return 0; }
};
const getChangeSeq = () => readInt(CHANGE_SEQ_KEY);
const hasEverSynced = () => {
  try { return localStorage.getItem(SYNCED_SEQ_KEY) !== null; } catch { return false; }
};

const markLocalChanged = () => {
  try {
    localStorage.setItem(CHANGE_SEQ_KEY, String(getChangeSeq() + 1));
    localStorage.setItem(LEGACY_MTIME_KEY, new Date().toISOString());
  } catch { /* storage unavailable — sync still merges, nothing is lost */ }
};

export const hasUnsyncedChanges = () => getChangeSeq() > readInt(SYNCED_SEQ_KEY);

// Tombstones live in the settings store so they are written in the same
// IndexedDB transaction as the delete itself.
const TOMBSTONE_KEY = 'tombstones';

const getTombstones = async () => {
  const row = await getFromStore('settings', TOMBSTONE_KEY);
  return row?.value || {};
};

const readLocalDataset = async () => {
  const out = {};
  for (const key of RECORD_KEYS) out[key] = await getAllFromStore(key);
  out.categories = await getAllFromStore('categories');
  out.deleted = await getTombstones();
  return out;
};

let backupTimer = null;
const scheduleBackup = () => {
  clearTimeout(backupTimer);
  backupTimer = setTimeout(async () => {
    try {
      await initDB();
      const data = await readLocalDataset();
      localStorage.setItem(BACKUP_KEY, JSON.stringify({ ...data, savedAt: new Date().toISOString() }));
    } catch { /* quota exceeded — the cloud copy and exports remain */ }
  }, 500);
};

const afterWrite = () => {
  markLocalChanged();
  scheduleBackup();
  triggerAutoSync();
};

// Remove records and record tombstones in one atomic step.
const deleteWithTombstones = async (storeName, ids) => {
  if (!ids.length) return;
  const tombs = await getTombstones();
  const now = new Date().toISOString();
  const forStore = { ...(tombs[storeName] || {}) };
  ids.forEach(id => { forStore[id] = now; });
  await runAtomic([storeName, 'settings'], (s) => {
    ids.forEach(id => s[storeName].delete(id));
    s.settings.put({ key: TOMBSTONE_KEY, value: { ...tombs, [storeName]: forStore } });
  });
};

// Add records that are missing locally; never overwrites or removes anything.
// Records that were deleted earlier are marked revived so the old tombstone
// doesn't remove them again on the next sync.
const addMissingRecords = async (data) => {
  const incoming = { categories: flattenCategories(data.categories) };
  for (const key of RECORD_KEYS) incoming[key] = Array.isArray(data[key]) ? data[key] : [];

  const tombs = await getTombstones();
  const now = new Date().toISOString();
  const counts = {};
  const toAdd = {};
  for (const store of DATA_STORES) {
    const existing = new Set((await getAllFromStore(store)).map(r => r.id));
    toAdd[store] = incoming[store]
      .filter(r => r && r.id != null && !existing.has(r.id))
      .map(r => (tombs[store]?.[r.id] ? { ...r, revivedAt: now } : r));
    counts[store] = toAdd[store].length;
  }
  // Default categories auto-created on this (fresh) device are redundant once
  // real ones exist: drop seeds that no transaction uses, and swap month
  // snapshots built from them for the incoming version of that month.
  const localCats = await getAllFromStore('categories');
  const allTx = [...(await getAllFromStore('transactions')), ...toAdd.transactions];
  const used = new Set(allTx.map(t => t.categoryId));
  const hasReal = [...localCats, ...toAdd.categories].some(c => !c.seed);
  const dropSeeds = new Set(hasReal
    ? localCats.filter(c => c.seed && !used.has(c.id)).map(c => c.id)
    : []);
  const incomingMonths = new Map(incoming.monthlyCategories.map(m => [m.id, m]));
  const replaceMonths = dropSeeds.size
    ? (await getAllFromStore('monthlyCategories')).filter(m =>
        incomingMonths.has(m.id) && [...(m.income || []), ...(m.expense || [])].some(c => dropSeeds.has(c.id)))
    : [];

  if (Object.values(counts).some(Boolean) || dropSeeds.size) {
    await runAtomic(DATA_STORES, (s) => {
      for (const store of DATA_STORES) toAdd[store].forEach(r => s[store].put(r));
      dropSeeds.forEach(id => s.categories.delete(id));
      replaceMonths.forEach(m => s.monthlyCategories.put(incomingMonths.get(m.id)));
    });
  }
  return counts;
};

export const getBackupInfo = () => {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return { savedAt: data.savedAt, transactionCount: data.transactions?.length || 0 };
  } catch { return null; }
};

// Adds back anything from the backup that is missing now. Existing records
// are left untouched.
export const restoreFromBackup = locked(async () => {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const counts = await addMissingRecords(data);
    afterWrite();
    return { added: counts.transactions, transactionCount: data.transactions?.length || 0, savedAt: data.savedAt };
  } catch { return null; }
});

const saveSnapshot = (data) => {
  try {
    for (let i = SNAPSHOT_KEYS.length - 1; i > 0; i--) {
      const prev = localStorage.getItem(SNAPSHOT_KEYS[i - 1]);
      if (prev) localStorage.setItem(SNAPSHOT_KEYS[i], prev);
    }
    localStorage.setItem(SNAPSHOT_KEYS[0], JSON.stringify({ ...data, snapshotAt: new Date().toISOString() }));
  } catch { /* quota exceeded — proceed */ }
};

// What local data looked like before the most recent sync changed it.
export const getPreSyncSnapshot = () => {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEYS[0]);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return { snapshotAt: d.snapshotAt, transactionCount: d.transactions?.length || 0, data: d };
  } catch { return null; }
};

export const restorePreSyncSnapshot = locked(async () => {
  const snap = getPreSyncSnapshot();
  if (!snap) return null;
  const counts = await addMissingRecords(snap.data);
  afterWrite();
  return { added: counts.transactions, snapshotAt: snap.snapshotAt };
});

// ============================================
// Transactions
// ============================================

const byDateDesc = (a, b) => (parseDate(b.date)?.getTime() ?? -Infinity) - (parseDate(a.date)?.getTime() ?? -Infinity);

export const getTransactions = async () => {
  await initDB();
  const transactions = await getAllFromStore('transactions');
  return transactions.sort(byDateDesc);
};

export const addTransaction = locked(async (transaction) => {
  const newTransaction = { ...transaction, id: uuidv4(), createdAt: new Date().toISOString() };
  await putToStore('transactions', newTransaction);
  afterWrite();
  return newTransaction;
});

export const addBulkTransactions = locked(async (transactions) => {
  const now = new Date().toISOString();
  const results = transactions
    .filter(t => t.amount > 0)
    .map(t => ({ ...t, id: uuidv4(), createdAt: now }));
  if (!results.length) return [];
  await runAtomic(['transactions'], (s) => results.forEach(t => s.transactions.put(t)));
  afterWrite();
  return results;
});

export const updateTransaction = locked(async (id, updates) => {
  const transaction = await getFromStore('transactions', id);
  if (!transaction) return null;
  const updated = { ...transaction, ...updates, id, updatedAt: new Date().toISOString() };
  await putToStore('transactions', updated);
  afterWrite();
  return updated;
});

export const deleteTransaction = locked(async (id) => {
  await deleteWithTombstones('transactions', [id]);
  afterWrite();
  return true;
});

export const deleteTransactionsByDate = locked(async (date) => {
  const transactions = await getAllFromStore('transactions');
  const ids = transactions.filter(t => t.date === date).map(t => t.id);
  await deleteWithTombstones('transactions', ids);
  afterWrite();
  return ids.length;
});

// ============================================
// Categories (global — used for lookups across months)
// ============================================

const readGroupedCategories = async () => {
  const categories = await getAllFromStore('categories');
  const grouped = groupCategories(categories);
  grouped.income.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  grouped.expense.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  return grouped;
};

// Seeds defaults only on a brand-new, empty database. Seeds are tagged so the
// first sync can drop them in favour of the real categories from the cloud.
const seedCategoriesIfEmpty = async () => {
  if ((await getAllFromStore('categories')).length > 0) return;
  const seeds = [
    ...DEFAULT_CATEGORIES.income.map(c => ({ ...c, id: uuidv4(), type: 'income', seed: true })),
    ...DEFAULT_CATEGORIES.expense.map(c => ({ ...c, id: uuidv4(), type: 'expense', seed: true })),
  ];
  await runAtomic(['categories'], (s) => seeds.forEach(c => s.categories.put(c)));
};

export const getCategories = locked(async () => {
  await seedCategoriesIfEmpty();
  return readGroupedCategories();
});

// ============================================
// Monthly Categories API (per-month snapshots)
// Each month gets its own independent category list.
// ============================================

const prevMonthOf = (year, month) => (month === 0 ? [year - 1, 11] : [year, month - 1]);

// Narrow a category list to the ones actually used: in the previous month or
// already in this month. Keeps `base` order; used categories missing from
// `base` are appended from the global list. If nothing was used at all, the
// base list is returned unchanged so a month never starts empty.
const keepUsedCategories = async (year, month, base) => {
  const [py, pm] = prevMonthOf(year, month);
  const transactions = await getAllFromStore('transactions');
  const global = await readGroupedCategories();
  const out = {};
  for (const type of ['income', 'expense']) {
    const used = new Set(transactions
      .filter(t => t.type === type && t.categoryId && (inMonth(t, py, pm) || inMonth(t, year, month)))
      .map(t => t.categoryId));
    const kept = (base[type] || []).filter(c => used.has(c.id));
    const keptIds = new Set(kept.map(c => c.id));
    const extra = global[type].filter(c => used.has(c.id) && !keptIds.has(c.id)).map(c => ({ ...c }));
    const result = [...kept, ...extra];
    out[type] = result.length ? result : (base[type] || []);
  }
  return out;
};

const getMonthCategoriesUnlocked = async (year, month) => {
  const id = `${year}_${month}`;
  const existing = await getFromStore('monthlyCategories', id);
  if (existing) {
    return { income: existing.income || [], expense: existing.expense || [] };
  }
  // First visit to this month: start from last month's list (or the global
  // categories if there is none) and keep only the categories used last month.
  await seedCategoriesIfEmpty();
  const [py, pm] = prevMonthOf(year, month);
  const prevSnapshot = await getFromStore('monthlyCategories', `${py}_${pm}`);
  const globalCats = await readGroupedCategories();
  const base = prevSnapshot
    ? { income: prevSnapshot.income || [], expense: prevSnapshot.expense || [] }
    : {
        income: globalCats.income.filter(c => !c.archived),
        expense: globalCats.expense.filter(c => !c.archived),
      };
  const cats = await keepUsedCategories(year, month, base);
  const snapshot = {
    id,
    year,
    month,
    income: cats.income.map(c => ({ ...c })),
    expense: cats.expense.map(c => ({ ...c })),
  };
  await putToStore('monthlyCategories', snapshot);
  return { income: snapshot.income, expense: snapshot.expense };
};

// Apply the same "used last month (or this month)" filter to a month that
// already has a list. Only that month's list changes; categories and
// transactions are untouched, and removed cards can be re-added any time.
export const trimMonthCategoriesToUsed = locked(async (year, month) => {
  const current = await getMonthCategoriesUnlocked(year, month);
  const trimmed = await keepUsedCategories(year, month, current);
  const removed = (current.income.length + current.expense.length) - (trimmed.income.length + trimmed.expense.length);
  if (removed > 0) {
    await saveMonthSnapshot(year, month, trimmed);
    afterWrite();
  }
  return { removed };
});

export const getMonthCategories = locked(getMonthCategoriesUnlocked);

const saveMonthSnapshot = async (year, month, cats) => {
  await putToStore('monthlyCategories', {
    id: `${year}_${month}`, year, month,
    income: cats.income || [],
    expense: cats.expense || [],
  });
};

// Add a category to a specific month (also adds to global store for lookups)
export const addMonthCategory = locked(async (year, month, type, category) => {
  const cats = await getMonthCategoriesUnlocked(year, month);
  const newCat = { ...category, id: uuidv4(), type };
  cats[type] = [...(cats[type] || []), newCat];
  await saveMonthSnapshot(year, month, cats);
  await putToStore('categories', newCat);
  afterWrite();
  return newCat;
});

// Put an existing category back on a month's list (same id, so its history
// stays in one place). Un-archives it if it was archived.
export const addExistingCategoryToMonth = locked(async (year, month, categoryId) => {
  const cat = await getFromStore('categories', categoryId);
  if (!cat) return null;
  const type = cat.type === 'income' ? 'income' : 'expense';
  const cats = await getMonthCategoriesUnlocked(year, month);
  if (!(cats[type] || []).some(c => c.id === categoryId)) {
    const restored = { ...cat, archived: undefined };
    cats[type] = [...(cats[type] || []), restored];
    await saveMonthSnapshot(year, month, cats);
    if (cat.archived) await putToStore('categories', restored);
    afterWrite();
  }
  return cat;
});

// Remove a category from one month's list. The global category and every
// transaction that uses it are kept.
export const deleteMonthCategory = locked(async (year, month, categoryId) => {
  const cats = await getMonthCategoriesUnlocked(year, month);
  cats.income = (cats.income || []).filter(c => c.id !== categoryId);
  cats.expense = (cats.expense || []).filter(c => c.id !== categoryId);
  await saveMonthSnapshot(year, month, cats);
  afterWrite();
  return true;
});

export const reorderMonthCategories = locked(async (year, month, type, orderedIds) => {
  const cats = await getMonthCategoriesUnlocked(year, month);
  const ordered = orderedIds.map(id => cats[type].find(c => c.id === id)).filter(Boolean);
  // Keep anything the caller didn't mention instead of silently dropping it.
  const rest = cats[type].filter(c => !orderedIds.includes(c.id));
  cats[type] = [...ordered, ...rest];
  await saveMonthSnapshot(year, month, cats);
  afterWrite();
  return true;
});

// Reset a month's list to the default categories. Reuses the existing global
// category with the same name where there is one, so past transactions keep
// matching; only genuinely missing defaults are created.
export const resetMonthCategoriesToDefaults = locked(async (year, month) => {
  const global = await readGroupedCategories();
  const created = [];
  const pick = (type) => DEFAULT_CATEGORIES[type].map(def => {
    const match = global[type].find(c => c.name === def.name && !c.archived)
      || global[type].find(c => c.name === def.name);
    if (match) return { ...match, archived: undefined };
    const cat = { ...def, id: uuidv4(), type };
    created.push(cat);
    return cat;
  });
  const defaults = { income: pick('income'), expense: pick('expense') };
  for (const cat of created) await putToStore('categories', cat);
  await saveMonthSnapshot(year, month, defaults);
  afterWrite();
  return true;
});

// Get monthly spending by category
export const getMonthlySpendingByCategory = async (year, month) => {
  const transactions = await getTransactions();
  const spending = {};
  transactions.forEach(t => {
    const date = parseDate(t.date);
    if (!date || t.type !== 'expense' || date.getFullYear() !== year || date.getMonth() !== month) return;
    spending[t.categoryId] = (spending[t.categoryId] || 0) + t.amount;
  });
  return spending;
};

// ============================================
// Wishlist
// ============================================

export const getWishlist = async () => {
  await initDB();
  return getAllFromStore('wishlist');
};

export const addWishlistItem = locked(async (item) => {
  const newItem = { ...item, id: uuidv4(), createdAt: new Date().toISOString(), purchased: false };
  await putToStore('wishlist', newItem);
  afterWrite();
  return newItem;
});

export const updateWishlistItem = locked(async (id, updates) => {
  const item = await getFromStore('wishlist', id);
  if (!item) return null;
  const updated = { ...item, ...updates, id };
  await putToStore('wishlist', updated);
  afterWrite();
  return updated;
});

export const deleteWishlistItem = locked(async (id) => {
  await deleteWithTombstones('wishlist', [id]);
  afterWrite();
  return true;
});

// ============================================
// Savings Goals
// ============================================

export const getSavingsGoals = async () => {
  await initDB();
  return getAllFromStore('savingsGoals');
};

export const addSavingsGoal = locked(async (goal) => {
  const newGoal = { ...goal, id: uuidv4(), currentAmount: goal.currentAmount || 0, createdAt: new Date().toISOString() };
  await putToStore('savingsGoals', newGoal);
  afterWrite();
  return newGoal;
});

export const updateSavingsGoal = locked(async (id, updates) => {
  const item = await getFromStore('savingsGoals', id);
  if (!item) return null;
  const updated = { ...item, ...updates, id };
  await putToStore('savingsGoals', updated);
  afterWrite();
  return updated;
});

export const deleteSavingsGoal = locked(async (id) => {
  await deleteWithTombstones('savingsGoals', [id]);
  afterWrite();
  return true;
});

export const addToSavingsGoal = locked(async (id, amount) => {
  const item = await getFromStore('savingsGoals', id);
  if (!item) return null;
  const updated = { ...item, currentAmount: (item.currentAmount || 0) + amount };
  await putToStore('savingsGoals', updated);
  afterWrite();
  return updated;
});

// ============================================
// Monthly Budgets API  (per-category, per-month)
// id format: `${categoryId}_${year}_${month}`
// ============================================

export const getMonthlyBudgets = async (year, month) => {
  await initDB();
  const all = await getAllFromStore('monthlyBudgets');
  const map = {};
  all.filter(b => b.year === year && b.month === month)
     .forEach(b => { map[b.categoryId] = b.amount; });
  return map;
};

export const setMonthlyBudget = locked(async (categoryId, year, month, amount) => {
  const entry = { id: `${categoryId}_${year}_${month}`, categoryId, year, month, amount: parseFloat(amount) || 0 };
  await putToStore('monthlyBudgets', entry);
  afterWrite();
  return entry;
});

// Carry a month's budgets forward from the previous month. Budgets already set
// for the target month are left alone, so this can be re-run safely.
export const copyPreviousMonthBudgets = locked(async (year, month) => {
  const prevYear = month === 0 ? year - 1 : year;
  const prevMonth = month === 0 ? 11 : month - 1;

  const all = await getAllFromStore('monthlyBudgets');
  const source = all.filter(b => b.year === prevYear && b.month === prevMonth && b.amount > 0);
  if (source.length === 0) return { copied: 0, prevYear, prevMonth };

  const alreadySet = new Set(
    all.filter(b => b.year === year && b.month === month && b.amount > 0).map(b => b.categoryId)
  );

  let copied = 0;
  for (const b of source) {
    if (alreadySet.has(b.categoryId)) continue;
    await putToStore('monthlyBudgets', {
      id: `${b.categoryId}_${year}_${month}`,
      categoryId: b.categoryId,
      year,
      month,
      amount: b.amount,
    });
    copied++;
  }
  if (copied > 0) afterWrite();
  return { copied, prevYear, prevMonth };
});

// ============================================
// Import / Export
// ============================================

// Adds every record from an exported file that isn't here yet. Never
// overwrites or deletes existing data.
export const importData = locked(async (data) => {
  const counts = await addMissingRecords(data || {});
  afterWrite();
  return counts;
});

export const exportData = async () => {
  await initDB();
  const local = await readLocalDataset();
  return {
    ...Object.fromEntries(RECORD_KEYS.map(k => [k, local[k]])),
    categories: groupCategories(local.categories),
    deleted: local.deleted,
    exportedAt: new Date().toISOString(),
  };
};

// ============================================
// Currency
// ============================================

export const CURRENCY = {
  code: 'GEL',
  symbol: '₾',
  locale: 'ka-GE',
};

export const formatCurrency = (amount) => {
  return new Intl.NumberFormat('ka-GE', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount) + ' ₾';
};

// ============================================
// Cloud Sync (Supabase)
// ============================================

// 'off' (not configured) | 'signed-out' | 'syncing' | 'synced' | 'error'
let syncStatus = { state: isSupabaseConfigured() ? 'signed-out' : 'off', at: null, error: null };
const statusListeners = new Set();
const setSyncStatus = (patch) => {
  syncStatus = { ...syncStatus, ...patch };
  statusListeners.forEach(fn => { try { fn(syncStatus); } catch { /* listener error */ } });
};
export const getSyncStatus = () => syncStatus;
export const onSyncStatus = (fn) => {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
};

// Fired when a sync brought in changes from another device.
export const DATA_CHANGED_EVENT = 'finance-data-changed';

export const isCloudSyncEnabled = () => isSupabaseConfigured() && isSignedIn();

const isEmptyDataset = (d) => RECORD_KEYS.every(k => !d[k]?.length);

// Write the merged dataset into IndexedDB. Only records that differ are put;
// a local record is only removed when it is tombstoned (or is a redundant
// seed category). Everything happens in one atomic transaction.
const applyMergedLocally = async (local, merged) => {
  const plan = {};
  for (const store of DATA_STORES) {
    const localMap = new Map((local[store] || []).map(r => [r.id, stableStringify(r)]));
    const mergedIds = new Set(merged[store].map(r => r.id));
    const puts = merged[store].filter(r => localMap.get(r.id) !== stableStringify(r));
    const deletes = [...localMap.keys()].filter(id => !mergedIds.has(id) && (
      (store === 'categories' && merged.droppedSeedIds?.has(id)) || merged.deleted[store]?.[id]
    ));
    plan[store] = { puts, deletes };
  }
  await runAtomic([...DATA_STORES, 'settings'], (s) => {
    for (const store of DATA_STORES) {
      plan[store].puts.forEach(r => s[store].put(r));
      plan[store].deletes.forEach(id => s[store].delete(id));
    }
    s.settings.put({ key: TOMBSTONE_KEY, value: merged.deleted });
  });
};

const doSync = async () => {
  if (!isCloudSyncEnabled()) {
    setSyncStatus({ state: isSupabaseConfigured() ? 'signed-out' : 'off' });
    return { success: false, error: 'not-signed-in' };
  }
  setSyncStatus({ state: 'syncing' });

  let row;
  try {
    row = await readCloudRow();
  } catch (err) {
    // Couldn't reach the cloud: keep local data as is and never push over it.
    setSyncStatus({ state: 'error', error: err.message });
    return { success: false, error: err.message };
  }
  const cloudDoc = row?.data || null;

  const plan = await withLock(async () => {
    await initDB();
    const seq = getChangeSeq();
    const local = await readLocalDataset();

    // Which side wins when both changed the same record: this device if it has
    // unsynced edits. On the very first sync with this version, fall back to
    // the old timestamp comparison.
    let preferLocal = hasUnsyncedChanges();
    if (!hasEverSynced()) {
      let mtime = null;
      try { mtime = localStorage.getItem(LEGACY_MTIME_KEY); } catch { /* ignore */ }
      preferLocal = !!(mtime && row?.updated_at && new Date(mtime) > new Date(row.updated_at));
    }

    const merged = mergeDatasets(local, cloudDoc || {}, { preferLocal });
    const localChanged = !datasetsEqual(local, merged);
    if (localChanged) {
      saveSnapshot(local);
      await applyMergedLocally(local, merged);
    }
    const needPush = cloudDoc ? !datasetsEqual(cloudDoc, merged) : !isEmptyDataset(merged);
    return { seq, merged, localChanged, needPush };
  });

  if (plan.needPush) {
    try {
      await writeCloudRow(toCloudDocument(plan.merged, cloudDoc));
    } catch (err) {
      setSyncStatus({ state: 'error', error: err.message });
      return { success: false, error: err.message };
    }
  }

  try { localStorage.setItem(SYNCED_SEQ_KEY, String(plan.seq)); } catch { /* ignore */ }
  if (plan.localChanged) {
    scheduleBackup();
    window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
  }
  setSyncStatus({ state: 'synced', at: new Date(), error: null });
  return { success: true, pulled: plan.localChanged, pushed: plan.needPush };
};

let syncInFlight = null;
let syncQueued = false;

// Merge local and cloud data in both directions. Safe to call any time.
export const syncNow = () => {
  if (syncInFlight) {
    syncQueued = true;
    return syncInFlight;
  }
  syncInFlight = doSync().then((result) => {
    syncInFlight = null;
    const queued = syncQueued;
    syncQueued = false;
    // Changes made while this sync ran are picked up by another pass. After a
    // failure, wait for the next edit or a manual sync instead of retrying in
    // a tight loop.
    if (result.success && (queued || hasUnsyncedChanges())) triggerAutoSync();
    return result;
  });
  return syncInFlight;
};

export const startupCloudSync = () => syncNow();

// Debounced sync after each change.
let syncTimeout = null;
export const triggerAutoSync = () => {
  if (!isCloudSyncEnabled()) return;
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => { syncNow(); }, 2000);
};

// Push pending changes when the tab is hidden or closed instead of waiting for
// the debounce (which a closing tab would never reach).
if (typeof window !== 'undefined') {
  const flush = () => {
    if (isCloudSyncEnabled() && hasUnsyncedChanges()) {
      clearTimeout(syncTimeout);
      syncNow();
    }
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

export const getLastSyncTime = async () => {
  try {
    const row = await readCloudRow();
    return row?.updated_at || null;
  } catch { return null; }
};
