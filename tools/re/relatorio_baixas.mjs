// RELATORIO DE BAIXAS por equipe (secao 100): le um save e escreve a tabela de como cada equipe
// terminou — homens, baixas, turno de cada baixa, equipes aniquiladas.
//
//   node relatorio_baixas.mjs "<save.bts | nome na pasta Saved Games>" [saida.md]
import fs from 'node:fs';
import { lerSave, soldados, equipes } from './saves.mjs';

const SV = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/';

export function relatorio(completo, titulo) {
  const S = soldados(completo), E = equipes(completo, S); const L = [];
  L.push(`# ${titulo}`, '');
  L.push('Baixas lidas pela insercao de 4 bytes no registro + instante do ferimento (secao 100),');
  L.push('conferido contra seis AAR. Morto x ferido x desaparecido o CM decide no fim da partida e');
  L.push('NAO esta no arquivo: as colunas abaixo sao baixa e turno.');
  for (const lado of ['RU', 'US', '?']) {
    const T = E.filter((e) => e.lado === lado); if (!T.length) continue;
    const h = T.reduce((t, e) => t + e.n, 0), b = T.reduce((t, e) => t + e.baixas, 0);
    L.push('', `## ${lado} — ${T.length} equipes, ${h} homens, ${b} baixas (${T.filter((e) => e.aniquilado).length} aniquiladas)`, '');
    L.push('| equipe | homens | baixas | turnos | homens (baixa*) |', '|---|---|---|---|---|');
    for (const e of T) L.push(`| ${e.id}${e.aniquilado ? ' **X**' : ''} | ${e.n} | ${e.baixas} | ${e.turnos.join(', ') || '-'} | ` +
      e.homens.map((s) => s.nome + (s.baixa ? `*T${s.turnoHit}` : '') + (s.semMarcador ? ' [sem marcador]' : '')).join(', ') + ' |');
  }
  L.push('', '**X** = equipe aniquilada (bit 0x80 no cabecalho do time). `[sem marcador]` = baixa cujo registro nao');
  L.push('termina com `07 xx yy 00`; no save final da TESTE 2 essas quatro sao as que o AAR conta como desaparecidas.');
  return L.join('\n');
}

const EH_MAIN = process.argv[1] && /[\\/]relatorio_baixas\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const [alvo, saida] = process.argv.slice(2);
  if (!alvo) { console.log('uso: node relatorio_baixas.mjs <save.bts | nome> [saida.md]'); process.exit(1); }
  const f = /[\\/]/.test(alvo) ? alvo : SV + alvo + (/\.bts$/i.test(alvo) ? '' : '.bts');
  const sv = lerSave(f); const txt = relatorio(sv.completo, `${sv.nome} — como cada equipe terminou`);
  if (saida) { fs.writeFileSync(saida, txt); console.log('escrito', saida); } else console.log(txt);
}
