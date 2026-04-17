import { DiffEditor } from '@monaco-editor/react';

const colors = {
  text: '#e6edf3',
  textMuted: '#8b949e',
  border: '#30363d',
  sidebar: '#161b22',
};

interface DiffViewerProps {
  original: string;
  modified: string;
  language?: string;
  originalLabel?: string;
  modifiedLabel?: string;
  height?: string;
}

export function DiffViewer({
  original,
  modified,
  language = 'typescript',
  originalLabel,
  modifiedLabel,
  height = '400px',
}: DiffViewerProps) {
  const showLabels = originalLabel || modifiedLabel;

  return (
    <div
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      {showLabels && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            background: colors.sidebar,
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <div
            style={{
              padding: '8px 16px',
              fontSize: '12px',
              color: colors.textMuted,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              borderRight: `1px solid ${colors.border}`,
            }}
          >
            {originalLabel ?? ''}
          </div>
          <div
            style={{
              padding: '8px 16px',
              fontSize: '12px',
              color: colors.textMuted,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
          >
            {modifiedLabel ?? ''}
          </div>
        </div>
      )}
      <DiffEditor
        height={height}
        language={language}
        original={original}
        modified={modified}
        theme="vs-dark"
        options={{
          readOnly: true,
          renderSideBySide: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 13,
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
  );
}
