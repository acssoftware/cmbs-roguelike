// THE WEAPON A SOLDIER CARRIES, and how the player changes it between battles (plano 1, fase C).
//
// WHY THIS IS SAFE, and why it is only two bytes. The man's record is
// `[00][classe|item ARMA 1][00][classe|item ARMA 2][00][flags][?][u16 nMun][pares][u32 n3][...]`
// (FORMATO 113.2/113.6). Writing classe and item IN PLACE is proven in game twice — the rearm of a
// looted casualty (E30) and the machine-gunner who got his PKM back (E54) — while replacing a
// man's record with another man's brought "Out of memory" down on us twice (E28, E29). So a weapon
// change here is exactly that: two bytes, same record, same size.
//
// AND THE AMMUNITION FOLLOWS ON ITS OWN. The refit's `missingLoads` asks what the weapons the man
// HOLDS are issued (`research/armas_municao.json`, E54) and `grantAmmo` inserts the pairs he lacks
// (E37) before `resupply` tops them up (E33). Which is why this step runs BEFORE those two in
// `refitSave`: swap the weapon, and the same chain that feeds a PKM feeds the new one.
//
// WHAT IT CANNOT DO: take anything away. Shrinking a record has never been accepted, so the old
// calibre stays in his pouches as dead weight — the panel lists it, the weapon only uses its own.
// The screen says so.
//
// WHERE THE MENU COMES FROM: the weapons the men of that same army carry IN THIS SAVE, plus what
// the campaign's own baseline learned for their TO&E slots. Nothing else. A weapon nobody in the
// force carries has no proven ammunition line, and handing it out would be a man with a rifle and
// no bullets.
import fs from 'node:fs';
import { paths } from './settings.mjs';
import { readRoster, readRosterTails, readAmmoVector, rearmMen, weaponAmmoTable, sidearmTable, writeManBytes } from './re.mjs';

export const NO_WEAPON = '8/0';
const par = (classe, item) => (classe === 0x08 ? NO_WEAPON : `${classe}/${item}`);

// The names, when we know them — AND THE ID SPACE IS PER ARMY. A Ukrainian engineer squad carries
// `2/9` and an American rifle squad carries `2/31`, which in the tooltip reading are an M110 CSASS
// and an AK-74/GP-25: the same pair means different things in different armies, which is why
// `research/armas.json` records a `lado` for every one of them (FORMATO 118). So a name is only
// used for the army it was read in; anywhere else the weapon shows as its pair, which is what the
// game actually goes by.
export function weaponNames() {
  try {
    const j = JSON.parse(fs.readFileSync(paths().weapons, 'utf8'));
    const out = {};
    for (const [k, v] of Object.entries(j.armas || {})) out[`${v.lado || '?'}|${k}`] = v.nome;
    // o MESMO id com nome diferente em outro exercito mora em `porLado` (chave `LADO|par`): sem esta linha
    // o RPG-26 russo (RU|4/16) e os pares lidos em 28/09 nunca chegavam a tela
    for (const [k, v] of Object.entries(j.porLado || {})) out[k] = v.nome;
    return out;
  } catch { return {}; }
}
const nomeDe = (nomes, nacao, arma) => nomes[`${nacao}|${arma}`] || (arma ? Object.entries(nomes).find(([k]) => k.endsWith(`|${arma}`))?.[1] : null) || null;
// O MERCADO NEGRO (18/10, autor): a arma ou o item de OUTRO exercito leva a origem no nome, "AK-74M (RU)"
const nomeDeFora = (nomes, origem, arma) => { const n = nomes[`${origem}|${arma}`]; return n ? `${n} (${origem})` : null; };

// O PRECO E A CATEGORIA DE CADA ARMA E ITEM (18/10, autor: "um json a parte com as variaveis de cada arma"). Chave
// `EXERCITO|par` (o id e por exercito, como os nomes), depois so o `par`; `demo:2`, `demo:4` e `laser` para os itens de
// bit. `preco`/`classe` valem para a arma na mao; `precoItem`/`classeItem`, quando existem, para o mesmo lancador vendido
// como item de inventario. O que nao esta no arquivo cai nas regras (rules.gear, rules.kit), como antes. Lido de novo
// quando o arquivo muda, para o autor editar com o app aberto.
let tabelaArmas = null, tabelaArmasMtime = -1, tabelaArmasFixa = null;
export function weaponPriceTable() {
  if (tabelaArmasFixa) return tabelaArmasFixa;
  try {
    const f = paths().weaponPrices; const m = fs.statSync(f).mtimeMs;
    if (m !== tabelaArmasMtime) { tabelaArmas = JSON.parse(fs.readFileSync(f, 'utf8')).armas || {}; tabelaArmasMtime = m; }
    return tabelaArmas;
  } catch { return {}; }
}
// para os testes: uma tabela no lugar do arquivo (null volta ao arquivo)
export function setWeaponPriceTable(t) { tabelaArmasFixa = t; }
export const weaponEntry = (nacao, id) => { const t = weaponPriceTable(); return (nacao && t[`${nacao}|${id}`]) || t[id] || null; };

// WHAT KIND OF WEAPON IT IS, for the price. The name decides when we have one — a PKM is a machine
// gun whatever else is true — and the CLASS BYTE decides when we do not: 2 is a personal weapon,
// 3 one served by a crew, 4 a rocket launcher, 5 a missile or recoilless gun (FORMATO 113.1).
export function weaponClass(weapon, name, R, nacao = null) {
  const e = weaponEntry(nacao, weapon);
  if (e?.classe) return e.classe;
  const g = R.gear || {};
  for (const c of g.classes || []) if (name && new RegExp(c.match, 'i').test(name)) return c.class;
  const classe = String(weapon).split('/')[0];
  return (g.byWeaponClass || {})[classe] || 'other';
}

export function gearPrice(weapon, name, R, nacao = null) {
  const e = weaponEntry(nacao, weapon);
  if (Number.isFinite(e?.preco)) return Math.round(e.preco);
  const p = (R.gear || {}).price || {};
  const k = weaponClass(weapon, name, R, nacao);
  return Math.round(p[k] ?? p.other ?? 0);
}

// THE MEN AND WHAT THEY CARRY, unit by unit, from the save the game just wrote.
//
// Only a man the app can actually re-arm is offered: alive (state 0 or 1 — the dead come back with
// the weapon of their TO&E slot and can be changed next time), in a unit that is IN THE FORCE, with
// a record the grammar reads, and not the crew of a machine (a tank commander's rifle is not what
// the player is shopping for).
//
// `crewRoles` are the roles the quartermaster already treats as machines, so the two screens never
// disagree about who is crew.
export function readGear(savePath, state, R, { crewRoles = null, offMap = null, onlyCoreIds = null, factory = null, blackMarket = false } = {}) {
  const roster = readRoster(savePath);
  const tails = readRosterTails(savePath);
  const nomes = weaponNames();
  const secundarias = (() => { try { return sidearmTable(paths().weaponAmmo); } catch { return new Set(); } })();
  // `onlyCoreIds`: the special forces, when gear is on for them alone (rules.gear.specialForcesOnly).
  const emCampo = new Map((state.units || []).filter((u) => u.present && (!onlyCoreIds || onlyCoreIds.has(u.coreId))).map((u) => [u.coreId, u]));
  // Papel E nome (E82): a `Team (Stinger)` tem papel de maquina e e uma dupla a pe, entao os homens
  // dela nao sao tripulacao. O `machineExcludes` da regra e quem separa.
  const papeis = new Set(crewRoles || R.replacement?.machineRoles || []);
  const foraMaquina = !crewRoles && R.replacement?.machineExcludes ? new RegExp(R.replacement.machineExcludes, 'i') : null;
  const ehMaquina = (u) => !!u && papeis.has(u.role) && !(foraMaquina && foraMaquina.test(String(u.name || '')));
  const fora = offMap instanceof Set ? offMap : new Set(offMap || []);
  const carregado = (i) => (readAmmoVector(tails[i]?.cauda)?.pares || []).filter((x) => x.qtd > 0).map((x) => ({ item: x.item, rounds: x.qtd }));
  // a vaga de fabrica do homem (equip: demo, laser; maos), por exercito|tipo do roster
  const fabricaDa = (nacao, tipo, slot) => factory?.tipos?.[`${nacao}|${tipo}`]?.vagas?.[slot] || null;

  const vistas = {};                                   // nacao -> Set de armas vistas nela
  const deFora = {};                                   // nacao -> Map arma -> exercito de origem (mercado negro)
  const anota = (nacao, w) => { if (w && w !== NO_WEAPON) (vistas[nacao] = vistas[nacao] || new Set()).add(w); };

  const units = [];
  for (const u of roster.unidades) {
    const dono = emCampo.get(u.coreId);
    if (!dono || !u.soldados.length) continue;
    const nacao = dono.nation || state.nation || null;
    const tripulacao = ehMaquina(dono) || fora.has(u.coreId);
    const men = [];
    u.soldados.forEach((s, slot) => {
      const c = tails[s.indice]?.cauda;
      const paiol = readAmmoVector(c);
      // 26/11: o lancador comprado que o jogo passou para a mao 1 e lido de volta na mao 2 (desinverter)
      const comprado = state.kit?.[u.coreId]?.[slot] || null;
      const [arma, segunda] = paiol ? desinverter(par(c[1], c[2]), par(c[4], c[5]), comprado) : [null, null];
      anota(nacao, arma);
      // e o que a campanha aprendeu para esta vaga tambem conta como arma do exercito
      anota(nacao, state.baseline?.[u.tipo]?.[slot]?.arma);
      if (!paiol) return;
      const porque = tripulacao ? 'crew' : s.estado > 1 ? 'down' : null;
      // O ITEM DE INVENTARIO (05/10, E145): um por soldado. O comprado mora em state.kit[coreId][slot]; um lancador
      // precisa da mao 2 livre — a de FABRICA da vaga, porque o lancador comprado e disparado volta pelo reset.
      const vaga = fabricaDa(nacao, u.tipo, slot);
      // a variante de fabrica que ele carrega (a mesma conta do resetPlan); um par que a fabrica nunca deu cai na base.
      // Se a mao 2 dele e o lancador COMPRADO, a conta e feita com a mao 2 vazia.
      const dele = [arma, comprado && segunda === comprado ? NO_WEAPON : segunda].sort().join(' + ');
      // com o lancador comprado no lugar da arma de fabrica da mao 2 (19/10) o par nao casa: a variante sai da mao 1
      const pelaMao1 = comprado && segunda === comprado ? (vaga?.variantes || []).find((v) => v.mao1 === arma) : null;
      const variante = vaga ? ((vaga.variantes || []).find((v) => (v.maos || []).slice().sort().join(' + ') === dele) || pelaMao1 || vaga) : null;
      const m1 = variante ? (variante.mao1 || (variante.maos || []).find((k) => k !== NO_WEAPON)) : null;
      // a de fabrica que o lancador comprado tirou da mao 2 (19/10) e a que a campanha lembrou na compra
      const lembrada = comprado && segunda === comprado ? state.kitHand2?.[u.coreId]?.[slot] || null : null;
      const maoDeFabrica = lembrada || (variante ? ((variante.maos || []).filter((k) => k !== m1)[0] || NO_WEAPON) : segunda);
      const kitNaMao = kitHeld(c, comprado);
      men.push({
        index: s.indice, name: s.nome, state: s.estado, slot,
        weapon: arma, weaponName: nomeDe(nomes, nacao, arma), class: arma ? weaponClass(arma, nomeDe(nomes, nacao, arma), R, nacao) : null,
        second: segunda, ammo: carregado(s.indice),
        canChange: !porque && arma !== null, why: porque,
        // comprada numa batalha anterior e ainda na mao (a tela marca "bought")
        bought: !!arma && state.gear?.[u.coreId]?.[slot] === arma,
        secondName: segunda !== NO_WEAPON ? nomeDe(nomes, nacao, segunda) || segunda : null,
        kit: comprado, kitHeld: kitNaMao, kitName: comprado ? kitName(nomes, nacao, comprado) : null,
        demo: c[8] & 0x18 ? ((c[8] & 0x10) ? 4 : 2) : 0, laser: !!(c[7] & 0x08), nightVision: !!(c[8] & 0x80),
        factoryDemo: vaga?.equip?.demo || 0, factoryLaser: !!vaga?.equip?.laser, factorySecond: maoDeFabrica, factorySecondName: maoDeFabrica !== NO_WEAPON ? nomeDe(nomes, nacao, maoDeFabrica) || maoDeFabrica : null,
        canTake: !porque, why2: maoDeFabrica !== NO_WEAPON ? 'hand2' : null,
      });
    });
    if (men.length) units.push({ coreId: u.coreId, name: dono.name, nation: nacao, role: dono.role, crew: tripulacao, men });
  }

  // O MENU, por exercito: as armas vistas naquele exercito que tem linha de municao colhida — sem
  // ela o refit nao sabe o que por no paiol, e a troca entregaria um homem sem bala.
  const municao = (() => { try { return weaponAmmoTable(paths().weaponAmmo); } catch { return {}; } })();
  // O MENU DO EXERCITO (28/09, autor): com `rules.gear.menu === 'army'`, entra tambem toda arma PESSOAL
  // (classe 2) que a fabrica poe na mao 1 de alguma vaga daquele exercito — nao so o que esta forca
  // carrega. A LRS americana, sozinha, so conhecia cinco armas; o exercito tem M107A1, M110, Mk21...
  if (R.gear?.menu === 'army' && factory?.tipos) {
    for (const nacao of new Set(units.map((u) => u.nation).filter(Boolean))) {
      for (const t of Object.values(factory.tipos)) {
        if (t.exercito !== nacao) continue;
        for (const v of Object.values(t.vagas || {})) for (const va of (v.variantes || [v])) {
          if (va.mao1 && va.mao1.startsWith('2/')) anota(nacao, va.mao1);
        }
      }
    }
  }
  // O MERCADO NEGRO (18/10, autor; a habilidade de campanha "Access to Black Market"): as armas pessoais da mao 1 da
  // fabrica dos OUTROS exercitos entram no menu, com a origem marcada. Mesmo preco da classe. Os pares nao se cruzam
  // entre US e RU/UKR na fabrica, entao o par diz qual arma e.
  if (blackMarket && factory?.tipos) {
    for (const nacao of new Set(units.map((u) => u.nation).filter(Boolean))) {
      for (const t of Object.values(factory.tipos)) {
        if (t.exercito === nacao) continue;
        for (const v of Object.values(t.vagas || {})) for (const va of (v.variantes || [v])) {
          const w = va.mao1;
          if (!w || !w.startsWith('2/') || vistas[nacao]?.has(w)) continue;
          anota(nacao, w); (deFora[nacao] = deFora[nacao] || new Map()).set(w, t.exercito);
        }
      }
    }
  }
  const catalog = {};
  for (const [nacao, armas] of Object.entries(vistas)) {
    catalog[nacao] = [...armas]
      // so o que tem linha de municao colhida, e nunca uma SECUNDARIA: a pistola que o metralhador
      // leva no coldre nao e uma escolha de arma (E54), e oferece-la seria vender um homem desarmado.
      .filter((w) => municao[w] && Object.keys(municao[w]).length && !secundarias.has(w))
      .map((w) => {
        const origem = deFora[nacao]?.get(w) || null;
        const base = origem ? nomes[`${origem}|${w}`] || null : nomeDe(nomes, nacao, w);
        // a arma de fora (mercado negro) e cobrada pela linha do exercito de ORIGEM: e a arma dele
        const dono = origem || nacao;
        return { weapon: w, name: origem ? nomeDeFora(nomes, origem, w) : base, class: weaponClass(w, base, R, dono), price: gearPrice(w, base, R, dono), ammo: municao[w], ...(origem ? { foreign: origem } : {}) };
      })
      .sort((a, b) => a.price - b.price || String(a.name || a.weapon).localeCompare(String(b.name || b.weapon)))
      // os GEMEOS (2/24 e 2/25, os dois "AK-74") sao a mesma arma na tela: um por nome no menu — quem
      // segura o outro continua vendo o dele, que a tela poe no topo como "keeps it"
      .filter((x, i, todas) => !x.name || todas.findIndex((y) => y.name === x.name) === i);
  }
  return { units, catalog, blackMarket: !!blackMarket, kitCatalog: kitCatalog(new Set(units.map((u) => u.nation).filter(Boolean)), factory, R, nomes, { blackMarket }) };
}

// O CATALOGO DE ITENS (05/10/2026, E145; autor: "adicionar apenas 1 item por soldado como um breach kit, um rpg-22, um
// at-4"). Por exercito: todo LANCADOR (classe 4) que a fabrica poe na MAO 2 de alguma vaga daquele exercito — RPG-22,
// RPG-26, AT4, RPO, Javelin, Stinger, Igla —, as cargas de demolicao (byte +8: 0x08 = 2, 0x10 = 4) e o designador laser
// (+7 0x08), que o E117 provou por escrita. O Breach Kit e do TIPO da unidade (E120) e os binoculos sao a marca do lider:
// nenhum dos dois se da a um homem.
export const KIT_BITS = { 'demo:2': { demo: 0x08 }, 'demo:4': { demo: 0x10 }, laser: { laser: 0x08 } };
export function kitName(nomes, nacao, id) {
  if (id === 'demo:2') return 'Demo Charge ×2';
  if (id === 'demo:4') return 'Demo Charge ×4';
  if (id === 'laser') return 'Laser Designator';
  if (id.startsWith('reload:')) { const w = id.slice(7); return `${nomeDe(nomes, nacao, w) || w} reload`; }
  return nomeDe(nomes, nacao, id) || `${id} (unnamed)`;
}
// o que o lancador traz no paiol: os itens que metade dos portadores carrega e que contam ate 10 (o foguete, o missil,
// nunca o calibre do fuzil que o portador tambem leva); `rules.kit.ammo["EXERCITO|par"]` corrige a mao
export function kitAmmo(weapon, nacao, R) {
  const fixo = R.kit?.ammo?.[`${nacao}|${weapon}`] || R.kit?.ammo?.[weapon];
  if (fixo) return Object.fromEntries(Object.entries(fixo).map(([k, v]) => [Number(k), Number(v)]));
  try {
    const j = JSON.parse(fs.readFileSync(paths().weaponAmmo, 'utf8'));
    const a = (j.armas || {})[weapon]; if (!a) return {};
    const out = {};
    for (const [item, x] of Object.entries(a.itens || {})) if (x.n / a.homens >= 0.5 && x.moda <= 10) out[Number(item)] = x.moda;
    return out;
  } catch { return {}; }
}
export function kitClass(id, name, R, nacao = null) {
  const e = weaponEntry(nacao, id);
  if (e?.classeItem || e?.classe) return e.classeItem || e.classe;
  if (id.startsWith('demo:')) return id.replace(':', '');
  if (id === 'laser') return 'laser';
  if (id.startsWith('reload:')) return 'reload';
  for (const c of R.kit?.classes || []) if (name && new RegExp(c.match, 'i').test(name)) return c.class;
  return 'at';
}
// A MUNICAO QUE O RESET PE NO ITEM COMPRADO (18/10): o lancador recarregavel comprado vem sem municao; a recarga leva a
// municao do lancador dela. O mesmo par de funcoes para o refit e para os testes.
export function kitAmmoForReset(factory, R) {
  return {
    kitAmmo: (w, army) => (recarregavel(w, factory, R) ? {} : kitAmmo(w, army, R)),
    reloadAmmo: (w, army) => kitAmmo(w, army, R),
  };
}

// o lancador e recarregavel quando a fabrica da a municao dele a alguem que nao o segura
export function recarregavel(w, factory, R = {}) {
  const itens = Object.keys(kitAmmo(w, null, R));
  if (!itens.length) return false;
  for (const t of Object.values(factory?.tipos || {})) for (const v of Object.values(t.vagas || {})) for (const va of (v.variantes || [v])) {
    if ((va.maos || []).includes(w)) continue;
    if (itens.some((i) => Number((va.municao || {})[i]) > 0)) return true;
  }
  return false;
}
export function kitCatalog(nacoes, factory, R, nomes = weaponNames(), { blackMarket = false } = {}) {
  const out = {};
  for (const nacao of nacoes) {
    const lanc = new Set();
    const origem = new Map();                         // lancador de fora -> exercito (mercado negro, 18/10)
    for (const t of Object.values(factory?.tipos || {})) {
      const proprio = t.exercito === nacao;
      if (!proprio && !blackMarket) continue;
      for (const v of Object.values(t.vagas || {})) for (const va of (v.variantes || [v])) {
        const m1 = va.mao1 || va.maos?.[0];
        for (const w of va.maos || []) {
          if (w === m1 || !w.startsWith('4/')) continue;
          if (proprio) { lanc.add(w); origem.delete(w); } else if (!lanc.has(w)) { lanc.add(w); origem.set(w, t.exercito); }
        }
      }
    }
    // o preco do item: a linha dele no arquivo (precoItem, depois preco), senao a categoria da regra
    const preco = (k, id, dono) => { const e = weaponEntry(dono, id); const v = e?.precoItem ?? e?.preco; return Math.round(Number.isFinite(v) ? v : (R.kit?.price?.[k] ?? 0)); };
    const itens = [...lanc].map((w) => {
      const de = origem.get(w) || null;
      const base = de ? kitName(nomes, de, w) : kitName(nomes, nacao, w);
      const k = kitClass(w, base, R, de || nacao);
      // O LANCADOR RECARREGAVEL VEM VAZIO (18/10, autor: "o ideal e vir so o launcher e o jogador ter de comprar os misseis
      // a parte, no inventario de outros soldados"). O descartavel (AT4, RPG-22/26, RPO) e o proprio tiro e vem com ele.
      const municao = kitAmmo(w, de || nacao, R);
      const vazio = recarregavel(w, factory, R);
      return { id: w, kind: 'launcher', name: de ? `${base} (${de})` : base, class: k, price: preco(k, w, de || nacao), ammo: vazio ? {} : municao, reloadAmmo: municao, empty: vazio, ...(de ? { foreign: de } : {}) };
    })
      .filter((x) => Object.keys(x.reloadAmmo).length)
      .sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
    // A RECARGA (18/10, autor: "permitir comprar javelin rockets ou missiles"): 1 missil ou foguete de um lancador
    // recarregavel, carregado por OUTRO homem da unidade — e assim que a fabrica arma o time de Javelin (o atirador com o CLU
    // e 1 missil, o fuzileiro com mais 1), e o atirador usa o que a unidade carrega. Recarregavel = a fabrica da a municao
    // dele a alguem que nao segura o lancador (AT4, RPG-22/26 e RPO sao descartaveis e ficam de fora). Preco: a linha
    // "reload:par" do arquivo, senao metade do lancador como item.
    for (const l of itens.filter((x) => x.kind === 'launcher' && recarregavel(x.id, factory, R))) {
      const id = `reload:${l.id}`; const dono = l.foreign || nacao;
      const e = weaponEntry(dono, id);
      const base = l.foreign ? kitName(nomes, l.foreign, l.id) : kitName(nomes, nacao, l.id);
      const tipo = l.class === 'atgm' || l.class === 'manpads' ? 'missile' : 'rocket';
      itens.push({ id, kind: 'reload', launcher: l.id, name: `${base} ${tipo}${l.foreign ? ` (${l.foreign})` : ''}`, class: e?.classeItem || e?.classe || 'reload',
        price: Math.round(Number.isFinite(e?.precoItem ?? e?.preco) ? (e.precoItem ?? e.preco) : l.price / 2), ammo: l.reloadAmmo, ...(l.foreign ? { foreign: l.foreign } : {}) });
    }
    for (const id of ['demo:2', 'demo:4', 'laser']) { const k = kitClass(id, null, R, nacao); itens.push({ id, kind: id === 'laser' ? 'laser' : 'demo', name: kitName(nomes, nacao, id), class: k, price: preco(k, id, nacao), ammo: {} }); }
    out[nacao] = itens;
  }
  return out;
}
// o homem ainda tem o item comprado? (lancador na mao 2; bits no +7/+8)
export function kitHeld(c, id) {
  if (!id || !c || c.length < 9) return false;
  if (id === 'demo:2') return (c[8] & 0x18) === 0x08;
  if (id === 'demo:4') return (c[8] & 0x18) === 0x10;
  if (id === 'laser') return !!(c[7] & 0x08);
  if (id.startsWith('reload:')) { const itens = new Set(Object.keys(kitAmmo(id.slice(7), null, {})).map(Number)); return (readAmmoVector(c)?.pares || []).some((p) => itens.has(p.item) && p.qtd > 0); }
  return par(c[4], c[5]) === id || par(c[1], c[2]) === id;
}

// O QUE A LISTA DE ITENS CUSTA (pura, como priceGear). `kit = [{ index, item }]`, item null = largar o comprado.
// Um item por homem; lancador so com a mao 2 de fabrica livre; e so o que o exercito dele tem.
export function priceKit(kit, { units, kitCatalog: cat = {} }, R) {
  const porHomem = new Map();
  for (const u of units) for (const m of u.men) porHomem.set(m.index, { ...m, unit: u });
  const vistos = new Set(); const out = [];
  for (const k of kit || []) {
    const m = porHomem.get(Number(k.index));
    if (!m) throw new Error(`there is no soldier with index ${k.index} in this save`);
    if (vistos.has(m.index)) throw new Error(`${m.name}: one item per soldier`);
    vistos.add(m.index);
    if (!m.canTake) throw new Error(`${m.name} cannot be given an item${m.why === 'crew' ? ': he is the crew of a machine' : m.why === 'down' ? ': he is down' : ''}`);
    if (k.item === null || k.item === undefined || k.item === '') {
      if (!m.kit) continue;
      out.push({ index: m.index, slot: m.slot, name: m.name, coreId: m.unit.coreId, from: m.kit, to: null, kind: 'drop', price: 0, factoryDemo: m.factoryDemo, factoryLaser: m.factoryLaser, factorySecond: m.factorySecond });
      continue;
    }
    const escolha = (cat[m.unit.nation] || []).find((x) => x.id === String(k.item));
    if (!escolha) throw new Error(`${m.name}: ${k.item} is not an item his army carries`);
    // 19/10 (autor): o lancador comprado SUBSTITUI a arma de fabrica da mao 2 enquanto ele tiver o item; ao largar (ou
    // cair) ela volta pelo reset. So nao se compra o lancador que a fabrica ja poe na mao dele.
    if (escolha.kind === 'launcher' && escolha.id === m.factorySecond) throw new Error(`${m.name} already carries ${m.secondName || m.factorySecond} in his other hand`);
    if (escolha.kind === 'reload') {
      // 26/11 (relato de um jogador): quem segura o lancador e o que a mao 2 tera DEPOIS desta lista, nao o que o save
      // diz agora. O homem com o Javelin comprado que o troca pelo missil deixa de segurar o lancador (a mao 2 dele volta
      // a de fabrica), e o que larga o lancador nesta lista nao serve de atirador para a recarga de outro.
      const L = escolha.launcher;
      const lancador = (id) => !!id && /^\d+\/\d+$/.test(id);
      const kitDepois = (h) => { const o = (kit || []).find((x) => Number(x.index) === h.index); return o ? (o.item === null || o.item === undefined || o.item === '' ? null : String(o.item)) : h.kit; };
      const maoDois = (h) => { const k = kitDepois(h); return lancador(k) ? k : lancador(h.kit) ? h.factorySecond : h.second; };
      const segura = (h) => h.weapon === L || maoDois(h) === L;
      if (segura(m)) throw new Error(`${m.name} carries the launcher and its round already: a reload is carried by another man of the unit`);
      if (!m.unit.men.some(segura)) throw new Error(`${m.name}: nobody in his unit carries the ${L} this round is for`);
    }
    if (escolha.id === m.kit) continue;
    out.push({ index: m.index, slot: m.slot, name: m.name, coreId: m.unit.coreId, from: m.kit, to: escolha.id, toName: escolha.name, kind: escolha.kind, ammo: escolha.ammo, class: escolha.class, price: escolha.price, factoryDemo: m.factoryDemo, factoryLaser: m.factoryLaser, factorySecond: m.factorySecond });
  }
  return { changes: out, cost: out.reduce((a, x) => a + x.price, 0) };
}

// OS BYTES DE UM HOMEM PARA UM ITEM (ou para a falta dele): o que `writeManBytes` recebe. O demo de fabrica volta
// quando o comprado sai; o laser so desliga se a fabrica nao o da.
export function kitBytes(cauda, de, para, { factoryDemo = 0, factoryLaser = false } = {}) {
  const c8 = cauda[8], fab8 = factoryDemo === 4 ? 0x10 : factoryDemo === 2 ? 0x08 : 0;
  let mais8 = c8, ligar7 = 0, desligar7 = 0;
  if (de && de.startsWith('demo:')) mais8 = (mais8 & ~0x18) | fab8;
  if (de === 'laser' && !factoryLaser) desligar7 |= 0x08;
  if (para && KIT_BITS[para]?.demo) mais8 = (mais8 & ~0x18) | KIT_BITS[para].demo;
  if (para === 'laser') { ligar7 |= 0x08; desligar7 &= ~0x08; }
  const r = {};
  if (mais8 !== c8) r.mais8 = mais8 & 0xff;
  if (ligar7) r.ligar7 = ligar7;
  if (desligar7) r.desligar7 = desligar7;
  return Object.keys(r).length ? r : null;
}

// O LANCADOR QUE O JOGO PASSA PARA A MAO 1 (26/11/2026, prova em jogo ZZ JAVELIN MORTAR). O app escreve o lancador comprado
// na mao 2 (save entregue: 2/25 + 4/1) e o jogo devolve o homem com as maos trocadas (save da transicao: 4/1 + 2/25), ate
// num cessar-fogo no turno 0. Lido assim, o Javelin parecia a arma dele: a loja dizia que ele "segura o lancador" e recusava
// a troca pelo missil (relato de um jogador), a troca de arma escrevia por cima do Javelin e o reset perdia a variante da vaga
// (o par nao casava). `desinverter(c, lancador)` diz as maos como o app as escreveu; `launcherBackToHand2` grava isso no
// save, antes de qualquer outra escrita da entrega. `launchers` = Map indice do soldado -> par do lancador comprado.
export function desinverter(a1, a2, lancador) {
  return lancador && /^\d+\/\d+$/.test(lancador) && a1 === lancador && a2 !== lancador ? [a2, a1] : [a1, a2];
}
export function launcherBackToHand2({ save, out, launchers, trace }) {
  if (!launchers?.size) return { homens: 0 };
  const tails = readRosterTails(save);
  const maos = {}, quem = [];
  for (const [index, L] of launchers) {
    const c = tails[index]?.cauda; if (!c || c.length < 6) continue;
    const a1 = par(c[1], c[2]), a2 = par(c[4], c[5]);
    const [m1, m2] = desinverter(a1, a2, L);
    if (m1 === a1) continue;
    const [classe, item] = m1.split('/').map(Number), [classe2, item2] = m2.split('/').map(Number);
    maos[index] = { classe, item, classe2, item2 };
    quem.push(`${tails[index]?.nome || index}: ${a1} + ${a2} -> ${m1} + ${m2}`);
  }
  if (!quem.length) return { homens: 0 };
  const r = rearmMen(save, out, maos);
  trace?.event('kit.handsBack', { men: quem });
  return { homens: r.homens };
}
// os lancadores comprados de um save, por indice do soldado: o que ja era dele (`keepKit`, core -> vaga -> item) e o que ele
// larga nesta virada (`changes`.from)
export function boughtLaunchers(save, keepKit, changes = []) {
  const out = new Map();
  const lancador = (id) => !!id && /^\d+\/\d+$/.test(id);
  if (keepKit) for (const u of readRoster(save).unidades) u.soldados.forEach((s, slot) => { const k = keepKit[u.coreId]?.[slot]; if (lancador(k)) out.set(s.indice, k); });
  for (const c of changes || []) if (lancador(c.from) && !out.has(c.index)) out.set(c.index, c.from);
  return out;
}

// A ESCRITA DO ITEM: lancador na mao 2 (o par; o foguete entra no reset do mesmo refit, que segue `keepKit`), bits
// no +7/+8. Largar um lancador devolve a mao 2 de fabrica da vaga.
export function applyKit({ save, out, changes, trace }) {
  if (!(changes || []).length) return { homens: 0 };
  const tails = readRosterTails(save);
  const maos = {}, bytes = {};
  for (const c of changes) {
    const cauda = tails[c.index]?.cauda; if (!cauda) continue;
    const lancador = (id) => !!id && /^\d+\/\d+$/.test(id);
    if (lancador(c.to)) { const [classe2, item2] = c.to.split('/').map(Number); maos[c.index] = { classe2, item2 }; }
    else if (lancador(c.from)) { const [classe2, item2] = String(c.factorySecond || NO_WEAPON).split('/').map(Number); maos[c.index] = { classe2, item2 }; }
    const b = kitBytes(cauda, lancador(c.from) ? null : c.from, lancador(c.to) ? null : c.to, c);
    if (b) bytes[c.index] = b;
  }
  let src = save, homens = 0;
  if (Object.keys(maos).length) { const r = rearmMen(src, out, maos); if (r.homens) { src = out; homens += r.homens; } }
  if (Object.keys(bytes).length) { const tmp = out + '.bits'; const r = writeManBytes(src, tmp, bytes); fs.renameSync(tmp, out); homens += r.homens; src = out; }
  trace.wrote('kit.save', out);
  trace.event('kit.apply', { men: homens, changes: changes.map((c) => `${c.name} (core ${c.coreId} slot ${c.slot}): ${c.from || 'nothing'} -> ${c.toName || c.to || 'nothing'}${c.price ? ` for ${c.price} cr` : ''}`) });
  return { homens: src === out ? homens : 0 };
}

// O que uma lista de trocas custa, e a recusa de tudo que nao fecha. Pura: a tela e o servidor
// cobram pelo mesmo caminho.
export function priceGear(gear, { units, catalog }, R) {
  const porHomem = new Map();
  for (const u of units) for (const m of u.men) porHomem.set(m.index, { ...m, unit: u });
  const out = [];
  for (const g of gear || []) {
    const m = porHomem.get(Number(g.index));
    if (!m) throw new Error(`there is no soldier with index ${g.index} in this save`);
    if (!m.canChange) throw new Error(`${m.name} cannot change weapon${m.why === 'crew' ? ': he is the crew of a machine' : m.why === 'down' ? ': he is down, and comes back with the weapon of his slot' : ''}`);
    const menu = catalog[m.unit.nation] || [];
    const escolha = menu.find((x) => x.weapon === String(g.weapon));
    if (!escolha) throw new Error(`${m.name}: ${g.weapon} is not a weapon his army is known to carry`);
    if (escolha.weapon === m.weapon) continue;          // ja tem essa: nao cobra nem escreve
    // `slot` vai junto desde a E78: o indice do homem anda quando o roster cresce, mas (coreId,
    // vaga) nao. E por (coreId, vaga) que a campanha lembra a arma comprada, para o reset de arma
    // nao desfazer de graca o que o jogador pagou.
    out.push({ index: m.index, slot: m.slot, name: m.name, coreId: m.unit.coreId, from: m.weapon, fromName: m.weaponName, to: escolha.weapon, toName: escolha.name, class: escolha.class, price: escolha.price });
  }
  return { changes: out, cost: out.reduce((a, x) => a + x.price, 0) };
}

// O KIT DE FABRICA DE UMA UNIDADE, antes de os homens existirem (28/09). Na criacao da campanha o jogo
// ainda nao nomeou ninguem — os homens nascem quando a unidade pisa no mapa —, mas a colheita de
// fabrica sabe o que cada vaga recebe. `type` = [val, tab] do no da biblioteca; `ARMY|val,tab` e unico
// em `fabrica.tipos`. Sem linha: null (a tela diz "no factory data").
export function factoryKit(factory, nation, type) {
  if (!factory?.tipos || !Array.isArray(type)) return null;
  const [val, tab] = type;
  const t = Object.values(factory.tipos).find((x) => x.exercito === nation && x.val === val && x.tab === tab);
  if (!t) return null;
  const nomes = weaponNames();
  return Object.entries(t.vagas).sort((a, b) => Number(a[0]) - Number(b[0])).map(([slot, v]) => {
    const w = v.mao1 || (v.maos || []).find((k) => k !== NO_WEAPON) || NO_WEAPON;
    const outra = (v.maos || []).find((k) => k !== w && k !== NO_WEAPON) || null;
    return { slot: Number(slot), weapon: w, weaponName: nomeDe(nomes, nation, w), second: outra, secondName: outra ? nomeDe(nomes, nation, outra) : null };
  });
}

// O SOLDADO QUE CAI PERDE A ARMA COMPRADA (28/09, autor): "soldado caido de uma batalha para outra
// perde a arma e volta para a arma dele default". Caido = o que se paga para repor (estado 2/3); o
// ferido leve fica na unidade com o equipamento e mantem a compra. Sem reembolso. Pura: devolve o
// `state.gear` sem as vagas `fallen` = [{ coreId, slot }] e o que foi esquecido, para o log.
export function forgetGear(gear, fallen) {
  const out = {};
  for (const [id, vagas] of Object.entries(gear || {})) out[id] = { ...vagas };
  const esquecidas = [];
  for (const f of fallen || []) {
    const v = out[f.coreId];
    if (!v || v[f.slot] === undefined) continue;
    esquecidas.push({ coreId: Number(f.coreId), slot: Number(f.slot), weapon: v[f.slot], name: f.name || null });
    delete v[f.slot];
    if (!Object.keys(v).length) delete out[f.coreId];
  }
  return { gear: out, forgotten: esquecidas };
}

// A ESCRITA: dois bytes por homem, no lugar, e mais nada. A municao da arma nova entra no passo
// seguinte do refit, que olha a arma que o homem segura.
export function applyGear({ save, out, changes, trace }) {
  const porHomem = {};
  for (const c of changes || []) {
    const [classe, item] = String(c.to).split('/').map(Number);
    if (!Number.isInteger(classe) || !Number.isInteger(item)) throw new Error(`${c.name}: ${c.to} is not a weapon id`);
    porHomem[c.index] = { classe, item };
  }
  if (!Object.keys(porHomem).length) return { homens: 0, detalhe: [] };
  const r = rearmMen(save, out, porHomem);
  trace.wrote('gear.save', out);
  trace.event('gear.apply', {
    men: r.homens,
    changes: (changes || []).map((c) => `${c.name} (core ${c.coreId}): ${c.fromName || c.from} -> ${c.toName || c.to}${c.price ? ` for ${c.price} cr` : ''}`),
    written: r.detalhe.map((d) => `${d.nome}: ${d.de} -> ${d.para}`),
  });
  return r;
}
