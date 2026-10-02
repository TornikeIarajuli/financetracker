import { useState, useEffect } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area
} from 'recharts';
import {
  getTransactions, getCategories, exportData, importData, formatCurrency,
  syncNow, getSyncStatus, onSyncStatus, getBackupInfo, restoreFromBackup,
  getPreSyncSnapshot, restorePreSyncSnapshot,
  findDuplicateCategories, mergeCategories, getMergedCategories, unmergeCategory,
} from '../store/db';
import { isSupabaseConfigured, isSignedIn, getUserEmail, onAuthChange, signOut } from '../store/supabase';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { ka } from 'date-fns/locale';
import { inRange } from '../utils/dates';
import {
  totalsOf, yearsWithData, yearCategoryTotals, stackedCategoryData,
  savingsCategoryIds, isSavingsCategory, markPartialLast,
  quarterlySummary as buildQuarterlySummary, categoryMonthlyTrend,
} from '../utils/stats';

const RLS_SQL = `-- Supabase → SQL Editor. Does not touch the stored data.
ALTER TABLE finance_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner only" ON finance_data;
CREATE POLICY "owner only" ON finance_data
  FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'email') = 'YOUR_EMAIL')
  WITH CHECK ((auth.jwt() ->> 'email') = 'YOUR_EMAIL');`;

function Reports() {
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState({ income: [], expense: [] });
  const [dateRange, setDateRange] = useState('6');
  const [reportType, setReportType] = useState('overview');
  const [trendsYear, setTrendsYear] = useState(String(new Date().getFullYear()));
  const [trendsGrouping, setTrendsGrouping] = useState('monthly');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [syncStatus, setSyncStatus] = useState(getSyncStatus());
  const [signedIn, setSignedIn] = useState(isSignedIn());
  const [syncMsg, setSyncMsg] = useState('');
  const [duplicates, setDuplicates] = useState([]);
  const [mergedCats, setMergedCats] = useState([]);
  const [pendingMerge, setPendingMerge] = useState(null); // { group } awaiting confirmation
  const [mergeBusy, setMergeBusy] = useState(false);

  async function loadData() {
    const [trans, cats, dups, merged] = await Promise.all([
      getTransactions(), getCategories(), findDuplicateCategories(), getMergedCategories(),
    ]);
    setTransactions(trans);
    setCategories(cats);
    setDuplicates(dups);
    setMergedCats(merged);
  }

  useEffect(() => {
    loadData();
    const offStatus = onSyncStatus(setSyncStatus);
    const offAuth = onAuthChange(session => setSignedIn(!!session));
    return () => { offStatus(); offAuth(); };
  }, []);

  const years = yearsWithData(transactions);
  const savingsIds = savingsCategoryIds(categories);
  const currentYear = new Date().getFullYear();

  // ── Overview helpers ──────────────────────────────────────────

  // { start, end, months } for the selected range. Year ranges are bounded on
  // both sides, so "2025" never includes 2026 transactions.
  const getRange = () => {
    if (dateRange.startsWith('year-')) {
      const year = parseInt(dateRange.slice(5), 10);
      return {
        start: new Date(year, 0, 1),
        end: endOfMonth(new Date(year, 11, 1)),
        months: year < currentYear ? 12 : new Date().getMonth() + 1,
        year,
      };
    }
    const months = parseInt(dateRange, 10) || 6;
    return { start: startOfMonth(subMonths(new Date(), months - 1)), end: endOfMonth(new Date()), months };
  };

  const monthRow = (date) => {
    const mt = transactions.filter(t => inRange(t, startOfMonth(date), endOfMonth(date)));
    const { income, expenses, saved, balance } = totalsOf(mt, savingsIds);
    return { month: format(date, 'LLL', { locale: ka }), income, expenses, saved, left: balance };
  };

  const getMonthlyOverviewData = () => {
    const range = getRange();
    if (range.year) {
      return Array.from({ length: range.months }, (_, m) => monthRow(new Date(range.year, m, 1)));
    }
    return Array.from({ length: range.months }, (_, i) => monthRow(subMonths(new Date(), range.months - 1 - i)));
  };

  const getCategoryBreakdown = (type) => {
    const { start, end } = getRange();
    const breakdown = {};
    transactions.forEach(t => {
      if (t.type !== type || !inRange(t, start, end)) return;
      const cat = categories[type]?.find(c => c.id === t.categoryId);
      // savings transfers aren't spending — they're shown separately
      if (type === 'expense' && isSavingsCategory(cat)) return;
      if (!breakdown[t.categoryId]) {
        breakdown[t.categoryId] = { name: cat?.name || 'უცნობი', value: 0, color: cat?.color || '#888' };
      }
      breakdown[t.categoryId].value += t.amount;
    });
    return Object.values(breakdown).sort((a, b) => b.value - a.value);
  };

  const getTotalStats = () => {
    const { start, end, months } = getRange();
    const filtered = transactions.filter(t => inRange(t, start, end));
    const { income, expenses, saved, balance } = totalsOf(filtered, savingsIds);
    return {
      income, expenses, saved, balance,
      transactionCount: filtered.length,
      avgIncome: income / months,
      avgExpenses: expenses / months,
    };
  };

  // ── Data handlers ─────────────────────────────────────────────

  const handleExport = async () => {
    const data = await exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `finansebi-${format(new Date(), 'yyyy-MM-dd')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      let data;
      try {
        data = JSON.parse(event.target.result);
      } catch {
        alert('შეცდომა იმპორტისას. შეამოწმეთ ფაილის ფორმატი.');
        return;
      }
      if (!confirm('ფაილიდან დაემატება მხოლოდ ის ჩანაწერები, რომლებიც ჯერ არ არის. არსებული მონაცემები არ შეიცვლება. გავაგრძელოთ?')) return;
      const counts = await importData(data);
      await loadData();
      alert(`დაემატა ${counts.transactions} ჩანაწერი, ${counts.categories} კატეგორია.`);
    };
    reader.readAsText(file);
  };

  const handleRestoreBackup = async () => {
    const info = getBackupInfo();
    if (!info) { alert('სარეზერვო ასლი ვერ მოიძებნა.'); return; }
    const d = new Date(info.savedAt).toLocaleString('ka-GE');
    if (!confirm(`სარეზერვო ასლი: ${info.transactionCount} ჩანაწერი, შენახული ${d}.\n\nდაემატება მხოლოდ დაკარგული ჩანაწერები. გავაგრძელოთ?`)) return;
    const result = await restoreFromBackup();
    if (result) { await loadData(); alert(`აღდგა ${result.added} ჩანაწერი.`); }
    else alert('სარეზერვო ასლის აღდგენა ვერ მოხერხდა.');
  };

  const handleRestoreSnapshot = async () => {
    const snap = getPreSyncSnapshot();
    if (!snap) { alert('სინქრონიზაციამდე ასლი არ არის.'); return; }
    const d = new Date(snap.snapshotAt).toLocaleString('ka-GE');
    if (!confirm(`ასლი ${d}: ${snap.transactionCount} ჩანაწერი.\n\nდაემატება მხოლოდ დაკარგული ჩანაწერები. გავაგრძელოთ?`)) return;
    const result = await restorePreSyncSnapshot();
    if (result) { await loadData(); alert(`აღდგა ${result.added} ჩანაწერი.`); }
  };

  const handleSync = async () => {
    setSyncMsg('');
    const result = await syncNow();
    if (result.success) {
      await loadData();
      setSyncMsg('✅ სინქრონიზებულია');
    } else {
      setSyncMsg(`❌ შეცდომა: ${result.error}`);
    }
  };

  const handleSignOut = async () => {
    if (!confirm('გასვლის შემდეგ ხელახლა შესვლა დაგჭირდებათ. მონაცემები არ წაიშლება. გავიდეთ?')) return;
    await signOut();
    setSyncMsg('');
  };

  const runMerge = async () => {
    const [target, ...sources] = pendingMerge.group;
    setMergeBusy(true);
    try {
      let moved = 0;
      for (const src of sources) moved += (await mergeCategories(src.id, target.id)).moved;
      await loadData();
      setSyncMsg(`✅ „${target.name}“ გაერთიანდა — გადავიდა ${moved} ჩანაწერი.`);
    } catch (err) {
      alert(`გაერთიანება ვერ მოხერხდა: ${err.message}`);
    } finally {
      setMergeBusy(false);
      setPendingMerge(null);
    }
  };

  const handleUnmerge = async (cat) => {
    if (!confirm(`გავაუქმოთ „${cat.name}“-ის გაერთიანება? მისი ჩანაწერები ისევ ცალკე კატეგორიაში დაბრუნდება.`)) return;
    const { moved } = await unmergeCategory(cat.id);
    await loadData();
    setSyncMsg(`↩️ გაერთიანება გაუქმდა — დაბრუნდა ${moved} ჩანაწერი.`);
  };

  // ── Computed values ───────────────────────────────────────────

  const monthlyData = getMonthlyOverviewData();
  const rangeEndsNow = !dateRange.startsWith('year-') || parseInt(dateRange.slice(5), 10) === currentYear;
  const overviewTrend = markPartialLast(monthlyData, ['income', 'expenses'], rangeEndsNow);
  const expenseBreakdown = getCategoryBreakdown('expense');
  const incomeBreakdown = getCategoryBreakdown('income');
  const stats = getTotalStats();

  const trendsYearNum = parseInt(trendsYear, 10);
  const topCats = yearCategoryTotals(transactions, categories, trendsYearNum).slice(0, 7);
  const stackedData = stackedCategoryData(transactions, categories, topCats, trendsYearNum, trendsGrouping);
  const quarterlySummary = buildQuarterlySummary(transactions, trendsYearNum, savingsIds);
  const categoryTrendData = categoryMonthlyTrend(transactions, selectedCategory, trendsYearNum);
  const selectedCatInfo = selectedCategory ? categories.expense?.find(c => c.id === selectedCategory) : null;
  const selectedCatTotal = categoryTrendData.reduce((s, d) => s + d.amount, 0);
  const activeTrendMonths = categoryTrendData.filter(d => d.amount > 0).length;

  const TABS = [
    { id: 'overview', label: 'მიმოხილვა' },
    { id: 'trends', label: 'ტენდენციები' },
    { id: 'expenses', label: 'ხარჯები' },
    { id: 'income', label: 'შემოსავალი' },
    { id: 'data', label: 'იმპორტი/ექსპორტი' },
  ];

  return (
    <div className="reports-page">
      <header className="page-header">
        <h2>ანგარიშები</h2>
        {reportType !== 'trends' && reportType !== 'data' && (
          <select value={dateRange} onChange={e => setDateRange(e.target.value)} className="filter-select">
            <option value="3">ბოლო 3 თვე</option>
            <option value="6">ბოლო 6 თვე</option>
            <option value="12">ბოლო 12 თვე</option>
            {years.map(y => (
              <option key={y} value={`year-${y}`}>{y} — {y === currentYear ? 'წლის დასაწყისიდან' : 'სრული წელი'}</option>
            ))}
          </select>
        )}
      </header>

      <div className="report-tabs">
        {TABS.map(tab => (
          <button key={tab.id} className={`tab ${reportType === tab.id ? 'active' : ''}`} onClick={() => setReportType(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {reportType === 'overview' && (
        <div className="report-content">
          <div className="stats-summary">
            <div className="stat-box">
              <span className="stat-label">სულ შემოსავალი</span>
              <span className="stat-value income">{formatCurrency(stats.income)}</span>
              <span className="stat-sub">საშ: {formatCurrency(stats.avgIncome)}/თვე</span>
            </div>
            <div className="stat-box">
              <span className="stat-label">სულ ხარჯები</span>
              <span className="stat-value expense">{formatCurrency(stats.expenses)}</span>
              <span className="stat-sub">საშ: {formatCurrency(stats.avgExpenses)}/თვე</span>
            </div>
            <div className="stat-box">
              <span className="stat-label">დანაზოგში</span>
              <span className="stat-value saved">{formatCurrency(stats.saved)}</span>
              <span className="stat-sub">ხარჯებში არ ითვლება</span>
            </div>
            <div className="stat-box">
              <span className="stat-label">დამრჩა</span>
              <span className={`stat-value ${stats.balance >= 0 ? 'income' : 'expense'}`}>{formatCurrency(stats.balance)}</span>
              <span className="stat-sub">{stats.transactionCount} ტრანზაქცია</span>
            </div>
          </div>

          <div className="chart-section">
            <h3>შემოსავალი vs ხარჯები{rangeEndsNow && <span className="db-partial-note"> · პუნქტირი = მიმდინარე თვე</span>}</h3>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={overviewTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(value) => formatCurrency(value)} />
                <Legend />
                <Area type="monotone" dataKey="income" stroke="#22c55e" fill="#22c55e40" name="შემოსავალი" />
                <Area type="monotone" dataKey="expenses" stroke="#ef4444" fill="#ef444440" name="ხარჯები" />
                {rangeEndsNow && <Area type="monotone" dataKey="incomePartial" stroke="#22c55e" strokeDasharray="5 5" fill="none" legendType="none" name="შემოსავალი (მიმდინარე)" />}
                {rangeEndsNow && <Area type="monotone" dataKey="expensesPartial" stroke="#ef4444" strokeDasharray="5 5" fill="none" legendType="none" name="ხარჯები (მიმდინარე)" />}
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-section">
            <h3>თვიური დანაზოგი და ნაშთი</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(value) => formatCurrency(value)} />
                <Legend />
                <Bar dataKey="saved" name="დანაზოგში" fill="#8b5cf6" />
                <Bar dataKey="left" name="დარჩა" fill="#22c55e">
                  {monthlyData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.left >= 0 ? '#22c55e' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── TRENDS (NEW) ── */}
      {reportType === 'trends' && (
        <div className="report-content">
          <div className="trends-controls">
            <div className="trends-control-group">
              <span className="trends-control-label">წელი</span>
              <div className="trends-toggle-group">
                {[...years].reverse().map(y => (
                  <button key={y} className={`trends-toggle-btn ${trendsYear === String(y) ? 'active' : ''}`} onClick={() => setTrendsYear(String(y))}>{y}</button>
                ))}
              </div>
            </div>
            <div className="trends-control-group">
              <span className="trends-control-label">დაჯგუფება</span>
              <div className="trends-toggle-group">
                <button className={`trends-toggle-btn ${trendsGrouping === 'monthly' ? 'active' : ''}`} onClick={() => setTrendsGrouping('monthly')}>თვეები</button>
                <button className={`trends-toggle-btn ${trendsGrouping === 'quarterly' ? 'active' : ''}`} onClick={() => setTrendsGrouping('quarterly')}>კვარტლები</button>
              </div>
            </div>
          </div>

          {/* Stacked bar chart by category */}
          <div className="chart-section">
            <h3>ხარჯები კატეგორიებით — {trendsYear}</h3>
            {stackedData.length > 0 ? (
              <ResponsiveContainer width="100%" height={340}>
                <BarChart data={stackedData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" />
                  <YAxis tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                  <Tooltip formatter={(value, name) => [formatCurrency(value), name]} />
                  <Legend />
                  {topCats.map(cat => (
                    <Bar key={cat.id} dataKey={cat.id} name={cat.name} stackId="stack" fill={cat.color} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state">ამ წლის ხარჯები არ არის</div>
            )}
          </div>

          {/* Quarterly summary */}
          <div className="chart-section">
            <h3>კვარტლური შეჯამება — {trendsYear}</h3>
            {quarterlySummary.length > 0 ? (
              <div className="quarterly-grid">
                {quarterlySummary.map((q, i) => (
                  <div key={i} className="quarter-card">
                    <div className="quarter-label">{q.label}</div>
                    <div className="quarter-row">
                      <span className="quarter-stat-name">შემოსავალი</span>
                      <span className="quarter-stat-value income">{formatCurrency(q.income)}</span>
                    </div>
                    <div className="quarter-row">
                      <span className="quarter-stat-name">ხარჯები</span>
                      <span className="quarter-stat-value expense">{formatCurrency(q.expenses)}</span>
                    </div>
                    {q.saved > 0 && (
                      <div className="quarter-row">
                        <span className="quarter-stat-name">დანაზოგი</span>
                        <span className="quarter-stat-value saved">{formatCurrency(q.saved)}</span>
                      </div>
                    )}
                    <div className="quarter-divider" />
                    <div className="quarter-row">
                      <span className="quarter-stat-name">დამრჩა</span>
                      <span className={`quarter-stat-value ${q.balance >= 0 ? 'income' : 'expense'}`}>{formatCurrency(q.balance)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">მონაცემები არ არის</div>
            )}
          </div>

          {/* Category drill-down */}
          <div className="chart-section">
            <div className="trends-section-header">
              <h3>კატეგორიის ტენდენცია</h3>
              <select className="filter-select" value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}>
                <option value="">აირჩიეთ კატეგორია...</option>
                {categories.expense?.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
                ))}
              </select>
            </div>

            {selectedCategory ? (
              <>
                <div className="category-trend-meta">
                  <span className="trend-meta-chip">
                    სულ {trendsYear}: <strong style={{ color: selectedCatInfo?.color }}>{formatCurrency(selectedCatTotal)}</strong>
                  </span>
                  <span className="trend-meta-chip">
                    საშ/თვე: <strong>{formatCurrency(activeTrendMonths > 0 ? selectedCatTotal / activeTrendMonths : 0)}</strong>
                  </span>
                  <span className="trend-meta-chip">
                    აქტიური თვეები: <strong>{activeTrendMonths}</strong>
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={categoryTrendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                    <Tooltip formatter={(value) => [formatCurrency(value), selectedCatInfo?.name || 'ხარჯი']} />
                    <Area
                      type="monotone"
                      dataKey="amount"
                      stroke={selectedCatInfo?.color || '#ef4444'}
                      fill={`${selectedCatInfo?.color || '#ef4444'}28`}
                      strokeWidth={2.5}
                      dot={{ r: 4, fill: selectedCatInfo?.color || '#ef4444' }}
                      activeDot={{ r: 6 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </>
            ) : (
              <div className="empty-state">აირჩიეთ კატეგორია ზემოდან, რომ ნახოთ მისი ხარჯვის ტენდენცია</div>
            )}
          </div>
        </div>
      )}

      {/* ── EXPENSES ── */}
      {reportType === 'expenses' && (
        <div className="report-content">
          <div className="chart-grid">
            <div className="chart-section">
              <h3>ხარჯები კატეგორიებით</h3>
              {expenseBreakdown.length > 0 ? (
                <div className="donut-chart-container large">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={expenseBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90}>
                        {expenseBreakdown.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => formatCurrency(value)} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="chart-legend">
                    {expenseBreakdown.slice(0, 8).map((entry, index) => {
                      const total = expenseBreakdown.reduce((sum, e) => sum + e.value, 0);
                      const percent = ((entry.value / total) * 100).toFixed(0);
                      return (
                        <div key={index} className="legend-item">
                          <span className="legend-color" style={{ backgroundColor: entry.color }}></span>
                          <span className="legend-name">{entry.name}</span>
                          <span className="legend-percent">{percent}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="empty-state">ამ პერიოდში ხარჯები არ არის</div>
              )}
            </div>

            <div className="chart-section">
              <h3>ტოპ ხარჯების კატეგორიები</h3>
              <div className="category-bar-list">
                {expenseBreakdown.slice(0, 10).map((cat, index) => {
                  const total = expenseBreakdown.reduce((sum, e) => sum + e.value, 0);
                  const pct = total > 0 ? (cat.value / total) * 100 : 0;
                  return (
                    <div key={index} className="category-bar-row">
                      <div className="category-bar-header">
                        <span className="category-bar-name">
                          <span className="category-bar-dot" style={{ backgroundColor: cat.color }} />
                          {cat.name}
                        </span>
                        <span className="category-bar-amount">{formatCurrency(cat.value)}</span>
                      </div>
                      <div className="category-bar-track">
                        <div className="category-bar-fill" style={{ width: `${pct}%`, backgroundColor: cat.color }} />
                      </div>
                    </div>
                  );
                })}
                {expenseBreakdown.length === 0 && <div className="empty-state">ხარჯები არ არის</div>}
              </div>
            </div>
          </div>

          <div className="chart-section">
            <h3>თვიური ხარჯები</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(value) => formatCurrency(value)} />
                <Bar dataKey="expenses" fill="#ef4444" name="ხარჯები" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── INCOME ── */}
      {reportType === 'income' && (
        <div className="report-content">
          <div className="chart-grid">
            <div className="chart-section">
              <h3>შემოსავალი კატეგორიებით</h3>
              {incomeBreakdown.length > 0 ? (
                <div className="donut-chart-container large">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={incomeBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90}>
                        {incomeBreakdown.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => formatCurrency(value)} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="chart-legend">
                    {incomeBreakdown.map((entry, index) => {
                      const total = incomeBreakdown.reduce((sum, e) => sum + e.value, 0);
                      const percent = ((entry.value / total) * 100).toFixed(0);
                      return (
                        <div key={index} className="legend-item">
                          <span className="legend-color" style={{ backgroundColor: entry.color }}></span>
                          <span className="legend-name">{entry.name}</span>
                          <span className="legend-percent">{percent}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="empty-state">ამ პერიოდში შემოსავალი არ არის</div>
              )}
            </div>

            <div className="chart-section">
              <h3>შემოსავლის წყაროები</h3>
              <div className="category-list">
                {incomeBreakdown.map((cat, index) => (
                  <div key={index} className="category-row">
                    <div className="category-info">
                      <span className="category-rank">#{index + 1}</span>
                      <span className="category-color" style={{ backgroundColor: cat.color }} />
                      <span className="category-name">{cat.name}</span>
                    </div>
                    <span className="category-amount">{formatCurrency(cat.value)}</span>
                  </div>
                ))}
                {incomeBreakdown.length === 0 && <div className="empty-state">შემოსავალი არ არის</div>}
              </div>
            </div>
          </div>

          <div className="chart-section">
            <h3>თვიური შემოსავალი</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(value) => formatCurrency(value)} />
                <Line type="monotone" dataKey="income" stroke="#22c55e" strokeWidth={2} name="შემოსავალი" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── DATA ── */}
      {reportType === 'data' && (
        <div className="report-content">
          <div className={`data-section ${signedIn ? 'cloud-enabled' : ''}`} style={{ borderLeft: signedIn ? '4px solid #3b82f6' : undefined }}>
            <h3>☁️ ღრუბლოვანი სინქრონიზაცია</h3>
            {!isSupabaseConfigured() ? (
              <p>ღრუბლოვანი სინქრონიზაცია არ არის კონფიგურირებული.</p>
            ) : signedIn ? (
              <>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  შესული ხართ: <strong>{getUserEmail()}</strong>
                  {syncStatus.at && <> · ბოლო სინქრონიზაცია: <strong>{syncStatus.at.toLocaleString('ka-GE')}</strong></>}
                </p>
                <p>
                  ცვლილებები ავტომატურად სინქრონიზდება. სინქრონიზაცია აერთიანებს ორივე მხარეს —
                  ჩანაწერი ქრება მხოლოდ მაშინ, როცა თქვენ წაშლით.
                </p>
                {syncStatus.state === 'error' && !syncMsg && (
                  <p style={{ color: '#ef4444', fontWeight: 600 }}>❌ {syncStatus.error}</p>
                )}
                {syncMsg && (
                  <p style={{ fontWeight: 600, margin: '0.5rem 0', color: syncMsg.startsWith('✅') ? '#22c55e' : '#ef4444' }}>
                    {syncMsg}
                  </p>
                )}
                <div className="btn-group">
                  <button className="btn btn-primary" onClick={handleSync} disabled={syncStatus.state === 'syncing'}>
                    {syncStatus.state === 'syncing' ? '⏳ ...' : '🔄 სინქრონიზაცია ახლა'}
                  </button>
                  <button className="btn btn-secondary" onClick={handleSignOut}>გასვლა</button>
                </div>
              </>
            ) : (
              <p>ღრუბელთან კავშირი არ არის — მონაცემები ამ მოწყობილობაზე ინახება და ავტომატურად სინქრონიზდება, როცა ინტერნეტი აღდგება.</p>
            )}
            {isSupabaseConfigured() && (
              <details style={{ marginTop: '1rem' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.85rem' }}>უსაფრთხოების SQL (Row Level Security)</summary>
                <p style={{ fontSize: '0.8rem', marginTop: '0.5rem', color: 'var(--text-muted)' }}>
                  გაუშვით Supabase SQL Editor-ში მას შემდეგ, რაც ორივე აპში შეხვალთ. YOUR_EMAIL შეცვალეთ თქვენი ელ-ფოსტით.
                </p>
                <pre className="code-block">{RLS_SQL}</pre>
              </details>
            )}
          </div>

          {(duplicates.length > 0 || mergedCats.length > 0) && (
            <div className="data-section" style={{ borderLeft: '4px solid #f59e0b' }}>
              <h3>🔀 ერთნაირი სახელის კატეგორიები</h3>
              {duplicates.length > 0 && (
                <p>
                  ეს კატეგორიები ერთნაირად ჰქვია, ამიტომ გრაფიკებში ორჯერ ჩანს. გაერთიანებისას ჩანაწერები
                  გადავა იმ კატეგორიაში, სადაც მეტი ჩანაწერია. არაფერი წაიშლება და შეგიძლიათ გააუქმოთ.
                </p>
              )}
              {duplicates.map(group => (
                <div key={group[0].id} className="dup-group">
                  <div className="dup-items">
                    {group.map((c, i) => (
                      <span key={c.id} className={`dup-chip ${i === 0 ? 'keep' : ''}`}>
                        {c.icon} {c.name} · {c.txCount} ჩანაწერი{i === 0 ? ' (დარჩება)' : ''}
                      </span>
                    ))}
                  </div>
                  <button className="btn btn-primary" onClick={() => setPendingMerge({ group })}>გაერთიანება</button>
                </div>
              ))}
              {mergedCats.length > 0 && (
                <div className="dup-merged">
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>გაერთიანებული:</p>
                  {mergedCats.map(c => (
                    <div key={c.id} className="dup-group">
                      <span className="dup-chip">{c.icon} {c.name}</span>
                      <button className="btn btn-secondary" onClick={() => handleUnmerge(c)}>↩️ გაუქმება</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {pendingMerge && (
            <div className="de-modal-overlay" onClick={() => !mergeBusy && setPendingMerge(null)}>
              <div className="de-modal de-confirm" role="alertdialog" aria-modal="true" onClick={e => e.stopPropagation()}>
                <h3>🔀 „{pendingMerge.group[0].name}“ — გაერთიანება</h3>
                <p className="de-confirm-text">
                  {pendingMerge.group.slice(1).reduce((s, c) => s + c.txCount, 0)} ჩანაწერი გადავა კატეგორიაში
                  „{pendingMerge.group[0].icon} {pendingMerge.group[0].name}“ ({pendingMerge.group[0].txCount} ჩანაწერი).
                  ჩანაწერები და თანხები არ შეიცვლება, მხოლოდ კატეგორია. მეორე კატეგორია დაარქივდება (არ წაიშლება).
                  ყოველთვის შეგიძლიათ გააუქმოთ.
                </p>
                <div className="de-modal-actions">
                  <button className="de-btn secondary" onClick={() => setPendingMerge(null)} disabled={mergeBusy} autoFocus>გაუქმება</button>
                  <button className="de-btn primary" onClick={runMerge} disabled={mergeBusy}>{mergeBusy ? '⏳ ...' : 'გაერთიანება'}</button>
                </div>
              </div>
            </div>
          )}

          <div className="data-section" style={{ borderLeft: '4px solid #22c55e' }}>
            <h3>🛡️ სარეზერვო ასლი (ავტომატური)</h3>
            {(() => {
              const info = getBackupInfo();
              return info ? (
                <p>ბოლო სარეზერვო ასლი: <strong>{new Date(info.savedAt).toLocaleString('ka-GE')}</strong> · {info.transactionCount} ჩანაწერი</p>
              ) : (
                <p>სარეზერვო ასლი ჯერ არ არის. ახალი ჩანაწერის შენახვის შემდეგ ავტომატურად შეიქმნება.</p>
              );
            })()}
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>აღდგენა ამატებს მხოლოდ დაკარგულ ჩანაწერებს — არსებულს არაფერს ცვლის.</p>
            <div className="btn-group">
              <button className="btn btn-primary" onClick={handleRestoreBackup}>♻️ სარეზერვო ასლიდან აღდგენა</button>
              {getPreSyncSnapshot() && (
                <button className="btn btn-secondary" onClick={handleRestoreSnapshot}>⏪ სინქრონიზაციამდე მდგომარეობიდან აღდგენა</button>
              )}
            </div>
          </div>

          <div className="data-section">
            <h3>მონაცემების ექსპორტი</h3>
            <p>ჩამოტვირთეთ თქვენი ფინანსური მონაცემები JSON ფაილის სახით სარეზერვო ასლისთვის.</p>
            <button className="btn btn-primary" onClick={handleExport}>📥 ექსპორტი</button>
          </div>

          <div className="data-section">
            <h3>მონაცემების იმპორტი</h3>
            <p>იმპორტირეთ მონაცემები ადრე ექსპორტირებული JSON ფაილიდან. დაემატება მხოლოდ ახალი ჩანაწერები.</p>
            <label className="btn btn-secondary file-input-label">
              📤 იმპორტი
              <input type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

export default Reports;
