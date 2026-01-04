/**
 * BackgroundTaskDrawer Component Tests
 *
 * Tests for the drawer that displays background task progress.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BackgroundTaskDrawer } from '../BackgroundTaskDrawer';
import type { BackgroundTask } from '../../stores/backgroundTasks';

let mockTasks: BackgroundTask[] = [];
let mockDrawerState: 'hidden' | 'badge' | 'collapsed' | 'expanded' = 'hidden';
const mockSetDrawerState = vi.fn();
const mockClearCompleted = vi.fn();
const mockCancelTask = vi.fn();
const mockRemoveTask = vi.fn();

vi.mock('../../stores/backgroundTasks', () => ({
  useBackgroundTasks: (selector?: (state: any) => any) => {
    const state = {
      tasks: mockTasks,
      drawerState: mockDrawerState,
      setDrawerState: mockSetDrawerState,
      clearCompleted: mockClearCompleted,
      cancelTask: mockCancelTask,
      removeTask: mockRemoveTask,
      activeTasks: () => mockTasks.filter(t => t.status === 'pending' || t.status === 'in_progress'),
      completedTasks: () => mockTasks.filter(t => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled'),
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('BackgroundTaskDrawer', () => {
  beforeEach(() => {
    mockTasks = [];
    mockDrawerState = 'hidden';
    mockSetDrawerState.mockClear();
    mockClearCompleted.mockClear();
    mockCancelTask.mockClear();
    mockRemoveTask.mockClear();
  });

  describe('Hidden State', () => {
    it('should render nothing when hidden', () => {
      mockDrawerState = 'hidden';
      const { container } = render(<BackgroundTaskDrawer />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('Badge State', () => {
    it('should show badge with completed count', () => {
      mockDrawerState = 'badge';
      mockTasks = [
        {
          id: '1',
          type: 'download',
          status: 'completed',
          progress: 100,
          metadata: { title: 'test1.mp4' },
          createdAt: Date.now(),
          completedAt: Date.now(),
        },
        {
          id: '2',
          type: 'download',
          status: 'completed',
          progress: 100,
          metadata: { title: 'test2.mp4' },
          createdAt: Date.now(),
          completedAt: Date.now(),
        },
      ];

      render(<BackgroundTaskDrawer />);

      const badge = screen.getByTestId('background-tasks-badge');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('2');
      expect(badge).toHaveTextContent('backgroundTasks.completed');
    });

    it('should expand drawer when badge is clicked', () => {
      mockDrawerState = 'badge';
      mockTasks = [
        {
          id: '1',
          type: 'download',
          status: 'completed',
          progress: 100,
          metadata: { title: 'test.mp4' },
          createdAt: Date.now(),
          completedAt: Date.now(),
        },
      ];

      render(<BackgroundTaskDrawer />);

      const badge = screen.getByTestId('background-tasks-badge');
      fireEvent.click(badge);

      expect(mockSetDrawerState).toHaveBeenCalledWith('expanded');
    });
  });

  describe('Collapsed State', () => {
    it('should show collapsed bar with first active task', () => {
      mockDrawerState = 'collapsed';
      mockTasks = [
        {
          id: '1',
          type: 'download',
          status: 'in_progress',
          progress: 45,
          metadata: { title: 'test.mp4' },
          createdAt: Date.now(),
        },
      ];

      render(<BackgroundTaskDrawer />);

      const collapsed = screen.getByTestId('background-tasks-collapsed');
      expect(collapsed).toBeInTheDocument();
      expect(collapsed).toHaveTextContent('45%');
    });

    it('should expand when collapsed bar is clicked', () => {
      mockDrawerState = 'collapsed';
      mockTasks = [
        {
          id: '1',
          type: 'download',
          status: 'in_progress',
          progress: 50,
          metadata: { title: 'test.mp4' },
          createdAt: Date.now(),
        },
      ];

      render(<BackgroundTaskDrawer />);

      const expandButton = screen.getByTestId('expand-collapsed-button');
      fireEvent.click(expandButton);

      expect(mockSetDrawerState).toHaveBeenCalledWith('expanded');
    });

    it('should render nothing if no active tasks', () => {
      mockDrawerState = 'collapsed';
      mockTasks = [
        {
          id: '1',
          type: 'download',
          status: 'completed',
          progress: 100,
          metadata: { title: 'test.mp4' },
          createdAt: Date.now(),
          completedAt: Date.now(),
        },
      ];

      const { container } = render(<BackgroundTaskDrawer />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('Expanded State', () => {
    it('should show expanded drawer with task list', () => {
      mockDrawerState = 'expanded';
      mockTasks = [
        {
          id: '1',
          type: 'download',
          status: 'in_progress',
          progress: 45,
          metadata: { title: 'test.mp4' },
          createdAt: Date.now(),
        },
      ];

      render(<BackgroundTaskDrawer />);

      const drawer = screen.getByTestId('background-tasks-drawer');
      const title = screen.getByTestId('background-tasks-title');
      const taskList = screen.getByTestId('background-tasks-list');

      expect(drawer).toBeInTheDocument();
      expect(title).toHaveTextContent('backgroundTasks.title');
      expect(taskList).toBeInTheDocument();
    });

    it('should show active task badge', () => {
      mockDrawerState = 'expanded';
      mockTasks = [
        {
          id: '1',
          type: 'download',
          status: 'in_progress',
          progress: 45,
          metadata: { title: 'test1.mp4' },
          createdAt: Date.now(),
        },
        {
          id: '2',
          type: 'download',
          status: 'in_progress',
          progress: 75,
          metadata: { title: 'test2.mp4' },
          createdAt: Date.now(),
        },
      ];

      render(<BackgroundTaskDrawer />);

      const badge = screen.getByText('2 backgroundTasks.active');
      expect(badge).toBeInTheDocument();
    });

    it('should show clear completed button when there are completed tasks', () => {
      mockDrawerState = 'expanded';
      mockTasks = [
        {
          id: '1',
          type: 'download',
          status: 'completed',
          progress: 100,
          metadata: { title: 'test.mp4' },
          createdAt: Date.now(),
          completedAt: Date.now(),
        },
      ];

      render(<BackgroundTaskDrawer />);

      const clearButton = screen.getByTestId('clear-completed-button');
      expect(clearButton).toBeInTheDocument();

      fireEvent.click(clearButton);
      expect(mockClearCompleted).toHaveBeenCalled();
    });

    it('should collapse drawer when collapse button is clicked', () => {
      mockDrawerState = 'expanded';
      mockTasks = [
        {
          id: '1',
          type: 'download',
          status: 'in_progress',
          progress: 50,
          metadata: { title: 'test.mp4' },
          createdAt: Date.now(),
        },
      ];

      render(<BackgroundTaskDrawer />);

      const collapseButton = screen.getByTestId('collapse-drawer-button');
      fireEvent.click(collapseButton);

      expect(mockSetDrawerState).toHaveBeenCalledWith('collapsed');
    });

    it('should minimize to badge when collapsing with no active tasks', () => {
      mockDrawerState = 'expanded';
      mockTasks = [
        {
          id: '1',
          type: 'download',
          status: 'completed',
          progress: 100,
          metadata: { title: 'test.mp4' },
          createdAt: Date.now(),
          completedAt: Date.now(),
        },
      ];

      render(<BackgroundTaskDrawer />);

      const collapseButton = screen.getByTestId('collapse-drawer-button');
      fireEvent.click(collapseButton);

      expect(mockSetDrawerState).toHaveBeenCalledWith('badge');
    });
  });

  describe('Task Items', () => {
    it('should display task with progress bar', () => {
      mockDrawerState = 'expanded';
      mockTasks = [
        {
          id: 'task-1',
          type: 'download',
          status: 'in_progress',
          progress: 65,
          metadata: { title: 'MyVideo.mp4', description: 'Event 1234' },
          createdAt: Date.now(),
        },
      ];

      render(<BackgroundTaskDrawer />);

      const taskItem = screen.getByTestId('task-item-task-1');
      const taskTitle = screen.getByTestId('task-title');
      const progressBar = screen.getByTestId('task-progress-bar');
      const progressText = screen.getByTestId('task-progress-text');

      expect(taskItem).toBeInTheDocument();
      expect(taskTitle).toHaveTextContent('MyVideo.mp4');
      expect(progressBar).toBeInTheDocument();
      expect(progressText).toHaveTextContent('65%');
    });

    it('should show file size info if available', () => {
      mockDrawerState = 'expanded';
      mockTasks = [
        {
          id: 'task-1',
          type: 'download',
          status: 'in_progress',
          progress: 50,
          metadata: {
            title: 'video.mp4',
            fileSize: 10000000, // 10MB
            bytesProcessed: 5000000, // 5MB
          },
          createdAt: Date.now(),
        },
      ];

      render(<BackgroundTaskDrawer />);

      const sizeText = screen.getByTestId('task-size-text');
      expect(sizeText).toBeInTheDocument();
    });

    it('should show cancel button for active tasks with cancelFn', () => {
      const cancelFn = vi.fn();
      mockDrawerState = 'expanded';
      mockTasks = [
        {
          id: 'task-1',
          type: 'download',
          status: 'in_progress',
          progress: 50,
          metadata: { title: 'video.mp4' },
          createdAt: Date.now(),
          cancelFn,
        },
      ];

      render(<BackgroundTaskDrawer />);

      const cancelButton = screen.getByTestId('task-cancel-button');
      expect(cancelButton).toBeInTheDocument();

      fireEvent.click(cancelButton);
      expect(mockCancelTask).toHaveBeenCalledWith('task-1');
    });

    it('should show remove button for completed tasks', () => {
      mockDrawerState = 'expanded';
      mockTasks = [
        {
          id: 'task-1',
          type: 'download',
          status: 'completed',
          progress: 100,
          metadata: { title: 'video.mp4' },
          createdAt: Date.now(),
          completedAt: Date.now(),
        },
      ];

      render(<BackgroundTaskDrawer />);

      const removeButton = screen.getByTestId('task-remove-button');
      expect(removeButton).toBeInTheDocument();

      fireEvent.click(removeButton);
      expect(mockRemoveTask).toHaveBeenCalledWith('task-1');
    });

    it('should show completed status', () => {
      mockDrawerState = 'expanded';
      mockTasks = [
        {
          id: 'task-1',
          type: 'download',
          status: 'completed',
          progress: 100,
          metadata: { title: 'video.mp4' },
          createdAt: Date.now(),
          completedAt: Date.now(),
        },
      ];

      render(<BackgroundTaskDrawer />);

      const completedText = screen.getByTestId('task-completed-text');
      expect(completedText).toHaveTextContent('backgroundTasks.completed');
    });

    it('should show error message for failed tasks', () => {
      mockDrawerState = 'expanded';
      mockTasks = [
        {
          id: 'task-1',
          type: 'download',
          status: 'failed',
          progress: 45,
          metadata: { title: 'video.mp4' },
          createdAt: Date.now(),
          completedAt: Date.now(),
          error: new Error('Network error'),
        },
      ];

      render(<BackgroundTaskDrawer />);

      const errorMessage = screen.getByTestId('task-error-message');
      expect(errorMessage).toHaveTextContent('Network error');
    });
  });
});
