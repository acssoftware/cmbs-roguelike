// DIVIDIR uma batalha em dois arquivos de um bloco so (secao 96): o bloco azul e o bloco vermelho,
// cada um gravado como fonte AZUL-PRIMEIRO (K_azul = numero de formacoes de topo do bloco, sem
// contador vermelho). E o que permite ACRESCENTAR formacoes a uma batalha ja editada no editor:
// `compor2([V2azul, extrasAzul..., V2verm(lado vermelho), extrasVerm...])` reconstroi a forca
// mantendo cada bloco byte a byte (posicoes, grupos, ausentes) e so acrescenta no fim de cada lado.
//
// Layout (secoes 62/68): marcador m | cabecalho 17 (00 | desc | A | N | K_azul) | bloco azul |
// K_verm u32 | bloco vermelho | rodape (corrida longa de zeros + cauda). O bloco vermelho comeca
// no K_verm, que fica logo antes dos 3 zeros de cabeca do seu primeiro registro. A fronteira e
// achada pela posicao do primeiro registro vermelho na lista de topos (contando K_azul topos).
import { abrirCompleto } from './anexar2.mjs';
import { cabecalho } from './lados.mjs';
import { codificarComoJogo } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';
import { indiceDeTokens, subArvore } from './regs.mjs';

const fimDosRegistros = (c, desde) => { for (let i = desde; i < c.length; i++) { if (c[i] !== 0) continue; let z = 0; while (i + z < c.length && c[i + z] === 0) z++; if (z >= 32) return i; i += z; } return c.length; };

// Indice (na lista R ordenada por offset) do primeiro registro de cada topo, e o primeiro vermelho.
function topos(X) {
  const p = indiceDeTokens(X.d.tokens); const R = X.R; const out = [];
  for (let i = 0; i < R.length;) { if (!R[i].form) { i++; continue; } let e; try { e = subArvore(X.d.cru, p, R, i); } catch { e = i + 1; } out.push({ i, e }); i = Math.max(e, i + 1); }
  return out;
}

export function extrairLado(entrada, saida, lado) {
  const X = abrirCompleto(entrada); const c = X.completo, m = X.m; const h = cabecalho(X);
  if (h.kAzul === 0) throw new Error('fonte vermelha-primeiro: use lados.converterParaAzul');
  const T = topos(X); if (T.length <= h.kAzul && lado === 'vermelho') throw new Error('nao ha bloco vermelho');
  const iniForca = m + 17;                                         // primeiro registro azul (sem os 3 zeros: o cabecalho termina no id)
  const fimTudo = fimDosRegistros(c, X.R[X.R.length - 1].c);
  let corpo, k;
  if (lado === 'azul') {
    if (T.length === h.kAzul) { corpo = c.subarray(iniForca, fimTudo); }
    else { const primVerm = X.R[T[h.kAzul].i]; const posK = primVerm.c - 1;   // K_verm cola no id: seus 3 bytes altos fazem as vezes dos 3 zeros de cabeca
      const kv = c.readUInt32LE(posK); if (kv !== T.length - h.kAzul) throw new Error(`K_verm ${kv} != ${T.length - h.kAzul} topos vermelhos`);
      // o bloco azul termina antes do enchimento que precede o K_verm: corta na ultima posicao nao-zero antes de posK
      let fim = posK; while (fim > iniForca && c[fim - 1] === 0) fim--; corpo = c.subarray(iniForca, fim); }
    k = h.kAzul;
  } else {
    const primVerm = X.R[T[h.kAzul].i]; const posK = primVerm.c - 1; const kv = c.readUInt32LE(posK);
    if (kv !== T.length - h.kAzul) throw new Error(`K_verm ${kv} != ${T.length - h.kAzul} topos vermelhos`);
    corpo = c.subarray(posK + 4, fimTudo);                           // comeca no id do 1o registro vermelho (como o cabecalho azul)
    k = kv;
  }
  // A (custo) e N (unidades) do cabecalho sao repartidos na proporcao dos registros de cada bloco,
  // senao o compor2 soma o total duas vezes (V2: 13973 -> 27930 pontos). Cosmetico, mas visivel.
  const nAzul = T.length > h.kAzul ? T[h.kAzul].i : X.R.length, nTot = X.R.length;
  const fracao = lado === 'azul' ? nAzul / nTot : 1 - nAzul / nTot;
  const cab = Buffer.from(c.subarray(m, m + 17)); cab.writeUInt32LE(k, 13);
  cab.writeUInt32LE(lado === 'azul' ? Math.round(h.A * fracao) : h.A - Math.round(h.A * (1 - fracao)), 5);
  cab.writeUInt32LE(lado === 'azul' ? Math.round(h.N * fracao) : h.N - Math.round(h.N * (1 - fracao)), 9);
  const novo = Buffer.concat([c.subarray(0, m), cab, corpo, c.subarray(fimTudo)]);
  reconstruir(entrada, saida, (x, i) => (i === 1 ? codificarComoJogo(novo, X.d.esc) : x));
  const V = abrirCompleto(saida); const hv = cabecalho(V);
  const esperado = lado === 'azul' ? T[Math.min(h.kAzul, T.length) - 1].e : X.R.length - T[h.kAzul].i;
  if (V.R.length !== esperado) throw new Error(`${lado}: gravado com ${V.R.length} registros, esperava ${esperado}`);
  return { registros: V.R.length, kAzul: hv.kAzul, topos: k };
}

const EH_MAIN = process.argv[1] && /[\\/]dividir\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const [ent, saiAzul, saiVerm] = process.argv.slice(2);
  if (!ent || !saiAzul) { console.log('uso: node dividir.mjs <batalha.btt> <saida-azul.btt> [saida-vermelho.btt]'); process.exit(1); }
  console.log('azul:', JSON.stringify(extrairLado(ent, saiAzul, 'azul')));
  if (saiVerm) console.log('vermelho:', JSON.stringify(extrairLado(ent, saiVerm, 'vermelho')));
}
