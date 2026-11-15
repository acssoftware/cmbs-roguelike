// Gera lotes de mapeamento de UNIDADES (nao formacoes) sobre ZZ CAV.btt.
//
// Por que este cenario: com a arvore no estado em que o editor a abre, 34 registros de
// UNIDADE ficam visiveis na tela, contra apenas 6 de formacao. O mesmo esforco de captura
// rende cinco vezes mais. As linhas saem na ordem do arquivo (pre-ordem), entao a posicao
// na tela determina o registro sem ambiguidade.
//
// Cada slot e sondado DENTRO DA SUA PROPRIA TABELA (+18 preservado): assim um lote avanca
// as cinco tabelas de unidade ao mesmo tempo.
import fs from 'fs';
import { analisar, blocoUnidades } from './unidades.mjs';
import { reconstruir } from './rebuild.mjs';

const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';
const ENSAIO = 'ZZ CAV.btt';
const PROG = '../../research/progresso_mapeamento.json';

// ids na ordem em que aparecem na tela, do topo para baixo
export const VISIVEIS = [
  1630, 1631, 1632, 1633, 1634, 1635,               // unidades da raiz          (linhas 2..7)
  1637, 1638, 1639, 1640, 1641, 1642,               // unidades do slot 0        (linhas 9..14)
  1644, 1645, 1646, 1647, 1648, 1649, 1650, 1651, 1652, 1653,   // slot 1        (linhas 16..25)
  1655, 1656, 1657, 1658, 1659, 1660, 1661, 1662, 1663, 1664,   // slot 2        (linhas 27..36)
  1676, 1677,                                       // anexos do slot 0          (linhas 38..39)
];

const chave = (v) => '0x' + v.toString(16).padStart(2, '0');

export function gerarLoteUnidade(nome, conversoes = {}) {
  const r = analisar(S + ENSAIO), bl = blocoUnidades(S + ENSAIO);
  const porId = new Map(r.unidades.map((u) => [u.id, u]));
  const p = JSON.parse(fs.readFileSync(PROG, 'utf8'));

  // fila de pendentes por tabela: 0x00..0xff menos o que ja foi lido, descartado ou reservado
  const fila = {};
  const pendentes = (tab) => {
    const k = chave(tab);
    if (fila[k]) return fila[k];
    const feitos = new Set([...(p.lidos[k] || []), ...(p.descartados?.[k] || [])]);
    (p.lotes || []).forEach((l) => (l.plano || []).forEach((x) => {
      if (x.tabela === tab && x.linha !== undefined) feitos.add(x.escrito);   // linha 0 e falsy
    }));
    return (fila[k] = [...Array(256).keys()].filter((v) => !feitos.has(v)));
  };

  const plano = [];
  reconstruir(S + ENSAIO, S + nome, (bloco, i) => {
    if (i !== 1) return bloco;
    const c = Buffer.from(bloco);
    VISIVEIS.forEach((id, linha) => {
      const u = porId.get(id);
      if (!u) return;
      const conv = conversoes[id];
      const tab = conv ? conv.tabela : bl[u.offset + 18];
      const val = conv ? conv.valor : pendentes(tab).shift();
      if (val === undefined) return;
      c[u.offset + 17] = val;
      c[u.offset + 18] = tab;
      plano.push({ linha, id, tabela: tab, antes: bl[u.offset + 17], escrito: val,
                   conversao: conv ? `era 0x${bl[u.offset + 18].toString(16)}` : undefined });
    });
    return c;
  });

  p.lotes.push({ arquivo: nome, tipo: 'unidade', quando: new Date().toISOString(), plano });
  fs.writeFileSync(PROG, JSON.stringify(p, null, 1));
  return plano;
}

const EH_MAIN = process.argv[1] && /[\\/]unidade\.mjs$/.test(process.argv[1]);
if (EH_MAIN && process.argv[2]) {
  // O primeiro lote leva um TESTE DE CONVERSAO: dois slots da tabela 0x05 recebem valores
  // ja conhecidos da 0x04. Se aparecerem com os nomes da 0x04, da para remanejar slots
  // entre tabelas e equilibrar o ritmo (a 0x05 tem 18 slots, a 0x04 so 8).
  const conv = process.argv[3] === 'conv'
    ? { 1663: { tabela: 0x04, valor: 0x26 }, 1664: { tabela: 0x04, valor: 0x28 } } : {};
  const plano = gerarLoteUnidade(process.argv[2], conv);
  const porTab = {};
  plano.forEach((x) => { (porTab[chave(x.tabela)] = porTab[chave(x.tabela)] || []).push(x); });
  console.log(`${process.argv[2]}  —  ${plano.length} sondas\n`);
  plano.forEach((x) => console.log(
    `   linha ${String(x.linha + 2).padStart(2)}  id ${x.id}  tabela ${chave(x.tabela)}  0x${x.antes.toString(16).padStart(2, '0')} -> ${chave(x.escrito)}${x.conversao ? '   << conversao (' + x.conversao + ')' : ''}`));
  console.log(`\npor tabela: ${Object.entries(porTab).map(([k, v]) => `${k}=${v.length}`).join('  ')}`);
}
