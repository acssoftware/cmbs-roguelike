// Duas formações IRMÃS de exércitos diferentes, sem substituir nada e sem aninhar uma na
// outra. Junta as duas capacidades que ja foram provadas em jogo separadamente:
//
//   duplicar formacao DENTRO do arquivo   (ZZ ENX MESMO)  — o original fica intacto
//   converter tropa por inteiro           (ZZ RU PLT FULL) — tipo em (+17,+18), exercito em +14
//
// O pelotao americano id 238 e copiado duas vezes como filho da Company (Rifle) id 249: a
// primeira copia continua americana, a segunda vira russa. Nenhuma unidade existente e
// tocada; a companhia so ganha dois filhos diretos.
import fs from 'fs';
import { analisar, blocoUnidades } from './unidades.mjs';
import { reconstruir } from './rebuild.mjs';

const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';
const MODELO = 238, MAE = 249, ANCORA = 254;

// Equivalente russo de cada posicao da TO&E americana. Nao ha correspondencia um-para-um: o
// pelotao russo nao tem observador avancado organico nem Squad (Weapons), entao o slot recebe
// o que ocupa aquela posicao do outro lado — equipe de PKM e sniper.
const RUSSO = [
  [0x54, 0x0b, 'Platoon (Rifle)'],
  [0xa9, 0x07, 'Headquarters Team'],
  [0xbc, 0x07, 'Machinegun Team (PKM)'],
  [0xdd, 0x00, 'Squad (Rifle)'],
  [0xdd, 0x00, 'Squad (Rifle)'],
  [0xdd, 0x00, 'Squad (Rifle)'],
  [0xe6, 0x07, 'Sniper Team'],
  [0xe4, 0x00, 'Squad (ATGM)'],
  [0xe4, 0x00, 'Squad (ATGM)'],
];

const bl = blocoUnidades(S + 'ZZ CONTA A.btt');
const r = analisar(S + 'ZZ CONTA A.btt');
const vis = new Set(); const L = [];
r.unidades.filter((x) => x.offset + 32 <= bl.length).sort((a, b) => a.offsetReg - b.offsetReg)
  .forEach((x) => { if (vis.has(x.offsetReg)) return; vis.add(x.offsetReg); L.push(x); });

const i = L.findIndex((x) => x.id === MODELO);
const n = bl.readUInt32LE(L[i].offset + 27);
const ini = L[i].offsetReg, fim = L[i + 1 + n].offsetReg;
const base = bl.subarray(ini, fim);
const mae = L.find((x) => x.id === MAE), anc = L.find((x) => x.id === ANCORA);
const filhos = bl.readUInt32LE(mae.offset + 27);

// Uma copia: renumera os ids, liga todas as unidades (o modelo esta mascarado no original) e,
// se for a versao russa, reescreve tipo e exercito posicao por posicao.
function copiar(idBase, converter) {
  const c = Buffer.from(base);
  L.slice(i, i + 1 + n).forEach((x, k) => {
    const dId = x.offset + 3 - ini, d7 = x.offset + 7 - ini, d14 = x.offset + 14 - ini;
    c.writeUInt32LE(idBase + k, dId);
    c[d7] &= ~0x80;                                  // presente
    if (!converter) return;
    const [val, tab] = RUSSO[k];
    c[x.offset + 17 - ini] = val;
    c[x.offset + 18 - ini] = tab;
    c[d14] = (2 << 4) | (c[d14] & 0x0f);             // exercito russo, raridade preservada
  });
  return c;
}

const trecho = Buffer.concat([copiar(500, false), copiar(510, true)]);

reconstruir(S + 'ZZ CONTA A.btt', S + 'ZZ LADO A LADO.btt', (bloco, idx) => {
  if (idx !== 1) return bloco;
  const c0 = Buffer.from(bloco);
  c0.writeUInt32LE(filhos + 2, mae.offset + 27);     // a companhia ganha DOIS filhos diretos
  c0[mae.offset + 7] &= ~0x80;                       // e passa a aparecer na arvore
  return Buffer.concat([c0.subarray(0, anc.offsetReg), trecho, c0.subarray(anc.offsetReg)]);
});

const novo = blocoUnidades(S + 'ZZ LADO A LADO.btt');
if (novo.length !== bl.length + trecho.length) throw new Error(`tamanho: ${novo.length} vs ${bl.length + trecho.length}`);
let fora = 0;
for (let k = 0; k < anc.offsetReg; k++) {
  if (bl[k] === novo[k]) continue;
  const planejado = (k >= mae.offset + 27 && k < mae.offset + 31) || k === mae.offset + 7;
  if (!planejado) fora++;
}
if (fora) throw new Error(`${fora} bytes alterados FORA do plano`);

console.log(`ZZ LADO A LADO.btt gerado — ${trecho.length} bytes inseridos, nenhum fora do plano`);
console.log(`   Company (Rifle) id ${MAE}: ${filhos} -> ${filhos + 2} filhos, e ligada`);
console.log(`   ids 500..${500 + n}: copia AMERICANA do pelotao id ${MODELO}, intacta`);
console.log(`   ids 510..${510 + n}: copia RUSSA — tipo e exercito reescritos posicao por posicao`);
RUSSO.forEach(([v, t, nm], k) => console.log(`      pos ${k}  -> 0x${t.toString(16).padStart(2, '0')}/0x${v.toString(16)}  ${nm}`));
