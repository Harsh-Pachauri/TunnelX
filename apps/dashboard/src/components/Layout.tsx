import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useDashboardWS } from '../lib/useDashboardWS';

const navLinkClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : '');

export function Layout() {
  const { user, logout } = useAuth();
  useDashboardWS();

  return (
    <div className="app-shell">
      <nav className="nav">
        <span className="nav-brand">TunnelX</span>
        <div className="nav-links">
          <NavLink to="/" end className={navLinkClass}>
            Overview
          </NavLink>
          <NavLink to="/logs" className={navLinkClass}>
            Request Logs
          </NavLink>
        </div>
        <div className="nav-user">
          {user && <span>{user.email}</span>}
          <button type="button" className="btn" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </nav>
      <Outlet />
    </div>
  );
}
