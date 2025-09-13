// AI-like task sorting based on Eisenhower matrix (Importance vs Urgency)
// We classify into 4 quadrants and sort within each quadrant.
// Quadrants order: Q1 (Do First) -> Q2 (Schedule) -> Q3 (Delegate) -> Q4 (Eliminate)
// Mapping logic:
// - importance: high > medium > low
// - urgency derived from: closer due date (date or endDate) & high priority boosts urgency
// - priority: high > medium > low (acts as urgency amplifier)
// - If endDate provided, use it; else use date; tasks past due become most urgent.
// - Completed tasks are not included (caller should filter) except for calendar dot summarization.

import { Task } from './dashboard'; // ensure Task interface exported from dashboard utils

export interface SortedTaskResult {
  quadrant: 1 | 2 | 3 | 4;
  score: number; // composite score for tie-breaking
  task: Task;
}

const importanceRank = (imp?: string) => imp === 'high' ? 3 : imp === 'medium' ? 2 : 1; // low default 1
const priorityRank = (p?: string) => p === 'high' ? 3 : p === 'medium' ? 2 : 1;

// Compute urgency number (higher = more urgent)
function computeUrgency(task: Task, todayISO: string): number {
  const baseDate = task.endDate || task.date; // due reference
  if(!baseDate) return 0;
  // Difference in days (negative if overdue)
  const today = new Date(todayISO + 'T00:00:00');
  const due = new Date(baseDate + 'T00:00:00');
  const diffMs = due.getTime() - today.getTime();
  const diffDays = Math.floor(diffMs / 86400000); // days until due
  // Overdue => big boost
  let urgency = 0;
  if(diffDays < 0) urgency += 10; // overdue highest urgency boost
  else {
    // 0 days left -> very urgent
    if(diffDays === 0) urgency += 6;
    else if(diffDays === 1) urgency += 5;
    else if(diffDays <= 3) urgency += 4;
    else if(diffDays <= 7) urgency += 3;
    else if(diffDays <= 14) urgency += 2;
    else urgency += 1; // far away
  }
  urgency += priorityRank(task.priority) * 0.8; // weight priority
  return urgency;
}

// Determine quadrant according to Eisenhower:
// Q1: Important & Urgent
// Q2: Important & Not Urgent
// Q3: Not Important & Urgent
// Q4: Not Important & Not Urgent
function determineQuadrant(importanceScore: number, urgencyScore: number): 1 | 2 | 3 | 4 {
  const important = importanceScore >= 3 - 0.5; // treat medium(2) borderline; require >=2.5? Simpler: >=3 high only considered "important"? We'll broaden: medium+ treated as important.
  const isImportant = importanceScore >= 2; // medium or high
  const isUrgent = urgencyScore >= 5; // threshold for urgency (derived from scale above)
  if(isImportant && isUrgent) return 1;
  if(isImportant && !isUrgent) return 2;
  if(!isImportant && isUrgent) return 3;
  return 4;
}

export function aiSortTasks(tasks: Task[], todayISO?: string): SortedTaskResult[] {
  const today = todayISO || new Date().toISOString().split('T')[0];
  const results: SortedTaskResult[] = tasks.map(t => {
    const imp = importanceRank(t.importance);
    const urg = computeUrgency(t, today);
    const quadrant = determineQuadrant(imp, urg);
    // Composite score: prioritize lower quadrant number, then higher urgency, then higher importance, then earlier due date
    const dueRef = t.endDate || t.date || '9999-12-31';
    const composite = (5 - quadrant) * 1000 + urg * 50 + imp * 30 - dateScore(dueRef);
    return { quadrant, score: composite, task: t };
  });
  // Sort descending by score (higher composite -> earlier in list)
  results.sort((a,b)=> b.score - a.score);
  return results;
}

function dateScore(iso: string): number {
  // Smaller => earlier date should produce larger part of composite after subtraction
  // Convert to YYYYMMDD number
  return parseInt(iso.replace(/-/g,''), 10);
}

// Helper to return pure ordered Task[]
export function aiOrderedTasks(tasks: Task[], todayISO?: string): Task[] {
  return aiSortTasks(tasks, todayISO).map(r => r.task);
}

// Optional grouping by quadrant
export function groupByQuadrant(sorted: SortedTaskResult[]): Record<1|2|3|4, Task[]> {
  return {
    1: sorted.filter(r=>r.quadrant===1).map(r=>r.task),
    2: sorted.filter(r=>r.quadrant===2).map(r=>r.task),
    3: sorted.filter(r=>r.quadrant===3).map(r=>r.task),
    4: sorted.filter(r=>r.quadrant===4).map(r=>r.task),
  };
}
