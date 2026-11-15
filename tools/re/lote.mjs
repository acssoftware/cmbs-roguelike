// Gera um lote de mapeamento: escreve valores de +17 nos slots de uma tabela (+18)
// do cenario de ensaio, e registra o plano para leitura posterior da captura.
import fs from 'fs';
import { analisar, blocoUnidades } from './unidades.mjs';
import { reconstruir } from './rebuild.mjs';

const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';
const ENSAIO = 'ZZ CAV.btt';
const PROG = '../../research/progresso_mapeamento.json';

function progresso() {
  try { return JSON.parse(fs.readFileSync(PROG, 'utf8')); }
  catch (_) { return { mapeados: {}, lotes: [] }; }
}

// Ordem de PREENCHIMENTO dos slots. Em ZZ CAV.btt a arvore mostra, no estado padrao,
// apenas os slots 0,1,2,3,4,8 (linhas A..F); os demais ficam dentro de nos fechados.
// Os pendentes vao primeiro para esses, para que uma captura sem expandir nada ja renda seis.
export const ORDEM_LEITURA = [0, 1, 2, 3, 4, 8, 5, 6, 7, 9, 10, 11, 12];

export function gerarLote(tabela, valores, nome) {
  const r = analisar(S + ENSAIO);
  const bl = blocoUnidades(S + ENSAIO);
  const cont = {}; r.unidades.forEach((x) => { cont[x.id] = (cont[x.id] || 0) + 1; });
  const slots = r.unidades
    .filter((x) => x.tam >= 7 && cont[x.id] === 1 && x.offset + 19 <= bl.length && bl[x.offset + 18] === tabela)
    .sort((a, b) => a.offset - b.offset);
  const usar = Math.min(slots.length, valores.length);
  const plano = [];
  reconstruir(S + ENSAIO, S + nome, (bloco, i) => {
    if (i !== 1) return bloco;
    const c = Buffer.from(bloco);
    for (let k = 0; k < usar; k++) {
      const s = ORDEM_LEITURA[k];
      c[slots[s].offset + 17] = valores[k];
      plano.push({ slot: s, linha: 'ABCDEF'[k] || null, id: slots[s].id, tabela,
                   antes: bl[slots[s].offset + 17], escrito: valores[k] });
    }
    return c;
  });
  const p = progresso();
  p.lotes.push({ arquivo: nome, tabela, quando: new Date().toISOString(), plano });
  fs.writeFileSync(PROG, JSON.stringify(p, null, 1));
  return { slots: slots.length, usados: usar, plano };
}

const EH_MAIN = process.argv[1] && /[\\/]lote\.mjs$/.test(process.argv[1]);
if (EH_MAIN && process.argv[2]) {
  const tabela = parseInt(process.argv[2], 16);
  const pares = JSON.parse(fs.readFileSync('../../research/cmbs_pares_tipo.json', 'utf8'));
  const suf = '/' + tabela.toString(16).padStart(2, '0');
  // Os valores observados nos cenarios de fabrica vem primeiro (mais provaveis de serem
  // validos); depois disso a fila continua com o resto da faixa 0x00..0xff. ZZ CAV.btt usa
  // 0x90, que nao aparece em nenhum cenario de fabrica — a tabela e maior que o observado.
  const vistos = pares.filter((p) => p.par.endsWith(suf))
    .map((p) => parseInt(p.par.split('/')[0], 16)).sort((a, b) => a - b);
  const resto = [];
  for (let v = 0; v < 256; v++) if (!vistos.includes(v)) resto.push(v);
  const todos = [...vistos, ...resto];
  // Conta como feito: o valor ja LIDO numa captura, e o valor RESERVADO — o que ja foi
  // gravado numa linha visivel (A..F) de um lote ainda nao lido. Assim da para gerar varios
  // lotes seguidos sem repetir valor. Os slots ocultos nao reservam: voltam para a fila.
  const pr = progresso();
  const chave = '0x' + tabela.toString(16).padStart(2, '0');
  const feitos = new Set(pr.lidos?.[chave] || []);
  // descartados: provados invalidos pelo teste de ida-e-volta. crash_candidatos: sob
  // investigacao a parte — nao entram em lote normal para nao derrubar o arquivo inteiro.
  (pr.descartados?.[chave] || []).forEach((v) => feitos.add(v));
  (pr.crash_candidatos?.[chave] || []).forEach((v) => feitos.add(v));
  pr.lotes.filter((l) => l.tabela === tabela)
    .forEach((l) => l.plano.forEach((x) => { if (x.linha) feitos.add(x.escrito); }));
  const pendentes = todos.filter((v) => !feitos.has(v));
  const nome = `ZZ LOTE T${tabela.toString(16)}-${String(progresso().lotes.length + 1).padStart(2, '0')}.btt`;
  const r = gerarLote(tabela, pendentes, nome);
  console.log(`${nome}\n`);
  console.log(`tabela 0x${tabela.toString(16)}: ${vistos.length} vistos nos cenarios + ${resto.length} nao vistos | ${pendentes.length} pendentes | ${r.slots} slots`);
  console.log(`\nescrito neste lote (${r.usados} valores), na ordem da arvore:\n`);
  r.plano.forEach((p) => console.log(`   ${p.linha ? 'linha ' + p.linha + ' ' : '  oculto '} slot ${String(p.slot).padStart(2)}   0x${p.antes.toString(16).padStart(2, '0')} -> 0x${p.escrito.toString(16).padStart(2, '0')}`));
  console.log(`\nfaltarao ${pendentes.length - r.usados} valores nesta tabela apos esta rodada`);
}
