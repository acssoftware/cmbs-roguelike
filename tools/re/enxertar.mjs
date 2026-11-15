// Enxerta uma FORMACAO INTEIRA vinda de outro arquivo.
//
// Depois de provado que inserir registro funciona (secao 11 do FORMATO.md), esta e a
// operacao geral: em vez de acrescentar uma unidade a uma formacao existente, cola-se a
// sub-arvore de uma formacao inteira — cabecalho e filhos — copiada de outro cenario.
//
// Duas coisas tornam isso possivel:
//   - a nacionalidade viaja no proprio indice do tipo. Os indices nao se sobrepoem entre
//     exercitos em NENHUMA tabela de formacao ou infantaria (0x19, 0x1a, 0x04, 0x0d, 0x0e,
//     0x0f: zero em comum). Entao a formacao copiada chega ja sabendo de que exercito e.
//   - nao ha contador global (secao 11). O unico ajuste e somar 1 ao contador da mae, porque
//     ela ganha UM filho direto; os filhos da formacao enxertada sao contados por ela mesma.
//
// TRES ARMADILHAS, todas descobertas na marra:
//   1. O registro comeca em offsetReg, nao em offset. Alguns registros intercalam um u32
//      antes do id (os Headquarters Team, no ZZ CONTA A), e ai offset = offsetReg + 4. Cortar
//      o trecho ou reescrever o prefixo por offset corta o cabecalho no meio.
//   2. O PREFIXO do registro nao e constante do formato: muda de arquivo para arquivo (0x47
//      no ZZ RU ALL, 0x3d no ZZ CONTA A). Toda copia tem de ser reescrita para o destino.
//   3. O contador de filhos so esta em +27 nos registros SEM nome customizado. Num registro
//      com nome — "Easy Company" — o nome ocupa essa regiao e +27 devolve lixo. Por isso a
//      mae escolhida tem de ser uma formacao sem nome.
import fs from 'fs';
import { analisar, blocoUnidades, detectarPrefixo } from './unidades.mjs';
import { reconstruir } from './rebuild.mjs';

const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';
const CABECA = new Set([0x19, 0x0b, 0x1a, 0x18]);

function registros(arquivo) {
  const bl = blocoUnidades(S + arquivo);
  const r = analisar(S + arquivo);
  const vis = new Set(); const lista = [];
  r.unidades.filter((x) => x.offset + 32 <= bl.length).sort((a, b) => a.offsetReg - b.offsetReg)
    .forEach((x) => { if (vis.has(x.offsetReg)) return; vis.add(x.offsetReg); lista.push(x); });
  lista.forEach((x) => { x.tab = bl[x.offset + 18]; });
  return { bl, lista, prefixo: detectarPrefixo(bl).prefixo };
}

// Onde termina a sub-arvore de uma formacao. "Ate o proximo cabecalho" esta ERRADO: os anexos
// da formacao-avo (morteiro de 60mm, drone) vem depois dos filhos dela e antes do proximo
// cabecalho, e entravam na copia por engano — no ZZ CONTA A isso arrastava 11 registros para
// um pelotao de 8 filhos. A fonte autoritativa e o contador +27 da propria formacao, andando
// em pre-ordem e descendo quando um filho for outra formacao.
function fimSubArvore(lista, bl, i) {
  const n = bl.readUInt32LE(lista[i].offset + 27);
  if (!(n > 0 && n < 200)) throw new Error(`formacao ${lista[i].id}: contador ${n} implausivel (tem nome customizado?)`);
  let k = i + 1;
  for (let c = 0; c < n && k < lista.length; c++) {
    k = CABECA.has(lista[k].tab) ? fimSubArvore(lista, bl, k) : k + 1;
  }
  return k;
}

export function enxertar({ origem, formacaoId, destino, maeId, antesDoId, ligar = [], saida, idBase = 500 }) {
  const O = registros(origem), D = registros(destino);

  const i = O.lista.findIndex((x) => x.id === formacaoId);
  if (i < 0) throw new Error(`formacao ${formacaoId} nao achada em ${origem}`);
  const fim = fimSubArvore(O.lista, O.bl, i);
  const ini = O.lista[i].offsetReg;
  const fimBytes = fim < O.lista.length ? O.lista[fim].offsetReg : O.bl.length;
  const trecho = Buffer.from(O.bl.subarray(ini, fimBytes));

  // O prefixo NAO aparece so no inicio de cada registro: as sub-estruturas dentro dele usam a
  // mesma marca. Num pelotao de 9 registros o padrao <prefixo><tam>00 aparece 20 vezes — 9
  // inicios e 11 internas. Reescrever so os inicios deixava as 11 apontando para o prefixo do
  // arquivo de ORIGEM, e o jogo travava ao abrir. Foi exatamente por isso que a copia dentro
  // do mesmo arquivo funcionou e as duas copias entre arquivos nao: la origem e destino tem o
  // mesmo prefixo e o erro era inofensivo.
  let trocadas = 0;
  if (O.prefixo !== D.prefixo) {
    for (let p = 0; p + 3 <= trecho.length; p++) {
      if (trecho[p] === O.prefixo && trecho[p + 1] >= 1 && trecho[p + 1] <= 16 && trecho[p + 2] === 0) {
        trecho[p] = D.prefixo; trocadas++;
      }
    }
  }
  O.lista.slice(i, fim).forEach((x, j) => {
    trecho[x.offsetReg - ini] = D.prefixo;
    trecho.writeUInt32LE(idBase + j, x.offset + 3 - ini);
  });

  const mae = D.lista.find((x) => x.id === maeId);
  if (!mae) throw new Error(`mae ${maeId} nao achada em ${destino}`);
  const filhos = D.bl.readUInt32LE(mae.offset + 27);
  if (!(filhos > 0 && filhos < 200)) throw new Error(`contador da mae ${maeId} = ${filhos}: ela tem nome customizado, escolha outra`);

  const alvo = D.lista.find((x) => x.id === antesDoId);
  if (!alvo) throw new Error(`ancora ${antesDoId} nao achada em ${destino}`);
  const emenda = alvo.offsetReg;
  if (emenda <= mae.offset) throw new Error('a ancora tem de vir depois da mae');

  reconstruir(S + destino, S + saida, (bloco, idx) => {
    if (idx !== 1) return bloco;
    const c0 = Buffer.from(bloco);
    c0.writeUInt32LE(filhos + 1, mae.offset + 27);          // a mae ganha UM filho direto
    for (const id of ligar) {                               // torna presentes os registros pedidos
      const x = D.lista.find((y) => y.id === id);
      if (!x) throw new Error(`id ${id} nao achado para ligar`);
      c0[x.offset + 7] &= ~0x80;
    }
    return Buffer.concat([c0.subarray(0, emenda), trecho, c0.subarray(emenda)]);
  });

  const novo = blocoUnidades(S + saida);
  if (novo.length !== D.bl.length + trecho.length)
    throw new Error(`tamanho inesperado: ${novo.length} vs ${D.bl.length + trecho.length}`);
  return { n: fim - i, bytes: trecho.length, emenda, filhos, trocadas, po: O.prefixo, pd: D.prefixo };
}

const EH_MAIN = process.argv[1] && /[\\/]enxertar\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  // Pelotao de fuzileiros russo (HQ, PKM, sniper, 3 esquadras, 3 BMP-3M) enxertado como IRMAO
  // dos pelotoes americanos, dentro da Company (Rifle) id 249 — que esta sem nome, tem
  // contador legivel e e ligada junto para que a arvore mostre o resultado.
  const r = enxertar({
    origem: 'ZZ RU ALL.btt', formacaoId: 73,
    destino: 'ZZ CONTA A.btt', maeId: 249, antesDoId: 254, ligar: [249],
    saida: 'ZZ ENXERTO.btt',
  });
  console.log('ZZ ENXERTO.btt gerado');
  console.log(`   ${r.n} registros (${r.bytes} bytes) copiados do Platoon (Rifle) russo`);
  console.log(`   prefixo 0x${r.po.toString(16)} -> 0x${r.pd.toString(16)} | emenda no offset ${r.emenda}`);
  console.log(`   mae id 249: ${r.filhos} -> ${r.filhos + 1} filhos, e ligada para aparecer na arvore`);
}
