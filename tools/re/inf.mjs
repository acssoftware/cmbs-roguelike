// Ordem de batalha completa de ZZ INF.btt, linha a linha, na ordem da tela.
//
// O varredor por padrao de bytes de unidades.mjs perde registros cujo id termina em 0x00
// (o byte zero do id se confunde com o separador do cabecalho). Como os ids da ordem de
// batalha sao SEQUENCIAIS, da para achar cada faltante procurando o u32 do id entre os
// offsets dos vizinhos: o registro comeca em idPos-3 e o par de tipo fica em idPos+14/+15.
import fs from 'fs';
import { analisar, blocoUnidades } from './unidades.mjs';

const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';

export function ordemDeBatalha(arquivo, idIni, idFim) {
  const r = analisar(S + arquivo), bl = blocoUnidades(S + arquivo);
  // Um id pode casar em mais de um lugar do bloco — o varredor e por padrao de bytes e
  // ha coincidencias fora da ordem de batalha. Ela e um bloco CONTIGUO e crescente, entao
  // so vale o candidato que continua a sequencia. Sem esse filtro, um casamento distante
  // faz a sonda escrever num byte que nao e de unidade e o jogo trava ao carregar.
  const cands = new Map();
  r.unidades.filter((x) => x.offset + 19 <= bl.length && x.id >= idIni && x.id <= idFim)
    .forEach((x) => { if (!cands.has(x.id)) cands.set(x.id, []); cands.get(x.id).push(x.offset); });
  const base = [...cands.values()].flat().sort((a, b) => a - b);
  const mediana = base[Math.floor(base.length / 2)];
  const JANELA = 40000;
  const porId = new Map();
  let ultimo = 0;
  for (let id = idIni; id <= idFim; id++) {
    const c = (cands.get(id) || []).filter((o) => Math.abs(o - mediana) < JANELA && o > ultimo - 64);
    if (!c.length) continue;
    const esc = c.sort((a, b) => a - b)[0];
    porId.set(id, esc); ultimo = esc;
  }
  const linhas = [];
  for (let id = idIni; id <= idFim; id++) {
    let off = porId.get(id);
    if (off === undefined) {
      const alvo = Buffer.alloc(4); alvo.writeUInt32LE(id);
      const antes = porId.get(id - 1), depois = porId.get(id + 1);
      let i = (antes ?? 0);
      const lim = depois ?? (antes + 4096);
      while ((i = bl.indexOf(alvo, i)) !== -1 && i < lim) {
        const t = bl[i + 15];
        if (t <= 0x1a || t === 0x41 || t === 0x45 || t === 0x65) { off = i - 3; break; }
        i++;
      }
    }
    if (off === undefined) { linhas.push({ id, tab: null, val: null }); continue; }
    linhas.push({ id, off, tab: bl[off + 18], val: bl[off + 17] });
  }
  return linhas;
}

const EH_MAIN = process.argv[1] && /[\\/]inf\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const linhas = ordemDeBatalha('ZZ INF.btt', 1751, 1922);
  fs.writeFileSync('../../research/inf_ordem.json', JSON.stringify(linhas));
  const faltam = linhas.filter((x) => x.tab === null);
  const porTab = {}; linhas.forEach((x) => { if (x.tab !== null) porTab[x.tab] = (porTab[x.tab] || 0) + 1; });
  console.log(`${linhas.length} linhas (ids 1751..1922) | ${faltam.length} nao localizadas`);
  console.log('\nslots por tabela:');
  Object.entries(porTab).sort((a, b) => a[0] - b[0]).forEach(([t, n]) =>
    console.log(`   0x${(+t).toString(16).padStart(2, '0')}: ${String(n).padStart(3)}`));
}
