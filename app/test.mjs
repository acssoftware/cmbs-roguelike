// Self-check for the parts of the app that fail QUIETLY: a unit priced as the wrong thing, a
// battle longer than its tier allows, a map pool too thin to finish a campaign. None of these
// throw — they just make a worse game — so they need a test that looks at the numbers.
//
//   node app/test.mjs
//
// The byte-level side has its own gabarito: `node tools/re/core_teste.mjs`.
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { rules, priceOfPicks, progress, promotionNeed, promotedFrom, nationOfUnit, inspectSave, enemyArmies, rescueChanceOf, campaignPercentages, machineCrew, scoreFor, incomeFor, billFor, capFor, coverFor, rungOf, ladder, ratioOf, startingCredits, playerRung, playerLadder, effortFor, enemyEffortFor, purchasePrice, vehicleCost, replacementLevel, battlePresence, fieldedIds, spareFor, repairsDue, abilityList, abilitiesFor, withExtraMinutes, priceAbilities, trainPrice } from './src/campaign.mjs';
import { sha1, LIVE_BATTLE_BYTES, aarDelta, AAR_ZERO, lostWeapons, missingLoads, missingGrenades, toeWeapons, fullLoads, poolLoads, offIssueWeapons, resetPlan } from './src/transition.mjs';
import { toeTable, weaponTable, sidearms, grenadeTable, refitSave, factoryIssue, issueFor, grenadesFor, factoryTable } from './src/campaign.mjs';
import { Trace } from './src/trace.mjs';
import { rearmMen, insertAmmo, resupplyMen, readRosterTails, readRoster, readAmmoVector, readGrenades, restoreGrenades, unitBlocks, readUnitAmmo, grenadePlan, armiesOfSave } from './src/re.mjs';
import { readGear, priceGear, applyGear, weaponClass, gearPrice } from './src/gear.mjs';
import { roleOf, priceUnit, priceUnits, mapCensus, mapPool, mapFile, libFormations, libraryForSide, armiesOf, SIDES, formationTree, prunePlan, deploymentTwins, singleVehicles } from './src/catalog.mjs';
import { planDefense, durationFor, tierOf } from './src/defense.mjs';
import { levelFromPoints } from './src/transition.mjs';
import { paths, CAMPAIGNS_DIR } from './src/settings.mjs';
import { markAsCore, activateCore, presentUnderMask, pruneFormation, openBtt, forceTree, readDuration, writeDuration, checkForce, readMap, writeElevation, elevationIndex } from './src/re.mjs';
import { lerRabo, acharPaiol, planoDeInsercao, inserirPares } from '../tools/re/toe_veiculos.mjs';
import { unitDirectory, buildCoreForce, growCoreForce } from './src/forge.mjs';
import { chaveNaForca } from './src/campaign.mjs';
import { coreUnits } from './src/re.mjs';

let falhou = false;
const ok = (cond, msg) => { console.log(`${cond ? 'ok   ' : 'FALHA'} ${msg}`); if (!cond) falhou = true; };
const R = rules();
// `prunePlan` guarda formacoes E unidades: para medir a formacao INTEIRA, todas as chaves entram.
const todasAsChaves = (tree) => {
  const out = [];
  const w = (n) => { out.push(n.key); n.children.forEach(w); };
  tree.roots.forEach(w);
  return out;
};

// 1. ROLES. A short acronym without a word boundary matches inside another word: `RPO` used to
//    hit "MultipuRPOse Vehicle" and every HMMWV was priced as an anti-tank team.
{
  const casos = [
    ['Main Battle Tank (M1A2 SEP Abrams)', 'tank'], ['Infantry Fighting Vehicle (BMP-2M)', 'ifv'],
    ['Armored Personnel Carrier (BTR-82)', 'apc'], ['Squad (Rifle)', 'infantry'], ['HMG Team', 'mg'],
    ['Team (Javelin)', 'atgm'], ['ATGM Vehicle (M1167 HMMWV)', 'atgm'], ['Grenade Launcher Team', 'at_inf'],
    // Transport has a role of its own since 07/09: it is the cheap way back to mobility after a
    // carrier is lost, and that trade only exists if it can be priced on its own.
    ['Multipurpose Vehicle (M1151 HMMWV)', 'truck'], ['Truck (Ural-4320)', 'truck'],
    ['Multipurpose Vehicle (M1151 HMMWV (M2))', 'mg'],   // armed first: a gun on wheels is a gun
    // 02/11 (autor): the Stinger HMMWV only carries Stingers in its inventory — a transport, not air defence
    ['Multipurpose Vehicle (M1152 HMMWV (Stinger))', 'truck'], ['Team (Stinger)', 'manpads'], ['Igla Team', 'manpads'],
    ['Section (Supply)', 'support'],
    ['Headquarters Team', 'hq'], ['Sniper Team', 'sniper'], ['Section (Scout)', 'recon'],
    ['Squad (Engineer)', 'engineer'], ['RQ-11B Raven (Unmanned Drone)', 'drone'],
    ['2 x 120mm Mortar (M120)', 'mortar'], ['6 x 152mm Howitzer (2A65)', 'artillery'],
    ['AH-64E Apache Guardian (Attack Helicopter)', 'air'],
  ];
  const errados = casos.filter(([n, esperado]) => roleOf(n, false, R) !== esperado)
    .map(([n, e]) => `${n} -> ${roleOf(n, false, R)} (esperava ${e})`);
  ok(!errados.length, `papel de ${casos.length} unidades conhecidas${errados.length ? ': ' + errados.join('; ') : ''}`);
  ok(roleOf('2 x 120mm Mortar (M120)', true, R) === 'mortar_off', 'morteiro fora do mapa vira mortar_off');

  // NOME AMBIGUO: o catalogo devolve as duas leituras separadas por barra, e a primeira regra que
  // casasse ganhava — um Apache saia como Stryker, 188 cr em vez de 625, nos dois lados da batalha.
  // Quem decide e a fisica: fora do mapa nao existe Stryker, no mapa nao existe Apache.
  {
    const duplo = 'Command Vehicle (M1130 Stryker) | AH-64D Apache Longbow (Attack Helicopter)';
    ok(roleOf(duplo, true, R) === 'air', 'nome ambiguo fora do mapa le o que voa');
    ok(roleOf(duplo, false, R) === 'apc', 'o mesmo nome no mapa le o que anda');
    // 06/11 (autor): o NOME tambem vira uma leitura so, e o preco da planilha (chave "US|Command Vehicle (M1130 Stryker)")
    // e a linha da fabrica (chave com a barra) acham a unidade pela leitura
    const { readingOf, priceUnit: pu } = await import('./src/catalog.mjs');
    const lidos = [readingOf(duplo, false, R), readingOf(duplo + ' #2', false, R), readingOf(duplo, true, R), readingOf('Squad (Rifle) #3', false, R)];
    const fab = (await import('./src/campaign.mjs')).factoryTable();
    const temFab = !fab || !!fab.maquinas?.['US|Command Vehicle (M1130 Stryker)'];
    const planilha = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'research', 'precos_unidades.json'), 'utf8')).precos || {};
    const chave = planilha['US|Command Vehicle (M1130 Stryker)'];
    const precoOk = chave === undefined || pu({ name: duplo + ' #1', offMap: false, experience: 'Veteran' }, 'US', R) === pu({ name: 'Command Vehicle (M1130 Stryker)', offMap: false, experience: 'Veteran' }, 'US', R);
    ok(lidos.join(' / ') === 'Command Vehicle (M1130 Stryker) / Command Vehicle (M1130 Stryker) #2 / AH-64D Apache Longbow (Attack Helicopter) / Squad (Rifle) #3' && temFab && precoOk,
      `nome ambiguo vira a leitura do lugar (${lidos.slice(0, 3).join(' / ')}); fabrica ${temFab ? 'acha' : 'NAO acha'} pela leitura; preco da planilha ${chave ?? '—'} ${precoOk ? 'aplicado' : 'NAO aplicado'}`);
  }
  const semPapel = Object.keys(R.units.price).filter((p) => p !== 'other' && !R.units.roles.some((r) => r.role === p) && !Object.values(R.units.offMapRole).includes(p));
  ok(!semPapel.length, `todo preco tem um papel que o produz${semPapel.length ? ': ' + semPapel.join(', ') : ''}`);
}

// 2. PRECO. Uma unidade cara tem de custar mais que uma barata, e o fator dos blindados americanos
//    tem de morder.
{
  const p = (n, nac) => priceUnit({ name: n, offMap: false }, nac, R);
  ok(p('Main Battle Tank (M1A2 SEP Abrams)', 'US') > p('Squad (Rifle)', 'US') * 5, 'um Abrams custa mais que cinco esquadroes');
  ok(p('Main Battle Tank (M1A2 SEP Abrams)', 'US') > p('Main Battle Tank (T-90AM)', 'RU'), 'blindado americano custa mais que o russo');
  ok(p('Squad (Rifle)', 'US') > p('Squad (Rifle)', 'RU'), 'fator de nacao vale para a infantaria');
  ok(p('Team (Javelin)', 'US') !== p('Main Battle Tank (M1A2 SEP Abrams)', 'US'), 'Javelin e Abrams nao custam a mesma coisa');
}

// 3. RELOGIO. O teto do tier e duro e o valor tem de ser um dos que o jogo aceita.
{
  const maus = [];
  for (const t of R.tiers) for (const u of [5, 20, 40, 80]) for (const a of [0.1, 1, 3, 8]) {
    const d = durationFor(t, u, a, R);
    if (d > t.durationMax || !R.duration.allowed.includes(d)) maus.push(`t${t.tier} ${u}u ${a}km2 -> ${d}`);
  }
  ok(!maus.length, `duracao dentro do teto e na lista do jogo${maus.length ? ': ' + maus.slice(0, 3).join('; ') : ''}`);
  // O tier 1 e 45 minutos e ponto (autor, 07/09): nem defesa grande nem mapa grande empurram.
  // Antes disto o gatilho de mapa grande estava em 0,35 km2 e 77% do pool do tier passava dele —
  // toda primeira missao saia com 60.
  const t1 = new Set();
  for (const u of [5, 11, 16, 20, 25, 40, 80]) for (const a of [0.2, 0.36, 0.45, 0.49]) t1.add(durationFor(R.tiers[0], u, a, R));
  ok(t1.size === 1 && t1.has(45), `tier 1 da 45 minutos em toda combinacao de defesa e mapa (saiu: ${[...t1].join(', ')})`);

  // A regra do autor era 45 na primeira missao e +15 por tier. Metade dessa escada (75 e 105) nao
  // existe no dropdown do editor — E24 —, entao o que se cobra e o que sobrou dela: comeca em 45,
  // sempre sobe, e todo degrau e um valor que o jogo oferece.
  const bases = R.tiers.map((t) => durationFor(t, 5, 0.01, R));
  const sobe = bases.every((v, i) => i === 0 || v > bases[i - 1]);
  const validas = bases.every((v) => R.duration.allowed.includes(v));
  ok(bases[0] === 45 && sobe && validas, `base por tier: ${bases.join(' / ')} minutos`);

  // A lista de opcoes do editor, LIDA DO DROPDOWN (secao 50, E24). Escrever fora dela e gravar no
  // byte um numero que o jogo nunca ofereceu — e quando isso aconteceu (105), a tela de carga
  // anunciou o vizinho de baixo por conta propria.
  const doEditor = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90, 100, 110, 120, 150, 180, 210, 240];
  const fora = R.duration.allowed.filter((v) => !doEditor.includes(v));
  ok(!fora.length, `so duracoes que a tela do editor oferece${fora.length ? ' (fora: ' + fora.join(', ') + ')' : ''}`);
}

// 4. POOL DE MAPAS. Uma campanha de 12 batalhas precisa de um mapa novo por batalha em cada tier —
//    (23/10: um mapa so, a versao Attack — Probe/Attack/Assault eram o mesmo mapa).
{
  const sizes = (t) => t.mapTiers || [t.tier];
  const faltando = R.tiers.filter((t) => mapPool(sizes(t)).length < t.battles.length)
    .map((t) => `tier ${t.tier}: ${mapPool(sizes(t)).length} de ${t.battles.length}`);
  ok(!faltando.length, `mapas suficientes por tier${faltando.length ? ': ' + faltando.join('; ') : ''}`);
  const porTipo = {}; for (const m of mapCensus()) porTipo[m.tipo] = (porTipo[m.tipo] || 0) + 1;
  const familias = new Set(mapCensus().map((m) => m.familia || m.f));
  ok(Object.keys(porTipo).join() === 'Attack' && familias.size === mapCensus().length && !R.tiers.some((t) => t.kinds), `um mapa so por familia, a versao Attack (${JSON.stringify(porTipo)}), e nenhum tier pede tipo`);
  const invertido = mapCensus().filter((m) => m.orientacao !== 'azul-defende');
  ok(!invertido.length, `nenhum mapa do pool poe o jogador na defesa${invertido.length ? ': ' + invertido.slice(0, 3).map((m) => m.f).join('; ') : ''}`);
  const semTransplante = mapCensus().filter((m) => m.transplante !== true);
  ok(!semTransplante.length, `todo mapa do pool sobrevive ao transplante${semTransplante.length ? ': ' + semTransplante.length : ''}`);
}

// 5. DEFESA. Tem de gastar o orcamento, ter pelotao de infantaria, seguir as fatias do perfil
//    (E46: esquadroes / weapons teams / veiculos de combate / off-map) e nunca comprar caminhao.
{
  const maus = [];
  const NUNCA = /Truck|Ural|KamAZ|Multipurpose Vehicle|Supply|Forward Observer|Air Controller|Target Reference/;
  for (const t of R.tiers) for (const perfil of ['urbano', 'misto', 'aberto']) for (const n of t.battles) {
    const kind = null;
    const d = planDefense({ nation: 'RU', battleNumber: n, rules: R, seed: 12345, profile: perfil, kind });
    const folga = Math.round(d.budget * R.defense.bucketSlack) + 1;
    if (d.cost < d.budget * 0.6) maus.push(`B${n} ${perfil}: gastou so ${d.cost}/${d.budget}`);
    if (!d.lots.length) maus.push(`B${n} ${perfil}: sem pelotao de infantaria`);
    // Cinco orcamentos (E47): off-map e teto duro, os outros podem passar do seu pela folga, e
    // categoria sem orcamento fica em zero.
    if (d.spent.offMap > d.budgets.offMap) maus.push(`B${n} ${perfil}: off-map ${d.spent.offMap} de ${d.budgets.offMap}`);
    for (const b of ['squads', 'teams', 'carriers', 'tanks']) if (d.spent[b] > (d.budgets[b] ? d.budgets[b] + folga : 0)) maus.push(`B${n} ${perfil}: ${b} ${d.spent[b]} acima do orcamento ${d.budgets[b]}`);
    if (Math.abs(Object.values(d.budgets).reduce((a, v) => a + v, 0) - d.budget) > 2) maus.push(`B${n} ${perfil}: os orcamentos nao somam o total`);
    // Os tetos em unidades (E48) valem sempre — no tier 4 e no esforco maximo tambem.
    for (const b of ['squads', 'teams', 'carriers', 'tanks', 'offMap', 'onMap']) if (d.count[b] > R.defense.unitCaps[b]) maus.push(`B${n} ${perfil}: ${d.count[b]} ${b} acima do teto ${R.defense.unitCaps[b]}`);
    // Os veiculos sao de combate: nada de caminhao, jipe, suprimento, observador.
    if (d.kept.some((k) => NUNCA.test(k.name))) maus.push(`B${n} ${perfil}: comprou ${d.kept.filter((k) => NUNCA.test(k.name)).map((k) => k.name).join(', ')}`);
    // Fonte so de off-map (um pelotao de morteiros, uma bateria) nao conta: e uma unidade e nada
    // no mapa.
    if (d.sourcesOnMap > R.defense.maxSources) maus.push(`B${n} ${perfil}: ${d.sourcesOnMap} fontes no mapa`);
    if (d.formations.length !== d.sources.length) maus.push(`B${n} ${perfil}: ${d.formations.length} formacoes para ${d.sources.length} fontes`);
  }
  ok(!maus.length, `defesa em 36 combinacoes de batalha e terreno${maus.length ? ': ' + maus.slice(0, 4).join('; ') : ''}`);
  // As fatias mandam de verdade: no urbano a infantaria a pe leva a maior parte, no aberto os
  // veiculos de combate levam quase metade — nos dois casos medindo o que foi PAGO.
  {
    const soma = (perfil) => { const s = { pe: 0, vh: 0, n: 0 }; for (let seed = 1; seed <= 6; seed++) { const d = planDefense({ nation: 'RU', battleNumber: 8, rules: R, seed, profile: perfil, kind: 'Attack' }); s.pe += d.mix.squads + d.mix.teams; s.vh += d.mix.carriers + d.mix.tanks; s.n++; } return { pe: s.pe / s.n, vh: s.vh / s.n }; };
    const u = soma('urbano'), m = soma('misto'), a = soma('aberto');
    ok(u.pe > m.pe && m.pe > a.pe && a.vh > m.vh && m.vh > u.vh, `o perfil desloca o dinheiro: a pe ${Math.round(u.pe * 100)}% / ${Math.round(m.pe * 100)}% / ${Math.round(a.pe * 100)}% e em veiculos ${Math.round(u.vh * 100)}% / ${Math.round(m.vh * 100)}% / ${Math.round(a.vh * 100)}% (urbano / misto / aberto, media de 6 sementes)`);
  }

  // O ORCAMENTO E UM TETO, e ate 08/09 nao era: o QG do batalhao vinha obrigatoriamente com o
  // espinhaco e em duas das oito fontes ele sozinho passava do teto do tier (o do Stryker Infantry
  // custa 5.250, mais que o orcamento da ultima batalha). O multiplicador quase nao mordia embaixo,
  // porque o piso mandava. Com o QG isento (`defense.freeHeadquarters`) o teto volta a ser teto.
  const estourou = [];
  for (const nacao of ['US', 'UKR', 'RU']) for (const efeito of [0.25, 1, 2]) for (const b of [1, 6, 12]) {
    for (let seed = 1; seed <= 10; seed++) {
      const d = planDefense({ nation: nacao, battleNumber: b, rules: R, seed, profile: 'misto', effort: efeito });
      if (d.cost > d.budget) estourou.push(`${nacao} B${b} ${efeito}x seed ${seed}: ${d.cost}/${d.budget}`);
    }
  }
  ok(!estourou.length, `nenhuma defesa passa do orcamento em 270 planos${estourou.length ? ` (${estourou.length}, ex: ${estourou[0]})` : ''}`);

  // OS DESBLOQUEIOS E A VARIEDADE (E45/E46). autor avancou seis batalhas sem ver um tanque e
  // "quando vejo um BTR, sei que so tera BTR". Agora o tier 3 libera tanques para o pool inteiro,
  // o tier 1 nao os tem, e a frota de uma defesa mistura os transportes da nacao.
  {
    const comTanque = { t34: 0, t1: 0 }, planos = { t34: 0, t1: 0 }, fora = [], misturas = [];
    for (const nacao of ['RU', 'UKR']) for (let seed = 1; seed <= 8; seed++) {
      for (const b of [7, 8, 9, 10, 11, 12]) {
        const t = tierOf(b, R);
        const d = planDefense({ nation: nacao, battleNumber: b, rules: R, seed, profile: 'aberto', effort: 1, kind: null });
        planos.t34++; if (d.byRole.tank > 0) comTanque.t34++;
        if (d.cost > d.budget) fora.push(`${nacao} B${b} seed ${seed}: ${d.cost}/${d.budget}`);
        const transportes = new Set(d.kept.filter((k) => /Carrier|Fighting Vehicle|MT-LB/.test(k.name)).map((k) => k.name));
        misturas.push(transportes.size);
      }
      for (const b of [1, 2, 3]) {
        const d = planDefense({ nation: nacao, battleNumber: b, rules: R, seed, profile: 'aberto', effort: 1, kind: null });
        planos.t1++;
        if (d.byRole.artillery_off > 0) comTanque.t1++;   // 20/10 (autor): ATGM liberado no tier 1
        // No tier 1 tanque so por surpresa (E47) ou, desde 18/10, pela escada do mapa aberto (tankShare): quando ha papel
        // tank, o plano diz de onde veio, e a escada nunca passa do balde (mais a folga, so da Russia).
        if ((d.byRole.tank > 0) && !(d.surpriseTank > 0 || d.tankShare)) comTanque.t1++;
        if (d.tankShare && (d.spent.tanks > d.budgets.tanks + (d.tankSlack || 0) || d.kept.filter((k) => /Main Battle Tank/.test(k.name)).reduce((a, k) => a + k.n, 0) > 1)) comTanque.t1++;
        if (d.surpriseTank > 0) comTanque.surpresa = (comTanque.surpresa || 0) + 1;
        // 18/10 (autor): o tanque surpresa e o mais barato do lado, um so, e nao outro que caiba na folga
        // (o papel 'tank' cobre os caca-tanques; a surpresa e um carro de combate)
        if (d.surpriseTank > 0 && (d.spent.tanks !== d.surpriseTank || (d.byBucket?.tanks || 0) !== 1 || !d.kept.some((k) => /Main Battle Tank/.test(k.name)))) comTanque.t1++;
        // MORTEIRO SURPRESA (autor, 11/10): no tier 1 o fora do mapa so existe pelo sorteio, e e uma bateria de morteiro
        if ((d.byRole.mortar_off > 0) !== (d.surpriseMortar > 0) || Object.keys(d.byRole).some((r) => ['artillery_off', 'artillery', 'air', 'drone'].includes(r))) comTanque.t1++;
        if (d.surpriseMortar > 0) comTanque.morteiro = (comTanque.morteiro || 0) + 1;
      }
    }
    // Com orcamento proprio de tanques (E47), toda defesa aberta dos tiers 3 e 4 tem tanque.
    ok(comTanque.t34 === planos.t34, `tanques em ${comTanque.t34} de ${planos.t34} defesas abertas dos tiers 3 e 4 (RU e UKR, 8 sementes)`);
    ok(comTanque.t1 === 0, `e nada de artilharia no tier 1 (ATGM liberado em 20/10), e tanque so por surpresa (${comTanque.surpresa || 0} surpresas em ${planos.t1} planos)`);
    const chance = R.tiers[0].tankChance || 0;
    ok((comTanque.surpresa || 0) <= planos.t1 * Math.min(1, chance * 2 + 0.1), `a surpresa fica perto da chance do tier 1 (${chance})`);
    const chanceM = R.tiers[0].mortarChance || 0;
    ok((comTanque.morteiro || 0) > 0 && (comTanque.morteiro || 0) <= planos.t1 * Math.min(1, chanceM * 2 + 0.1), `e o morteiro fora do mapa so por sorteio: ${comTanque.morteiro || 0} em ${planos.t1} planos do tier 1 (chance ${chanceM})`);
    // OS SCOUTS (autor, 11/10): 20% do dinheiro das esquadras, so das fontes que ele nomeou, e nunca bem acima da fatia
    {
      const maus = []; let comScout = 0, n = 0;
      for (const nacao of ['US', 'UKR', 'RU']) for (let seed = 1; seed <= 4; seed++) for (const b of [1, 3, 5, 8]) {
        const t = tierOf(b, R);
        const d = planDefense({ nation: nacao, battleNumber: b, rules: R, seed, profile: 'misto', effort: 1, kind: null });
        n++; if (d.spent.scouts > 0) comScout++;
        const fontes = new Set(R.defense.scouts.sources[nacao]);
        for (const k of d.trail.filter((x) => x.unit && /Scout|Recon/.test(x.unit) && !/Vehicle|BRDM|BRM-/.test(x.unit))) if (!fontes.has(k.source)) maus.push(`${nacao} B${b}: ${k.unit} de ${k.source}`);
        if (d.spent.scouts > d.budgets.scouts + 100) maus.push(`${nacao} B${b} seed ${seed}: scouts ${d.spent.scouts} de ${d.budgets.scouts}`);
        if (b === 1 && d.budgets.scouts !== Math.round(R.tiers[0].budgets.squads * R.defense.scouts.share)) maus.push(`B1: fatia ${d.budgets.scouts}`);
      }
      ok(!maus.length && comScout >= n * 0.6, `scouts em ${comScout} de ${n} defesas, todos das fontes do autor e dentro da fatia${maus.length ? ': ' + maus.slice(0, 3).join('; ') : ''}`);
      // US: so Section (Scout) e nunca um tipo com Javelin (mao 4/1 na dotacao de fabrica) — autor, 11/10
      const { poolOf } = await import('./src/defense.mjs');
      const fab = factoryTable(); const maosDe = (t) => { const v = Object.values(fab.tipos).find((x) => x.exercito === 'US' && x.val === t[0] && x.tab === t[1]); return v ? Object.values(v.vagas).flatMap((s) => s.maos || []) : null; };
      const comprar = poolOf('US', R).flatMap((s) => s.units).filter((u) => u.bucket === 'scouts');
      const errados = comprar.filter((u) => u.name !== 'Section (Scout)' || !maosDe(u.type) || maosDe(u.type).includes('4/1'));
      const comJavelin = poolOf('US', R).flatMap((s) => s.units).filter((u) => u.name === 'Section (Scout)' && maosDe(u.type)?.includes('4/1'));
      ok(comprar.length > 0 && !errados.length && comJavelin.length > 0 && comJavelin.every((u) => u.bucket === 'never'),
        `scouts US: ${comprar.length} Section (Scout) compraveis, nenhuma com Javelin; ${comJavelin.length} com Javelin ficam de fora${errados.length ? ': ' + errados.map((u) => `${u.name} [${u.type}]`).join(', ') : ''}`);
    }
    ok(!fora.length, `nenhuma passa do orcamento${fora.length ? ': ' + fora.slice(0, 3).join('; ') : ''}`);
    const mistas = misturas.filter((m) => m >= 2).length;
    ok(mistas >= misturas.length * 0.6, `a frota mistura dois ou mais tipos de transporte em ${mistas} de ${misturas.length} defesas abertas`);

    // A PODA POR ORDINAL FECHA O CIRCUITO: o que o plano diz que comprou de uma fonte e exatamente
    // o que sobra vivo no arquivo podado (podar.mjs com listas de ordinais, E46) — nome a nome,
    // contando as repeticoes. E o mecanismo de "pegar um pelotao e deixar so o lanca-granadas".
    {
      const d = planDefense({ nation: 'RU', battleNumber: 8, rules: R, seed: 12345, profile: 'aberto', effort: 1, kind: 'Attack' });
      const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-e46-'));
      const porNome = {};
      let totalVivas = 0;
      d.formations.forEach((f, i) => {
        const saida = path.join(dirTmp, `podada-${i}.btt`);
        pruneFormation(f.formacao, saida, 0, f.ausentes || [], null, f.ausentesSoltas || null);
        const X = openBtt(saida);
        const c = X.completo;
        const anda = (no) => { if (!no.r.form) { if (!(c[no.r.c + 7] & 0x80)) { porNome[no.r.nm] = (porNome[no.r.nm] || 0) + 1; totalVivas++; } return; } no.filhos.forEach(anda); };
        forceTree(X).topos.forEach(anda);
      });
      fs.rmSync(dirTmp, { recursive: true, force: true });
      // O total de vivas em todas as fontes e o total de unidades do plano, e cada nome bate.
      const difere = d.kept.filter((k) => porNome[k.name] !== k.n).map((k) => `${k.name} ${porNome[k.name] || 0}≠${k.n}`);
      ok(totalVivas === d.units && !difere.length, `podar por ordinal deixa vivas exatamente as ${d.units} unidades compradas de ${d.sources.length} fontes${difere.length ? ' — difere: ' + difere.slice(0, 3).join('; ') : ''}${totalVivas !== d.units ? ` (${totalVivas} vivas)` : ''}`);
    }
    // O crescimento: cada tier custa mais que o anterior, e dentro do tier cada batalha mais que a anterior (23/10: sem
    // o fator do tipo do mapa, a batalha comum e sempre 1x).
    const custo = (b) => planDefense({ nation: 'RU', battleNumber: b, rules: R, seed: 3, profile: 'misto', effort: 1 }).budget;
    ok(custo(3) < custo(6) && custo(6) < custo(9) && custo(9) < custo(12) && custo(7) < custo(8) && custo(8) < custo(9) && Object.keys(R.maps.kindBudgetFactor).join() === 'Meet',
      `o orcamento sobe de tier em tier (${[3, 6, 9, 12].map((b) => custo(b)).join(' → ')}) e o fator so existe para o encontro`);
  }

  // A ISENCAO NAO PODE VAZAR PARA QUEM LUTA. Um peloton de fuzileiros nao comanda sub-formacao
  // nenhuma, entao os esquadroes dele sao as unidades proprias dele — e se a regra fosse "unidades
  // proprias de qualquer formacao", a infantaria inteira sairia de graca.
  {
    const alvo = libFormations('US').find((f) => f.source === 'US - Battalion (Infantry)');
    const t = formationTree(alvo.file);
    const qg = new Set();
    const marca = (n) => {
      if (!n.isFormation) return;
      if (n.children.some((c) => c.isFormation)) for (const c of n.children) if (!c.isFormation) qg.add(c.key);
      n.children.forEach(marca);
    };
    t.roots.forEach(marca);
    const todas = prunePlan(t, todasAsChaves(t)).keptUnits;
    const fuzileiros = todas.filter((u) => /^Squad \(Rifle\)/.test(u.name));
    ok(fuzileiros.length > 0 && fuzileiros.every((u) => !qg.has(u.key)), `os ${fuzileiros.length} esquadroes de fuzileiros continuam se pagando`);
    ok(todas.filter((u) => qg.has(u.key)).every((u) => !/^Squad \(Rifle\)/.test(u.name)), 'e nada que e esquadrao de fuzileiro entra na isencao');
    const isentos = todas.filter((u) => qg.has(u.key));
    ok(isentos.some((u) => /Headquarters Team|XO Team/.test(u.name)), `o que entra na isencao sao QGs (${isentos.length} unidades no batalhao inteiro)`);
  }

  // E o QG isento continua contando para a FORMA da forca: os tetos sao fracoes do valor em campo,
  // e um veiculo de comando de graca continua sendo um veiculo em campo.
  {
    const d = planDefense({ nation: 'US', battleNumber: 6, rules: R, seed: 7, profile: 'misto', effort: 1 });
    ok(d.fullCost > d.cost, `a forca vale ${d.fullCost} e a defesa pagou ${d.cost}: o QG isento foram ${d.freeHeadquarters} cr`);
    ok(Math.abs(Object.values(d.byRole).reduce((a, v) => a + v, 0) - d.fullCost) <= 2, 'e a mistura e medida sobre o valor cheio, nao sobre o que foi pago');
  }
}

// 6. BIBLIOTECA. Toda formacao oferecida precisa de molde de roster para cada unidade, senao a
//    campanha nao carrega (FORMATO 112.1) — e o app recusa a compra, o que e pior descobrir tarde.
{
  const tabela = JSON.parse(fs.readFileSync(paths().typeTable, 'utf8'));
  const temMolde = new Set(tabela.filter((r) => r.bloco).map((r) => `${r.val},${r.tab}`));
  // 12/10: as formacoes SO DO INIMIGO (sem molde: Khrizantema, BRDM-2 (AT-5)) ficam fora da loja do jogador
  // (catalog.libraryForArmies); o que a loja oferece tem de ter molde para tudo.
  const faltando = [], soInimigo = [];
  const naLoja = new Set(libraryForSide('US', true).map((f) => f.file));
  for (const nacao of ['US', 'RU', 'UKR']) for (const f of libFormations(nacao)) {
    let t; try { t = formationTree(f.file); } catch { continue; }
    const p = prunePlan(t, todasAsChaves(t));
    const sem = p.keptUnits.filter((u) => !temMolde.has(`${u.type[0]},${u.type[1]}`));
    if (sem.length) (naLoja.has(f.file) ? faltando : soInimigo).push(`${f.source}: ${[...new Set(sem.map((u) => u.name))].slice(0, 2).join(', ')}`);
  }
  ok(!faltando.length, `toda formacao da loja do jogador tem molde de roster${faltando.length ? ` (${faltando.length} sem: ${faltando.slice(0, 2).join('; ')})` : ''}; so do inimigo: ${soInimigo.length ? soInimigo.join('; ') : 'nenhuma'}`);
}

// 7. OS DOIS LADOS e a unica fortificacao que o jogador pode comprar.
{
  for (const lado of Object.keys(SIDES)) {
    const so = libraryForSide(lado), com = libraryForSide(lado, true);
    ok(so.length > 20 && com.length > so.length, `${SIDES[lado].label}: ${so.length} formacoes, ${com.length} com as do outro lado`);
    const naoDeveria = so.filter((f) => !SIDES[lado].nations.includes(f.nation));
    ok(!naoDeveria.length, `${SIDES[lado].label}: nada de fora do lado na lista${naoDeveria.length ? ': ' + naoDeveria[0].file : ''}`);
  }
  const fortificacoes = libraryForSide('US', true).filter((f) => /Trench|Foxhole|Barbed Wire|Sandbag|Mines/i.test(f.name));
  ok(!fortificacoes.length, `nenhuma fortificacao alem do TRP${fortificacoes.length ? ': ' + fortificacoes.map((f) => f.file).join(', ') : ''}`);
  const trp = libraryForSide('US', true).filter((f) => f.trp);
  ok(trp.length > 0, `o Target Reference Point esta na lista (${trp.length} fontes)`);
  for (const f of trp) {
    const t = formationTree(f.file);
    const p = prunePlan(t, todasAsChaves(t));
    const preco = p.keptUnits.reduce((a, u) => a + priceUnit(u, 'US', R), 0);
    ok(p.keptUnits.every((u) => roleOf(u.name, u.offMap, R) === 'trp') && preco === 500,
      `${f.file}: ${p.unitsKept} pontos de referencia por ${preco} cr`);
  }
  const variantes = libraryForSide('US', true).filter((f) => / \[(US|RU|UKR) C\d+ \d+\]/.test(f.name));
  ok(!variantes.length, `nenhuma variante de raridade na lista${variantes.length ? ': ' + variantes.length : ''}`);
}

// 8. UMA COMPANHIA SEM O CABECALHO DO BATALHAO. autor escolheu uma companhia e deixou o batalhao
//    desmarcado; o plano zerava, porque o corte parava no primeiro cabecalho desligado e nada
//    abaixo era contado. As unidades sao sempre explicitas, entao fechar para cima so acrescenta
//    cabecalhos: o batalhao entra como titulo, e as unidades DELE continuam de fora.
{
  const f = libFormations('US').find((x) => /Battalion \(Stryker Infantry\)/.test(x.name)) || libFormations('US').find((x) => x.units > 100);
  const t = formationTree(f.file);
  const raiz = t.roots[0];
  const empresa = raiz.children.find((c) => c.isFormation && c.children.length > 3);
  const chaves = [];
  const w = (n) => { chaves.push(n.key); n.children.forEach(w); };
  w(empresa);                                   // so a sub-formacao, sem a raiz e sem as unidades dela

  const p = prunePlan(t, chaves);
  const preco = p.keptUnits.reduce((a, u) => a + priceUnit(u, 'US', R), 0);
  ok(p.unitsKept > 0 && preco > 0, `${f.name}: so "${empresa.name}" escolhida -> ${p.unitsKept} unidades, ${preco} cr`);
  ok(p.implied.includes(raiz.key), 'o cabecalho do batalhao entra sozinho, como titulo');

  const unidadesDaRaiz = raiz.children.filter((c) => !c.isFormation).length;
  const raizEntrou = p.keptUnits.some((u) => u.key.split('.').length === 2);
  ok(unidadesDaRaiz > 0 && !raizEntrou, `as ${unidadesDaRaiz} unidades do proprio batalhao continuam de fora`);
  ok(p.ausentes.length === raiz.children.filter((c) => c.isFormation).length - 1,
    `as outras ${p.ausentes.length} sub-formacoes vao para a lista de ausentes`);

  // Escolher tudo tem de dar o mesmo de antes: fechar para cima nao pode inflar nada.
  const cheio = prunePlan(t, todasAsChaves(t));
  ok(cheio.implied.length === 0 && cheio.unitsKept === cheio.unitsTotal,
    `com tudo marcado nada e implicito (${cheio.unitsKept}/${cheio.unitsTotal} unidades)`);
}

// 9. A ZONA DE SETUP TEM DE CABER A FORCA. autor gerou uma batalha e a forca dele apareceu fora
//    da zona de deploy. A zona daquele mapa tem 300 tiles pintados e a forca era de 26 unidades: o
//    limite nao era do jogo, era nosso. O gerador cortava dois tiles para dentro da borda e usava
//    um lugar a cada dois, sobrando 24, e quando nao dava ele ENGOLIA a excecao e deixava a forca
//    onde estava no mapa de biblioteca. Hoje ele desce uma escada de aperto antes de desistir, e
//    `capVermelho` no censo e o ultimo degrau — a zona inteira, tile a tile.
{
  const semCap = mapCensus().filter((m) => m.serve && (m.capVermelho === undefined || m.capFolgadaVermelho === undefined));
  ok(!semCap.length, `todo mapa que serve tem as duas capacidades medidas${semCap.length ? ` (${semCap.length} sem)` : ''}`);

  // O teto tem de ser folgado em todo mapa que serve: com a escada, nenhum e apertado de verdade.
  const apertados = mapCensus().filter((m) => m.serve && (m.capVermelho ?? 0) < 60);
  ok(!apertados.length, `nenhum mapa do pool aperta uma forca de 60 unidades${apertados.length ? ': ' + apertados.slice(0, 3).map((m) => `${m.f} (${m.capVermelho})`).join('; ') : ''}`);

  // E o mapa que quebrou nunca foi pequeno: a medida do censo bruto diz que os 26 cabem. Desde 04/10 ele
  // esta fora da selecao do autor (app/data/mapas.json); no sorteio de hoje, todo tier aceita os mesmos 26.
  const bruto = JSON.parse(fs.readFileSync(new URL('../research/mapas_attack.json', import.meta.url), 'utf8'));
  const quebrado = (bruto.mapas || bruto).find((m) => /016r/.test(m.f));
  const tiersSemLugar = [1, 2, 3, 4].filter((t) => !mapPool(t, [], 26).length);
  ok(quebrado && quebrado.capVermelho >= 26 && !tiersSemLugar.length,
    `o mapa que quebrou cabe ${quebrado ? quebrado.capVermelho : '?'} unidades (${quebrado ? quebrado.capFolgadaVermelho : '?'} sem apertar), e todo tier do sorteio aceita 26${tiersSemLugar.length ? ' — MENOS ' + tiersSemLugar.join(', ') : ''}`);

  // O filtro so existe para o caso impossivel, e ele tem de morder.
  const nenhum = R.tiers.every((x) => mapPool(x.tier, [], 5000).length === 0);
  ok(nenhum, 'o filtro de capacidade recusa uma forca que nao cabe em mapa nenhum');

  // Mapas por tier, com o teto que a escada alcanca.
  const magros = R.tiers.filter((x) => mapPool(x.tier, [], 30).length < x.battles.length)
    .map((x) => `tier ${x.tier}: ${mapPool(x.tier, [], 30).length} para ${x.battles.length} batalhas`);
  ok(!magros.length, `todo tier tem mapa bastante para 30 unidades${magros.length ? ': ' + magros.join('; ') : ''}`);
}

// 10. O FATOR DO INIMIGO. autor achou a defesa magra — "sinto que esta em 0,5x do potencial" — e
//     pediu para poder engrossa-la. O fator multiplica o orcamento do tier e mais nada: os tetos
//     abaixo sao SHARES do que foi comprado, entao a mistura continua a mesma e so o tamanho muda.
{
  // 30/10 (a escada): o seletor saiu da criacao; 01/11 o fator sai da razao de forca, so no Attack (o encontro e 1:1).
  // O planejador continua multiplicando, e e isso que se mede aqui (os pesos do no e o piso do encontro passam por ele).
  const E = { options: [0.75, 1, 1.25] };
  const fatores = R.difficulty.ratioOptions.map((r) => effortFor(r, R));
  ok(fatores.every((f, i) => Math.abs(f * R.difficulty.ratioOptions[i] * rungOf(1, R) - R.startingCredits) < 1e-6) && fatores.every((f, i) => !i || f > fatores[i - 1])
    && enemyEffortFor({ forceRatio: 0.9 }, 'Meet', R) === 1 && enemyEffortFor({ forceRatio: 0.9 }, null, R) === effortFor(0.9, R),
    `o fator vem da razao: ${fatores.map((f) => f.toFixed(3)).join(' / ')}; o encontro fica em 1`);

  const tier5 = R.tiers.find((x) => x.battles.includes(5));
  const conta = (e, n) => planDefense({ nation: 'RU', battleNumber: n, rules: R, seed: 4242, profile: 'misto', effort: e });

  const fora = [];
  let anterior = null;
  for (const e of E.options) {
    const d = conta(e, 5);
    // A batalha 5 e a segunda do tier: cada categoria cresce uma vez, depois o fator (E47).
    const esperado = Object.values(tier5.budgets).reduce((a, v) => a + Math.round(v * R.defense.battleGrowth * e), 0);
    if (Math.abs(d.budget - esperado) > 2) fora.push(`orcamento ${d.budget} em vez de ${esperado} no fator ${e}`);
    if (anterior !== null && d.units < anterior) fora.push(`${e}x deu menos unidades que o fator anterior (${d.units} < ${anterior})`);
    anterior = d.units;
  }
  ok(!fora.length, `o fator escala o orcamento e nunca encolhe a forca${fora.length ? ': ' + fora.join('; ') : ''}`);

  const um = conta(1, 5).units, dois = conta(2, 5).units;
  ok(dois >= um * 1.5, `o dobro se sente: ${dois} unidades contra ${um} do normal`);
  // E no fim da campanha, com o dobro, nada passa dos tetos em unidades (01/11: sem teto pratico por categoria, onMap 250;
  // antes eles seguravam o que os orcamentos nao seguravam).
  const epica = planDefense({ nation: 'RU', battleNumber: 12, rules: R, seed: 4242, profile: 'aberto', effort: 2, kind: null });
  const C = R.defense.unitCaps;
  ok(epica.count.onMap <= C.onMap && epica.count.tanks <= C.tanks && epica.count.squads <= C.squads && epica.count.offMap <= C.offMap,
    `batalha 12 a 2x: ${epica.count.onMap} no mapa (teto ${C.onMap}), ${epica.count.tanks} tanques, ${epica.count.squads} esquadroes; bateu no teto de ${epica.capped.join(', ') || 'nenhum'}; gastou ${epica.cost} de ${epica.budget}`);

  // E os tetos continuam segurando no fator maximo — a mistura nao pode degenerar.
  const d2 = conta(2, 8);
  const folga2 = Math.round(d2.budget * R.defense.bucketSlack) + 1;
  ok(d2.spent.offMap <= d2.budgets.offMap && d2.spent.tanks <= d2.budgets.tanks + folga2 && d2.spent.carriers <= d2.budgets.carriers + folga2,
    `no fator 2 os tetos seguram: off-map ${d2.spent.offMap}/${d2.budgets.offMap}, tanques ${d2.spent.tanks}/${d2.budgets.tanks}, transportes ${d2.spent.carriers}/${d2.budgets.carriers}`);
}


// 12. EXPERIENCIA E PRECO (FORMATO 112.13). A escolha do jogador tem de custar, a defesa nao pode
//     pagar por ela (o orcamento do inimigo ja e a alavanca de dificuldade) e um ponto de
//     referencia nao tem veterania nenhuma.
{
  const f = R.units.experienceFactor;
  const niveis = R.units.experienceLevels;
  const sobe = niveis.every((n, i) => i === 0 || f[n] > f[niveis[i - 1]]);
  ok(sobe, `a escala anda do pior para o melhor: ${niveis.map((n) => `${n} ${f[n]}`).join(', ')}`);
  ok(f.Veteran === 1, 'a ancora e o Veteran, que e o que a biblioteca mais entrega numa formacao comprada');

  const fonte = (libFormations('US').find((x) => /Battalion (Stryker Infantry)$/.test(x.name)) || libFormations('US')[0]).file;
  const tree = formationTree(fonte);
  const chaves = todasAsChaves(tree);
  const folhas = [];
  const w = (n) => (n.isFormation ? n.children.forEach(w) : folhas.push(n));
  tree.roots.forEach(w);

  const preco = (xp) => priceOfPicks([{ source: fonte, keep: chaves, xp }], 'US', R)[0].price;
  const base = preco({});
  // 18/10 (autor, corrigido): na COMPRA o nivel e escolha do jogador e o preco segue; so a unidade que ja existe nao muda.
  const todosCrack = preco(Object.fromEntries(folhas.map((n) => [n.key, 'Crack'])));
  const todosGreen = preco(Object.fromEntries(folhas.map((n) => [n.key, 'Green'])));
  ok(todosCrack > base && base > todosGreen, `a mesma companhia custa ${todosGreen} Green, ${base} como veio e ${todosCrack} Crack`);

  // Uma unidade so: o que muda na conta e o que aquela unidade custa, nao a formacao inteira.
  const uma = folhas.find((n) => roleOf(n.name, n.offMap, R) === 'infantry');
  const comUma = preco({ [uma.key]: 'Elite' });
  ok(comUma > base && comUma < todosCrack, `subir um unico esquadrao para Elite custa ${comUma - base} cr`);

  // O TRP nao tem veterania: pedir Crack nele nao muda nada.
  const trpFonte = 'UKR - Target Reference Point.btt';
  const trpTree = formationTree(trpFonte);
  const trpChaves = todasAsChaves(trpTree);
  const trpFolhas = [];
  const wt = (n) => (n.isFormation ? n.children.forEach(wt) : trpFolhas.push(n));
  trpTree.roots.forEach(wt);
  const trpBase = priceOfPicks([{ source: trpFonte, keep: trpChaves }], 'UKR', R)[0].price;
  const trpCrack = priceOfPicks([{ source: trpFonte, keep: trpChaves, xp: Object.fromEntries(trpFolhas.map((n) => [n.key, 'Crack'])) }], 'UKR', R)[0].price;
  ok(trpBase === trpCrack, `ponto de referencia nao paga experiencia: ${trpBase} cr dos dois jeitos`);

  // A defesa: o mesmo plano com a mesma semente custa o mesmo, com ou sem o fator ligado.
  const semXP = planDefense({ nation: 'RU', battleNumber: 3, rules: R, seed: 7, profile: 'urbano', effort: 1 });
  const comFator = JSON.parse(JSON.stringify(R));
  comFator.units.experienceFactor = { Conscript: 9, Green: 9, Regular: 9, Veteran: 9, Crack: 9, Elite: 9 };
  const outra = planDefense({ nation: 'RU', battleNumber: 3, rules: comFator, seed: 7, profile: 'urbano', effort: 1 });
  ok(semXP.cost === outra.cost && semXP.units === outra.units,
    `a defesa nao paga experiencia: ${semXP.units} unidades por ${semXP.cost} pontos nos dois casos`);
}

// 13. PROGRESSAO (plano 3, fase C). A unidade e comprada num nivel e ganha o resto lutando. Nada
//     aqui toca arquivo: e uma funcao pura de (forca, resultado, regras), e e por isso que a tela
//     pode mostrar o ganho antes de aplicar e receber a mesma resposta que a escrita.
//     Desde 13/09 (E50) a conta e por CONTAGEM e nao por xp: batalhas e vitorias no nivel atual,
//     e sobe quem cumprir qualquer uma das duas exigencias.
{
  const P = R.progression;
  const niveis = R.units.experienceLevels;
  const tabela = P.promotion.battles;
  ok(niveis.slice(0, -1).every((n) => tabela[n] > 0) && !tabela.Elite,
    `ha uma exigencia por nivel menos o Elite: ${niveis.slice(0, -1).map((n) => `${n} ${tabela[n]}`).join(' · ')} batalhas, com a vitoria valendo ${P.promotion.victoryWorth}`);
  ok(niveis.slice(0, -1).every((n, i) => i === 0 || tabela[n] >= tabela[niveis[i - 1]]), 'e cada degrau custa pelo menos o que custou o anterior');

  const um = (nivel, motivacao = 'Normal') => ({ coreId: 1, name: 'x', present: true, experience: nivel, motivation: motivacao });
  const batalha = (level, won, feridos = []) => ({ verdict: { level, won }, casualtiesToBuy: feridos.map((id) => ({ coreId: id })) });
  // Quantas batalhas com este resultado ate subir de nivel, comecando zerado.
  const sobeEm = (nivel, won, level = won ? 'Total Victory' : 'Draw') => {
    let rec = { battles: 0, wins: 0 };
    for (let n = 1; n <= 20; n++) {
      const g = progress({ units: [um(nivel)], attrs: {}, record: { 1: rec } }, batalha(level, won), R).gains[0];
      if (g.experience !== nivel) return n;
      rec = g.record.after;
    }
    return Infinity;
  };
  const errado = [];
  for (const n of niveis.slice(0, -1)) {
    const vit = Math.ceil(tabela[n] / P.promotion.victoryWorth);
    if (sobeEm(n, true) !== vit) errado.push(`${n}: ${sobeEm(n, true)} vitorias em vez de ${vit}`);
    if (sobeEm(n, null) !== tabela[n]) errado.push(`${n}: ${sobeEm(n, null)} empates em vez de ${tabela[n]}`);
    if (sobeEm(n, false) !== tabela[n]) errado.push(`${n}: ${sobeEm(n, false)} derrotas em vez de ${tabela[n]}`);
  }
  ok(!errado.length, `cada nivel sobe com ${niveis.slice(0, -1).map((n) => `${Math.ceil(tabela[n] / P.promotion.victoryWorth)}v ou ${tabela[n]}b`).join(' · ')}${errado.length ? ': ' + errado.join('; ') : ''}`);
  ok(sobeEm('Conscript', false) === 1, 'e o Conscript sobe com UMA batalha, seja ela o que for');
  ok(sobeEm('Crack', true) === 5, 'o ultimo degrau custa 5 vitorias, nao 6');
  ok(promotedFrom('Elite', { battles: 99, wins: 99 }, R) === null && !promotionNeed('Elite', R), 'o Elite nao tem degrau acima');

  // MISTURADO: o degrau do Crack custa 10, e a vitoria vale duas. Tres vitorias e quatro empates
  // somam 10 — sobe na setima batalha, e a folha zera no degrau.
  {
    let rec = { battles: 0, wins: 0 }, nivel = 'Crack';
    const seq = [true, null, true, null, true, null, null];
    const passos = seq.map((won) => {
      const g = progress({ units: [um(nivel)], attrs: {}, record: { 1: rec } }, batalha(won ? 'Total Victory' : 'Draw', won), R).gains[0];
      rec = g.record.after; nivel = g.experience;
      return `${g.record.points}${nivel !== 'Crack' ? '→' + nivel : ''}`;
    });
    ok(nivel === 'Elite' && rec.battles === 0 && rec.wins === 0, `tres vitorias e quatro empates somam 10 e promovem um Crack na setima, zerando a folha (${passos.join(' ')})`);
  }

  // Quem nao entrou nao conta, e ninguem e rebaixado.
  const uns = [um('Regular'), { coreId: 3, name: 'Dormant squad', present: false, experience: 'Regular', motivation: 'Normal' }, { coreId: 4, name: 'Bought Crack', present: true, experience: 'Crack', motivation: 'Normal' }];
  const g = progress({ units: uns, attrs: {}, record: {} }, batalha('Total Defeat', false), R);
  ok(!g.gains.find((x) => x.coreId === 3), 'quem nao entrou em campo nao conta batalha');
  ok(g.gains.find((x) => x.coreId === 4).experience === 'Crack', 'ninguem e rebaixado: a unidade comprada Crack continua Crack depois de uma derrota');
  ok(progress({ units: [um('Regular')], attrs: {}, record: {} }, batalha('Total Victory', true), R).gains[0].motivation === 'High'
    && g.gains[0].motivation === 'Low', 'a motivacao anda um passo por batalha, para cima na vitoria e para baixo na derrota');

  // O teto e o piso da motivacao seguram: doze vitorias nao fazem um esquadrao Fanatic.
  let mot = 'Normal';
  for (let i = 0; i < 12; i++) mot = progress({ units: [um('Regular', mot)], attrs: {}, record: {} }, batalha('Total Victory', true), R).gains[0].motivation;
  ok(mot === P.motivation.max, `a motivacao para no teto (${P.motivation.max}) depois de doze vitorias`);

  // A CAMPANHA INTEIRA. Com a tabela do autor, um Green que vence as doze chega a Elite na ultima
  // (1 + 2 + 3 + 6 = 12) e um Green que empata as doze chega a Crack na ultima (2 + 4 + 6 = 12).
  const corrida = (nivel, won) => {
    let rec = { battles: 0, wins: 0 };
    const chegou = {};
    for (let n = 1; n <= R.battlesToWin; n++) {
      const g = progress({ units: [um(nivel)], attrs: {}, record: { 1: rec } }, batalha(won ? 'Total Victory' : 'Draw', won), R).gains[0];
      if (g.experience !== nivel) chegou[g.experience] = n;
      nivel = g.experience; rec = g.record.after;
    }
    return { nivel, chegou };
  };
  const vencendo = corrida('Green', true), empatando = corrida('Green', null);
  ok(vencendo.nivel === 'Elite' && vencendo.chegou.Elite <= R.battlesToWin,
    `um Green que vence as doze chega a Elite na ${vencendo.chegou.Elite}a (${Object.entries(vencendo.chegou).map(([k, v]) => `${k} na ${v}`).join(', ')})`);
  ok(empatando.nivel === 'Crack' && empatando.chegou.Crack === R.battlesToWin,
    `e empatando as doze chega a Crack na ultima (${Object.entries(empatando.chegou).map(([k, v]) => `${k} na ${v}`).join(', ')})`);
  const conscrito = corrida('Conscript', true);
  ok(conscrito.nivel === 'Elite' && conscrito.chegou.Elite === R.battlesToWin,
    `e um Conscript que vence tudo chega a Elite na ultima (${Object.entries(conscrito.chegou).map(([k, v]) => `${k} na ${v}`).join(', ')})`);
}
// 14. A PAGINA. O codigo do navegador nao roda aqui, mas um nome que ninguem declara e um erro que
//     o `node --check` nao ve e que so aparece na tela do jogador — `app/web/lint.mjs` acha.
{
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, 'web', 'lint.mjs')], { encoding: 'utf8' });
  const queixa = (r.stdout || '').split('\n').filter((l) => l.startsWith('FALHA') || l.startsWith('      ')).join('; ');
  ok(r.status === 0, `app/web: todo nome usado na pagina esta declarado${queixa ? ' — ' + queixa : ''}`);
}

// 15. O VEREDITO. O CM compara o que voce fez com o que HAVIA para fazer, nao um lado com o outro
//     (FORMATO 114). O caso que pegou o erro: 500 pontos de 750 em jogo, com a defesa zerando, e o
//     jogo chamou de Major Victory — o app dizia Total, porque comparava os dois lados.
{
  const v = (p, e, disp) => levelFromPoints(p, e, R, disp).level;
  ok(v(500, 0, 750) === 'Major Victory', `500 de 750 com o inimigo zerado da ${v(500, 0, 750)} (o jogo disse Major Victory)`);
  ok(v(500, 0, 0) === 'Total Victory', 'sem os objetivos a leitura velha continua otimista, e e por isso que ela e so o ultimo recurso');
  ok(v(750, 0, 750) === 'Total Victory' && v(300, 0, 750) === 'Tactical Victory' && v(0, 750, 750) === 'Total Defeat',
    `a escala do veredito anda: 750 -> ${v(750, 0, 750)}, 300 -> ${v(300, 0, 750)}, 0 a 750 -> ${v(0, 750, 750)}`);
  ok(levelFromPoints(500, 0, R, 750).available === 750 && levelFromPoints(500, 0, R, 0).from === 'both sides',
    'o veredito diz de onde saiu a conta');
  // E93: a conta passou a ser a do manual (pp.89-90) — `V = (A + 10) / (B + 10)` e a fracao do
  // potencial DO VENCEDOR, com as faixas dele. O exemplo do proprio manual fecha a regra: 700 de
  // 1000 contra 150 da V = 4,44, que chega ao Total, mas 70% nao chega aos 80% — e Major.
  const ex = levelFromPoints(700, 150, R, 1000, 1000);
  ok(ex.level === 'Major Victory' && Math.abs(ex.ratio - 4.4375) < 0.001,
    `o exemplo do manual: V ${ex.ratio.toFixed(2)} com 70% do potencial da ${ex.level}`);
  ok(v(580, 0, 1000) === 'Major Victory' && v(320, 0, 1000) === 'Tactical Victory',
    `e a borda anda com as faixas do manual: 58% -> ${v(580, 0, 1000)} (era Tactical), 32% -> ${v(320, 0, 1000)} (era Minor)`);
  // O +10 do manual muda o veredito nos numeros pequenos, que sao os desta campanha: 40 x 20 e
  // V = 1,67, e nao 2,0 — Minor, nao Tactical.
  const pequeno = levelFromPoints(40, 20, R, 100, 100);
  ok(pequeno.level === 'Minor Victory' && Math.abs(pequeno.ratio - 5 / 3) < 0.001,
    `40 x 20 de 100: V ${pequeno.ratio.toFixed(2)} (sem o +10 seria 2,00) -> ${pequeno.level}`);
}

// 16. DE QUE EXERCITO E A UNIDADE. O arquivo declara UMA nacao por batalha (FORMATO 108) mesmo
//     quando a forca mistura americanos e ucranianos, entao quem sabe e o app: a primeira parte da
//     chave da unidade e o indice da escolha que a trouxe.
{
  const st = { nation: 'US', picks: [{ nation: 'US' }, { nation: 'UKR' }] };
  ok(nationOfUnit(st, { key: '1.3.0' }) === 'UKR', 'a unidade da segunda escolha e ucraniana, e a forca inteira e americana');
  ok(nationOfUnit(st, { key: '0.2' }) === 'US', 'a da primeira e americana');
  ok(nationOfUnit(st, { key: '9.0' }) === 'US', 'chave sem escolha correspondente cai na nacao da campanha');
  ok(nationOfUnit(st, {}) === 'US', 'e unidade sem chave nenhuma tambem');
}

// 17. O SAVE ERRADO. Tres arquivos na pasta de saves passam por tudo o que o app conferia antes e
//     mesmo assim corrompem a campanha em silencio. Os numeros abaixo sao medidos nos saves do
//     autor (`tools/re/scratch/h8_classificar_saves.mjs` roda a mesma conta na pasta de verdade).
{
  const tmp = path.join(os.tmpdir(), `cmbs-teste-${process.pid}.btt`);
  fs.writeFileSync(tmp, Buffer.from('a batalha que esta esperando'));
  const daBatalha = sha1(fs.readFileSync(tmp));
  const entregue = 'ffffffffffffffffffffffffffffffffffffffff';
  const st = {
    slug: 'NAO-EXISTE', seenSaves: ['C:\\ja\\lido.bts'],
    current: { n: 3, bttFile: tmp, handed: [{ file: 'C:\\jogo\\preparado.bts', sha1: entregue }] },
  };
  const facts = (extra) => ({ liveBytes: 500, sha1self: 'aa', battles: [{ sha1: daBatalha }], embedded: ['A'], ...extra });
  const kind = (extra, file = 'C:\\jogo\\qualquer.bts') => inspectSave(st, facts(extra), file).kind;

  ok(kind({}) === 'ready', 'o save da transicao desta batalha e o unico que passa');
  ok(kind({ liveBytes: 968073 }) === 'in-battle',
    'o save de meio de batalha e recusado pelo bloco da partida em curso (o menor medido, 968.073 B, contra 572 B do maior de transicao)');
  ok(kind({ liveBytes: 572 }) === 'ready', 'e o maior save de transicao medido continua passando');
  ok(kind({ sha1self: entregue }) === 'prepared', 'o arquivo que o app entregou nao volta como se fosse jogado, mesmo renomeado');
  ok(inspectSave(st, facts(), 'C:\\jogo\\preparado.bts').kind === 'prepared', 'nem pelo caminho');
  ok(kind({ battles: [{ sha1: 'outra' }] }) === 'other-battle', 'um save que nao carrega a batalha que esta esperando e de outra batalha');
  ok(inspectSave(st, facts(), 'C:\\ja\\lido.bts').kind === 'already-read', 'e o que ja foi lido nao e lido duas vezes');
  ok(inspectSave(st, null, 'C:\\jogo\\x.bts').kind === 'not-a-save', 'o que nao e save do jogo diz isso');
  ok(LIVE_BATTLE_BYTES > 572 && LIVE_BATTLE_BYTES < 968073, `o limiar (${LIVE_BATTLE_BYTES} B) fica entre os dois grupos, com tres ordens de grandeza de folga`);
  fs.rmSync(tmp, { force: true });
}

// 18. OS PARAMETROS DA CAMPANHA. A biblioteca virou um conjunto de exercitos e o inimigo um lado;
//     os dois sao escolhidos uma vez e uma campanha em andamento nao pode mudar por baixo.
{
  ok(armiesOf(['RU', 'US']).join() === 'US,RU', 'a lista chega na ordem canonica, nao na ordem em que ele clicou');
  ok(armiesOf('US,UKR').join() === 'US,UKR', 'e tambem vem da query string, separada por virgula');
  ok(armiesOf(['US', 'US', 'XX']).join() === 'US', 'repetido entra uma vez so e exercito inventado nao entra');
  ok(armiesOf([]).join() === 'US,UKR', 'lista vazia cai no padrao em vez de dar uma biblioteca vazia');

  ok(enemyArmies({ enemyArmies: ['US', 'UKR'] }).join() === 'US,UKR', 'o lado americano defende com os dois exercitos');
  ok(enemyArmies({ enemy: 'US' }).join() === 'US', 'e a campanha antiga continua com o exercito que ela ja tinha');

  ok(rescueChanceOf({ rescueChance: 0 }, R) === 0, 'chance zero e uma escolha, nao um campo em branco');
  ok(rescueChanceOf({ rescueChance: 0.75 }, R) === 0.75, 'a campanha manda na chance do socorrido');
  ok(rescueChanceOf({}, R) === R.replacement.rescueChance, 'sem escolha vale o que a regra oferece');
  ok((R.replacement.rescueChanceOptions || []).join() === '0,0.25,0.5,0.75,1', 'as opcoes oferecidas sao as cinco');

  // O rotulo "United States and Ukraine" so e honesto se as duas armas defenderem de verdade.
  const quem = new Set();
  for (let b = 1; b <= 12; b++) quem.add(planDefense({ nations: ['US', 'UKR'], battleNumber: b, rules: R, seed: 12345, profile: 'misto', effort: 0.25 }).nation);
  ok(quem.has('US') && quem.has('UKR'), `numa campanha contra o lado americano defendem ${[...quem].join(' e ')}`);
  ok(planDefense({ nation: 'RU', battleNumber: 1, rules: R, seed: 1, profile: 'misto', effort: 1 }).nation === 'RU',
    'e uma nacao so continua sendo uma nacao so');
}

// 19. AS ARMAS. Cada `classe/item` tem um nome lido do tooltip do jogo, e o nome tem de ser um dos
//     que o jogo sabe escrever — o dicionario sai de `strings.txt`, dentro de `black sea v217.brz`.
//     Um erro de digitacao aqui vira uma arma que nao existe na tela do jogador.
{
  const f = path.join(import.meta.dirname, '..', 'research', 'armas.json');
  if (!fs.existsSync(f)) {
    ok(false, 'research/armas.json existe');
  } else {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const armas = Object.entries(j.armas || {});
    ok(armas.length > 0, `${armas.length} armas nomeadas`);

    // A classe 5 entrou em 09/09/2026: e a dos misseis e canhoes sem recuo carregados por homem
    // (SPG-9, SKIF, AT-4C), e ela nao existia em nenhum dos 115 saves antigos — so apareceu quando
    // a forca foi montada de proposito com esquadras de ATGM e recoilless.
    // A classe 7 entrou em 28/09/2026 (E108): os TUBOS DE MORTEIRO das equipes (M224A1, M120, 2B14,
    // 2B11), vistos pela primeira vez na colheita de fabrica, que cobriu a biblioteca inteira.
    const maus = armas.filter(([par]) => !/^[234578]\/\d+$/.test(par)).map(([p]) => p);
    ok(!maus.length, `toda chave e classe/item${maus.length ? ': ' + maus.join(', ') : ''}`);

    // Duas classes diferentes podem ter o mesmo nome (a PKM do esquadrao e a da equipe). Dois ids da
    // MESMA classe tambem podem, e isso so ficou provado em 17/09 (E66): o painel escreve "AK-74"
    // para 2/24 e 2/25, "AKS-74" para 2/27 e 2/28 e o mesmo rotulo de canhao para 3/52 e 3/53. Ate
    // ali este teste chamava a repeticao de leitura trocada, e teria mandado apagar leitura boa.
    // O que ele cobra agora e que a repeticao seja DECLARADA: as duas entradas tem de se apontar
    // pelo campo gemeo. Copiar um nome por engano continua caindo aqui; saber que sao dois ids com
    // um nome passa.
    // E DESDE 17/09 (E70) HA UM TERCEIRO CASO, que e o mais comum de todos: o MESMO nome em
    // exercitos DIFERENTES. O id e por exercito (118.1), entao a PKM ucraniana e a russa TEM de ter
    // ids diferentes — `3/37` e `3/38` —, e exigir `gemeo` ali seria exigir que duas armas de
    // paises diferentes se declarassem a mesma. A chave passou a ser (classe, lado).
    const porClasse = {};
    const repetidos = [];
    const porPar = new Map(armas);
    for (const [par, v] of armas) {
      const c = `${par.split('/')[0]}|${v.lado || '?'}`;
      porClasse[c] = porClasse[c] || new Map();
      const antes = porClasse[c].get(v.nome);
      if (antes && !(v.gemeo === antes && porPar.get(antes)?.gemeo === par)) {
        repetidos.push(`${v.nome} (${v.lado || 'sem lado'}): ${antes} e ${par}${v.gemeo || porPar.get(antes)?.gemeo ? ' (o gemeo nao fecha)' : ''}`);
      }
      porClasse[c].set(v.nome, par);
    }
    ok(!repetidos.length, `nome repetido na mesma classe E no mesmo exercito so quando declarado gemeo${repetidos.length ? ': ' + repetidos.join('; ') : ''}`);
    // E o `lado` deixou de ser opcional: sem ele nao ha como saber se um nome repetido e outra arma
    // ou a mesma lida duas vezes.
    const semLado = armas.filter(([, v]) => !v.lado).map(([p]) => p);
    ok(!semLado.length, `toda arma nomeada diz de que exercito e${semLado.length ? ' — sem lado: ' + semLado.join(', ') : ''}`);

    // E o gemeo tem de ser reciproco e do mesmo nome, senao o campo nao vale de nada.
    const gemeos = armas.filter(([, v]) => v.gemeo);
    const tortos = gemeos.filter(([par, v]) => porPar.get(v.gemeo)?.gemeo !== par || porPar.get(v.gemeo)?.nome !== v.nome).map(([p]) => p);
    ok(!tortos.length, `${gemeos.length / 2} pares de gemeos, cada um apontando de volta${tortos.length ? ' — torto: ' + tortos.join(', ') : ''}`);

    // O NOME NA TELA PODE SER DUAS ENTRADAS DO DICIONARIO JUNTAS: o painel escreve "AT-7" no rotulo
    // e a caixa de equipamento escreve "Saxhorn", e o que vai para ca e "AT-7 Saxhorn". Nenhum dos
    // dois esta no dicionario como uma linha so — ja "M4A1 ACOG" e "M25 CDTE" estao. Entao: vale o
    // nome inteiro, e se ele nao existir inteiro vale palavra por palavra, cada palavra tendo de
    // existir. E assim que erro de digitacao continua caindo aqui.
    const cand = path.join(import.meta.dirname, '..', 'research', 'armas_candidatas.json');
    if (fs.existsSync(cand)) {
      const vocab = new Set(JSON.parse(fs.readFileSync(cand, 'utf8')).vocabulario || []);
      const fora = armas.filter(([, v]) => !vocab.has(v.nome))
        .map(([p, v]) => [p, v, v.nome.split(' ').filter((w) => !vocab.has(w))])
        .filter(([, , faltam]) => faltam.length)
        .map(([p, v, faltam]) => `${p}=${v.nome} (nao existe: ${faltam.join(' ')})`);
      ok(!fora.length, `todo nome esta no dicionario do jogo, inteiro ou palavra por palavra${fora.length ? ': ' + fora.join(', ') : ''}`);
    }

    const confirmadas = armas.filter(([, v]) => v.confianca === 'confirmado').length;
    ok(confirmadas >= 14, `${confirmadas} armas confirmadas por posicao no roster (${armas.length - confirmadas} ainda indicadas)`);
  }
}

// 20. QUEM REPOE A MUNICAO. Sao dois botoes e nao um, desde 08/09 (FORMATO 119): o RESSUPRIMENTO
//     que vai para o arquivo da campanha e o que o JOGO faz na virada, e ligado em 100 ele escreve o
//     roster SEM o inventario dos homens — some a arma, some a municao, e com elas a coluna
//     "carrying" da tela de Pessoal e qualquer tela de equipar. Quem repoe e o refit do app, por um
//     caminho provado em jogo (E33). Este teste existe para que voltar o numero do jogo para 100
//     seja uma decisao, e nao um acidente.
{
  const doJogo = campaignPercentages(R);
  ok(doJogo.length === 8, 'os oito bytes da campanha: quatro por lado');
  ok(doJogo[2] === 0 && doJogo[6] === 0,
    `o ressuprimento do JOGO fica em ${doJogo[2]}: ligado, ele apaga o inventario do roster`);
  ok((R.replacement.appResupply ?? 0) > 0,
    `e quem repoe e o app, com ${(R.replacement.appResupply * 100)}% da dotacao`);
  // O acoplamento antigo: o mesmo numero mandava nos dois, entao desligar o do jogo desligava o do
  // app junto e a tropa entrava na batalha sem municao nenhuma.
  ok(R.replacement.appResupply !== doJogo[2] / 100 || doJogo[2] === 100,
    'os dois numeros sao independentes: o do app nao segue o do jogo');
  ok(doJogo[0] === 0 && doJogo[4] === 0, 'REFIT continua em 0: reposicao de homem e de maquina se compra no quartel-mestre');
  ok(doJogo[1] === 100 && doJogo[3] === 100, 'REPAIR e REST continuam em 100');
}

// 21. A LINHA DE BASE DA CAMPANHA. A colheita global (`toe_armas.json`) e a media de 115 saves de
//     outra gente e nao conhece toda vaga; a campanha aprende a maior carga que ja viu em cada uma e
//     essa memoria entra por cima. O que este teste guarda e a regra que a medicao imps: a mistura
//     das duas so pode SUBIR, nunca descer — um homem de pe com cinco balas nao pode virar a dotacao
//     de uma vaga (FORMATO 113.3).
{
  const global = { 100: { 0: { municao: { 2: 210 }, arma: '2/2' } } };
  const state = { baseline: { 100: { 0: { municao: { 2: 5, 7: 45 } } }, 200: { 1: { municao: { 1: 300 } } } } };
  // `baselineTable` le a colheita do disco, entao aqui a mistura e conferida na mao com a mesma
  // regra que ela usa — o teste vale a regra, nao o arquivo.
  const mistura = (g, m) => {
    const out = { ...(g || {}) };
    for (const [item, qtd] of Object.entries(m?.municao || {})) if (!(out[item] >= qtd)) out[item] = qtd;
    return out;
  };
  const r = mistura(global[100][0].municao, state.baseline[100][0]);
  ok(r[2] === 210, `a memoria pobre nao derruba a colheita: 210 contra 5 da ${r[2]}`);
  ok(r[7] === 45, 'e o que so a memoria conhece entra');
  const r2 = mistura(undefined, state.baseline[200][1]);
  ok(r2[1] === 300, 'vaga que a colheita nao conhece fica com o que a campanha viu');
  const r3 = mistura({ 2: 100 }, { municao: { 2: 1506 } });
  ok(r3[2] === 1506, 'e a memoria melhor ganha: 1506 contra 100');
}

// 22. ON MAP / OFF MAP: A BATERIA ORGANICA E FORA DO MAPA (reescrito 29/10, autor: "neste caso nem existe a opcao
//     on-map desta artilharia"). Ate aqui este teste guardava nove pares "no mapa / fora" — e o lado "no mapa" de todos
//     era a bateria organica do batalhao (registro sem posicao), que o jogo poe fora do mapa sempre. A premissa nova:
//     nenhum par (o botao on/off nao aparece), e a organica conta como fora do mapa na biblioteca e na poda, enquanto os
//     tubos de verdade do mesmo batalhao (Heavy Mortar Team) contam no mapa.
{
  const t = deploymentTwins(['US', 'UKR', 'RU'], { rules: R });
  ok(Object.keys(t).length === 0, `(22) nenhum par on/off map: a copia "no mapa" era a bateria organica (${Object.keys(t).join(', ') || 'nenhum'})`);
  const fonte = 'UKR - Tactical Group (Battalion [BTR]).btt';
  const tree = formationTree(fonte);
  let bateria = null, org = null;
  const anda = (n) => { if (n.isFormation && n.name === 'Battery (Mortar)' && !bateria) bateria = n; if (n.organic && /^\d+ x /.test(n.name) && !org) org = n; n.children.forEach(anda); };
  tree.roots.forEach(anda);
  const chaves = [];
  if (bateria) { const sob = (n) => { chaves.push(n.key); n.children.forEach(sob); }; sob(bateria); }
  const plano = bateria ? prunePlan(tree, chaves) : null;
  const tubos = plano ? plano.keptUnits.filter((u) => u.name === 'Heavy Mortar Team').length : 0;
  ok(!!org && org.offMapUnits === 1 && !!plano && plano.offMapKept === 1 && tubos === 3 && plano.onMapKept === plano.unitsKept - 1,
    `(22) ${fonte}: o ${org?.name} organico conta fora do mapa (offMapUnits ${org?.offMapUnits}, na poda ${plano?.offMapKept} de ${plano?.unitsKept}); os ${tubos} Heavy Mortar Team no mapa`);
  // toda bateria organica "N x" da biblioteca conta fora do mapa
  const ruins = []; let vistas = 0;
  for (const f of ['US', 'RU', 'UKR'].flatMap((n) => libFormations(n))) {
    let tr; try { tr = formationTree(f.file); } catch { continue; }
    const v = (n) => { if (!n.isFormation && n.organic && /^\d+ x /.test(n.name)) { vistas++; if (n.offMapUnits !== 1) ruins.push(`${f.source} > ${n.name}`); } n.children.forEach(v); };
    tr.roots.forEach(v);
  }
  ok(vistas > 20 && !ruins.length, `(22) as ${vistas} baterias organicas "N x" da biblioteca contam fora do mapa${ruins.length ? ' — ' + ruins.slice(0, 3).join('; ') : ''}`);
}

// 23. A TRIPULACAO VAI COM A MAQUINA. O quartel-mestre listava a tripulacao de um BMP-2 entre as
//     reposicoes de infantaria, e repor o veiculo ja traz tripulacao nova (o gemeo dormente entra em
//     campo completo, 112.8). Guarda quem conta como tripulacao — e quem NAO conta.
{
  const state = { units: [
    { coreId: 44, name: 'Infantry Fighting Vehicle (BMP-2) #2', role: 'ifv', present: true },
    { coreId: 42, name: 'Squad (Rifle) #3', role: 'infantry', present: true },
    { coreId: 90, name: 'Main Battle Tank (T-64BV)', role: 'tank', present: false },
  ] };
  const baixas = [
    { index: 1, coreId: 44, wounded: true }, { index: 2, coreId: 44, wounded: false },
    { index: 3, coreId: 42, wounded: false }, { index: 4, coreId: 90, wounded: false }, { index: 5, coreId: null },
  ];
  const t = machineCrew(state, baixas, { offMap: new Set() });
  ok(t.map((c) => c.index).join() === '1,2,4', `os homens de maquina sao tripulacao (${t.map((c) => c.index).join()})`);
  ok(!t.some((c) => c.coreId === 42), 'e a esquadra de fuzileiros continua na lista de reposicoes');
  // MUDOU EM 27/09: ate aqui a conta exigia `present`, e por isso a maquina FORA da forca tinha a
  // tripulacao tratada como infantaria. O caso real do autor mostrou o preco disso: o BMP-2M #1 da
  // RUS1 queimou na batalha 1, foi reposto (saiu da forca, present=false) e o morto dele continuou
  // a venda por 30 cr em toda batalha seguinte — um homem de uma maquina que nao existe mais.
  // Tripulacao e tripulacao esteja a maquina em campo ou nao; quem volta, volta com ela.
  ok(t.some((c) => c.coreId === 90), 'maquina fora da forca tambem tem tripulacao, nao infantaria');
  ok(!t.some((c) => c.coreId === null), 'e baixa sem unidade conhecida fica onde estava');
  ok(!machineCrew(state, [{ index: 6, coreId: 44 }], { offMap: new Set([44]) }).length, 'maquina fora do mapa nao tem tripulacao para perder');
  ok(Array.isArray(R.replacement.machineRoles) && R.replacement.machineRoles.includes('ifv'),
    'a lista de maquinas mora nas regras, e a tela le a mesma');
}

// 24. COMPRAR DESTAPA A FORMACAO. A poda da criacao mascara a subformacao inteira — o registro do
//     pelotao e cada filho — e o jogo esconde a subarvore toda. Ligar so os filhos deixou o pelotao
//     de engenheiros que o autor comprou invisivel na batalha 2 (FORMATO 112.14). O caminho aqui e o
//     da campanha, peca a peca: podar, marcar como core, ligar por core id.
{
  const lib = path.join(paths().lib, 'UKR - Tactical Group (Battalion [BTR]).btt');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-t24-'));
  const podada = path.join(tmp, 'podada.btt'), core = path.join(tmp, 'core.btt'), ligada = path.join(tmp, 'ligada.btt');
  pruneFormation(lib, podada, /Tactical Group/, [{ nome: 'Platoon (Engineer)', ocorrencia: 1 }]);
  markAsCore(podada, core);
  const eng = unitDirectory(core).filter((u) => /Platoon \(Engineer\)/.test(u.formation));
  ok(eng.length === 5 && eng.every((u) => !u.present), `a poda desliga as ${eng.length} unidades da Platoon (Engineer)`);
  ok(presentUnderMask(core).length === 0, 'e nada fica ligado debaixo de formacao mascarada');
  const r = activateCore(core, ligada, eng.map((u) => u.coreId), { presente: true });
  ok(r.mudados.length === 5, `ligar por core id liga as cinco (${r.mudados.length})`);
  ok((r.formacoes || []).some((f) => /Platoon \(Engineer\)/.test(f)), `e destapa a formacao-mae (${(r.formacoes || []).join(', ') || 'nenhuma'})`);
  ok(presentUnderMask(ligada).length === 0, 'a forca sai sem unidade ligada sob mascara');
  ok(unitDirectory(ligada).filter((u) => /Platoon \(Engineer\)/.test(u.formation)).every((u) => u.present), 'e as cinco estao em campo');
  // Ligar nao cria nem some com unidade: o diretorio tem o mesmo tamanho antes e depois. (O ARQUIVO
  // muda de tamanho, e isso e normal: o fluxo e recodificado e o escape do jogo e um RLE — E14C.)
  ok(unitDirectory(core).length === unitDirectory(ligada).length, `a forca continua com as mesmas ${unitDirectory(core).length} unidades core`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 25. O PAIOL E UMA LISTA, NAO UMA CACA AO ID (E40). O T-64BV do autor tem o item 24 (125mm) e um
//     `u16 24` logo antes do contador da lista; o localizador antigo viu ali "item 24 com 5 tiros",
//     preferiu-o por ser o mais fundo e escreveu 10 em cima do contador — o jogo leu dez pares onde
//     havia cinco e o save deu "Out of memory". Este teste e o rabo real do tanque, byte a byte.
{
  const u16 = (...vs) => Buffer.from(vs.flatMap((v) => [v & 0xff, v >> 8]));
  const cabeca = Buffer.alloc(40, 0);
  // `0001 0007 | 0018 (o falso "item 24") | n=5 | (5,1240) (8,150) (24,8) (31,11) (36,8) | m=0 | x=9 | ff ff`
  const rabo = u16(1, 7, 24, 5, 5, 1240, 8, 150, 24, 8, 31, 11, 36, 8, 0, 9, 0xffff);
  const exp = Buffer.concat([cabeca, rabo, Buffer.alloc(8, 0)]);
  const u = { ini: 0, ff: cabeca.length + rabo.length - 2, coreId: 81, tipo: 8964 };
  const T64 = { 24: 10, 31: 11, 36: 15 };
  const leituras = lerRabo(exp, u);
  ok(leituras.length === 1, `o rabo do T-64BV tem uma leitura so (${leituras.length})`);
  ok(leituras[0] && leituras[0].n === 5 && leituras[0].m === 0 && leituras[0].forma === 'veiculo', 'e ela e n=5, m=0, forma de veiculo');
  const p = acharPaiol(exp, u, T64);
  ok(p.length === 3 && p.map((s) => s.item).join() === '24,31,36', `acha os tres itens do 125mm (${p.map((s) => s.item).join()})`);
  const i24 = p.find((s) => s.item === 24);
  // O par (24, 8) e o 9o u16 do rabo; o 24 do cabecalho e o 3o.
  ok(i24 && i24.tem === 8 && exp.readUInt16LE(i24.p) === 24 && i24.p === cabeca.length + 2 * 8, `o item 24 e o par (24, 8) da lista, nao o 24 do cabecalho (tem=${i24 && i24.tem}, p=${i24 && i24.p - cabeca.length})`);
  ok(p.faltando.length === 0, 'nada esgotado: os tres estao na lista');
  // O tanque que gastou todo o 125mm: a lista encolheu para dois pares e o 24 do cabecalho ficou.
  const rabo2 = u16(1, 7, 24, 2, 5, 254, 8, 150, 0, 0, 0xffff);
  const exp2 = Buffer.concat([cabeca, rabo2, Buffer.alloc(8, 0)]);
  const u2 = { ini: 0, ff: cabeca.length + rabo2.length - 2, coreId: 82, tipo: 8964 };
  const p2 = acharPaiol(exp2, u2, T64);
  ok(p2.length === 0, `sem par de 125mm na lista, nada e escrito — nem no 24 do cabecalho (${p2.length})`);
  // E o canhao, que nao tem o u16 final: `n=3 | (37,136) (522,1) (124,18) | m=0 | ff ff`.
  const rabo3 = u16(3, 37, 136, 522, 1, 124, 18, 0, 0xffff);
  const exp3 = Buffer.concat([cabeca, rabo3, Buffer.alloc(8, 0)]);
  const u3 = { ini: 0, ff: cabeca.length + rabo3.length - 2, coreId: 218, tipo: 2569 };
  const p3 = acharPaiol(exp3, u3, { 37: 169, 522: 7 });
  ok(p3.length === 2 && p3.rabo.forma === 'canhao' && p3.find((s) => s.item === 37).tem === 136, `o obus le como canhao: ${p3.map((s) => `${s.item}=${s.tem}`).join(' ')}`);
}

// 26. O PAR QUE ZEROU VOLTA NO LUGAR CERTO (E41). O BTR-4E do autor gastou os 180 de 30mm HE-I e o
//     jogo tirou o par da lista; repor e inserir `(92, 180)` entre o 7,62 e o APDS, onde o jogo o
//     escreve, e somar um ao n. E nunca num veiculo que nao usa aquele item: o M119A3 tem duas
//     familias de municao que nao se misturam.
{
  const u16 = (...vs) => Buffer.from(vs.flatMap((v) => [v & 0xff, v >> 8]));
  const cabeca = Buffer.alloc(40, 0);
  // BTR-4E sem o 92: `n=4 | (5,1154) (94,44) (12,62) (519,2) | m=3 | (1,2160) (5,1500) (41,5) | x=9 | ff ff`
  const rabo = u16(4, 5, 1154, 94, 44, 12, 62, 519, 2, 3, 1, 2160, 5, 1500, 41, 5, 9, 0xffff);
  const exp = Buffer.concat([cabeca, rabo, Buffer.alloc(8, 0)]);
  const u = { ini: 0, ff: cabeca.length + rabo.length - 2, coreId: 52, tipo: 19972 };
  const BTR = { 5: 1200, 12: 149, 92: 180, 94: 180, 519: 2 };
  const seqs = [[5, 94, 12, 519], [5, 92, 94, 12, 519]];
  const p = acharPaiol(exp, u, BTR, 'veiculo');
  ok(p.faltando.join() === '92', `o 30mm HE-I (92) esta esgotado (${p.faltando.join()})`);
  const plano = planoDeInsercao(p.rabo, p.faltando, BTR, seqs, 1);
  ok(plano && plano.length === 1 && plano[0].item === 92 && plano[0].qtd === 180, 'o plano poe o 92 de volta com 180');
  ok(plano && plano[0].p === p.rabo.paiol[1].p, 'e antes do APDS (94), onde o jogo o escreve');
  const novo = inserirPares(exp, [{ pn: p.rabo.pn, n: p.rabo.n, novos: plano }]);
  ok(novo.length === exp.length + 4, `o expandido cresce 4 bytes (${novo.length - exp.length})`);
  const u2 = { ...u, ff: u.ff + 4 };
  const p2 = acharPaiol(novo, u2, BTR, 'veiculo');
  ok(p2.rabo.n === 5 && p2.rabo.m === 3 && p2.rabo.paiol.map((s) => s.item).join() === '5,92,94,12,519', `a lista gravada le n=5 na ordem do jogo (${p2.rabo.paiol.map((s) => s.item).join()})`);
  ok(p2.rabo.carga.map((s) => `${s.item}:${s.qtd}`).join() === '1:2160,5:1500,41:5' && p2.rabo.x === 9, 'e a carga e o x nao se mexeram');
  ok(p2.faltando.length === 0, 'nada mais esgotado');
  // Metade da dotacao com fracao 0,5; e nada com fracao 0.
  ok(planoDeInsercao(p.rabo, p.faltando, BTR, seqs, 0.5)[0].qtd === 90, 'a fracao vale para o par novo');
  ok(planoDeInsercao(p.rabo, p.faltando, BTR, seqs, 0) === null, 'com fracao zero nao ha o que inserir');
  // O tanque que gastou todo o 125mm recebe os tres pares NO FIM e NA ORDEM do jogo (24, 31, 36),
  // nao invertidos — foi o que a primeira insercao fez.
  const raboT = u16(1, 7, 24, 2, 5, 254, 8, 150, 0, 0, 0xffff);
  const expT = Buffer.concat([cabeca, raboT, Buffer.alloc(8, 0)]);
  const uT = { ini: 0, ff: cabeca.length + raboT.length - 2, coreId: 82, tipo: 8964 };
  const T64 = { 5: 1240, 8: 150, 24: 10, 31: 11, 36: 15 };
  const pT = acharPaiol(expT, uT, T64, 'veiculo');
  const planoT = planoDeInsercao(pT.rabo, pT.faltando, T64, [[5, 8, 24, 31, 36], [5, 8]], 1);
  const novoT = inserirPares(expT, [{ pn: pT.rabo.pn, n: pT.rabo.n, novos: planoT }]);
  const pT2 = acharPaiol(novoT, { ...uT, ff: uT.ff + 12 }, T64, 'veiculo');
  ok(pT2.rabo.n === 5 && pT2.rabo.paiol.map((s) => s.item).join() === '5,8,24,31,36', `os tres de 125mm entram no fim, na ordem do jogo (${pT2.rabo.paiol.map((s) => s.item).join()})`);
  // O M119A3 de (196, 204) nunca recebe o 37: nenhuma sequencia observada tem os dois.
  const rabo3 = u16(2, 196, 105, 204, 30, 0, 0xffff);
  const exp3 = Buffer.concat([cabeca, rabo3, Buffer.alloc(8, 0)]);
  const u3 = { ini: 0, ff: cabeca.length + rabo3.length - 2, coreId: 951, tipo: 1545 };
  const M119 = { 37: 117, 124: 12, 196: 105, 204: 30, 522: 12 };
  const p3 = acharPaiol(exp3, u3, M119, 'canhao');
  ok(p3.faltando.join() === '37,124,522', `o M119A3 de 196/204 acusa 37/124/522 como ausentes (${p3.faltando.join()})`);
  ok(planoDeInsercao(p3.rabo, p3.faltando, M119, [[37, 522, 124], [196, 204]], 1) === null, 'e nenhum entra: as duas familias nunca se misturam');
}

// 27. O AAR DO SAVE E O ACUMULADO DA CAMPANHA (FORMATO 111.13, corrigido 12/09). A batalha 3 da
//     EASY-BECAUSE leu 350-150 do bloco e a tela do jogo disse 150-150, Draw; os oito campos do
//     bloco eram a soma das tres batalhas. O que a batalha fez e o bloco menos o bloco anterior.
{
  const b2 = { mortos: 10, feridos: 11, desaparecidos: 0, tanques: 1, blindados: 2, outrosVeiculos: 0, aeronaves: 0, pontos: 200 };
  const b3 = { mortos: 26, feridos: 22, desaparecidos: 0, tanques: 3, blindados: 2, outrosVeiculos: 0, aeronaves: 0, pontos: 350 };
  const d = aarDelta(b3, b2);
  ok(d && d.mortos === 16 && d.feridos === 11 && d.tanques === 2 && d.blindados === 0 && d.pontos === 150, `a batalha 3 do autor: 16 mortos, 11 feridos, 2 tanques, 150 pontos (${JSON.stringify(d)})`);
  const e2 = { mortos: 50, feridos: 19, desaparecidos: 6, tanques: 0, blindados: 9, outrosVeiculos: 0, aeronaves: 0, pontos: 0 };
  const e3 = { mortos: 71, feridos: 34, desaparecidos: 7, tanques: 0, blindados: 14, outrosVeiculos: 2, aeronaves: 0, pontos: 150 };
  const de = aarDelta(e3, e2);
  ok(de && de.mortos === 21 && de.feridos === 15 && de.desaparecidos === 1 && de.blindados === 5 && de.outrosVeiculos === 2 && de.pontos === 150, `e o inimigo: 21/15/1, 5 blindados, 2 outros, 150 pontos — a tela do AAR ao pe da letra`);
  ok(aarDelta(b2, AAR_ZERO).pontos === 200 && aarDelta(b2, null) === b2, 'antes da batalha 1 a base e zero, e sem base o bloco vale como esta');
  ok(aarDelta(b2, b3) === null, 'um campo negativo diz que o bloco NAO e acumulado, e a leitura cai no bruto');
  // E o veredito com os numeros certos: 150 x 150 de 600 e Draw, nao Tactical Victory.
  const v = levelFromPoints(150, 150, R, 600);
  ok(v.level === 'Draw' && v.won === null, `150 x 150 de 600 e ${v.level}`);
  ok(levelFromPoints(350, 150, R, 602).level === 'Tactical Victory', 'e era o acumulado que dava Tactical');
}

// 28. A NOTA DA BATALHA (autor, 12/09; a escada, 30/10): tres fracoes — objetivos, baixas do inimigo, forca que voltou —
//     e nenhuma precisa de vitoria. Fora do mapa nao conta em lado nenhum, e sobreviver sem lutar (cessar-fogo no 1o
//     turno) vale zero. A nota multiplica a cobertura de reposicao e o bonus.
{
  const RR = { ...R, reward: { ...R.reward, weights: { objectives: 0.5, attrition: 0.3, survival: 0.3 }, vehicleShare: 0.5, survivalNeedsEngagement: true } };
  const state = {
    current: { defense: { cost: 1000 }, enemyUnits: [
      { name: 'Squad (Rifle)', type: [58, 4], present: true, offMap: false },         // tipo com n na tabela
      { name: 'Infantry Fighting Vehicle (BMP-2)', type: [37, 5], present: true, offMap: false },
      { name: '2 x 120mm Mortar (2B11)', type: [1, 1], present: true, offMap: true },  // fora do mapa: nao conta
    ] },
    units: [
      { coreId: 1, name: 'Squad (Rifle)', role: 'infantry', present: true },
      { coreId: 2, name: 'Main Battle Tank (T-64BV)', role: 'tank', present: true },
      { coreId: 3, name: 'Main Battle Tank (T-64BV)', role: 'tank', present: false },
    ],
  };
  const menOf = (val, tab) => { const t = Object.values(JSON.parse(fs.readFileSync(paths().typeTable, 'utf8')).tipos || JSON.parse(fs.readFileSync(paths().typeTable, 'utf8'))).find((x) => x.val === val && x.tab === tab); return t ? t.n : 0; };
  const enemyMen = menOf(58, 4) + menOf(37, 5);
  const result = {
    verdict: { available: 600 },
    aar: { player: { pontos: 300, tanques: 0, blindados: 0, outrosVeiculos: 0 }, enemy: { mortos: Math.round(enemyMen / 2), feridos: 0, desaparecidos: 0, tanques: 0, blindados: 1, outrosVeiculos: 0 } },
    units: [{ coreId: 1, instantiated: 6, alive: 3 }, { coreId: 2, instantiated: 3, alive: 3 }],
  };
  const rw = scoreFor(state, result, RR);
  ok(rw.counts.enemyMen === enemyMen && enemyMen > 0, `o inimigo em campo tem ${enemyMen} homens pela tabela de tipos (o morteiro fora do mapa nao entra)`);
  ok(rw.counts.enemyVeh === 1, `e uma maquina (${rw.counts.enemyVeh})`);
  ok(Math.abs(rw.shares.objectives - 0.5) < 1e-9, 'metade dos objetivos e 50%');
  const esperado = 0.5 * (Math.round(enemyMen / 2) / enemyMen) + 0.5;
  ok(Math.abs(rw.shares.attrition - esperado) < 1e-9, `metade dos homens e a unica maquina: ${(rw.shares.attrition * 100).toFixed(0)}% de baixas do inimigo`);
  ok(rw.counts.fielded === 9 && rw.counts.alive === 6 && rw.counts.ownVeh === 1 && rw.counts.ownVehLost === 0, `9 homens em campo, 6 de pe, 1 tanque inteiro (o dormente nao conta)`);
  ok(Math.abs(rw.shares.survival - (0.5 * 6 / 9 + 0.5)) < 1e-9, 'sobreviventes: homens e maquinas meio a meio');
  const nota = (0.5 * rw.shares.objectives + 0.3 * rw.shares.attrition + 0.3 * rw.shares.survival * rw.shares.engagement) / 1.1;
  ok(Math.abs(rw.score - nota) < 0.001, `nota ${rw.score} = (0,5 x objetivos + 0,3 x baixas + 0,3 x sobreviventes x engajamento) / 1,1`);
  // Cessar-fogo no primeiro turno: tudo em casa e nada feito nao paga nada.
  const parado = scoreFor(state, { ...result, aar: { player: { pontos: 0 }, enemy: {} }, units: [{ coreId: 1, instantiated: 6, alive: 6 }, { coreId: 2, instantiated: 3, alive: 3 }] }, RR);
  ok(parado.score === 0 && parado.shares.survival === 1 && parado.shares.engagement === 0, 'sobreviver sem lutar vale zero');
}

// 29. A ESCADA (30/10/2026, autor: "qual o nivel de recompensa maximo que o jogador pode ter em cada batalha e utilizar
//     isto como o fator de acrescimo da forca inimiga"). Desde 01/11 o jogador comeca sempre com startingCredits e sobe a
//     escada dele (P_n), igual em todo nivel; a razao de forca R escala o inimigo do Attack. O debrief paga o degrau
//     (garantido), a cobertura da conta de reposicao ate um teto e um bonus do teto nao usado. A conta e a mesma que o
//     Quartermaster cobraria, e o simulador da economia (tools/economia/simular.mjs) mostra que quem nao perde nada fica
//     no par, quem perde pouco tambem, e quem perde muito cai abaixo.
{
  const C = await import('./src/campaign.mjs');
  const maus = [];
  const esc = ladder(R);
  if (esc.length !== R.battlesToWin || esc.some((v, i) => i && v <= esc[i - 1]) || rungOf(0, R) !== 0 || rungOf(R.battlesToWin + 1, R) !== 0) maus.push(`escada ${esc.join(' ')}`);
  const par = playerLadder(R);
  const iniciais = startingCredits(R);
  if (iniciais !== 2500 || par[0] !== iniciais || par.some((v, i) => i && v <= par[i - 1]) || playerRung(R.battlesToWin + 1, R) !== 0) maus.push(`escada do jogador ${par.join(' ')}`);
  if (par.some((v, i) => Math.abs(v - iniciais * esc[i] / esc[0]) > 0.5)) maus.push('o par nao e startingCredits x E_n / E_1');
  if (R.difficulty.presets.some((p) => !R.difficulty.ratioOptions.includes(p.ratio))) maus.push('preset com razao fora das opcoes');
  if (ratioOf({}, R) !== R.difficulty.presets.find((p) => p.name === R.difficulty.default).ratio) maus.push('a razao padrao nao e a do preset padrao');

  // a renda de uma batalha sintetica: o degrau nao depende do no nem do tipo; a cobertura fica no teto; o total e a soma
  const res = (n, extra = {}) => ({ battle: n, verdict: { available: 100 }, aar: { player: { pontos: 100 }, enemy: {} }, units: [], casualtiesToBuy: [], vehicles: { marks: {} }, ...extra });
  const est = (cur, forceRatio = 1.3) => ({ forceRatio, defeatsLeft: 2, units: [], current: cur });
  const normal = incomeFor(est({ n: 4 }), res(4), R);
  const pesado = incomeFor(est({ n: 4, rewardMult: 1.3 }), res(4), R);
  const encontro = incomeFor(est({ n: 4, map: { kind: 'Meet' }, defense: { kind: 'Meet' } }), res(4), R);
  const dificil = incomeFor(est({ n: 4 }, 0.9), res(4), R);
  if (normal.step.credits !== playerRung(5, R) - playerRung(4, R) || pesado.step.credits !== normal.step.credits || encontro.step.credits !== normal.step.credits || dificil.step.credits !== normal.step.credits) maus.push(`degrau ${normal.step.credits}/${pesado.step.credits}/${encontro.step.credits}/${dificil.step.credits}`);
  if (pesado.cover.cap !== capFor(4, 1.3, R) || normal.cover.cap !== capFor(4, 1, R) || encontro.cover.cap !== normal.cover.cap || dificil.cover.cap !== normal.cover.cap) maus.push('teto');
  for (const x of [normal, pesado, encontro]) if (x.total !== x.step.credits + x.cover.credits + x.bonus.credits || x.cover.credits > x.cover.cap) maus.push('a soma ou o teto');
  if (normal.cover.bill !== 0 || normal.cover.credits !== 0 || normal.bonus.credits !== Math.round(R.reward.replacement.unusedBonus * normal.cover.cap * normal.score)) maus.push(`sem perdas: cobertura ${normal.cover.credits}, bonus ${normal.bonus.credits}`);
  const ultima = incomeFor(est({ n: R.battlesToWin }), res(R.battlesToWin), R);
  if (ultima.step.credits !== 0 || !ultima.step.campaignOver) maus.push('degrau depois da ultima batalha');
  const conta = coverFor({ bill: 5000, cap: 800, score: 0.5 }, R);
  if (conta.covered !== 800 || conta.cover !== 400 || conta.bonus !== 0) maus.push(`conta acima do teto ${JSON.stringify(conta)}`);

  // A CONTA E A DO QUARTERMASTER: repor tudo o que a batalha custou cobra exatamente a conta da cobertura
  const ifv = (id) => ({ coreId: id, name: 'Infantry Fighting Vehicle (BMP-2)', role: 'ifv', type: [37, 5], present: true, nation: 'RU', experience: 'Regular', price: 300, paid: 300 });
  const fixture = {
    slug: 'ZZ-T29', stage: 'result', nation: 'RU', armies: ['RU'], credits: 99999, battleNumber: 2, defeatsLeft: 2, forceRatio: 1.3,
    units: [ifv(10), ifv(11), { coreId: 12, name: 'Squad (Rifle)', role: 'infantry', type: [58, 4], present: true, nation: 'RU', experience: 'Regular', price: 100, paid: 100 }],
    vehicles: { 10: 'destroyed', 11: 'survived' }, lost: [10], survived: [11], current: { n: 2 },
    pending: { savePath: null, result: res(2, { casualtiesToBuy: [{ index: 1, coreId: 10 }, { index: 2, coreId: 11 }, { index: 3, coreId: 12 }, { index: 4, coreId: 12 }, { index: 5, coreId: 12 }], vehicles: { marks: { 10: 'destroyed', 11: 'survived' } } }) },
  };
  const bill = billFor(fixture, fixture.pending.result, R);
  let q = null;
  try { q = C.quoteApply(fixture, { replaceIndices: [1, 2, 3, 4, 5], replaceVehicles: [10] }, R); } catch (e) { maus.push('quoteApply: ' + e.message); }
  if (q && (bill.total !== q.replaceCost + q.machinesCost || bill.machines.length !== 1 || bill.men.toBuy !== 3)) maus.push(`conta ${bill.total} (maquinas ${bill.machinesCost}, ${bill.men.toBuy} homens) x Quartermaster ${q.replaceCost} + ${q.machinesCost}`);
  if (q && (q.paid !== q.income.total || q.available !== fixture.credits + q.paid)) maus.push('a cotacao nao soma a renda');

  // o simulador: perfeito fica no par (mais o bonus), bom perto dele, mediano abaixo, ruim bem abaixo
  let sim = null;
  try { sim = await import('../tools/economia/simular.mjs'); } catch { /* fora do repositorio (pacote): sem o simulador */ }
  const linhas = [];
  if (sim) {
    const teto = 1 + R.reward.replacement.capShare * R.reward.replacement.unusedBonus;
    const rel = (p) => sim.simular(sim.PERFIS[p], R).map((x) => x.force / x.par);
    const perf = rel('perfect'), bom = rel('good'), med = rel('average'), ruim = rel('bad');
    if (perf.some((v, i) => v < 1 - 0.005 || v > teto ** i + 0.005)) maus.push(`perfeito fora de [P, P x ${teto}^n]`);
    if (bom.at(-1) < 0.9 || bom.at(-1) > 1.05) maus.push(`bom termina em ${bom.at(-1).toFixed(2)}P`);
    if (med.at(-1) < 0.75 || med.at(-1) > 0.9 || med.at(-1) >= bom.at(-1)) maus.push(`mediano termina em ${med.at(-1).toFixed(2)}P`);
    if (Math.min(...ruim) >= 0.6) maus.push('ruim nunca cai abaixo de 0,6P');
    if (sim.simular(sim.PERFIS.good, R).at(-1).step !== 0) maus.push('o simulador paga degrau na ultima');
    linhas.push(`perfeito ${perf.at(-1).toFixed(2)}P, bom ${bom.at(-1).toFixed(2)}P, mediano ${med.at(-1).toFixed(2)}P, ruim ${Math.min(...ruim).toFixed(2)}P`);
  }
  ok(!maus.length, `(29) a escada: inimigo ${esc[0]} -> ${esc.at(-1)}, jogador ${par[0]} -> ${par.at(-1)}; degrau b4 ${normal.step.credits}, teto ${normal.cover.cap} (pesado ${pesado.cover.cap}); conta = Quartermaster (${bill.total} cr); ${sim ? linhas.join('') : 'simulador ausente (pulado)'}${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 29b. O ARSENAL VENDE NO NIVEL ESCOLHIDO (E53). autor: "nao consigo alterar a experiencia de
//      unidades novas compradas na formacao de BTR" — o painel de modificadores so mirava escolhas
//      novas. A unidade dormente ligada no quartel-mestre e uma compra como outra qualquer: paga o
//      nivel que o jogador escolhe e e escrita nele antes da batalha.
{
  const u = { coreId: 9, name: 'Squad (Engineer)', role: 'engineer', offMap: false, type: [1, 1], nation: 'UKR', experience: 'Regular', price: 63 };
  const st = { nation: 'UKR' };
  ok(purchasePrice(st, u, null, R) === 63 && purchasePrice(st, u, 'Regular', R) === 63, 'sem escolha, ou no nivel que ja tem, custa o que o estado diz');
  const vet = purchasePrice(st, u, 'Veteran', R), green = purchasePrice(st, u, 'Green', R), elite = purchasePrice(st, u, 'Elite', R);
  ok(green < 63 && vet > 63 && elite > vet, `Green ${green} < Regular 63 < Veteran ${vet} < Elite ${elite}`);
  const f = R.units.experienceFactor;
  ok(Math.abs(vet / 63 - f.Veteran / f.Regular) < 0.05, `a escala e a mesma da compra na biblioteca (Veteran/Regular = ${(vet / 63).toFixed(2)}, esperado ${(f.Veteran / f.Regular).toFixed(2)})`);
  let erro = null; try { purchasePrice(st, u, 'Godlike', R); } catch (e) { erro = e; }
  ok(!!erro, 'nivel que nao existe e recusado');
}

// 29c. A MAQUINA REPOSTA VEM GREEN (E57). autor: "por que este Bradley custa mais caro que os
//      outros? ... deveriamos oferecer toda reposicao de veiculo com experiencia green". O #2 era
//      Crack (500) entre dois Veteran (250): a reposicao custava o nivel da que queimou. Agora custa
//      e chega no nivel da regra, e a fracao do estado (abandonada 40%) vale no servidor como na tela.
{
  const crack = { coreId: 553, name: 'Infantry Fighting Vehicle (M2A3 Bradley (ERA))', role: 'ifv', offMap: false, type: [1, 2], nation: 'US', experience: 'Crack', price: 500 };
  const vet = { ...crack, coreId: 552, experience: 'Veteran', price: 250 };
  const level = replacementLevel(R);
  const green = priceUnits([{ ...crack, experience: level }], 'US', R).total;
  const vetPrice = priceUnits([{ ...crack, experience: 'Veteran' }], 'US', R).total;
  ok(level === 'Green' && green < vetPrice, `a reposicao vem ${level}, a ${green} cr o Bradley (Veteran ${vetPrice})`);
  // E59: o preco e o do exercito da unidade — a planilha do autor da 550 ao Bradley americano; como
  // IFV generico ucraniano ele valia 250, e era assim que a EASY2 o tinha no estado.
  // (18/10: o valor vem da planilha, que o autor reprecifica; era fixo em 550)
  const planilhaBradley = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'research', 'precos_unidades.json'), 'utf8')).precos[`US|${crack.name}`];
  ok(Number.isFinite(planilhaBradley) && vetPrice === planilhaBradley && priceUnits([{ ...crack, experience: 'Veteran' }], 'UKR', R).total !== vetPrice,
    `o Bradley custa ${vetPrice} pela planilha americana, e outra coisa como IFV generico`);
  ok(priceUnits([{ ...crack, name: crack.name + ' #2', experience: 'Veteran' }], 'US', R).total === vetPrice,
    'e o "#2" que o diretorio da forca poe no nome nao tira a unidade da planilha');
  ok(vehicleCost(crack, 'destroyed', R) === green && vehicleCost(vet, 'destroyed', R) === green,
    `o Bradley Crack e o Veteran custam o mesmo para repor (${vehicleCost(crack, 'destroyed', R)} = ${vehicleCost(vet, 'destroyed', R)})`);
  // E91: "knocked out" e destruida ("vamos considerar como mesma coisa") — a marca antiga custa igual.
  ok(vehicleCost(crack, 'knocked_out', R) === green && R.replacement.vehicle.knocked_out === undefined && vehicleCost(crack, 'immobilized', R) === 0,
    `abandonada custa como destruida (${vehicleCost(crack, 'knocked_out', R)}), imobilizada de graca`);
  const semRegra = { ...R, replacement: { ...R.replacement, vehicleExperience: undefined } };
  ok(vehicleCost(crack, 'destroyed', semRegra) === 500, 'sem a regra, custa o nivel da que queimou, como antes');
}

// 30. O VEICULO AVULSO ENTRA DENTRO DA FORMACAO (E51). autor comprou tres MT-LB "dentro" do seu
//     grupo tatico e o quartel-mestre lhe mostrou tres batalhoes aleatorios com um MT-LB cada: o
//     "attach" antigo comprava uma folha de qualquer fonte da biblioteca. Agora o avulso e um EXTRA
//     da escolha, sintetizado dentro da formacao na cunhagem (FORMATO 98) — com core id, linha de
//     roster e caminho de formacao como qualquer unidade. A cunhagem aqui e a de verdade: gerador,
//     extracao do lado, marca de core.
{
  const fonte = 'UKR - Tactical Group (Battalion [BTR]).btt';
  const tree = formationTree(fonte);
  const achar = (nomes) => {
    let no = tree.roots[0];
    for (const nome of nomes) { no = no.children.find((c) => c.isFormation && c.name === nome); if (!no) return null; }
    return no;
  };
  const sub = (no) => { const out = []; const w = (n) => { out.push(n.key); n.children.forEach(w); }; w(no); return out; };
  const fuzileiros = achar(['Company (Rifle)', 'Platoon (Rifle)']), tanques = achar(['Company (Rifle)', 'Platoon (Tank)']);
  ok(!!fuzileiros && !!tanques, 'a fonte tem o pelotao de fuzileiros e o pelotao de tanques da 1a companhia');
  const menu = singleVehicles(['UKR'], { rules: R });
  // 18/10 (autor): o UKR so vende o Ural-4320 como anexo; o MT-LBM saiu da lista, e os dois extras do pelotao viram Urals.
  const ural = menu.find((v) => v.name === 'Truck (Ural-4320)'), mtlb = ural;
  ok(!!ural && menu.length === 1 && ural.experience === R.singleVehicles.experience, `o menu UKR oferece so o Ural (${ural?.price} cr) no nivel ${R.singleVehicles.experience}: ${menu.map((v) => v.name).join(', ')}`);

  const pick = {
    source: fonte, nation: 'UKR', keep: [...sub(fuzileiros), ...sub(tanques)], xp: {},
    extras: [
      { tipo: mtlb.name, key: fuzileiros.key, type: mtlb.type },
      { tipo: mtlb.name, key: fuzileiros.key, type: mtlb.type },
      { tipo: ural.name, key: tanques.key, type: ural.type },   // pelotao de tanques: sem time de 41 B
    ],
  };
  const sem = priceOfPicks([{ ...pick, extras: [] }], 'UKR', R)[0];
  const com = priceOfPicks([pick], 'UKR', R)[0];
  ok(com.extras.length === 3 && com.extras[0].em.join('/') === 'Company (Rifle)/Platoon (Rifle)' && com.extras[2].em.join('/') === 'Company (Rifle)/Platoon (Tank)',
    `o preco resolve o caminho de cada extra (${com.extras.map((e) => e.em.join('/')).join(' | ')})`);
  ok(com.price === sem.price + 2 * mtlb.price + ural.price && com.units === sem.units + 3 && com.onMapUnits === sem.onMapUnits + 3,
    `e cobra os extras como unidades do nome no nivel Regular: ${sem.price} + ${2 * mtlb.price + ural.price} = ${com.price} cr, ${com.units} unidades`);
  ok(!com.uncovered.length, 'e os tres tem molde de roster');

  // A cunhagem, no mapa da batalha 1 de uma campanha qualquer.
  const mapa = mapCensus().find((m) => m.tipo === 'Attack' && m.tier === 1 && m.usavel && m.serve);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-t30-'));
  const out = path.join(tmp, 'core-force.btt');
  const trace = { read() {}, wrote() {}, event() {}, step: async (_n, _d, fn) => fn() };
  let erro = null;
  try {
    await buildCoreForce({ picks: [com], nation: 'UKR', enemy: 'RU', mapFile: mapFile(mapa), workDir: tmp, out, trace });
  } catch (e) { erro = e; }
  ok(!erro, `a forca core cunha com os extras dentro${erro ? ': ' + String(erro.message).slice(0, 160) : ''}`);
  if (!erro) {
    const dir = unitDirectory(out);
    const noPelotao = dir.filter((u) => u.name.startsWith('Truck (Ural-4320)') && /Platoon \(Rifle\) #1$/.test(u.formation));
    // (o `#n` no caminho so aparece quando ha mais de uma formacao com o nome: a 1a companhia tem
    // um pelotao de tanques so)
    const noTanque = dir.filter((u) => u.name.startsWith('Truck (Ural-4320)') && /Company \(Rifle\) #1 \/ Platoon \(Tank\)( #1)?$/.test(u.formation));
    ok(noPelotao.length === 2 && noPelotao.every((u) => u.coreId > 0 && u.present),
      `os dois Urals estao DENTRO do 1o pelotao de fuzileiros, com core id e em campo (${noPelotao.map((u) => `${u.name} core ${u.coreId}`).join('; ')})`);
    ok(noTanque.length === 1 && noTanque[0].coreId > 0 && noTanque[0].present,
      `e o Ural esta dentro do pelotao de tanques, que nao tem time nenhum para servir de molde (core ${noTanque[0]?.coreId})`);
    ok(noPelotao.every((u) => u.experience === R.singleVehicles.experience) && noTanque.every((u) => u.experience === R.singleVehicles.experience),
      `escritos no nivel cobrado (${[...noPelotao, ...noTanque].map((u) => u.experience).join(', ')})`);
    // Roster e core id para todo mundo: a forca tem TODAS as unidades da fonte (a poda mascara, nao
    // remove) mais os tres extras, e cada uma tem a sua linha.
    ok(dir.length === tree.units + 3 && coreUnits(out).length === dir.length,
      `${dir.length} unidades core = ${tree.units} da fonte + 3 extras, todas com linha de roster (${coreUnits(out).length})`);
    // As chaves das unidades que ja existiam nao mudaram: o extra e o ULTIMO filho do pelotao, e a
    // poda por folha da criacao (que fala por chave: escolha 0, mesmo caminho) continua apontando
    // para a unidade certa.
    const porChave = new Map(dir.map((u) => [u.key, u]));
    const folhasDaFonte = sub(fuzileiros).filter((k) => { let n = tree.roots[0]; for (const i of k.split('.').slice(1)) n = n.children[+i]; return !n.isFormation; });
    // (o diretorio numera os nomes repetidos — "Squad (Rifle) #2" — e a arvore da biblioteca nao)
    const nomeNaArvore = (k) => { let n = tree.roots[0]; for (const i of k.split('.').slice(1)) n = n.children[+i]; return n.name; };
    ok(folhasDaFonte.every((k) => (porChave.get(k)?.name || '').replace(/ #\d+$/, '') === nomeNaArvore(k)),
      `as ${folhasDaFonte.length} folhas do pelotao continuam nas mesmas chaves`);
    const nFilhos = fuzileiros.children.length;
    ok(noPelotao.every((u) => u.key.startsWith(fuzileiros.key + '.') && +u.key.split('.').pop() >= nFilhos),
      `e os extras vieram DEPOIS dos ${nFilhos} filhos originais (${noPelotao.map((u) => u.key).join(', ')})`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 31. O METRALHADOR QUE VOLTOU DE PISTOLA (E54). autor: "o jogo nao repos municao de LMG... o
// gunner ate segura uma pistola". O save da batalha 2 da EASY2 tem o Sydorenko (core 48, vaga 2)
// com `2/43 + 8/0` e so 48 de 9mm: a PKM secou na batalha 1, o jogo trouxe a pistola para a frente
// e apagou o par do 7,62x54R, e o socorro levou a PKM. O reforco nao o alcanca (ele TEM arma) e o
// refil so enchia quem tinha o vetor vazio. A resposta e em duas partes — a arma da vaga, escrita
// no lugar, e a municao da ARMA (a colheita de `armas_municao.json`), inserida.
{
  const save = path.join(import.meta.dirname, '../research/exemplos/e54_pkm_seco.bts');
  const table = toeTable(), weapons = weaponTable(), side = sidearms();
  ok(weapons && weapons['2/36']?.[5] === 300 && weapons['2/36']?.[6] === 48 && !weapons['2/36']?.[1],
    `a colheita diz o que a PKM carrega: 300 de 7,62x54R e 48 de 9mm, e nao o 5,45 que um em dez leva para o esquadrao (${JSON.stringify(weapons?.['2/36'])})`);
  ok(side && side.has('2/43') && side.has('4/15') && !side.has('2/36') && !side.has('2/24'),
    'a pistola e o RPG-22 andam na mao 2; a PKM e o fuzil nao');
  ok(weapons && weapons['4/15']?.[481] === 1 && !weapons['4/15']?.[482] && weapons['4/16']?.[482] === 1 && !weapons['4/16']?.[481],
    'o RPG-22 leva o tiro 481 e o RPG-26 o 482, cada um so o seu');

  const lost = lostWeapons(save, table, side);
  const byName = (p) => { const r = readRoster(p); return new Map(r.soldados.map((s, i) => [s.nome, i])); };
  const idx = byName(save);
  const syd = idx.get('Sydorenko');
  ok(Object.keys(lost).length === 1 && lost[syd] && lost[syd].classe === 2 && lost[syd].item === 36 && lost[syd].classe2 === 2 && lost[syd].item2 === 43,
    `so o Sydorenko recebe arma: a PKM na mao 1 e a pistola na mao 2 (${JSON.stringify(lost)})`);
  ok(!lost[idx.get('Tkachuk')] && !lost[idx.get('Kravets')] && !lost[idx.get('Kovalchuk')],
    'ninguem com fuzil na mao 1 e tocado: nem o par RPG-22/RPG-26 dos esquadroes gemeos, nem quem a tabela de vagas acha que devia ter outro fuzil');
  ok(Object.keys(lostWeapons(save, table, null)).length === 0, 'sem a colheita, a devolucao nao mexe em ninguem');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-e54-'));
  const rearmed = path.join(tmp, 'rearmed.bts');
  const r1 = rearmMen(save, rearmed, lost);
  const arms = (p, i) => { const c = readRosterTails(p)[i].cauda; return `${c[1]}/${c[2]} + ${c[4]}/${c[5]}`; };
  // (o arquivo muda de tamanho porque o bloco e recomprimido; o que nao pode mudar e o registro)
  const tailLen = (p, i) => readRosterTails(p)[i].cauda.length;
  ok(r1.homens === 1 && arms(rearmed, syd) === '2/36 + 2/43' && tailLen(rearmed, syd) === tailLen(save, syd) && readRoster(rearmed).soldados.length === readRoster(save).soldados.length,
    `a arma volta escrita no lugar: registro do mesmo tamanho, mesmos homens (${arms(rearmed, syd)}, ${tailLen(rearmed, syd)} B)`);

  const missing = missingLoads(rearmed, table, weapons);
  ok(Object.keys(missing).length === 1 && missing[syd] && missing[syd][5] === 300 && !missing[syd][1],
    `e so o par que zerou entra: 300 de 7,62x54R para o Sydorenko, nada para mais ninguem (${JSON.stringify(missing)})`);
  const granted = path.join(tmp, 'granted.bts');
  const r2 = insertAmmo(rearmed, granted, missing);
  const load = (p, i) => { const c = readRosterTails(p)[i].cauda; const n = c.readUInt16LE(9); const o = {}; for (let k = 0; k < n; k++) o[c.readUInt16LE(11 + k * 4)] = c.readUInt16LE(13 + k * 4); return o; };
  ok(r2.homens === 1 && r2.cresceu === 4 && load(granted, syd)[5] === 300 && load(granted, syd)[6] === 48,
    `o registro cresce 4 bytes e o homem sai com ${JSON.stringify(load(granted, syd))}`);
  // Idempotente: rodar de novo nao acha nada.
  ok(Object.keys(lostWeapons(granted, table, side)).length === 0 && Object.keys(missingLoads(granted, table, weapons)).length === 0,
    'e a segunda passada nao tem mais o que fazer');
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 32. RECRUTAR LIGA SO O QUE FOI COMPRADO (E55). autor recrutou um batalhao americano na virada da
//     batalha 2 da EASY2, ficou com um Abrams e um pelotao de Bradleys (8 unidades, 2.858 cr), e a
//     batalha 3 abriu com os 170 americanos do batalhao inteiro na zona dele: `growCoreForce` ligava
//     TODA unidade que a reconstrucao acrescentava — a poda mascara em vez de remover, entao o
//     batalhao inteiro esta no arquivo. O comprado e o que a poda deixou presente menos o que ele
//     desligou um a um. A cunhagem aqui e a de verdade, duas vezes (criar e crescer).
{
  const fonte = 'US - Battalion (Combined Arms [Task Force]).btt';
  const tree = formationTree(fonte);
  const achar = (t, nomes) => {
    let no = t.roots[0];
    for (const nome of nomes) { no = no.children.find((c) => c.isFormation && c.name === nome); if (!no) return null; }
    return no;
  };
  const pelotao = achar(tree, ['Company (Rifle [mixed])', 'Platoon (Rifle)']);
  const blindados = achar(tree, ['Company (Rifle [mixed])', 'Platoon (Armored)']);
  ok(!!pelotao && !!blindados, 'a fonte americana tem o pelotao de fuzileiros e o pelotao blindado da 1a companhia');
  // o pelotao inteiro menos um Bradley, e UM Abrams do pelotao blindado — a escolha do autor
  const folhas = (no) => no.children.filter((c) => !c.isFormation);
  const bradleyFora = folhas(pelotao).filter((c) => /Bradley/.test(c.name)).pop();
  const abrams = folhas(blindados).find((c) => /Abrams/.test(c.name));
  const keep = [pelotao.key, ...folhas(pelotao).filter((c) => c !== bradleyFora).map((c) => c.key), abrams.key];
  const us = priceOfPicks([{ source: fonte, nation: 'US', keep, xp: {} }], 'UKR', R)[0];
  ok(us.units === keep.length - 1 && us.dropped.length > 0 && us.ausentes.length > 0,
    `a escolha vale ${us.units} unidades, com ${us.dropped.length} desligadas dentro do que ficou e ${us.ausentes.length} sub-formacoes podadas`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-e55-'));
  const mapa = mapFile(mapPool(1, [], 0)[0]);
  const trace = { event() {}, read() {}, wrote() {}, async step(n, x, f) { return f(); } };
  // 1. a campanha comeca com um pelotao ucraniano
  const ukr = 'UKR - Tactical Group (Battalion [BTR]).btt';
  const pel = achar(formationTree(ukr), ['Company (Rifle)', 'Platoon (Rifle)']);
  const sub = (no) => { const out = []; const w = (n) => { out.push(n.key); n.children.forEach(w); }; w(no); return out; };
  const p0 = priceOfPicks([{ source: ukr, nation: 'UKR', keep: sub(pel), xp: {} }], 'UKR', R)[0];
  const core0 = path.join(tmp, 'core.btt');
  await buildCoreForce({ picks: [p0], nation: 'UKR', enemy: 'RU', mapFile: mapa, workDir: tmp, out: core0, trace });
  const before = unitDirectory(core0);
  const presentes = before.filter((u) => u.present).map((u) => u.coreId);
  // 2. e recruta o batalhao americano
  const dropped = (us.dropped || []).map((d) => chaveNaForca(1, d.key));
  const grown = await growCoreForce({ picks: [p0], newPicks: [us], nation: 'UKR', enemy: 'RU', mapFile: mapa, workDir: tmp, out: path.join(tmp, 'grown.btt'), before, present: presentes, dropped, trace });
  const agora = grown.units;
  const novos = agora.filter((u) => !before.some((b) => b.coreId === u.coreId));
  ok(novos.length > 100 && grown.added.length === novos.length, `o batalhao inteiro entra no arquivo (${novos.length} unidades novas), como o roster exige`);
  ok(grown.bought.length === us.units && novos.filter((u) => u.present).length === us.units,
    `mas so as ${us.units} compradas ficam em campo (${novos.filter((u) => u.present).length} presentes; ${grown.bought.map((u) => u.name.replace(/ #\d+$/, '')).join(', ')})`);
  ok(grown.bought.some((u) => /Abrams/.test(u.name)) && grown.bought.filter((u) => /Bradley/.test(u.name)).length === folhas(pelotao).filter((c) => /Bradley/.test(c.name)).length - 1,
    'o Abrams escolhido e os Bradleys do pelotao menos o que ele deixou de fora');
  ok(agora.filter((u) => u.present && before.some((b) => b.coreId === u.coreId)).length === presentes.length, 'quem ja estava em campo continua em campo, e ninguem mais');
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 33. O VETOR DE MUNICAO NEM SEMPRE ESTA EM +9 (E60, FORMATO 113.6). A batalha 4 da EASY2 abriu com
//     "Out of memory" a 5%: dois granadeiros americanos tem o bit 0x20 nas flags e um byte a mais
//     antes do nMun; o app leu "1 item" (par fantasma 768:0) e inseriu os pares novos no meio do
//     u32 n3. Bytes reais dos tres homens, do save de transicao da batalha 3.
{
  const hex = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');
  const crews = hex('00 02 04 00 08 00 00 c0 80 00 00 03 00 00 00 01 01 00 01 01 00 01 03 00 00 00 00 00 00 00 00 00 01 01 53 3a 00 00 00 00 00 00 d0 00');
  const yost = hex('00 02 0d 00 02 02 00 20 80 01 00 00 03 00 00 00 01 01 00 01 01 00 01 03 00 00 00 00 00 00 00 00 00 01 04 fd 05 00 00 00 00 00 00 d0 fe');
  const gauthier = hex('00 02 0d 00 02 02 00 20 80 01 02 00 02 00 23 01 0e 00 1a 00 03 00 00 00 01 01 00 01 01 00 01 03 00 00 00 00 00 00 00 00 00 01 01 53 3a 00 00 00 00 00 00 d0 00');
  const compacto = hex('00 00 00 00 00 01 03 36 35 00 00 00 00 00 00 c0 fe');
  const c = readAmmoVector(crews), y = readAmmoVector(yost), g = readAmmoVector(gauthier);
  ok(c && c.off === 9 && c.n === 0, `sem o bit 0x20 o vetor esta em +9 (Crews: off ${c?.off}, n ${c?.n})`);
  ok(y && y.off === 10 && y.n === 0, `com o bit 0x20 ha um byte a mais e o vetor esta em +10 (Yost: off ${y?.off}, n ${y?.n} — e nao "1 item 768")`);
  ok(g && g.off === 10 && g.n === 2 && g.pares[0].item === 2 && g.pares[0].qtd === 291 && g.pares[1].item === 14 && g.pares[1].qtd === 26,
    `e os pares vem depois dele (Gauthier: ${g?.pares.map((p) => p.item + ':' + p.qtd).join(' ')})`);
  ok(readAmmoVector(compacto) === null, 'o registro compacto de 17 B nao tem vetor e nao e tocado');

  // No save de verdade: os dois granadeiros recebem municao no lugar certo e o u32 n3 continua onde estava.
  const save = path.join(import.meta.dirname, '../research/exemplos/e60_bit20.bts');
  const idx = new Map(readRoster(save).soldados.map((s, i) => [s.nome, i]));
  const yi = idx.get('Yost'), si = idx.get('Shumaker');
  const tails = readRosterTails(save);
  ok(yi !== undefined && si !== undefined && readAmmoVector(tails[yi].cauda).n === 0 && readAmmoVector(tails[si].cauda).n === 0,
    'no save da batalha 3, Yost e Shumaker tem o vetor VAZIO (e nao um par fantasma)');
  const n3De = (t) => { const p = readAmmoVector(t); return t.readUInt32LE(p.off + 2 + p.n * 4); };
  ok(n3De(tails[yi].cauda) === 3 && n3De(tails[si].cauda) === 6, `o u32 n3 deles fecha: ${n3De(tails[yi].cauda)} e ${n3De(tails[si].cauda)}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-e60-'));
  const out = path.join(tmp, 'granted.bts');
  const r = insertAmmo(save, out, { [yi]: { 2: 210, 14: 24 }, [si]: { 2: 347 } });
  const t2 = readRosterTails(out);
  const py = readAmmoVector(t2[yi].cauda), ps = readAmmoVector(t2[si].cauda);
  ok(r.homens === 2 && py.off === 10 && py.n === 2 && py.pares[0].item === 2 && ps.n === 1 && ps.pares[0].qtd === 347,
    `a insercao entra depois do byte extra (Yost n=${py?.n} em +${py?.off}, Shumaker n=${ps?.n})`);
  ok(n3De(t2[yi].cauda) === 3 && n3De(t2[si].cauda) === 6, 'e o u32 n3 continua fechando depois dos pares novos');
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 34. O DESTROCO ESPERANDO REPOSICAO NAO VAI PARA A BATALHA (E61). autor: "parece que esta faltando
//     um T-64BV" — e faltava mesmo, mas ao contrario: o T-64BV #1 queimou na batalha 2, a reposicao
//     custava mais do que ele tinha, e o app continuou escrevendo o destroco como presente em toda
//     batalha (e enchendo o paiol dele a cada virada). A unidade fica na forca, porque e la que o
//     quartel-mestre vende a reposicao, e fica no roster, que o jogo exige — mas nao entra no campo.
{
  const st = {
    units: [
      { coreId: 81, present: true }, { coreId: 82, present: true }, { coreId: 83, present: true },
      { coreId: 10, present: true }, { coreId: 20, present: false }, { coreId: 51, present: false },
    ],
    purchased: [51, 10, 20], lost: [81], wrecked: [{ coreId: 51, replacedBy: 10 }], standDown: [307],
  };
  const p = battlePresence(st);
  ok(p.off.includes(81) && !p.on.includes(81), 'o tanque marcado como destruido e nao reposto fica fora do campo');
  ok(p.on.includes(10) && !p.on.includes(20), `a compra que o estado ainda poe em campo entra e a outra nao (${p.on.join(',')})`);
  ok(p.off.includes(51) && p.off.includes(307) && p.off.includes(20), `destroco reposto, baixa da forca e compra desligada saem (${p.off.join(',')})`);
  const campo = fieldedIds(st);
  ok(campo.has(82) && campo.has(83) && campo.has(10) && !campo.has(81),
    `e o refit nao reabastece o destroco: em campo ${[...campo].join(',')}`);
  // Reposto, ele volta a ser uma unidade como as outras: sai de `lost` e o reserva entra.
  const depois = battlePresence({ ...st, lost: [], wrecked: [...st.wrecked, { coreId: 81, replacedBy: 84 }], purchased: [...st.purchased, 84], units: [...st.units.map((u) => (u.coreId === 81 ? { ...u, present: false } : u)), { coreId: 84, present: true }] });
  ok(depois.on.includes(84) && depois.off.includes(81), 'pago o reserva, quem entra e ele e o destroco fica de fora para sempre');
}

// 35. O IMOBILIZADO E CONSERTADO PELO APP, DE GRACA (E62). autor entrou na batalha 4 da EASY2 com um
//     T-64BV a menos: o imobilizado na batalha 3 nao aparece no mapa (o jogo nao o conserta neste
//     caminho) e nao custava nada, entao sumia em silencio. Agora um gemeo dormente toma o lugar
//     dele levando a experiencia e a ficha — e o gemeo preferido e o da MESMA FORMACAO.
//     E91: a premissa caiu (o T-64 era destroco; o imobilizado o jogo conserta) e a troca esta
//     desligada em `replacement.swapImmobilized`. O teste guarda o caminho para quem religar.
{
  const T = [2, 7];
  const st = {
    vehicles: { 83: 'immobilized', 82: 'survived' },
    record: { 83: { battles: 3, wins: 1 } },
    attrs: { 83: { experiencia: 'Veteran', motivacao: 'High' } },
    units: [
      { coreId: 82, name: 'Main Battle Tank (T-64BV) #2', formation: 'Platoon (Tank)', type: T, present: true, experience: 'Regular', price: 720 },
      { coreId: 83, name: 'Main Battle Tank (T-64BV) #3', formation: 'Platoon (Tank)', type: T, present: true, experience: 'Veteran', price: 800, motivation: 'High' },
      { coreId: 13, name: 'Main Battle Tank (T-64BV)', formation: 'Company (Tank) #9', type: T, present: false, experience: 'Regular', price: 720 },
      { coreId: 84, name: 'Main Battle Tank (T-64BV) #4', formation: 'Platoon (Tank)', type: T, present: false, experience: 'Regular', price: 720 },
      { coreId: 99, name: 'Truck (Ural-4320)', formation: 'Platoon (Tank)', type: [3, 3], present: false, experience: 'Regular', price: 23 },
    ],
  };
  ok(spareFor(st, st.units[1]).coreId === 84, `o reserva preferido e o do mesmo pelotao, nao o primeiro da lista (${spareFor(st, st.units[1])?.coreId})`);
  ok(spareFor(st, st.units[1], new Set([84])).coreId === 13, 'tomado esse, o proximo do mesmo tipo serve');
  ok(spareFor(st, st.units[1], new Set([84, 13])) === null, 'e sem gemeo nenhum a resposta e nada, nao um caminhao');

  const { repairs, noSpare } = repairsDue(st);
  ok(repairs.length === 1 && repairs[0].broken.coreId === 83 && repairs[0].spare.coreId === 84 && !noSpare.length,
    `so o imobilizado e consertado, com o gemeo do pelotao (${repairs.map((r) => r.broken.coreId + '->' + r.spare.coreId).join(',')})`);
  ok(repairsDue({ ...st, units: st.units.filter((u) => u.coreId !== 84 && u.coreId !== 13) }).noSpare.length === 1,
    'sem reserva no arsenal, o app diz que nao consertou em vez de inventar');
  ok(!repairsDue({ ...st, vehicles: { 83: 'destroyed' } }).repairs.length, 'destruida nao e imobilizada: essa se paga');

  // Depois do conserto a maquina parada tem de SAIR do campo, senao ela continua indo para o .btt.
  const depois = battlePresence({ ...st, repaired: [{ battle: 3, coreId: 83, replacedBy: 84 }], purchased: [84], units: st.units.map((u) => (u.coreId === 83 ? { ...u, present: false } : u.coreId === 84 ? { ...u, present: true } : u)) });
  ok(depois.on.includes(84) && depois.off.includes(83), `o gemeo entra e a maquina parada sai (on ${depois.on.join(',')} / off ${depois.off.join(',')})`);
}

// 36. O JOGADOR ESCOLHE A ARMA DE UM SOLDADO (plano 1 fase C, E64). A escrita e a que o jogo ja
//     aceitou duas vezes: classe e item no lugar, registro do mesmo tamanho (E30, E54). A municao da
//     arma nova nao e escrita aqui — ela entra no passo seguinte do refit, que olha a arma que o
//     homem SEGURA (E54/E60), e e por isso que a troca roda antes dele. Fixture: o save de transicao
//     da batalha 3 da EASY2, com um estado sintetico de uma unidade so.
{
  const save = path.join(import.meta.dirname, '../research/exemplos/e60_bit20.bts');
  // O MENU E O QUE A FORCA CARREGA: tres esquadroes ucranianos dao fuzil, lanca-granada, PKM,
  // RPK-74 e RPG-7V1. Com um esquadrao so, a PKM nem apareceria — e a regra, nao um defeito.
  const umEsquadrao = (coreId, n) => ({ coreId, name: `Squad (Rifle) #${n}`, present: true, role: 'infantry', nation: 'UKR' });
  const st = { nation: 'UKR', baseline: {}, units: [umEsquadrao(48, 1), umEsquadrao(49, 2), umEsquadrao(50, 3)] };

  ok(weaponClass('2/36', 'PKM', R) === 'mg' && gearPrice('2/36', 'PKM', R) === R.gear.price.mg,
    `o nome diz a classe: a PKM e metralhadora e custa ${gearPrice('2/36', 'PKM', R)}`);
  ok(weaponClass('2/9', null, R) === 'personal' && weaponClass('4/13', null, R) === 'at' && weaponClass('5/21', null, R) === 'atgm',
    'sem nome, a classe do id responde: 2 pessoal, 4 rojao, 5 missil');
  ok(gearPrice('2/24', 'AK-74', R) === 0, 'fuzil nao se cobra');

  const g = readGear(save, st, R);
  ok(g.units.length === 3 && g.units[0].coreId === 48 && g.units[0].men.length === 6, `so as unidades do estado sao lidas (${g.units.length} unidades, ${g.units[0]?.men.length} homens na primeira)`);
  const menu = g.catalog.UKR || [];
  ok(menu.some((x) => x.name === 'PKM') && menu.every((x) => x.ammo && Object.keys(x.ammo).length),
    `o menu ucraniano tem a PKM e toda arma dele tem linha de municao (${menu.map((x) => x.name || x.weapon).join(', ')})`);
  ok(!menu.some((x) => x.weapon === '2/43'), 'e a pistola do metralhador nao e oferecida como arma principal');
  const vivo = g.units[0].men.find((m) => m.canChange);
  const caido = g.units[0].men.find((m) => m.state > 1);
  ok(!!vivo && vivo.name === 'Romanenko' && vivo.weaponName === 'AK-74/GP-25', `quem esta de pe pode trocar (${vivo?.name}, ${vivo?.weaponName})`);
  ok(!!caido && !caido.canChange && caido.why === 'down', 'e a baixa nao: ela volta com a arma da vaga dela');

  const plano = priceGear([{ index: vivo.index, weapon: '2/36' }], g, R);
  // (18/10: o preco da arma vem de research/precos_armas.json, que o autor reprecifica; a regra so cobre o que falta la)
  ok(plano.cost === gearPrice('2/36', 'PKM', R, 'UKR') && plano.changes[0].from === '2/31' && plano.changes[0].to === '2/36',
    `a troca por PKM custa ${plano.cost} e sai de 2/31 para 2/36`);
  ok(priceGear([{ index: vivo.index, weapon: vivo.weapon }], g, R).changes.length === 0, 'escolher a arma que ele ja tem nao cobra nem escreve');
  for (const [pedido, porque] of [[{ index: vivo.index, weapon: '2/2' }, 'arma de outro exercito'], [{ index: caido.index, weapon: '2/36' }, 'homem caido'], [{ index: 9999, weapon: '2/36' }, 'homem que nao existe']]) {
    let erro = null; try { priceGear([pedido], g, R); } catch (e) { erro = e; }
    ok(!!erro, `recusado: ${porque}`);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-e64-'));
  const out = path.join(tmp, 'gear.bts');
  const trace = { event() {}, wrote() {}, read() {} };
  const r = applyGear({ save, out, changes: plano.changes, trace });
  const cauda = (p, i) => readRosterTails(p)[i].cauda;
  const antes = cauda(save, vivo.index), depois = cauda(out, vivo.index);
  ok(r.homens === 1 && depois[1] === 2 && depois[2] === 36 && depois.length === antes.length,
    `dois bytes no lugar: ${antes[1]}/${antes[2]} -> ${depois[1]}/${depois[2]}, registro de ${depois.length} B como antes`);
  ok(depois[4] === antes[4] && depois[5] === antes[5] && readAmmoVector(depois).n === readAmmoVector(antes).n,
    'a arma 2 e o paiol nao sao tocados: quem enche o paiol e o passo seguinte do refit');
  ok(readRoster(out).soldados.length === readRoster(save).soldados.length, 'e o roster continua com os mesmos homens');
  // O elo com o refit: com a arma nova na mao, o refil passa a pedir a municao DELA.
  const pede = (p) => missingLoads(p, toeTable(), weaponTable())[vivo.index] || {};
  ok(!pede(save)[5] && pede(out)[5] > 0, `e ai o refil pede 7,62x54R para ele (${JSON.stringify(pede(out))})`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 37. HABILIDADES OPERACIONAIS (plano 2) E TREINO (plano 3, ultima peca). Uma habilidade e uma
//     compra de efeito unico para UMA batalha: o credito sai no quartel-mestre e o efeito e
//     consumido quando a batalha seguinte e montada. O treino sobe um degrau de experiencia, e para
//     em Veteran de proposito — dali para cima se ganha lutando.
{
  const lista = abilityList(R);
  ok(lista.length >= 4 && lista.every((a) => a.id && (a.price >= 0 || a.ops >= 0) && a.effect),
    `${lista.length} habilidades, todas com id, preco (creditos ou pontos) e efeito (${lista.map((a) => a.id).join(', ')})`);
  const push = lista.find((a) => a.id === 'push-on');
  // 18/10 (autor): o tempo extra custa pontos operacionais (1 e 2); o push-on, aposentado, ainda guarda o preco antigo
  const c15 = lista.find((a) => a.id === 'clock-15'), c30 = lista.find((a) => a.id === 'clock-30');
  ok(push && push.effect.minutes === 30 && push.effect.noRefit === true && c15.ops === 1 && c30.ops === 2 && c15.price == null && c30.price == null,
    `"push on" da os 30 minutos sem reabastecer nem descansar; o tempo extra custa ${c15.ops} e ${c30.ops} pontos operacionais`);

  // O RELOGIO CAI NUM DEGRAU QUE O EDITOR OFERECE, e o que o jogador recebeu de verdade e dito.
  ok(withExtraMinutes(45, 15, R).final === 60 && withExtraMinutes(45, 15, R).extra === 15, '45 + 15 da 60 exatos');
  const doze = withExtraMinutes(60, 15, R);
  ok(doze.final === 70 && doze.extra === 10 && doze.paid === 15, `60 + 15 cai em 70, e o app diz que entregou +${doze.extra} do que foi pago`);
  const teto = R.duration.allowed[R.duration.allowed.length - 1];
  ok(withExtraMinutes(teto, 30, R).final === teto, `no teto da lista (${teto}) o relogio nao passa`);
  ok(withExtraMinutes(45, 0, R).final === 45 && withExtraMinutes(45, 0, R).extra === 0, 'sem habilidade, a duracao e a do tier');

  // CONSUMIR UMA VEZ, e refazer a batalha nao cobra nem perde nada.
  const comprada = { abilities: { pending: [{ id: 'clock-15' }, { id: 'push-on' }], applied: [] } };
  const nova = abilitiesFor(comprada, 5, R);
  ok(nova.ids.length === 2 && nova.effect.minutes === 45 && nova.effect.noRefit === true && nova.fresh,
    `as duas pendentes valem para a batalha seguinte: +${nova.effect.minutes} min e sem refit`);
  const jaUsada = { abilities: { pending: [{ id: 'intel' }], applied: [{ id: 'clock-30', battle: 5 }] } };
  const refeita = abilitiesFor(jaUsada, 5, R);
  ok(refeita.ids.join() === 'clock-30' && !refeita.fresh && refeita.effect.minutes === 30,
    'refazer a batalha 5 usa a que ja foi aplicada nela, e nao consome a que esta esperando a 6');
  ok(abilitiesFor(jaUsada, 6, R).ids.join() === 'intel', 'e a que espera vale para a batalha 6');

  // O TETO DE REPETICOES e a cobranca.
  ok(priceAbilities(['clock-15', 'clock-15'], { abilities: { pending: [] } }, R).cost === 2 * (lista.find((a) => a.id === 'clock-15').price || 0),
    'duas do mesmo, quando o teto permite, custam duas');
  for (const [ids, estado, porque] of [
    [['clock-30', 'clock-30'], { abilities: { pending: [] } }, 'passar do teto de repeticoes'],
    [['clock-15'], { abilities: { pending: [{ id: 'clock-15' }, { id: 'clock-15' }] } }, 'o teto contando o que ja esta pendente'],
    [['nao-existe'], { abilities: { pending: [] } }, 'habilidade que nao existe'],
    // E176: push-on, intel e interdiction sairam da loja (ficam na lista para as batalhas antigas)
    [['intel'], { abilities: { pending: [] } }, 'habilidade aposentada (intel)'],
    [['interdiction'], { abilities: { pending: [] } }, 'habilidade aposentada (interdiction)'],
  ]) { let erro = null; try { priceAbilities(ids, estado, R); } catch (e) { erro = e; } ok(!!erro, `recusado: ${porque}`); }

  // "SEM DESCANSO" no cabecalho da campanha, sem mexer no resto.
  const normal = campaignPercentages(R), semRest = campaignPercentages(R, { rest: 0 });
  ok(normal.length === 8 && semRest.length === 8 && semRest[3] === 0 && semRest[7] === 0 && semRest[1] === normal[1] && semRest[2] === normal[2],
    `o descanso vai a zero nos dois lados e o resto fica: ${semRest.join(',')}`);

  // O TREINO: preco pelo valor da unidade, com piso, e teto em Veteran.
  const esquadrao = { coreId: 1, name: 'Squad (Rifle)', experience: 'Regular', price: 41, type: [1, 1], nation: 'UKR' };
  const tanque = { coreId: 2, name: 'Main Battle Tank (T-64BV)', experience: 'Regular', price: 720, type: [2, 7], nation: 'UKR' };
  const st = { nation: 'UKR' };
  // 18/10 (autor): o treino esta DESLIGADO — experiencia nao se compra. A conta continua sob a regra ligada.
  ok(R.progression.training.on === false && trainPrice(st, esquadrao, R) === null && trainPrice(st, tanque, R) === null,
    'o treino esta desligado: ninguem tem preco de treino');
  const RT = JSON.parse(JSON.stringify(R)); RT.progression.training.on = true;
  const tE = trainPrice(st, esquadrao, RT), tT = trainPrice(st, tanque, RT);
  ok(tE.level === 'Veteran' && tT.level === 'Veteran' && tE.price === RT.progression.training.pricePerStep && tT.price > tE.price,
    `religado: um degrau para Veteran, esquadrao no piso (${tE.price}) e tanque acima dele (${tT.price})`);
  ok(trainPrice(st, { ...esquadrao, experience: RT.progression.training.maxLevel }, RT) === null,
    `quem chegou a ${RT.progression.training.maxLevel} nao se treina mais: dali para cima e lutando`);
  ok(trainPrice(st, { ...esquadrao, experience: 'Green' }, RT).level === 'Regular', 'e o degrau e sempre UM');

  // O RELOGIO NO ARQUIVO: mais tempo e um byte. Escrito numa copia da batalha 4 da EASY2.
  const btt = path.join(CAMPAIGNS_DIR, 'EASY2', 'battles', '04', 'battle.btt');
  if (fs.existsSync(btt)) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-e65-'));
    const copia = path.join(tmp, 'mais-tempo.btt');
    fs.copyFileSync(btt, copia);
    const antes = readDuration(btt);
    writeDuration(copia, 120);
    const a = fs.readFileSync(btt), b = fs.readFileSync(copia);
    const dif = []; for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) dif.push(i);
    const depois = readDuration(copia);
    ok(a.length === b.length && dif.length <= 4 && depois.cabecalho === 120 && depois.bloco === 120,
      `mais tempo e ${dif.length} bytes e nao um: um no cabecalho e dois na copia de dentro, que e comprimida (${JSON.stringify(antes)} -> ${JSON.stringify(depois)}, arquivo do mesmo tamanho)`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 38. A GRANADA NAO ESTA NO VETOR DE MUNICAO (113.7, E67). O painel escreve "Grenade N" e nenhum item
//     do vetor da N: cada granada e uma entrada de 3 bytes nas listas do rabo. Isto importa porque o
//     refil do app reabastece o VETOR, e por isso ele nunca repos granada nenhuma — o mesmo formato
//     de bug do PKM seco da E54, uma camada mais funda. Este teste existe para que a conta que
//     provou o achado continue de pe e para marcar o dia em que a reposicao entrar.
{
  const fix = (n) => path.join(import.meta.dirname, '..', 'research', 'exemplos', n);
  const conta = (arq) => {
    const homens = readRosterTails(arq);
    let total = 0; const tipos = {};
    for (const d of homens) {
      const g = readGrenades(d);
      if (!g) continue;
      total += g.total;
      for (const [t, n] of Object.entries(g.porTipo)) tipos[t] = (tipos[t] || 0) + n;
    }
    return { total, tipos, homens: homens.length };
  };

  if (fs.existsSync(fix('e54_pkm_seco.bts')) && fs.existsSync(fix('e60_bit20.bts'))) {
    const ukr = conta(fix('e54_pkm_seco.bts'));
    ok(ukr.total === 73 && ukr.tipos['1,2'] === 67 && ukr.tipos['1,4'] === 6,
      `as granadas sao lidas: ${ukr.total} em ${ukr.homens} homens, ${ukr.tipos['1,2']} do tipo 1,2 e ${ukr.tipos['1,4']} do 1,4`);

    // O TIPO E POR EXERCITO, como o id da arma (118.1): o save com o batalhao americano recrutado
    // traz dois tipos que o save so-ucraniano nao tem.
    const mista = conta(fix('e60_bit20.bts'));
    const soDaMista = Object.keys(mista.tipos).filter((t) => !ukr.tipos[t]);
    ok(soDaMista.length === 2 && soDaMista.includes('1,1') && soDaMista.includes('1,3'),
      `o tipo de granada e por exercito: ${soDaMista.join(' e ')} so aparecem onde ha unidade americana`);
    // Os tipos ucranianos aparecem nos DOIS saves. A versao antiga cobrava a mesma CONTA nos dois, o
    // que so valia enquanto o leitor de cauda nao via a segunda lista de granadas (E81): agora o
    // save misto mostra 93 do tipo 1,2 contra 67 do so-ucraniano, e sao saves de forcas diferentes.
    ok(mista.tipos['1,2'] >= ukr.tipos['1,2'] && mista.tipos['1,4'] >= ukr.tipos['1,4'],
      `e os tipos ucranianos aparecem nos dois saves (1,2: ${ukr.tipos['1,2']} e ${mista.tipos['1,2']})`);
  }

  // O PAR DE ARQUIVOS QUE MOSTROU O BURACO: a batalha 4 que o app montou ANTES de 17/09. Nele a
  // municao volta e a granada fica onde parou. Os dois arquivos estao congelados no disco dele, e o
  // teste os le como prova historica — nao como invariante: do E69 em diante a granada volta junto
  // (teste 39). Onde os arquivos nao existirem, o teste se cala.
  const SV = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/';
  const [fim, proxima] = ['E2 BTT3 TRANSITION.bts', 'E2 BTT3 TRANSITION [B04] (rebuilt 4).bts'].map((n) => SV + n);
  if (fs.existsSync(fim) && fs.existsSync(proxima)) {
    const porCore = (arq) => {
      const r = readRoster(arq), c = readRosterTails(arq), m = new Map();
      for (const u of r.unidades) {
        let granadas = 0, municao = 0;
        for (const s of u.soldados) {
          const d = c[s.indice];
          if (!d) continue;
          granadas += readGrenades(d)?.total || 0;
          for (const p of (readAmmoVector(d.cauda)?.pares || [])) municao += p.qtd;
        }
        m.set(u.coreId, { granadas, municao });
      }
      return m;
    };
    const a = porCore(fim), b = porCore(proxima);
    const comuns = [...a.keys()].filter((k) => b.has(k) && (a.get(k).granadas || a.get(k).municao));
    const granadaMudou = comuns.filter((k) => a.get(k).granadas !== b.get(k).granadas);
    const municaoSubiu = comuns.filter((k) => b.get(k).municao > a.get(k).municao);
    ok(comuns.length >= 5 && !granadaMudou.length,
      `o refil de ANTES do E69 nao tocava em granada: ${comuns.length} unidades, nenhuma mudou${granadaMudou.length ? ' (mudaram: ' + granadaMudou.join(', ') + ')' : ''}`);
    ok(municaoSubiu.length >= 3,
      `e mexe na municao: ${municaoSubiu.length} das ${comuns.length} entram na batalha seguinte com mais bala`);
    const secas = comuns.filter((k) => !b.get(k).granadas);
    if (secas.length) console.log(`     (${secas.length} unidade(s) ja sem granada nenhuma: core ${secas.join(', ')})`);
  }
}

// 39. E AGORA A GRANADA VOLTA (E69). A reposicao cresce o registro em 3 bytes por granada, no mesmo
//     campo que a gramatica usa para achar o fim da cauda — errar ali nao da "granada errada", da
//     CAUDA ILEGIVEL, que e o que tirou a arma e a municao da tela do jogador em 08/09 (119). Este
//     teste roda o caminho inteiro numa amostra do repositorio e cobra as tres coisas que importam:
//     o arquivo cresce o que devia, ninguem passa do teto do tipo, e nenhuma cauda se perde.
{
  const fix = path.join(import.meta.dirname, '..', 'research', 'exemplos', 'e60_bit20.bts');
  const tabela = grenadeTable();
  if (fs.existsSync(fix) && tabela) {
    ok(Object.keys(tabela.tabela).length > 50 && Object.keys(tabela.teto).length > 50,
      `a dotacao de granada tem ${Object.keys(tabela.tabela).length} tipos de unidade e ${Object.keys(tabela.teto).length} tetos`);

    const plano = missingGrenades(fix, tabela);
    const pedidas = Object.values(plano).reduce((s, alvo) => s + Object.values(alvo).reduce((a, b) => a + b, 0), 0);
    ok(Object.keys(plano).length > 0 && pedidas > 0, `${Object.keys(plano).length} homens com granada a repor`);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-e69-'));
    const out = path.join(tmp, 'granadas.bts');
    const antes = readRosterTails(fix);
    const totalAntes = antes.reduce((s, d) => s + (readGrenades(d)?.total || 0), 0);
    const r = restoreGrenades(fix, out, plano);

    ok(r.cresceu === r.granadas * 3, `o registro cresce 3 bytes por granada: ${r.granadas} granadas, +${r.cresceu} bytes`);

    const depois = readRosterTails(out);
    const totalDepois = depois.reduce((s, d) => s + (readGrenades(d)?.total || 0), 0);
    ok(totalDepois === totalAntes + r.granadas, `${totalAntes} granadas viram ${totalDepois} (+${r.granadas})`);
    ok(depois.filter((d) => d.ok).length === antes.filter((d) => d.ok).length,
      `nenhuma cauda se perde: ${depois.filter((d) => d.ok).length} legiveis antes e depois`);

    // O TETO E O QUE SEPARA REPOR DE PREMIAR. Somar a dotacao de cada vaga daria a toda esquadra o
    // bolso da mais bem suprida que ja apareceu (no tipo 9221, 40 granadas contra as 20 da tropa
    // bem suprida), porque o jogo redistribui granada de baixa e o maximo por vaga ja e catado.
    // O QUE O TETO PROMETE E QUE A REPOSICAO NAO EMPURRA NINGUEM ACIMA DELE — nao que ninguem esteja
    // acima. Quem volta da batalha com granada catada ja passa do teto por conta propria: desde que
    // o leitor de cauda deixou de perder a segunda lista (E81) da para ver um homem com 33 no save
    // do autor. O refil so pode ADICIONAR ate o teto; acima dele, quem tira e o aparo (E78).
    const roster = readRoster(out);
    const empurrados = [];
    for (const u of roster.unidades) {
      if (!u.soldados.length) continue;
      const teto = tabela.teto[u.tipo];
      if (teto == null) continue;
      let antesT = 0, depoisT = 0;
      for (const s of u.soldados) { antesT += readGrenades(antes[s.indice])?.total || 0; depoisT += readGrenades(depois[s.indice])?.total || 0; }
      if (depoisT > Math.max(teto, antesT)) empurrados.push(`core ${u.coreId}: ${antesT} -> ${depoisT} com teto ${teto}`);
    }
    ok(!empurrados.length, `a reposicao nao empurra ninguem acima do teto do tipo${empurrados.length ? ': ' + empurrados.join(', ') : ''}`);

    // E IDEMPOTENTE: rodar de novo no arquivo ja reposto nao acrescenta nada.
    const denovo = missingGrenades(out, tabela);
    const sobra = Object.values(denovo).reduce((s, alvo) => s + Object.values(alvo).reduce((a, b) => a + b, 0), 0);
    ok(!Object.keys(denovo).length || sobra === 0, `rodar duas vezes nao acrescenta granada (${Object.keys(denovo).length} homens na segunda volta)`);

    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 40. O CABECALHO DA FORCA TEM DE ESTAR ONDE SE PENSA (E70). Ele tem largura fixa e termina no id do
//     primeiro registro: 14 bytes depois do marcador no arquivo azul-primeiro, 18 no
//     vermelho-primeiro, que carrega o `K_verm` a mais. Medido em 236 arquivos, 149 e 86. O dia em
//     que o marcador errou (uma batalha de 13 topos gerou um token parecido 5 bytes adiante), o
//     `K_azul` leu 16.777.216, a arvore nao achou o lado vermelho e a checagem reprovou uma batalha
//     BOA acusando enchimento errado num Ural. Duas amostras bastam: uma de cada variante.
{
  const lib = path.join(import.meta.dirname, '..', 'assets', 'lib');
  const amostra = [
    ['UKR - Tactical Group (Battalion [BTR]).btt', 14],
    ['RU - Tactical Group (Battalion [BTR]).btt', 18],
  ];
  for (const [nome, esperado] of amostra) {
    const f = path.join(lib, nome);
    if (!fs.existsSync(f)) continue;
    const X = openBtt(f);
    const dif = X.R[0].c - X.m;
    ok(dif === esperado, `${nome.replace(/\.btt$/, '')}: o primeiro registro comeca ${dif} bytes depois do marcador (${esperado === 14 ? 'azul' : 'vermelho'}-primeiro pede ${esperado})`);
  }
  // E a checagem estrutural passou a acusar isso como causa, em vez de deixar o sintoma aparecer
  // longe: num arquivo bom ela nao reclama.
  const f = path.join(lib, 'UKR - Tactical Group (Battalion [BTR]).btt');
  if (fs.existsSync(f)) {
    const v = checkForce(f);
    ok(v.ok && !v.erros.some((e) => /cabecalho fora de lugar/.test(e)), `a biblioteca passa na checagem estrutural (${v.erros.length} erros)`);
  }
}

// 41. O REFIT INTEIRO, COM O TRACER DE VERDADE (E71). O passo da granada entrou no `refitSave` com
//     `trace?.(...)` — chamando o objeto de log como funcao — e nenhum teste passou por ali: os
//     testes 38 e 39 chamam as pecas, nao o refit. O Apply da batalha 4 do autor caiu com "trace
//     is not a function" DEPOIS do ressuprimento, na ultima etapa. Este teste roda o `refitSave`
//     de ponta a ponta numa amostra do repositorio, com a MESMA classe `Trace` do servidor, e cobra
//     que o passo da granada aconteceu e foi registrado. Erro de forma de chamada cai aqui, nao no
//     Apply dele.
{
  const fix = path.join(import.meta.dirname, '..', 'research', 'exemplos', 'e60_bit20.bts');
  if (fs.existsSync(fix) && grenadeTable()) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-e71-'));
    const logFile = path.join(tmp, 'log.jsonl');
    const trace = new Trace(logFile, { slug: 'teste', battle: 0 });
    let out = null, erro = null;
    try {
      out = refitSave({ save: fix, workDir: path.join(tmp, 'work'), tag: 'T', R, trace, table: toeTable() });
    } catch (e) { erro = e; }
    ok(!erro && out && fs.existsSync(out), `o refit roda inteiro com o tracer do servidor${erro ? ' — caiu: ' + erro.message : ''}`);
    const eventos = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split(/\r?\n/).map((l) => JSON.parse(l)) : [];
    const gren = eventos.find((e) => e.type === 'refit.grenades');
    ok(!!gren && gren.granadas > 0, `e o passo da granada foi registrado no log: ${gren ? gren.homens + ' homens, ' + gren.granadas + ' granadas' : 'nao apareceu'}`);
    if (out) {
      const antes = readRosterTails(fix).reduce((s, d) => s + (readGrenades(d)?.total || 0), 0);
      const depois = readRosterTails(out).reduce((s, d) => s + (readGrenades(d)?.total || 0), 0);
      // Com o reset de fabrica (28/09) a granada volta a DOTACAO, para cima ou para baixo: esta amostra
      // ja passou por refits antigos, que davam granada acima da fabrica. O que se cobra e que nenhum
      // homem com linha na fabrica sai dela.
      const resto = resetPlan(out, factoryTable(), { armies: armiesOfSave(out) });
      ok(depois !== antes && !Object.keys(resto.grenades).length, `a granada volta a dotacao de fabrica: ${antes} -> ${depois}, ${Object.keys(resto.grenades).length} homem(ns) fora dela`);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 42. UM DESTROCO NAO E RESERVA (E71). `spareFor` tomava "dormente" por `present: false`, e a maquina
//     que queimou numa batalha anterior e foi reposta tambem esta desligada. Na batalha 4 da EASY2
//     o BTR core 20 foi "reposto" pelo core 10, destroco da batalha 3, que `battlePresence` deixa
//     fora do mapa: autor pagou dois BTR e entrou com um. Aqui, o arsenal tem um destroco com id
//     menor (que a ordem por coreId escolheria primeiro) e uma reserva de verdade: so a segunda serve.
{
  const tipo = [70, 5];
  const st = {
    units: [
      { coreId: 20, name: 'BTR (perdido)', type: tipo, formation: 'Batalhao / Recon', present: true },
      { coreId: 10, name: 'BTR (destroco b3)', type: tipo, formation: 'Batalhao / Recon', present: false },
      { coreId: 12, name: 'BTR (parado, saiu de campo)', type: tipo, formation: 'Batalhao / Recon', present: false },
      { coreId: 14, name: 'BTR (stand-down)', type: tipo, formation: 'Batalhao / Recon', present: false },
      { coreId: 34, name: 'BTR (reserva)', type: tipo, formation: 'Batalhao / Antitank', present: false },
    ],
    lost: [10],
    wrecked: [{ battle: 3, coreId: 10, replacedBy: 20 }],
    repaired: [{ battle: 3, coreId: 12, replacedBy: 13 }],
    standDown: [14],
  };
  const s = spareFor(st, st.units[0]);
  ok(s && s.coreId === 34, `a reserva e a maquina intacta (core ${s?.coreId}), nunca o destroco, a parada ou o stand-down — mesmo com ids menores e na mesma formacao`);
  // E o sufixo "#n" sai do caminho: "Platoon (Rifle) #2" e irmao de "Platoon (Rifle)".
  const st2 = { units: [
    { coreId: 1, name: 'perdido', type: tipo, formation: 'Bn / Company (Rifle) / Platoon (Rifle)', present: true },
    { coreId: 2, name: 'longe', type: tipo, formation: 'Bn / Battery (Mortar)', present: false },
    { coreId: 3, name: 'irmao', type: tipo, formation: 'Bn / Company (Rifle) / Platoon (Rifle) #2', present: false },
  ] };
  ok(spareFor(st2, st2.units[0])?.coreId === 3, 'o pelotao irmao ("#2") vence a bateria de morteiros, porque o "#n" sai da comparacao');
}

// 43. A ELEVACAO E COLUNA A COLUNA (FORMATO 71.1, E72). A camada de 4 B/tile usa o indice `x*H + y`, e
//     nao `y*W + x` como a grade de 5 B. O escritor de mapas gravou linha a linha ate 20/09 e o
//     primeiro Mucuge entregou ao jogo o relevo fatiado no passo errado — degrau de 209 m entre tiles
//     vizinhos, contra um maximo de 24 m nos 333 mapas reais — e o carregamento travou. A prova que
//     cabe num teste: num mapa NAO quadrado e com relevo, o vizinho a distancia H e quase igual, e o
//     vizinho a distancia W e outro lugar do mapa.
{
  const dir = path.join(import.meta.dirname, '..', 'assets', 'qb_attack');
  let feito = false;
  if (fs.existsSync(dir)) {
    for (const nome of fs.readdirSync(dir).filter((f) => f.endsWith('.btt'))) {
      let m; try { m = readMap(path.join(dir, nome)); } catch { continue; }
      if (!m.iaConfere || m.W === m.H) continue;
      const N = m.W * m.H, e0 = m.fimGrade, v = (i) => m.c.readUInt16LE(e0 + 4 * i);
      let mn = 65535, mx = 0; for (let i = 0; i < N; i++) { const x = v(i); if (x < mn) mn = x; if (x > mx) mx = x; }
      if (mx - mn < 300) continue;                          // menos de 30 m de relevo nao separa nada
      const dif = (k) => { let s = 0, n = 0; for (let i = 0; i + k < N; i += 5) { s += Math.abs(v(i) - v(i + k)); n++; } return s / n / 10; };
      const pH = dif(m.H), pW = dif(m.W);
      ok(pH * 3 < pW, `${nome.replace(/ Attack CMBSRL\.btt$/, '')}: o vizinho a H=${m.H} difere ${pH.toFixed(2)} m em media e o vizinho a W=${m.W} difere ${pW.toFixed(2)} m — a camada e coluna a coluna`);
      // e o escritor usa essa ordem: uma rampa que so sobe em X tem de sair constante ao longo de cada coluna
      const buf = writeElevation(7, 5, (x) => 20 + x, false);
      const colunaConstante = [...Array(7)].every((_, x) => [...Array(5)].every((__, y) => buf.readUInt16LE(4 * (x * 5 + y)) === (20 + x) * 10));
      ok(colunaConstante && elevationIndex(3, 2, 7, 5) === 17, 'e o escritor grava em `x*H + y`: a rampa em X sai constante dentro de cada coluna');
      feito = true;
      break;
    }
  }
  if (!feito) console.log('     (sem mapa nao quadrado com relevo em assets/qb_attack: teste 43 nao rodou)');
}

// 44. A ARMA DEVOLVIDA TEM DE SER UMA ARMA (E73). A linha de uma vaga tem DUAS formas: a colheita
//     global escreve `{classe, item}` e a linha de base que a campanha aprende sozinha escreve
//     `{arma: "2/24"}`. `toeWeapons` so lia a primeira, e onde so a campanha conhecia a vaga saia
//     "undefined/undefined" -> NaN -> o Buffer grava ZERO: o Tkachuk entrou na batalha 5 da EASY2
//     com `0/0`, um icone vazio no painel. E o saqueado guarda o ITEM do que levaram dele (111.14),
//     que e a melhor resposta e nao estava sendo usada.
{
  const fix = path.join(import.meta.dirname, '..', 'research', 'exemplos', 'e60_bit20.bts');
  if (fs.existsSync(fix)) {
    const tails = readRosterTails(fix);
    const roster = readRoster(fix);
    // uma tabela SO com a forma da linha de base, que e a que quebrava
    const tabela = {};
    for (const u of roster.unidades) {
      tabela[u.tipo] = tabela[u.tipo] || {};
      u.soldados.forEach((s, vaga) => { tabela[u.tipo][vaga] = { arma: '2/24', municao: { 1: 240 } }; });
    }
    const armas = toeWeapons(fix, tabela);
    const entradas = Object.entries(armas);
    const ruins = entradas.filter(([, a]) => !Number.isInteger(a.classe) || !Number.isInteger(a.item) || a.classe <= 0 || a.classe > 7);
    ok(entradas.length > 0 && !ruins.length,
      `${entradas.length} armas lembradas, nenhuma invalida${ruins.length ? ': ' + ruins.slice(0, 3).map(([i, a]) => `${i}=${a.classe}/${a.item}`).join(', ') : ''}`);

    // A ORDEM: a dotacao da VAGA ganha do que o homem carregava. O Melnyk guardava o item 24, e os
    // esquadroes irmaos do tipo 9221 dizem que a vaga 0 leva `2/31` — e 2/31 que ele recebe. O item
    // dele so entra quando ninguem mais sabe, e ai vale mais que "a arma mais comum do esquadrao".
    const saqueados = [];
    for (const u of roster.unidades) for (const s of u.soldados) {
      const c = tails[s.indice]?.cauda;
      if (c && c[1] === 0x08) saqueados.push({ nome: s.nome, item: c[2], a: armas[s.indice] });
    }
    const comResposta = saqueados.filter((x) => x.a);
    ok(comResposta.length > 0 && comResposta.every((x) => x.a.classe > 0 && x.a.classe < 8),
      `${comResposta.length} de ${saqueados.length} saqueados recebem arma de verdade: ${comResposta.slice(0, 3).map((x) => `${x.nome} 8/${x.item} -> ${x.a.classe}/${x.a.item} (${x.a.from})`).join(', ')}`);
    const melnyk = saqueados.find((x) => x.nome === 'Melnyk');
    if (melnyk) ok(melnyk.a && melnyk.a.from === 'brother squad' && melnyk.a.item === 31,
      `a dotacao da vaga vence o que ele carregava: Melnyk guardava o item ${melnyk.item} e recebe ${melnyk.a?.classe}/${melnyk.a?.item} do esquadrao irmao`);
  }
}

// 45. A LISTA DE MUNICAO VAZIA PRECISA SER ACHADA — mas so por quem repoe (E73). Quando uma unidade
//     gasta tudo, cada item SAI da lista (110.8) e sobra `n = 0`: a artilharia do autor foi de
//     `281=75, 282=30` na batalha 3 para lista vazia na 4, e como o leitor comecava em `n = 1` a
//     reposicao passava reto — a bateria entrou na batalha 5 sem um tiro. A leitura vazia e opcional
//     porque na COLHEITA ela e veneno: todo bloco dormente vira "com lista" e o bloco que tinha uma
//     leitura boa passa a ter duas e e descartado.
{
  const fix = path.join(import.meta.dirname, '..', 'research', 'exemplos', 'e60_bit20.bts');
  if (fs.existsSync(fix)) {
    const b = unitBlocks(fix);
    const vazias = b.unidades.filter((u) => u.ff >= 12 && !readUnitAmmo(b.exp, u).length && readUnitAmmo(b.exp, u, null, true).some((r) => r.n === 0));
    ok(vazias.length > 0, `${vazias.length} unidade(s) com lista vazia: invisiveis sem pedir, achadas quando se pede`);
    const semPedir = b.unidades.filter((u) => u.ff >= 12 && readUnitAmmo(b.exp, u).some((r) => r.n === 0));
    ok(!semPedir.length, 'e a leitura vazia NUNCA entra sem ser pedida — senao a colheita se enche de bloco dormente');
  }
}

// 46. O ANEXO FICA COM A FORMACAO ESCOLHIDA (E75). O autor selecionou o Platoon (Armored) da 1a
//     companhia do Combined Arms [Task Force], pediu um Abrams, e o tanque apareceu no Platoon
//     (Armored) da 2a companhia, na vaga de um tanque do molde: "a primeira copia livre mais barata"
//     era uma folha dormente do PROPRIO batalhao dele. O Abrams so existe em duas fontes e o corte
//     das dez mais baratas trazia nove da dele. As duas funcoes que escolhem a copia sao puras e
//     moram na pagina; aqui elas sao recortadas de `app/web/app.js` e rodadas contra o menu de verdade.
{
  const pagina = fs.readFileSync(path.join(import.meta.dirname, 'web', 'app.js'), 'utf8');
  const i = pagina.indexOf('function lugarDaCopia('), j = pagina.indexOf('\n// `copia` ja escolhida');
  ok(i > 0 && j > i, 'a pagina tem `lugarDaCopia` e `escolherCopia`, no lugar onde o teste as procura');
  if (i > 0 && j > i) {
    const { lugarDaCopia: lugar, escolherCopia: escolher } = new Function(`${pagina.slice(i, j)}\nreturn { lugarDaCopia, escolherCopia };`)();
    const TF = 'US - Battalion (Combined Arms [Task Force]).btt';
    // o mecanismo da copia, contra o menu SEM a lista de anexos (18/10: o Abrams nao se vende mais como anexo)
    const semLista = JSON.parse(JSON.stringify(R)); delete semLista.singleVehicles.allow;
    const menu = singleVehicles(['US', 'UKR'], { rules: semLista });
    const arvore = formationTree(TF);
    const pelotoes = [];
    const anda = (n) => { if (n.isFormation && n.name === 'Platoon (Armored)') pelotoes.push(n); (n.children || []).forEach(anda); };
    arvore.roots.forEach(anda);
    ok(pelotoes.length >= 2, `o batalhao tem ${pelotoes.length} "Platoon (Armored)" com o MESMO nome — e por isso que o rotulo "attached to" nao denunciava o erro`);

    // o batalhao como o autor o tem: o 1o pelotao blindado em campo, o resto dormente
    const meu = { formation: { file: TF, name: 'Battalion (Combined Arms [Task Force])' }, owned: true, keep: new Set(pelotoes[0].children.map((c) => c.key)) };
    const alvo = { pick: meu, node: pelotoes[0] };
    for (const nome of ['Main Battle Tank (M1A2 SEP Abrams (APS))', 'Main Battle Tank (M1A2 SEP Abrams)']) {
      const v = menu.find((x) => x.name === nome);
      const fontes = new Set(v.copies.map((c) => c.source));
      ok(fontes.size >= 2, `${nome}: o menu traz copia de ${fontes.size} fontes (o corte e por fonte, nao "as dez mais baratas")`);
      const e = escolher(v.copies, [meu], alvo);
      ok(e && e.lugar === 'grupo' && e.c.source !== TF,
        `${nome}: anexar ao 1o pelotao NAO pega tanque do proprio batalhao — vem de "${e?.c.source}" como ${e?.lugar}`);
    }

    // a folha debaixo do alvo e a unica do proprio batalhao que serve — e ganha o empate de preco
    const aps = menu.find((x) => x.name === 'Main Battle Tank (M1A2 SEP Abrams (APS))');
    const noSegundo = escolher(aps.copies, [meu], { pick: meu, node: pelotoes[1] });
    const daqui = aps.copies.filter((c) => c.source === TF && c.key.startsWith(pelotoes[1].key + '.'));
    if (daqui.length) ok(noSegundo.lugar === 'aqui' ? noSegundo.c.key.startsWith(pelotoes[1].key + '.') : noSegundo.c.price < Math.min(...daqui.map((c) => c.price)),
      `no 2o pelotao (dormente) a copia e dele mesmo quando nao ha mais barata: ${noSegundo.c.key} como ${noSegundo.lugar}`);
    const fora = aps.copies.find((c) => c.source === TF && !c.key.startsWith(pelotoes[0].key + '.'));
    ok(lugar(fora, [meu], alvo) === 'fora', `e a folha ${fora.key} do mesmo batalhao, noutro pelotao, e "fora" para o 1o — era ela que a tela marcava`);

    // o segundo Abrams: o carregador ja pendurado NESTE grafico serve, e da uma folha diferente
    const um = escolher(aps.copies, [meu], alvo);
    const carregador = { formation: { file: um.c.source }, keep: new Set([um.c.key]), attached: new Set([um.c.key]), attachedHost: { file: TF, key: alvo.node.key } };
    const dois = escolher(aps.copies, [meu, carregador], alvo);
    ok(dois && dois.lugar === 'grupo' && dois.c.key !== um.c.key, `o segundo Abrams e outra folha do mesmo carregador: ${um.c.key} e depois ${dois?.c.key}`);
    const outroGrafico = { ...carregador, attachedHost: { file: 'outro batalhao.btt', key: '0' } };
    ok(lugar(aps.copies.find((c) => c.source === um.c.source && c.key !== um.c.key), [meu, outroGrafico], alvo) === null,
      'um carregador pendurado no grafico de OUTRA formacao nao serve: a maquina nao teria onde aparecer');

    // e quando as duas fontes ja sao dele, sobra o "fora" — que a tela so aceita perguntando
    const tambemMeu = { formation: { file: um.c.source, name: 'Battalion (Combined Arms)' }, owned: true, keep: new Set() };
    const resto = escolher(aps.copies, [meu, tambemMeu], alvo);
    ok(resto && resto.lugar === 'fora', `com as duas fontes ja na campanha a resposta e "fora" (${resto?.c.source} ${resto?.c.key}), nunca um anexo de mentira`);
  }
}

// 47. O REFIL NAO PODE ENGORDAR O ESQUADRAO (E76). O paiol de um esquadrao e um bolo so que o jogo
//     reparte entre os homens como quer; o refil antigo enchia CADA homem ate o maior valor que a
//     vaga dele ja tinha visto, e a soma crescia a cada batalha — o 3rd Squad do autor chegou a
//     12037 tiros de 5.45 contra 2298 de dotacao, e perdeu o Fast e o Quick pelo peso. Nenhum teste
//     olhava quantidade, entao 318 checagens passavam com isso dentro. Aqui: o refil por unidade
//     poe o total na dotacao, PARA CIMA E PARA BAIXO, e rodar de novo nao muda mais nada.
{
  const fix = path.join(import.meta.dirname, '..', 'research', 'exemplos', 'e60_bit20.bts');
  if (fs.existsSync(fix)) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-e76-'));
    const issue = toeTable(), arms = weaponTable();
    const totais = (f) => {
      const r = readRoster(f), c = readRosterTails(f), m = new Map();
      for (const u of r.unidades) for (const s of u.soldados) {
        if (s.estado > 1) continue;
        for (const p of readAmmoVector(c[s.indice]?.cauda)?.pares || []) m.set(`${u.coreId}:${p.item}`, (m.get(`${u.coreId}:${p.item}`) || 0) + p.qtd);
      }
      return m;
    };
    // 1. o estrago, reproduzido com o refil ANTIGO: duas passadas de `fullLoads` sobre o mesmo save
    const gordo = path.join(tmp, 'gordo.bts');
    resupplyMen(fix, gordo, fullLoads(fix, issue), { fracao: 1 });
    const antes = totais(fix), inflado = totais(gordo);
    const cresceu = [...inflado].filter(([k, q]) => q > (antes.get(k) || 0)).length;
    // 2. o refil por unidade em cima do save inflado
    const plano = poolLoads(gordo, { issue, weapons: arms });
    const magro = path.join(tmp, 'magro.bts');
    const r = resupplyMen(gordo, magro, plano, { fracao: 1, exato: true });
    const depois = totais(magro);
    const fora = plano.resumo.filter((u) => Math.abs((depois.get(`${u.coreId}:${u.item}`) || 0) - u.alvo) > 6);
    ok(plano.resumo.length > 0 && !fora.length,
      `${plano.resumo.length} paiois de unidade postos na dotacao (${plano.resumo.filter((u) => u.para < u.de).length} para baixo, ${plano.resumo.filter((u) => u.para > u.de).length} para cima)${fora.length ? ' — fora do alvo: ' + fora.slice(0, 3).map((u) => `core ${u.coreId} item ${u.item}: ${depois.get(`${u.coreId}:${u.item}`)} contra ${u.alvo}`).join(', ') : ''}`);
    const maior = plano.resumo.filter((u) => u.para < u.de).sort((a, b) => (b.de - b.para) - (a.de - a.para))[0];
    ok(cresceu > 0 && !!maior, `o refil antigo engordava ${cresceu} paiois; o pior volta de ${maior?.de} para ${maior?.para} (core ${maior?.coreId}, item ${maior?.item})`);
    ok(fs.statSync(magro).size > 0 && readRoster(magro).soldados.every((s, i) => s.estado === readRoster(gordo).soldados[i].estado) && r.homens > 0,
      `so quantidade foi escrita: ${r.homens} homens, nenhum estado mexido`);
    // 3. e parar: a segunda passada nao acha o que fazer
    const denovo = poolLoads(magro, { issue, weapons: arms });
    ok(Object.keys(denovo).length === 0, `rodar de novo nao muda nada (${Object.keys(denovo).length} homens na segunda passada) — o total nao sobe de batalha em batalha`);
    // 4. sem `trim` ninguem perde municao
    const semCorte = poolLoads(gordo, { issue, weapons: arms, trim: false });
    ok(semCorte.resumo.every((u) => u.para >= u.de), 'com `trimToIssue: false` o refil so sobe, nunca tira');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 48. NADA DO CAMPO DE BATALHA ATRAVESSA PARA O MAPA SEGUINTE (E78). Regra do autor: "nao devemos
//     carregar munição e armas obtidas da batalha de um mapa para outro. Devemos voltar todas as
//     unidades para a munição e armamento default." A municao ja volta (teste 47); aqui a ARMA e a
//     GRANADA. O teste da arma nao e "difere do vencedor da vaga" — a mao 2 varia de esquadrao para
//     esquadrao (RPG-22 numa, RPG-26 na outra) e a ordem das maos nao e fixa: e "esta arma ja foi
//     vista NESTA vaga nos saves que o jogo escreveu?".
{
  const fix = path.join(import.meta.dirname, '..', 'research', 'exemplos', 'e60_bit20.bts');
  const tabela = toeTable();
  if (fs.existsSync(fix) && tabela) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-e78-'));
    const r0 = readRoster(fix), c0 = readRosterTails(fix);

    // A. o save limpo nao tem arma juntada: a regra nao pode inventar trabalho
    ok(Object.keys(offIssueWeapons(fix, tabela)).length === 0,
      'num save que o jogo escreveu nenhuma arma e "juntada no campo" — a regra so age quando ha o que desfazer');

    // B. planto uma arma que a vaga daquele homem NUNCA viu, e ela tem de voltar
    let alvo = null;
    for (const u of r0.unidades) {
      u.soldados.forEach((s, vaga) => {
        if (alvo || s.estado > 1) return;
        const linha = tabela[u.tipo]?.[vaga];
        const c = c0[s.indice]?.cauda;
        if (!linha?.mao1 || !c || c[1] === 8 || c[1] === 0) return;
        const legitima = Object.entries(linha.mao1).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0];
        if (!legitima) return;
        alvo = { indice: s.indice, nome: s.nome, coreId: u.coreId, vaga, era: `${c[1]}/${c[2]}`, volta: legitima[0] };
      });
      if (alvo) break;
    }
    if (alvo) {
      const sujo = path.join(tmp, 'catada.bts');
      rearmMen(fix, sujo, { [alvo.indice]: { classe: 2, item: 199 } });   // 2/199 nao existe em vaga nenhuma
      const acha = offIssueWeapons(sujo, tabela);
      const dele = acha[alvo.indice];
      ok(!!dele && `${dele.classe}/${dele.item}` === alvo.volta,
        `a arma que a vaga nunca viu volta para a dotacao: ${alvo.nome} 2/199 -> ${dele ? `${dele.classe}/${dele.item}` : 'nada'} (esperado ${alvo.volta})`);

      // C. mas a arma que o jogador COMPROU nao volta — senao ele paga uma vez e perde na virada
      const comComprada = offIssueWeapons(sujo, tabela, { keep: { [alvo.coreId]: { [alvo.vaga]: '2/199' } } });
      ok(!comComprada[alvo.indice], 'a arma comprada no quartel-mestre sobrevive ao reset (state.gear por coreId/vaga)');

      // D. e o escritor devolve mesmo, no arquivo gravado
      const limpo = path.join(tmp, 'limpa.bts');
      const w = rearmMen(sujo, limpo, acha);
      const depois = readRosterTails(limpo)[alvo.indice]?.cauda;
      ok(w.homens > 0 && `${depois[1]}/${depois[2]}` === alvo.volta,
        `e o arquivo gravado confirma: ${alvo.nome} entra com ${depois[1]}/${depois[2]}`);
    }

    // E. A GRANADA ACIMA DA DOTACAO VOLTA A ELA — e o escritor, que so sabia acrescentar, encolhe.
    const g = grenadeTable();
    if (g) {
      const acima = [];
      for (const u of r0.unidades) u.soldados.forEach((s, vaga) => {
        const d = c0[s.indice]; if (!d?.ok) return;
        const tem = readGrenades(d)?.porTipo || {};
        const quer = g.tabela?.[u.tipo]?.[vaga];
        if (!quer) return;
        for (const [k, q] of Object.entries(tem)) if (Number.isInteger(quer[k]) && q > quer[k]) acima.push({ indice: s.indice, nome: s.nome, tipo: k, tem: q, quer: quer[k] });
      });
      // Ninguem acima da dotacao neste arquivo, entao o excesso e PLANTADO pelo caminho de insercao
      // (E67) — tres granadas a mais no bolso de quem ja tem lista — e o aparo tem de desfazer
      // exatamente isso. Sem plantar, o encolhimento do escritor nunca seria exercitado aqui.
      const gordo = path.join(tmp, 'gordo.bts');
      const vitima = [];
      for (const u of r0.unidades) u.soldados.forEach((s, vaga) => {
        if (vitima.length >= 3) return;
        const d = c0[s.indice]; if (!d?.ok || !readGrenades(d)?.listas?.length) return;
        const quer = g.tabela?.[u.tipo]?.[vaga];
        const tipo = quer && Object.keys(quer)[0];
        if (!tipo) return;
        const tem = readGrenades(d).porTipo[tipo] || 0;
        vitima.push({ indice: s.indice, nome: s.nome, tipo, quer: quer[tipo], plantado: tem + 3 });
      });
      if (vitima.length) {
        const w1 = restoreGrenades(fix, gordo, Object.fromEntries(vitima.map((v) => [v.indice, { [v.tipo]: v.plantado }])));
        const cheio = readRosterTails(gordo);
        ok(w1.granadas > 0 && vitima.every((v) => (readGrenades(cheio[v.indice])?.porTipo || {})[v.tipo] === v.plantado),
          `${w1.granadas} granadas plantadas acima da dotacao em ${vitima.length} homens (o que uma batalha faz)`);

        const plano = missingGrenades(gordo, g, { aparar: true });
        const semAparo = missingGrenades(gordo, g);
        ok(vitima.every((v) => plano[v.indice]?.[v.tipo] === v.quer) && vitima.every((v) => semAparo[v.indice]?.[v.tipo] === undefined),
          `o aparo traz os tres de volta a dotacao (${vitima.map((v) => `${v.plantado}->${v.quer}`).join(', ')}); sem aparar, nenhum deles aparece`);

        const saida = path.join(tmp, 'granada.bts');
        const w = restoreGrenades(gordo, saida, plano);
        const novo = readRosterTails(saida);
        const erradas = vitima.filter((v) => (readGrenades(novo[v.indice])?.porTipo || {})[v.tipo] !== v.quer);
        // O que tem de sair e o que cada um esta ACIMA da dotacao, e nao as nove plantadas: quem ja
        // estava abaixo dela continua abaixo depois de receber tres.
        // As tres plantadas tem de sair; o aparo tira mais que isso porque olha o esquadrao inteiro,
        // e desde a E81 ele enxerga a segunda lista de granadas que o leitor perdia.
        const devemSair = vitima.reduce((a, v) => a + (v.plantado - v.quer), 0);
        ok(w.tirou >= devemSair && !erradas.length,
          `${w.tirou} granadas tiradas (${devemSair} delas as plantadas acima da dotacao); ninguem ficou fora dela${erradas.length ? ` (${erradas[0].nome})` : ''}`);
        const legiveis = (l) => l.filter((x) => x.ok).length;
        ok(legiveis(novo) >= legiveis(c0) && readRoster(saida).soldados.length === r0.soldados.length,
          `e a cauda continua legivel depois de ENCOLHER: ${legiveis(novo)} de ${novo.length} legiveis (antes ${legiveis(c0)})`);
      }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 49. A DOTACAO TEM DE VIR DE UM SAVE QUE O APP NUNCA TOCOU (E80). O 3rd Squad do autor entrou na
//     batalha 6 sem Fast, Quick e Assault. A municao estava certa no TOTAL (2298 contra 2020 de
//     fabrica), mas a reparticao nao: um homem com DEZ granadas onde a fabrica da duas — e no jogo o
//     peso e por SOLDADO. A causa e a fonte: `toe_armas` mede o MAIOR por vaga e `toe_granadas` o
//     p90, as duas somando maximos de saves diferentes, e os saves de onde elas saem ja descendem do
//     proprio refit. `dotacao.json` mede a MODA em saves limpos e reproduz a fabrica.
{
  const fabrica = factoryIssue();
  ok(!!fabrica && Object.keys(fabrica).length >= 20,
    `a dotacao de fabrica conhece ${fabrica ? Object.keys(fabrica).length : 0} tipos`);
  if (fabrica) {
    // o esquadrao de fuzileiros ucraniano, que e o caso do autor
    const ukr = fabrica['9221'];
    if (ukr) {
      const soma = (campo) => Object.values(ukr).reduce((a, l) => a + Object.values(l[campo] || {}).reduce((x, y) => x + y, 0), 0);
      const balas = Object.values(ukr).reduce((a, l) => a + (l.municao?.[1] || 0), 0);
      ok(balas === 2020 && soma('granadas') === 15,
        `o tipo 9221 sai como a fabrica o entrega: ${balas} tiros de 5.45 e ${soma('granadas')} granadas (era 2298 e 17)`);
      const maior = Math.max(...Object.values(ukr).map((l) => Object.values(l.granadas || {}).reduce((x, y) => x + y, 0)));
      ok(maior <= 3, `e nenhum homem carrega mais que ${maior} granadas (o entregue tinha um com 10)`);
    }
    // a fusao: a de fabrica por cima, a antiga onde ela nao alcanca
    const fundida = issueFor(fabrica, toeTable());
    const daFabrica = Object.keys(fabrica).filter((t) => fundida[t]);
    ok(daFabrica.length === Object.keys(fabrica).length
      && JSON.stringify(fundida['9221']?.[0]?.municao) === JSON.stringify(fabrica['9221']?.[0]?.municao),
      'a dotacao de fabrica ganha da colheita antiga onde as duas falam');
    const soNaAntiga = Object.keys(toeTable() || {}).filter((t) => !fabrica[t]);
    ok(soNaAntiga.every((t) => fundida[t]), `e os ${soNaAntiga.length} tipos que so a antiga conhece continuam la`);

    // O TETO DA GRANADA NAO PODE IMPEDIR A REPOSICAO. Com alvo exato a soma das vagas ja e o teto;
    // o antigo (p90) fazia o esquadrao que voltou cheio nao receber nada e so ser aparado.
    const g = grenadesFor(fabrica, grenadeTable());
    const homens = [0, 1, 2, 3, 4, 5].map((vaga) => ({ indice: vaga, vaga, atual: { '1,2': 9 } }));
    const plano = grenadePlan(g, 9221, homens, { aparar: true });
    const alvo = Object.values(plano).reduce((a, x) => a + Object.values(x).reduce((p, q) => p + q, 0), 0);
    ok(Object.keys(plano).length === 6 && alvo <= 15,
      `um esquadrao que volta com 54 granadas e aparado para ${alvo}, vaga por vaga, sem o teto atrapalhar`);
  }
}

// 50. A RUA E FEITA DE PECAS (E86, FORMATO 120). O motor nao liga um tile de estrada ao vizinho: cada
//     tile guarda uma peca (reta, curva, meia-diagonal, T, cruz) e a rotacao dela no byte 3. O Mucuge
//     gravava "reta, rotacao 0" em tudo e toda rua virou tracinho norte-sul. A tabela abaixo e a que a
//     Draw Tool do editor gravou nos mapas de laboratorio H2 e H4.
{
  const { montarRuas } = await import(new URL('../tools/re/mapa_escrever.mjs', import.meta.url).href);
  const W = 12, H = 12, P1 = 19;
  const grade = new Uint8Array(W * H);
  const pinta = (pts) => pts.forEach(([x, y]) => { grade[y * W + x] = P1; });
  // L: leste-oeste (1..5, 1) e norte-sul (5, 1..5) -> canto em (5,1) ligando W e N
  pinta([[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [5, 2], [5, 3], [5, 4], [5, 5]]);
  // cruz em (9,8) e um T em (9,4): vertical (9, 3..10) e horizontais (7..11, 8) e (9..11, 4)
  pinta([[9, 3], [9, 4], [9, 5], [9, 6], [9, 7], [9, 8], [9, 9], [9, 10], [7, 8], [8, 8], [10, 8], [11, 8], [10, 4], [11, 4]]);
  // diagonal NE de 45 graus como escada 4-conexa: (1,7) (1,8)(2,8) (2,9)(3,9) (3,10)
  pinta([[1, 7], [1, 8], [2, 8], [2, 9], [3, 9], [3, 10]]);
  const r = montarRuas(W, H, grade);
  const peca = (x, y) => [r.byte[y * W + x] - P1, r.rot[y * W + x]];
  const igual = (a, b) => a[0] === b[0] && a[1] === b[1];
  ok(igual(peca(3, 1), [0, 1]) && igual(peca(5, 3), [0, 0]),
    `reta leste-oeste e rotacao 1, norte-sul e rotacao 0 (sairam ${peca(3, 1)} e ${peca(5, 3)})`);
  ok(igual(peca(5, 1), [3, 2]), `o canto de um L (W+N) e curva com rotacao 2, como no editor (saiu ${peca(5, 1)})`);
  ok(igual(peca(9, 4), [5, 0]) && igual(peca(9, 8), [8, 0]),
    `T (N+E+S) e forma 5 rotacao 0; cruzamento e forma 8 (sairam ${peca(9, 4)} e ${peca(9, 8)})`);
  ok(igual(peca(1, 8), [1, 0]) && igual(peca(2, 8), [1, 2]) && igual(peca(2, 9), [1, 0]),
    `a escada diagonal vira meias-diagonais rot 0 / rot 2, nao curvas (sairam ${peca(1, 8)} ${peca(2, 8)} ${peca(2, 9)})`);
}

// 51. O NOME DO OBJETIVO TEM DE CABER NO DA BASE (E86). Os objetivos de uma cidade escrita por codigo
//     sao trocados NO LUGAR, entao o nome novo nao pode passar do da base ("East Factory (Min VP)", 21).
//     Lencois quebrou com "Senhor dos Pas(Min VP)" de 22 — e o corte no meio da palavra era feio.
{
  const { nomeObjetivo } = await import(new URL('../tools/re/mucuge.mjs', import.meta.url).href);
  const casos = [['Mucuge', 'Maj', 18, 'Mucuge (Maj VP)'], ['Santo Antonio', 'Min', 21, 'Santo Antonio(Min VP)'],
    ['Senhor dos Passos', 'Min', 21, 'Passos (Min VP)'], ['Cemitério', 'Min', 19, 'Cemiterio (Min VP)']];
  const saiu = casos.map(([n, vp, max]) => nomeObjetivo(n, vp, max));
  ok(casos.every(([, , max, esperado], i) => saiu[i] === esperado && saiu[i].length <= max),
    `o nome do objetivo cabe e continua legivel: ${saiu.join(' | ')}`);
}

// 52. OS TRIGGERS DA IA (E87, FORMATO 123). Um grupo pode esperar (a) uma ordem de outro grupo
//     comecar, (b) uma unidade tocar um objetivo-trigger. O Podlypyky — base do Mucuge — segura tres
//     reservas azuis no setup ate o atacante tocar "farms", "Podlypyky" e "Factory": o contra-ataque
//     do mapa, que o Mucuge herdava apontado para a geografia errada.
{
  const { lerGatilhos } = await import(new URL('../tools/re/gatilhos.mjs', import.meta.url).href);
  const { fileURLToPath } = await import('node:url');
  // o Podlypyky ORIGINAL dos desenvolvedores (12/10: o do pacote ganhou o plano revisado pelo autor e nao tem mais
  // esses triggers; o original ficou como gabarito em research/mapas_teste)
  const pasta = new URL('../research/mapas_teste/', import.meta.url);
  const pod = lerGatilhos(fileURLToPath(new URL('Podlypyky-Rough (1936 X 1808) 088 Assault ORIGINAL.btt', pasta)));
  // tipo 7 = "A.I. Trigger (enemy)", known 3 = "Known to Neither" (medidos no editor, E88)
  const trig = pod.objetivos.azul.filter((o) => o.tipo >= 5 && o.tipo <= 8).map((o) => `${o.nome}/${o.tipo}/${o.known}`);
  const plano = pod.planos.find((p) => p.lado === 'azul' && p.plano === 1);
  const esperas = plano.grupos.flatMap((g) => g.entradas.filter((e) => e.espera).map((e) => `G${g.grupo}:${e.espera.tipo}:${pod.objetivos.azul[e.espera.i]?.nome}`));
  ok(trig.join() === 'farms/7/3,Podlypyky/7/3,Factory/7/3' && esperas.join() === 'G4:1:farms,G5:1:Podlypyky,G6:1:Factory',
    `Podlypyky: triggers ${trig.join(' ')}; esperas ${esperas.join(' ')}`);
  const demo = lerGatilhos(fileURLToPath(new URL('../research/mapas_teste/CMBS Demo (Map 1568 X 1568) Assault.btt', import.meta.url)));
  const d1 = demo.planos.find((p) => p.lado === 'azul' && p.plano === 1);
  const g4 = d1.grupos.find((g) => g.grupo === 4).entradas[0], g3o2 = d1.grupos.find((g) => g.grupo === 3).entradas[1];
  ok(g4.espera && g4.espera.tipo === 0 && g4.espera.i === 2 && g4.espera.j === 1 && g3o2.podeDisparar,
    'e a espera por ORDEM: o Setup do G4 espera a Order 2 do G3, que e a marcada "Can Trigger" (grupo base 0, entrada 1)');
}

// 53. O ESTADO DE CADA MAQUINA ESTA NO SAVE DA TRANSICAO (E90, FORMATO 110.11). O "Vehicle Status" do
//     editor — 1 destruido, 2 imobilizado, 3 ok — no bloco de cada maquina que ja lutou. A prova e o
//     AAR acumulado do proprio jogo: as maquinas que viraram 1 em cada batalha somam o que o AAR somou.
//     Saves do autor; onde nao existirem, o teste se cala.
{
  const { estadosDoSave, mudancas } = await import(new URL('../tools/re/veiculo_estado.mjs', import.meta.url).href);
  const { vehiclesFromSave } = await import('./src/campaign.mjs');
  const SV = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/';
  const CADEIAS = [
    ['E2 BTT1 TRANSITION', 'E2 BTT2 TRANSITION', 'E2 BTT3 TRANSITION', 'E2 BTT4 TRANSITION', 'E2 BTT 5 TRANSITION', 'E2 BTT 6 TRANSITION', 'E2 BTT 7 TRANSITION'],
    ['EBD BTT1 TRANSITION', 'EBD BTT2 TRANSITION', 'EBD BTT3 TRANSITION'],
    ['MVSC - TRANSITION 1', 'MVSC - TRANSITION BTT2'],
    ['ONT - TRANSITION'],
  ].map((c) => c.map((n) => `${SV}${n}.bts`)).filter((c) => c.every((f) => fs.existsSync(f)));
  if (CADEIAS.length) {
    const perdas = (aar) => aar.tanques + aar.blindados + aar.outrosVeiculos;
    const difs = [];
    for (const cadeia of CADEIAS) {
      let antes = [], aarAntes = 0;
      for (const f of cadeia) {
        const agora = estadosDoSave(f);
        const ros = readRoster(f); const aar = ros.playerForce === 'red' ? ros.aar.vermelho : ros.aar.azul;
        const d = mudancas(antes, agora).destruidos.length - (perdas(aar) - aarAntes);
        if (d) difs.push(`${path.basename(f)} ${d > 0 ? '+' : ''}${d}`);
        antes = agora; aarAntes = perdas(aar);
      }
    }
    // A unica diferenca conhecida: o T-64BV #1 da EASY2 lutou na batalha 3 (o paiol caiu), acabou
    // destruido com a tripulacao viva e o AAR nao o contou — abandonado, provavelmente.
    ok(difs.join() === 'E2 BTT3 TRANSITION.bts +1',
      `o campo conta as mesmas perdas que o AAR em ${CADEIAS.reduce((a, c) => a + c.length, 0)} viradas de ${CADEIAS.length} campanhas (diferencas: ${difs.join(', ') || 'nenhuma'})`);
  }
  // E91: o imobilizado (Vehicle Status 2) volta pelo jogo — o BTR-4E 52 da EBD entrou na batalha 3
  // com mobilidade 1,0 e andou —, entao o app nao gasta mais um gemeo dormente com ele.
  ok(rules().replacement.swapImmobilized === false && rules().replacement.vehicle.immobilized === 0,
    'imobilizado volta de graca pelo proprio jogo: a troca por gemeo (E62) esta desligada');
  const [b6, b7] = ['E2 BTT 6 TRANSITION', 'E2 BTT 7 TRANSITION'].map((n) => `${SV}${n}.bts`);
  if (fs.existsSync(b6) && fs.existsSync(b7)) {
    const m = mudancas(estadosDoSave(b6), estadosDoSave(b7));
    ok(m.destruidos.join() === '514' && m.imobilizados.join() === '563',
      `batalha 7 da EASY2: destruido o HMMWV 514 e imobilizado o Bradley 563 (lido: destruidos [${m.destruidos}], imobilizados [${m.imobilizados}])`);
    // O que o app marca sozinho, num estado de mentira (o da EASY2 muda quando o autor aplica): so
    // maquina em campo; o destroco ja baixado fica como esta; e desde 22/10 (todo veiculo e maquina) o HMMWV com
    // metralhadora tambem e marcado, e se repoe como os outros.
    const U = (coreId, role, name) => ({ coreId, role, name, present: true });
    const st = { lost: [81], units: [
      U(563, 'ifv', 'Infantry Fighting Vehicle (M2A3 Bradley (ERA)) #6'), U(568, 'tank', 'Main Battle Tank (M1A2 SEP Abrams) #2'),
      U(567, 'tank', 'Main Battle Tank (M1A2 SEP Abrams) #1'), U(81, 'tank', 'Main Battle Tank (T-64BV) #1'),
      U(514, 'mg', 'Reconnaissance Vehicle (M1151 HMMWV (M2))'), { ...U(569, 'tank', 'Main Battle Tank (M1A2 SEP Abrams (APS))'), present: false },
    ] };
    const v = vehiclesFromSave(st, b7, { offMap: new Set() });
    ok(JSON.stringify(v.marks) === JSON.stringify({ 514: 'destroyed', 563: 'immobilized', 567: 'survived', 568: 'destroyed' })
      && !v.notListed.length,
      `e o app pre-marca: ${JSON.stringify(v.marks)}; fora da lista: ${v.notListed.map((x) => `${x.name} ${x.status}`).join(', ')}`);
  }
}

// 54. O POTENCIAL DE CADA LADO (E92, FORMATO 123.2). Medido com cessar-fogo em duas batalhas do app:
//     cada lado tem a SUA lista e objetivo sem tile nao conta. No Tiny Going to Town o azul tem o
//     Overpass (200) e quatro objetivos vazios (500); o AAR deu "Russian Army Total Defeat" com 200 x 0,
//     que so e Total se o potencial for 200. No City-Water os nomes tem erro de digitacao diferente em
//     cada lista ("Suburb Min VP)" / "Suburb (Min VP)") e a uniao por nome contava 1050 em vez de 600.
{
  const { pontosDisponiveis } = await import(new URL('../tools/re/objetivos.mjs', import.meta.url).href);
  const { fileURLToPath } = await import('node:url');
  const pasta = new URL('../assets/qb_attack/', import.meta.url);
  const arq = (n) => fileURLToPath(new URL(n, pasta));
  const amostra = (n) => fileURLToPath(new URL('../research/mapas_teste/' + n, import.meta.url));   // fora do pacote desde 04/10
  const tiny = pontosDisponiveis(amostra('Tiny Going to Town (320 X 400) Assault.btt'));
  const tinyAzul = pontosDisponiveis(amostra('Tiny Going to Town (320 X 400) Assault.btt'), 'azul');
  const city = pontosDisponiveis(arq('City-Water (560 X 1072) 081r Attack CMBSRL.btt'));
  const forest = pontosDisponiveis(arq('Town-Forest (720 X 1024) 040r Attack CMBSRL.btt'));
  ok(tiny.total === 200 && tinyAzul.total === 200 && city.total === 600 && forest.total === 750,
    `potencial do vermelho: Tiny ${tiny.total} (azul ${tinyAzul.total}, os 500 vazios fora), City-Water ${city.total}, Town-Forest 040r ${forest.total} (os 1400 "Known to Player" sem tile fora)`);
  const v = levelFromPoints(0, 200, rules(), tiny.total, tinyAzul.total);
  ok(v.level === 'Total Defeat', `e o cessar-fogo do Tiny sai como o jogo disse: ${v.level}`);
}

// 55. OS BLOCOS DE EQUIPAMENTO DO EDITOR (E95, FORMATO 43.2). A escolha de veiculo/arma de uma
//     formacao e uma lista no fim do registro da unidade, um u16 por nivel; o GRUPO e a primeira
//     entrada e e o que o editor oferece junto. A arvore da biblioteca diz o grupo de cada unidade e
//     o menu diz as opcoes do grupo naquele exercito, com preco sem veterania e as bandeiras.
{
  const { equipmentMenu, rosterTemplates: moldes } = await import('./src/catalog.mjs');
  const B = await import(new URL('../tools/re/blocos.mjs', import.meta.url).href);
  const folhasDe = (tree) => { const out = []; const w = (n) => { if (n.isFormation) n.children.forEach(w); else out.push(n); }; tree.roots.forEach(w); return out; };
  const t31 = formationTree('RU - Battalion (Tank 31).btt');
  const tanques = folhasDe(t31);
  ok(t31.roots[0].id === 1 && tanques.length === 31 && tanques.every((n) => n.group === 624 && n.levels === 3),
    `Tank 31: raiz id ${t31.roots[0].id}, ${tanques.length} tanques todos no grupo 624 com 3 niveis`);
  const m31 = equipmentMenu(t31, 'RU');
  const g624 = m31.groups[624];
  // (18/10: o preco vem da planilha do autor, que mudou; era fixo em 1100)
  const planilhaT90A = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'research', 'precos_unidades.json'), 'utf8')).precos['RU|Main Battle Tank (T-90A)'];
  ok(g624 && g624.options.length === 5 && g624.options.every((o) => o.roster && o.priced) && g624.options.find((o) => o.name === 'Main Battle Tank (T-90A)')?.base === planilhaT90A,
    `o grupo 624 (${g624?.label}) oferece ${g624?.options.length} opcoes, todas com molde de roster e preco (T-90A a ${g624?.options.find((o) => o.name.includes('T-90A)'))?.base} cr)`);
  const bmp = formationTree('RU - Battalion (Motor Rifle [BMP]).btt');
  const g615 = equipmentMenu(bmp, 'RU').groups[615];
  const bmp3 = g615?.options.find((o) => o.name === 'Infantry Fighting Vehicle (BMP-3)'), bmp2m = g615?.options.find((o) => o.name === 'Infantry Fighting Vehicle (BMP-2M)');
  ok(bmp3 && bmp2m && bmp3.levels === 3 && bmp2m.levels === 2 && folhasDe(bmp).find((n) => /Ural/.test(n.name)).group === null,
    `o BMP-3 tem 3 niveis e o BMP-2M 2 (a troca cresce 2 B); o Ural nao tem grupo`);
  const tf = formationTree('US - Battalion (Infantry [Task Force]).btt');
  const g639 = equipmentMenu(tf, 'US').groups[639];
  ok(g639 && g639.options.some((o) => o.path.length === 1) && g639.options.some((o) => o.path.length === 2),
    `os snipers americanos (grupo 639) misturam 1 e 2 niveis: ${g639?.options.map((o) => `${o.name} [${o.path.join('/')}]`).join(', ')}`);
  // toda opcao da tabela que a biblioteca pode montar precisa de molde de roster, senao o jogo cai
  const semMolde = [];
  for (const [ex, E] of Object.entries(B.tabela().exercitos)) for (const G of Object.values(E.grupos)) for (const o of Object.values(G.opcoes)) if (!moldes().has(`${o.val},${o.tab}`)) semMolde.push(`${ex} ${o.nome}`);
  ok(semMolde.length <= 4, `opcoes sem molde de roster (a tela as mostra fechadas): ${semMolde.join('; ') || 'nenhuma'}`);
  // e o canhao da bateria off-map, que e outro arquivo (FORMATO 124): as variantes `[RU C3 nn]`
  const { gunTwins } = await import('./src/catalog.mjs');
  const canhoes = gunTwins(['RU', 'UKR']);
  const bat = canhoes['RU|Battery (Self-Propelled Howitzer [heavy])'];
  ok(Object.keys(canhoes).length === 4 && bat && bat.options.length === 6 && bat.options.some((o) => /2S19\)/.test(o.gun)) && bat.options.some((o) => /2S7M/.test(o.gun))
    && bat.options.every((o) => fs.existsSync(path.join(paths().lib, o.file))) && !Object.values(canhoes).some((g) => g.options.some((o) => /Stryker/.test(o.gun))),
    `${Object.keys(canhoes).length} baterias com escolha de canhao; a russa oferece ${bat?.options.map((o) => o.gun.replace(/^\d+ x /, '')).join(', ')} — e a variante com nome de canhao errado no catalogo fica fora`);
}

// 56. TROCAR DE MESMO TAMANHO = O `equipamento.trocar` DE 41, byte a byte (E95). O caminho novo
//     escreve no buffer expandido e remonta como `marcarCore`; o antigo escrevia no cru. Numa
//     companhia (o antigo nao le o ultimo registro do arquivo) os dois tem de dar o mesmo CRU.
{
  const B = await import(new URL('../tools/re/blocos.mjs', import.meta.url).href);
  const E = await import(new URL('../tools/re/equipamento.mjs', import.meta.url).href);
  const T = await import(new URL('../tools/re/transplante.mjs', import.meta.url).href);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-e95-'));
  const src = path.join(tmp, 't31.btt'); fs.copyFileSync(path.join(paths().lib, 'RU - Battalion (Tank 31).btt'), src);
  const F = B.lerBlocos(src);
  const cia = [...F.formacoes.values()].find((f) => f.nivel === 1 && f.grupos['624']);
  const novo = path.join(tmp, 'cia_blocos.btt');
  const r = B.trocar(src, novo, [{ idFormacao: cia.id, grupo: 624, para: '0x05,0x36' }]);
  let velho = src;
  for (const o of cia.grupos['624']) { const out = path.join(tmp, `cia_eq_${o.tipo.replace(/\W/g, '')}.btt`); E.trocar(velho, out, cia.id, o.tipo, '0x05,0x36'); velho = out; }
  ok(r.trocados === cia.grupos['624'].reduce((a, o) => a + o.n, 0) && r.bytes === 0 && T.ler(novo).cru.equals(T.ler(velho).cru),
    `${cia.nome}: ${r.trocados} tanques -> T-90A, 0 bytes de diferenca e o CRU igual ao de equipamento.trocar`);
  const todo = B.trocar(src, path.join(tmp, 't31_todo.btt'), [{ idFormacao: 1, grupo: 624, para: '0x05,0x36' }]);
  const W = B.lerBlocos(path.join(tmp, 't31_todo.btt'));
  ok(todo.trocados === 31 && todo.verificacao.erros.length === 0 && W.registros.filter((x) => x.tipo === '0x05,0x36' && x.lista.join('/') === '624/625/744' && x.raridade === 7).length === 31,
    'e o batalhao inteiro (o ultimo registro do arquivo e um tanque): 31 T-90A relidos com a lista 624/625/744 e raridade 7');
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 57. REDIMENSIONAR = REESCREVER A LISTA (E95, FORMATO 44.2). O que matava o jogo em 44 era gravar um
//     tipo de lista mais longa num registro curto. Agora o registro cresce ou encolhe com a lista, e
//     o gabarito e o proprio editor: o `[RU C6 02]` da biblioteca e o batalhao BMP com BMP-3.
{
  const B = await import(new URL('../tools/re/blocos.mjs', import.meta.url).href);
  const { openBtt } = await import('./src/re.mjs');
  const iguais = (a, b) => openBtt(a).completo.equals(openBtt(b).completo);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-e95b-'));
  const src = path.join(tmp, 'bmp.btt'); fs.copyFileSync(path.join(paths().lib, 'RU - Battalion (Motor Rifle [BMP]).btt'), src);
  const ida = path.join(tmp, 'bmp3.btt'), volta = path.join(tmp, 'bmp2m.btt');
  const r1 = B.trocar(src, ida, [{ idFormacao: 1, grupo: 615, para: '0x05,0x3c' }]);
  const V = B.lerBlocos(ida), O = B.lerBlocos(src), Ed = B.lerBlocos(path.join(paths().lib, 'RU - Battalion (Motor Rifle [BMP]) [RU C6 02].btt'));
  const b3 = V.registros.filter((x) => x.tipo === '0x05,0x3c'), e3 = Ed.registros.filter((x) => x.tipo === '0x05,0x3c');
  ok(r1.trocados === 33 && r1.bytes === 66 && b3.length === 33 && b3.every((x) => x.lista.join('/') === e3[0].lista.join('/') && x.tam === e3[0].tam && x.raridade === e3[0].raridade),
    `BMP-2M -> BMP-3: 33 registros, +66 bytes, cada um com a lista ${e3[0].lista.join('/')}, ${e3[0].tam} B e raridade ${e3[0].raridade} do arquivo que o editor gravou`);
  let intactos = 0;
  O.registros.forEach((ro, k) => { const rv = V.registros[k]; if (ro.tipo === '0x05,0x3f' || ro.fim == null) return; if (O.X.completo.subarray(O.X.R[k].c, ro.fim).equals(V.X.completo.subarray(V.X.R[k].c, rv.fim))) intactos++; });
  const r2 = B.trocar(ida, volta, [{ idFormacao: 1, grupo: 615, para: '0x05,0x3f' }]);
  ok(intactos === O.registros.length - 33 - O.registros.filter((x) => x.fim == null).length && r2.bytes === -66 && iguais(volta, src),
    `os outros ${intactos} registros nao mudaram, e a volta BMP-3 -> BMP-2M restaura o original byte a byte`);
  // o sniper de 44: 48 B recebendo um tipo de 50 B, ida e volta na secao
  const tf = path.join(tmp, 'tf.btt'); fs.copyFileSync(path.join(paths().lib, 'US - Battalion (Infantry [Task Force]).btt'), tf);
  const sec = [...B.lerBlocos(tf).formacoes.values()].filter((f) => (f.grupos['639'] || []).some((o) => o.tipo === '0x0d,0x2a')).sort((a, b) => b.nivel - a.nivel)[0];
  const s1 = B.trocar(tf, path.join(tmp, 's1.btt'), [{ idFormacao: sec.id, grupo: 639, para: '0x0d,0xdd', de: '0x0d,0x2a' }]);
  const s2 = B.trocar(tf, path.join(tmp, 's2.btt'), [{ idFormacao: sec.id, grupo: 639, para: '0x0d,0xdb', de: '0x0d,0x2a' }]);
  B.trocar(path.join(tmp, 's2.btt'), path.join(tmp, 's3.btt'), [{ idFormacao: sec.id, grupo: 639, para: '0x0d,0x2a', de: '0x0d,0xdb' }]);
  ok(s1.trocados === 1 && s1.bytes === 2 && s1.verificacao.erros.length === 0 && s2.bytes === 2 && iguais(path.join(tmp, 's3.btt'), tf),
    `o M107A1 (48 B) vira Precision Sniper Rifle (50 B) em ${sec.nome}, +2 B, forca integra; e a ida e volta pelo Team (Sniper) restaura o original`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 58. A CONTA SEGUE O TIPO NOVO (E95). O preco e por nome, e a troca renomeia a unidade na copia da
//     arvore que o plano ve — entao o delta e a soma, tanque a tanque, do preco do tipo novo menos o
//     do velho, no nivel de cada um. Tipo fora do grupo ou no inexistente sao recusados com frase.
{
  const fonte = 'RU - Battalion (Tank 31).btt';
  const tree = formationTree(fonte);
  const chaves = []; const folhas = []; const w = (n) => { chaves.push(n.key); if (!n.isFormation) folhas.push(n); n.children.forEach(w); }; tree.roots.forEach(w);
  const base = { source: fonte, nation: 'RU', keep: chaves, xp: {} };
  const sem = priceOfPicks([base], 'RU', R)[0];
  const com = priceOfPicks([{ ...base, swaps: [{ key: '0', group: 624, to: [0x36, 5] }] }], 'RU', R)[0];
  const esperado = folhas.reduce((a, n) => a + priceUnits([{ name: 'Main Battle Tank (T-90A)', offMap: false, type: [0x36, 5], experience: n.experience }], 'RU', R).total - priceUnits([{ name: n.name, offMap: false, type: n.type, experience: n.experience }], 'RU', R).total, 0);
  ok(com.price - sem.price === esperado && com.swaps.length === 1 && com.swaps[0].name === 'Main Battle Tank (T-90A)' && com.uncovered.length === 0,
    `Tank 31 com T-90A custa ${com.price} contra ${sem.price}: +${com.price - sem.price} cr, a soma tanque a tanque`);
  const cia = priceOfPicks([{ ...base, swaps: [{ key: '0.1', group: 624, to: [0x36, 5] }] }], 'RU', R)[0];
  // no meio, para cima ou para baixo: a planilha decide se o T-90A custa mais ou menos que o tanque da fonte (18/10)
  ok(cia.price > Math.min(sem.price, com.price) && cia.price < Math.max(sem.price, com.price), `so uma companhia trocada fica no meio: ${cia.price} cr (de ${sem.price} a ${com.price})`);
  let recusas = 0;
  for (const swaps of [[{ key: '0', group: 624, to: [0x99, 5] }], [{ key: '9.9', group: 624, to: [0x36, 5] }], [{ key: '0', group: 615, to: [0x3c, 5] }]]) {
    try { priceOfPicks([{ ...base, swaps }], 'RU', R); } catch (e) { if (/equipment/.test(e.message)) recusas++; }
  }
  ok(recusas === 3, 'tipo fora do grupo, no inexistente e grupo de outra formacao: os tres recusados com frase');
  ok(formationTree(fonte).roots[0].children.some((n) => !n.isFormation && n.name === 'Main Battle Tank (T-72B3)'), 'e a arvore do cache continua com o T-72B3: a troca e feita numa copia');
}

// 59. A FORCA CUNHADA LEVA A ESCOLHA, e a RECONSTRUCAO tambem (E95). A troca e aplicada numa copia da
//     fonte da biblioteca antes do generateBattle; como ela vive no pick, o `growCoreForce` a refaz
//     igual e a checagem moved/lost fica quieta.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-e95c-'));
  const mapa = mapFile(mapPool(1, [], 0)[0]);
  const trace = { event() {}, read() {}, wrote() {}, async step(n, x, f) { return f(); } };
  const fonte = 'RU - Battalion (Tank 31).btt';
  const chaves = []; const w = (n) => { chaves.push(n.key); n.children.forEach(w); }; formationTree(fonte).roots.forEach(w);
  const p0 = priceOfPicks([{ source: fonte, nation: 'RU', keep: chaves, xp: {}, swaps: [{ key: '0', group: 624, to: [0x36, 5] }] }], 'RU', R)[0];
  const core0 = path.join(tmp, 'core.btt');
  await buildCoreForce({ picks: [p0], nation: 'RU', enemy: 'US', mapFile: mapa, workDir: tmp, out: core0, trace });
  const before = unitDirectory(core0);
  const t90 = before.filter((u) => u.name.startsWith('Main Battle Tank (T-90A)'));
  ok(t90.length === 31 && !before.some((u) => /T-72B3/.test(u.name)) && before.every((u, i) => i === 0 || u.coreId > before[i - 1].coreId),
    `a forca core tem 31 T-90A e nenhum T-72B3, ids crescentes (${before[0].coreId}..${before[before.length - 1].coreId})`);
  const sup = 'RU - Section (Supply).btt';
  const ch2 = []; const w2 = (n) => { ch2.push(n.key); n.children.forEach(w2); }; formationTree(sup).roots.forEach(w2);
  const p1 = priceOfPicks([{ source: sup, nation: 'RU', keep: ch2, xp: {} }], 'RU', R)[0];
  const grown = await growCoreForce({ picks: [p0], newPicks: [p1], nation: 'RU', enemy: 'US', mapFile: mapa, workDir: tmp, out: path.join(tmp, 'grown.btt'), before, present: before.filter((u) => u.present).map((u) => u.coreId), dropped: [], trace });
  ok(grown.added.length > 0 && grown.units.filter((u) => u.name.startsWith('Main Battle Tank (T-90A)')).length === 31,
    `recrutar depois refaz a mesma troca: ${grown.added.length} unidades novas, os 31 T-90A no lugar, nenhum id movido`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 60. O MORTEIRO E O OBUS ORGANICOS tambem sao lista (E97, FORMATO 41.1). O tubo do batalhao nao
//     tem posicao no mapa, e por isso ficava de fora: o registro dele carrega a mesma cauda de
//     niveis, e a tela do editor o oferece como mais um bloco. Dois cuidados novos: no grupo 603 o
//     mesmo TIPO e dois morteiros diferentes (so o caminho separa), e o catalogo de tipos erra o
//     nome de um deles — opcao sem nome nao se vende.
{
  const { equipmentMenu } = await import('./src/catalog.mjs');
  const { normalizeSwaps } = await import('./src/campaign.mjs');
  const B = await import(new URL('../tools/re/blocos.mjs', import.meta.url).href);
  const A = await import(new URL('../tools/re/anexar2.mjs', import.meta.url).href);
  const LIB = paths().lib;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-e97-'));
  const bmp = path.join(LIB, 'RU - Battalion (Motor Rifle [BMP]).btt');
  const arvore = formationTree('RU - Battalion (Motor Rifle [BMP]).btt');
  const folhas = []; const w = (n) => { if (n.isFormation) n.children.forEach(w); else folhas.push(n); }; arvore.roots.forEach(w);
  const tubos = folhas.filter((n) => n.group === 603);
  const g603 = equipmentMenu(arvore, 'RU').groups[603];
  const semNome = g603.options.filter((o) => o.named === false);   // nenhuma desde a E97 na tela
  ok(tubos.length === 2 && g603 && g603.label === 'Mortar' && g603.options.length === 3 && semNome.length === 0
    && g603.options.some((o) => o.name === '3 x 82mm Mortar (2S24)' && o.key === '0x00,0x3a@603/657')
    && g603.options.some((o) => o.name === '3 x 82mm Mortar (2B14)' && o.key === '0x00,0x3a@603/656'),
    `o batalhao BMP tem ${tubos.length} tubos no grupo 603 (${g603 && g603.label}) com ${g603 && g603.options.length} opcoes; ${semNome.length} sem nome no catalogo e a chave leva o caminho`);
  // a troca escreve o que o EDITOR gravou na variante [RU C2 02], que e o mesmo batalhao com 2B11
  const saida = path.join(tmp, 'mort.btt');
  const r = B.trocar(bmp, saida, [{ idFormacao: 1, grupo: 603, para: '0x00,0x1b' }]);
  const campo = (arq) => B.lerBlocos(arq).registros.filter((x) => x.n && x.lista[0] === 603).map((x) => `${x.tipo}|${x.lista.join('/')}|${x.tam}|${x.raridade}`).join(' ');
  ok(r.trocados === 2 && campo(saida) === campo(path.join(LIB, 'RU - Battalion (Motor Rifle [BMP]) [RU C2 02].btt')),
    `2B11 escrito como o editor escreveu: ${campo(saida)}`);
  // ida e volta com o caminho: sem ele o alvo seria ambiguo (0x00,0x3a e 603/656 E 603/657)
  const volta = path.join(tmp, 'volta.btt');
  B.trocar(saida, volta, [{ idFormacao: 1, grupo: 603, para: '0x00,0x3a', caminho: [603, 657] }]);
  const outro = path.join(tmp, 'outro.btt');
  B.trocar(saida, outro, [{ idFormacao: 1, grupo: 603, para: '0x00,0x3a', caminho: [603, 656] }]);
  const bytes = (x) => A.abrirCompleto(x).completo;
  ok(bytes(volta).equals(bytes(bmp)) && !bytes(outro).equals(bytes(bmp)),
    'a volta pelo caminho 603/657 devolve o original byte a byte, e o 603/656 da outro arquivo');
  // o obus organico: uma lista de UM nivel, entao as opcoes sao os tipos
  const tg = path.join(LIB, 'RU - Tactical Group (Battalion [BTR]).btt');
  const obus = path.join(tmp, 'obus.btt');
  const r4 = B.trocar(tg, obus, [{ idFormacao: 1, grupo: 718, para: '0x00,0x94' }]);
  const O = B.lerBlocos(tg), N = B.lerBlocos(obus);
  let intactos = 0; O.registros.forEach((ro, k) => { const rn = N.registros[k];
    if (ro.fim != null && rn.fim != null && O.X.completo.subarray(O.X.R[k].c, ro.fim).equals(N.X.completo.subarray(N.X.R[k].c, rn.fim))) intactos++; });
  ok(r4.trocados === 2 && intactos === O.registros.length - 2 && N.registros.filter((x) => x.n && x.lista[0] === 718).every((x) => x.nome === '3 x 122mm Howitzer (2S1)' && x.raridade === 7),
    `o obus do grupo 718 virou 2S1 122mm nos ${r4.trocados} registros e os outros ${intactos} ficaram intactos`);
  // e o servidor recusa a opcao que ele nao sabe nomear (nome errado = preco errado)
  const b656 = normalizeSwaps({ source: 'x', swaps: [{ key: '0', group: 603, to: [0x3a, 0], path: [603, 656] }] }, arvore, 'RU');
  const b657 = normalizeSwaps({ source: 'x', swaps: [{ key: '0', group: 603, to: [0x3a, 0], path: [603, 657] }] }, arvore, 'RU');
  ok(b656[0].name === '3 x 82mm Mortar (2B14)' && b657[0].name === '3 x 82mm Mortar (2S24)' && b657[0].path.join('/') === '603/657',
    'o mesmo tipo com dois caminhos vira duas escolhas diferentes, e o caminho viaja para a forja');
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 61. O PAINEL "DAMAGE" DO VEICULO ESTA NO SAVE (E98, FORMATO 101.2). Depois dos assentos vem um
//     item por subsistema: 6 B quando intacto, 10 B com um float de dano quando nao (1.0 = o X
//     vermelho). O gabarito sao dois prints do autor do mesmo save: o Abrams do Loy com NOVE itens
//     no maximo e o do Griffith com DOIS. Save do autor; sem ele, o teste se cala.
{
  const SV = await import(new URL('../tools/re/saves.mjs', import.meta.url).href);
  const A = await import(new URL('../tools/re/anexar2.mjs', import.meta.url).href);
  const save = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/E2 BTT 6 turn 018.bts';
  if (fs.existsSync(save)) {
    const c = A.abrirCompleto(save).completo;
    const L = SV.soldados(c); const E = SV.equipes(c, L); const V = SV.veiculos(c, L);
    const nome = (t) => (E.find((e) => e.id === t).homens[0] || {}).nome;
    const loy = V.find((v) => nome(v.time) === 'Loy'), griffith = V.find((v) => nome(v.time) === 'Griffith');
    ok(loy && griffith && loy.destruidos === 9 && griffith.destruidos === 2,
      `o painel DAMAGE bate com os prints: Loy ${loy && loy.destruidos} subsistemas no maximo de ${loy && loy.subsistemas.length}, Griffith ${griffith && griffith.destruidos} de ${griffith && griffith.subsistemas.length}`);
    // a contagem e do TIPO de veiculo, nao do estado: os Abrams tem 10 (11 com o Trophy APS, que
    // entra como ULTIMO item) e os Bradley 11
    const papel = (t) => (E.find((e) => e.id === t).homens[0] || {}).papel;
    const abrams = V.filter((v) => papel(v.time) === 5 && v.subsistemas);
    const brad = V.filter((v) => papel(v.time) === 4 && v.subsistemas);
    ok(abrams.length >= 4 && abrams.every((v) => v.subsistemas.length === 10 || v.subsistemas.length === 11)
      && brad.every((v) => v.subsistemas.length === 11),
      `${abrams.length} Abrams com 10/11 subsistemas e ${brad.length} Bradley com 11 — a lista e do tipo do veiculo`);
    // o dano so cresce dentro da batalha, e a batalha seguinte comeca limpa (a regra do refit)
    const antes = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/E2 BTT 6 turn 012.bts';
    const depois = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/E2 BTT 7 DEPLOY.bts';
    if (fs.existsSync(antes) && fs.existsSync(depois)) {
      const c12 = A.abrirCompleto(antes).completo;
      const v12 = SV.veiculos(c12).find((v) => v.time === loy.time);
      const cresceu = v12 && v12.subsistemas && v12.subsistemas.every((x, i) => x.dano <= loy.subsistemas[i].dano + 1e-6);
      const novo = SV.veiculos(A.abrirCompleto(depois).completo).filter((v) => v.subsistemas && v.subsistemas.length);
      ok(cresceu && novo.length && novo.every((v) => v.danificados === 0),
        `o dano so cresce (turno 12 -> 18 do mesmo Abrams) e a batalha seguinte abre com ${novo.length} veiculos sem dano nenhum`);
    }
  }
}

// 62. A LISTA DE SUBSISTEMAS FECHA SOZINHA (E99, FORMATO 101.2.2). Depois do ultimo item vem
//     `[u8 n]` e n entradas de 9 B comecando em 0x03 — e isso que diz onde a lista acaba. Sem o
//     terminador a leitura passava do fim em todo veiculo que termina em item intacto, que e o caso
//     de QUALQUER veiculo que ainda nao levou tiro. Com ele, um save de deployment ja da a contagem
//     por tipo. Saves do autor; sem eles, o teste se cala.
{
  const SV = await import(new URL('../tools/re/saves.mjs', import.meta.url).href);
  const A = await import(new URL('../tools/re/anexar2.mjs', import.meta.url).href);
  const SG = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/';
  const deploy = SG + 'E2 BTT 7 DEPLOY.bts';
  if (fs.existsSync(deploy)) {
    const c = A.abrirCompleto(deploy).completo;
    const L = SV.soldados(c); const E = SV.equipes(c, L); const V = SV.veiculos(c, L);
    const papel = (t) => (E.find((e) => e.id === t).homens[0] || {}).papel;
    const abrams = V.filter((v) => papel(v.time) === 5 && v.subsistemas);
    const intactos = V.filter((v) => v.subsistemas && v.subsistemas.length);
    ok(abrams.length >= 5 && abrams.every((v) => v.subsistemas.length === 10 || v.subsistemas.length === 11)
      && intactos.every((v) => v.subsistemas.every((x) => x.dano === 0)),
      `no deployment, sem um tiro dado, a lista ja conta: ${abrams.length} Abrams com 10 ou 11 itens, ${intactos.length} veiculos com a lista inteira zerada`);
    // e o terminador e o que fecha: a lista de todo veiculo lido acaba no contador do bloco 0x03
    const s = V.filter((v) => v.subsistemas).map((v) => SV.subsistemas(c, v.anc));
    ok(s.length && s.every((x) => x.fecha && x.confiavel), `${s.length} listas fecham no contador das entradas 0x03`);
  }
}

// 63. "COMBINE SQUAD" NAO MEXE NO QUE O APP LE (E101). Quando um esquadrao perde muita gente o jogo
//     oferece juntar os times num so. autor gravou o antes e o depois na mesma batalha. O que muda e
//     so o lado da BATALHA (o time some da lista de times e os homens dele saem dela); o ROSTER da
//     campanha — que e o unico lado que o app le e escreve — fica igual byte a byte no que importa:
//     as mesmas linhas, os mesmos homens, os mesmos INDICES (e por indice que a reposicao escreve).
{
  const SG = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/';
  const antes = SG + 'RUS1 BTT2 before combine.bts', depois = SG + 'RUS1 BTT2 after combine.bts';
  if (fs.existsSync(antes) && fs.existsSync(depois)) {
    const { readRoster, readRosterTails, vehicleStates } = await import('./src/re.mjs');
    const linha = (r) => r.unidades.map((u) => `${u.coreId}[${u.soldados.map((s) => `${s.nome}:${s.estado}:${s.indice}`).join('|')}]`).join(' ');
    const caudas = (t) => Object.entries(t).map(([i, c]) => `${i}:${c && c.arma ? `${c.arma.classe}/${c.arma.item}` : '-'}${c && c.chefeDaUnidade ? 'C' : ''}${c && c.lidera ? 'L' : ''}`).join(' ');
    const veic = (v) => v.map((x) => `${x.coreId}:${x.codigo}`).join(',');
    const ra = readRoster(antes), rb = readRoster(depois);
    ok(linha(ra) === linha(rb) && JSON.stringify(ra.aar) === JSON.stringify(rb.aar) && ra.playerForce === rb.playerForce,
      `combinar times nao mexe no roster: ${ra.unidades.length} linhas, ${ra.unidades.reduce((t, u) => t + u.soldados.length, 0)} homens, mesmos indices e mesmo AAR`);
    ok(caudas(readRosterTails(antes)) === caudas(readRosterTails(depois)) && veic(vehicleStates(antes)) === veic(vehicleStates(depois)),
      'nem nas caudas (a arma de cada homem) nem no estado das maquinas');
    // e do lado da batalha e que esta a diferenca — o leitor de pesquisa ve um time a menos
    const SV = await import(new URL('../tools/re/saves.mjs', import.meta.url).href);
    const A = await import(new URL('../tools/re/anexar2.mjs', import.meta.url).href);
    const times = (f) => { const c = A.abrirCompleto(f).completo; return SV.equipes(c, SV.soldados(c)).length; };
    const ta = times(antes), tb = times(depois);
    ok(tb === ta - 1, `o que muda e so o lado da batalha: ${ta} times viram ${tb} — e nada em app/src le essa lista`);
  }
}

// 64. O DESTROCO JA REPOSTO E HISTORIA (E102). `state.lost` e recalculado de `state.vehicles` a cada
//     save lido; enquanto a marca do destroco continuasse 'destroyed', ele voltava para a lista de
//     perdidos depois de ja ter sido reposto — vermelho no grafico, com "+ take" (que cobraria o
//     preco cheio por uma maquina que `battlePresence` mantem fora) e com o morto dele a venda
//     batalha apos batalha. Caso do autor: BMP-2M #1 da RUS1, queimado na batalha 1 e reposto.
{
  const { machineCrew } = await import('./src/campaign.mjs');
  // a marca 'replaced' e inerte para os dois recalculos
  const vehicles = { 24: 'survived', 32: 'replaced', 33: 'destroyed', 42: 'survived' };
  const lost = Object.entries(vehicles).filter(([, x]) => x === 'destroyed' || x === 'knocked_out').map(([id]) => Number(id));
  const survived = Object.entries(vehicles).filter(([, x]) => x === 'survived' || x === 'immobilized').map(([id]) => Number(id));
  ok(lost.join() === '33' && survived.join() === '24,42', `o destroco reposto sai das duas contas: perdidos ${lost.join() || '-'} | inteiros ${survived.join()}`);
  // e o morto dele nao volta para a lista de homens
  const state = { units: [
    { coreId: 32, name: 'Infantry Fighting Vehicle (BMP-2M) #1', role: 'ifv', present: false },
    { coreId: 42, name: 'Infantry Fighting Vehicle (BMP-2M) #1', role: 'ifv', present: true },
    { coreId: 30, name: 'Squad (Rifle) #2', role: 'infantry', present: true },
  ], lost: [], vehicles };
  const baixas = [{ index: 33, coreId: 32, name: 'Fadeev', state: 3 }, { index: 9, coreId: 30, name: 'Salamatin', state: 2 }];
  const crew = machineCrew(state, baixas, { offMap: new Set() });
  ok(crew.length === 1 && crew[0].coreId === 32, 'o morto do destroco conta como tripulacao, nao como homem a comprar');
}

// 65. RECRUTAR ENXERTA, NAO RECONSTROI (FORMATO 125, E103). Com um veiculo ANEXADO na forca a
//     reconstrucao era impossivel: o gerador escreve o anexo DEPOIS de todas as formacoes, a
//     formacao nova entrava na frente dele e os core id — que sao o id do registro — trocavam de
//     dono. O autor leu "adding a formation moved 2 existing core ids and lost 1" e ficou sem
//     poder recrutar. Agora os registros novos entram no FIM e nada do que ja estava la e
//     reescrito: o teste confere unidade por unidade E byte a byte.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-e103-'));
  const mapa = mapFile(mapPool(1, [], 0)[0]);
  const trace = { event() {}, read() {}, wrote() {}, async step(n, x, f) { return f(); } };
  const A = await import(new URL('../tools/re/anexar2.mjs', import.meta.url).href);
  const { checkForce, contentEnd } = await import('./src/re.mjs');
  const sob = (no) => { const out = []; const w = (n) => { out.push(n.key); n.children.forEach(w); }; w(no); return out; };

  // A forca de partida: um pelotao de fuzileiros russo com um caminhao ANEXADO nele — o caso do
  // autor, em miniatura.
  const fonte = 'RU - Tactical Group (Battalion [BMP]).btt';
  let pel = null;
  const acha = (n) => { if (!pel && n.isFormation && /^Platoon \(Rifle\)/.test(n.name) && n.children.some((c) => !c.isFormation)) pel = n; n.children.forEach(acha); };
  formationTree(fonte).roots.forEach(acha);
  const p0 = priceOfPicks([{ source: fonte, nation: 'RU', keep: sob(pel), xp: {}, extras: [{ tipo: 'Truck (Ural-4320)', key: pel.key }] }], 'RU', R)[0];
  const core0 = path.join(tmp, 'core.btt');
  await buildCoreForce({ picks: [p0], nation: 'RU', enemy: 'US', mapFile: mapa, workDir: tmp, out: core0, trace });
  const antes = unitDirectory(core0);
  const anexo = antes[antes.length - 1];
  const maiorAntes = Math.max(...antes.map((u) => u.coreId));
  ok(/Ural/.test(anexo.name) && anexo.coreId === maiorAntes,
    `o veiculo anexado e o ULTIMO core id da forca (${anexo.coreId} ${anexo.name}): e ele que a reconstrucao atropelava`);

  // Duas formacoes recrutadas de uma vez — um enxerto sobre o outro.
  const novos = ['RU - Section (Forward Observer).btt', 'RU - Section (Supply).btt']
    .map((f) => priceOfPicks([{ source: f, nation: 'RU', keep: sob(formationTree(f).roots[0]), xp: {} }], 'RU', R)[0]);
  const saida = path.join(tmp, 'grown.btt');
  const grown = await growCoreForce({
    picks: [p0], newPicks: novos, nation: 'RU', enemy: 'US', mapFile: mapa,
    workDir: tmp, out: saida, before: antes,
    present: antes.filter((u) => u.present).map((u) => u.coreId), dropped: [], coreFile: core0, trace,
  });
  const depois = grown.units;
  const porId = new Map(antes.map((u) => [u.coreId, u]));
  const mexidos = depois.filter((u) => porId.has(u.coreId) && (porId.get(u.coreId).name !== u.name || porId.get(u.coreId).formation !== u.formation));
  const sumidos = antes.filter((u) => !depois.some((x) => x.coreId === u.coreId));
  ok(!mexidos.length && !sumidos.length && depois.length === antes.length + grown.added.length,
    `dois recrutamentos seguidos: ${antes.length} -> ${depois.length} unidades, nenhum core id movido nem perdido`);
  ok(depois.find((u) => u.coreId === anexo.coreId)?.name === anexo.name && depois.find((u) => u.coreId === anexo.coreId)?.formation === anexo.formation,
    `o anexo continua sendo o core ${anexo.coreId}, na mesma formacao`);
  ok(grown.added.length === novos.reduce((a, p) => a + p.units, 0)
    && grown.added.every((u) => u.coreId > maiorAntes)
    && grown.added.every((u, i) => i === 0 || u.coreId > grown.added[i - 1].coreId),
    `as ${grown.added.length} unidades novas vem todas depois do ultimo id antigo (${maiorAntes}), em ordem crescente`);
  ok(grown.added.every((u) => !u.formation.startsWith('Tactical Group')) && new Set(grown.added.map((u) => u.formation.split(' / ')[0])).size === 2,
    'e cada uma dentro da formacao que comprou, que entrou como topo proprio no organograma');
  const ck = checkForce(saida);
  ok(ck.ok, `a forca enxertada passa na checagem estrutural (${ck.erros.length} erros)`);

  // BYTE A BYTE: o conteudo de todo registro que ja existia sai igual do outro lado. (O enchimento
  // do ultimo deles muda — deixou de ser o fim do bloco —, e a cauda core fica de fora da conta
  // porque e la que mora o bit de presenca, que o recrutamento reescreve de proposito.)
  const X = A.abrirCompleto(core0), Y = A.abrirCompleto(saida);
  const corpo = (Z, i) => { const r = Z.R[i], fim = Z.R[i + 1] ? Z.R[i + 1].c : Z.completo.length; return Z.completo.subarray(r.c, contentEnd(Z.completo, r, fim).fim); };
  let diferentes = 0;
  for (let i = 0; i < X.R.length; i++) if (!corpo(X, i).equals(corpo(Y, i))) diferentes++;
  ok(X.R.length && !diferentes && Y.R.length > X.R.length,
    `os ${X.R.length} registros antigos saem byte a byte iguais, com ${Y.R.length - X.R.length} novos atras deles`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 66. O PLACAR DE CADA UNIDADE (FORMATO 110.13). autor mostrou o painel do ultimo turno: o BMP-2M do
//     Skuratov com "Total Campaign Victories: 55 Enemy Casualties, 1 M1126 Stryker, 1 BTR-4E", e
//     15 + 1 Stryker na batalha. O fim do bloco do roster e `u16 baixas | ff ff | u16 n | n x (u16
//     tipo, u16 qtd)`, com o tipo = val | tab << 8. Bytes reais do core 42, virada 2 e virada 3.
{
  const A = await import(new URL('../tools/re/abates.mjs', import.meta.url).href);
  const hex = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');
  const b2 = hex('29 00 05 00 28 00 ff ff 01 00 46 05 01 00 00 00 00 00');
  const b3 = hex('29 00 05 00 37 00 ff ff 02 00 01 00 01 00 46 05 01 00 00 00 00 00');
  const a2 = A.abatesDoBloco(b2, 6), a3 = A.abatesDoBloco(b3, 6);
  ok(a2.baixas === 40 && a2.veiculos.length === 1 && a2.veiculos[0].val === 70 && a2.veiculos[0].tab === 5,
    `virada 2: 40 baixas e um BTR-4E (70,5)`);
  ok(a3.baixas === 55 && a3.veiculos.map((v) => `${v.val},${v.tab}x${v.qtd}`).join(' ') === '1,0x1 70,5x1',
    `virada 3: 55 baixas, Stryker (1,0) e BTR-4E — o painel do jogo; ${a3.baixas - a2.baixas} na batalha, como o "Combat Victories"`);
  ok(A.abatesDoBloco(hex('00 00 05 00 ff ff 00 00 00 00'), 4)?.baixas === 5 && A.abatesDoBloco(b3, -1) === null,
    'bloco sem veiculo abatido le a lista vazia, e bloco sem `ff ff` fica sem leitura em vez de zero');
}

// 67. TRES TRAVAS (28/09, F0 do plano de reposicao na vaga).
//     (a) A PASTA DA O NOME: uma copia de campanha carrega a `slug` da original e `saveState` gravava
//         por ela — o teste ponta a ponta do E103 escreveu por cima da RUS1 do autor.
//     (b) DESTROCO REPOSTO E HISTORIA: o debrief da batalha 3 da RUS1 releu o core 32 (queimado na 1,
//         reposto pelo 42) como "destroyed", porque um recrutamento religou o `present` dele.
//     (c) SO ENTRA MUNICAO QUE ALGUEM DESTE SAVE CARREGA: o refit deu um cartucho de Javelin (item 57)
//         a dois engenheiros russos saqueados, vindo de um tipo americano de mesmo numero.
{
  const { loadState, saveState, vehiclesFromSave, toeTable, weaponTable } = await import('./src/campaign.mjs');
  const { CAMPAIGNS_DIR } = await import('./src/settings.mjs');
  const { missingLoads } = await import('./src/transition.mjs');
  // (a)
  const pasta = `ZZ-TESTE-SLUG-${process.pid}`, alheia = `ZZ-NAO-EXISTE-${process.pid}`;
  const dir = path.join(CAMPAIGNS_DIR, pasta);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ slug: alheia, name: 'copia', units: [], picks: [], createdAt: '2026-09-28' }));
  try {
    const s = loadState(pasta);
    saveState({ ...s, credits: 1 });
    ok(s.slug === pasta && !fs.existsSync(path.join(CAMPAIGNS_DIR, alheia)) && JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).credits === 1,
      'uma pasta copiada grava na PROPRIA pasta, nunca na campanha cujo nome ela carrega');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(path.join(CAMPAIGNS_DIR, alheia), { recursive: true, force: true });
  }
  // (b) e (c), com os saves da RUS1 quando existem na maquina
  const SVR = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/';
  const b3 = `${SVR}RUS1 BTT3 TRANSITION.bts`, b2 = `${SVR}RUS1 BTT2 TRANSITION.bts`;
  if (fs.existsSync(b3)) {
    const U = (coreId) => ({ coreId, role: 'ifv', name: 'Infantry Fighting Vehicle (BMP-2M)', present: true });
    const st = { lost: [], units: [U(32), U(42), U(52)], wrecked: [{ battle: 1, coreId: 32, replacedBy: 42 }], vehicles: { 32: 'replaced' } };
    const v = vehiclesFromSave(st, b3, { offMap: new Set() });
    ok(!('32' in v.marks) && v.marks[52] === 'destroyed' && v.marks[42] === 'survived',
      `o destroco reposto nao e relido: ${JSON.stringify(v.marks)} (o 32 queimou na batalha 1)`);
  }
  if (fs.existsSync(b2)) {
    const plano = missingLoads(b2, toeTable(), weaponTable());
    const com57 = Object.values(plano).filter((x) => x[57]).length;
    ok(com57 === 0 && plano[81] && plano[81][1] > 0 && Object.keys(plano[81]).length === 1,
      `nenhum engenheiro recebe municao de Javelin: Sbitnev leva ${JSON.stringify(plano[81])}`);
  }
}

// 68. O PROPRIO VEICULO VOLTA, NA VAGA DELE (28/09). Repor acordava um gemeo dormente onde a arvore
//     tivesse um — o autor repos o BMP #2 do pelotao 1 e um BMP do pelotao 3 apareceu em campo. Agora
//     o bloco do destroco e curado no lugar (S = 3, dano a zero) e o jogo o poe em campo: provado em
//     tela com quatro variantes do mesmo save (sem cura e REFIT 100: recusado; cura no lugar e forma
//     dormente: em campo). Bytes do BMP-2M 52 da RUS1, destruido na batalha 3.
{
  const R2 = await import(new URL('../tools/re/ressurreicao.mjs', import.meta.url).href);
  const VE = await import(new URL('../tools/re/veiculo_estado.mjs', import.meta.url).href);
  const { battlePresence, fieldedIds } = await import('./src/campaign.mjs');
  const SVR = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/';
  const b3 = `${SVR}RUS1 BTT3 TRANSITION.bts`;
  if (fs.existsSync(b3)) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-rebuild-'));
    const out = path.join(tmp, 'curado.bts');
    const r = R2.ressuscitar(b3, out, [52], { modo: 'curar' });
    const e = VE.estadosDoSave(out).find((x) => x.coreId === 52);
    ok(r.curados[0].de === 'S=1' && e.codigo === 3 && e.f === 1,
      'o bloco do BMP 52 relido como OK, mobilidade 1,0 — os outros blocos intactos (conferido dentro do escritor)');
    let recusou = false; try { R2.ressuscitar(out, path.join(tmp, 'de-novo.bts'), [52]); } catch (x) { recusou = /ja esta OK/.test(x.message); }
    ok(recusou, 'curar o que ja esta OK e recusado, com frase');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  // A presenca: o reconstruido entra em campo; o destroco antigo, reposto por gemeo, continua fora.
  const U = (coreId, present = true) => ({ coreId, present, name: 'Infantry Fighting Vehicle (BMP-2M)', role: 'ifv' });
  const st = {
    units: [U(32), U(42), U(52)], purchased: [42, 52], lost: [],
    wrecked: [{ battle: 1, coreId: 32, replacedBy: 42 }, { battle: 3, coreId: 52, rebuilt: true }],
  };
  const bp = battlePresence(st);
  ok(bp.on.includes(52) && !bp.off.includes(52) && bp.off.includes(32) && fieldedIds(st).has(52),
    `o reconstruido vai para a batalha e recebe municao; o destroco do jeito antigo fica fora (on ${bp.on}, off ${bp.off})`);
}

// 69. TIPOS DE FORMACAO E SPECIAL FORCES (autor, 27/09). A biblioteca vira tabela com a coluna Type;
//     tres formacoes sao Special Forces — um pedaco fixo de uma fonte da biblioteca, uma por campanha,
//     nada dela a venda depois, e as unicas cujos homens podem trocar de arma.
{
  const { libFormations } = await import('./src/catalog.mjs');
  const { checkSpecialForces, gearScope, isSpecialForcesUnit } = await import('./src/campaign.mjs');
  // (a) todo tipo classificado, nos tres exercitos
  const outros = ['US', 'UKR', 'RU'].flatMap((n) => libFormations(n).filter((f) => !f.type || f.type === 'Other').map((f) => `${n} ${f.name}`));
  ok(!outros.length, `toda formacao da biblioteca tem tipo${outros.length ? ': sem tipo ' + outros.join('; ') : ''}`);
  // (b) as linhas SF so aparecem na vitrine, e com o tamanho da regra
  const sf = ['US', 'UKR', 'RU'].flatMap((n) => libFormations(n, { specialForces: true }).filter((f) => f.sf));
  const semSF = ['US', 'UKR', 'RU'].flatMap((n) => libFormations(n).filter((f) => f.sf));
  ok(sf.map((f) => `${f.nation} ${f.units}`).join(', ') === 'US 5, UKR 7, RU 8' && !semSF.length && sf.every((f) => f.type === 'Special Forces'),
    `tres Special Forces na vitrine (${sf.map((f) => `${f.name} ${f.units} un ${f.price} cr`).join('; ')}), nenhuma fora dela`);
  ok(libFormations('UKR', { specialForces: true }).some((f) => f.source === 'UKR - Company (Brigade Reconnaissance)' && !f.sf)
    && !libFormations('US', { specialForces: true }).some((f) => f.source === 'US - Platoon (LRS)' && !f.sf),
    'a companhia inteira continua a venda ao lado da SF dela; o LRS, que e SF por inteiro, nao se duplica');
  // (c) a composicao e fixa: o servidor ignora o que a pagina mandou
  const ukr = sf.find((f) => f.nation === 'UKR');
  const [p] = priceOfPicks([{ source: ukr.source, nation: 'UKR', sf: true, keep: ['0'], xp: { '0.0': 'Elite', '0.4.1': 'Veteran' } }], 'UKR', R);
  // 10/10: SF custa o preco fixo da regra e toda unidade e da experiencia da regra, o que quer que a pagina mande
  const nivelSF = R.formations.specialForcesExperience, precoSF = R.formations.specialForcesPrice;
  ok(p.units === 7 && p.sf && p.sfName === ukr.name && p.keep.every((k) => p.xp[k] === nivelSF) && !Object.values(p.xp).includes('Elite') && p.price === precoSF
    && sf.every((f) => f.price === precoSF),
    `a pagina mandou so a raiz e um Elite: o pick sai com as 7 unidades do 1o pelotao, todas ${nivelSF}, por ${p.price} cr; vitrine ${sf.map((f) => f.price).join('/')} cr`);
  let recusas = 0;
  for (const extra of [{ extras: [{ tipo: 'Truck (Ural-4320)', key: '0.4' }] }, { swaps: [{ key: '0', group: 666, to: [1, 0] }] }]) {
    try { priceOfPicks([{ source: ukr.source, nation: 'UKR', sf: true, keep: [], ...extra }], 'UKR', R); } catch (e) { if (/special forces/.test(e.message)) recusas++; }
  }
  ok(recusas === 2, 'special forces nao aceitam anexo nem troca de equipamento — recusadas com frase');
  // (d) uma por campanha
  let uma = false; try { checkSpecialForces([{ sf: true }, { sf: true }], R); } catch (e) { uma = /only 1 special forces/.test(e.message); }
  ok(uma && (() => { checkSpecialForces([{ sf: true }, {}], R); return true; })(), 'duas Special Forces na mesma forca sao recusadas; uma passa');
  // (e) quem pode trocar arma: so os homens da SF, com o gear geral desligado
  const st = { picks: [{ sf: true }, {}], units: [{ coreId: 7, key: '0.4.1', present: true }, { coreId: 9, key: '1.0.2', present: true }] };
  const esc = gearScope(st, R);
  ok(R.gear.enabled === false && esc && !esc.all && [...esc.coreIds].join() === '7' && isSpecialForcesUnit(st, st.units[0]) && !isSpecialForcesUnit(st, st.units[1]),
    'com o gear geral desligado, so a unidade da Special Forces troca de arma');
}

// 70. A FABRICA DECIDE O QUE ENTRA NO PAIOL, E O PAIOL PODE ENCOLHER (plano de reset, 28/09).
//     A trava de 28/09 (so item que alguem do save carrega) nao segurou: na batalha 3 da RUS1 dois
//     engenheiros ja tinham o cartucho de Javelin, e o refit o espalharia para mais quatro. A origem e
//     SAQUE — engenheiros russos pegando Javelins de americanos em 06/09, gravado pelo proprio jogo — e
//     a tabela nova (research/fabrica.json, moda de esquadroes inteiros, chave exercito|tipo) nao o tem.
{
  const { missingLoads } = await import('./src/transition.mjs');
  const { toeTable, weaponTable, factoryTable } = await import('./src/campaign.mjs');
  const RO = await import(new URL('../tools/re/roster.mjs', import.meta.url).href);
  const fab = factoryTable();
  const eng = fab?.tipos?.['RU|261'];
  ok(eng && Object.values(eng.vagas).every((v) => !('57' in v.municao)) && eng.vagas[4].municao[1] === 240,
    'a fabrica do Squad (Engineer) russo nao tem cartucho de Javelin; a vaga 4 leva 240 de 5.45mm');
  const b3 = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/RUS1 BTT3 TRANSITION.bts';
  if (fs.existsSync(b3)) {
    const n57 = (o) => Object.values(o).filter((x) => x[57]).length;
    const antes = n57(missingLoads(b3, toeTable(), weaponTable()));
    const agora = n57(missingLoads(b3, toeTable(), weaponTable(), { factory: fab }));
    ok(antes > 0 && agora === 0, `com a fabrica, nenhuma insercao de item 57 na virada da batalha 3 (a trava antiga faria ${antes})`);
    const tmp = path.join(os.tmpdir(), `rem-${process.pid}.bts`);
    const r = RO.removerMunicao(b3, tmp, { 93: [57], 102: [57] });
    const c1 = RO.caudasDoRoster(b3), c2 = RO.caudasDoRoster(tmp);
    const outros = c1.filter((x, i) => i !== 93 && i !== 102 && !Buffer.from(x.cauda).equals(Buffer.from(c2[i].cauda))).length;
    ok(r.itens === 2 && r.encolheu === 8 && !outros && RO.paiolDe(c2[102].cauda).pares.map((x) => x.item).join() === '1',
      'remover o par encolhe o vetor 4 B por item, o Sbitnev fica so com o 5.45mm, e nenhum outro homem muda');
    fs.rmSync(tmp, { force: true });
  }
}

// 71. O RESET DE FABRICA (plano B, 28/09). Um plano so, puro (`resetPlan`), escrito numa passada
//     (`refitSave` -> `factoryReset`): cada homem de pe volta ao que a fabrica deu a vaga dele, com a
//     chave exercito|tipo. Sobre uma copia da virada da batalha 3 da RUS1:
//     (a) contaminacao: depois do refit nenhum homem carrega item fora da variante da vaga — o
//         cartucho de Javelin (57) dos engenheiros sai;
//     (b) idempotencia: o plano sobre a saida e vazio e uma segunda passada nao escreve nada;
//     (c) maos como CONJUNTO: nenhuma troca de mao e so a ordem do mesmo par, e o Bestuzhev sai do
//         `4/14 + 4/14`;
//     (d) a arma comprada fica: com `keep` o homem sai com ela na mao 1;
//     (e) sem linha = intocado: sem o exercito da unidade, nada e planejado para ela e ela e nomeada.
{
  const b3 = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/RUS1 BTT3 TRANSITION.bts';
  const fab = factoryTable();
  if (fs.existsSync(b3) && fab?.tipos) {
    const RO = await import(new URL('../tools/re/roster.mjs', import.meta.url).href);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-reset-'));
    const src = path.join(tmp, 'in.bts'); fs.copyFileSync(b3, src);
    const armies = armiesOfSave(src);
    const trace = new Trace(path.join(tmp, 'log.jsonl'), { slug: 'teste', battle: 0 });
    const plano0 = resetPlan(src, fab, { armies, weapons: weaponTable() });
    const out = refitSave({ save: src, workDir: path.join(tmp, 'w1'), tag: 'T', R, trace, armies });
    const tails = RO.caudasDoRoster(out);
    const n57 = tails.filter((d) => RO.paiolDe(d.cauda)?.pares.some((p) => p.item === 57)).length;
    const resto = resetPlan(out, fab, { armies, weapons: weaponTable() });
    const vazio = ['hands', 'remove', 'insert', 'amounts', 'grenades'].every((k) => !Object.keys(resto[k]).length);
    ok(n57 === 0 && vazio, `(a) depois do refit ninguem carrega item fora da fabrica: ${n57} homem(ns) com o 57, plano restante ${vazio ? 'vazio' : 'NAO vazio'}`);
    const copia = path.join(tmp, 'out.bts'); fs.copyFileSync(out, copia);
    const out2 = refitSave({ save: copia, workDir: path.join(tmp, 'w2'), tag: 'T2', R, trace, armies });
    ok(out2 === copia || Buffer.compare(fs.readFileSync(out2), fs.readFileSync(copia)) === 0, '(b) uma segunda passada nao muda um byte');
    const soOrdem = Object.values(plano0.hands).filter((h) => h.from.split(' + ').sort().join() === h.to.split(' + ').sort().join());
    const best = Object.values(plano0.hands).find((h) => h.name === 'Bestuzhev');
    ok(!soOrdem.length && best && best.from === '4/14 + 4/14' && best.to.split(' + ').sort().join() === '2/30,4/14',
      `(c) nenhuma troca e so de ordem (${soOrdem.length}); Bestuzhev ${best ? best.from + ' -> ' + best.to : 'fora do plano'}`);
    // (d) um homem de pe qualquer, com uma arma "comprada" que a vaga nao tem
    const ro = RO.lerRoster(src);
    const u = ro.unidades.find((x) => armies.get(x.coreId) && fab.tipos[`${armies.get(x.coreId)}|${x.tipo}`] && x.soldados.some((s) => s.estado <= 1));
    const vaga = u.soldados.findIndex((s) => s.estado <= 1);
    const pk = resetPlan(src, fab, { armies, keep: { [u.coreId]: { [vaga]: '2/9' } }, weapons: weaponTable() });
    const h = pk.hands[u.soldados[vaga].indice];
    ok(h && h.to.split(' + ')[0] === '2/9', `(d) a arma comprada fica na MAO 1: ${u.soldados[vaga].nome} ${h ? h.from + ' -> ' + h.to : 'sem troca'}`);
    // e o caso que escondeu o defeito de 28/09: o homem de dois fuzis (Baranov, 2/26 + 2/32, mao 1 de
    // fabrica 2/32) — a regra "mantenha o que ja esta na mao 1" jogava a SVD comprada para a mao 2
    const bar = ro.unidades.flatMap((x) => x.soldados.map((s, k) => ({ x, s, k }))).find((o) => o.s.nome === 'Baranov' && o.s.estado <= 1);
    if (bar) {
      const pb = resetPlan(src, fab, { armies, keep: { [bar.x.coreId]: { [bar.k]: '2/46' } }, weapons: weaponTable() });
      const hb = pb.hands[bar.s.indice];
      ok(hb && hb.to.split(' + ')[0] === '2/46', `(d) com dois fuzis na mao, a SVD comprada vai para a mao 1: ${hb ? hb.from + ' -> ' + hb.to : 'sem troca'}`);
    }
    // (e) a mesma unidade sem exercito conhecido
    const semEx = new Map(armies); semEx.delete(u.coreId);
    const pe = resetPlan(src, fab, { armies: semEx, weapons: weaponTable() });
    const tocou = u.soldados.some((s) => ['hands', 'remove', 'insert', 'amounts', 'grenades'].some((k) => pe[k][s.indice]));
    ok(!tocou && pe.untouched.some((x) => x.coreId === u.coreId), `(e) sem exercito, a unidade ${u.coreId} fica intocada e nomeada`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 72. A CARGA DA MAQUINA TAMBEM VOLTA A FABRICA (28/09). A segunda lista do rabo — o que o veiculo leva
//     para a infantaria — nao era reposta por ninguem. Sobre a virada da batalha 3 da RUS1:
//     (a) o item 41 que a infantaria esgotou nos Ural 172/173 volta, no fim da lista (ordem 1,5,67,41);
//     (b) um item que a "fabrica" nao poe SAI da carga (aqui: uma fabrica de teste sem o 67);
//     (c) o Ural 174, destruido, e os blocos dormentes nao sao editados;
//     (d) paiol e carga editados no MESMO bloco (o 92 do BMP 24 volta ao paiol e a carga dele fica certa).
{
  const b3 = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/RUS1 BTT3 TRANSITION.bts';
  const fab = factoryTable();
  if (fs.existsSync(b3) && fab?.maquinas) {
    const TV = await import(new URL('../tools/re/toe_veiculos.mjs', import.meta.url).href);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-carga-'));
    const ural = fab.maquinas['RU|Truck (Ural-4320)'], bmp = fab.maquinas['RU|Infantry Fighting Vehicle (BMP-2M)'];
    const nomes = new Map([[172, 'Truck (Ural-4320) #1'], [173, 'Truck (Ural-4320) #2'], [174, 'Truck (Ural-4320) #3'], [143, 'Truck (Ural-4320) #1'], [24, 'Infantry Fighting Vehicle (BMP-2M)']]);
    const tabela = { 'Truck (Ural-4320)': {}, 'Infantry Fighting Vehicle (BMP-2M)': bmp.paiol };
    const semO67 = { ...ural.carga }; delete semO67[67];
    const cargas = {
      'Truck (Ural-4320)': { itens: semO67, ordem: ural.cargaOrdem },
      'Infantry Fighting Vehicle (BMP-2M)': { itens: bmp.carga, ordem: bmp.cargaOrdem, paiolOrdem: bmp.paiolOrdem },
    };
    const out = path.join(tmp, 'out.bts');
    const r = TV.reabastecerUnidades(b3, out, tabela, { soCoreIds: new Set(nomes.keys()), nomes, exato: true, cargas });
    const bl = TV.blocosDoSave(out);
    const le = (id, forma = 'veiculo') => { const u = bl.unidades.find((x) => x.coreId === id); const l = TV.semAninhadas(TV.lerRabo(bl.exp, u, forma, true)); return l.length === 1 ? l[0] : null; };
    const c172 = le(172)?.carga.map((s) => `${s.item}=${s.qtd}`).join(',');
    ok(c172 === '1=3000,5=3000,41=5', `(a+b) Ural 172: carga ${c172} — o 41 voltou no fim e o 67 saiu`);
    const antes = TV.blocosDoSave(b3);
    const igual = (id) => Buffer.compare(antes.unidades.find((x) => x.coreId === id).bytes, bl.unidades.find((x) => x.coreId === id).bytes) === 0;
    ok(igual(174) && igual(143), '(c) o Ural 174 (destruido) e o 143 (dormente) saem byte a byte iguais');
    const r24 = le(24);
    ok(r24 && r24.paiol.some((s) => s.item === 92 && s.qtd === 340) && r24.carga.map((s) => s.item).join() === bmp.cargaOrdem.filter((i) => bmp.carga[i] !== undefined).join(),
      `(d) BMP 24: 92=340 de volta ao paiol (n ${r24?.n}) e a carga na ordem de fabrica (${r24?.carga.map((s) => s.item).join(',')})`);
    ok(r.cargaRemovidos.length === 2 && r.cresceu === 4 * (r.inseridos.reduce((a, x) => a + x.itens.length, 0) + r.cargaInseridos.reduce((a, x) => a + x.itens.length, 0) - r.cargaRemovidos.reduce((a, x) => a + x.itens.length, 0)),
      `o bloco muda exatamente 4 B por par posto ou tirado (${r.cresceu} B)`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 73. REFORCOS (E107, FORMATO 127). O gabarito do editor (ZZ MAPA/0X2 REF B0..B5): o grupo nos 3 bits
//     baixos de +12 das unidades, e a tabela `u32 n | n x (lado, grupo, chegada, janela, u32 0, u16 len,
//     nome)` logo depois do ultimo registro (+8, ou +13 se ele e core), com o campo de tamanho antes da
//     forca acompanhando. (a) o escritor refaz o passo 5 a partir do passo 0 IGUAL ao editor, da forca
//     ao fim da tabela; (b) o leitor acha a tabela em cenarios de fabrica e ela casa com as marcas.
{
  const Z = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/';
  const b0 = `${Z}ZZ MAPA/0X2 REF B0.btt`, b5 = `${Z}ZZ MAPA/0X2 REF B5.btt`;
  if (fs.existsSync(b0) && fs.existsSync(b5)) {
    const RF = await import(new URL('../tools/re/reforco.mjs', import.meta.url).href);
    const A2 = await import(new URL('../tools/re/anexar2.mjs', import.meta.url).href);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-ref-'));
    const alvo = RF.lerReforcos(b5);
    const unidades = {};
    for (const lado of ['azul', 'vermelho']) for (const [g, us] of Object.entries(alvo.marcadas[lado])) for (const u of us) unidades[u.id] = Number(g);
    const out = path.join(tmp, 'b5.btt');
    RF.escreverReforcos(b0, out, { grupos: alvo.tabela.grupos, unidades });
    const trecho = (f) => { const X = A2.abrirCompleto(f); return X.completo.subarray(X.R[0].c - 9, RF.posicaoDaTabela(X).fim); };
    ok(trecho(out).equals(trecho(b5)), '(a) escrever o passo 5 sobre o passo 0 da, do campo de tamanho ao fim da tabela, os bytes do editor');
    const fabrica = ['Going to Town', 'Dueling Shashkas', 'Opportunity Knocks'].map((n) => `${Z}Scenarios/${n}.btt`).filter((f) => fs.existsSync(f));
    const lidos = fabrica.map((f) => RF.lerReforcos(f)).filter((r) => r.tabela && r.tabela.grupos.every((g) => (r.marcadas[g.lado][g.grupo] || []).length));
    ok(lidos.length === fabrica.length && fabrica.length > 0, `(b) a tabela dos cenarios de fabrica le e casa com as marcas (${lidos.length}/${fabrica.length})`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 74. O VARIABLE EXTRA TIME (FORMATO 50.1). Mora so na copia de dentro, dois bytes depois da duracao;
//     9 dos 86 mapas de cada tipo trazem 5 ou 15 minutos. Numa copia do mapa que traz 15: escrever 0
//     zera, a duracao nao muda, e escrever o mesmo valor de novo nao regrava o arquivo.
{
  const mapa = path.join(import.meta.dirname, '..', 'research', 'mapas_teste', 'CMBS Demo (Map 1568 X 1568) Assault.btt');
  if (fs.existsSync(mapa)) {
    const G = await import(new URL('../tools/re/gerar_batalha.mjs', import.meta.url).href);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-extra-'));
    const f = path.join(tmp, 'm.btt'); fs.copyFileSync(mapa, f);
    const antes = G.lerDuracao(f);
    const r1 = G.escreverTempoExtra(f, 0), depois = G.lerDuracao(f), r2 = G.escreverTempoExtra(f, 0);
    ok(antes.extra === 15 && depois.extra === 0 && depois.bloco === antes.bloco && r1.mudou && !r2.mudou,
      `o tempo extra vai de ${antes.extra} a ${depois.extra} sem mexer no relogio (${antes.bloco} -> ${depois.bloco}), e a segunda escrita nao regrava`);
    let recusou = false; try { G.escreverTempoExtra(f, 7); } catch { recusou = true; }
    ok(recusou, 'um tempo extra que o editor nao oferece (7) e recusado');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 74b. O TITULO EM MAPA TINY DE DIA (28/09). Luz 1 e tamanho 0 leem como u16 = 1, e o tamanho baixo
//      de um titulo de 32 caracteres e um " ": o leitor achava um falso titulo de um espaco e a
//      criacao da ZZ SF GEAR caiu. Todo tamanho de 1 a 64 tem de voltar como foi gravado.
{
  const mapa = path.join(import.meta.dirname, '..', 'research', 'mapas_teste', 'Tiny Going to Town (320 X 400) Assault.btt');
  if (fs.existsSync(mapa)) {
    const TB = await import(new URL('../tools/re/tipo_batalha.mjs', import.meta.url).href);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-titulo-'));
    const f = path.join(tmp, 'm.btt');
    const base = TB.ler(mapa);
    const errados = [];
    for (let L = 1; L <= 64; L++) {
      fs.copyFileSync(mapa, f);
      const t = ('ZZ SF GEAR - Battle 1: ' + 'Going to Town '.repeat(5)).slice(0, L);
      try { TB.escreverTitulo(f, t); const r = TB.ler(f); if (r.titulo !== t || r.nome !== base.nome || r.tamanho !== 'Tiny') errados.push(L); } catch { errados.push(L); }
    }
    ok(base.luz === 'Day' && base.tamanho === 'Tiny' && !errados.length,
      `mapa Tiny de dia: todo titulo de 1 a 64 caracteres volta como foi gravado${errados.length ? ` (falharam ${errados.join(', ')})` : ''}`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 75. AS ARMAS DAS SPECIAL FORCES NO ORG CHART (28/09, plano da compra de armas). O servidor da ao
//     chart: (a) `forgetGear` — o soldado que cai perde a arma comprada, so a vaga dele, e a unidade
//     vazia some; (b) o MENU DO EXERCITO (`rules.gear.menu = 'army'`): alem do que a forca carrega,
//     toda arma pessoal de mao 1 que a fabrica da ao exercito, sempre com municao e sem pistola;
//     `bought` marca a arma comprada que o homem ainda segura; (c) `factoryKit`: o kit de fabrica de
//     uma unidade antes de os homens existirem (a Section (LRS), 6 vagas, a vaga 1 com a M249).
{
  const G = await import(new URL('./src/gear.mjs', import.meta.url).href);
  const { factoryTable } = await import('./src/campaign.mjs');
  const f = G.forgetGear({ 6: { 2: '2/9', 4: '2/19' }, 7: { 1: '2/9' } }, [{ coreId: 6, slot: 2, name: 'Bolt' }, { coreId: 7, slot: 1 }, { coreId: 9, slot: 0 }]);
  ok(JSON.stringify(f.gear) === JSON.stringify({ 6: { 4: '2/19' } }) && f.forgotten.length === 2 && f.forgotten[0].name === 'Bolt',
    `(a) quem caiu perde a arma comprada: ${JSON.stringify(f.gear)}, esquecidas ${f.forgotten.length}`);
  const fab = factoryTable();
  const save = path.join(import.meta.dirname, '../research/exemplos/e60_bit20.bts');
  if (fab?.tipos && fs.existsSync(save)) {
    const st = { nation: 'UKR', baseline: {}, units: [{ coreId: 48, name: 'Squad (Rifle)', present: true, role: 'infantry', nation: 'UKR' }] };
    const RF = { ...R, gear: { ...R.gear, menu: 'force' } }, RA = { ...R, gear: { ...R.gear, menu: 'army' } };
    const so = G.readGear(save, st, RF, { factory: fab }), ex = G.readGear(save, st, RA, { factory: fab });
    const armas = (g) => (g.catalog.UKR || []).map((x) => x.name || x.weapon);
    const mA = ex.catalog.UKR || [];
    ok(mA.length > (so.catalog.UKR || []).length && armas(ex).includes('SVD') && armas(ex).includes('AKS-74U')
      && mA.every((x) => x.weapon.startsWith('2/') || (so.catalog.UKR || []).some((y) => y.weapon === x.weapon)) && mA.every((x) => x.ammo && Object.keys(x.ammo).length) && !mA.some((x) => x.weapon === '2/43'),
      `(b) o menu do exercito cresce de ${armas(so).length} para ${armas(ex).length} armas (${armas(ex).join(', ')}), todas com municao e sem a pistola`);
    // O menu por exercito trouxe armas que o regex de classe nao conhecia: o M107A1 e os dois Mk21 PSR
    // sairam de graca na ZZ SF GEAR (28/09). Toda arma de mao 1 da fabrica tem de cair na classe dela.
    const precoDe = (w, n) => G.gearPrice(w, n, R);
    const snipers = [['2/7', 'M107A1'], ['2/10', 'Mk21 PSR 7.62'], ['2/11', 'Mk21 PSR .300'], ['2/9', 'M110 CSASS'], ['2/46', 'SVD']];
    ok(snipers.every(([w, n]) => precoDe(w, n) === R.gear.price.sniper) && precoDe('2/18', 'M240L') === R.gear.price.mg,
      `(b) fuzil de precisao cobra ${R.gear.price.sniper} (${snipers.map(([w, n]) => `${n} ${precoDe(w, n)}`).join(', ')}) e a M240L ${precoDe('2/18', 'M240L')}`);
    const homem = ex.units[0].men.find((m) => m.canChange);
    const comprada = G.readGear(save, { ...st, gear: { 48: { [homem.slot]: homem.weapon } } }, RA, { factory: fab });
    ok(!homem.bought && comprada.units[0].men.find((m) => m.index === homem.index).bought, '(b) `bought` so quando a vaga tem compra registrada e o homem ainda a segura');
    const kit = G.factoryKit(fab, 'US', [35, 4]);
    ok(kit && kit.length === 6 && kit[1].weaponName === 'M249 PIP' && G.factoryKit(fab, 'US', [9999, 9]) === null,
      `(c) kit de fabrica da Section (LRS): ${kit ? kit.map((k) => k.weaponName || k.weapon).join(', ') : 'nenhum'}`);
  }
}

// 76. VENDER (16/10, regra do autor: "reembolso so da formacao inteira", substitui a de 28/09). (a) `sellPlan`: a
//     compra inteira (todas as unidades do jogador do pick — em campo ou tiradas de campo; dormente, destroco e vendida
//     nao contam) devolve o preco de todas, mesmo de quem lutou; venda parcial devolve 0, mesmo de quem nunca lutou;
//     o dormente, o destroco e o ja vendido sao recusados; (b) o vendido fica
//     fora de toda batalha (`battlePresence.off`) e nunca e acordado como reserva (`spareFor`); (c) a SF
//     vendida inteira libera a vaga; (d) `foughtIds` da RUS1 le quem esteve na batalha 1.
{
  const C = await import(new URL('./src/campaign.mjs', import.meta.url).href);
  const st = {
    units: [
      { coreId: 1, key: '0.0.1', name: 'Squad A', present: true, price: 40, type: 't1' },
      { coreId: 2, key: '0.0.2', name: 'Squad B', present: true, price: 55, type: 't1' },
      { coreId: 3, key: '0.0.3', name: 'Squad C', present: false, price: 30, type: 't1' },
      { coreId: 4, key: '0.0.4', name: 'Squad D', present: false, price: 30, type: 't1' },
      { coreId: 5, key: '0.1', name: 'BMP', present: true, price: 120, type: 't2' },
      { coreId: 6, key: '0.0.5', name: 'Squad F', present: false, price: 35, type: 't1' },
      { coreId: 8, key: '1.0', name: 'Truck', present: true, price: 70, type: 't3' },
    ],
    standDown: [3], lost: [5], sold: [{ coreId: 6 }], purchased: [1, 2, 3],
  };
  const lutou = new Set([1]);
  const p = C.sellPlan(st, [1, 2, 3], lutou);
  const por = Object.fromEntries(p.units.map((x) => [x.coreId, x.refund]));
  ok(por[1] === 40 && por[2] === 55 && por[3] === 30 && p.refund === 125 && p.wholePicks.join() === '0',
    `(a) a compra inteira (o destroco e o dormente fora) devolve tudo, quem lutou e o tirado de campo incluidos: ${JSON.stringify(por)} = ${p.refund} cr`);
  const parcial = C.sellPlan(st, [2, 3, 8], lutou);
  const pp = Object.fromEntries(parcial.units.map((x) => [x.coreId, x.refund]));
  ok(pp[2] === 0 && pp[3] === 0 && pp[8] === 70 && parcial.refund === 70 && parcial.wholePicks.join() === '1',
    `(a) parte do pick 0 sai por 0 (mesmo quem nunca lutou); o pick 1 inteiro na mesma venda devolve: ${JSON.stringify(pp)}`);
  const recusa = (ids) => { try { C.sellPlan(st, ids, lutou); return null; } catch (e) { return e.message; } };
  ok(/dormant/.test(recusa([4]) || '') && /destroyed/.test(recusa([5]) || '') && /already sold/.test(recusa([6]) || ''),
    '(a) o dormente do arsenal, o destroco e o ja vendido nao se vendem');
  const pres = C.battlePresence(st);
  ok(pres.off.includes(6) && !pres.on.includes(6), '(b) o vendido fica fora da batalha, mesmo continuando no arquivo');
  const reserva = C.spareFor({ ...st, units: [...st.units.filter((u) => u.coreId !== 4), { coreId: 7, name: 'Squad G', present: false, price: 30, type: 't1' }] }, { coreId: 9, type: 't1', formation: '' }, new Set(), []);
  ok(reserva && reserva.coreId === 7, `(b) spareFor pula o vendido (6), o tirado de campo (3) e acorda o 7: ${reserva && reserva.coreId}`);
  let duas = null; try { C.checkSpecialForces([{ sf: true, sold: 2 }, { sf: true }]); } catch (e) { duas = e.message; }
  let tres = null; try { C.checkSpecialForces([{ sf: true }, { sf: true }]); } catch (e) { tres = e.message; }
  ok(!duas && !!tres, '(c) a SF vendida inteira nao ocupa a vaga; duas SF vivas continuam recusadas');
  if (fs.existsSync(path.join(CAMPAIGNS_DIR, 'RUS1', 'battles', '01', 'result.json'))) {
    const f = C.foughtIds({ slug: 'RUS1' });
    const r1 = JSON.parse(fs.readFileSync(path.join(CAMPAIGNS_DIR, 'RUS1', 'battles', '01', 'result.json'), 'utf8'));
    const g = (r1.progression?.gains || []).map((x) => x.coreId);
    ok(g.length > 0 && g.every((id) => f.has(id)), `(d) foughtIds da RUS1 tem as ${g.length} unidades da batalha 1 (${f.size} ao todo)`);
  }
}

// 77. O BRIEFING (28/09). O bloco 0 carrega as seis secoes de cada lado e o gerador copiava as do
//     mapa — a batalha 2 da ZZ SF GEAR abriu com um major sovietico e "German tanks". (a) Numa copia
//     do mapa daquela batalha: gravar as secoes do vermelho e zerar as do azul le de volta, com
//     quebra CRLF, e o resto do bloco (imagens, notas) e o titulo ficam intactos; (b) `briefingFor`:
//     missao pelo tipo, a forca sem o vendido, e o inimigo so com intel.
{
  const mapa = path.join(import.meta.dirname, '..', 'assets', 'qb_attack', 'Village-Forest (720 X 496) 057r Attack CMBSRL.btt');
  if (fs.existsSync(mapa)) {
    const BR = await import(new URL('../tools/re/briefing.mjs', import.meta.url).href);
    const TB = await import(new URL('../tools/re/tipo_batalha.mjs', import.meta.url).href);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-briefing-'));
    const f = path.join(tmp, 'm.btt'); fs.copyFileSync(mapa, f);
    const antes = BR.ler(f);
    BR.escrever(f, { azul: ['', '', '', '', '', ''], vermelho: ['ZZ - battle 2 of 12.', 'Attack.\nTime: 45 minutes.', '12 units on the map.', 'No intelligence.', '', ''] });
    const depois = BR.ler(f);
    ok(/Tovarisch/.test(antes.vermelho[1]) && depois.vermelho[1] === 'Attack.\r\nTime: 45 minutes.' && depois.azul.every((s) => s === '')
      && depois.resto === antes.resto && TB.ler(f).titulo === TB.ler(mapa).titulo,
      `(a) o briefing do mapa ("${antes.vermelho[1].slice(0, 24)}...") da lugar ao da campanha, o azul some, e o resto do bloco (${antes.resto} B) e o titulo ficam`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const C = await import(new URL('./src/campaign.mjs', import.meta.url).href);
  const st = {
    name: 'ZZ Test', defeatsLeft: 2, history: [{ n: 1, map: 'Tiny City', level: 'Tactical Victory' }],
    units: [{ coreId: 1, present: true }, { coreId: 2, present: true, offMap: true }, { coreId: 3, present: false }],
    picks: [{ source: 'US - Platoon (LRS).btt', sf: true, sfName: 'LRS Platoon' }, { source: 'US - Section (Supply).btt', sold: 1 }], sold: [],
  };
  const mapa2 = { f: 'Village-Forest (720 X 496) 057r Attack.btt', tipo: 'Attack', W: 720, H: 496 };
  const def = { units: 28, nation: 'RU', experience: 'Green', mix: { squads: 0.5, carriers: 0.5 } };
  const semIntel = C.briefingFor({ state: st, n: 2, map: mapa2, duration: 45, defense: def, intel: false });
  const comIntel = C.briefingFor({ state: st, n: 2, map: mapa2, duration: 60, clock: { base: 45, extra: 15, final: 60 }, defense: def, intel: true });
  ok(/battle 2/.test(semIntel.vermelho[0]) && /Tactical Victory/.test(semIntel.vermelho[0]) && /^Attack the enemy position: take the objectives and hold them\./.test(semIntel.vermelho[1]) && !/Probe|Assault/.test(semIntel.vermelho[1])
    && /On the map: 1 infantry and team unit\./.test(semIntel.vermelho[2]) && /Off the map: 1\./.test(semIntel.vermelho[2]) && /LRS Platoon \(special forces\)/.test(semIntel.vermelho[2]) && !/Supply/.test(semIntel.vermelho[2])
    && /No intelligence/.test(semIntel.vermelho[3]) && /about 28 enemy units/.test(comIntel.vermelho[3]) && /No tanks/.test(comIntel.vermelho[3])
    && /15 of them bought/.test(comIntel.vermelho[1]) && semIntel.azul.every((s) => s === '') && semIntel.vermelho[4] === '' && semIntel.vermelho[5] === '',
    `(b) briefingFor: ${JSON.stringify(comIntel.vermelho.slice(0, 4)).slice(0, 260)}`);
}

// 78. IMOBILIZADO NAO E DESTRUIDO (30/09, autor). Na batalha 4 da RUS1 o T-90AM #1 (core 56, Lapin)
//     terminou imobilizado com dois tripulantes vivos (save do turno 28) e o jogo gravou S = 1 na
//     transicao. (a) `imobilizadosNoFim` o casa pelo perfil de dano e so ele; (b) `vehiclesFromSave` o
//     marca `immobilized` e mantem os outros dois destruidos; (c) `writtenOffImmobilized` o manda para a
//     reconstrucao gratuita. So nesta maquina, onde os saves existem.
{
  const SGv = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/';
  const tr = SGv + 'RUS1 BTT4 Transition.bts';
  if (fs.existsSync(tr) && fs.existsSync(SGv + 'RUS1 BTT4 TURN 028.bts') && fs.existsSync(path.join(CAMPAIGNS_DIR, 'RUS1', 'state.json'))) {
    const VE = await import(new URL('../tools/re/veiculo_estado.mjs', import.meta.url).href);
    const C = await import(new URL('./src/campaign.mjs', import.meta.url).href);
    const fim = VE.imobilizadosNoFim(tr);
    ok(fim.coreIds.join() === '56' && fim.detalhe[0].tripulacao.includes('Lapin'),
      `(a) o imobilizado no fim casado pelo perfil de dano: ${JSON.stringify(fim.detalhe.map((d) => [d.coreId, d.tripulacao]))}`);
    const st = JSON.parse(fs.readFileSync(path.join(CAMPAIGNS_DIR, 'RUS1', 'state.json'), 'utf8'));
    const v = C.vehiclesFromSave({ ...st, vehicles: {}, lost: [], wrecked: [] }, tr);
    ok(v.marks[56] === 'immobilized' && v.marks[57] === 'destroyed' && v.marks[58] === 'destroyed' && v.writtenOff.length === 1,
      `(b) marcas 56/57/58 = ${v.marks[56]}/${v.marks[57]}/${v.marks[58]}`);
    ok(C.writtenOffImmobilized({ ...st, vehicles: { 56: 'immobilized', 57: 'destroyed' } }, tr).join() === '56',
      '(c) o imobilizado que o jogo deu como perdido vai para a reconstrucao gratuita; o destruido nao');
  }
}

// 79. A FUMACA DO MORTEIRO E DA ARTILHARIA (30/09, autor: "esquecendo de repor smoke"). (a) O homem do
//     tubo (mao 1 classe 7) tem vetor de municao — o 2B14 leva HE x2 e Smoke x4 — e `paiolDe` o le
//     (antes so 2-5 e 8: o reset nunca os repunha); (b) a fabrica tem a peca fora do mapa (forma
//     canhao, bloco pequeno): 2S3M1 com HE, Krasnopol e o 282 (fumaca 152mm); (c) e a vaga do tubo
//     do Medium Mortar Team russo tem o HE e a fumaca.
{
  const RO = await import(new URL('../tools/re/roster.mjs', import.meta.url).href);
  const tubo = Buffer.from('00070400021a00000003000100f0001d0102001e01040000000000020000000121000120000000000001024758000100000000d0fe', 'hex');
  const p = RO.paiolDe(tubo);
  ok(p && JSON.stringify(p.pares) === JSON.stringify([{ item: 1, qtd: 240 }, { item: 285, qtd: 2 }, { item: 286, qtd: 4 }]),
    `(a) o vetor do homem do tubo 2B14: ${JSON.stringify(p && p.pares)}`);
  const fab = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'research', 'fabrica.json'), 'utf8'));
  const obus = fab.maquinas['RU|3 x 152mm Howitzer (2S3M1)'];
  ok(obus && obus.paiol['282'] > 0 && obus.paiol['520'] > 0 && obus.paiol['281'] > 0, `(b) a fabrica do 2S3M1: ${JSON.stringify(obus && obus.paiol)}`);
  const vaga = fab.tipos['RU|11782']?.vagas?.['1'];
  ok(vaga && vaga.mao1 === '7/4' && vaga.municao['285'] === 2 && vaga.municao['286'] === 4, `(c) a vaga do tubo do Medium Mortar Team: ${JSON.stringify(vaga && vaga.municao)}`);
}

// 80. O APARO DE GRANADA NAO ESCREVE NA LEITURA DE RESERVA (01/10). O ultimo tripulante do T-90AM #2
//     da RUS1 tem a cauda recortada ate o fim do bloco do tanque; com o quadro de abates da batalha 5
//     a varredura de reserva leu quatro "granadas" ali (as baixas inimigas, o ff ff, os abates), o
//     aparo cortou 12 B e a batalha 6 morreu a 5%. A leitura de reserva fica marcada
//     (`cabecaCerta: false`) e `reporGranadas` nao a toca.
{
  const tr = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/RUS1 BTT5 TRANSITION.bts';
  if (fs.existsSync(tr)) {
    const RO = await import(new URL('../tools/re/roster.mjs', import.meta.url).href);
    const cd = RO.caudasDoRoster(tr);
    const g = cd.filter((c) => c.nome === 'Gagarin' && c.cauda.length > 100)[0];
    const normais = cd.filter((c) => c.ok && c.cauda.length <= 100);
    ok(g && g.ok && g.cabecaCerta === false && normais.every((c) => c.cabecaCerta === true),
      `(a) a cauda do ultimo tripulante (${g && g.cauda.length} B) le pela reserva e fica marcada; as ${normais.length} caudas normais leem pela cabeca certa`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-gran-'));
    const out = path.join(tmp, 'g.bts');
    RO.reporGranadas(tr, out, { [g.indice]: {} });
    ok(!fs.existsSync(out) || RO.caudasDoRoster(out).find((c) => c.indice === g.indice).cauda.length === g.cauda.length,
      '(b) pedir "nenhuma granada" para ele nao corta nada do bloco do tanque');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 81. A CARGA DA MAQUINA E DA FORMACAO DELA (01/10). O mesmo "Truck (Ural-4320)" leva 82mm no pelotao
//     de morteiros 2B14 e nao leva no generico; a tabela por nome cortava a do morteiro (e Javelin do
//     Stryker, missil do BMP antiaereo...). `fabrica.json` traz `porFormacao` quando a carga muda.
{
  const fab = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'research', 'fabrica.json'), 'utf8'));
  const ural = fab.maquinas['RU|Truck (Ural-4320)'];
  const m = ural?.porFormacao?.['Mortar Platoon [medium]'];
  ok(m && m.carga['285'] === 40 && m.carga['286'] === 4 && !ural.carga['285'], `(a) Ural do pelotao de morteiros: ${JSON.stringify(m && m.carga)}; o geral: ${JSON.stringify(ural && ural.carga)}`);
}

// 82. OS BYTES DE EQUIPAMENTO DO HOMEM (02/10, FORMATO 130). `escreverBytesDoHomem` muda so o +7/+8
//     pedido, sem mudar tamanho, e recusa o bit 0x20 de +7 (gramatica da cauda).
{
  const ex = path.join(import.meta.dirname, '..', 'research', 'exemplos', 'e60_bit20.bts');
  if (fs.existsSync(ex)) {
    const RO = await import(new URL('../tools/re/roster.mjs', import.meta.url).href);
    const cd = RO.caudasDoRoster(ex);
    const i = cd.findIndex((c) => c.ok && c.cabecaCerta);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-eq-'));
    const out = path.join(tmp, 'e.bts');
    const r = RO.escreverBytesDoHomem(ex, out, { [i]: { mais8: 0x90, ligar7: 0x08 } });
    const depois = RO.caudasDoRoster(out)[i].cauda;
    let recusou = false; try { RO.escreverBytesDoHomem(ex, path.join(tmp, 'x.bts'), { [i]: { ligar7: 0x20 } }); } catch { recusou = true; }
    ok(r.homens === 1 && depois[8] === 0x90 && (depois[7] & 0x08) && depois.length === cd[i].cauda.length && recusou,
      `(a) +8 = 0x90 e flag 0x08 escritos em ${cd[i].nome}, mesmo tamanho; o 0x20 e recusado`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 83. OS LANCADORES DO VEICULO (02/10, FORMATO 131). (a) A fabrica: o M1126 do pelotao de fuzileiros
//     leva 2 AT4 + 1 Javelin, o da companhia so os AT4; o BMP-2M 4 RPG-26. (b) Num save de colheita,
//     `lerLancadores` le o M1126 do pelotao e `escreverLancadores` corta o Javelin com o bloco 3 B menor,
//     o paiol e a carga intactos (a conferencia esta dentro da funcao).
{
  const fab = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'research', 'fabrica.json'), 'utf8'));
  const st = fab.maquinas['US|Infantry Carrier Vehicle (M1126 Stryker)']?.lancadores;
  const bmp = fab.maquinas['RU|Infantry Fighting Vehicle (BMP-2M)']?.lancadores;
  const ord = (l) => [...(l || [])].sort().join(',');
  ok(st && ord(st.porFormacao?.['Platoon (Rifle)']?.itens) === '4/1,4/2,4/2' && ord(st.porFormacao?.['Company (Rifle)']?.itens) === '4/2,4/2' && ord(bmp?.itens) === '4/16,4/16,4/16,4/16',
    `(a) fabrica: M1126 pelotao ${ord(st?.porFormacao?.['Platoon (Rifle)']?.itens)}, companhia ${ord(st?.porFormacao?.['Company (Rifle)']?.itens)}; BMP-2M ${ord(bmp?.itens)}`);
  const fabSave = path.join(import.meta.dirname, '..', 'research', 'colheita_fab', 'ZZ FAB US 1 TRANSITION.bts');
  if (fs.existsSync(fabSave)) {
    const TV = await import(new URL('../tools/re/toe_veiculos.mjs', import.meta.url).href);
    const bl = TV.blocosDoSave(fabSave);
    const u = bl.unidades.find((x) => { const l = TV.lerLancadores(bl.exp, x); return l && ord(l.itens) === '4/1,4/2,4/2'; });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-lanc-'));
    const out = path.join(tmp, 'l.bts');
    const r = TV.escreverLancadores(fabSave, out, { [u.coreId]: ['4/2', '4/2'] });
    const depois = TV.blocosDoSave(out).unidades.find((x) => x.coreId === u.coreId);
    ok(r.veiculos === 1 && r.cresceu === -3 && depois.bytes.length === u.bytes.length - 3,
      `(b) core ${u.coreId}: Javelin cortado, bloco ${u.bytes.length} -> ${depois.bytes.length} B, paiol e carga conferidos`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 84. O EQUIPAMENTO NA TABELA DE FABRICA (02/10, FORMATO 130/131). Cada vaga traz `equip` (nv, demo em
//     cargas, laser, binoculo) e cada maquina a terceira lista: Squad (Rifle) americano com NV nos 9 e
//     um binoculo; engenheiro russo com cargas de demolicao; BMP-2M com 8 = 18.
{
  const fab = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'research', 'fabrica.json'), 'utf8'));
  const soma = (t, f) => Object.values(t?.vagas || {}).reduce((a, v) => a + (typeof v.equip?.[f] === 'number' ? v.equip[f] : v.equip?.[f] ? 1 : 0), 0);
  const rifle = fab.tipos['US|3845'];
  const eng = Object.values(fab.tipos).find((t) => t.exercito === 'RU' && t.nome === 'Squad (Engineer)');
  const bmp = fab.maquinas['RU|Infantry Fighting Vehicle (BMP-2M)'];
  ok(soma(rifle, 'nv') === 9 && soma(rifle, 'binoculo') === 1 && soma(eng, 'demo') > 0 && bmp?.terceira?.['8'] === 18,
    `(a) Squad (Rifle) US: NV ${soma(rifle, 'nv')}, binoculos ${soma(rifle, 'binoculo')}; engenheiro RU: ${soma(eng, 'demo')} cargas; BMP-2M terceira ${JSON.stringify(bmp?.terceira)}`);
}

// 85. A FUMACA DO VEICULO (02/10, E121). A terceira lista do bloco e a carga do lanca-fumaca (vazia, o jogo
//     apaga o Pop Smoke). `escreverTerceira` num save de colheita: a carga trocada no lugar (mesmo
//     tamanho) e a lista vazia (4 B a menos), lancadores/paiol/carga conferidos dentro da funcao; e a
//     regra liga o reset.
{
  const fabSave = path.join(import.meta.dirname, '..', 'research', 'colheita_fab', 'ZZ FAB RU 1 TRANSITION.bts');
  if (fs.existsSync(fabSave)) {
    const TV = await import(new URL('../tools/re/toe_veiculos.mjs', import.meta.url).href);
    const bl = TV.blocosDoSave(fabSave);
    const u = bl.unidades.find((x) => { const l = TV.lerLancadores(bl.exp, x); return l && l.terceira.length === 1; });
    const item = TV.lerLancadores(bl.exp, u).terceira[0].item;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-fumaca-'));
    const a = TV.escreverTerceira(fabSave, path.join(tmp, 'a.bts'), { [u.coreId]: [{ item, qtd: 5 }] });
    const b = TV.escreverTerceira(fabSave, path.join(tmp, 'b.bts'), { [u.coreId]: [] });
    const la = TV.blocosDoSave(path.join(tmp, 'a.bts')); const va = la.unidades.find((x) => x.coreId === u.coreId);
    ok(a.cresceu === 0 && b.cresceu === -4 && TV.lerLancadores(la.exp, va).terceira[0].qtd === 5 && rules().replacement?.resetSmoke === true,
      `(a) core ${u.coreId}: fumaca ${item} -> 5 no lugar, vazia com 4 B a menos; resetSmoke ligado`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 86. O INIMIGO OLHA PARA O JOGADOR (02/10, FORMATO 132). (a) `rumoPara` em [0, 2pi): leste 0, oeste pi,
//     nunca negativo (o leitor de registros recusa rumo < 0). (b) Numa batalha real, cada inimigo
//     presente reescrito aponta para o centro do jogador, os registros e as posicoes intactos (a
//     conferencia esta dentro de `escreverRumos`) e o ausente fica como estava.
{
  const RU = await import(new URL('../tools/re/rumo.mjs', import.meta.url).href);
  const a = RU.rumoPara({ x: 0, y: 0 }, { x: 10, y: 0 }), b = RU.rumoPara({ x: 0, y: 0 }, { x: -10, y: 0 }), c = RU.rumoPara({ x: 0, y: 0 }, { x: 0, y: -10 });
  ok(a === 0 && Math.abs(b - Math.PI) < 1e-9 && Math.abs(c - 1.5 * Math.PI) < 1e-9, `(a) rumoPara: leste ${a}, oeste ${b.toFixed(4)}, -y ${c.toFixed(4)}`);
  const btt = path.join(CAMPAIGNS_DIR, 'RUS1', 'battles', '06', 'battle.btt');
  if (fs.existsSync(btt)) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-rumo-'));
    const out = path.join(tmp, 'f.btt');
    const us = RU.lerRumos(btt);
    const alvo = RU.centroide(us.filter((u) => u.lado === 'vermelho'));
    RU.escreverRumos(btt, out, (u, e) => (u.lado === 'azul' && !u.ausente ? RU.rumoPara(e, alvo) : null));
    const depois = RU.lerRumos(out).filter((u) => u.lado === 'azul');
    const vivos = depois.filter((u) => !u.ausente);
    const mira = vivos.every((u) => u.elementos.every((e) => { const d = Math.atan2(alvo.y - e.y, alvo.x - e.x); return Math.cos(d - e.rumo) > 0.999; }));
    const ausentesIntactos = depois.filter((u) => u.ausente).every((u) => u.elementos.every((e) => e.rumo === 0));
    ok(vivos.length > 0 && mira && ausentesIntactos, `(b) ${vivos.length} inimigos presentes miram o centro do jogador; ausentes em 0`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  ok(rules().defense?.faceThePlayer?.on === true && rules().defense.faceThePlayer.unit === 'rad' && rules().defense.faceThePlayer.sense === 1, '(c) faceThePlayer ligado, radianos, anti-horario (E122)');
}

// 87. ANTIAEREO NA DEFESA (02/10). (a) A bateria antiaerea nao conta no limite de fontes: com o SPAAG
//     liberado, Tunguska/Strela entram em parte das defesas russas da batalha 12 (antes: 0 em 240).
//     (b) MANPADS liberados a partir da batalha 4 e SPAAG a partir da 7 (decisao do autor).
{
  const DF = await import(new URL('./src/defense.mjs', import.meta.url).href);
  const quieto = { event() {}, read() {}, wrote() {}, step: async (_n, _d, f) => f() };
  let comAA = 0;
  for (let s = 0; s < 12; s++) { const p = DF.planDefense({ nation: 'RU', nations: ['RU'], battleNumber: 12, rules: R, seed: 1000 + s * 7, profile: 'aberto', effort: 1, kind: null, trace: quieto }); if (p.byRole.aa) comAA++; }
  ok(comAA > 0, `(a) SPAAG em ${comAA} de 12 defesas russas da batalha 12`);
  const t3 = DF.tierOf(3, R), t4 = DF.tierOf(4, R), t7 = DF.tierOf(7, R);
  // 11/10 (autor): recon, morteiro e MANPADS desde o tier 1
  const t1 = DF.tierOf(1, R);
  ok(['recon', 'manpads', 'mortar_off'].every((r) => t1.unlocks.includes(r)) && t4.unlocks.includes('manpads') && t7.unlocks.includes('aa') && !t3.unlocks.includes('aa') && !t4.unlocks.includes('aa'), '(b) recon, MANPADS e morteiro fora do mapa desde a batalha 1, SPAAG desde a 7');
  // 11/10 (autor): morteiro inimigo nunca no mapa
  const noMapa = ['Medium Mortar Team', 'Heavy Mortar Squad', 'Mortar Carrier (2S24)', 'Mortar Carrier (M1129 Stryker)', 'Multipurpose Vehicle (M1152 HMMWV (Heavy Mortar))'].filter((n) => DF.bucketOf(n, roleOf(n, false, R), R) !== 'never');
  const fora = ['3 x 82mm Mortar (2B14)', '2 x 60mm Mortar (M224A1)'].filter((n) => DF.bucketOf(n, roleOf(n, false, R), R) !== 'offMap');
  // e o morteiro organico russo que o catalogo chama de "Infantry Fighting Vehicle (BMP-3M)" [58,0] (UKR3 b3, 11/10)
  let comMorteiro = 0;
  for (const [nat, nats] of [['US', ['US', 'UKR']], ['RU', ['RU']]]) for (let s = 0; s < 12; s++) for (const b of [3, 9]) {
    const p = DF.planDefense({ nation: nat, nations: nats, battleNumber: b, rules: R, seed: 3000 + s * 11, profile: 'misto', effort: 1, kind: null, trace: quieto });
    if ((p.kept || []).some((k) => (/Mortar/.test(k.name) && !/^\d+ x /.test(k.name)) || /BMP-3M\)$/.test(k.name))) comMorteiro++;
  }
  ok(!noMapa.length && !fora.length && !comMorteiro, `(c) morteiro inimigo so fora do mapa: ${noMapa.length} no mapa ainda compraveis, ${fora.length} baterias fora do lugar, ${comMorteiro} de 48 defesas (US e RU) com morteiro no mapa ou o tubo organico`);
}

// 88. A JUNCAO NA FRONTEIRA DE 256 (03/10, bateria de carga). `compor2` contava os zeros de cabeca da
//     peca seguinte ate o primeiro byte nao-zero; com os ids ja renumerados, um primeiro registro de id
//     512/768 (byte baixo 0) roubava um zero do enchimento ("7 zeros ate o id seguinte, regra pede 8") ou
//     o primeiro byte do id no primeiro vermelho ("K_verm 512"). O caso D013 da bateria (a Section (Supply)
//     russa contra a defesa americana da batalha 3) caia nisso; agora a batalha sai e passa a checagem.
{
  const BL = await import(new URL('../tools/re/bateria/lib.mjs', import.meta.url).href);
  let m = null, erro = null;
  try { m = await BL.montar({ picks: [{ source: 'RU - Section (Supply).btt', nation: 'RU', keep: ['0', '0.0', '0.1', '0.2'], xp: {} }], armies: ['RU'], enemySide: 'US', battleNumber: 3, effort: 1, seed: 20261004 }); }
  catch (e) { erro = e.message; }
  const v = m ? BL.veredito(BL.conferirBtt(m.bttOut)) : null;
  ok(m && v.veredito !== 'FALHA', `(a) D013: ${erro ? 'falhou: ' + erro.slice(0, 120) : `batalha montada e conferida (${v.veredito})`}`);
  if (m) fs.rmSync(m.dir, { recursive: true, force: true });
}

// 89. O TETO DE UNIDADES EM CAMPO (03/10, E125). A bateria de carga mediu: ate 959 unidades da forca em campo o
//     jogo carrega; 1.035 deu crash e 1.285+ Out of memory. (a) `fieldCapCheck` diz ok/aviso/acima. (b) Uma
//     forca de colheita com mais de 950 unidades e recusada pelo createCampaign ANTES de gravar qualquer coisa.
{
  const { fieldCapCheck, createCampaign: criar, dirOf: pasta } = await import(new URL('./src/campaign.mjs', import.meta.url).href);
  const a = fieldCapCheck(800, R), b = fieldCapCheck(920, R), c = fieldCapCheck(1000, R);
  ok(a.level === 'ok' && b.level === 'warn' && c.level === 'over' && R.fieldCap.max === 950, `(a) 800 ${a.level}, 920 ${b.level}, 1000 ${c.level}`);
  const forms = libFormations('US', { rules: R }).filter((f) => !f.trp).map((f) => ({ source: f.file, nation: 'US', keep: todasAsChaves(formationTree(f.file)), xp: {} }))
    .map((p) => ({ p, n: priceOfPicks([p], 'US', R)[0] })).filter((x) => !x.n.uncovered.length && x.n.onMapUnits > 0).sort((x, y) => y.n.units - x.n.units);
  const picks = []; let soma = 0; for (const x of forms) { if (soma > 1000) break; picks.push(x.p); soma += x.n.units; }
  let erro = null; try { await criar({ name: 'ZZ TETO 89', armies: ['US'], enemySide: 'RU', picks, harvest: true }); } catch (e) { erro = e.message; }
  ok(/runs out of memory above about 950/.test(erro || '') && !fs.existsSync(pasta('ZZ-TETO-89')), `(b) ${soma} unidades recusadas sem gravar: ${String(erro).slice(0, 80)}`);
}

// 90. OS TANQUES ANTES DAS ESQUADRAS (03/10). A batalha 9 da RUS1 (inimigo americano, tier 3, mapa aberto)
//     tinha 7.632 cr para tanques e comprou ZERO: os lotes de esquadras vinham antes e ocupavam as 5 fontes
//     com batalhoes Stryker e de infantaria, e nenhuma fonte com tanque cabia mais. Com o inimigo americano
//     isso acontecia em 72 de 810 defesas dos tiers 2-4. Os tanques sao comprados antes das esquadras.
{
  const DF = await import(new URL('./src/defense.mjs', import.meta.url).href);
  const p = DF.planDefense({ nation: 'US', nations: ['US', 'UKR'], battleNumber: 9, rules: R, seed: 827831606, profile: 'aberto', effort: 1, kind: null });
  let zero = 0;
  for (let s = 0; s < 20; s++) { const q = DF.planDefense({ nation: 'US', nations: ['US', 'UKR'], battleNumber: 9, rules: R, seed: 1000 + s * 7, profile: 'aberto', effort: 1, kind: null }); if (q.budgets.tanks > 0 && !q.spent.tanks) zero++; }
  ok(p.count.tanks > 0 && zero === 0, `(a) RUS1 b9: ${p.count.tanks} tanques (${p.spent.tanks} de ${p.budgets.tanks} cr); defesas americanas b9 sem tanque com verba: ${zero}/20`);
}

// 91. AVAILABILITY (04/10, autor): a coluna da aba Formacoes diz quantas copias de uma formacao a
//     campanha pode ter. Os observadores (Air Controller, Forward Observer) e o Zala vao a 3; o resto fica
//     em 1. Copia vendida nao conta. E a segunda copia RECRUTADA entra pelo enxerto sem mexer na primeira.
{
  const { checkAvailability, availabilityOf } = await import(new URL('./src/campaign.mjs', import.meta.url).href);
  const AC = 'RU - Air Controller Section.btt', BAT = 'RU - Tactical Group (Battalion [BMP]).btt';
  const tenta = (picks) => { try { checkAvailability(picks, R); return null; } catch (e) { return e.message; } };
  ok(availabilityOf(AC, R) === 3 && availabilityOf(BAT, R) === 1 && availabilityOf('RU - (Zala 421-08).btt', R) === 3,
    `(a) teto: Air Controller ${availabilityOf(AC, R)}, batalhao ${availabilityOf(BAT, R)}, Zala ${availabilityOf('RU - (Zala 421-08).btt', R)}`);
  const e1 = tenta([{ source: AC }, { source: AC }, { source: AC }]), e2 = tenta([{ source: AC }, { source: AC }, { source: AC }, { source: AC }]);
  const e3 = tenta([{ source: BAT }, { source: BAT }]), e4 = tenta([{ source: BAT, sold: true }, { source: BAT }]), e5 = tenta([{ source: BAT }, { source: BAT, sf: true }]);
  ok(!e1 && /only 3 copies/.test(e2 || '') && /only 1 copy/.test(e3 || '') && !e4 && !e5,
    `(b) 3 Air Controller ok; 4 recusa (${String(e2).slice(0, 50)}); 2 batalhoes recusa; vendida e Special Forces nao contam`);
  // (c) a segunda copia recrutada: enxerto sobre a primeira, nenhum core id movido, forca estruturalmente valida
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-avail-'));
  const mapa = mapFile(mapPool(1, [], 0)[0]);
  const trace = { event() {}, read() {}, wrote() {}, async step(n, x, f) { return f(); } };
  const { checkForce } = await import('./src/re.mjs');
  const p0 = priceOfPicks([{ source: AC, nation: 'RU', keep: todasAsChaves(formationTree(AC)), xp: {} }], 'RU', R)[0];
  const core0 = path.join(tmp, 'core.btt');
  await buildCoreForce({ picks: [p0], nation: 'RU', enemy: 'US', mapFile: mapa, workDir: tmp, out: core0, trace });
  const antes = unitDirectory(core0);
  const saida = path.join(tmp, 'grown.btt');
  const grown = await growCoreForce({ picks: [p0], newPicks: [p0], nation: 'RU', enemy: 'US', mapFile: mapa, workDir: tmp, out: saida, before: antes,
    present: antes.filter((u) => u.present).map((u) => u.coreId), dropped: [], coreFile: core0, trace });
  const depois = grown.units;
  const porId = new Map(antes.map((u) => [u.coreId, u]));
  const mexidos = depois.filter((u) => porId.has(u.coreId) && porId.get(u.coreId).name !== u.name);
  const chk = checkForce(saida);
  ok(depois.length === antes.length * 2 && !mexidos.length && !(chk.erros || chk.errors || []).length,
    `(c) segunda copia recrutada: ${antes.length} -> ${depois.length} unidades, ${mexidos.length} core id movidos, ${(chk.erros || chk.errors || []).length} erros estruturais`);
}

// 105. O BYTE ATRAS DE UM TOKEN E LITERAL MESMO SENDO O ESCAPE (05/10/2026). O jogo grava `esc N esc` para N+1 copias
//      do proprio byte de escape: no Town-Water (1504 X 1008) 275 Assault o escape e 'y' e o rotulo "Zhorstokyy" vem como
//      `k 79 01 79 12`. Lido como dois tokens, o mapa ganhava 18 bytes inventados e a regiao de IA nao confirmava.
{
  const E = await import(new URL('../tools/re/escape.mjs', import.meta.url).href);
  const esc = 0x79, bruto = Buffer.from([0x6b, esc, 0x01, esc, 0x12, 0x13]);
  const r = E.decodificar(bruto, esc, 0, bruto.length, []); const c = E.expandir(r.cru, r.tokens).completo;
  const re = E.codificarComoJogo(Buffer.from([1, 1, esc, esc, esc, esc, esc, 2]), esc); const r2 = E.decodificar(re, esc, 2, re.length, []);
  const volta = E.expandir(r2.cru, r2.tokens).completo;
  const { lerMapa } = await import(new URL('../tools/re/mapa.mjs', import.meta.url).href);
  const tw = lerMapa(path.join(import.meta.dirname, '..', 'assets', 'qb_attack', 'Town-Water (1504 X 1008) 275 Attack CMBSRL.btt'));
  ok(c.equals(Buffer.from([0x6b, esc, esc, 0x12, 0x13])) && volta.equals(Buffer.from([1, 1, esc, esc, esc, esc, esc, 2])) && tw.iaConfere && tw.landmarks.some((l) => l.nome === 'Zhorstokyy'),
    `(105) token + escape: decodifica ${[...c].map((b) => b.toString(16)).join(' ')}; corrida de 5 escapes ida e volta ${volta.equals(Buffer.from([1, 1, esc, esc, esc, esc, esc, 2]))}; Town-Water 275 Assault iaConfere ${tw.iaConfere}, rotulo "${tw.landmarks[0]?.nome}"`);
}

// 106. O CODIFICADOR DO TRANSPLANTE TAMBEM (05/10/2026, bateria m2 M25). `codificar({cru, tokens})`, o caminho do
//      `transplantar` do gerador, escrevia `esc N esc 00` atras de um token; o decodificador corrigido le `esc N esc` e o
//      `00` sobrava: o Town-Water 275 Assault saia do gerador com a regiao de IA deslocada e o app recusava o mapa
//      ("the transplant damaged the map"). Ida e volta do fluxo de todo mapa do pacote: mesmo cru, mesmos tokens.
{
  const E = await import(new URL('../tools/re/escape.mjs', import.meta.url).href);
  const { ler } = await import(new URL('../tools/re/transplante.mjs', import.meta.url).href);
  let n = 0; const ruins = [];
  for (const t of ['attack']) {
    const dir = path.join(import.meta.dirname, '..', 'assets', 'qb_' + t);
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.btt'))) {
      const A = ler(path.join(dir, f)); const buf = E.codificar({ cru: A.cru, tokens: A.tokens }, A.esc);
      const B = E.decodificar(buf, A.esc, 0, buf.length, []); n++;
      if (!B.cru.equals(A.cru) || B.tokens.length !== A.tokens.length || B.tokens.some((k, i) => k.pos !== A.tokens[i].pos || k.cod !== A.tokens[i].cod)) ruins.push(f);
    }
  }
  // o pacote = a selecao do autor, um arquivo por mapa (23/10: so a versao Attack)
  const noPacote106 = 1 * Object.values(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'data', 'mapas.json'), 'utf8')).tiers).flat().length;
  ok(n === noPacote106 && !ruins.length, `(106) codificar do transplante: ${n - ruins.length} de ${n} mapas do pacote voltam iguais${ruins.length ? ' — ' + ruins.slice(0, 3).join(', ') : ''}`);
}

// 107. O QUE A LOJA NAO VENDE SOZINHO (05/10/2026, item 9; E119, B013). O BMP-3M russo e o Breach Team ucraniano nao tem
//      dados de fabrica (o jogo nao grava homem nem estado nos blocos deles) e o BMP-3M nem se sintetiza como anexo: fora
//      do menu de veiculos avulsos, e um anexo deles pedido direto ao servidor e recusado com a frase da regra.
{
  const { extrasOf } = await import('./src/campaign.mjs');
  const semLista = JSON.parse(JSON.stringify(R)); delete semLista.singleVehicles.allow;
  const ru = singleVehicles(['RU'], { rules: semLista }), ua = singleVehicles(['US', 'UKR'], { rules: semLista });
  const tem = (m, t) => m.some((v) => v.type && v.type[0] === t[0] && v.type[1] === t[1]);
  const f = libFormations('RU', { rules: R }).find((x) => !x.trp); const tree = formationTree(f.file);
  const raiz = tree.roots.find((r) => r.isFormation);
  let recusa = '';
  try { extrasOf({ source: f.file, nation: 'RU', extras: [{ tipo: 'Infantry Fighting Vehicle (BMP-3M)', key: raiz.key, type: [58, 0] }] }, tree, 'RU', R); } catch (e) { recusa = e.message; }
  ok(!tem(ru, [58, 0]) && tem(ru, [60, 5]) && !tem(ua, [106, 14]) && /not sold as a single unit/.test(recusa),
    `(107) avulsos: BMP-3M fora ${!tem(ru, [58, 0])} (BMP-3 fica ${tem(ru, [60, 5])}), Breach Team fora ${!tem(ua, [106, 14])}; anexo direto: "${recusa.slice(0, 60)}"`);
  // 18/10 (autor): a lista de anexos. US + UKR: os quatro americanos e o Ural; RU: o Ural; o resto e recusado no servidor.
  const nomes = (m) => m.map((v) => v.name).sort().join(' | ');
  const usUkr = nomes(singleVehicles(['US', 'UKR'], { rules: R })), soRu = nomes(singleVehicles(['RU'], { rules: R }));
  const esperadoUA = ['Infantry Carrier Vehicle (M1126 Stryker (Mk19))', 'Infantry Carrier Vehicle (M1126 Stryker)', 'Multipurpose Vehicle (M1152 HMMWV)', 'Truck (LMTV (Armored))', 'Truck (Ural-4320)'].sort().join(' | ');
  let recusaT90 = '';
  try { extrasOf({ source: f.file, nation: 'RU', extras: [{ tipo: 'Main Battle Tank (T-90AM)', key: raiz.key }] }, tree, 'RU', R); } catch (e) { recusaT90 = e.message; }
  const aceitaUral = (() => { try { return extrasOf({ source: f.file, nation: 'RU', extras: [{ tipo: 'Truck (Ural-4320)', key: raiz.key }] }, tree, 'RU', R).length === 1; } catch { return false; } })();
  ok(usUkr === esperadoUA && soRu === 'Truck (Ural-4320)' && /not sold as a single vehicle/.test(recusaT90) && aceitaUral,
    `(107) lista de anexos: US+UKR [${usUkr}], RU [${soRu}]; T-90AM recusado ("${recusaT90.slice(0, 50)}"), Ural aceito`);
}

// 103. O ESCRITOR DA REGIAO DE IA (05/10/2026, tools/re/ia_escrever.mjs) grava o que o leitor le: decodificar e
//      codificar de volta da byte a byte o mesmo `resto` em todo mapa do pacote que o escritor de mapas aceita (os
//      planos, as entradas com esperas, os ponteiros, os trailers, a cauda e as 30 vagas de objetivo).
// 104. A DOUTRINA DO AUTOR NO SMALL VILLAGE 019r (tools/re/ia_doutrina.mjs): o plano autoral gravado numa copia le de
//      volta com 16 grupos no Plan 1 azul (Used Frequently), os 5 triggers novos nas vagas azuis 3..7 (A.I. Trigger
//      enemy, Known to Neither), as esperas nos grupos certos (faixas A e C esperam o trigger B; a faixa B espera A+C;
//      reserva, AA e infantaria dos objetivos esperam o do majoritario), Occupy = Mixed em toda entrada, toda zona de
//      Setup dentro da pintura azul, e o mapa continua confirmando a regiao de IA; os planos vermelhos ficam intactos.
{
  const IE = await import(new URL('../tools/re/ia_escrever.mjs', import.meta.url).href);
  const { pecas } = await import(new URL('../tools/re/mapa_escrever.mjs', import.meta.url).href);
  const dirs = ['attack'].map((t) => path.join(import.meta.dirname, '..', 'assets', 'qb_' + t));
  let iguais = 0, lidos = 0; const difs = [];
  for (const dir of dirs) for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.btt'))) {
    const arq = path.join(dir, f); let p; try { p = pecas(arq); } catch { continue; }   // o escritor de mapas recusa (Town-Water 275 Assault)
    lidos++; const d = IE.decodificar(arq); if (IE.codificar(d).equals(p.resto)) iguais++; else difs.push(f);
  }
  const noPacote103 = 1 * Object.values(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'data', 'mapas.json'), 'utf8')).tiers).flat().length;
  ok(lidos >= noPacote103 - 1 && iguais === lidos, `(103) identidade da regiao de IA e das vagas: ${iguais}/${lidos} mapas do pacote${difs.length ? ' — DIFEREM: ' + difs.slice(0, 3).join(', ') : ''}`);

  const DOUT = await import(new URL('../tools/re/ia_doutrina.mjs', import.meta.url).href);
  const { lerGatilhos } = await import(new URL('../tools/re/gatilhos.mjs', import.meta.url).href);
  const { lerPlanos } = await import(new URL('../tools/re/ia.mjs', import.meta.url).href);
  const { lerMapa } = await import(new URL('../tools/re/mapa.mjs', import.meta.url).href);
  const base = path.join(import.meta.dirname, '..', 'assets', 'qb_attack', 'Small Village (554 X 848) 019r Attack CMBSRL.btt');
  const r = DOUT.aplicarDoutrina(base);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-ia-'));
  const saida = path.join(tmp, 'sv.btt'); IE.gravar(base, saida, r.d);
  const m = lerMapa(saida), pl = lerPlanos(saida), g = lerGatilhos(saida), orig = lerPlanos(base);
  const p1 = pl.planos[0];
  const trig = g.objetivos.azul.slice(2, 7);
  const espera = (gr) => { const e = g.planos.find((q) => q.lado === 'azul' && q.plano === 1).grupos.find((q) => q.grupo === gr)?.entradas[0]?.espera; return e ? e.i + 1 : null; };
  const azulPintado = new Set(); for (const l of (await import(new URL('../tools/re/zonas.mjs', import.meta.url).href)).pintura(base).azul) for (const t of l.tiles) azulPintado.add(t.join());
  const foraDaPintura = p1.grupos.reduce((s, gr) => s + gr.setup.filter((t) => !azulPintado.has(t.join())).length, 0);
  const d2 = IE.decodificar(saida); const occupy = d2.azul[0].slots.flat().filter((e) => e.tiles.length).every((e) => e.prefixo[3] === IE.OCCUPY.Mixed);
  // pressao (autor, 05/10): blindados da frente e das faixas saem na metade da batalha (45 min -> 22:30 = 1350 s) mesmo sem
  // trigger; a reserva do majoritario so sai pelo trigger
  const ent = (gr) => g.planos.find((q) => q.lado === 'azul' && q.plano === 1).grupos.find((q) => q.grupo === gr).entradas;
  const janelaOk = ent(5)[0].a === 1350 && ent(5).length === 2 && [6, 7, 8].every((x) => ent(x)[0].b === 1350) && ent(9)[0].b === 3 * 3600;
  const vermIntacto = JSON.stringify(pl.planos.slice(5).map((q) => q.grupos.map((x) => [x.grupo, x.setup.length, x.ordens.map((o) => o.length)]))) === JSON.stringify(orig.planos.slice(5).map((q) => q.grupos.map((x) => [x.grupo, x.setup.length, x.ordens.map((o) => o.length)])));
  ok(m.iaConfere && pl.confiavel && p1.uso === 3 && p1.grupos.length === 16 && trig.every((o) => o.tipo === 7 && o.known === 3 && o.n > 0)
    && espera(6) === 4 && espera(8) === 4 && espera(7) === 6 && [9, 10].every((x) => espera(x) === 7) && [1, 2, 3, 4, 5, 11, 12, 13, 14, 15, 16].every((x) => espera(x) === null)
    && occupy && foraDaPintura === 0 && vermIntacto && janelaOk,
    `(104) doutrina no Small Village: ${p1.grupos.length} grupos, triggers ${trig.map((o) => `"${o.nome.trim()}" ${o.n}t`).join(', ')}; esperas G6/G8->Obj ${espera(6)}, G7->Obj ${espera(7)}, G9/G10->Obj ${espera(9)}, G14/G15 parados ${espera(14) === null && espera(15) === null}; Mixed ${occupy}; ${foraDaPintura} tiles de setup fora da pintura; vermelho intacto ${vermIntacto}; pressao dos blindados as 22:30 ${janelaOk}`);
}

// 102. OS MAPAS DO PACOTE SAO A SELECAO DO AUTOR (04/10/2026). Todo mapa de app/data/mapas.json entra no sorteio
//      na versao Attack (23/10: um mapa so), com o tier dele (nao o de area do censo); o arquivo existe no pacote com o hash do censo; a
//      pasta de cada tipo nao tem nada fora da selecao; e o app nunca aponta para a pasta do jogo.
{
  const { mapCensus, mapSelection, mapFile, mapKey } = await import('./src/catalog.mjs');
  const crypto = await import('node:crypto');
  const sel = mapSelection(); const lista = mapCensus();
  const faltam = [];
  const autorais = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'data', 'planos_ia.json'), 'utf8')).mapas;   // plano de IA trocado: o hash e o daqui
  const shaEsperado = (m) => autorais[path.relative(path.join(import.meta.dirname, '..', 'assets'), mapFile(m)).split(path.sep).join('/')]?.sha256 || m.sha256;
  for (const [k, tier] of sel) for (const tipo of ['Attack']) {
    const m = lista.find((x) => x.tipo === tipo && mapKey(x.f) === k);
    if (!m) faltam.push(`${k} ${tipo}: fora do sorteio`);
    else if (m.tier !== tier) faltam.push(`${k} ${tipo}: tier ${m.tier} em vez de ${tier}`);
    else if (!fs.existsSync(mapFile(m))) faltam.push(`${k} ${tipo}: arquivo ausente`);
    else if (crypto.createHash('sha256').update(fs.readFileSync(mapFile(m))).digest('hex') !== shaEsperado(m)) faltam.push(`${k} ${tipo}: hash diferente do censo`);
  }
  const sobra = [];
  for (const tipo of ['attack']) for (const f of fs.readdirSync(path.join(import.meta.dirname, '..', 'assets', 'qb_' + tipo)).filter((f) => /\.btt$/i.test(f))) if (!sel.has(mapKey(f))) sobra.push(`qb_${tipo}/${f}`);
  for (const velha of ['qb_probe', 'qb_assault']) if (fs.existsSync(path.join(import.meta.dirname, '..', 'assets', velha))) sobra.push(velha + ' ainda existe');
  const porTier = {}; for (const m of lista) porTier[m.tier] = (porTier[m.tier] || 0) + 1;
  const foraDoPacote = lista.filter((m) => !path.resolve(mapFile(m)).startsWith(path.resolve(import.meta.dirname, '..', 'assets')));
  const semSufixo = [];
  for (const tipo of ['attack']) for (const f of fs.readdirSync(path.join(import.meta.dirname, '..', 'assets', 'qb_' + tipo)).filter((f) => /.btt$/i.test(f))) if (!/ CMBSRL.btt$/.test(f)) semSufixo.push(f);
  if (semSufixo.length) faltam.push('sem o sufixo CMBSRL: ' + semSufixo.slice(0, 3).join(', '));
  ok(!faltam.length && !sobra.length && lista.length === sel.size && !foraDoPacote.length && !('useGameMaps' in paths()) && !('mapsFromGame' in paths()),
    `(102) ${sel.size} mapas, um arquivo cada (Attack) = ${lista.length} no sorteio, por tier ${JSON.stringify(porTier)}, todos no pacote com o hash do censo e o sufixo CMBSRL${faltam.length ? '; FALTAM: ' + faltam.join('; ') : ''}${sobra.length ? '; SOBRAM: ' + sobra.join(', ') : ''}`);
}

// 108. AS INVARIANTES DO ESTADO (05/10/2026, varredura de QA fase 0; app/src/estado.mjs). Toda campanha local passa;
//      um estado sintetico quebrado de seis jeitos da as seis frases.
{
  const { invariantesDoEstado } = await import('./src/estado.mjs');
  const dir = path.join(CAMPAIGNS_DIR); const ruins = []; let n = 0;
  for (const d of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const f = path.join(dir, d, 'state.json'); if (!fs.existsSync(f)) continue;
    n++; const e = invariantesDoEstado(JSON.parse(fs.readFileSync(f, 'utf8'))); if (e.length) ruins.push(`${d}: ${e[0]}`);
  }
  const quebrado = { stage: 'play', credits: -5, pending: { x: 1 }, battleNumber: 3, history: [{ save: 'a.bts' }], seenSaves: [], coreUnits: 3,
    units: [{ coreId: 1, present: true }, { coreId: 2, present: true }], standDown: [2], lost: [9] };
  const e = invariantesDoEstado(quebrado);
  const espera = [/negative/, /pending/, /coreUnits/, /lost names/, /stood down but present/, /history has 1/, /not in seenSaves/];
  ok(!ruins.length && espera.every((r) => e.some((m) => r.test(m))),
    `(108) invariantes: ${n - ruins.length} de ${n} campanhas locais passam${ruins.length ? ' — ' + ruins[0] : ''}; o estado quebrado da ${e.length} frases (${espera.filter((r) => e.some((m) => r.test(m))).length} de ${espera.length} esperadas)`);
}

// 109. A COTACAO (05/10/2026, varredura de QA fase 0; campaign.quoteApply e POST /quote). Numa campanha local no
//      resultado: nao muda o estado, cobra o mesmo que o Apply cobraria (homens x preco por homem), recusa com a mesma
//      frase do Apply um id que nao esta no arsenal e um gasto acima do que ha. Sem campanha no resultado, pula.
{
  const { quoteApply, rules: regras } = await import('./src/campaign.mjs');
  const dir = path.join(CAMPAIGNS_DIR);
  const alvo = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).map((d) => path.join(dir, d, 'state.json')).filter((f) => fs.existsSync(f))
    // na ultima batalha nada se compra, e num caminho sem a proxima escolhida o Apply recusa: essas nao servem (11/10)
    .map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))).find((st) => st.stage === 'result' && st.pending?.result
      && !st.pending.result.income?.step?.campaignOver && st.pending.result.battle < (regras().battlesToWin || 12) && (!st.path || st.path.chosen));
  if (!alvo) console.log('ok    (109) cotacao: nenhuma campanha local no resultado (pulado)');
  else {
    const Rg = regras(); const antes = JSON.stringify(alvo);
    const vazia = quoteApply(alvo, {}, Rg);
    const homens = (alvo.pending.result.casualtiesToBuy || []).map((c) => c.index);
    const comHomens = quoteApply(alvo, { replaceIndices: homens }, Rg);
    const recusa = (body) => { try { quoteApply(alvo, body, Rg); return ''; } catch (e) { return e.message; } };
    const naoDorme = recusa({ purchaseCoreIds: [999999] });
    const caro = recusa({ purchaseCoreIds: alvo.units.filter((u) => !u.present && !(alvo.lost || []).includes(u.coreId)).map((u) => u.coreId) });
    const porHomem = Rg.replacement.creditsPerMan;
    ok(JSON.stringify(alvo) === antes && vazia.spend === 0 && vazia.available === alvo.credits + vazia.paid
      && comHomens.spend === comHomens.replaceIndices.length * porHomem && /not dormant in the arsenal/.test(naoDorme) && (!caro || /are available|special forces|destroyed|last battle|only reads the first/.test(caro)),
      `(109) cotacao em ${alvo.slug} b${alvo.pending.result.battle}: estado intacto ${JSON.stringify(alvo) === antes}; vazia gasta ${vazia.spend} de ${vazia.available}; ${comHomens.replaceIndices.length} homens = ${comHomens.spend} cr; id fora: "${naoDorme.slice(0, 50)}"; arsenal inteiro: "${(caro || 'cabe').slice(0, 60)}"`);
  }
}

// 110. O MAPA QUE O JOGO NAO CARREGA FICA FORA DO SORTEIO (05/10/2026, E139). O Huge Rough-Water-Town 026r dava Out of
//      memory no briefing com 3 unidades e ficou em rules.maps.memoryExclude. 12/10: a causa era a marca de cenario
//      (E175); sem ela o autor carregou no jogo uma batalha minima e a da campanha, e a lista ficou vazia; depois ele
//      descartou o 026r da selecao (grande demais, em espera). O teste agora, sobre o maior mapa que ficou (o Asintorf
//      091): com a lista vazia ele e sorteavel; com ele na lista (regras injetadas) sai do sorteio.
{
  const { mapPool, mapCensus, mapKey, loadsInGame } = await import('./src/catalog.mjs');
  const nome = 'Huge Asintorf-Town (2400 X 2000) 091'; const k = mapKey(nome + ' Assault.btt');
  const doMapa = mapCensus().filter((m) => mapKey(m.f) === k);
  const sorteaveis = [1, 2, 3, 4].flatMap((t) => mapPool(t)).filter((m) => mapKey(m.f) === k).length;
  const total = [1, 2, 3, 4].flatMap((t) => mapPool(t)).length;
  const Rx = { maps: { memoryExclude: [nome] } };
  const barrados = doMapa.filter((m) => !loadsInGame(m, Rx)).length;
  ok(doMapa.length === 1 && sorteaveis === 1 && total === mapCensus().length && barrados === 1, `(110) lista de memoria: ${nome} ${doMapa.length} no censo, ${sorteaveis} no sorteio (sorteio com ${total} de ${mapCensus().length}); na lista sairia: ${barrados}/1`);
}
// 110b. O PERFIL DO AUTOR (12/10/2026, mapas.json > perfis) manda sobre o do censo nas tres versoes; os outros mapas
//      continuam com o do censo.
{
  const { mapCensus, mapKey, mapProfiles } = await import('./src/catalog.mjs');
  const P = mapProfiles(); const C = mapCensus(); const errados = [];
  for (const [k, p] of P) { const v = C.filter((m) => mapKey(m.f) === k); if (v.length !== 1 || v.some((m) => m.perfil !== p || !m.perfilCenso)) errados.push(k); }
  const outros = C.filter((m) => !P.has(mapKey(m.f))).filter((m) => m.perfilCenso !== undefined).length;
  // (19/10: o autor acrescenta perfis — o Small Hills-Forest 023r virou aberto; a conta e a do arquivo, nao um numero fixo)
  const doArquivo = Object.keys(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'data', 'mapas.json'), 'utf8')).perfis || {}).length;
  ok(P.size === doArquivo && P.size >= 9 && !errados.length && !outros, `(110b) perfis do autor: ${P.size} mapas com o perfil dele${errados.length ? ' — ERRADOS: ' + errados.join(', ') : ''}; ${outros} outros mexidos`);
}

// 111. A EQUIPE DE CADA VAGA E O LUGAR DA UNIDADE NA FORMACAO (05/10/2026, E141 — a causa do E83). No roster que o app
//      monta, as irmas do mesmo tipo saem numeradas pelo indice do registro (b8 >> 2): o comando do pelotao de morteiros
//      0, as tres equipes 1, 2, 3, os tres Ural 1, 2, 3; a esquadra fica com as equipes A/B dela (1 e 2). E um save com as
//      vagas do jeito antigo (a batalha 1 do E7, quando existe em research/e83) e renumerado so nos blocos em branco.
{
  const RC = await import('../tools/re/roster_cam.mjs');
  const { buildCoreForce } = await import('./src/forge.mjs');
  const R = rules(); const TG = 'RU - Tactical Group (Battalion [BMP]).btt';
  const tree = formationTree(TG); const no = (k) => { const n = []; const anda = (x) => { if (x.key === k || x.key.startsWith(k + '.')) n.push(x.key); (x.children || []).forEach(anda); }; tree.roots.forEach(anda); return n; };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e141-')); const core = path.join(dir, 'core.btt');
  const picks = priceOfPicks([{ source: TG, nation: 'RU', keep: no('0.11.4'), xp: {} }, { source: TG, nation: 'RU', keep: no('0.8.2'), xp: {} }], 'RU', R);
  await buildCoreForce({ picks, nation: 'RU', enemy: 'US', mapFile: mapFile(mapCensus().find((m) => m.tipo === 'Attack')), workDir: path.join(dir, 'w'), out: core, trace: new Trace(path.join(dir, 'log.jsonl'), { slug: 'teste', battle: 0 }) });
  const tabela = JSON.parse(fs.readFileSync(paths().typeTable, 'utf8'));
  const { blocos } = RC.blocosDeForca(core, tabela); const us = RC.unidadesDoCore(core);
  const eq = (b) => { const v = []; for (let j = 0; j < b.n; j++) v.push(b.buf[27 + 15 * j]); return [...new Set(v)].join('/'); };
  const porNome = (re) => us.filter((u) => u.presente && re.test(u.nome)).map((u) => eq(blocos.find((b) => b.coreId === u.coreId))).join(' ');
  const mort = porNome(/^Medium Mortar Team/), ural = porNome(/^Truck \(Ural/), sq = porNome(/^Squad \(Rifle\)/), bmp = porNome(/BMP-2M/);
  let mig = 'sem o save do E7 (pulado)';
  const e7 = path.join(import.meta.dirname, '..', 'research', 'e83', 'E7 T1.bts');
  if (fs.existsSync(e7)) { const { numerarVagas } = await import('../tools/re/roster.mjs'); const v = numerarVagas(e7, path.join(dir, 'n.bts'), core); mig = `${v.mudados.length} blocos em branco renumerados`; }
  fs.rmSync(dir, { recursive: true, force: true });
  ok(mort === '1 2 3' && ural.includes('1 2 3') && bmp.includes('1 2 3') && sq.split(' ').every((x) => x === '1/2' || x === '1'),
    `(111) vagas pelo lugar: morteiros ${mort}, Ural ${ural}, BMP ${bmp}, esquadras ${sq}; migracao: ${mig}`);
}

// 112. LOTE 1 DA VARREDURA DE QA (05/10/2026, research/qa/r2 A1-A4, A13). O nome de campanha nao sai da pasta das
//      campanhas; a cotacao (e o Apply, que passa por ela) recusa reposicao de quem nao e baixa, cobra um homem pedido
//      duas vezes uma vez so, treina [id, "id"] uma vez so e recusa lista que nao e lista; o preco recusa pick sem fonte.
{
  const C = await import('./src/campaign.mjs');
  const recusa = (f) => { try { f(); return ''; } catch (e) { return e.message; } };
  const trav = ['..', '../_decoy', '..%2Fx', 'a/b', ''].map((x) => recusa(() => C.dirOf(x))).filter((m) => /is not a campaign name/.test(m)).length;
  const okSlug = !recusa(() => C.dirOf('MY-CAMPAIGN-')) && !recusa(() => C.dirOf('RUS1'));
  const dir = path.join(CAMPAIGNS_DIR);
  const alvo = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).map((d) => path.join(dir, d, 'state.json')).filter((f) => fs.existsSync(f))
    .map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))).find((st) => st.stage === 'result' && st.pending?.result?.casualtiesToBuy?.length
      && !st.pending.result.stipend?.campaignOver && st.pending.result.battle < (C.rules().battlesToWin || 12) && (!st.path || st.path.chosen));
  let q = 'sem campanha no resultado (pulado)'; let qok = true;
  if (alvo) {
    // (18/10: uma baixa de INFANTARIA — a tripulacao de maquina destruida nao se repoe avulsa, e a RUS3 b2 comeca por uma)
    const R0 = C.rules(); const maquinas = new Set(R0.replacement?.machineRoles || []);
    const papelDe = (id) => alvo.units.find((u) => u.coreId === id)?.role;
    const b = (alvo.pending.result.casualtiesToBuy.find((c) => !maquinas.has(papelDe(c.coreId))) || alvo.pending.result.casualtiesToBuy[0]).index;
    const campo = alvo.units.find((u) => u.present && !u.offMap && !(alvo.lost || []).includes(u.coreId));
    const dup = C.quoteApply(alvo, { replaceIndices: [b, b, String(b)] }, R0).replaceIndices.length;
    const fora = recusa(() => C.quoteApply(alvo, { replaceIndices: [-1] }, R0));
    let treinos = '-'; try { treinos = C.quoteApply(alvo, { train: [campo.coreId, String(campo.coreId)] }, R0).trainPlan.length; } catch (e) { treinos = 'recusa: ' + e.message.slice(0, 40); }
    const lista = recusa(() => C.quoteApply(alvo, { replaceIndices: 'x' }, R0));
    qok = dup === 1 && /not casualties/.test(fora) && (treinos === 1 || /recusa/.test(String(treinos))) && /must be a list/.test(lista);
    q = `homem 3x -> ${dup}; fora: "${fora.slice(0, 40)}"; treino [id,"id"] -> ${treinos}; lista: "${lista}"`;
  }
  const pick = recusa(() => C.priceOfPicks([{}], 'RU')); const naoLista = recusa(() => C.priceOfPicks('x', 'RU'));
  ok(trav === 5 && okSlug && qok && /names no formation/.test(pick) && /must be a list/.test(naoLista),
    `(112) lote 1: ${trav} de 5 nomes com caminho recusados; ${q}; pick vazio "${pick}"`);
}

// 113. O FIM DA CAMPANHA (05/10/2026, E143). O placar e Σ niveis x rules.score.perLevel + creditos (12 Total Victory e
//      8.710 cr = 104.710; Draw vale 4, Total Defeat 0). Na ultima batalha a cotacao (e o Apply) recusa qualquer gasto e
//      deixa passar o corpo vazio, que e o que "Finish the campaign" manda. O resumo de uma campanha local soma os AAR de
//      cada battles/NN/result.json e bate com o aarCumulative da ultima batalha lida.
{
  const C = await import('./src/campaign.mjs');
  const R0 = C.rules();
  // (25/10: com as partes novas; um estado Medium sem forca, sem AAR e sem derrota vale o que valia)
  const medio = { armies: ['RU'], defeatsAllowed: 2, rescueChance: 0.5, path: { startingPoints: 3 }, forceRatio: 1.3 };
  const hist = (lv) => ({ ...medio, history: lv.map((level, k) => ({ n: k + 1, level })), credits: 8710 });
  const a = C.scoreOf(hist(Array(12).fill('Total Victory')), R0), b = C.scoreOf(hist(['Draw', 'Total Defeat', 'Minor Victory']), R0);
  let ultima = 'sem campanha na ultima batalha (pulado)', ultimaOk = true;
  const dir = path.join(CAMPAIGNS_DIR);
  const estados = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).map((d) => path.join(dir, d, 'state.json')).filter((f) => fs.existsSync(f)).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  const fim = estados.find((st) => st.stage === 'result' && st.pending?.result?.income?.step?.campaignOver);
  if (fim) {
    const recusa = (body) => { try { C.quoteApply(fim, body, R0); return ''; } catch (e) { return e.message; } };
    const homem = fim.pending.result.casualtiesToBuy?.[0]?.index;
    const r1 = homem != null ? recusa({ replaceIndices: [homem] }) : 'this is the last battle (sem baixas)';
    const r2 = recusa({ abilities: ['x'] }); const vazio = recusa({});
    ultimaOk = /last battle of the campaign/.test(r1) && /last battle/.test(r2) && vazio === '';
    ultima = `${fim.slug} b${fim.pending.result.battle}: repor "${r1.slice(0, 45)}"; corpo vazio ${vazio ? 'RECUSADO ' + vazio : 'passa'}`;
  }
  let resumo = 'sem historico local (pulado)', resumoOk = true;
  const comHist = estados.find((st) => (st.history || []).length >= 3 && st.slug);
  if (comHist) {
    const S = C.campaignSummary(comHist.slug);
    const cum = comHist.stage === 'result' ? comHist.aarCumulative : null;
    resumoOk = S.battles.length === comHist.history.length && (!cum || cum.battle !== S.battles.length || (S.totals.you.mortos === cum.player.mortos && S.totals.enemy.mortos === cum.enemy.mortos));
    resumo = `${comHist.slug}: ${S.battles.length} batalhas, suas baixas ${S.totals.youMen}, infligidas ${S.totals.enemyMen}, razao ${S.totals.ratio}, placar ${S.score.total}`;
  }
  const naoUltima = estados.find((st) => st.stage === 'result' && !st.pending?.result?.income?.step?.campaignOver);
  let recusaFinish = 'sem campanha fora da ultima (pulado)';
  if (naoUltima) { try { await C.finishCampaign(naoUltima.slug); recusaFinish = 'FECHOU'; } catch (e) { recusaFinish = e.message; } }
  ok(a.total === 104710 && b.levels === 4 + 0 + 5 && ultimaOk && resumoOk && !/FECHOU/.test(recusaFinish),
    `(113) fim: 12 Total Victory + 8.710 = ${a.total}; Draw+Total Defeat+Minor = ${b.levels}; ${ultima}; ${resumo}; finish fora da ultima: "${recusaFinish.slice(0, 50)}"`);
}

// 114. UM ITEM DE INVENTARIO POR SOLDADO (05/10/2026, E145). No save de tres esquadras ucranianas (o do teste 36): o
//      catalogo ucraniano tem os lancadores que a fabrica do exercito poe na mao 2 (RPG-22 com o foguete 481, sem o 5,45),
//      as cargas de demolicao e o laser, aos precos da regra; um item por homem; lancador so com a mao 2 de fabrica livre;
//      a escrita poe o par na mao 2 sem mexer na mao 1 nem no tamanho e liga o demo x4 preservando o resto do byte +8;
//      o reset com keepKit mantem o lancador e poe o foguete (481), sem keepKit devolve a mao 2 de fabrica.
{
  const G = await import('./src/gear.mjs'); const T = await import('./src/transition.mjs'); const C = await import('./src/campaign.mjs');
  const save = path.join(import.meta.dirname, '../research/exemplos/e60_bit20.bts');
  const R0 = C.rules(); const F = C.factoryTable();
  const umEsquadrao = (coreId, n) => ({ coreId, name: `Squad (Rifle) #${n}`, present: true, role: 'infantry', nation: 'UKR' });
  const st = { nation: 'UKR', baseline: {}, units: [umEsquadrao(48, 1), umEsquadrao(49, 2), umEsquadrao(50, 3)] };
  const g = G.readGear(save, st, R0, { factory: F });
  const cat = g.kitCatalog.UKR || [];
  const rpg22 = cat.find((x) => x.id === '4/15');
  const homens = g.units.flatMap((u) => u.men.map((m) => ({ ...m, coreId: u.coreId })));
  const livre0 = homens.find((m) => m.canTake && !m.why2);
  const livre = [livre0, homens.find((m) => m.canTake && m !== livre0)];
  const ocupado = homens.find((m) => m.canTake && m.why2 === 'hand2');
  const recusa = (f) => { try { f(); return ''; } catch (e) { return e.message; } };
  // (19/10: o lancador substitui a arma de fabrica da mao 2; so o que a fabrica ja poe na mao dele e recusado)
  const doRpg = homens.find((m) => m.canTake && m.factorySecond === '4/15');
  const r1 = doRpg ? recusa(() => G.priceKit([{ index: doRpg.index, item: '4/15' }], g, R0)) : 'sem homem com o RPG-22 de fabrica';
  const r1ok = ocupado && ocupado.factorySecond !== '4/15' ? recusa(() => G.priceKit([{ index: ocupado.index, item: '4/15' }], g, R0)) : 'sem homem com a mao 2 ocupada';
  const r2 = recusa(() => G.priceKit([{ index: livre[0].index, item: '4/15' }, { index: livre[0].index, item: 'laser' }], g, R0));
  const r3 = recusa(() => G.priceKit([{ index: livre[0].index, item: '4/2' }], g, R0));
  const plano = G.priceKit([{ index: livre[0].index, item: '4/15' }, { index: livre[1].index, item: 'demo:4' }], g, R0);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e145-')); const out = path.join(dir, 'kit.bts');
  const trace = new Trace(path.join(dir, 'log.jsonl'), { slug: 'teste', battle: 0 });
  G.applyKit({ save, out, changes: plano.changes, trace });
  const antes = readRosterTails(save), depois = readRosterTails(out);
  const a = antes[livre[0].index].cauda, d = depois[livre[0].index].cauda, a2 = antes[livre[1].index].cauda, d2 = depois[livre[1].index].cauda;
  const escreveu = d[4] === 4 && d[5] === 15 && d[1] === a[1] && d[2] === a[2] && d.length === a.length && (d2[8] & 0x18) === 0x10 && (d2[8] & ~0x18) === (a2[8] & ~0x18);
  const armies = new Map(st.units.map((u) => [u.coreId, 'UKR']));
  const kitAmmo = (w, army) => G.kitAmmo(w, army, R0);
  const keepKit = { [livre[0].coreId]: { [livre[0].slot]: '4/15' } };
  const com = T.resetPlan(out, F, { armies, keepKit, kitAmmo });
  const sem = T.resetPlan(out, F, { armies, kitAmmo });
  const fica = !com.hands[livre[0].index] && com.insert[livre[0].index]?.[481] === 1;
  // sem keepKit o reset devolve a mao 2 de fabrica — salvo quando a fabrica tambem da esse lancador a vaga (variante legitima)
  const tipoDe = readRoster(save).unidades.find((u) => u.coreId === livre[0].coreId)?.tipo;
  const vagaF = F.tipos[`UKR|${tipoDe}`]?.vagas?.[livre[0].slot];
  const legitima = (vagaF?.variantes || []).some((v) => v.maos.slice().sort().join() === [livre[0].weapon, '4/15'].sort().join());
  const volta = legitima ? !sem.hands[livre[0].index] : /8\/0/.test(sem.hands[livre[0].index]?.to || '');
  const esquecido = G.forgetGear(keepKit, [{ coreId: livre[0].coreId, slot: livre[0].slot }]).forgotten.length === 1;
  fs.rmSync(dir, { recursive: true, force: true });
  // (18/10: os precos vem do catalogo, que le research/precos_armas.json; o teste nao fixa o numero)
  const demo4 = cat.find((x) => x.id === 'demo:4');
  ok(!!rpg22 && rpg22.price > 0 && rpg22.ammo[481] === 1 && !rpg22.ammo[1] && !!demo4 && cat.some((x) => x.id === 'laser')
    && /other hand/.test(r1) && r1ok === '' && /one item per soldier/.test(r2) && /not an item his army carries/.test(r3)
    && plano.cost === rpg22.price + demo4.price && escreveu && fica && volta && esquecido,
    `(114) kit: catalogo UKR ${cat.map((x) => x.name).join(', ')}; mao 2 ocupada "${r1.slice(0, 40)}"; dois itens "${r2}"; AT4 ucraniano "${r3.slice(0, 40)}"; ${plano.changes.length} itens por ${plano.cost} cr; escrita ${escreveu}; reset com keepKit mantem ${fica}, sem devolve ${volta}${legitima ? " (variante de fabrica)" : ""}; caido esquece ${esquecido}`);
}

// 115. UMA BATALHA NUM MAPA DE MEETING ENGAGEMENT (05/10/2026, E146). O gerador grava o tipo 0x03 (nao "Red Assault"),
//      os dois lados ficam dentro das suas zonas de setup (x = 8*tile + 4) e o mapa sai do transplante igual. Mapa de
//      faixas estreitas de proposito (Tiny Town 001 Meet: zonas de 3 tiles). Pula sem a pasta do jogo.
{
  const QB = path.join(paths().savedGames, '..', 'Quick Battle Maps');
  const mapa = path.join(QB, 'Tiny Town (288 X 288) 001 Meet.btt');
  if (!fs.existsSync(mapa)) console.log('ok    (115) sem a pasta de Quick Battle Maps do jogo (pulado)');
  else {
    const { generateBattle, NATION_CODE, readHeadings } = await import('./src/re.mjs');
    const { pintura } = await import('../tools/re/zonas.mjs'); const { ler: lerTipo } = await import('../tools/re/tipo_batalha.mjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e146-')); const out = path.join(dir, 'meet.btt');
    const lib = path.join(import.meta.dirname, '..', 'assets', 'lib');
    const log = console.log; console.log = () => {};
    try { await generateBattle({ mapa: mapa.replace(/\\/g, '/'), duracao: 45, ataque: 'Meet', gruposAuto: true, nacaoAzul: NATION_CODE.US, nacaoVermelho: NATION_CODE.RU, defensor: [{ formacao: path.join(lib, 'US - Section (Supply).btt').replace(/\\/g, '/') }], atacante: [{ formacao: path.join(lib, 'RU - Section (Supply).btt').replace(/\\/g, '/') }] }, out); } finally { console.log = log; }
    const tipo = lerTipo(out).nome;
    const z = pintura(mapa); const zona = { azul: new Set(z.azul.flatMap((l) => l.tiles).map(([x, y]) => x + ',' + y)), vermelho: new Set(z.vermelho.flatMap((l) => l.tiles).map(([x, y]) => x + ',' + y)) };
    let colocadas = 0, fora = 0;
    for (const u of readHeadings(out)) { if (u.ausente) continue; for (const e of u.elementos) { colocadas++; if (!zona[u.lado].has(Math.floor(e.x / 8) + ',' + Math.floor(e.y / 8))) fora++; } }
    const forma = readMap(out); const original = readMap(mapa);
    fs.rmSync(dir, { recursive: true, force: true });
    ok(tipo === 'Meeting Engagement' && colocadas > 0 && fora === 0 && forma.W === original.W && forma.iaConfere,
      `(115) Meeting Engagement: tipo "${tipo}", ${colocadas} unidades colocadas, ${fora} fora da zona, mapa ${forma.W}x${forma.H} iaConfere ${forma.iaConfere}`);
  }
}

// 116. A SELECAO DE MEETING ENGAGEMENT DO AUTOR (05/10/2026, E147). Todo mapa de `mapas.json` > `meet.tiers` esta no
//      censo como `serve`, vive no pacote (assets/qb_meet, sufixo CMBSRL) com o sha256 do censo, e o pacote nao tem
//      nada fora da selecao. Nenhum nome aparece em dois tiers.
{
  const { meetSelection, meetCensus } = await import('./src/catalog.mjs');
  const crypto = await import('node:crypto');
  const sel = meetSelection(); const cens = meetCensus();
  const nomes = Object.values(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'data', 'mapas.json'), 'utf8')).meet.tiers).flat();
  const dir = path.join(import.meta.dirname, '..', 'assets', 'qb_meet');
  const noPacote = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const autorais = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'data', 'planos_ia.json'), 'utf8')).mapas;   // plano de encontro gravado: o hash e o daqui
  // pacote ajustado (meet.pacoteAjustado, 17/10: lados trocados no 282 e no 315, setups unificados no Balalaikas): a copia do
  // pacote e a ajustada, com o sha de la (o autoral ainda vence)
  const { meetAdjusted, mapKey: chave } = await import('./src/catalog.mjs');
  const ajustados = meetAdjusted();
  const shaDe = (m) => autorais[path.relative(path.join(import.meta.dirname, '..', 'assets'), mapFile(m)).split(path.sep).join('/')]?.sha256 || ajustados.get(chave(m.f))?.sha256 || m.sha256;
  const shaErrado = cens.filter((m) => !fs.existsSync(mapFile(m)) || crypto.createHash('sha256').update(fs.readFileSync(mapFile(m))).digest('hex') !== shaDe(m)).map((m) => m.f);
  if (ajustados.size !== 3 || ![...ajustados.keys()].every((k) => cens.some((m) => chave(m.f) === k)) || [...ajustados.values()].some((v) => !v.ops?.length || !v.sha256)) shaErrado.push(`pacoteAjustado: ${[...ajustados.keys()]}`);
  const esperados = new Set(cens.map((m) => path.basename(mapFile(m))));
  const sobra = noPacote.filter((f) => !esperados.has(f));
  ok(sel.size === nomes.length && cens.length === sel.size && !shaErrado.length && !sobra.length && noPacote.every((f) => / CMBSRL\.btt$/.test(f)),
    `(116) selecao Meet: ${nomes.length} nomes, ${sel.size} unicos, ${cens.length} no censo como serve, ${noPacote.length} no pacote; sha errado ${shaErrado.join(', ') || 0}; sobra ${sobra.join(', ') || 0}`);
}

// 117. O INIMIGO US+UKR MISTURA OS DOIS EXERCITOS NA MESMA BATALHA (05/10/2026, E148). O pool e a uniao das
//      bibliotecas do lado; o cabecalho fica com o exercito que levou mais credito.
{
  const R117 = rules(); const log = console.log; console.log = () => {};
  let mistas = 0, cabecalhoOk = true; const n117 = 12;
  try {
    for (let s = 1; s <= n117; s++) {
      const d = planDefense({ nation: 'US', nations: ['US', 'UKR'], battleNumber: 1 + (s % 12), rules: R117, seed: s, effort: 1, kind: null });
      if (d.nations.length === 2) mistas++;
      const maior = Object.entries(d.creditsByNation).sort((a, b) => b[1] - a[1])[0][0];
      if (d.nation !== maior) cabecalhoOk = false;
    }
  } finally { console.log = log; }
  ok(mistas >= n117 - 1 && cabecalhoOk, `(117) inimigo US+UKR: ${mistas}/${n117} defesas com os dois exercitos; cabecalho = o de maior credito ${cabecalhoOk}`);
}

// 118. VEICULO NAO DESMONTA (05/10/2026, E149). Os veiculos da biblioteca cujo papel sai da arma (HMMWV (M2) -> mg,
//      ATGM Vehicle -> atgm, Mortar Carrier -> mortar) sao veiculos pelo nome; a tropa a pe nao e.
{
  const { isVehicleName } = await import('./src/catalog.mjs');
  const veic = ['Multipurpose Vehicle (M1151 HMMWV (M2))', 'ATGM Vehicle (M1167 HMMWV)', 'Reconnaissance Vehicle (BRDM-2)', 'Mortar Carrier (2S24)', 'Multipurpose Vehicle (M1152 HMMWV (Heavy Mortar))', 'ATGM Vehicle (BRDM-2M (AT-5))'];
  const pe = ['HMG Team', 'Squad (Rifle)', 'Team (Sniper) (7.62mm)', 'Grenade Launcher Team', 'Javelin Team', 'Medium Mortar Team', 'Squad (Engineer)', 'Headquarters Team'];
  const errados = [...veic.filter((n) => !isVehicleName(n)), ...pe.filter((n) => isVehicleName(n))];
  ok(!errados.length, `(118) veiculo pelo nome: ${veic.length} veiculos e ${pe.length} tropas a pe; errados ${errados.join(', ') || 0}`);
}

// 119. MAPAS COM PLANO DE IA AUTORAL (06-07/10/2026, E150-E157): cada um de app/data/planos_ia.json tem o hash
//      registrado, a regiao de IA legivel, nenhum Withdraw fora do formato novo, e GERA UMA BATALHA (o lixo do trailer
//      do editor ja quebrou o transplante uma vez: o fim do mapa saiu 96 KB antes do lugar).
{
  const crypto = await import('node:crypto');
  const { generateBattle, NATION_CODE } = await import('./src/re.mjs');
  const IE119 = await import('../tools/re/ia_escrever.mjs');
  const autorais = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'data', 'planos_ia.json'), 'utf8')).mapas;
  const lib = path.join(import.meta.dirname, '..', 'assets', 'lib');
  const falhas = [];
  for (const [k, v] of Object.entries(autorais)) {
    const f = path.join(import.meta.dirname, '..', 'assets', k);
    if (crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') !== v.sha256) { falhas.push(`${k}: hash`); continue; }
    // E167: um mapa registrado como autoral nao pode ser a copia intocada do jogo (o hash do censo)
    { const { mapCensus: mc119, mapFile: mf119 } = await import('./src/catalog.mjs'); const orig = mc119().find((m) => path.resolve(mf119(m)) === path.resolve(f)); if (orig && orig.sha256 === v.sha256) falhas.push(`${k}: e o mapa original do jogo, nao o plano autoral`); }
    const d = IE119.decodificar(f);
    const lixo = [...d.azul, ...d.vermelho].flatMap((pl) => pl.slots.flat()).filter((e) => e.trailer.length === 19 && e.trailer.subarray(1, 5).some((b) => b)).length;
    // num arquivo salvo pelo editor (versao 9b, E157) os bytes 1..4 do trailer sao dele e legitimos; so num arquivo nosso seriam lixo
    if (lixo && IE119.versaoDoArquivo(fs.readFileSync(f)) < 0x94) falhas.push(`${k}: ${lixo} trailers com lixo`);
    if (d.T === 19 && IE119.versaoDoArquivo(fs.readFileSync(f)) < 0x94) falhas.push(`${k}: formato novo num arquivo de versao antiga (E153: trava o editor e o jogo)`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e151-')); const log = console.log; console.log = () => {};
    try { await generateBattle({ mapa: f.replace(/\\/g, '/'), duracao: 45, ataque: /qb_(\w+)\//.exec(k)[1].replace(/^./, (c) => c.toUpperCase()), gruposAuto: true, nacaoAzul: NATION_CODE.US, nacaoVermelho: NATION_CODE.RU, defensor: [{ formacao: path.join(lib, 'US - Section (Supply).btt').replace(/\\/g, '/') }], atacante: [{ formacao: path.join(lib, 'RU - Section (Supply).btt').replace(/\\/g, '/') }] }, path.join(dir, 'b.btt')); }
    catch (e) { falhas.push(`${k}: gerar: ${e.message.slice(0, 80)}`); }
    finally { console.log = log; fs.rmSync(dir, { recursive: true, force: true }); }
  }
  ok(!falhas.length, `(119) ${Object.keys(autorais).length} mapas com plano autoral: hash, trailer limpo e batalha gerada${falhas.length ? ' — ' + falhas.join(' | ') : ''}`);
}

// 120. O PLANO DE IA REVISADO ENTRA NA BATALHA (08/10/2026, E174). Num mapa com plano do autor (planos_ia.json) o
//      buildBattle poe cada unidade inimiga no grupo do seu papel e dentro da zona de Setup desse grupo; num mapa sem
//      plano, o rodizio de sempre; com rules.defense.aiPlan.on = false, o rodizio tambem no mapa revisado.
{
  const { buildBattle } = await import('./src/forge.mjs');
  const { authoredPlan } = await import('./src/catalog.mjs');
  const RE = await import('./src/re.mjs');
  const { abrirCompleto: abrir120 } = await import('../tools/re/anexar2.mjs');
  const { pintura: pintura120 } = await import('../tools/re/zonas.mjs');
  const R120 = rules(); const q120 = { event() {}, read() {}, wrote() {}, step: async (_n, _d, f) => f() };
  const lib = path.join(import.meta.dirname, '..', 'assets', 'lib');
  const base = path.join(import.meta.dirname, '..', 'assets');
  const montar = async (rel, regras, n = 3) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e174-')); const out = path.join(dir, 'b.btt');
    const defense = planDefense({ nation: 'US', nations: ['US', 'UKR'], battleNumber: n, rules: regras, seed: 20261008, profile: 'misto', effort: 1, kind: null, trace: q120 });
    const log = console.log; console.log = () => {};
    try { const b = await buildBattle({ coreFile: path.join(lib, 'RU - Section (Supply).btt'), defense, mapFile: path.isAbsolute(rel) ? rel : path.join(base, rel), duration: 45, nation: 'RU', enemy: defense.nation, out, rules: regras, trace: q120, attack: 'Assault', title: 'ZZ E174' }); return { b, out, dir }; }
    finally { console.log = log; }
  };
  // revisado
  const sv = 'qb_attack/Small Village (554 X 848) 019r Attack CMBSRL.btt';
  const A = await montar(sv, R120);
  const escrito = new Map(RE.unitGroups(A.out).map((u) => [u.id, u.grupo]));
  const esperado = RE.groupsByRole(RE.blueUnits(A.out), { roleOf: (n, off) => roleOf(n, off, R120), preco: RE.defaultUnitPrice(R120) });
  const grupoErrado = [...esperado.grupo].filter(([id, g]) => escrito.get(id) !== g).length;
  const F120 = RE.mapFeatures(path.join(base, sv)); const dz = RE.decodeAiRegion(path.join(base, sv));
  const zona = {}; dz.azul[0].slots.forEach((s, k) => { const t = RE.toMapTiles(dz, s[0]?.tiles || []); if (t.length) zona[k + 1] = new Set(t.map((p) => p.join())); });
  const X = abrir120(A.out); const pz = pintura120(A.out); const azul = new Set(pz.azul.flatMap((l) => l.tiles).map((p) => p.join()));
  let naZona = 0, comZona = 0, foraDoAzul = 0;
  for (const u of RE.readHeadings(A.out)) {
    if (u.lado !== 'azul' || u.ausente) continue; const g = escrito.get(X.R[u.i].id);
    for (const e of u.elementos) { const t = Math.floor(e.x / 8) + ',' + Math.floor(e.y / 8); if (!azul.has(t)) foraDoAzul++; if (zona[g]) { comZona++; if (zona[g].has(t)) naZona++; } }
  }
  const forma = readMap(A.out), original = readMap(path.join(base, sv)); const cb = (await import('../tools/re/bateria/lib.mjs')).conferirBtt(A.out);
  fs.rmSync(A.dir, { recursive: true, force: true });
  // sem plano
  // o controle sem plano (12/10): uma COPIA do Small Village fora da pasta do pacote — o plano autoral e achado pelo
  // caminho, entao a copia cai no rodizio. Antes era o primeiro mapa medio do pacote sem plano, e eles acabaram (o
  // Khalmi 085r foi o ultimo); os que sobram sao Huge ou 1600, pesados demais para o teste.
  const dirSem = fs.mkdtempSync(path.join(os.tmpdir(), 'e174-sem-')); const semPlano = path.join(dirSem, 'Small Village (554 X 848) 019r Attack CMBSRL.btt');
  fs.copyFileSync(path.join(base, sv), semPlano);
  const Bm = await montar(semPlano, R120, 6); fs.rmSync(Bm.dir, { recursive: true, force: true });
  // desligado pela regra
  const Rdes = JSON.parse(JSON.stringify(R120)); Rdes.defense.aiPlan = { on: false };
  const Cm = await montar(sv, Rdes); fs.rmSync(Cm.dir, { recursive: true, force: true });
  ok(!!authoredPlan(path.join(base, sv)) && !authoredPlan(semPlano) && A.b.aiPlan.authored && grupoErrado === 0 && comZona > 0 && naZona / comZona >= 0.9 && foraDoAzul === 0
    && forma.W === original.W && forma.iaConfere && !cb.erros.length && Bm.b.aiPlan.authored === false && Cm.b.aiPlan.authored === false,
    `(120) plano revisado na batalha: ${A.b.aiPlan.units} unidades em ${Object.keys(A.b.aiPlan.groups).length} grupos, ${grupoErrado} no grupo errado, ${naZona}/${comZona} elementos na zona do grupo, ${foraDoAzul} fora da pintura azul, ${cb.erros.length} erros; sem plano -> ${Bm.b.aiPlan.authored ? 'revisado' : 'rodizio'}; regra desligada -> ${Cm.b.aiPlan.authored ? 'revisado' : 'rodizio'}`);

  // G2 FORWARD DEPLOYED (autor, 11/10): LMG, RPO, scouts/recon a pe e 10 % das esquadras; veiculo de recon e blindado;
  // as esquadras ficam 10/30/50/10 (G13/G14/G15/G2). E nos 30 mapas revisados, G14 e G15 so tem o Setup.
  const papel = (n) => RE.fineRole(n, roleOf(n, false, R120));
  const avancados = ['RPO Team', 'Team (RPO)', 'Section (Scout)', 'Squad (Scout)', 'Squad (Recon)', 'Recon Team', 'Team (Recon)', 'Machinegun Team (PKM)'].filter((n) => papel(n) !== 'avancado');
  const brdm = papel('Reconnaissance Vehicle (BRDM-2)');
  const sq = Array.from({ length: 10 }, (_, k) => ({ id: k + 1, nome: 'Squad (Rifle)', ausente: false, foraDoMapa: false }));
  const g10 = RE.groupsByRole(sq, { roleOf: (n, off) => roleOf(n, off, R120), preco: RE.defaultUnitPrice(R120) }).grupo;
  const porGrupo = {}; for (const g of g10.values()) porGrupo[g] = (porGrupo[g] || 0) + 1;
  const IE120 = await import('../tools/re/ia_escrever.mjs');
  // a unica excecao e a que o mapa declara (`gruposComOrdem`, 12/10: o G15 do Hills-Water 037r, pedido do autor)
  const mapas120 = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'data', 'planos_ia.json'), 'utf8')).mapas;
  const andando = Object.keys(mapas120)
    .filter((k) => { const livres = new Set(mapas120[k].gruposComOrdem || []); return IE120.decodificar(path.join(base, k)).azul.some((pl) => pl.uso && [14, 15].filter((g) => !livres.has(g)).some((g) => pl.slots[g - 1].length > 1 || pl.slots[g - 1][0].esperas.length)); });
  ok(!avancados.length && brdm === 'blindado' && porGrupo[13] === 1 && porGrupo[14] === 3 && porGrupo[15] === 5 && porGrupo[2] === 1 && !andando.length,
    `(120) Forward Deployed: ${avancados.length ? 'fora do G2: ' + avancados.join(', ') : 'LMG, RPO e scouts no G2'}, BRDM ${brdm}, 10 esquadras -> ${JSON.stringify(porGrupo)}; G14/G15 com ordem em ${andando.length} mapas${andando.length ? ': ' + andando.slice(0, 2).join('; ') : ''}`);
}

// 121. A MARCA DE CENARIO (base+29) E UM BYTE DO BLOCO 0 COMPRIMIDO (10/10/2026, E175). Em todo mapa do pacote,
//      reconstruido como o gerador faz: onde ela e o bit de versao, a versao do bloco 0 vai de 139 para 155 e os
//      textos do briefing ficam iguais; onde nao e (Hills-Water 037r e Huge Rough-Water-Town 026r), o arquivo fica
//      como estava. Nenhum mapa sai com versao ou briefing corrompidos.
{
  const { marcarComoCenario } = await import(new URL('../tools/re/gerar_batalha.mjs', import.meta.url).href);
  const { ler: lerBriefing } = await import(new URL('../tools/re/briefing.mjs', import.meta.url).href);
  const { reconstruir } = await import(new URL('../tools/re/rebuild.mjs', import.meta.url).href);
  const base = path.join(import.meta.dirname, '..', 'assets');
  const tmp = path.join(os.tmpdir(), `marca-${process.pid}.btt`);
  let marcados = 0, recusados = 0, corrompidos = 0; const recusa = new Set();
  for (const d of fs.readdirSync(base).filter((x) => x.startsWith('qb_'))) for (const f of fs.readdirSync(path.join(base, d)).filter((x) => x.endsWith('.btt'))) {
    reconstruir(path.join(base, d, f), tmp, (b) => b);
    const a = lerBriefing(tmp); const m = marcarComoCenario(tmp); const b2 = lerBriefing(tmp);
    const textos = JSON.stringify([a.azul, a.vermelho]) === JSON.stringify([b2.azul, b2.vermelho]);
    if (m.recusado) { recusados++; recusa.add(f.replace(/ (Assault|Attack|Probe|Meet).*$/, '')); if (b2.versao !== a.versao || !textos) corrompidos++; }
    else if (m.antes !== m.depois) { marcados++; if (b2.versao !== a.versao + 16 || !textos) corrompidos++; }
  }
  fs.rmSync(tmp, { force: true });
  // o Huge Rough-Water-Town 026r tambem recusava; saiu do pacote em 12/10 (descartado pelo autor)
  ok(corrompidos === 0 && marcados > 0 && [...recusa].sort().join() === 'Hills-Water (1072 X 816) 037r',
    `(121) marca de cenario: ${marcados} mapas marcados (versao +16, briefing igual), ${recusados} recusados (${[...recusa].join('; ')}), ${corrompidos} corrompidos`);
}

// 122. O CAMINHO DE BATALHAS (11/10/2026, E176). A forma, em 50 sementes: o Start sozinho na linha 1, 2-4 nos nas
//      linhas 2-12, todo no alcancavel do Start e chegando a linha 12, nenhuma aresta cruzada, a mesma semente dando o
//      mesmo caminho. O caminho inteiro, em duas sementes, com as defesas planejadas de verdade: nenhum mapa repete ao
//      longo de um caminho, tipo/peso/multiplicador/pontos saidos das tabelas, e o `publicView` sem mapa nem inimigo
//      antes da revelacao paga.
{
  const P = await import('./src/path.mjs');
  let formaRuim = 0, cruzadas = 0, soltos = 0, naoDeterministico = 0;
  for (let s = 1; s <= 50; s++) {
    const sh = P.pathShape(s, R);
    const larg = {}; for (const n of sh.nodes) larg[n.row] = (larg[n.row] || 0) + 1;
    if (larg[0] !== 1 || Object.keys(larg).length !== R.battlesToWin + 1) formaRuim++;
    for (let r = 1; r <= R.battlesToWin; r++) if (!(larg[r] >= R.path.rowWidth[0] && larg[r] <= R.path.rowWidth[1])) formaRuim++;
    const byId = new Map(sh.nodes.map((n) => [n.id, n]));
    const temPai = new Set(sh.nodes.flatMap((n) => n.edges));
    for (const n of sh.nodes) if ((n.row > 0 && !temPai.has(n.id)) || (n.row < R.battlesToWin && !n.edges.length)) soltos++;
    for (let r = 1; r < R.battlesToWin; r++) {
      const ar = sh.nodes.filter((n) => n.row === r).flatMap((n) => n.edges.map((e) => [n.col, byId.get(e).col]));
      for (const [a1, b1] of ar) for (const [a2, b2] of ar) if ((a1 < a2 && b1 > b2)) cruzadas++;
    }
    if (JSON.stringify(P.pathShape(s, R)) !== JSON.stringify(sh)) naoDeterministico++;
  }
  ok(!formaRuim && !cruzadas && !soltos && !naoDeterministico, `(122) forma do caminho em 50 sementes: ${formaRuim} linhas fora de 1/2-4, ${soltos} nos soltos, ${cruzadas} arestas cruzadas, ${naoDeterministico} nao deterministicas`);

  let repetidos = 0, foraDaTabela = 0, vazou = 0, semDefesa = 0, revelacao = 0, esforcoErrado = 0;
  const kinds = new Set([null, ...(R.path.meetShare > 0 ? ['Meet'] : [])]);   // 23/10: a batalha comum nao tem tipo
  for (const seed of [20261011, 777]) {
    const p = P.generatePath({ seed, rules: R, enemy: { nation: 'RU', nations: ['RU'], effort: 1.5 }, fits: 20 });
    const anc = P.ancestorsOf(p.nodes); const byId = new Map(p.nodes.map((n) => [n.id, n]));
    for (const n of p.nodes.filter((x) => x.row > 0)) {
      const fam = (m) => m.familia || m.f;
      if (n.mapWhy !== 'every map of the tier is on the way here' && [...anc.get(n.id)].some((a) => byId.get(a).map && fam(byId.get(a).map) === fam(n.map))) repetidos++;
      if (!kinds.has(n.kind) || !R.path.enemyWeights.some((b) => b.id === n.band && b.mult === n.rewardMult) || !(n.ops >= 0 && n.ops <= Math.max(R.path.balance?.maxOps ?? 0, ...R.path.opsRewards.map((o) => o.ops)))) foraDaTabela++;
      if (!n.defense || !(n.defense.units > 0)) semDefesa++;
      // 01/11 (autor): a dificuldade escala so o Attack; o encontro e 1:1 em todo nivel
      else if (Math.abs(n.defense.effort - (n.kind === 'Meet' ? 1 : 1.5) * n.budget) > 1e-9) esforcoErrado++;
      const v = P.publicView(n, {});
      // (18/10: o peso do inimigo e publico, amarrado ao multiplicador de creditos)
      if (v.map || v.enemy || v.band !== n.band || JSON.stringify(v).includes(n.map.f)) vazou++;
      const vm = P.publicView(n, { map: true }), vf = P.publicView(n, { formations: true }), vt = P.publicView(n, { full: true });
      if (!vm.map || vm.enemy || !vf.enemy?.formations?.length || vf.enemy.kept || !vt.enemy?.kept?.length || vt.band !== n.band || vt.map) revelacao++;
    }
    const pub = P.publicPath(p, { startingPoints: 2 });
    if (pub.at !== 'start' || pub.route.join() !== 'start' || pub.nodes.length !== p.nodes.length || p.nodes[0].map || p.nodes[0].edges.length !== p.nodes.filter((x) => x.row === 1).length) foraDaTabela++;
  }
  // 24/10 (autor): so o mapa (1) e o inimigo inteiro (2, sem desconto); o nivel "formacoes" saiu
  let semFormacoes = false; try { P.revealCost('formations', {}, R); } catch { semFormacoes = true; }
  const custo = [P.revealCost('map', {}, R), P.revealCost('full', {}, R), P.revealCost('full', { formations: true }, R), P.revealCost('map', { map: true }, R), semFormacoes ? 'sem-formacoes' : 'formacoes!'].join();
  ok(!repetidos && !foraDaTabela && !vazou && !semDefesa && !esforcoErrado && !revelacao && custo === '1,2,2,0,sem-formacoes',
    `(122) caminho inteiro em 2 sementes: ${repetidos} mapas repetidos no caminho, ${foraDaTabela} nos fora das tabelas, ${semDefesa} sem defesa, ${esforcoErrado} com o esforco errado (Attack 1,5x, encontro 1x), ${vazou} segredos vazados, ${revelacao} revelacoes erradas; precos ${custo}`);
}

// 123. REVELAR E ESCOLHER NO CAMINHO (11/10/2026, E176), numa campanha sintetica (pasta ZZ-T123, apagada no fim):
//      revelar debita e recusa (no que nao segue o atual, ja revelado, sem pontos; a composicao inteira depois das
//      formacoes custa a diferenca); escolher recusa no que nao segue; o Apply recusa sem escolha; o state.json nunca
//      traz o mapa de um no nao revelado; a recompensa paga o multiplicador do no; o estipendio nao depende do tipo.
{
  const P = await import('./src/path.mjs');
  const C = await import('./src/campaign.mjs');
  const { CAMPAIGNS_DIR } = await import('./src/settings.mjs');
  const slug = 'ZZ-T123';
  const dir = path.join(CAMPAIGNS_DIR, slug);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  try {
    const secret = P.generatePath({ seed: 124, rules: R, enemy: { nation: 'RU', nations: ['RU'], effort: 1 }, fits: 10 });
    fs.writeFileSync(C.pathFile(slug), JSON.stringify(secret));
    // a campanha no resultado da batalha 1, jogada no primeiro no da linha 1
    const b1 = secret.nodes.filter((x) => x.row === 1).sort((x, y) => y.edges.length - x.edges.length)[0].id;   // a que tem mais de um filho
    const filhos = secret.nodes.find((x) => x.id === b1).edges;
    const neto = secret.nodes.find((x) => x.row === 3).id;
    const pubPath = P.publicPath(secret, { startingPoints: 3 });
    pubPath.route = ['start', b1]; pubPath.at = b1;
    pubPath.nodes = pubPath.nodes.map((x) => (x.id === b1 ? P.publicView(secret.nodes.find((y) => y.id === b1), {}, { played: true }) : x));
    const base = { version: 1, slug, name: slug, stage: 'result', battleNumber: 1, credits: 0, defeatsLeft: 2, units: [], history: [], seenSaves: [], playedMaps: [], picks: [], battleSlots: ['A', 'B'], ops: 3,
      path: pubPath, pending: { savePath: 'x', result: { battle: 1, verdict: { won: true } } }, current: { n: 1, node: b1 } };
    fs.writeFileSync(C.stateFile(slug), JSON.stringify(base));
    const recusa = (f) => { try { f(); return null; } catch (e) { return e.message; } };
    const alvo = filhos[0];
    const naoSegue = recusa(() => C.revealNode(slug, { node: neto, what: 'map' }));
    let s = C.revealNode(slug, { node: alvo, what: 'map' });
    const depoisMapa = s.ops;
    const deNovo = recusa(() => C.revealNode(slug, { node: alvo, what: 'map' }));
    // 24/10: no caminho so o mapa; o nivel formacoes saiu e o inimigo inteiro e da Intel (a batalha em preparo)
    const formacoes = recusa(() => C.revealNode(slug, { node: alvo, what: 'formations' }));
    const inteiroNoCaminho = recusa(() => C.revealNode(slug, { node: alvo, what: 'full' }));
    s = C.loadState(slug);
    const depoisTudo = s.ops;
    const semPontos = /nothing called/.test(formacoes || '') && /Intel/.test(inteiroNoCaminho || '') ? 'ok' : `formacoes: ${formacoes} / inteiro: ${inteiroNoCaminho}`;
    const visto = s.path.nodes.find((x) => x.id === alvo);
    const texto = fs.readFileSync(C.stateFile(slug), 'utf8');
    const vazou = secret.nodes.filter((x) => x.row > 1 && x.id !== alvo && !secret.nodes.some((y) => y.id !== x.id && y.map?.f === x.map.f && (y.id === alvo))).filter((x) => texto.includes(x.map.f)).length;
    const escolhaRuim = recusa(() => C.chooseNode(slug, { node: neto }));
    const semEscolha = recusa(() => C.quoteApply(C.loadState(slug), {}, R));
    s = C.chooseNode(slug, { node: alvo });
    const comEscolha = s.path.chosen;
    // o peso do no age so no teto da cobertura (a escada, 30/10); o degrau nao depende do caminho
    const r1 = { base: C.capFor(2, 1.3, R) }, r0 = { base: C.capFor(2, 1, R) };
    const st = (pathOn) => C.stepFor(pathOn ? { path: {}, forceRatio: 1.3 } : { forceRatio: 1.3 }, 2, R).credits;
    ok(/follow/.test(naoSegue || '') && depoisMapa === 2 && /already known/.test(deNovo || '') && depoisTudo === 2 && semPontos === 'ok'
      && visto.map && visto.band && !visto.enemy && vazou === 0 && /does not follow/.test(escolhaRuim || '') && /choose the next battle/.test(semEscolha || '')
      && comEscolha === alvo && Math.abs(r1.base - r0.base * 1.3) <= 1 && r1.base > r0.base && st(true) === st(false),
      `(123) caminho: revelar ${3}->${depoisMapa}->${depoisTudo} pontos (mapa 1; formacoes e inteiro recusados no caminho), recusas [${[naoSegue, deNovo, semPontos, escolhaRuim, semEscolha].map((x) => (x || 'NENHUMA').slice(0, 28)).join(' | ')}], ${vazou} mapas vazados no state, teto da cobertura ${r0.base}->${r1.base}, degrau b2 ${st(false)} -> ${st(true)} no caminho`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 124-125. UNDO E INTEL (11/10/2026, E176): as recusas, numa campanha sintetica (o caminho feliz roda na QA, P03 e
//      P04, que precisam de um Apply de verdade). O undo recusa fora de `play`, na batalha 1 e sem o ponto de volta; a
//      compra tardia recusa fora de `play`, as habilidades aposentadas e o push-on, e conta as pilhas pelo que ja foi
//      aplicado a batalha.
{
  const C = await import('./src/campaign.mjs');
  const { CAMPAIGNS_DIR } = await import('./src/settings.mjs');
  const slug = 'ZZ-T124';
  const dir = path.join(CAMPAIGNS_DIR, slug);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const recusa = async (f) => { try { await f(); return null; } catch (e) { return e.message; } };
  try {
    const grava = (s) => fs.writeFileSync(C.stateFile(slug), JSON.stringify({ version: 1, slug, name: slug, credits: 1000, defeatsLeft: 2, units: [], seenSaves: [], playedMaps: [], picks: [], battleSlots: ['A', 'B'], ...s }));
    grava({ stage: 'result', battleNumber: 1, history: [], pending: { savePath: 'x', result: { battle: 1, verdict: { won: true } } }, current: { n: 1 } });
    const u1 = await recusa(() => C.undoBattle(slug));
    const a1 = await recusa(() => C.buyAbility(slug, { abilities: ['clock-15'] }));
    grava({ stage: 'play', battleNumber: 1, history: [], current: { n: 1, duration: 45 } });
    const u2 = await recusa(() => C.undoBattle(slug));
    grava({ stage: 'play', battleNumber: 1, history: [], path: { nodes: [{ id: 'start', edges: ['r1c0'] }], route: ['start', 'r1c0'], at: 'r1c0' }, ops: 0, current: { n: 1, duration: 45, node: 'r1c0' } });
    const u2b = await recusa(() => C.undoBattle(slug));
    grava({ stage: 'play', battleNumber: 2, history: [{ n: 1 }], current: { n: 2, duration: 60 } });
    const u3 = await recusa(() => C.undoBattle(slug));
    const st = { abilities: { applied: [{ id: 'clock-15', battle: 2 }, { id: 'clock-15', battle: 1 }] } };
    const ap = await recusa(() => C.priceLateAbilities(['intel'], st, 2, R));
    const po = await recusa(() => C.priceLateAbilities(['push-on'], st, 2, R));
    const pilha = await recusa(() => C.priceLateAbilities(['clock-15', 'clock-15'], st, 2, R));
    const umaMais = C.priceLateAbilities(['clock-15', 'clock-30'], st, 2, R);
    ok(/only a battle that is built/.test(u1 || '') && /apply the result first/.test(a1 || '') && /first battle/.test(u2 || '') && /battle 1 was built before undo existed/.test(u2b || '') && /before undo existed/.test(u3 || '')
      && /not offered/.test(ap || '') && /not offered/.test(po || '') && /only buy 2/.test(pilha || '') && umaMais.minutes === 45 && umaMais.items.length === 2 && umaMais.ops === 3,
      `(124-125) undo e intel: recusas [${[u1, a1, u2, u2b, u3, ap, po, pilha].map((x) => (x || 'NENHUMA').slice(0, 26)).join(' | ')}]; +15 +30 = ${umaMais.minutes} min por ${umaMais.ops} pontos`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 126. A FORCA DO ENCONTRO (12/10/2026, autor: Meeting Engagement). Para US+UKR e RU, batalhas dos quatro tiers, duas
//      sementes: ninguem a pe sem veiculo (toda equipe/esquadra veio num pelotao comprado com veiculo); tanques so os do
//      tier (US+UKR sem Abrams no tier 1, RU sem T-90 no tier 1); reconhecimento por tier (M1200 so tier 1, M3A3 so 2+ e
//      sem a Squad (Scout), Tigr so tier 1); sem tanque na batalha 1 e o dinheiro desce em cascata; tanques com a maior
//      fatia quando cabem; determinista; dentro do teto onMap da regra (140 ate 01/11, 250 depois).
{
  const ME = await import('./src/meet.mjs'); const { tierBudgets } = await import('./src/defense.mjs');
  const Rm = rules(); const maus = []; let rodadas = 0;
  const D_tb = (b, R) => ({ total: tierBudgets(b, R, { kind: null }).total * (R.maps.kindBudgetFactor.Meet ?? 1) });
  for (const [nat, nats] of [['US', ['US', 'UKR']], ['RU', ['RU']]]) for (const b of [1, 2, 3, 4, 6, 7, 9, 10, 12]) for (const seed of [1, 2]) {
    const p = ME.planMeetForce({ nation: nat, nations: nats, battleNumber: b, rules: Rm, seed }); rodadas++;
    const t = p.tier; const tag = `${nats.join('+')} b${b} s${seed}`;
    const aPe = p.meet.unidades.filter((u) => ['squad', 'team', 'aaTeam', 'hq'].includes(u.papel) && !u.lot);
    if (aPe.length) maus.push(`${tag}: a pe sem pelotao ${aPe.map((u) => u.name).join(', ')}`);
    for (const l of p.lots) if (l.tipo === 'mech' && (!l.seats || l.squads < 2)) maus.push(`${tag}: lote mec sem assento ${l.name}`);
    const nomes = p.meet.unidades.map((u) => u.name).join(' | ');
    if (t === 1 && /M1A2|T-90/.test(nomes)) maus.push(`${tag}: tanque moderno no tier 1`);
    if (t > 1 && /M1200 Armored Knight|Tigr \((MG|AGS-17)\)/.test(p.meet.unidades.filter((u) => u.papel === 'recon').map((u) => u.name).join())) maus.push(`${tag}: recon do tier 1 no tier ${t}`);
    if (t === 1 && /M3A3/.test(nomes)) maus.push(`${tag}: M3A3 no tier 1`);
    const m3 = p.meet.unidades.filter((u) => /M3A3/.test(u.name));
    if (m3.some((u) => p.meet.unidades.some((x) => x.leaf === u.leaf && /Squad \(Scout\)/.test(x.name)))) maus.push(`${tag}: M3A3 com a Squad (Scout)`);
    // 12/10: o encontro vale 1,6x a defesa (kindBudgetFactor.Meet); a cascata gasta o orcamento nas primeiras batalhas
    if (b <= 3 && p.cost < p.budget * 0.9) maus.push(`${tag}: sem cascata (${p.cost}/${p.budget})`);
    if (Math.abs(p.budget - Math.round(D_tb(b, Rm).total)) > 5) maus.push(`${tag}: orcamento ${p.budget}`);
    // o tanque nao se divide: a fatia dos tanques fica cheia ate faltar menos que um tanque (o mais caro e 1.500)
    if (b >= 4 && p.spent.tanks < p.budgets.tanks - 1500) maus.push(`${tag}: tanques ${p.spent.tanks} de ${p.budgets.tanks}`);
    // o limite e de quem pisa o mapa (desde 14/10 o suporte fora do mapa entra na forca e nao ocupa lugar)
    if (p.onMapUnits > Rm.defense.unitCaps.onMap || p.cost > p.budget * 1.1) maus.push(`${tag}: ${p.onMapUnits} unidades no mapa, ${p.cost}/${p.budget}`);
    if (seed === 1 && JSON.stringify(ME.planMeetForce({ nation: nat, nations: nats, battleNumber: b, rules: Rm, seed }).kept) !== JSON.stringify(p.kept)) maus.push(`${tag}: nao determinista`);
  }
  ok(!maus.length, `(126) forca do encontro: ${rodadas} compras${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ', todos montados, tanques/recon por tier, cascata, determinista'}`);
}

// 127. QUANTOS EM CADA FLANCO: o centro primeiro (autor: "quem recebe unidades primeiro e sempre Centro"), as somas
//      certas, e a receita de cada variante (balanced 20/60/20, right 20/40/40, left 40/40/20).
{
  const ME = await import('./src/meet.mjs');
  const V = rules().meet.variants; const maus = [];
  for (const [nome, s] of Object.entries(V)) for (let n = 0; n <= 12; n++) {
    const r = ME.repartirABC(n, s);
    if (r.A + r.B + r.C !== n) maus.push(`${nome} n${n} soma ${r.A + r.B + r.C}`);
    if (n === 1 && r.B !== 1) maus.push(`${nome} n1 fora do centro`);
    if (n === 2 && nome === 'balanced' && r.B !== 2) maus.push(`balanced n2 ${JSON.stringify(r)}`);
    if (n >= 5 && nome === 'right' && r.C < r.A) maus.push(`right n${n} ${JSON.stringify(r)}`);
    if (n >= 5 && nome === 'left' && r.A < r.C) maus.push(`left n${n} ${JSON.stringify(r)}`);
    if (nome === 'balanced' && (r.B < r.A || r.B < r.C)) maus.push(`balanced n${n} ${JSON.stringify(r)}`);
  }
  ok(!maus.length, `(127) flancos A/B/C: ${maus.length ? maus.slice(0, 4).join('; ') : 'somas, centro primeiro e as tres receitas'} (n=10 balanced ${JSON.stringify(ME.repartirABC(10, V.balanced))}, right ${JSON.stringify(ME.repartirABC(10, V.right))})`);
}

// 128. O ASSALTO DIRETO NO SMALL VILLAGE 015r (tools/re/ia_encontro.mjs, autor 12/10 noite): o mapa e pequeno, entao
//      o modo e o assalto direto, com as variantes flankLeft/flankRight/both nos planos azuis 1-3 (4 e 5 vazios); todo
//      Setup dentro da pintura azul; janelas em passos de 30 s; tanques, recon e escolta saem na hora zero pela rua e
//      terminam em Assault no centro do objetivo; os IFVs do centro desmontam (Passengers Dismount) na ordem que chega
//      as casas, vao para as arvores e so entram no objetivo aos 30:00; os IFVs de flanco desmontam nas casas afastadas,
//      passam a 10-20 tiles do setup do jogador e fecham em Assault; as esquadras de flanco saem das casas aos 15:00;
//      nenhum trigger ZZ Meet sobrando; o arquivo le de volta igual, no formato antigo, vermelho intacto.
{
  const ENC = await import('../tools/re/ia_encontro.mjs');
  const IE = await import('../tools/re/ia_escrever.mjs');
  const { pecas } = await import('../tools/re/mapa_escrever.mjs');
  const base = path.join(import.meta.dirname, '..', 'assets', 'qb_meet_fora', 'Small Village (976 X 400) 015r Meet CMBSRL.btt');
  const Rm = rules(); const antes = IE.decodificar(base); const G = Rm.meet.assault.groups, C = Rm.meet.assault.clock;
  const r = ENC.aplicarDoutrinaEncontro(base, { duracaoMin: 45, doctrine: Rm.meet.doctrine, assault: Rm.meet.assault });
  const tmp = path.join(os.tmpdir(), `meet128-${process.pid}.btt`); IE.gravar(base, tmp, r.d);
  const d = IE.decodificar(tmp); const maus = [];
  const azul = new Set(r.F.azuis); const obj = new Set(r.F.objs[0].tiles.map(([x, y]) => r.F.idx(x, y)));
  const usados = d.azul.map((p, k) => (p.uso ? k + 1 : null)).filter(Boolean);
  if (r.modo !== 'assalto' || usados.join() !== '1,2,3' || d.azul[3].uso || d.azul[4].uso) maus.push(`modo ${r.modo}, planos ${usados.join(',')}`);
  for (const p of usados) d.azul[p - 1].slots.forEach((s, g) => {
    if (!s.length || !s[0].tiles.length) return;
    if (IE.doMapa(d, s[0].tiles).some(([x, y]) => !azul.has(r.F.idx(x, y)))) maus.push(`P${p} G${g + 1} Setup fora do azul`);
    if (s.some((e) => e.a % 30 || e.b % 30 || e.a > e.b)) maus.push(`P${p} G${g + 1} janela`);
  });
  const P = d.azul[0].slots, tipo = (e) => e.prefixo[1], ASSALTO = IE.TIPO_ORDEM.Assault;
  const noCentro = (e) => IE.doMapa(d, e.tiles).every(([x, y]) => obj.has(r.F.idx(x, y)));
  // a primeira ordem depois do Setup e o Assault ao centro (a cadeia segue com a investida final)
  for (const g of [G.tanks, G.recon, G.escort]) { const s = P[g - 1], u = s[1]; if (tipo(u) !== ASSALTO || !noCentro(u) || s[0].a > 30) maus.push(`G${g} nao desce em Assault ao centro na hora zero`); }
  const cv = P[G.centreVeh - 1];
  if (cv[1].prefixo[0] !== 1 || cv[2].a !== C.centreVehHold || !noCentro(cv[3])) maus.push(`IFVs do centro: desmonta ${cv[1].prefixo[0]}, espera ${cv[2].a}`);
  const ci = P[G.centreInf - 1]; if (ci.some((e) => e.prefixo[0] === 1) || !IE.doMapa(d, ci[1].tiles).every(([x, y]) => r.F.predio[r.F.idx(x, y)])) maus.push('esquadras do centro fora das casas');
  const pRed = r.Zs.As.geo.pRed;
  for (const f of ['A', 'C']) {
    const fv = P[G['farVeh' + f] - 1], fi = P[G['farInf' + f] - 1];
    const longe = IE.doMapa(d, fv[3].tiles).map(([x, y]) => pRed - r.geo.prog(x, y)); const media = longe.reduce((a, v) => a + v, 0) / longe.length;
    if (fv[1].prefixo[0] !== 1 || tipo(fv[fv.length - 1]) !== ASSALTO || media < 9 || media > 21) maus.push(`IFVs do flanco ${f}: desmonta ${fv[1].prefixo[0]}, a ${media.toFixed(0)} tiles do jogador`);
    if (fi[1].a !== C.farInfWait) maus.push(`esquadras do flanco ${f} saem em ${fi[1].a}`);
  }
  // a investida final (13/10): aos 35:00 tanques, leves e infantaria vao tomar 3/4 do mapa — os blindados em lances de
  // 2 min em Assault, a infantaria de cobertura a cobertura; equipes, AA e resto ficam
  const p34 = r.Zs.As.geo.p34, progDe = (e) => { const t = IE.doMapa(d, e.tiles); return t.reduce((a, [x, y]) => a + r.geo.prog(x, y), 0) / t.length; };
  for (const g of [G.tanks, G.recon, G.escort, G.centreVeh, G.guardA, G.guardC]) {
    const s = P[g - 1]; const k = s.findIndex((e) => e.a === C.finalPush); const fim = s[s.length - 1];
    if (k < 0 || Math.abs(progDe(fim) - p34) > 4 || tipo(fim) !== ASSALTO) { maus.push(`G${g} sem investida aos 35:00 ate 3/4`); continue; }
    for (let q = k + 1; q < s.length - 1; q++) if (s[q].a !== s[q - 1].a + C.finalBound || tipo(s[q]) !== ASSALTO) maus.push(`G${g} lance ${q} fora do ritmo`);
  }
  for (const g of [G.centreInf, G.farInfA, G.farInfC]) {
    const s = P[g - 1]; const k = s.findIndex((e) => e.a === C.finalPush); const fim = s[s.length - 1];
    if (k < 0 || Math.abs(progDe(fim) - p34) > 4) { maus.push(`G${g} infantaria sem investida`); continue; }
    const cob = IE.doMapa(d, fim.tiles).filter(([x, y]) => r.F.abrigo[r.F.idx(x, y)]).length / fim.tiles.length;
    if (cob < 0.5) maus.push(`G${g} infantaria termina fora de cobertura (${Math.round(cob * 100)} %)`);
  }
  for (const g of [G.teams, G.aa, G.rest]) if (P[g - 1].some((e) => e.a >= C.finalPush)) maus.push(`G${g} nao devia investir`);
  if (d.vagas.some((v) => /^ZZ Meet Trig /.test(v.nome))) maus.push('trigger ZZ Meet sobrando');
  if (!IE.codificar(d).equals(pecas(tmp).resto) || d.T !== 0) maus.push('nao le de volta igual');
  if (!IE.codificar(r.d).equals(pecas(base).resto)) maus.push('o 015r regerado difere do pacote');
  if (JSON.stringify(d.vermelho.map((p) => p.slots.map((s) => s.length))) !== JSON.stringify(antes.vermelho.map((p) => p.slots.map((s) => s.length)))) maus.push('vermelho mexido');
  fs.rmSync(tmp, { force: true });
  ok(!maus.length, `(128) assalto direto no 015r: planos ${usados.join(',')} (${r.variantes.map((v) => v.nome).join('/')}), centro do objetivo ${r.Zs.As.geo.centro}, ${r.Zs.As.casasCentro.length} tiles de casas no centro${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 129. A BATALHA DO ENCONTRO NO 015r: forca do encontro da batalha 3, a variante sorteada pela semente entre as do
//      registro, o mapa copiado com so aquele plano usado, e o forge: tipo Meeting Engagement, NINGUEM do azul marcado
//      desmontado (o jogo os embarca, E17), cada unidade no grupo do seu papel (assalto direto: tanques no G1, o
//      pelotao mecanizado DIVIDIDO — esquadras num grupo de infantaria, veiculos no grupo de IFVs), a conferencia limpa e
//      o mapa do pacote intacto. Desde 13/10 o plano e o do PACOTE (registrado em planos_ia.json, encontro: true).
{
  const IE = await import('../tools/re/ia_escrever.mjs');
  const ME = await import('./src/meet.mjs');
  const { abrirCompleto } = await import('../tools/re/anexar2.mjs'); const { arvore } = await import('../tools/re/extras.mjs');
  const TB = await import('../tools/re/tipo_batalha.mjs'); const AG = await import('../tools/re/agrupar.mjs');
  const { buildBattle } = await import('./src/forge.mjs'); const crypto = await import('node:crypto'); const { conferirBtt } = await import('../tools/re/bateria/lib.mjs');
  const { unidadesAzuis } = await import('../tools/re/ia_agrupar.mjs');
  const pacote = path.join(import.meta.dirname, '..', 'assets', 'qb_meet_fora', 'Small Village (976 X 400) 015r Meet CMBSRL.btt');
  const sha0 = crypto.createHash('sha256').update(fs.readFileSync(pacote)).digest('hex');
  const Rm = rules(); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meet129-'));
  const maus = [];
  try {
    const { authoredPlan } = await import('./src/catalog.mjs');
    const registry = authoredPlan(pacote); const autor = pacote;
    if (!registry?.encontro || Object.keys(registry.variantes || {}).join() !== '1,2,3' || registry.doutrina !== 'assalto' || registry.grupos?.tanks !== Rm.meet.assault.groups.tanks) maus.push(`registro ${JSON.stringify(registry?.variantes)} ${registry?.doutrina}`);
    const vs = [1, 2, 3, 4, 5, 6].map((s) => ME.meetVariantFor({ registry, seed: s, battleNumber: 3, rules: Rm }).variant);
    if (new Set(vs).size < 2) maus.push(`sorteio sempre ${vs[0]}`);
    if (ME.meetVariantFor({ registry, seed: 9, battleNumber: 3, rules: Rm }).variant !== ME.meetVariantFor({ registry, seed: 9, battleNumber: 3, rules: Rm }).variant) maus.push('sorteio nao determinista');
    const v = ME.meetVariantFor({ registry, seed: 4, battleNumber: 3, rules: Rm });
    const copia = ME.meetMapCopy({ mapFile: autor, plan: v.plan, workDir: dir });
    const usos = IE.decodificar(copia).azul.map((p) => p.uso);
    if (usos.some((u, k) => u !== (k + 1 === v.plan ? 3 : 0))) maus.push(`usos ${usos}`);
    const forca = ME.planMeetForce({ nation: 'US', nations: ['US', 'UKR'], battleNumber: 3, rules: Rm, seed: 4 });
    const out = path.join(dir, 'b.btt'); const VERM = path.join(import.meta.dirname, '..', 'assets', 'lib', 'RU - Section (Supply).btt');
    const log = console.log; console.log = () => {};
    let b; try { b = await buildBattle({ coreFile: VERM, defense: forca, mapFile: copia, duration: 45, nation: 'RU', enemy: forca.nation, out, rules: Rm, trace: { event() {}, read() {}, wrote() {}, step: async (_n, _d, f) => f() }, attack: 'Meet', title: 'ZZ T129', aiPlan: true, meet: { ...v, sourceMap: pacote, key: registry?.key }, attacker: [{ formacao: VERM }] }); }
    finally { console.log = log; }
    if (TB.ler(out).nome !== 'Meeting Engagement') maus.push('tipo ' + TB.ler(out).nome);
    const X = abrirCompleto(out); const c = X.completo; let desm = 0, n = 0;
    const anda = (no) => { if (!no.r.ausente) { n++; if ((c[no.r.c + 15] >> 5) === 4) desm++; } (no.filhos || []).forEach(anda); };
    arvore(X).azul.forEach(anda);
    if (desm) maus.push(`${desm} de ${n} desmontados`);
    const gs = new Map(AG.grupos(out).map((u) => [u.id, u.grupo]));
    const un = unidadesAzuis(out).filter((u) => !u.ausente);
    const papel = (u) => ME.papelEncontro(u.nome, Rm);
    const tanques = un.filter((u) => papel(u) === 'tank').map((u) => gs.get(u.id));
    const GA = Rm.meet.assault.groups;
    if (tanques.some((g) => g !== GA.tanks)) maus.push(`tanques ${tanques}`);
    const INF = new Set([GA.centreInf, GA.farInfA, GA.farInfC]), VEH = new Set([GA.centreVeh, GA.farVehA, GA.farVehC]);
    let pelotoes = 0;
    for (const pai of new Set(un.map((u) => u.pai))) { const us = un.filter((u) => u.pai === pai); if (!us.some((u) => papel(u) === 'squad')) continue; pelotoes++;
      const gi = new Set(us.filter((u) => papel(u) === 'squad').map((u) => gs.get(u.id))), gv = new Set(us.filter((u) => ['carrier', 'ride'].includes(papel(u))).map((u) => gs.get(u.id)));
      if (gi.size !== 1 || gv.size !== 1 || !INF.has([...gi][0]) || !VEH.has([...gv][0])) maus.push(`pelotao ${[...gi]}/${[...gv]}`); }
    if (!pelotoes) maus.push('nenhum pelotao mecanizado');
    const cb = conferirBtt(out); if (cb.erros.length) maus.push('conferirBtt ' + cb.erros.slice(0, 2).join('; '));
    if (b.aiPlan.meet?.variant !== v.variant || b.aiPlan.meet?.doutrina !== 'assalto' || b.aiPlan.groups[GA.tanks]?.role !== 'tanks' || b.aiPlan.noZone.length) maus.push(`relatorio ${JSON.stringify(b.aiPlan.meet)} sem zona ${b.aiPlan.noZone}`);
    if (crypto.createHash('sha256').update(fs.readFileSync(pacote)).digest('hex') !== sha0) maus.push('pacote mexido');
    ok(!maus.length, `(129) batalha do encontro no 015r: variante ${v.variant} (plano ${v.plan}; sorteios ${vs.join('/')}), ${b.aiPlan.units} unidades, ${n} registros azuis montados, tanques ${JSON.stringify(tanques)}${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// 130. A CAMPANHA MONTA ENCONTROS (13/10/2026, autor: "20 %, mas so nos mapas com plano autoral"). O pool de encontro
//      e so o 015r (o unico com plano de encontro); com `meetShare` 1 toda a linha 1 do caminho vira encontro no 015r,
//      com a forca do encontro (cascata, mix, custo em 1x); nenhum caminho repete o 015r (o filho de um encontro fica no
//      tipo de sempre) e nenhum encontro sai do tier 1. `meetBuildInputs`: variante pela semente, copia com so aquele
//      plano, chave do registro; um Meet sem plano devolve null. O forge com essas entradas: Meeting Engagement, nada
//      desmontado, todas as unidades com zona. O briefing do encontro fala de encontro e le o mix.
{
  const P = await import('./src/path.mjs'); const ME = await import('./src/meet.mjs'); const CAT = await import('./src/catalog.mjs');
  const C = await import('./src/campaign.mjs'); const IE = await import('../tools/re/ia_escrever.mjs'); const TB = await import('../tools/re/tipo_batalha.mjs');
  const { buildBattle } = await import('./src/forge.mjs'); const crypto = await import('node:crypto');
  const Rm = JSON.parse(JSON.stringify(rules())); Rm.path.meetShare = 1;
  const maus = [];
  // desde 24/10 o pool tem sete mapas (os quatro "b1" -- 015r, 306, 024r, 018r -- sairam: pequenos demais): o 313 e o 012r (roteiro) nos tiers 1-2
  // e o 282 (roteiro, lados trocados), o 307, o 077r e o 012r (roteiro) no tier 3; Balalaikas e 315 (roteiro) no tier 4
  const pool = CAT.meetPool(null, [], 0, Rm).sort((a, b) => (a.f < b.f ? -1 : 1)); const nomes = pool.map((m) => CAT.mapKey(m.f));
  if (nomes.join() !== 'dueling balalaikas (2320 x 1488),hills-farmland (1344 x 848) 282,hills-open-farmland (752 x 1104) 307,open-hills (1248 x 1200) 315,open-rural (944 x 848) 313,rough-village (1072 x 896) 077r,village-forest (928 x 922) 012r') maus.push(`pool ${nomes}`);
  const semFiltro = CAT.meetPool(1, [], 0, { ...Rm, path: { ...Rm.path, meetOnlyAuthored: false } });
  if (semFiltro.length <= pool.filter((m) => m.tier === 1).length) maus.push(`sem o filtro autoral so ${semFiltro.length}`);
  let encontros = 0;
  for (const seed of [130, 2026]) {
    const p = P.generatePath({ seed, rules: Rm, enemy: { nation: 'US', nations: ['US', 'UKR'], effort: 1 }, fits: 12 });
    const anc = P.ancestorsOf(p.nodes); const byId = new Map(p.nodes.map((n) => [n.id, n]));
    for (const n of p.nodes.filter((x) => x.row > 0)) {
      const meet = n.kind === 'Meet';
      if (n.row === 1 && !meet) maus.push(`${seed} ${n.id} nao e encontro`);
      if (!meet) continue;
      encontros++;
      if (!pool.some((m) => CAT.meetFits(m, new Set(tierOf(n.row, Rm).mapTiers || [tierOf(n.row, Rm).tier]), n.row))) maus.push(`${seed} ${n.id} encontro numa batalha sem mapa de encontro`);
      if (!nomes.includes(CAT.mapKey(n.map.f)) || n.map.tipo !== 'Meet') maus.push(`${seed} ${n.id} mapa ${n.map.f}`);
      const d = n.defense;
      if (d.kind !== 'Meet' || !d.meet?.cascade?.length || !(d.units > 0) || !d.mix || Math.abs(Object.values(d.mix).reduce((a, v) => a + v, 0) - 1) > 0.03) maus.push(`${seed} ${n.id} forca ${d.kind} ${d.units} ${JSON.stringify(d.mix)}`);
      if ([...anc.get(n.id)].some((a) => byId.get(a).map && (byId.get(a).map.familia || byId.get(a).map.f) === (n.map.familia || n.map.f))) maus.push(`${seed} ${n.id} repete o mapa no caminho`);
    }
  }
  // as entradas do forge
  const pacote = CAT.mapFile(pool[0]); const sha0 = crypto.createHash('sha256').update(fs.readFileSync(pacote)).digest('hex');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meet130-'));
  let mi = null, b = null;
  try {
    mi = ME.meetBuildInputs({ mapFile: pacote, seed: 77, battleNumber: 2, rules: Rm, workDir: dir });
    const de2 = ME.meetBuildInputs({ mapFile: pacote, seed: 77, battleNumber: 2, rules: Rm, workDir: path.join(dir, 'b') });
    if (!mi || mi.meet.variant !== de2.meet.variant || mi.meet.key !== CAT.authoredPlan(pacote).key || mi.meet.sourceMap !== pacote) maus.push(`entradas ${JSON.stringify(mi?.meet)}`);
    const usos = IE.decodificar(mi.mapFile).azul.map((x) => x.uso);
    if (usos.some((u, k) => u !== (k + 1 === mi.meet.plan ? 3 : 0))) maus.push(`usos ${usos}`);
    const outro = CAT.meetCensus().find((m) => !nomes.includes(CAT.mapKey(m.f)));
    if (outro && ME.meetBuildInputs({ mapFile: CAT.mapFile(outro), seed: 1, battleNumber: 1, rules: Rm, workDir: dir }) !== null) maus.push('Meet sem plano devolveu entradas');
    const forca = ME.planMeetForce({ nation: 'US', nations: ['US', 'UKR'], battleNumber: 2, rules: Rm, seed: 77 });
    const out = path.join(dir, 'b.btt'); const VERM = path.join(import.meta.dirname, '..', 'assets', 'lib', 'RU - Section (Supply).btt');
    const eventos = [];
    const log = console.log; console.log = () => {};
    try { b = await buildBattle({ coreFile: VERM, defense: forca, mapFile: mi.mapFile, duration: 45, nation: 'RU', enemy: forca.nation, out, rules: Rm, trace: { event(n, d) { eventos.push([n, d]); }, read() {}, wrote() {}, step: async (_n, _d, fn) => fn() }, attack: 'Meet', title: 'ZZ T130', meet: mi.meet }); }
    finally { console.log = log; }
    if (TB.ler(out).nome !== 'Meeting Engagement') maus.push('tipo ' + TB.ler(out).nome);
    const desm = eventos.find(([n]) => n === 'battle.dismounted')?.[1];
    if (!desm || desm.units !== 0) maus.push(`desmontados ${JSON.stringify(desm)}`);
    if (b.aiPlan.meet?.variant !== mi.meet.variant || b.aiPlan.noZone.length || b.aiPlan.key !== mi.meet.key) maus.push(`relatorio ${JSON.stringify(b.aiPlan.meet)} ${b.aiPlan.key} sem zona ${b.aiPlan.noZone}`);
    const brief = C.briefingFor({ state: { name: 'ZZ', history: [], defeatsLeft: 2, units: [], picks: [] }, n: 2, map: { ...pool[0] }, duration: 45, defense: forca, intel: true, R: Rm }).vermelho.join('\n');
    if (!/Meeting engagement/.test(brief) || !/tanks \d+%/.test(brief) || / Meet\b/.test(brief.split('\n').find((l) => l.startsWith('Map:')) || '')) maus.push('briefing: ' + brief.replace(/\n/g, ' | ').slice(0, 160));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  if (crypto.createHash('sha256').update(fs.readFileSync(pacote)).digest('hex') !== sha0) maus.push('pacote mexido');
  ok(!maus.length, `(130) a campanha monta encontros: pool ${pool.length} (${semFiltro.length} sem o filtro autoral), ${encontros} nos de encontro em 2 caminhos, variante ${mi?.meet.variant} (plano ${mi?.meet.plan}), ${b?.aiPlan.units} unidades com zona${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 131. A DOUTRINA DE TERRENO ABERTO NO OPEN-RURAL 306 (autor 13/10): o objetivo e um anel em volta da vila, o miolo
//      entra na area; os pesados em dois grupos assaltam o objetivo na hora zero; a parcela 1 desembarca nas casas do
//      objetivo (Passengers Dismount numa zona com as casas) e os IFVs ficam atras delas; a parcela 2 desembarca atras da
//      floresta, os IFVs voltam ao setup coberto (dentro do azul) aos 10:00 e sobem pela borda; as equipes vao a pe a
//      borda da floresta; AA e resto so Setup; aos 35:00 os blindados em lances ate 3/4. Dois planos (flankLeft/
//      flankRight) e o flanco muda de lado entre eles; lê de volta igual, formato antigo, vermelho intacto.
{
  const ENC = await import('../tools/re/ia_encontro.mjs');
  const IE = await import('../tools/re/ia_escrever.mjs');
  const { pecas } = await import('../tools/re/mapa_escrever.mjs');
  const base = path.join(import.meta.dirname, '..', 'assets', 'qb_meet_fora', 'Open-Rural (672 X 720) 306 Meet CMBSRL.btt');
  const Rm = rules(); const G = Rm.meet.aberto.groups, C = Rm.meet.aberto.clock;
  const antes = IE.decodificar(base);
  const r = ENC.aplicarDoutrinaEncontro(base, { duracaoMin: 45, doctrine: Rm.meet.doctrine, assault: Rm.meet.assault, aberto: Rm.meet.aberto, modo: 'aberto' });
  const tmp = path.join(os.tmpdir(), `meet131-${process.pid}.btt`); IE.gravar(base, tmp, r.d);
  const d = IE.decodificar(tmp); const maus = [];
  const F = r.F, Ab = r.Zs.Ab, prog = r.geo.prog, lat = r.geo.lat, key = ([x, y]) => F.idx(x, y);
  const azul = new Set(F.azuis); const usados = d.azul.map((p, k) => (p.uso ? k + 1 : null)).filter(Boolean);
  if (r.modo !== 'aberto' || usados.join() !== '1,2' || r.variantes.map((v) => v.nome).join() !== 'flankLeft,flankRight') maus.push(`modo ${r.modo}, planos ${usados}`);
  // as zonas
  const area = new Set(Ab.objArea.map(key));
  if (Ab.objArea.length < 900) maus.push(`objArea ${Ab.objArea.length}`);
  const pC = r.Zs.As.geo.pCentro;
  if (Ab.casasObjetivo.length !== 16 || Ab.casasJogador.length !== 16 || Ab.casasObjetivo.some(([x, y]) => prog(x, y) > pC + 1) || Ab.casasJogador.some(([x, y]) => prog(x, y) < pC - 1)) maus.push(`casas ${Ab.casasObjetivo.length}/${Ab.casasJogador.length}`);
  if (!Ab.bordaMata.length || Ab.bordaMata.some(([x, y]) => !F.floresta[key([x, y])] || prog(x, y) <= r.geo.pStart || prog(x, y) >= r.geo.pNear)) maus.push('bordaMata fora da mata ou da faixa');
  const pMata = Math.min(...Ab.bordaMata.map(([x, y]) => prog(x, y)));
  if (!Ab.atrasMata.length || Ab.atrasMata.some(([x, y]) => F.floresta[key([x, y])] || F.predio[key([x, y])] || prog(x, y) >= pMata)) maus.push('atrasMata');
  for (const fl of ['A', 'C']) {
    if (!Ab['setupCoberto_' + fl].length || Ab['setupCoberto_' + fl].some((t) => !azul.has(key(t)))) maus.push('setupCoberto_' + fl);
    const lz = Ab['flancoLonge_' + fl].map(([x, y]) => lat(x, y)); const pz = Ab['flancoLonge_' + fl].map(([x, y]) => prog(x, y));
    if (lz.some((l) => (fl === 'A' ? l < 0.9 : l > 0.1)) || pz.some((p) => Math.abs(p - (r.Zs.As.geo.pRed - 15)) > 3 + 8)) maus.push('flancoLonge_' + fl);
  }
  if (!Ab.vigia.length || Ab.vigia.some((t) => F.floresta[key(t)] || F.predio[key(t)] || F.dMata[key(t)] > 2)) maus.push('vigia');
  // as cadeias
  const tipo = (e) => e.prefixo[1], ASSALTO = IE.TIPO_ORDEM.Assault, SETUP = 2;
  const noAzul = (e) => IE.doMapa(d, e.tiles).every((t) => azul.has(key(t)));
  const p34 = r.Zs.As.geo.p34, pMedio = (e) => { const t = IE.doMapa(d, e.tiles); return t.reduce((a, [x, y]) => a + prog(x, y), 0) / t.length; };
  for (const p of [1, 2]) {
    const S = d.azul[p - 1].slots;
    S.forEach((sl, g) => { if (!sl.length || !sl[0].tiles.length) return;
      if (tipo(sl[0]) !== SETUP || !noAzul(sl[0])) maus.push(`P${p} G${g + 1} Setup`);
      if (sl.some((e) => e.a % 30 || e.b % 30 || e.a > e.b)) maus.push(`P${p} G${g + 1} janela`); });
    for (const g of [G.tanksA, G.tanksC]) { const sl = S[g - 1]; if (sl[0].a !== 0 || tipo(sl[1]) !== ASSALTO || !IE.doMapa(d, sl[1].tiles).every((t) => area.has(key(t)))) maus.push(`P${p} G${g} nao assalta o objetivo na hora zero`); }
    const cv = S[G.centreVeh - 1];
    if (cv[1].prefixo[0] !== 1 || !IE.doMapa(d, cv[1].tiles).some((t) => F.predio[key(t)]) || cv[2].a !== C.finalPush) maus.push(`P${p} IFVs do centro`);
    const fv = S[G.forestVeh - 1];
    if (fv[1].prefixo[0] !== 1 || !noAzul(fv[2]) || fv[2].a !== C.forestEdge) maus.push(`P${p} IFVs da floresta`);
    const fi = S[G.forestInf - 1];
    if (fi[1].a !== C.finalPush || !IE.doMapa(d, fi[fi.length - 1].tiles).some((t) => Ab.casasJogador.some((c) => key(c) === key(t)))) maus.push(`P${p} esquadras da floresta`);
    if (S[G.teamVeh - 1][1].prefixo[0] !== 1) maus.push(`P${p} transporte das equipes nao desembarca`);
    if ([G.centreInf, G.forestInf, G.teams].some((g) => S[g - 1].some((e, k) => k && e.prefixo[0]))) maus.push(`P${p} infantaria com desembarque`);
    if (S[G.aa - 1].length !== 1 || S[G.rest - 1].length !== 1 || S.slice(12).some((sl) => sl.length > 1 || sl[0]?.tiles.length)) maus.push(`P${p} AA/resto/vazios`);
    for (const g of [G.tanksA, G.tanksC, G.lightOver, G.centreVeh, G.lightFlank, G.forestVeh]) {
      const sl = S[g - 1], u = sl[sl.length - 1];
      if (tipo(u) !== ASSALTO || Math.abs(pMedio(u) - p34) > 4 || !sl.some((e) => e.a === C.finalPush)) maus.push(`P${p} G${g} investida (${pMedio(u).toFixed(1)})`);
    }
    if ([G.centreInf, G.teams, G.teamVeh, G.aa, G.rest].some((g) => S[g - 1].some((e) => e.a >= C.finalPush))) maus.push(`P${p} quem fica investiu`);
  }
  // a ordem na borda do meio do mapa (flancoMeio): G4 a 3a ordem, G7 a 5a
  const ladoDe = (p, g) => { const t = IE.doMapa(d, d.azul[p - 1].slots[g - 1][g === G.lightFlank ? 2 : 4].tiles); return t.reduce((a, [x, y]) => a + lat(x, y), 0) / t.length; };
  for (const g of [G.lightFlank, G.forestVeh]) if (!(ladoDe(1, g) > 0.9 && ladoDe(2, g) < 0.1)) maus.push(`G${g} nao troca de flanco (${ladoDe(1, g).toFixed(2)} / ${ladoDe(2, g).toFixed(2)})`);
  if (d.vagas.some((v) => /^ZZ Meet Trig /.test(v.nome))) maus.push('trigger ZZ Meet');
  if (!IE.codificar(d).equals(pecas(tmp).resto) || d.T !== 0) maus.push('nao le de volta igual');
  if (JSON.stringify(d.vermelho.map((p) => p.slots.map((s) => s.length))) !== JSON.stringify(antes.vermelho.map((p) => p.slots.map((s) => s.length)))) maus.push('vermelho mexido');
  fs.rmSync(tmp, { force: true });
  ok(!maus.length, `(131) terreno aberto no 306: planos ${usados} (${r.variantes.map((v) => v.nome).join('/')}), area do objetivo ${Ab.objArea.length}, casas ${Ab.casasObjetivo.length}+${Ab.casasJogador.length}, borda da mata ${Ab.bordaMata.length}, atras ${Ab.atrasMata.length}, vigia ${Ab.vigia.length}${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 132. A ALOCACAO DO TERRENO ABERTO: a forca do encontro da batalha 3 (US+UKR, semente 11: dois pelotoes mecanizados)
//      no plano flankLeft do 306 (gravado num temporario), pelo forge com a doutrina e a tabela do registro: Meeting
//      Engagement, ninguem desmontado, todo grupo com zona; tanques e recon em G1/G2 (alternando), o pelotao mais caro
//      dividido em G5 (veiculos) / G6 (esquadras), o outro em G7/G8, leves em G3/G4, transporte das equipes no G9, equipes
//      no G10, nada em 13-16, os papeis do relatorio = a tabela; e o despacho por doutrina (assalto/aberto/desconhecida).
{
  const ENC = await import('../tools/re/ia_encontro.mjs');
  const IE = await import('../tools/re/ia_escrever.mjs');
  const ME = await import('./src/meet.mjs');
  const { abrirCompleto } = await import('../tools/re/anexar2.mjs'); const { arvore } = await import('../tools/re/extras.mjs');
  const TB = await import('../tools/re/tipo_batalha.mjs'); const AG = await import('../tools/re/agrupar.mjs');
  const { buildBattle } = await import('./src/forge.mjs'); const { conferirBtt } = await import('../tools/re/bateria/lib.mjs');
  const { unidadesAzuis } = await import('../tools/re/ia_agrupar.mjs');
  const base = path.join(import.meta.dirname, '..', 'assets', 'qb_meet_fora', 'Open-Rural (672 X 720) 306 Meet CMBSRL.btt');
  const Rm = rules(); const G = Rm.meet.aberto.groups; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meet132-'));
  const maus = []; let b = null, n = 0;
  try {
    const r = ENC.aplicarDoutrinaEncontro(base, { duracaoMin: 45, doctrine: Rm.meet.doctrine, assault: Rm.meet.assault, aberto: Rm.meet.aberto, modo: 'aberto', usos: { flankLeft: 'Used Frequently', flankRight: 'Not Used' } });
    const mapa = path.join(dir, 'mapa.btt'); IE.gravar(base, mapa, r.d);
    // a primeira semente que compra dois pelotoes mecanizados (29/10: a semente fixa quebrava a cada revisao de precos)
    let forca = null; for (let sd = 1; sd <= 60 && !forca; sd++) { const f2 = ME.planMeetForce({ nation: 'US', nations: ['US', 'UKR'], battleNumber: 3, rules: Rm, seed: sd }); if (f2.lots.filter((l) => l.tipo === 'mech').length === 2) forca = f2; }
    if (!forca) throw new Error('nenhuma semente de 1 a 60 compra dois pelotoes mecanizados na batalha 3');
    const out = path.join(dir, 'b.btt'); const VERM = path.join(import.meta.dirname, '..', 'assets', 'lib', 'RU - Section (Supply).btt');
    const eventos = []; const log = console.log; console.log = () => {};
    try { b = await buildBattle({ coreFile: VERM, defense: forca, mapFile: mapa, duration: 45, nation: 'RU', enemy: forca.nation, out, rules: Rm, trace: { event(k, v) { eventos.push([k, v]); }, read() {}, wrote() {}, step: async (_n, _d, fn) => fn() }, attack: 'Meet', title: 'ZZ T132', aiPlan: true, meet: { variant: 'flankLeft', plan: 1, shares: Rm.meet.variants.balanced, sourceMap: null, key: null, doutrina: 'aberto', grupos: G }, attacker: [{ formacao: VERM }] }); }
    finally { console.log = log; }
    if (TB.ler(out).nome !== 'Meeting Engagement') maus.push('tipo ' + TB.ler(out).nome);
    const X = abrirCompleto(out); const c = X.completo; let desm = 0;
    const anda = (no) => { if (!no.r.ausente) { n++; if ((c[no.r.c + 15] >> 5) === 4) desm++; } (no.filhos || []).forEach(anda); };
    arvore(X).azul.forEach(anda);
    if (desm) maus.push(`${desm} de ${n} desmontados`);
    if (b.aiPlan.noZone.length || b.aiPlan.meet?.doutrina !== 'aberto') maus.push(`sem zona ${b.aiPlan.noZone} doutrina ${b.aiPlan.meet?.doutrina}`);
    for (const [k, v] of Object.entries(G)) if (b.aiPlan.groups[v] && b.aiPlan.groups[v].role !== k) maus.push(`G${v} papel ${b.aiPlan.groups[v].role}`);
    const gs = new Map(AG.grupos(out).map((u) => [u.id, u.grupo]));
    const todas = unidadesAzuis(out); const un = todas.filter((u) => !u.ausente);
    // o papel como o app o ve: com os nomes dos irmaos do pelotao (o HMMWV do observador e transporte, nao leve)
    const papel = (u) => ME.papelEncontro(u.nome, Rm, { leafNames: todas.filter((x) => x.pai === u.pai).map((x) => x.nome) });
    const em = (pp) => un.filter((u) => papel(u) === pp).map((u) => gs.get(u.id));
    const tq = em('tank');
    if (tq.some((g) => g !== G.tanksA && g !== G.tanksC) || Math.abs(tq.filter((g) => g === G.tanksA).length - tq.filter((g) => g === G.tanksC).length) > 1) maus.push(`tanques ${tq}`);
    if (em('recon').some((g) => g !== G.tanksA && g !== G.tanksC)) maus.push(`recon ${em('recon')}`);
    const pares = [];
    for (const pai of new Set(un.map((u) => u.pai))) { const us = un.filter((u) => u.pai === pai); if (!us.some((u) => papel(u) === 'squad')) continue;
      const gi = [...new Set(us.filter((u) => papel(u) === 'squad').map((u) => gs.get(u.id)))], gv = [...new Set(us.filter((u) => papel(u) === 'carrier').map((u) => gs.get(u.id)))];
      pares.push(gi.join() + '/' + gv.join()); }
    if (pares.sort().join(' ') !== `${G.centreInf}/${G.centreVeh} ${G.forestInf}/${G.forestVeh}`) maus.push(`pelotoes ${pares}`);
    const lv = em('light');
    if (lv.some((g) => g !== G.lightOver && g !== G.lightFlank) || !lv.includes(G.lightFlank)) maus.push(`leves ${lv}`);
    if (em('team').some((g) => g !== G.teams && g !== G.lightOver && g !== G.lightFlank)) maus.push(`equipes ${em('team')}`);
    if (em('ride').some((g) => g !== G.teamVeh && g !== G.lightOver && g !== G.lightFlank)) maus.push(`rides ${em('ride')}`);
    if ([...gs.values()].some((g) => g > G.rest)) maus.push('unidade em 13-16');
    const cb = conferirBtt(out); if (cb.erros.length) maus.push('conferirBtt ' + cb.erros.slice(0, 2).join('; '));
    // o despacho e pela doutrina, nao pelo nome da variante
    const uns = [{ id: 1, nome: 'Tank (T-72B3)', pai: 9 }];
    const gA = ME.meetGroups(uns.map((u) => ({ ...u })), { rules: Rm, variant: 'flankLeft', doutrina: 'assalto' }).grupo.get(1);
    const gB = ME.meetGroups(uns.map((u) => ({ ...u })), { rules: Rm, variant: 'flankLeft', doutrina: 'aberto' }).grupo.get(1);
    let desconhecida = null; try { ME.meetGroups(uns, { rules: Rm, doutrina: 'fumaca' }); } catch (e) { desconhecida = e.message; }
    if (gA !== Rm.meet.assault.groups.tanks || gB !== G.tanksA || !/unknown meet doctrine/.test(desconhecida || '')) maus.push(`despacho ${gA}/${gB}/${desconhecida}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  ok(!maus.length, `(132) alocacao do terreno aberto: ${b?.aiPlan.units} unidades, ${n} registros azuis montados, grupos ${JSON.stringify(Object.fromEntries(Object.entries(b?.aiPlan.groups || {}).map(([g, v]) => [g, v.units.length])))}${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 133. A DOUTRINA POSICIONAL NO 024r (autor 14/10, com o desenho dele): as marcas do mapa (research/ia/...024r.meet.
//      ajustes.json) viram as zonas; dois planos (forest/flank). Pesados e recon assaltam o lado azul do objetivo junto a
//      rua na hora zero; a mecanizada desmonta na linha vermelha (forest) ou nas arvores do comeco da seta (flank) e na
//      amarela (as casas do lado azul); flank: lances pela seta a cada infBoundEvery s, o ultimo esperando os 35:00; aos
//      35:00 a infantaria toma o resto da cidade e ninguem passa do objetivo; leves e equipes na linha verde; AA e resto
//      so Setup. Le de volta igual, vermelho intacto; 015r e 306 regerados = os pacotes, byte a byte.
{
  const ENC = await import('../tools/re/ia_encontro.mjs');
  const IE = await import('../tools/re/ia_escrever.mjs');
  const { pecas } = await import('../tools/re/mapa_escrever.mjs');
  const pasta = path.join(import.meta.dirname, '..', 'assets', 'qb_meet_fora');   // 24/10: os quatro mapas b1 sairam do pacote e ficaram como amostra
  const base = path.join(pasta, 'Small Hills-Forest-Village (368 X592) 024r Meet CMBSRL.btt');
  const ajustes = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'research', 'ia', 'small_hills_forest_village_024r.meet.ajustes.json'), 'utf8'));
  const Rm = rules(); const G = Rm.meet.posicional.groups, C = Rm.meet.posicional.clock;
  const opc = { duracaoMin: 45, doctrine: Rm.meet.doctrine, assault: Rm.meet.assault, aberto: Rm.meet.aberto, posicional: Rm.meet.posicional };
  const antes = IE.decodificar(base);
  const r = ENC.aplicarDoutrinaEncontro(base, { ...opc, ajustes, modo: 'posicional' });
  const tmp = path.join(os.tmpdir(), `meet133-${process.pid}.btt`); IE.gravar(base, tmp, r.d);
  const d = IE.decodificar(tmp); const maus = [];
  const F = r.F, Po = r.Zs.Po, prog = r.geo.prog, key = ([x, y]) => F.idx(x, y);
  const azul = new Set(F.azuis); const usados = d.azul.map((p, k) => (p.uso ? k + 1 : null)).filter(Boolean);
  if (r.modo !== 'posicional' || usados.join() !== '1,2' || r.variantes.map((v) => v.nome).join() !== 'forest,flank') maus.push(`modo ${r.modo}, planos ${usados}`);
  const area = new Set(Po.objetivoTodo.map(key)); const tiles = (e) => IE.doMapa(d, e.tiles);
  const temCasa = (e) => tiles(e).some((t) => F.predio[key(t)]);
  const tipo = (e) => e.prefixo[1], ASSALTO = IE.TIPO_ORDEM.Assault, SETUP = 2;
  const pz = (e) => { const t = tiles(e); return t.reduce((a, [x, y]) => a + prog(x, y), 0) / t.length; };
  for (const p of [1, 2]) {
    const S = d.azul[p - 1].slots;
    S.forEach((sl, g) => { if (!sl.length || !sl[0].tiles.length) return;
      if (tipo(sl[0]) !== SETUP || !tiles(sl[0]).every((t) => azul.has(key(t)))) maus.push(`P${p} G${g + 1} Setup`);
      if (sl.some((e) => e.a % 30 || e.b % 30 || e.a > e.b)) maus.push(`P${p} G${g + 1} janela`);
      if (sl.slice(1).some((e) => pz(e) > r.geo.pFar + 1)) maus.push(`P${p} G${g + 1} passa do objetivo`); });
    const tq = S[G.tanks - 1];
    if (tq[0].a !== 0 || tipo(tq[1]) !== ASSALTO || !tiles(tq[1]).every((t) => area.has(key(t))) || tq[1].a !== C.finalPush) maus.push(`P${p} pesados`);
    for (const g of [G.redVeh, G.yellowVeh, G.teams]) { const sl = S[g - 1]; if (!sl.some((e) => e.prefixo[0] === 1)) maus.push(`P${p} G${g} sem desembarque`); }
    if (!temCasa(S[G.yellowVeh - 1][1])) maus.push(`P${p} desembarque amarelo sem as casas`);
    for (const g of [G.redInf, G.yellowInf]) { const sl = S[g - 1], u = sl[sl.length - 1];
      if (tipo(u) !== ASSALTO || !temCasa(u) || sl[sl.length - 2].a !== C.finalPush) maus.push(`P${p} G${g} nao toma o resto da cidade aos 35:00`);
      if (sl.some((e, k) => k && e.prefixo[0])) maus.push(`P${p} G${g} infantaria com desembarque`); }
    const lv = S[G.lightOver - 1];
    if (lv[1].a !== C.finalPush || !tiles(lv[2]).every((t) => area.has(key(t)))) maus.push(`P${p} leves`);
    if (S[G.aa - 1].length !== 1 || S[G.rest - 1].length !== 1 || S.slice(9).some((sl) => sl.length > 1 || sl[0]?.tiles.length)) maus.push(`P${p} AA/resto/vazios`);
  }
  // a variante flank: o vermelho desmonta no comeco da seta e sobe em lances, o ultimo esperando os 35:00
  const fl = d.azul[1].slots[G.redInf - 1];
  const lances = fl.slice(2, -1);
  if (lances.length !== Po.setaLances.length || lances.slice(0, -1).some((e, k) => e.a !== (C.flankStart ?? 240) + (k + 1) * C.infBoundEvery) || lances[lances.length - 1].a !== C.finalPush) maus.push(`seta: janelas ${fl.map((e) => e.a)}`);
  const cent = (e) => { const t = tiles(e); return [t.reduce((a, q) => a + q[0], 0) / t.length, t.reduce((a, q) => a + q[1], 0) / t.length]; };
  for (let k = 1; k < fl.length - 1; k++) { const [ax, ay] = cent(fl[k]), [bx, by] = cent(fl[k + 1]); if (k + 1 < fl.length - 1 && Math.hypot(bx - ax, by - ay) > C.infBoundTiles + 4) maus.push(`lance ${k} longo (${Math.hypot(bx - ax, by - ay).toFixed(1)})`); }
  if (d.azul[0].slots[G.redVeh - 1][1].tiles.length === d.azul[1].slots[G.redVeh - 1][1].tiles.length && JSON.stringify(tiles(d.azul[0].slots[G.redVeh - 1][1])) === JSON.stringify(tiles(d.azul[1].slots[G.redVeh - 1][1]))) maus.push('o desembarque vermelho nao muda entre forest e flank');
  if (d.vagas.some((v) => /^ZZ Meet Trig /.test(v.nome))) maus.push('trigger ZZ Meet');
  if (!IE.codificar(d).equals(pecas(tmp).resto) || d.T !== 0) maus.push('nao le de volta igual');
  if (JSON.stringify(d.vermelho.map((p) => p.slots.map((s) => s.length))) !== JSON.stringify(antes.vermelho.map((p) => p.slots.map((s) => s.length)))) maus.push('vermelho mexido');
  fs.rmSync(tmp, { force: true });
  // os pacotes registrados continuam saindo iguais do escritor
  const p015 = path.join(pasta, 'Small Village (976 X 400) 015r Meet CMBSRL.btt'), p306 = path.join(pasta, 'Open-Rural (672 X 720) 306 Meet CMBSRL.btt');
  const log = console.log; console.log = () => {};
  try {
    if (!IE.codificar(ENC.aplicarDoutrinaEncontro(p015, { ...opc, modo: 'assalto' }).d).equals(pecas(p015).resto)) maus.push('015r mudou');
    if (!IE.codificar(ENC.aplicarDoutrinaEncontro(p306, { ...opc, modo: 'aberto' }).d).equals(pecas(p306).resto)) maus.push('306 mudou');
    // o 024r registrado (14/10) e o plano regerado com os Support Targets do autor: 2 fumacas e 2 supressoes azuis
    if (!IE.codificar(ENC.aplicarDoutrinaEncontro(base, { ...opc, ajustes, modo: 'posicional' }).d).equals(pecas(base).resto)) maus.push('024r mudou');
    const alvos = IE.alvosDeApoio(IE.decodificar(base));
    if (alvos.find((L) => L.lado === 0)?.alvos.map((a) => a.nome).join() !== 'Smoke,Smoke,Suppress,Suppress' || !IE.codificarAlvos(alvos).equals(IE.decodificar(base).cauda)) maus.push('alvos de apoio do 024r');
  } finally { console.log = log; }
  ok(!maus.length, `(133) posicional no 024r: planos ${usados} (${r.variantes.map((v) => v.nome).join('/')}), vermelha ${Po.linhaVermelha.length}, amarela ${Po.linhaAmarela.length}, verde ${Po.linhaVerde.length}, seta ${Po.setaLances.length} lances, resto da cidade ${Po.restoCidade.length}${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 134. A ALOCACAO POSICIONAL: a forca da batalha 3 (US+UKR, semente 11, dois pelotoes) com o morteiro garantido, no plano
//      flank do 024r (temporario), pelo forge: Meeting Engagement, ninguem desmontado, todo grupo no mapa com zona; o
//      pelotao mais caro no vermelho (3 veiculos / 4 esquadras), o outro no amarelo (5/6), tanques e recon no G1, leves no
//      G2, equipes e o transporte delas no G7, o morteiro fora do mapa no G9 sem posicao, nada em 10-16.
{
  const ENC = await import('../tools/re/ia_encontro.mjs');
  const IE = await import('../tools/re/ia_escrever.mjs');
  const ME = await import('./src/meet.mjs');
  const { abrirCompleto } = await import('../tools/re/anexar2.mjs'); const { arvore } = await import('../tools/re/extras.mjs');
  const TB = await import('../tools/re/tipo_batalha.mjs'); const AG = await import('../tools/re/agrupar.mjs');
  const { buildBattle } = await import('./src/forge.mjs'); const { conferirBtt } = await import('../tools/re/bateria/lib.mjs');
  const { unidadesAzuis } = await import('../tools/re/ia_agrupar.mjs');
  const base = path.join(import.meta.dirname, '..', 'assets', 'qb_meet_fora', 'Small Hills-Forest-Village (368 X592) 024r Meet CMBSRL.btt');
  const ajustes = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'research', 'ia', 'small_hills_forest_village_024r.meet.ajustes.json'), 'utf8'));
  const Rm = rules(); const G = Rm.meet.posicional.groups; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meet134-'));
  const maus = []; let b = null, n = 0;
  try {
    const r = ENC.aplicarDoutrinaEncontro(base, { duracaoMin: 45, doctrine: Rm.meet.doctrine, assault: Rm.meet.assault, posicional: Rm.meet.posicional, ajustes, modo: 'posicional', usos: { forest: 'Not Used', flank: 'Used Frequently' } });
    const mapa = path.join(dir, 'mapa.btt'); IE.gravar(base, mapa, r.d);
    // a primeira semente com dois pelotoes mecanizados e o morteiro garantido (29/10: nada de semente fixa, ver 132)
    let forca = null; for (let sd = 1; sd <= 60 && !forca; sd++) { const f2 = ME.planMeetForce({ nation: 'US', nations: ['US', 'UKR'], battleNumber: 3, rules: Rm, seed: sd, garantias: { morteiro: true } }); if (f2.lots.filter((l) => l.tipo === 'mech').length === 2 && f2.offMapUnits === 1) forca = f2; }
    if (!forca) throw new Error('nenhuma semente de 1 a 60 compra dois pelotoes e o morteiro na batalha 3');
    const out = path.join(dir, 'b.btt'); const VERM = path.join(import.meta.dirname, '..', 'assets', 'lib', 'RU - Section (Supply).btt');
    const log = console.log; console.log = () => {};
    try { b = await buildBattle({ coreFile: VERM, defense: forca, mapFile: mapa, duration: 45, nation: 'RU', enemy: forca.nation, out, rules: Rm, trace: { event() {}, read() {}, wrote() {}, step: async (_n, _d, fn) => fn() }, attack: 'Meet', title: 'ZZ T134', aiPlan: true, meet: { variant: 'flank', plan: 2, shares: Rm.meet.variants.balanced, sourceMap: null, key: null, doutrina: 'posicional', grupos: G }, attacker: [{ formacao: VERM }] }); }
    finally { console.log = log; }
    if (TB.ler(out).nome !== 'Meeting Engagement') maus.push('tipo ' + TB.ler(out).nome);
    const X = abrirCompleto(out); const c = X.completo; let desm = 0;
    const anda = (no) => { if (!no.r.ausente) { n++; if ((c[no.r.c + 15] >> 5) === 4) desm++; } (no.filhos || []).forEach(anda); };
    arvore(X).azul.forEach(anda);
    if (desm) maus.push(`${desm} de ${n} desmontados`);
    if (b.aiPlan.noZone.length || b.aiPlan.meet?.doutrina !== 'posicional' || b.aiPlan.offMap !== 1) maus.push(`sem zona ${b.aiPlan.noZone}, doutrina ${b.aiPlan.meet?.doutrina}, fora do mapa ${b.aiPlan.offMap}`);
    for (const [k, v] of Object.entries(G)) if (b.aiPlan.groups[v] && b.aiPlan.groups[v].role !== k) maus.push(`G${v} papel ${b.aiPlan.groups[v].role}`);
    if (b.aiPlan.groups[G.rest]?.onMap !== 0 || !b.aiPlan.groups[G.rest]?.units.some((x) => /Mortar/.test(x))) maus.push('o morteiro nao esta no resto, fora do mapa');
    const gs = new Map(AG.grupos(out).map((u) => [u.id, u.grupo]));
    const todas = unidadesAzuis(out); const un = todas.filter((u) => !u.ausente && !u.foraDoMapa);
    const papel = (u) => ME.papelEncontro(u.nome, Rm, { leafNames: todas.filter((x) => x.pai === u.pai).map((x) => x.nome) });
    const em = (pp) => un.filter((u) => papel(u) === pp).map((u) => gs.get(u.id));
    if ([...em('tank'), ...em('recon')].some((g) => g !== G.tanks)) maus.push(`tanques/recon ${em('tank')}/${em('recon')}`);
    if (em('light').some((g) => g !== G.lightOver && g !== G.teams)) maus.push(`leves ${em('light')}`);
    const pares = [];
    for (const pai of new Set(un.map((u) => u.pai))) { const us = un.filter((u) => u.pai === pai); if (!us.some((u) => papel(u) === 'squad')) continue;
      const gi = [...new Set(us.filter((u) => papel(u) === 'squad').map((u) => gs.get(u.id)))], gv = [...new Set(us.filter((u) => papel(u) === 'carrier').map((u) => gs.get(u.id)))];
      pares.push(gi.join() + '/' + gv.join()); }
    if (pares.sort().join(' ') !== `${G.redInf}/${G.redVeh} ${G.yellowInf}/${G.yellowVeh}`) maus.push(`pelotoes ${pares}`);
    if ([...em('team'), ...em('ride')].some((g) => g !== G.teams && g !== G.lightOver)) maus.push(`equipes ${em('team')} rides ${em('ride')}`);
    if ([...gs.values()].some((g) => g > G.rest)) maus.push('unidade em 10-16');
    const cb = conferirBtt(out); if (cb.erros.length) maus.push('conferirBtt ' + cb.erros.slice(0, 2).join('; '));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  ok(!maus.length, `(134) alocacao posicional: ${b?.aiPlan.units} unidades (${b?.aiPlan.offMap} fora do mapa), ${n} registros azuis montados, grupos ${JSON.stringify(Object.fromEntries(Object.entries(b?.aiPlan.groups || {}).map(([g, v]) => [g, v.units.length])))}${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 135. O SUPORTE FORA DO MAPA (autor 14/10): no tier 1 o encontro nao compra suporte, a nao ser o morteiro garantido do
//      mapa (a bateria mais barata do lado, por cima do orcamento: o total sobe pelo preco dela); do tier 2 em diante as
//      fatias do tier tem 10 % de suporte e ele compra so os papeis liberados (morteiro, artilharia, aereo), sem ocupar
//      lugar no mapa; determinista. A defesa libera artilharia e aereo fora do mapa desde o tier 2.
{
  const ME = await import('./src/meet.mjs'); const Dm = await import('./src/defense.mjs');
  const Rm = rules(); const maus = [];
  const plano = (b, ns, gar = null, seed = 5) => ME.planMeetForce({ nation: ns[0], nations: ns, battleNumber: b, rules: Rm, seed, garantias: gar });
  for (const ns of [['RU'], ['US', 'UKR']]) {
    const sem = plano(1, ns), com = plano(1, ns, { morteiro: true });
    const preco = com.meet.garantido?.price;
    const baratos = ns.flatMap((n) => Dm.poolOf(n, Rm).flatMap((s) => s.units)).filter((u) => u.bucket === 'offMap' && u.role === 'mortar_off').map((u) => u.price);
    if (sem.offMapUnits || sem.spent.support) maus.push(`${ns} tier 1 comprou suporte sem garantia`);
    if (!preco || preco !== Math.min(...baratos) || com.budget !== sem.budget + preco || com.offMapUnits !== 1 || com.cost > com.budget || !/Mortar/.test(com.meet.garantido.name)) maus.push(`${ns} garantia ${JSON.stringify(com.meet.garantido)} total ${sem.budget}->${com.budget}`);
    const t2 = plano(4, ns);
    const shares = ME.meetSharesFor(2, Rm);
    if (shares.support !== 0.1 || t2.budgets.support !== Math.round(t2.budget * 0.1) || !t2.offMapUnits || t2.onMapUnits + t2.offMapUnits !== t2.units) maus.push(`${ns} tier 2: suporte ${t2.budgets.support}, ${t2.offMapUnits} fora do mapa`);
    const papeis = new Set(Rm.meet.supportRoles);
    const sup = t2.meet.unidades.filter((u) => u.bucket === 'support');
    const roles = ns.flatMap((n) => Dm.poolOf(n, Rm).flatMap((s) => s.units)).filter((u) => u.bucket === 'offMap');
    if (sup.some((u) => !papeis.has(roles.find((r) => r.id === u.id)?.role))) maus.push(`${ns} suporte com papel fora da lista`);
    if (JSON.stringify(plano(4, ns).meet.unidades) !== JSON.stringify(t2.meet.unidades)) maus.push(`${ns} nao determinista`);
  }
  for (const t of [2, 3]) { const u = new Set(Rm.tiers.find((x) => x.tier === t).unlocks); if (!u.has('artillery_off') || !u.has('air')) maus.push(`defesa tier ${t} sem artilharia/aereo`); }
  ok(!maus.length, `(135) suporte fora do mapa: garantia no tier 1, 10 % do tier 2 em diante, liberacoes da defesa${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 136. O ROTEIRO NO 018r (autor 14/10, com o print dele): o plano e DADO (research/ia/...018r.meet.ajustes.json). Dois
//      planos: tanksLead (pesados e recon pela rua ate a entrada da cidade, entram aos 35:00; leves no plato perto, aos
//      35:00 na faixa longe) e lightLead (as ordens dos dois trocadas, cada um com o seu Setup); a mecanizada desmonta no
//      terco oeste da cidade e os IFVs vao ao aberto roxo; a infantaria sai aos 35:00 para as casas fora da vermelha; as
//      equipes desembarcam nas casas amarelas; AA e resto so Setup. Os alvos azuis: os 4 dos devs + a supressao na
//      marrom (reaplicar nao duplica). Le de volta igual, vermelho intacto.
{
  const ENC = await import('../tools/re/ia_encontro.mjs');
  const IE = await import('../tools/re/ia_escrever.mjs');
  const { pecas } = await import('../tools/re/mapa_escrever.mjs');
  const base = path.join(import.meta.dirname, '..', 'assets', 'qb_meet_fora', 'Small Town-Forest (624 X 608) 018r Meet CMBSRL.btt');
  const ajustes = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'research', 'ia', 'small_town_forest_018r.meet.ajustes.json'), 'utf8'));
  const Rm = rules(); const G = ajustes.grupos;
  // (28/10: o setup alinhado ao inicio da rota e o teste 200; aqui o trocar com cada grupo no seu terco)
  const opc = { duracaoMin: 45, doctrine: Rm.meet.doctrine, assault: Rm.meet.assault, ajustes, modo: 'roteiro', roteiroCfg: { alignSetup: false } };
  const antes = IE.decodificar(base); const alvosAntes = IE.alvosDeApoio(antes);
  const r = ENC.aplicarDoutrinaEncontro(base, opc);
  const tmp = path.join(os.tmpdir(), `meet136-${process.pid}.btt`); IE.gravar(base, tmp, r.d);
  const d = IE.decodificar(tmp); const maus = [];
  const F = r.F, Z = r.Zs.Ro.zona, key = ([x, y]) => F.idx(x, y);
  const azul = new Set(F.azuis); const usados = d.azul.map((p, k) => (p.uso ? k + 1 : null)).filter(Boolean);
  if (r.modo !== 'roteiro' || usados.join() !== '1,2' || r.variantes.map((v) => v.nome).join() !== 'tanksLead,lightLead') maus.push(`modo ${r.modo}, planos ${usados}`);
  const tiles = (e) => IE.doMapa(d, e.tiles); const mesmo = (e, z) => tiles(e).map((t) => t.join()).sort().join(';') === z.map((t) => t.join()).sort().join(';');
  const tipo = (e) => e.prefixo[1], ASSALTO = IE.TIPO_ORDEM.Assault, SETUP = 2;
  for (const p of [1, 2]) d.azul[p - 1].slots.forEach((sl, g) => { if (!sl.length || !sl[0].tiles.length) return;
    if (tipo(sl[0]) !== SETUP || !tiles(sl[0]).every((t) => azul.has(key(t)))) maus.push(`P${p} G${g + 1} Setup`);
    if (sl.some((e) => e.a % 30 || e.b % 30 || e.a > e.b)) maus.push(`P${p} G${g + 1} janela`); });
  const [P1, P2] = [d.azul[0].slots, d.azul[1].slots];
  const tq = P1[G.tanks - 1], lv = P1[G.light - 1];
  if (!mesmo(tq[1], Z('viaRua')) || !mesmo(tq[2], Z('entradaCidade')) || tq[2].a !== 2100 || tipo(tq[3]) !== ASSALTO || !mesmo(tq[3], Z('objetivoTodo'))) maus.push('P1 pesados');
  if (!mesmo(lv[1], Z('verdePerto')) || lv[1].a !== 2100 || !mesmo(lv[2], Z('verdeLonge'))) maus.push('P1 leves');
  // a troca: as ordens de G1 no plano 2 sao as de G2 no plano 1, e vice-versa; cada um com o seu Setup
  const ordens = (sl) => sl.slice(1).map((e) => e.prefixo.toString('hex') + e.a + e.b + tiles(e).map((t) => t.join()).join(';'));
  if (JSON.stringify(ordens(P2[G.tanks - 1])) !== JSON.stringify(ordens(lv)) || JSON.stringify(ordens(P2[G.light - 1])) !== JSON.stringify(ordens(tq))) maus.push('a troca do plano 2');
  if (!mesmo(P2[G.tanks - 1][0], Z('setup.tanks.B')) || !mesmo(P2[G.light - 1][0], Z('setup.light.B'))) maus.push('Setups do plano 2');
  for (const P of [P1, P2]) {
    const mv = P[G.mechVeh - 1], mi = P[G.mechInf - 1], tm = P[G.teams - 1];
    if (mv[1].prefixo[0] !== 1 || !tiles(mv[1]).some((t) => F.predio[key(t)]) || !mesmo(mv[2], Z('roxa'))) maus.push('IFVs');
    if (mi[1].a !== 2100 || tipo(mi[2]) !== ASSALTO || !mesmo(mi[2], Z('casasFora:vermelha')) || mi.some((e, k) => k && e.prefixo[0])) maus.push('infantaria');
    if (!tm.some((e) => e.prefixo[0] === 1) || !mesmo(tm[tm.length - 1], Z('amarela'))) maus.push('equipes');
    if (P[G.aa - 1].length !== 1 || P[G.rest - 1].length !== 1 || P.slice(7).some((sl) => sl.length > 1 || sl[0]?.tiles.length)) maus.push('AA/resto/vazios');
  }
  // os alvos de apoio: os 4 azuis dos devs ficam, a supressao da marrom entra com os parametros do primeiro; vermelho intacto
  const alv = IE.alvosDeApoio(d), az = alv.find((L) => L.lado === 0), azAntes = alvosAntes.find((L) => L.lado === 0);
  const novo = az.alvos[az.alvos.length - 1];
  // desde 17/10 o pacote ja e o 018r registrado (os 4 dos devs + a marrom): reaplicar nao duplica, ficam 5
  if (az.alvos.length !== 5 || novo.nome !== 'Suppress' || !novo.params.equals(azAntes.alvos[0].params) || !mesmo({ tiles: novo.tiles }, Z('marrom'))) maus.push(`alvos azuis ${az.alvos.map((a) => a.nome).join()}`);
  if (!IE.codificarAlvos([alv.find((L) => L.lado === 1)]).equals(IE.codificarAlvos([alvosAntes.find((L) => L.lado === 1)]))) maus.push('alvos vermelhos mexidos');
  const de2 = ENC.aplicarDoutrinaEncontro(tmp, opc);
  if (IE.alvosDeApoio(de2.d).find((L) => L.lado === 0).alvos.length !== az.alvos.length) maus.push('reaplicar duplicou o alvo');
  if (!IE.codificar(d).equals(pecas(tmp).resto) || d.T !== 0) maus.push('nao le de volta igual');
  if (JSON.stringify(d.vermelho.map((p) => p.slots.map((x) => x.length))) !== JSON.stringify(antes.vermelho.map((p) => p.slots.map((x) => x.length)))) maus.push('vermelho mexido');
  fs.rmSync(tmp, { force: true });
  ok(!maus.length, `(136) roteiro no 018r: planos ${usados} (${r.variantes.map((v) => v.nome).join('/')}), ${r.Zs.Ro.nomes().length} zonas, apoio ${r.apoio}${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 137. A ALOCACAO DO ROTEIRO: a forca da batalha 3 (US+UKR, semente 11) com o morteiro garantido no plano tanksLead do
//      018r (temporario), pelo forge com os grupos e a alocacao do ajustes: Meeting Engagement, ninguem desmontado, todo
//      grupo no mapa com zona; tanques e recon no G1, leves no G2, os dois pelotoes na unica parcela (veiculos G3,
//      esquadras G4), equipes e transporte no G5, o morteiro fora do mapa no G7, nada em 8-16; papeis = a tabela.
{
  const ENC = await import('../tools/re/ia_encontro.mjs');
  const IE = await import('../tools/re/ia_escrever.mjs');
  const ME = await import('./src/meet.mjs');
  const { abrirCompleto } = await import('../tools/re/anexar2.mjs'); const { arvore } = await import('../tools/re/extras.mjs');
  const TB = await import('../tools/re/tipo_batalha.mjs'); const AG = await import('../tools/re/agrupar.mjs');
  const { buildBattle } = await import('./src/forge.mjs'); const { conferirBtt } = await import('../tools/re/bateria/lib.mjs');
  const { unidadesAzuis } = await import('../tools/re/ia_agrupar.mjs');
  const base = path.join(import.meta.dirname, '..', 'assets', 'qb_meet_fora', 'Small Town-Forest (624 X 608) 018r Meet CMBSRL.btt');
  const ajustes = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'research', 'ia', 'small_town_forest_018r.meet.ajustes.json'), 'utf8'));
  const Rm = rules(); const G = ajustes.grupos; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meet137-'));
  const maus = []; let b = null, n = 0;
  try {
    const r = ENC.aplicarDoutrinaEncontro(base, { duracaoMin: 45, doctrine: Rm.meet.doctrine, assault: Rm.meet.assault, ajustes, modo: 'roteiro', usos: { tanksLead: 'Used Frequently', lightLead: 'Not Used' } });
    const mapa = path.join(dir, 'mapa.btt'); IE.gravar(base, mapa, r.d);
    const forca = ME.planMeetForce({ nation: 'US', nations: ['US', 'UKR'], battleNumber: 3, rules: Rm, seed: 11, garantias: { morteiro: true } });
    const out = path.join(dir, 'b.btt'); const VERM = path.join(import.meta.dirname, '..', 'assets', 'lib', 'RU - Section (Supply).btt');
    const log = console.log; console.log = () => {};
    try { b = await buildBattle({ coreFile: VERM, defense: forca, mapFile: mapa, duration: 45, nation: 'RU', enemy: forca.nation, out, rules: Rm, trace: { event() {}, read() {}, wrote() {}, step: async (_n, _d, fn) => fn() }, attack: 'Meet', title: 'ZZ T137', aiPlan: true, meet: { variant: 'tanksLead', plan: 1, shares: Rm.meet.variants.balanced, sourceMap: null, key: null, doutrina: 'roteiro', grupos: G, alocacao: ajustes.alocacao }, attacker: [{ formacao: VERM }] }); }
    finally { console.log = log; }
    // 14/10: o 018r tem o marcador de fim de mapa numa corrida tokenizada (transplante.marcador/anexar2): a batalha tem
    // de sair legivel (o crash no jogo vinha da forca colada 8 bytes antes do fim do mapa)
    try { IE.decodificar(out); } catch (e) { maus.push('batalha ilegivel: ' + e.message); }
    if (TB.ler(out).nome !== 'Meeting Engagement') maus.push('tipo ' + TB.ler(out).nome);
    const X = abrirCompleto(out); const c = X.completo; let desm = 0;
    const anda = (no) => { if (!no.r.ausente) { n++; if ((c[no.r.c + 15] >> 5) === 4) desm++; } (no.filhos || []).forEach(anda); };
    arvore(X).azul.forEach(anda);
    if (desm) maus.push(`${desm} de ${n} desmontados`);
    if (b.aiPlan.noZone.length || b.aiPlan.meet?.doutrina !== 'roteiro' || b.aiPlan.offMap !== 1) maus.push(`sem zona ${b.aiPlan.noZone}, doutrina ${b.aiPlan.meet?.doutrina}, fora do mapa ${b.aiPlan.offMap}`);
    for (const [k, v] of Object.entries(G)) if (b.aiPlan.groups[v] && b.aiPlan.groups[v].role !== k) maus.push(`G${v} papel ${b.aiPlan.groups[v].role}`);
    if (b.aiPlan.groups[G.rest]?.onMap !== 0 || !b.aiPlan.groups[G.rest]?.units.some((x) => /Mortar/.test(x))) maus.push('o morteiro nao esta no resto');
    const gs = new Map(AG.grupos(out).map((u) => [u.id, u.grupo]));
    const todas = unidadesAzuis(out); const un = todas.filter((u) => !u.ausente && !u.foraDoMapa);
    const papel = (u) => ME.papelEncontro(u.nome, Rm, { leafNames: todas.filter((x) => x.pai === u.pai).map((x) => x.nome) });
    const em = (pp) => un.filter((u) => papel(u) === pp).map((u) => gs.get(u.id));
    if ([...em('tank'), ...em('recon')].some((g) => g !== G.tanks)) maus.push(`tanques/recon ${em('tank')}/${em('recon')}`);
    if (em('light').some((g) => g !== G.light && g !== G.teams)) maus.push(`leves ${em('light')}`);
    for (const pai of new Set(un.map((u) => u.pai))) { const us = un.filter((u) => u.pai === pai); if (!us.some((u) => papel(u) === 'squad')) continue;
      if (us.some((u) => papel(u) === 'squad' && gs.get(u.id) !== G.mechInf) || us.some((u) => papel(u) === 'carrier' && gs.get(u.id) !== G.mechVeh)) maus.push('pelotao fora da parcela'); }
    if ([...em('team'), ...em('ride')].some((g) => g !== G.teams && g !== G.light)) maus.push(`equipes ${em('team')} rides ${em('ride')}`);
    if ([...gs.values()].some((g) => g > G.rest)) maus.push('unidade em 8-16');
    const cb = conferirBtt(out); if (cb.erros.length) maus.push('conferirBtt ' + cb.erros.slice(0, 2).join('; '));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  ok(!maus.length, `(137) alocacao do roteiro: ${b?.aiPlan.units} unidades (${b?.aiPlan.offMap} fora do mapa), ${n} registros azuis montados, grupos ${JSON.stringify(Object.fromEntries(Object.entries(b?.aiPlan.groups || {}).map(([g, v]) => [g, v.units.length])))}${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 138. O ENCONTRO PAGA COMO QUALQUER NO (a escada, 30/10): o degrau e o teto da cobertura nao olham o tipo da batalha.
//      Antes (16/10) a base da recompensa do encontro era corrigida pela proporcao defesa/encontro; com a escada nao ha
//      base: o encontro da batalha 1 paga o mesmo degrau e tem o mesmo teto que a defesa da batalha 1, com o mesmo peso.
{
  const { incomeFor } = await import('./src/campaign.mjs');
  const Rm = rules(); const maus = [];
  const res = { battle: 1, aar: { player: { pontos: 100 }, enemy: {} }, verdict: { available: 100 }, units: [], casualtiesToBuy: [], vehicles: { marks: {} } };
  const rf = (cur) => incomeFor({ slug: 'ZZ-T138', forceRatio: 1.3, defeatsLeft: 2, units: [], current: cur }, res, Rm);
  const m = rf({ n: 1, map: { kind: 'Meet' }, rewardMult: 1.3, defense: { kind: 'Meet', cost: 2955, freeCost: 500 } });
  const a = rf({ n: 1, map: { kind: null }, rewardMult: 1.3, defense: { kind: null, cost: 1550 } });
  if (m.step.credits !== a.step.credits || m.cover.cap !== a.cover.cap || m.total !== a.total) maus.push(`encontro ${m.total} x defesa ${a.total}`);
  ok(!maus.length, `(138) o encontro paga como a defesa: degrau ${m.step.credits}, teto ${m.cover.cap}${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 172. DIFICULDADE NA CRIACAO (18/10/2026, autor): os cinco presets da tabela dele, todos com valores que as listas de opcoes
//      aceitam; Medium e o padrao; a comparacao devolve o preset de cada linha e Custom para qualquer variacao.
{
  const C = await import('./src/campaign.mjs');
  const D = R.difficulty; const maus = [];
  const nomes = (D?.presets || []).map((p) => p.name).join(',');
  if (nomes !== 'Very Easy,Easy,Medium,Hard,Very Hard' || D.default !== 'Medium') maus.push(`presets ${nomes}, padrao ${D?.default}`);
  // 30/10 (autor): a razao de forca no lugar do esforco; 01/11 1,6 / 1,45 / 1,3 / 1,1 / 0,9
  const esperado = { 'Very Easy': ['US,UKR', 'RU', 0.75, 5, 4, 1.6], Easy: ['US', 'RU', 0.75, 3, 3, 1.45], Medium: ['RU', 'US', 0.5, 3, 2, 1.3], Hard: ['RU', 'US', 0.5, 2, 2, 1.1], 'Very Hard': ['UKR', 'RU', 0.5, 2, 2, 0.9] };
  for (const p of D?.presets || []) {
    const e = esperado[p.name];
    if (!e || p.armies.join() !== e[0] || p.enemySide !== e[1] || p.rescueChance !== e[2] || p.opPoints !== e[3] || p.defeats !== e[4] || p.ratio !== e[5] || p.effort !== undefined) maus.push(`${p.name} diferente da tabela`);
    if (!R.path.startingPointsOptions.includes(p.opPoints) || !R.replacement.rescueChanceOptions.includes(p.rescueChance) || !R.defeatsAllowedOptions.includes(p.defeats) || !R.difficulty.ratioOptions.includes(p.ratio)) maus.push(`${p.name} usa valor fora das opcoes`);
    if (C.difficultyOf({ ...p, armies: [...p.armies].reverse() }, R) !== p.name) maus.push(`${p.name} nao se reconhece`);
    if (C.difficultyOf({ ...p, rescueChance: 1 }, R) !== 'Custom' || C.difficultyOf({ ...p, defeats: 'unlimited' }, R) !== 'Custom' || C.difficultyOf({ ...p, ratio: p.ratio === 1.1 ? 1.6 : 1.1 }, R) !== 'Custom') maus.push(`${p.name} com variacao nao virou Custom`);
  }
  if (!R.path.startingPointsOptions.includes(5)) maus.push('sem a opcao de 5 pontos');
  ok(!maus.length, `(172) dificuldade: ${nomes}, padrao ${D?.default}, variacao vira Custom, 5 pontos na lista${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 173. A CAMPANHA NASCE SEM FORCA (18/10/2026, autor: Battle Path > Quartermaster > Intel > Battle). Criada sem picks fica
//      em 'choose' sem arquivo core, unidades nem credito gasto; o inicio leva ao brief sem forca, onde a montagem e o Intel
//      recusam; raiseForce cunha a forca com os creditos da campanha; o undo apaga a forca levantada e devolve os
//      creditos; de novo ate a montagem, e o undo do 'play' volta a escolha sem forca e sem .cam.
{
  const C = await import('./src/campaign.mjs'); const CAT = await import('./src/catalog.mjs'); const E = await import('./src/estado.mjs');
  const maus = []; let slug = null; const cams = [];
  // a escada: desde 01/11 os creditos iniciais sao fixos (2.500) em todo nivel, e a forca do teste (2.491 cr) cabe
  const INICIAL = C.startingCredits(R);
  const inv = (s, quando) => { const e = E.invariantesDoEstado(s); if (e.length) maus.push(`${quando}: ${e.slice(0, 2).join('; ')}`); };
  const recusa = async (f) => { try { await f(); return null; } catch (e) { return e.message; } };
  try {
    const t = CAT.formationTree('US - Battalion (Infantry).btt'); const root = t.roots[0];
    const comp = root.children.find((c) => c.name.startsWith('Company (Rifle)')); const plat = comp.children.find((c) => c.isFormation);
    const todas = (n, o = []) => { o.push(n.key); n.children.forEach((c) => todas(c, o)); return o; };
    const keep = [root.key, ...root.children.filter((c) => !c.isFormation).map((c) => c.key), comp.key, ...comp.children.filter((c) => !c.isFormation).map((c) => c.key), ...todas(plat)];
    const pick = { source: 'US - Battalion (Infantry).btt', nation: 'US', keep };
    const preco = C.priceOfPicks([pick], 'US', R)[0].price;

    let st = await C.createCampaign({ name: 'ZZ T173', armies: ['US'], enemySide: 'RU', picks: [], opPoints: 4 }, () => {});
    slug = st.slug;
    const pasta = C.dirOf(slug);
    if (st.stage !== 'choose' || st.coreFile || st.units.length || st.credits !== INICIAL || st.picks.length || fs.existsSync(path.join(pasta, 'core-force.btt'))) maus.push(`criada: stage ${st.stage}, core ${st.coreFile}, ${st.units.length} unidades, ${st.credits} cr`);
    if (!Number.isFinite(R.path.fitsDefault)) maus.push('sem path.fitsDefault');
    inv(st, 'criada');
    const no = st.path.nodes.find((n) => n.row === 1 && n.kind !== 'Meet') || st.path.nodes.find((n) => n.row === 1);
    C.chooseNode(slug, { node: no.id });
    st = await C.startCampaign(slug, () => {});
    if (st.stage !== 'brief' || st.coreFile || fs.existsSync(path.join(pasta, 'battles', '01', 'undo', 'core-force.btt'))) maus.push(`inicio: stage ${st.stage}, core ${st.coreFile}`);
    inv(st, 'brief sem forca');
    const semPrep = await recusa(() => C.prepareBattle(slug, () => {}));
    const semIntel = await recusa(() => C.buyEnemyIntel(slug, { strength: 10 }, () => {}));
    if (!/raise your force/.test(semPrep || '') || !/raise your force/.test(semIntel || '')) maus.push(`sem forca: prepare "${semPrep}", intel "${semIntel}"`);
    const vazio = await recusa(() => C.raiseForce(slug, { picks: [] }, () => {}));
    if (!/at least one formation/.test(vazio || '')) maus.push(`raise vazio: ${vazio}`);

    st = await C.raiseForce(slug, { picks: [pick] }, () => {});
    const emCampo = st.units.filter((u) => u.present);
    if (st.stage !== 'brief' || !st.coreFile || !fs.existsSync(st.coreFile) || !st.units.length || st.coreUnits !== st.units.length || st.credits !== INICIAL - preco || st.nation !== 'US' || st.picks.length !== 1) maus.push(`raise: stage ${st.stage}, ${st.units.length} unidades, ${st.credits} cr (esperado ${INICIAL - preco})`);
    if (!emCampo.length || emCampo.some((u) => !C.LEADERSHIP.includes(st.attrs?.[u.coreId]?.lideranca) || st.cleanBattles?.[u.coreId] !== 0)) maus.push('raise: leadership nao sorteada em todas em campo');
    if (st.units.some((u) => !st.record?.[u.coreId])) maus.push('raise: record faltando');
    inv(st, 'forca levantada');
    const deNovo = await recusa(() => C.raiseForce(slug, { picks: [pick] }, () => {}));
    if (!/already has a force/.test(deNovo || '')) maus.push(`raise de novo: ${deNovo}`);
    const core = st.coreFile;

    let u = C.undoBattle(slug);
    if (u.stage !== 'choose' || u.coreFile || u.units.length || u.credits !== INICIAL || fs.existsSync(core) || fs.existsSync(path.join(pasta, 'work'))) maus.push(`undo do brief: stage ${u.stage}, core ${u.coreFile}, ${u.credits} cr, arquivo ${fs.existsSync(core)}`);
    inv(u, 'undo do brief');
    const naEscolha = await recusa(() => C.raiseForce(slug, { picks: [pick] }, () => {}));
    if (!/after battle 1 is chosen/.test(naEscolha || '')) maus.push(`raise na escolha: ${naEscolha}`);

    C.chooseNode(slug, { node: no.id });
    await C.startCampaign(slug, () => {});
    await C.raiseForce(slug, { picks: [pick] }, () => {});
    st = await C.prepareBattle(slug, () => {});
    if (st.campaignFile) cams.push(st.campaignFile);
    if (st.stage !== 'play' || !st.current || !fs.existsSync(path.join(pasta, 'battles', '01', 'battle.btt')) || !fs.existsSync(st.campaignFile)) maus.push(`montagem: stage ${st.stage}`);
    inv(st, 'play');
    u = C.undoBattle(slug);
    if (u.stage !== 'choose' || u.coreFile || u.units.length || u.credits !== INICIAL || cams.some((f) => fs.existsSync(f))) maus.push(`undo do play: stage ${u.stage}, core ${u.coreFile}, .cam ${cams.some((f) => fs.existsSync(f))}`);
    inv(u, 'undo do play');
  } catch (e) { maus.push(e.message.slice(0, 160)); }
  finally {
    for (const f of cams) fs.rmSync(f, { force: true });
    if (slug) { try { const s2 = C.loadState(slug); if (s2.campaignFile) fs.rmSync(s2.campaignFile, { force: true }); } catch { /* sem estado */ } fs.rmSync(C.dirOf(slug), { recursive: true, force: true }); }
  }
  ok(!maus.length, `(173) campanha sem forca: escolha, brief sem forca (montagem e Intel recusam), raise com creditos da campanha, undo apaga a forca e devolve creditos, montagem e undo do play${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 174. O QUE A PAGINA TOCA NA CARGA EXISTE (18/10/2026): a tela 'new' saiu e uma linha solta `$('#new').classList` derrubou
//      o app.js inteiro na carga (o lint so confere nomes de variavel). Todo `$('#id')` no nivel de cima do app.js precisa
//      de um elemento com esse id no index.html.
{
  const pagina = fs.readFileSync(path.join(import.meta.dirname, 'web', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(import.meta.dirname, 'web', 'index.html'), 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const soltos = [...new Set(pagina.split(/\r?\n/).filter((l) => /^\$\('#/.test(l)).map((l) => l.match(/^\$\('#([\w-]+)'\)/)?.[1]).filter(Boolean))];
  const faltam = soltos.filter((id) => !ids.has(id));
  ok(soltos.length > 5 && !faltam.length, `(174) os ${soltos.length} elementos que o app.js toca na carga existem no index.html${faltam.length ? ' — faltam: ' + faltam.join(', ') : ''}`);
}

// 175. O PRECO DAS SPECIAL FORCES E PARAMETRO DA CAMPANHA (18/10/2026, autor): gratis, 500 ou 1000 cr, 1000 por padrao. A
//      cobranca (priceOfPicks), a linha da biblioteca e o grafico da SF seguem o preco da campanha; numa campanha "Free"
//      levantar a forca com a SF nao gasta credito.
{
  const C = await import('./src/campaign.mjs'); const CAT = await import('./src/catalog.mjs');
  const F = R.formations; const maus = []; let slug = null;
  if ((F.specialForcesPriceOptions || []).join() !== '0,600' || F.specialForcesPrice !== 600) maus.push(`regra: ${JSON.stringify(F.specialForcesPriceOptions)} padrao ${F.specialForcesPrice}`);
  const fonte = 'US - Platoon (LRS)';
  const sfPick = { source: fonte + '.btt', nation: 'US', keep: [], sf: true };
  for (const v of [0, 600]) {
    const RV = C.rulesFor({ specialForcesPrice: v }, R);
    const cobra = C.priceOfPicks([sfPick], 'US', RV)[0].price;
    const linha = CAT.libFormations('US', { specialForces: true, rules: RV }).find((f) => f.sf && f.source === fonte);
    const arvore = CAT.specialForcesTree(JSON.parse(JSON.stringify(CAT.formationTree(fonte + '.btt'))), fonte, RV);
    let soma = 0; const anda = (n) => { if (!n.isFormation && typeof n.price === 'number') soma += n.price; n.children.forEach(anda); };
    // a arvore crua nao tem preco por bloco; a rota a anota antes. Aqui so confere que nada passa do preco da campanha.
    arvore.roots.forEach(anda);
    if (cobra !== v || linha?.price !== v || soma > v) maus.push(`${v}: cobra ${cobra}, biblioteca ${linha?.price}, grafico ${soma}`);
  }
  if (C.rulesFor({}, R) !== R) maus.push('campanha sem o campo nao usa a regra');
  try {
    let st = await C.createCampaign({ name: 'ZZ T175', armies: ['US'], enemySide: 'RU', picks: [], specialForcesPrice: 300 }, () => {});
    if (st.specialForcesPrice !== 600) maus.push(`valor fora da lista gravou ${st.specialForcesPrice}`);
    fs.rmSync(C.dirOf(st.slug), { recursive: true, force: true });
    st = await C.createCampaign({ name: 'ZZ T175', armies: ['US'], enemySide: 'RU', picks: [], specialForcesPrice: 0 }, () => {});
    slug = st.slug;
    if (st.specialForcesPrice !== 0) maus.push(`Free gravou ${st.specialForcesPrice}`);
    const no = st.path.nodes.find((n) => n.row === 1 && n.kind !== 'Meet') || st.path.nodes.find((n) => n.row === 1);
    C.chooseNode(slug, { node: no.id });
    await C.startCampaign(slug, () => {});
    const antes = C.loadState(slug).credits;
    st = await C.raiseForce(slug, { picks: [sfPick] }, () => {});
    if (st.credits !== antes || !st.units.some((u) => u.present)) maus.push(`raise da SF gratis: ${antes} -> ${st.credits} cr`);
  } catch (e) { maus.push(e.message.slice(0, 160)); }
  finally { if (slug) fs.rmSync(C.dirOf(slug), { recursive: true, force: true }); }
  ok(!maus.length, `(175) preco das SF por campanha: 0/500/1000 na cobranca e na biblioteca, padrao 1000, raise gratis nao gasta${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 176. O TEMPO EXTRA CUSTA PONTOS OPERACIONAIS (18/10/2026, autor): +15 por 1 ponto, +30 por 2. Numa campanha sintetica no
//      brief da batalha 2: comprar +15 debita 1 ponto e nenhum credito; sem pontos, recusa; o undo devolve os pontos do tempo
//      (intelOpsOf soma tudo o que o Intel cobrou em pontos para a batalha).
{
  const C = await import('./src/campaign.mjs');
  const { CAMPAIGNS_DIR } = await import('./src/settings.mjs');
  const slug = 'ZZ-T176'; const dir = path.join(CAMPAIGNS_DIR, slug);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const maus = [];
  const grava = (s) => fs.writeFileSync(C.stateFile(slug), JSON.stringify({ version: 1, slug, name: slug, credits: 1000, defeatsLeft: 2, units: [{ coreId: 1, name: 'x', present: true }], coreUnits: 1, coreFile: path.join(dir, 'core-force.btt'), seenSaves: [], playedMaps: [], picks: [], battleSlots: ['A', 'B'], stage: 'brief', battleNumber: 2, history: [{ n: 1 }], next: { n: 2, preview: { clockBase: 45 } }, ...s }));
  try {
    grava({ ops: 3 });
    const st = await C.buyAbility(slug, { abilities: ['clock-15'] }, () => {});
    const entrada = (st.abilities?.applied || []).find((a) => a.id === 'clock-15' && a.battle === 2);
    if (st.ops !== 2 || st.credits !== 1000 || entrada?.ops !== 1) maus.push(`+15: ops ${st.ops}, credits ${st.credits}, entrada ${JSON.stringify(entrada)}`);
    if (C.intelOpsOf(st, 2) !== 1) maus.push(`intelOpsOf ${C.intelOpsOf(st, 2)}`);
    grava({ ops: 1 });
    let recusa = null; try { await C.buyAbility(slug, { abilities: ['clock-30'] }, () => {}); } catch (e) { recusa = e.message; }
    if (!/2 operational points and you have 1/.test(recusa || '')) maus.push(`sem pontos: ${recusa}`);
  } catch (e) { maus.push(e.message.slice(0, 160)); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
  ok(!maus.length, `(176) tempo extra: +15 debita 1 ponto e nenhum credito, +30 sem pontos e recusado, o undo conta os pontos do tempo${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 177. O BRIEFING SO TRAZ A INTELIGENCIA PAGA (18/10/2026, autor: o briefing da RUS2 b1 deu a composicao inimiga sem ele
//      ter pago). O no jogado mostra tudo na tela, mas `revealed.paid` guarda a compra; a montagem usa o pago. Batalha 1
//      sem revelar: sem relatorio; revelada a composicao inteira (2 pontos): com relatorio.
{
  const P = await import('./src/path.mjs'); const C = await import('./src/campaign.mjs'); const CAT = await import('./src/catalog.mjs');
  const maus = []; let slug = null; const cams = [];
  const sec = { id: 'r1c0', row: 1, col: 0, kind: 'Attack', edges: [], map: { f: 'x.btt' }, defense: { nation: 'RU', units: 20, kept: [] } };
  const jogado = P.publicView(sec, { map: true, paid: { map: true } }, { played: true });
  if (!jogado.revealed.full || jogado.revealed.paid.full || !jogado.revealed.paid.map) maus.push(`publicView jogado: ${JSON.stringify(jogado.revealed)}`);
  const deNovo = P.publicView(sec, jogado.revealed, { played: true });
  if (deNovo.revealed.paid.full || !deNovo.revealed.paid.map) maus.push('o refresh perdeu o pago');
  try {
    const t = CAT.formationTree('US - Battalion (Infantry).btt'); const root = t.roots[0];
    const comp = root.children.find((c) => c.name.startsWith('Company (Rifle)')); const plat = comp.children.find((c) => c.isFormation);
    const todas = (n, o = []) => { o.push(n.key); n.children.forEach((c) => todas(c, o)); return o; };
    const keep = [root.key, ...root.children.filter((c) => !c.isFormation).map((c) => c.key), comp.key, ...comp.children.filter((c) => !c.isFormation).map((c) => c.key), ...todas(plat)];
    let st = await C.createCampaign({ name: 'ZZ T177', armies: ['US'], enemySide: 'RU', picks: [{ source: 'US - Battalion (Infantry).btt', nation: 'US', keep }], opPoints: 4 }, () => {});
    slug = st.slug;
    const no = st.path.nodes.find((n) => n.row === 1 && n.kind !== 'Meet') || st.path.nodes.find((n) => n.row === 1);
    C.chooseNode(slug, { node: no.id });
    await C.startCampaign(slug, () => {});
    st = await C.prepareBattle(slug, () => {});
    if (st.campaignFile) cams.push(st.campaignFile);
    if (st.current?.intel !== false) maus.push(`sem revelar: intel ${st.current?.intel}`);
    C.undoBattle(slug);
    C.chooseNode(slug, { node: no.id });
    await C.startCampaign(slug, () => {});
    // 24/10: na Intel, pela batalha em preparo (next.node); a tela ja a mostra por estar na rota, o custo e o pago
    const opsAntes = C.loadState(slug).ops;
    st = C.revealNode(slug, { node: no.id, what: 'full' });
    if (opsAntes - st.ops !== 2) maus.push(`a revelacao na Intel custou ${opsAntes - st.ops}`);
    st = await C.prepareBattle(slug, () => {});
    if (st.campaignFile) cams.push(st.campaignFile);
    if (st.current?.intel !== true) maus.push(`revelado inteiro: intel ${st.current?.intel}`);
  } catch (e) { maus.push(e.message.slice(0, 160)); }
  finally {
    for (const f of cams) fs.rmSync(f, { force: true });
    if (slug) fs.rmSync(C.dirOf(slug), { recursive: true, force: true });
  }
  ok(!maus.length, `(177) briefing: o no jogado guarda o que foi pago; sem revelar nao ha relatorio, com a composicao paga ha${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 178. A ESCADA DOS TANQUES (18/10/2026, autor): 20% do orcamento para tanques no mapa aberto dos tiers 1 e 2 e no misto do
//      tier 2, tirados so de esquadras, equipes e transportes; o balde compra UM carro de combate, o mais barato do lado, no
//      nivel mais alto que cabe (Veteran > Regular > Green), e cacas-tanques com o resto; folga so para a Russia. O tanque
//      num nivel diferente do tier e escrito por unidade no arquivo.
{
  const D = await import('./src/defense.mjs');
  const maus = [];
  const semFatia = JSON.parse(JSON.stringify(R)); for (const t of semFatia.tiers) delete t.tankShareByProfile;
  const fatores = R.units.experienceFactor;
  let conferidos = 0;
  for (const [nation, nations] of [['RU', ['RU']], ['UKR', ['US', 'UKR']]]) for (const b of [1, 2, 3, 4, 5, 6]) for (const profile of ['aberto', 'misto', 'urbano']) for (const kind of [null]) for (const seed of [1, 2]) {
    const d = D.planDefense({ nation, nations, battleNumber: b, rules: R, seed, profile, effort: 1, kind });
    const d0 = D.planDefense({ nation, nations, battleNumber: b, rules: semFatia, seed, profile, effort: 1, kind });
    const quer = (b <= 3 ? { aberto: 0.2 } : { aberto: 0.2, misto: 0.2 })[profile] || 0;
    const rot = `${nations.join('+')} B${b} ${kind} ${profile} s${seed}`;
    // (a) a verba
    if (!quer) { if (d.tankShare || d.budgets.tanks) maus.push(`${rot}: verba de tanques sem fatia`); continue; }
    const total = Object.values(d.budgets).reduce((a, x) => a + x, 0);
    const total0 = Object.values(d0.budgets).reduce((a, x) => a + x, 0);
    if (Math.abs(d.budgets.tanks - Math.round(total * quer)) > 1 || Math.abs(total - total0) > 1) maus.push(`${rot}: tanques ${d.budgets.tanks} de ${total} (antes ${total0})`);
    if (d.budgets.scouts !== d0.budgets.scouts || d.budgets.offMap !== d0.budgets.offMap) maus.push(`${rot}: scouts ou fora do mapa mudaram`);
    for (const c of ['squads', 'teams', 'carriers']) if (d.budgets[c] > d0.budgets[c]) maus.push(`${rot}: ${c} subiu`);
    // (b) a escada
    const folga = nations.every((n) => R.defense.tankLadder.slackFor.includes(n)) ? Math.round(d.budget * R.defense.bucketSlack) : 0;
    if ((d.tankSlack || 0) !== folga) maus.push(`${rot}: folga ${d.tankSlack} em vez de ${folga}`);
    if (d.spent.tanks > d.budgets.tanks + folga) maus.push(`${rot}: gastou ${d.spent.tanks} no balde de ${d.budgets.tanks}+${folga}`);
    const mbts = d.kept.filter((k) => /Main Battle Tank/.test(k.name)).reduce((a, k) => a + k.n, 0);
    if (mbts > 1) maus.push(`${rot}: ${mbts} carros de combate`);
    if (d.tankLadder) {
      conferidos++;
      const veterano = d.tankLadder.price / (fatores[d.tankLadder.experience] / fatores.Veteran);
      const melhor = R.defense.tankLadder.order.find((n) => Math.round(veterano * fatores[n] / fatores.Veteran) <= d.budgets.tanks + folga);
      if (melhor !== d.tankLadder.experience) maus.push(`${rot}: ${d.tankLadder.experience} quando cabia ${melhor}`);
      if (d.tankLadder.experience !== d.experience && !(d.unitAttributes || []).some((a) => a.name === d.tankLadder.name && a.experiencia === d.tankLadder.experience)) maus.push(`${rot}: sem atributo por unidade`);
    }
  }
  // (c) casos esperados com os precos de hoje
  const esc = (nation, nations, b, kind) => D.planDefense({ nation, nations, battleNumber: b, rules: R, seed: 1, profile: 'aberto', effort: 1, kind });
  const uu = esc('UKR', ['US', 'UKR'], 5, null), rr = esc('RU', ['RU'], 6, null), u1 = esc('UKR', ['US', 'UKR'], 1, null);
  if (uu.tankLadder?.name !== 'Main Battle Tank (T-64BV)' || uu.tankLadder?.experience !== 'Veteran') maus.push(`US+UKR B5: ${JSON.stringify(uu.tankLadder)}`);
  if (rr.tankLadder?.name !== 'Main Battle Tank (T-72B3)' || rr.tankLadder?.experience !== 'Veteran') maus.push(`RU B6: ${JSON.stringify(rr.tankLadder)}`);
  if (u1.tankLadder) maus.push('US+UKR B1 nao devia ter tanque');
  // (d) o arquivo: o tanque da escada com a experiencia dele
  const RE = await import('./src/re.mjs'); const { buildBattle } = await import('./src/forge.mjs');
  const AU = await import(new URL('../tools/re/atributos_unidade.mjs', import.meta.url).href);
  const { ler } = await import(new URL('../tools/re/transplante.mjs', import.meta.url).href);
  const { registros } = await import(new URL('../tools/re/regs.mjs', import.meta.url).href);
  // (23/10: sem o fator 0,9 do Attack o B4 semente 1 compra o tanque na experiencia do tier; procura o primeiro que nao)
  let alvo = null;
  for (const b of [4, 5, 6, 1, 2, 3]) for (let sd = 1; sd <= 12 && !alvo; sd++) { const x = D.planDefense({ nation: 'UKR', nations: ['US', 'UKR'], battleNumber: b, rules: R, seed: sd, profile: 'aberto', effort: 1 }); if (x.unitAttributes?.length) alvo = x; }
  alvo = alvo || D.planDefense({ nation: 'UKR', nations: ['US', 'UKR'], battleNumber: 4, rules: R, seed: 1, profile: 'aberto', effort: 1 });
  if (!alvo.unitAttributes?.length) maus.push(`B4 sem tanque fora do tier: ${JSON.stringify(alvo.tankLadder)}`);
  else {
    const mapa = mapCensus().find((m) => m.tipo === 'Attack' && m.perfil === 'aberto' && m.usavel && m.serve) || mapCensus().find((m) => m.tipo === 'Attack' && m.usavel && m.serve);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-t178-'));
    // 30/10: as campanhas locais foram apagadas (a escada); a forca russa sai do fixture congelado da RUS1
    const coreFile = path.join(import.meta.dirname, '..', 'research', 'qa', 'fixtures', 'rus1-b12-result', 'campanha', 'core-force.btt');
    try {
      const out = path.join(tmp, 'battle.btt');
      const trace = { read() {}, wrote() {}, event() {}, step: async (_n, _d, fn) => fn() };
      await buildBattle({ coreFile, defense: alvo, nation: 'RU', enemy: 'UKR', mapFile: mapFile(mapa), duration: 60, attack: 'Attack', out, trace, rules: R });
      const ids = new Set(AU.idsPorNome(out, 'azul', alvo.tankLadder.name));
      const v = ler(out);
      const tanque = registros(v.cru).filter((x) => ids.has(x.id)).map((x) => RE.unitAttributes(v.cru, x.off).experiencia);
      if (!tanque.length || tanque.some((e) => e !== alvo.tankLadder.experience)) maus.push(`arquivo: tanque ${tanque.join(',')} em vez de ${alvo.tankLadder.experience}`);
    } catch (e) { maus.push(`montagem: ${e.message.slice(0, 160)}`); }
    finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  ok(!maus.length, `(178) escada dos tanques: 20% no aberto (tiers 1 e 2) e no misto (tier 2), um carro no nivel mais alto que cabe, folga so da Russia, ${conferidos} tanques conferidos, experiencia por unidade no arquivo${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 179. OS BOTOES DO INTEL FUNCIONAM ANTES DO PREPARE (18/10/2026, autor: "TypeError: Cannot read properties of null
//      (reading 'n') at buyEnemyIntelUI"). No brief nao ha batalha montada e s.current e nulo; nenhuma compra do Intel pode
//      ler s.current.
{
  // (25/10: CRLF ou LF, conforme o git deixou a copia de trabalho; o corte procura '\n}\n')
  const pagina = fs.readFileSync(path.join(import.meta.dirname, 'web', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
  const corpo = (nome) => { const i = pagina.indexOf(`async function ${nome}(`); if (i < 0) return null; const j = pagina.indexOf('\n}\n', i); return pagina.slice(i, j); };
  const nomes = ['buyIntel', 'buyRelightUI', 'buyOwnEWUI', 'buyEnemyIntelUI'];
  const ruins = nomes.filter((n) => { const c = corpo(n); return !c || /s\.current\./.test(c); });
  ok(!ruins.length, `(179) as compras do Intel (${nomes.join(', ')}) nao leem s.current, que e nulo antes do Prepare${ruins.length ? ' — ' + ruins.join(', ') : ''}`);
}

// 180. O PRECO DE CADA ARMA NUM JSON PROPRIO (18/10/2026, autor): research/precos_armas.json, por "EXERCITO|par" (ou so o
//      par, ou demo:2/demo:4/laser). O arquivo de partida reproduz os precos de hoje; uma linha do arquivo manda no preco da
//      arma na mao e do item; o que nao esta nele cai na categoria das regras.
{
  const G = await import('./src/gear.mjs'); const C = await import('./src/campaign.mjs');
  const maus = [];
  const arquivo = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'research', 'precos_armas.json'), 'utf8')).armas;
  // (a) o arquivo de partida = o preco das regras, linha a linha
  G.setWeaponPriceTable({});
  const pelaRegra = {};
  for (const [chave, v] of Object.entries(arquivo)) {
    const par = chave.includes('|') ? chave.split('|')[1] : chave;
    // a recarga (reload:par) e a metade do lancador como item
    if (par.startsWith('reload:')) { const nac = chave.split('|')[0]; const l = (G.kitCatalog([nac], C.factoryTable(), R)[nac] || []).find((x) => x.id === par.slice(7)); pelaRegra[chave] = l ? Math.round(l.price / 2) : -1; continue; }
    pelaRegra[chave] = par.includes(':') || par === 'laser' ? Math.round(R.kit.price[G.kitClass(par, null, R)] ?? 0) : G.gearPrice(par, v.nome, R);
  }
  G.setWeaponPriceTable(null);
  // (18/10: o arquivo nasceu igual a regra e desde entao o autor o reprecifica; o que vale e o app cobrar o que ele diz)
  void pelaRegra;
  const cobrado = (chave, v) => { const [nac, par] = chave.includes('|') ? chave.split('|') : [null, chave]; return par.includes(':') || par === 'laser' ? null : G.gearPrice(par, v.nome, R, nac); };
  const diferentes = Object.entries(arquivo).filter(([k, v]) => { const c = cobrado(k, v); return c !== null && c !== v.preco; }).map(([k, v]) => `${k} ${v.preco}/${cobrado(k, v)}`);
  if (diferentes.length) maus.push(`o app nao cobra o que o arquivo diz: ${diferentes.slice(0, 4).join(', ')}`);
  if (Object.keys(arquivo).length < 60) maus.push(`so ${Object.keys(arquivo).length} linhas`);
  // (b) uma linha do arquivo manda; sem linha, a categoria da regra
  G.setWeaponPriceTable({ 'US|2/4': { nome: 'M4A1 ACOG/TWS', classe: 'sniper', preco: 99 }, '2/36': { classe: 'mg', preco: 33 }, laser: { classe: 'laser', preco: 7 }, 'US|4/1': { classe: 'at', preco: 61, classeItem: 'atgm', precoItem: 150 } });
  try {
    if (G.gearPrice('2/4', 'M4A1 ACOG/TWS', R, 'US') !== 99) maus.push('US|2/4 nao usou a linha do arquivo');
    if (G.gearPrice('2/4', 'M4A1 ACOG/TWS', R, 'UKR') !== R.gear.price.sniper) maus.push('a linha americana valeu para outro exercito');
    if (G.gearPrice('2/36', 'PKM', R, 'UKR') !== 33) maus.push('o par sem exercito nao valeu');
    if (G.gearPrice('2/41', 'PKP', R, 'RU') !== R.gear.price.mg) maus.push('arma fora do arquivo nao caiu na regra');
    const cat = G.kitCatalog(['US'], C.factoryTable(), R);
    const jav = (cat.US || []).find((x) => x.id === '4/1'), las = (cat.US || []).find((x) => x.id === 'laser');
    if (jav?.price !== 150 || jav?.class !== 'atgm') maus.push(`Javelin como item: ${JSON.stringify(jav && { price: jav.price, class: jav.class })}`);
    if (las?.price !== 7) maus.push(`laser: ${las?.price}`);
  } finally { G.setWeaponPriceTable(null); }
  // (c) com o arquivo de verdade, o catalogo de itens tem os precos de hoje
  const cat0 = G.kitCatalog(['US', 'RU', 'UKR'], C.factoryTable(), R);
  const jav0 = (cat0.US || []).find((x) => x.id === '4/1');
  const linhaJav = arquivo['US|4/1'];
  if (jav0?.price !== (linhaJav ? (linhaJav.precoItem ?? linhaJav.preco) : R.kit.price.atgm)) maus.push(`Javelin como item: ${jav0?.price}`);
  ok(!maus.length, `(180) precos de arma num JSON: ${Object.keys(arquivo).length} linhas cobradas como o arquivo diz, a linha manda por exercito, par e item, o resto cai na regra${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 181. A RECARGA DOS LANCADORES (18/10/2026, autor: "permitir comprar javelin rockets ou missiles"). Um item de
//      inventario com 1 missil ou foguete de um lancador recarregavel (a fabrica da a municao dele a quem nao o segura),
//      carregado por OUTRO homem da unidade, a metade do lancador; o reset poe a municao na bolsa sem mexer nas maos.
{
  const G = await import('./src/gear.mjs'); const C = await import('./src/campaign.mjs'); const T = await import('./src/transition.mjs');
  const maus = [];
  const fab = C.factoryTable();
  const cat = G.kitCatalog(['US', 'RU', 'UKR'], fab, R);
  const jav = (cat.US || []).find((x) => x.id === 'reload:4/1');
  const arqArmas = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'research', 'precos_armas.json'), 'utf8')).armas;
  const lancJav = (cat.US || []).find((x) => x.id === '4/1');
  const precoMissil = arqArmas['US|reload:4/1'] ? (arqArmas['US|reload:4/1'].precoItem ?? arqArmas['US|reload:4/1'].preco) : Math.round((lancJav?.price || 0) / 2);
  if (!jav || jav.kind !== 'reload' || jav.launcher !== '4/1' || jav.price !== precoMissil || !jav.ammo?.[57]) maus.push(`Javelin missile: ${JSON.stringify(jav)}`);
  if ((cat.US || []).some((x) => x.id === 'reload:4/2') || (cat.UKR || []).some((x) => x.id === 'reload:4/16' || x.id === 'reload:4/15')) maus.push('descartavel com recarga (AT4 ou RPG-22/26)');
  if (!(cat.UKR || []).some((x) => x.id === 'reload:4/20')) maus.push('o Corsar ficou sem recarga');
  // o lancador recarregavel vem VAZIO; o descartavel vem com o tiro
  const lJav = (cat.US || []).find((x) => x.id === '4/1'), lAT4 = (cat.US || []).find((x) => x.id === '4/2');
  if (!lJav || Object.keys(lJav.ammo).length || !lJav.empty) maus.push(`o Javelin veio com municao: ${JSON.stringify(lJav?.ammo)}`);
  if (!lAT4 || !Object.keys(lAT4.ammo).length) maus.push('o AT4 veio sem o tiro');
  // as recusas: quem segura o lancador nao leva recarga; sem lancador na unidade, nada; o lancador comprado na mesma lista vale
  const homem = (index, second, kit = null) => ({ index, slot: index, name: `H${index}`, canTake: true, weapon: '2/2', second, kit });
  const unidade = (men) => [{ coreId: 1, nation: 'US', men }];
  const recusa = (f) => { try { f(); return null; } catch (e) { return e.message; } };
  const ok1 = G.priceKit([{ index: 2, item: 'reload:4/1' }], { units: unidade([homem(1, '4/1'), homem(2, '8/0')]), kitCatalog: cat }, R);
  if (ok1.cost !== jav?.price || ok1.changes[0]?.kind !== 'reload') maus.push(`compra com o atirador na unidade: ${JSON.stringify(ok1)}`);
  const r1 = recusa(() => G.priceKit([{ index: 1, item: 'reload:4/1' }], { units: unidade([homem(1, '4/1'), homem(2, '8/0')]), kitCatalog: cat }, R));
  const r2 = recusa(() => G.priceKit([{ index: 2, item: 'reload:4/1' }], { units: unidade([homem(1, '8/0'), homem(2, '8/0')]), kitCatalog: cat }, R));
  const ok2 = recusa(() => G.priceKit([{ index: 1, item: '4/1' }, { index: 2, item: 'reload:4/1' }], { units: unidade([homem(1, '8/0'), homem(2, '8/0')]), kitCatalog: cat }, R));
  if (!/carries the launcher/.test(r1 || '')) maus.push(`o atirador comprou recarga: ${r1}`);
  if (!/nobody in his unit/.test(r2 || '')) maus.push(`recarga sem lancador: ${r2}`);
  if (ok2) maus.push(`lancador e recarga na mesma lista recusados: ${ok2}`);
  // o reset: a recarga vira o missil na bolsa de um homem sem lancador, sem trocar as maos dele
  const save = path.join(paths().savedGames, 'RUS3 BTT1 transition [B02-2].bts');
  let reset = 'sem o save da RUS3';
  if (fs.existsSync(save)) {
    const { readRoster } = await import('./src/re.mjs');
    const u = readRoster(save).unidades.find((x) => x.coreId === 177);
    const repnin = u?.soldados[2];
    const talagaev = u?.soldados[7];
    const plano = T.resetPlan(save, fab, { armies: new Map([[177, 'RU']]), keepKit: { 177: { 2: 'reload:4/1', 7: '4/1' } }, ...G.kitAmmoForReset(fab, R) });
    const pos = { ...(plano.insert[repnin?.indice] || {}), ...(plano.amounts[repnin?.indice] || {}) };
    if (pos[57] !== 1 || plano.hands[repnin?.indice]) maus.push(`reset: ${JSON.stringify({ municao: pos, maos: plano.hands[repnin?.indice] })}`);
    // o atirador com o Javelin comprado: o lancador fica, o missil dele sai
    const tira = plano.remove[talagaev?.indice] || [];
    if (!tira.includes(57)) maus.push(`o Javelin comprado manteve o missil: ${JSON.stringify(plano.remove[talagaev?.indice])}`);
    reset = `o reset poe 1 missil (item 57) na bolsa do ${repnin?.nome} e tira o do Javelin comprado do ${talagaev?.nome}`;
  }
  ok(!maus.length, `(181) recarga: Javelin missile a ${jav?.price} e Corsar missile no catalogo, lancador recarregavel vazio, descartaveis com o tiro, recusas certas, ${reset}${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 182. ABANDONADA OU IMOBILIZADA NAO E DESTRUIDA (18/10/2026, autor: "o app pensa que eu perdi o meu primeiro bmp na
//      batalha 2 da RUS3, mas ele foi apenas imobilizado e abandonado"). O jogo grava status 1 nas duas; o relatorio da
//      batalha conta so a perda de verdade, e por categoria as que passam da conta voltam de graca. O ultimo save de turno
//      e achado pelo nome que o autor usa ("final turn", "002") e liga cada maquina a tripulacao pelos nomes.
{
  const VE = await import(new URL('../tools/re/veiculo_estado.mjs', import.meta.url).href);
  const C = await import('./src/campaign.mjs');
  const maus = [];
  // (a) o ultimo save de turno pelo nome
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-t182-'));
  try {
    for (const n of ['X BTT2 transition.bts', 'X BTT2 transition [B03].bts', 'X BTT2 1.bts', 'X BTT2 002.bts', 'X BTT3 009.bts']) fs.writeFileSync(path.join(tmp, n), '');
    const sem = VE.ultimoTurno(path.join(tmp, 'X BTT2 transition.bts'));
    if (path.basename(sem?.arquivo || '') !== 'X BTT2 002.bts') maus.push(`sem final turn: ${sem?.arquivo}`);
    fs.writeFileSync(path.join(tmp, 'X BTT2 final turn.bts'), '');
    const com = VE.ultimoTurno(path.join(tmp, 'X BTT2 transition [B03].bts'));
    if (path.basename(com?.arquivo || '') !== 'X BTT2 final turn.bts') maus.push(`com final turn: ${com?.arquivo}`);
    fs.writeFileSync(path.join(tmp, 'Y BTT1 TURN 028.bts'), ''); fs.writeFileSync(path.join(tmp, 'Y BTT1 TURN 007.bts'), '');
    if (path.basename(VE.ultimoTurno(path.join(tmp, 'Y BTT1 Transition.bts'))?.arquivo || '') !== 'Y BTT1 TURN 028.bts') maus.push('o nome antigo (TURN 028) deixou de valer');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  // (b) a RUS3 b2 de verdade
  const tr = path.join(paths().savedGames, 'RUS3 BTT2 transition.bts');
  let caso = 'sem os saves da RUS3 b2';
  // (19/10: o autor rejogou a b2 e o save novo cobriu o gabarito; a parte real so vale com a b2 original, a do BMP do Kharin)
  const original = fs.existsSync(tr) && VE.tripulacaoNoFim(tr, [19]).porCore.get(19)?.homens?.[0] === 'Kharin';
  if (fs.existsSync(tr) && !original) caso = 'a RUS3 b2 foi rejogada: os saves do gabarito nao existem mais, parte real pulada';
  if (original && fs.existsSync(path.join(paths().savedGames, 'RUS3 BTT2 final turn.bts')) && fs.existsSync(C.stateFile('RUS3'))) {
    const st0 = C.loadState('RUS3'); const st = { ...st0, vehicles: {}, lost: [], wrecked: [] };
    const aar = { tanques: 1, blindados: 0, outrosVeiculos: 0 };
    const v = C.vehiclesFromSave(st, tr, { aar });
    if (v.marks[13] !== 'destroyed' || v.marks[19] !== 'immobilized' || v.marks[33] !== 'immobilized' || v.marks[182] !== 'immobilized' || v.notListed.some((x) => x.coreId === 182)) maus.push(`marcas: ${JSON.stringify(v.marks)}`);
    if (!v.writtenOff.some((w) => w.coreId === 19 && w.reason === 'aar')) maus.push('o BMP 19 sem o motivo do relatorio');
    const t = VE.tripulacaoNoFim(tr, [13, 19]);
    if (t.porCore.get(19)?.homens?.[0] !== 'Kharin' || !t.porCore.get(13)?.destruido) maus.push(`nomes: ${JSON.stringify([...t.porCore])}`);
    // relatorio que fecha a conta: nada muda
    const igual = C.vehiclesFromSave(st, tr, { aar: { tanques: 1, blindados: 2, outrosVeiculos: 1 } });
    if (igual.marks[19] !== 'destroyed' || igual.marks[33] !== 'destroyed' || !igual.notListed.some((x) => x.coreId === 182)) maus.push(`conta fechada mudou: ${JSON.stringify(igual.marks)}`);
    // um blindado perdido: fica o de mais evidencia (o 19 tem um ferido na tripulacao, o 33 nenhum)
    const um = C.vehiclesFromSave(st, tr, { aar: { tanques: 1, blindados: 1, outrosVeiculos: 1 } });
    if (um.marks[19] !== 'destroyed' || um.marks[33] !== 'immobilized') maus.push(`um blindado: ${JSON.stringify(um.marks)}`);
    // sem relatorio: como antes
    const semAar = C.vehiclesFromSave(st, tr);
    if (semAar.marks[19] !== 'destroyed') maus.push('sem relatorio mudou');
    caso = 'RUS3 b2: T-72 destroyed, os dois BMP e o Ural voltam de graca';
  }
  ok(!maus.length, `(182) abandonada nao e destruida: ultimo save de turno por "final turn" ou numero, tripulacao pelos nomes, ${caso}${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 183. O BALANCO DO CAMINHO (18/10/2026, autor: "nos com mais de uma ramificacao tem que custar mais caro, pois poder de
//      decisao e beneficio"). Beneficios (ramos alem do primeiro, pontos, inimigo leve) contra dificuldades (inimigo pesado,
//      EW, luz ruim do tipo, temperatura extrema); o saldo sai do alvo sorteado e so nao fecha onde nao havia o que mexer.
//      Peso e multiplicador sao a mesma coisa e sao publicos.
{
  const P = await import('./src/path.mjs');
  const B = R.path.balance; const maus = [];
  const porSaidas = {}; let nos = 0, residuos = 0;
  const niveis = ['None', 'Light', 'Medium', 'Strong'];
  for (let seed = 1; seed <= 12; seed++) for (const enemy of [{ nation: 'RU', nations: ['RU'] }, { nation: 'US', nations: ['US', 'UKR'] }]) {
    const sec = P.generatePath({ seed: seed * 104729, rules: R, enemy: { ...enemy, effort: 1 }, fits: 20 });
    const pub = P.publicPath(sec);
    for (const n of sec.nodes) {
      if (n.row === 0) continue;
      nos++;
      const b = n.balance;
      if (!b) { maus.push(`${n.id} sem balanco`); continue; }
      const peso = R.path.enemyWeights.find((w) => w.id === n.band);
      if (!peso || peso.mult !== n.rewardMult || peso.budget !== n.budget) maus.push(`${n.id}: peso ${n.band} e multiplicador ${n.rewardMult} desamarrados`);
      if (n.ops < 0 || n.ops > B.maxOps) maus.push(`${n.id}: ${n.ops} pontos`);
      const doTier = Object.entries(R.ew.enemyByTier[String(Math.ceil(n.row / 3))] || {}).filter(([, p]) => p > 0).map(([k]) => k);
      if (n.ew !== 'None' && !doTier.includes(n.ew)) maus.push(`${n.id}: EW ${n.ew} fora do tier`);
      if (b.residual !== b.net - (b.benefits - b.difficulties)) maus.push(`${n.id}: conta do residuo`);
      // o residuo so onde nao havia o que mexer
      if (b.residual > 0 && n.ops !== B.maxOps) maus.push(`${n.id}: faltou beneficio com pontos sobrando`);
      if (b.residual < 0) {
        const proximo = niveis[niveis.indexOf(n.ew) + 1];
        if (n.band !== 'heavy' || (proximo && doTier.includes(proximo))) maus.push(`${n.id}: faltou dificuldade com peso ou EW sobrando`);
      }
      if (b.residual) residuos++;
      const k = n.edges.length; const c = porSaidas[k] = porSaidas[k] || { n: 0, dif: 0 }; c.n++; c.dif += b.difficulties;
      const pn = pub.nodes.find((x) => x.id === n.id);
      if (pn.band !== n.band || !pn.balance) maus.push(`${n.id}: peso ou balanco fora do publico`);
    }
  }
  const media = (k) => (porSaidas[k] ? porSaidas[k].dif / porSaidas[k].n : null);
  if (!(media(2) > media(1)) || (porSaidas[3] && !(media(3) > media(2)))) maus.push(`dificuldade por saidas: 1 ${media(1)?.toFixed(2)}, 2 ${media(2)?.toFixed(2)}, 3 ${media(3)?.toFixed(2)}`);
  if (residuos > nos * 0.2) maus.push(`${residuos} de ${nos} nos com residuo`);
  // desligado: sem balanco, peso e multiplicador ainda amarrados
  const semBal = { ...R, path: { ...R.path, balance: { ...B, on: false } } };
  const sec0 = P.generatePath({ seed: 5, rules: semBal, enemy: { nation: 'RU', nations: ['RU'], effort: 1 }, fits: 20 });
  if (sec0.nodes.some((n) => n.balance) || sec0.nodes.filter((n) => n.row).some((n) => R.path.enemyWeights.find((w) => w.id === n.band)?.mult !== n.rewardMult)) maus.push('desligado: balanco presente ou peso desamarrado');
  ok(!maus.length, `(183) balanco do caminho: ${nos} nos, dificuldade media por saidas 1/2/3 = ${[1, 2, 3].map((k) => media(k)?.toFixed(2) ?? '-').join('/')}, ${residuos} com residuo (so onde nao havia o que mexer), peso = multiplicador e publico${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 184. A SF RUSSA (18/10/2026, autor: trocar a Sapper pela Recon Company [new], "apenas as unidades selecionadas"):
//      Command Squad e Tigr da companhia + o 3rd Platoon inteiro; o resto do batalhao ausente. A Sapper sai da vitrine
//      e da compra nova, mas uma campanha que ja a tem continua se cobrando.
{
  const C = await import('./src/campaign.mjs');
  const Cat = await import('./src/catalog.mjs');
  const maus = [];
  const vitrine = Cat.libFormations('RU', { specialForces: true }).filter((f) => f.sf);
  if (vitrine.map((f) => f.name).join() !== 'Recon Platoon') maus.push(`vitrine RU: ${vitrine.map((f) => f.name).join(', ')}`);
  const src = 'RU - Battalion (Reconnaissance [new])';
  const [p] = C.priceOfPicks([{ source: src, sf: true }], 'RU', R);
  const tree = Cat.formationTree(src + '.btt');
  const nomes = [];
  const walk = (n) => { if (!n.isFormation && p.keep.includes(n.key)) nomes.push(n.key + ' ' + n.name); n.children.forEach(walk); };
  tree.roots.forEach(walk);
  const esperado = ['0.4.0', '0.4.1', '0.4.4.0', '0.4.4.1', '0.4.4.2', '0.4.4.3', '0.4.4.4', '0.4.4.5'];
  if (nomes.map((x) => x.split(' ')[0]).join() !== esperado.join() || p.units !== 8) maus.push(`unidades: ${nomes.join('; ')}`);
  if (p.price !== R.formations.specialForcesPrice || Object.values(p.xp).some((x) => x !== R.formations.specialForcesExperience)) maus.push(`preco/xp ${p.price}`);
  // a Sapper antiga ainda se cobra (campanhas RUS1-3); compra nova e recusada
  const [velha] = C.priceOfPicks([{ source: 'RU - Engineer Sapper Company', sf: true }], 'RU', R);
  if (velha.sfName !== 'Engineer Sapper Platoon' || velha.price !== R.formations.specialForcesPrice) maus.push('Sapper antiga nao se cobra');
  let recusou = false; try { C.checkRetiredSpecialForces([{ source: 'RU - Engineer Sapper Company', sf: true }], R); } catch (e) { recusou = /no longer offered/.test(e.message); }
  if (!recusou) maus.push('Sapper nova nao foi recusada');
  let passou = true; try { C.checkRetiredSpecialForces([{ source: src, sf: true }], R); } catch { passou = false; }
  if (!passou) maus.push('Recon recusada');
  ok(!maus.length, `(184) SF russa = Recon Company [new]: ${nomes.length} unidades (${nomes.map((x) => x.replace(/^\S+ /, '')).join(', ')}), Sapper aposentada${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 185. UM ITEM POR SOLDADO, O NOVO SUBSTITUI (19/10/2026, autor: "ao comprar outro item o item anterior precisa ser
//      substituido"). Quem ja tem um item comprado e escolhe outro: a troca sai do antigo para o novo, o estado guarda so o
//      novo, e os bits do antigo voltam ao de fabrica (demo) enquanto os do novo ligam (laser). E a mesma escolha de novo
//      nao cobra nada (a tela a desfaz).
{
  const G = await import('./src/gear.mjs');
  const maus = [];
  const homem = (kit) => ({ index: 7, slot: 2, name: 'Pvt Test', canTake: true, kit, factoryDemo: 0, factoryLaser: false, factorySecond: null });
  const cat = { RU: [{ id: 'laser', kind: 'laser', name: 'Laser designator', class: 'laser', price: 40, ammo: {} }, { id: 'demo:4', kind: 'demo', name: 'Demo x4', class: 'demo4', price: 40, ammo: {} }] };
  const units = [{ coreId: 30, nation: 'RU', men: [homem('demo:4')] }];
  const p = G.priceKit([{ index: 7, item: 'laser' }], { units, kitCatalog: cat }, R);
  const c = p.changes[0];
  if (p.changes.length !== 1 || c.from !== 'demo:4' || c.to !== 'laser' || p.cost !== 40) maus.push(`troca: ${JSON.stringify(p)}`);
  // os bytes: o demo comprado sai (volta ao de fabrica, nenhum) e o laser liga
  const cauda = new Array(12).fill(0); cauda[8] = 0x10;
  const b = G.kitBytes(cauda, 'demo:4', 'laser', c);
  if (!b || (b.mais8 & 0x18) !== 0 || b.ligar7 !== 0x08) maus.push(`bytes: ${JSON.stringify(b)}`);
  // o estado guarda so o novo (a mesma conta de applyResult)
  const kit = { 30: { 2: 'demo:4' } };
  for (const x of p.changes) { if (x.to) kit[x.coreId][x.slot] = x.to; }
  if (Object.keys(kit[30]).length !== 1 || kit[30][2] !== 'laser') maus.push(`estado: ${JSON.stringify(kit)}`);
  // escolher de novo o que ja tem nao e compra
  const igual = G.priceKit([{ index: 7, item: 'demo:4' }], { units, kitCatalog: cat }, R);
  if (igual.changes.length || igual.cost) maus.push('o mesmo item cobrou');
  // a tela: a opcao de desfazer e o aviso de substituicao
  const tela = fs.readFileSync(path.join(import.meta.dirname, 'web', 'canvas.js'), 'utf8');
  if (!/undo selection/.test(tela) || !/kit-undo/.test(tela) || !/man-kit-btns/.test(tela) || !/replaces \$\{sai\.join/.test(tela)) maus.push('tela sem desfazer ou sem o aviso de substituicao');
  ok(!maus.length, `(185) item por soldado: o novo substitui o comprado (demo x4 -> laser, ${p.cost} cr, demo de volta a fabrica), a tela desfaz a escolha${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 186. O LANCADOR COMPRADO SUBSTITUI A ARMA DA MAO 2 (19/10/2026, autor: "sim" a "o lancador comprado substituir a arma da
//      mao 2 enquanto o soldado tiver o item"). No save das tres esquadras ucranianas (o do 114; os homens de PM estao caidos): o
//      Tkachuk tem o RPG-26 de fabrica na mao 2; o RPG-22 comprado entra no lugar dele, o foguete do RPG-26 (482) sai do
//      paiol, o do RPG-22 (481) entra, a 5,45 do fuzil fica, e o log registra a troca. Largar o item devolve o RPG-26. O Panchenko troca o AK-74 da mao 2 e a municao 5,45, que o fuzil da
//      mao 1 tambem usa, fica.
{
  const G = await import('./src/gear.mjs'); const T = await import('./src/transition.mjs'); const C = await import('./src/campaign.mjs');
  const save = path.join(import.meta.dirname, '../research/exemplos/e60_bit20.bts');
  const R0 = C.rules(); const F = C.factoryTable(); const W = C.weaponTable();
  const umEsquadrao = (coreId, n) => ({ coreId, name: `Squad (Rifle) #${n}`, present: true, role: 'infantry', nation: 'UKR' });
  const st = { nation: 'UKR', baseline: {}, units: [umEsquadrao(48, 1), umEsquadrao(49, 2), umEsquadrao(50, 3)] };
  const g = G.readGear(save, st, R0, { factory: F });
  const homens = g.units.flatMap((u) => u.men.map((m) => ({ ...m, coreId: u.coreId })));
  const maus = [];
  const pm = homens.find((m) => m.canTake && m.factorySecond === '4/16' && m.second === '4/16');
  const ak = homens.find((m) => m.canTake && m.factorySecond === '2/24' && m.second === '2/24' && Object.keys(W[m.weapon] || {}).includes('1'));
  if (!pm || !ak) maus.push(`sem os homens do caso: RPG-26 ${pm?.name} AK ${ak?.name}`);
  else {
    const plano = G.priceKit([{ index: pm.index, item: '4/15' }, { index: ak.index, item: '4/15' }], g, R0);
    if (plano.changes.length !== 2 || plano.changes.some((c) => c.factorySecond !== (c.index === pm.index ? '4/16' : '2/24'))) maus.push(`cotacao: ${JSON.stringify(plano.changes.map((c) => [c.name, c.factorySecond]))}`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't186-')); const out = path.join(dir, 'kit.bts');
    try {
      const trace = new Trace(path.join(dir, 'log.jsonl'), { slug: 'teste', battle: 0 });
      G.applyKit({ save, out, changes: plano.changes, trace });
      const armies = new Map(st.units.map((u) => [u.coreId, 'UKR']));
      const kitAmmo = (w, army) => G.kitAmmo(w, army, R0);
      const keepKit = { [pm.coreId]: { [pm.slot]: '4/15' }, [ak.coreId]: { [ak.slot]: '4/15' } };
      const com = T.resetPlan(out, F, { armies, keepKit, kitAmmo, weapons: W });
      const doPm = Object.keys(W['4/16'] || {}).filter((k) => !(k in (W[pm.weapon] || {})));
      if (com.hands[pm.index] && !/4\/15/.test(com.hands[pm.index].to)) maus.push(`mao do Tkachenko: ${com.hands[pm.index].to}`);
      if (!doPm.length || doPm.some((k) => !(com.remove[pm.index] || []).includes(Number(k)))) maus.push(`municao do RPG-26 fica: ${JSON.stringify(com.remove[pm.index])}`);
      if ((com.insert[pm.index]?.[481] ?? com.amounts[pm.index]?.[481]) !== 1) maus.push(`foguete do Tkachenko: ${JSON.stringify(com.insert[pm.index])}`);
      if ((com.remove[ak.index] || []).includes(1) || (com.remove[pm.index] || []).includes(1)) maus.push('a 5,45 saiu');
      // (o RPG-22 do Tkachuk e uma variante de fabrica da vaga dele: o reset o le como de fabrica e a municao ja sai certa;
      // o AK-74 do Romanenko nao e, e passa pela troca)
      if (com.kitSkipped.length || !com.kitReplaced.some((k) => k.coreId === ak.coreId && k.slot === ak.slot && k.hand2 === '2/24')) maus.push(`replaced ${JSON.stringify(com.kitReplaced)}, skipped ${com.kitSkipped.length}`);
      if (com.hands[ak.index] && !/4\/15/.test(com.hands[ak.index].to)) maus.push(`mao do Romanenko: ${com.hands[ak.index].to}`);
      // largar: a escrita devolve a PM e o reset sem item nao mexe mais nas maos
      // (a vaga dele sorteia RPG-22 ou RPG-26: o save trocado nao diz qual era; a campanha lembra na compra, state.kitHand2)
      const kitHand2 = {};
      for (const c of plano.changes) if (c.factorySecond && c.factorySecond !== '8/0') (kitHand2[c.coreId] = kitHand2[c.coreId] || {})[c.slot] = c.factorySecond;
      const g2 = G.readGear(out, { ...st, kit: keepKit, kitHand2 }, R0, { factory: F });
      const pm2 = g2.units.flatMap((u) => u.men).find((m) => m.index === pm.index);
      if (pm2?.factorySecond !== '4/16' || pm2?.second !== '4/15') maus.push(`releitura: ${pm2?.second} / ${pm2?.factorySecond}`);
      const largar = G.priceKit([{ index: pm.index, item: null }], g2, R0);
      const out2 = path.join(dir, 'drop.bts');
      G.applyKit({ save: out, out: out2, changes: largar.changes, trace });
      const t = readRosterTails(out2)[pm.index].cauda;
      if (t[4] !== 4 || t[5] !== 16) maus.push(`largar: mao 2 ${t[4]}/${t[5]}`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  ok(!maus.length, `(186) lancador no lugar da mao 2: ${pm?.name} troca o RPG-26 pelo RPG-22 (482 sai, 481 entra, 5,45 fica), ${ak?.name} troca o AK-74 e a 5,45 fica; largar devolve o RPG-26${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 187. O KIT-OUT NA CRIACAO (19/10/2026, autor: "uma batalha em um mapa vazio apenas com as special forces para a engine
//      gerar os soldados"). A forca levantada com a LRS deixa o kit-out pendente; a batalha 1 recusa ser montada antes dele;
//      o kit-out vai para o .cam (os dois slots), com so a SF em campo, uma Section (Supply) inimiga e 10 minutos, sem
//      tocar nos mapas jogados; o Intel espera; o rebuild refaz o kit-out; o undo volta a escolha e apaga a pasta dele; o
//      kit-out dispensado deixa a batalha 1 ser montada como antes.
{
  const C = await import('./src/campaign.mjs'); const E = await import('./src/estado.mjs');
  const maus = []; let slug = null;
  const inv = (s, quando) => { const e = E.invariantesDoEstado(s); if (e.length) maus.push(`${quando}: ${e.slice(0, 2).join('; ')}`); };
  const recusa = async (f) => { try { await f(); return null; } catch (e) { return e.message; } };
  let resumo = '';
  try {
    let st = await C.createCampaign({ name: 'ZZ T187', armies: ['US'], enemySide: 'RU', picks: [], opPoints: 4 }, () => {});
    slug = st.slug;
    const pasta = C.dirOf(slug);
    const no = st.path.nodes.find((n) => n.row === 1 && n.kind !== 'Meet') || st.path.nodes.find((n) => n.row === 1);
    C.chooseNode(slug, { node: no.id });
    await C.startCampaign(slug, () => {});
    st = await C.raiseForce(slug, { picks: [{ source: 'US - Platoon (LRS)', sf: true }] }, () => {});
    if (st.next?.kitOut !== 'pending' || C.kitOutStage(st) !== 'pending') maus.push(`raise: kitOut ${st.next?.kitOut}`);
    inv(st, 'raise');
    const semKit = await recusa(() => C.prepareBattle(slug, () => {}));
    if (!/kit out the special forces first/.test(semKit || '')) maus.push(`prepare antes do kit-out: ${semKit}`);
    st = await C.prepareKitOut(slug, () => {});
    const sf = st.units.filter((u) => u.present && C.isSpecialForcesUnit(st, u)).map((u) => u.coreId);
    const spec = JSON.parse(fs.readFileSync(path.join(pasta, 'battles', '01-kit', 'spec.json'), 'utf8'));
    if (st.stage !== 'play' || !st.current?.kitOut || st.next?.kitOut !== 'pending' || st.next.n !== 1 || st.current.slotName !== st.battleSlots[0] || st.current.playFrom.kind !== 'campaign' || !fs.existsSync(st.campaignFile)) maus.push(`kit-out montado: stage ${st.stage}, slot ${st.current?.slotName}`);
    if (spec.duration !== R.formations.kitOut.duration || spec.defense.formations.length !== 1 || !/Section \(Supply\)/.test(spec.defense.formations[0].formacao) || JSON.stringify(spec.specialForces) !== JSON.stringify(sf)) maus.push(`spec: ${spec.duration} min, ${spec.defense.formations.length} formacoes, SF ${spec.specialForces}`);
    if (st.playedMaps.length || fs.existsSync(path.join(pasta, 'battles', '01', 'battle.btt'))) maus.push(`mapas jogados ${st.playedMaps.length}, batalha 1 montada ${fs.existsSync(path.join(pasta, 'battles', '01', 'battle.btt'))}`);
    if (C.listCampaigns().find((c) => c.slug === slug)?.kitOut !== 'play') maus.push('a lista nao diz o kit-out');
    inv(st, 'kit-out montado');
    const intel = await recusa(() => C.buyEnemyIntel(slug, { strength: 10 }, () => {}));
    if (!/finish the kit-out first/.test(intel || '')) maus.push(`intel no kit-out: ${intel}`);
    const outroMapa = await recusa(() => C.regenerateBattle(slug, { newMap: true }, () => {}));
    st = await C.regenerateBattle(slug, {}, () => {});
    if (!st.current?.kitOut || st.current.map.file !== spec.map.f || !outroMapa) maus.push(`rebuild: kitOut ${st.current?.kitOut}, mapa ${st.current?.map?.file}, outro mapa "${outroMapa}"`);
    inv(st, 'rebuild');
    resumo = `${spec.map.f.replace(/ Attack\.btt$/, '')}, ${sf.length} SF, ${spec.enemyUnits.length} inimigos`;
    const cam = st.campaignFile;
    let u = C.undoBattle(slug);
    if (u.stage !== 'choose' || u.coreFile || fs.existsSync(path.join(pasta, 'battles', '01-kit')) || fs.existsSync(cam)) maus.push(`undo do kit-out: stage ${u.stage}, pasta ${fs.existsSync(path.join(pasta, 'battles', '01-kit'))}, .cam ${fs.existsSync(cam)}`);
    inv(u, 'undo');
    // dispensado: a batalha 1 volta a ser montavel, e o kit-out some
    C.chooseNode(slug, { node: no.id });
    await C.startCampaign(slug, () => {});
    await C.raiseForce(slug, { picks: [{ source: 'US - Platoon (LRS)', sf: true }] }, () => {});
    st = C.skipKitOut(slug);
    if (st.next.kitOut || C.kitOutStage(st)) maus.push(`skip: ${st.next.kitOut}`);
    const skipDeNovo = await recusa(() => C.skipKitOut(slug));
    if (!skipDeNovo) maus.push('skip duas vezes passou');
    inv(st, 'skip');
  } catch (e) { maus.push(e.message.slice(0, 200)); }
  finally {
    if (slug) { try { const s2 = C.loadState(slug); if (s2.campaignFile) fs.rmSync(s2.campaignFile, { force: true }); } catch { /* sem estado */ } fs.rmSync(C.dirOf(slug), { recursive: true, force: true }); }
  }
  ok(!maus.length, `(187) kit-out na criacao: pendente ao levantar a SF, batalha 1 recusada antes dele, montado no .cam (${resumo}, ${R.formations.kitOut.duration} min), Intel espera, rebuild, undo, skip${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 188. A LEITURA E O APPLY DO KIT-OUT (19/10/2026). Sobre o save real de um cessar-fogo no turno 0 (fixture zzkit-b1-result,
//      a SF russa nomeada): a pasta da batalha 1 vira a do kit-out e o estado passa a 'play' do kit-out. O save "vazio" e
//      aceito sem `allowEmpty`, e nada conta (creditos, pontos, record, leadership, veiculos, historico); a loja do
//      kit-out so vende arma e item; o Apply grava o item, volta ao brief da batalha 1 partindo do save do kit-out, e o
//      slot anda um; a batalha 1 entra no slot B do save, com a municao cheia; o undo dela volta ao quartel-mestre do
//      kit-out e apaga o que foi entregue.
{
  const C = await import('./src/campaign.mjs'); const E = await import('./src/estado.mjs'); const T = await import('./src/transition.mjs');
  const maus = []; const criados = [];
  const inv = (s, quando) => { const e = E.invariantesDoEstado(s); if (e.length) maus.push(`${quando}: ${e.slice(0, 2).join('; ')}`); };
  const recusa = async (f) => { try { await f(); return null; } catch (e) { return e.message; } };
  const FIX = path.join(import.meta.dirname, '..', 'research', 'qa', 'fixtures', 'zzkit-b1-result');
  const slug = 'ZZ-T188'; const pasta = C.dirOf(slug);
  const saves = paths().savedGames;
  const save = path.join(saves, 'ZZ-T188 T1.bts');
  let resumo = 'sem a pasta do jogo (pulado)';
  if (fs.existsSync(saves) && fs.existsSync(FIX)) {
    try {
      fs.rmSync(pasta, { recursive: true, force: true });
      fs.cpSync(path.join(FIX, 'campanha'), pasta, { recursive: true });
      fs.copyFileSync(path.join(FIX, 'saves', 'ZZ-KIT T1.bts'), save); criados.push(save);
      fs.renameSync(path.join(pasta, 'battles', '01'), path.join(pasta, 'battles', '01-kit'));
      fs.rmSync(path.join(pasta, 'battles', '01-kit', 'result.json'), { force: true });
      const esc = (s) => s.replace(/\\/g, '\\\\');
      const raiz = path.join(import.meta.dirname, '..');
      let txt = fs.readFileSync(path.join(pasta, 'state.json'), 'utf8');
      txt = txt.split('{{RAIZ}}\\\\app\\\\campaigns\\\\ZZ-KIT').join(esc(pasta)).split('{{RAIZ}}/app/campaigns/ZZ-KIT').join(esc(pasta)).split('{{JOGO}}').join(esc(path.dirname(saves))).split('{{RAIZ}}').join(esc(raiz));
      const st0 = JSON.parse(txt);
      st0.slug = slug;
      st0.current.bttFile = path.join(pasta, 'battles', '01-kit', 'battle.btt');
      st0.current.kitOut = true;
      st0.current.specialForces = st0.units.filter((u) => u.present && C.isSpecialForcesUnit(st0, u)).map((u) => u.coreId);
      st0.next = { n: 1, kind: 'campaign', kitOut: 'pending', node: null, mapFile: st0.current.map.file, preview: null };
      st0.stage = 'play'; delete st0.pending; delete st0.shopSnapshot; st0.seenSaves = []; st0.campaignFile = path.join(pasta, 'sem.cam');
      fs.writeFileSync(path.join(pasta, 'state.json'), JSON.stringify(st0));
      let s = C.loadState(slug);
      inv(s, 'convertido');
      const antes = { credits: s.credits, ops: s.ops, record: JSON.stringify(s.record), clean: JSON.stringify(s.cleanBattles), vehicles: JSON.stringify(s.vehicles || {}) };
      s = C.readSave(slug, save);
      const r = s.pending?.result || {};
      if (s.stage !== 'result' || !r.kitOut || !(r.named > 0) || r.reward || r.stipend || r.income || r.progression || r.leadership) maus.push(`leitura: stage ${s.stage}, kitOut ${r.kitOut}, ${r.named} nomeados`);
      if (s.credits !== antes.credits || s.ops !== antes.ops || JSON.stringify(s.record) !== antes.record || JSON.stringify(s.cleanBattles) !== antes.clean || JSON.stringify(s.vehicles || {}) !== antes.vehicles || s.history.length) maus.push('a leitura do kit-out contou alguma coisa');
      if (!fs.existsSync(path.join(pasta, 'battles', '01-kit', 'result.json')) || fs.existsSync(path.join(pasta, 'battles', '01', 'result.json'))) maus.push('result.json fora da pasta do kit-out');
      if (C.foughtIds(s).size) maus.push(`o kit-out conta como luta: ${C.foughtIds(s).size}`);
      inv(s, 'lido');
      // 25/10 (UKR): a migracao de loadState calculava o estipendio da batalha seguinte no resultado do kit-out e a acao
      // seguinte o gravava; a loja somava 1.362 cr que o servidor nao paga. O loadState pula o kit-out e limpa o gravado.
      {
        const st = JSON.parse(fs.readFileSync(C.stateFile(slug), 'utf8'));
        st.pending.result.stipend = { battle: 2, share: 0.15, budget: 2000, credits: 300 }; st.pending.result.reward = { total: 0 }; st.pending.result.income = { total: 300 };
        fs.writeFileSync(C.stateFile(slug), JSON.stringify(st));
        const limpo = C.loadState(slug); const gravado = JSON.parse(fs.readFileSync(C.stateFile(slug), 'utf8'));
        if (limpo.pending.result.stipend || limpo.pending.result.reward || limpo.pending.result.income || gravado.pending.result.stipend || gravado.pending.result.reward || gravado.pending.result.income) maus.push('o kit-out ficou com estipendio/recompensa depois do loadState');
        s = limpo;
      }
      const homem = (r.gear?.units || []).flatMap((u) => u.men).find((m) => m.canTake);
      // (21/10: no kit-out tambem se compra unidade e formacao; venda, treino e habilidade esperam a batalha)
      const venda = await recusa(() => C.quoteApply(s, { sell: [s.units.find((x) => x.present).coreId] }));
      if (!/weapons and items and buy units/.test(venda || '')) maus.push(`venda no kit-out: ${venda}`);
      const CAT = await import('./src/catalog.mjs');
      const chaves = (no, o = []) => { o.push(no.key); no.children.forEach((c) => chaves(c, o)); return o; };
      const supply = { source: 'RU - Section (Supply).btt', nation: 'RU', keep: CAT.formationTree('RU - Section (Supply).btt').roots.flatMap((x) => chaves(x)) };
      const corpo = { kit: [{ index: homem.index, item: 'demo:4' }], buyFormations: [supply] };
      const q = C.quoteApply(s, corpo);
      if (!q.kitOut || q.paid || !(q.recruitCost > 0) || q.recruits.length !== 1 || q.spend !== q.recruitCost + q.kitPlan.cost || q.available !== s.credits) maus.push(`cotacao: ${q.spend} cr, recrutas ${q.recruits.length} por ${q.recruitCost}, renda ${q.paid}`);
      const picksAntes = s.picks.length, unidadesAntes = s.units.length;
      s = await C.applyResult(slug, corpo, () => {});
      if (s.stage !== 'brief' || s.next?.kind !== 'save' || s.next?.kitOut !== 'done' || s.next.save !== save || s.slotShift !== 1 || s.history.length || s.battleNumber !== 1 || s.credits !== antes.credits - q.spend || s.aarCumulative?.battle !== 0 || !s.next.refit?.fullRefill) maus.push(`apply: stage ${s.stage}, next ${s.next?.kind}/${s.next?.kitOut}, slotShift ${s.slotShift}, ${s.credits} cr`);
      if (!Object.values(s.kit || {}).some((v) => Object.values(v).includes('demo:4'))) maus.push('o item nao ficou gravado');
      const novas = s.units.length - unidadesAntes;
      if (s.picks.length !== picksAntes + 1 || !(novas > 0) || (s.next.refit?.recruited || []).length !== novas) maus.push(`recruta: picks ${picksAntes}->${s.picks.length}, ${novas} unidades novas, ${(s.next.refit?.recruited || []).length} para o roster`);
      inv(s, 'aplicado');
      s = await C.prepareBattle(slug, () => {});
      const out = s.current?.playFrom?.file; if (out) criados.push(out);
      const sha = T.sha1(fs.readFileSync(s.current.bttFile));
      const noSave = (T.saveFacts(out).battles || []).find((b) => b.sha1 === sha);
      if (s.stage !== 'play' || s.current.kitOut || !s.current.afterKitOut || s.current.slotName !== s.battleSlots[1] || noSave?.name !== s.battleSlots[1] || !s.current.refit?.fullRefill) maus.push(`batalha 1: slot ${s.current.slotName}, no save em ${noSave?.name}`);
      // as unidades compradas no kit-out ganham linha no roster do save entregue
      // (10/11: a entrega tira da batalha e do roster as ausentes sem homem — enxugarEntrega —, entao a conta e por unidade:
      // cada comprada tem linha, e o roster bate um a um com a batalha)
      const idsOut = new Set(readRoster(out).unidades.map((x) => x.coreId));
      const compradas = (s.current.refit?.recruited || []).map((x) => x.coreId);
      const naBatalha = (await import('../tools/re/roster_cam.mjs')).unidadesDoCore(s.current.bttFile).map((x) => x.coreId);
      if (compradas.length !== novas || compradas.some((id) => !idsOut.has(id)) || naBatalha.length !== idsOut.size || naBatalha.some((id) => !idsOut.has(id))) maus.push(`roster entregue: ${idsOut.size} linhas, ${naBatalha.length} unidades na batalha, compradas ${compradas.filter((id) => idsOut.has(id)).length} de ${novas} com linha`);
      inv(s, 'batalha 1 montada');
      const u = C.undoBattle(slug);
      if (u.stage !== 'result' || !u.pending?.result?.kitOut || (u.slotShift || 0) !== 0 || u.credits !== antes.credits || u.picks.length !== picksAntes || u.units.length !== unidadesAntes || fs.existsSync(out) || fs.existsSync(path.join(pasta, 'battles', '01', 'battle.btt')) || !fs.existsSync(path.join(pasta, 'battles', '01-kit', 'result.json'))) maus.push(`undo: stage ${u.stage}, slotShift ${u.slotShift}, ${u.credits} cr, picks ${u.picks.length}, entregue ${fs.existsSync(out)}`);
      inv(u, 'undo');
      resumo = `${r.named} homens nomeados, item + Section (Supply) por ${q.spend} cr, ${novas} unidades novas no roster, batalha 1 no slot B`;
    } catch (e) { maus.push(e.message.slice(0, 200)); }
    finally {
      for (const f of criados) fs.rmSync(f, { force: true });
      fs.rmSync(pasta, { recursive: true, force: true });
    }
  }
  ok(!maus.length, `(188) leitura e Apply do kit-out: cessar-fogo aceito, nada conta, loja de arma, item, unidade e formacao (sem venda), brief da batalha 1 a partir do save do kit-out, slot deslocado, undo ao quartel-mestre do kit-out (${resumo})${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 189. A COTA DE EQUIPES DO TIER 1 (20/10/2026, autor: "entre 3-4 HMG e entre 2-3 ATGM", 1-2 ATGM na batalha 1). Em 30
//      sementes x 3 batalhas x 3 perfis, RU e US+UKR: toda defesa com 3-4 metralhadoras e o ATGM na faixa da batalha, a
//      cota inteira comprada, ao menos um pelotao, nenhum Javelin de 400 cr pela cota; os tiers 2-4 sem cota.
//      28/10: as avulsas do editor (mgSingles) sao PARTE da cota mg — na faixa da batalha (ou tantas quantas o arquivo
//      tem), so das fontes de defense.specialistTeams; sem fonte (US+UKR) nenhuma, e a cota fecha igual.
{
  const D = await import('./src/defense.mjs'); const Cat = await import('./src/catalog.mjs');
  const maus = []; let n0 = 0; let soma = { mg: 0, atgm: 0, esq: 0, avulsas: 0 };
  const fontesAvulsas = new Set(R.defense.specialistTeams?.RU || []);
  const noArquivo = D.poolOf('RU', R).filter((s) => fontesAvulsas.has(s.f.source)).flatMap((s) => s.units).filter((u) => u.role === 'mg').length;
  for (const lado of [{ nation: 'RU', nations: ['RU'] }, { nation: 'US', nations: ['US', 'UKR'] }]) {
    for (let seed = 1; seed <= 30; seed++) for (const n of [1, 2, 3]) for (const profile of ['urbano', 'misto', 'aberto']) {
      const p = D.planDefense({ ...lado, battleNumber: n, rules: R, seed: seed * 7919 + n, profile, effort: 1, kind: null });
      let mg = 0, at = 0;
      for (const k of p.kept || []) { const r = Cat.roleOf(k.name, false, R); if (r === 'mg') mg += k.n; if (r === 'atgm') at += k.n; }
      // a faixa vem da regra (22/10: a escada por batalha do tier), nao de numeros fixos aqui
      const Q = R.tiers[0].teamQuota; const faixa = { ...Q, ...(Q.byBattle?.[String(n)] || {}) };
      const [lo, hi] = faixa.atgm; const [mlo, mhi] = faixa.mg;
      const onde = `${lado.nation} b${n} ${profile} s${seed}`;
      if (mg < mlo || mg > mhi) maus.push(`${onde}: ${mg} metralhadoras (faixa ${mlo}-${mhi})`);
      if (at < lo || at > hi) maus.push(`${onde}: ${at} ATGM`);
      if (!p.teamQuota || Object.values(p.teamQuota).some((q) => q.got < q.want)) maus.push(`${onde}: cota ${JSON.stringify(p.teamQuota)}`);
      if (!p.lots.length) maus.push(`${onde}: sem pelotao`);
      if (p.trail.some((t) => t.quota && t.price >= 400)) maus.push(`${onde}: a cota comprou ${p.trail.find((t) => t.quota && t.price >= 400).unit}`);
      const avulsas = p.trail.filter((t) => t.single);
      if (avulsas.some((t) => !fontesAvulsas.has(t.source))) maus.push(`${onde}: avulsa de fonte errada`);
      if (p.trail.some((t) => t.quota === 'mg' && !t.single && fontesAvulsas.has(t.source))) maus.push(`${onde}: avulsa alem da faixa`);
      if (lado.nation === 'RU') {
        const [slo, shi] = faixa.mgSingles; const s = p.teamQuota?.mg?.singles;
        if (!s || avulsas.length !== s.got || avulsas.length < Math.min(slo, noArquivo) || avulsas.length > shi) maus.push(`${onde}: ${avulsas.length} avulsas (faixa ${slo}-${shi}, ${noArquivo} no arquivo)`);
      } else if (avulsas.length || p.teamQuota?.mg?.singles) maus.push(`${onde}: avulsas sem fonte`);
      n0++; soma.mg += mg; soma.atgm += at; soma.esq += p.count.squads; soma.avulsas += avulsas.length;
    }
  }
  // desde 02/11 os tiers 2-4 tem so a cota de antiaerea (teste 214)
  for (const n of [4, 7, 10]) { const q = D.planDefense({ nation: 'RU', nations: ['RU'], battleNumber: n, rules: R, seed: 5, profile: 'misto', effort: 1 }).teamQuota; if (q && Object.keys(q).some((k) => k !== 'aa' && k !== 'manpads')) maus.push(`a batalha ${n} tem cota de equipes`); }
  ok(!maus.length, `(189) cota do tier 1: ${n0} defesas, media ${(soma.mg / n0).toFixed(1)} metralhadoras, ${(soma.atgm / n0).toFixed(1)} ATGM, ${(soma.esq / n0).toFixed(1)} esquadras, ${(soma.avulsas / (n0 / 2)).toFixed(1)} avulsas RU; tiers 2-4 sem cota de equipes${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 190. TODO VEICULO E MAQUINA (22/10/2026, autor: "o ideal e que todo veiculo seja substituivel"). Caminhao, jipe, veiculo
//      de reconhecimento e de ATGM sao maquina (pelo nome ou pela aba 5 da tabela de tipos): marcados pelo save, repostos
//      na vaga por um preco, tripulacao que volta com eles. Tropa a pe com papel de maquina e aeronave continuam de fora.
{
  const C = await import('./src/campaign.mjs');
  const maus = [];
  const sim = [['Multipurpose Vehicle (Tigr (AGS-17))', 'truck', [82, 5]], ['Truck (Ural-4320)', 'truck', [87, 5]], ['Multipurpose Vehicle (M1152 HMMWV)', 'truck', null],
    ['Reconnaissance Vehicle (BRDM-2)', 'recon', null], ['Reconnaissance Vehicle (BRM-1K)', 'recon', null], ['ATGM Vehicle (M1167 HMMWV)', 'atgm', null],
    ['Multipurpose Vehicle (M1151 HMMWV (M2))', 'mg', null], ['Infantry Fighting Vehicle (BMP-2M) #1', 'ifv', null]];
  const nao = [['Squad (Recon)', 'recon', [220, 0]], ['Team (Stinger)', 'manpads', null], ['Heavy Mortar Team', 'mortar', null], ['AH-64D Apache Longbow (Attack Helicopter)', 'air', null], ['Squad (Machinegun)', 'mg', [28, 4]]];
  for (const [name, role, type] of sim) if (!C.isMachine({ name, role, type }, R)) maus.push(`${name} nao e maquina`);
  for (const [name, role, type] of nao) if (C.isMachine({ name, role, type }, R)) maus.push(`${name} virou maquina`);
  // a tripulacao do Tigr volta com ele, e repor o Tigr tem preco
  const st = { units: [{ coreId: 13, name: 'Multipurpose Vehicle (Tigr (AGS-17))', role: 'truck', type: [82, 5], present: true, price: 35, experience: 'Veteran' }, { coreId: 7, name: 'Squad (Recon)', role: 'recon', present: true }] };
  const crew = C.machineCrew(st, [{ index: 1, coreId: 13 }, { index: 2, coreId: 7 }], { offMap: new Set() });
  if (crew.map((c) => c.coreId).join() !== '13') maus.push(`tripulacao: ${JSON.stringify(crew)}`);
  const preco = C.vehicleCost(st.units[0], 'destroyed', R, 'RU');
  if (!(preco > 0)) maus.push(`repor o Tigr custa ${preco}`);
  ok(!maus.length, `(190) todo veiculo e maquina: ${sim.length} veiculos (Tigr, Ural, HMMWV, BRDM, BRM, M1167, HMMWV M2, BMP) sim, tropa a pe e aeronave nao; Tigr reposto por ${preco} cr, tripulacao volta com ele${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 191. UM MAPA SO (23/10/2026, autor: "fique com a versao attack de cada mapa apenas no app"). As tres versoes de cada
//      mapa de QB eram o mesmo mapa: o censo tem uma entrada Attack por mapa, os nos do caminho nao tem tipo (so o encontro),
//      o fator do orcamento so existe para o encontro, e um estado ou caminho de antes, com arquivos Probe/Assault e nos
//      tipados, e lido com o arquivo Attack do mesmo mapa e sem tipo.
{
  const C = await import('./src/campaign.mjs'); const CAT = await import('./src/catalog.mjs'); const P = await import('./src/path.mjs');
  const maus = [];
  const censo = CAT.mapCensus();
  if (censo.some((m) => m.tipo !== 'Attack') || new Set(censo.map((m) => m.familia || m.f)).size !== censo.length) maus.push('censo com outro tipo ou repetido');
  if (Object.keys(R.maps.kindBudgetFactor).join() !== 'Meet' || R.path.kindWeightsByPosition || R.tiers.some((t) => t.kinds)) maus.push('regra ainda com tipos');
  const p = P.generatePath({ seed: 2310, rules: R, enemy: { nation: 'RU', nations: ['RU'], effort: 1 }, fits: 20 });
  const tipos = new Set(p.nodes.filter((n) => n.row > 0).map((n) => n.kind));
  if ([...tipos].some((k) => k !== null && k !== 'Meet')) maus.push(`nos com tipo: ${[...tipos]}`);
  // a migracao
  const velho = {
    current: { map: { file: 'City  (688 X 736) 047r Probe.btt', kind: 'Probe' } }, next: { mapFile: 'Village (544 X 800) 059r Assault.btt' },
    badMaps: ['Village-Forest (720 X 496) 057r Assault.btt'],
    path: { nodes: [{ id: 'r2c1', kind: 'Assault', map: { f: 'Small Village (554 X 848) 019r Assault.btt', tipo: 'Assault' } }, { id: 'r3c1', kind: 'Meet', map: { f: 'X Meet.btt', tipo: 'Meet' } }] },
    history: [{ n: 1, kind: 'Probe', map: 'City', save: 'C:/x/RUS3 btt1 transition.bts' }],
  };
  const novo = C.mapaUnico(JSON.parse(JSON.stringify(velho)));
  if (novo.current.map.file !== 'City  (688 X 736) 047r Attack.btt' || novo.current.map.kind !== null || novo.next.mapFile !== 'Village (544 X 800) 059r Attack.btt' || novo.badMaps[0] !== 'Village-Forest (720 X 496) 057r Attack.btt') maus.push(`estado: ${JSON.stringify(novo).slice(0, 200)}`);
  if (novo.path.nodes[0].kind !== null || novo.path.nodes[0].map.tipo !== 'Attack' || novo.path.nodes[0].map.f !== 'Small Village (554 X 848) 019r Attack.btt' || novo.path.nodes[1].kind !== 'Meet' || novo.path.nodes[1].map.f !== 'X Meet.btt') maus.push(`caminho: ${JSON.stringify(novo.path)}`);
  if (novo.history[0].kind !== null || novo.history[0].save !== velho.history[0].save) maus.push('historico');
  if (JSON.stringify(C.mapaUnico(JSON.parse(JSON.stringify(novo)))) !== JSON.stringify(novo)) maus.push('nao idempotente');
  // o Attack do jogo nem sempre e o nome trocado: o Plehany-Open 099 tem um espaco antes do .btt
  const plehany = C.mapaUnico({ f: 'Plehany-Open (1200 X 1280) 099 Probe.btt' }).f;
  if (!censo.some((x) => x.f === plehany)) maus.push(`Plehany migrado para ${plehany}, fora do censo`);
  // o arquivo migrado existe no pacote
  const m = censo.find((x) => x.f === 'City  (688 X 736) 047r Attack.btt');
  if (!m || !fs.existsSync(CAT.mapFile(m))) maus.push('o 047r Attack nao esta no pacote');
  ok(!maus.length, `(191) um mapa so: ${censo.length} mapas (Attack), nos ${[...tipos].map((k) => k ?? 'comum').join('/')}, fator so do encontro, estado e caminho antigos migrados na leitura${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 192. O DEFENSOR ESPALHADO PELA ZONA DO GRUPO (24/10/2026, autor: no City 047r da US, 6 das 10 unidades da avenida a
//      oeste e 0 dentro de City West). `acrescentar.espalhar`: a geometria vem da zona inteira, o abrigo e so onde a
//      unidade encaixa, os outros grupos seguram a parte deles. Na faixa da avenida a metade com mais predios nao leva
//      mais unidades; na batalha montada nenhum grupo empilha duas unidades num tile e o G2 cobre as duas metades.
//      07/11 (autor: City East quase vazio na US b3): zona em dois pedacos reparte as unidades pela area de cada um, e os
//      ocupados dos outros grupos nao empurram mais o grupo para a borda nem para o outro pedaco (G14 3/2 nos objetivos).
{
  const { espalhar } = await import('../tools/re/acrescentar.mjs');
  const maus = [];
  const faixa = []; for (let y = 51; y <= 57; y++) for (let x = 0; x <= 85; x++) faixa.push([x, y]);
  const abrigo = faixa.filter(([x]) => x < 43 || x % 3 === 0);   // o oeste e todo predio, o leste tem um em tres
  const e = espalhar(abrigo, 10, [], faixa);
  const oeste = e.filter(([x]) => x < 43).length;
  if (Math.abs(oeste - (10 - oeste)) > 1) maus.push(`faixa ${oeste} oeste x ${10 - oeste} leste`);
  const xs = e.map(([x]) => x).sort((a, b) => a - b); const vao = Math.min(...xs.slice(1).map((x, k) => x - xs[k]));
  if (vao < 86 / 10 / 2) maus.push(`menor vao ${vao}`);
  if (!e.every((t) => abrigo.some((q) => q.join() === t.join()))) maus.push('escolha fora do abrigo');
  if (JSON.stringify(espalhar(abrigo, 10, [], faixa)) !== JSON.stringify(e)) maus.push('nao determinista');
  const comOcupados = espalhar(abrigo, 10, e, faixa);
  if (comOcupados.some((t) => e.some((q) => q.join() === t.join()))) maus.push('caiu num tile ocupado');
  if (espalhar(abrigo, 1, [], faixa)[0][0] < 30 || espalhar(abrigo, 1, [], faixa)[0][0] > 55) maus.push('uma unidade fora do meio');
  // duas ilhas iguais (x 0-19 e 60-79): 3/2 com ou sem ocupados amontoados na ilha leste, todas dentro das ilhas
  const ilhas = []; for (let y = 0; y <= 19; y++) for (const x0 of [0, 60]) for (let x = x0; x <= x0 + 19; x++) ilhas.push([x, y]);
  const amontoados = [[62, 2], [66, 6], [70, 10], [74, 14], [78, 18], [64, 16], [76, 4], [70, 2]];
  let ilhasTxt = '';
  for (const [rot, occ] of [['livre', []], ['ocupada', amontoados]]) {
    const r = espalhar(ilhas, 5, occ, ilhas); const w = r.filter(([x]) => x < 40).length;
    ilhasTxt += ` ${rot} ${w}/${5 - w}`;
    if (Math.abs(w - (5 - w)) !== 1) maus.push(`ilhas (${rot}) ${w}/${5 - w}`);
    if (!r.every(([x, y]) => y >= 0 && y <= 19 && (x <= 19 || x >= 60))) maus.push(`ilhas (${rot}) fora das ilhas`);
    if (r.some((t) => occ.some((q) => q.join() === t.join()))) maus.push(`ilhas (${rot}) num tile ocupado`);
  }
  // a batalha montada no City 047r, defesa do tier 1 (urbano)
  const { abrirCompleto } = await import('../tools/re/anexar2.mjs');
  const { posicaoDoElemento } = await import('../tools/re/core.mjs');
  const { grupos } = await import('../tools/re/agrupar.mjs');
  const { buildBattle } = await import('./src/forge.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't192-')); const out = path.join(dir, 'b.btt');
  const mapa = path.join(import.meta.dirname, '..', 'assets', 'qb_attack', 'City  (688 X 736) 047r Attack CMBSRL.btt');
  let g2 = '', g14 = '', resumo = '';
  try {
    // semente 196 desde 28/10: as metralhadoras avulsas (mgSingles) mudaram a defesa da 192 e o G2 dela caiu de 8 para 6
    // unidades, 4/2. O desvio de 2 e da semente, nao do espalhamento: em 6 sementes (192-197) o HEAD tinha 2 com 5/3, agora 1.
    const defesa = planDefense({ nation: 'RU', nations: ['RU'], battleNumber: 1, rules: rules(), seed: 196, profile: 'urbano', effort: 1.25 });
    const log = console.log; console.log = () => {};
    try { await buildBattle({ coreFile: path.join(import.meta.dirname, '..', 'assets', 'lib', 'US - Section (COLT).btt'), defense: defesa, mapFile: mapa, duration: 45, nation: 'US', enemy: 'RU', out, rules: rules(), trace: { event() {}, read() {}, wrote() {}, step: async (_n, _d, fn) => fn() } }); } finally { console.log = log; }
    const X = abrirCompleto(out); const c = X.completo; const gr = new Map(grupos(out).map((g) => [g.id, g.grupo]));
    const pos = []; X.R.forEach((r, k) => { if (r.form || r.ausente) return; const o = posicaoDoElemento(c, r, X.R[k + 1] ? X.R[k + 1].c : c.length); if (o === null) return; pos.push({ g: gr.get(r.id), x: Math.round((c.readFloatLE(o + 5) - 4) / 8), y: Math.round((c.readFloatLE(o + 9) - 4) / 8) }); });
    const def = pos.filter((u) => u.y <= 60);
    const porGrupo = new Map(); for (const u of def) { const k = `${u.g}:${u.x},${u.y}`; porGrupo.set(k, (porGrupo.get(k) || 0) + 1); }
    const pilhas = [...porGrupo].filter(([, v]) => v > 1).map(([k]) => k);
    if (pilhas.length) maus.push(`empilhados ${pilhas.join(' ')}`);
    const av = def.filter((u) => u.g === 2); const w = av.filter((u) => u.x < 43).length;
    g2 = `${w}/${av.length - w}`; resumo = `${def.length} unidades`;
    if (av.length >= 2 && Math.abs(w - (av.length - w)) > 1) maus.push(`G2 ${g2}`);
    // o G14 segura City West (x 9-31, y 18-46) e City East (x 62-80, y 18-48): dividido e dentro dos dois
    const mi = def.filter((u) => u.g === 14);
    const cw = mi.filter((u) => u.x >= 9 && u.x <= 31 && u.y >= 18 && u.y <= 46).length, ce = mi.filter((u) => u.x >= 62 && u.x <= 80 && u.y >= 18 && u.y <= 48).length;
    g14 = `${cw}/${ce} de ${mi.length}`;
    if (mi.length >= 2 && (cw + ce < mi.length || Math.abs(cw - ce) > 1 || !cw || !ce)) maus.push(`G14 West/East ${g14}`);
  } catch (err) { maus.push('montagem: ' + err.message.slice(0, 160)); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  ok(!maus.length, `(192) defensor espalhado: faixa ${oeste}/${10 - oeste} com o abrigo todo a oeste, menor vao ${vao}; 047r ${resumo}, G2 oeste/leste ${g2}, G14 City West/East ${g14}, ilhas${ilhasTxt}, sem pilha no grupo${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 193. AS FORMACOES DESCARTADAS (24/10/2026, autor): o UKR [Breach], o Hind Mi-24P [antitank] e o Apache AH-64D saem da
//      loja, da defesa e do encontro (`rules.formations.discarded`, catalog.libFormations) e a compra e recusada; a SF
//      ucraniana (o arquivo sem [Breach]) continua na vitrine.
{
  const CAT = await import('./src/catalog.mjs'); const C = await import('./src/campaign.mjs'); const M = await import('./src/meet.mjs');
  const maus = []; const fora = R.formations.discarded || [];
  if (fora.length !== 4) maus.push(`${fora.length} descartadas`);
  for (const src of fora) if (!fs.existsSync(path.join(paths().lib, src + '.btt'))) maus.push(`${src} nao esta na biblioteca (nome errado?)`);
  const loja = [...CAT.libraryForArmies(['US', 'UKR'], { specialForces: true }), ...CAT.libFormations('UKR'), ...CAT.libFormations('US')].map((f) => f.source);
  for (const src of fora) if (loja.includes(src)) maus.push(`${src} ainda na biblioteca`);
  if (!CAT.libraryForArmies(['UKR'], { specialForces: true }).some((f) => f.sf)) maus.push('a SF ucraniana sumiu');
  for (const src of fora) { try { C.checkDiscardedFormations([{ source: src }], R); maus.push(`${src} comprada`); } catch { /* esperado */ } }
  let defesas = 0;
  for (const b of [1, 4, 7, 10]) for (const seed of [1, 2, 3]) {
    const d = planDefense({ nation: 'UKR', nations: ['US', 'UKR'], battleNumber: b, rules: R, seed, profile: 'misto', effort: 1 }); defesas++;
    const fontes = (d.sources || []).map((x) => String(x.source || x));
    for (const src of fora) if (fontes.some((f) => f.includes(src))) maus.push(`defesa b${b} s${seed} com ${src}`);
  }
  try {
    const pool = M.meetPoolOf('UKR', 1, R);
    if (!pool.length || !pool.every((x) => x.f?.source)) maus.push('encontro sem fontes legiveis');
    if (pool.some((x) => fora.includes(x.f?.source))) maus.push('encontro com formacao descartada');
  } catch (e) { maus.push('encontro: ' + e.message.slice(0, 80)); }
  ok(!maus.length, `(193) formacoes descartadas: ${fora.length} fora da loja, de ${defesas} defesas e do encontro; compra recusada${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 194. O NOME COM PARENTESE (25/10/2026, campanha UKR): o gerador do jogo criou "Romanyuk)", que saiu ferido na b1 e, pulado
//      pelo leitor do roster, nunca foi oferecido para reposicao. O leitor aceita um ")" no fim e nada mais (o lixo dos bytes
//      continua de fora), e um nome de 24 letras continua valendo.
{
  const RO = await import('../tools/re/roster.mjs');
  const bloco = (nomes) => Buffer.concat(nomes.flatMap(([n, e]) => { const l = Buffer.alloc(2); l.writeUInt16LE(n.length); return [l, Buffer.from(n, 'latin1'), Buffer.from([e, 0x0e, 0, 2, 0, 0])]; }));
  const lidos = RO.soldadosDoBloco(bloco([['Kostyuk', 0], ['Romanyuk)', 2], ['Soroka', 0], ['iC hB', 0], ['Yqt;L', 0], ['Abcdefghijklmnopqrstuvwx', 3]])).map((s) => `${s.nome}:${s.estado}`).join(',');
  ok(lidos === 'Kostyuk:0,Romanyuk):2,Soroka:0,Abcdefghijklmnopqrstuvwx:3' && !RO.NOME.test('Roman)yuk') && !RO.NOME.test('Romanyuk))'),
    `(194) nome com ")" no fim lido (o ferido da UKR volta a lista de baixas), lixo de fora: ${lidos}`);
}

// 195. O PLACAR FINAL COM PARTES, RANK E MULTIPLICADOR (autor, 25/10): batalhas + creditos + forca preservada + razao de
//      baixas - derrotas, vezes a dificuldade da criacao; os presets dao 0,65 / 0,80 / 1,00 / 1,05 / 1,25; as partes somam
//      o subtotal; o rank cai pelas faixas; as derrotas permitidas de uma campanha antiga sao as que restam mais as sofridas;
//      o resumo traz partes, rank, arte e destaques, e a lista traz o rank.
{
  const C = await import('./src/campaign.mjs'); const R0 = C.rules(); const maus = [];
  const mults = R0.difficulty.presets.map((p) => C.difficultyMultiplier({ armies: p.armies, defeatsAllowed: p.defeats, rescueChance: p.rescueChance, path: { startingPoints: p.opPoints }, forceRatio: p.ratio }, R0));
  // 30/10 (a escada): a razao de forca no lugar do esforco do inimigo
  if (mults.join() !== '0.52,0.72,1,1.16,1.63') maus.push(`multiplicadores ${mults}`);
  if (C.difficultyMultiplier({ armies: ['RU'], defeatsAllowed: 2, rescueChance: 0.5, path: { startingPoints: 3 }, forceRatio: 0.9 }, R0) !== 1.3) maus.push('a razao de forca nao multiplica');
  const st = {
    armies: ['RU'], defeatsLeft: 1, rescueChance: 0.5, path: { startingPoints: 3 }, forceRatio: 1.3, credits: 1000,
    history: [{ n: 1, level: 'Total Victory', won: true }, { n: 2, level: 'Major Defeat', won: false }],
    units: [{ coreId: 1, present: true, price: 400 }, { coreId: 2, present: true, price: 600 }, { coreId: 3, present: false, price: 900 }],
    lost: [2], aarCumulative: { player: { mortos: 10, feridos: 10, desaparecidos: 0 }, enemy: { mortos: 50, feridos: 10, desaparecidos: 0 } },
  };
  if (C.defeatsAllowedOf(st) !== 2) maus.push(`derrotas permitidas derivadas ${C.defeatsAllowedOf(st)}`);
  const sc = C.scoreOf(st, R0); const p = Object.fromEntries(sc.parts.map((x) => [x.id, x.value]));
  // 8+1 niveis = 9000; 1000 cr; forca 400 x 0,5 = 200; razao 60/20 = 3 x 2000 = 6000; 1 derrota = -2000
  if (p.battles !== 9000 || p.credits !== 1000 || p.force !== 200 || p.ratio !== 6000 || p.defeats !== -2000) maus.push(`partes ${JSON.stringify(p)}`);
  if (sc.subtotal !== sc.parts.reduce((a, x) => a + x.value, 0) || sc.total !== Math.round(sc.subtotal * sc.multiplier)) maus.push(`subtotal ${sc.subtotal} total ${sc.total}`);
  const cap = C.scoreOf({ ...st, aarCumulative: { player: { mortos: 0, feridos: 0, desaparecidos: 0 }, enemy: { mortos: 9, feridos: 0, desaparecidos: 0 } } }, R0).parts.find((x) => x.id === 'ratio').value;
  if (cap !== R0.score.ratioCap * R0.score.perRatio) maus.push(`razao sem baixas suas ${cap}`);
  const faixas = R0.score.ranks.map((f) => f.min);
  const ranks = [...faixas, 999999, faixas[0] - 1].map((t) => C.rankOf(t, R0)).join('');
  if (ranks !== 'SABCDSA') maus.push(`ranks ${ranks}`);
  // 06/11 (autor): a campanha perdida e sempre a pior letra, com qualquer placar; os pontos nao mudam
  const pior = R0.score.ranks[R0.score.ranks.length - 1].rank;
  if (C.rankOf(999999, R0, { lost: true }) !== pior) maus.push('rankOf perdida nao e a pior');
  { const perdida = C.scoreOf({ ...st, outcome: 'lost', credits: 999999 }, R0), ganha = C.scoreOf({ ...st, credits: 999999 }, R0);
    if (perdida.rank !== pior || ganha.rank === pior || perdida.total !== ganha.total) maus.push(`placar perdido ${perdida.rank}/${perdida.total} vs ${ganha.rank}/${ganha.total}`); }
  if (C.scoreOf({ ...st, credits: -50000 }, R0).total !== 0) maus.push('placar negativo');
  // o resumo e a lista de uma campanha local com historico
  const dir = path.join(CAMPAIGNS_DIR);
  const local = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).find((d) => { try { return (JSON.parse(fs.readFileSync(path.join(dir, d, 'state.json'), 'utf8')).history || []).length >= 2; } catch { return false; } });
  let resumo = 'sem campanha local (pulado)';
  if (local) {
    const S = C.campaignSummary(local);
    if (!S.score?.parts?.length || !S.rank || !S.art || !S.highlights?.best || ('mostWins' in S.highlights)) maus.push(`resumo ${JSON.stringify({ parts: S.score?.parts?.length, rank: S.rank, art: S.art, h: S.highlights })}`);
    resumo = `${local}: ${S.score.total} rank ${S.rank} (x${S.score.multiplier}), melhor B${S.highlights.best?.n}`;
  }
  const lista = C.listCampaigns();
  if (lista.some((c) => !('rank' in c) || !('finishedAt' in c))) maus.push('a lista nao traz rank/finishedAt');
  // a perdida local (fechada antes de 06/11 com a letra do placar) sai D no resumo e no Hall of Fame; os repostos contam
  // os destrocos refeitos na vaga (rebuilt), nao so os de gemeo
  for (const c of lista.filter((x) => x.outcome === 'lost' && x.score != null)) {
    const S = C.campaignSummary(c.slug), st2 = C.loadState(c.slug);
    if (S.rank !== pior || c.rank !== pior) maus.push(`perdida ${c.slug} rank ${S.rank}/${c.rank}`);
    const refeitos = (st2.wrecked || []).filter((w) => w.rebuilt || w.replacedBy != null).length;
    if (S.totals.wrecksReplaced !== refeitos || 'vehiclesLost' in S.totals) maus.push(`repostos ${S.totals.wrecksReplaced} != ${refeitos}`);
    resumo += `; perdida ${c.slug} ${S.score.total} rank ${S.rank}, ${S.totals.youVehicles} veiculos destruidos, ${refeitos} repostos`;
  }
  ok(!maus.length, `(195) placar final: presets ${mults.join('/')}, partes ${JSON.stringify(p)} x${sc.multiplier} = ${sc.total} (${sc.rank}); ${resumo}${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 196. O SAVE JA LIDO QUE O JOGO REGRAVOU (25/10/2026, UKR: a b6 salva como "UKR btt7 transition", a b7 com o mesmo nome,
//      e a lista nem mostrava a b7). `overwrittenSaves` aponta o ja lido que mudou depois da montagem da batalha atual, com
//      a batalha que ele foi; o que nao mudou, o que sumiu e fora de `play` ficam de fora.
{
  const C = await import('./src/campaign.mjs'); const { CAMPAIGNS_DIR } = await import('./src/settings.mjs');
  const slug = 'ZZ-T196'; const dir = path.join(CAMPAIGNS_DIR, slug); const maus = [];
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  try {
    const velho = path.join(dir, 'UKR btt7 transition.bts'), parado = path.join(dir, 'parado.bts'), sumido = path.join(dir, 'sumido.bts');
    fs.writeFileSync(velho, 'x'); fs.writeFileSync(parado, 'x');
    const montada = Date.now() - 60_000;
    fs.utimesSync(parado, new Date(montada - 120_000), new Date(montada - 120_000));
    const st = { version: 1, slug, name: slug, stage: 'play', battleNumber: 7, credits: 0, units: [], picks: [], seenSaves: [velho, parado, sumido],
      history: [{ n: 6, level: 'Draw', save: velho }], current: { n: 7, generatedAt: new Date(montada).toISOString() } };
    fs.writeFileSync(C.stateFile(slug), JSON.stringify(st));
    const o = C.overwrittenSaves(slug);
    if (o.length !== 1 || o[0].name !== 'UKR btt7 transition.bts' || o[0].readAs !== 6) maus.push(`em play: ${JSON.stringify(o)}`);
    fs.writeFileSync(C.stateFile(slug), JSON.stringify({ ...st, stage: 'result' }));
    if (C.overwrittenSaves(slug).length) maus.push('fora de play ainda avisa');
  } catch (e) { maus.push(e.message.slice(0, 160)); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  ok(!maus.length, `(196) save ja lido regravado: so o que mudou depois da montagem, com a batalha que ele foi${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 197. O ENCONTRO ACOMPANHA A FORCA DO JOGADOR (autor, 25/10, UKR b8): o orcamento e o maior entre a escala do tier e o
//      valor da forca em campo, com teto de 1,5x a escala; os tiers 2-4 passam 5 % da mecanizada e 5 % dos leves para os
//      tanques (55 %), o tier 1 nao muda; floor 0 (o caminho, cego) e a escala de sempre.
{
  const M = await import('./src/meet.mjs'); const maus = [];
  const b = [M.meetBudget(10000, 0, R), M.meetBudget(10000, 8000, R), M.meetBudget(10000, 12345, R), M.meetBudget(10000, 99999, R)].join();
  if (b !== '10000,10000,12345,15000') maus.push(`meetBudget ${b}`);
  for (const t of ['2', '3', '4']) {
    const s = R.meet.sharesByTier[t]; const soma = Object.values(s).reduce((a, x) => a + x, 0);
    if (Math.abs(soma - 1) > 1e-9 || s.tanks !== 0.55 || s.mech !== 0.1 || s.light !== 0.05) maus.push(`tier ${t}: ${JSON.stringify(s)}`);
  }
  if (M.meetSharesFor(1, R).tanks !== 0.5 || M.meetSharesFor(1, R).mech !== 0.3) maus.push('o tier 1 mudou');
  const args = { nation: 'RU', nations: ['RU'], battleNumber: 8, rules: R, seed: 197, effort: 1 };
  const cego = M.planMeetForce(args), alto = M.planMeetForce({ ...args, floor: cego.budget * 1.3 }), teto = M.planMeetForce({ ...args, floor: cego.budget * 9 });
  if (cego.meetBudget.budget !== cego.meetBudget.scale || cego.budget !== cego.meetBudget.scale) maus.push(`cego ${JSON.stringify(cego.meetBudget)}`);
  if (alto.budget !== Math.round(cego.budget * 1.3) || !(alto.cost > cego.cost)) maus.push(`piso: ${alto.budget} cr, custo ${alto.cost} x ${cego.cost}`);
  if (teto.budget !== Math.round(cego.budget * R.meet.playerFloor.ceiling)) maus.push(`teto ${teto.budget}`);
  ok(!maus.length, `(197) encontro com o piso do jogador: escala ${cego.budget} (${cego.units} un.), x1,3 = ${alto.budget} (${alto.units} un.), teto ${teto.budget}; tiers 2-4 com 55 % de tanques${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 198. A FORCA EM LISTA (autor, 25/10): o canvas expoe as pecas do bloco (botao de tomar/largar, on/off map, coluna de
//      homens) para a lista nao ter outra ideia do que um clique faz; a pagina tem o switch lembrado, a lista e o painel
//      da unidade; a rota da arvore da homens e armas de fabrica a toda unidade que a tabela de fabrica conhece.
{
  const maus = [];
  const canvas = fs.readFileSync(path.join(import.meta.dirname, 'web', 'canvas.js'), 'utf8');
  const pagina = fs.readFileSync(path.join(import.meta.dirname, 'web', 'app.js'), 'utf8');
  for (const k of ['pane.parts', 'const actionButton', 'const deployButton', 'const menColumn']) if (!canvas.includes(k)) maus.push(`canvas sem ${k}`);
  for (const k of ['cmbsdc.forceView', 'function renderForceList(', 'function renderSelectionCard(', 'function modoEdicao(', 'function modoLeitura(', 'viewSwitch(renderPicks)', 'viewSwitch(desenharVista)']) if (!pagina.includes(k)) maus.push(`app.js sem ${k}`);
  const C = await import('./src/campaign.mjs'); const CAT = await import('./src/catalog.mjs'); const G = await import('./src/gear.mjs');
  const fab = C.factoryTable(); const t = CAT.formationTree('US - Battalion (Infantry).btt');
  let folhas = 0, comKit = 0; const ver = (n) => { if (n.isFormation) n.children.forEach(ver); else { folhas++; const k = G.factoryKit(fab, 'US', n.type); if (k && k.length) comKit++; } };
  t.roots.forEach(ver);
  if (comKit / folhas < 0.8) maus.push(`so ${comKit} de ${folhas} unidades com kit de fabrica`);
  const rota = fs.readFileSync(path.join(import.meta.dirname, 'server.mjs'), 'utf8');
  if (!/\.\.\.homens\(n\)/.test(rota)) maus.push('a rota da arvore nao anota homens e armas');
  ok(!maus.length, `(198) forca em lista: pecas do bloco partilhadas, switch lembrado, painel da unidade; ${comKit}/${folhas} unidades com homens e armas de fabrica${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 199. A PAGINA DAS REGRAS (autor, 25/10): "Rules" no menu inicial entre Campaign e About, roteada por #rules, e os
//      numeros lidos de STATUS.rules (o rules.json), nao escritos a mao.
{
  const maus = [];
  const pagina = fs.readFileSync(path.join(import.meta.dirname, 'web', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(import.meta.dirname, 'web', 'index.html'), 'utf8');
  if (!/id="go-campaign"[\s\S]*?id="go-rules"[\s\S]*?id="go-about"/.test(html)) maus.push('Rules nao esta entre Campaign e About no menu');
  if (!html.includes('id="rules-body"')) maus.push('sem #rules-body');
  for (const k of ['function renderRules(', "'rules']", "v.screen === 'rules'", "seg('Rules')", "go({ screen: 'rules' })"]) if (!pagina.includes(k)) maus.push(`app.js sem ${k}`);
  for (const k of ['R.score', 'R.path?.reveal', 'R.reward?.weights', 'R.reward?.replacement', 'STATUS?.playerLadder', 'STATUS?.presetMultipliers', 'R.progression?.promotion', 'R.tiers', 'R.difficulty?.presets']) if (!pagina.includes(k)) maus.push(`a pagina nao le ${k}`);
  ok(!maus.length, `(199) Rules no menu inicial, entre Campaign e About, com os numeros do rules.json${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 200. ARMAS DE APOIO NAS CRISTAS DO SUL (autor, 28/10/2026, Village-Hills 300: "incluir algumas unidades de armas
//      estaticas nas regioes mais altas na borda sul do mapa"; so reposicionar o que a defesa ja sorteia, parte no sul e
//      parte nos objetivos, fixas no Setup). (a) SPG-9 e MT-12 vao com os ATGM para o G3 em todo mapa; AGS segue no G4 e a
//      MG leve no G2. (b) O Setup do G4 ganhou o terreno alto do SW (x 0-40, y 0-10, z >= p90) sem perder os objetivos; G3
//      e G4 so com o Setup. (c) Batalhas montadas: parte de G3+G4 nas cristas, parte fora; equipe no sul so em abrigo.
//      Medido em 54 batalhas (28/10): G4 nas cristas 32 % -> 48 %, G3 72 % -> 66 % (com o MT-12), 0 equipe no aberto.
{
  const maus = [];
  const { papelFino } = await import('../tools/re/ia_agrupar.mjs');
  const R = rules(); const { roleOf } = await import('./src/catalog.mjs');
  const esperado = { 'Squad (Recoilless)': 'atgm', 'Team (Recoilless)': 'atgm', 'Team (Antitank Gun)': 'atgm', '3 x 100mm Gun (MT-12 Rapira)': 'atgm', 'Squad (ATGM)': 'atgm', 'HMG Team': 'hmg', 'Squad (Grenade Launcher)': 'hmg', 'Machinegun Team (PKM)': 'avancado', 'Team (RPG)': 'infApoio', 'Squad (Rifle)': 'squad' };
  for (const [n, p] of Object.entries(esperado)) { const r = papelFino(n, roleOf(n, false, R)); if (r !== p) maus.push(`${n}: ${r} (esperado ${p})`); }
  const IE = await import('../tools/re/ia_escrever.mjs'); const D = await import('../tools/re/ia_doutrina.mjs');
  const mapa = path.join(import.meta.dirname, '..', 'assets', 'qb_attack', 'Village-Hills (688 X 736) 300 Attack CMBSRL.btt');
  const F = D.feicoes(mapa); const d = IE.decodificar(mapa);
  const cristaSul = ([x, y]) => x <= 40 && y <= 10;
  const zona = (g) => new Set(IE.doMapa(d, d.azul[0].slots[g - 1][0].tiles).map((t) => t.join()));
  const g4 = zona(4); let faltam = 0;
  for (let y = 0; y <= 10; y++) for (let x = 0; x <= 40; x++) { const i = F.idx(x, y); if (F.azul[i] && F.z[i] >= F.pct(0.9) && !g4.has(`${x},${y}`)) faltam++; }
  if (faltam) maus.push(`G4 sem ${faltam} tiles das cristas do SW`);
  const g4fora = [...g4].filter((t) => !cristaSul(t.split(',').map(Number))).length;
  if (g4fora < 250) maus.push(`G4 perdeu os objetivos (${g4fora} tiles fora das cristas)`);
  for (const g of [3, 4]) { const s = d.azul[0].slots[g - 1]; if (s.length !== 1 || s[0].esperas.length) maus.push(`G${g} com ordem ou espera`); }
  const { abrirCompleto } = await import('../tools/re/anexar2.mjs');
  const { posicaoDoElemento } = await import('../tools/re/core.mjs');
  const { grupos } = await import('../tools/re/agrupar.mjs');
  const { buildBattle } = await import('./src/forge.mjs');
  const lib = (n) => path.join(import.meta.dirname, '..', 'assets', 'lib', n);
  let sul = 0, total = 0; const noAberto = [];
  for (const c of [{ def: 'RU', core: 'US - Section (COLT).btt', nat: 'US', seed: 3001 }, { def: 'UKR', core: 'RU - Section (Supply).btt', nat: 'RU', seed: 3002 }, { def: 'US', core: 'RU - Section (Supply).btt', nat: 'RU', seed: 3003 }]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't200-')); const out = path.join(dir, 'b.btt');
    try {
      const defesa = planDefense({ nation: c.def, nations: [c.def], battleNumber: 3, rules: R, seed: c.seed, profile: 'aberto', effort: 1 });
      const log = console.log; console.log = () => {};
      try { await buildBattle({ coreFile: lib(c.core), defense: defesa, mapFile: mapa, duration: 45, nation: c.nat, enemy: c.def, out, rules: R, trace: { event() {}, read() {}, wrote() {}, step: async (_n, _d, fn) => fn() } }); } finally { console.log = log; }
      const X = abrirCompleto(out); const cc = X.completo; const gr = new Map(grupos(out).map((g) => [g.id, g.grupo]));
      X.R.forEach((r, k) => {
        if (r.form || r.ausente) return; const g = gr.get(r.id); if (g !== 3 && g !== 4) return;
        const o = posicaoDoElemento(cc, r, X.R[k + 1] ? X.R[k + 1].c : cc.length); if (o === null) return;
        const x = Math.round((cc.readFloatLE(o + 5) - 4) / 8), y = Math.round((cc.readFloatLE(o + 9) - 4) / 8); if (y > 60) return;
        total++;
        if (cristaSul([x, y])) { sul++; if (!F.abrigo[F.idx(x, y)] && !/Vehicle|HMMWV|Gun \(/.test(r.nm)) noAberto.push(`${r.nm}@${x},${y}`); }
      });
    } catch (err) { maus.push(`${c.def}: ${err.message.slice(0, 140)}`); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  if (!total) maus.push('nenhuma unidade de G3/G4 nas batalhas');
  else if (sul === 0 || sul === total) maus.push(`G3+G4 nas cristas ${sul}/${total}: tudo ou nada`);
  if (noAberto.length) maus.push(`equipe no aberto das cristas: ${noAberto.join(' ')}`);
  ok(!maus.length, `(200) Village-Hills 300: SPG-9/MT-12 no G3, G4 com as cristas do SW (${g4.size} tiles, ${g4fora} fora delas), G3/G4 fixos; 3 batalhas b3 com G3+G4 nas cristas ${sul}/${total}, nenhuma equipe no aberto${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 201. O SETUP NASCE ONDE A ROTA COMECA (autor, 28/10, Village-Forest 012r: o def2 e os BTR nasciam no terco do centro
//      e a seta os mandava ~290 m para oeste, de lado). No roteiro o terco nomeado vira a banda do kind numa janela em
//      torno do 1o ponto da rota (a infantaria mecanizada fica com a do transporte); `fixo: true` e alignSetup false
//      mantem o terco.
{
  const ENC = await import('../tools/re/ia_encontro.mjs'); const IE = await import('../tools/re/ia_escrever.mjs');
  const base = path.join(import.meta.dirname, '..', 'assets', 'qb_meet', 'Village-Forest (928 X 922) 012r Meet CMBSRL.btt');
  const ajustes = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'research', 'ia', 'village_forest_012r.meet.ajustes.json'), 'utf8'));
  const Rm = rules(); const G = ajustes.grupos; const maus = [];
  const roda = (aj, cfg) => ENC.aplicarDoutrinaEncontro(base, { duracaoMin: 80, doctrine: Rm.meet.doctrine, assault: Rm.meet.assault, ajustes: aj, modo: 'roteiro', roteiroCfg: cfg });
  const cx = (d, e) => { const m = IE.doMapa(d, e.tiles); return m.reduce((a, q) => a + q[0], 0) / m.length; };
  const novo = roda(ajustes, Rm.meet.roteiro), velho = roda(ajustes, { ...Rm.meet.roteiro, alignSetup: false });
  const S = (r, g) => r.d.azul[0].slots[G[g] - 1];
  const dx = (r, g) => Math.round(Math.abs(cx(r.d, S(r, g)[1]) - cx(r.d, S(r, g)[0])));
  const janela = Rm.meet.roteiro.setupWindow;
  const comRota = ['def1', 'def2', 'def3', 'wVeh', 'mVeh'];
  for (const g of comRota) if (dx(novo, g) > janela) maus.push(`${g} nasce ${dx(novo, g)} tiles ao lado do 1o ponto`);
  if (!(dx(velho, 'def2') > 25) || !(dx(velho, 'mVeh') > 25)) maus.push(`o desalinhamento de antes sumiu do controle: def2 ${dx(velho, 'def2')}, mVeh ${dx(velho, 'mVeh')}`);
  const mesmo = (a, b) => JSON.stringify(a.tiles) === JSON.stringify(b.tiles);
  if (!mesmo(S(novo, 'mInf')[0], S(novo, 'mVeh')[0]) || !mesmo(S(novo, 'wInf')[0], S(novo, 'wVeh')[0])) maus.push('a infantaria mecanizada nao nasce com o transporte');
  const fixo = JSON.parse(JSON.stringify(ajustes)); fixo.planos.plano.def2[0].fixo = true;
  if (!mesmo(S(roda(fixo, Rm.meet.roteiro), 'def2')[0], S(velho, 'def2')[0])) maus.push('fixo: true nao manteve o terco');
  ok(!maus.length, `(201) setup na ancora da rota no 012r: def2 ${dx(velho, 'def2')} -> ${dx(novo, 'def2')} tiles, mVeh ${dx(velho, 'mVeh')} -> ${dx(novo, 'mVeh')}; mecanizada com o transporte; fixo e alignSetup false mantem o terco${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 202. O FILTRO 'encara' E O zMin (autor, 28/10, Open-Hills 315: os blindados no morro do Lake Resort paravam na encosta
//      de tras). 'encara' = o chao nao sobe acima do olho nos tres raios para o atacante ate `alcance` tiles; zMin =
//      altura minima do chao. No 315 a face oeste do morro passa e a encosta leste (x > 110) nao.
{
  const D = await import('../tools/re/ia_doutrina.mjs');
  const F = D.feicoes(path.join(import.meta.dirname, '..', 'assets', 'qb_meet', 'Open-Hills (1248 X 1200) 315 Meet CMBSRL.btt'));
  const maus = []; const Z = (p) => D.zonaManual(F, [{ ret: [86, 118, 38, 86], fora: true, ...p }], { soAzul: false });
  const encara = Z({ filtro: ['rodavel', 'encara'], zMin: 34 }), semZ = Z({ filtro: ['rodavel', 'encara'] }), so = Z({ filtro: 'rodavel' });
  // a encosta leste do morro, abaixo da crista (a crista curva para x 111-113 em y 76-83, z 43-46, e encara; y 38-41 e
  // o outro morro, ao sul)
  const tras = (z) => z.filter(([x, y]) => x > 110 && y >= 42 && F.z[F.idx(x, y)] < 42).length;
  if (encara.length < 500) maus.push(`so ${encara.length} tiles`);
  if (tras(encara)) maus.push(`${tras(encara)} tiles na encosta de tras`);
  if (!(tras(so) > 100)) maus.push('o controle (so rodavel) nao pega a encosta de tras');
  if (encara.some(([x, y]) => F.z[F.idx(x, y)] < 34) || !semZ.some(([x, y]) => F.z[F.idx(x, y)] < 34)) maus.push('zMin');
  // `de` fixa a direcao: olhando para o NE (de onde nao vem ninguem), a encosta leste e que encara
  const ne = Z({ filtro: ['rodavel', 'encara'], zMin: 34, de: [155, 149] });
  if (!(tras(ne) > 50)) maus.push(`de: [155,149] deveria pegar a encosta leste (${tras(ne)})`);
  ok(!maus.length, `(202) filtro encara no 315: ${encara.length} tiles na face oeste, ${tras(encara)} de ${tras(so)} na encosta de tras; zMin e de: [x,y] valem${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 203. AS EQUIPES DE METRALHADORA AVULSAS (autor, 28/10/2026: "equipes PKP avulsas no modelo de geracao de forca"). O
//      editor vende LMG Team (PKP) e Machinegun Team (PKM) soltas (Specialist Teams, bit 0x02 de +11); o arquivo
//      `RU - Specialist Teams (MG)` e so da defesa. (a) Fora da loja e da compra; no pool da defesa, papel mg, balde de
//      equipes, soltas, 80 cr. (b) papelFino: PKP e PKM avulsa no G4 (hmg); a PKM de pelotao e a Squad (Machinegun) no
//      G2. (c) Batalha RU b3 no Village-Hills 300: as avulsas chegam com o bit, no G4, em abrigo, arquivo conferido.
{
  const maus = []; const R = rules();
  const Cat = await import('./src/catalog.mjs'); const D = await import('./src/defense.mjs');
  const { checkDiscardedFormations } = await import('./src/campaign.mjs');
  const { papelFino } = await import('../tools/re/ia_agrupar.mjs');
  const fonte = 'RU - Specialist Teams (MG)';
  if (Cat.libraryForArmies(['RU']).some((f) => f.source === fonte)) maus.push('o arquivo aparece na loja');
  try { checkDiscardedFormations([{ source: fonte }], R); maus.push('a compra dele passou'); } catch { /* recusada */ }
  const pool = D.poolOf('RU', R).find((s) => s.f.source === fonte);
  const equipes = (pool?.units || []).filter((u) => /LMG Team \(PKP\)|Machinegun Team \(PKM\)/.test(u.name));
  if (!equipes.some((u) => /PKP/.test(u.name)) || !equipes.some((u) => /PKM/.test(u.name))) maus.push(`pool: ${equipes.map((u) => u.name).join(', ') || 'nenhuma equipe'}`);
  // o preco e o da tabela do autor (29/10: PKM 70, PKP 90; antes os dois a 80, fixo no teste)
  const tabela = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'research', 'precos_unidades.json'), 'utf8')).precos || {};
  for (const u of equipes) if (u.role !== 'mg' || u.bucket !== 'teams' || u.lot || u.price !== tabela[`RU|${u.name}`]) maus.push(`${u.name}: ${u.role}/${u.bucket}/${u.lot ? 'lote' : 'solta'}/${u.price} (tabela ${tabela[`RU|${u.name}`]})`);
  const casos = [['LMG Team (PKP)', false, 'hmg'], ['Machinegun Team (PKM)', true, 'hmg'], ['Machinegun Team (PKM)', false, 'avancado'], ['Squad (Machinegun)', false, 'avancado']];
  for (const [n, av, p] of casos) { const r = papelFino(n, Cat.roleOf(n, false, R), av); if (r !== p) maus.push(`${n}${av ? ' avulsa' : ''}: ${r} (esperado ${p})`); }
  const { abrirCompleto } = await import('../tools/re/anexar2.mjs');
  const { posicaoDoElemento } = await import('../tools/re/core.mjs');
  const { grupos } = await import('../tools/re/agrupar.mjs');
  const { buildBattle } = await import('./src/forge.mjs');
  const BL = await import('../tools/re/bateria/lib.mjs'); const DT = await import('../tools/re/ia_doutrina.mjs');
  const mapa = path.join(import.meta.dirname, '..', 'assets', 'qb_attack', 'Village-Hills (688 X 736) 300 Attack CMBSRL.btt'); const F = DT.feicoes(mapa);
  let defesa = null; for (let s = 3001; s < 3041 && !defesa; s++) { const d = planDefense({ nation: 'RU', nations: ['RU'], battleNumber: 3, rules: R, seed: s, profile: 'aberto', effort: 1 }); if (d.trail.filter((t) => t.single).length >= 2) defesa = d; }
  const vistas = [];
  if (!defesa) maus.push('nenhuma semente com duas avulsas');
  else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't203-')); const out = path.join(dir, 'b.btt');
    try {
      const log = console.log; console.log = () => {};
      try { await buildBattle({ coreFile: path.join(import.meta.dirname, '..', 'assets', 'lib', 'US - Section (COLT).btt'), defense: defesa, mapFile: mapa, duration: 45, nation: 'US', enemy: 'RU', out, rules: R, trace: { event() {}, read() {}, wrote() {}, step: async (_n, _d, fn) => fn() } }); } finally { console.log = log; }
      const chk = BL.conferirBtt(out); if (chk.erros.length) maus.push(`conferirBtt: ${chk.erros.join('; ')}`);
      const X = abrirCompleto(out); const cc = X.completo; const gr = new Map(grupos(out).map((g) => [g.id, g.grupo]));
      X.R.forEach((r, k) => {
        if (r.form || r.ausente || !/LMG Team \(PKP\)|Machinegun Team \(PKM\)/.test(r.nm) || !(cc[r.c + 11] & 0x02)) return;
        const o = posicaoDoElemento(cc, r, X.R[k + 1] ? X.R[k + 1].c : cc.length);
        const x = o === null ? -1 : Math.round((cc.readFloatLE(o + 5) - 4) / 8), y = o === null ? -1 : Math.round((cc.readFloatLE(o + 9) - 4) / 8);
        vistas.push(`${r.nm.replace(/ Team/, '')} G${gr.get(r.id)} (${x},${y})`);
        if (gr.get(r.id) !== 4) maus.push(`${r.nm} no G${gr.get(r.id)}`);
        if (o === null || !F.abrigo[F.idx(x, y)]) maus.push(`${r.nm} fora de abrigo (${x},${y})`);
      });
      const pedidas = defesa.trail.filter((t) => t.single).length;
      if (vistas.length !== pedidas) maus.push(`${vistas.length} avulsas com o bit no arquivo, ${pedidas} compradas`);
    } catch (err) { maus.push(err.message.slice(0, 160)); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  ok(!maus.length, `(203) metralhadoras avulsas: so da defesa, papel mg pelo preco da tabela (${equipes.map((u) => `${u.name.replace(/ Team.*/, '')} ${u.price}`).join(', ')}), G4 pelo bit; batalha RU b3 no VH300 com ${vistas.join(', ')}${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 204. OS TANQUES DO 282 NA FRENTE E 1 MINUTO ANTES (autor, 29/10): o pacote (o arquivo do editor dele, editado no lugar
//      por ia_282_tanques) tem os tanques no G11, Setup nas duas colunas da frente (x 162-163) e janela 0-0, com a ordem
//      do G1; G1 (recon e leves) e G2-G8 (mecanizada, equipes) atras (x >= 164) e em 60-60; a edicao do autor de 17/10
//      segue la; o registro manda os T-72 ao G11 e o recon ao G1.
{
  const IE = await import('../tools/re/ia_escrever.mjs'); const ME = await import('./src/meet.mjs');
  const chave = 'qb_meet/Hills-Farmland (1344 X 848) 282 Meet CMBSRL.btt';
  const d = IE.decodificar(path.join(import.meta.dirname, '..', 'assets', chave));
  const reg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'data', 'planos_ia.json'), 'utf8')).mapas[chave];
  const P = d.azul[0].slots, xs = (e) => IE.doMapa(d, e.tiles).map((t) => t[0]), G = reg.grupos; const maus = [];
  const tq = P[G.tanks - 1], ar = P[G.armour - 1];
  if (G.tanks !== 11 || tq[0].tiles.length < 200 || xs(tq[0]).some((x) => x < 162 || x > 163) || tq[0].a !== 0 || tq[0].b !== 0) maus.push('setup dos tanques');
  if (tq.length !== ar.length || JSON.stringify(tq[1].tiles) !== JSON.stringify(ar[1].tiles) || tq[1].tiles.length !== 1090) maus.push('a ordem dos tanques nao e a do G1');
  for (let g = 1; g <= 8; g++) if (P[g - 1][0].a !== 60 || P[g - 1][0].b !== 60 || xs(P[g - 1][0]).some((x) => x < 164)) maus.push(`G${g} setup`);
  const sv = P[G.sVeh - 1]; if (d.T !== 19 || sv.slice(1, 10).some((e) => e.a || e.b) || sv[10].a !== 1500) maus.push('a edicao do autor de 17/10 sumiu');
  const us = [['Main Battle Tank (T-72B3)', 1000], ['Main Battle Tank (T-72B3)', 1000], ['Reconnaissance Vehicle (BRM-1K)', 300]].map(([nome], k) => ({ id: k + 1, nome, pai: 'U' + k }));
  const g = ME.meetGroups(us, { rules: rules(), doutrina: 'roteiro', grupos: { ...G }, alocacao: reg.alocacao, preco: (n) => (/Tank/.test(n) ? 1000 : 300) }).grupo;
  if (g.get(1) !== 11 || g.get(2) !== 11 || g.get(3) !== 1) maus.push(`alocacao ${[...g.entries()].join(' ')}`);
  ok(!maus.length, `(204) tanques do 282 no G11, x 162-163, 0:00; G1-G8 atras em 1:00; edicao de 17/10 intacta${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 205. A BATERIA DA ECONOMIA (autor, 29/10/2026: "existe alguma forma de trapacear e ganhar creditos comprando e vendendo
//      formacoes ou unidades?"; regra dele: a venda devolve O QUE FOI PAGO). (a) E5: nas formacoes da biblioteca, compradas
//      inteiras, o preco cobrado repartido entre as unidades (`distribuirPago`) soma exatamente o cobrado, e a venda inteira
//      devolve exatamente isso (antes o arredondamento por unidade rendia ate +8 cr por ciclo); (b) E2: a Special Forces
//      inteira devolve o preco fixo da campanha (600 ou 0), nao a soma por unidade (531 a 639 cr); parcial devolve 0;
//      (c) E1: a recruta (`precificarForca` a partir do pick novo) nao reprecifica quem ja existia, mesmo promovido a Crack,
//      e a unidade promovida vende pelo pago; (d) E4/E5: `checkArmies` recusa nacao trocada e exercito fora da campanha;
//      (e) o livro-razao: `invariantesDoEstado` acusa creditos que nao fecham com ledgerBase + entradas - saidas.
{
  const C = await import('./src/campaign.mjs'); const CAT = await import('./src/catalog.mjs');
  const { invariantesDoEstado } = await import('./src/estado.mjs');
  const R = rules(); const maus = [];
  // (a) o ciclo compra -> venda, formacao a formacao
  const libs = fs.readdirSync(path.join(import.meta.dirname, '..', 'assets', 'lib')).filter((f) => /^(US|UKR|RU) - .*\.btt$/.test(f) && !/\[/.test(f));
  const todas = (n, o = []) => { o.push(n.key); n.children.forEach((c) => todas(c, o)); return o; };
  let vistas = 0, desvio = 0;
  for (const f of libs) {
    const nation = f.split(' - ')[0];
    let t, p; try { t = CAT.formationTree(f); [p] = C.priceOfPicks([{ source: f, nation, keep: t.roots.flatMap((r) => todas(r)) }], nation, R); } catch { continue; }
    const plan = CAT.prunePlan(t, p.keep);
    const units = plan.keptUnits.map((u, k) => ({ coreId: k + 1, key: `0.${k}`, name: u.name, present: true, price: CAT.priceUnit(u, nation, R) }));
    C.distribuirPago(units, p.price).forEach((v, k) => { units[k].paid = v; });
    const soma = units.reduce((a, u) => a + u.paid, 0);
    const venda = C.sellPlan({ units, picks: [p] }, units.map((u) => u.coreId), new Set());
    if (soma !== p.price || venda.refund !== p.price || units.some((u) => !(u.paid >= 0))) { desvio++; if (desvio <= 3) maus.push(`${f}: cobrado ${p.price}, repartido ${soma}, venda ${venda.refund}`); }
    vistas++;
  }
  if (vistas < 60) maus.push(`so ${vistas} formacoes cotadas`);
  // (b) a Special Forces
  const sf = (preco) => {
    const units = [530, 1, 0].map((v, k) => ({ coreId: k + 1, key: `0.4.${k}`, name: `SF ${k}`, present: true, price: [200, 180, 151][k] }));
    C.distribuirPago(units, preco).forEach((v, k) => { units[k].paid = v; });
    return { inteira: C.sellPlan({ units }, [1, 2, 3], new Set()).refund, parcial: C.sellPlan({ units }, [1, 2], new Set()).refund };
  };
  const s600 = sf(600), s0 = sf(0);
  if (s600.inteira !== 600 || s600.parcial !== 0 || s0.inteira !== 0) maus.push(`SF: 600 -> ${s600.inteira}/${s600.parcial}, gratis -> ${s0.inteira}`);
  // (c) a recruta nao reprecifica quem ja existia
  const st = { nation: 'US', picks: [{ source: 'US - Section (Supply).btt', price: 100 }], units: [
    { coreId: 1, key: '0.0', name: 'Headquarters Team', present: true, experience: 'Regular', price: 40, paid: 40 },
    { coreId: 2, key: '0.1', name: 'Truck (LMTV)', present: true, experience: 'Regular', price: 60, paid: 60 } ] };
  st.picks.push({ source: 'US - Section (Supply).btt', price: 90 });
  const lida = [
    { coreId: 1, key: '0.0', name: 'Headquarters Team', present: true, experience: 'Crack', nation: 'US' },
    { coreId: 2, key: '0.1', name: 'Truck (LMTV)', present: true, experience: 'Crack', nation: 'US' },
    { coreId: 3, key: '1.0', name: 'Headquarters Team', present: true, experience: 'Regular', nation: 'US' },
    { coreId: 4, key: '1.1', name: 'Truck (LMTV)', present: true, experience: 'Regular', nation: 'US' },
    { coreId: 5, key: '1.2', name: 'Truck (LMTV)', present: false, experience: 'Regular', nation: 'US' } ];
  const depois = C.precificarForca(st, lida, R, { desde: 1 });
  const por = Object.fromEntries(depois.map((u) => [u.coreId, u]));
  if (por[1].price !== 40 || por[1].paid !== 40 || por[2].price !== 60 || por[2].paid !== 60) maus.push(`a recruta reprecificou quem ja existia: ${JSON.stringify(depois.slice(0, 2).map((u) => [u.price, u.paid]))}`);
  if (por[3].paid + por[4].paid !== 90 || por[5].paid !== 0) maus.push(`o pick novo nao repartiu os 90 cr: ${por[3].paid}+${por[4].paid}, dormente ${por[5].paid}`);
  const promovida = C.sellPlan({ units: depois.slice(0, 2) }, [1, 2], new Set()).refund;
  if (promovida !== 100) maus.push(`a formacao promovida a Crack vende por ${promovida}; custou 100`);
  // (d) os exercitos da campanha
  const recusa = (picks, armies) => { try { C.checkArmies(picks, armies); return null; } catch (e) { return e.message; } };
  if (!/not UKR/.test(recusa([{ source: 'US - Section (Supply).btt', nation: 'UKR' }], ['UKR']) || '')) maus.push('nacao trocada aceita');
  if (!/not one of this campaign/.test(recusa([{ source: 'RU - Section (Supply).btt', nation: 'RU' }], ['US', 'UKR']) || '')) maus.push('exercito fora da campanha aceito');
  if (recusa([{ source: 'UKR - Platoon (RPO).btt', nation: 'UKR' }, { source: 'US - Section (Supply).btt' }], ['US', 'UKR'])) maus.push('a forca valida foi recusada');
  // (e) o livro-razao
  const base = { stage: 'brief', next: { n: 2 }, battleNumber: 2, history: [{ n: 1 }], credits: 1500, ledgerBase: 2500, ledger: [{ kind: 'raise', spend: 2000 }, { kind: 'apply', step: 500, cover: 300, bonus: 200, refund: 0, spend: 0 }] };
  const fecha = invariantesDoEstado(base).filter((e) => /ledger/.test(e));
  const naoFecha = invariantesDoEstado({ ...base, credits: 1700 }).filter((e) => /ledger/.test(e));
  if (fecha.length || naoFecha.length !== 1) maus.push(`livro-razao: ${fecha.join('; ')} | ${naoFecha.join('; ')}`);
  ok(!maus.length, `(205) a economia: ${vistas} formacoes compradas e vendidas inteiras sem um credito de sobra; SF devolve 600/0; recruta nao reprecifica a promovida; exercitos conferidos; livro-razao fecha${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 206. A FORMACAO VENDIDA INTEIRA COM UM DESTROCO LIBERA A VAGA (29/10, bateria de interrupcoes). O destroco fica
//      `present` esperando reposicao e nao se vende; `markSoldPicks` o contava como "ainda dele" e o pick nunca ganhava
//      `sold` — a Special Forces vendida com uma maquina destruida travava a vaga dela para sempre. Agora o destroco nao
//      conta; a venda continua pagando so as vivas.
{
  const C = await import('./src/campaign.mjs');
  const st = {
    picks: [{ source: 'US - Platoon (LRS).btt', sf: true, price: 600 }],
    units: [
      { coreId: 1, key: '0.0', name: 'Team A', present: true, price: 200, paid: 300 },
      { coreId: 2, key: '0.1', name: 'Team B', present: true, price: 200, paid: 200 },
      { coreId: 3, key: '0.2', name: 'Vehicle', present: true, price: 150, paid: 100 },
    ],
    lost: [3], sold: [],
  };
  const venda = C.sellPlan(st, [1, 2], new Set());
  st.sold = venda.units.map((x) => ({ battle: 2, ...x }));
  for (const u of st.units) if (u.coreId !== 3) u.present = false;
  C.markSoldPicks(st, [1, 2], 2);
  let livre = null; try { C.checkSpecialForces([...st.picks, { sf: true }]); } catch (e) { livre = e.message; }
  ok(venda.refund === 500 && st.picks[0].sold === 2 && !livre, `(206) SF vendida com o destroco: devolve ${venda.refund} (as vivas), pick sold=${st.picks[0].sold}, vaga ${livre ? 'TRAVADA: ' + livre : 'livre'}`);
}

// 207. O BMP QUE PODE ENTRAR NUM ARQUIVO DO JOGO (29/10, autor: "imagens cosmeticas corrompidas ou ausentes nao podem
//      comprometer o app nem o jogo"). `bmpIntegro` aceita o logo do app e recusa o vazio, o truncado (antes ACEITO no
//      briefing: 2000 de 150582 bytes entravam no .btt), o com bytes a mais, o de cima para baixo, o de 32 bits, o
//      comprimido, o de cabecalho maior, o que nao e BMP e o do tamanho errado; `escreverImagens` recusa o truncado.
{
  const { bmpIntegro } = await import('../tools/re/bmp_integro.mjs'); const BR = await import('../tools/re/briefing.mjs');
  const bom = fs.readFileSync(path.join(import.meta.dirname, 'art', 'briefing', 'logo224.bmp')); const maus = [];
  const mexe = (f) => { const b = Buffer.from(bom); f(b); return b; };
  const casos = {
    vazio: Buffer.alloc(0), truncado: bom.subarray(0, 2000), sobra: Buffer.concat([bom, Buffer.alloc(10)]), naoBmp: Buffer.from('nao e bmp nem de longe, mas tem mais de 54 bytes para passar do primeiro corte ...'),
    deCimaParaBaixo: mexe((b) => b.writeInt32LE(-224, 22)), bits32: mexe((b) => b.writeUInt16LE(32, 28)), comprimido: mexe((b) => b.writeUInt32LE(1, 30)), cabecalho124: mexe((b) => { b.writeUInt32LE(138, 10); b.writeUInt32LE(124, 14); }),
  };
  if (bmpIntegro(bom, [224, 224]) !== null) maus.push(`o logo bom recusado: ${bmpIntegro(bom, [224, 224])}`);
  if (!/702x224/.test(bmpIntegro(bom, [702, 224]) || '')) maus.push('o tamanho errado passou');
  for (const [k, b] of Object.entries(casos)) if (!bmpIntegro(b, [224, 224])) maus.push(`${k} passou`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't207-')); const f = path.join(tmp, 'm.btt');
  fs.copyFileSync(path.join(import.meta.dirname, '..', 'assets', 'qb_attack', 'Village-Forest (720 X 496) 057r Attack CMBSRL.btt'), f);
  let recusa = null; try { BR.escreverImagens(f, { 0: casos.truncado }); } catch (e) { recusa = e.message; }
  if (!/truncated/.test(recusa || '')) maus.push(`o briefing aceitou o truncado (${recusa})`);
  try { BR.escreverImagens(f, { 0: bom }); if (!BR.lerImagens(f)[0]?.equals(bom)) maus.push('o logo bom nao le de volta'); } catch (e) { maus.push(`o logo bom recusado no briefing: ${e.message}`); }
  fs.rmSync(tmp, { recursive: true, force: true });
  ok(!maus.length, `(207) bmpIntegro: o logo passa; vazio, truncado, sobra, nao-BMP, de cima para baixo, 32 bits, comprimido, cabecalho de 124 e tamanho errado nao; o briefing recusa o truncado${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 208. A IMAGEM RUIM NAO DERRUBA A BATALHA (29/10): `buildBattle` com o logo 170 vazio e as imagens do briefing truncada e
//      de tamanho errado sai inteira — o cabecalho e as imagens pulados com evento, o arquivo conferido (`conferirBtt`), e
//      no bloco de imagens so BMP integro. Antes o logo ruim lancava e "Prepare battle" falhava.
{
  const { bmpIntegro } = await import('../tools/re/bmp_integro.mjs'); const BR = await import('../tools/re/briefing.mjs');
  const { buildBattle } = await import('./src/forge.mjs'); const BL = await import('../tools/re/bateria/lib.mjs');
  const R = rules(); const maus = []; const eventos = [];
  const bom = fs.readFileSync(path.join(import.meta.dirname, 'art', 'briefing', 'logo224.bmp'));
  const mapa = path.join(import.meta.dirname, '..', 'assets', 'qb_attack', 'Village-Forest (720 X 496) 057r Attack CMBSRL.btt');
  const defesa = planDefense({ nation: 'RU', nations: ['RU'], battleNumber: 1, rules: R, seed: 7, profile: 'aberto', effort: 1 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't208-')); const out = path.join(dir, 'b.btt');
  try {
    const log = console.log; console.log = () => {};
    try {
      await buildBattle({ coreFile: path.join(import.meta.dirname, '..', 'assets', 'lib', 'US - Section (COLT).btt'), defense: defesa, mapFile: mapa, duration: 45, nation: 'US', enemy: 'RU', out, rules: R, title: 'ZZ T208',
        header: { descricao: 'a\nb\nc', bmp: Buffer.alloc(0) }, images: { estrategico: bom.subarray(0, 2000), operacional: null, tatico: bom },
        trace: { event: (k, v) => eventos.push([k, v]), read() {}, wrote() {}, step: async (_n, _d, fn) => fn() } });
    } finally { console.log = log; }
    const chk = BL.conferirBtt(out); if (chk.erros.length) maus.push(`conferirBtt: ${chk.erros.slice(0, 2).join('; ')}`);
    if (!eventos.some(([k]) => k === 'battle.headerSkipped')) maus.push('o cabecalho ruim nao virou evento');
    if (!eventos.some(([k]) => k === 'battle.imageSkipped')) maus.push('as imagens ruins nao viraram evento');
    const ruins = BR.lerImagens(out).map((b, k) => (b && bmpIntegro(b) ? `${k}: ${bmpIntegro(b)}` : null)).filter(Boolean);
    if (ruins.length) maus.push(`imagem nao integra no arquivo: ${ruins.join('; ')}`);
  } catch (e) { maus.push(`a batalha caiu: ${e.message.slice(0, 160)}`); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  ok(!maus.length, `(208) logo vazio, briefing truncado e de tamanho errado: a batalha sai, pulados com evento, so BMP integro no arquivo${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 209. A PRIVACIDADE (29/10, pedido do autor: nada de nome, endereco ou credencial dele no conteudo do app). As frases-amostra
//      sao montadas com o nome e o usuario LIDOS DA MAQUINA (tools/privacidade.mjs identidade), sem escreve-los aqui:
//      (a) a reescrita troca o nome (ingles, portugues, maiusculas grudadas, minusculas de nome de arquivo) e os caminhos
//      (file:/// e caminho comum num .mjs viram relativos ao arquivo; em texto, marcadores) e e idempotente; (b) a varredura
//      acha o nome e o caminho injetados e nao acha palavras parecidas; (c) o repositorio inteiro esta limpo.
// (num pacote nao ha repositorio git nem a ferramenta: o teste e do projeto, e la nao roda)
if (!fs.existsSync(path.join(import.meta.dirname, '..', '.git')) || !fs.existsSync(path.join(import.meta.dirname, '..', 'tools', 'privacidade.mjs'))) {
  ok(true, '(209) privacidade: fora do repositorio (pacote), nada a varrer aqui');
} else {
  const P = await import('../tools/privacidade.mjs'); const maus = [];
  const id = P.identidade(); const N = id.primeiros[0]; const U = id.usuario; const raiz = P.RAIZ.replace(/\\/g, '/');
  if (!N || !U) maus.push(`identidade incompleta: ${JSON.stringify({ N, U })}`);
  else {
    const amostras = [
      [`// (${N}, 25/10): o pedido`, '// (autor, 25/10): o pedido'],
      [`${N}'s campaign`, "the author's campaign"],
      [`as ${N} asked, and ${N} played it`, 'as the author asked, and the author played it'],
      [`o plano do ${N} e o que o ${N} desenhou`, 'o plano do autor e o que o autor desenhou'],
      [`O PLANO DO ${N.toUpperCase()} no mapa ${N.toUpperCase()}EDIT`, 'O PLANO DO AUTOR no mapa AUTOREDIT'],
      [`salvo como "ZZ MEET ${N.toLowerCase()}.btt"`, 'salvo como "ZZ MEET autor.btt"'],
      [`see C:/Users/${U}/OneDrive/Imagens/x.png`, 'see <capturas>/x.png'],
      [`pasta ${raiz}/research`, 'pasta <projeto>/research'],
    ];
    for (const [a, b] of amostras) { const r = P.reescrever(a, 'spec/x.md', id); if (r !== b) maus.push(`"${a}" -> "${r}" (esperado "${b}")`); if (P.reescrever(r, 'spec/x.md', id) !== r) maus.push(`nao idempotente: ${r}`); }
    const codigo = `const C = await import('file:///${raiz}/app/src/campaign.mjs'); const f = '${raiz}/assets/lib';`;
    const r = P.reescrever(codigo, 'tools/re/scratch/x.mjs', id);
    if (r !== "const C = await import(new URL('app/src/campaign.mjs', new URL('../../../', import.meta.url)).href); const f = `${import.meta.dirname}/../../../assets/lib`;") maus.push(`codigo: ${r}`);
    const achou = P.varrerTexto(`${N} e C:/Users/${U}/x`).map((a) => a.tipo).join();
    if (!/nome/.test(achou) || !/caminho/.test(achou)) maus.push(`a varredura nao achou o injetado: ${achou}`);
    const parecidas = P.varrerTexto('Spandrel, Andrea, Sandres, Cassandre').length;
    if (parecidas) maus.push(`a varredura acusou palavras parecidas (${parecidas})`);
  }
  // (c) o repositorio limpo continua limpo
  const achados = P.varrerPasta(P.RAIZ, P.arquivosVersionados());
  if (achados.length) maus.push(`${achados.length} achados no repositorio, o primeiro em ${achados[0].arquivo}:${achados[0].linha} (${achados[0].tipo})`);
  ok(!maus.length, `(209) privacidade: reescrita do nome e dos caminhos certa e idempotente, varredura sem falso positivo, repositorio limpo${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 210. A CHECAGEM DO SISTEMA (autor, 29/10: "verificar se todas as pastas do jogo existem no computador do jogador").
// Uma pasta de jogo falsa num tmp: completa = tudo ok; sem Saved Games = o app cria e avisa; Data com v216 = aviso de
// versao (segue), sem Data = aviso; sem Scenarios = falha. A versao testada esta nas regras, e o minimo do Node e o
// mesmo no lancador e no codigo.
{
  const S = await import('./src/sistema.mjs'); const { NODE_MINIMO } = await import('./src/pacote.mjs');
  const regras = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'data', 'rules.json'), 'utf8'));
  const maus = [];
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-210-'));
  const jogo = path.join(raiz, 'Combat Mission Black Sea'); const gf = path.join(jogo, 'Game Files');
  const montar = ({ saved = true, data = ['v100a', 'v217'], scenarios = true } = {}) => {
    fs.rmSync(jogo, { recursive: true, force: true });
    for (const d of ['Campaigns', 'Quick Battle Maps', ...(scenarios ? ['Scenarios'] : []), ...(saved ? ['Saved Games'] : [])]) fs.mkdirSync(path.join(gf, d), { recursive: true });
    if (data) { fs.mkdirSync(path.join(jogo, 'Data'), { recursive: true }); for (const v of data) fs.writeFileSync(path.join(jogo, 'Data', `black sea ${v}.brz`), ''); }
  };
  const estados = (r) => Object.fromEntries(r.itens.map((i) => [i.id, i.estado]));
  try {
    if (regras.game?.testedVersion !== 217) maus.push(`rules.game.testedVersion = ${regras.game?.testedVersion}`);
    montar();
    let r = S.checarSistema({ gameFiles: gf, regras }); let e = estados(r);
    if (!r.ok || r.avisos || Object.values(e).some((x) => x !== 'ok')) maus.push(`completa: ${JSON.stringify(e)} ${r.itens.filter((i) => i.estado !== 'ok').map((i) => i.detalhe).join('; ')}`);
    if (S.versaoDoJogo(jogo) !== 217) maus.push(`versaoDoJogo ${S.versaoDoJogo(jogo)}`);
    montar({ saved: false });
    r = S.checarSistema({ gameFiles: gf, regras }); e = estados(r);
    if (!r.ok || e.folders !== 'aviso' || !fs.existsSync(path.join(gf, 'Saved Games'))) maus.push(`sem Saved Games: ${JSON.stringify(e)}, criada ${fs.existsSync(path.join(gf, 'Saved Games'))}`);
    montar({ data: ['v210', 'v216'] });
    r = S.checarSistema({ gameFiles: gf, regras }); e = estados(r);
    if (!r.ok || e.version !== 'aviso' || !/2\.16/.test(r.itens.find((i) => i.id === 'version').detalhe)) maus.push(`v216: ${JSON.stringify(e)}`);
    montar({ data: null });
    r = S.checarSistema({ gameFiles: gf, regras }); e = estados(r);
    if (!r.ok || e.version !== 'aviso') maus.push(`sem Data: ${JSON.stringify(e)}`);
    montar({ scenarios: false });
    r = S.checarSistema({ gameFiles: gf, regras }); e = estados(r);
    if (r.ok || e.game !== 'falha' || r.falhas !== 1) maus.push(`sem Scenarios: ok=${r.ok} ${JSON.stringify(e)}`);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
  const cmd = fs.readFileSync(path.join(import.meta.dirname, 'Start Campaign.cmd'), 'utf8');
  if (!cmd.includes(`a>${NODE_MINIMO[0]}||(a===${NODE_MINIMO[0]}&&b>=${NODE_MINIMO[1]})`)) maus.push('o Start Campaign.cmd nao confere o mesmo Node minimo de pacote.mjs');
  ok(!maus.length, `(210) checagem do sistema: pasta completa ok, Saved Games criada com aviso, patch velho e Data ausente avisam, sem Scenarios falha; Node minimo igual no lancador${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 211. O POSTO AVANCADO DO 051r NAO RECUA (autor, 29/10: "quando eu atravesso certo ponto, as unidades de defesa no lado
//      do rio do jogador comecam a recuar e isso expoe elas"). No pacote, o G2 do plano azul 1 so tem o Setup na margem
//      norte, sem a espera do "ZZ Trig North Bank" e sem a ordem; os grupos com trigger da margem sul seguem esperando;
//      o registro tem o sha do arquivo.
{
  const IE = await import('../tools/re/ia_escrever.mjs'); const crypto = await import('node:crypto');
  const chave = 'qb_attack/Small City-Water (416 X 848) 051r Attack CMBSRL.btt';
  const arq = path.join(import.meta.dirname, '..', 'assets', chave);
  const d = IE.decodificar(arq); const P = d.azul[0].slots; const maus = [];
  const g2 = P[1];
  if (g2.length !== 1 || g2[0].esperas.length || !g2[0].tiles.length || IE.doMapa(d, g2[0].tiles).some(([, y]) => y < 61)) maus.push(`G2: ${g2.length} entradas, ${g2[0].esperas.length} esperas`);
  for (const g of [6, 7, 8, 9, 10]) if (P[g - 1].length !== 2 || P[g - 1][0].esperas.length !== 1) maus.push(`G${g} perdeu a espera`);
  const reg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'data', 'planos_ia.json'), 'utf8')).mapas[chave];
  if (reg?.sha256 !== crypto.createHash('sha256').update(fs.readFileSync(arq)).digest('hex')) maus.push('o sha do registro nao bate');
  ok(!maus.length, `(211) 051r: o G2 segura a margem norte sem recuar; G6-G10 com trigger intactos; registro em dia${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 212. O VEICULO ANEXADO A UMA FORMACAO QUE JA E DELE ENTRA DENTRO DELA (autor, 30/10: "comprei o caminhao dentro do
//      pelotao de grenade launcher, mas ele aparece dentro do pelotao de engenharia"). Uma forca de um pelotao RU num
//      tmp; `growCoreForce` com `attachOwned` (sem formacao nova) poe o Ural como ultimo filho do pelotao, com id max+1;
//      nenhum core id antigo mexe, os registros antigos saem byte a byte iguais, a forca passa no checkForce; um enxerto
//      depois dele (id fora de ordem na arvore) tambem passa na guarda. `attachOwnedOf` cota e recusa (SF, pick que nao
//      existe, maquina fora da lista do autor).
{
  const C = await import('./src/campaign.mjs');
  const A2 = await import(new URL('../tools/re/anexar2.mjs', import.meta.url).href);
  const { contentEnd } = await import('./src/re.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-212-'));
  const mapa = mapFile(mapPool(1, [], 0)[0]);
  const trace = { event() {}, read() {}, wrote() {}, async step(n, x, f) { return f(); } };
  const maus = [];
  try {
    const fonte = 'RU - Tactical Group (Battalion [BMP]).btt';
    const arv = formationTree(fonte);
    let pel = null;
    const acha = (n) => { if (!pel && n.isFormation && /^Platoon \(Grenade Launcher\)/.test(n.name)) pel = n; n.children.forEach(acha); };
    arv.roots.forEach(acha);
    const sob = (no) => { const out = []; const w = (n) => { out.push(n.key); n.children.forEach(w); }; w(no); return out; };
    const p0 = priceOfPicks([{ source: fonte, nation: 'RU', keep: sob(pel), xp: {} }], 'RU', R)[0];
    const core0 = path.join(tmp, 'core.btt');
    await buildCoreForce({ picks: [p0], nation: 'RU', enemy: 'US', mapFile: mapa, workDir: path.join(tmp, 'b'), out: core0, trace });
    const antes = unitDirectory(core0); const maior = Math.max(...antes.map((u) => u.coreId));
    const estado = { nation: 'RU', picks: [{ ...p0, source: fonte, nation: 'RU' }] };
    const [anexo] = C.attachOwnedOf(estado, [{ pick: 0, key: pel.key, tipo: 'Truck (Ural-4320)', type: null }], R);
    if (!anexo || anexo.caminho.join('/') !== C.attachOwnedOf(estado, [{ pick: 0, key: pel.key, tipo: 'Truck (Ural-4320)' }], R)[0].caminho.join('/') || !(anexo.price > 0)) maus.push(`cotacao ${JSON.stringify(anexo)}`);
    const saida = path.join(tmp, 'grown.btt');
    const g = await growCoreForce({ picks: [p0], newPicks: [], nation: 'RU', enemy: 'US', mapFile: mapa, workDir: path.join(tmp, 'w'), out: saida, before: antes, present: antes.filter((u) => u.present).map((u) => u.coreId), coreFile: core0, attachOwned: [anexo], trace });
    const novo = g.added[0];
    if (g.added.length !== 1 || !/Ural/.test(novo.name) || novo.coreId !== maior + 1 || !novo.present || !novo.formation.endsWith('Platoon (Grenade Launcher)') || !novo.key.startsWith(pel.key + '.')) maus.push(`o inserido: ${JSON.stringify(g.added)}`);
    if (!checkForce(saida).ok) maus.push('checkForce');
    const X = A2.abrirCompleto(core0), Y = A2.abrirCompleto(saida);
    const corpo = (Z, r, i) => { const fim = Z.R[i + 1] ? Z.R[i + 1].c : Z.completo.length; return Z.completo.subarray(r.c, contentEnd(Z.completo, r, fim).fim); };
    const porId = new Map(Y.R.map((r, i) => [r.id, [r, i]]));
    let dif = 0; X.R.forEach((r, i) => { const y = porId.get(r.id); if (!y || !corpo(X, r, i).equals(corpo(Y, y[0], y[1]))) dif++; });
    if (dif) maus.push(`${dif} registros antigos diferentes`);
    // um enxerto por cima: o id do anexo fica no meio da arvore, e a guarda continua quieta
    const sec = priceOfPicks([{ source: 'RU - Section (Supply).btt', nation: 'RU', keep: sob(formationTree('RU - Section (Supply).btt').roots[0]), xp: {} }], 'RU', R)[0];
    const g2 = await growCoreForce({ picks: [p0], newPicks: [sec], nation: 'RU', enemy: 'US', mapFile: mapa, workDir: path.join(tmp, 'w2'), out: path.join(tmp, 'grown2.btt'), before: g.units, present: g.units.filter((u) => u.present).map((u) => u.coreId), coreFile: saida, trace });
    if (!g2.added.length || g2.units.find((u) => u.coreId === novo.coreId)?.formation !== novo.formation) maus.push('o enxerto depois do anexo');
    // as recusas
    const recusa = (corpoA, re) => { try { C.attachOwnedOf(estado, corpoA, R); maus.push(`aceitou ${JSON.stringify(corpoA)}`); } catch (e) { if (!re.test(e.message)) maus.push(`recusa errada: ${e.message}`); } };
    recusa([{ pick: 5, key: pel.key, tipo: 'Truck (Ural-4320)' }], /no formation 5/);
    recusa([{ pick: 0, key: pel.key, tipo: 'Headquarters Team' }], /not sold as a single/);
    const sf = { ...estado, picks: [{ ...estado.picks[0], sf: true, sfName: 'Recon Platoon' }] };
    try { C.attachOwnedOf(sf, [{ pick: 0, key: pel.key, tipo: 'Truck (Ural-4320)' }], R); maus.push('SF aceitou'); } catch (e) { if (!/special forces/.test(e.message)) maus.push(e.message); }
  } catch (e) { maus.push('excecao: ' + e.message); }
  finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  ok(!maus.length, `(212) anexo numa formacao que ja e dele: o Ural entra como ultimo filho do pelotao, id max+1, nada antigo muda, enxerto depois passa; cotacao e recusas${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 213. A BATALHA SAI SEM DESIGNER NOTES (autor, 01/11: o botao "Designer's Notes" da batalha 6 mostrou a historia de um
//      cenario de 1944, herdada do 040r; "pode limpar de todos os mapas do app"). O mapa do pacote fica intacto (o hash
//      dele e registrado, testes 102/119); `buildBattle` zera as notas, com briefing (na mesma passada) e sem. Todos os
//      mapas do app tem as notas legiveis, e o 040r continua sendo o que traz texto.
{
  const BR = await import('../tools/re/briefing.mjs');
  const { buildBattle } = await import('./src/forge.mjs');
  const R = rules(); const maus = []; const comTexto = []; let lidos = 0;
  for (const pasta of ['qb_attack', 'qb_meet', 'qb_meet_fora']) {
    const dir = path.join(import.meta.dirname, '..', 'assets', pasta);
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.btt'))) {
      lidos++;
      try { if (BR.lerNotas(path.join(dir, f)).length) comTexto.push(f); } catch (e) { maus.push(`${f}: ${e.message}`); }
    }
  }
  const mapa = path.join(import.meta.dirname, '..', 'assets', 'qb_attack', 'Town-Forest (720 X 1024) 040r Attack CMBSRL.btt');
  if (!(BR.lerNotas(mapa).length > 0)) maus.push('o 040r do pacote nao traz mais notas (o teste perdeu o caso)');
  const defesa = planDefense({ nation: 'RU', nations: ['RU'], battleNumber: 1, rules: R, seed: 7, profile: 'aberto', effort: 1 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't213-'));
  const eventos = [];
  const trace = { event: (k, v) => eventos.push([k, v]), read() {}, wrote() {}, step: async (_n, _d, fn) => fn() };
  try {
    for (const [nome, briefing] of [['com briefing', { vermelho: ['Situation da campanha'] }], ['sem briefing', null]]) {
      const out = path.join(dir, `${nome.replace(' ', '_')}.btt`);
      const log = console.log; console.log = () => {};
      try { await buildBattle({ coreFile: path.join(import.meta.dirname, '..', 'assets', 'lib', 'US - Section (COLT).btt'), defense: defesa, mapFile: mapa, duration: 45, nation: 'US', enemy: 'RU', out, rules: R, title: 'ZZ T213', briefing, trace }); }
      finally { console.log = log; }
      if (BR.lerNotas(out) !== '') maus.push(`${nome}: notas ficaram (${BR.lerNotas(out).length} B)`);
      if (briefing && BR.ler(out).vermelho[0] !== 'Situation da campanha') maus.push(`${nome}: o briefing nao foi escrito`);
    }
    if (!eventos.some(([k]) => k === 'battle.designerNotes')) maus.push('sem briefing: a limpeza nao virou evento');
  } catch (e) { maus.push(`a batalha caiu: ${e.message.slice(0, 160)}`); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  ok(!maus.length, `(213) designer notes: ${lidos} mapas legiveis (com texto no pacote: ${comTexto.join(', ') || 'nenhum'}); a batalha sai vazia com e sem briefing${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 214. A COTA DE ANTIAEREA (autor, 02/11: a batalha 8 da RUS saiu sem AA; "0-2 manpad para tier 2 e a cota de 1 SPAAG
//      para tier 3 e 2 para tier 4"). `tiers[].aaQuota`: tier 2 0-2 MANPADS, tier 3 1 SPAAG, tier 4 2 SPAAG, comprados
//      do balde do papel. O americano tem SPAAG pelos ucranianos (Tunguska); sem SPAAG na lista, cada um que falta vira
//      uma equipe MANPADS. O tier 1 nao ganha cota de AA.
{
  const R = rules(); const maus = []; let n0 = 0; let fb = 0;
  const conta = (p, papel) => (p.kept || []).filter((k) => roleOf(k.name, false, R) === papel).reduce((s, k) => s + k.n, 0);
  for (const lado of [{ nation: 'US', nations: ['US', 'UKR'] }, { nation: 'RU', nations: ['RU'] }, { nation: 'US', nations: ['US'] }]) {
    for (let seed = 1; seed <= 6; seed++) for (const n of [1, 4, 7, 10]) {
      const p = planDefense({ ...lado, battleNumber: n, rules: R, seed: seed * 7919 + n, profile: 'misto', effort: 1 });
      const q = p.teamQuota || {}; const aa = conta(p, 'aa'); const mp = conta(p, 'manpads');
      const onde = `${lado.nations.join('+')} b${n} s${seed}`; n0++;
      if (n === 1 && (q.aa || q.manpads)) maus.push(`${onde}: cota de AA no tier 1`);
      if (n === 4 && (!q.manpads || q.manpads.want > 2 || q.manpads.got !== q.manpads.want || mp !== q.manpads.got || q.aa)) maus.push(`${onde}: MANPADS ${JSON.stringify(q.manpads)} (${mp} na forca)`);
      const quer = n === 7 ? 1 : n === 10 ? 2 : 0;
      if (!quer) continue;
      if (lado.nations.length === 1 && lado.nation === 'US') {
        fb += p.aaFallback || 0;
        if (aa || p.aaFallback !== quer || !q.manpads || q.manpads.got < quer) maus.push(`${onde}: sem SPAAG, ${p.aaFallback} trocados, MANPADS ${JSON.stringify(q.manpads)}`);
      } else if (aa !== quer || q.aa?.got !== quer || p.aaFallback) maus.push(`${onde}: ${aa} SPAAG (cota ${quer})`);
    }
  }
  ok(!maus.length, `(214) cota de AA: ${n0} defesas; tier 2 0-2 MANPADS, tier 3 1 SPAAG, tier 4 2 SPAAG (US pelos ucranianos), US sozinho troca ${fb} SPAAG por MANPADS${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 215. A AVIACAO TRAZ O CONTROLADOR AEREO (autor, 02/11: "todo suporte aereo na forca inimiga tem de ir acompanhado de air
//      observers"; so o controlador aereo guia a aviacao). Defesa e encontro: o exercito que levou aviacao leva a Air
//      Controller Section dele, inteira, de graca (preco 0 na trilha, fora de `cost`), fora de `maxSources`; sem aviacao,
//      nenhum controlador — o encontro nao o compra pago. Na batalha, o controlador vai para o grupo dos observadores (G11).
{
  const R = rules(); const maus = []; let comAviao = 0, n0 = 0;
  const ME = await import('./src/meet.mjs');
  const OBS = new RegExp(R.defense.airObservers.names, 'i');
  const aviacaoDe = (p, unidades) => [...new Set(unidades.map((u) => p.sources.find((s) => s === u.source) && u.source.split(' ')[0]))].filter(Boolean);
  const conferir = (p, onde, aereos) => {
    n0++;
    const fontes = (p.airObservers || []).map((o) => o.source);
    const quer = aereos.map((n) => R.defense.airObservers.sources[n]).sort();
    if (JSON.stringify([...new Set(quer)]) !== JSON.stringify(fontes.slice().sort())) maus.push(`${onde}: aviacao de ${aereos} e controlador de ${fontes}`);
    if (p.trail.some((t) => OBS.test(t.unit) && t.price !== 0)) maus.push(`${onde}: controlador pago`);
    if (!aereos.length && p.kept.some((k) => OBS.test(k.name))) maus.push(`${onde}: controlador sem aviacao`);
    for (const o of p.airObservers || []) if (!p.sources.includes(o.source) || o.units.length !== 2) maus.push(`${onde}: secao ${o.source} incompleta`);
    if (aereos.length) comAviao++;
  };
  for (const lado of [{ nation: 'RU', nations: ['RU'] }, { nation: 'US', nations: ['US', 'UKR'] }, { nation: 'UKR', nations: ['UKR'] }]) {
    for (let seed = 1; seed <= 6; seed++) for (const n of [1, 5, 10, 12]) {
      const p = planDefense({ ...lado, battleNumber: n, rules: R, seed: seed * 7919 + n, profile: 'misto', effort: 1 });
      const aereos = aviacaoDe(p, p.trail.filter((t) => t.unit && roleOf(t.unit, true, R) === 'air' && !t.airObserver).map((t) => ({ source: t.source })));
      conferir(p, `${lado.nations.join('+')} b${n} s${seed}`, aereos);
      if (n === 1 && p.airObservers) maus.push('controlador no tier 1');
      if (p.sourcesOnMap > R.defense.maxSources) maus.push(`${lado.nation} b${n}: ${p.sourcesOnMap} fontes`);
      if (Math.abs(Object.values(p.byRole).reduce((a, v) => a + v, 0) - p.fullCost) > 2) maus.push(`${lado.nation} b${n}: byRole fora do valor cheio`);
      const m = ME.planMeetForce({ ...lado, battleNumber: n, rules: R, seed });
      const aereosM = aviacaoDe(m, m.meet.unidades.filter((u) => u.bucket === 'support' && roleOf(u.name, true, R) === 'air'));
      conferir(m, `encontro ${lado.nations.join('+')} b${n} s${seed}`, aereosM);
    }
  }
  // na batalha: o controlador presente e no grupo dos observadores
  const { buildBattle, enemyDirectory } = await import('./src/forge.mjs');
  let d = null; for (let s = 1; s <= 40 && !d; s++) { const x = planDefense({ nation: 'RU', nations: ['RU'], battleNumber: 10, rules: R, seed: s, profile: 'aberto', effort: 1 }); if (x.airObservers) d = x; }
  let g11 = '';
  if (!d) maus.push('nenhuma defesa RU b10 com aviacao em 40 sementes');
  else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't215-')); const out = path.join(dir, 'a.btt');
    const trace = { event() {}, read() {}, wrote() {}, step: async (_n, _d, fn) => fn() };
    const log = console.log; console.log = () => {};
    try {
      const b = await buildBattle({ coreFile: path.join(import.meta.dirname, '..', 'assets', 'lib', 'US - Section (COLT).btt'), defense: d, mapFile: path.join(import.meta.dirname, '..', 'assets', 'qb_attack', 'Town-Forest (720 X 1024) 040r Attack CMBSRL.btt'), duration: 45, nation: 'US', enemy: 'RU', out, rules: R, title: 'ZZ T215', trace });
      console.log = log;
      g11 = (b.aiPlan.groups?.[11]?.units || []).filter((x) => OBS.test(x)).join();
      if (!g11) maus.push(`o controlador nao esta no G11: ${JSON.stringify(b.aiPlan.groups?.[11]?.units)}`);
      if (!enemyDirectory(out).some((u) => OBS.test(u.name) && u.present)) maus.push('o controlador nao esta presente na batalha');
    } catch (e) { console.log = log; maus.push(`a batalha caiu: ${e.message.slice(0, 160)}`); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  ok(!maus.length, `(215) controlador aereo: ${n0} forcas, ${comAviao} com aviacao e a secao da faccao de graca; nenhuma sem aviacao; na batalha no G11 (${g11})${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 216. O CANHAO ANTICARRO UCRANIANO FICA FORA DO ENCONTRO (autor, 06/11: "muito lento para este modo de combate").
//      `meet.excludeByNation.UKR`: o Team (Antitank Gun) nao entra no pool do encontro (nem o lote Platoon (Antitank Gun));
//      a defesa continua podendo compra-lo.
{
  const R = rules(); const maus = []; let n0 = 0;
  const ME = await import('./src/meet.mjs'); const DF = await import('./src/defense.mjs');
  const AT = /Antitank Gun/;
  const pool = ME.meetPoolOf('UKR', 4, R);
  if (pool.flatMap((s) => s.units).some((u) => AT.test(u.name) && u.papel !== 'never')) maus.push('o pool do encontro ainda compra o canhao');
  if (pool.flatMap((s) => s.lots).some((l) => AT.test(l.name))) maus.push('o lote Platoon (Antitank Gun) continua no encontro');
  for (const ns of [['UKR'], ['US', 'UKR']]) for (const b of [2, 5, 8, 11]) for (let seed = 1; seed <= 5; seed++) {
    n0++;
    const m = ME.planMeetForce({ nation: ns[0], nations: ns, battleNumber: b, rules: R, seed });
    if (m.kept.some((k) => AT.test(k.name))) maus.push(`encontro ${ns} b${b} s${seed}: canhao anticarro`);
  }
  const naDefesa = DF.poolOf('UKR', R).flatMap((s) => s.units).filter((u) => AT.test(u.name) && u.bucket !== 'never').length;
  if (!naDefesa) maus.push('a defesa ucraniana perdeu o canhao anticarro');
  ok(!maus.length, `(216) canhao anticarro UKR: fora de ${n0} encontros, ${naDefesa} no pool da defesa${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 217. AS MENCOES HONROSAS DA TELA DE FIM (autor, 06/11): no lugar de "The force at the end", uma linha por VIDA (o veiculo
//      destruido e reposto e uma maquina nova: Battle Hired -> Battle Died). Um livro sintetico de tres batalhas: as vidas
//      saem certas, os kills de cada batalha pela diferenca dos saves, cada categoria pega a linha certa, corta em `top`,
//      deixa fora quem nao lutou e os observadores; o veiculo, a formacao e o lider de cada vida saem certos.
{
  const H = await import('./src/honours.mjs'); const C = await import('./src/campaign.mjs'); const RE = await import('./src/re.mjs');
  const maus = [];
  const F = 'Tactical Group (Battalion [BTR]) / Company (Rifle) #1 / Platoon (Tank)';
  const units = [
    { coreId: 1, name: 'Main Battle Tank (T-72B3) #1', formation: F, present: true, experience: 'Regular' },
    { coreId: 2, name: 'Squad (Rifle) #1', formation: 'TG / Platoon (Rifle)', present: true },
    { coreId: 3, name: 'Squad (Rifle) #2', formation: 'TG / Platoon (Rifle)', present: true },
    { coreId: 4, name: 'Squad (ATGM) #1', formation: 'TG', present: true },
    { coreId: 5, name: 'Multipurpose Vehicle (M1151 HMMWV (Mk19)) #2', formation: 'TG / Recon', present: true },
    { coreId: 6, name: 'Forward Observer Team', formation: 'TG', present: true },
    { coreId: 7, name: 'Squad (Rifle) #9', formation: 'TG', present: true },   // nunca lutou
    { coreId: 8, name: 'Main Battle Tank (T-90AM) #4', formation: 'TG', present: true },   // entrou na b7
  ];
  const g = (ids, xp = {}) => ids.map((id) => ({ coreId: id, experience: xp[id] || 'Regular' }));
  const r = (n, ids, units2, { prom = [], lid = [], marks = {}, xp = {} } = {}) => ({ n, r: { progression: { gains: g(ids, xp), promotions: prom }, leadership: { gains: lid }, units: units2, vehicles: { marks } } });
  // o tanque 1 morre na b2, e reposto na b2 e volta Green na b7 (segunda vida, viva); o HMMWV 5 morre na b1 e so e
  // reposto na b2: na b2 o destroco nao luta
  const results = [
    r(1, [1, 2, 3, 4, 5, 6], [{ coreId: 2, instantiated: 9, alive: 6, casualties: 3 }, { coreId: 3, instantiated: 9, alive: 0, casualties: 9 }], { prom: [{ coreId: 2, from: 'Green', to: 'Regular' }], lid: [{ coreId: 2, from: '0', to: '0' }], marks: { 5: 'destroyed', 1: 'survived' } }),
    r(2, [1, 2, 4, 5, 6], [{ coreId: 2, instantiated: 6, alive: 5, casualties: 1 }], { marks: { 1: 'destroyed', 5: 'destroyed' } }),
    r(7, [1, 2, 5, 8], [], { xp: { 1: 'Green' }, marks: { 1: 'survived', 5: 'survived' } }),
  ];
  const k = (lista) => ({ units: lista.map(([coreId, men, veh = []]) => ({ coreId, men, vehicles: veh })) });
  const killsByBattle = new Map([
    [1, k([[1, 30, [{ name: 'Main Battle Tank (M1A2)', count: 1 }]], [2, 5], [4, 1, [{ name: 'IFV (Bradley)', count: 4 }]], [5, 9], [6, 30, [{ name: 'Main Battle Tank (M1A2)', count: 5 }]], [7, 99]])],
    [2, k([[1, 40, [{ name: 'Main Battle Tank (M1A2)', count: 1 }, { name: 'IFV (M2)', count: 3 }]], [2, 12, [{ name: 'Main Battle Tank (Abrams)', count: 2 }]], [4, 3, [{ name: 'IFV (Bradley)', count: 4 }]], [5, 9], [6, 30, [{ name: 'Main Battle Tank (M1A2)', count: 5 }]], [7, 99]])],
    [7, k([[1, 46, [{ name: 'Main Battle Tank (M1A2)', count: 1 }, { name: 'IFV (M2)', count: 3 }]], [2, 12, [{ name: 'Main Battle Tank (Abrams)', count: 2 }]], [4, 3, [{ name: 'IFV (Bradley)', count: 4 }]], [5, 11], [6, 30, [{ name: 'Main Battle Tank (M1A2)', count: 5 }]], [7, 99], [8, 5]])],
  ]);
  const leadersByBattle = new Map([
    [2, H.leadersOf([{ coreId: 1, name: 'Morozov', leads: 'team', position: 0, state: 'down', alive: false }, { coreId: 1, name: 'Burobin', position: 1, state: 'down', alive: false }])],
    [7, H.leadersOf([{ coreId: 1, name: 'Novo', leads: 'team', position: 0 }, { coreId: 2, name: 'Caido', leads: 'squad', state: 'down', alive: false, position: 0 }, { coreId: 2, name: 'Tyurin', leads: 'team', position: 2 }])],
  ]);
  const base = {
    units, attrs: { 1: { experiencia: 'Regular' }, 2: { experiencia: 'Veteran', lideranca: '+1' } }, wrecked: [{ coreId: 1, battle: 2, rebuilt: true }, { coreId: 5, battle: 2, rebuilt: true }], results, killsByBattle, leadersByBattle,
    machineOf: (u) => /Tank|Vehicle/.test(u.name), scales: { experience: RE.EXPERIENCE_LEVELS, leadership: C.LEADERSHIP }, spotters: /Observer/i,
  };
  const L = H.unitLedger(base);
  const vida = (id, n) => L.find((x) => x.coreId === id && x.life === n);
  const vidas = (id) => L.filter((x) => x.coreId === id).map((x) => `B${x.hired}-${x.died ? 'B' + x.died : 'vivo'}:${x.battles}b:${x.kills}k`).join(' ');
  if (vidas(1) !== 'B1-B2:2b:40k B7-vivo:1b:6k') maus.push(`vidas do tanque ${vidas(1)}`);
  if (vidas(5) !== 'B1-B1:1b:9k B7-vivo:1b:2k') maus.push(`vidas do HMMWV (o destroco nao luta na b2) ${vidas(5)}`);
  if (vidas(2) !== 'B1-vivo:3b:12k' || vidas(7) !== '') maus.push(`esquadrao ${vidas(2)} / quem nao lutou ${vidas(7)}`);
  const t1 = vida(1, 1), t2 = vida(1, 2), s2 = vida(2, 1);
  if (t1.vehicle !== 'T-72B3 #1' || vida(5, 1).vehicle !== 'M1151 HMMWV (Mk19) #2' || s2.vehicle !== null) maus.push('nome do veiculo');
  if (t1.formation !== 'Tactical Group (Battalion [BTR])' || t1.subFormation !== 'Company (Rifle) #1 / Platoon (Tank)') maus.push(`formacao ${t1.formation} | ${t1.subFormation}`);
  if (t1.leader !== 'Morozov' || t2.leader !== 'Novo' || s2.leader !== 'Tyurin') maus.push(`lider ${t1.leader} / ${t2.leader} / ${s2.leader}`);
  if (t1.vehicleKills !== 4 || t1.tankKills !== 1 || t2.vehicleKills !== 0) maus.push(`veiculos abatidos ${t1.vehicleKills}/${t1.tankKills}/${t2.vehicleKills}`);
  if (t2.experience.from !== 'Green' || t2.experience.steps !== 1 || s2.experience.from !== 'Green' || s2.experience.steps !== 2 || s2.losses !== 4) maus.push(`ganhos ${JSON.stringify([t2.experience, s2.experience, s2.losses])}`);
  const cats = Object.fromEntries(H.honourableMentions(L, { top: 2, battlesToWin: 12 }).map((c) => [c.id, c.rows.map((x) => `${x.coreId}.${x.life}`)]));
  const quer = { 'kills-vehicle': ['1.1', '5.1'], 'kills-squad': ['2.1', '4.1'], 'untouchable': ['1.2', '8.1'], 'vkills-vehicle': ['1.1'], 'vkills-squad': ['4.1', '2.1'], 'veterancy': ['2.1', '1.2'], 'leadership': ['2.1'], 'hardened': ['2.1'], 'old-guard': ['2.1', '4.1'], 'giant-killer': ['2.1'], 'late-bloomer': ['1.2', '8.1'] };
  for (const [id, ids] of Object.entries(quer)) if (JSON.stringify(cats[id] || []) !== JSON.stringify(ids)) maus.push(`${id}: ${JSON.stringify(cats[id])} != ${JSON.stringify(ids)}`);
  for (const id of Object.keys(cats)) if (!(id in quer)) maus.push(`categoria a mais ${id}`);
  const sem = H.honourableMentions(H.unitLedger({ ...base, killsByBattle: new Map() }), { top: 2 }).map((c) => c.id).join();
  if (sem !== 'veterancy,leadership,hardened') maus.push(`sem kills: ${sem}`);
  // a campanha local com historico
  let local = 'sem campanha local (pulado)';
  const dir = path.join(CAMPAIGNS_DIR);
  const slug = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).find((d) => { try { return (JSON.parse(fs.readFileSync(path.join(dir, d, 'state.json'), 'utf8')).history || []).length >= 3; } catch { return false; } });
  if (slug) {
    const S = C.campaignSummary(slug);
    if ('force' in S || !S.mentions?.categories?.length) maus.push(`${slug}: sem mencoes`);
    for (const c of S.mentions?.categories || []) if (c.rows.some((x, i) => i && x.value > c.rows[i - 1].value)) maus.push(`${slug} ${c.id} fora de ordem`);
    for (const c of S.mentions?.categories || []) for (const x of c.rows) if (x.died !== null && x.died < x.hired) maus.push(`${slug} vida ao contrario ${x.name}`);
    local = `${slug}: ${S.mentions.categories.length} listas, kills de ${S.mentions.killsBattles}/${S.mentions.battlesRead} batalhas`;
  }
  ok(!maus.length, `(217) mencoes honrosas por vida: ${Object.keys(quer).length} categorias no livro sintetico, tanque com 2 vidas, destroco parado ate a reposicao; ${local}${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 218. O PRECO DA SPECIAL FORCES FAZ PARTE DA DIFICULDADE (autor, 06/11): 600 cr em todos os presets; gratis nao bate com
//      nenhum (Custom) e desconta no multiplicador do placar; a campanha antiga gratis com nome de preset vira Custom.
{
  const C = await import('./src/campaign.mjs');
  const maus = []; let slug = null;
  const pres = R.difficulty.presets;
  if (!pres.every((p) => p.specialForcesPrice === 600)) maus.push('preset sem 600');
  const med = pres.find((p) => p.name === 'Medium');
  const campos = { armies: med.armies, enemySide: med.enemySide, ratio: med.ratio, rescueChance: med.rescueChance, opPoints: med.opPoints, defeats: med.defeats };
  if (C.difficultyOf({ ...campos, specialForcesPrice: 0 }, R) !== 'Custom') maus.push('Free nao e Custom');
  if (C.difficultyOf({ ...campos, specialForcesPrice: 600 }, R) !== 'Medium' || C.difficultyOf(campos, R) !== 'Medium') maus.push('600/sem campo nao e Medium');
  const base = { armies: med.armies, defeatsAllowed: med.defeats, rescueChance: med.rescueChance, path: { startingPoints: med.opPoints }, forceRatio: med.ratio };
  const m600 = C.difficultyMultiplier({ ...base, specialForcesPrice: 600 }, R), m0 = C.difficultyMultiplier({ ...base, specialForcesPrice: 0 }, R);
  const desconto = R.score.difficulty.specialForces['0'];
  if (m600 !== C.difficultyMultiplier(base, R) || Math.abs(m0 - Math.round((m600 + desconto * (R.score.difficulty.ratio[String(med.ratio)] ?? 1)) * 100) / 100) > 1e-9 || !(m0 < m600)) maus.push(`multiplicador ${m600} / free ${m0}`);
  if (C.presetMultipliers(R).find((p) => p.name === 'Medium').multiplier !== m600) maus.push('preset Medium mudou de multiplicador');
  try {
    const st = await C.createCampaign({ name: 'ZZ T218', armies: med.armies, enemySide: med.enemySide, forceRatio: med.ratio, rescueChance: med.rescueChance, opPoints: med.opPoints, defeatsAllowed: med.defeats, picks: [], specialForcesPrice: 0 }, () => {});
    slug = st.slug;
    if (st.difficulty !== 'Custom') maus.push(`criada Free gravou ${st.difficulty}`);
    C.saveState({ ...C.loadState(slug), difficulty: 'Medium' });
    if (C.loadState(slug).difficulty !== 'Custom') maus.push('migracao nao corrigiu a antiga Free');
    C.saveState({ ...C.loadState(slug), specialForcesPrice: 600, difficulty: 'Medium' });
    if (C.loadState(slug).difficulty !== 'Medium') maus.push('migracao mexeu na de 600');
  } catch (e) { maus.push(e.message.slice(0, 160)); }
  finally { if (slug) fs.rmSync(C.dirOf(slug), { recursive: true, force: true }); }
  ok(!maus.length, `(218) SF na dificuldade: 600 nos presets, Free e Custom (${R.score.difficulty.specialForces['0']} no placar), antiga Free migrada${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 219. A CATEGORIA DO RELATORIO E PELO CASCO (autor, 07/11: "perdi um stryker, mas ele consta como imobilizado", US b3). O
//      AAR deu 1 blindado e 6 outros veiculos; o app punha os HMMWV com M2 e de ATGM (papel da arma) nos blindados, achava 4
//      contra 1 e baixava o Stryker e dois HMMWV para imobilizados. Com o save da campanha do autor, a releitura a partir do
//      estado de antes da batalha da o Stryker e os dois HMMWV (M2) destruidos e nenhuma baixa pelo AAR; sem ele, so a fonte.
{
  const C = await import('./src/campaign.mjs');
  const maus = []; let txt = 'sem o save da US b3: so a fonte';
  // desde 08/11 a categoria e C.hullCategory (o briefing tambem a usa): o comportamento, nao a linha da fonte
  const cat = C.hullCategory;
  if (cat({ role: 'mg', name: 'Multipurpose Vehicle (M1151 HMMWV (M2))' }) !== 'outrosVeiculos' || cat({ role: 'atgm', name: 'ATGM Vehicle (M1167 HMMWV)' }) !== 'outrosVeiculos'
    || cat({ role: 'apc', name: 'Infantry Carrier Vehicle (M1126 Stryker)' }) !== 'blindados' || cat({ role: 'tank', name: 'Main Battle Tank (M1A2 SEP Abrams)' }) !== 'tanques') maus.push('a categoria do AAR nao manda o HMMWV para outros veiculos');
  const dir = path.join(CAMPAIGNS_DIR, 'US', 'battles', '03');
  const rp = path.join(dir, 'result.json'), up = path.join(dir, 'undo', 'state.json');
  if (fs.existsSync(rp) && fs.existsSync(up)) {
    const r = JSON.parse(fs.readFileSync(rp, 'utf8'));
    if (r.save?.path && fs.existsSync(r.save.path) && r.vehicles?.marks?.['382']) {
      const v = C.vehiclesFromSave(JSON.parse(fs.readFileSync(up, 'utf8')), r.save.path, { offMap: new Set(r.offMap), aar: r.aar.player });
      for (const id of ['382', '160', '169', '171']) if (v.marks[id] !== 'destroyed') maus.push(`core ${id}: ${v.marks[id]}`);
      if (v.writtenOff.some((w) => w.reason === 'aar')) maus.push('baixa pelo AAR: ' + v.writtenOff.map((w) => w.coreId).join(','));
      txt = `US b3: Stryker ${v.marks['382']}, HMMWV (M2) ${v.marks['160']}/${v.marks['169']}`;
    }
  }
  ok(!maus.length, `(219) categoria do AAR pelo casco: HMMWV e outro veiculo; ${txt}${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 220. O LANCADOR VOLTA COM OS MISSEIS (autor, 07/11: "strykers estao voltando das batalhas sem o launcher, apenas os
//      misseis"). A lista de fabrica com itens faltando e perda e volta inteira; a variante que troca item fica. Na US, o
//      M1126 #2 saiu da b4 com 2 AT4 e entrava na b5 com os 2 misseis e sem o CLU: o reset agora devolve o CLU.
{
  const C = await import('./src/campaign.mjs');
  const fab = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'research', 'fabrica.json'), 'utf8'));
  const pel = fab.maquinas['US|Infantry Carrier Vehicle (M1126 Stryker)']?.lancadores?.porFormacao?.['Platoon (Rifle)'];
  const ord = (l) => (l ? [...l].sort().join('+') : 'fica');
  const btr = { itens: ['4/15', '4/15', '4/15', '4/15'], variantes: [['4/15', '4/15', '4/15', '4/15'], ['4/15', '4/15', '4/15', '4/16']] };
  const maus = [];
  const casos = [
    ['2 AT4 no pelotao', C.launcherTarget(['4/2', '4/2'], pel), '4/1+4/2+4/2'],
    ['1 AT4 no pelotao', C.launcherTarget(['4/2'], pel), '4/1+4/2+4/2'],
    ['vazia no pelotao', C.launcherTarget([], pel), '4/1+4/2+4/2'],
    ['inteira no pelotao', C.launcherTarget(['4/2', '4/1', '4/2'], pel), 'fica'],
    ['BTR-4E variante RPG-26', C.launcherTarget(['4/15', '4/15', '4/15', '4/16'], btr), 'fica'],
    ['BTR-4E com sobra', C.launcherTarget(['4/15', '4/15', '4/15', '4/15', '4/15'], btr), '4/15+4/15+4/15+4/15'],
  ];
  for (const [nome, got, quer] of casos) if (ord(got) !== quer) maus.push(`${nome}: ${ord(got)} (queria ${quer})`);
  // a passagem real para a b5 da US (save do autor, quando existe): o #2 ganha o CLU
  let real = 'sem o save da US b5';
  const src = path.join(CAMPAIGNS_DIR, 'US', 'work', 'resupplied-units-B5.bts');
  if (fs.existsSync(src)) {
    const { resetLaunchers } = await import('./src/forge.mjs');
    const TV = await import(new URL('../tools/re/toe_veiculos.mjs', import.meta.url).href);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-t220-')); const out = path.join(tmp, 'l.bts');
    try {
      const r = resetLaunchers({ save: src, out, target: (id, atual) => ([294, 295].includes(id) ? C.launcherTarget(atual, pel) : null) });
      const bl = TV.blocosDoSave(r.vehicles ? out : src);
      const l = Object.fromEntries(bl.unidades.filter((u) => [294, 295].includes(u.coreId)).map((u) => [u.coreId, ord(TV.lerLancadores(bl.exp, u)?.itens)]));
      real = `US b5: #1 ${l[294]}, #2 ${l[295]}`;
      if (l[294] !== '4/1+4/2+4/2' || l[295] !== '4/1+4/2+4/2') maus.push(real);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  ok(!maus.length, `(220) lancador com os misseis: lista de fabrica incompleta volta inteira, variante fica; ${real}${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 221. A FATIA DAS EQUIPES E RESERVADA (autor, 08/11: "eles costumam ser mais importantes que tanques"). A b7 da US
//      (Plehany 099, semente do no r7c1) saiu com 4 tanques, 8 equipes e 9 transportes, e nenhuma equipe avulsa: o 4o
//      tanque pagou com o dinheiro delas. Ate a compra das equipes, as avulsas precisam caber no orcamento menos o que
//      falta da fatia delas; o balde de tanques nao passa do alvo no primeiro passe. Os lotes nao sao barrados.
{
  const R = rules(); const quieto = { event() {} }; const maus = [];
  const b7 = planDefense({ nation: 'RU', nations: ['RU'], battleNumber: 7, rules: R, seed: 1938297368, profile: 'aberto', effort: 1.4662756598240467, kind: null, trace: quieto });
  if (b7.spent.teams < 1400 || b7.spent.tanks >= 7000 || (b7.byBucket.teams || 0) < 14) maus.push(`b7 real: equipes ${b7.spent.teams} (${b7.byBucket.teams}), tanques ${b7.spent.tanks}`);
  let razao = 0; const N = 40;
  for (let s = 1; s <= N; s++) {
    const d = planDefense({ nation: 'RU', nations: ['RU'], battleNumber: 7, rules: R, seed: 1000 + s * 7919, profile: 'aberto', effort: 1.4662756598240467, kind: null, trace: quieto });
    razao += d.spent.teams / d.budgets.teams;
    if (d.spent.tanks > d.budgets.tanks && d.spent.teams < d.budgets.teams / 2 && !d.trail.some((t) => t.slack && /Main Battle Tank|Tank Destroyer/.test(t.unit || ''))) maus.push(`semente ${1000 + s * 7919}: tanques ${d.spent.tanks}/${d.budgets.tanks} no primeiro passe com equipes ${d.spent.teams}/${d.budgets.teams}`);
  }
  if (razao / N < 0.7) maus.push(`equipes do tier 3 RU em ${Math.round((100 * razao) / N)} % da fatia`);
  for (const [lado, b, perfil] of [[{ nation: 'RU', nations: ['RU'] }, 1, 'aberto'], [{ nation: 'US', nations: ['US', 'UKR'] }, 2, 'misto']]) for (let s = 1; s <= N; s++) {
    const d = planDefense({ ...lado, battleNumber: b, rules: R, seed: 1000 + s * 7919, profile: perfil, effort: 1, kind: null, trace: quieto });
    if (!d.trail.some((t) => t.lot) || d.spent.squads < d.budgets.squads) maus.push(`${lado.nations.join('+')} b${b} s${1000 + s * 7919}: esquadras ${d.spent.squads}/${d.budgets.squads}`);
  }
  ok(!maus.length, `(221) fatia das equipes reservada: b7 real ${b7.byBucket.tanks} tanques (${b7.spent.tanks}) / ${b7.byBucket.teams} equipes (${b7.spent.teams}); tier 3 RU ${Math.round((100 * razao) / N)} % da fatia${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 222. O G14 DO PLEHANY 099 SEGURA OS OBJETIVOS MENORES (autor, 08/11: East Rd vazio na US b7 — so o apoio tinha zona la).
//      O Setup do minoritario ganhou a mata do East Rd e do SE Road (ia_zonas_editar --filtro abrigo); com os ocupados da
//      b7, 7 esquadroes caem 3 na floresta central, 2 no East Rd e 2 no SE Road.
{
  const IE = await import(new URL('../tools/re/ia_escrever.mjs', import.meta.url).href);
  const DT = await import(new URL('../tools/re/ia_doutrina.mjs', import.meta.url).href);
  const { espalhar } = await import('../tools/re/acrescentar.mjs');
  const chave = 'qb_attack/Plehany-Open (1200 X 1280) 099 Attack CMBSRL.btt';
  const arq = path.join(import.meta.dirname, '..', 'assets', chave); const maus = [];
  const F = DT.feicoes(arq); const d = IE.decodificar(arq);
  const zona = IE.doMapa(d, d.azul[0].slots[13][0].tiles);
  const OBJ = { floresta: [46, 80, 60, 100], eastRd: [134, 149, 69, 104], seRoad: [101, 142, 27, 38] };
  const em = (t, [a, b, c, e]) => t[0] >= a && t[0] <= b && t[1] >= c && t[1] <= e;
  const nEast = zona.filter((t) => em(t, OBJ.eastRd)).length, nSe = zona.filter((t) => em(t, OBJ.seRoad)).length;
  if (nEast < 150 || nSe < 100) maus.push(`zona: East Rd ${nEast}, SE Road ${nSe}`);
  if (zona.some(([x, y]) => { const i = F.idx(x, y); return !F.azul[i] || !F.abrigo[i]; })) maus.push('tile fora do abrigo azul');
  const ocup = [[102,30],[104,32],[106,32],[108,34],[116,36],[118,32],[118,36],[122,34],[8,158],[10,156],[12,154],[16,150],[18,140],[20,138],[22,136],[24,136],[26,138],[28,138],[30,142],[32,142],[36,154],[104,52],[106,36],[112,18],[18,150],[26,142],[36,158],[68,96],[80,96],[82,94],[94,92],[114,134],[124,150],[88,94],[88,112],[122,52],[136,122],[142,22],[60,92],[66,78],[74,68]];
  const conta = (r) => Object.fromEntries(Object.entries(OBJ).map(([k, o]) => [k, r.filter((t) => em(t, o)).length]));
  const r7 = espalhar(zona, 7, ocup, zona), c7 = conta(r7);
  let vao = Infinity; for (let i = 0; i < r7.length; i++) for (let j = i + 1; j < r7.length; j++) vao = Math.min(vao, Math.hypot(r7[i][0] - r7[j][0], r7[i][1] - r7[j][1]));
  if (Object.values(c7).some((n) => n < 2) || vao < 8) maus.push(`7: ${JSON.stringify(c7)}, vao ${vao.toFixed(1)}`);
  const c3 = conta(espalhar(zona, 3, ocup, zona)); if (Object.values(c3).some((n) => n !== 1)) maus.push(`3: ${JSON.stringify(c3)}`);
  const reg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'data', 'planos_ia.json'), 'utf8')).mapas[chave];
  const crypto = await import('node:crypto');
  if (reg?.sha256 !== crypto.createHash('sha256').update(fs.readFileSync(arq)).digest('hex')) maus.push('sha256 do registro');
  ok(!maus.length, `(222) G14 do Plehany 099: zona ${zona.length} tiles (East Rd ${nEast}, SE Road ${nSe}); 7 esquadroes ${c7.floresta}/${c7.eastRd}/${c7.seRoad}${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 223. O BRIEFING COM AS CONDICOES (autor, 08/11: "adicionar as variaveis climaticas e de EW no briefing", mais o apoio, a
//      forca em numeros e os efeitos de noite e terreno). Friendly: veiculos pelo casco, experiencia, novos, reconstruidos,
//      apoio e a EW propria sempre; Enemy: a EW inimiga sempre; Notes: o clima por inteiro e uma linha por efeito.
{
  const C = await import('./src/campaign.mjs');
  const R = rules(); const maus = [];
  const ascii = (b) => b.vermelho.every((t) => /^[\x20-\x7e\n]*$/.test(t));
  const mapa = { f: 'Khalmi-Rough (1088 X 1104) 085r Attack.btt', W: 1088, H: 1104, tipo: null };
  const noite = { period: 'night', name: 'Night', daylight: 'Night', hour: 23 };
  const nevoa = R.battle.weather.profiles.find((p) => p.id === 'mist');
  const perfil = (id) => ({ ...R.battle.weather.profiles.find((p) => p.id === id) });
  // sintetico: 1 fuzileiro, 2 Abrams (um novo), 1 HMMWV reconstruido, 1 obuseiro fora do mapa
  const st = {
    name: 'ZZ', defeatsLeft: 2, history: [{ n: 1, map: 'Tiny City', level: 'Draw' }], picks: [], sold: [], fought: [1, 2, 4, 5],
    wrecked: [{ battle: 1, coreId: 4, name: 'Multipurpose Vehicle (M1152 HMMWV) #3', rebuilt: true }, { battle: 0, coreId: 9, name: 'Velho', rebuilt: true }],
    units: [
      { coreId: 1, name: 'Squad (Rifle) #1', role: 'infantry', present: true, experience: 'Veteran' },
      { coreId: 2, name: 'Main Battle Tank (M1A2 SEP Abrams (APS)) #1', role: 'tank', present: true, experience: 'Regular', type: [1, 5] },
      { coreId: 3, name: 'Main Battle Tank (M1A2 SEP Abrams (APS)) #2', role: 'tank', present: true, experience: 'Veteran', type: [1, 5] },
      { coreId: 4, name: 'Multipurpose Vehicle (M1152 HMMWV) #3', role: 'truck', present: true, experience: 'Regular', type: [1, 5] },
      { coreId: 5, name: '6 x 155mm Howitzer (M109A7 Paladin)', role: 'artillery_off', present: true, offMap: true, experience: 'Veteran' },
    ],
  };
  const b = C.briefingFor({ state: st, n: 2, map: mapa, duration: 100, ew: { enemy: 'None', countered: false, own: 'None' }, time: noite, weather: nevoa, R });
  const [, mis, ami, ini, plan, notas] = b.vermelho;
  if (!/On the map: 1 infantry and team unit, 3 vehicles \(2 tanks, 1 other\)\./.test(ami)) maus.push('forca: ' + ami.split('\n')[0]);
  if (!/Off the map: 1\./.test(ami) || !/Experience: 3 veteran, 2 regular\./.test(ami)) maus.push('fora/xp: ' + ami.replace(/\n/g, ' | '));
  if (!/New for this battle: Main Battle Tank \(M1A2 SEP Abrams \(APS\)\)\./.test(ami)) maus.push('novos');
  if (!/Rebuilt after the last battle: Multipurpose Vehicle \(M1152 HMMWV\)\./.test(ami) || /Velho/.test(ami)) maus.push('reconstruidos');
  if (!/Support: 6 x 155mm Howitzer \(M109A7 Paladin\), veteran\./.test(ami) || !/Your electronic warfare: none\./.test(ami)) maus.push('apoio/EW propria');
  if (!/Enemy electronic warfare: none detected\.$/.test(ini)) maus.push('EW inimiga none');
  if (/Weather:/.test(mis.replace('Weather and light: see Notes.', '')) || plan !== '') maus.push('mission/plan');
  for (const re of [/^Weather: Mist\. Wind: none\. Temperature: cool\. Ground: damp\./, /Light: night, H-hour 23:00/, /Mist or fog/, /No wind: smoke lingers/]) if (!re.test(notas)) maus.push('notas ' + re);
  if (!ascii(b)) maus.push('fora do ASCII');
  // a EW inimiga com nivel, contida ou nao; a EW propria comprada
  const e1 = C.briefingFor({ state: st, n: 2, map: mapa, duration: 45, ew: { enemy: 'Medium', countered: false, own: 'Light' }, R }).vermelho;
  const e2 = C.briefingFor({ state: st, n: 2, map: mapa, duration: 45, ew: { enemy: 'Strong', countered: true, own: 'None' }, R }).vermelho;
  if (!/Enemy electronic warfare: Medium: expect jammed radio links/.test(e1[3]) || !/Your electronic warfare: Light, degrades/.test(e1[2])) maus.push('EW medium');
  if (!/Enemy electronic warfare: Strong, countered before the battle\./.test(e2[3])) maus.push('EW countered');
  if (e1[5] !== '') maus.push('notas sem clima nem hora deviam ficar vazias');
  // chuva forte e lama; dia claro
  const chuva = C.battleConditions({ time: { daylight: 'Day', hour: 12 }, weather: { ...perfil('heavy-rain'), windSource: 2 }, R });
  if (!/Rain: visibility is reduced/.test(chuva) || !/Muddy ground: vehicles off the roads may bog down/.test(chuva) || !/Strong wind/.test(chuva) || !/from the /.test(chuva)) maus.push('chuva: ' + chuva.replace(/\n/g, ' | '));
  const claro = C.battleConditions({ time: { daylight: 'Day', hour: 12 }, weather: perfil('clear'), R });
  if (!/Clear day: no effect on spotting or movement\./.test(claro)) maus.push('claro: ' + claro.replace(/\n/g, ' | '));
  // a campanha US do autor, quando existe: a b9 (os 2 Abrams e o Stinger novos, 38 veiculos)
  let real = 'sem a campanha US';
  const sf = path.join(CAMPAIGNS_DIR, 'US', 'state.json');
  if (fs.existsSync(sf)) {
    const us = JSON.parse(fs.readFileSync(sf, 'utf8'));
    if (us.battleNumber === 9 && !(us.fought || []).includes(541)) {
      const a = C.briefingFor({ state: us, n: 9, map: mapa, duration: 100, ew: { enemy: 'None', countered: false, own: 'None' }, time: noite, weather: nevoa, R }).vermelho[2];
      real = a.split('\n')[0];
      if (!/38 vehicles \(4 tanks, 8 armoured, 26 other\)/.test(a) || !/New for this battle: Stinger Team; 2 x Main Battle Tank/.test(a) || !/M777A2/.test(a)) maus.push('US b9: ' + a.replace(/\n/g, ' | ').slice(0, 200));
    } else real = 'US alem da b9';
  }
  ok(!maus.length, `(223) briefing com condicoes, EW, apoio e forca em numeros; ${real}${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 224. OS TANQUES EM TODOS OS GRUPOS DE BLINDADOS (autor, 08/11: "os tanques inimigos estao concentrados na borda oeste" do
//      Khalmi 085r, US b9). Pelo preco, os 4 carros e o Shturm-S eram os 20 % mais caros e iam todos para a reserva (G9),
//      escondida no fundo oeste. Agora os tanques vao em rodizio reserva -> B -> C -> A -> frente, e a reserva do Khalmi
//      fica junto do complexo industrial (x 30-64, y 76-100). Sem tanque, a divisao e a de antes.
{
  const { planoDeGrupos } = await import('../tools/re/ia_agrupar.mjs');
  const roleOf = (n) => (/Main Battle Tank|Tank Destroyer/.test(n) ? 'tank' : /Fighting/.test(n) ? 'ifv' : 'apc');
  const preco = (n) => ({ 'Main Battle Tank (T-90AM (APS))': 2650, 'Main Battle Tank (T-90AM)': 2000, 'Main Battle Tank (T-72B3)': 1350, 'Tank Destroyer (9P149 Shturm-S)': 600, 'Infantry Fighting Vehicle (BMP-2M)': 250 }[n] ?? 110);
  const u = (id, nome) => ({ id, nome, formacao: 'x', ausente: false, avulsa: false, foraDoMapa: false });
  const nomes = ['Main Battle Tank (T-90AM (APS))', 'Main Battle Tank (T-90AM)', 'Main Battle Tank (T-72B3)', 'Main Battle Tank (T-72B3)', 'Tank Destroyer (9P149 Shturm-S)', 'Tank Destroyer (9P149 Shturm-S)',
    ...Array(6).fill('Infantry Fighting Vehicle (BMP-2M)'), ...Array(17).fill('Armored Personnel Carrier (BTR-82)')];
  const maus = [];
  const p = planoDeGrupos(nomes.map((n, k) => u(k + 1, n)), { roleOf, preco });
  const por = {}; for (const b of p.blindados) (por[b.grupo] ||= []).push(b.nome);
  const tanquesPor = Object.fromEntries([5, 6, 7, 8, 9].map((g) => [g, (por[g] || []).filter((n) => roleOf(n) === 'tank').length]));
  if (Object.values(tanquesPor).some((q) => q < 1)) maus.push('grupo sem tanque: ' + JSON.stringify(tanquesPor));
  if (p.blindados.find((b) => b.nome === 'Main Battle Tank (T-90AM (APS))').grupo !== 9) maus.push('o mais caro devia ficar na reserva');
  const tamanhos = [5, 6, 7, 8, 9].map((g) => (por[g] || []).length); if (tamanhos.reduce((a, b) => a + b, 0) !== nomes.length || Math.max(...tamanhos) - Math.min(...tamanhos) > 1) maus.push('cotas ' + tamanhos);
  // sem tanque: o mesmo de antes (frente = os mais baratos, reserva = os mais caros)
  const q = planoDeGrupos([...Array(5).fill('Infantry Fighting Vehicle (BMP-2M)'), ...Array(5).fill('Armored Personnel Carrier (BTR-82)')].map((n, k) => u(k + 1, n)), { roleOf, preco });
  if (q.blindados.filter((b) => b.grupo === 9).some((b) => !/BMP/.test(b.nome)) || q.blindados.filter((b) => b.grupo === 5).some((b) => !/BTR/.test(b.nome))) maus.push('sem tanque mudou');
  // um tanque so: vai para a reserva, como antes
  const r1 = planoDeGrupos([u(1, 'Main Battle Tank (T-72B3)'), ...Array(9).fill(0).map((_, k) => u(k + 2, 'Armored Personnel Carrier (BTR-82)'))], { roleOf, preco });
  if (r1.blindados.find((b) => /Tank/.test(b.nome)).grupo !== 9) maus.push('um tanque so devia ir a reserva');
  // a reserva do Khalmi no pacote: junto do complexo industrial, nada no fundo oeste
  const IE = await import(new URL('../tools/re/ia_escrever.mjs', import.meta.url).href);
  const d = IE.decodificar(path.join(import.meta.dirname, '..', 'assets', 'qb_attack', 'Khalmi-Rough (1088 X 1104) 085r Attack CMBSRL.btt'));
  const z9 = IE.doMapa(d, d.azul[0].slots[8][0].tiles);
  if (!z9.length || z9.some(([x, y]) => x < 30 || x > 64 || y < 76 || y > 100)) maus.push(`reserva do Khalmi: ${z9.length} tiles, x ${Math.min(...z9.map((t) => t[0]))}-${Math.max(...z9.map((t) => t[0]))}`);
  ok(!maus.length, `(224) tanques em todos os grupos de blindados: ${JSON.stringify(tanquesPor)}; reserva do Khalmi ${z9.length} tiles junto do complexo industrial${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 225. O SOBRENOME DE DUAS LETRAS (autor, 08/11: "alguns soldados estao voltando feridos. Isso so acontece com americanos").
//      O "Su" da Squad (Rifle) #1 da Stryker TF (core 289) era pulado pelo leitor (L < 3): entrou ferido na b10 e, sem ele,
//      o reset deu a cada homem depois dele a arma da vaga anterior. Duas letras entram so dentro de uma unidade que ainda
//      nao tem os n homens dela, com nome maiuscula+minuscula e a forma do registro.
{
  const RO = await import('../tools/re/roster.mjs');
  const maus = [];
  const homem = (n, e) => { const l = Buffer.alloc(2); l.writeUInt16LE(n.length); return Buffer.concat([l, Buffer.from(n, 'latin1'), Buffer.from([e, 0, 2, 4, 0, 8, 0, 0])]); };
  const unidade = (n, homens) => { const cab = Buffer.alloc(15, 0x11); const a = Buffer.from([5, 4, 3, 0, n, 0, 0, 0]); return Buffer.concat([cab, a, ...homens]); };
  const nomes = (b) => RO.soldadosDoBloco(b).map((s) => `${s.nome}:${s.estado}`).join(',');
  const a = nomes(unidade(3, [homem('Poindexter', 0), homem('Su', 1), homem('Teel', 0)]));
  if (a !== 'Poindexter:0,Su:1,Teel:0') maus.push('Su na unidade de 3: ' + a);
  const b = nomes(unidade(2, [homem('Poindexter', 0), homem('Su', 1), homem('Teel', 0)]));
  if (/Su/.test(b)) maus.push('Su numa unidade ja cheia: ' + b);
  const c = nomes(unidade(4, [homem('Poindexter', 0), homem('JP', 0), homem('ki', 0), homem('Teel', 0)]));
  if (/JP|ki/.test(c)) maus.push('ruido de duas letras: ' + c);
  const d = nomes(Buffer.concat([homem('Poindexter', 0), homem('Su', 0)]));
  if (/Su/.test(d)) maus.push('Su fora de unidade: ' + d);
  // o save da US entregue para a b10 (na maquina do autor)
  let real = 'sem o save da US b10';
  const SGs = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/';
  const f10 = SGs + 'US BTT9 transition [B10].bts';
  if (fs.existsSync(f10)) {
    const { readRoster } = await import('./src/re.mjs'); const { lightlyWounded } = await import('./src/transition.mjs');
    const r = readRoster(f10); const u = r.unidades.find((x) => x.coreId === 289), irma = r.unidades.find((x) => x.coreId === 290);
    const su = r.soldados.findIndex((s) => s.nome === 'Su');
    if (u?.soldados.length !== 9 || u.soldados[3]?.nome !== 'Su' || u.soldados[3].estado !== 1 || irma?.soldados.length !== 9) maus.push('US b10: ' + u?.soldados.map((s) => s.nome).join(','));
    if (!lightlyWounded(f10).includes(su)) maus.push('o Su ferido nao entra na cura');
    real = `US b10: core 289 com ${u?.soldados.length} homens, Su estado ${u?.soldados[3]?.estado}`;
  }
  // a pasta inteira: todo nome de duas letras aceito completa a unidade, nenhuma passa de n
  let corpus = '';
  if (fs.existsSync(SGs)) {
    const ASS = Buffer.from([5, 4, 3]); let curtos = 0, arquivos = 0; const quais = new Set();
    for (const f of fs.readdirSync(SGs).filter((x) => /transition.*\.bts$/i.test(x))) {
      let exp; try { exp = RO.expandirBloco(RO.localizarRoster(SGs + f).lz).exp; } catch { continue; } arquivos++;
      const sold = RO.soldadosDoBloco(exp); const assin = [];
      for (let q = exp.indexOf(ASS, 0); q >= 0; q = exp.indexOf(ASS, q + 4)) if (q >= 15 && exp.readUInt32LE(q + 4) <= 60) assin.push(q);
      assin.forEach((q, k) => {
        const fim = assin[k + 1] ?? exp.length, n = exp.readUInt32LE(q + 4), meus = sold.filter((s) => s.o > q && s.o < fim);
        const doisL = meus.filter((s) => s.nome.length === 2);
        if (doisL.length && meus.length !== n) maus.push(`${f}: unidade com ${meus.length} de ${n} depois de ${doisL.map((s) => s.nome)}`);
        for (const s of doisL) { curtos++; quais.add(s.nome); if (!/^[A-Z][a-z]$/.test(s.nome)) maus.push(`${f}: ${s.nome}`); }
      });
    }
    corpus = `; ${arquivos} saves de transicao: ${curtos} nomes de duas letras (${[...quais].join(', ')})`;
  }
  ok(!maus.length, `(225) sobrenome de duas letras lido com cerca; ${real}${corpus}${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 226. A ARTILHARIA COMPRADA ENTRA NO JOGO (autor, 08/11: "eu comprei a formacao de artilharia, mas nao veio no jogo", US
//      b10). O jogo casa a peca sem homens com a k-esima linha do tipo dela no roster; a linha do pelotao 3 x M777A2 (586)
//      ficou depois das duas desligadas da Stryker TF (413, 414) e o jogo o descartou. Provado em jogo: so trocar a ordem
//      (586 antes) faz ele aparecer (ZZ PROVA ART P6). A entrega poe as presentes primeiro, na ordem da forca.
{
  const RO = await import('../tools/re/roster.mjs');
  const maus = []; let real = 'sem o save da US b10';
  const SGa = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/';
  const f10 = SGa + 'US BTT9 transition [B10].bts', core10 = path.join(CAMPAIGNS_DIR, 'US', 'battles', '10', 'battle.btt');
  if (fs.existsSync(f10) && fs.existsSync(core10)) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-t226-')); const out = path.join(tmp, 'o.bts');
    try {
      const o = RO.ordenarSemHomens(f10, out, core10);
      const a = RO.lerRoster(f10), b = RO.lerRoster(out);
      const tipo = (r, t) => r.unidades.filter((u) => u.tipo === t).map((u) => u.coreId).join(',');
      if (tipo(b, 2569) !== '586,413,414') maus.push('3x M777: ' + tipo(b, 2569));
      if (!tipo(b, 778).startsWith('582,')) maus.push('Raven: ' + tipo(b, 778));
      if (tipo(b, 2825) !== tipo(a, 2825) || tipo(b, 2313) !== tipo(a, 2313)) maus.push('mexeu em tipo de linha unica');
      if (JSON.stringify(a.soldados) !== JSON.stringify(b.soldados) || a.unidades.length !== b.unidades.length) maus.push('soldados ou unidades mudaram');
      // a linha do pelotao continua byte a byte a mesma, so mudou de lugar
      const bloco = (f, id) => { const { exp } = RO.expandirBloco(RO.localizarRoster(f).lz); const r = RO.lerRoster(f); const k = r.unidades.findIndex((u) => u.coreId === id); return exp.subarray(r.unidades[k].pos - 15, r.unidades[k].pos - 15 + 54).toString('hex'); };
      if (bloco(f10, 586) !== bloco(out, 586) || bloco(f10, 413) !== bloco(out, 413)) maus.push('o bloco mudou de conteudo');
      const o2 = RO.ordenarSemHomens(out, out + '.2', core10); if (o2.tipos.length) maus.push('nao idempotente');
      // o mesmo roster da prova P6 para o tipo do pelotao, que o jogo aceitou
      if (fs.existsSync(SGa + 'ZZ PROVA ART P6.bts') && tipo(RO.lerRoster(SGa + 'ZZ PROVA ART P6.bts'), 2569) !== tipo(b, 2569)) maus.push('diferente da P6');
      real = `US b10: tipos reordenados ${o.tipos.map((t) => t.tipo).join(', ')}; 3x M777 ${tipo(b, 2569)}`;
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  // a entrega chama a ordem depois das vagas
  const fonte = fs.readFileSync(path.join(import.meta.dirname, 'src', 'forge.mjs'), 'utf8');
  const sync = fonte.slice(fonte.indexOf('export function syncRosterAttributes'), fonte.indexOf('export function growSaveRoster'));
  if (!/orderMenlessLines\(/.test(sync)) maus.push('syncRosterAttributes nao ordena');
  ok(!maus.length, `(226) linhas sem homens na ordem em que o jogo casa; ${real}${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 227. OS BLOCOS DO JOGO PARA PECA SEM HOMENS NO PACOTE (08/11, varredura de artilharia por faccao). A pasta de colheita fica
//      fora do git e do pacote; sem ela a entrega de artilharia/drone/aeronave comprada parava com erro (o sandbox recusou o
//      AH-64E). A tabela versionada a substitui, entra no pacote, e a loja nao vende formacao com peca sem bloco.
{
  const RO = await import('../tools/re/roster.mjs'); const CAT = await import('./src/catalog.mjs'); const PK = await import('./src/pacote.mjs');
  const maus = [];
  const tab = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'research', 'blocos_sem_homens.json'), 'utf8')).blocos || {};
  if (Object.keys(tab).length < 60) maus.push(`tabela com ${Object.keys(tab).length} blocos`);
  // so peca sem homens (n = 0): as equipes que entravam colidiam entre exercitos no u16 tipo (08/11)
  for (const [k, hx] of Object.entries(tab)) { const b = Buffer.from(hx, 'hex'); if (b.readUInt32LE(19) !== 0) { maus.push(`tipo ${k} com homens na tabela`); break; } }
  if (!PK.TABELAS_DO_APP.includes('blocos_sem_homens.json')) maus.push('fora do pacote');
  const d = RO.doadoresDaColheita();
  if (d.size !== Object.keys(tab).length || [...d].some(([k, b]) => b.toString('hex') !== tab[k])) maus.push('o leitor nao le a tabela');
  for (const [k, hx] of Object.entries(tab)) { const b = Buffer.from(hx, 'hex'); if (b.readUInt16LE(4) !== Number(k) || b.length > 80) { maus.push(`bloco ${k} mal formado`); break; } }
  // cada formacao so de fora do mapa que a loja vende: toda peca dela cresce o roster de um save real da faccao
  const SGb = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/';
  const saves = { US: SGb + 'US BTT9 transition.bts', RU: SGb + 'RUS BTT10 transition.bts', UKR: SGb + 'UKR btt9 TRANSITION.bts' };
  const C = await import('./src/campaign.mjs'); const tabela = C.typeTable(); let vendidas = 0, conferidas = 0;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-t227-'));
  try {
    for (const [n, sv] of Object.entries(saves)) {
      const L = CAT.libFormations(n, { specialForces: false }).filter((f) => f.units > 0 && f.offMapUnits === f.units);
      for (const f of L) {
        const pode = CAT.playerCanField(f); if (pode) vendidas++;
        if (!pode || !fs.existsSync(sv)) continue;
        const us = []; const anda = (x) => { if (!x.isFormation) us.push(x); (x.children || []).forEach(anda); }; CAT.formationTree(f.file).roots.forEach(anda);
        try { RO.crescerRoster(sv, path.join(tmp, 'o.bts'), us.map((u, k) => ({ coreId: 90000 + k, val: u.type[0], tab: u.type[1], nome: u.name })), tabela); conferidas++; } catch (e) { maus.push(`${n} ${f.name}: ${e.message.slice(0, 80)}`); }
      }
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  const fora = ['US|Platoon (Mortar [medium])', 'RU|Platoon (Howitzer [heavy])', 'RU|Platoon (Self-Propelled Howitzer [heavy])'];
  for (const k of fora) { const [n, nome] = k.split('|'); const f = CAT.libFormations(n, { specialForces: false }).find((x) => x.name === nome); if (f && CAT.playerCanField(f)) maus.push(`${k} ainda a venda sem bloco`); }
  ok(!maus.length, `(227) blocos sem homens versionados (${Object.keys(tab).length}), no pacote; ${vendidas} formacoes de apoio a venda, ${conferidas} conferidas num save real${maus.length ? ' — ' + maus.slice(0, 4).join('; ') : ''}`);
}

// 228. A LINHA SEM HOMENS QUE O JOGO ESCREVEU ESTRAGADA (08/11, ZZ ART US deu "Out of memory" a 5%). Depois da b10 a linha
//      do pelotao de M777 recusado (core 586) voltou com ~3 MB; a b11 a herdava. A entrega passa a por no lugar uma linha
//      limpa do tipo; o save limpo nao muda.
{
  const RO = await import('../tools/re/roster.mjs'); const F = await import('./src/forge.mjs');
  const SGb = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/';
  const ruim = SGb + 'US BTT10 transition.bts', bom = SGb + 'US BTT9 transition.bts';
  const coreUS = path.join(CAMPAIGNS_DIR, 'US', 'core-force.btt');
  if (fs.existsSync(ruim) && fs.existsSync(bom) && fs.existsSync(coreUS)) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-t228-')); const maus = [];
    try {
      const a = RO.sanearSemHomens(ruim, path.join(tmp, 'a.bts'));
      const t = a.trocadas.find((x) => x.coreId === 586);
      if (!t || t.antes < 1e6 || t.depois > 80) maus.push(`586 nao saneada: ${JSON.stringify(a.trocadas)}`);
      const ra = RO.lerRoster(path.join(tmp, 'a.bts'));
      if (ra.unidades.length !== RO.lerRoster(ruim).unidades.length || ra.total !== 268) maus.push(`linhas/homens: ${ra.unidades.length}/${ra.total}`);
      const b = RO.sanearSemHomens(bom, path.join(tmp, 'b.bts'));
      if (b.trocadas.length || !fs.readFileSync(path.join(tmp, 'b.bts')).equals(fs.readFileSync(bom))) maus.push('o save limpo mudou');
      // pela entrega do app
      const ev = []; const trace = { event: (k, v) => ev.push([k, v]), wrote() {}, read() {} };
      F.syncRosterAttributes({ save: ruim, out: path.join(tmp, 'c.bts'), coreFile: coreUS, trace });
      const { exp } = RO.expandirBloco(RO.localizarRoster(path.join(tmp, 'c.bts')).lz);
      if (exp.length > 200000) maus.push(`a entrega ainda tem ${exp.length} bytes de roster`);
      // desde 13/11 a mesma passada corta a sobra do Shadow (584, 43 -> 39 B): duas linhas trocadas neste save
      if (!ev.some(([k, v]) => k === 'roster.menlessRepaired' && v.lines.some((l) => l.coreId === 586) && v.lines.some((l) => l.coreId === 584 && l.depois === 39) && v.lines.length === 2)) maus.push(`sem o evento roster.menlessRepaired certo: ${JSON.stringify(ev.find(([k]) => k === 'roster.menlessRepaired')?.[1])}`);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    ok(!maus.length, `(228) linha sem homens estragada pelo jogo volta limpa na entrega${maus.length ? ' — ' + maus.join('; ') : ''}`);
  }
}

// 229. O TETO DE LINHAS DO ROSTER (08/11, ZZ ART US): 508 carregam, 509 dao Out of memory. A loja recusa a compra que passa.
//      Desde 10/11 (trimBattle) as linhas de hoje sao as da entrega enxuta — quem entra em campo ou tem homem na linha de um
//      save —, nao o roster inteiro: o Apply da b12 do autor (3 Air Controller + 3 formacoes de aeronaves, 12 linhas) deixou
//      de ser recusado com "516 linhas", e a cotacao avisa do peso do apoio aereo na memoria. Com a regra desligada, a conta
//      de antes.
{
  const C = await import('./src/campaign.mjs'); const CAT = await import('./src/catalog.mjs'); const RO = await import('../tools/re/roster.mjs');
  const maus = []; const R = C.rules(); const Roff = { ...R, trimBattle: { ...(R.trimBattle || {}), on: false } };
  if (R.rosterCap?.max?.US !== 508) maus.push(`teto ${JSON.stringify(R.rosterCap?.max)}`);
  const ck = (n) => C.rosterCapCheck(n, R, 'US').level;
  if (C.rosterCapCheck(800, R, 'UKR').level !== 'ok') maus.push('UKR 800 recusada');
  if (ck(508) !== 'ok' || ck(509) !== 'over') maus.push('fronteira 508/509');
  // o Apply da b10 (o snapshot de antes dele): 502 linhas no roster inteiro
  // sem a campanha US do autor (a copia do empacotador, outra maquina), so as fronteiras acima
  const snap229 = path.join(CAMPAIGNS_DIR, 'US', 'battles', '11', 'undo', 'state.json');
  if (!fs.existsSync(snap229)) ok(!maus.length, `(229) teto de 508 linhas (sem a campanha US local: o snapshot da b11 pulado)${maus.length ? ' — ' + maus.join('; ') : ''}`);
  else {
  const sn = JSON.parse(fs.readFileSync(snap229, 'utf8'));
  const st = { ...sn, credits: 9_999_999, current: { ...sn.current, refit: { ...(sn.current?.refit || {}), rosterLines: 502 } } };
  if (C.rosterLinesOf(st, Roff) !== 502) maus.push(`regra desligada: ${C.rosterLinesOf(st, Roff)} linhas`);
  // enxuta: os presentes (fora os stand-down) mais quem tem homem na linha de um dos saves, contados aqui de novo pelo roster
  const saves = [st.next?.save, st.pending?.savePath, st.current?.playFrom?.file].filter((f) => f && fs.existsSync(f));
  const homens = new Set(saves.flatMap((f) => RO.lerRoster(f).unidades.filter((u) => u.soldados.length > 0).map((u) => u.coreId)));
  const fora = new Set(st.standDown || []);
  const esperado = st.units.filter((u) => (u.present && !fora.has(u.coreId)) || homens.has(u.coreId)).length;
  const presentes = st.units.filter((u) => u.present && !fora.has(u.coreId)).length;
  const hoje = C.rosterLinesOf(st, R);
  if (!saves.length) maus.push('sem save do snapshot para contar');
  else if (hoje !== esperado || hoje >= 200 || hoje < presentes) maus.push(`enxuta hoje ${hoje}, esperado ${esperado} (${presentes} presentes)`);
  const pick = (nome) => { const x = CAT.libFormations('US', { specialForces: false }).find((f) => f.name === nome); const t = CAT.formationTree(x.file); const keys = []; const anda = (n) => { if (!n.isFormation) keys.push(n.key); (n.children || []).forEach(anda); }; t.roots.forEach(anda); return { source: x.file, nation: 'US', points: x.points, keep: keys, xp: {}, extras: [], swaps: [], sf: false }; };
  const tenta = (picks, regras = R) => { try { C.quoteApply(st, { buyFormations: picks }, regras); return 'ok'; } catch (e) { return /roster would have/.test(e.message) ? 'teto' : 'outro: ' + e.message.slice(0, 80); } };
  const tres = [pick('Apache Guardian (AH-64E)'), pick('Apache Guardian (AH-64E [antitank])'), pick('Apache Longbow (AH-64D [antitank])')];
  const morteiro = pick('Section (Mortar [light])');
  // com a regra desligada, a conta de antes: 502 + 6 = 508 passa, 509 e recusado, e a mensagem diz formacao por formacao
  if (tenta(tres, Roff) !== 'ok') maus.push(`508 recusado (regra desligada): ${tenta(tres, Roff)}`);
  if (tenta([...tres, morteiro], Roff) !== 'teto') maus.push(`509 passou (regra desligada): ${tenta([...tres, morteiro], Roff)}`);
  const qoff = C.quoteApply(st, { buyFormations: tres }, Roff).roster;
  if (!qoff || qoff.lines !== 502 || qoff.max !== 508 || qoff.visible !== 501 || qoff.newLines !== 6 || qoff.trimmed || qoff.formations.length !== 3 || !qoff.formations.every((f) => f.lines === 2)) maus.push(`roster na cotacao (regra desligada): ${JSON.stringify(qoff)}`);
  try { C.quoteApply(st, { buyFormations: [...tres, morteiro] }, Roff); maus.push('509 sem recusa (regra desligada)'); } catch (e) { if (!/Section \(Mortar \[light\]\) 1/.test(e.message) || !/6 lines left/.test(e.message) || !/ever had/.test(e.message)) maus.push(`mensagem: ${e.message.slice(0, 160)}`); }
  // enxuta: a compra do autor passa, a cotacao conta as linhas de hoje e as 12 novas, e avisa do apoio aereo
  const doAutor = [pick('Section (Air Controller)'), pick('Section (Air Controller)'), pick('Section (Air Controller)'), pick('Fighting Falcon (F-16CJ [antitank])'), pick('Strike Eagle (F-15E)'), pick('Apache Guardian (AH-64E)')];
  const a = tenta(doAutor);
  if (a !== 'ok') maus.push(`compra do autor recusada: ${a}`);
  const qa = C.quoteApply(st, { buyFormations: doAutor }, R).roster;
  if (!qa || qa.lines !== hoje || qa.max !== 508 || qa.visible !== 501 || qa.newLines !== 12 || !qa.trimmed || qa.formations.length !== 6) maus.push(`roster na cotacao: ${JSON.stringify(qa)}`);
  // (13/11) o aviso de apoio aereo saiu: o peso era o Shadow de 43 B (teste 237); a cotacao nao avisa nada
  if (qa?.airWarning) maus.push('a cotacao ainda avisa do apoio aereo');
  // a dormente paga sem homem na linha volta com linha nova; a que ja lutou nao
  const dorm = st.units.filter((u) => !u.present && !fora.has(u.coreId) && !(st.sold || []).some((s) => s.coreId === u.coreId));
  const semHomem = dorm.find((u) => !homens.has(u.coreId)), comHomem = dorm.find((u) => homens.has(u.coreId));
  if (semHomem && C.quoteApply(st, { purchaseCoreIds: [semHomem.coreId] }, R).roster.newLines !== 1) maus.push('dormente sem homem nao conta linha nova');
  if (comHomem && C.quoteApply(st, { purchaseCoreIds: [comHomem.coreId] }, R).roster.newLines !== 0) maus.push('dormente com homem conta linha nova');
  ok(!maus.length, `(229) teto de 508 linhas; enxuta: snapshot da b11 com ${hoje} linhas de hoje (${presentes} presentes), a compra do autor (12) passa sem aviso; regra desligada: 502, 6 passam e 7 sao recusadas${maus.length ? ' — ' + maus.join('; ') : ''}`);
  }
}

// 230. AS LINHAS QUE O JOGO ENXERGA (08/11, ZZ PROVA AR P): na US a unidade presente alem da linha 501 do roster nao entra.
//      A entrega troca a linha dela com a de uma ausente antes do limite; nada some.
{
  const RO = await import('../tools/re/roster.mjs'); const CAMx = await import('../tools/re/cam.mjs'); const C = await import('./src/campaign.mjs');
  const SGb = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/';
  const sv = SGb + 'US BTT10 transition [B11].bts';
  const maus = [];
  if (C.visibleRosterLines({ nation: 'US' }) !== 501 || C.visibleRosterLines({ nation: 'RU' }) !== 882) maus.push('limite por nacao');
  const coreUS = path.join(CAMPAIGNS_DIR, 'US', 'battles', '11', 'battle.btt');
  if (fs.existsSync(sv) && fs.existsSync(coreUS)) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-t230-'));
    try {
      const pres = new Set((await import('../tools/re/roster_cam.mjs')).unidadesDoCore(coreUS).filter((u) => u.presente).map((u) => u.coreId));
      const o = path.join(tmp, 'o.bts'); RO.presentesNoAlcance(sv, o, coreUS, 501);
      const a = RO.lerRoster(sv), b = RO.lerRoster(o);
      const fora = b.unidades.map((u, k) => ({ u, k })).filter(({ u, k }) => k >= 501 && pres.has(u.coreId));
      if (fora.length) maus.push(`presentes alem do limite: ${fora.map((x) => x.u.coreId).join(',')}`);
      if (a.unidades.length !== b.unidades.length || [...a.unidades.map((u) => u.coreId)].sort().join() !== [...b.unidades.map((u) => u.coreId)].sort().join()) maus.push('linhas mudaram');
      void CAMx;
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  ok(!maus.length, `(230) unidade presente dentro das linhas que o jogo le (US 501)${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 231. O TETO PELO PIOR EXERCITO, PRESENTES DENTRO DO ALCANCE E A CRIACAO (08/11, avaliacao do ajuste das 501 linhas).
//      US+UKR segue o US (508/501); so UKR fica em 882 sem alcance; a loja recusa quando os presentes nao cabem nas 501;
//      a criacao recusa uma forca com mais linhas do que o jogo le.
{
  const C = await import('./src/campaign.mjs'); const CAT = await import('./src/catalog.mjs');
  const R = C.rules(); const maus = [];
  if (C.visibleRosterLines({ armies: ['US', 'UKR'], nation: 'UKR' }) !== 501) maus.push('mista sem alcance do US');
  if (C.visibleRosterLines({ armies: ['UKR'], nation: 'UKR' }) !== 882) maus.push('UKR fora do medido (882)');
  if (C.rosterCapCheck(600, R, ['US', 'UKR']).level !== 'over' || C.rosterCapCheck(600, R, ['UKR']).level !== 'ok') maus.push('teto misto');
  const pick = (n, nome, so1 = false) => { const x = CAT.libFormations(n, { specialForces: false }).find((f) => f.name === nome); const t = CAT.formationTree(x.file); const keys = []; const anda = (q) => { if (!q.isFormation) keys.push(q.key); (q.children || []).forEach(anda); }; t.roots.forEach(anda); return { source: x.file, nation: n, points: x.points, keep: so1 ? keys.slice(0, 1) : keys, xp: {}, extras: [], swaps: [], sf: false }; };
  const snapF = path.join(CAMPAIGNS_DIR, 'US', 'battles', '11', 'undo', 'state.json');
  if (fs.existsSync(snapF)) {
    const sn = JSON.parse(fs.readFileSync(snapF, 'utf8'));
    const base = { ...sn, credits: 9_999_999, current: { ...sn.current, refit: { ...(sn.current?.refit || {}), rosterLines: 502 } } };
    const tenta = (st, picks) => { try { C.quoteApply(st, { buyFormations: picks }, R); return 'ok'; } catch (e) { return /units present and the game only reads/.test(e.message) ? 'alcance' : 'outro: ' + e.message.slice(0, 80); } };
    const a = tenta(base, [pick('US', 'Apache Guardian (AH-64E)')]);
    const cheio = { ...base, units: base.units.map((u) => ({ ...u, present: true })) };   // 502 presentes
    const b = tenta(cheio, [pick('US', 'Apache Guardian (AH-64E)')]);
    if (a !== 'ok') maus.push(`93 presentes recusado: ${a}`);
    if (b !== 'alcance') maus.push(`502 presentes passou: ${b}`);
  }
  // a criacao: formacoes inteiras ate passar de 501 linhas
  const todas = CAT.libFormations('US', { specialForces: false }).filter((f) => f.units > 0 && CAT.playerCanField(f));
  const picks = []; let linhas = 0;
  for (const f of todas) { const p = pick('US', f.name, true); const l = C.priceOfPicks([p], 'US', R)[0].rosterLines || 0; if (linhas + l > 506) continue; picks.push(p); linhas += l; if (linhas > 501) break; }
  let cri = 'ok'; try { C.checkForce(picks, 'US', R, { budget: 1e9, armies: ['US'] }); } catch (e) { cri = /only reads the first/.test(e.message) ? 'alcance' : 'outro: ' + e.message.slice(0, 80); }
  if (linhas <= 501) maus.push(`nao montei forca acima de 501 (${linhas})`);
  else if (cri !== 'alcance') maus.push(`criacao com ${linhas} linhas: ${cri}`);
  ok(!maus.length, `(231) teto e alcance pelo pior exercito; presentes <= 501 na loja; criacao US com ${linhas} linhas recusada${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 232. A REPOSICAO PELO NOME, NAO PELA POSICAO (08/11, US b10 -> b11): a lista de baixas guardada foi lida sem o Su e o Apply
//      com ele; 27 dos 67 indices pagos cairam no vizinho vivo. reindexMen acha cada homem pelo core id e nome no save.
{
  const C = await import('./src/campaign.mjs'); const RO = await import('../tools/re/roster.mjs');
  const resF = path.join(CAMPAIGNS_DIR, 'US', 'battles', '10', 'result.json');
  const sv = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/US BTT10 transition.bts';
  if (fs.existsSync(resF) && fs.existsSync(sv)) {
    const result = JSON.parse(fs.readFileSync(resF, 'utf8'));
    const pagos = [...result.casualtiesToBuy.map((c) => c.index), ...(result.rescued || [])];
    const nomesPagos = [...result.casualtiesToBuy.map((c) => c.name), ...(result.rescued || []).map((i) => { let k = 0; for (const u of result.units) for (const sd of u.soldiers) { if (k === i) return sd.name; k++; } return null; })];
    const r = RO.lerRoster(sv);
    const antes = pagos.filter((i) => r.soldados[i].estado < 2).length;
    const novos = C.reindexMen(sv, result, pagos);
    const depois = novos.filter((i) => r.soldados[i].estado < 2).length;
    const nomesOk = novos.every((j, k) => r.soldados[j].nome === nomesPagos[k]);
    ok(antes > 0 && depois === 0 && nomesOk && novos.length === pagos.length, `(232) reposicao pelo nome: na b10 da US ${antes} dos ${pagos.length} indices guardados (baixas e resgatados) apontavam para homem vivo; depois de reindexMen, ${depois}`);
  }
}

// 233. O EQUIPAMENTO DO HOMEM VOLTA A FABRICA (08/11, autor: Scout Platoon HQ da b11 sem binoculo, laser e NV). O jogo
//      tira do homem que cai a arma e o equipamento; o reset devolvia so a arma. Sobre a b11 da US (60 homens assim):
//      (a) o plano acende NV/laser/chefia de fabrica (Heffner +7 -> c8, +8 -> 80) e devolve a chefia da LRS #1 as vagas
//      0 e 3, tirando-a da 5; (b) depois do refitSave nenhum homem de pe foge da fabrica e um segundo plano nao tem byte;
//      (c) o item do kit manda por cima da fabrica (demo:4 e laser em vaga que nao os tem), e sem o item volta a fabrica;
//      (d) nenhum bit fora de 0xc8/0x98 e tocado, nunca o 0x20.
{
  const RO = await import('../tools/re/roster.mjs');
  const sv = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/US BTT10 transition [B11].bts';
  const fab = factoryTable();
  if (fs.existsSync(sv) && fab?.tipos) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-equip-')); const maus = [];
    try {
      const src = path.join(tmp, 'in.bts'); fs.copyFileSync(sv, src);
      const armies = armiesOfSave(src); const ro = RO.lerRoster(src); const caudas = RO.caudasDoRoster(src);
      const plano = resetPlan(src, fab, { armies, weapons: weaponTable() });
      const n = Object.keys(plano.bytes).length;
      if (n < 50 || plano.equip.nv < 50 || plano.equip.laser < 3 || plano.equip.chefia < 10) maus.push(`plano fraco: ${n} homens ${JSON.stringify(plano.equip)}`);
      const hef = ro.soldados.findIndex((s) => s.nome === 'Heffner'); const bh = plano.bytes[hef];
      if (!bh || (bh.to[0] & 0xc8) !== 0xc8 || bh.to[1] !== 0x80) maus.push(`Heffner: ${bh ? bh.from.map((x) => x.toString(16)) + ' -> ' + bh.to.map((x) => x.toString(16)) : 'sem bytes'}`);
      const lrs = ro.unidades.find((u) => u.coreId === 6);
      const alvo7 = (k) => { const i = lrs.soldados[k].indice; return plano.bytes[i] ? plano.bytes[i].to[0] : caudas[i].cauda[7]; };
      if (!(alvo7(0) & 0x80) || !(alvo7(3) & 0x80) || (alvo7(5) & 0x80)) maus.push(`LRS #1 chefia: ${[0, 1, 2, 3, 4, 5].map((k) => (alvo7(k) & 0xc0).toString(16)).join(',')}`);
      for (const b of Object.values(plano.bytes)) { if (((b.ligar7 || 0) | (b.desligar7 || 0)) & ~0xc8) maus.push(`bit de +7 fora de 0xc8 em ${b.name}`); if (Number.isInteger(b.mais8) && ((b.mais8 ^ b.from[1]) & ~0x98)) maus.push(`bit de +8 fora de 0x98 em ${b.name}`); }
      // (b) pela entrega
      const trace = new Trace(path.join(tmp, 'log.jsonl'), { slug: 'teste', battle: 0 });
      const out = refitSave({ save: src, workDir: path.join(tmp, 'w'), tag: 'T', R, trace, armies });
      const ro2 = RO.lerRoster(out), c2 = RO.caudasDoRoster(out); let fora = 0;
      for (const u of ro2.unidades) { const row = fab.tipos[`${armies.get(u.coreId)}|${u.tipo}`]; if (!row) continue; u.soldados.forEach((s, k) => { const v = row.vagas[k]; if (!v?.equip || s.estado > 1) return; const b7 = c2[s.indice].cauda[7], b8 = c2[s.indice].cauda[8]; if ((v.equip.nv && !(b8 & 0x80)) || (v.equip.laser && !(b7 & 0x08)) || ((b7 & 0xc0) !== (v.lider ?? (v.equip.binoculo ? 0x80 : 0)))) fora++; }); }
      if (fora) maus.push(`${fora} homens fora da fabrica depois do refit`);
      const resto = resetPlan(out, fab, { armies, weapons: weaponTable() });
      if (Object.keys(resto.bytes).length) maus.push(`segundo plano com ${Object.keys(resto.bytes).length} bytes`);
      // (c) o kit por cima da fabrica: um homem de pe cuja vaga nao tem demo nem laser
      const alvo = ro.unidades.flatMap((u) => u.soldados.map((s, k) => ({ u, s, k }))).find((o) => { const row = fab.tipos[`${armies.get(o.u.coreId)}|${o.u.tipo}`]; const v = row?.vagas?.[o.k]; return v?.equip && !v.equip.demo && !v.equip.laser && o.s.estado <= 1 && caudas[o.s.indice].cauda.length > 8; });
      if (alvo) {
        const pk = resetPlan(src, fab, { armies, weapons: weaponTable(), keepKit: { [alvo.u.coreId]: { [alvo.k]: 'demo:4' } } });
        const bk = pk.bytes[alvo.s.indice]; if (!bk || (bk.to[1] & 0x18) !== 0x10) maus.push(`demo:4 do kit nao entrou (${alvo.s.nome})`);
        const pl = resetPlan(src, fab, { armies, weapons: weaponTable(), keepKit: { [alvo.u.coreId]: { [alvo.k]: 'laser' } } });
        const bl = pl.bytes[alvo.s.indice]; if (!bl || !(bl.to[0] & 0x08)) maus.push(`laser do kit nao entrou (${alvo.s.nome})`);
        const p0 = resetPlan(src, fab, { armies, weapons: weaponTable() }); const b0 = p0.bytes[alvo.s.indice];
        const to8 = b0 ? b0.to[1] : caudas[alvo.s.indice].cauda[8], to7 = b0 ? b0.to[0] : caudas[alvo.s.indice].cauda[7];
        if ((to8 & 0x18) || (to7 & 0x08)) maus.push(`sem o item, ${alvo.s.nome} ficou com demo/laser`);
      } else maus.push('sem homem para a prova do kit');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    ok(!maus.length, `(233) equipamento do homem de volta a fabrica na b11 da US${maus.length ? ' — ' + maus.join('; ') : ''}`);
  }
}

// 234. O CHECKLIST DOS JOBS (08/11, autor: "fica carregando sem dar nenhum feedback; outros usuarios podem achar que e
//      erro"). (a) jobs: a etapa planejada fica pending, a que roda running, a fechada done com ms; a que nao rodou some no
//      fim; a que lanca fica failed; `await note()` cede a vez (um setImmediate de fora roda antes do fim). (b) a leitura
//      de um save real (a b10 da US, relida numa copia da campanha) passa pelas 8 etapas, em ordem.
{
  const J = await import('./src/jobs.mjs'); const C = await import('./src/campaign.mjs');
  const maus = []; const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  let deFora = false;
  const j1 = J.start('t234', async (note) => {
    note.plan(['um', 'dois', 'tres', 'nunca']);
    await note('um'); setImmediate(() => { deFora = true; }); await note('dois');
    if (!deFora) maus.push('o note nao cedeu a vez');
    await espera(15); await note('tres'); return 42;
  });
  while (j1.state === 'running') await espera(5);
  const est = j1.steps.map((s) => `${s.step}:${s.state}`).join(',');
  if (est !== 'um:done,dois:done,tres:done' || !j1.steps.every((s) => Number.isFinite(s.ms)) || j1.result !== 42) maus.push(`job ok: ${est}`);
  const j2 = J.start('t234b', async (note) => { note.plan(['a', 'b']); await note('a'); throw new Error('quebrou'); });
  while (j2.state === 'running') await espera(5);
  if (j2.steps.map((s) => `${s.step}:${s.state}`).join(',') !== 'a:failed' || j2.state !== 'failed') maus.push(`job falho: ${j2.steps.map((s) => s.step + ':' + s.state).join(',')}`);
  // (b) a leitura com etapas, numa copia da US no Apply da b10 (o snapshot de antes dele)
  const snap = path.join(CAMPAIGNS_DIR, 'US', 'battles', '11', 'undo', 'state.json');
  const sv = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/US BTT10 transition.bts';
  let etapas = 'pulado';
  if (fs.existsSync(snap) && fs.existsSync(sv)) {
    const slug = 'ZZ-T234'; const pasta = C.dirOf(slug);
    try {
      fs.rmSync(pasta, { recursive: true, force: true });
      fs.mkdirSync(path.join(pasta, 'battles', '10'), { recursive: true });
      const st = JSON.parse(fs.readFileSync(snap, 'utf8')); st.slug = slug; delete st.pending; st.stage = 'play';
      fs.writeFileSync(path.join(pasta, 'state.json'), JSON.stringify(st));
      const vistos = []; const note = (s) => { vistos.push(s); return Promise.resolve(); }; note.plan = () => {};
      const s = await C.readSaveWithSteps(slug, sv, {}, note);
      etapas = vistos.join(' > ');
      if (vistos.join('|') !== C.READ_STEPS.join('|') || s.stage !== 'result' || s.pending?.result?.battle !== 10) maus.push(`leitura: ${etapas} (stage ${s.stage})`);
    } catch (e) { maus.push('leitura: ' + e.message.slice(0, 120)); } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
  }
  ok(!maus.length, `(234) checklist dos jobs e as 8 etapas da leitura${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 235. O ROSTER QUE O JOGO GRAVOU ALEM DO QUE LE (08/11, US b11): depois da b11 duas dormentes (534, 574) sumiram e veio
//      uma linha-lixo de 60,8 MB. restaurarLinhas, contra a forca e o save entregue antes: 504 linhas, as duas de volta,
//      o lixo fora, roster de tamanho normal; e o sanear nao tem mais nada a fazer.
{
  const RO = await import('../tools/re/roster.mjs');
  const SGb = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/';
  const sv = SGb + 'US BTT11 transition.bts', ant = SGb + 'US BTT10 transition [B11].bts';
  // a forca de ANTES do Apply da b12 (o ponto de volta): a de hoje ja tem as aeronaves compradas, sem linha em save nenhum
  const coreUS = [path.join(CAMPAIGNS_DIR, 'US', 'battles', '12', 'undo', 'core-force.btt'), path.join(CAMPAIGNS_DIR, 'US', 'core-force.btt')].find((f) => fs.existsSync(f));
  if (fs.existsSync(sv) && fs.existsSync(ant) && coreUS) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-t235-')); const maus = [];
    try {
      const o = path.join(tmp, 'o.bts');
      const r = RO.restaurarLinhas(sv, o, coreUS, ant);
      const ro = RO.lerRoster(o); const ids = new Set(ro.unidades.map((u) => u.coreId));
      if (ro.unidades.length !== 504 || !ids.has(534) || !ids.has(574) || ids.has(1643286)) maus.push(`linhas ${ro.unidades.length}, 534 ${ids.has(534)}, 574 ${ids.has(574)}`);
      const { exp } = RO.expandirBloco(RO.localizarRoster(o).lz);
      if (exp.length > 200000) maus.push(`roster com ${exp.length} B`);
      // desde 13/11 o sanear ainda corta a sobra do Shadow (584, 43 -> 39 B); nada alem disso
      const san = RO.sanearSemHomens(o, path.join(tmp, 's.bts')).trocadas;
      if (san.some((t) => t.coreId !== 584)) maus.push(`sobrou linha estragada: ${JSON.stringify(san)}`);
      const s2 = RO.restaurarLinhas(o, path.join(tmp, 'o2.bts'), coreUS, ant);
      if (s2.removidas.length || s2.restauradas.length || s2.trocadas.length) maus.push('segunda passada mexeu');
      if (!r.removidas.some((x) => x.coreId === 1643286)) maus.push('lixo nao removido');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    ok(!maus.length, `(235) roster que o jogo gravou alem do que le, restaurado do save anterior${maus.length ? ' — ' + maus.join('; ') : ''}`);
  }
}

// 236. A BATALHA SO COM QUEM PODE ENTRAR (10/11, bateria do limite da US: o teto e memoria de 32 bits, e unidade ausente na
//      batalha pesa ~2 MB). Sobre a b12 real da US e a transicao da b11: as ausentes sem homem na linha saem da batalha
//      (remover.mjs) e do roster (restaurarLinhas com `fora`); batalha e roster batem um a um; ninguem com homem sai. E a
//      cauda minima que o jogo grava depois de um roster enxuto (`N = 1 | 0`, ZZ B2 TRANSITION) e achada.
{
  const RO = await import('../tools/re/roster.mjs'); const RC = await import('../tools/re/roster_cam.mjs'); const RM = await import('../tools/re/remover.mjs');
  const maus = [];
  // a cauda minima, num roster sintetico: lista que acaba em `01 00 00 00 | 00 00 00 00`
  const ex = Buffer.concat([Buffer.alloc(40, 7), Buffer.from([1, 0, 0, 0, 0, 0, 0, 0])]);
  if (RO.inicioDaCauda(ex) !== 40) maus.push(`cauda minima: ${RO.inicioDaCauda(ex)}`);
  const ex2 = Buffer.concat([Buffer.alloc(40, 7), Buffer.from([2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0])]);
  if (RO.inicioDaCauda(ex2) !== 40) maus.push(`cauda minima com uma batalha: ${RO.inicioDaCauda(ex2)}`);
  const SGb = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/';
  const sv = SGb + 'US BTT11 transition.bts', ant = SGb + 'US BTT10 transition [B11].bts';
  // a forca de antes do Apply da b12 (a de hoje tem as aeronaves compradas, sem linha em save nenhum) e a batalha da b11, que
  // ainda tem as 504 unidades (a b12 entregue ja saiu enxuta: nao serve para provar a remocao)
  const coreUS = [path.join(CAMPAIGNS_DIR, 'US', 'battles', '12', 'undo', 'core-force.btt'), path.join(CAMPAIGNS_DIR, 'US', 'core-force.btt')].find((f) => fs.existsSync(f));
  const b12 = path.join(CAMPAIGNS_DIR, 'US', 'battles', '11', 'battle.btt');
  if (coreUS && [sv, ant, b12].every((f) => fs.existsSync(f))) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-t236-'));
    try {
      const { exp } = RO.expandirBloco(RO.localizarRoster(sv).lz);
      if (RO.inicioDaCauda(exp) === null) maus.push('cauda longa da US nao achada');
      const homens = new Map(RO.lerRoster(sv).unidades.map((u) => [u.coreId, u.soldados.length]));
      const homensAnt = new Map(RO.lerRoster(ant).unidades.map((u) => [u.coreId, u.soldados.length]));
      const vazia = (id) => (homens.has(id) ? homens.get(id) === 0 : !(homensAnt.get(id) > 0));
      const alvo = RC.unidadesDoCore(b12).filter((u) => !u.presente && vazia(u.coreId)).map((u) => u.coreId);
      const bt = path.join(tmp, 'b.btt');
      const r = RM.removerUnidades(b12, bt, alvo);
      if (r.unidades < 350 || !r.lado) maus.push(`tiradas ${r.unidades} do lado ${r.lado}`);
      if (r.tiradas.some((id) => homens.get(id) > 0)) maus.push('saiu unidade com homem');
      const o = path.join(tmp, 'o.bts');
      const rr = RO.restaurarLinhas(sv, o, coreUS, ant, { fora: r.tiradas });
      const linhas = new Set(RO.lerRoster(o).unidades.map((u) => u.coreId));
      const naBatalha = new Set(RC.unidadesDoCore(bt).map((u) => u.coreId));
      const semLinha = [...naBatalha].filter((id) => !linhas.has(id)), orfas = [...linhas].filter((id) => !naBatalha.has(id));
      if (semLinha.length || orfas.length) maus.push(`sem linha ${semLinha.slice(0, 5)}; orfas ${orfas.slice(0, 5)}`);
      if (rr.restauradas.length || rr.removidas.some((x) => x.coreId !== 1643286)) maus.push(`restaurou ${rr.restauradas} / removeu ${rr.removidas.map((x) => x.coreId)}`);
      if (linhas.size > 120) maus.push(`${linhas.size} linhas`);
      const pres = RC.unidadesDoCore(b12).filter((u) => u.presente).map((u) => u.coreId);
      if (pres.some((id) => !naBatalha.has(id))) maus.push('presente saiu da batalha');
    } catch (e) { maus.push(e.message.slice(0, 160)); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  ok(!maus.length, `(236) a batalha so com quem pode entrar: ausentes sem homem fora da batalha e do roster, um a um; cauda minima achada${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 237. O SHADOW DE 43 BYTES (13/11, US b12: Out of memory com qualquer compra de aviacao). O molde do .cam do RQ-7B tem 43 B
//      e o app o escreveu no roster na b10; o jogo le o roster em cadeia e tudo depois dele vinha deslocado. Provado em
//      jogo: a [B12] com so essa linha cortada para 39 B carregou com 2.473 MB (o save que o jogo montou, 2.465). O
//      saneamento corta os zeros que sobram depois do fecho `ff ff` + 6 zeros da peca fora do mapa; o crescimento escreve
//      a aeronave ou drone sem bloco colhido com o bloco de 39 B da familia; nenhuma linha dos saves do jogo muda.
{
  const RO = await import('../tools/re/roster.mjs');
  const maus = [];
  const shadow = Buffer.from('1c0100000a0200000001040102020005040300000000000000000001010000ffff00000000000000000000', 'hex');
  const cortada = RO.cortarSobraSemHomens(shadow);
  if (!cortada || cortada.length !== 39 || RO.linhaSemHomensLimpa(shadow) || !RO.linhaSemHomensLimpa(cortada)) maus.push(`corte: ${cortada?.toString('hex')}`);
  const fam = RO.blocoDaFamilia(522);
  if (!fam || fam.length !== 39 || fam.readUInt16LE(4) !== 522 || !RO.linhaSemHomensLimpa(fam)) maus.push(`bloco da familia: ${fam?.toString('hex')}`);
  if (RO.blocoDaFamilia(0x0909)) maus.push('artilharia sem bloco colhido nao pode vir da familia');
  const SGb = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/';
  const b12 = SGb + 'US BTT11 transition [B12].bts';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-t237-'));
  try {
    if (fs.existsSync(b12)) {
      const r = RO.sanearSemHomens(b12, path.join(tmp, 'a.bts'));
      if (r.trocadas.length && !(r.trocadas.length === 1 && r.trocadas[0].coreId === 584 && r.trocadas[0].depois === 39)) maus.push(`b12: ${JSON.stringify(r.trocadas)}`);
      if (RO.sanearSemHomens(path.join(tmp, 'a.bts'), path.join(tmp, 'b.bts')).trocadas.length) maus.push('a segunda passada mexeu');
    }
    for (const f of ['Village-Water 001.bts', 'ZZ TRIM3 TRANSITION.bts', 'ZZ B2 TRANSITION.bts']) {
      if (!fs.existsSync(SGb + f)) continue;
      const r = RO.sanearSemHomens(SGb + f, path.join(tmp, 'c.bts'));
      if (r.trocadas.length) maus.push(`${f} mudou: ${JSON.stringify(r.trocadas)}`);
    }
  } catch (e) { maus.push(e.message.slice(0, 160)); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  ok(!maus.length, `(237) a peca fora do mapa fecha em ff ff + 6 zeros: o Shadow de 43 B volta a 39, o drone sem bloco colhido usa o da familia, saves do jogo intactos${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 238. O RESUMO COM AS ETAPAS (14/11, autor: a aba Outcome ficava um minuto em "Reading the campaign..."). Numa copia de uma
//      campanha local com historico: campaignSummaryWithSteps devolve o mesmo que campaignSummary, anota uma linha por
//      batalha com save, grava summary.json; a segunda chamada vem do cache numa etapa so; mexer no state.json invalida.
{
  const C = await import('./src/campaign.mjs');
  const maus = []; let info = 'sem campanha local com historico (pulado)';
  const dir = path.join(CAMPAIGNS_DIR);
  const cands = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((d) => !/^ZZ-/.test(d)).map((d) => { try { return { d, h: (JSON.parse(fs.readFileSync(path.join(dir, d, 'state.json'), 'utf8')).history || []).length }; } catch { return null; } }).filter((x) => x && x.h >= 2).sort((a, b) => a.h - b.h);
  if (cands.length) {
    const orig = cands[0].d, slug = 'ZZ-T238-RESUMO', dest = path.join(dir, slug);
    fs.rmSync(dest, { recursive: true, force: true });
    try {
      fs.mkdirSync(dest, { recursive: true });
      fs.copyFileSync(path.join(dir, orig, 'state.json'), path.join(dest, 'state.json'));
      const bt = path.join(dir, orig, 'battles');
      for (const n of fs.existsSync(bt) ? fs.readdirSync(bt) : []) for (const f of ['result.json', 'spec.json']) {
        const p = path.join(bt, n, f); if (!fs.existsSync(p)) continue;
        fs.mkdirSync(path.join(dest, 'battles', n), { recursive: true }); fs.copyFileSync(p, path.join(dest, 'battles', n, f));
      }
      const passos = []; const note = async (s) => { passos.push(s); }; note.plan = () => {};
      const a = await C.campaignSummaryWithSteps(slug, note);
      const b = C.campaignSummary(slug);
      if (JSON.stringify(a) !== JSON.stringify(b)) maus.push('o resumo com etapas difere do sincrono');
      const st = C.loadState(slug); const comSave = (st.history || []).filter((h) => h.save && fs.existsSync(h.save)).length;
      if (passos.filter((p) => /^Battle \d+.*kills and leaders$/.test(p)).length !== comSave) maus.push(`linhas de batalha ${passos.length} para ${comSave} saves`);
      if (!fs.existsSync(path.join(dest, 'summary.json'))) maus.push('sem summary.json');
      const p2 = []; const n2 = async (s) => { p2.push(s); }; n2.plan = () => {};
      const c = await C.campaignSummaryWithSteps(slug, n2);
      if (p2.join() !== 'Reading the saved summary' || JSON.stringify(c) !== JSON.stringify(a)) maus.push(`segunda chamada: ${p2.join(' | ')}`);
      const sf = path.join(dest, 'state.json'); const t = new Date(Date.now() + 5000); fs.utimesSync(sf, t, t);
      const p3 = []; const n3 = async (s) => { p3.push(s); }; n3.plan = () => {};
      await C.campaignSummaryWithSteps(slug, n3);
      if (p3.includes('Reading the saved summary')) maus.push('o cache nao caiu com o state.json mexido');
      info = `copia de ${orig}: ${st.history.length} batalhas, ${comSave} saves lidos, ${passos.length} etapas; cache na segunda`;
    } catch (e) { maus.push(e.message.slice(0, 160)); } finally { fs.rmSync(dest, { recursive: true, force: true }); }
  }
  ok(!maus.length, `(238) resumo da campanha com uma etapa por batalha e cache: ${info}${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 239. O CARROSSEL DAS BATALHAS (14/11, autor): a aba Outcome mostra o mapa tatico de cada batalha com Victory / Draw /
//      Defeat e os kills e perdas. mapImage da camada 'tactical' de um no jogado: o PNG 952x350 do briefing ou, sem ele, o
//      terreno; a rota aceita 'tactical'; a pagina tem o carrossel e nao tem mais as barras.
{
  const C = await import('./src/campaign.mjs'); const IM = await import('./src/imagem.mjs');
  const maus = []; let info = 'sem campanha local com caminho (pulado)';
  const dir = path.join(CAMPAIGNS_DIR);
  const slug = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((d) => !/^ZZ-/.test(d)).find((d) => { try { const st = JSON.parse(fs.readFileSync(path.join(dir, d, 'state.json'), 'utf8')); return st.path && (st.history || []).some((h) => h.node); } catch { return false; } });
  if (slug) {
    const st = C.loadState(slug); let taticos = 0, terrenos = 0;
    for (const h of (st.history || []).filter((x) => x.node)) {
      try {
        const t = C.mapImage(slug, h.node, 'tactical'), p = IM.lerPng(t);
        if (p.w === 952 && p.h === 350) taticos++;
        else if (t.equals(C.mapImage(slug, h.node, 'terrain'))) terrenos++;
        else maus.push(`B${h.n}: ${p.w}x${p.h} nem tatico nem terreno`);
      } catch (e) { maus.push(`B${h.n}: ${e.message.slice(0, 80)}`); }
    }
    if (!taticos) maus.push('nenhum mapa tatico');
    info = `${slug}: ${taticos} taticos, ${terrenos} no terreno`;
  }
  const srv = fs.readFileSync(path.join(import.meta.dirname, 'server.mjs'), 'utf8');
  if (!/terrain\|zones\|tactical/.test(srv)) maus.push('a rota nao aceita tactical');
  const js = fs.readFileSync(path.join(import.meta.dirname, 'web', 'app.js'), 'utf8');
  if (!/battle-reel/.test(js) || !/'Victory'/.test(js) || !/'Defeat'/.test(js) || !/'Draw'/.test(js) || /battle-bars/.test(js)) maus.push('a pagina sem o carrossel (ou ainda com as barras)');
  ok(!maus.length, `(239) carrossel das batalhas com o mapa tatico: ${info}${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 240. A COTACAO NAO LE O .CAM (14/11, autor: Apply e Save diagnostics mudos na UKR, o servidor a 100% preso em
//      lerRoster sobre o .cam do playFrom). unitsWithMen com um .cam em playFrom.file volta na hora, sem ele; e a cotacao
//      de uma campanha local com resultado esperando e playFrom de campanha sai em segundos.
{
  const C = await import('./src/campaign.mjs');
  const maus = []; let info = '';
  const dir = path.join(CAMPAIGNS_DIR);
  const cam = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).map((d) => path.join(dir, d, 'campaign.cam')).find((f) => fs.existsSync(f));
  if (cam) {
    const t = Date.now(); const ids = C.unitsWithMen({ current: { playFrom: { kind: 'campaign', file: cam } } });
    if (ids.size) maus.push(`o .cam deu ${ids.size} unidades com homens`);
    info += `.cam em ${Date.now() - t} ms`;
  } else info += 'sem .cam local';
  const slug = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((d) => !/^ZZ-/.test(d)).find((d) => { try { const st = JSON.parse(fs.readFileSync(path.join(dir, d, 'state.json'), 'utf8')); return st.stage === 'result' && st.pending && st.current?.playFrom?.kind === 'campaign'; } catch { return false; } });
  if (slug) {
    const t = Date.now();
    try { C.quoteApply(C.loadState(slug), {}); } catch (e) { if (!/refus|budget|choose/i.test(e.message)) maus.push(`cotacao: ${e.message.slice(0, 80)}`); }
    const ms = Date.now() - t; if (ms > 15000) maus.push(`cotacao em ${ms} ms`);
    info += `; cotacao ${slug} em ${ms} ms`;
  }
  ok(!maus.length, `(240) a cotacao so le save .bts: ${info}${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 241. A PASTA DE DADOS (14/11, autor: o pacote para a comunidade). settings.json e as campanhas moram fora da pasta do
//      app (%LOCALAPPDATA%\CMBS Roguelike), salvo num checkout (tem .git) ou com a pasta antiga presente; CMBS_DATA_DIR
//      manda sobre as duas. Num processo filho, porque a regra e decidida uma vez, na importacao.
{
  const maus = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-dados-'));
  const meu = path.join(import.meta.dirname, 'settings.json');
  const antes = fs.existsSync(meu) ? fs.statSync(meu).mtimeMs : null;
  const ler = (env) => {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', "const s = await import('./src/settings.mjs'); console.log(JSON.stringify({ u: s.USER_DIR, f: s.SETTINGS_FILE, c: s.CAMPAIGNS_DIR, p: s.PORTABLE, d: s.current().dataDir }));"],
      { cwd: import.meta.dirname, encoding: 'utf8', env, timeout: 60000 });
    try { return JSON.parse(r.stdout.trim().split('\n').pop()); } catch { maus.push(`filho: ${(r.stderr || r.stdout || '').slice(0, 200)}`); return {}; }
  };
  try {
    const comVar = ler({ ...process.env, CMBS_DATA_DIR: tmp });
    if (path.resolve(comVar.u || '') !== path.resolve(tmp)) maus.push(`com CMBS_DATA_DIR: ${comVar.u}`);
    if (comVar.p !== false) maus.push('com CMBS_DATA_DIR ainda portatil');
    if (path.dirname(comVar.f || '') !== path.resolve(tmp) || path.dirname(comVar.c || '') !== path.resolve(tmp) || comVar.d !== comVar.u) maus.push(`settings/campaigns fora da pasta: ${comVar.f} ${comVar.c}`);
    if (!fs.existsSync(path.join(tmp, 'settings.json'))) maus.push('settings.json nao foi gravado na pasta de dados');
    if (fs.existsSync(path.join(tmp, 'campaigns'))) maus.push('a importacao criou campaigns/ (so a primeira campanha cria)');
    // sem a variavel, so num checkout: na copia do empacotador (sem .git) o filho gravaria no %LOCALAPPDATA% de quem roda
    if (fs.existsSync(path.join(import.meta.dirname, '..', '.git'))) {
      const env = { ...process.env }; delete env.CMBS_DATA_DIR;
      const sem = ler(env);
      if (sem.p !== true || path.resolve(sem.u || '') !== path.resolve(import.meta.dirname)) maus.push(`no checkout sem a variavel: portatil=${sem.p} ${sem.u}`);
    }
    const depois = fs.existsSync(meu) ? fs.statSync(meu).mtimeMs : null;
    if (antes !== null && depois !== antes) maus.push('o app/settings.json do autor mudou');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  ok(!maus.length, `(241) a pasta de dados: CMBS_DATA_DIR manda, o checkout e portatil, nada escrito no app/${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 242. UMA VERSAO SO (14/11): APP_VERSION de pacote.mjs no /api/status, no banner, no diagnostico e no nome do pacote; o nivel
//      da API do servidor igual ao que a pagina espera.
{
  const maus = [];
  const { APP_VERSION } = await import('./src/pacote.mjs');
  if (!/^\d+\.\d+\.\d+$/.test(APP_VERSION || '')) maus.push(`versao "${APP_VERSION}"`);
  const srv = fs.readFileSync(path.join(import.meta.dirname, 'server.mjs'), 'utf8');
  const js = fs.readFileSync(path.join(import.meta.dirname, 'web', 'app.js'), 'utf8');
  const camp = fs.readFileSync(path.join(import.meta.dirname, 'src', 'campaign.mjs'), 'utf8');
  const html = fs.readFileSync(path.join(import.meta.dirname, 'web', 'index.html'), 'utf8');
  if (!/version: APP_VERSION/.test(srv) || !/CMBS Roguelike \$\{APP_VERSION\}/.test(srv)) maus.push('o servidor nao diz a versao');
  const nivel = srv.match(/const API_LEVEL = (\d+);/)?.[1], espera = js.match(/const API_EXPECTED = (\d+);/)?.[1];
  if (!nivel || nivel !== espera) maus.push(`API_LEVEL ${nivel} e API_EXPECTED ${espera}`);
  if (!/app: \{ version: APP_VERSION/.test(camp)) maus.push('o diagnostico sem a versao');
  if (!html.includes('id="start-version"') || !html.includes('id="about-version"')) maus.push('a pagina sem o lugar da versao');
  // a ultima linha do banner e a "open :" (o lancador abre a janela nela, a prova do empacotador espera por ela)
  const banner = srv.slice(srv.indexOf('server.listen(PORT'));
  const logs = [...banner.matchAll(/console\.log\(`([^`]*)`\)/g)].map((m) => m[1]);
  if (!/^ {2}open {7}: /.test(logs.at(-1) || '')) maus.push(`a ultima linha do banner: "${logs.at(-1)}"`);
  if (!srv.includes('`  Port ${PORT} is already in use.`')) maus.push('a linha do EADDRINUSE que o lancador procura mudou');
  ok(!maus.length, `(242) uma versao so (${APP_VERSION}) no servidor, no diagnostico e na pagina; API ${nivel}; banner termina no open${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 243. O ICONE DO LANCADOR (14/11): app/launcher/launcher.ico e o que tools/lancador/icone.mjs faz do logo170.bmp, byte a
//      byte; 4 imagens de 32 bits com a altura dobrada no cabecalho e os offsets em sequencia ate o fim do arquivo.
{
  const maus = [];
  const I = await import('../tools/lancador/icone.mjs');
  const salvo = fs.existsSync(I.ICONE) ? fs.readFileSync(I.ICONE) : null;
  if (!salvo) maus.push('app/launcher/launcher.ico ausente');
  else {
    if (!I.gerarIco().equals(salvo)) maus.push('o .ico salvo nao e o que o gerador faz hoje (node tools/lancador/icone.mjs)');
    const ico = I.lerIco(salvo);
    if (ico.reservado !== 0 || ico.tipo !== 1 || ico.n !== I.TAMANHOS.length) maus.push(`cabecalho ${JSON.stringify(ico)}`);
    let pos = 6 + 16 * ico.n;
    for (const e of ico.entradas) {
      if (e.bpp !== 32 || e.biSize !== 40 || e.biW !== e.w || e.biH !== 2 * e.h || e.off !== pos) maus.push(`entrada ${e.w}: ${JSON.stringify(e)}`);
      pos += e.bytes;
    }
    if (pos !== salvo.length) maus.push(`as imagens terminam em ${pos}, o arquivo em ${salvo.length}`);
  }
  ok(!maus.length, `(243) o icone do lancador: ${I.TAMANHOS.join('/')} px do logo, deterministico${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 244. O LANCADOR COMPILA SEM CONSOLE (14/11): o csc.exe do Windows compila app/launcher/Launcher.cs num executavel de
//      subsistema 2 (GUI); os atributos nao levam empresa nem copyright; o fonte cumpre os contratos com o servidor (a
//      linha "open :", a do EADDRINUSE, o /api/quit). Sem csc (fora do Windows), pulado.
{
  const L = await import('../tools/lancador/compilar.mjs');
  const maus = []; let info = '';
  const cs = fs.readFileSync(L.FONTE, 'utf8');
  for (const [o, que] of [[/open\\s\+:\\s\+\(http/, 'a linha open'], [/Port \(\\d\+\) is already in use/, 'o EADDRINUSE'], [/\/api\/quit/, 'o quit'], [/\/api\/status/, 'o status'],
    // 15/11: o .exe de outra pasta (a versao nova) fecha a que esta rodando e sobe, sem perguntar (autor)
    [/another copy is running .*quitting it to start/, 'a troca de versao sem pergunta'],[/places\.ExeDir \+ "\\r\\n" \+ Program\.Version\(\)/, 'a pasta e a versao no launcher.url']]) if (!o.test(cs)) maus.push(`Launcher.cs sem ${que}`);
  if ([...cs].some((c) => c.charCodeAt(0) > 127)) maus.push('Launcher.cs com caractere fora do ASCII (o csc le sem BOM na pagina de codigo do sistema)');
  const ai = L.assemblyInfo('1.2.3');
  if (/AssemblyCompany|AssemblyCopyright/.test(ai) || !ai.includes('AssemblyVersion("1.2.3.0")')) maus.push('AssemblyInfo');
  if (!L.acharCsc()) info = 'sem csc.exe (pulado)';
  else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-lanc-'));
    try {
      const r = L.compilarLancador({ saida: path.join(tmp, L.NOME_EXE) });
      if (r.subsistema !== 2) maus.push(`subsistema ${r.subsistema}`);
      if (r.bytes > 300 * 1024) maus.push(`${r.bytes} bytes`);
      if (r.avisos) maus.push(`avisos do csc: ${r.avisos.slice(0, 200)}`);
      info = `${Math.round(r.bytes / 1024)} KB, subsistema ${r.subsistema}`;
    } catch (e) { maus.push(e.message.slice(0, 300)); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  ok(!maus.length, `(244) o lancador compila como GUI: ${info}${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 247. A VARREDURA LE O BINARIO TAMBEM EM UTF-16 (14/11): o lancador .NET guarda as literais em UTF-16, que a leitura em
//      latin1 nao casava. Um nome em UTF-16, em posicao impar, num .bin e achado; o mesmo arquivo lido so em latin1 nao.
{
  const P = await import('../tools/privacidade.mjs');
  const maus = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-priv-'));
  try {
    const bytes = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90]), Buffer.from('Zebulon Quartzmann', 'utf16le'), Buffer.from([0, 0])]);
    fs.writeFileSync(path.join(tmp, 'x.bin'), bytes);
    const pads = [['nome', /\bZebulon\b/g]];
    const achou = P.varrerPasta(tmp, ['x.bin'], { binarios: true, pads });
    if (!achou.some((a) => a.utf16)) maus.push('o nome em UTF-16 passou');
    if (P.varrerTexto(bytes.toString('latin1'), pads).length) maus.push('a amostra ja casava em latin1 (o teste nao prova nada)');
    if (P.varrerPasta(tmp, ['x.bin'], { binarios: true, pads: [['nome', /\bAusente\b/g]] }).length) maus.push('falso positivo');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  ok(!maus.length, `(247) a varredura de privacidade le os binarios em UTF-16${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 245. OS TEXTOS CONTAM O LANCADOR E A PASTA DE DADOS (14/11): o EADDRINUSE aponta a bandeja e o settings.json de verdade;
//      nenhum texto da pagina manda usar Ctrl+C num terminal; a tela de fechado e o SETUP.md falam do .exe, do SmartScreen
//      e de %LOCALAPPDATA%; o README nao pede mais o Node 18. O SETUP.md so existe no checkout e no pacote (na raiz).
{
  const maus = [];
  const srv = fs.readFileSync(path.join(import.meta.dirname, 'server.mjs'), 'utf8');
  const bloco = srv.slice(srv.indexOf("server.on('error'"), srv.indexOf('process.exit(1);\n});'));
  if (!bloco.includes('system tray') || !bloco.includes('${SETTINGS_FILE}') || bloco.includes('app/settings.json')) maus.push('o texto do EADDRINUSE');
  const js = fs.readFileSync(path.join(import.meta.dirname, 'web', 'app.js'), 'utf8');
  if (/Ctrl\+C/.test(js)) maus.push('app.js ainda manda usar Ctrl+C');
  const html = fs.readFileSync(path.join(import.meta.dirname, 'web', 'index.html'), 'utf8');
  const fechado = html.slice(html.indexOf('<section id="closed"'), html.indexOf('</section>', html.indexOf('<section id="closed"')));
  if (!fechado.includes('CMBS Roguelike.exe')) maus.push('a tela de fechado nao fala do lancador');
  const setup = path.join(import.meta.dirname, '..', 'SETUP.md');
  if (fs.existsSync(setup)) {
    const t = fs.readFileSync(setup, 'utf8');
    for (const s of ['CMBS Roguelike.exe', 'SmartScreen', '%LOCALAPPDATA%\\CMBS Roguelike', 'Updating']) if (!t.includes(s)) maus.push(`SETUP.md sem "${s}"`);
    if (t.includes('app\\campaigns\\<campaign>')) maus.push('SETUP.md ainda poe as campanhas em app\\campaigns');
  }
  const readme = path.join(import.meta.dirname, 'README.md');
  if (fs.existsSync(readme) && /Node\.js 18/.test(fs.readFileSync(readme, 'utf8'))) maus.push('README pede Node.js 18');
  ok(!maus.length, `(245) os textos falam do lancador, da bandeja e da pasta de dados${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 248. A MAQUINA NA ULTIMA LINHA DO ROSTER TAMBEM VOLTA (15/11, autor: a UKR do pacote parou na b3 com "core 188 e o
//      ultimo bloco do roster: nao curo sem achar a cauda"). O Ural destruido era a ultima linha; a ressurreicao acha o
//      fim dele pela cauda da lista (inicioDaCauda) e cura os quatro, com o resto do roster byte a byte igual.
{
  const RS = await import('../tools/re/ressurreicao.mjs'); const RO = await import('../tools/re/roster.mjs');
  const sv = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/UKR btt2 transition.bts';
  const maus = []; let info = 'sem o save da UKR do pacote (pulado)';
  if (fs.existsSync(sv)) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-t248-'));
    try {
      const ultima = RO.lerRoster(sv).unidades.at(-1).coreId;
      const r = RS.ressuscitar(sv, path.join(tmp, 'c.bts'), [31, 76, 187, 188]);
      if (ultima !== 188 || r.curados.length !== 4 || !r.curados.every((c) => c.para === 'S=3')) maus.push(JSON.stringify(r.curados));
      info = `ultima linha core ${ultima}, ${r.curados.length} curados`;
    } catch (e) { maus.push(e.message.slice(0, 200)); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  ok(!maus.length, `(248) a maquina destruida na ultima linha do roster volta na vaga: ${info}${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 249. A CAMPANHA SOBREVIVE A PASTA DO APP TROCADA (15/11): o caminho de batalhas guarda as formacoes do inimigo com o
//      caminho absoluto da pasta do app em que foram sorteadas (CMBS-Roguelike-1.0.0\assets\lib\...). Com a versao nova em
//      outra pasta e a velha apagada, a montagem as acha na biblioteca de agora pelo nome; o que existe fica como esta.
{
  const F = await import('./src/forge.mjs');
  const maus = [];
  const algum = fs.readdirSync(paths().lib).find((f) => f.toLowerCase().endsWith('.btt'));
  const velho = path.join(os.tmpdir(), 'CMBS-Roguelike-0.9.9-apagada', 'assets', 'lib', algum);
  if (path.resolve(F.inLibrary(velho)) !== path.resolve(path.join(paths().lib, algum))) maus.push(`pasta velha: ${F.inLibrary(velho)}`);
  const atual = path.join(paths().lib, algum);
  if (F.inLibrary(atual) !== atual) maus.push('o caminho que existe mudou');
  const nenhum = path.join(os.tmpdir(), 'nao-existe', 'ZZ formacao inventada.btt');
  if (F.inLibrary(nenhum) !== nenhum) maus.push('inventou uma formacao');
  const forge = fs.readFileSync(path.join(import.meta.dirname, 'src', 'forge.mjs'), 'utf8');
  if (!/defensor: defense\.formations\.map\(\(f\) => \(\{ \.\.\.f, formacao: fwd\(inLibrary\(f\.formacao\)\) \}\)\)/.test(forge)) maus.push('buildBattle nao re-ancora o defensor');
  ok(!maus.length, `(249) a formacao do inimigo guardada com a pasta velha do app e achada na biblioteca de agora${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 246. O GOG (14/11): os caminhos padrao do GOG Galaxy entre os candidatos, e a consulta ao registro (um "path" por jogo e
//      por DLC, todos na mesma pasta) devolve cada pasta uma vez.
{
  const S = await import('./src/settings.mjs');
  const maus = [];
  const c = S.candidates().map((x) => x.toLowerCase());
  if (!c.includes('c:/program files (x86)/gog galaxy/games/combat mission black sea/game files')) maus.push('sem o GOG Galaxy em Program Files (x86)');
  const amostra = ['HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1',
    '    path    REG_SZ    D:\\GOG Games\\Combat Mission Black Sea', '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\2',
    '    path    REG_SZ    d:\\gog games\\combat mission black sea', '', 'End of search: 2 match(es) found.'].join('\r\n');
  const g = S.parseGogQuery(amostra);
  if (g.length !== 1 || g[0] !== 'D:/GOG Games/Combat Mission Black Sea') maus.push(`parseGogQuery: ${JSON.stringify(g)}`);
  ok(!maus.length, `(246) GOG: caminhos do Galaxy e a pasta do registro uma vez${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 250. A COPIA PUBLICA (15/11, autor: "como disponibilizar o pacote no github?"): o que vai ao repositorio publico e o
//      pacote sem o Node portatil e sem o .exe (os dois vao no zip do release), mais README, LICENSE, .gitignore e
//      .gitattributes dos modelos; o que havia na copia some e o .git fica; nada de nome, e-mail ou caminho do autor; as notas do release
//      levam o nome e o SHA-256 do zip e o aviso do SmartScreen.
{
  const PUB = await import('../tools/publicar.mjs'); const PRIV = await import('../tools/privacidade.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbs-t250-'));
  const maus = [];
  try {
    const pacote = path.join(tmp, 'CMBS-Roguelike-9.9.9'), copia = path.join(tmp, 'copia');
    for (const f of ['app/node/node.exe', 'app/server.mjs', 'app/launcher/Launcher.cs', 'assets/lib/x.btt', 'research/custos.json', 'SETUP.md', 'CMBS Roguelike.exe']) {
      fs.mkdirSync(path.dirname(path.join(pacote, f)), { recursive: true }); fs.writeFileSync(path.join(pacote, f), f);
    }
    fs.mkdirSync(path.join(copia, '.git'), { recursive: true }); fs.writeFileSync(path.join(copia, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    fs.mkdirSync(path.join(copia, 'velho')); fs.writeFileSync(path.join(copia, 'velho', 'sobra.txt'), 'x');
    const r = PUB.montarCopia({ pacote, copia, conta: 'acssoftware', repo: 'cmbs-roguelike' });
    const tem = (f) => fs.existsSync(path.join(copia, f));
    if (tem('app/node') || tem('CMBS Roguelike.exe')) maus.push('o Node ou o .exe foram para a copia');
    if (tem('velho')) maus.push('a sobra da copia anterior ficou');
    if (!tem('.git/HEAD')) maus.push('o .git da copia foi apagado');
    for (const f of ['app/server.mjs', 'app/launcher/Launcher.cs', 'assets/lib/x.btt', 'research/custos.json', 'SETUP.md', 'README.md', 'LICENSE', '.gitignore', '.gitattributes']) if (!tem(f)) maus.push(`sem ${f}`);
    if (!/^\*\.btt binary$/m.test(fs.readFileSync(path.join(copia, '.gitattributes'), 'utf8'))) maus.push('.gitattributes sem os binarios do jogo');
    const readme = fs.readFileSync(path.join(copia, 'README.md'), 'utf8');
    if (!readme.includes('https://github.com/acssoftware/cmbs-roguelike/releases/latest') || /\{\{/.test(readme)) maus.push('README sem o link do release, ou com marcador');
    const lic = fs.readFileSync(path.join(copia, 'LICENSE'), 'utf8');
    if (!/^MIT License/.test(lic) || !/Copyright \(c\) \d{4} acssoftware/.test(lic) || !/assets\//.test(lic)) maus.push('LICENSE');
    if (r.arquivos.includes('app/node/node.exe') || !r.arquivos.includes('README.md') || r.arquivos.some((f) => f.startsWith('.git/'))) maus.push(`lista: ${r.arquivos.join(' ')}`);
    const achados = PRIV.varrerPasta(copia, r.arquivos, { binarios: true, pads: PRIV.padroes(PRIV.identidade(path.join(import.meta.dirname, '..'))) });
    if (achados.length) maus.push(`dado pessoal: ${[...new Set(achados.map((a) => a.arquivo + ' ' + a.tipo))].join(', ')}`);
    const zip = path.join(tmp, 'CMBS-Roguelike-9.9.9.zip'); fs.writeFileSync(zip, 'zip de mentira');
    const notas = PUB.notasDoRelease({ versao: '9.9.9', zip, url: r.url });
    if (!notas.includes(PUB.sha256(zip)) || !notas.includes('CMBS-Roguelike-9.9.9.zip') || !/SmartScreen/.test(notas) || !notas.includes('/blob/v9.9.9/SETUP.md')) maus.push('notas do release');
  } catch (e) { maus.push(e.message.slice(0, 200)); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  ok(!maus.length, `(250) a copia publica: o pacote sem o Node e o .exe, com README, LICENSE e .gitignore, sem dado pessoal${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 251. O AVULSO SO ENTRA EM FORMACAO DO PROPRIO EXERCITO (25/11, relato de um jogador com US + UKR): o M1126, o M1152 e o
//      LMTV anexados a uma companhia ucraniana ficaram fora da batalha (instantiated 0 no save), o Ural entrou. O
//      servidor recusa o anexo de outro exercito, a tela so oferece os do exercito da formacao, e a lista da forca
//      desenha o avulso que ja e dele (que nao existe na arvore da biblioteca).
{
  const maus = [];
  try {
    const { extrasOf } = await import('./src/campaign.mjs');
    const aceita = (nacao, tipo) => {
      const f = libFormations(nacao, { rules: R }).find((x) => !x.trp && formationTree(x.file).roots.some((r) => r.isFormation));
      const tree = formationTree(f.file); const raiz = tree.roots.find((r) => r.isFormation);
      try { return extrasOf({ source: f.file, nation: nacao, extras: [{ tipo, key: raiz.key }] }, tree, nacao, R).length === 1 ? 'ok' : 'vazio'; } catch (e) { return e.message; }
    };
    const stryker = 'Infantry Carrier Vehicle (M1126 Stryker)', ural = 'Truck (Ural-4320)';
    const r1 = aceita('UKR', stryker), r2 = aceita('UKR', ural), r3 = aceita('US', stryker), r4 = aceita('US', ural);
    if (!/is a US vehicle and cannot join a UKR formation/.test(r1)) maus.push(`Stryker em formacao UKR: ${r1.slice(0, 80)}`);
    if (r2 !== 'ok') maus.push(`Ural em formacao UKR: ${r2.slice(0, 80)}`);
    if (r3 !== 'ok') maus.push(`Stryker em formacao US: ${r3.slice(0, 80)}`);
    if (!/is a UKR\/RU vehicle and cannot join a US formation/.test(r4)) maus.push(`Ural em formacao US: ${r4.slice(0, 80)}`);
    const js = fs.readFileSync(path.join(import.meta.dirname, 'web', 'app.js'), 'utf8');
    if (!/c\.nation === nacao/.test(js)) maus.push('o menu de anexos nao filtra pelo exercito da formacao');
    if (!/singleOwned: true/.test(js) || !/n\.extra \|\| n\.singleOwned/.test(js)) maus.push('a lista da forca nao desenha o avulso que ja e dele');
  } catch (e) { maus.push(e.message.slice(0, 200)); }
  ok(!maus.length, `(251) avulso so no proprio exercito: US em UKR recusado, Ural em UKR e Stryker em US aceitos; tela filtra e desenha o avulso comprado${maus.length ? ' — ' + maus.join('; ') : ''}`);
}

// 93-100 (o mapa a partir do CSV do CMAutoEditor e a ferramenta de mapas offline) foram com a ferramenta para
// CMAUTOEDITOR/map_maker (04/10/2026): rodam la, com `node test.mjs`.

console.log(`\nRESULTADO: ${falhou ? 'FALHOU' : 'ok'}`);
process.exit(falhou ? 1 : 0);
