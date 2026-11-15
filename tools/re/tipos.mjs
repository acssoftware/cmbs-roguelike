// TABELA tipo = f(val, tab) (secao 111.17). O cabecalho de unidade do roster traz
//     [u32 CORE ID][u16 tipo][8 B atributos][u8 lideranca][05 04 03 00][u32 n nominal][4 B]
// e o registro do `.btt` traz o par (val, tab) do catalogo. As campanhas que vem com o jogo tem,
// no mesmo `.cam`, o roster inicial e as batalhas ja core — casando o CORE ID DA CAUDA de cada
// registro (o id do registro e renumerado em cada `.btt`) com o core id do roster, sai a tabela,
// sem compilar nada no editor.
//
// A tabela so cobre os tipos que aparecem nas campanhas lidas. Para cobrir o catalogo inteiro,
// basta compilar ZZ US ALL / ZZ RU ALL / ZZ UKR ALL como campanha (Make Campaign) e rodar isto
// de novo apontando para a pasta Campaigns.
//
// uso: node tipos.mjs [saida.json]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { lerCam } from './cam.mjs';
import { descomprimir } from './lz.mjs';
import { cabecalhoDoBloco, decodificar, expandir } from './escape.mjs';
import { abrirCompleto } from './anexar2.mjs';
import { acharRoster, lerLista } from './roster_cam.mjs';
import { fimDoConteudo } from './core.mjs';
import { catalogo } from './regs.mjs';

const CAMPANHAS = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Campaigns/';
const CENARIOS = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';
const ASS = Buffer.from([0x05, 0x04, 0x03]);   // o 4o byte varia (00/01)
const hx = (n) => n.toString(16).padStart(2, '0');
const chave = (n) => '0x' + hx(n);   // o catalogo indexa tabela e item com o prefixo 0x

// O roster inicial esta no cabecalho do .cam: o `u32 tam | LZ` que expande contendo "Situation".
export function rosterDoCam(cabecalho) {
  for (let p = 0; p + 8 < cabecalho.length; p++) {
    const t = cabecalhoLe(cabecalho, p); if (t === null) continue;
    try {
      const lz = Buffer.from(descomprimir(cabecalho.subarray(p + 4, p + 4 + t), 0).saida);
      if (lz.indexOf('Situation', 0, 'latin1') < 0) continue;
      const h = cabecalhoDoBloco(lz); const d = decodificar(lz, h.esc, h.inicio, lz.length, h.atalhos);
      return { pos: p, tam: t, exp: Buffer.from(expandir(Buffer.from(d.cru), d.tokens).completo) };
    } catch {}
  }
  return null;
}
const cabecalhoLe = (b, p) => { const t = b.readUInt32LE(p); return t >= 500 && p + 4 + t <= b.length ? t : null; };

// Cabecalhos de unidade de um roster expandido.
export function unidadesDoRoster(exp) {
  const out = []; let q = exp.indexOf(ASS);
  while (q >= 0) {
    const n = exp.readUInt32LE(q + 4);
    if (n >= 1 && n <= 60 && q >= 15) out.push({ q, coreId: exp.readUInt32LE(q - 15), tipo: exp.readUInt16LE(q - 11), atributos: Buffer.from(exp.subarray(q - 9, q - 1)), lideranca: exp[q - 1], n });
    q = exp.indexOf(ASS, q + 4);
  }
  return out;
}

// CORE ID (da cauda) -> registro, de todas as batalhas de um .cam.
export function coreIdsDoCam(cam, tmpDir) {
  const porId = new Map(); let core = 0, semCauda = 0;
  for (const b of cam.batalhas) {
    const tmp = path.join(tmpDir, 'tipos_tmp.btt'); fs.writeFileSync(tmp, b.btt);
    let X; try { X = abrirCompleto(tmp); } catch { continue; }
    const c = X.completo;
    for (let k = 0; k < X.R.length; k++) {
      const r = X.R[k]; let i;
      try { i = fimDoConteudo(c, r, X.R[k + 1] ? X.R[k + 1].c : c.length); } catch { continue; }
      if (!i.core) { semCauda++; continue; }
      core++; const id = c.readUInt32LE(i.fim); if (!porId.has(id)) porId.set(id, r);
    }
  }
  return { porId, core, semCauda };
}

// De onde vem o par (val, tab) de cada core id:
//   1. do ARQUIVO CORE, quando ele existe em Scenarios com o mesmo nome da campanha (e o caso das
//      campanhas de catalogo, cujas batalhas nao tem unidade core nenhuma): core id = id do
//      registro no arquivo core, como no CAMPAIGN IMPORTED;
//   2. das BATALHAS da campanha, pela cauda core de cada registro (campanhas do jogo).
export function fonteDosPares(cam, nomeCam, { cenarios = CENARIOS, tmpDir = os.tmpdir() } = {}) {
  const core = path.join(cenarios, nomeCam.replace(/\.cam$/i, '.btt'));
  if (fs.existsSync(core)) {
    try { const X = abrirCompleto(core); return { porId: new Map(X.R.map((r) => [r.id, r])), via: 'arquivo core' }; } catch {}
  }
  const { porId } = coreIdsDoCam(cam, tmpDir);
  return { porId, via: 'caudas das batalhas' };
}

// Bloco de roster de cada (val, tab), para o app MONTAR um roster: o corpo e o mesmo dentro de um
// tipo, tirando o core id, os 8 bytes de atributos e a lideranca (que sao daquela unidade) — 223
// dos 403 tipos batem byte a byte so com isso, e o resto difere em ninharia (um pedaco de texto no
// bloco dos veiculos). Guarda-se o bloco mais comum entre os de maior efetivo nominal.
export function blocosPorTipo({ dir = CAMPANHAS, cenarios = CENARIOS } = {}) {
  const porPar = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => /\.cam$/i.test(x))) {
    const core = path.join(cenarios, f.replace(/\.cam$/i, '.btt'));
    if (!fs.existsSync(core)) continue;                    // so as campanhas de catalogo
    let cam, L, X;
    try { cam = lerCam(path.join(dir, f)); L = lerLista(acharRoster(cam.cabecalho).exp); X = abrirCompleto(core); } catch { continue; }
    const porId = new Map(X.R.map((r) => [r.id, r]));
    for (const b of L.blocos) {
      const r = porId.get(b.coreId); if (!r || r.form) continue;
      const key = `${r.val},${r.tab}`;
      const g = porPar.get(key) || { melhorN: -1, formas: new Map() };
      if (b.n > g.melhorN) { g.melhorN = b.n; g.formas = new Map(); }
      if (b.n === g.melhorN) { const h = b.buf.toString('hex'); g.formas.set(h, (g.formas.get(h) || 0) + 1); }
      porPar.set(key, g);
    }
  }
  const out = new Map();
  for (const [k, g] of porPar) out.set(k, { n: g.melhorN, bloco: [...g.formas].sort((a, b) => b[1] - a[1])[0][0] });
  return out;
}

export function levantarTipos({ dir = CAMPANHAS, tmpDir = os.tmpdir(), log = () => {} } = {}) {
  const cat = catalogo();
  const blocos = blocosPorTipo({ dir });
  const vistos = new Map();   // "val,tab" -> Map(tipo -> n)
  const exemplos = new Map(); // "val,tab" -> primeiro cabecalho visto
  for (const f of fs.readdirSync(dir).filter((x) => /\.cam$/i.test(x))) {
    let cam; try { cam = lerCam(path.join(dir, f)); } catch (e) { log(`${f}: ${e.message.slice(0, 70)}`); continue; }
    const R = rosterDoCam(cam.cabecalho);
    if (!R) { log(`${f}: sem roster inicial no cabecalho`); continue; }
    const uns = unidadesDoRoster(R.exp);
    const { porId, via } = fonteDosPares(cam, f, { tmpDir });
    // PORTAO: so entra a campanha cujo roster case quase inteiro com a fonte. Sem isso, uma
    // campanha cujo arquivo core nao esta a mao (ou foi trocado) casa por coincidencia de id e
    // envenena a tabela — foi o que aconteceu quando um compile sobrescreveu a ZZ DINAMICA.cam.
    const achados = uns.filter((u) => porId.has(u.coreId));
    const taxa = uns.length ? achados.length / uns.length : 0;
    if (taxa < 0.9) { log(`${f}: roster ${uns.length} unidades; so ${achados.length} casaram (${(100 * taxa).toFixed(0)}%) via ${via} — IGNORADA`); continue; }
    let casados = 0;
    for (const u of achados) {
      const r = porId.get(u.coreId); if (r.form) continue; casados++;
      const key = `${r.val},${r.tab}`;
      const m = vistos.get(key) || new Map(); m.set(u.tipo, (m.get(u.tipo) || 0) + 1); vistos.set(key, m);
      if (!exemplos.has(key)) exemplos.set(key, u);
    }
    log(`${f}: roster ${uns.length} unidades; ${porId.size} core ids (${via}); ${casados} unidades casadas`);
  }
  const linhas = [...vistos].map(([k, m]) => {
    const [val, tab] = k.split(',').map(Number);
    const ord = [...m].sort((a, b) => b[1] - a[1]);
    const u = exemplos.get(k);
    return { val, tab, nome: cat.tabelas[chave(tab)]?.[chave(val)] || null, tipo: ord[0][0], vezes: ord.reduce((a, b) => a + b[1], 0),
      ambiguo: ord.length > 1 ? ord.map(([t, n]) => ({ tipo: t, n })) : undefined,
      atributos: u.atributos.toString('hex'), lideranca: u.lideranca, n: u.n,
      bloco: blocos.get(k)?.bloco, blocoN: blocos.get(k)?.n };
  }).sort((a, b) => a.tab - b.tab || a.val - b.val);
  return linhas;
}

const EH_MAIN = process.argv[1] && /[\\/]tipos\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const saida = process.argv[2] || path.resolve(import.meta.dirname, '../../research/tipos_roster.json');
  const linhas = levantarTipos({ log: (s) => console.log(s) });
  const ambiguos = linhas.filter((L) => L.ambiguo);
  console.log(`\n${linhas.length} pares (val,tab); ${ambiguos.length} ambiguos; ${linhas.filter((L) => L.nome).length} com nome no catalogo`);
  for (const L of ambiguos) console.log(`   (0x${hx(L.val)},0x${hx(L.tab)}) ${L.nome || '?'} -> ${L.ambiguo.map((a) => `${a.tipo} x${a.n}`).join(' | ')}`);
  fs.writeFileSync(saida, JSON.stringify(linhas, null, 1));
  console.log(`gravado ${saida}`);
}
