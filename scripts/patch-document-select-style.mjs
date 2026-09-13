import fs from 'node:fs';
const file='/home/ubuntu/bayan-al-ulum/app/(tabs)/index.tsx';
let s=fs.readFileSync(file,'utf8');
s=s.replace('localList: { borderWidth:', 'localItemRow: { borderRadius: 10, paddingVertical: 4, paddingHorizontal: 6 }, localList: { borderWidth:');
fs.writeFileSync(file,s);
