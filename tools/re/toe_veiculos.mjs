// O PAIOL DA UNIDADE: veiculo, artilharia e o que mais nao guarda municao em cauda de homem.
//
// O reabastecimento do 110.6 alcanca so a lista do HOMEM (113.2). O autor viu o resto: "os veiculos
// e artilharia estao com municao diferente. O refit da municao precisa ser universal."
//
// Onde esta: no BLOCO DA UNIDADE, num rabo de pares `u16 item | u16 quantidade` que termina em
// `00 00 ff ff` — o mesmo `ff ff` das vagas do TO&E (111.20). A prova sai do diff entre unidades do
// mesmo tipo no mesmo save, que gastaram quantidades diferentes:
//
//   BMP-2 (tipo 12036, bloco de 187 B): +149 (item 5) = 476 ou 500;  +153 (item 92) = 233, 255,
//                                       316, 326, 340 — cinco BMP, cinco valores
//   M777  (tipo 2569,  bloco de  54 B): +34 (item 37) = 151 ou 169;  +38 (item 522) = 7 ou 1
//
// COMO UM CAMPO E RECONHECIDO COMO PAIOL, e a razao de a escrita ser segura: os pares ficam num
// passo de 4 bytes, e so vale como quantidade o `u16` cujo VIZINHO DE TRAS (o id do item) e o mesmo
// em todas as observacoes daquele tipo. O que varia sozinho — a posicao, o dano, o float de estado
// — nao tem vizinho constante e fica de fora. As posicoes sao medidas de tras para frente, a partir
// do `ff ff`, porque o comeco do bloco anda conforme o numero de homens.
//
// uso: node toe_veiculos.mjs [--gravar]   (grava research/toe_veiculos.json)
import fs from 'node:fs';
import path from 'node:path';
import { localizarRoster, lerRoster } from './roster.mjs';
import { cabecalhoDoBloco, decodificar, expandir, codificarComoJogo } from './escape.mjs';
import { comprimirLiterais } from './lz.mjs';
import { estadoDoBloco } from './veiculo_estado.mjs';

const RAIZ = path.resolve(import.meta.dirname, '../..');
const SALVOS = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games';
export const TABELA = path.join(RAIZ, 'research/toe_veiculos.json');
const ASSINATURA = Buffer.from([0x05, 0x04, 0x03]);
const DO_APP = /\[B\d+|\(rebuilt|\(curado|\(rearmado|\(antes do conserto|resupplied|replaced/i;

function candidatos() {
  const out = [];
  const anda = (dir) => {
    let itens; try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) anda(p);
      else if (it.name.toLowerCase().endsWith('.bts') && !DO_APP.test(it.name)) out.push(p);
    }
  };
  anda(SALVOS);
  return out;
}

// Os blocos de unidade de um save, com o corte de cada um e a posicao do `ff ff` final.
export function blocosDoSave(caminho) {
  const loc = localizarRoster(caminho);
  const h = cabecalhoDoBloco(loc.lz);
  const d = decodificar(loc.lz, h.esc, h.inicio, loc.lz.length, h.atalhos);
  const exp = Buffer.from(expandir(Buffer.from(d.cru), d.tokens).completo);

  const marcas = [];
  for (let q = exp.indexOf(ASSINATURA, 0); q >= 0; q = exp.indexOf(ASSINATURA, q + 4)) {
    const n = exp.readUInt32LE(q + 4);
    if (n >= 0 && n <= 60 && q >= 15) marcas.push({ q, ini: q - 15 });
  }
  marcas.sort((a, b) => a.ini - b.ini);
  marcas.forEach((m, i) => { m.fim = marcas[i + 1] ? marcas[i + 1].ini : exp.length; });

  const v = lerRoster(caminho);
  const porPos = new Map(marcas.map((m) => [m.q, m]));
  const out = [];
  for (const u of v.unidades) {
    const m = porPos.get(u.pos);
    if (!m) continue;
    const bytes = exp.subarray(m.ini, m.fim);
    // o `ff ff` que fecha o bloco: o ultimo que ainda deixa espaco para o enchimento de zeros
    let ff = -1;
    for (let o = bytes.length - 2; o >= 4; o--) if (bytes[o] === 0xff && bytes[o + 1] === 0xff) { ff = o; break; }
    out.push({ coreId: u.coreId, tipo: u.tipo, homens: u.soldados.length, ini: m.ini, fim: m.fim, ff, bytes });
  }
  return { exp, esc: loc.lz && cabecalhoDoBloco(loc.lz).esc, loc, unidades: out };
}

// A colheita: por tipo, o que cada distancia do `ff ff` mostrou.
export function colher(arquivos = candidatos()) {
  const porTipo = new Map();
  let lidos = 0, unidades = 0;
  for (const f of arquivos) {
    let b;
    try { b = blocosDoSave(f); } catch { continue; }
    lidos++;
    for (const u of b.unidades) {
      if (u.ff < 8) continue;
      unidades++;
      // A CHAVE E (tipo, tamanho do bloco). Misturar formas diferentes do mesmo tipo — a unidade
      // dormente, que o jogo nunca instanciou, tem bloco menor — desalinha tudo e faz a coluna do
      // id parecer variavel.
      const chave = `${u.tipo}:${u.bytes.length}`;
      if (!porTipo.has(chave)) porTipo.set(chave, new Map());
      const dists = porTipo.get(chave);
      // TODA distancia par, sem supor a fase. O passo dos pares e 4, mas onde ele COMECA muda de
      // tipo para tipo (o enchimento entre o ultimo par e o `ff ff` tem 2 bytes no obus e 3 no
      // BMP), e chutar a fase errada le a quantidade na coluna do id. Guardando tudo, quem decide
      // qual coluna e o id e o dado: id nao muda de uma unidade para outra, quantidade muda.
      for (let d = 4; d <= 200 && u.ff - d >= 0; d += 2) {
        const o = u.ff - d;
        if (o + 2 > u.bytes.length) continue;
        if (!dists.has(d)) dists.set(d, []);
        dists.get(d).push(u.bytes.readUInt16LE(o));
      }
    }
  }
  return { porTipo, lidos, unidades, arquivos: arquivos.length };
}

// UM CAMPO SO E PAIOL SE O VIZINHO DE TRAS FOR CONSTANTE. A quantidade fica em `d`, o id do item em
// `d + 2`: se aquele id e o mesmo em todas as observacoes daquele tipo, o par existe e o campo pode
// ser escrito. Posicao, dano e o float de estado variam sozinhos, sem id constante ao lado, e ficam
// de fora — e essa e a unica razao de ser seguro escrever aqui.
export function apurar(porTipo, { minimo = 2, ate = 100 } = {}) {
  const out = {};
  for (const [chave, dists] of porTipo) {
    const slots = [];
    for (const [d, qtds] of [...dists.entries()].sort((a, b) => a[0] - b[0])) {
      if (d > ate || qtds.length < minimo) continue;   // o rabo e curto; longe dali e cabecalho
      const vizinhos = dists.get(d + 2);
      if (!vizinhos) continue;
      const ids = new Set(vizinhos);
      if (ids.size !== 1) continue;
      const item = [...ids][0];
      if (!item || item > 4000) continue;
      const max = Math.max(...qtds), min = Math.min(...qtds);
      // AMPLITUDE. Paiol gasto anda muito — o BMP foi de 233 a 340, o obus de 1 a 7. Campo de
      // atributo (112.12) anda um passo: 1280, 1281, 1282. Cinco por cento separa os dois mundos.
      if (!max || max > 20000 || (max - min) / max < 0.03) continue;
      slots.push({ d, item, max, vistos: qtds.length });
    }
    // UMA FASE SO. Os pares andam de quatro em quatro, entao todo paiol de uma mesma forma cai no
    // mesmo `d % 4`. Um campo que passou nos testes mas esta na outra fase e coincidencia — foi
    // assim que o campo de atributos da 112.12 (o `+11`, que muda de unidade para unidade) se
    // disfarcou de paiol de BMP.
    const fases = new Map();
    for (const s of slots) fases.set(s.d % 4, (fases.get(s.d % 4) || 0) + 1);
    const fase = [...fases.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
    const naFase = slots.filter((s) => s.d % 4 === fase);
    // E UMA CORRENTE. O rabo e uma sequencia de pares colados, entao os campos validos andam de
    // quatro em quatro a partir do mais proximo do `ff ff`. Um campo isolado, longe da corrente, e
    // do CABECALHO do bloco — foi como o `+14` da 112.12 se disfarcou de paiol de obus. Perder um
    // par de verdade por causa de um buraco na corrente custa municao que nao foi reposta; aceitar
    // um campo do cabecalho custa escrever por cima do que a unidade E.
    const bons = [];
    for (const s of naFase) {
      if (!bons.length || s.d === bons[bons.length - 1].d + 4) bons.push(s);
      else break;
    }
    if (bons.length) out[chave] = bons;
  }
  return out;
}

// A tabela mudou de forma em 11/09 (E38): era `tipo:tamanho_do_bloco -> campos por deslocamento`, e
// agora e `nome do veiculo -> { item: maximo }`. Le as duas, para um arquivo velho nao virar erro.
export function lerTabela(arquivo = TABELA) {
  const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  return bruto.itens || bruto.tipos;
}
// As sequencias de itens que o jogo escreve para cada veiculo (E41): `nome -> [[itens...], ...]`,
// da mais comum para a mais rara. Vazio num arquivo de antes.
export function lerSequencias(arquivo = TABELA) {
  const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  return bruto.sequencias || {};
}

// ONDE ENTRA O PAR QUE ZEROU (E41). Um item gasto ate o fim sai da lista, e por-lo de volta e
// inserir `u16 item | u16 qtd` no meio do rabo e somar um ao `n`. Duas regras, as duas medidas nas
// sequencias colhidas:
//   so entra em veiculo que ja foi visto com ele   uma sequencia observada tem de conter o item E
//                                                  todos os que a lista ja tem — e o que impede o
//                                                  37/522/124 de entrar num M119A3 de 196/204;
//   entra na posicao que essa sequencia da         antes do primeiro item presente que vem depois
//                                                  dele na sequencia, senao no fim da lista.
// Devolve `null` quando nenhuma sequencia cobre.
export function planoDeInsercao(rabo, faltando, itens, sequencias, fracao = 1) {
  const presentes = rabo.paiol.map((s) => s.item);
  const novos = [];
  for (const item of faltando) {
    const qtd = Math.round((itens[item] || 0) * fracao);
    if (!(qtd > 0)) continue;
    const ref = (sequencias || []).find((seq) => seq.includes(item) && presentes.every((p) => seq.includes(p)));
    if (!ref) continue;
    const depoisDele = ref.slice(ref.indexOf(item) + 1);
    const seguinte = rabo.paiol.find((s) => depoisDele.includes(s.item));
    // Posicao ABSOLUTA no expandido: antes do seguinte, ou logo depois do ultimo par da lista.
    const p = seguinte ? seguinte.p : rabo.pn + 2 + 4 * rabo.n;
    novos.push({ item, qtd, p, ordem: ref.indexOf(item) });
  }
  // Na ordem da sequencia de referencia: e a ordem em que dois pares que caem no mesmo lugar (os
  // tres de 125mm do T-64BV, todos "no fim") tem de ficar.
  novos.sort((a, b) => a.p - b.p || a.ordem - b.ordem);
  return novos.length ? novos : null;
}

// Insere os pares num expandido, de tras para frente, e ajusta cada `n`. `planos` = [{ pn, n, novos }].
// Com o mesmo `p`, o ultimo do plano entra primeiro e o primeiro por ultimo — cada insercao empurra
// a anterior para a frente, e o que sobra e a ordem do plano.
export function inserirPares(exp, planos) {
  let novo = Buffer.from(exp);
  const ordem = [...planos].sort((a, b) => b.pn - a.pn);
  for (const pl of ordem) {
    const fila = pl.novos.map((x, k) => ({ ...x, k })).sort((a, b) => b.p - a.p || b.k - a.k);
    for (const x of fila) {
      const par = Buffer.alloc(4); par.writeUInt16LE(x.item, 0); par.writeUInt16LE(x.qtd, 2);
      novo = Buffer.concat([novo.subarray(0, x.p), par, novo.subarray(x.p)]);
    }
    novo.writeUInt16LE(pl.n + pl.novos.length, pl.pn);
  }
  return novo;
}

// O MESMO, COM CORTE (28/09, reset de fabrica). `planos` = [{ pn, n, novos, cortes }]: `cortes` sao
// posicoes absolutas de pares a TIRAR (4 bytes cada). Tudo de tras para frente — lista a lista pelo
// contador, e dentro da lista posicao a posicao —, e o contador escrito por ultimo, quando nada antes
// dele se moveu. O bloco nao tem campo de tamanho (acaba em `ff ff`), por isso crescer ja bastava (E41)
// e encolher e o mesmo movimento ao contrario.
export function editarListas(exp, planos) {
  let novo = Buffer.from(exp);
  for (const pl of [...planos].sort((a, b) => b.pn - a.pn)) {
    const ops = [
      ...pl.novos.map((x, k) => ({ corte: false, p: x.p, item: x.item, qtd: x.qtd, k })),
      ...(pl.cortes || []).map((p) => ({ corte: true, p, k: -1 })),
    ].sort((a, b) => b.p - a.p || b.k - a.k);
    for (const o of ops) {
      if (o.corte) { novo = Buffer.concat([novo.subarray(0, o.p), novo.subarray(o.p + 4)]); continue; }
      const par = Buffer.alloc(4); par.writeUInt16LE(o.item, 0); par.writeUInt16LE(o.qtd, 2);
      novo = Buffer.concat([novo.subarray(0, o.p), par, novo.subarray(o.p)]);
    }
    novo.writeUInt16LE(pl.n + pl.novos.length - (pl.cortes || []).length, pl.pn);
  }
  return novo;
}

// ACHAR O PAIOL PELO ID DO ITEM, e nao por deslocamento fixo (E38).
//
// A primeira versao guardava a distancia de cada campo ate o `ff ff` e so aceitava o bloco se o
// TAMANHO dele batesse com o da colheita. Nao funcionou uma vez sequer em jogo: o tamanho anda com o
// numero de homens dentro do bloco, e errava por ate um byte — o BTR-70 do autor tinha 175 e a
// tabela 174. Dos sete veiculos da E38, um casou, e esse ja estava cheio.
//
// O que e estavel e o par: o rabo e uma corrente de `u16 item | u16 quantidade`. Entao a busca passa
// a ser pelo ID, dentro de uma janela antes do `ff ff`, e o id e a propria trava — so entra item que
// AQUELE veiculo sabe carregar, e com quantidade que cabe no maximo dele.
//
// Duas escolhas que a medicao ditou:
//   a janela comeca em 8    um `item 5` aparece em d4 com quantidade 0, por acaso, em varios blocos
//   fica o de MAIOR d       o mesmo `item 5` aparece em d8 (42) e em d32 (500) no BRM-1K, e o painel
//                           do jogo mostra 500 — o verdadeiro e o mais fundo, o falso e o raso
//
// E A CACA AO ID DERRUBOU O JOGO (E40, 12/09). O T-64BV tem o item 24 (125mm) e, dois pares antes
// da lista, um `u16 24` que NAO e item: e o campo que precede o contador. `24 | 5 | (5,1240) (8,150)
// (24,8) (31,11) (36,8)` — o caçador viu `(24, 5)` como "item 24 com 5 tiros", ficou com ele por ser
// o de maior d, e escreveu 10 EM CIMA DO CONTADOR. O jogo passou a ler dez pares onde ha cinco, o
// resto do roster virou lixo e o save deu "Out of memory" a 5% da carga. O id nao e trava quando o
// numero ao lado dele tambem e pequeno.
//
// O que e trava e a GRAMATICA do rabo, lida em 12 rabos de 9 tipos (FORMATO 110.8):
//
//   u16 n | n x (u16 item, u16 qtd) | u16 m | m x (u16 item, u16 qtd) | [u16 x] | ff ff
//
// A primeira lista e o paiol da maquina; a segunda e a CARGA que ela leva para os homens (5.45 x
// 2160, 7.62 x 1500 num BMP); `x` existe no veiculo e nao no canhao. Um item que zerou SAI da lista
// (o T-64BV #2 do autor, sem um tiro de 125mm, tem n = 2), entao repor o que zerou exige inserir um
// par e crescer o bloco — fica para depois; aqui so se escreve quantidade em par que existe.
const MAX_PARES = 12;
function lerLista(exp, p0, n) {
  const out = [];
  const vistos = new Set();
  for (let k = 0; k < n; k++) {
    const p = p0 + 4 * k;
    if (p + 4 > exp.length) return null;
    const item = exp.readUInt16LE(p), qtd = exp.readUInt16LE(p + 2);
    if (!item || item > 4000 || qtd > 20000) return null;
    if (vistos.has(item)) return null;          // uma lista nao repete item: a leitura deslocada repete
    vistos.add(item);
    out.push({ item, qtd, p });
  }
  return out;
}
// A FORMA VEM DO NOME, nao do chute. Um rabo de veiculo com `x = 0` tambem "le" na forma de canhao,
// deslocado de um u16, e a lista deslocada passa no teste de plausibilidade — foi assim que o T-64BV
// #3 saiu da colheita por ambiguo e um Stryker ganhou "item 1 = 6". Veiculo tem `x`; canhao, tubo e
// obus fecham `m = 0 | ff ff` direto.
export function formaDoNome(nome) {
  const n = String(nome || '');
  if (/\b(Vehicle|Carrier|Tank|Truck|Helicopter|System)\b/.test(n)) return 'veiculo';
  if (/\b(Howitzer|Mortar|Gun|Rocket)\b/.test(n)) return 'canhao';
  return null;
}
// OS LANCADORES DO VEICULO (02/10, FORMATO 131). Entre a lista de dano por subsistema (110.11) e o paiol
// ha duas listas que nenhum leitor via:
//
//   u32 k | k x (u8 classe, u8 item, 00)   os lancadores que ele leva para a infantaria — ids de ARMA
//                                          por exercito: 4/2 AT4, 4/1 Javelin, 4/16 RPG-26, 4/15 RPG-22
//   u16 c | c x (u16 item, u16 qtd)        uma terceira lista de um par (o "05 00 | u16" da 110.10)
//   u16 n | paiol ...                      (`rabo.pn`)
//
// Ancorada pelos dois lados: para tras a partir do contador do paiol e para a frente a partir do trio
// de estado (`estadoDoBloco`: o u32 k comeca em off + 11 + 4n). Se as duas nao coincidem, null.
export function lerLancadores(exp, u, rabo = null) {
  const e = estadoDoBloco(u.bytes);
  if (!e) return null;
  const p = u.ini + e.off + 11 + 4 * e.n;
  const fim = u.ini + u.ff;
  if (p + 4 > fim) return null;
  const k = exp.readUInt32LE(p);
  if (k > 40 || p + 4 + 3 * k + 2 > fim) return null;
  const itens = [];
  for (let i = 0; i < k; i++) {
    const a = exp[p + 4 + 3 * i], b = exp[p + 5 + 3 * i];
    if (exp[p + 6 + 3 * i] !== 0 || a > 8) return null;
    itens.push(`${a}/${b}`);
  }
  const pc = p + 4 + 3 * k;
  const c = exp.readUInt16LE(pc);
  if (c > 4 || pc + 2 + 4 * c > fim) return null;
  const terceira = [];
  for (let i = 0; i < c; i++) {
    const item = exp.readUInt16LE(pc + 2 + 4 * i), qtd = exp.readUInt16LE(pc + 4 + 4 * i);
    if (!item || item > 4000) return null;
    terceira.push({ item, qtd, p: pc + 2 + 4 * i });
  }
  // o paiol comeca logo depois; quando o `lerRabo` escolheu outro contador, a leitura dele e que esta
  // errada (veiculo destruido com par perdido) — fica dito em `concorda`
  const pn = pc + 2 + 4 * c;
  return { p, k, itens, pc, terceira, pn, concorda: rabo ? rabo.pn === pn : null };
}

// ESCREVER OS LANCADORES (02/10). `porCore = { coreId: ['4/16', '4/16', ...] }` — a lista inteira, na
// ordem dada; o bloco cresce ou encolhe 3 B por entrada (sem campo de tamanho, como o paiol: 110.8).
// Aplicado de tras para frente; confere relendo: mesmos homens e unidades, a lista nova no lugar, e o
// paiol, a carga e a terceira lista de cada veiculo exatamente como estavam.
export function escreverLancadores(caminho, saida, porCore) {
  const b = blocosDoSave(caminho);
  const planos = [];
  for (const u of b.unidades) {
    const alvo = porCore instanceof Map ? porCore.get(u.coreId) : porCore[u.coreId];
    if (!alvo) continue;
    const l = lerLancadores(b.exp, u);
    if (!l) throw new Error(`core ${u.coreId}: lista de lancadores ilegivel, nao escrevo`);
    const corpo = Buffer.alloc(4 + 3 * alvo.length);
    corpo.writeUInt32LE(alvo.length, 0);
    alvo.forEach((par, i) => {
      const [c, it] = String(par).split('/').map(Number);
      if (!(c >= 0 && c <= 8 && it >= 0 && it <= 255)) throw new Error(`par invalido: ${par}`);
      corpo[4 + 3 * i] = c; corpo[5 + 3 * i] = it; corpo[6 + 3 * i] = 0;
    });
    planos.push({ coreId: u.coreId, ini: l.p, fim: l.pc, corpo, de: l.itens, para: alvo.map(String) });
  }
  if (!planos.length) return { veiculos: 0, detalhe: [] };
  let novo = Buffer.from(b.exp);
  for (const p of [...planos].sort((x, y) => y.ini - x.ini)) novo = Buffer.concat([novo.subarray(0, p.ini), p.corpo, novo.subarray(p.fim)]);
  const cresceu = planos.reduce((a, p) => a + p.corpo.length - (p.fim - p.ini), 0);
  if (novo.length !== b.exp.length + cresceu) throw new Error('a escrita dos lancadores mudou o tamanho errado');
  const comp = comprimirLiterais(codificarComoJogo(novo, b.esc));
  const t4 = Buffer.alloc(4); t4.writeUInt32LE(comp.length);
  const bruto = b.loc.anatomia.b;
  fs.writeFileSync(saida, Buffer.concat([bruto.subarray(0, b.loc.pos), t4, comp, bruto.subarray(b.loc.pos + 4 + b.loc.tam)]));

  const a1 = lerRoster(caminho), a2 = lerRoster(saida);
  if (a1.soldados.length !== a2.soldados.length || a1.unidades.length !== a2.unidades.length) throw new Error('a escrita dos lancadores mudou o roster');
  const g = blocosDoSave(saida);
  const resto = (bl, u) => { const l = lerLancadores(bl.exp, u); return l ? Buffer.from(bl.exp.subarray(l.pc, u.ini + u.bytes.length)).toString('hex') : null; };
  for (const u of b.unidades) {
    const v = g.unidades.find((x) => x.coreId === u.coreId);
    const p = planos.find((x) => x.coreId === u.coreId);
    if (!p) { if (!v || Buffer.compare(u.bytes, v.bytes) !== 0) throw new Error(`core ${u.coreId}: mudou sem pedido`); continue; }
    const l = lerLancadores(g.exp, v);
    if (!l || l.itens.join() !== p.para.join()) throw new Error(`core ${u.coreId}: a lista nova nao le de volta`);
    if (resto(b, u) !== resto(g, v)) throw new Error(`core ${u.coreId}: o paiol/carga mudou junto`);
  }
  return { veiculos: planos.length, cresceu, detalhe: planos.map((p) => ({ coreId: p.coreId, de: p.de, para: p.para })) };
}

// ESCREVER A TERCEIRA LISTA (02/10, E121). `porCore = { coreId: [{ item, qtd }, ...] }` — a lista inteira
// (`u16 c | c x (u16 item, u16 qtd)`), 4 B por par; mesmo caminho e mesma conferencia do `escreverLancadores`:
// os lancadores, o paiol e a carga de cada veiculo ficam exatamente como estavam.
export function escreverTerceira(caminho, saida, porCore) {
  const b = blocosDoSave(caminho);
  const planos = [];
  for (const u of b.unidades) {
    const alvo = porCore instanceof Map ? porCore.get(u.coreId) : porCore[u.coreId];
    if (!alvo) continue;
    const l = lerLancadores(b.exp, u);
    if (!l) throw new Error(`core ${u.coreId}: terceira lista ilegivel, nao escrevo`);
    const corpo = Buffer.alloc(2 + 4 * alvo.length);
    corpo.writeUInt16LE(alvo.length, 0);
    alvo.forEach((x, i) => {
      if (!(x.item > 0 && x.item <= 4000 && x.qtd > 0 && x.qtd <= 0xffff)) throw new Error(`par invalido: ${JSON.stringify(x)}`);
      corpo.writeUInt16LE(x.item, 2 + 4 * i); corpo.writeUInt16LE(x.qtd, 4 + 4 * i);
    });
    planos.push({ coreId: u.coreId, ini: l.pc, fim: l.pn, corpo, de: l.terceira.map(({ item, qtd }) => ({ item, qtd })), para: alvo });
  }
  if (!planos.length) return { veiculos: 0, detalhe: [] };
  let novo = Buffer.from(b.exp);
  for (const p of [...planos].sort((x, y) => y.ini - x.ini)) novo = Buffer.concat([novo.subarray(0, p.ini), p.corpo, novo.subarray(p.fim)]);
  const cresceu = planos.reduce((a, p) => a + p.corpo.length - (p.fim - p.ini), 0);
  if (novo.length !== b.exp.length + cresceu) throw new Error('a escrita da terceira lista mudou o tamanho errado');
  const comp = comprimirLiterais(codificarComoJogo(novo, b.esc));
  const t4 = Buffer.alloc(4); t4.writeUInt32LE(comp.length);
  const bruto = b.loc.anatomia.b;
  fs.writeFileSync(saida, Buffer.concat([bruto.subarray(0, b.loc.pos), t4, comp, bruto.subarray(b.loc.pos + 4 + b.loc.tam)]));

  const a1 = lerRoster(caminho), a2 = lerRoster(saida);
  if (a1.soldados.length !== a2.soldados.length || a1.unidades.length !== a2.unidades.length) throw new Error('a escrita da terceira lista mudou o roster');
  const g = blocosDoSave(saida);
  const resto = (bl, u) => { const l = lerLancadores(bl.exp, u); return l ? Buffer.from(bl.exp.subarray(l.pn, u.ini + u.bytes.length)).toString('hex') + '|' + l.itens.join() : null; };
  for (const u of b.unidades) {
    const v = g.unidades.find((x) => x.coreId === u.coreId);
    const p = planos.find((x) => x.coreId === u.coreId);
    if (!p) { if (!v || Buffer.compare(u.bytes, v.bytes) !== 0) throw new Error(`core ${u.coreId}: mudou sem pedido`); continue; }
    const l = lerLancadores(g.exp, v);
    if (!l || JSON.stringify(l.terceira.map(({ item, qtd }) => ({ item, qtd }))) !== JSON.stringify(p.para.map(({ item, qtd }) => ({ item, qtd })))) throw new Error(`core ${u.coreId}: a terceira lista nova nao le de volta`);
    if (resto(b, u) !== resto(g, v)) throw new Error(`core ${u.coreId}: lancadores/paiol/carga mudaram junto`);
  }
  return { veiculos: planos.length, cresceu, detalhe: planos.map((p) => ({ coreId: p.coreId, de: p.de, para: p.para })) };
}

export function lerRabo(exp, u, forma = null, incluirVazio = false) {
  const fim = u.ini + u.ff;
  const candidatos = [];
  for (const comX of forma === 'veiculo' ? [true] : forma === 'canhao' ? [false] : [true, false]) {
    for (let m = 0; m <= MAX_PARES; m++) {
      const pm = fim - (comX ? 4 : 2) - 4 * m;
      if (pm < u.ini + 8 || exp.readUInt16LE(pm) !== m) continue;
      const carga = lerLista(exp, pm + 2, m);
      if (!carga) continue;
      // `n = 0` E LISTA VAZIA, e quem REPOE precisa acha-la (E73): quando uma unidade gasta TODA a
      // municao cada item sai da lista (110.8) e o que sobra e `n = 0` — foi o que aconteceu com a
      // artilharia do autor entre a batalha 3 (`n=2: 281=75, 282=30`) e a 4 (`n=0`), e como o laco
      // comecava em 1 o rabo vazio nao tinha leitura, a reposicao passava reto e a bateria entrava
      // na batalha seguinte sem um tiro.
      //
      // Mas so para quem REPOE. Para a COLHEITA a lista vazia e veneno: todo bloco dormente (rabo de
      // zeros) passa a ter uma leitura valida, e com isso 53 mil blocos viram "com lista" e 72 mil
      // viram ambiguos — o bloco que tinha UMA leitura boa passa a ter duas e e descartado, que foi
      // como o Stryker (Mk19) perdeu dois itens da tabela quando eu liguei isso para todo mundo.
      // Por isso e opcional, e so `acharPaiol` pede.
      for (let n = incluirVazio ? 0 : 1; n <= MAX_PARES; n++) {
        const pn = pm - 2 - 4 * n;
        if (pn < u.ini + 8 || exp.readUInt16LE(pn) !== n) continue;
        const paiol = lerLista(exp, pn + 2, n);
        if (!paiol) continue;
        candidatos.push({ forma: comX ? 'veiculo' : 'canhao', n, m, paiol, carga, x: comX ? exp.readUInt16LE(fim - 2) : null, pn, pm });
      }
    }
  }
  return candidatos;
}

// A LEITURA ANINHADA NAO E UMA SEGUNDA LEITURA (E77). Antes do contador `n` o bloco de um veiculo
// traz dois u16 — um `5` fixo e um valor pequeno que muda de unidade para unidade (6, 8, 12, 16):
//
//     ... 05 00 | 0c 00 | 04 00 | 04 00 03 2b | 1d 02 84 03 | 13 02 15 00 | 0c 02 09 00 | ...
//         5       12      n=4     4=11011       541=900       531=21        524=9
//
// Quando a lista tem QUATRO pares, esses dois u16 mais o proprio contador leem como `n=5` com um
// primeiro par `12=4`: uma lista plausivel, um par mais longa, cujo primeiro par tem como
// "quantidade" exatamente o `n` da de dentro. A colheita contava isso como bloco ambiguo e o jogava
// fora — e e justamente o bloco do veiculo CHEIO, porque e ele que tem os quatro itens. Por isso o
// catalogo do Abrams saiu de um tanque so, o unico com tres itens (o Multi ja tinha zerado e saido
// da lista): `4=5503 541=800 531=4`, um paiol de fim de batalha gravado como dotacao. Todos os
// Bradley de quatro itens cairam no mesmo buraco.
//
// A de fora sai quando e exatamente a de dentro mais esse par. E a regra e a mesma para quem ESCREVE
// (`acharPaiol`): ali o empate ia para "a mais longa", que e a errada, e uma insercao nela somaria
// um ao `5` em vez de ao contador — o "Out of memory" da E40 por outro caminho.
export function semAninhadas(leituras) {
  return leituras.filter((fora) => !leituras.some((dentro) => dentro !== fora
    && dentro.forma === fora.forma && dentro.pm === fora.pm && fora.n === dentro.n + 1
    && fora.paiol[0] && fora.paiol[0].qtd === dentro.n && fora.pn === dentro.pn - 4));
}

// A COLHEITA PELA GRAMATICA (E40): em vez de adivinhar campos por diferenca entre saves, le a lista
// de cada bloco e guarda o MAIOR visto por (tipo, item) — do paiol e da carga, separados. Bloco com
// mais de uma leitura possivel nao ensina nada (contado em `ambiguos`); bloco dormente (rabo de
// zeros) nao tem lista e tambem fica de fora. Sem os quatro testes da 110.7 e sem os tres cortes da
// lista branca: a gramatica ja separa municao de atributo, porque atributo nao esta em lista nenhuma.
export function colherPelaGramatica(arquivos = candidatos(), formaDoTipo = () => null) {
  const porTipo = new Map();
  let lidos = 0, unidades = 0, comLista = 0, ambiguos = 0;
  for (const f of arquivos) {
    let b;
    try { b = blocosDoSave(f); } catch { continue; }
    lidos++;
    const exp = Buffer.from(b.exp);
    for (const u of b.unidades) {
      if (u.ff < 12) continue;
      unidades++;
      const leituras = semAninhadas(lerRabo(exp, u, formaDoTipo(u.tipo)));
      if (!leituras.length) continue;
      if (leituras.length > 1) { ambiguos++; continue; }
      comLista++;
      const r = leituras[0];
      if (!porTipo.has(u.tipo)) porTipo.set(u.tipo, { itens: new Map(), carga: new Map(), blocos: 0, formas: new Set(), sequencias: new Map() });
      const t = porTipo.get(u.tipo);
      t.blocos++; t.formas.add(r.forma);
      // A ORDEM em que o jogo escreve os pares, sequencia por sequencia, com contagem. E ela que diz
      // onde inserir um par que zerou e saiu da lista (E41) — e que o M119A3 tem duas familias de
      // municao (37/522/124 e 196/204) que nunca se misturam.
      const seq = r.paiol.map((s) => s.item).join(',');
      t.sequencias.set(seq, (t.sequencias.get(seq) || 0) + 1);
      // Guarda o maior visto E em quantos blocos o item apareceu: um item visto num bloco so nao
      // ensina (pode ser um `n` que coincidiu com bytes de antes da lista).
      const soma = (mapa, s) => { const v = mapa.get(s.item) || { max: 0, vezes: 0 }; mapa.set(s.item, { max: Math.max(v.max, s.qtd), vezes: v.vezes + 1 }); };
      for (const s of r.paiol) soma(t.itens, s);
      for (const s of r.carga) soma(t.carga, s);
    }
  }
  return { porTipo, lidos, unidades, comLista, ambiguos, arquivos: arquivos.length };
}

export function acharPaiol(exp, u, itens, forma = null) {
  // Entre as leituras possiveis vale a que mais itens da tabela reconhece; empate, a mais longa.
  const leituras = semAninhadas(lerRabo(exp, u, forma, true))
    .map((c) => ({ ...c, conhecidos: c.paiol.filter((s) => itens[s.item] !== undefined).length }))
    .sort((a, b) => b.conhecidos - a.conhecidos || b.n - a.n);
  const r = leituras[0];
  // Sem leitura nenhuma, ou uma leitura cheia de itens que a tabela nao conhece: nao se mexe. A
  // EXCECAO e a lista VAZIA de uma unidade que a tabela conhece (E73): ali nao ha o que reconhecer
  // porque nao ha nada, e tudo o que a tabela sabe esta faltando — e o caminho de insercao (E41)
  // que repoe, com a mesma regra de sequencia observada.
  if (!r) return [];
  if (!r.conhecidos && r.n !== 0) return [];
  const fim = u.ini + u.ff;
  // O campo ACIMA da dotacao tambem entra (E78): ele e municao que a maquina juntou na batalha, e a
  // regra do autor e que nada disso atravessa de um mapa para o outro. Quem decide subir, descer ou
  // deixar como esta e `reabastecerUnidades`; aqui so se diz o que e campo de municao conhecido.
  const out = r.paiol
    .filter((s) => itens[s.item] !== undefined)
    .map((s) => ({ item: s.item, max: itens[s.item], tem: s.qtd, p: s.p, d: fim - s.p }));
  // O que a tabela conhece e o rabo nao tem: zerou e saiu da lista. Vai no retorno para o log dizer.
  out.faltando = Object.keys(itens).map(Number).filter((i) => !r.paiol.some((s) => s.item === i));
  out.rabo = r;
  return out;
}

// REABASTECER O QUE NAO E HOMEM: escreve a dotacao nos campos que o `acharPaiol` reconheceu.
//
// So `u16` de quantidade, no lugar, um por campo. Veiculo cujo nome a tabela nao conhece fica como
// esta: e melhor uma unidade sem repor do que um byte escrito no escuro.
// `soCoreIds` limita a quem esta em campo — unidade dormente nao gasta municao —, e `nomes` e o mapa
// coreId -> nome, porque a tabela e indexada por nome desde a E38.
// `exato` (E78): a dotacao e o numero final, para cima E para baixo. Municao que a maquina juntou na
// batalha nao atravessa para o mapa seguinte — e a mesma regra do paiol dos homens (113.8).
// `cargas` (28/09, reset de fabrica): `{ nome: { itens: { item: qtd }, ordem: [item...] } }`, a CARGA
// que a maquina leva para a infantaria (a segunda lista do rabo). Volta a fabrica por inteiro:
// quantidade exata, o item que a fabrica nao poe SAI (saque guardado no veiculo), e o que zerou volta
// na posicao da ordem de fabrica (o jogo nao ordena a carga por id).
// TIRAR ITENS DA CARGA (17/10/2026, autor: o Stryker do jogador nao leva Javelin — nem o CLU nem os misseis, item 57).
// `porCore = Map coreId -> [item...]`. Le a carga atual de cada maquina pelo mesmo caminho do reabastecimento e pede a
// `reabastecerUnidades` exatamente essa carga menos os itens, com fracao 0: nada sobe nem desce, so o que nao esta no
// alvo SAI (o corte e a mesma edicao de lista do reset de fabrica, conferida la dentro). Bloco dormente e destroco nao
// se editam (la dentro tambem). `tabela` = o paiol de fabrica por nome, so para achar o rabo certo.
export function tirarDaCarga(caminho, saida, porCore, tabela, nomes) {
  const b = blocosDoSave(caminho);
  const limpo = (n) => String(n || '').replace(/\s+#\d+$/, '');
  const cargas = {}, tab = {}, alvos = new Set(), detalhe = [];
  for (const u of b.unidades) {
    const tira = porCore instanceof Map ? porCore.get(u.coreId) : porCore[u.coreId];
    if (!tira?.length || u.ff < 12) continue;
    const nome = limpo(nomes?.get(u.coreId));
    const itens = tabela?.[nome] || {};
    const forma = formaDoNome(nome);
    const achado = acharPaiol(b.exp, u, itens, forma);
    const rabo = achado.rabo || (() => { const l = semAninhadas(lerRabo(b.exp, u, forma, true)); return l.length === 1 ? l[0] : null; })();
    if (!rabo || rabo.forma !== 'veiculo' || !rabo.carga.some((s) => tira.includes(s.item))) continue;
    cargas[u.coreId] = { itens: Object.fromEntries(rabo.carga.filter((s) => !tira.includes(s.item)).map((s) => [s.item, s.qtd])), ordem: rabo.carga.map((s) => s.item) };
    tab[nome] = itens; alvos.add(u.coreId);
    detalhe.push({ coreId: u.coreId, itens: rabo.carga.filter((s) => tira.includes(s.item)).map((s) => ({ item: s.item, qtd: s.qtd })) });
  }
  if (!alvos.size) return { veiculos: 0, detalhe: [] };
  const r = reabastecerUnidades(caminho, saida, tab, { fracao: 0, soCoreIds: alvos, nomes, exato: true, cargas });
  const tirados = (r.cargaRemovidos || []).length;
  if (tirados !== alvos.size) throw new Error(`a carga saiu de ${tirados} maquinas e devia sair de ${alvos.size}`);
  return { veiculos: tirados, detalhe };
}

export function reabastecerUnidades(caminho, saida, tabela, { fracao = 1, soCoreIds = null, nomes = null, sequencias = null, exato = false, cargas = null } = {}) {
  const b = blocosDoSave(caminho);
  const exp = Buffer.from(b.exp);
  const feitos = [];
  const planos = [];
  const limpo = (n) => String(n).replace(/\s+#\d+$/, '');
  const seqs = sequencias || (() => { try { return lerSequencias(); } catch { return {}; } })();
  for (const u of b.unidades) {
    if (u.ff < 12) continue;
    if (soCoreIds && !soCoreIds.has(u.coreId)) continue;
    const nome = nomes ? limpo(nomes.get(u.coreId) || '') : '';
    const itens = nome ? tabela[nome] : null;
    if (!itens) continue;
    let mexidos = 0, antes = 0, depois = 0;
    const forma = formaDoNome(nome);
    const achado = acharPaiol(exp, u, itens, forma);
    // BLOCO DORMENTE NAO SE EDITA (28/09): a maquina que nunca foi a campo tem 80-88 B, sem trio de
    // estado, e o rabo dela sao zeros que leem como `n0 m0` — o jogo cria o conteudo ao por a unidade
    // em campo. Inserir ali e escrever no escuro (o Ural 174 da RUS1 ia ganhar a carga inteira).
    // E o DESTROCO tambem nao (codigo 1): perdeu a carga, e o jogo nao o poe em campo; se for reposto,
    // a cura (`ressurreicao`) roda antes, ele le codigo 3 aqui e recebe a lista de fabrica inteira.
    const estadoMaq = forma === 'veiculo' ? estadoDoBloco(u.bytes) : null;
    const dormente = forma === 'veiculo' && (!estadoMaq || estadoMaq.codigo === 1);
    // A CARGA (reset de fabrica, 28/09): quantidade exata no lugar, o que a fabrica nao poe SAI da
    // lista, e o que zerou volta na posicao da ordem de fabrica. Tudo planejado nas posicoes do bloco
    // original; cortes e insercoes sao aplicados depois, de tras para frente (`editarListas`).
    let cargaMexida = 0, cargaFaltando = [], cargaPlano = null;
    // por core id primeiro: a carga da formacao daquela unidade (01/10); senao, a do nome
    const querCarga = cargas?.[u.coreId] || cargas?.[nome];
    const alvoC = querCarga ? (('itens' in querCarga) ? querCarga.itens : querCarga) : null;
    const ordemC = querCarga?.ordem || Object.keys(alvoC || {}).map(Number);
    // sem item de paiol conhecido o `acharPaiol` nao devolve o rabo (o Ural: paiol vazio, so carga)
    const raboCarga = alvoC ? (achado.rabo || (() => { const l = semAninhadas(lerRabo(exp, u, forma, true)); return l.length === 1 ? l[0] : null; })()) : null;
    if (alvoC && raboCarga?.forma === 'veiculo' && !dormente) {
      const cortes = [];
      for (const s of raboCarga.carga) {
        const alvoQ = alvoC[s.item];
        if (alvoQ === undefined) { cortes.push({ item: s.item, qtd: s.qtd, p: s.p }); continue; }
        const alvo = Math.max(1, Math.min(65535, s.qtd + Math.round((Number(alvoQ) - s.qtd) * fracao)));
        if (alvo === s.qtd) continue;
        exp.writeUInt16LE(alvo, s.p + 2);
        cargaMexida++; antes += s.qtd; depois += alvo;
      }
      const ficam = raboCarga.carga.filter((s) => alvoC[s.item] !== undefined);
      const novosC = [];
      for (const item of Object.keys(alvoC).map(Number)) {
        if (raboCarga.carga.some((s) => s.item === item)) continue;
        const qtd = Math.min(65535, Math.round(Number(alvoC[item]) * fracao));
        if (!(qtd > 0)) continue;
        const k = ordemC.indexOf(item);
        const seguinte = k < 0 ? null : ficam.find((s) => ordemC.indexOf(s.item) > k);
        novosC.push({ item, qtd, p: seguinte ? seguinte.p : raboCarga.pm + 2 + 4 * raboCarga.m, ordem: k < 0 ? 999 : k });
      }
      novosC.sort((a, b) => a.p - b.p || a.ordem - b.ordem);
      if (cortes.length || novosC.length) {
        cargaPlano = { coreId: u.coreId, lista: 'carga', pn: raboCarga.pm, n: raboCarga.m, novos: novosC, cortes: cortes.map((c) => c.p), removidos: cortes, forma, itens };
        planos.push(cargaPlano);
      }
      cargaFaltando = [];
    }
    mexidos += cargaMexida;
    for (const s of achado) {
      if (!exato && s.tem >= s.max) continue;
      const alvo = exato
        ? Math.max(1, s.tem + Math.round((s.max - s.tem) * fracao))
        : Math.min(s.max, s.tem + Math.round((s.max - s.tem) * fracao));
      if (alvo === s.tem || alvo < 0 || alvo > 65535) continue;
      exp.writeUInt16LE(alvo, s.p + 2);
      mexidos++; antes += s.tem; depois += alvo;
    }
    // A ESCRITA NAO PODE MUDAR A FORMA DO RABO. Depois dela o bloco tem de se ler com o mesmo n, o
    // mesmo m e os mesmos itens — e a conferencia que teria pegado o `10` escrito no contador.
    if (mexidos && achado.rabo) {
      const depoisDaEscrita = acharPaiol(exp, u, itens, forma);
      const a = achado.rabo, b = depoisDaEscrita.rabo;
      const mesma = b && a.n === b.n && a.m === b.m && a.forma === b.forma
        && a.paiol.every((s, k) => b.paiol[k] && b.paiol[k].item === s.item && b.paiol[k].p === s.p);
      if (!mesma) throw new Error(`core ${u.coreId}: o reabastecimento mudou a forma da lista de municao (n ${a.n} -> ${b ? b.n : '?'}, m ${a.m} -> ${b ? b.m : '?'})`);
    }
    // O QUE ZEROU E SAIU DA LISTA volta por insercao (E41), planejada agora nas posicoes originais
    // e aplicada de tras para frente, como a `inserirMunicao` dos homens (E37).
    let novos = null, faltando = achado.faltando || [];
    if (faltando.length && achado.rabo && !dormente) {
      // a ordem de fabrica do paiol (quando veio) tambem e uma sequencia observada
      const seqsDele = [...(seqs[nome] || []), ...(querCarga?.paiolOrdem?.length ? [querCarga.paiolOrdem] : [])];
      novos = planoDeInsercao(achado.rabo, faltando, itens, seqsDele, fracao);
      if (novos) {
        planos.push({ coreId: u.coreId, lista: 'paiol', pn: achado.rabo.pn, n: achado.rabo.n, m: achado.rabo.m, forma, itens, novos, cortes: [] });
        faltando = faltando.filter((i) => !novos.some((x) => x.item === i));
      }
    }
    if (mexidos || novos || faltando.length || cargaPlano) {
      feitos.push({
        coreId: u.coreId, tipo: u.tipo, campos: mexidos, de: antes, para: depois, faltando, carga: cargaMexida, cargaFaltando,
        inseridos: novos ? novos.map((x) => ({ item: x.item, qtd: x.qtd })) : [],
        cargaInseridos: cargaPlano ? cargaPlano.novos.map((x) => ({ item: x.item, qtd: x.qtd })) : [],
        cargaRemovidos: cargaPlano ? cargaPlano.removidos.map((x) => ({ item: x.item, qtd: x.qtd })) : [],
      });
    }
  }

  const final = planos.length ? editarListas(exp, planos) : exp;
  const cresceu = planos.reduce((a, p) => a + 4 * (p.novos.length - p.cortes.length), 0);
  if (final.length !== exp.length + cresceu) throw new Error(`a edicao das listas mudou ${final.length - exp.length} bytes e devia mudar ${cresceu}`);

  const comp = comprimirLiterais(codificarComoJogo(final, b.esc));
  const t4 = Buffer.alloc(4); t4.writeUInt32LE(comp.length);
  const bruto = b.loc.anatomia.b;
  fs.writeFileSync(saida, Buffer.concat([bruto.subarray(0, b.loc.pos), t4, comp, bruto.subarray(b.loc.pos + 4 + b.loc.tam)]));

  // Conferencia no arquivo gravado: o roster continua sendo o mesmo roster, e cada lista que cresceu
  // se le de novo com o n certo, os itens novos dentro e a carga intacta.
  const a1 = lerRoster(caminho), a2 = lerRoster(saida);
  if (a1.soldados.length !== a2.soldados.length) throw new Error('o reabastecimento mudou o numero de homens');
  if (a1.unidades.length !== a2.unidades.length) throw new Error('o reabastecimento mudou o numero de unidades');
  const mexeu = a2.soldados.filter((s, i) => s.estado !== a1.soldados[i].estado);
  if (mexeu.length) throw new Error(`o reabastecimento mexeu no estado de ${mexeu.length} homens`);
  if (planos.length) {
    // Por MAQUINA: as duas listas podem mudar no mesmo bloco, e cada uma tem de ler com o seu contador.
    const g = blocosDoSave(saida);
    const gexp = Buffer.from(g.exp);
    const porCore = new Map();
    for (const pl of planos) { if (!porCore.has(pl.coreId)) porCore.set(pl.coreId, []); porCore.get(pl.coreId).push(pl); }
    for (const [coreId, pls] of porCore) {
      const u = g.unidades.find((x) => x.coreId === coreId);
      const base = pls[0];
      let r = u && acharPaiol(gexp, u, base.itens, base.forma).rabo;
      if (!r && u) { const l = semAninhadas(lerRabo(gexp, u, base.forma, true)); r = l.length === 1 ? l[0] : null; }
      const pa = pls.find((p) => p.lista === 'paiol'), ca = pls.find((p) => p.lista === 'carga');
      const n0 = pa ? pa.n : (ca ? null : null), m0 = ca ? ca.n : (pa ? pa.m : null);
      const nEsp = pa ? pa.n + pa.novos.length : null;
      const mEsp = ca ? ca.n + ca.novos.length - ca.cortes.length : m0;
      if (!r || (nEsp !== null && r.n !== nEsp) || (mEsp !== null && r.m !== mEsp)) {
        throw new Error(`core ${coreId}: depois da edicao o rabo le n=${r ? r.n : '?'} m=${r ? r.m : '?'}, esperava n=${nEsp ?? n0 ?? '-'} m=${mEsp ?? '-'}`);
      }
      for (const x of pa?.novos || []) {
        const s = r.paiol.find((y) => y.item === x.item);
        if (!s || s.qtd !== x.qtd) throw new Error(`core ${coreId}: o item ${x.item} nao esta no paiol gravado com ${x.qtd}`);
      }
      for (const x of ca?.novos || []) {
        const s = r.carga.find((y) => y.item === x.item);
        if (!s || s.qtd !== x.qtd) throw new Error(`core ${coreId}: o item ${x.item} nao esta na carga gravada com ${x.qtd}`);
      }
      for (const x of ca?.removidos || []) if (r.carga.some((y) => y.item === x.item)) throw new Error(`core ${coreId}: o item ${x.item} continua na carga`);
    }
  }

  const escritos = feitos.filter((f) => f.campos || f.inseridos.length || f.cargaInseridos.length || f.cargaRemovidos.length);
  return {
    unidades: escritos.length, campos: escritos.reduce((a, f) => a + f.campos, 0),
    municao: escritos.reduce((a, f) => a + (f.para - f.de) + f.inseridos.reduce((s, x) => s + x.qtd, 0), 0),
    detalhe: escritos, cresceu,
    inseridos: feitos.filter((f) => f.inseridos.length).map((f) => ({ coreId: f.coreId, itens: f.inseridos })),
    // O que zerou e nenhuma sequencia observada daquele veiculo cobre: fica de fora e no log, para
    // ninguem achar que "reabastecido" quer dizer "cheio".
    esgotados: feitos.filter((f) => f.faltando && f.faltando.length).map((f) => ({ coreId: f.coreId, itens: f.faltando })),
    cargaInseridos: feitos.filter((f) => f.cargaInseridos.length).map((f) => ({ coreId: f.coreId, itens: f.cargaInseridos })),
    cargaRemovidos: feitos.filter((f) => f.cargaRemovidos.length).map((f) => ({ coreId: f.coreId, itens: f.cargaRemovidos })),
  };
}

if (process.argv[1] && process.argv[1].endsWith('toe_veiculos.mjs')) {
  const c = colher();
  const tipos = apurar(c.porTipo);
  const nSlots = Object.values(tipos).reduce((a, v) => a + v.length, 0);
  console.log(`${c.lidos} saves, ${c.unidades} blocos de unidade`);
  console.log(`${Object.keys(tipos).length} tipos com paiol, ${nSlots} campos`);
  for (const [t, ss] of Object.entries(tipos).slice(0, 6)) {
    console.log(`   tipo ${t}: ${ss.map((s) => `item ${s.item} (d${s.d}) = ${s.max}`).join(' ')}`);
  }
  if (process.argv.includes('--gravar')) {
    fs.writeFileSync(TABELA, JSON.stringify({
      nota: 'Paiol por unidade: tipo -> campos, medidos de tras para frente a partir do `ff ff` que fecha o bloco. `d` e a distancia do item, a quantidade fica em d-2. `max` e a dotacao (o maior valor visto). So entram campos cujo id de item e o mesmo em todas as observacoes. Refazer com `node tools/re/toe_veiculos.mjs --gravar`.',
      saves: c.lidos, unidades: c.unidades, tipos,
    }, null, 1) + '\n');
    console.log(`-> ${TABELA}`);
  }
}
