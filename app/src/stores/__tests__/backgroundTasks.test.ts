/**
 * Background Tasks Store Tests
 *
 * Tests for the background task management including:
 * - Adding tasks
 * - Updating progress
 * - Completing tasks
 * - Failing tasks
 * - Cancelling tasks
 * - Removing tasks
 * - Drawer state management
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useBackgroundTasks } from '../backgroundTasks';

describe('Background Tasks Store', () => {
  beforeEach(() => {
    // Reset store state before each test
    useBackgroundTasks.setState({
      tasks: [],
      drawerState: 'hidden',
    });
  });

  describe('Adding Tasks', () => {
    it('should add a task and auto-expand drawer', () => {
      const { addTask } = useBackgroundTasks.getState();

      const taskId = addTask({
        type: 'download',
        metadata: {
          title: 'test-file.mp4',
          description: 'Test download',
        },
      });

      const state = useBackgroundTasks.getState();
      expect(state.tasks).toHaveLength(1);
      expect(state.tasks[0].id).toBe(taskId);
      expect(state.tasks[0].type).toBe('download');
      expect(state.tasks[0].status).toBe('pending');
      expect(state.tasks[0].progress).toBe(0);
      expect(state.tasks[0].metadata.title).toBe('test-file.mp4');
      expect(state.drawerState).toBe('expanded');
    });

    it('should generate unique task IDs', () => {
      const { addTask } = useBackgroundTasks.getState();

      const taskId1 = addTask({
        type: 'download',
        metadata: { title: 'file1.mp4' },
      });

      const taskId2 = addTask({
        type: 'download',
        metadata: { title: 'file2.mp4' },
      });

      expect(taskId1).not.toBe(taskId2);
    });

    it('should support cancel function', () => {
      const { addTask } = useBackgroundTasks.getState();
      const cancelFn = vi.fn();

      addTask({
        type: 'download',
        metadata: { title: 'test.mp4' },
        cancelFn,
      });

      const state = useBackgroundTasks.getState();
      expect(state.tasks[0].cancelFn).toBe(cancelFn);
    });
  });

  describe('Updating Progress', () => {
    it('should update task progress', () => {
      const { addTask, updateProgress } = useBackgroundTasks.getState();

      const taskId = addTask({
        type: 'download',
        metadata: { title: 'test.mp4' },
      });

      updateProgress(taskId, 50);

      const state = useBackgroundTasks.getState();
      expect(state.tasks[0].status).toBe('in_progress');
      expect(state.tasks[0].progress).toBe(50);
    });

    it('should clamp progress between 0 and 100', () => {
      const { addTask, updateProgress } = useBackgroundTasks.getState();

      const taskId = addTask({
        type: 'download',
        metadata: { title: 'test.mp4' },
      });

      updateProgress(taskId, 150);
      expect(useBackgroundTasks.getState().tasks[0].progress).toBe(100);

      updateProgress(taskId, -10);
      expect(useBackgroundTasks.getState().tasks[0].progress).toBe(0);
    });

    it('should update bytes processed', () => {
      const { addTask, updateProgress } = useBackgroundTasks.getState();

      const taskId = addTask({
        type: 'download',
        metadata: { title: 'test.mp4', fileSize: 1000 },
      });

      updateProgress(taskId, 50, 500);

      const state = useBackgroundTasks.getState();
      expect(state.tasks[0].metadata.bytesProcessed).toBe(500);
    });
  });

  describe('Completing Tasks', () => {
    it('should mark task as completed', () => {
      const { addTask, completeTask } = useBackgroundTasks.getState();

      const taskId = addTask({
        type: 'download',
        metadata: { title: 'test.mp4' },
      });

      completeTask(taskId);

      const state = useBackgroundTasks.getState();
      expect(state.tasks[0].status).toBe('completed');
      expect(state.tasks[0].progress).toBe(100);
      expect(state.tasks[0].completedAt).toBeDefined();
    });

    it('should minimize to badge when all tasks complete', () => {
      const { addTask, completeTask } = useBackgroundTasks.getState();

      const taskId = addTask({
        type: 'download',
        metadata: { title: 'test.mp4' },
      });

      completeTask(taskId);

      const state = useBackgroundTasks.getState();
      expect(state.drawerState).toBe('badge');
    });

    it('should not minimize if there are still active tasks', () => {
      const { addTask, completeTask } = useBackgroundTasks.getState();

      const taskId1 = addTask({
        type: 'download',
        metadata: { title: 'file1.mp4' },
      });

      addTask({
        type: 'download',
        metadata: { title: 'file2.mp4' },
      });

      completeTask(taskId1);

      const state = useBackgroundTasks.getState();
      expect(state.drawerState).toBe('expanded'); // Still has active task
    });
  });

  describe('Failing Tasks', () => {
    it('should mark task as failed with error', () => {
      const { addTask, failTask } = useBackgroundTasks.getState();

      const taskId = addTask({
        type: 'download',
        metadata: { title: 'test.mp4' },
      });

      const error = new Error('Download failed');
      failTask(taskId, error);

      const state = useBackgroundTasks.getState();
      expect(state.tasks[0].status).toBe('failed');
      expect(state.tasks[0].error).toBe(error);
      expect(state.tasks[0].completedAt).toBeDefined();
    });
  });

  describe('Cancelling Tasks', () => {
    it('should mark task as cancelled', () => {
      const { addTask, cancelTask } = useBackgroundTasks.getState();

      const taskId = addTask({
        type: 'download',
        metadata: { title: 'test.mp4' },
      });

      cancelTask(taskId);

      const state = useBackgroundTasks.getState();
      expect(state.tasks[0].status).toBe('cancelled');
      expect(state.tasks[0].completedAt).toBeDefined();
    });

    it('should call cancel function if provided', () => {
      const { addTask, cancelTask } = useBackgroundTasks.getState();
      const cancelFn = vi.fn();

      const taskId = addTask({
        type: 'download',
        metadata: { title: 'test.mp4' },
        cancelFn,
      });

      cancelTask(taskId);

      expect(cancelFn).toHaveBeenCalledOnce();
    });
  });

  describe('Removing Tasks', () => {
    it('should remove a task', () => {
      const { addTask, removeTask } = useBackgroundTasks.getState();

      const taskId = addTask({
        type: 'download',
        metadata: { title: 'test.mp4' },
      });

      removeTask(taskId);

      const state = useBackgroundTasks.getState();
      expect(state.tasks).toHaveLength(0);
    });

    it('should hide drawer when all tasks are removed', () => {
      const { addTask, removeTask } = useBackgroundTasks.getState();

      const taskId = addTask({
        type: 'download',
        metadata: { title: 'test.mp4' },
      });

      removeTask(taskId);

      const state = useBackgroundTasks.getState();
      expect(state.drawerState).toBe('hidden');
    });
  });

  describe('Clearing Completed Tasks', () => {
    it('should clear all completed tasks', () => {
      const { addTask, completeTask, clearCompleted } = useBackgroundTasks.getState();

      const taskId1 = addTask({
        type: 'download',
        metadata: { title: 'file1.mp4' },
      });

      const taskId2 = addTask({
        type: 'download',
        metadata: { title: 'file2.mp4' },
      });

      completeTask(taskId1);
      completeTask(taskId2);

      clearCompleted();

      const state = useBackgroundTasks.getState();
      expect(state.tasks).toHaveLength(0);
      expect(state.drawerState).toBe('hidden');
    });

    it('should only clear completed/failed/cancelled tasks', () => {
      const { addTask, completeTask, failTask, clearCompleted } = useBackgroundTasks.getState();

      const taskId1 = addTask({
        type: 'download',
        metadata: { title: 'file1.mp4' },
      });

      const taskId2 = addTask({
        type: 'download',
        metadata: { title: 'file2.mp4' },
      });

      const taskId3 = addTask({
        type: 'download',
        metadata: { title: 'file3.mp4' },
      });

      completeTask(taskId1);
      failTask(taskId2, new Error('Failed'));
      // taskId3 remains active

      clearCompleted();

      const state = useBackgroundTasks.getState();
      expect(state.tasks).toHaveLength(1);
      expect(state.tasks[0].id).toBe(taskId3);
    });
  });

  describe('Drawer State Management', () => {
    it('should allow manual drawer state changes', () => {
      const { setDrawerState } = useBackgroundTasks.getState();

      setDrawerState('collapsed');
      expect(useBackgroundTasks.getState().drawerState).toBe('collapsed');

      setDrawerState('expanded');
      expect(useBackgroundTasks.getState().drawerState).toBe('expanded');

      setDrawerState('badge');
      expect(useBackgroundTasks.getState().drawerState).toBe('badge');

      setDrawerState('hidden');
      expect(useBackgroundTasks.getState().drawerState).toBe('hidden');
    });
  });

  describe('Computed Getters', () => {
    it('should return active tasks', () => {
      const { addTask, updateProgress, completeTask, activeTasks } = useBackgroundTasks.getState();

      const taskId1 = addTask({
        type: 'download',
        metadata: { title: 'file1.mp4' },
      });

      const taskId2 = addTask({
        type: 'download',
        metadata: { title: 'file2.mp4' },
      });

      const taskId3 = addTask({
        type: 'download',
        metadata: { title: 'file3.mp4' },
      });

      updateProgress(taskId2, 50);
      completeTask(taskId3);

      const active = activeTasks();
      expect(active).toHaveLength(2);
      expect(active.map(t => t.id)).toContain(taskId1);
      expect(active.map(t => t.id)).toContain(taskId2);
      expect(active.map(t => t.id)).not.toContain(taskId3);
    });

    it('should return completed tasks', () => {
      const { addTask, completeTask, failTask, cancelTask, completedTasks } = useBackgroundTasks.getState();

      const taskId1 = addTask({
        type: 'download',
        metadata: { title: 'file1.mp4' },
      });

      const taskId2 = addTask({
        type: 'download',
        metadata: { title: 'file2.mp4' },
      });

      const taskId3 = addTask({
        type: 'download',
        metadata: { title: 'file3.mp4' },
      });

      const taskId4 = addTask({
        type: 'download',
        metadata: { title: 'file4.mp4' },
      });

      completeTask(taskId1);
      failTask(taskId2, new Error('Failed'));
      cancelTask(taskId3);
      // taskId4 remains active

      const completed = completedTasks();
      expect(completed).toHaveLength(3);
      expect(completed.map(t => t.id)).toContain(taskId1);
      expect(completed.map(t => t.id)).toContain(taskId2);
      expect(completed.map(t => t.id)).toContain(taskId3);
      expect(completed.map(t => t.id)).not.toContain(taskId4);
    });

    it('should check if there are active tasks', () => {
      const { addTask, completeTask, hasActiveTasks } = useBackgroundTasks.getState();

      expect(hasActiveTasks()).toBe(false);

      const taskId = addTask({
        type: 'download',
        metadata: { title: 'test.mp4' },
      });

      expect(hasActiveTasks()).toBe(true);

      completeTask(taskId);

      expect(hasActiveTasks()).toBe(false);
    });
  });
});
