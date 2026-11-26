// READING WHAT HAPPENED.
//
// At the end of every battle the campaign engine forces a save, and that file carries everything
// the app needs (FORMATO 111.13): the after-action report of both sides, and the campaign roster
// with every soldier by name and a state byte — 0/1 alive, 2/3 casualty. No input from the player
// is asked for or accepted; the numbers come out of the file.
//
// One thing is NOT in there for a campaign the app generated: the victory level. In campaigns
// compiled by the editor the level byte sits at the end of the roster block, but in generated ones
// that block continues with the game state and the suffix is not found (FORMATO 111.27). So the
// app derives it. Not from the two sides against each other, which was the first attempt and read
// every battle where the defense scored nothing as a Total Victory: from what the player did
// against what there WAS to do, which is the sum of the objectives on the map (FORMATO 114). The
// raw numbers go in the log next to the verdict so the reading can always be checked.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths } from './settings.mjs';
import { saveAnatomy, readRoster, readRosterTails, readAmmoVector, readGrenades, grenadePlan, pointsAtStake } from './re.mjs';
import { fileFacts } from './trace.mjs';
import { KIT_BITS, desinverter } from './gear.mjs';

// O QUE SEPARA UM SAVE DE TRANSICAO DE UM SAVE DE DENTRO DA BATALHA.
//
// O container tem dois blocos LZ (secao 95). O segundo e a partida em curso — mapa, posicoes, tudo.
// Entre missoes nao ha partida em curso, e ele encolhe para umas poucas centenas de bytes:
//
//   MVSC - TRANSITION 1        486 B     MVSC - deploy        2.067.203 B
//   MVSC - TRANSITION BTT2     518 B     MVSC - turn 011      2.063.213 B
//   City 016                   572 B     MVSC - major victory 1.047.079 B
//   ZZ APP 7 - TRANSITION      496 B     ZZ APP 7 - DEPLOYMENT 4.434.645 B
//
// Tres ordens de grandeza entre os dois grupos, entao o limiar nao precisa ser fino. Isto importa
// porque um save de meio de batalha PASSA por todo o resto: ele traz o AAR da batalha ANTERIOR e um
// roster sem baixas (o roster so e escrito na virada), o que o app leria como "voce venceu e nao
// perdeu ninguem" — silenciosamente, e uma vez aplicado nao ha volta.
export const LIVE_BATTLE_BYTES = 64 * 1024;
export const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

// Cheap pre-filter, then the real check. Campaign saves are 16-30 MB and reading every one of them
// on every poll would be wasteful, so only files touched after the battle was generated are opened.
export function findCampaignSaves({ battleNames, since = 0, ignore = [] }) {
  const dir = paths().savedGames;
  if (!fs.existsSync(dir)) return [];
  const skip = new Set(ignore);
  const wanted = new Set(battleNames);
  const candidates = fs.readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.bts'))
    .map((f) => {
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      return { file: full, name: f, bytes: st.size, mtime: st.mtimeMs };
    })
    .filter((c) => c.mtime >= since && !skip.has(c.file))
    .sort((a, b) => b.mtime - a.mtime);

  const out = [];
  for (const c of candidates) {
    try {
      const a = saveAnatomy(c.file);
      const embedded = a.batalhas.map((b) => b.nome);
      if (!embedded.some((n) => wanted.has(n))) continue;
      out.push({
        ...c,
        campaignName: a.nome,
        embedded,
        // O arquivo inteiro, para reconhecer uma copia do que o app entregou mesmo com outro nome.
        sha1self: sha1(a.b),
        // O tamanho da partida em curso dentro do arquivo: pequeno = entre missoes.
        liveBytes: a.blocos[1] ? a.blocos[1].t : 0,
        // A batalha embutida sobrevive intacta a ser jogada — conferido byte a byte nos saves do
        // autor — entao o hash dela diz de QUAL batalha este save e.
        battles: a.batalhas.map((b) => ({ name: b.nome, bytes: b.tam, sha1: sha1(a.b.subarray(b.ini, b.fim)) })),
      });
    } catch { /* not a campaign save, or not a save at all */ }
  }
  return out;
}

// O mesmo, para um arquivo so, sem varrer a pasta. Devolve null quando o arquivo nao e um save.
export function saveFacts(file) {
  try {
    const a = saveAnatomy(file);
    return {
      campaignName: a.nome,
      embedded: a.batalhas.map((b) => b.nome),
      sha1self: sha1(a.b),
      liveBytes: a.blocos[1] ? a.blocos[1].t : 0,
      battles: a.batalhas.map((b) => ({ name: b.nome, bytes: b.tam, sha1: sha1(a.b.subarray(b.ini, b.fim)) })),
    };
  } catch { return null; }
}

// `disponivel` e o potencial do JOGADOR e `disponivelInimigo` o do inimigo: o manual mede o vencedor
// pelo potencial DELE (p.89), e cada lado tem a sua lista (E92, FORMATO 123.2). Sem o segundo, a
// derrota usa o primeiro, como antes.
export function levelFromPoints(playerPoints, enemyPoints, rules, disponivel = 0, disponivelInimigo = 0) {
  const p = playerPoints || 0, e = enemyPoints || 0;
  const total = p + e;
  // O QUE VOCE FEZ CONTRA O QUE HAVIA PARA FAZER (FORMATO 114). Comparar os dois lados dava 100%
  // sempre que a defesa zerava, e toda batalha assim saia Total Victory — a Major Victory de 500 a
  // 0 do autor foi o que pegou. Com os objetivos lidos do arquivo, `share` passa a ser a fracao do
  // que estava em jogo; sem eles, cai no criterio velho e o log diz que caiu.
  const share = disponivel ? Math.min(1, p / disponivel) : (total ? p / total : 0.5);
  // O V DO MANUAL (pp.89-90): `V = (A + 10) / (B + 10)`, nao `A / B`. Os dez pontos sao o
  // amortecedor do jogo, e mudam o veredito nos numeros pequenos que esta campanha produz: 40 x 20
  // e 1,67 e nao 2,0; 100 x 0 e 11 e nao infinito. Com ele nao ha divisao por zero, entao o teto de
  // 999 que existia so para o JSON nao ter Infinity deixou de ser preciso (E93).
  const ratio = (p + 10) / (e + 10);
  const inverse = (e + 10) / (p + 10);

  // Sem os objetivos a leitura cai no criterio velho, com os limiares dele.
  const niveis = disponivel ? rules.victory.levels : rules.victory.semObjetivos.levels;
  const comum = { ratio, share, p, e, available: disponivel || null, from: disponivel ? 'objectives' : 'both sides' };

  for (const step of niveis) {
    if (ratio >= step.ratio && share >= step.share) return { level: step.level, won: true, ...comum };
  }
  // A derrota e a mesma conta do outro lado: a fracao DELE do que estava em jogo.
  const dele = disponivel ? Math.min(1, e / (disponivelInimigo || disponivel)) : 1 - share;
  for (const step of niveis) {
    if (inverse >= step.ratio && dele >= step.share) {
      return { level: step.level.replace('Victory', 'Defeat'), won: false, ...comum };
    }
  }
  return { level: 'Draw', won: null, ...comum };
}

// THE AAR BLOCK IN THE SAVE IS THE CAMPAIGN'S RUNNING TOTAL, NOT THE LAST BATTLE (FORMATO 111.13,
// corrected 12/09). the author's third battle read 350-150 from the block and the game's own screen said
// 150-150, Draw: the block's eight fields were, to the man, the sum of battles one to three. What
// this battle did is the block minus the block of the transition before it. A negative anywhere
// means the block is NOT cumulative (an editor-compiled campaign may differ), and then the raw
// values stand and the log says so.
const AAR_FIELDS = ['mortos', 'feridos', 'desaparecidos', 'tanques', 'blindados', 'outrosVeiculos', 'aeronaves', 'pontos'];
export function aarDelta(now, before) {
  if (!now) return null;
  if (!before) return now;
  const out = {};
  for (const k of AAR_FIELDS) {
    const d = (now[k] || 0) - (before[k] || 0);
    if (d < 0) return null;
    out[k] = d;
  }
  return out;
}
export const AAR_ZERO = Object.fromEntries(AAR_FIELDS.map((k) => [k, 0]));

// The player is always the attacker, and the attacker is the red side on a quick-battle map
// (FORMATO 68). Each AAR block holds that side's OWN losses and its own score — cumulative over
// the campaign, so `previousAar` (the block as it stood before this battle) is what makes the
// numbers this battle's.
export function readTransition(savePath, rules, trace, bttFile = null, previousAar = null) {
  trace?.read('transition.save', savePath);
  const roster = readRoster(savePath);
  const cumulative = roster.aar ? { player: roster.aar.vermelho, enemy: roster.aar.azul } : null;
  let player = roster.aar?.vermelho || null;
  let enemy = roster.aar?.azul || null;
  let base = previousAar ? 'delta' : 'raw';
  if (previousAar && roster.aar) {
    const dp = aarDelta(roster.aar.vermelho, previousAar.player), de = aarDelta(roster.aar.azul, previousAar.enemy);
    if (dp && de) { player = dp; enemy = de; }
    else base = 'raw (the block is not cumulative: a field went negative)';
  }
  trace?.event('transition.aar', { base, previous: previousAar, cumulative, thisBattle: { player, enemy } });

  const units = roster.unidades.map((u) => {
    const soldiers = u.soldados.map((s) => ({ name: s.nome, state: s.estado, alive: s.vivo }));
    return {
      coreId: u.coreId,
      type: u.tipo,
      nominal: u.n,
      instantiated: soldiers.length,
      alive: soldiers.filter((s) => s.alive).length,
      casualties: soldiers.filter((s) => !s.alive).length,
      soldiers,
    };
  });

  // OS PONTOS QUE ESTAVAM EM JOGO, lidos do proprio arquivo da batalha (FORMATO 114). E o
  // denominador do veredito; sem ele a leitura compara os dois lados e fica otimista. Um por lado,
  // da lista de cada um, so objetivo com tile (E92, FORMATO 123.2).
  let disponivel = 0, disponivelInimigo = 0, objetivos = null;
  if (bttFile && fs.existsSync(bttFile)) {
    try {
      const r = pointsAtStake(bttFile, 'vermelho');
      disponivel = r.total;
      disponivelInimigo = r.fonte === 'vagas' ? pointsAtStake(bttFile, 'azul').total : 0;
      objetivos = r.objetivos.filter((o) => o.pontos > 0).map((o) => ({ name: o.nome.trim(), points: o.pontos }));
      trace?.event('transition.objectives', { file: path.basename(bttFile), available: disponivel, availableEnemy: disponivelInimigo || null, from: r.fonte, objectives: objetivos });
    } catch (err) {
      trace?.event('transition.objectivesFailed', { file: path.basename(bttFile), reason: String(err.message).slice(0, 120) });
    }
  }
  const verdict = levelFromPoints(player?.pontos, enemy?.pontos, rules, disponivel, disponivelInimigo);
  if (disponivelInimigo) verdict.availableEnemy = disponivelInimigo;
  if (objetivos) verdict.objectives = objetivos;
  const result = {
    save: fileFacts(savePath),
    campaignName: saveAnatomy(savePath).nome,
    playerForce: roster.playerForce,
    aar: { player, enemy },
    aarCumulative: cumulative,
    aarBase: base,
    verdict,
    // Present in editor-compiled campaigns only; kept when the reader does find it.
    levelInFile: roster.resultados?.length ? roster.resultados[roster.resultados.length - 1] : null,
    totals: {
      units: units.length,
      soldiers: roster.total,
      alive: roster.vivos,
      casualties: roster.baixas,
    },
    units,
  };

  trace?.event('transition.read', {
    save: result.save,
    playerForce: result.playerForce,
    aarPlayer: player,
    aarEnemy: enemy,
    verdict,
    levelInFile: result.levelInFile,
    totals: result.totals,
    note: result.playerForce !== 'red'
      ? 'the save says the player is the BLUE force — the app assumed red (attacker); check the campaign template'
      : undefined,
  });
  return result;
}

// THE LIGHTLY WOUNDED — state 1. Not casualties: the same men, scratched, still standing in their
// squads. The game's own campaign refit rests and patches them up between battles (the eight
// percentages in the .cam, FORMATO 110), so the app does the same and charges nothing for it. What
// costs credits is the man who is GONE (state 2 or 3) and has to be replaced by someone else.
export function lightlyWounded(savePath) {
  return readRoster(savePath).soldados
    .map((s, index) => ({ index, state: s.estado }))
    .filter((s) => s.state === 1)
    .map((s) => s.index);
}

// WHAT THE SLOT IS SUPPOSED TO CARRY — the TO&E, not what the man picked up last battle.
//
// The medics empty a fallen man's inventory (FORMATO 105) and reviving him does not give the weapon
// back, so the app writes it: two bytes, in place (FORMATO 116). Which weapon is a design question
// and the author answered it — a refit resets the squad to its factory equipment. Carrying a looted
// rifle from battle to battle would quietly rewrite the squad over a campaign.
//
// The slot is the man's POSITION inside his unit block (FORMATO 111.20 — the slots are the TO&E
// places, terminated by `ff ff`). Two sources, in this order:
//
//   1. HIS OWN BROTHERS, in this very save: other units of the same type, same slot. In the author's
//      save there were four Ukrainian squads of type 9221 and the three intact ones all read
//      `2/31 2/44 2/36 ...` — slot 1 is a rocket launcher and slot 2 a marksman. Guessing "the most
//      common weapon in the squad" would have handed both of them a rifle.
//   2. `research/toe_armas.json`, harvested from every save the GAME wrote on this machine
//      (`node tools/re/toe_armas.mjs --gravar`), for when no brother is at hand.
//   3. O ITEM QUE ELE MESMO GUARDA, em ultimo caso. Classe 08 e "sem arma", mas o BYTE DO ITEM
//      continua ali: o saqueado le `8/24`, e o 24 e o fuzil que levaram dele (111.14). Falta so a
//      classe, e quem a da e quem carrega esse mesmo item por perto. Fica por ultimo porque a regra
//      e devolver a dotacao da VAGA, e nao o que o homem por acaso carregava.
//
// Neither knows? Then nothing is returned for that man and the writer falls back to the commonest
// weapon in his own unit. Ammo is not written at all — the game's resupply refills it at the turn
// of the battle, proven in E30.
//
// A LINHA DA TABELA TEM DUAS FORMAS, e ler so uma custou uma arma ao autor (E73). A colheita global
// escreve `{ classe, item }`; a linha de base que a campanha aprende sozinha (113.3) escreve
// `{ arma: "2/24" }`. Onde so a campanha conhecia a vaga, `${a.classe}/${a.item}` virou
// "undefined/undefined", o `Number` disso virou NaN, o Buffer gravou NaN como ZERO — e o Tkachuk
// entrou na batalha 5 com `0/0`, um icone vazio no painel. Agora as duas formas sao lidas e nada
// sai daqui sem ser um par de bytes de verdade.
export function toeWeapons(savePath, table = null) {
  const roster = readRoster(savePath);
  const tails = readRosterTails(savePath);
  const weaponOf = (s) => { const a = tails[s.indice]?.arma; return a && a.classe !== 0x08 ? a : null; };

  const byType = new Map();
  for (const u of roster.unidades) {
    if (!byType.has(u.tipo)) byType.set(u.tipo, []);
    byType.get(u.tipo).push(u);
  }

  const out = {};
  for (const u of roster.unidades) {
    u.soldados.forEach((s, slot) => {
      if (weaponOf(s)) return;                     // he still has one
      const votes = new Map();
      for (const brother of byType.get(u.tipo)) {
        if (brother === u) continue;
        const twin = brother.soldados[slot];
        const a = twin && weaponOf(twin);
        if (!a) continue;
        const k = `${a.classe}/${a.item}`;
        votes.set(k, (votes.get(k) || 0) + 1);
      }
      const winner = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
      let choice = winner ? winner[0] : null;
      let from = 'brother squad';
      if (!choice && table && table[u.tipo] && table[u.tipo][slot]) {
        const a = table[u.tipo][slot];
        // duas formas: `{classe, item}` da colheita global e `{arma: "2/24"}` da linha de base
        choice = a.classe !== undefined && a.item !== undefined ? `${a.classe}/${a.item}` : (a.arma || null);
        from = 'harvested table';
      }
      // ULTIMO RECURSO: O ITEM QUE ELE MESMO GUARDA. Classe 08 e "sem arma", mas o byte do ITEM fica
      // (111.14): o saqueado le `8/24` e o 24 e o fuzil que levaram dele. Falta so a classe, e quem
      // a da e quem carrega esse mesmo item por perto. Vem depois da fabrica de proposito — a regra
      // do autor e que o refit devolve a dotacao da VAGA, nao o que o homem por acaso carregava —,
      // mas antes do palpite do escritor ("a arma mais comum do esquadrao"), que num esquadrao de
      // engenharia daria um fuzil ao homem do RPG.
      if (!choice) {
        const meu = tails[s.indice]?.arma;
        if (meu && meu.classe === 0x08 && meu.item) {
          const porItem = new Map();
          const olhar = (lista) => { for (const x of lista) { const a = weaponOf(x); if (a && a.item === meu.item) porItem.set(a.classe, (porItem.get(a.classe) || 0) + 1); } };
          olhar(u.soldados);
          if (!porItem.size) for (const outra of roster.unidades) olhar(outra.soldados);
          const classe = [...porItem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
          if (classe) { choice = `${classe}/${meu.item}`; from = 'item que ele guardava'; }
        }
      }
      if (!choice) return;
      const [classe, item] = String(choice).split('/').map(Number);
      // NADA SAI DAQUI QUE NAO SEJA DOIS BYTES DE VERDADE. Classe 0 nao e arma (e o que o painel
      // mostra como slot vazio), classe 8 e "sem arma", e NaN foi o que gravou o 0/0 do E73.
      if (!Number.isInteger(classe) || !Number.isInteger(item) || classe <= 0 || classe > 7 || item < 0 || item > 255) return;
      out[s.indice] = { classe, item, from };
    });
  }
  return out;
}

// The two weapons of a man's record (FORMATO 113.2): `[00][A1][00][A2][00][flags]...`. `8/0` is
// "none" — the second slot is empty for most men, and the first for a looted casualty.
const NO_WEAPON = '8/0';
// Class 08 is "no weapon" whatever the item byte says (`reinforceMen` tests the class alone, and
// the harvest sees 8/24, 8/29, 8/43 — the looted man keeps the item of what he lost).
const armOf = (classe, item) => (classe === 0x08 ? NO_WEAPON : `${classe}/${item}`);
const armsOfTail = (c) => (c && c.length >= 8 && c[0] === 0 && c[3] === 0) ? { a1: armOf(c[1], c[2]), a2: armOf(c[4], c[5]) } : null;
const sameWeapons = (a, b) => !!a && !!b && [a.a1, a.a2].every((k) => k === b.a1 || k === b.a2) && [b.a1, b.a2].every((k) => k === a.a1 || k === a.a2);

// THE WEAPON THAT WALKED AWAY (E54). When a squad weapon runs dry the game brings the sidearm
// forward — arm 1 becomes the pistol, arm 2 the empty PKM — and drops the pair of the spent
// round. Then buddy aid takes the PKM off the wounded man, and what the transition save has is a
// machine-gunner with a pistol and 48 rounds of 9mm (Sydorenko, EASY2, battle 1). `toeWeapons`
// above only rearms the man with NO weapon (class 08), so he took the pistol into battle 2.
//
// WHO IS TOUCHED: only the man holding a SIDEARM in hand 1 — `sidearms` is the set of weapons the
// harvest sees riding in hand 2 (the pistol: hand 2 of 340 gunners, hand 1 of the five who ran
// dry). The first version acted on any man "missing a weapon his brother carries", and that
// swapped rifles for the slot table's opinion and traded an RPG-22 for the twin squad's RPG-26.
// A rifle in hand 1 is a man in business, whatever else he lost. Without the harvest, nothing
// is touched.
//
// The answer is the slot again: the man is missing a weapon his brother at the same slot carries.
// The brothers vote on the (arm 1, arm 2) pair — a brother who is himself down to the sidearm
// does not outvote the harvested table — and when nobody can vote, the table's weapon goes to
// arm 1 and what the man holds stays as arm 2. Only a MISSING weapon is acted on: a man who has
// both in the other order is the game's business (it lists the one in use first, and swaps back
// once the ammunition is there).
//
// Returns `{ index: { classe, item, classe2, item2, from, was, missing } }`, for `rearmMen`.
export function lostWeapons(savePath, table = null, sidearms = null) {
  if (!sidearms || !sidearms.size) return {};
  const roster = readRoster(savePath);
  const tails = readRosterTails(savePath);
  const byType = new Map();
  for (const u of roster.unidades) {
    if (!byType.has(u.tipo)) byType.set(u.tipo, []);
    byType.get(u.tipo).push(u);
  }
  const split = (k) => k.split('/').map(Number);
  const out = {};
  for (const u of roster.unidades) {
    u.soldados.forEach((s, slot) => {
      if (s.estado > 1) return;                               // still down: nothing to hand him
      const mine = armsOfTail(tails[s.indice]?.cauda);
      if (!mine || mine.a1 === NO_WEAPON) return;             // no weapon at all is `toeWeapons`' case
      if (!sidearms.has(mine.a1)) return;                     // a real weapon in hand 1: not our man
      const t = table?.[u.tipo]?.[slot];
      const tableArm = t && Number.isInteger(t.classe) && t.classe !== 0x08 && t.classe !== 0 ? `${t.classe}/${t.item}` : null;
      const votes = new Map();
      for (const brother of byType.get(u.tipo)) {
        if (brother === u) continue;
        const twin = brother.soldados[slot];
        const a = twin && twin.estado <= 1 ? armsOfTail(tails[twin.indice]?.cauda) : null;
        if (!a || a.a1 === NO_WEAPON) continue;
        const k = `${a.a1} ${a.a2}`;
        votes.set(k, (votes.get(k) || 0) + 1);
      }
      const holdsTable = (k) => (tableArm ? k.split(' ').includes(tableArm) : true);
      const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1] || (holdsTable(b[0]) ? 1 : 0) - (holdsTable(a[0]) ? 1 : 0));
      const good = ranked.find(([k]) => holdsTable(k));
      let ref, from;
      if (good) { const [a1, a2] = good[0].split(' '); ref = { a1, a2 }; from = 'brother squad'; }
      else if (tableArm) { ref = { a1: tableArm, a2: null }; from = 'harvested table'; }
      else return;
      const missing = [ref.a1, ref.a2].filter((k) => k && k !== NO_WEAPON && k !== mine.a1 && k !== mine.a2);
      if (!missing.length) return;
      const a2 = ref.a2 && ref.a2 !== NO_WEAPON ? ref.a2 : (mine.a1 !== ref.a1 ? mine.a1 : mine.a2);
      const [classe, item] = split(ref.a1);
      const [classe2, item2] = split(a2);
      out[s.indice] = { classe, item, classe2, item2, from, was: `${mine.a1} + ${mine.a2}`, missing };
    });
  }
  return out;
}

// Every man who is DOWN — state 2 or 3 — with the unit he belongs to, in the order the writer walks
// the block: the index IS the address used to write his state back. The core id is what lets the
// screen say "this squad is three men short" instead of listing nine names with no home.
// THE FULL LOAD of every man: `{ index: { item: rounds } }`.
//
// Same shape of answer as the weapon, and the same two sources: what the man's own brothers carry
// in this save (the fullest of them, since nobody walks around with MORE than the issue), and the
// harvested table for the slots no brother covers. Only quantities of ammo he already carries are
// ever named — adding an item would change the size of his record, and that is what crashed the
// game twice.
export function fullLoads(savePath, table = null) {
  const roster = readRoster(savePath);
  const tails = readRosterTails(savePath);
  // The vector is not always at +9 (FORMATO 113.6): `readAmmoVector` knows where.
  const ammoOf = (s) => (readAmmoVector(tails[s.indice]?.cauda)?.pares || []).map((p) => ({ item: p.item, rounds: p.qtd }));

  const byType = new Map();
  for (const u of roster.unidades) {
    if (!byType.has(u.tipo)) byType.set(u.tipo, []);
    byType.get(u.tipo).push(u);
  }

  const out = {};
  for (const u of roster.unidades) {
    u.soldados.forEach((s, slot) => {
      const mine = ammoOf(s);
      // No list of his own: he needs an item INSERTED, not a quantity written, and that is
      // `missingLoads` below. Kept out of here so the two writers stay honest about what they do.
      if (!mine.length) return;
      const full = {};
      for (const { item } of mine) {
        let best = 0;
        for (const brother of byType.get(u.tipo)) {
          const twin = brother.soldados[slot];
          if (!twin) continue;
          for (const a of ammoOf(twin)) if (a.item === item) best = Math.max(best, a.rounds);
        }
        const fromTable = table?.[u.tipo]?.[slot]?.municao?.[item];
        if (Number.isInteger(fromTable)) best = Math.max(best, fromTable);
        if (best > 0) full[item] = best;
      }
      if (Object.keys(full).length) out[s.indice] = full;
    });
  }
  return out;
}

// O PAIOL E DA UNIDADE, NAO DO HOMEM (E76) — `{ index: { item: rounds } }`, quantidades EXATAS.
//
// `fullLoads` acima parte de uma frase que e falsa: "nobody walks around with MORE than the issue".
// No Combat Mission a municao de um esquadrao e um bolo so, e o jogo o reparte entre os homens como
// quer — e REPARTE DE NOVO durante a batalha. Medido no 3rd Squad do autor (tipo 9221, 5.45mm):
//
//     fim da batalha 5    [0  0  0  2486  2486  2485]   = 7457   tres homens com o bolo inteiro
//     refit (o antigo)    [895  3685  0  2486  2486  2485] = 12037
//
// Encher CADA homem ate o maximo que a vaga dele ja viu (no save, nos esquadroes irmaos e na linha
// de base, que so sobe) soma os maximos de reparticoes diferentes, e o total cresce a cada batalha:
// 1990 -> 3184 -> 3977 -> 4797 -> 7547 -> 12037, contra uma dotacao de fabrica de 2298. Com doze mil
// tiros nas costas o esquadrao dele perdeu o Fast, o Quick e o Assault.
//
// Aqui a conta e da unidade. A dotacao de cada vaga vem da COLHEITA GLOBAL (`toe_armas.json`, a
// moda de saves que o jogo escreveu) e nunca do que esta campanha viu — tudo o que ela viu depois da
// batalha 1 ja passou por um refit. O alvo da unidade e a soma das vagas de quem esta DE PE, e a
// reparticao escrita e a de fabrica. Quem carrega um item que a vaga dele nao leva (o metralhador
// com um naco do 5.45 que o jogo lhe deu) fica com o que couber no alvo, e com 1 quando nao cabe
// nada: par com quantidade zero o jogo nunca escreveu, ele apaga o par.
//
// `trim` e a segunda metade do pedido dele — "apenas voltar os esquadroes ao estado normal": quem
// esta ACIMA da dotacao volta a ela. Sem isso o excesso que os refits antigos ja puseram no save
// ficaria la para sempre.
//
// `issueOf(tipo, vaga, armas)` -> `{ item: qtd }`: a vaga na colheita; se a colheita nao conhece a
// vaga, o que as armas do homem recebem de fabrica (`armas_municao.json`).
export function poolLoads(savePath, { issue = null, weapons = null, last = null, trim = true } = {}) {
  const roster = readRoster(savePath);
  const tails = readRosterTails(savePath);
  const issueOf = (tipo, vaga, held) => {
    const daVaga = issue?.[tipo]?.[vaga]?.municao;
    if (daVaga && Object.keys(daVaga).length) return daVaga;
    const out = {};
    for (const k of held) for (const [item, q] of Object.entries(weapons?.[k] || {})) out[item] = Math.max(out[item] || 0, Number(q) || 0);
    if (Object.keys(out).length) return out;
    return last?.[tipo]?.[vaga]?.municao || {};      // so quando nem a vaga nem a arma sabem nada
  };

  const out = {};
  const resumo = [];
  for (const u of roster.unidades) {
    const homens = [];
    u.soldados.forEach((s, vaga) => {
      if (s.estado > 1) return;                         // quem nao vai a batalha nao entra na conta
      const c = tails[s.indice]?.cauda;
      const v = readAmmoVector(c);
      if (!v) return;
      const mine = armsOfTail(c);
      const held = mine ? [mine.a1, mine.a2].filter((k) => k && k !== NO_WEAPON) : [];
      homens.push({ indice: s.indice, tem: new Map(v.pares.map((p) => [p.item, p.qtd])), deve: issueOf(u.tipo, vaga, held) });
    });
    if (!homens.length) continue;
    const itens = new Set(homens.flatMap((h) => Object.keys(h.deve).map(Number)));
    for (const item of itens) {
      const alvo = homens.reduce((a, h) => a + (Number(h.deve[item]) || 0), 0);
      const donos = homens.filter((h) => h.tem.has(item));
      if (alvo <= 0 || !donos.length) continue;
      const tinha = donos.reduce((a, h) => a + h.tem.get(item), 0);
      if (tinha === alvo || (tinha > alvo && !trim)) continue;
      // a reparticao de fabrica para quem tem a vaga; o resto do alvo (a parte de quem esta de pe e
      // ficou sem o par) vai primeiro para quem carrega o item sem ser da vaga, depois para o maior.
      let sobra = alvo;
      const escrito = new Map();
      for (const h of donos) { const q = Number(h.deve[item]) || 0; if (q > 0) { escrito.set(h, q); sobra -= q; } }
      for (const h of donos) {
        if (escrito.has(h)) continue;
        const q = Math.max(1, Math.min(h.tem.get(item), sobra));
        escrito.set(h, q); sobra -= Math.min(q, Math.max(sobra, 0));
      }
      if (sobra > 0) {
        const maior = [...escrito.entries()].sort((a, b) => b[1] - a[1])[0][0];
        escrito.set(maior, Math.min(65535, escrito.get(maior) + sobra));
      }
      for (const [h, q] of escrito) {
        if (q === h.tem.get(item)) continue;
        (out[h.indice] = out[h.indice] || {})[item] = q;
      }
      resumo.push({ coreId: u.coreId, tipo: u.tipo, item, de: tinha, para: [...escrito.values()].reduce((a, b) => a + b, 0), alvo });
    }
  }
  Object.defineProperty(out, 'resumo', { value: resumo, enumerable: false });
  return out;
}

// O HOMEM QUE NAO TEM ONDE RECEBER — `{ index: { item: rounds } }` para quem esta com o vetor de
// municao VAZIO.
//
// Nove dos 105 homens do save do autor estao assim, e quatro deles sao baixas saqueadas: quando ele
// paga 30 creditos para repor uma, o refit devolve o estado e a arma da vaga e nao ha par onde por
// municao — o homem volta armado e com zero bala.
//
// `fullLoads` nao serve para eles por construcao: ele deriva o alvo do que o homem CARREGA, e quem
// nao carrega nada nao gera alvo. Aqui a fonte e outra — a dotacao da VAGA, da tabela colhida dos
// 115 saves que o jogo escreveu (`research/toe_armas.json`), com os irmaos do mesmo tipo como
// segunda opiniao. E o que uma linha de base gravada na compra daria de graca, e ate ela existir
// esta e a melhor resposta disponivel.
//
// Quem consome isto e `inserirMunicao`, que CRESCE o registro — provado em jogo pelo E37, inclusive
// no ultimo homem da unidade, que e onde mora o terminador `ff ff`.
// E O HOMEM COM METADE DO PAIOL (E54). O metralhador que secou a PKM nao tem o vetor vazio: tem a
// pistola e 48 de 9mm, e por isso nem a insercao nem o refil o alcancavam — o jogo apaga o par do
// item que zerou, e "encher o que ele carrega" nao devolve o que ele nao carrega mais. Para esse
// homem a resposta certa nao e a vaga (a vaga 1 leva RPG-22 num esquadrao e RPG-26 no outro, e a
// tabela daria ao homem com o 22 um tiro do 26): e a ARMA. `weapons` e a colheita de
// `research/armas_municao.json` — o que quase todo portador de cada arma leva —, e QUEM diz os
// itens sao as duas armas do homem e o irmao da mesma vaga que carrega as MESMAS armas; QUANTO diz
// a vaga (tabela e irmao), com a dotacao da arma por baixo.
// A GRANADA QUE FALTA (FORMATO 113.7, E67/E69). Ela nao esta no vetor de municao — e uma entrada de
// 3 bytes nas listas do rabo do soldado —, e por isso o refil nunca a alcancou: na EASY2 a municao
// voltava de 2519 para 3907 entre a batalha 3 e a 4 e as granadas ficavam 10 para 10, com quatro
// unidades em ZERO desde a batalha 3.
//
// A dotacao vem de `research/toe_granadas.json`, por (tipo da unidade, vaga) e nao por arma: medido
// em 296 saves, a vaga explica 73% dos homens e a arma 58% — granada e carga de PAPEL na esquadra.
// O numero por vaga e o p90 (a moda e desgaste, o maximo e granada catada de baixa) e o total da
// unidade respeita o teto do tipo, senao somar vaga por vaga daria a toda esquadra o bolso da mais
// bem suprida que ja apareceu.
//
// Devolve `{ [indice]: { '1,2': alvo } }` — quem ja esta no alvo nao aparece, e granada catada em
// batalha nao e tirada de ninguem.
export function missingGrenades(savePath, tabela = null, { aparar = false } = {}) {
  if (!tabela?.tabela) return {};
  const roster = readRoster(savePath);
  const tails = readRosterTails(savePath);
  const plano = {};
  for (const u of roster.unidades) {
    if (!u.soldados.length) continue;
    const homens = [];
    u.soldados.forEach((s, vaga) => {
      const d = tails[s.indice];
      if (!d || !d.ok) return;
      const g = readGrenades(d);
      if (!g || !g.listas.length) return;   // sem lista no rabo nao ha onde inserir
      homens.push({ indice: s.indice, vaga, atual: g.porTipo });
    });
    Object.assign(plano, grenadePlan(tabela, u.tipo, homens, { aparar }));
  }
  return plano;
}

// A ARMA QUE NAO E DELE (E78) — `{ index: { classe, item, classe2, item2 } }` para `rearmMen`.
//
// autor: "nao devemos carregar munição e armas obtidas da batalha de um mapa para outro. Devemos
// voltar todas as unidades para a munição e armamento default." A munição já volta (113.8); esta é
// a arma.
//
// O teste NAO e "difere do vencedor da vaga". A colheita mostra que a MAO 2 varia de esquadrao para
// esquadrao — o tipo 9221 vaga 1 aparece com `4/16` (120 vezes), `4/15` (70) e vazia (141) — e que a
// ORDEM das duas maos nao e fixa (`2/31 + 2/24` e `2/24 + 2/31`, o mesmo par). Reescrever pelo
// vencedor trocaria um RPG-22 legitimo por um RPG-26.
//
// O teste e: **esta arma ja foi vista NESTA vaga, nos saves que o jogo escreveu?** Se nunca foi, ela
// nao e da vaga — foi juntada no campo — e aquela mao volta para a dotacao. O que a vaga conhece
// fica, seja qual for a mao em que esteja. `8/0` na mao 2 e mao vazia, e e uma resposta legitima:
// e assim que uma arma catada e DEVOLVIDA.
//
// `minVotos` pede duas observacoes: uma so pode ser o proprio save do jogador ja envenenado.
// `keep` = `{ coreId: { vaga: 'classe/item' } }` — a arma que o jogador COMPROU no quartel-mestre
// (plano 1 fase C). Ela nao e do TO&E e seria "nao vista": sem esta porta o refit desfaria, de
// graca, o que ele pagou.
export function offIssueWeapons(savePath, table = null, { keep = null, minVotos = 2 } = {}) {
  if (!table) return {};
  const roster = readRoster(savePath);
  const tails = readRosterTails(savePath);
  const out = {};
  for (const u of roster.unidades) {
    u.soldados.forEach((s, vaga) => {
      if (s.estado > 1) return;                      // baixa: quem cuida dela e o reforco
      const linha = table[u.tipo]?.[vaga];
      if (!linha || !linha.mao1) return;             // tabela velha, ou vaga que ninguem colheu
      const c = tails[s.indice]?.cauda;
      if (!c || c.length < 8 || c[0] !== 0 || c[3] !== 0) return;
      const comprada = keep?.[u.coreId]?.[vaga] || null;
      const escolha = {};
      for (const [qual, base] of [['mao1', 1], ['mao2', 4]]) {
        const tem = `${c[base]}/${c[base + 1]}`;
        if (c[base] === 0x08 || c[base] === 0) continue;    // sem arma: e trabalho do reforco
        if (tem === comprada) continue;                      // ele pagou por esta
        const urna = linha[qual] || {};
        if ((urna[tem] || 0) >= minVotos) continue;          // a vaga conhece: fica
        // De volta a dotacao daquela mao. Vale o mais votado que nao seja um defeito conhecido.
        const volta = Object.entries(urna).filter(([k, n]) => n >= minVotos && !k.startsWith('0/'))
          .sort((a, b) => b[1] - a[1])[0]?.[0];
        if (!volta || volta === tem) continue;
        const [classe, item] = volta.split('/').map(Number);
        if (!Number.isInteger(classe) || !Number.isInteger(item) || classe < 0 || classe > 8 || item < 0 || item > 255) continue;
        if (qual === 'mao1') { escolha.classe = classe; escolha.item = item; }
        else { escolha.classe2 = classe; escolha.item2 = item; }
        escolha.de = `${escolha.de || ''}${qual}: ${tem} -> ${volta}; `;
      }
      if (escolha.de) out[s.indice] = { ...escolha, nome: s.nome, coreId: u.coreId, vaga };
    });
  }
  return out;
}

// THE FACTORY RESET (plan B, 28/09). the author's rule: nothing taken in battle crosses to the next map —
// every standing man goes back to exactly what the factory issued his slot. The table is
// `research/fabrica.json`, keyed `army|type` (the roster type collides between armies, 111.17), and
// harvested from the ZZ FAB campaigns: battle 1 ended by cease-fire at turn 0, no shot, no loot.
//
// Pure: reads the save, returns what the writers must do. Per standing man whose slot has a row:
//   hands    — the pair is compared as a SET (the game lists the weapon in use first, 113.5), and
//              written only when the set differs — Bestuzhev's `4/14 + 4/14` is exactly that case;
//   remove   — items he carries that the slot does not issue (the Javelin round of the engineers);
//   insert   — items the slot issues that he does not carry;
//   amounts  — the exact quantity of the ones he has;
//   grenades — the target by type, zero for a type the slot does not list.
// `armies`: Map coreId -> 'US' | 'RU' | 'UKR'. `keep`: `{ coreId: { slot: 'c/i' } }`, the weapon he
// bought in the quartermaster: it takes hand 1, and the rounds of the factory hand 1 give way to its
// own (`weapons`, the per-weapon issue). No row, no army: untouched and named in `untouched` — a guess
// from another type or another army is how the Javelin got there in the first place.
export function resetPlan(savePath, factory, { armies = null, keep = null, weapons = null, keepKit = null, kitAmmo = null, reloadAmmo = null } = {}) {
  const roster = readRoster(savePath);
  const tails = readRosterTails(savePath);
  const plan = { hands: {}, remove: {}, insert: {}, amounts: {}, grenades: {}, bytes: {}, kitSkipped: [], kitReplaced: [], untouched: [], men: 0, equip: { men: 0, nv: 0, laser: 0, demo: 0, chefia: 0 }, equipSkipped: [] };
  const named = new Set();
  for (const u of roster.unidades) {
    const army = armies?.get(u.coreId) || null;
    const row = army ? factory?.tipos?.[`${army}|${u.tipo}`] : null;
    u.soldados.forEach((s, slot) => {
      if (s.estado > 1) return;                                // down: the replacement is his refit
      const d = tails[s.indice];
      const arms = armsOfTail(d?.cauda);
      const vector = readAmmoVector(d?.cauda);
      if (!arms || !vector) return;                            // compact record: nothing to reset
      const row0 = row?.vagas?.[slot];
      if (!row0) {
        if (!named.has(u.coreId)) { named.add(u.coreId); plan.untouched.push({ coreId: u.coreId, tipo: u.tipo, army }); }
        return;
      }
      plan.men++;
      // The factory draws some kit (RPG-22 or RPG-26, the crewman's rifle) and sometimes seats a squad
      // one place over: every pair it ever issued this slot is a legitimate variant, and the ammunition
      // and grenades follow the variant the man holds. Only a pair it never issued goes back to the
      // commonest one.
      const pairOf = (a, b) => [a, b].sort().join(' + ');
      // o lancador comprado no lugar da arma de fabrica da mao 2 (19/10) desfaz o par: a variante sai da mao 1
      const kitDele = keepKit?.[u.coreId]?.[slot] || null;
      // 26/11: o jogo devolve o lancador comprado na mao 1; o par e lido como o app o escreveu (gear.desinverter)
      const [a1, a2] = desinverter(arms.a1, arms.a2, kitDele);
      const pelaMao1 = kitDele && a2 === kitDele ? (row0.variantes || []).find((v) => v.mao1 === a1) : null;
      const want = (row0.variantes || []).find((v) => v.maos.join(' + ') === pairOf(a1, a2)) || pelaMao1 || row0;
      let h1 = want.mao1 || want.maos.find((k) => k !== NO_WEAPON) || want.maos[0];
      const rest = [...want.maos]; rest.splice(rest.indexOf(h1), 1);
      let h2 = rest[0] || NO_WEAPON;
      const ammo = { ...want.municao };
      const bought = keep?.[u.coreId]?.[slot] || null;
      if (bought && bought !== h1) {
        const kept = new Set(Object.keys(weapons?.[h2] || {}));
        for (const item of Object.keys(weapons?.[h1] || {})) if (!kept.has(item)) delete ammo[item];
        for (const [item, q] of Object.entries(weapons?.[bought] || {})) if (Number(q) > 0) ammo[item] = Number(q);
        h1 = bought;
      }
      // O ITEM COMPRADO (05/10, E145): reposto toda batalha. Lancador na mao 2 de fabrica livre, com o foguete dele;
      // demo e laser sao bits do +7/+8, escritos junto com o equipamento da vaga, abaixo (08/11).
      const item = keepKit?.[u.coreId]?.[slot] || null;
      if (item && /^\d+\/\d+$/.test(item)) {
        // 19/10 (autor): com a mao 2 de fabrica ocupada, o lancador SUBSTITUI a arma dela; a municao so dela sai (a que
        // a mao 1 tambem usa fica). Largar o item devolve a arma, porque o reset volta a seguir a fabrica.
        if (h2 !== NO_WEAPON && h2 !== item) {
          const daMao1 = new Set(Object.keys(weapons?.[h1] || {}));
          for (const k of Object.keys(weapons?.[h2] || {})) if (!daMao1.has(k)) delete ammo[k];
          plan.kitReplaced.push({ coreId: u.coreId, slot, name: s.nome, item, hand2: h2 });
          h2 = NO_WEAPON;
        }
        if (h2 === NO_WEAPON) { h2 = item; for (const [k, q] of Object.entries(kitAmmo ? kitAmmo(item, army) : {})) if (Number(q) > 0) ammo[k] = Number(q); }
      } else if (item && item.startsWith('reload:')) {
        // a RECARGA (18/10): so a municao do lancador, na bolsa; as maos ficam como a fabrica deu
        const fonte = reloadAmmo || kitAmmo;
        for (const [k, q] of Object.entries(fonte ? fonte(item.slice(7), army) : {})) if (Number(q) > 0) ammo[k] = Math.max(Number(ammo[k]) || 0, Number(q));
      }
      // O EQUIPAMENTO DA VAGA (08/11/2026, autor: o Scout Platoon HQ da b11 sem binoculo, laser e visao noturna). O jogo
      // tira do homem que cai a arma E o equipamento, e o reset devolvia so a arma: 60 homens da US repostos ficaram sem
      // NV (+8 0x80), laser (+7 0x08) e binoculo/chefia (+7 0xc0) para o resto da campanha, e em 11 de 15 unidades o jogo
      // tinha passado a chefia a outro homem. Alvo = fabrica da vaga (FORMATO 130, `fabrica.json` equip/lider); o item do
      // kit que o homem AINDA tem (E145, mesma base do gear.kitBytes) manda por cima. Nunca o 0x20 de +7 (gramatica) nem
      // bit fora de 0xc8/0x98. Cabeca fora da forma: fica como esta e e nomeada, a entrega nao para por isso.
      if (d?.cauda && d.cauda.length > 8) {
        const eq = want.equip || row0.equip || null;
        const liderFab = Number.isInteger(want.lider) ? want.lider : Number.isInteger(row0.lider) ? row0.lider : (eq?.binoculo ? 0x80 : 0);
        if (eq) {
          if (d.cauda[0] !== 0 || d.cauda[3] !== 0 || d.cauda[6] !== 0) plan.equipSkipped.push({ coreId: u.coreId, slot, name: s.nome });
          else {
            const c7 = d.cauda[7], c8 = d.cauda[8];
            let alvo7 = (c7 & ~0xc8) | (liderFab & 0xc0) | (eq.laser ? 0x08 : 0);
            let alvo8 = (c8 & ~0x98) | (eq.nv ? 0x80 : 0) | ((eq.demo || 0) & 2 ? 0x08 : 0) | ((eq.demo || 0) & 4 ? 0x10 : 0);
            if (item && KIT_BITS[item]?.demo) alvo8 = (alvo8 & ~0x18) | KIT_BITS[item].demo;
            if (item === 'laser') alvo7 |= 0x08;
            alvo7 &= 0xff; alvo8 &= 0xff;
            if (alvo7 !== c7 || alvo8 !== c8) {
              const b = { name: s.nome, coreId: u.coreId, slot, from: [c7, c8], to: [alvo7, alvo8] };
              if (alvo8 !== c8) b.mais8 = alvo8;
              const liga = (alvo7 & ~c7) & 0xc8, desliga = (c7 & ~alvo7) & 0xc8;
              if (liga) b.ligar7 = liga;
              if (desliga) b.desligar7 = desliga;
              plan.bytes[s.indice] = b;
              plan.equip.men++;
              if ((alvo8 ^ c8) & 0x80) plan.equip.nv++;
              if ((alvo8 ^ c8) & 0x18) plan.equip.demo++;
              if ((alvo7 ^ c7) & 0x08) plan.equip.laser++;
              if ((alvo7 ^ c7) & 0xc0) plan.equip.chefia++;
            }
          }
        }
      }
      if ([arms.a1, arms.a2].sort().join() !== [h1, h2].sort().join()) {
        // Keep the one already in hand 1 — but never over a BOUGHT weapon: hand 1 is what the panel shows
        // and what the man fights with, and the swap put Baranov's SVD in hand 2 behind his old AK (28/09).
        if (arms.a1 === h2 && h2 !== NO_WEAPON && h1 !== bought) [h1, h2] = [h2, h1];
        const [classe, item] = h1.split('/').map(Number);
        const [classe2, item2] = h2.split('/').map(Number);
        plan.hands[s.indice] = { classe, item, classe2, item2, name: s.nome, coreId: u.coreId, slot, from: `${arms.a1} + ${arms.a2}`, to: `${h1} + ${h2}` };
      }
      const has = new Map(vector.pares.map((p) => [p.item, p.qtd]));
      const out = [...has.keys()].filter((i) => ammo[i] === undefined);
      if (out.length) plan.remove[s.indice] = out;
      for (const [k, q] of Object.entries(ammo)) {
        const i = Number(k);
        if (!has.has(i)) (plan.insert[s.indice] = plan.insert[s.indice] || {})[i] = q;
        else if (has.get(i) !== q) (plan.amounts[s.indice] = plan.amounts[s.indice] || {})[i] = q;
      }
      const g = readGrenades(d);
      if (g && g.listas.length) {
        const target = { ...(want.granadas || {}) };
        for (const k of Object.keys(g.porTipo || {})) if (target[k] === undefined) target[k] = 0;
        if (Object.entries(target).some(([k, n]) => (g.porTipo?.[k] || 0) !== n)) plan.grenades[s.indice] = target;
      }
    });
  }
  return plan;
}

export function missingLoads(savePath, table = null, weapons = null, { factory = null } = {}) {
  const roster = readRoster(savePath);
  const tails = readRosterTails(savePath);
  const vazio = (s) => {
    const p = readAmmoVector(tails[s.indice]?.cauda);   // null = registro compacto: nao ha vetor para crescer
    return !!p && p.n === 0;
  };
  // The vector is not always at +9 (FORMATO 113.6): `readAmmoVector` knows where.
  const ammoOf = (s) => (readAmmoVector(tails[s.indice]?.cauda)?.pares || []).map((p) => ({ item: p.item, rounds: p.qtd }));

  const byType = new Map();
  for (const u of roster.unidades) {
    if (!byType.has(u.tipo)) byType.set(u.tipo, []);
    byType.get(u.tipo).push(u);
  }

  // A ARMA MANDA NA MUNICAO, e e a ultima palavra quando a vaga nao tem resposta. Quem carrega um
  // M4A1 precisa de 5.56 seja qual for a unidade dele — e foi assim que o Varney apareceu: ele e o
  // unico homem do tipo 9989 na forca, entao nao ha irmao na mesma vaga, e a tabela colhida tambem
  // nao conhece aquela vaga. Mas ha dezenove homens com a mesma arma no mesmo save.
  //
  // So entra o que TODOS os portadores daquela arma carregam: e o que pertence a arma, e nao o que
  // um deles leva por acaso para o esquadrao (uma granada de 25mm, um item de sinalizacao). A
  // quantidade e o maximo visto, que e a dotacao de quem ainda nao gastou.
  const porArma = new Map();
  const armaDe = (s) => {
    const c = tails[s.indice]?.cauda;
    return c && c.length >= 3 ? `${c[1]}/${c[2]}` : null;
  };
  for (const u of roster.unidades) {
    for (const s of u.soldados) {
      const a = armaDe(s);
      const itens = ammoOf(s).filter((x) => x.rounds > 0);
      if (!a || a === '8/0' || !itens.length) continue;
      if (!porArma.has(a)) porArma.set(a, []);
      porArma.get(a).push(itens);
    }
  }
  const daArma = (a) => {
    const vistos = porArma.get(a);
    if (!vistos || !vistos.length) return {};
    const comuns = vistos.reduce((acc, itens) => acc.filter((it) => itens.some((x) => x.item === it)), vistos[0].map((x) => x.item));
    const out = {};
    for (const item of comuns) {
      let melhor = 0;
      for (const itens of vistos) for (const x of itens) if (x.item === item) melhor = Math.max(melhor, x.rounds);
      if (melhor > 0) out[item] = melhor;
    }
    return out;
  };

  // SO ENTRA O QUE ALGUEM DESTE SAVE CARREGA (27/09). As tabelas colhidas sao indexadas pelo `u16
  // tipo` e pelo par da arma, e os dois se repetem entre exercitos (FORMATO 111.17, 118.1): o tipo 261
  // e o Squad (Engineer) russo e tambem uma unidade americana, e a colheita — que guarda o maximo por
  // vaga — fundiu os dois. O refit da batalha 3 da RUS1 deu um cartucho de Javelin (item 57) a dois
  // engenheiros saqueados. Aqui um item so e inserido se algum homem do MESMO TIPO de unidade, ou com
  // a MESMA ARMA, o carrega neste save — o save e de um exercito so do lado do jogador, entao o que
  // vem de outro exercito cai fora. Remendo ate a dotacao de fabrica por exercito (plano de reset).
  const noTipo = new Map(), naArma = new Map();
  const junta = (m, k, it) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(it); };
  for (const u of roster.unidades) for (const s of u.soldados) {
    const a = armaDe(s);
    for (const x of ammoOf(s)) { junta(noTipo, u.tipo, x.item); if (a) junta(naArma, a, x.item); }
  }
  // A TABELA DE FABRICA, quando conhece o tipo, e a palavra final (28/09). A regra acima so barra item que
  // ninguem do save carrega — e o cartucho de Javelin ja estava em dois engenheiros da batalha 3, entao
  // o refit o espalhou para seis. `research/fabrica.json` sai da moda de esquadroes inteiros (o saque e
  // minoria) e, sem ele, fica a regra do save.
  const daFabrica = new Map();
  for (const linha of Object.values(factory?.tipos || {})) {
    const s = daFabrica.get(linha.tipo) || new Set();
    for (const v of Object.values(linha.vagas || {})) for (const it of Object.keys(v.municao || {})) s.add(Number(it));
    daFabrica.set(linha.tipo, s);
  }
  const plausivel = (u, held, item) => (daFabrica.has(u.tipo)
    ? daFabrica.get(u.tipo).has(item)
    : noTipo.get(u.tipo)?.has(item) || held.some((k) => naArma.get(k)?.has(item)));
  const filtra = (u, held, full) => {
    for (const it of Object.keys(full)) if (!plausivel(u, held, Number(it))) delete full[it];
    return full;
  };

  // AS TRES FONTES ENTRAM JUNTAS, E VENCE A MAIOR — nao a primeira. Ordenar por prioridade parecia
  // natural ate a medicao mostrar um homem de pe com CINCO balas: a vaga dele responde, responde
  // errado, e uma fonte melhor logo abaixo nunca seria consultada. Pelo maximo, uma fonte pobre nao
  // consegue piorar o alvo de nenhuma outra.
  const maior = (destino, origem) => {
    for (const [item, rounds] of Object.entries(origem || {})) {
      const it = Number(item), q = Number(rounds);
      if (Number.isInteger(it) && Number.isInteger(q) && q > 0 && !(destino[it] >= q)) destino[it] = q;
    }
    return destino;
  };

  const out = {};
  for (const u of roster.unidades) {
    u.soldados.forEach((s, slot) => {
      const mine = armsOfTail(tails[s.indice]?.cauda);
      const held = mine ? [mine.a1, mine.a2].filter((k) => k !== NO_WEAPON) : [];
      if (vazio(s)) {
        const full = {};
        // 1. a dotacao da vaga: a linha de base desta campanha por cima da colheita dos 115 saves
        maior(full, table?.[u.tipo]?.[slot]?.municao);
        // 2. o irmao do mesmo tipo que esta na mesma posicao
        for (const brother of byType.get(u.tipo)) {
          const twin = brother.soldados[slot];
          if (!twin || twin.indice === s.indice) continue;
          for (const a of ammoOf(twin)) if (a.rounds > 0 && !(full[a.item] >= a.rounds)) full[a.item] = a.rounds;
        }
        // 3. e quem carrega a MESMA ARMA em qualquer lugar do save
        maior(full, daArma(armaDe(s)));
        // 4. e o que a arma dele recebe de fabrica, na colheita inteira (E54)
        for (const k of held) maior(full, weapons?.[k]);
        filtra(u, held, full);
        if (Object.keys(full).length) out[s.indice] = full;
        return;
      }
      // O HOMEM COM PAIOL PARCIAL (E54): so quem esta de pe, e so o que falta.
      if (s.estado > 1 || !mine) return;
      const carried = new Set(ammoOf(s).map((x) => x.item));
      const which = new Map();                              // item -> dotacao da arma (0 = veio so do irmao)
      for (const k of held) {
        const line = weapons?.[k] || daArma(k);
        for (const [item, q] of Object.entries(line)) which.set(Number(item), Math.max(which.get(Number(item)) || 0, Number(q) || 0));
      }
      const twins = {};
      for (const brother of byType.get(u.tipo)) {
        const twin = brother.soldados[slot];
        if (!twin || twin.indice === s.indice || twin.estado > 1) continue;
        if (!sameWeapons(mine, armsOfTail(tails[twin.indice]?.cauda))) continue;
        for (const a of ammoOf(twin)) if (a.rounds > 0 && !(twins[a.item] >= a.rounds)) twins[a.item] = a.rounds;
      }
      for (const item of Object.keys(twins)) if (!which.has(Number(item))) which.set(Number(item), 0);
      const full = {};
      for (const [item, issue] of which) {
        if (carried.has(item)) continue;
        const specific = Math.max(Number(table?.[u.tipo]?.[slot]?.municao?.[item]) || 0, twins[item] || 0);
        const q = Math.max(specific, issue);
        if (q > 0) full[item] = q;
      }
      filtra(u, held, full);
      if (Object.keys(full).length) out[s.indice] = full;
    });
  }
  return out;
}

// STATE 2 IS THE WOUNDED MAN, STATE 3 IS THE DEAD ONE, and the AAR of the same battle says so.
// Across the campaign saves the game itself wrote, state 3 tracks the report's KILLED and state 2
// its WOUNDED — City 016 reads 1/1 against 1/1, ZZ APP 7 reads 18/5 against 14/5, the author's first
// battle 9/21 against 7/22. The report always counts a few more dead than the roster has, and that
// is expected: a vehicle's crew has no line in the roster, so a burning Stryker takes two men out
// of the report and none out of this list.
//
// The wounded man was carried off the field. That is why he can come back on his own — see the
// rescue roll in `campaign.readSave` — while the dead one only ever comes back as a replacement
// somebody paid for.
export function casualtyList(savePath) {
  const roster = readRoster(savePath);
  const unitOf = new Map();
  for (const u of roster.unidades) for (const s of u.soldados) unitOf.set(s.indice, u);
  return roster.soldados
    .map((s, index) => ({ index, name: s.nome, state: s.estado, wounded: s.estado === 2 }))
    .filter((s) => s.state > 1)
    .map((s) => {
      const u = unitOf.get(s.index);
      return { ...s, coreId: u ? u.coreId : null, unitStrength: u ? u.n : null };
    });
}
