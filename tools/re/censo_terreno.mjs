// O QUE CADA VALOR DE TERRENO E, pelo COMPORTAMENTO dele nos mapas que o jogo traz (E85).
//
// Por que existe: o Mucuge saiu com a cidade ALAGADA. Eu tinha chamado o valor 28 de "terreiro" a
// partir de um histograma — "aparece em mapa de vila" — e ele e agua: o autor abriu a previa 3-D e
// a cidade era um espelho, com uma margem ingreme em volta de cada tile (que eu tinha lido como
// "o rio virou canion"). Um histograma diz ONDE um valor aparece, nao O QUE ele e.
//
// Aqui cada valor ganha uma ficha de comportamento, que e o que separa as familias sem abrir o jogo:
//   agua        plana (degrau ~0 para os vizinhos do mesmo valor), NUNCA tem casa em cima, quase
//               nunca tem estrada, e se concentra em mapa com "Water" no nome;
//   chao urbano e o que esta SOB AS CASAS e ao lado das ruas;
//   mata        carrega folhagem; lavoura vem em manchas grandes em mapa aberto.
// O nome exato de cada valor (os 38 itens de Ground #1/#2/#3) so sai PINTANDO a paleta no editor —
// isto aqui e para nao escrever agua na cidade enquanto essa etapa nao roda.
//
//   node tools/re/censo_terreno.mjs            a ficha de cada valor
//   node tools/re/censo_terreno.mjs --gravar   escreve research/terreno_censo.json
import fs from 'node:fs';
import path from 'node:path';
import { lerMapa, lerGrade } from './mapa.mjs';
import { lerElevacao } from './mapa_escrever.mjs';

const RAIZ = path.resolve(import.meta.dirname, '../..');
const PASTAS = ['assets/qb_probe', 'assets/qb_assault', 'assets/qb_attack', 'assets/qb_meeting'].map((p) => path.join(RAIZ, p)).filter((p) => fs.existsSync(p));

const vistos = new Set();
const ficha = new Map();
const nova = () => ({ tiles: 0, mapas: 0, mapasAgua: 0, mapasCidade: 0, comCasa: 0, comEstrada: 0, comFolhagem: 0, degrau: 0, pares: 0, noMinimo: 0 });
let lidos = 0;
for (const pasta of PASTAS) {
  for (const nome of fs.readdirSync(pasta).filter((f) => f.endsWith('.btt'))) {
    // o mesmo mapa existe como Probe/Assault/Attack: a grade e a mesma, conta uma vez
    const chave = nome.replace(/\s+(Probe|Assault|Attack|Meeting Engagement|ME)\.btt$/i, '');
    if (vistos.has(chave)) continue;
    let m; try { m = lerMapa(path.join(pasta, nome)); } catch { continue; }
    if (!m.iaConfere) continue;
    vistos.add(chave); lidos++;
    const g = lerGrade(m), e = lerElevacao(m);
    const casas = new Set(m.construcoes.map((k) => `${k.tileX},${k.tileY}`));
    const agua = /water/i.test(nome), cidade = /city|town|village/i.test(nome);
    let hMin = Infinity; for (let x = 0; x < m.W; x++) for (let y = 0; y < m.H; y++) hMin = Math.min(hMin, e.em(x, y));
    const noMapa = new Set();
    for (let x = 0; x < m.W; x++) for (let y = 0; y < m.H; y++) {
      const t = g.tile(x, y); const v = t.tipo;
      if (!ficha.has(v)) ficha.set(v, nova());
      const f = ficha.get(v); f.tiles++; noMapa.add(v);
      if (casas.has(`${x},${y}`)) f.comCasa++;
      if (t.estrada) f.comEstrada++;
      if (t.foliage) f.comFolhagem++;
      if (e.em(x, y) - hMin < 1) f.noMinimo++;
      // o degrau para o vizinho da direita, so quando ele e do MESMO valor: mede o quanto o valor e plano
      if (x + 1 < m.W && g.tile(x + 1, y).tipo === v) { f.degrau += Math.abs(e.em(x, y) - e.em(x + 1, y)); f.pares++; }
    }
    for (const v of noMapa) { const f = ficha.get(v); f.mapas++; if (agua) f.mapasAgua++; if (cidade) f.mapasCidade++; }
  }
}

const linhas = [...ficha].map(([v, f]) => ({
  valor: v, tiles: f.tiles, mapas: f.mapas,
  pctMapasAgua: f.mapas ? f.mapasAgua / f.mapas : 0, pctMapasCidade: f.mapas ? f.mapasCidade / f.mapas : 0,
  casaPorMil: 1000 * f.comCasa / f.tiles, pctEstrada: f.comEstrada / f.tiles, pctFolhagem: f.comFolhagem / f.tiles,
  degrau: f.pares ? f.degrau / f.pares : null, pctNoMinimo: f.noMinimo / f.tiles,
})).sort((a, b) => a.valor - b.valor);

// A FAMILIA, pela ficha. Conservador de proposito: "agua" so quando e plana E nunca tem casa.
for (const l of linhas) {
  l.familia = l.tiles < 200 ? 'raro'
    : (l.degrau !== null && l.degrau < 0.02 && l.casaPorMil < 0.05) ? 'AGUA'
    : (l.degrau !== null && l.degrau < 0.08 && l.casaPorMil < 0.05 && l.pctMapasAgua > 0.5) ? 'agua/vau/brejo'
    : l.casaPorMil > 8 ? 'CHAO URBANO'
    : l.pctFolhagem > 0.6 ? 'mata'
    : 'campo';
}

console.log(`${lidos} mapas distintos lidos\n`);
console.log('valor   tiles  mapas  %agua %cidade  casa/mil  %estr  %folh  degrau(m)  %no fundo   familia');
for (const l of linhas) {
  if (l.tiles < 50) continue;
  console.log(`${String(l.valor).padStart(4)} ${String(l.tiles).padStart(8)} ${String(l.mapas).padStart(5)}  ${(100 * l.pctMapasAgua).toFixed(0).padStart(4)}  ${(100 * l.pctMapasCidade).toFixed(0).padStart(5)}  ${l.casaPorMil.toFixed(2).padStart(8)}  ${(100 * l.pctEstrada).toFixed(0).padStart(4)}  ${(100 * l.pctFolhagem).toFixed(0).padStart(4)}  ${(l.degrau === null ? '-' : l.degrau.toFixed(3)).padStart(8)}  ${(100 * l.pctNoMinimo).toFixed(0).padStart(7)}     ${l.familia}`);
}
if (process.argv.includes('--gravar')) {
  const saida = path.join(RAIZ, 'research/terreno_censo.json');
  fs.writeFileSync(saida, JSON.stringify({
    nota: 'Ficha de COMPORTAMENTO de cada valor de terreno (byte 0 da grade) nos mapas de Quick Battle do jogo: o quanto e plano, se tem casa em cima, estrada, folhagem, e em que mapas aparece. Serve para separar FAMILIAS (agua / chao urbano / mata / campo), nao para dar nome: o nome exato de cada valor so sai pintando a paleta no editor. Refazer com: node tools/re/censo_terreno.mjs --gravar',
    mapas: lidos, valores: linhas,
  }, null, 1) + '\n');
  console.log(`\n-> ${saida}`);
}
