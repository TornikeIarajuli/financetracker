import { useState } from 'react';
import { signIn } from '../store/supabase';
import Icon from './Icon';

// Full-screen sign-in shown before any data is rendered.
function LoginScreen({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const result = await signIn(email.trim(), password);
    if (result.success) {
      await onSignedIn();
    } else {
      setError(/invalid/i.test(result.error) ? 'ელ-ფოსტა ან პაროლი არასწორია.' : result.error);
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-logo"><Icon e="💰" size={56} color="var(--primary)" /></div>
        <h1>ფინანსები</h1>
        <p className="login-subtitle">შესასვლელად შეიყვანეთ ელ-ფოსტა და პაროლი</p>
        <input
          type="email"
          placeholder="ელ-ფოსტა"
          autoComplete="username"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoFocus
        />
        <input
          type="password"
          placeholder="პაროლი"
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
        />
        {error && <p className="login-error">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? '...' : 'შესვლა'}
        </button>
      </form>
    </div>
  );
}

export default LoginScreen;
