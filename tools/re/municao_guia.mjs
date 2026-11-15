// DE QUEM E CADA MUNICAO — a tabela que responde nos dois sentidos.
//
// `research/armas_municao.json` guarda, para cada arma, os itens que seus portadores levam (colheita
// de 272 saves escritos pelo JOGO). Este script le a colheita ao contrario tambem: dado um ITEM, que
// armas o levam. A diferenca importa:
//
//   - item que 20 armas levam e CALIBRE DE FAMILIA (o 5,45 de todo fuzil russo). Nao e "a municao
//     daquela arma", e o que aquela familia come;
//   - item que UMA arma leva e o TIRO dela (o 490 do SKIF, o 41 do RPG-7V1). Esse sim tem dono.
//
// O nome do item so entra por aritmetica de painel: o jogo soma a municao da unidade e ESCREVE o
// nome ("5.45mm 2020", "RPG-22 HEAT 2"), e a soma dos itens daquela unidade no save diz qual id e
// qual. Dez calibres entraram assim em 08/09 e o 481 em 17/09 (E67).
//
//   node tools/re/municao_guia.mjs [--gravar]     -> research/MUNICAO.md
import fs from 'node:fs';
import path from 'node:path';
import { MUNICAO } from './armas_candidatas.mjs';

const RAIZ = path.resolve(import.meta.dirname, '../..');
const colheita = JSON.parse(fs.readFileSync(path.join(RAIZ, 'research/armas_municao.json'), 'utf8'));
const nomes = JSON.parse(fs.readFileSync(path.join(RAIZ, 'research/armas.json'), 'utf8')).armas;
const PARTE = colheita.parte || 0.8;

const nomeItem = (i) => (MUNICAO[i] ? `**${MUNICAO[i].calibre}**` : `item ${i}`);
const nomeArma = (p) => (nomes[p] ? `${nomes[p].nome} (\`${p}\`)` : `\`${p}\``);
const ladoArma = (p) => (nomes[p] ? nomes[p].lado || '?' : '?');

// item -> armas cujos portadores o levam
const porItem = new Map();
for (const [arma, a] of Object.entries(colheita.armas)) {
  if (arma === '8/0') continue;
  for (const [item, v] of Object.entries(a.itens)) {
    if (!porItem.has(Number(item))) porItem.set(Number(item), []);
    porItem.get(Number(item)).push({ arma, p: v.n / a.homens, n: v.n, moda: v.moda, max: v.max });
  }
}

const L = [];
L.push('# De quem e cada municao');
L.push('');
L.push(`Gerado por \`tools/re/municao_guia.mjs\` a partir de \`research/armas_municao.json\` —`);
L.push(`**${colheita.saves} saves** escritos pelo jogo, **${colheita.homens} homens**. Uma arma "leva" um`);
L.push(`item quando pelo menos **${Math.round(PARTE * 100)}%** dos seus portadores o tem; a quantidade e a moda,`);
L.push('que e a dotacao cheia.');
L.push('');
L.push('O id da ARMA e por exercito (FORMATO 118.1), entao um nome de arma vale para o lado em que foi');
L.push('lido. O id do ITEM parece ser global — o 5,45 e o item 1 em toda unidade russa e ucraniana e o');
L.push('5,56 e o item 2 em toda americana —, mas isso nao esta provado do lado russo.');
L.push('');
L.push('## A municao de cada arma');
L.push('');
L.push('| arma | lado | portadores na colheita | leva |');
L.push('|---|---|---|---|');
const armasOrd = Object.entries(colheita.armas)
  .filter(([p]) => p !== '8/0')
  .sort((a, b) => (nomes[b[0]] ? 1 : 0) - (nomes[a[0]] ? 1 : 0) || b[1].homens - a[1].homens);
for (const [arma, a] of armasOrd) {
  const itens = Object.entries(a.itens).filter(([, v]) => v.n / a.homens >= PARTE)
    .sort((x, y) => y[1].n - x[1].n)
    .map(([i, v]) => `${nomeItem(Number(i))} x${v.moda}`);
  L.push(`| ${nomeArma(arma)} | ${ladoArma(arma)} | ${a.homens} | ${itens.join(' + ') || '— (nada em ' + Math.round(PARTE * 100) + '% dos portadores)'} |`);
}

L.push('');
L.push('## O contrario: de quem e cada item');
L.push('');
L.push('| item | nome | quem leva |');
L.push('|---|---|---|');
for (const [item, lista] of [...porItem].sort((a, b) => a[0] - b[0])) {
  const fortes = lista.filter((x) => x.p >= PARTE).sort((a, b) => b.n - a.n);
  const fracos = lista.filter((x) => x.p < PARTE && x.p >= 0.2).sort((a, b) => b.p - a.p);
  let quem;
  if (!fortes.length) {
    quem = fracos.length
      ? `_sem dono claro_ — aparece em ${fracos.slice(0, 3).map((x) => `${nomeArma(x.arma)} ${(x.p * 100).toFixed(0)}%`).join(', ')}`
      : '_sem dono claro_';
  } else if (fortes.length === 1) {
    quem = `**so** ${nomeArma(fortes[0].arma)} — x${fortes[0].moda}`;
  } else if (new Set(fortes.map((x) => nomes[x.arma]?.nome).filter(Boolean)).size === 1 && fortes.every((x) => nomes[x.arma])) {
    // Dois ids que mostram o mesmo nome na tela nao sao uma familia, sao a mesma arma (E66).
    quem = `**so** ${nomes[fortes[0].arma].nome} — ${fortes.map((x) => `\`${x.arma}\` x${x.moda}`).join(' e ')}, ids gemeos`;
  } else {
    quem = `${fortes.length} armas (calibre de familia): ${fortes.slice(0, 6).map((x) => nomeArma(x.arma)).join(', ')}${fortes.length > 6 ? ', …' : ''}`;
  }
  L.push(`| ${item} | ${MUNICAO[item] ? MUNICAO[item].calibre : '?'} | ${quem} |`);
}

L.push('');
L.push('## O que este arquivo NAO cobre: a granada');
L.push('');
L.push('A granada **nao esta no vetor de municao** (FORMATO 113.7, E67). O painel de uma unidade');
L.push('escreve uma linha `Grenade N` e nenhum item do vetor soma N: cada granada e uma entrada de');
L.push('3 bytes nas listas do rabo do soldado, e o tipo dela e por exercito (`1,2` e `1,4` nas');
L.push('unidades ucranianas, `1,1` e `1,3` nas americanas). Consequencia medida na EASY2: o refil do');
L.push('app reabastece o vetor e **nao repoe granada**, entao ela so cai de batalha em batalha.');
L.push('');

const md = L.join('\n') + '\n';
if (process.argv.includes('--gravar')) {
  const saida = path.join(RAIZ, 'research/MUNICAO.md');
  fs.writeFileSync(saida, md);
  console.log(`gravado ${saida}`);
} else {
  process.stdout.write(md);
}
