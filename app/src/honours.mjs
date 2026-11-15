// AS MENCOES HONROSAS DA TELA DE FIM (autor, 06/11/2026): no lugar de "The force at the end", categorias que apresentam
// as unidades que se destacaram, cada uma com a batalha em que entrou, o lider, a formacao, os kills, a leadership e a
// veterancia ganhas. Puro (sem disco): `campaignSummary` le os result.json, os kills e os lideres do ultimo save e
// passa tudo aqui.
//
// Kills = o "Total Campaign Victories" que o jogo guarda por unidade (personnel.mjs readKills): homens abatidos e a
// lista de veiculos abatidos por tipo, acumulados na campanha. Creditados a quem atirou, entao somam menos que o AAR.

const TANQUE = /Main Battle Tank/i;

// "Main Battle Tank (T-72B3) #1" -> "T-72B3 #1"; "Multipurpose Vehicle (M1151 HMMWV (Mk19))" -> "M1151 HMMWV (Mk19)".
// O modelo e o primeiro parenteses de nivel zero, com os aninhados dentro; o "#n" do fim vai junto.
export function vehicleNameOf(name) {
  const s = String(name || '');
  const i = s.indexOf('(');
  if (i < 0) return s;
  let fundo = 0, j = i;
  for (; j < s.length; j++) {
    if (s[j] === '(') fundo++;
    else if (s[j] === ')' && --fundo === 0) break;
  }
  if (j >= s.length) return s;
  const copia = s.slice(j + 1).match(/#\d+/);
  return s.slice(i + 1, j) + (copia ? ` ${copia[0]}` : '');
}

// "A / B / C" -> formacao A, subformacao "B / C".
export function splitFormation(f) {
  const partes = String(f || '').split(' / ').filter(Boolean);
  return { formation: partes[0] || '', subFormation: partes.slice(1).join(' / ') };
}

// O lider de cada unidade pelos homens do save (personnel.mjs readPersonnel): quem chefia a unidade, senao o chefe de
// equipe (o comandante do veiculo), senao o primeiro da fila. Entre os vivos primeiro: se o lider caiu, o substituto.
export function leadersOf(soldiers) {
  const porUnidade = new Map();
  for (const s of soldiers || []) {
    if (s.coreId === null || s.coreId === undefined) continue;
    if (!porUnidade.has(s.coreId)) porUnidade.set(s.coreId, []);
    porUnidade.get(s.coreId).push(s);
  }
  const peso = (s) => (s.leads === 'squad' ? 0 : s.leads === 'team' ? 1 : 2);
  const out = new Map();
  for (const [id, homens] of porUnidade) {
    const vivos = homens.filter((s) => s.alive !== false && s.state !== 'down');
    const fila = (vivos.length ? vivos : homens).slice().sort((a, b) => peso(a) - peso(b) || (a.position ?? 0) - (b.position ?? 0));
    if (fila[0]?.name) out.set(id, fila[0].name);
  }
  return out;
}

// Os kills de cada batalha por unidade: o contador do jogo e acumulado e sobrevive a reposicao na vaga, entao o da
// batalha n e o do save dela menos o do save anterior lido. Batalha sem save lido: o que ela fez cai na seguinte.
// `killsByBattle` = Map n -> saida de readKills (acumulada). Devolve Map coreId -> Map n -> { men, vehicles, tanks }.
export function killsPerBattle(killsByBattle) {
  const out = new Map();
  const antes = new Map();
  for (const n of [...killsByBattle.keys()].sort((a, b) => a - b)) {
    const k = killsByBattle.get(n);
    for (const u of k?.units || []) {
      const agora = { men: u.men || 0, vehicles: u.vehicles.reduce((a, v) => a + (v.count || 0), 0), tanks: u.vehicles.filter((v) => TANQUE.test(v.name)).reduce((a, v) => a + (v.count || 0), 0) };
      const a = antes.get(u.coreId) || { men: 0, vehicles: 0, tanks: 0 };
      if (!out.has(u.coreId)) out.set(u.coreId, new Map());
      out.get(u.coreId).set(n, { men: Math.max(0, agora.men - a.men), vehicles: Math.max(0, agora.vehicles - a.vehicles), tanks: Math.max(0, agora.tanks - a.tanks) });
      antes.set(u.coreId, agora);
    }
  }
  return out;
}

// O LIVRO, UMA LINHA POR VIDA (autor, 06/11: "Battle Hired" e "Battle Died"). Um veiculo destruido e reposto na vaga e
// uma maquina nova com o mesmo core id: cada vida vai da batalha em que entrou (a primeira, ou a primeira depois da
// reposicao) ate a batalha em que foi destruida (a marca `destroyed` do result.json daquela batalha). Esquadrao tem uma
// vida so: os homens sao repostos, a unidade nao e refeita.
// `results` = [{ n, r }] em ordem; `killsByBattle` = Map n -> readKills (acumulado, ou vazio); `leadersByBattle` = Map
// n -> (Map coreId -> nome) do save daquela batalha; `machineOf(u)`; `scales` = { experience, leadership }; `spotters`
// (regex no nome): observadores e controladores aereos, a quem o jogo credita o fogo que chamaram — fora de toda lista
// ordenada por kills.
export function unitLedger({ units = [], attrs = {}, wrecked = [], results = [], killsByBattle = new Map(), leadersByBattle = new Map(), machineOf = () => false, scales, spotters = null }) {
  const porBatalha = killsPerBattle(killsByBattle);
  const reposicoes = new Map();
  for (const w of wrecked) if (w.rebuilt) { if (!reposicoes.has(w.coreId)) reposicoes.set(w.coreId, []); reposicoes.get(w.coreId).push(w.battle); }
  const passos = (escala, de, para) => {
    const a = escala.indexOf(de), b = escala.indexOf(para);
    return a < 0 || b < 0 ? 0 : b - a;
  };
  const QUEIMOU = new Set(['destroyed', 'knocked_out']);
  const linhas = [];
  for (const u of units) {
    const machine = !!machineOf(u);
    const base = {
      coreId: u.coreId, name: u.name, vehicle: machine ? vehicleNameOf(u.name) : null, ...splitFormation(u.formation), machine,
      spotter: !machine && !!spotters && spotters.test(String(u.name || '')), present: u.present !== false,
    };
    const vidas = [];
    let vida = null, morreuEm = null;
    for (const { n, r } of results) {
      const g = (r?.progression?.gains || []).find((x) => x.coreId === u.coreId);
      const l = (r?.leadership?.gains || []).find((x) => x.coreId === u.coreId);
      if (!g && !l) continue;
      if (morreuEm !== null) {
        // o destroco so volta depois de reposto: ate la ele nao luta (o jogo nao o poe em campo)
        if (!(reposicoes.get(u.coreId) || []).some((b) => b >= morreuEm && b < n)) continue;
        morreuEm = null; vida = null;
      }
      if (!vida) {
        // `gains.experience` e o nivel DEPOIS da batalha; o de entrada e o `from` da promocao, se ela veio nesta
        const xpDe = g?.experience ? (r.progression.promotions || []).find((p) => p.coreId === u.coreId)?.from || g.experience : null;
        vida = { hired: n, died: null, battles: 0, kills: 0, vehicleKills: 0, tankKills: 0, losses: 0, downed: false, last: n, xpDe, xpAte: g?.experience || null, lidDe: l?.from ?? null, lidAte: l?.to ?? null };
        vidas.push(vida);
      }
      vida.battles++; vida.last = n;
      if (g?.experience) vida.xpAte = g.experience;
      if (l?.to != null) vida.lidAte = l.to;
      const k = porBatalha.get(u.coreId)?.get(n);
      if (k) { vida.kills += k.men; vida.vehicleKills += k.vehicles; vida.tankKills += k.tanks; }
      const nu = (r?.units || []).find((x) => x.coreId === u.coreId);
      if (nu) {
        vida.losses += nu.casualties || 0;
        if (nu.instantiated > 0 && nu.alive === 0) vida.downed = true;
      }
      if (machine && QUEIMOU.has(r?.vehicles?.marks?.[u.coreId])) { vida.died = n; morreuEm = n; }
    }
    vidas.forEach((v, i) => {
      // a vida que chegou viva ao fim termina no que a unidade e hoje; a que morreu, no que era na batalha da morte
      const xpPara = v.died === null ? attrs[u.coreId]?.experiencia || u.experience || v.xpAte : v.xpAte;
      const lidPara = v.died === null ? attrs[u.coreId]?.lideranca ?? u.leadership ?? v.lidAte : v.lidAte;
      linhas.push({
        ...base, life: i + 1, lives: vidas.length, hired: v.hired, died: v.died, battles: v.battles,
        leader: leadersByBattle.get(v.last)?.get(u.coreId) || null,
        kills: v.kills, vehicleKills: v.vehicleKills, tankKills: v.tankKills, losses: v.losses, downed: v.downed,
        experience: { from: v.xpDe, to: xpPara, steps: v.xpDe && xpPara ? passos(scales.experience, v.xpDe, xpPara) : 0 },
        leadership: { from: v.lidDe, to: lidPara, steps: v.lidDe != null && lidPara != null ? passos(scales.leadership, String(v.lidDe), String(lidPara)) : 0 },
      });
    });
  }
  return linhas;
}

// As categorias, na ordem da tela; cada lista cortada em `top` e so as que tem alguem. `value` e a metrica da lista.
export function honourableMentions(ledger, { top = 3, battlesToWin = 12 } = {}) {
  const lutou = ledger.filter((x) => x.battles > 0);
  const metade = Math.floor(battlesToWin / 2);
  const por = (f, desempate = (x) => x.kills) => (a, b) => f(b) - f(a) || desempate(b) - desempate(a) || (a.hired ?? 99) - (b.hired ?? 99) || a.coreId - b.coreId;
  const C = [
    { id: 'kills-vehicle', title: 'Most kills', sub: 'Vehicle', rule: 'enemy men killed by a vehicle crew', metric: 'kills', ok: (x) => x.machine && x.kills > 0, sort: por((x) => x.kills, (x) => x.vehicleKills) },
    { id: 'kills-squad', title: 'Most kills', sub: 'Squad', rule: 'enemy men killed by a squad or team', metric: 'kills', ok: (x) => !x.machine && !x.spotter && x.kills > 0, sort: por((x) => x.kills, (x) => x.vehicleKills) },
    { id: 'untouchable', title: 'Most kills', sub: 'Untouchable', rule: 'the most kills in a life without losing a man or the vehicle', metric: 'kills', ok: (x) => !x.spotter && x.kills > 0 && x.losses === 0 && !x.downed && x.died === null, sort: por((x) => x.kills, (x) => x.vehicleKills) },
    { id: 'vkills-vehicle', title: 'Most vehicle kills', sub: 'Vehicle', rule: 'enemy vehicles knocked out by a vehicle crew', metric: 'vehicleKills', ok: (x) => x.machine && x.vehicleKills > 0, sort: por((x) => x.vehicleKills) },
    { id: 'vkills-squad', title: 'Most vehicle kills', sub: 'Squad', rule: 'enemy vehicles knocked out by a squad or team', metric: 'vehicleKills', ok: (x) => !x.machine && !x.spotter && x.vehicleKills > 0, sort: por((x) => x.vehicleKills) },
    { id: 'veterancy', title: 'Most veterancy gained', sub: null, rule: 'experience steps in a life, from the battle it was hired', metric: 'experience', ok: (x) => x.experience.steps > 0, sort: por((x) => x.experience.steps) },
    { id: 'leadership', title: 'Most leadership gained', sub: null, rule: 'leadership steps in a life, from the battle it was hired', metric: 'leadership', ok: (x) => x.leadership.steps > 0, sort: por((x) => x.leadership.steps) },
    { id: 'hardened', title: 'Battle Hardened', sub: null, rule: 'the squad that took the most losses and was never wiped out', metric: 'losses', ok: (x) => !x.machine && x.losses > 0 && !x.downed, sort: por((x) => x.losses) },
    { id: 'old-guard', title: 'Old Guard', sub: null, rule: 'in the force since battle 1 and still standing at the end, by kills', metric: 'kills', ok: (x) => !x.spotter && x.hired === 1 && x.present && x.died === null && x.kills > 0, sort: por((x) => x.kills, (x) => x.vehicleKills) },
    { id: 'giant-killer', title: 'Giant Killer', sub: null, rule: 'the squad or team that knocked out the most tanks', metric: 'tankKills', ok: (x) => !x.machine && !x.spotter && x.tankKills > 0, sort: por((x) => x.tankKills) },
    { id: 'late-bloomer', title: 'Late Bloomer', sub: null, rule: `hired after battle ${metade}, by kills`, metric: 'kills', ok: (x) => !x.spotter && x.hired > metade && x.kills > 0, sort: por((x) => x.kills, (x) => x.vehicleKills) },
  ];
  const valor = (m, x) => (m === 'experience' ? x.experience.steps : m === 'leadership' ? x.leadership.steps : x[m]);
  return C.map((c) => ({
    id: c.id, title: c.title, sub: c.sub, rule: c.rule, metric: c.metric,
    rows: lutou.filter(c.ok).sort(c.sort).slice(0, top).map((x) => ({ ...x, value: valor(c.metric, x) })),
  })).filter((c) => c.rows.length);
}
