// O QUE CADA ARMA CARREGA — a regra "a arma manda na municao" colhida de TODOS os saves do jogo.
//
// `toe_armas.json` responde por VAGA (tipo da unidade -> posicao -> arma e carga). Isso serve para
// quem perdeu o paiol inteiro, mas e uma resposta cega para quem ainda tem parte dele: a vaga 1 de
// um esquadrao ucraniano carrega um RPG-22 (tiro 481) num save e um RPG-26 (tiro 482) no outro, e
// a tabela da vaga daria ao homem com o 22 um tiro do 26. O que nao mente e a ARMA: quem leva a
// PKM (2/36) leva 7,62x54R (item 5) em 100% dos 263 saves, e quem leva o RPG-22 (4/15) leva o 481.
//
// Foi assim que o metralhador do autor ficou de pistola (E54): o PKM secou na batalha 1, o jogo
// apagou o par do item 5 e trouxe a pistola (2/43) para a frente; o socorro levou o PKM; e o refil
// so sabia dar municao a quem tinha o vetor VAZIO. Este arquivo e a resposta para o homem com
// paiol parcial: para cada arma que ele carrega (arma 1 e arma 2), os itens que quase todo
// portador dela leva, na maior quantidade vista.
//
// Cada homem vota nas DUAS armas que carrega — o RPG-22 so existe como arma 2 de um fuzileiro, e
// sem isso ele nao teria linha. Por isso a leitura exige uma PARTE minima dos portadores (80%):
// a pistola do metralhador "carrega" 7,62x54R porque todo metralhador a leva, e isso nao faz mal
// (e o mesmo homem); o que a parte corta e o item que um portador leva por acaso para o esquadrao.
//
// uso: node tools/re/armas_municao.mjs [--gravar] [2/36 4/15 ...]   (grava research/armas_municao.json)
import fs from 'node:fs';
import path from 'node:path';
import { lerRoster, caudasDoRoster, paiolDe } from './roster.mjs';
import { DO_APP } from './toe_armas.mjs';

const RAIZ = path.resolve(import.meta.dirname, '../..');
const SALVOS = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games';
export const TABELA = path.join(RAIZ, 'research/armas_municao.json');
// As viradas das campanhas de colheita ZZ FAB (28/09) moram no projeto, fora de Saved Games, e trazem
// armas que nenhuma campanha do autor levou (M107A1, Mk21, M240L, M110 — sem linha a arma nao entra no
// menu das Special Forces). Mas elas SO PREENCHEM o que falta: como cada homem vota nas duas armas, os
// centenas de fuzileiros com pistola da colheita puseram 5.56 na linha da pistola 2/5, e o reset usa
// essa linha para saber que tiro tirar de quem troca de arma.
export const COLHEITA = path.join(RAIZ, 'research/colheita_fab');
export const PARTE = 0.8;

const SEM_ARMA = '8/0';

// As duas armas e o paiol de uma cauda (113.2): `[00][A1][00][A2][00][flags][?][u16 n][n x 4 B]`.
export function lerHomem(cauda) {
  if (!cauda || cauda.length < 11) return null;
  // classe 08 e "sem arma" seja qual for o item (o saqueado guarda o item do que perdeu: 8/24, 8/43)
  const arma = (classe, item) => (classe === 0x08 ? SEM_ARMA : `${classe}/${item}`);
  const a1 = arma(cauda[1], cauda[2]), a2 = arma(cauda[4], cauda[5]);
  const p = paiolDe(cauda);   // o vetor nem sempre esta em +9 (113.6)
  if (!p) return null;
  return { a1, a2, itens: p.pares.map((x) => [x.item, x.qtd]) };
}

export function colher(pastas = [SALVOS]) {
  const armas = {};
  let saves = 0, homens = 0;
  const arquivos = [];
  const anda = (dir) => {
    let itens; try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) anda(p);
      else if (it.name.toLowerCase().endsWith('.bts') && !DO_APP.test(it.name)) arquivos.push(p);
    }
  };
  const vistos = new Set();
  for (const pasta of [].concat(pastas)) {
    const antes = arquivos.length;
    anda(pasta);
    // a mesma virada em duas pastas vota uma vez so
    for (const p of arquivos.splice(antes)) { const k = path.basename(p).toLowerCase(); if (!vistos.has(k)) { vistos.add(k); arquivos.push(p); } }
  }
  for (const p of arquivos) {
    let r, c; try { r = lerRoster(p); c = caudasDoRoster(p); } catch { continue; }
    saves++;
    for (const u of r.unidades) for (const s of u.soldados) {
      const h = lerHomem(c[s.indice]?.cauda);
      if (!h || !h.itens.some(([, q]) => q > 0)) continue;   // saqueado ou vazio: nao ensina
      homens++;
      for (const arma of new Set([h.a1, h.a2])) {
        if (arma === SEM_ARMA) continue;
        const e = armas[arma] || (armas[arma] = { homens: 0, como1: 0, como2: 0, itens: {} });
        e.homens++;
        if (arma === h.a1) e.como1++; else e.como2++;
        for (const [item, q] of h.itens) {
          const it = e.itens[item] || (e.itens[item] = { n: 0, max: 0, qtds: new Map() });
          it.n++; it.max = Math.max(it.max, q);
          if (q > 0) it.qtds.set(q, (it.qtds.get(q) || 0) + 1);
        }
      }
    }
  }
  // A MODA e a dotacao: o maximo e o municiador que carrega o triplo do esquadrao (5,45 x 1582 num
  // fuzileiro), a moda e o que a maioria recebe de fabrica (o PKM com 300, o fuzil com 450).
  for (const e of Object.values(armas)) for (const it of Object.values(e.itens)) {
    it.moda = [...it.qtds.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] || 0;
    delete it.qtds;
  }
  return { saves, homens, armas };
}

// A leitura, para quem so quer usar: `{ '2/36': { 5: 300, 6: 48 } }` — so os itens que pelo menos
// PARTE dos portadores carregam, na quantidade da MODA (a dotacao de fabrica), nao no maximo.
export function apurar(armas, parte = PARTE) {
  const out = {};
  for (const [arma, e] of Object.entries(armas)) {
    const linha = {};
    for (const [item, it] of Object.entries(e.itens)) {
      const q = it.moda || it.max;
      if (q > 0 && it.n / e.homens >= parte) linha[item] = q;
    }
    if (Object.keys(linha).length) out[arma] = linha;
  }
  return out;
}

export function lerTabela(arquivo = TABELA, parte = PARTE) {
  const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  return apurar(bruto.armas, parte);
}

// AS ARMAS SECUNDARIAS: as que andam na mao 2 em quase todo portador. A pistola do metralhador
// (2/43) e arma 2 de 340 homens e arma 1 de cinco — os cinco que secaram a PKM. E o sinal de que o
// homem esta na condicao do E54: quem tem uma secundaria na FRENTE perdeu a principal, ou o tiro
// dela. Um fuzil nunca entra aqui, entao a devolucao nao troca o fuzil de ninguem pela opiniao da
// tabela de vagas.
export function lerSecundarias(arquivo = TABELA, parte = PARTE, minimo = 5) {
  const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const out = new Set();
  for (const [arma, e] of Object.entries(bruto.armas)) {
    const total = (e.como1 || 0) + (e.como2 || 0);
    if (total >= minimo && (e.como2 || 0) / total >= parte) out.add(arma);
  }
  return out;
}

if (process.argv[1] && /armas_municao\.mjs$/.test(process.argv[1])) {
  const pedidas = process.argv.slice(2).filter((a) => /^\d+\/\d+$/.test(a));
  const c = colher();
  const fab = colher([COLHEITA]);
  const novas = Object.keys(fab.armas).filter((k) => !c.armas[k]);
  for (const k of novas) c.armas[k] = { ...fab.armas[k], fonte: 'colheita_fab' };
  console.log(`+ ${novas.length} armas so da colheita de fabrica: ${novas.join(', ')}`);
  // `--preencher`: a tabela gravada fica como esta e so GANHA as armas que nao tinha. Refazer as linhas
  // antigas com os saves de teste de hoje (cheios de fuzileiros com pistola) pos 5.56 na pistola 2/5.
  if (process.argv.includes('--preencher')) {
    const antiga = JSON.parse(fs.readFileSync(TABELA, 'utf8'));
    const ganhas = Object.keys(c.armas).filter((k) => !antiga.armas[k]);
    for (const k of ganhas) antiga.armas[k] = c.armas[k];
    c.armas = antiga.armas; c.saves = antiga.saves; c.homens = antiga.homens;
    console.log(`preencher: ${ganhas.length} armas novas (${ganhas.join(', ')}), as ${Object.keys(antiga.armas).length - ganhas.length} antigas intactas`);
  }
  console.log(`${c.saves} saves, ${c.homens} homens com paiol; ${Object.keys(c.armas).length} armas`);
  const lista = Object.entries(c.armas).filter(([a]) => !pedidas.length || pedidas.includes(a)).sort((a, b) => b[1].homens - a[1].homens);
  for (const [arma, e] of lista.slice(0, pedidas.length ? 60 : 30)) {
    const itens = Object.entries(e.itens).sort((a, b) => b[1].n - a[1].n)
      .map(([item, it]) => `${item}:${it.moda}/${it.max} (${Math.round(100 * it.n / e.homens)}%)`).join('  ');
    console.log(`${arma.padEnd(7)} ${String(e.homens).padStart(5)} homens (mao 1: ${e.como1}, mao 2: ${e.como2}) | ${itens}`);
  }
  if (process.argv.includes('--gravar')) {
    fs.writeFileSync(TABELA, JSON.stringify({
      nota: 'O que cada arma carrega, colhido de todos os saves que o JOGO escreveu: arma (classe/item) -> {como1, como2: em quantos homens ela e a arma 1 ou a arma 2} e item de municao -> {n: portadores que o levam, max: maior quantidade vista, moda: a quantidade mais comum, que e a dotacao}. Cada homem vota nas duas armas que carrega. Leia com `lerTabela` (so itens com pelo menos 80% dos portadores). Refazer com `node tools/re/armas_municao.mjs --gravar` (ou so acrescentar armas novas com `--gravar --preencher`).',
      saves: c.saves, homens: c.homens, parte: PARTE, armas: c.armas,
    }, null, 1) + '\n');
    console.log(`-> ${TABELA}`);
  }
}
