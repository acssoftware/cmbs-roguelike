// OS BLOCOS DE EQUIPAMENTO DO EDITOR — a escolha de veiculo e de arma por formacao (FORMATO 43.2,
// 44.2 e 124; E95/E96).
//
// Na tela Units, selecionada uma formacao, o pe da tela mostra blocos encadeados — categoria,
// familia, modelo, variante — e clicar num modelo troca todas as unidades daquele tipo de uma vez.
// A secao 41 achou onde isso mora: o par de tipo (+17/+18), a raridade (+14) e "dois u16 no fim do
// registro". A leitura de 23/09 fechou o que os dois u16 sao: o FIM de uma lista de comprimento
// variavel que e o CAMINHO dos blocos, um u16 por nivel, e ela ja estava decodificada em
// `core.fimDoConteudo` sem ninguem a nomear:
//
//     [u8 n = niveis] [u16 e1] [u16 e2] ... [u16 en]      cada e_i com byte alto 0x02
//
//     T-90A            03 | 624 | 625 | 744          BMP-2M     02 | 615 | 617
//     T-72B3           03 | 624 | 627 | 746          BMP-3      03 | 615 | 616 | 747
//     M107A1           01 | 639                      BTR-4E     02 | 666 | 668
//     Precision Sniper 02 | 639 | 660                BTR-70     02 | 666 | 667
//
// O GRUPO e a primeira entrada (T-72 e T-90 partilham 624; e o que o editor oferece junto). O
// "familia 256" da tabela antiga (`equipamento.json`) era artefato: lida de tras para a frente, uma
// lista de UMA entrada devolve `256 + 0` no lugar da "familia". E o TAMANHO DO REGISTRO e a base da
// forma mais 2 bytes por entrada: a secao 44 viu que "trocar para um tipo de registro maior derruba
// o jogo" — o registro maior era so a lista mais longa. Redimensionar e reescrever a lista.
//
// Este modulo le no buffer EXPANDIDO (`abrirCompleto`, offsets `r.c`), onde o tamanho e estavel;
// o `equipamento.mjs` (secao 41) media no cru, onde o enchimento tokenizado varia com o vizinho.
// O que vem da tela sao os NOMES (FORMATO 41.1, E96): o editor desenha uma coluna por nivel e os
// rotulos nao estao em lugar nenhum do arquivo. Eles moram em `research/blocos_rotulos.json` —
// `grupos` manda no rotulo do grupo, `entradas` nomeia uma entrada de nivel >= 2 (vira `variante`
// da opcao) e `tela` nomeia um TIPO que o catalogo nao distingue (vira `rotuloTela`, so para
// mostrar: preco, molde de roster e refit continuam saindo do `nome` de verdade).
//
//   node tools/re/blocos.mjs ver <arquivo.btt> [id da formacao]
//   node tools/re/blocos.mjs minerar [--gravar]              -> research/blocos.json
//   node tools/re/blocos.mjs variantes [--gravar]            -> research/biblioteca_variantes.json
//   node tools/re/blocos.mjs trocar <in> <out> <id> <grupo> <0xTAB,0xVAL>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirCompleto } from './anexar2.mjs';
import { fimDoConteudo } from './core.mjs';
import { arvore, verificarForca } from './extras.mjs';
import { regraDeEnchimento, catalogo } from './regs.mjs';
import { codificarComoJogo } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';

const G = (process.env.CMBS_GAME_FILES || 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files').replace(/[\\/]*$/, '') + '/';
const LIB = fileURLToPath(new URL('../../assets/lib/', import.meta.url));
const PESQUISA = fileURLToPath(new URL('../../research/', import.meta.url));
const TABELA = path.join(PESQUISA, 'blocos.json');
const ROTULOS = path.join(PESQUISA, 'blocos_rotulos.json');
const VARIANTES = path.join(PESQUISA, 'biblioteca_variantes.json');

const hx = (v) => '0x' + v.toString(16).padStart(2, '0');
// a mesma chave do `equipamento.json` e do `tipos_confirmados.json`: TABELA primeiro, indice depois
export const chaveDoTipo = (val, tab) => `${hx(tab)},${hx(val)}`;
export const tipoDaChave = (s) => { const m = /^0x([0-9a-f]{2}),0x([0-9a-f]{2})$/i.exec(String(s).trim()); if (!m) throw new Error(`tipo "${s}" nao e 0xTAB,0xVAL`); return { tab: parseInt(m[1], 16), val: parseInt(m[2], 16) }; };
export const EXERCITO = { 1: 'US', 2: 'RU', 3: 'UKR' };
export const nomeDoTipo = (val, tab) => catalogo().tabelas[hx(tab)]?.[hx(val)] || null;

// A lista de um registro: onde comeca (`p`, o u8 n), quantas entradas e quais. `fim` e o fim do
// conteudo (exclusivo) e `tam` o tamanho do conteudo, que e `p - r.c + 1 + 2n`.
export function listaDeTipos(c, r, fimRegistro) {
  const i = fimDoConteudo(c, r, fimRegistro);
  if (i.lista == null) return { fim: i.fim, kind: i.kind, core: i.core, p: null, n: 0, entradas: [] };
  const n = c[i.lista]; const entradas = [];
  for (let k = 0; k < n; k++) entradas.push(c.readUInt16LE(i.lista + 1 + 2 * k));
  if (i.lista + 1 + 2 * n !== i.fim) throw new Error(`lista de ${r.nm} (id ${r.id}): n=${n} em +${i.lista - r.c} nao fecha no fim do conteudo (+${i.fim - r.c})`);
  return { fim: i.fim, kind: i.kind, core: i.core, p: i.lista, n, entradas };
}

// Todo registro do arquivo com a sua lista. `fimRegistro` e o inicio do seguinte, menos um na
// fronteira azul/vermelho (o K_verm), como em `core.marcarCore`.
export function registrosDe(X) {
  const c = X.completo, R = X.R; const A = arvore(X);
  const primVerm = A.vermelho.length ? R[A.vermelho[0].i] : null;
  return R.map((r, k) => {
    const prox = R[k + 1];
    const fronteira = !!(primVerm && prox && prox.c === primVerm.c);
    const fimRegistro = prox ? (fronteira ? prox.c - 1 : prox.c) : c.length;
    const base = {
      k, id: r.id, form: !!r.form, val: r.val, tab: r.tab, tipo: chaveDoTipo(r.val, r.tab), nome: r.nm,
      exercito: EXERCITO[c[r.c + 14] >> 4] || null, raridade: c[r.c + 14] & 0x0f, ausente: !!(c[r.c + 7] & 0x80),
      comNome: !!(c[r.c + 7] & 0x10), fronteira,
    };
    try {
      const L = listaDeTipos(c, r, fimRegistro);
      return { ...base, kind: L.kind, core: L.core, p: L.p, n: L.n, lista: L.entradas, fim: L.fim, tam: L.fim - r.c };
    } catch (e) { return { ...base, kind: null, core: null, p: null, n: 0, lista: [], fim: null, tam: null, erro: e.message }; }
  });
}
export const grupoDe = (reg) => (reg && reg.n ? reg.lista[0] : null);
// QUEM TEM ESCOLHA (E96, FORMATO 41.1). Tres formas de registro carregam lista, e a tela do editor
// desenha um bloco para cada uma:
//   - time / veiculo: a unidade posicionada, o caso comum (o tanque, o BMP, o esquadrao);
//   - sem-posicao: o tubo do morteiro e o obus ORGANICOS do batalhao, que nao tem posicao no mapa
//     (`603/657` = 2S24 82mm, `718` = os seis obuses russos). O `nomeDoTipo` erra o nome de alguns
//     (o 2S24 sai como "BMP-3M": o par tipo+caminho e que identifica, nao o tipo sozinho), e por
//     isso a chave da opcao leva o caminho quando dois tipos se repetem no grupo.
//   - formacao: `Platoon (Assault)` Standard/Antitank e afins. FICA DE FORA: trocar o tipo da
//     formacao muda a arvore inteira embaixo dela, e isso nao se faz reescrevendo um registro.
// A off-map comprada avulsa (a bateria de obus da biblioteca, `+12 = 0x50`) nao tem lista nenhuma:
// ali a escolha de canhao e outro arquivo (124, `catalog.gunTwins`).
export const comEscolha = (reg) => reg.n > 0 && !reg.form && /^(time|veiculo|sem-posicao)/.test(reg.kind || '');

// A composicao de uma formacao (qualquer nivel), por grupo: o que ha de cada tipo e com que lista.
function composicaoPorGrupo(regs, no) {
  const grupos = {};
  for (let k = no.i + 1; k < no.fim; k++) {
    const reg = regs[k]; if (!comEscolha(reg)) continue;
    // chave interna com o caminho: no grupo 603 o mesmo tipo e dois morteiros diferentes
    const g = grupoDe(reg); const chave = `${reg.tipo}@${reg.lista.join('/')}`;
    const G = (grupos[g] = grupos[g] || {});
    if (!G[chave]) G[chave] = { tipo: reg.tipo, val: reg.val, tab: reg.tab, nome: reg.nome, n: 0, lista: reg.lista, raridade: reg.raridade, tam: reg.tam, kind: reg.kind.replace(/\+.*$/, '') };
    G[chave].n++;
  }
  return Object.fromEntries(Object.entries(grupos).map(([g, t]) => [g, Object.values(t)]));
}

// O arquivo inteiro: registros com lista e, por formacao (todas, em todos os niveis), a composicao
// por grupo. `formacoes` e um Map id -> { id, nome, tipo, i, fim, filhos, grupos }.
export function lerBlocos(arquivo) {
  const X = abrirCompleto(arquivo); const regs = registrosDe(X); const A = arvore(X);
  const formacoes = new Map();
  const andar = (no, nivel) => {
    if (!no.r.form) return;
    formacoes.set(no.r.id, { id: no.r.id, nome: no.r.nm, tipo: chaveDoTipo(no.r.val, no.r.tab), nivel, i: no.i, fim: no.fim, filhos: no.filhos.filter((f) => f.r.form).map((f) => f.r.id), grupos: composicaoPorGrupo(regs, no) });
    no.filhos.forEach((f) => andar(f, nivel + 1));
  };
  A.topos.forEach((t) => andar(t, 0));
  return { X, A, registros: regs, formacoes, topos: A.topos.map((t) => t.r.id) };
}

// ---------------------------------------------------------------------------- a tabela

// De onde se mina. A biblioteca sempre; os templates do gerador e os "ALL" (a ordem de batalha
// inteira de cada exercito, secao 42) quando a pasta do jogo esta aqui — sao eles que trazem o que a
// biblioteca nunca comprou (T-90A, BM Bulat, BMP-3M Shtora/ERA, BRM-3K...).
export function corpora() {
  const out = [];
  const junta = (dir, fonte, filtro = () => true) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) if (/\.btt$/i.test(f) && filtro(f)) out.push({ arquivo: path.join(dir, f), fonte });
  };
  junta(LIB, 'lib');
  junta(G + 'GENERATOR_TEMPLATES/ASSAULT', 'templates');
  junta(G + 'GENERATOR_TEMPLATES', 'templates');
  junta(G + 'Scenarios', 'all', (f) => /^AA (RU|UKR|US) ALL\.btt$/.test(f));
  return out;
}

// Rotulo de um grupo: o que os nomes tem em comum antes do parentese ("Main Battle Tank"); quando
// nem isso, as palavras iniciais comuns. A E96 le os rotulos de verdade na tela e os poe em
// `research/blocos_rotulos.json`, que manda quando existe.
function rotuloDe(nomes) {
  const radicais = [...new Set(nomes.map((n) => String(n || '').replace(/\s*\(.*$/, '').trim()).filter(Boolean))];
  if (radicais.length === 1) return radicais[0];
  const palavras = radicais.map((r) => r.split(/\s+/)); const comum = [];
  for (let i = 0; ; i++) { const w = palavras[0][i]; if (!w || !palavras.every((p) => p[i] === w)) break; comum.push(w); }
  return comum.join(' ') || radicais.join(' / ');
}
const moda = (cont) => Object.entries(cont).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];

export function minerar(fontes = corpora()) {
  const acc = new Map();          // exercito|grupo|tipo -> acumulador
  const lidos = []; const erros = [];
  for (const { arquivo, fonte } of fontes) {
    let B; try { B = lerBlocos(arquivo); } catch (e) { erros.push(`${path.basename(arquivo)}: ${e.message}`); continue; }
    lidos.push({ arquivo: path.basename(arquivo), fonte, registros: B.registros.length });
    for (const reg of B.registros) {
      if (!comEscolha(reg) || !reg.exercito || !reg.nome) continue;
      // O CAMINHO entra na chave: no grupo 603 o mesmo tipo (0x00,0x3a) e dois morteiros
      // diferentes, um em `603/656` e outro em `603/657` — sem isso um apagaria o outro (ou os
      // dois cairiam em `ambiguos`). Entre as unidades posicionadas nao ha nenhum caso assim.
      const k = `${reg.exercito}|${grupoDe(reg)}|${reg.tipo}|${reg.lista.join('/')}`;
      const a = acc.get(k) || { exercito: reg.exercito, grupo: grupoDe(reg), tipo: reg.tipo, val: reg.val, tab: reg.tab, nome: reg.nome, listas: {}, raridades: {}, tams: {}, kinds: {}, amostras: 0, fontes: new Set(), arquivos: new Set() };
      const L = reg.lista.join('/');
      a.listas[L] = (a.listas[L] || 0) + 1; a.raridades[reg.raridade] = (a.raridades[reg.raridade] || 0) + 1;
      a.tams[reg.tam] = (a.tams[reg.tam] || 0) + 1; a.kinds[reg.kind.replace(/\+.*$/, '')] = (a.kinds[reg.kind.replace(/\+.*$/, '')] || 0) + 1;
      a.amostras++; a.fontes.add(fonte); a.arquivos.add(path.basename(arquivo));
      acc.set(k, a);
    }
  }
  const rotulos = fs.existsSync(ROTULOS) ? JSON.parse(fs.readFileSync(ROTULOS, 'utf8')) : {};
  const exercitos = {}; const ambiguos = [];
  for (const a of acc.values()) {
    const listas = Object.keys(a.listas);
    if (listas.length > 1) { ambiguos.push({ exercito: a.exercito, grupo: a.grupo, tipo: a.tipo, nome: a.nome, listas: a.listas, arquivos: [...a.arquivos] }); continue; }
    const lista = listas[0].split('/').map(Number); const tam = Number(moda(a.tams)); const kind = moda(a.kinds);
    const base = tam - 1 - 2 * lista.length;
    const E = (exercitos[a.exercito] = exercitos[a.exercito] || { grupos: {} });
    const Gp = (E.grupos[a.grupo] = E.grupos[a.grupo] || { rotulo: null, opcoes: {}, _ops: [] });
    // `variante` = o caminho depois do grupo, com os nomes que a tela deu as entradas (E96); e o que
    // separa duas opcoes de mesmo nome (as quatro Squad (Rifle) do US sao M25 CDTE ou M320 GL).
    const variante = lista.slice(1).map((e) => rotulos.entradas?.[`${a.exercito}|${e}`]).filter(Boolean).join(' > ');
    const porCaminho = rotulos.caminhos?.[`${a.exercito}|${lista.join('/')}`];
    // NOME DUVIDOSO: no registro sem-posicao o nome do tipo as vezes nao e da unidade (o tubo 2S24
    // sai como "BMP-3M"). Sem rotulo de tela e sem cara de arma off-map, a opcao fica marcada e
    // quem mostra nao a oferece — um nome errado aqui viraria preco errado.
    const armaOffMap = /(\d+ x |Mortar|Howitzer|Gun|Rocket|Missile)/i.test(a.nome);
    const duvidoso = kind === 'sem-posicao' && !porCaminho && !armaOffMap;
    Gp._ops.push({
      tipo: a.tipo, val: a.val, tab: a.tab, nome: porCaminho || rotulos.tipos?.[`${a.exercito}|${a.tipo}`] || a.nome, lista, niveis: lista.length,
      raridade: Number(moda(a.raridades)), tam, base, kind, amostras: a.amostras, fontes: [...a.fontes].sort(),
      ...(variante ? { variante } : {}),
      ...(duvidoso ? { duvidoso: true } : {}),
      ...(rotulos.tela?.[`${a.exercito}|${a.tipo}`] ? { rotuloTela: rotulos.tela[`${a.exercito}|${a.tipo}`] } : {}),
      ...(Object.keys(a.tams).length > 1 ? { tamanhos: a.tams } : {}),
    });
  }
  for (const [ex, E] of Object.entries(exercitos)) {
    for (const [g, Gp] of Object.entries(E.grupos)) {
      const ops = Gp._ops; delete Gp._ops;
      Gp.rotulo = rotulos.grupos?.[`${ex}|${g}`] || rotuloDe(ops.map((o) => o.nome));
      Gp.niveis = Math.max(...ops.map((o) => o.niveis));
      // A CHAVE da opcao e o tipo, e so leva o caminho junto quando o tipo se repete no grupo (o
      // 0x00,0x3a do 603, que e dois morteiros). Quem troca usa a chave; quem so mostra, o nome.
      const vezes = {}; ops.forEach((o) => { vezes[o.tipo] = (vezes[o.tipo] || 0) + 1; });
      ops.forEach((o) => { o.chave = vezes[o.tipo] > 1 ? `${o.tipo}@${o.lista.join('/')}` : o.tipo; });
      // ordem estavel: pela lista (o caminho dos blocos) e depois pelo nome
      Gp.opcoes = Object.fromEntries(ops.sort((x, y) => x.lista.join('/').localeCompare(y.lista.join('/')) || x.nome.localeCompare(y.nome)).map((o) => [o.chave, o]));
    }
  }
  const tabela = {
    nota: 'O caminho dos blocos de equipamento do editor, por exercito e por GRUPO (a primeira entrada da lista de tipos no fim do registro da unidade, FORMATO 43.2). Cada opcao e um tipo (0xTAB,0xVAL) com a lista inteira, a raridade que o editor grava com ele e o tamanho do conteudo do registro (base + 1 + 2 x niveis). So unidades POSICIONADAS (time/veiculo) entram: a mesma tela oferece tambem grupos que moram num registro de formacao (Assault Platoon: Standard/Antitank) ou num sem-posicao (morteiros e obuses off-map, FORMATO 41.1), e esses ainda nao estao aqui. `rotulo`, `variante` e `rotuloTela` vem de blocos_rotulos.json (lidos na tela, E96). Refazer com `node tools/re/blocos.mjs minerar --gravar`.',
    gerado: new Date().toISOString().slice(0, 10), fontes: lidos.length, exercitos,
    ambiguos: ambiguos.length ? ambiguos : undefined,
  };
  return { tabela, lidos, erros, ambiguos, opcoes: acc.size - ambiguos.length };
}
let TAB = null;
export function tabela() { if (!TAB) TAB = JSON.parse(fs.readFileSync(TABELA, 'utf8')); return TAB; }

// ------------------------------------------------------------------- as variantes da biblioteca

// `[RU C2 02]`, `[UKR C3 14]`: o app os escondia como "duplicatas de raridade". Comparados com a base
// (o mesmo nome sem o sufixo), 38 dos 49 sao outra coisa: outro equipamento (BMP-3 no lugar do
// BMP-2M, T-72B3 no lugar do T-90AM), outra TO&E (mais caminhoes, morteiros) ou, na artilharia
// off-map, outro TIPO DE FORMACAO. Servem de gabarito para a troca (o editor ja gravou o
// redimensionamento BMP-2M -> BMP-3 no `[RU C6 02]`) e, na artilharia, de mecanismo.
const SUFIXO = / \[(US|RU|UKR) C\d+ \d+\]\.btt$/;
export function variantesDaBiblioteca(dir = LIB) {
  const composicao = (B) => {
    const m = new Map();
    for (const reg of B.registros) { if (reg.form) continue; const k = `${reg.tipo}|${reg.lista.join('/')}|${reg.tam}`; const e = m.get(k) || { tipo: reg.tipo, nome: reg.nome, lista: reg.lista, tam: reg.tam, kind: reg.kind, n: 0 }; e.n++; m.set(k, e); }
    return m;
  };
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => SUFIXO.test(x)).sort()) {
    const base = f.replace(SUFIXO, '.btt');
    if (!fs.existsSync(path.join(dir, base))) { out.push({ arquivo: f, base, classe: 'sem-base' }); continue; }
    const V = lerBlocos(path.join(dir, f)), Bs = lerBlocos(path.join(dir, base));
    const topo = (B) => { const t = B.formacoes.get(B.topos[0]); return { id: t.id, tipo: t.tipo, nome: t.nome }; };
    const cv = composicao(V), cb = composicao(Bs); const diferencas = [];
    for (const k of new Set([...cv.keys(), ...cb.keys()])) {
      const a = cb.get(k), b = cv.get(k); if ((a?.n || 0) === (b?.n || 0)) continue;
      const e = a || b; diferencas.push({ tipo: e.tipo, nome: e.nome, lista: e.lista, tam: e.tam, de: a?.n || 0, para: b?.n || 0 });
    }
    const tb = topo(Bs), tv = topo(V);
    const classe = tb.tipo !== tv.tipo ? 'formacao-tipo' : diferencas.length ? 'composicao' : 'igual';
    out.push({ arquivo: f, base, classe, topo: { de: tb, para: tv }, registros: { de: Bs.registros.length, para: V.registros.length }, diferencas });
  }
  return out;
}

// ---------------------------------------------------------------------------- a troca

// Onde a lista de um tipo-alvo vem: primeiro de um DOADOR do proprio arquivo (uma unidade daquele
// tipo, no mesmo grupo — resolve de graca o par que varia por exercito, secao 43), depois da tabela.
// `caminho` (opcional) desempata quando o grupo tem o mesmo tipo em dois caminhos (o 603).
function alvoDe(regs, exercito, grupo, val, tab, tab_, caminho = null) {
  const cam = caminho ? caminho.join('/') : null;
  const doador = regs.find((x) => comEscolha(x) && x.val === val && x.tab === tab && grupoDe(x) === grupo && (!cam || x.lista.join('/') === cam));
  if (doador) return { lista: doador.lista, raridade: doador.raridade, nome: doador.nome, fonte: `doador no arquivo (id ${doador.id})` };
  const G = (tab_ || tabela()).exercitos?.[exercito]?.grupos?.[grupo];
  const op = G && (G.opcoes[cam ? `${chaveDoTipo(val, tab)}@${cam}` : chaveDoTipo(val, tab)]
    || Object.values(G.opcoes).find((o) => o.tipo === chaveDoTipo(val, tab) && (!cam || o.lista.join('/') === cam)));
  if (op) return { lista: op.lista, raridade: op.raridade, nome: op.nome, fonte: 'tabela blocos.json' };
  return null;
}

// TROCA O EQUIPAMENTO de uma formacao: toda unidade posicionada da subarvore de `idFormacao` cuja
// lista comeca em `grupo` passa ao tipo `para` — tipo, raridade e a lista inteira, e o registro
// cresce ou encolhe 2 bytes por nivel de diferenca. Remontagem como `core.marcarCore`: registro
// intocado copiado inteiro, registro trocado = conteudo novo + enchimento pela regra; na fronteira
// azul/vermelho a regra inteira e o K_verm; no ultimo, o resto do bloco como estava.
//
//   trocas = [{ idFormacao, grupo, para: [val, tab] | '0xTAB,0xVAL', caminho?: [615, 616, 747], de?: '0xTAB,0xVAL' }]
//
// `de` restringe a um tipo de origem (so os T-72B3, nao os T-72B3 (APS)); sem ele vale o grupo
// inteiro, que e o que o clique no bloco faz. Recusa: cauda core (no core-force os 4 bytes finais
// sao a cauda, e o `equipamento.indices` os lia como familia/modelo sem reclamar), registro com
// nome embutido, alvo fora do grupo, e um arquivo que `verificarForca` reprove depois de gravado.
export function trocar(entrada, saida, trocas, { tabela: tab_ = null } = {}) {
  const X = abrirCompleto(entrada); const c = X.completo, R = X.R; const regs = registrosDe(X); const A = arvore(X);
  const porId = new Map(); const andar = (no) => { porId.set(no.r.id, no); no.filhos.forEach(andar); }; A.topos.forEach(andar);
  const mudancas = new Map(); const relato = [];
  for (const t of trocas) {
    const no = porId.get(t.idFormacao); if (!no) throw new Error(`formacao id ${t.idFormacao} nao existe em ${path.basename(entrada)}`);
    const { val, tab } = Array.isArray(t.para) ? { val: t.para[0], tab: t.para[1] } : tipoDaChave(t.para);
    const de = t.de ? tipoDaChave(t.de) : null;
    const exercito = regs[no.i].exercito;
    const alvo = alvoDe(regs, exercito, t.grupo, val, tab, tab_, t.caminho || null);
    if (!alvo) throw new Error(`${chaveDoTipo(val, tab)} nao e opcao do grupo ${t.grupo} do exercito ${exercito}: nem doador no arquivo nem entrada na tabela`);
    if (alvo.lista[0] !== t.grupo) throw new Error(`${chaveDoTipo(val, tab)}: a lista do alvo comeca em ${alvo.lista[0]}, pedi o grupo ${t.grupo}`);
    let n = 0;
    for (let k = no.i + 1; k < no.fim; k++) {
      const reg = regs[k];
      if (reg.form || reg.erro) continue;
      if (!comEscolha(reg) || grupoDe(reg) !== t.grupo) continue;
      if (de && (reg.val !== de.val || reg.tab !== de.tab)) continue;
      if (reg.core) throw new Error(`id ${reg.id} ${reg.nome} ja tem cauda core: troque na biblioteca, antes de marcar`);
      if (reg.comNome) throw new Error(`id ${reg.id} ${reg.nome} tem nome embutido: nao sei redimensionar esse`);
      if (reg.val === val && reg.tab === tab) continue;                                  // ja e o alvo
      mudancas.set(k, { val, tab, ...alvo }); n++;
    }
    relato.push({ formacao: `${no.r.nm} (id ${no.r.id})`, grupo: t.grupo, para: alvo.nome, fonte: alvo.fonte, unidades: n, niveis: alvo.lista.length });
  }
  if (!mudancas.size) { if (entrada !== saida) fs.copyFileSync(entrada, saida); return { trocados: 0, relato, bytes: 0 }; }

  const partes = [c.subarray(0, R[0].c)];
  for (let k = 0; k < R.length; k++) {
    const r = R[k]; const prox = R[k + 1]; const m = mudancas.get(k);
    if (!m) { partes.push(c.subarray(r.c, prox ? prox.c : c.length)); if (!prox) break; continue; }
    const reg = regs[k];
    const cabeca = Buffer.from(c.subarray(r.c, reg.p));
    cabeca[17] = m.val; cabeca[18] = m.tab; cabeca[14] = (cabeca[14] & 0xf0) | m.raridade;
    const lista = Buffer.alloc(1 + 2 * m.lista.length); lista[0] = m.lista.length;
    m.lista.forEach((e, i) => lista.writeUInt16LE(e, 1 + 2 * i));
    const conteudo = Buffer.concat([cabeca, lista]);
    if (!prox) { partes.push(conteudo, c.subarray(reg.fim)); break; }
    const regra = regraDeEnchimento(conteudo, conteudo.length, 0);
    if (reg.fronteira) partes.push(conteudo, Buffer.alloc(regra), Buffer.from([c[prox.c - 1]]));
    else partes.push(conteudo, Buffer.alloc(regra - 3));
  }
  const novo = Buffer.concat(partes);
  reconstruir(entrada, saida, (b, k) => (k === 1 ? codificarComoJogo(novo, X.d.esc) : b));

  // conferencia: mesmo numero de registros, forca integra, e cada trocado relido como pedido
  const V = abrirCompleto(saida);
  if (V.R.length !== R.length) throw new Error(`gravado com ${V.R.length} registros, esperava ${R.length}`);
  const ver = verificarForca(saida);
  if (!ver.ok) throw new Error(`a forca trocada nao passa na verificacao: ${ver.erros.join('; ')}`);
  const regsV = registrosDe(V);
  for (const [k, m] of mudancas) {
    const v = regsV[k];
    if (v.val !== m.val || v.tab !== m.tab || v.lista.join('/') !== m.lista.join('/') || v.raridade !== m.raridade)
      throw new Error(`id ${v.id}: relido como ${v.tipo} ${v.lista.join('/')} rar ${v.raridade}, esperava ${chaveDoTipo(m.val, m.tab)} ${m.lista.join('/')} rar ${m.raridade}`);
  }
  return { trocados: mudancas.size, relato, bytes: novo.length - c.length, verificacao: { erros: ver.erros, avisos: ver.avisos } };
}

// ------------------------------------------------------------------------------- CLI
const EH_MAIN = process.argv[1] && /[\\/]blocos\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const [cmd, ...args] = process.argv.slice(2);
  const resolve = (x) => (/[\\/]/.test(x) ? x : (fs.existsSync(path.join(LIB, x)) ? path.join(LIB, x) : G + 'Scenarios/' + x));
  if (cmd === 'ver') {
    const B = lerBlocos(resolve(args[0]));
    const ids = args[1] ? [Number(args[1])] : B.topos;
    for (const id of ids) {
      const f = B.formacoes.get(id); if (!f) { console.log(`formacao ${id} nao existe`); continue; }
      console.log(`${f.nome} (id ${f.id}, ${f.tipo})`);
      for (const [g, ops] of Object.entries(f.grupos)) for (const o of ops) console.log(`   grupo ${g}: ${String(o.n).padStart(3)}x ${o.tipo} ${o.nome.padEnd(48)} ${o.kind.padEnd(8)} tam ${o.tam} rar ${o.raridade} lista ${o.lista.join('/')}`);
      const sem = B.registros.slice(f.i + 1, f.fim).filter((r) => !r.form && !comEscolha(r));
      if (sem.length) console.log(`   sem escolha: ${[...new Set(sem.map((r) => r.nome))].join(', ')}`);
    }
  } else if (cmd === 'minerar') {
    const r = minerar();
    for (const e of r.erros) console.log('  nao li:', e);
    for (const [ex, E] of Object.entries(r.tabela.exercitos)) {
      console.log(`\n${ex}: ${Object.keys(E.grupos).length} grupos`);
      for (const [g, Gp] of Object.entries(E.grupos)) console.log(`  ${g} ${Gp.rotulo}: ${Object.values(Gp.opcoes).map((o) => `${o.nome} [${o.lista.join('/')}] ${o.tam}B`).join(' | ')}`);
    }
    if (r.ambiguos.length) { console.log('\nambiguos (fora da tabela):'); for (const a of r.ambiguos) console.log(`  ${a.exercito} ${a.grupo} ${a.tipo} ${a.nome}: ${JSON.stringify(a.listas)}`); }
    console.log(`\n${r.lidos.length} arquivos lidos, ${r.opcoes} opcoes`);
    if (args.includes('--gravar')) { fs.writeFileSync(TABELA, JSON.stringify(r.tabela, null, 1)); console.log('gravado', TABELA); }
  } else if (cmd === 'variantes') {
    const v = variantesDaBiblioteca();
    for (const x of v) console.log(`${x.classe.padEnd(14)} ${x.arquivo}${x.classe === 'formacao-tipo' ? `  topo ${x.topo.de.nome} -> ${x.topo.para.nome}` : ''}${x.diferencas?.length ? `  (${x.diferencas.map((d) => `${d.nome} ${d.de}->${d.para}`).join(', ')})` : ''}`);
    console.log(`\n${v.length} variantes: ${['igual', 'composicao', 'formacao-tipo', 'sem-base'].map((k) => `${k} ${v.filter((x) => x.classe === k).length}`).join(', ')}`);
    if (args.includes('--gravar')) { fs.writeFileSync(VARIANTES, JSON.stringify({ nota: 'Os arquivos [XX Cn NN] da biblioteca contra a base de mesmo nome (FORMATO 124): igual = so raridade/C2; composicao = outro equipamento ou outra TO&E; formacao-tipo = outra formacao (artilharia off-map). Refazer com `node tools/re/blocos.mjs variantes --gravar`.', gerado: new Date().toISOString().slice(0, 10), variantes: v }, null, 1)); console.log('gravado', VARIANTES); }
  } else if (cmd === 'trocar') {
    const [ent, sai, id, grupo, para, de] = args;
    console.log(JSON.stringify(trocar(resolve(ent), sai, [{ idFormacao: Number(id), grupo: Number(grupo), para, ...(de ? { de } : {}) }]), null, 1));
  } else {
    console.log('uso: node blocos.mjs ver <arquivo> [id] | minerar [--gravar] | variantes [--gravar] | trocar <in> <out> <id> <grupo> <0xTAB,0xVAL> [de]');
  }
}
