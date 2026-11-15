// Constroi um indice de inicios de funcao a partir de TODOS os alvos de call (E8 rel32)
// do binario. Robusto: nao depende de heuristica de prologo.
import fs from 'fs';
import { va2off, off2va } from './disasm.mjs';

const EXE = process.env.CM_EXE
  || 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Shock Force 2/CM Shock Force 2.exe';
const buf = fs.readFileSync(EXE);

const peOff = buf.readUInt32LE(0x3c);
const nSec = buf.readUInt16LE(peOff + 6);
const secOff = peOff + 24 + buf.readUInt16LE(peOff + 20);
const secs = [];
for (let i = 0; i < nSec; i++) {
  const o = secOff + i * 40;
  secs.push({
    nome: buf.toString('latin1', o, o + 8).replace(/\0/g, ''),
    rsize: buf.readUInt32LE(o + 16), roff: buf.readUInt32LE(o + 20),
    exec: !!(buf.readUInt32LE(o + 36) & 0x20000000),
  });
}

let cache = null;
export function indice() {
  if (cache) return cache;
  const alvos = new Map();   // VA -> quantas vezes e chamado
  for (const s of secs.filter((x) => x.exec)) {
    for (let o = s.roff; o < s.roff + s.rsize - 5; o++) {
      if (buf[o] !== 0xe8) continue;
      const vaProx = off2va(o + 5);
      if (vaProx === null) continue;
      const alvo = vaProx + buf.readInt32LE(o + 1);
      if (va2off(alvo) === null) continue;
      alvos.set(alvo, (alvos.get(alvo) || 0) + 1);
    }
  }
  cache = [...alvos.entries()].map(([va, n]) => ({ va, chamadas: n })).sort((a, b) => a.va - b.va);
  return cache;
}

// funcao que contem um VA = maior inicio conhecido <= VA
export function contem(va) {
  const idx = indice();
  let lo = 0, hi = idx.length - 1, res = null;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (idx[m].va <= va) { res = idx[m]; lo = m + 1; } else hi = m - 1;
  }
  const prox = idx.find((f) => f.va > va);
  return res ? { ...res, fim: prox ? prox.va : null } : null;
}

if (process.argv[2]) {
  const idx = indice();
  if (process.argv[2] === 'stats') {
    console.log(`funcoes indexadas (alvos de call unicos): ${idx.length}`);
    const top = [...idx].sort((a, b) => b.chamadas - a.chamadas).slice(0, 10);
    console.log('mais chamadas:');
    top.forEach((f) => console.log(`   0x${f.va.toString(16)}  ${f.chamadas}x`));
  } else {
    for (const a of process.argv.slice(2)) {
      const va = parseInt(a, 16);
      const f = contem(va);
      console.log(`0x${va.toString(16)} esta na funcao 0x${f ? f.va.toString(16) : '?'}` +
        (f && f.fim ? ` (proxima em 0x${f.fim.toString(16)}, ~${f.fim - f.va} bytes)` : '') +
        (f ? `  chamada ${f.chamadas}x` : ''));
    }
  }
}
