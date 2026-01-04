import { create } from 'zustand';

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
      tasks: [...state.tasks, newTask],
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

  completeTask: (taskId) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: 'completed',
              progress: 100,
              completedAt: Date.now(),
            }
          : task
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
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: 'failed',
              error,
              completedAt: Date.now(),
            }
          : task
      ),
    }));
  },

  cancelTask: (taskId) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (task?.cancelFn) {
      task.cancelFn();
    }

    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              status: 'cancelled',
              completedAt: Date.now(),
            }
          : t
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
