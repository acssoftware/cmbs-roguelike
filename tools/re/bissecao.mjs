// BISSECCAO do limite de replicacao (secao 32): copia a MESMA formacao com podas sucessivas,
// para achar em que ponto exato o jogo passa a travar.
//
// O doador e o Battalion (Tank 40), que trava inteiro com 130 tokens. Podando filhos da
// ultima companhia dele a copia vale 92, 104, 117 ou 130 tokens, sempre com a mesma cara —
// mesmo tipo, mesma profundidade, mesmos vizinhos. Só o tamanho muda.
//
// Podar exige mexer em UM contador por nivel cortado: a contagem de filhos de uma formacao
// mora no PRIMEIRO FILHO dela (u32 em off-1 na variante com contador).
import { ler, marcador, raizDoLado } from './transplante.mjs';
import { registros, indiceDeTokens, inicioDoRegistro, subArvore, contagemDeFilhos } from './regs.mjs';
import { codificar } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';

const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';
const TEMPLATE = 'ZZ QBSMALL ALL add manual 2.btt';
const MANTER = [[609, 770], [6399, 6560], [5325, 5368], [1936, 1988]];

const d = ler(S + TEMPLATE);
const cru = d.cru, porPos = indiceDeTokens(d.tokens);
const R = registros(cru).sort((a, b) => a.off - b.off);
const ini = (off) => inicioDoRegistro(cru, porPos, off).pos;
const contaToks = (a, b) => d.tokens.filter((t) => t.pos >= a && t.pos < b).length;

// Os filhos diretos de uma formacao, como intervalos de indice em R.
function filhos(i) {
  const n = contagemDeFilhos(cru, porPos, R, i);
  const out = [];
  let k = i + 1;
  for (let q = 0; q < n && k < R.length; q++) {
    const fim = R[k].form ? subArvore(cru, porPos, R, k) : k + 1;
    out.push({ i: k, fim });
    k = fim;
  }
  return out;
}

// corte = [n1, n2, ...]: quantos filhos manter em cada nivel, descendo sempre pelo ULTIMO
// mantido. Devolve o indice (exclusivo) do ultimo registro que entra na copia e os contadores
// a reescrever.
function podar(iRaiz, corte) {
  const contadores = [];
  let i = iRaiz, fim = subArvore(cru, porPos, R, i);
  for (const n of corte) {
    const fs = filhos(i);
    if (n < 1 || n > fs.length) throw new Error(`corte ${n} invalido: a formacao ${R[i].id} tem ${fs.length} filhos`);
    contadores.push({ posCru: R[i + 1].off - 1, valor: n });   // contador no primeiro filho
    fim = fs[n - 1].fim;
    i = fs[n - 1].i;
    if (!R[i].form) break;
  }
  return { fim, contadores };
}

const [idDoador, ...corte] = process.argv.slice(2).map(Number);
if (!idDoador || !corte.length) throw new Error('uso: node bissecao.mjs <id do doador> <n1> [n2] ...');

const iRaiz = R.findIndex((x) => x.id === idDoador);
if (iRaiz < 0) throw new Error(`formacao ${idDoador} nao achada`);
const { fim, contadores } = podar(iRaiz, corte);
const a = ini(R[iRaiz].off), b = ini(R[fim].off);
const nToks = contaToks(a, b);
const nRegs = fim - iRaiz;
const SAIDA = `AA BIS ${String(nToks).padStart(3, '0')} TOK.btt`;
console.log(`${R[iRaiz].nm} id ${idDoador}, corte [${corte.join(',')}]: ${nRegs} registros, ${nToks} tokens`);
contadores.forEach((c) => console.log(`   contador reescrito para ${c.valor}`));

// ---- a copia ------------------------------------------------------------------------------
const maxId = Math.max(...R.map((x) => x.id));
const alinhar = (m, base) => m + (((base % 256) - (m % 256)) + 256) % 256;
const idBase = alinhar(maxId + 100, R[iRaiz].id);
const buf = Buffer.from(cru.subarray(a, b));
R.slice(iRaiz, fim).forEach((x, k) => {
  buf.writeUInt32LE(idBase + k, x.off + 3 - a);
  buf[x.off + 7 - a] &= ~0x80;
});
contadores.forEach((c) => buf.writeUInt32LE(c.valor, c.posCru - a));
const tk = d.tokens.filter((t) => t.pos >= a && t.pos < b).map((t) => ({ pos: t.pos - a, cod: t.cod }));

// ---- mascara e emenda ----------------------------------------------------------------------
const manter = new Set();
MANTER.forEach(([x, y]) => R.forEach((r) => { if (r.id >= x && r.id <= y) manter.add(r.id); }));
const corpo0 = Buffer.from(cru);
R.filter((x) => x.nm && !manter.has(x.id)).forEach((x) => { corpo0[x.off + 7] |= 0x80; });

// a emenda entra depois da sub-arvore INTEIRA do doador, nao depois da parte podada
const fimTotal = subArvore(cru, porPos, R, iRaiz);
const pos = ini(R[fimTotal].off);
const corpo = Buffer.concat([corpo0.subarray(0, pos), buf, corpo0.subarray(pos)]);
const kCorte = d.tokens.findIndex((t) => t.pos >= pos);
const toks = [
  ...d.tokens.slice(0, kCorte),
  ...tk.map((t) => ({ pos: t.pos + pos, cod: t.cod })),
  ...d.tokens.slice(kCorte).map((t) => ({ pos: t.pos + buf.length, cod: t.cod })),
];

const army = R[iRaiz].army === 2 ? 0x27 : 0x17;
const mm = marcador({ cru: corpo, tokens: toks });
const raiz = raizDoLado(corpo.subarray(mm.pos), army);
corpo.writeUInt32LE(raiz.n + 1, mm.pos + raiz.pos);

const bloco = Buffer.concat([Buffer.from([d.esc, 0x00]), codificar({ cru: corpo, tokens: toks }, d.esc)]);
reconstruir(S + TEMPLATE, S + SAIDA, (x, i) => (i === 1 ? bloco : x));

const v = ler(S + SAIDA);
if (!v.cru.equals(corpo)) throw new Error('cru do gerado divergente');
const RV = registros(v.cru);
const ids = RV.map((x) => x.id), dup = ids.filter((x, k) => ids.indexOf(x) !== k);
if (dup.length) throw new Error(`ids duplicados: ${[...new Set(dup)].slice(0, 5).join(', ')}`);
console.log(`${SAIDA} gerado — copia com ids ${idBase}..${idBase + nRegs - 1}, contagem do lado ${raiz.n} -> ${raiz.n + 1}`);
