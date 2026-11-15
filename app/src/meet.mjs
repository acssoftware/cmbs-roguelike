// O ENCONTRO (Meeting Engagement, autor 12/10/2026): a IA azul ATACA os mesmos objetivos que o jogador.
//
// A forca dela nao e uma defesa. Ela e comprada por papeis de ataque — tanques (a ponta de lanca), blindados leves,
// reconhecimento, infantaria mecanizada, equipes e AA — com as fatias de `rules.meet.shares`, na ordem de
// `rules.meet.order`, e a sobra de um balde desce para o seguinte. O orcamento e o total que a defesa daquela batalha
// teria (`tierBudgets`), entao a recompensa continua seguindo a mesma curva.
//
// NINGUEM A PE NO SETUP. O jogo embarca as equipes nos veiculos do MESMO pelotao-folha quando o app nao as desmonta
// (E17, FORMATO 112.11), entao "montado" e uma questao de compra: esquadra so vem num pelotao com os seus blindados
// de transporte (`carriers`), equipe so vem com o veiculo organico do pelotao (HMMWV e caminhao aceitos), e o app nao
// chama `dismountSide` num encontro. Tanques, leves, reconhecimento e AA autopropulsada sao comprados um a um; quando
// um deles vive num pelotao com equipes (o M3A3 com a Squad (Scout), o BRDM-2 com os Recon Teams), as equipes ficam
// mascaradas no arquivo (`pruneSpec`) — e o "veiculo sem passageiros" que o autor pediu.
//
// Determinista pela semente, e cada decisao vai para o log, como a defesa.
import fs from 'node:fs';
import path from 'node:path';
import { paths } from './settings.mjs';
import { formationTree, priceUnits, roleOf, libFormations, authoredPlan } from './catalog.mjs';
import { rng, tierOf, tierBudgets, pruneSpec, poolOf, airObserverSection } from './defense.mjs';
import { decodeAiRegion, writeAiRegion, encodeAiRegion, AI_PLAN_USE, aiFileVersion, mapPieces } from './re.mjs';

// `support` (14/10): morteiro, artilharia e aereo FORA do mapa, do pool da defesa (defense.poolOf, bucket offMap)
export const MEET_BUCKETS = ['tanks', 'light', 'recon', 'mech', 'teams', 'aa', 'support'];

const OFF_MAP_NAME = /^\d+ x /;
const VEHICLE_NAME = /\bVehicle\b|\bCarrier\b|\bDestroyer\b|\bTank\b|Antiaircraft|HMMWV|Stryker|Bradley|BTR-|BMP-|MT-LB|BRDM|BRM-|Truck|Tigr|Ural|KamAZ|LMTV|MTVR|Observer \(/i;
const NON_COMBAT_VEHICLE = /\bCommand\b|Observation|Support Vehicle|Fire Support Vehicle|Ambulance|Recovery|Medical|Cargo/i;
const AIR_SOURCE = /\((Su-|Mi-|KA-|AH-|F-|MQ-|RQ-)|Orlan|Pchela|Zala|Raven|Shadow|Gray Eagle|Apache|Fencer|Frogfoot|Fullback|Havoc|Hind|Alligator|Falcon|Eagle/;

const re = (s) => new RegExp(s, 'i');
const listed = (lista, name, { tierN = null, source = null, leafNames = null } = {}) => (lista || []).some((e) =>
  re(e.match).test(name) && (tierN === null || (e.tiers || []).includes(tierN)) && (source === null || !e.sources || e.sources.includes(source))
  && (leafNames === null || !e.needsTeam || leafNames.some((n) => re(e.needsTeam).test(n))));

// O PAPEL DE UMA UNIDADE NO ENCONTRO. Com `tierN`/`source`/`leafNames` e a classificacao da compra (as listas por
// tier e por arquivo valem); sem eles e a de quem so tem o nome (a hora da batalha: a unidade ja foi permitida).
// tank | light | recon | aaVehicle | carrier | ride | squad | hq | team | aaTeam | never
export function papelEncontro(name, rules, { nation = null, tierN = null, source = null, leafNames = null, offMap = false, roleApp = null } = {}) {
  const M = rules.meet;
  if (offMap || OFF_MAP_NAME.test(name)) return 'never';
  // o que o exercito nao leva ao encontro (autor, 06/11: o canhao anticarro ucraniano, lento demais para atacar)
  if (nation && M.excludeByNation?.[nation] && re(M.excludeByNation[nation]).test(name)) return 'never';
  const nations = nation ? [nation] : Object.keys(M.tanks || {});
  const em = (tabela) => nations.some((n) => listed(tabela?.[n], name, { tierN, source, leafNames }));
  const role = roleApp || roleOf(name, false, rules);
  const veiculo = VEHICLE_NAME.test(name) || ['tank', 'ifv', 'apc', 'aa', 'truck'].includes(role);
  if (veiculo && /Mortar/i.test(name)) return 'never';
  if (em(M.light)) return 'light';
  if (em(M.recon)) return 'recon';
  if (em(M.tanks)) return 'tank';
  if (role === 'tank') return 'never';
  if (veiculo && re(M.aaVehicles).test(name)) return 'aaVehicle';
  if (veiculo && NON_COMBAT_VEHICLE.test(name)) return 'never';
  if (veiculo && re(M.carriers).test(name)) return 'carrier';
  if (veiculo && re(M.teamRides).test(name)) return 'ride';
  if (veiculo) return 'never';
  if (role === 'hq') return 'hq';
  if (role === 'manpads') return 'aaTeam';
  // o controlador aereo (02/11) nao se compra: vem de graca com a aviacao (planMeetForce)
  if (rules.defense.airObservers?.names && re(rules.defense.airObservers.names).test(name)) return 'never';
  if ((role === 'infantry' || role === 'engineer') && /Squad/i.test(name)) return 'squad';
  if ((M.teamRoles || []).includes(role) || re(M.teamNames).test(name)) return /Mortar/i.test(name) ? 'never' : 'team';
  return 'never';
}

// A SECAO DO CONTROLADOR AEREO (02/11): um pelotao com um nome de `defense.airObservers.names` e a secao que veio de
// graca com a aviacao; ela e o jipe dela tem o papel 'obs', que os grupos do encontro mandam para o resto (G16).
const ehControlador = (nomes, rules) => !!rules.defense.airObservers?.names && (nomes || []).some((n) => re(rules.defense.airObservers.names).test(n));

// Quantas equipes um veiculo leva (`rules.meet.seats`: regex -> lugares, o primeiro que casa; padrao 1).
export function seatsOf(name, rules) {
  for (const [rx, n] of rules.meet.seats || []) if (re(rx).test(name)) return n;
  return 1;
}

// O balde de cada papel (o que a unidade gasta). O HQ de um pelotao vem de graca.
const BALDE = { tank: 'tanks', light: 'light', recon: 'recon', aaVehicle: 'aa', carrier: 'mech', ride: 'teams', squad: 'mech', hq: 'mech', team: 'teams', aaTeam: 'aa' };
const VEICULO = new Set(['tank', 'light', 'recon', 'aaVehicle', 'carrier', 'ride']);
const SOZINHO = new Set(['tank', 'light', 'recon', 'aaVehicle', 'offMap']);

// O POOL DO ENCONTRO: a mesma varredura da defesa (id `fonte|chave`, pai, ordinal), com os papeis do encontro, e os
// LOTES por pelotao-folha. Lote `mech`: 2+ esquadras e 1+ blindado de transporte, o pelotao inteiro (a pe e todos os
// veiculos, para cada esquadra ter assento). Lote de equipes: equipes com pelo menos um veiculo no pelotao. O balde
// de um lote e o que ele mais gasta; um ride vai para o balde das equipes que leva.
export function meetPoolOf(nation, tierN, rules) {
  const semXP = { ignoreExperience: !rules.units.experiencePricing?.enemy };
  const sources = [];
  for (const f of libFormations(nation)) {
    if (AIR_SOURCE.test(f.source)) continue;
    let tree; try { tree = formationTree(f.file); } catch { continue; }
    const units = [], lots = [];
    const walk = (node) => {
      if (!node.isFormation) return;
      const proprias = node.children.filter((c) => !c.isFormation);
      // EXCECAO (rules.meet.mechExceptions, autor 12/10): o pelotao entra como mecanizado com os seus HMMWV/Tigr — as
      // esquadras (inclusive as de recon) sao esquadras e os veiculos sao o transporte delas, so nas batalhas listadas
      const excecao = (rules.meet.mechExceptions?.[nation] || []).find((e) => e.source === f.source && re(e.leaf).test(node.name)) || null;
      const leafNames = proprias.map((c) => c.name);
      const folha = !node.children.some((c) => c.isFormation);
      const mine = [];
      let ordinal = 0;
      for (const c of proprias) {
        ordinal++;
        const organico = (c.path || []).includes(603) || (c.type && c.type[0] === 58 && c.type[1] === 0) || c.organic;
        const papel0 = organico ? 'never' : papelEncontro(c.name, rules, { nation, tierN, source: f.source, leafNames, offMap: c.offMap });
        let papel = papel0;
        if (excecao && !organico) {
          if (/Squad \(Command\)|Headquarters/i.test(c.name)) papel = 'hq';
          else if (/Squad/i.test(c.name)) papel = 'squad';
          else if (papel === 'ride' || papel === 'recon' || papel === 'light') papel = 'carrier';
        }
        const u = {
          id: `${f.source}|${c.key}`, key: c.key, name: c.name, type: c.type, papel, bucket: BALDE[papel] || 'never',
          price: priceUnits([{ name: c.name, offMap: c.offMap, type: c.type }], nation, rules, semXP).total,
          source: f.source, parent: node.name, leaf: `${f.source}|${node.key}`, ordinal, lot: null,
        };
        units.push(u); mine.push(u);
        // o Tigr (MG) do pelotao de excecao continua sendo o reconhecimento avulso do tier 1: um gemeo com o papel de
        // sempre, o mesmo id (comprar um exclui o outro)
        if (papel !== papel0 && SOZINHO.has(papel0)) units.push({ ...u, papel: papel0, bucket: BALDE[papel0], gemeoDe: u });
      }
      // um pelotao de morteiro ou de artilharia nao entra no encontro: sem o tubo sobravam o observador e o caminhao
      if (folha && mine.length && !/Mortar|Artillery|Howitzer/i.test(node.name)) {
        const vale = mine.filter((u) => u.papel !== 'never' && u.papel !== 'tank' && u.papel !== 'aaVehicle');
        const squads = vale.filter((u) => u.papel === 'squad'), carriers = vale.filter((u) => u.papel === 'carrier');
        const equipes = vale.filter((u) => u.papel === 'team' || u.papel === 'aaTeam');
        const veics = vale.filter((u) => VEICULO.has(u.papel));
        let tipo = null;
        if (squads.length >= 2 && carriers.length >= 1) tipo = 'mech';
        else if (!squads.length && equipes.length && veics.length) tipo = equipes.every((u) => u.papel === 'aaTeam') ? 'aa' : 'teams';
        // ASSENTOS (autor, 12/10: "as equipes sem anexo ficaram desmontadas"): o jogo embarca pela lotacao do veiculo ao
        // carregar, e o Platoon (Scout) do Cavalry Squadron tem HQ + observador para UM HMMWV — o observador ficava a pe.
        // Num lote de equipes, cada veiculo leva `seatsOf` equipes; o que nao couber nao e comprado (o HQ sai primeiro).
        if (tipo && tipo !== 'mech') {
          let lugares = veics.reduce((a, u) => a + seatsOf(u.name, rules), 0);
          const ape = vale.filter((u) => !VEICULO.has(u.papel)).sort((a, b) => (a.papel === 'hq') - (b.papel === 'hq'));
          const fora = new Set(ape.filter(() => lugares-- <= 0).map((u) => u.id));
          for (let k = vale.length - 1; k >= 0; k--) if (fora.has(vale[k].id)) vale.splice(k, 1);
          if (!vale.some((u) => u.papel === 'team' || u.papel === 'aaTeam')) tipo = null;
        }
        if (tipo) {
          const pagos = vale.filter((u) => u.papel !== 'hq' || rules.meet.freeHeadquarters === false);
          const spend = {};
          for (const u of pagos) {
            const b = tipo === 'mech' ? (u.papel === 'team' ? 'teams' : u.papel === 'aaTeam' ? 'aa' : 'mech') : u.papel === 'light' || u.papel === 'recon' ? u.bucket : tipo;
            spend[b] = (spend[b] || 0) + u.price;
          }
          const home = Object.entries(spend).sort((a, b) => b[1] - a[1])[0]?.[0] || tipo;
          const lot = {
            id: `${f.source}|lot|${node.key}`, key: node.key, name: node.name, occurrence: node.occurrence, source: f.source, tipo, home,
            units: vale, spend, price: Object.values(spend).reduce((a, v) => a + v, 0), full: vale.reduce((a, u) => a + u.price, 0),
            squads: squads.length, seats: carriers.length, ...(excecao ? { battles: excecao.battles } : {}),
          };
          for (const u of vale) u.lot = lot;
          lots.push(lot);
        }
      }
      node.children.forEach(walk);
    };
    tree.roots.forEach(walk);
    if (units.some((u) => SOZINHO.has(u.papel)) || lots.length) sources.push({ f, tree, units, lots });
  }
  return sources;
}

// QUANTOS EM CADA FLANCO (A esquerda, B centro, C direita do atacante): o centro recebe primeiro (autor: "quem recebe
// unidades primeiro e sempre Centro"), e o resto vai alternando entre os flancos, comecando pelo de maior fatia.
// Um flanco so recebe quando a fatia dele arredonda para uma unidade inteira (2 tanques no balanced: os dois no centro).
export function repartirABC(n, shares = { A: 0.2, B: 0.6, C: 0.2 }) {
  if (n <= 0) return { A: 0, B: 0, C: 0 };
  let A = Math.round(n * shares.A), C = Math.round(n * shares.C), B = n - A - C;
  while (B < 1) { if (A >= C && A > 0) A--; else C--; B++; }
  return { A, B, C };
}

// OS GRUPOS DE IA DO ENCONTRO (tools/re/ia_encontro.mjs escreve as ordens deles):
//   G1-3 tanques A/B/C | G4-6 leves A/B/C | G7-9 reconhecimento A/B/C | G10-12 mecanizada A/B/C | G13 equipes |
//   G14 AA | G15 livre | G16 o resto (HQ solto, fora do mapa).
// O pelotao mecanizado vai INTEIRO para um grupo (esquadras, HQ e os seus veiculos: o jogo embarca pelo pelotao);
// a equipe de um pelotao cujo unico veiculo e um leve ou um recon (o Platoon (Assault) do tier 1) vai com o veiculo.
// `shares` e a receita A/B/C da variante sorteada (rules.meet.variants), o centro primeiro.
export const MEET_GROUPS = { tanks: [1, 2, 3], light: [4, 5, 6], recon: [7, 8, 9], mech: [10, 11, 12], teams: 13, aa: 14, spare: 15, rest: 16 };
// OS PAPEIS DO ENCONTRO de cada unidade viva (`u.papelEncontro`), por papel e por pelotao (`pai`). Os irmaos do
// pelotao contam (`needsTeam`), inclusive os mascarados: o HMMWV comprado sozinho do Platoon (Assault) continua do Standard.
function marcarPapeis(unidades, rules) {
  const vivas = unidades.filter((u) => !u.ausente);
  const porPapel = {};
  const porPai = new Map(); for (const u of vivas) { if (!porPai.has(u.pai)) porPai.set(u.pai, []); porPai.get(u.pai).push(u); }
  const nomesDoPai = new Map(); for (const u of unidades) { if (!nomesDoPai.has(u.pai)) nomesDoPai.set(u.pai, []); nomesDoPai.get(u.pai).push(u.nome); }
  for (const u of vivas) {
    u.papelEncontro = u.foraDoMapa ? 'foraDoMapa' : papelEncontro(u.nome, rules, { leafNames: nomesDoPai.get(u.pai) || [] });
    // a esquadra de recon do pelotao de excecao (rules.meet.mechExceptions) e esquadra: so ela entra montada
    if (u.papelEncontro === 'never' && /Squad/i.test(u.nome)) u.papelEncontro = /Command/i.test(u.nome) ? 'hq' : 'squad';
    // o controlador aereo (02/11) e o jipe dele ficam juntos, no fundo com o resto
    if (ehControlador(nomesDoPai.get(u.pai), rules)) u.papelEncontro = 'obs';
    (porPapel[u.papelEncontro] ||= []).push(u);
  }
  return { vivas, porPapel, porPai };
}
const VEIC_PELOTAO = ['carrier', 'ride', 'recon', 'light'];
// o pelotao com esquadras e veiculos e mecanizado (inclusive os de excecao, cujo transporte e HMMWV ou Tigr); do mais caro ao mais barato
function pelotoesMec(porPai, preco) {
  const mech = [...porPai.values()].filter((us) => us.some((u) => u.papelEncontro === 'squad') && us.some((u) => VEIC_PELOTAO.includes(u.papelEncontro)));
  const custo = (us) => us.reduce((a, u) => a + (preco(u.nome) || 0), 0);
  return mech.sort((a, b) => custo(b) - custo(a));
}
// o que sobrou: fora do mapa e o resto; AA; a equipe, o HQ e o transporte deles (num pelotao sem ride proprio, vao com
// o leve/recon do pelotao). `G` = { rest, aa, teams, teamVeh? }; sem teamVeh o transporte vai com as equipes.
function caudaGrupos(vivas, porPai, grupo, G) {
  for (const u of vivas) {
    if (grupo.has(u.id)) continue;
    const p = u.papelEncontro;
    if (p === 'foraDoMapa') { grupo.set(u.id, G.rest); continue; }
    if (p === 'aaVehicle' || p === 'aaTeam') { grupo.set(u.id, G.aa); continue; }
    const irmaos = porPai.get(u.pai) || [];
    if (p === 'team' || p === 'hq' || p === 'ride' || p === 'carrier') {
      const temRide = irmaos.some((x) => x.papelEncontro === 'ride' || x.papelEncontro === 'carrier');
      const veic = irmaos.find((x) => grupo.has(x.id) && ['light', 'recon'].includes(x.papelEncontro));
      if (!temRide && veic) { grupo.set(u.id, grupo.get(veic.id)); continue; }
      if (irmaos.some((x) => x.papelEncontro === 'aaTeam')) { grupo.set(u.id, G.aa); continue; }
      if (G.teamVeh && (p === 'ride' || p === 'carrier')) { grupo.set(u.id, G.teamVeh); continue; }
      grupo.set(u.id, p === 'hq' && !irmaos.some((x) => x.papelEncontro === 'team') ? G.rest : G.teams);
      continue;
    }
    grupo.set(u.id, G.rest);
  }
}
const relatorio = (grupo, vivas, porPapel) => ({
  grupo, vivas, infantaria: new Set(),
  porPapel: Object.fromEntries(Object.entries(porPapel).map(([k, v]) => [k, v.map((u) => u.nome)])),
  blindados: vivas.filter((u) => ['tank', 'light', 'recon'].includes(u.papelEncontro)).map((u) => ({ nome: u.nome, grupo: grupo.get(u.id) })),
});

// O ASSALTO DIRETO (mapa pequeno, rules.meet.assault): o pelotao mecanizado se DIVIDE: esquadras e HQ num grupo,
// os veiculos noutro (o "01 teste" do autor: o IFV desmonta a esquadra e segue sozinho; o jogo embarca pelo pelotao,
// nao pelo grupo). Pelotoes do mais caro ao mais barato: 1o ao centro (parcela 1), 2o ao flanco (parcela 2), 3o ao
// centro... O flanco da parcela 2 e o da variante (A, C ou alternando). Leves: metade escolta os tanques, metade guarda
// o flanco. Tanques, reconhecimento, equipes, AA e o resto nos seus grupos. `grupos` = a tabela do registro do mapa.
export function meetGroupsAssault(unidades, { rules, variant, preco = () => 0, grupos = null }) {
  const A = rules.meet.assault, G = grupos || A.groups;
  const flancos = (A.variants[variant]?.flank || 'AC').split('');
  const { vivas, porPapel, porPai } = marcarPapeis(unidades, rules);
  const grupo = new Map();
  let nLonge = 0;
  pelotoesMec(porPai, preco).forEach((us, k) => {
    let gv, gi;
    if (k % 2 === 0) { gv = G.centreVeh; gi = G.centreInf; }
    else { const f = flancos[nLonge++ % flancos.length]; gv = G['farVeh' + f]; gi = G['farInf' + f]; }
    for (const u of us) grupo.set(u.id, VEIC_PELOTAO.includes(u.papelEncontro) ? gv : gi);
  });
  for (const u of porPapel.tank || []) if (!grupo.has(u.id)) grupo.set(u.id, G.tanks);
  for (const u of porPapel.recon || []) if (!grupo.has(u.id)) grupo.set(u.id, G.recon);
  const leves = (porPapel.light || []).filter((u) => !grupo.has(u.id)).sort((a, b) => (preco(b.nome) || 0) - (preco(a.nome) || 0));
  let nGuarda = 0;
  leves.forEach((u, k) => grupo.set(u.id, k % 2 === 0 ? G.escort : G['guard' + flancos[nGuarda++ % flancos.length]]));
  caudaGrupos(vivas, porPai, grupo, G);
  return relatorio(grupo, vivas, porPapel);
}

// A DOUTRINA DE TERRENO ABERTO (rules.meet.aberto, Open-Rural 306): a alocacao nao depende da variante (as ordens e que
// mudam de lado). Pelotoes mecanizados do mais caro ao mais barato alternam parcela 1 (casas do objetivo: centreVeh/
// centreInf) e parcela 2 (floresta: forestVeh/forestInf); um pelotao so vai ao objetivo; dentro dele os veiculos
// num grupo, esquadras e HQ no outro. Tanques e recon (cada um com o seu contador) alternam tanksA/tanksC, o mais caro
// primeiro; leves alternam vigia (lightOver) e flanco (lightFlank); o transporte das equipes vai ao teamVeh, elas ao teams.
export function meetGroupsAberto(unidades, { rules, preco = () => 0, grupos = null }) {
  const G = grupos || rules.meet.aberto.groups;
  const { vivas, porPapel, porPai } = marcarPapeis(unidades, rules);
  const grupo = new Map();
  pelotoesMec(porPai, preco).forEach((us, k) => {
    const [gv, gi] = k % 2 === 0 ? [G.centreVeh, G.centreInf] : [G.forestVeh, G.forestInf];
    for (const u of us) grupo.set(u.id, VEIC_PELOTAO.includes(u.papelEncontro) ? gv : gi);
  });
  const caros = (papel) => (porPapel[papel] || []).filter((u) => !grupo.has(u.id)).sort((a, b) => (preco(b.nome) || 0) - (preco(a.nome) || 0));
  caros('tank').forEach((u, k) => grupo.set(u.id, k % 2 === 0 ? G.tanksA : G.tanksC));
  caros('recon').forEach((u, k) => grupo.set(u.id, k % 2 === 0 ? G.tanksA : G.tanksC));
  caros('light').forEach((u, k) => grupo.set(u.id, k % 2 === 0 ? G.lightOver : G.lightFlank));
  caudaGrupos(vivas, porPai, grupo, G);
  return relatorio(grupo, vivas, porPapel);
}

// a doutrina do registro -> o bloco dela em rules.meet ('assalto' mora em rules.meet.assault)
export const doctrineRules = (rules, doutrina) => (doutrina ? rules.meet[{ assalto: 'assault', aberto: 'aberto', posicional: 'posicional', roteiro: 'roteiro' }[doutrina]] || null : null);

// A DOUTRINA POSICIONAL (rules.meet.posicional, 024r): pelotoes mecanizados do mais caro ao mais barato alternam o grupo
// vermelho (redVeh/redInf) e o amarelo (yellowVeh/yellowInf); um pelotao so vai ao vermelho; dentro dele os veiculos num
// grupo, esquadras e HQ no outro. Tanques e recon juntos no G de tanques; leves na linha verde; equipes com o seu
// transporte; AA; resto e fora do mapa no resto. Nao depende da variante.
export function meetGroupsPosicional(unidades, { rules, preco = () => 0, grupos = null }) {
  const G = grupos || rules.meet.posicional.groups;
  const { vivas, porPapel, porPai } = marcarPapeis(unidades, rules);
  const grupo = new Map();
  pelotoesMec(porPai, preco).forEach((us, k) => {
    const [gv, gi] = k % 2 === 0 ? [G.redVeh, G.redInf] : [G.yellowVeh, G.yellowInf];
    for (const u of us) grupo.set(u.id, VEIC_PELOTAO.includes(u.papelEncontro) ? gv : gi);
  });
  for (const p of ['tank', 'recon']) for (const u of porPapel[p] || []) if (!grupo.has(u.id)) grupo.set(u.id, G.tanks);
  for (const u of porPapel.light || []) if (!grupo.has(u.id)) grupo.set(u.id, G.lightOver);
  caudaGrupos(vivas, porPai, grupo, G);
  return relatorio(grupo, vivas, porPapel);
}

// O ROTEIRO (autor 14/10, 018r): a alocacao vem do registro do mapa (`alocacao`, nomes de grupo do `grupos`). `mech` =
// lista de parcelas [veiculos, esquadras]: os pelotoes do mais caro ao mais barato alternam entre elas (um pelotao so
// vai a primeira); tank/recon/light = um grupo ou uma lista (alternam, o mais caro primeiro, contador por papel); team e
// ride = os grupos das equipes e do transporte delas (iguais = juntos); aa, rest.
export function meetGroupsRoteiro(unidades, { rules, preco = () => 0, grupos, alocacao }) {
  if (!grupos || !alocacao) throw new Error('the roteiro doctrine needs the map registry groups and allocation');
  const num = (nome) => { const n = grupos[nome]; if (!n) throw new Error(`roteiro: group ${nome} has no number`); return n; };
  const { vivas, porPapel, porPai } = marcarPapeis(unidades, rules);
  const grupo = new Map();
  const parcelas = (alocacao.mech || []).map(([v, i]) => [num(v), num(i)]);
  // `mechShares` (16/10, 313: 60/40): cada pelotao, do mais caro ao mais barato, vai a parcela com a maior cota
  // restante (share * n - ja alocados); empate, a primeira. Sem ela, alternando.
  const pelotoes = parcelas.length ? pelotoesMec(porPai, preco) : [];
  const cotas = alocacao.mechShares && alocacao.mechShares.length === parcelas.length ? alocacao.mechShares : null;
  const ja = parcelas.map(() => 0);
  pelotoes.forEach((us, k) => {
    let p = k % parcelas.length;
    if (cotas) { const n = pelotoes.length; let melhor = -Infinity; cotas.forEach((s, q) => { const resta = s * n - ja[q]; if (resta > melhor + 1e-9) { melhor = resta; p = q; } }); }
    ja[p]++;
    const [gv, gi] = parcelas[p];
    for (const u of us) grupo.set(u.id, VEIC_PELOTAO.includes(u.papelEncontro) ? gv : gi);
  });
  // `armour: { grupos, shares }` (17/10, 012r: "20 % da forca, 40 % e 40 %"): tanques, recon e leves juntos, do mais caro
  // ao mais barato, cada um ao grupo com a maior cota restante por CONTAGEM (share * n - ja alocados; empate, o primeiro)
  if (alocacao.armour) {
    const gs = alocacao.armour.grupos.map(num), cotas = alocacao.armour.shares;
    const blind = ['tank', 'recon', 'light'].flatMap((p) => porPapel[p] || []).filter((u) => !grupo.has(u.id)).sort((a, b) => (preco(b.nome) || 0) - (preco(a.nome) || 0));
    const ja2 = gs.map(() => 0);
    for (const u of blind) { let p = 0, melhor = -Infinity; cotas.forEach((s, q) => { const resta = s * blind.length - ja2[q]; if (resta > melhor + 1e-9) { melhor = resta; p = q; } }); ja2[p]++; grupo.set(u.id, gs[p]); }
  }
  for (const papel of ['tank', 'recon', 'light']) {
    const alvo = alocacao[papel]; if (!alvo) continue;
    const gs = [].concat(alvo).map(num);
    (porPapel[papel] || []).filter((u) => !grupo.has(u.id)).sort((a, b) => (preco(b.nome) || 0) - (preco(a.nome) || 0)).forEach((u, k) => grupo.set(u.id, gs[k % gs.length]));
  }
  // `team` pode ser uma lista (16/10, 313): os pelotoes de equipes (com o seu transporte) alternam entre os grupos, o
  // mais caro primeiro; `ride` igual a `team` mantem o transporte junto
  const listaT = [].concat(alocacao.team || 'rest').map(num);
  const teams = listaT[0];
  const ride = alocacao.ride && !Array.isArray(alocacao.ride) ? num(alocacao.ride) : teams;
  caudaGrupos(vivas, porPai, grupo, { teams, teamVeh: ride !== teams ? ride : null, aa: num(alocacao.aa || 'rest'), rest: num(alocacao.rest || 'rest') });
  if (listaT.length > 1) {
    const deEquipes = [...porPai.values()].filter((us) => us.some((u) => grupo.get(u.id) === teams));
    const custo = (us) => us.reduce((a, u) => a + (preco(u.nome) || 0), 0);
    deEquipes.sort((a, b) => custo(b) - custo(a));
    if (deEquipes.length >= listaT.length) deEquipes.forEach((us, k) => { const g = listaT[k % listaT.length]; for (const u of us) if (grupo.get(u.id) === teams) grupo.set(u.id, g); });
    else {
      // MENOS FORMACOES DO QUE GRUPOS (17/10, 282: dois pelotoes de equipes para tres circulos rosa): por CARGA. O jogo
      // embarca em ordem (autor: a primeira unidade a pe no primeiro veiculo; cargasDaFormacao), entao cada veiculo vai
      // com quem senta nele para um grupo, em rodizio, e a equipe desce no proprio circulo. Grupo que ficou sem ninguem
      // recebe a ultima equipe da carga mais cheia: ela fica montada ate o grupo do veiculo desembarca-la (o "01
      // teste") e anda dali ate o seu circulo. Quem nao coube em veiculo nenhum comeca a pe, nos grupos vazios primeiro.
      const n = listaT.length; const cargas = [], aPe = [];
      for (const us of deEquipes) {
        const r = cargasDaFormacao(us.filter((u) => grupo.get(u.id) === teams), rules);
        const cheias = r.cargas.filter((c) => c.passageiros.length);
        r.cargas.filter((c) => !c.passageiros.length).forEach((c) => { c.vazia = cheias[0] || null; });
        cargas.push(...r.cargas); aPe.push(...r.aPe);
      }
      let k = 0; for (const c of cargas) if (c.passageiros.length) c.grupo = listaT[k++ % n];
      for (const c of cargas) if (!c.passageiros.length) c.grupo = c.vazia?.grupo ?? listaT[0];
      const dono = new Map(); for (const c of cargas) for (const p of c.passageiros) dono.set(p.id, c.grupo);
      const temGente = (g) => [...dono.values()].includes(g);
      for (const u of aPe) { const g = listaT.find((x) => !temGente(x)) ?? listaT[k++ % n]; dono.set(u.id, g); }
      for (const g of listaT) {
        if (temGente(g)) continue;
        const doadora = cargas.filter((c) => c.passageiros.filter((p) => dono.get(p.id) === c.grupo).length > 1)
          .sort((a, b) => b.passageiros.length - a.passageiros.length)[0];
        if (!doadora) break;
        const p = [...doadora.passageiros].reverse().find((q) => dono.get(q.id) === doadora.grupo); dono.set(p.id, g);
      }
      for (const c of cargas) grupo.set(c.veiculo.id, c.grupo);
      for (const [id, g] of dono) grupo.set(id, g);
      const r = relatorio(grupo, vivas, porPapel);
      r.cargas = cargas.map((c) => ({ veiculo: c.veiculo.nome, id: c.veiculo.id, grupo: c.grupo, passageiros: c.passageiros.map((p) => ({ nome: p.nome, id: p.id, grupo: dono.get(p.id) })) }));
      r.aPe = aPe.map((u) => ({ nome: u.nome, id: u.id, grupo: dono.get(u.id) }));
      return r;
    }
  }
  return relatorio(grupo, vivas, porPapel);
}

// O ASSENTO DO JOGO (autor, 17/10): "e sempre em ordem — primeiro squad no primeiro veiculo". Os a pe (na ordem do
// arquivo) enchem os veiculos (na ordem do arquivo): numa formacao de equipes cada veiculo leva `seatsOf` (o HQ ocupa
// lugar: o observador do Platoon (Scout) ficou a pe atras do HQ); numa formacao com esquadras, uma por veiculo e o HQ,
// pequeno, cabe junto com a primeira no primeiro. `aPe` = quem nao coube (comeca a pe).
export function cargasDaFormacao(us, rules) {
  const veics = us.filter((u) => VEIC_PELOTAO.includes(u.papelEncontro));
  const pes = us.filter((u) => !VEIC_PELOTAO.includes(u.papelEncontro));
  const comEsquadra = pes.some((u) => u.papelEncontro === 'squad');
  const cargas = veics.map((v) => ({ veiculo: v, passageiros: [], lugares: comEsquadra ? 1 : seatsOf(v.nome, rules) }));
  const ocupa = (p) => !(comEsquadra && p.papelEncontro === 'hq');
  const aPe = []; let k = 0;
  for (const u of pes) {
    if (comEsquadra && u.papelEncontro === 'hq' && cargas.length) { cargas[0].passageiros.push(u); continue; }
    while (k < cargas.length && cargas[k].passageiros.filter(ocupa).length >= cargas[k].lugares) k++;
    if (k >= cargas.length) aPe.push(u); else cargas[k].passageiros.push(u);
  }
  return { cargas: cargas.map(({ veiculo, passageiros }) => ({ veiculo, passageiros })), aPe };
}

// QUEM DECIDE A ALOCACAO e a DOUTRINA do mapa (planos_ia.json > doutrina, 13/10): 'assalto', 'aberto' ou, sem ela, os
// lances A/B/C antigos. `grupos` = a tabela do registro (senao a da doutrina em rules.meet).
export function meetGroups(unidades, { rules, shares = rules.meet.variants.balanced, preco = () => 0, variant = null, doutrina = null, grupos = null, alocacao = null }) {
  if (doutrina === 'roteiro') return meetGroupsRoteiro(unidades, { rules, preco, grupos, alocacao });
  if (doutrina === 'assalto') return meetGroupsAssault(unidades, { rules, variant, preco, grupos });
  if (doutrina === 'aberto') return meetGroupsAberto(unidades, { rules, preco, grupos });
  if (doutrina === 'posicional') return meetGroupsPosicional(unidades, { rules, preco, grupos });
  if (doutrina) throw new Error(`unknown meet doctrine: ${doutrina}`);
  const vivas = unidades.filter((u) => !u.ausente);
  const grupo = new Map(); const porPapel = {};
  const porPai = new Map(); for (const u of vivas) { if (!porPai.has(u.pai)) porPai.set(u.pai, []); porPai.get(u.pai).push(u); }
  // os irmaos do pelotao contam (`needsTeam`): o HMMWV do observador nao e o blindado leve do Platoon (Assault), e o seu
  // ride — o observador vai para as equipes com ele, nao para os leves
  // (os nomes contam os irmaos MASCARADOS tambem: o HMMWV comprado sozinho do Platoon (Assault) perdeu a equipe de HMG
  // na poda, mas o pelotao dele continua sendo o Standard)
  const nomesDoPai = new Map(); for (const u of unidades) { if (!nomesDoPai.has(u.pai)) nomesDoPai.set(u.pai, []); nomesDoPai.get(u.pai).push(u.nome); }
  for (const u of vivas) {
    u.papelEncontro = u.foraDoMapa ? 'foraDoMapa' : papelEncontro(u.nome, rules, { leafNames: nomesDoPai.get(u.pai) || [] });
    // a esquadra de recon do pelotao de excecao (rules.meet.mechExceptions) e esquadra: so ela entra montada
    if (u.papelEncontro === 'never' && /Squad/i.test(u.nome)) u.papelEncontro = /Command/i.test(u.nome) ? 'hq' : 'squad';
    // o controlador aereo (02/11) e o jipe dele ficam juntos, no fundo com o resto
    if (ehControlador(nomesDoPai.get(u.pai), rules)) u.papelEncontro = 'obs';
    (porPapel[u.papelEncontro] ||= []).push(u);
  }
  const ABC = (lista, [gA, gB, gC]) => {
    const n = repartirABC(lista.length, shares); let a = n.A, c = n.C;
    lista.forEach((u, k) => {
      if (k < n.B) { u.g = gB; return; }
      // o resto alterna A e C, cada um ate a sua cota
      if ((k - n.B) % 2 === 0 ? a > 0 : c === 0) { u.g = gA; a--; } else { u.g = gC; c--; }
    });
    return lista;
  };
  // pelotoes mecanizados: inteiros, os mais caros primeiro no centro
  // o pelotao com esquadras e veiculos e mecanizado — inclusive os de excecao, cujo transporte e HMMWV ou Tigr
  const mech = [...porPai.values()].filter((us) => us.some((u) => u.papelEncontro === 'squad') && us.some((u) => ['carrier', 'ride', 'recon', 'light'].includes(u.papelEncontro)));
  const custo = (us) => us.reduce((a, u) => a + (preco(u.nome) || 0), 0);
  mech.sort((a, b) => custo(b) - custo(a));
  const mechNos = ABC(mech.map((us) => ({ us })), MEET_GROUPS.mech);
  for (const m of mechNos) for (const u of m.us) grupo.set(u.id, m.g);
  // tanques, leves e recon: um a um, os mais caros primeiro no centro
  for (const [papel, gs] of [['tank', MEET_GROUPS.tanks], ['light', MEET_GROUPS.light], ['recon', MEET_GROUPS.recon]]) {
    const lista = (porPapel[papel] || []).filter((u) => !grupo.has(u.id)).sort((a, b) => (preco(b.nome) || 0) - (preco(a.nome) || 0));
    for (const u of ABC(lista, gs)) grupo.set(u.id, u.g);
  }
  for (const u of vivas) {
    if (grupo.has(u.id)) continue;
    const p = u.papelEncontro;
    if (p === 'foraDoMapa') { grupo.set(u.id, MEET_GROUPS.rest); continue; }
    if (p === 'aaVehicle' || p === 'aaTeam') { grupo.set(u.id, MEET_GROUPS.aa); continue; }
    const irmaos = porPai.get(u.pai) || [];
    if (p === 'team' || p === 'hq' || p === 'ride' || p === 'carrier') {
      // a pe num pelotao sem ride proprio: vai com o veiculo (leve/recon) do pelotao
      const temRide = irmaos.some((x) => x.papelEncontro === 'ride' || x.papelEncontro === 'carrier');
      const veic = irmaos.find((x) => grupo.has(x.id) && ['light', 'recon'].includes(x.papelEncontro));
      if (!temRide && veic) { grupo.set(u.id, grupo.get(veic.id)); continue; }
      if (irmaos.some((x) => x.papelEncontro === 'aaTeam')) { grupo.set(u.id, MEET_GROUPS.aa); continue; }
      grupo.set(u.id, p === 'hq' && !irmaos.some((x) => x.papelEncontro === 'team') ? MEET_GROUPS.rest : MEET_GROUPS.teams);
      continue;
    }
    grupo.set(u.id, MEET_GROUPS.rest);
  }
  return {
    grupo, vivas, infantaria: new Set(),
    porPapel: Object.fromEntries(Object.entries(porPapel).map(([k, v]) => [k, v.map((u) => u.nome)])),
    blindados: vivas.filter((u) => ['tank', 'light', 'recon'].includes(u.papelEncontro)).map((u) => ({ nome: u.nome, grupo: grupo.get(u.id) })),
  };
}

// QUAL PLANO A IA USA NESTA BATALHA: sorteio uniforme entre as variantes que o mapa tem (`planos_ia.json` >
// `variantes`, {"1": "balanced", ...}), pela semente da campanha e o numero da batalha.
export function meetVariantFor({ registry, seed, battleNumber, rules }) {
  const vs = Object.entries(registry?.variantes || { 1: 'balanced' }).map(([p, nome]) => ({ plan: +p, variant: nome }));
  const r = rng(((seed >>> 0) ^ Math.imul(battleNumber + 1, 0x9e3779b1)) >>> 0);
  r(); const v = vs[Math.floor(r() * vs.length)];
  return { ...v, shares: rules.meet.variants[v.variant] || rules.meet.variants.balanced };
}

// A COPIA DO MAPA COM UM PLANO SO: `uso` = Used Frequently no plano sorteado e Not Used nos outros, gravado com o
// escritor da regiao de IA (identidade byte a byte, conferida aqui como no ia_parar_objetivo). O jogo sorteia entre os
// planos usados pelos pesos; com um so, e ele.
export function meetMapCopy({ mapFile, plan, workDir }) {
  const d = decodeAiRegion(mapFile);
  if (!d.azul[plan - 1]?.slots.some((s) => s.length)) throw new Error(`plan ${plan} of ${path.basename(mapFile)} is empty`);
  d.azul.forEach((pl, k) => { pl.uso = k + 1 === plan ? AI_PLAN_USE['Used Frequently'] : AI_PLAN_USE['Not Used']; });
  fs.mkdirSync(workDir, { recursive: true });
  const out = path.join(workDir, path.basename(mapFile, '.btt') + ` plan${plan}.btt`);
  writeAiRegion(mapFile, out, d);
  const back = decodeAiRegion(out);
  if (!encodeAiRegion(back).equals(mapPieces(out).resto)) throw new Error('meet map copy: the AI region does not read back');
  if (aiFileVersion(fs.readFileSync(out)) !== aiFileVersion(fs.readFileSync(mapFile))) throw new Error('meet map copy: the file version changed');
  if (back.azul.some((pl, k) => pl.uso !== (k + 1 === plan ? AI_PLAN_USE['Used Frequently'] : AI_PLAN_USE['Not Used']))) throw new Error('meet map copy: uso not written');
  return out;
}

// O QUE A CAMPANHA PASSA AO FORGE NUM ENCONTRO (13/10/2026): o mapa Meet do pacote com plano de encontro registrado
// (`planos_ia.json`, `encontro: true`) -> a variante sorteada pela semente e o numero da batalha, a copia do mapa so
// com aquele plano usado (em `workDir`) e o `meet` do buildBattle. Mapa sem plano de encontro: null (o forge segue
// com o rodizio de grupos de sempre).
export function meetBuildInputs({ mapFile, seed, battleNumber, rules, workDir }) {
  const registry = authoredPlan(mapFile);
  if (!registry?.encontro) return null;
  const v = meetVariantFor({ registry, seed, battleNumber, rules });
  const copia = meetMapCopy({ mapFile, plan: v.plan, workDir });
  return { mapFile: copia, meet: { ...v, sourceMap: mapFile, key: registry.key, doutrina: registry.doutrina || null, grupos: registry.grupos || null, alocacao: registry.alocacao || null } };
}

// O SUPORTE DO ENCONTRO (autor, 14/10): as unidades FORA DO MAPA do pool da defesa (mesmos precos e papeis:
// mortar_off, artillery_off, air), as que `rules.meet.supportRoles` aceita e o tier libera (defesa: alwaysAllowed +
// unlocks). Cada uma e comprada sozinha (papel 'offMap', balde 'support'); entra na fonte do encontro do mesmo arquivo
// da biblioteca quando ela existe (uma formacao so no .btt), senao numa fonte propria.
function suporteDoEncontro(exercitos, tier, rules, sources) {
  const D = rules.defense;
  const libera = new Set([...(D.alwaysAllowed || []), ...(tier.unlocks || [])]);
  const papeis = new Set((rules.meet.supportRoles || []).filter((r) => libera.has(r)));
  if (!papeis.size) return;
  const semXP = { ignoreExperience: !rules.units.experiencePricing?.enemy };
  for (const n of exercitos) for (const s of poolOf(n, rules, semXP)) {
    const us = s.units.filter((u) => u.bucket === 'offMap' && papeis.has(u.role))
      .map((u) => ({ ...u, papel: 'offMap', bucket: 'support', roleApp: u.role, leaf: `${s.f.source}|support`, lot: null }));
    if (!us.length) continue;
    const ja = sources.find((x) => x.f.source === s.f.source);
    if (ja) ja.units.push(...us.filter((u) => !ja.units.some((v) => v.id === u.id)));
    else sources.push({ f: s.f, tree: s.tree, units: us, lots: [], nation: n });
  }
}

// AS FATIAS DO TIER (autor, 14/10): `rules.meet.sharesByTier[tier]` (o tier 2+ tem suporte), senao `rules.meet.shares`.
export const meetSharesFor = (tierN, rules) => rules.meet.sharesByTier?.[String(tierN)] || rules.meet.shares;

// O PISO DO JOGADOR (autor, 25/10): o encontro e o maior entre a escala do tier e o valor da forca do jogador em campo,
// com teto de `rules.meet.playerFloor.ceiling` x a escala. `floor` 0 (o caminho, cego para a forca) = a escala.
export function meetBudget(scale, floor, rules) {
  const P = rules.meet?.playerFloor;
  if (!P?.on || !(floor > 0)) return Math.round(scale);
  return Math.round(Math.min(scale * (P.ceiling ?? 1.5), Math.max(scale, floor)));
}

// `garantias` (14/10, planos_ia.json do mapa): { morteiro: true } = no tier listado em rules.meet.guaranteedMortarTiers a
// bateria de morteiro fora do mapa mais barata do lado, comprada antes de tudo e POR CIMA do orcamento.
export function planMeetForce({ nation, nations, battleNumber, rules, seed, effort = 1, trace, garantias = null, floor = 0 }) {
  const tier = tierOf(battleNumber, rules);
  const M = rules.meet;
  const random = rng(seed + battleNumber * 7919 + 101);
  const exercitos = (nations && nations.length ? nations : [nation]).filter(Boolean);
  if (!exercitos.length) throw new Error('no meet nation');
  const sources = exercitos.flatMap((n) => meetPoolOf(n, tier.tier, rules).map((s) => ({ ...s, nation: n })));
  if (!sources.length) throw new Error(`no library formations for ${exercitos.join('+')}`);
  suporteDoEncontro(exercitos, tier, rules, sources);
  const allUnits = sources.flatMap((s) => s.units);
  const allLots = sources.flatMap((s) => s.lots);

  const base = tierBudgets(battleNumber, rules, { effort, kind: 'Meet' });
  let total = meetBudget(base.total, floor, rules);
  const shares = meetSharesFor(tier.tier, rules);
  const money = Object.fromEntries(MEET_BUCKETS.map((b) => [b, Math.round(total * (shares[b] || 0))]));
  const slack = Math.round(total * (rules.defense.bucketSlack || 0));
  const CAPS = rules.defense.unitCaps || {};
  const capOf = (b) => ({ tanks: CAPS.tanks ?? 30, mech: CAPS.squads ?? 35 }[b] ?? Infinity);
  const maxSources = M.maxSources ?? 8;

  const spent = Object.fromEntries(MEET_BUCKETS.map((b) => [b, 0]));
  const count = Object.fromEntries(MEET_BUCKETS.map((b) => [b, 0]));
  count.onMap = 0; count.squads = 0;
  let paid = 0, full = 0;
  const taken = new Set(), used = new Set();
  const unitsTaken = [], lotsTaken = [], trail = [];
  const fonteSoDeApoio = new Set(sources.filter((s) => s.units.every((u) => u.bucket === 'support')).map((s) => s.f.source));
  const canUse = (src) => used.has(src) || fonteSoDeApoio.has(src) || [...used].filter((x) => !fonteSoDeApoio.has(x)).length < maxSources;
  const roomOnMap = (n) => count.onMap + n <= (CAPS.onMap ?? 140);

  // O que um balde pode gastar agora: o pote do balde da vez; os outros baldes que um lote toca, a fatia deles e a folga.
  let vez = null, pote = 0;
  const limite = (b) => (b === vez ? pote : money[b] + slack);
  const fitsUnit = (u) => !taken.has(u.id) && SOZINHO.has(u.papel) && !(u.lot && taken.has(u.lot.id)) && !(u.gemeoDe?.lot && taken.has(u.gemeoDe.lot.id)) && canUse(u.source)
    && spent[u.bucket] + u.price <= limite(u.bucket) && count[u.bucket] + 1 <= capOf(u.bucket) && (u.bucket === 'support' || roomOnMap(1));
  const fitsLot = (l) => !taken.has(l.id) && (!l.battles || l.battles.includes(battleNumber)) && !l.units.some((u) => taken.has(u.id)) && canUse(l.source) && roomOnMap(l.units.length)
    && count.squads + l.squads <= (CAPS.squads ?? 35) && Object.entries(l.spend).every(([b, v]) => spent[b] + v <= limite(b));
  const takeUnit = (u, extra = {}) => {
    taken.add(u.id); used.add(u.source); paid += u.price; full += u.price; spent[u.bucket] += u.price; count[u.bucket]++; if (u.bucket !== 'support') count.onMap++;
    unitsTaken.push(u); trail.push({ unit: u.name, papel: u.papel, source: u.source, price: u.price, ...extra });
  };
  const takeLot = (l, extra = {}) => {
    taken.add(l.id); used.add(l.source); lotsTaken.push(l);
    for (const u of l.units) { taken.add(u.id); unitsTaken.push(u); full += u.price; count.onMap++; }
    for (const [b, v] of Object.entries(l.spend)) { spent[b] += v; paid += v; }
    count[l.home] += 1; count.squads += l.squads;
    trail.push({ lot: l.name, tipo: l.tipo, source: l.source, price: l.price, spend: l.spend, ...extra });
  };

  // O sorteio: tipo primeiro (uniforme), depois a unidade, preferindo uma fonte ja usada. Tanques preferem o pelotao do
  // ultimo tanque comprado (70 %), para um pelotao de tanques vir inteiro.
  const family = (src) => (src.match(/\[([^\]]+)\]/) || [, src.replace(/^\w+ - /, '')])[1];
  const tipoDe = (c) => (c.units ? `lot · ${c.name} · ${family(c.source)}` : c.name);
  let ultimoTanque = null;
  const draw = (cands) => {
    if (vez === 'tanks' && ultimoTanque) { const mesmo = cands.filter((c) => !c.units && c.leaf === ultimoTanque); if (mesmo.length && random() < 0.7) return mesmo[Math.floor(random() * mesmo.length)]; }
    const tipos = [...new Set(cands.map(tipoDe))];
    const t = tipos[Math.floor(random() * tipos.length)];
    const same = cands.filter((c) => tipoDe(c) === t);
    const known = same.filter((c) => used.has(c.source));
    const from = known.length ? known : same;
    return from[Math.floor(random() * from.length)];
  };
  const comprar = (b, extra = {}) => {
    let n = 0;
    for (;;) {
      const cands = [...allUnits.filter((u) => u.bucket === b && fitsUnit(u)), ...allLots.filter((l) => l.home === b && fitsLot(l))];
      if (!cands.length) return n;
      const c = draw(cands);
      if (c.units) takeLot(c, extra); else { takeUnit(c, extra); if (b === 'tanks') ultimoTanque = c.leaf; }
      n++;
    }
  };

  // O MORTEIRO GARANTIDO (autor, 14/10): no mapa que o registro marca e no tier listado, a bateria de morteiro fora do
  // mapa mais barata do lado, antes de tudo e POR CIMA do orcamento (o total sobe pelo preco dela).
  let garantido = null;
  if (garantias?.morteiro && (M.guaranteedMortarTiers || [1]).includes(tier.tier)) {
    const mort = allUnits.filter((u) => u.bucket === 'support' && u.roleApp === 'mortar_off').sort((a, b) => a.price - b.price || (a.id < b.id ? -1 : 1));
    if (mort.length) { total += mort[0].price; money.support += mort[0].price; vez = 'support'; pote = money.support; takeUnit(mort[0], { guaranteed: true }); garantido = { name: mort[0].name, price: mort[0].price }; }
    else trace?.event('meet.noGuaranteedMortar', { nations: exercitos, tier: tier.tier });
  }
  // A CASCATA (autor: "caso sobre orcamento em um grupo, o saldo remanescente deve cair para o grupo seguinte").
  const cascade = [];
  let carry = 0;
  for (const b of M.order) {
    vez = b; pote = money[b] + carry;
    const potDoBalde = pote;
    comprar(b);
    // O TANQUE ARREDONDA PARA CIMA (autor, 14/10): sem tanque e com o pote cobrindo `tankRoundUp` (75 %) do mais barato,
    // o pote sobe ate ele; a diferenca sai dos baldes seguintes (o carry fica negativo). Nunca passa do total.
    let arredondou = null;
    if (b === 'tanks' && !spent.tanks && M.tankRoundUp) {
      const tq = allUnits.filter((u) => u.bucket === 'tanks' && !taken.has(u.id) && canUse(u.source) && roomOnMap(1));
      const barato = tq.length ? Math.min(...tq.map((u) => u.price)) : Infinity;
      if (barato > potDoBalde && potDoBalde >= barato * M.tankRoundUp && paid + barato <= total) { pote = barato; comprar(b); arredondou = barato; }
    }
    cascade.push({ bucket: b, money: money[b], pot: potDoBalde, spent: spent[b], ...(arredondou ? { roundedUpTo: arredondou } : {}) });
    carry = potDoBalde - spent[b];
  }
  // A SEGUNDA PASSADA: o que sobrou no fim, nos baldes de `secondPass`, um por vez, enquanto couber.
  for (let volta = 0; volta < 40; volta++) {
    let comprou = false;
    for (const b of M.secondPass || []) {
      const resta = total - paid; if (resta <= 0) break;
      vez = b; pote = spent[b] + resta;
      if (comprar(b, { secondPass: true })) comprou = true;
    }
    if (!comprou) break;
  }
  // A AVIACAO TRAZ O CONTROLADOR (autor, 02/11): a Air Controller Section do exercito que levou aviacao, inteira e de
  // graca (fora de `paid` e dos baldes); a IA do encontro a poe com o resto, no fundo.
  const airObservers = [];
  const semXP = { ignoreExperience: !rules.units.experiencePricing?.enemy };
  for (const n of exercitos) {
    if (!unitsTaken.some((u) => u.roleApp === 'air' && sources.find((s) => s.f.source === u.source)?.nation === n)) continue;
    const sec = airObserverSection(n, rules, semXP);
    if (!sec) { trace?.event('meet.noAirObservers', { nation: n }); continue; }
    if (used.has(sec.f.source)) continue;
    const us = sec.units.map((u) => ({ ...u, papel: 'obs', leaf: `${sec.f.source}|observers` }));
    if (!sources.some((s) => s.f.source === sec.f.source)) sources.push({ ...sec, units: us, nation: n });
    used.add(sec.f.source);
    for (const u of us) {
      taken.add(u.id); unitsTaken.push(u); full += u.price; count.onMap++;
      trail.push({ unit: u.name, papel: u.papel, source: u.source, price: 0, airObserver: true });
    }
    airObservers.push({ nation: n, source: sec.f.source, units: us.map((u) => u.name), price: us.reduce((a, u) => a + u.price, 0) });
  }

  const usedSources = sources.filter((s) => used.has(s.f.source));
  const pagoPorNacao = {};
  for (const u of unitsTaken.filter((x) => !x.free)) { const n = sources.find((s) => s.f.source === u.source)?.nation; pagoPorNacao[n] = (pagoPorNacao[n] || 0) + u.price; }
  const entraram = exercitos.filter((n) => pagoPorNacao[n]);
  const quem = entraram.slice().sort((a, b) => pagoPorNacao[b] - pagoPorNacao[a])[0] || exercitos[0];
  const formations = usedSources.map((s) => ({
    formacao: path.join(paths().lib, s.f.file),
    ...pruneSpec(s.tree, (key) => taken.has(`${s.f.source}|${key}`)),
    atributos: { experiencia: tier.experience, motivacao: tier.motivation },
  }));
  const byType = {}, byPapel = {};
  for (const u of unitsTaken) { byType[u.name] = (byType[u.name] || 0) + 1; byPapel[u.papel] = (byPapel[u.papel] || 0) + 1; }
  if (!lotsTaken.some((l) => l.tipo === 'mech')) trace?.event('meet.noMech', { total, cost: paid, nation: quem });
  if (!spent.tanks) trace?.event('meet.noTank', { total, tanksMoney: money.tanks, tier: tier.tier });

  // a fatia do gasto por balde (o que a Intel do briefing le), como o `mix` da defesa
  const mix = Object.fromEntries(MEET_BUCKETS.map((b) => [b, paid ? Math.round((spent[b] / paid) * 100) / 100 : 0]));
  const plan = {
    backbone: usedSources.map((s) => s.f.source.replace(/^\w+ - /, '')).join(' + '),
    sources: usedSources.map((s) => s.f.source),
    sourcesOnMap: usedSources.length,
    nation: quem,
    nations: entraram,
    creditsByNation: pagoPorNacao,
    profile: 'encontro',
    effort,
    kind: 'Meet',
    kindFactor: rules.maps?.kindBudgetFactor?.Meet ?? 1,
    budget: total,
    meetBudget: { scale: base.total, player: floor || 0, budget: meetBudget(base.total, floor, rules), ceiling: rules.meet?.playerFloor?.ceiling ?? null },
    budgets: { ...money },
    baseBudget: Math.round(total / effort),
    cost: paid,
    fullCost: full,
    freeHeadquarters: full - paid - airObservers.reduce((a, o) => a + o.price, 0),
    ...(airObservers.length ? { airObservers } : {}),
    spent: { ...spent },
    mix,
    count: { ...count },
    units: unitsTaken.length,
    onMapUnits: unitsTaken.filter((u) => u.bucket !== 'support').length,
    offMapUnits: unitsTaken.filter((u) => u.bucket === 'support').length,
    tier: tier.tier,
    experience: tier.experience,
    motivation: tier.motivation,
    lots: lotsTaken.map((l) => ({ name: l.name, tipo: l.tipo, occurrence: l.occurrence, source: l.source, units: l.units.length, squads: l.squads, seats: l.seats, price: l.price })),
    kept: Object.entries(byType).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
    byPapel,
    trail,
    formations,
    meet: {
      cascade,
      ...(garantido ? { garantido } : {}),
      unidades: unitsTaken.map((u) => ({ id: u.id, name: u.name, papel: u.papel, bucket: u.bucket, source: u.source, leaf: u.leaf, price: u.price, lot: u.lot && taken.has(u.lot.id) ? u.lot.id : null })),
    },
  };
  trace?.event('meet.planned', { ...plan, formations: undefined, trail: undefined, meet: { cascade } });
  return plan;
}
