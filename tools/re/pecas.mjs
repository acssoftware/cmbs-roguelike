// AS PECAS FORA DO MAPA COM O PAR DE UM VEICULO (25/11/2026). O par (val, tab) de um registro nao e unico no jogo: a
// CATEGORIA do registro (+12) decide o que ele e. [58,0] na categoria 0x10 seria o BMP-3M; na 0x50 (fora do mapa) e na
// 0x90 (peca organica, sem posicao) e o "3 x 82mm Mortar (2B14)". `tipos_roster.json` tem uma linha por par — a do
// veiculo —, entao quem monta uma linha de roster pergunta aqui primeiro. Ver `research/tipos_pecas.json`.
import fs from 'node:fs';

export const CATEGORIAS_DE_PECA = new Set([0x50, 0x58, 0x90]);

let cache = null;
function tabela() {
  if (cache) return cache;
  try {
    const t = JSON.parse(fs.readFileSync(new URL('../../research/tipos_pecas.json', import.meta.url), 'utf8'));
    cache = new Map((t.pecas || []).map((p) => [`${p.val},${p.tab}`, p]));
  } catch { cache = new Map(); }
  return cache;
}

// A linha de roster da peca, ou null quando o registro nao e uma das pecas em colisao. Os 3 bits baixos de +12 sao o
// grupo de reforco (FORMATO 127) e nao mudam o que a unidade e. As categorias de cada peca sao as OBSERVADAS na
// biblioteca: o 0x90 e a categoria da Battery (Mortar) organica inteira (quartel-general, caminhoes, 2S24), entao so a
// colisao conhecida naquela categoria vale ([58,0]); o M1126 Stryker de verdade e 0x10.
export function pecaDoPar(val, tab, categoria) {
  const cat = categoria & 0xf8;
  if (!CATEGORIAS_DE_PECA.has(cat)) return null;
  const p = tabela().get(`${val},${tab}`);
  return p && (p.categorias || [...CATEGORIAS_DE_PECA]).includes(cat) ? p : null;
}

// O bloco do JOGO para a peca (o caminho do save, roster.crescerRoster): o bloco colhido da irma de 6 pecas, com o
// tipo trocado. `doadores` e o Map tipo -> Buffer da colheita.
export function blocoDaIrma(peca, doadores) {
  const b = peca && doadores.get(peca.irma);
  if (!b) return null;
  const c = Buffer.from(b); c.writeUInt16LE(peca.tipo, 4); return c;
}
