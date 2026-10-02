// Merge rules for the shared Supabase document.
//
// SHARED FILE: an identical copy lives in finance-app/src/store/syncMerge.js.
// Keep both copies in sync.
//
// The cloud row is a single JSON document that the web app and the mobile app
// both write. The only safe way for two clients to share it is to never let a
// sync drop a record, so:
//   - Records are merged by id (union). A sync never removes a record just
//     because the other side doesn't have it.
//   - A record disappears only when it is listed in `deleted` (a tombstone
//     written when the user explicitly deletes it), unless it was revived
//     (re-imported or restored) after that deletion.
//   - When both sides have the same id, `preferLocal` decides which version
//     wins (local when this device has unsynced edits, otherwise cloud).

// Stores holding arrays of `{ id, ... }` records.
export const RECORD_KEYS = [
  'transactions',
  'wishlist',
  'savingsGoals',
  'monthlyBudgets',
  'monthlyCategories',
  'stocks',
  'recurringTransactions',
];

// Stores where the user can hard-delete records (and so may have tombstones).
export const DELETABLE_KEYS = ['transactions', 'wishlist', 'savingsGoals', 'stocks', 'recurringTransactions'];

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Deterministic JSON so two equal records always compare equal.
export const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isObj(value)) {
    return `{${Object.keys(value).sort()
      .filter(k => value[k] !== undefined)
      .map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

// Categories travel grouped ({ income, expense }) but are stored flat with a
// `type`. Accept either form.
export const flattenCategories = (cats) => {
  if (Array.isArray(cats)) return cats.filter(Boolean);
  return [
    ...((cats && cats.income) || []).filter(Boolean).map(c => ({ ...c, type: c.type || 'income' })),
    ...((cats && cats.expense) || []).filter(Boolean).map(c => ({ ...c, type: c.type || 'expense' })),
  ];
};

export const groupCategories = (flat) => ({
  income: flat.filter(c => c.type === 'income'),
  expense: flat.filter(c => c.type !== 'income'),
});

export const mergeTombstones = (a, b) => {
  const out = {};
  for (const key of DELETABLE_KEYS) {
    const merged = { ...((a && a[key]) || {}) };
    for (const [id, at] of Object.entries((b && b[key]) || {})) {
      if (!merged[id] || at > merged[id]) merged[id] = at;
    }
    if (Object.keys(merged).length) out[key] = merged;
  }
  return out;
};

const isDead = (record, tombs) => {
  const deletedAt = tombs && tombs[record.id];
  if (!deletedAt) return false;
  return !(record.revivedAt && record.revivedAt > deletedAt);
};

const mergeRecords = (localArr, cloudArr, tombs, preferLocal) => {
  const out = new Map();
  for (const r of cloudArr || []) {
    if (r && r.id != null && !isDead(r, tombs)) out.set(r.id, r);
  }
  for (const r of localArr || []) {
    if (!r || r.id == null || isDead(r, tombs)) continue;
    if (!out.has(r.id) || preferLocal) out.set(r.id, r);
  }
  return [...out.values()];
};

// Normalise either side into { records..., categories (flat), deleted }.
export const normalizeDataset = (data) => {
  const d = data || {};
  const out = { categories: flattenCategories(d.categories), deleted: mergeTombstones(d.deleted, {}) };
  for (const key of RECORD_KEYS) out[key] = Array.isArray(d[key]) ? d[key].filter(Boolean) : [];
  return out;
};

// Default categories created on a device that has never synced are marked
// `seed: true`. Once real categories exist, drop every seed that no
// transaction uses, so a fresh install doesn't push a second copy of the
// default categories into the shared data.
const dropRedundantSeeds = (categories, transactions) => {
  const used = new Set(transactions.map(t => t.categoryId));
  const hasReal = categories.some(c => !c.seed);
  const dropped = new Set();
  const kept = categories.filter(c => {
    if (c.seed && hasReal && !used.has(c.id)) {
      dropped.add(c.id);
      return false;
    }
    return true;
  });
  return { kept, dropped };
};

// Merge two datasets (normalized or raw). Returns a normalized dataset.
export const mergeDatasets = (localData, cloudData, { preferLocal }) => {
  const local = normalizeDataset(localData);
  const cloud = normalizeDataset(cloudData);
  const deleted = mergeTombstones(local.deleted, cloud.deleted);

  const merged = { deleted };
  for (const key of RECORD_KEYS) {
    merged[key] = mergeRecords(local[key], cloud[key], deleted[key], preferLocal);
  }

  const allCats = mergeRecords(local.categories, cloud.categories, null, preferLocal);
  const { kept, dropped } = dropRedundantSeeds(allCats, merged.transactions);
  merged.categories = kept;
  merged.droppedSeedIds = dropped;

  if (dropped.size) {
    // A month snapshot built from seeds on the fresh device: take the cloud's
    // version of that month if there is one, otherwise just strip the seeds.
    const cloudMonths = new Map(cloud.monthlyCategories.map(m => [m.id, m]));
    merged.monthlyCategories = merged.monthlyCategories.map(m => {
      const hasSeed = [...(m.income || []), ...(m.expense || [])].some(c => dropped.has(c.id));
      if (!hasSeed) return m;
      if (cloudMonths.has(m.id)) return cloudMonths.get(m.id);
      return {
        ...m,
        income: (m.income || []).filter(c => !dropped.has(c.id)),
        expense: (m.expense || []).filter(c => !dropped.has(c.id)),
      };
    });
  }

  return merged;
};

// Compare two datasets by content (ignores array order).
export const datasetsEqual = (a, b) => {
  const na = normalizeDataset(a);
  const nb = normalizeDataset(b);
  const sig = (d) => stableStringify({
    ...Object.fromEntries([...RECORD_KEYS, 'categories'].map(k =>
      [k, [...d[k]].map(stableStringify).sort()])),
    deleted: d.deleted,
  });
  return sig(na) === sig(nb);
};

// Shape the merged dataset for upload, keeping any keys this client doesn't
// know about (another client may own them).
export const toCloudDocument = (merged, existingDoc) => {
  const doc = { ...(existingDoc || {}) };
  for (const key of RECORD_KEYS) doc[key] = merged[key];
  doc.categories = groupCategories(merged.categories);
  doc.deleted = merged.deleted;
  doc.exportedAt = new Date().toISOString();
  return doc;
};
