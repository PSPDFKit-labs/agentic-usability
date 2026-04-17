import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScoreCard } from '../ScoreCard';
import type { AggregateResults } from '../../api';

function makeAggregates(overrides: Partial<AggregateResults> = {}): AggregateResults {
  return {
    target: 'claude',
    testResults: [],
    avgApiCoverage: 80,
    avgTokenCoverage: 75,
    avgApiDiscovery: 70,
    avgCallCorrectness: 65,
    avgCompleteness: 60,
    avgFunctionalCorrectness: 55,
    passRate: 50,
    byDifficulty: {},
    worstApis: [],
    missedTokens: [],
    ...overrides,
  };
}

describe('ScoreCard', () => {
  it('renders the title', () => {
    render(<ScoreCard title="Aggregate Scores" aggregates={makeAggregates()} />);
    expect(screen.getByText('Aggregate Scores')).toBeInTheDocument();
  });

  it('renders all 7 metric labels', () => {
    render(<ScoreCard title="Scores" aggregates={makeAggregates()} />);

    expect(screen.getByText('API Coverage')).toBeInTheDocument();
    expect(screen.getByText('Token Coverage')).toBeInTheDocument();
    expect(screen.getByText('API Discovery')).toBeInTheDocument();
    expect(screen.getByText('Call Correctness')).toBeInTheDocument();
    expect(screen.getByText('Completeness')).toBeInTheDocument();
    expect(screen.getByText('Functional Correctness')).toBeInTheDocument();
    expect(screen.getByText('Pass Rate')).toBeInTheDocument();
  });

  it('handles zero aggregates without crashing', () => {
    const zeroAgg = makeAggregates({
      avgApiCoverage: 0,
      avgTokenCoverage: 0,
      avgApiDiscovery: 0,
      avgCallCorrectness: 0,
      avgCompleteness: 0,
      avgFunctionalCorrectness: 0,
      passRate: 0,
    });

    render(<ScoreCard title="Zero Scores" aggregates={zeroAgg} />);

    // All percentage bars should show 0%
    const zeroPcts = screen.getAllByText('0%');
    expect(zeroPcts.length).toBe(7);
  });

  it('renders percentage values derived from aggregates', () => {
    const agg = makeAggregates({ avgApiCoverage: 93 });
    render(<ScoreCard title="Scores" aggregates={agg} />);

    expect(screen.getByText('93%')).toBeInTheDocument();
  });
});
