import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

// Types
export type STTLanguage = 'vi-VN' | 'en-US';
export type STTStatus = 'idle' | 'recording' | 'stopping' | 'error';

export interface UseSpeechToTextOptions {
  language?: STTLanguage;
  interim?: boolean; // show partials
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
}

export function useSpeechToText(opts: UseSpeechToTextOptions = {}){
  const { language = 'vi-VN', interim = true, onPartial, onFinal } = opts;
  const [status, setStatus] = useState<STTStatus>('idle');
  const [partial, setPartial] = useState('');
  const [finalText, setFinalText] = useState('');
  const recRef = useRef<any>(null);
  const VoiceRef = useRef<any>(null);

  // Web implementation using Web Speech API
  const canUseWeb = Platform.OS === 'web' && typeof window !== 'undefined' && (('webkitSpeechRecognition' in window) || (window as any).SpeechRecognition);

  const startWeb = useCallback(() => {
    if(!canUseWeb) return false;
    try{
      const SpeechRecognition: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const rec = new SpeechRecognition();
      rec.lang = language;
      rec.continuous = false; // stop after final
      rec.interimResults = interim;
      rec.onstart = () => setStatus('recording');
      rec.onerror = (e: any) => { setStatus('error'); console.warn('STT web error', e?.error || e); };
      rec.onend = () => { setStatus('idle'); recRef.current = null; };
      rec.onresult = (e: any) => {
        let interimTranscript = '';
        let finalTranscript = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const transcript = e.results[i][0].transcript;
          if (e.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }
        if(interim) { setPartial(interimTranscript); onPartial?.(interimTranscript); }
        if(finalTranscript){ setFinalText(finalTranscript); onFinal?.(finalTranscript); }
      };
      recRef.current = rec;
      rec.start();
      return true;
    }catch(e){ setStatus('error'); console.warn('STT web exception', e); return false; }
  }, [canUseWeb, language, interim, onPartial, onFinal]);

  // Native implementation using @react-native-voice/voice
  useEffect(() => {
    if(Platform.OS === 'web') return;
    (async()=>{
      try{
        const Voice = require('react-native-voice');
        VoiceRef.current = Voice;
        Voice.onSpeechStart = () => setStatus('recording');
        Voice.onSpeechEnd = () => { setStatus('idle'); };
        Voice.onSpeechError = (e: any) => { setStatus('error'); console.warn('STT native error', e?.error || e); };
        Voice.onSpeechResults = (e: any) => {
          const values: string[] = e.value || [];
          const text = values[0] || '';
          if(text){ setFinalText(text); onFinal?.(text); }
        };
        Voice.onSpeechPartialResults = (e: any) => {
          const values: string[] = e.value || [];
          const text = values[0] || '';
          if(interim) { setPartial(text); onPartial?.(text); }
        };
      }catch(e){ /* not installed on web or missing native impl */ }
    })();
    return () => {
      try{
        const Voice = VoiceRef.current;
        if(Voice){
          Voice.destroy().catch(()=>{});
          Voice.removeAllListeners?.();
        }
      }catch{}
    };
  }, []);

  const start = useCallback(async ()=>{
    setPartial(''); setFinalText('');
    if(Platform.OS === 'web'){
      return startWeb();
    }
    try{
      const Voice = VoiceRef.current || require('react-native-voice');
      await Voice.start(language);
      setStatus('recording');
      return true;
    }catch(e){ setStatus('error'); console.warn('STT start error', e); return false; }
  }, [language, startWeb]);

  const stop = useCallback(async ()=>{
    if(Platform.OS === 'web'){
      const rec = recRef.current; if(rec){ setStatus('stopping'); try{ rec.stop(); }catch{} }
      return;
    }
    try{
      const Voice = VoiceRef.current || require('react-native-voice');
      setStatus('stopping');
      await Voice.stop();
      setStatus('idle');
    }catch(e){ setStatus('error'); console.warn('STT stop error', e); }
  }, []);

  const abort = useCallback(async ()=>{
    if(Platform.OS === 'web'){
      const rec = recRef.current; if(rec){ try{ rec.abort(); }catch{} }
      setStatus('idle'); setPartial('');
      return;
    }
    try{
      const Voice = VoiceRef.current || require('react-native-voice');
      await Voice.cancel();
      setStatus('idle'); setPartial('');
    }catch(e){ setStatus('error'); console.warn('STT abort error', e); }
  }, []);

  const isRecording = status === 'recording';

  return { status, isRecording, partial, finalText, start, stop, abort };
}

export default useSpeechToText;
