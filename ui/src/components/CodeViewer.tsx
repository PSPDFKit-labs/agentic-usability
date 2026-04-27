import Editor from '@monaco-editor/react';

const colors = {
  text: '#e6edf3',
  textMuted: '#8b949e',
  border: '#30363d',
  sidebar: '#161b22',
  bg: '#0d1117',
};

export function detectLanguage(filename?: string, language?: string): string {
  if (language) return language;
  if (!filename) return 'typescript';
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts': return 'typescript';
    case 'tsx': return 'typescript';
    case 'js': return 'javascript';
    case 'jsx': return 'javascript';
    case 'py': return 'python';
    case 'json': return 'json';
    case 'md': return 'markdown';
    case 'sh': return 'shell';
    case 'bash': return 'shell';
    case 'html': return 'html';
    case 'css': return 'css';
    case 'yaml':
    case 'yml': return 'yaml';
    case 'rs': return 'rust';
    case 'go': return 'go';
    case 'java': return 'java';
    case 'c': return 'c';
    case 'cpp':
    case 'cc': return 'cpp';
    case 'rb': return 'ruby';
    case 'php': return 'php';
    case 'sql': return 'sql';
    default: return 'plaintext';
  }
}

interface CodeViewerProps {
  code: string;
  language?: string;
  filename?: string;
  height?: string;
}

export function CodeViewer({ code, language, filename, height = '300px' }: CodeViewerProps) {
  const detectedLang = detectLanguage(filename, language);

  return (
    <div
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      {filename && (
        <div
          style={{
            background: colors.sidebar,
            borderBottom: `1px solid ${colors.border}`,
            padding: '8px 16px',
            fontSize: '14px',
            color: colors.textMuted,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        >
          {filename}
        </div>
      )}
      <Editor
        height={height}
        language={detectedLang}
        value={code}
        theme="vs-dark"
        options={{
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 13,
          lineNumbers: 'on',
          wordWrap: 'off',
          folding: false,
          renderLineHighlight: 'none',
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          scrollbar: {
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
          },
        }}
      />
    </div>
  );
}
