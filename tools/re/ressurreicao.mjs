// A MAQUINA DESTRUIDA VOLTA NA VAGA DELA (plano de reposicao na vaga, 28/09).
//
// O jogo nao poe em campo uma maquina cujo bloco no roster diz destruida (E63). O bloco de quem ja
// lutou carrega, depois da tripulacao, o trio `a | S | c | f32 | u32 n` (110.11) e mais `n` floats —
// o dano por subsistema do painel DAMAGE (E98) —, e um destroco fica com S = 1 para sempre: o do
// BMP-2M 32 da RUS1 esta byte a byte igual da batalha 1 ate a 3. Ate hoje o app contornava isso
// acordando um gemeo dormente em outra formacao; o autor quer o proprio veiculo de volta.
//
// Dois jeitos de curar, e a sessao de tela decide qual o jogo aceita:
//
//   'curar'     no lugar, mesmo tamanho: a = 0, S = 3 (OK), f32 = 1,0, os n floats de dano a zero.
//               A tripulacao do bloco fica — os vivos seguem, os mortos voltam pelo reforco.
//   'dormente'  o bloco volta a forma que tinha ANTES de lutar pela primeira vez: sem trio e sem
//               homens, como todo dormente do save (88 B num BMP-2M). E a forma que o jogo instancia
//               em toda compra, e ele cria a tripulacao nova ao por a unidade em campo. Os 15 bytes
//               de cabeca (core id, tipo, atributos) sao os do proprio destroco; o resto vem de um
//               dormente do mesmo tipo no mesmo save.
//
// So o roster e tocado. Conferencias da casa: mesma contagem de unidades, os outros blocos byte a
// byte iguais, e o bloco curado relido como esperado.
import fs from 'node:fs';
import { localizarRoster, lerRoster, expandirBloco, inicioDaCauda } from './roster.mjs';
import { codificarComoJogo } from './escape.mjs';
import { comprimirLiterais } from './lz.mjs';
import { estadoDoBloco } from './veiculo_estado.mjs';

const ASSINATURA = Buffer.from([0x05, 0x04, 0x03]);

// Os blocos do roster no buffer expandido, com as fronteiras que o `crescerRoster` usa: do cabecalho
// de um ao do seguinte; o do ultimo vai ate o inicio da cauda da lista (`inicioDaCauda`, o `u32 N` + N x u32 que
// fecha a lista). Ate 15/11 o ultimo ficava de fora; a UKR do pacote (b3) tinha o Ural destruido na ultima linha
// ("core 188 e o ultimo bloco do roster"). Sem a cauda achada, o ultimo continua recusado.
function blocos(exp, r) {
  const cauda = inicioDaCauda(exp, r.unidades.length ? r.unidades[r.unidades.length - 1].pos : 0);
  return r.unidades.map((u, k) => ({
    coreId: u.coreId, tipo: u.tipo, homens: u.soldados.length,
    ini: u.pos - 15, fim: k + 1 < r.unidades.length ? r.unidades[k + 1].pos - 15 : cauda,
  }));
}

export function ressuscitar(entrada, saida, coreIds, { modo = 'curar' } = {}) {
  if (!['curar', 'dormente'].includes(modo)) throw new Error(`modo ${modo}`);
  const loc = localizarRoster(entrada);
  const { exp, esc } = expandirBloco(loc.lz);
  const r = lerRoster(entrada);
  const bs = blocos(exp, r);
  const alvo = new Set(coreIds.map(Number));
  const relato = [];

  // Os pedacos do novo roster, em ordem, para o modo que muda tamanho.
  const partes = []; let cursor = 0;
  const novo = Buffer.from(exp);

  for (const b of bs) {
    if (!alvo.has(b.coreId)) continue;
    if (b.fim === null) throw new Error(`core ${b.coreId} e o ultimo bloco do roster: nao curo sem achar a cauda`);
    const bloco = exp.subarray(b.ini, b.fim);
    const e = estadoDoBloco(bloco);
    if (!e) throw new Error(`core ${b.coreId}: o bloco nao tem o estado de maquina (nunca lutou?)`);
    if (e.codigo === 3) throw new Error(`core ${b.coreId}: ja esta OK`);
    if (modo === 'curar') {
      const o = b.ini + e.off;
      novo[o] = 0; novo[o + 1] = 3;                   // a, S — o c fica como esta
      novo.writeFloatLE(1, o + 3);
      for (let k = 0; k < e.n; k++) novo.writeFloatLE(0, o + 11 + 4 * k);   // depois do u32 n
      relato.push({ coreId: b.coreId, modo, de: `S=${e.codigo}`, para: 'S=3', floats: e.n, bytes: bloco.length });
    } else {
      const d = bs.find((x) => x.tipo === b.tipo && x.coreId !== b.coreId && x.homens === 0 && x.fim !== null
        && !estadoDoBloco(exp.subarray(x.ini, x.fim)));
      if (!d) throw new Error(`core ${b.coreId}: nenhum dormente do tipo ${b.tipo} no save para servir de forma`);
      const forma = Buffer.concat([exp.subarray(b.ini, b.ini + 15), exp.subarray(d.ini + 15, d.fim)]);
      partes.push(exp.subarray(cursor, b.ini), forma);
      cursor = b.fim;
      relato.push({ coreId: b.coreId, modo, de: `S=${e.codigo}, ${bloco.length} B, ${b.homens} homens`, para: `${forma.length} B, sem homens`, doador: d.coreId });
    }
    alvo.delete(b.coreId);
  }
  if (alvo.size) throw new Error(`core ids fora do roster: ${[...alvo].join(', ')}`);

  const final = modo === 'curar' ? novo : Buffer.concat([...partes, exp.subarray(cursor)]);
  const comp = comprimirLiterais(codificarComoJogo(final, esc));
  const t4 = Buffer.alloc(4); t4.writeUInt32LE(comp.length);
  const orig = loc.anatomia.b;
  fs.writeFileSync(saida, Buffer.concat([orig.subarray(0, loc.pos), t4, comp, orig.subarray(loc.pos + 4 + loc.tam)]));

  // Conferencia no arquivo gravado.
  const r2 = lerRoster(saida);
  if (r2.unidades.length !== r.unidades.length) throw new Error(`o roster mudou de ${r.unidades.length} para ${r2.unidades.length} unidades`);
  const exp2 = expandirBloco(localizarRoster(saida).lz).exp;
  const bs2 = blocos(exp2, r2);
  const curados = new Set(coreIds.map(Number));
  for (let k = 0; k < bs.length; k++) {
    const a = bs[k], b = bs2[k];
    if (a.coreId !== b.coreId) throw new Error(`a ordem do roster mudou na posicao ${k}`);
    if (a.fim === null) continue;
    const va = exp.subarray(a.ini, a.fim), vb = exp2.subarray(b.ini, b.fim);
    if (curados.has(a.coreId)) {
      const e2 = estadoDoBloco(vb);
      if (modo === 'curar' && (!e2 || e2.codigo !== 3)) throw new Error(`core ${a.coreId}: relido sem S = 3`);
      if (modo === 'dormente' && (e2 || b.homens)) throw new Error(`core ${a.coreId}: relido ainda com estado ou homens`);
    } else if (!va.equals(vb)) throw new Error(`core ${a.coreId} mudou sem ter sido pedido`);
  }
  return { modo, curados: relato };
}

const EH_MAIN = process.argv[1] && /[\\/]ressurreicao\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const [entrada, saida, ids, modo] = process.argv.slice(2);
  if (!entrada || !saida || !ids) { console.log('uso: node tools/re/ressurreicao.mjs <save.bts> <saida.bts> <coreId,coreId> [curar|dormente]'); process.exit(1); }
  console.log(JSON.stringify(ressuscitar(entrada, saida, ids.split(',').map(Number), { modo: modo || 'curar' }), null, 1));
}
