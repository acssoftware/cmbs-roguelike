// THE BRIDGE TO `tools/re`.
//
// `tools/re` is the reverse-engineering library: every byte the app writes into a game file goes
// through it, and every one of those routines was proven by loading the result in the game. It is
// written in Portuguese and it is NOT translated here — renaming proven code to make an app read
// nicer is a bad trade. This module is the only place that speaks to it, so the rest of the app
// stays in one language and one vocabulary.
//
// It must also be the FIRST of the two to load: `gerar_batalha.mjs` resolves the game folder once,
// at load time, from CMBS_GAME_FILES. Hence the explicit `await import` after setting the variable
// — a static import would be hoisted above the assignment and silently use the default path.
import fs from 'node:fs';
import path from 'node:path';
import { GAME_FILES, REPO_DIR, ASSETS_DIR, RESEARCH_DIR } from './settings.mjs';

// THE APP IS NOT THE `app` FOLDER. It needs three siblings: `tools/re` for every byte it writes,
// `assets` for the formations and the maps, `research` for the generator's tables. Copy `app`
// alone and node stops on `ERR_MODULE_NOT_FOUND` with a stack trace that names an internal loader
// and not the thing that is actually wrong — which is what happened to the author. Checked here, before
// the first import of the library, so the answer is the first thing on screen.
{
  const precisa = [
    { caminho: path.join(REPO_DIR, 'tools', 're', 'gerar_batalha.mjs'), pasta: 'tools\\re', porque: 'writes and reads every game file' },
    { caminho: path.join(ASSETS_DIR, 'lib'), pasta: 'assets\\lib', porque: 'the formations you can buy' },
    { caminho: path.join(ASSETS_DIR, 'qb_attack'), pasta: 'assets\\qb_attack', porque: 'the map pool' },
    { caminho: path.join(ASSETS_DIR, 'campaign_template_red.cam'), pasta: 'assets', porque: 'the header cloned into every campaign' },
    { caminho: path.join(RESEARCH_DIR, 'tipos_roster.json'), pasta: 'research', porque: "the generator's data tables" },
  ];
  // A missing top-level folder is reported as itself; naming three things inside `assets` when
  // `assets` is what is absent only makes the message longer.
  const topo = { tools: path.join(REPO_DIR, 'tools'), assets: ASSETS_DIR, research: RESEARCH_DIR };
  const semTopo = Object.entries(topo).filter(([, p]) => !fs.existsSync(p)).map(([n]) => n);
  const faltando = precisa
    .filter((x) => !fs.existsSync(x.caminho))
    .filter((x) => !semTopo.includes(x.pasta.split('\\')[0]));

  if (semTopo.length || faltando.length) {
    const itens = [
      ...semTopo.map((n) => [n, { tools: 'writes and reads every game file', assets: 'the formations, the maps and the campaign template', research: "the generator's data tables" }[n]]),
      ...faltando.map((x) => [x.pasta, x.porque]),
    ];
    console.error([
      '',
      '  The app is missing part of itself.',
      '',
      `  It is running from   ${path.join(REPO_DIR, 'app')}`,
      '  and it needs these NEXT TO `app`, which are not there:',
      '',
      ...itens.map(([n, porque]) => `      ${n.padEnd(20)}  ${porque}`),
      '',
      '  Copy the WHOLE downloaded folder, not just `app`. Beside `app` there must be',
      '  `tools`, `assets` and `research`.',
      '',
    ].join('\n'));
    process.exit(1);
  }
}

process.env.CMBS_GAME_FILES = GAME_FILES;

const gerarBatalha = await import('../../tools/re/gerar_batalha.mjs');
const tipoBatalha = await import('../../tools/re/tipo_batalha.mjs');
const briefing = await import('../../tools/re/briefing.mjs');
const cabecalhoLista = await import('../../tools/re/ext.mjs');
const rosterCam = await import('../../tools/re/roster_cam.mjs');
const pecas = await import('../../tools/re/pecas.mjs');
const roster = await import('../../tools/re/roster.mjs');
const removerMod = await import('../../tools/re/remover.mjs');
const desmontarMod = await import('../../tools/re/desmontar.mjs');
const rumoMod = await import('../../tools/re/rumo.mjs');
const experienciaMod = await import('../../tools/re/experiencia.mjs');
const toe = await import('../../tools/re/toe_armas.mjs');
const toeVeic = await import('../../tools/re/toe_veiculos.mjs');
const armasMun = await import('../../tools/re/armas_municao.mjs');
const granadas = await import('../../tools/re/granadas.mjs');
const atributos = await import('../../tools/re/atributos.mjs');
const cam = await import('../../tools/re/cam.mjs');
const acrescentar = await import('../../tools/re/acrescentar.mjs');
const core = await import('../../tools/re/core.mjs');
const podar = await import('../../tools/re/podar.mjs');
const dividir = await import('../../tools/re/dividir.mjs');
const extras = await import('../../tools/re/extras.mjs');
const anexar2 = await import('../../tools/re/anexar2.mjs');
const lados = await import('../../tools/re/lados.mjs');
const ia = await import('../../tools/re/ia.mjs');
const mapa = await import('../../tools/re/mapa.mjs');
const mapaEscrever = await import('../../tools/re/mapa_escrever.mjs');
const objetivos = await import('../../tools/re/objetivos.mjs');
const veiculoEstado = await import('../../tools/re/veiculo_estado.mjs');
const blocos = await import('../../tools/re/blocos.mjs');
const enxerto = await import('../../tools/re/enxerto.mjs');
const abates = await import('../../tools/re/abates.mjs');
const ressurreicao = await import('../../tools/re/ressurreicao.mjs');
const fabrica = await import('../../tools/re/fabrica.mjs');

export const generateBattle = gerarBatalha.gerar;            // (spec, out) -> writes a .btt
export const NATION_CODE = gerarBatalha.NACAO;               // { US: 1, RU: 2, UKR: 3 }
export const readNations = gerarBatalha.lerNacoes;
export const readDuration = gerarBatalha.lerDuracao;   // cabecalho e a copia de dentro (FORMATO 50)
export const writeDuration = gerarBatalha.escreverDuracao;   // o relogio, para a habilidade do plano 2
export const writeExtraTime = gerarBatalha.escreverTempoExtra;   // o Variable Extra Time, so na copia de dentro (28/09)
export const writeIntel = gerarBatalha.escreverIntel;             // Early Intel (lado) e Intel Strength (%) da aba Data (17/10)
export const readIntel = gerarBatalha.lerIntel;
export const writeEW = gerarBatalha.escreverEW;                   // Blue/Red Electronic Warfare Strength, no cabecalho da forca (17/10)
export const readEW = gerarBatalha.lerEW;
export const writeHour = gerarBatalha.escreverHora;               // a hora da batalha (minutos desde 00:00), nos dois lugares (17/10)
export const readHour = gerarBatalha.lerHora;
export const writeDate = gerarBatalha.escreverData;               // mes, dia e hora do cabecalho de data, nos dois lugares (17/10)
export const readDate = gerarBatalha.lerData;
export const writeWeather = gerarBatalha.escreverClima;           // weather, vento, temperatura e chao (17/10)
export const readWeather = gerarBatalha.lerClima;
export const writeDaylight = tipoBatalha.escreverLuz;             // o rotulo Daylight (Dawn/Day/Dusk/Night), coerente com a hora
export const writeTitle = tipoBatalha.escreverTitulo;          // o titulo do briefing, de qualquer tamanho (28/09)
export const writeBriefing = briefing.escrever;               // as seis secoes de cada lado, no bloco 0 (28/09)
export const readBriefing = briefing.ler;
export const writeBriefingImages = briefing.escreverImagens;  // as 6 imagens do briefing, BMP 24 bits (17/10)
export const readBriefingImages = briefing.lerImagens;
export const writeDesignerNotes = briefing.escreverNotas;     // o texto do botao "Designer's Notes", no bloco 0 (01/11)
export const readDesignerNotes = briefing.lerNotas;
export const writeHeader = cabecalhoLista.escreverCabecalho;   // titulo, descricao e imagem da lista de cenarios / saved game / campanhas (17/10)
export const readHeader = cabecalhoLista.abrir;
export const checkForce = extras.verificarForca;             // structural check before delivering
export const forceTree = extras.arvore;                      // formation tree of an open .btt
// o veiculo anexado a uma formacao JA da campanha (30/10): sintetizado e inserido como ultimo filho dela, id max + 1
export const resolveFormation = extras.resolverDestino;
export const synthesizeUnit = extras.sintetizarPorNome;
export const insertRecord = extras.inserirRegistro;
export const openBtt = anexar2.abrirCompleto;                // { completo, R, d, m, ... } — `m` conferido pela largura do cabecalho (E70)
export const forceHeader = lados.cabecalho;
export const extractSide = dividir.extrairLado;              // (in, out, 'azul'|'vermelho')
export const markAsCore = core.marcarCore;                   // Import Campaign Units, by code
export const graftFormation = enxerto.enxertar;              // uma formacao no FIM da forca, sem mover core id (125)
export const activateCore = core.ativarCore;                 // buying = switching a unit on (and unmasking its formation, 112.14)
export const presentUnderMask = core.presentesSobMascara;    // units switched on under a masked formation: the game hides them (112.14)
export const pruneFormation = podar.podar;                   // what the editor's Delete on a sub-formation does, by code
export const contentEnd = core.fimDoConteudo;                // where a record's content ends
export const coreUnits = rosterCam.unidadesDoCore;           // core ids of a core force
export const pieceOfPair = pecas.pecaDoPar;                   // (val, tab, category) -> the off-map piece a vehicle's pair hides (25/11)
export const writeCampaign = rosterCam.escreverCampanha;     // the whole .cam
export const readCampaign = cam.lerCam;
export const unitPosition = acrescentar.posicaoNoCompleto;   // null = fora do mapa (off-map)
export const saveAnatomy = cam.anatomiaDoSave;               // embedded battles of a save
export const swapBattleInSave = cam.trocarBatalhaNoSave;
export const readCampaignPercentages = cam.lerPercentuais;    // refit/repair/resupply/rest (110.2)
export const writeCampaignPercentages = cam.escreverPercentuais;
export const readRoster = roster.lerRoster;                  // AAR + per-man state of a save
export const readRosterTails = roster.caudasDoRoster;        // inventory and who leads (113.1)
export const readAmmoVector = roster.paiolDe;                // where the ammo vector is in a man's record (113.6, E60)
export const readGrenades = roster.granadasDe;               // grenades are NOT in the ammo vector (113.7, E67)
export const restoreGrenades = roster.reporGranadas;         // and putting them back grows the record 3 bytes each (E69)
export const writeSoldierStates = roster.escreverEstados;    // replacement, man by man (o caminho antigo)
export const reinforceMen = roster.reforcar;                 // de pe e armado de novo (116)
export const resupplyMen = roster.reabastecer;               // ammo back to the TO&E load (110.6)
 export const insertAmmo = roster.inserirMunicao;              // e um paiol para quem perdeu o dele (113.3, E37)
export const writeManBytes = roster.escreverBytesDoHomem;    // demo charges, laser, NV: bytes +7/+8 of a man (FORMATO 130, E117)
export const rearmMen = roster.devolverArmas;                // the weapon that walked away comes back (113.5, E54)
export const removeAmmo = roster.removerMunicao;             // and what is not his goes: the record shrinks 4 B per pair (plan B, 28/09)
// The army of every core unit, read from the battles embedded in the save (+14 nibble, 100% coverage):
// the roster type collides between armies, so the factory reset keys on army|type (plan B, 28/09).
export const armiesOfSave = (p) => new Map([...fabrica.fichasDoSave(p)].map(([id, f]) => [id, f.exercito]));
export const vehicleLaunchers = toeVeic.lerLancadores;          // the launchers a vehicle carries for its infantry (FORMATO 131)
export const writeLaunchers = toeVeic.escreverLancadores;
export const stripCargo = toeVeic.tirarDaCarga;               // tira itens da carga de maquinas escolhidas, sem mexer no resto (17/10)
export const writeSmoke = toeVeic.escreverTerceira;          // the smoke-discharger load (the third list, E121)
export const unitBlocks2 = toeVeic.blocosDoSave;
export const resupplyUnits = toeVeic.reabastecerUnidades;    // and the ammo a vehicle or gun carries
export const readUnitAmmo = toeVeic.lerRabo;                 // the ammo list in a unit block; the EMPTY one only on request (E73)
export const toeVehicleTable = toeVeic.lerTabela;
export const unitBlocks = toeVeic.blocosDoSave;         // um bloco por unidade, para rotular perda
export const crewAtEnd = veiculoEstado.tripulacaoNoFim;      // each machine's crew in the last turn save, by name (18/10)
export const immobilizedAtEnd = veiculoEstado.imobilizadosNoFim;   // the immobilized machine the game wrote off at the end (30/09)
export const vehicleStates = veiculoEstado.estadosDoSave;    // the Vehicle Status the game wrote for each machine: 1 destroyed, 2 immobilized, 3 OK (110.11, E90)
export const vehicleStateOfBlock = veiculoEstado.estadoDoBloco;
export const resurrectVehicles = ressurreicao.ressuscitar;  // a destroyed machine comes back in its own slot: S = 3, damage cleared (proven in game 28/09)
export const unitKills = abates.abatesDoSave;               // campaign kill count of every unit: men, and vehicles by type (110.13)
export const growRoster = roster.crescerRoster;              // core units bought mid-campaign (112.8)
export const fixRosterAttributes = roster.corrigirAtributos; // the save roster copies the force (112.12)
export const numberSlots = roster.numerarVagas;              // each blank block's slots carry its place (E141)
export const orderMenlessLines = roster.ordenarSemHomens;    // menless lines in the order the game pairs them (08/11)
export const presentInReach = roster.presentesNoAlcance;   // present units' lines inside the part of the roster the game reads (08/11)
export const restoreRosterLines = roster.restaurarLinhas;   // the lines the game dropped or wrote as garbage past the lines it reads (08/11)
export const repairMenlessLines = roster.sanearSemHomens;  // a menless line the game wrote corrupted goes back to a clean one (08/11)
export const removeAbsentUnits = removerMod.removerUnidades; // absent units out of a battle file, the mirror of the graft (10/11)
export const VICTORY_LEVELS = roster.NIVEIS;
export const aiGroups = ia.gruposUsados;
export const dismountSide = desmontarMod.desmontar;   // infantry starts on foot (FORMATO 112.11)
// O plano de IA revisado (E174): papel -> grupo -> zona de Setup do grupo (tools/re/ia_agrupar.mjs) e o leitor do plano
const iaAgrupar = await import('../../tools/re/ia_agrupar.mjs');
const iaEscrever = await import('../../tools/re/ia_escrever.mjs');
const iaDoutrina = await import('../../tools/re/ia_doutrina.mjs');
const agruparMod = await import('../../tools/re/agrupar.mjs');
export const blueUnits = iaAgrupar.unidadesAzuis;             // [{id, nome, formacao, ausente, foraDoMapa}]
export const groupsByRole = iaAgrupar.planoDeGrupos;          // (unidades, {roleOf, preco}) -> {grupo: Map, vivas, infantaria, porPapel, blindados}
export const writeGroups = iaAgrupar.agruparIds;              // byte +16 de cada id
export const placeByGroup = iaAgrupar.posicionarPorGrupo;     // cada grupo na sua zona; infantaria em casa/mata
export const defaultUnitPrice = iaAgrupar.precoPadrao;
export const fineRole = iaAgrupar.papelFino;
export const decodeAiRegion = iaEscrever.decodificar;         // a regiao de IA + as 30 vagas
export const toMapTiles = iaEscrever.doMapa;                  // tiles do canvas -> tiles do mapa
export const mapFeatures = iaDoutrina.feicoes;                // pintura, abrigo, predios, mata...
export const DOCTRINE_GROUPS = iaDoutrina.GRUPOS;             // os 16 grupos e o papel de cada um
export const unitGroups = agruparMod.grupos;                  // [{id, nome, grupo}] lido do arquivo
// O encontro (12/10): o plano escolhido e o unico usado numa copia do mapa (gravar com identidade, como ia_parar_objetivo)
const mapaEscreverMod = await import('../../tools/re/mapa_escrever.mjs');
export const writeAiRegion = iaEscrever.gravar;
export const encodeAiRegion = iaEscrever.codificar;
export const AI_PLAN_USE = iaEscrever.USO;
export const aiFileVersion = iaEscrever.versaoDoArquivo;
export const mapPieces = mapaEscreverMod.pecas;
export const readHeadings = rumoMod.lerRumos;          // the heading of every placed unit (FORMATO 132)
export const writeHeadings = rumoMod.escreverRumos;
export const headingTo = rumoMod.rumoPara;
export const centreOf = rumoMod.centroide;
export const setUnitExperience = experienciaMod.aplicarPorCoreId;
export const toeWeaponTable = toe.lerTabela;                 // factory weapon by TO&E slot (116)   // one unit at a time (112.13)
export const weaponAmmoTable = armasMun.lerTabela;           // what each WEAPON is issued (E54)
export const grenadePlan = granadas.planoDaUnidade;          // the grenades a unit gets back, capped by its type (E69)
export const sidearmTable = armasMun.lerSecundarias;         // the weapons that ride in hand 2 (E54)
export const unitAttributes = atributos.decodificar;         // the seven the editor shows
// the attributes of the enemy units of one name (18/10: the tank of the ladder can be more experienced than its tier)
const atributosUnidade = await import('../../tools/re/atributos_unidade.mjs');
export const setUnitAttributesByName = atributosUnidade.aplicarPorNome;
export const EXPERIENCE_LEVELS = atributos.EXPERIENCIA;
export const readMap = mapa.lerMapa;                         // dimensions, grid and buildings
export const writeElevation = mapaEscrever.montarElevacao;   // the 4 B/tile layer — COLUMN-major, x*H + y (71.1, E72)
export const elevationIndex = mapaEscrever.indiceElevacao;
export const readObjectives = objetivos.lerObjetivos;        // what is on the map and what it is worth
export const pointsAtStake = objetivos.pontosDisponiveis;    // the denominator of the verdict (114)
// THE EDITOR'S EQUIPMENT BLOCKS (FORMATO 43.2, 44.2, E95). The choice of vehicle or weapon lives in a
// list at the end of each unit record, one u16 per level, and its first entry is the GROUP the
// editor offers together; swapping is rewriting that list (the record grows or shrinks with it).
export const equipmentRecords = blocos.registrosDe;          // every record: its list, group and size
export const equipmentTable = blocos.tabela;                 // research/blocos.json: the options per army and group
export const swapEquipment = blocos.trocar;                  // type + rarity + list; refuses a core-marked file
export const unitTypeName = blocos.nomeDoTipo;               // (val, tab) -> the catalogue name
export const typeKey = blocos.chaveDoTipo;                   // (val, tab) -> "0xTAB,0xVAL", the table's key
export const GAME_FOLDER_IN_USE = GAME_FILES;
