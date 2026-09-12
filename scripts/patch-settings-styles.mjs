import fs from 'node:fs';
const file='/home/ubuntu/bayan-al-ulum/app/(tabs)/index.tsx';
let s=fs.readFileSync(file,'utf8');
s=s.replace('content: { paddingBottom: 40, gap: 16 }, header:', 'content: { paddingBottom: 40, gap: 16 }, actionRow: { flexDirection: "row-reverse", gap: 8 }, smallButton: { flex: 1, borderRadius: 12, paddingVertical: 11, alignItems: "center" }, smallButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" }, settingsCard: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 }, header:');
if (!s.includes('smallButton:')) throw new Error('anchor not found');
fs.writeFileSync(file,s);
