import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRuns } from '../context/RunContext';
import { getRunResults, type RunInfo, type TargetResults } from '../api';

const colors = {
  bg: '#0d1117',
  sidebar: '#161b22',
  border: '#30363d',
  text: '#e6edf3',
  textMuted: '#8b949e',
  accent: '#58a6ff',
  pass: '#3fb950',
  fail: '#f85149',
  headerBg: '#161b22',
};

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function pct(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${Math.round(v)}%`;
}

function EditableLabel({ run, onRename }: { run: RunInfo; onRename: (id: string, label: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(run.label || '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const save = async () => {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed !== (run.label || '')) {
      await onRename(run.id, trimmed);
    }
  };

  return editing ? (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
      onClick={(e) => e.stopPropagation()}
      style={{
        background: colors.bg, color: colors.text,
        border: `1px solid ${colors.accent}`, borderRadius: '3px',
        padding: '2px 6px', fontSize: '14px', fontFamily: 'monospace', width: '200px',
      }}
    />
  ) : (
    <span
      onClick={(e) => { e.stopPropagation(); setEditing(true); setValue(run.label || ''); }}
      style={{ cursor: 'text', fontSize: '14px', fontFamily: 'monospace', color: run.label ? colors.text : colors.textMuted }}
      title="Click to rename"
    >
      {run.label || run.id}
    </span>
  );
}

function ScoresTable({ results }: { results: TargetResults[] }) {
  if (results.length === 0) {
    return <span style={{ color: colors.textMuted, fontSize: '14px' }}>No results yet</span>;
  }

  const thStyle: React.CSSProperties = {
    padding: '6px 12px', textAlign: 'left', fontSize: '12px', fontWeight: 600,
    color: colors.textMuted, borderBottom: `1px solid ${colors.border}`,
    background: colors.headerBg, whiteSpace: 'nowrap',
  };
  const tdStyle: React.CSSProperties = {
    padding: '6px 12px', fontSize: '14px', color: colors.text,
    borderBottom: `1px solid ${colors.border}`, whiteSpace: 'nowrap',
  };

  return (
    <div style={{ overflowX: 'auto', borderRadius: '6px', border: `1px solid ${colors.border}` }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', background: colors.bg }}>
      <thead>
        <tr>
          <th style={thStyle}>Target</th>
          <th style={thStyle}>Pass Rate</th>
          <th style={thStyle}>API Cov</th>
          <th style={thStyle}>Token Cov</th>
          <th style={thStyle}>Discovery</th>
          <th style={thStyle}>Correctness</th>
          <th style={thStyle}>Completeness</th>
          <th style={thStyle}>Functional</th>
        </tr>
      </thead>
      <tbody>
        {results.map((t) => {
          const a = t.aggregates;
          const scoreColor = (v: number | null | undefined): React.CSSProperties => ({
            ...tdStyle,
            color: v == null ? colors.textMuted : v >= 80 ? colors.pass : v >= 50 ? '#e3b341' : colors.fail,
          });
          return (
            <tr key={t.target}>
              <td style={{ ...tdStyle, fontFamily: 'monospace', color: colors.accent }}>{t.target}</td>
              <td style={scoreColor(a.passRate)}>{pct(a.passRate)}</td>
              <td style={scoreColor(a.avgApiCoverage)}>{pct(a.avgApiCoverage)}</td>
              <td style={scoreColor(a.avgTokenCoverage)}>{pct(a.avgTokenCoverage)}</td>
              <td style={scoreColor(a.avgApiDiscovery)}>{pct(a.avgApiDiscovery)}</td>
              <td style={scoreColor(a.avgCallCorrectness)}>{pct(a.avgCallCorrectness)}</td>
              <td style={scoreColor(a.avgCompleteness)}>{pct(a.avgCompleteness)}</td>
              <td style={scoreColor(a.avgFunctionalCorrectness)}>{pct(a.avgFunctionalCorrectness)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

function RunCard({ run, results, onDelete, onRename }: {
  run: RunInfo;
  results: TargetResults[] | null;
  onDelete: (id: string) => Promise<void>;
  onRename: (id: string, label: string) => Promise<void>;
}) {
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div
      style={{
        border: `1px solid ${colors.border}`, borderRadius: '8px',
        background: colors.bg, cursor: 'pointer', transition: 'border-color 0.15s',
      }}
      onClick={() => navigate(`/runs/${run.id}`)}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = colors.accent; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = colors.border; }}
    >
      {/* Card header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', borderBottom: `1px solid ${colors.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <EditableLabel run={run} onRename={onRename} />
          <span style={{ fontSize: '14px', color: colors.textMuted }}>{run.testCount} tests</span>
          <span style={{ fontSize: '14px', color: colors.textMuted }}>{formatDate(run.createdAt)}</span>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          {confirmDelete ? (
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                onClick={async () => { await onDelete(run.id); setConfirmDelete(false); }}
                style={{ padding: '2px 8px', fontSize: '12px', background: 'rgba(248,81,73,0.15)', color: colors.fail, border: `1px solid ${colors.fail}`, borderRadius: '3px', cursor: 'pointer' }}
              >Confirm</button>
              <button
                onClick={() => setConfirmDelete(false)}
                style={{ padding: '2px 8px', fontSize: '12px', background: 'transparent', color: colors.textMuted, border: `1px solid ${colors.border}`, borderRadius: '3px', cursor: 'pointer' }}
              >Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              style={{ padding: '2px 8px', fontSize: '12px', background: 'transparent', color: colors.textMuted, border: `1px solid ${colors.border}`, borderRadius: '3px', cursor: 'pointer' }}
            >Delete</button>
          )}
        </div>
      </div>

      {/* Scores */}
      <div style={{ padding: '8px 16px', overflowX: 'auto' }}>
        {results === null ? (
          <div style={{ color: colors.textMuted, fontSize: '14px' }}>Loading scores…</div>
        ) : (
          <ScoresTable results={results} />
        )}
      </div>
    </div>
  );
}

export function Dashboard() {
  const { runs, removeRun, renameRun, loading } = useRuns();
  const [runResults, setRunResults] = useState<Record<string, TargetResults[] | null>>({});

  useEffect(() => {
    for (const run of runs) {
      if (runResults[run.id] !== undefined) continue;
      setRunResults((prev) => ({ ...prev, [run.id]: null }));
      getRunResults(run.id)
        .then((data) => setRunResults((prev) => ({ ...prev, [run.id]: data.targets })))
        .catch(() => setRunResults((prev) => ({ ...prev, [run.id]: [] })));
    }
  }, [runs]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <div style={{ color: colors.textMuted, fontSize: '16px', paddingTop: '40px', textAlign: 'center' }}>Loading…</div>;
  }

  if (runs.length === 0) {
    return (
      <div style={{ color: colors.text }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>Dashboard</h1>
        <p style={{ color: colors.textMuted, fontSize: '16px' }}>No evaluation runs yet. Run the pipeline to generate results.</p>
      </div>
    );
  }

  return (
    <div style={{ color: colors.text }}>
      <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '20px' }}>Dashboard</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {runs.map((run) => (
          <RunCard key={run.id} run={run} results={runResults[run.id] ?? null} onDelete={removeRun} onRename={renameRun} />
        ))}
      </div>
    </div>
  );
}
