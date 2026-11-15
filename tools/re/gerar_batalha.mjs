// GERAR uma batalha a partir de uma especificacao — o gerador do modo roguelike.
//
//   node gerar_batalha.mjs spec.json saida.btt
//
// spec = {
//   mapa: 'ZZ QBLARGE BLANK.btt',            // em Scenarios ou Quick Battle Maps, ou caminho
//   duracao: 90, tipo: 'Blue Attack',
//   azul: [ { formacao: 'US - Battalion (Combined Arms)',      // nome em Game Files/LIB, ou caminho
//             atributos: { experiencia: 'Veteran', motivacao: 'High' },
//             anexos: [ 'US - Breach Team', { arquivo: 'ZZ ADD US.btt', n: 2 } ] }, ... ],
//   vermelho: [ ... ],
//   extras: [ { tipo: 'Breach Team', lado: 'vermelho',        // unidade do CATALOGO, sem doador
//               em: ['Company (Rifle)', 'Platoon (Rifle)#1'],  // caminho de formacoes ('#n' = ocorrencia)
//               grupo: 3, custo: 51, par: [0x62, 0x0e] } ] }   // o par so quando o nome e ambiguo
//
// Ordem de montagem (cada passo aprovado em jogo em separado): o primeiro azul e a base; os
// azuis seguintes entram como irmas; os vermelhos abrem o outro lado; depois os anexos, os
// atributos, o transplante para o mapa e os dois bytes de duracao e tipo. Bloco azul primeiro
// e obrigatorio (secao 52.1: vermelho-primeiro nao esta resolvido).
import fs from 'fs';
import path from 'path';
import { ler, marcador } from './transplante.mjs';
import { pintura, interior } from './zonas.mjs';
import { posicionarIds } from './acrescentar.mjs';
import { registros, indiceDeTokens, subArvore } from './regs.mjs';
import { codificar, codificarComoJogo } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';
import { adicionar } from './compor.mjs';
import { compor as compor2 } from './compor2.mjs';
import { anexar, abrirCompleto } from './anexar2.mjs';
import { podar } from './podar.mjs';
import { agrupar, distribuirPorLado } from './agrupar.mjs';
import { gruposUsados } from './ia.mjs';
import { aplicar as aplicarAtributos } from './atributos.mjs';
import { escrever as escreverTipo } from './tipo_batalha.mjs';
import { abrir, lerListaStrings } from './ext.mjs';
import { arvore, resolverDestino, sintetizarPorNome, inserirRegistro, verificarForca, posicaoNaZona } from './extras.mjs';
import { cabecalho } from './lados.mjs';
import { ler as lerBriefing } from './briefing.mjs';

// A pasta do jogo pode vir do ambiente (o app grava CMBS_GAME_FILES antes de importar este
// modulo, secao `app/src/re.mjs`); sem a variavel vale a instalacao Steam desta maquina, para os
// scripts de pesquisa continuarem rodando sem configurar nada. Lido UMA VEZ, na carga.
const G = (process.env.CMBS_GAME_FILES || 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files').replace(/[\\/]*$/, '') + '/';
const LIB = G + '../LIB/', S = G + 'Scenarios/', QB = G + 'Quick Battle Maps/';

function resolver(nome, pastas) {
  if (/[\/]/.test(nome)) return nome;
  for (const p of pastas) {
    if (fs.existsSync(p + nome)) return p + nome;
    if (fs.existsSync(p + nome + '.btt')) return p + nome + '.btt';
  }
  // busca frouxa na biblioteca: substring sem diferenciar maiusculas, resultado unico
  const cand = fs.existsSync(LIB) ? fs.readdirSync(LIB).filter((f) => f.toLowerCase().includes(nome.toLowerCase())) : [];
  if (cand.length === 1) return LIB + cand[0];
  throw new Error(`'${nome}': ${cand.length ? 'ambiguo (' + cand.join(', ') + ')' : 'nao encontrado'}`);
}

const tmp = (k) => S + `tmp_gerar_${process.pid}_${k}.btt`;

// Os dois bytes depois do marcador sao o inicio do u32 `desc` do CABECALHO DA FORCA (secao
// 111.25): tem de vir da FONTE. Trazer os do mapa (tentativa da E15) fez o jogo carregar ate 70%
// e morrer com Runtime Error, em vez de travar cedo. O que o valor do mapa denuncia e outra
// coisa, no proprio mapa — ver a secao 111.26.
export function transplantar(mapa, fonte, saida) {
  const A = ler(mapa), B = ler(fonte);
  const mA = marcador(A).pos, mB = marcador(B).pos;
  const cru = Buffer.concat([A.cru.subarray(0, mA), B.cru.subarray(mB)]);
  const d = mA - mB;
  const tokens = [...A.tokens.filter((t) => t.pos < mA), ...B.tokens.filter((t) => t.pos >= mB).map((t) => ({ pos: t.pos + d, cod: t.cod }))];
  reconstruir(mapa, saida, (b, k) => (k === 1 ? Buffer.concat([Buffer.from([A.esc, 0x00]), codificar({ cru, tokens }, A.esc)]) : b));
}

// CENARIO x MAPA DE QUICK BATTLE (secao 111.23): o byte `base+29` (base = lerListaStrings().fim,
// o mesmo bloco da duracao e do par de nacoes) tem o BIT 0 LIGADO em todo cenario e DESLIGADO nos
// Quick Battle Maps de fabrica. Comparando o `City on Hill (1504 X 608) 125 Assault` com a
// `ZZ DINAMICA 02` que autor salvou dele no editor, esse bit e o par de nacoes sao a UNICA
// diferenca no bloco. O gerador liga o bit porque todo cenario tem — mas os travamentos que a
// secao 111.23 atribuiu a ele (ZZ APP B1, 02B) eram o decodificador de escape (secao 111.30).
// PLANO NO SLOT 1 (secao 111.24): a regra "primeiro plano de IA com uso fora do slot 1 trava"
// tambem caiu com a 111.30 — o `Village (544 X 800) 059r` (planos 5 e 4) carregou depois da
// correcao. `planoServe` fica so como informacao do censo (planoAzul/planoVermelho/planoUm).
// MAPA QUE SERVE: todo mapa de QB cru serve (secao 111.30). Os travamentos em "Read Data" eram
// o decodificador de escape expandindo `atalho v` como `00 00 v` em vez de `v v v`; a regra do
// `desc = 4` (111.26) e a do plano no slot 1 (111.24) eram sintomas — os quatro mapas "ruins"
// (059r, 065, 007r, 081r) e o City 126 carregaram depois da correcao. `desc` e `N` ficam so
// como informacao.
export function mapaServe(arquivo) {
  try { const h = cabecalho(abrirCompleto(arquivo)); return { serve: true, desc: h.desc, N: h.N }; }
  catch (e) { return { serve: null, erro: e.message.slice(0, 60) }; }
}

export function planoServe(arquivo) {
  let g = null; try { g = gruposUsados(arquivo); } catch { return { serve: null, motivo: 'planos ilegiveis' }; }
  const a = g.azul?.plano ?? null, v = g.vermelho?.plano ?? null;
  return { serve: a === 1 && v === 1, azul: a, vermelho: v };
}

export function lerBitDeCenario(arquivo) {
  const r = abrir(arquivo); const L = lerListaStrings(r.b, r.bmpFim);
  return { base: L.fim, byte: r.b[L.fim + 29], cenario: !!(r.b[L.fim + 29] & 1) };
}
// O BIT NAO E CAMPO DO CABECALHO (10/10, E175). base+19 e o tamanho do bloco 0 e o fluxo LZ comeca em base+23,
// entao base+29 e o 7o byte do bloco 0 COMPRIMIDO. Na maioria dos mapas ele cai no bit 0x10 da versao do bloco 0
// (139 -> 155: e assim que o editor marca um cenario, e foi isso que se provou em jogo). Em 18 mapas de QB ele cai
// em outro lugar: soma 4096 ao tamanho do primeiro texto do briefing ou corrompe a versao (Hills-Water 037r: 139 ->
// 4235; Huge Rough-Water-Town 026r: texto). Por isso a marca so fica quando o efeito e exatamente a versao + 16 com
// os textos intactos; senao o arquivo volta como estava.
export function marcarComoCenario(arquivo) {
  const b = Buffer.from(fs.readFileSync(arquivo));
  const r = abrir(arquivo); const L = lerListaStrings(r.b, r.bmpFim);
  const antes = b[L.fim + 29]; b[L.fim + 29] = antes | 1;
  if (antes === b[L.fim + 29]) return { antes, depois: antes };
  const original = fs.readFileSync(arquivo);
  let v0 = null; try { v0 = lerBriefing(arquivo); } catch { /* briefing ilegivel: nao mexe */ }
  fs.writeFileSync(arquivo, b);
  let v1 = null; try { v1 = lerBriefing(arquivo); } catch { /* */ }
  if (!v0 || !v1 || v1.versao !== v0.versao + 16 || JSON.stringify([v0.azul, v0.vermelho]) !== JSON.stringify([v1.azul, v1.vermelho])) {
    fs.writeFileSync(arquivo, original);
    return { antes, depois: antes, recusado: 'base+29 nao e o bit de versao neste arquivo' };
  }
  return { antes, depois: b[L.fim + 29] };
}

// A DURACAO MORA EM DOIS LUGARES (secao 50, E24/E25 — 07/09). O byte `base+7` do cabecalho e o
// que a TELA DE CARGA anuncia; o relogio que corre sai de uma SEGUNDA copia, dentro do bloco
// escapado, e e ela que o editor le e escreve tambem. Escrever so o cabecalho dava o que o autor
// viu: a tela dizia uma coisa e a partida rodava a duracao do MAPA de origem, que o transplante
// trouxe intacta.
//
// A copia de dentro comeca com os mesmos 7 bytes do bloco de 19 campos do cabecalho
// (`05 E1 07 00 16 1C 02` = versao, ano 2017, ...), com a duracao logo em seguida — a mesma
// ancoragem do cabecalho, so que dentro do fluxo. Aparece UMA vez em cada arquivo medido: nos 86
// mapas do pool, nas batalhas geradas e nos gabaritos do editor.
export function escreverDuracao(arquivo, minutos) {
  const r = abrir(arquivo);
  const L = lerListaStrings(r.b, r.bmpFim);
  const prefixo = Buffer.from(r.b.subarray(L.fim, L.fim + 7));

  // 1) o cabecalho, patch direto: `reconstruir` preserva essa regiao.
  const b = Buffer.from(r.b);
  b[L.fim + 7] = minutos;
  fs.writeFileSync(arquivo, b);

  // 2) a copia de dentro do bloco, pelo caminho de escrita que o jogo aceita (o mesmo do desmontar).
  const X = abrirCompleto(arquivo);
  const onde = [];
  for (let p = X.completo.indexOf(prefixo); p >= 0; p = X.completo.indexOf(prefixo, p + 1)) onde.push(p);
  if (onde.length !== 1) throw new Error(`achei ${onde.length} copias da duracao dentro do bloco de ${path.basename(arquivo)} e esperava exatamente uma`);
  const novo = Buffer.from(X.completo);
  novo[onde[0] + 7] = minutos;
  const tmp = arquivo + '.dur.tmp';
  reconstruir(arquivo, tmp, (bl, k) => (k === 1 ? codificarComoJogo(novo, X.d.esc) : bl));
  fs.renameSync(tmp, arquivo);

  // Conferencia no arquivo GRAVADO: os dois lugares tem de dizer a mesma coisa.
  const v = abrir(arquivo);
  const LV = lerListaStrings(v.b, v.bmpFim);
  const Y = abrirCompleto(arquivo);
  const q = Y.completo.indexOf(Buffer.from(v.b.subarray(LV.fim, LV.fim + 7)));
  if (v.b[LV.fim + 7] !== minutos || q < 0 || Y.completo[q + 7] !== minutos) {
    throw new Error(`a duracao nao ficou nos dois lugares: cabecalho ${v.b[LV.fim + 7]}, bloco ${q < 0 ? 'nao achado' : Y.completo[q + 7]}`);
  }
  return { minutos, cabecalho: LV.fim + 7, bloco: onde[0] + 7 };
}

// Le a duracao dos dois lugares. Se discordarem, quem manda no relogio e a de DENTRO.
// `extra` e o Variable Extra Time, em minutos (0 = None, 5, 10, 15): mora SO na copia de dentro, dois
// bytes depois da duracao (28/09, gabarito do autor em Game Files/TESTING: `ZZ 30 MIN` x `0 5 MIN` x
// `0 15 MIN` mudam um byte so, ali). O cabecalho nao tem copia dele (E24).
export function lerDuracao(arquivo) {
  const r = abrir(arquivo);
  const L = lerListaStrings(r.b, r.bmpFim);
  const X = abrirCompleto(arquivo);
  const p = X.completo.indexOf(Buffer.from(r.b.subarray(L.fim, L.fim + 7)));
  return { cabecalho: r.b[L.fim + 7], bloco: p < 0 ? null : X.completo[p + 7], extra: p < 0 ? null : X.completo[p + 9] };
}

// A HORA DA BATALHA (17/10/2026). Os 7 bytes da ancora acima sao a DATA do cenario: `+0 mes (0 = janeiro) | +1..2 ano
// u16 | +3 ? | +4 dia | +5..6 hora em MINUTOS desde 00:00 (u16)`, e a duracao vem logo depois (+7). Medido em 493
// arquivos dos devs (so jun-ago de 2017; 540 = 09:00 e o padrao do editor) e no gabarito `ZZ TESTE HORA 0530`. E a hora
// que acende ou apaga o mapa no jogo; o Daylight da aba Description (`tipo_batalha.LUZ`) e so rotulo. Mora nos dois
// lugares, como a duracao — e, como ela muda a propria ancora, a copia de dentro e achada pelo prefixo ANTIGO.
// O DIA E O MES (17/10, print do autor: o mapa de 22 de junho mostra o dia 22 e o 31 cinza) moram no mesmo cabecalho:
// +0 mes (0 = janeiro) e +4 dia. `escreverData` grava qualquer combinacao de mes, dia e hora nos dois lugares de uma vez.
const DIAS_NO_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];   // o ano e sempre 2017 (nao bissexto)
const lerData_ = (b, o) => ({ mes: b[o], ano: b.readUInt16LE(o + 1), dia: b[o + 4], minutos: b.readUInt16LE(o + 5) });
export function lerData(arquivo) {
  const r = abrir(arquivo);
  const L = lerListaStrings(r.b, r.bmpFim);
  const X = abrirCompleto(arquivo);
  const p = X.completo.indexOf(Buffer.from(r.b.subarray(L.fim, L.fim + 7)));
  return { cabecalho: lerData_(r.b, L.fim), bloco: p < 0 ? null : lerData_(X.completo, p) };
}
export function escreverData(arquivo, { mes, dia, minutos } = {}) {
  const r = abrir(arquivo);
  const L = lerListaStrings(r.b, r.bmpFim);
  const prefixo = Buffer.from(r.b.subarray(L.fim, L.fim + 7));
  const antes = lerData_(r.b, L.fim);
  const quer = { mes: mes ?? antes.mes, dia: dia ?? antes.dia, minutos: minutos ?? antes.minutos };
  if (!Number.isInteger(quer.mes) || quer.mes < 0 || quer.mes > 11) throw new Error(`mes ${quer.mes}: 0 (janeiro) a 11`);
  if (!Number.isInteger(quer.dia) || quer.dia < 1 || quer.dia > DIAS_NO_MES[quer.mes]) throw new Error(`dia ${quer.dia}: o mes ${quer.mes + 1} tem ${DIAS_NO_MES[quer.mes]} dias`);
  if (!Number.isInteger(quer.minutos) || quer.minutos < 0 || quer.minutos > 1439) throw new Error(`hora ${quer.minutos}: minutos desde 00:00, de 0 a 1439`);
  const X = abrirCompleto(arquivo);
  const onde = [];
  for (let p = X.completo.indexOf(prefixo); p >= 0; p = X.completo.indexOf(prefixo, p + 1)) onde.push(p);
  if (onde.length !== 1) throw new Error(`achei ${onde.length} copias da data dentro do bloco de ${path.basename(arquivo)} e esperava exatamente uma`);
  const grava = (buf, o) => { buf[o] = quer.mes; buf[o + 4] = quer.dia; buf.writeUInt16LE(quer.minutos, o + 5); };
  const novo = Buffer.from(X.completo); grava(novo, onde[0]);
  const tmp = arquivo + '.data.tmp';
  reconstruir(arquivo, tmp, (bl, k) => (k === 1 ? codificarComoJogo(novo, X.d.esc) : bl));
  // o cabecalho por ultimo, patch direto (`reconstruir` preserva essa regiao)
  const b = fs.readFileSync(tmp); grava(b, L.fim); fs.writeFileSync(tmp, b);
  fs.renameSync(tmp, arquivo);
  const d = lerData(arquivo);
  for (const k of ['mes', 'dia', 'minutos']) if (d.cabecalho[k] !== quer[k] || d.bloco?.[k] !== quer[k]) throw new Error(`a data nao ficou nos dois lugares: ${JSON.stringify(d)}`);
  return { ...quer, antes };
}
// O CLIMA (17/10/2026, gabaritos cumulativos do autor em TESTING: ZZ WIND STRENGTH / WIND SOURCE / TEMPERATURE / GROUND /
// WEATHER, cada um mudando um campo do anterior). A partir da ancora da data, na copia de DENTRO: +11 Weather, +12 Wind
// Strength, +13 Wind Source, +14 Temperature, +15 Ground Condition; o cabecalho copia so tres deles, em +9 Weather,
// +10 Temperature e +11 Ground. Confirmados: Weather 0 Clear / 7 Mist; Wind 1 Gentle / 4 Heavy; Source 4 W / 2 N;
// Temperature 2 Warm / 5 Freezing; Ground 0 Very Dry / 2 Damp. Neve no chao (5-8) existe mas nao e para usar (autor).
const CLIMA = { weather: [11, 9], windStrength: [12, null], windSource: [13, null], temperature: [14, 10], ground: [15, 11] };
const lerClima_ = (b, o, cab) => Object.fromEntries(Object.entries(CLIMA).map(([k, [dentro, fora]]) => [k, cab ? (fora === null ? undefined : b[o + fora]) : b[o + dentro]]).filter(([, v]) => v !== undefined));
export function lerClima(arquivo) {
  const r = abrir(arquivo);
  const L = lerListaStrings(r.b, r.bmpFim);
  const X = abrirCompleto(arquivo);
  const p = X.completo.indexOf(Buffer.from(r.b.subarray(L.fim, L.fim + 7)));
  return { cabecalho: lerClima_(r.b, L.fim, true), bloco: p < 0 ? null : lerClima_(X.completo, p, false) };
}
export function escreverClima(arquivo, valores = {}) {
  for (const [k, v] of Object.entries(valores)) {
    if (v === undefined || v === null) continue;
    if (!(k in CLIMA)) throw new Error(`campo de clima desconhecido: ${k} (use ${Object.keys(CLIMA).join(', ')})`);
    if (!Number.isInteger(v) || v < 0 || v > 15) throw new Error(`${k} ${v}: fora da lista`);
  }
  if ((valores.ground ?? 0) >= 5) throw new Error(`ground ${valores.ground}: neve no chao nao e para usar`);
  const r = abrir(arquivo);
  const L = lerListaStrings(r.b, r.bmpFim);
  const prefixo = Buffer.from(r.b.subarray(L.fim, L.fim + 7));
  const X = abrirCompleto(arquivo);
  const onde = [];
  for (let p = X.completo.indexOf(prefixo); p >= 0; p = X.completo.indexOf(prefixo, p + 1)) onde.push(p);
  if (onde.length !== 1) throw new Error(`achei ${onde.length} copias da data dentro do bloco de ${path.basename(arquivo)} e esperava exatamente uma`);
  const antes = lerClima_(X.completo, onde[0], false);
  const novo = Buffer.from(X.completo);
  for (const [k, v] of Object.entries(valores)) if (v !== undefined && v !== null) novo[onde[0] + CLIMA[k][0]] = v;
  const tmp = arquivo + '.clima.tmp';
  reconstruir(arquivo, tmp, (bl, k) => (k === 1 ? codificarComoJogo(novo, X.d.esc) : bl));
  const b = fs.readFileSync(tmp);
  for (const [k, v] of Object.entries(valores)) if (v !== undefined && v !== null && CLIMA[k][1] !== null) b[L.fim + CLIMA[k][1]] = v;
  fs.writeFileSync(tmp, b);
  fs.renameSync(tmp, arquivo);
  const d = lerClima(arquivo);
  for (const [k, v] of Object.entries(valores)) {
    if (v === undefined || v === null) continue;
    if (d.bloco?.[k] !== v || (CLIMA[k][1] !== null && d.cabecalho[k] !== v)) throw new Error(`o clima nao ficou: ${k} ${JSON.stringify(d)}`);
  }
  return { ...d.bloco, antes };
}

export function escreverHora(arquivo, minutos) {
  const r = escreverData(arquivo, { minutos });
  return { minutos, antes: r.antes.minutos };
}
export function lerHora(arquivo) {
  const d = lerData(arquivo);
  return { cabecalho: d.cabecalho.minutos, bloco: d.bloco ? d.bloco.minutos : null };
}

// O TEMPO EXTRA VARIAVEL, escrito na copia de dentro. 9 dos 86 mapas de cada tipo trazem 5 ou 15
// minutos, e o transplante os carregava para a batalha (a 5 da EASY2 saiu com 0-5).
export const TEMPOS_EXTRA = [0, 5, 10, 15];
export function escreverTempoExtra(arquivo, minutos) {
  if (!TEMPOS_EXTRA.includes(minutos)) throw new Error(`tempo extra ${minutos}: o editor so oferece ${TEMPOS_EXTRA.join(', ')}`);
  const r = abrir(arquivo);
  const L = lerListaStrings(r.b, r.bmpFim);
  const prefixo = Buffer.from(r.b.subarray(L.fim, L.fim + 7));
  const X = abrirCompleto(arquivo);
  const onde = [];
  for (let p = X.completo.indexOf(prefixo); p >= 0; p = X.completo.indexOf(prefixo, p + 1)) onde.push(p);
  if (onde.length !== 1) throw new Error(`achei ${onde.length} copias da duracao dentro do bloco de ${path.basename(arquivo)} e esperava exatamente uma`);
  const antes = X.completo[onde[0] + 9];
  if (antes === minutos) return { minutos, antes, mudou: false };
  const novo = Buffer.from(X.completo);
  novo[onde[0] + 9] = minutos;
  const tmp = arquivo + '.extra.tmp';
  reconstruir(arquivo, tmp, (bl, k) => (k === 1 ? codificarComoJogo(novo, X.d.esc) : bl));
  fs.renameSync(tmp, arquivo);
  const d = lerDuracao(arquivo);
  if (d.extra !== minutos) throw new Error(`o tempo extra nao ficou: ${d.extra}`);
  return { minutos, antes, mudou: true };
}

// O INTEL DO COMECO (17/10/2026, gabarito do autor em Game Files/TESTING: "neither no intel", "neither 30pct red", 50, 70,
// "full intel red"): a aba Data do editor guarda Early Intel e Intel Strength junto da duracao. Na copia de DENTRO,
// a partir do prefixo da duracao (prefixo 7 | u16 duracao | u8 extra | ...): +17 Early Intel (2 Neither, 1 Red, 0 Blue — este
// ultimo pela ordem do menu, nao medido) e +18 Intel Strength em % (0..100, passos de 10). O cabecalho tem uma copia do Early Intel em +12 (a forca
// so mora dentro). Escrever os dois lugares, como a duracao.
export const EARLY_INTEL = { Blue: 0, Red: 1, Neither: 2 };
export function lerIntel(arquivo) {
  const r = abrir(arquivo); const L = lerListaStrings(r.b, r.bmpFim);
  const X = abrirCompleto(arquivo); const p = X.completo.indexOf(Buffer.from(r.b.subarray(L.fim, L.fim + 7)));
  const nome = (v) => Object.keys(EARLY_INTEL).find((k) => EARLY_INTEL[k] === v) ?? String(v);
  return { lado: p < 0 ? null : nome(X.completo[p + 17]), forca: p < 0 ? null : X.completo[p + 18], cabecalho: nome(r.b[L.fim + 12]) };
}
export function escreverIntel(arquivo, { lado = 'Neither', forca = 0 } = {}) {
  const v = EARLY_INTEL[lado]; if (v === undefined) throw new Error(`Early Intel ${lado}: use ${Object.keys(EARLY_INTEL).join(', ')}`);
  if (!Number.isInteger(forca) || forca < 0 || forca > 100 || forca % 10) throw new Error(`Intel Strength ${forca}: 0 a 100, de 10 em 10`);
  const r = abrir(arquivo); const L = lerListaStrings(r.b, r.bmpFim);
  const prefixo = Buffer.from(r.b.subarray(L.fim, L.fim + 7));
  const X = abrirCompleto(arquivo); const onde = [];
  for (let p = X.completo.indexOf(prefixo); p >= 0; p = X.completo.indexOf(prefixo, p + 1)) onde.push(p);
  if (onde.length !== 1) throw new Error(`achei ${onde.length} copias da duracao dentro do bloco de ${path.basename(arquivo)} e esperava exatamente uma`);
  const novo = Buffer.from(X.completo); novo[onde[0] + 17] = v; novo[onde[0] + 18] = forca;
  const tmp = arquivo + '.intel.tmp';
  reconstruir(arquivo, tmp, (bl, k) => (k === 1 ? codificarComoJogo(novo, X.d.esc) : bl));
  const b = fs.readFileSync(tmp); b[L.fim + 12] = v; fs.writeFileSync(tmp, b);
  fs.renameSync(tmp, arquivo);
  const d = lerIntel(arquivo);
  if (d.lado !== lado || d.forca !== forca || d.cabecalho !== lado) throw new Error(`o intel nao ficou: ${JSON.stringify(d)}`);
  return d;
}

// A GUERRA ELETRONICA (17/10/2026, gabaritos do autor em Game Files/TESTING: "BLUE LIGHT", "BLUE STRONG", "RED LIGHT",
// "RED STRONG", no mesmo mapa vazio): Blue e Red Electronic Warfare Strength moram no CABECALHO DA FORCA, o marcador
// de fim de mapa que `abrirCompleto` acha em `m` (`00 a b [Blue] [Red] ...`): m+3 Blue, m+4 Red; None 0, Light 1,
// Medium 2 (pela ordem do menu, nao medido), Strong 3. Nada no cabecalho do arquivo. Nos 219 arquivos medidos (mapas
// do app, Scenarios, TESTING) os dois sao zero fora dos gabaritos.
export const GUERRA_ELETRONICA = { None: 0, Light: 1, Medium: 2, Strong: 3 };
const nomeEW = (v) => Object.keys(GUERRA_ELETRONICA).find((k) => GUERRA_ELETRONICA[k] === v) ?? String(v);
export function lerEW(arquivo) {
  const X = abrirCompleto(arquivo);
  return { azul: nomeEW(X.completo[X.m + 3]), vermelho: nomeEW(X.completo[X.m + 4]), m: X.m };
}
export function escreverEW(arquivo, { azul = 'None', vermelho = 'None' } = {}) {
  const va = GUERRA_ELETRONICA[azul], vv = GUERRA_ELETRONICA[vermelho];
  if (va === undefined || vv === undefined) throw new Error(`Electronic Warfare ${azul}/${vermelho}: use ${Object.keys(GUERRA_ELETRONICA).join(', ')}`);
  const X = abrirCompleto(arquivo); const c = X.completo, m = X.m;
  // o cabecalho da forca confere pela forma: byte 0 zero e o primeiro registro 14 ou 18 bytes adiante. SO COM TROPAS: num
  // mapa sem tropas (o pacote Meet) o marcador e achado pela corrida de zeros `00 a b 00 00 10`, e um valor ali o desfaz —
  // a releitura cai em outro lugar. Batalha do app sempre tem tropas; ali `abrirCompleto` acha pela largura do cabecalho.
  if (m === undefined || c[m] !== 0 || !X.R.length || ![14, 18].includes(X.R[0].c - m)) throw new Error(`so numa batalha com tropas: o cabecalho da forca nao conferiu em ${path.basename(arquivo)} (m ${m})`);
  const novo = Buffer.from(c); novo[m + 3] = va; novo[m + 4] = vv;
  const tmp = arquivo + '.ew.tmp';
  reconstruir(arquivo, tmp, (bl, k) => (k === 1 ? codificarComoJogo(novo, X.d.esc) : bl));
  fs.renameSync(tmp, arquivo);
  const d = lerEW(arquivo);
  if (d.azul !== azul || d.vermelho !== vermelho || d.m !== m) throw new Error(`a guerra eletronica nao ficou: ${JSON.stringify(d)}`);
  return d;
}

// NACAO DE CADA LADO (secao 108): PAR de bytes `base+17` (azul) e `base+18` (vermelho), na
// numeracao do exercito do registro (1 US, 2 RU, 3 UKR — secao 15). Sao os rotulos que o AAR
// usa. O editor os grava sozinho ao comprar; o gerador monta a forca por codigo e os bytes
// ficavam com os valores do template, o que trocava as nacoes no AAR. Escrever so o azul deixa
// os DOIS lados com o mesmo rotulo (foi o que o AAR do `ZZ AAR NACAO` mostrou): o par anda junto.
export const NACAO = { US: 1, RU: 2, UKR: 3 };
const valorNacao = (n) => { const v = typeof n === 'number' ? n : NACAO[n]; if (!v) throw new Error(`nacao invalida: ${n} (use US, RU, UKR ou 1..3)`); return v; };
export function lerNacoes(arquivo) {
  const r = abrir(arquivo); const L = lerListaStrings(r.b, r.bmpFim);
  return { azul: r.b[L.fim + 17], vermelho: r.b[L.fim + 18] };
}
export function escreverNacoes(arquivo, { azul, vermelho } = {}) {
  const b = Buffer.from(fs.readFileSync(arquivo));
  const r = abrir(arquivo); const L = lerListaStrings(r.b, r.bmpFim);
  if (azul != null) b[L.fim + 17] = valorNacao(azul);
  if (vermelho != null) b[L.fim + 18] = valorNacao(vermelho);
  fs.writeFileSync(arquivo, b);
  return lerNacoes(arquivo);
}
export const lerNacaoAzul = (arquivo) => lerNacoes(arquivo).azul;
export const escreverNacaoAzul = (arquivo, nacao) => escreverNacoes(arquivo, { azul: nacao }).azul;
// Exercito da PRIMEIRA formacao de cada bloco — e o que o editor poe no par.
export function nacoesDaForca(arquivo) {
  const X = abrirCompleto(arquivo); const A = arvore(X); const c = X.completo;
  const ex = (t) => (t.length ? (c[t[0].r.c + 14] >> 4) & 0xf : null);
  return { azul: ex(A.azul), vermelho: ex(A.vermelho) };
}
export const nacaoDaForcaAzul = (arquivo) => nacoesDaForca(arquivo).azul;

// ids das UNIDADES (nao formacoes) de um lado, pela arvore posicional (secao 68)
function idsDoLado(arquivo, lado) {
  const X = abrirCompleto(arquivo); const A = arvore(X); const out = [];
  const anda = (n) => { if (!n.r.form) out.push(n.r.id); n.filhos.forEach(anda); };
  (lado === 'azul' ? A.azul : A.vermelho).forEach(anda);
  return out;
}

function topos(arquivo) {
  const d = ler(arquivo); const R = registros(d.cru).sort((a, b) => a.off - b.off); const p = indiceDeTokens(d.tokens);
  const out = []; let i = 0;
  while (i < R.length) { if (!R[i].form) { i++; continue; } let e; try { e = subArvore(d.cru, p, R, i); } catch { e = i + 1; }
    out.push({ id: R[i].id, nome: R[i].nm, army: R[i].army, registros: e - i }); if (e <= i) break; i = e; }
  // ids contiguos como CONJUNTO (a ordem de arquivo pode nao ser monotona: anexos recebem ids novos)
  const ids = R.map((r) => r.id).sort((a, b) => a - b); let saltos = 0; for (let k = 1; k < ids.length; k++) if (ids[k] !== ids[k - 1] + 1) saltos++;
  return { topos: out, registros: R.length, fecha: i === R.length, saltos };
}

export async function gerar(spec, saida) {
  // ATACANTE/DEFENSOR (secao 68): nos mapas de Quick Battle o lado azul tem a zona grande com os
  // objetivos (defende) e o vermelho as faixas de borda (ataca). Como qualquer exercito pode ir
  // em qualquer lado, "quem ataca" e so isto: defensor -> azul, atacante -> vermelho, e o tipo de
  // batalha e "Red <Attack|Assault|Probe>". Replica a tela de Quick Battle, inclusive EUA x EUA.
  if (spec.atacante || spec.defensor) {
    if (!spec.defensor?.length || !spec.atacante?.length) throw new Error('atacante e defensor precisam ambos de formacoes');
    // MEETING ENGAGEMENT (05/10, E146): os dois lados atacam e o tipo (0x03) nao tem lado; o resto e igual — o jogador
    // continua no vermelho e a IA no azul, cada um na sua zona.
    const encontro = /^meet/i.test(String(spec.ataque || ''));
    spec = { ...spec, azul: spec.defensor, vermelho: spec.atacante, tipo: spec.tipo || (encontro ? 'Meeting Engagement' : 'Red ' + (spec.ataque || 'Attack')) };
  }
  if (!spec.azul?.length) throw new Error('a especificacao precisa de ao menos uma formacao azul (o bloco azul e a base)');
  // a base precisa de cabecalho padrao (17 bytes ate o id): escolhe a maior formacao azul que sirva
  const azul = spec.azul.map((f) => ({ ...f, lado: 'azul' }));
  const temporarios = []; let k = 0;
  const passo = () => { const t = tmp(k++); temporarios.push(t); return t; };
  // ANEXOS (secao 65): `anexos: { fonte, n }` toma os ultimos n registros de `fonte` — uma versao
  // da mesma formacao com os extras ja comprados — e os anexa por codigo. Cache por formacao.
  const cacheAnexo = new Map();
  const fonteDe = (f) => {
    let fonte = resolver(f.formacao, [LIB, S]);
    if (f.anexos) {
      const chave = f.formacao + '|' + f.anexos.fonte + '|' + (f.anexos.n || 1);
      if (!cacheAnexo.has(chave)) {
        const out = passo(); const r = anexar(fonte, resolver(f.anexos.fonte, [LIB, S]), out, f.anexos.n || 1);
        console.log(`   anexo em ${f.formacao}: ${r.anexos.join(' + ')} (custo ${r.custo}, ${r.unidades} unidades)`);
        cacheAnexo.set(chave, out);
      }
      fonte = cacheAnexo.get(chave);
    }
    // `ausentes` (secao 67): subformacoes marcadas como ausentes, por indice 1-based ou {nome, ocorrencia}
    if (f.ausentes?.length || f.ausentesUnidades || f.ausentesSoltas) {
      const chave = 'aus|' + f.formacao + '|' + JSON.stringify(f.ausentes || []) + '|' + (f.ausentesUnidades || '') + '|' + (f.ausentesSoltas || '');
      if (!cacheAnexo.has(chave)) { const out = passo(); const r = podar(fonte, out, 0, f.ausentes || [], f.ausentesUnidades || null, f.ausentesSoltas || null); console.log(`   ausentes em ${f.formacao}: ${r.marcados.join(' | ')}`); cacheAnexo.set(chave, out); }
      fonte = cacheAnexo.get(chave);
    }
    // GRUPOS DE IA (secao 70): `grupo: n` para a formacao inteira e/ou `grupos: [{nome, ocorrencia, grupo} | {unidade, ocorrencia, grupo}]`
    const regras = [...(f.grupo ? [{ grupo: f.grupo }] : []), ...(f.grupos || [])];
    if (regras.length) {
      const chave = 'grp|' + f.formacao + '|' + JSON.stringify(regras);
      if (!cacheAnexo.has(chave)) { const out = passo(); const r = agrupar(fonte, out, 0, regras); console.log(`   grupos em ${f.formacao}: ${r.feitos.join(' | ')}`); cacheAnexo.set(chave, out); }
      fonte = cacheAnexo.get(chave);
    }
    return fonte;
  };
  // a base e a maior formacao azul; compor2 aceita fonte vermelha-primeiro como base (secao 68)
  const tam = azul.map((f) => { const d = ler(fonteDe(f)); return registros(d.cru).length; });
  let iBase = 0; for (let i = 1; i < azul.length; i++) if (tam[i] > tam[iBase]) iBase = i;
  const ordenado = [azul[iBase], ...azul.filter((_, i) => i !== iBase)];
  const lista = [...ordenado, ...(spec.vermelho || []).map((f) => ({ ...f, lado: 'vermelho' }))];

  // 1) composicao na corrente completa, com o lado explicito (compor2)
  let atual = passo();
  compor2(lista.map((f) => ({ arquivo: fonteDe(f), lado: f.lado })), atual);

  // 2) anexos: NAO se injeta anexo por bytes (secao 56 — aplicar duas vezes trava). Um anexo e uma
  //    FONTE de biblioteca que ja contem os extras (feita no editor). Quem quer Breach Team num
  //    batalhao usa a fonte "... [Breach]"; aqui so recusamos o campo antigo com uma mensagem clara.
  // 3) atributos, por id da formacao de topo (ids ja finais)
  const t = topos(atual);
  lista.forEach((f, idx) => {
    if (!f.atributos) return;
    const out = passo(); aplicarAtributos(atual, out, t.topos[idx].id, f.atributos); atual = out;
  });

  // 4) mapa, duracao, tipo
  const mapa = resolver(spec.mapa, [S, QB]);
  transplantar(mapa, atual, saida);
  // 5) posicao: cada lado espalhado pelos tiles da sua zona de setup (secao 61). Sem isso a forca
  //    fica no canto do mapa de origem. `posicionar: false` na especificacao desliga.
  if (spec.posicionar !== false) {
    const z = pintura(saida);   // tinta da grade (secao 69), nao as listas de IA
    // : cada lado ocupa a zona do OUTRO. Nos mapas de Quick Battle o lado azul
    // sempre recebe a area grande que contem os objetivos (varri 11 mapas legiveis, nenhum foge),
    // ou seja, azul defende. Para o azul ATACAR ele precisa sair da faixa estreita, que e a zona
    // vermelha. A tinta da zona no editor continua sendo a do lado dono dela; o que muda e de onde
    // cada forca parte, que e o que define quem ataca.
    const pares = spec.trocarZonas ? [['azul', z.vermelho], ['vermelho', z.azul]] : [['azul', z.azul], ['vermelho', z.vermelho]];
    for (const [lado, listas] of pares) {
      const cru = listas.flatMap((l) => l.tiles);
      if (!cru.length) { console.log(`   (sem zona de setup ${lado} no mapa; lado fica onde esta)`); continue; }
      // A ESCADA DE APERTO. A primeira escolha e a folgada — dois tiles para dentro da borda e um
      // lugar a cada dois — porque assim ninguem nasce colado na borda nem empilhado. Mas ela usa
      // um oitavo da zona: num mapa de 300 tiles pintados sobram 24 lugares, e uma forca de 26
      // unidades nao cabia num deploy onde cabem 300. Entao, se nao couber, aperta: primeiro o
      // espacamento, depois a margem. So desiste quando nem a zona inteira, tile a tile, da conta —
      // e ai o mapa e pequeno de verdade.
      const escada = [
        { tiles: interior(cru, 2, 1), passo: 2, como: 'folgado' },
        { tiles: interior(cru, 2, 1), passo: 1, como: 'sem espacamento' },
        { tiles: interior(cru, 1, 1), passo: 1, como: 'margem menor' },
        { tiles: cru, passo: 1, como: 'zona inteira' },
      ];
      const tmp = passo(); fs.copyFileSync(saida, tmp);
      // posicionador do COMPLETO (acrescentar.posicionarIds): o de `posicionar.mjs` trabalha no cru,
      // onde zeros viram tokens, e escrevia x,y 15 bytes adiante em unidades com x = 0.0 (as que o
      // editor nunca posicionou) — em cima do core id, no caso de uma forca de campanha (secao 111.14)
      const ids = new Set(idsDoLado(saida, lado));
      let feito = null, ultimo = null;
      for (const degrau of escada) {
        if (!degrau.tiles.length) continue;
        try {
          const r = posicionarIds(tmp, saida, ids, degrau.tiles, degrau.passo);
          feito = { ativos: r.ativos, tiles: r.tiles, semPosicao: r.semPosicao, como: degrau.como };
          break;
        } catch (e) { ultimo = e; fs.copyFileSync(tmp, saida); }
      }
      if (feito) {
        console.log(`   ${lado}: ${feito.ativos} unidades em ${feito.tiles} tiles da zona (${listas.length} listas, ${feito.como}${feito.semPosicao ? ', ' + feito.semPosicao + ' sem posicao' : ''})`);
      } else {
        // Ninguem fica sem aviso: sem isto a forca fica onde estava no mapa de biblioteca, ou seja,
        // FORA da zona de deploy, e a batalha e entregue impossivel de jogar (secao 112.9).
        console.log(`   ATENCAO ${lado}: ${ultimo ? ultimo.message : 'sem lugar'} — a zona tem ${cru.length} tiles pintados e a forca NAO FOI POSICIONADA`);
        fs.copyFileSync(tmp, saida);
      }
    }
  }
  if (spec.duracao) escreverDuracao(saida, spec.duracao);
  { const m = marcarComoCenario(saida); if (m.antes !== m.depois) console.log(`   bit de cenario ligado (base+29: 0x${m.antes.toString(16)} -> 0x${m.depois.toString(16)}) — o mapa veio de um Quick Battle Map cru`); else if (m.recusado) console.log(`   bit de cenario NAO ligado: ${m.recusado}`); }
  if (spec.tipo) escreverTipo(saida, spec.tipo);
  // NACOES DOS LADOS (secao 108): sem isto o AAR herda os rotulos do template — foi o que trocou
  // as nacoes na TESTE 4. O par anda junto: escrever so um lado deixa os dois com o mesmo rotulo.
  { const f = nacoesDaForca(saida);
    const azul = spec.nacaoAzul ?? f.azul, vermelho = spec.nacaoVermelho ?? f.vermelho;
    if (azul || vermelho) { const antes = lerNacoes(saida); const agora = escreverNacoes(saida, { azul, vermelho });
      if (antes.azul !== agora.azul || antes.vermelho !== agora.vermelho)
        console.log(`   nacoes (azul, vermelho): (${antes.azul}, ${antes.vermelho}) -> (${agora.azul}, ${agora.vermelho})`); } }
  // a limpeza dos temporarios fica para o FIM: gruposAuto e extras ainda vao pedir `passo()` — antes
  // desta correcao cada geracao deixava uma duzia de `tmp_gerar_*.btt` na pasta Scenarios
  const limpar = () => { for (const f of temporarios) if (fs.existsSync(f)) fs.unlinkSync(f); };

  // 5) validacao
  // Uma fonte pode trazer VARIOS topos (um lado extraido de uma batalha, secao 96, ou a forca
  // core do jogador na campanha, secao 111): o esperado e a soma dos topos de cada fonte, nao
  // uma formacao por entrada da spec.
  const esperados = lista.reduce((n, f) => { try { return n + Math.max(1, topos(resolver(f.formacao, [LIB, S])).topos.length); } catch { return n + 1; } }, 0);
  const v = topos(saida);
  if (!v.fecha || v.saltos || v.topos.length !== esperados) {
    limpar();
    throw new Error(`validacao: arvore ${v.fecha ? 'fecha' : 'NAO fecha'}, ${v.saltos} saltos, ${v.topos.length} topos (esperava ${esperados})`);
  }

  // GRUPOS DE IA AUTOMATICOS (secoes 84-85): `gruposAuto: true` le no proprio mapa quais grupos o
  // plano 1 de cada lado usa e distribui as subformacoes em rodizio por eles. Sem isso, tudo
  // fica no grupo 1 e os demais grupos do plano nunca recebem tropa. O jogador e a engine fazem
  // o resto (autor, 04/09).
  if (spec.gruposAuto) {
    let usados = null; try { usados = gruposUsados(saida); } catch (e) { console.log(`   (plano de IA nao lido: ${e.message})`); }
    for (const lado of ['azul', 'vermelho']) {
      const u = usados?.[lado]; if (!u?.grupos?.length) { console.log(`   (sem plano de IA ${lado} legivel; grupos ficam em 1)`); continue; }
      const tmp = passo(); fs.copyFileSync(saida, tmp);
      try { const r = distribuirPorLado(tmp, saida, lado, u.grupos); console.log(`   grupos ${lado} (plano ${u.plano}, grupos ${u.grupos.join(',')}): ${Object.entries(r.porGrupo).map(([k, v]) => 'G' + k + ':' + v).join(' ')}`); }
      catch (e) { console.log(`   (grupos ${lado}: ${e.message})`); fs.copyFileSync(tmp, saida); }
    }
  }

  // EXTRAS (secoes 98/98.1/98.2): unidades do CATALOGO inseridas em formacoes que ja estao na
  // batalha — Breach Team dentro do pelotao, tanque avulso na companhia. Sem doador e sem `ZZ`: o
  // registro e sintetizado do banco de moldes (ou do proprio time do destino, quando o tipo nao tem
  // molde na LIB). Vem por ULTIMO para que `grupo` explicito nao seja sobrescrito pelo gruposAuto.
  //   extras: [{ tipo: 'Breach Team', lado: 'vermelho', em: ['Company (Rifle)', 'Platoon (Rifle)#1'],
  //              grupo: 3, custo: 51, par: [0x62, 0x0e], topo: 0 }]
  if (spec.extras?.length) {
    // sem `posicao` explicita, os extras de um mesmo lado se espalham por fracoes diferentes do
    // interior da zona — senao todos caem no mesmo tile
    const doLado = {}; spec.extras.forEach((e) => { doLado[e.lado] = (doLado[e.lado] || 0) + 1; });
    const visto = {};
    for (const e of spec.extras) {
      const destino = { lado: e.lado, topo: e.topo || 0, caminho: e.em || [] };
      const X = abrirCompleto(saida); const no = resolverDestino(arvore(X), destino);
      // `atributos` (E51): a campanha sintetiza o veiculo avulso do jogador num nivel escolhido
      // (Regular), e nao no que o molde trouxe da LIB — e o que o preco cobrou.
      const carga = await sintetizarPorNome(X, no, e.tipo, { ...(e.par ? { par: e.par } : {}), ...(e.grupo ? { grupo: e.grupo - 1 } : {}), ...(e.atributos ? { atributos: e.atributos } : {}), ...(e.avulso ? { avulso: true } : {}) });
      visto[e.lado] = (visto[e.lado] || 0) + 1;
      const pos = e.posicao || posicaoNaZona(saida, e.lado, visto[e.lado] / (doLado[e.lado] + 1));
      const tmp = passo(); fs.copyFileSync(saida, tmp);
      const r = inserirRegistro(tmp, carga.bytes, destino, saida, { custo: e.custo ?? 100, offPosicao: carga.offPos, posicao: pos });
      console.log(`   extra ${carga.nome} -> ${r.destino}: id ${r.id}, ${r.filhos} filhos, pos (${r.posicao.x}, ${r.posicao.y})${e.grupo ? ', grupo ' + e.grupo : ''}; ${carga.fonte}`);
      fs.unlinkSync(tmp);
    }
    const vf = verificarForca(saida);
    if (!vf.ok) { limpar(); throw new Error(`extras: verificarForca reprovou — ${vf.erros.join('; ')}`); }
    console.log(`   extras: ${vf.registros} registros, N ${vf.N}, custo ${vf.A} (verificacao limpa)`);
    limpar();
    return topos(saida);                                   // revalida com os extras dentro
  }
  limpar();
  return v;
}

const EH_MAIN = process.argv[1] && /[\\/]gerar_batalha\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const [specPath, saida] = process.argv.slice(2);
  if (!specPath || !saida) { console.log('uso: node gerar_batalha.mjs spec.json saida.btt'); process.exit(1); }
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const v = await gerar(spec, /[\/]/.test(saida) ? saida : S + saida);
  console.log(`${path.basename(saida)}: ${v.registros} registros, ${v.topos.length} formacoes de topo`);
  for (const t of v.topos) console.log(`   ex${t.army} id ${t.id}  ${t.nome}  (${t.registros} registros)`);
}
