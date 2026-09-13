import fs from 'node:fs';
const file='/home/ubuntu/bayan-al-ulum/app/(tabs)/index.tsx';
let s=fs.readFileSync(file,'utf8');
s=s.replace('smallButtonText: { color:', 'languageInput: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, textAlign: "right", fontSize: 12 }, smallButtonText: { color:');
fs.writeFileSync(file,s);
