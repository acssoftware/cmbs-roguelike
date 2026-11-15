// WHO IS IN THE FORCE, MAN BY MAN.
//
// The campaign has always known its units; this is the layer below — every soldier the game has
// created, which unit he serves in, whether he leads it, and what he is carrying. It is read from
// the same campaign save the rest of the app reads (FORMATO 111.13), so nothing here is typed in
// or remembered: it is what the game wrote at the end of the last battle.
//
// A word on attributes: in CM they belong to the UNIT, not to the man (FORMATO 38-40). A squad is
// Veteran, not the rifleman in it. So a soldier's row carries his squad's experience, motivation
// and leadership, and says as much.
import fs from 'node:fs';
import path from 'node:path';
import { RESEARCH_DIR } from './settings.mjs';
import { readRosterTails, readRoster, EXPERIENCE_LEVELS, unitKills, unitTypeName, unitBlocks2, vehicleLaunchers } from './re.mjs';
import { weaponNames } from './gear.mjs';

// What a man is carrying (FORMATO 113.1). The name comes from `research/armas.json`, read from the
// game's own tooltip: the panel lists a unit's men BY COLUMN and that order is the roster's, which
// is what turns a `classe/item` into a weapon. Where the pair has not been read yet, the class is
// still the honest answer — "personal weapon" says less than "M4A1" but never says the wrong thing.
const ARMA = {
  2: 'personal weapon',
  3: 'crew-served weapon',
  4: 'heavy weapon',
  8: 'nothing — looted',
};
let nomesDeArma = null;
function tabelaDeArmas() {
  if (nomesDeArma) return nomesDeArma;
  nomesDeArma = new Map();
  try {
    const f = path.join(RESEARCH_DIR, 'armas.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const [par, v] of Object.entries(j.armas || {})) nomesDeArma.set(par, v);
  } catch { /* sem a tabela, a classe continua respondendo */ }
  return nomesDeArma;
}
const armaDe = (c) => {
  if (!c?.arma) return 'unknown';
  const par = `${c.arma.classe}/${c.arma.item}`;
  const achado = tabelaDeArmas().get(par);
  // O que ainda nao foi lido no jogo aparece pela classe, com o par ao lado: e ele que a proxima
  // colheita procura, e sem ele a tela nao diz o que falta.
  if (achado) return achado.confianca === 'confirmado' ? achado.nome : `${achado.nome}?`;
  return `${ARMA[c.arma.classe] || `class ${c.arma.classe}`} ${par}`;
};

// O save que vale agora: na hora de jogar e o que o jogador vai carregar, e com um resultado na
// mesa e o que ele acabou de trazer.
export function currentSave(state) {
  const candidatos = [state.pending?.savePath, state.current?.playFrom?.kind === 'save' ? state.current.playFrom.file : null];
  return candidatos.find((f) => f && fs.existsSync(f)) || null;
}

// O QUE CADA VEICULO LEVA PARA A INFANTARIA (02/10, FORMATO 131): os lancadores da lista do bloco,
// pelo nome do exercito dele, contados ("2 × M136 AT4 · Javelin"). Do save que vale agora.
export function readLaunchers(state, { savePath = null } = {}) {
  const save = savePath || currentSave(state);
  if (!save) return { save: null, vehicles: {} };
  const nomes = weaponNames();
  const exercito = new Map((state.units || []).map((u) => [u.coreId, u.nation || state.nation]));
  const b = unitBlocks2(save);
  const vehicles = {};
  for (const u of b.unidades) {
    const l = vehicleLaunchers(b.exp, u);
    if (!l) continue;
    const conta = new Map();
    for (const par of l.itens) { const n = nomes[`${exercito.get(u.coreId)}|${par}`] || par; conta.set(n, (conta.get(n) || 0) + 1); }
    vehicles[u.coreId] = [...conta].map(([n, q]) => (q > 1 ? `${q} × ${n}` : n)).join(' · ');
  }
  return { save: path.basename(save), vehicles };
}

export function readPersonnel(state, { savePath = null } = {}) {
  const save = savePath || currentSave(state);
  if (!save) return { save: null, soldiers: [], note: 'the campaign has not produced a save with a roster yet — battle 1 is still ahead' };

  const roster = readRoster(save);
  const tails = readRosterTails(save);
  const porCoreId = new Map((state.units || []).map((u) => [u.coreId, u]));

  const soldiers = [];
  for (const u of roster.unidades) {
    const dono = porCoreId.get(u.coreId) || {};
    u.soldados.forEach((s, posicao) => {
      const t = tails[s.indice] || null;
      soldiers.push({
        index: s.indice,
        name: s.nome,
        // 0 sao, 1 ferido leve, 2 e 3 baixa (FORMATO 111.14). O jogador ve as tres, nao os bytes.
        state: s.estado === 0 ? 'fit' : s.estado === 1 ? 'wounded' : 'down',
        alive: s.vivo,
        leads: t?.chefeDaUnidade ? 'squad' : t?.lidera ? 'team' : null,
        position: posicao,
        carrying: armaDe(t),
        // a outra mao e os itens de bit (05/10, E145): o lancador, as cargas de demolicao, o laser, a visao noturna
        ...(() => {
          const c = t?.cauda; if (!c || c.length < 9) return { alsoCarrying: null, demo: 0, laser: false, nightVision: false };
          const segunda = c[4] === 8 ? null : armaDe({ arma: { classe: c[4], item: c[5] } });
          return { alsoCarrying: segunda, demo: c[8] & 0x10 ? 4 : c[8] & 0x08 ? 2 : 0, laser: !!(c[7] & 0x08), nightVision: !!(c[8] & 0x80) };
        })(),
        coreId: u.coreId,
        unit: dono.name || `core ${u.coreId}`,
        formation: dono.formation || '',
        // De que exercito ele e. Uma forca do lado americano mistura americanos e ucranianos, e o
        // save nao separa: quem sabe e a escolha da biblioteca que trouxe a unidade.
        nation: dono.nation || state.nation || '',
        role: dono.role || null,
        inTheField: dono.present !== false,
        // Os atributos sao da UNIDADE; o soldado herda a linha do esquadrao dele.
        experience: state.attrs?.[u.coreId]?.experiencia || dono.experience || null,
        motivation: state.attrs?.[u.coreId]?.motivacao || dono.motivation || null,
        // A leadership (18/10) so de quem ja foi pago, e as batalhas sem perdas que ela juntou para o proximo degrau.
        leadership: dono.present !== false ? (state.attrs?.[u.coreId]?.lideranca ?? dono.leadership ?? null) : null,
        cleanBattles: state.cleanBattles?.[u.coreId] ?? 0,
        // Quanto a unidade dele ja fez NO NIVEL em que esta (E50): batalhas e vitorias.
        record: state.record?.[u.coreId] ?? null,
      });
    });
  }

  // THE UNITS WITH NOBODY IN THEM YET. The campaign roster carries a line for every core unit, but
  // the game only NAMES the men when the unit first takes the field — so everything just bought at
  // the quartermaster is in the force, and in the file, with an empty line. Without this the screen
  // looked stale right after a purchase (autor, 27/09: "gerei a nova batalha e o Personnel não
  // refletiu"): the men are not missing, they do not exist yet. How many to expect comes from the
  // roster template, which is the full-strength block the app itself writes (E12/E14A).
  const comGente = new Set(roster.unidades.filter((u) => u.soldados.length).map((u) => u.coreId));
  const naRoster = new Set(roster.unidades.map((u) => u.coreId));
  const waiting = (state.units || [])
    .filter((u) => u.present && !comGente.has(u.coreId))
    .map((u) => ({
      coreId: u.coreId,
      unit: u.name,
      formation: u.formation || '',
      nation: u.nation || state.nation || '',
      role: u.role || null,
      experience: state.attrs?.[u.coreId]?.experiencia || u.experience || null,
      motivation: state.attrs?.[u.coreId]?.motivacao || null,
      leadership: state.attrs?.[u.coreId]?.lideranca ?? u.leadership ?? null,
      cleanBattles: state.cleanBattles?.[u.coreId] ?? 0,
      expected: headcountOf(u),
      inRoster: naRoster.has(u.coreId),
    }));

  const kills = readKills(state, save);

  const vivos = soldiers.filter((s) => s.alive).length;
  return {
    save,
    soldiers,
    waiting,
    kills,
    totals: {
      men: soldiers.length,
      fit: soldiers.filter((s) => s.state === 'fit').length,
      wounded: soldiers.filter((s) => s.state === 'wounded').length,
      down: soldiers.length - vivos,
      units: roster.unidades.filter((u) => u.soldados.length).length,
      leaders: soldiers.filter((s) => s.leads).length,
      waitingUnits: waiting.length,
      waitingMen: waiting.reduce((a, u) => a + (u.expected || 0), 0),
    },
    levels: EXPERIENCE_LEVELS,
  };
}

// Quantos homens um tipo tem quando esta inteiro: o molde de roster que o app usa para criar a
// linha da unidade. Conferido contra os saves — bate em todas as unidades que nao perderam ninguem,
// e nas que perderam o molde e o efetivo cheio, que e exatamente o que se quer aqui.
let moldesPorTipo = null;
function headcountOf(u) {
  if (!Array.isArray(u.type)) return null;
  if (!moldesPorTipo) {
    moldesPorTipo = new Map();
    try {
      const j = JSON.parse(fs.readFileSync(path.join(RESEARCH_DIR, 'tipos_roster.json'), 'utf8'));
      for (const m of Array.isArray(j) ? j : Object.values(j)) moldesPorTipo.set(`${m.val},${m.tab}`, m.blocoN ?? m.n ?? null);
    } catch { /* sem molde, a tela diz "men not named yet" e nao inventa numero */ }
  }
  return moldesPorTipo.get(`${u.type[0]},${u.type[1]}`) ?? null;
}

// THE SCOREBOARD (FORMATO 110.13). The same number the game shows on the last turn as "Total Campaign
// Victories": every unit's block in the roster ends with its enemy casualties and a list of the
// vehicles it knocked out, by type. Credited kills, so they add up to less than the AAR, which also
// counts the enemy that died without a shooter to thank.
export function readKills(state, save) {
  if (!save) return null;
  let r;
  try { r = unitKills(save); } catch (e) { return { units: [], unread: [], error: e.message }; }
  const porId = new Map((state.units || []).map((u) => [u.coreId, u]));
  const aar = (() => { try { return readRoster(save).aar?.azul || null; } catch { return null; } })();
  const units = r.unidades
    .filter((u) => u.baixas || u.veiculos.length)
    .map((u) => {
      const dono = porId.get(u.coreId) || {};
      return {
        coreId: u.coreId,
        unit: dono.name || `core ${u.coreId}`,
        formation: dono.formation || '',
        present: dono.present !== false,
        men: u.baixas,
        vehicles: u.veiculos.map((v) => ({ name: unitTypeName(v.val, v.tab) || `type ${v.val},${v.tab}`, count: v.qtd })),
      };
    });
  return {
    units,
    unread: r.semLeitura.filter((id) => porId.get(id)?.present).map((id) => porId.get(id)?.name || `core ${id}`),
    totals: {
      men: units.reduce((a, u) => a + u.men, 0),
      vehicles: units.reduce((a, u) => a + u.vehicles.reduce((b, v) => b + v.count, 0), 0),
      aarKilled: aar ? aar.mortos : null,
      aarVehicles: aar ? (aar.tanques || 0) + (aar.blindados || 0) + (aar.outrosVeiculos || 0) : null,
    },
  };
}
