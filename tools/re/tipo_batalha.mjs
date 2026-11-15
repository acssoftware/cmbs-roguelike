// QUEM ATACA e QUE TIPO de batalha: um unico byte, no offset 44 do arquivo BRUTO.
//
// Nao esta no bloco de dados comprimido, e sim no cabecalho do container, junto do titulo e da
// descricao em texto puro (por volta do byte 49). Por isso `reconstruir` o preserva de graca:
// o arquivo gerado herda o tipo do mapa alvo. Para mudar, basta gravar outro valor.
//
// Os sete valores, simetricos em torno do 0x03, confirmados lendo a tela do editor:
//
//   0x00 Red Assault      0x06 Blue Assault
//   0x01 Red Attack       0x05 Blue Attack
//   0x02 Red Probe        0x04 Blue Probe
//   0x03 Meeting Engagement
//
// Conferido no jogo: o mesmo arquivo com 0x00 abre como "Red Assault" e com 0x06 como
// "Blue Assault". Nos 360 mapas de Quick Battle a distribuicao fecha: 53 Assault com 0x00 e
// 33 com 0x06, 53 Attack com 0x01 e 33 com 0x05, e assim por diante.
import fs from 'fs';

export const TIPOS = {
  0x00: 'Red Assault', 0x01: 'Red Attack', 0x02: 'Red Probe',
  0x03: 'Meeting Engagement',
  0x04: 'Blue Probe', 0x05: 'Blue Attack', 0x06: 'Blue Assault',
};
export const POR_NOME = Object.fromEntries(Object.entries(TIPOS).map(([v, n]) => [n.toLowerCase(), +v]));

export const AMBIENTE = { 0: 'City', 1: 'Town', 2: 'Village', 3: 'Open' };
// 2 e 3 (17/10/2026, varredura dos arquivos dos devs): 2 so aparece as 20:00 (BSBP 06 Firefight, TF 2CR 05, RUS MSN 03) e
// 3 de madrugada (01:10-02:35: Opportunity Knocks, TF 3-69 05, Crossing the Dnieper 2) — Dusk e Night pela ordem do menu,
// sem gabarito. A luz no jogo vem da HORA (u16 de minutos no cabecalho de data, fim+5); este byte e um rotulo.
export const LUZ = { 0: 'Dawn', 1: 'Day', 2: 'Dusk', 3: 'Night' };
export const TAMANHO = { 0: 'Tiny', 1: 'Small', 2: 'Medium', 3: 'Large', 4: 'Huge' };

// Os campos NAO estao em offset fixo: ficam colados antes do titulo, e o titulo comeca em
// lugar diferente conforme o arquivo (49 nos mapas de Quick Battle, 50 no BSBP 03 Trial).
// A ancora certa e o titulo — um u16 de tamanho seguido de tantos bytes ASCII.
//
//   t-6 ambiente | t-5 tipo de batalha | t-4 luz | t-3 tamanho | t-2 u16 do titulo | t titulo
//
// Confirmado lendo a tela Mission de cinco arquivos, entre cenarios e mapas de QB.
//
// O FALSO TITULO DE UM ESPACO (28/09): num mapa Tiny de dia, luz 1 e tamanho 0 leem como u16 = 1, e
// o "texto" de um byte e o tamanho baixo do titulo verdadeiro — imprimivel quando o titulo tem de 32
// a 126 caracteres (32 = " "). Os titulos de mapa eram curtos; o da campanha ("<nome> - Battle 1:
// <mapa>") nao. Por isso um candidato cujo texto comeca onde outro candidato valido comeca e o campo
// de tamanho desse outro, e perde para ele. Num titulo real isso nao acontece: dois ASCII fazem um
// u16 de pelo menos 0x2020.
function candidato(b, p) {
  if (p + 2 > b.length) return false;
  const n = b.readUInt16LE(p);
  if (n < 1 || n > 64 || p + 2 + n > b.length) return false;
  for (let k = 0; k < n; k++) { const c = b[p + 2 + k]; if (c < 0x20 || c > 0x7e) return false; }
  return true;
}
function acharTitulo(b) {
  for (let p = 20; p < 120; p++) {
    if (candidato(b, p) && !candidato(b, p + 2)) return p + 2;
  }
  throw new Error('titulo nao localizado no cabecalho');
}

function cabecalho(arquivo) {
  const fd = fs.openSync(arquivo, 'r');
  const b = Buffer.alloc(256);
  fs.readSync(fd, b, 0, b.length, 0);
  fs.closeSync(fd);
  const t = acharTitulo(b);
  return { b, t, off: t - 5 };
}

export function ler(arquivo) {
  const { b, t, off } = cabecalho(arquivo);
  const v = b[off];
  return {
    valor: v, offset: off,
    nome: TIPOS[v] || `desconhecido (0x${v.toString(16)})`,
    ambiente: AMBIENTE[b[t - 6]] ?? b[t - 6],
    luz: LUZ[b[t - 4]] ?? b[t - 4],
    tamanho: TAMANHO[b[t - 3]] ?? b[t - 3],
    titulo: b.subarray(t, t + b.readUInt16LE(t - 2)).toString('latin1'),
  };
}

// Escreve no proprio arquivo. So um byte muda; o resto fica intacto.
export function escrever(arquivo, alvo) {
  const v = typeof alvo === 'number' ? alvo : POR_NOME[String(alvo).toLowerCase()];
  if (v === undefined || !(v in TIPOS))
    throw new Error(`tipo invalido: ${alvo}. Use um destes: ${Object.values(TIPOS).join(', ')}`);
  const antes = ler(arquivo);
  const fd = fs.openSync(arquivo, 'r+');
  fs.writeSync(fd, Buffer.from([v]), 0, 1, antes.offset);
  fs.closeSync(fd);
  return { antes: antes.nome, agora: TIPOS[v], offset: antes.offset };
}

// O DAYLIGHT (17/10/2026): o byte logo depois do tipo de batalha (t-4). So rotulo — a luz vem da hora (gerar_batalha.
// escreverHora) —, mas o app o grava coerente com a hora sorteada. Um byte; o resto fica intacto.
export function escreverLuz(arquivo, luz) {
  const v = typeof luz === 'number' ? luz : Number(Object.keys(LUZ).find((k) => LUZ[k].toLowerCase() === String(luz).toLowerCase()));
  if (!(v in LUZ)) throw new Error(`daylight invalido: ${luz}. Use um destes: ${Object.values(LUZ).join(', ')}`);
  const antes = ler(arquivo);
  const fd = fs.openSync(arquivo, 'r+');
  fs.writeSync(fd, Buffer.from([v]), 0, 1, antes.offset + 1);
  fs.closeSync(fd);
  const depois = ler(arquivo);
  if (depois.luz !== LUZ[v] || depois.nome !== antes.nome || depois.tamanho !== antes.tamanho || depois.titulo !== antes.titulo) throw new Error(`o daylight nao ficou: ${JSON.stringify(depois)}`);
  return { antes: antes.luz, agora: LUZ[v] };
}

// O TITULO, de qualquer tamanho (28/09). Ate aqui so se trocava por outro do MESMO tamanho (E86); o
// editor grava titulos de tamanhos diferentes no mesmo lugar, e nada no cabecalho guarda a posicao do
// que vem depois — o container e lido em sequencia. Aceita so ASCII imprimivel (1..64), que e o que
// `acharTitulo` reconhece de volta.
export function escreverTitulo(arquivo, titulo) {
  const novo = Buffer.from(String(titulo), 'latin1');
  if (novo.length < 1 || novo.length > 64 || /[^\x20-\x7e]/.test(String(titulo))) throw new Error(`titulo invalido: "${titulo}" (1 a 64 caracteres ASCII)`);
  const b = fs.readFileSync(arquivo);
  const { t } = cabecalho(arquivo);
  const n = b.readUInt16LE(t - 2);
  const antes = b.subarray(t, t + n).toString('latin1');
  const len = Buffer.alloc(2); len.writeUInt16LE(novo.length);
  fs.writeFileSync(arquivo, Buffer.concat([b.subarray(0, t - 2), len, novo, b.subarray(t + n)]));
  const lido = ler(arquivo).titulo;
  if (lido !== String(titulo)) throw new Error(`o titulo gravado le "${lido}"`);
  return { antes, agora: lido };
}

const EH_MAIN = process.argv[1] && /[\\/]tipo_batalha\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const [arquivo, tipo] = process.argv.slice(2);
  if (!arquivo) {
    console.log('uso: node tipo_batalha.mjs <arquivo.btt> ["<tipo>"]');
    console.log('     tipos: ' + Object.values(TIPOS).join(' | '));
  } else if (!tipo) {
    const r = ler(arquivo);
    console.log(`${arquivo}`);
    console.log(`   "${r.titulo}" | ${r.nome} (0x${r.valor.toString(16).padStart(2, '0')} em +${r.offset})` +
                ` | ${r.ambiente} | ${r.luz} | ${r.tamanho}`);
  } else {
    const r = escrever(arquivo, tipo);
    console.log(`${arquivo}: ${r.antes} -> ${r.agora}`);
  }
}
