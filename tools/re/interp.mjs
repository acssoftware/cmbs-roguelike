// Interpretador do esquema: percorre a arvore de serializadores LENDO um arquivo.
//
// O extrator (ops.mjs) da a gramatica — a sequencia de operacoes que o jogo executa
// ao gravar. Este modulo executa essa sequencia contra os bytes reais, produzindo
// a arvore de valores.
//
// LIMITE ATUAL: modo linear. Lacos e desvios condicionais sao registrados mas nao
// resolvidos — a execucao segue em frente. Serve para trechos sem controle de fluxo
// (o cabecalho, por exemplo) e para diagnosticar onde o fluxo diverge.
import { operacoes } from './ops.mjs';

const cacheOps = new Map();
function ops(va) {
  if (!cacheOps.has(va)) cacheOps.set(va, operacoes(va, 8000));
  return cacheOps.get(va);
}

function ehSerializador(va) {
  try { return ops(va).filter((o) => o.op === 'campo').length >= 1; } catch (_) { return false; }
}

// Executa um serializador contra o buffer a partir de `pos`.
// Devolve { pos, campos, avisos } — pos e a posicao apos consumir tudo.
export function executar(va, buf, pos, opcoes = {}) {
  const { profMax = 6, prof = 0, vistos = new Set(), avisos = [], caminho = [] } = opcoes;
  const saida = [];
  if (prof > profMax) { avisos.push({ tipo: 'profundidade', va, pos }); return { pos, campos: saida, avisos }; }

  for (const o of ops(va)) {
    if (o.op === 'campo') {
      if (pos + o.bytes > buf.length) { avisos.push({ tipo: 'fim_do_buffer', va, pos }); break; }
      const bytes = buf.subarray(pos, pos + o.bytes);
      let valor = null;
      if (o.bytes === 1) valor = bytes[0];
      else if (o.bytes === 2) valor = bytes.readUInt16LE(0);
      else if (o.bytes === 4) valor = bytes.readUInt32LE(0);
      saida.push({ pos, bytes: o.bytes, membro: o.membro, valor, hex: bytes.toString('hex'), de: va, addr: o.addr });
      pos += o.bytes;
      continue;
    }
    if (o.op === 'chamada') {
      if (!ehSerializador(o.alvo)) continue;          // nao e serializador: ignora
      if (vistos.has(o.alvo)) { avisos.push({ tipo: 'recursao', va: o.alvo, pos }); continue; }
      const v2 = new Set(vistos); v2.add(o.alvo);
      const r = executar(o.alvo, buf, pos, { ...opcoes, prof: prof + 1, vistos: v2, avisos, caminho: [...caminho, va] });
      saida.push({ sub: o.alvo, campos: r.campos, addr: o.addr });
      pos = r.pos;
      continue;
    }
    if (o.op === 'laco_ini') avisos.push({ tipo: 'laco_nao_resolvido', va, addr: o.addr, pos });
    if (o.op === 'desvio') avisos.push({ tipo: 'desvio_nao_resolvido', va, addr: o.addr, cond: o.cond, pos });
  }
  return { pos, campos: saida, avisos };
}

// Achata a arvore de valores numa lista linear, para inspecao
export function achatar(campos, out = [], ident = 0) {
  for (const c of campos) {
    if (c.sub !== undefined) { out.push({ ident, sub: c.sub }); achatar(c.campos, out, ident + 1); }
    else out.push({ ident, ...c });
  }
  return out;
}

const EH_MAIN = process.argv[1] && /[\\/]interp\.mjs$/.test(process.argv[1]);
if (EH_MAIN && process.argv[2]) {
  const fs = await import('fs');
  const [va0, arquivo, pos0] = [parseInt(process.argv[2], 16), process.argv[3], parseInt(process.argv[4] || '0')];
  const buf = fs.readFileSync(arquivo);
  const r = executar(va0, buf, pos0);
  const lista = achatar(r.campos);
  console.log(`interpretando 0x${va0.toString(16)} sobre ${arquivo.split(/[\\/]/).pop()} a partir de ${pos0}`);
  console.log(`consumiu ate ${r.pos} (${r.pos - pos0} bytes) | ${lista.filter((x) => x.sub === undefined).length} campos lidos\n`);
  lista.slice(0, 40).forEach((x) => {
    const id = '  '.repeat(x.ident);
    if (x.sub !== undefined) { console.log(`${id}-> 0x${x.sub.toString(16)}`); return; }
    console.log(`${id}@${String(x.pos).padStart(6)}  ${x.bytes}b  ${String(x.valor ?? '').padStart(6)}  ${x.hex.slice(0, 34)}  ${x.membro || ''}`);
  });
  const cont = {};
  r.avisos.forEach((a) => { cont[a.tipo] = (cont[a.tipo] || 0) + 1; });
  console.log(`\navisos: ${JSON.stringify(cont)}`);
}
