// O CAMINHO DE BATALHAS (autor, 10-11/10/2026, E176). A campanha deixa de ser uma fila de 12 batalhas e vira uma
// arvore a la Slay the Spire: a linha n e a batalha n; a linha 1 e o Start (a batalha 1, montada na criacao); das
// linhas 2 a 12 cada linha tem 2-4 nos e cada no liga a 1-3 nos da linha seguinte. O jogador escolhe o caminho.
//
// Cada no traz o que o jogador VE (o tipo da batalha, o multiplicador de creditos, os pontos operacionais que paga)
// e dois SEGREDOS (o mapa e a composicao inimiga), sorteados aqui, na criacao, para que revelar mostre exatamente o
// que ele vai enfrentar. `planDefense` e cega para a forca e os creditos do jogador e deterministica pela semente,
// entao a composicao de um no fixada hoje e a mesma que o Apply monta daqui a dez batalhas.
//
// O segredo mora em `path.json` (nunca servido); o estado guarda so o `publicView` de cada no. Tudo aqui e puro,
// salvo `generatePath`, que planeja as defesas (le a biblioteca).
import { rng, tierOf, planDefense } from './defense.mjs';
import { mapCensus, meetPool, meetFits, loadsInGame, authoredPlan, mapFile } from './catalog.mjs';
import { planMeetForce } from './meet.mjs';

export const ROWS = (R) => R.battlesToWin || 12;
// O START E UM NO VAZIO na linha 0 (autor, 11/10): a batalha 1 e uma escolha entre os nos da linha 1, como as outras.
export const START_ID = 'start';
export const nodeId = (row, col) => `r${row}c${col}`;

// Um inteiro de 32 bits a partir de uma semente e de um texto: a semente de cada no (e de cada sorteio) e
// independente da ordem em que os nos sao gerados.
export function hashSeed(seed, text) {
  let h = (seed >>> 0) ^ 0x811c9dc5;
  for (const ch of String(text)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function weighted(list, r, key = 'w') {
  const total = list.reduce((a, x) => a + (x[key] || 0), 0);
  let v = r() * total;
  for (const x of list) {
    v -= x[key] || 0;
    if (v < 0) return x;
  }
  return list[list.length - 1];
}

// Duas arestas da mesma linha se cruzam quando trocam de ordem entre uma linha e a seguinte.
const crosses = (a1, b1, a2, b2) => (a1 < a2 && b1 > b2) || (a1 > a2 && b1 < b2);

// A FORMA: so linhas, colunas e arestas. Caminhadas que sobem uma linha por vez, para a coluna ao lado ou a mesma,
// sem cruzar o que ja foi desenhado; um no existe onde alguma caminhada passa. Uma forma com alguma linha abaixo do
// minimo e refeita com a sub-semente seguinte (deterministico). As caminhadas comecam na linha 1; o Start (linha 0)
// liga a toda ela.
export function pathShape(seed, R) {
  const P = R.path || {};
  const cols = P.columns || 4, walks = P.walks || 5, minW = (P.rowWidth || [2, 4])[0];
  const rows = ROWS(R);
  for (let tentativa = 0; tentativa < 200; tentativa++) {
    const r = rng(hashSeed(seed, `shape:${tentativa}`));
    const edges = new Map();   // "row:a" -> Set(b), de row para row+1
    const at = new Set();      // "row:col"
    const starts = [];
    for (let w = 0; w < walks; w++) {
      let c = Math.floor(r() * cols);
      // as duas primeiras caminhadas saem de colunas diferentes, senao a linha 1 nasce com um no so
      if (w === 1) while (c === starts[0]) c = Math.floor(r() * cols);
      starts.push(c);
      at.add(`1:${c}`);
      for (let row = 1; row < rows; row++) {
        const cand = [c - 1, c, c + 1].filter((x) => x >= 0 && x < cols);
        for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
        const ok = cand.find((b) => {
          for (const [k, set] of edges) {
            const [er, ea] = k.split(':').map(Number);
            if (er !== row) continue;
            for (const eb of set) if (crosses(c, b, ea, eb)) return false;
          }
          return true;
        });
        const next = ok ?? c;
        const k = `${row}:${c}`;
        if (!edges.has(k)) edges.set(k, new Set());
        edges.get(k).add(next);
        at.add(`${row + 1}:${next}`);
        c = next;
      }
    }
    const porLinha = new Map();
    for (const k of at) { const [row, col] = k.split(':').map(Number); porLinha.set(row, [...(porLinha.get(row) || []), col]); }
    let curta = false;
    for (let row = 1; row <= rows; row++) if ((porLinha.get(row) || []).length < minW) curta = true;
    if (curta) continue;
    const nodes = [{ id: START_ID, row: 0, col: (cols - 1) / 2, edges: (porLinha.get(1) || []).sort((a, b) => a - b).map((c) => nodeId(1, c)) }];
    for (let row = 1; row <= rows; row++) {
      for (const col of porLinha.get(row).sort((a, b) => a - b)) {
        const next = [...(edges.get(`${row}:${col}`) || [])].sort((a, b) => a - b).map((b) => nodeId(row + 1, b));
        nodes.push({ id: nodeId(row, col), row, col, edges: row === rows ? [] : next });
      }
    }
    return { nodes, columns: cols, rows, attempt: tentativa };
  }
  throw new Error('could not draw a battle path with these rules');
}

// Os ancestrais de cada no (todo no de onde ele se alcanca), para que nenhum caminho repita um mapa.
export function ancestorsOf(nodes) {
  const pais = new Map(nodes.map((n) => [n.id, []]));
  for (const n of nodes) for (const e of n.edges) pais.get(e)?.push(n.id);
  const memo = new Map();
  const go = (id) => {
    if (memo.has(id)) return memo.get(id);
    const out = new Set();
    for (const p of pais.get(id) || []) { out.add(p); for (const x of go(p)) out.add(x); }
    memo.set(id, out);
    return out;
  };
  for (const n of nodes) go(n.id);
  return memo;
}

export const childrenOf = (path, id) => {
  const n = (path.nodes || []).find((x) => x.id === id);
  return n ? n.edges : [];
};

// O tipo do no: a batalha comum (null) ou, com `meetShare` > 0, um Meeting Engagement — so numa linha cujo tier tem mapa
// de encontro elegivel (`meet`) que ainda nao esta no caminho ate ali (`banned`: um caminho nao repete mapa). 23/10: sem
// Probe/Attack/Assault, que eram o mesmo mapa; o sorteio que escolhia entre eles continua consumido, para a semente de um
// caminho sortear os mesmos mapas.
function kindFor(row, R, r, meet = [], banned = new Set()) {
  const tier = tierOf(row, R);
  if ((R.path?.meetShare || 0) > 0 && r() < R.path.meetShare) {
    const sizes = new Set(tier.mapTiers || [tier.tier]);
    // 17/10: um mapa "3-4" serve aos dois tiers e um "b1" so a batalha 1 (meetFits)
    if (meet.some((m) => meetFits(m, sizes, row) && !banned.has(m.familia || m.f))) return 'Meet';
  }
  r();
  return null;
}

const familia = (m) => m.familia || m.f;
const menosUsados = (lista, uses) => { const min = Math.min(...lista.map((m) => uses.get(familia(m)) || 0)); return lista.filter((m) => (uses.get(familia(m)) || 0) === min); };

// O MAPA DO NO: do tier da linha, do tipo do no, que caiba a forca de hoje, nunca um mapa de um ancestral (um
// caminho nao repete mapa) e, se der, nao o de um irmao da mesma linha. Os degraus de folga ficam no `why`.
function mapFor({ row, kind, R, census, meet, fits, banned, uses, siblings, r }) {
  const tier = tierOf(row, R);
  const sizes = new Set(tier.mapTiers || [tier.tier]);
  const base = (kind === 'Meet' ? meet.filter((m) => meetFits(m, sizes, row)) : census.filter((m) => sizes.has(m.tier))).filter((m) => loadsInGame(m, R));
  const com = (lista, k) => lista.filter((m) => k !== 'Meet' || m.tipo === 'Meet');
  const ladder = [
    { pool: com(base, kind).filter((m) => !banned.has(familia(m)) && !siblings.has(familia(m)) && (m.capVermelho ?? 0) >= fits), why: null },
    { pool: com(base, kind).filter((m) => !banned.has(familia(m)) && (m.capVermelho ?? 0) >= fits), why: 'a sibling has the same map' },
    // um no onde caminhos se juntam pode ter todos os mapas do tier entre os ancestrais (o tier 3 tem 4): o que menos
    // caminhos ja usaram
    { pool: menosUsados(com(base, kind).filter((m) => (m.capVermelho ?? 0) >= fits), uses), why: 'every map of the tier is on the way here' },
    { pool: base, why: 'the force fits nowhere in the tier' },
  ].filter((s) => s.pool.length);
  if (!ladder.length) throw new Error(`no usable map for battle ${row} (tier ${tier.tier})`);
  const pool = ladder[0].pool.slice().sort((a, b) => (a.f < b.f ? -1 : 1));
  return { map: pool[Math.floor(r() * pool.length)], why: ladder[0].why };
}

// A GUERRA ELETRONICA DO INIMIGO (17/10/2026, tabela do autor): sorteada por no, pelo tier da linha. `R.ew.enemyByTier[tier]`
// da a chance de Light, Medium e Strong; o resto e None. Cada no tem o seu sorteio (`ew:<id>`), fora do stream dos nos —
// um sorteio a mais ali mudaria tipo, peso, mapa e inimigo de todo caminho ja gerado por semente.
export function ewFor(row, R, r) {
  if (!R.ew?.on) return 'None';
  const tabela = R.ew.enemyByTier?.[String(tierOf(row, R).tier)] || {};
  const x = r();
  let acc = 0;
  for (const nivel of ['Light', 'Medium', 'Strong']) { acc += tabela[nivel] || 0; if (x < acc) return nivel; }
  return 'None';
}

// A HORA DA BATALHA (17/10/2026, tabela do autor): o periodo pelos pesos de `R.battle.timeOfDay.periods` (25 % cada) e uma
// hora cheia uniforme dentro dele. Sorteio proprio por no (`time:<id>`), pelo mesmo motivo do `ew`.
export function timeFor(R, r) {
  const T = R.battle?.timeOfDay;
  if (!T?.on || !(T.periods || []).length) return null;
  const p = weighted(T.periods, r);
  const hour = p.hours[Math.floor(r() * p.hours.length)];
  return { period: p.id, name: p.name, daylight: p.daylight, hour, minutes: hour * 60 };
}

// O CLIMA (17/10/2026, tabela aprovada pelo autor): um perfil pronto (Weather + vento + temperatura + chao, coerentes) pelo
// peso `w`, multiplicado pelo periodo do dia e pelo tier conforme o grupo do perfil (neblina, calor, chuva); a direcao do
// vento e uniforme. `period` = o da hora da batalha (sem hora: so o tier pesa).
export function weatherWeights(period, tier, R) {
  const W = R.battle?.weather;
  if (!W?.on) return [];
  return (W.profiles || []).map((p) => {
    const g = p.group || p.id;
    const fp = period ? (W.byPeriod?.[period]?.[g] ?? W.byPeriod?.[period]?.[p.id] ?? 1) : 1;
    const ft = W.byTier?.[String(tier)]?.[g] ?? W.byTier?.[String(tier)]?.[p.id] ?? 1;
    return { p, w: p.w * fp * ft };
  }).filter((x) => x.w > 0);
}
export function weatherFor(row, period, R, r) {
  const pesos = weatherWeights(period, tierOf(row, R).tier, R);
  if (!pesos.length) return null;
  const { p } = weighted(pesos, r);
  const N = R.battle.weather.names || {};
  const windSource = Math.floor(r() * 8);
  return {
    id: p.id, name: p.name, weather: p.weather, wind: p.wind, windSource, temp: p.temp, ground: p.ground,
    label: `${N.weather?.[p.weather] ?? p.weather}, wind ${String(N.wind?.[p.wind] ?? p.wind).toLowerCase()}${p.wind ? ` from the ${N.windSource?.[windSource] ?? windSource}` : ''}, ${String(N.temp?.[p.temp] ?? p.temp).toLowerCase()}, ${String(N.ground?.[p.ground] ?? p.ground).toLowerCase()} ground`,
  };
}

// O CALENDARIO DA CAMPANHA (17/10/2026, autor): uma data por batalha N, valida para qualquer no da linha N. Cada tier tem a
// sua janela (`R.battle.calendar.byTier`, "MM-DD" inclusive); as batalhas do tier sorteiam um dia cada na janela e saem
// em ordem — nao decrescente dentro do tier e, como as janelas nao se cruzam, na campanha toda. So da semente: vale para
// campanha sem caminho e para caminho ja gerado. `month` e 0-based, como no arquivo.
const MESES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ANTES_DO_MES = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];   // 2017
const diaDoAno = (mmdd) => { const [m, d] = mmdd.split('-').map(Number); return ANTES_DO_MES[m - 1] + d; };
const deDiaDoAno = (n) => { let m = 11; while (ANTES_DO_MES[m] >= n) m--; return { month: m, day: n - ANTES_DO_MES[m] }; };
export function campaignCalendar(seed, R) {
  const C = R.battle?.calendar;
  if (!C?.on) return {};
  const out = {};
  for (const t of R.tiers || []) {
    const janela = C.byTier?.[String(t.tier)];
    if (!janela) continue;
    const [a, b] = janela.map(diaDoAno);
    const r = rng(hashSeed(seed, 'calendar:' + t.tier));
    const dias = t.battles.map(() => a + Math.floor(r() * (b - a + 1))).sort((x, y) => x - y);
    t.battles.forEach((n, i) => { const d = deDiaDoAno(dias[i]); out[n] = { ...d, year: C.year || 2017, label: `${d.day} ${MESES[d.month]} ${C.year || 2017}` }; });
  }
  return out;
}

// O BALANCO DO NO (18/10/2026, autor: "nos com mais de uma ramificacao tem que custar mais caro, pois poder de decisao e
// beneficio"). Beneficios: ramificacoes alem da primeira, pontos operacionais, inimigo leve (-20% cr). Dificuldades: inimigo
// pesado (+30% cr), EW inimiga (por nivel), iluminacao ruim (noite para a defesa, dia para o encontro), temperatura extrema.
// O saldo alvo (beneficios - dificuldades) sai de `balance.targets`; o que falta e completado com o peso do inimigo e pontos
// (falta beneficio) ou com o peso, mais EW dentro do que o tier permite e a luz ruim (falta dificuldade). O que nao fecha
// fica em `residual`. Sem balanco, peso e pontos sorteados como antes (enemyWeights, opsRewards). Sorteio proprio do no.
export function balanceNode({ s, kind, ew, time, weather, R, r }) {
  const P = R.path || {};
  const pesos = P.enemyWeights || [{ id: 'normal', budget: 1, mult: 1, w: 1 }];
  const pesoDe = (id) => pesos.find((x) => x.id === id) || pesos.find((x) => x.id === 'normal') || pesos[0];
  const B = P.balance;
  if (!B?.on) return { band: weighted(pesos, r), ops: weighted(P.opsRewards || [{ ops: 0, w: 1 }], r).ops, ew, time, balance: null };
  const pts = B.points || {};
  const val = (k, d = 1) => (Number.isFinite(pts[k]) ? pts[k] : d);
  const ewPts = (lvl) => (pts.ew || {})[lvl] || 0;
  const tipoLuz = kind === 'Meet' ? 'Meet' : 'defense';
  const ruins = B.badLight?.[tipoLuz] || [];
  const luzRuim = (t) => !!t && ruins.includes(t.period);
  const extremo = !!weather && (B.extremeTemps || []).includes(weather.temp);
  const tier = String(tierOf(s.row, R).tier);
  const ramos = Math.max(0, (s.edges || []).length - 1);
  const conta = ({ band, ops, ew: e, time: t }) => ({
    benefits: ramos * val('branch') + ops * val('ops') + (band === 'light' ? val('lightEnemy') : 0),
    difficulties: ewPts(e) + (luzRuim(t) ? val('badLight') : 0) + (extremo ? val('extremeTemp') : 0) + (band === 'heavy' ? val('heavyEnemy') : 0),
  });
  const net = weighted(B.targets || [{ net: 0, w: 1 }], r).net;
  let band = 'normal', ops = 0, e = ew, t = time;
  const base = conta({ band, ops, ew: e, time: t });
  let falta = net - (base.benefits - base.difficulties);
  if (falta > 0) {
    if (r() < (B.lightEnemyChance ?? 0.4)) { band = 'light'; falta -= val('lightEnemy'); }
    if (falta > 0) { ops = Math.min(B.maxOps ?? 2, Math.floor(falta / val('ops'))); falta -= ops * val('ops'); }
  } else if (falta < 0) {
    band = 'heavy'; falta += val('heavyEnemy');
    // mais EW, um nivel por vez, so ate onde o tier sorteia
    const niveis = ['None', 'Light', 'Medium', 'Strong'];
    const doTier = R.ew?.on ? Object.entries(R.ew.enemyByTier?.[tier] || {}).filter(([, p]) => p > 0).map(([k]) => k) : [];
    while (falta < 0) {
      const prox = niveis[niveis.indexOf(e || 'None') + 1];
      if (!prox || !doTier.includes(prox)) break;
      falta += ewPts(prox) - ewPts(e); e = prox;
    }
    // e a luz ruim do tipo, se o clima sorteado existe nesse periodo
    if (falta < 0 && t && !luzRuim(t)) {
      const per = (R.battle?.timeOfDay?.periods || []).find((p) => ruins.includes(p.id));
      const climaCabe = !weather || weatherWeights(per?.id, Number(tier), R).some((x) => x.p.id === weather.id);
      if (per && climaCabe) { const hour = per.hours[Math.floor(r() * per.hours.length)]; t = { period: per.id, name: per.name, daylight: per.daylight, hour, minutes: hour * 60 }; falta += val('badLight'); }
    }
  }
  const c = conta({ band, ops, ew: e, time: t });
  return { band: pesoDe(band), ops, ew: e, time: t, balance: { benefits: c.benefits, difficulties: c.difficulties, net, residual: net - (c.benefits - c.difficulties) } };
}

// O CAMINHO INTEIRO, com os segredos. `enemy` = { nation, nations, effort }; `fits` = quantas unidades do jogador
// pisam o mapa hoje (o Apply confere de novo, com a forca do dia). `plan` existe para o teste trocar o planejador por
// um falso, e `planMeet` o do encontro (13/10). `meet` = os mapas de encontro elegiveis (meetPool). O Start nao tem
// mapa nem inimigo: e so a raiz.
export function generatePath({ seed, rules: R, enemy, fits = 0, census = null, meet = null, plan = planDefense, planMeet = planMeetForce }) {
  const shape = pathShape(seed, R);
  const anc = ancestorsOf(shape.nodes);
  const cen = census || mapCensus();
  const mt = meet || ((R.path?.meetShare || 0) > 0 ? meetPool(null, [], 0, R) : []);
  const P = R.path || {};
  const r = rng(hashSeed(seed, 'nodes'));
  const calendario = campaignCalendar(seed, R);
  const byId = new Map();
  const nodes = [];
  for (const s of shape.nodes) {
    if (s.row === 0) {
      const node = { ...s, kind: null, band: null, budget: 1, rewardMult: 1, ops: 0, seed: hashSeed(seed, s.id), map: null, defense: null, ew: null, time: null };
      nodes.push(node); byId.set(s.id, node);
      continue;
    }
    const usados = [...anc.get(s.id)].map((id) => byId.get(id)?.map).filter(Boolean).map(familia);
    const banned = new Set(usados);
    const uses = new Map(); for (const u of usados) uses.set(u, (uses.get(u) || 0) + 1);
    // o tipo e o primeiro sorteio do no (a ordem dos sorteios faz o caminho de uma semente)
    const kind = kindFor(s.row, R, r, mt, banned);
    const siblings = new Set(nodes.filter((x) => x.row === s.row && x.map).map((x) => familia(x.map)));
    const { map, why } = mapFor({ row: s.row, kind, R, census: cen, meet: mt, fits, banned, uses, siblings, r });
    const nodeSeed = hashSeed(seed, s.id);
    // EW, hora, data e clima nos fluxos proprios do no; o balanco (18/10) le os quatro e completa o no com peso e pontos
    const ew0 = ewFor(s.row, R, rng(hashSeed(seed, 'ew:' + s.id)));
    const time0 = timeFor(R, rng(hashSeed(seed, 'time:' + s.id)));
    const date = calendario[s.row] || null;
    const weather = weatherFor(s.row, time0?.period ?? null, R, rng(hashSeed(seed, 'weather:' + s.id)));
    const tipoDoNo = map.tipo === 'Meet' ? 'Meet' : null;
    const bal = balanceNode({ s, kind: tipoDoNo, ew: ew0, time: time0, weather, R, r: rng(hashSeed(seed, 'balance:' + s.id)) });
    const band = bal.band;
    const rewardMult = band.mult ?? 1;
    const ops = bal.ops;
    const ew = bal.ew;
    const time = bal.time;
    // a dificuldade escala so o Attack; o encontro e 1:1 em todo nivel (autor, 01/11)
    const effort = (tipoDoNo === 'Meet' ? 1 : (enemy.effort ?? 1)) * band.budget;
    const args = { nation: enemy.nation, nations: enemy.nations, battleNumber: s.row, rules: R, seed: nodeSeed, profile: map.perfil, kind: tipoDoNo };
    const planner = tipoDoNo === 'Meet' ? planMeet : plan;
    // o encontro le as garantias do mapa (o morteiro fora do mapa garantido, 14/10)
    if (tipoDoNo === 'Meet') args.garantias = authoredPlan(mapFile(map))?.garantias || null;
    const defense = planner({ ...args, effort });
    const node = { ...s, kind: tipoDoNo, band: band.id, budget: band.budget, rewardMult, ops, seed: nodeSeed, map, ...(why ? { mapWhy: why } : {}), defense, ew, time, date, weather, ...(bal.balance ? { balance: bal.balance } : {}) };
    nodes.push(node); byId.set(s.id, node);
  }
  return { version: 2, seed, rows: shape.rows, columns: shape.columns, nodes };
}

// O que da para ler de uma defesa sem montar o .btt: as formacoes da biblioteca de onde ela saiu e o que foi
// comprado, por tipo.
export function formationsOf(defense) {
  const conta = new Map();
  for (const s of defense?.sources || []) {
    const nome = String(s).replace(/\.btt$/i, '').replace(/^\w+ - /, '');
    conta.set(nome, (conta.get(nome) || 0) + 1);
  }
  return [...conta].map(([name, n]) => ({ name, n }));
}

const mapPublic = (m) => (m ? { name: String(m.f).replace(/ (Assault|Attack|Probe|Meet)\s*\.btt$/i, ''), width: m.W, height: m.H, area: m.area, profile: m.perfil, tier: m.tier } : null);

// O QUE A PAGINA VE DE UM NO. A unica porta entre `path.json` e o estado: nada de mapa nem de inimigo sem a
// revelacao paga. `revealed` = { map, formations, full }; `played` (o no ja jogado ou o atual) revela tudo.
export function publicView(node, revealed = {}, { played = false } = {}) {
  const rv = played ? { map: true, formations: true, full: true } : { map: !!revealed.map, formations: !!(revealed.formations || revealed.full), full: !!revealed.full };
  // O QUE FOI PAGO (18/10): o no jogado mostra tudo na tela, mas o briefing so traz a inteligencia comprada. `paid` guarda
  // a compra; quando o no entra na rota, vem do revelado de antes (ou do `paid` que ele ja tinha).
  const pago = revealed.paid || revealed;
  rv.paid = { map: !!pago.map, formations: !!(pago.formations || pago.full), full: !!pago.full };
  const out = { id: node.id, row: node.row, col: node.col, kind: node.kind, rewardMult: node.rewardMult, ops: node.ops, edges: node.edges, revealed: rv };
  // o peso do inimigo e o multiplicador sao a mesma coisa desde 18/10, e o chip de creditos ja o entrega: publico
  if (node.id !== START_ID && node.band) out.band = node.band;
  if (node.balance) out.balance = node.balance;
  // a guerra eletronica do inimigo e publica (autor, 17/10); o counter pago fica no `revealed` do no, como as revelacoes
  if (node.id !== START_ID) { out.ew = node.ew || 'None'; out.ewCountered = !!revealed.ewCountered; rv.ewCountered = !!revealed.ewCountered; }
  // a hora da batalha tambem e publica (autor, 17/10)
  if (node.time) out.time = node.time;
  if (node.date) out.date = node.date;
  if (node.weather) out.weather = node.weather;
  if (rv.map && node.map) out.map = mapPublic(node.map);
  if (node.defense && rv.formations) {
    out.enemy = { nation: node.defense.nation, formations: formationsOf(node.defense) };
    if (rv.full) {
      Object.assign(out.enemy, {
        units: node.defense.units, onMap: node.defense.onMapUnits, offMap: node.defense.offMapUnits,
        experience: node.defense.experience, kept: node.defense.kept || [],
      });
    }
  }
  return out;
}

// O estado publico de um caminho recem-gerado: a rota so tem o Start; a batalha n jogada e `route[n]`.
export function publicPath(secret, { startingPoints = 0 } = {}) {
  return {
    rows: secret.rows, columns: secret.columns,
    nodes: secret.nodes.map((n) => publicView(n, {}, { played: n.id === START_ID })),
    at: START_ID, chosen: null, route: [START_ID], opsPaid: {}, startingPoints,
  };
}

// O preco de uma revelacao, dado o que ja foi revelado. Desde 24/10 (autor) so o mapa e o inimigo inteiro: o nivel
// "formacoes" (1 ponto) saiu, e o inimigo inteiro custa o mesmo para todos.
export function revealCost(what, revealed, R) {
  const c = R.path?.reveal || { map: 1, full: 2 };
  if (what === 'map') return revealed.map ? 0 : c.map;
  if (what === 'full') return revealed.full ? 0 : c.full;
  throw new Error(`there is nothing called "${what}" to reveal — map or full`);
}
