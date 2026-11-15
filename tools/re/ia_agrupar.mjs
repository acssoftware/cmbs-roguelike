// PAPEL -> GRUPO -> POSICAO (05/10/2026, plano "IA autoral para o defensor"). Depois que o gerador monta a batalha,
// cada unidade AZUL presente ganha o grupo de IA do seu papel na doutrina (`ia_doutrina.GRUPOS`) e uma posicao
// dentro da zona de Setup desse grupo. Nao depende de a IA reposicionar as unidades na zona de Setup (nunca medido):
// a posicao ja sai certa.
//
// Papeis finos pelo NOME da unidade (o `roleOf` do app junta coisas que a doutrina separa: PKM com Kord, RPG com
// lanca-granadas, observador com suprimento). Cortes:
//   blindados (tank/ifv/apc) do mais barato ao mais caro: 20 % frente (G5) | 20/20/20 faixas A/B/C (G6/G7/G8) |
//   20 % reserva do majoritario (G9) — desde 08/11 os tanques primeiro, em rodizio por todos esses grupos; infantaria (squads): 10 % emboscada (G13) | 30 % minoritarios (G14) | 50 %
//   majoritario (G15) | 10 % Forward Deployed (G2). G2 = FORWARD DEPLOYED (autor, 11/10): LMG, equipes de RPO, scouts e
//   recon a pe, e os 10 % de esquadras. Veiculo de recon (BRDM, BRM-1K) e blindado. ATGM, SPG-9 e MT-12 -> G3 (28/10).
//   Engenheiro, RPG -> majoritario;
//   HQ, caminhao e o que nao se encaixa -> G1;
//   fora do mapa (artilharia, aviacao) -> G1, sem posicao.
import fs from 'node:fs';
import path from 'node:path';
import { abrirCompleto } from './anexar2.mjs';
import { arvore } from './extras.mjs';
import { ler } from './transplante.mjs';
import { registros } from './regs.mjs';
import { codificar } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';
import { posicionarIds } from './acrescentar.mjs';
import { GRUPO_OFF } from './agrupar.mjs';
import { posicaoDoElemento } from './core.mjs';

const RAIZ = path.resolve(import.meta.dirname, '../..');

// o papel na doutrina, pelo nome (a primeira regra que casa vence); `roleOf` do app decide o resto
// `avulsa`: o registro e uma equipe avulsa do editor (Specialist Team, bit 0x02 de +11)
export function papelFino(nome, roleApp, avulsa = false) {
  const n = nome || '';
  if (/Forward Observer|\bFO\b|FIST|Fire Support|JTAC|TACP|Air Controller|Observer/i.test(n)) return 'obs';
  if (/Sniper/i.test(n)) return 'sniper';
  if (/Stinger|Igla|Verba|MANPADS|Avenger|Tunguska|Strela|Shilka|Gepard|Pantsir|Antiaircraft|Air Defense/i.test(n) || roleApp === 'aa' || roleApp === 'manpads') return 'aa';
  if (/Mortar/i.test(n) || roleApp === 'mortar') return 'morteiro';
  if (roleApp === 'tank' || roleApp === 'ifv' || roleApp === 'apc') return 'blindado';
  if (roleApp === 'recon' && /Vehicle|BRDM|BRM-/i.test(n)) return 'blindado';
  // FORWARD DEPLOYED (G2, autor 11/10): RPO e scouts/recon a pe vao junto das metralhadoras leves
  if (/\bRPO\b/.test(n)) return 'avancado';
  if (/Javelin|TOW|Kornet|Konkurs|Metis|Stugna|Corsar|SKIF|ATGM/i.test(n) || roleApp === 'atgm') return 'atgm';
  // SPG-9 E MT-12 COM OS ATGM (autor, 28/10/2026): tiro direto de longe, no terreno alto com cobertura do G3. Antes o
  // SPG-9 ("Squad/Team (Recoilless)", papel infantry) era repartido como esquadra, a equipe do MT-12 ("Team (Antitank
  // Gun)", at_inf) ia para a guarnicao do objetivo (G15) e a bateria "N x 100mm Gun (MT-12 Rapira)" no mapa, para o G1.
  if (/Recoilless|SPG-9|Antitank Gun|MT-12|Rapira/i.test(n)) return 'atgm';
  if (/\bM2\b|\.50|HMG|Kord|NSV|Heavy Machine|Mk ?19|AGS|Grenade Launcher/i.test(n)) return 'hmg';
  // AS EQUIPES DE METRALHADORA AVULSAS (autor, 28/10/2026): a LMG Team (PKP) e a Machinegun Team (PKM) compradas soltas no
  // editor ficam fixas atras, com as HMG (G4). A PKP so existe avulsa; a PKM do pelotao de fuzileiros segue no G2.
  if (/LMG Team \(PKP\)/i.test(n) || (avulsa && /Machinegun Team|LMG Team|\bPKP\b|\bPKM\b/i.test(n))) return 'hmg';
  if (/M240|M249|PKM|PKP|Machine ?gun|Machinegun|MG Team|SAW|LMG/i.test(n) || roleApp === 'mg') return 'avancado';
  if (roleApp === 'recon') return 'avancado';
  if (roleApp === 'hq' || roleApp === 'truck' || roleApp === 'support' || roleApp === 'trp') return 'hq';
  // squads de engenharia sao infantaria de assalto (entram nos 10/30/60); equipes de RPG/engenharia avulsas, no majoritario
  if (roleApp === 'engineer' && /Squad/i.test(n)) return 'squad';
  if (roleApp === 'engineer' || roleApp === 'at_inf') return 'infApoio';
  if (roleApp === 'infantry') return 'squad';
  return 'hq';
}

// divide n em partes pelas fracoes (maior resto; empate para a primeira parte)
export function repartir(n, fracoes) {
  const base = fracoes.map((f) => Math.floor(f * n)); let falta = n - base.reduce((s, x) => s + x, 0);
  const restos = fracoes.map((f, k) => ({ k, r: f * n - base[k] })).sort((a, b) => b.r - a.r || a.k - b.k);
  for (let q = 0; falta > 0; q++, falta--) base[restos[q % restos.length].k]++;
  return base;
}

// As unidades azuis presentes, com id, nome, offset do registro e se estao fora do mapa
export function unidadesAzuis(btt) {
  const X = abrirCompleto(btt); const A = arvore(X); const c = X.completo; const out = [];
  // FORA DO MAPA = a marca +12 (0x50/0x58) OU nenhum elemento no mapa (11/10, City-Water 081r): a bateria organica de um
  // batalhao US ("2 x 60mm Mortar (M224A1)" da Company (Rifle)) e um registro sem-posicao sem a marca, e caia no G16 como
  // morteiro no mapa. O posicionador ja a pulava; agora ela vai ao G1 com o resto do fora do mapa.
  const fimDe = new Map(X.R.map((r, k) => [r.c, X.R[k + 1] ? X.R[k + 1].c : c.length]));
  const semElemento = (r) => !r.form && posicaoDoElemento(c, r, fimDe.get(r.c) ?? c.length) === null;
  // `pai` (12/10, o encontro): o id do registro da formacao de que a unidade e filha direta — o pelotao-folha, que o
  // jogo usa para embarcar as equipes nos veiculos (dois "Platoon (Rifle)" da mesma companhia tem trilhas iguais)
  const anda = (no, trilha, pai = null) => { if (no.r.form) { for (const f of no.filhos) anda(f, [...trilha, no.r.nm], no.r.id); return; } out.push({ id: no.r.id, pai, nome: no.r.nm, formacao: trilha.join(' / '), ausente: !!no.r.ausente, avulsa: (c[no.r.c + 11] & 0x02) !== 0, foraDoMapa: c[no.r.c + 12] === 0x50 || c[no.r.c + 12] === 0x58 || (!no.r.ausente && semElemento(no.r)) }); };
  for (const t of A.azul) anda(t, []);
  return out;
}

// O plano de grupos: {id -> grupo} e o resumo por grupo. `preco(nome, papelApp)` ordena os blindados.
export function planoDeGrupos(unidades, { roleOf, preco }) {
  const vivas = unidades.filter((u) => !u.ausente);
  const grupo = new Map(); const porPapel = {};
  const blindados = [], squads = [];
  for (const u of vivas) {
    u.roleApp = roleOf(u.nome, u.foraDoMapa); u.papel = u.foraDoMapa ? 'foraDoMapa' : papelFino(u.nome, u.roleApp, u.avulsa);
    (porPapel[u.papel] ||= []).push(u);
    if (u.papel === 'blindado') blindados.push(u); else if (u.papel === 'squad') squads.push(u);
  }
  const fixo = { hq: 1, foraDoMapa: 1, avancado: 2, atgm: 3, hmg: 4, aa: 10, obs: 11, sniper: 12, infApoio: 15, morteiro: 16 };
  for (const u of vivas) if (fixo[u.papel]) grupo.set(u.id, fixo[u.papel]);
  // blindados: do mais barato ao mais caro -> frente | A | B | C | reserva, 20 % cada (faixas em rodizio)
  blindados.forEach((u) => { u.preco = preco(u.nome, u.roleApp); });
  blindados.sort((a, b) => a.preco - b.preco || a.nome.localeCompare(b.nome));
  const [nF, nA, nB, nC, nR] = repartir(blindados.length, [0.2, 0.2, 0.2, 0.2, 0.2]);
  // OS TANQUES EM TODOS OS GRUPOS (08/11, autor: "os tanques inimigos estao concentrados na borda oeste" do Khalmi 085r, US
  // b9). Pelo preco, os 20 % mais caros eram a reserva: os 4 carros de combate e o Shturm-S caiam juntos no G9, escondido no
  // fundo do mapa, e nenhum outro grupo tinha tanque. Agora os tanques (papel tank: carro e caca-tanque) vao primeiro, do mais
  // caro ao mais barato, em rodizio reserva -> B -> C -> A -> frente, dentro das cotas de cada grupo; o resto dos blindados
  // segue a regra do preco nas vagas que sobraram. Sem tanque, a divisao e a mesma de antes.
  const vagas = new Map([[5, nF], [6, nA], [7, nB], [8, nC], [9, nR]]);
  const tanques = blindados.filter((u) => u.roleApp === 'tank').sort((a, b) => b.preco - a.preco || a.nome.localeCompare(b.nome));
  const rodaTanque = [9, 7, 8, 6, 5]; let t = 0;
  for (const u of tanques) {
    let g = null;
    for (let k = 0; k < rodaTanque.length && g == null; k++, t++) { const c = rodaTanque[t % rodaTanque.length]; if (vagas.get(c) > 0) g = c; }
    grupo.set(u.id, g); vagas.set(g, vagas.get(g) - 1);
  }
  const resto = blindados.filter((u) => u.roleApp !== 'tank');
  const nF2 = vagas.get(5), nR2 = vagas.get(9);
  const faixas = resto.slice(nF2, resto.length - nR2);
  resto.slice(0, nF2).forEach((u) => grupo.set(u.id, 5));
  resto.slice(resto.length - nR2).forEach((u) => grupo.set(u.id, 9));
  // faixas: rodizio respeitando as cotas que sobraram de A/B/C
  const cotas = [[6, vagas.get(6)], [7, vagas.get(7)], [8, vagas.get(8)]]; let q = 0;
  for (const u of faixas) { while (cotas[q % 3][1] === 0) q++; grupo.set(u.id, cotas[q % 3][0]); cotas[q % 3][1]--; q++; }
  // squads: 10 % emboscada | 30 % minoritarios | 50 % majoritario | 10 % Forward Deployed (autor, 11/10: tirados do G15)
  const [s13, s14, s15] = repartir(squads.length, [0.1, 0.3, 0.5, 0.1]);
  squads.forEach((u, k) => grupo.set(u.id, k < s13 ? 13 : k < s13 + s14 ? 14 : k < s13 + s14 + s15 ? 15 : 2));
  // quem vai para casa ou mata: toda infantaria (nao veiculo, nao morteiro, nao fora do mapa)
  const infantaria = new Set(vivas.filter((u) => !u.foraDoMapa && !/\bVehicle\b|\bCarrier\b|\bTruck\b|HMMWV/i.test(u.nome) && u.papel !== 'blindado' && u.papel !== 'morteiro' && !['tank', 'ifv', 'apc', 'truck', 'aa', 'artillery', 'air', 'drone'].includes(u.roleApp)).map((u) => u.id));
  return { grupo, vivas, infantaria, porPapel: Object.fromEntries(Object.entries(porPapel).map(([k, v]) => [k, v.map((u) => u.nome)])), blindados: blindados.map((u) => ({ nome: u.nome, preco: u.preco, grupo: grupo.get(u.id) })) };
}

// Grava o grupo de cada id (byte +16 do registro, como `agrupar`)
export function agruparIds(entrada, saida, grupoDe) {
  const d = ler(entrada); const cru = Buffer.from(d.cru);
  const R = registros(cru); let n = 0;
  for (const r of R) { if (r.form || !grupoDe.has(r.id)) continue; const g = grupoDe.get(r.id); if (!(g >= 1 && g <= 16)) throw new Error(`grupo ${g} fora de 1..16`); cru[r.off + GRUPO_OFF] = g - 1; n++; }
  const b = Buffer.concat([Buffer.from([d.esc, 0x00]), codificar({ cru, tokens: d.tokens }, d.esc)]);
  reconstruir(entrada, saida, (x, k) => (k === 1 ? b : x));
  return n;
}

// Posiciona cada grupo dentro da sua zona de Setup. Zona pequena demais para o grupo: passo 1, e se ainda faltar,
// a zona cresce um anel por vez (so dentro da pintura azul) ate caber.
// Posiciona cada grupo dentro da sua zona de Setup (ampla). A INFANTARIA (`infantaria`: ids) vai so para casa ou mata
// dentro da zona (autor, 05/10: "este posicionamento se aplica a todo tipo de infantaria"); se a zona tiver menos
// abrigo que homens, o abrigo vizinho da pintura azul entra anel por anel (ate 8) e, so entao, o aberto da zona.
// Veiculos e morteiros: o terreno livre da zona, fora de predio.
export function posicionarPorGrupo(btt, grupoDe, zonaDoGrupo, F, infantaria = new Set()) {
  const tmp = btt + '.pos.btt'; const feito = {};
  const ocupados = [];   // 24/10: os tiles ja tomados por qualquer grupo; o seguinte se espalha longe deles (acrescentar.espalhar)
  let area = [];        // a zona inteira do grupo: a geometria do espalhar (o abrigo e so onde a unidade encaixa)
  const porGrupo = new Map(); for (const [id, g] of grupoDe) { if (!porGrupo.has(g)) porGrupo.set(g, new Set()); porGrupo.get(g).add(id); }
  // 07/11: so o que esta LIVRE conta (o abrigo tomado por outro grupo nao recebe ninguem; contado, a zona nao crescia e
  // a ultima unidade empilhava — G15 do Village-Hills 300)
  const conta = (z, p) => { const tomados = new Set(ocupados.map((t) => t.join())); return new Set(z.filter(([x, y]) => x % p === 0 && y % p === 0).map((t) => t.join()).filter((k) => !tomados.has(k))).size; };
  const ok = (x, y) => F.dentro(x, y) && F.azul[F.idx(x, y)];
  const coloca = (ids, candidatos, cresceFiltro, reserva) => {
    let zona = candidatos, passo = 2, aneis = 0; const n = ids.size;
    while (conta(zona, passo) < n) {
      if (passo === 2) { passo = 1; continue; }
      if (aneis < 8 && cresceFiltro) {
        const set = new Set(zona.map((t) => t.join())); const novo = [...zona];
        for (const [x, y] of zona) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const k = `${x + dx},${y + dy}`; if (!set.has(k) && ok(x + dx, y + dy) && cresceFiltro(F.idx(x + dx, y + dy))) { set.add(k); novo.push([x + dx, y + dy]); } }
        aneis++; if (novo.length > zona.length) { zona = novo; continue; }
      }
      const set = new Set(zona.map((t) => t.join())); zona = [...zona, ...reserva.filter((t) => !set.has(t.join()))]; break;
    }
    if (!zona.length) return null;
    const r = posicionarIds(btt, tmp, ids, zona, conta(zona, passo) >= n ? passo : 1, { espalhar: true, ocupados, area }); fs.copyFileSync(tmp, btt);
    ocupados.push(...r.usados);
    return `${r.ativos} em ${r.tiles} tiles${aneis ? ` (+${aneis} anel)` : ''}`;
  };
  for (const [g, ids] of [...porGrupo].sort((a, b) => a[0] - b[0])) {
    const zona = zonaDoGrupo[g] || []; area = zona; if (!zona.length) { feito[g] = 'sem zona: fica onde o gerador pos'; continue; }
    const inf = new Set([...ids].filter((id) => infantaria.has(id))), veic = new Set([...ids].filter((id) => !infantaria.has(id)));
    const partes = [];
    if (inf.size) partes.push('infantaria ' + coloca(inf, zona.filter(([x, y]) => F.abrigo[F.idx(x, y)]), (i) => F.abrigo[i], zona));
    // VEICULO NUNCA DENTRO DE MATA (autor, 12/10: "ficam presos e so poderao ser encontrados por infantaria navegando
    // dentro da floresta; e melhor posicionar na borda"). O livre da zona e fora de predio, de mata e de agua; zona que
    // e so mata (a borda de mata dos ATGM/HMG, por exemplo) leva o veiculo ao aberto colado nela, a ate 3 tiles, dentro
    // da pintura azul. So sem nenhum aberto por perto ele cai na zona como ela e.
    if (veic.size) {
      const solto = (x, y) => F.dentro(x, y) && !F.predio[F.idx(x, y)] && !F.floresta[F.idx(x, y)] && !F.agua[F.idx(x, y)];
      let livre = zona.filter(([x, y]) => solto(x, y));
      if (livre.length < veic.size * 4) {
        const set = new Set(livre.map((t) => t.join()));
        for (const [x, y] of zona) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const nx = x + dx, ny = y + dy, k = nx + ',' + ny; if (!set.has(k) && solto(nx, ny) && F.azul[F.idx(nx, ny)]) { set.add(k); livre.push([nx, ny]); } }
      }
      partes.push('veiculos/morteiros ' + coloca(veic, livre, null, livre.length ? livre : zona));
    }
    feito[g] = partes.join('; ');
  }
  fs.rmSync(tmp, { force: true });
  return feito;
}

export const precoPadrao = (R) => {
  const precos = JSON.parse(fs.readFileSync(path.join(RAIZ, 'research', 'precos_unidades.json'), 'utf8')).precos || {};
  return (nome, roleApp) => { const k = Object.keys(precos).find((x) => x.endsWith('|' + nome)); return k ? precos[k] : (R?.units?.price?.[roleApp] ?? 0); };
};
