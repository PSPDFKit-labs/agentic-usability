import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { getRuns, deleteRun as apiDeleteRun, updateRunLabel as apiUpdateRunLabel, type RunInfo } from '../api';

interface RunContextValue {
  runs: RunInfo[];
  refreshRuns: () => Promise<void>;
  removeRun: (id: string) => Promise<void>;
  renameRun: (id: string, label: string) => Promise<void>;
  loading: boolean;
}

const RunContext = createContext<RunContextValue | null>(null);

export function RunProvider({ children }: { children: ReactNode }) {
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [loading, setLoading] = useState(true);

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
    await fetchRuns();
  }, [fetchRuns]);

  const renameRun = useCallback(async (id: string, label: string) => {
    await apiUpdateRunLabel(id, label);
    await fetchRuns();
  }, [fetchRuns]);

  useEffect(() => {
    fetchRuns().then(() => setLoading(false));
  }, [fetchRuns]);

  return (
    <RunContext.Provider value={{ runs, refreshRuns, removeRun, renameRun, loading }}>
      {children}
    </RunContext.Provider>
  );
}

export function useRuns(): RunContextValue {
  const ctx = useContext(RunContext);
  if (!ctx) throw new Error('useRuns must be used within a RunProvider');
  return ctx;
}
