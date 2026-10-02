import { useState, useEffect, useMemo } from 'react';
import {
  getTransactions,
  addBulkTransactions,
  updateTransaction,
  deleteTransaction,
  deleteTransactionsByDate,
  getCategories,
  getMonthCategories,
  addMonthCategory,
  deleteMonthCategory,
  resetMonthCategoriesToDefaults,
  reorderMonthCategories,
  getMonthlySpendingByCategory,
  getMonthlyBudgets,
  setMonthlyBudget,
  copyPreviousMonthBudgets,
  trimMonthCategoriesToUsed,
  addExistingCategoryToMonth,
  formatCurrency
} from '../store/db';
import { format, subDays, addDays } from 'date-fns';
import { ka } from 'date-fns/locale';
import { parseDate, formatDate, inMonth, isValidDate } from '../utils/dates';

const HISTORY_PAGE = 50;

// Amount fields accept simple sums like "12+5" or "20-3.5" (comma decimals ok).
// Returns null for anything that isn't a valid positive amount.
const parseAmount = (raw) => {
  const text = String(raw ?? '').replace(/\s+/g, '').replace(/,/g, '.');
  if (!text) return null;
  if (!/^[+-]?\d*\.?\d+([+-]\d*\.?\d+)*$/.test(text)) return null;
  const total = (text.match(/[+-]?\d*\.?\d+/g) || []).reduce((s, n) => s + parseFloat(n), 0);
  const rounded = Math.round(total * 100) / 100;
  return rounded > 0 ? rounded : null;
};
const isExpression = (raw) => /\d\s*[+-]\s*\d/.test(String(raw ?? ''));

function Transactions() {
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState({ income: [], expense: [] }); // per-month
  const [allCategories, setAllCategories] = useState({ income: [], expense: [] }); // global (for lookups)
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [isLoading, setIsLoading] = useState(true);
  const [monthlySpending, setMonthlySpending] = useState({});
  const [monthlyBudgets, setMonthlyBudgets] = useState({});
  // The budget panel above is month-scoped; the history must say which month
  // it is showing or July records read as August.
  const [historyThisMonthOnly, setHistoryThisMonthOnly] = useState(true);
  const [bulkFormData, setBulkFormData] = useState({});
  const [bulkIncome, setBulkIncome] = useState('');
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [showBudgetEdit, setShowBudgetEdit] = useState(null);
  const [newCategory, setNewCategory] = useState({ name: '', icon: '📦', color: '#6366f1' });
  const [budgetValue, setBudgetValue] = useState('');
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE);
  const [editingTx, setEditingTx] = useState(null); // copy of the transaction being edited
  const [savedToast, setSavedToast] = useState(null);

  // Drag and drop state
  const [draggedCategory, setDraggedCategory] = useState(null);
  const [dragOverCategory, setDragOverCategory] = useState(null);

  // Search/filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  // An emptied date input must not crash the page; fall back to today.
  const selectedDay = parseDate(selectedDate) || new Date();
  const currentYear = selectedDay.getFullYear();
  const currentMonth = selectedDay.getMonth();

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload month-specific categories when month changes
  useEffect(() => {
    loadMonthCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentYear, currentMonth]);

  useEffect(() => {
    loadMonthlySpending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentYear, currentMonth, transactions, categories]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const y = currentYear;
      const m = currentMonth;
      const [transactionsData, monthCats, globalCats] = await Promise.all([
        getTransactions(),
        getMonthCategories(y, m),
        getCategories(),
      ]);
      setTransactions(transactionsData);
      setCategories(monthCats);
      setAllCategories(globalCats);

      const initialBulk = {};
      monthCats.expense?.forEach(cat => {
        initialBulk[cat.id] = '';
      });
      setBulkFormData(initialBulk);
    } catch (err) {
      console.error('Error loading data:', err);
    }
    setIsLoading(false);
  };

  const loadMonthCategories = async () => {
    try {
      const [monthCats, globalCats] = await Promise.all([
        getMonthCategories(currentYear, currentMonth),
        getCategories(),
      ]);
      setCategories(monthCats);
      setAllCategories(globalCats);
      const initialBulk = {};
      monthCats.expense?.forEach(cat => {
        initialBulk[cat.id] = '';
      });
      setBulkFormData(initialBulk);
    } catch (err) {
      console.error('Error loading month categories:', err);
    }
  };

  const loadMonthlySpending = async () => {
    const [spending, budgets] = await Promise.all([
      getMonthlySpendingByCategory(currentYear, currentMonth),
      getMonthlyBudgets(currentYear, currentMonth),
    ]);
    // Fall back to cat.budget for any category not yet explicitly set per-month
    const merged = { ...budgets };
    categories.expense?.forEach(cat => {
      if (merged[cat.id] === undefined && cat.budget > 0) {
        merged[cat.id] = cat.budget;
      }
    });
    setMonthlySpending(spending);
    setMonthlyBudgets(merged);
  };

  const handleCopyPrevBudgets = async () => {
    const res = await copyPreviousMonthBudgets(currentYear, currentMonth);
    if (!res || res.copied === 0) {
      alert('წინა თვეში ბიუჯეტები არ მოიძებნა');
      return;
    }
    await loadMonthlySpending();
    alert(`${res.copied} ბიუჯეტი გადმოკოპირდა წინა თვიდან`);
  };

  // Calculate last 10 days spending by category
  const last10DaysData = useMemo(() => {
    const days = [];
    const today = selectedDay;

    for (let i = 9; i >= 0; i--) {
      const date = format(subDays(today, i), 'yyyy-MM-dd');
      const dayLabel = format(subDays(today, i), 'd', { locale: ka });
      const dayTransactions = transactions.filter(t => t.date === date && t.type === 'expense');

      const categorySpending = {};
      categories.expense?.forEach(cat => {
        const spent = dayTransactions
          .filter(t => t.categoryId === cat.id)
          .reduce((sum, t) => sum + t.amount, 0);
        categorySpending[cat.id] = spent;
      });

      const totalSpent = Object.values(categorySpending).reduce((a, b) => a + b, 0);
      days.push({ date, dayLabel, spending: categorySpending, total: totalSpent });
    }

    return days;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, categories.expense, selectedDate]);

  const maxDailySpending = useMemo(() => {
    return Math.max(...last10DaysData.map(d => d.total), 1);
  }, [last10DaysData]);

  const handleBulkSubmit = async (e) => {
    e.preventDefault();
    try {
      const transactionsToAdd = [];

      const incomeAmount = parseAmount(bulkIncome);
      if (bulkIncome && !incomeAmount) {
        alert(`შემოსავლის თანხა ვერ გავიგე: "${bulkIncome}"`);
        return;
      }
      if (incomeAmount) {
        // Prefer the salary category, but never silently drop the amount if it
        // was renamed: fall back to any other income category.
        const incomeCats = [...(categories.income || []), ...(allCategories.income || [])].filter(c => !c.archived);
        const incomeCat = incomeCats.find(c => c.name === 'ხელფასი') || incomeCats[0];
        if (!incomeCat) {
          alert('შემოსავლის კატეგორია ვერ მოიძებნა — შემოსავალი არ შეინახა.');
          return;
        }
        transactionsToAdd.push({
          type: 'income',
          amount: incomeAmount,
          description: incomeCat.name,
          categoryId: incomeCat.id,
          date: selectedDate,
          notes: '',
        });
      }

      const invalid = Object.entries(bulkFormData).filter(([, v]) => String(v).trim() && !parseAmount(v));
      if (invalid.length) {
        const names = invalid.map(([id]) => categories.expense?.find(c => c.id === id)?.name || '?').join(', ');
        alert(`თანხა ვერ გავიგე: ${names}`);
        return;
      }

      Object.entries(bulkFormData).forEach(([categoryId, raw]) => {
        const amount = parseAmount(raw);
        if (amount) {
          const cat = categories.expense?.find(c => c.id === categoryId);
          transactionsToAdd.push({
            type: 'expense',
            amount,
            description: cat?.name || 'ხარჯი',
            categoryId: categoryId,
            date: selectedDate,
            notes: '',
          });
        }
      });

      if (transactionsToAdd.length > 0) {
        if (!isValidDate(selectedDate)) {
          alert('აირჩიეთ თარიღი.');
          return;
        }
        await addBulkTransactions(transactionsToAdd);
        await loadData();
        resetForm();
        const total = transactionsToAdd.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        setSavedToast(`✅ შენახულია: ${transactionsToAdd.length} ჩანაწერი${total ? ` · ${formatCurrency(total)}` : ''}`);
        setTimeout(() => setSavedToast(null), 3000);
      }
    } catch (err) {
      console.error('Error saving bulk transactions:', err);
      alert('შენახვა ვერ მოხერხდა. შეყვანილი თანხები ფორმაში დარჩა.');
    }
  };

  const resetForm = () => {
    setBulkIncome('');
    const initialBulk = {};
    categories.expense?.forEach(cat => {
      initialBulk[cat.id] = '';
    });
    setBulkFormData(initialBulk);
  };

  const handleDelete = async (id) => {
    if (confirm('ნამდვილად გსურთ წაშლა?')) {
      await deleteTransaction(id);
      await loadData();
    }
  };

  const handleDeleteDay = async () => {
    const count = dayTransactions.length;
    if (count === 0) return;

    if (confirm(`წავშალოთ დღის ყველა ჩანაწერი? (${count} ჩანაწერი)`)) {
      await deleteTransactionsByDate(selectedDate);
      await loadData();
    }
  };

  const handleAddCategory = async () => {
    if (!newCategory.name.trim()) return;
    await addMonthCategory(currentYear, currentMonth, 'expense', {
      name: newCategory.name,
      icon: newCategory.icon,
      color: newCategory.color,
      budget: 0,
    });
    setNewCategory({ name: '', icon: '📦', color: '#6366f1' });
    setShowAddCategory(false);
    await loadMonthCategories();
  };

  const handleDeleteCategory = async (id) => {
    if (confirm('წავშალოთ კატეგორია ამ თვიდან?')) {
      await deleteMonthCategory(currentYear, currentMonth, id);
      setShowBudgetEdit(null);
      await loadMonthCategories();
    }
  };

  const handleTrimCategories = async () => {
    if (!confirm('ამ თვის სიაში დავტოვოთ მხოლოდ ის კატეგორიები, რომლებიც წინა ან ამ თვეში გამოიყენეთ? ჩანაწერები და კატეგორიები არ წაიშლება — საჭიროებისას „+ დამატება“-დან დააბრუნებთ.')) return;
    const { removed } = await trimMonthCategoriesToUsed(currentYear, currentMonth);
    await loadMonthCategories();
    alert(removed ? `სიიდან მოიხსნა ${removed} გამოუყენებელი კატეგორია.` : 'ყველა კატეგორია გამოყენებულია — არაფერი შეცვლილა.');
  };

  const handleRestoreCategory = async (categoryId) => {
    await addExistingCategoryToMonth(currentYear, currentMonth, categoryId);
    setShowAddCategory(false);
    await loadMonthCategories();
  };

  const handleResetCategories = async () => {
    if (confirm('გსურთ ამ თვის კატეგორიების გადატვირთვა? ეს წაშლის არსებულ კატეგორიებს და დაამატებს ნაგულისხმევს.')) {
      await resetMonthCategoriesToDefaults(currentYear, currentMonth);
      await loadMonthCategories();
    }
  };

  // Filtered transactions for history
  const filteredTransactions = useMemo(() => {
    let filtered = transactions;

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(t =>
        (t.description || '').toLowerCase().includes(query)
      );
    }

    // Scope to the month shown in the budget panel above
    if (historyThisMonthOnly) {
      filtered = filtered.filter(t => inMonth(t, currentYear, currentMonth));
    }

    // Filter by category
    if (filterCategory !== 'all') {
      filtered = filtered.filter(t => t.categoryId === filterCategory);
    }

    // Filter by date range
    if (filterDateFrom) {
      filtered = filtered.filter(t => t.date >= filterDateFrom);
    }
    if (filterDateTo) {
      filtered = filtered.filter(t => t.date <= filterDateTo);
    }

    return filtered;
  }, [transactions, searchQuery, filterCategory, filterDateFrom, filterDateTo, historyThisMonthOnly, currentYear, currentMonth]);

  const hasActiveFilters = searchQuery || filterCategory !== 'all' || filterDateFrom || filterDateTo;

  const clearFilters = () => {
    setSearchQuery('');
    setFilterCategory('all');
    setFilterDateFrom('');
    setFilterDateTo('');
  };

  const handleSaveBudget = async () => {
    if (showBudgetEdit) {
      const amount = parseFloat(budgetValue) || 0;
      await setMonthlyBudget(showBudgetEdit, currentYear, currentMonth, amount);
      setMonthlyBudgets(prev => ({ ...prev, [showBudgetEdit]: amount }));
      setShowBudgetEdit(null);
      setBudgetValue('');
    }
  };

  const openBudgetEdit = (cat) => {
    setShowBudgetEdit(cat.id);
    setBudgetValue((monthlyBudgets[cat.id] || 0).toString());
  };

  // Drag and drop handlers
  const handleDragStart = (e, cat) => {
    setDraggedCategory(cat);
    e.dataTransfer.effectAllowed = 'move';
    e.target.style.opacity = '0.5';
  };

  const handleDragEnd = (e) => {
    e.target.style.opacity = '1';
    setDraggedCategory(null);
    setDragOverCategory(null);
  };

  const handleDragOver = (e, cat) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedCategory && cat.id !== draggedCategory.id) {
      setDragOverCategory(cat.id);
    }
  };

  const handleDragLeave = () => {
    setDragOverCategory(null);
  };

  const handleDrop = async (e, targetCat) => {
    e.preventDefault();
    if (!draggedCategory || draggedCategory.id === targetCat.id) return;

    const currentOrder = [...(categories.expense || [])];
    const draggedIndex = currentOrder.findIndex(c => c.id === draggedCategory.id);
    const targetIndex = currentOrder.findIndex(c => c.id === targetCat.id);

    // Reorder the array
    currentOrder.splice(draggedIndex, 1);
    currentOrder.splice(targetIndex, 0, draggedCategory);

    // Update state immediately for responsive UI
    setCategories({ ...categories, expense: currentOrder });

    // Save new order to month snapshot
    const orderedIds = currentOrder.map(c => c.id);
    await reorderMonthCategories(currentYear, currentMonth, 'expense', orderedIds);

    setDraggedCategory(null);
    setDragOverCategory(null);
  };

  const getCategoryInfo = (categoryId, type) => {
    // Try month categories first, then fall back to global for historical lookups
    return categories[type]?.find(c => c.id === categoryId)
      || allCategories[type]?.find(c => c.id === categoryId)
      || { name: 'უცნობი', icon: '❓', color: '#888' };
  };

  const dayTransactions = transactions.filter(t => t.date === selectedDate);

  const getDayTotal = (dayTrans) => {
    const income = dayTrans.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const expenses = dayTrans.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
    return { income, expenses, balance: income - expenses };
  };

  const dayTotals = getDayTotal(dayTransactions);

  const goToPrevDay = () => setSelectedDate(format(subDays(selectedDay, 1), 'yyyy-MM-dd'));
  const goToNextDay = () => setSelectedDate(format(addDays(selectedDay, 1), 'yyyy-MM-dd'));
  const goToToday = () => setSelectedDate(format(new Date(), 'yyyy-MM-dd'));

  const bulkTotal = Object.values(bulkFormData).reduce((sum, val) => sum + (parseAmount(val) || 0), 0);
  const bulkCount = Object.values(bulkFormData).filter(v => parseAmount(v)).length + (parseAmount(bulkIncome) ? 1 : 0);

  // Expense categories that exist but aren't on this month's list.
  const restorableCategories = (allCategories.expense || [])
    .filter(c => !(categories.expense || []).some(m => m.id === c.id));

  const submitOnEnter = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleBulkSubmit(e);
    }
  };

  const monthName = format(selectedDay, 'LLLL', { locale: ka });

  const openEdit = (t) => setEditingTx({ ...t, amount: String(t.amount ?? '') });

  const handleSaveEdit = async () => {
    const amount = parseFloat(editingTx.amount);
    if (!(amount > 0)) { alert('შეიყვანეთ თანხა.'); return; }
    if (!isValidDate(editingTx.date)) { alert('შეიყვანეთ სწორი თარიღი.'); return; }
    await updateTransaction(editingTx.id, {
      type: editingTx.type,
      amount,
      description: editingTx.description || '',
      categoryId: editingTx.categoryId,
      date: editingTx.date,
      notes: editingTx.notes || '',
    });
    setEditingTx(null);
    await loadData();
  };

  // Calculate over-budget categories for alerts
  const overBudgetCategories = useMemo(() => {
    return categories.expense?.filter(cat => {
      const spent = monthlySpending[cat.id] || 0;
      const budget = monthlyBudgets[cat.id] || 0;
      return budget > 0 && spent > budget;
    }).map(cat => ({
      ...cat,
      spent: monthlySpending[cat.id] || 0,
      over: (monthlySpending[cat.id] || 0) - (monthlyBudgets[cat.id] || 0),
    })) || [];
  }, [categories.expense, monthlySpending, monthlyBudgets]);

  if (isLoading) {
    return (
      <div className="de-page">
        <div className="loading-state">იტვირთება...</div>
      </div>
    );
  }

  return (
    <div className="de-page">
      {/* Header */}
      <div className="de-header">
        <div className="de-date-nav">
          <button className="de-nav-btn" onClick={goToPrevDay}>‹</button>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="de-date-input"
          />
          <button className="de-nav-btn" onClick={goToNextDay}>›</button>
          <button className="de-today-btn" onClick={goToToday}>დღეს</button>
        </div>
        <div className="de-date-display">
          {format(selectedDay, 'EEEE, d MMMM', { locale: ka })}
        </div>
        <div className="de-summary-bar">
          <span className="de-sum income">+{formatCurrency(dayTotals.income)}</span>
          <span className="de-sum expense">-{formatCurrency(dayTotals.expenses)}</span>
          <span className={`de-sum balance ${dayTotals.balance >= 0 ? 'positive' : 'negative'}`}>
            ={formatCurrency(dayTotals.balance)}
          </span>
        </div>
      </div>

      {/* Budget Alerts */}
      {overBudgetCategories.length > 0 && (
        <div className="de-budget-alerts">
          <div className="de-alerts-header">
            <span className="de-alerts-icon">⚠️</span>
            <span className="de-alerts-title">ბიუჯეტი გადაჭარბებულია!</span>
          </div>
          <div className="de-alerts-list">
            {overBudgetCategories.map(cat => (
              <div key={cat.id} className="de-alert-item">
                <span className="de-alert-icon">{cat.icon}</span>
                <span className="de-alert-name">{cat.name}</span>
                <span className="de-alert-over">+{formatCurrency(cat.over)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="de-main-v2">
        {/* Left: Category cards with budget */}
        <div className="de-categories-panel">
          <div className="de-panel-header">
            <h4>{monthName} - ბიუჯეტი
              {(() => {
                const totalBudget = Object.values(monthlyBudgets).reduce((s, v) => s + (v || 0), 0);
                return totalBudget > 0 ? <span className="de-header-budget-total"> · {formatCurrency(totalBudget)}</span> : null;
              })()}
            </h4>
            <div className="de-header-actions">
              <button className="de-reset-btn" onClick={handleCopyPrevBudgets} title="ბიუჯეტების გადმოკოპირება წინა თვიდან">📋</button>
              <button className="de-reset-btn" onClick={handleTrimCategories} title="დატოვე მხოლოდ წინა/ამ თვეში გამოყენებული კატეგორიები">🧹</button>
              <button className="de-reset-btn" onClick={handleResetCategories} title="კატეგორიების გადატვირთვა">🔄</button>
              <button className="de-add-btn" onClick={() => setShowAddCategory(true)}>+ დამატება</button>
            </div>
          </div>

          <p className="de-quick-hint">ჩაწერეთ თანხები და დააჭირეთ Enter-ს. შეიძლება შეკრებაც: <code>12+5</code></p>

          <form onSubmit={handleBulkSubmit} className="de-quick-list">
            {/* Income */}
            <label className={`de-quick-row income ${parseAmount(bulkIncome) ? 'has-value' : ''}`}>
              <span className="de-quick-icon">💼</span>
              <span className="de-quick-main">
                <span className="de-quick-name">შემოსავალი</span>
              </span>
              <span className="de-quick-input">
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={bulkIncome}
                  onChange={(e) => setBulkIncome(e.target.value)}
                  onKeyDown={submitOnEnter}
                  placeholder="0"
                />
                {isExpression(bulkIncome) && parseAmount(bulkIncome) && <span className="de-quick-sum">= {parseAmount(bulkIncome)}</span>}
              </span>
            </label>

            {/* Expense categories */}
            {categories.expense?.map(cat => {
              const spent = monthlySpending[cat.id] || 0;
              const budget = monthlyBudgets[cat.id] || 0;
              const percent = budget > 0 ? (spent / budget) * 100 : 0;
              const isOver = budget > 0 && spent > budget;
              const isComplete = budget > 0 && spent === budget;
              const isDanger = budget > 0 && percent >= 80 && !isOver && !isComplete;
              const overAmount = isOver ? spent - budget : 0;
              const displayPercent = budget > 0 ? Math.round(percent) : 0;
              const isDragOver = dragOverCategory === cat.id;
              const raw = bulkFormData[cat.id] || '';
              const value = parseAmount(raw);

              return (
                <div
                  key={cat.id}
                  className={`de-quick-row ${isOver ? 'over-budget' : ''} ${isComplete ? 'complete-budget' : ''} ${isDanger ? 'danger-budget' : ''} ${isDragOver ? 'drag-over' : ''} ${value ? 'has-value' : ''} ${raw && !value ? 'invalid' : ''}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, cat)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, cat)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, cat)}
                >
                  <span className="de-quick-icon" style={{ backgroundColor: cat.color + '25' }} title="გადაათრიე რიგის შესაცვლელად">{cat.icon}</span>
                  <span className="de-quick-main">
                    <span className="de-quick-name">
                      {cat.name}
                      {isOver && <span className="de-over-badge">⚠️ +{formatCurrency(overAmount)}</span>}
                      {isComplete && <span className="de-complete-badge">✅</span>}
                      {isDanger && <span className="de-danger-badge">⚠️ {displayPercent}%</span>}
                    </span>
                    <span className="de-quick-stats">
                      <span className={`de-spent ${isOver ? 'over' : isComplete ? 'complete' : ''}`}>{formatCurrency(spent)}</span>
                      {budget > 0 && <span className="de-budget"> / {formatCurrency(budget)}</span>}
                    </span>
                    {budget > 0 && (
                      <span className="de-budget-bar">
                        <span
                          className={`de-budget-fill ${isOver ? 'over' : ''} ${isComplete ? 'complete' : ''} ${isDanger ? 'danger' : ''}`}
                          style={{ width: `${Math.min(percent, 100)}%`, backgroundColor: isOver ? '#ef4444' : isComplete ? '#22c55e' : isDanger ? '#f59e0b' : cat.color }}
                        />
                      </span>
                    )}
                  </span>
                  <span className="de-quick-input">
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      aria-label={cat.name}
                      value={raw}
                      onChange={(e) => setBulkFormData({ ...bulkFormData, [cat.id]: e.target.value })}
                      onKeyDown={submitOnEnter}
                      placeholder="0"
                    />
                    {isExpression(raw) && value && <span className="de-quick-sum">= {value}</span>}
                  </span>
                  <button
                    type="button"
                    className="de-cat-menu"
                    onClick={() => openBudgetEdit(cat)}
                    title="ბიუჯეტის რედაქტირება"
                  >⚙️</button>
                </div>
              );
            })}
          </form>

          {/* Sticky save bar */}
          <div className="de-form-footer de-quick-footer">
            <div className="de-form-totals">
              {savedToast
                ? <span className="de-saved-toast">{savedToast}</span>
                : <span>{bulkCount > 0 ? `${bulkCount} ჩანაწერი · ` : ''}სულ: <strong className="expense">{formatCurrency(bulkTotal)}</strong></span>}
            </div>
            <div className="de-form-actions">
              <button type="button" className="de-btn secondary" onClick={resetForm} disabled={bulkCount === 0}>გასუფთავება</button>
              <button type="button" className="de-btn primary" onClick={handleBulkSubmit} disabled={bulkCount === 0}>შენახვა</button>
            </div>
          </div>
        </div>

        {/* Right: 10-day chart + history */}
        <div className="de-right-panel">
          {/* Mini chart */}
          <div className="de-mini-chart">
            <h4>ბოლო 10 დღე</h4>
            <div className="de-chart-bars-v2">
              {last10DaysData.map((day, idx) => (
                <div key={day.date} className="de-bar-col">
                  <div
                    className="de-bar-v2"
                    style={{
                      height: `${(day.total / maxDailySpending) * 100}%`,
                      backgroundColor: idx === 9 ? 'var(--primary)' : 'var(--gray-300)'
                    }}
                    title={`${day.dayLabel}: ${formatCurrency(day.total)}`}
                  />
                  <span className={`de-bar-label ${idx === 9 ? 'today' : ''}`}>{day.dayLabel}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Today's history */}
          <div className="de-history-v2">
            <div className="de-history-header">
              <h4>დღის ჩანაწერები ({dayTransactions.length})</h4>
              {dayTransactions.length > 0 && (
                <button className="de-delete-day-btn" onClick={handleDeleteDay} title="დღის წაშლა">
                  🗑️ დღის წაშლა
                </button>
              )}
            </div>
            {dayTransactions.length > 0 ? (
              <div className="de-history-list-v2">
                {dayTransactions.map(t => {
                  const cat = getCategoryInfo(t.categoryId, t.type);
                  return (
                    <div key={t.id} className="de-hist-row">
                      <span className="de-hist-icon" style={{ backgroundColor: cat.color + '25' }}>{cat.icon}</span>
                      <span className="de-hist-name">{t.description}</span>
                      <span className={`de-hist-amount ${t.type}`}>
                        {t.type === 'income' ? '+' : '-'}{formatCurrency(t.amount)}
                      </span>
                      <button className="de-hist-edit" onClick={() => openEdit(t)} title="რედაქტირება">✎</button>
                      <button className="de-hist-del" onClick={() => handleDelete(t.id)}>×</button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="de-empty">დღეს ჩანაწერები არ არის</p>
            )}

          </div>
        </div>
      </div>

      {/* Transaction History with Search/Filter */}
      <div className="de-history-section">
        <div className="de-history-header">
          <h4>📋 ტრანზაქციების ისტორია — {historyThisMonthOnly ? monthName : 'ყველა თვე'} ({filteredTransactions.length})</h4>
          <button
            type="button"
            className="de-reset-btn"
            onClick={() => setHistoryThisMonthOnly(v => !v)}
            title={historyThisMonthOnly ? 'ყველა თვის ჩვენება' : 'მხოლოდ ამ თვის ჩვენება'}
          >{historyThisMonthOnly ? 'ყველა თვე' : monthName}</button>
        </div>
        <div className="transaction-filters">
          <input
            type="text"
            className="filter-search"
            placeholder="🔍 ძებნა..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <select
            className="filter-select"
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
          >
            <option value="all">ყველა კატეგორია</option>
            <optgroup label="შემოსავალი">
              {allCategories.income?.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
              ))}
            </optgroup>
            <optgroup label="ხარჯები">
              {allCategories.expense?.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
              ))}
            </optgroup>
          </select>
          <input
            type="date"
            className="filter-date"
            value={filterDateFrom}
            onChange={e => setFilterDateFrom(e.target.value)}
            placeholder="დან"
          />
          <input
            type="date"
            className="filter-date"
            value={filterDateTo}
            onChange={e => setFilterDateTo(e.target.value)}
            placeholder="მდე"
          />
          {hasActiveFilters && (
            <button className="filter-clear" onClick={clearFilters}>გასუფთავება</button>
          )}
        </div>
        <div className="de-history-list-full">
          {filteredTransactions.slice(0, historyLimit).map(t => {
            const cat = getCategoryInfo(t.categoryId, t.type);
            return (
              <div key={t.id} className="de-hist-row">
                <span className="de-hist-date">{formatDate(t.date, 'd MMM yyyy')}</span>
                <span className="de-hist-icon" style={{ backgroundColor: cat.color + '25' }}>{cat.icon}</span>
                <span className="de-hist-name">{t.description}</span>
                <span className={`de-hist-amount ${t.type}`}>
                  {t.type === 'income' ? '+' : '-'}{formatCurrency(t.amount)}
                </span>
                <button className="de-hist-edit" onClick={() => openEdit(t)} title="რედაქტირება">✎</button>
                <button className="de-hist-del" onClick={() => handleDelete(t.id)}>×</button>
              </div>
            );
          })}
          {filteredTransactions.length > historyLimit && (
            <button
              type="button"
              className="de-btn secondary de-show-more"
              onClick={() => setHistoryLimit(l => l + HISTORY_PAGE)}
            >
              მეტის ჩვენება ({filteredTransactions.length - historyLimit} დარჩა)
            </button>
          )}
          {filteredTransactions.length === 0 && (
            <p className="de-empty">ტრანზაქციები ვერ მოიძებნა</p>
          )}
        </div>
      </div>

      {/* Edit Transaction Modal */}
      {editingTx && (
        <div className="de-modal-overlay" onClick={() => setEditingTx(null)}>
          <div className="de-modal" onClick={e => e.stopPropagation()}>
            <h3>ჩანაწერის რედაქტირება</h3>
            <div className="de-modal-form">
              <div className="de-form-group">
                <label>ტიპი</label>
                <select
                  value={editingTx.type}
                  onChange={e => setEditingTx({ ...editingTx, type: e.target.value, categoryId: '' })}
                >
                  <option value="expense">ხარჯი</option>
                  <option value="income">შემოსავალი</option>
                </select>
              </div>
              <div className="de-form-group">
                <label>კატეგორია</label>
                <select
                  value={editingTx.categoryId || ''}
                  onChange={e => setEditingTx({ ...editingTx, categoryId: e.target.value })}
                >
                  <option value="">—</option>
                  {(allCategories[editingTx.type] || [])
                    .filter(c => !c.archived || c.id === editingTx.categoryId)
                    .map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                </select>
              </div>
              <div className="de-form-group">
                <label>აღწერა</label>
                <input
                  type="text"
                  value={editingTx.description || ''}
                  onChange={e => setEditingTx({ ...editingTx, description: e.target.value })}
                />
              </div>
              <div className="de-form-group">
                <label>თანხა (₾)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editingTx.amount}
                  onChange={e => setEditingTx({ ...editingTx, amount: e.target.value })}
                />
              </div>
              <div className="de-form-group">
                <label>თარიღი</label>
                <input
                  type="date"
                  value={isValidDate(editingTx.date) ? editingTx.date : ''}
                  onChange={e => setEditingTx({ ...editingTx, date: e.target.value })}
                />
                {!isValidDate(editingTx.date) && (
                  <small style={{ color: 'var(--danger)' }}>არასწორი თარიღი: "{editingTx.date}" — აირჩიეთ სწორი</small>
                )}
              </div>
              <div className="de-form-group">
                <label>შენიშვნა</label>
                <input
                  type="text"
                  value={editingTx.notes || ''}
                  onChange={e => setEditingTx({ ...editingTx, notes: e.target.value })}
                />
              </div>
            </div>
            <div className="de-modal-actions">
              <button className="de-btn secondary" onClick={() => setEditingTx(null)}>გაუქმება</button>
              <button className="de-btn primary" onClick={handleSaveEdit}>შენახვა</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Category Modal */}
      {showAddCategory && (
        <div className="de-modal-overlay" onClick={() => setShowAddCategory(false)}>
          <div className="de-modal" onClick={e => e.stopPropagation()}>
            {restorableCategories.length > 0 && (
              <>
                <h3>არსებული კატეგორიის დაბრუნება</h3>
                <p className="de-quick-hint">ისტორია შენარჩუნდება — იგივე კატეგორია ბრუნდება სიაში.</p>
                <div className="de-restore-list">
                  {restorableCategories.map(c => (
                    <button key={c.id} type="button" className="de-restore-chip" onClick={() => handleRestoreCategory(c.id)}>
                      {c.icon} {c.name}{c.archived ? ' (არქივი)' : ''}
                    </button>
                  ))}
                </div>
              </>
            )}
            <h3>ახალი კატეგორია</h3>
            <div className="de-modal-form">
              <div className="de-form-group">
                <label>სახელი</label>
                <input
                  type="text"
                  value={newCategory.name}
                  onChange={e => setNewCategory({ ...newCategory, name: e.target.value })}
                  placeholder="კატეგორიის სახელი"
                />
              </div>
              <div className="de-form-group">
                <label>ხატულა</label>
                <div className="de-emoji-grid">
                  {['🛒','🚕','👤','🏪','❓','📄','📱','🏠','💎','🎮','⛽','🏦','💼','🎓','🍔','☕','🎬','✈️','🏥','👶','🐾','🎵','📦','💡','🔧','👗','💻','🎁','🏋️','📚','🚗','🍕','🎨','💊','🧹','📸','🌍','🎯','🏖️','🎪'].map(emoji => (
                    <button
                      key={emoji}
                      type="button"
                      className={`de-emoji-btn ${newCategory.icon === emoji ? 'selected' : ''}`}
                      onClick={() => setNewCategory({ ...newCategory, icon: emoji })}
                    >{emoji}</button>
                  ))}
                </div>
              </div>
              <div className="de-form-group">
                <label>ფერი</label>
                <div className="de-color-grid">
                  {['#ef4444','#f97316','#f59e0b','#22c55e','#14b8a6','#06b6d4','#0ea5e9','#3b82f6','#6366f1','#8b5cf6','#a855f7','#ec4899'].map(color => (
                    <button
                      key={color}
                      type="button"
                      className={`de-color-btn ${newCategory.color === color ? 'selected' : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setNewCategory({ ...newCategory, color })}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="de-modal-actions">
              <button className="de-btn secondary" onClick={() => setShowAddCategory(false)}>გაუქმება</button>
              <button className="de-btn primary" onClick={handleAddCategory}>დამატება</button>
            </div>
          </div>
        </div>
      )}

      {/* Budget Edit Modal */}
      {showBudgetEdit && (
        <div className="de-modal-overlay" onClick={() => setShowBudgetEdit(null)}>
          <div className="de-modal" onClick={e => e.stopPropagation()}>
            <h3>ბიუჯეტი — {monthName}</h3>
            <div className="de-modal-form">
              <div className="de-form-group">
                <label>თანხა (₾)</label>
                <input
                  type="number"
                  value={budgetValue}
                  onChange={e => setBudgetValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveBudget(); if (e.key === 'Escape') setShowBudgetEdit(null); }}
                  placeholder="0"
                  min="0"
                  step="1"
                  autoFocus
                />
              </div>
            </div>
            <div className="de-modal-actions">
              <button
                className="de-btn danger"
                onClick={() => handleDeleteCategory(showBudgetEdit)}
              >წაშლა</button>
              <button className="de-btn secondary" onClick={() => setShowBudgetEdit(null)}>გაუქმება</button>
              <button className="de-btn primary" onClick={handleSaveBudget}>შენახვა</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default Transactions;
