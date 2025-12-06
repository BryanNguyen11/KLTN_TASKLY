import React, { useEffect, useState } from 'react';
import { Animated, Text, View } from 'react-native';
import { useNotifications } from '@/contexts/NotificationContext';

export default function Toast(){
  const { notifications } = useNotifications();
  const [visible, setVisible] = useState(false);
  const [msg, setMsg] = useState('');
  const [fade] = useState(new Animated.Value(0));

  useEffect(()=>{
    if(notifications.length){
      const top = notifications[0];
      setMsg(top.title || 'Thông báo');
      setVisible(true);
      fade.setValue(0);
      Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }).start(()=>{
        setTimeout(()=>{
          Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }).start(()=> setVisible(false));
        }, 1800);
      });
    }
  }, [notifications]);

  if(!visible) return null;
  return (
    <Animated.View style={{ position:'absolute', bottom: 24, left: 16, right: 16, opacity: fade }} pointerEvents='none'>
      <View style={{ backgroundColor:'#0f172a', paddingHorizontal:16, paddingVertical:12, borderRadius:12, shadowColor:'#000', shadowOpacity:0.2, shadowRadius:8, shadowOffset:{ width:0, height:4 } }}>
        <Text style={{ color:'#e2e8f0', fontWeight:'600' }}>{msg}</Text>
      </View>
    </Animated.View>
  );
}
