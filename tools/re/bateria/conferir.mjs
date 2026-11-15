// AS CONFERENCIAS OFFLINE DA BATERIA (03/10). Monta cada caso numa pasta temporaria (lib.montar: os passos
// do createCampaign sem estado e sem as pastas do jogo), confere a batalha e a campanha e grava uma linha
// por caso em research/bateria/<run>/offline.jsonl. Retoma: caso ja conferido nao roda de novo.
//   node tools/re/bateria/conferir.mjs --run r1 [--familia A] [--limite 20] [--refazer]
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const arg = (k, padrao) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : padrao; };
const RUN = arg('--run'); if (!RUN) throw new Error('--run NOME');
const FAM = arg('--familia', null), LIMITE = Number(arg('--limite', 1e9)), REFAZER = process.argv.includes('--refazer');
const dir = path.join(L.DIR_BATERIA, RUN);
const { casos } = JSON.parse(fs.readFileSync(path.join(dir, 'casos.json'), 'utf8'));
const saida = path.join(dir, 'offline.jsonl');
const feitos = new Set(REFAZER ? [] : L.lerLinhas(saida).map((l) => l.id));

let n = 0;
const conta = {};
for (const caso of casos) {
  if (FAM && caso.familia !== FAM) continue;
  if (feitos.has(caso.id)) continue;
  if (n++ >= LIMITE) break;
  const entrada = caso.montar || { ...caso.criar, seed: caso.seed };
  const linha = { id: caso.id, familia: caso.familia, nome: caso.nome, t: new Date().toISOString() };
  let m = null;
  try {
    m = await L.montar(entrada);
    const btt = L.conferirBtt(m.bttOut), cam = L.conferirCam(m.camOut, m.coreOut);
    const v = L.veredito(btt, cam);
    Object.assign(linha, v, {
      mapa: m.mapa, onMap: m.onMap, preco: m.preco, defesa: m.defesa, tempos: m.tempos,
      volume: { registros: btt.registros, topos: btt.topos, bytesBtt: btt.bytes, bytesCam: cam.bytes, rosterBlocos: cam.roster?.blocos, rosterBytes: cam.roster?.bytesExp, homensNominais: cam.roster?.homens, blocoMax: cam.roster?.blocoMax, coreUnidades: cam.core?.unidades, corePresentes: cam.core?.presentes, mapaWxH: btt.mapa ? btt.mapa.W * btt.mapa.H : null, casas: btt.mapa?.casas },
      ia: btt.ia,
    });
  } catch (e) {
    Object.assign(linha, { veredito: e.esperado ? 'RECUSADO' : 'ERRO-APP', erros: [String(e.message).slice(0, 400)] });
  } finally {
    if (m?.dir) fs.rmSync(m.dir, { recursive: true, force: true });
  }
  L.escreverLinha(saida, linha);
  conta[linha.veredito] = (conta[linha.veredito] || 0) + 1;
  process.stdout.write(`${caso.id} ${linha.veredito}${linha.erros?.length ? ' — ' + linha.erros[0].slice(0, 120) : ''}\n`);
}
console.log(`\n${n} casos: ${JSON.stringify(conta)} -> ${saida}`);
