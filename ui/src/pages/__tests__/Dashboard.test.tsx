import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Dashboard } from '../Dashboard';
import type { TargetResults } from '../../api';

vi.mock('../../api', () => ({
  getAllResults: vi.fn(),
}));

import { getAllResults } from '../../api';

const mockGetAllResults = vi.mocked(getAllResults);

function makeTargetResults(target = 'claude'): TargetResults {
  return {
    target,
    testResults: [
      {
        testId: 'TC-001',
        difficulty: 'easy',
        problemStatement: 'Test problem',
        targetApis: ['apiA'],
        expectedTokens: ['tok1'],
        tokenAnalysis: {
          testId: 'TC-001', target,
          apis: [{ token: 'apiA', found: true }],
          tokens: [{ token: 'tok1', found: true }],
          apiCoverage: 100, tokenCoverage: 100,
        },
        judgeScore: {
          testId: 'TC-001', target,
          apiDiscovery: 90, callCorrectness: 85,
          completeness: 80, functionalCorrectness: 88,
          overallVerdict: true, notes: 'good',
        },
        generatedSolution: null,
        agentNotes: null,
      },
    ],
    aggregates: {
      target,
      testResults: [],
      avgApiCoverage: 100,
      avgTokenCoverage: 100,
      avgApiDiscovery: 90,
      avgCallCorrectness: 85,
      avgCompleteness: 80,
      avgFunctionalCorrectness: 88,
      passRate: 100,
      byDifficulty: {},
      worstApis: [],
      missedTokens: [],
    },
  };
}

function renderDashboard() {
  return render(
    <BrowserRouter>
      <Dashboard />
    </BrowserRouter>
  );
}

describe('Dashboard', () => {
  beforeEach(() => {
    mockGetAllResults.mockReset();
  });

  it('shows loading indicator initially', () => {
    // Keep promise pending so loading state persists
    mockGetAllResults.mockReturnValueOnce(new Promise(() => {}));

    renderDashboard();

    expect(screen.getByText(/loading results/i)).toBeInTheDocument();
  });

  it('renders scorecard after data loads', async () => {
    mockGetAllResults.mockResolvedValueOnce({ targets: [makeTargetResults('claude')] });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Aggregate Scores')).toBeInTheDocument();
    });

    // Target name should appear
    expect(screen.getByText('claude')).toBeInTheDocument();
  });

  it('shows error message when fetch fails', async () => {
    mockGetAllResults.mockRejectedValueOnce(new Error('Network error'));

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/error loading results/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/network error/i)).toBeInTheDocument();
  });

  it('shows empty state when no targets are returned', async () => {
    mockGetAllResults.mockResolvedValueOnce({ targets: [] });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/no results yet/i)).toBeInTheDocument();
    });
  });

  it('renders multiple targets when present', async () => {
    mockGetAllResults.mockResolvedValueOnce({
      targets: [makeTargetResults('claude'), makeTargetResults('gpt-4')],
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('claude')).toBeInTheDocument();
      expect(screen.getByText('gpt-4')).toBeInTheDocument();
    });
  });
});
