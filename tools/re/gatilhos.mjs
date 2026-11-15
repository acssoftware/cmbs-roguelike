// OS GATILHOS (TRIGGERS) DA IA num mapa ou cenario (E87, 21/09/2026) — FORMATO 123.
//
// O autor: "zonas de trigger ... definir areas que quando tocadas por red ou blue, desperta uma regra
// AI do oponente ... permite criar mecanicas de contra-ataque e mobilidade". O manual (MANUAL_EDITOR
// 3.7): um grupo pode "Wait For" (a) uma ORDEM de outro grupo comecar — a ordem marcada "Can Trigger" —
// ou (b) uma unidade tocar um OBJETIVO-trigger (amigo/inimigo, qualquer/blindado). O gatilho dispara
// quando a ordem COMECA. A espera fica na janela "Exit Between a and b": nunca sai antes de a, sai em b
// mesmo sem disparo.
//
// No arquivo (medido nos 360 mapas de QB, 29.883 entradas de IA):
//   ENTRADA da IA (ia.mjs) = 7 B | u32 a | u32 b | u8 PODE_DISPARAR | u8 n | n x ESPERA | ptr | tiles
//     PODE_DISPARAR = 1 na ordem marcada "Can Trigger" (nunca no Setup: 0 em 29.883)
//     n = 0 ou 1 ("uma ordem so pode usar um trigger")
//     ESPERA (5 B) = u8 tipo | u16 i | u16 j
//       tipo 0 (ORDEM): espera a entrada j do grupo i+1 do MESMO plano comecar (j = 0 Setup, 1 Order 2...)
//                       — 1112 de 1122 apontam para uma entrada com PODE_DISPARAR = 1
//       tipo 1 (OBJETIVO): espera o objetivo-trigger de indice i na lista de objetivos do proprio lado
//                       (j sobra de edicao, quase sempre 1) — 2634 de 3084 apontam um registro-trigger
//   OBJETIVOS DE TERRENO: 30 VAGAS (Obj 1..15 azul, depois Obj 1..15 vermelho), a primeira 130 B depois
//   do fim da regiao de IA — os 360 mapas caminham inteiros. Cada vaga (MEDIDO NO EDITOR, E88: um Obj de
//   cada tipo e de cada "Known To" num salvamento so, ZZ MAPA/T1 OBJ TIPOS):
//     u8 TIPO | u8 KNOWN | u16 pontos | u16 len | nome | u32 cor | u32 n | n x (u32 x, u32 y) [| u8 0]
//     TIPO  0 Occupy, 1 Preserve, 2 Destroy, 3 Touch, 4 Exit, 5 A.I. Trigger (friendly),
//           6 A.I. Trigger (friendly armor), 7 A.I. Trigger (enemy), 8 A.I. Trigger (enemy armor)
//     KNOWN 0 Player, 1 Enemy, 2 Both, 3 Neither (os autores de QB poem os triggers em Neither)
//     u8 0 extra depois dos tiles: o editor atual grava nos tipos 3 e 5..8 com tiles; ~100 triggers de
//     mapas antigos vem sem ele, e o leitor decide pela vaga seguinte. Vaga vazia = 14 B (`00 02 ...`).
//   O `i` da ESPERA tipo 1 e o numero da vaga do proprio lado (0 = Obj 1).
//   A JANELA `a`/`b` e em SEGUNDOS; o "+" do editor soma 30 s.
//   PROVADO NO EDITOR (E88): esperas escritas por `escreverEspera` (ordem e objetivo) carregam e voltam
//   intactas num novo salvamento (ZZ MAPA/0T4B, 0T5). Nesta resolucao o editor nao desenha o botao
//   "Wait For" nem os textos da janela (so os botoes -/+), entao criar a espera por codigo e o caminho.
//
//   node tools/re/gatilhos.mjs "<arquivo.btt>"      imprime a mecanica do mapa em portugues
import { lerPlanos } from './ia.mjs';

export const TIPO_OBJ = ['Occupy', 'Preserve', 'Destroy', 'Touch', 'Exit', 'A.I. Trigger (friendly)', 'A.I. Trigger (friendly armor)', 'A.I. Trigger (enemy)', 'A.I. Trigger (enemy armor)'];
export const KNOWN = ['Known to Player', 'Known to Enemy', 'Known to Both', 'Known to Neither'];
export const ehTrigger = (tipo) => tipo >= 5 && tipo <= 8;
const NOMEOK = /^[\x20-\x7e]*$/;

// AS 30 VAGAS, a partir de `ini` (fim da regiao de IA + 130). O byte extra e escolhido pela vaga
// seguinte (com volta atras): o editor atual o grava nos tipos 3 e 5..8 com tiles, mapas antigos nao.
export function vagasDeObjetivos(c, ini) {
  const slot = (p) => {
    if (p + 14 > c.length) return null;
    const tipo = c[p], known = c[p + 1], len = c.readUInt16LE(p + 4);
    if (tipo > 8 || known > 3 || len > 64) return null;
    const nome = c.toString('latin1', p + 6, p + 6 + len); if (!NOMEOK.test(nome)) return null;
    const n = c.readUInt32LE(p + 10 + len); if (n > 60000 || p + 14 + len + 8 * n > c.length) return null;
    for (let q = 0; q < Math.min(n, 4); q++) if (c.readUInt32LE(p + 14 + len + 8 * q) >= 1024 || c.readUInt32LE(p + 18 + len + 8 * q) >= 1024) return null;
    return { em: p, tipo, known, pontos: c.readUInt16LE(p + 2), nome, pos: p + 6, n, tilesEm: p + 14 + len, fim: p + 14 + len + 8 * n };
  };
  const andar = (p, k, acc) => {
    if (k === 30) return acc;
    const s = slot(p); if (!s) return null;
    const ordem = ((s.tipo === 3 || ehTrigger(s.tipo)) && s.n) ? [1, 0] : [0, 1];
    for (const extra of ordem) {
      if (extra && c[s.fim] !== 0) continue;
      const r = andar(s.fim + extra, k + 1, [...acc, { ...s, vaga: k % 15, lado: k < 15 ? 'azul' : 'vermelho', extra: !!extra }]);
      if (r) return r;
    }
    return null;
  };
  const v = andar(ini, 0, []);
  if (!v) throw new Error('as 30 vagas de objetivo nao caminham');
  return v;
}

// Compatibilidade: as duas listas (so as vagas usadas nao importa — o INDICE e o da vaga).
export function listasDeObjetivos(c, fimIA) {
  const v = vagasDeObjetivos(c, fimIA + 130);
  return { azul: v.slice(0, 15), vermelho: v.slice(15), extras: [] };
}

// A heuristica antiga (E87), que nao conhecia o inicio fixo; fica so para comparacao.
export function listasDeObjetivosHeuristica(c, de) {
  const NOME = /^[\x20-\x7e]{1,48}$/;
  const recs = [];
  for (let p = de + 6; p + 12 < c.length; p++) {
    const len = c.readUInt16LE(p - 2); if (len < 1 || len > 48 || p + len + 8 > c.length) continue;
    if (c[p - 5] < 1 || c[p - 5] > 8) continue;
    const nome = c.toString('latin1', p, p + len); if (!NOME.test(nome) || !/[A-Za-z0-9]/.test(nome)) continue;
    const n = c.readUInt32LE(p + len + 4); if (n > 40000 || p + len + 8 + 8 * n > c.length) continue;
    let ok = true; for (let k = 0; k < Math.min(n, 6); k++) { if (c.readUInt32LE(p + len + 8 + 8 * k) >= 1024 || c.readUInt32LE(p + len + 12 + 8 * k) >= 1024) { ok = false; break; } }
    if (!ok) continue;
    recs.push({ pos: p, condicao: c[p - 6], tipo: c[p - 5], pontos: c.readUInt16LE(p - 4), nome, n, tilesEm: p + len + 8, fim: p + len + 8 + 8 * n });
    p += len + 8 + 8 * n - 1;
  }
  const L = []; let cur = [];
  for (const r of recs) {
    const gap = cur.length ? r.pos - 6 - cur[cur.length - 1].fim : 0;
    if (cur.length && (gap < 0 || gap > (r.n === 0 ? 32 : 1))) { L.push(cur); cur = []; }
    cur.push(r);
  }
  if (cur.length) L.push(cur);
  return { azul: L[0] || [], vermelho: L[1] || [], extras: L.slice(2) };
}

export function lerGatilhos(arquivo) {
  const r = lerPlanos(arquivo);
  if (!r.confiavel) throw new Error('planos de IA ilegiveis');
  const c = r.c;
  const objs = listasDeObjetivos(c, r.ini + 4 + r.len);
  const planos = [];
  for (const pl of r.planos) {
    if (!pl.grupos.length) continue;
    const grupos = pl.grupos.map((g) => ({
      grupo: g.grupo,
      entradas: g.entradas.map((e, k) => {
        const n = c[e.ini + 16];
        const espera = n ? { tipo: c[e.ini + 17], i: c.readUInt16LE(e.ini + 18), j: c.readUInt16LE(e.ini + 20) } : null;
        return { k, nome: k ? `Order ${k + 1}` : 'Setup', a: c.readUInt32LE(e.ini + 7), b: c.readUInt32LE(e.ini + 11), podeDisparar: c[e.ini + 15] === 1, espera, tiles: (k ? g.ordens[k - 1] : g.setup).length, ini: e.ini };
      }),
    }));
    planos.push({ lado: pl.lado, plano: pl.plano, uso: pl.usoNome, grupos });
  }
  return { objetivos: objs, planos };
}

const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
export function descrever(g) {
  const L = [];
  for (const lado of ['azul', 'vermelho']) {
    const usados = g.objetivos[lado].filter((o) => o.n || o.nome);
    const trig = usados.filter((o) => ehTrigger(o.tipo));
    L.push(`${lado.toUpperCase()}: ${usados.length} objetivos em uso, ${trig.length} triggers`);
    for (const o of usados) L.push(`   Obj ${o.vaga + 1} "${o.nome.trim()}" ${TIPO_OBJ[o.tipo]}, ${KNOWN[o.known]}${o.pontos ? ', ' + o.pontos + ' pts' : ''}, ${o.n} tiles`);
  }
  for (const pl of g.planos) {
    const linhas = [];
    for (const gr of pl.grupos) for (const e of gr.entradas) {
      if (!e.espera && !e.podeDisparar) continue;
      let t = `   G${gr.grupo} ${e.nome}`;
      if (e.podeDisparar) t += ' [dispara quando comeca]';
      if (e.espera) {
        if (e.espera.tipo === 0) t += ` espera G${e.espera.i + 1} ${e.espera.j ? 'Order ' + (e.espera.j + 1) : 'Setup'} comecar`;
        else { const o = g.objetivos[pl.lado][e.espera.i]; t += ` espera Obj ${e.espera.i + 1}${o ? ` "${o.nome.trim()}" (${TIPO_OBJ[o.tipo]})` : ''}`; }
        t += `, sai entre ${mmss(e.a)} e ${mmss(e.b)}`;
      }
      linhas.push(t);
    }
    if (linhas.length) { L.push(`${pl.lado} Plan ${pl.plano} [${pl.uso}]`); L.push(...linhas); }
  }
  return L.join('\n');
}

// ESCREVER UMA ESPERA ("Wait For") numa entrada que nao tem: `u8 n` de 0 para 1 e os 5 B da ESPERA
// inseridos logo depois — a regiao de IA cresce 5 B, e o `u32 len` na frente dela acompanha. `espera`
// = { tipo: 0, i: grupo-1, j: entrada } (ordem) ou { tipo: 1, i: vaga, j: 1 } (objetivo-trigger).
// A ordem alvo de uma espera tipo 0 tem de estar marcada "Can Trigger" (`podeDisparar`).
export async function escreverEspera(arquivo, saida, { lado, plano, grupo, entrada, espera }) {
  const { pecas, escrever } = await import('./mapa_escrever.mjs');
  const r = lerPlanos(arquivo); if (!r.confiavel) throw new Error('planos de IA ilegiveis');
  const pl = r.planos.find((q) => q.lado === lado && q.plano === plano);
  const g = pl && pl.grupos.find((q) => q.grupo === grupo);
  const e = g && g.entradas[entrada];
  if (!e) throw new Error(`nao ha ${lado} plano ${plano} G${grupo} entrada ${entrada}`);
  const c = r.c;
  if (c[e.ini + 16] !== 0) throw new Error('a entrada ja tem uma espera (uma ordem so espera um trigger)');
  const p = pecas(arquivo), fimElev = p.c.length - p.resto.length;
  if (!p.c.equals(c)) throw new Error('as duas leituras da corrente nao batem');
  const rel = (o) => o - fimElev;
  const antes = p.resto.subarray(0, rel(e.ini + 17)), depois = p.resto.subarray(rel(e.ini + 17));
  const novo = Buffer.alloc(5); novo[0] = espera.tipo; novo.writeUInt16LE(espera.i, 1); novo.writeUInt16LE(espera.j, 3);
  const resto = Buffer.concat([antes, novo, depois]);
  resto[rel(e.ini + 16)] = 1;
  resto.writeUInt32LE(r.len + 5, rel(r.ini));
  escrever(arquivo, saida, { resto });
  return { em: e.ini, lenAntes: r.len, lenDepois: r.len + 5 };
}

const EH_MAIN = process.argv[1] && /[\\/]gatilhos\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const f = process.argv[2];
  if (!f) { console.log('uso: node tools/re/gatilhos.mjs "<arquivo.btt>"'); process.exit(1); }
  console.log(descrever(lerGatilhos(f)));
}
