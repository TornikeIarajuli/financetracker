import { useState, useEffect } from 'react';
import { getSavingsGoals, addSavingsGoal, updateSavingsGoal, deleteSavingsGoal, addToSavingsGoal } from '../store/db';
import { parseDate } from '../utils/dates';

const GOAL_ICONS = ['🎯', '🏠', '🚗', '✈️', '💻', '📱', '🎮', '💍', '🎓', '💰', '🏦', '🎁'];

const CURRENCIES = [
  { code: 'GEL', symbol: '₾', name: 'ლარი' },
  { code: 'USD', symbol: '$', name: 'დოლარი' },
  { code: 'EUR', symbol: '€', name: 'ევრო' },
  { code: 'GBP', symbol: '£', name: 'ფუნტი' },
  { code: 'TRY', symbol: '₺', name: 'ლირა' },
];

const formatGoalAmount = (amount, currencyCode = 'GEL') => {
  const curr = CURRENCIES.find(c => c.code === currencyCode) || CURRENCIES[0];
  const formatted = new Intl.NumberFormat('ka-GE', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${formatted} ${curr.symbol}`;
};

export default function SavingsGoals() {
  const [goals, setGoals] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showAddFundsModal, setShowAddFundsModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState(null);
  const [selectedGoal, setSelectedGoal] = useState(null);
  const [addAmount, setAddAmount] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    targetAmount: '',
    currentAmount: '',
    deadline: '',
    icon: '🎯',
    color: '#3b82f6',
    currency: 'GEL',
  });

  async function loadGoals() {
    setIsLoading(true);
    const data = await getSavingsGoals();
    setGoals(data.sort((a, b) => {
      const progressA = a.currentAmount / a.targetAmount;
      const progressB = b.currentAmount / b.targetAmount;
      return progressB - progressA;
    }));
    setIsLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadGoals();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.targetAmount) return;

    const goalData = {
      name: formData.name,
      targetAmount: parseFloat(formData.targetAmount),
      currentAmount: parseFloat(formData.currentAmount) || 0,
      deadline: formData.deadline || null,
      icon: formData.icon,
      color: formData.color,
      currency: formData.currency || 'GEL',
    };

    if (editingGoal) {
      await updateSavingsGoal(editingGoal.id, goalData);
    } else {
      await addSavingsGoal(goalData);
    }

    setShowModal(false);
    setEditingGoal(null);
    resetForm();
    loadGoals();
  };

  const handleEdit = (goal) => {
    setEditingGoal(goal);
    setFormData({
      name: goal.name,
      targetAmount: goal.targetAmount.toString(),
      currentAmount: goal.currentAmount.toString(),
      deadline: goal.deadline || '',
      icon: goal.icon,
      color: goal.color,
      currency: goal.currency || 'GEL',
    });
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (confirm('წავშალოთ ეს მიზანი?')) {
      await deleteSavingsGoal(id);
      loadGoals();
    }
  };

  const handleAddFunds = (goal) => {
    setSelectedGoal(goal);
    setAddAmount('');
    setShowAddFundsModal(true);
  };

  const submitAddFunds = async (e) => {
    e.preventDefault();
    if (!addAmount || !selectedGoal) return;
    await addToSavingsGoal(selectedGoal.id, parseFloat(addAmount));
    setShowAddFundsModal(false);
    setSelectedGoal(null);
    setAddAmount('');
    loadGoals();
  };

  const resetForm = () => {
    setFormData({
      name: '',
      targetAmount: '',
      currentAmount: '',
      deadline: '',
      icon: '🎯',
      color: '#3b82f6',
      currency: 'GEL',
    });
  };

  const getProgress = (goal) => (goal.targetAmount > 0
    ? Math.min(100, Math.round(((goal.currentAmount || 0) / goal.targetAmount) * 100))
    : 0);

  const getDaysLeft = (deadline) => {
    if (!deadline) return null;
    const d = parseDate(deadline);
    if (!d) return null;
    const diff = d - new Date();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  if (isLoading) return <div className="savings-goals-widget loading">იტვირთება...</div>;

  return (
    <div className="savings-goals-widget">
      <div className="sg-header">
        <h3>🎯 დანაზოგის მიზნები</h3>
        <button className="sg-add-btn" onClick={() => { resetForm(); setEditingGoal(null); setShowModal(true); }}>
          + დამატება
        </button>
      </div>

      {goals.length === 0 ? (
        <div className="sg-empty">
          <p>მიზნები არ არის დამატებული</p>
          <button onClick={() => setShowModal(true)}>პირველი მიზნის დამატება</button>
        </div>
      ) : (
        <div className="sg-goals-list">
          {goals.map(goal => {
            const progress = getProgress(goal);
            const daysLeft = getDaysLeft(goal.deadline);
            const isComplete = progress >= 100;
            const curr = CURRENCIES.find(c => c.code === (goal.currency || 'GEL')) || CURRENCIES[0];

            return (
              <div key={goal.id} className={`sg-goal-card ${isComplete ? 'complete' : ''}`}>
                <div className="sg-goal-header">
                  <span className="sg-goal-icon" style={{ backgroundColor: goal.color + '20' }}>
                    {goal.icon}
                  </span>
                  <div className="sg-goal-info">
                    <span className="sg-goal-name">{goal.name}</span>
                    <span className="sg-goal-amounts">
                      {formatGoalAmount(goal.currentAmount, goal.currency)} / {formatGoalAmount(goal.targetAmount, goal.currency)}
                    </span>
                    {goal.currency && goal.currency !== 'GEL' && (
                      <span className="sg-currency-tag">{curr.symbol} {curr.code}</span>
                    )}
                  </div>
                  <div className="sg-goal-actions">
                    {!isComplete && (
                      <button className="sg-action-btn add" onClick={() => handleAddFunds(goal)} title="თანხის დამატება">+</button>
                    )}
                    <button className="sg-action-btn edit" onClick={() => handleEdit(goal)} title="რედაქტირება">✏️</button>
                    <button className="sg-action-btn delete" onClick={() => handleDelete(goal.id)} title="წაშლა">🗑️</button>
                  </div>
                </div>
                <div className="sg-progress-bar">
                  <div className="sg-progress-fill" style={{ width: `${progress}%`, backgroundColor: goal.color }} />
                </div>
                <div className="sg-goal-footer">
                  <span className="sg-progress-text">{progress}%</span>
                  {daysLeft !== null && (
                    <span className={`sg-deadline ${daysLeft < 0 ? 'overdue' : daysLeft < 30 ? 'soon' : ''}`}>
                      {daysLeft < 0 ? `${Math.abs(daysLeft)} დღე გადაცილებულია` : `${daysLeft} დღე დარჩა`}
                    </span>
                  )}
                  {isComplete && <span className="sg-complete-badge">✓ მიღწეულია!</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit Goal Modal */}
      {showModal && (
        <div className="sg-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="sg-modal" onClick={e => e.stopPropagation()}>
            <h3>{editingGoal ? 'მიზნის რედაქტირება' : 'ახალი მიზანი'}</h3>
            <form onSubmit={handleSubmit}>
              <div className="sg-form-group">
                <label>სახელი</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="მაგ: ახალი ლეპტოპი"
                  required
                />
              </div>

              <div className="sg-form-group">
                <label>ვალუტა</label>
                <div className="sg-currency-picker">
                  {CURRENCIES.map(c => (
                    <button
                      key={c.code}
                      type="button"
                      className={`sg-currency-btn ${formData.currency === c.code ? 'selected' : ''}`}
                      onClick={() => setFormData({ ...formData, currency: c.code })}
                    >
                      {c.symbol} {c.code}
                    </button>
                  ))}
                </div>
              </div>

              <div className="sg-form-row">
                <div className="sg-form-group">
                  <label>სამიზნე თანხა</label>
                  <input
                    type="number"
                    value={formData.targetAmount}
                    onChange={e => setFormData({ ...formData, targetAmount: e.target.value })}
                    placeholder="0"
                    min="0"
                    step="0.01"
                    required
                  />
                </div>
                <div className="sg-form-group">
                  <label>მიმდინარე თანხა</label>
                  <input
                    type="number"
                    value={formData.currentAmount}
                    onChange={e => setFormData({ ...formData, currentAmount: e.target.value })}
                    placeholder="0"
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>

              <div className="sg-form-group">
                <label>ვადა (არასავალდებულო)</label>
                <input
                  type="date"
                  value={formData.deadline}
                  onChange={e => setFormData({ ...formData, deadline: e.target.value })}
                />
              </div>

              <div className="sg-form-group">
                <label>აიკონი</label>
                <div className="sg-icon-picker">
                  {GOAL_ICONS.map(icon => (
                    <button
                      key={icon}
                      type="button"
                      className={`sg-icon-btn ${formData.icon === icon ? 'selected' : ''}`}
                      onClick={() => setFormData({ ...formData, icon })}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              </div>

              <div className="sg-form-group">
                <label>ფერი</label>
                <input
                  type="color"
                  value={formData.color}
                  onChange={e => setFormData({ ...formData, color: e.target.value })}
                  className="sg-color-input"
                />
              </div>

              <div className="sg-modal-actions">
                <button type="button" onClick={() => setShowModal(false)}>გაუქმება</button>
                <button type="submit" className="primary">{editingGoal ? 'შენახვა' : 'დამატება'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Funds Modal */}
      {showAddFundsModal && selectedGoal && (
        <div className="sg-modal-overlay" onClick={() => setShowAddFundsModal(false)}>
          <div className="sg-modal small" onClick={e => e.stopPropagation()}>
            <h3>თანხის დამატება</h3>
            <p className="sg-modal-subtitle">{selectedGoal.icon} {selectedGoal.name}</p>
            <form onSubmit={submitAddFunds}>
              <div className="sg-form-group">
                <label>
                  თანხა ({CURRENCIES.find(c => c.code === (selectedGoal.currency || 'GEL'))?.symbol || '₾'})
                </label>
                <input
                  type="number"
                  value={addAmount}
                  onChange={e => setAddAmount(e.target.value)}
                  placeholder="0"
                  min="0"
                  step="0.01"
                  autoFocus
                  required
                />
              </div>
              <div className="sg-modal-actions">
                <button type="button" onClick={() => setShowAddFundsModal(false)}>გაუქმება</button>
                <button type="submit" className="primary">დამატება</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
