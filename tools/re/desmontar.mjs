// DESMONTAR a infantaria de um lado, do jeito que o editor desmonta (secao 112.11).
//
// autor: o CMBS posiciona bem o veiculo e larga a infantaria embaixo dele — exposta, sem cobertura
// e sem emboscar. Desmontada no setup, ela ja comeca onde deve estar.
//
// A regra saiu de um gabarito: o mesmo pelotao de engenheiros salvo montado e desmontado no editor.
//
//   registro       +15                        +11
//   formacao       0x60 (OK) -> 0x80          bit 0 APAGADO
//   unidade a pe   0x60 -> 0x80               intocado
//   veiculo        intocado                   intocado
//
// As duas mudancas sao necessarias: escrever so o `+15` nao funciona (E19), e mexer so no `+11`
// tambem nao (E16). A formacao leva as duas; a infantaria, so a primeira.
//
// `aPe(nome, categoria)` decide quem anda a pe — o app passa o seu proprio papel de unidade, e sem
// ele vale um criterio de nome. O veiculo NUNCA e tocado: um BMP desmontado nao quer dizer nada.
import { codificarComoJogo } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';
import { abrirCompleto } from './anexar2.mjs';
import { arvore } from './extras.mjs';

const DESMONTADO = 0x80;              // 4 << 5, o valor `Dismounted` do Vehicle Status
const FORA = new Set([0x50, 0x58, 0x60]);   // off-map e ponto de referencia: nao entram
// Sem um classificador de fora, isto e o que se reconhece como tropa a pe pelo nome.
const NOME_A_PE = /Squad|Team|Section|Sniper|Scout|Crew|Gruppe|Esquadr/i;

export function desmontar(entrada, saida, lado = 'azul', { aPe } = {}) {
  const X = abrirCompleto(entrada);
  const c = X.completo;
  const novo = Buffer.from(c);

  const ehAPe = (n) => {
    if (n.r.form) return false;
    const cat = c[n.r.c + 12];
    if (FORA.has(cat) || FORA.has(cat & 0x7f)) return false;   // off-map nao desmonta
    return aPe ? !!aPe(n.r.nm || '', cat) : NOME_A_PE.test(n.r.nm || '');
  };
  const temAPeAbaixo = (n) => (ehAPe(n) ? true : n.filhos.some(temAPeAbaixo));

  const feito = { unidades: [], formacoes: [], veiculos: 0 };
  const anda = (n) => {
    if (ehAPe(n)) {
      novo[n.r.c + 15] = (novo[n.r.c + 15] & 0x1f) | DESMONTADO;
      feito.unidades.push(n.r.nm);
    } else if (n.r.form && temAPeAbaixo(n)) {
      novo[n.r.c + 15] = (novo[n.r.c + 15] & 0x1f) | DESMONTADO;
      novo[n.r.c + 11] &= ~0x01;
      feito.formacoes.push(n.r.nm);
    } else if (!n.r.form) feito.veiculos++;
    n.filhos.forEach(anda);
  };
  (arvore(X)[lado] || []).forEach(anda);

  if (!feito.unidades.length) { return { ...feito, mudou: false }; }
  reconstruir(entrada, saida, (b, k) => (k === 1 ? codificarComoJogo(novo, X.d.esc) : b));

  // Conferencia no arquivo GRAVADO, nunca no planejado: o numero de registros nao pode mudar, e o
  // que devia ficar desmontado tem de estar desmontado.
  const V = abrirCompleto(saida);
  if (V.R.length !== X.R.length) throw new Error(`desmontar quebrou o arquivo: ${X.R.length} registros viraram ${V.R.length}`);
  let conferidos = 0;
  const anda2 = (n) => { if ((V.completo[n.r.c + 15] >> 5) === 4) conferidos++; n.filhos.forEach(anda2); };
  (arvore(V)[lado] || []).forEach(anda2);
  const esperado = feito.unidades.length + feito.formacoes.length;
  if (conferidos !== esperado) throw new Error(`desmontar gravou ${conferidos} registros e esperava ${esperado}`);

  return { ...feito, mudou: true, registros: V.R.length };
}

const EH_MAIN = process.argv[1] && /[\\/]desmontar\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const [entrada, saida, lado] = process.argv.slice(2);
  if (!saida) { console.log('uso: node desmontar.mjs <entrada.btt> <saida.btt> [azul|vermelho]'); process.exit(1); }
  const r = desmontar(entrada, saida, lado || 'azul');
  console.log(`${r.unidades.length} unidades a pe e ${r.formacoes.length} formacoes desmontadas; ${r.veiculos} veiculos intocados`);
}
