// O EXECUTOR DE TELA DA BATERIA DE MEMORIA (familia M, 05/10/2026). Um PROCESSO NOVO por caso: instala o .cam
// pronto em Campaigns, lanca o jogo, carrega ate o setup medindo o pico de memoria virtual por fase (passo `medir`
// do bateria_fn.ps1), mata o jogo e tira o .cam. A escada (fase 2) sobe ate a primeira falha e para; a fase 3
// roda inteira. Uma linha por caso em research/bateria/<run>/resultados.jsonl; retoma de onde parou.
//   node tools/re/bateria/memoria_rodar.mjs --run m1 [--fases 1,2,3] [--so M01,ML700] [--plano]
// Regras da casa: so com a tela liberada; so mata o que esta sessao lancou; so apaga o .cam que ela instalou.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as L from './lib.mjs';

const arg = (k, padrao) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : padrao; };
const RUN = arg('--run', 'm1'); const FASES = arg('--fases', '1,2,3').split(',').map(Number); const SO = arg('--so', null);
const DIR = path.join(L.DIR_BATERIA, RUN), CAMS = path.join(DIR, 'cams'), RES = path.join(DIR, 'resultados.jsonl');
const CAMPAIGNS = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Campaigns';
const PS1 = path.join(L.RAIZ, 'tools', 're', 'jogo', 'bateria_fn.ps1');
const { casos } = JSON.parse(fs.readFileSync(path.join(DIR, 'casos.json'), 'utf8'));
const offline = new Map(L.lerLinhas(path.join(DIR, 'offline.jsonl')).map((l) => [l.id, l]));
const feitos = new Map(L.lerLinhas(RES).map((l) => [l.caso, l]));

function ps(passo, extra = {}, timeoutMs = 900000) {
  const a = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS1, '-Passo', passo];
  for (const [k, v] of Object.entries(extra)) a.push(`-${k}`, String(v));
  const r = spawnSync('powershell.exe', a, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  const linha = (r.stdout || '').split(/\r?\n/).reverse().find((l) => l.startsWith('@@'));
  if (!linha) return { veredito: 'ERRO', detalhe: `sem resposta do PowerShell: ${(r.stderr || r.stdout || '').slice(-400)}` };
  return JSON.parse(linha.slice(2));
}
const linhaDe = (nome) => fs.readdirSync(CAMPAIGNS).filter((f) => f.toLowerCase().endsWith('.cam')).map((f) => f.slice(0, -4).toUpperCase()).sort().indexOf(nome.toUpperCase());

let fila = casos.filter((c) => FASES.includes(c.fase) && (!SO || SO.split(',').includes(c.id)));
console.log(`${fila.length} casos: ${fila.map((c) => c.id).join(' ')}`);
if (process.argv.includes('--plano')) process.exit(0);

let escadaQuebrou = [...feitos.values()].some((l) => l.fase === 2 && l.veredito !== 'OK');
for (const c of fila) {
  if (feitos.has(c.id)) continue;
  if (c.fase === 2 && escadaQuebrou) { console.log(`${c.id}: pulado (a escada ja quebrou abaixo)`); continue; }
  if (!['OK', 'SUSPEITO'].includes(offline.get(c.id)?.veredito)) { console.log(`${c.id}: offline ${offline.get(c.id)?.veredito} — pulado`); continue; }
  const nome = `CMBSDC A-BAT-${c.id}`; const destino = path.join(CAMPAIGNS, `${nome}.cam`);
  fs.copyFileSync(path.join(CAMS, `${nome}.cam`), destino);
  const linha = linhaDe(nome);
  let r;
  try {
    if (linha < 0 || linha > 19) r = { veredito: 'ERRO', detalhe: `linha ${linha} fora da primeira pagina` };
    else {
      const l = ps('lancar', { Tag: `${c.id}-lancar` });
      r = l.veredito === 'OK' ? ps('medir', { Linha: linha, Tag: c.id, Seg: 420 }) : l;
    }
  } finally {
    ps('matar'); fs.rmSync(destino, { force: true });
  }
  const o = offline.get(c.id);
  const reg = { run: RUN, t: new Date().toISOString(), caso: c.id, fase: c.fase, nome: c.nome, noMapa: o.noMapa, inimigo: o.defesa?.units, registros: o.registros, homens: o.homens, mapa: o.mapa, veredito: r.veredito, detalhe: r.detalhe, fases: r.fases, mem: r.mem, tempos: r.tempos, dialogo: r.dialogo };
  L.escreverLinha(RES, reg);
  console.log(`${c.id} ${r.veredito} no mapa ${o.noMapa} homens ${o.homens} registros ${o.registros} | pico virtual menu ${r.fases?.menu ?? '-'} briefing ${r.fases?.briefing ?? '-'} setup ${r.fases?.setup ?? '-'} +20s ${r.fases?.setup20 ?? r.mem?.peakVirt ?? '-'} MB${r.detalhe ? ' — ' + String(r.detalhe).slice(0, 140) : ''}`);
  if (c.fase === 2 && r.veredito !== 'OK') escadaQuebrou = true;
}
console.log('fim');
