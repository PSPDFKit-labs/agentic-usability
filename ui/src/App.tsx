import { Routes, Route, NavLink } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { TestCases } from './pages/TestCases';
import { TestCaseDetail } from './pages/TestCaseDetail';
import { SuiteEditor } from './pages/SuiteEditor';
import { ConfigEditor } from './pages/ConfigEditor';
const colors = {
  bg: '#0d1117',
  sidebar: '#161b22',
  border: '#30363d',
  text: '#e6edf3',
  textMuted: '#8b949e',
  accent: '#58a6ff',
};

const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/cases', label: 'Test Cases' },
  { to: '/suite', label: 'Suite Editor' },
  { to: '/config', label: 'Config' },
];

export function App() {
  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        background: colors.bg,
        color: colors.text,
        overflow: 'hidden',
      }}
    >
      {/* Sidebar */}
      <aside
        style={{
          width: '220px',
          flexShrink: 0,
          background: colors.sidebar,
          borderRight: `1px solid ${colors.border}`,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Branding */}
        <div
          style={{
            padding: '20px 16px 16px',
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <div
            style={{
              fontSize: '14px',
              fontWeight: 600,
              color: colors.accent,
              letterSpacing: '0.02em',
            }}
          >
            Agentic Usability
          </div>
          <div
            style={{
              fontSize: '11px',
              color: colors.textMuted,
              marginTop: '2px',
            }}
          >
            Evaluation Platform
          </div>
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, padding: '12px 8px' }}>
          {navItems.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              style={({ isActive }) => ({
                display: 'block',
                padding: '8px 12px',
                borderRadius: '6px',
                marginBottom: '2px',
                fontSize: '13px',
                fontWeight: isActive ? 600 : 400,
                color: isActive ? colors.accent : colors.text,
                background: isActive ? 'rgba(88, 166, 255, 0.1)' : 'transparent',
                textDecoration: 'none',
                transition: 'background 0.15s, color 0.15s',
              })}
              onMouseEnter={(e) => {
                const el = e.currentTarget;
                if (!el.getAttribute('aria-current')) {
                  el.style.background = 'rgba(255, 255, 255, 0.05)';
                }
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget;
                if (!el.getAttribute('aria-current')) {
                  el.style.background = 'transparent';
                }
              }}
            >
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div
          style={{
            padding: '12px 16px',
            borderTop: `1px solid ${colors.border}`,
            fontSize: '11px',
            color: colors.textMuted,
          }}
        >
          v0.1.0
        </div>
      </aside>

      {/* Main content */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <header
          style={{
            height: '48px',
            borderBottom: `1px solid ${colors.border}`,
            display: 'flex',
            alignItems: 'center',
            padding: '0 24px',
            background: colors.sidebar,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: '13px',
              color: colors.textMuted,
              fontWeight: 500,
            }}
          >
            Agentic Usability
          </span>
        </header>

        {/* Route content */}
        <main
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '24px',
          }}
        >
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/cases" element={<TestCases />} />
            <Route path="/cases/:id" element={<TestCaseDetail />} />
            <Route path="/suite" element={<SuiteEditor />} />
            <Route path="/config" element={<ConfigEditor />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
