import { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getSuite, getRunResults, getRuns, TestCase, TargetResults, RunInfo } from '../api';

const colors = {
  bg: '#0d1117',
  sidebar: '#161b22',
  border: '#30363d',
  text: '#e6edf3',
  textMuted: '#8b949e',
  accent: '#58a6ff',
  rowAlt: 'rgba(255,255,255,0.025)',
  headerBg: '#161b22',
  pass: '#3fb950',
  fail: '#f85149',
  btnActive: 'rgba(88,166,255,0.15)',
};

type Difficulty = 'all' | 'easy' | 'medium' | 'hard';

function pct(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${Math.round(v)}%`;
}

function VerdictBadge({ pass }: { pass: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block', padding: '1px 6px', borderRadius: '4px',
        fontSize: '12px', fontWeight: 700, letterSpacing: '0.05em',
        background: pass ? 'rgba(63,185,80,0.15)' : 'rgba(248,81,73,0.15)',
        color: pass ? colors.pass : colors.fail,
        border: `1px solid ${pass ? colors.pass : colors.fail}`,
      }}
    >
      {pass ? 'PASS' : 'FAIL'}
    </span>
  );
}

function selectStyle(): React.CSSProperties {
  return {
    background: colors.bg, color: colors.accent, border: `1px solid ${colors.border}`,
    borderRadius: '4px', padding: '4px 10px', fontSize: '14px',
    fontFamily: 'monospace', fontWeight: 600, cursor: 'pointer',
  };
}

function formatRunOption(r: RunInfo): string {
  if (r.label) return r.label;
  try {
    const d = new Date(r.createdAt);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return r.id;
  }
}

function TagMultiSelect({ tags, selected, onToggle, onClear }: {
  tags: string[];
  selected: Set<string>;
  onToggle: (tag: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const label = selected.size === 0
    ? 'Filter by tags…'
    : `${selected.size} tag${selected.size > 1 ? 's' : ''} selected`;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          background: colors.sidebar, color: selected.size > 0 ? colors.accent : colors.textMuted,
          border: `1px solid ${selected.size > 0 ? colors.accent : colors.border}`,
          borderRadius: '4px', padding: '5px 12px', fontSize: '14px', cursor: 'pointer',
          fontWeight: selected.size > 0 ? 600 : 400,
        }}
      >
        {label}
        <span style={{ fontSize: '12px' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: '4px', zIndex: 10,
          background: colors.sidebar, border: `1px solid ${colors.border}`, borderRadius: '6px',
          padding: '4px 0', minWidth: '200px', maxHeight: '240px', overflowY: 'auto',
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }}>
          {selected.size > 0 && (
            <button
              onClick={onClear}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '6px 12px', fontSize: '14px', color: colors.textMuted,
                background: 'transparent', border: 'none', cursor: 'pointer',
                borderBottom: `1px solid ${colors.border}`,
              }}
            >
              Clear all
            </button>
          )}
          {tags.map((tag) => {
            const active = selected.has(tag);
            return (
              <button
                key={tag}
                onClick={() => onToggle(tag)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  width: '100%', textAlign: 'left',
                  padding: '6px 12px', fontSize: '14px',
                  color: active ? colors.accent : colors.text,
                  background: active ? 'rgba(88,166,255,0.08)' : 'transparent',
                  border: 'none', cursor: 'pointer',
                }}
              >
                <span style={{
                  width: '14px', height: '14px', borderRadius: '3px',
                  border: `1px solid ${active ? colors.accent : colors.border}`,
                  background: active ? colors.accent : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '12px', color: '#fff', flexShrink: 0,
                }}>
                  {active ? '✓' : ''}
                </span>
                {tag}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function EvalRun() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const [suite, setSuite] = useState<TestCase[]>([]);
  const [targets, setTargets] = useState<TargetResults[]>([]);
  const [runs, setRunsList] = useState<RunInfo[]>([]);
  const [activeTarget, setActiveTarget] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [diffFilter, setDiffFilter] = useState<Difficulty>('all');
  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

  useEffect(() => {
    getRuns().then(setRunsList).catch(() => {});
  }, []);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    setError(null);
    Promise.all([getSuite(), getRunResults(runId)])
      .then(([s, r]) => {
        setSuite(s);
        setTargets(r.targets);
        if (r.targets.length > 0) setActiveTarget(r.targets[0].target);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, [runId]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    suite.forEach((tc) => tc.tags.forEach((t) => tags.add(t)));
    return Array.from(tags).sort();
  }, [suite]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  };

  const activeResult = targets.find((t) => t.target === activeTarget) ?? targets[0] ?? null;

  const filtered = suite.filter((tc) => {
    if (diffFilter !== 'all' && tc.difficulty !== diffFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!tc.problemStatement.toLowerCase().includes(q) && !tc.id.toLowerCase().includes(q)) return false;
    }
    if (selectedTags.size > 0) {
      if (!tc.tags.some((t) => selectedTags.has(t))) return false;
    }
    return true;
  });

  if (loading) {
    return <div style={{ color: colors.textMuted, fontSize: '16px', paddingTop: '40px', textAlign: 'center' }}>Loading…</div>;
  }

  if (error) {
    return (
      <div style={{ color: colors.fail, background: 'rgba(248,81,73,0.1)', border: `1px solid ${colors.fail}`, borderRadius: '6px', padding: '16px', fontSize: '16px' }}>
        Error: {error}
      </div>
    );
  }

  const diffButtons: Difficulty[] = ['all', 'easy', 'medium', 'hard'];

  const thStyle: React.CSSProperties = {
    padding: '8px 10px', textAlign: 'left', fontSize: '14px', fontWeight: 600,
    color: colors.textMuted, borderBottom: `1px solid ${colors.border}`,
    background: colors.headerBg, whiteSpace: 'nowrap',
  };

  const tdStyle: React.CSSProperties = {
    padding: '8px 10px', fontSize: '14px', color: colors.text,
    borderBottom: `1px solid ${colors.border}`, verticalAlign: 'middle',
  };

  return (
    <div style={{ color: colors.text }}>
      {/* Header with selectors */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>Eval Run</h1>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
          <span style={{ fontSize: '14px', color: colors.textMuted }}>Run:</span>
          <select value={runId} onChange={(e) => navigate(`/runs/${e.target.value}`)} style={selectStyle()}>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>{formatRunOption(r)}</option>
            ))}
          </select>

          {targets.length > 0 && (
            <>
              <span style={{ fontSize: '14px', color: colors.textMuted, marginLeft: '8px' }}>Target:</span>
              <select value={activeTarget ?? ''} onChange={(e) => setActiveTarget(e.target.value)} style={selectStyle()}>
                {targets.map((t) => (
                  <option key={t.target} value={t.target}>{t.target}</option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>

      {/* Summary */}
      {activeResult && (
        <div style={{ marginBottom: '24px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px' }}>Summary</h2>
          <div style={{ fontSize: '14px', fontWeight: 600, color: colors.textMuted, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Scores</div>
          <div style={{ overflowX: 'auto', borderRadius: '6px', border: `1px solid ${colors.border}` }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: colors.bg }}>
              <thead>
                <tr>
                  <th style={thStyle}>Pass Rate</th>
                  <th style={thStyle}>API Discovery</th>
                  <th style={thStyle}>Call Correctness</th>
                  <th style={thStyle}>Completeness</th>
                  <th style={thStyle}>Functional</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  {(() => {
                    const a = activeResult.aggregates;
                    const scoreStyle = (v: number): React.CSSProperties => ({
                      ...tdStyle, fontWeight: 600,
                      color: v >= 80 ? colors.pass : v >= 50 ? '#e3b341' : colors.fail,
                    });
                    return (
                      <>
                        <td style={scoreStyle(a.passRate)}>{pct(a.passRate)}</td>
                        <td style={scoreStyle(a.avgApiDiscovery)}>{pct(a.avgApiDiscovery)}</td>
                        <td style={scoreStyle(a.avgCallCorrectness)}>{pct(a.avgCallCorrectness)}</td>
                        <td style={scoreStyle(a.avgCompleteness)}>{pct(a.avgCompleteness)}</td>
                        <td style={scoreStyle(a.avgFunctionalCorrectness)}>{pct(a.avgFunctionalCorrectness)}</td>
                      </>
                    );
                  })()}
                </tr>
              </tbody>
            </table>
          </div>

        </div>
      )}

      {/* Filters */}
      <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>Test Cases</h2>

      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '4px' }}>
          {diffButtons.map((d) => (
            <button
              key={d}
              onClick={() => setDiffFilter(d)}
              style={{
                padding: '5px 12px', fontSize: '14px',
                fontWeight: diffFilter === d ? 600 : 400,
                background: diffFilter === d ? colors.btnActive : 'transparent',
                color: diffFilter === d ? colors.accent : colors.textMuted,
                border: `1px solid ${diffFilter === d ? colors.accent : colors.border}`,
                borderRadius: '5px', cursor: 'pointer', textTransform: 'capitalize',
              }}
            >
              {d}
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="Search by ID or problem…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: '5px 12px', fontSize: '14px', background: colors.sidebar,
            color: colors.text, border: `1px solid ${colors.border}`,
            borderRadius: '5px', outline: 'none', width: '240px',
          }}
        />

        {allTags.length > 0 && <TagMultiSelect tags={allTags} selected={selectedTags} onToggle={toggleTag} onClear={() => setSelectedTags(new Set())} />}

        <span style={{ fontSize: '14px', color: colors.textMuted }}>
          {filtered.length} / {suite.length} cases
        </span>
      </div>

      {/* Test cases table with scores */}
      {(() => {
        const tcScoreStyle = (v: number | null | undefined): React.CSSProperties => ({
          ...tdStyle,
          color: v == null ? colors.textMuted : v >= 80 ? colors.pass : v >= 50 ? '#e3b341' : colors.fail,
        });
        return (<div style={{ overflowX: 'auto', borderRadius: '6px', border: `1px solid ${colors.border}` }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', background: colors.bg }}>
          <thead>
            <tr>
              <th style={thStyle}>ID</th>
              <th style={thStyle}>Difficulty</th>
              <th style={thStyle}>Problem</th>
              <th style={thStyle}>Discovery</th>
              <th style={thStyle}>Correctness</th>
              <th style={thStyle}>Completeness</th>
              <th style={thStyle}>Functional</th>
              <th style={thStyle}>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: colors.textMuted, padding: '32px' }}>
                  No test cases match the current filters.
                </td>
              </tr>
            ) : (
              filtered.map((tc, i) => {
                const result = activeResult?.testResults.find((r) => r.testId === tc.id);
                const js = result?.judgeScore;
                const verdict = js?.overallVerdict ?? null;
                const truncated = tc.problemStatement.length > 60
                  ? tc.problemStatement.slice(0, 60) + '…'
                  : tc.problemStatement;
                const diffColor = tc.difficulty === 'easy' ? colors.pass : tc.difficulty === 'medium' ? '#e3b341' : colors.fail;
                return (
                  <tr
                    key={tc.id}
                    style={{ background: i % 2 === 1 ? colors.rowAlt : 'transparent', cursor: 'pointer' }}
                    onClick={() => navigate(`/runs/${runId}/cases/${tc.id}`)}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = 'rgba(88,166,255,0.06)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = i % 2 === 1 ? colors.rowAlt : 'transparent'; }}
                  >
                    <td style={{ ...tdStyle, fontFamily: 'monospace', color: colors.accent, whiteSpace: 'nowrap' }}>{tc.id}</td>
                    <td style={tdStyle}><span style={{ color: diffColor, textTransform: 'capitalize' }}>{tc.difficulty}</span></td>
                    <td style={{ ...tdStyle, color: colors.textMuted, maxWidth: '280px' }}>{truncated}</td>
                    <td style={tcScoreStyle(js?.apiDiscovery)}>{js ? pct(js.apiDiscovery) : '—'}</td>
                    <td style={tcScoreStyle(js?.callCorrectness)}>{js ? pct(js.callCorrectness) : '—'}</td>
                    <td style={tcScoreStyle(js?.completeness)}>{js ? pct(js.completeness) : '—'}</td>
                    <td style={tcScoreStyle(js?.functionalCorrectness)}>{js ? pct(js.functionalCorrectness) : '—'}</td>
                    <td style={tdStyle}>
                      {verdict !== null ? <VerdictBadge pass={verdict} /> : <span style={{ color: colors.textMuted }}>—</span>}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>);
      })()}
    </div>
  );
}
