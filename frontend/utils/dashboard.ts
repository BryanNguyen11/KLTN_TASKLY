export type TaskPriority = 'high' | 'medium' | 'low';
export type TaskType = 'personal' | 'group';
export type TaskStatus = 'todo' | 'in-progress' | 'completed';

export interface Task {
  id: string;
  title: string;
  time: string; // HH:mm
  date: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD optional
  startTime?: string; // HH:mm optional
  endTime?: string; // HH:mm optional
  priority: TaskPriority;
  importance?: TaskPriority; // new field
  urgency?: TaskPriority; // new field
  completed: boolean;
  type: TaskType;
  status: TaskStatus;
  completedAt?: string; // ISO timestamp when completed
  subTasks?: { title: string; completed: boolean }[]; // added
  completionPercent?: number; // added
  repeat?: {
    frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
    endMode?: 'never' | 'onDate' | 'after';
    endDate?: string;
    count?: number;
  };
}

export const mockTasks: Task[] = [
  { id: '1', title: 'Hoàn thành bài tập Toán', time: '09:00', date: todayISO(), priority: 'high', importance:'high', completed: false, type: 'personal', status: 'todo' },
  { id: '2', title: 'Ôn thi Tiếng Anh', time: '14:00', date: todayISO(), priority: 'medium', importance:'medium', completed: true, type: 'personal', status: 'completed' },
  { id: '3', title: 'Chuẩn bị thuyết trình nhóm', time: '16:30', date: todayISO(), priority: 'high', importance:'medium', completed: false, type: 'group', status: 'in-progress' },
  { id: '4', title: 'Kiểm tra tiến độ dự án', time: '18:00', date: todayISO(), priority: 'medium', importance:'low', completed: false, type: 'group', status: 'todo' },
];

export interface ProjectMock { id: number; name: string; members: number; progress: number; role: 'leader' | 'member'; }
export const mockProjects: ProjectMock[] = [
  { id: 1, name: 'Dự án Khoa học', members: 5, progress: 75, role: 'leader' },
  { id: 2, name: 'Bài tập nhóm Lịch sử', members: 3, progress: 40, role: 'member' },
];

export const calculateProgress = (completed: number, total: number) => total === 0 ? 0 : Math.round((completed / total) * 100);

export const getPriorityLabel = (p: TaskPriority) => ({ high: 'Cao', medium: 'Trung bình', low: 'Thấp' }[p]);

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

export function todayISO() {
  return new Date().toISOString().split('T')[0];
}

export function formatDate(date: string) {
  return date; // simple placeholder; can localize later
}
