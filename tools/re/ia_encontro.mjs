// A DOUTRINA DO ATACANTE NO ENCONTRO (Meeting Engagement, autor 12/10/2026). A IA azul sai da sua faixa e vai tomar
// o objetivo, em lances, com o relogio coordenando quem anda depois de quem:
//   - TANQUES (G1-3, A/B/C = esquerda/centro/direita do atacante): a ponta de lanca; saem a 1:00, param em cada
//     linha de fase, e a ultima ordem e o assalto a borda do objetivo;
//   - RECONHECIMENTO (G7-9): as mesmas linhas, 2 tiles atras e 1 minuto depois;
//   - LEVES (G4-6): as mesmas linhas, 4 tiles atras e 2 minutos depois; terminam vigiando a borda, de fora;
//   - MECANIZADA (G10-12): seguem uma linha atras dos tanques; quando um tanque do flanco chega a 10 tiles do
//     objetivo (trigger amigo blindado "ZZ Meet Trig L2 X"), os blindados levam as esquadras ao objetivo e elas
//     desmontam (Passengers Dismount na ordem que comeca la);
//   - EQUIPES (G13): esperam os tanques cobrirem o ponto alto (trigger "ZZ Meet Trig High"), vao montadas ate ele e
//     desmontam — nunca no objetivo;
//   - AA (G14): o primeiro ponto alto depois da faixa; G15 livre; G16 o resto (so Setup).
// Ninguem corre direto ao objetivo: nenhum grupo pula uma linha. Variantes nos planos azuis 1-4 (rules.meet):
// balanced, right (o flanco direito reforcado — a receita A/B/C vem na compra — e o esquerdo segura um ponto alto),
// left (espelho) e fire (so quando ha um ponto alto que ve o objetivo inteiro de longe: tanques, leves e recon atiram
// de la por `fireHoldSeconds` antes de descer). O plano 5 fica para o Smoke Rush (Support Targets ainda nao
// decodificados). O lado vermelho nao e tocado.
//
// Janela e espera moram na entrada que o grupo DEIXA (manual do editor; ia_doutrina): a janela do Setup diz quando o
// grupo sai da faixa, a da ordem 2 quando sai da primeira linha, e assim por diante. Segundos absolutos, passo de 30.
//   node tools/re/ia_encontro.mjs "<mapa Meet.btt>" [saida.json]   -> imprime as linhas, os pontos altos e as cadeias
import fs from 'node:fs';
import { feicoes, zonaManual } from './ia_doutrina.mjs';
import { entrada, slotVazio, trigger, USO, alvosDeApoio, codificarAlvos, canvas } from './ia_escrever.mjs';

const TRES_HORAS = 3 * 3600;
const r30 = (s) => Math.max(0, Math.round(s / 30) * 30);
export const FLANCOS = ['A', 'B', 'C'];
export const GRUPOS_ENCONTRO = { tanks: { A: 1, B: 2, C: 3 }, light: { A: 4, B: 5, C: 6 }, recon: { A: 7, B: 8, C: 9 }, mech: { A: 10, B: 11, C: 12 }, teams: 13, aa: 14, spare: 15, rest: 16 };
export const VARIANTES = ['balanced', 'right', 'left', 'fire'];

// A GEOMETRIA DO ENCONTRO: o eixo vai do centro da faixa azul ao centro do objetivo azul de mais pontos; `prog` e a
// distancia ao longo dele, `lat` 0..1 a posicao lateral sobre o mapa inteiro (1 = esquerda do atacante).
// `aberto` (13/10, rules.meet.aberto): calcula tambem as zonas da doutrina de terreno aberto (`Zs.Ab`, zonasAberto).
export function feicoesEncontro(arquivo, { doctrine, assault = null, aberto = null, posicional = null, roteiro = false, ajustes = null } = {}) {
  const F = feicoes(arquivo);
  const { W, H, idx, dentro: noMapa } = F;
  const obj = F.objs[0];
  if (!obj?.tiles.length) throw new Error('o mapa nao tem objetivo azul com tiles');
  let bx = 0, by = 0, nb = 0; for (const i of F.azuis) { bx += i % W; by += (i / W) | 0; nb++; } bx /= nb; by /= nb;
  const ox = obj.tiles.reduce((a, t) => a + t[0], 0) / obj.tiles.length, oy = obj.tiles.reduce((a, t) => a + t[1], 0) / obj.tiles.length;
  let ux = ox - bx, uy = oy - by; const n = Math.hypot(ux, uy) || 1; ux /= n; uy /= n;
  const ex = -uy, ey = ux;   // a esquerda do atacante
  const prog = (x, y) => (x - bx) * ux + (y - by) * uy;
  let lo = Infinity, hi = -Infinity; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = (x - bx) * ex + (y - by) * ey; lo = Math.min(lo, p); hi = Math.max(hi, p); }
  const lat = (x, y) => Math.max(0, Math.min(1, ((x - bx) * ex + (y - by) * ey - lo) / Math.max(1, hi - lo)));
  const faixa = (x, y) => { const t = lat(x, y); return t > 2 / 3 ? 'A' : t > 1 / 3 ? 'B' : 'C'; };
  const rodavel = (i) => !F.predio[i] && !F.floresta[i] && !F.agua[i] && !F.verm[i];
  const X = (i) => i % W, Y = (i) => (i / W) | 0;
  const pStart = Math.max(...F.azuis.map((i) => prog(X(i), Y(i))));
  const objSet = new Set(obj.tiles.map(([x, y]) => idx(x, y)));
  const pObj = obj.tiles.map(([x, y]) => prog(x, y));
  const pNear = Math.min(...pObj), pFar = Math.max(...pObj);
  const D = pNear - pStart;
  const todos = (filtro) => { const out = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = idx(x, y); if (filtro(i, x, y)) out.push([x, y]); } return out; };
  const banda = (p0, p1, f, extra = () => true) => todos((i, x, y) => { const p = prog(x, y); return p >= p0 && p < p1 && (!f || faixa(x, y) === f) && rodavel(i) && extra(i, x, y); });
  // uma banda que ficou vazia (mata, agua) alarga 2 tiles para cada lado, ate 3 vezes
  const bandaOuPerto = (p0, p1, f, min = 6) => { let z = []; for (let k = 0; k <= 3 && z.length < min; k++) z = banda(p0 - 2 * k, p1 + 2 * k, f); return z; };

  // AS LINHAS DE FASE (autor: "sempre mova em tranches"): uma a cada ~20 tiles entre a faixa e o objetivo, a ultima a
  // `assaultLine` (10) tiles dele; num mapa pequeno (D < smallMapTiles) uma linha so, no meio.
  const Dc = doctrine;
  const linhas = [];
  if (D < Dc.smallMapTiles) linhas.push(pStart + Math.round(D * 0.5));
  else { const k = Math.max(1, Math.floor((D - Dc.assaultLine) / 20)); for (let q = 1; q <= k; q++) linhas.push(pStart + Math.round((D - Dc.assaultLine) * q / (k + 1))); linhas.push(pNear - Dc.assaultLine); }
  const L = linhas.map((p) => Object.fromEntries(FLANCOS.map((f) => [f, bandaOuPerto(p, p + 3, f)])));

  // OS PONTOS ALTOS (equipes): tiles altos (percentil 90 do mapa) ou predio de 3+ andares, entre a faixa e o
  // objetivo, que veem o objetivo; a nota e a fracao de 24 tiles do objetivo visiveis (LOS pelo relevo; 4+ tiles de
  // mata seguidos ou um predio no caminho tapam). O alto do AA: o primeiro tile alto (percentil 75) depois da faixa.
  const zs = []; for (let i = 0; i < W * H; i++) if (!F.agua[i]) zs.push(F.z[i]); zs.sort((a, b) => a - b);
  const pct = (q) => zs[Math.min(zs.length - 1, Math.floor(q * zs.length))];
  const amostra = obj.tiles.filter((_, k) => k % Math.max(1, Math.floor(obj.tiles.length / 24)) === 0).slice(0, 24);
  const ve = (x0, y0, x1, y1, olho) => {
    const h0 = F.z[idx(x0, y0)] + olho, h1 = F.z[idx(x1, y1)] + 2.5; const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    let mata = 0;
    for (let k = 1; k < n; k++) { const x = Math.round(x0 + (x1 - x0) * k / n), y = Math.round(y0 + (y1 - y0) * k / n); const i = idx(x, y);
      if (F.z[i] > h0 + (h1 - h0) * k / n) return false;
      if (F.predio[i] && k > 2 && k < n - 1) return false;
      mata = F.floresta[i] ? mata + 1 : 0; if (mata >= 4) return false; }
    return true;
  };
  const nota = (x, y) => { const olho = F.alturaPredio[idx(x, y)] >= 3 ? 8 : 2.5; return amostra.filter(([tx, ty]) => ve(x, y, tx, ty, olho)).length / amostra.length; };
  const altos = todos((i, x, y) => { const p = prog(x, y); return p >= pStart + 2 && p <= pNear - 4 && !objSet.has(i) && !F.agua[i] && !F.verm[i] && (F.z[i] >= pct(0.9) || F.alturaPredio[i] >= 3); })
    .map(([x, y]) => ({ x, y, nota: nota(x, y), d: pNear - prog(x, y) }));
  altos.sort((a, b) => b.nota - a.nota || b.d - a.d);
  const melhor = altos[0] || null;
  // o aglomerado do melhor ponto: os tiles rodaveis de nota >= 80 % da melhor a ate 4 tiles dele (os veiculos param ali)
  const perto = (c, r) => (t) => Math.max(Math.abs(t.x - c.x), Math.abs(t.y - c.y)) <= r;
  const alto = melhor ? altos.filter((t) => t.nota >= melhor.nota * 0.8 && perto(melhor, 4)(t) && rodavel(idx(t.x, t.y))).map((t) => [t.x, t.y]) : [];
  const altoTimes = alto.length >= 4 ? alto : melhor ? todos((i, x, y) => rodavel(i) && Math.max(Math.abs(x - melhor.x), Math.abs(y - melhor.y)) <= 3) : bandaOuPerto(pStart + Math.round(D * 0.4), pStart + Math.round(D * 0.4) + 3, 'B');
  const candAA = todos((i, x, y) => { const p = prog(x, y); return rodavel(i) && p > pStart && p <= pStart + 0.4 * D && F.z[i] >= pct(0.75); });
  candAA.sort((a, b) => prog(a[0], a[1]) - prog(b[0], b[1]));
  const altoAA = candAA.length ? todos((i, x, y) => rodavel(i) && Math.max(Math.abs(x - candAA[0][0]), Math.abs(y - candAA[0][1])) <= 2) : bandaOuPerto(pStart + 3, pStart + 6, 'B');
  const fogo = melhor && melhor.nota >= 0.8 && melhor.d >= 15 ? altoTimes : null;

  // O OBJETIVO: `frente_f` = a banda logo antes e dentro da borda do objetivo no flanco (onde os tanques assaltam);
  // `dentro_f` = os tiles do objetivo do flanco no terco proximo (onde as esquadras desmontam e ocupam). Um flanco sem
  // objetivo perto toma o do centro.
  const frente = Object.fromEntries(FLANCOS.map((f) => [f, bandaOuPerto(pNear - 3, pNear + 6, f)]));
  const tercoProx = pNear + Math.max(8, (pFar - pNear) * 0.35);
  const dentroDe = (f) => obj.tiles.filter(([x, y]) => (!f || faixa(x, y) === f) && prog(x, y) <= tercoProx && !F.agua[idx(x, y)]);
  const dentro = Object.fromEntries(FLANCOS.map((f) => { const z = dentroDe(f); return [f, z.length >= 6 ? z : dentroDe('B').length >= 6 ? dentroDe('B') : dentroDe(null)]; }));

  // O SETUP na faixa azul, por flanco e profundidade (dFrente: 1 = a beira que encara o mapa): tanques na beira,
  // recon e leves atras, a mecanizada depois, equipes/AA/resto no fundo. Faixa rasa: a banda que faltar pega a faixa toda do flanco.
  const setupDe = (f, d0, d1) => { const z = F.azuis.filter((i) => F.dFrente[i] >= d0 && F.dFrente[i] <= d1 && faixa(X(i), Y(i)) === f).map((i) => [X(i), Y(i)]); return z.length ? z : F.azuis.filter((i) => faixa(X(i), Y(i)) === f).map((i) => [X(i), Y(i)]); };
  const maxF = Math.max(...F.azuis.map((i) => F.dFrente[i]));
  const setup = {
    tanks: Object.fromEntries(FLANCOS.map((f) => [f, setupDe(f, 1, 1)])),
    recon: Object.fromEntries(FLANCOS.map((f) => [f, setupDe(f, 2, 2)])),
    light: Object.fromEntries(FLANCOS.map((f) => [f, setupDe(f, 2, 3)])),
    mech: Object.fromEntries(FLANCOS.map((f) => [f, setupDe(f, 3, 4)])),
    fundo: F.azuis.filter((i) => F.dFrente[i] >= Math.min(4, maxF)).map((i) => [X(i), Y(i)]),
  };
  // ATRAS: uma zona recuada k tiles ao longo do eixo (recon 2, leves 4, mecanizada `followBehind`), so no rodavel
  const atras = (zona, k) => { const z = zona.map(([x, y]) => [Math.round(x - ux * k), Math.round(y - uy * k)]).filter(([x, y]) => noMapa(x, y) && rodavel(idx(x, y)));
    const s = new Set(); return z.filter((t) => { const key = t.join(); if (s.has(key)) return false; s.add(key); return true; }); };

  // OS TRIGGERS AMIGOS: um tanque do flanco a 10 tiles do objetivo (`L2_f`, banda pNear-12..-7) e o ponto alto coberto
  const T = {
    L2_A: banda(pNear - 12, pNear - 7, 'A'), L2_B: banda(pNear - 12, pNear - 7, 'B'), L2_C: banda(pNear - 12, pNear - 7, 'C'),
    High: altoTimes,
  };
  for (const f of FLANCOS) if (T['L2_' + f].length < 6) T['L2_' + f] = bandaOuPerto(pNear - 12, pNear - 7, f);
  // O ASSALTO DIRETO (mapa pequeno, autor 12/10 noite). Zonas proprias, todas trocaveis pelos ajustes do mapa:
  const As = {};
  let Ab = null, Po = null, Ro = null;
  {
    const ASR = assault || {};
    const objT = obj.tiles.filter(([x, y]) => !F.agua[idx(x, y)]);
    const cx = objT.reduce((a, t) => a + t[0], 0) / objT.length, cy = objT.reduce((a, t) => a + t[1], 0) / objT.length;
    const pCentro = prog(cx, cy), lCentro = lat(cx, cy);
    const dCentro = (x, y) => Math.max(Math.abs(x - cx), Math.abs(y - cy));
    const vermP = []; for (let i = 0; i < W * H; i++) if (F.verm[i]) vermP.push(prog(X(i), Y(i)));
    const pRed = Math.min(...vermP);
    const ladoA = (x, y) => lat(x, y) >= lCentro, ladoC = (x, y) => lat(x, y) <= lCentro;
    const lado = { A: ladoA, C: ladoC };
    const perto2 = (conj, r, filtro) => { const s = new Set(conj.map(([x, y]) => idx(x, y))); return todos((i, x, y) => { if (!filtro(i, x, y)) return false; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (noMapa(x + dx, y + dy) && s.has(idx(x + dx, y + dy))) return true; } return false; }); };
    // a rua do centro: tiles de rua na faixa B entre 30 e 60 % do caminho (os tanques descem por ela)
    As.viaRua = todos((i, x, y) => F.rua[i] && rodavel(i) && faixa(x, y) === 'B' && prog(x, y) >= pStart + 0.3 * D && prog(x, y) <= pStart + 0.6 * D);
    if (As.viaRua.length < 3) As.viaRua = bandaOuPerto(pStart + 0.3 * D, pStart + 0.3 * D + 3, 'B');
    // o centro do objetivo: o miolo (a ate 6 tiles do centroide); veiculos no rodavel
    As.centroObj = objT.filter(([x, y]) => dCentro(x, y) <= 6 && rodavel(idx(x, y)));
    if (As.centroObj.length < 6) As.centroObj = objT.filter(([x, y]) => dCentro(x, y) <= 10 && rodavel(idx(x, y)));
    // as casas: cada construcao ocupa 2x2 tiles
    const casas = F.m.construcoes.map((b) => { const x = Math.floor(b.X / 2 - F.m.OX), y = Math.floor(b.Y / 2 - F.m.OY); return { x, y, tiles: [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]].filter(([a, b2]) => noMapa(a, b2)) }; });
    const noObj = (c) => c.tiles.some(([x, y]) => objSet.has(idx(x, y)));
    // as casas do centro do objetivo (a ate `centreHouses` tiles do centroide) e o desmonte colado a elas, do lado azul
    const casasC = casas.filter((c) => noObj(c) && dCentro(c.x, c.y) <= (ASR.centreHouses || 12));
    As.casasCentro = casasC.flatMap((c) => c.tiles);
    // a zona do desmonte INCLUI as casas (autor, 13/10: o Passengers Dismount precisa delas na zona) e o rodavel colado nelas
    const comCasas = (casasT, resto) => { const s = new Set(resto.map((t) => t.join())); return [...casasT.filter((t) => !s.has(t.join())), ...resto]; };
    As.desmonteCentro = comCasas(As.casasCentro, perto2(As.casasCentro, 2, (i, x, y) => rodavel(i) && prog(x, y) <= pCentro + 2));
    // as arvores atras das casas do centro: rodavel colado a mata (dMata <= 1), 4-16 tiles atras do centro, que ve as casas
    const [tb0, tb1] = ASR.treesBehind || [4, 16];
    const amostraC = As.casasCentro.filter((_, k) => k % Math.max(1, Math.floor(As.casasCentro.length / 12)) === 0);
    As.matasAtras = todos((i, x, y) => rodavel(i) && F.dMata[i] <= 1 && prog(x, y) >= pCentro - tb1 && prog(x, y) <= pCentro - tb0
      && amostraC.filter(([tx, ty]) => ve(x, y, tx, ty, 2.5)).length >= Math.max(1, amostraC.length / 4));
    // a borda do flanco (os 4 tiles mais de fora em lat) e a banda dela entre dois progs, alargando ate ter 6 tiles
    const fora = (f) => (x, y) => (f === 'A' ? lat(x, y) >= 1 - 4 / Math.max(1, hi - lo) : lat(x, y) <= 4 / Math.max(1, hi - lo));
    const bandaBorda = (f, p0, p1) => { let z = []; for (let k = 0; k <= 4 && z.length < 6; k++) z = todos((i, x, y) => rodavel(i) && fora(f)(x, y) && prog(x, y) >= p0 - 2 * k && prog(x, y) < p1 + 2 * k); return z; };
    // as casas afastadas do objetivo, do lado azul, em cada lado do eixo: as `farHouses` mais distantes do centro
    for (const f of ['A', 'C']) {
      const cs = casas.filter((c) => !noObj(c) && prog(c.x, c.y) < pCentro - 4 && prog(c.x, c.y) > pStart + 2 && lado[f](c.x, c.y))
        .sort((a, b) => dCentro(b.x, b.y) - dCentro(a.x, a.y)).slice(0, ASR.farHouses || 4);
      As['casasLonge_' + f] = cs.flatMap((c) => c.tiles);
      As['desmonteLonge_' + f] = comCasas(As['casasLonge_' + f], perto2(As['casasLonge_' + f], 2, (i) => rodavel(i)));
      // a borda do flanco: no meio do mapa e a `standoff` tiles do setup do jogador
      const so = ASR.standoff ? (ASR.standoff[0] + ASR.standoff[1]) / 2 : 15;
      As['flancoMeio_' + f] = bandaBorda(f, pCentro - 2, pCentro + 2);
      As['flancoLonge_' + f] = bandaBorda(f, pRed - so - 2, pRed - so + 2);
      // o contato: o terco do objetivo mais perto do jogador, do lado do flanco
      const cont = objT.filter(([x, y]) => prog(x, y) >= pFar - 12 && lado[f](x, y) && rodavel(idx(x, y)));
      As['contato_' + f] = cont.length >= 6 ? cont : objT.filter(([x, y]) => prog(x, y) >= pFar - 12 && rodavel(idx(x, y)));
      // a entrada da esquadra afastada no objetivo: a metade proxima do objetivo, do lado dela
      const ent = objT.filter(([x, y]) => prog(x, y) <= pCentro + 6 && lado[f](x, y));
      As['entraObj_' + f] = ent.length >= 6 ? ent : objT.filter(([x, y]) => prog(x, y) <= pCentro + 6);
      // a guarda do flanco: o terco de fora, entre a borda do objetivo e o centro, colada a mata (cobertura) quando der
      const g = todos((i, x, y) => rodavel(i) && faixa(x, y) === f && prog(x, y) >= pNear && prog(x, y) <= pCentro - 6);
      const gm = g.filter(([x, y]) => F.dMata[idx(x, y)] <= 2);
      As['guarda_' + f] = gm.length >= 6 ? gm : g.length ? g : bandaOuPerto(pNear, pNear + 3, f);
    }
    if (As.matasAtras.length < 4) As.matasAtras = todos((i, x, y) => rodavel(i) && F.dMata[i] <= 2 && prog(x, y) >= pCentro - tb1 - 6 && prog(x, y) <= pCentro - tb0);
    // A INVESTIDA FINAL (autor, 13/10): aos 35:00 a IA vai tomar 3/4 do mapa — a linha a `finalFraction` do caminho da
    // faixa azul a faixa do jogador. `marcha(f, pDe, cobertura)` = os lances de `finalBoundTiles` tiles do ponto de
    // partida ate essa linha, no terco f; a infantaria vai de cobertura a cobertura (abrigo: casa ou mata), os
    // blindados pelo rodavel.
    As.p34 = pStart + (ASR.finalFraction ?? 0.75) * (pRed - pStart);
    // `lateral` (13/10, doutrina aberto): troca o terco f por outro filtro lateral (x, y), ex. a metade do objetivo `lado[f]`
    const bandaDe = (p, f, cobertura, lateral = null) => {
      const filtro = cobertura ? (i) => F.abrigo[i] && !F.verm[i] : rodavel;
      const noLado = lateral || ((x, y) => faixa(x, y) === f);
      let z = []; for (let k = 0; k <= 2 && z.length < 4; k++) z = todos((i, x, y) => filtro(i) && noLado(x, y) && Math.abs(prog(x, y) - p) <= 2 + 2 * k);
      if (z.length < 4) z = todos((i, x, y) => rodavel(i) && noLado(x, y) && Math.abs(prog(x, y) - p) <= 3);
      return z;
    };
    As.marcha = (f, pDe, cobertura, lateral = null) => {
      const passo = ASR.finalBoundTiles || 10; const out = [];
      for (let p = pDe + passo; p < As.p34 - passo / 2; p += passo) out.push(bandaDe(p, f, cobertura, lateral));
      if (As.p34 > pDe + 3) out.push(bandaDe(As.p34, f, cobertura, lateral));
      return out.filter((z) => z.length);
    };
    As.geo = { pCentro, pRed, p34: As.p34, centro: [Math.round(cx), Math.round(cy)] };
    As.lado = lado;
    if (roteiro) Ro = resolvedorRoteiro({ F, marcas: ajustes?.marcas, obj, objSet, casas, comCasas, perto2, todos, rodavel, prog, pCentro, As, setup, lat, lo, hi });
    if (posicional) Po = zonasPosicional({ F, posicional, marcas: ajustes?.marcas, obj, objSet, casas, comCasas, perto2, todos, rodavel, prog, faixa, pCentro });
    if (aberto) Ab = zonasAberto({ F, aberto, obj, objSet, objT, casas, comCasas, perto2, todos, rodavel, prog, lat, faixa, lado, ve, amostra, bandaBorda, bandaOuPerto, As, pStart, pNear, pCentro, ux, uy, bx, by, ex, ey, lo, hi });
  }
  const Zs = { L, frente, dentro, setup, altoTimes, altoAA, fogo, T, atras, As, Ab, Po, Ro };
  // os ajustes do mapa (research/ia/<slug>.meet.ajustes.json) trocam qualquer zona: { "zonas": { "altoTimes": [pedacos],
  // "L0_B": [...], "frente_A": [...], "dentro_C": [...] }, "triggers": { "L2_B": [...] } } — gramatica da zonaManual
  for (const [k, v] of Object.entries(ajustes?.zonas || {})) {
    if (k.startsWith('_')) continue;
    const z = zonaManual(F, v, { soAzul: k.startsWith('setup') });
    const m = k.match(/^(L(\d+)|frente|dentro)_([ABC])$/);
    if (m && m[2] !== undefined) Zs.L[+m[2]][m[3]] = z; else if (m) Zs[m[1]][m[3]] = z; else if (k in Zs.As) Zs.As[k] = z; else if (Zs.Ab && k in Zs.Ab) Zs.Ab[k] = z; else if (Zs.Po && k in Zs.Po) Zs.Po[k] = z; else if (Zs.Ro) Zs.Ro.sobrescrever(k, z); else Zs[k] = z;
  }
  for (const [k, v] of Object.entries(ajustes?.triggers || {})) if (!k.startsWith('_')) Zs.T[k] = zonaManual(F, v, { soAzul: false });
  return { F, Zs, geo: { u: [ux, uy], pStart, pNear, pFar, D, linhas, pequeno: D < Dc.smallMapTiles, melhorAlto: melhor, fogo: !!fogo, prog, lat, faixa } };
}

// O OBJETIVO INTEIRO: o anel pintado e o miolo (o que a borda da caixa do objetivo nao alcanca sem cruzar o anel); num
// objetivo pintado cheio, ele mesmo. Fora a agua. Devolve o Set de indices.
function areaObjetivo(F, obj, objSet) {
  const { idx } = F;
  const xs = obj.tiles.map((t) => t[0]), ys = obj.tiles.map((t) => t[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const fora = new Set(); const fila = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if ((x === x0 || x === x1 || y === y0 || y === y1) && !objSet.has(idx(x, y))) { fora.add(idx(x, y)); fila.push([x, y]); }
  for (let k = 0; k < fila.length; k++) { const [x, y] = fila[k]; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue; const j = idx(nx, ny); if (objSet.has(j) || fora.has(j)) continue; fora.add(j); fila.push([nx, ny]); } }
  const area = new Set(); for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = idx(x, y); if ((objSet.has(i) || !fora.has(i)) && !F.agua[i]) area.add(i); }
  return area;
}

// O RESOLVEDOR DO ROTEIRO (autor 14/10, Small Town-Forest 018r): a doutrina por DADOS. As marcas do desenho
// (ajustes.marcas, gramatica da zonaManual) e as zonas derivadas, por NOME, com cache:
//   <marca> | setup.<tanks|recon|light|mech>.<A|B|C> | setup.fundo | objetivoTodo | objetivoPerto | viaRua
//   desmonte:<marca>      a marca e o rodavel a ate 2 tiles dela (as casas dentro da zona: o Passengers Dismount)
//   casasFora:<m1,m2,..>  as casas do objetivo fora dessas marcas e o rodavel colado a elas, dentro do objetivo
function resolvedorRoteiro(c) {
  const { F, marcas, obj, objSet, casas, comCasas, perto2, rodavel, prog, pCentro, As, setup, lat, lo, hi } = c;
  if (!marcas) throw new Error('o roteiro precisa das marcas do mapa (ajustes.marcas)');
  const { W, idx } = F;
  const cache = new Map();
  let area = null; const naArea = () => (area ||= areaObjetivo(F, obj, objSet));
  // LANCES AO LONGO DE UMA POLILINHA (16/10, Open-Rural 313): uma marca { linha: [[x,y],...] } vira zonas a cada `passo`
  // tiles; cada zona = a cobertura (casa ou mata) a ate 2 tiles do ponto, ou o andavel quando ha pouca. O ultimo ponto
  // da polilinha sempre entra.
  const pontosDa = (nomeMarca, passo) => {
    const linha = marcas[nomeMarca]?.linha; if (!linha || linha.length < 2) throw new Error(`marca ${nomeMarca} nao e uma polilinha`);
    const pontos = []; let resto = passo;
    for (let k = 1; k < linha.length; k++) {
      const [ax, ay] = linha[k - 1], [bx, by] = linha[k]; const L = Math.hypot(bx - ax, by - ay);
      let s = resto; while (s <= L + 1e-9) { pontos.push([ax + (bx - ax) * s / L, ay + (by - ay) * s / L]); s += passo; }
      resto = s - L;
    }
    const fim = linha[linha.length - 1]; const ult = pontos[pontos.length - 1];
    if (!ult || Math.hypot(ult[0] - fim[0], ult[1] - fim[1]) > passo / 3) pontos.push(fim);
    return pontos;
  };
  const quadrado = (px, py, raio, vale) => { const cx = Math.round(px), cy = Math.round(py); const out = []; for (let y = cy - raio; y <= cy + raio; y++) for (let x = cx - raio; x <= cx + raio; x++) { if (!F.dentro(x, y)) continue; const i = idx(x, y); if (vale(i)) out.push([x, y]); } return out; };
  // `raio` (17/10): a licao do 282 no editor — o autor aumentou pontos de 4 e 7 tiles para 60-80; o padrao continua 2
  // `soRodavel` (17/10, 307: lances de IFV pelo lado leste caiam na mata): a zona e o rodavel a ate `raio`, como a rota
  const zonaRodavel = (px, py, raio, minimo) => { const roda = quadrado(px, py, raio, (i) => rodavel(i) && !F.agua[i]); return roda.length >= minimo ? roda : quadrado(px, py, raio, (i) => !F.agua[i] && !F.verm[i]); };
  const lances = (nomeMarca, passo = 10, raio = 2, soRodavel = false) => pontosDa(nomeMarca, passo).map(([px, py]) => {
    if (soRodavel) return zonaRodavel(px, py, raio, 10);
    const anda = quadrado(px, py, raio, (i) => !F.agua[i] && !F.verm[i]);
    const cob = anda.filter(([x, y]) => F.abrigo[idx(x, y)]);
    return cob.length >= 3 ? cob : anda;
  });
  // ROTA (17/10, o que o autor fez no 282 no editor): pontos de passagem para veiculo — so o rodavel a ate `raio` do
  // ponto (60-80 tiles), e as janelas [0-0] (passa sem esperar); com menos de 20 tiles rodaveis, o andavel todo
  // `abrigo` (17/10, 012r: a tracejada da infantaria a pe): a zona prefere cobertura, como os lances
  // sem `abrigo`, um ponto com menos de 20 tiles rodaveis e DESCARTADO (17/10, Balalaikas: a seta cruza a mata do canto
  // NW; blindado nao entra em mata), a nao ser que seja o ultimo
  const rota = (nomeMarca, passo = 10, raio = 4, abrigo = false) => {
    const pts = pontosDa(nomeMarca, passo);
    return pts.map(([px, py], k) => {
      if (abrigo) { const anda = quadrado(px, py, raio, (i) => !F.agua[i] && !F.verm[i]); const cob = anda.filter(([x, y]) => F.abrigo[idx(x, y)]); return cob.length >= 3 ? cob : anda; }
      const roda = quadrado(px, py, raio, (i) => rodavel(i) && !F.agua[i]);
      if (roda.length >= 20) return roda;
      return k === pts.length - 1 ? zonaRodavel(px, py, raio, 20) : null;
    }).filter(Boolean);
  };
  const objPorNome = (n) => F.objs.find((o) => o.nome === n) || F.objs.find((o) => o.nome.toLowerCase().startsWith(n.toLowerCase()));
  const calc = (nome) => {
    if (marcas[nome]?.linha) return lances(nome, 10).flat();
    if (marcas[nome] && !nome.startsWith('_')) return zonaManual(F, marcas[nome], { soAzul: false });
    let m = nome.match(/^setup\.(tanks|recon|light|mech)\.([ABC])$/); if (m) return setup[m[1]][m[2]];
    if (nome === 'setup.fundo') return setup.fundo;
    if (nome === 'objetivoTodo') return [...naArea()].map((i) => [i % W, (i / W) | 0]).filter(([x, y]) => rodavel(idx(x, y)));
    if (nome === 'objetivoPerto') return zona('objetivoTodo').filter(([x, y]) => prog(x, y) <= pCentro);
    if (nome === 'viaRua') return As.viaRua;
    m = nome.match(/^(obj|objRodavel):(.+)$/);
    if (m) { const o = objPorNome(m[2]); if (!o) throw new Error(`objetivo ${m[2]} nao existe no mapa`); const t2 = o.tiles.filter(([x, y]) => !F.agua[idx(x, y)]); return m[1] === 'obj' ? t2 : t2.filter(([x, y]) => rodavel(idx(x, y))); }
    m = nome.match(/^desmonte:(.+)$/); if (m) { const z = zona(m[1]); return comCasas(z, perto2(z, 2, (i) => rodavel(i))); }
    m = nome.match(/^casasFora:(.+)$/);
    if (m) {
      const fora = new Set(m[1].split(',').flatMap((k) => zona(k.trim())).map(([x, y]) => idx(x, y)));
      const ar = naArea();
      const outras = casas.filter((k) => k.tiles.some(([x, y]) => ar.has(idx(x, y))) && !k.tiles.some(([x, y]) => fora.has(idx(x, y)))).flatMap((k) => k.tiles);
      return comCasas(outras, perto2(outras, 1, (i, x, y) => rodavel(i) && ar.has(idx(x, y))));
    }
    throw new Error(`zona desconhecida no roteiro: ${nome}`);
  };
  const zona = (nome) => { if (!cache.has(nome)) cache.set(nome, calc(nome)); return cache.get(nome); };
  // O SETUP ONDE A ROTA COMECA (autor, 28/10, Village-Forest 012r: o def2 nascia no terco do centro e a seta o mandava
  // ~290 m para oeste, de lado). A banda de profundidade do kind (a mesma de `setupDe`: tanks dFrente 1, recon 2, light
  // 2-3, mech 3-4, fundo 4+), sem o filtro de terco, numa janela lateral em torno do ponto: `meia` tiles para cada lado,
  // crescendo x1,5 ate ter `minimo` tiles ou a banda inteira.
  const BANDA = { tanks: [1, 1], recon: [2, 2], light: [2, 3], mech: [3, 4] };
  const setupJanela = (kind, [px, py], { meia: meia0 = 12, minimo = 30 } = {}) => {
    const maxF = Math.max(...F.azuis.map((i) => F.dFrente[i]));
    const [d0, d1] = kind === 'fundo' ? [Math.min(4, maxF), Infinity] : (BANDA[kind] || [1, Infinity]);
    let banda = F.azuis.filter((i) => F.dFrente[i] >= d0 && F.dFrente[i] <= d1);
    if (!banda.length) banda = F.azuis;
    const larg = Math.max(1, hi - lo); const l0 = lat(px, py);
    const tl = (i) => [i % F.W, (i / F.W) | 0];
    for (let meia = meia0, k = 0; k < 12; k++, meia *= 1.5) {
      const z = banda.filter((i) => { const [x, y] = tl(i); return Math.abs(lat(x, y) - l0) * larg <= meia; });
      if (z.length >= minimo || z.length === banda.length) return z.map(tl);
    }
    return banda.map(tl);
  };
  return { zona, lances, rota, setupJanela, sobrescrever: (k, z) => cache.set(k, z), nomes: () => [...cache.keys()] };
}

// AS CADEIAS DO ROTEIRO: o plano `variante` de `roteiro.planos` (ajustes do mapa). Um plano pode ser `como` outro com
// `trocar` [[g1, g2], ...]: as ordens dos dois grupos trocam de lugar e cada um fica com o seu Setup. Uma entrada
// { setup: <zona>, a?, b? } ou { tipo, stance, passenger?, zona, a?, b? }; zona vazia ou nome desconhecido e erro.
export function cadeiasRoteiro({ Zs }, { roteiro, variante, alinhar = true, janela = 12, minimo = 30 }) {
  const Ro = Zs.Ro; if (!Ro) throw new Error('zonas do roteiro nao calculadas (feicoesEncontro sem `roteiro`)');
  const planos = roteiro.planos || {}; const G = roteiro.grupos || {};
  const expandir = (nome, visto = new Set()) => {
    const p = planos[nome]; if (!p) throw new Error(`plano ${nome} nao existe no roteiro`);
    if (!p.como) return p;
    if (visto.has(nome)) throw new Error(`plano ${nome} em ciclo`); visto.add(nome);
    const base = JSON.parse(JSON.stringify(expandir(p.como, visto)));
    for (const [g1, g2] of p.trocar || []) {
      const c1 = base[g1] || [], c2 = base[g2] || [];
      base[g1] = [c1[0], ...c2.slice(1)].filter(Boolean); base[g2] = [c2[0], ...c1.slice(1)].filter(Boolean);
    }
    for (const [g, c] of Object.entries(p)) if (!['como', 'trocar', '_'].includes(g) && Array.isArray(c)) base[g] = c;
    return base;
  };
  const plano = expandir(variante);
  // A ANCORA DO GRUPO (28/10): onde ele comeca a andar — o 1o ponto da 1a rota da cadeia, senao o centro da 1a zona de
  // ordem. A infantaria mecanizada vai dentro do transporte: fica com a ancora dele (alocacao.mech [[veh, inf], ...]).
  const ancora = {};
  const marcas = roteiro.marcas || {};
  for (const [nomeG, cadeia] of Object.entries(plano)) {
    if (nomeG === '_' || !Array.isArray(cadeia)) continue;
    const r = cadeia.find((e) => e.rota || e.lances);
    const lin = r && marcas[r.rota || r.lances]?.linha;
    if (lin?.length) { ancora[nomeG] = lin[0]; continue; }
    const o = cadeia.find((e, k) => k > 0 && e.zona);
    if (o) { const z = Ro.zona(o.zona); if (z.length) ancora[nomeG] = [z.reduce((a, t) => a + t[0], 0) / z.length, z.reduce((a, t) => a + t[1], 0) / z.length]; }
  }
  for (const [veh, inf] of roteiro.alocacao?.mech || []) if (ancora[veh]) ancora[inf] = ancora[veh];
  const out = {};
  for (const [nomeG, cadeia] of Object.entries(plano)) {
    if (nomeG === '_' || !Array.isArray(cadeia)) continue;
    const g = G[nomeG]; if (!g) throw new Error(`grupo ${nomeG} sem numero em roteiro.grupos`);
    // { lances: <polilinha>, passo, cada, desde, tipo, stance }: uma ordem por lance; o lance k sai em desde + (k+1)*cada
    // (`desde` = quando o grupo deixa a ordem anterior); o ultimo lance fica, a nao ser que venha outra ordem depois
    const plana = [];
    cadeia.forEach((e, k) => {
      // { rota: <polilinha>, passo, raio, tipo, stance } (17/10): pontos de passagem sem espera, janela [0-0] em todos
      if (e.rota) { Ro.rota(e.rota, e.passo || 10, e.raio ?? 4, !!e.abrigo).forEach((z, q) => plana.push({ tipo: e.tipo || 'Advance', stance: e.stance || 'Active', zonaTiles: z, nomeZ: `${e.rota}#${q + 1}`, a: 0, b: 0 })); return; }
      if (!e.lances) { plana.push(e); return; }
      const zs = Ro.lances(e.lances, e.passo || 10, e.raio ?? 2, !!e.rodavel); const cada = e.cada ?? 60, desde = e.desde ?? 0;
      zs.forEach((z, q) => {
        const ultimo = q === zs.length - 1 && k === cadeia.length - 1;
        plana.push({ tipo: e.tipo || 'Advance', stance: e.stance || 'Normal', zonaTiles: z, nomeZ: `${e.lances}#${q + 1}`, ...(ultimo ? {} : { a: desde + (q + 1) * cada, b: desde + (q + 1) * cada + 60 }) });
      });
    });
    if (plana.length > 32) throw new Error(`${variante} ${nomeG}: ${plana.length} entradas (max 32)`);
    out[g] = plana.map((e, k) => {
      const nomeZ = e.nomeZ || e.setup || e.zona; let zona = e.zonaTiles || Ro.zona(nomeZ);
      if (!zona.length) throw new Error(`${variante} ${nomeG} entrada ${k + 1}: zona ${nomeZ} vazia`);
      if (e.setup) {
        // o terco nomeado vira a janela em torno da ancora; `fixo: true` (ou alinhar false) mantem o terco
        const m = /^setup\.(tanks|recon|light|mech)\.[ABC]$/.exec(e.setup) || (e.setup === 'setup.fundo' ? [null, 'fundo'] : null);
        if (alinhar && !e.fixo && m && ancora[nomeG]) { const z = Ro.setupJanela(m[1], ancora[nomeG], { meia: janela, minimo }); if (z.length) zona = z; }
        return { setup: true, zona, stance: 'Normal', a: e.a ?? 0, b: e.b ?? 60 };
      }
      return { tipo: e.tipo || 'Advance', stance: e.stance || 'Normal', ...(e.passenger ? { passenger: e.passenger } : {}), zona, ...(e.a !== undefined ? { a: e.a, b: e.b } : {}) };
    });
  }
  return out;
}

// OS ALVOS DE APOIO DO ROTEIRO (ajustes.apoio): por lado, `manter` os que o mapa ja tem e acrescentar os novos (missao
// Suppress/Smoke numa zona do roteiro), com os 4 B de parametros do primeiro alvo do lado. Reaplicavel: um alvo igual
// (mesma missao e mesmos tiles) nao entra de novo. Ate 20 por lado (o editor).
const MISSAO = { Suppress: 2, Smoke: 3 };
function aplicarApoioRoteiro(d, Ro, apoio) {
  const lados = alvosDeApoio(d); const resumo = [];
  for (const [nomeLado, n] of [['azul', 0], ['vermelho', 1]]) {
    const spec = apoio?.[nomeLado]; if (!spec) continue;
    const L = lados.find((x) => x.lado === n); if (!L) throw new Error(`a cauda nao tem o lado ${nomeLado}`);
    // `manter`: true (todos), false (nenhum) ou o nome de uma missao (17/10, 012r: "Suppress" = so as supressoes dos devs)
    if (!spec.manter) L.alvos = [];
    else if (typeof spec.manter === 'string') { const m0 = MISSAO[spec.manter]; if (!m0) throw new Error(`missao desconhecida: ${spec.manter}`); L.alvos = L.alvos.filter((x) => x.missao === m0); }
    const params = L.alvos[0]?.params ? Buffer.from(L.alvos[0].params) : Buffer.from([0x11, 0x11, 0x11, 0x11]);
    for (const a of spec.alvos || []) {
      const missao = MISSAO[a.missao]; if (!missao) throw new Error(`missao desconhecida: ${a.missao}`);
      const tiles = canvas(d, Ro.zona(a.zona)); if (!tiles.length) throw new Error(`alvo de apoio na zona ${a.zona} vazia`);
      const chave = (t) => t.map((p) => p.join()).sort().join(';');
      if (L.alvos.some((x) => x.missao === missao && chave(x.tiles) === chave(tiles))) continue;
      L.alvos.push({ missao, params, tiles });
    }
    if (L.alvos.length > 20) throw new Error(`${L.alvos.length} alvos no lado ${nomeLado} (max 20)`);
    resumo.push(`${nomeLado}: ${L.alvos.map((x) => (x.missao === 3 ? 'Smoke' : x.missao === 2 ? 'Suppress' : x.missao) + ' ' + x.tiles.length + 't').join(', ')}`);
  }
  d.cauda = codificarAlvos(lados);
  return resumo.join('; ');
}

// AS ZONAS DA DOUTRINA POSICIONAL (autor 14/10, Small Hills-Forest-Village 024r): mapa apertado, combate de posicao.
// As MARCAS vem do desenho dele (research/ia/<slug>.meet.ajustes.json > marcas, gramatica da zonaManual): linhaVermelha
// e linhaAmarela (onde cada parcela da mecanizada desmonta), linhaVerdeVeh/linhaVerdeEquipes (o alto que ve a cidade:
// leves e equipes), setaInicio (o desembarque do flanco) e seta (a polilinha do flanco). O resto e derivado.
function zonasPosicional(c) {
  const { F, posicional: PO, marcas, obj, objSet, casas, comCasas, perto2, todos, rodavel, prog, faixa, pCentro } = c;
  const { W, idx, dentro: noMapa } = F;
  if (!marcas) throw new Error('a doutrina posicional precisa das marcas do mapa (ajustes.marcas)');
  const Z = {};
  for (const k of ['linhaVermelha', 'linhaAmarela', 'linhaVerdeVeh', 'linhaVerdeEquipes', 'setaInicio']) {
    if (!marcas[k]) throw new Error(`marca ${k} ausente`);
    Z[k] = zonaManual(F, marcas[k], { soAzul: false });
  }
  const area = areaObjetivo(F, obj, objSet);
  const naArea = (x, y) => area.has(idx(x, y));
  Z.objetivoTodo = [...area].map((i) => [i % W, (i / W) | 0]).filter(([x, y]) => rodavel(idx(x, y)));
  // os pesados: o lado azul do objetivo, junto a rua da faixa central (ate 4 tiles dela)
  const ruaB = todos((i, x, y) => F.rua[i] && faixa(x, y) === 'B' && naArea(x, y));
  const perto = Z.objetivoTodo.filter(([x, y]) => prog(x, y) <= pCentro && ruaB.some(([rx, ry]) => Math.max(Math.abs(rx - x), Math.abs(ry - y)) <= 4));
  Z.objetivoPerto = perto.length >= 6 ? perto : Z.objetivoTodo.filter(([x, y]) => prog(x, y) <= pCentro && faixa(x, y) === 'B');
  // os desembarques: as marcas e o rodavel colado a elas (o veiculo para no aberto; as casas ficam na zona)
  Z.desmonteVermelho = comCasas(Z.linhaVermelha, perto2(Z.linhaVermelha, 2, (i) => rodavel(i)));
  const pAm = Math.max(...Z.linhaAmarela.map(([x, y]) => prog(x, y)));
  Z.desmonteAmarelo = comCasas(Z.linhaAmarela, perto2(Z.linhaAmarela, 2, (i, x, y) => rodavel(i) && prog(x, y) <= pAm + 1));
  Z.linhaVerde = comCasas(Z.linhaVerdeEquipes, Z.linhaVerdeVeh);
  // o resto da cidade: as casas do objetivo fora da linha amarela e o rodavel colado a elas, dentro do objetivo
  const am = new Set(Z.linhaAmarela.map(([x, y]) => idx(x, y)));
  const outras = casas.filter((k) => k.tiles.some(([x, y]) => naArea(x, y)) && !k.tiles.some(([x, y]) => am.has(idx(x, y)))).flatMap((k) => k.tiles);
  Z.restoCidade = comCasas(outras, perto2(outras, 1, (i, x, y) => rodavel(i) && naArea(x, y)));
  // a seta: lances de infBoundTiles ao longo da polilinha; cada lance = a cobertura (casa ou mata) a ate 2 tiles do
  // ponto, ou o andavel (fora de agua e da faixa do jogador) quando ha pouca
  Z.setaLances = [];
  const seta = marcas.seta || [];
  if (seta.length >= 2) {
    const passo = PO.clock.infBoundTiles || 8;
    const pontos = []; let resto = passo;
    for (let k = 1; k < seta.length; k++) {
      const [ax, ay] = seta[k - 1], [bx2, by2] = seta[k]; const L = Math.hypot(bx2 - ax, by2 - ay);
      let t = resto; while (t <= L + 1e-9) { pontos.push([ax + (bx2 - ax) * t / L, ay + (by2 - ay) * t / L]); t += passo; }
      resto = t - L;
    }
    const fim = seta[seta.length - 1]; const ult = pontos[pontos.length - 1];
    if (!ult || Math.hypot(ult[0] - fim[0], ult[1] - fim[1]) > 3) pontos.push(fim);
    for (const [px, py] of pontos) {
      const cx = Math.round(px), cy = Math.round(py);
      const anda = todos((i, x, y) => Math.max(Math.abs(x - cx), Math.abs(y - cy)) <= 2 && !F.agua[i] && !F.verm[i] && noMapa(x, y));
      const cob = anda.filter(([x, y]) => F.abrigo[idx(x, y)]);
      Z.setaLances.push(cob.length >= 3 ? cob : anda);
    }
  }
  return Z;
}

// AS ZONAS DA DOUTRINA DE TERRENO ABERTO (autor 13/10, Open-Rural 306): o objetivo pode ser um ANEL pintado em volta
// da vila (o miolo nao pontua, mas e onde as casas estao); a floresta do lado azul esconde a mecanizada e as equipes;
// o setup azul fica em defilada pelo relevo. Tudo trocavel por `ajustes.zonas` (mesmo nome).
function zonasAberto(c) {
  const { F, aberto: AB, obj, objSet, casas, comCasas, perto2, todos, rodavel, prog, lado, ve, amostra, bandaBorda, bandaOuPerto, As, pStart, pNear, pCentro, ux, uy, bx, by, ex, ey, lo, hi } = c;
  const { W, H, idx, dentro: noMapa } = F;
  const Z = {};
  const viz8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const lraw = (x, y) => (x - bx) * ex + (y - by) * ey;
  const area = areaObjetivo(F, obj, objSet);
  Z.objArea = [...area].map((i) => [i % W, (i / W) | 0]);
  // os tanques de cada lado tomam a metade proxima do objetivo do seu lado
  for (const f of ['A', 'C']) {
    const z = Z.objArea.filter(([x, y]) => rodavel(idx(x, y)) && lado[f](x, y) && prog(x, y) <= pCentro);
    Z['objetivo_' + f] = z.length >= 6 ? z : Z.objArea.filter(([x, y]) => rodavel(idx(x, y)) && lado[f](x, y));
  }
  // as casas do objetivo (do lado azul do centro) e as do jogador (alem do centro)
  const naArea = casas.filter((k) => k.tiles.some(([x, y]) => area.has(idx(x, y))));
  const cObj = naArea.filter((k) => prog(k.x, k.y) <= pCentro), cJog = naArea.filter((k) => prog(k.x, k.y) > pCentro);
  Z.casasObjetivo = cObj.flatMap((k) => k.tiles); Z.casasJogador = cJog.flatMap((k) => k.tiles);
  Z.desmonteObjetivo = comCasas(Z.casasObjetivo, perto2(Z.casasObjetivo, 2, (i, x, y) => rodavel(i) && prog(x, y) <= pCentro + 2));
  Z.casasJogadorZ = comCasas(Z.casasJogador, perto2(Z.casasJogador, 2, (i) => rodavel(i)));
  // quem olha: a amostra do anel e as casas do jogador
  const alvos = [...amostra, ...Z.casasJogador.filter((_, k) => k % 2 === 0)];
  const ninguemVe = (x, y) => !alvos.some(([tx, ty]) => ve(tx, ty, x, y, 2.5));
  // os IFVs do centro, depois do desembarque: 2-4 tiles atras das casas do objetivo (do lado azul), escondidos das casas do jogador
  if (Z.casasObjetivo.length) {
    const pMin = Math.min(...Z.casasObjetivo.map(([x, y]) => prog(x, y)));
    const perto4 = new Set(perto2(Z.casasObjetivo, 4, (i) => rodavel(i)).map((t) => t.join()));
    const perto1 = new Set(perto2(Z.casasObjetivo, 1, () => true).map((t) => t.join()));
    const cand = todos((i, x, y) => perto4.has(x + ',' + y) && !perto1.has(x + ',' + y) && prog(x, y) <= pMin);
    const vJog = Z.casasJogador.filter((_, k) => k % 2 === 0);
    const esc = cand.filter(([x, y]) => !vJog.some(([tx, ty]) => ve(tx, ty, x, y, 2.5)));
    Z.atrasCasas = esc.length >= 4 ? esc : cand.length >= 4 ? cand : perto2(Z.casasObjetivo, 3, (i) => rodavel(i));
  } else Z.atrasCasas = [];
  // a borda da floresta que encara o objetivo (mata de verdade: a ate 3 tiles de mata densa), entre a faixa e o objetivo,
  // e `forestDepth` tiles de fundo (para dentro da mata, em direcao a faixa)
  const densa = (x, y) => { for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (noMapa(x + dx, y + dy) && F.mataDensa[idx(x + dx, y + dy)]) return true; return false; };
  const borda = zonaManual(F, [{ ret: [0, W - 1, 0, H - 1], filtro: 'bordaFrente', fora: true }], { soAzul: false })
    .filter(([x, y]) => prog(x, y) > pStart + 2 && prog(x, y) < pNear - 1 && densa(x, y));
  const bset = new Set(borda.map(([x, y]) => idx(x, y))); const bm = [...borda];
  for (const [x, y] of borda) for (let k = 1; k < (AB.forestDepth || 2); k++) { const nx = Math.round(x - ux * k), ny = Math.round(y - uy * k); if (noMapa(nx, ny) && F.floresta[idx(nx, ny)] && !bset.has(idx(nx, ny))) { bset.add(idx(nx, ny)); bm.push([nx, ny]); } }
  Z.bordaMata = bm;
  // o bloco de mata dessa borda e o aberto logo atras dele (o desembarque escondido)
  const bloco = new Set(borda.map(([x, y]) => idx(x, y))); const fb = [...borda];
  for (let k = 0; k < fb.length; k++) { const [x, y] = fb[k]; for (const [dx, dy] of viz8) { const nx = x + dx, ny = y + dy; if (!noMapa(nx, ny)) continue; const j = idx(nx, ny); if (F.floresta[j] && !bloco.has(j)) { bloco.add(j); fb.push([nx, ny]); } } }
  if (fb.length) {
    const pb = fb.map(([x, y]) => prog(x, y)), lb = fb.map(([x, y]) => lraw(x, y));
    const pB0 = Math.min(...pb), pB1 = Math.max(...borda.map(([x, y]) => prog(x, y))), l0 = Math.min(...lb), l1 = Math.max(...lb);
    const cand = todos((i, x, y) => rodavel(i) && F.dMata[i] <= 3 && prog(x, y) >= pB0 - (AB.behindForest || 5) && prog(x, y) < pB0 && lraw(x, y) >= l0 - 2 && lraw(x, y) <= l1 + 2);
    const esc = cand.filter(([x, y]) => ninguemVe(x, y));
    Z.atrasMata = esc.length >= 6 ? esc : cand;
    // a vigia: o aberto colado a borda da floresta, do lado do objetivo, que mais ve o objetivo e as casas do jogador
    const cv = todos((i, x, y) => rodavel(i) && !objSet.has(i) && F.dMata[i] <= 2 && prog(x, y) >= pB1 && prog(x, y) <= pB1 + 3 && lraw(x, y) >= l0 - 2 && lraw(x, y) <= l1 + 2)
      .map(([x, y]) => ({ x, y, nota: alvos.filter(([tx, ty]) => ve(x, y, tx, ty, 2.5)).length / Math.max(1, alvos.length) }));
    cv.sort((a, b) => b.nota - a.nota);
    const melhor = cv[0]?.nota || 0;
    const boa = cv.filter((t) => t.nota >= (AB.overwatchScore ?? 0.8) * melhor).map((t) => [t.x, t.y]);
    Z.vigia = boa.length >= 4 ? boa : cv.length >= 4 ? cv.slice(0, 12).map((t) => [t.x, t.y]) : bandaOuPerto(pNear - 5, pNear - 2, 'B');
  } else { Z.atrasMata = []; Z.vigia = bandaOuPerto(pNear - 5, pNear - 2, 'B'); }
  // o setup coberto pelo relevo de cada lado: a faixa azul que ninguem do objetivo ve
  for (const f of ['A', 'C']) Z['setupCoberto_' + f] = F.azuis.map((i) => [i % W, (i / W) | 0]).filter(([x, y]) => rodavel(idx(x, y)) && lado[f](x, y) && ninguemVe(x, y));
  // a borda do mapa: perto da faixa, no meio (do `As`) e perto do jogador (do `As`)
  for (const f of ['A', 'C']) {
    Z['flancoPerto_' + f] = bandaBorda(f, pStart + 2, pStart + 6);
    Z['flancoMeio_' + f] = As['flancoMeio_' + f];
    Z['flancoLonge_' + f] = As['flancoLonge_' + f];
    // os lances para dentro aos 35:00: na linha de 3/4, a `inwardBounds` tiles da borda do lado
    for (const [k, dist] of (AB.inwardBounds || [10, 20]).entries()) {
      const deBorda = (x, y) => (f === 'A' ? hi - lraw(x, y) : lraw(x, y) - lo);
      let z = []; for (let w = 0; w <= 3 && z.length < 6; w++) z = todos((i, x, y) => rodavel(i) && Math.abs(prog(x, y) - As.p34) <= 3 + w && Math.abs(deBorda(x, y) - dist) <= 2 + w);
      Z[`dentroFlanco${k + 1}_${f}`] = z;
    }
  }
  return Z;
}

// AS CADEIAS DA DOUTRINA ABERTA (autor 13/10, Open-Rural 306), para o flanco f da variante (A = flankLeft, C =
// flankRight; so quem flanqueia muda de lado). Grupos em rules.meet.aberto.groups.
export const VARIANTES_ABERTO = ['flankLeft', 'flankRight'];
export const FLANCO_ABERTO = { flankLeft: 'A', flankRight: 'C' };
export function cadeiasAberto({ Zs, geo }, { aberto, f }) {
  const G = aberto.groups, C = aberto.clock, Ab = Zs.Ab, As = Zs.As;
  if (!Ab) throw new Error('zonas da doutrina aberta nao calculadas (feicoesEncontro sem `aberto`)');
  for (const k of ['objetivo_A', 'objetivo_C', 'casasObjetivo', 'desmonteObjetivo', 'atrasCasas', 'casasJogadorZ', 'bordaMata', 'atrasMata', 'vigia', `setupCoberto_${f}`, `flancoPerto_${f}`, `flancoMeio_${f}`, `flancoLonge_${f}`, `dentroFlanco1_${f}`, `dentroFlanco2_${f}`])
    if (!Ab[k]?.length) throw new Error(`zona ${k} vazia`);
  const [l0, l1] = C.leave;
  const T0 = C.finalPush ?? 2100, dT = C.finalBound ?? 120;
  const pz = (z) => (z.length ? z.reduce((a, [x, y]) => a + geo.prog(x, y), 0) / z.length : 0);
  const setup = (zona, a = l0, b = l1) => ({ setup: true, zona, stance: 'Normal', a, b });
  const out = {};
  // 1-2: os pesados em dois grupos tomam o objetivo na hora zero (o recon vai com eles); aos 35:00, lances pelo seu lado
  for (const [g, s] of [[G.tanksA, 'A'], [G.tanksC, 'C']]) {
    out[g] = [setup(Zs.setup.tanks[s]), { tipo: 'Assault', stance: 'Active', zona: Ab['objetivo_' + s] }];
    investidaFinal(out[g], As.marcha(s, pz(Ab['objetivo_' + s]), false, As.lado[s]), T0, dT);
  }
  // 3: leves de vigia, no aberto colado a borda da floresta; atiram de longe e investem aos 35:00
  out[G.lightOver] = [setup(Zs.setup.light.B), { tipo: 'Advance', stance: 'Active', zona: Ab.vigia }];
  investidaFinal(out[G.lightOver], As.marcha('B', pz(Ab.vigia), false), T0, dT);
  // 4: leves de flanco: pela borda do mapa ate perto do jogador; aos 35:00 viram para dentro
  out[G.lightFlank] = [setup(Zs.setup.light[f]),
    { tipo: 'Advance', stance: 'Active', zona: Ab['flancoPerto_' + f], a: C.lightEdge, b: C.lightEdge + 60 },
    { tipo: 'Advance', stance: 'Active', zona: Ab['flancoMeio_' + f], a: C.lightFar, b: C.lightFar + 60 },
    { tipo: 'Advance', stance: 'Active', zona: Ab['flancoLonge_' + f] }];
  investidaFinal(out[G.lightFlank], [Ab['dentroFlanco1_' + f], Ab['dentroFlanco2_' + f]], T0, dT);
  // 5-6: parcela 1: os IFVs desembarcam as esquadras nas casas do objetivo e ficam atras delas; as esquadras seguram
  out[G.centreVeh] = [setup(Zs.setup.mech.B),
    { tipo: 'Advance', stance: 'Active', passenger: 1, zona: Ab.desmonteObjetivo, a: 0, b: 60 },
    { tipo: 'Advance', stance: 'Active', zona: Ab.atrasCasas }];
  investidaFinal(out[G.centreVeh], As.marcha('B', pz(Ab.atrasCasas), false), T0, dT);
  out[G.centreInf] = [setup(Zs.setup.mech.B, 0, 0),
    { tipo: 'Advance', stance: 'Active', zona: Ab.casasObjetivo, a: 0, b: 60 },
    { tipo: 'Advance', stance: 'Normal', zona: Ab.casasObjetivo }];
  // 7-8: parcela 2: os IFVs desembarcam atras da floresta, voltam ao setup coberto, sobem pela borda do mapa e aos
  // 35:00 viram para dentro; as esquadras vao a pe a borda da floresta e aos 35:00 atacam as casas do jogador
  out[G.forestVeh] = [setup(Zs.setup.mech[f]),
    { tipo: 'Advance', stance: 'Active', passenger: 1, zona: Ab.atrasMata, a: C.forestBack[0], b: C.forestBack[1] },
    { tipo: 'Advance', stance: 'Active', zona: Ab['setupCoberto_' + f], a: C.forestEdge, b: C.forestEdge + 60 },
    { tipo: 'Advance', stance: 'Active', zona: Ab['flancoPerto_' + f], a: 0, b: 60 },
    { tipo: 'Advance', stance: 'Active', zona: Ab['flancoMeio_' + f], a: C.forestFar, b: C.forestFar + 60 },
    { tipo: 'Advance', stance: 'Active', zona: Ab['flancoLonge_' + f] }];
  investidaFinal(out[G.forestVeh], [Ab['dentroFlanco1_' + f], Ab['dentroFlanco2_' + f]], T0, dT);
  out[G.forestInf] = [setup(Zs.setup.mech[f], 0, 0),
    { tipo: 'Advance', stance: 'Active', zona: Ab.bordaMata, a: T0, b: T0 + 60 },
    { tipo: 'Assault', stance: 'Active', zona: Ab.desmonteObjetivo, a: T0 + dT, b: T0 + dT + 60 },
    { tipo: 'Assault', stance: 'Active', zona: Ab.casasJogadorZ }];
  // 9-10: as equipes: o veiculo delas desembarca atras da floresta e fica escondido; elas vao a pe a borda
  out[G.teamVeh] = [setup(Zs.setup.fundo), { tipo: 'Advance', stance: 'Hide', passenger: 1, zona: Ab.atrasMata }];
  out[G.teams] = [setup(Zs.setup.fundo, 0, 0),
    { tipo: 'Advance', stance: 'Cautious', zona: Ab.bordaMata, a: 0, b: 60 },
    { tipo: 'Advance', stance: 'Normal', zona: Ab.bordaMata }];
  // 11-12: AA e o resto ficam no setup
  out[G.aa] = [setup(Zs.setup.fundo)];
  out[G.rest] = [setup(Zs.setup.fundo)];
  return out;
}

// AS CADEIAS DA DOUTRINA POSICIONAL (autor 14/10, 024r). Variantes: 'forest' (o grupo vermelho desmonta na mata ao sul
// da vila) e 'flank' (o mesmo grupo desmonta nas arvores do comeco da seta e flanqueia por ela, em lances). Os veiculos
// da mecanizada ficam onde desmontaram; aos 35:00 a infantaria toma o resto da cidade (e para), os leves ocupam o
// objetivo inteiro. Grupos em rules.meet.posicional.groups.
export const VARIANTES_POSICIONAL = ['forest', 'flank'];
export function cadeiasPosicional({ Zs }, { posicional, variante }) {
  const G = posicional.groups, C = posicional.clock, Po = Zs.Po;
  if (!Po) throw new Error('zonas da doutrina posicional nao calculadas (feicoesEncontro sem `posicional`)');
  const precisa = ['objetivoPerto', 'objetivoTodo', 'desmonteVermelho', 'linhaVermelha', 'desmonteAmarelo', 'linhaAmarela', 'linhaVerdeVeh', 'linhaVerde', 'restoCidade', ...(variante === 'flank' ? ['setaInicio'] : [])];
  for (const k of precisa) if (!Po[k]?.length) throw new Error(`zona ${k} vazia`);
  if (variante === 'flank' && !Po.setaLances.length) throw new Error('a seta nao tem lances');
  const [l0, l1] = C.leave; const T0 = C.finalPush ?? 2100;
  const setup = (zona, a = l0, b = l1) => ({ setup: true, zona, stance: 'Normal', a, b });
  const out = {};
  // 1: os pesados (e o recon) pela rua central ao objetivo na hora zero; aos 35:00 ocupam o objetivo inteiro
  out[G.tanks] = [setup(Zs.setup.tanks.B), { tipo: 'Assault', stance: 'Active', zona: Po.objetivoPerto, a: T0, b: T0 + 60 }, { tipo: 'Advance', stance: 'Active', zona: Po.objetivoTodo }];
  // 2: os leves na linha verde (o alto que ve a cidade); aos 35:00 ocupam o objetivo inteiro
  out[G.lightOver] = [setup(Zs.setup.light.B), { tipo: 'Advance', stance: 'Active', zona: Po.linhaVerdeVeh, a: T0, b: T0 + 60 }, { tipo: 'Advance', stance: 'Active', zona: Po.objetivoTodo }];
  // 3-4: o grupo vermelho
  if (variante === 'flank') {
    out[G.redVeh] = [setup(Zs.setup.mech.A), { tipo: 'Advance', stance: 'Active', passenger: 1, zona: Po.setaInicio }];
    const every = C.infBoundEvery ?? 120; let t = C.flankStart ?? 240;
    const inf = [setup(Zs.setup.mech.A, 0, 0), { tipo: 'Advance', stance: 'Normal', zona: Po.setaInicio, a: t, b: t + 60 }];
    Po.setaLances.forEach((z, k) => { t += every; const ultimo = k === Po.setaLances.length - 1; inf.push({ tipo: 'Advance', stance: 'Normal', zona: z, a: ultimo ? T0 : t, b: (ultimo ? T0 : t) + 60 }); });
    inf.push({ tipo: 'Assault', stance: 'Active', zona: Po.restoCidade });
    out[G.redInf] = inf;
  } else {
    out[G.redVeh] = [setup(Zs.setup.mech.C), { tipo: 'Advance', stance: 'Active', passenger: 1, zona: Po.desmonteVermelho }];
    out[G.redInf] = [setup(Zs.setup.mech.C, 0, 0), { tipo: 'Advance', stance: 'Active', zona: Po.linhaVermelha, a: T0, b: T0 + 60 }, { tipo: 'Assault', stance: 'Active', zona: Po.restoCidade }];
  }
  // 5-6: o grupo amarelo desmonta nas casas do lado azul da vila
  out[G.yellowVeh] = [setup(Zs.setup.mech.B), { tipo: 'Advance', stance: 'Active', passenger: 1, zona: Po.desmonteAmarelo }];
  out[G.yellowInf] = [setup(Zs.setup.mech.B, 0, 0), { tipo: 'Advance', stance: 'Active', zona: Po.linhaAmarela, a: T0, b: T0 + 60 }, { tipo: 'Assault', stance: 'Active', zona: Po.restoCidade }];
  // 7: as equipes, montadas ate a linha verde, desmontam la
  out[G.teams] = [setup(Zs.setup.fundo), { tipo: 'Quick', stance: 'Cautious', zona: Po.linhaVerdeVeh, a: 0, b: 60 }, { tipo: 'Advance', stance: 'Normal', passenger: 1, zona: Po.linhaVerde }];
  // 8-9: AA e o resto ficam no setup
  out[G.aa] = [setup(Zs.setup.fundo)];
  out[G.rest] = [setup(Zs.setup.fundo)];
  return out;
}

const distZona = (geo, zona) => zona.length ? zona.reduce((a, [x, y]) => a + geo.prog(x, y), 0) / zona.length : 0;

// AS CADEIAS DE UMA VARIANTE: { g: [ {setup|ordem, zona, ...} ] } para os 16 grupos.
export function cadeiasEncontro({ Zs, geo }, { variante = 'balanced', duracaoMin = 45, doctrine }) {
  const Dc = doctrine; const fim = duracaoMin * 60;
  const travel = (z0, z1) => r30(Math.abs(distZona(geo, z1) - distZona(geo, z0)) * 8 / Dc.speedMps);
  const out = {};
  // o flanco que SEGURA um ponto alto na variante de flanco: right -> A segura, left -> C segura
  const segura = variante === 'right' ? 'A' : variante === 'left' ? 'C' : null;
  const fogo = variante === 'fire' && Zs.fogo;
  const tLeave = Dc.tanksLeave;
  for (const f of FLANCOS) {
    // a rota dos tanques do flanco: as linhas de fase e o assalto a borda do objetivo
    let rota = Zs.L.map((l) => l[f]);
    let ultima = Zs.frente[f];
    let ultStance = 'Active', ultTipo = 'Assault';
    if (segura === f) {
      // o flanco que segura: para no ponto alto do seu lado (o melhor alto que ficar no flanco) ou na ultima linha
      const altoF = Zs.altoTimes.filter(([x, y]) => geo.faixa(x, y) === f);
      ultima = altoF.length >= 4 ? altoF : rota[rota.length - 1]; rota = rota.slice(0, -1); ultStance = 'Ambush Armor 1000'; ultTipo = 'Advance';
    }
    if (fogo) rota = [Zs.fogo, ...rota.slice(-1)];
    // as janelas: sai da faixa em tanksLeave; de cada linha, depois de chegar e ficar `holdSeconds` (no alto de fogo, `fireHoldSeconds`)
    const marcos = []; let t = tLeave[0], prev = Zs.setup.tanks[f];
    for (let k = 0; k < rota.length; k++) { t += travel(prev, rota[k]) + (fogo && k === 0 ? Dc.fireHoldSeconds : Dc.holdSeconds); marcos.push(r30(t)); prev = rota[k]; }
    const cadeia = (setupZona, atrasK, atraso, stanceMove, finalZona, finalTipo, finalStance) => [
      // todos saem da faixa juntos, na hora zero (autor, 12/10): o atraso de recon (1 min) e leves (2 min) vale dos lances seguintes
      { setup: true, zona: setupZona, stance: 'Normal', a: tLeave[0], b: tLeave[1] },
      ...rota.map((z, k) => ({ tipo: 'Advance', stance: stanceMove, zona: atrasK ? Zs.atras(z, atrasK) : z, a: marcos[k] + atraso, b: marcos[k] + atraso + 120 })),
      { tipo: finalTipo, stance: finalStance, zona: finalZona },
    ];
    out[GRUPOS_ENCONTRO.tanks[f]] = cadeia(Zs.setup.tanks[f], 0, 0, 'Active', ultima, ultTipo, ultStance);
    out[GRUPOS_ENCONTRO.recon[f]] = cadeia(Zs.setup.recon[f], Dc.reconBehind, Dc.reconDelay, 'Cautious', Zs.atras(ultima, Dc.reconBehind), 'Advance', segura === f ? 'Ambush Armor 1000' : 'Cautious');
    out[GRUPOS_ENCONTRO.light[f]] = cadeia(Zs.setup.light[f], Dc.lightBehind, Dc.lightDelay, 'Active', Zs.atras(ultima, Dc.lightBehind), 'Advance', segura === f ? 'Ambush Armor 1000' : 'Active');
    // a mecanizada: sai depois dos tanques, segue a primeira linha recuada, espera um tanque do flanco a 10 tiles do
    // objetivo, vai MONTADA ate o objetivo e desmonta la (o flanco que segura nao assalta: fica com os tanques)
    const seguir = Zs.atras(Zs.L[0][f], Dc.followBehind);
    const mec = [
      { setup: true, zona: Zs.setup.mech[f], stance: 'Normal', a: tLeave[0] + Dc.mechDelay, b: tLeave[1] + Dc.mechDelay + 60 },
      { tipo: 'Advance', stance: 'Normal', passenger: 0, zona: seguir.length ? seguir : Zs.L[0][f], espera: segura === f ? null : 'L2_' + f, a: 0, b: segura === f ? marcos[marcos.length - 1] || 600 : Math.max(600, fim - 600) },
    ];
    if (segura === f) mec.push({ tipo: 'Advance', stance: 'Normal', passenger: 0, zona: Zs.atras(ultima, Dc.followBehind).length ? Zs.atras(ultima, Dc.followBehind) : ultima, a: 0, b: 60 });
    else mec.push({ tipo: 'Quick', stance: 'Active', passenger: 0, zona: Zs.dentro[f], a: 0, b: 60 }, { tipo: 'Assault', stance: 'Active', passenger: 1, occupy: 'Mixed', zona: Zs.dentro[f] });
    out[GRUPOS_ENCONTRO.mech[f]] = mec;
  }
  // as equipes: esperam o ponto alto coberto, vao montadas e desmontam la
  out[GRUPOS_ENCONTRO.teams] = [
    { setup: true, zona: Zs.setup.fundo, stance: 'Normal', espera: 'High', a: 0, b: TRES_HORAS },
    { tipo: 'Quick', stance: 'Cautious', passenger: 0, zona: Zs.altoTimes, a: 0, b: 60 },
    { tipo: 'Advance', stance: 'Normal', passenger: 1, zona: Zs.altoTimes },
  ];
  out[GRUPOS_ENCONTRO.aa] = [
    { setup: true, zona: Zs.setup.fundo, stance: 'Normal', a: Dc.aaLeave[0], b: Dc.aaLeave[1] },
    { tipo: 'Quick', stance: 'Cautious', passenger: 0, zona: Zs.altoAA, a: 0, b: 60 },
    { tipo: 'Advance', stance: 'Hide', passenger: 1, zona: Zs.altoAA },
  ];
  out[GRUPOS_ENCONTRO.rest] = [{ setup: true, zona: Zs.setup.fundo, stance: 'Normal', a: 0, b: 60 }];
  return out;
}

// A INVESTIDA FINAL de uma cadeia: a ordem em que o grupo esta sai em T0; cada lance k e um Assault que sai em
// T0 + (k+1)*dT; o ultimo fica (sem janela).
export function investidaFinal(c, lances, T0, dT) {
  if (!c || !lances.length) return;
  const ult = c[c.length - 1];
  ult.a = T0; ult.b = T0 + 60;
  lances.forEach((z, k) => c.push({ tipo: 'Assault', stance: 'Active', zona: z, a: T0 + (k + 1) * dT, b: T0 + (k + 1) * dT + 60 }));
  delete c[c.length - 1].a; delete c[c.length - 1].b;
}

// AS CADEIAS DO ASSALTO DIRETO (mapa pequeno, autor 12/10 noite; o "01 teste" dele mostrou a esquadra e o IFV em
// grupos separados: o IFV leva a ordem com Passengers Dismount ate a casa e segue sozinho, a esquadra tem a sua).
// Pelo manual (3.5): Advance para levar a infantaria e para a marcha pelo flanco; Assault para descer a rua em ataque
// e para fechar sobre o jogador; Quick so para chegar a rua.
export const VARIANTES_ASSALTO = ['flankLeft', 'flankRight', 'both'];
export function cadeiasAssalto({ Zs, geo }, { assault }) {
  const geoProg = geo.prog;
  const G = assault.groups, C = assault.clock, As = Zs.As;
  const [l0, l1] = C.leave;
  const out = {};
  const setup = (zona, a = l0, b = l1) => ({ setup: true, zona, stance: 'Normal', a, b });
  // tanques, reconhecimento e a escolta: pela rua do centro, direto ao centro do objetivo, em Assault, na hora zero
  // (autor, 13/10: direto do Setup ao objetivo, sem a parada na rua)
  const ponta = (zSetup, atraso, stance) => [setup(zSetup, l0 + atraso, l1 + atraso),
    { tipo: 'Assault', stance, zona: As.centroObj }];
  out[G.tanks] = ponta(Zs.setup.tanks.B, 0, 'Active');
  out[G.recon] = ponta(Zs.setup.recon.B, 0, 'Active');
  out[G.escort] = ponta(Zs.setup.light.B, C.escortDelay || 0, 'Active');
  // os leves de guarda: vao para o flanco e ficam, de emboscada contra blindados
  for (const f of ['A', 'C']) out[G['guard' + f]] = [setup(Zs.setup.light[f]),
    { tipo: 'Advance', stance: 'Normal', zona: As['guarda_' + f], a: 0, b: 60 },
    { tipo: 'Advance', stance: 'Ambush Armor 1000', zona: As['guarda_' + f] }];
  // parcela 1: os IFVs desmontam junto as casas do centro, recuam para as arvores atras e entram no objetivo depois
  out[G.centreVeh] = [setup(Zs.setup.mech.B),
    { tipo: 'Advance', stance: 'Active', passenger: 1, zona: As.desmonteCentro, a: 0, b: 60 },
    { tipo: 'Advance', stance: 'Active', zona: As.matasAtras, a: C.centreVehHold, b: C.centreVehHold + 60 },
    { tipo: 'Advance', stance: 'Active', zona: As.centroObj }];
  // ... e as esquadras ocupam as casas do centro (a mesma cadeia do G2 do 01 teste: entra, depois ocupa o resto)
  out[G.centreInf] = [setup(Zs.setup.mech.B, 0, 0),
    { tipo: 'Advance', stance: 'Active', zona: As.casasCentro, a: 0, b: 60 },
    { tipo: 'Advance', stance: 'Normal', zona: As.casasCentro }];
  // parcela 2: os IFVs desmontam nas casas afastadas, vao pela borda do flanco ate perto do setup do jogador e fecham
  // sobre o objetivo; as esquadras esperam `farInfWait` e entram no objetivo
  for (const f of ['A', 'C']) {
    out[G['farVeh' + f]] = [setup(Zs.setup.mech[f]),
      { tipo: 'Advance', stance: 'Active', passenger: 1, zona: As['desmonteLonge_' + f], a: 0, b: 60 },
      { tipo: 'Advance', stance: 'Active', zona: As['flancoMeio_' + f], a: 0, b: 60 },
      { tipo: 'Advance', stance: 'Active', zona: As['flancoLonge_' + f], a: 0, b: 60 },
      { tipo: 'Assault', stance: 'Active', zona: As['contato_' + f] }];
    out[G['farInf' + f]] = [setup(Zs.setup.mech[f], 0, 0),
      { tipo: 'Advance', stance: 'Active', zona: As['casasLonge_' + f].length ? As['casasLonge_' + f] : As['desmonteLonge_' + f], a: C.farInfWait, b: C.farInfWait + 60 },
      { tipo: 'Assault', stance: 'Active', zona: As['entraObj_' + f] }];
  }
  // equipes e AA: montadas ate o alto, desmontam la
  out[G.teams] = [setup(Zs.setup.fundo),
    { tipo: 'Quick', stance: 'Cautious', zona: Zs.altoTimes, a: 0, b: 60 },
    { tipo: 'Advance', stance: 'Normal', passenger: 1, zona: Zs.altoTimes }];
  out[G.aa] = [setup(Zs.setup.fundo, 60, 240),
    { tipo: 'Quick', stance: 'Cautious', zona: Zs.altoAA, a: 0, b: 60 },
    { tipo: 'Advance', stance: 'Hide', passenger: 1, zona: Zs.altoAA }];
  out[G.rest] = [setup(Zs.setup.fundo)];
  // A INVESTIDA FINAL (autor, 13/10): aos `finalPush` segundos todo mundo menos equipes, AA e resto vai tomar 3/4 do
  // mapa. A ordem em que o grupo esta recebe a janela de saida; os blindados pesados e leves vao em lances de
  // `finalBound` segundos (Assault), a infantaria de cobertura a cobertura.
  const T0 = C.finalPush ?? 2100, dT = C.finalBound ?? 120;
  const prog = (z) => (z.length ? z.reduce((a, [x, y]) => a + geoProg(x, y), 0) / z.length : 0);
  const investida = (g, f, cobertura) => {
    const c = out[g]; if (!c) return;
    investidaFinal(c, As.marcha(f, prog(c[c.length - 1].zona), cobertura), T0, dT);
  };
  for (const g of [G.tanks, G.recon, G.escort, G.centreVeh]) investida(g, 'B', false);
  investida(G.centreInf, 'B', true);
  for (const f of ['A', 'C']) { investida(G['guard' + f], f, false); investida(G['farVeh' + f], f, false); investida(G['farInf' + f], f, true); }
  return out;
}

// O PLANO INTEIRO NO ARQUIVO: as variantes nos planos azuis 1-4 (`usos`: o uso de cada uma; padrao Used Sometimes),
// o plano 5 vazio, os triggers amigos nas vagas azuis livres (e nas nossas "ZZ Meet Trig", que se regravam).
// O MODO: num mapa pequeno (D < smallMapTiles) e com `assault` (rules.meet.assault) o assalto direto, sem triggers
// (as "ZZ Meet Trig" de uma geracao anterior sao apagadas); nos outros, os lances com os triggers amigos.
// `modo` (13/10): 'assalto' | 'aberto' | 'lances' explicito (o registro do mapa diz a doutrina); sem ele, o dos
// ajustes, e sem ajustes o automatico (assalto no mapa pequeno, lances nos outros). 'aberto' exige `aberto`
// (rules.meet.aberto) e tambem `assault` (as bordas e a linha de 3/4 vem das zonas do assalto).
export function aplicarDoutrinaEncontro(arquivo, { duracaoMin = 45, doctrine, assault = null, aberto = null, posicional = null, ajustes = null, usos = null, variantes = null, modo: modoPedido = null, roteiroCfg = null } = {}) {
  const modoQuer = modoPedido || ajustes?.modo;
  const { F, Zs, geo } = feicoesEncontro(arquivo, { doctrine, assault, aberto: modoQuer === 'aberto' ? aberto : null, posicional: modoQuer === 'posicional' ? posicional : null, roteiro: modoQuer === 'roteiro', ajustes });
  const modoAuto = assault && geo.pequeno && ajustes?.modo !== 'lances' ? 'assalto' : 'lances';
  const modo = modoPedido || (ajustes?.modo && ajustes.modo !== 'lances' ? ajustes.modo : null) || modoAuto;
  if (!['assalto', 'aberto', 'posicional', 'roteiro', 'lances'].includes(modo)) throw new Error(`modo desconhecido: ${modo}`);
  if (modo === 'roteiro' && !ajustes?.planos) throw new Error('o modo roteiro precisa dos planos no ajustes do mapa');
  if (modo === 'posicional' && !posicional) throw new Error('o modo posicional precisa de rules.meet.posicional');
  if (modo === 'assalto' && !assault) throw new Error('o modo assalto precisa de rules.meet.assault');
  if (modo === 'aberto' && (!aberto || !assault)) throw new Error('o modo aberto precisa de rules.meet.aberto e rules.meet.assault');
  const d = F.d;
  const todas = [...d.azul, ...d.vermelho].flatMap((pl) => pl.slots.flat());
  const moldeSetup = todas.find((e) => e.tiles.length) || todas[0];
  const moldeOrdem = [...d.azul, ...d.vermelho].flatMap((pl) => pl.slots.filter((s) => s.length > 1).flatMap((s) => s.slice(1)))[0] || moldeSetup;
  const NOMES = { L2_A: 'ZZ Meet Trig L2 A', L2_B: 'ZZ Meet Trig L2 B', L2_C: 'ZZ Meet Trig L2 C', High: 'ZZ Meet Trig High' };
  const livres = d.vagas.map((v, k) => ({ v, k })).filter(({ v }) => v.lado === 'azul' && ((!v.tiles.length && !v.nome.trim()) || /^ZZ Meet Trig /.test(v.nome)));
  const usados = modo !== 'lances' ? [] : Object.keys(NOMES).filter((t) => Zs.T[t]?.length);
  if (modo !== 'lances') {
    const molde = d.vagas.find((v) => v.lado === 'azul' && !v.tiles.length && !v.nome.trim());
    d.vagas.forEach((v, k) => { if (v.lado === 'azul' && /^ZZ Meet Trig /.test(v.nome) && molde) d.vagas[k] = { ...molde, vaga: v.vaga, lado: 'azul' }; });
  }
  if (livres.length < usados.length) throw new Error(`so ${livres.length} vagas azuis livres para ${usados.length} triggers`);
  const vagaDe = {};
  usados.forEach((t, n) => { const { k, v } = livres[n]; d.vagas[k] = { ...trigger(d, { nome: NOMES[t], tiles: Zs.T[t], tipo: 'Trigger friendly armor' }), lado: 'azul', vaga: v.vaga }; vagaDe[t] = v.vaga; });
  const vazio = slotVazio(d);
  const LISTA = { assalto: VARIANTES_ASSALTO, aberto: VARIANTES_ABERTO, posicional: VARIANTES_POSICIONAL, roteiro: Object.keys(ajustes?.planos || {}).filter((k) => !k.startsWith('_')).slice(0, 5), lances: VARIANTES }[modo];
  const quais = (variantes || ajustes?.variantes || LISTA).filter((v) => LISTA.includes(v) && (v !== 'fire' || Zs.fogo));
  const resumo = [];
  // no assalto as tres variantes tem as MESMAS ordens (o que muda e quem entra em cada grupo, meetGroups); planos 1-3
  const cadeiasA = modo === 'assalto' ? cadeiasAssalto({ Zs, geo }, { assault }) : null;
  for (let p = 0; p < 5; p++) {
    const nome = LISTA[p];
    if (!nome || !quais.includes(nome)) { d.azul[p] = { uso: USO['Not Used'], slots: Array.from({ length: 16 }, () => vazio.map((e) => ({ ...e }))) }; continue; }
    // na doutrina aberta cada variante tem as SUAS ordens (o flanco muda de lado)
    const cadeias = cadeiasA || (modo === 'aberto' ? cadeiasAberto({ Zs, geo }, { aberto, f: FLANCO_ABERTO[nome] })
      : modo === 'posicional' ? cadeiasPosicional({ Zs, geo }, { posicional, variante: nome })
      : modo === 'roteiro' ? cadeiasRoteiro({ Zs }, { roteiro: ajustes, variante: nome, alinhar: (ajustes?.alignSetup ?? roteiroCfg?.alignSetup) !== false, janela: roteiroCfg?.setupWindow ?? 12, minimo: roteiroCfg?.setupMinTiles ?? 30 })
      : cadeiasEncontro({ Zs, geo }, { variante: nome, duracaoMin, doctrine }));
    const slots = [];
    for (let g = 1; g <= 16; g++) {
      const c = cadeias[g];
      if (!c || !c[0].zona.length) { slots.push(vazio.map((e) => ({ ...e }))); continue; }
      if (c.length > 32) throw new Error(`G${g} com ${c.length} entradas (max 32)`);
      slots.push(c.map((e, k) => {
        const zona = e.zona.length ? e.zona : c[Math.max(0, k - 1)].zona;
        if (e.espera && vagaDe[e.espera] === undefined) throw new Error(`G${g} espera ${e.espera}, que nao existe`);
        return entrada(d, { setup: !!e.setup, tipo: e.tipo || 'Advance', occupy: e.occupy || 'Mixed', stance: e.stance, passenger: e.setup ? 0 : (e.passenger ?? 0),
          a: e.a ?? 0, b: e.b ?? 60, espera: e.espera ? { tipo: 1, i: vagaDe[e.espera], j: 1 } : null, tiles: zona }, e.setup ? moldeSetup : moldeOrdem);
      }));
    }
    d.azul[p] = { uso: USO[usos?.[nome] || 'Used Sometimes'], slots };
    resumo.push({ plano: p + 1, nome, grupos: Object.fromEntries(Object.entries(cadeias).map(([g, c]) => [g, c.map((e) => `${e.setup ? 'Setup' : e.tipo}${e.passenger ? ' DESMONTA' : ''}${e.espera ? ' espera ' + e.espera : ''} [${e.a ?? 0}-${e.b ?? 60}] ${e.zona.length}t@${Math.round(distZona(geo, e.zona))}`).join(' > ')])) });
  }
  const apoio = modo === 'roteiro' && ajustes.apoio ? aplicarApoioRoteiro(d, Zs.Ro, ajustes.apoio) : null;
  return { d, F, Zs, geo, modo, apoio, variantes: resumo.map((r) => ({ plano: r.plano, nome: r.nome })), resumo, vagaDe, triggers: Object.fromEntries(usados.map((t) => [t, { nome: NOMES[t], vaga: vagaDe[t] + 1, tiles: Zs.T[t].length }])) };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const regras = JSON.parse(fs.readFileSync(new URL('../../app/data/rules.json', import.meta.url), 'utf8'));
  const iModo = process.argv.indexOf('--modo'); const modo = iModo > 0 ? process.argv[iModo + 1] : null;
  const iAj = process.argv.indexOf('--ajustes'); const ajustes = iAj > 0 ? JSON.parse(fs.readFileSync(process.argv[iAj + 1], 'utf8')) : null;
  const r = aplicarDoutrinaEncontro(process.argv[2], { doctrine: regras.meet.doctrine, assault: regras.meet.assault, aberto: regras.meet.aberto, posicional: regras.meet.posicional, ajustes, modo });
  const tam = (o) => Object.entries(o).filter(([, v]) => Array.isArray(v)).map(([k, v]) => k + ':' + v.length).join(' ');
  console.log('modo', r.modo, r.modo !== 'lances' ? JSON.stringify(r.Zs.As.geo) + ' ' + tam(r.Zs.As) : '');
  if (r.Zs.Ab) console.log('aberto', tam(r.Zs.Ab));
  if (r.Zs.Po) console.log('posicional', tam(r.Zs.Po), 'lances da seta', r.Zs.Po.setaLances.map((z) => z.length).join('/'));
  if (r.Zs.Ro) console.log('roteiro', r.Zs.Ro.nomes().map((k) => k + ':' + r.Zs.Ro.zona(k).length).join(' '), '| apoio', r.apoio);
  const g = r.geo;
  console.log(`eixo u=${g.u.map((v) => v.toFixed(2))} pStart ${g.pStart.toFixed(1)} pNear ${g.pNear.toFixed(1)} pFar ${g.pFar.toFixed(1)} D ${g.D.toFixed(1)} ${g.pequeno ? 'pequeno' : ''}; linhas ${g.linhas.map((p) => p.toFixed(1)).join(', ')}; melhor alto ${JSON.stringify(g.melhorAlto)} fogo ${g.fogo}`);
  console.log('triggers', JSON.stringify(r.triggers));
  for (const p of r.resumo) { console.log(`== plano ${p.plano} ${p.nome}`); for (const [k, v] of Object.entries(p.grupos)) console.log(`  G${k}: ${v}`); }
  if (process.argv[3] && !process.argv[3].startsWith('--')) fs.writeFileSync(process.argv[3], JSON.stringify(r.resumo, null, 1));
}
