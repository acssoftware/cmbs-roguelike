// POSICIONAR as unidades de um lado dentro de um retangulo do mapa (metros).
//
// O registro de unidade termina com `10 00 | X f32 | Y f32 | 00 | n | u16 x n` (secao 58). Toda fonte
// comprada no editor sai enfileirada no canto (X ate ~205 m, Y ate ~124 m), e o transplante para
// outro mapa leva as coordenadas junto — por isso a forca "spawna" fora da zona de deployment.
// Aqui a posicao de cada unidade e reescrita: as unidades do lado escolhido sao distribuidas
// numa grade de `passo` metros dentro do retangulo, formacao por formacao, na ordem do arquivo.
// Nada mais muda (nem tamanho, nem tokens): e um patch de 8 bytes por unidade.
import { ler, marcador } from './transplante.mjs';
import { registros, indiceDeTokens, subArvore } from './regs.mjs';
import { codificar, expandir } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';

const plaus = (v) => Number.isFinite(v) && v >= -1 && v <= 8000;

// Onde esta o par X,Y de um registro de unidade [ini, fim): a ULTIMA marca 10 00 seguida de dois
// floats plausiveis (os veiculos tem a lista de assentos depois do par; os times a pe, nada).
export function posicaoDe(cru, ini, fim) {
  for (let p = fim - 10; p >= ini; p--) {
    if (cru[p] !== 0x10 || cru[p + 1] !== 0x00) continue;
    const x = cru.readFloatLE(p + 2), y = cru.readFloatLE(p + 6);
    if (plaus(x) && plaus(y)) return { p, x, y };
  }
  return null;
}

// Lista as unidades com posicao: { id, nome, exercito, lado, x, y, p (offset do X) }.
export function listar(caminho) {
  const d = ler(caminho);
  const R = registros(d.cru).sort((a, b) => a.off - b.off);
  const fimForca = d.tokens[d.tokens.length - 1].pos;
  // LADO E POSICIONAL (secao 68): o cabecalho da forca traz K_azul = numero de formacoes de topo
  // do bloco azul, em ordem de arquivo; as demais sao o bloco vermelho. Nada de exercito: russos
  // podem defender no azul e americanos atacar no vermelho.
  const { completo, mapa } = expandir(d.cru, d.tokens); const inv = new Map(); mapa.forEach((o, i) => { if (o >= 0 && !inv.has(o)) inv.set(o, i); });
  const kAzul = completo.readUInt32LE(inv.get(marcador(d).pos) + 13);
  const pTok = indiceDeTokens(d.tokens); let inicioVerm = R.length, topos = 0;
  for (let i = 0; i < R.length;) { if (!R[i].form) { i++; continue; } if (topos === kAzul) { inicioVerm = i; break; } let e; try { e = subArvore(d.cru, pTok, R, i); } catch { e = i + 1; } topos++; i = Math.max(e, i + 1); }
  const out = [];
  R.forEach((r, i) => {
    if (r.form) return;
    const ini = r.off + 2, fim = (R[i + 1] ? R[i + 1].off : fimForca - 2) + 2;
    const pos = posicaoDe(d.cru, ini, fim);
    if (pos) out.push({ id: r.id, nome: r.nm, exercito: r.army, lado: i < inicioVerm ? 'azul' : 'vermelho', x: pos.x, y: pos.y, p: pos.p + 2, idx: i });
  });
  return { d, R, unidades: out };
}

// Distribui as unidades de `lado` numa grade dentro do retangulo {x0,y0,x1,y1} (metros).
export function posicionar(entrada, saida, lado, ret, passo = 16) {
  const { d, unidades } = listar(entrada);
  const alvo = unidades.filter((u) => u.lado === lado);
  if (!alvo.length) throw new Error(`nenhuma unidade posicionavel no lado ${lado}`);
  const larg = ret.x1 - ret.x0, alt = ret.y1 - ret.y0;
  const cols = Math.max(1, Math.floor(larg / passo)), linhas = Math.max(1, Math.floor(alt / passo));
  if (cols * linhas < alvo.length) throw new Error(`retangulo ${larg}x${alt} m comporta ${cols * linhas} unidades a ${passo} m; sao ${alvo.length}`);
  const cru = Buffer.from(d.cru);
  alvo.forEach((u, k) => {
    const c = k % cols, l = Math.floor(k / cols);
    const x = ret.x0 + passo / 2 + c * passo, y = ret.y0 + passo / 2 + l * passo;
    cru.writeFloatLE(x, u.p); cru.writeFloatLE(y, u.p + 4);
  });
  const b = Buffer.concat([Buffer.from([d.esc, 0x00]), codificar({ cru, tokens: d.tokens }, d.esc)]);
  reconstruir(entrada, saida, (x, k) => (k === 1 ? b : x));
  return { unidades: alvo.length, cols, linhas };
}

const EH_MAIN = process.argv[1] && /[\\/]posicionar\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const [cmd, ...a] = process.argv.slice(2);
  if (cmd === 'listar') {
    const { unidades } = listar(a[0]);
    const por = {};
    unidades.forEach((u) => { const k = u.lado + '/ex' + u.exercito; por[k] = por[k] || { n: 0, xmin: 1e9, xmax: -1e9, ymin: 1e9, ymax: -1e9 }; const e = por[k]; e.n++; e.xmin = Math.min(e.xmin, u.x); e.xmax = Math.max(e.xmax, u.x); e.ymin = Math.min(e.ymin, u.y); e.ymax = Math.max(e.ymax, u.y); });
    for (const [k, e] of Object.entries(por)) console.log(`${k}: ${e.n} unidades, X ${e.xmin.toFixed(1)}..${e.xmax.toFixed(1)}, Y ${e.ymin.toFixed(1)}..${e.ymax.toFixed(1)}`);
  } else if (cmd === 'mover') {
    const [ent, sai, lado, x0, y0, x1, y1, passo] = a;
    const r = posicionar(ent, sai, lado, { x0: +x0, y0: +y0, x1: +x1, y1: +y1 }, passo ? +passo : 16);
    console.log(`${sai}: ${r.unidades} unidades do lado ${lado} em grade ${r.cols}x${r.linhas}`);
  } else console.log('uso: node posicionar.mjs listar <a.btt> | mover <ent.btt> <sai.btt> <azul|vermelho> x0 y0 x1 y1 [passo]');
}

// POSICIONAR EM TILES: distribui as unidades de `lado` sobre um conjunto de tiles (secao 60 —
// listas de areas pintadas do mapa), uma unidade por tile, pulando `passo` tiles entre vizinhas,
// em ordem de linha (Y crescente, X crescente). Centro do tile de 8 m = (8x + 4, 8y + 4).
export function posicionarEmTiles(entrada, saida, lado, tiles, passo = 2) {
  const { d, R, unidades } = listar(entrada);
  const todos = unidades.filter((u) => u.lado === lado);
  if (!todos.length) throw new Error(`nenhuma unidade posicionavel no lado ${lado}`);
  // Unidades AUSENTES (podadas, secao 67) nao existem no jogo: nao consomem tile — vao empilhadas
  // no primeiro tile da zona. Sem isso uma zona pequena (QBSMALL: 74 tiles a passo 2) "nao cabia"
  // 131 unidades das quais so 21 eram reais.
  const alvo = todos.filter((u) => !R[u.idx].ausente), ausentes = todos.filter((u) => R[u.idx].ausente);
  const ord = [...new Set(tiles.map(([x, y]) => x + ',' + y))].map((s) => s.split(',').map(Number))
    .filter(([x, y]) => x % passo === 0 && y % passo === 0).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (ord.length < alvo.length) throw new Error(`${ord.length} tiles (passo ${passo}) para ${alvo.length} unidades ativas`);
  // amostragem uniforme ao longo da zona inteira (nao so as primeiras fileiras): a k-esima unidade
  // vai para o tile de indice floor(k * ord.length / n), o que espalha a forca por toda a area
  const cru = Buffer.from(d.cru); const n = alvo.length;
  alvo.forEach((u, k) => { const [x, y] = ord[Math.floor(k * ord.length / n)]; cru.writeFloatLE(8 * x + 4, u.p); cru.writeFloatLE(8 * y + 4, u.p + 4); });
  ausentes.forEach((u) => { const [x, y] = ord[0]; cru.writeFloatLE(8 * x + 4, u.p); cru.writeFloatLE(8 * y + 4, u.p + 4); });
  const b = Buffer.concat([Buffer.from([d.esc, 0x00]), codificar({ cru, tokens: d.tokens }, d.esc)]);
  reconstruir(entrada, saida, (x, k) => (k === 1 ? b : x));
  return { unidades: alvo.length, ausentes: ausentes.length, tilesDisponiveis: ord.length };
}
