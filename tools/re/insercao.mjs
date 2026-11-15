// INSERE uma formacao de topo — refeita no fluxo DECODIFICADO (escape.mjs).
//
// A serie inteira de fracassos da insercao azul tem uma explicacao mecanica agora: o byte
// chamado de "prefixo" e um byte de ESCAPE, e todas as versoes anteriores editavam o fluxo
// AINDA ESCAPADO. Duas consequencias fatais:
//
//   1. escrever um id cujo u32 contem o byte de escape (8042 = 0x1F6A num arquivo com
//      esc = 0x6a) grava um escape solto — o jogo passa a ler um token onde ha dado, e o
//      resto do arquivo inteiro sai deslocado. Os experimentos que travaram tem colisao;
//      o 2CA 3T31, que passou, nao tem;
//   2. os offsets dos campos (+7 presenca, +14 exercito, +17/+18 tipo) so batem quando o
//      registro nao tem escape antes do campo. Nos que tem, mascarar "+7" escrevia dentro
//      de outro campo. Eram exatamente esses os "registros invisiveis" e os "cabecalhos
//      anomalos": no fluxo decodificado a faixa 517..560 sai completa, 44 de 44, e os 6597
//      registros do arquivo saem com id estritamente crescente.
//
// Aqui a copia e a emenda acontecem no cru, e a recodificacao escapa o que precisa.
import { ler, marcador, raizDoLado } from './transplante.mjs';
import { codificar } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';

const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';
const TEMPLATE = 'ZZ QBSMALL ALL add manual 2.btt';
const SAIDA = 'ZZ AZUL V3.btt';
const DOADOR = { ini: 517, fim: 560, copias: 1 };   // Battalion (Brigade Engineer), azul

const EXS = new Set([0x14, 0x15, 0x16, 0x17, 0x24, 0x25, 0x26, 0x27, 0x34, 0x35, 0x36, 0x37]);

export function registros(cru) {
  const R = [];
  for (let p = 14; p + 5 <= cru.length; p++) {
    if (!EXS.has(cru[p]) || cru[p + 1] !== 0x60 || cru[p + 2] !== 0x00) continue;
    R.push({ off: p - 14, id: cru.readUInt32LE(p - 11) });
  }
  return R;
}

const d = ler(S + TEMPLATE);
const cru = d.cru, toks = d.tokens;
const R = registros(cru);
const maxId = Math.max(...R.map((x) => x.id));
console.log(`${TEMPLATE}: cru ${cru.length} bytes, ${toks.length} tokens, esc 0x${d.esc.toString(16)}`);
console.log(`   ${R.length} registros, ids ${R[0].id}..${maxId}`);

// O registro COMECA no seu token de cabecalho, e o campo-base "off" (o padrao [exercito] 60 00
// menos 14) nao coincide com esse inicio: na forma comum o token esta em off+2, na variante que
// carrega o contador de filhos, em off-2 (o u32 do contador ocupa os quatro bytes do meio).
// Os dois bytes antes do token sao a cauda do registro anterior. Foi por nao enxergar isso que
// a versao byte-a-byte cortava sub-arvores no lugar errado.
const porPos = new Map();
toks.forEach((t, i) => { if (!porPos.has(t.pos)) porPos.set(t.pos, i); });
// Quando ha token dos dois lados (1077 casos), quem decide e o conteudo: na variante com
// contador o u32 em off-1 e a contagem de filhos, sempre entre 1 e 400. Nos 1077 ambiguos
// esse u32 nunca e plausivel — o token em off-2 e um campo final do registro anterior.
function inicioDoRegistro(off) {
  const temContador = porPos.has(off - 2) && (() => { const n = cru.readUInt32LE(off - 1); return n > 0 && n < 400; })();
  if (temContador) return { pos: off - 2, k: porPos.get(off - 2), variante: 'contador' };
  if (porPos.has(off + 2)) return { pos: off + 2, k: porPos.get(off + 2), variante: 'comum' };
  if (porPos.has(off - 2)) return { pos: off - 2, k: porPos.get(off - 2), variante: 'contador?' };
  throw new Error(`registro em ${off}: sem token de cabecalho em off-2 nem off+2`);
}
const dentro = R.filter((x) => x.id >= DOADOR.ini && x.id <= DOADOR.fim);
if (dentro.length !== DOADOR.fim - DOADOR.ini + 1)
  throw new Error(`doador incompleto: ${dentro.length} registros`);
const seguinte = R.find((x) => x.id > DOADOR.fim);

// todo registro do doador tem de ter cabecalho proprio, e os inicios tem de ser crescentes
const inicios = dentro.map((x) => inicioDoRegistro(x.off));
for (let k = 1; k < inicios.length; k++)
  if (inicios[k].pos <= inicios[k - 1].pos)
    throw new Error(`registros ${dentro[k - 1].id} e ${dentro[k].id} fora de ordem`);
const a = inicios[0], b = inicioDoRegistro(seguinte.off);
const kIni = a.k, kFim = b.k, ini = a.pos, fim = b.pos;
console.log(`   fronteiras: id ${DOADOR.ini} (${a.variante}) @${ini} | id ${seguinte.id} (${b.variante}) @${fim}`);
console.log(`   doador ids ${DOADOR.ini}..${DOADOR.fim}: cru [${ini}..${fim}) = ${fim - ini} bytes, tokens ${kIni}..${kFim}`);

// ---- a copia -----------------------------------------------------------------------------
const copias = [];
let idLivre = maxId + 100;
for (let c = 0; c < DOADOR.copias; c++) {
  const buf = Buffer.from(cru.subarray(ini, fim));
  dentro.forEach((x, k) => buf.writeUInt32LE(idLivre + k, x.off + 3 - ini));  // no cru: sem escape a temer
  const tk = toks.slice(kIni, kFim).map((t) => ({ pos: t.pos - ini, cod: t.cod }));
  copias.push({ buf, tk, idIni: idLivre, idFim: idLivre + dentro.length - 1 });
  idLivre += 100;
}
copias.forEach((c) => console.log(`   copia: ids ${c.idIni}..${c.idFim}, ${c.buf.length} bytes, ${c.tk.length} tokens`));

// ---- contagem de topo do lado azul -------------------------------------------------------
const m = marcador(d);
const az = raizDoLado(cru.subarray(m.pos), 0x17);
if (!az) throw new Error('raiz azul nao achada');
const posContagem = m.pos + az.pos;
console.log(`   raiz azul id ${az.id}: ${az.n} formacoes de topo -> ${az.n + DOADOR.copias} (u32 no cru @${posContagem})`);

// ---- montagem ----------------------------------------------------------------------------
const corpoCru = Buffer.concat([cru.subarray(0, fim), ...copias.map((c) => c.buf), cru.subarray(fim)]);
corpoCru.writeUInt32LE(az.n + DOADOR.copias, posContagem);
const inseridos = copias.reduce((t, c) => t + c.buf.length, 0);
const novosToks = [
  ...toks.slice(0, kFim),
  ...copias.flatMap((c, i) => {
    const base = fim + copias.slice(0, i).reduce((t, x) => t + x.buf.length, 0);
    return c.tk.map((t) => ({ pos: t.pos + base, cod: t.cod }));
  }),
  ...toks.slice(kFim).map((t) => ({ pos: t.pos + inseridos, cod: t.cod })),
];
const bloco = Buffer.concat([Buffer.from([d.esc, 0x00]), codificar({ cru: corpoCru, tokens: novosToks }, d.esc)]);
reconstruir(S + TEMPLATE, S + SAIDA, (b, i) => (i === 1 ? bloco : b));

// ---- verificacao no arquivo gerado --------------------------------------------------------
const v = ler(S + SAIDA);
if (!v.cru.equals(corpoCru)) throw new Error('cru do gerado divergente');
if (v.tokens.length !== novosToks.length) throw new Error(`tokens: ${v.tokens.length} vs ${novosToks.length}`);
const RV = registros(v.cru);
if (RV.length !== R.length + copias.length * dentro.length)
  throw new Error(`registros: ${RV.length} vs ${R.length + copias.length * dentro.length}`);
const ids = RV.map((x) => x.id), dup = ids.filter((x, k) => ids.indexOf(x) !== k);
if (dup.length) throw new Error(`ids duplicados: ${[...new Set(dup)].slice(0, 10).join(', ')}`);
const azV = raizDoLado(v.cru.subarray(marcador(v).pos), 0x17);
if (azV.n !== az.n + DOADOR.copias) throw new Error(`contagem azul no gerado: ${azV.n}`);
console.log(`\n${SAIDA} gerado`);
console.log(`   ${RV.length} registros (${RV.length - R.length} novos), nenhum id duplicado`);
console.log(`   contagem de topo azul: ${az.n} -> ${azV.n}`);
