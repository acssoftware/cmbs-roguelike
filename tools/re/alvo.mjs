// Casamento DIRIGIDO: em vez de alinhar a arvore inteira, ancora na vizinhanca imediata de
// cada valor que ainda nao tem nome.
//
// Nos cenarios de fabrica a arvore costuma estar PARCIALMENTE RECOLHIDA — formacoes com "+"
// escondem os filhos —, entao a tela nao e linha-a-linha com o arquivo e o alinhamento global
// nao fecha. Mas o bloco em volta do alvo quase sempre esta expandido, e ali as linhas do
// arquivo e as da tela batem uma a uma. Basta procurar, em cada captura, a posicao em que os
// vizinhos JA CONHECIDOS do alvo casam; a linha da tela que sobra na casa do alvo e o nome.
import fs from 'fs';
import { ordemCompleta } from './oob.mjs';
import { igual } from './casar.mjs';

const R = '../../research';
const hx = (v) => '0x' + v.toString(16).padStart(2, '0');
const RAIO = 16;       // ate quantas linhas de cada lado do alvo a corrida pode crescer
const MIN_ANC = 5;     // ancoras minimas para aceitar o encaixe


const FORT = /trench|sandbag|barbed wire|\bmines\b|target reference|bunker|foxhole|roadblock|obstacle|rubble/i;
const CABECA = new Set([0x19, 0x0b, 0x1a, 0x18]);

export function mirar(arquivo, cen) {
  const t = JSON.parse(fs.readFileSync(`${R}/tipos_confirmados.json`, 'utf8'));
  const { bl, linhas } = ordemCompleta(arquivo, 6);
  const chaveDe = (o) => `${hx(bl[o + 18])}/${hx(bl[o + 17])}`;
  const geral = (o) => t.tabelas[hx(bl[o + 18])]?.[hx(bl[o + 17])];

  // Debaixo de uma formacao de fortificacao o nome das tabelas gerais e o nome ERRADO — e o
  // que aparece na tela vem do catalogo proprio. Usar o geral como ancora ali nao so falha,
  // como falha silenciosamente: a janela inteira e reprovada sem dizer por que.
  const ehFort = new Array(linhas.length).fill(false);
  let sob = false;
  linhas.forEach((L, i) => {
    if (!L) { sob = false; return; }
    if (CABECA.has(bl[L.off + 18])) { sob = FORT.test(geral(L.off) || ''); return; }
    ehFort[i] = sob;
  });
  // Isso so pega o bloco cujo cabecalho JA tem nome. Quando o proprio cabecalho e o alvo
  // (Gagarina, Platoon House), o bloco passa despercebido e os filhos entram como ancora com
  // o nome errado — a corrida morre na primeira comparacao e o alvo fica sem encaixe nenhum.
  // A forma denuncia o bloco sem precisar do nome: cabecalho seguido de seis ou mais linhas
  // com o MESMO (tabela, indice). Fora de fortificacao isso quase nao acontece; um pelotao de
  // fuzileiros tem tres esquadras iguais, nao dez.
  for (let i = 1; i < linhas.length; i++) {
    const H = linhas[i - 1], L = linhas[i];
    if (!H || !L || !CABECA.has(bl[H.off + 18]) || CABECA.has(bl[L.off + 18])) continue;
    const k = chaveDe(L.off);
    let j = i; while (j < linhas.length && linhas[j] && chaveDe(linhas[j].off) === k) j++;
    if (j - i >= 6) for (let q = i; q < j; q++) ehFort[q] = true;
  }
  const nomeEm = (i) => {
    const L = linhas[i]; if (!L) return null;
    return ehFort[i] ? t.fortificacoes?.[chaveDe(L.off)] : geral(L.off);
  };
  const nome = geral;

  const caps = fs.readdirSync(`${R}/capturas_lidas`)
    .map((f) => JSON.parse(fs.readFileSync(`${R}/capturas_lidas/${f}`, 'utf8').replace(/^﻿/, '')))
    .filter((c) => c.cen === cen && c.linhas && c.linhas.length).sort((a, b) => a.n - b.n);

  const alvos = [];
  linhas.forEach((L, i) => { if (L && !nome(L.off)) alvos.push(i); });

  // Quantas linhas seguidas batem, saindo do alvo para um lado. Cresce enquanto casa e PARA
  // na primeira divergencia. E isso que aguenta o que ha de irregular nestas capturas: a
  // arvore vem parcialmente recolhida (um "+ Sniper Section" esconde tres filhos e dali para
  // frente tela e arquivo nao andam mais juntos) e o extrator parte a ordem em corridas. Nos
  // dois casos o encaixe continua valido ate o ponto de ruptura, e so ate ele.
  const correr = (c, i, k, passo) => {
    let n = 0;
    for (let d = passo; Math.abs(d) <= RAIO; d += passo) {
      if (!linhas[i + d]) break;
      const kk = k + d; if (kk < 0 || kk >= c.linhas.length) break;
      const nm = nomeEm(i + d);
      if (!nm) continue;                          // sem nome: nao da para julgar, segue
      if (!igual(nm, c.linhas[kk])) break;
      n++;
    }
    return n;
  };

  const votos = new Map();   // chave -> Map(nome -> n)
  for (const i of alvos) {
    const chave = chaveDe(linhas[i].off);
    for (const c of caps) {
      // k e a posicao que o alvo ocuparia dentro desta captura
      let melhor = null;
      for (let k = 0; k < c.linhas.length; k++) {
        const txt = c.linhas[k];
        if (!txt || txt === '?') continue;
        const antes = correr(c, i, k, -1), depois = correr(c, i, k, 1);
        // Encaixado entre acertos dos dois lados e o caso comum. Mas quando o alvo e uma
        // formacao RECOLHIDA na tela ("+ 2nd Company (Reconnaissance)"), os filhos dela estao
        // escondidos e nao existe "depois" nenhum — dai o padrao antes=8, depois=0. Uma corrida
        // longa de um lado so ja prende a posicao: se as seis linhas anteriores batem uma a uma
        // com as seis linhas anteriores do arquivo, a linha seguinte e o alvo.
        const preso = (antes >= 2 && depois >= 2 && antes + depois >= MIN_ANC) ||
                      antes >= MIN_ANC || depois >= MIN_ANC;
        if (!preso) continue;
        if (!melhor || antes + depois > melhor.tot) melhor = { k, tot: antes + depois, txt };
      }
      if (!melhor) continue;
      const lim = melhor.txt.replace(/^\+?\s*(HQ|\d+(st|nd|rd|th)|[A-H])\s+/, '')
        .replace(/^\+\s*/, '').replace(/\s*\(Off Map\)\s*$/, '').replace(/\s*\[[^\]]*\]\s*$/, '').trim();
      if (!votos.has(chave)) votos.set(chave, new Map());
      const v = votos.get(chave);
      v.set(lim, (v.get(lim) || 0) + 1);
    }
  }
  return { votos, alvos: alvos.length, caps: caps.length };
}

const PARES = [
  ['Morning Coffee.btt', 'Morning Coffee'],
  ['Gagarina Ave Checkpoint.btt', 'Gagarina Ave Checkpoint'],
  ['Bridgehead at Kharalyk.btt', 'Bridgehead at Kharalyk'],
  ["Rollin' on the River.btt", "Rollin' on the River"],
  ['BSBP 01 Honor.btt', 'BSBP 01 Honor'],
  ['Galloping Horse Downfall.btt', 'Galloping Horse Downfall'],
  ['Phase Line Green.btt', 'Phase Line Green'],
  ['Platoon House Aleksandra.btt', 'Platoon House Aleksandra'],
];

const EH_MAIN = process.argv[1] && /[\\/]alvo\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  for (const [arq, cen] of PARES) {
    let r; try { r = mirar(arq, cen); } catch (e) { console.log(`${cen}: ERRO ${e.message}`); continue; }
    const achou = [...r.votos.entries()];
    console.log(`\n${cen}  (${r.caps} capturas, ${r.alvos} linhas sem nome)`);
    if (!achou.length) { console.log('   nada encaixou'); continue; }
    achou.sort().forEach(([k, v]) => {
      const a = [...v.entries()].sort((x, y) => y[1] - x[1]);
      console.log(`   ${k}  "${a[0][0]}"  (${a[0][1]} voto${a[0][1] > 1 ? 's' : ''}${a.length > 1 ? `, divergencias: ${a.slice(1).map((x) => `"${x[0]}"x${x[1]}`).join(' ')}` : ''})`);
    });
  }
}
