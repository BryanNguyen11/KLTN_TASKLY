export type OcrExtracted = {
  title?: string;
  date?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  notes?: string;
};

type ProgressTable = { kind: 'progress-table'; items: Array<{ title: string; weekday: number; from: number; to: number; startDate?: string; endDate?: string; location?: string; }> };
type TasksList = { kind: 'tasks-list'; items: Array<{ title: string; date?: string; endDate?: string; startTime?: string; endTime?: string; priority?: string; importance?: string; notes?: string; }>; };
type EventsFormList = { kind: 'events-form'; items: Array<{ title: string; date: string; startTime: string; endDate?: string; endTime?: string; location?: string; notes?: string; link?: string; repeat?: { frequency: 'daily'|'weekly'|'monthly'|'yearly'; endMode?: 'never'|'onDate'|'after'; endDate?: string; count?: number } }>; };

export type OcrScanPayload = {
  raw: string;
  extracted?: OcrExtracted;
  structured?: ProgressTable | TasksList | EventsFormList;
  defaultTypeId?: string;
  projectId?: string;
};

let lastScan: OcrScanPayload | null = null;

export function setOcrScanPayload(p: OcrScanPayload | null) {
  lastScan = p;
}

export function getOcrScanPayload(): OcrScanPayload | null {
  return lastScan;
}
