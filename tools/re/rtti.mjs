// Resolve vtables a partir do RTTI do MSVC (PE32 x86)
//   nome ".?AVFoo@@"  ->  TypeDescriptor  ->  CompleteObjectLocator  ->  vtable
import fs from 'fs';
import { va2off, off2va, imprimir } from './disasm.mjs';

const EXE = process.env.CM_EXE
  || 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Shock Force 2/CM Shock Force 2.exe';
const buf = fs.readFileSync(EXE);

function acharTodos(pat, ini = 0) {
  const out = []; let i = ini;
  while ((i = buf.indexOf(pat, i)) !== -1) { out.push(i); i++; }
  return out;
}
const dwordsIguaisA = (va) => {
  const p = Buffer.alloc(4); p.writeUInt32LE(va >>> 0);
  return acharTodos(p);
};

export function resolver(nomeClasse) {
  const alvo = Buffer.from('.?AV' + nomeClasse + '@@', 'latin1');
  const ocorr = acharTodos(alvo);
  const res = [];
  for (const offNome of ocorr) {
    // TypeDescriptor (x86): +0 vftable, +4 spare, +8 nome
    const offTD = offNome - 8;
    const vaTD = off2va(offTD);
    if (vaTD === null) continue;
    // COL: +0 signature, +4 offset, +8 cdOffset, +12 pTypeDescriptor
    for (const offRefTD of dwordsIguaisA(vaTD)) {
      const offCOL = offRefTD - 12;
      if (offCOL < 0) continue;
      if (buf.readUInt32LE(offCOL) !== 0) continue;      // signature 0 em x86
      const vaCOL = off2va(offCOL);
      if (vaCOL === null) continue;
      // vtable: o dword ANTES do inicio da vtable aponta para o COL
      for (const offRefCOL of dwordsIguaisA(vaCOL)) {
        const vaVtable = off2va(offRefCOL + 4);
        if (vaVtable === null) continue;
        res.push({ classe: nomeClasse, vaTD, vaCOL, vaVtable, offVtable: offRefCOL + 4 });
      }
    }
  }
  return res;
}

export function slots(offVtable, n = 8) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const va = buf.readUInt32LE(offVtable + i * 4);
    if (va2off(va) === null) break;                       // fim da vtable
    out.push({ slot: i, va });
  }
  return out;
}

if (process.argv[2]) {
  for (const nome of process.argv.slice(2)) {
    const r = resolver(nome);
    console.log(`\n########## ${nome}: ${r.length} vtable(s) ##########`);
    for (const v of r) {
      console.log(`  TypeDescriptor 0x${v.vaTD.toString(16)}  COL 0x${v.vaCOL.toString(16)}  VTABLE 0x${v.vaVtable.toString(16)}`);
      slots(v.offVtable, 10).forEach((s) =>
        console.log(`     slot ${String(s.slot).padStart(2)}  ->  0x${s.va.toString(16)}`));
    }
  }
}
