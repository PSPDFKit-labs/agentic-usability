import { AggregateResults } from '../api';
import { MetricBar } from './MetricBar';

const colors = {
  text: '#e6edf3',
  border: '#30363d',
  sidebar: '#161b22',
};

interface ScoreCardProps {
  title: string;
  aggregates: AggregateResults;
}

const metrics: Array<{ label: string; key: keyof AggregateResults }> = [
  { label: 'API Coverage', key: 'avgApiCoverage' },
  { label: 'Token Coverage', key: 'avgTokenCoverage' },
  { label: 'API Discovery', key: 'avgApiDiscovery' },
  { label: 'Call Correctness', key: 'avgCallCorrectness' },
  { label: 'Completeness', key: 'avgCompleteness' },
  { label: 'Functional Correctness', key: 'avgFunctionalCorrectness' },
  { label: 'Pass Rate', key: 'passRate' },
];

export function ScoreCard({ title, aggregates }: ScoreCardProps) {
  return (
    <div
      style={{
        background: colors.sidebar,
        border: `1px solid ${colors.border}`,
        borderRadius: '8px',
        padding: '20px',
        color: colors.text,
      }}
    >
      <div
        style={{
          fontSize: '16px',
          fontWeight: 700,
          marginBottom: '16px',
          letterSpacing: '0.01em',
        }}
      >
        {title}
      </div>
      {metrics.map(({ label, key }) => {
        const raw = aggregates[key];
        const value = typeof raw === 'number' ? raw : 0;
        return <MetricBar key={key} label={label} value={value} />;
      })}
    </div>
  );
}
