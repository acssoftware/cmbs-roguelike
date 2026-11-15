// Gerador de lote generico: sonda tabelas escolhidas numa ordem de batalha qualquer.
// Substitui unidade.mjs e infprobe.mjs, que eram amarrados a um cenario so.
//
// Descoberta que motivou: as tabelas sao POR LADO. O batalhao americano/ucraniano usa
// 0x04 (infantaria), 0x05 (veiculos), 0x0d (equipes), 0x19 (formacoes). O russo usa
// 0x07 (equipes), 0x0b (formacoes), 0x00 (veiculos). Por isso 0x07/0x0b/0x0e/0x1a nunca
// apareceram em nenhum cenario azul.
import fs from 'fs';
import { blocoUnidades } from './unidades.mjs';
import { reconstruir } from './rebuild.mjs';
import { ordemDeBatalha } from './inf.mjs';

const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';
const PROG = '../../research/progresso_mapeamento.json';
const pares = JSON.parse(fs.readFileSync('../../research/cmbs_pares_v2.json', 'utf8'));

export function sondar({ base, saida, idIni, idFim, deslocTela, tabelas }) {
  const linhas = ordemDeBatalha(base, idIni, idFim);
  const p = JSON.parse(fs.readFileSync(PROG, 'utf8'));
  const fila = {};
  for (const tab of tabelas) {
    const k = '0x' + tab.toString(16).padStart(2, '0');
    const feitos = new Set([...(p.lidos[k] || []), ...(p.descartados[k] || [])]);
    (p.lotes || []).forEach((l) => (l.plano || []).forEach((x) => {
      if (x.tabela === tab && x.linha !== undefined) feitos.add(x.escrito);
    }));
    // PRIORIDADE: primeiro os valores que os cenarios de fabrica realmente usam, em ordem
    // de quantas unidades cada um representa. Esses sao validos por construcao — o jogo os
    // usa. Varrer 0x00..0xff em ordem crescente desperdicava lotes inteiros no trecho morto
    // das tabelas (ZZ RED 01: 0 validos em 74, todos na faixa baixa).
    const usados = pares.filter((x) => parseInt(x.par.split('/')[1], 16) === tab)
      .sort((a2, b2) => b2.n - a2.n).map((x) => parseInt(x.par.split('/')[0], 16))
      .filter((v) => !feitos.has(v));
    const resto = [...Array(256).keys()].filter((v) => !feitos.has(v) && !usados.includes(v));
    fila[tab] = [...usados, ...resto];
  }
  const plano = [];
  reconstruir(S + base, S + saida, (bloco, i) => {
    if (i !== 1) return bloco;
    const c = Buffer.from(bloco);
    linhas.forEach((x, idx) => {
      if (x.tab === null || !tabelas.includes(x.tab)) return;
      const v = fila[x.tab].shift();
      if (v === undefined) return;
      c[x.off + 17] = v;
      plano.push({ linha: idx, tela: idx + deslocTela, id: x.id, tabela: x.tab, antes: x.val, escrito: v });
    });
    return c;
  });
  // conferencia obrigatoria: so os bytes planejados podem ter mudado
  const b0 = blocoUnidades(S + base), b1 = blocoUnidades(S + saida);
  const alvo = new Set(plano.map((x) => linhas[x.linha].off + 17));
  let dif = 0, fora = 0;
  for (let i = 0; i < Math.min(b0.length, b1.length); i++)
    if (b0[i] !== b1[i]) { dif++; if (!alvo.has(i)) fora++; }
  if (fora) throw new Error(`${saida}: ${fora} bytes alterados FORA do plano — abortado`);
  p.lotes.push({ arquivo: saida, tipo: 'sonda', base, idIni, idFim, deslocTela, quando: new Date().toISOString(), plano });
  fs.writeFileSync(PROG, JSON.stringify(p, null, 1));
  return { plano, dif };
}
