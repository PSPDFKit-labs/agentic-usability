import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import {
  getSuite,
  putTestCase,
  deleteTestCase,
  createTestCase,
  TestCase,
  SolutionFile,
} from '../api';
import { detectLanguage } from '../components/CodeViewer';

const colors = {
  bg: '#0d1117',
  sidebar: '#161b22',
  border: '#30363d',
  text: '#e6edf3',
  textMuted: '#8b949e',
  accent: '#58a6ff',
  green: '#3fb950',
  red: '#f85149',
  yellow: '#d29922',
};

const inputStyle: React.CSSProperties = {
  background: colors.bg,
  border: `1px solid ${colors.border}`,
  borderRadius: '6px',
  color: colors.text,
  padding: '7px 10px',
  fontSize: '16px',
  width: '100%',
  boxSizing: 'border-box',
  outline: 'none',
  fontFamily: 'inherit',
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: 'vertical',
  fontFamily: 'inherit',
};

const labelStyle: React.CSSProperties = {
  fontSize: '14px',
  color: colors.textMuted,
  marginBottom: '4px',
  display: 'block',
  fontWeight: 500,
};

const fieldStyle: React.CSSProperties = {
  marginBottom: '16px',
};

function difficultyColor(d: string) {
  if (d === 'easy') return colors.green;
  if (d === 'medium') return colors.yellow;
  return colors.red;
}

function DifficultyBadge({ difficulty }: { difficulty: string }) {
  return (
    <span
      style={{
        fontSize: '12px',
        fontWeight: 600,
        padding: '2px 6px',
        borderRadius: '4px',
        background: `${difficultyColor(difficulty)}22`,
        color: difficultyColor(difficulty),
        flexShrink: 0,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      {difficulty}
    </span>
  );
}

interface EditState {
  id: string;
  problemStatement: string;
  difficulty: 'easy' | 'medium' | 'hard';
  tags: string;
  setupInstructions: string;
  referenceSolution: SolutionFile[];
}

function tcToEditState(tc: TestCase): EditState {
  return {
    id: tc.id,
    problemStatement: tc.problemStatement,
    difficulty: tc.difficulty,
    tags: tc.tags.join(', '),
    setupInstructions: tc.setupInstructions ?? '',
    referenceSolution: tc.referenceSolution.map((f) => ({ ...f })),
  };
}

function editStateToTc(s: EditState): TestCase {
  return {
    id: s.id,
    problemStatement: s.problemStatement,
    difficulty: s.difficulty,
    tags: s.tags.split(',').map((x) => x.trim()).filter(Boolean),
    setupInstructions: s.setupInstructions || undefined,
    referenceSolution: s.referenceSolution,
  };
}

export function SuiteEditor() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);

  const loadSuite = async () => {
    setLoading(true);
    try {
      const suite = await getSuite();
      setTestCases(suite);
      // Auto-select from ?select= query param
      const selectId = searchParams.get('select');
      if (selectId) {
        const found = suite.find((tc) => tc.id === selectId);
        if (found) {
          setSelectedId(found.id);
          setEditState(tcToEditState(found));
        }
        setSearchParams({}, { replace: true });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSuite();
  }, []);

  const handleSelect = (tc: TestCase) => {
    setSelectedId(tc.id);
    setEditState(tcToEditState(tc));
    setSaveStatus('idle');
    setSaveError('');
  };

  const handleSave = async () => {
    if (!editState) return;
    setSaveStatus('saving');
    setSaveError('');
    try {
      const tc = editStateToTc(editState);
      await putTestCase(editState.id, tc);
      setTestCases((prev) => prev.map((t) => (t.id === editState.id ? tc : t)));
      setSaveStatus('saved');
    } catch (err) {
      setSaveError((err as Error).message);
      setSaveStatus('error');
    }
  };

  const handleDelete = async () => {
    if (!selectedId || !confirm(`Delete test case "${selectedId}"?`)) return;
    setDeleting(true);
    try {
      await deleteTestCase(selectedId);
      setTestCases((prev) => prev.filter((t) => t.id !== selectedId));
      setSelectedId(null);
      setEditState(null);
    } catch (err) {
      alert(`Delete failed: ${(err as Error).message}`);
    } finally {
      setDeleting(false);
    }
  };

  const handleAddNew = async () => {
    setCreating(true);
    try {
      const created = await createTestCase({
        problemStatement: 'New test case',
        difficulty: 'medium',
        tags: [],
        referenceSolution: [],
      });
      setTestCases((prev) => [...prev, created]);
      handleSelect(created);
    } catch (err) {
      alert(`Create failed: ${(err as Error).message}`);
    } finally {
      setCreating(false);
    }
  };

  const updateEdit = (patch: Partial<EditState>) => {
    setEditState((prev) => (prev ? { ...prev, ...patch } : prev));
    setSaveStatus('idle');
  };

  const updateFile = (index: number, patch: Partial<SolutionFile>) => {
    if (!editState) return;
    const updated = editState.referenceSolution.map((f, i) =>
      i === index ? { ...f, ...patch } : f
    );
    updateEdit({ referenceSolution: updated });
  };

  const addFile = () => {
    if (!editState) return;
    updateEdit({
      referenceSolution: [...editState.referenceSolution, { path: '', content: '' }],
    });
  };

  const removeFile = (index: number) => {
    if (!editState) return;
    updateEdit({
      referenceSolution: editState.referenceSolution.filter((_, i) => i !== index),
    });
  };

  return (
    <div
      style={{
        display: 'flex',
        height: 'calc(100vh - 96px)',
        gap: '0',
        border: `1px solid ${colors.border}`,
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      {/* Left panel — test case list */}
      <div
        style={{
          width: '280px',
          flexShrink: 0,
          background: colors.sidebar,
          borderRight: `1px solid ${colors.border}`,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* List header */}
        <div
          style={{
            padding: '12px',
            borderBottom: `1px solid ${colors.border}`,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span style={{ flex: 1, fontSize: '16px', fontWeight: 600, color: colors.text }}>
            Test Cases {testCases.length > 0 && `(${testCases.length})`}
          </span>
          <button
            onClick={handleAddNew}
            disabled={creating}
            style={{
              padding: '5px 10px',
              background: colors.accent,
              border: 'none',
              borderRadius: '5px',
              color: '#0d1117',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              opacity: creating ? 0.6 : 1,
            }}
          >
            + New
          </button>
        </div>

        {/* Scrollable list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: '16px', color: colors.textMuted, fontSize: '16px' }}>
              Loading...
            </div>
          ) : testCases.length === 0 ? (
            <div style={{ padding: '16px', color: colors.textMuted, fontSize: '16px' }}>
              No test cases.
            </div>
          ) : (
            testCases.map((tc) => {
              const isSelected = tc.id === selectedId;
              return (
                <div
                  key={tc.id}
                  onClick={() => handleSelect(tc)}
                  style={{
                    padding: '10px 12px',
                    cursor: 'pointer',
                    borderBottom: `1px solid ${colors.border}`,
                    background: isSelected ? 'rgba(88, 166, 255, 0.1)' : 'transparent',
                    borderLeft: isSelected ? `3px solid ${colors.accent}` : '3px solid transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <span
                      style={{
                        fontSize: '14px',
                        fontWeight: 600,
                        color: isSelected ? colors.accent : colors.text,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                      }}
                    >
                      {tc.id}
                    </span>
                    <DifficultyBadge difficulty={tc.difficulty} />
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: '14px',
                      color: colors.textMuted,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {tc.problemStatement}
                  </p>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right panel — edit form */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          background: colors.bg,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {!editState ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: colors.textMuted,
              fontSize: '16px',
            }}
          >
            Select a test case to edit, or click + New.
          </div>
        ) : (
          <div style={{ padding: '20px', maxWidth: '900px' }}>
            {/* Edit form header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '20px',
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: '18px',
                  fontWeight: 600,
                  color: colors.text,
                  flex: 1,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}
              >
                {editState.id}
              </h2>

              {saveStatus === 'saved' && (
                <span style={{ fontSize: '16px', color: colors.green }}>Saved</span>
              )}
              {saveStatus === 'error' && (
                <span style={{ fontSize: '16px', color: colors.red }}>Error</span>
              )}

              <button
                onClick={handleDelete}
                disabled={deleting}
                style={{
                  padding: '7px 14px',
                  background: 'rgba(248, 81, 73, 0.1)',
                  border: `1px solid ${colors.red}`,
                  borderRadius: '6px',
                  color: colors.red,
                  fontSize: '16px',
                  cursor: 'pointer',
                  opacity: deleting ? 0.6 : 1,
                }}
              >
                Delete
              </button>

              <button
                onClick={handleSave}
                disabled={saveStatus === 'saving'}
                style={{
                  padding: '7px 16px',
                  background: colors.accent,
                  border: 'none',
                  borderRadius: '6px',
                  color: '#0d1117',
                  fontSize: '16px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  opacity: saveStatus === 'saving' ? 0.6 : 1,
                }}
              >
                {saveStatus === 'saving' ? 'Saving...' : 'Save'}
              </button>
            </div>

            {/* Error */}
            {saveStatus === 'error' && saveError && (
              <div
                style={{
                  marginBottom: '16px',
                  padding: '10px 14px',
                  background: 'rgba(248, 81, 73, 0.1)',
                  border: `1px solid ${colors.red}`,
                  borderRadius: '6px',
                  color: colors.red,
                  fontSize: '16px',
                }}
              >
                {saveError}
              </div>
            )}

            {/* ID (read-only) */}
            <div style={fieldStyle}>
              <label style={labelStyle}>ID (read-only)</label>
              <input
                readOnly
                value={editState.id}
                style={{ ...inputStyle, opacity: 0.6, cursor: 'not-allowed' }}
              />
            </div>

            {/* Problem Statement */}
            <div style={fieldStyle}>
              <label style={labelStyle}>Problem Statement</label>
              <textarea
                rows={6}
                value={editState.problemStatement}
                onChange={(e) => updateEdit({ problemStatement: e.target.value })}
                style={textareaStyle}
              />
            </div>

            {/* Difficulty */}
            <div style={fieldStyle}>
              <label style={labelStyle}>Difficulty</label>
              <select
                value={editState.difficulty}
                onChange={(e) =>
                  updateEdit({ difficulty: e.target.value as 'easy' | 'medium' | 'hard' })
                }
                style={{
                  ...inputStyle,
                  cursor: 'pointer',
                }}
              >
                <option value="easy">easy</option>
                <option value="medium">medium</option>
                <option value="hard">hard</option>
              </select>
            </div>

            {/* Tags */}
            <div style={fieldStyle}>
              <label style={labelStyle}>Tags (comma-separated)</label>
              <input
                value={editState.tags}
                onChange={(e) => updateEdit({ tags: e.target.value })}
                style={inputStyle}
                placeholder="e.g. filesystem, async"
              />
            </div>

            {/* Setup Instructions */}
            <div style={fieldStyle}>
              <label style={labelStyle}>Setup Instructions (optional)</label>
              <textarea
                rows={3}
                value={editState.setupInstructions}
                onChange={(e) => updateEdit({ setupInstructions: e.target.value })}
                style={textareaStyle}
                placeholder="Optional setup steps..."
              />
            </div>

            {/* Reference Solution */}
            <div style={fieldStyle}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  marginBottom: '10px',
                  gap: '8px',
                }}
              >
                <label style={{ ...labelStyle, margin: 0, flex: 1 }}>
                  Reference Solution Files
                </label>
                <button
                  onClick={addFile}
                  style={{
                    padding: '4px 10px',
                    background: 'transparent',
                    border: `1px solid ${colors.border}`,
                    borderRadius: '5px',
                    color: colors.accent,
                    fontSize: '14px',
                    cursor: 'pointer',
                  }}
                >
                  + Add File
                </button>
              </div>

              {editState.referenceSolution.length === 0 && (
                <p style={{ color: colors.textMuted, fontSize: '16px', margin: 0 }}>
                  No files. Click "Add File" to add one.
                </p>
              )}

              {editState.referenceSolution.map((file, idx) => (
                <div
                  key={idx}
                  style={{
                    border: `1px solid ${colors.border}`,
                    borderRadius: '6px',
                    marginBottom: '12px',
                    overflow: 'hidden',
                  }}
                >
                  {/* File header */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 10px',
                      background: colors.sidebar,
                      borderBottom: `1px solid ${colors.border}`,
                    }}
                  >
                    <input
                      value={file.path}
                      onChange={(e) => updateFile(idx, { path: e.target.value })}
                      placeholder="filename (e.g. solution.ts)"
                      style={{
                        ...inputStyle,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontSize: '14px',
                        padding: '5px 8px',
                      }}
                    />
                    <button
                      onClick={() => removeFile(idx)}
                      style={{
                        padding: '5px 10px',
                        background: 'transparent',
                        border: `1px solid ${colors.red}`,
                        borderRadius: '5px',
                        color: colors.red,
                        fontSize: '14px',
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      Remove
                    </button>
                  </div>
                  {/* File content */}
                  <Editor
                    height="500px"
                    language={detectLanguage(file.path)}
                    value={file.content}
                    onChange={(value) => updateFile(idx, { content: value ?? '' })}
                    theme="vs-dark"
                    options={{
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      fontSize: 13,
                      lineNumbers: 'on',
                      wordWrap: 'off',
                      folding: false,
                      renderLineHighlight: 'none',
                      overviewRulerLanes: 0,
                      scrollbar: {
                        verticalScrollbarSize: 8,
                        horizontalScrollbarSize: 8,
                      },
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
