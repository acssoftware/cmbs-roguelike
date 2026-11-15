// Lotes de sondagem sobre ZZ INF.btt (batalhao de infantaria dos EUA).
//
// Por que este cenario e melhor que ZZ CAV para as tabelas de equipe: a arvore tem 172
// linhas, TODA expandida, e cabe em quatro telas contiguas. Slots por tabela:
//    0x0d = 67   0x04 = 39   0x05 = 29   0x00 = 9   0x0f = 3
// contra 5, 8, 18, 2 e 1 do ZZ CAV. As duas tabelas que ainda rendem (0x0d e 0x04)
// andam 13x e 5x mais rapido.
import fs from 'fs';
import { blocoUnidades } from './unidades.mjs';
import { reconstruir } from './rebuild.mjs';
import { ordemDeBatalha } from './inf.mjs';

const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';
const PROG = '../../research/progresso_mapeamento.json';
const SONDAR = [0x0d, 0x04, 0x00, 0x0f];      // a 0x05 esta quase esgotada; fica de fora

export function gerar(nome) {
  const linhas = ordemDeBatalha('ZZ INF.btt', 1751, 1922);
  const bl = blocoUnidades(S + 'ZZ INF.btt');
  const p = JSON.parse(fs.readFileSync(PROG, 'utf8'));
  const fila = {};
  for (const tab of SONDAR) {
    const k = '0x' + tab.toString(16).padStart(2, '0');
    const feitos = new Set([...(p.lidos[k] || []), ...(p.descartados[k] || [])]);
    (p.lotes || []).forEach((l) => (l.plano || []).forEach((x) => {
      if (x.tabela === tab && x.linha !== undefined) feitos.add(x.escrito);
    }));
    fila[tab] = [...Array(256).keys()].filter((v) => !feitos.has(v));
  }
  const plano = [];
  reconstruir(S + 'ZZ INF.btt', S + nome, (bloco, i) => {
    if (i !== 1) return bloco;
    const c = Buffer.from(bloco);
    linhas.forEach((x, idx) => {
      if (x.tab === null || !SONDAR.includes(x.tab)) return;
      const v = fila[x.tab].shift();
      if (v === undefined) return;
      c[x.off + 17] = v;
      plano.push({ linha: idx, tela: idx + 2, id: x.id, tabela: x.tab, antes: x.val, escrito: v });
    });
    return c;
  });
  p.lotes.push({ arquivo: nome, tipo: 'inf', quando: new Date().toISOString(), plano });
  fs.writeFileSync(PROG, JSON.stringify(p, null, 1));
  return plano;
}

const EH_MAIN = process.argv[1] && /[\\/]infprobe\.mjs$/.test(process.argv[1]);
if (EH_MAIN && process.argv[2]) {
  const plano = gerar(process.argv[2]);
  const t = {};
  plano.forEach((x) => { const k = '0x' + x.tabela.toString(16).padStart(2, '0'); (t[k] = t[k] || []).push(x.escrito); });
  console.log(`${process.argv[2].replace('.btt', '')}  —  ${plano.length} sondas`);
  Object.entries(t).sort().forEach(([k, v]) =>
    console.log(`   ${k}: ${v.length} valores  (0x${v[0].toString(16)}..0x${v[v.length-1].toString(16)})`));
}
