// Savings goals can be kept in different currencies; amounts must always be
// shown in the goal's own currency (never assumed to be lari).

export const CURRENCIES = [
  { code: 'GEL', symbol: '₾', name: 'ლარი' },
  { code: 'USD', symbol: '$', name: 'დოლარი' },
  { code: 'EUR', symbol: '€', name: 'ევრო' },
  { code: 'GBP', symbol: '£', name: 'ფუნტი' },
  { code: 'TRY', symbol: '₺', name: 'ლირა' },
];

export const currencyOf = (code) => CURRENCIES.find(c => c.code === code) || CURRENCIES[0];

export const formatGoalAmount = (amount, currencyCode = 'GEL') => {
  const formatted = new Intl.NumberFormat('ka-GE', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount || 0);
  return `${formatted} ${currencyOf(currencyCode).symbol}`;
};

// Totals per currency (amounts in different currencies are never added
// together) plus overall progress as the average of the goals' progress.
export const summarizeGoals = (goals) => {
  const byCode = new Map();
  goals.forEach(g => {
    const code = g.currency || 'GEL';
    const row = byCode.get(code) || { code, current: 0, target: 0 };
    row.current += g.currentAmount || 0;
    row.target += g.targetAmount || 0;
    byCode.set(code, row);
  });
  const withTarget = goals.filter(g => g.targetAmount > 0);
  const progress = withTarget.length
    ? Math.round(withTarget.reduce((s, g) => s + Math.min((g.currentAmount || 0) / g.targetAmount, 1), 0) / withTarget.length * 100)
    : 0;
  return { totals: [...byCode.values()], progress, goalCount: goals.length };
};

export const formatTotals = (totals) =>
  totals.length ? totals.map(t => formatGoalAmount(t.current, t.code)).join(' · ') : formatGoalAmount(0);
