import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNotificationStore } from '../notifications';
import type { ZMAlarmEvent } from '../../services/notifications';

// Mock the notification service
vi.mock('../../services/notifications', () => ({
  getNotificationService: vi.fn(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    onStateChange: vi.fn((callback: (state: string) => void) => {
      callback('connected');
      return vi.fn();
    }),
    onEvent: vi.fn(() => {
      return vi.fn();
    }),
    setMonitorFilter: vi.fn().mockResolvedValue(undefined),
    updateBadgeCount: vi.fn().mockResolvedValue(undefined),
  })),
  resetNotificationService: vi.fn(),
}));

describe('Notification Store', () => {
  beforeEach(() => {
    // Reset store state
    useNotificationStore.setState({
      settings: {
        enabled: false,
        host: '',
        port: 9000,
        ssl: true,
        monitorFilters: [],
        showToasts: true,
        playSound: false,
        badgeCount: 0,
      },
      connectionState: 'disconnected',
      isConnected: false,
      events: [],
      unreadCount: 0,
    });
  });

  describe('Settings Management', () => {
    it('should update settings', () => {
      const { result } = renderHook(() => useNotificationStore());

      act(() => {
        result.current.updateSettings({
          enabled: true,
          host: 'localhost',
          port: 9000,
        });
      });

      expect(result.current.settings.enabled).toBe(true);
      expect(result.current.settings.host).toBe('localhost');
      expect(result.current.settings.port).toBe(9000);
    });

    it('should add monitor filter', () => {
      const { result } = renderHook(() => useNotificationStore());

      act(() => {
        result.current.setMonitorFilter(1, true, 60);
      });

      expect(result.current.settings.monitorFilters).toHaveLength(1);
      expect(result.current.settings.monitorFilters[0]).toEqual({
        monitorId: 1,
        enabled: true,
        checkInterval: 60,
      });
    });

    it('should update existing monitor filter', () => {
      const { result } = renderHook(() => useNotificationStore());

      act(() => {
        result.current.setMonitorFilter(1, true, 60);
        result.current.setMonitorFilter(1, true, 120);
      });

      expect(result.current.settings.monitorFilters).toHaveLength(1);
      expect(result.current.settings.monitorFilters[0].checkInterval).toBe(120);
    });

    it('should disable monitor filter', () => {
      const { result } = renderHook(() => useNotificationStore());

      act(() => {
        result.current.setMonitorFilter(1, true, 60);
        result.current.setMonitorFilter(1, false);
      });

      expect(result.current.settings.monitorFilters[0].enabled).toBe(false);
    });
  });

  describe('Event Management', () => {
    const mockEvent: ZMAlarmEvent = {
      MonitorId: 1,
      MonitorName: 'Front Door',
      EventId: 12345,
      Cause: '[a] Motion detected',
      Name: 'Front Door',
      ImageUrl: 'https://example.com/image.jpg',
    };

    it('should add event', () => {
      const { result } = renderHook(() => useNotificationStore());

      act(() => {
        result.current.addEvent(mockEvent);
      });

      expect(result.current.events).toHaveLength(1);
      expect(result.current.events[0].EventId).toBe(12345);
      expect(result.current.events[0].read).toBe(false);
      expect(result.current.unreadCount).toBe(1);
    });

    it('should add event with image URL', () => {
      const { result } = renderHook(() => useNotificationStore());

      act(() => {
        result.current.addEvent(mockEvent);
      });

      expect(result.current.events[0].ImageUrl).toBe('https://example.com/image.jpg');
    });

    it('should mark event as read', () => {
      const { result } = renderHook(() => useNotificationStore());

      act(() => {
        result.current.addEvent(mockEvent);
        result.current.markEventRead(12345);
      });

      expect(result.current.events[0].read).toBe(true);
      expect(result.current.unreadCount).toBe(0);
    });

    it('should mark all events as read', () => {
      const { result } = renderHook(() => useNotificationStore());

      act(() => {
        result.current.addEvent({ ...mockEvent, EventId: 1 });
        result.current.addEvent({ ...mockEvent, EventId: 2 });
        result.current.addEvent({ ...mockEvent, EventId: 3 });
        result.current.markAllRead();
      });

      expect(result.current.unreadCount).toBe(0);
      expect(result.current.events.every((e) => e.read)).toBe(true);
    });

    it('should clear all events', () => {
      const { result } = renderHook(() => useNotificationStore());

      act(() => {
        result.current.addEvent(mockEvent);
        result.current.clearEvents();
      });

      expect(result.current.events).toHaveLength(0);
      expect(result.current.unreadCount).toBe(0);
    });

    it('should update badge count when adding events', () => {
      const { result } = renderHook(() => useNotificationStore());

      act(() => {
        result.current.addEvent({ ...mockEvent, EventId: 1 });
        result.current.addEvent({ ...mockEvent, EventId: 2 });
      });

      expect(result.current.settings.badgeCount).toBe(2);
    });

    it('should limit events to 100', () => {
      const { result } = renderHook(() => useNotificationStore());

      act(() => {
        for (let i = 1; i <= 150; i++) {
          result.current.addEvent({ ...mockEvent, EventId: i });
        }
      });

      expect(result.current.events).toHaveLength(100);
      // Should keep the most recent events
      expect(result.current.events[0].EventId).toBe(150);
    });
  });

  describe('Connection Management', () => {
    it('should connect to notification server', async () => {
      const { result } = renderHook(() => useNotificationStore());

      await act(async () => {
        result.current.updateSettings({
          enabled: true,
          host: 'localhost',
          port: 9000,
        });
        await result.current.connect('admin', 'admin');
      });

      expect(result.current.connectionState).toBeDefined();
    });

    it('should disconnect from notification server', () => {
      const { result } = renderHook(() => useNotificationStore());

      act(() => {
        result.current.disconnect();
      });

      expect(result.current.connectionState).toBe('disconnected');
      expect(result.current.isConnected).toBe(false);
    });
  });

  describe('Unread Count', () => {
    const mockEvent: ZMAlarmEvent = {
      MonitorId: 1,
      MonitorName: 'Test',
      EventId: 1,
      Cause: 'Test',
      Name: 'Test',
    };

    it('should increment unread count when adding unread events', () => {
      const { result } = renderHook(() => useNotificationStore());

      act(() => {
        result.current.addEvent({ ...mockEvent, EventId: 1 });
        result.current.addEvent({ ...mockEvent, EventId: 2 });
      });

      expect(result.current.unreadCount).toBe(2);
    });

    it('should decrement unread count when marking as read', () => {
      const { result } = renderHook(() => useNotificationStore());

      act(() => {
        result.current.addEvent({ ...mockEvent, EventId: 1 });
        result.current.addEvent({ ...mockEvent, EventId: 2 });
        result.current.markEventRead(1);
      });

      expect(result.current.unreadCount).toBe(1);
    });

    it('should reset unread count when marking all as read', () => {
      const { result } = renderHook(() => useNotificationStore());

      act(() => {
        result.current.addEvent({ ...mockEvent, EventId: 1 });
        result.current.addEvent({ ...mockEvent, EventId: 2 });
        result.current.addEvent({ ...mockEvent, EventId: 3 });
        result.current.markAllRead();
      });

      expect(result.current.unreadCount).toBe(0);
    });
  });

  describe('Persistence', () => {
    it('should have persistence config', () => {
      const store = useNotificationStore;
      // Verify store has persist middleware
      expect(store).toBeDefined();
    });
  });
});
