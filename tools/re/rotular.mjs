// Cruza as vtables RTTI com o inventario de serializadores para rotular cada um
import fs from 'fs';
import { resolver, slots } from './rtti.mjs';

const EXE = process.env.CM_EXE
  || 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Shock Force 2/CM Shock Force 2.exe';
const b = fs.readFileSync(EXE);

const serial = JSON.parse(fs.readFileSync('../../research/serializadores.json', 'utf8'));
const mapaSerial = new Map(serial.map((s) => [parseInt(s.va, 16), s]));

// todas as classes com RTTI
const nomes = new Set();
const re = /\.\?AV([A-Za-z0-9_]+)@@/g;
const txt = b.toString('latin1');
let m; while ((m = re.exec(txt)) !== null) nomes.add(m[1]);
console.error(`${nomes.size} classes RTTI, ${serial.length} serializadores`);

const achados = [];
for (const nome of nomes) {
  let vts; try { vts = resolver(nome); } catch (_) { continue; }
  for (const v of vts) {
    const s = slots(v.offVtable, 24);
    for (const sl of s) {
      const ser = mapaSerial.get(sl.va);
      if (ser) achados.push({ classe: nome, vtable: v.vaVtable, slot: sl.slot, serializador: sl.va, campos: ser.nCampos, bytes: ser.bytes });
    }
  }
}
achados.sort((a, b) => b.campos - a.campos);
console.log(`\nserializadores rotulados: ${achados.length}\n`);
console.log("classe                        slot  serializador  campos  bytes");
console.log("-".repeat(68));
const vistos = new Set();
achados.forEach((a) => {
  const k = a.classe + a.serializador;
  if (vistos.has(k)) return; vistos.add(k);
  console.log(`${a.classe.slice(0, 28).padEnd(29)} ${String(a.slot).padStart(4)}  0x${a.serializador.toString(16).padEnd(10)} ${String(a.campos).padStart(6)} ${String(a.bytes).padStart(6)}`);
});
fs.writeFileSync('../../research/serializadores_rotulados.json', JSON.stringify(achados, null, 1));
