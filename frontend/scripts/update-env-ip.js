#!/usr/bin/env node
/**
 * Auto-update EXPO_PUBLIC_API_BASE in frontend/.env with current local IPv4.
 * Usage: npm run update:ip  (optionally pass port: npm run update:ip -- 5000)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = process.argv.slice(2).find(a=>/^\d+$/.test(a)) || process.env.API_PORT || '5000';

function pickIPv4(){
  const ifaces = os.networkInterfaces();
  // Prefer Wi-Fi / Ethernet non-internal IPv4
  const preferredNames = ['Wi-Fi','WiFi','Ethernet','en0','wlan0','eth0'];
  let candidates = [];
  for(const [name, addrs] of Object.entries(ifaces)){
    for(const a of addrs||[]){
      if(a.family === 'IPv4' && !a.internal){
        candidates.push({ name, address:a.address });
      }
    }
  }
  const preferred = candidates.find(c => preferredNames.includes(c.name));
  return (preferred || candidates[0] || {}).address;
}

const ip = pickIPv4();
if(!ip){
  console.error('✖ Không tìm thấy IPv4 cục bộ. Vui lòng kiểm tra kết nối mạng.');
  process.exit(1);
}

const envPath = path.join(__dirname,'..','.env');
let lines = [];
if(fs.existsSync(envPath)){
  lines = fs.readFileSync(envPath,'utf8').split(/\r?\n/);
}

const key = 'EXPO_PUBLIC_API_BASE';
const newValue = `${key}=http://${ip}:${PORT}`;
let replaced = false;
lines = lines.filter(l => l.trim()!=='' || true); // keep empties
for(let i=0;i<lines.length;i++){
  if(lines[i].startsWith(key + '=')) { lines[i] = newValue; replaced = true; }
}
if(!replaced){ lines.push(newValue); }

fs.writeFileSync(envPath, lines.join('\n'));
console.log(`✔ Đã cập nhật ${key} = http://${ip}:${PORT}`);
console.log('→ Hãy restart: npx expo start');
