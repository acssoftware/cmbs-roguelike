// Dado o resultado em jogo de cada doador, procura QUAL propriedade separa perfeitamente os
// que copiam dos que travam. A serie ja matou tamanho, tokens, bytes, exercito, unidade de
// apoio, registro de fronteira de 256, posicao da emenda e total inserido — entao a resposta
// esta em alguma propriedade que eu ainda nao olhei. Em vez de continuar chutando uma por
// vez, calculo dezenas e deixo o computador achar as que dao corte limpo.
import { ler } from './transplante.mjs';
import { registros, indiceDeTokens, inicioDoRegistro, subArvore, contagemDeFilhos, especial } from './regs.mjs';

const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';

// id do doador -> passou no jogo?
// 33 doadores testados em jogo, um arquivo por vez, carregando pelo Scenario Editor.
export const RESULTADO = {
  35: true, 517: true, 972: true, 1124: true, 1367: true, 1716: true, 1989: true, 2426: true,
  2901: true, 3179: true, 3297: true, 3449: true, 3556: true, 3715: true, 4100: true,
  4245: true, 5325: true, 5369: true,
  177: false, 392: false, 609: false, 771: false, 1199: false, 1936: false, 2107: false,
  2266: false, 2627: false, 2785: false, 3135: false, 3969: false, 4392: false, 5137: false,
  5211: false,
};

const d = ler(S + 'ZZ QBSMALL ALL add manual 2.btt');
const cru = d.cru, porPos = indiceDeTokens(d.tokens);
const R = registros(cru).sort((a, b) => a.off - b.off);
const ini = (off) => inicioDoRegistro(cru, porPos, off).pos;

function filhos(i) {
  const n = contagemDeFilhos(cru, porPos, R, i);
  const out = [];
  let k = i + 1;
  for (let q = 0; q < n && k < R.length; q++) {
    const fim = R[k].form ? subArvore(cru, porPos, R, k) : k + 1;
    out.push({ i: k, fim, n: fim - k });
    k = fim;
  }
  return out;
}

function atributos(id) {
  const i = R.findIndex((x) => x.id === id);
  const fim = subArvore(cru, porPos, R, i);
  const regs = R.slice(i, fim);
  const a = ini(R[i].off), b = ini(R[fim].off);
  const toks = d.tokens.filter((t) => t.pos >= a && t.pos < b);
  const cab = R[i];
  const fs = filhos(i);
  const forms = regs.filter((x) => x.form);

  // sub-formacoes do mesmo tipo com tamanhos diferentes
  const porTipo = new Map();
  const pilha = [{ i, fim }];
  while (pilha.length) {
    const cur = pilha.pop();
    for (const f of filhos(cur.i)) {
      if (R[f.i].form) {
        const ch = R[f.i].tab + '/' + R[f.i].val;
        if (!porTipo.has(ch)) porTipo.set(ch, new Set());
        porTipo.get(ch).add(f.n);
        pilha.push({ i: f.i, fim: f.fim });
      }
    }
  }
  const tiposIrregulares = [...porTipo.values()].filter((s) => s.size > 1).length;

  const rar = regs.map((x) => cru[x.off + 14] & 0x0f);
  const tabs = new Set(regs.map((x) => x.tab));
  const codigos = new Set(toks.map((t) => t.cod));
  const comNome = regs.filter((x) => { const n = cru.readUInt16LE(x.off + 20); return n > 0 && n < 64; }).length;

  let prof = 0;
  const dep = (k, n) => { prof = Math.max(prof, n); for (const f of filhos(k)) if (R[f.i].form) dep(f.i, n + 1); };
  dep(i, 1);

  return {
    regs: regs.length, toks: toks.length, forms: forms.length, prof,
    filhosDiretos: fs.length,
    army: cab.army, tabCab: cab.tab, valCab: cab.val, rarCab: cru[cab.off + 14] & 0x0f,
    temEspecial: regs.some((x) => especial(porPos, x)) ? 1 : 0,
    tiposIrregulares,
    minRar: Math.min(...rar), nRarBaixa: rar.filter((r) => r !== 7).length,
    nTabs: tabs.size, comNome,
    ultimoEhFormacao: regs[regs.length - 1].form ? 1 : 0,
    primeiroFilhoEhFormacao: fs.length && R[fs[0].i].form ? 1 : 0,
    ...Object.fromEntries([0x00, 0x04, 0x05, 0x07, 0x0b, 0x0d, 0x0e, 0x0f, 0x18, 0x19, 0x1a]
      .map((t) => ['tab_' + t.toString(16), tabs.has(t) ? 1 : 0])),
    ...Object.fromEntries([0x03, 0x04, 0x05, 0x07, 0x08, 0x0a, 0x0b, 0x0c]
      .map((t) => ['cod_' + t.toString(16), codigos.has(t) ? 1 : 0])),
  };
}

const EH_MAIN = process.argv[1] && /separador.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
const dados = Object.entries(RESULTADO).map(([id, ok]) => ({ id: +id, ok, a: atributos(+id) }));
const chaves = Object.keys(dados[0].a);
console.log(`${dados.length} doadores: ${dados.filter((x) => x.ok).length} copiam, ${dados.filter((x) => !x.ok).length} travam\n`);

// um atributo separa perfeitamente se algum limiar (ou valor) parte os dois grupos
const achados = [];
for (const k of chaves) {
  const ok = dados.filter((x) => x.ok).map((x) => x.a[k]);
  const nao = dados.filter((x) => !x.ok).map((x) => x.a[k]);
  const maxOk = Math.max(...ok), minOk = Math.min(...ok);
  const maxNao = Math.max(...nao), minNao = Math.min(...nao);
  if (maxOk < minNao) achados.push(`${k}: copia quando <= ${maxOk}, trava a partir de ${minNao}`);
  else if (maxNao < minOk) achados.push(`${k}: trava quando <= ${maxNao}, copia a partir de ${minOk}`);
  else {
    const sOk = new Set(ok), sNao = new Set(nao);
    if (![...sOk].some((v) => sNao.has(v))) achados.push(`${k}: conjuntos disjuntos — copia em {${[...sOk].join(',')}}, trava em {${[...sNao].join(',')}}`);
  }
}
console.log(achados.length ? 'SEPARADORES PERFEITOS:' : 'nenhum atributo isolado separa os dois grupos');
achados.forEach((a) => console.log('   ' + a));

console.log('\ntabela completa:');
const cols = ['regs', 'toks', 'forms', 'prof', 'filhosDiretos', 'army', 'tabCab', 'rarCab', 'temEspecial', 'tiposIrregulares', 'minRar', 'nRarBaixa', 'nTabs', 'comNome'];
console.log('  id   res  ' + cols.map((c) => c.slice(0, 8).padStart(9)).join(''));
dados.sort((x, y) => (x.ok === y.ok ? x.id - y.id : x.ok ? -1 : 1)).forEach((x) => {
  console.log(String(x.id).padStart(5) + '  ' + (x.ok ? 'OK ' : 'X  ') + '  ' + cols.map((c) => String(x.a[c]).padStart(9)).join(''));
});
}
