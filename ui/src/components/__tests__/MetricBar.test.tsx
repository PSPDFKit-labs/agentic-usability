import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricBar } from '../MetricBar';

describe('MetricBar', () => {
  it('renders label text', () => {
    render(<MetricBar label="API Coverage" value={75} />);
    expect(screen.getByText('API Coverage')).toBeInTheDocument();
  });

  it('renders percentage value', () => {
    render(<MetricBar label="Token Coverage" value={82} />);
    expect(screen.getByText('82%')).toBeInTheDocument();
  });

  it('clamps negative values to 0%', () => {
    render(<MetricBar label="Pass Rate" value={-10} />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('clamps values over 100 to 100%', () => {
    render(<MetricBar label="Completeness" value={150} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('renders 0% correctly', () => {
    render(<MetricBar label="Functional Correctness" value={0} />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('renders 100% correctly', () => {
    render(<MetricBar label="Call Correctness" value={100} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('rounds fractional values', () => {
    render(<MetricBar label="Discovery" value={66.7} />);
    expect(screen.getByText('67%')).toBeInTheDocument();
  });
});
