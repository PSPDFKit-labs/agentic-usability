import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getTestCase, getRunResults, getRunTestResult, TestCase, TargetResults, SolutionFile } from '../api';
import { MetricBar } from '../components/MetricBar';
import { CodeViewer } from '../components/CodeViewer';

const colors = {
  bg: '#0d1117',
  sidebar: '#161b22',
  border: '#30363d',
  text: '#e6edf3',
  textMuted: '#8b949e',
  accent: '#58a6ff',
  pass: '#3fb950',
  fail: '#f85149',
  codeBg: '#161b22',
};

// ─── Small helpers ────────────────────────────────────────────────────────────

function Tag({ children, color = colors.accent }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: '14px',
        background: `${color}18`,
        color,
        border: `1px solid ${color}40`,
        marginRight: '6px',
        marginBottom: '6px',
        fontFamily: 'monospace',
      }}
    >
      {children}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '14px',
        fontWeight: 600,
        color: colors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        marginBottom: '8px',
        marginTop: '20px',
      }}
    >
      {children}
    </div>
  );
}

// ─── Tab panels ───────────────────────────────────────────────────────────────

function InfoPanel({ testCase }: { testCase: TestCase }) {
  return (
    <div>
      <SectionLabel>Problem Statement</SectionLabel>
      <div
        style={{
          background: colors.codeBg,
          border: `1px solid ${colors.border}`,
          borderRadius: '6px',
          padding: '16px',
          fontFamily: 'monospace',
          fontSize: '16px',
          lineHeight: '1.7',
          color: colors.text,
          whiteSpace: 'pre-wrap',
        }}
      >
        {testCase.problemStatement}
      </div>

      {testCase.setupInstructions && (
        <>
          <SectionLabel>Setup Instructions</SectionLabel>
          <div
            style={{
              background: colors.codeBg,
              border: `1px solid ${colors.border}`,
              borderRadius: '6px',
              padding: '16px',
              fontFamily: 'monospace',
              fontSize: '16px',
              lineHeight: '1.7',
              color: colors.textMuted,
              whiteSpace: 'pre-wrap',
            }}
          >
            {testCase.setupInstructions}
          </div>
        </>
      )}

    </div>
  );
}

function JudgeScoresPanel({ targetResult }: { targetResult: TargetResults }) {
  const result = targetResult.testResults[0];
  const js = result?.judgeScore;

  if (!js) {
    return (
      <div style={{ color: colors.textMuted, fontSize: '16px', padding: '16px 0' }}>
        No judge scores available.
      </div>
    );
  }

  return (
    <div>
      <MetricBar label="API Discovery" value={js.apiDiscovery} />
      <MetricBar label="Call Correctness" value={js.callCorrectness} />
      <MetricBar label="Completeness" value={js.completeness} />
      <MetricBar label="Functional Correctness" value={js.functionalCorrectness} />

      <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '16px', color: colors.textMuted }}>Verdict:</span>
        <span
          style={{
            display: 'inline-block',
            padding: '3px 12px',
            borderRadius: '4px',
            fontSize: '14px',
            fontWeight: 700,
            letterSpacing: '0.05em',
            background: js.overallVerdict ? 'rgba(63,185,80,0.15)' : 'rgba(248,81,73,0.15)',
            color: js.overallVerdict ? colors.pass : colors.fail,
            border: `1px solid ${js.overallVerdict ? colors.pass : colors.fail}`,
          }}
        >
          {js.overallVerdict ? 'PASS' : 'FAIL'}
        </span>
      </div>

      {js.notes && (
        <div style={{ marginTop: '16px' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: colors.textMuted, marginBottom: '6px' }}>
            Notes
          </div>
          <div
            style={{
              background: colors.codeBg,
              border: `1px solid ${colors.border}`,
              borderRadius: '6px',
              padding: '12px',
              fontSize: '16px',
              color: colors.text,
              lineHeight: '1.6',
              whiteSpace: 'pre-wrap',
            }}
          >
            {js.notes}
          </div>
        </div>
      )}
    </div>
  );
}

function SolutionPane({
  label,
  files,
}: {
  label: string;
  files: SolutionFile[];
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);

  if (files.length === 0) {
    return (
      <div style={{ color: colors.textMuted, fontSize: '16px', padding: '16px 0' }}>
        No {label.toLowerCase()} available.
      </div>
    );
  }

  const file = files[selectedIdx] ?? files[0];

  const normalize = (p: string) => p.replace(/^solution__/, '').replace(/^solution\//, '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: colors.textMuted }}>{label}</div>
        {files.length > 1 ? (
          <select
            value={selectedIdx}
            onChange={(e) => setSelectedIdx(Number(e.target.value))}
            style={{
              background: colors.bg,
              color: colors.text,
              border: `1px solid ${colors.border}`,
              borderRadius: '4px',
              padding: '3px 8px',
              fontSize: '14px',
              fontFamily: 'monospace',
              cursor: 'pointer',
            }}
          >
            {files.map((f, i) => (
              <option key={f.path} value={i}>
                {normalize(f.path)}
              </option>
            ))}
          </select>
        ) : (
          <div style={{ fontSize: '14px', fontFamily: 'monospace', color: colors.textMuted }}>
            {normalize(file.path)}
          </div>
        )}
      </div>
      <CodeViewer code={file.content} filename={file.path} height="600px" />
    </div>
  );
}

function SolutionPanel({
  targetResult,
  referenceSolution,
}: {
  targetResult: TargetResults;
  referenceSolution: SolutionFile[];
}) {
  const result = targetResult.testResults[0];
  const generated = result?.generatedSolution ?? [];

  if (referenceSolution.length === 0 && generated.length === 0) {
    return (
      <div style={{ color: colors.textMuted, fontSize: '16px', padding: '16px 0' }}>
        No solutions available.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
      <SolutionPane label="Generated Solution" files={generated} />
      <SolutionPane label="Reference Solution" files={referenceSolution} />
    </div>
  );
}

/** Detect language from file path for Monaco */
function detectLang(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', json: 'json', md: 'markdown', sh: 'shell', yaml: 'yaml', yml: 'yaml',
    html: 'html', css: 'css', sql: 'sql', go: 'go', rs: 'rust', java: 'java',
    rb: 'ruby', php: 'php', c: 'c', cpp: 'cpp', txt: 'plaintext',
  };
  return map[ext ?? ''] ?? 'plaintext';
}

// ─── Target tabs ─────────────────────────────────────────────────────────────

type TabKey = 'info' | 'judge' | 'solution' | 'logs';

const TAB_LABELS: Record<TabKey, string> = {
  info: 'Info',
  judge: 'Judge Scores',
  solution: 'Solutions',
  logs: 'Logs',
};

interface LogFiles {
  agentOutput: string | null;
  agentCmd: string | null;
  setupLog: string | null;
  agentNotes: string | null;
}

function LogsPanel({ logs }: { logs: LogFiles | null }) {
  const [selectedIdx, setSelectedIdx] = useState(0);

  if (!logs) {
    return (
      <div style={{ color: colors.textMuted, fontSize: '16px', padding: '16px 0' }}>
        Loading logs...
      </div>
    );
  }

  const entries: { label: string; content: string | null; filename: string }[] = [
    { label: 'Agent Output', content: logs.agentOutput, filename: 'agent-output.log' },
    { label: 'Agent Command', content: logs.agentCmd, filename: 'agent-cmd.log' },
    { label: 'Setup Log', content: logs.setupLog, filename: 'setup.log' },
    { label: 'Agent Notes', content: logs.agentNotes, filename: 'agent-notes.md' },
  ];

  const available = entries.filter((e) => e.content);

  if (available.length === 0) {
    return (
      <div style={{ color: colors.textMuted, fontSize: '16px', padding: '16px 0' }}>
        No log files available.
      </div>
    );
  }

  const current = available[selectedIdx] ?? available[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: colors.textMuted }}>Log File</div>
        <select
          value={selectedIdx}
          onChange={(e) => setSelectedIdx(Number(e.target.value))}
          style={{
            background: colors.bg,
            color: colors.text,
            border: `1px solid ${colors.border}`,
            borderRadius: '4px',
            padding: '3px 8px',
            fontSize: '14px',
            fontFamily: 'monospace',
            cursor: 'pointer',
          }}
        >
          {available.map((entry, i) => (
            <option key={entry.filename} value={i}>
              {entry.label}
            </option>
          ))}
        </select>
      </div>
      <CodeViewer code={current.content!} filename={current.filename} height="600px" />
    </div>
  );
}

function TargetPanel({
  targetResult,
  referenceSolution,
  logs,
  testCase,
}: {
  targetResult: TargetResults;
  referenceSolution: SolutionFile[];
  logs: LogFiles | null;
  testCase: TestCase;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>('info');
  const tabs: TabKey[] = ['info', 'judge', 'solution', 'logs'];

  const hasResult = targetResult.testResults.length > 0;

  if (!hasResult) {
    return (
      <div
        style={{
          padding: '20px',
          color: colors.textMuted,
          fontSize: '16px',
          background: colors.sidebar,
          border: `1px solid ${colors.border}`,
          borderRadius: '0 6px 6px 6px',
        }}
      >
        No results yet for this target.
      </div>
    );
  }

  return (
    <div>
      {/* Tab buttons */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${colors.border}`, marginBottom: '0' }}>
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              fontWeight: activeTab === tab ? 600 : 400,
              color: activeTab === tab ? colors.accent : colors.textMuted,
              background: activeTab === tab ? colors.sidebar : 'transparent',
              border: 'none',
              borderBottom: activeTab === tab ? `2px solid ${colors.accent}` : '2px solid transparent',
              cursor: 'pointer',
              marginBottom: '-1px',
              transition: 'color 0.15s',
            }}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div
        style={{
          background: colors.sidebar,
          border: `1px solid ${colors.border}`,
          borderTop: 'none',
          borderRadius: '0 0 6px 6px',
          padding: '20px',
        }}
      >
        {activeTab === 'info' && <InfoPanel testCase={testCase} />}
        {activeTab === 'judge' && <JudgeScoresPanel targetResult={targetResult} />}
        {activeTab === 'solution' && (
          <SolutionPanel targetResult={targetResult} referenceSolution={referenceSolution} />
        )}
        {activeTab === 'logs' && <LogsPanel logs={logs} />}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function TestCaseDetail() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const navigate = useNavigate();
  const [testCase, setTestCase] = useState<TestCase | null>(null);
  const [allTargets, setAllTargets] = useState<TargetResults[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTarget, setActiveTarget] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogFiles | null>(null);

  // Fetch log files when active target changes
  useEffect(() => {
    if (!id || !activeTarget || !runId) { setLogs(null); return; }
    setLogs(null);
    getRunTestResult(runId, activeTarget, id)
      .then((result) => {
        setLogs({
          agentOutput: result.agentOutput,
          agentCmd: result.agentCmd,
          setupLog: result.setupLog,
          agentNotes: result.agentNotes,
        });
      })
      .catch(() => setLogs(null));
  }, [id, activeTarget, runId]);

  useEffect(() => {
    if (!id || !runId) return;
    setLoading(true);
    setError(null);
    Promise.all([getTestCase(id), getRunResults(runId)])
      .then(([tc, results]) => {
        setTestCase(tc);
        // Keep all targets that ran at all
        const allT = results.targets.map((t) => ({
          ...t,
          testResults: t.testResults.filter((r) => r.testId === id),
        }));
        setAllTargets(allT);
        if (allT.length > 0) setActiveTarget(allT[0].target);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, [id, runId]);

  if (loading) {
    return (
      <div style={{ color: colors.textMuted, fontSize: '16px', paddingTop: '40px', textAlign: 'center' }}>
        Loading…
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
          fontSize: '16px',
        }}
      >
        Error: {error}
      </div>
    );
  }

  if (!testCase) {
    return (
      <div style={{ color: colors.textMuted, fontSize: '16px' }}>Test case not found.</div>
    );
  }

  const activeTargetResult = allTargets.find((t) => t.target === activeTarget) ?? null;

  return (
    <div style={{ color: colors.text, maxWidth: '1200px' }}>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0, fontFamily: 'monospace', color: colors.accent }}>
            {testCase.id}
          </h1>
          <span
            style={{
              textTransform: 'capitalize',
              fontSize: '14px',
              padding: '2px 8px',
              borderRadius: '4px',
              fontWeight: 600,
              background:
                testCase.difficulty === 'easy'
                  ? 'rgba(63,185,80,0.12)'
                  : testCase.difficulty === 'medium'
                  ? 'rgba(227,179,65,0.12)'
                  : 'rgba(248,81,73,0.12)',
              color:
                testCase.difficulty === 'easy'
                  ? colors.pass
                  : testCase.difficulty === 'medium'
                  ? '#e3b341'
                  : colors.fail,
            }}
          >
            {testCase.difficulty}
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0' }}>
            {testCase.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </div>
          <button
            onClick={() => navigate(`/suite?select=${testCase.id}`)}
            style={{
              marginLeft: 'auto',
              padding: '5px 14px',
              fontSize: '14px',
              fontWeight: 600,
              color: colors.accent,
              background: 'rgba(88,166,255,0.1)',
              border: `1px solid ${colors.accent}`,
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Edit
          </button>
        </div>
      </div>

      {/* Target selector + tabbed panels */}
      {allTargets.length > 0 && (
        <div>
          {/* Target selector */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '0', flexWrap: 'wrap' }}>
            {allTargets.map((t) => (
              <button
                key={t.target}
                onClick={() => setActiveTarget(t.target)}
                style={{
                  padding: '6px 14px',
                  fontSize: '14px',
                  fontWeight: activeTarget === t.target ? 600 : 400,
                  color: activeTarget === t.target ? colors.accent : colors.textMuted,
                  background:
                    activeTarget === t.target ? 'rgba(88,166,255,0.12)' : colors.sidebar,
                  border: `1px solid ${activeTarget === t.target ? colors.accent : colors.border}`,
                  borderBottom:
                    activeTarget === t.target ? `1px solid ${colors.sidebar}` : `1px solid ${colors.border}`,
                  borderRadius: '6px 6px 0 0',
                  cursor: 'pointer',
                  marginBottom: '-1px',
                  position: 'relative',
                  zIndex: activeTarget === t.target ? 1 : 0,
                }}
              >
                {t.target}
              </button>
            ))}
          </div>

          {activeTargetResult && (
            <TargetPanel
              targetResult={activeTargetResult}
              referenceSolution={testCase.referenceSolution}
              logs={logs}
              testCase={testCase}
            />
          )}
        </div>
      )}

      {allTargets.length === 0 && (
        <div
          style={{
            background: colors.sidebar,
            border: `1px solid ${colors.border}`,
            borderRadius: '6px',
            padding: '20px',
          }}
        >
          <InfoPanel testCase={testCase} />
        </div>
      )}
    </div>
  );
}
