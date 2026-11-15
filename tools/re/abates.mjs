// O PLACAR DE CADA UNIDADE (FORMATO 110.13, 27/09).
//
// No ultimo turno de uma batalha o jogo mostra, na ficha da unidade, "Combat Victories" (o que ela
// fez nesta batalha) e "Total Campaign Victories" (o acumulado). O acumulado mora no fim do bloco
// do roster, em TODA unidade — a pe ou maquina:
//
//     ... | u16 baixas | ff ff | u16 n | n x (u16 tipo, u16 qtd) | zeros
//
//   baixas  inimigos abatidos na campanha inteira (o "Enemy Casualties" do painel). Nas maquinas e o
//           `[x]` opcional da gramatica 110.8, que ficou sem nome desde o E38.
//   tipo    o veiculo abatido, pelo par do catalogo empacotado: `val | tab << 8` (0x0001 = 1,0
//           M1126 Stryker; 0x0546 = 70,5 BTR-4E). A lista vem ordenada por tipo.
//
// Conferido contra o painel do jogo: o BMP-2M core 42 da RUS1 diz 55 baixas, 1 Stryker e 1 BTR-4E
// no fim da batalha 3; o roster diz 55 e os dois pares, e o da batalha 2 dizia 40 e so o BTR — as 15
// da batalha sao a diferenca, que e o "Combat Victories" do print. A vitoria da batalha nao e
// gravada: sai de subtrair duas viradas.
//
// So leitura. Bloco onde o `ff ff` nao e achado fica fora (sem leitura), nunca como zero.
import { blocosDoSave } from './toe_veiculos.mjs';

export function abatesDoBloco(bytes, ff) {
  if (!(ff >= 2) || ff + 4 > bytes.length) return null;
  const baixas = bytes.readUInt16LE(ff - 2);
  const n = bytes.readUInt16LE(ff + 2);
  if (n > 64 || ff + 4 + 4 * n > bytes.length) return null;
  const veiculos = [];
  for (let k = 0; k < n; k++) {
    const tipo = bytes.readUInt16LE(ff + 4 + 4 * k);
    const qtd = bytes.readUInt16LE(ff + 6 + 4 * k);
    if (!qtd) return null;
    veiculos.push({ val: tipo & 0xff, tab: tipo >> 8, qtd });
  }
  return { baixas, veiculos };
}

// [{ coreId, baixas, veiculos: [{val, tab, qtd}] }] e a lista dos core ids sem leitura.
export function abatesDoSave(caminho) {
  const { unidades } = blocosDoSave(caminho);
  const out = [], semLeitura = [];
  for (const u of unidades) {
    const a = abatesDoBloco(u.bytes, u.ff);
    if (a) out.push({ coreId: u.coreId, ...a }); else semLeitura.push(u.coreId);
  }
  return { unidades: out, semLeitura };
}

const EH_MAIN = process.argv[1] && /[\\/]abates\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const r = abatesDoSave(process.argv[2]);
  for (const u of r.unidades.filter((x) => x.baixas || x.veiculos.length)) {
    console.log(`core ${String(u.coreId).padStart(4)}  ${String(u.baixas).padStart(4)} baixas  ${u.veiculos.map((v) => `${v.val},${v.tab} x${v.qtd}`).join('  ')}`);
  }
  console.log(`sem leitura: ${r.semLeitura.join(', ') || '-'}`);
}
