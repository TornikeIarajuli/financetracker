// Transaction dates are stored as 'yyyy-MM-dd' strings. `new Date('2026-01-31')`
// parses that as UTC midnight, which lands on a different local day/month in
// any timezone west of UTC and breaks end-of-period comparisons everywhere else.
// Always go through these helpers instead.
import { format } from 'date-fns';
import { ka } from 'date-fns/locale';

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

// Local-midnight Date for a 'yyyy-MM-dd' string, or null when unparseable.
export const parseDate = (value) => {
  if (!value) return null;
  const m = YMD.exec(value);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const isValidDate = (value) => parseDate(value) !== null;

// 'yyyy-MM-dd' in local time (toISOString() would give the UTC day).
export const toDateStr = (date) => format(date, 'yyyy-MM-dd');

// Formats a stored date; shows the raw value instead of throwing when it is
// malformed, so one bad record cannot crash a whole page.
export const formatDate = (value, pattern) => {
  const d = parseDate(value);
  return d ? format(d, pattern, { locale: ka }) : `⚠️ ${value ?? '—'}`;
};

export const inMonth = (t, year, month) => {
  const d = parseDate(t.date);
  return !!d && d.getFullYear() === year && d.getMonth() === month;
};

export const inRange = (t, start, end) => {
  const d = parseDate(t.date);
  return !!d && (!start || d >= start) && (!end || d <= end);
};
