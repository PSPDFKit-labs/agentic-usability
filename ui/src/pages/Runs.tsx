import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSuite, getRunResults, TestCase, TargetResults, RunInfo } from '../api';
import { useRuns } from '../context/RunContext';

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
  danger: '#f85149',
};

type Difficulty = 'all' | 'easy' | 'medium' | 'hard';

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function VerdictBadge({ pass }: { pass: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: '4px',
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '0.05em',
        background: pass ? 'rgba(63,185,80,0.15)' : 'rgba(248,81,73,0.15)',
        color: pass ? colors.pass : colors.fail,
        border: `1px solid ${pass ? colors.pass : colors.fail}`,
      }}
    >
      {pass ? 'PASS' : 'FAIL'}
    </span>
  );
}

function DifficultyLabel({ d }: { d: string }) {
  const color =
    d === 'easy' ? colors.pass : d === 'medium' ? '#e3b341' : colors.fail;
  return (
    <span style={{ color, textTransform: 'capitalize', fontSize: '12px' }}>{d}</span>
  );
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

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        style={{
          background: colors.bg,
          color: colors.text,
          border: `1px solid ${colors.accent}`,
          borderRadius: '3px',
          padding: '2px 6px',
          fontSize: '12px',
          fontFamily: 'monospace',
          width: '160px',
        }}
      />
    );
  }

  return (
    <span
      onClick={(e) => { e.stopPropagation(); setEditing(true); setValue(run.label || ''); }}
      style={{ cursor: 'text', fontFamily: 'monospace', fontSize: '12px', color: run.label ? colors.text : colors.textMuted }}
      title="Click to rename"
    >
      {run.label || formatDate(run.createdAt)}
    </span>
  );
}

function RunList() {
  const { runs, activeRunId, setActiveRunId, removeRun, renameRun } = useRuns();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  if (runs.length === 0) {
    return (
      <div style={{ color: colors.textMuted, fontSize: '13px', padding: '20px 0' }}>
        No evaluation runs yet. Run the pipeline to generate results.
      </div>
    );
  }

  const thStyle: React.CSSProperties = {
    padding: '6px 12px',
    textAlign: 'left',
    fontSize: '11px',
    fontWeight: 600,
    color: colors.textMuted,
    borderBottom: `1px solid ${colors.border}`,
    background: colors.headerBg,
    whiteSpace: 'nowrap',
  };

  const tdStyle: React.CSSProperties = {
    padding: '6px 12px',
    fontSize: '12px',
    color: colors.text,
    borderBottom: `1px solid ${colors.border}`,
    verticalAlign: 'middle',
  };

  return (
    <div style={{ overflowX: 'auto', borderRadius: '6px', border: `1px solid ${colors.border}`, marginBottom: '32px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', background: colors.bg }}>
        <thead>
          <tr>
            <th style={thStyle}>Label / Date</th>
            <th style={thStyle}>Targets</th>
            <th style={thStyle}>Tests</th>
            <th style={thStyle}>Created</th>
            <th style={{ ...thStyle, width: '80px' }}></th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const isActive = run.id === activeRunId;
            return (
              <tr
                key={run.id}
                style={{
                  background: isActive ? 'rgba(88,166,255,0.06)' : 'transparent',
                  cursor: 'pointer',
                }}
                onClick={() => setActiveRunId(run.id)}
              >
                <td style={tdStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {isActive && (
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: colors.accent, flexShrink: 0 }} />
                    )}
                    <EditableLabel run={run} onRename={renameRun} />
                  </div>
                </td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '11px' }}>
                  {run.targets.join(', ')}
                </td>
                <td style={tdStyle}>{run.testCount}</td>
                <td style={{ ...tdStyle, color: colors.textMuted, fontSize: '11px' }}>
                  {formatDate(run.createdAt)}
                </td>
                <td style={tdStyle}>
                  {confirmDelete === run.id ? (
                    <div style={{ display: 'flex', gap: '4px' }} onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={async () => { await removeRun(run.id); setConfirmDelete(null); }}
                        style={{
                          padding: '2px 8px',
                          fontSize: '10px',
                          background: 'rgba(248,81,73,0.15)',
                          color: colors.danger,
                          border: `1px solid ${colors.danger}`,
                          borderRadius: '3px',
                          cursor: 'pointer',
                        }}
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        style={{
                          padding: '2px 8px',
                          fontSize: '10px',
                          background: 'transparent',
                          color: colors.textMuted,
                          border: `1px solid ${colors.border}`,
                          borderRadius: '3px',
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDelete(run.id); }}
                      style={{
                        padding: '2px 8px',
                        fontSize: '10px',
                        background: 'transparent',
                        color: colors.textMuted,
                        border: `1px solid ${colors.border}`,
                        borderRadius: '3px',
                        cursor: 'pointer',
                      }}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Runs() {
  const navigate = useNavigate();
  const { activeRunId, runs } = useRuns();
  const [suite, setSuite] = useState<TestCase[]>([]);
  const [targets, setTargets] = useState<TargetResults[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [diffFilter, setDiffFilter] = useState<Difficulty>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!activeRunId) {
      setLoading(false);
      setTargets([]);
      return;
    }
    setLoading(true);
    Promise.all([getSuite(), getRunResults(activeRunId)])
      .then(([s, r]) => {
        setSuite(s);
        setTargets(r.targets);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, [activeRunId]);

  const filtered = suite.filter((tc) => {
    if (diffFilter !== 'all' && tc.difficulty !== diffFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!tc.problemStatement.toLowerCase().includes(q) && !tc.id.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const diffButtons: Difficulty[] = ['all', 'easy', 'medium', 'hard'];

  const thStyle: React.CSSProperties = {
    padding: '8px 12px',
    textAlign: 'left',
    fontSize: '11px',
    fontWeight: 600,
    color: colors.textMuted,
    borderBottom: `1px solid ${colors.border}`,
    background: colors.headerBg,
    whiteSpace: 'nowrap',
  };

  const tdStyle: React.CSSProperties = {
    padding: '8px 12px',
    fontSize: '12px',
    color: colors.text,
    borderBottom: `1px solid ${colors.border}`,
    verticalAlign: 'middle',
  };

  return (
    <div style={{ color: colors.text }}>
      <h1 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '20px' }}>Runs</h1>

      <RunList />

      {/* Test results for active run */}
      {runs.length > 0 && activeRunId && (
        <>
          <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px', color: colors.text }}>
            Test Results
          </h2>

          {loading ? (
            <div style={{ color: colors.textMuted, fontSize: '14px', textAlign: 'center', padding: '40px 0' }}>
              Loading…
            </div>
          ) : error ? (
            <div
              style={{
                color: colors.fail,
                background: 'rgba(248,81,73,0.1)',
                border: `1px solid ${colors.fail}`,
                borderRadius: '6px',
                padding: '16px',
                fontSize: '13px',
              }}
            >
              Error: {error}
            </div>
          ) : (
            <>
              {/* Filter controls */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  marginBottom: '20px',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', gap: '4px' }}>
                  {diffButtons.map((d) => (
                    <button
                      key={d}
                      onClick={() => setDiffFilter(d)}
                      style={{
                        padding: '5px 12px',
                        fontSize: '12px',
                        fontWeight: diffFilter === d ? 600 : 400,
                        background: diffFilter === d ? colors.btnActive : 'transparent',
                        color: diffFilter === d ? colors.accent : colors.textMuted,
                        border: `1px solid ${diffFilter === d ? colors.accent : colors.border}`,
                        borderRadius: '5px',
                        cursor: 'pointer',
                        textTransform: 'capitalize',
                        transition: 'background 0.15s, color 0.15s',
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
                    padding: '5px 12px',
                    fontSize: '12px',
                    background: colors.sidebar,
                    color: colors.text,
                    border: `1px solid ${colors.border}`,
                    borderRadius: '5px',
                    outline: 'none',
                    width: '240px',
                  }}
                />

                <span style={{ fontSize: '12px', color: colors.textMuted }}>
                  {filtered.length} / {suite.length} cases
                </span>
              </div>

              {/* Table */}
              <div
                style={{
                  overflowX: 'auto',
                  borderRadius: '6px',
                  border: `1px solid ${colors.border}`,
                }}
              >
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    background: colors.bg,
                  }}
                >
                  <thead>
                    <tr>
                      <th style={thStyle}>ID</th>
                      <th style={thStyle}>Difficulty</th>
                      <th style={thStyle}>Tags</th>
                      <th style={thStyle}>Problem</th>
                      {targets.map((t) => (
                        <th key={t.target} style={thStyle}>
                          {t.target}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4 + targets.length}
                          style={{ ...tdStyle, textAlign: 'center', color: colors.textMuted, padding: '32px' }}
                        >
                          No test cases match the current filters.
                        </td>
                      </tr>
                    ) : (
                      filtered.map((tc, i) => {
                        const truncated =
                          tc.problemStatement.length > 80
                            ? tc.problemStatement.slice(0, 80) + '…'
                            : tc.problemStatement;

                        return (
                          <tr
                            key={tc.id}
                            style={{
                              background: i % 2 === 1 ? colors.rowAlt : 'transparent',
                              cursor: 'pointer',
                            }}
                            onClick={() => navigate(`/cases/${tc.id}`)}
                            onMouseEnter={(e) => {
                              (e.currentTarget as HTMLTableRowElement).style.background =
                                'rgba(88,166,255,0.06)';
                            }}
                            onMouseLeave={(e) => {
                              (e.currentTarget as HTMLTableRowElement).style.background =
                                i % 2 === 1 ? colors.rowAlt : 'transparent';
                            }}
                          >
                            <td
                              style={{
                                ...tdStyle,
                                fontFamily: 'monospace',
                                color: colors.accent,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {tc.id}
                            </td>
                            <td style={tdStyle}>
                              <DifficultyLabel d={tc.difficulty} />
                            </td>
                            <td style={{ ...tdStyle, maxWidth: '160px' }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {tc.tags.map((tag) => (
                                  <span
                                    key={tag}
                                    style={{
                                      background: 'rgba(88,166,255,0.1)',
                                      color: colors.accent,
                                      padding: '1px 6px',
                                      borderRadius: '3px',
                                      fontSize: '10px',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td style={{ ...tdStyle, color: colors.textMuted, maxWidth: '340px' }}>
                              {truncated}
                            </td>
                            {targets.map((t) => {
                              const result = t.testResults.find((r) => r.testId === tc.id);
                              const verdict = result?.judgeScore?.overallVerdict;
                              return (
                                <td key={t.target} style={{ ...tdStyle, textAlign: 'center' }}>
                                  {verdict !== undefined && verdict !== null ? (
                                    <VerdictBadge pass={verdict} />
                                  ) : (
                                    <span style={{ color: colors.textMuted, fontSize: '11px' }}>—</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
