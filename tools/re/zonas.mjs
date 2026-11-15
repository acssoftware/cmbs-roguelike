// LISTAS DE TILES do mapa (objetivos, zonas de setup, zonas de plano de IA) — secao 60.
// Depois das camadas de tile, o mapa guarda areas pintadas como listas explicitas de pares
// (u32 x, u32 y) num canvas de 1024x1024 tiles com o mapa centrado (offset (1024-W)/2-2).
// Cada lista vem precedida de um cabecalho curto que termina em `ff | contagem u32`; objetivos
// tem nome (`07 03 00 00 | u16 len | ascii`) antes da lista.
import { ler } from './transplante.mjs';
import { expandir } from './escape.mjs';
import { lerMapa, lerGrade } from './mapa.mjs';   // circular com mapa.mjs (dimensoes/grade): so uso em chamada

export function dimensoes(c) {
  // cabecalho do mapa: u16 OX, u16 OY, u16 W, u16 H (secao 60) — City (472,438,76,100), Podlypyky (138,486,242,226)
  for (let i = 280; i < 400; i++) { const w = c.readUInt16LE(i), h = c.readUInt16LE(i + 2); if (w >= 20 && w <= 400 && h >= 20 && h <= 400 && w % 2 === 0 && h % 2 === 0) return { W: w, H: h, OX: c.readUInt16LE(i - 4), OY: c.readUInt16LE(i - 2), pos: i }; }
  throw new Error('dimensoes do mapa nao achadas');
}

export function listas(caminho) {
  const d = ler(caminho); const c = expandir(d.cru, d.tokens).completo;
  const { W, H, OX, OY } = dimensoes(c);
  const okX = (v) => v >= OX && v < OX + W, okY = (v) => v >= OY && v < OY + H;
  const out = []; let o = 0;
  while (o + 8 <= c.length) {
    if (c.readUInt32LE(o) === 0x307) { const len = c.readUInt16LE(o + 4); if (len > 0 && len < 64) { const nome = c.subarray(o + 6, o + 6 + len).toString('latin1'); if (/^[\x20-\x7e]+$/.test(nome)) { out.push({ tipo: 'nome', ini: o, fim: o + 6 + len, nome }); o += 6 + len; continue; } } }
    if (okX(c.readUInt32LE(o)) && okY(c.readUInt32LE(o + 4))) {
      let q = o, n = 0; while (q + 8 <= c.length && okX(c.readUInt32LE(q)) && okY(c.readUInt32LE(q + 4))) { q += 8; n++; }
      if (n >= 4) {
        // cabecalho: os bytes antes, ate o 'ff' que precede a contagem (contagem == n)
        let cab = null; for (let k = 5; k <= 40; k++) { const p = o - k; if (p >= 0 && c[p] === 0xff && c.readUInt32LE(p + 1) === n) { cab = { pos: p - 4 >= 0 ? p - 4 : 0, bytes: c.subarray(Math.max(0, p - 8), p).toString('hex') }; break; } }
        const tiles = []; for (let q2 = o; q2 < q; q2 += 8) tiles.push([c.readUInt32LE(q2) - OX, c.readUInt32LE(q2 + 4) - OY]);
        out.push({ tipo: 'lista', ini: o, fim: q, n, cab, tiles }); o = q; continue;
      }
    }
    o++;
  }
  return { W, H, OX, OY, itens: out, c };
}

export function desenhar(l, W, H, passo = 2) {
  const g = Array.from({ length: H }, () => Array(W).fill('.'));
  for (const [x, y] of l.tiles) if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = '#';
  const linhas = []; for (let y = H - 1; y >= 0; y -= passo) { let s = ''; for (let x = 0; x < W; x += passo) s += g[y][x]; linhas.push(s); }
  return linhas.join('\n');
}

const EH_MAIN = process.argv[1] && /[\\/]zonas\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const [arq, ...opts] = process.argv.slice(2);
  const { W, H, OX, OY, itens } = listas(arq);
  console.log(`${arq.split(/[\/]/).pop()}: ${W}x${H} tiles, canvas offset (${OX},${OY}); ${itens.filter((i) => i.tipo === 'lista').length} listas, ${itens.filter((i) => i.tipo === 'nome').length} nomes`);
  const min = +(opts.find((o) => /^min=/.test(o)) || 'min=0').slice(4);
  for (const it of itens) {
    if (it.tipo === 'nome') { console.log(`${it.ini} NOME "${it.nome}"`); continue; }
    const xs = it.tiles.map((t) => t[0]), ys = it.tiles.map((t) => t[1]);
    console.log(`${it.ini} LISTA ${it.n} tiles X ${Math.min(...xs)}..${Math.max(...xs)} Y ${Math.min(...ys)}..${Math.max(...ys)}  cab ${it.cab ? it.cab.bytes : '?'}`);
    if (opts.includes('desenhar') && it.n >= min) console.log(desenhar(it, W, H, W > 120 ? 4 : 2));
  }
}

// PATCH das flags de uma lista: os 4 bytes de flags ficam 12 bytes antes do primeiro par
// (flags u32 | id u32 | contagem u32). Reescreve na corrente COMPACTADA via o mapa de origem da
// corrente completa (os bytes de flags nunca sao zeros tokenizados nos casos vistos; se forem,
// o mapa devolve -1 e a funcao recusa).
import { codificar } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';
export function patchFlags(entrada, saida, patches) {   // patches: [{ini (offset da lista na completa), bytes:[b0,b1,b2,b3]}]
  const d = ler(entrada); const { completo, mapa } = expandir(d.cru, d.tokens);
  const cru = Buffer.from(d.cru);
  for (const p of patches) {
    for (let k = 0; k < 4; k++) {
      const pos = p.ini - 12 + k; const o = mapa[pos];
      if (o < 0) throw new Error(`flag em ${pos} e zero tokenizado; patch nao suportado`);
      cru[o] = p.bytes[k];
    }
  }
  const b = Buffer.concat([Buffer.from([d.esc, 0x00]), codificar({ cru, tokens: d.tokens }, d.esc)]);
  reconstruir(entrada, saida, (x, k) => (k === 1 ? b : x));
}

// TROCA DE LADO das zonas escrevendo na corrente COMPLETA e recodificando canonicamente
// (secao 62). `mudancas`: [{ini, bytes:[4]}] com `ini` = offset da lista na corrente completa.
import { codificarCanonico } from './escape.mjs';
export function patchFlagsCompleto(entrada, saida, patches) {
  const d = ler(entrada); const { completo } = expandir(d.cru, d.tokens); const c = Buffer.from(completo);
  for (const p of patches) for (let k = 0; k < 4; k++) c[p.ini - 12 + k] = p.bytes[k];
  const bl = codificarCanonico(c);
  reconstruir(entrada, saida, (x, k) => (k === 1 ? bl : x));
}

// EDICAO MINIMA na corrente compactada, guiada pela corrente completa (secao 63): para cada byte
// a escrever em `pos` (offset completo): se ele vem de um byte literal do cru, troca no lugar;
// se vem de um token (zero tokenizado), o token inteiro vira bytes literais (os N zeros, com o
// novo valor no lugar certo) — corridas de ate 3 zeros literais sao normais no formato. Os tokens
// seguintes deslocam. Nao junta nem cria tokens: e o menor desvio possivel do que o jogo gravou.
export function escreverBytes(entrada, saida, escritas) {   // escritas: [{pos, valor}]
  const d = ler(entrada); const { completo, mapa, tokenDe } = expandir(d.cru, d.tokens);
  let cru = Buffer.from(d.cru); let tokens = d.tokens.map((t) => ({ ...t }));
  // aplica em ordem decrescente de pos para os deslocamentos nao atrapalharem
  const porToken = new Map();
  for (const e of [...escritas].sort((a, b) => b.pos - a.pos)) {
    const o = mapa[e.pos];
    if (o >= 0) { cru[o] = e.valor; continue; }
    const k = tokenDe[e.pos]; if (!porToken.has(k)) porToken.set(k, []); porToken.get(k).push(e);
  }
  // tokens a expandir, do ultimo para o primeiro (posicoes no cru so mudam depois do ponto)
  const ks = [...porToken.keys()].sort((a, b) => tokens[b].pos - tokens[a].pos);
  for (const k of ks) {
    const t = tokens[k]; const n = t.cod;
    // inicio do token na corrente completa: primeiro pos com tokenDe == k
    let ini = -1; for (let p = 0; p < tokenDe.length; p++) if (tokenDe[p] === k) { ini = p; break; }
    const bytes = Buffer.alloc(n); for (const e of porToken.get(k)) bytes[e.pos - ini] = e.valor;
    cru = Buffer.concat([cru.subarray(0, t.pos), bytes, cru.subarray(t.pos)]);
    tokens = tokens.filter((_, i) => i !== k).map((u) => (u.pos > t.pos || (u.pos === t.pos && tokens.indexOf(u) > k) ? { ...u, pos: u.pos + n } : u));
  }
  const b = Buffer.concat([Buffer.from([d.esc, 0x00]), codificar({ cru, tokens }, d.esc)]);
  reconstruir(entrada, saida, (x, kk) => (kk === 1 ? b : x));
}

// ZONAS DE SETUP POR LADO: entre as listas do mapa, as de setup tem flags `u16 indice | u16 lado`
// (lado 1 = azul, 0 = vermelho) e id `78 f7 18 00`; no Podlypyky sao as tres areas do norte
// (azul, indices 3/4/5) e as seis faixas do sul (vermelho, indice 0). As demais listas com o
// mesmo id sao zonas de plano de IA (flags com outro desenho) — por enquanto o criterio e o id
// mais o lado, e ficam de fora as listas de id 0 e as dos objetivos.
export function zonasDeSetup(caminho) {
  const { W, H, itens, c } = listas(caminho);
  // Estrutura observada (secao 63): cada zona de setup (id 78 f7 18 00) vem SEGUIDA de uma ou mais
  // listas de ordens (id 0). Tres listas com a mesma assinatura em cima dos objetivos NAO tem
  // ordens a seguir e nao aparecem pintadas na vista Setup Zones: sao de plano de IA e ficam fora.
  const L = itens.filter((i) => i.tipo === 'lista');
  const azul = [], vermelho = [];
  for (let i = 0; i < L.length; i++) {
    const it = L[i]; const id = c.subarray(it.ini - 8, it.ini - 4).toString('hex'); if (id !== '78f71800') continue;
    let ordens = 0; for (let j = i + 1; j < L.length; j++) { const idj = c.subarray(L[j].ini - 8, L[j].ini - 4).toString('hex'); if (idj === '00000000') ordens++; else break; }
    if (!ordens) continue;
    const lado = c.readUInt16LE(it.ini - 10), indice = c.readUInt16LE(it.ini - 12);
    (lado === 1 ? azul : vermelho).push({ ...it, indice, ordens });
  }
  return { W, H, azul, vermelho };
}

// A GRADE DE TERRENO (secao 69). Depois do cabecalho e de listas de objetos de tamanho variavel
// vem W*H tuplas de 5 bytes, linha a linha a partir da borda SUL: `tipo | ? | ? | flags | elev`.
// O byte `flags` guarda a ZONA DE SETUP PINTADA nos 3 bits altos (valor = flags >> 5): 1..3 =
// Blue 1..3, 4.. = Red 1.. (observado: 1, 2 e 4 no Podlypyky; 4 = a faixa vermelha de 8 linhas
// que o jogo tinge no Deploy). E a tinta do jogador — as listas `78 f7 18 00` sao zonas de grupo
// do plano de IA, parecidas mas nao iguais (mais largas e com buracos).
//
// Onde a grade comeca nao e fixo (as listas antes dela variam). Achamos assim: a coerencia com a
// linha de cima (lag 5W) delimita a regiao; a fase (mod 5) e a que zera os bits baixos de `flags`;
// e G e o primeiro offset nessa fase cuja linha 0 inteira e de tuplas limpas. No Podlypyky da
// 8509 — exatamente onde acaba a lista de itens `16 04 ...` — e a grade tem W*H + 2 tuplas (as
// duas sobrando repetem a ultima linha).
export function grade(c) {
  const { W, H, pos } = dimensoes(c); const L = W * 5;
  const N = Math.min(c.length - L, 600000);
  let g0 = null, run = 0;
  for (let i = pos; i < N; i++) { run += c[i] === c[i + L] ? 1 : 0; if (i - pos >= L) { run -= c[i - L] === c[i] ? 1 : 0; if (run / L > 0.55) { g0 = i - L; break; } } }
  if (g0 === null) throw new Error('grade de terreno nao encontrada');
  let fase = 0, menor = Infinity;
  for (let p = 0; p < 5; p++) { let n = 0; for (let k = 0; k < 2000; k++) { const o = g0 + L + p + 5 * k; if (c[o + 3] & 0x1f) n++; } if (n < menor) { menor = n; fase = p; } }
  const limpa = (o) => (c[o + 3] & 0x1f) === 0;   // so os bits baixos de flags: o byte 1 varia por mapa (City tem 0x20 em 25% dos tiles)
  let G = null;
  for (let b = g0 - L + fase; b <= g0 + 2 * L; b += 5) { if (b < pos) continue; let ok = true; for (let x = 0; x < W; x++) if (!limpa(b + 5 * x)) { ok = false; break; } if (ok) { G = b; break; } }
  if (G === null) throw new Error('inicio da grade nao encontrado');
  return { W, H, G };
}

// Tiles pintados como zona de setup, por lado, lidos da grade. Devolve {W, H, azul, vermelho}
// no mesmo formato de zonasDeSetup (listas com `tiles`), uma lista por valor de tinta.
// Le pela grade INDEXADA de mapa.mjs (secao 92: landmarks tornam o stride variavel; a heuristica
// de fase `grade()` derrapava depois do 1o landmark). Import circular so em tempo de chamada.
export function pintura(caminho) {
  const m = lerMapa(caminho);
  if (m.gridStart == null) throw new Error('grade nao alinhada');
  const { W, H, gridStart: G } = m; const { tile } = lerGrade(m);
  const porValor = new Map();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = tile(x, y).zona; if (!v) continue; if (!porValor.has(v)) porValor.set(v, []); porValor.get(v).push([x, y]); }
  const azul = [], vermelho = [];
  for (const [v, tiles] of [...porValor.entries()].sort((a, b) => a[0] - b[0])) (v <= 3 ? azul : vermelho).push({ valor: v, n: tiles.length, tiles });
  return { W, H, G, azul, vermelho };
}

// Erosao: so tiles cujos vizinhos ate `dx` colunas e `dy` linhas tambem estao pintados. Serve
// para nao encostar na borda da zona (e absorve a duvida de +-2 tiles no alinhamento da grade).
export function interior(tiles, dx = 2, dy = 1) {
  const set = new Set(tiles.map(([x, y]) => x + ',' + y));
  return tiles.filter(([x, y]) => { for (let i = -dx; i <= dx; i++) for (let j = -dy; j <= dy; j++) if (!set.has((x + i) + ',' + (y + j))) return false; return true; });
}
