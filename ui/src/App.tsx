import { Routes, Route, NavLink } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { EvalRun } from './pages/EvalRun';
import { TestCaseDetail } from './pages/TestCaseDetail';
import { SuiteEditor } from './pages/SuiteEditor';
import { ConfigEditor } from './pages/ConfigEditor';
import { RunProvider, useRuns } from './context/RunContext';

const colors = {
  bg: '#0d1117',
  sidebar: '#161b22',
  border: '#30363d',
  text: '#e6edf3',
  textMuted: '#8b949e',
  accent: '#58a6ff',
};

const navLinkStyle = (isActive: boolean): React.CSSProperties => ({
  display: 'block',
  padding: '8px 12px',
  borderRadius: '6px',
  marginBottom: '2px',
  fontSize: '16px',
  fontWeight: isActive ? 600 : 400,
  color: isActive ? colors.accent : colors.text,
  background: isActive ? 'rgba(88, 166, 255, 0.1)' : 'transparent',
  textDecoration: 'none',
  transition: 'background 0.15s, color 0.15s',
});

const onNavEnter = (e: React.MouseEvent<HTMLAnchorElement>) => {
  const el = e.currentTarget;
  if (!el.getAttribute('aria-current')) el.style.background = 'rgba(255, 255, 255, 0.05)';
};
const onNavLeave = (e: React.MouseEvent<HTMLAnchorElement>) => {
  const el = e.currentTarget;
  if (!el.getAttribute('aria-current')) el.style.background = 'transparent';
};

function SidebarNav() {
  const { runs } = useRuns();
  const latestRunId = runs.length > 0 ? runs[0].id : null;

  return (
    <nav style={{ flex: 1, padding: '12px 8px' }}>
      <NavLink to="/" end style={({ isActive }) => navLinkStyle(isActive)} onMouseEnter={onNavEnter} onMouseLeave={onNavLeave}>
        Dashboard
      </NavLink>
      {latestRunId && (
        <NavLink to={`/runs/${latestRunId}`} style={({ isActive }) => navLinkStyle(isActive)} onMouseEnter={onNavEnter} onMouseLeave={onNavLeave}>
          Eval Run
        </NavLink>
      )}
      <NavLink to="/suite" style={({ isActive }) => navLinkStyle(isActive)} onMouseEnter={onNavEnter} onMouseLeave={onNavLeave}>
        Suite Editor
      </NavLink>
      <NavLink to="/config" style={({ isActive }) => navLinkStyle(isActive)} onMouseEnter={onNavEnter} onMouseLeave={onNavLeave}>
        Config
      </NavLink>
    </nav>
  );
}

function AppContent() {
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
        <div
          style={{
            padding: '20px 16px 16px',
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <div style={{ fontSize: '16px', fontWeight: 600, color: colors.accent, letterSpacing: '0.02em' }}>
            Agentic Usability
          </div>
          <div style={{ fontSize: '14px', color: colors.textMuted, marginTop: '2px' }}>
            Evaluation Platform
          </div>
        </div>

        <SidebarNav />

        <div
          style={{
            padding: '12px 16px',
            borderTop: `1px solid ${colors.border}`,
            fontSize: '14px',
            color: colors.textMuted,
          }}
        >
          v0.1.0
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/runs/:runId" element={<EvalRun />} />
          <Route path="/runs/:runId/cases/:id" element={<TestCaseDetail />} />
          <Route path="/suite" element={<SuiteEditor />} />
          <Route path="/config" element={<ConfigEditor />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  return (
    <RunProvider>
      <AppContent />
    </RunProvider>
  );
}
