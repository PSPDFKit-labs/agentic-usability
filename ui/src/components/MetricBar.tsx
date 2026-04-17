const colors = {
  text: '#e6edf3',
  textMuted: '#8b949e',
  track: '#21262d',
  accent: '#58a6ff',
};

interface MetricBarProps {
  label: string;
  value: number;
  color?: string;
}

export function MetricBar({ label, value, color = colors.accent }: MetricBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  const pct = Math.round(clamped);

  return (
    <div style={{ marginBottom: '10px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '12px',
          marginBottom: '5px',
        }}
      >
        <span style={{ color: colors.textMuted }}>{label}</span>
        <span style={{ color: colors.text, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
          {pct}%
        </span>
      </div>
      <div
        style={{
          height: '6px',
          background: colors.track,
          borderRadius: '3px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${clamped}%`,
            background: color,
            borderRadius: '3px',
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}
