// REFORCOS (28/09, E107 — gabarito no editor: ZZ MAPA/0X2 REF B0..B5). O que o editor escreve quando
// uma formacao vira "Reinforcement Group" (Purchase Units, teclas 1-7) e quando o grupo ganha tempo:
//
//   NA UNIDADE: os 3 bits baixos do byte +12 do registro sao o grupo (0 = nenhum, 1..7). So as
//   unidades — o registro da formacao fica como esta. (A secao 33 chamava +12 de "categoria":
//   0x50 artilharia e 0x58 apoio aereo; o alto do byte continua sendo isso.)
//
//   DEPOIS DO ULTIMO REGISTRO: uma tabela
//       u32 n | n x ( u8 lado (0 azul, 1 vermelho) | u8 grupo | u8 chegada | u8 janela |
//                     u32 0 | u16 len | len bytes do nome )
//   `chegada` e o INDICE da lista "Earliest Possible Arrival" (0 = 5 min, 1 = 10 ... 10 = 55 min,
//   11 = 1:00, 12 = 1:15 ... 19 = 3:00) e `janela` o da "Arrival Span" (0 = Exact, 1 = 5 ... 6 = 30).
//
// `lerReforcos` acha a tabela por forma e confere contra as marcas; `escreverReforcos` escreve por
// POSICAO (`posicaoDaTabela`), porque a tabela vazia e so um `u32 0`.
import { abrirCompleto } from './anexar2.mjs';
import { arvore } from './extras.mjs';
import { fimDoConteudo } from './core.mjs';
import { codificarComoJogo } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';

export const CHEGADA_MIN = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 75, 90, 105, 120, 135, 150, 165, 180];
export const JANELA_MIN = [0, 5, 10, 15, 20, 25, 30];

function lerTabelaEm(c, o) {
  if (o + 4 > c.length) return null;
  const n = c.readUInt32LE(o);
  if (n < 1 || n > 14) return null;
  const grupos = []; let p = o + 4;
  for (let k = 0; k < n; k++) {
    if (p + 10 > c.length) return null;
    const lado = c[p], grupo = c[p + 1], chegada = c[p + 2], janela = c[p + 3];
    if (lado > 1 || grupo < 1 || grupo > 7 || chegada >= CHEGADA_MIN.length || janela >= JANELA_MIN.length) return null;
    if (c.readUInt32LE(p + 4) !== 0) return null;
    const len = c.readUInt16LE(p + 8);
    if (len > 64 || p + 10 + len > c.length) return null;
    const nome = c.toString('latin1', p + 10, p + 10 + len);
    if (/[^\x20-\x7e]/.test(nome)) return null;
    grupos.push({ lado: lado ? 'vermelho' : 'azul', grupo, chegadaIdx: chegada, chegadaMin: CHEGADA_MIN[chegada], janelaIdx: janela, janelaMin: JANELA_MIN[janela], nome });
    p += 10 + len;
  }
  return { pos: o, fim: p, grupos };
}

// As unidades marcadas, por lado e grupo, pelos bits baixos de +12.
export function unidadesPorGrupo(X) {
  const c = X.completo; const arv = arvore(X); const out = { azul: {}, vermelho: {} };
  const anda = (no, lado) => {
    if (!no.r.form) { const g = c[no.r.c + 12] & 7; if (g) (out[lado][g] = out[lado][g] || []).push({ id: no.r.id, nome: no.r.nm }); }
    no.filhos.forEach((f) => anda(f, lado));
  };
  arv.azul.forEach((t) => anda(t, 'azul')); arv.vermelho.forEach((t) => anda(t, 'vermelho'));
  return out;
}

export function lerReforcos(caminho) {
  const X = abrirCompleto(caminho); const c = X.completo;
  const marcadas = unidadesPorGrupo(X);
  const ultimo = X.R[X.R.length - 1];
  // A tabela vazia e `u32 0` — nao se acha por forma; a cheia se acha e se confere com as marcas.
  const candidatas = [];
  for (let o = ultimo.c + 16; o < c.length; o++) {
    const t = lerTabelaEm(c, o);
    if (t) candidatas.push(t);
  }
  // Um grupo pode estar DEFINIDO e vazio (Shield of Kiev 3 define o R1 azul, em 3:00, sem unidade
  // nenhuma): vale a candidata que cobre mais grupos marcados; empate, a primeira.
  const cobre = (t) => t.grupos.filter((g) => (marcadas[g.lado][g.grupo] || []).length > 0).length;
  let tabela = null;
  for (const t of candidatas) if (cobre(t) > 0 && (!tabela || cobre(t) > cobre(tabela))) tabela = t;
  return { tabela, marcadas, candidatas: candidatas.length };
}

// ONDE A TABELA MORA (medido em 201 arquivos e nos dois gabaritos): logo depois do conteudo do ultimo
// registro — `fimDoConteudo + 8` quando ele nao e core, `+ 13` quando e (os 7 da cauda core e mais
// seis; 0X3 CORE B1). Vazia ela e so o `u32 0`, e por isso tem de ser achada por posicao, nao por forma.
export function posicaoDaTabela(X) {
  const c = X.completo; const u = X.R[X.R.length - 1];
  const e = fimDoConteudo(c, u, c.length);
  const pos = e.fim + (e.core ? 13 : 8);
  const n = c.readUInt32LE(pos);
  let fim = pos + 4;
  for (let k = 0; k < n; k++) fim += 10 + c.readUInt16LE(fim + 8);
  return { pos, fim, n };
}

// O CAMPO DE TAMANHO: o u32 nove bytes antes do primeiro registro mede do fim dele ate o fim da tabela
// (687 -> 697 -> 707 -> 710 nos passos do gabarito). O app ja entrega batalhas em que ele nao bate
// (0X3 CORE A: 54053 contra 58796) e o jogo carrega; por isso aqui ele recebe a VARIACAO da tabela.
const CAMPO_TAMANHO = -9;

export function bytesDaTabela(grupos) {
  const partes = [Buffer.alloc(4)]; partes[0].writeUInt32LE(grupos.length);
  for (const g of grupos) {
    const nome = Buffer.from(String(g.nome || ''), 'latin1');
    if (nome.length > 64 || /[^\x20-\x7e]/.test(g.nome || '')) throw new Error(`nome de reforco invalido: ${g.nome}`);
    const e = Buffer.alloc(10 + nome.length);
    e[0] = g.lado === 'vermelho' ? 1 : 0; e[1] = g.grupo; e[2] = g.chegadaIdx; e[3] = g.janelaIdx ?? 0;
    e.writeUInt16LE(nome.length, 8); nome.copy(e, 10);
    if (!(e[1] >= 1 && e[1] <= 7) || !(e[2] < CHEGADA_MIN.length) || !(e[3] < JANELA_MIN.length)) throw new Error(`grupo de reforco invalido: ${JSON.stringify(g)}`);
    partes.push(e);
  }
  return Buffer.concat(partes);
}

// O indice da lista a partir de minutos: o menor degrau que nao chega antes do pedido.
export const indiceDaChegada = (min) => { const i = CHEGADA_MIN.findIndex((m) => m >= min); return i < 0 ? CHEGADA_MIN.length - 1 : i; };
export const indiceDaJanela = (min) => { const i = JANELA_MIN.findIndex((m) => m >= min); return i < 0 ? JANELA_MIN.length - 1 : i; };

// ESCREVER: `plano` = { grupos: [{ lado, grupo, chegadaIdx, janelaIdx, nome }], unidades: { id: grupo } }.
// A tabela inteira e substituida pela do plano; as unidades de `unidades` recebem o grupo nos bits
// baixos de +12 (0 tira). Com `limpar`, toda unidade que nao esta no plano volta a 0.
export function escreverReforcos(entrada, saida, plano, { limpar = true } = {}) {
  const X = abrirCompleto(entrada);
  let c = Buffer.from(X.completo);
  const porId = new Map(X.R.filter((r) => !r.form).map((r) => [r.id, r]));
  const alvo = new Map(Object.entries(plano.unidades || {}).map(([id, g]) => [Number(id), g]));
  for (const id of alvo.keys()) if (!porId.has(id)) throw new Error(`nao ha unidade com id ${id}`);
  for (const r of porId.values()) {
    const g = alvo.has(r.id) ? alvo.get(r.id) : (limpar ? 0 : null);
    if (g === null) continue;
    c[r.c + 12] = (c[r.c + 12] & 0xf8) | g;
  }
  const t = posicaoDaTabela(X);
  const nova = bytesDaTabela(plano.grupos || []);
  const delta = nova.length - (t.fim - t.pos);
  const campo = X.R[0].c + CAMPO_TAMANHO;
  c = Buffer.concat([c.subarray(0, t.pos), nova, c.subarray(t.fim)]);
  c.writeUInt32LE(c.readUInt32LE(campo) + delta, campo);
  reconstruir(entrada, saida, (x, k) => (k === 1 ? codificarComoJogo(c, X.d.esc) : x));
  // conferencia: a tabela lida de volta e a do plano, e as marcas tambem
  const Y = abrirCompleto(saida);
  const t2 = posicaoDaTabela(Y);
  if (!Y.completo.subarray(t2.pos, t2.fim).equals(nova)) throw new Error('a tabela gravada nao le de volta igual');
  if (Y.R.length !== X.R.length) throw new Error(`o arquivo gravado tem ${Y.R.length} registros, eram ${X.R.length}`);
  for (const [id, g] of alvo) { const r = Y.R.find((x) => x.id === id); if ((Y.completo[r.c + 12] & 7) !== g) throw new Error(`a unidade ${id} nao ficou no grupo ${g}`); }
  return { grupos: (plano.grupos || []).length, unidades: alvo.size, delta };
}

const EH_MAIN = process.argv[1] && /[\\/]reforco\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  for (const f of process.argv.slice(2)) {
    let r; try { r = lerReforcos(f); } catch (e) { console.log(`${f}: ERRO ${e.message}`); continue; }
    const m = (lado) => Object.entries(r.marcadas[lado]).map(([g, us]) => `R${g}:${us.length}`).join(' ') || '-';
    const t = r.tabela ? r.tabela.grupos.map((g) => `${g.lado[0]}R${g.grupo} ${g.chegadaMin}min${g.janelaMin ? '+' + g.janelaMin : ''}${g.nome ? ' "' + g.nome + '"' : ''}`).join(', ') : 'nenhuma';
    console.log(`${f.split(/[\\/]/).pop().padEnd(62)} marcadas azul ${m('azul').padEnd(16)} verm ${m('vermelho').padEnd(16)} | tabela: ${t}`);
  }
}
