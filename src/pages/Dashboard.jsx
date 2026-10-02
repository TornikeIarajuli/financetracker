import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer,
  AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Legend,
} from 'recharts';
import {
  getTransactions, getCategories, getWishlist,
  formatCurrency, getSavingsGoals, addToSavingsGoal,
  getMonthlyBudgets, setMonthlyBudget,
} from '../store/db';
import { format, subMonths, isSameMonth } from 'date-fns';
import { ka } from 'date-fns/locale';
import { parseDate } from '../utils/dates';
import {
  monthlyStats, spendingByCategory, yearCategoryTotals, stackedCategoryData,
  quarterlySummary as buildQuarterlySummary, categoryMonthlyTrend, yearsWithData,
} from '../utils/stats';

function Dashboard() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [isLoading, setIsLoading] = useState(true);
  const [allTransactions, setAllTransactions] = useState([]);
  const [categoriesData, setCategoriesData] = useState({ income: [], expense: [] });
  const [wishlistCount, setWishlistCount] = useState(0);
  const [savingsGoalsList, setSavingsGoalsList] = useState([]);
  const [showAddSavingsModal, setShowAddSavingsModal] = useState(false);
  const [addSavingsAmount, setAddSavingsAmount] = useState('');
  const [selectedSavingsGoal, setSelectedSavingsGoal] = useState(null);

  // Per-month budget state
  const [monthlyBudgets, setMonthlyBudgets] = useState({});
  const [editingBudget, setEditingBudget] = useState(null);
  const [budgetInput, setBudgetInput] = useState('');

  // Comparison state
  const [compareMonth, setCompareMonth] = useState(null);

  // Year view state (spending bars)
  const [spendViewMode, setSpendViewMode] = useState('month'); // 'month' | 'year'
  const [viewYear, setViewYear] = useState(new Date().getFullYear());

  // Trends section state
  const [trendsYear, setTrendsYear] = useState(String(new Date().getFullYear()));
  const [trendsGrouping, setTrendsGrouping] = useState('monthly');
  const [selectedCategory, setSelectedCategory] = useState('');

  useEffect(() => {
    const initData = async () => {
      // If this month has no transactions yet, open the most recent month that does
      const allTxns = await getTransactions();
      const latest = allTxns.map(t => parseDate(t.date)).find(Boolean); // sorted newest first
      if (latest && !allTxns.some(t => {
        const d = parseDate(t.date);
        return d && isSameMonth(d, new Date());
      })) {
        setCurrentMonth(new Date(latest.getFullYear(), latest.getMonth(), 1));
      }
      setIsLoading(false);
    };
    initData();
  }, []);

  const loadData = async () => {
    try {
      const [transactions, categories, wishlist, savingsGoals, budgets] = await Promise.all([
        getTransactions(),
        getCategories(),
        getWishlist(),
        getSavingsGoals(),
        getMonthlyBudgets(currentMonth.getFullYear(), currentMonth.getMonth()),
      ]);

      // Fall back to cat.budget for any category not yet explicitly set per-month
      const mergedBudgets = { ...budgets };
      (categories.expense || []).forEach(cat => {
        if (mergedBudgets[cat.id] === undefined && cat.budget > 0) {
          mergedBudgets[cat.id] = cat.budget;
        }
      });

      setAllTransactions(transactions);
      setCategoriesData(categories);
      setSavingsGoalsList(savingsGoals);
      setWishlistCount(wishlist.filter(w => !w.purchased).length);
      setMonthlyBudgets(mergedBudgets);
    } catch (err) {
      console.error('Dashboard load error:', err);
    }
  };

  useEffect(() => {
    if (!isLoading) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMonth, isLoading]);

  // ── Derived data (all computed in memory from one transactions read) ──
  const stats = useMemo(
    () => monthlyStats(allTransactions, currentMonth.getFullYear(), currentMonth.getMonth()),
    [allTransactions, currentMonth]
  );
  const prevMonthStats = useMemo(() => {
    const prev = subMonths(currentMonth, 1);
    return monthlyStats(allTransactions, prev.getFullYear(), prev.getMonth());
  }, [allTransactions, currentMonth]);
  const monthlyData = useMemo(() => Array.from({ length: 6 }, (_, i) => {
    const d = subMonths(currentMonth, 5 - i);
    const s = monthlyStats(allTransactions, d.getFullYear(), d.getMonth());
    return { month: format(d, 'MMM', { locale: ka }), income: s.income, expenses: s.expenses };
  }), [allTransactions, currentMonth]);
  const categoryData = useMemo(
    () => spendingByCategory(stats.transactions, categoriesData),
    [stats, categoriesData]
  );
  const compareSpending = useMemo(() => {
    if (!compareMonth) return {};
    const s = monthlyStats(allTransactions, compareMonth.getFullYear(), compareMonth.getMonth());
    return Object.fromEntries(spendingByCategory(s.transactions, categoriesData).map(c => [c.id, c.value]));
  }, [allTransactions, compareMonth, categoriesData]);
  const yearlyCatData = useMemo(
    () => yearCategoryTotals(allTransactions, categoriesData, viewYear),
    [allTransactions, categoriesData, viewYear]
  );
  const savingsStats = useMemo(() => {
    const total = savingsGoalsList.reduce((s, g) => s + (g.currentAmount || 0), 0);
    const target = savingsGoalsList.reduce((s, g) => s + (g.targetAmount || 0), 0);
    return { total, goalCount: savingsGoalsList.length, progress: target > 0 ? Math.round((total / target) * 100) : 0 };
  }, [savingsGoalsList]);

  const handleAddSavings = async (e) => {
    e.preventDefault();
    if (!addSavingsAmount || !selectedSavingsGoal) return;
    await addToSavingsGoal(selectedSavingsGoal, parseFloat(addSavingsAmount));
    setShowAddSavingsModal(false);
    setAddSavingsAmount('');
    setSelectedSavingsGoal(null);
    loadData();
  };

  const handleBudgetSave = async (categoryId) => {
    const amount = parseFloat(budgetInput) || 0;
    await setMonthlyBudget(categoryId, currentMonth.getFullYear(), currentMonth.getMonth(), amount);
    setMonthlyBudgets(prev => ({ ...prev, [categoryId]: amount }));
    setEditingBudget(null);
  };

  const getChangePct = (current, prev) => {
    if (prev === 0) return null;
    return ((current - prev) / prev * 100).toFixed(0);
  };

  if (isLoading) {
    return <div className="dashboard"><div className="loading-state">იტვირთება...</div></div>;
  }

  const incomePct = getChangePct(stats.income, prevMonthStats.income);
  const expensesPct = getChangePct(stats.expenses, prevMonthStats.expenses);
  const spendRatio = stats.income > 0 ? Math.round((stats.expenses / stats.income) * 100) : 0;
  const catTotal = categoryData.reduce((s, c) => s + c.value, 0); // used by spending bars

  const today = new Date();
  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const daysLeft = isSameMonth(currentMonth, today) ? Math.max(daysInMonth - today.getDate() + 1, 1) : 0;
  const dailyBudget = daysLeft > 0 && stats.balance > 0 ? stats.balance / daysLeft : null;

  // Trends computed values
  const trendsYearNum = parseInt(trendsYear, 10);
  const topCats = yearCategoryTotals(allTransactions, categoriesData, trendsYearNum);
  const stackedData = stackedCategoryData(allTransactions, categoriesData, topCats, trendsYearNum, trendsGrouping);
  const quarterlySummary = buildQuarterlySummary(allTransactions, trendsYearNum);
  const categoryTrendData = categoryMonthlyTrend(allTransactions, selectedCategory, trendsYearNum);
  const selectedCatInfo = selectedCategory ? [...(categoriesData.expense || [])].find(c => c.id === selectedCategory) : null;
  const selectedCatTotal = categoryTrendData.reduce((s, d) => s + d.amount, 0);
  const activeTrendMonths = categoryTrendData.filter(d => d.amount > 0).length;

  return (
    <div className="dashboard">
      <header className="page-header">
        <h2>მთავარი</h2>
        <div className="month-selector">
          <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>←</button>
          <span>{format(currentMonth, 'LLLL yyyy', { locale: ka })}</span>
          <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}>→</button>
          {!isSameMonth(currentMonth, new Date()) && (
            <button className="btn-today" onClick={() => setCurrentMonth(new Date())}>დღეს</button>
          )}
        </div>
      </header>

      {/* Stat Cards */}
      <div className="db-stats-row">
        <div className="db-stat income">
          <div className="db-stat-icon">📈</div>
          <div className="db-stat-body">
            <span className="db-stat-label">შემოსავალი</span>
            <span className="db-stat-value">{formatCurrency(stats.income)}</span>
            {incomePct !== null && (
              <span className={`db-stat-change ${Number(incomePct) >= 0 ? 'pos' : 'neg'}`}>
                {Number(incomePct) >= 0 ? '↑' : '↓'} {Math.abs(incomePct)}% წინა თვის
              </span>
            )}
          </div>
        </div>

        <div className="db-stat expenses">
          <div className="db-stat-icon">📉</div>
          <div className="db-stat-body">
            <span className="db-stat-label">ხარჯები</span>
            <span className="db-stat-value">{formatCurrency(stats.expenses)}</span>
            {expensesPct !== null && (
              <span className={`db-stat-change ${Number(expensesPct) <= 0 ? 'pos' : 'neg'}`}>
                {Number(expensesPct) >= 0 ? '↑' : '↓'} {Math.abs(expensesPct)}% წინა თვის
              </span>
            )}
          </div>
        </div>

        <div className="db-stat balance">
          <div className="db-stat-icon">💰</div>
          <div className="db-stat-body">
            <span className="db-stat-label">ბალანსი</span>
            <span className={`db-stat-value ${stats.balance >= 0 ? 'positive' : 'negative'}`}>
              {formatCurrency(stats.balance)}
            </span>
            <span className="db-stat-sub">{spendRatio}% დახარჯული</span>
          </div>
        </div>

        <div className="db-stat daily">
          <div className="db-stat-icon">📅</div>
          <div className="db-stat-body">
            <span className="db-stat-label">დღიური ლიმიტი</span>
            {dailyBudget !== null ? (
              <>
                <span className="db-stat-value positive">{formatCurrency(Math.floor(dailyBudget))}</span>
                <span className="db-stat-sub">{daysLeft} დღე დარჩა</span>
              </>
            ) : (
              <span className="db-stat-value" style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                {daysLeft === 0 ? 'თვე გავიდა' : 'ბალანსი 0'}
              </span>
            )}
          </div>
        </div>

        <div className="db-stat savings" onClick={() => setShowAddSavingsModal(true)}>
          <div className="db-stat-icon">🎯</div>
          <div className="db-stat-body">
            <span className="db-stat-label">დანაზოგი</span>
            <span className="db-stat-value">{formatCurrency(savingsStats.total)}</span>
            {savingsStats.goalCount > 0 && (
              <span className="db-stat-sub">{savingsStats.goalCount} მიზანი · {savingsStats.progress}%</span>
            )}
          </div>
          <div className="db-stat-action-badge">+</div>
        </div>

        <div className="db-stat wishlist">
          <div className="db-stat-icon">⭐</div>
          <div className="db-stat-body">
            <span className="db-stat-label">სურვილები</span>
            <span className="db-stat-value">{wishlistCount}</span>
            <span className="db-stat-sub">შეუსრულებელი</span>
          </div>
        </div>
      </div>

      {/* Row 1: 6-month trend (full width) */}
      <div className="db-card">
        <div className="db-card-header">
          <h3>6-თვიანი ტრენდი</h3>
          <div className="db-legend-row">
            <span className="db-legend-item"><span className="db-dot" style={{ background: '#22c55e' }} /> შემოსავალი</span>
            <span className="db-legend-item"><span className="db-dot" style={{ background: '#ef4444' }} /> ხარჯები</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={monthlyData} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
            <defs>
              <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
            <Tooltip formatter={value => formatCurrency(value)} />
            <Area type="monotone" dataKey="income" stroke="#22c55e" fill="url(#incomeGrad)" strokeWidth={2} name="შემოსავალი" dot={false} />
            <Area type="monotone" dataKey="expenses" stroke="#ef4444" fill="url(#expGrad)" strokeWidth={2} name="ხარჯები" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Row 2: Stacked category trends */}
      <div className="db-card">
        <div className="db-card-header">
          <h3>ხარჯები კატეგორიებით — {trendsYear}</h3>
          <div className="db-card-controls">
            <div className="db-view-toggle">
              {yearsWithData(allTransactions).slice(0, 4).reverse().map(y => (
                <button key={y} className={trendsYear === String(y) ? 'active' : ''} onClick={() => setTrendsYear(String(y))}>{y}</button>
              ))}
            </div>
            <div className="db-view-toggle">
              <button className={trendsGrouping === 'monthly' ? 'active' : ''} onClick={() => setTrendsGrouping('monthly')}>თვეები</button>
              <button className={trendsGrouping === 'quarterly' ? 'active' : ''} onClick={() => setTrendsGrouping('quarterly')}>კვარტლები</button>
            </div>
          </div>
        </div>
        {stackedData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={stackedData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
              <XAxis dataKey="period" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
              <Tooltip content={({ active, payload, label }) => {
                if (!active || !payload) return null;
                const items = payload.filter(p => p.value > 0);
                if (!items.length) return null;
                return (
                  <div style={{ background: 'var(--card-bg, #fff)', border: '1px solid var(--border-color, #e5e7eb)', borderRadius: 8, padding: '8px 12px', fontSize: '0.8rem' }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
                    {items.map((p, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: p.color }}>
                        <span>{p.name}</span>
                        <span style={{ fontWeight: 500 }}>{formatCurrency(p.value)}</span>
                      </div>
                    ))}
                  </div>
                );
              }} />
              <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
              {topCats.map(cat => (
                <Bar key={cat.id} dataKey={cat.id} name={cat.name} stackId="stack" fill={cat.color} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="empty-state-sm">{trendsYear} წელს ხარჯები არ არის</div>
        )}
      </div>

      {/* Row 3: Quarterly summary + category drill-down */}
      <div className="db-second-row">
        <div className="db-card">
          <div className="db-card-header">
            <h3>კვარტლური შეჯამება — {trendsYear}</h3>
          </div>
          {quarterlySummary.length > 0 ? (
            <div className="quarterly-grid">
              {quarterlySummary.map((q, i) => (
                <div key={i} className="quarter-card">
                  <div className="quarter-label">{q.label}</div>
                  <div className="quarter-row">
                    <span className="quarter-stat-name">მაქვს</span>
                    <span className="quarter-stat-value income">{formatCurrency(q.income)}</span>
                  </div>
                  <div className="quarter-row">
                    <span className="quarter-stat-name">ხარჯები</span>
                    <span className="quarter-stat-value expense">{formatCurrency(q.expenses)}</span>
                  </div>
                  <div className="quarter-divider" />
                  <div className="quarter-row">
                    <span className="quarter-stat-name">დამრჩა</span>
                    <span className={`quarter-stat-value ${q.balance >= 0 ? 'income' : 'expense'}`}>{formatCurrency(q.balance)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state-sm">მონაცემები არ არის</div>
          )}
        </div>

        <div className="db-card">
          <div className="db-card-header">
            <h3>კატეგორიის ტენდენცია</h3>
            <select className="filter-select" value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)} style={{ fontSize: '0.75rem' }}>
              <option value="">კატეგორია...</option>
              {(categoriesData.expense || []).filter(c => !c.archived).map(cat => (
                <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
              ))}
            </select>
          </div>
          {selectedCategory ? (
            <>
              <div className="db-trend-meta">
                <span className="trend-meta-chip">სულ {trendsYear}: <strong style={{ color: selectedCatInfo?.color }}>{formatCurrency(selectedCatTotal)}</strong></span>
                <span className="trend-meta-chip">საშ/თვე: <strong>{formatCurrency(activeTrendMonths > 0 ? selectedCatTotal / activeTrendMonths : 0)}</strong></span>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={categoryTrendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                  <Tooltip formatter={value => [formatCurrency(value), selectedCatInfo?.name || '']} />
                  <Area type="monotone" dataKey="amount" stroke={selectedCatInfo?.color || '#ef4444'} fill={`${selectedCatInfo?.color || '#ef4444'}28`} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </AreaChart>
              </ResponsiveContainer>
            </>
          ) : (
            <div className="empty-state-sm">აირჩიეთ კატეგორია ზემოდან</div>
          )}
        </div>
      </div>

      {/* Row 2: Spending bars with budget + compare  |  Savings goals */}
      <div className="db-second-row">

        {/* Spending bars */}
        <div className="db-card">
          <div className="db-card-header">
            <h3>ხარჯები კატეგორიით</h3>
            <div className="db-card-controls">
              <div className="db-view-toggle">
                <button className={spendViewMode === 'month' ? 'active' : ''} onClick={() => setSpendViewMode('month')}>თვე</button>
                <button className={spendViewMode === 'year' ? 'active' : ''} onClick={() => setSpendViewMode('year')}>წელი</button>
              </div>
              {spendViewMode === 'month' ? (
                <div className="db-compare-wrap">
                  {compareMonth ? (
                    <div className="db-compare-nav">
                      <button onClick={() => setCompareMonth(m => subMonths(m, 1))}>←</button>
                      <span>{format(compareMonth, 'MMM yyyy', { locale: ka })}</span>
                      <button onClick={() => setCompareMonth(m => new Date(m.getFullYear(), m.getMonth() + 1))}>→</button>
                      <button className="db-compare-close" onClick={() => setCompareMonth(null)}>✕</button>
                    </div>
                  ) : (
                    <button className="db-link-btn" onClick={() => setCompareMonth(subMonths(currentMonth, 1))}>
                      შედარება
                    </button>
                  )}
                </div>
              ) : (
                <div className="db-compare-nav">
                  <button onClick={() => setViewYear(y => y - 1)}>←</button>
                  <span>{viewYear}</span>
                  <button onClick={() => setViewYear(y => y + 1)}>→</button>
                </div>
              )}
            </div>
          </div>

          {spendViewMode === 'month' && compareMonth && (
            <div className="db-compare-legend">
              <span className="db-dot" style={{ background: '#64748b' }} />
              <span>{format(compareMonth, 'LLLL yyyy', { locale: ka })}</span>
              <span className="db-dot" style={{ background: 'var(--primary)', marginLeft: '0.75rem' }} />
              <span>{format(currentMonth, 'LLLL yyyy', { locale: ka })}</span>
            </div>
          )}

          {spendViewMode === 'month' ? (
            categoryData.length > 0 ? (
              <div className="db-bar-list">
                {categoryData.slice(0, 10).map((cat) => {
                  const budget = monthlyBudgets[cat.id] || 0;
                  const compareVal = compareSpending[cat.id] || 0;
                  const maxForBar = Math.max(catTotal, budget > 0 ? budget : 0, compareMonth ? (Object.values(compareSpending).reduce((s, v) => s + v, 0)) : 0);
                  const currentPct = maxForBar > 0 ? Math.min((cat.value / maxForBar) * 100, 100) : 0;
                  const comparePct = maxForBar > 0 ? Math.min((compareVal / maxForBar) * 100, 100) : 0;
                  const budgetPct = budget > 0 && maxForBar > 0 ? Math.min((budget / maxForBar) * 100, 100) : 0;
                  const isOverBudget = budget > 0 && cat.value > budget;
                  const changePct = compareVal > 0 ? Math.round(((cat.value - compareVal) / compareVal) * 100) : null;

                  return (
                    <div key={cat.id} className="db-bar-item">
                      <div className="db-bar-meta">
                        <span className="db-bar-name">{cat.icon} {cat.name}</span>
                        <div className="db-bar-right">
                          {compareMonth && changePct !== null && (
                            <span className={`db-compare-chip ${changePct > 0 ? 'neg' : 'pos'}`}>
                              {changePct > 0 ? '↑' : '↓'}{Math.abs(changePct)}%
                            </span>
                          )}
                          <span className="db-bar-amt" style={{ color: isOverBudget ? 'var(--danger)' : undefined }}>
                            {formatCurrency(cat.value)}
                          </span>
                          {editingBudget === cat.id ? (
                            <input
                              className="db-budget-input"
                              type="number"
                              value={budgetInput}
                              onChange={e => setBudgetInput(e.target.value)}
                              onBlur={() => handleBudgetSave(cat.id)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleBudgetSave(cat.id);
                                if (e.key === 'Escape') setEditingBudget(null);
                              }}
                              autoFocus
                              placeholder="ლიმიტი"
                            />
                          ) : (
                            <button
                              className={`db-budget-badge ${isOverBudget ? 'over' : budget > 0 ? 'set' : 'unset'}`}
                              onClick={() => { setEditingBudget(cat.id); setBudgetInput(budget > 0 ? String(budget) : ''); }}
                              title="კლიკი ლიმიტის შესაცვლელად"
                            >
                              {budget > 0 ? formatCurrency(budget) : '+ ლიმიტი'}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="db-bar-track">
                        <div className="db-bar-fill" style={{ width: `${currentPct}%`, background: isOverBudget ? '#ef4444' : cat.color }} />
                        {budget > 0 && <div className="db-budget-marker" style={{ left: `${budgetPct}%` }} />}
                      </div>
                      {compareMonth && (
                        <div className="db-bar-track db-compare-track">
                          <div className="db-bar-fill" style={{ width: `${comparePct}%`, background: '#94a3b8' }} />
                          <span className="db-compare-amt">{compareVal > 0 ? formatCurrency(compareVal) : '—'}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state-sm">ხარჯები არ არის</div>
            )
          ) : (
            yearlyCatData.length > 0 ? (
              <div className="db-bar-list">
                {(() => {
                  const nowYear = new Date().getFullYear();
                  const monthsInYear = viewYear < nowYear ? 12 : new Date().getMonth() + 1;
                  const maxVal = yearlyCatData[0]?.value || 1;
                  return yearlyCatData.map(cat => {
                    const pct = Math.min((cat.value / maxVal) * 100, 100);
                    const avg = monthsInYear > 0 ? Math.round(cat.value / monthsInYear) : cat.value;
                    return (
                      <div key={cat.id} className="db-bar-item">
                        <div className="db-bar-meta">
                          <span className="db-bar-name">{cat.icon} {cat.name}</span>
                          <div className="db-bar-right">
                            <div className="db-year-amt-wrap">
                              <span className="db-bar-amt">{formatCurrency(cat.value)}</span>
                              <span className="db-year-avg">⌀ {formatCurrency(avg)}/თვე</span>
                            </div>
                          </div>
                        </div>
                        <div className="db-bar-track">
                          <div className="db-bar-fill" style={{ width: `${pct}%`, background: cat.color }} />
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            ) : (
              <div className="empty-state-sm">{viewYear} წელს ხარჯები არ არის</div>
            )
          )}
        </div>

        {/* Savings goals */}
        <div className="db-card">
          <div className="db-card-header">
            <h3>დანაზოგის მიზნები</h3>
            <button className="db-link-btn" onClick={() => setShowAddSavingsModal(true)}>+ დამატება</button>
          </div>
          {savingsGoalsList.length > 0 ? (
            <div className="db-goals-list">
              {savingsGoalsList.map(goal => {
                const pct = goal.targetAmount > 0 ? Math.min(Math.round((goal.currentAmount / goal.targetAmount) * 100), 100) : 0;
                return (
                  <div key={goal.id} className="db-goal-item">
                    <div className="db-goal-meta">
                      <span className="db-goal-icon">{goal.icon}</span>
                      <div className="db-goal-info">
                        <span className="db-goal-name">{goal.name}</span>
                        <span className="db-goal-amounts">{formatCurrency(goal.currentAmount)} / {formatCurrency(goal.targetAmount)}</span>
                      </div>
                      <span className="db-goal-pct">{pct}%</span>
                    </div>
                    <div className="db-goal-track">
                      <div className="db-goal-fill" style={{ width: `${pct}%`, background: pct >= 100 ? '#22c55e' : 'var(--primary)' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-state-sm">
              <Link to="/savings" className="view-all-link">+ შექმენი პირველი მიზანი</Link>
            </div>
          )}
        </div>
      </div>

      {/* Add to savings modal */}
      {showAddSavingsModal && (
        <div className="modal-overlay" onClick={() => setShowAddSavingsModal(false)}>
          <div className="modal-compact" onClick={e => e.stopPropagation()}>
            <h3>თანხის დამატება</h3>
            <form onSubmit={handleAddSavings}>
              <div className="form-group">
                <label>მიზანი</label>
                <select value={selectedSavingsGoal || ''} onChange={e => setSelectedSavingsGoal(e.target.value)} required>
                  <option value="">აირჩიეთ მიზანი</option>
                  {savingsGoalsList.map(goal => (
                    <option key={goal.id} value={goal.id}>
                      {goal.icon} {goal.name} ({formatCurrency(goal.currentAmount)} / {formatCurrency(goal.targetAmount)})
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>თანხა</label>
                <input
                  type="number"
                  value={addSavingsAmount}
                  onChange={e => setAddSavingsAmount(e.target.value)}
                  placeholder="0"
                  min="0"
                  step="0.01"
                  required
                  autoFocus
                />
              </div>
              <div className="modal-actions">
                <button type="button" onClick={() => setShowAddSavingsModal(false)}>გაუქმება</button>
                <button type="submit" className="primary">დამატება</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
