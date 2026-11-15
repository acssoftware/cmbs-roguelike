'use strict';
// THE ORDER OF BATTLE AS A CHART.
//
// One block per node, never one per soldier: a battalion drawn unit by unit is 154 boxes and worse
// than a list. A block says what it is (a formation heading, or a unit that fights), how many
// branches hang off it, what it costs, and carries two buttons — take it, and open the next level.
// Nothing opens by itself: the chart only grows where it was asked to.
//
// Blocks are HTML (text and buttons want to be), the connectors are one SVG behind them, and the
// whole thing sits on a pane that pans with the mouse and zooms with the wheel.

// Keep BLOCK_W/BLOCK_H in step with `.blk` in style.css — the layout measures in these numbers and
// the browser draws in those.
// (28/09) BLOCK_H era 96 com o CSS em 118: o layout reservava menos do que o bloco ocupava.
const BLOCK_W = 232, BLOCK_H = 118, GAP_X = 18, GAP_Y = 30, PAD = 40;
// THE MEN OF A SPECIAL FORCES UNIT (28/09, autor): the block opens a column of soldiers under itself,
// one row each, and the row opens the weapon menu. MAN_H is one row; the column sits MEN_GAP below.
const MAN_H = 62, MEN_GAP = 8, MEN_NOTE_H = 34;   // 62 = nome, arma e o item (E145)

function nodeCost(node, priceOf) {
  let total = 0;
  const w = (n) => { if (!n.isFormation) total += priceOf(n); else n.children.forEach(w); };
  w(node);
  return total;
}

// Tidy layout over the OPEN nodes only: a subtree is as wide as its children side by side, or as
// wide as one block, whichever is more, and the parent centres over them.
// Each DEPTH is as tall as its tallest block (`heightOf`, which counts an open column of soldiers
// under the block), and the next depth starts below that: a column never runs into the row below.
function layout(roots, isOpen, heightOf = () => BLOCK_H) {
  const placed = [];
  const rowH = [];
  let x = PAD;
  const walk = (node, depth) => {
    const kids = isOpen(node) ? node.children : [];
    rowH[depth] = Math.max(rowH[depth] || BLOCK_H, heightOf(node));
    if (!kids.length) {
      const box = { node, x, depth };
      x += BLOCK_W + GAP_X;
      placed.push(box);
      return box;
    }
    const boxes = kids.map((k) => walk(k, depth + 1));
    const left = boxes[0].x, right = boxes[boxes.length - 1].x;
    const box = { node, x: Math.round((left + right) / 2), depth, children: boxes };
    placed.push(box);
    return box;
  };
  for (const r of roots) walk(r, 0);
  const top = [PAD];
  for (let d = 1; d < rowH.length; d++) top[d] = top[d - 1] + rowH[d - 1] + GAP_Y;
  for (const b of placed) b.y = top[b.depth];
  return placed;
}

// `pick` is the same object the list screen uses: { tree, keep, open }. Selection is shared, so a
// force built here reads the same on the other screen and on the way to the generator.
//
// Everything the chart remembers between redraws — pan, zoom, whether it is maximised — lives on
// `pick`, because the pane itself is thrown away and rebuilt on every click.
//
// READ-ONLY is the same chart with nothing to click: the library offers it so a formation can be
// looked at before it is bought, and looking at it must not be one keystroke away from buying it.
// So no take button, no lasso, no remove — only the two gestures that are pure navigation, opening
// a branch and moving the chart around.
// `outOf(n)` (28/09) is null or `{ label, cls }` for a unit that is the player's but will not fight:
// stood down, sold, or marked for sale in the draft. `n.sold` disables its take button for good.
// `men` (28/09) is the soldiers of the special forces: `{ of(n) -> { nation, men[], note, hint, readOnly } | null,
// menu(nation) -> [{weapon, name, class, price}], chosen(index), choose(index, weapon | null), count(),
// reset() }`. Only units it answers for get the "men" button; the page decides who that is.
function renderCanvas(pick, onChange, priceOf, { onRemove, hurt, onHeal, lost, outOf, force, readOnly = false, onClose, men = null } = {}) {
  const pane = document.createElement('div');
  pane.className = `canvas-pane${pick.max ? ' max' : ''}${readOnly ? ' ro' : ''}`;
  const world = document.createElement('div');
  world.className = 'canvas-world';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'canvas-links');
  world.append(svg);
  pane.append(world);

  // The bar floats over the chart instead of riding on the world, so it stays put while the chart
  // is dragged around under it.
  const bar = document.createElement('div');
  bar.className = 'canvas-tools';
  const tool = (text, title, fn) => {
    const b = document.createElement('button');
    b.className = 'tool-btn';
    b.textContent = text;
    b.title = title;
    b.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); });
    bar.append(b);
    return b;
  };
  if (!readOnly) {
    tool(pick.max ? '⤡ minimize' : '⤢ maximize',
      pick.max ? 'Put the chart back in the column' : 'Fill the window with the chart',
      () => { pick.max = !pick.max; onChange(); });
  }
  tool('⤾ recenter', 'Undo panning and zooming', () => { view.x = 0; view.y = 0; view.z = 1; apply(); });
  if (readOnly) {
    // A whole battalion is 154 blocks and nobody wants to open them one at a time; a formation of
    // nine is easier read whole. So both directions are one click.
    const todas = [];
    const colher = (n) => { if (n.children.length) todas.push(n.key); n.children.forEach(colher); };
    pick.tree.roots.forEach(colher);
    tool('▾ open all', 'Show every branch', () => { todas.forEach((k) => pick.open.add(k)); onChange(); });
    tool('− close all', 'Fold everything back to the top', () => { pick.open.clear(); onChange(); });
    if (onClose) tool('✕ close', 'Back to the library', onClose);
    bar.title = 'Alt-drag or middle-drag to pan · wheel to zoom';
  } else {
    bar.title = 'Drag on the background to lasso units · alt-drag or middle-drag to pan · wheel to zoom';
    if (onRemove) tool('✕ remove', 'Drop this formation from the force', onRemove);
    if (men && men.count && men.count()) {
      tool(`↺ reset weapons (${men.count()})`, 'Undo every weapon chosen for these men', () => { men.reset(); pick.armsOpen = null; onChange(); });
    }
  }
  pane.append(bar);

  // Maximised, the chart covers the budget panel — so the budget comes along. The number is filled
  // in by the pricing pass, which is the only thing that knows it; until then it reads as pending,
  // the same as the price tag on the card.
  // Maximised, the Modifiers panel has nowhere to live on the page, so it rides along the bottom.
  if (pick.max && force && force.panel) {
    const foot = document.createElement('div');
    foot.className = 'canvas-foot';
    foot.append(force.panel({ footer: true }));
    pane.append(foot);
  }

  if (pick.max && !readOnly) {
    const hud = document.createElement('div');
    hud.className = 'canvas-hud';
    hud.append(Object.assign(document.createElement('span'), { className: 'hud-label', textContent: 'Credits left' }));
    hud.append(Object.assign(document.createElement('b'), { className: 'canvas-credits', textContent: '…' }));
    pane.append(hud);
  }

  const view = pick.view || (pick.view = { x: 0, y: 0, z: 1 });
  const isOpen = (n) => pick.open.has(n.key) && n.children.length > 0;

  // Who hangs off whom, so a unit can name the formation it belongs to without the caller having
  // to thread it through.
  const parentOf = new Map();
  const chain = (n) => { for (const c of n.children) { parentOf.set(c, n); chain(c); } };
  pick.tree.roots.forEach(chain);
  const lineage = (n) => { const out = []; for (let p = parentOf.get(n); p; p = parentOf.get(p)) out.push(p.name); return out; };
  const allKeys = (n, out = []) => { out.push(n.key); n.children.forEach((c) => allKeys(c, out)); return out; };
  const apply = () => { world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`; };

  // Every block currently on screen, so the lasso can hit-test against what the eye sees — with
  // the pane's own zoom and pan already baked into the rectangles the browser reports.
  let desenhados = [];

  // The soldiers of a unit, when the page knows them and the column is open.
  const menOf = (n) => (!readOnly && men && !n.isFormation ? men.of(n) : null);
  const menOpen = (n) => !!(pick.men && pick.men.has(n.key)) && !!menOf(n);
  const columnH = (n) => {
    const m = menOf(n);
    return MEN_GAP + (m.note ? MEN_NOTE_H : 0) + m.men.length * MAN_H + 6;
  };
  const heightOf = (n) => BLOCK_H + (menOpen(n) ? columnH(n) : 0);

  const draw = () => {
    for (const old of world.querySelectorAll('.blk, .blk-men')) old.remove();
    desenhados = [];
    const boxes = layout(pick.tree.roots, isOpen, heightOf);
    let maxX = 0, maxY = 0;

    const lines = [];
    for (const b of boxes) {
      for (const c of b.children || []) {
        const x1 = b.x + BLOCK_W / 2, y1 = b.y + BLOCK_H;
        const x2 = c.x + BLOCK_W / 2, y2 = c.y;
        // o trecho horizontal corre logo ACIMA dos filhos: uma coluna de soldados aberta ao lado do
        // pai deixa a linha dele mais alta, e o trecho logo abaixo do pai a atravessaria
        const mid = y2 - GAP_Y / 2;
        lines.push(`M ${x1} ${y1} V ${mid} H ${x2} V ${y2}`);
      }
      maxX = Math.max(maxX, b.x + BLOCK_W);
      maxY = Math.max(maxY, b.y + heightOf(b.node));
    }
    svg.setAttribute('width', maxX + PAD);
    svg.setAttribute('height', maxY + PAD);
    svg.innerHTML = lines.map((d) => `<path d="${d}" />`).join('');
    world.style.width = `${maxX + PAD}px`;
    world.style.height = `${maxY + PAD}px`;

    for (const b of boxes) {
      const el = block(b); desenhados.push({ node: b.node, el }); world.append(el);
      if (menOpen(b.node)) world.append(column(b));
    }
  };

  // THE COLUMN OF SOLDIERS under a special forces unit: one row per man, top to bottom, each with the
  // weapon he carries (or the one chosen for him) and the button that opens the menu. Before the
  // first battle there are no men yet — the rows are the unit's SLOTS with the factory weapon, and
  // nothing to change.
  const column = (b) => {
    const col = menColumn(b.node);
    col.style.left = `${b.x}px`;
    col.style.top = `${b.y + BLOCK_H + MEN_GAP}px`;
    return col;
  };
  // A coluna sem posicao (25/10): o canvas a poe debaixo do bloco, a vista em lista debaixo da linha.
  const menColumn = (n) => {
    const m = menOf(n);
    const col = document.createElement('div');
    col.className = 'blk-men';
    if (m.note) {
      const note = document.createElement('div');
      note.className = 'men-note';
      note.textContent = m.note;
      if (m.hint) note.title = m.hint;
      col.append(note);
    }
    const menu = m.readOnly ? [] : men.menu(m.nation);
    for (const s of m.men) {
      const escolhida = m.readOnly ? null : men.chosen(s.index);
      const row = document.createElement('div');
      row.className = `man${s.canChange ? '' : ' fixed'}${escolhida ? ' chosen' : ''}${s.state > 1 ? ' down' : ''}`;
      const nome = document.createElement('div');
      nome.className = 'man-name';
      nome.textContent = s.name;
      const chips = [];
      if (s.bought && !escolhida) chips.push(['bought', 'Bought in an earlier battle — he keeps it until he falls']);
      if (s.state === 1) chips.push(['scratched', 'Lightly wounded: he stays with the unit, and with his weapon']);
      if (s.state === 2 || s.state === 3) chips.push([s.state === 3 ? 'dead' : 'down', 'Down: if he comes back, he comes back with the factory weapon of his slot']);
      if (s.why === 'crew') chips.push(['crew', 'The crew of a machine does not change weapon']);
      for (const [t, dica] of chips) {
        const c = document.createElement('span');
        c.className = `man-chip ${t}`;
        c.textContent = t;
        c.title = dica;
        nome.append(c);
      }
      const arma = document.createElement('div');
      arma.className = 'man-weapon';
      const atual = s.weaponName || (s.weapon ? `${s.weapon} (unnamed)` : '—');
      if (escolhida) {
        const o = menu.find((x) => x.weapon === escolhida);
        // A coluna tem a largura do bloco: a arma velha iria cortar o preco, entao ela vai para a dica.
        arma.textContent = `→ ${o ? (o.name || o.weapon) : escolhida}${o ? ` · ${o.price ? o.price + ' cr' : 'free'}` : ''}`;
        arma.title = `${atual} → ${arma.textContent.slice(2)}`;
      } else {
        arma.textContent = atual + (s.secondName ? ` + ${s.secondName}` : '');
        arma.title = arma.textContent;
      }
      row.append(nome, arma);
      // O ITEM (05/10, E145): uma linha por baixo da arma, com o comprado, o escolhido ou nada.
      const kitEsc = m.readOnly || !men.kitChosen ? undefined : men.kitChosen(s.index);
      const kitMenu = m.readOnly || !men.kitMenu ? [] : men.kitMenu(m.nation, m.men);
      const kitLinha = document.createElement('div');
      kitLinha.className = 'man-kit';
      if (kitEsc !== undefined) {
        const o = kitMenu.find((x) => x.id === kitEsc);
        // um item por soldado (19/10): o novo SUBSTITUI o comprado, e a linha diz qual sai
        kitLinha.textContent = kitEsc === null ? `kit: → drop ${s.kitName || s.kit}`
          : `kit: → ${o ? o.name : kitEsc} · ${o && o.price ? o.price + ' cr' : 'free'}${substitui(s, o || { id: kitEsc }).length ? ` (replaces ${substitui(s, o || { id: kitEsc }).join(' and ')})` : ''}`;
        kitLinha.classList.add('chosen');
      } else if (s.kit) kitLinha.textContent = `kit: ${s.kitName || s.kit}${s.kitHeld ? ' · bought' : ' · comes back next battle'}`;
      else kitLinha.textContent = 'kit: —';
      if (!m.readOnly && kitMenu.length) row.append(kitLinha);
      if (!m.readOnly) {
        const btn = document.createElement('button');
        btn.className = 'man-btn';
        btn.textContent = '⇄ weapon';
        btn.disabled = !s.canChange;
        btn.title = s.canChange ? 'Choose another weapon for him'
          : s.why === 'crew' ? 'The crew of a machine does not change weapon'
          : 'He is down: he comes back with the factory weapon of his slot, and can be re-armed after the next battle';
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          pick.armsOpen = pick.armsOpen === s.index ? null : s.index;
          onChange();
        });
        row.append(btn);
        if (pick.armsOpen === s.index && s.canChange) row.append(weaponMenu(s, menu, escolhida));
        if (kitMenu.length) {
          const kb = document.createElement('button');
          kb.className = 'man-btn kit';
          kb.textContent = '＋ item';
          kb.disabled = !s.canTake;
          kb.title = s.canTake ? 'Give him one extra item (one per soldier)'
            : s.why === 'crew' ? 'The crew of a machine carries no extra item'
            : 'He is down: he can be kitted after the next battle';
          kb.addEventListener('click', (ev) => { ev.stopPropagation(); pick.kitOpen = pick.kitOpen === s.index ? null : s.index; onChange(); });
          // 06/11 (autor): os botoes do item numa caixa propria na linha 3 — o "undo" solto caia na celula do "⇄ weapon"
          // e o cobria, e com um item escolhido a arma nao se trocava mais
          const kbs = document.createElement('div');
          kbs.className = 'man-kit-btns';
          // DESFAZER A ESCOLHA (19/10, autor): o soldado volta ao que ja tinha, sem custo
          if (kitEsc !== undefined) {
            const ub = document.createElement('button');
            ub.className = 'man-btn kit-undo';
            ub.textContent = '↶ undo';
            ub.title = `Cancel this item choice: he keeps ${s.kit ? s.kitName || s.kit : 'no item'}`;
            ub.addEventListener('click', (ev) => { ev.stopPropagation(); men.chooseKit(s.index, undefined); pick.kitOpen = null; onChange(); });
            kbs.append(ub);
          }
          kbs.append(kb);
          row.append(kbs);
          if (pick.kitOpen === s.index && s.canTake) row.append(kitMenuBox(s, kitMenu, kitEsc));
        }
      }
      col.append(row);
    }
    return col;
  };

  // O MENU DO ITEM: os lancadores, as cargas, o laser; "drop it" quando ja ha um comprado. Desde 19/10 o lancador vai
  // tambem para quem tem a mao 2 de fabrica ocupada: ele SUBSTITUI aquela arma enquanto o homem tiver o item.
  const kitMenuBox = (s, menu, escolhido) => {
    const box = document.createElement('div');
    box.className = 'man-menu';
    const opcoes = menu.filter((o) => !(o.kind === 'launcher' && o.id === s.factorySecond)).map((o) => ({ ...o }));
    if (s.kit) opcoes.unshift({ id: null, name: `drop ${s.kitName || s.kit}`, price: 0 });
    // com uma escolha feita, a primeira opcao a desfaz (19/10); clicar de novo na escolhida tambem
    if (escolhido !== undefined) opcoes.unshift({ id: undefined, undo: true, name: '↶ undo selection', price: 0 });
    for (const o of opcoes) {
      const item = document.createElement('button');
      const atual = !o.undo && (escolhido !== undefined ? escolhido : s.kit) === o.id;
      item.className = `man-opt${atual ? ' on' : ''}`;
      const sai = substitui(s, o);
      if (o.kind === 'launcher' && s.why2 === 'hand2' && o.id !== s.kit) item.title = `He drops ${s.factorySecondName || s.factorySecond} from his other hand while he carries it; it comes back if the item is dropped`;
      const nome = document.createElement('span');
      nome.textContent = o.name + (o.id === s.kit && o.id ? ' — has it' : '') + (sai.length ? ` (replaces ${sai.join(' and ')})` : '');
      const preco = document.createElement('span');
      preco.className = 'man-opt-price';
      preco.textContent = o.undo || o.id === null || o.id === s.kit ? '' : `${o.kind === 'launcher' ? 'launcher' : o.kind}${o.price ? ' · ' + o.price + ' cr' : ''}`;
      item.append(nome, preco);
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        men.chooseKit(s.index, o.undo || o.id === s.kit || (escolhido !== undefined && o.id === escolhido) ? undefined : o.id);
        pick.kitOpen = null;
        onChange();
      });
      box.append(item);
    }
    return box;
  };

  // O QUE UM ITEM TIRA DELE: o item comprado antes e, se for lancador numa mao 2 de fabrica ocupada, a arma dela
  const substitui = (s, o) => {
    if (!o || o.undo || !o.id || o.id === s.kit) return [];
    const sai = s.kit ? [s.kitName || s.kit] : [];
    const kitNaMao2 = !!s.kit && /^\d+\/\d+$/.test(s.kit);
    if (o.kind === 'launcher' && s.why2 === 'hand2' && !kitNaMao2) sai.push(s.factorySecondName || s.factorySecond);
    return sai;
  };

  // THE MENU: every weapon on offer, with its class and price; his own at the top ("keeps it").
  const weaponMenu = (s, menu, escolhida) => {
    const box = document.createElement('div');
    box.className = 'man-menu';
    const opcoes = menu.some((x) => x.weapon === s.weapon) ? menu : [{ weapon: s.weapon, name: s.weaponName, class: null, price: 0 }, ...menu];
    for (const o of opcoes) {
      const item = document.createElement('button');
      const dele = o.weapon === s.weapon;
      item.className = `man-opt${(escolhida || s.weapon) === o.weapon ? ' on' : ''}`;
      const nome = document.createElement('span');
      nome.textContent = (o.name || `${o.weapon} (unnamed)`) + (dele ? ' — keeps it' : '');
      const preco = document.createElement('span');
      preco.className = 'man-opt-price';
      preco.textContent = dele ? '' : `${o.class ? o.class + ' · ' : ''}${o.price ? o.price + ' cr' : 'free'}`;
      item.append(nome, preco);
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        men.choose(s.index, dele ? null : o.weapon);
        pick.armsOpen = null;
        onChange();
      });
      box.append(item);
    }
    return box;
  };

  const block = (b) => {
    const n = b.node;
    const on = pick.keep.has(n.key);
    // Not taken, but standing over something that was: in the file a company needs its battalion,
    // so the heading comes along and the block says so instead of reading as left out.
    const implied = !on && pick.implied && pick.implied.has(n.key);
    // A FORMACAO COMPLETA (04/10, autor): toda unidade abaixo dela ja esta tomada ou ja e dele. O
    // bloco da formacao nao entra no conjunto — so as unidades —, entao um pelotao comprado inteiro
    // ficava tracejado como "so o cabecalho". Agora o contorno fecha: nao ha mais nada a comprar ali.
    let completa = false, todaDele = false;
    if (n.isFormation) {
      const folhas = []; const junta = (x) => { if (x.isFormation) x.children.forEach(junta); else if (!x.ghost) folhas.push(x); }; junta(n);
      completa = folhas.length > 0 && folhas.every((x) => x.owned || pick.keep.has(x.key));
      todaDele = completa && folhas.every((x) => x.owned);
    }
    const kids = n.children.length;
    const units = n.isFormation ? n.units : 1;
    const el = document.createElement('div');
    // Losses are drawn, not tabulated: a unit that is short of men gets a torn red edge and the
    // aid cross, and its block offers to make it whole again.
    const wound = hurt ? hurt(n) : null;
    const picked = force && force.has ? force.has(n) : false;
    // Fora da forca (28/09): `outOf` diz como — tirada de campo, vendida, ou a venda no rascunho —
    // com o rotulo da linha de baixo e a classe do bloco. So a loja o passa.
    const fora = !n.isFormation && outOf ? outOf(n) : null;
    el.className = `blk ${on ? 'on' : 'off'}${implied && !completa ? ' implied' : ''}${completa ? ' full' + (todaDele ? ' full-owned' : '') : ''}${n.owned ? ' fielded' : ''}${wound && wound.down.length ? ' hurt' : ''}${picked ? ' sel' : ''}${n.ghost || (pick.attached && pick.attached.has(n.key)) ? ' attached' : ''}${lost && lost(n) ? ' lost' + (lost(n).bought ? ' bought' : '') : ''}${fora ? ' ' + fora.cls : ''} ${n.isFormation ? 'form' : 'unit'}`;
    // Clicar no bloco tambem seleciona. Nao ha ambiguidade: TOMAR e o botao, e o botao para o
    // clique antes que ele chegue aqui — a queixa antiga era ter dois cliques com o mesmo alvo, e
    // aqui o alvo e o corpo do bloco, nao um botao dele.
    // O fantasma tambem se clica. Ele responde pela unidade de verdade — `force` cuida da traducao —
    // e sem isso o veiculo avulso era a unica coisa no grafico que nao dava para selecionar.
    if (force && force.click) {
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('.blk-btn, .blk-xp-sel')) return;
        force.click(n, ev.ctrlKey || ev.metaKey || ev.shiftKey);
      });
    }
    if (wound && wound.down.length) {
      const cross = document.createElement('div');
      cross.className = 'blk-wound' + (wound.chosen === wound.down.length ? ' healed' : '');
      cross.textContent = wound.chosen === wound.down.length ? '✚' : String(wound.down.length);
      cross.title = wound.chosen === wound.down.length
        ? 'Back to full strength next battle'
        : `${wound.down.length} men down`;
      el.append(cross);
    }
    el.style.left = `${b.x}px`;
    el.style.top = `${b.y}px`;

    // What the unit will BE: the equipment chosen for it (the Modifiers panel changes it, the chart
    // says it), or what the library rolled.
    const nome = force && force.nameOf ? force.nameOf(n) : n.name;
    const full = nome + (n.occurrence > 1 ? ` #${n.occurrence}` : '');
    const title = document.createElement('div');
    title.className = 'blk-name';
    title.textContent = full;

    // The parent formation, under the name. In the chart it is the block one level up, but a unit
    // read on its own — panned to, or zoomed out — should still say what it belongs to.
    const above = lineage(n);
    const where = document.createElement('div');
    where.className = 'blk-where';
    // A vehicle bought on its own says who it was bought FOR. In the file it is its own little
    // group — the game does the same with a single vehicle — so this line is the app's promise,
    // not the file's structure.
    const para = pick.attachedTo && pick.attachedTo[n.key];
    where.textContent = para ? `attached to ${para}` : (above.length ? above[0] : '');

    const meta = document.createElement('div');
    meta.className = 'blk-meta';
    // WHAT KIND OF BLOCK THIS IS, as a chip rather than the first word of the meta line: a heading
    // and a thing you can buy read differently at a glance, and at chart zoom the eye catches the
    // chip and the title strip long before it reads the words.
    const chip = document.createElement('span');
    chip.className = `blk-kind ${n.isFormation ? 'form' : 'unit'}`;
    chip.textContent = n.isFormation ? 'formation' : 'unit';
    meta.append(chip);
    const bits = [];
    if (!n.isFormation && n.role) bits.push(n.role);
    // What the unit IS, after any modifier: the chart says it, the Modifiers panel changes it.
    // With no force behind the chart there is no modifier either, so what the library rolled is
    // the whole answer — and it is the thing worth knowing before buying.
    const nivel = force ? force.levelOf(n) : (n.isFormation ? null : n.experience || null);
    if (nivel !== undefined && nivel !== null) bits.push(nivel);
    else if (force) bits.push('mixed');
    if (nome !== n.name) bits.push(`was ${n.name}`);
    if (kids) bits.push(`${kids} branch${kids > 1 ? 'es' : ''}`);
    if (n.isFormation) bits.push(`${units} units`);
    if (n.offMap || n.offMapUnits) bits.push('off-map');
    if (completa) bits.push(todaDele ? 'all in the field' : 'complete');
    else if (implied) bits.push('heading only');
    if (n.owned && !(fora && fora.cls.includes('stood-down'))) bits.push('in the field');
    if (wound && wound.down.length) bits.push(`${wound.down.length} down of ${wound.strength}`);
    // A machine the player marked as destroyed. It stays in the chart — it is still his unit, and
    // the campaign still knows it — but nothing about it is available until it is replaced.
    const wreck = lost ? lost(n) : null;
    if (wreck) {
      bits.push(wreck.bought ? `DESTROYED · REPLACEMENT BOUGHT · ${wreck.price} cr`
        : wreck.spare ? `DESTROYED · replace for ${wreck.price} cr` : 'DESTROYED · no spare in the arsenal');
    }
    if (fora) bits.push(fora.label);
    if (bits.length) meta.append(document.createTextNode(bits.join(' · ')));

    // Nothing on the block wraps, so the tooltip carries whatever had to be cut.
    el.title = [full, above.length ? 'in ' + above.join(' / ') : null, meta.textContent]
      .filter(Boolean).join('\n');

    const price = document.createElement('div');
    price.className = 'blk-price';
    price.textContent = `${nodeCost(n, priceOf)} cr`;

    const bar = document.createElement('div');
    bar.className = 'blk-bar';
    const acao = actionButton(n);
    if (acao) bar.append(acao);

    // ON MAP / OFF MAP. O jogo faz esta pergunta ao comprar um morteiro ou um obus e a tela nao
    // fazia. So aparece nas pecas que a biblioteca tem dos dois jeitos — nas outras o jogo tambem
    // nao oferece escolha, e um botao morto seria pior do que nenhum.
    const dep = !readOnly && force && force.deployment ? force.deployment(n) : null;
    if (dep) bar.append(deployButton(n, dep));

    // OS HOMENS DE UMA SPECIAL FORCES (28/09): abre a coluna de soldados debaixo do bloco.
    const soldados = menOf(n);
    if (soldados) {
      const aberto = !!(pick.men && pick.men.has(n.key));
      const escolhidos = soldados.readOnly ? 0 : soldados.men.filter((s) => men.chosen(s.index)).length;
      const btn = document.createElement('button');
      btn.className = 'blk-btn men' + (escolhidos ? ' on' : '');
      btn.textContent = aberto ? '− men' : `▾ men (${soldados.men.length})${escolhidos ? ` · ${escolhidos} ⇄` : ''}`;
      btn.title = soldados.readOnly ? 'The slots of this unit and the weapon the factory gives each one' : 'Show the soldiers and the weapon each one carries';
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        pick.men = pick.men || new Set();
        if (aberto) { pick.men.delete(n.key); pick.armsOpen = null; } else pick.men.add(n.key);
        onChange();
      });
      bar.append(btn);
    }

    if (kids) {
      const open = pick.open.has(n.key);
      const grow = document.createElement('button');
      grow.className = 'blk-btn';
      grow.textContent = open ? '− close' : '▾ open';
      grow.title = open ? 'Fold the branches back in' : 'Show the next branches';
      grow.addEventListener('click', (ev) => {
        ev.stopPropagation();
        open ? pick.open.delete(n.key) : pick.open.add(n.key);
        onChange();
      });
      bar.append(grow);
    }

    if (wound && wound.down.length && onHeal) {
      const heal = document.createElement('button');
      heal.className = 'blk-btn heal' + (wound.chosen === wound.down.length ? ' on' : '');
      heal.textContent = wound.chosen === wound.down.length
        ? `✓ ${wound.down.length} replaced`
        : `✚ ${wound.down.length} men · ${wound.cost} cr`;
      heal.title = 'Bring this unit back to full strength for the next battle';
      heal.addEventListener('click', (ev) => { ev.stopPropagation(); onHeal(n); });
      bar.append(heal);
    }
    el.append(title, where, meta, price, bar);
    return el;
  };

  // O BOTAO DE TOMAR (ou de largar o avulso), partilhado pelo bloco e pela vista em lista (25/10).
  const actionButton = (n) => {
    const on = pick.keep.has(n.key);
    const fora = !n.isFormation && outOf ? outOf(n) : null;
    // Looking at a formation must never be one keystroke away from buying it, so the read-only
    // chart has no take button at all — not a disabled one.
    // A MAQUINA COMPRADA AVULSA SE DEVOLVE PELO PROPRIO BLOCO. Ela vive noutra escolha, entao o
    // botao de tomar nao serve — o que ela tem e um botao de largar, e `force.detach` acha a
    // unidade de verdade do outro lado. Antes o bloco so dizia "✓ attached" e nao fazia nada, que
    // era o mesmo que comprar sem troco.
    const avulsa = !readOnly && !n.owned && force && force.attached && force.attached(n);
    if (avulsa) {
      const drop = document.createElement('button');
      drop.className = 'blk-btn drop';
      drop.textContent = '✕ drop';
      drop.title = 'Give this machine back — it leaves the force and the credits come back';
      drop.addEventListener('click', (ev) => { ev.stopPropagation(); force.detach(n); });
      return drop;
    } else if (!readOnly) {
      const take = document.createElement('button');
      take.className = 'blk-btn';
      // A WRECK IS NOT TAKEN BACK. It is in the force's tree and it is the player's, but the game
      // will not field it and the app keeps it home anyway (`battlePresence`) — so offering "+ take"
      // was offering to pay full price for a machine that cannot fight. The way back is the
      // replacement, in Vehicles and guns, and the block already says so in its meta line.
      const wreck = !n.isFormation && lost ? lost(n) : null;
      take.textContent = n.ghost ? '✓ attached' : n.sold ? '✕ sold' : n.owned ? (fora ? '— out of the field' : '✓ in the field')
        : wreck ? (wreck.bought ? '✓ replacement bought' : '✕ destroyed') : on ? '✓ in' : '+ take';
      if (n.owned || n.sold || n.ghost || wreck || pick.fixed) take.disabled = true;
      take.title = n.sold ? 'Sold: it left the force for good'
        : n.owned && fora ? 'Yours, but out of the field — bring it back (or sell it) in the Modifiers panel'
        : pick.fixed && !wreck
        ? 'Special forces: a fixed formation — nothing is added to it or taken out of it'
        : wreck
        ? (wreck.bought
          ? `Paid for: this machine is rebuilt and comes back in the next battle, in this slot, with its crew. ${wreck.price} cr.`
          : 'Destroyed. A wreck does not take the field again — replace it in Vehicles and guns.')
        : on
        ? 'Leave this out of the force (everything under it goes too)'
        : 'Take it, with everything under it';
      take.addEventListener('click', (ev) => {
        ev.stopPropagation();
        // A unit already in the field is not a choice: it stays kept whatever the parent does.
        const locked = new Set();
        const scan = (x) => { if (!x.isFormation && x.owned) locked.add(x.key); x.children.forEach(scan); };
        scan(n);
        const keys = n.isFormation ? allKeys(n) : [n.key];
        for (const k of keys) { if (on && !locked.has(k)) pick.keep.delete(k); else pick.keep.add(k); }
        onChange();
      });
      return take;
    }
    return null;
  };

  // ON MAP / OFF MAP, partilhado pelo bloco e pela lista (25/10)
  const deployButton = (n, dep) => {
    const troca = document.createElement('button');
    troca.className = 'blk-btn deploy' + (dep.off ? ' off' : '');
    troca.textContent = dep.off ? '⇅ off map' : '⇅ on map';
    troca.disabled = !dep.livre;
    troca.title = dep.livre
      ? (dep.off
        ? 'Called in by menu, slow to range, nothing on the map to shoot at. Click to bring it onto the map instead.'
        : 'On the map: quick to answer, and it can be seen and killed. Click to buy it off-map instead.')
      : `The library has no ${n.name} left ${dep.off ? 'on the map' : 'off the map'}`;
    troca.addEventListener('click', (ev) => { ev.stopPropagation(); force.setDeployment(n); });
    return troca;
  };

  // TWO GESTURES ON THE BACKGROUND, and the modifier says which. Dragging with the left button
  // draws a LASSO and takes everything it touches; alt-drag or the middle button PANS. A click
  // that does not move drops the selection. The listeners live on the pane, not on the window:
  // this pane is thrown away and rebuilt on every redraw, and window listeners would pile up one
  // per redraw.
  const laco = document.createElement('div');
  laco.className = 'canvas-lasso';
  laco.hidden = true;
  pane.append(laco);

  let drag = null;
  const stop = () => { drag = null; laco.hidden = true; pane.classList.remove('grabbing'); };
  const paraPane = (e) => { const r = pane.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const desenharLaco = (a, b) => {
    laco.hidden = false;
    laco.style.left = `${Math.min(a.x, b.x)}px`;
    laco.style.top = `${Math.min(a.y, b.y)}px`;
    laco.style.width = `${Math.abs(a.x - b.x)}px`;
    laco.style.height = `${Math.abs(a.y - b.y)}px`;
  };

  pane.addEventListener('mousedown', (e) => {
    if (e.target.closest('.blk, .blk-men, .canvas-tools, .mods, .canvas-hud')) return;
    // um clique fora fecha o menu de armas aberto
    if (pick.armsOpen !== undefined && pick.armsOpen !== null) { pick.armsOpen = null; onChange(); return; }
    // With nothing to select, the plain left drag is free to do the useful thing instead.
    const panning = e.button === 1 || e.altKey || readOnly;
    if (e.button !== 0 && !panning) return;
    drag = { modo: panning ? 'pan' : 'laco', x: e.clientX - view.x, y: e.clientY - view.y, de: paraPane(e), x0: e.clientX, y0: e.clientY, add: e.ctrlKey || e.metaKey || e.shiftKey };
    if (panning) pane.classList.add('grabbing');
    e.preventDefault();
  });
  pane.addEventListener('mousemove', (e) => {
    if (!drag) return;
    if (drag.modo === 'pan') { view.x = e.clientX - drag.x; view.y = e.clientY - drag.y; apply(); return; }
    desenharLaco(drag.de, paraPane(e));
  });
  pane.addEventListener('mouseup', (e) => {
    if (drag && drag.modo === 'laco' && force && force.select) {
      const andou = Math.abs(e.clientX - drag.x0) > 4 || Math.abs(e.clientY - drag.y0) > 4;
      if (!andou) force.clear();
      else {
        const r = laco.getBoundingClientRect();
        const dentro = desenhados
          .filter(({ el }) => { const b = el.getBoundingClientRect(); return b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top; })
          .map(({ node }) => node);
        force.select(dentro, drag.add);
      }
    }
    stop();
  });
  pane.addEventListener('mouseleave', stop);
  pane.addEventListener('wheel', (e) => {
    e.preventDefault();
    const z = Math.min(1.6, Math.max(0.4, view.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    view.z = Math.round(z * 100) / 100;
    apply();
  }, { passive: false });

  draw();
  apply();
  // AS PECAS PARA A VISTA EM LISTA (25/10): o botao de tomar/largar, o on/off map e a coluna de homens — os mesmos do
  // bloco, com o mesmo onChange, para a lista nao ter uma segunda ideia do que um clique faz.
  pane.parts = {
    actionButton,
    deployButton: (n) => { const d = !readOnly && force && force.deployment ? force.deployment(n) : null; return d ? deployButton(n, d) : null; },
    menOf,
    menColumn: (n) => (menOf(n) ? menColumn(n) : null),
  };
  return pane;
}
