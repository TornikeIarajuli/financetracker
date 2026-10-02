import { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, NavLink, Link, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import LoginScreen from './components/LoginScreen';
import { useTheme } from './store/ThemeContext';
import { startupCloudSync, getSyncStatus, onSyncStatus, DATA_CHANGED_EVENT, triggerAutoSync } from './store/db';
import { isSupabaseConfigured, isRemembered, onAuthChange } from './store/supabase';
import './App.css';

// Secondary pages load on demand to keep the first bundle small.
const Transactions = lazy(() => import('./pages/Transactions'));
const Reports = lazy(() => import('./pages/Reports'));
const Goals = lazy(() => import('./pages/Goals'));

const SYNC_TITLES = {
  syncing: 'სინქრონიზაცია...',
  synced: 'ღრუბელთან სინქრონიზებულია',
  error: 'სინქრონიზაციის შეცდომა',
};

function App() {
  const { toggleTheme, isDark } = useTheme();
  // 'checking' → 'signed-out' (login screen) | 'signed-in' (app). Nothing
  // from the user's data renders until this is 'signed-in'.
  const [authState, setAuthState] = useState('checking');
  const [syncStatus, setSyncStatus] = useState(getSyncStatus());
  // Bumped when a sync brings in changes from another device, so the open
  // page re-reads its data.
  const [dataVersion, setDataVersion] = useState(0);

  // Pull the latest cloud data before showing the app (bounded, so a slow
  // network never blocks the UI for long).
  const syncThenEnter = async () => {
    setAuthState('checking');
    await Promise.race([startupCloudSync(), new Promise(r => setTimeout(r, 6000))]);
    setAuthState('signed-in');
  };

  useEffect(() => {
    const boot = async () => {
      // Without a configured backend there is nothing to sign in to.
      if (!isSupabaseConfigured()) { setAuthState('signed-in'); return; }
      if (await isRemembered()) await syncThenEnter();
      else setAuthState('signed-out');
    };
    boot();

    const offStatus = onSyncStatus(setSyncStatus);
    const offAuth = onAuthChange(session => {
      if (!session) {
        // Only an explicit sign-out (or a revoked login) ends the session.
        setSyncStatus(getSyncStatus());
        setAuthState(prev => (prev === 'signed-in' ? 'signed-out' : prev));
      } else {
        // Session (re)established — e.g. the token refreshed after being
        // offline — so catch up with the cloud.
        triggerAutoSync();
      }
    });
    const onDataChanged = () => setDataVersion(v => v + 1);
    window.addEventListener(DATA_CHANGED_EVENT, onDataChanged);
    return () => {
      offStatus();
      offAuth();
      window.removeEventListener(DATA_CHANGED_EVENT, onDataChanged);
    };
  }, []);

  if (authState === 'signed-out') {
    return <LoginScreen onSignedIn={syncThenEnter} />;
  }

  if (authState === 'checking') {
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
            <NavLink to="/goals" className={({ isActive }) => isActive ? 'active' : ''}>
              <span className="nav-icon">🎯</span>
              <span className="nav-label">მიზნები</span>
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
              ☁️
            </Link>
          )}
        </div>
      </nav>
      <main className="main-content">
        <Suspense fallback={<div className="loading-state">იტვირთება...</div>}>
          <Routes key={dataVersion}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/goals" element={<Goals />} />
            {/* old addresses keep working */}
            <Route path="/wishlist" element={<Navigate to="/goals#wishlist" replace />} />
            <Route path="/savings" element={<Navigate to="/goals#savings" replace />} />
            <Route path="/reports" element={<Reports />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

export default App;
