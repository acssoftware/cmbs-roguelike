// Identifica o CONTADOR de cada laco de um serializador.
//
// Padrao tipico:   mov ebx, N   ...  <corpo>  ... sub ebx,1 ; jne inicio
// O registrador decrementado no fim do laco e o contador. Rastreando para tras a
// partir do inicio do laco, descobre-se a origem: imediato (constante), campo lido
// do arquivo, ou membro do objeto (indeterminavel na leitura).
import { instrucoes } from './esquema.mjs';

export function lacos(va, max = 8000) {
  const ins = instrucoes(va, max);
  const idx = new Map(ins.map((i, k) => [i.addr, k]));
  const out = [];
  ins.forEach((i, k) => {
    if (!/^j/.test(i.m) || i.m === 'jmp') return;
    const m = i.o.match(/^0x([0-9a-f]+)$/);
    if (!m) return;
    const alvo = parseInt(m[1], 16);
    if (alvo >= i.addr || !idx.has(alvo)) return;
    const ini = idx.get(alvo);

    // acha o registrador de controle: decremento, incremento ou comparacao
    let reg = null, estilo = null;
    for (let j = k - 1; j >= Math.max(ini, k - 10) && !reg; j--) {
      const d = ins[j];
      let mm = d.o.match(/^(e[a-z]{2}), 1$/);
      if ((d.m === 'sub' || d.m === 'add') && mm) { reg = mm[1]; estilo = d.m; continue; }
      mm = d.o.match(/^(e[a-z]{2})$/);
      if ((d.m === 'dec' || d.m === 'inc') && mm) { reg = mm[1]; estilo = d.m; continue; }
      // laco por comparacao: cmp reg, X   /   cmp reg, [mem]
      mm = d.o.match(/^(e[a-z]{2}), (.+)$/);
      if (d.m === 'cmp' && mm) { reg = mm[1]; estilo = 'cmp:' + mm[2]; continue; }
    }
    // rastreia a origem do registrador ANTES do laco
    let origem = { tipo: 'desconhecida' };
    if (reg) {
      for (let j = ini - 1; j >= Math.max(0, ini - 40); j--) {
        const d = ins[j];
        if (d.m !== 'mov' && d.m !== 'movzx' && d.m !== 'lea') continue;
        const mm = d.o.match(new RegExp(`^${reg}, (.+)$`));
        if (!mm) continue;
        const src = mm[1];
        if (/^(0x[0-9a-f]+|\d+)$/.test(src)) { origem = { tipo: 'constante', valor: parseInt(src) }; break; }
        const mem = src.match(/^\w* ?ptr \[(e[a-z]{2}) \+ (0x[0-9a-f]+)\]$/);
        if (mem) { origem = { tipo: 'membro', reg: mem[1], offset: parseInt(mem[2], 16) }; break; }
        origem = { tipo: 'outro', src }; break;
      }
    }
    out.push({ iniVa: alvo, fimVa: i.addr, instr: k - ini, reg, origem });
  });
  return out;
}

const EH_MAIN = process.argv[1] && /[\\/]contador\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  if (process.argv[2] === 'censo') {
    const fs = await import('fs');
    const S = JSON.parse(fs.readFileSync('../../research/serializadores.json', 'utf8'));
    const cont = {};
    let total = 0;
    for (const s of S) {
      let L; try { L = lacos(parseInt(s.va, 16)); } catch (_) { continue; }
      for (const l of L) { total++; cont[l.origem.tipo] = (cont[l.origem.tipo] || 0) + 1; }
    }
    console.log(`lacos em ${S.length} serializadores: ${total}\n`);
    Object.entries(cont).sort((a, b) => b[1] - a[1]).forEach(([k, v]) =>
      console.log(`  ${k.padEnd(14)} ${String(v).padStart(4)}  (${(v * 100 / total).toFixed(0)}%)`));
  } else if (process.argv[2]) {
    for (const a of process.argv.slice(2)) {
      const va = parseInt(a, 16);
      console.log(`\n=== 0x${va.toString(16)} ===`);
      lacos(va).forEach((l) => console.log(
        `  laco 0x${l.iniVa.toString(16)}..0x${l.fimVa.toString(16)} (${l.instr} instr) reg=${l.reg || '?'}  origem: ${JSON.stringify(l.origem)}`));
    }
  }
}
