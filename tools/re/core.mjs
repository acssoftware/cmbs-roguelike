// MARCAR UMA FORCA COMO CORE (secoes 110.1 e 111.16) — o que o editor faz no "Import Campaign
// Units", por codigo. Todo registro ganha, logo depois do seu conteudo, a cauda
//     [u32 CORE ID = id do registro][u8 presente: 1 ativa, 0 apagada][u16 0x0304]
// e perde o bit 0 de +11. Formacoes seguem com `00 00` e o contador de filhos (que continua
// colado aos 3 zeros de cabeca do primeiro filho); unidades seguem com o enchimento da regra
// core (6 zeros ate o id seguinte). Medido nos 288 pares V5 x CAMPAIGN IMPORTED.
//
// Onde termina o conteudo (`r.c` = inicio do registro, com os 3 zeros de cabeca; id em +3). Medido
// no oraculo dos 288 pares V5 x CI (o core id do CI localiza o fim exato) e na varredura de 180 mil
// registros dos ZZ (secao 111.16). Com `base` = +20, ou +20 + 2 + len quando o registro tem nome
// (bit 0x10 de +7: `u16 len | texto`, secao 97; nos veiculos o nome vem depois do u16):
//   formacao:      base+0..+3 semente | base+4 = 00                                   -> cauda
//   sem posicao:   base+0..+3 semente | u8 n | n x u16 tipo                           -> cauda
//     (off-map: n = 0; unidades APAGADAS que o editor nunca posicionou: BMP-3M `02 5b 02 91 02`,
//      morteiro `01 84 02`, Raven `00`; unidades apagadas COM posicao seguem a forma normal)
//   time:          semente 8 B | ELEMENTO | LISTA                                     -> cauda
//   veiculo:       u16 | semente 8 B | ELEMENTO | LISTA                                -> cauda
// ELEMENTO (17 B) = `marcador | f32 rumo | f32 x | f32 y | u32 ref`: o marcador tem o nibble baixo
// 0 e o alto de flags (0x10 posicionado, 0x80 embarcado — `ref` e o id do veiculo; 0x40 e outros
// aparecem; 0x00 nos times destacados). LISTA = `u8 n`: 0 = fim; 1..3 = n entradas u16 de byte
// alto 02 (BMP-2M 2, Abrams/Bradley/Sniper 1, Squad (Rifle) com Javelin 2, T-90 3). Antes dela
// pode haver outros ELEMENTOS, cada um precedido de `02` ou `00` — e o esquadrao dividido em
// times (cada time no seu lugar, inclusive embarcado em veiculos diferentes); a lista de tipos
// fecha a sequencia. A ancora e o marcador logo depois da semente, validado pela forma inteira
// (floats limpos, lista, so zeros ate o registro seguinte):
// o `posicaoNoCompleto` (primeiro 0x10 a partir de +24) confundia bytes da semente com a posicao.
// Nos arquivos nao-core esses bytes ja existem como zeros; a cauda os preenche e o registro
// cresce 5.
import fs from 'node:fs';
import { abrirCompleto } from './anexar2.mjs';
import { regraDeEnchimento } from './regs.mjs';
import { codificarComoJogo } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';
import { arvore } from './extras.mjs';

const MARCA = Buffer.from([0x04, 0x03]);

const zerosAte = (c, a, b) => { for (let i = a; i < b; i++) if (c[i] !== 0) return false; return true; };
const limpo = (v) => Number.isFinite(v) && Math.abs(v) < 20000 && (v === 0 || Math.abs(v) >= 0.5);
// o rumo e quase sempre 0; quando nao e, lido como float da de 1e-13 a algumas centenas (nao e um
// float de verdade). Serve so para descartar lixo: finito e sem sinal.
const rumoLimpo = (v) => Number.isFinite(v) && v >= 0 && v < 1e6;
const elemento = (c, p, frouxo = false) => (c[p] & 0x0f) === 0 && p + 17 <= c.length && (frouxo ? Number.isFinite(c.readFloatLE(p + 5)) && Number.isFinite(c.readFloatLE(p + 9)) : rumoLimpo(c.readFloatLE(p + 1)) && limpo(c.readFloatLE(p + 5)) && limpo(c.readFloatLE(p + 9)));
// semente do editor: dois grupos de 4 com o mesmo primeiro byte (ou +1); 99.7% dos 174 mil registros. Desempata time x veiculo.
const sementeDoEditor = (c, p) => c[p + 4] === c[p] || c[p + 4] === ((c[p] + 1) & 0xff);
// lista de tipos: u8 n (0..3) | n x (xx 02); devolve o fim ou -1
const tipos = (c, p) => { const n = c[p]; if (n > 3) return -1; for (let i = 0; i < n; i++) if (c[p + 2 + 2 * i] !== 0x02) return -1; return p + 1 + 2 * n; };
// SEP: o byte que anuncia mais um ELEMENTO na lista. Medido 0x00, 0x02, 0x04 e 0xff no mesmo tipo
// de esquadrao — nao e contador nem tamanho, entao qualquer valor serve: quem decide e o ELEMENTO
// que vem depois (marcador de nibble baixo 0, tres floats limpos) e o fechamento do registro. A
// lista de tipos e sempre tentada antes; so quando ela nao fecha e que se consome mais um elemento.
// cauda core em p: [u32 core id][00|01][04 03]
const caudaEm = (c, p) => p + 7 <= c.length && (c[p + 4] === 0 || c[p + 4] === 1) && c[p + 5] === 0x04 && c[p + 6] === 0x03;

// Onde comeca a SEMENTE: +20 nos times, +22 nos veiculos (o u16 do veiculo vem antes). Se o
// registro tem nome proprio (bit 0x10 de +7: `u16 len | texto`, secao 97), o nome esta bem ai —
// depois do u16 do veiculo, nao em +20 (o "Supply 004" do Ambush.btt) — e a semente vem depois.
export function posicaoDaSemente(c, r, veiculo = false) {
  let p = r.c + 20 + (veiculo ? 2 : 0);
  if (c[r.c + 7] & 0x10) p += 2 + c.readUInt16LE(p);
  return p;
}
// compatibilidade: a base do conteudo de um time (ou de uma formacao)
export const baseDoRegistro = (c, r) => posicaoDaSemente(c, r, false);

// Fim do conteudo (exclusivo) de um registro no completo, a sua natureza e se ja tem a cauda core.
// Le a forma para a frente e confere o que vem depois: a cauda `[u32][00|01][04 03]` (core) ou o
// enchimento de zeros (nao-core). `fimRegistro` = inicio do registro seguinte (prox.c), ou
// prox.c - 1 na fronteira azul/vermelho; para o ultimo registro, c.length (o padrao).
// Tres passagens, da mais exigente para a mais tolerante:
//   1. zeros ate o registro seguinte (o caso normal: sempre 5, ou 6 no core);
//   2. so o enchimento de 5 zeros — o ultimo registro (o rodape nem sempre e uma corrida longa de
//      zeros: depois de um BMP-3M apagado a secao de textos vem 8 bytes adiante) e os registros
//      cujo vizinho o parser nao leu (grupo de IA fora de 0..15, por exemplo);
//   3. idem, aceitando floats de posicao estranhos (registros que o proprio editor gravou tortos).
// Se nada casar mas houver `04 03` no fim, devolve o fim pela cauda (e o caso do Bradley
// corrompido que o proprio editor gravou no CAMPAIGN IMPORTED).
export function fimDoConteudo(c, r, fimRegistro = c.length) {
  const solto = fimRegistro >= c.length || fimRegistro - r.c > 160;   // registro de unidade nunca passa de ~140 B
  // `lista` = onde comeca a LISTA de tipos (o `u8 n`), quando a forma a tem: e o caminho dos blocos
  // de equipamento do editor (43.2), e quem troca equipamento reescreve dali ate `fim`. Null na
  // forma reconhecida so pela cauda.
  const feito = (fim, kind, core, lista = null) => ({ fim, kind, core, lista });
  // FORMACAO: semente de 4 bytes e, depois dela, a MESMA lista de tipos das unidades — quase
  // sempre vazia (`00`), mas nao sempre: `Section (Mortar [heavy])` traz `02 8b 02 8c 02` e os
  // `Platoon (Assault)` trazem `01 d0 02`. Assumir 1 byte fazia a cauda core ser gravada em cima
  // desses bytes: o registro encolhia 2 ou 4, a forca perdia 14 bytes e o jogo morria ao carregar
  // (secao 112.3). O gabarito V5 nao pega porque nenhuma formacao dele tem lista.
  if (r.form) {
    const b = posicaoDaSemente(c, r); const t = tipos(c, b + 4);
    const fim = t > 0 ? t : b + 5;
    return feito(fim, 'formacao', caudaEm(c, fim), b + 4);
  }
  const offMap = c[r.c + 12] === 0x50 || c[r.c + 12] === 0x58;
  // curto = confere so o enchimento; senao, zeros ate o registro seguinte. Devolve true (core),
  // false (nao-core) ou null (nao fecha).
  const fecha = (fim, curto) => {
    if (fim < 0 || fim > c.length) return null;
    if (caudaEm(c, fim)) return (curto ? zerosAte(c, fim + 7, fim + 10) : zerosAte(c, fim + 7, fimRegistro - 1)) ? true : null;
    return (curto ? zerosAte(c, fim, fim + 5) : zerosAte(c, fim, fimRegistro - 1)) ? false : null;
  };
  // a cauda pelo fim: um registro que o proprio editor gravou torto (o Bradley do CAMPAIGN
  // IMPORTED, com 34 bytes de lixo no meio) so se reconhece assim — e precisa vir antes das
  // passagens tolerantes, que "fechariam" numa forma inventada dentro do lixo.
  const pelaCauda = () => { let z = Math.min(fimRegistro, c.length) - 1; while (z > r.c && c[z] === 0) z--;
    return c[z] === 0x03 && c[z - 1] === 0x04 && caudaEm(c, z - 6) ? feito(z - 6, 'core (forma desconhecida)', true) : null; };
  for (const [curto, frouxo] of [[solto, false], [null, null], [true, false], [true, true]]) {
    if (curto === null) { const x = pelaCauda(); if (x) return x; continue; }   // passagem do meio: a cauda pelo fim
    // sem posicao: nunca casa com um registro posicionado (o marcador de base+8/+10 quebra a
    // entrada da lista ou o enchimento)
    if (!frouxo) { const q = posicaoDaSemente(c, r) + 4; const fim = tipos(c, q); const k = fecha(fim, curto); if (k !== null) return feito(fim, offMap ? 'off-map' : 'sem-posicao', k, q); }
    // time (elemento em base+8) e veiculo (u16 + elemento em base+10): um veiculo parado em (0,0)
    // com rumo 0 tambem "le" como time — quando os dois fecham, decide a semente do editor (a do
    // time esta em base+0, a do veiculo em base+2); empate: time.
    const cands = [];
    for (const veiculo of [false, true]) {
      const sem = posicaoDaSemente(c, r, veiculo); const e = sem + 8; if (!elemento(c, e, frouxo)) continue;
      const p = e + 17; const kind = (veiculo ? 'veiculo' : 'time') + (frouxo ? ' corrompido' : '');
      const semente = sementeDoEditor(c, sem);
      const tenta = (fim, suf, q) => { const k = fecha(fim, curto); if (k === null) return false; cands.push({ ...feito(fim, kind + suf, k, q), semente }); return true; };
      // a lista fecha com os tipos; antes deles pode vir mais um ELEMENTO (SEP + 17 B), ate 8
      // vezes. Tenta fechar a cada passo — sem isso a cadeia comeria os bytes do registro seguinte.
      for (let q = p, i = 0; i < 8; i++) {
        if (tenta(tipos(c, q), i === 0 ? (c[q] === 0 ? '' : '+tipos') : '+times', q)) break;
        if (!(q + 18 <= fimRegistro && elemento(c, q + 1, frouxo))) break;
        q += 18;
      }
    }
    if (cands.length === 1) return cands[0];
    if (cands.length === 2) return cands[0].semente === cands[1].semente ? cands[0] : cands.find((x) => x.semente);
  }
  throw new Error(`fimDoConteudo: registro ${r.nm} (id ${r.id}) em +${r.c} sem forma conhecida`);
}

export function temCauda(c, r, fimRegistro) { return fimDoConteudo(c, r, fimRegistro).core; }

// COMPRAR E LIGAR UMA CHAVE (secao 111.21, provado no E8). A forca core e o ARSENAL: cada batalha
// leva um subconjunto dela, e a unidade que nao entra fica com o bit 0x80 em +7 (ausente) e
// `presente = 0` na cauda. O roster do `.cam` ja tem a linha dela desde o inicio. Comprar, entao,
// nao insere nada: limpa o bit e poe `presente = 1`. Quem posiciona depois e o gerador.
// `ids` e um Set/array de CORE IDS; `presente: false` desliga em vez de ligar, que e como o
// jogador deixa de fora um esquadrao especifico sem tirar o pelotao inteiro. Devolve o que mudou
// — e o que nao foi achado.
export function ativarCore(entrada, saida, ids, { presente = true } = {}) {
  const alvo = new Set([...ids]);
  const X = abrirCompleto(entrada); const c = Buffer.from(X.completo);
  const mudados = [], jaAssim = [];
  for (let k = 0; k < X.R.length; k++) {
    const r = X.R[k];
    let i; try { i = fimDoConteudo(X.completo, r, X.R[k + 1] ? X.R[k + 1].c : X.completo.length); } catch { continue; }
    if (!i.core) continue;
    const id = c.readUInt32LE(i.fim);
    if (!alvo.has(id)) continue;
    alvo.delete(id);
    const estaPresente = c[i.fim + 4] === 1 && !(c[r.c + 7] & 0x80);
    if (estaPresente === presente) { jaAssim.push(id); continue; }
    c[i.fim + 4] = presente ? 1 : 0;
    if (presente) c[r.c + 7] &= ~0x80; else c[r.c + 7] |= 0x80;
    mudados.push({ id, nome: r.nm });
  }
  // A FORMACAO TAMBEM TEM O BIT, E A UNIDADE NAO ENTRA SEM ELA (112.14). A poda da criacao liga o
  // 0x80 no registro da subformacao inteira — no pelotao E em cada filho (podar.mjs) — e o jogo
  // esconde a subarvore toda. Ligar so os filhos deixa o pai mascarado, e o pelotao de engenheiros
  // que o autor comprou ficou no arquivo com cinco unidades presentes debaixo de um `0x81`: no jogo,
  // nenhuma. Entao ligar uma unidade destapa todos os ancestrais dela. Desligar nao mexe em formacao:
  // uma formacao destapada com todos os filhos mascarados e o que a criacao ja entrega (a Company #1
  // com 10 de 36) e o jogo nao mostra nada dela.
  const formacoes = presente ? destaparAncestrais(X, c) : [];
  reconstruir(entrada, saida, (buf, k) => (k === 1 ? codificarComoJogo(c, X.d.esc) : buf));
  return { ligados: mudados, mudados, jaAtivos: jaAssim, jaAssim, naoAchados: [...alvo], formacoes };
}

// Uma unidade esta EM CAMPO quando a cauda diz `presente = 1` e o registro nao tem o bit 0x80; sem
// cauda core (lado inimigo de uma batalha), quando nao tem o bit.
function unidadeLigada(X, c, k) {
  const r = X.R[k];
  if (c[r.c + 7] & 0x80) return false;
  let i; try { i = fimDoConteudo(c, r, X.R[k + 1] ? X.R[k + 1].c : c.length); } catch { return false; }
  return i.core ? c[i.fim + 4] === 1 : true;
}

function destaparAncestrais(X, c) {
  const A = arvore(X);
  const feitas = [];
  // Devolve se ha unidade ligada na subarvore; no caminho, tira o bit de toda formacao que tenha.
  const anda = (no) => {
    if (!no.r.form) return unidadeLigada(X, c, no.i);
    let viva = false;
    for (const f of no.filhos) if (anda(f)) viva = true;
    if (viva && (c[no.r.c + 7] & 0x80)) { c[no.r.c + 7] &= ~0x80; feitas.push(no.r.nm || `id ${no.r.id}`); }
    return viva;
  };
  A.topos.forEach(anda);
  return feitas;
}

// A CONFERENCIA QUE TERIA PEGADO O PELOTAO INVISIVEL: unidades ligadas debaixo de formacao
// mascarada. `battle.checked` passava e o jogo escondia cinco unidades; agora esta lista tem de sair
// vazia de toda forca core e de toda batalha gerada.
export function presentesSobMascara(caminho) {
  const X = abrirCompleto(caminho); const c = X.completo;
  const A = arvore(X);
  const out = [];
  const anda = (no, trilha, mascarado) => {
    const r = no.r;
    if (r.form) {
      const aqui = mascarado || !!(c[r.c + 7] & 0x80);
      for (const f of no.filhos) anda(f, [...trilha, r.nm || `id ${r.id}`], aqui);
      return;
    }
    if (!mascarado || !unidadeLigada(X, c, no.i)) return;
    let coreId = null;
    try { const i = fimDoConteudo(c, r, X.R[no.i + 1] ? X.R[no.i + 1].c : c.length); if (i.core) coreId = c.readUInt32LE(i.fim); } catch { /* sem cauda */ }
    out.push({ coreId, id: r.id, nome: r.nm, formacao: trilha.join(' / ') });
  };
  A.topos.forEach((t) => anda(t, [], false));
  return out;
}

// ONDE COMECA O ELEMENTO de posicao (`marcador | f32 rumo | f32 x | f32 y | u32 ref`), ou null se
// o registro nao tem posicao (formacao, off-map, "sem-posicao") ou nao tem forma reconhecivel.
//
// Esta e a ancora para ESCREVER posicao. A varredura do `acrescentar.posicaoNoCompleto` (primeiro
// 0x10 a partir de +24, com dois floats plausiveis atras) serve para ler um arquivo do editor, mas
// erra quando a SEMENTE tem um 0x10 antes do marcador — e o ultimo byte da semente costuma ser
// justamente 0x10. Escrevendo por ela, x e y caem em cima do rumo e o registro sai corrompido:
// foi o que derrubou a primeira campanha que o app gerou (secao 112.2), em 3 de 178 registros de
// um batalhao da biblioteca. Aqui a ancora vem da forma inteira, validada por `fimDoConteudo`.
export function posicaoDoElemento(c, r, fimRegistro = c.length) {
  if (r.form) return null;
  let i; try { i = fimDoConteudo(c, r, fimRegistro); } catch { return null; }
  if (i.kind.startsWith('veiculo')) return posicaoDaSemente(c, r, true) + 8;
  if (i.kind.startsWith('time')) return posicaoDaSemente(c, r, false) + 8;
  return null;
}

// Reescreve o bloco da forca marcando todos os registros como core. `presente(r)` decide o byte
// (padrao: !r.ausente). Se o arquivo ja e core, nao mexe. Devolve o relatorio.
export function marcarCore(entrada, saida, { presente = (r) => !r.ausente } = {}) {
  const X = abrirCompleto(entrada); const c = X.completo; const R = X.R;
  if (!R.length) { if (entrada !== saida) fs.copyFileSync(entrada, saida); return { registros: 0, marcados: 0, jaCore: 0, tipos: {} }; }   // mapa sem forca
  const A = arvore(X);
  const primVerm = A.vermelho.length ? R[A.vermelho[0].i] : null;
  const rel = { registros: R.length, marcados: 0, jaCore: 0, tipos: {} };
  const partes = [c.subarray(0, R[0].c)];
  for (let k = 0; k < R.length; k++) {
    const r = R[k]; const prox = R[k + 1];
    const fronteira = !!(primVerm && prox && prox.c === primVerm.c);
    const fimRegistro = prox ? (fronteira ? prox.c - 1 : prox.c) : c.length;
    const { fim, kind, core } = fimDoConteudo(c, r, fimRegistro);
    if (!r.form && prox && (kind === 'sem-posicao' || kind === 'off-map') && fim === baseDoRegistro(c, r) + 5 && prox.c === fim + 5 && c[prox.c - 1] !== 0 && (c[prox.c + 7] & 0x40))
      throw new Error(`registro ${r.nm} (id ${r.id}, tab 0x${r.tab.toString(16)}) parece uma formacao (contador de filhos = ${c[prox.c - 1]}) mas o parser nao o marca como tal: acrescente o tab a CABECA (regs.mjs)`);
    if (core) { rel.jaCore++; partes.push(c.subarray(r.c, prox ? prox.c : c.length)); if (!prox) break; continue; }
    const cabeca = Buffer.from(c.subarray(r.c, fim)); cabeca[11] &= ~0x01;
    const cauda = Buffer.alloc(7); cauda.writeUInt32LE(r.id, 0); cauda[4] = presente(r) ? 1 : 0; MARCA.copy(cauda, 5);
    rel.marcados++; rel.tipos[kind] = (rel.tipos[kind] || 0) + 1;
    if (kind === 'formacao') {
      // contador do primeiro filho: u32 em prox.c - 1 (byte baixo antes dos 3 zeros de cabeca)
      if (!prox) throw new Error(`formacao ${r.nm} (id ${r.id}) sem registro seguinte`);
      partes.push(cabeca, cauda, Buffer.from([0, 0, c[prox.c - 1]]));
      continue;
    }
    const regra = regraDeEnchimento(cauda, cauda.length);              // 6
    if (!prox) { partes.push(cabeca, cauda, c.subarray(fim + 2)); break; }  // ultimo: enchimento 5 -> 3 e o resto do bloco inteiro (o editor deixa 210 zeros onde o nao-core tem 212)
    if (fronteira) { partes.push(cabeca, cauda, Buffer.alloc(regra), Buffer.from([c[prox.c - 1]])); continue; }   // regra inteira e o K_verm
    partes.push(cabeca, cauda, Buffer.alloc(regra - 3));
  }
  if (!rel.marcados) { if (entrada !== saida) fs.copyFileSync(entrada, saida); return rel; }   // ja era core: nao reescreve (a recodificacao mudaria bytes a toa)
  const novo = Buffer.concat(partes);
  reconstruir(entrada, saida, (b, k) => (k === 1 ? codificarComoJogo(novo, X.d.esc) : b));
  return rel;
}

const EH_MAIN = process.argv[1] && /[\\/]core\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const [a, b] = process.argv.slice(2);
  if (!b) { console.log('uso: node core.mjs <entrada.btt> <saida.btt>'); process.exit(1); }
  console.log(JSON.stringify(marcarCore(a, b)));
}
