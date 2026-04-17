import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllResults, TargetResults, TestResult } from '../api';
import { ScoreCard } from '../components/ScoreCard';

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
};

function pct(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${Math.round(v)}%`;
}

function VerdictBadge({ pass }: { pass: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: '11px',
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

function ResultsTable({ results }: { results: TestResult[] }) {
  const navigate = useNavigate();

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
    <div style={{ overflowX: 'auto', borderRadius: '6px', border: `1px solid ${colors.border}` }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          background: colors.bg,
          fontSize: '12px',
        }}
      >
        <thead>
          <tr>
            {['ID', 'Difficulty', 'API Cov', 'Token Cov', 'Discovery', 'Correctness', 'Completeness', 'Functional', 'Verdict'].map(
              (h) => (
                <th key={h} style={thStyle}>
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => {
            const ta = r.tokenAnalysis;
            const js = r.judgeScore;
            const verdict = js?.overallVerdict ?? null;
            return (
              <tr
                key={r.testId}
                style={{
                  background: i % 2 === 1 ? colors.rowAlt : 'transparent',
                  cursor: 'pointer',
                }}
                onClick={() => navigate(`/cases/${r.testId}`)}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background =
                    'rgba(88,166,255,0.06)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background =
                    i % 2 === 1 ? colors.rowAlt : 'transparent';
                }}
              >
                <td style={{ ...tdStyle, fontFamily: 'monospace', color: colors.accent }}>
                  {r.testId}
                </td>
                <td style={tdStyle}>
                  <span
                    style={{
                      textTransform: 'capitalize',
                      color:
                        r.difficulty === 'easy'
                          ? colors.pass
                          : r.difficulty === 'medium'
                          ? '#e3b341'
                          : colors.fail,
                    }}
                  >
                    {r.difficulty}
                  </span>
                </td>
                <td style={tdStyle}>{ta ? pct(ta.apiCoverage) : '—'}</td>
                <td style={tdStyle}>{ta ? pct(ta.tokenCoverage) : '—'}</td>
                <td style={tdStyle}>{js ? pct(js.apiDiscovery) : '—'}</td>
                <td style={tdStyle}>{js ? pct(js.callCorrectness) : '—'}</td>
                <td style={tdStyle}>{js ? pct(js.completeness) : '—'}</td>
                <td style={tdStyle}>{js ? pct(js.functionalCorrectness) : '—'}</td>
                <td style={tdStyle}>
                  {verdict !== null ? <VerdictBadge pass={verdict} /> : <span style={{ color: colors.textMuted }}>—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MissedList({
  title,
  items,
}: {
  title: string;
  items: Array<{ api?: string; token?: string; missRate: number; missCount: number; totalCount: number }>;
}) {
  if (!items.length) return null;
  return (
    <div style={{ marginTop: '16px' }}>
      <div
        style={{
          fontSize: '12px',
          fontWeight: 600,
          color: colors.textMuted,
          marginBottom: '8px',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {items.map((item, i) => {
          const label = item.api ?? item.token ?? '';
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(248,81,73,0.1)',
                border: `1px solid ${colors.fail}`,
                borderRadius: '4px',
                padding: '4px 10px',
                fontSize: '12px',
              }}
            >
              <span style={{ fontFamily: 'monospace', color: colors.text }}>{label}</span>
              <span style={{ color: colors.fail, fontSize: '11px' }}>
                {Math.round(item.missRate)}% miss ({item.missCount}/{item.totalCount})
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TargetSection({ targetResult }: { targetResult: TargetResults }) {
  const { target, aggregates, testResults } = targetResult;
  return (
    <div style={{ marginBottom: '40px' }}>
      <h2
        style={{
          fontSize: '16px',
          fontWeight: 600,
          color: colors.text,
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <span
          style={{
            fontFamily: 'monospace',
            background: 'rgba(88,166,255,0.1)',
            color: colors.accent,
            padding: '2px 8px',
            borderRadius: '4px',
            fontSize: '14px',
          }}
        >
          {target}
        </span>
        <span style={{ color: colors.textMuted, fontSize: '13px', fontWeight: 400 }}>
          {testResults.length} test{testResults.length !== 1 ? 's' : ''}
        </span>
      </h2>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '280px 1fr',
          gap: '20px',
          alignItems: 'start',
          marginBottom: '16px',
        }}
      >
        <ScoreCard title="Aggregate Scores" aggregates={aggregates} />
        <ResultsTable results={testResults} />
      </div>

      <MissedList
        title="Worst APIs"
        items={aggregates.worstApis.map((a) => ({ api: a.api, missRate: a.missRate, missCount: a.missCount, totalCount: a.totalCount }))}
      />
      <MissedList
        title="Missed Tokens"
        items={aggregates.missedTokens.map((t) => ({ token: t.token, missRate: t.missRate, missCount: t.missCount, totalCount: t.totalCount }))}
      />
    </div>
  );
}

export function Dashboard() {
  const [targets, setTargets] = useState<TargetResults[]>([]);
  const [activeTarget, setActiveTarget] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAllResults()
      .then((data) => {
        setTargets(data.targets);
        if (data.targets.length > 0) setActiveTarget(data.targets[0].target);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div style={{ color: colors.textMuted, fontSize: '14px', paddingTop: '40px', textAlign: 'center' }}>
        Loading results…
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          color: colors.fail,
          background: 'rgba(248,81,73,0.1)',
          border: `1px solid ${colors.fail}`,
          borderRadius: '6px',
          padding: '16px',
          fontSize: '13px',
          marginTop: '20px',
        }}
      >
        Error loading results: {error}
      </div>
    );
  }

  if (!targets.length) {
    return (
      <div style={{ color: colors.text }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '8px' }}>Dashboard</h1>
        <p style={{ color: colors.textMuted, fontSize: '14px' }}>
          No results yet. Run the pipeline to generate evaluation results.
        </p>
      </div>
    );
  }

  const activeResult = targets.find((t) => t.target === activeTarget) ?? targets[0];

  return (
    <div style={{ color: colors.text }}>
      <h1 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '24px' }}>Dashboard</h1>

      {/* Target selector */}
      {targets.length > 1 && (
        <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
          {targets.map((t) => (
            <button
              key={t.target}
              onClick={() => setActiveTarget(t.target)}
              style={{
                padding: '6px 14px',
                fontSize: '12px',
                fontFamily: 'monospace',
                fontWeight: activeTarget === t.target ? 600 : 400,
                color: activeTarget === t.target ? colors.accent : colors.textMuted,
                background: activeTarget === t.target ? 'rgba(88,166,255,0.12)' : colors.headerBg,
                border: `1px solid ${activeTarget === t.target ? colors.accent : colors.border}`,
                borderRadius: '6px 6px 0 0',
                cursor: 'pointer',
              }}
            >
              {t.target}
            </button>
          ))}
        </div>
      )}

      <TargetSection targetResult={activeResult} />
    </div>
  );
}
