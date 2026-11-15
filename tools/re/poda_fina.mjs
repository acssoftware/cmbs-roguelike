// PODA FINA: copia uma formacao REMOVENDO unidades especificas de dentro dela.
//
// A poda anterior (bissecao.mjs) so cortava o fim da arvore. Esta remove registros escolhidos
// em qualquer nivel e conserta a contagem de filhos de cada pai afetado. Serve para responder
// "e o apoio de fogo que derruba a copia?" — monta o mesmo batalhao so com veiculo e
// infantaria, sem TACP, sem morteiro, sem observador, sem drone.
//
// Uma restricao: o contador de filhos mora no PRIMEIRO FILHO do pai, entao remover o primeiro
// filho exigiria converter o cabecalho do seguinte. A ferramenta recusa esse caso — nas
// formacoes do jogo o apoio nunca e o primeiro filho.
import { ler, marcador, raizDoLado } from './transplante.mjs';
import { registros, indiceDeTokens, inicioDoRegistro, subArvore, contagemDeFilhos } from './regs.mjs';
import { codificar } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';

const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';
const TEMPLATE = 'ZZ QBSMALL ALL add manual 2.btt';
const MANTER = [[609, 770], [6399, 6560], [5325, 5368]];

const d = ler(S + TEMPLATE);
const cru = d.cru, porPos = indiceDeTokens(d.tokens);
const R = registros(cru).sort((a, b) => a.off - b.off);
const ini = (k) => inicioDoRegistro(cru, porPos, R[k].off).pos;
const fimDe = (k) => (k + 1 < R.length ? ini(k + 1) : cru.length);
const variante = (k) => inicioDoRegistro(cru, porPos, R[k].off).variante;

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

const idDoador = Number(process.argv[2] || 609);
const PADRAO = new RegExp(process.argv[3] || 'TACP|JTAC|Air Controller|Fire Support|Observer|Mortar|Raven|Drone|Howitzer|MANPADS', 'i');
const ROTULO = process.argv[4] || 'SO MANOBRA';

const iRaiz = R.findIndex((x) => x.id === idDoador);
const fimRaiz = subArvore(cru, porPos, R, iRaiz);

// ---- decidir o que sai ---------------------------------------------------------------------
const fora = new Set();
const cortes = [];                              // { pai, removidos }
(function varrer(i) {
  const fs = filhos(i);
  let removidos = 0;
  fs.forEach((f, pos) => {
    const alvo = R[f.i].nm && PADRAO.test(R[f.i].nm);
    if (alvo) {
      if (pos === 0) throw new Error(`o registro ${R[f.i].id} (${R[f.i].nm}) e o PRIMEIRO filho de ${R[i].id}: nao da para remover sem mover o contador`);
      for (let k = f.i; k < f.fim; k++) fora.add(k);
      removidos++;
      return;
    }
    if (R[f.i].form) varrer(f.i);
  });
  if (removidos) cortes.push({ i, removidos, antes: contagemDeFilhos(cru, porPos, R, i) });
})(iRaiz);

const mantidos = [];
for (let k = iRaiz; k < fimRaiz; k++) if (!fora.has(k)) mantidos.push(k);
console.log(`${R[iRaiz].nm} id ${idDoador}: ${fimRaiz - iRaiz} registros -> ${mantidos.length} (saem ${fora.size})`);
cortes.forEach((c) => console.log(`   ${R[c.i].id} ${R[c.i].nm}: ${c.antes} filhos -> ${c.antes - c.removidos}`));
console.log('   removidos: ' + [...fora].filter((k) => R[k].nm).map((k) => R[k].nm).filter((v, i, a) => a.indexOf(v) === i).join(', '));

// ---- montar a copia -------------------------------------------------------------------------
const maxId = Math.max(...R.map((x) => x.id));
const alinhar = (m, base) => m + (((base % 256) - (m % 256)) + 256) % 256;
const idBase = alinhar(maxId + 100, R[iRaiz].id);

// Os mantidos formam CORRIDAS contiguas. Copiar corrida por corrida em vez de registro a
// registro evita pedir a fronteira de cada um — e os 27 registros de fronteira de 256 nao tem
// token de cabecalho, entao nem teriam fronteira para dar. So os extremos das corridas
// precisam dela, e nenhum deles cai num registro especial.
const corridas = [];
for (const k of mantidos) {
  const ult = corridas[corridas.length - 1];
  if (ult && k === ult.fim + 1) ult.fim = k;
  else corridas.push({ ini: k, fim: k });
}
console.log(`   ${corridas.length} corrida(s) contigua(s)`);

const partes = [], tk = [];
const trechos = [];                              // { a, b, novo } — para mapear posicoes
let desloc = 0;
for (const c of corridas) {
  const a = ini(c.ini);
  const b = c.fim + 1 < R.length ? ini(c.fim + 1) : cru.length;
  trechos.push({ a, b, novo: desloc });
  partes.push(cru.subarray(a, b));
  d.tokens.filter((t) => t.pos >= a && t.pos < b).forEach((t) => tk.push({ pos: t.pos - a + desloc, cod: t.cod }));
  desloc += b - a;
}
const buf = Buffer.concat(partes);
// qualquer posicao absoluta do cru vira posicao no buffer novo
const mapear = (p) => {
  const t = trechos.find((x) => p >= x.a && p < x.b);
  if (!t) throw new Error(`posicao ${p} nao esta em nenhuma corrida mantida`);
  return p - t.a + t.novo;
};
mantidos.forEach((k, novo) => {
  buf.writeUInt32LE(idBase + novo, mapear(R[k].off + 3));
  buf[mapear(R[k].off + 7)] &= ~0x80;
});
// contadores dos pais que perderam filhos: o u32 fica em off-1, dentro do PRIMEIRO FILHO
for (const c of cortes) {
  const pf = c.i + 1;
  if (variante(pf) !== 'contador') throw new Error(`primeiro filho de ${R[c.i].id} nao carrega contador`);
  buf.writeUInt32LE(c.antes - c.removidos, mapear(R[pf].off - 1));
}

// ---- mascara, emenda e contagem do lado ------------------------------------------------------
const manter = new Set();
MANTER.forEach(([x, y]) => R.forEach((r) => { if (r.id >= x && r.id <= y) manter.add(r.id); }));
const corpo0 = Buffer.from(cru);
R.filter((x) => x.nm && !manter.has(x.id)).forEach((x) => { corpo0[x.off + 7] |= 0x80; });

const pos = ini(fimRaiz);
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

const SAIDA = `AA CA ${ROTULO} ${String(mantidos.length).padStart(3, '0')}r.btt`;
const bloco = Buffer.concat([Buffer.from([d.esc, 0x00]), codificar({ cru: corpo, tokens: toks }, d.esc)]);
reconstruir(S + TEMPLATE, S + SAIDA, (x, i) => (i === 1 ? bloco : x));

const v = ler(S + SAIDA);
if (!v.cru.equals(corpo)) throw new Error('cru divergente');
const RV = registros(v.cru);
const ids = RV.map((x) => x.id), dup = ids.filter((x, k) => ids.indexOf(x) !== k);
if (dup.length) throw new Error(`ids duplicados: ${[...new Set(dup)].slice(0, 5).join(', ')}`);
if (RV.length !== R.length + mantidos.length) throw new Error(`registros: ${RV.length} vs ${R.length + mantidos.length}`);
console.log(`${SAIDA} gerado — copia com ids ${idBase}..${idBase + mantidos.length - 1}, contagem ${raiz.n} -> ${raiz.n + 1}`);
