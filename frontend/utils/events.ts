export type EventTypeField = {
  key: string;
  label: string;
  type?: 'text' | 'url';
  required?: boolean;
};

export type EventTypeDoc = {
  _id: string;
  name: string;
  slug: string;
  isDefault?: boolean;
  fields: EventTypeField[];
};

export type EventDoc = {
  _id: string;
  title: string;
  typeId: string | EventTypeDoc;
  date: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
  location?: string;
  notes?: string;
  link?: string;
  props?: Record<string, any>;
  tags?: string[];
};

export const toDisplayDate = (iso: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};
