// Encontra referencias cruzadas a um VA: calls relativos (E8), jmps (E9) e imediatos absolutos
import fs from 'fs';
import { va2off, off2va } from './disasm.mjs';

const EXE = process.env.CM_EXE
  || 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Shock Force 2/CM Shock Force 2.exe';
const buf = fs.readFileSync(EXE);

// secao .text (do PE lido em disasm.mjs, replicado aqui de forma simples)
const peOff = buf.readUInt32LE(0x3c);
const nSec = buf.readUInt16LE(peOff + 6);
const optSize = buf.readUInt16LE(peOff + 20);
const secOff = peOff + 24 + optSize;
const secs = [];
for (let i = 0; i < nSec; i++) {
  const o = secOff + i * 40;
  secs.push({
    nome: buf.toString('latin1', o, o + 8).replace(/\0/g, ''),
    rsize: buf.readUInt32LE(o + 16), roff: buf.readUInt32LE(o + 20),
    exec: !!(buf.readUInt32LE(o + 36) & 0x20000000),
  });
}

export function xrefs(vaAlvo) {
  const chamadas = [], saltos = [], imediatos = [];
  for (const s of secs.filter((x) => x.exec)) {
    for (let o = s.roff; o < s.roff + s.rsize - 5; o++) {
      const op = buf[o];
      if (op === 0xe8 || op === 0xe9) {
        const rel = buf.readInt32LE(o + 1);
        const vaProx = off2va(o + 5);
        if (vaProx !== null && vaProx + rel === vaAlvo)
          (op === 0xe8 ? chamadas : saltos).push(off2va(o));
      }
    }
  }
  // imediatos absolutos (push VA / mov reg,VA) em qualquer secao
  const p = Buffer.alloc(4); p.writeUInt32LE(vaAlvo >>> 0);
  let i = 0;
  while ((i = buf.indexOf(p, i)) !== -1) {
    const va = off2va(i);
    const sec = secs.find((x) => i >= x.roff && i < x.roff + x.rsize);
    if (va !== null) imediatos.push({ va, sec: sec ? sec.nome : '?' });
    i++;
  }
  return { chamadas, saltos, imediatos };
}

if (process.argv[2]) {
  for (const arg of process.argv.slice(2)) {
    const va = parseInt(arg, 16);
    const r = xrefs(va);
    console.log(`\n===== xrefs para 0x${va.toString(16)} =====`);
    console.log(`  calls    (${r.chamadas.length}): ${r.chamadas.map((x) => '0x' + x.toString(16)).join(' ') || '-'}`);
    console.log(`  jmps     (${r.saltos.length}): ${r.saltos.map((x) => '0x' + x.toString(16)).join(' ') || '-'}`);
    const porSec = {};
    r.imediatos.forEach((x) => { (porSec[x.sec] = porSec[x.sec] || []).push('0x' + x.va.toString(16)); });
    console.log(`  imediatos (${r.imediatos.length}):`);
    Object.entries(porSec).forEach(([sec, l]) =>
      console.log(`     ${sec}: ${l.slice(0, 14).join(' ')}${l.length > 14 ? ' ...' : ''}`));
  }
}
