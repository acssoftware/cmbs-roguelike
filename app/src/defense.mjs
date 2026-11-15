// THE ENEMY.
//
// Every battle gets a freshly generated defense. It is not carried over: only the player has a
// core force. The defense is BOUGHT BY BUCKET, not by formation (E46, 12/09): every unit of every
// library formation of the nation sits in one pool, sorted into four buckets — infantry squads,
// weapons teams, combat vehicles, off-map support — and the map profile says how much of the
// budget each bucket gets (autor: urban 70% on foot / 10% vehicles / 10% off-map, open 50 / 40 /
// 10). Squads come in LOTS (a platoon on foot, its HQ team free); everything else is bought one
// unit at a time, by TYPE drawn at random, so a sector mixes BTR, BMP and MT-LB instead of being
// one battalion cut to size. Each library formation touched enters the file pruned to exactly
// what was bought. Deterministic given the campaign seed, and every decision is in the log.
import fs from 'node:fs';
import path from 'node:path';
import { paths, RESEARCH_DIR } from './settings.mjs';
import { formationTree, priceUnits, roleOf, libFormations } from './catalog.mjs';

// mulberry32: small, fast, and the same sequence on every machine.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function tierOf(battleNumber, rules) {
  return rules.tiers.find((t) => t.battles.includes(battleNumber)) || rules.tiers[rules.tiers.length - 1];
}

// FIVE BUDGETS, NOT ONE (E47). Each tier says what its first battle spends per category — squads,
// weapons teams, carriers, tanks, off-map — and the second and third battles of the tier multiply
// that by `battleGrowth` once and twice. The enemy effort (chosen when the campaign is raised) multiplies everything,
// and so does a meeting engagement (`kindBudgetFactor.Meet`); every other battle is 1x (23/10: the Probe/Attack/Assault
// factors went with the three versions of each map, which were the same map). The mix stays the mix.
//
// It is a pure function of the rules and the battle number, which is what lets the campaign know
// what the NEXT battle will cost before the map for it has been drawn — the command allotment
// (E49) is a share of this total, and the map profile only moves money between the categories.
export function tierBudgets(battleNumber, rules, { effort = 1, kind = null } = {}) {
  const tier = tierOf(battleNumber, rules);
  const kindFactor = (kind && rules.maps?.kindBudgetFactor?.[kind]) ?? 1;
  const growth = Math.pow(rules.defense.battleGrowth ?? 1, Math.max(0, tier.battles.indexOf(battleNumber)));
  const out = {};
  for (const b of BUCKETS) out[b] = Math.round((tier.budgets?.[b] || 0) * growth * effort * kindFactor);
  out.total = BUCKETS.reduce((a, b) => a + out[b], 0);
  return out;
}

// What the defense of a battle has to spend, all categories together — knowable in advance.
export function budgetFor(battleNumber, rules, { effort = 1 } = {}) {
  return tierBudgets(battleNumber, rules, { effort }).total;
}

// The clock. autor: the first mission gets 45 minutes and every tier adds 15 — 45, 60, 75, 90, 105
// — with a ceiling one step above the base. A map in the upper half of its tier's area and a
// defense above the threshold each add a step, and the ceiling is hard. Every value it can return
// is one the editor itself offers (FORMATO 50), so nothing untried is ever written to the byte.
export function durationFor(tier, unitsInDefense, area, rules) {
  const d = rules.duration;
  let wanted = tier.duration;
  if (unitsInDefense > d.unitsThreshold) wanted += d.minutesPerStep * Math.ceil((unitsInDefense - d.unitsThreshold) / d.unitsPerStep);
  if (area >= tier.bigMapArea) wanted += d.minutesPerStep;
  wanted = Math.min(wanted, tier.durationMax);
  const allowed = d.allowed.filter((v) => v <= tier.durationMax);
  return allowed.reduce((best, v) => (Math.abs(v - wanted) < Math.abs(best - wanted) ? v : best), allowed[0]);
}

// "3 x 152mm Howitzer (2S19)" is a battery that never sets foot on the map, whatever the library's
// category byte says — the flag lies for the assets organic to a battalion (memory: who is off-map
// only the battle says). The name is the reliable label.
const OFF_MAP_NAME = /^\d+ x /;
// A vehicle by name that the role table files under a foot role: the BRDM-2M with its AT-5 is an
// ATGM, the BRM-1K is recon, the 2S24 is a mortar, the HMMWV with an M2 is a "machine gun". They
// are vehicles, and they are bought as such — never as a "weapons team".
const VEHICLE_NAME = /\bVehicle\b|\bCarrier\b|\bDestroyer\b|\bTank\b|Antiaircraft|HMMWV|Stryker|Bradley|BTR-|BMP-|MT-LB|BRDM|BRM-/i;
// And a vehicle that is not a COMBAT vehicle is never bought (autor: "tem que ser veiculos de
// combate"): the commander's BTR, the artillery observer's MT-LBU, the engineers' support
// Stryker, the FIST Bradley. Trucks and jeeps are already out by role.
const NON_COMBAT_VEHICLE = /\bCommand\b|Observation|Support Vehicle|Fire Support|Ambulance|Recovery|Medical|Cargo/i;
// A library formation that IS an aircraft or a drone only offers its off-map unit: the "ATGM
// Platoon" record inside the Hind file is the helicopter's missile load, not a platoon.
const AIR_SOURCE = /\((Su-|Mi-|KA-|AH-|F-|MQ-|RQ-)|Orlan|Pchela|Zala|Raven|Shadow|Gray Eagle|Apache|Fencer|Frogfoot|Fullback|Havoc|Hind|Alligator|Falcon|Eagle/;

// `scouts` (autor, 11/10): the scout and recon squads, a share of the squad money (`defense.scouts.share`), bought
// one by one and only from the library files `defense.scouts.sources` names. The tier tables give it no money of its
// own: planDefense carves it out of the squads.
export const BUCKETS = ['squads', 'scouts', 'teams', 'carriers', 'tanks', 'offMap'];

export function bucketOf(name, role, rules) {
  const B = rules.defense.buckets;
  if (OFF_MAP_NAME.test(name) || B.offMap.includes(role)) return 'offMap';
  // MORTEIRO INIMIGO SO FORA DO MAPA (autor, 11/10): nem equipe a pe nem veiculo de morteiro (2S24, M1129, HMMWV) na
  // defesa; as baterias fora do mapa ja sairam acima.
  if (rules.defense.mortarOnMap === false && /Mortar/i.test(name)) return 'never';
  if (B.tanks.includes(role)) return NON_COMBAT_VEHICLE.test(name) ? 'never' : 'tanks';
  const vehicle = B.carriers.includes(role) || (VEHICLE_NAME.test(name) && (B.teams.includes(role) || (B.scouts || []).includes(role)));
  if (vehicle) return NON_COMBAT_VEHICLE.test(name) ? 'never' : 'carriers';
  if (B.squads.includes(role)) return 'squads';
  if ((B.scouts || []).includes(role)) return 'scouts';
  if (B.teams.includes(role)) return 'teams';
  return 'never';
}

// THE POOL: every unit of every library formation of the nation, with its bucket, its price and
// its place in the source (parent formation and ordinal among the parent's own units, which is
// how the prune names it). Plus the LOTS: a leaf formation — a platoon, a section — whose own
// units are mostly squads is bought whole, on foot: squads, weapons teams and the HQ team come
// together, the carriers go to the pool as single vehicles that remember whose they were.
// The weapons a unit type is issued at the factory (research/fabrica.json, keyed by army, type val and tab): every hand
// code of every slot. Read once. A type the table does not know returns nothing, so a filter on it lets the unit through.
let FACTORY_HANDS = null;
function factoryHands(army, val, tab) {
  if (!FACTORY_HANDS) {
    FACTORY_HANDS = new Map();
    try {
      const t = JSON.parse(fs.readFileSync(path.join(RESEARCH_DIR, 'fabrica.json'), 'utf8')).tipos || {};
      for (const v of Object.values(t)) {
        const hands = new Set(); for (const s of Object.values(v.vagas || {})) for (const h of s.maos || []) hands.add(h);
        FACTORY_HANDS.set(`${v.exercito}|${v.val}|${v.tab}`, [...hands]);
      }
    } catch { /* no table: nothing is filtered */ }
  }
  return FACTORY_HANDS.get(`${army}|${val}|${tab}`) || [];
}

export function poolOf(nation, rules, semXP = {}) {
  const D = rules.defense;
  const scoutSources = new Set(D.scouts?.sources?.[nation] || []);
  const scoutNames = D.scouts?.names?.[nation] ? new Set(D.scouts.names[nation]) : null;
  const banned = new Set(D.scouts?.noWeapons || []);
  const scoutArmed = (army, type) => banned.size > 0 && !!type && factoryHands(army, type[0], type[1]).some((h) => banned.has(h));
  const sources = [];
  for (const f of libFormations(nation)) {
    let tree; try { tree = formationTree(f.file); } catch { continue; }
    const units = [], lots = [];
    const walk = (node) => {
      if (!node.isFormation) return;
      let ordinal = 0;
      const mine = [];
      for (const c of node.children) {
        if (c.isFormation) continue;
        ordinal++;
        const raw = roleOf(c.name, false, rules);
        // O MORTEIRO ORGANICO DO BATALHAO (11/10, UKR3 b3): um registro sem posicao na lista 603 (morteiro), que o
        // catalogo de tipos chama de "Infantry Fighting Vehicle (BMP-3M)". Era comprado como blindado e entregava a IA
        // a bateria orgânica fora do mapa pelo preco de um BMP. Nunca se compra: fica desligado na poda.
        // O mesmo tipo [58,0] tambem e o 2S24 do Platoon (Mortar [medium]), posicionado: toda peca da lista de morteiro
        // fica de fora quando o morteiro inimigo nao vai ao mapa (as baterias avulsas fora do mapa sao outra lista).
        // O par [58,0] e sempre esse morteiro (o BMP-3 de verdade e [60,5]), com lista ou sem (Platoon (Mortar [medium])).
        const ehMorteiro = (c.path || []).includes(603) || (c.type && c.type[0] === 58 && c.type[1] === 0);
        const tuboOrganico = ehMorteiro && (c.organic || rules.defense.mortarOnMap === false);
        let bucket = tuboOrganico ? 'never' : bucketOf(c.name, raw, rules);
        // scouts only from the files the author named (11/10); foot recon of any other file is never bought
        if (bucket === 'scouts' && !scoutSources.has(f.source)) bucket = 'never';
        // ... and of those, only the names he wants (US: Section (Scout)) and never a type whose men carry a Javelin
        if (bucket === 'scouts' && scoutNames && !scoutNames.has(c.name)) bucket = 'never';
        if (bucket === 'scouts' && scoutArmed(nation, c.type)) bucket = 'never';
        const offMap = bucket === 'offMap';
        const role = offMap ? (rules.units.offMapRole[raw] || raw) : raw;
        const u = {
          id: `${f.source}|${c.key}`, key: c.key, name: c.name, type: c.type, role, bucket, offMap,
          price: priceUnits([{ name: c.name, offMap, type: c.type }], nation, rules, semXP).total,
          source: f.source, parent: node.name, ordinal, lot: null, carrierOf: null,
        };
        units.push(u); mine.push(u);
      }
      if (!node.children.some((c) => c.isFormation)) {
        const foot = mine.filter((u) => u.bucket === 'squads' || u.bucket === 'teams' || u.role === 'hq');
        const squads = foot.filter((u) => u.bucket === 'squads');
        if (squads.length >= (D.lotMinSquads ?? 2) && squads.length * 2 >= foot.length) {
          const paid = foot.filter((u) => u.role !== 'hq' || D.freeHeadquarters === false);
          const lot = {
            id: `${f.source}|lot|${node.key}`, key: node.key, name: node.name, occurrence: node.occurrence, source: f.source,
            units: foot, carriers: mine.filter((u) => u.bucket === 'carriers'),
            price: paid.reduce((a, u) => a + u.price, 0),
            full: foot.reduce((a, u) => a + u.price, 0),
            spend: { squads: paid.filter((u) => u.bucket === 'squads').reduce((a, u) => a + u.price, 0), teams: paid.filter((u) => u.bucket === 'teams').reduce((a, u) => a + u.price, 0) },
            squadType: squads[0].name,
            squadRole: squads[0].role,
          };
          for (const u of foot) u.lot = lot;
          for (const u of lot.carriers) u.carrierOf = lot;
          lots.push(lot);
        }
      }
      node.children.forEach(walk);
    };
    tree.roots.forEach(walk);
    if (AIR_SOURCE.test(f.source)) for (const u of units) if (u.bucket !== 'offMap') u.bucket = 'never';
    if (units.some((u) => u.bucket !== 'never')) sources.push({ f, tree, units, lots: AIR_SOURCE.test(f.source) ? [] : lots });
  }
  return sources;
}

// O CONTROLADOR AEREO DA AVIACAO (autor, 02/11: "todo suporte aereo na forca inimiga tem de ir acompanhado de air
// observers"; so o controlador aereo guia a aviacao, o observador comum nao). A Air Controller Section da faccao
// (`defense.airObservers.sources`), inteira: o controlador e o jipe dele. De graca, e a doutrina a poe com os
// observadores (ia_agrupar `obs`, G11). Sem o arquivo na biblioteca: null.
export function airObserverSection(nation, rules, semXP = {}) {
  const source = rules.defense.airObservers?.sources?.[nation];
  const f = source && libFormations(nation).find((x) => x.source === source);
  if (!f) return null;
  const tree = formationTree(f.file);
  const units = [];
  const walk = (node) => {
    for (const c of node.children) {
      if (c.isFormation) { walk(c); continue; }
      const role = roleOf(c.name, false, rules);
      units.push({ id: `${source}|${c.key}`, key: c.key, name: c.name, type: c.type, role, bucket: 'observers', offMap: false, free: true,
        price: priceUnits([{ name: c.name, offMap: false, type: c.type }], nation, rules, semXP).total, source, lot: null, carrierOf: null });
    }
  };
  tree.roots.forEach(walk);
  return { f, tree, units, lots: [] };
}

// What the generator needs to field EXACTLY the units taken from one library formation
// (podar.mjs): sub-formations with nothing taken go whole into `ausentes`; a sub-formation with
// something taken stays as a heading, with its untaken own units named by ORDINAL in
// `ausentesUnidades` (by name would be ambiguous the moment a platoon has three squads called the
// same thing) and its own sub-formations recursed; the untaken loose units of the top formation go
// in `ausentesSoltas`, the battalion headquarters among them.
export function pruneSpec(tree, isTaken) {
  const has = (node) => (node.isFormation ? node.children.some(has) : isTaken(node.key));
  const untakenOrdinals = (node) => node.children.filter((c) => !c.isFormation).map((c, i) => (isTaken(c.key) ? 0 : i + 1)).filter(Boolean);
  const spec = (node) => {
    const out = [];
    for (const child of node.children) {
      if (!child.isFormation) continue;
      if (!has(child)) { out.push({ nome: child.name, ocorrencia: child.occurrence }); continue; }
      const sub = spec(child), ords = untakenOrdinals(child);
      if (sub.length || ords.length) out.push({ nome: child.name, ocorrencia: child.occurrence, ...(sub.length ? { ausentes: sub } : {}), ...(ords.length ? { ausentesUnidades: ords } : {}) });
    }
    return out;
  };
  const root = tree.roots[0];
  const ausentes = spec(root), soltas = untakenOrdinals(root);
  return { ...(ausentes.length ? { ausentes } : {}), ...(soltas.length ? { ausentesSoltas: soltas } : {}) };
}

// O INIMIGO E UM LADO, E UM LADO PODE TER MAIS DE UM EXERCITO. "United States and Ukraine" nao
// pode ser um rotulo que so entrega americanos. Desde 05/10/2026 (autor: a composicao deve MISTURAR
// americanos e ucranianos) o pool de compra e a uniao das bibliotecas de todos os exercitos do lado,
// e o sorteio por papel/tipo mistura os dois na mesma batalha — como a forca do jogador US+UKR ja
// fazia. O cabecalho do arquivo declara UMA nacao para o lado azul (FORMATO 108, so o rotulo do
// AAR): `nation` e o exercito que levou mais credito; `nations` lista os que entraram.
export function planDefense({ nation, nations, battleNumber, rules, seed, profile = 'misto', effort = 1, kind = null, trace }) {
  const tier = tierOf(battleNumber, rules);
  const D = rules.defense;
  const kindFactor = rules.maps?.kindBudgetFactor?.[kind] ?? 1;
  const random = rng(seed + battleNumber * 7919);

  const exercitos = (nations && nations.length ? nations : [nation]).filter(Boolean);
  if (!exercitos.length) throw new Error('no defense nation');
  random();   // o sorteio antigo da nacao: mantido para nao deslocar a sequencia da semente

  // A defesa NAO paga pela experiencia: ela vem do tier, e o orcamento por tier ja e a alavanca
  // de dificuldade. Deixar o fator entrar aqui mudaria o tamanho da defesa de graca (112.13).
  const semXP = { ignoreExperience: !rules.units.experiencePricing?.enemy };
  const sources = exercitos.flatMap((n) => poolOf(n, rules, semXP).map((s) => ({ ...s, nation: n })));
  if (!sources.length) throw new Error(`no library formations for ${exercitos.join('+')}`);
  // OS TRANSPORTES QUE A DEFESA NAO COMPRA (20/10, autor: do MT-LB, so o 6MB), por exercito da fonte
  const semTransporte = Object.fromEntries(Object.entries(D.carrierExclude || {}).map(([n, re]) => [n, new RegExp(re)]));
  const allUnits = sources.flatMap((s) => s.units.map((u) => (u.bucket === 'carriers' && semTransporte[s.nation]?.test(u.name) ? { ...u, bucket: 'never' } : u)));
  const allLots = sources.flatMap((s) => s.lots);

  // The five budgets of this battle (`tierBudgets`, E47): the sum is what the battle's reward is
  // computed from, which is how the player's income follows the enemy up the curve.
  const growth = Math.pow(D.battleGrowth ?? 1, Math.max(0, tier.battles.indexOf(battleNumber)));
  const { total: _ignore, ...base } = tierBudgets(battleNumber, rules, { effort, kind });
  // THE MAP PROFILE MOVES MONEY, it does not rewrite the table: urban takes a share of the
  // vehicle money to the infantry, open takes a share of the infantry money to the vehicles, each
  // side split in proportion to what it already had.
  const shift = D.profileShift?.[profile] ?? 0;
  const move = (from, to, fraction) => {
    const total = from.reduce((a, b) => a + base[b], 0);
    const toTotal = to.reduce((a, b) => a + base[b], 0);
    if (!total || !toTotal) return;
    const amount = Math.round(total * fraction);
    for (const b of from) base[b] -= Math.round(amount * base[b] / total);
    for (const b of to) base[b] += Math.round(amount * base[b] / toTotal);
  };
  // com cota de equipes (20/10) o mapa aberto tira so das esquadras: o dinheiro das equipes e o da cota
  if (shift > 0) move(tier.teamQuota ? ['squads'] : ['squads', 'teams'], ['carriers', 'tanks'], shift);
  if (shift < 0) move(['carriers', 'tanks'], ['squads', 'teams'], -shift);
  // THE SURPRISE TANK: where the tier buys no tanks, a seeded roll may still field one — the
  // price of the cheapest main battle tank goes into the tank budget (after the profile has moved
  // its money, so an urban map cannot shave it below a tank) and the role is allowed for this
  // battle only. The roll is drawn whatever the tier, so the seed's sequence does not shift
  // between tiers.
  let surprise = 0;
  const roll = random();
  if (!base.tanks && tier.tankChance && roll < tier.tankChance) {
    const cheapest = Math.min(...allUnits.filter((u) => u.bucket === 'tanks' && /Main Battle Tank/.test(u.name)).map((u) => u.price));
    if (Number.isFinite(cheapest)) { surprise = cheapest; base.tanks = surprise; }
  }
  // THE SURPRISE MORTAR (autor, 11/10: "35% de probabilidade de morteiro off-map no tier 1"): the same rule as the tank —
  // where the tier gives the off-map bucket nothing, a seeded roll may still bring ONE battery, the side's cheapest
  // off-map mortar, its price on top of the budget. Drawn whatever the tier, like the tank's.
  let surpriseMortar = 0;
  const rollMortar = random();
  if (!base.offMap && tier.mortarChance && rollMortar < tier.mortarChance) {
    const cheapest = Math.min(...allUnits.filter((u) => u.bucket === 'offMap' && u.role === 'mortar_off').map((u) => u.price));
    if (Number.isFinite(cheapest)) { surpriseMortar = cheapest; base.offMap = surpriseMortar; }
  }
  // THE SCOUTS' SHARE (autor, 11/10): a share of the squad money, after the profile has moved it, goes to the scout and
  // recon squads. The total does not change, so neither does the reward.
  base.scouts = Math.round((base.squads || 0) * (D.scouts?.share || 0));
  base.squads -= base.scouts;
  // A FATIA DOS TANQUES (18/10, autor): onde o tier da uma parte do orcamento aos tanques pelo perfil do mapa, ela sai so
  // de esquadras, equipes e transportes, na proporcao de cada um. Scouts e fora do mapa nao mudam, nem o total.
  const fatiaTanques = D.tankLadder?.on === false ? 0 : (tier.tankShareByProfile?.[profile] || 0);
  let tankShare = null;
  if (fatiaTanques > 0) {
    const total0 = BUCKETS.reduce((a, b) => a + base[b], 0);
    const M = Math.round(total0 * fatiaTanques);
    // com cota de equipes (20/10) o dinheiro delas fica: a fatia sai de esquadras e transportes
    const de = tier.teamQuota ? ['squads', 'carriers'] : ['squads', 'teams', 'carriers'];
    const soma = de.reduce((a, b) => a + (base[b] || 0), 0);
    const from = {}; let resta = M;
    de.forEach((b, i) => { const x = i === de.length - 1 ? resta : Math.round(M * (base[b] || 0) / soma); base[b] -= x; from[b] = x; resta -= x; });
    base.tanks = (base.tanks || 0) + M;
    tankShare = { share: fatiaTanques, money: M, from };
  }
  const budget = BUCKETS.reduce((a, b) => a + base[b], 0);
  // a folga do balde de tanques so para os exercitos de slackFor (18/10: a Russia, cujo T-72B3 custa 1100)
  const folgaTanques = tankShare && exercitos.every((n) => (D.tankLadder?.slackFor || []).includes(n)) ? Math.round(budget * (D.bucketSlack || 0)) : 0;

  const permitted = new Set([...(D.alwaysAllowed || []), ...(tier.unlocks || [])]);
  if (surprise || tankShare) permitted.add('tank');
  if (surpriseMortar) permitted.add('mortar_off');
  // A COTA DE EQUIPES (autor, 20/10: "entre 3-4 HMG e entre 2-3 ATGM" no tier 1, ATGM 1-2 na batalha 1): por papel, um
  // numero sorteado no intervalo do tier (`tiers[].teamQuota`, com `byBattle` pela posicao da batalha no tier por cima).
  // Fluxo de sorteio proprio, para nao deslocar os sorteios de sempre. A cota e comprada antes dos pelotoes e vira o
  // teto do papel ate o fim do plano.
  // A COTA DE ANTIAEREA (autor, 02/11: `tiers[].aaQuota`) entra nas mesmas faixas: tier 2 0-2 MANPADS, tier 3 1 SPAAG,
  // tier 4 2 SPAAG. Chave propria porque a `teamQuota` muda o caminho do dinheiro entre os baldes, e isso nao muda.
  const quota = {};
  if (tier.teamQuota || tier.aaQuota) {
    const pos = String(tier.battles.indexOf(battleNumber) + 1);
    const faixas = { ...(tier.teamQuota || {}), ...(tier.teamQuota?.byBattle?.[pos] || {}), ...(tier.aaQuota || {}) };
    const rq = rng(((seed ^ 0x5bd1e995) >>> 0) + battleNumber * 104729);
    for (const [role, f] of Object.entries(faixas)) {
      if (!Array.isArray(f) || !permitted.has(role)) continue;
      const [lo, hi] = f;
      quota[role] = { lo, hi, want: lo + Math.floor(rq() * (hi - lo + 1)), got: 0 };
    }
    // AS AVULSAS DO EDITOR (autor, 28/10): parte da cota mg — nao a mais — sai das equipes de metralhadora soltas dos
    // arquivos de `defense.specialistTeams` (LMG Team (PKP), Machinegun Team (PKM)); sorteadas depois das outras faixas
    // para nao deslocar os sorteios de sempre. Nacao sem esses arquivos: nada muda.
    const fontes = new Set(exercitos.flatMap((n) => D.specialistTeams?.[n] || []));
    if (quota.mg && Array.isArray(faixas.mgSingles) && fontes.size) {
      const [lo, hi] = faixas.mgSingles;
      quota.mg.singles = { lo, hi, want: Math.min(quota.mg.want, lo + Math.floor(rq() * (hi - lo + 1))), got: 0, sources: fontes };
    }
  }
  const target = (b) => base[b];
  // A FATIA DAS EQUIPES E RESERVADA (autor, 08/11: "eles costumam ser mais importantes que tanques" — a b7 da US saiu com
  // 4 tanques e 0 equipes avulsas, o 4o tanque pago com o dinheiro delas). Ate a compra das equipes, toda unidade avulsa
  // (tanque, scout, transporte) precisa caber no orcamento MENOS o que ainda falta para a fatia das equipes; e o balde de
  // tanques (compra simples, sem surpresa nem escada) nao passa do alvo com o dinheiro das fatias que vem depois (scouts,
  // esquadras, transportes, equipes) — a folga dele fica para a sobra (passo 6). Os lotes de esquadras nunca sao barrados
  // pela reserva (simulado com a reserva neles: 16 de 40 defesas da b1 sem pelotao). Simulado em 08/11: b7 real 4 tanques /
  // 8 equipes / 9 transportes -> 3 + Khrizantema / 16 / 14; a media das equipes no tier 3 RU de 51 % para 77 % da fatia.
  let faseEquipes = false, faseTanques = false;
  const reserva = (b) => faseEquipes ? 0 : faseTanques && b === 'tanks'
    ? ['scouts', 'squads', 'carriers', 'teams'].reduce((a, c) => a + Math.max(0, target(c) - spent[c]), 0)
    : Math.max(0, target('teams') - spent.teams);
  // Each bucket may overspend its budget by `bucketSlack` of the total, so the money a category
  // could not spend to the credit (a tank does not divide) is not lost — except off-map, which is
  // a hard cap, and a category with no budget at all, which stays at zero.
  // The scouts are a SHARE (autor: 20%), not a floor: they may pass it by one squad, never take the leftover money of
  // the other categories (at battle 11 the slack made them 37% of the squad money).
  const maxScout = Math.max(0, ...allUnits.filter((u) => u.bucket === 'scouts').map((u) => u.price));
  // O TANQUE SURPRESA E O MAIS BARATO (18/10, autor: a RUS2 b1 tirou um BM Oplot, e o mais barato da Ucrania e o T-64):
  // a folga deixava o sorteio escolher qualquer tanque ate o preco do mais barato + 10% do orcamento. Sem folga, so ele.
  const cap = (b) => (b === 'offMap' || !base[b] ? base[b] : b === 'tanks' && surprise ? base[b] : b === 'tanks' && tankShare ? base[b] + folgaTanques : b === 'scouts' ? base[b] + maxScout : Math.round(base[b] + budget * (D.bucketSlack || 0)));

  const spent = { squads: 0, scouts: 0, teams: 0, carriers: 0, tanks: 0, offMap: 0 };
  // CEILINGS IN UNITS (`defense.unitCaps`), whatever the money says: the biggest scenario the
  // developers shipped has 130 units on a side, and a budget that buys 250 buys a battle the
  // engine has never been seen to carry. The count is per category (HQ teams ride along free and
  // are not counted) plus one for everything on the map.
  const count = { squads: 0, scouts: 0, teams: 0, carriers: 0, tanks: 0, offMap: 0, onMap: 0 };
  const CAPS = D.unitCaps || {};
  const capUnits = (b) => (CAPS[b] ?? Infinity);
  const roomFor = (bucket, n, offMap) => count[bucket] + n <= capUnits(bucket) && (offMap || count.onMap + n <= capUnits('onMap'));
  const spentByRole = {};
  let paid = 0, full = 0;
  const taken = new Set(), used = new Set();
  const unitsTaken = [], lotsTaken = [];
  // A source that is nothing but off-map (a mortar platoon file, a battery, a helicopter) does
  // not count against `maxSources`: it is one unit and no clutter on the map, and at twice the
  // budget the five slots were all taken by battalions before the second mortar platoon could
  // come in, starving the off-map bucket at 5% of a 10% cap.
  //
  // NOR DOES AN AIR-DEFENCE BATTERY (02/10). Tunguska and Strela-10 exist only inside their own
  // batteries, and the battalions took the five slots first: 0 self-propelled AA in 240 defences of
  // battles 10-12 with the role unlocked. A source whose buyable units are all air defence (the rest
  // is a command vehicle or an HQ, never bought) is one or two vehicles, like a mortar platoon.
  const AIR_DEFENCE = new Set(['aa', 'manpads']);
  const offMapOnly = new Set(sources.filter((s) => s.units.every((u) => u.bucket === 'offMap' || u.bucket === 'never')
    || (s.units.some((u) => AIR_DEFENCE.has(u.role) && u.bucket !== 'never') && s.units.every((u) => u.bucket === 'never' || AIR_DEFENCE.has(u.role)))).map((s) => s.f.source));
  // a fonte aberta pela cota (20/10) tambem fica fora da conta: a cota e doutrina, nao pode perder a vaga para um pelotao
  const quotaSources = new Set();
  // e a secao do controlador aereo (02/11), que vem com a aviacao e nao ocupa vaga
  const airObserverSources = new Set();
  const onMapSources = () => [...used].filter((s) => !offMapOnly.has(s) && !quotaSources.has(s) && !airObserverSources.has(s)).length;
  const canUse = (src) => used.has(src) || offMapOnly.has(src) || quotaSources.has(src) || onMapSources() < (D.maxSources || 5);
  // A role may take at most `roleCap[role]` of its bucket's share: nine Igla teams in a defense
  // against a player with no aircraft is what a blind draw produced once the machine guns of the
  // sources in use had run out.
  // e o papel com cota (20/10) para no numero sorteado: nem o pelotao traz mais um embutido
  const roleFits = (role, bucket, price) => !(quota[role] && quota[role].got >= quota[role].want)
    && (D.roleCap?.[role] === undefined || (spentByRole[role] || 0) + price <= cap(bucket) * D.roleCap[role]);
  // E o tanque surpresa e um CARRO DE COMBATE (18/10): o papel 'tank' tambem cobre os caca-tanques (Shturm-S, Khrizantema),
  // e o dinheiro da surpresa comprava dois deles no tier 1 em vez de um tanque.
  const surpresaSoCarro = (u) => !surprise || base.tanks !== surprise || u.bucket !== 'tanks' || /Main Battle Tank/.test(u.name);
  const fitsUnit = (u) => !taken.has(u.id) && !u.lot && u.bucket !== 'never' && permitted.has(u.role) && surpresaSoCarro(u) && paid + u.price <= budget - reserva(u.bucket) && spent[u.bucket] + u.price <= cap(u.bucket) && roleFits(u.role, u.bucket, u.price) && roomFor(u.bucket, 1, u.offMap) && canUse(u.source);
  // What of a lot comes along: its squads and its HQ team always; a weapons team of the platoon
  // only if the tier allows the role and the role is under its cap — a Ukrainian platoon carries
  // an Igla team, and nine platoons must not mean nine MANPADS. The rest of the platoon is left
  // masked in the file like anything else not bought.
  const partsOf = (l) => {
    const units = l.units.filter((u) => u.bucket !== 'teams' || (permitted.has(u.role) && roleFits(u.role, 'teams', u.price)));
    const paidUnits = units.filter((u) => u.role !== 'hq' || D.freeHeadquarters === false);
    const spend = { squads: 0, teams: 0 };
    for (const u of paidUnits) spend[u.bucket] += u.price;
    return { units, price: spend.squads + spend.teams, full: units.reduce((a, u) => a + u.price, 0), spend };
  };
  const fitsLot = (l) => {
    if (taken.has(l.id) || !canUse(l.source)) return false;
    if (!l.units.every((u) => u.bucket === 'teams' || permitted.has(u.role))) return false;
    const p = partsOf(l);
    const nSquads = p.units.filter((u) => u.bucket === 'squads').length, nTeams = p.units.filter((u) => u.bucket === 'teams').length;
    return paid + p.price <= budget && spent.squads + p.spend.squads <= cap('squads') && spent.teams + p.spend.teams <= cap('teams') && roleFits(l.squadRole, 'squads', p.spend.squads)
      && count.squads + nSquads <= capUnits('squads') && count.teams + nTeams <= capUnits('teams') && count.onMap + p.units.length <= capUnits('onMap');
  };
  const takeUnit = (u) => {
    taken.add(u.id); used.add(u.source); paid += u.price; full += u.price; spent[u.bucket] += u.price; spentByRole[u.role] = (spentByRole[u.role] || 0) + u.price; unitsTaken.push(u);
    count[u.bucket]++; if (!u.offMap) count.onMap++;
    if (quota[u.role]) quota[u.role].got++;
  };
  const takeLot = (l) => {
    const p = partsOf(l);
    taken.add(l.id); used.add(l.source); lotsTaken.push({ ...l, units: p.units, price: p.price });
    for (const u of p.units) {
      taken.add(u.id); unitsTaken.push(u); full += u.price; count.onMap++;
      if (quota[u.role]) quota[u.role].got++;
      if (u.role === 'hq' && D.freeHeadquarters !== false) continue;
      count[u.bucket]++;
      paid += u.price; spent[u.bucket] += u.price; spentByRole[u.role] = (spentByRole[u.role] || 0) + u.price;
    }
    return p;
  };
  // BY ROLE, THEN BY TYPE, THEN BY UNIT. The library has 189 rifle squads and 23 engineer squads,
  // but five kinds of engineer platoon and two of rifle platoon; seven kinds of sniper and machine
  // gun team against one kind of ATGM squad. A draw over units would never field the rare thing,
  // a draw over types fields snipers a third of the time and engineers before riflemen. So the
  // ROLE is drawn first, weighted (`defense.draw` — riflemen over engineers, machine guns over
  // snipers), then the type uniformly within the role, then the unit — preferring a source
  // already in use, so the file does not fill with one-unit battalions.
  const weighted = (roles, weights) => {
    const total = roles.reduce((a, r) => a + (weights[r] ?? 1), 0);
    let x = random() * total;
    for (const r of roles) { x -= weights[r] ?? 1; if (x < 0) return r; }
    return roles[roles.length - 1];
  };
  const draw = (cands, roleOfCand, typeOf, weights) => {
    const role = weighted([...new Set(cands.map(roleOfCand))], weights || {});
    const ofRole = cands.filter((c) => roleOfCand(c) === role);
    const types = [...new Set(ofRole.map(typeOf))];
    const t = types[Math.floor(random() * types.length)];
    const same = ofRole.filter((c) => typeOf(c) === t);
    const known = same.filter((c) => used.has(c.source));
    const from = known.length ? known : same;
    return from[Math.floor(random() * from.length)];
  };
  const family = (src) => (src.match(/\[([^\]]+)\]/) || [, src.replace(/^\w+ - /, '')])[1];
  const lotRole = (l) => l.squadRole;
  const lotType = (l) => `${l.name} · ${l.squadType} · ${family(l.source)}`;
  const unitRole = (u) => u.role;
  const unitType = (u) => u.name;
  const W = D.draw || {};
  const trail = [];

  // 1. OFF-MAP first, under the hard cap: it almost always needs a source of its own (a mortar
  // platoon, a battery). 2. SQUADS, in lots, up to their budget. 3. TANKS — before the carriers,
  // because a tank battalion is a source of its own and the sources are counted. 4. CARRIERS —
  // with a taste for the carriers of the platoons already bought, so a BTR platoon keeps some of
  // its BTRs and the rest of the money buys whatever the nation drives. 5. WEAPONS TEAMS, one by
  // one, last: every source has them — e a fatia delas fica reservada ate aqui (08/11, `reserva`).
  const buyLots = (stopAt) => {
    while (spent.squads < stopAt) {
      const cands = allLots.filter(fitsLot);
      if (!cands.length) return false;
      const l = draw(cands, lotRole, lotType, W.squads); const p = takeLot(l); trail.push({ lot: l.name, source: l.source, price: p.price });
    }
    return true;
  };
  const buyUnits = (bucket, stopAt, prefer = null) => {
    while (spent[bucket] < stopAt) {
      let cands = allUnits.filter((u) => u.bucket === bucket && fitsUnit(u));
      if (!cands.length) return false;
      if (prefer) { const p = cands.filter(prefer); if (p.length && random() < (D.ownCarriersFirst ?? 0.6)) cands = p; }
      const u = draw(cands, unitRole, unitType, W[bucket]); takeUnit(u); trail.push({ unit: u.name, source: u.source, price: u.price });
    }
    return true;
  };
  buyUnits('offMap', target('offMap'));
  // A AVIACAO TRAZ O CONTROLADOR (02/11): para cada exercito que levou aviacao, a Air Controller Section dele, inteira e de
  // graca (nao entra em `paid` nem nos baldes; o valor conta em `full`, como o QG isento). Nao sorteia nada.
  const airObservers = [];
  for (const n of exercitos) {
    if (!unitsTaken.some((u) => u.role === 'air' && sources.find((s) => s.f.source === u.source)?.nation === n)) continue;
    const sec = airObserverSection(n, rules, semXP);
    if (!sec) { trace?.event('defense.noAirObservers', { nation: n }); continue; }
    if (used.has(sec.f.source)) continue;
    if (!sources.some((s) => s.f.source === sec.f.source)) sources.push({ ...sec, nation: n });
    airObserverSources.add(sec.f.source); used.add(sec.f.source);
    for (const u of sec.units) {
      taken.add(u.id); unitsTaken.push(u); full += u.price; count.onMap++;
      trail.push({ unit: u.name, source: u.source, price: 0, airObserver: true });
    }
    airObservers.push({ nation: n, source: sec.f.source, units: sec.units.map((u) => u.name), price: sec.units.reduce((a, u) => a + u.price, 0) });
  }
  // A ESCADA DOS TANQUES (18/10, autor): tanque Veteran > Regular > Green > caca-tanque. UM carro de combate, o mais barato
  // do lado, no nivel mais alto que cabe no balde; o resto do balde em cacas-tanques, na experiencia do tier.
  let tankLadder = null;
  if (tankShare) {
    const carros = allUnits.filter((u) => u.bucket === 'tanks' && /Main Battle Tank/.test(u.name));
    const precoMin = carros.length ? Math.min(...carros.map((u) => u.price)) : Infinity;
    const maisBaratos = carros.filter((u) => u.price === precoMin);
    const fatores = rules.units.experienceFactor || {};
    for (const nivel of (D.tankLadder?.order || ['Veteran', 'Regular', 'Green'])) {
      if (!Number.isFinite(precoMin)) break;
      const preco = Math.round(precoMin * (fatores[nivel] ?? 1) / (fatores.Veteran ?? 1));
      const cands = maisBaratos.filter((u) => fitsUnit({ ...u, price: preco }));
      if (!cands.length) continue;
      const u = { ...draw(cands, unitRole, unitType, W.tanks), price: preco, experience: nivel };
      takeUnit(u); trail.push({ unit: u.name, source: u.source, price: preco, experience: nivel, ladder: true });
      tankLadder = { name: u.name, experience: nivel, price: preco };
      break;
    }
    for (;;) {
      const cands = allUnits.filter((u) => u.bucket === 'tanks' && !/Main Battle Tank/.test(u.name) && fitsUnit(u));
      if (!cands.length) break;
      const u = draw(cands, unitRole, unitType, W.tanks); takeUnit(u); trail.push({ unit: u.name, source: u.source, price: u.price, ladder: true });
    }
  } else {
    faseTanques = true; buyUnits('tanks', target('tanks')); faseTanques = false;
  }
  buyUnits('scouts', target('scouts'));
  // A COTA (20/10), ANTES dos pelotoes: atingida, o pelotao comprado depois nao traz mais aquele papel embutido (o
  // pelotao de fuzileiros americano traz o Team (Javelin) de 400 cr, e dois deles esgotavam o orcamento antes das
  // metralhadoras). Avulsas do balde de equipes; a fonte nova da cota nao ocupa vaga de `maxSources`. Dentro do orcamento
  // total sem tocar no dinheiro das esquadras (nunca falta pelotao), acima do teto do balde e do roleCap (a cota e a
  // doutrina). O mais barato do papel manda: so entra o que custa ate o dobro do minimo (o ATGM ucraniano, nao o Javelin).
  // As avulsas do editor (q.singles, 28/10) vem primeiro e so das fontes delas; o resto da cota, de qualquer outra fonte.
  // O balde e o do papel (02/11): o SPAAG sai dos transportes, o MANPADS das equipes.
  const cotaDe = (role, q, deFonte, ate) => {
    const balde = D.buckets.carriers.includes(role) ? 'carriers' : 'teams';
    while (q.got < ate()) {
      const livre = budget - target('squads');
      let cands = allUnits.filter((u) => !taken.has(u.id) && !u.lot && u.bucket === balde && u.role === role && deFonte(u.source) && paid + u.price <= livre && roomFor(balde, 1, u.offMap));
      if (!cands.length) return false;
      const minimo = Math.min(...cands.map((u) => u.price));
      cands = cands.filter((u) => u.price <= minimo * 2);
      const emUso = cands.filter((u) => used.has(u.source));
      const u = draw(emUso.length ? emUso : cands, unitRole, unitType, W[balde]);
      if (!used.has(u.source)) quotaSources.add(u.source);
      takeUnit(u);
      trail.push({ unit: u.name, source: u.source, price: u.price, quota: role, ...(q.singles?.sources.has(u.source) ? { single: true } : {}) });
    }
    return true;
  };
  for (const [role, q] of Object.entries(quota)) {
    const s = q.singles;
    if (s) { const antes = q.got; cotaDe(role, q, (src) => s.sources.has(src), () => antes + s.want); s.got = q.got - antes; }
    cotaDe(role, q, (src) => !s || !s.sources.has(src), () => q.want);
  }
  // SPAAG QUE FALTA VIRA MANPADS (autor, 02/11): a forca sem antiaereo para comprar (ou sem dinheiro para ele) leva
  // uma equipe MANPADS por SPAAG que faltou.
  let aaFallback = 0;
  if (quota.aa && quota.aa.got < quota.aa.want && permitted.has('manpads')) {
    aaFallback = quota.aa.want - quota.aa.got;
    const m = quota.manpads || (quota.manpads = { lo: 0, hi: 0, want: 0, got: 0 });
    m.want += aaFallback;
    cotaDe('manpads', m, () => true, () => m.want);
  }
  buyLots(target('squads'));
  buyUnits('carriers', target('carriers'), (u) => u.carrierOf && taken.has(u.carrierOf.id));
  faseEquipes = true; buyUnits('teams', target('teams'));

  // 6. THE REST. What a category could not spend to the credit (tier 1 has nothing off-map to
  // buy, a tank does not divide) goes to the on-map bucket furthest below its budget, one purchase
  // at a time, each bucket capped at its budget plus the slack.
  for (let volta = 0; volta < 80; volta++) {
    const order = ['squads', 'scouts', 'teams', 'carriers', ...(tankShare ? [] : ['tanks'])].sort((a, b) => (target(b) - spent[b]) - (target(a) - spent[a]));
    let bought = false;
    for (const b of order) {
      if (b === 'squads') {
        const cands = allLots.filter(fitsLot);
        if (cands.length) { const l = draw(cands, lotRole, lotType, W.squads); const p = takeLot(l); trail.push({ lot: l.name, source: l.source, price: p.price, slack: true }); bought = true; break; }
      } else {
        const cands = allUnits.filter((u) => u.bucket === b && fitsUnit(u));
        if (cands.length) { const u = draw(cands, unitRole, unitType, W[b]); takeUnit(u); trail.push({ unit: u.name, source: u.source, price: u.price, slack: true }); bought = true; break; }
      }
    }
    if (!bought) break;
  }

  // The file: one pruned copy of each library formation touched. Which formations appear in the
  // plan's log is also what the player reads on the battle screen.
  const usedSources = sources.filter((s) => used.has(s.f.source));
  const pagoPorNacao = {};
  for (const u of unitsTaken.filter((x) => !x.free)) { const n = sources.find((s) => s.f.source === u.source)?.nation; pagoPorNacao[n] = (pagoPorNacao[n] || 0) + u.price; }
  const entraram = exercitos.filter((n) => pagoPorNacao[n]);
  nation = entraram.slice().sort((a, b) => pagoPorNacao[b] - pagoPorNacao[a])[0] || exercitos[0];
  const formations = usedSources.map((s) => ({
    formacao: path.join(paths().lib, s.f.file),
    ...pruneSpec(s.tree, (key) => taken.has(`${s.f.source}|${key}`)),
    atributos: { experiencia: tier.experience, motivacao: tier.motivation },
  }));

  const byRole = {}, byType = {}, byBucket = {};
  for (const u of unitsTaken) {
    byRole[u.role] = (byRole[u.role] || 0) + u.price;
    byType[u.name] = (byType[u.name] || 0) + 1;
    byBucket[u.bucket === 'never' ? 'hq' : u.bucket] = (byBucket[u.bucket === 'never' ? 'hq' : u.bucket] || 0) + 1;
  }
  const mix = Object.fromEntries(BUCKETS.map((b) => [b, paid ? Math.round((spent[b] / paid) * 100) / 100 : 0]));
  const onMap = unitsTaken.filter((u) => !u.offMap).length;
  if (onMap < rules.defense.keepAtLeastUnits) trace?.event('defense.tooSmall', { units: onMap, budget, nation });
  // A defense with no platoon of infantry is the failure this planner exists to prevent, and it is
  // silent in game — the player just wins. Shout about it in the log.
  if (!lotsTaken.length) trace?.event('defense.noManoeuvreUnit', { budget, cost: paid, nation, profile, taken: Object.keys(byType) });

  const plan = {
    // What the battle screen names: the library formations this defense was drawn from.
    backbone: usedSources.map((s) => s.f.source.replace(/^\w+ - /, '')).join(' + '),
    sources: usedSources.map((s) => s.f.source),
    // How many of them put units on the map — the number `maxSources` bounds.
    sourcesOnMap: onMapSources(),
    // Quem defende ESTA batalha. Vai para o cabecalho do arquivo e para a tela.
    nation,
    nations: entraram,
    creditsByNation: pagoPorNacao,
    profile,
    effort,
    kind,
    kindFactor,
    budget,
    // The five budgets this battle was bought against (after growth, effort, kind and profile),
    // and the tier's table before all that.
    budgets: { ...base },
    tierBudgets: { ...(tier.budgets || {}) },
    growth,
    profileShift: shift,
    surpriseTank: surprise,
    surpriseMortar,
    // a fatia dos tanques e o que a escada comprou (18/10)
    tankShare,
    tankSlack: tankShare ? folgaTanques : null,
    tankLadder,
    // a cota de equipes (20/10): o sorteado e o comprado, por papel
    teamQuota: Object.keys(quota).length ? Object.fromEntries(Object.entries(quota).map(([k, q]) => [k, { range: [q.lo, q.hi], want: q.want, got: q.got, ...(q.singles ? { singles: { range: [q.singles.lo, q.singles.hi], want: q.singles.want, got: q.singles.got } } : {}) }])) : null,
    // SPAAG da cota que nao havia para comprar e virou MANPADS (02/11)
    ...(aaFallback ? { aaFallback } : {}),
    // atributos por UNIDADE, escritos depois da geracao (forge.buildBattle): o tanque da escada num nivel diferente do tier
    unitAttributes: tankLadder && tankLadder.experience !== tier.experience ? [{ side: 'azul', name: tankLadder.name, experiencia: tankLadder.experience }] : [],
    baseBudget: Math.round(budget / (effort * kindFactor)),
    cost: paid,
    // O que a forca vale de verdade, com os QGs contados. A diferenca e a isencao, no log para que
    // a calibragem nao precise adivinhar.
    fullCost: full,
    freeHeadquarters: full - paid - airObservers.reduce((a, o) => a + o.price, 0),
    // a secao do controlador aereo que veio com a aviacao, de graca (02/11)
    ...(airObservers.length ? { airObservers } : {}),
    spent: { ...spent },
    // Units per category against their ceilings — the log says which wall the money hit.
    count: { ...count },
    unitCaps: { ...CAPS },
    capped: BUCKETS.filter((b) => count[b] >= capUnits(b)).concat(count.onMap >= capUnits('onMap') ? ['onMap'] : []),
    mix,
    byRole,
    byBucket,
    units: unitsTaken.length,
    onMapUnits: onMap,
    offMapUnits: unitsTaken.length - onMap,
    tier: tier.tier,
    experience: tier.experience,
    motivation: tier.motivation,
    unlocks: tier.unlocks || [],
    lots: lotsTaken.map((l) => ({ name: l.name, occurrence: l.occurrence, source: l.source, units: l.units.length, price: l.price })),
    kept: Object.entries(byType).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
    trail,
    formations,
  };
  trace?.event('defense.planned', { ...plan, formations: undefined, prune: formations.map((f) => ({ ...f, formacao: path.basename(f.formacao) })) });
  return plan;
}
