// O BRIEFING DA BATALHA (28/09). A tela "Briefing" do jogo mostra seis secoes por lado — Situation,
// Mission, Friendly Forces, Enemy Forces, Plan, Notes — e elas NAO estao no cabecalho (la moram o
// titulo e a descricao curta da lista): estao no PRIMEIRO bloco comprimido do container, antes de
// tudo o mais que ele carrega.
//
//   u16 versao                (a mesma do cabecalho: 139 nos mapas de QB, 140 nos cenarios novos)
//   12 x [u16 len | texto latin1, quebras CRLF]   0-5 AZUL, 6-11 VERMELHO, na ordem das secoes
//   ...o resto do bloco: as seis imagens (u32 tamanho | BMP), as Designer Notes, e nos cenarios
//      o terreno — copiado byte a byte, nunca reinterpretado
//
// O gerador copia o bloco 0 do mapa de QB sem mexer, e por isso a batalha herdava a historia do
// mapa: uma batalha da campanha abriu com um major sovietico avisando de "German tanks". Secao vazia
// nao aparece na tela (manual do editor). O jogador e sempre o VERMELHO (forge.buildBattle), entao as
// secoes 6-11 sao as que ele le; as do azul sao as da IA.
//
//   node tools/re/briefing.mjs <arquivo.btt>                  mostra as 12 secoes
import fs from 'fs';
import { bmpIntegro } from './bmp_integro.mjs';
import path from 'path';
import { descomprimir, OFF_TAMANHO } from './lz.mjs';
import { abrir, lerListaStrings } from './ext.mjs';
import { cabecalhoDoBloco, decodificar, expandir, codificarComoJogo } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';

export const SECOES = ['Situation', 'Mission', 'Friendly Forces', 'Enemy Forces', 'Plan', 'Notes'];

function bloco0(arquivo) {
  const r = abrir(arquivo);
  const L = lerListaStrings(r.b, r.bmpFim);
  const o = L.fim + OFF_TAMANHO;
  const tam = r.b.readUInt32LE(o);
  if (!(tam > 0) || o + 4 + tam > r.b.length) throw new Error(`${path.basename(arquivo)}: o primeiro bloco nao esta onde o cabecalho diz`);
  const bl = Buffer.from(descomprimir(r.b.subarray(o + 4, o + 4 + tam), 0).saida);
  const h = cabecalhoDoBloco(bl);
  const { cru, tokens } = decodificar(bl, h.esc, h.inicio, bl.length, h.atalhos);
  return { completo: expandir(cru, tokens).completo, esc: h.esc };
}

function textosDe(completo) {
  const versao = completo.readUInt16LE(0);
  const textos = [];
  let p = 2;
  for (let i = 0; i < 12; i++) {
    if (p + 2 > completo.length) throw new Error('o bloco acabou antes das 12 secoes do briefing');
    const n = completo.readUInt16LE(p);
    if (p + 2 + n > completo.length) throw new Error(`secao ${i} do briefing diz ${n} bytes e o bloco nao tem`);
    textos.push(completo.subarray(p + 2, p + 2 + n).toString('latin1'));
    p += 2 + n;
  }
  return { versao, textos, fim: p };
}

export function ler(arquivo) {
  const { completo } = bloco0(arquivo);
  const { versao, textos, fim } = textosDe(completo);
  return { versao, azul: textos.slice(0, 6), vermelho: textos.slice(6), resto: completo.length - fim };
}

// Texto para o jogo: latin1 (o que nao couber vira "?"), quebras CRLF, ate 60000 bytes por secao.
export function paraOJogo(t) {
  const s = String(t ?? '').replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n');
  const limpo = [...s].map((c) => (c.charCodeAt(0) <= 0xff ? c : '?')).join('');
  if (limpo.length > 60000) throw new Error(`secao de briefing com ${limpo.length} caracteres (limite 60000)`);
  return limpo;
}

// Escreve as secoes dadas (null/undefined = deixa a do mapa) e copia todo o resto do bloco; `notas` (texto) troca as
// Designer Notes na mesma passada (undefined = deixa). `saida` pode ser o proprio arquivo. Confere lendo de volta.
export function escrever(arquivo, { azul = [], vermelho = [], notas } = {}, saida = arquivo) {
  const { completo, esc } = bloco0(arquivo);
  const { textos, fim } = textosDe(completo);
  const novos = [...textos];
  azul.forEach((t, i) => { if (i < 6 && t !== null && t !== undefined) novos[i] = paraOJogo(t); });
  vermelho.forEach((t, i) => { if (i < 6 && t !== null && t !== undefined) novos[6 + i] = paraOJogo(t); });
  const partes = [completo.subarray(0, 2)];
  for (const t of novos) {
    const b = Buffer.from(t, 'latin1');
    const n = Buffer.alloc(2); n.writeUInt16LE(b.length);
    partes.push(n, b);
  }
  let notasNovas = null;
  if (notas === undefined) partes.push(completo.subarray(fim));
  else {
    const atual = notasDe(completo);
    const b = Buffer.from(paraOJogo(notas), 'latin1'); notasNovas = b.toString('latin1');
    const n = Buffer.alloc(2); n.writeUInt16LE(b.length);
    partes.push(completo.subarray(fim, atual.inicio), n, b, completo.subarray(atual.fim));
  }
  const novo = Buffer.concat(partes);
  const tmp = `${saida}.briefing.tmp`;
  reconstruir(arquivo, tmp, (bl, k) => (k === 0 ? codificarComoJogo(novo, esc) : bl));
  fs.renameSync(tmp, saida);
  const lido = ler(saida);
  const todos = [...lido.azul, ...lido.vermelho];
  const errada = todos.findIndex((t, i) => t !== novos[i]);
  if (errada >= 0) throw new Error(`o briefing gravado nao le de volta (secao ${errada})`);
  if (notasNovas !== null && lerNotas(saida) !== notasNovas) throw new Error('as Designer Notes gravadas nao leem de volta');
  return { antes: { azul: textos.slice(0, 6), vermelho: textos.slice(6) }, agora: { azul: lido.azul, vermelho: lido.vermelho } };
}

// AS SEIS IMAGENS DO BRIEFING (17/10/2026, medido no "Cry Havoc"): logo depois das 12 secoes de texto, 6 x [u32 tamanho |
// BMP 24 bits sem compressao] (tamanho 0 = sem imagem, o caso dos mapas de QB): 0-2 AZUL, 3-5 VERMELHO, cada lado
// [estrategico 224x224, operacional 702x224 (o topo da tela, com o painel de objetivos), tatico 952x350 (o botao
// "Tactical Map")]. O resto do bloco segue como esta.
export const IMAGENS = ['estrategico', 'operacional', 'tatico'];
export const TAMANHO_IMAGEM = { estrategico: [224, 224], operacional: [702, 224], tatico: [952, 350] };
function imagensDe(completo, fim) {
  let p = fim; const imgs = [];
  for (let k = 0; k < 6; k++) {
    if (p + 4 > completo.length) throw new Error(`o bloco acabou antes da imagem ${k} do briefing`);
    const n = completo.readUInt32LE(p);
    if (p + 4 + n > completo.length) throw new Error(`imagem ${k} do briefing diz ${n} bytes e o bloco nao tem`);
    if (n && completo.subarray(p + 4, p + 6).toString('latin1') !== 'BM') throw new Error(`imagem ${k} do briefing nao e BMP`);
    imgs.push(n ? Buffer.from(completo.subarray(p + 4, p + 4 + n)) : null); p += 4 + n;
  }
  return { imgs, fim: p };
}
export const dimensoesBmp = (b) => (b ? [b.readInt32LE(18), Math.abs(b.readInt32LE(22)), b.readUInt16LE(28)] : null);
export function lerImagens(arquivo) {
  const { completo } = bloco0(arquivo);
  return imagensDe(completo, textosDe(completo).fim).imgs;
}
// `imagens` = { 0..5: Buffer BMP | null (apaga) | undefined (deixa) }. Confere 24 bits e o tamanho da tela de cada uma.
export function escreverImagens(arquivo, imagens = {}, saida = arquivo) {
  const { completo, esc } = bloco0(arquivo);
  const t = textosDe(completo); const atual = imagensDe(completo, t.fim);
  const novas = atual.imgs.map((b, k) => (imagens[k] === undefined ? b : imagens[k]));
  novas.forEach((b, k) => {
    if (!b) return;
    // inteiro (29/10): o jogo le w*h*3 pixels; o BMP truncado com o cabecalho intacto entrava e o jogo leria alem do bloco
    const motivo = bmpIntegro(b, TAMANHO_IMAGEM[IMAGENS[k % 3]]);
    if (motivo) throw new Error(`imagem ${k} (${IMAGENS[k % 3]}): ${motivo}`);
  });
  const partes = [completo.subarray(0, t.fim)];
  for (const b of novas) { const n = Buffer.alloc(4); n.writeUInt32LE(b ? b.length : 0); partes.push(n); if (b) partes.push(b); }
  partes.push(completo.subarray(atual.fim));
  const novo = Buffer.concat(partes);
  const tmp = `${saida}.imagens.tmp`;
  reconstruir(arquivo, tmp, (bl, k) => (k === 0 ? codificarComoJogo(novo, esc) : bl));
  fs.renameSync(tmp, saida);
  const lidas = lerImagens(saida);
  const errada = lidas.findIndex((b, k) => (b ? !novas[k] || !b.equals(novas[k]) : !!novas[k]));
  if (errada >= 0) throw new Error(`as imagens gravadas nao leem de volta (imagem ${errada})`);
  const sem = ({ versao, azul, vermelho }) => JSON.stringify({ versao, azul, vermelho });
  if (sem(ler(saida)) !== sem(ler(arquivo))) throw new Error('os textos do briefing mudaram');
  return { imagens: lidas.map(dimensoesBmp) };
}

// AS DESIGNER NOTES (01/11/2026): logo depois das seis imagens, u16 len | texto latin1 (o botao "Designer's Notes" da
// tela do briefing). O mapa 040r trazia a historia de um cenario de 1944 (Borisov) e a batalha herdava; o autor mandou
// limpar de todos os mapas do app. O mapa do pacote fica intacto (o hash dele e registrado); a batalha gerada e que sai
// com as notas vazias (forge.buildBattle). O resto do bloco segue como esta.
function notasDe(completo) {
  const p = imagensDe(completo, textosDe(completo).fim).fim;
  if (p + 2 > completo.length) throw new Error('o bloco acabou antes das Designer Notes');
  const n = completo.readUInt16LE(p);
  if (p + 2 + n > completo.length) throw new Error(`as Designer Notes dizem ${n} bytes e o bloco nao tem`);
  return { texto: completo.subarray(p + 2, p + 2 + n).toString('latin1'), inicio: p, fim: p + 2 + n };
}
export const lerNotas = (arquivo) => notasDe(bloco0(arquivo).completo).texto;
export function escreverNotas(arquivo, texto = '', saida = arquivo) {
  const { completo, esc } = bloco0(arquivo);
  const atual = notasDe(completo);
  const b = Buffer.from(paraOJogo(texto), 'latin1');
  const n = Buffer.alloc(2); n.writeUInt16LE(b.length);
  const novo = Buffer.concat([completo.subarray(0, atual.inicio), n, b, completo.subarray(atual.fim)]);
  const tmp = `${saida}.notas.tmp`;
  reconstruir(arquivo, tmp, (bl, k) => (k === 0 ? codificarComoJogo(novo, esc) : bl));
  fs.renameSync(tmp, saida);
  if (lerNotas(saida) !== b.toString('latin1')) throw new Error('as Designer Notes gravadas nao leem de volta');
  return { antes: atual.texto.length, agora: b.length };
}

const EH_MAIN = process.argv[1] && /[\\/]briefing\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const [arquivo] = process.argv.slice(2);
  if (!arquivo) console.log('uso: node tools/re/briefing.mjs <arquivo.btt>');
  else {
    const r = ler(arquivo);
    console.log(`${path.basename(arquivo)} | versao ${r.versao} | ${r.resto} B depois das secoes`);
    for (const [lado, t] of [['AZUL', r.azul], ['VERMELHO', r.vermelho]]) {
      t.forEach((s, i) => console.log(`  ${lado} ${SECOES[i]}: ${s.length} | ${JSON.stringify(s.slice(0, 90))}`));
    }
    const notas = lerNotas(arquivo);
    console.log(`  Designer Notes: ${notas.length} | ${JSON.stringify(notas.slice(0, 90))}`);
  }
}
