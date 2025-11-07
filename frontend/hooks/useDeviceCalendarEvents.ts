import { useCallback, useEffect, useRef, useState } from 'react';
// Lazy require to avoid compile-time errors before installing expo-calendar
let Calendar: any;
try { Calendar = require('expo-calendar'); } catch { Calendar = null; }
import { Platform } from 'react-native';

export interface DeviceCalendarEvent {
  id: string;
  title: string;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  location?: string;
  notes?: string;
  calendarTitle?: string;
  recurrenceRule?: any;
}

export interface UseDeviceCalendarEventsOptions {
  lookAheadDays?: number; // default 30
  includeAllDay?: boolean; // default true
}

export function useDeviceCalendarEvents(opts: UseDeviceCalendarEventsOptions = {}){
  const { lookAheadDays: initialLookAhead = 30, includeAllDay = true } = opts;
  const [events, setEvents] = useState<DeviceCalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<'undetermined'|'granted'|'denied'>('undetermined');
  const requestedRef = useRef(false);
  const [lookAheadDays, setLookAheadDays] = useState<number>(initialLookAhead);

  const requestPermission = useCallback(async () => {
    try {
      setError(null);
      if(!Calendar){ setError('Thiếu gói expo-calendar'); setPermission('denied'); return; }
      let calPerm = await Calendar.getCalendarPermissionsAsync();
      if(calPerm.status !== 'granted'){
        calPerm = await Calendar.requestCalendarPermissionsAsync();
      }
      if(calPerm.status === 'granted'){
        setPermission('granted');
      } else {
        setPermission('denied');
      }
    } catch(e:any){
      setError(e?.message || 'Không thể xin quyền lịch');
      setPermission('denied');
    }
  }, []);

  const refresh = useCallback(async () => {
    if(permission !== 'granted') return;
    if(!Calendar){ setError('Thiếu gói expo-calendar'); return; }
    setLoading(true);
    setError(null);
    try {
      const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const primaryLike = cals.filter((c:any) => c.isPrimary || /google|icloud|default/i.test(String(c.source?.name||'') + ' ' + String(c.title||'')) || c.source?.type === 'local');
      const from = new Date();
      const to = new Date();
      to.setDate(to.getDate() + lookAheadDays);
      const fetched: DeviceCalendarEvent[] = [];
      for(const cal of primaryLike){
        try{
          const raw = await Calendar.getEventsAsync([cal.id], from, to);
          raw.forEach((ev:any) => {
            const start = new Date(ev.startDate);
            const end = new Date(ev.endDate);
            const allDay = ev.allDay || (start.getHours()===0 && end.getHours()===0 && end.getTime()-start.getTime()>= 23*3600*1000);
            if(!includeAllDay && allDay) return;
            fetched.push({
              id: ev.id,
              title: ev.title || '(Không tiêu đề)',
              startDate: start,
              endDate: end,
              allDay,
              location: ev.location || undefined,
              notes: ev.notes || ev.description || undefined,
              calendarTitle: cal.title || undefined,
              recurrenceRule: ev.recurrenceRule || undefined,
            });
          });
        }catch(_e){ /* skip this calendar */ }
      }
      // Sort by start
      fetched.sort((a,b)=> a.startDate.getTime() - b.startDate.getTime());
      setEvents(fetched);
    } catch(e:any){
      setError(e?.message || 'Không thể lấy sự kiện');
    } finally {
      setLoading(false);
    }
  }, [permission, lookAheadDays, includeAllDay]);

  const refreshRange = useCallback(async (from: Date, to: Date) => {
    if(permission !== 'granted') return;
    if(!Calendar){ setError('Thiếu gói expo-calendar'); return; }
    setLoading(true);
    setError(null);
    try {
      const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const primaryLike = cals.filter((c:any) => c.isPrimary || /google|icloud|default/i.test(String(c.source?.name||'') + ' ' + String(c.title||'')) || c.source?.type === 'local');
      const fetched: DeviceCalendarEvent[] = [];
      for(const cal of primaryLike){
        try{
          const raw = await Calendar.getEventsAsync([cal.id], from, to);
          raw.forEach((ev:any) => {
            const start = new Date(ev.startDate);
            const end = new Date(ev.endDate);
            const allDay = ev.allDay || (start.getHours()===0 && end.getHours()===0 && end.getTime()-start.getTime()>= 23*3600*1000);
            if(!includeAllDay && allDay) return;
            fetched.push({
              id: ev.id,
              title: ev.title || '(Không tiêu đề)',
              startDate: start,
              endDate: end,
              allDay,
              location: ev.location || undefined,
              notes: ev.notes || ev.description || undefined,
              calendarTitle: cal.title || undefined,
              recurrenceRule: ev.recurrenceRule || undefined,
            });
          });
        }catch(_e){ /* skip calendar */ }
      }
      fetched.sort((a,b)=> a.startDate.getTime() - b.startDate.getTime());
      setEvents(fetched);
    } catch(e:any){ setError(e?.message || 'Không thể lấy sự kiện'); }
    finally { setLoading(false); }
  }, [permission, includeAllDay]);

  useEffect(() => {
    if(!requestedRef.current){
      requestedRef.current = true;
      requestPermission();
    }
  }, [requestPermission]);

  return {
    events,
    loading,
    error,
    permission,
    requestPermission,
    refresh,
    mapToFormValues(ev: DeviceCalendarEvent){
      const pad = (n:number)=> String(n).padStart(2,'0');
      const dateIso = `${ev.startDate.getFullYear()}-${pad(ev.startDate.getMonth()+1)}-${pad(ev.startDate.getDate())}`;
      const endIso = `${ev.endDate.getFullYear()}-${pad(ev.endDate.getMonth()+1)}-${pad(ev.endDate.getDate())}`;
      const startTime = ev.allDay? '09:00' : `${pad(ev.startDate.getHours())}:${pad(ev.startDate.getMinutes())}`;
      const endTime = ev.allDay? '23:59' : `${pad(ev.endDate.getHours())}:${pad(ev.endDate.getMinutes())}`;
      // Map recurrence to repeat structure if available
      let repeat: undefined | { frequency:'daily'|'weekly'|'monthly'|'yearly'; endMode?: 'never'|'onDate'|'after'; endDate?: string; count?: number } = undefined;
      try {
        const rr = ev.recurrenceRule;
        if(rr && typeof rr === 'object' && rr.frequency){
          const freq = String(rr.frequency).toLowerCase();
          if(['daily','weekly','monthly','yearly'].includes(freq)){
            repeat = { frequency: freq as any };
            if(rr.endDate){
              const d = new Date(rr.endDate);
              const end = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
              repeat.endMode = 'onDate';
              repeat.endDate = end;
            } else if(rr.occurrence){
              const count = parseInt(String(rr.occurrence),10);
              if(!isNaN(count) && count>0){ repeat.endMode = 'after'; repeat.count = count; }
            } else {
              repeat.endMode = 'never';
            }
          }
        }
      } catch {}
      return {
        title: ev.title,
        date: dateIso,
        endDate: endIso !== dateIso ? endIso : undefined,
        startTime,
        endTime: startTime !== endTime ? endTime : undefined,
        location: ev.location,
        notes: ev.notes,
        repeat,
      };
    },
    setLookAheadDays,
    refreshRange,
  };
}

// Usage notes:
// 1. Install expo-calendar: expo install expo-calendar
// 2. iOS: add NSCalendarsUsageDescription to app.json -> ios.infoPlist
// 3. Android: permission auto handled; ensure READ_CALENDAR/WRITE_CALENDAR if bare workflow.