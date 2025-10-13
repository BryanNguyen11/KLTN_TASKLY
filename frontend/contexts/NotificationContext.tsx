import React, { createContext, useContext, useMemo, useState } from 'react';

export type NotificationType = 'upcoming-task'|'upcoming-event'|'project-invite'|'project-update'|'task-assigned'|'task-updated'|'task-created';

export type NotificationItem = {
  id: string;
  type: NotificationType;
  title: string;
  meta?: string;
  at: number; // timestamp ms
  projectId?: string;
  read?: boolean;
};

type Ctx = {
  notifications: NotificationItem[];
  unreadCount: number;
  addNotification: (n: NotificationItem) => void;
  addMany: (list: NotificationItem[]) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
  removeById: (id: string) => void;
};

const NotificationContext = createContext<Ctx | undefined>(undefined);

export const NotificationProvider = ({ children }: { children: React.ReactNode }) => {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const addNotification = (n: NotificationItem) => {
    setNotifications(prev => [{ ...n, read: false }, ...prev].slice(0, 100));
  };
  const addMany = (list: NotificationItem[]) => {
    const stamped = list.map(n => ({ ...n, read: false }));
    setNotifications(prev => [...stamped, ...prev].slice(0, 100));
  };
  const markRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };
  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };
  const clearAll = () => setNotifications([]);
  const removeById = (id: string) => setNotifications(prev => prev.filter(n => n.id !== id));

  const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);

  const value = useMemo(() => ({ notifications, unreadCount, addNotification, addMany, markRead, markAllRead, clearAll, removeById }), [notifications, unreadCount]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const ctx = useContext(NotificationContext);
  if(!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
};
