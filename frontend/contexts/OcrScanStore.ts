export type OcrExtracted = {
  title?: string;
  date?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  notes?: string;
};

export type OcrScanPayload = {
  raw: string;
  extracted?: OcrExtracted;
  structured?: { kind: 'progress-table'; items: Array<{ title: string; weekday: number; from: number; to: number; startDate?: string; endDate?: string; location?: string; }> };
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
