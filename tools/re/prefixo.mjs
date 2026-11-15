// Deteccao de prefixo por CATALOGO, para cenarios pequenos.
//
// detectarPrefixo() escolhe o byte que produz mais ids plausiveis. Isso funciona quando a
// ordem de batalha e grande, e falha quando ela e pequena: no ZZ AM ONLY LRS, que tem seis
// registros, o prefixo verdadeiro perde para o 0x00 no ruido de fundo. Como agora existe um
// catalogo completo de tipos, da para usar um criterio muito mais forte: a PROPORCAO de
// registros daquele prefixo cujo par (+17,+18) existe no catalogo. Proporcao, e nao contagem:
// o byte 0x00 aparece em centenas de posicoes e acerta 75% delas por forca bruta, enquanto o
// prefixo verdadeiro acerta quase 100% das poucas que tem.
import fs from 'fs';

const R = '../../research';
const hx = (v) => '0x' + v.toString(16).padStart(2, '0');
const TAM_MAX = 16, ID_MIN = 50, ID_MAX = 20000;
const MIN_REG = 5;      // uma ordem de batalha minima ainda tem meia duzia de registros

// A maior sequencia de registros com id crescente e tipo valido, na ordem do arquivo.
function maiorCorrida(bloco, pref, t) {
  const regs = [];
  for (let tam = 1; tam <= TAM_MAX; tam++) {
    const p = Buffer.from([pref, tam, 0]);
    let i = 0;
    while ((i = bloco.indexOf(p, i)) !== -1) {
      for (const desloc of [0, 4]) {
        const o = i + desloc;
        if (o + 19 > bloco.length) continue;
        const id = bloco.readUInt32LE(o + 3);
        if (!(id > ID_MIN && id < ID_MAX)) continue;
        if (!t.tabelas[hx(bloco[o + 18])]?.[hx(bloco[o + 17])]) break;
        regs.push({ i, id }); break;
      }
      i++;
    }
  }
  regs.sort((a, b) => a.i - b.i);
  let melhor = 0, n = 0, ant = -1;
  for (const x of regs) {
    if (x.id > ant && x.id - ant <= 4) n++; else n = 1;
    ant = x.id; if (n > melhor) melhor = n;
  }
  return melhor;
}

export function prefixoPorCatalogo(bloco) {
  const t = JSON.parse(fs.readFileSync(`${R}/tipos_confirmados.json`, 'utf8'));
  let melhor = { prefixo: null, bons: 0, total: 0, taxa: 0, corrida: 0 };
  for (let pref = 0; pref < 256; pref++) {
    let bons = 0, total = 0;
    for (let tam = 1; tam <= TAM_MAX; tam++) {
      const p = Buffer.from([pref, tam, 0]);
      let i = 0;
      while ((i = bloco.indexOf(p, i)) !== -1) {
        for (const desloc of [0, 4]) {
          const o = i + desloc;
          if (o + 19 > bloco.length) continue;
          const id = bloco.readUInt32LE(o + 3);
          if (!(id > ID_MIN && id < ID_MAX)) continue;
          total++;
          if (t.tabelas[hx(bloco[o + 18])]?.[hx(bloco[o + 17])]) bons++;
          break;
        }
        i++;
      }
    }
    if (total < MIN_REG) continue;
    // Proporcao sozinha ainda elege falso vencedor: o 0x01 acerta 155 de 155 por acaso. O que
    // so o prefixo verdadeiro produz e ESTRUTURA — uma corrida longa de ids crescentes, que e
    // como a ordem de batalha e serializada. O criterio final e o tamanho dessa corrida.
    const corrida = maiorCorrida(bloco, pref, t);
    if (corrida > melhor.corrida) melhor = { prefixo: pref, bons, total, taxa: +(bons / total).toFixed(3), corrida };
  }
  return melhor;
}

const EH_MAIN = process.argv[1] && /[\\/]prefixo\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const { blocoUnidades, detectarPrefixo } = await import('./unidades.mjs');
  const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';
  for (const f of process.argv.slice(2)) {
    const bl = blocoUnidades(S + f);
    const velho = detectarPrefixo(bl), novo = prefixoPorCatalogo(bl);
    console.log(`${f.padEnd(22)} antigo 0x${velho ? velho.prefixo.toString(16) : '?'} | novo 0x${novo.prefixo?.toString(16)} — corrida de ${novo.corrida} ids crescentes, ${novo.bons}/${novo.total} com tipo valido`);
  }
}
