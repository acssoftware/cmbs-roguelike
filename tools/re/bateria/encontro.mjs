// A BATERIA DOS MAPAS DE MEETING ENGAGEMENT (05/10/2026, E146; autor: "preciso garantir que os nossos modelos de escrever
// unidades nestes mapas funcionem"). Para cada mapa de Quick Battle cujo byte de tipo diz Meeting Engagement (78: os
// " Meet" e os seis "m"), uma batalha montada pelo caminho do app — forca russa do tamanho da zona vermelha contra a
// defesa do tier do mapa — e conferida offline:
//   - o mapa sai do transplante igual (o buildBattle recusa se nao) e a regiao de IA confirma a grade;
//   - a estrutura da forca fecha (conferirBtt), o .cam fecha (conferirCam);
//   - o tipo gravado e Meeting Engagement (0x03), nao "Red Assault";
//   - GEOMETRIA: toda unidade colocada esta dentro da zona de setup do seu lado (x = 8*tile + 4);
//   - a IA azul tem grupos no plano usado, e ninguem ficou sem posicao.
// Os .cam ficam em research/bateria/<run>/cams, no formato que memoria_rodar.mjs carrega na tela (fase 1).
//   node tools/re/bateria/encontro.mjs [--run me1] [--so E01,E07] [--alvo 0.5] [--teto 150] [--relatorio]
//   node tools/re/bateria/memoria_rodar.mjs --run me1 --fases 1        (a tela: processo novo por mapa, ate o setup)
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';
import { pintura } from '../zonas.mjs';
import { gruposUsados } from '../ia.mjs';
import { ler as lerTipo } from '../tipo_batalha.mjs';
import { lerMapa } from '../mapa.mjs';

const arg = (k, padrao) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : padrao; };
const RUN = arg('--run', 'me1'); const SO = arg('--so', null); const ALVO = Number(arg('--alvo', '0.5')); const TETO = Number(arg('--teto', '150'));
const DIR = path.join(L.DIR_BATERIA, RUN), CAMS = path.join(DIR, 'cams'); fs.mkdirSync(CAMS, { recursive: true });
const QB = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Quick Battle Maps/';
const CENSO = path.join(L.RAIZ, 'research', 'mapas_meet.json');
const RE = await import(`file:///${L.RAIZ.replace(/\\/g, '/')}/app/src/re.mjs`);
const SEMENTE = 20261005;

// o relatorio junta o offline com a tela (resultados.jsonl do memoria_rodar)
if (process.argv.includes('--relatorio')) { relatorio(); process.exit(0); }

const censo = JSON.parse(fs.readFileSync(CENSO, 'utf8')).mapas.sort((a, b) => a.area - b.area || a.f.localeCompare(b.f));
const casos = censo.map((m, k) => ({ id: `E${String(k + 1).padStart(2, '0')}`, fase: 1, nome: m.f.replace(/\.btt$/, ''), mapa: m }));
fs.writeFileSync(path.join(DIR, 'casos.json'), JSON.stringify({ run: RUN, semente: SEMENTE, gerado: new Date().toISOString(), casos: casos.map(({ mapa, ...c }) => ({ ...c, tier: mapa.tier, area: mapa.area, usavel: mapa.usavel })) }, null, 1));

// as formacoes russas inteiras, para encher a zona vermelha ate o alvo (como na bateria de memoria)
const lib = L.K.libFormations('RU', { variants: true, rules: L.R }).filter((x) => !x.trp);
const inteira = (f) => ({ source: f.file, nation: 'RU', keep: L.todasAsChaves(L.K.formationTree(f.file)), xp: {} });
const formas = lib.map((f) => ({ f, p: L.C.priceOfPicks([inteira(f)], 'RU', L.R)[0] })).filter((x) => !x.p.uncovered.length && x.p.onMapUnits > 0).sort((a, b) => b.p.onMapUnits - a.p.onMapUnits);
const menor = [...formas].filter((x) => x.p.onMapUnits >= 3).sort((a, b) => a.p.onMapUnits - b.p.onMapUnits)[0];
function pacote(alvo) {
  const picks = []; let soma = 0;
  for (let volta = 0; soma < alvo * 0.9 && volta < 4; volta++) for (const x of formas) { if (soma >= alvo * 0.9) break; if (soma + x.p.onMapUnits > alvo * 1.05) continue; picks.push(inteira(x.f)); soma += x.p.onMapUnits; }
  if (!picks.length) { picks.push(inteira(menor.f)); soma = menor.p.onMapUnits; }
  return { picks, soma };
}
const batalhaDoTier = { 1: 1, 2: 4, 3: 7, 4: 10, 5: 10 };

// GEOMETRIA: cada unidade colocada, no tile da zona do seu lado
function geometria(mapaOriginal, btt) {
  const z = pintura(mapaOriginal);
  const zona = { azul: new Set((z.azul || []).flatMap((l) => l.tiles).map(([x, y]) => `${x},${y}`)), vermelho: new Set((z.vermelho || []).flatMap((l) => l.tiles).map(([x, y]) => `${x},${y}`)) };
  const out = { azul: { colocadas: 0, fora: 0 }, vermelho: { colocadas: 0, fora: 0 }, exemplos: [] };
  for (const u of RE.readHeadings(btt)) {
    if (u.ausente) continue;
    for (const e of u.elementos) {
      const t = `${Math.floor(e.x / 8)},${Math.floor(e.y / 8)}`;
      out[u.lado].colocadas++;
      if (!zona[u.lado].has(t)) { out[u.lado].fora++; if (out.exemplos.length < 5) out.exemplos.push(`${u.lado} ${u.nome} em ${t}`); }
    }
  }
  return out;
}

const feitos = new Map(L.lerLinhas(path.join(DIR, 'offline.jsonl')).map((l) => [l.id, l]));
for (const c of casos) {
  if (feitos.has(c.id)) continue;
  if (SO && !SO.split(',').includes(c.id)) continue;
  const m = c.mapa; const t0 = Date.now(); let linha;
  if (!m.usavel || m.erro || m.transplante === false) {
    // o LEITOR tambem e suspeito: W x H lidos contra o nome do arquivo (multiplos de 8) e a regiao de IA
    let leitor = '';
    try { const o = lerMapa(QB + m.f); const W = Math.floor(m.W / 8), H = Math.floor(m.H / 8); if (o.W !== W || o.H !== H || !o.iaConfere) leitor = ` | leitor: le ${o.W}x${o.H} (ia ${o.iaConfere}), o nome diz ${W}x${H}`; } catch (e) { leitor = ` | leitor: ${e.message.slice(0, 50)}`; }
    linha = { id: c.id, veredito: 'MAPA-RUIM', mapa: m.f, tier: m.tier, detalhe: (m.erro || m.motivo || m.transplanteErro || 'transplante nao preserva o mapa') + leitor };
  } else {
    try {
      const alvo = Math.max(3, Math.min(TETO, Math.round((m.capFolgadaVermelho || m.capVermelho) * ALVO)));
      const p = pacote(alvo);
      const r = await L.montar({ armies: ['RU'], enemySide: 'US', seed: SEMENTE, battleNumber: batalhaDoTier[m.tier] || 1, effort: 1, picks: p.picks, slug: `A-BAT-${c.id}`, mapaEntrada: { ...m, tipo: 'Meet', arquivo: QB + m.f } });
      const cam = path.join(CAMS, `CMBSDC A-BAT-${c.id}.cam`); fs.copyFileSync(r.camOut, cam);
      const cb = L.conferirBtt(r.bttOut), cc = L.conferirCam(r.camOut, r.coreOut);
      const tipo = lerTipo(r.bttOut).nome;
      const geo = geometria(QB + m.f, r.bttOut);
      let grupos = null; try { const g = gruposUsados(r.bttOut); grupos = { azul: g.azul?.grupos.length ?? 0, vermelho: g.vermelho?.grupos.length ?? 0 }; } catch { /* sem leitura */ }
      const erros = [...(cb.erros || []), ...(cc.erros || [])];
      if (tipo !== 'Meeting Engagement') erros.push(`tipo gravado: ${tipo}`);
      if (geo.azul.fora || geo.vermelho.fora) erros.push(`fora da zona: azul ${geo.azul.fora}, vermelho ${geo.vermelho.fora}`);
      if (!geo.vermelho.colocadas || !geo.azul.colocadas) erros.push(`sem unidade colocada: azul ${geo.azul.colocadas}, vermelho ${geo.vermelho.colocadas}`);
      if (r.naoPosicionada.length) erros.push(`${r.naoPosicionada.length} nao posicionada(s)`);
      if (grupos && !grupos.azul) erros.push('a IA azul nao tem grupo no plano');
      const base = L.veredito(cb, cc).veredito;
      linha = { id: c.id, veredito: erros.length ? (erros.some((e) => /fora da zona|nao posicionada|sem unidade/.test(e)) ? 'FORA-DA-ZONA' : 'FALHA') : base, mapa: m.f, tier: m.tier, area: m.area, alvo, noMapa: r.onMap, defesa: r.defesa, registros: cb.registros, homens: cc.roster?.homens, blocos: cc.roster?.blocos, tipo, geo, grupos, naoPosicionada: r.naoPosicionada, erros: erros.slice(0, 5), avisos: (cb.avisos || []).slice(0, 3), bytesCam: fs.statSync(cam).size, s: Math.round((Date.now() - t0) / 1000) };
      fs.rmSync(r.dir, { recursive: true, force: true });
    } catch (e) { linha = { id: c.id, veredito: 'ERRO', mapa: m.f, tier: m.tier, detalhe: e.message.slice(0, 300), s: Math.round((Date.now() - t0) / 1000) }; }
  }
  L.escreverLinha(path.join(DIR, 'offline.jsonl'), linha);
  console.log(`${c.id} ${linha.veredito.padEnd(13)} t${m.tier} ${m.f.replace(/\.btt$/, '').padEnd(46)} ${linha.noMapa != null ? `${linha.noMapa} no mapa, inimigo ${linha.defesa?.units}, azul ${linha.geo?.azul.colocadas} verm ${linha.geo?.vermelho.colocadas} colocadas` : ''}${linha.detalhe ? ' — ' + linha.detalhe.slice(0, 120) : ''}${linha.erros?.length ? ' — ' + linha.erros.join(' | ').slice(0, 160) : ''}`);
}
console.log(`${casos.length} casos em ${DIR}`);

function relatorio() {
  const off = L.lerLinhas(path.join(DIR, 'offline.jsonl')); const tela = new Map(L.lerLinhas(path.join(DIR, 'resultados.jsonl')).map((l) => [l.caso, l]));
  const conta = {}; for (const l of off) conta[l.veredito] = (conta[l.veredito] || 0) + 1;
  const contaTela = {}; for (const l of tela.values()) contaTela[l.veredito] = (contaTela[l.veredito] || 0) + 1;
  const linhas = [`# Bateria dos mapas de Meeting Engagement — ${RUN}`, '', `${off.length} mapas; offline ${JSON.stringify(conta)}; tela ${tela.size ? JSON.stringify(contaTela) : 'nao rodada'}.`, '',
    '| id | mapa | tier | offline | no mapa | inimigo | colocadas azul/verm | tela (pico MB) | detalhe |', '|---|---|---|---|---|---|---|---|---|'];
  for (const l of off) { const t = tela.get(l.id); linhas.push(`| ${l.id} | ${l.mapa.replace(/\.btt$/, '')} | ${l.tier} | ${l.veredito} | ${l.noMapa ?? ''} | ${l.defesa?.units ?? ''} | ${l.geo ? `${l.geo.azul.colocadas}/${l.geo.vermelho.colocadas}` : ''} | ${t ? `${t.veredito} (${t.fases?.setup20 ?? t.fases?.setup ?? t.mem?.peakVirt ?? ''})` : ''} | ${(l.detalhe || (l.erros || []).join('; ') || '').slice(0, 90)} |`); }
  fs.writeFileSync(path.join(DIR, 'RELATORIO.md'), linhas.join('\n') + '\n');
  console.log(linhas.slice(0, 3).join('\n')); console.log(`-> ${path.join(DIR, 'RELATORIO.md')}`);
}
