// THE CAMPAIGN ITSELF.
//
// A campaign is a folder under `<data folder>/campaigns/<slug>` (settings.mjs USER_DIR) holding everything the app knows: the state,
// the log, and a copy of every file it produced. Nothing lives only in the game folder, so a bug
// report is one folder.
//
// The loop, from the game's point of view:
//   the .cam carries two battles that point at each other. The player starts the campaign, plays
//   battle A, and the engine forces a save at the transition. The app reads that save (roster and
//   AAR), lets the player spend credits, writes the NEXT battle into the very same save, and hands
//   it back. Loading that save starts the next battle with the survivors. Proven in FORMATO 111.9
//   (the save is not validated) and 111.27 (a whole generated campaign was played).
import fs from 'node:fs';
import path from 'node:path';
import { paths, CAMPAIGNS_DIR, USER_DIR, DATA_DIR, RESEARCH_DIR } from './settings.mjs';
import { APP_VERSION } from './pacote.mjs';
import { Trace, fileFacts } from './trace.mjs';
import { readingOf, formationTree, prunePlan, priceUnits, priceUnit, roleOf, mapPool, mapCensus, mapKey, loadsInGame, meetCensus, meetPool, authoredPlan, mapFile as mapFileOf, uncoveredUnits, rosterTemplates, SIDES, otherSide, armiesOf, specialForcesOf, specialForcesKeep } from './catalog.mjs';
import { planDefense, tierOf, durationFor, rng, budgetFor, tierBudgets } from './defense.mjs';
import { generatePath, publicPath, publicView, revealCost, START_ID, campaignCalendar, hashSeed, weatherFor, weatherWeights } from './path.mjs';
import { planMeetForce, meetBuildInputs } from './meet.mjs';
import { rebuildVehicles, resetLaunchers, resetSmoke, stripVehicleGear, buildCoreForce, buildBattle, buildCampaign, injectBattle, replaceMen, restoreWeapons, resupply, grantAmmo, resupplyVehicles, unitDirectory, enemyDirectory, activateUnits, growCoreForce, growSaveRoster, applyAttributes, syncRosterAttributes } from './forge.mjs';
import { writeHeader, EXPERIENCE_LEVELS } from './re.mjs';
import { readKills, readPersonnel } from './personnel.mjs';
import { unitLedger, honourableMentions, leadersOf } from './honours.mjs';
import { findCampaignSaves, saveFacts, sha1, LIVE_BATTLE_BYTES, readTransition, casualtyList, lightlyWounded, toeWeapons, lostWeapons, offIssueWeapons, fullLoads, poolLoads, missingLoads, missingGrenades, resetPlan, AAR_ZERO } from './transition.mjs';
import { readGear, priceGear, applyGear, forgetGear, priceKit, applyKit, kitAmmo, kitAmmoForReset } from './gear.mjs';
import { issueTable as readIssueTable } from '../../tools/re/dotacao.mjs';
import { imageId, APP_IMAGES, desenharParaApp } from '../../tools/re/galeria_mapas.mjs';
import { atlas, arvoreDoCaminho, pngParaBmp, lerPng } from './imagem.mjs';
import { bmpIntegro } from '../../tools/re/bmp_integro.mjs';
import { toeWeaponTable, weaponAmmoTable, sidearmTable, toeVehicleTable, openBtt, forceTree, contentEnd, unitPosition, unitBlocks, vehicleStates, vehicleStateOfBlock, readRoster, readRosterTails, readAmmoVector, immobilizedAtEnd, restoreGrenades, rearmMen, removeAmmo, armiesOfSave, crewAtEnd, equipmentTable, unitTypeName, typeKey, VICTORY_LEVELS, writeManBytes, restoreRosterLines, removeAbsentUnits, coreUnits as coreUnitsOf } from './re.mjs';

export const STATE_VERSION = 1;

export function rules() {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'rules.json'), 'utf8'));
}

// The roster block for every unit type, harvested from stock campaigns. Needed to give a unit
// bought mid-campaign its line in the save's roster.
export function typeTable() {
  return JSON.parse(fs.readFileSync(paths().typeTable, 'utf8'));
}

// The eight bytes of campaign policy, in the order the file wants them: blue refit, repair,
// resupply, rest, then red. Both sides get the same numbers — the enemy has no roster to carry
// anything between battles anyway.
export function campaignPercentages(R = rules(), ajuste = {}) {
  const p = { ...(R.campaign?.percentages || { refit: 0, repair: 0, resupply: 100, rest: 100 }), ...ajuste };
  const side = [p.refit, p.repair, p.resupply, p.rest].map((x) => Math.max(0, Math.min(100, Math.round(x || 0))));
  return [...side, ...side];
}

// THE REFIT, in one place — because it has to happen on every save the app hands over, and the
// first version did not. It lived inside the "apply the result" path only, so REGENERATING a battle
// produced a fresh save from the previous one and quietly dropped it: the author reprocessed the map and
// his squad went back to 229 rounds.
//
// Everything here is idempotent on purpose. A man already on his feet stays on his feet, a man who
// already has his weapon keeps it, and a full magazine is not topped up — so running it twice, or
// on a save that has already been through it, changes nothing.
//
//   `indices` — the men the player PAID to replace. The lightly wounded join them for free.
export function refitSave({ save, workDir, tag, indices = [], fielded = null, names = null, R, trace, table = null, gear = [], keep = null, kit = [], keepKit = null, refill: refillPedido = null, rebuilt = [], armies = null, formations = null }) {
  const heal = R.replacement?.healLightWounds === false ? [] : lightlyWounded(save);
  const men = [...new Set([...indices, ...heal])].sort((a, b) => a - b);
  // A tabela vem de fora quando ha campanha: e a linha de base DELA por cima da colheita global.
  table = table || toeTable();
  fs.mkdirSync(workDir, { recursive: true });

  let source = save;
  // The replaced wrecks come back first: their blocks must say OK before anything else reads them.
  if (rebuilt.length) {
    const out = path.join(workDir, `rebuilt-${tag}.bts`);
    if (rebuildVehicles({ save: source, out, coreIds: rebuilt, trace })) source = out;
  }
  if (men.length) {
    const out = path.join(workDir, `replaced-${tag}.bts`);
    replaceMen({ save: source, out, indices: men, weapons: toeWeapons(source, table), trace });
    source = out;
  }
  const refill = refillPedido ?? (R.replacement?.appResupply ?? ((R.campaign?.percentages?.resupply ?? 0) / 100));
  const factory = R.replacement?.factoryReset === false ? null : factoryTable();
  if (factory?.tipos) return factoryReset({ source, workDir, tag, factory, armies, gear, keep, kit, keepKit, R, refill, fielded, names, formations, trace });
  // THE MAN WHO STILL HAS A WEAPON, BUT THE WRONG ONE (E54). The machine-gunner came back with
  // the pistol the game brought forward when the PKM ran dry, and buddy aid took the PKM itself.
  // He is not "unarmed", so the step above walks past him; this one gives every present man the
  // weapons his slot carries, and the ammunition follows below.
  const lost = lostWeapons(source, table, sidearms());
  if (Object.keys(lost).length) {
    const out = path.join(workDir, `rearmed-${tag}.bts`);
    const r = restoreWeapons({ save: source, out, weapons: lost, trace });
    if (r.homens) source = out;
  }
  // E A ARMA QUE ELE JUNTOU NO CAMPO (E78). A regra do autor: "nao devemos carregar munição e
  // armas obtidas da batalha de um mapa para outro". A municao ja volta a dotacao (113.8); aqui
  // volta a arma — so a que a colheita PROVA nao ser daquela vaga, porque a segunda mao varia de
  // esquadrao para esquadrao e o vencedor por vaga trocaria um RPG-22 legitimo por um RPG-26.
  // Vem antes do gear de proposito: o que ele COMPROU tem de ser escrito por ultimo.
  if (R.replacement?.resetWeapons !== false) {
    const juntadas = offIssueWeapons(source, toeTable(), { keep });
    if (Object.keys(juntadas).length) {
      const out = path.join(workDir, `unloot-${tag}.bts`);
      const r = rearmMen(source, out, juntadas);
      if (r.homens) {
        source = out;
        trace?.wrote('unloot.save', out);
        trace?.event('unloot.done', {
          men: r.homens,
          examples: Object.values(juntadas).slice(0, 8).map((x) => `${x.nome} (core ${x.coreId} vaga ${x.vaga}): ${x.de.trim()}`),
        });
      }
    }
  }
  // A ARMA QUE O JOGADOR ESCOLHEU (plano 1 fase C) vem DEPOIS da devolucao automatica — senao o
  // passo de cima poria a arma da vaga por cima da escolha dele — e ANTES da municao, porque quem
  // enche o paiol olha a arma que o homem segura.
  if (gear.length) {
    const out = path.join(workDir, `gear-${tag}.bts`);
    const r = applyGear({ save: source, out, changes: gear, trace });
    if (r.homens) source = out;
  }
  // DOIS BOTOES, NAO UM. `campaign.percentages.resupply` e o que o JOGO faz na virada, e ele volta a
  // 0 desde 08/09: ligado em 100 o motor escreve o roster sem o inventario dos homens e o app perde
  // a arma e a municao de todo mundo (FORMATO 119). Quem repoe e este refil aqui, por um caminho
  // provado em jogo (E33) — e ele precisa de um numero SO DELE, senao desligar o do jogo desliga o
  // do app junto, que foi o que aconteceu ate esta separacao.
  if (refill > 0) {
    // PRIMEIRO O PAIOL, DEPOIS A CARGA. Quem perdeu a lista de municao inteira nao tem par onde
    // receber quantidade — e sao justamente as baixas saqueadas, os homens que o jogador ACABOU DE
    // PAGAR para repor. Inserir o par faz o registro crescer quatro bytes por item, o que o E37
    // provou em jogo (FORMATO 113.3), inclusive no ultimo homem da unidade.
    const faltando = missingLoads(source, table, weaponTable(), { factory: factoryTable() });
    if (Object.keys(faltando).length) {
      const out = path.join(workDir, `granted-${tag}.bts`);
      const g = grantAmmo({ save: source, out, loads: faltando, fraction: refill, trace });
      if (g.homens) source = out;
    }
    // A CONTA E POR UNIDADE (E76), e a dotacao vem da COLHEITA GLOBAL — nao de `table`, que traz por
    // cima a linha de base desta campanha, e a linha de base guarda o MAIOR ja visto por vaga. Como o
    // jogo reparte o paiol do esquadrao entre os homens do jeito que quer, "o maior por vaga" soma
    // os maximos de reparticoes diferentes: o 3rd Squad do autor foi de 1990 tiros de 5.45 na
    // batalha 1 a 12037 na 6, e perdeu o Fast e o Quick pelo peso. `table` continua valendo para a
    // ARMA de cada vaga, que e o que a linha de base sabe de verdade.
    const loads = poolLoads(source, { issue: issueFor(), weapons: weaponTable(), last: table, trim: R.replacement?.trimToIssue !== false });
    if (Object.keys(loads).length) {
      const out = path.join(workDir, `resupplied-${tag}.bts`);
      resupply({ save: source, out, loads, fraction: refill, exact: true, units: loads.resumo, trace });
      source = out;
    }
    // AND THE GRENADE, which is not in the ammo vector at all (FORMATO 113.7, E67): it is a 3-byte
    // entry in the tail lists, so every refit so far walked straight past it. Measured in his own
    // campaign: between battle 3 and battle 4 the ammunition went from 2519 back to 3907 and the
    // grenades stayed 10 to 10, with four units at ZERO since battle 3. It comes back free, with
    // the refit — his call: "não precisa alterar o custo de replacement com base em munição" — and
    // so it also does NOT come back under "push on", which is exactly what that ability sells.
    const grenades = grenadesFor();
    if (grenades) {
      const want = missingGrenades(source, grenades, { aparar: R.replacement?.trimToIssue !== false });
      if (Object.keys(want).length) {
        const out = path.join(workDir, `grenades-${tag}.bts`);
        const g = restoreGrenades(source, out, want);
        if (g.homens) {
          source = out;
          trace?.event('refit.grenades', { homens: g.homens, granadas: g.granadas, tirou: g.tirou, cresceu: g.cresceu });
        }
      }
    }
    // And what a man does not carry: the vehicle and the gun (FORMATO 110.7).
    const vehicles = vehicleTable();
    if (vehicles && fielded?.size) {
      const out = path.join(workDir, `resupplied-units-${tag}.bts`);
      const r = resupplyVehicles({ save: source, out, table: vehicles, fielded, names, fraction: refill, exact: R.replacement?.trimToIssue !== false, trace });
      if (r.unidades) source = out;
    }
  }
  return source;
}

// THE FACTORY RESET (plan B, 28/09) — one pass over one plan, replacing the chain above whenever
// `research/fabrica.json` exists. the author's rule, fixed on 20/09: nothing taken in battle crosses to
// the next map. The old chain guessed the issue from the biggest load ever seen per roster type, and
// the roster type collides between armies: two of his Russian engineers left battle 3 with a Javelin
// round. Here every standing man goes back to exactly what the factory issued his slot, keyed
// `army|type`, and a man whose slot the factory does not know is left as he is and named in the log.
//
// Order: the weapon he bought first (the plan must see it in his hand), then the hands, then the
// ammunition — remove what the slot does not carry, insert what it does and he lacks, write the exact
// amount of the rest — then the grenades, then the vehicles. Ammunition, grenades and vehicles only
// with a refill (`push on` sells a battle without one); the hands always, because a weapon picked
// up on the field is loot whether or not the magazines are topped up.
function factoryReset({ source, workDir, tag, factory, armies, gear, keep, kit = [], keepKit = null, R = rules(), refill, fielded, names, formations = null, trace }) {
  // O QUE A MAQUINA DO JOGADOR NUNCA LEVA (17/10, autor: Stryker sem Javelin, em silencio) — o ULTIMO passo do reset, com ou
  // sem refill (o push on tambem), porque a fabrica acabou de devolver o CLU e os misseis. So bloco legivel: na batalha 1 e
  // na primeira de um recrutado o jogo cria o inventario pela TO&E e nao ha onde escrever.
  const stripStep = (src) => {
    const S = R.replacement?.stripVehicleGear;
    if (!S?.on || !(S.rules || []).length || !names) return src;
    const byArmy = armies || armiesOfSave(src);
    const clean = (n) => String(n || '').replace(/\s+#\d+$/, '');
    const paiol = {};
    for (const [id, nome] of names) { const row = factory.maquinas?.[`${byArmy.get(id)}|${clean(nome)}`]; if (row?.paiol) paiol[clean(nome)] = row.paiol; }
    return stripVehicleGear({ save: src, workDir, tag, rules: S.rules, names, armies: byArmy, paiol, trace }).save;
  };
  if (gear.length) {
    const out = path.join(workDir, `gear-${tag}.bts`);
    const r = applyGear({ save: source, out, changes: gear, trace });
    if (r.homens) source = out;
  }
  // o item comprado ou largado nesta virada (E145); o que ja era dele volta pelo keepKit do reset, abaixo
  if (kit.length) {
    const out = path.join(workDir, `kit-${tag}.bts`);
    const r = applyKit({ save: source, out, changes: kit, trace });
    if (r.homens) source = out;
  }
  const plan = resetPlan(source, factory, { armies: armies || armiesOfSave(source), keep, weapons: weaponTable(), keepKit, ...kitAmmoForReset(factory, R) });
  if (plan.kitReplaced.length) trace?.event('kit.replacedHand2', { men: plan.kitReplaced.map((k) => `${k.name} (core ${k.coreId} slot ${k.slot}): ${k.item} in place of ${k.hand2}`) });
  if (plan.kitSkipped.length) trace?.event('kit.skipped', { men: plan.kitSkipped.map((k) => `${k.name} (core ${k.coreId} slot ${k.slot}): ${k.item} — hand 2 holds ${k.hand2}`) });
  // the man's equipment back to the factory issue of his slot (08/11): night vision, laser, demo charges and the leader
  // mark (binoculars), with the kit item he still holds on top (E145)
  if (plan.equipSkipped.length) trace?.event('reset.equipSkipped', { men: plan.equipSkipped.map((k) => `${k.name} (core ${k.coreId} slot ${k.slot})`) });
  if (Object.keys(plan.bytes).length) {
    const out = path.join(workDir, `equip-${tag}.bts`);
    const r = writeManBytes(source, out, plan.bytes);
    if (r.homens) {
      source = out;
      const hx = (v) => v.map((x) => x.toString(16).padStart(2, '0')).join('/');
      trace?.event('reset.equipment', { ...plan.equip, written: r.homens, examples: Object.values(plan.bytes).slice(0, 8).map((b) => `${b.name} (core ${b.coreId} slot ${b.slot}): ${hx(b.from)} -> ${hx(b.to)}`) });
    }
  }
  const count = (o) => Object.keys(o).length;
  trace?.event('reset.plan', {
    men: plan.men, hands: count(plan.hands), remove: count(plan.remove), insert: count(plan.insert), amounts: count(plan.amounts), grenades: count(plan.grenades),
    untouched: plan.untouched.map((u) => `core ${u.coreId} (${u.army || 'no army'}|${u.tipo})`),
    examples: Object.values(plan.hands).slice(0, 8).map((h) => `${h.name} (core ${h.coreId} slot ${h.slot}): ${h.from} -> ${h.to}`),
  });
  if (count(plan.hands)) {
    const out = path.join(workDir, `hands-${tag}.bts`);
    const r = restoreWeapons({ save: source, out, weapons: plan.hands, trace });
    if (r.homens) source = out;
  }
  if (!(refill > 0)) return stripStep(source);
  if (count(plan.remove)) {
    const out = path.join(workDir, `unloot-${tag}.bts`);
    const r = removeAmmo(source, out, plan.remove);
    if (r.homens) {
      source = out;
      trace?.wrote('unloot.save', out);
      trace?.event('unloot.done', { men: r.homens, items: r.itens, shrank: r.encolheu, examples: r.detalhe.slice(0, 8).map((h) => `${h.nome}: item(s) ${h.itens.join(', ')}`) });
    }
  }
  if (count(plan.insert)) {
    const out = path.join(workDir, `granted-${tag}.bts`);
    const g = grantAmmo({ save: source, out, loads: plan.insert, fraction: refill, trace });
    if (g.homens) source = out;
  }
  if (count(plan.amounts)) {
    const out = path.join(workDir, `resupplied-${tag}.bts`);
    const r = resupply({ save: source, out, loads: plan.amounts, fraction: refill, exact: true, trace });
    if (r.homens) source = out;
  }
  if (count(plan.grenades)) {
    const out = path.join(workDir, `grenades-${tag}.bts`);
    const g = restoreGrenades(source, out, plan.grenades);
    if (g.homens) {
      source = out;
      trace?.event('refit.grenades', { homens: g.homens, granadas: g.granadas, tirou: g.tirou, cresceu: g.cresceu });
    }
  }
  // The machine's magazine, by name, from the factory row of ITS army; a name the factory does not
  // know keeps the old harvested table, which is per name and army-blind but carries no loot.
  if (fielded?.size) {
    const byArmy = armies || armiesOfSave(source);
    const clean = (n) => String(n || '').replace(/\s+#\d+$/, '');
    const table = { ...(vehicleTable() || {}) };
    const cargo = {};
    for (const id of fielded) {
      const name = clean(names?.get(id));
      const row = factory.maquinas?.[`${byArmy.get(id)}|${name}`];
      if (!name || !row) continue;
      if (Object.keys(row.paiol || {}).length || !table[name]) table[name] = row.paiol || {};
      // what it carries for the infantry (3000 rounds of 5.45 in a Ural): back to the factory too
      cargo[name] = { itens: Object.keys(row.carga || {}).length ? row.carga : null, ordem: row.cargaOrdem || [], paiolOrdem: row.paiolOrdem || [] };
      // ...and by FORMATION when the factory loads it differently there (01/10): the Ural of the 2B14
      // mortar platoon carries 82mm HE 40 + smoke 4, the plain one does not, and the name-only row cut it.
      const mae = String(formations?.get(id) || '').split(' / ').pop().replace(/ #\d+$/, '');
      const daFormacao = mae && row.porFormacao?.[mae];
      if (daFormacao) cargo[id] = { itens: Object.keys(daFormacao.carga || {}).length ? daFormacao.carga : null, ordem: daFormacao.cargaOrdem || [], paiolOrdem: row.paiolOrdem || [] };
    }
    const out = path.join(workDir, `resupplied-units-${tag}.bts`);
    const r = resupplyVehicles({ save: source, out, table, fielded, names, fraction: refill, exact: true, cargo, trace });
    if (r.unidades) source = out;
    // OS LANCADORES que a maquina leva para a infantaria (02/10, FORMATO 131) voltam a fabrica da formacao
    // dela; uma variante de fabrica vista (o BTR-4E de 4 RPG-22 ou 3 + RPG-26) fica como esta. Maquina
    // destruida nao entra: quem a repoe e a reconstrucao, que nao mexe nisto.
    const R0 = rules();
    if (R0.replacement?.resetLaunchers !== false) {
      const destruidas = new Set(vehicleStates(source).filter((x) => x.codigo === 1).map((x) => x.coreId));
      const target = (id, atual) => {
        if (!fielded.has(id) || destruidas.has(id)) return null;
        const name = clean(names?.get(id));
        const row = factory.maquinas?.[`${byArmy.get(id)}|${name}`];
        if (!row?.lancadores) return null;
        const mae = String(formations?.get(id) || '').split(' / ').pop().replace(/ #\d+$/, '');
        return launcherTarget(atual, (mae && row.lancadores.porFormacao?.[mae]) || row.lancadores);
      };
      const outL = path.join(workDir, `launchers-${tag}.bts`);
      const l = resetLaunchers({ save: source, out: outL, target, trace });
      if (l.vehicles) source = outL;
    }
    // A FUMACA (02/10, E121): a terceira lista do bloco e a carga do lanca-fumaca (vazia, o jogo apaga o
    // Pop Smoke) e cai em batalha (BMP-2M 18 -> 15 -> 9); volta a dotacao de fabrica da maquina.
    if (R0.replacement?.resetSmoke !== false) {
      const destruidas = new Set(vehicleStates(source).filter((x) => x.codigo === 1).map((x) => x.coreId));
      const target = (id) => {
        if (!fielded.has(id) || destruidas.has(id)) return null;
        const row = factory.maquinas?.[`${byArmy.get(id)}|${clean(names?.get(id))}`];
        if (!row?.terceira) return null;
        return Object.entries(row.terceira).map(([item, qtd]) => ({ item: Number(item), qtd }));
      };
      const outS = path.join(workDir, `smoke-${tag}.bts`);
      const s = resetSmoke({ save: source, out: outS, target, trace });
      if (s.vehicles) source = outS;
    }
  }
  return stripStep(source);
}

// A LISTA DE LANCADORES QUE A MAQUINA RECEBE no reset (`alvo` = a de fabrica da formacao: `itens` e `variantes`), ou null
// para deixar a que ela tem. Uma variante de fabrica vista fica (o BTR-4E sai 4x RPG-22 ou 3x RPG-22 + RPG-26). Mas a lista
// de fabrica COM ITENS FALTANDO e perda em batalha e volta inteira (07/11, autor: "strykers estao voltando das batalhas sem
// o launcher, apenas os misseis"): o M1126 do pelotao e visto 24 vezes com 2 AT4 + Javelin CLU + 2 misseis e 9 sem o CLU e
// sem os misseis; a carga volta pela moda (com os misseis) e a lista 2 AT4 passava como variante — misseis sem lancador.
export function launcherTarget(atual, alvo) {
  if (!alvo?.itens) return null;
  const ordenada = (l) => [...l].sort().join(',');
  const falta = (() => { const n = new Map(); for (const x of alvo.itens) n.set(x, (n.get(x) || 0) + 1); for (const x of atual) { if (!n.get(x)) return false; n.set(x, n.get(x) - 1); } return atual.length < alvo.itens.length; })();
  if (falta) return alvo.itens;
  if ((alvo.variantes || [alvo.itens]).some((v) => ordenada(v) === ordenada(atual))) return null;
  return alvo.itens;
}

// What each TO&E slot carries — weapon and full ammunition load — for putting a man back in
// business. Missing file is not an error: without it the refit falls back to the brother squads in
// the save, and then to the commonest weapon in the man's own unit.
export function toeTable() {
  try { return toeWeaponTable(paths().toeWeapons); } catch { return null; }
}

// What each WEAPON is issued — `{ '2/36': { 5: 300, 6: 48 } }` — harvested from every save the game
// wrote (E54). The slot table above answers for the man who lost everything; this one answers for
// the man who lost ONE item, because the weapon he holds says what belongs in his pouches and the
// slot does not: the same slot carries an RPG-22 in one squad and an RPG-26 in the next.
// The factory issue per army and type (tools/re/fabrica.mjs), cleaner than every harvested table: it
// is the mode of whole squads, where loot is a minority. Missing file is not an error.
export function factoryTable() {
  let t;
  try { t = JSON.parse(fs.readFileSync(path.join(RESEARCH_DIR, 'fabrica.json'), 'utf8')); } catch { return null; }
  // A maquina de nome ambiguo (06/11): a tabela guarda "US|Command Vehicle (M1130 Stryker) | AH-64D Apache ...", a forca
  // chama pela leitura (catalog.mjs readingOf). Cada leitura acha a mesma linha.
  for (const [k, v] of Object.entries(t?.maquinas || {})) {
    const [exercito, ...resto] = k.split('|');
    const nome = resto.join('|');
    if (!nome.includes(' | ')) continue;
    for (const leitura of nome.split(' | ')) t.maquinas[`${exercito}|${leitura.trim()}`] ??= v;
  }
  return t;
}

export function weaponTable() {
  try { return weaponAmmoTable(paths().weaponAmmo); } catch { return null; }
}

// A DOTACAO DE FABRICA (E80) — a primeira fonte, e a unica que mede o que o JOGO deu.
//
// As duas tabelas antigas medem o MAIOR carregamento ja visto por vaga (`toe_armas`) e o p90
// (`toe_granadas`), somando maximos de saves diferentes — e os saves de onde elas saem ja descendem
// do proprio refit. Medido no 3rd Squad do autor: a fabrica da 2020 tiros e 15 granadas repartidas
// 2-3-3-2-2-3, e o app entregava 2298 e 17 repartidas 5-1-0-1-10-0. DEZ granadas num homem so onde
// a fabrica da duas — e no jogo o peso e por SOLDADO, que e como o esquadrao perde Fast e Quick.
//
// Esta tabela so conhece os tipos que apareceram inteiros num save limpo; onde ela nao alcanca, a
// antiga continua valendo, porque uma dotacao inflada ainda e melhor do que nenhuma.
export function factoryIssue() {
  try { return readIssueTable(paths().issue); } catch { return null; }
}

// A dotacao de municao por vaga, com a de fabrica por cima da colheita antiga.
export function issueFor(fabrica = factoryIssue(), global = toeTable()) {
  const out = {};
  for (const tipo of new Set([...Object.keys(global || {}), ...Object.keys(fabrica || {})])) {
    out[tipo] = {};
    for (const vaga of new Set([...Object.keys(global?.[tipo] || {}), ...Object.keys(fabrica?.[tipo] || {})])) {
      const f = fabrica?.[tipo]?.[vaga];
      out[tipo][vaga] = f ? { ...(global?.[tipo]?.[vaga] || {}), municao: f.municao } : global[tipo][vaga];
    }
  }
  return out;
}

// O mesmo para a granada: a de fabrica por cima, o teto por tipo continua vindo da tabela antiga.
export function grenadesFor(fabrica = factoryIssue(), antiga = grenadeTable()) {
  if (!fabrica) return antiga;
  const tabela = { ...(antiga?.tabela || {}) };
  const teto = { ...(antiga?.teto || {}) };
  for (const [tipo, vagas] of Object.entries(fabrica)) {
    const linha = { ...(tabela[tipo] || {}) };
    for (const [vaga, l] of Object.entries(vagas)) linha[vaga] = { ...l.granadas };
    tabela[tipo] = linha;
    // O TETO TEM DE SER O DA PROPRIA FABRICA. O antigo saia do p90 e servia para impedir que a soma
    // das vagas desse um esquadrao impossivel; contra a dotacao exata ele vira o contrario — um
    // esquadrao que voltou com 17 granadas passava do teto, e ai nada era REPOSTO e so se aparava,
    // deixando o 2nd Squad com 6 onde a fabrica da 15.
    teto[tipo] = Object.values(linha).reduce((a, g) => a + Object.values(g).reduce((x, y) => x + y, 0), 0);
  }
  // Os tipos que vieram da FABRICA: para eles, granada de tipo que a vaga nao lista vale zero (E81).
  return { tabela, teto, exatos: new Set(Object.keys(fabrica)) };
}

// A DOTACAO DE GRANADA por (tipo da unidade, vaga), com o teto por tipo. Arquivo ausente nao e erro:
// sem ele ninguem repoe granada, que e o comportamento de antes de 17/09 (FORMATO 113.7).
export function grenadeTable() {
  try {
    const j = JSON.parse(fs.readFileSync(paths().grenades, 'utf8'));
    return j?.tabela ? j : null;
  } catch { return null; }
}

// The weapons that ride in hand 2 — the machine-gunner's pistol. A man holding one of these in
// hand 1 has lost his main weapon or its ammunition; nobody else is touched by `lostWeapons`.
export function sidearms() {
  try { return sidearmTable(paths().weaponAmmo); } catch { return null; }
}

// A DOTACAO QUE ESTA CAMPANHA JA VIU, lembrada de uma batalha para a outra.
//
// `research/toe_armas.json` e uma media de 115 saves e nao conhece toda vaga — a seção LRS #3 do
// autor e de um tipo que so existe uma vez na forca dele, entao nem a tabela nem os irmaos tinham
// resposta para um homem dela. E ha um problema pior, silencioso: `fullLoads` mede o "cheio" pelo
// melhor homem DAQUELE save, entao um esquadrao que voltou inteiro depenado se reabastece ate o
// pouco que sobrou e ninguem percebe.
//
// A linha de base conserta os dois: a cada save lido, para cada vaga de cada tipo, guarda a arma e o
// MAIOR carregamento ja visto NESTA campanha. E acumulativa e so sobe, entao a batalha 6 ainda sabe
// o que a batalha 1 mostrou.
//
// Esta e a ideia do autor — "gravar o status da unidade" — com uma diferenca que a medicao imposs:
// nao da para gravar na COMPRA, porque o roster de uma campanha nova nao tem homem nenhum (eles
// aparecem na primeira virada de batalha). Entao a campanha aprende, em vez de declarar.
export function learnBaseline(state, savePath) {
  let roster, tails;
  try { roster = readRoster(savePath); tails = readRosterTails(savePath); } catch { return 0; }
  const base = state.baseline || (state.baseline = {});
  let novos = 0;
  for (const u of roster.unidades) {
    if (!u.soldados.length) continue;
    const porTipo = base[u.tipo] || (base[u.tipo] = {});
    u.soldados.forEach((s, vaga) => {
      // SO O HOMEM INTEIRO ENSINA. Um save de virada e cheio de gente que gastou tudo e de baixas
      // saqueadas; aprender com eles gravaria "cinco balas" como se fosse a dotacao da vaga. Estado
      // 0 e quem esta de pe e sem ferimento — e mesmo esse pode ter atirado muito, o que nao faz mal
      // porque a linha de base guarda o MAIOR ja visto e sobe de batalha em batalha.
      if (s.estado !== 0) return;
      const c = tails[s.indice]?.cauda;
      const paiol = readAmmoVector(c);              // where the vector is (FORMATO 113.6)
      if (!paiol || paiol.n === 0) return;
      const linha = porTipo[vaga] || (porTipo[vaga] = { municao: {} });
      // A arma so entra quando o homem tem uma: o saqueado (classe 08) nao ensina nada.
      if (c[1] !== 0x08 && c[1] !== 0) linha.arma = `${c[1]}/${c[2]}`;
      for (const { item, qtd } of paiol.pares) {
        if (qtd <= 0) continue;
        if (!(linha.municao[item] >= qtd)) { linha.municao[item] = qtd; novos++; }
      }
    });
  }
  return novos;
}

// A tabela que o refit usa: o que esta campanha aprendeu por cima do que a colheita global sabe.
// A linha de base ganha porque ela viu ESTA unidade, e nao a media de 115 saves de outra gente.
export function baselineTable(state) {
  const global = toeTable() || {};
  const meu = state.baseline || {};
  const out = {};
  for (const tipo of new Set([...Object.keys(global), ...Object.keys(meu)])) {
    out[tipo] = {};
    for (const vaga of new Set([...Object.keys(global[tipo] || {}), ...Object.keys(meu[tipo] || {})])) {
      const g = global[tipo]?.[vaga] || {};
      const m = meu[tipo]?.[vaga] || {};
      const municao = { ...(g.municao || {}) };
      for (const [item, qtd] of Object.entries(m.municao || {})) {
        if (!(municao[item] >= qtd)) municao[item] = qtd;
      }
      out[tipo][vaga] = { ...g, ...m, municao };
    }
  }
  return out;
}

// WHO NEVER SETS FOOT ON THE MAP. Off-map artillery, the drone, a mortar firing from behind the
// line: the enemy cannot reach them, so they are never lost. They need ammunition and nothing else,
// and offering to "replace" one is offering to sell something that cannot break.
//
// The mark is not in the category byte — in the library these units are organic to the battalion
// and read as manoeuvre, so `offMap` there is false for every one of them. What DOES say it is the
// battle the app built: a unit that never gets a position on the map is off the map. It is the same
// count the generator prints ("13 sem posicao"), and it lands exactly on the mortars, the drones,
// the howitzers and the helicopters.
export function offMapCoreIds(state) {
  const out = new Set();
  const btt = state.current?.bttFile;
  if (!btt || !fs.existsSync(btt)) return out;
  try {
    const X = openBtt(btt);
    const c = X.completo;
    const walk = (node) => {
      if (node.r.form) { node.filhos.forEach(walk); return; }
      const fim = X.R[node.i + 1] ? X.R[node.i + 1].c : c.length;
      if (unitPosition(c, node.r, fim)) return;
      try { const i = contentEnd(c, node.r, fim); if (i.core) out.add(c.readUInt32LE(i.fim)); } catch { /* unreadable shape */ }
    };
    forceTree(X).vermelho.forEach(walk);
  } catch { /* no battle file to read: nobody is marked off-map, and the screen just offers more */ }
  return out;
}

// O QUE O JOGADOR SABE E O ARQUIVO NAO DIZ, guardado como dado.
//
// O E35 falhou por falta de gabarito: eu tinha 11 maquinas e um AAR dizendo que 7 se perderam, mas
// nao QUAIS, e a unica particao 7/4 que aparecia nos bytes era "BMP contra Stryker". Cada vez que
// o jogador marca uma maquina, ele responde exatamente essa pergunta.
//
// Entao cada marca vira uma linha rotulada: o bloco daquela unidade no save daquela batalha, em
// hexadecimal, com `lost` ao lado. Quando houver dezenas delas, achar o campo que separa destruido
// de inteiro deixa de ser adivinhacao e vira uma varredura com resposta conhecida — e o dia em que
// isso acontecer, o app pre-marca e o jogador so confere.
//
// Fica em `research/`, nao no estado da campanha: e material de engenharia reversa, nao regra de
// jogo, e some sem consequencia se for apagado.
function rotularVeiculo(state, coreId, estado) {
  const save = state.pending?.savePath;
  if (!save || !fs.existsSync(save)) return null;
  try {
    const blocos = unitBlocks(save).unidades;
    const arquivo = path.join(RESEARCH_DIR, 'veiculos_rotulados.jsonl');
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    const batalha = state.pending?.result?.battle ?? state.battleNumber;
    const nomeDe = (id) => state.units?.find((x) => x.coreId === id)?.name || null;
    const escreve = (id, situacao) => {
      const u = blocos.find((x) => x.coreId === id);
      if (!u) return false;
      // E o que o PROPRIO SAVE diz (110.11, E90): com o campo achado, a linha que vale ouro e a que
      // discorda dele — a marca do jogador contra a leitura, lado a lado.
      const lido = vehicleStateOfBlock(u.bytes);
      fs.appendFileSync(arquivo, JSON.stringify({
        campanha: state.slug, batalha, save: path.basename(save), coreId: id, nome: nomeDe(id),
        tipo: u.tipo, bytes: u.bytes.length, ff: u.ff, estado: situacao,
        lost: situacao === 'destroyed' || situacao === 'knocked_out',
        lido: lido ? GAME_STATUS[lido.codigo] || lido.estado : null,
        bloco: Buffer.from(u.bytes).toString('hex'),
      }) + '\n');
      return true;
    };

    escreve(coreId, estado);

    // E QUANDO A CONTA FECHA, o resto da frota vira negativo com certeza. O AAR diz quantas
    // maquinas se perderam; se o jogador ja marcou esse tanto, toda a que ele NAO marcou sobreviveu.
    // Sem isso o dado so teria exemplos de destruicao, e um gabarito de um lado so nao separa nada.
    const a = state.pending?.result?.aar?.player || {};
    const relatadas = (a.tanques || 0) + (a.blindados || 0) + (a.outrosVeiculos || 0) + (a.aeronaves || 0);
    const marcadas = (state.lost || []).length;
    if (relatadas > 0 && marcadas === relatadas) {
      const fora = offMapCoreIds(state);
      // So MAQUINA entra no gabarito. Um esquadrao de fuzileiros marcado como "sobreviveu" nao diz
      // nada sobre onde mora a destruicao de um veiculo, e enche o dado de exemplos que nao
      // comparam com nada — a primeira colheita saiu com 16 linhas de infantaria e 11 de maquina.
      const MAQUINAS = new Set(['apc', 'ifv', 'tank', 'afv', 'artillery', 'mortar', 'drone', 'manpads', 'truck', 'recon']);
      for (const u of state.units || []) {
        if (!u.present || fora.has(u.coreId) || !MAQUINAS.has(u.role)) continue;
        if ((state.lost || []).includes(u.coreId) || (state.survived || []).includes(u.coreId)) continue;
        if (!blocos.some((b) => b.coreId === u.coreId)) continue;
        escreve(u.coreId, 'survived');
      }
    }
    return arquivo;
  } catch { return null; }   // rotular nunca pode atrapalhar a campanha
}

// A MACHINE THE PLAYER SAYS IS GONE.
//
// Since E90 the app reads it out of the save first (`vehiclesFromSave`, below) and the player only
// corrects. The mark stays the player's to change: from then on the org chart carries it and the
// Quartermaster offers the replacement for as long as it takes him to afford it. Every mark made by
// hand is also filed as a labelled sample (above), with the save's own reading beside it.
// THREE ANSWERS, NOT TWO. "Destroyed" and "not marked yet" left no way to say a machine came
// through — and saying so is worth as much as the other, both to the player, who has fewer boxes to
// tick when most of a company burned, and to the file that is trying to learn where destruction is
// written: a set of examples with only one label separates nothing.
// WHAT ACTUALLY HAPPENS TO A MACHINE, in the game's own vocabulary:
//
//   destroyed    it does not come back; a new machine costs what a new machine costs.
//   immobilized  it cannot move and it can still shoot. Not a loss, and the app charges nothing.
//
// There used to be a third, "knocked out" (the crew got out, the hull is there, 40%). The save does
// not tell it from destroyed — both are Vehicle Status 1, the abandoned T-64 of EASY2 too (E90) —
// and the author settled it: "vamos considerar como mesma coisa" (E91). An old mark reads as destroyed.
//
// The price of each is a fraction of the unit's price, in `rules.json replacement.vehicle`.
export const VEHICLE_STATES = ['destroyed', 'immobilized', 'survived', 'unknown'];

export function markVehicle(slug, coreId, status = 'destroyed') {
  const state = loadState(slug);
  const u = state.units?.find((x) => x.coreId === coreId);
  if (!u) throw new Error(`there is no unit with core id ${coreId} in this campaign`);
  if (offMapCoreIds(state).has(coreId)) throw new Error(`${u.name} never sets foot on the map — nothing can happen to it there`);
  if (status === 'lost' || status === 'knocked_out') status = 'destroyed';   // os nomes antigos (E91)
  if (!VEHICLE_STATES.includes(status)) throw new Error(`unknown status "${status}"`);

  state.vehicles = state.vehicles || {};
  if (status === 'unknown') delete state.vehicles[coreId]; else state.vehicles[coreId] = status;

  // `lost` e `survived` continuam existindo porque o resto do app e a tela ja falam essa lingua:
  // perdida e o que precisa de reposicao paga, e imobilizada nao precisa.
  state.lost = Object.entries(state.vehicles).filter(([, s]) => s === 'destroyed' || s === 'knocked_out').map(([id]) => Number(id)).sort((a, b) => a - b);
  state.survived = Object.entries(state.vehicles).filter(([, s]) => s === 'survived' || s === 'immobilized').map(([id]) => Number(id)).sort((a, b) => a - b);
  // A CONTA DE REPOSICAO acompanha a marca (30/10, a escada): uma maquina corrigida para destruida entra na cobertura.
  if (state.stage === 'result' && state.pending?.result && !state.pending.result.kitOut) state.pending.result.income = incomeFor(state, state.pending.result);
  saveState(state);

  const rotulo = status === 'unknown' ? null : rotularVeiculo(state, coreId, status);
  traceOf(slug, { battle: state.current?.n }).event('unit.marked', {
    coreId, name: u.name, status, lost: state.lost.length, survived: state.survived.length, labelled: !!rotulo,
  });
  return state;
}

// The game's Vehicle Status (the editor's scale) in the app's words. 0 Burning and 4 Dismounted never
// showed up in a roster, so they get no mark and the player decides.
const GAME_STATUS = { 1: 'destroyed', 2: 'immobilized', 3: 'survived' };

// WHAT THE SAVE SAYS HAPPENED TO EACH MACHINE (FORMATO 110.11, E90).
//
// The transition save keeps, in the block of every machine that has been on the map, the same
// Vehicle Status the editor shows. Checked against the game's own after-action report in 13
// transitions of 4 campaigns, category by category, it counts the same losses — and it names them,
// which the report never did. It also found what hand-marking got wrong — 9 of 68 marks: in four
// battles the author had ticked the wrong one of two machines with the same name (T-64 #1 for #2 twice,
// an Abrams, a Stryker), and five that burned were ticked intact or never ticked (two Urals, a
// Bradley, an Abrams, a BMP-2) — so the app went on fielding wrecks the game quietly refused.
//
// Only machines that FOUGHT this battle are read: present, not already written off (the player's
// earlier word on a wreck is not reopened), and not firing from off the map. A machine whose block
// has no reading is left unmarked, and so is anything the Quartermaster does not list as a machine
// (trucks, the HMMWV with a gun) — those are returned so the screen can say so, never marked.
export function vehiclesFromSave(state, savePath, { offMap = offMapCoreIds(state), R = rules(), aar = null } = {}) {
  const out = { marks: {}, read: 0, unread: [], notListed: [] };
  let lidos;
  try { lidos = vehicleStates(savePath); } catch { return out; }   // no reading is no mark, never an error
  out.read = lidos.length;
  const porCore = new Map(lidos.map((x) => [x.coreId, x]));
  const perdidas = new Set(state.lost || []);
  // A WRECK ALREADY REPLACED IS HISTORY. Its block keeps S = 1 forever, and `present` is no guard: a
  // recruit rebuilds `state.units` from the core file, where the wreck is still switched on (only
  // the battle file switches it off). The battle-3 debrief of RUS1 read core 32 — burned in battle 1,
  // replaced by 42, absent ever since — as "destroyed" again.
  const aposentados = new Set([
    ...(state.wrecked || []).filter((w) => w.replacedBy != null).map((w) => w.coreId),
    ...Object.entries(state.vehicles || {}).filter(([, s]) => s === 'replaced').map(([id]) => Number(id)),
  ]);
  for (const u of state.units || []) {
    if (!u.present || perdidas.has(u.coreId) || aposentados.has(u.coreId) || offMap.has(u.coreId)) continue;
    const x = porCore.get(u.coreId);
    if (!isMachine(u, R)) {
      if (x && x.codigo !== 3) out.notListed.push({ coreId: u.coreId, name: u.name, status: GAME_STATUS[x.codigo] || x.estado });
      continue;
    }
    if (!x) { out.unread.push(u.coreId); continue; }
    if (GAME_STATUS[x.codigo]) out.marks[u.coreId] = GAME_STATUS[x.codigo];
  }
  // IMOBILIZADO NAO E DESTRUIDO (autor, 30/09). O jogo grava Vehicle Status 1 na transicao tambem para
  // a maquina que terminou a batalha IMOBILIZADA — o T-90AM do Lapin, na batalha 4 da RUS1, com dois
  // tripulantes vivos a bordo. O ultimo save de turno da mesma batalha diz o que ela era, e o perfil de
  // dano por subsistema amarra um arquivo ao outro (`veiculo_estado.imobilizadosNoFim`). A marca vira
  // `immobilized`, e a entrega reconstroi o bloco de graca (`writtenOffImmobilized`).
  out.writtenOff = [];
  if (Object.values(out.marks).includes('destroyed')) {
    let fim = null;
    try { fim = immobilizedAtEnd(savePath, lidos); } catch { fim = null; }
    for (const d of (fim && fim.detalhe) || []) {
      if (out.marks[d.coreId] !== 'destroyed') continue;
      out.marks[d.coreId] = 'immobilized';
      const u = (state.units || []).find((y) => y.coreId === d.coreId);
      out.writtenOff.push({ coreId: d.coreId, name: u?.name, crew: d.tripulacao, turnSave: fim.turno });
    }
  }
  // O RELATORIO DO JOGO DECIDE QUANTAS SE PERDERAM (18/10, autor: "o app pensa que eu perdi o meu primeiro bmp na batalha 2
  // da RUS3, mas ele foi apenas imobilizado e abandonado"). O jogo grava Vehicle Status 1 tambem na maquina que termina
  // imobilizada ou abandonada, mas o AAR so conta a perda de verdade — na RUS3 b2, 3 maquinas e um caminhao com status 1 e o
  // relatorio com 1 tanque, 0 blindados, 0 outros. Por categoria do relatorio, as que passam da conta foram baixadas pelo
  // jogo: ficam como perda as de mais evidencia (destruida no ultimo save de turno, achada pelos nomes da tripulacao; a
  // tripulacao toda fora de combate; mais baixas), e as outras viram `immobilized`, que volta de graca
  // (`writtenOffImmobilized`). O caminhao baixado sai de `notListed` e entra nas marcas do mesmo jeito.
  if (aar && typeof aar === 'object') {
    const porCoreId = new Map((state.units || []).map((u) => [u.coreId, u]));
    // A categoria e a do RELATORIO, pelo casco e nao pela arma (07/11, autor: "perdi um stryker, mas ele consta como
    // imobilizado", US b3): o papel sai da arma no nome, e o HMMWV com M2 (`mg`) ou o de ATGM (`atgm`) caiam em blindados
    // com o Stryker — 4 contra 1 no AAR, e o Stryker e dois HMMWV viraram imobilizados. Para o jogo HMMWV e "outro veiculo".
    const categoria = hullCategory;
    const status1 = [
      ...Object.entries(out.marks).filter(([, s]) => s === 'destroyed').map(([id]) => Number(id)),
      ...out.notListed.filter((x) => x.status === 'destroyed').map((x) => x.coreId),
    ];
    if (status1.length) {
      let fim = null;
      try { fim = crewAtEnd(savePath, status1); } catch { fim = null; }
      let roster = null;
      try { roster = readRoster(savePath); } catch { roster = null; }
      const baixas = (id) => { const s = roster?.unidades.find((x) => x.coreId === id)?.soldados || []; return { todos: s.length > 0 && s.every((x) => x.estado > 1), n: s.filter((x) => x.estado > 1).length }; };
      const peso = (id) => { const f = fim?.porCore.get(id); const b = baixas(id); return (f?.destruido ? 4 : 0) + (b.todos ? 2 : 0) + b.n / 100; };
      for (const cat of ['tanques', 'blindados', 'outrosVeiculos']) {
        const ids = status1.filter((id) => categoria(porCoreId.get(id)) === cat);
        const k = Math.max(0, Number(aar[cat]) || 0);
        if (ids.length <= k) continue;
        const baixadas = ids.sort((a, b) => peso(b) - peso(a) || a - b).slice(k);
        for (const id of baixadas) {
          out.marks[id] = 'immobilized';
          out.notListed = out.notListed.filter((x) => x.coreId !== id);
          const f = fim?.porCore.get(id);
          out.writtenOff.push({ coreId: id, name: porCoreId.get(id)?.name, reason: 'aar', category: cat, reported: k, crew: f?.homens || null, turnSave: fim?.turno || null });
        }
      }
    }
  }
  return out;
}

// O IMOBILIZADO QUE O JOGO DEU COMO PERDIDO VOLTA DE GRACA. A marca `immobilized` promete que a
// maquina volta sem custo, e o jogo so a conserta quando ele proprio gravou S = 2; se gravou S = 1
// (imobilizado no fim, `vehiclesFromSave`), ela ficaria fora da batalha seguinte. Toda maquina em
// campo marcada `immobilized` cujo bloco no save diz S = 1 e reconstruida na vaga, pelo mesmo caminho
// da reposicao paga (`rebuildVehicles`) — vale tambem para a marca posta a mao pelo jogador.
export function writtenOffImmobilized(state, savePath) {
  const marcados = (state.units || []).filter((u) => u.present && (state.vehicles || {})[u.coreId] === 'immobilized').map((u) => u.coreId);
  if (!marcados.length) return [];
  let lidos = [];
  try { lidos = vehicleStates(savePath); } catch { return []; }
  const s1 = new Set(lidos.filter((x) => x.codigo === 1).map((x) => x.coreId));
  return marcados.filter((id) => s1.has(id));
}

// O NIVEL EM QUE A MAQUINA REPOSTA CHEGA (E57). autor, no quartel-mestre da EASY2: "por que este
// Bradley custa mais caro que os outros? ... deveriamos oferecer toda reposicao de veiculo com
// experiencia green". O Bradley #2 era Crack (a biblioteca rolou), 500 cr contra 250 dos Veteran
// ao lado — e o que voltaria era o gemeo dormente, no nivel que ELE tivesse. Uma maquina nova e
// uma maquina nova: chega Green e custa Green, seja qual for o nivel da que queimou.
export function replacementLevel(R = rules()) {
  const level = R.replacement?.vehicleExperience;
  return level && (R.units.experienceLevels || []).includes(level) ? level : null;
}

// O RESERVA QUE TOMA O LUGAR: um gemeo dormente do mesmo tipo, de preferencia NA MESMA FORMACAO.
// Os tres BTR-4E que o autor repos foram parar no pelotao de reconhecimento e no de anticarro
// porque a busca pegava o primeiro da lista inteira. Quem ja foi comprado hoje, ou ja foi tomado
// por outra maquina deste mesmo Apply, nao conta (E56).
export function spareFor(state, u, taken = new Set(), buying = []) {
  // O MAIS PROXIMO NA ARVORE, e nao so "a mesma formacao": quando o pelotao dele nao tem gemeo
  // dormante (os dois Ural do pelotao de engenharia do autor sao dele), o proximo melhor e o do
  // pelotao irmao da MESMA companhia — nao um caminhao perdido numa bateria de morteiros (E63).
  // sem o "#n" que o diretorio poe nos nomes repetidos: o "Platoon (Engineer) #2" e o pelotao
  // irmao, e esta muito mais perto que uma bateria de morteiros.
  // (`#\d+` com a barra: a versao anterior dizia `#d+`, que nao casa com nada, e o sufixo nunca saia —
  // "Platoon (Rifle) #2" nunca era irmao de "Platoon (Rifle)".)
  const caminho = (x) => String(x.formation || '').split(' / ').map((p) => p.replace(/ #\d+$/, ''));
  const meu = caminho(u);
  const fundo = (x) => { const o = caminho(x); let i = 0; while (i < meu.length && i < o.length && meu[i] === o[i]) i++; return -i; };
  // UM DESTROCO NAO E RESERVA (E71). "Dormente" nao e so `present: false`: a maquina que queimou numa
  // batalha anterior e foi reposta tambem esta desligada, e ela continua no arsenal como DESTROCO.
  // Na batalha 4 da EASY2 o BTR-4E core 20 foi reposto pelo core 10 — que tinha queimado na batalha
  // 3 — e `battlePresence` o deixou fora do mapa por estar em `lost`: autor pagou dois BTR e entrou
  // com um. Fora da lista: quem esta em `lost`, quem ja foi trocado (`wrecked`), a parada que saiu de
  // campo (`repaired`) e o que o jogador tirou de campo de proposito (`standDown`).
  const destroco = new Set([
    ...(state.lost || []),
    ...(state.wrecked || []).map((w) => w.coreId),
    ...(state.repaired || []).map((r) => r.coreId),
    ...(state.standDown || []),
    ...(state.sold || []).map((s) => s.coreId),
  ]);
  return (state.units || [])
    .filter((x) => !x.present && !destroco.has(x.coreId) && !buying.includes(x.coreId) && !taken.has(x.coreId) && String(x.type) === String(u.type))
    .sort((a, b) => fundo(a) - fundo(b) || a.coreId - b.coreId)[0] || null;
}

// O IMOBILIZADO NAO VOLTA SOZINHO (E62). A regra dizia que a maquina imobilizada e consertada de
// graca pelo jogo entre batalhas (REPAIR 100 no cabecalho da campanha) e o app nao fazia nada com
// ela. autor entrou na batalha 4 da EASY2 com um T-64BV a menos: o imobilizado simplesmente nao
// aparece no mapa — o jogo nao o conserta no caminho do save injetado —, e como nao custava nada
// ele sumia em silencio da forca.
//
// O conserto continua DE GRACA; o que muda e quem o faz. O app tem um caminho so para pos uma
// maquina de volta em campo, o mesmo da reposicao: um gemeo dormente e acordado (112.8, E14A). Aqui
// ele nao e uma maquina nova — e a mesma, consertada —, entao leva a experiencia, o preco e a ficha
// de combate da parada, que sai de campo para sempre. Sem gemeo no arsenal, nada acontece e a tela
// diz isso.
//
// Puro: decide e devolve, sem escrever no estado.
//
// CORRIGIDO NO E91 (FORMATO 110.11): a premissa estava errada. O T-64BV que "nao apareceu" na batalha
// 4 era o 82, e o save diz que ele estava DESTRUIDO (Vehicle Status 1) desde a batalha 2 — o jogo
// recusa destroco, nao imobilizado. O imobilizado de verdade volta: o BTR-4E 52 da EBD saiu da
// batalha 2 com Vehicle Status 2, entrou na 3 pela entrega do app ([B03], o mesmo caminho) com
// mobilidade 1,000 e andou 570 m — mesmos percentuais de campanha da EASY2 (REPAIR 100). A troca por
// gemeo so gastava reservas; fica desligada em `rules.json replacement.swapImmobilized`.
export function repairsDue(state, { buying = [], taken = new Set(), offMap = new Set() } = {}) {
  const out = { repairs: [], noSpare: [] };
  for (const u of (state.units || [])) {
    if (!u.present || (state.vehicles || {})[u.coreId] !== 'immobilized') continue;
    if (buying.includes(u.coreId) || offMap.has(u.coreId)) continue;
    const spare = spareFor(state, u, taken, buying);
    if (!spare) { out.noSpare.push(u); continue; }
    taken.add(spare.coreId);
    out.repairs.push({ broken: u, spare });
  }
  return out;
}

// O QUE UMA MAQUINA CUSTA PARA VOLTAR, pelo que aconteceu com ela — e no nivel em que a reposicao vem.
export function vehicleCost(u, status, R = rules(), nation = null) {
  const f = R.replacement?.vehicle || { destroyed: 1, immobilized: 0 };
  if (status === 'knocked_out') status = 'destroyed';   // uma marca de antes do E91
  const level = replacementLevel(R);
  const base = level
    ? priceUnits([{ name: u.name, offMap: u.offMap, type: u.type, experience: level }], nation || u.nation, R).total
    : (u.price || 0);
  return Math.round(base * (f[status] ?? 0));
}

// O nome antigo, para quem ainda chama com um booleano.
export const markLost = (slug, coreId, lost = true) => markVehicle(slug, coreId, lost ? 'lost' : 'unknown');

// The same for what a vehicle or a gun carries. Missing file means no vehicle is refilled — which
// is the safe half of the trade: a gun short of shells beats a byte written in the dark.
export function vehicleTable() {
  try { return toeVehicleTable(paths().toeVehicles); } catch { return null; }
}

// ------------------------------------------------------------------------- folders and state

// A chave que a tela carrega poe uma folha dentro da SUA FONTE (`0.9.4.0`); na forca pronta a
// mesma folha mora debaixo da raiz daquele pick. Mesmo caminho, primeiro numero diferente — e e
// assim que uma escolha feita na tela vira core id depois que a forca existe.
export const chaveNaForca = (i, chave) => String(i) + chave.slice(chave.indexOf('.'));

// DE QUE EXERCITO E ESTA UNIDADE. O arquivo nao diz, por unidade: a batalha declara UMA nacao no
// cabecalho (FORMATO 108) mesmo quando a forca mistura americanos e ucranianos. Quem sabe e o app —
// cada escolha da biblioteca veio de uma nacao, e a primeira parte da chave da unidade e o indice
// da escolha que a trouxe (a mesma conta de `chaveNaForca`, ao contrario).
// coreId -> army, for the factory reset (every unit of the campaign, not only the ones in the field).
const unitArmies = (state) => new Map((state.units || []).map((u) => [u.coreId, nationOfUnit(state, u)]));

export function nationOfUnit(state, u) {
  const i = Number(String(u?.key ?? '').split('.')[0]);
  const p = Number.isInteger(i) ? (state.picks || [])[i] : null;
  return p?.nation || state.nation || null;
}
const comNacao = (state, units) => units.map((u) => ({ ...u, nation: nationOfUnit(state, u) }));

// SPECIAL FORCES (autor, 27/09): the pick says so (`sf`), and a unit belongs to the pick whose index
// opens its key — the same road `nationOfUnit` takes.
export function isSpecialForcesUnit(state, u) {
  const i = Number(String(u?.key ?? '').split('.')[0]);
  return Number.isInteger(i) && !!(state.picks || [])[i]?.sf;
}
// Whose weapons the player may change: everyone when gear is on; with it off and
// `specialForcesOnly`, only the special forces' men; otherwise nobody (null = off).
export function gearScope(state, R = rules()) {
  if (R.gear?.enabled !== false) return { all: true, coreIds: null };
  if (!R.gear?.specialForcesOnly) return null;
  const ids = new Set((state.units || []).filter((u) => isSpecialForcesUnit(state, u)).map((u) => u.coreId));
  return ids.size ? { all: false, coreIds: ids } : null;
}
export function checkSpecialForces(picks, R = rules()) {
  // A SF vendida inteira (`sold`, 28/09) nao ocupa mais a vaga: o jogador pode ter outra.
  const n = picks.filter((p) => p.sf && !p.sold).length;
  const max = R.formations?.maxSpecialForces ?? 1;
  if (n > max) throw new Error(`only ${max} special forces formation${max > 1 ? 's' : ''} per campaign — this force would have ${n}`);
}
// Uma formacao descartada (24/10, rules.formations.discarded) nao se compra mais; a campanha que ja a tem continua com ela.
// A que e so da defesa (28/10, rules.formations.defenseOnly) nunca se comprou.
export function checkDiscardedFormations(picks, R = rules()) {
  const fora = new Set([...(R.formations?.discarded || []), ...(R.formations?.defenseOnly || [])]);
  for (const p of picks) { const src = String(p?.source || '').replace(/.btt$/, ''); if (fora.has(src)) throw new Error(`${src} is no longer offered`); }
}
// Uma SF aposentada (18/10: a Sapper russa) nao se compra mais; so as campanhas que ja a tem a carregam.
export function checkRetiredSpecialForces(picks, R = rules()) {
  for (const p of picks) {
    const sf = p?.sf ? specialForcesOf(p.source, R) : null;
    if (sf?.retired) throw new Error(`${sf.name} is no longer offered as special forces`);
  }
}

// AVAILABILITY (autor, 04/10): quantas copias de uma formacao a campanha pode ter, pelo arquivo da
// biblioteca. Copia vendida inteira nao conta; Special Forces conta a parte (checkSpecialForces).
export function availabilityOf(source, R = rules()) {
  const f = R.formations || {};
  return Number((f.availability || {})[source] ?? f.availabilityDefault ?? 1);
}
export function checkAvailability(picks, R = rules()) {
  const n = new Map();
  for (const p of picks) if (!p.sf && !p.sold) n.set(p.source, (n.get(p.source) || 0) + 1);
  for (const [source, k] of n) {
    const max = availabilityOf(source, R);
    if (k > max) throw new Error(`${String(source).replace(/\.btt$/, '')}: only ${max} cop${max > 1 ? 'ies' : 'y'} per campaign — this force would have ${k}`);
  }
}

// A SLUG IS A FOLDER NAME AND NOTHING ELSE (05/10/2026, QA r2 A1). Every route takes it from the URL, and the
// DELETE route removed `app/_decoy` when asked for `..%2F_decoy`. A slug is what `slugify` makes (letters, digits,
// dashes); anything else is refused before it touches the disk.
export const dirOf = (slug) => {
  if (typeof slug !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(slug)) throw new Error(`"${String(slug).slice(0, 40)}" is not a campaign name`);
  return path.join(CAMPAIGNS_DIR, slug);
};
export const stateFile = (slug) => path.join(dirOf(slug), 'state.json');
export const logFile = (slug) => path.join(dirOf(slug), 'log.jsonl');
export const traceOf = (slug, extra = {}) => new Trace(logFile(slug), { slug, ...extra });
const battleDir = (slug, n) => path.join(dirOf(slug), 'battles', String(n).padStart(2, '0'));
// O KIT-OUT DA BATALHA n (19/10, autor): a batalha de mentira que poe a Special Forces recem-comprada no mapa para o jogo
// nomear os homens. Nao e uma batalha: nao tem numero, nao paga, nao conta derrota. Mora ao lado da pasta da batalha n.
const kitDir = (slug, n) => path.join(dirOf(slug), 'battles', `${String(n).padStart(2, '0')}-kit`);
// O SLOT DO .cam DA BATALHA n. Os dois slots se alternam a cada transicao do jogo; cada kit-out jogado e uma transicao a
// mais, e `slotShift` conta quantas foram.
export const slotFor = (state, n) => (n - 1 + (state.slotShift || 0)) % 2;

export function slugify(name) {
  const s = String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, ' ').trim().replace(/\s+/g, '-').toUpperCase();
  return (s || 'CAMPAIGN').slice(0, 12);
}

// ------------------------------------------------------------------ o app que morreu no meio (29/10, bateria de interrupcoes)
//
// O app roda numa janela de console: fechar a janela (ou a luz cair) mata o processo no ponto em que estiver. O
// `state.json` e gravado de uma vez (tmp + rename), mas os outros arquivos de um job nao: a forca core enxertada, o
// result.json, o .bts entregue, o .btt reconstruido. RECUPERAR e desfazer o que um job morto deixou escrito sem o estado
// que o descreve — so quando a verdade e clara (o estado gravado e o de antes do job, e o arquivo e a sobra dele).
// Roda quando o servidor sobe (nada rodando) e antes de cada operacao que grava a campanha (a fila garante que nenhuma
// outra roda ao mesmo tempo). Devolve o que fez, e o log registra.
const ENTREGANDO = (slug) => path.join(dirOf(slug), 'delivering.json');
const REFAZENDO = (slug) => path.join(dirOf(slug), 'work', 'rebuild-prev');
function abrirEntrega(slug, file) {
  let v = []; try { v = JSON.parse(fs.readFileSync(ENTREGANDO(slug), 'utf8')); } catch { /* sem entrega aberta */ }
  fs.writeFileSync(ENTREGANDO(slug), JSON.stringify([...new Set([...v, file])]));
}
function fecharEntrega(slug) { fs.rmSync(ENTREGANDO(slug), { force: true }); fs.rmSync(REFAZENDO(slug), { recursive: true, force: true }); }
export function recuperarInterrompido(slug) {
  const feito = [];
  const dir = dirOf(slug);
  if (!fs.existsSync(stateFile(slug))) return feito;
  if (fs.existsSync(stateFile(slug) + '.tmp')) { fs.rmSync(stateFile(slug) + '.tmp', { force: true }); feito.push('state.json.tmp removed'); }
  let state; try { state = JSON.parse(fs.readFileSync(stateFile(slug), 'utf8')); } catch { return feito; }
  const conhecido = (f) => {
    const k = path.resolve(f).toLowerCase();
    return [...(state.current?.handed || []).map((h) => h.file), state.current?.playFrom?.file, state.next?.save, state.pending?.savePath,
      ...(state.history || []).map((h) => h.save), ...(state.seenSaves || [])].filter(Boolean).some((x) => path.resolve(x).toLowerCase() === k);
  };
  // 1. a reconstrucao que nao chegou ao saveState: o .btt e o spec de antes voltam (o estado descreve a build de antes)
  const prev = REFAZENDO(slug);
  if (fs.existsSync(path.join(prev, 'alvo.json'))) {
    try {
      const alvo = JSON.parse(fs.readFileSync(path.join(prev, 'alvo.json'), 'utf8'));
      for (const [nome, destino] of Object.entries(alvo)) if (fs.existsSync(path.join(prev, nome))) fs.copyFileSync(path.join(prev, nome), destino);
      feito.push('the rebuilt battle file was put back as it was (the rebuild never finished)');
    } catch (e) { feito.push(`could not put the battle file back: ${e.message}`); }
  }
  // 2. o .bts entregue por um prepare/rebuild que nao chegou ao saveState: e nosso, e ninguem o recebeu
  if (fs.existsSync(ENTREGANDO(slug))) {
    let v = []; try { v = JSON.parse(fs.readFileSync(ENTREGANDO(slug), 'utf8')); } catch { /* ilegivel: nada a apagar */ }
    for (const f of v) if (fs.existsSync(f) && !conhecido(f)) { fs.rmSync(f, { force: true }); feito.push(`the half-delivered save ${path.basename(f)} was removed`); }
  }
  fecharEntrega(slug);
  // 3. o result.json de uma leitura que nao chegou ao saveState: a batalha ainda esta montada, esperando o save
  if (state.stage === 'play' && state.current) {
    const r = path.join(state.current.kitOut ? kitDir(slug, state.current.n) : battleDir(slug, state.current.n), 'result.json');
    if (fs.existsSync(r)) { fs.rmSync(r, { force: true }); feito.push(`the result of battle ${state.current.n} that was never recorded was removed`); }
  }
  // 4. o Apply que enxertou a forca core e nao chegou ao saveState: a copia de antes (tirada no comeco do Apply) volta
  if (state.stage === 'result' && state.pending?.result && state.coreFile && fs.existsSync(state.coreFile)) {
    const n = state.pending.result.battle;
    const undo = state.pending.result.kitOut ? path.join(kitDir(slug, n), 'undo') : path.join(battleDir(slug, n + 1), 'undo');
    const copia = path.join(undo, 'core-force.btt');
    if (fs.existsSync(copia) && fs.statSync(copia).size !== fs.statSync(state.coreFile).size) {
      try {
        const snap = JSON.parse(fs.readFileSync(path.join(undo, 'state.json'), 'utf8'));
        const mesmo = snap.stage === 'result' && snap.pending?.result?.battle === n && (snap.units || []).length === (state.units || []).length;
        if (mesmo && unitDirectory(state.coreFile).length !== state.units.length && unitDirectory(copia).length === state.units.length) {
          fs.copyFileSync(copia, state.coreFile);
          feito.push('the force file grafted by an Apply that never finished was put back as it was');
        }
      } catch (e) { feito.push(`could not check the force file: ${e.message}`); }
    }
  }
  if (feito.length) traceOf(slug).event('recover.interrupted', { done: feito });
  return feito;
}
// Quando o servidor sobe: toda campanha, e a pasta que uma criacao interrompida deixou sem estado (nada jogado nela:
// nenhum result.json) sai, com o .cam que ela escreveu na pasta do jogo se for o mesmo da copia dela.
export function recuperarTudo() {
  const out = [];
  if (!fs.existsSync(CAMPAIGNS_DIR)) return out;
  for (const d of fs.readdirSync(CAMPAIGNS_DIR)) {
    const dir = path.join(CAMPAIGNS_DIR, d);
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      if (!fs.existsSync(path.join(dir, 'state.json'))) {
        const bat = path.join(dir, 'battles');
        const jogou = fs.existsSync(bat) && fs.readdirSync(bat).some((b) => fs.existsSync(path.join(bat, b, 'result.json')));
        if (jogou) { out.push({ slug: d, done: ['a campaign folder with battles played but no state.json — left alone'] }); continue; }
        const copia = path.join(dir, 'campaign.cam');
        const doJogo = path.join(paths().campaigns || '', `CMBSDC ${d}.cam`);
        if (fs.existsSync(copia) && fs.existsSync(doJogo) && sha1(fs.readFileSync(copia)) === sha1(fs.readFileSync(doJogo))) fs.rmSync(doJogo, { force: true });
        fs.rmSync(dir, { recursive: true, force: true });
        out.push({ slug: d, done: ['a campaign whose creation never finished was removed'] });
        continue;
      }
      const feito = recuperarInterrompido(d);
      if (feito.length) out.push({ slug: d, done: feito });
    } catch (e) { out.push({ slug: d, done: [`could not check: ${e.message}`] }); }
  }
  return out;
}

export function listCampaigns() {
  if (!fs.existsSync(CAMPAIGNS_DIR)) return [];
  return fs.readdirSync(CAMPAIGNS_DIR)
    // a folder that is not a campaign name (dirOf refuses it) is not a campaign, and does not take the list down
    .filter((d) => { try { return fs.existsSync(stateFile(d)); } catch { return false; } })
    .map((d) => {
      const s = loadState(d);
      return { slug: s.slug, name: s.name, nation: s.nation, battleNumber: s.battleNumber, credits: s.credits, defeatsLeft: s.defeatsLeft, defeatsUnlimited: !!s.defeatsUnlimited, stage: s.stage, createdAt: s.createdAt, outcome: s.outcome || null, score: s.score?.total ?? null, rank: s.score ? (s.score.rank ?? rankOf(s.score.total, rules(), { lost: s.outcome === 'lost' })) : null, difficulty: s.difficulty || null, finishedAt: s.finishedAt || null, hasForce: !!s.coreFile, kitOut: kitOutStage(s) };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function loadState(slug) {
  // THE FOLDER NAMES THE CAMPAIGN, not the file inside it. `saveState` writes by `state.slug`, and a
  // campaign folder copied under another name still carries the original slug: on 27/09 a test copy
  // of RUS1 wrote its result over the author's real campaign, and the list showed two "RUS1". Stamped on
  // every read, a copy can only ever write into its own folder.
  const state = mapaUnico(JSON.parse(fs.readFileSync(stateFile(slug), 'utf8')));
  state.slug = slug;
  const pronto = migrate(state);
  // O PRECO DE REPOR CADA VEICULO, pelo servidor (11/10): a pagina calculava a partir do preco guardado na compra, que
  // nao acompanha a promocao, e mostrava 178 onde o Apply cobrava 200. So com a loja aberta; nunca e gravado.
  if (pronto.stage === 'result') {
    try {
      const R = rules();
      pronto.vehicleBase = Object.fromEntries((pronto.units || []).filter((u) => isMachine(u, R)).map((u) => [u.coreId, vehicleCost(u, 'destroyed', R, u.nation)]));
    } catch { /* sem a tabela, a pagina usa a conta dela */ }
  }
  return pronto;
}

// Campaigns created before a field existed get it filled in on the next read, from the files the
// campaign folder already has. Cheaper and safer than asking the player to start over.
function migrate(state) {
  let changed = false;
  // A PASTA DE DADOS MOVIDA (14/11): o coreFile e o unico caminho do estado que aponta para dentro da pasta da campanha.
  // Quem levou app\campaigns de um pacote antigo para %LOCALAPPDATA% a mao nao perde a campanha: o arquivo de mesmo nome
  // na pasta de agora vale.
  if (state.coreFile && state.slug && !fs.existsSync(state.coreFile)) {
    const aqui = path.join(dirOf(state.slug), path.basename(state.coreFile));
    if (fs.existsSync(aqui)) { state.coreFile = aqui; changed = true; }
  }
  if (state.path && !(state.path.nodes || []).some((x) => x.id === START_ID)) {
    delete state.path; delete state.ops;
    if (state.current) { delete state.current.node; delete state.current.rewardMult; }
    try { fs.renameSync(pathFile(state.slug), pathFile(state.slug) + '.old'); } catch { /* sem arquivo */ }
    changed = true;
  }
  // O NOME AMBIGUO (06/11, autor): a unidade gravada como "Command Vehicle (M1130 Stryker) | AH-64D Apache Longbow ..."
  // passa a se chamar pela leitura do lugar onde esta (catalog.mjs readingOf), como as forcas novas ja saem.
  {
    const R = rules();
    // o preco de vitrine de quem ainda nao foi pago sai da chave nova da planilha; o pago fica como foi pago
    for (const u of state.units || []) if (String(u.name || '').includes('|')) {
      u.name = readingOf(u.name, u.offMap, R);
      if (!u.paid) u.price = priceUnit(u, u.nation || state.nation, R);
      changed = true;
    }
    for (const p of state.picks || []) for (const d of p.dropped || []) if (String(d.name || '').includes('|')) { d.name = readingOf(d.name, d.offMap, R); changed = true; }
  }
  // A campanha perdida e sempre a pior letra (06/11, autor): a que fechou antes com a letra do placar e corrigida aqui,
  // e o cabecalho, o cartao Outcome, a lista e o Hall of Fame leem a mesma. Os pontos nao mudam.
  if (state.stage === 'over' && state.outcome === 'lost' && state.score) {
    const pior = rankOf(state.score.total, rules(), { lost: true });
    if (state.score.rank !== pior) { state.score = { ...state.score, rank: pior }; changed = true; }
  }
  // O PRECO DA SF NO PRESET (06/11, autor): a campanha criada com a Special Forces gratis nao bate com preset nenhum, e o
  // nome gravado dela vira Custom. So esse caso: as outras guardam o nome do dia em que foram criadas.
  if (state.specialForcesPrice === 0 && state.difficulty && state.difficulty !== 'Custom') {
    state.difficulty = 'Custom';
    if (state.score?.difficulty) state.score = { ...state.score, difficulty: 'Custom' };
    changed = true;
  }
  // `fought` (28/09) nasce na leitura do save; um resultado lido antes disso ganha o seu aqui, sem
  // gravar — ele e derivado dos result.json e vai junto no proximo saveState.
  if (state.stage === 'result' && !Array.isArray(state.fought)) state.fought = [...foughtIds(state)].sort((a, b) => a - b);
  if (!state.units && state.coreFile && fs.existsSync(state.coreFile)) {
    state.units = unitDirectory(state.coreFile);
    state.purchased = state.purchased || [];
    changed = true;
  }
  // Prices used to be one flat number per campaign; now every unit is priced for what it is.
  if (state.units && state.units.some((u) => u.price === undefined)) {
    const R = rules();
    state.units = state.units.map((u) => ({ ...u, role: roleOf(u.name, u.offMap, R), price: priceUnit(u, state.nation, R) }));
    delete state.unitPrice;
    changed = true;
  }
  // A biblioteca era um LADO mais uma caixinha; virou um conjunto de exercitos. A campanha antiga
  // guarda exatamente a mesma coisa dita do jeito novo, e o inimigo dela continua sendo o que era.
  if (!state.armies) {
    const lado = state.side || (state.nation === 'RU' ? 'RU' : 'US');
    state.armies = armiesOf([...(SIDES[lado]?.nations || ['US', 'UKR']), ...(state.includeEnemyLibrary ? SIDES[otherSide(lado)].nations : [])]);
    state.enemySide = state.enemySide || otherSide(lado);
    changed = true;
  }
  // Quem defende continua sendo quem defendia: uma campanha que so viu americanos nao passa a ver
  // ucranianos na batalha seguinte por causa de uma versao nova do app.
  if (!state.enemyArmies) { state.enemyArmies = [state.enemy].filter(Boolean); changed = true; }
  // A chance do socorrido voltar era regra global; quem nao escolheu fica com o que a regra dizia
  // quando a campanha nasceu, para nao mudar o jogo por baixo de uma campanha em andamento.
  if (state.rescueChance === undefined) {
    state.rescueChance = state.rulesUsed?.replacement?.rescueChance ?? rules().replacement?.rescueChance ?? 0;
    changed = true;
  }
  // A nacionalidade da unidade sai da escolha que a trouxe, e isso ja esta no estado — nada de
  // reler o arquivo, entao campanhas antigas ganham a coluna na primeira abertura.
  if (state.units && state.units.some((u) => u.nation === undefined)) {
    state.units = comNacao(state, state.units);
    changed = true;
  }
  // A unidade passou a carregar o que ELA e (112.12); campanhas anteriores nao sabiam disso.
  if (state.units && state.coreFile && fs.existsSync(state.coreFile) && state.units.some((u) => u.experience === undefined)) {
    const agora = new Map(unitDirectory(state.coreFile).map((u) => [u.coreId, u]));
    state.units = state.units.map((u) => ({ ...u, experience: agora.get(u.coreId)?.experience }));
    changed = true;
  }
  // `experience` (so o nivel) virou `attrs` (o que a unidade e, campo a campo).
  if (state.experience && !state.attrs) {
    state.attrs = Object.fromEntries(Object.entries(state.experience).map(([id, nivel]) => [id, { experiencia: nivel }]));
    delete state.experience;
    changed = true;
  }
  // A promocao passou de xp acumulado para CONTAGEM por nivel (E50): batalhas e vitorias desde que
  // a unidade chegou ao nivel em que esta. Uma campanha de antes comeca zerada no nivel que tem —
  // o xp que ela guardava nao se traduz em "quantas batalhas faltam", e ninguem e rebaixado.
  if (!state.record && state.units) {
    state.record = Object.fromEntries(state.units.map((u) => [u.coreId, { battles: 0, wins: 0 }]));
    delete state.xp;
    changed = true;
  }
  // As marcas de veiculo eram duas listas (perdido / inteiro) e viraram um estado por maquina, com
  // as tres coisas que o jogo distingue. O que ja estava marcado como perdido entra como destruido,
  // que e o que aquela marca queria dizer quando so havia duas respostas.
  if (!state.vehicles && ((state.lost || []).length || (state.survived || []).length)) {
    state.vehicles = {};
    for (const id of state.lost || []) state.vehicles[id] = 'destroyed';
    for (const id of state.survived || []) state.vehicles[id] = 'survived';
    changed = true;
  }
  // O destroco que JA FOI REPOSTO nao e mais "maquina esperando reposicao": a marca dele fica
  // 'replaced' e ele sai de `lost`. Sem isto a campanha do autor trazia o BMP-2M #1, queimado e
  // reposto na batalha 1, de volta a lista de perdidos a cada save lido.
  for (const w of state.wrecked || []) {
    if (!w.replacedBy) continue;
    if ((state.vehicles || {})[w.coreId] === 'destroyed' || (state.vehicles || {})[w.coreId] === 'knocked_out') { state.vehicles[w.coreId] = 'replaced'; changed = true; }
    if ((state.lost || []).includes(w.coreId)) { state.lost = state.lost.filter((id) => id !== w.coreId); changed = true; }
  }
  // Campanhas em andamento nao tem a marca do que o app ja entregou; o arquivo que esta na mao do
  // jogador agora e o que da para marcar sem inventar historia.
  if (state.current && !state.current.handed && state.current.playFrom?.kind === 'save' && fs.existsSync(state.current.playFrom.file)) {
    if (handSave(state, state.current.playFrom.file)) changed = true;
  }
  if (state.current && !state.current.enemyUnits && state.current.bttFile && fs.existsSync(state.current.bttFile)) {
    try { state.current.enemyUnits = enemyDirectory(state.current.bttFile); changed = true; } catch { /* battle file gone */ }
  }
  // O KIT-OUT NAO CONTA (19/10): nem recompensa nem estipendio. A migracao abaixo nao olhava `kitOut` e calculava o
  // estipendio da batalha seguinte no resultado do kit-out; a acao seguinte gravava os dois no estado e a loja somava
  // 1.362 cr que o servidor nunca pagaria (UKR, 25/10: 469 viraram "1800"). Um estado gravado assim e limpo aqui.
  if (state.stage === 'result' && state.pending?.result?.kitOut && (state.pending.result.reward || state.pending.result.stipend || state.pending.result.income)) {
    delete state.pending.result.reward; delete state.pending.result.stipend; delete state.pending.result.income; changed = true;
  }
  // O QUE FOI PAGO (autor, 29/10): a venda devolve o que saiu da bolsa, e a campanha antiga ganha o `paid` de cada unidade
  // pelo preco que o pick custou (`picks[i].price`), repartido entre as unidades que vieram com ele; a comprada do
  // arsenal, pelo preco dela. E o livro-razao comeca aqui, com os creditos de agora.
  if ((state.units || []).some((u) => u.paid === undefined)) { migrarPago(state); changed = true; }
  if (state.ledger === undefined && Number.isFinite(state.credits)) { state.ledgerBase = state.credits; state.ledger = []; changed = true; }
  if (changed) saveState(state);
  // A RESULT READ BY AN OLDER BUILD carries no income, and the page showed "0 paid" while Apply, which recomputes it,
  // paid more (QA r8, MY-CAMPAIGN-). Filled here, in memory, by the same function Apply uses — e e o que faz os fixtures
  // do QA, congelados antes da escada (30/10), abrirem com as tres linhas.
  if (state.stage === 'result' && state.pending?.result && !state.pending.result.kitOut && !state.pending.result.income) {
    try { state.pending.result.income = incomeFor(state, state.pending.result, rules()); } catch { /* a result too old to price: the page shows what it has, Apply still decides */ }
  }
  return state;
}

// Written to a temporary file and renamed: a crash mid-write must not leave a half state.
export function saveState(state) {
  const f = stateFile(state.slug);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp';
  const { vehicleBase: _derivado, ...gravar } = state;   // derivado na leitura (loadState), nunca no disco
  fs.writeFileSync(tmp, JSON.stringify(gravar, null, 1) + '\n');
  fs.renameSync(tmp, f);
  return state;
}

// ------------------------------------------------------------------------- earning it in battle
//
// A unit is bought at a level and then EARNS the rest. What it earns is not a matter of opinion:
// it took the field or it did not, the battle was won or it was not, it bled or it did not. The
// three inputs are in the result already, so this is a pure function of (force, result, rules) —
// no randomness, so the screen can show what a battle earned before the player applies it and get
// the same answer the writing does.
//
// Nothing is ever demoted. The game has no mechanic for forgetting, and losing men is punishment
// enough; a squad that survives a defeat has still learnt something.
// O QUE FALTA PARA O PROXIMO NIVEL, dado o que a unidade ja fez NELE (E50). Uma so exigencia por
// nivel — quantas batalhas — e a VITORIA VALE POR DUAS (`victoryWorth`). Um Regular precisa de 4:
// quatro empates, duas vitorias, ou qualquer mistura que some quatro. Um numero e um multiplicador
// dizem o que dois numeros diziam, e a corrida misturada sai de graca.
export function promotionNeed(nivel, R) {
  const P = R.progression?.promotion;
  const battles = P?.battles?.[nivel];
  if (!battles) return null;                                // Elite: nao ha degrau acima
  const worth = P.victoryWorth ?? 2;
  return { battles, worth, victories: Math.ceil(battles / worth) };
}
// Quanto uma folha de servico vale para o proximo degrau: cada batalha uma, cada vitoria mais uma.
export function promotionPoints(record, R) {
  const worth = R.progression?.promotion?.victoryWorth ?? 2;
  const { battles = 0, wins = 0 } = record || {};
  return battles + wins * (worth - 1);
}
export function promotedFrom(nivel, record, R) {
  const need = promotionNeed(nivel, R);
  if (!need || promotionPoints(record, R) < need.battles) return null;
  const niveis = R.units.experienceLevels;
  const i = niveis.indexOf(nivel);
  return i < 0 || i + 1 >= niveis.length ? null : niveis[i + 1];
}
const passo = (escala, nivel, delta, min, max) => {
  const i = escala.indexOf(nivel);
  if (i < 0) return nivel;
  const lo = Math.max(0, escala.indexOf(min)), hi = escala.indexOf(max) < 0 ? escala.length - 1 : escala.indexOf(max);
  return escala[Math.min(hi, Math.max(lo, i + delta))];
};

// A ESCADA (30/10/2026, autor: "qual o nivel de recompensa maximo que o jogador pode ter em cada batalha e utilizar isto
// como o fator de acrescimo da forca inimiga"). Ate aqui a batalha pagava ate 1,1x o custo da defesa e mais 15% do
// orcamento da proxima: uma renda proporcional ao TAMANHO do inimigo, enquanto ele so crescia pelo DELTA, e quem vencia
// crescia ~4x mais rapido que a escada (UKR, b4: 7.198 cr contra 3.740). Agora (01/11, autor: o jogador fixo, o inimigo
// escalado):
//
//   o degrau E_n     o orcamento da batalha n em 1x (tierBudgets, sem o fator do encontro nem o peso do no);
//   o par P_n        a escada do jogador, startingCredits x E_n / E_1 — a mesma em todo nivel, e P_1 sao os creditos
//                    iniciais;
//   a razao R        a dificuldade, escolhida na criacao, pelo lado do inimigo: o de um Attack e P_n / R (o esforco
//                    startingCredits / (E_1 x R)); o encontro e 1:1 em todo nivel;
//   o debrief        paga tres linhas — o DEGRAU P_n+1 - P_n, garantido; a COBERTURA da conta de reposicao ate um teto
//                    (capShare x P_n x o peso do no), vezes a nota da batalha; e o BONUS de uma fracao do teto que nao
//                    precisou ser usado, vezes a nota.
//
// Quem nao perde nada fica no par a campanha inteira (mais o bonus, devagar); quem perde muito ou luta mal cai abaixo.
// Tudo puro de (state, result, rules), para a tela prometer exatamente o que o Apply paga.
const clamp01 = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

// O degrau da batalha n; 0 fora da campanha (tierOf de uma batalha alem da ultima cai no ultimo tier).
export function rungOf(n, R = rules()) {
  return n >= 1 && n <= R.battlesToWin ? tierBudgets(n, R, { effort: 1 }).total : 0;
}
export function ladder(R = rules()) {
  return Array.from({ length: R.battlesToWin }, (_, i) => rungOf(i + 1, R));
}
// A razao do preset padrao; uma campanha sem o campo (os fixtures do QA, congelados antes de 30/10) le esta.
export function defaultRatio(R = rules()) {
  const p = (R.difficulty?.presets || []).find((x) => x.name === R.difficulty?.default);
  return Number(p?.ratio ?? R.difficulty?.ratioOptions?.[0] ?? 1);
}
export function ratioOf(state, R = rules()) {
  return Number.isFinite(state?.forceRatio) ? state.forceRatio : defaultRatio(R);
}
// So uma das razoes que a regra oferece: um numero solto vindo da pagina viraria uma campanha impossivel de reproduzir.
function razaoValida(v, R) {
  const n = Number(v);
  return (R.difficulty?.ratioOptions || []).includes(n) ? n : defaultRatio(R);
}
// Os creditos iniciais (01/11): fixos em todo nivel.
export function startingCredits(R = rules()) {
  return R.startingCredits;
}
// O par da batalha n: a escada do jogador. 0 fora da campanha.
export function playerRung(n, R = rules()) {
  const e1 = rungOf(1, R);
  return e1 ? Math.round((startingCredits(R) * rungOf(n, R)) / e1) : 0;
}
export function playerLadder(R = rules()) {
  return Array.from({ length: R.battlesToWin }, (_, i) => playerRung(i + 1, R));
}
// O ESFORCO DO INIMIGO (01/11) sai da razao: o inimigo de um Attack vale o par / R.
export function effortFor(ratio, R = rules()) {
  return startingCredits(R) / (rungOf(1, R) * ratio);
}
// So o Attack escala; o encontro e 1:1 em todo nivel (autor, 01/11).
export function enemyEffortFor(state, kind, R = rules()) {
  return kind === 'Meet' ? 1 : effortFor(ratioOf(state, R), R);
}

// Whether there IS a next battle to be paid for: the campaign ends on the third defeat or with the
// last battle won. Read before `defeatsLeft` is decremented, so the debrief and `applyResult` agree.
function acabaAqui(state, result, R) {
  const n = result.battle;
  const derrotasDepois = derrotasDepoisDe(state, result);
  return derrotasDepois < 0 || n >= R.battlesToWin;
}

// O DEGRAU (o command allotment): o quanto a escada do jogador sobe da batalha n para a n+1, faca ele o que fizer. Nao
// depende do no (pesado ou leve), do tipo da batalha nem da dificuldade. Nada depois da ultima, nem depois da derrota
// que encerra.
export function stepFor(state, n, R = rules(), { campaignOver = false } = {}) {
  const from = playerRung(n, R), to = playerRung(n + 1, R);
  const over = campaignOver || n >= R.battlesToWin;
  return { battle: n + 1, from, to, credits: over ? 0 : Math.max(0, to - from), campaignOver: over };
}

// O TETO DA COBERTURA: capShare do par da batalha, vezes o peso do no (path.enemyWeights[].mult).
export function capFor(n, bandMult = 1, R = rules()) {
  return Math.round((R.reward?.replacement?.capShare ?? 0) * playerRung(n, R) * (bandMult ?? 1));
}

// A CONTA DE REPOSICAO da batalha: o que o Quartermaster cobraria para repor tudo o que ela custou — as maquinas que
// ela destruiu, pelo preco da reposicao (vehicleCost, em Green), e os homens a comprar menos a tripulacao, que volta com a
// maquina (machineCrew, a mesma regra do quoteApply). As maquinas sao as que o save marcou nesta batalha, com a marca de
// AGORA: o jogador corrige as marcas no Quartermaster (markVehicle), e a conta acompanha.
export function billFor(state, result, R = rules()) {
  const perMan = R.replacement?.creditsPerMan ?? 0;
  const marcas = result.vehicles?.marks || {};
  const machines = Object.keys(marcas).map(Number)
    .filter((id) => { const s = state.vehicles?.[id] ?? marcas[id]; return s === 'destroyed' || s === 'knocked_out'; })
    .map((id) => (state.units || []).find((u) => u.coreId === id)).filter(Boolean)
    .map((u) => ({ coreId: u.coreId, name: u.name, cost: vehicleCost(u, 'destroyed', R, u.nation || state.nation) }));
  const machinesCost = machines.reduce((a, m) => a + m.cost, 0);
  const baixas = result.casualtiesToBuy || [];
  const crewFree = baixas.length ? machineCrew(state, baixas).length : 0;
  const toBuy = Math.max(0, baixas.length - crewFree);
  return { total: machinesCost + toBuy * perMan, machines, machinesCost, men: { toBuy, crewFree, perMan, cost: toBuy * perMan } };
}

// A NOTA DA BATALHA (0..1): a media ponderada das tres fracoes que a recompensa usava desde 12/09, nenhuma delas pedindo
// vitoria —
//   objectives   os pontos que voce segura no fim sobre os pontos do mapa;
//   attrition    o inimigo que voce derrubou: homens e maquinas, misturados por `vehicleShare` quando ele trouxe alguma;
//   survival     a forca que voce trouxe para casa, dos mesmos dois jeitos — vezes o engajamento (objetivos + baixas,
//                ate 1), para que cessar fogo no primeiro turno nao valha nada.
// Quem nunca pisa no mapa fica fora de todas as contas.
export function scoreFor(state, result, R = rules()) {
  const cfg = R.reward || {};
  const w = cfg.weights || { objectives: 0.5, attrition: 0.3, survival: 0.3 };
  const vs = cfg.vehicleShare ?? 0.5;
  const ehMaquina = (u) => isMachine(u, R);
  const mix = (men, veh) => (veh === null ? men : (1 - vs) * men + vs * veh);
  const aar = result.aar || {};
  const p = aar.player || {}, e = aar.enemy || {};

  // Objectives: points over points at stake.
  const available = result.verdict?.available || 0;
  const objectives = available ? clamp01((p.pontos || 0) / available) : 0;

  // Attrition: the enemy order of battle is known exactly (the app built it); its men per unit
  // come from the roster type table, the same one that gives every unit its roster line.
  let porPar = new Map();
  try { porPar = new Map(Object.values(typeTable().tipos || typeTable()).map((t) => [`${t.val},${t.tab}`, t])); } catch { /* sem tabela, so veiculos contam */ }
  const enemy = (state.current?.enemyUnits || []).filter((u) => u.present && !u.offMap);
  const enemyMen = enemy.reduce((a, u) => a + (porPar.get(String(u.type))?.n || 0), 0);
  const enemyVeh = enemy.filter((u) => ehMaquina({ role: roleOf(u.name, false, R), name: u.name })).length;
  const enemyMenLost = Math.min(enemyMen, (e.mortos || 0) + (e.feridos || 0) + (e.desaparecidos || 0));
  const enemyVehLost = Math.min(enemyVeh, (e.tanques || 0) + (e.blindados || 0) + (e.outrosVeiculos || 0));
  const attrition = clamp01(mix(enemyMen ? enemyMenLost / enemyMen : 0, enemyVeh ? enemyVehLost / enemyVeh : null));

  // Survival: your own men and machines that set foot on the map, from the roster the game wrote.
  const fora = offMapCoreIds(state);
  const own = (state.units || []).filter((u) => u.present && !fora.has(u.coreId));
  const byId = new Map((result.units || []).map((u) => [u.coreId, u]));
  let fielded = 0, alive = 0;
  for (const u of own) { const r = byId.get(u.coreId); if (!r) continue; fielded += r.instantiated || 0; alive += r.alive || 0; }
  const ownVeh = own.filter((u) => ehMaquina(u)).length;
  const ownVehLost = Math.min(ownVeh, (p.tanques || 0) + (p.blindados || 0) + (p.outrosVeiculos || 0));
  const survivalRaw = clamp01(mix(fielded ? alive / fielded : 0, ownVeh ? (ownVeh - ownVehLost) / ownVeh : null));
  const engagement = cfg.survivalNeedsEngagement === false ? 1 : clamp01(objectives + attrition);

  const soma = (w.objectives ?? 0) + (w.attrition ?? 0) + (w.survival ?? 0);
  const bruto = (w.objectives ?? 0) * objectives + (w.attrition ?? 0) * attrition + (w.survival ?? 0) * survivalRaw * engagement;
  return {
    score: soma ? Math.round((bruto / soma) * 1000) / 1000 : 0,
    weights: w,
    shares: { objectives, attrition, survival: survivalRaw, engagement },
    counts: { available, points: p.pontos || 0, enemyMen, enemyMenLost, enemyVeh, enemyVehLost, fielded, alive, ownVeh, ownVehLost },
  };
}

// A COBERTURA E O BONUS, pura dos tres numeros (o simulador da economia usa a mesma).
export function coverFor({ bill, cap, score }, R = rules()) {
  const covered = Math.max(0, Math.min(bill, cap));
  return {
    covered,
    cover: Math.round(covered * clamp01(score)),
    bonus: Math.round((R.reward?.replacement?.unusedBonus ?? 0) * Math.max(0, cap - covered) * clamp01(score)),
  };
}

// O QUE A BATALHA PAGA: as tres linhas e a conta de cada uma, como a tela mostra.
export function incomeFor(state, result, R = rules()) {
  const n = result.battle;
  const ratio = ratioOf(state, R);
  const sc = scoreFor(state, result, R);
  const step = stepFor(state, n, R, { campaignOver: acabaAqui(state, result, R) });
  const bandMult = state.current?.rewardMult ?? 1;
  const band = (R.path?.enemyWeights || []).find((w) => w.mult === bandMult)?.id || 'normal';
  const bill = billFor(state, result, R);
  const cap = capFor(n, bandMult, R);
  const c = coverFor({ bill: bill.total, cap, score: sc.score }, R);
  const rep = R.reward?.replacement || {};
  return {
    model: 'ladder', battle: n, ratio, step,
    cover: { credits: c.cover, bill: bill.total, covered: c.covered, cap, capShare: rep.capShare ?? 0, bandMult, band, rung: playerRung(n, R), score: sc.score, machines: bill.machines, machinesCost: bill.machinesCost, men: bill.men },
    bonus: { credits: c.bonus, share: rep.unusedBonus ?? 0, unused: cap - c.covered, score: sc.score },
    score: sc.score, weights: sc.weights, shares: sc.shares, counts: sc.counts,
    total: step.credits + c.cover + c.bonus,
  };
}

export function progress(state, result, R = rules()) {
  const P = R.progression;
  const out = { on: !!P?.on, gains: [], promotions: [] };
  if (!P?.on) return out;

  const niveis = R.units.experienceLevels;
  const motivacoes = ['Poor', 'Low', 'Normal', 'High', 'Extreme', 'Fanatic'];
  const sangrou = new Set((result.casualtiesToBuy || []).map((c) => c.coreId).filter((x) => x !== null));
  const venceu = result.verdict?.won === true;
  const perdeu = result.verdict?.won === false;

  for (const u of state.units || []) {
    if (!u.present) continue;                       // quem nao entrou nao aprendeu
    const atual = state.attrs?.[u.coreId] || {};
    const nivelAgora = atual.experiencia || u.experience || niveis[0];
    const motivacaoAgora = atual.motivacao || u.motivation || null;
    // A folha de servico DESTE nivel, mais a batalha que acabou de acontecer. Empate e derrota
    // contam uma; a vitoria conta duas (`victoryWorth`), e por isso as duas contagens ficam
    // guardadas em vez do total: a tela mostra de que sao feitos os pontos.
    const antes = state.record?.[u.coreId] || { battles: 0, wins: 0 };
    const agora = { battles: (antes.battles || 0) + 1, wins: (antes.wins || 0) + (venceu ? 1 : 0) };
    const precisa = promotionNeed(nivelAgora, R);
    // Um degrau por batalha, e as contagens zeram no degrau. Nunca abaixo do que a unidade ja e:
    // ela pode ter sido COMPRADA acima do que teria conquistado.
    const nivelNovo = promotedFrom(nivelAgora, agora, R) || nivelAgora;
    const depois = nivelNovo !== nivelAgora ? { battles: 0, wins: 0 } : agora;
    const motivacaoNova = motivacaoAgora && (venceu || perdeu)
      ? passo(motivacoes, motivacaoAgora, venceu ? P.motivation.onVictory : P.motivation.onDefeat, P.motivation.min, P.motivation.max)
      : motivacaoAgora;

    out.gains.push({
      coreId: u.coreId, name: u.name, formation: u.formation,
      record: { before: antes, counted: agora, after: depois, needs: precisa, points: promotionPoints(agora, R) }, blooded: sangrou.has(u.coreId),
      experience: nivelNovo, motivation: motivacaoNova,
    });
    if (nivelNovo !== nivelAgora || motivacaoNova !== motivacaoAgora) {
      out.promotions.push({
        coreId: u.coreId, name: u.name, formation: u.formation,
        from: nivelAgora, to: nivelNovo,
        motivationFrom: motivacaoAgora, motivationTo: motivacaoNova,
      });
    }
  }
  return out;
}

// LEADERSHIP (18/10, autor): sorteada quando a unidade e PAGA, e o jogador so a ve depois; sobe um degrau a cada
// `cleanBattlesPerStep` batalhas sem perdas, acumuladas. Escala do editor (tools/re/atributos.mjs LIDERANCA).
export const LEADERSHIP = ['-2', '-1', '0', '+1', '+2'];

export function drawLeadership(R, dado) {
  const w = R.progression?.leadership?.draw || {};
  const total = LEADERSHIP.reduce((a, k) => a + (w[k] || 0), 0);
  if (!(total > 0)) return null;
  let x = dado() * total;
  for (const k of LEADERSHIP) { x -= w[k] || 0; if (x < 0) return k; }
  return LEADERSHIP[LEADERSHIP.length - 1];
}

// Semeado por campanha + core id (+ sal), para o undo e um novo Apply sortearem o mesmo valor.
export function leadershipSeed(state, coreId, salt = 0) {
  return ((state.seed || 0) ^ Math.imul(coreId + 1, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35)) >>> 0;
}

// Sorteia e grava no estado (attrs + contador zerado). So para quem acabou de ser pago: o estado inteiro vai para a
// pagina, e o valor de quem nao foi comprado nao pode existir nele.
export function drawLeadershipFor(state, ids, R, salt = 0) {
  if (!R.progression?.leadership?.on) return [];
  state.attrs = state.attrs || {};
  state.cleanBattles = state.cleanBattles || {};
  const out = [];
  for (const id of ids) {
    if (id === null || id === undefined) continue;
    const v = drawLeadership(R, rng(leadershipSeed(state, id, salt)));
    if (!v) continue;
    state.attrs[id] = { ...(state.attrs[id] || {}), lideranca: v };
    state.cleanBattles[id] = 0;
    out.push({ coreId: id, leadership: v });
  }
  return out;
}

// O que a batalha fez com a leadership de cada unidade em campo. Perda = homem ferido ou morto (`bloodied`, lido
// antes do resgate) ou o veiculo destruido nesta batalha; imobilizado nao conta. Pura: a tela mostra e o Apply grava.
export function leadershipProgress(state, result, R = rules()) {
  const L = R.progression?.leadership;
  const out = { on: !!L?.on, gains: [], promotions: [] };
  if (!L?.on) return out;
  const passo = L.cleanBattlesPerStep || 2;
  const teto = Math.max(0, LEADERSHIP.indexOf(L.max ?? '+2'));
  const sangrou = new Set((result.bloodied || (result.casualtiesToBuy || []).map((c) => c.coreId)).filter((x) => x !== null && x !== undefined));
  const marcas = result.vehicles?.marks || {};
  const parado = new Set(state.standDown || []);
  for (const u of state.units || []) {
    if (!u.present || parado.has(u.coreId)) continue;
    const marca = state.vehicles?.[u.coreId] ?? marcas[u.coreId];
    const queimou = Object.prototype.hasOwnProperty.call(marcas, u.coreId) && (marca === 'destroyed' || marca === 'knocked_out');
    const limpa = !sangrou.has(u.coreId) && !queimou;
    const antes = state.cleanBattles?.[u.coreId] || 0;
    const de = state.attrs?.[u.coreId]?.lideranca ?? u.leadership ?? '0';
    let depois = antes + (limpa ? 1 : 0);
    let para = de;
    if (depois >= passo) {
      const i = LEADERSHIP.indexOf(de);
      if (i >= 0 && i < teto) para = LEADERSHIP[i + 1];
      depois -= passo;
    }
    out.gains.push({ coreId: u.coreId, name: u.name, formation: u.formation, clean: limpa, before: antes, after: depois, from: de, to: para });
    if (para !== de) out.promotions.push({ coreId: u.coreId, name: u.name, formation: u.formation, from: de, to: para });
  }
  return out;
}

// ------------------------------------------------------------------------------- the picking

// What a player pick costs and how big it is, without generating anything.
// A SINGLE VEHICLE IS AN EXTRA OF THE FORMATION IT WAS BOUGHT FOR (E51, 13/09). the author bought
// three MT-LBs "inside" his tactical group and the quartermaster showed him three random
// battalions with one MT-LB each: the old attach took one leaf of whatever library source was
// cheapest, and the label on the chart was the app's promise, not the file's. Now the pick
// carries `extras: [{ tipo, key, type }]` — a unit name and the key of the formation it goes
// into — and the forge synthesizes each one INSIDE that formation when the core force is minted
// (FORMATO 98). Priced here like any unit of that name at `singleVehicles.experience`, which is
// also the level it is written with. `em` is the path of names the generator resolves.
const extraLevel = (R) => R.singleVehicles?.experience || 'Regular';
const nodeByKey = (tree, key) => {
  let out = null;
  const walk = (n) => { if (n.key === key) out = n; n.children.forEach(walk); };
  tree.roots.forEach(walk);
  return out;
};
// Names with occurrence from the root down to the node — `Company (Rifle)`, `Platoon (Rifle)#2` —
// the way `resolverDestino` reads them. The root itself is the formation the pick is, so it is not
// named; an empty path means "the top formation".
const pathTo = (tree, key) => {
  const idx = key.split('.').map(Number);
  let node = tree.roots[idx[0]];
  const out = [];
  for (const i of idx.slice(1)) {
    node = node?.children?.[i];
    if (!node) return null;
    out.push(`${node.name}${node.occurrence > 1 ? '#' + node.occurrence : ''}`);
  }
  return out;
};
export function extrasOf(p, tree, nation, R = rules()) {
  return (p.extras || []).map((e) => {
    const alvo = nodeByKey(tree, e.key);
    if (!alvo || !alvo.isFormation) throw new Error(`${e.tipo}: cannot be attached to ${e.key} — that is not a formation of ${p.source}`);
    const fora = (R.singleVehicles?.exclude || []).find((x) => (Array.isArray(e.type) ? x.type[0] === Number(e.type[0]) && x.type[1] === Number(e.type[1]) : x.name === e.tipo));
    if (fora) throw new Error(`${e.tipo}: not sold as a single unit — ${fora.why}`);
    // so o que a lista do autor vende como anexo (18/10): a uniao das listas de todos os exercitos
    const permitidos = R.singleVehicles?.allow;
    if (permitidos && !Object.values(permitidos).some((l) => (l || []).includes(e.tipo))) {
      throw new Error(`${e.tipo}: not sold as a single vehicle — the attached vehicles are ${[...new Set(Object.values(permitidos).flat())].join(', ')}`);
    }
    // SO DO EXERCITO DA FORMACAO (25/11, relato de um jogador, US + UKR): o M1126, o M1152 e o LMTV anexados a uma
    // companhia ucraniana entraram no arquivo e o jogo os deixou fora da batalha (instantiated 0 no save; o Ural, da
    // UKR, entrou). O jogo nao poe veiculo de outro exercito numa formacao. So na compra: o que ja foi comprado assim
    // nao passa mais por aqui.
    const exercito = p.nation || nation;
    if (permitidos && permitidos[exercito] && !permitidos[exercito].includes(e.tipo)) {
      const dono = Object.keys(permitidos).filter((k) => (permitidos[k] || []).includes(e.tipo)).join('/');
      throw new Error(`${e.tipo} is a ${dono} vehicle and cannot join a ${exercito} formation — the game leaves it out of the battle. A ${exercito} formation takes ${permitidos[exercito].join(', ') || 'no single vehicle'}.`);
    }
    const em = pathTo(tree, e.key);
    const experience = extraLevel(R);
    const priced = priceUnits([{ name: e.tipo, offMap: false, type: e.type || null, experience, single: true }], p.nation || nation, R);
    return { tipo: e.tipo, key: e.key, type: e.type || null, em, experience, price: priced.total, target: alvo.name, byRole: priced.byRole };
  });
}

// O VEICULO ANEXADO A UMA FORMACAO JA DA CAMPANHA (30/10, autor: "comprei o caminhao dentro do pelotao de grenade
// launcher, mas ele aparece dentro do pelotao de engenharia"). Antes a tela comprava a copia livre mais barata da
// biblioteca e o servidor enxertava a fonte INTEIRA dela: a maquina lutava onde aquela copia morava. Agora o corpo do
// Apply diz `attachOwned: [{ pick, key, tipo, type }]` — a formacao (o indice do pick na campanha e a chave dela na
// arvore da fonte) e a maquina —, cotada como o anexo de uma formacao nova (`extrasOf`: a lista do autor, o nivel e o
// preco do avulso, o molde de roster) e inserida DENTRO dela por `forge.growCoreForce` (`attachOwned`). O topo da forca
// e o pick: cada pick entrou como uma formacao de topo, na ordem.
export function attachOwnedOf(state, attachOwned, R = rules()) {
  if (!Array.isArray(attachOwned)) throw new Error('attachOwned must be a list');
  const have = rosterTemplates();
  return attachOwned.map((a) => {
    const i = Number(a?.pick); const p = (state.picks || [])[i];
    if (!Number.isInteger(i) || !p) throw new Error(`attachOwned: there is no formation ${a?.pick} in this campaign`);
    if (p.sf) throw new Error(`${p.sfName || p.source} is special forces — it takes no attached vehicle`);
    if (p.sold) throw new Error(`${p.source.replace(/\.btt$/, '')} was sold — nothing is attached to it`);
    const tree = formationTree(p.source.endsWith('.btt') ? p.source : p.source + '.btt');
    const [e] = extrasOf({ source: p.source, nation: p.nation, extras: [{ tipo: String(a?.tipo || ''), key: String(a?.key || ''), type: Array.isArray(a?.type) ? a.type.map(Number) : null }] }, tree, p.nation || state.nation, R);
    if (e.type && !have.has(`${e.type[0]},${e.type[1]}`)) throw new Error(`${e.tipo} has no roster template, so it cannot join the campaign`);
    if (!e.em) throw new Error(`${e.tipo}: ${e.key} is not a formation of ${p.source}`);
    return { pick: i, topo: i, caminho: e.em, key: e.key, tipo: e.tipo, type: e.type, experience: e.experience, price: e.price, target: e.target };
  });
}

// THE EQUIPMENT THE PLAYER CHOSE FOR A PICK (FORMATO 43.2, E95). `swaps = [{ key, group, to }]`:
// every unit under the node `key` whose choice list starts with `group` becomes the type `to`, the
// way the editor's click on a block changes all 31 tanks of a battalion. The bytes are written by
// `forge.buildCoreForce` on a copy of the library source, before the force is minted — so the choice
// lives on the pick, like `ausentes` and `extras`, and is redone on every rebuild. Here it is checked
// (a type outside the group, or of another army, fails with a sentence and not with a crash on load)
// and applied to a COPY of the tree, so the plan, the bill and the roster check see the units as
// they will be built. Parents first, so the deeper choice wins.
export function normalizeSwaps(p, tree, nation) {
  const out = [];
  for (const s of p.swaps || []) {
    const key = String(s.key ?? ''); const group = Number(s.group);
    const to = Array.isArray(s.to) ? s.to.map(Number) : String(s.to).split(',').map(Number);
    const no = nodeByKey(tree, key);
    if (!no) throw new Error(`equipment: ${key} is not a node of ${p.source}`);
    if (!Number.isInteger(group) || to.length !== 2 || !to.every(Number.isInteger)) throw new Error(`equipment: bad choice ${JSON.stringify(s)} on ${p.source}`);
    // A choice for a group with no unit under the node is not harmless, it is a wrong node or a
    // wrong group from the page — said now, not silently ignored.
    let sob = 0; const conta = (n) => { if (n.isFormation) n.children.forEach(conta); else if (n.group === group) sob++; }; conta(no);
    if (!sob) throw new Error(`equipment: no unit of group ${group} under ${key} in ${p.source}`);
    const G = equipmentTable().exercitos?.[nation]?.grupos?.[group];
    // The path comes along because the type alone does not always name the unit: in group 603 the
    // same type is two different mortars, one per path (FORMATO 41.1).
    const caminho = Array.isArray(s.path) && s.path.length ? s.path.map(Number) : null;
    const tipo = typeKey(to[0], to[1]);
    const opt = G && (G.opcoes[caminho ? `${tipo}@${caminho.join('/')}` : tipo]
      || Object.values(G.opcoes).find((o) => o.tipo === tipo && (!caminho || o.lista.join('/') === caminho.join('/'))));
    if (!opt) throw new Error(`equipment: ${unitTypeName(to[0], to[1]) || tipo} is not an option of group ${group} for ${nation} (${p.source})`);
    // An option the type catalogue cannot name is not sold: the name is what prices it.
    if (opt.duvidoso) throw new Error(`equipment: the game's name for ${tipo} in group ${group} is not known yet (${p.source})`);
    out.push({ key, group, to, path: [...opt.lista], name: opt.nome });
  }
  return out.sort((a, b) => a.key.split('.').length - b.key.split('.').length || a.key.localeCompare(b.key));
}
export function swappedTree(tree, swaps) {
  if (!swaps.length) return tree;
  const copy = JSON.parse(JSON.stringify(tree));           // the cached tree is shared: never written
  for (const s of swaps) {
    const walk = (n) => {
      if (n.isFormation) { n.children.forEach(walk); return; }
      if (n.group !== s.group || String(n.type) === String(s.to)) return;
      n.swappedFrom = n.swappedFrom || n.name;
      n.name = s.name || unitTypeName(s.to[0], s.to[1]) || n.name;
      n.type = [...s.to];
      if (s.path) n.path = [...s.path];
    };
    walk(nodeByKey(copy, s.key));
  }
  return copy;
}

// O TETO DE UNIDADES EM CAMPO (03/10, E125). Medido pela bateria de carga: a forca do jogador carrega ate
// ~960 unidades e o jogo cai (Out of memory ou crash) a partir de ~1.035. `n` sao as unidades da forca que
// vao a batalha. Puro; a tela usa a mesma regra para avisar antes.
export function fieldCapCheck(n, R = rules()) {
  const cap = R.fieldCap || {};
  const level = cap.max && n > cap.max ? 'over' : cap.warn && n > cap.warn ? 'warn' : 'ok';
  return { n, warn: cap.warn ?? null, max: cap.max ?? null, level };
}
// O TETO DE LINHAS DO ROSTER (08/11, ZZ ART US): 508 carregam, 509 dao Out of memory. As linhas de hoje: as que a ultima
// entrega escreveu (refit.rosterLines); sem isso (campanha de antes desta regra), o save entregue, lido uma vez; sem ele,
// uma linha por unidade do diretorio.
// DESDE 10/11 (trimBattle; autor: o Apply da b12 recusado com "516 linhas" quando a entrega enxuta escreveria ~100): a
// entrega so escreve a linha de quem entra em campo ou ja tem homem nomeado nela (enxugarEntrega). As linhas de hoje sao
// essas, contadas no save, nao o roster inteiro que o save traz nem o que a ultima entrega (de antes da regra) escreveu.
const linhasCache = new Map();
// SO SAVE (.bts) (14/11, autor: Apply e Save diagnostics mudos na UKR): uma campanha jogada da propria .cam tem o .cam em
// playFrom.file, e lerRoster sobre um .cam nao termina — o servidor ficava preso nele a cada cotacao. Fora do .bts, erro.
const rosterDoSave = (f) => {
  if (!/\.bts$/i.test(f)) throw new Error(`not a save: ${path.basename(f)}`);
  const k = `${f}|${fs.statSync(f).mtimeMs}`;
  if (!linhasCache.has(k)) { const us = readRoster(f).unidades; linhasCache.set(k, { n: us.length, comHomens: us.filter((u) => u.soldados.length > 0).map((u) => u.coreId) }); }
  return linhasCache.get(k);
};
// os core ids com homem na linha: no save de transicao que o jogo gravou (o que espera o Apply, ou o da proxima batalha) ou
// no entregue antes — quem tem homem num deles fica no roster enxuto, como em enxugarEntrega
export function unitsWithMen(state) {
  const ids = new Set();
  for (const f of [state.next?.save, state.pending?.savePath, state.current?.playFrom?.file]) {
    if (!f) continue;
    try { for (const id of rosterDoSave(f).comHomens) ids.add(id); } catch { /* sem o save, o proximo */ }
  }
  return ids;
}
export function rosterLinesOf(state, R = rules()) {
  if (R.trimBattle?.on !== false) {
    const fora = new Set(state.standDown || []); const homens = unitsWithMen(state);
    return (state.units || []).filter((u) => (u.present && !fora.has(u.coreId)) || homens.has(u.coreId)).length;
  }
  const n = state.current?.refit?.rosterLines;
  if (Number.isInteger(n)) return n;
  const f = state.current?.playFrom?.file;
  if (f) {
    try { return Math.max(rosterDoSave(f).n, (state.units || []).length); } catch { /* sem o save: o diretorio */ }
  }
  return (state.units || []).length;
}
// OS EXERCITOS QUE MANDAM NO TETO: os da biblioteca da campanha (uma campanha US+UKR segue o pior deles, o US), porque nao
// se mediu se o limite e da nacao do jogador ou das unidades que ela carrega. Aceita o estado, uma lista ou uma sigla.
const capArmies = (x) => Array.isArray(x) ? x : typeof x === 'string' ? [x] : (x?.armies?.length ? x.armies : [x?.nation]).filter(Boolean);
const capOf = (tabela, armies) => { if (!tabela) return null; if (typeof tabela !== 'object') return tabela; const vals = capArmies(armies).map((a) => tabela[a]).filter((v) => Number.isFinite(v)); return vals.length ? Math.min(...vals) : null; };
// quantas linhas do roster o jogo LE (08/11): alem disso a unidade presente nao entra (rules.rosterCap.visible)
export function visibleRosterLines(state, R = rules()) { return capOf(R.rosterCap?.visible, state); }
export function rosterCapCheck(lines, R = rules(), armies = null) {
  const max = capOf(R.rosterCap?.max, armies);
  return { lines, max, level: max && lines > max ? 'over' : 'ok' };
}
const visibleError = (lines, visible, armies) => new Error(`the force would have ${lines} units present and the game only reads the first ${visible} roster lines in a ${capArmies(armies).join('+')} campaign (measured: a unit past that line never enters a battle) — leave some of it out, or sell`);
// as linhas que uma formacao comprada acrescenta ao roster: desde 10/11 so o que entra em campo (enxugarEntrega tira as
// ausentes sem homem da batalha e do roster); com R.trimBattle.on = false, uma por unidade do arquivo, como antes
const linhasDaCompra = (p, R) => (R.trimBattle?.on !== false ? (p.units ?? 0) : (p.rosterLines ?? p.units ?? 0));
const nomeDaFonte = (src) => String(src || '').replace(/.btt$/i, '').replace(/^[A-Z]+ - /, '');
const rosterCapError = (c, novas, recruits = [], R = rules()) => new Error(`the campaign roster would have ${c.lines} lines (${R.trimBattle?.on !== false ? 'one per unit in the field or with men on its line' : 'one per unit the campaign ever had'}, ${novas} new${recruits.length ? ': ' + recruits.map((p) => `${nomeDaFonte(p.source)} ${linhasDaCompra(p, R)}`).join(', ') : ''}), and the game runs out of memory loading a campaign above ${c.max} (measured on a US campaign: 508 loaded, 509 did not) — ${Math.max(0, c.max - (c.lines - novas))} line${c.max - (c.lines - novas) === 1 ? '' : 's'} left: take out ${c.lines - c.max} or more`);
const fieldCapError = (c) => new Error(`the force would field ${c.n} units, and the game runs out of memory above about ${c.max} (measured: 959 loaded, 1,035 crashed, 1,285 ran out of memory) — leave some of it out`);

// A pick is an object naming a library source; a list of anything else is refused with a sentence (QA r2 A13), not
// with the TypeError of whatever line touched it first.
export function checkPicks(picks) {
  if (!Array.isArray(picks)) throw new Error('picks must be a list of formations');
  picks.forEach((p, i) => { if (!p || typeof p !== 'object' || typeof p.source !== 'string' || !p.source) throw new Error(`pick ${i + 1} names no formation (source)`);
    if (/[\\/]/.test(p.source)) throw new Error(`pick ${i + 1}: the source is a formation file name, not a path`); });
  return picks;
}

export function priceOfPicks(picks, nation, R = rules()) {
  return checkPicks(picks).map((p0) => {
    // A SPECIAL FORCES PICK IS FIXED: its keys come from the rule, whatever the page sent, and it
    // takes no attachment and no equipment swap — nothing beyond the piece of the source it is.
    let p = p0;
    if (p0.sf) {
      const sf = specialForcesOf(p0.source, R);
      if (!sf) throw new Error(`${p0.source} is not a special forces formation`);
      if ((p0.extras || []).length) throw new Error(`${sf.name}: special forces take no attached unit`);
      if ((p0.swaps || []).length) throw new Error(`${sf.name}: special forces take no equipment swap`);
      const keep = specialForcesKeep(p0.source, R);
      const dentro = new Set(keep);
      // 10/10: every unit of a special forces formation is the rule's experience (Veteran), whatever the page sent
      const nivel = R.formations?.specialForcesExperience;
      const xp = nivel ? Object.fromEntries(keep.map((k) => [k, nivel])) : Object.fromEntries(Object.entries(p0.xp || {}).filter(([k]) => dentro.has(k)));
      p = { ...p0, sf: true, sfName: sf.name, keep, xp, extras: [], swaps: [] };
    }
    const base = formationTree(p.source.endsWith('.btt') ? p.source : p.source + '.btt');
    const swaps = normalizeSwaps(p, base, p.nation || nation);
    const tree = swappedTree(base, swaps);
    const plan = prunePlan(tree, p.keep);
    // The player can buy a unit better (or worse) than the library rolled; the price follows.
    // `baseExperience` is what it came with, so the relative pricing mode can charge the difference.
    const xp = p.xp || {};
    const comXP = plan.keptUnits.map((u) => (xp[u.key] ? { ...u, baseExperience: u.experience, experience: xp[u.key] } : u));
    // A force can mix armies of the same side (American and Ukrainian), and each one is priced
    // with its own nation factor.
    const priced = priceUnits(comXP, p.nation || nation, R);
    // Checked over the WHOLE source, not just what was kept: a pruned unit stays in the file as
    // an absent core unit and still needs its roster line (see catalog.uncoveredUnits).
    const uncovered = uncoveredUnits(tree);
    // And the extras, priced and checked the same way: a synthesized vehicle whose type has no
    // roster template would crash the campaign on load exactly like a library unit without one.
    const extras = extrasOf(p, tree, nation, R);
    const have = rosterTemplates();
    for (const e of extras) if (e.type && !have.has(`${e.type[0]},${e.type[1]}`)) uncovered.push({ name: e.tipo, type: e.type });
    const byRole = { ...priced.byRole };
    for (const e of extras) for (const [k, v] of Object.entries(e.byRole)) byRole[k] = (byRole[k] || 0) + v;
    // a special forces formation has a flat price when the rule sets one (10/10: 1000 cr)
    const flat = p.sf ? R.formations?.specialForcesPrice : null;
    const price = Number.isFinite(flat) ? flat : priced.total + extras.reduce((a, e) => a + e.price, 0);
    // as linhas que a formacao poe no roster: TODA unidade do arquivo, podada ou nao (112.1), e cada anexo (08/11, teto)
    let rosterLines = extras.length; const conta = (n) => { if (!n.isFormation) rosterLines++; (n.children || []).forEach(conta); }; (tree.roots || []).forEach(conta);
    return {
      ...p, swaps, ausentes: plan.ausentes, dropped: plan.droppedUnits,
      units: plan.unitsKept + extras.length, onMapUnits: plan.onMapKept + extras.length, offMapUnits: plan.offMapKept,
      price, byRole, uncovered, extras, rosterLines,
    };
  });
}

// Os pontos operacionais do comeco (E176): so os que a regra oferece.
// Quantas derrotas a campanha aguenta (E179): 0 a 4 ou "unlimited", o que a regra oferece.
function derrotasValidas(v, R) {
  const opcoes = R.defeatsAllowedOptions || [R.defeatsAllowed];
  if (v === 'unlimited' && opcoes.includes('unlimited')) return 'unlimited';
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && opcoes.includes(n) ? n : R.defeatsAllowed;
}
// Sem limite, nenhuma derrota encerra a campanha.
export const semLimiteDeDerrotas = (state) => !!state.defeatsUnlimited;
const derrotasDepoisDe = (state, result) => (semLimiteDeDerrotas(state) ? Infinity : state.defeatsLeft - (result.verdict?.won === false ? 1 : 0));

// A DIFICULDADE (18/10, autor): o nome do preset da regra que bate com TODOS os parametros, ou Custom. Pura; a tela usa a
// mesma comparacao.
export function difficultyOf(p, R = rules()) {
  const presets = R.difficulty?.presets || [];
  const sf = R.formations?.specialForcesPrice;
  const arm = (a) => [...(a || [])].sort().join();
  const hit = presets.find((x) => arm(x.armies) === arm(p.armies) && x.enemySide === p.enemySide && Number(x.ratio) === Number(p.ratio)
    && Number(x.rescueChance) === Number(p.rescueChance) && Number(x.opPoints) === Number(p.opPoints) && String(x.defeats) === String(p.defeats)
    // 06/11 (autor): o preco da Special Forces faz parte do preset; sem o campo, o padrao da regra
    && Number(x.specialForcesPrice ?? sf) === Number(p.specialForcesPrice ?? sf));
  return hit ? hit.name : 'Custom';
}

function pontosValidos(v, R) {
  const opcoes = R.path?.startingPointsOptions || [0, 1, 2, 3];
  const n = Number(v);
  return opcoes.includes(n) ? n : (R.path?.startingPointsDefault ?? 0);
}

// Idem para a chance do socorrido voltar de graca.
function chanceValida(v, R) {
  const opcoes = R.replacement?.rescueChanceOptions || [0, 0.25, 0.5, 0.75, 1];
  const n = Number(v);
  return opcoes.includes(n) ? n : (R.replacement?.rescueChance ?? 0);
}

// ---------------------------------------------------------------------------------- creating

// OS EXERCITOS QUE DEFENDEM. O inimigo e um LADO, e o lado americano tem dois exercitos: cada
// batalha sorteia um deles, e por isso "United States and Ukraine" nao e um rotulo que so entrega
// americanos. E uma LISTA no estado, e nao deduzida do lado toda vez, porque uma campanha em
// andamento nao pode trocar de inimigo no meio: a migracao fixa nela o exercito que ela ja tinha.
export function enemyArmies(state) {
  if (Array.isArray(state.enemyArmies) && state.enemyArmies.length) return state.enemyArmies;
  return [state.enemy].filter(Boolean);
}

// A CHANCE DE UM FERIDO VOLTAR SOZINHO, por campanha. Era uma regra global; virou parametro, porque
// e uma alavanca de dificuldade e nao uma verdade sobre o jogo.
export const rescueChanceOf = (state, R = rules()) =>
  (typeof state.rescueChance === 'number' ? state.rescueChance : (R.replacement?.rescueChance ?? 0));

// O PRECO DAS SPECIAL FORCES DA CAMPANHA (18/10, autor): parametro da criacao. As regras com ele no lugar do da regra,
// para tudo que cobra ou mostra o preco (priceOfPicks, a biblioteca e o grafico da SF). Sem o campo, a regra.
export function rulesFor(state, R = rules()) {
  const v = state?.specialForcesPrice;
  if (!Number.isFinite(v)) return R;
  return { ...R, formations: { ...(R.formations || {}), specialForcesPrice: v } };
}
function precoSFValido(v, R) {
  const opcoes = R.formations?.specialForcesPriceOptions || [R.formations?.specialForcesPrice];
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && opcoes.includes(n) ? n : R.formations?.specialForcesPrice;
}

// A NACAO DO CABECALHO DA BATALHA e a da maioria da forca; uma forca que mistura americanos e ucranianos ainda declara
// uma so (FORMATO 108).
export function nationOfPicks(picks, fallback) {
  const contagem = {};
  for (const p of picks || []) contagem[p.nation || fallback] = (contagem[p.nation || fallback] || 0) + (p.keep?.length || 1);
  return Object.entries(contagem).sort((a, b) => b[1] - a[1])[0]?.[0] || fallback;
}

// O QUE A FORCA PRECISA PARA EXISTIR, sem escrever nada (uma recusa nao deixa pasta, teste 89b): SF e disponibilidade,
// preco contra o orcamento, alguem no mapa, o teto de unidades e molde de roster para todas.
export function checkForce(picks, nation, R = rules(), { budget, harvest = false, armies = null } = {}) {
  checkSpecialForces(picks, R);
  checkRetiredSpecialForces(picks, R);
  checkDiscardedFormations(picks, R);
  checkAvailability(picks, R);
  const priced = priceOfPicks(picks, nation, R);
  const spent = priced.reduce((a, p) => a + (p.price || 0), 0);
  // A HARVEST CAMPAIGN (plano de reset, 28/09) is not a game: it fields every unit type of an army once,
  // for battle 1 to end in a cease-fire at turn 0 and the transition save to carry the factory issue of
  // every man and machine (tools/re/fabrica.mjs). No budget applies.
  if (!harvest && spent > budget) throw new Error(`the force costs ${spent} credits and the budget is ${budget}`);
  if (!priced.some((p) => p.onMapUnits > 0)) throw new Error('the force has no unit that sets foot on the map — off-map support alone cannot take an objective');
  const noCampo = fieldCapCheck(priced.reduce((a, p) => a + (p.units || 0), 0), R);
  if (noCampo.level === 'over') throw fieldCapError(noCampo);
  // e o teto de linhas do roster (08/11): a campanha nasce com uma linha por unidade de cada formacao
  { const total = priced.reduce((a, p) => a + (p.rosterLines || 0), 0); const quem = armies || nation;
    const linhas = rosterCapCheck(total, R, quem);
    if (!harvest && linhas.level === 'over') throw rosterCapError(linhas, linhas.lines, [], R);
    // e a campanha nao nasce com linha alem das que o jogo le: o roster do .cam sai na ordem da forca, sem troca de lugar
    const visible = capOf(R.rosterCap?.visible, quem);
    if (!harvest && visible && total > visible) throw new Error(`the campaign would start with ${total} roster lines (one per unit of every formation, kept or not) and the game only reads the first ${visible} in a ${capArmies(quem).join('+')} campaign — a unit past that line never enters a battle; pick a smaller force`); }
  const uncovered = priced.flatMap((p) => p.uncovered.map((u) => `${u.name} in ${p.source}`));
  if (uncovered.length) {
    throw new Error(`these units have no roster line the game accepts (no template, or no game-written block for a unit without men), so the campaign roster could not cover them: ${[...new Set(uncovered)].join('; ')}`);
  }
  return { priced, spent };
}

// A CUNHAGEM DA FORCA CORE (18/10: tirada de `createCampaign` para servir tambem a `raiseForce`): o mapa de cunho, o
// gerador, a poda das folhas deixadas de fora, experiencia e leadership, e o diretorio de unidades no estado.
async function mintForce(state, priced, R, note, trace, { harvest = false } = {}) {
  const comCaminho = !!(R.path?.on && !harvest);
  // 1. the map for battle 1, so the core force can be minted on a real map. ON A BATTLE PATH (E176, 11/10) there is no
  //    battle 1 yet — the player chooses it on the path — so the force is minted on the biggest tier-1 map that
  //    holds it, which has nothing to do with the nodes; every battle moves the force onto its own map anyway.
  const onMapAgora = priced.reduce((a, p) => a + (p.onMapUnits || 0), 0);
  const map = harvest ? harvestMap(onMapAgora, trace) : comCaminho ? mintMap(onMapAgora, R) : pickMap(state, 1, R, trace);

  // 2. the core force
  note('Building the core force');
  const coreOut = path.join(dirOf(state.slug), 'core-force.btt');
  const core = await buildCoreForce({
    picks: priced, nation: state.nation, enemy: state.enemy, mapFile: mapFileOf(map),
    workDir: path.join(dirOf(state.slug), 'work'), out: coreOut, trace,
  });
  // Units the player switched off one by one, inside a formation he otherwise kept. The generator
  // only prunes whole sub-formations, so these are turned off on the finished core force, by core
  // id — the mirror of a purchase (FORMATO 111.21). The key maps a leaf of the library tree to the
  // same leaf of the force: pick number, then the same path.
  {
    const dir = unitDirectory(coreOut);
    const porChave = new Map(dir.map((u) => [u.key, u]));
    const desligar = [], semPar = [];
    priced.forEach((p, i) => {
      for (const d of p.dropped || []) {
        const u = porChave.get(chaveNaForca(i, d.key));
        if (u) desligar.push(u.coreId); else semPar.push(`${p.source} ${d.name} (${d.key})`);
      }
    });
    if (dir.roots !== priced.length) {
      trace.event('core.leafPruneSkipped', { roots: dir.roots, picks: priced.length, wanted: desligar.length });
    } else if (desligar.length) {
      note(`Switching off ${desligar.length} units you left out`);
      const tmp = path.join(dirOf(state.slug), 'work', 'core-pruned.btt');
      fs.mkdirSync(path.dirname(tmp), { recursive: true });
      activateUnits({ coreFile: coreOut, out: tmp, ids: desligar, present: false, trace });
      fs.copyFileSync(tmp, coreOut);
    }
    if (semPar.length) trace.event('core.leafPruneUnmatched', { units: semPar.slice(0, 10) });

    // EXPERIENCE, by the same key mapping. Written on the finished force so it rides into every
    // battle and into the campaign roster, and kept in the state so a later rebuild can redo it.
    const porUnidade = {};
    priced.forEach((p, i) => {
      for (const [chave, nivel] of Object.entries(p.xp || {})) {
        const u = porChave.get(chaveNaForca(i, chave));
        if (u) porUnidade[u.coreId] = nivel;
      }
    });
    state.attrs = Object.fromEntries(Object.entries(porUnidade).map(([id, nivel]) => [id, { experiencia: nivel }]));
    // E a LEADERSHIP de toda unidade paga (18/10): as que ficaram em campo depois da poda.
    const sorteadas = dir.roots === priced.length
      ? drawLeadershipFor(state, unitDirectory(coreOut).filter((u) => u.present).map((u) => u.coreId), R)
      : [];
    if (sorteadas.length) trace.event('attrs.leadershipDrawn', { at: 'create', units: sorteadas.length });
    if (Object.keys(state.attrs).length && dir.roots === priced.length) {
      note(`Training ${Object.keys(state.attrs).length} units: the experience you paid for and their leaders`);
      const tmp = path.join(dirOf(state.slug), 'work', 'core-xp.btt');
      fs.mkdirSync(path.dirname(tmp), { recursive: true });
      applyAttributes({ coreFile: coreOut, out: tmp, byCoreId: state.attrs, trace });
      fs.copyFileSync(tmp, coreOut);
    }
  }

  state.coreFile = coreOut;
  state.coreUnits = core.units.length;
  // The whole formation is in the file; only what was paid for is switched on. The rest is the
  // arsenal the player buys from between battles (FORMATO 111.21) — no unit is ever inserted.
  // PRICED BY THE UNIT'S OWN ARMY (E59): an American Bradley in a Ukrainian campaign was priced as
  // a generic IFV (250) instead of by the author's sheet (550), because the price was computed before
  // `comNacao` said which army each unit came from. The recruit itself was charged right
  // (`priceOfPicks` prices by the pick's nation); the state's per-unit price — what a replacement
  // or an arsenal purchase costs — was not.
  // (29/10: os picks entram antes, para `comNacao` achar o exercito de cada unidade, e cada unidade comprada leva o
  // `paid`, a parte dela no preco cobrado pelo pick.)
  state.picks = priced;
  state.units = precificarForca(state, comNacao(state, unitDirectory(coreOut).map((u) => ({ ...u, role: roleOf(u.name, u.offMap, R) }))), R);
  state.purchased = [];
  // Cada unidade comeca zerada NO NIVEL COM QUE FOI COMPRADA: o que ela e ja e um adiantamento, e
  // o que conta daqui para a frente sao as batalhas e as vitorias dela nesse nivel (E50).
  state.record = Object.fromEntries(state.units.map((u) => [u.coreId, { battles: 0, wins: 0 }]));
  const active = state.units.filter((u) => u.present).length;
  trace.event('core.directory', {
    units: state.units.length, active, dormant: state.units.length - active,
    priceRange: [Math.min(...state.units.map((u) => u.price)), Math.max(...state.units.map((u) => u.price))],
  });
  state.picks = priced;
  return { map };
}

export async function createCampaign({ name, armies, side, nation, picks, includeEnemyLibrary = false, enemySide, forceRatio, rescueChance, opPoints, defeatsAllowed, specialForcesPrice, harvest = false }, note = () => {}) {
  const R = rules();
  checkPicks(picks);
  // uma biblioteca vazia nao tem o que comprar (a pagina ja recusa; sem forca na criacao, o servidor tambem precisa)
  if (Array.isArray(armies) && !armies.length) throw new Error('pick at least one army for your library');
  // A tela nova manda os exercitos e o lado inimigo; a antiga mandava um lado e uma caixinha. As
  // duas chegam aqui na mesma forma.
  const exercitos = armiesOf(armies || [...(SIDES[side || 'US']?.nations || ['US', 'UKR']), ...(includeEnemyLibrary ? SIDES[otherSide(side || 'US')].nations : [])]);
  const ladoInimigo = SIDES[enemySide] ? enemySide : otherSide(side || (exercitos.includes('RU') && !exercitos.includes('US') ? 'RU' : 'US'));
  const enemy = SIDES[ladoInimigo].nations[0];
  checkArmies(picks, exercitos);
  nation = nationOfPicks(picks, nation || exercitos[0]);
  let slug = slugify(name);
  while (fs.existsSync(dirOf(slug))) slug = slug.slice(0, 10) + '-' + Math.floor(Math.random() * 90 + 10);

  // A CAMPANHA NASCE SEM FORCA (18/10, autor: Battle Path > Quartermaster > Intel > Battle). A pagina manda `picks: []` e a
  // forca e comprada no Quartermaster da batalha 1 (`raiseForce`). Com picks (ferramentas, colheita, testes) ela e
  // cunhada aqui, como sempre foi.
  const comForca = picks.length > 0;
  const comCaminho = !!(R.path?.on && !harvest);
  if (!comForca && !comCaminho) throw new Error('a campaign without a battle path is raised with its force');
  const precoSF = precoSFValido(specialForcesPrice, R);
  // A RAZAO DE FORCA (30/10) e a dificuldade; desde 01/11 ela escala o inimigo, e os creditos iniciais sao fixos.
  const razao = razaoValida(forceRatio, R);
  const inicial = startingCredits(R);
  const { priced, spent } = comForca ? checkForce(picks, nation, rulesFor({ specialForcesPrice: precoSF }, R), { budget: inicial, harvest, armies: exercitos }) : { priced: [], spent: 0 };

  const state = {
    version: STATE_VERSION,
    slug,
    name: String(name).slice(0, 60),
    // OS PARAMETROS DA CAMPANHA, escolhidos uma vez. Todos eles mudariam o jogo se mudassem no
    // meio: as batalhas atras e as batalhas a frente deixariam de ser a mesma campanha.
    armies: exercitos,                 // os exercitos da biblioteca dele
    enemySide: ladoInimigo,            // contra qual lado ele luta
    enemyArmies: SIDES[ladoInimigo].nations,   // e quais exercitos desse lado podem defender
    forceRatio: razao,
    rescueChance: chanceValida(rescueChance, R),
    specialForcesPrice: precoSF,
    difficulty: difficultyOf({ armies: exercitos, enemySide: ladoInimigo, ratio: razao, rescueChance: chanceValida(rescueChance, R), opPoints: pontosValidos(opPoints, R), defeats: derrotasValidas(defeatsAllowed, R), specialForcesPrice: precoSF }, R),
    nation,
    enemy,
    createdAt: new Date().toISOString(),
    seed: Math.floor(Math.random() * 2 ** 31),
    credits: inicial - spent,
    // O LIVRO-RAZAO (29/10): creditos = ledgerBase + entradas - saidas; `invariantesDoEstado` confere
    ledgerBase: inicial,
    ledger: spent ? [{ battle: 0, kind: 'raise', step: 0, cover: 0, bonus: 0, refund: 0, spend: spent }] : [],
    ...(derrotasValidas(defeatsAllowed, R) === 'unlimited' ? { defeatsLeft: null, defeatsUnlimited: true } : { defeatsLeft: derrotasValidas(defeatsAllowed, R) }),
    defeatsAllowed: derrotasValidas(defeatsAllowed, R),   // 25/10: o multiplicador do placar le daqui (o defeatsLeft muda)
    battleNumber: 1,
    stage: 'play',
    picks: priced,
    campaignFile: null,
    coreFile: null,
    coreUnits: 0,
    units: [],
    purchased: [],
    attrs: {},
    record: {},
    cleanBattles: {},
    // Two slots that point at each other: the app always writes the next battle into the one that
    // was not just played (the ping-pong proven by the campaign of FORMATO 111.27).
    battleSlots: [`CMBSDC ${slug} A`, `CMBSDC ${slug} B`],
    playedMaps: [],
    seenSaves: [],
    current: null,
    history: [],
    rulesUsed: { ...R, startingCredits: inicial },
    ...(harvest ? { harvest: true } : {}),
  };
  fs.mkdirSync(dirOf(slug), { recursive: true });
  const trace = traceOf(slug);
  trace.event('campaign.create', { name: state.name, nation, enemy, seed: state.seed, credits: state.credits, spent, force: comForca, picks: priced.map((p) => ({ source: p.source, units: p.units, price: p.price })) });
  const { map } = comForca ? await mintForce(state, priced, R, note, trace, { harvest }) : { map: null };


  // 3. THE BATTLE PATH (E176): every battle, drawn now and kept secret in path.json. Nothing about the nodes goes to the
  //    log: the log is readable from the page, and the secrets are what the operational points buy. The campaign waits
  //    in 'choose' for the player to pick battle 1 on the path; `startCampaign` builds it and writes the .cam.
  if (comCaminho) {
    note('Scouting the road ahead');
    const secret = generatePath({ seed: state.seed, rules: R, enemy: { nation: state.enemy, nations: enemyArmies(state), effort: enemyEffortFor(state, null, R) }, fits: fitsOf(state, R) });
    savePathSecret(slug, secret);
    const pontos = pontosValidos(opPoints, R);
    state.path = publicPath(secret, { startingPoints: pontos });
    state.ops = pontos;
    state.stage = 'choose';
    saveState(state);
    trace.event('path.created', { rows: secret.rows, nodes: secret.nodes.length, perRow: Object.values(secret.nodes.reduce((a, x) => ({ ...a, [x.row]: (a[x.row] || 0) + 1 }), {})), ops: pontos });
    trace.event('campaign.created', { stage: 'choose', force: comForca });
    return state;
  }

  // 3. battle 1
  note('Generating battle 1');
  const battle = await makeBattle(state, 1, map, R, trace);

  // 4. the .cam
  note('Writing the campaign file');
  await writeCampaignFile(state, battle.file, R, trace);
  state.current = { ...battle.current, playFrom: { kind: 'campaign', file: state.campaignFile, label: `CMBSDC ${slug}` } };
  saveState(state);
  trace.event('campaign.created', { campaignFile: fileFacts(state.campaignFile), battle: state.current });
  return state;
}

// QUANTAS UNIDADES O MAPA PRECISA COMPORTAR no sorteio do caminho: as em campo, ou `path.fitsDefault` sem forca ainda.
function fitsOf(state, R) {
  const n = (state.units || []).filter((u) => u.present && !u.offMap).length;
  return n || (R.path?.fitsDefault ?? 30);
}

// A FORCA COMPRADA NO QUARTERMASTER DA BATALHA 1 (18/10, autor): a campanha nasceu sem ela, a batalha 1 ja foi escolhida no
// caminho, e o Intel e a montagem esperam por ela. Mesmas checagens e mesma cunhagem da criacao; o estagio fica `brief`.
export async function raiseForce(slug, { picks } = {}, note = () => {}) {
  const state = loadState(slug);
  const R = rules();
  if (state.coreFile || (state.units || []).length) throw new Error('this campaign already has a force');
  if (state.stage !== 'brief' || !state.next || state.next.n !== 1) throw new Error('the force is raised in the Quartermaster, after battle 1 is chosen on the battle path');
  checkPicks(picks);
  if (!picks.length) throw new Error('pick at least one formation for your force');
  checkArmies(picks, state.armies);
  const nation = nationOfPicks(picks, state.nation || (state.armies || [])[0]);
  const { priced, spent } = checkForce(picks, nation, rulesFor(state, R), { budget: state.credits, armies: state.armies });
  const trace = traceOf(slug, { battle: 1 });
  state.nation = nation;
  await mintForce(state, priced, R, note, trace);
  state.credits -= spent;
  lancar(state, { battle: 1, kind: 'raise', spend: spent });
  // a Special Forces comprada aqui ganha o kit-out antes da batalha 1 (19/10)
  if (kitOutOn(R) && priced.some((p) => p.sf)) state.next.kitOut = 'pending';
  saveState(state);
  trace.event('force.raised', { kitOut: state.next.kitOut || null,
    nation, spent, credits: state.credits, units: state.units.length, fielded: state.units.filter((u) => u.present).length,
    picks: priced.map((p) => ({ source: p.source, units: p.units, price: p.price })),
  });
  return state;
}

// THE .cam OF A CAMPAIGN NOT YET STARTED IN THE GAME. Both slots start with the same battle: the second one is only a
// placeholder that the app overwrites inside the transition save before the player ever loads it. The copy in the
// campaign folder is what undo compares against before deleting the game's one.
async function writeCampaignFile(state, battleFile, R, trace, { noRefit = false } = {}) {
  const camOut = state.campaignFile || path.join(paths().campaigns, `CMBSDC ${state.slug}.cam`);
  await buildCampaign({
    coreFile: state.coreFile,
    battles: [
      { nome: state.battleSlots[0], btt: battleFile, nextWin: 1, nextLose: 1 },
      { nome: state.battleSlots[1], btt: battleFile, nextWin: 0, nextLose: 0 },
    ],
    out: camOut,
    percentages: campaignPercentages(R, noRefit ? { rest: 0 } : {}),
    trace,
  });
  campaignHeader(state, camOut, R, trace);
  state.campaignFile = camOut;
  fs.copyFileSync(camOut, path.join(dirOf(state.slug), 'campaign.cam'));
  return camOut;
}

// O MAPA ONDE A FORCA E CUNHADA numa campanha com caminho: o maior mapa do tier 1 que a comporta (deterministico).
function mintMap(onMap, R) {
  const cabe = mapPool([1], [], onMap).sort((a, b) => (b.capVermelho ?? 0) - (a.capVermelho ?? 0) || (a.f < b.f ? -1 : 1));
  const m = cabe[0] || mapCensus().filter((x) => loadsInGame(x, R)).sort((a, b) => (b.capVermelho ?? 0) - (a.capVermelho ?? 0))[0];
  if (!m) throw new Error('no map to raise the force on');
  return m;
}

// O INICIO DA CAMPANHA NO CAMINHO (E176): a batalha 1 escolhida na linha 1 e montada, e o .cam escrito. Guarda o ponto
// de volta (o undo da batalha 1 volta a escolha), como o Apply faz para as outras.
export async function startCampaign(slug, note = () => {}) {
  const state = loadState(slug);
  const R = rules();
  if (state.stage !== 'choose' || !state.path) throw new Error('this campaign has already started');
  if (!state.path.chosen) throw new Error('choose the first battle on the battle path');
  const trace = traceOf(slug, { battle: 1 });
  const segredo = loadPathSecret(slug);
  const no = secretNode(segredo, state.path.chosen);
  if (!no || no.row !== 1) throw new Error(`${state.path.chosen} is not a first battle`);
  const undoDir = path.join(battleDir(slug, 1), 'undo');
  fs.rmSync(battleDir(slug, 1), { recursive: true, force: true });
  fs.mkdirSync(undoDir, { recursive: true });
  fs.writeFileSync(path.join(undoDir, 'state.json'), JSON.stringify(state));
  if (state.coreFile) fs.copyFileSync(state.coreFile, path.join(undoDir, 'core-force.btt'));
  // MISSAO > QUARTERMASTER > INTEL > BATTLE (18/10, autor): a batalha so e gerada depois do Intel (`prepareBattle`).
  // Aqui a missao e aplicada: a rota anda e a batalha 1 fica descrita em `state.next`.
  state.path.at = no.id;
  state.path.route = [START_ID, no.id];
  state.path.chosen = null;
  refreshNode(state, segredo, no.id);
  state.current = null;
  state.next = { n: 1, kind: 'campaign', node: no.id, mapFile: no.map.f, preview: nextPreview(state, 1, no, no.map, R) };
  state.stage = 'brief';
  saveState(state);
  trace.event('campaign.started', { node: no.id, stage: 'brief' });
  return state;
}

// A BATALHA AINDA NAO GERADA (18/10): o que a aba Intel mostra antes da montagem — mapa, data, hora, clima, EW inimigo do
// no e a base do relogio (a mesma conta do `makeBattle`: tier, unidades da defesa e area do mapa).
function nextPreview(state, n, node, map, R = rules()) {
  const pub = node ? publicNodeOf(state, node.id) : null;
  return {
    n,
    map: map ? { file: map.f, name: String(map.f).replace(/ (Assault|Attack|Probe|Meet)\s*\.btt$/i, ''), kind: map.tipo === 'Meet' ? 'Meet' : null, width: map.W, height: map.H, area: map.area, profile: map.perfil, tier: map.tier } : null,
    time: node?.time || null,
    date: R.battle?.calendar?.on ? campaignCalendar(state.seed, R)[n] || null : null,
    weather: node?.weather || null,
    ew: { enemy: (R.ew?.on && node?.ew) || 'None', countered: !!pub?.revealed?.ewCountered },
    clockBase: node?.defense && map ? durationFor(tierOf(n, R), node.defense.units, map.area, R) : null,
  };
}

// GERAR A BATALHA (18/10): uma vez, depois do Intel, com tudo o que foi comprado para ela. A batalha 1 vai para o .cam;
// as seguintes, para uma copia do save que o jogo escreveu (refit, roster, atributos, injecao) — o que o Apply fazia.
export async function prepareBattle(slug, note = () => {}) {
  const state = loadState(slug);
  const R = rules();
  if (state.stage !== 'brief' || !state.next) throw new Error('there is no battle waiting to be prepared');
  if (!state.coreFile || !(state.units || []).some((u) => u.present)) throw new Error('raise your force in the Quartermaster first');
  const nx = state.next; const n = nx.n;
  const trace = traceOf(slug, { battle: n });
  const segredo = state.path ? loadPathSecret(slug) : null;
  // o kit-out da Special Forces vem antes (19/10): ou ele e jogado, ou o jogador o dispensa
  if (nx.kitOut === 'pending') throw new Error('kit out the special forces first (Battle tab), or skip it');
  if (ajustarEncontro(state, segredo, R, trace)) { savePathSecret(slug, segredo); refreshNode(state, segredo, nx.node); }
  const no = nx.node && segredo ? secretNode(segredo, nx.node) : null;
  if (nx.node && !no) throw new Error(`the battle ${nx.node} is not on this campaign's path`);
  const map = no ? no.map : [...mapCensus(), ...meetCensus()].find((m) => m.f === nx.mapFile);
  if (!map) throw new Error(`the map ${nx.mapFile} is no longer in the pool`);
  note.plan?.([...BUILD_STEPS, ...(nx.kind === 'campaign' ? ['Writing the campaign file'] : [DELIVER_STEPS.refit, ...((nx.refit?.recruited || []).length ? [DELIVER_STEPS.grow] : []), DELIVER_STEPS.roster, DELIVER_STEPS.inject]), 'Saving the campaign']);
  const built = await makeBattle(state, n, map, R, trace, { ...(no ? { node: no, intel: !!publicNodeOf(state, no.id)?.revealed?.paid?.full } : {}), note });
  if (no && built.mapSwapped) { no.map = built.map; no.defense = built.defense; savePathSecret(slug, segredo); refreshNode(state, segredo, no.id); }

  if (nx.kind === 'campaign') {
    await note('Writing the campaign file');
    await writeCampaignFile(state, built.file, R, trace);
    state.current = { ...built.current, playFrom: { kind: 'campaign', file: state.campaignFile, label: `CMBSDC ${slug}` } };
  } else {
    // depois de um kit-out a municao volta cheia mesmo num "push on": o que ele gastou no kit-out nao conta (19/10)
    const d = await deliverIntoSave(state, n, nx, built.file, { semRefit: !!built.current.noRefit && !nx.refit?.fullRefill, tag: `B${n}`, name: `B${String(n).padStart(2, '0')}`, R, trace, note });
    // `afterKitOut`: o undo desta batalha volta ao quartel-mestre do kit-out, nao ao da batalha anterior
    state.current = { ...built.current, playFrom: d.playFrom, refit: d.refit, ...(nx.kitOut === 'done' ? { afterKitOut: true } : {}) };
    // O que o app entregou fica marcado pelo conteudo, para nunca voltar como se fosse jogado.
    handSave(state, d.out);
  }
  await note('Saving the campaign');
  state.stage = 'play';
  delete state.next;
  saveState(state);
  fecharEntrega(slug);
  trace.event('battle.ready', { battle: n, playFrom: state.current.playFrom, map: state.current.map, duration: state.current.duration });
  return state;
}

// A ENTREGA NO SAVE QUE O JOGO ESCREVEU: o refit (homens pagos e feridos leves de volta, a arma da vaga, a municao da
// dotacao), as linhas de roster dos recrutados, os atributos da forca e a batalha no slot que o jogo vai abrir. A mesma
// para a batalha e para o kit-out (19/10). Devolve o arquivo e a ficha do refit (o ponto de partida de um rebuild, E40).
// O SAVE QUE SUMIU (29/10, bateria de interrupcoes). O app guarda o tamanho e o conteudo (sha1) de cada save que le
// (`state.saveIndex`); um save renomeado na pasta do jogo e achado de novo por eles. Apagado de verdade, a mensagem diz
// qual e o que fazer.
export function localizarSave(state, file) {
  if (fs.existsSync(file)) return file;
  const info = state.saveIndex?.[path.resolve(file).toLowerCase()];
  const dir = path.dirname(file);
  if (!info || !fs.existsSync(dir)) return null;
  for (const a of fs.readdirSync(dir)) {
    if (!/\.bts$/i.test(a)) continue;
    const f = path.join(dir, a);
    try { if (fs.statSync(f).size === info.bytes && saveFacts(f)?.sha1self === info.sha1) return f; } catch { /* outro arquivo */ }
  }
  return null;
}
// O ROSTER QUE O JOGO GRAVOU ALEM DO QUE ELE LE (08/11, US b11): linhas sumidas e linhas-lixo voltam do save que o app
// entregou antes (roster.restaurarLinhas), antes de qualquer outra escrita. Sem o save anterior, ou sem nada a fazer, devolve
// o proprio save.
// `fora`: as unidades que `enxugarEntrega` tirou desta batalha — a linha delas sai junto, e nenhuma e restaurada.
function restaurarRoster(state, savePath, anterior, novos, tag, trace, fora = new Set()) {
  const out = path.join(dirOf(state.slug), 'work', `restored-${tag}.bts`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = restoreRosterLines(savePath, out, state.coreFile, anterior && fs.existsSync(anterior) ? anterior : null, { novos, fora: [...fora] });
  if (!r.removidas.length && !r.restauradas.length && !r.trocadas.length && !r.tiradas.length) { fs.rmSync(out, { force: true }); return savePath; }
  trace.event('roster.restored', { removed: r.removidas, restored: r.restauradas, replaced: r.trocadas, trimmed: r.tiradas.length, from: anterior ? path.basename(anterior) : null, lines: r.linhas });
  return out;
}

// A BATALHA SO COM QUEM PODE ENTRAR (10/11/2026, bateria do limite da US). O CM Black Sea e um executavel de 32 bits e morre
// com ~4 GB de memoria virtual; unidade AUSENTE na batalha pesa (~2 MB cada, medido no setup: a b12 do autor com 409
// dormentes de tres batalhoes comprados inteiros carregava com 3.304 MB, sem elas 2.430). Aqui elas saem do arquivo da
// batalha (tools/re/remover.mjs) e a linha delas sai do roster (restaurarRoster com `fora`). Provado em jogo: a b12 enxuta
// carrega, joga, e a transicao que o jogo grava le inteira (ZZ B2 TRANSITION, 10/11).
// Sai so quem nao perde nada com isso: ausente nesta batalha E sem homem na linha (no save que o jogo gravou ou, se o jogo
// nao gravou a linha, no save entregue antes). Quem ja lutou tem os homens nomeados na linha e fica. As formacoes de topo e
// o HQ de formacao que fica nao saem (remover.mjs). A unidade continua da campanha (estado, forca core, loja): quando for
// paga, volta a batalha pelo gerador e ganha linha como recruta (`crescer`).
// O arquivo da batalha e reescrito no lugar: o que o app guarda dela (state.current.bttFile) e o que o jogo recebe.
function enxugarEntrega(state, bttFile, savePath, anterior, recruited, R, trace) {
  const linhas = (f) => { try { return new Map(readRoster(f).unidades.map((u) => [u.coreId, u.soldados.length])); } catch { return new Map(); } };
  const doSave = linhas(savePath);
  const doAnterior = anterior && fs.existsSync(anterior) ? linhas(anterior) : new Map();
  let fora = new Set();
  if (R.trimBattle?.on !== false) {
    const vazia = (id) => (doSave.has(id) ? doSave.get(id) === 0 : !(doAnterior.get(id) > 0));
    const alvo = coreUnitsOf(bttFile).filter((u) => !u.presente && vazia(u.coreId)).map((u) => u.coreId);
    if (alvo.length) {
      const tmp = bttFile + '.trim';
      const r = removeAbsentUnits(bttFile, tmp, alvo);
      fs.renameSync(tmp, bttFile);
      fora = new Set(r.tiradas);
      trace.event('battle.trimmed', { file: path.basename(bttFile), units: r.unidades, records: r.registros, cuts: r.cortes, kept: alvo.length - r.unidades, side: r.lado });
    }
  }
  // quem esta na batalha sem linha em save nenhum (uma dormente tirada antes e agora paga) ganha linha como recruta
  const ja = new Set(recruited.map((u) => u.coreId));
  const porId = new Map((state.units || []).map((u) => [u.coreId, u]));
  const voltam = coreUnitsOf(bttFile).map((u) => u.coreId)
    .filter((id) => !doSave.has(id) && !doAnterior.has(id) && !ja.has(id) && porId.has(id))
    .map((id) => ({ coreId: id, name: porId.get(id).name, type: porId.get(id).type }));
  if (voltam.length) trace.event('roster.returning', { units: voltam.map((u) => u.coreId) });
  return { fora, crescer: [...recruited.filter((u) => !fora.has(u.coreId)), ...voltam] };
}
const saveSumido = (file, n) => `the save battle ${n} ended in is gone from Saved Games: "${path.basename(String(file))}". Put it back — or a copy of it, under any name — and try again.`;
function lembrarSave(state, file, sha) {
  try { state.saveIndex = { ...(state.saveIndex || {}), [path.resolve(file).toLowerCase()]: { bytes: fs.statSync(file).size, sha1: sha || saveFacts(file)?.sha1self || null } }; } catch { /* sem o arquivo: nada a lembrar */ }
}
// AS ETAPAS DA ENTREGA (08/11): os rotulos que o checklist do job mostra, na ordem. `DELIVER_STEPS.grow` so com recruta.
export const DELIVER_STEPS = { refit: 'Refit: men, weapons, ammunition and equipment', grow: 'Adding the new units to the roster', roster: 'Roster: attributes and the lines the game reads', inject: 'Writing the battle into the save' };
async function deliverIntoSave(state, n, nx, bttFile, { semRefit = false, tag, name, R, trace, note = () => {} }) {
  const slug = state.slug;
  let savePath = nx.save; const rf = nx.refit || {};
  if (!savePath || !fs.existsSync(savePath)) {
    // RENOMEADO PELO JOGADOR (29/10): o mesmo arquivo com outro nome e achado pelo conteudo e adotado
    const achado = savePath ? localizarSave(state, savePath) : null;
    if (!achado) throw new Error(saveSumido(savePath, n - 1));
    trace.event('save.relocated', { from: savePath, to: achado });
    state.seenSaves = [...(state.seenSaves || []), achado];
    nx.save = achado; savePath = achado;
  }
  await note(DELIVER_STEPS.refit);
  const saveDir = path.dirname(savePath);
  const base = path.basename(savePath, '.bts');
  let out = path.join(saveDir, `${base} [${name}].bts`);
  for (let k = 2; fs.existsSync(out); k++) out = path.join(saveDir, `${base} [${name}-${k}].bts`);
  // THE REFIT: the men the player paid for come back, the lightly wounded come back for free, both
  // with the weapon their TO&E slot carries, and every magazine goes back to the issue.
  // "Push on": o relogio veio no lugar da municao, entao o app nao reabastece e o descanso vai a zero.
  const curados = writtenOffImmobilized(state, savePath);
  if (curados.length) trace.event('vehicle.writtenOffImmobilized', { battle: n - 1, coreIds: curados });
  const rebuilt = [...new Set([...(rf.rebuiltWrecks || []), ...curados])];
  const enx = enxugarEntrega(state, bttFile, savePath, nx.handedBefore || null, rf.recruited || [], R, trace);
  const restaurado = restaurarRoster(state, savePath, nx.handedBefore || null, enx.crescer.map((u) => u.coreId), tag, trace, enx.fora);
  let source = refitSave({ save: restaurado, workDir: path.join(dirOf(slug), 'work'), tag, indices: rf.indices || [], gear: rf.gear || [], keep: state.gear || null, kit: rf.kit || [], keepKit: state.kit || null, fielded: fieldedIds(state), names: new Map((state.units || []).map((u) => [u.coreId, u.name])), armies: unitArmies(state), formations: new Map((state.units || []).map((u) => [u.coreId, u.formation])), R, trace, table: baselineTable(state), refill: semRefit ? 0 : null, rebuilt });
  // The save carries the roster, and a core unit with no line in it crashes the game on load (FORMATO 112.8).
  // Os recrutados que ficaram fora desta batalha nao ganham linha; a dormente tirada antes e agora paga ganha (enxugarEntrega).
  const recruited = enx.crescer;
  if (recruited.length) {
    await note(DELIVER_STEPS.grow);
    const grownSave = path.join(dirOf(slug), 'work', `roster-${tag}.bts`);
    fs.mkdirSync(path.dirname(grownSave), { recursive: true });
    growSaveRoster({ save: source, out: grownSave, units: recruited, coreFile: state.coreFile, typeTable: typeTable(), trace });
    source = grownSave;
  }
  // The save's own copy of the soft factors, re-derived from the core force (FORMATO 112.12).
  note.skip?.(DELIVER_STEPS.grow);
  await note(DELIVER_STEPS.roster);
  {
    const synced = path.join(dirOf(slug), 'work', `roster-attrs-${tag}.bts`);
    fs.mkdirSync(path.dirname(synced), { recursive: true });
    syncRosterAttributes({ save: source, out: synced, coreFile: state.coreFile, presenceFile: bttFile, trace, visibleLines: visibleRosterLines(state, R) });
    source = synced;
  }
  const slotName = state.battleSlots[slotFor(state, n)];
  await note(DELIVER_STEPS.inject);
  abrirEntrega(slug, out);
  injectBattle({ save: source, battleName: slotName, btt: bttFile, out, percentages: campaignPercentages(R, semRefit ? { rest: 0 } : {}), trace });
  trace.event('save.handedFile', { battle: n, file: out });
  return {
    out,
    playFrom: { kind: 'save', file: out, label: path.basename(out, '.bts') },
    refit: {
      source: savePath,
      indices: rf.indices || [],
      recruited: recruited.map((u) => ({ coreId: u.coreId, name: u.name, type: u.type })),
      rebuilt,
      previous: nx.handedBefore || null,
      rosterLines: (() => { try { return readRoster(source).unidades.length; } catch { return undefined; } })(),
      ...(rf.fullRefill ? { fullRefill: true } : {}),
    },
  };
}

// ------------------------------------------------------------------ the kit-out battle (19/10)
//
// O KIT-OUT (autor, 19/10/2026): o jogo so nomeia os homens de uma unidade quando ela pisa num mapa, e so homem nomeado
// troca arma e item. A Special Forces recem-comprada ganha uma batalha de mentira antes da batalha escolhida: o menor
// mapa que a comporta, so ela em campo, um inimigo minimo (a Section (Supply) do exercito inimigo, porque o gerador nao
// escreve batalha sem defensor), 10 minutos. O jogador faz o deploy e da Cease Fire; o app le o save, a loja abre so
// para armas e itens, e o Apply devolve a campanha a batalha que estava esperando. Nada conta: sem credito, sem
// derrota, sem historico, sem mapa jogado, sem ponto operacional; tudo o que se perdeu nele volta de graca.
export const kitOutOn = (R = rules()) => R.formations?.kitOut?.on !== false;
// onde a campanha esta no kit-out: 'pending' (por montar), 'play' (montado), 'result' (lido) ou null
export function kitOutStage(state) {
  if (state.stage === 'play' && state.current?.kitOut) return 'play';
  if (state.stage === 'result' && state.pending?.result?.kitOut) return 'result';
  if (state.stage === 'brief' && state.next?.kitOut === 'pending') return 'pending';
  return null;
}
const KITOUT_FILLER = { US: 'US - Section (Supply)', UKR: 'UKR - Section (Supply)', RU: 'RU - Section (Supply)' };

// A Special Forces que vai ao kit-out: as unidades dela em campo, sem destroco.
function kitOutUnits(state) {
  const perdidas = new Set(state.lost || []);
  return (state.units || []).filter((u) => u.present && !perdidas.has(u.coreId) && isSpecialForcesUnit(state, u));
}

async function makeKitOut(state, n, R, trace) {
  const dir = kitDir(state.slug, n);
  fs.mkdirSync(dir, { recursive: true });
  const sf = kitOutUnits(state);
  if (!sf.length) throw new Error('there is no special forces unit in the field to kit out');
  const sfIds = new Set(sf.map((u) => u.coreId));
  const onMap = sf.filter((u) => !u.offMap).length;
  // o menor mapa que comporta a SF no setup (deterministico); fica fora de `playedMaps`
  const cabe = mapCensus().filter((m) => (m.capVermelho ?? 0) >= onMap && m.tipo !== 'Meet' && loadsInGame(m, R) && !(state.badMaps || []).includes(m.f))
    .sort((a, b) => (a.area ?? 0) - (b.area ?? 0) || (a.f < b.f ? -1 : 1));
  if (!cabe.length) throw new Error(`no map holds the ${onMap} special forces units in its setup zone`);
  const map = cabe[0];
  // so a SF em campo: a forca da batalha de sempre, com todo o resto desligado (continua no roster, 112.1)
  const core = coreForBattle(state, n, trace);
  const outros = battlePresence(state).on.filter((id) => !sfIds.has(id));
  const coreKit = path.join(dirOf(state.slug), 'work', `core-B${String(n).padStart(2, '0')}-kit.btt`);
  fs.mkdirSync(path.dirname(coreKit), { recursive: true });
  if (outros.length) activateUnits({ coreFile: core, out: coreKit, ids: outros, present: false, trace });
  else fs.copyFileSync(core, coreKit);
  const enemy = state.enemy;
  const filler = KITOUT_FILLER[enemy] || KITOUT_FILLER.RU;
  const defense = { formations: [{ formacao: path.join(paths().lib, filler + '.btt') }], nation: enemy, units: 1, cost: 0, kind: 'kitOut' };
  const duration = R.formations?.kitOut?.duration ?? 10;
  const out = path.join(dir, 'battle.btt');
  const nomeMapa = String(map.f).replace(/ (Assault|Attack|Probe|Meet)\s*\.btt$/i, '');
  const briefing = {
    vermelho: [
      `${state.name} - kit-out before battle ${n}.`,
      'This is not a battle. Nothing here counts: no credits, no defeat, no casualty and no round spent is kept.',
      `${sf.length} special forces unit${sf.length === 1 ? '' : 's'} on the map, to be named by the game.`,
      'Deploy, then open the menu and choose Cease Fire. If the enemy does not accept, let the clock run out.',
      '', '',
    ],
    azul: ['', '', '', '', '', ''],
  };
  const built = await buildBattle({
    coreFile: coreKit, defense, mapFile: mapFileOf(map), duration, attack: 'Attack', nation: state.nation, enemy, out, rules: R, trace,
    aiPlan: false, title: R.battle?.title ? `${state.name} - Kit-out before battle ${n}` : null, briefing: R.battle?.briefing ? briefing : null,
  });
  const enemyUnits = enemyDirectory(out);
  fs.writeFileSync(path.join(dir, 'spec.json'), JSON.stringify({ battle: n, kitOut: true, map, duration, defense, enemyUnits, specialForces: [...sfIds], spec: built.spec }, null, 1));
  trace.event('kitout.built', { battle: n, map: map.f, holds: map.capVermelho, units: sf.length, off: outros.length, enemy: filler, duration });
  return {
    file: out, map, defense,
    current: {
      n, kitOut: true,
      slot: slotFor(state, n), slotName: state.battleSlots[slotFor(state, n)],
      map: { file: map.f, name: nomeMapa, kind: null, width: map.W, height: map.H, area: map.area, profile: map.perfil, tier: map.tier },
      abilities: [], clock: null, intel: false, noRefit: false, intelStrength: 0, ew: { enemy: 'None', countered: false, own: 'None' }, time: null, date: null, weather: null,
      duration,
      defense: { kind: 'kitOut', nation: enemy, units: 1, cost: 0 },
      specialForces: [...sfIds],
      enemyUnits,
      bttFile: out,
      generatedAt: new Date().toISOString(),
    },
  };
}

// MONTAR O KIT-OUT: no .cam (batalha 1, os dois slots, como a batalha 1 de sempre) ou no save da ultima transicao, pela
// mesma entrega da batalha. A batalha que estava esperando (`state.next`) continua la, sem ser montada.
export async function prepareKitOut(slug, note = () => {}) {
  const state = loadState(slug);
  const R = rules();
  if (state.stage !== 'brief' || state.next?.kitOut !== 'pending') throw new Error('there is no kit-out waiting to be prepared');
  if (!state.coreFile) throw new Error('raise your force in the Quartermaster first');
  const nx = state.next; const n = nx.n;
  const trace = traceOf(slug, { battle: n, kitOut: true });
  note('Generating the kit-out');
  const built = await makeKitOut(state, n, R, trace);
  if (nx.kind === 'campaign') {
    note('Writing the campaign file');
    await writeCampaignFile(state, built.file, R, trace);
    state.current = { ...built.current, playFrom: { kind: 'campaign', file: state.campaignFile, label: `CMBSDC ${slug}` } };
  } else {
    const d = await deliverIntoSave(state, n, nx, built.file, { tag: `B${n}-kit`, name: `B${String(n).padStart(2, '0')} kit`, R, trace, note });
    state.current = { ...built.current, playFrom: d.playFrom, refit: d.refit };
    handSave(state, d.out);
  }
  state.stage = 'play';
  saveState(state);
  fecharEntrega(slug);
  trace.event('kitout.ready', { battle: n, playFrom: state.current.playFrom, map: state.current.map, slot: state.current.slotName });
  return state;
}

// DISPENSAR O KIT-OUT: a SF segue com o kit de fabrica ate a primeira batalha de verdade, como antes de 19/10.
export function skipKitOut(slug) {
  const state = loadState(slug);
  if (state.stage !== 'brief' || state.next?.kitOut !== 'pending') throw new Error('there is no kit-out waiting');
  delete state.next.kitOut;
  saveState(state);
  traceOf(slug, { battle: state.next.n }).event('kitout.skipped', { battle: state.next.n });
  return state;
}

// --------------------------------------------------------------------------- battles and maps

// The biggest setup zone that holds the whole harvest force, whatever the tier.
function harvestMap(onMap, trace) {
  const cabe = mapCensus().filter((m) => (m.capVermelho ?? 0) >= onMap && m.tipo !== 'Meet' && loadsInGame(m)).sort((a, b) => (a.capVermelho ?? 0) - (b.capVermelho ?? 0));
  if (!cabe.length) throw new Error(`no map holds ${onMap} units in its setup zone — split the harvest`);
  trace.event('map.picked', { battle: 1, harvest: true, map: cabe[0].f, onMap, holds: cabe[0].capVermelho });
  return cabe[0];
}

function pickMap(state, n, R, trace, { kind: tipo = null } = {}) {
  const real = n % 1000 || n;
  const tier = tierOf(real, R);
  const sizes = tier.mapTiers || [tier.tier];
  // o no do caminho diz se e um encontro (E176); o resto e a batalha comum (23/10: sem Probe/Attack/Assault)
  const kind = tipo === 'Meet' ? 'Meet' : null;
  // Everything of yours that sets foot on the map has to have a tile to stand on in the setup zone.
  const onMap = (state.units || []).filter((u) => u.present && !u.offMap).length;
  const skip = [...state.playedMaps, ...(state.badMaps || [])];
  // In order: this kind, unplayed and big enough; this kind, any big enough; then the same two
  // without the kind; then, only if the force fits nowhere, unplayed at all — said out loud.
  // um no de encontro (13/10) sorteia entre os mapas de encontro elegiveis; sem nenhum, cai nos degraus de sempre (o
  // no vira o tipo do mapa sorteado e planForNode replaneja a defesa)
  const encontros = kind === 'Meet' ? [
    { pool: meetPool(sizes, skip, onMap, R, real), why: null },
    { pool: meetPool(sizes, [], onMap, R, real), why: 'every meeting engagement map already played' },
  ] : [];
  const ladder = [
    ...encontros,
    { pool: mapPool(sizes, skip, onMap, kind), why: kind === 'Meet' ? 'no meeting engagement map fits the force' : null },
    { pool: mapPool(sizes, [], onMap, kind), why: 'every map of this kind already played' },
    { pool: mapPool(sizes, skip, onMap), why: 'no map of this kind fits the force' },
    { pool: mapPool(sizes, [], onMap), why: 'no map of this kind, and every map of the tier already played' },
    { pool: mapPool(sizes, skip), why: 'the force fits nowhere in the tier' },
  ].filter((s) => s.pool.length);
  const step = ladder[0];
  if (!step) throw new Error(`no usable map for tier ${tier.tier}`);
  if (step.why) trace.event('map.fallback', { battle: real, tier: tier.tier, kind, onMap, why: step.why });
  const pick = step.pool[Math.floor(rng(state.seed + n * 104729)() * step.pool.length)];
  const tight = !mapPool(sizes, [], onMap).length;
  if (tight) trace.event('map.tooBigForEveryMap', { battle: real, tier: tier.tier, onMap, best: Math.max(...mapPool(sizes, []).map((m) => m.capVermelho ?? 0)) });
  trace.event('map.picked', { battle: real, tier: tier.tier, kind: pick.tipo, wanted: kind, map: pick.f, area: pick.area, profile: pick.perfil, poolSize: step.pool.length, onMap, holds: pick.capVermelho });
  return pick;
}

// WHO TAKES THE FIELD, and who only keeps a line in the roster. Pure, so the test can read it
// without building a campaign.
//
// WHAT THE STATE SAYS IS FIELDED IS THE LAST WORD (E56). `purchased` is every core id ever bought,
// and a bought machine can since have been destroyed and replaced (`wrecked`) or stood down: the
// two BTR-4E autor lost in battle 2 were coming back to the field in battle 3, next to the spare he
// paid for, because the force switched on the whole purchase list.
//
// AND THE WRECK WAITING FOR A REPLACEMENT STAYS HOME (E61). `state.lost` is the machine the player
// marked destroyed or knocked out and has not paid to replace — his T-64BV #1 burned in battle 2,
// cost more than he had, and the app kept writing it into every battle as present, refilling its
// ammunition each turn. It stays in the force (the quartermaster sells the replacement, and that
// check needs it there) and it stays in the roster, which the game requires (112.1); what it does
// not do is take the field.
export function battlePresence(state) {
  const presentNow = new Set((state.units || []).filter((u) => u.present).map((u) => u.coreId));
  const perdidas = new Set(state.lost || []);
  const on = [...new Set((state.purchased || []).filter((id) => presentNow.has(id) && !perdidas.has(id)))];
  const off = [...new Set([
    ...(state.standDown || []),
    // So o destroco reposto pelo jeito antigo (um gemeo acordado, `replacedBy`) fica fora para sempre.
    // O reconstruido na vaga (`rebuilt`, 28/09) e a propria maquina voltando.
    ...(state.wrecked || []).filter((w) => w.replacedBy != null).map((w) => w.coreId),
    ...(state.repaired || []).map((r) => r.coreId),
    ...(state.purchased || []).filter((id) => !presentNow.has(id)),
    ...perdidas,
    // O vendido (28/09) continua no arquivo e no roster, que o jogo exige (112.1): so nunca mais pisa.
    ...(state.sold || []).map((s) => s.coreId),
  ])];
  return { on, off };
}

// QUEM JA LUTOU (28/09, para a venda). Toda batalha lida deixa `battles/NN/result.json`: a
// progressao lista cada unidade que estava na forca naquela batalha (`progression.gains`, fora de
// mapa incluida), e `units[].instantiated` diz quem ja tem homens no save — o jogo so os cria na
// primeira batalha que a unidade joga (E83). A uniao das duas, em todas as batalhas lidas, e quem
// lutou. `record` nao serve: a promocao o zera.
export function foughtIds(state) {
  const out = new Set();
  const dir = path.join(dirOf(state.slug), 'battles');
  let pastas = [];
  try { pastas = fs.readdirSync(dir); } catch { return out; }
  // so as batalhas numeradas: o kit-out (`NN-kit`) nao e luta
  for (const p of pastas.filter((x) => /^[0-9]+$/.test(x))) {
    let r;
    try { r = JSON.parse(fs.readFileSync(path.join(dir, p, 'result.json'), 'utf8')); } catch { continue; }
    for (const g of r.progression?.gains || []) if (g.coreId !== undefined) out.add(g.coreId);
    for (const u of r.units || []) if (u.instantiated > 0) out.add(u.coreId);
  }
  return out;
}

// VENDER UMA UNIDADE (28/09, regra do autor): "Se a unidade/formacao ja lutou uma batalha, sem
// reembolso." Quem nunca lutou devolve o que custa (`u.price`, o preco no nivel em que foi comprada).
// So se vende o que e do jogador — em campo ou tirado de campo —, nunca o dormente do arsenal (que
// nao foi comprado) nem o destroco (que ja esta fora de campo e tem o caminho dele, a reposicao).
// Puro: `fought` e o conjunto de `foughtIds`.
// A FORMACAO INTEIRA (autor, 16/10/2026) — SUBSTITUI a regra de 28/09 ("quem lutou sai sem reembolso"): so a venda da
// COMPRA INTEIRA devolve credito, e devolve o preco de todas as unidades dela, lutando ou nao. "A compra inteira" sao as
// unidades do jogador daquele pick (a chave da unidade comeca pelo indice do pick): em campo ou tiradas de campo, nao
// vendidas, nao destruidas; o dormente do arsenal e o destroco nao contam. Venda parcial (uma esquadra, um veiculo,
// parte da formacao) continua possivel, sem reembolso. `fought` fica no registro (historico), sem pesar no preco.
export const pickOf = (u) => Number(String(u.key).split('.')[0]);
export function ownedOfPick(state, i) {
  const vendidos = new Set((state.sold || []).map((s) => s.coreId));
  const fora = new Set(state.standDown || []);
  const perdidas = new Set(state.lost || []);
  return (state.units || []).filter((u) => pickOf(u) === i && !vendidos.has(u.coreId) && !perdidas.has(u.coreId) && (u.present || fora.has(u.coreId)));
}
// O PICK SEM NENHUMA UNIDADE DO JOGADOR SOBRANDO depois da venda desta batalha foi vendido inteiro: ganha `sold = n`,
// o que libera a vaga de Availability e, nas forcas especiais, a vaga delas (16/10: antes so as SF eram marcadas, e a
// formacao comum vendida nao liberava a copia). So o pick tocado por esta venda. Chamada depois de `state.sold` e
// `state.standDown` atualizados.
export function markSoldPicks(state, vendidosAgora, n) {
  const vendidos = new Set((state.sold || []).map((s) => s.coreId));
  const fora = new Set(state.standDown || []);
  const agora = new Set(vendidosAgora);
  (state.picks || []).forEach((p, i) => {
    if (p.sold) return;
    const deles = (state.units || []).filter((u) => pickOf(u) === i);
    // o destroco nao conta (29/10): ele fica `present` esperando reposicao e nao se vende, e travava a vaga para sempre
    const perdidas = new Set(state.lost || []);
    const aindaDele = deles.filter((u) => !vendidos.has(u.coreId) && !perdidas.has(u.coreId) && (u.present || fora.has(u.coreId)));
    if (deles.length && !aindaDele.length && deles.some((u) => agora.has(u.coreId))) p.sold = n;
  });
}
// O QUE FOI PAGO (autor, 29/10, bateria da economia: "nunca se ganha vendendo"). `u.paid` e o que saiu da bolsa por
// aquela unidade: na compra do pick, a parte dela no preco cobrado (a Special Forces reparte o preco fixo da campanha,
// 0 ou 600); no arsenal, o preco no nivel escolhido. A promocao, a leadership e a tabela de precos que muda depois nao
// mexem nele. Sem o campo (estado sintetico), o preco.
export const pagoDe = (u) => (Number.isFinite(u?.paid) ? u.paid : (u?.price || 0));
// Reparte `total` entre as unidades na proporcao do preco de cada uma, em inteiros que somam exatamente `total`
// (maiores restos): o arredondamento por unidade nao cria nem some credito (E5: +8 cr por ciclo no Mountain Infantry).
export function distribuirPago(unidades, total) {
  const n = unidades.length; if (!n) return [];
  const t = Math.max(0, Math.round(Number(total) || 0));
  const pesos = unidades.map((u) => Math.max(0, Number(u.price) || 0)); const soma = pesos.reduce((a, b) => a + b, 0);
  const exato = pesos.map((w) => (soma ? (t * w) / soma : t / n));
  const v = exato.map(Math.floor); let falta = t - v.reduce((a, b) => a + b, 0);
  const ordem = exato.map((x, k) => [x - v[k], k]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let j = 0; falta > 0; j = (j + 1) % n, falta--) v[ordem[j][1]]++;
  return v;
}
// A forca lida do arquivo com preco e `paid`: quem ja estava no estado e e de um pick anterior a `desde` guarda os
// dele; o resto e precificado pelo exercito (E59) e os picks a partir de `desde` repartem o preco que custaram entre as
// unidades compradas (`present`). A dormente do arsenal nasce com `paid` 0.
export function precificarForca(state, lista, R = rules(), { desde = 0 } = {}) {
  const antes = new Map((state.units || []).map((u) => [u.coreId, u]));
  const out = lista.map((u) => {
    const a = antes.get(u.coreId);
    if (a && pickOf(u) < desde) return { ...u, price: a.price, paid: a.paid ?? 0 };
    return { ...u, price: priceUnit(u, u.nation || state.nation, R), paid: 0 };
  });
  (state.picks || []).forEach((p, i) => {
    if (i < desde) return;
    const deles = out.filter((u) => pickOf(u) === i && u.present);
    distribuirPago(deles, p.price).forEach((v, k) => { deles[k].paid = v; });
  });
  return out;
}
// A campanha anterior ao `paid`: o preco de cada pick repartido entre as unidades que vieram com ele (as compradas na
// criacao ou na recruta: em campo, tiradas de campo, vendidas ou destruidas, menos as do arsenal), e a do arsenal pelo
// preco dela. O `price` atual pode ter subido com a tabela e com a recruta; o do pick e o que foi cobrado.
function migrarPago(state) {
  const arsenal = new Set(state.purchased || []);
  const vendidos = new Set((state.sold || []).map((s) => s.coreId));
  const fora = new Set(state.standDown || []); const perdidas = new Set(state.lost || []);
  const veio = (u) => !arsenal.has(u.coreId) && (u.present || fora.has(u.coreId) || vendidos.has(u.coreId) || perdidas.has(u.coreId));
  for (const u of state.units) u.paid = arsenal.has(u.coreId) ? Math.round(u.price || 0) : 0;
  (state.picks || []).forEach((p, i) => {
    const deles = state.units.filter((u) => pickOf(u) === i && veio(u));
    const total = Number.isFinite(p.price) ? p.price : deles.reduce((a, u) => a + (u.price || 0), 0);
    distribuirPago(deles, total).forEach((v, k) => { deles[k].paid = v; });
  });
}
// Uma linha do livro-razao a cada vez que os creditos mudam (criacao, raise, kit-out, Apply).
function lancar(state, e) {
  if (!Array.isArray(state.ledger)) return;
  state.ledger.push({ battle: e.battle, kind: e.kind, step: e.step || 0, cover: e.cover || 0, bonus: e.bonus || 0, refund: e.refund || 0, spend: e.spend || 0 });
}
// OS EXERCITOS DA CAMPANHA (29/10, bateria da economia): a pagina so oferece a biblioteca dos exercitos escolhidos, mas a
// API aceitava qualquer arquivo com qualquer `nation` (uma secao americana entrava "ucraniana" numa campanha so
// ucraniana, cotada pela tabela da outra nacao). O exercito de um pick e o prefixo do arquivo ("US - ..."); `nation`,
// quando vem, tem de ser esse, e ele tem de estar entre os da campanha.
export function checkArmies(picks, armies) {
  const lista = (armies || []).filter(Boolean);
  for (const p of picks || []) {
    const doArquivo = String(p.source || '').split(' - ')[0];
    if (p.nation && p.nation !== doArquivo) throw new Error(`${p.source} is a ${doArquivo} formation, not ${p.nation}`);
    if (lista.length && !lista.includes(doArquivo)) throw new Error(`${p.source}: ${doArquivo} is not one of this campaign's armies (${lista.join(', ')})`);
  }
}
export function sellPlan(state, coreIds, fought) {
  const vendidos = new Set((state.sold || []).map((s) => s.coreId));
  const fora = new Set(state.standDown || []);
  const perdidas = new Set(state.lost || []);
  const pedidos = [];
  for (const id of [...new Set((coreIds || []).map(Number))]) {
    const u = (state.units || []).find((x) => x.coreId === id);
    if (!u) throw new Error(`there is no unit with core id ${id} in this campaign`);
    if (vendidos.has(id)) throw new Error(`${u.name} was already sold`);
    if (perdidas.has(id)) throw new Error(`${u.name} is destroyed — a wreck is not sold, it is replaced in Vehicles and guns or left where it is`);
    if (!u.present && !fora.has(id)) throw new Error(`${u.name} is not yours to sell: it is still dormant in the arsenal`);
    pedidos.push(u);
  }
  const ids = new Set(pedidos.map((u) => u.coreId));
  const inteiras = [...new Set(pedidos.map(pickOf))].filter((i) => { const deles = ownedOfPick(state, i); return deles.length && deles.every((u) => ids.has(u.coreId)); });
  const units = pedidos.map((u) => {
    const inteira = inteiras.includes(pickOf(u));
    return { coreId: u.coreId, name: u.name, fought: fought.has(u.coreId), refund: inteira ? Math.round(pagoDe(u)) : 0, whole: inteira ? pickOf(u) : null };
  });
  return { units, refund: units.reduce((a, x) => a + x.refund, 0), wholePicks: inteiras };
}

// E o que recebe reposicao de homem e municao: quem esta em campo de verdade. Um destroco nao se
// reabastece — o app escrevia 1.250 tiros de 125mm no tanque queimado do autor a cada virada.
export function fieldedIds(state) {
  const perdidas = new Set(state.lost || []);
  return new Set((state.units || []).filter((u) => u.present && !perdidas.has(u.coreId)).map((u) => u.coreId));
}

// The force this battle fights with: the original core plus everything bought since. Rebuilt from
// the original every time, so the same purchases always produce the same file.
function coreForBattle(state, n, trace) {
  const { on: entram, off: saem } = battlePresence(state);
  if (!entram.length && !saem.length) return state.coreFile;
  const out = path.join(dirOf(state.slug), 'work', `core-B${String(n).padStart(2, '0')}.btt`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (!saem.length) { activateUnits({ coreFile: state.coreFile, out, ids: entram, trace }); return out; }
  // O QUE SAI DA FORCA sai por ultimo, para que dar baixa em algo comprado hoje seja a palavra
  // final. A unidade nao some do arquivo — some do CAMPO: continua com linha no roster, que e o que
  // o jogo exige (112.1), e volta ligando a presenca de novo.
  const meio = path.join(dirOf(state.slug), 'work', `core-B${String(n).padStart(2, '0')}-entra.btt`);
  if (entram.length) activateUnits({ coreFile: state.coreFile, out: meio, ids: entram, trace });
  else fs.copyFileSync(state.coreFile, meio);
  activateUnits({ coreFile: meio, out, ids: saem, present: false, trace });
  return out;
}

// TIRAR UMA FORMACAO DE CAMPO — e por ela de volta.
//
// Nao ha venda: o que foi comprado esta comprado, e o que a unidade aprendeu continua com ela. O
// que muda e se ela vai para a proxima batalha. Serve para o batalhao que perdeu os veiculos e so
// atrapalha, para o esquadrao que o jogador quer poupar, e para quem quer uma forca menor num mapa
// apertado — o teto de unidades no mapa e real e a tela ja avisa quando ele aperta.
export function standDown(slug, coreIds, out = true) {
  const state = loadState(slug);
  const ids = [...new Set((Array.isArray(coreIds) ? coreIds : [coreIds]).map(Number))];
  const nomes = [];
  const fora = new Set(state.standDown || []);
  // Only what is in the field goes out, and only what went out comes back (05/10/2026, QA r2 A5): a dormant unit of the
  // arsenal, never bought, was "stood down" and then sold for its full price.
  for (const id of ids) {
    const u = state.units?.find((x) => x.coreId === id);
    if (!u) throw new Error(`there is no unit with core id ${id} in this campaign`);
    if (out && !u.present && !fora.has(id)) throw new Error(`${u.name} is not in the field: it is dormant in the arsenal, and is bought there`);
    if (!out && !fora.has(id)) throw new Error(`${u.name} was not stood down, so there is nothing to bring back`);
    // O KIT-OUT ESPERANDO (29/10, bateria de interrupcoes): a SF fora de campo nao monta o kit-out (pendente) ou nao e
    // nomeada nele (montado), e o kit-out se perdia. Primeiro o kit-out: jogar ou dispensar.
    if (out && isSpecialForcesUnit(state, u) && (state.next?.kitOut === 'pending' || state.current?.kitOut)) {
      throw new Error(`${u.name} is special forces with a kit-out waiting — play the kit-out (or skip it) before standing them down`);
    }
    nomes.push(u.name);
  }
  for (const id of ids) { if (out) fora.add(id); else fora.delete(id); }
  state.standDown = [...fora].sort((a, b) => a - b);
  for (const u of state.units || []) if (ids.includes(u.coreId)) u.present = !out;
  saveState(state);
  traceOf(slug, { battle: state.current?.n }).event('force.standDown', {
    out, units: ids.length, names: nomes.slice(0, 6), totalOut: state.standDown.length,
  });
  return state;
}

// ------------------------------------------------------------- desfazer o que ainda nao foi feito
//
// O QUARTEL-MESTRE E UM RASCUNHO ate o Apply, com uma excecao: marcar uma maquina e tirar uma
// unidade de campo gravam no estado na hora, porque o chart tem de responder no mesmo clique. Entao
// um Reset honesto tem de desfazer essas duas coisas — e SO essas duas, e so as feitas depois que o
// resultado desta batalha chegou. O retrato e tirado uma vez, quando o save e lido; nada anterior a
// ele entra na conta, que e exatamente o cuidado que o autor pediu.
const retratoDaLoja = (state) => ({
  vehicles: { ...(state.vehicles || {}) },
  standDown: [...(state.standDown || [])],
  // A presenca e guardada como ela esta, e nao deduzida de `standDown` na volta: uma unidade
  // dormente no arsenal tambem tem `present: false` e nao pode ser acordada por um Reset.
  present: (state.units || []).filter((u) => u.present).map((u) => u.coreId),
  at: new Date().toISOString(),
});

// Garante que existe um ponto de partida. Um resultado lido por uma versao anterior do app nao tem
// retrato; o primeiro que for tirado vale a partir dali, e o Reset diz isso em vez de mentir.
export function openShop(slug) {
  const state = loadState(slug);
  if (state.stage !== 'result') throw new Error('there is no result waiting to be spent');
  if (!state.shopSnapshot) {
    state.shopSnapshot = retratoDaLoja(state);
    saveState(state);
    traceOf(slug, { battle: state.pending?.result?.battle }).event('shop.snapshot', { late: true, marks: Object.keys(state.shopSnapshot.vehicles).length, outOfForce: state.shopSnapshot.standDown.length });
  }
  return state;
}

export function resetShop(slug) {
  const state = loadState(slug);
  if (state.stage !== 'result') throw new Error('there is no result waiting to be spent');
  const snap = state.shopSnapshot;
  if (!snap) throw new Error('this result was read before the app started keeping a starting point, so there is nothing to go back to');

  const antesMarcadas = { ...(state.vehicles || {}) };
  const antesFora = [...(state.standDown || [])];
  const retiradas = Object.keys(antesMarcadas)
    .filter((id) => antesMarcadas[id] !== snap.vehicles[id])
    .map(Number);

  state.vehicles = { ...snap.vehicles };
  // `lost` e `survived` sao derivadas de `vehicles`, aqui pela mesma conta de `markVehicle`.
  state.lost = Object.entries(state.vehicles).filter(([, s]) => s === 'destroyed' || s === 'knocked_out').map(([id]) => Number(id)).sort((a, b) => a - b);
  state.survived = Object.entries(state.vehicles).filter(([, s]) => s === 'survived' || s === 'immobilized').map(([id]) => Number(id)).sort((a, b) => a - b);
  state.standDown = [...snap.standDown];
  const emCampo = new Set(snap.present || []);
  for (const u of state.units || []) u.present = emCampo.has(u.coreId);
  saveState(state);

  // O gabarito de engenharia reversa nao pode ficar com uma marca que o jogador retirou: a linha
  // antiga continua no arquivo (e historico), e esta diz que ela foi retratada.
  if (retiradas.length) retratarVeiculos(state, retiradas, antesMarcadas);

  traceOf(slug, { battle: state.pending?.result?.battle }).event('shop.reset', {
    since: snap.at,
    marksUndone: retiradas.length,
    backInForce: antesFora.filter((id) => !snap.standDown.includes(id)),
    takenOutAgain: snap.standDown.filter((id) => !antesFora.includes(id)),
  });
  return state;
}

function retratarVeiculos(state, coreIds, antes) {
  try {
    const arquivo = path.join(RESEARCH_DIR, 'veiculos_rotulados.jsonl');
    if (!fs.existsSync(arquivo)) return;
    fs.appendFileSync(arquivo, JSON.stringify({
      retratado: true,
      campanha: state.slug,
      batalha: state.pending?.result?.battle ?? state.battleNumber,
      save: state.pending?.savePath ? path.basename(state.pending.savePath) : null,
      coreIds,
      eram: Object.fromEntries(coreIds.map((id) => [id, antes[id] ?? null])),
    }) + '\n');
  } catch { /* retratar nunca pode atrapalhar a campanha */ }
}

// A CATEGORIA DO RELATORIO, PELO CASCO (07/11): o AAR do jogo conta tanques, blindados e outros veiculos; o HMMWV com M2 ou
// com ATGM e "outro", nao blindado. Usada pela leitura do AAR e pelo briefing (08/11).
export const hullCategory = (u) => (u?.role === 'tank' ? 'tanques' : u?.role === 'truck' || /HMMWV/i.test(u?.name || '') ? 'outrosVeiculos' : 'blindados');

// O QUE A EW FAZ, numa linha (08/11, autor: "adicionar as variaveis climaticas e de EW no briefing")
const EW_INIMIGA = 'expect jammed radio links, slower artillery and air support, and degraded drones';
const EW_PROPRIA = 'degrades the enemy radio links and support';

// nomes agrupados: "2 x Main Battle Tank (M1A2 SEP Abrams (APS)); Stinger Team" (sem o "#n" da vaga)
function nomesAgrupados(lista) {
  const n = new Map();
  for (const nome of lista) { const k = String(nome || '').replace(/\s*#\d+\s*$/, '').trim(); if (k) n.set(k, (n.get(k) || 0) + 1); }
  return [...n].map(([k, q]) => (q > 1 ? `${q} x ${k}` : k)).join('; ');
}

// AS CONDICOES DA BATALHA (08/11): o clima por inteiro e o que cada coisa muda, uma linha por condicao que pesa. A 6a secao
// do briefing (Notes). Sem clima nem hora (campanha antiga), vazia.
export function battleConditions({ time = null, weather = null, R = rules() } = {}) {
  if (!weather && !time) return '';
  const N = R.battle?.weather?.names || {};
  const nome = (lista, i) => (Number.isInteger(i) && N[lista]?.[i] != null ? String(N[lista][i]) : null);
  const linhas = [];
  if (weather) {
    const vento = nome('wind', weather.wind);
    const de = weather.wind > 0 ? nome('windSource', weather.windSource) : null;
    // o ceu, nao o nome do perfil (o perfil 'Morning mist' tambem cai de noite)
    linhas.push([`Weather: ${nome('weather', weather.weather) || weather.name || weather.label}.`,
      vento ? `Wind: ${vento.toLowerCase()}${de ? ` from the ${de}` : ''}.` : null,
      nome('temp', weather.temp) ? `Temperature: ${nome('temp', weather.temp).toLowerCase()}.` : null,
      nome('ground', weather.ground) ? `Ground: ${nome('ground', weather.ground).toLowerCase()}.` : null].filter(Boolean).join(' '));
  }
  const efeitos = [];
  const luz = String(time?.daylight || '').toLowerCase();
  const hh = time ? `H-hour ${String(time.hour).padStart(2, '0')}:00` : '';
  if (luz === 'night') efeitos.push(`Light: night, ${hh}. Spotting is short: night and thermal sights decide the first contact.`);
  else if (luz === 'dawn') efeitos.push(`Light: dawn, ${hh}. Low light at first; spotting improves as the battle goes on.`);
  else if (luz === 'dusk') efeitos.push(`Light: dusk, ${hh}. Spotting worsens as the light goes.`);
  if (weather) {
    const c = weather.weather;
    // 08/11: a aviacao NAO depende da neblina (campanha nova com Heavy Fog mostrou as 12 aeronaves); o aviso que esteve aqui
    // saiu. O sumico do apoio aereo nos saves da US e outra coisa (em investigacao).
    if (c === 11 || c === 12) efeitos.push('Dense fog: contacts at close range; long-range fire is of little use.');
    else if ([7, 8, 9, 10].includes(c)) efeitos.push('Mist or fog: visibility is reduced; long-range spotting and fire suffer.');
    else if ([4, 5, 6].includes(c)) efeitos.push('Rain: visibility is reduced.');
    else if (c === 1 || c === 2) efeitos.push('Haze: long-range spotting is reduced.');
    if (weather.ground === 3 || weather.ground === 4) efeitos.push(`${weather.ground === 4 ? 'Muddy' : 'Wet'} ground: vehicles off the roads may bog down; keep heavy vehicles on firm ground.`);
    if (weather.wind === 0) efeitos.push('No wind: smoke lingers.');
    else if (weather.wind >= 3) efeitos.push('Strong wind: smoke screens drift and clear quickly.');
    if ([0, 1, 4, 5].includes(weather.temp)) efeitos.push(`${weather.temp <= 1 ? 'Heat' : 'Cold'}: infantry tires faster.`);
  }
  if (!efeitos.length && weather) efeitos.push('Clear day: no effect on spotting or movement.');
  return [...linhas, ...efeitos].join('\n');
}

// O BRIEFING QUE A CAMPANHA ESCREVE (28/09). O mapa trazia a historia dele — um major sovietico,
// um Kampfgruppe alemao —, e o jogador lia na tela uma guerra que nao era a dele. Seis secoes do
// lado vermelho (o jogador), so com o que ele sabe: a campanha, a missao pelo tipo de batalha, a
// forca que ele leva e, do inimigo, so o que a inteligencia comprada diz. Plan fica vazia (secao vazia nao aparece);
// Notes traz as condicoes desde 08/11 (battleConditions). O azul, que so a IA "le", fica vazio. Puro.
export function briefingFor({ state, n, map, duration, clock = null, defense = null, intel = false, intelStrength = 0, ew = null, time = null, date = null, weather = null, R = rules() }) {
  // latin1 so: nada de travessao (U+2014), que o jogo mostraria como "?"
  const nomeMapa = String(map.f || '').replace(/ (Assault|Attack|Probe|Meet)\s*\.btt$/i, '').replace(/\s*\(.*$/, '');
  const total = R.battlesToWin;
  const ult = (state.history || [])[state.history.length - 1];
  const situacao = [
    `${state.name} - battle ${n}${total ? ` of ${total}` : ''}.`,
    ult ? `Last battle, ${String(ult.map || 'the last map').replace(/\s*\(.*$/, '')}: ${ult.level}.` : 'This is the first battle of the campaign.',
    semLimiteDeDerrotas(state) ? 'No number of defeats ends this campaign.' : `Defeats you can still afford: ${state.defeatsLeft}.`,
  ].join('\n');
  const kind = map.tipo === 'Meet' ? 'Meet' : null;
  // 23/10: uma ordem so para a batalha comum (as tres versoes do mapa eram o mesmo mapa); o encontro tem a dele
  const ordem = kind === 'Meet'
    ? 'Meeting engagement. The enemy is advancing on the same objectives: take them first and hold them.'
    : 'Attack the enemy position: take the objectives and hold them.';
  const extra = clock && clock.extra ? ` (${clock.extra} of them bought)` : '';
  const missao = [ordem, `Map: ${nomeMapa}${map.W && map.H ? `, ${map.W} x ${map.H} m` : ''}.`, `Time: ${duration} minutes${extra}.`, time ? `H-hour: ${String(time.hour).padStart(2, '0')}:00 (${String(time.name || time.period).toLowerCase()})${date ? `, ${date.label}` : ''}.` : date ? `Date: ${date.label}.` : null, weather ? 'Weather and light: see Notes.' : null].filter(Boolean).join('\n');
  const vendidas = new Set((state.sold || []).map((x) => x.coreId));
  const emCampo = (state.units || []).filter((u) => u.present && !vendidas.has(u.coreId));
  const naoVendidas = (state.picks || []).filter((p) => !p.sold);
  const nomes = naoVendidas.map((p) => p.sf ? `${p.sfName || p.source.replace(/\.btt$/i, '')} (special forces)` : p.source.replace(/\.btt$/i, '').replace(/^(US|RU|UKR) - /, ''));
  const fora = emCampo.filter((u) => u.offMap).length;
  // A FORCA EM NUMEROS (08/11, autor): veiculos pelo casco, como o AAR conta; a experiencia; o que entra pela primeira vez;
  // o que foi reconstruido depois da ultima batalha; o apoio fora do mapa; a EW propria sempre.
  const noMapa = emCampo.filter((u) => !u.offMap);
  const maquinas = noMapa.filter((u) => isMachine(u, R));
  const porCasco = { tanques: 0, blindados: 0, outrosVeiculos: 0 };
  for (const u of maquinas) porCasco[hullCategory(u)]++;
  const pe = noMapa.length - maquinas.length;
  const xp = {};
  for (const u of emCampo) if (u.experience) xp[u.experience] = (xp[u.experience] || 0) + 1;
  const ordemXp = ['Elite', 'Crack', 'Veteran', 'Regular', 'Green', 'Conscript'];
  const posXp = (k) => { const i = ordemXp.indexOf(k); return i < 0 ? 99 : i; };
  const lutaram = new Set(state.fought || []);
  const novos = n > 1 && state.fought ? emCampo.filter((u) => !lutaram.has(u.coreId)).map((u) => u.name) : [];
  const refeitos = (state.wrecked || []).filter((w) => w.battle === n - 1 && w.rebuilt).map((w) => w.name);
  const apoio = emCampo.filter((u) => u.offMap && u.name).map((u) => `${String(u.name).replace(/\s*#\d+\s*$/, '')}${u.experience ? `, ${String(u.experience).toLowerCase()}` : ''}`);
  const cascos = [[porCasco.tanques, 'tank', 'tanks'], [porCasco.blindados, 'armoured', 'armoured'], [porCasco.outrosVeiculos, 'other', 'other']]
    .filter(([q]) => q).map(([q, um, varios]) => `${q} ${q === 1 ? um : varios}`).join(', ');
  const amigos = [
    `On the map: ${pe} infantry and team unit${pe === 1 ? '' : 's'}${maquinas.length ? `, ${maquinas.length} vehicle${maquinas.length === 1 ? '' : 's'} (${cascos})` : ''}.`,
    fora ? `Off the map: ${fora}.` : null,
    Object.keys(xp).length ? `Experience: ${Object.entries(xp).sort((a, b) => posXp(a[0]) - posXp(b[0])).map(([k, q]) => `${q} ${k.toLowerCase()}`).join(', ')}.` : null,
    novos.length ? `New for this battle: ${nomesAgrupados(novos)}.` : null,
    refeitos.length ? `Rebuilt after the last battle: ${nomesAgrupados(refeitos)}.` : null,
    apoio.length ? `Support: ${apoio.join('; ')}.` : null,
    ew ? (ew.own && ew.own !== 'None' ? `Your electronic warfare: ${ew.own}, ${EW_PROPRIA}.` : 'Your electronic warfare: none.') : null,
    nomes.length ? `From: ${nomes.join('; ')}.` : null,
  ].filter(Boolean).join('\n');
  let inimigos = kind === 'Meet' ? 'No intelligence on the enemy. Expect an armoured force on the move, with mounted infantry.' : 'No intelligence on the enemy. Expect a prepared defense on the objectives.';
  if (intel && defense) {
    const mix = defense.mix || {};
    const pct = (k, rotulo) => (mix[k] ? `${rotulo} ${Math.round(mix[k] * 100)}%` : null);
    const partes = (kind === 'Meet'
      ? [pct('tanks', 'tanks'), pct('mech', 'mechanized infantry'), pct('light', 'light armour'), pct('recon', 'recon'), pct('teams', 'teams'), pct('aa', 'air defense'), pct('support', 'off-map support')]
      : [pct('squads', 'squads'), pct('scouts', 'scouts'), pct('teams', 'weapons teams'), pct('carriers', 'carriers'), pct('tanks', 'tanks'), pct('offMap', 'off-map support')]).filter(Boolean);
    inimigos = [
      `Intelligence report: about ${defense.units} enemy units${defense.nations?.length ? ` (${defense.nations.join(" + ")})` : defense.nation ? ` (${defense.nation})` : ''}, ${String(defense.experience || 'unknown').toLowerCase()}.`,
      partes.length ? `Spending: ${partes.join(', ')}.` : null,
      mix.tanks ? null : 'No tanks reported.',
      // o tanque da escada (18/10) num nivel diferente do resto
      defense.tankLadder && defense.tankLadder.experience !== defense.experience ? `Tank crews: ${String(defense.tankLadder.experience).toLowerCase()}.` : null,
    ].filter(Boolean).join('\n');
  }
  if (intelStrength > 0) inimigos += `\nForward reconnaissance has marked enemy contacts on your map at setup (intel strength ${intelStrength} %).`;
  // a EW inimiga sempre (08/11): "nada" tambem e informacao
  if (ew) inimigos += !ew.enemy || ew.enemy === 'None' ? '\nEnemy electronic warfare: none detected.' : ew.countered ? `\nEnemy electronic warfare: ${ew.enemy}, countered before the battle.` : `\nEnemy electronic warfare: ${ew.enemy}: ${EW_INIMIGA}.`;
  // Notes = as condicoes (08/11); Plan fica para o jogador
  return { vermelho: [situacao, missao, amigos, inimigos, '', battleConditions({ time, weather, R })], azul: ['', '', '', '', '', ''] };
}

// A DEFESA DE UM NO DO CAMINHO num mapa que nao e o dele (o mapa do no nao coube a forca do dia): o mesmo plano que o
// gerador faria, com a semente e o peso do no, no mapa novo.
function planForNode(state, node, map, R, { floor = 0 } = {}) {
  const args = { nation: state.enemy, nations: enemyArmies(state), battleNumber: node.row, rules: R, seed: node.seed, profile: map.perfil, kind: map.tipo || node.kind, ...(floor ? { floor } : {}) };
  const planner = (map.tipo || node.kind) === 'Meet' ? planMeetForce : planDefense;
  if ((map.tipo || node.kind) === 'Meet') args.garantias = authoredPlan(mapFileOf(map))?.garantias || null;
  const effort = enemyEffortFor(state, (map.tipo || node.kind) === 'Meet' ? 'Meet' : null, R);
  return planner({ ...args, effort: effort * (node.budget ?? 1) });
}

// O VALOR DA FORCA DO JOGADOR EM CAMPO (25/10): os precos das unidades presentes, nao destruidas e nao vendidas. O piso do
// encontro (rules.meet.playerFloor) e a parte "forca preservada" do placar.
export function playerForceValue(state) {
  const perdidos = new Set(state.lost || []); const vendidos = new Set((state.sold || []).map((x) => x.coreId));
  const vivas = (state.units || []).filter((u) => u.present && !perdidos.has(u.coreId) && !vendidos.has(u.coreId));
  return { units: vivas.length, value: vivas.reduce((a, u) => a + (u.price || 0), 0) };
}

// O ENCONTRO ACOMPANHA A FORCA (autor, 25/10): o no de encontro foi planejado na criacao do caminho, cego para a forca.
// Com a forca da batalha fechada (Intel / preparo), ele e replanejado com o piso do jogador — a mesma semente e o mesmo
// mapa. Um inimigo ja pago na Intel nao muda (o que foi visto vale). Devolve true se mudou o segredo.
function ajustarEncontro(state, segredo, R, trace) {
  const id = state.next?.node; if (!id || !segredo || !R.meet?.playerFloor?.on) return false;
  const no = secretNode(segredo, id); if (!no || (no.map?.tipo || no.kind) !== 'Meet' || !no.defense) return false;
  if (publicNodeOf(state, id)?.revealed?.paid?.full) return false;
  const { value } = playerForceValue(state);
  if ((no.defense.meetBudget?.player ?? -1) === value) return false;
  const antes = { budget: no.defense.budget, units: no.defense.units };
  no.defense = planForNode(state, no, no.map, R, { floor: value });
  trace.event('meet.playerFloor', { battle: state.next.n, node: id, player: value, scale: no.defense.meetBudget?.scale, budget: no.defense.budget, before: antes, units: no.defense.units });
  return true;
}

// `node` (E176): o no do caminho que esta batalha joga — a defesa vem pronta dele (sorteada na criacao, a mesma que
// o jogador pode ter revelado), e `intel` diz se ele pagou a composicao inteira.
// THE APP'S FACE IN THE GAME (17/10/2026, proven in game piece by piece). Everything is optional and never fails a battle:
// a missing file or a drawing error is logged and the battle goes out without that picture.
//   header: the scenario list and saved-game screen (a save keeps its battle's header): the title, three lines of
//           description (the lists show three) and the 170x170 logo.
//   images: the briefing's top row (the 224x224 logo and, to its right, the campaign's battle tree drawn here) and the
//           Tactical Map, pre-drawn per map file by tools/re/tatico.mjs into assets/map_images/<id>.tatico.png.
const asciiOnly = (s) => String(s ?? '').normalize('NFKD').replace(/[^ -~]/g, '');
// (29/10) o arquivo vazio e o mesmo que ausente
function readArt(name) { const f = path.join(paths().artBriefing, name); if (!fs.existsSync(f)) return null; const b = fs.readFileSync(f); return b.length ? b : null; }
// A IMAGEM QUE NAO E INTEGRA NAO VAI (29/10, autor: "imagens cosmeticas corrompidas ou ausentes nao podem comprometer o
// app nem o jogo"): conferida aqui, ela fica de fora com o motivo no log, e a batalha sai sem ela.
function imagemIntegra(nome, b, tamanho, trace, evento = 'battle.imageSkipped') {
  if (!b) return null;
  const motivo = bmpIntegro(b, tamanho);
  if (motivo) { trace.event(evento, { image: nome, reason: motivo }); return null; }
  return b;
}

export function battlePictures({ state, n, map, defense, intel, node, R, trace }) {
  const out = {};
  const mapName = asciiOnly(String(map.f || '').replace(/\s*(Assault|Attack|Probe|Meet)\s*\.btt$/i, '')).replace(/\s+/g, ' ').trim();
  if (R.battle?.header) {
    try {
      const logo = readArt('logo170.bmp');
      const total = R.battlesToWin || 12;
      const inimigo = intel && defense ? `Enemy: ${asciiOnly(defense.nation || state.enemy)}, about ${defense.units} units` : 'Enemy: strength unknown';
      const descricao = [`CMBS ROGUELIKE - Battle ${n} of ${total} (Tier ${tierOf(n, R).tier})`, `${map.tipo === 'Meet' ? 'Meeting Engagement on ' : ''}${mapName}`, inimigo].join('\n');
      out.header = { descricao, bmp: imagemIntegra('logo170', logo, [170, 170], trace, 'battle.headerSkipped') };
    } catch (e) { trace.event('battle.headerSkipped', { reason: e.message.slice(0, 160) }); }
  }
  if (R.battle?.images) {
    const images = {};
    try { images.estrategico = imagemIntegra('logo', readArt('logo224.bmp'), [224, 224], trace); } catch (e) { trace.event('battle.imageSkipped', { image: 'logo', reason: e.message.slice(0, 160) }); }
    try {
      const d = paths().artBriefing; const fontes = { f11: atlas(d, 'fonte_11'), f13: atlas(d, 'fonte_13'), f18: atlas(d, 'fonte_18') };
      const atual = node?.id || (state.path?.chosen ?? null);
      images.operacional = imagemIntegra('tree', arvoreDoCaminho({ path: state.path, nome: asciiOnly(state.name), n, atual, total: R.battlesToWin || 12, rules: R, fontes }).bmp(), [702, 224], trace);
    } catch (e) { trace.event('battle.imageSkipped', { image: 'tree', reason: e.message.slice(0, 160) }); }
    try {
      const f = path.join(APP_IMAGES, imageId(map.f) + '.tatico.png');
      if (fs.existsSync(f)) images.tatico = imagemIntegra('tactical', pngParaBmp(fs.readFileSync(f)), [952, 350], trace);
      else trace.event('battle.imageSkipped', { image: 'tactical', reason: `no ${path.basename(f)}: run tools/re/tatico.mjs` });
    } catch (e) { trace.event('battle.imageSkipped', { image: 'tactical', reason: e.message.slice(0, 160) }); }
    out.images = images;
  }
  return out;
}
// the campaign list (17/10): the .cam is cloned from a template that said "City" with a photo of it
export function campaignHeader(state, camOut, R, trace) {
  if (!R.battle?.header) return;
  try {
    const exercitos = (state.armies || [state.nation]).map(asciiOnly).join('+');
    const inimigo = (state.enemyArmies || [state.enemy]).map(asciiOnly).join('+');
    const descricao = ['CMBS ROGUELIKE - a dynamic campaign', `${exercitos} against ${inimigo}`, `${R.battlesToWin || 12} battles in ${(R.tiers || []).length} tiers`].join('\n');
    const h = writeHeader(camOut, { titulo: asciiOnly(state.name).slice(0, 64) || 'CMBS Roguelike', descricao, bmp: readArt('logo170.bmp') || undefined });
    trace.event('campaign.header', { title: h.titulo, image: h.imagem });
  } catch (e) { trace.event('campaign.headerSkipped', { reason: e.message.slice(0, 160) }); }
}

// AS ETAPAS DA BATALHA (08/11): o checklist do job. A composicao e o plano da IA rodam dentro de `forge.buildBattle`, em
// `trace.step`s; um trace que marca a etapa antes de cada um leva o rotulo ate la sem mudar o forge.
export const BUILD_STEPS = ['Choosing the enemy force', 'Writing the battle file', "Placing the enemy and checking the battle"];
const PASSO_DO_TRACE = { 'battle.generate': BUILD_STEPS[1], 'battle.aiPlan': BUILD_STEPS[2] };
async function makeBattle(state, n, map, R, trace0, { node = null, intel = null, note = () => {} } = {}) {
  const trace = Object.create(trace0);
  trace.step = async (nome, campos, fn) => { if (PASSO_DO_TRACE[nome]) await note(PASSO_DO_TRACE[nome]); return trace0.step(nome, campos, fn); };
  await note(BUILD_STEPS[0]);
  const dir = battleDir(state.slug, n);
  fs.mkdirSync(dir, { recursive: true });
  // a dificuldade escala so o Attack (01/11)
  const effort = enemyEffortFor(state, map.tipo === 'Meet' ? 'Meet' : null, R);
  // O QUE O JOGADOR COMPROU PARA ESTA BATALHA (plano 2). A interdicao e um fator no orcamento da
  // defesa — o mesmo lugar por onde o multiplicador de dificuldade passa — e o relogio entra
  // abaixo, depois de `durationFor` dizer a base.
  const ab = abilitiesFor(state, n, R);
  const budgetFactor = node ? 1 : 1 + (ab.effect.defenseBudget || 0);
  // num mapa de encontro o inimigo e a forca de ataque do encontro (app/src/meet.mjs), nao uma defesa
  const planner = map.tipo === 'Meet' ? planMeetForce : planDefense;
  const garantias = map.tipo === 'Meet' ? authoredPlan(mapFileOf(map))?.garantias || null : null;
  let defense = node?.defense ? JSON.parse(JSON.stringify(node.defense)) : planner({ garantias, nation: state.enemy, nations: enemyArmies(state), battleNumber: n, rules: R, seed: state.seed, profile: map.perfil, effort: effort * budgetFactor, kind: map.tipo === 'Meet' ? 'Meet' : null, trace });
  if (node?.defense) trace.event('path.nodeBuilt', { battle: n, node: node.id, kind: node.kind, band: node.band, rewardMult: node.rewardMult, map: map.f, units: defense.units, cost: defense.cost });
  let mapSwapped = null;
  // O RELOGIO: a base do tier e o que foi comprado, no degrau que o editor oferece.
  let relogio = withExtraMinutes(durationFor(tierOf(n, R), defense.units, map.area, R), ab.effect.minutes, R);
  let duration = relogio.final;
  const out = path.join(dir, 'battle.btt');
  const comInteligencia = intel ?? !!ab.effect.intel;
  // A GUERRA ELETRONICA (17/10): a do inimigo vem do no (sorteada no caminho; o counter pago no caminho a anula), a
  // propria das compras da aba Intel. Campanha sem caminho: nenhuma do inimigo.
  const guerra = {
    enemy: (R.ew?.on && node?.ew) || 'None',
    countered: !!(node && publicNodeOf(state, node.id)?.revealed?.ewCountered),
    own: ab.effect.ewLevel || 'None',
  };
  // A DATA E A HORA (17/10): o dia do calendario da campanha (por batalha N) e a hora do no — ou a da troca de luz comprada
  // na aba Intel para esta batalha.
  const data = R.battle?.calendar?.on ? campaignCalendar(state.seed, R)[n] || null : null;
  const hora = timeOfBattle(state, n, node);
  const clima = weatherOfBattle(state, n, node, hora, R);

  // A map that does not survive the transplant is refused by `buildBattle`. The census already
  // knows the five that fail, but the check is the authority — if one slips through (a map the
  // census has not seen, or the player's own copies), take another map instead of getting stuck.
  let built = null;
  for (let attempt = 1; attempt <= 4 && !built; attempt++) {
    try {
      // The force has to fit in its own setup zone. When it does not, the generator's positioner
      // throws, `gerar_batalha` catches it and leaves the units where they stood on the library
      // map — outside the deployment zone, which is what the author saw. Refused here as a bad map so
      // another one is drawn, because from that point on the battle is unplayable.
      const onMap = (state.units || []).filter((u) => u.present && !u.offMap).length;
      if (onMap && (map.capVermelho ?? 0) < onMap) {
        const e = new Error(`${map.f} only has room for ${map.capVermelho ?? 0} units in your setup zone and the force fields ${onMap}`);
        e.badMap = true;
        throw e;
      }
      // O ENCONTRO (13/10): a variante do plano de ataque sorteada pela semente do no e a copia do mapa so com ela
      const mi = map.tipo === 'Meet' ? meetBuildInputs({ mapFile: mapFileOf(map), seed: node?.seed ?? state.seed, battleNumber: n, rules: R, workDir: path.join(dir, 'work') }) : null;
      if (mi) trace.event('battle.meet', { battle: n, map: map.f, variant: mi.meet.variant, plan: mi.meet.plan, key: mi.meet.key });
      built = await buildBattle({
        coreFile: coreForBattle(state, n, trace), defense, mapFile: mi?.mapFile ?? mapFileOf(map), duration, attack: map.tipo || 'Attack', meet: mi?.meet ?? null,
        // Quem defende esta batalha e quem o plano sorteou; sem plano com nacao (campanha antiga)
        // continua sendo a nacao do lado inimigo.
        nation: state.nation, enemy: defense.nation || state.enemy, out, rules: R, trace,
        // o briefing diz de que campanha e que batalha e; desligado ate a prova em jogo
        title: R.battle?.title ? `${state.name} - Battle ${n}: ${String(map.f).replace(/\s*\(.*$/, '')}` : null,
        briefing: R.battle?.briefing ? briefingFor({ state, n, map, duration, clock: relogio, defense, intel: comInteligencia, intelStrength: ab.effect.intelStrength || 0, ew: guerra, time: hora, date: data, weather: clima, R }) : null,
        ...battlePictures({ state, n, map, defense, intel: comInteligencia, node, R, trace }),
        earlyIntel: { lado: ab.effect.intelStrength ? 'Red' : 'Neither', forca: ab.effect.intelStrength || 0 },
        ew: { azul: guerra.countered ? 'None' : guerra.enemy, vermelho: guerra.own },
        time: hora, date: data, weather: clima,
      });
    } catch (e) {
      if (!e.badMap || attempt === 4) throw e;
      state.badMaps = [...new Set([...(state.badMaps || []), map.f])];
      state.playedMaps = state.playedMaps.filter((m) => m !== (map.familia || map.f));
      trace.event('map.rejected', { battle: n, map: map.f, reason: e.message.slice(0, 160), attempt });
      const antes = map.f;
      map = pickMap(state, n + attempt * 1000, R, trace, node ? { kind: node.kind } : {});
      // o no troca de campo de batalha: a defesa dele e replanejada no mapa novo, com a mesma semente e o mesmo peso
      if (node?.defense) {
        defense = planForNode(state, node, map, R);
        relogio = withExtraMinutes(durationFor(tierOf(n, R), defense.units, map.area, R), ab.effect.minutes, R);
        duration = relogio.final;
        mapSwapped = { from: antes, to: map.f };
        trace.event('path.mapSwapped', { battle: n, node: node.id, from: antes, to: map.f, units: defense.units });
      }
    }
  }
  // As habilidades passam de "compradas" para "usadas nesta batalha" — e so na primeira montagem,
  // para que refazer a batalha use as mesmas sem cobrar nem perder nada.
  if (ab.ids.length && ab.fresh) {
    state.abilities = state.abilities || { pending: [], applied: [] };
    state.abilities.applied = [...state.abilities.applied, ...ab.ids.map((id) => ({ id, battle: n }))];
    state.abilities.pending = (state.abilities.pending || []).filter((p) => !ab.ids.includes(p.id) || false);
    state.abilities.pending = [];
  }
  if (ab.ids.length) {
    trace.event('ability.apply', {
      battle: n, ids: ab.ids, duration: relogio, budgetFactor,
      intel: ab.effect.intel, noRefit: ab.effect.noRefit, defenseCost: defense.cost,
    });
  }
  const enemyUnits = enemyDirectory(out);
  fs.writeFileSync(path.join(dir, 'spec.json'), JSON.stringify({ battle: n, map, duration, defense, enemyUnits, spec: built.spec, aiPlan: built.aiPlan }, null, 1));
  trace.event('battle.enemy', { battle: n, units: enemyUnits.length, offMap: enemyUnits.filter((u) => u.offMap).length });
  if (!state.playedMaps.includes(map.familia || map.f)) state.playedMaps.push(map.familia || map.f);
  return {
    file: out,
    map, defense, mapSwapped,
    current: {
      n,
      slot: slotFor(state, n),
      slotName: state.battleSlots[slotFor(state, n)],
      map: { file: map.f, name: map.f.replace(/ (Assault|Attack|Probe|Meet)\s*\.btt$/i, ''), kind: map.tipo === 'Meet' ? 'Meet' : null, width: map.W, height: map.H, area: map.area, profile: map.perfil, tier: map.tier },
      abilities: ab.ids, clock: relogio, intel: comInteligencia, noRefit: ab.effect.noRefit, intelStrength: ab.effect.intelStrength || 0, ew: guerra, time: hora, date: data, weather: clima,
      ...(built.aiPlan?.meet ? { meet: { variant: built.aiPlan.meet.variant, plan: built.aiPlan.meet.plan } } : {}),
      ...(node ? { node: node.id, rewardMult: node.rewardMult ?? 1 } : {}),
      duration,
      defense: { kind: defense.kind || null, freeCost: defense.meet?.garantido?.price || 0, backbone: defense.backbone, nation: defense.nation, nations: defense.nations, units: defense.units, cost: defense.cost, budget: defense.budget, experience: defense.experience, mix: defense.mix, effort: defense.effort, baseBudget: defense.baseBudget },
      enemyUnits,
      bttFile: out,
      generatedAt: new Date().toISOString(),
    },
  };
}

// ------------------------------------------------------------------------- the battle path (E176)
//
// O caminho tem duas metades: `path.json`, com os nos inteiros (mapa e defesa de cada um), que a API nunca serve, e
// `state.path`, so com o `publicView` de cada no. Toda mudanca de um no publico passa por `refreshNode`, que volta ao
// segredo: e a unica porta.
export const pathFile = (slug) => path.join(dirOf(slug), 'path.json');
export function loadPathSecret(slug) {
  return mapaUnico(JSON.parse(fs.readFileSync(pathFile(slug), 'utf8')));
}

// UM MAPA SO (23/10, autor): o app ficou so com a versao Attack de cada mapa de QB — as tres eram o mesmo mapa. Um estado
// ou um caminho de antes guarda arquivos Probe e Assault (o mapa da batalha, o dos nos, os mapas recusados) e o tipo de
// cada no: na leitura, o arquivo vira o Attack do mesmo mapa e o tipo deixa de existir (so o encontro, 'Meet', fica).
// Idempotente; vai para o disco no proximo save. As batalhas ja montadas nao mudam, e a defesa ja sorteada de um no fica
// como estava.
const SUFIXO_ANTIGO = / (Probe|Assault)( CMBSRL)?\.btt$/;
// o arquivo Attack do mesmo mapa vem do censo, pelo nome normalizado: o do jogo nem sempre e o nome trocado (o Plehany-Open
// 099 Attack tem um espaco antes do .btt)
let attackPorChave = null;
const attackDoMapa = (f) => {
  if (!attackPorChave) { attackPorChave = new Map(); try { for (const m of mapCensus()) attackPorChave.set(mapKey(m.f), m.f); } catch { /* sem censo: so a troca */ } }
  return attackPorChave.get(mapKey(f)) || f.replace(SUFIXO_ANTIGO, ' Attack$2.btt');
};
export function mapaUnico(x) {
  if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) x[i] = mapaUnico(x[i]); return x; }
  if (typeof x === 'string') return SUFIXO_ANTIGO.test(x) ? attackDoMapa(x) : x;
  if (!x || typeof x !== 'object') return x;
  for (const k of Object.keys(x)) {
    const v = x[k];
    if (k === 'tipo' && (v === 'Probe' || v === 'Assault')) x[k] = 'Attack';
    else if (k === 'kind' && (v === 'Probe' || v === 'Assault' || v === 'Attack')) x[k] = null;
    else x[k] = mapaUnico(v);
  }
  return x;
}
function savePathSecret(slug, secret) {
  const f = pathFile(slug);
  fs.writeFileSync(f + '.tmp', JSON.stringify(secret));
  fs.renameSync(f + '.tmp', f);
}
const secretNode = (secret, id) => secret.nodes.find((x) => x.id === id) || null;
const publicNodeOf = (state, id) => (state.path?.nodes || []).find((x) => x.id === id) || null;
function refreshNode(state, secret, id) {
  const i = state.path.nodes.findIndex((x) => x.id === id);
  if (i < 0) return;
  const played = state.path.route.includes(id);
  state.path.nodes[i] = publicView(secretNode(secret, id), state.path.nodes[i].revealed, { played });
}
// O no de cada batalha e a posicao dela na rota: `route[0]` e o Start, a batalha n jogou `route[n]`.
export const nodeOfBattle = (state, n) => state.path?.route?.[n] ?? null;
const childrenOfAt = (state) => publicNodeOf(state, state.path.at)?.edges || [];

// O COUNTER DA GUERRA ELETRONICA INIMIGA (17/10, autor): no caminho, so nos filhos do no atual e antes de montar a
// batalha; anula o EW do no e custa o nivel dele. Como as revelacoes, fica: nem o undo devolve.
export function priceCounterEW(state, node, R = rules()) {
  if (!R.ew?.on) throw new Error('electronic warfare is not in play');
  if (!childrenOfAt(state).includes(node)) throw new Error('only the battles that follow the current one can be prepared');
  const pub = publicNodeOf(state, node);
  const nivel = pub?.ew || 'None';
  if (nivel === 'None') throw new Error('there is no enemy electronic warfare to counter in that battle');
  if (pub.ewCountered) throw new Error('the enemy electronic warfare of that battle is already countered');
  const cost = R.ew.counter?.[nivel] ?? 0;
  if ((state.ops || 0) < cost) throw new Error(`that takes ${cost} operational point${cost === 1 ? '' : 's'} and you have ${state.ops || 0}`);
  return { level: nivel, cost };
}

export function counterEW(slug, { node } = {}) {
  const state = loadState(slug);
  const R = rules();
  if (!state.path) throw new Error('this campaign was raised before the battle path — there is nothing to counter');
  if (state.stage === 'over') throw new Error('the campaign is over');
  const p = priceCounterEW(state, node, R);
  const secret = loadPathSecret(slug);
  state.ops -= p.cost;
  const pub = publicNodeOf(state, node);
  pub.revealed = { ...pub.revealed, ewCountered: true };
  refreshNode(state, secret, node);
  saveState(state);
  traceOf(slug, { battle: state.battleNumber }).event('path.counterEW', { node, level: p.level, cost: p.cost, opsLeft: state.ops });
  return state;
}

// REVELAR: so os filhos do no atual (autor, 11/10), com pontos operacionais. Nao volta atras: nem o undo devolve
// (os pontos e o que foi visto ficam). O log diz o que foi revelado, nunca o que havia la.
export function revealNode(slug, { node, what } = {}) {
  const state = loadState(slug);
  const R = rules();
  if (!state.path) throw new Error('this campaign was raised before the battle path — it has nothing to reveal');
  if (state.stage === 'over') throw new Error('the campaign is over');
  // 24/10 (autor): o mapa se revela no caminho, nos filhos do no atual; o inimigo inteiro so na Intel, pela batalha que
  // espera ser montada (`next.node`, ja na rota). Ela aparece inteira na tela por estar na rota, entao conta o que foi PAGO.
  const emPreparo = what === 'full' && state.stage === 'brief' && !!state.next?.node && node === state.next.node;
  if (what === 'full' && !emPreparo) throw new Error('the whole enemy is revealed in Intel, for the battle being prepared');
  if (!emPreparo && !childrenOfAt(state).includes(node)) throw new Error('only the battles that follow the current one can be scouted');
  const pub = publicNodeOf(state, node);
  const cost = revealCost(what, emPreparo ? (pub.revealed.paid || {}) : pub.revealed, R);
  if (!cost) throw new Error('that is already known');
  if ((state.ops || 0) < cost) throw new Error(`that takes ${cost} operational point${cost === 1 ? '' : 's'} and you have ${state.ops || 0}`);
  const secret = loadPathSecret(slug);
  // o encontro que vai ser visto e o que vai lutar: o piso do jogador entra antes de revelar (25/10)
  if (emPreparo && ajustarEncontro(state, secret, R, traceOf(slug, { battle: state.battleNumber }))) savePathSecret(slug, secret);
  state.ops -= cost;
  const comprado = { [what]: true, ...(what === 'full' ? { formations: true } : {}) };
  // o que foi PAGO anda junto (18/10): e so isso que o briefing conta como inteligencia
  pub.revealed = { ...pub.revealed, ...comprado, paid: { ...(pub.revealed.paid || {}), ...comprado } };
  refreshNode(state, secret, node);
  saveState(state);
  traceOf(slug, { battle: state.battleNumber }).event('path.reveal', { node, what, cost, opsLeft: state.ops });
  return state;
}

// UMA CAMPANHA DE ANTES DO CAMINHO GANHA UM (so por pedido: a fixture da QA, ou o autor). As batalhas ja montadas viram
// a rota: um no por linha, seguindo a primeira aresta, com o mapa e a defesa que a batalha teve de verdade
// (battles/NN/spec.json); dali para a frente o caminho e sorteado como numa campanha nova.
export function attachPath(slug, { opPoints } = {}) {
  const state = loadState(slug);
  const R = rules();
  if (state.path) throw new Error('this campaign already has a battle path');
  if (state.stage === 'over') throw new Error('the campaign is over');
  const secret = generatePath({ seed: state.seed, rules: R, enemy: { nation: state.enemy, nations: enemyArmies(state), effort: enemyEffortFor(state, null, R) }, fits: fitsOf(state, R) });
  const route = [START_ID];
  for (let n = 1; n <= state.battleNumber; n++) {
    route.push(secret.nodes.find((x) => x.id === route[n - 1]).edges[0]);
    const no = secret.nodes.find((x) => x.id === route[n]);
    const sp = path.join(battleDir(slug, n), 'spec.json');
    if (fs.existsSync(sp)) {
      const j = JSON.parse(fs.readFileSync(sp, 'utf8'));
      Object.assign(no, { map: j.map, defense: j.defense, kind: j.map?.tipo || no.kind, rewardMult: 1, band: 'normal', budget: 1 });
    }
  }
  savePathSecret(slug, secret);
  const pontos = pontosValidos(opPoints, R);
  state.path = { ...publicPath(secret, { startingPoints: pontos }), route, at: route[route.length - 1] };
  state.path.nodes = secret.nodes.map((n) => publicView(n, {}, { played: route.includes(n.id) }));
  state.ops = pontos;
  if (state.current) { state.current.node = state.path.at; state.current.rewardMult = 1; }
  saveState(state);
  traceOf(slug).event('path.attached', { route, ops: pontos });
  return state;
}

// REFAZER AS DEFESAS DOS NOS POR JOGAR (11/10): a composicao de cada no e sorteada na criacao; quando a regra da defesa
// muda (o morteiro organico que entrava disfarcado de BMP-3M, as liberacoes do tier 1), os nos ainda nao jogados sao
// replanejados com a mesma semente, o mesmo mapa e o mesmo peso. Um no ja revelado nao muda (o que foi visto vale);
// `force` muda mesmo assim. Copia o segredo antigo para path.json.<data>.bak.
export function replanPath(slug, { force = false } = {}) {
  const state = loadState(slug);
  if (!state.path) throw new Error('this campaign has no battle path');
  const R = rules();
  const segredo = loadPathSecret(slug);
  fs.copyFileSync(pathFile(slug), `${pathFile(slug)}.${new Date().toISOString().slice(0, 10)}.bak`);
  const jogados = new Set(state.path.route);
  const feitos = [], mantidos = [];
  for (const no of segredo.nodes) {
    if (no.row < 1 || jogados.has(no.id) || !no.map) continue;
    const pub = publicNodeOf(state, no.id);
    const visto = pub?.revealed && (pub.revealed.formations || pub.revealed.full);
    if (visto && !force) { mantidos.push(no.id); continue; }
    no.defense = planForNode(state, no, no.map, R);
    refreshNode(state, segredo, no.id);
    feitos.push(no.id);
  }
  savePathSecret(slug, segredo);
  saveState(state);
  traceOf(slug).event('path.replanned', { nodes: feitos.length, kept: mantidos });
  return { replanned: feitos, kept: mantidos };
}

// ESCOLHER a proxima batalha: um filho do no atual, depois de lida a batalha e antes do Apply. Troca livre ate o Apply.
// A IMAGEM DO MAPA (E178): so de um no cujo mapa foi revelado com pontos (ou que ja foi jogado), ou da batalha montada.
// O nome do mapa nao sai daqui: a pagina pede pelo no. Lida da biblioteca do pacote (assets/map_images); um mapa que
// nao esta nela (selecao nova) e desenhado na hora e guardado.
export function mapImage(slug, which, layer = 'terrain') {
  const state = loadState(slug);
  let entrada = null;
  if (which === 'current') {
    if (!state.current?.map?.file) throw new Error('there is no battle built');
    const f = state.current.map.file;
    entrada = [...mapCensus(), ...meetCensus()].find((m) => m.f === f) || null;
  } else {
    if (!state.path) throw new Error('this campaign has no battle path');
    const pub = publicNodeOf(state, which);
    if (!pub) throw new Error(`there is no battle ${which} on the path`);
    if (!pub.revealed?.map && !state.path.route.includes(which)) throw new Error('that battlefield has not been scouted');
    entrada = secretNode(loadPathSecret(slug), which)?.map || null;
  }
  if (!entrada) throw new Error('no picture of that map');
  // O MAPA TATICO (14/11, o carrossel da aba Outcome): a mesma imagem 952x350 do briefing (tools/re/tatico.mjs), pre-desenhada
  // por mapa da selecao; um mapa sem ela (os descartados) cai no terreno.
  if (layer === 'tactical') {
    const tatico = path.join(APP_IMAGES, imageId(entrada.f) + '.tatico.png');
    let ok = false; try { ok = fs.existsSync(tatico) && !!lerPng(fs.readFileSync(tatico)); } catch { ok = false; }
    if (ok) return fs.readFileSync(tatico);
    layer = 'terrain';
  }
  const arquivo = path.join(APP_IMAGES, imageId(entrada.f) + (layer === 'zones' ? '.zonas.png' : '.png'));
  // (29/10) o PNG em cache ilegivel e redesenhado, como o ausente (antes era servido quebrado para sempre)
  let ok = false; try { ok = fs.existsSync(arquivo) && !!lerPng(fs.readFileSync(arquivo)); } catch { ok = false; }
  if (!ok) desenharParaApp(entrada);
  return fs.readFileSync(arquivo);
}

export function chooseNode(slug, { node } = {}) {
  const state = loadState(slug);
  const R = rules();
  if (!state.path) throw new Error('this campaign was raised before the battle path');
  if (state.stage !== 'choose' && (state.stage !== 'result' || !state.pending)) throw new Error('the next battle is chosen after this one is read');
  if (state.stage === 'result' && acabaAqui(state, state.pending.result, R)) throw new Error('this was the last battle of the campaign');
  if (node !== null && !childrenOfAt(state).includes(node)) throw new Error('that battle does not follow the current one');
  state.path.chosen = node;
  saveState(state);
  traceOf(slug, { battle: state.battleNumber }).event('path.choose', { node });
  return state;
}

// ------------------------------------------------------------------------- reading the result

// O SAVE ERRADO É A FALHA MAIS CARA DO APP, porque ela é silenciosa e não tem volta: aplicado o
// resultado, o roster foi reescrito e a batalha seguinte foi gerada em cima dele. Três coisas na
// pasta de saves passam por tudo o que o app já conferia e mesmo assim estão erradas:
//
//   1. um save feito DURANTE a batalha (deployment, um turno, a tela de vitória no fim). O roster só
//      é escrito na virada, então ele traz zero baixas e o AAR da batalha ANTERIOR — o app leria
//      "você venceu e não perdeu ninguém". Reconhecido pelo bloco LZ da partida em curso.
//   2. o próprio arquivo que o app preparou e entregou. Mesma armadilha, pelo mesmo motivo.
//      Reconhecido pelo hash: o app guarda o de tudo o que escreve na pasta do jogo.
//   3. um save de OUTRA batalha desta campanha. A batalha embutida sobrevive intacta a ser jogada
//      (conferido byte a byte), então o hash dela diz de qual batalha o save é.
//
// O que sobra é o save da transição desta batalha, e só ele é oferecido.
function batalhasConhecidas(state) {
  const out = new Map();
  const dir = path.join(dirOf(state.slug), 'battles');
  let itens = [];
  try { itens = fs.readdirSync(dir); } catch { return out; }
  for (const d of itens) {
    const f = path.join(dir, d, 'battle.btt');
    if (!fs.existsSync(f)) continue;
    try { out.set(sha1(fs.readFileSync(f)), Number(d)); } catch { /* ilegivel: so nao entra */ }
  }
  return out;
}

// Todo arquivo que o app escreveu na pasta de saves do jogo para ESTA batalha. Guardar o hash e
// não só o caminho é o que faz a marca sobreviver a uma cópia ou a um `(rebuilt N)` abandonado.
// THE AAR BLOCK AS IT STOOD BEFORE THIS BATTLE. Kept in the state after every result
// (`aarCumulative`); a campaign from before that field reads it from the previous transition save,
// which the history remembers; and before battle one it is all zeros. Null when nothing is known,
// and then the raw block is read as it always was — the log names the base either way.
function previousAarOf(state, trace) {
  const n = state.current?.n ?? state.battleNumber;
  const kept = state.aarCumulative;
  // antes da batalha 1 o bloco e zero — salvo depois de um kit-out (19/10), que deixa o dele com `battle: 0`
  if (kept && kept.battle === n - 1 && kept.player && kept.enemy) return { player: kept.player, enemy: kept.enemy };
  if (n <= 1) return { player: { ...AAR_ZERO }, enemy: { ...AAR_ZERO } };
  const last = (state.history || [])[state.history.length - 1];
  if (last && last.n === n - 1 && last.save && fs.existsSync(last.save)) {
    try {
      const r = readRoster(last.save);
      if (r.aar) return { player: r.aar.vermelho, enemy: r.aar.azul, from: path.basename(last.save) };
    } catch (e) { trace?.event('transition.previousAarFailed', { file: last.save, reason: String(e.message).slice(0, 120) }); }
  }
  trace?.event('transition.previousAarUnknown', { battle: n });
  return null;
}

export function handSave(state, file) {
  try {
    const entrada = { file, bytes: fs.statSync(file).size, sha1: sha1(fs.readFileSync(file)) };
    state.current.handed = [...(state.current.handed || []).filter((h) => h.file !== file), entrada];
    return entrada;
  } catch { return null; }
}

// O CONTEUDO JA LIDO (29/10): `seenSha1` desde entao; das leituras de antes, o save no disco com o mesmo tamanho (a copia
// tem o tamanho do original) e o mesmo conteudo. Cache por caminho e data.
const shaDoSave = new Map();
function conteudoJaLido(state, file, sha) {
  if ((state.seenSha1 || []).includes(sha)) return true;
  let tam; try { tam = fs.statSync(file).size; } catch { return false; }
  for (const f of state.seenSaves || []) {
    let st; try { st = fs.statSync(f); } catch { continue; }
    if (st.size !== tam || path.resolve(f) === path.resolve(file)) continue;
    const k = `${path.resolve(f)}|${st.mtimeMs}`;
    if (!shaDoSave.has(k)) shaDoSave.set(k, saveFacts(f)?.sha1self || null);
    if (shaDoSave.get(k) === sha) return true;
  }
  return false;
}
export function inspectSave(state, facts, file) {
  const cheio = path.resolve(file);
  if ((state.seenSaves || []).some((f) => path.resolve(f) === cheio)) {
    return { kind: 'already-read', why: 'this save has already been read into the campaign' };
  }
  if (!facts) return { kind: 'not-a-save', why: 'this file is not a Combat Mission save' };
  if (facts.sha1self && conteudoJaLido(state, file, facts.sha1self)) {
    return { kind: 'already-read', why: 'this save has already been read into the campaign — it is a copy of one under another name' };
  }
  if (facts.liveBytes > LIVE_BATTLE_BYTES) {
    return {
      kind: 'in-battle',
      why: 'this save was made while the battle was still running — at deployment, on a turn, or on the end-of-battle screen. '
        + 'The campaign roster is only written when the game moves to the next mission, so this file still shows nobody hurt and carries the previous battle\'s report. '
        + 'Click through to the end of the debriefing until the game returns to the campaign screen; the save it writes there is the one to read.',
    };
  }
  // the transition save of a battle that was undone (E176): the game wrote it, it stays on disk, it is never a result
  if ((state.discardedSaves || []).some((f) => path.resolve(f) === cheio)) {
    return { kind: 'discarded', why: 'this save is from a battle that was undone — that battle is gone, and so is its result' };
  }
  const handed = state.current?.handed || [];
  const preparado = handed.find((h) => h.sha1 === facts.sha1self)
    || handed.find((h) => path.resolve(h.file) === cheio)
    || (state.current?.playFrom?.kind === 'save' && path.resolve(state.current.playFrom.file) === cheio ? { file } : null);
  if (preparado) {
    return { kind: 'prepared', why: 'this is the file the app prepared for you — the battle in it has not been played yet' };
  }
  const conhecidas = batalhasConhecidas(state);
  const esperada = state.current?.bttFile && fs.existsSync(state.current.bttFile)
    ? sha1(fs.readFileSync(state.current.bttFile)) : null;
  const hashes = (facts.battles || []).map((b) => b.sha1);
  if (esperada && !hashes.includes(esperada)) {
    const outra = hashes.map((h) => conhecidas.get(h)).filter((n) => Number.isInteger(n)).sort((a, b) => b - a)[0];
    return {
      kind: 'other-battle',
      battle: outra ?? null,
      why: outra
        ? `this save carries battle ${outra} of this campaign, not battle ${state.current?.n}`
        : `this save does not carry the battle waiting to be played — it is from a version of it that was rebuilt since, or from a battle the app no longer has on file`,
    };
  }
  return { kind: 'ready', why: null };
}

// O SAVE JA LIDO QUE O JOGO REGRAVOU (autor, 25/10: a b6 da UKR foi salva como "UKR btt7 transition", e a b7 com o
// mesmo nome). O app pula o caminho de um save ja lido, entao a transicao nova nem aparece na lista. Aqui: os saves ja
// lidos que mudaram depois que a batalha atual foi montada, com a batalha que eles foram, para a tela sugerir renomear.
export function overwrittenSaves(slug) {
  const state = loadState(slug);
  const since = state.current?.generatedAt ? Date.parse(state.current.generatedAt) : null;
  if (since == null || state.stage !== 'play') return [];
  const lidaComo = (f) => (state.history || []).find((h) => typeof h.save === 'string' && path.resolve(h.save) === path.resolve(f))?.n ?? null;
  return (state.seenSaves || []).flatMap((f) => {
    let st; try { st = fs.statSync(f); } catch { return []; }
    return st.mtimeMs > since ? [{ file: f, name: path.basename(f), mtime: st.mtime.toISOString(), readAs: lidaComo(f) }] : [];
  });
}

export function scanForSave(slug) {
  const state = loadState(slug);
  const trace = traceOf(slug, { battle: state.current?.n });
  const since = state.current?.generatedAt ? Date.parse(state.current.generatedAt) - 60_000 : 0;
  const found = findCampaignSaves({ battleNames: state.battleSlots, since, ignore: state.seenSaves });
  const julgados = found.map((f) => {
    const verdict = inspectSave(state, f, f.file);
    return { ...f, kind: verdict.kind, why: verdict.why, fromBattle: verdict.battle ?? null };
  });
  trace.event('save.scan', {
    since: new Date(since).toISOString(), ignored: state.seenSaves.length,
    found: julgados.map((f) => ({ name: f.name, bytes: f.bytes, live: f.liveBytes, kind: f.kind, embedded: f.embedded })),
  });
  return julgados;
}

// `allowEmpty` e so das ferramentas de teste (tools/), nunca da API: um cessar-fogo no turno 0 e uma transicao de verdade
// sem baixa nem ponto, e a prova em jogo de uma virada precisa le-la (E145). O jogador continua protegido pela recusa.
// AS ETAPAS DA LEITURA (08/11/2026, autor: "a leitura fica carregando sem dar nenhum feedback"). O corpo e um gerador que
// devolve o rotulo de cada fase: `readSave` o roda direto (testes, QA, a rota antiga) e `readSaveWithSteps` faz
// `await note(rotulo)` entre as fases — o job mostra a lista andando e o servidor atende o poll da pagina no meio.
export const READ_STEPS = ['Checking the save', 'Reading the after-action report and the roster', 'Casualties and the wounded who make it back', 'Weapons and equipment of each man', 'Experience earned', 'What happened to each vehicle', 'Pay for this battle', 'Saving the result'];
export function readSave(slug, savePath, opts = {}) {
  const g = passosDaLeitura(slug, savePath, opts);
  let r = g.next(); while (!r.done) r = g.next();
  return r.value;
}
export async function readSaveWithSteps(slug, savePath, opts = {}, note = () => {}) {
  note.plan?.(READ_STEPS);
  const g = passosDaLeitura(slug, savePath, opts);
  let r = g.next(); while (!r.done) { await note(r.value); r = g.next(); }
  return r.value;
}
function* passosDaLeitura(slug, savePath, { allowEmpty = false } = {}) {
  // The path comes from the page, and the page is the only thing that should be asking. Confined to
  // the game's own saves so a request the app did not originate cannot make it read an arbitrary
  // file — it could never send the answer anywhere, but a file read is a file read.
  const dentro = path.resolve(paths().savedGames);
  const pedido = path.resolve(savePath);
  if (!pedido.startsWith(dentro + path.sep) || path.extname(pedido).toLowerCase() !== '.bts') {
    throw new Error(`a campaign save has to be a .bts inside ${dentro}`);
  }
  const state = loadState(slug);
  const R = rules();
  const trace = traceOf(slug, { battle: state.current?.n });
  // SO COM UMA BATALHA ESPERANDO O RESULTADO (29/10, bateria da economia): depois do Apply (brief) ou do fim (over) a copia
  // renomeada do save ja lido passava por tudo e abria a "batalha n+1" com estipendio. Montada (play) ou ja lida (result,
  // outra leitura da mesma batalha) le; o resto recusa.
  if (!state.current || (state.stage !== 'play' && state.stage !== 'result')) {
    throw new Error(state.stage === 'over' ? 'this campaign is over — there is no battle waiting for a result' : 'there is no battle waiting for a result: build the next battle and play it first');
  }

  // ANTES DE LER UM BYTE: este arquivo é mesmo o fim da batalha que está esperando? As três
  // maneiras de errar estão descritas em `inspectSave`, e todas passariam por tudo o que vem
  // depois. Uma vez aplicado o resultado não há volta, então a recusa vem aqui.
  yield READ_STEPS[0];
  const facts = saveFacts(savePath);
  const veredito = inspectSave(state, facts, savePath);
  if (veredito.kind !== 'ready') {
    trace.event('save.refused', { save: path.basename(savePath), kind: veredito.kind, why: veredito.why, live: facts?.liveBytes ?? null, embedded: facts?.embedded ?? null });
    throw new Error(`${veredito.why}. Look for the save again and pick the one the app offers.`);
  }

  // O arquivo da batalha entra na conta: e dele que saem os pontos que estavam em jogo (FORMATO 114).
  // E o AAR da transicao anterior tambem: o bloco do save e o ACUMULADO da campanha (111.13), e so a
  // diferenca e desta batalha.
  yield READ_STEPS[1];
  const result = readTransition(savePath, R, trace, state.current?.bttFile, previousAarOf(state, trace));
  result.saveSha1 = facts?.sha1self || null;   // o conteudo: a copia com outro nome e o mesmo save (29/10)
  // O KIT-OUT (19/10): o cessar-fogo no turno 0 e o que se espera dele, e nada do que ele leria conta
  if (state.current?.kitOut) return readKitOut(state, savePath, result, R, trace);
  // The game also saves at DEPLOYMENT, before a shot is fired. That file embeds the same battles
  // and would read as a 0-0 draw with nobody hurt, which would quietly corrupt the campaign.
  const nothingHappened = result.totals.casualties === 0
    && !(result.aar.player?.pontos || result.aar.enemy?.pontos)
    && !(result.aar.player?.mortos || result.aar.enemy?.mortos);
  if (nothingHappened && !allowEmpty) {
    trace.event('save.rejected', { save: result.save, reason: 'no after-action report: nobody hurt and no points on either side' });
    throw new Error('That save has no battle in it — no casualties and no points on either side. It is the deployment save the game writes before the fight. Play the battle to the end and pick the save the game makes at the transition.');
  }
  yield READ_STEPS[2];
  result.battle = state.current?.n ?? state.battleNumber;
  result.casualtiesToBuy = casualtyList(savePath);
  // Quem perdeu homem nesta batalha, ferido ou morto, ANTES do resgate: e o que a leadership chama de perda (18/10).
  result.bloodied = [...new Set(result.casualtiesToBuy.map((c) => c.coreId).filter((x) => x !== null && x !== undefined))];

  // THE ONES WHO WERE CARRIED OFF. A man in state 2 was wounded, not killed (see `casualtyList`),
  // and a wounded man who reaches the aid station can be back with his squad by the next battle.
  // Each of them gets one roll, and the ones who make it rejoin for nothing.
  //
  // The roll is SEEDED — campaign seed, battle number, the man's place in the roster — so it is the
  // same answer every time this result is read, and the screen can promise before the player pays
  // exactly what the writing will do. It is stored with the result, so it never rolls twice.
  const feridos = result.casualtiesToBuy.filter((c) => c.wounded);
  const chance = rescueChanceOf(state, R);
  if (chance > 0) {
    const dado = rng((state.seed ^ (result.battle * 0x9e3779b9)) >>> 0);
    result.rescued = feridos.filter(() => dado() < chance).map((c) => c.index);
  } else {
    result.rescued = [];
  }
  const salvos = new Set(result.rescued);
  result.casualtiesToBuy = result.casualtiesToBuy.filter((c) => !salvos.has(c.index));
  trace.event('result.rescued', {
    battle: result.battle, chance, wounded: feridos.length, back: result.rescued.length,
    names: feridos.filter((c) => salvos.has(c.index)).map((c) => c.name).slice(0, 8),
  });
  // And the ones who cost nothing: scratched, not gone. Shown so the player knows they are coming
  // back and does not go looking for them in the list he pays for.
  result.scratched = lightlyWounded(savePath).length;
  // E quem nunca pisa no mapa: a tela nao oferece reposicao de quem o inimigo nao alcanca.
  result.offMap = [...offMapCoreIds(state)];
  // QUEM ESTAVA COMPRADO NESTA BATALHA (autor, 29/10): o roster do save traz tambem as dormentes do arsenal, e o debrief
  // listava todas em "Your units". Gravado aqui, antes do Quartermaster: um debrief antigo nao muda com compras depois.
  // As tiradas de campo (standDown) sao do jogador e entram.
  result.present = (state.units || []).filter((u) => u.present).map((u) => u.coreId);
  // O QUE PODE SER TREINADO, e por quanto (plano 3): as unidades em campo que ainda nao chegaram
  // ao teto do treino. A tela mostra o que o servidor vai cobrar, calculado pela mesma funcao.
  {
    const perdidas = new Set(state.lost || []);
    result.training = (state.units || [])
      .filter((u) => u.present && !perdidas.has(u.coreId))
      .map((u) => { const t = trainPrice(state, u, R); return t ? { coreId: u.coreId, name: u.name, role: u.role, from: u.experience, to: t.level, price: t.price } : null; })
      .filter(Boolean)
      .sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
  }
  // A ARMA DE CADA HOMEM, e o que o exercito dele carrega (plano 1 fase C). Lido aqui, uma vez,
  // junto com todo o resto que a tela do quartel-mestre precisa.
  yield READ_STEPS[3];
  const escopo = gearScope(state, R);
  if (escopo) {
    try {
      result.gear = readGear(savePath, state, R, { offMap: new Set(result.offMap), onlyCoreIds: escopo.coreIds, factory: factoryTable(), blackMarket: blackMarketOpen(state, R) });
      result.gear.specialForcesOnly = !escopo.all;
      trace.event('gear.read', {
        battle: result.battle, units: result.gear.units.length,
        men: result.gear.units.reduce((a, u) => a + u.men.length, 0),
        canChange: result.gear.units.reduce((a, u) => a + u.men.filter((m) => m.canChange).length, 0),
        menu: Object.fromEntries(Object.entries(result.gear.catalog).map(([k, v]) => [k, v.length])),
      });
    } catch (e) { trace.event('gear.readFailed', { battle: result.battle, error: e.message }); }
  }
  // What the battle taught, worked out HERE and not at apply time: against the force as it fought,
  // before anything is bought. The screen shows it and `applyResult` writes exactly this.
  yield READ_STEPS[4];
  result.progression = progress(state, result, R);
  trace.event('attrs.earned', {
    battle: result.battle, units: result.progression.gains.length,
    promotions: result.progression.promotions.map((p) => `${p.name}: ${p.from}${p.to !== p.from ? ' -> ' + p.to : ''}${p.motivationTo !== p.motivationFrom ? ` (${p.motivationFrom} -> ${p.motivationTo})` : ''}`),
  });
  // O QUE ESTA CAMPANHA APRENDE SOBRE A PROPRIA TROPA. Toda vez que um save e lido, a maior carga
  // ja vista em cada vaga fica guardada — e e ela, e nao a media dos 115 saves da colheita, que diz
  // o que e "cheio" para o refit. Sem isso um esquadrao que volta depenado se reabastece ate o pouco
  // que sobrou, porque `fullLoads` mede o cheio pelo melhor homem do save da vez.
  const aprendeu = learnBaseline(state, savePath);
  trace.event('baseline.learned', {
    battle: result.battle, novos: aprendeu,
    tipos: Object.keys(state.baseline || {}).length,
    vagas: Object.values(state.baseline || {}).reduce((a, t) => a + Object.keys(t).length, 0),
  });

  // WHAT HAPPENED TO EACH MACHINE, read from the save and marked before the screen opens (E90). The
  // player corrects instead of ticking from memory. Written before the snapshot below, so a Reset
  // goes back to what the save said and not to an empty list.
  yield READ_STEPS[5];
  result.vehicles = vehiclesFromSave(state, savePath, { offMap: new Set(result.offMap), R, aar: result.aar?.player || null });
  if (Object.keys(result.vehicles.marks).length) {
    state.vehicles = { ...(state.vehicles || {}), ...result.vehicles.marks };
    state.lost = Object.entries(state.vehicles).filter(([, s]) => s === 'destroyed' || s === 'knocked_out').map(([id]) => Number(id)).sort((a, b) => a - b);
    state.survived = Object.entries(state.vehicles).filter(([, s]) => s === 'survived' || s === 'immobilized').map(([id]) => Number(id)).sort((a, b) => a - b);
  }
  result.leadership = leadershipProgress(state, result, R);
  yield READ_STEPS[6];
  // And what it pays (a escada, 30/10), worked out here, after the marks — the bill needs them — and shown before anything
  // is bought. The marks the player corrects later recompute it (markVehicle).
  result.income = incomeFor(state, result, R);
  trace.event('income.computed', { battle: result.battle, total: result.income.total, step: result.income.step.credits, cover: result.income.cover.credits, bonus: result.income.bonus.credits, bill: result.income.cover.bill, cap: result.income.cover.cap, score: result.income.score });
  const contagem = (s) => Object.values(result.vehicles.marks).filter((x) => x === s).length;
  trace.event('vehicles.read', {
    battle: result.battle, read: result.vehicles.read, destroyed: contagem('destroyed'), immobilized: contagem('immobilized'),
    survived: contagem('survived'), unread: result.vehicles.unread, notListed: result.vehicles.notListed.map((x) => `${x.name} (core ${x.coreId}): ${x.status}`),
  });

  // OS PONTOS OPERACIONAIS DO NO (E176) sao pagos aqui, quando o resultado chega, e nao no Apply: o undo devolve a
  // batalha seguinte e nunca os desfaz. A batalha perdida nao paga. Uma segunda leitura da mesma batalha (outro save
  // dela) reconcilia pelo que ja foi pago, nunca paga duas vezes.
  if (state.path) {
    const id = nodeOfBattle(state, result.battle);
    const no = publicNodeOf(state, id);
    result.node = id;
    result.ops = result.verdict.won !== false ? (no?.ops || 0) : 0;
    state.path.opsPaid = state.path.opsPaid || {};
    const antes = state.path.opsPaid[result.battle] ?? 0;
    if (result.ops !== antes) {
      state.ops = Math.max(0, (state.ops || 0) + result.ops - antes);
      state.path.opsPaid[result.battle] = result.ops;
      trace.event('ops.paid', { battle: result.battle, node: id, ops: result.ops, before: antes, now: state.ops });
    }
  }
  yield READ_STEPS[7];
  state.pending = { savePath, result };
  state.stage = 'result';
  // O ponto de partida do quartel-mestre: tirado agora, quando o resultado chega, e nao quando a
  // tela abre — assim ele sobrevive a trocar de aba e voltar, e o Reset sempre quer dizer "como
  // estava quando esta batalha acabou".
  state.shopSnapshot = retratoDaLoja(state);
  fs.writeFileSync(path.join(battleDir(slug, result.battle), 'result.json'), JSON.stringify(result, null, 1));
  trace.event('result.written', { battle: result.battle });
  // Quem ja lutou, com esta batalha incluida: a tela mostra por ele se a venda devolve credito.
  state.fought = [...foughtIds(state)].sort((a, b) => a - b);
  saveState(state);
  return state;
}

// A LEITURA DO KIT-OUT (19/10): so o que a loja de armas e itens precisa — os homens da SF, agora nomeados — e o que
// volta de graca (todo homem caido, toda maquina da SF perdida). Nada de recompensa, allotment, progressao, leadership,
// resgate, treino, linha de base, marca de veiculo ou ponto operacional.
function readKitOut(state, savePath, transicao, R, trace) {
  const n = state.current.n;
  const sfIds = new Set(state.current.specialForces || kitOutUnits(state).map((u) => u.coreId));
  const baixas = casualtyList(savePath);
  const offMap = [...offMapCoreIds(state)];
  const result = {
    kitOut: true, battle: n,
    save: transicao.save, aar: transicao.aar, aarCumulative: transicao.aarCumulative, totals: transicao.totals, verdict: transicao.verdict, units: transicao.units,
    casualtiesToBuy: baixas, rescued: [], scratched: lightlyWounded(savePath).length, offMap, training: [],
  };
  // as maquinas da SF que o jogador destruiu de proposito ou sem querer voltam na vaga, de graca
  const v = vehiclesFromSave(state, savePath, { offMap: new Set(offMap), R, aar: null });
  result.kitWrecks = Object.entries(v.marks).filter(([id, s]) => sfIds.has(Number(id)) && (s === 'destroyed' || s === 'knocked_out')).map(([id]) => Number(id));
  const escopo = gearScope(state, R);
  if (escopo) {
    try {
      result.gear = readGear(savePath, state, R, { offMap: new Set(offMap), onlyCoreIds: escopo.coreIds, factory: factoryTable(), blackMarket: blackMarketOpen(state, R) });
      result.gear.specialForcesOnly = !escopo.all;
    } catch (e) { trace.event('gear.readFailed', { battle: n, kitOut: true, error: e.message }); }
  }
  result.named = (result.gear?.units || []).filter((u) => sfIds.has(u.coreId)).reduce((a, u) => a + u.men.length, 0);
  state.pending = { savePath, result };
  state.stage = 'result';
  state.shopSnapshot = retratoDaLoja(state);
  fs.mkdirSync(kitDir(state.slug, n), { recursive: true });
  fs.writeFileSync(path.join(kitDir(state.slug, n), 'result.json'), JSON.stringify(result, null, 1));
  trace.event('result.written', { battle: n, kitOut: true });
  saveState(state);
  trace.event('kitout.read', { battle: n, save: path.basename(savePath), named: result.named, casualties: baixas.length, wrecks: result.kitWrecks, aar: result.aar });
  return state;
}

// ------------------------------------------------------------- applying it and moving forward

// A TRIPULACAO VAI COM A MAQUINA. Quem guarnece um BMP, um Stryker ou um morteiro nao e um soldado
// avulso: e parte da maquina, e o jogo trata assim — o gemeo dormente que a reposicao acorda entra em
// campo com a tripulacao inteira dele (112.8, E14A). Cobrar esses homens na lista de reposicoes era
// cobrar duas vezes quem ja vinha com a maquina nova, e o autor viu na hora: "quando pagamos para
// repor o veiculo, estamos tambem pagando pela tripulacao nova".
//
// MAQUINA E PAPEL **E** NOME (E82). Ver `replacement.machineExcludes`: a `Heavy Mortar Team` e a
// `Team (Stinger)` tem papel de maquina e sao tres e dois homens a pe. O teste vive aqui, exportado,
// para a tela e o servidor nunca discordarem sobre quem e tripulacao.
// TODO VEICULO E MAQUINA (22/10, autor: "o ideal e que todo veiculo seja substituivel"): alem dos papeis de
// `machineRoles`, o que a tabela de tipos diz que e veiculo (aba 5) ou o que o nome diz (`vehicleNames`: o Tigr, o Ural,
// o HMMWV, o BRDM, o BRM-1K, o M1167 de ATGM) — antes esses ficavam de fora, sem marca e sem reposicao.
export function isMachine(u, R = rules()) {
  if (!u) return false;
  const papeis = new Set(R.replacement?.machineRoles || []);
  const nomeDeVeiculo = R.replacement?.vehicleNames ? new RegExp(R.replacement.vehicleNames, 'i').test(String(u.name || '')) : false;
  const tipoDeVeiculo = Array.isArray(u.type) && Number(u.type[1]) === 5;
  if (!papeis.has(u.role) && !nomeDeVeiculo && !tipoDeVeiculo) return false;
  if (u.role === 'air') return false;   // a aeronave nao pisa no mapa da campanha
  const fora = R.replacement?.machineExcludes;
  return !(fora && new RegExp(fora, 'i').test(String(u.name || '')));
}

// Maquina e o que o quartel-mestre ja trata como maquina — os papeis de `replacement.machineRoles`,
// na forca e no mapa —, para a tela e o servidor nunca discordarem sobre quem e tripulacao.
export function machineCrew(state, casualties, { roles = null, offMap = null } = {}) {
  const R = rules();
  const papeis = roles ? new Set(roles) : null;
  const ehMaquina = (u) => (papeis ? papeis.has(u.role) : isMachine(u, R));
  const fora = offMap || offMapCoreIds(state);
  // SEM `present`: a tripulacao de uma maquina e tripulacao esteja ela em campo ou nao. Com o teste
  // aqui, o morto do BMP queimado na batalha 1 — que saiu da forca quando foi reposto — voltava a
  // lista de homens a comprar em toda batalha seguinte, a 30 cr (autor, 27/09).
  const maquinas = new Set((state.units || [])
    .filter((u) => ehMaquina(u) && !fora.has(u.coreId))
    .map((u) => u.coreId));
  return (casualties || []).filter((c) => c.coreId !== null && c.coreId !== undefined && maquinas.has(c.coreId));
}

// WHAT A UNIT BOUGHT FROM THE ARSENAL COSTS AT THE LEVEL THE PLAYER PICKED (E53). Priced exactly
// like a library purchase at creation: the unit's own base price scaled by the experience factor
// of the chosen level (absolute mode), with the level it came with as the base for relative mode.
// A level it already has, or none, is the price the unit has on the state.
export function purchasePrice(state, u, level, R = rules()) {
  if (!level || level === u.experience) return u.price || 0;
  if (!R.units.experienceLevels.includes(level)) throw new Error(`${u.name}: ${level} is not an experience level`);
  return priceUnits([{ name: u.name, offMap: u.offMap, type: u.type, baseExperience: u.experience, experience: level }], u.nation || state.nation, R).total;
}

// ------------------------------------------------------------------ habilidades operacionais
//
// UMA COMPRA DE EFEITO UNICO PARA UMA BATALHA (plano 2). O jogador compra no quartel-mestre, o
// credito sai na hora e o efeito e consumido quando a batalha seguinte e MONTADA — e fica gravado
// por batalha, para que refazer a batalha (`regenerateBattle`) nao cobre de novo nem perca o que
// foi pago.
export function abilityList(R = rules()) {
  return R.abilities?.on === false ? [] : (R.abilities?.list || []);
}

// O que o jogador comprou e ainda nao foi usado, mais o que JA foi aplicado a esta batalha. Puro.
export function abilitiesFor(state, n, R = rules()) {
  const lista = abilityList(R);
  const jaNesta = (state.abilities?.applied || []).filter((a) => a.battle === n && a.id !== ENEMY_INTEL && a.id !== OWN_EW && a.id !== RELIGHT).map((a) => a.id);
  const ids = jaNesta.length ? jaNesta : (state.abilities?.pending || []).map((a) => a.id);
  const effect = { minutes: 0, noRefit: false, intel: false, defenseBudget: 0 };
  const usadas = [];
  for (const id of ids) {
    const a = lista.find((x) => x.id === id);
    if (!a) continue;
    usadas.push(id);
    effect.minutes += a.effect?.minutes || 0;
    effect.noRefit = effect.noRefit || !!a.effect?.noRefit;
    effect.intel = effect.intel || !!a.effect?.intel;
    effect.defenseBudget += a.effect?.defenseBudget || 0;
  }
  // o intel inimigo do jogo (17/10), pago em pontos operacionais na aba Intel: o maior nivel comprado para esta batalha
  const intelDela = (state.abilities?.applied || []).filter((a) => a.battle === n && a.id === ENEMY_INTEL);
  effect.intelStrength = intelDela.reduce((m, a) => Math.max(m, a.strength || 0), 0);
  effect.intelOps = intelDela.reduce((s, a) => s + (a.ops || 0), 0);
  // a guerra eletronica propria (17/10), tambem em pontos operacionais na aba Intel: o maior nivel comprado
  const niveis = R.ew?.levels || ['None', 'Light', 'Medium', 'Strong'];
  const ewDela = (state.abilities?.applied || []).filter((a) => a.battle === n && a.id === OWN_EW);
  effect.ewLevel = ewDela.reduce((m, a) => (niveis.indexOf(a.level) > niveis.indexOf(m) ? a.level : m), 'None');
  effect.ewOps = ewDela.reduce((s, a) => s + (a.ops || 0), 0);
  return { ids: usadas, effect, fresh: !jaNesta.length };
}

export const ENEMY_INTEL = 'enemy-intel';

// AS HABILIDADES DE CAMPANHA (18/10, autor). As de MAPA (relogio, intel inimiga, EW proprio, troca de luz) sao por
// batalha e remontam a batalha; estas valem para a campanha inteira, compradas uma vez com pontos operacionais, em
// qualquer estagio menos com a campanha encerrada. Nada e remontado; o undo nao devolve. `state.campaignAbilities` = ids.
export function campaignAbilityList(R = rules()) { return R.abilities?.campaign?.on === false ? [] : (R.abilities?.campaign?.list || []); }
export const hasCampaignAbility = (state, id) => (state.campaignAbilities || []).includes(id);
// o catalogo de fora das SF: a habilidade comprada E a chave de regra (ligada depois da prova em jogo)
export const blackMarketOpen = (state, R = rules()) => hasCampaignAbility(state, 'black-market') && !!R.gear?.blackMarket?.on;
export function priceCampaignAbility(state, id, R = rules()) {
  const a = campaignAbilityList(R).find((x) => x.id === id);
  if (!a) throw new Error(`there is no campaign ability called ${id}`);
  if (hasCampaignAbility(state, id)) throw new Error(`${a.name} is already yours for this campaign`);
  const cost = a.ops ?? 1; const tem = state.ops || 0;
  if (cost > tem) throw new Error(`that takes ${cost} operational point${cost === 1 ? '' : 's'} and you have ${tem}`);
  return { ability: a, cost };
}
export function buyCampaignAbility(slug, { id } = {}) {
  const state = loadState(slug);
  const R = rules();
  if (state.stage === 'over') throw new Error('the campaign is over');
  const { ability, cost } = priceCampaignAbility(state, id, R);
  state.ops = (state.ops || 0) - cost;
  state.campaignAbilities = [...(state.campaignAbilities || []), ability.id];
  // com a loja aberta (resultado lido), o catalogo de armas foi lido na leitura do save: le de novo, para o que a
  // habilidade abre aparecer ja nesta loja
  const res = state.pending?.result;
  if (state.stage === 'result' && res?.gear && state.pending.savePath && fs.existsSync(state.pending.savePath)) {
    const escopo = gearScope(state, R);
    if (escopo) {
      try {
        res.gear = { ...readGear(state.pending.savePath, state, R, { offMap: new Set(res.offMap || []), onlyCoreIds: escopo.coreIds, factory: factoryTable(), blackMarket: blackMarketOpen(state, R) }), specialForcesOnly: !escopo.all };
      } catch { /* o catalogo antigo fica; a compra vale do mesmo jeito */ }
    }
  }
  saveState(state);
  traceOf(slug, { battle: state.battleNumber }).event('campaign.ability', { id: ability.id, cost, opsLeft: state.ops });
  return state;
}
export const OWN_EW = 'own-ew';
export const RELIGHT = 'relight';

// A HORA DE UMA BATALHA (17/10): a ultima troca de luz comprada para ela, senao a do no do caminho (sem caminho: nenhuma,
// e a batalha fica com a hora do mapa).
export function timeOfBattle(state, n, node = null) {
  const trocas = (state.abilities?.applied || []).filter((a) => a.battle === n && a.id === RELIGHT);
  const t = trocas.at(-1);
  return t ? { period: t.period, name: t.name, daylight: t.daylight, hour: t.hour, minutes: t.minutes } : node?.time ?? null;
}

// O CLIMA DE UMA BATALHA (17/10): o do no do caminho. Se a troca de luz levou a batalha para um periodo em que o perfil
// nao existe (neblina de dia, calor de noite), sorteia de novo entre os validos, pela semente e pela hora nova.
export function weatherOfBattle(state, n, node, hora, R = rules()) {
  const base = node?.weather ?? null;
  if (!base || !R.battle?.weather?.on || !hora || hora.period === node?.time?.period) return base;
  if (weatherWeights(hora.period, tierOf(n, R).tier, R).some((x) => x.p.id === base.id)) return base;
  return weatherFor(n, hora.period, R, rng(hashSeed(state.seed, `weather-relight:${n}:${hora.period}:${hora.hour}`)));
}

// A TROCA DE LUZ (17/10, autor): 1 ponto operacional; o jogador escolhe o periodo e a hora cai sorteada dentro dele. Nao
// debita nada.
export function priceRelight(state, n, period, R = rules()) {
  const T = R.battle?.timeOfDay;
  if (!T?.on) throw new Error('the time of day is not in play');
  const p = (T.periods || []).find((x) => x.id === period);
  if (!p) throw new Error(`there is no time of day called ${period}`);
  const atual = timeOfBattle(state, n, state.current?.time ? { time: state.current.time } : state.next?.preview?.time ? { time: state.next.preview.time } : null);
  if (atual?.period === period) throw new Error(`this battle is already at ${String(p.name).toLowerCase()}`);
  const cost = T.relightOps ?? 1;
  const tem = state.ops || 0;
  if (cost > tem) throw new Error(`that takes ${cost} operational point${cost === 1 ? '' : 's'} and you have ${tem}`);
  return { period: p, cost };
}

// O PRECO DA GUERRA ELETRONICA PROPRIA (17/10, autor): Light 1, Medium 2, Strong 3 pontos operacionais; subir paga a
// diferenca. Nao debita nada.
export function priceOwnEW(state, n, level, R = rules()) {
  const cfg = R.ew;
  if (!cfg?.on) throw new Error('electronic warfare is not offered');
  const precos = cfg.own || {};
  if (!(level in precos)) throw new Error(`there is no electronic warfare level called ${level}`);
  const niveis = cfg.levels || ['None', 'Light', 'Medium', 'Strong'];
  const atual = abilitiesFor(state, n, R).effect.ewLevel || 'None';
  if (niveis.indexOf(level) <= niveis.indexOf(atual)) throw new Error(`this battle already has electronic warfare at ${atual}`);
  const cost = precos[level] - (precos[atual] || 0);
  const tem = state.ops || 0;
  if (cost > tem) throw new Error(`that takes ${cost} operational point${cost === 1 ? '' : 's'} and you have ${tem}`);
  return { level, from: atual, cost };
}

// O PRECO DO INTEL INIMIGO (17/10, autor): 10 % por 1 ponto operacional, 30 % por 2, 50 % por 3, 70 % por 4, 100 % por 5.
// Subir de nivel paga a diferenca. Nao debita nada.
export function priceEnemyIntel(state, n, strength, R = rules()) {
  const cfg = R.abilities?.enemyIntel;
  if (!cfg?.on) throw new Error('enemy intelligence is not offered');
  const nivel = (cfg.levels || []).find((l) => l.strength === Number(strength));
  if (!nivel) throw new Error(`there is no enemy intelligence level of ${strength} %`);
  const atual = abilitiesFor(state, n, R).effect.intelStrength || 0;
  if (nivel.strength <= atual) throw new Error(`this battle already has enemy intelligence at ${atual} %`);
  const pago = (cfg.levels || []).find((l) => l.strength === atual)?.ops || 0;
  const cost = nivel.ops - pago;
  const tem = state.ops || 0;
  if (cost > tem) throw new Error(`that takes ${cost} operational point${cost === 1 ? '' : 's'} and you have ${tem}`);
  return { strength: nivel.strength, from: atual, cost };
}

// O relogio com o que foi comprado: o degrau da lista do editor mais proximo do que ele pagou, e
// nunca acima do maior que o editor oferece. O que ele RECEBEU de verdade sai no log e na tela,
// porque a lista tem buracos (de 60 vai para 70) e "+15" pode virar +10 ou +20.
export function withExtraMinutes(base, extra, R = rules()) {
  if (!extra) return { base, extra: 0, final: base };
  const allowed = R.duration.allowed;
  const querido = Math.min(base + extra, allowed[allowed.length - 1]);
  const final = allowed.reduce((best, v) => (Math.abs(v - querido) < Math.abs(best - querido) ? v : best), allowed[0]);
  return { base, extra: final - base, final, paid: extra };
}

// A compra: existe, cabe no teto de repeticoes, e o preco. Nao debita nada — quem debita e o
// `applyResult`, junto com todo o resto, no mesmo orcamento.
export function priceAbilities(ids, state, R = rules()) {
  const lista = abilityList(R);
  const pendentes = (state.abilities?.pending || []).map((a) => a.id);
  const conta = new Map();
  for (const id of pendentes) conta.set(id, (conta.get(id) || 0) + 1);
  const items = [];
  for (const id of ids || []) {
    const a = lista.find((x) => x.id === id);
    if (!a) throw new Error(`there is no operational ability called ${id}`);
    if (a.retired) throw new Error(`${a.name} is no longer offered`);
    const quantas = (conta.get(id) || 0) + 1;
    if (quantas > (a.maxStacks ?? 1)) throw new Error(`${a.name}: you can only buy ${a.maxStacks ?? 1} of these for one battle`);
    conta.set(id, quantas);
    items.push({ id: a.id, name: a.name, price: a.price || 0, effect: a.effect || {} });
  }
  return { items, cost: items.reduce((a, x) => a + x.price, 0) };
}

// --------------------------------------------------------------------------- treino de unidade
//
// UM DEGRAU DE EXPERIENCIA, PAGO, ENTRE BATALHAS (plano 3, a ultima peca da fase C). O teto do
// treino e Veteran de proposito: dali para cima se ganha lutando, e e isso que mantem Crack e Elite
// valendo alguma coisa. O preco e a diferenca do preco da unidade entre o nivel de hoje e o de
// amanha — a mesma escala da compra no arsenal (E53) —, com um piso, senao treinar um esquadrao
// barato sairia por nada.
export function trainPrice(state, u, R = rules()) {
  const t = R.progression?.training;
  if (!t || !u || t.on === false) return null;
  const niveis = R.units.experienceLevels;
  const i = niveis.indexOf(u.experience);
  const teto = niveis.indexOf(t.maxLevel);
  if (i < 0 || teto < 0 || i >= teto) return null;
  const level = niveis[i + 1];
  // A diferenca de preco entre os dois niveis, vezes um fator — treinar em campo custa mais do
  // que ter comprado a unidade treinada — e um piso, senao subir um esquadrao barato sairia por
  // nada. Com os fatores de hoje o piso manda nas unidades baratas e o fator nas caras: 150 para
  // um esquadrao, 240 para um T-64BV.
  const diferenca = (purchasePrice(state, u, level, R) - (u.price || 0)) * (t.factor ?? 1);
  return { level, price: Math.max(t.pricePerStep || 0, Math.round(diferenca)) };
}

// THE QUOTE (05/10/2026, QA plan phase 0): everything `applyResult` validates and prices, and nothing it writes. The
// page asks for it (`POST /api/campaigns/:slug/quote`) with the same body as Apply, so the number it shows before the
// click is the server's own, and a refusal is said before the click instead of after. Same messages as Apply.
const QUIET_TRACE = { event() {}, step: async (_n, _d, f) => f(), read() {}, wrote() {} };
// O HOMEM PELO NOME, NAO PELA POSICAO (08/11/2026, autor: "este esquadrao esta faltando quatro soldados. Eu havia comprado a
// reposicao de todos"). A lista de baixas da b10 da US foi lida por um servidor ainda sem o sobrenome de duas letras (o Su,
// core 289); o Apply ja lia o Su, e todo homem depois dele ficou uma posicao atras: 27 dos 67 indices pagos cairam no vizinho
// (vivo) e 15 feridos nao voltaram. Os indices da lista guardada so valem para o leitor que a escreveu; no Apply cada um volta a
// ser procurado no save pelo core id, nome e ordem dentro da unidade, com o leitor de agora.
export function reindexMen(savePath, result, indices, trace = QUIET_TRACE) {
  // o mapa guardado indice -> homem: a lista inteira de `result.units` (na ordem do roster, a mesma ordem plana do leitor que a
  // escreveu), que cobre tambem os resgatados e a tripulacao; sem ela, so as baixas a comprar
  const guardados = new Map((result.casualtiesToBuy || []).map((c) => [c.index, c]));
  if (Array.isArray(result.units) && result.units.some((u) => Array.isArray(u.soldiers))) {
    guardados.clear(); let k = 0;
    for (const u of result.units) for (const sd of u.soldiers || []) guardados.set(k++, { index: k - 1, name: sd.name, coreId: u.coreId });
  }
  let atual; try { atual = readRoster(savePath); } catch { return indices; }
  const chave = new Map(); const vistos = new Map();
  for (const u of atual.unidades) for (const sd of u.soldados) { const k = `${u.coreId}|${sd.nome}`; const n = vistos.get(k) || 0; vistos.set(k, n + 1); chave.set(`${k}|${n}`, sd.indice); }
  // a ordem do homem dentro da unidade, entre os de mesmo nome, como a lista guardada a via
  const ordemGuardada = new Map(); const contG = new Map();
  for (const c of [...guardados.values()].sort((x, y) => x.index - y.index)) { const k = `${c.coreId}|${c.name}`; const n = contG.get(k) || 0; contG.set(k, n + 1); ordemGuardada.set(c.index, n); }
  const mudados = []; const sem = [];
  const out = indices.map((i) => {
    const c = guardados.get(i); if (!c) return i;
    const j = chave.get(`${c.coreId}|${c.name}|${ordemGuardada.get(i) || 0}`);
    if (j === undefined) { sem.push(`${c.name} (core ${c.coreId})`); return i; }
    if (j !== i) mudados.push({ de: i, para: j, nome: c.name });
    return j;
  });
  if (mudados.length || sem.length) trace.event('refit.reindexed', { moved: mudados.length, examples: mudados.slice(0, 5), notFound: sem.slice(0, 5) });
  return [...new Set(out)];
}

export function quoteApply(state, { replaceIndices = [], replaceVehicles = [], purchaseCoreIds = [], buyFormations = [], purchaseXp = {}, gear = [], kit = [], abilities = [], train = [], sell = [], attachOwned = [] } = {}, R = rules(), trace = QUIET_TRACE) {
  if (state.stage !== 'result' || !state.pending) throw new Error('there is no result waiting to be applied');
  const { result, savePath } = state.pending;
  const n = result.battle;
  if (result.kitOut) return quoteKitOut(state, { replaceIndices, replaceVehicles, purchaseCoreIds, buyFormations, purchaseXp, gear, kit, abilities, train, sell, attachOwned }, R, trace);

  // WHAT THE PAGE SENT, CHECKED BEFORE ANY PRICE (05/10/2026, QA r2 A2-A4, A13). Lists must be lists; a man is replaced
  // once, and only if he is one of this battle's casualties (the same index twice was charged twice, an index of nobody
  // was charged for nothing); ids are numbers before they are deduplicated ([5, "5"] trained the same unit twice).
  for (const [nome, v] of Object.entries({ replaceIndices, replaceVehicles, purchaseCoreIds, buyFormations, gear, kit, abilities, train, sell, attachOwned })) {
    if (!Array.isArray(v)) throw new Error(`${nome} must be a list`);
  }
  if (purchaseXp === null || typeof purchaseXp !== 'object' || Array.isArray(purchaseXp)) throw new Error('purchaseXp must be an object');
  {
    const baixas = new Set((result.casualtiesToBuy || []).map((c) => c.index));
    const fora = replaceIndices.filter((i) => !baixas.has(Number(i)));
    if (fora.length) throw new Error(`these are not casualties of battle ${n}: ${fora.slice(0, 5).join(', ')}`);
    replaceIndices = [...new Set(replaceIndices.map(Number))];
  }
  replaceVehicles = [...new Set(replaceVehicles.map(Number))];
  purchaseCoreIds = [...new Set(purchaseCoreIds.map(Number))];
  train = [...new Set(train.map(Number))];
  sell = [...new Set(sell.map(Number))];
  // THE LAST BATTLE BUYS NOTHING (05/10/2026, E143). After it there is no battle to field, replace or train anything for;
  // the author's RUS1 was offered "Apply and prepare battle 13". Only the empty body passes, which is what Finish sends.
  if (acabaAqui(state, result, R) && [replaceIndices, replaceVehicles, purchaseCoreIds, buyFormations, gear, kit, abilities, train, sell, attachOwned].some((x) => x.length)) {
    throw new Error('this is the last battle of the campaign — nothing is bought, replaced, trained or sold after it; finish the campaign');
  }
  // THE NEXT BATTLE IS A CHOICE (E176): on a battle path, nothing is applied before a node is chosen.
  if (state.path && !acabaAqui(state, result, R) && !state.path.chosen) throw new Error('choose the next battle on the battle path first');

  // 1. money, purchases and lives. What the battle pays (`incomeFor`, pure, a escada de 30/10), recomputed here from the
  // marks as they are NOW — the player corrects them on this screen and the bill follows —, the same numbers the debrief
  // showed after the last correction.
  const income = incomeFor(state, result, R);
  const paid = income.total;
  // A tripulacao nao se compra por homem (`machineCrew`). A tela ja nao a oferece, mas uma pagina
  // aberta antes desta versao ainda pode manda-la — entao ela sai daqui, antes de virar cobranca.
  const tripulacao = machineCrew(state, result.casualtiesToBuy);
  const daTripulacao = new Set(tripulacao.map((c) => c.index));
  const pedidos = replaceIndices.length;
  replaceIndices = replaceIndices.filter((i) => !daTripulacao.has(i));
  // A VENDA (28/09) vem antes de tudo o que custa: o credito dela entra na mesma conta, e o homem de
  // uma unidade vendida nao se repoe — ela nao vai a batalha nenhuma.
  const salePlan = (sell || []).length ? sellPlan(state, sell, foughtIds(state)) : { units: [], refund: 0 };
  const vendendo = new Set(salePlan.units.map((x) => x.coreId));
  if (vendendo.size) {
    const donoDoHomem = new Map((result.casualtiesToBuy || []).map((c) => [c.index, c.coreId]));
    replaceIndices = replaceIndices.filter((i) => !vendendo.has(donoDoHomem.get(i)));
  }
  const replaceCost = replaceIndices.length * R.replacement.creditsPerMan;
  // Formations bought from the library: units that were never in the file. Nothing joins a campaign that is about to
  // end: there would be no battle to field it in, and the credits would be gone.
  if (buyFormations.length && (derrotasDepoisDe(state, result) < 0 || n >= R.battlesToWin)) {
    throw new Error('this is the last battle of the campaign — there is no next battle to bring a new formation into');
  }
  const { dormant, buying, levelOf, purchaseCost, recruits, recruitCost, anexos, attachCost, rosterNew } = quotePurchases(state, { purchaseCoreIds, buyFormations, purchaseXp, vendendo, attachOwned }, R, trace);

  // A MACHINE THAT DID NOT COME BACK. The manual is explicit about the four campaign percentages:
  // REFIT is "the chance a unit has of being completely replaced if lost" — and the app keeps it at
  // zero so that replacements are BOUGHT. That works for men, who have a shop; it left a vehicle
  // with no way home at all. autor lost a Stryker, paid for the men, and the machine simply never
  // came back.
  //
  // Replacing one brings THE SAME MACHINE back, in its own slot (28/09): its roster block is healed
  // in the refit and the game fields it again. Until then a dormant twin was woken up wherever the
  // tree had one (E56/E63/E71), which put machines in formations the player never touched; wrecks
  // replaced that way stay in `state.wrecked` with `replacedBy` and remain off the field. Same price
  // as buying that vehicle outright — a new machine is a new machine.
  const foraDoMapa = offMapCoreIds(state);
  // `taken` serves the immobilized-by-twin path (E62), off since E91.
  const taken = new Set();
  const wrecks = [...new Set(replaceVehicles)].map((id) => {
    const u = state.units.find((x) => x.coreId === id);
    if (!u) throw new Error(`there is no unit with core id ${id} in this campaign`);
    if (!u.present) throw new Error(`${u.name} is not in the force, so it cannot have been lost`);
    if (foraDoMapa.has(id)) throw new Error(`${u.name} never sets foot on the map, so it cannot be lost — it only needs resupply`);
    if (!(state.lost || []).includes(id)) throw new Error(`${u.name} is not marked as destroyed — mark it first, then replace it`);
    // THE MACHINE ITSELF COMES BACK, IN ITS OWN SLOT (28/09). Until now a dormant twin of the same
    // type was woken up wherever the tree had one — the author replaced a BMP of his 1st platoon and a
    // BMP of the 3rd showed up "in the field". The wreck's own block is healed in the refit
    // (`rebuildVehicles`) and the record stays where the player sees it.
    return { lost: u };
  });
  // E AS ARMAS QUE O JOGADOR TROCOU (plano 1 fase C): cobradas pela classe da arma nova, pelo
  // mesmo caminho puro que a tela usou para mostrar o preco.
  const escopoArmas = gearScope(state, R);
  const gearPlan = (gear || []).length && escopoArmas
    ? priceGear(gear, readGear(savePath, state, R, { offMap: offMapCoreIds(state), onlyCoreIds: escopoArmas.coreIds, factory: factoryTable(), blackMarket: blackMarketOpen(state, R) }), R)
    : { changes: [], cost: 0 };
  // O ITEM DE INVENTARIO (E145), pelo mesmo escopo e pela mesma leitura da troca de arma.
  const kitPlan = (kit || []).length && escopoArmas
    ? priceKit(kit, readGear(savePath, state, R, { offMap: offMapCoreIds(state), onlyCoreIds: escopoArmas.coreIds, factory: factoryTable(), blackMarket: blackMarketOpen(state, R) }), R)
    : { changes: [], cost: 0 };

  // Cobrado pelo estado da maquina (destruida inteira, abandonada 40%), no nivel da reposicao
  // (E57) — a pagina ja mostrava a fracao, o servidor cobrava o preco cheio da que queimou.
  const machinesCost = wrecks.reduce((a, w) => a + vehicleCost(w.lost, state.vehicles?.[w.lost.coreId] || 'destroyed', R, w.lost.nation || state.nation), 0);

  // E a tripulacao da maquina que VOLTOU volta junto, de graca — como o conserto dela, que a tela ja
  // dizia ser por conta do jogo. A da maquina marcada como perdida nao volta: ou a reposicao traz uma
  // nova com o gemeo acordado, ou a maquina fica parada esperando dinheiro, e ai nao ha em que por
  // tripulacao nenhuma. Lido antes de `state.lost` mudar logo abaixo.
  const perdidas = new Set(state.lost || []);
  // ... e a da maquina reposta tambem: ela volta na vaga dela, com a tripulacao dela (28/09).
  const repostas = new Set(wrecks.map((w) => w.lost.coreId));
  const tripulacaoDeVolta = tripulacao.filter((c) => !perdidas.has(c.coreId) || repostas.has(c.coreId)).map((c) => c.index);
  trace.event('result.crew', {
    battle: n, down: tripulacao.length, back: tripulacaoDeVolta.length,
    withWreck: tripulacao.length - tripulacaoDeVolta.length, ignoredFromPage: pedidos - replaceIndices.length,
  });

  // AS HABILIDADES E O TREINO (planos 2 e 3), pelos mesmos caminhos puros que a tela usou.
  const abilityPlan = priceAbilities(abilities, state, R);
  if ((train || []).length && R.progression?.training?.on === false) throw new Error('training is off: experience is earned in battle, not bought');
  const trainPlan = [...new Set(train || [])].map((id) => {
    const u = state.units.find((x) => x.coreId === Number(id));
    if (!u) throw new Error(`there is no unit with core id ${id} in this campaign`);
    if (!u.present || (state.lost || []).includes(u.coreId)) throw new Error(`${u.name} is not in the field, so there is nobody there to train`);
    if (vendendo.has(u.coreId)) throw new Error(`${u.name} is being sold — it is not trained on the way out`);
    if (buying.includes(u.coreId)) throw new Error(`${u.name} is being bought this turn — pick the level you want in the arsenal instead of paying to train it`);
    const t = trainPrice(state, u, R);
    if (!t) throw new Error(`${u.name} is ${u.experience} and training only goes up to ${R.progression?.training?.maxLevel}`);
    return { coreId: u.coreId, name: u.name, from: u.experience, to: t.level, price: t.price };
  });
  const trainCost = trainPlan.reduce((a, x) => a + x.price, 0);

  const vendeArma = (gearPlan.changes || []).find((c) => vendendo.has(c.coreId));
  if (vendeArma) throw new Error(`${vendeArma.name} belongs to a unit being sold — no weapon is bought for it`);
  const vendeItem = (kitPlan.changes || []).find((c) => vendendo.has(c.coreId));
  if (vendeItem) throw new Error(`${vendeItem.name} belongs to a unit being sold — no item is bought for him`);
  const spend = replaceCost + purchaseCost + recruitCost + attachCost + machinesCost + gearPlan.cost + kitPlan.cost + abilityPlan.cost + trainCost;
  if (spend > state.credits + paid + salePlan.refund) throw new Error(`spending ${spend} credits (${replaceIndices.length} men + ${wrecks.length} vehicles + ${buying.length} units + ${recruits.length} formations + ${gearPlan.changes.length} weapons + ${kitPlan.changes.length} items + ${abilityPlan.items.length} abilities + ${trainPlan.length} trained) but only ${state.credits + paid + salePlan.refund} are available`);
  // as linhas do roster, para a tela mostrar o que sobra antes da recusa (08/11): linhas de hoje, o teto e o alcance do
  // exercito, e o que esta compra acrescenta, formacao por formacao
  const roster = { lines: rosterLinesOf(state, R), max: rosterCapCheck(0, R, state).max, visible: visibleRosterLines(state, R), newLines: rosterNew, formations: recruits.map((p) => ({ name: nomeDaFonte(p.source), lines: linhasDaCompra(p, R) })), trimmed: R.trimBattle?.on !== false, present: state.units.filter((u) => u.present && !vendendo.has(u.coreId) && !(state.standDown || []).includes(u.coreId)).length + buying.length + recruits.reduce((a, p) => a + (p.units || 0), 0) + anexos.length };
  return { income, paid, tripulacao, pedidos, replaceIndices, salePlan, vendendo, replaceCost, dormant, buying, levelOf, purchaseCost, recruits, recruitCost, anexos, attachCost, foraDoMapa, taken, wrecks, gearPlan, kitPlan, machinesCost, tripulacaoDeVolta, abilityPlan, trainPlan, trainCost, spend, available: state.credits + paid + salePlan.refund, roster };
}

// AS COMPRAS DE UNIDADES E FORMACOES, cotadas do mesmo jeito no Apply da batalha e no do kit-out (21/10): o dormente do
// arsenal e a formacao da biblioteca, com as recusas de sempre.
function quotePurchases(state, { purchaseCoreIds = [], buyFormations = [], purchaseXp = {}, vendendo = new Set(), attachOwned = [] }, R, trace) {
  // Dormente e o que esta no arsenal sem ter sido comprado. O tirado de campo e o vendido tambem tem
  // `present: false`, e sem esta distincao o quartermaster cobrava de novo por uma unidade que ja era
  // do jogador — e ela ficava fora de campo assim mesmo, porque `standDown` vence (28/09).
  const naoDormente = new Set([...(state.standDown || []), ...(state.sold || []).map((s) => s.coreId)]);
  const dormant = new Set(state.units.filter((u) => !u.present && !naoDormente.has(u.coreId)).map((u) => u.coreId));
  const buying = [...new Set(purchaseCoreIds)].filter((id) => dormant.has(id));
  const unknown = purchaseCoreIds.filter((id) => !dormant.has(id));
  if (unknown.length) throw new Error(`these units are not dormant in the arsenal: ${unknown.join(', ')}`);
  // Special forces are what they are: the missing units of their source are never for sale.
  const deSF = buying.filter((id) => isSpecialForcesUnit(state, state.units.find((u) => u.coreId === id)));
  if (deSF.length) throw new Error(`special forces are not reinforced from the arsenal: ${deSF.map((id) => (state.units.find((u) => u.coreId === id) || {}).name || id).join(', ')}`);
  // Um destroco nao se toma: ele se repoe, em Vehicles and guns. Sem esta recusa o jogador pagava o
  // preco cheio por uma maquina que `battlePresence` mantem fora da batalha de qualquer jeito.
  const destrocos = buying.filter((id) => (state.lost || []).includes(id));
  if (destrocos.length) {
    const nomes = destrocos.map((id) => (state.units.find((u) => u.coreId === id) || {}).name || `core ${id}`);
    throw new Error(`${nomes.join(', ')}: destroyed. A wreck is not taken back into the force — replace it in Vehicles and guns.`);
  }
  // Each one at the level the player chose for it (E53), which is also what gets written on the
  // force before the battle (`state.attrs`).
  const levelOf = (id) => (purchaseXp && purchaseXp[id]) || null;
  const purchaseCost = buying.reduce((a, id) => { const u = state.units.find((x) => x.coreId === id); return a + (u ? purchasePrice(state, u, levelOf(id), R) : 0); }, 0);
  // Priced exactly like the ones bought at creation, and refused for the same reason — a unit with no roster template
  // cannot be tracked between battles (FORMATO 112.1).
  if (buyFormations.length) checkArmies(buyFormations, state.armies);
  if (buyFormations.length) checkSpecialForces([...(state.picks || []), ...buyFormations], R);
  if (buyFormations.length) checkRetiredSpecialForces(buyFormations, R);
  if (buyFormations.length) checkDiscardedFormations(buyFormations, R);
  if (buyFormations.length) checkAvailability([...(state.picks || []), ...buyFormations], R);
  const recruits = buyFormations.length ? priceOfPicks(buyFormations, state.nation, rulesFor(state, R)) : [];
  const uncovered = recruits.flatMap((p) => (p.uncovered || []).map((u) => `${u.name} in ${p.source}`));
  if (uncovered.length) throw new Error(`these units have no roster line the game accepts (no template, or no game-written block for a unit without men), so they cannot join the campaign: ${[...new Set(uncovered)].join('; ')}`);
  const recruitCost = recruits.reduce((a, p) => a + (p.price || 0), 0);
  // o veiculo anexado a uma formacao que ja e dele (30/10): inserido DENTRO dela no Apply
  const anexos = attachOwnedOf(state, attachOwned, rulesFor(state, R));
  const attachCost = anexos.reduce((a, e) => a + (e.price || 0), 0);
  // O teto de unidades em campo (E125): quem ja esta em campo, menos o que sai vendido, mais o que entra.
  const emCampo = state.units.filter((u) => u.present && !vendendo.has(u.coreId) && !(state.standDown || []).includes(u.coreId)).length;
  {
    const c = fieldCapCheck(emCampo + buying.length + recruits.reduce((a, p) => a + (p.units || 0), 0) + anexos.length, R);
    trace.event('force.fieldCap', c);
    if (c.level === 'over') throw fieldCapError(c);
  }
  // O teto de linhas do roster (08/11): toda unidade que entra na campanha ganha uma linha, e linha nao sai.
  let novas = 0;
  {
    // desde 10/11 a entrega tira da batalha (e do roster) as ausentes sem homem: de uma formacao nova so ganha linha o que
    // entra em campo (enxugarEntrega), e a dormente paga que nao tem homem na linha volta com linha nova (ela estava fora
    // das linhas de hoje); com a regra desligada, a formacao inteira e nenhuma linha pela dormente, como antes
    const semLinha = R.trimBattle?.on !== false ? (() => { const homens = unitsWithMen(state); return buying.filter((id) => !homens.has(id)); })() : [];
    novas = recruits.reduce((a, p) => a + linhasDaCompra(p, R), 0) + anexos.length + semLinha.length;
    if (novas) {
      const c = rosterCapCheck(rosterLinesOf(state, R) + novas, R, state);
      trace.event('roster.cap', { ...c, new: novas, returning: semLinha.length });
      if (c.level === 'over') throw rosterCapError(c, novas, recruits, R);
    }
    // e as unidades PRESENTES tem de caber nas linhas que o jogo le (08/11): a entrega troca a linha de cada presente alem
    // do limite com a de uma ausente antes dele, o que so e possivel enquanto presentes <= limite
    const visible = visibleRosterLines(state, R);
    if (visible) {
      const presentes = emCampo + buying.length + recruits.reduce((a, p) => a + (p.units || 0), 0) + anexos.length;
      trace.event('roster.visible', { present: presentes, visible });
      if (presentes > visible) throw visibleError(presentes, visible, state);
    }
  }
  // (13/11) O aviso de "apoio aereo pesa na memoria" que ficou aqui por um dia saiu: as medidas de 10/11 (3 secoes de Air
  // Controller = +1,5 GB, aeronave = +0,3 GB) eram a linha do RQ-7B Shadow com 4 bytes a mais no roster (roster.mjs,
  // cortarSobraSemHomens), que deslocava a leitura de tudo o que vinha depois dela. Remedido com a linha certa: 3 secoes
  // de Air Controller custam nada (2.446 contra 2.489 MB sem elas).
  return { dormant, buying, levelOf, purchaseCost, recruits, recruitCost, anexos, attachCost, rosterNew: novas };
}

// A COTACAO DO KIT-OUT (19/10): armas e itens pelo mesmo caminho puro da loja e (21/10, autor: "eu gosto de comprar special
// forces assim que inicio uma nova campanha e voltar para terminar de comprar a minha forca") unidades do arsenal e
// formacoes da biblioteca; nada pago, nada de allotment, e todo homem e toda maquina perdidos voltam de graca (a lista vai
// inteira para o refit). Reposicao, venda, treino e habilidades esperam a batalha.
function quoteKitOut(state, { replaceIndices = [], replaceVehicles = [], purchaseCoreIds = [], buyFormations = [], purchaseXp = {}, gear = [], kit = [], abilities = [], train = [], sell = [], attachOwned = [] }, R, trace = QUIET_TRACE) {
  const { result, savePath } = state.pending;
  for (const [nome, v] of Object.entries({ replaceIndices, replaceVehicles, purchaseCoreIds, buyFormations, gear, kit, abilities, train, sell, attachOwned })) {
    if (!Array.isArray(v)) throw new Error(`${nome} must be a list`);
  }
  if (purchaseXp === null || typeof purchaseXp !== 'object' || Array.isArray(purchaseXp)) throw new Error('purchaseXp must be an object');
  if ([abilities, train, sell].some((x) => x.length)) {
    throw new Error('after a kit-out you change weapons and items and buy units and formations — the rest of the quartermaster opens after the battle');
  }
  const compras = quotePurchases(state, { purchaseCoreIds: [...new Set(purchaseCoreIds.map(Number))], buyFormations, purchaseXp, attachOwned }, R, trace);
  const escopo = gearScope(state, R);
  const lido = () => readGear(savePath, state, R, { offMap: offMapCoreIds(state), onlyCoreIds: escopo.coreIds, factory: factoryTable(), blackMarket: blackMarketOpen(state, R) });
  const gearPlan = gear.length && escopo ? priceGear(gear, lido(), R) : { changes: [], cost: 0 };
  const kitPlan = kit.length && escopo ? priceKit(kit, lido(), R) : { changes: [], cost: 0 };
  const spend = compras.purchaseCost + compras.recruitCost + compras.attachCost + gearPlan.cost + kitPlan.cost;
  if (spend > state.credits) throw new Error(`spending ${spend} credits (${compras.buying.length} units + ${compras.recruits.length} formations + ${gearPlan.changes.length} weapons + ${kitPlan.changes.length} items) but only ${state.credits} are available`);
  const todos = [...new Set((result.casualtiesToBuy || []).map((c) => c.index))];
  return {
    kitOut: true,
    income: { total: 0, step: { credits: 0, battle: result.battle + 1 }, cover: { credits: 0, bill: 0, cap: 0 }, bonus: { credits: 0 }, shares: {} }, paid: 0,
    tripulacao: [], pedidos: 0, replaceIndices: todos, salePlan: { units: [], refund: 0 }, vendendo: new Set(), replaceCost: 0,
    ...compras, foraDoMapa: offMapCoreIds(state), taken: new Set(),
    wrecks: [], gearPlan, kitPlan, machinesCost: 0, tripulacaoDeVolta: [], abilityPlan: { items: [], cost: 0 }, trainPlan: [], trainCost: 0,
    spend, available: state.credits,
  };
}

// THE SCORE (05/10/2026, E143; spec/dominio.md §7, the author's scale): every battle is worth its level, 0 (Total Defeat) to 8
// (Total Victory), times `rules.score.perLevel`, and the credits left at the end are added on top.
export function levelPoints(level) {
  const i = VICTORY_LEVELS.indexOf(level);
  return i < 0 ? 4 : i;
}
// AS PARTES DO PLACAR (autor, 25/10): batalhas e creditos, como em 05/10, mais a forca preservada, a razao de baixas e
// a penalidade das derrotas, tudo vezes o multiplicador da dificuldade (rules.score). Cada parte vai a tela com a conta.
// O multiplicador sai dos parametros da criacao: as derrotas permitidas (gravadas desde 25/10; antes, as que restam mais
// as sofridas), a chance de resgate, os pontos operacionais iniciais e o esforco do inimigo.
export function defeatsAllowedOf(state) {
  if (state.defeatsUnlimited) return 'unlimited';
  if (state.defeatsAllowed != null) return state.defeatsAllowed;
  const sofridas = (state.history || []).filter((h) => h.won === false).length;
  return (state.defeatsLeft ?? 0) + sofridas;
}
export function difficultyMultiplier(state, R = rules()) {
  const D = R.score?.difficulty || {};
  const exercitos = [...(state.armies || [state.nation])].sort().join(',');
  const base = D.armies?.[exercitos] ?? 1;
  const ajuste = (tabela, v) => (tabela && v != null ? (tabela[String(v)] ?? 0) : 0);
  const pontos = state.path?.startingPoints ?? null;
  // 30/10 (a escada): a razao de forca no lugar do esforco do inimigo, que saiu da criacao.
  const m = (base + ajuste(D.defeats, defeatsAllowedOf(state)) + ajuste(D.rescue, state.rescueChance) + ajuste(D.opPoints, pontos)
    + ajuste(D.specialForces, state.specialForcesPrice ?? R.formations?.specialForcesPrice)) * (D.ratio?.[String(ratioOf(state, R))] ?? 1);
  return Math.round(m * 100) / 100;
}
// O multiplicador de cada preset, para a pagina Rules dizer o numero que o placar vai usar.
export function presetMultipliers(R = rules()) {
  return (R.difficulty?.presets || []).map((p) => ({
    name: p.name,
    multiplier: difficultyMultiplier({ armies: p.armies, defeatsAllowed: p.defeats, rescueChance: p.rescueChance, path: { startingPoints: p.opPoints }, forceRatio: p.ratio, specialForcesPrice: p.specialForcesPrice }, R),
  }));
}
// 06/11 (autor): a campanha perdida e sempre a ultima faixa (D), qualquer que seja o placar; os pontos continuam.
export function rankOf(total, R = rules(), { lost = false } = {}) {
  const faixas = R.score?.ranks || [];
  if (lost) return (faixas[faixas.length - 1] || { rank: null }).rank;
  return (faixas.find((f) => total >= f.min) || faixas[faixas.length - 1] || { rank: null }).rank;
}
export function scoreOf(state, R = rules()) {
  const S = R.score || {};
  const per = S.perLevel ?? 1000;
  const levels = (state.history || []).reduce((a, h) => a + levelPoints(h.level), 0);
  const { units: nVivas, value: valorVivo } = playerForceValue(state);
  const vivas = { length: nVivas };
  const forca = Math.round(valorVivo * (S.forceShare ?? 0));
  const homens = (x) => (x ? (x.mortos || 0) + (x.feridos || 0) + (x.desaparecidos || 0) : 0);
  const aar = state.aarCumulative || {};
  const seus = homens(aar.player), deles = homens(aar.enemy);
  const cap = S.ratioCap ?? 5;
  const razao = aar.player || aar.enemy ? Math.min(cap, seus ? deles / seus : cap) : 0;
  const razaoPts = Math.round(razao * (S.perRatio ?? 0));
  const derrotas = (state.history || []).filter((h) => h.won === false).length;
  const derrotasPts = derrotas * (S.perDefeat ?? 0);
  const mult = difficultyMultiplier(state, R);
  const bruto = levels * per + state.credits + forca + razaoPts - derrotasPts;
  const total = Math.max(0, Math.round(bruto * mult));
  const parts = [
    { id: 'battles', label: 'battles', value: levels * per, detail: `${levels} level points × ${per.toLocaleString('en-US')}` },
    { id: 'credits', label: 'credits left', value: state.credits, detail: 'what is left in the purse' },
    { id: 'force', label: 'force preserved', value: forca, detail: `${vivas.length} units in the field worth ${valorVivo.toLocaleString('en-US')} cr × ${S.forceShare ?? 0}` },
    { id: 'ratio', label: 'casualty ratio', value: razaoPts, detail: `${deles} enemy men lost for ${seus} of yours = ${(Math.round(razao * 100) / 100)}${razao >= cap ? ` (capped at ${cap})` : ''} × ${(S.perRatio ?? 0).toLocaleString('en-US')}` },
    { id: 'defeats', label: 'defeats', value: -derrotasPts, detail: `${derrotas} defeat${derrotas === 1 ? '' : 's'} × ${(S.perDefeat ?? 0).toLocaleString('en-US')}` },
  ];
  return {
    battles: (state.history || []).length, levels, perLevel: per, fromLevels: levels * per, credits: state.credits,
    parts, subtotal: bruto, multiplier: mult, difficulty: state.difficulty || null, total, rank: rankOf(total, R, { lost: state.outcome === 'lost' }),
  };
}

// FINISHING THE CAMPAIGN (05/10/2026, E143). On the last battle (the 12th, or the defeat that leaves none) the result is
// applied with nothing bought: the reward is paid, the defeat counted, the battle goes into the history and the campaign
// closes (`applyResult` already stops there and builds no next battle). The score is written with it.
export async function finishCampaign(slug, note = () => {}) {
  const st = loadState(slug); const R = rules();
  if (st.stage !== 'result' || !st.pending) throw new Error('there is no result waiting — the campaign is not at its last debrief');
  if (!acabaAqui(st, st.pending.result, R)) throw new Error(`battle ${st.pending.result.battle} is not the last battle — apply the result instead`);
  note('Closing the campaign');
  const state = await applyResult(slug, {}, note);
  if (state.stage !== 'over') throw new Error('the result was applied but the campaign did not close');
  state.score = scoreOf(state, R);
  state.finishedAt = new Date().toISOString();
  saveState(state);
  traceOf(slug, { battle: state.battleNumber }).event('campaign.finished', { outcome: state.outcome, score: state.score });
  return state;
}

// THE CAMPAIGN IN NUMBERS (05/10/2026, E143): every battle from the history, with the after-action report of both sides
// from its own result.json and what was faced from its own spec.json; the totals; the force as it ends. Read only.
export function campaignSummary(slug, R = rules()) {
  const state = loadState(slug);
  const killsByBattle = new Map(), leadersByBattle = new Map();
  for (const h of state.history || []) lerSaveDoResumo(state, h, killsByBattle, leadersByBattle);
  return montarResumo(state, R, killsByBattle, leadersByBattle);
}

// AS ETAPAS DO RESUMO (14/11, autor: "Reading the campaign..." por um minuto ou mais). O que demora e abrir o save de cada
// batalha (~14 MB, LZ) para os kills e os lideres; aqui cada batalha e uma linha do checklist, e o resultado fica em
// `summary.json`, chaveado pelo estado e pelos saves: a segunda visita a mesma campanha nao le nada.
const RESUMO_VERSAO = 1;
function chaveDoResumo(slug, state) {
  const sel = (f) => { try { const s = fs.statSync(f); return `${s.size}:${Math.round(s.mtimeMs)}`; } catch { return '-'; } };
  return [RESUMO_VERSAO, sel(path.join(dirOf(slug), 'state.json')), ...(state.history || []).map((h) => `${h.n}=${h.save ? sel(h.save) : '-'}`)].join('|');
}
export async function campaignSummaryWithSteps(slug, note = async () => {}, R = rules()) {
  const state = loadState(slug);
  const cacheF = path.join(dirOf(slug), 'summary.json');
  const chave = chaveDoResumo(slug, state);
  try {
    const c = JSON.parse(fs.readFileSync(cacheF, 'utf8'));
    if (c.key === chave && c.summary) { await note('Reading the saved summary'); return c.summary; }
  } catch { /* sem cache: le tudo */ }
  const hist = state.history || [];
  const linha = (h) => `Battle ${h.n}${h.map ? ` — ${h.map}` : ''}: kills and leaders`;
  note.plan?.(['Reading the battle history', ...hist.filter((h) => h.save && fs.existsSync(h.save)).map(linha), 'Honourable mentions and score']);
  await note('Reading the battle history');
  const killsByBattle = new Map(), leadersByBattle = new Map();
  for (const h of hist) {
    if (!h.save || !fs.existsSync(h.save)) continue;
    await note(linha(h));
    lerSaveDoResumo(state, h, killsByBattle, leadersByBattle);
  }
  await note('Honourable mentions and score');
  const resumo = montarResumo(state, R, killsByBattle, leadersByBattle);
  try { fs.writeFileSync(cacheF, JSON.stringify({ key: chave, at: new Date().toISOString(), summary: resumo })); } catch { /* sem cache, so mais lento da proxima vez */ }
  return resumo;
}

// os kills e os lideres de uma batalha, lidos do save dela
function lerSaveDoResumo(state, h, killsByBattle, leadersByBattle) {
  if (!h.save || !fs.existsSync(h.save)) return;
  try { const k = readKills(state, h.save); if (k && !k.error) killsByBattle.set(h.n, k); } catch { /* batalha sem kills: o que ela fez cai na seguinte */ }
  try { leadersByBattle.set(h.n, leadersOf(readPersonnel(state, { savePath: h.save }).soldiers)); } catch { /* sem lideres, a coluna fica vazia */ }
}

function montarResumo(state, R, killsByBattle, leadersByBattle) {
  const slug = state.slug;
  const ler =(n, f) => { const p = path.join(dirOf(slug), 'battles', String(n).padStart(2, '0'), f); try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
  const LADOS = ['mortos', 'feridos', 'desaparecidos', 'tanques', 'blindados', 'outrosVeiculos', 'aeronaves'];
  const zero = () => Object.fromEntries(LADOS.map((k) => [k, 0]));
  const somar = (t, a) => { if (a) for (const k of LADOS) t[k] += a[k] || 0; };
  const voce = zero(), inimigo = zero();
  const lidos = [];
  const battles = (state.history || []).map((h) => {
    const r = ler(h.n, 'result.json'), sp = ler(h.n, 'spec.json');
    if (r) lidos.push({ n: h.n, r });
    somar(voce, r?.aar?.player); somar(inimigo, r?.aar?.enemy);
    const eu = (sp?.enemyUnits || []).filter((u) => u.present !== false);
    return {
      n: h.n, node: h.node ?? null, map: h.map || sp?.map?.name || null, kind: sp?.map?.tipo || null, tier: sp?.map?.tier ?? sp?.defense?.tier ?? null,
      level: h.level, levelPoints: levelPoints(h.level), won: h.won, points: h.points || null,
      you: r?.aar?.player || null, enemy: r?.aar?.enemy || null,
      enemyUnits: sp ? eu.length : null, enemyCost: sp?.defense?.cost ?? null,
      soldiers: r?.totals?.soldiers ?? null, casualties: h.casualties ?? null, alive: h.alive ?? null,
      income: h.income || 0, step: h.incomeParts?.step || 0, cover: h.incomeParts?.cover || 0, bonus: h.incomeParts?.bonus || 0, replaced: h.replaced || 0, bought: h.bought || 0, sold: h.sold || 0, refund: h.refund || 0,
    };
  });
  const perdas = (a) => a.mortos + a.feridos + a.desaparecidos;
  const veiculos = (a) => a.tanques + a.blindados + a.outrosVeiculos + a.aeronaves;
  // o placar gravado no fim; o de uma campanha encerrada antes de 25/10 nao tinha partes nem rank: completado na leitura
  const placar = state.score && state.score.parts ? state.score : { ...(state.score || {}), ...scoreOf(state, R), ...(state.score ? { total: state.score.total } : {}) };
  // a perdida e D mesmo se fechou antes de 06/11 com a letra do placar
  if (placar.rank == null || state.outcome === 'lost') placar.rank = rankOf(placar.total, R, { lost: state.outcome === 'lost' });
  const porNivel = battles.slice().sort((a, b) => b.levelPoints - a.levelPoints || a.n - b.n);
  const melhor = porNivel[0] || null, pior = porNivel[porNivel.length - 1] || null;
  const ganhos = battles.reduce((a, b) => a + b.income + b.refund, 0);
  // AS MENCOES HONROSAS (06/11, autor; honours.mjs), no lugar de "The force at the end": os kills e os lideres sao os do
  // save de cada batalha (o contador do jogo e acumulado: a diferenca entre saves da os kills de cada batalha, e as
  // vidas de cada veiculo sao cortadas nelas); o resto sai dos result.json de cada batalha e do estado.
  // (14/11) os saves sao lidos antes, por lerSaveDoResumo: uma batalha por vez, com o checklist andando
  const ledger = unitLedger({
    units: state.units || [], attrs: state.attrs || {}, wrecked: state.wrecked || [], results: lidos, killsByBattle, leadersByBattle,
    machineOf: (u) => isMachine(u, R), scales: { experience: EXPERIENCE_LEVELS, leadership: LEADERSHIP },
    spotters: R.honours?.spotters ? new RegExp(R.honours.spotters, 'i') : null,
  });
  const top = R.honours?.top ?? 3;
  return {
    slug, name: state.name, nation: state.nation, enemy: state.enemy, stage: state.stage, outcome: state.outcome || null,
    createdAt: state.createdAt || null, finishedAt: state.finishedAt || null, difficulty: state.difficulty || null,
    score: placar, rank: placar.rank, battlesToWin: R.battlesToWin,
    art: (() => { const f = `over_${state.outcome === 'lost' ? 'lost' : 'completed'}.jpg`; return fs.existsSync(path.join(import.meta.dirname, '..', 'web', 'art', f)) ? f : 'home.jpg'; })(),
    highlights: {
      best: melhor ? { n: melhor.n, map: melhor.map, level: melhor.level } : null,
      worst: pior ? { n: pior.n, map: pior.map, level: pior.level } : null,
    },
    battles,
    totals: {
      you: voce, enemy: inimigo, youMen: perdas(voce), enemyMen: perdas(inimigo), youVehicles: veiculos(voce), enemyVehicles: veiculos(inimigo),
      ratio: perdas(voce) ? Math.round((perdas(inimigo) / perdas(voce)) * 100) / 100 : null,
      wins: battles.filter((b) => b.won === true).length, draws: battles.filter((b) => b.won === null || b.level === 'Draw').length, defeats: battles.filter((b) => b.won === false).length,
      menReplaced: battles.reduce((a, b) => a + b.replaced, 0), unitsBought: battles.reduce((a, b) => a + b.bought, 0), unitsSold: battles.reduce((a, b) => a + b.sold, 0),
      // 06/11: os destruidos vem do AAR (youVehicles); repostos sao os refeitos na vaga (rebuilt, desde 28/09) e os de
      // gemeo do jeito antigo (replacedBy). Antes contava so replacedBy e dava "0 of them replaced".
      wrecksReplaced: (state.wrecked || []).filter((w) => w.rebuilt || w.replacedBy != null).length,
      creditsEarned: ganhos, creditsLeft: state.credits,
    },
    mentions: {
      top, killsKnown: killsByBattle.size > 0, killsBattles: killsByBattle.size, battlesRead: (state.history || []).length,
      categories: honourableMentions(ledger, { top, battlesToWin: R.battlesToWin }),
    },
  };
}

// AS FORMACOES DA BIBLIOTECA ENTRAM NA FORCA (o Apply da batalha e, desde 21/10, o do kit-out): enxertadas no fim da
// forca que existe (FORMATO 125), a SF no nivel da regra, a leadership sorteada, os atributos reescritos. Devolve as
// unidades novas, que precisam de linha no roster do save da proxima entrega.
async function recruitFormations(state, recruits, map, R, trace, note, { tag, n, anexos = [] }) {
  if (!recruits.length && !anexos.length) return [];
  const slug = state.slug;
  await note('Bringing in the new formations');
  const grownFile = path.join(dirOf(slug), 'work', `core-force-${tag}.btt`);
  fs.mkdirSync(path.dirname(grownFile), { recursive: true });
  // The units he left out inside a formation he kept, keyed on the grown force: the new pick
  // sits after the existing ones, so its leaves take the next pick index (E55).
  const dropped = recruits.flatMap((p, i) => (p.dropped || []).map((d) => chaveNaForca(state.picks.length + i, d.key)));
  const grown = await growCoreForce({
    picks: state.picks, newPicks: recruits, nation: state.nation, enemy: state.enemy,
    mapFile: mapFileOf(map), workDir: path.join(dirOf(slug), 'work'), out: grownFile,
    before: state.units, present: state.units.filter((u) => u.present).map((u) => u.coreId), dropped, trace,
    // The force to graft onto: what the campaign is fielding right now, with the soft factors,
    // the equipment choices and the attached vehicles already in its bytes.
    coreFile: state.coreFile,
    // os veiculos anexados a formacoes que ja sao dele (30/10), inseridos dentro delas
    attachOwned: anexos,
  });
  // A special forces formation recruited mid-campaign joins at the rule's experience (10/10): its units are the ones
  // whose key starts with the pick's index in the grown force.
  const nivelSF = R.formations?.specialForcesExperience;
  recruits.forEach((p, i) => {
    if (!p.sf || !nivelSF) return;
    const prefixo = `${state.picks.length + i}.`;
    state.attrs = state.attrs || {};
    for (const u of grown.added || []) if (String(u.key || '').startsWith(prefixo)) state.attrs[u.coreId] = { ...(state.attrs[u.coreId] || {}), experiencia: nivelSF };
  });
  {
    const sorteadas = drawLeadershipFor(state, (grown.bought || []).map((u) => u.coreId), R);
    if (sorteadas.length) trace.event('attrs.leadershipDrawn', { at: 'recruit', battle: n, units: sorteadas.length });
  }
  // The soft factors, over the whole force. The graft carries the old units' bytes across
  // untouched, so this is really about the units that just arrived — but it is written for
  // everyone, from the state, which is the authority (FORMATO 112.13).
  if (Object.keys(state.attrs || {}).length) {
    const xpFile = path.join(dirOf(slug), 'work', `core-xp-${tag}.btt`);
    applyAttributes({ coreFile: grownFile, out: xpFile, byCoreId: state.attrs, trace });
    fs.copyFileSync(xpFile, grownFile);
  }
  fs.copyFileSync(grownFile, state.coreFile);
  trace.event('core.graftDone', { file: state.coreFile, recruits: recruits.length });
  const recruited = grown.added;                 // every new core unit needs its roster line
  const bought = grown.bought || [];              // but only these are fielded
  // A RECRUTA NAO REPRECIFICA QUEM JA EXISTE (29/10, bateria da economia): antes toda a forca era reprecificada pelo nivel
  // do arquivo, que ja traz as promocoes, e a formacao promovida vendia por ate 2x o que custou. Quem ja existia guarda
  // preco e `paid`; os novos sao precificados pelo exercito deles (E59) e repartem o preco do pick.
  const desde = state.picks.length;
  state.picks = [...state.picks, ...recruits];
  state.units = precificarForca(state, comNacao(state, unitDirectory(state.coreFile).map((u) => ({ ...u, role: roleOf(u.name, u.offMap, R) }))), R, { desde });
  // o anexo inserido numa formacao antiga (30/10) nasce no pick dela: preco e `paid` = o que a cotacao cobrou, na ordem
  // em que entraram (ids crescentes)
  if (anexos.length) {
    const novos = new Set((grown.added || []).map((u) => u.coreId));
    const inseridos = state.units.filter((u) => novos.has(u.coreId) && pickOf(u) < desde).sort((a, b) => a.coreId - b.coreId);
    if (inseridos.length !== anexos.length) throw new Error(`attached ${anexos.length} vehicle(s) but ${inseridos.length} came into the force`);
    inseridos.forEach((u, k) => { u.price = anexos[k].price; u.paid = anexos[k].price; u.attached = { to: anexos[k].target, battle: n }; });
    trace.event('force.attachedOwned', { units: inseridos.map((u, k) => ({ coreId: u.coreId, name: u.name, formation: u.formation, price: anexos[k].price })) });
  }
  state.coreUnits = state.units.length;
  trace.event('force.recruited', {
    formations: recruits.map((p) => ({ source: p.source, units: p.units, price: p.price })),
    units: bought.map((u) => ({ coreId: u.coreId, name: u.name, formation: u.formation })),
    dormant: recruited.length - bought.length,
    forceNow: state.units.length, fielded: state.units.filter((u) => u.present).length,
  });
  if (bought.length !== recruits.reduce((a, p) => a + (p.units || 0), 0)) {
    trace.event('force.recruitMismatch', { paidFor: recruits.reduce((a, p) => a + (p.units || 0), 0), fielded: bought.length });
  }
  return recruited;
}

// O ARSENAL: as unidades dormentes compradas entram em campo, no nivel escolhido, com a leadership sorteada.
function buyFromArsenal(state, buying, levelOf, R, trace, n) {
  if (!buying.length) return;
  state.purchased = [...(state.purchased || []), ...buying];
  state.attrs = state.attrs || {};
  for (const u of state.units) {
    if (!buying.includes(u.coreId)) continue;
    u.present = true;
    u.paid = purchasePrice(state, u, levelOf(u.coreId), R);   // o que sai da bolsa por ela (29/10)
    // The level it was bought at: kept on the state by core id and written on the force before
    // the battle is built, the same road a recruited formation's choices take (FORMATO 112.13).
    const level = levelOf(u.coreId);
    if (level && level !== u.experience) {
      u.price = purchasePrice(state, u, level, R);
      u.experience = level;
      state.attrs[u.coreId] = { ...(state.attrs[u.coreId] || {}), experiencia: level };
    }
  }
  const sorteadas = drawLeadershipFor(state, buying, R);
  if (sorteadas.length) trace.event('attrs.leadershipDrawn', { at: 'arsenal', battle: n, units: sorteadas.length });
}

// A ARMA E O ITEM QUE ELE COMPROU, por (coreId, vaga), para sempre — o mesmo no Apply da batalha e no do kit-out.
function recordGearAndKit(state, gearPlan, kitPlan) {
  for (const c of kitPlan.changes || []) {
    state.kit = state.kit || {};
    if (c.to) { state.kit[c.coreId] = state.kit[c.coreId] || {}; state.kit[c.coreId][c.slot] = c.to; }
    else if (state.kit[c.coreId]) { delete state.kit[c.coreId][c.slot]; if (!Object.keys(state.kit[c.coreId]).length) delete state.kit[c.coreId]; }
    // A ARMA QUE O LANCADOR TIROU DA MAO 2 (19/10): depois da troca o save nao diz mais qual era (a vaga do RPG-22 ou
    // RPG-26 sorteia), entao a campanha lembra a de fabrica para devolve-la quando o item sair.
    state.kitHand2 = state.kitHand2 || {};
    const tirou = c.to && /^\d+\/\d+$/.test(c.to) && c.factorySecond && c.factorySecond !== '8/0' ? c.factorySecond : null;
    if (tirou) { state.kitHand2[c.coreId] = state.kitHand2[c.coreId] || {}; state.kitHand2[c.coreId][c.slot] = tirou; }
    else if (state.kitHand2[c.coreId]) { delete state.kitHand2[c.coreId][c.slot]; if (!Object.keys(state.kitHand2[c.coreId]).length) delete state.kitHand2[c.coreId]; }
    if (!Object.keys(state.kitHand2).length) delete state.kitHand2;
  }
  for (const c of gearPlan.changes || []) {
    if (c.coreId === undefined || c.slot === undefined) continue;
    state.gear = state.gear || {};
    state.gear[c.coreId] = state.gear[c.coreId] || {};
    state.gear[c.coreId][c.slot] = c.to;
  }
}

// O APPLY DO KIT-OUT (19/10): armas e itens gravados, e a campanha volta ao brief da batalha que esperava, agora
// partindo do save do kit-out — com todo homem e toda maquina da SF de volta, e a municao cheia. O kit-out jogado e uma
// transicao do jogo a mais: o slot da batalha anda um (`slotShift`). O ponto de volta do undo da batalha que vem e este
// quartel-mestre, guardado na pasta do kit-out; o de antes da compra da SF fica onde estava, na pasta da batalha.
async function applyKitOut(state, body, R, trace, note = () => {}) {
  const slug = state.slug;
  const { result, savePath } = state.pending;
  const n = result.battle;
  const q = quoteKitOut(state, body, R, trace);
  // o mapa da batalha que espera: o enxerto das formacoes compradas (21/10) e posicionado nele
  const mapa = q.recruits.length || q.anexos.length ? [...mapCensus(), ...meetCensus()].find((m) => m.f === state.next?.mapFile) : null;
  if ((q.recruits.length || q.anexos.length) && !mapa) throw new Error(`the map of battle ${n} (${state.next?.mapFile}) is no longer in the pool`);
  const undoDir = path.join(kitDir(slug, n), 'undo');
  fs.rmSync(undoDir, { recursive: true, force: true });
  fs.mkdirSync(undoDir, { recursive: true });
  fs.writeFileSync(path.join(undoDir, 'state.json'), JSON.stringify(state));
  fs.copyFileSync(state.coreFile, path.join(undoDir, 'core-force.btt'));
  state.credits -= q.spend;
  lancar(state, { battle: n, kind: 'kitout', spend: q.spend });
  recordGearAndKit(state, q.gearPlan, q.kitPlan);
  // O RESTO DA FORCA (21/10): o arsenal e a biblioteca, pelo mesmo caminho do Apply da batalha. Os homens novos nascem na
  // batalha de verdade, como todo recruta; as linhas de roster entram na entrega dela (`deliverIntoSave`).
  buyFromArsenal(state, q.buying, q.levelOf, R, trace, n);
  const recruited = await recruitFormations(state, q.recruits, mapa, R, trace, note, { tag: `B${n}-kit`, n, anexos: q.anexos });
  if (!q.recruits.length && !q.anexos.length && q.buying.length && Object.keys(state.attrs || {}).length) {
    const attrFile = path.join(dirOf(slug), 'work', `core-attrs-B${n}-kit.btt`);
    fs.mkdirSync(path.dirname(attrFile), { recursive: true });
    applyAttributes({ coreFile: state.coreFile, out: attrFile, byCoreId: state.attrs, trace });
    fs.copyFileSync(attrFile, state.coreFile);
    state.units = state.units.map((u) => ({ ...u, experience: state.attrs[u.coreId]?.experiencia || u.experience, leadership: state.attrs[u.coreId]?.lideranca ?? u.leadership }));
  }
  // o bloco do AAR como o kit-out o deixou: a batalha n subtrai dele, e nao do da batalha n-1
  if (result.aarCumulative) state.aarCumulative = { battle: n - 1, player: result.aarCumulative.player, enemy: result.aarCumulative.enemy };
  state.seenSaves.push(savePath);
  if (result.saveSha1) state.seenSha1 = [...(state.seenSha1 || []), result.saveSha1];
  lembrarSave(state, savePath, result.saveSha1);
  state.slotShift = (state.slotShift || 0) + 1;
  state.kitOuts = [...(state.kitOuts || []), { before: n, save: savePath, named: result.named ?? null, spent: q.spend }];
  state.next = {
    ...state.next, kind: 'save', save: savePath, kitOut: 'done', handedBefore: state.current?.playFrom?.kind === 'save' ? state.current.playFrom.file : (state.next?.handedBefore || null),
    refit: { indices: q.replaceIndices, gear: q.gearPlan.changes, kit: q.kitPlan.changes, rebuiltWrecks: result.kitWrecks || [], recruited, fullRefill: true },
  };
  delete state.shopSnapshot;
  state.pending = null;
  state.current = null;
  state.stage = 'brief';
  saveState(state);
  trace.event('kitout.applied', {
    battle: n, spent: q.spend, slotShift: state.slotShift, back: q.replaceIndices.length, wrecks: result.kitWrecks || [],
    bought: q.buying, recruited: q.recruits.map((p) => ({ source: p.source, units: p.units, price: p.price })), purchaseCost: q.purchaseCost, recruitCost: q.recruitCost,
    gear: q.gearPlan.changes.map((c) => `${c.name}: ${c.fromName || c.from} -> ${c.toName || c.to}`),
    kit: q.kitPlan.changes.map((c) => `${c.name}: ${c.from || 'nothing'} -> ${c.toName || c.to || 'nothing'}`),
  });
  return state;
}

export async function applyResult(slug, { replaceIndices = [], replaceVehicles = [], purchaseCoreIds = [], buyFormations = [], purchaseXp = {}, gear = [], kit = [], abilities = [], train = [], sell = [], attachOwned = [] } = {}, note = () => {}) {
  const state = loadState(slug);
  const R = rules();
  if (state.stage !== 'result' || !state.pending) throw new Error('there is no result waiting to be applied');
  if (!state.coreFile) throw new Error('this campaign has no force');
  const trace = traceOf(slug, { battle: state.pending.result.battle });
  const { result, savePath } = state.pending;
  const n = result.battle;
  if (result.kitOut) return applyKitOut(state, { replaceIndices, replaceVehicles, purchaseCoreIds, buyFormations, purchaseXp, gear, kit, abilities, train, sell, attachOwned }, R, trace, note);

  const q = quoteApply(state, { replaceIndices, replaceVehicles, purchaseCoreIds, buyFormations, purchaseXp, gear, kit, abilities, train, sell, attachOwned }, R, trace);
  const { income, paid, tripulacao, pedidos, salePlan, vendendo, replaceCost, dormant, buying, levelOf, purchaseCost, recruits, recruitCost, anexos, attachCost, foraDoMapa, taken, wrecks, gearPlan, kitPlan, machinesCost, tripulacaoDeVolta, abilityPlan, trainPlan, trainCost, spend } = q;
  replaceIndices = q.replaceIndices;
  // A LEADERSHIP desta batalha, contra a forca como lutou e as marcas ja corrigidas pelo jogador (antes do 'rebuilt').
  const lideranca = leadershipProgress(state, result, R);
  // O PONTO DE VOLTA DO UNDO (E176): o estado inteiro antes de qualquer mudanca, e o unico arquivo que o Apply reescreve
  // no lugar (a forca core, que cresce com os recrutas). Mora na pasta da batalha seguinte e vai embora com ela.
  if (!acabaAqui(state, result, R)) {
    const undoDir = path.join(battleDir(slug, n + 1), 'undo');
    fs.rmSync(battleDir(slug, n + 1), { recursive: true, force: true });
    fs.mkdirSync(undoDir, { recursive: true });
    fs.writeFileSync(path.join(undoDir, 'state.json'), JSON.stringify(state));
    fs.copyFileSync(state.coreFile, path.join(undoDir, 'core-force.btt'));
  }
  state.credits += paid + salePlan.refund - spend;
  lancar(state, { battle: n, kind: 'apply', step: income.step.credits, cover: income.cover.credits, bonus: income.bonus.credits, refund: salePlan.refund, spend });
  if (result.verdict.won === false && !semLimiteDeDerrotas(state)) state.defeatsLeft -= 1;
  if (result.verdict.won === false) state.defeats = (state.defeats || 0) + 1;
  buyFromArsenal(state, buying, levelOf, R, trace, n);
  // O QUE FOI VENDIDO sai da forca para sempre: fica no arquivo e no roster (112.1), entra em
  // `state.sold` — que `battlePresence` poe fora e `spareFor` nunca acorda —, deixa de estar "tirado de
  // campo" e perde a arma comprada. A SF vendida inteira libera a vaga dela (`checkSpecialForces`).
  if (salePlan.units.length) {
    state.sold = [...(state.sold || []), ...salePlan.units.map((x) => ({ battle: n, ...x }))];
    for (const u of state.units) if (vendendo.has(u.coreId)) u.present = false;
    state.standDown = (state.standDown || []).filter((id) => !vendendo.has(id));
    for (const id of vendendo) { if (state.gear?.[id]) delete state.gear[id]; if (state.kit?.[id]) delete state.kit[id]; if (state.kitHand2?.[id]) delete state.kitHand2[id]; }
    markSoldPicks(state, salePlan.units.map((x) => x.coreId), n);
    trace.event('force.sold', { battle: n, units: salePlan.units.map((x) => `${x.name} (core ${x.coreId})${x.refund ? ` +${x.refund} cr` : ''}`), refund: salePlan.refund, wholePicks: salePlan.wholePicks || [] });
  }
  if (wrecks.length) {
    const level = replacementLevel(R);
    for (const w of wrecks) {
      // A new machine is a new machine: it comes at the replacement level (E57), kept by its own
      // core id and written on the force before the battle.
      if (level) {
        w.lost.experience = level;
        w.lost.price = priceUnit(w.lost, w.lost.nation || state.nation, R);
        state.attrs = state.attrs || {};
        state.attrs[w.lost.coreId] = { ...(state.attrs[w.lost.coreId] || {}), experiencia: level };
      }
    }
    // 'rebuilt' e inerte para os recalculos, como 'replaced': a proxima leitura do save escreve por
    // cima o que aconteceu com ela na batalha seguinte.
    drawLeadershipFor(state, wrecks.map((w) => w.lost.coreId), R, n);
    for (const w of wrecks) if (state.vehicles) state.vehicles[w.lost.coreId] = 'rebuilt';
    state.lost = (state.lost || []).filter((id) => !wrecks.some((w) => w.lost.coreId === id));
    state.wrecked = [...(state.wrecked || []), ...wrecks.map((w) => ({ battle: n, coreId: w.lost.coreId, name: w.lost.name, rebuilt: true }))];
    trace.event('result.vehiclesReplaced', {
      battle: n, cost: machinesCost, level: replacementLevel(R),
      replaced: wrecks.map((w) => `${w.lost.name} (core ${w.lost.coreId}) rebuilt in its own slot`),
    });
  }
  // E o conserto do imobilizado por gemeo (E62) — DESLIGADO desde o E91: o jogo conserta sozinho
  // (ver `repairsDue`). `replacement.swapImmobilized` religa.
  const { repairs, noSpare } = R.replacement?.swapImmobilized
    ? repairsDue(state, { buying, taken, offMap: foraDoMapa })
    : { repairs: [], noSpare: [] };
  // O TREINO sobe um degrau e fica gravado por core id, como qualquer escolha de nivel (112.13).
  if (trainPlan.length) {
    state.attrs = state.attrs || {};
    for (const t of trainPlan) {
      const u = state.units.find((x) => x.coreId === t.coreId);
      u.experience = t.to;
      u.price = purchasePrice(state, u, t.to, R);
      state.attrs[t.coreId] = { ...(state.attrs[t.coreId] || {}), experiencia: t.to };
    }
    trace.event('attrs.train', { battle: n, cost: trainCost, units: trainPlan.map((t) => `${t.name} (core ${t.coreId}): ${t.from} -> ${t.to} for ${t.price} cr`) });
  }
  // AS HABILIDADES ficam pendentes: quem as consome e a montagem da batalha seguinte.
  if (abilityPlan.items.length) {
    state.abilities = state.abilities || { pending: [], applied: [] };
    state.abilities.pending = [...(state.abilities.pending || []), ...abilityPlan.items.map((a) => ({ id: a.id, boughtAt: n }))];
    trace.event('ability.buy', { battle: n, forBattle: n + 1, cost: abilityPlan.cost, ids: abilityPlan.items.map((a) => a.id) });
  }
  if (repairs.length) {
    state.purchased = [...(state.purchased || []), ...repairs.map((r) => r.spare.coreId)];
    state.attrs = state.attrs || {};
    state.record = state.record || {};
    for (const r of repairs) {
      r.spare.present = true; r.broken.present = false;
      // A MESMA maquina, consertada: nivel, preco e ficha de combate vao com ela.
      r.spare.experience = r.broken.experience;
      r.spare.price = r.broken.price;
      r.spare.paid = r.broken.paid ?? 0; r.broken.paid = 0;
      if (r.broken.motivation) r.spare.motivation = r.broken.motivation;
      state.attrs[r.spare.coreId] = { ...(state.attrs[r.spare.coreId] || {}), ...(state.attrs[r.broken.coreId] || { experiencia: r.broken.experience }) };
      if (state.record[r.broken.coreId]) state.record[r.spare.coreId] = { ...state.record[r.broken.coreId] };
      if (state.cleanBattles?.[r.broken.coreId] !== undefined) state.cleanBattles[r.spare.coreId] = state.cleanBattles[r.broken.coreId];
    }
    state.repaired = [...(state.repaired || []), ...repairs.map((r) => ({ battle: n, coreId: r.broken.coreId, name: r.broken.name, replacedBy: r.spare.coreId }))];
  }
  if (repairs.length || noSpare.length) {
    trace.event('result.vehiclesRepaired', {
      battle: n, free: true,
      repaired: repairs.map((r) => `${r.broken.name} (core ${r.broken.coreId}) -> core ${r.spare.coreId}, ${r.spare.experience}`),
      noSpare: noSpare.map((u) => `${u.name} (core ${u.coreId})`),
    });
  }
  trace.event('result.applied', {
    battle: n, level: result.verdict.level, won: result.verdict.won, income: paid, step: income.step.credits, cover: income.cover.credits, bonus: income.bonus.credits, bill: income.cover.bill, cap: income.cover.cap, score: income.score, replaceCost, vehicleCost: machinesCost, gearCost: gearPlan.cost, kitCost: kitPlan.cost, kit: kitPlan.changes.map((c) => `${c.name}: ${c.from || 'nothing'} -> ${c.toName || c.to || 'nothing'}`), abilityCost: abilityPlan.cost, abilities: abilityPlan.items.map((a) => a.id), trainCost, trained: trainPlan.map((t) => `${t.name}: ${t.from} -> ${t.to}`), gear: gearPlan.changes.map((c) => `${c.name}: ${c.fromName || c.from} -> ${c.toName || c.to}`),
    bought: buying.map((id) => { const u = state.units.find((x) => x.coreId === id); return { coreId: id, name: u?.name, role: u?.role, price: u?.price, experience: u?.experience, chosen: levelOf(id) }; }), purchaseCost,
    recruited: recruits.map((p) => ({ source: p.source, units: p.units, price: p.price })), recruitCost,
    sold: salePlan.units, refund: salePlan.refund,
    creditsNow: state.credits, defeatsLeft: state.defeatsLeft,
    aar: result.aar, ratio: result.verdict.ratio, share: result.verdict.share,
  });

  // The block as the game left it after this battle: the base the next battle subtracts from.
  if (result.aarCumulative) state.aarCumulative = { battle: n, player: result.aarCumulative.player, enemy: result.aarCumulative.enemy };
  // A ARMA QUE ELE COMPROU, por (coreId, vaga), para sempre. O reset de arma (E78) so nao a
  // desfaz porque ela esta aqui: o indice do homem anda quando o roster cresce, a vaga nao.
  // QUEM CAIU PERDE A ARMA COMPRADA (28/09, autor): todo homem em estado 2/3 no save desta batalha —
  // reposto agora ou nao — volta, quando voltar, com a arma de fabrica da vaga dele. Sem reembolso.
  // Antes das compras novas: quem caiu nao pode comprar neste Apply (priceGear recusa 'down').
  if (state.gear && Object.keys(state.gear).length) {
    const fallen = [];
    for (const u of readRoster(savePath).unidades) u.soldados.forEach((sd, slot) => { if (sd.estado > 1) fallen.push({ coreId: u.coreId, slot, name: sd.nome }); });
    const f = forgetGear(state.gear, fallen);
    if (f.forgotten.length) {
      state.gear = f.gear;
      trace.event('gear.forgotten', { battle: n, men: f.forgotten.map((x) => `${x.name} (core ${x.coreId} slot ${x.slot}): ${x.weapon}`) });
    }
  }
  // o caido perde o item comprado como perde a arma (E145)
  if (state.kit && Object.keys(state.kit).length) {
    const fallen = [];
    for (const u of readRoster(savePath).unidades) u.soldados.forEach((sd, slot) => { if (sd.estado > 1) fallen.push({ coreId: u.coreId, slot, name: sd.nome }); });
    const f = forgetGear(state.kit, fallen);
    if (f.forgotten.length) { state.kit = f.gear; trace.event('kit.forgotten', { battle: n, men: f.forgotten.map((x) => `${x.name} (core ${x.coreId} slot ${x.slot}): ${x.weapon}`) }); }
  }
  recordGearAndKit(state, gearPlan, kitPlan);
  state.history.push({
    n, level: result.verdict.level, won: result.verdict.won,
    points: { player: result.aar.player?.pontos ?? 0, enemy: result.aar.enemy?.pontos ?? 0 },
    casualties: result.totals.casualties, alive: result.totals.alive,
    map: state.current?.map?.name, income: paid, incomeParts: { step: income.step.credits, cover: income.cover.credits, bonus: income.bonus.credits }, bill: income.cover.bill, cap: income.cover.cap, score: income.score, shares: income.shares, replaced: replaceIndices.length, bought: buying.length, sold: salePlan.units.length, refund: salePlan.refund, spend,
    save: savePath,   // o caminho lido de fato (29/10: o save renomeado e adotado pelo conteudo)
    ...(state.path ? { node: state.current?.node ?? nodeOfBattle(state, n), kind: state.current?.map?.kind, rewardMult: state.current?.rewardMult ?? 1, ops: result.ops ?? 0 } : {}),
  });
  state.seenSaves.push(savePath);
  if (result.saveSha1) state.seenSha1 = [...(state.seenSha1 || []), result.saveSha1];
  lembrarSave(state, savePath, result.saveSha1);
  // O rascunho virou compra: nao ha mais para onde voltar, e o proximo resultado tira o seu retrato.
  delete state.shopSnapshot;

  // 1b. WHAT THE BATTLE TAUGHT. Already worked out when the save was read; applied here, to the
  // state first — the bytes follow from it further down, because the core force is the authority
  // for what a unit is and everything else is copied from it.
  const earned = result.progression?.on ? result.progression : null;
  if (earned) {
    state.attrs = state.attrs || {};
    state.record = state.record || {};
    // A maquina reposta e uma maquina nova: chega no nivel da reposicao (E57), nao no que a
    // destruida ganhou na batalha em que queimou.
    const reconstruidas = new Set(wrecks.map((w) => w.lost.coreId));
    for (const g of earned.gains) {
      if (reconstruidas.has(g.coreId)) continue;
      state.record[g.coreId] = g.record.after;
      state.attrs[g.coreId] = {
        ...(state.attrs[g.coreId] || {}),
        experiencia: g.experience,
        ...(g.motivation ? { motivacao: g.motivation } : {}),
      };
      const u = state.units.find((x) => x.coreId === g.coreId);
      if (u) { u.experience = g.experience; if (g.motivation) u.motivation = g.motivation; }
    }
    trace.event('attrs.progress', {
      battle: n, fielded: earned.gains.length, promoted: earned.promotions.length,
      promotions: earned.promotions.map((p) => ({ coreId: p.coreId, name: p.name, from: p.from, to: p.to, motivation: p.motivationTo })),
    });
  }

  if (lideranca.on) {
    state.attrs = state.attrs || {};
    state.cleanBattles = state.cleanBattles || {};
    const reconstruidas = new Set(wrecks.map((w) => w.lost.coreId));
    for (const g of lideranca.gains) {
      if (reconstruidas.has(g.coreId)) continue;
      state.cleanBattles[g.coreId] = g.after;
      if (g.to !== g.from) state.attrs[g.coreId] = { ...(state.attrs[g.coreId] || {}), lideranca: g.to };
    }
    trace.event('attrs.leadership', {
      battle: n, clean: lideranca.gains.filter((g) => g.clean).length, fielded: lideranca.gains.length,
      promotions: lideranca.promotions.map((p) => ({ coreId: p.coreId, name: p.name, from: p.from, to: p.to })),
    });
  }

  // 2. is the campaign over?
  const finished = (!semLimiteDeDerrotas(state) && state.defeatsLeft < 0) || n >= R.battlesToWin;
  if (finished) {
    state.stage = 'over';
    state.outcome = !semLimiteDeDerrotas(state) && state.defeatsLeft < 0 ? 'lost' : 'completed';
    state.pending = null;
    // o placar no MESMO save do fim (29/10): um processo morto entre os dois saves deixava a campanha fechada sem placar
    try { state.score = scoreOf(state, R); state.finishedAt = new Date().toISOString(); } catch (e) { trace.event('score.failed', { error: e.message }); }
    saveState(state);
    trace.event('campaign.over', { outcome: state.outcome, battles: n, credits: state.credits });
    return state;
  }

  // 3. the next battle, written into the very save the game just made
  const next = n + 1;
  state.battleNumber = next;
  note.plan?.(['Applying the result', ...(recruits.length || anexos.length ? ['Bringing in the new formations'] : []), 'Experience and leadership', 'Saving the campaign']);
  await note('Applying the result');
  // On a battle path the map and the enemy are the chosen node's, drawn when the campaign was raised (E176).
  const segredo = state.path ? loadPathSecret(slug) : null;
  const noEscolhido = segredo ? secretNode(segredo, state.path.chosen) : null;
  if (segredo && !noEscolhido) throw new Error(`the chosen battle ${state.path.chosen} is not on this campaign's path`);
  const map = noEscolhido ? noEscolhido.map : pickMap(state, next, R, trace);

  // 3a. Formations bought from the library join the force BEFORE the battle is built. The new
  // records are GRAFTED at the end of the force that exists (FORMATO 125), so every core id the
  // campaign already knows stays on the same unit; `growCoreForce` refuses if that stops being true.
  const recruited = await recruitFormations(state, recruits, map, R, trace, note, { tag: `B${next}`, n, anexos });
  await note('Experience and leadership');

  // WHAT EACH UNIT IS, written on the force before the battle is built so the battle file
  // inherits it through the transplant. When a formation was recruited the grown force already
  // carries it; this is the other path, and the common one.
  if (!recruits.length && !anexos.length && Object.keys(state.attrs || {}).length) {
    const attrFile = path.join(dirOf(slug), 'work', `core-attrs-B${next}.btt`);
    fs.mkdirSync(path.dirname(attrFile), { recursive: true });
    applyAttributes({ coreFile: state.coreFile, out: attrFile, byCoreId: state.attrs, trace });
    fs.copyFileSync(attrFile, state.coreFile);
    state.units = state.units.map((u) => ({ ...u, experience: state.attrs[u.coreId]?.experiencia || u.experience, leadership: state.attrs[u.coreId]?.lideranca ?? u.leadership }));
  }

  // MISSAO > QUARTERMASTER > INTEL > BATTLE (18/10, autor): o Apply aplica e para aqui; a batalha e gerada depois do
  // Intel (`prepareBattle`), com o que se compra la. O que a geracao precisa vai para `state.next`.
  if (noEscolhido) {
    state.path.at = noEscolhido.id;
    state.path.route = [...state.path.route, noEscolhido.id];
    state.path.chosen = null;
    refreshNode(state, segredo, noEscolhido.id);
  }
  state.next = {
    n: next, kind: 'save', node: noEscolhido ? noEscolhido.id : null, mapFile: map.f,
    preview: nextPreview(state, next, noEscolhido, map, R),
    save: savePath,
    // o save que o app entregou para a batalha que acabou: a fonte das linhas que o jogo perder (08/11)
    handedBefore: state.current?.playFrom?.kind === 'save' ? state.current.playFrom.file : null,
    refit: {
      indices: reindexMen(savePath, result, [...new Set([...replaceIndices, ...(result.rescued || []), ...tripulacaoDeVolta])], trace),
      gear: gearPlan.changes, kit: kitPlan.changes,
      rebuiltWrecks: wrecks.map((w) => w.lost.coreId),
      recruited,
    },
    // a Special Forces comprada agora ganha o kit-out antes da batalha seguinte (19/10)
    ...(kitOutOn(R) && recruits.some((p) => p.sf) ? { kitOut: 'pending' } : {}),
  };
  await note('Saving the campaign');
  state.current = null;
  state.stage = 'brief';
  state.pending = null;
  saveState(state);
  trace.event('battle.applied', { battle: next, node: state.next.node, map: map.f, stage: 'brief' });
  return state;
}

// ------------------------------------------------------------------------- undo a battle (E176)
//
// DESFAZER O APPLY (autor, 11/10): da batalha n+1 montada de volta ao quartel-mestre da batalha n, como estava antes do
// clique — creditos, compras, historico, a forca core. Vale ate o resultado da batalha n+1 ser lido no app, mesmo depois
// de lutada. O que NAO volta: as revelacoes do caminho e os pontos operacionais (gastos ou recebidos), e a composicao
// inimiga dos nos, que nunca muda. O que o app escreveu em Saved Games para a batalha desfeita e apagado, so se ainda
// for o mesmo arquivo (sha1); o save que o JOGO escreveu fica, e e recusado se aparecer de novo.
export function undoBattle(slug) {
  const now = loadState(slug);
  const emBrief = now.stage === 'brief' && !!now.next;
  if (!emBrief && (now.stage !== 'play' || !now.current)) throw new Error('only a battle that is built and not yet read can be undone');
  const n = emBrief ? now.next.n : now.current.n;
  const prev = n - 1;
  // DEPOIS DE UM KIT-OUT (19/10) a batalha n volta ao quartel-mestre do kit-out (o ponto de volta mora na pasta dele); o
  // proprio kit-out, montado ou por montar, volta ao de antes da compra da SF, como qualquer batalha.
  const posKit = emBrief ? now.next.kitOut === 'done' : !!now.current.afterKitOut;
  // a batalha 1 de um caminho volta a escolha da primeira batalha (E176); sem caminho, nao ha para onde voltar
  const primeira = n === 1 && !!now.path && !posKit;
  if (!posKit && !primeira && (prev < 1 || (now.history || []).at(-1)?.n !== prev)) throw new Error('the first battle has no quartermaster to go back to');
  const dir = battleDir(slug, n);
  const undoDir = posKit ? path.join(kitDir(slug, n), 'undo') : path.join(dir, 'undo');
  if (!fs.existsSync(path.join(undoDir, 'state.json'))) throw new Error(`battle ${n} was built before undo existed — there is nothing to go back to`);
  if (fs.existsSync(path.join(dir, 'result.json'))) throw new Error(`the result of battle ${n} has already been read`);
  const snap = JSON.parse(fs.readFileSync(path.join(undoDir, 'state.json'), 'utf8'));
  if (snap.coreFile && !fs.existsSync(path.join(undoDir, 'core-force.btt'))) throw new Error(`battle ${n} was built before undo existed — there is nothing to go back to`);
  const confere = posKit ? (snap.stage === 'result' && !!snap.pending?.result?.kitOut && snap.pending.result.battle === n && snap.battleNumber === n)
    : primeira ? snap.stage === 'choose' : (snap.stage === 'result' && snap.pending?.result?.battle === prev && snap.battleNumber === prev);
  if (!confere) throw new Error('the saved quartermaster does not match this battle');
  if (!primeira && !fs.existsSync(snap.pending.savePath)) {
    const achado = localizarSave(now, snap.pending.savePath);
    if (!achado) throw new Error(saveSumido(snap.pending.savePath, posKit ? `${n} (the kit-out)` : prev));
    snap.pending.savePath = achado;
  }
  const trace = traceOf(slug, { battle: n });

  // os saves de transicao da batalha desfeita, se ele ja a jogou: ficam no disco (o jogo os escreveu) e nunca mais
  // sao lidos como resultado
  const descartados = [];
  try { for (const f of scanForSave(slug)) if (f.kind === 'ready') descartados.push(f.file); } catch { /* sem pasta de saves: nada a descartar */ }

  // o caminho: o que foi revelado e pago fica; a posicao volta
  snap.slug = slug;
  // os pontos pagos pelo intel inimigo e pela guerra eletronica propria da batalha desfeita voltam: as compras dela somem
  // com o snapshot (o counter pago no caminho fica, como as revelacoes: o no desfeito volta a ser filho com ele)
  // (o retrato do kit-out ja traz o que foi comprado para a batalha n antes dele: so o comprado depois volta)
  snap.ops = (now.ops ?? snap.ops ?? 0) + intelOpsOf(now, n) - intelOpsOf(snap, n);
  // as habilidades de CAMPANHA (18/10) ficam: compradas uma vez, valem dali em diante, nem o undo devolve
  if (now.campaignAbilities) snap.campaignAbilities = now.campaignAbilities;
  if (snap.path && now.path) {
    // o no desfeito deixa de ser jogado: volta com o que foi pago por ele, mais o mapa, que a batalha montada mostrou
    const desfeito = now.path.at;
    const pago = snap.path.nodes.find((x) => x.id === desfeito)?.revealed || {};
    snap.path = { ...snap.path, nodes: now.path.nodes, opsPaid: now.path.opsPaid };
    const i = snap.path.nodes.findIndex((x) => x.id === desfeito);
    if (i >= 0) snap.path.nodes[i] = publicView(secretNode(loadPathSecret(slug), desfeito), { ...pago, map: true });
  }
  snap.discardedSaves = [...new Set([...(snap.discardedSaves || []), ...(now.discardedSaves || []), ...descartados])];

  // os arquivos que o app entregou para a batalha desfeita, conferidos pelo conteudo
  const saves = path.resolve(paths().savedGames) + path.sep;
  const intocaveis = new Set([snap.pending?.savePath, ...(snap.history || []).map((h) => h.save), now.current?.refit?.source].filter(Boolean).map((f) => path.resolve(f)));
  const apagados = [], mantidos = [];
  for (const h of now.current?.handed || []) {
    const f = path.resolve(h.file);
    let igual = false;
    try { igual = f.startsWith(saves) && !intocaveis.has(f) && fs.existsSync(f) && sha1(fs.readFileSync(f)) === h.sha1; } catch { /* ilegivel: fica */ }
    if (igual) { fs.unlinkSync(f); apagados.push(path.basename(f)); } else mantidos.push(path.basename(f));
  }
  // a batalha 1 ainda nao jogada vive no .cam: o do jogo sai se for o mesmo que o app escreveu (a copia da pasta)
  if (primeira && !emBrief && now.campaignFile) {
    const copia = path.join(dirOf(slug), 'campaign.cam');
    try {
      if (fs.existsSync(now.campaignFile) && fs.existsSync(copia) && sha1(fs.readFileSync(now.campaignFile)) === sha1(fs.readFileSync(copia))) { fs.unlinkSync(now.campaignFile); apagados.push(path.basename(now.campaignFile)); } else mantidos.push(path.basename(now.campaignFile));
      fs.rmSync(copia, { force: true });
    } catch { mantidos.push(path.basename(now.campaignFile)); }
  }
  // a forca: a de antes volta; a levantada depois do retrato (campanha que nasceu sem forca) sai, com o rascunho dela
  const forcaDesfeita = !snap.coreFile && !!now.coreFile;
  if (snap.coreFile) fs.copyFileSync(path.join(undoDir, 'core-force.btt'), snap.coreFile);
  else if (forcaDesfeita) {
    fs.rmSync(now.coreFile, { force: true });
    fs.rmSync(path.join(dirOf(slug), 'work'), { recursive: true, force: true });
  }
  trace.event('undo.filesRemoved', { battle: n });
  saveState(snap);
  if (posKit) {
    // a batalha n sai, o ponto de volta de antes da SF (battles/NN/undo) e o kit-out lido ficam
    for (const f of (fs.existsSync(dir) ? fs.readdirSync(dir) : [])) if (f !== 'undo') fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  } else {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(kitDir(slug, n), { recursive: true, force: true });
  }
  trace.event('battle.undone', { from: n, to: posKit ? `kit-out ${n}` : prev, kitOut: now.current?.kitOut || now.next?.kitOut || null, deleted: apagados, kept: mantidos, discarded: descartados.map((f) => path.basename(f)), credits: { before: now.credits, after: snap.credits }, ops: snap.ops, forceDropped: forcaDesfeita });
  return loadState(slug);
}

// ------------------------------------------------------------- rebuilding a pending battle

// THE REBUILD BASE OF A CAMPAIGN FROM BEFORE `state.current.refit` EXISTED, worked out from what the
// state does keep: the transition save is in the history, and the men the refit brought back are
// exactly the men whose state differs between that save and the FIRST one the app handed over —
// which was written straight from it. Recruits are the units the state knows and the transition
// roster does not. Null when any piece is missing, and then the old chain is all there is.
function rebuildBaseOf(state, n) {
  const last = (state.history || [])[state.history.length - 1];
  if (!last || last.n !== n - 1 || !last.save || !fs.existsSync(last.save)) return null;
  const first = (state.current.handed || [])[0];
  if (!first || !fs.existsSync(first.file)) return null;
  let a, b;
  try { a = readRoster(last.save); b = readRoster(first.file); } catch { return null; }
  if (a.soldados.length !== b.soldados.length) return null;
  const indices = a.soldados.map((s, i) => (s.estado !== b.soldados[i].estado ? i : -1)).filter((i) => i >= 0);
  const noRoster = new Set(a.unidades.map((u) => u.coreId));
  const recruited = (state.units || []).filter((u) => !noRoster.has(u.coreId)).map((u) => ({ coreId: u.coreId, name: u.name, type: u.type }));
  // E as maquinas pagas para voltar na vaga nesta virada: estao em `state.wrecked` com a batalha delas.
  const rebuilt = (state.wrecked || []).filter((w) => w.rebuilt && w.battle === n - 1).map((w) => w.coreId);
  return { source: last.save, indices, recruited, rebuilt, derived: true };
}

// Throws away the battle that is waiting to be played and builds it again — same campaign, same
// core force, same credits. Useful when the enemy engine or the rules change under a campaign in
// progress, and when the map that came up is not wanted. Nothing already played is touched.
export async function regenerateBattle(slug, opts = {}, note = () => {}) {
  const state = loadState(slug);
  if (state.stage !== 'play' || !state.current) throw new Error('there is no battle waiting to be played');
  return rebuildCurrent(state, opts, note);
}

// A TELA INTEL (E176): habilidades de tempo compradas para a batalha JA montada. O relogio so muda remontando a batalha
// (mesmo mapa, mesma defesa do no), entao a compra e cobrar + registrar como aplicada a esta batalha + `rebuildCurrent`.
// Uma falha na remontagem nao grava nada: o estado so e salvo no fim dela.
export function priceLateAbilities(ids, state, n, R = rules()) {
  const lista = abilityList(R);
  const conta = new Map();
  for (const a of (state.abilities?.applied || []).filter((x) => x.battle === n)) conta.set(a.id, (conta.get(a.id) || 0) + 1);
  const items = [];
  for (const id of ids || []) {
    const a = lista.find((x) => x.id === id);
    if (!a) throw new Error(`there is no operational ability called ${id}`);
    if (a.retired || !a.effect?.minutes || a.effect?.noRefit) throw new Error(`${a.name} is not offered`);
    const quantas = (conta.get(id) || 0) + 1;
    if (quantas > (a.maxStacks ?? 1)) throw new Error(`${a.name}: you can only buy ${a.maxStacks ?? 1} of these for one battle`);
    conta.set(id, quantas);
    // 18/10 (autor): o tempo se paga com PONTOS OPERACIONAIS (rules: ops por habilidade)
    items.push({ id: a.id, name: a.name, ops: a.ops || 0, minutes: a.effect.minutes });
  }
  return { items, ops: items.reduce((x, a) => x + a.ops, 0), minutes: items.reduce((x, a) => x + a.minutes, 0) };
}

export async function buyAbility(slug, { abilities = [] } = {}, note = () => {}) {
  const state = loadState(slug);
  const R = rules();
  const n = intelBattle(state, 'abilities are bought for a battle that is built — apply the result first');
  if (!Array.isArray(abilities) || !abilities.length) throw new Error('nothing to buy');
  const plan = priceLateAbilities(abilities, state, n, R);
  if (plan.ops > (state.ops || 0)) throw new Error(`that costs ${plan.ops} operational point${plan.ops === 1 ? '' : 's'} and you have ${state.ops || 0}`);
  const ja = abilitiesFor(state, n, R).effect.minutes;
  const base = state.current ? (state.current.clock?.base ?? state.current.duration) : state.next?.preview?.clockBase ?? null;
  const agora = state.current ? state.current.duration : base == null ? null : withExtraMinutes(base, ja, R).final;
  const depois = base == null ? { final: null } : withExtraMinutes(base, ja + plan.minutes, R);
  if (base != null && depois.final <= agora) throw new Error(`the clock is already at ${agora} minutes — the editor offers nothing longer`);
  state.ops = (state.ops || 0) - plan.ops;
  state.abilities = state.abilities || { pending: [], applied: [] };
  state.abilities.applied = [...(state.abilities.applied || []), ...plan.items.map((a) => ({ id: a.id, battle: n, late: true, ops: a.ops }))];
  traceOf(slug, { battle: n }).event('ability.buyLate', { battle: n, ids: plan.items.map((a) => a.id), ops: plan.ops, opsLeft: state.ops, clock: { from: state.current?.duration ?? null, to: depois.final } });
  return afterIntelBuy(state, note);
}

// O INTEL INIMIGO DO JOGO (17/10): Early Intel = Red e Intel Strength comprados com PONTOS OPERACIONAIS para a batalha ja
// montada, que e remontada no mesmo mapa. Os pontos so saem do estado no fim da remontagem (o estado so e salvo ali).
export function intelOpsOf(state, n) {
  // tudo que o Intel cobrou em pontos para a batalha n: intel inimiga, EW propria, luz e (18/10) o tempo extra
  return (state.abilities?.applied || []).filter((a) => a.battle === n).reduce((s, a) => s + (a.ops || 0), 0);
}

export async function buyEnemyIntel(slug, { strength } = {}, note = () => {}) {
  const state = loadState(slug);
  const R = rules();
  const n = intelBattle(state, 'enemy intelligence is bought for a battle that is built — apply the result first');
  const p = priceEnemyIntel(state, n, strength, R);
  state.ops = (state.ops || 0) - p.cost;
  state.abilities = state.abilities || { pending: [], applied: [] };
  state.abilities.applied = [...(state.abilities.applied || []), { id: ENEMY_INTEL, battle: n, late: true, strength: p.strength, ops: p.cost }];
  traceOf(slug, { battle: n }).event('intel.buy', { battle: n, strength: p.strength, from: p.from, cost: p.cost, opsLeft: state.ops });
  return afterIntelBuy(state, note);
}

// A GUERRA ELETRONICA PROPRIA (17/10): Red EW comprado com pontos operacionais para a batalha ja montada, que e remontada
// no mesmo mapa.
export async function buyOwnEW(slug, { level } = {}, note = () => {}) {
  const state = loadState(slug);
  const R = rules();
  const n = intelBattle(state, 'electronic warfare is bought for a battle that is built — apply the result first');
  const p = priceOwnEW(state, n, level, R);
  state.ops = (state.ops || 0) - p.cost;
  state.abilities = state.abilities || { pending: [], applied: [] };
  state.abilities.applied = [...(state.abilities.applied || []), { id: OWN_EW, battle: n, late: true, level: p.level, ops: p.cost }];
  traceOf(slug, { battle: n }).event('ew.buy', { battle: n, level: p.level, from: p.from, cost: p.cost, opsLeft: state.ops });
  return afterIntelBuy(state, note);
}

// A TROCA DE LUZ (17/10): o periodo escolhido, a hora sorteada nele (pela semente da campanha, a batalha e quantas trocas
// ja houve), e a batalha remontada no mesmo mapa.
export async function buyRelight(slug, { period } = {}, note = () => {}) {
  const state = loadState(slug);
  const R = rules();
  const n = intelBattle(state, 'the light is changed for a battle that is built — apply the result first');
  const { period: p, cost } = priceRelight(state, n, period, R);
  const k = (state.abilities?.applied || []).filter((a) => a.battle === n && a.id === RELIGHT).length;
  const hour = p.hours[Math.floor(rng(hashSeed(state.seed, `relight:${n}:${k}`))() * p.hours.length)];
  state.ops = (state.ops || 0) - cost;
  state.abilities = state.abilities || { pending: [], applied: [] };
  state.abilities.applied = [...(state.abilities.applied || []), { id: RELIGHT, battle: n, late: true, period: p.id, name: p.name, daylight: p.daylight, hour, minutes: hour * 60, ops: cost }];
  traceOf(slug, { battle: n }).event('light.buy', { battle: n, period: p.id, hour, from: state.current?.time ?? state.next?.preview?.time ?? null, cost, opsLeft: state.ops });
  return afterIntelBuy(state, note);
}

// QUAL BATALHA O INTEL ATENDE (18/10): a ainda nao gerada (brief) ou a ja montada (play).
function intelBattle(state, msg) {
  if (state.stage === 'brief' && state.next) {
    if (!state.coreFile) throw new Error('raise your force in the Quartermaster first');
    return state.next.n;
  }
  // o kit-out (19/10) nao e a batalha: o Intel espera ele acabar
  if (state.stage === 'play' && state.current?.kitOut) throw new Error('finish the kit-out first — Intel is for the battle after it');
  if (state.stage === 'play' && state.current) return state.current.n;
  throw new Error(msg);
}
// Comprado antes da montagem, so registra (a batalha sera gerada com ele); depois, remonta como sempre.
async function afterIntelBuy(state, note) {
  if (state.stage === 'brief') { saveState(state); return state; }
  return rebuildCurrent(state, { newMap: false }, note);
}

async function rebuildCurrent(state, { newMap = false } = {}, note = () => {}) {
  const slug = state.slug;
  const R = rules();
  const n = state.current.n;
  const trace = traceOf(slug, { battle: n });
  trace.event('battle.regenerate', { battle: n, newMap, previous: { map: state.current.map, duration: state.current.duration, defense: state.current.defense } });

  // O QUE CADA UNIDADE E, escrito na forca tambem aqui (E63). A reconstrucao usa o `core-force.btt`
  // como ele esta, e ele so recebe os atributos no caminho que APLICA o resultado: uma unidade que
  // entrou em campo depois disso — o gemeo que conserta uma maquina avariada, por exemplo — ia para
  // a batalha no nivel que a biblioteca rolou, e nao no que o estado diz. Idempotente.
  if (Object.keys(state.attrs || {}).length) {
    const attrFile = path.join(dirOf(slug), 'work', `core-attrs-B${n}-again.btt`);
    fs.mkdirSync(path.dirname(attrFile), { recursive: true });
    applyAttributes({ coreFile: state.coreFile, out: attrFile, byCoreId: state.attrs, trace });
    fs.copyFileSync(attrFile, state.coreFile);
    state.units = state.units.map((u) => ({ ...u, experience: state.attrs[u.coreId]?.experiencia || u.experience, leadership: state.attrs[u.coreId]?.lideranca ?? u.leadership }));
  }

  // A battle on the path is the node's: same enemy, same map — rebuilding it never re-rolls either (E176).
  const noAtual = state.path && state.current.node && state.current.node !== START_ID ? secretNode(loadPathSecret(slug), state.current.node) : null;
  if (state.path && state.current.node && !noAtual) throw new Error(`the battle ${state.current.node} is not on this campaign's path`);
  if (newMap && state.path) throw new Error('on the battle path the map belongs to the battle you chose — build it again on the same map');
  if (newMap && state.current.kitOut) throw new Error('the kit-out has no map to change — it is always the smallest one that holds the special forces');
  let map;
  if (state.current.kitOut) map = null;
  else if (newMap) {
    state.playedMaps = state.playedMaps.filter((m) => m !== (state.current.map.familia || state.current.map.file));
    map = pickMap(state, n, R, trace);
  } else {
    map = [...mapCensus(), ...meetCensus()].find((m) => m.f === state.current.map.file);
    if (!map) throw new Error(`the map ${state.current.map.file} is no longer in the pool`);
  }

  // o .btt e o spec de antes, guardados ate o saveState: um rebuild morto no meio volta a eles (recuperarInterrompido)
  {
    const prev = REFAZENDO(slug); fs.rmSync(prev, { recursive: true, force: true }); fs.mkdirSync(prev, { recursive: true });
    const alvo = {};
    for (const [nome, f] of [['battle.btt', state.current.bttFile], ['spec.json', path.join(path.dirname(state.current.bttFile || ''), 'spec.json')]]) {
      if (f && fs.existsSync(f)) { fs.copyFileSync(f, path.join(prev, nome)); alvo[nome] = f; }
    }
    fs.writeFileSync(path.join(prev, 'alvo.json'), JSON.stringify(alvo));
  }
  note(state.current.kitOut ? 'Generating the kit-out again' : 'Generating battle ' + n + ' again');
  // o kit-out (19/10) se refaz como foi feito: o menor mapa que comporta a SF, so ela em campo
  const built = state.current.kitOut ? await makeKitOut(state, n, R, trace) : await makeBattle(state, n, map, R, trace, { ...(noAtual ? { node: noAtual, intel: !!state.current.intel } : {}), note });
  trace.event('battle.rebuilt', { battle: n, file: built.file });
  // the Start node (battle 1) is built without one, and keeps its place on the path
  if (state.current.node) { built.current.node = state.current.node; built.current.rewardMult = state.current.rewardMult ?? 1; }

  note('Putting it where the game will find it');
  if (state.current.playFrom.kind === 'campaign') {
    // The campaign has not been started yet: rewrite the .cam with the new battle in both slots.
    const camOut = state.campaignFile;
    await buildCampaign({
      coreFile: state.coreFile,
      battles: [
        { nome: state.battleSlots[0], btt: built.file, nextWin: 1, nextLose: 1 },
        { nome: state.battleSlots[1], btt: built.file, nextWin: 0, nextLose: 0 },
      ],
      out: camOut, percentages: campaignPercentages(R, built.current.noRefit ? { rest: 0 } : {}), trace,
    });
    campaignHeader(state, camOut, R, trace);
    fs.copyFileSync(camOut, path.join(dirOf(slug), 'campaign.cam'));
    state.current = { ...built.current, playFrom: state.current.playFrom };
  } else {
    // Mid-campaign: the new battle goes into a fresh copy of the save and the old one is left alone.
    //
    // FROM THE SAVE THE GAME WROTE, NOT FROM THE LAST ONE THE APP HANDED OVER (E40). Chaining from
    // the handed save looked safe because the refit is idempotent — until the handed save came out
    // corrupted (a magazine counter overwritten by the E39 locator): every rebuild inherited the
    // damage and none of them ever loaded. With `state.current.refit` the delivery is REDONE from
    // the transition save — same men brought back, same recruits added, same attributes synced —
    // so a rebuild is a rebuild, not a patch on a patch. States from before this field keep the
    // old chain, which is all they have.
    const handed = state.current.playFrom.file;
    const refit = state.current.refit || rebuildBaseOf(state, n);
    const fromScratch = !!(refit && refit.source && fs.existsSync(refit.source));
    if (!fromScratch && !fs.existsSync(handed)) throw new Error(`the save this battle was written into is gone: ${handed}`);
    trace.event('battle.rebuildBase', fromScratch ? { base: 'transition', file: refit.source, indices: refit.indices.length, recruited: refit.recruited.length } : { base: 'handed', file: handed });
    const fielded = fieldedIds(state);
    const names = new Map((state.units || []).map((u) => [u.coreId, u.name]));
    // depois de um kit-out a municao volta cheia mesmo num "push on" (19/10)
    const semRefit = !!built.current.noRefit && !refit?.fullRefill;
    // Refazer tambem cura o imobilizado que o jogo deu como perdido — inclusive o de uma entrega
    // anterior a esta regra (o T-90AM do Lapin, batalha 5 da RUS1).
    const reconstruir = fromScratch ? [...new Set([...(refit.rebuilt || []), ...writtenOffImmobilized(state, refit.source)])] : writtenOffImmobilized(state, handed);
    // a batalha refeita tambem sai so com quem pode entrar (enxugarEntrega), e o roster acompanha nos dois caminhos: um save
    // entregue ja enxuto nao tem as linhas das dormentes, e a batalha nova as traria de volta sem linha (112.1)
    const enx = enxugarEntrega(state, built.file, fromScratch ? refit.source : handed, fromScratch ? refit.previous || null : null, fromScratch ? refit.recruited || [] : [], R, trace);
    let from = refitSave({ save: fromScratch ? restaurarRoster(state, refit.source, refit.previous || null, enx.crescer.map((u) => u.coreId), `B${n}-again`, trace, enx.fora) : (enx.fora.size || enx.crescer.length ? restaurarRoster(state, handed, null, enx.crescer.map((u) => u.coreId), `B${n}-again`, trace, enx.fora) : handed), workDir: path.join(dirOf(slug), 'work'), tag: `B${n}-again`, indices: fromScratch ? refit.indices : [], fielded, names, armies: unitArmies(state), formations: new Map((state.units || []).map((u) => [u.coreId, u.formation])), R, trace, table: baselineTable(state), keep: state.gear || null, keepKit: state.kit || null, refill: semRefit ? 0 : null, rebuilt: reconstruir });
    if (enx.crescer.length) {
      const grownSave = path.join(dirOf(slug), 'work', `roster-B${n}-again.bts`);
      growSaveRoster({ save: from, out: grownSave, units: enx.crescer, coreFile: state.coreFile, typeTable: typeTable(), trace });
      from = grownSave;
    }
    if (fromScratch) {
      const synced = path.join(dirOf(slug), 'work', `roster-attrs-B${n}-again.bts`);
      syncRosterAttributes({ save: from, out: synced, coreFile: state.coreFile, presenceFile: built.file, trace, visibleLines: visibleRosterLines(state, R) });
      from = synced;
    }
    const dir = path.dirname(handed);
    const stem = path.basename(handed, '.bts').replace(/ \(rebuilt \d+\)$/, '');
    let out = path.join(dir, `${stem} (rebuilt 1).bts`);
    for (let k = 2; fs.existsSync(out); k++) out = path.join(dir, `${stem} (rebuilt ${k}).bts`);
    abrirEntrega(slug, out);
    injectBattle({ save: from, battleName: state.battleSlots[slotFor(state, n)], btt: built.file, out, percentages: campaignPercentages(R, semRefit ? { rest: 0 } : {}), trace });
    // As entregas anteriores desta MESMA batalha continuam valendo: um `(rebuilt N)` sem trocar de
    // mapa sai byte a byte igual, entao o arquivo velho carrega a batalha certa e passaria pela
    // conferencia se nao estivesse marcado como entregue.
    // A FICHA DO REFIT FICA (30/09). Sem ela o rebuild SEGUINTE caia no `rebuildBaseOf`, que nao sabia
    // dos veiculos repostos na vaga: o autor refez a batalha 5 da RUS1 duas vezes e na segunda os dois
    // T-90AM pagos voltaram a S = 1 — so o imobilizado curado entrou.
    const fichaRefit = fromScratch ? { ...refit, rebuilt: reconstruir } : state.current.refit;
    state.current = { ...built.current, handed: state.current.handed || [], playFrom: { kind: 'save', file: out, label: path.basename(out, '.bts') }, ...(fichaRefit ? { refit: fichaRefit } : {}), ...(state.current.afterKitOut ? { afterKitOut: true } : {}) };
    handSave(state, out);
  }
  saveState(state);
  fecharEntrega(slug);
  trace.event('battle.ready', { battle: n, playFrom: state.current.playFrom, map: state.current.map, duration: state.current.duration, regenerated: true });
  return state;
}

// ------------------------------------------------------------------------------- diagnostics

// One object with everything needed to understand a problem without the game folder: the state,
// the rules that were in force, the file inventory and the tail of the log.
export function diagnostics(slug, lines = 400) {
  const state = loadState(slug);
  const dir = dirOf(slug);
  const inventory = [];
  const walk = (d, rel = '') => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, path.join(rel, e.name));
      else inventory.push({ file: path.join(rel, e.name), ...fileFacts(full, { hash: fs.statSync(full).size < 8 * 1024 * 1024 }) });
    }
  };
  walk(dir);
  return {
    generatedAt: new Date().toISOString(),
    app: { version: APP_VERSION, node: process.version, platform: process.platform, cwd: process.cwd(), dataDir: USER_DIR },
    gameFiles: paths(),
    state,
    inventory,
    log: traceOf(slug).tail(lines),
  };
}
