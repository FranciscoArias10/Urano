import React from 'react';
import { create } from 'zustand';

export interface NoticeItem {
  id: string;
  message: string;
  type?: 'info' | 'warning' | 'error' | 'success';
  duration?: number;
}

interface NoticeStore {
  notices: NoticeItem[];
  showNotice: (message: string, duration?: number, type?: NoticeItem['type']) => string;
  upsertNotice: (id: string, message: string, duration?: number, type?: NoticeItem['type']) => void;
  removeNotice: (id: string) => void;
}

const noticeTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useNoticeStore = create<NoticeStore>((set) => ({
  notices: [],
  showNotice: (message: string, duration = 3500, type = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    set((state) => ({
      notices: [...state.notices, { id, message, duration, type }],
    }));

    if (duration > 0) {
      const timer = setTimeout(() => {
        noticeTimers.delete(id);
        set((state) => ({
          notices: state.notices.filter((n) => n.id !== id),
        }));
      }, duration);
      noticeTimers.set(id, timer);
    }
    return id;
  },
  upsertNotice: (id: string, message: string, duration = 3500, type = 'info') => {
    const prevTimer = noticeTimers.get(id);
    if (prevTimer) {
      clearTimeout(prevTimer);
      noticeTimers.delete(id);
    }

    set((state) => {
      const exists = state.notices.some((n) => n.id === id);
      if (exists) {
        return {
          notices: state.notices.map((n) =>
            n.id === id ? { ...n, message, duration, type } : n
          ),
        };
      }
      return {
        notices: [...state.notices, { id, message, duration, type }],
      };
    });

    if (duration > 0) {
      const timer = setTimeout(() => {
        noticeTimers.delete(id);
        set((state) => ({
          notices: state.notices.filter((n) => n.id !== id),
        }));
      }, duration);
      noticeTimers.set(id, timer);
    }
  },
  removeNotice: (id: string) => {
    const prevTimer = noticeTimers.get(id);
    if (prevTimer) {
      clearTimeout(prevTimer);
      noticeTimers.delete(id);
    }
    set((state) => ({
      notices: state.notices.filter((n) => n.id !== id),
    }));
  },
}));

export const NoticeContainer: React.FC = () => {
  const { notices, removeNotice } = useNoticeStore();

  if (notices.length === 0) return null;

  return (
    <div className="notice-container">
      {notices.map((n) => (
        <div
          key={n.id}
          onClick={() => removeNotice(n.id)}
          className={`notice ${n.type === 'error' ? 'notice-error' : n.type === 'warning' ? 'notice-warning' : ''}`}
        >
          <span>{n.message}</span>
        </div>
      ))}
    </div>
  );
};
