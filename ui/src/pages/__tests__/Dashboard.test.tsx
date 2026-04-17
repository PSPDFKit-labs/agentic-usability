import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Dashboard } from '../Dashboard';
import { RunProvider } from '../../context/RunContext';

vi.mock('../../api', () => ({
  getRuns: vi.fn(),
  getRunResults: vi.fn(),
}));

import { getRuns, getRunResults } from '../../api';

const mockGetRuns = vi.mocked(getRuns);
const mockGetRunResults = vi.mocked(getRunResults);

function renderDashboard() {
  return render(
    <BrowserRouter>
      <RunProvider>
        <Dashboard />
      </RunProvider>
    </BrowserRouter>
  );
}

describe('Dashboard', () => {
  beforeEach(() => {
    mockGetRuns.mockReset();
    mockGetRunResults.mockReset();
    mockGetRunResults.mockResolvedValue({ targets: [] });
  });

  it('shows loading indicator initially', () => {
    mockGetRuns.mockReturnValueOnce(new Promise(() => {}));
    renderDashboard();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows empty state when no runs exist', async () => {
    mockGetRuns.mockResolvedValueOnce([]);
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/no evaluation runs yet/i)).toBeInTheDocument();
    });
  });

  it('renders run cards when runs exist', async () => {
    mockGetRuns.mockResolvedValueOnce([
      { id: 'run-1', createdAt: '2026-04-17T10:00:00Z', targets: ['claude'], testCount: 12, label: 'baseline' },
    ]);
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('baseline')).toBeInTheDocument();
    });
    expect(screen.getByText('12 tests')).toBeInTheDocument();
  });

  it('renders multiple runs', async () => {
    mockGetRuns.mockResolvedValueOnce([
      { id: 'run-1', createdAt: '2026-04-17T10:00:00Z', targets: ['claude'], testCount: 12, label: 'Run A' },
      { id: 'run-2', createdAt: '2026-04-15T09:00:00Z', targets: ['gpt-4'], testCount: 8, label: 'Run B' },
    ]);
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Run A')).toBeInTheDocument();
      expect(screen.getByText('Run B')).toBeInTheDocument();
    });
  });

  it('shows delete button for each run', async () => {
    mockGetRuns.mockResolvedValueOnce([
      { id: 'run-1', createdAt: '2026-04-17T10:00:00Z', targets: ['claude'], testCount: 5, label: null },
    ]);
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });
  });
});
