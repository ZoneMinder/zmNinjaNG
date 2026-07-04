import { create } from 'zustand';
import { BACKGROUND_TASKS } from '../lib/zmninja-ng-constants';

export type TaskType = 'download' | 'upload' | 'sync' | 'export';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export interface BackgroundTask {
  id: string;
  type: TaskType;
  status: TaskStatus;
  progress: number; // 0-100
  metadata: {
    title: string;
    description?: string;
    fileSize?: number;
    bytesProcessed?: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any; // Allow type-specific metadata
  };
  error?: Error;
  createdAt: number;
  completedAt?: number;
  // For cancellable tasks
  cancelFn?: () => void;
}

interface BackgroundTasksState {
  tasks: BackgroundTask[];
  drawerState: 'hidden' | 'badge' | 'collapsed' | 'expanded';

  // Actions
  addTask: (task: Omit<BackgroundTask, 'id' | 'createdAt' | 'status' | 'progress'>) => string;
  updateProgress: (taskId: string, progress: number, bytesProcessed?: number) => void;
  updateTaskMetadata: (taskId: string, metadata: Partial<BackgroundTask['metadata']>) => void;
  completeTask: (taskId: string) => void;
  failTask: (taskId: string, error: Error) => void;
  cancelTask: (taskId: string) => void;
  removeTask: (taskId: string) => void;
  clearCompleted: () => void;
  setDrawerState: (state: 'hidden' | 'badge' | 'collapsed' | 'expanded') => void;

  // Computed
  activeTasks: () => BackgroundTask[];
  completedTasks: () => BackgroundTask[];
  hasActiveTasks: () => boolean;
}

let taskIdCounter = 0;

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(['completed', 'failed', 'cancelled']);

const isTerminal = (task: BackgroundTask) => TERMINAL_STATUSES.has(task.status);

// Evict the oldest terminal tasks beyond the retention cap. Tasks are stored
// in creation order, so the first terminal entries are the oldest. Active
// (pending/in_progress) tasks are never evicted.
function trimTerminalTasks(tasks: BackgroundTask[]): BackgroundTask[] {
  let excess = tasks.filter(isTerminal).length - BACKGROUND_TASKS.maxRetainedTerminalTasks;
  if (excess <= 0) {
    return tasks;
  }
  return tasks.filter((task) => {
    if (excess > 0 && isTerminal(task)) {
      excess--;
      return false;
    }
    return true;
  });
}

export const useBackgroundTasks = create<BackgroundTasksState>((set, get) => ({
  tasks: [],
  drawerState: 'hidden',

  addTask: (task) => {
    const id = `task-${Date.now()}-${taskIdCounter++}`;
    const newTask: BackgroundTask = {
      ...task,
      id,
      status: 'pending',
      progress: 0,
      createdAt: Date.now(),
    };

    set((state) => ({
      tasks: trimTerminalTasks([...state.tasks, newTask]),
      drawerState: 'expanded', // Auto-expand when task is added
    }));

    return id;
  },

  updateProgress: (taskId, progress, bytesProcessed) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: 'in_progress',
              progress: Math.min(100, Math.max(0, progress)),
              metadata: bytesProcessed
                ? { ...task.metadata, bytesProcessed }
                : task.metadata,
            }
          : task
      ),
    }));
  },

  updateTaskMetadata: (taskId, metadata) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? { ...task, metadata: { ...task.metadata, ...metadata } }
          : task
      ),
    }));
  },

  completeTask: (taskId) => {
    set((state) => ({
      tasks: trimTerminalTasks(
        state.tasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                status: 'completed' as const,
                progress: 100,
                completedAt: Date.now(),
              }
            : task
        )
      ),
    }));

    // Check if all tasks are completed, minimize to badge
    const activeTasks = get().activeTasks();
    if (activeTasks.length === 0) {
      set({ drawerState: 'badge' });
    }
  },

  failTask: (taskId, error) => {
    set((state) => ({
      tasks: trimTerminalTasks(
        state.tasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                status: 'failed' as const,
                error,
                completedAt: Date.now(),
              }
            : task
        )
      ),
    }));
  },

  cancelTask: (taskId) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (task?.cancelFn) {
      task.cancelFn();
    }

    set((state) => ({
      tasks: trimTerminalTasks(
        state.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: 'cancelled' as const,
                completedAt: Date.now(),
              }
            : t
        )
      ),
    }));
  },

  removeTask: (taskId) => {
    set((state) => ({
      tasks: state.tasks.filter((task) => task.id !== taskId),
    }));

    // Hide drawer if no tasks remain
    if (get().tasks.length === 0) {
      set({ drawerState: 'hidden' });
    }
  },

  clearCompleted: () => {
    set((state) => ({
      tasks: state.tasks.filter((task) =>
        task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled'
      ),
    }));

    // Hide drawer if no tasks remain
    if (get().tasks.length === 0) {
      set({ drawerState: 'hidden' });
    }
  },

  setDrawerState: (drawerState) => {
    set({ drawerState });
  },

  // Computed getters
  activeTasks: () => {
    return get().tasks.filter(
      (task) => task.status === 'pending' || task.status === 'in_progress'
    );
  },

  completedTasks: () => {
    return get().tasks.filter(
      (task) => task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'
    );
  },

  hasActiveTasks: () => {
    return get().activeTasks().length > 0;
  },
}));
