// EXTRAS SINTETIZADOS (secao 98): um registro de unidade a pe e generico fora do par de tipo —
// molde de um time da mesma nacao + par (val, tab) do catalogo + id novo + semente + posicao. Nada
// vem de doador: nenhum `ZZ *.btt`, nenhuma divisao de enfeite para hospedar o time. E o registro
// entra em QUALQUER formacao, no fim dos filhos diretos dela, como o editor faz ao comprar um
// Specialist Team dentro de um pelotao (`ZZ BREACH TEAM`: ids 396-398 no meio do pelotao 220, id =
// maior + 1, sem renumerar o resto).
//
// Layout do registro de time (41 B, medido em 4 Breach/HQ Teams de 3 nacoes):
//   00 00 00 | id u32 | +7 flag | +8 00 | +9 exp/mot | +10 fit/lid/efetivo | +11 efetivo|supr|xxxx
//   | +12 categoria de compra (secao 33) | +13 00 | +14 exercito | +15 estado 0x60 | +16 grupo IA
//   | +17 val | +18 tab | +19 00 | +20..+27 semente (8 B; byte 4 = byte 0 em quase todos)
//   | +28 0x10 | +29 rumo u32 | +33 x f32 | +37 y f32
// Os bits 3-0 de +11 valem 0x1 nos HQ Teams e 0x3 nos dois Breach Teams vistos (US e UKR) — nao
// decodificados; o molde do time copia o valor do proprio tipo quando o catalogo de moldes o tem.
import { abrirCompleto } from './anexar2.mjs';
import { cabecalho } from './lados.mjs';
import { catalogo, indiceDeTokens, contagemDeFilhos, regraDeEnchimento } from './regs.mjs';
import { codificarComoJogo } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';
import { posicaoNoCompleto } from './acrescentar.mjs';
import { pintura, interior } from './zonas.mjs';

const fimDosRegistros = (c, desde) => { for (let i = desde; i < c.length; i++) { if (c[i] !== 0) continue; let z = 0; while (i + z < c.length && c[i + z] === 0) z++; if (z >= 32) return i; i += z; } return c.length; };
// a regra de enchimento vive em regs.mjs (regraDeEnchimento), com o caso core (secao 110.1)
const hx = (v) => '0x' + v.toString(16).padStart(2, '0');

// ARVORE da forca: topos (kAzul primeiros = azul) com filhos aninhados; cada no tem o indice em R e
// o indice do primeiro registro FORA da sua sub-arvore (`fim`).
export function arvore(X) {
  const R = X.R, p = indiceDeTokens(X.d.tokens), cru = X.d.cru;
  const no = (i) => {
    const r = R[i]; const n = r.form ? contagemDeFilhos(cru, p, R, i) : 0; const filhos = []; let k = i + 1;
    for (let q = 0; q < n && k < R.length; q++) { const f = no(k); filhos.push(f); k = f.fim; }
    return { i, r, filhos, n, fim: k };
  };
  const topos = []; let i = 0; while (i < R.length) { const t = no(i); topos.push(t); i = t.fim; }
  const h = cabecalho(X);
  return { topos, azul: topos.slice(0, h.kAzul), vermelho: topos.slice(h.kAzul), h };
}

// Resolve `destino` = { lado, topo?, caminho: ['Company (Rifle)', 'Platoon (Rifle)#2', ...] } ate o no.
// `#n` e a ocorrencia (1-based) entre os filhos de mesmo nome; sem `#`, a primeira.
export function resolverDestino(A, destino) {
  const lista = A[destino.lado]; if (!lista || !lista.length) throw new Error(`lado ${destino.lado} sem formacoes de topo`);
  let no = lista[destino.topo || 0]; if (!no) throw new Error(`lado ${destino.lado}: topo ${destino.topo} nao existe (${lista.length} topos)`);
  for (const passo of destino.caminho || []) {
    const m = /^(.*?)(?:#(\d+))?$/.exec(passo); const nome = m[1], oc = m[2] ? +m[2] : 1;
    const cands = no.filhos.filter((f) => f.r.form && f.r.nm === nome);
    if (cands.length < oc) throw new Error(`"${nome}": ${cands.length} ocorrencia(s) em ${no.r.nm} (id ${no.r.id}), pedi a ${oc}`);
    no = cands[oc - 1];
  }
  if (!no.r.form) throw new Error(`${no.r.nm} (id ${no.r.id}) nao e formacao`);
  return no;
}

// MOLDE: bytes de um registro sem os zeros de cauda, com id/semente/posicao zerados e flags limpos.
export function moldeDoRegistro(X, k) {
  const R = X.R, c = X.completo; const r = R[k];
  let fim = R[k + 1] ? R[k + 1].c : fimDosRegistros(c, r.c); while (fim > r.c && c[fim - 1] === 0) fim--;
  const b = Buffer.from(c.subarray(r.c, fim));
  b.writeUInt32LE(0, 3); b[7] &= ~(0x80 | 0x40 | 0x20 | 0x10); b[16] = 0;
  const p = posicaoNoCompleto(c, r, R[k + 1] ? R[k + 1].c : r.c + 64);
  return { bytes: b, tam: b.length, posicao: p ? p.o - r.c : null, exercito: c[r.c + 14], val: r.val, tab: r.tab, nome: r.nm, categoria: c[r.c + 12] };
}

// SEMENTE de 8 bytes como as do editor: dois grupos de 4 com o mesmo primeiro byte.
export function semente() {
  const s = Buffer.alloc(8); for (let i = 0; i < 8; i++) s[i] = Math.floor(Math.random() * 256); s[4] = s[0]; return s;
}

// SINTETIZA um registro a partir de um molde (de `moldes.molde()` ou `moldeDoRegistro`) — time
// (41 B, posicao em +28) ou veiculo (posicao em +30, cauda de assentos preservada). `ajustes`:
// { val, tab (troca o par de tipo), grupo, categoria (+12), indice (+8), baixo11, atributos:
//   {exp, mot, fit, lid, supr, efetivo} ou hex de 4 bytes (+8..+11), n20 (u16 de +20 dos veiculos) }.
export function sintetizar(molde, ajustes = {}) {
  const offPos = molde.offPos ?? molde.posicao; if (offPos == null) throw new Error(`molde ${molde.nome}: sem posicao (aeronave/drone?) — nao sei sintetizar`);
  const b = Buffer.from(molde.bytes); if (b[offPos] !== 0x10) throw new Error(`molde ${molde.nome}: byte ${b[offPos]} em +${offPos}, esperava 0x10`);
  if (ajustes.val != null) b[17] = ajustes.val; if (ajustes.tab != null) b[18] = ajustes.tab;
  if (ajustes.grupo != null) b[16] = ajustes.grupo;
  if (ajustes.categoria != null) b[12] = ajustes.categoria;
  if (ajustes.indice != null) b[8] = ajustes.indice;
  if (typeof ajustes.atributos === 'string') Buffer.from(ajustes.atributos, 'hex').copy(b, 8);
  if (ajustes.n20 != null && offPos === 30) b.writeUInt16LE(ajustes.n20, 20);
  if (ajustes.baixo11 != null) b[11] = (b[11] & 0xf0) | (ajustes.baixo11 & 0x0f);
  const a = typeof ajustes.atributos === 'object' && ajustes.atributos ? ajustes.atributos : {};
  if (a.exp != null) b[9] = (b[9] & 0x1f) | (a.exp << 5);
  if (a.mot != null) b[9] = (b[9] & 0xe3) | (a.mot << 2);
  if (a.fit != null) b[10] = (b[10] & 0x1f) | (a.fit << 5);
  if (a.lid != null) b[10] = (b[10] & 0xe3) | (a.lid << 2);
  if (a.supr != null) b[11] = (b[11] & 0x8f) | (a.supr << 4);
  if (a.efetivo != null) { b[10] = (b[10] & 0xfc) | (a.efetivo >> 1); b[11] = (b[11] & 0x7f) | ((a.efetivo & 1) << 7); }
  semente().copy(b, offPos - 8);
  b.writeUInt32LE(0, offPos + 1); b.writeFloatLE(0, offPos + 5); b.writeFloatLE(0, offPos + 9);
  const nome = catalogo().tabelas[hx(b[18])]?.[hx(b[17])] || null;
  return { bytes: b, nome, val: b[17], tab: b[18], offPos };
}

// PARES `(val, tab)` de um nome no catalogo. Um mesmo nome existe em varias tabelas — "Breach Team"
// e (0x62,0x0e), (0x68,0x0e) e (0x6a,0x0e) —, e as tabelas se dividem por lado (nota
// `_tabelas_por_lado`): 0x0d/0x05/0x19 sao azuis (US/UKR), 0x07/0x00/0x0b vermelhas (RU), 0x04 e
// 0x0e sao compartilhadas. Quem desempata de verdade e o banco de moldes, que sabe a nacao.
export function paresDoNome(nome) {
  const cat = catalogo(); const out = [];
  for (const [tab, T] of Object.entries(cat.tabelas)) for (const [val, nm] of Object.entries(T))
    if (nm === nome && /^0x/.test(val)) out.push([parseInt(val, 16), parseInt(tab, 16)]);
  return out;
}

const EXERCITO = { 1: 'US', 2: 'RU', 3: 'UKR' };

// SINTETIZA um extra pelo NOME do catalogo, para entrar na formacao `no` de `X`:
//   1. se ha molde da mesma nacao para esse nome, usa (traz a cauda certa dos veiculos);
//   2. senao, usa o molde de time do proprio destino e so troca o par — foi assim que o Breach Team
//      americano (par 0x62, que nao existe na LIB) entrou no pelotao mecanizado (T1).
// `par: [val, tab]` na spec resolve o caso de nome ambiguo sem molde.
export async function sintetizarPorNome(X, no, nome, ajustes = {}) {
  // O time de 41 B do destino e o molde do caminho 2 — mas para o caminho 1 ele so precisa dizer a
  // NACAO e a CATEGORIA de compra, e isso qualquer registro de unidade do destino diz. Um pelotao
  // de tanques nao tem time nenhum, e antes disso um MT-LB sintetizado nele morria aqui sem
  // precisar (E51).
  let doDestino = null, semTime = null;
  try { doDestino = moldeNoDestino(X, no); } catch (e) { semTime = e; }
  const ref = doDestino || qualquerUnidadeDe(X, no);
  if (!ref) throw semTime;
  const nacao = EXERCITO[ref.exercito >> 4] || null;
  // O AVULSO (17/10): um attached vehicle e o Single Vehicle do editor, nao o veiculo da formacao — o molde vem do
  // gabarito (moldes_avulsos.mjs) quando ha um; sem ele, o molde da LIB, e a fonte diz.
  if (ajustes.avulso) {
    const { moldeAvulso } = await import('./moldes_avulsos.mjs');
    const ma = moldeAvulso(nome, nacao);
    if (ma) return { ...sintetizar(ma, { categoria: ref.categoria, ...ajustes }), fonte: `molde avulso (gabarito do editor, ${ma.n}x)` };
  }
  const { molde } = await import('./moldes.mjs');
  const m = molde(nome, nacao);
  if (m) return { ...sintetizar(m, { categoria: ref.categoria, ...ajustes }), fonte: `molde ${nacao} (${m.n}x na LIB)${ajustes.avulso ? ' — SEM molde avulso: e o veiculo da formacao' : ''}` };
  if (!doDestino) throw semTime;
  const pares = ajustes.par ? [ajustes.par] : paresDoNome(nome);
  if (pares.length !== 1) throw new Error(`"${nome}": ${pares.length ? 'ambiguo, ' + pares.length + ' pares no catalogo e nenhum molde ' + nacao + ' — informe par: [val, tab]' : 'nao esta no catalogo'}`);
  const [val, tab] = pares[0];
  return { ...sintetizar(doDestino, { val, tab, ...ajustes }), fonte: `molde do destino + par (${hx(val)},${hx(tab)})` };
}

// Forma antiga: molde de time + par do catalogo.
export function sintetizarTime(molde, val, tab, ajustes = {}) {
  if (molde.tam !== 41 || (molde.offPos ?? molde.posicao) !== 28) throw new Error(`molde ${molde.nome}: ${molde.tam} B, posicao em +${molde.offPos ?? molde.posicao} — esperava time de 41 B com posicao em +28`);
  return sintetizar(molde, { ...ajustes, val, tab });
}

// Um time da mesma nacao dentro da propria batalha serve de molde (o HQ Team do destino, de
// preferencia): garante exercito, categoria de compra e atributos "tipicos" daquela formacao.
export function moldeNoDestino(X, no) {
  const R = X.R; const cands = [];
  const colher = (n) => { for (const f of n.filhos) { if (!f.r.form) cands.push(f.i); else colher(f); } };
  colher(no);
  for (const k of cands) { const m = moldeDoRegistro(X, k); if (m.tam === 41 && m.posicao === 28) return { ...m, offPos: m.posicao }; }
  throw new Error(`${no.r.nm} (id ${no.r.id}): nenhum time de 41 B para servir de molde`);
}

// Qualquer unidade do destino — a primeira que houver, time ou veiculo —, so pelo exercito e pela
// categoria de compra dela. Null se a formacao nao tem unidade nenhuma.
export function qualquerUnidadeDe(X, no) {
  let k = null;
  const colher = (n) => { for (const f of n.filhos) { if (k !== null) return; if (!f.r.form) k = f.i; else colher(f); } };
  colher(no);
  return k === null ? null : moldeDoRegistro(X, k);
}

// Tile do meio do interior da zona de setup do lado (em metros, como posicionarIds).
export function posicaoNaZona(arquivo, lado, fracao = 0.5) {
  const z = pintura(arquivo); const tiles = interior((z[lado] || []).flatMap((l) => l.tiles));
  const todos = [...new Set(tiles.map(([x, y]) => x + ',' + y))].map((s) => s.split(',').map(Number));
  // Os tiles pares sao a preferencia (o editor os usa); uma zona estreita pode nao ter nenhum com
  // as duas coordenadas pares — o Village-Forest 057r nao tem —, e ai qualquer tile do interior
  // serve, porque a posicao aqui e so um lugar valido para o registro nascer.
  let ord = todos.filter(([x, y]) => x % 2 === 0 && y % 2 === 0).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (!ord.length) ord = todos.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (!ord.length) throw new Error(`lado ${lado}: zona de setup sem tiles`);
  const [tx, ty] = ord[Math.min(ord.length - 1, Math.floor(fracao * ord.length))]; return { x: 8 * tx + 4, y: 8 * ty + 4, tiles: ord.length };
}

// INSERE `carga` (registro sem zeros de cauda, com os 3 zeros de cabeca) como ULTIMO filho direto
// da formacao `destino`. Id = maior + 1 (como o editor), contador de filhos do destino +1, N +1,
// A + custo; enchimento pela regra do ultimo byte dos dois lados da juncao. A posicao e escrita
// ANTES de medir o enchimento: um time com x = y = 0 termina em zero e a regra daria 9 em vez dos
// 13 que o byte alto do float de Y pede (foi o primeiro T1, com 4 zeros a menos).
// `posicao`: { x, y } em metros; ausente = meio do interior da zona de setup do lado.
export function inserirRegistro(alvo, carga, destino, saida, { custo = 51, posicao = null, offPosicao = 28 } = {}) {
  const X = abrirCompleto(alvo); const c0 = X.completo, R = X.R; const A = arvore(X);
  const no = resolverDestino(A, destino);
  if (!no.filhos.length) throw new Error(`${no.r.nm} (id ${no.r.id}) nao tem filhos: o contador mora no primeiro filho e aqui nao ha onde por`);
  const novoId = Math.max(...R.map((r) => r.id)) + 1;
  const reg = Buffer.from(carga); reg.writeUInt32LE(novoId, 3);
  if (offPosicao != null) { if (reg[offPosicao] !== 0x10) throw new Error(`carga sem 0x10 em +${offPosicao}: nao sei onde fica a posicao`);
    const p = posicao || posicaoNaZona(alvo, destino.lado); reg.writeFloatLE(p.x, offPosicao + 5); reg.writeFloatLE(p.y, offPosicao + 9); posicao = p; }
  // ponto de insercao: inicio do primeiro registro FORA da sub-arvore do destino. Na fronteira
  // azul/vermelho o bloco azul termina com a regra INTEIRA de zeros e depois o K_verm (cujos 3
  // bytes altos sao os zeros de cabeca do 1o vermelho): entra-se 3 bytes antes do K_verm.
  const prox = R[no.fim] || null; const primVerm = A.vermelho.length ? R[A.vermelho[0].i] : null;
  // (`inicio` em cada chamada: a regra precisa saber se o registro que termina ali e curto — E52)
  const regraCarga = regraDeEnchimento(reg, reg.length, 0);
  let corte, antes = 0, depois;
  if (!prox) { corte = fimDosRegistros(c0, R[R.length - 1].c); antes = regraDeEnchimento(c0, corte, R[R.length - 1].c) - 3; depois = 0; }
  else if (primVerm && prox.c === primVerm.c) { corte = prox.c - 1 - 3; depois = regraCarga - 3; }
  else { corte = prox.c; depois = regraCarga - 3; }
  if (prox) { let z = 0; while (c0[corte - 1 - z] === 0) z++; const ult = c0[corte - 1 - z]; const esperado = regraDeEnchimento(c0, corte - z, R[no.fim - 1]?.c ?? null) - 3;
    if (z !== esperado) throw new Error(`juncao antes do corte: ${z} zeros depois de ${hx(ult)}, a regra pede ${esperado}`); }
  const c = Buffer.concat([c0.subarray(0, corte), Buffer.alloc(antes), reg, Buffer.alloc(depois), c0.subarray(corte)]);
  // contador do destino (u32 em c-1 do primeiro filho), N e A do cabecalho
  const pc = R[no.i + 1].c - 1; const n0 = c.readUInt32LE(pc); if (n0 !== no.n) throw new Error(`contador de ${no.r.nm}: ${n0} no completo, ${no.n} na arvore`);
  c.writeUInt32LE(n0 + 1, pc);
  c.writeUInt32LE(c.readUInt32LE(X.m + 9) + 1, X.m + 9); c.writeUInt32LE(c.readUInt32LE(X.m + 5) + custo, X.m + 5);
  reconstruir(alvo, saida, (x, i) => (i === 1 ? codificarComoJogo(c, X.d.esc) : x));
  const V = abrirCompleto(saida); if (V.R.length !== R.length + 1) throw new Error(`gravado com ${V.R.length} registros, esperava ${R.length + 1}`);
  const nv = arvore(V); const noV = resolverDestino(nv, destino); const ultimo = noV.filhos[noV.filhos.length - 1];
  if (ultimo.r.id !== novoId) throw new Error(`o ultimo filho de ${noV.r.nm} e ${ultimo.r.id}, esperava ${novoId}`);
  return { id: novoId, destino: `${no.r.nm} (id ${no.r.id})`, filhos: n0 + 1, registros: V.R.length, corte, posicao };
}

// VERIFICACAO obrigatoria antes de todo LOAD: arvore fecha, ids unicos, contadores = filhos diretos,
// sem nome embutido, posicao legivel nos ativos, enchimento pela regra em toda juncao, N e A.
export function verificarForca(caminho) {
  const X = abrirCompleto(caminho); const c = X.completo, R = X.R; const A = arvore(X); const erros = [], avisos = [];
  // O CABECALHO TEM DE ESTAR ONDE SE PENSA (E70): largura fixa, terminando no id do primeiro
  // registro — 14 bytes no azul-primeiro, 18 no vermelho-primeiro. Quando o marcador erra, tudo o
  // que vem daqui (A, N, K_azul, a divisao azul/vermelho) sai de outro lugar, e o sintoma aparece
  // longe: em 17/09 apareceu como enchimento errado num Ural que estava perfeito. Melhor acusar a
  // causa do que o sintoma.
  if (R.length) {
    const dif = R[0].c - X.m;
    if (dif !== 14 && dif !== 18) erros.push(`cabecalho fora de lugar: o primeiro registro comeca ${dif} bytes depois do marcador, e a largura fixa pede 14 (azul-primeiro) ou 18 (vermelho-primeiro)`);
  }
  const h = A.h; const kVerm = A.vermelho.length ? c.readUInt32LE(R[A.vermelho[0].i].c - 1) : 0;
  if (A.vermelho.length && kVerm !== A.vermelho.length) erros.push(`K_verm ${kVerm} != ${A.vermelho.length} topos vermelhos`);
  const ids = R.map((r) => r.id); if (new Set(ids).size !== ids.length) erros.push('ids repetidos');
  let cobertos = 0; for (const t of A.topos) cobertos += t.fim - t.i; if (cobertos !== R.length) erros.push(`arvore cobre ${cobertos} de ${R.length} registros`);
  const andar = (n) => { if (n.r.form && n.filhos.length !== n.n) erros.push(`${n.r.nm} (id ${n.r.id}): contador ${n.n}, ${n.filhos.length} filhos lidos`); n.filhos.forEach(andar); };
  A.topos.forEach(andar);
  const primVerm = A.vermelho.length ? R[A.vermelho[0].i] : null;
  R.forEach((r, k) => {
    if (c[r.c + 7] & 0x10) erros.push(`id ${r.id} ${r.nm}: nome embutido (bit 0x10)`);
    if (!r.nm) avisos.push(`id ${r.id}: tipo (${hx(r.val)},${hx(r.tab)}) fora do catalogo`);
    const prox = R[k + 1]; if (!prox) return;
    if (r.form) return;                                                  // formacao -> primeiro filho: os 3 zeros sao o contador
    // fronteira azul/vermelho: o bloco azul termina com a regra inteira e so entao vem o K_verm
    const fronteira = primVerm && prox.c === primVerm.c; const limite = fronteira ? prox.c - 1 : prox.c;
    let z = 0; while (limite - 1 - z > r.c && c[limite - 1 - z] === 0) z++; const ult = c[limite - 1 - z]; const total = fronteira ? z : z + 3; const regra = regraDeEnchimento(c, limite - z, r.c);
    if (total !== regra) erros.push(`id ${r.id} ${r.nm}: ${total} zeros ate o id seguinte, regra pede ${regra} (ultimo byte ${hx(ult)})`);
    if (!r.ausente) { const p = posicaoNoCompleto(c, r, prox.c); if (!p) avisos.push(`id ${r.id} ${r.nm}: posicao nao legivel`); }
  });
  const unidades = R.filter((r) => !r.form).length, aeronaves = R.filter((r) => !r.form && c[r.c + 12] === 0x58).length;
  if (h.N !== unidades && h.N !== unidades - aeronaves) avisos.push(`N=${h.N}, unidades ${unidades} (${aeronaves} aeronaves)`);
  return { ok: !erros.length, erros, avisos, registros: R.length, topos: A.topos.length, kAzul: h.kAzul, kVerm, N: h.N, A: h.A };
}

const EH_MAIN = process.argv[1] && /[\\/]extras\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'verificar') { const v = verificarForca(args[0]); console.log(JSON.stringify(v, null, 1)); process.exit(v.ok ? 0 : 1); }
  else if (cmd === 'arvore') { const X = abrirCompleto(args[0]); const A = arvore(X); const pr = (n, d) => { console.log(`${'  '.repeat(d)}${n.r.form ? 'F' : 'u'} id=${n.r.id} ${n.r.nm}${n.r.ausente ? ' [AUS]' : ''}${n.n ? ' filhos=' + n.n : ''}`); n.filhos.forEach((f) => pr(f, d + 1)); }; A.azul.forEach((t) => { console.log('AZUL'); pr(t, 1); }); A.vermelho.forEach((t) => { console.log('VERMELHO'); pr(t, 1); }); }
  else console.log('uso: node extras.mjs verificar <a.btt> | arvore <a.btt>');
}
