import { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, NavLink, Link } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import { useTheme } from './store/ThemeContext';
import { startupCloudSync, getSyncStatus, onSyncStatus, DATA_CHANGED_EVENT, triggerAutoSync, hasUnsyncedChanges } from './store/db';
import { isSupabaseConfigured, getSession, onAuthChange } from './store/supabase';
import './App.css';

// Secondary pages load on demand to keep the first bundle small.
const Transactions = lazy(() => import('./pages/Transactions'));
const Wishlist = lazy(() => import('./pages/Wishlist'));
const Reports = lazy(() => import('./pages/Reports'));
const SavingsGoals = lazy(() => import('./components/SavingsGoals'));

const SYNC_TITLES = {
  'signed-out': 'ღრუბელი: შედით ანგარიშში (ანგარიში → იმპორტი/ექსპორტი)',
  syncing: 'სინქრონიზაცია...',
  synced: 'ღრუბელთან სინქრონიზებულია',
  error: 'სინქრონიზაციის შეცდომა',
};

function App() {
  const { toggleTheme, isDark } = useTheme();
  const [isReady, setIsReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState(getSyncStatus());
  // Bumped when a sync brings in changes from another device, so the open
  // page re-reads its data.
  const [dataVersion, setDataVersion] = useState(0);

  useEffect(() => {
    const boot = async () => {
      if (isSupabaseConfigured()) {
        const session = await getSession();
        if (session) {
          const timeout = new Promise(r => setTimeout(r, 6000));
          await Promise.race([startupCloudSync(), timeout]);
        }
      }
      setIsReady(true);
    };
    boot();

    const offStatus = onSyncStatus(setSyncStatus);
    const offAuth = onAuthChange(session => {
      if (!session) setSyncStatus(getSyncStatus());
      else if (hasUnsyncedChanges()) triggerAutoSync();
    });
    const onDataChanged = () => setDataVersion(v => v + 1);
    window.addEventListener(DATA_CHANGED_EVENT, onDataChanged);
    return () => {
      offStatus();
      offAuth();
      window.removeEventListener(DATA_CHANGED_EVENT, onDataChanged);
    };
  }, []);

  if (!isReady) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: '12px', color: 'var(--text-muted)', fontSize: '0.95rem' }}>
        <span style={{ fontSize: '2rem' }}>☁️</span>
        სინქრონიზაცია...
      </div>
    );
  }

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="sidebar-header">
          <h1>ფინანსები</h1>
        </div>
        <ul className="nav-links">
          <li>
            <NavLink to="/" className={({ isActive }) => isActive ? 'active' : ''} end>
              <span className="nav-icon">📊</span>
              <span className="nav-label">მთავარი</span>
            </NavLink>
          </li>
          <li>
            <NavLink to="/transactions" className={({ isActive }) => isActive ? 'active' : ''}>
              <span className="nav-icon">💳</span>
              <span className="nav-label">ხარჯი</span>
            </NavLink>
          </li>
          <li>
            <NavLink to="/wishlist" className={({ isActive }) => isActive ? 'active' : ''}>
              <span className="nav-icon">⭐</span>
              <span className="nav-label">სურვილები</span>
            </NavLink>
          </li>
          <li>
            <NavLink to="/savings" className={({ isActive }) => isActive ? 'active' : ''}>
              <span className="nav-icon">🎯</span>
              <span className="nav-label">დანაზოგი</span>
            </NavLink>
          </li>
          <li>
            <NavLink to="/reports" className={({ isActive }) => isActive ? 'active' : ''}>
              <span className="nav-icon">📈</span>
              <span className="nav-label">ანგარიში</span>
            </NavLink>
          </li>
        </ul>
        <div className="sidebar-footer">
          <button className="theme-toggle" onClick={toggleTheme} title={isDark ? 'ნათელი თემა' : 'მუქი თემა'}>
            <span className="theme-icon">{isDark ? '☀️' : '🌙'}</span>
            <span className="theme-label">{isDark ? 'ნათელი' : 'მუქი'}</span>
          </button>
          {syncStatus.state !== 'off' && (
            <Link to="/reports" className="sync-indicator" title={SYNC_TITLES[syncStatus.state] || ''}>
              <span className={`sync-dot ${syncStatus.state === 'synced' ? 'synced' : ''} ${syncStatus.state === 'error' ? 'error' : ''}`} />
              {syncStatus.state === 'signed-out' ? '🔒' : '☁️'}
            </Link>
          )}
        </div>
      </nav>
      <main className="main-content">
        <Suspense fallback={<div className="loading-state">იტვირთება...</div>}>
          <Routes key={dataVersion}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/wishlist" element={<Wishlist />} />
            <Route path="/savings" element={<SavingsGoals />} />
            <Route path="/reports" element={<Reports />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

export default App;
