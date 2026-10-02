import { useSearchParams } from 'react-router-dom';
import SavingsGoals from '../components/SavingsGoals';
import Wishlist from './Wishlist';

const TABS = [
  { id: 'savings', label: '🎯 დანაზოგი' },
  { id: 'wishlist', label: '⭐ სურვილები' },
];

// Savings goals and the wishlist on one page, switched by tab (?tab=...).
function Goals() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'wishlist' ? 'wishlist' : 'savings';

  return (
    <div className="goals-page">
      <div className="report-tabs goals-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setParams({ tab: t.id }, { replace: true })}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'savings' ? <SavingsGoals /> : <Wishlist />}
    </div>
  );
}

export default Goals;
