// A DOUTRINA DO DEFENSOR (autor, 04/10/2026) VIRA UM PLANO DE IA (05/10/2026). As sete regras dele, aplicadas a
// partir do que o mapa tem — sem coordenada escrita a mao, para valer em qualquer mapa de QB:
//   1. suporte estatico em todo o mapa: LMG na linha de frente (os primeiros a receber o jogador); ATGM com vista
//      ampla; HMG e lanca-granadas espalhados na frente e nos objetivos
//   2. blindados: 20 % (os mais baratos) na frente; 60 % nas faixas A/B/C (esquerda, centro, direita do atacante,
//      20 % cada), cada faixa com um trigger de proximidade que move os blindados da faixa VIZINHA pelo flanco
//      (A move B; B move A e C; C move B); 20 % (os mais caros) no objetivo majoritario, que so se movem quando o
//      jogador esta para tocar o objetivo
//   3. MANPADS e SPAAG perto dos objetivos, recuam para o fundo quando o jogador se aproxima
//   4. observadores e controladores aereos no alto e no fundo, sem trigger
//   5. snipers no alto, entre a frente e os objetivos, sem trigger
//   6. infantaria 10 % emboscada avancada (estatica, mata e angulo fechado), 30 % objetivos minoritarios, 60 %
//      majoritario; os dos objetivos recapturam quando ameacados. Sem minoritario (decisao dele, 04/10): os 30 % na
//      regiao do majoritario, em toda a largura do mapa
//   7. morteiros on-map no fundo e no alto
//   Toda entrada com Occupy buildings = Mixed.
//
// Feicoes (sobre a pintura AZUL do mapa, tile (0,0) no SW):
//   dFrente(t) = distancia (Chebyshev, tiles) do tile azul ao tile nao-azul mais proximo (as bordas do mapa nao
//   contam): 0..2 e a borda que encara o atacante. dVerm(t) = distancia a pintura vermelha. Faixas A/B/C = tercos
//   de x (o atacante olha para o norte: A = oeste). Cobertura = Lt/Hvy Forest, arvore, cerca/muro, predio.
//   Alto = elevacao no topo da zona ou predio de 3+ andares. Objetivos = vagas azuis de pontuacao com tiles.
//
// DOUTRINA v2 (06/10/2026), o que o autor ensinou ajustando o Small Village 019r no editor (research/ia/
// small_village_019r_ajustes.md), medido contra as feicoes e escrito como regra geral:
//   a. blindado nao entra em MATA DENSA (Lt/Hvy Forest cercada de mata): os flancos sao a BEIRA da linha de arvores
//      (ate 3 tiles dela), nao o miolo — as zonas dele tinham 6..31 % de mata, as minhas 100 %
//   b. emboscada = BOLSOES 3x3 em abrigo, separados, escalonados em profundidade da frente ate o objetivo, um por
//      esquadra (os dele: 11 bolsoes, dFrente 9..36, 57 % mata e 29 % predio) — nao uma faixa de mata
//   c. os blindados da frente, na hora da pressao, RECUAM de re (Withdraw) para a faixa a frente do objetivo
//   d. MANPADS/SPAAG recuam para o fundo com Withdraw
//   e. observadores nos predios altos do nucleo (2+ andares a ate 6 tiles do objetivo), nao no rim do mapa
//
// A regra do manual que manda na forma: a espera ("Wait For") e a janela de saida ficam na ENTRADA QUE O GRUPO
// DEIXA (como os autores de QB fazem: "G2 Setup espera Obj 2, sai entre ..."); a ordem seguinte e o destino. Uma
// ordem so espera UM trigger: a faixa B espera a UNIAO dos triggers de A e de C (uma vaga so, zona descontinua).
import { lerMapa, lerGrade } from './mapa.mjs';
import { lerElevacao } from './mapa_escrever.mjs';
import { pintura } from './zonas.mjs';
import { decodificar, entrada, slotVazio, trigger, doMapa, paraFormatoNovo, comWithdraw, USO, STANCE } from './ia_escrever.mjs';

const FLORESTA = new Set([38, 39]);
const AGUA = new Set([17, 28, 30, 40, 45]);   // Marsh, Water, Deep Ford, Shallow Ford, Deep Marsh
const TRES_HORAS = 3 * 3600;   // janela dos grupos disparados: so saem com o trigger (o failsafe nunca chega)

// ------------------------------------------------------------------------------------------- feicoes

export function feicoes(arquivo) {
  const m = lerMapa(arquivo); const g = lerGrade(m); const e = lerElevacao(m); const { W, H } = m;
  const idx = (x, y) => y * W + x, dentro = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const z = pintura(arquivo);
  const azul = new Uint8Array(W * H), verm = new Uint8Array(W * H);
  for (const l of z.azul) for (const [x, y] of l.tiles) azul[idx(x, y)] = 1;
  for (const l of z.vermelho) for (const [x, y] of l.tiles) verm[idx(x, y)] = 1;
  const bfs = (semente) => {   // distancia de Chebyshev a partir das sementes
    const d = new Int32Array(W * H).fill(1e9); const fila = [];
    for (let i = 0; i < W * H; i++) if (semente(i)) { d[i] = 0; fila.push(i); }
    for (let k = 0; k < fila.length; k++) { const i = fila[k], x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (!dentro(nx, ny)) continue; const j = idx(nx, ny); if (d[j] > d[i] + 1) { d[j] = d[i] + 1; fila.push(j); } } }
    return d;
  };
  const dFrente = bfs((i) => !azul[i]);            // dentro da zona azul: distancia a borda que encara o resto do mapa
  const dVerm = bfs((i) => verm[i] === 1);
  const dAzul = bfs((i) => azul[i] === 1);          // fora da zona azul: quanto falta para entrar nela
  const rua = new Uint8Array(W * H);
  // AGUA (08/10/2026, rios do Village-Water): Water, Deep/Shallow Ford, Marsh, Deep Marsh (terreno_catalogo)
  const agua = new Uint8Array(W * H), barreira = new Uint8Array(W * H);
  const cobertura = new Uint8Array(W * H), floresta = new Uint8Array(W * H), predio = new Uint8Array(W * H), alturaPredio = new Uint8Array(W * H);
  const zv = new Float64Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = g.tile(x, y), i = idx(x, y); zv[i] = e.em(x, y);
    if (FLORESTA.has(t.tipo) || t.foliageFlag) { floresta[i] = 1; cobertura[i] = 1; }
    if (t.estrada >= 83) cobertura[i] = 1;       // cercas e muros
    else if (t.estrada > 0) rua[i] = 1;          // estrada, trilho, riacho (o riacho e raro em cidade)
    if (AGUA.has(t.tipo)) agua[i] = 1;
    if (AGUA.has(t.tipo) || t.tipo === 37) barreira[i] = 1;   // junco (Reeds) tambem separa as margens (123)
  }
  for (const b of m.construcoes) {
    const x = Math.floor(b.X / 2 - m.OX), y = Math.floor(b.Y / 2 - m.OY);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (dentro(x + dx, y + dy)) { const i = idx(x + dx, y + dy); predio[i] = 1; cobertura[i] = 1; alturaPredio[i] = Math.max(alturaPredio[i], b.count); }
  }
  // ABRIGO (autor, 05/10: "os grupos de armas estaticas preencham casas ou tree lines"): tile de predio ou de mata/
  // arvore. Cerca nao abriga (e campo aberto com arame).
  const abrigo = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) abrigo[i] = predio[i] || floresta[i] ? 1 : 0;
  // MATA DENSA (v2.a): mata cujos 8 vizinhos sao mata — o blindado atola; a beira continua transitavel
  const mataDensa = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y); if (!floresta[i]) continue; let cheia = true;
    for (let dy = -1; dy <= 1 && cheia; dy++) for (let dx = -1; dx <= 1; dx++) if (!dentro(x + dx, y + dy) || !floresta[idx(x + dx, y + dy)]) { cheia = false; break; }
    mataDensa[i] = cheia ? 1 : 0;
  }
  const dMata = bfs((i) => floresta[i] === 1);
  const dAgua = bfs((i) => agua[i] === 1);
  // O LADO DE CA DO RIO: o que se alcanca a partir do objetivo majoritario sem atravessar agua (o vau tambem conta como
  // agua — e por ali que o atacante cruza). Sem agua no mapa, tudo e "de ca".
  const aquem = new Uint8Array(W * H);
  const azuis = []; for (let i = 0; i < W * H; i++) if (azul[i]) azuis.push(i);
  const zs = azuis.map((i) => zv[i]).sort((a, b) => a - b); const pct = (q) => zs[Math.min(zs.length - 1, Math.floor(q * zs.length))];
  const maxFrente = Math.max(...azuis.map((i) => dFrente[i]));
  // objetivos azuis de pontuacao (tipos 0..4) com tiles; majoritario = o de mais pontos
  const d = decodificar(arquivo);
  const objs = d.vagas.filter((v) => v.lado === 'azul' && v.tipo <= 4 && v.tiles.length).map((v) => ({ nome: v.nome.trim(), pontos: v.pontos, tiles: doMapa(d, v.tiles).filter(([x, y]) => dentro(x, y)) }));
  objs.sort((a, b) => b.pontos - a.pontos);
  if (objs[0]?.tiles.length && agua.some((v) => v)) {
    const fila = []; for (const [x, y] of objs[0].tiles) { const i = idx(x, y); if (!agua[i] && !aquem[i]) { aquem[i] = 1; fila.push(i); } }
    for (let k = 0; k < fila.length; k++) { const i = fila[k], x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (!dentro(nx, ny)) continue; const j = idx(nx, ny); if (!agua[j] && !aquem[j]) { aquem[j] = 1; fila.push(j); } } }
  } else aquem.fill(1);
  // O LADO DO JOGADOR (12/10, Town-Water 275): o que se alcanca a partir da pintura VERMELHA sem atravessar agua, vau,
  // pantano ou junco. Quando o objetivo maior e uma ponte (cobre as duas margens), o `aquem` vaza; este nao.
  const ladoJogador = new Uint8Array(W * H);
  { const fila = []; for (let i = 0; i < W * H; i++) if (verm[i] && !barreira[i]) { ladoJogador[i] = 1; fila.push(i); }
    for (let k = 0; k < fila.length; k++) { const i = fila[k], x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (!dentro(nx, ny)) continue; const j = idx(nx, ny); if (!barreira[j] && !ladoJogador[j]) { ladoJogador[j] = 1; fila.push(j); } } } }
  return { m, d, W, H, idx, dentro, azul, verm, dFrente, dVerm, dAzul, cobertura, abrigo, floresta, mataDensa, dMata, rua, agua, barreira, dAgua, aquem, ladoJogador, predio, alturaPredio, z: zv, pct, maxFrente, azuis, objs };
}

// ---------------------------------------------------------------------------------------- as zonas

const tiles = (F, filtro) => F.azuis.filter(filtro).map((i) => [i % F.W, (i / F.W) | 0]);
const doMapaTodo = (F, filtro) => { const out = []; for (let i = 0; i < F.W * F.H; i++) if (filtro(i)) out.push([i % F.W, (i / F.W) | 0]); return out; };
// A DIRECAO DO ATAQUE (06/10/2026, o City 047r, em que o vermelho vem do NORTE): `u` = do centro da pintura vermelha ao
// da azul; a esquerda DO ATACANTE e `u` girado 90 graus no sentido anti-horario. `lat(x, y)` = 0 (direita do atacante)
// .. 1 (esquerda), medido sobre a zona azul. Faixa A = a esquerda do atacante (no Small Village, o oeste; no City, o
// leste), B o centro, C a direita. Antes eram tercos de x, o que so valia com o atacante vindo do sul.
export function eixo(F) {
  let rx = 0, ry = 0, nr = 0, bx = 0, by = 0, nb = 0;
  for (let i = 0; i < F.W * F.H; i++) { const x = i % F.W, y = (i / F.W) | 0; if (F.verm[i]) { rx += x; ry += y; nr++; } if (F.azul[i]) { bx += x; by += y; nb++; } }
  rx /= nr || 1; ry /= nr || 1; bx /= nb || 1; by /= nb || 1;
  let ux = bx - rx, uy = by - ry; const n = Math.hypot(ux, uy) || 1; ux /= n; uy /= n;
  const ex = -uy, ey = ux;   // a esquerda do atacante
  const proj = (x, y) => (x - bx) * ex + (y - by) * ey;
  let lo = Infinity, hi = -Infinity; for (const i of F.azuis) { const p = proj(i % F.W, (i / F.W) | 0); lo = Math.min(lo, p); hi = Math.max(hi, p); }
  const lat = (x, y) => Math.max(0, Math.min(1, (proj(x, y) - lo) / Math.max(1, hi - lo)));
  // o passo de um tile "para tras" (do lado do defensor), arredondado ao eixo dominante
  const passo = Math.abs(uy) >= Math.abs(ux) ? [0, Math.sign(uy)] : [Math.sign(ux), 0];
  return { u: [ux, uy], esq: [ex, ey], lat, largura: hi - lo, passo, vermelhoAo: Math.abs(uy) >= Math.abs(ux) ? (uy > 0 ? 'sul' : 'norte') : (ux > 0 ? 'oeste' : 'leste') };
}
const faixaDe = (E, x, y) => { const t = E.lat(x, y); return t > 2 / 3 ? 'A' : t > 1 / 3 ? 'B' : 'C'; };

// v2.b: os bolsoes de emboscada. Candidato = bloco 3x3 inteiro na zona azul, a 8+ tiles da frente e nao atras do
// objetivo, fora do anel, com 5+ tiles de abrigo. Escolha gulosa por faixa de profundidade (3 faixas em rodizio, os
// mais abrigados primeiro), centros a 7+ tiles (Chebyshev) um do outro; quantos: um por ~90 tiles da zona azul, 6..14.
// 12/10 (os 4 mapas dos agentes): o desempate era x crescente, e num mapa largo todos os bolsoes caiam no oeste; e o
// bloco de mata cheia (abrigo 9) ganhava sempre do de casas. Agora o abrigo conta ate 7 e o desempate e ficar LONGE
// dos ja escolhidos (o primeiro: o mais perto do atacante). `ja`: centros escolhidos antes (cota por pedaco).
export function bolsoes(F, anel, dVermAnel, { minAbrigo = 5, minFrente = 8, regiao = null, quer = null, ja = [] } = {}) {
  const { W, H, idx, dFrente, abrigo, azul } = F;
  const cands = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = idx(x, y); if (!azul[i] || (regiao ? !regiao.has(i) : (dFrente[i] < minFrente || (anel.size && F.dVerm[i] > dVermAnel + 2)))) continue;   // `regiao`: os ajustes do mapa escolhem onde
    let ab = 0, cheio = true; const t = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = idx(x + dx, y + dy); if (!azul[j] || anel.has(j)) cheio = false; ab += abrigo[j]; t.push([x + dx, y + dy]); }
    if (cheio && ab >= minAbrigo) cands.push({ x, y, ab: Math.min(ab, 7), df: dFrente[i], dv: F.dVerm[i], t });
  }
  if (!cands.length) return [];
  quer = quer ?? Math.max(6, Math.min(14, Math.round(F.azuis.length / 90)));
  const dfs = cands.map((c) => c.df).sort((a, b) => a - b); const lo = dfs[0], hi = dfs[dfs.length - 1];
  const faixa = (c) => Math.min(2, Math.floor(3 * (c.df - lo) / Math.max(1, hi - lo + 1)));
  const porFaixa = [0, 1, 2].map((f) => cands.filter((c) => faixa(c) === f));
  const escolhidos = []; const todos = () => [...ja, ...escolhidos];
  const dist = (c) => todos().reduce((m, e) => Math.min(m, Math.max(Math.abs(e.x - c.x), Math.abs(e.y - c.y))), Infinity);
  const melhor = (lista) => { let b = null, bd = -1;
    for (const c of lista) { const d = dist(c); if (d < 7) continue; const dd = d === Infinity ? -c.dv : d;
      if (!b || c.ab > b.ab || (c.ab === b.ab && dd > bd)) { b = c; bd = dd; } }
    return b; };
  while (escolhidos.length < quer) {
    let pegou = false;
    for (const f of [0, 1, 2]) { if (escolhidos.length >= quer) break; const c = melhor(porFaixa[f]); if (c) { escolhidos.push(c); pegou = true; } }
    if (!pegou) break;
  }
  return escolhidos.map((c) => c.t);
}

// MODO URBANO (06/10/2026, o City 047r): `urbano` (o perfil do censo, ou 12 %+ de rua e 15 %+ de predio na zona azul)
//   a. blindado so na RUA ou no aberto colado nela (o patio dentro da quadra prende o veiculo)
//   b. ATGM em predio de 2+ andares colado a uma AVENIDA NO SENTIDO DO ATAQUE (trecho de 25+ tiles de rua ao longo do
//      eixo): ve a avenida inteira por onde o atacante desce
//   c. flancos pelas ruas laterais vizinhas ao centro, em vez da linha de arvores
export function zonas(F, { urbano = null } = {}) {
  const { W, idx, dFrente, cobertura, floresta, predio, alturaPredio, z, pct, maxFrente, mataDensa } = F;
  let rodavel = (i) => !predio[i] && !floresta[i];   // v2.a: onde blindado anda (no modo urbano, so rua: ver abaixo)
  const X = (i) => i % W, Y = (i) => (i / W) | 0;
  const alto = pct(0.75), muitoAlto = pct(0.9);
  const maj = F.objs[0] || null;
  const anel = new Set((maj ? maj.tiles : []).map(([x, y]) => idx(x, y)));
  // o lado do anel voltado ao atacante: os tiles do objetivo mais perto da pintura vermelha (o terco de menor dVerm)
  const anelOrd = [...anel].sort((a, b) => F.dVerm[a] - F.dVerm[b]);
  const anelFrente = new Set(anelOrd.slice(0, Math.max(1, Math.ceil(anelOrd.length / 3))));
  const dVermAnel = anelOrd.length ? F.dVerm[anelOrd[0]] : 1e9;
  const E = eixo(F);
  if (urbano == null) { const n = F.azuis.length || 1; urbano = F.azuis.filter((i) => F.rua[i]).length / n >= 0.12 && F.azuis.filter((i) => F.predio[i]).length / n >= 0.15; }
  const [qx, qy] = E.passo;
  // trecho de rua ao longo do ataque que passa pelo tile (contando para os dois lados)
  const trecho = new Int32Array(F.W * F.H);
  for (let i = 0; i < F.W * F.H; i++) { if (!F.rua[i] || trecho[i]) continue; const x0 = i % F.W, y0 = (i / F.W) | 0; let a = 0, b = 0;
    while (F.dentro(x0 - qx * (a + 1), y0 - qy * (a + 1)) && F.rua[idx(x0 - qx * (a + 1), y0 - qy * (a + 1))]) a++;
    while (F.dentro(x0 + qx * (b + 1), y0 + qy * (b + 1)) && F.rua[idx(x0 + qx * (b + 1), y0 + qy * (b + 1))]) b++;
    for (let k = -a; k <= b; k++) trecho[idx(x0 + qx * k, y0 + qy * k)] = a + b + 1; }
  const vizRua = (i, r = 1) => perto(i, ruaSet, r);
  const ruaSet = new Set(); for (let i = 0; i < F.W * F.H; i++) if (F.rua[i]) ruaSet.add(i);
  const avenida = new Set(); for (let i = 0; i < F.W * F.H; i++) if (trecho[i] >= 25) avenida.add(i);
  const rodaUrb = (i) => !predio[i] && !floresta[i] && (F.rua[i] || vizRua(i, 1));
  if (urbano) rodavel = rodaUrb;
  // a profundidade do objetivo ao longo do ataque (era yMax - yMin, que so valia com o atacante ao sul)
  const spanAnel = anelOrd.length ? F.dVerm[anelOrd[anelOrd.length - 1]] - dVermAnel : 0;
  const perto = (i, conj, r) => { const x = X(i), y = Y(i); for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const j = idx(x + dx, y + dy); if (F.dentro(x + dx, y + dy) && conj.has(j)) return true; } return false; };
  const fundo = maxFrente - Math.max(3, Math.round(maxFrente * 0.2));   // a faixa mais funda da zona azul

  // v4 (07/10/2026, o autor no Small Hills-Forest 023r): ATACANTE NO ALTO. Se o terreno que o atacante pisa diante da
  // borda azul (fora das duas pinturas, ate 10 tiles dela) e mais alto que a frente azul (ate 6 tiles da borda), a frente
  // e uma encosta abaixo dele: metralhadoras, ATGM, HMG e os blindados da frente recuam (a borda fica so para a
  // emboscada) e a defesa se apoia no terreno que domina atras. Ele recuou tudo para oeste do cruzamento e dos morros.
  const media = (lista) => lista.length ? lista.reduce((a, i) => a + z[i], 0) / lista.length : 0;
  const zAtacante = media(doMapaTodo(F, (i) => !F.azul[i] && !F.verm[i] && F.dAzul[i] <= 10).map(([x, y]) => idx(x, y)));
  const zFrenteAzul = media(F.azuis.filter((i) => dFrente[i] <= 6));
  const atacanteNoAlto = zAtacante - zFrenteAzul >= 3;
  const recuo = atacanteNoAlto ? Math.min(12, Math.round(maxFrente * 0.25)) : 0;   // tiles que a linha de apoio recua
  const Z = {};
  // 1.1 LMG: a borda da zona que encara o atacante, em cobertura
  // ZONAS AMPLAS (autor, 05/10: "ao inves de pintar uma pequena area de setup, pinte toda uma zona de forma mais
  // ampla"): a zona de Setup e a REGIAO do papel; a casa ou a mata dentro dela e escolhida na hora de posicionar
  // cada unidade de infantaria (ia_agrupar.posicionarPorGrupo).
  Z.lmg = tiles(F, (i) => dFrente[i] >= 1 + recuo && dFrente[i] <= 10 + recuo);
  // 1.2 ATGM: vista ampla — predio de 3+ andares a ate 25 tiles da frente, ou o alto (p90) a ate 12 da frente
  Z.atgm = tiles(F, (i) => (alturaPredio[i] >= 2 || z[i] >= alto) && dFrente[i] >= 2 + recuo && dFrente[i] <= 25 + recuo);
  if (urbano) { const u = tiles(F, (i) => alturaPredio[i] >= 2 && perto(i, avenida, 1) && dFrente[i] >= 2 && dFrente[i] <= 25); if (u.length >= 8) Z.atgm = u; }
  // 1.3 HMG e lanca-granadas: metade na frente (3..10, cobertura), metade no objetivo
  Z.hmg = tiles(F, (i) => (dFrente[i] >= 3 + recuo && dFrente[i] <= 14 + recuo) || perto(i, anel, 5));
  // 2. blindados da frente: atras da borda (4..10), fora de predio e de mata fechada
  Z.blFrente = tiles(F, (i) => dFrente[i] >= 4 + recuo && dFrente[i] <= 10 + recuo && rodavel(i));
  // a pressao dos blindados da frente: a borda da zona azul que encara o atacante (0..3), fora de predio
  Z.bordaDaFrente = tiles(F, (i) => dFrente[i] <= 3 && rodavel(i));
  // 2. faixas: a posicao de cada faixa (10..22 da frente) e o destino do flanco (3..9 da frente, no lado da faixa
  //    vizinha que encosta nela)
  for (const f of ['A', 'B', 'C']) Z['faixa' + f] = tiles(F, (i) => faixaDe(E, X(i), Y(i)) === f && dFrente[i] >= 10 && dFrente[i] <= 22 && rodavel(i));
  // v3 (06/10/2026, o que o autor fez no Small Village e de novo no City): o flanco de A e o de C AVANCAM na propria
  // metade ate a faixa da frente (ate 14 tiles da borda azul), para pegar de lado o atacante que entra pelo centro — nao
  // recuam para o lado da estacao/objetivo. Onde blindado anda (no modo urbano, rua).
  Z.flancoA_paraB = tiles(F, (i) => { const t = E.lat(X(i), Y(i)); return t >= 0.55 && t <= 0.97 && dFrente[i] <= 14 && rodavel(i); });
  Z.flancoC_paraB = tiles(F, (i) => { const t = E.lat(X(i), Y(i)); return t >= 0.03 && t <= 0.45 && dFrente[i] <= 14 && rodavel(i); });
  Z.flancoB_charneira = tiles(F, (i) => Math.abs(E.lat(X(i), Y(i)) - 0.5) <= 0.25 && dFrente[i] >= 3 && dFrente[i] <= 9 && rodavel(i));       // B: a charneira, alcanca os dois lados
  // 2. reserva do majoritario: atras do objetivo (mais longe do atacante que o anel), fora de predio
  Z.reserva = tiles(F, (i) => F.dVerm[i] > dVermAnel + spanAnel * 0.6 && rodavel(i) && !anel.has(i) && dFrente[i] >= 6 && perto(i, anel, 10));
  // v3 (City, autor): o contra-ataque retoma pelo MIOLO do objetivo — a faixa de 3 a ~7+ tiles para dentro da borda
  // voltada ao atacante, na largura do objetivo e um pouco alem —, nao pela borda exposta
  const latDe = (set) => { const ls = [...set].map((i) => E.lat(X(i), Y(i))); return [Math.min(...ls), Math.max(...ls)]; };
  const miolo = (set, d0, prof, folga) => { const [lo, hi] = latDe(set); return tiles(F, (i) => { const t = E.lat(X(i), Y(i)); return F.dVerm[i] >= d0 + 3 && F.dVerm[i] <= d0 + prof && t >= lo - folga && t <= hi + folga; }); };
  Z.contraAtaque = anel.size ? miolo(anel, dVermAnel, Math.max(7, Math.round(spanAnel * 0.6)), 0.12) : [];
  if (!Z.contraAtaque.length) Z.contraAtaque = [...anelFrente].map((i) => [X(i), Y(i)]);
  // 3. MANPADS/SPAAG: perto do objetivo (ate 4 tiles do anel, do lado de dentro); recuo: o fundo
  Z.aa = tiles(F, (i) => perto(i, anel, 6) && !anelFrente.has(i) && F.dVerm[i] > dVermAnel);
  Z.fundo = tiles(F, (i) => dFrente[i] >= fundo);
  // 4. observadores (v2.e): os predios altos do nucleo (2+ andares a ate 6 tiles do objetivo) e 1 tile em volta; sem
  //    eles, predio de 2+ andares ou alto (p75) na metade de tras
  const nucleo = new Set(tiles(F, (i) => alturaPredio[i] >= 2 && perto(i, anel, 6)).map(([x, y]) => idx(x, y)));
  Z.obs = nucleo.size >= 4 ? tiles(F, (i) => perto(i, nucleo, 1)) : tiles(F, (i) => dFrente[i] >= maxFrente / 2 && (alturaPredio[i] >= 2 || z[i] >= alto));
  // 5. snipers: predio de 3+ andares ou alto (p75) em cobertura, entre a frente e o objetivo
  Z.sniper = tiles(F, (i) => (alturaPredio[i] >= 2 || z[i] >= alto) && dFrente[i] >= 2 && F.dVerm[i] <= dVermAnel + 4);
  // 6. emboscada (v2.b): bolsoes 3x3 em abrigo, separados, escalonados da frente ate o objetivo
  // mapa com pouco abrigo a frente do objetivo: menos de 3 bolsoes pede uma segunda passada mais frouxa (abrigo 3+, 4+ da frente)
  Z.bolsoes = bolsoes(F, anel, dVermAnel); if (Z.bolsoes.length < 3) { const b2 = bolsoes(F, anel, dVermAnel, { minAbrigo: 3, minFrente: 4 }); if (b2.length > Z.bolsoes.length) Z.bolsoes = b2; }
  Z.emboscada = Z.bolsoes.flat();
  // 6. minoritarios (sem minoritario: a regiao do majoritario em toda a largura, fora do anel); majoritario: o anel e
  //    o que encosta nele por dentro
  Z.minoritario = F.objs.length > 1
    ? tiles(F, (i) => F.objs.slice(1).some((o) => o.tiles.some(([x, y]) => Math.max(Math.abs(x - X(i)), Math.abs(y - Y(i))) <= 4)))
    : tiles(F, (i) => F.dVerm[i] >= dVermAnel - 6 && F.dVerm[i] <= dVermAnel + Math.max(4, Math.round(spanAnel * 0.3)) && !anel.has(i));
  // OBJETIVOS MINORITARIOS (06/10/2026): o contra-ataque de cada um e o terco dele voltado ao atacante; o trigger MIN e a
  // aproximacao deles (1..10 tiles, do lado do atacante). Sem minoritario, o G14 fica com o majoritario, como antes.
  const minis = F.objs.slice(1).map((o) => new Set(o.tiles.map(([x, y]) => idx(x, y))));
  const frenteDe = (set) => { const ord = [...set].sort((a, b) => F.dVerm[a] - F.dVerm[b]); return ord.slice(0, Math.max(1, Math.ceil(ord.length / 3))); };
  const dVermMin = (m) => Math.min(...[...m].map((i) => F.dVerm[i]));
  // v3: o miolo de cada minoritario (o autor estendeu o do City West a quase todo o interior)
  Z.contraAtaqueMin = minis.flatMap((m) => { const ds = [...m].map((i) => F.dVerm[i]); const z = miolo(m, Math.min(...ds) - 3, Math.max(7, Math.round((Math.max(...ds) - Math.min(...ds)) * 0.8)), 0.03); return z.length ? z : frenteDe(m).map((i) => [X(i), Y(i)]); });
  Z.majoritario = tiles(F, (i) => anel.has(i) || (perto(i, anel, 2) && F.dVerm[i] >= dVermAnel));
  // v2.c: a faixa a frente do objetivo majoritario (lado do atacante, ate 8 tiles do anel), onde blindado anda — para
  // onde os blindados da frente recuam; sem objetivo, a metade de tras da zona
  Z.frenteDoObjetivo = maj ? tiles(F, (i) => rodavel(i) && dFrente[i] >= 10 && !anel.has(i) && perto(i, anel, 8) && F.dVerm[i] <= dVermAnel + 2) : tiles(F, (i) => rodavel(i) && dFrente[i] >= maxFrente / 2);
  // os tiles de Withdraw (o recuo aponta para tras): o centro do objetivo (v2.c) e o centro da beira de tras (v2.d)
  const centro = (lista) => { if (!lista.length) return null; const cx = lista.reduce((a, t) => a + t[0], 0) / lista.length, cy = lista.reduce((a, t) => a + t[1], 0) / lista.length;
    return lista.reduce((b, t) => ((t[0] - cx) ** 2 + (t[1] - cy) ** 2 < (b[0] - cx) ** 2 + (b[1] - cy) ** 2 ? t : b)); };
  const dVermMax = Math.max(...F.azuis.map((i) => F.dVerm[i]));
  const beiraDeTras = tiles(F, (i) => F.dVerm[i] >= dVermMax - 1), latMeio = maj ? maj.tiles.reduce((a, t) => a + E.lat(t[0], t[1]), 0) / maj.tiles.length : 0.5;
  const P = { anelCentro: centro(maj ? maj.tiles : Z.frenteDoObjetivo), fundoCentro: beiraDeTras.length ? beiraDeTras.reduce((b, t) => (Math.abs(E.lat(t[0], t[1]) - latMeio) < Math.abs(E.lat(b[0], b[1]) - latMeio) ? t : b)) : null };   // o recuo do fundo: na beira de tras, alinhado com o objetivo
  // 7. morteiros: fundo e alto, fora de predio e de mata
  Z.morteiro = tiles(F, (i) => dFrente[i] >= fundo - 4 && z[i] >= pct(0.6) && !predio[i] && !floresta[i]);

  // TRIGGERS (vagas novas do lado azul, tipo 7 = qualquer unidade inimiga): a aproximacao de cada faixa — fora da
  // zona ate 12 tiles dela, ou a borda (0..2) — e a aproximacao do objetivo majoritario (1..10 tiles do anel, do
  // lado do atacante)
  const aprox0 = (f) => doMapaTodo(F, (i) => faixaDe(E, X(i), Y(i)) === f && ((!F.azul[i] && !F.verm[i] && F.dAzul[i] <= 12) || (F.azul[i] && dFrente[i] <= 2)));
  // autor (05/10): o limite de cima dos triggers B e C sobe uns 15 tiles — em cada linha ao longo do ataque, a ponta
  // do trigger do lado do defensor avanca `subir[f]` tiles PARA TRAS (na direcao do ataque, nao mais "para o norte")
  const subir = { A: 0, B: 15, C: 15 };
  const [px, py] = E.passo;
  const aprox = (f) => {
    const base = aprox0(f); if (!subir[f]) return base;
    const chave = (x, y) => (px ? y : x), prog = (x, y) => x * px + y * py;
    const ponta = new Map(); for (const [x, y] of base) { const k = chave(x, y); const q = ponta.get(k); if (!q || prog(x, y) > prog(q[0], q[1])) ponta.set(k, [x, y]); }
    const set = new Set(base.map((t) => t.join())); const out = [...base];
    for (const [x0, y0] of ponta.values()) for (let k = 1; k <= subir[f]; k++) { const x = x0 + px * k, y = y0 + py * k; if (!F.dentro(x, y) || F.verm[idx(x, y)] || set.has(x + ',' + y)) continue; set.add(x + ',' + y); out.push([x, y]); }
    return out;
  };
  const T = { A: aprox('A'), B: aprox('B'), C: aprox('C') };
  T.AC = [...T.A, ...T.C];
  T.MAJ = doMapaTodo(F, (i) => !anel.has(i) && perto(i, anel, 10) && F.dVerm[i] < dVermAnel && !F.verm[i]);
  if (minis.length) T.MIN = doMapaTodo(F, (i) => !F.verm[i] && !anel.has(i) && minis.some((m) => !m.has(i) && perto(i, m, 10) && F.dVerm[i] < dVermMin(m)));
  return { Z, T, P, E, urbano, atacanteNoAlto, desnivel: +(zAtacante - zFrenteAzul).toFixed(1), recuo, anel: anel.size, maj: maj ? maj.nome : null, alto, muitoAlto, fundo, maxFrente };
}

// AJUSTES DE UM MAPA (06/10/2026): zonas desenhadas a mao por cima da doutrina, para quando a regra geral nao le o
// mapa direito (o City 047r: cidade em grade, avenidas no sentido do ataque). Cada zona = uniao de pedacos
// { ret: [x0, x1, y0, y1] (tiles do mapa, inclusivos), filtro: 'rua'|'rua+' (rua ou colado nela)|'rodavel'|'abrigo'|'predio'|'predio2'|'predio3'|
// 'aberto'|'tudo'|'encara'|..., fora?: true (exige fora da pintura azul permitido; padrao: so dentro da azul para Setup),
// zMin?: metros (28/10: so o chao a essa altura ou mais), alcance?: tiles do 'encara' (40) }.
// `ajustes.zonas` substitui Z[nome]; `ajustes.triggers` substitui T[nome]; `ajustes.pontos` substitui P[nome].
// O arquivo de ajustes de cada mapa mora em research/ia/<mapa>.ajustes.json.
// o centro da pintura vermelha (de onde vem o atacante), calculado uma vez por mapa
function centroVermelho(F) {
  if (!F._centroVerm) { let sx = 0, sy = 0, n = 0; for (let i = 0; i < F.W * F.H; i++) if (F.verm[i]) { sx += i % F.W; sy += (i / F.W) | 0; n++; } F._centroVerm = [sx / (n || 1), sy / (n || 1)]; }
  return F._centroVerm;
}

// DE ONDE VEM O ATACANTE, POR TILE (12/10, Open-Rough 035r): a direcao ao tile vermelho MAIS PERTO (antes era o centro
// da pintura vermelha, que num mapa com o atacante num canto e a frente em L aponta o lado errado de um vale). Um
// pedaco pode fixar a direcao com `de: [x, y]` (o ponto de onde o atacante chega aquele trecho).
function origemVermelha(F) {
  if (!F._origemVerm) { const o = new Int32Array(F.W * F.H).fill(-1); const fila = [];
    for (let i = 0; i < F.W * F.H; i++) if (F.verm[i]) { o[i] = i; fila.push(i); }
    for (let k = 0; k < fila.length; k++) { const i = fila[k], x = i % F.W, y = (i / F.W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) { const nx = x + dx, ny = y + dy; if (!F.dentro(nx, ny)) continue; const j = F.idx(nx, ny); if (o[j] < 0) { o[j] = o[i]; fila.push(j); } } }
    F._origemVerm = o; }
  return F._origemVerm;
}
function paraAtacante(F, i, p) {
  const x = i % F.W, y = (i / F.W) | 0; let tx, ty;
  if (p?.de) [tx, ty] = p.de;
  else { const o = origemVermelha(F)[i]; if (o < 0) [tx, ty] = centroVermelho(F); else { tx = o % F.W; ty = (o / F.W) | 0; } }
  let ux = tx - x, uy = ty - y; const n = Math.hypot(ux, uy) || 1; return [ux / n, uy / n];
}
// CLAREIRA PRESA (12/10, Village-Hills 272): aberto pequeno (ate 80 tiles) cercado de mata em 60 %+ da volta — o
// blindado entra pela trilha e fica preso; `rodavel` e `rua+` nao contam esses tiles
function presas(F) {
  if (!F._presa) { const P = new Uint8Array(F.W * F.H), visto = new Uint8Array(F.W * F.H);
    const livre = (j) => !F.floresta[j] && !F.predio[j] && !F.agua[j];
    for (let s = 0; s < F.W * F.H; s++) { if (visto[s] || !livre(s)) continue;
      const comp = [s]; visto[s] = 1; let mata = 0, volta = 0;
      for (let k = 0; k < comp.length && comp.length <= 81; k++) { const i = comp[k], x = i % F.W, y = (i / F.W) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (!F.dentro(nx, ny)) continue; const j = F.idx(nx, ny);
          if (livre(j)) { if (!visto[j]) { visto[j] = 1; comp.push(j); } } else { volta++; if (F.floresta[j]) mata++; } } }
      if (comp.length <= 80 && volta && mata / volta >= 0.6) for (const i of comp) P[i] = 1;
      else if (comp.length > 80) { // termina de marcar o componente grande como visto
        for (let k = 0; k < comp.length; k++) { const i = comp[k], x = i % F.W, y = (i / F.W) | 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (!F.dentro(nx, ny)) continue; const j = F.idx(nx, ny); if (livre(j) && !visto[j]) { visto[j] = 1; comp.push(j); } } } } }
    F._presa = P; }
  return F._presa;
}
// CONTRAENCOSTA (12/10, pedido dos 4 mapas): tile que o RELEVO esconde de quem vem do atacante. Tres raios (a direcao
// do atacante e +-20 graus) ate 160 tiles (1,3 km); o tile esta escondido se nenhum ponto FORA da pintura azul ao longo deles o
// enxerga (olho a 2,5 m, alvo a 2,5 m; so o relevo, sem arvore nem predio — a mata em volta e lucro).
// ENCARA (28/10/2026, Open-Hills 315: os blindados no morro do Lake Resort paravam na encosta de tras): o tile cujo
// chao, nos mesmos tres raios para o atacante, ate `p.alcance` tiles (40 = 320 m), nunca sobe acima do olho (z + 2,5).
// Crista e encosta da frente passam; a de tras nao (a crista a poucos tiles tapa). O contraEncosta olha o raio inteiro
// ate o atacante e num morro isolado diz "visto" para os dois lados; este olha so o relevo perto.
function encara(F, i, p) {
  const x0 = i % F.W, y0 = (i / F.W) | 0, h0 = F.z[i] + 2.5; const [ux, uy] = paraAtacante(F, i, p); const alcance = p?.alcance ?? 40;
  for (const ang of [0, 0.35, -0.35]) {
    const c = Math.cos(ang), s = Math.sin(ang), dx = ux * c - uy * s, dy = ux * s + uy * c;
    for (let k = 1; k <= alcance; k++) { const x = Math.round(x0 + dx * k), y = Math.round(y0 + dy * k); if (!F.dentro(x, y)) break; if (F.z[F.idx(x, y)] > h0) return false; }
  }
  return true;
}
function escondido(F, i, p) {
  const x0 = i % F.W, y0 = (i / F.W) | 0, h0 = F.z[i] + 2.5; const [ux, uy] = paraAtacante(F, i, p);
  for (const ang of [0, 0.35, -0.35]) {
    const c = Math.cos(ang), s = Math.sin(ang), dx = ux * c - uy * s, dy = ux * s + uy * c; let maxTan = -Infinity;
    for (let k = 1; k <= 160; k++) { const x = Math.round(x0 + dx * k), y = Math.round(y0 + dy * k); if (!F.dentro(x, y)) break; const j = F.idx(x, y);
      const t = (F.z[j] + 2.5 - h0) / (8 * k);
      if (!F.azul[j] && t >= maxTan) return false;   // daquele ponto o atacante ve o tile
      maxTan = Math.max(maxTan, (F.z[j] - h0) / (8 * k)); }
  }
  return true;
}

export function zonaManual(F, pedacos, { soAzul = true } = {}) {
  const ok = {
    tudo: () => true, rua: (i) => F.rua[i], predio: (i) => F.predio[i], predio2: (i) => F.alturaPredio[i] >= 2, predio3: (i) => F.alturaPredio[i] >= 3,
    abrigo: (i) => F.abrigo[i], aberto: (i) => !F.predio[i] && !F.floresta[i],
    aquem: (i) => F.aquem[i], beiraRio: (i) => F.aquem[i] && !F.agua[i] && F.dAgua[i] <= 5,
    rodavel: (i) => !F.predio[i] && !F.floresta[i] && !presas(F)[i],   // fora de predio e de QUALQUER mata (12/10, autor: blindado nunca dentro de floresta, fica preso; na borda sim) e fora de clareira presa. Antes: so fora de mata densa
    contraEncosta: (i, p) => escondido(F, i, p),
    encara: (i, p) => encara(F, i, p),
    // 12/10 (Hills-Water 037r): a BORDA da mata (tile de mata com um vizinho fora dela, que nao seja agua) e a CLAREIRA
    // junto da mata (aberto a ate 2 tiles dela)
    bordaMata: (i) => F.floresta[i] && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const x = i % F.W + dx, y = ((i / F.W) | 0) + dy; if (!F.dentro(x, y)) return false; const j = F.idx(x, y); return !F.floresta[j] && !F.agua[j]; }),
    clareira: (i) => !F.floresta[i] && !F.predio[i] && !F.agua[i] && F.dMata[i] <= 2,
    // 12/10 (licao do Podlypyky 088, usado no Plehany 099): a borda da mata QUE ENCARA O ATACANTE — tile de mata com um
    // tile fora da mata e fora da agua a ate 3 tiles na direcao do centro da pintura vermelha. Sem as bordas internas
    // nem as de tras, que o `bordaMata` tambem pega.
    bordaFrente: (i, p) => {
      if (!F.floresta[i]) return false;
      const x = i % F.W, y = (i / F.W) | 0; const [ux, uy] = paraAtacante(F, i, p);
      const aberto = (k) => { const nx = Math.round(x + ux * k), ny = Math.round(y + uy * k); if (!F.dentro(nx, ny)) return null; const j = F.idx(nx, ny); return !F.floresta[j] && !F.agua[j]; };
      // o primeiro aberto a ate 3 tiles e os 3 seguintes tambem abertos: a borda da para FORA da mata, nao para uma
      // clareira interna; e a propria arvore solta no campo nao conta (precisa de mata atras dela)
      for (let k = 1; k <= 3; k++) { const a = aberto(k); if (a === null) return false; if (a) { for (let q = k + 1; q <= k + 3; q++) if (aberto(q) === false) return false; const atras = F.dentro(x - Math.round(ux), y - Math.round(uy)) && F.floresta[F.idx(x - Math.round(ux), y - Math.round(uy))]; return !!atras; } }
      return false;
    },
    'rua+': (i) => !F.predio[i] && !F.floresta[i] && !presas(F)[i] && (F.rua[i] || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => F.dentro(i % F.W + dx, ((i / F.W) | 0) + dy) && F.rua[F.idx(i % F.W + dx, ((i / F.W) | 0) + dy)])),
  };
  const set = new Set(); const out = [];
  for (const p of pedacos) {
    // `filtro` pode ser uma lista (12/10): todos precisam valer, ex. ["rodavel", "contraEncosta"]
    const fs_ = [].concat(p.filtro || 'tudo').map((n) => { if (!ok[n]) throw new Error(`filtro desconhecido: ${n}`); return ok[n]; });
    // `faixa` (17/10, 077r: as "linhas" vermelhas, amarelas e roxa do desenho): peca { faixa: [[x,y],...], largura } =
    // os tiles a ate largura/2 da polilinha; o `ret` e a caixa dela
    const meia = p.faixa ? (p.largura ?? 3) / 2 : 0;
    const dLinha = (x, y) => Math.min(...p.faixa.slice(1).map(([bx, by], k) => { const [ax, ay] = p.faixa[k]; const L2 = (bx - ax) ** 2 + (by - ay) ** 2; const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2)) : 0; return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))); }));
    const [x0, x1, y0, y1] = p.faixa ? [Math.floor(Math.min(...p.faixa.map((q) => q[0])) - meia), Math.ceil(Math.max(...p.faixa.map((q) => q[0])) + meia), Math.floor(Math.min(...p.faixa.map((q) => q[1])) - meia), Math.ceil(Math.max(...p.faixa.map((q) => q[1])) + meia)] : p.ret;
    const f = (i) => fs_.every((g) => g(i, p));
    for (let y = Math.max(0, y0); y <= Math.min(F.H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(F.W - 1, x1); x++) {
      const i = F.idx(x, y); if (set.has(i) || F.verm[i]) continue;
      if (p.faixa && dLinha(x, y) > meia) continue;
      if ((soAzul && !p.fora) && !F.azul[i]) continue;
      // `aquem`: so do lado do rio do defensor (o do objetivo maior); `alem`: so do lado do atacante (12/10)
      if (p.aquem && !F.aquem[i]) continue;
      if (p.alem && (F.aquem[i] || F.agua[i])) continue;
      // `xy: [min, max]` (12/10, Town-Forest 040r): faixa DIAGONAL, x + y entre min e max (mapas em diagonal)
      if (p.xy && (x + y < p.xy[0] || x + y > p.xy[1])) continue;
      if (p.zMin != null && F.z[i] < p.zMin) continue;
      // `jogador` / `defensor` (12/10, Town-Water 275): a margem do jogador (a partir da pintura vermelha) ou qualquer
      // outra, fora da agua. Para mapas em que o objetivo maior cobre as duas margens e o `aquem` vaza.
      if (p.jogador && !F.ladoJogador[i]) continue;
      if (p.defensor && (F.ladoJogador[i] || F.barreira[i])) continue;
      if (!f(i)) continue;
      set.add(i); out.push([x, y]);
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------ o plano

// Os 16 grupos (o slot = o grupo). `ordem`: o destino depois do trigger; `espera`: o trigger que libera o grupo.
export const GRUPOS = [
  { g: 1, papel: 'hq', zona: 'majoritario', stance: 'Normal' },
  // G2 FORWARD DEPLOYED (autor, 11/10): as metralhadoras leves, as equipes de RPO, os scouts/recon a pe e 10 % das
  // esquadras (ia_agrupar). A zona continua a da linha avancada das LMG (`lmg`), que os ajustes dos mapas ja usam.
  { g: 2, papel: 'avancado', zona: 'lmg', stance: 'Ambush 300' },
  { g: 3, papel: 'atgm', zona: 'atgm', stance: 'Ambush Armor 1000' },
  { g: 4, papel: 'hmg', zona: 'hmg', stance: 'Ambush 600' },
  // `pressao` (autor, 05/10: "movimentar todos os blindados menos os da reserva; se o jogador estiver com dificuldade
  // de tomar os objetivos, a IA se movimenta para dificultar ainda mais"): sem trigger, o grupo sai mesmo assim na
  // hora da pressao (por padrao, metade da batalha). G5, que nao espera trigger, so sai a partir dessa hora.
  { g: 5, papel: 'blFrente', zona: 'blFrente', stance: 'Ambush 600', pressao: true, ordem: { zona: 'frenteDoObjetivo', tipo: 'Quick', stance: 'Active', withdraw: 'anelCentro' } },   // v2.c (era Assault para a borda da frente)
  { g: 6, papel: 'blA', zona: 'faixaA', stance: 'Normal', espera: 'B', pressao: true, ordem: { zona: 'flancoA_paraB', tipo: 'Quick', stance: 'Active' } },
  { g: 7, papel: 'blB', zona: 'faixaB', stance: 'Normal', espera: 'AC', pressao: true, ordem: { zona: 'flancoB_charneira', tipo: 'Quick', stance: 'Active' } },
  { g: 8, papel: 'blC', zona: 'faixaC', stance: 'Normal', espera: 'B', pressao: true, ordem: { zona: 'flancoC_paraB', tipo: 'Quick', stance: 'Active' } },
  { g: 9, papel: 'blReserva', zona: 'reserva', stance: 'Normal', espera: 'MAJ', ordem: { zona: 'contraAtaque', tipo: 'Max Assault', stance: 'Active' } },
  { g: 10, papel: 'aa', zona: 'aa', stance: 'Cautious', espera: 'MAJ', ordem: { zona: 'fundo', tipo: 'Quick', stance: 'Hide', withdraw: 'fundoCentro' } },   // v2.d
  { g: 11, papel: 'obs', zona: 'obs', stance: 'Cautious' },
  { g: 12, papel: 'sniper', zona: 'sniper', stance: 'Cautious' },
  { g: 13, papel: 'emboscada', zona: 'emboscada', stance: 'Ambush 150' },
  // G14 e G15 FICAM ONDE ESTAO (autor, 11/10: "grupos 14 e 15 permanecem onde estao, nao se movem mais"): so o Setup,
  // sem espera e sem ordem — e `fixo` vence os ajustes do mapa (o 017r dava ordem ao G14). Antes o G14 contra-atacava o
  // minoritario (ou o majoritario) e o G15 o majoritario, em Max Assault, quando o trigger MAJ/MIN disparava.
  { g: 14, papel: 'minoritario', zona: 'minoritario', stance: 'Normal', fixo: true },
  { g: 15, papel: 'majoritario', zona: 'majoritario', stance: 'Normal', fixo: true },
  { g: 16, papel: 'morteiro', zona: 'morteiro', stance: 'Normal' },
];
const NOMES_TRIGGER = { A: 'ZZ Trig A (left)', B: 'ZZ Trig B (centre)', C: 'ZZ Trig C (right)', AC: 'ZZ Trig A+C', MAJ: 'ZZ Trig Major Obj', MIN: 'ZZ Trig Minor Objs' };

// Monta o plano 1 (azul) com a doutrina; os planos 2..5 azuis ficam Not Used; o vermelho fica como esta.
// Devolve a estrutura (para `gravar`) e o resumo por grupo.
// `duracaoMin`: o relogio da batalha; `pressao`: a fracao dele em que os blindados com `pressao` saem sem trigger.
// `formatoNovo` fica FALSE (E153: o formato novo trava o editor quando gravado por nos). Sem trailer nao ha Withdraw:
// os recuos v2.c/v2.d saem como ordem normal (Quick para tras) e o autor poe o Withdraw no editor.
export function aplicarDoutrina(arquivo, { duracaoMin = 45, pressao = 0.5, formatoNovo = false, withdraw = [5, 10], perfil = null, ajustes = null } = {}) {
  const horaPressao = Math.round(duracaoMin * 60 * pressao / 30) * 30;   // o editor anda de 30 em 30 s
  const F = feicoes(arquivo); const d = formatoNovo ? paraFormatoNovo(F.d) : F.d; const Zs = zonas(F, { urbano: perfil ? perfil === 'urbano' : null });
  // os ajustes do mapa (zonas de Setup so dentro da pintura azul; destinos de ordem e triggers podem sair dela)
  if (ajustes) {
    const destinos = new Set([...GRUPOS.flatMap((G) => [G.ordem?.zona, G.seMinoritario?.ordem?.zona]), ...Object.values(ajustes.grupos || {}).map((g) => g?.ordem?.zona)].filter(Boolean));
    for (const [k, v] of Object.entries(ajustes.zonas || {})) if (!k.startsWith('_')) Zs.Z[k] = zonaManual(F, v, { soAzul: !destinos.has(k) });
    for (const [k, v] of Object.entries(ajustes.triggers || {})) if (!k.startsWith('_')) Zs.T[k] = zonaManual(F, v, { soAzul: false });
    if (ajustes.triggers?.AC === undefined && (ajustes.triggers?.A || ajustes.triggers?.C)) Zs.T.AC = [...Zs.T.A, ...Zs.T.C];
    for (const [k, v] of Object.entries(ajustes.pontos || {})) if (!k.startsWith('_')) Zs.P[k] = v;
    // `soAquem`: todo Setup e todo destino de ordem ficam do lado de ca do rio — so a emboscada pode ficar alem
    if (ajustes.soAquem) for (const k of Object.keys(Zs.Z)) if (k !== 'bolsoes' && k !== 'emboscada' && Array.isArray(Zs.Z[k])) Zs.Z[k] = Zs.Z[k].filter(([x, y]) => F.aquem[F.idx(x, y)]);
    if (ajustes.bolsoes) {   // { regiao: [pedacos], quer, minAbrigo }: os bolsoes de emboscada so dentro da regiao
      const B = ajustes.bolsoes, minAbrigo = B.minAbrigo ?? 5;
      // cota por pedaco (12/10): pedaco com `quer` tem os seus bolsoes; os sem `quer` dividem o `quer` geral
      const comCota = B.regiao.filter((p) => p.quer), livres = B.regiao.filter((p) => !p.quer);
      const ja = [], out = [];
      const tira = (pedacos, quer) => { const reg = new Set(zonaManual(F, pedacos).map(([x, y]) => F.idx(x, y)));
        const b = bolsoes(F, new Set(), 0, { regiao: reg, quer, minAbrigo, ja: [...ja] });
        for (const t of b) { out.push(t); ja.push({ x: t[4][0], y: t[4][1] }); } };
      for (const p of comCota) tira([p], p.quer);
      if (livres.length) tira(livres, comCota.length ? B.quer ?? undefined : B.quer);
      Zs.Z.bolsoes = out; Zs.Z.emboscada = out.flat();
    }
  }   // formato novo: o Withdraw mora no trailer
  // moldes de ptr/trailer: a 1a entrada do 1o grupo com setup e a 1a ordem do arquivo
  const todas = [...d.azul, ...d.vermelho].flatMap((pl) => pl.slots.flat());
  const moldeSetup = todas.find((e) => e.tiles.length) || todas[0];
  const moldeOrdem = [...d.azul, ...d.vermelho].flatMap((pl) => pl.slots.filter((s) => s.length > 1).flatMap((s) => s.slice(1)))[0] || moldeSetup;
  // as vagas: os triggers novos ocupam as vagas azuis vazias (depois das que o mapa ja usa) e as dos nossos proprios triggers
  // ("ZZ Trig ..."), quando o mapa ja traz um plano autoral (app/data/planos_ia.json): recalcular substitui, nao acumula
  // triggers do mapa (`ajustes.nomesTriggers`: { CHAVE: 'ZZ Trig ...' }) somam-se aos da doutrina
  const NOMES = { ...NOMES_TRIGGER, ...(ajustes?.nomesTriggers || {}) };
  const usados = Object.keys(NOMES).filter((t) => !t.startsWith('_') && Zs.T[t]?.length);   // MIN so com minoritario
  const livres =d.vagas.map((v, k) => ({ v, k })).filter(({ v }) => v.lado === 'azul' && ((!v.tiles.length && !v.nome.trim()) || /^ZZ Trig /.test(v.nome)));
  if (livres.length < usados.length) throw new Error(`so ${livres.length} vagas azuis livres para ${usados.length} triggers`);
  const vagaDe = {};
  usados.forEach((t, n) => { const { k, v } = livres[n]; d.vagas[k] = { ...trigger(d, { nome: NOMES[t], tiles: Zs.T[t] }), lado: 'azul', vaga: v.vaga }; vagaDe[t] = v.vaga; });
  // o plano
  const vazio = slotVazio(d);
  const plano = { uso: USO['Used Frequently'], slots: [] };
  const resumo = [];
  for (const G0 of GRUPOS) {
    // `ajustes.grupos[g]`: o mapa troca a espera, a ordem, a stance ou a pressao de um grupo (ordem: null = sem ordem)
    const G1 = G0.seMinoritario && Zs.T.MIN?.length ? { ...G0, ...G0.seMinoritario } : G0;
    const G2 = ajustes?.grupos?.[G0.g] ? { ...G1, ...ajustes.grupos[G0.g] } : G1;
    // `livre` nos ajustes de um mapa (12/10, Hills-Water 037r: o autor quer o G15 escondido e acionado quando o atacante
    // atravessa o rio) e a unica excecao ao `fixo`; o mapa tambem declara `gruposComOrdem` em planos_ia.json
    const G = G0.fixo && !ajustes?.grupos?.[G0.g]?.livre ? { ...G2, espera: null, ordem: null, pressao: false } : G2;
    if (G.espera && !vagaDe[G.espera] && vagaDe[G.espera] !== 0) throw new Error(`G${G.g} espera o trigger ${G.espera}, que nao existe neste mapa`);
    const setup = Zs.Z[G.zona] || [];
    if (!setup.length) { plano.slots.push(vazio.map((e) => ({ ...e }))); resumo.push({ ...G, setup: 0, nota: 'zona vazia neste mapa' }); continue; }
    // janela de saida do Setup: com trigger, sai quando ele dispara (ate 3 h, ou ate a hora da pressao); sem trigger e
    // com pressao, NAO sai antes da hora da pressao; os demais nao tem para onde ir
    const janela = G.espera ? { a: 0, b: G.pressao ? horaPressao : TRES_HORAS } : G.pressao ? { a: horaPressao, b: horaPressao + 60 } : { a: 0, b: 60 };
    const slot = [entrada(d, { setup: true, stance: G.stance, ...janela, espera: G.espera ? { tipo: 1, i: vagaDe[G.espera], j: 1 } : null, tiles: setup }, moldeSetup)];
    const recuo = formatoNovo && withdraw.includes(G.g) && G.ordem?.withdraw ? Zs.P[G.ordem.withdraw] : null;   // `withdraw`: os grupos que recebem (diagnostico)
    if (G.ordem) { const e = entrada(d, { tipo: G.ordem.tipo, stance: G.ordem.stance, tiles: Zs.Z[G.ordem.zona] }, moldeOrdem); slot.push(recuo ? comWithdraw(d, e, recuo) : e); }
    plano.slots.push(slot);
    resumo.push({ g: G.g, papel: G.papel, setup: setup.length, stance: G.stance, janela, espera: G.espera ? NOMES[G.espera] : null,
      ordem: G.ordem ? `${G.ordem.tipo} ${G.ordem.stance} -> ${G.ordem.zona} (${Zs.Z[G.ordem.zona].length} tiles)${recuo ? `, Withdraw em ${recuo.join(',')}` : ''}` : null,
      ...(G.zona === 'emboscada' ? { bolsoes: Zs.Z.bolsoes.length } : {}) });
  }
  d.azul[0] = plano;
  for (let k = 1; k < 5; k++) d.azul[k] = { uso: USO['Not Used'], slots: Array.from({ length: 16 }, () => vazio.map((e) => ({ ...e }))) };
  return { d, F, Zs, resumo, vagaDe, horaPressao, triggers: Object.fromEntries(usados.map((t) => [t, { nome: NOMES[t], vaga: vagaDe[t] + 1, tiles: Zs.T[t].length }])) };
}
