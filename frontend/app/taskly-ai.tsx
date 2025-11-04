import React, { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

export default function TasklyAIRedirect(){
  const router = useRouter();
  useEffect(()=>{ router.replace('/auto-schedule'); },[]);
  return <View />;
}
