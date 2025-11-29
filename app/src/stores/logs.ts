import { create } from 'zustand';

export interface LogEntry {
    id: string;
    timestamp: string;
    level: string;
    message: string;
    context?: Record<string, unknown>;
    args?: unknown[];
}

interface LogState {
    logs: LogEntry[];
    addLog: (entry: Omit<LogEntry, 'id'>) => void;
    clearLogs: () => void;
}

export const useLogStore = create<LogState>((set) => ({
    logs: [],
    addLog: (entry) =>
        set((state) => {
            const newLog = { ...entry, id: crypto.randomUUID() };
            // Keep last 1000 logs
            const newLogs = [newLog, ...state.logs].slice(0, 1000);
            return { logs: newLogs };
        }),
    clearLogs: () => set({ logs: [] }),
}));
