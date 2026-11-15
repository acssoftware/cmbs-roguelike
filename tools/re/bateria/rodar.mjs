// O EXECUTOR DE TELA DA BATERIA (03/10). Escolhe os casos da tela, cria as campanhas de cada lote (as de
// verdade, pelo createCampaign — a virada precisa do estado), lanca o jogo, carrega a b1 de cada uma,
// salva a virada, aplica a variante de virada pelo app e carrega a b2. Uma linha por etapa em
// research/bateria/<run>/resultados.jsonl. Retoma de onde parou.
//
//   node tools/re/bateria/rodar.mjs --run r1 [--minutos 120] [--lote 6] [--so C001,C002] [--plano]
//
// Regras da casa: nunca dirigir o jogo sem o autor liberar a tela; so matar o que esta sessao lancou;
// nada fora do manifesto e apagado.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as L from './lib.mjs';

const arg = (k, padrao) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : padrao; };
const RUN = arg('--run'); if (!RUN) throw new Error('--run NOME');
const MINUTOS = Number(arg('--minutos', 120)), LOTE = Number(arg('--lote', 6)), SO = arg('--so', null), SO_PLANO = process.argv.includes('--plano');
const DIR = path.join(L.DIR_BATERIA, RUN);
const GF = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/';
const CAMPAIGNS = GF + 'Campaigns', SAVED = GF + 'Saved Games';
const PS1 = path.join(L.RAIZ, 'tools', 're', 'jogo', 'bateria_fn.ps1');
const RES = path.join(DIR, 'resultados.jsonl'), MANIFESTO = path.join(DIR, 'manifesto.json');
const CAPT = path.join(DIR, 'capturas');
const { casos } = JSON.parse(fs.readFileSync(path.join(DIR, 'casos.json'), 'utf8'));
const offline = new Map(L.lerLinhas(path.join(DIR, 'offline.jsonl')).map((l) => [l.id, l]));
const feitos = new Set(L.lerLinhas(RES).filter((l) => l.etapa === 'fim').map((l) => l.caso));
const manifesto = fs.existsSync(MANIFESTO) ? JSON.parse(fs.readFileSync(MANIFESTO, 'utf8')) : { casos: {} };
const gravarManifesto = () => fs.writeFileSync(MANIFESTO, JSON.stringify(manifesto, null, 1));
const t0 = Date.now();
const restam = () => MINUTOS * 60000 - (Date.now() - t0);

// --- quais casos vao para a tela ------------------------------------------------------------------------
// (o plano: A 6, B 8, C 4, D 4) — o que o offline aprovou; dentro de cada familia os de mais volume antes
function escolher() {
  if (SO) return SO.split(',').map((id) => casos.find((c) => c.id === id)).filter(Boolean);
  const ok = (c) => ['OK', 'SUSPEITO'].includes(offline.get(c.id)?.veredito);
  const vol = (c) => offline.get(c.id)?.volume?.registros || 0;
  const pega = (fam, n, ord) => casos.filter((c) => c.familia === fam && ok(c)).sort(ord).slice(0, n);
  const A = pega('A', 6, (a, b) => vol(b) - vol(a));        // colheita: sem orcamento, sem virada (o app recusa Apply com credito negativo)
  const B = VIRADAS.flatMap((v) => pega('B', 2, (a, b) => vol(b) - vol(a)).length ? casos.filter((c) => c.familia === 'B' && c.virada === v && ok(c)).sort((a, b) => vol(b) - vol(a)).slice(0, v === 'E0' ? 1 : 2) : []);
  const C = casos.filter((c) => c.familia === 'C' && c.id.startsWith('C') && offline.get(c.id)?.veredito !== 'ERRO-APP').sort((a, b) => b.onMap - a.onMap).slice(0, 4);
  const D = pega('D', 4, (a, b) => (b.battleNumber * b.effort) - (a.battleNumber * a.effort) || vol(b) - vol(a));
  return [...A, ...B, ...C, ...D];
}
const VIRADAS = ['E0', 'E1', 'E2', 'E3', 'E4', 'E5'];

// --- PowerShell ------------------------------------------------------------------------------------------
function ps(passo, extra = {}, timeoutMs = 900000) {
  const a = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS1, '-Passo', passo];
  for (const [k, v] of Object.entries(extra)) a.push(`-${k}`, String(v));
  const r = spawnSync('powershell.exe', a, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  const linha = (r.stdout || '').split(/\r?\n/).reverse().find((l) => l.startsWith('@@'));
  if (!linha) return { veredito: 'ERRO', detalhe: `sem resposta do PowerShell: ${(r.stderr || r.stdout || '').slice(-400)}` };
  return JSON.parse(linha.slice(2));
}
const registrar = (obj) => { const l = { run: RUN, t: new Date().toISOString(), ...obj }; L.escreverLinha(RES, l); console.log(`${obj.caso || '-'} ${obj.etapa}: ${obj.veredito}${obj.detalhe ? ' — ' + String(obj.detalhe).slice(0, 160) : ''}`); return l; };

// --- criar as campanhas do lote --------------------------------------------------------------------------
const slugDe = (c) => `A-BAT-${c.id}`;
async function criar(c) {
  const slug = slugDe(c);
  if (fs.existsSync(L.C.dirOf ? L.C.dirOf(slug) : path.join(L.RAIZ, 'app', 'campaigns', slug))) return { slug, ja: true };
  if (c.montar) {                                  // familia D: montada direto, sem estado do app
    const m = await L.montar({ ...c.montar, slug });
    fs.copyFileSync(m.camOut, path.join(CAMPAIGNS, `CMBSDC ${slug}.cam`));
    fs.rmSync(m.dir, { recursive: true, force: true });
    return { slug, semEstado: true };
  }
  const s = await L.comSemente(c.seed || 1, () => L.C.createCampaign({ name: `A BAT ${c.id}`, ...c.criar }, () => {}));
  if (s.slug !== slug) throw new Error(`slug ${s.slug} != ${slug}`);
  return { slug };
}
function linhaDaCampanha(slug) {
  const nomes = fs.readdirSync(CAMPAIGNS).filter((f) => f.toLowerCase().endsWith('.cam')).map((f) => f.slice(0, -4).toUpperCase()).sort();
  return nomes.indexOf(`CMBSDC ${slug}`.toUpperCase());
}

// --- a virada por codigo ---------------------------------------------------------------------------------
async function virar(slug, variante, save) {
  const st0 = L.C.loadState(slug);
  L.C.readSave(slug, save);
  const st = L.C.loadState(slug);
  if (st.stage !== 'result') throw new Error(`readSave nao deixou resultado (stage ${st.stage})`);
  const res = st.pending.result;
  const verba = st.credits + (res.income?.total ?? 0);   // a escada (30/10): o que a batalha pagou, as tres linhas
  const presentes = st.units.filter((u) => u.present && !(st.lost || []).includes(u.coreId));
  const sfSources = new Set((st.picks || []).filter((p) => p.sf).map((p) => p.source));
  const deSF = (u) => sfSources.size && [...sfSources].some((s) => String(u.source || u.key || '').includes(s));
  const dormentes = st.units.filter((u) => !u.present && !(st.standDown || []).includes(u.coreId) && !(st.lost || []).includes(u.coreId) && !(st.sold || []).some((s) => s.coreId === u.coreId) && !(L.C.isSpecialForcesUnit ? L.C.isSpecialForcesUnit(st, u) : deSF(u))).sort((a, b) => a.price - b.price);
  const ateVerba = (lista, preco) => { const out = []; let s = 0; for (const u of lista) { const p = preco(u); if (s + p > verba) break; s += p; out.push(u.coreId); } return out; };
  let opcoes = {};
  if (variante === 'E1') opcoes = { purchaseCoreIds: ateVerba(dormentes, (u) => L.C.purchasePrice(st, u, null, L.R)) };
  if (variante === 'E2') {
    const lib = L.K.libFormations(st.nation, { rules: L.R }).filter((f) => !f.trp && f.price <= verba).sort((a, b) => b.price - a.price);
    const f = lib[0]; if (f) opcoes = { buyFormations: [{ source: f.file, nation: st.nation, keep: L.todasAsChaves(L.K.formationTree(f.file)), xp: {} }] };
  }
  if (variante === 'E3') { const ab = L.C.abilityList(L.R)[0]; const vende = presentes.slice(-1).map((u) => u.coreId); opcoes = { train: ateVerba(presentes.filter((u) => !vende.includes(u.coreId)), (u) => { try { return L.C.trainPrice(st, u, L.R)?.price ?? 1e9; } catch { return 1e9; } }), abilities: ab ? [ab.id] : [], sell: vende }; }
  if (variante === 'E4') {
    const maq = presentes.filter((u) => ['tank', 'ifv', 'apc', 'afv', 'recon'].includes(u.role)).slice(0, 2);
    for (const u of maq) L.C.markVehicle(slug, u.coreId, 'destroyed');
    opcoes = { replaceVehicles: maq.map((u) => u.coreId) };
  }
  // compras grandes demais: corta pela metade ate caber
  for (let k = 0; ; k++) {
    try { await L.C.applyResult(slug, opcoes, () => {}); break; }
    catch (e) {
      const lista = opcoes.purchaseCoreIds || opcoes.train;
      if (k < 5 && lista?.length > 1 && /credit|afford|budget/i.test(e.message)) { lista.splice(Math.ceil(lista.length / 2)); continue; }
      throw e;
    }
  }
  if (variante === 'E5') await L.C.regenerateBattle(slug, { newMap: true }, () => {});
  const fim = L.C.loadState(slug);
  const arq = fim.current?.playFrom?.file;
  if (!arq || !fs.existsSync(arq)) throw new Error('a virada nao deixou save para a b2');
  const agora = new Date(); fs.utimesSync(arq, agora, agora);          // a linha 0 de Saved Games
  return { opcoes: Object.fromEntries(Object.entries(opcoes).map(([k, v]) => [k, Array.isArray(v) ? v.length : v])), save: arq, creditos: [st0.credits, fim.credits] };
}

// --- limpeza ---------------------------------------------------------------------------------------------
function guardarEApagar(c, info, falhou) {
  const slug = info.slug; const dirC = path.join(L.RAIZ, 'app', 'campaigns', slug);
  const cam = path.join(CAMPAIGNS, `CMBSDC ${slug}.cam`);
  const saves = fs.readdirSync(SAVED).filter((f) => f.startsWith(`${slug} `)).map((f) => path.join(SAVED, f));
  if (falhou) {
    const dest = path.join(L.DIR_BATERIA, 'falhas', `${RUN}-${c.id}`); fs.mkdirSync(dest, { recursive: true });
    if (fs.existsSync(cam)) fs.copyFileSync(cam, path.join(dest, path.basename(cam)));
    for (const s of saves) fs.copyFileSync(s, path.join(dest, path.basename(s)));
    if (fs.existsSync(dirC)) fs.cpSync(dirC, path.join(dest, 'campanha'), { recursive: true });
  }
  fs.rmSync(dirC, { recursive: true, force: true }); fs.rmSync(cam, { force: true }); for (const s of saves) fs.rmSync(s, { force: true });
}

// --- o run -----------------------------------------------------------------------------------------------
const fila = escolher().filter((c) => !feitos.has(c.id));
console.log(`${fila.length} casos na tela: ${fila.map((c) => c.id).join(' ')}`);
if (SO_PLANO) process.exit(0);
fs.mkdirSync(CAPT, { recursive: true });

let jogoAberto = false, cargas = 0;
const abrir = () => { const r = ps('lancar', { Tag: 'lancar' }); jogoAberto = r.veredito === 'OK'; if (!jogoAberto) registrar({ etapa: 'lancar', ...r }); cargas = 0; return jogoAberto; };
const fechar = () => { ps('matar'); jogoAberto = false; };

for (let i = 0; i < fila.length && restam() > 4 * 60000; i += LOTE) {
  const lote = fila.slice(i, i + LOTE);
  // 1. as campanhas, antes de lancar o jogo
  const infos = new Map();
  for (const c of lote) {
    try { const info = await criar(c); infos.set(c.id, info); manifesto.casos[c.id] = { ...info, criado: new Date().toISOString() }; gravarManifesto(); }
    catch (e) { registrar({ caso: c.id, etapa: 'criar', veredito: 'ERRO-APP', detalhe: e.message }); registrar({ caso: c.id, etapa: 'fim', veredito: 'ERRO-APP' }); }
  }
  // 2. a tela
  for (const c of lote) {
    const info = infos.get(c.id); if (!info) continue;
    if (restam() < 4 * 60000) break;
    if (!jogoAberto && !abrir()) { console.log('nao consegui abrir o jogo; paro'); process.exit(1); }
    const linha = linhaDaCampanha(info.slug);
    if (linha < 0 || linha > 19) { registrar({ caso: c.id, etapa: 'b1', veredito: 'ERRO', detalhe: `linha ${linha} fora da primeira pagina` }); continue; }
    const nomeSave = `${info.slug} T1`;
    const r1 = ps('b1', { Linha: linha, Nome: nomeSave, Tag: c.id, Seg: 300 }); cargas++;
    registrar({ caso: c.id, etapa: 'b1', linha, offline: offline.get(c.id)?.veredito, volume: offline.get(c.id)?.volume, ...r1 });
    let falhou = r1.veredito !== 'OK';
    if (!falhou) {
      // a prova de que carregou a campanha certa: o save embute a batalha A dela
      const f = path.join(SAVED, `${nomeSave}.bts`);
      try { const fatos = L.T.saveFacts(f); if (!fatos.embedded?.includes(`CMBSDC ${info.slug} A`)) { registrar({ caso: c.id, etapa: 'b1', veredito: 'CAMPANHA-ERRADA', detalhe: `embute ${fatos.embedded?.join(', ')}` }); fechar(); process.exit(1); } } catch (e) { registrar({ caso: c.id, etapa: 'b1', veredito: 'ERRO', detalhe: `saveFacts: ${e.message}` }); }
      const cf = L.conferirSave(f); registrar({ caso: c.id, etapa: 'virada-save', veredito: L.veredito(cf).veredito, detalhe: JSON.stringify(cf.roster) });
      if (c.virada && !info.semEstado) {
        try {
          const v = await virar(info.slug, c.virada, f);
          const cb = L.conferirSave(v.save);
          registrar({ caso: c.id, etapa: 'virada', veredito: 'OK', variante: c.virada, detalhe: JSON.stringify(v.opcoes), offline: L.veredito(cb).veredito, roster: cb.roster });
          const r2 = ps('b2', { Tag: c.id, Seg: 300 }); cargas++;
          registrar({ caso: c.id, etapa: 'b2', variante: c.virada, ...r2 });
          falhou = r2.veredito !== 'OK';
        } catch (e) { registrar({ caso: c.id, etapa: 'virada', veredito: 'ERRO-APP', variante: c.virada, detalhe: e.message }); falhou = true; }
      }
    }
    registrar({ caso: c.id, etapa: 'fim', veredito: falhou ? 'FALHA' : 'OK' });
    if (falhou || cargas >= 14) fechar();
    guardarEApagar(c, info, falhou);
    delete manifesto.casos[c.id]; gravarManifesto();
  }
}
if (jogoAberto) fechar();
console.log(`fim do run em ${Math.round((Date.now() - t0) / 60000)} min`);
