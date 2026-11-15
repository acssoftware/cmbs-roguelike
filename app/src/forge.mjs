// EVERY BYTE THE APP PUTS IN THE GAME.
//
// Four operations, in the order a campaign uses them:
//   1. buildCoreForce  — the player's army as a "core" .btt: what the editor's *Import Campaign
//                        Units* does, by code (FORMATO 110.1 / 111.16). Every unit gets a core id,
//                        and that id is what the game tracks from battle to battle.
//   2. buildBattle     — one battle: the core force attacking, a freshly generated defense, a map.
//   3. buildCampaign   — the .cam: header cloned from the template, roster built from the core
//                        force, two battles pointing at each other (FORMATO 111.22 / 111.27).
//   4. injectBattle    — after each battle the game forces a save; the next battle is written
//                        INTO that save (FORMATO 111.9), and the player loads it.
//
// Each one leaves its inputs and outputs in the log with size and hash, and the chatter that
// `tools/re` prints is captured into the step instead of being lost.
import fs from 'node:fs';
import path from 'node:path';
import { paths } from './settings.mjs';
import { roleOf, formationTree, isVehicleName, authoredPlan, readingOf } from './catalog.mjs';
import { applyAuthoredPlan } from './aiplan.mjs';
import {
  generateBattle, NATION_CODE, checkForce, extractSide, markAsCore, coreUnits, swapEquipment,
  writeCampaign, swapBattleInSave, writeSoldierStates, saveAnatomy,
  readCampaignPercentages, writeCampaignPercentages,
  activateCore, presentUnderMask, contentEnd, openBtt, setUnitAttributesByName, graftFormation, forceTree, readMap, resolveFormation, synthesizeUnit, insertRecord, growRoster as growRosterBytes, dismountSide, readHeadings, writeHeadings, headingTo, centreOf, readDuration, writeExtraTime, writeIntel, writeEW, writeDate, writeDaylight, writeWeather, writeTitle, writeBriefing, writeBriefingImages, writeDesignerNotes, readDesignerNotes, writeHeader, reinforceMen, rearmMen, resupplyMen, insertAmmo, resupplyUnits, vehicleLaunchers, writeLaunchers, stripCargo, writeSmoke, unitBlocks2,
  setUnitExperience, unitAttributes, fixRosterAttributes, numberSlots, orderMenlessLines, repairMenlessLines, presentInReach, resurrectVehicles, vehicleStates,
} from './re.mjs';

// Every path handed to `tools/re` must use forward slashes: its `resolver` treats a name without
// a "/" as a bare library entry, so a Windows path built with path.join would be looked up INSIDE
// the library folder and reported as missing.
export const fwd = (p) => String(p).replace(/\\/g, '/');
// A FORMACAO DA BIBLIOTECA ONDE ELA ESTA HOJE (15/11, the package): the battle path stores each enemy formation with the
// absolute path of the app folder it was drawn in. A new version extracted elsewhere (the old folder deleted) would not
// find it, so a stored path that is gone is taken from the current library by its file name.
export const inLibrary = (p) => {
  if (!p || fs.existsSync(p)) return p;
  const aqui = path.join(paths().lib, path.basename(fwd(p)));
  return fs.existsSync(aqui) ? aqui : p;
};

const libFile = (source) => fwd(path.join(paths().lib, source.endsWith('.btt') ? source : source + '.btt'));

// Who fights on foot, for the dismount step. The role table already tells a rifle squad from a
// BMP; anything that rides or flies is left exactly as it is. With no rules in hand (a scratch
// script) the library falls back to its own name test.
const ON_FOOT = new Set(['infantry', 'hq', 'atgm', 'at_inf', 'mg', 'sniper', 'recon', 'engineer', 'mortar']);
const onFoot = (nome, _categoria, rules) => !isVehicleName(nome) && ON_FOOT.has(roleOf(nome, false, rules));   // E149: o HMMWV (M2) e `mg` mas anda de carro

// The blue side of the scratch battle used to mint the core force. It is thrown away with the
// blue block; it only has to exist and be small.
const FILLER = { US: 'US - Section (Supply)', RU: 'RU - Section (Supply)' };

// 1 ------------------------------------------------------------------ the player's core force
export async function buildCoreForce({ picks, nation, enemy, mapFile, workDir, out, trace, mark = true }) {
  fs.mkdirSync(workDir, { recursive: true });
  const scratch = path.join(workDir, 'core-scratch.btt');
  const sided = path.join(workDir, 'core-side.btt');

  // THE EQUIPMENT THE PLAYER CHOSE (FORMATO 43.2, E95) is written on a COPY of the library source,
  // here, before anything else touches it. It cannot go on the finished core force: after
  // `markAsCore` the last bytes of a record are the core tail, not the choice list, and the old
  // `equipamento.indices` read them as a family without complaint. And it cannot live in the file
  // alone: `growCoreForce` rebuilds from the library every time a formation is bought, so the swap
  // is kept on the pick and redone on every build — deterministic, the same bytes every time, so the
  // moved/lost check on a rebuild stays quiet.
  const sourceOf = (p, i) => {
    if (!p.swaps?.length) return libFile(p.source);
    const tree = formationTree(p.source.endsWith('.btt') ? p.source : p.source + '.btt');
    const idOf = (key) => {
      let out = null; const walk = (n) => { if (n.key === key) out = n; n.children.forEach(walk); }; tree.roots.forEach(walk);
      if (!out) throw new Error(`equipment: ${key} is not a node of ${p.source}`);
      return out.id;
    };
    const out = fwd(path.join(workDir, `core-equip-${i}.btt`));
    const r = swapEquipment(libFile(p.source), out, p.swaps.map((s) => ({ idFormacao: idOf(s.key), grupo: s.group, para: s.to, ...(s.path ? { caminho: s.path } : {}) })));
    trace.event('core.equipment', { pick: i, source: p.source, changed: r.trocados, bytes: r.bytes, swaps: r.relato });
    return out;
  };

  const spec = {
    mapa: fwd(mapFile),
    duracao: 30,
    ataque: 'Attack',
    gruposAuto: false,
    nacaoAzul: NATION_CODE[enemy],
    nacaoVermelho: NATION_CODE[nation],
    defensor: [{ formacao: libFile(FILLER[enemy]) }],
    atacante: picks.map((p, i) => ({ formacao: sourceOf(p, i), ...(p.ausentes?.length ? { ausentes: p.ausentes } : {}) })),
  };
  // A SINGLE VEHICLE IS AN EXTRA OF ITS FORMATION (E51). Until 13/09 "attach a vehicle" bought one
  // leaf of some library battalion and hung it on the chart as a promise; in the file — and in
  // the quartermaster after battle one — it was its own battalion, cut to one machine. What the
  // game does with a single vehicle is put it INSIDE the formation, and so does the generator's
  // synthesizer (FORMATO 98: a record made from the library's mold, inserted as the last child of
  // the chosen formation, proven in game with a Breach Team and an Abrams inside a platoon). The
  // extras go in here, on the player's side, before the side is extracted and marked core — so
  // the vehicle gets a core id and a roster line like everything else. Grafting an existing
  // record (section 56) is what crashes; this is not that.
  const EXPERIENCE = ['Conscript', 'Green', 'Regular', 'Veteran', 'Crack', 'Elite'];
  // Where the record is born does not matter: every battle repositions the whole force inside
  // its own setup zone. So the extras get the middle of the map rather than a tile of the scratch
  // battle's red zone, which on a narrow map may not offer one (E51: Village-Forest 057r).
  const centro = (() => { try { const m = readMap(mapFile); return { x: m.W * 4, y: m.H * 4 }; } catch { return { x: 200, y: 200 }; } })();
  const extras = picks.flatMap((p, i) => (p.extras || []).map((e, k) => ({
    tipo: e.tipo, lado: 'vermelho', topo: i, em: e.em || [], avulso: true,
    ...(e.type ? { par: e.type } : {}),
    atributos: { exp: Math.max(0, EXPERIENCE.indexOf(e.experience || 'Regular')) },
    posicao: { x: centro.x + 8 * k, y: centro.y + 8 * i },
    custo: 100,
  })));
  if (extras.length) spec.extras = extras;

  trace.read('core.map', mapFile);
  for (const p of picks) trace.read('core.source', libFile(p.source));
  await trace.step('core.generate', { spec }, () => generateBattle(spec, scratch));
  await trace.step('core.extractSide', { side: 'vermelho' }, () => extractSide(scratch, sided, 'vermelho'));
  // `mark: false` para o enxerto: o doador tem de chegar SEM cauda core, porque a cauda carrega o
  // id e o enxerto renumera os registros. Marcar vem depois, no arquivo ja enxertado, onde o
  // `marcarCore` pula o que ja e core (`jaCore`) e escreve so a cauda dos novos.
  if (!mark) { fs.copyFileSync(sided, out); trace.wrote('core.sided', out); return { file: out, units: [] }; }
  const marked = await trace.step('core.markAsCore', {}, () => markAsCore(sided, out));
  const units = coreUnits(out);
  trace.wrote('core.force', out);
  trace.event('core.ready', {
    unitsInRoster: units.length,
    coreIdRange: units.length ? [units[0].coreId, units[units.length - 1].coreId] : null,
    marked: marked && typeof marked === 'object' ? { ...marked, R: undefined } : marked,
  });
  if (!units.length) throw new Error('the core force came out with no core units — markAsCore did not tag anything');
  return { file: out, units };
}

// 1b -------------------------------------------------- a formation bought after battle one
// Until E14 (FORMATO 112.8) a campaign could only ever field what went into the file on the day it
// was created. It can now be grown — and since E103 it is grown by GRAFTING (FORMATO 125): the new
// formation's records are appended at the END of the force that already exists, taking ids after
// the last one, and not a single byte of what was already there is rewritten.
//
// Why it is not a rebuild any more. Composing the library again with one more pick at the end kept
// the old ids only as long as the file's order kept them: an ATTACHED vehicle (`pick.extras`, E51)
// is written by the generator after ALL formations, so the new formation landed in front of it and
// the Urals the author had attached slid from 172-174 to 175-177. The core id IS the record id, so they
// changed identity, the guard below refused — correctly — and recruiting was impossible for as long
// as anything was attached. Grafting has nothing to slide.
//
// The donor is built by `buildCoreForce` itself, with `mark: false`: the pruning, the equipment
// swaps and the attached vehicles all go through the proven path, and it stops one step short of
// `markAsCore` because the graft renumbers what it copies and the core tail carries the id.
// Marking happens after, on the grafted file, where `marcarCore` skips what is already core.
//
// The moved/lost guard STAYS. It is cheap, it is the invariant the whole campaign rests on, and
// the graft proving it by construction is no reason to stop measuring it.
//
// WHAT "JUST BOUGHT" MEANS (E55). The build adds the WHOLE formation — the generator prunes by
// masking, so every unit of the new source is in the file, most of them absent — and the first
// version switched on every added unit. the author recruited a US Combined Arms battalion, kept one
// Abrams and one Bradley platoon, and battle 3 opened with the 170 Americans of the whole
// battalion in his setup zone. What he bought is the added units the pruned build left PRESENT,
// minus the ones he switched off one by one inside a kept formation (`dropped`, keyed the way the
// creation path keys them — pick index, then the leaf's path in its source).
//
// THE VEHICLE ATTACHED TO A FORMATION THAT IS ALREADY HIS (30/10, autor: "comprei o caminhao dentro do pelotao de
// grenade launcher, mas ele aparece dentro do pelotao de engenharia"). Until now that attach bought the cheapest free
// copy in the library and grafted its whole source; the machine fought wherever that copy lived. Now it is synthesized
// the E51 way (`sintetizarPorNome`, the library mold, at its level) and inserted as the LAST CHILD of the chosen
// formation (`inserirRegistro`: id max + 1, the editor's own rule, child counter, N and A). No existing record moves,
// and since the core id is the record id the guard below still holds. `attachOwned`:
// [{ topo, caminho: ['Platoon (Grenade Launcher)', ...], tipo, type, experience }] — `topo` is the top formation of
// the force (one per pick), `caminho` the formation names down to the target, `#n` for the nth of a name.
const EXPERIENCIA = ['Conscript', 'Green', 'Regular', 'Veteran', 'Crack', 'Elite'];
export async function growCoreForce({ picks, newPicks, nation, enemy, mapFile, workDir, out, before, present, dropped = [], coreFile = null, attachOwned = [], trace }) {
  fs.mkdirSync(workDir, { recursive: true });
  const grown = path.join(workDir, 'core-grown.btt');

  if (coreFile && fs.existsSync(coreFile)) {
    let current = coreFile;
    for (let k = 0; k < newPicks.length; k++) {
      const p = newPicks[k];
      const donorDir = path.join(workDir, `graft-${k}`);
      const donor = path.join(donorDir, 'donor.btt');
      await buildCoreForce({ picks: [p], nation, enemy, mapFile, workDir: donorDir, out: donor, trace, mark: false });
      const next = path.join(workDir, `core-graft-${k}.btt`);
      const r = await trace.step('core.graft', { source: p.source }, () => graftFormation(current, donor, next));
      trace.event('core.grafted', { source: p.source, ...r });
      current = next;
    }
    for (let k = 0; k < attachOwned.length; k++) {
      const e = attachOwned[k];
      const X = openBtt(current); const A = forceTree(X);
      const lado = A.azul.length ? 'azul' : 'vermelho';
      const destino = { lado, topo: e.topo, caminho: e.caminho || [] };
      const no = resolveFormation(A, destino);
      const carga = await synthesizeUnit(X, no, e.tipo, { ...(e.type ? { par: e.type } : {}), atributos: { exp: Math.max(0, EXPERIENCIA.indexOf(e.experience || 'Regular')) }, avulso: true });
      const centro = (() => { try { const m = readMap(mapFile); return { x: m.W * 4, y: m.H * 4 }; } catch { return { x: 200, y: 200 }; } })();
      const next = path.join(workDir, `core-attach-${k}.btt`);
      const r = await trace.step('core.attach', { tipo: e.tipo, em: [e.topo, ...destino.caminho].join(' / ') },
        () => insertRecord(current, carga.bytes, destino, next, { custo: 100, offPosicao: carga.offPos, posicao: { x: centro.x + 8 * k, y: centro.y } }));
      const ck = checkForce(next);
      if (!ck.ok) throw new Error(`attaching ${e.tipo}: the force failed its check — ${ck.erros.slice(0, 2).join('; ')}`);
      trace.event('core.attached', { tipo: carga.nome, id: r.id, destino: r.destino, filhos: r.filhos, fonte: carga.fonte });
      current = next;
    }
    await trace.step('core.markAsCore', { grafted: newPicks.length, attached: attachOwned.length }, () => markAsCore(current, grown));
  } else {
    if (attachOwned.length) throw new Error('a vehicle is attached to a formation already in the force only on top of the force file, and there is none');
    // No force file in hand — a scratch script, or a campaign from before the graft existed. The
    // old path composes the whole force from the library again; it is correct whenever nothing is
    // attached, and the guard below is what says whether it was.
    await buildCoreForce({ picks: [...picks, ...newPicks], nation, enemy, mapFile, workDir, out: grown, trace });
  }

  const after = unitDirectory(grown);
  const wasById = new Map(before.map((u) => [u.coreId, u]));
  const moved = after.filter((u) => wasById.has(u.coreId) && (wasById.get(u.coreId).name !== u.name || String(wasById.get(u.coreId).type) !== String(u.type)));
  const lost = before.filter((u) => !after.some((x) => x.coreId === u.coreId));
  const added = after.filter((u) => !wasById.has(u.coreId));
  trace.event('core.grow', {
    before: before.length, after: after.length, added: added.length,
    addedUnits: added.map((u) => ({ coreId: u.coreId, name: u.name, formation: u.formation })),
    moved: moved.length, lost: lost.length,
  });
  if (moved.length || lost.length) {
    throw new Error(`adding a formation moved ${moved.length} existing core ids and lost ${lost.length}: the campaign in progress could not survive it`);
  }
  if (!added.length) throw new Error('the formation added no core unit');

  // Exactly what the campaign says is fielded, plus what was just bought: present in the pruned
  // build, and not switched off one by one.
  const droppedKeys = new Set(dropped);
  const bought = added.filter((u) => u.present && !droppedKeys.has(u.key));
  const on = [...present, ...bought.map((u) => u.coreId)];
  const off = after.filter((u) => !on.includes(u.coreId)).map((u) => u.coreId);
  trace.event('core.bought', {
    added: added.length, present: added.filter((u) => u.present).length, dropped: added.filter((u) => u.present && droppedKeys.has(u.key)).length, fielded: bought.length,
    units: bought.map((u) => ({ coreId: u.coreId, name: u.name, formation: u.formation })),
  });
  const step1 = path.join(workDir, 'core-grown-on.btt');
  activateCore(grown, step1, on, { presente: true });
  activateCore(step1, out, off, { presente: false });
  const final = unitDirectory(out);
  trace.wrote('core.grown', out);
  trace.event('core.grownReady', { units: final.length, fielded: final.filter((u) => u.present).length });
  return { file: out, units: final, added, bought };
}

// 1c ---------------------------------------------------------------- soft factors, unit by unit
// The core force is rebuilt from the library every time a formation is bought, so what a unit IS
// cannot live in the file alone: it is kept in the campaign state by CORE ID — the one key that
// survives a rebuild — and written again over every rebuild (FORMATO 112.13). The core force is
// the authority: the battle file inherits it through the transplant, and the campaign roster is
// copied from it (FORMATO 112.12), so writing here reaches everywhere the game looks.
export function applyAttributes({ coreFile, out, byCoreId, trace }) {
  const alvos = {};
  for (const [id, campos] of Object.entries(byCoreId || {})) {
    const limpo = Object.fromEntries(Object.entries(campos || {}).filter(([, v]) => v));
    if (Object.keys(limpo).length) alvos[Number(id)] = limpo;
  }
  if (!Object.keys(alvos).length) return null;
  const r = setUnitExperience(coreFile, out, alvos);
  trace.event('core.attributes', {
    units: r.escritos,
    examples: (r.exemplos || []).map((e) => `${e.nome}: ${e.antes.experiencia}/${e.antes.motivacao} -> ${e.agora.experiencia}/${e.agora.motivacao}`),
  });
  return r;
}

// The save the game just wrote carries its own copy of the soft factors, from before this battle's
// promotions. Re-derived from the core force, which is the authority — same write path as the
// roster growth (FORMATO 112.8), with the record count and the men checked on the written file.
// `presenceFile` is the battle itself: who is in THIS battle (a dormant unit recruited from the arsenal is present there and
// absent in the core force), which is what the line-in-reach step needs.
export function syncRosterAttributes({ save, out, coreFile, presenceFile = null, trace, visibleLines = null }) {
  // FIRST, A MENLESS LINE THE GAME WROTE CORRUPTED GOES BACK TO A CLEAN ONE (08/11, US b10 -> b11): the M777 platoon the game
  // refused in b10 came back as a 3 MB line, and the next save died at 5% with "Out of memory" (roster.sanearSemHomens).
  const tmp0 = out + '.clean';
  const s = repairMenlessLines(save, tmp0);
  trace.event('roster.menlessRepaired', { lines: s.trocadas, ...(s.erro ? { error: s.erro } : {}) });
  const r = fixRosterAttributes(tmp0, out, coreFile);
  fs.rmSync(tmp0, { force: true });
  trace.wrote('roster.attributes', out);
  trace.event('roster.attributes', { units: r.unidades, changed: r.mudados, withoutOwner: r.semDono });
  // AND EVERY BLANK BLOCK GETS ITS PLACE IN THE FORMATION (E141). The game fills only the block whose slots name the
  // unit's place; the templates said 1 for every sibling, so the second and third of a platoon never got their men
  // (E83) and never took a loss. Blocks the game already filled are left alone.
  const tmp = out + '.slots';
  const v = numberSlots(out, tmp, coreFile);
  fs.renameSync(tmp, out);
  trace.event('roster.slots', { renumbered: v.mudados.length });
  // AND EVERY PRESENT UNIT'S LINE WHERE THE GAME READS IT (08/11, US b11): the US game sees only the first ~501 lines; the
  // Apache bought after b10 sat at 503-504 and never came (roster.presentesNoAlcance).
  if (visibleLines) {
    const tmp1 = out + '.reach';
    const a = presentInReach(out, tmp1, presenceFile || coreFile, visibleLines);
    fs.renameSync(tmp1, out);
    trace.event('roster.inReach', { limit: visibleLines, moved: a.movidas, ...(a.erro ? { error: a.erro } : {}) });
  }
  // AND THE LINES OF UNITS WITHOUT MEN IN THE ORDER THE GAME MATCHES THEM (08/11, US b10): the game pairs an off-map piece
  // with the k-th roster line of its type, so the present ones go first, in force order (roster.ordenarSemHomens).
  const tmp2 = out + '.order';
  const o = orderMenlessLines(out, tmp2, presenceFile || coreFile);
  fs.renameSync(tmp2, out);
  trace.event('roster.menlessOrder', { types: o.tipos, ...(o.erro ? { error: o.erro } : {}) });
  return r;
}

// The other half of the same purchase: the save carries the roster, and a core unit with no line
// in it crashes the game on load (FORMATO 112.1). `growRoster` clones a dormant block of the same
// type from this very save — the game's own shape, not the .cam template — and raises the count.
export function growSaveRoster({ save, out, units, coreFile, typeTable, trace }) {
  trace.read('roster.grow.save', save);
  // The block also carries the unit's soft factors, and a cloned one carries the DONOR's. The real
  // ones come from the core force, by core id (FORMATO 112.12).
  const core = new Map(coreFile ? coreUnits(coreFile).map((u) => [u.coreId, u]) : []);
  const r = growRosterBytes(save, out, units.map((u) => ({ coreId: u.coreId, val: u.type[0], tab: u.type[1], nome: u.name, atributos: core.get(u.coreId)?.atributos, b8: core.get(u.coreId)?.b8 })), typeTable);
  trace.wrote('roster.grown', out);
  trace.event('roster.grow', { from: r.antes, to: r.depois, added: r.acrescentados, rosterBytes: r.roster });
  return r;
}

// WHO IS WHO. The save only knows a unit by its core id; the name, what it actually is (a Javelin
// team, a headquarters, a Bradley) and where it sits in the order of battle live in the core force
// file. Read once at creation and kept in the campaign state, this directory is what turns a table
// of numbers into something a player can read — and it is also the shop window for purchases.
function directoryFrom(X, roots) {
  const c = X.completo;
  const out = [];
  const label = (node, siblings) => {
    const bruto = node.r.nm || '(unnamed)';
    const same = siblings.filter((s) => (s.r.nm || '(unnamed)') === bruto);
    // o nome ambiguo do catalogo vira a leitura do lugar onde a unidade esta (06/11, catalog.mjs readingOf)
    const name = readingOf(bruto, c[node.r.c + 12] === 0x50 || c[node.r.c + 12] === 0x58);
    return same.length > 1 ? `${name} #${same.indexOf(node) + 1}` : name;
  };
  const walk = (node, siblings, trail, key) => {
    const r = node.r;
    if (r.form) { node.filhos.forEach((f, i) => walk(f, node.filhos, [...trail, label(node, siblings)], `${key}.${i}`)); return; }
    if (c[r.c + 12] === 0x60) return;                 // same exclusion the roster uses
    let core = null;
    try {
      const i = contentEnd(c, r, X.R[node.i + 1] ? X.R[node.i + 1].c : c.length);
      if (i.core) core = { id: c.readUInt32LE(i.fim), present: c[i.fim + 4] === 1 };
    } catch { /* unreadable shape: still worth listing by name */ }
    out.push({
      // The key places the unit in the tree of the source it came from, so a selection made on
      // screen can be turned back into a core id after the force exists.
      key,
      coreId: core ? core.id : null,
      name: label(node, siblings),
      formation: trail.join(' / '),
      type: [r.val, r.tab],
      offMap: c[r.c + 12] === 0x50 || c[r.c + 12] === 0x58,
      // What this unit IS, after any choice the player made and paid for.
      experience: unitAttributes(c, r.c).experiencia,
      leadership: unitAttributes(c, r.c).lideranca,
      // A core unit is fielded when its tail says so; a plain one, when it is not marked absent.
      present: core ? core.present : !r.ausente,
      // A Single Vehicle of the editor (17/10): bit 0x02 of +11 (3 against 1 in the editor's files, 2 against 0 once the
      // force is minted — bit 0 is cleared on the way; measured on 6995 LIB units and 2816 core units). Own price key.
      single: (c[r.c + 11] & 0x02) !== 0,
    });
  };
  roots.forEach((t, i) => walk(t, roots, [], String(i)));
  return { units: out, roots: roots.length };
}

export function unitDirectory(coreFile) {
  const X = openBtt(coreFile);
  const d = directoryFrom(X, forceTree(X).topos);
  const units = d.units.filter((u) => u.coreId !== null).sort((a, b) => a.coreId - b.coreId);
  units.roots = d.roots;
  return units;
}

// WHAT HE ACTUALLY FACED. The enemy has no roster — the game only tracks the player's core force —
// so its losses are known in aggregate (the AAR) and never unit by unit. Its ORDER OF BATTLE, on
// the other hand, is fully known: the app built it. Read from the blue block of the delivered .btt
// rather than from the plan, so what is shown is what shipped.
export function enemyDirectory(bttFile) {
  const X = openBtt(bttFile);
  return directoryFrom(X, forceTree(X).azul).units.filter((u) => u.present);
}

// Switching bought units on, for the battle about to be generated.
//
// A UNIT IS NOT ENOUGH; ITS FORMATION HAS THE SAME BIT (FORMATO 112.14). Pruning at creation masks a
// sub-formation whole — the platoon record and every child — and the game hides the whole subtree.
// the author bought an engineer platoon after battle one and it never showed up: five units switched on
// under a platoon still masked. `activateCore` now unmasks the ancestors, and this refuses to hand
// over a force where any unit is on under a mask, which is the check that would have caught it.
export function activateUnits({ coreFile, out, ids, present = true, trace }) {
  const r = activateCore(coreFile, out, ids, { presente: present });
  trace.wrote(present ? 'core.activated' : 'core.deactivated', out);
  trace.event('core.activate', { present, asked: [...ids], changed: r.mudados, alreadySo: r.jaAssim, notFound: r.naoAchados, formationsUnmasked: r.formacoes || [] });
  if (r.naoAchados.length) throw new Error(`core ids not found in the force: ${r.naoAchados.join(', ')}`);
  const hidden = presentUnderMask(out);
  if (hidden.length) {
    trace.event('core.hiddenUnderMask', { units: hidden });
    throw new Error(`${hidden.length} unit(s) switched on under a masked formation, which the game hides whole: ${hidden.slice(0, 3).map((h) => `${h.nome} (core ${h.coreId}) in ${h.formacao}`).join('; ')}`);
  }
  return r;
}

// The identity of a map, read the same way before and after the transplant.
function mapShape(file) {
  const m = readMap(file);
  // AND WHERE THE MAP ENDS (05/10/2026, E146): on the Hills-Open-Water 255 Meet the transplant took the wrong end-of-map
  // marker (variant 01 7b, the only one among 360 maps) and dropped 1,060 bytes of map — size, grid, buildings and AI
  // all still matched, and the game crashed before the briefing with any force. The marker must not move.
  let mapEnd = null; try { mapEnd = openBtt(file).m; } catch { /* unreadable: the other fields decide */ }
  return { W: m.W, H: m.H, OX: m.OX, OY: m.OY, buildings: m.construcoes.length, gridStart: m.gridStart, gridEnd: m.fimGrade, aiAgrees: m.iaConfere, mapEnd };
}

// 2 ------------------------------------------------------------------------------ one battle
// `aiGroups: false` leaves every unit in the group the library gave it (for a plan that assigns groups itself, as
// tools/re/ia_agrupar.mjs does); `attacker` replaces the player's side with other formations (a test battle).
// `aiPlan` (E174): 'auto' = on a map whose AI plan the author reviewed (app/data/planos_ia.json) every enemy unit goes to the
// group of its role and into that group's Setup zone (app/src/aiplan.mjs), anywhere else the round-robin as before;
// true forces it (the ZZ IA scripts), false never. `rules.defense.aiPlan.on === false` turns 'auto' off.
// `meet` (12/10/2026, the Meeting Engagement): `{ variant, plan, shares, sourceMap, key }` — the AI plan variant drawn for this
// battle (app/src/meet.mjs). `mapFile` is then the temporary copy whose blue plan `plan` is the only one used; the units go to
// the attacker's groups (meetGroups) inside that plan's Setup zones, and nobody is dismounted: the enemy rides.
export async function buildBattle({ coreFile, defense, mapFile, duration, nation, enemy, out, rules, trace, attack = 'Attack', title, briefing = null, header = null, images = null, aiGroups = true, attacker = null, aiPlan = 'auto', meet = null, earlyIntel = null, ew = null, time = null, date = null, weather = null }) {
  const reviewed = aiPlan === true || !!meet || (aiPlan === 'auto' && rules?.defense?.aiPlan?.on !== false && !!authoredPlan(mapFile));
  const encontro = /^meet/i.test(String(attack));
  if (reviewed) aiGroups = false;   // the round-robin would only be overwritten
  const spec = {
    mapa: fwd(mapFile),
    duracao: duration,
    // The battle type written to the file: "Red Attack" for every common battle (23/10: the app keeps only the Attack
    // version of each quick-battle map — the three versions were the same map) and "Meeting Engagement" for an encounter.
    // 'Meet' is the census kind of a Meeting Engagement map (E146): both sides attack, the type byte has no side.
    ataque: ['Probe', 'Attack', 'Assault'].includes(attack) ? attack : /^meet/i.test(String(attack)) ? 'Meeting Engagement' : 'Attack',
    gruposAuto: aiGroups,
    // The player always attacks, and the attacker is the red side on a quick-battle map
    // (FORMATO 68); the defense holds the blue setup zone with the map's own AI plans.
    nacaoAzul: NATION_CODE[enemy],
    nacaoVermelho: NATION_CODE[nation],
    defensor: defense.formations.map((f) => ({ ...f, formacao: fwd(inLibrary(f.formacao)) })),
    atacante: attacker ? attacker.map((f) => ({ ...f, formacao: fwd(f.formacao) })) : [{ formacao: fwd(coreFile) }],
  };
  trace.read('battle.map', mapFile);
  trace.read('battle.core', coreFile);
  const mapBefore = mapShape(mapFile);
  await trace.step('battle.generate', { spec }, () => generateBattle(spec, out));

  // THE REVIEWED AI PLAN (E174): role -> group -> the group's Setup zone. Before the dismount (which reads where the
  // carriers are) and before the headings (which need the final positions).
  let aiPlanReport = { authored: false };
  if (reviewed) {
    aiPlanReport = await trace.step('battle.aiPlan', { map: path.basename(mapFile) }, () => applyAuthoredPlan({ battle: out, mapFile, rules, meet }));
    trace.event('battle.aiPlan', { authored: true, key: aiPlanReport.key, plan: aiPlanReport.plan, meet: aiPlanReport.meet, units: aiPlanReport.units, noZone: aiPlanReport.noZone,
      groups: Object.fromEntries(Object.entries(aiPlanReport.groups).map(([g, v]) => [g, v.units.length])) });
  }

  // THE ENEMY FIGHTS ON FOOT. Left mounted, the AI parks the carrier somewhere sensible and then
  // drops the squad underneath it, in the open, where it can neither take cover nor spring an
  // ambush — the author's complaint, and the reason a defense reads as passive. Dismounting at setup is
  // what a defender would have done anyway. Written the way the editor writes it: the Vehicle
  // Status of the foot units AND of the formations above them, vehicles untouched (FORMATO 112.11,
  // proven in game by E20).
  // ... EXCEPT IN A MEETING ENGAGEMENT (autor, 12/10: "nao teremos soldados a pe no setup, todos estarao montados"): the
  // enemy attacks, and the game seats every foot unit in the vehicles of its own platoon when nothing dismounts it (E17).
  if (encontro && rules?.meet?.dismount === false) trace.event('battle.dismounted', { units: 0, note: 'meeting engagement: the enemy rides' });
  else if (rules?.defense?.dismountInfantry?.on !== false) {
    const dismounted = path.join(path.dirname(out), path.basename(out, '.btt') + '-dismounted.btt');
    const r = await trace.step('battle.dismount', { side: 'azul' },
      () => dismountSide(out, dismounted, 'azul', rules ? { aPe: (n, cat) => onFoot(n, cat, rules) } : {}));
    if (r.mudou) {
      fs.copyFileSync(dismounted, out);
      trace.event('battle.dismounted', { units: r.unidades.length, formations: r.formacoes.length, vehiclesLeftMounted: r.veiculos });
    } else {
      trace.event('battle.dismounted', { units: 0, note: 'no foot unit in the defense' });
    }
    fs.rmSync(dismounted, { force: true });
  }

  // O TANQUE DA ESCADA (18/10, autor): o gerador da a experiencia do tier a defesa inteira, por formacao; o carro de combate
  // comprado num nivel diferente (defense.tankLadder) e reescrito por unidade.
  for (const a of defense.unitAttributes || []) {
    const comTripulacao = path.join(path.dirname(out), path.basename(out, '.btt') + '-crews.btt');
    const r = await trace.step('battle.tankCrews', { side: a.side, name: a.name, experience: a.experiencia },
      () => setUnitAttributesByName(out, comTripulacao, a.side, a.name, { experiencia: a.experiencia }));
    fs.copyFileSync(comTripulacao, out);
    fs.rmSync(comTripulacao, { force: true });
    trace.event('battle.tankCrews', { name: a.name, experience: a.experiencia, records: r.registros });
  }

  // THE ENEMY FACES THE PLAYER (02/10). The generator writes x and y and leaves the heading the library
  // had — 0 in practically every record —, so every enemy vehicle looked the same way (autor: "to the
  // right of the deployment zone"). Each placed enemy unit now points at the centre of the player's
  // placed units, which the generator put inside the player's setup zone. The heading is the f32
  // before x,y in the unit's element (FORMATO 132); the unit and the sense of rotation are rules until
  // the screen confirms them.
  const face = rules?.defense?.faceThePlayer;
  if (face?.on) {
    const all = readHeadings(out);
    const target = centreOf(all.filter((u) => u.lado === 'vermelho'));
    if (target) {
      const faced = path.join(path.dirname(out), path.basename(out, '.btt') + '-faced.btt');
      const toUnit = (rad) => { const a = face.sense === -1 ? (2 * Math.PI - rad) % (2 * Math.PI) : rad; return face.unit === 'deg' ? a * 180 / Math.PI : a; };
      const r = await trace.step('battle.face', { target }, () => writeHeadings(out, faced, (u, e) => (u.lado === 'azul' && !u.ausente ? toUnit(headingTo(e, target)) : null)));
      fs.copyFileSync(faced, out); fs.rmSync(faced, { force: true });
      trace.event('battle.faced', { units: r.unidades, elements: r.elementos, target: { x: Math.round(target.x), y: Math.round(target.y) }, unit: face.unit || 'rad', sense: face.sense || 1 });
    } else trace.event('battle.faced', { units: 0, note: 'no placed player unit to face' });
  }

  // THE CLOCK, ON THE DELIVERED FILE. The duration lives in two places and only one of them is
  // the clock that runs (FORMATO 50, E25): the header byte is what the load screen announces, and a
  // second copy inside the block is what the battle actually uses. Writing only the header is what
  // gave autor a briefing that promised one hour and a battle that ran the map's thirty minutes.
  {
    const d = readDuration(out);
    trace.event('battle.duration', { asked: duration, header: d.cabecalho, block: d.bloco });
    if (d.cabecalho !== duration || d.bloco !== duration) {
      throw new Error(`the battle was written with ${duration} minutes but the file says ${d.cabecalho} in the header and ${d.bloco} in the block — the clock the game runs is the second one`);
    }
  }

  // THE VARIABLE EXTRA TIME comes with the map (9 of the 86 of each kind carry 5 or 15 minutes, and
  // battle 5 of EASY2 went out with 0-5). the author's call on 07/09: none. It lives only in the copy
  // inside the block, two bytes after the clock (FORMATO 50.1).
  {
    const want = rules?.duration?.extraTime ?? 0;
    const x = writeExtraTime(out, want);
    trace.event('battle.extraTime', { asked: want, was: x.antes, changed: x.mudou });
  }

  // EARLY INTEL / INTEL STRENGTH (aba Data do editor, 17/10): o lado que ve os contatos inimigos no setup e quanto ve.
  // Toda batalha grava o campo — sem compra, Neither/0, porque o mapa da biblioteca pode trazer outro valor.
  {
    const want = earlyIntel ?? { lado: 'Neither', forca: 0 };
    const x = writeIntel(out, want);
    trace.event('battle.intel', { asked: want, side: x.lado, strength: x.forca });
  }

  // A GUERRA ELETRONICA (17/10): Blue/Red Electronic Warfare Strength, no cabecalho da forca. Toda batalha grava os dois —
  // sem nada, None/None, porque cenarios dos devs trazem Red Light.
  {
    const want = ew ?? { azul: 'None', vermelho: 'None' };
    const x = writeEW(out, want);
    trace.event('battle.ew', { asked: want, blue: x.azul, red: x.vermelho });
  }

  // A DATA E A HORA DA BATALHA (17/10): o dia do calendario da campanha e a hora do no do caminho (ou a da troca de luz
  // comprada); e a hora que acende ou apaga o mapa, e o Daylight vai junto, coerente. O que nao vier fica como no mapa.
  if (time || date) {
    const d = writeDate(out, { ...(date ? { mes: date.month, dia: date.day } : {}), ...(time ? { minutos: time.minutes } : {}) });
    const l = time ? writeDaylight(out, time.daylight) : null;
    trace.event('battle.date', { date: date?.label ?? null, period: time?.period ?? null, hour: time?.hour ?? null, was: d.antes, daylight: l ? { was: l.antes, now: l.agora } : null });
  }

  // O CLIMA (17/10): o perfil sorteado no no (Weather, vento, temperatura, chao) e a direcao do vento. Sem perfil, o do mapa.
  if (weather) {
    const c = writeWeather(out, { weather: weather.weather, windStrength: weather.wind, windSource: weather.windSource, temperature: weather.temp, ground: weather.ground });
    trace.event('battle.weather', { profile: weather.id, label: weather.label, was: c.antes });
  }

  // THE TITLE the briefing shows ("Briefing: <title>"). It came from the map; the campaign can now
  // name its battle. The header is read in sequence, so any length works (tipo_batalha.escreverTitulo).
  // THE LIST HEADER (17/10, proven in game): with `header` = { descricao, bmp } the title, a description (the lists show
  // three lines) and the 170x170 picture of the scenario list and the saved-game screen (a save keeps its battle's header).
  // (29/10) o cabecalho e as imagens sao cosmeticos: uma falha ao grava-los vira evento e a batalha segue com o que o
  // mapa ja tinha (os dois gravam num temporario e so trocam o arquivo depois de conferir)
  let cabecalhoOk = false;
  if (header) {
    try {
      const h = writeHeader(out, { titulo: String(title || 'CMBS Roguelike').replace(/[^ -~]/g, '').slice(0, 64), descricao: header.descricao, bmp: header.bmp });
      trace.event('battle.header', { title: h.titulo, lines: h.descricao.split('\r\n').length, image: h.imagem });
      cabecalhoOk = true;
    } catch (e) { trace.event('battle.headerSkipped', { reason: e.message.slice(0, 160) }); }
  }
  if (!cabecalhoOk && title) {
    const t = writeTitle(out, String(title).replace(/[^ -~]/g, '').slice(0, 64));
    trace.event('battle.title', { from: t.antes, to: t.agora });
  }

  // THE BRIEFING (28/09). Block 0 carries the six sections of each side, and the generator copied the
  // map's — battle 2 of a test campaign opened with a Soviet major warning of "German tanks". The
  // campaign writes the player's (red) sections and blanks the AI's; an empty section is not shown.
  // The Designer's Notes (01/11) ride in the same block: the 040r map carried a 1944 story there and the battle showed it.
  // They always leave blank, in the briefing's own pass when there is one.
  if (briefing) {
    const b = writeBriefing(out, { ...briefing, notas: '' });
    trace.event('battle.briefing', { was: b.antes.vermelho.map((s) => s.length), now: b.agora.vermelho.map((s) => s.length) });
  } else if (readDesignerNotes(out)) {
    const n = writeDesignerNotes(out, '');
    trace.event('battle.designerNotes', { was: n.antes, now: n.agora });
  }
  // THE BRIEFING PICTURES (17/10, proven in game): `images` = { estrategico 224x224, operacional 702x224, tatico 952x350 }
  // (any of them may be missing). The same three on both sides: the game showed the player the first set.
  if (images && (images.estrategico || images.operacional || images.tatico)) {
    const q = { 0: images.estrategico, 1: images.operacional, 2: images.tatico, 3: images.estrategico, 4: images.operacional, 5: images.tatico };
    for (const k of Object.keys(q)) if (!q[k]) delete q[k];
    try {
      const r = writeBriefingImages(out, q);
      trace.event('battle.images', { images: r.imagens.map((d) => (d ? d.slice(0, 2).join('x') : null)) });
    } catch (e) { trace.event('battle.imageSkipped', { image: 'briefing', reason: e.message.slice(0, 160) }); }
  }

  const check = checkForce(out);
  // And nothing fielded under a masked formation — the structural check passed the battle that hid
  // the author's engineer platoon (FORMATO 112.14), so it is a check of its own.
  const hidden = presentUnderMask(out);
  const errors = [...(check.erros || []), ...hidden.map((h) => `${h.nome} (id ${h.id}${h.coreId !== null ? `, core ${h.coreId}` : ''}) is on under the masked formation ${h.formacao}`)];
  trace.wrote('battle.btt', out);
  trace.event('battle.checked', { ok: check.ok && !hidden.length, errors: errors.slice(0, 10) });
  if (errors.length) throw new Error(`the generated battle failed the structural check: ${errors.slice(0, 3).join(' | ')}`);

  // THE MAP MUST COME OUT OF THE TRANSPLANT UNTOUCHED. On five of the 86 maps the force header is
  // unreadable, the end-of-map marker is found in the wrong place, and the map lands in the output
  // shifted by a byte or two — the force still passes every structural check and the game dies on
  // load (FORMATO 112.5). Reading the map back out of the delivered file catches it every time.
  const mapAfter = mapShape(out);
  const mapKept = JSON.stringify(mapBefore) === JSON.stringify(mapAfter);
  trace.event('battle.mapKept', { ok: mapKept, ...(mapKept ? {} : { before: mapBefore, after: mapAfter }) });
  if (!mapKept) {
    const e = new Error(`the transplant damaged the map: ${JSON.stringify(mapBefore)} became ${JSON.stringify(mapAfter)}. This map cannot be used.`);
    e.badMap = true;
    throw e;
  }
  return { file: out, spec, check, aiPlan: aiPlanReport };
}

// 3 ------------------------------------------------------------------------------- the .cam
export async function buildCampaign({ coreFile, battles, out, percentages = null, trace }) {
  const template = paths().campaignTemplate;
  const typeTable = JSON.parse(fs.readFileSync(paths().typeTable, 'utf8'));
  trace.read('campaign.template', template);
  trace.read('campaign.typeTable', paths().typeTable);
  const result = await trace.step('campaign.write', { battles: battles.map((b) => b.nome) }, () =>
    writeCampaign({ modelo: template, core: coreFile, batalhas: battles.map((b) => (percentages ? { ...b, pct: percentages } : b)), saida: out, tabela: typeTable }));
  trace.wrote('campaign.cam', out);
  trace.event('campaign.ready', {
    rosterUnits: result.unidades,
    typesWithoutTemplate: (result.faltando || []).map((u) => `${u.nome} [${u.val},${u.tab}]`),
    battles: result.batalhas,
  });
  // FATAL, and the reason the first campaign the app ever wrote crashed the game (06/09): the
  // roster must carry a line for every core unit. Ten of them had no template and the game died
  // on load. The campaign that worked before the app existed had 142 core units and 142 lines.
  if (result.faltando?.length) {
    const names = [...new Set(result.faltando.map((u) => `${u.nome} [${u.val},${u.tab}]`))];
    throw new Error(`the roster is missing ${result.faltando.length} of the core units: ${names.join('; ')}. A campaign like this crashes the game on load.`);
  }
  const covered = coreUnits(coreFile).length;
  trace.event('campaign.rosterCheck', { coreUnits: covered, rosterUnits: result.unidades, ok: covered === result.unidades });
  if (covered !== result.unidades) throw new Error(`the roster has ${result.unidades} lines for ${covered} core units — they must match`);
  return result;
}

// 4 -------------------------------------------------------- the next battle, inside the save
//
// The save carries the campaign's eight percentages as well, one copy per embedded battle, and they
// are rewritten here from the rules on every injection. That is deliberate: a campaign started
// before the app knew about them heals itself at the next battle instead of limping to the end with
// the template's numbers (FORMATO 110.2).
export function injectBattle({ save, battleName, btt, out, percentages = null, trace }) {
  trace.read('inject.save', save);
  trace.read('inject.btt', btt);
  const anatomy = saveAnatomy(save);
  trace.event('inject.saveAnatomy', { campaignName: anatomy.nome, embedded: anatomy.batalhas.map((b) => ({ name: b.nome, bytes: b.tam })) });
  const r = swapBattleInSave(save, battleName, btt, out);
  if (percentages) {
    const before = readCampaignPercentages(out)[0]?.pct;
    writeCampaignPercentages(out, out, percentages);
    trace.event('inject.percentages', { from: before, to: percentages, note: 'blue refit/repair/resupply/rest, then red' });
  }
  trace.wrote('inject.result', out);
  trace.event('inject.done', { battleName, bytesBefore: r.antes, bytesAfter: r.depois, saveBytes: r.tamanho });
  return r;
}

// DAR UM PAIOL A QUEM NAO TEM NENHUM (FORMATO 113.3, provado em jogo pelo E37).
//
// O saqueado perde a lista de municao inteira. Escrever quantidade nao adianta: nao ha par onde
// escrever. Este passo INSERE o par — o registro do soldado cresce quatro bytes por item, e o jogo
// le a municao nova, inclusive no ultimo homem da unidade, que carrega o terminador `ff ff` e era o
// suspeito de ter derrubado o E28 e o E29.
//
// Roda ANTES do `resupply`: dado o par, o caminho normal cuida da quantidade daqui para a frente.
// A fracao do ressuprimento vale aqui tambem: com 0,5 o homem recebe o paiol com metade da dotacao,
// e nao um paiol cheio que o passo seguinte nao teria como reduzir (`resupply` so sobe).
export function grantAmmo({ save, out, loads, fraction = 1, trace }) {
  const escalado = {};
  for (const [i, itens] of Object.entries(loads || {})) {
    const linha = {};
    for (const [item, qtd] of Object.entries(itens)) {
      const v = Math.round(qtd * fraction);
      if (v > 0) linha[item] = Math.min(65535, v);
    }
    if (Object.keys(linha).length) escalado[i] = linha;
  }
  const r = insertAmmo(save, out, escalado);
  if (!r.homens) return r;
  trace.wrote('grantAmmo.save', out);
  trace.event('grantAmmo.done', {
    men: r.homens, items: r.itens, grew: r.cresceu, fraction,
    examples: r.detalhe.slice(0, 6).map((h) => `${h.nome}: ${h.de} -> ${h.para} item(s)`),
  });
  return r;
}

// Resupply: every man goes back to the ammunition his TO&E slot is issued (FORMATO 110.6). The
// campaign percentages say resupply 0 -- that was the template the app cloned -- and even with them
// fixed the game will not refill a save it has already written, so the app writes the numbers. Only
// quantities here, never a new item: `grantAmmo` above is the one that inserts.
// `exact` (E76): the loads are the unit's issue split man by man (`transition.poolLoads`), and a
// man above his share is written DOWN as well as up. `units` is the per-unit summary for the log,
// because "rounds" alone hid a squad going from 7457 to 12037.
export function resupply({ save, out, loads, fraction = 1, exact = false, units = null, trace }) {
  const r = resupplyMen(save, out, loads, { fracao: fraction, exato: exact });
  // `resupply.save` e `resupply.done` sao propriedades da FUNCAO, que nao existem: o log saia com o
  // nome do evento `undefined` e o ressuprimento nao aparecia no diagnostico da campanha.
  trace.wrote('resupply.save', out);
  trace.event('resupply.done', {
    men: r.homens, items: r.itens, rounds: r.balas, fraction, exact,
    ...(units ? {
      raised: units.filter((u) => u.para > u.de).length, trimmed: units.filter((u) => u.para < u.de).length,
      biggest: [...units].sort((a, b) => Math.abs(b.para - b.de) - Math.abs(a.para - a.de)).slice(0, 6)
        .map((u) => `core ${u.coreId} item ${u.item}: ${u.de} -> ${u.para}`),
    } : {}),
    examples: r.detalhe.slice(0, 6).map((h) => `${h.nome}: ${h.de} -> ${h.para} em ${h.itens} item(s)`),
  });
  return r;
}

// And the ammunition that is not carried by a man: what a vehicle or a gun holds lives in the unit
// block, in pairs of `u16 item | u16 quantity` (FORMATO 110.7). Only units the campaign says are
// fielded are touched, and only fields the harvested table recognised as ammunition.
// `names` e novo desde a E38: a tabela passou a ser indexada pelo NOME do veiculo, porque o `u16
// tipo` do roster nao serve — o MESMO obus aparece com dois ids conforme a vaga da TO&E de onde veio
// (1545 e 2057), e a forma antiga, `tipo:tamanho_do_bloco`, errava por ate um byte.
// THE LAUNCHERS A VEHICLE CARRIES for its infantry (FORMATO 131): an AT4 or a Javelin CLU in a Stryker,
// RPG-26s in a BMP. The list grows in play (a BMP of RUS1 went from 4 to 8 RPG-26 in five battles) and
// nothing from a battle crosses to the next (the refit rule), so it goes back to the factory list of the
// machine's formation. `target(coreId, current)` answers the list to write, or null to leave it.
export function resetLaunchers({ save, out, target, trace }) {
  const b = unitBlocks2(save);
  const plan = {}; const changes = [];
  for (const u of b.unidades) {
    const l = vehicleLaunchers(b.exp, u);
    if (!l) continue;
    const want = target(u.coreId, l.itens);
    if (!want) continue;
    const same = [...want].sort().join(',') === [...l.itens].sort().join(',');
    if (same) continue;
    plan[u.coreId] = want;
    changes.push({ coreId: u.coreId, from: l.itens, to: want });
  }
  if (!changes.length) return { vehicles: 0, changes };
  const r = writeLaunchers(save, out, plan);
  trace?.wrote('reset.launchers', out);
  trace?.event('reset.launchers', { vehicles: r.veiculos, grew: r.cresceu, examples: changes.slice(0, 8).map((c) => `core ${c.coreId}: ${c.from.join('+') || '-'} -> ${c.to.join('+') || '-'}`) });
  return { vehicles: r.veiculos, changes };
}

// WHAT A MACHINE MAY NEVER CARRY (17/10, autor: the player's Strykers carry no Javelin — neither the CLU in the launcher
// list nor the missiles in the cargo — silently). `rules` = [{ army, match, launchers: ['4/1'], cargo: [57] }];
// `names`/`armies` = Map coreId -> name / army. Every readable block that matches loses those entries; a block that
// never fought (dormant) has no list to read and is left to the game. Runs after the factory reset, which would put
// them back. Idempotent: nothing to take, nothing written.
export function stripVehicleGear({ save, workDir, tag, rules = [], names, armies, paiol = {}, trace }) {
  if (!rules.length) return { save, launchers: 0, cargo: 0 };
  const clean = (n) => String(n || '').replace(/\s+#\d+$/, '');
  const ruleOf = (id) => {
    const name = clean(names?.get(id)), army = armies?.get(id);
    return name ? rules.find((r) => (!r.army || r.army === army) && new RegExp(r.match).test(name)) : null;
  };
  let source = save;
  const b = unitBlocks2(source);
  const plan = {}; const cut = [];
  for (const u of b.unidades) {
    const rule = ruleOf(u.coreId);
    if (!rule?.launchers?.length) continue;
    const l = vehicleLaunchers(b.exp, u);
    if (!l) continue;
    const want = l.itens.filter((x) => !rule.launchers.includes(x));
    if (want.length === l.itens.length) continue;
    plan[u.coreId] = want;
    cut.push(`core ${u.coreId}: ${l.itens.join('+')} -> ${want.join('+') || '-'}`);
  }
  let launchers = 0;
  if (cut.length) {
    const out = path.join(workDir, `strip-launchers-${tag}.bts`);
    launchers = writeLaunchers(source, out, plan).veiculos;
    source = out;
  }
  const take = new Map();
  for (const u of b.unidades) { const rule = ruleOf(u.coreId); if (rule?.cargo?.length) take.set(u.coreId, rule.cargo); }
  let cargo = 0, cargoDetail = [];
  if (take.size) {
    const out = path.join(workDir, `strip-cargo-${tag}.bts`);
    const r = stripCargo(source, out, take, paiol, names);
    if (r.veiculos) { source = out; cargo = r.veiculos; cargoDetail = r.detalhe; }
  }
  if (launchers || cargo) {
    trace?.wrote('vehicles.strip', source);
    trace?.event('vehicles.strip', { launchers, cargo, examples: [...cut.slice(0, 6), ...cargoDetail.slice(0, 6).map((d) => `core ${d.coreId}: cargo ${d.itens.map((x) => `${x.item}=${x.qtd}`).join(', ')} out`)] });
  }
  return { save: source, launchers, cargo };
}

// THE SMOKE DISCHARGERS (02/10, E121): the third list of the vehicle block (`u16 c | c x (item, qty)`)
// is the discharger load — emptied, the game greys out Pop Smoke. `target(coreId, current)` gives the
// list it must have ([{ item, qtd }]) or null to leave it.
export function resetSmoke({ save, out, target, trace }) {
  const b = unitBlocks2(save);
  const plan = {}; const changes = [];
  const txt = (l) => l.map((x) => `${x.item}=${x.qtd}`).join('+') || '-';
  for (const u of b.unidades) {
    const l = vehicleLaunchers(b.exp, u);
    if (!l) continue;
    const want = target(u.coreId, l.terceira);
    if (!want || txt(want) === txt(l.terceira)) continue;
    plan[u.coreId] = want;
    changes.push({ coreId: u.coreId, from: txt(l.terceira), to: txt(want) });
  }
  if (!changes.length) return { vehicles: 0, changes };
  const r = writeSmoke(save, out, plan);
  trace?.wrote('reset.smoke', out);
  trace?.event('reset.smoke', { vehicles: r.veiculos, examples: changes.slice(0, 8).map((c) => `core ${c.coreId}: ${c.from} -> ${c.to}`) });
  return { vehicles: r.veiculos, changes };
}

export function resupplyVehicles({ save, out, table, fielded, names = null, fraction = 1, exact = false, cargo = null, trace }) {
  const r = resupplyUnits(save, out, table, { fracao: fraction, soCoreIds: fielded, nomes: names, exato: exact, cargas: cargo });
  // LITERAL, nao `resupply.units`: ali `resupply` e a funcao importada logo acima, e ler uma
  // propriedade que ela nao tem passa `undefined` como rotulo. O evento ia para o log SEM TIPO, e
  // por isso ninguem viu que este passo vinha casando zero unidade desde sempre — o autor so notou
  // quando os veiculos entraram na batalha 2 com a municao da batalha 1.
  trace.wrote('resupply.units', out);
  trace.event('resupply.unitsDone', {
    units: r.unidades, fields: r.campos, rounds: r.municao,
    examples: r.detalhe.slice(0, 6).map((u) => `core ${u.coreId}: ${u.de} -> ${u.para}`),
    // A magazine fired dry LEAVES the list (FORMATO 110.8). The pair is put back where the game
    // writes it (E41); what could not be — no observed list of that vehicle covers it — stays
    // named here, so "resupplied" is never read as "full".
    inserted: (r.inseridos || []).map((e) => `core ${e.coreId}: item(s) ${e.itens.map((x) => `${x.item}=${x.qtd}`).join(', ')}`),
    emptied: (r.esgotados || []).map((e) => `core ${e.coreId}: item(s) ${e.itens.join(', ')}`),
    cargoInserted: (r.cargaInseridos || []).map((e) => `core ${e.coreId}: ${e.itens.map((x) => `${x.item}=${x.qtd}`).join(', ')}`),
    cargoRemoved: (r.cargaRemovidos || []).map((e) => `core ${e.coreId}: ${e.itens.map((x) => `${x.item}=${x.qtd}`).join(', ')}`),
  });
  return r;
}

// Replacement: a casualty comes back on his feet AND armed (FORMATO 116). The old path patched the
// escaped stream, where a bare zero is a token, so the best it could write was state 1 — "lightly
// wounded" — and it never gave back the weapon the medics stripped. the author saw both in game.
// THE WEAPON THAT WALKED AWAY (E54). `replaceMen` only arms the man who has NO weapon. The
// machine-gunner whose PKM ran dry has one — the pistol the game brought forward — and lost the
// PKM to buddy aid; `transition.lostWeapons` names what his slot is missing and this writes the two
// weapons back in place, four bytes at most, the block the same size it was.
export function restoreWeapons({ save, out, weapons, trace }) {
  const r = rearmMen(save, out, weapons);
  if (!r.homens) return r;
  trace.wrote('rearm.save', out);
  trace.event('rearm.done', {
    men: r.homens,
    examples: r.detalhe.slice(0, 6).map((h) => `${h.nome}: ${h.de} -> ${h.para}`),
  });
  return r;
}

export function replaceMen({ save, out, indices, weapons = null, trace }) {
  const r = reinforceMen(save, out, indices, { armas: weapons });
  trace.wrote('replace.save', out);
  trace.event('replace.done', {
    asked: indices.length, back: r.reforcados, rearmed: r.rearmados, ownWeapon: r.comArmaPropria, soldiers: r.soldados,
    examples: r.homens.slice(0, 6).map((h) => `${h.nome}: ${h.de} -> ${h.para}${h.rearmado ? (h.armaDele ? ' (arma dele)' : ' (arma da unidade)') : ''}`),
  });
  return r;
}

// THE MACHINE THAT COMES BACK IN ITS OWN SLOT (28/09). A replaced wreck used to be a dormant twin
// woken up somewhere else in the force; now it is the wreck itself. Its roster block says destroyed
// (S = 1) and the game will not field it (E63) — so the state goes back to OK and the damage list is
// cleared, in place, the block the same size. Proven in game: the BMP-2M 52 of a RUS1 copy was
// refused as it was and fielded, with its two crewmen, after this write. Only machines whose block
// still says destroyed are touched, so a rebuild of the same delivery does it again cleanly.
export function rebuildVehicles({ save, out, coreIds, trace }) {
  const estado = new Map(vehicleStates(save).map((x) => [x.coreId, x]));
  const alvo = coreIds.filter((id) => estado.get(id) && estado.get(id).codigo !== 3);
  const pulados = coreIds.filter((id) => !alvo.includes(id));
  if (!alvo.length) { trace.event('vehicle.rebuilt', { rebuilt: [], skipped: pulados }); return null; }
  const r = resurrectVehicles(save, out, alvo, { modo: 'curar' });
  trace.wrote('vehicle.rebuilt', out);
  trace.event('vehicle.rebuilt', { rebuilt: r.curados.map((c) => `core ${c.coreId}: ${c.de} -> ${c.para}`), skipped: pulados });
  return r;
}
