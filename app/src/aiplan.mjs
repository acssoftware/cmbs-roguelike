// THE REVIEWED AI PLAN GOES INTO THE BATTLE (08/10/2026, E174).
//
// Ten maps of tier 1 (three files each) carry a blue AI plan the author reviewed in the editor (app/data/planos_ia.json): each
// of the 16 groups has a job — G2 Forward Deployed (machine guns, RPO, scouts and a tenth of the squads, autor 11/10),
// G3 ATGMs on high ground, G5-G9 armour, G13 ambush pockets, G14/G15 holding the objectives where they stand (11/10: they
// no longer counter-attack)... (tools/re/ia_doutrina.mjs GRUPOS). The generator's round-robin (`gruposAuto`) knows none of that:
// a machine gun could land in the reserve and a tank in the ambush. On those maps every enemy unit goes to the group of
// its role and is placed inside that group's Setup zone instead — the same code the ZZ IA test scenarios use
// (tools/re/ia_agrupar.mjs), so what the author sees in the editor is what the campaign plays.
//
// The role does not survive from planDefense into the .btt (only formations and pruning do), so it is read again from the
// unit's name with catalog.roleOf, the same function the purchase used.
import { authoredPlan, roleOf } from './catalog.mjs';
import { blueUnits, groupsByRole, writeGroups, placeByGroup, defaultUnitPrice, decodeAiRegion, toMapTiles, mapFeatures, DOCTRINE_GROUPS } from './re.mjs';
import { meetGroups, MEET_GROUPS, doctrineRules } from './meet.mjs';

// The plan whose Setup zones the units are placed in: plan 1 of blue, or the first used plan with any Setup — or, in a
// Meeting Engagement, the plan drawn for the battle (`plan`, 1-based).
function setupZones(mapFile, F, plan = null) {
  const d = decodeAiRegion(mapFile);
  const temSetup = (pl) => pl.slots.some((s) => s[0]?.tiles.length);
  const n = plan ? plan - 1 : temSetup(d.azul[0]) ? 0 : d.azul.findIndex((pl) => pl.uso > 0 && temSetup(pl));
  if (n < 0) return { plan: null, zones: {} };
  const zones = {};
  d.azul[n].slots.forEach((s, k) => {
    // a Setup painted outside the blue deployment zone cannot take a unit (the editor does not stop it)
    const tiles = toMapTiles(d, s[0]?.tiles || []).filter(([x, y]) => F.dentro(x, y) && F.azul[F.idx(x, y)]);
    if (tiles.length) zones[k + 1] = tiles;
  });
  return { plan: n + 1, zones };
}

// `meet` (12/10): the attacker's groups (app/src/meet.mjs meetGroups) with the A/B/C recipe of the variant drawn, inside
// the Setup zones of that variant's plan; the registry entry is the package map's (`sourceMap`), not the temporary copy's.
export function applyAuthoredPlan({ battle, mapFile, rules, meet = null }) {
  const reg = meet ? (meet.sourceMap ? authoredPlan(meet.sourceMap) : null) : authoredPlan(mapFile);
  const F = mapFeatures(mapFile);
  const { plan, zones } = setupZones(mapFile, F, meet?.plan ?? null);
  const units = blueUnits(battle);
  const preco = defaultUnitPrice(rules);
  // a doutrina do encontro e a tabela de grupos vem do registro do mapa (13/10); sem doutrina, os lances A/B/C antigos
  const doutrina = meet ? (meet.doutrina ?? reg?.doutrina ?? null) : null;
  const grupos = meet ? (meet.grupos ?? reg?.grupos ?? doctrineRules(rules, doutrina)?.groups ?? null) : null;
  const alocacao = meet ? (meet.alocacao ?? reg?.alocacao ?? null) : null;
  const g = meet ? meetGroups(units, { rules, shares: meet.shares, variant: meet.variant, doutrina, grupos, alocacao, preco: (n) => preco(n, roleOf(n, false, rules)) })
    : groupsByRole(units, { roleOf: (n, off) => roleOf(n, off, rules), preco });
  writeGroups(battle, battle, g.grupo);
  // off-map units (artillery, aircraft) keep their group and get no position
  const offMap = new Set(units.filter((u) => u.foraDoMapa).map((u) => u.id));
  const onMap = new Map([...g.grupo].filter(([id]) => !offMap.has(id)));
  const placed = placeByGroup(battle, onMap, zones, F, g.infantaria);
  // cada doutrina de encontro tem a sua tabela de grupos (o papel de cada numero)
  const role = grupos ? Object.fromEntries(Object.entries(grupos).map(([k, v]) => [v, k]))
    : meet ? { 1: 'tanksA', 2: 'tanksB', 3: 'tanksC', 4: 'lightA', 5: 'lightB', 6: 'lightC', 7: 'reconA', 8: 'reconB', 9: 'reconC', 10: 'mechA', 11: 'mechB', 12: 'mechC', [MEET_GROUPS.teams]: 'teams', [MEET_GROUPS.aa]: 'aa', [MEET_GROUPS.spare]: 'spare', [MEET_GROUPS.rest]: 'rest' }
    : Object.fromEntries(DOCTRINE_GROUPS.map((G) => [G.g, G.papel]));
  const groups = {};
  for (const u of g.vivas) {
    const k = g.grupo.get(u.id);
    const G = (groups[k] ||= { role: role[k] || null, zoneTiles: (zones[k] || []).length, units: [], onMap: 0 });
    G.units.push(u.nome); if (!offMap.has(u.id)) G.onMap++;
  }
  for (const [k, v] of Object.entries(placed)) if (groups[k]) groups[k].placed = v;
  // groups with units on the map but no Setup zone in the plan: they stay where the generator put them (blue paint)
  const noZone = Object.keys(groups).map(Number).filter((k) => !zones[k] && groups[k].onMap > 0);
  return { authored: true, key: reg?.key ?? meet?.key ?? null, origem: reg?.origem ?? null, plan, ...(meet ? { meet: { variant: meet.variant, plan: meet.plan, doutrina } } : {}), units: g.vivas.length, offMap: offMap.size, groups, noZone, ...(g.cargas ? { cargas: g.cargas, aPe: g.aPe } : {}) };
}
