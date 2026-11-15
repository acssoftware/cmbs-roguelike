// Detecta chamadas dentro de LACOS num serializador: padrao "array de N objetos"
import { instrucoes } from './esquema.mjs';

export function chamadasEmLaco(va, max = 6000) {
  const ins = instrucoes(va, max);
  const idx = new Map(ins.map((i, k) => [i.addr, k]));
  const laços = [];
  // salto para tras = fim de laco
  ins.forEach((i, k) => {
    if (!/^j/.test(i.m)) return;
    const m = i.o.match(/^0x([0-9a-f]+)$/);
    if (!m) return;
    const alvo = parseInt(m[1], 16);
    if (alvo < i.addr && idx.has(alvo)) laços.push({ ini: idx.get(alvo), fim: k, iniVa: alvo, fimVa: i.addr });
  });
  const out = [];
  for (const L of laços) {
    const dentro = [];
    for (let k = L.ini; k <= L.fim; k++) {
      const i = ins[k];
      if (i.m !== 'call') continue;
      const t = i.o.match(/^0x([0-9a-f]+)$/);
      if (t) dentro.push(parseInt(t[1], 16));
    }
    if (dentro.length) out.push({ ...L, tamanho: L.fim - L.ini, chamadas: [...new Set(dentro)] });
  }
  return out;
}

const EH_MAIN = process.argv[1] && /[\\/]lacos\.mjs$/.test(process.argv[1]);
if (EH_MAIN && process.argv[2]) {
  for (const a of process.argv.slice(2)) {
    const va = parseInt(a, 16);
    const l = chamadasEmLaco(va);
    console.log(`\n=== 0x${va.toString(16)}: ${l.length} lacos com chamadas ===`);
    l.sort((x, y) => y.tamanho - x.tamanho).slice(0, 10).forEach((x) =>
      console.log(`  laco 0x${x.iniVa.toString(16)}..0x${x.fimVa.toString(16)} (${x.tamanho} instr) -> ${x.chamadas.map((c) => '0x' + c.toString(16)).join(' ')}`));
  }
}
