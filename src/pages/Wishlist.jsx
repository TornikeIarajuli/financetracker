import { useState, useEffect } from 'react';
import { getWishlist, addWishlistItem, updateWishlistItem, deleteWishlistItem, formatCurrency } from '../store/db';
import { formatDate } from '../utils/dates';

// Only open http(s) links; anything else (e.g. javascript:) is not rendered.
const safeUrl = (url) => (/^https?:\/\//i.test(url || '') ? url : null);

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'დაბალი', color: '#22c55e' },
  { value: 'medium', label: 'საშუალო', color: '#f59e0b' },
  { value: 'high', label: 'მაღალი', color: '#ef4444' },
];

function Wishlist() {
  const [wishlist, setWishlist] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('date');
  const [formData, setFormData] = useState({
    name: '',
    price: '',
    priority: 'medium',
    url: '',
    notes: '',
    targetDate: '',
  });

  async function loadWishlist() {
    const items = await getWishlist();
    setWishlist(items);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadWishlist();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const itemData = {
      ...formData,
      price: formData.price ? parseFloat(formData.price) : 0,
    };

    if (editingItem) {
      await updateWishlistItem(editingItem.id, itemData);
    } else {
      await addWishlistItem(itemData);
    }

    await loadWishlist();
    closeModal();
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      price: item.price?.toString() || '',
      priority: item.priority || 'medium',
      url: item.url || '',
      notes: item.notes || '',
      targetDate: item.targetDate || '',
    });
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (confirm('ნამდვილად გსურთ წაშლა?')) {
      await deleteWishlistItem(id);
      await loadWishlist();
    }
  };

  const togglePurchased = async (item) => {
    await updateWishlistItem(item.id, {
      purchased: !item.purchased,
      purchasedDate: !item.purchased ? new Date().toISOString() : null
    });
    await loadWishlist();
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingItem(null);
    setFormData({
      name: '',
      price: '',
      priority: 'medium',
      url: '',
      notes: '',
      targetDate: '',
    });
  };

  const openAddModal = () => {
    closeModal();
    setShowModal(true);
  };

  const getPriorityInfo = (priority) => {
    return PRIORITY_OPTIONS.find(p => p.value === priority) || PRIORITY_OPTIONS[1];
  };

  let filteredWishlist = wishlist.filter(item => {
    if (filter === 'active') return !item.purchased;
    if (filter === 'purchased') return item.purchased;
    return true;
  });

  filteredWishlist.sort((a, b) => {
    if (sortBy === 'price') return (b.price || 0) - (a.price || 0);
    if (sortBy === 'priority') {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  const totalWishlistValue = wishlist
    .filter(w => !w.purchased)
    .reduce((sum, w) => sum + (w.price || 0), 0);

  return (
    <div className="wishlist-page">
      <header className="page-header">
        <h2>სურვილები</h2>
        <button className="btn btn-primary" onClick={openAddModal}>
          + დამატება
        </button>
      </header>

      <div className="wishlist-summary">
        <div className="summary-card">
          <span className="summary-label">რაოდენობა</span>
          <span className="summary-value">{wishlist.filter(w => !w.purchased).length}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">ჯამი</span>
          <span className="summary-value">{formatCurrency(totalWishlistValue)}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">შეძენილი</span>
          <span className="summary-value">{wishlist.filter(w => w.purchased).length}</span>
        </div>
      </div>

      <div className="filters">
        <div className="filter-group">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="filter-select"
          >
            <option value="all">ყველა</option>
            <option value="active">აქტიური</option>
            <option value="purchased">შეძენილი</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="filter-select"
          >
            <option value="date">თარიღით</option>
            <option value="price">ფასით</option>
            <option value="priority">პრიორიტეტით</option>
          </select>
        </div>
      </div>

      <div className="wishlist-grid">
        {filteredWishlist.map(item => {
          const priorityInfo = getPriorityInfo(item.priority);
          return (
            <div key={item.id} className={`wishlist-card ${item.purchased ? 'purchased' : ''}`}>
              <div className="wishlist-card-header">
                <span
                  className="priority-badge"
                  style={{ backgroundColor: priorityInfo.color + '20', color: priorityInfo.color }}
                >
                  {priorityInfo.label}
                </span>
                <button
                  className={`checkbox ${item.purchased ? 'checked' : ''}`}
                  onClick={() => togglePurchased(item)}
                  title={item.purchased ? 'მონიშვნის გაუქმება' : 'მონიშვნა შეძენილად'}
                >
                  {item.purchased ? '✓' : ''}
                </button>
              </div>

              <h4 className="wishlist-name">{item.name}</h4>

              {item.price > 0 && (
                <p className="wishlist-price">{formatCurrency(item.price)}</p>
              )}

              {item.notes && (
                <p className="wishlist-notes">{item.notes}</p>
              )}

              {item.targetDate && (
                <p className="wishlist-target">
                  სამიზნე: {formatDate(item.targetDate, 'd MMM yyyy')}
                </p>
              )}

              {safeUrl(item.url) && (
                <a href={safeUrl(item.url)} target="_blank" rel="noopener noreferrer" className="wishlist-link">
                  ნახვა →
                </a>
              )}

              {item.purchased && (item.purchasedDate || item.purchasedAt) && (
                <p className="purchased-date">
                  შეძენილი: {formatDate(item.purchasedDate || item.purchasedAt, 'd MMM yyyy')}
                </p>
              )}

              <div className="wishlist-actions">
                <button className="btn btn-icon" onClick={() => handleEdit(item)} title="რედაქტირება">
                  ✏️
                </button>
                <button className="btn btn-icon btn-danger" onClick={() => handleDelete(item.id)} title="წაშლა">
                  🗑️
                </button>
              </div>
            </div>
          );
        })}
        {filteredWishlist.length === 0 && (
          <div className="empty-state">
            <p>
              {filter === 'all' && 'სურვილების სია ცარიელია.'}
              {filter === 'active' && 'აქტიური ნივთები არ არის.'}
              {filter === 'purchased' && 'შეძენილი ნივთები არ არის.'}
            </p>
            {filter !== 'purchased' && (
              <button className="btn btn-primary" onClick={openAddModal}>
                დაამატე პირველი
              </button>
            )}
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingItem ? 'რედაქტირება' : 'ახალი სურვილი'}</h3>
              <button className="btn-close" onClick={closeModal}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>დასახელება *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="რისი ყიდვა გსურთ?"
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>სავარაუდო ფასი (₾)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                    placeholder="0.00"
                  />
                </div>

                <div className="form-group">
                  <label>პრიორიტეტი</label>
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                  >
                    {PRIORITY_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>სამიზნე თარიღი</label>
                <input
                  type="date"
                  value={formData.targetDate}
                  onChange={(e) => setFormData({ ...formData, targetDate: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>ბმული</label>
                <input
                  type="url"
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  placeholder="https://..."
                />
              </div>

              <div className="form-group">
                <label>შენიშვნა</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="ზომა, ფერი, სპეციფიკაცია..."
                  rows="2"
                />
              </div>

              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={closeModal}>
                  გაუქმება
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingItem ? 'განახლება' : 'დამატება'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Wishlist;
