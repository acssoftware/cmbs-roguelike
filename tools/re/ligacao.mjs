// LIGACAO unidade do .btt <-> equipe do save (secao 102). E o ultimo elo para a campanha: sem ela o
// relatorio de baixas fala em "time 53", com ela fala em "1st Squad (Rifle) do 1o pelotao".
//
// COMO OS IDS DE EQUIPE SAO ATRIBUIDOS. O jogo numera as unidades ATIVAS na ordem da arvore da forca
// (azul, depois vermelho), a partir de 1. Uma unidade que nao se divide (HQ Team, MG Team, veiculo)
// gasta UM id, que e o da sua equipe. Uma unidade que se divide em fireteams (esquadras) gasta um id
// de CONTAINER — que nao tem soldados e por isso aparece como buraco na lista de equipes — mais um
// id por fireteam. Na V2: buracos 1,4,10,13,16,22,25,28,34,37,40,52,55,58,67,70,73,82,85,88, e as
// 75 equipes preenchem o resto de 1..95. Unidades ausentes e off-map (obuses, aeronaves, drones) nao
// entram na numeracao.
//
// O QUE FECHA O ALINHAMENTO. Tres restricoes, e juntas dao solucao unica:
//   1. ordem preservada (unidades e ids crescem juntos);
//   2. ANCORAS: o registro do veiculo no save aponta o id da tripulacao (secao 101), e no .btt o
//      registro de veiculo se reconhece pela posicao em +30 (times: +28, secao 98.1);
//   3. CONSISTENCIA: unidades do mesmo tipo `(val, tab)` se dividem no mesmo numero de fireteams.
// A busca e um backtracking com poda por (2) e (3); a tabela de fireteams por tipo que ela descobre
// fica em `research/fireteams.json` e serve de atalho nas proximas batalhas.
//
//   node ligacao.mjs <batalha.btt> <save inicial> [save final]
import fs from 'node:fs';
import { abrirCompleto } from './anexar2.mjs';
import { posicaoNoCompleto } from './acrescentar.mjs';
import { arvore } from './extras.mjs';
import { lerSave, soldados, equipes, veiculos } from './saves.mjs';

const SV = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/';
const TABELA = new URL('../../research/fireteams.json', import.meta.url);
const cam = (a) => (/[\\/]/.test(a) ? a : SV + a + (/\.bts$/i.test(a) ? '' : '.bts'));

// Unidades ATIVAS do .btt na ordem da arvore, com o caminho de formacoes e se sao veiculo.
export function unidadesDoBtt(caminho) {
  const X = abrirCompleto(caminho); const c = X.completo, R = X.R; const A = arvore(X);
  const porOff = new Map(R.map((r, k) => [r.c, k]));
  const out = [];
  const anda = (n, trilha) => {
    if (!n.r.form) {
      if (n.r.ausente) return;
      const k = porOff.get(n.r.c); const p = posicaoNoCompleto(c, n.r, R[k + 1] ? R[k + 1].c : n.r.c + 80);
      const off = p ? p.o - n.r.c : null;
      const cat = c[n.r.c + 12];
      out.push({ id: n.r.id, nome: n.r.nm, val: n.r.val, tab: n.r.tab, cat, lado: A.azul.includes(topoDe(n)) ? 'azul' : 'vermelho',
        veiculo: off === 30, foraDoMapa: cat === 0x50 || cat === 0x58,   // artilharia e aviacao (secao 33) nao geram equipe
        offPos: off, caminho: trilha.join(' / '), rotulo: trilha[trilha.length - 1] || '' });
      return;
    }
    n.filhos.forEach((f) => anda(f, [...trilha, n.r.nm]));
  };
  let topoAtual = null; const topoDe = () => topoAtual;
  for (const t of [...A.azul, ...A.vermelho]) { topoAtual = t; anda(t, []); }
  return out;
}

// Backtracking: casa unidades (em ordem) com ids 1..max.
export function alinhar(unidades, equipesPorId, tripulacoes, max) {
  const ehEquipe = (id) => equipesPorId.has(id);
  const ehTrip = (id) => tripulacoes.has(id);
  const porTipo = new Map();                                   // (val,tab) -> nFireteams fixado
  const sol = [];
  const rec = (i, id) => {
    if (i === unidades.length) return id === max + 1;          // consumiu exatamente os ids 1..max
    const u = unidades[i]; const chave = `${u.val},${u.tab}`; const fixo = porTipo.get(chave);
    const tentar = (k) => {                                    // k = -1 nao gera equipe; 0 simples; >= 2 fireteams
      if (fixo !== undefined && fixo !== k) return false;
      let ids;
      if (k === -1) { if (!u.foraDoMapa) return false; ids = []; }
      else if (k === 0) { if (id > max || !ehEquipe(id)) return false; if (u.veiculo !== ehTrip(id)) return false; ids = [id]; }
      else { if (id + k > max || ehEquipe(id) || u.veiculo) return false;   // multi comeca no container (buraco)
        ids = []; for (let q = 1; q <= k; q++) { const j = id + q; if (!ehEquipe(j) || ehTrip(j)) return false; ids.push(j); } }
      const novo = fixo === undefined; if (novo) porTipo.set(chave, k);
      sol.push({ unidade: u, container: k > 0 ? id : null, equipes: ids });
      if (rec(i + 1, id + (k === -1 ? 0 : k === 0 ? 1 : k + 1))) return true;
      sol.pop(); if (novo) porTipo.delete(chave);
      return false;
    };
    for (const k of [0, 2, 3, 4, 5, -1]) if (tentar(k)) return true;
    return false;
  };
  // o id 1 pode ser o container da primeira unidade; comeca em 1
  return rec(0, 1) ? { sol, porTipo } : null;
}

// Alinhamento por PROGRAMACAO DINAMICA. O backtracking acima e exponencial no pior caso: numa
// batalha de pelotoes ele fecha na primeira tentativa, mas nos catalogos `ZZ US/RU ALL` (1637 e
// 1917 unidades, ids ate 2752) ele nao termina. Aqui a viabilidade e uma tabela (i, id) ->
// existe casamento de unidades[i..] a partir do id — n x max x 6 passos, ~19 M no catalogo US.
// A consistencia por tipo (unidades do mesmo (val,tab) se dividem no mesmo numero de fireteams)
// deixa de ser poda e vira PREFERENCIA na hora de reconstruir o caminho, mais um relatorio de
// ambiguidade: `unico` diz se em todo passo so havia uma transicao viavel.
export function alinharDP(unidades, equipesPorId, tripulacoes, max, { kMax = 6, estrito = true, prefixo = false } = {}) {
  const n = unidades.length, W = max + 2;
  const ehEquipe = (id) => equipesPorId.has(id);
  const ehTrip = (id) => tripulacoes.has(id);
  // A ancora do veiculo vale nos dois sentidos so quando o leitor de veiculos achou TODOS os
  // registros. Nos catalogos `ZZ ALL` ele acha 541 de 689 (US), entao no modo relaxado ela vale
  // num sentido so: um id de tripulacao exige unidade de veiculo, mas um veiculo pode nao ter
  // sido achado no save.
  const casaVeiculo = (u, j) => (estrito === 'nenhuma' ? true : estrito ? u.veiculo === ehTrip(j) : !(ehTrip(j) && !u.veiculo));
  // transicoes possiveis da unidade i a partir do id j, ignorando o futuro
  const passos = (i, j) => {
    const u = unidades[i], out = [];
    if (u.foraDoMapa) out.push({ k: -1, prox: j, ids: [] });
    if (j <= max && ehEquipe(j) && casaVeiculo(u, j)) out.push({ k: 0, prox: j + 1, ids: [j] });
    if ((estrito === 'nenhuma' || !u.veiculo) && j <= max && !ehEquipe(j)) {
      for (let k = 2; k <= kMax; k++) {
        if (j + k > max) break;
        const ids = []; let bom = true;
        for (let q = 1; q <= k; q++) { const id = j + q; if (!ehEquipe(id) || ehTrip(id)) { bom = false; break; } ids.push(id); }
        if (bom) out.push({ k, prox: j + k + 1, ids });
      }
    }
    return out;
  };
  const viavel = new Uint8Array((n + 1) * W);
  viavel[n * W + (max + 1)] = 1;                                 // consumiu tudo e parou no id max+1
  for (let i = n - 1; i >= 0; i--) {
    // `prefixo`: aceita parar antes do fim da arvore desde que os ids tenham acabado. Os catalogos
    // `ZZ ALL` precisam disso — depois de certo ponto vem material que nao vira equipe no save
    // (fortificacoes: o RU trava exatamente numa trincheira) ou que o jogo nao instanciou.
    if (prefixo) viavel[i * W + (max + 1)] = 1;
    for (let j = 1; j <= max + 1; j++)
      for (const p of passos(i, j)) if (p.prox <= max + 1 && viavel[(i + 1) * W + p.prox]) { viavel[i * W + j] = 1; break; }
  }
  if (!viavel[1]) return null;                                   // i=0, j=1
  const porTipo = new Map(); const sol = []; let unico = true;
  let j = 1, i = 0;
  for (; i < n; i++) {
    const u = unidades[i]; const chave = `${u.val},${u.tab}`;
    const ok = passos(i, j).filter((p) => p.prox <= max + 1 && viavel[(i + 1) * W + p.prox]);
    if (!ok.length) { if (prefixo && j === max + 1) break; return null; }
    if (ok.length > 1) unico = false;
    const fixo = porTipo.get(chave);
    const p = (fixo !== undefined && ok.find((x) => x.k === fixo)) || ok[0];
    if (fixo === undefined) porTipo.set(chave, p.k);
    sol.push({ unidade: u, container: p.k > 0 ? j : null, equipes: p.ids });
    j = p.prox;
  }
  return { sol, porTipo, unico, consumidas: i, total: n };
}

export function ligar(btt, saveIni, saveFim = null) {
  const unidades = unidadesDoBtt(btt);
  const cIni = lerSave(cam(saveIni)).completo;
  const Si = soldados(cIni), Ei = equipes(cIni, Si), Vi = veiculos(cIni, Si);
  const porId = new Map(Ei.map((e) => [e.id, e]));
  const trip = new Set(Vi.filter((v) => v.achado).map((v) => v.time));
  const max = Math.max(...Ei.map((e) => e.id));
  const r = alinhar(unidades, porId, trip, max);
  if (!r) throw new Error(`nao consegui alinhar ${unidades.length} unidades com ${Ei.length} equipes (ids 1..${max})`);
  // estado final (baixas): equipes e veiculos do save final, casados pelo mesmo id
  let Ef = null, Vf = null;
  if (saveFim) { const cF = lerSave(cam(saveFim)).completo; const Sf = soldados(cF); Ef = new Map(equipes(cF, Sf).map((e) => [e.id, e])); Vf = new Map(veiculos(cF, Sf).filter((v) => v.achado).map((v) => [v.time, v])); }
  const linhas = r.sol.map((x) => {
    const eqIni = x.equipes.map((id) => porId.get(id));
    const homens = eqIni.reduce((t, e) => t + e.n, 0);
    const eqFim = Ef ? x.equipes.map((id) => Ef.get(id)).filter(Boolean) : [];
    const baixas = eqFim.reduce((t, e) => t + e.baixas, 0);
    const socorridos = eqFim.reduce((t, e) => t + (e.socorridos || 0), 0);
    const turnos = [...new Set(eqFim.flatMap((e) => e.turnos))].sort((a, b) => a - b);
    const veic = Vf && x.unidade.veiculo ? Vf.get(x.equipes[0]) : null;
    return { ...x.unidade, container: x.container, equipes: x.equipes, homens, baixas: Ef ? baixas : null, socorridos: Ef ? socorridos : null, turnos,
      aniquilada: Ef ? eqFim.length > 0 && eqFim.every((e) => e.aniquilado) : null,
      estadoVeiculo: veic ? (veic.destruido ? 'DESTRUIDO' : veic.imobilizado ? 'IMOBILIZADO' : 'ok') : null,
      impactos: veic ? veic.impactos : null, tripulacaoFora: veic ? !veic.aBordo : null };
  });
  return { linhas, porTipo: r.porTipo, unidades: unidades.length, equipes: Ei.length, max };
}

// Relatorio em markdown: como cada unidade do .btt terminou.
export function relatorioPorUnidade(btt, ini, fim, titulo) {
  const r = ligar(btt, ini, fim); const L = [];
  const tot = r.linhas.reduce((t, l) => ({ h: t.h + l.homens, b: t.b + (l.baixas || 0) }), { h: 0, b: 0 });
  L.push(`# ${titulo}`, '');
  L.push(`${r.linhas.length} unidades ativas, ${tot.h} homens, ${tot.b} baixas.`, '');
  L.push('Unidade e id vêm do `.btt`; baixas, turnos e estado do veículo vêm do save (secoes 100-102).');
  L.push('Morto x ferido x desaparecido o CM decide no fim da partida e nao esta no arquivo (secao 100).', '');
  let cam = null;
  for (const l of r.linhas) {
    if (l.caminho !== cam) { L.push('', `## ${l.caminho}`, '', '| id | unidade | homens | baixas | turnos | estado |', '|---|---|---|---|---|---|'); cam = l.caminho; }
    const est = l.estadoVeiculo && l.estadoVeiculo !== 'ok' ? `**${l.estadoVeiculo}**${l.tripulacaoFora ? ' (tripulacao fora)' : ''}${l.impactos?.length ? ' — ' + [...new Set(l.impactos)].join(', ') : ''}`
      : l.aniquilada ? '**ANIQUILADA**' : l.homens === 0 ? 'fora do mapa' : 'ok';
    L.push(`| ${l.id} | ${l.nome || '?'} | ${l.homens} | ${l.baixas ?? '-'} | ${l.turnos.join(', ') || '-'} | ${est} |`);
  }
  return L.join('\n');
}

const EH_MAIN = process.argv[1] && /[\\/]ligacao\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const [btt, ini, fim, md] = process.argv.slice(2);
  if (!ini) { console.log('uso: node ligacao.mjs <batalha.btt> <save inicial> [save final] [saida.md]'); process.exit(1); }
  if (md) { fs.writeFileSync(md, relatorioPorUnidade(btt, ini, fim, `${btt.split(/[\\/]/).pop().replace(/\.btt$/i, '')} — como cada unidade terminou`)); console.log('escrito', md); process.exit(0); }
  const r = ligar(btt, ini, fim);
  console.log(`${r.unidades} unidades ativas, ${r.equipes} equipes (ids 1..${r.max}); tipos que se dividem: ` +
    [...r.porTipo].filter(([, k]) => k).map(([t, k]) => `${t}->${k}`).join(' ') + '\n');
  let camAnt = null;
  for (const l of r.linhas) {
    if (l.caminho !== camAnt) { console.log(`\n${l.caminho}`); camAnt = l.caminho; }
    const est = l.estadoVeiculo && l.estadoVeiculo !== 'ok' ? `  ** ${l.estadoVeiculo}${l.tripulacaoFora ? ' (tripulacao fora)' : ''}${l.impactos?.length ? ' [' + l.impactos.join(',') + ']' : ''}` : '';
    const bx = l.baixas === null ? '' : `  ${l.baixas}/${l.homens} baixas${l.socorridos ? ' (' + l.socorridos + ' socorridas)' : ''}${l.aniquilada ? ' [ANIQUILADA]' : ''}${l.turnos.length ? ' T' + l.turnos.join(',T') : ''}`;
    console.log(`  id ${String(l.id).padStart(3)} ${(l.nome || '?').slice(0, 46).padEnd(47)} equipes ${l.equipes.join(',').padEnd(7)}${bx}${est}`);
  }
  if (!fs.existsSync(TABELA)) { fs.writeFileSync(TABELA, JSON.stringify(Object.fromEntries([...r.porTipo]), null, 1)); console.log('\n(tabela de fireteams por tipo gravada em research/fireteams.json)'); }
}
