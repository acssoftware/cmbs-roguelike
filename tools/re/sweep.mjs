// Varre TODAS as classes RTTI do binario e resolve suas vtables
import fs from 'fs';
import { resolver, slots } from './rtti.mjs';
const EXE = process.env.CM_EXE || 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Shock Force 2/CM Shock Force 2.exe';
const b = fs.readFileSync(EXE);
const nomes = new Set();
const re = /\.\?AV([A-Za-z0-9_]+)@@/g;
const txt = b.toString('latin1');
let m; while ((m = re.exec(txt)) !== null) nomes.add(m[1]);
console.error(`classes RTTI encontradas: ${nomes.size}`);
const lo = parseInt(process.argv[2] || '6d0000', 16), hi = parseInt(process.argv[3] || '700000', 16);
const achados = [];
for (const n of nomes) {
  let vts; try { vts = resolver(n); } catch (_) { continue; }
  for (const v of vts) {
    const s = slots(v.offVtable, 16);
    if (!s.length) continue;
    if (s[0].va >= lo && s[0].va < hi) achados.push({ classe: n, v, s });
  }
}
console.log(`\nclasses com vtable no modulo 0x${lo.toString(16)}-0x${hi.toString(16)}: ${achados.length}\n`);
for (const a of achados) {
  console.log(`${a.classe}   vtable 0x${a.v.vaVtable.toString(16)}   (${a.s.length} slots)`);
  const s10 = a.s.find((x) => x.slot === 10);
  console.log(`   slot0=0x${a.s[0].va.toString(16)}  slot10(+0x28)=${s10 ? '0x' + s10.va.toString(16) : '-'}`);
}
