// ATRIBUTO POR UNIDADE, pelo CORE ID (secao 112.13).
//
// `atributos.aplicar` escreve numa formacao inteira, que e o que o editor faz ao clicar no titulo
// dela. O jogador quer escolher esquadrao a esquadrao — e a secao 110.3 ja tinha mostrado que o
// efetivo so funciona por UNIDADE, nunca pelo registro da formacao. Entao a lista de alvos aqui e
// de CORE IDs, que e como o app conhece cada unidade da forca do jogador e a unica chave que
// sobrevive ao rebuild da forca core.
//
//   aplicarPorCoreId(entrada, saida, { 12: { experiencia: 'Veteran' }, 13: { experiencia: 'Crack' } })
//
// A escrita e a mesma do `desmontar`: mexe no buffer expandido e regrava com `codificarComoJogo`,
// com conferencia no arquivo GRAVADO — o numero de registros nao pode mudar e todo alvo tem de
// estar com o valor pedido.
import { codificarComoJogo } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';
import { abrirCompleto } from './anexar2.mjs';
import { fimDoConteudo } from './core.mjs';
import { escreverCampos, decodificar } from './atributos.mjs';

// Percorre os registros com cauda core e devolve [{ r, coreId, off }].
function unidadesCore(X) {
  const c = X.completo; const out = [];
  for (let k = 0; k < X.R.length; k++) {
    const r = X.R[k];
    if (r.form) continue;
    let i; try { i = fimDoConteudo(c, r, X.R[k + 1] ? X.R[k + 1].c : c.length); } catch { continue; }
    if (!i.core) continue;
    out.push({ r, off: r.c, coreId: c.readUInt32LE(i.fim) });
  }
  return out;
}

export function aplicarPorCoreId(entrada, saida, alvos) {
  const pedidos = alvos instanceof Map ? alvos : new Map(Object.entries(alvos).map(([k, v]) => [Number(k), v]));
  if (!pedidos.size) return { mudou: false, escritos: 0, semDono: [] };

  const X = abrirCompleto(entrada);
  const novo = Buffer.from(X.completo);
  const unidades = unidadesCore(X);
  const achados = new Set();
  const escritos = [];
  for (const u of unidades) {
    const campos = pedidos.get(u.coreId);
    if (!campos) continue;
    achados.add(u.coreId);
    const antes = decodificar(novo, u.off);
    escreverCampos(novo, u.off, campos);
    const agora = decodificar(novo, u.off);
    escritos.push({ coreId: u.coreId, nome: u.r.nm, antes, agora });
  }
  const semDono = [...pedidos.keys()].filter((id) => !achados.has(id));
  if (semDono.length) throw new Error(`core ids que nao existem nesta forca: ${semDono.slice(0, 8).join(', ')}`);
  if (!escritos.length) return { mudou: false, escritos: 0, semDono };

  reconstruir(entrada, saida, (b, k) => (k === 1 ? codificarComoJogo(novo, X.d.esc) : b));

  // Conferencia no arquivo GRAVADO, nunca no planejado.
  const V = abrirCompleto(saida);
  if (V.R.length !== X.R.length) throw new Error(`a escrita quebrou o arquivo: ${X.R.length} registros viraram ${V.R.length}`);
  const porId = new Map(unidadesCore(V).map((u) => [u.coreId, decodificar(V.completo, u.off)]));
  for (const e of escritos) {
    const lido = porId.get(e.coreId);
    if (!lido) throw new Error(`o core id ${e.coreId} sumiu do arquivo gravado`);
    for (const campo of Object.keys(pedidos.get(e.coreId))) {
      if (lido[campo] !== e.agora[campo]) throw new Error(`core ${e.coreId}: pedi ${campo}=${e.agora[campo]} e o arquivo gravado diz ${lido[campo]}`);
    }
  }
  return { mudou: true, escritos: escritos.length, semDono, registros: V.R.length, exemplos: escritos.slice(0, 5) };
}

const EH_MAIN = process.argv[1] && /[\\/]experiencia\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const [entrada, saida, ...pares] = process.argv.slice(2);
  if (!saida) { console.log('uso: node experiencia.mjs <entrada.btt> <saida.btt> <coreId=Valor> ...'); process.exit(1); }
  const alvos = Object.fromEntries(pares.map((p) => {
    const [id, v] = p.split('=');
    return [Number(id), { experiencia: v }];
  }));
  const r = aplicarPorCoreId(entrada, saida, alvos);
  console.log(`${r.escritos} unidades escritas em ${r.registros} registros`);
  for (const e of r.exemplos) console.log(`   core ${e.coreId} ${e.nome}: ${e.antes.experiencia} -> ${e.agora.experiencia}`);
}
