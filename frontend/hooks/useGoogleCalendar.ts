import * as React from 'react';
import * as WebBrowser from 'expo-web-browser';
// Lazy require to avoid compile-time errors until expo-auth-session is installed
let AuthSession: any;
try { AuthSession = require('expo-auth-session'); } catch { AuthSession = null; }

// Ensure redirect handling for Expo Go and standalone
WebBrowser.maybeCompleteAuthSession();

// Types for Google Calendar items
export type GoogleCalendar = {
  id: string;
  summary: string;
  primary?: boolean;
};

export type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  recurringEventId?: string;
  recurrence?: string[];
};

export type UseGoogleCalendarOptions = {
  clientIdIos?: string;
  clientIdAndroid?: string;
  clientIdWeb?: string;
  scopes?: string[];
};

const DEFAULT_SCOPES = [
  'openid',
  'profile',
  'email',
  'https://www.googleapis.com/auth/calendar.readonly',
];

export function useGoogleCalendar(opts: UseGoogleCalendarOptions = {}){
  const scopes = React.useMemo(()=> opts.scopes || DEFAULT_SCOPES, [opts.scopes]);

  const redirectUri = AuthSession?.makeRedirectUri
    ? AuthSession.makeRedirectUri({ useProxy: true })
    : 'https://auth.expo.dev';

  const [accessToken, setAccessToken] = React.useState<string | null>(null);
  const [idToken, setIdToken] = React.useState<string | null>(null);
  const [user, setUser] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const discovery = AuthSession?.useAutoDiscovery
    ? AuthSession.useAutoDiscovery('https://accounts.google.com')
    : null;

  const authHook = AuthSession?.useAuthRequest
    ? AuthSession.useAuthRequest(
        {
          clientId: opts.clientIdWeb || opts.clientIdIos || opts.clientIdAndroid || '',
          redirectUri,
          scopes,
          responseType: AuthSession.ResponseType.Token,
          extraParams: {},
        },
        discovery
      )
    : [null, null, async ()=>{ throw new Error('Thiếu expo-auth-session. Cài đặt: npx expo install expo-auth-session'); }];

  const [request, response, promptAsync] = authHook as any;

  React.useEffect(()=>{
    if(response?.type === 'success'){
      const params = response.params as any;
      const token = params.access_token as string | undefined;
      const idt = params.id_token as string | undefined;
      if(token) setAccessToken(token);
      if(idt) setIdToken(idt);
    } else if(response?.type === 'error'){
      setError('Google đăng nhập thất bại');
    }
  },[response]);

  const signIn = React.useCallback(async ()=>{
    setError(null);
    try{
      await promptAsync({ useProxy: true, showInRecents: true });
    }catch(e:any){ setError(e?.message || 'Không thể đăng nhập Google'); }
  }, [promptAsync]);

  const signOut = React.useCallback(()=>{
    setAccessToken(null); setIdToken(null); setUser(null);
  },[]);

  const getUserInfo = React.useCallback(async ()=>{
    if(!accessToken) return null;
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${accessToken}` }});
    if(!res.ok) return null; return res.json();
  }, [accessToken]);

  const listCalendars = React.useCallback(async (): Promise<GoogleCalendar[]> => {
    if(!accessToken) return [];
    const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', { headers: { Authorization: `Bearer ${accessToken}` }});
    if(!res.ok) throw new Error('Không lấy được danh sách Calendar');
    const data = await res.json();
    return (data.items || []).map((c: any)=> ({ id: c.id, summary: c.summary, primary: !!c.primary }));
  }, [accessToken]);

  const listEvents = React.useCallback(async (calendarId: string, timeMin?: string, timeMax?: string): Promise<GoogleEvent[]> => {
    if(!accessToken) return [];
    const params = new URLSearchParams();
    params.set('singleEvents','true');
    params.set('maxResults','2500');
    if(timeMin) params.set('timeMin', timeMin);
    if(timeMax) params.set('timeMax', timeMax);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }});
    if(!res.ok) throw new Error('Không lấy được sự kiện');
    const data = await res.json();
    return (data.items || []) as GoogleEvent[];
  }, [accessToken]);

  return {
    request,
    response,
    signIn,
    signOut,
    accessToken,
    idToken,
    user,
    loading,
    error,
    getUserInfo,
    listCalendars,
    listEvents,
  };
}
