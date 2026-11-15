// ESCREVER o bloco do mapa (secao 94). Le um mapa base, troca as pecas que sabemos montar e
// recodifica o bloco 1 com `codificarComoJogo`.
//
// O bloco do mapa na corrente completa, com os limites que `lerMapa` ja devolve:
//   [0 .. posWH+4)              preambulo + OX OY W H          (da base; `novo.cabeca` so para sondas)
//   [posWH+4 .. fimConstrucoes) u32 n | registros de construcao
//   [fimConstrucoes .. gridStart) u32 n | pontes (7 B) | u32 n | flavor (8 B)
//   [gridStart .. fimGrade)     grade, 5 B/tile + landmarks embutidos (secao 92)
//   [fimGrade .. +4WH)          elevacao, 4 B/tile
//   [+4WH .. fim]               camera (48 B), regiao de IA, cauda, bloco de forca  (COPIADO)
// Manter W,H iguais aos da base evita mexer em tudo que depende de tamanho (preambulo, camera,
// regiao de IA): so o conteudo muda. E por isso que se escolhe uma base do tamanho desejado.
import { ler } from './transplante.mjs';
import { expandir, codificarComoJogo } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';
import { lerMapa } from './mapa.mjs';
import { lerPlanos } from './ia.mjs';

export function pecas(caminho) {
  const d = ler(caminho); const c = expandir(d.cru, d.tokens).completo;
  const m = lerMapa(caminho);
  if (!m.iaConfere) throw new Error('base insegura: a regiao de IA nao confirma a grade');
  const iniConstr = m.posWH + 4, fimElev = m.fimGrade + 4 * m.W * m.H;
  return { d, c, m, W: m.W, H: m.H, OX: m.OX, OY: m.OY,
    cabeca: c.subarray(0, iniConstr),
    construcoes: c.subarray(iniConstr, m.fimConstrucoes),
    pontesFlavor: c.subarray(m.fimConstrucoes, m.gridStart),
    grade: c.subarray(m.gridStart, m.fimGrade),
    elevacao: c.subarray(m.fimGrade, fimElev),
    resto: c.subarray(fimElev) };
}

export function escrever(base, saida, novo = {}) {
  const p = pecas(base);
  const completo = Buffer.concat([novo.cabeca || p.cabeca, novo.construcoes || p.construcoes, novo.pontesFlavor || p.pontesFlavor,
    novo.grade || p.grade, novo.elevacao || p.elevacao, novo.resto || p.resto]);
  reconstruir(base, saida, (x, k) => (k === 1 ? codificarComoJogo(completo, p.d.esc) : x));
  return { bytes: completo.length, base: p.c.length };
}

// `resto` com os 10 PLANOS DE IA esvaziados (secao 91), preservando a cauda (Support Targets,
// objetivos) byte a byte. Um plano vazio ocupa 470 B no formato antigo (6 de cabecalho + 16 slots
// de 29) e e copiado literalmente de um plano "Not Used" da propria base — nada e inventado.
export function restoSemPlanos(base) {
  const p = pecas(base); const r = lerPlanos(base);
  if (!r.confiavel) throw new Error('planos da base ilegiveis: nao da para esvaziar com seguranca');
  const desloc = r.ini - (p.m.fimGrade + 4 * p.W * p.H);
  if (desloc !== 48) throw new Error(`regiao de IA em +${desloc} do resto, esperava 48`);
  const vazios = r.planos.filter((q) => q.uso === 0 && !q.grupos.length);
  const par = vazios.find((q, i) => i + 1 < vazios.length && vazios[i + 1].ini - q.ini > 0 && vazios[i + 1].ini - q.ini < 600);
  if (!par) throw new Error('a base nao tem dois planos vazios seguidos para servir de molde');
  const tam = vazios[vazios.indexOf(par) + 1].ini - par.ini;
  const tpl = p.c.subarray(par.ini, par.ini + tam);
  const cauda = p.c.subarray(r.ini + r.cauda, r.ini + 4 + r.len);
  const cinco = Buffer.alloc(4); cinco.writeUInt32LE(5);
  const planos = []; for (let k = 0; k < 10; k++) { if (k % 5 === 0) planos.push(cinco); planos.push(tpl); }
  const corpo = Buffer.concat([...planos, cauda]);
  const len = Buffer.alloc(4); len.writeUInt32LE(corpo.length);
  return { resto: Buffer.concat([p.resto.subarray(0, 48), len, corpo]), tamPlano: tam, bytesCauda: cauda.length, lenAntes: r.len, lenDepois: corpo.length };
}

// GRADE: `fn(x,y)` devolve {tipo, estrada, foliage, arvore, flags, zona, rotulo}. Ordem y*W+x a partir
// da borda SUL (secao 69/74). `rotulo` liga o bit 0x80 do byte0 e embute `u16 len | texto` (secao 92).
//
// FOLHAGEM (E86, medida pintando a paleta: ZZ MAPA/H6 FOLHAGEM): byte2 e a ESPECIE e o 0x40 do byte3
// diz que ha uma arvore ali — Tree A..H = 0..7, Bush A..C = 8..10. O Tree A e o valor 0, entao so a
// flag o distingue de "nada" (`arvore: true`). Brush (mato baixo) e byte2 = 32 SEM a flag (nos mapas
// reais, 3696 tiles 32 sem flag contra 13 com). Sem `arvore`, a flag segue o costume antigo: acesa
// para 1..31, apagada para 0 e para o mato.
export function montarGrade(W, H, fn) {
  const p = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = fn(x, y) || {};
    const arvore = t.arvore ?? (t.foliage > 0 && t.foliage < 32);
    const b = Buffer.from([(t.tipo || 0) & 0x7f, t.estrada || 0, t.foliage || 0, (t.flags || 0) | (arvore ? 0x40 : 0), ((t.zona || 0) & 7) << 5]);
    if (t.rotulo) { b[0] |= 0x80; const s = Buffer.from(t.rotulo, 'latin1'); const n = Buffer.alloc(2); n.writeUInt16LE(s.length); p.push(b, n, s); }
    else p.push(b);
  }
  return Buffer.concat(p);
}

// ESTRADAS: TIPO, FORMA E ROTACAO (E86, medido no editor: ZZ MAPA/H1..H4 RUAS).
//
// Um tile de estrada NAO se liga sozinho aos vizinhos: cada tile guarda uma PECA, e o motor desenha
// so aquela peca. O Mucuge ate a v7 gravava 19 (Paved 1 reto) com rotacao 0 em toda rua — e toda rua
// virou uma fila de tracinhos norte-sul, porque o editor faz o mesmo quando se clica tile a tile com
// a seta "cima". Quem liga as pecas e a Draw Tool do editor (dois cliques), e o que ela grava e:
//   byte1 (estrada) = base do tipo + forma      base = 1 + 9*t: Dirt 1, Gravel 10, Paved 1 19,
//                                                Paved 2 28, Foot Path 37, Railroad 55, Stream 64,
//                                                Highway 73
//   forma (0..8, a ordem do painel de pecas): 0 reta, 1 meia-diagonal, 2 ?, 3 curva, 4 ?, 5 T,
//                                             6 ?, 7 ?, 8 cruzamento
//   byte3 & 3 = ROTACAO: 0 cima, 1 esquerda, 2 baixo, 3 direita (cada passo gira 90 graus no sentido
//               anti-horario). Reta: 0 norte-sul, 1 leste-oeste. Curva: 0 = E+S, 1 = N+E, 2 = N+W,
//               3 = S+W. T: 0 = N+E+S, 1 = N+E+W, 2 = N+S+W, 3 = E+S+W.
//   byte0 & 0x40 = ESPELHO (as tres ultimas pecas do painel sao as formas 2, 4 e 7 espelhadas; e o
//               "terreno >= 64 sempre com estrada" do censo).
//   Os MUROS usam o mesmo byte1 a partir de 83: base 83 + 11*w (Stone 83 ... Sticks 204), formas
//   0..10, a mesma rotacao — research/folhagem_catalogo.json. Esta funcao so monta estradas.
// A DIAGONAL: a Draw Tool faz uma escada 4-conexa e poe, em cada degrau, a meia-diagonal (forma 1)
// com a MESMA rotacao que a curva teria para aqueles dois vizinhos; so onde o canto e um canto de
// verdade (os dois vizinhos sao retas ou pontas) entra a curva. A regra abaixo reproduz tile a tile as
// linhas que a Draw Tool tracou no H2 (reta, 45 graus, 35 graus, L) e no H4 (quatro cantos, T,
// cruzamento, diagonal noroeste).
//
// `estrada` e o byte de tipo (a base, forma 0) por tile, y*W+x; a funcao devolve o byte final e a
// rotacao por tile. Tiles com o mesmo byte ou com outro tipo de estrada contam como ligados.
export const FORMA = { reta: 0, meiaDiagonal: 1, curva: 3, te: 5, cruz: 8 };
const ROT_CURVA = { ES: 0, NE: 1, NW: 2, SW: 3 };
const ROT_TE = { NES: 0, NEW: 1, NSW: 2, ESW: 3 };
export function montarRuas(W, H, estrada, liga = (a, b) => !!a && !!b) {
  const liga4 = new Uint8Array(W * H);          // bits: 1 N, 2 E, 4 S, 8 W
  const em = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? estrada[y * W + x] : 0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = estrada[y * W + x]; if (!v) continue;
    liga4[y * W + x] = (liga(v, em(x, y + 1)) ? 1 : 0) | (liga(v, em(x + 1, y)) ? 2 : 0) | (liga(v, em(x, y - 1)) ? 4 : 0) | (liga(v, em(x - 1, y)) ? 8 : 0);
  }
  const eCanto = (m) => m === 3 || m === 6 || m === 12 || m === 9;   // N+E, E+S, S+W, W+N
  const byte = new Uint8Array(W * H), rot = new Uint8Array(W * H);
  const conta = { reta: 0, meiaDiagonal: 0, curva: 0, te: 0, cruz: 0 };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, v = estrada[i]; if (!v) continue;
    const m = liga4[i], nome = (m & 1 ? 'N' : '') + (m & 2 ? 'E' : '') + (m & 4 ? 'S' : '') + (m & 8 ? 'W' : '');
    let forma = FORMA.reta, r = 0;
    if (m === 15) { forma = FORMA.cruz; conta.cruz++; }
    else if (ROT_TE[nome] !== undefined) { forma = FORMA.te; r = ROT_TE[nome]; conta.te++; }
    else if (eCanto(m)) {
      r = ROT_CURVA[nome];
      // o degrau de uma escada: algum dos dois vizinhos tambem e canto
      const viz = [[0, 1, 1], [1, 0, 2], [0, -1, 4], [-1, 0, 8]].filter(([, , b]) => m & b).map(([dx, dy]) => liga4[(y + dy) * W + (x + dx)]);
      if (viz.some(eCanto)) { forma = FORMA.meiaDiagonal; conta.meiaDiagonal++; } else { forma = FORMA.curva; conta.curva++; }
    } else { r = (m & 5) || !(m & 10) ? 0 : 1; conta.reta++; }    // ponta ou reta: norte-sul se tocar N/S
    byte[i] = v + forma; rot[i] = r;
  }
  return { byte, rot, conta };
}

// PONTES NAS TRAVESSIAS (E86). Rua sobre agua vira agua no 3-D (o motor desenha o espelho por cima)
// e Water nao da passagem: sem ponte, toda rua que cruza o rio fica cortada para veiculo. Cada trecho
// conexo de tiles "rua E agua" ganha uma ponte de concreto centrada nele, no eixo mais comprido do
// trecho, com comprimento que cubra a agua e uma margem de cada lado (24, 40 ou 56 m = 3, 5, 7 tiles).
// A rua continua embaixo, como nos mapas reais. `agua(x,y)` diz se o tile e agua.
export function pontesNasTravessias(W, H, estrada, agua) {
  const visto = new Uint8Array(W * H), pontes = [], longas = [], recusadas = [];
  const cruza = (x, y) => x >= 0 && y >= 0 && x < W && y < H && estrada[y * W + x] && agua(x, y);
  for (let y0 = 0; y0 < H; y0++) for (let x0 = 0; x0 < W; x0++) {
    if (visto[y0 * W + x0] || !cruza(x0, y0)) continue;
    const pilha = [[x0, y0]], tiles = []; visto[y0 * W + x0] = 1;
    while (pilha.length) {
      const [x, y] = pilha.pop(); tiles.push([x, y]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (cruza(X, Y) && !visto[Y * W + X]) { visto[Y * W + X] = 1; pilha.push([X, Y]); } }
    }
    const xs = tiles.map((t) => t[0]), ys = tiles.map((t) => t[1]);
    const x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys);
    const lesteOeste = x2 - x1 >= y2 - y1;
    // SO TRAVESSIA DE VERDADE. No Mucuge 10 sairam 39 pontes, quase todas enfileiradas ao longo de uma
    // rua que corre COLADA a margem e encosta num tile de agua aqui e ali. Uma travessia tem o rio dos
    // dois lados da rua (na perpendicular, no meio do trecho) e terra depois das duas pontas.
    const cx = Math.round((x1 + x2) / 2), cy = Math.round((y1 + y2) / 2);
    const ehAgua = (x, y) => x >= 0 && y >= 0 && x < W && y < H && agua(x, y);
    const ladoA = lesteOeste ? ehAgua(cx, cy + 1) : ehAgua(cx + 1, cy), ladoB = lesteOeste ? ehAgua(cx, cy - 1) : ehAgua(cx - 1, cy);
    const pontaA = lesteOeste ? !ehAgua(x2 + 1, cy) : !ehAgua(cx, y2 + 1), pontaB = lesteOeste ? !ehAgua(x1 - 1, cy) : !ehAgua(cx, y1 - 1);
    if (!(ladoA && ladoB && pontaA && pontaB)) { recusadas.push({ x: cx, y: cy }); continue; }
    const vao = (lesteOeste ? x2 - x1 : y2 - y1) + 1 + 2;          // agua + uma margem de cada lado
    const tipo = vao <= 3 ? PONTE.concrete24 : vao <= 5 ? PONTE.concrete40 : PONTE.concrete56;
    if (vao > 7) longas.push({ x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2), vao });
    pontes.push({ tipo, x: cx, y: cy, dir: lesteOeste ? 2 : 0, vao });
  }
  return { pontes, longas, recusadas };
}

// ELEVACAO: `fn(x,y)` devolve metros (float). u16 decimetros + u16 flags (1 = posta a mao, secao 71).
//
// A CAMADA E COLUNA A COLUNA: indice `x*H + y` (x de oeste para leste, y de sul para norte) — NAO
// `y*W + x` como a grade de 5 B. Esta funcao escrevia linha a linha ate 20/09/2026, e foi assim que
// o primeiro Mucuge (04/09) entregou ao jogo o relevo da Chapada fatiado no passo errado: um serrote
// de dezenas de metros em todo tile, e o carregamento travou. Tres provas independentes (71.1):
//   - o passo que mais se parece consigo mesmo e H, nao W (348, 202, 226 em tres mapas nao quadrados);
//   - estrada e nivelada: so sob `x*H+y` a inclinacao entre tiles de estrada vizinhos cai para metade
//     da media do mapa (23 de 27 mapas com relevo);
//   - os cliques do laboratorio 40x40 da secao 71 (NO -> 39, NE -> 1599, SO -> 0) dao exatamente isto.
// `marcarManual` aceita tambem uma funcao (x,y) -> bool: o editor marca so os pontos que o autor tocou
// (mediana 10% dos tiles, maximo 51%), e 100% esta fora do envelope dos mapas reais.
export const indiceElevacao = (x, y, W, H) => x * H + y;
export function montarElevacao(W, H, fn, marcarManual = true) {
  const b = Buffer.alloc(4 * W * H);
  const manual = typeof marcarManual === 'function' ? marcarManual : () => !!marcarManual;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = 4 * indiceElevacao(x, y, W, H); const dm = Math.max(0, Math.min(65535, Math.round(fn(x, y) * 10)));
    b.writeUInt16LE(dm, o); b.writeUInt16LE(manual(x, y) ? 1 : 0, o + 2);
  }
  return b;
}

// E o leitor, para que ninguem mais leia com o passo errado.
export function lerElevacao(m) {
  const { c, W, H } = m, e0 = m.fimGrade;
  const em = (x, y) => c.readUInt16LE(e0 + 4 * indiceElevacao(x, y, W, H)) / 10;
  const flag = (x, y) => c.readUInt16LE(e0 + 4 * indiceElevacao(x, y, W, H) + 2);
  return { em, flag, W, H };
}

// CONSTRUCOES (secao 78/94): 1 registro = 1 predio independente, num tile so (nenhum mapa repete
// tile). Cabecalho 17 B = `sub | X u16 | Y u16 | 6 B de estilo | ff ff | count u32`, e count e o
// numero de ANDARES (4 paredes de 4 bytes por andar). X,Y sao MEIO-TILES de canvas: X = 2*(OX+x),
// e o impar (meio tile) e comum nos mapas originais. Como o estilo e as paredes nao estao
// decodificados, cada predio novo e a COPIA de um registro real com X,Y trocados.
export function moldes(caminho, filtro = () => true) {
  const m = lerMapa(caminho);
  return m.construcoes.filter(filtro).map((b) => ({ bytes: Buffer.from(m.c.subarray(b.off, b.off + b.len)), count: b.count, sub: b.sub }));
}

export function montarConstrucoes(lista, OX, OY) {
  const n = Buffer.alloc(4); n.writeUInt32LE(lista.length);
  const p = [n];
  for (const b of lista) {
    const r = Buffer.from(b.molde.bytes);
    r.writeUInt16LE(Math.round(2 * (OX + b.x) + (b.meioX ? 1 : 0)), 1);
    r.writeUInt16LE(Math.round(2 * (OY + b.y) + (b.meioY ? 1 : 0)), 3);
    p.push(r);
  }
  return Buffer.concat(p);
}

// PONTES (7 B: tipo | X u16 | Y u16 | direcao | 0) e FLAVOR (8 B: cat u16 | tipo u16 | X u16 | Y u16).
//
// A PONTE (E86, medida no editor: ZZ MAPA/0I2 e 0I3): X,Y e o tile do CENTRO somado a origem, SEM o
// x2 das construcoes (esta funcao escrevia 2*(OX+x) e nunca foi usada — a lista ia vazia). O byte 5 e
// a direcao em oitavos: 0 norte-sul, 2 leste-oeste (as setas cima/esquerda do editor); os impares sao
// as diagonais. Tipos da paleta Bridges #1: Wood 16F 0, Steel 16R 1, 32R 2, 48R 3, 64R 4, Stone 16F 5,
// Stone 16 7, Stone 16W 14, Urban 16W 18, Concrete 24 46, 40 47, 56 48 (o numero e o comprimento em
// metros; F passarela, R ferrovia, W duas faixas). A ponte nao mexe na grade: nos mapas reais a rua
// continua embaixo dela.
export const PONTE = { wood16F: 0, steel16R: 1, steel32R: 2, steel48R: 3, steel64R: 4, stone16F: 5, stone16: 7, stone16W: 14, urban16W: 18, concrete24: 46, concrete40: 47, concrete56: 48 };
export function montarPontesFlavor(pontes, flavor, OX, OY) {
  const p = []; const n1 = Buffer.alloc(4); n1.writeUInt32LE(pontes.length); p.push(n1);
  for (const b of pontes) { const r = Buffer.alloc(7); r[0] = b.tipo; r.writeUInt16LE(OX + b.x, 1); r.writeUInt16LE(OY + b.y, 3); r[5] = b.dir ?? 0; r[6] = 0; p.push(r); }
  const n2 = Buffer.alloc(4); n2.writeUInt32LE(flavor.length); p.push(n2);
  for (const f of flavor) { const r = Buffer.alloc(8); r.writeUInt16LE(f.cat, 0); r.writeUInt16LE(f.tipo, 2); r.writeUInt16LE(2 * (OX + f.x) + (f.meioX ? 1 : 0), 4); r.writeUInt16LE(2 * (OY + f.y) + (f.meioY ? 1 : 0), 6); p.push(r); }
  return Buffer.concat(p);
}

const EH_MAIN = process.argv[1] && /[\\/]mapa_escrever\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {   // TESTE DE IDENTIDADE: reescrever sem mudar nada tem de sair byte a byte igual
  const [base, saida] = process.argv.slice(2);
  const p = pecas(base);
  const remontado = Buffer.concat([p.cabeca, p.construcoes, p.pontesFlavor, p.grade, p.elevacao, p.resto]);
  console.log(`pecas: cabeca ${p.cabeca.length} | construcoes ${p.construcoes.length} | pontes+flavor ${p.pontesFlavor.length} | grade ${p.grade.length} (5*${p.W}*${p.H}=${5 * p.W * p.H}) | elevacao ${p.elevacao.length} | resto ${p.resto.length}`);
  console.log(`remontagem em memoria: ${remontado.equals(p.c) ? 'IDENTICA' : 'DIFERENTE'} (${remontado.length} vs ${p.c.length})`);
  if (saida) {
    escrever(base, saida, {});
    const q = pecas(saida);
    console.log(`ida e volta pelo arquivo: ${q.c.equals(p.c) ? 'IDENTICA' : 'DIFERENTE'} (${q.c.length} vs ${p.c.length})`);
    console.log(`   W,H ${q.W}x${q.H} | gridStart ${q.m.gridStart} (base ${p.m.gridStart}) | iaConfere ${q.m.iaConfere} | construcoes ${q.m.construcoes.length}`);
  }
}
