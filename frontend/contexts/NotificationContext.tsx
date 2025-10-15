import React, { createContext, useContext, useMemo, useState } from 'react';

export type NotificationType = 'upcoming-task'|'upcoming-event'|'project-invite'|'project-update'|'task-assigned'|'task-updated'|'task-created';

export type NotificationItem = {
  id: string;
  type: NotificationType;
  title: string;
  meta?: string;
  at: number; // timestamp ms
  projectId?: string;
  taskId?: string;
  read?: boolean;
};

type Ctx = {
  notifications: NotificationItem[];
  unreadCount: number;
  addNotification: (n: NotificationItem) => void;
  addMany: (list: NotificationItem[]) => void;
  upsertById: (n: NotificationItem) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
  removeById: (id: string) => void;
};

const NotificationContext = createContext<Ctx | undefined>(undefined);

export const NotificationProvider = ({ children }: { children: React.ReactNode }) => {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  // Ensure unique IDs to avoid FlatList duplicate key errors
  const makeUniqueId = (baseId: string, existingIds: Set<string>): string => {
    let id = baseId || `n_${Date.now()}`;
    if (!existingIds.has(id)) return id;
    let i = 1;
    while (existingIds.has(`${baseId}_${i}`)) i++;
    return `${baseId}_${i}`;
  };

  const addNotification = (n: NotificationItem) => {
    setNotifications(prev => {
      const ids = new Set(prev.map(p => p.id));
      const id = makeUniqueId(n.id, ids);
      return [{ ...n, id, read: false }, ...prev].slice(0, 100);
    });
  };
  const addMany = (list: NotificationItem[]) => {
    setNotifications(prev => {
      const ids = new Set(prev.map(p => p.id));
      const stamped: NotificationItem[] = [];
      list.forEach((n, idx) => {
        const base = n.id || `n_${Date.now()}_${idx}`;
        if (ids.has(base)) return; // skip duplicates entirely
        ids.add(base);
        stamped.push({ ...n, id: base, read: false });
      });
      if (stamped.length === 0) return prev;
      return [...stamped, ...prev].slice(0, 100);
    });
  };
  // Replace an existing notification with the same id (move to top), or insert if missing
  const upsertById = (n: NotificationItem) => {
    if(!n.id){ addNotification(n); return; }
    setNotifications(prev => {
      const filtered = prev.filter(p => p.id !== n.id);
      return [{ ...n, read: false }, ...filtered].slice(0, 100);
    });
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

  const value = useMemo(() => ({ notifications, unreadCount, addNotification, addMany, upsertById, markRead, markAllRead, clearAll, removeById }), [notifications, unreadCount]);

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
