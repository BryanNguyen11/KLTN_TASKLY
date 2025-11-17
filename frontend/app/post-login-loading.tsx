import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
// minimal bright loader, no gradients

export default function PostLoginLoading(){
  const router = useRouter();
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(()=>{
    const t = setTimeout(()=> router.replace('/(tabs)/dashboard'), 900);
    Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1600, easing: Easing.linear, useNativeDriver: true })
    ).start();
    return () => { clearTimeout(t); };
  },[]);
  const rotate = spin.interpolate({ inputRange:[0,1], outputRange:['0deg','360deg'] });
  return (
    <SafeAreaView style={styles.box}>
      <View style={styles.centerWrap}>
        <Animated.View style={[styles.spinner, { transform:[{ rotate }] }]} />
        <Text style={styles.brand}>Taskly</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  box:{ flex:1, backgroundColor:'#ffffff' },
  centerWrap:{ flex:1, alignItems:'center', justifyContent:'center', gap:12 },
  spinner:{ width:36, height:36, borderRadius:18, borderWidth:3, borderColor:'#e5e7eb', borderTopColor:'#3a7ca5' },
  brand:{ color:'#0f172a', fontSize:18, fontWeight:'800', letterSpacing:0.5 },
});
