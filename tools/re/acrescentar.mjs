// ACRESCENTAR formacoes a uma batalha ja editada no editor (secao 96).
//
// Divide a batalha nos dois blocos (dividir.extrairLado), recompoe com compor2 acrescentando as
// fontes novas no FIM de cada lado e, so para os registros novos, posiciona na zona de setup do
// lado e atribui grupo de IA. Tudo o que ja estava no arquivo (posicoes, grupos, ausentes que o
// jogador ajustou) e preservado byte a byte: a ida-e-volta dividir+compor2 de uma batalha real
// devolve os mesmos registros (V2: 284/284, so A/N do cabecalho mudam — repartidos na divisao).
//
// extras: [{ arquivo, lado: 'azul'|'vermelho', grupo? }] — cada arquivo e uma fonte de UM bloco
// (formacao de biblioteca, possivelmente podada com `podar`).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { extrairLado } from './dividir.mjs';
import { compor } from './compor2.mjs';
import { ler } from './transplante.mjs';
import { registros, regraDeEnchimento } from './regs.mjs';
import { pintura, interior } from './zonas.mjs';
import { agrupar } from './agrupar.mjs';
import { codificarComoJogo } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';
import { abrirCompleto } from './anexar2.mjs';
import { posicaoDoElemento } from './core.mjs';

// POSICAO no COMPLETO (secao 97): dentro do registro, `10 | u32 rumo | x f32 | y f32`. O `posicaoDe`
// antigo trabalha no cru e exige `10 00`, o que falha quando o rumo nao e zero (unidade posicionada
// no editor) ou quando x/y tem bytes zero (corridas tokenizadas) — enxergava 123 das 242 unidades
// da V2. Aqui os zeros sao literais e a busca e pelo byte 0x10 seguido de dois floats plausiveis.
//
// SO PARA LER (secao 112.2). A varredura acerta o marcador na maioria dos registros, mas quando a
// SEMENTE tem um 0x10 antes dele — e o ultimo byte da semente costuma ser 0x10 — ela ancora cedo e
// os dois floats seguintes ainda parecem plausiveis. Para ESCREVER posicao use
// `core.posicaoDoElemento`, que ancora pela forma inteira.
export function posicaoNoCompleto(c, r, fimRegistro) {
  for (let o = r.c + 24; o + 13 <= fimRegistro && o <= r.c + 40; o++) {
    if (c[o] !== 0x10) continue;
    const x = c.readFloatLE(o + 5), y = c.readFloatLE(o + 9);
    if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < 20000 && Math.abs(y) < 20000) return { o, x, y, rumo: c.readUInt32LE(o + 1) };
  }
  return null;
}

// ESPALHAR PELA ZONA (24/10/2026, autor: no City 047r, 6 das 10 unidades da avenida ficaram a oeste). Os quantis da
// lista ordenada por linha seguiam a densidade de predios e nao cobriam a largura. Aqui a GEOMETRIA vem da zona inteira
// (`area`; sem ela, os proprios `tiles`) e so o encaixe final usa os `tiles` candidatos (o abrigo da infantaria).
//
// 07/11/2026 (autor: "o objetivo City East esta praticamente vazio", US b3 no 047r): os `ocupados` (as unidades de TODOS
// os grupos ja postos) entravam na geometria — sementes no tile mais longe deles e, no Lloyd, o tile mais perto de um
// ocupado saia da conta. O G14 segura City West e City East; o apoio dos grupos 1-13 estava mais no leste, e o G14 caiu
// 4 a oeste, 1 a leste, todos na borda sul da zona, fora dos objetivos. Agora:
//   1. REGIOES: a zona se parte nos pedacos separados por mais de 3 tiles (ruas nao separam; o vao entre dois objetivos
//      separa). Com 2..n regioes cada uma leva a sua cota, pela area (maior resto), e espalha so com o abrigo dela;
//      com mais regioes que unidades (bolsoes, a fileira de predios da avenida) a zona vai inteira;
//   2. a geometria e so da zona: semente no centroide (n = 1: o mais perto; mais: o mais longe), ponto mais distante,
//      Lloyd de 15 voltas;
//   3. encaixe no candidato livre mais perto, a pelo menos 0,75 x o espacamento da zona das ja escolhidas do grupo (sem
//      candidato assim, so nao empilha). Os ocupados dos outros grupos bloqueiam so o proprio tile.
// Determinista: empates pela ordem (y, x).
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
const porLinha = (a, b) => a[1] - b[1] || a[0] - b[0];

// pedacos da zona: tiles a ate `vao` tiles (Chebyshev) um do outro ficam juntos; maiores primeiro
function regioesDaZona(geo, vao = 3) {
  const set = new Set(geo.map((t) => t.join())); const visto = new Set(); const out = [];
  for (const t of geo) {
    if (visto.has(t.join())) continue;
    const fila = [t], r = []; visto.add(t.join());
    while (fila.length) {
      const [x, y] = fila.pop(); r.push([x, y]);
      for (let dy = -vao; dy <= vao; dy++) for (let dx = -vao; dx <= vao; dx++) { const k = `${x + dx},${y + dy}`; if (set.has(k) && !visto.has(k)) { visto.add(k); fila.push([x + dx, y + dy]); } }
    }
    out.push(r.sort(porLinha));
  }
  return out.sort((a, b) => b.length - a.length || porLinha(a[0], b[0]));
}

// n em partes pelas fracoes (maior resto; empate para a primeira) — o ia_agrupar.repartir, sem a importacao circular
function maiorResto(n, fracoes) {
  const base = fracoes.map((f) => Math.floor(f * n)); let falta = n - base.reduce((s, x) => s + x, 0);
  const restos = fracoes.map((f, k) => ({ k, r: f * n - base[k] })).sort((a, b) => b.r - a.r || a.k - b.k);
  for (let q = 0; falta > 0; q++, falta--) base[restos[q % restos.length].k]++;
  return base;
}

// n centros sobre a geometria (ordenada por linha): semente pelo centroide, ponto mais distante, Lloyd
function centrosDe(geo, n) {
  const minD = geo.map(() => Infinity); const centros = [];
  const pega = (i) => { centros.push([...geo[i]]); for (let k = 0; k < geo.length; k++) minD[k] = Math.min(minD[k], d2(geo[k], geo[i])); };
  const cx = geo.reduce((s, t) => s + t[0], 0) / geo.length, cy = geo.reduce((s, t) => s + t[1], 0) / geo.length;
  let i0 = 0; for (let k = 1; k < geo.length; k++) { const p = d2(geo[k], [cx, cy]), q = d2(geo[i0], [cx, cy]); if (n === 1 ? p < q : p > q) i0 = k; }
  pega(i0);
  while (centros.length < n) { let m = 0; for (let k = 1; k < geo.length; k++) if (minD[k] > minD[m]) m = k; pega(m); }
  for (let it = 0; it < 15; it++) {
    const soma = centros.map(() => [0, 0, 0]);
    for (const t of geo) { let k = 0, dk = Infinity; for (let j = 0; j < centros.length; j++) { const v = d2(t, centros[j]); if (v < dk) { dk = v; k = j; } } soma[k][0] += t[0]; soma[k][1] += t[1]; soma[k][2]++; }
    centros.forEach((cc, j) => { if (soma[j][2]) { cc[0] = soma[j][0] / soma[j][2]; cc[1] = soma[j][1] / soma[j][2]; } });
  }
  return centros;
}

// cada centro no candidato livre mais perto, longe `raio` das ja escolhidas do grupo; `tomado` (tiles) e atualizado.
// Sem candidato livre na regiao, o livre mais perto da zona inteira (`reserva`) antes de empilhar: uma regiao pequena
// pode ter menos abrigo que a cota (Village-Hills 300, G2).
function encaixar(centros, cand, tomado, raio, reserva = cand) {
  const proprios = []; const r2 = raio * raio;
  return centros.map((cc) => {
    for (const [lista, rr] of [[cand, r2], [cand, 0], [reserva, 0]]) {
      let k = -1;
      for (let j = 0; j < lista.length; j++) {
        if (tomado.has(lista[j].join()) || !proprios.every((p) => d2(lista[j], p) >= rr)) continue;
        if (k < 0 || d2(lista[j], cc) < d2(lista[k], cc)) k = j;
      }
      if (k >= 0) { tomado.add(lista[k].join()); proprios.push(lista[k]); return lista[k]; }
    }
    let k = 0; for (let j = 1; j < cand.length; j++) if (d2(cand[j], cc) < d2(cand[k], cc)) k = j;   // tudo tomado: o mais perto
    proprios.push(cand[k]); return cand[k];
  });
}

export function espalhar(tiles, n, ocupados = [], area = null) {
  const cand = [...tiles].sort(porLinha); if (n <= 0 || !cand.length) return [];
  const geo = [...(area && area.length ? area : tiles)].sort(porLinha);
  const tomado = new Set(ocupados.map((o) => o.join()));
  const regs = regioesDaZona(geo);
  if (regs.length > 1 && regs.length <= n) {
    const cotas = maiorResto(n, regs.map((r) => r.length / geo.length));
    const candPor = regs.map(() => []);
    for (const t of cand) { let k = 0, dk = Infinity; regs.forEach((r, j) => { for (const q of r) { const v = d2(t, q); if (v < dk) { dk = v; k = j; } } }); candPor[k].push(t); }
    const out = [];
    regs.forEach((r, j) => { if (cotas[j]) out.push(...encaixar(centrosDe(r, cotas[j]), candPor[j].length ? candPor[j] : cand, tomado, 0.75 * Math.sqrt(r.length / cotas[j]), cand)); });
    return out;
  }
  return encaixar(centrosDe(geo, n), cand, tomado, 0.75 * Math.sqrt(geo.length / n));
}

// Posiciona so os registros de `ids` (ativos) nos tiles dados; ausentes vao para o primeiro tile.
// Trabalha no completo e recodifica com codificarComoJogo. `opcoes.espalhar` (o defensor por grupo de IA) escolhe os
// tiles por `espalhar` (geometria de `opcoes.area`), longe dos `opcoes.ocupados`; sem ela, os quantis de sempre (o deploy do jogador).
export function posicionarIds(entrada, saida, ids, tiles, passo = 2, opcoes = {}) {
  const X = abrirCompleto(entrada); const c = Buffer.from(X.completo); const R = X.R;
  const alvo = []; R.forEach((r, k) => { if (r.form || !ids.has(r.id)) return; const fim = R[k + 1] ? R[k + 1].c : c.length; const o = posicaoDoElemento(c, r, fim); if (o !== null) alvo.push({ r, p: { o } }); });
  const ord = [...new Set(tiles.map(([x, y]) => x + ',' + y))].map((s) => s.split(',').map(Number)).filter(([x, y]) => x % passo === 0 && y % passo === 0).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const ativos = alvo.filter((u) => !u.r.ausente), ausentes = alvo.filter((u) => u.r.ausente);
  if (ord.length < ativos.length) throw new Error(`${ord.length} tiles para ${ativos.length} unidades novas`);
  const escreve = (u, [x, y]) => { c.writeFloatLE(8 * x + 4, u.p.o + 5); c.writeFloatLE(8 * y + 4, u.p.o + 9); };
  // espalha pelo INTERIOR da zona, a partir do meio (as unidades antigas costumam ocupar a primeira fileira)
  const usados = opcoes.espalhar ? espalhar(ord, ativos.length, opcoes.ocupados || [], opcoes.area)
    : ativos.map((u, k) => ord[Math.floor((k + 0.5) * ord.length / (ativos.length + 1))]);
  ativos.forEach((u, k) => escreve(u, usados[k]));
  ausentes.forEach((u) => escreve(u, ord[0]));
  reconstruir(entrada, saida, (x, k) => (k === 1 ? codificarComoJogo(c, X.d.esc) : x));
  return { ativos: ativos.length, ausentes: ausentes.length, tiles: ord.length, usados, semPosicao: R.filter((r) => !r.form && ids.has(r.id)).length - alvo.length };
}

// NOMES PROPRIOS embutidos (secao 97): o editor deixa renomear unidades e formacoes; o registro
// ganha `u16 len | texto` em +20 (logo apos o par de tipo) e o bit 0x10 no flag +7. Remove-os,
// devolvendo o registro ao formato da biblioteca.
export function limparNomes(entrada, saida) {
  const X = abrirCompleto(entrada); const c = X.completo; const partes = []; let pos = 0; const feitos = [];
  for (const r of X.R) {
    if (!(c[r.c + 7] & 0x10)) continue;
    const o = r.c + 20; const L = c.readUInt16LE(o); const s = c.toString('latin1', o + 2, o + 2 + L);
    if (!(L >= 1 && L <= 40 && /^[\x20-\x7e]+$/.test(s))) { feitos.push(`?? ${r.nm}: bit 0x10 sem nome legivel`); continue; }
    partes.push(c.subarray(pos, r.c + 7), Buffer.from([c[r.c + 7] & ~0x10]), c.subarray(r.c + 8, o)); pos = o + 2 + L; feitos.push(`${r.nm}: "${s}"`);
  }
  partes.push(c.subarray(pos)); const novo = Buffer.concat(partes);
  reconstruir(entrada, saida, (x, k) => (k === 1 ? codificarComoJogo(novo, X.d.esc) : x));
  return { removidos: feitos, bytes: c.length - novo.length };
}

// ANEXAR UM REGISTRO (secao 97): copia um registro qualquer do doador (pelo id) para o FIM da
// formacao de topo do alvo, como filho direto — enchimento pela regra do ultimo byte, id = maior+1,
// contador de filhos do topo +1, N +1, flags de ausencia/nome limpos. Foi assim que o Breach Team
// (comprado no editor num batalhao que nao carregava mais) entrou num batalhao limpo da biblioteca.
export function anexarRegistro(alvo, doador, idDoador, saida) {
  const fimDosRegistros = (c, desde) => { for (let i = desde; i < c.length; i++) { if (c[i] !== 0) continue; let z = 0; while (i + z < c.length && c[i + z] === 0) z++; if (z >= 32) return i; i += z; } return c.length; };
  const D = abrirCompleto(doador); const k = D.R.findIndex((r) => r.id === idDoador); if (k < 0) throw new Error(`id ${idDoador} nao esta no doador`);
  let fim = D.R[k + 1] ? D.R[k + 1].c : fimDosRegistros(D.completo, D.R[k].c); while (D.completo[fim - 1] === 0) fim--;
  const carga = Buffer.from(D.completo.subarray(D.R[k].c, fim)); carga[7] &= ~(0x80 | 0x10);
  const A = abrirCompleto(alvo); const c0 = A.completo;
  const corte = fimDosRegistros(c0, A.R[A.R.length - 1].c);
  const regra = regraDeEnchimento(c0, corte); const pad = Math.max(0, regra - 3);
  const c = Buffer.concat([c0.subarray(0, corte), Buffer.alloc(pad), carga, c0.subarray(corte)]);
  c.writeUInt32LE(Math.max(...A.R.map((r) => r.id)) + 1, corte + pad + 3);
  c.writeUInt32LE(c.readUInt32LE(A.R[1].c - 1) + 1, A.R[1].c - 1);
  c.writeUInt32LE(c.readUInt32LE(A.m + 9) + 1, A.m + 9); c.writeUInt32LE(c.readUInt32LE(A.m + 5) + 51, A.m + 5);
  reconstruir(alvo, saida, (x, i) => (i === 1 ? codificarComoJogo(c, A.d.esc) : x));
  const V = abrirCompleto(saida); if (V.R.length !== A.R.length + 1) throw new Error(`gravado com ${V.R.length} registros, esperava ${A.R.length + 1}`);
  return { anexado: D.R[k].nm, id: V.R[V.R.length - 1].id, registros: V.R.length };
}

export function acrescentar(batalha, extras, saida) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-acr-')); const T = (n) => path.join(tmp, n);
  const antes = registros(ler(batalha).cru).length;
  extrairLado(batalha, T('azul.btt'), 'azul'); extrairLado(batalha, T('verm.btt'), 'vermelho');
  const lista = [{ arquivo: T('azul.btt'), lado: 'azul' }, ...extras.filter((e) => e.lado === 'azul'), { arquivo: T('verm.btt'), lado: 'vermelho' }, ...extras.filter((e) => e.lado === 'vermelho')];
  const r = compor(lista, T('comp.btt'));
  // registros novos = os que vieram dos extras: ids alem dos originais de cada bloco, por posicao na lista
  const R = registros(ler(T('comp.btt')).cru).sort((a, b) => a.off - b.off);
  const nBase = { azul: registros(ler(T('azul.btt')).cru).length, vermelho: registros(ler(T('verm.btt')).cru).length };
  const nExtra = {}; for (const e of extras) nExtra[e.arquivo] = registros(ler(e.arquivo).cru).length;
  const novos = { azul: new Set(), vermelho: new Set() }; const porExtra = [];
  let i = nBase.azul; for (const e of extras.filter((x) => x.lado === 'azul')) { const ids = R.slice(i, i + nExtra[e.arquivo]).map((x) => x.id); ids.forEach((id) => novos.azul.add(id)); porExtra.push({ ...e, ids }); i += nExtra[e.arquivo]; }
  i += nBase.vermelho; for (const e of extras.filter((x) => x.lado === 'vermelho')) { const ids = R.slice(i, i + nExtra[e.arquivo]).map((x) => x.id); ids.forEach((id) => novos.vermelho.add(id)); porExtra.push({ ...e, ids }); i += nExtra[e.arquivo]; }
  // posicao dos novos na zona do lado (tinta da grade, erodida)
  let atual = T('comp.btt'); const z = pintura(atual); const pos = {};
  for (const lado of ['azul', 'vermelho']) {
    if (!novos[lado].size) continue;
    const tiles = interior(z[lado].flatMap((l) => l.tiles)); const prox = T(`pos-${lado}.btt`);
    pos[lado] = posicionarIds(atual, prox, novos[lado], tiles, 2); atual = prox;
  }
  // grupo de IA por extra (agrupar por indice de topo: os extras sao os ultimos topos de cada lado)
  const grupos = [];
  for (const e of porExtra) { if (!e.grupo) continue; const prox = T('grp-' + grupos.length + '.btt'); const primeiro = R.find((x) => x.id === e.ids[0]); const ag = agrupar(atual, prox, new RegExp('^' + primeiro.nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), [{ grupo: e.grupo }]); grupos.push(ag.feitos); atual = prox; }
  fs.copyFileSync(atual, saida);
  const depois = registros(ler(saida).cru); const ativos = depois.filter((x) => !x.ausente && !x.form);
  fs.rmSync(tmp, { recursive: true, force: true });
  return { antes, depois: depois.length, ativos: ativos.length, kAzul: r.kAzul, kVerm: r.kVerm, novos: porExtra.map((e) => ({ arquivo: path.basename(e.arquivo), lado: e.lado, ids: e.ids.length, grupo: e.grupo || null })), pos, grupos };
}
