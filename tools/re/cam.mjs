// CAMPANHA (.cam) — ler, escrever e trocar batalhas (secao 110.2).
//
// Um .cam e a concatenacao dos .btt das batalhas, VERBATIM (conferido byte a byte na campanha que
// o editor compilou), com um cabecalho de campanha na frente e 41+len bytes antes de cada batalha:
//
//   cabecalho da campanha: [magic 8][~40 B][u16 len][titulo][u16 len][descricao][u32][BMP]...[u32 N]
//   por batalha:           u16 len | nome | u8 limiar | i16 proximaSeVence | i16 proximaSePerde |
//                          u8 09 | u8 09 | 8 x u8 % (azul refit, reparo, ressuprimento, descanso;
//                          vermelho idem) | u32 tamanho | .btt
//
// O cabecalho da campanha e opaco aqui: clona-se o de uma campanha existente (a que o editor
// compilou com o core file certo) e so o N e reescrito. Os textos de vitoria/derrota do script e o
// [PLAYER FORCE] nao foram localizados (110.5) — ficam os do cabecalho clonado.
//
//   node cam.mjs ler <arquivo.cam>
//   node cam.mjs trocar <arquivo.cam> <indice> <novo.btt> <saida.cam>
import fs from 'node:fs';
import { abrir } from './ext.mjs';

const MAGIC = Buffer.from([0x37, 0x2e, 0x13, 0xd0, 0xa5, 0xf9, 0xc4, 0xc8]);
export const LIMIAR = ['total defeat', 'major defeat', 'tactical defeat', 'minor defeat', 'draw', 'minor victory', 'tactical victory', 'major victory', 'total victory'];

export function lerCam(caminho) {
  const b = fs.readFileSync(caminho);
  if (!b.subarray(0, 8).equals(MAGIC)) throw new Error('nao e um arquivo do CMBS');
  // os cenarios embutidos comecam com o mesmo magic; o primeiro esta no byte 0 (a campanha)
  const offs = []; let i = b.indexOf(MAGIC, 1); while (i >= 0) { offs.push(i); i = b.indexOf(MAGIC, i + 1); }
  const batalhas = [];
  for (const o of offs) {
    const p = o - 4; const tam = b.readUInt32LE(p);
    const pct = [...b.subarray(p - 8, p)];
    const nextLose = b.readInt16LE(p - 12), nextWin = b.readInt16LE(p - 14), limiar = b[p - 15];
    // o nome termina em p-15; o u16 len vem antes dele
    let fim = p - 15, ini = fim; while (ini > 0 && b[ini - 1] >= 0x20 && b[ini - 1] < 0x7f) ini--;
    const len = b.readUInt16LE(ini - 2);
    if (len !== fim - ini) throw new Error(`cabecalho de batalha em ${o}: len ${len} != ${fim - ini}`);
    batalhas.push({ ini: ini - 2, nome: b.toString('latin1', ini, fim), limiar, nextWin, nextLose, pct, tam, btt: b.subarray(o, o + tam) });
  }
  // sanidade: cada batalha termina onde comeca o cabecalho da seguinte (ou no fim do arquivo)
  batalhas.forEach((x, k) => { const fim = x.ini + 2 + x.nome.length + 15 + 4 + x.tam; const esperado = batalhas[k + 1] ? batalhas[k + 1].ini : b.length;
    if (fim !== esperado) throw new Error(`batalha ${k} "${x.nome}": termina em ${fim}, esperado ${esperado}`); });
  const n = b.readUInt32LE(batalhas[0].ini - 4);
  if (n !== batalhas.length) throw new Error(`N no cabecalho = ${n}, mas ha ${batalhas.length} batalhas`);
  return { cabecalho: b.subarray(0, batalhas[0].ini - 4), n, batalhas };
}

function cabecalhoDeBatalha(x) {
  const nome = Buffer.from(x.nome, 'latin1');
  const h = Buffer.alloc(2 + nome.length + 1 + 2 + 2 + 2 + 8 + 4);
  let o = 0; h.writeUInt16LE(nome.length, o); o += 2; nome.copy(h, o); o += nome.length;
  h[o++] = x.limiar; h.writeInt16LE(x.nextWin, o); o += 2; h.writeInt16LE(x.nextLose, o); o += 2;
  h[o++] = 0x09; h[o++] = 0x09;
  for (let k = 0; k < 8; k++) h[o++] = x.pct[k] ?? 0;
  h.writeUInt32LE(x.btt.length, o);
  return h;
}

// Monta um .cam: cabecalho clonado + batalhas [{nome, limiar, nextWin, nextLose, pct, btt}].
export function escreverCam(cabecalho, batalhas, saida) {
  const n = Buffer.alloc(4); n.writeUInt32LE(batalhas.length);
  const partes = [cabecalho, n];
  for (const x of batalhas) { partes.push(cabecalhoDeBatalha(x), x.btt); }
  const out = Buffer.concat(partes);
  fs.writeFileSync(saida, out);
  return out.length;
}

// Troca a batalha `indice` por outro .btt, mantendo nome, limiar, ramificacao e percentuais.
export function trocarBatalha(cam, indice, novoBtt, saida) {
  const c = lerCam(cam);
  if (indice < 0 || indice >= c.batalhas.length) throw new Error(`indice ${indice} fora de 0..${c.batalhas.length - 1}`);
  const b = c.batalhas.map((x) => ({ ...x }));
  b[indice].btt = fs.readFileSync(novoBtt);
  return escreverCam(c.cabecalho, b, saida);
}

const EH_MAIN = process.argv[1] && /[\\/]cam\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const [cmd, a, b2, c2, d] = process.argv.slice(2);
  if (cmd === 'ler') {
    const c = lerCam(a);
    console.log(`${a}: cabecalho ${c.cabecalho.length} B, ${c.n} batalhas`);
    c.batalhas.forEach((x, k) => console.log(`  [${k}] "${x.nome}" limiar=${LIMIAR[x.limiar] || x.limiar} vence->${x.nextWin} perde->${x.nextLose} azul ${x.pct.slice(0, 4).join('/')} vermelho ${x.pct.slice(4).join('/')} ${x.tam} B`));
  } else if (cmd === 'trocar') {
    console.log('gravado', trocarBatalha(a, Number(b2), c2, d), 'B em', d);
  } else console.log('uso: node cam.mjs ler <cam> | trocar <cam> <indice> <novo.btt> <saida.cam>');
}

// ---------------------------------------------------------------------------------------------
// SAVE DE CAMPANHA (secao 111): depois dos dois blocos LZ do save vem um "resto" com a copia do
// cabecalho da campanha, o bloco LZ do ROSTER, o `u32 N` e, para cada batalha restante, o
// cabecalho de 41+len bytes seguido do .btt inteiro (o de DEPLOYMENT traz todas; o da transicao
// so as que faltam). Trocar uma batalha embutida = substituir o .btt e reescrever o `u32 tam`.
const MAGIC_BTT = MAGIC;
export function anatomiaDoSave(caminho) {
  const b = fs.readFileSync(caminho);
  if (!b.subarray(0, 8).equals(MAGIC_BTT)) throw new Error('nao e um arquivo do CMBS');
  // container do save (secao 95): ...BMP | u16 len | nome | 24 B | blocos LZ x2 | resto. O fim do BMP
  // vem de ext.abrir, que ja corrige o bfSize subdeclarado (secao 1).
  const p = abrir(caminho).bmpFim;
  const nome = b.toString('latin1', p + 2, p + 2 + b.readUInt16LE(p));
  let o = p + 2 + nome.length + 24; const blocos = [];
  for (let k = 0; k < 2; k++) { const t = b.readUInt32LE(o); blocos.push({ o, t }); o += 4 + t; }
  const restoIni = o;
  // batalhas embutidas: cada magic dentro do resto, com o cabecalho de batalha antes
  const bats = []; let i = b.indexOf(MAGIC_BTT, restoIni + 8);
  while (i >= 0) { const q = i - 4; const tam = b.readUInt32LE(q);
    let fim = q - 15, ini = fim; while (ini > restoIni && b[ini - 1] >= 0x20 && b[ini - 1] < 0x7f) ini--;
    const len = b.readUInt16LE(ini - 2);
    if (len === fim - ini && tam > 1000 && i + tam <= b.length) bats.push({ cabIni: ini - 2, nome: b.toString('latin1', ini, fim), posTam: q, tam, ini: i, fim: i + tam });
    i = b.indexOf(MAGIC_BTT, i + 8); }
  return { b, nome, blocos, restoIni, batalhas: bats };
}
// OS PERCENTUAIS DA CAMPANHA, dentro do save: os oito bytes logo antes do `u32 tamanho` de cada
// batalha embutida — [azul refit, reparo, ressuprimento, descanso; vermelho idem] (secao 110.2).
//
// Sao eles que dizem ao jogo o que devolver ao jogador na virada da batalha, e o modelo que o app
// clonava trazia `0 0 0 100` dos dois lados: descanso cheio (por isso todo mundo volta Rested) e
// **ressuprimento zero**, que e por que a municao atravessa a campanha — o autor viu um esquadrao
// entrar na batalha 2 com 229 balas enquanto o vizinho tinha 1938.
export function lerPercentuais(caminho) {
  const a = anatomiaDoSave(caminho);
  return a.batalhas.map((x) => ({ nome: x.nome, pct: [...a.b.subarray(x.posTam - 8, x.posTam)] }));
}

export function escreverPercentuais(caminho, saida, pct) {
  if (!Array.isArray(pct) || pct.length !== 8 || pct.some((x) => !Number.isInteger(x) || x < 0 || x > 100)) {
    throw new Error('sao oito inteiros de 0 a 100: azul refit/reparo/ressuprimento/descanso e vermelho idem');
  }
  const a = anatomiaDoSave(caminho);
  if (!a.batalhas.length) throw new Error('o save nao tem batalha embutida');
  const b = Buffer.from(a.b);
  for (const x of a.batalhas) for (let k = 0; k < 8; k++) b[x.posTam - 8 + k] = pct[k];
  fs.writeFileSync(saida, b);
  const conferido = lerPercentuais(saida);
  if (conferido.some((x) => x.pct.join() !== pct.join())) throw new Error('os percentuais nao ficaram gravados');
  return { batalhas: conferido.map((x) => x.nome), pct };
}

export function trocarBatalhaNoSave(save, nomeBatalha, novoBtt, saida) {
  const a = anatomiaDoSave(save);
  const x = a.batalhas.find((y) => y.nome === nomeBatalha);
  if (!x) throw new Error(`batalha "${nomeBatalha}" nao esta embutida (ha: ${a.batalhas.map((y) => y.nome).join(', ')})`);
  const novo = fs.readFileSync(novoBtt);
  const tam = Buffer.alloc(4); tam.writeUInt32LE(novo.length);
  const out = Buffer.concat([a.b.subarray(0, x.posTam), tam, novo, a.b.subarray(x.fim)]);
  fs.writeFileSync(saida, out);
  return { antes: x.tam, depois: novo.length, tamanho: out.length };
}
