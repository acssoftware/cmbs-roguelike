// WHAT CAN BE BOUGHT AND WHERE THE BATTLE HAPPENS.
//
// Two catalogues, both derived from data already in the repository — nothing is invented here:
//   formations: one .btt per formation in the library autor built with the editor (`LIB`), with
//               the game's own point total from `research/custos.json`;
//   maps:       the quick-battle maps, one version each (Attack), with the census in `research/mapas_attack.json`
//               (area, tier, terrain profile).
//
// A formation is bought as a TREE: the player keeps the sub-formations he wants and the rest
// becomes `ausentes` for the generator (FORMATO 67). Pruning stops at sub-formation level in this
// version — individual units cannot be dropped one by one yet — because a sub-formation is
// addressed unambiguously by name + occurrence, while a single unit needs a name regex that can
// hit the wrong twin.
import fs from 'node:fs';
import path from 'node:path';
import { paths, DATA_DIR, RESEARCH_DIR } from './settings.mjs';
import { openBtt, forceTree, unitAttributes, equipmentRecords, equipmentTable, typeKey, toeVehicleTable } from './re.mjs';

// THE TWO SIDES, which is what the war has, and THE THREE ARMIES, which is what the library has.
// The enemy is a side — the campaign is fought against one of the two — but the player's own
// library is any combination of the three armies he wants, chosen when the campaign is raised.
// That is why the two live side by side here and are not the same list.
export const SIDES = {
  US: { label: 'United States and Ukraine', nations: ['US', 'UKR'], other: 'RU' },
  RU: { label: 'Russia', nations: ['RU'], other: 'US' },
};
export const otherSide = (side) => SIDES[side].other;

export const ARMIES = [
  { code: 'US', label: 'United States', side: 'US' },
  { code: 'UKR', label: 'Ukraine', side: 'US' },
  { code: 'RU', label: 'Russia', side: 'RU' },
];
const ARMY_CODES = new Set(ARMIES.map((a) => a.code));
// Uma lista vinda da tela nunca entra crua: so os codigos conhecidos, sem repeticao, na ordem
// canonica — e uma lista vazia cai no lado americano, que e o padrao de sempre.
export function armiesOf(list, fallback = ['US', 'UKR']) {
  const pedidos = (Array.isArray(list) ? list : String(list || '').split(',')).map((x) => String(x).trim().toUpperCase());
  const bons = ARMIES.map((a) => a.code).filter((c) => pedidos.includes(c) && ARMY_CODES.has(c));
  return bons.length ? bons : fallback;
}

// Fortifications are not offered — except the Target Reference Point, which is a real purchase
// (it collapses the call time of supporting fire). The Ukrainian files do not use the parentheses
// the American and Russian ones do (`UKR - Trench.btt`, not `UKR - (Trench).btt`), and the old
// `^..\s-\s` never matched a three-letter prefix, so every Ukrainian fortification slipped through.
const FORTIFICATION = /^\w+ - \(?(Barbed Wire|Foxholes|Sandbag Wall|Trench|Antipersonnel Mines|Antivehicle Mines|Mixed Mines|Mines \(.*\))\)?\.btt$/;
// `[RU C2 03]`, `[UKR C3 14]` and friends are OTHER ROWS of the editor's purchase list for the same
// formation: 10 of the 49 differ only in rarity, but 25 carry other equipment or another TO&E (the
// `[RU C6 02]` battalion rides BMP-3, not BMP-2M) and 14 are another formation type altogether (the
// self-propelled batteries: 2S3, 2S19M2, the 203mm 2S7M). Measured on 23/09 (FORMATO 124,
// `research/biblioteca_variantes.json`). They stay off the list because the equipment choice is
// offered inside the formation (`equipmentMenu`), the way the editor's blocks do; the files
// themselves are the yardstick that choice is checked against.
const RARITY_VARIANT = / \[(US|RU|UKR) C\d+ \d+\]/;
export const isTrpSource = (file) => /Target Reference Point/.test(file);
// Categories 0x50 and 0x58 are units that never set foot on the map: off-map artillery, aircraft,
// drones (FORMATO 33). The domain forbids a force made only of these.
const OFF_MAP_CATEGORIES = new Set([0x50, 0x58]);

let libCostsCache = null;
let templateCache = null;
const treeCache = new Map();

// THE RULE THAT COSTS A CRASH IF BROKEN: the campaign roster must carry a line for EVERY core
// unit, present or not. A unit whose type has no template in `research/tipos_roster.json` cannot
// get one — its internal type id is not derivable, it has to be harvested from a campaign the
// editor compiled. Pruning marks a unit ABSENT, it does not remove it, so a formation is only
// usable when every unit in it is covered, including the ones the player leaves behind.
export function rosterTemplates() {
  if (templateCache) return templateCache;
  const rows = JSON.parse(fs.readFileSync(paths().typeTable, 'utf8'));
  templateCache = new Set(rows.filter((r) => r.bloco).map((r) => `${r.val},${r.tab}`));
  return templateCache;
}

// A PECA SEM HOMENS PRECISA DO BLOCO DO JOGO (08/11/2026, varredura de artilharia por faccao): o molde do .cam nao serve
// num save para artilharia, drone e aeronave (molde de ate 42 B, roster.crescerRoster) — o doador e um bloco gravado pelo
// jogo, de `research/blocos_sem_homens.json`. Sem ele a entrega parava com erro DEPOIS da compra paga: hoje o US Platoon
// (Mortar [medium]) e os RU Platoon (Howitzer [heavy]) e (Self-Propelled Howitzer [heavy]). Um gemeo dormente na forca
// tambem serviria, mas a loja nao sabe da forca: fica de fora, como a unidade sem molde.
let semHomensCache = null;
function blocosSemHomens() {
  if (semHomensCache) return semHomensCache;
  const rows = JSON.parse(fs.readFileSync(paths().typeTable, 'utf8'));
  let blocos = {};
  try { blocos = JSON.parse(fs.readFileSync(path.join(RESEARCH_DIR, 'blocos_sem_homens.json'), 'utf8')).blocos || {}; } catch { /* sem a tabela: nada coberto */ }
  semHomensCache = new Map(rows.filter((r) => r.bloco).map((r) => { const b = Buffer.from(r.bloco, 'hex'); return [`${r.val},${r.tab}`, b.length > 42 || !!blocos[b.readUInt16LE(4)]]; }));
  return semHomensCache;
}

export function uncoveredUnits(tree) {
  const have = rosterTemplates();
  const comBloco = blocosSemHomens();
  const out = [];
  const walk = (n) => {
    if (!n.isFormation) { const k = `${n.type[0]},${n.type[1]}`; if (!have.has(k)) out.push({ name: n.name, type: n.type }); else if (comBloco.get(k) === false) out.push({ name: n.name, type: n.type, semBloco: true }); return; }
    n.children.forEach(walk);
  };
  tree.roots.forEach(walk);
  return out;
}

function libCosts() {
  if (libCostsCache) return libCostsCache;
  const rows = JSON.parse(fs.readFileSync(paths().libCosts, 'utf8'));
  libCostsCache = new Map(Object.values(rows).map((r) => [r.arquivo, r]));
  return libCostsCache;
}

// What a whole formation costs in the app's own currency, every unit in it taken. The game's own
// point total (`custos.json`) is only in the file for 115 of the 195 sources: a force made only of
// off-map units is saved with a SHORT force header that has no cost field at all — the 80 short
// ones carry two values between them, 76 and 106, which is a kind marker and not a price. So the
// list showed "? pts" for every battery, every aircraft and every drone. The number that decides a
// purchase was always this one anyway.
let regrasCache = null;
const regras = () => (regrasCache ||= JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'rules.json'), 'utf8')));
const priceCache = new Map();
export function formationPrice(file, nation, rules) {
  const key = `${file}|${nation}`;
  if (priceCache.has(key)) return priceCache.get(key);
  let out = { price: null, units: 0, onMapUnits: 0, offMapUnits: 0 };
  try {
    const tree = formationTree(file);
    const keys = [];
    const walk = (n) => { keys.push(n.key); n.children.forEach(walk); };
    tree.roots.forEach(walk);
    const plan = prunePlan(tree, keys);
    out = {
      price: priceUnits(plan.keptUnits, nation, rules).total,
      units: plan.unitsKept, onMapUnits: plan.onMapKept, offMapUnits: plan.offMapKept,
    };
  } catch { /* an unreadable source is dropped by the caller */ }
  priceCache.set(key, out);
  return out;
}

// THE KIND OF FORMATION (autor, 27/09): the library table has a Type column. The rules carry the
// table — first pattern that matches the name wins — so it can be tuned without code.
export function formationType(name, R = regras()) {
  for (const r of R.formations?.types || []) if (new RegExp(r.match).test(name)) return r.type;
  return 'Other';
}

// SPECIAL FORCES: a fixed piece of a library formation (rules.formations.specialForces). The rule
// names subtree roots; the pick keeps exactly those subtrees, and nothing else of the source is ever
// for sale. Null for a source that is not special forces.
export function specialForcesOf(source, R = regras()) {
  const s = String(source || '').replace(/[.]btt$/, '');
  return (R.formations?.specialForces || []).find((x) => x.source === s) || null;
}
export function specialForcesKeep(source, R = regras()) {
  const sf = specialForcesOf(source, R);
  if (!sf) return null;
  const tree = formationTree(sf.source + '.btt');
  const out = [];
  const walk = (n) => { out.push(n.key); n.children.forEach(walk); };
  const acha = (n, k) => (n.key === k ? n : n.children.map((c) => acha(c, k)).find(Boolean) || null);
  for (const k of sf.keep) {
    const no = tree.roots.map((r) => acha(r, k)).find(Boolean);
    if (!no) throw new Error('special forces ' + sf.name + ': ' + k + ' is not a node of ' + sf.source);
    walk(no);
  }
  return out;
}
// A flat price when the rule sets one (10/10: 1000 cr, all Veteran); otherwise what its units are worth.
function specialForcesPrice(sf, nation, R) {
  const plan = prunePlan(formationTree(sf.source + '.btt'), specialForcesKeep(sf.source, R));
  const flat = R.formations?.specialForcesPrice;
  return { price: Number.isFinite(flat) ? flat : priceUnits(plan.keptUnits, nation, R).total, units: plan.unitsKept, offMapUnits: plan.offMapKept };
}

// The tree of a special forces formation as the shop draws it: every kept unit at the rule's experience, and the
// flat price spread over the kept units (in proportion to what each is worth) so the chart adds up to it.
export function specialForcesTree(tree, source, R = regras()) {
  const keep = new Set(specialForcesKeep(source, R) || []);
  const xp = R.formations?.specialForcesExperience || null, flat = R.formations?.specialForcesPrice;
  const kept = [];
  const walk = (n) => { if (!n.isFormation && keep.has(n.key)) kept.push(n); n.children.forEach(walk); };
  tree.roots.forEach(walk);
  if (Number.isFinite(flat) && kept.length) {
    const total = kept.reduce((a, n) => a + (n.price || 0), 0) || kept.length;
    let left = flat;
    kept.forEach((n, i) => { const share = i === kept.length - 1 ? left : Math.round(flat * ((n.price || 1) / total)); n.price = share; left -= share; });
  }
  if (xp) for (const n of kept) n.experience = xp;
  return tree;
}

export function libFormations(nation, { variants = false, rules = null, specialForces = false } = {}) {
  const dir = paths().lib;
  const costs = libCosts();
  // The rules live with the app, not with the campaign; read here rather than taken as an argument
  // so every caller of the library gets prices without having to know about them. campaign.mjs
  // cannot be imported for it — it imports this file.
  const R = rules || regras();
  // as descartadas pelo autor (24/10): fora da loja, da defesa e do encontro
  const descartadas = new Set(R.formations?.discarded || []);
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.btt') && f.startsWith(nation + ' - ')
      && !FORTIFICATION.test(f) && (variants || !RARITY_VARIANT.test(f)) && !descartadas.has(f.replace(/.btt$/, '')))
    .map((f) => {
      const c = costs.get(f) || {};
      const p = formationPrice(f, nation, R);
      return {
        file: f,
        name: f.replace(/\.btt$/, '').replace(/^\w+ - /, ''),
        source: f.replace(/\.btt$/, ''),   // what `gerar_batalha` resolves inside the LIB
        nation,
        trp: isTrpSource(f),
        points: c.pontos ?? null,          // the game's own number, when the file carries it
        price: p.price,                    // what the app charges for all of it
        units: p.units,
        offMapUnits: p.offMapUnits,
        type: formationType(f.replace(/[.]btt$/, '').replace(/^[A-Z]+ - /, ''), R),
      };
    })
    // A source with no units is an empty file: nothing to field, nothing to charge for. Two of the
    // Russian self-propelled gun sources are like that.
    .filter((f) => f.units > 0)
    // Special forces get a line of their own. When the whole source is the special forces (the LRS
    // platoon) the line replaces the plain one; when it is a piece of a company, both are offered.
    // Only the shop window asks for them: the defense planner and the twin finders index the library
    // by file, and a second line with the same file would confuse them.
    .flatMap((f) => {
      const sf = specialForces ? specialForcesOf(f.source, R) : null;
      // uma SF aposentada (18/10, a Sapper russa) sai da vitrine; continua na regra so pelas campanhas que ja a tem
      if (!sf || sf.retired) return [f];
      const p = specialForcesPrice(sf, nation, R);
      const linha = { ...f, name: sf.name, sf: true, type: 'Special Forces', keep: specialForcesKeep(f.source, R), price: p.price, units: p.units, offMapUnits: p.offMapUnits };
      return p.units === f.units ? [linha] : [f, linha];
    })
    .sort((a, b) => (b.units || 0) - (a.units || 0) || a.name.localeCompare(b.name));
}

// What the player can pick from: the armies he chose when the campaign was raised.
// SO DO INIMIGO (12/10/2026): uma formacao com uma unidade sem molde de roster (o Khrizantema, o BRDM-2 (AT-5) das
// variantes do Battalion (Antitank) que o autor salvou) nao pode entrar na forca do jogador — o roster da campanha
// nao a cobriria e o jogo nao carregaria (FORMATO 112.1). O inimigo nao tem roster: a defesa e o encontro compram dela.
export const playerCanField = (f) => { try { return !uncoveredUnits(formationTree(f.file)).length; } catch { return true; } };
// As formacoes so da defesa (rules.formations.defenseOnly, 28/10: as equipes avulsas do editor) nunca vao a loja.
export function libraryForArmies(armies, opts = {}) {
  const soDefesa = new Set((opts.rules || regras()).formations?.defenseOnly || []);
  return armiesOf(armies).flatMap((n) => libFormations(n, opts)).filter((f) => !soDefesa.has(f.source)).filter(playerCanField);
}

// O nome antigo, para quem ainda pensa em lados.
export const libraryForSide = (side, includeOther = false) =>
  libraryForArmies([...SIDES[side].nations, ...(includeOther ? SIDES[otherSide(side)].nations : [])]);

// SINGLE VEHICLES — the game's own "single vehicles" menu, rebuilt from the library.
//
// There is no file for a lone Stryker: the library is formations, and a single vehicle is one leaf
// of one of them. That is enough, because pruning closes upward on its own (`prunePlan`), so a pick
// that keeps ONE leaf is a legal force of one machine, priced and composed like any other.
//
// Deduped by name — the same M1126 appears in a dozen battalions and the player wants to see it
// once — but every COPY is kept, because buying two of the same truck means taking two different
// leaves. A source pruned to one leaf is a force of one machine; pruned to two leaves it is a force
// of two, and that is the whole mechanism. The copies are sorted by price, so the cheapest is used
// first and the entry shows what the next one will cost.
const vehicleCache = new Map();
export function singleVehicles(armies, { rules: R = null } = {}) {
  const nacoes = armiesOf(armies);
  const regras = R || JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'rules.json'), 'utf8'));
  // A LISTA DO QUE SE VENDE COMO ANEXO (18/10, autor), por exercito: sem ela, vale so o filtro de papeis. Entra na chave do
  // cache porque um teste pede o menu sem a lista.
  const PERMITIDOS = regras.singleVehicles?.allow || null;
  const chave = `${nacoes.join(',')}|${PERMITIDOS ? JSON.stringify(PERMITIDOS) : 'all'}`;
  if (vehicleCache.has(chave)) return vehicleCache.get(chave);
  const ROLES = new Set(regras.singleVehicles?.roles || ['apc', 'ifv', 'tank', 'afv', 'recon', 'support', 'engineer']);
  // Types the shop does not sell alone (rules.singleVehicles.exclude: no factory data, or no way to synthesize them).
  const FORA = new Set((regras.singleVehicles?.exclude || []).map((x) => `${x.type[0]},${x.type[1]}`));
  const porNome = new Map();
  for (const f of libraryForArmies(nacoes)) {
    let tree;
    try { tree = formationTree(f.file); } catch { continue; }
    const walk = (node, parent) => {
      if (node.isFormation) { node.children.forEach((c) => walk(c, node)); return; }
      const role = roleOf(node.name, node.offMap, regras);
      if (!ROLES.has(role) || node.offMap || (node.type && FORA.has(`${node.type[0]},${node.type[1]}`))) return;
      if (PERMITIDOS && !(PERMITIDOS[f.nation] || []).includes(node.name)) return;
      if (!porNome.has(node.name)) porNome.set(node.name, { name: node.name, role, type: node.type, copies: [] });
      porNome.get(node.name).copies.push({
        source: f.file, nation: f.nation, key: node.key, under: parent ? parent.name : null,
        price: priceUnit(node, f.nation, regras), experience: node.experience,
      });
    };
    tree.roots.forEach((r) => walk(r, null));
  }
  // As copias sao muitas — 88 Ural-4320 em 22 fontes, 1426 ao todo — e o menu nao precisa de todas.
  // O corte e POR FONTE, as quatro mais baratas de cada uma, e nao "as dez mais baratas": o Abrams
  // so existe em duas fontes, e das dez copias mais baratas NOVE eram do Combined Arms [Task Force].
  // Para quem ja tem esse batalhao na campanha — o autor — o menu nao trazia copia nenhuma que
  // pudesse virar anexo, so tanques dormentes do proprio batalhao dele, noutra companhia. Por fonte
  // o menu sempre traz o que cada fonte tem a dar; sao ~600 copias, uns 55 KB.
  const POR_FONTE = 4;
  const asMaisBaratasDeCadaFonte = (copies) => {
    const n = new Map();
    return copies.filter((c) => { const q = (n.get(c.source) || 0) + 1; n.set(c.source, q); return q <= POR_FONTE; });
  };
  // The headline price is what the machine costs as an EXTRA (E51): a unit of that name at
  // `singleVehicles.experience`, which is the level the forge writes it with. The copies keep
  // their own prices for the fallback path (a leaf of a library source, when the formation the
  // player attaches to is already in the campaign and cannot take an insertion).
  const nivel = regras.singleVehicles?.experience || 'Regular';
  const out = [...porNome.values()].map((v) => {
    v.copies.sort((a, b) => a.price - b.price);
    const comoExtra = priceUnits([{ name: v.name, offMap: false, type: v.type, experience: nivel, single: true }], v.copies[0].nation, regras).total;
    return { ...v, copies: asMaisBaratasDeCadaFonte(v.copies), price: comoExtra, experience: nivel, copyPrice: v.copies[0].price };
  }).sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
  vehicleCache.set(chave, out);
  return out;
}

// ON MAP / OFF MAP, sem tocar num byte.
//
// O jogo oferece a escolha ao comprar um morteiro ou um obus: fora do mapa ele e chamado por menu,
// com calibragem mais lenta; dentro do mapa reage rapido e pode ser visto e morto. A bandeira que
// diz qual dos dois NAO foi localizada nos bytes (FORMATO, "O nome na arvore carrega mais coisa do
// que o tipo") — o que se sabe ler e `+12`, a categoria de compra, e 0x50 e a artilharia comprada a
// parte.
//
// So que nao e preciso saber qual byte e. A biblioteca ja tem a MESMA peca das duas formas, em
// fontes diferentes: o `2 x 120mm Mortar (M120)` esta dentro do Mortar Platoon do batalhao Stryker
// (+12 = 0x10) e sozinho na `Section (Mortar [heavy])` (+12 = 0x50). Trocar de copia leva junto o
// que quer que faca a diferenca, seja qual for o byte. Nove pecas existem assim, e sao essas as que
// ganham o interruptor — as outras 44 o jogo tambem so oferece de um jeito.
//
// A chave e `NACAO|nome` porque o mesmo morteiro custa e vale coisas diferentes em cada exercito.
//
// A PREMISSA CAIU (autor, 29/10: "neste caso nem existe a opcao on-map desta artilharia"). A copia "no mapa" de todos os
// nove pares era a bateria ORGANICA do batalhao (`organic`: registro sem posicao e sem a marca +12), que o jogo poe FORA
// do mapa sempre (`campaign.offMapCoreIds` conta as sem posicao na batalha montada). O interruptor so trocava uma bateria
// fora do mapa por outra. A organica nao entra mais como lado "on": nao sobra par, e o botao some. Se a biblioteca um dia
// tiver a mesma peca de verdade no mapa (com posicao), ela volta a aparecer aqui sozinha.
const twinCache = new Map();
export function deploymentTwins(armies, { rules: R = null } = {}) {
  const nacoes = armiesOf(armies);
  const chave = nacoes.join(',');
  if (twinCache.has(chave)) return twinCache.get(chave);
  const regras = R || JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'rules.json'), 'utf8'));
  const porNome = new Map();
  for (const f of libraryForArmies(nacoes)) {
    let tree;
    try { tree = formationTree(f.file); } catch { continue; }
    const walk = (node, parent) => {
      if (node.isFormation) { node.children.forEach((c) => walk(c, node)); return; }
      if (node.organic) return;   // fora do mapa no jogo, digam os bytes o que disserem (29/10)
      const role = roleOf(node.name, node.offMap, regras);
      // So tiro indireto: e a unica familia a que o jogo da a escolha.
      if (!/^(mortar|artillery)(_off)?$/.test(role)) return;
      const k = `${f.nation}|${node.name}`;
      if (!porNome.has(k)) porNome.set(k, { nation: f.nation, name: node.name, on: [], off: [] });
      porNome.get(k)[node.offMap ? 'off' : 'on'].push({
        source: f.file, nation: f.nation, key: node.key, under: parent ? parent.name : null,
        price: priceUnit(node, f.nation, regras), experience: node.experience, offMap: !!node.offMap,
      });
    };
    tree.roots.forEach((r) => walk(r, null));
  }
  const out = {};
  for (const [k, v] of porNome) {
    if (!v.on.length || !v.off.length) continue;          // so um jeito: nao ha o que escolher
    // Mais barata primeiro, como nos avulsos: a troca gasta a copia mais em conta que ainda sobrou.
    v.on.sort((a, b) => a.price - b.price);
    v.off.sort((a, b) => a.price - b.price);
    out[k] = v;
  }
  twinCache.set(chave, out);
  return out;
}

// THE GUN OF A BATTERY (FORMATO 124). The editor's choice of tube for an off-map battery — 2S19,
// 2S19M2, 2S3M1, the 203mm 2S7M — is not a list on the gun record (the off-map gun carries none):
// it is ANOTHER FORMATION TYPE, and the library has each one as its own file, the `[RU C3 16]`-style
// rows the list hides. So the choice is made the way On Map / Off Map is: by swapping the pick's
// source for the twin file, which brings whatever makes the difference. Keyed "NATION|base name";
// the base file is the first option. Pairs come from `research/biblioteca_variantes.json`
// (`blocos.variantesDaBiblioteca`, class `formacao-tipo`), and an option whose gun the type
// catalogue cannot name as a gun is left out rather than shown under a wrong label.
const GUN = /Howitzer|Gun|Mortar|Rocket|\d+mm/;
let gunCache = null;
export function gunTwins(armies, { rules: R = null } = {}) {
  const nacoes = armiesOf(armies);
  const chave = nacoes.join(',');
  if (gunCache && gunCache.has(chave)) return gunCache.get(chave);
  const regras = R || JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'rules.json'), 'utf8'));
  let variantes = [];
  try { variantes = JSON.parse(fs.readFileSync(path.join(RESEARCH_DIR, 'biblioteca_variantes.json'), 'utf8')).variantes.filter((v) => v.classe === 'formacao-tipo'); } catch { variantes = []; }
  const out = {};
  for (const n of nacoes) {
    const linhas = new Map(libFormations(n, { variants: true, rules: regras }).map((r) => [r.file, r]));
    const row = (f, gun) => ({ file: f.file, source: f.source, name: f.name, nation: n, points: f.points, price: f.price, units: f.units, offMapUnits: f.offMapUnits, gun });
    for (const v of variantes) {
      if (!v.arquivo.startsWith(`${n} - `)) continue;
      const base = linhas.get(v.base), alt = linhas.get(v.arquivo);
      if (!base || !alt) continue;
      const tubo = (v.diferencas || []).find((d) => d.para > 0 && GUN.test(d.nome))?.nome;
      const tuboBase = (v.diferencas || []).find((d) => d.de > 0 && GUN.test(d.nome))?.nome;
      if (!tubo || !tuboBase) continue;
      const k = `${n}|${base.name}`;
      out[k] = out[k] || { nation: n, base: base.file, options: [row(base, tuboBase)] };
      if (!out[k].options.some((o) => o.file === alt.file)) out[k].options.push(row(alt, tubo));
    }
  }
  for (const g of Object.values(out)) g.options.sort((a, b) => a.price - b.price || a.gun.localeCompare(b.gun));
  gunCache = gunCache || new Map();
  gunCache.set(chave, out);
  return out;
}

// The tree of one library source, ready for the UI. `key` addresses a node ("0.2.1"); `path` is
// the list of {name, occurrence} the generator needs to prune it.
export function formationTree(sourceFile) {
  if (treeCache.has(sourceFile)) return treeCache.get(sourceFile);
  const full = path.join(paths().lib, sourceFile);
  const X = openBtt(full);
  const c = X.completo;
  const T = forceTree(X);
  // The equipment choice each record carries (FORMATO 43.2/41.1): a unit with a list has a GROUP
  // (the editor's block) and can be swapped within it: positioned units and the battalion's own
  // off-map tubes, which have no position. A FORMATION with a list cannot, as changing its type
  // rebuilds everything under it.
  const regs = equipmentRecords(X);

  const trp = isTrpSource(sourceFile);
  const build = (node, key, siblings) => {
    const r = node.r;
    // A Target Reference Point is category 0x60 and the type catalogue has no name for it — it
    // comes back as whatever unit shares its type id (a Stryker, of all things). The source file
    // is the reliable label.
    const bruto = trp && !r.form && c[r.c + 12] === 0x60 ? 'Target Reference Point' : (r.nm || '(unnamed)');
    const occurrence = siblings.filter((s) => (s.r.nm || '(unnamed)') === bruto).indexOf(node) + 1;
    const category = c[r.c + 12];
    const name = readingOf(bruto, OFF_MAP_CATEGORIES.has(category));
    const reg = regs[node.i];
    const escolha = !r.form && reg && reg.n > 0 && /^(time|veiculo|sem-posicao)/.test(reg.kind || '');
    const out = {
      key,
      // The record id, which is what the swap is addressed by in the file (`forge.buildCoreForce`).
      id: r.id,
      name,
      occurrence,
      isFormation: !!r.form,
      offMap: OFF_MAP_CATEGORIES.has(category),
      category,
      type: [r.val, r.tab],
      // `path` is the whole block path: in group 603 the type alone does not say which mortar it is.
      ...(r.form ? {} : { group: escolha ? reg.lista[0] : null, levels: escolha ? reg.n : 0, ...(escolha ? { path: [...reg.lista] } : {}) }),
      // o tubo do morteiro / o obus / o drone do PROPRIO batalhao (registro sem posicao, FORMATO 41.2): 11/10
      ...(!r.form && /^sem-posicao/.test(reg?.kind || '') ? { organic: true } : {}),
      // What the library rolled for this unit. The player can buy a different one, and the price
      // follows (FORMATO 112.13) — but this is the unit's own, and what it costs by default.
      ...(r.form ? {} : { experience: unitAttributes(c, r.c).experiencia }),
      children: node.filhos.map((f, i) => build(f, `${key}.${i}`, node.filhos)),
    };
    out.units = out.isFormation ? out.children.reduce((a, x) => a + x.units, 0) : 1;
    // a organica (sem posicao) conta como fora do mapa, que e onde o jogo a poe (29/10)
    out.offMapUnits = out.isFormation ? out.children.reduce((a, x) => a + x.offMapUnits, 0) : (out.offMap || out.organic ? 1 : 0);
    return out;
  };

  const roots = T.topos.map((t, i) => build(t, String(i), T.topos));
  const tree = { source: sourceFile, roots, units: roots.reduce((a, x) => a + x.units, 0) };
  treeCache.set(sourceFile, tree);
  return tree;
}

// THE EQUIPMENT MENU of a tree (FORMATO 43.2, E95): for every group its units belong to, the options
// the editor's blocks offer in that army, from `research/blocos.json`. `base` is the price of the
// option with no veterancy in it — the screen multiplies by the level it prices the unit at, and the
// server bills the real thing through `priceOfPicks`. Three flags say what the campaign can do with
// the choice: `roster` (a type without a roster template crashes the game on load, so it is not
// offered), `priced` (else the role price stands in) and `refit` (a machine the refit table does not
// know is never resupplied, and says nothing about it — E77).
export function equipmentMenu(tree, nation, R = regras()) {
  const grupos = new Set();
  const walk = (n) => { if (n.isFormation) n.children.forEach(walk); else if (n.group != null) grupos.add(n.group); };
  tree.roots.forEach(walk);
  let tabela; try { tabela = equipmentTable().exercitos?.[nation]?.grupos || {}; } catch { tabela = {}; }
  const have = rosterTemplates(); const precos = tabelaDePrecos();
  let refit = null; try { refit = toeVehicleTable(paths().toeVehicles); } catch { refit = null; }
  const papeis = new Set(R.replacement?.machineRoles || []);
  const foraMaquina = R.replacement?.machineExcludes ? new RegExp(R.replacement.machineExcludes, 'i') : null;
  const groups = {};
  for (const g of [...grupos].sort((a, b) => a - b)) {
    const G = tabela[g]; if (!G) continue;
    // WHAT THE PLAYER READS (E96). The catalogue gives several options the same name — four US
    // `Squad (Rifle)`, three `Squad (Engineer)` — because the name the game ships does not carry the
    // dimension the editor's blocks show (M25 CDTE or M320 GL, Javelin or M240L). `label` adds that
    // reading from the screen labels; `name` stays the real one, which is what prices the unit.
    const vezes = {};
    Object.values(G.opcoes).forEach((o) => { vezes[o.nome] = (vezes[o.nome] || 0) + 1; });
    const usados = {};
    const rotular = (o) => {
      const extra = o.rotuloTela || (vezes[o.nome] > 1 ? o.variante : '') || '';
      const base = extra ? `${o.nome} · ${extra}` : o.nome;
      usados[base] = (usados[base] || 0) + 1;
      return usados[base] > 1 ? `${base} #${usados[base]}` : base;
    };
    const options = Object.values(G.opcoes).map((o) => {
      const role = roleOf(o.nome, false, R);
      const machine = papeis.has(role) && !(foraMaquina && foraMaquina.test(o.nome));
      return {
        type: [o.val, o.tab], key: o.chave || typeKey(o.val, o.tab), name: o.nome, label: rotular(o), path: o.lista, levels: o.niveis, rarity: o.raridade, role,
        base: priceUnits([{ name: o.nome, offMap: false, type: [o.val, o.tab], experience: 'Regular' }], nation, R, { ignoreExperience: true }).total,
        roster: have.has(`${o.val},${o.tab}`),
        priced: precos[`${nation}|${o.nome}`] !== undefined || precos[o.nome] !== undefined,
        machine, refit: machine ? !!(refit && refit[o.nome]) : null,
        // An off-map tube whose name the type catalogue gets wrong (FORMATO 41.1) is shown and shut:
        // the wrong name would be a wrong price, and the player would be buying blind.
        named: !o.duvidoso,
      };
    });
    groups[g] = { label: G.rotulo, levels: G.niveis, options };
  }
  return { nation, groups };
}

// From the FORMATION keys the player kept, produce the `ausentes` list the generator wants plus
// the counts the economy needs.
//
// `keptKeys` holds the keys of everything kept — formations AND individual units. A unit is in the
// force when its own key is there and every formation above it is too: drop a company and
// everything under it goes, whatever the boxes below said.
//
// Only the formation level reaches the generator as `ausentes`. A single unit switched off inside
// a kept formation is handled afterwards, on the core force itself, by clearing its `presente`
// flag by core id — the same switch a purchase turns on (FORMATO 111.21). Doing it by name would
// be ambiguous the moment a platoon has three squads called the same thing.
export function prunePlan(tree, keptKeys) {
  const kept = new Set(keptKeys);

  // A sub-formation taken on its own brings the headings above it. In the file a company cannot
  // exist without its battalion, so the player is not made to tick the parent boxes just to say
  // "this company": anything with something kept under it is kept as a heading. Only headings are
  // added — units are always named one by one, so a heading kept this way still fields nothing of
  // its own, and its unchecked units land in `droppedUnits` like any others.
  const implied = [];
  const closeUpward = (node) => {
    let below = false;
    for (const child of node.children) below = closeUpward(child) || below;
    if (below && !kept.has(node.key)) { kept.add(node.key); implied.push(node.key); }
    return below || kept.has(node.key);
  };
  tree.roots.forEach(closeUpward);

  let unitsTotal = 0, offMapKept = 0;
  const keptUnits = [], droppedUnits = [];

  const count = (node, alive) => {
    const on = alive && kept.has(node.key);
    if (!node.isFormation) {
      unitsTotal += 1;
      // a organica (sem posicao) e fora do mapa no jogo: nao conta para "uma unidade no mapa" nem para o fieldCap (29/10)
      if (on) { keptUnits.push({ key: node.key, name: node.name, type: node.type, offMap: node.offMap, experience: node.experience }); if (node.offMap || node.organic) offMapKept += 1; }
      else if (alive) droppedUnits.push({ key: node.key, name: node.name });   // parent kept, unit unchecked
      return;
    }
    for (const child of node.children) count(child, on);
  };
  for (const root of tree.roots) count(root, true);
  const unitsKept = keptUnits.length;

  // `ausentes` mirrors the tree: a dropped sub-formation is named directly; a kept one that lost
  // children of its own carries them in a nested `ausentes` (FORMATO 67, same shape the editor
  // produces).
  const nest = (node) => {
    const out = [];
    for (const child of node.children) {
      if (!child.isFormation) continue;
      if (!kept.has(child.key)) { out.push({ nome: child.name, ocorrencia: child.occurrence }); continue; }
      const sub = nest(child);
      if (sub.length) out.push({ nome: child.name, ocorrencia: child.occurrence, ausentes: sub });
    }
    return out;
  };

  const ausentes = tree.roots.flatMap((r) => (kept.has(r.key) ? nest(r) : []));
  return { ausentes, keptUnits, droppedUnits, unitsKept, unitsTotal, offMapKept, onMapKept: unitsKept - offMapKept, implied };
}

// ------------------------------------------------------------------- what a unit is, and costs

// The price of a force is the sum of what its units ARE, not a slice of the formation's total.
// A Javelin team and an Abrams used to cost the same; the role table in data/rules.json is what
// tells them apart. A unit that never sets foot on the map is moved to its off-map role first —
// two 120mm mortars on the map are a weapon, the same two called in from off-map are artillery.
const roleCache = new WeakMap();
function roleMatchers(rules) {
  if (roleCache.has(rules)) return roleCache.get(rules);
  const list = rules.units.roles.map((r) => ({ re: new RegExp(r.match, 'i'), role: r.role }));
  roleCache.set(rules, list);
  return list;
}

// A NAME WITH A BAR IN IT IS TWO NAMES. Thirty units in the library come back as
// `Command Vehicle (M1130 Stryker) | AH-64D Apache Longbow (Attack Helicopter)`: the type pair is
// ambiguous and the catalogue offers both readings. Matching the whole string took whichever came
// first in the role table, so an Apache was priced as a Stryker — 188 credits instead of 625, on
// both sides of the battle, since the defense engine prices the same way.
//
// Read separately, one physical fact settles both directions: a unit that never sets foot on the
// map cannot be a Stryker, and a unit standing on the map cannot be an Apache. So off the map the
// aircraft reading wins, on the map the ground one does — and only when neither rule bites does
// the dearer reading win, because over-charging is a smaller sin than handing the player an Apache
// at the price of a truck.
const VOA = new Set(['air', 'drone']);
// UM VEICULO PELO NOME (05/10/2026, E149). O papel sai da arma no nome, e um "Multipurpose Vehicle (M1151 HMMWV (M2))"
// cai em `mg`, um "ATGM Vehicle (M1167 HMMWV)" em `atgm`, um "Mortar Carrier (2S24)" em `mortar`: papeis de tropa a pe.
// Quem decide andar a pe (o desmonte do defensor, a casa/mata da IA) pergunta isto antes do papel.
export const isVehicleName = (name) => /\bVehicle\b|\bCarrier\b|\bTruck\b|HMMWV/i.test(String(name));

// O NOME QUE O JOGADOR LE (06/11, autor: "Mantenha so o texto antes de |"). O nome ambiguo vira uma leitura so, pela
// mesma fisica do papel: no mapa a que anda, fora dele a que voa. "Command Vehicle (M1130 Stryker) | AH-64D Apache
// Longbow (Attack Helicopter) #2" no mapa e "Command Vehicle (M1130 Stryker) #2". Nome sem barra volta igual.
export function readingOf(name, offMap, rules = regras()) {
  const s = String(name ?? '');
  if (!s.includes('|')) return s;
  const [, base, copia = ''] = s.match(/^(.*?)((?:\s+#\d+)?)$/);
  const partes = base.split(/\s*\|\s*/).filter(Boolean);
  if (partes.length < 2) return s;
  const papel = roleOf(base, !!offMap, rules);
  const um = (t) => roleOf(t, !!offMap, rules);
  return (partes.find((p) => um(p) === papel) || partes[0]) + copia;
}

export function roleOf(name, offMap, rules) {
  const um = (texto) => {
    let role = 'other';
    for (const r of roleMatchers(rules)) if (r.re.test(texto)) { role = r.role; break; }
    return offMap ? (rules.units.offMapRole[role] || role) : role;
  };
  const partes = String(name).split(/\s*\|\s*/).filter(Boolean);
  if (partes.length < 2) return um(name);

  const papeis = partes.map(um);
  if (offMap) {
    // Roles a unit can actually have while off the map: the ones the off-map table produces, plus
    // the ones that are off-map by nature.
    const fora = new Set([...Object.values(rules.units.offMapRole), ...VOA]);
    const bom = papeis.find((p) => fora.has(p));
    if (bom) return bom;
  } else {
    const emTerra = papeis.find((p) => !VOA.has(p));
    if (emTerra) return emTerra;
  }
  const preco = (p) => rules.units.price[p] ?? rules.units.price.other;
  return papeis.slice().sort((a, b) => preco(b) - preco(a))[0];
}

// What a unit's experience multiplies its price by. In `absolute` mode a unit is priced for what
// it is, so the Veteran squads the library hands out cost more than the Regular ones next to them;
// in `relative` mode only a CHANGE costs, and a unit left alone is priced exactly as before.
// `baseExperience` is what the unit came with, `experience` is what it will be.
export function experienceFactor(unit, rules) {
  const p = rules.units.experiencePricing;
  const f = rules.units.experienceFactor;
  if (!f || !unit.experience) return 1;
  const agora = f[unit.experience] ?? 1;
  if ((p?.mode || 'absolute') !== 'relative') return agora;
  const antes = f[unit.baseExperience ?? unit.experience] ?? 1;
  return antes ? agora / antes : 1;
}

// O PRECO DE CADA UNIDADE, uma por uma, vindo da planilha do autor.
//
// A tabela por papel deu conta de 230 unidades sem ninguem ter de pensar em cada uma, e por isso
// existiu — mas um Stryker de comando e um caminhao nao custam o mesmo por serem os dois "apc". O
// autor precificou a aba `Unidades` no nivel VETERAN e o resto sai do fator de experiencia, como
// antes. Quem nao esta na planilha cai no papel; a planilha nao precisa ser completa para valer.
let precoPorUnidade = null;
function tabelaDePrecos() {
  if (precoPorUnidade) return precoPorUnidade;
  try { precoPorUnidade = JSON.parse(fs.readFileSync(path.join(RESEARCH_DIR, 'precos_unidades.json'), 'utf8')).precos || {}; }
  catch { precoPorUnidade = {}; }
  return precoPorUnidade;
}

export function priceUnits(units, nation, rules, { ignoreExperience = false } = {}) {
  const u = rules.units;
  const tabela = tabelaDePrecos();
  let total = 0;
  const byRole = {};
  for (const x of units) {
    const role = roleOf(x.name, x.offMap, rules);
    // O diretorio da forca numera os nomes repetidos ("Squad (Rifle) #2"); a planilha nao (E59).
    const nome = readingOf(String(x.name || '').replace(/ #\d+$/, ''), x.offMap, rules);
    // o veiculo AVULSO (Single Vehicle do editor, 17/10) tem chave propria na planilha: "<nome> [single]"
    const daPlanilha = (x.single ? (tabela[`${nation}|${nome} [single]`] ?? tabela[`${nome} [single]`]) : undefined) ?? tabela[`${nation}|${nome}`] ?? tabela[nome];
    // O numero da planilha ja e o preco daquela unidade daquela nacao: nada de fator de nacao em
    // cima, senao o americano pagaria duas vezes pelo que o autor ja pensou uma.
    const base = daPlanilha ?? (u.price[role] ?? u.price.other);
    const factor = daPlanilha !== undefined ? 1 : (u.roleFactor?.[nation]?.[role] ?? u.nationFactor[nation] ?? 1);
    // Um ponto de referencia nao tem veterania: e uma marca no mapa, e o registro dele carrega um
    // valor de experiencia como qualquer outro. Sem esta excecao um TRP "Crack" custava 2,7x.
    const semXP = ignoreExperience || role === 'trp';
    const price = base * factor * (semXP ? 1 : experienceFactor(x, rules));
    total += price;
    byRole[role] = (byRole[role] || 0) + price;
  }
  for (const k of Object.keys(byRole)) byRole[k] = Math.round(byRole[k]);
  return { total: Math.round(total), byRole };
}

// What one unit costs, for the arsenal screen.
export function priceUnit(unit, nation, rules) {
  return priceUnits([unit], nation, rules).total;
}

// ---------------------------------------------------------------- maps

// ONE VERSION OF EACH QUICK-BATTLE MAP (autor, 23/10/2026). The game ships every map three times — Probe, Attack and
// Assault — and the three are the SAME map: terrain, objectives, setup zones and AI plans identical, only the battle
// type byte differs. The app keeps the Attack one (`research/mapas_attack.json`, `assets/qb_attack`). The entries still
// carry `tipo` ('Attack', or 'Meet' for the meeting engagements), which only names the folder and the type byte.
const CENSUS_KINDS = ['Attack'];

// THE MAPS ARE AUTOR'S CHOICE (04/10/2026): `app/data/mapas.json` lists, per map tier, the maps the
// roguelike draws from — every one in its three kinds. Only those enter the pool, and the tier there
// overrides the area tier of the census (four maps the census calls tier 2 he put in tier 1). The
// census still gives the zones, the capacity and the profile. A map is named by its file without the
// kind and `.btt`; runs of spaces do not count (`City  (688 X 736) 047r` has two in the game).
export const mapKey = (f) => f.replace(/\s*CMBSRL\s*(?=\.btt$)/i, '').replace(/\s*(Assault|Attack|Probe|Meet)\s*\.btt$/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
// THE PACKAGED COPY CARRIES A SUFFIX (autor, 04/10/2026): `<game file name> CMBSRL.btt`, so the roguelike's maps
// never pass for the game's own. The census keeps the game's name (`m.f`); only the file on disk differs.
// The game's `Plehany-Open (1200 X 1280) 099 Attack .btt` loses its stray space on the way.
export const PACK_SUFFIX = ' CMBSRL';
export const packName = (f) => f.replace(/\s*\.btt$/i, '') + PACK_SUFFIX + '.btt';
export function mapSelection() {
  const j = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'mapas.json'), 'utf8'));
  const out = new Map();
  for (const [tier, names] of Object.entries(j.tiers)) for (const n of names) out.set(mapKey(n + ' Attack.btt'), +tier);
  return out;
}

// OS MEETING ENGAGEMENT (05/10/2026, E147): a selecao do autor em `mapas.json` > `meet.tiers`, e o censo deles
// (research/mapas_meet.json, so os `serve`) com o tier da selecao. Prontos para o sorteio, que ainda nao os usa.
// A CHAVE DO TIER (autor, 17/10, planilha revisao_ia_mapas.xlsx): "1".."4" = um tier; "3-4" = sorteado em qualquer dos
// tiers da faixa; "b1" = so na batalha 1 (a primeira do tier 1). -> { tiers: [..], battles: [..] | null }
export function meetTierKey(k) {
  const s = String(k).trim();
  let m = s.match(/^b(\d+)$/i); if (m) return { tiers: [1], battles: [+m[1]] };
  m = s.match(/^(\d+)\s*-\s*(\d+)$/); if (m) return { tiers: Array.from({ length: +m[2] - +m[1] + 1 }, (_, i) => +m[1] + i), battles: null };
  if (/^\d+$/.test(s)) return { tiers: [+s], battles: null };
  throw new Error(`mapas.json > meet.tiers: chave de tier desconhecida "${s}"`);
}
export function meetSelection() {
  const j = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'mapas.json'), 'utf8'));
  const out = new Map();
  for (const [k, names] of Object.entries(j.meet?.tiers || {})) { const t = meetTierKey(k); for (const n of names) out.set(mapKey(n + ' Meet.btt'), { ...t, key: k }); }
  return out;
}
// um mapa de encontro serve a uma batalha do tier `sizes` (um Set de tiers de mapa) e, se ele tiver `battles`, so nelas
export const meetFits = (m, sizes, battle = null) => (m.tiers || [m.tier]).some((t) => sizes.has(t)) && (!m.battles || battle == null || m.battles.includes(battle));
// Meet maps whose packaged copy was adjusted before the plan (mapas.json > meet.pacoteAjustado, tools/re/trocar_lados.mjs):
// map key -> { ops: ['trocarLados' | 'unificarSetup', ...], sha256 of the adjusted copy }. The census applies the ops
// in order when it copies the map; test 116 checks the sha (an authored plan's sha still wins).
export function meetAdjusted() {
  const j = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'mapas.json'), 'utf8'));
  return new Map(Object.entries(j.meet?.pacoteAjustado || {}).map(([n, v]) => [mapKey(n + ' Meet.btt'), v]));
}
export function meetCensus() {
  const chosen = meetSelection();
  const file = path.join(path.dirname(paths().mapCensus), 'mapas_meet.json');
  if (!fs.existsSync(file)) return [];
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const perfis = mapProfiles();
  return (j.mapas || []).filter((m) => m.serve && chosen.has(mapKey(m.f))).map((m) => {
    const perfil = perfis.get(mapKey(m.f));
    const sel = chosen.get(mapKey(m.f));
    // `tier` = o menor da faixa (briefing, testes antigos); `tiers` e `battles` decidem o sorteio (meetFits)
    return { ...m, tipo: 'Meet', tierCenso: m.tier, tier: Math.min(...sel.tiers), tiers: sel.tiers, battles: sel.battles, tierKey: sel.key, ...(perfil ? { perfil, perfilCenso: m.perfil } : {}) };
  });
}
// OS ENCONTROS QUE O SORTEIO USA (13/10/2026): os do censo que o jogo carrega e, com `path.meetOnlyAuthored` (autor:
// "so nos mapas com plano autoral"), so os que tem plano de encontro em `planos_ia.json`. `tier` = um tier do censo ou
// uma lista (null = todos); `fits` = unidades do jogador no mapa; `battle` (17/10) = a batalha, para os mapas "b1".
export function meetPool(tier = null, alreadyPlayed = [], fits = 0, R = null, battle = null) {
  const regras = R || JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'rules.json'), 'utf8'));
  const seen = new Set(alreadyPlayed);
  const tiers = tier == null ? null : new Set(Array.isArray(tier) ? tier : [tier]);
  return meetCensus().filter((m) => (!tiers || meetFits(m, tiers, battle)) && !seen.has(m.familia || m.f) && loadsInGame(m, regras)
    && (!regras.path?.meetOnlyAuthored || !!authoredPlan(mapFile(m))?.encontro)
    && (!fits || (m.capVermelho ?? 0) >= fits));
}

// O PERFIL DO AUTOR (12/10/2026): `mapas.json` > `perfis` manda sobre o perfil do censo (que e calculado pela densidade de
// predios), nas tres versoes do mapa, como o tier da selecao manda sobre o tier de area; o do censo fica em `perfilCenso`.
export function mapProfiles() {
  const j = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'mapas.json'), 'utf8'));
  const out = new Map();
  for (const [n, p] of Object.entries(j.perfis || {})) out.set(mapKey(n + ' Attack.btt'), p);
  return out;
}
export function mapCensus() {
  const chosen = mapSelection(); const perfis = mapProfiles();
  const out = [];
  for (const kind of CENSUS_KINDS) {
    const file = path.join(path.dirname(paths().mapCensus), `mapas_${kind.toLowerCase()}.json`);
    if (!fs.existsSync(file)) continue;
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const m of (j.mapas || j)) {
      const tier = chosen.get(mapKey(m.f));
      const perfil = perfis.get(mapKey(m.f));
      if (m.serve && tier) out.push({ tipo: kind, ...m, tierCenso: m.tier, tier, ...(perfil ? { perfil, perfilCenso: m.perfil } : {}) });
    }
  }
  return out;
}

// A map is only usable if the player fits in his own setup zone. The zone the game paints is not
// the number that matters: it is shrunk two columns and one row in from the edge and then walked
// two tiles at a time, and `capVermelho` in the census is that final count, measured the way the
// generator measures it. autor lost a battle to this — 26 units, a zone that held 24, and the
// generator quietly left the force where it stood on the library map, outside the deployment zone.
// `tier` may be one census tier or a list of them (a rules tier can draw from several sizes), and
// `kind` narrows to one kind of map; null takes any.
// MAPS THE GAME CANNOT LOAD (05/10/2026, memory battery m2, E139): rules.maps.memoryExclude. Measured in a fresh
// process with a 3-unit force, the Huge Rough-Water-Town 026r runs out of memory in the briefing (2.64 GB); every
// other map of the selection loads at 1.7-2.4 GB. It stays in the author's selection and out of the draw.
// 12/10: the cause was the scenario mark corrupting a byte of that map's LZ block 0 (E175, refused there since); without
// it the author loaded a minimal and a campaign battle on 026r, so the list is empty. The mechanism stays.
export function loadsInGame(m, R = null) {
  const regras = R || JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'rules.json'), 'utf8'));
  const fora = new Set((regras.maps?.memoryExclude || []).map((x) => mapKey(x + ' Attack.btt')));
  return !fora.has(mapKey(m.f));
}
export function mapPool(tier, alreadyPlayed = [], fits = 0, kind = null) {
  const seen = new Set(alreadyPlayed);
  const tiers = new Set(Array.isArray(tier) ? tier : [tier]);
  const R = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'rules.json'), 'utf8'));
  return mapCensus().filter((m) => tiers.has(m.tier) && !seen.has(m.familia || m.f) && loadsInGame(m, R)
    && (!kind || m.tipo === kind)
    && (!fits || (m.capVermelho ?? 0) >= fits));
}

// Always the packaged copy (qb_attack, qb_meet under assets): the app never reads the game's own
// Quick Battle Maps, so a campaign is the same on every machine (autor, 04/10/2026).
export function mapFile(entry) {
  return path.join(paths().mapsBase, `qb_${String(entry.tipo || 'Attack').toLowerCase()}`, packName(entry.f));
}

// O PLANO DE IA REVISADO PELO AUTOR (08/10/2026, E174): o mapa do pacote que traz o plano dele (`planos_ia.json`, chave
// = caminho relativo a assets/ com `/`) devolve o registro; qualquer outro mapa (inclusive os do jogo, com
// `useGameMaps`) devolve null — e a batalha segue com o rodizio de grupos de sempre.
let planosIA = null;
export function authoredPlan(file) {
  if (!planosIA) { try { planosIA = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'planos_ia.json'), 'utf8')).mapas || {}; } catch { planosIA = {}; } }
  const rel = path.relative(paths().mapsBase, path.resolve(String(file))).split(path.sep).join('/');
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const v = planosIA[rel];
  // um encontro (12/10) traz tambem as variantes do plano de ataque, {"1": "balanced", ...}, que o app sorteia
  return v ? { key: rel, origem: v.origem, formato: v.formato, nota: v.nota, ...(v.encontro ? { encontro: true, variantes: v.variantes || {}, doutrina: v.doutrina || null, grupos: v.grupos || null, garantias: v.garantias || null, alocacao: v.alocacao || null } : {}) } : null;
}
