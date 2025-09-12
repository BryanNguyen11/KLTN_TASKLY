export type TaskPriority = 'high' | 'medium' | 'low';
export type TaskType = 'personal' | 'group';

export interface Task {
  id: string;
  title: string;
  time: string; // HH:mm
  date: string; // YYYY-MM-DD
  priority: TaskPriority;
  completed: boolean;
  type: TaskType;
}

export const mockTasks: Task[] = [
  { id: '1', title: 'Hoàn thành bài tập Toán', time: '09:00', date: new Date().toISOString().split('T')[0], priority: 'high', completed: false, type: 'personal' },
  { id: '2', title: 'Ôn thi Tiếng Anh', time: '14:00', date: new Date().toISOString().split('T')[0], priority: 'medium', completed: true, type: 'personal' },
  { id: '3', title: 'Chuẩn bị thuyết trình nhóm', time: '16:30', date: new Date().toISOString().split('T')[0], priority: 'high', completed: false, type: 'group' },
  { id: '4', title: 'Kiểm tra tiến độ dự án', time: '18:00', date: new Date().toISOString().split('T')[0], priority: 'medium', completed: false, type: 'group' },
];

export const calculateProgress = (completed: number, total: number) => total === 0 ? 0 : Math.round((completed / total) * 100);

export const getDaysOfWeek = () => ['T2','T3','T4','T5','T6','T7','CN'];

export const getCurrentWeek = () => {
  const today = new Date();
  const day = today.getDay(); // 0 Sun - 6 Sat
  const monday = new Date(today);
  const diff = (day === 0 ? -6 : 1) - day; // move to Monday
  monday.setDate(today.getDate() + diff);
  return Array.from({ length: 7 }).map((_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i).getDate());
};

export function priorityColor(p: TaskPriority) {
  switch (p) {
    case 'high': return '#ef4444';
    case 'medium': return '#f59e0b';
    case 'low': return '#10b981';
    default: return '#6b7280';
  }
}
