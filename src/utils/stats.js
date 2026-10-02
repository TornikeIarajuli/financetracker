// Pure aggregations shared by Dashboard and Reports. Keep chart logic here so a
// fix lands in both pages at once.
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { ka } from 'date-fns/locale';
import { parseDate, inMonth, inRange } from './dates';

// Bucket for expenses whose category no longer resolves. They still count
// toward totals, so the charts never report less than the stat cards.
export const OTHER_CAT_KEY = '__other__';
const OTHER_CAT = { name: 'სხვა', color: '#94a3b8', icon: '📦' };

export const QUARTER_LABELS = ['I კვარტალი', 'II კვარტალი', 'III კვარტალი', 'IV კვარტალი'];

const sum = (list) => list.reduce((s, t) => s + (Number(t.amount) || 0), 0);
const NO_IDS = new Set();

export const flatCategories = (categories) => [
  ...(categories?.expense || []),
  ...(categories?.income || []),
];

// Money moved into savings is recorded as an expense in a "დანაზოგი"
// category. It isn't spending, so totals report it separately as `saved`.
// Detected by name (or an explicit `isSavings` flag) — stored data is untouched.
export const isSavingsCategory = (cat) =>
  !!cat && cat.type !== 'income' && (cat.isSavings === true || /დანაზოგ/.test(cat.name || ''));

export const savingsCategoryIds = (categories) =>
  new Set(flatCategories(categories).filter(isSavingsCategory).map(c => c.id));

// income, expenses (= real spending, savings excluded), saved, and balance
// (= income − spending − saved, i.e. what's left after both).
export const totalsOf = (transactions, savingsIds = NO_IDS) => {
  const income = sum(transactions.filter(t => t.type === 'income'));
  const outflow = transactions.filter(t => t.type === 'expense');
  const saved = sum(outflow.filter(t => savingsIds.has(t.categoryId)));
  const expenses = sum(outflow) - saved;
  return { income, expenses, saved, balance: income - expenses - saved };
};

export const monthlyStats = (transactions, year, month, savingsIds = NO_IDS) => {
  const filtered = transactions.filter(t => inMonth(t, year, month));
  return { ...totalsOf(filtered, savingsIds), transactions: filtered };
};

// Same as monthlyStats but only up to (and including) day `day` — used to
// compare a month in progress with the same days of another month.
export const monthToDateStats = (transactions, year, month, day, savingsIds = NO_IDS) => {
  const filtered = transactions.filter(t => {
    const d = parseDate(t.date);
    return !!d && d.getFullYear() === year && d.getMonth() === month && d.getDate() <= day;
  });
  return { ...totalsOf(filtered, savingsIds), transactions: filtered };
};

// For trend lines whose last point is a month still in progress: moves the
// last value into `${key}Partial` (and repeats the previous value there so the
// dashed segment connects), letting charts draw that stretch dashed.
export const markPartialLast = (rows, keys, isPartial) => {
  if (!isPartial || rows.length < 2) return rows;
  const last = rows.length - 1;
  return rows.map((r, i) => {
    const out = { ...r };
    keys.forEach(k => {
      out[`${k}Partial`] = i >= last - 1 ? r[k] : null;
      if (i === last) out[k] = null;
    });
    return out;
  });
};

// Years that have at least one transaction, plus the current year, newest first.
export const yearsWithData = (transactions) => {
  const years = new Set([new Date().getFullYear()]);
  transactions.forEach(t => {
    const d = parseDate(t.date);
    if (d) years.add(d.getFullYear());
  });
  return [...years].sort((a, b) => b - a);
};

const yearBounds = (year) => [new Date(year, 0, 1), endOfMonth(new Date(year, 11, 1))];

// Expense totals per category id for a list of transactions, keyed by id
// (names are not unique) with unknown categories folded into OTHER_CAT_KEY.
export const spendingByCategory = (transactions, categories) => {
  const byId = new Map(flatCategories(categories).map(c => [c.id, c]));
  const map = {};
  transactions.forEach(t => {
    if (t.type !== 'expense' || isSavingsCategory(byId.get(t.categoryId))) return;
    const cat = byId.get(t.categoryId);
    const key = cat ? t.categoryId : OTHER_CAT_KEY;
    if (!map[key]) {
      const src = cat || OTHER_CAT;
      map[key] = { id: key, name: src.name, color: src.color || OTHER_CAT.color, icon: src.icon || OTHER_CAT.icon, value: 0 };
    }
    map[key].value += Number(t.amount) || 0;
  });
  return Object.values(map).sort((a, b) => b.value - a.value);
};

export const yearCategoryTotals = (transactions, categories, year) => {
  const [start, end] = yearBounds(year);
  return spendingByCategory(transactions.filter(t => inRange(t, start, end)), categories)
    .filter(c => c.value > 0)
    .map(c => ({ ...c, total: c.value }));
};

const bucketKey = (t, knownIds) => (knownIds.has(t.categoryId) ? t.categoryId : OTHER_CAT_KEY);

// Rows for a stacked bar chart: one per month (or quarter) of `year` up to now,
// with a numeric field per category id in `cats`.
export const stackedCategoryData = (transactions, categories, cats, year, grouping) => {
  const now = new Date();
  const knownIds = new Set(flatCategories(categories).map(c => c.id));
  const periods = grouping === 'quarterly'
    ? [1, 2, 3, 4].map(q => ({
        label: `Q${q}`,
        start: new Date(year, (q - 1) * 3, 1),
        end: endOfMonth(new Date(year, q * 3 - 1, 1)),
      }))
    : Array.from({ length: 12 }, (_, m) => ({
        label: format(new Date(year, m, 1), 'LLL', { locale: ka }),
        start: startOfMonth(new Date(year, m, 1)),
        end: endOfMonth(new Date(year, m, 1)),
      }));

  return periods.filter(p => p.start <= now).map(p => {
    const entry = { period: p.label };
    cats.forEach(c => { entry[c.id] = 0; });
    transactions.forEach(t => {
      if (t.type !== 'expense' || !inRange(t, p.start, p.end)) return;
      const k = bucketKey(t, knownIds);
      if (entry[k] !== undefined) entry[k] += Number(t.amount) || 0;
    });
    return entry;
  });
};

export const quarterlySummary = (transactions, year, savingsIds = NO_IDS) => {
  const now = new Date();
  return [1, 2, 3, 4].map((q, i) => {
    const start = new Date(year, (q - 1) * 3, 1);
    if (start > now) return null;
    const end = endOfMonth(new Date(year, q * 3 - 1, 1));
    return { label: QUARTER_LABELS[i], ...totalsOf(transactions.filter(t => inRange(t, start, end)), savingsIds) };
  }).filter(Boolean);
};

export const categoryMonthlyTrend = (transactions, categoryId, year) => {
  if (!categoryId) return [];
  const now = new Date();
  const data = [];
  for (let m = 0; m < 12; m++) {
    const date = new Date(year, m, 1);
    if (date > now) break;
    const amount = sum(transactions.filter(t =>
      t.categoryId === categoryId && t.type === 'expense' && inMonth(t, year, m)
    ));
    data.push({ month: format(date, 'LLL', { locale: ka }), amount });
  }
  return data;
};
