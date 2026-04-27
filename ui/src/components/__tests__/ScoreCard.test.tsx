import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScoreCard } from '../ScoreCard';
import type { AggregateResults } from '../../api';

function makeAggregates(overrides: Partial<AggregateResults> = {}): AggregateResults {
  return {
    target: 'claude',
    testResults: [],
    avgApiDiscovery: 70,
    avgCallCorrectness: 65,
    avgCompleteness: 60,
    avgFunctionalCorrectness: 55,
    passRate: 50,
    byDifficulty: {},
    ...overrides,
  };
}

describe('ScoreCard', () => {
  it('renders the title', () => {
    render(<ScoreCard title="Aggregate Scores" aggregates={makeAggregates()} />);
    expect(screen.getByText('Aggregate Scores')).toBeInTheDocument();
  });

  it('renders all 5 metric labels', () => {
    render(<ScoreCard title="Scores" aggregates={makeAggregates()} />);

    expect(screen.getByText('API Discovery')).toBeInTheDocument();
    expect(screen.getByText('Call Correctness')).toBeInTheDocument();
    expect(screen.getByText('Completeness')).toBeInTheDocument();
    expect(screen.getByText('Functional Correctness')).toBeInTheDocument();
    expect(screen.getByText('Pass Rate')).toBeInTheDocument();
  });

  it('handles zero aggregates without crashing', () => {
    const zeroAgg = makeAggregates({
      avgApiDiscovery: 0,
      avgCallCorrectness: 0,
      avgCompleteness: 0,
      avgFunctionalCorrectness: 0,
      passRate: 0,
    });

    render(<ScoreCard title="Zero Scores" aggregates={zeroAgg} />);

    const zeroPcts = screen.getAllByText('0%');
    expect(zeroPcts.length).toBe(5);
  });

  it('renders percentage values derived from aggregates', () => {
    const agg = makeAggregates({ avgApiDiscovery: 93 });
    render(<ScoreCard title="Scores" aggregates={agg} />);

    expect(screen.getByText('93%')).toBeInTheDocument();
  });
});
