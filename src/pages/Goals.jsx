import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import SavingsGoals from '../components/SavingsGoals';
import Wishlist from './Wishlist';

// Savings goals and the wishlist rendered together on one page.
// /goals#savings and /goals#wishlist scroll to the matching section.
function Goals() {
  const { hash } = useLocation();

  useEffect(() => {
    if (!hash) return;
    // Both sections load their data asynchronously; wait a moment so the
    // target is in its final position before scrolling.
    const t = setTimeout(() => {
      document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 250);
    return () => clearTimeout(t);
  }, [hash]);

  return (
    <div className="goals-page">
      <section id="savings" className="goals-section">
        <SavingsGoals />
      </section>
      <section id="wishlist" className="goals-section">
        <Wishlist />
      </section>
    </div>
  );
}

export default Goals;
