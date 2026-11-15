// A BATERIA DE CARGA (03/10, plano de 02/10): casos de formacoes (forca do jogador e defesa) montados por
// codigo, conferidos offline e depois carregados no jogo, para antecipar crash e "Out of memory".
//
// `montar` repete os passos do `createCampaign` (priceOfPicks -> buildCoreForce -> desligar folhas ->
// planDefense -> buildBattle -> buildCampaign) numa pasta TEMPORARIA, sem estado de campanha e sem tocar
// nas pastas do jogo: e o que deixa rodar centenas de casos offline. Os casos que vao para a tela nascem
// pelo `createCampaign` de verdade (rodar.mjs), porque a virada precisa do estado.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '../../..');
const M = (p) => new URL(`file:///${path.join(RAIZ, p).replace(/\\/g, '/')}`).href;
export const C = await import(M('app/src/campaign.mjs'));
export const F = await import(M('app/src/forge.mjs'));
export const D = await import(M('app/src/defense.mjs'));
export const K = await import(M('app/src/catalog.mjs'));
export const T = await import(M('app/src/transition.mjs'));
const EX = await import(M('tools/re/extras.mjs'));
const CO = await import(M('tools/re/core.mjs'));
const CAM = await import(M('tools/re/cam.mjs'));
const RC = await import(M('tools/re/roster_cam.mjs'));
const RO = await import(M('tools/re/roster.mjs'));
const MAPA = await import(M('tools/re/mapa.mjs'));
const IA = await import(M('tools/re/ia.mjs'));

export { RAIZ };
export const R = C.rules();
export const QUIETO = { read() {}, wrote() {}, event() {}, step: async (_n, _d, f) => f() };
export const DIR_BATERIA = path.join(RAIZ, 'research', 'bateria');

// --- arvore -----------------------------------------------------------------------------------------
export const todasAsChaves = (tree) => { const out = []; const w = (n) => { out.push(n.key); n.children.forEach(w); }; tree.roots.forEach(w); return out; };
export const nos = (tree) => { const out = []; const w = (n, pai) => { out.push({ ...n, pai }); n.children.forEach((c) => w(c, n)); }; tree.roots.forEach((r) => w(r, null)); return out; };
// a subarvore de um no: ele, os descendentes e os ancestrais (o prunePlan pede as chaves dos cabecalhos)
export function subarvore(tree, key) {
  const out = new Set(); const todos = nos(tree); const no = todos.find((n) => n.key === key);
  if (!no) throw new Error(`no ${key} nao achado`);
  const desce = (n) => { out.add(n.key); n.children.forEach(desce); }; desce(no);
  for (let k = key; k.includes('.'); ) { k = k.slice(0, k.lastIndexOf('.')); out.add(k); }
  return [...out];
}
export function folhasCom(tree, chaves) {
  const out = new Set();
  for (const key of chaves) { out.add(key); for (let k = key; k.includes('.'); ) { k = k.slice(0, k.lastIndexOf('.')); out.add(k); } }
  return [...out];
}

// --- semente: createCampaign sorteia seed e sufixo com Math.random -------------------------------------
export async function comSemente(seed, fn) {
  const original = Math.random; Math.random = D.rng(seed);
  try { return await fn(); } finally { Math.random = original; }
}

// --- montar um caso (offline) ------------------------------------------------------------------------
// caso: { picks, nation?, armies, enemySide, battleNumber=1, seed, effort=1, profile?, mapa?, face?, harvest?, mapaEntrada? }
// `mapaEntrada`: uma linha de censo com `arquivo` (caminho absoluto) para um mapa fora do pacote (E146, os Meet).
export async function montar(caso, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bat-'))) {
  // o gerador fala pelo console.log (e cala o "NAO FOI POSICIONADA" se ninguem ouvir): as linhas voltam em `log`
  const log = console.log; const linhas = []; console.log = (...x) => { linhas.push(x.join(' ')); };
  try { const r = await montarFalando(caso, dir); r.log = linhas; r.naoPosicionada = linhas.filter((l) => /NAO FOI POSICIONADA/.test(l)); return r; } finally { console.log = log; }
}
async function montarFalando(caso, dir) {
  const exercitos = caso.armies || [...new Set(caso.picks.map((p) => p.nation))];
  const ladoInimigo = caso.enemySide || (exercitos.includes('RU') ? 'US' : 'RU');
  const enemy = { US: 'US', RU: 'RU' }[ladoInimigo];
  const enemyArmies = ladoInimigo === 'US' ? ['US', 'UKR'] : ['RU'];
  const contagem = {}; for (const p of caso.picks) contagem[p.nation] = (contagem[p.nation] || 0) + (p.keep?.length || 1);
  const nation = caso.nation || Object.entries(contagem).sort((a, b) => b[1] - a[1])[0][0];
  const t0 = Date.now(); const tempos = {};
  const priced = C.priceOfPicks(caso.picks, nation, R);
  const uncovered = priced.flatMap((p) => p.uncovered.map((u) => `${u.name} in ${p.source}`));
  if (uncovered.length) throw Object.assign(new Error(`uncovered: ${[...new Set(uncovered)].join('; ')}`), { esperado: true });
  const onMap = priced.reduce((a, p) => a + (p.onMapUnits || 0), 0);
  if (!onMap) throw Object.assign(new Error('nenhuma unidade no mapa'), { esperado: true });
  const preco = priced.reduce((a, p) => a + (p.price || 0), 0);
  // o mapa: o menor que cabe a forca (o harvestMap), ou o pedido
  const censo = K.mapCensus();
  const mapa = caso.mapaEntrada || (caso.mapa ? censo.find((m) => m.f === caso.mapa) : censo.filter((m) => (m.capVermelho ?? 0) >= onMap && m.tipo !== 'Meet').sort((a, b) => (a.capVermelho ?? 0) - (b.capVermelho ?? 0))[0]);
  if (!mapa) throw Object.assign(new Error(`nenhum mapa cabe ${onMap} unidades`), { esperado: true });
  const mapFile = caso.mapaEntrada?.arquivo || K.mapFile(mapa);
  const coreOut = path.join(dir, 'core-force.btt');
  await F.buildCoreForce({ picks: priced, nation, enemy, mapFile, workDir: path.join(dir, 'work'), out: coreOut, trace: QUIETO });
  tempos.core = Date.now() - t0;
  // folhas desligadas (o mesmo do createCampaign)
  const dirU = F.unitDirectory(coreOut); const porChave = new Map(dirU.map((u) => [u.key, u]));
  const desligar = []; priced.forEach((p, i) => { for (const d of p.dropped || []) { const u = porChave.get(C.chaveNaForca(i, d.key)); if (u) desligar.push(u.coreId); } });
  if (dirU.roots === priced.length && desligar.length) { const tmp = path.join(dir, 'work', 'core-pruned.btt'); F.activateUnits({ coreFile: coreOut, out: tmp, ids: desligar, present: false, trace: QUIETO }); fs.copyFileSync(tmp, coreOut); }
  // a defesa e a batalha
  const battleNumber = caso.battleNumber || 1;
  const defense = D.planDefense({ nation: enemy, nations: enemyArmies, battleNumber, rules: R, seed: caso.seed ?? 1, profile: caso.profile || mapa.perfil, effort: caso.effort ?? 1, kind: mapa.tipo || 'Assault', trace: QUIETO });
  const regras = caso.face === undefined ? R : { ...R, defense: { ...R.defense, faceThePlayer: { ...R.defense.faceThePlayer, on: !!caso.face } } };
  const bttOut = path.join(dir, 'battle.btt');
  const t1 = Date.now();
  await F.buildBattle({ coreFile: coreOut, defense, mapFile, duration: 60, nation, enemy: defense.nation || enemy, out: bttOut, rules: regras, trace: QUIETO, attack: mapa.tipo || 'Assault' });
  tempos.batalha = Date.now() - t1;
  const camOut = path.join(dir, 'campaign.cam');
  await F.buildCampaign({ coreFile: coreOut, battles: [{ nome: `CMBSDC ${caso.slug || 'BAT'} A`, btt: bttOut, nextWin: 1, nextLose: 1 }, { nome: `CMBSDC ${caso.slug || 'BAT'} B`, btt: bttOut, nextWin: 0, nextLose: 0 }], out: camOut, percentages: C.campaignPercentages(R), trace: QUIETO });
  tempos.total = Date.now() - t0;
  return { dir, coreOut, bttOut, camOut, mapa: mapa.f, nation, enemy, onMap, preco, defesa: { nation: defense.nation, units: defense.units, cost: defense.cost, tier: defense.tier }, tempos };
}

// --- medidas e conferencias por artefato --------------------------------------------------------------
const tam = (f) => (fs.existsSync(f) ? fs.statSync(f).size : 0);

// a forca e a batalha: as checagens do buildBattle, mais o mapa e a IA
export function conferirBtt(btt) {
  const r = { erros: [], avisos: [] };
  try { const v = EX.verificarForca(btt); r.erros.push(...(v.erros || [])); r.avisos.push(...(v.avisos || [])); r.registros = v.registros; r.topos = v.topos; } catch (e) { r.erros.push(`verificarForca: ${e.message}`); }
  try { const m = CO.presentesSobMascara(btt); if (m.length) r.erros.push(`${m.length} ligadas sob mascara`); } catch (e) { r.avisos.push(`mascara: ${e.message}`); }
  try { const m = MAPA.lerMapa(btt); r.mapa = { W: m.W, H: m.H, casas: m.construcoes.length, iaConfere: !!m.iaConfere }; if (!m.iaConfere) r.erros.push('a regiao de IA nao confirma a grade'); } catch (e) { r.erros.push(`lerMapa: ${e.message}`); }
  try { const p = IA.lerPlanos(btt); r.ia = { confiavel: !!p.confiavel, planos: p.planos?.length ?? 0 }; if (!p.confiavel) r.avisos.push('planos de IA ilegiveis'); } catch (e) { r.avisos.push(`lerPlanos: ${e.message}`); }
  r.bytes = tam(btt);
  return r;
}

// a campanha: batalhas, roster (contagem, blocos, cauda), volume
export function conferirCam(cam, coreFile = null) {
  const r = { erros: [], avisos: [] };
  try {
    const c = CAM.lerCam(cam);
    r.batalhas = c.batalhas.map((b) => b.nome);
    const ro = RC.acharRoster(c.cabecalho);
    if (!ro) { r.erros.push('roster nao achado no .cam'); return r; }
    const lista = RC.lerLista(ro.exp);
    r.roster = { blocos: lista.blocos.length, bytesExp: ro.exp.length, bytesLz: ro.tam, homens: lista.blocos.reduce((a, b) => a + b.n, 0) };
    r.roster.blocoMax = Math.max(...lista.blocos.map((b) => b.tam));
    r.roster.semFF = lista.blocos.filter((b) => b.buf.lastIndexOf(Buffer.from([0xff, 0xff])) < 0).length;
    // no .cam recem-criado os blocos nascem VAZIOS (E83): o ff ff so aparece quando o jogo instancia os
    // homens. A medida fica; o erro nao (calibrado no .cam da RUS1 e num caso montado: 100% sem ff ff).
    if (coreFile) {
      const core = RC.unidadesDoCore(coreFile);
      r.core = { unidades: core.length, presentes: core.filter((u) => u.presente).length };
      if (core.length !== lista.blocos.length) r.erros.push(`core ${core.length} != roster ${lista.blocos.length}`);
    }
  } catch (e) { r.erros.push(`lerCam: ${e.message}`); }
  r.bytes = tam(cam);
  return r;
}

// um save (virada ou [B02]): homens, caudas com cabeca certa, blocos legiveis, batalhas embutidas
export function conferirSave(save) {
  const r = { erros: [], avisos: [] };
  try {
    const a = CAM.anatomiaDoSave(save);
    r.batalhas = a.batalhas.map((b) => b.nome);
    r.liveBytes = a.blocos[1]?.t ?? 0;
  } catch (e) { r.erros.push(`anatomia: ${e.message}`); }
  try {
    const ro = RO.lerRoster(save); const cd = RO.caudasDoRoster(save);
    const homens = ro.unidades.reduce((a, u) => a + u.soldados.length, 0);
    let certas = 0, lidas = 0;
    for (const u of ro.unidades) for (const s of u.soldados) { const d = cd[s.indice]; if (!d?.cauda) continue; lidas++; if (RO.lerCauda(d.cauda)?.cabecaCerta) certas++; }
    r.roster = { unidades: ro.unidades.length, homens, caudas: lidas, cabecaCerta: lidas ? +(certas / lidas).toFixed(3) : null };
    // so com amostra que diga alguma coisa: 2 de 11 fora (B023) e ruido, nao defeito
    if (lidas >= 20 && certas / lidas < CABECA_CERTA_MIN) r.avisos.push(`so ${(100 * certas / lidas).toFixed(0)}% das caudas com cabeca certa (bons: 93-96%)`);
  } catch (e) { r.erros.push(`lerRoster: ${e.message}`); }
  r.bytes = tam(save);
  return r;
}

// avisos que todo arquivo bom tem (calibrado na RUS1 e nas colheitas): posicao de peca fora do mapa e o
// N do cabecalho contando as aeronaves
const AVISO_CONHECIDO = [/posicao nao legivel/, /^N=\d+, unidades \d+/];
// a cauda com cabeca certa: 93-96% nos saves bons (RUS1 b5, [B06], colheita US 1)
export const CABECA_CERTA_MIN = 0.85;
export function veredito(...partes) {
  const erros = partes.flatMap((p) => p?.erros || []), avisos = partes.flatMap((p) => p?.avisos || []).filter((a) => !AVISO_CONHECIDO.some((re) => re.test(a)));
  return { veredito: erros.length ? 'FALHA' : avisos.length ? 'SUSPEITO' : 'OK', erros, avisos };
}

// --- jsonl ---
export const escreverLinha = (arq, obj) => { fs.mkdirSync(path.dirname(arq), { recursive: true }); fs.appendFileSync(arq, JSON.stringify(obj) + '\n'); };
export const lerLinhas = (arq) => (fs.existsSync(arq) ? fs.readFileSync(arq, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
