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

export type OcrScanPayload = {
  raw: string;
  extracted?: OcrExtracted;
  structured?: ProgressTable | TasksList;
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
