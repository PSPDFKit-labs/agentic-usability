import { useEffect, useRef, useState } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { getConfig, putConfig, Config } from '../api';

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

type SaveStatus = 'saved' | 'error' | 'unsaved' | 'saving' | 'idle';

export function ConfigEditor() {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const originalJsonRef = useRef<string>('');

  const loadConfig = async () => {
    setLoading(true);
    try {
      const config = await getConfig();
      const json = JSON.stringify(config, null, 2);
      originalJsonRef.current = json;
      if (editorRef.current) {
        editorRef.current.setValue(json);
      }
      setSaveStatus('saved');
      setErrorMsg('');
    } catch (err) {
      setErrorMsg((err as Error).message);
      setSaveStatus('error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
    if (originalJsonRef.current) {
      editor.setValue(originalJsonRef.current);
    }
    editor.onDidChangeModelContent(() => {
      setSaveStatus('unsaved');
      setErrorMsg('');
    });
  };

  const handleSave = async () => {
    if (!editorRef.current) return;
    const raw = editorRef.current.getValue();
    let parsed: Config;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setErrorMsg('Invalid JSON: cannot parse editor content.');
      setSaveStatus('error');
      return;
    }
    setSaveStatus('saving');
    try {
      await putConfig(parsed);
      originalJsonRef.current = raw;
      setSaveStatus('saved');
      setErrorMsg('');
    } catch (err) {
      setErrorMsg((err as Error).message);
      setSaveStatus('error');
    }
  };

  const handleReset = () => {
    loadConfig();
  };

  const statusColor =
    saveStatus === 'saved' ? colors.green
    : saveStatus === 'error' ? colors.red
    : saveStatus === 'unsaved' ? colors.yellow
    : saveStatus === 'saving' ? colors.accent
    : colors.textMuted;

  const statusLabel =
    saveStatus === 'saved' ? 'Saved'
    : saveStatus === 'error' ? 'Error'
    : saveStatus === 'unsaved' ? 'Unsaved changes'
    : saveStatus === 'saving' ? 'Saving...'
    : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 96px)', gap: '16px' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: '20px', fontWeight: 600, color: colors.text, margin: 0 }}>
            Config Editor
          </h1>
          <p style={{ fontSize: '13px', color: colors.textMuted, margin: '4px 0 0' }}>
            Edit the pipeline configuration JSON.
          </p>
        </div>

        {statusLabel && (
          <span style={{ fontSize: '13px', color: statusColor, fontWeight: 500 }}>
            {statusLabel}
          </span>
        )}

        <button
          onClick={handleReset}
          disabled={loading || saveStatus === 'saving'}
          style={{
            padding: '7px 14px',
            background: 'transparent',
            border: `1px solid ${colors.border}`,
            borderRadius: '6px',
            color: colors.text,
            fontSize: '13px',
            cursor: 'pointer',
            opacity: loading || saveStatus === 'saving' ? 0.5 : 1,
          }}
        >
          Reset
        </button>

        <button
          onClick={handleSave}
          disabled={loading || saveStatus === 'saving'}
          style={{
            padding: '7px 16px',
            background: colors.accent,
            border: 'none',
            borderRadius: '6px',
            color: '#0d1117',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            opacity: loading || saveStatus === 'saving' ? 0.6 : 1,
          }}
        >
          Save
        </button>
      </div>

      {/* Error banner */}
      {saveStatus === 'error' && errorMsg && (
        <div
          style={{
            padding: '10px 14px',
            background: 'rgba(248, 81, 73, 0.1)',
            border: `1px solid ${colors.red}`,
            borderRadius: '6px',
            color: colors.red,
            fontSize: '13px',
            flexShrink: 0,
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* Monaco editor */}
      <div
        style={{
          flex: 1,
          border: `1px solid ${colors.border}`,
          borderRadius: '8px',
          overflow: 'hidden',
        }}
      >
        {loading ? (
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: colors.textMuted,
              fontSize: '14px',
            }}
          >
            Loading config...
          </div>
        ) : (
          <Editor
            height="100%"
            language="json"
            theme="vs-dark"
            onMount={handleEditorMount}
            options={{
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 13,
              wordWrap: 'off',
              folding: true,
              lineNumbers: 'on',
              tabSize: 2,
              scrollbar: {
                verticalScrollbarSize: 8,
                horizontalScrollbarSize: 8,
              },
            }}
          />
        )}
      </div>
    </div>
  );
}
