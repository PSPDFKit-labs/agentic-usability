import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { getRuns, deleteRun as apiDeleteRun, updateRunLabel as apiUpdateRunLabel, type RunInfo } from '../api';

interface RunContextValue {
  runs: RunInfo[];
  activeRunId: string | null;
  setActiveRunId: (id: string) => void;
  refreshRuns: () => Promise<void>;
  removeRun: (id: string) => Promise<void>;
  renameRun: (id: string, label: string) => Promise<void>;
  loading: boolean;
}

const RunContext = createContext<RunContextValue | null>(null);

const STORAGE_KEY = 'agentic-usability-active-run';

export function RunProvider({ children }: { children: ReactNode }) {
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [activeRunId, setActiveRunIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const setActiveRunId = useCallback((id: string) => {
    setActiveRunIdState(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* noop */ }
  }, []);

  const fetchRuns = useCallback(async () => {
    try {
      const data = await getRuns();
      setRuns(data);
      return data;
    } catch {
      return [];
    }
  }, []);

  const refreshRuns = useCallback(async () => {
    await fetchRuns();
  }, [fetchRuns]);

  const removeRun = useCallback(async (id: string) => {
    await apiDeleteRun(id);
    const updated = await fetchRuns();
    // If deleted the active run, switch to latest
    if (id === activeRunId) {
      if (updated.length > 0) {
        setActiveRunId(updated[0].id);
      } else {
        setActiveRunIdState(null);
      }
    }
  }, [activeRunId, fetchRuns, setActiveRunId]);

  const renameRun = useCallback(async (id: string, label: string) => {
    await apiUpdateRunLabel(id, label);
    await fetchRuns();
  }, [fetchRuns]);

  // Initial load
  useEffect(() => {
    fetchRuns().then((data) => {
      if (data.length > 0) {
        const saved = localStorage.getItem(STORAGE_KEY);
        const match = saved ? data.find((r) => r.id === saved) : null;
        setActiveRunIdState(match ? match.id : data[0].id);
      }
      setLoading(false);
    });
  }, [fetchRuns]);

  return (
    <RunContext.Provider value={{ runs, activeRunId, setActiveRunId, refreshRuns, removeRun, renameRun, loading }}>
      {children}
    </RunContext.Provider>
  );
}

export function useRuns(): RunContextValue {
  const ctx = useContext(RunContext);
  if (!ctx) throw new Error('useRuns must be used within a RunProvider');
  return ctx;
}
