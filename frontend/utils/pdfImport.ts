import axios from 'axios';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

export type ParsedItem = {
  title: string;
  date: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  notes?: string;
  repeat?: any;
};

export type ScanResult = {
  raw: string;
  items: ParsedItem[];
  strategy?: string;
};

/**
 * Pick a PDF or image and upload to backend to parse into schedule items.
 * Strategy: FormData first (best compat), fall back to JSON base64.
 */
export async function pickAndScanFile(apiBase: string, authHeader: () => { headers: any }): Promise<ScanResult> {
  const pick = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'image/*'],
    multiple: false,
    copyToCacheDirectory: true,
  });
  const anyPick: any = pick as any;
  if (anyPick.canceled) return { raw: '', items: [] };
  const asset: any = Array.isArray(anyPick.assets) ? anyPick.assets[0] : anyPick;
  const uri: string | undefined = asset?.uri as string | undefined;
  if (!uri) return { raw: '', items: [] };

  // Try FormData first
  const name: string = (asset?.name as string) || (uri.split('/').pop() || 'upload.pdf');
  const isPdf = String(asset?.mimeType||'').includes('pdf') || name.toLowerCase().endsWith('.pdf');
  const mime = isPdf ? 'application/pdf' : 'image/*';
  const formData = new FormData();
  // @ts-ignore RN file
  formData.append('file', { uri, name, type: mime });
  try {
    const res = await axios.post(`${apiBase}/api/events/scan-file`, formData, authHeader());
    const raw = res.data?.raw || '';
    const structured = res.data?.structured;
    const strategy = res.data?.meta?.strategy || (structured?.kind || undefined);
    const items: ParsedItem[] = (structured?.kind === 'events-form' && Array.isArray(structured?.items)) ? structured.items : [];
    return { raw, items, strategy };
  } catch(_e) {
    // Fallback: JSON base64
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as any });
    const prefix = isPdf ? 'data:application/pdf;base64,' : 'data:image/*;base64,';
    try {
      const res = await axios.post(`${apiBase}/api/events/scan-file`, { fileBase64: `${prefix}${base64}`, mimeType: mime, name }, authHeader());
      const raw = res.data?.raw || '';
      const structured = res.data?.structured;
      const strategy = res.data?.meta?.strategy || (structured?.kind || undefined);
      const items: ParsedItem[] = (structured?.kind === 'events-form' && Array.isArray(structured?.items)) ? structured.items : [];
      return { raw, items, strategy };
    } catch(_e2) {
      const res = await axios.post(`${apiBase}/api/events/scan-file`, { fileBase64: base64, mimeType: mime, name }, authHeader());
      const raw = res.data?.raw || '';
      const structured = res.data?.structured;
      const strategy = res.data?.meta?.strategy || (structured?.kind || undefined);
      const items: ParsedItem[] = (structured?.kind === 'events-form' && Array.isArray(structured?.items)) ? structured.items : [];
      return { raw, items, strategy };
    }
  }
}

export async function createItems(apiBase: string, items: ParsedItem[], typeId: string, projectId: string | undefined, authHeader: () => { headers: any }) {
  const payloads = items.map(it => ({
    title: String(it.title||'').trim() || 'Lịch',
    typeId,
    date: it.date,
    endDate: it.endDate || undefined,
    startTime: it.startTime || undefined,
    endTime: it.endTime || undefined,
    location: it.location || undefined,
    notes: it.notes || undefined,
    ...(it.repeat ? { repeat: it.repeat } : {}),
    ...(projectId ? { projectId } : {}),
    reminders: [],
  }));
  await Promise.all(payloads.map(p => axios.post(`${apiBase}/api/events`, p, authHeader())));
  return payloads.length;
}
