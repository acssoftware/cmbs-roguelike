// Extrai a sequencia ORDENADA de operacoes de um serializador.
//
// Diferente de esquema.mjs (que separa campos e sub-chamadas), aqui a ordem e preservada,
// que e o que importa para interpretar o arquivo: os bytes saem na ordem das operacoes.
//
// Operacoes emitidas:
//   { op:'campo', bytes:N, membro, addr }        -> N bytes lidos/gravados no fluxo
//   { op:'chamada', alvo, addr }                 -> sub-objeto ou classe base
//   { op:'laco_ini', ate, addr } / {op:'laco_fim'} -> fronteiras de laco (salto para tras)
//   { op:'desvio', alvo, cond, addr }            -> salto condicional (ainda nao resolvido)
import { instrucoes } from './esquema.mjs';

export function operacoes(va, max = 8000) {
  const ins = instrucoes(va, max);
  const porAddr = new Map(ins.map((i, k) => [i.addr, k]));

  // fronteiras de laco: saltos para tras dentro da funcao
  const inicioLaco = new Map();   // indice -> [fim...]
  ins.forEach((i, k) => {
    if (!/^j/.test(i.m)) return;
    const m = i.o.match(/^0x([0-9a-f]+)$/);
    if (!m) return;
    const alvo = parseInt(m[1], 16);
    if (alvo < i.addr && porAddr.has(alvo)) {
      const ini = porAddr.get(alvo);
      if (!inicioLaco.has(ini)) inicioLaco.set(ini, []);
      inicioLaco.get(ini).push(k);
    }
  });

  const ops = [];
  let membro = null;
  // pilha dos pushes recentes. A chamada e serialize(ptr, tamanho) em stdcall,
  // entao o TAMANHO e o penultimo push antes do call.
  let pushes = [];
  ins.forEach((i, k) => {
    if (inicioLaco.has(k)) ops.push({ op: 'laco_ini', addr: i.addr, fins: inicioLaco.get(k).map((x) => ins[x].addr) });

    let m = i.o.match(/^\w+, (byte|word|dword|qword) ptr \[(e[a-z]{2}) \+ (0x[0-9a-f]+)\]$/);
    if (m && /^(mov|movzx|movsx|movss|movsd)$/.test(i.m)) {
      const off = parseInt(m[3], 16);
      // offsets gigantes sao enderecos globais, nao membros
      membro = off < 0x10000 ? { reg: m[2], offset: off, largura: m[1] } : null;
      return;
    }
    if (i.m === 'push') {
      m = i.o.match(/^(0x[0-9a-f]+|\d+)$/);
      pushes.push(m ? { imm: parseInt(m[1]) } : { reg: i.o });
      if (pushes.length > 4) pushes.shift();
      return;
    }

    if (i.m === 'call') {
      if (/^dword ptr \[e[a-z]{2}\]$/.test(i.o)) {
        // tamanho = penultimo push; se nao for imediato plausivel, tenta o ultimo
        const p2 = pushes[pushes.length - 2], p1 = pushes[pushes.length - 1];
        let tam = null;
        if (p2 && p2.imm !== undefined && p2.imm >= 1 && p2.imm <= 4096) tam = p2.imm;
        else if (p1 && p1.imm !== undefined && p1.imm >= 1 && p1.imm <= 4096) tam = p1.imm;
        if (tam !== null)
          ops.push({ op: 'campo', bytes: tam, addr: i.addr,
            membro: membro ? `+0x${membro.offset.toString(16)}` : null,
            larguraMembro: membro ? membro.largura : null });
        pushes = []; membro = null;
        return;
      }
      const t = i.o.match(/^0x([0-9a-f]+)$/);
      if (t) ops.push({ op: 'chamada', alvo: parseInt(t[1], 16), addr: i.addr });
      pushes = [];
      return;
    }

    if (/^j/.test(i.m) && i.m !== 'jmp') {
      const t = i.o.match(/^0x([0-9a-f]+)$/);
      if (t) {
        const alvo = parseInt(t[1], 16);
        if (alvo > i.addr) ops.push({ op: 'desvio', alvo, cond: i.m, addr: i.addr });
        else ops.push({ op: 'laco_fim', alvo, cond: i.m, addr: i.addr });
      }
    }
  });
  return ops;
}

// Resumo legivel de uma funcao
export function resumo(va) {
  const ops = operacoes(va);
  const campos = ops.filter((o) => o.op === 'campo');
  return {
    va, ops,
    nCampos: campos.length,
    bytes: campos.reduce((t, c) => t + c.bytes, 0),
    nChamadas: ops.filter((o) => o.op === 'chamada').length,
    nLacos: ops.filter((o) => o.op === 'laco_ini').length,
    nDesvios: ops.filter((o) => o.op === 'desvio').length,
  };
}

const EH_MAIN = process.argv[1] && /[\\/]ops\.mjs$/.test(process.argv[1]);
if (EH_MAIN && process.argv[2]) {
  for (const a of process.argv.slice(2)) {
    const va = parseInt(a, 16);
    const r = resumo(va);
    console.log(`\n===== 0x${va.toString(16)} =====`);
    console.log(`${r.nCampos} campos (${r.bytes}b) | ${r.nChamadas} chamadas | ${r.nLacos} lacos | ${r.nDesvios} desvios\n`);
    r.ops.slice(0, 60).forEach((o) => {
      if (o.op === 'campo') console.log(`  0x${o.addr.toString(16)}  CAMPO  ${o.bytes}b  ${o.membro || ''}`);
      else if (o.op === 'chamada') console.log(`  0x${o.addr.toString(16)}  CALL   0x${o.alvo.toString(16)}`);
      else if (o.op === 'laco_ini') console.log(`  0x${o.addr.toString(16)}  >>> LACO inicio`);
      else if (o.op === 'laco_fim') console.log(`  0x${o.addr.toString(16)}  <<< LACO fim (${o.cond})`);
      else console.log(`  0x${o.addr.toString(16)}  desvio ${o.cond} -> 0x${o.alvo.toString(16)}`);
    });
  }
}
