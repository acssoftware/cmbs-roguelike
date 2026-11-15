// OS OBJETIVOS DE UMA BATALHA, E QUANTO VALEM (secao 114).
//
// O nivel de vitoria do CM nao compara os dois lados: compara o que voce fez com o que HAVIA para
// fazer. O app nao tinha esse denominador e lia toda batalha em que o inimigo zerava como Total
// Victory — foi a Major Victory de 500 a 0 do autor que abriu o caso (E26).
//
// O valor mora ao lado do nome, no bloco expandido:
//
//   ... | u16 PONTOS | u16 len | nome ascii | cor u32 | contagem u32 | contagem x (u32 x, u32 y)
//
// Conferido no gabarito do editor: `City North (Min VP)` vale 250 e `City South (Maj VP)` vale 500,
// e os dois numeros estao exatamente quatro bytes antes do nome.
import { abrirCompleto } from './anexar2.mjs';
import { lerGatilhos } from './gatilhos.mjs';

const NOME_OK = /^[\x20-\x7e]{3,48}$/;

// Todos os objetivos nomeados do arquivo, na ordem em que aparecem.
export function lerObjetivos(arquivo) {
  const b = abrirCompleto(arquivo).completo;
  const out = [];
  for (let p = 6; p + 8 < b.length; p++) {
    const pontos = b.readUInt16LE(p - 4);
    const len = b.readUInt16LE(p - 2);
    if (len < 3 || len > 48 || p + len + 8 > b.length) continue;
    const nome = b.toString('latin1', p, p + len);
    if (!NOME_OK.test(nome)) continue;
    // ANTES DOS PONTOS VEM O TIPO DO OBJETIVO (`00 | 02 | u16 pontos | u16 len | nome`), e sem
    // conferi-lo qualquer texto curto do arquivo com dois numeros pequenos antes vira objetivo: o
    // "Wr8" de 2 pontos (bytes dentro de uma lista de IA) e o "Khalmi" de 8195 pontos (o nome do
    // mapa) entraram assim, e o segundo pos 8895 pontos em jogo numa batalha que tinha 700 — o
    // veredito da batalha 5 da EASY-BECAUSE saiu com 4% de participacao por causa dele.
    if (b[p - 6] !== 0x00 || b[p - 5] < 0x01 || b[p - 5] > 0x05) continue;
    // Depois do nome vem a cor e a contagem de tiles; a contagem precisa ser plausivel, senao
    // qualquer texto do briefing entra na lista. Um mapa de 1600 x 1600 m tem 40.000 tiles.
    const tiles = b.readUInt32LE(p + len + 4);
    if (tiles < 1 || tiles > 40000) continue;
    if (pontos > 20000) continue;
    out.push({ pos: p, nome, pontos, tiles });
    p += len;
  }
  return out;
}

// O que estava em jogo para UM lado — o potencial do manual (p.89): "% dos pontos potenciais do
// vencedor". Medido no jogo (E92, FORMATO 123.2) com cessar-fogo em duas batalhas do app:
//   - cada lado tem a SUA lista (as 15 vagas dele) e o jogo nao casa nome entre as listas: no
//     City-Water o azul lista "Suburb Min VP)" e o vermelho "Suburb (Min VP)", cada um com os seus
//     tres objetivos. A uniao por nome que esta funcao fazia contava o erro de digitacao duas
//     vezes (1050 em vez de 600) — e so assim divergia em 4 mapas do pool;
//   - objetivo SEM TILE nao existe para o jogo: no Tiny Going to Town o azul tem o Overpass (200) e
//     quatro objetivos vazios "Known to Player" (500); com o Overpass na mao o AAR deu TOTAL, que e
//     200 de 200 — com os vazios seria 29%, Minor — e a lista de detalhes do AAR nem os mostra.
// `lado` e o do jogador: no app ele sempre ataca, e o atacante e o vermelho (FORMATO 68).
export function pontosDisponiveis(arquivo, lado = 'vermelho') {
  let lista = null;
  try { lista = lerGatilhos(arquivo).objetivos[lado]; } catch { /* arquivo que o caminhador de vagas nao le */ }
  if (lista) {
    // tipos 0..4 (Occupy, Preserve, Destroy, Touch, Exit) com tile; 5..8 sao triggers, sem ponto
    const validos = lista.filter((o) => o.tipo <= 4 && o.n > 0 && o.pontos > 0);
    const objetivos = validos.map((o) => ({ nome: o.nome, valores: [o.pontos], pontos: o.pontos }));
    return { objetivos, total: objetivos.reduce((a, o) => a + o.pontos, 0), ocorrencias: validos.length, lado, fonte: 'vagas' };
  }
  // O caminho antigo, para o que o caminhador nao ler: as duas listas unidas por nome.
  const todos = lerObjetivos(arquivo);
  const porNome = new Map();
  for (const o of todos) {
    if (!porNome.has(o.nome)) porNome.set(o.nome, []);
    porNome.get(o.nome).push(o.pontos);
  }
  const unicos = [...porNome].map(([nome, valores]) => ({ nome, valores, pontos: Math.max(...valores) }));
  return { objetivos: unicos, total: unicos.reduce((a, o) => a + o.pontos, 0), ocorrencias: todos.length, lado: null, fonte: 'nomes' };
}

const EH_MAIN = process.argv[1] && /[\\/]objetivos\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const f = process.argv[2];
  if (!f) { console.log('uso: node objetivos.mjs <batalha.btt>'); process.exit(1); }
  const r = pontosDisponiveis(f);
  console.log(`${r.objetivos.length} objetivos (${r.ocorrencias} ocorrencias no arquivo):`);
  for (const o of r.objetivos) console.log(`   ${String(o.pontos).padStart(5)} pts  ${o.nome}${o.valores.length > 1 ? `   (aparece como ${o.valores.join(', ')})` : ''}`);
  console.log(`   ${String(r.total).padStart(5)} pts  TOTAL em jogo`);
}
