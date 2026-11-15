// TRANSPLANTA a forca inteira de um template para outro mapa de Quick Battle.
//
// O bloco 1 de um QB, ja decodificado (ver escape.mjs), e:
//
//   [cabeca por-save ~24KB][corpo do mapa][token 03 + 06 02 00 00 | 04 01 00 00]
//   [se ha tropas: A(u32) B(u32), contagens de lado e os registros][token d8/da + ruido final]
//
// A forca mora inteira DEPOIS do marcador de fim de mapa, e o marcador pertence a ela: os
// mapas de fabrica (sem tropas) usam a variante 04 01, os salvos com tropas usam 06 02.
// Entao transplantar e uma emenda de dois pedacos no fluxo cru — mapa do alvo + cauda do
// template — e recodificar com o byte de escape do alvo.
//
// O que tornou isso possivel: descobrir que o "prefixo" e um byte de escape (escape.mjs).
// Antes, emendar bytes crus de dois arquivos misturava duas codificacoes diferentes.
//
// Uso:
//   node transplante.mjs                                    <- inspeciona os dois arquivos
//   node transplante.mjs gerar "<mapa QB alvo>" "<saida>"
import fs from 'fs';
import { abrir, lerListaStrings } from './ext.mjs';
import { descomprimirDoContainer } from './lz.mjs';
import { decodificar, codificar, escDoBloco, cabecalhoDoBloco } from './escape.mjs';
import { inicioDaForca, MINIMO_FORCA } from './regs.mjs';
import { expandir } from './escape.mjs';
import { fimDaRegiaoIA } from './mapa.mjs';
import { reconstruir } from './rebuild.mjs';
import { vagasDeObjetivos } from './gatilhos.mjs';

const G = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/';
const DIR_QB = G + 'Quick Battle Maps/';
const DIR_SAIDA = G + 'Scenarios/';
const TEMPLATE = G + 'GENERATOR_TEMPLATES/City  (688 X 736) 047r Assault.btt';

export function blocoBruto(f) {
  const r = abrir(f);
  const l = lerListaStrings(r.b, r.bmpFim);
  const bs = descomprimirDoContainer(r.b, l.fim).blocos.map((x) => Buffer.from(x.saida));
  return bs[bs.length - 1];
}

// O fluxo decodificado, com os dois primeiros bytes (a declaracao do escape) fora.
export function ler(f) {
  const bl = blocoBruto(f);
  const { esc, atalhos, inicio } = cabecalhoDoBloco(bl);
  const d = { bl, esc, atalhos, ...decodificar(bl, esc, inicio, bl.length, atalhos) };
  // E169: arquivo da versao nova (byte 18 >= 0x94) — a forca so pode comecar depois da regiao de IA
  // 16/10/2026 (Open-Rural 313 Meet, versao 8c): e em QUALQUER versao, so depois das 30 vagas de objetivo (o marcador de
  // fim de mapa vem depois delas). O 313 tem vagas chamadas "Line 1..8" cujos bytes parecem um registro de forca: o
  // inicio da forca era achado ali, o marcador ficava 30 KB antes do fim e a batalha perdia o resto do mapa. Em 316
  // arquivos medidos so o 313 muda de marcador.
  try {
    const fd = fs.openSync(f, 'r'); const h = Buffer.alloc(19); fs.readSync(fd, h, 0, 19, 0); fs.closeSync(fd);
    const ex = expandir(d.cru, d.tokens); const fim = fimDaRegiaoIA(ex.completo);
    const paraCru = (k) => { let j = k; while (j < ex.mapa.length && ex.mapa[j] === -1) j++; return j < ex.mapa.length ? ex.mapa[j] : null; };
    let minimo = null;
    if (fim != null && h[18] >= 0x94) minimo = paraCru(fim);
    if (fim != null) {
      try { const vs = vagasDeObjetivos(ex.completo, fim + 130); const u = vs[vs.length - 1]; const pv = paraCru(u.fim + (u.extra ? 1 : 0)); if (pv != null) minimo = Math.max(minimo ?? 0, pv); } catch { /* vagas ilegiveis: fica o da regiao */ }
    }
    if (minimo != null) MINIMO_FORCA.set(d.cru, minimo);
  } catch { /* sem minimo: o comportamento de sempre */ }
  return d;
}

// O marcador de fim de mapa e um token 03 com a forma `00 <a> <b> 00 00`. O par (a,b) nao e
// fixo — 06 02 nos salvos com tropas, 04 01 e 02 06 em mapas de fabrica —, entao filtrar por
// ele reprovava mapas bons. Como o mesmo desenho de bytes tambem aparece dentro dos dados, a
// escolha e auto-validante: o marcador e o ULTIMO candidato que ainda tem a forca inteira
// depois de si. Nos mapas sem tropas isso e o ultimo candidato do fluxo; nos que tem, e o
// ultimo que deixa todos os registros para tras.
const EXS = new Set([0x14, 0x15, 0x16, 0x17, 0x24, 0x25, 0x26, 0x27, 0x34, 0x35, 0x36, 0x37]);

function primeiroRegistro(cru, de) {
  for (let p = Math.max(14, de); p + 5 <= cru.length; p++)
    if (EXS.has(cru[p]) && cru[p + 1] === 0x60 && cru[p + 2] === 0x00) return p - 14;
  return -1;
}

export function marcador(d) {
  const c = d.cru;
  const ancora = inicioDaForca(c);
  const inicioDaForca_ = ancora >= 0 ? ancora : primeiroRegistro(c, 0);
  const candidatos = [];
  for (let k = 0; k < d.tokens.length; k++) {
    const t = d.tokens[k];
    // 14/10/2026 (Small Town-Forest 018r Meet, crash no jogo): o marcador tambem pode vir num token 04 — os zeros do
    // ultimo registro do mapa se juntam aos do marcador (`[4]00 04 00 00 10` em vez de `[3]00 04 00 00 00 10`). So com
    // o 03 o ultimo candidato caia DENTRO da ultima vaga de objetivo (a cor dela, `00 ef 5e b6 ef`), a forca entrava
    // 8 bytes antes do fim do mapa e a batalha nao carregava. Em 316 arquivos medidos so o 018r muda de marcador.
    if (t.cod !== 0x03 && t.cod !== 0x04) continue;
    const p = t.pos;
    if (c[p] !== 0x00) continue;   // o payload comeca em 00; o par seguinte varia demais
    if (inicioDaForca_ >= 0 && p > inicioDaForca_) continue;   // tem de vir ANTES da forca
    candidatos.push({ k, pos: p, variante: `${c[p + 1].toString(16).padStart(2, '0')} ${c[p + 2].toString(16).padStart(2, '0')}` });
  }
  if (!candidatos.length) throw new Error('marcador de fim de mapa nao achado');
  const m = candidatos[candidatos.length - 1];
  if (inicioDaForca_ < 0 && c.length - m.pos > 4096)
    throw new Error(`mapa sem tropas mas com ${c.length - m.pos} bytes depois do marcador`);
  // ATENCAO: "o ULTIMO token 0x03 antes da forca" acerta em 235 dos 236 arquivos medidos, mas NAO e
  // garantia. Numa batalha de 13 topos o proprio cabecalho da forca produziu um token que parecia
  // marcador e este `pos` saiu 5 bytes adiante do certo (E70). `abrirCompleto` conserta sozinho,
  // pela largura fixa do cabecalho; quem chamar `marcador` direto para LER cabecalho fica com o
  // erro.
  return { ...m, semTropas: inicioDaForca_ < 0 };
}

// Contagem de formacoes de topo de um lado: u32 colado antes do id da primeira formacao,
// e o id fica 11 bytes antes do padrao [exercito] 60 00 (secao 23). No fluxo CRU, agora
// que o escape nao atrapalha mais, isso vale sem excecao.
export function raizDoLado(cru, army) {
  for (let p = 14; p + 6 <= cru.length; p++) {
    if (cru[p] !== army || cru[p + 1] !== 0x60 || cru[p + 2] !== 0x00) continue;
    if (![0x19, 0x0b, 0x1a, 0x18].includes(cru[p + 4])) continue;
    const o = p - 14, id = cru.readUInt32LE(o + 3), n = cru.readUInt32LE(o - 1);
    if (id < 1 || id > 30000 || n < 1 || n > 1500) continue;
    return { pos: o - 1, id, n };
  }
  return null;
}

function descrever(rot, f) {
  const d = ler(f);
  const m = marcador(d);
  const az = raizDoLado(d.cru.subarray(m.pos), 0x17), vm = raizDoLado(d.cru.subarray(m.pos), 0x27);
  console.log(`${rot}: bruto ${d.bl.length} -> cru ${d.cru.length} bytes + ${d.tokens.length} tokens | esc 0x${d.esc.toString(16)}`);
  console.log(`   marcador no cru @${m.pos} (token #${m.k}) [${m.variante}] | cauda ${d.cru.length - m.pos} bytes crus`);
  if (az || vm) console.log(`   azul: ${az ? az.n + ' formacoes (raiz id ' + az.id + ')' : 'nenhuma'} | vermelho: ${vm ? vm.n + ' formacoes (raiz id ' + vm.id + ')' : 'nenhuma'}`);
  else console.log('   sem tropas');
  return { d, m, az, vm };
}

const EH_MAIN = process.argv[1] && /[\\/]transplante\.mjs$/.test(process.argv[1]);
const alvoNome = process.argv[3], saidaNome = process.argv[4];
const T = EH_MAIN ? descrever('TEMPLATE', TEMPLATE) : null;

if (EH_MAIN && process.argv[2] === 'gerar') {
  if (!alvoNome || !saidaNome) throw new Error('uso: gerar "<mapa QB alvo>" "<saida>"');
  const A = descrever('ALVO    ', DIR_QB + alvoNome);
  if (A.az || A.vm) console.log('   AVISO: o alvo ja tem tropas; elas serao substituidas');

  // emenda no fluxo cru: mapa do alvo ate o marcador + cauda do template a partir do dele
  const cru = Buffer.concat([A.d.cru.subarray(0, A.m.pos), T.d.cru.subarray(T.m.pos)]);
  const desloc = A.m.pos - T.m.pos;
  const tokens = [
    ...A.d.tokens.slice(0, A.m.k),
    ...T.d.tokens.slice(T.m.k).map((t) => ({ pos: t.pos + desloc, cod: t.cod })),
  ];
  const corpo = codificar({ cru, tokens }, A.d.esc);
  const novo = Buffer.concat([Buffer.from([A.d.esc, 0x00]), corpo]);

  reconstruir(DIR_QB + alvoNome, DIR_SAIDA + saidaNome, (bloco, i) => (i === 1 ? novo : bloco));

  // ---- verificacao, sempre no arquivo gerado -------------------------------------------
  const V = ler(DIR_SAIDA + saidaNome);
  if (!V.cru.equals(cru)) throw new Error('o cru do gerado nao bate com o planejado');
  if (V.tokens.length !== tokens.length) throw new Error(`tokens: ${V.tokens.length} vs ${tokens.length}`);
  for (let k = 0; k < tokens.length; k++)
    if (V.tokens[k].pos !== tokens[k].pos || V.tokens[k].cod !== tokens[k].cod)
      throw new Error(`token #${k} divergente`);
  const vm2 = marcador(V);
  const vaz = raizDoLado(V.cru.subarray(vm2.pos), 0x17), vvm = raizDoLado(V.cru.subarray(vm2.pos), 0x27);
  if (!vaz || vaz.n !== T.az.n || !vvm || vvm.n !== T.vm.n)
    throw new Error(`raizes no gerado: azul ${vaz?.n}, vermelha ${vvm?.n} — esperava ${T.az.n}/${T.vm.n}`);
  // o mapa do alvo tem de sair intacto, byte a byte, no trecho anterior ao marcador
  const orig = ler(DIR_QB + alvoNome);
  if (!V.cru.subarray(0, A.m.pos).equals(orig.cru.subarray(0, A.m.pos)))
    throw new Error('o mapa do alvo foi alterado');

  console.log(`\n${saidaNome} gerado em Scenarios`);
  console.log(`   mapa do alvo (${A.m.pos} bytes crus, intacto) + forca do template (${T.d.cru.length - T.m.pos} bytes crus)`);
  console.log(`   recodificado com esc 0x${A.d.esc.toString(16)}: bloco de ${novo.length} bytes`);
  console.log(`   conferido no arquivo gerado: azul ${vaz.n} formacoes, vermelho ${vvm.n}`);
}
