// Gera um cenario com valores de tipo escritos em varios veiculos, para mapear
// o catalogo de unidades por observacao no editor do jogo.
//
// O tipo da unidade e o par (+17, +18) do registro:
//   +18 seleciona a tabela, +17 o indice dentro dela.
// Descoberto por bisseção com teste de escrita (ver research/FORMATO.md).
import fs from 'fs';
import { analisar, blocoUnidades } from './unidades.mjs';
import { reconstruir } from './rebuild.mjs';

export function gerar(origem, destino, valores, tabela) {
  const r = analisar(origem);
  const bl = blocoUnidades(origem);
  // alvos: veiculos conhecidos por responderem a escrita
  const alvos = r.unidades.filter((x) => x.tipo === 3387 || x.tipo === 3375)
    .sort((a, b) => a.offset - b.offset);
  reconstruir(origem, destino, (bloco, i) => {
    if (i !== 1) return bloco;
    const c = Buffer.from(bloco);
    alvos.forEach((a, k) => {
      if (k >= valores.length) return;
      c[a.offset + 17] = valores[k];
      if (tabela !== undefined) c[a.offset + 18] = tabela;
    });
    return c;
  });
  return alvos.slice(0, valores.length).map((a, k) => ({
    ordem: k + 1, id: a.id, valor: valores[k], tabela,
  }));
}

const EH_MAIN = process.argv[1] && /[\\/]mapear\.mjs$/.test(process.argv[1]);
if (EH_MAIN && process.argv[2]) {
  const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';
  const ini = parseInt(process.argv[2], 16);
  const tab = process.argv[3] !== undefined ? parseInt(process.argv[3], 16) : undefined;
  const valores = [0, 1, 2, 3, 4, 5].map((k) => ini + k);
  const nome = `ZZ MAPA ${ini.toString(16).toUpperCase()}${tab !== undefined ? '-T' + tab.toString(16) : ''}.btt`;
  const info = gerar(S + 'ZZ GT E.btt', S + nome, valores, tab);
  console.log(`${nome}${tab !== undefined ? `   (+18 fixo em 0x${tab.toString(16)})` : ''}\n`);
  console.log('  posicao na arvore                              +17');
  const onde = ['1st Platoon (Rifle)', 'nivel da companhia (apos Tunguska)',
    'Grenade Launcher Platoon, 1o veiculo', 'Grenade Launcher Platoon, 2o',
    'Grenade Launcher Platoon, 3o', 'Grenade Launcher Platoon, 4o'];
  info.forEach((x) => console.log(`  ${onde[x.ordem - 1].padEnd(44)} 0x${x.valor.toString(16)} (${x.valor})`));
}
