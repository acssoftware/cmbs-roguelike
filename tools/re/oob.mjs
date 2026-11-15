// Localiza a ordem de batalha de um cenario "todas as formacoes" e devolve as linhas
// da arvore, alinhadas com a tela. A arvore comeca alguns registros ANTES do primeiro
// que o extrator acha (ele perde a formacao raiz e o primeiro filho de cada grupo),
// entao o deslocamento sai de uma ancora: o primeiro registro achado corresponde a
// uma linha conhecida, informada pelo chamador ou deduzida.
import fs from 'fs';
import { blocoUnidades, detectarPrefixo, extrairUnidades } from './unidades.mjs';
const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';

export function ordem(arquivo) {
  const bl = blocoUnidades(S + arquivo);
  const pre = detectarPrefixo(bl);
  const vis = new Set(); const lin = [];
  extrairUnidades(bl, pre.prefixo).filter((x) => x.offset + 19 <= bl.length)
    .sort((a, b) => a.offset - b.offset)
    .forEach((x) => { if (vis.has(x.offset)) return; vis.add(x.offset); lin.push({ id: x.id, off: x.offset }); });
  // maior corrida de ids crescentes
  const runs = []; let g = [];
  for (const x of lin) { if (g.length && (x.id < g[g.length-1].id || x.id - g[g.length-1].id > 4)) { runs.push(g); g = []; } g.push(x); }
  runs.push(g);
  const cat = runs.sort((a, b) => b.length - a.length)[0];
  const m = new Map(); cat.forEach((x) => m.set(x.id, x.off));
  return { bl, m, idIni: cat[0].id, idFim: cat[cat.length-1].id, n: cat.length };
}

// A OOB e gravada em pre-ordem, que e exatamente a ordem em que a arvore aparece na tela.
// Entao a sequencia de linhas e a ordem de OFFSET, nao a de id. Usar id so funciona por
// coincidencia dentro de uma corrida; um cenario com aviacao e fortificacoes tem um segundo
// trecho de ids (na Ucrania, 1640..2102) que a heuristica da maior corrida jogava fora.
// Aqui as corridas curtas (lixo do extrator) caem e as demais ficam, na ordem do arquivo.
export function ordemCompleta(arquivo, minRun = 20) {
  const bl = blocoUnidades(S + arquivo);
  const pre = detectarPrefixo(bl);
  const vis = new Set(); const lin = [];
  extrairUnidades(bl, pre.prefixo).filter((x) => x.offset + 19 <= bl.length)
    .sort((a, b) => a.offset - b.offset)
    .forEach((x) => { if (vis.has(x.offset)) return; vis.add(x.offset); lin.push({ id: x.id, off: x.offset }); });
  // Nos cenarios de fabrica o extrator devolve blocos inteiros com o mesmo id repetido — no
  // "Into the Breach" sao 105 registros seguidos dizendo id 4877. Isso e erro de leitura, nao
  // dado: no arquivo o id e praticamente unico por registro. Esse lixo fica intercalado na
  // ordem de offset e parte as corridas reais em pedacos, entao sai antes de montar as corridas.
  const quantos = new Map();
  lin.forEach((x) => quantos.set(x.id, (quantos.get(x.id) || 0) + 1));
  const limpo = lin.filter((x) => quantos.get(x.id) <= 4);
  const runs = []; let g = [];
  for (const x of limpo) { if (g.length && (x.id <= g[g.length-1].id || x.id - g[g.length-1].id > 4)) { runs.push(g); g = []; } g.push(x); }
  runs.push(g);
  const bons = runs.filter((r) => r.length >= minRun);
  const linhas = [];
  bons.forEach((r, i) => { if (i) linhas.push(null); r.forEach((x) => linhas.push(x)); });
  return { bl, linhas, corridas: bons.map((r) => `${r[0].id}..${r[r.length-1].id} (${r.length})`) };
}
