// O QUE O APP LE DE research/ (29/10/2026). Uma lista so, para a checagem do sistema (sistema.mjs) conferir o que o
// empacotador (tools/empacotar.mjs) leva: o que um precisa, o outro entrega. Sem dependencias, para o empacotador poder
// importar sem subir as configuracoes do app.
export const TABELAS_DO_APP = ['tipos_roster.json', 'tipos_confirmados.json', 'mapas_attack.json', 'mapas_meet.json', 'custos.json', 'armas.json', 'armas_municao.json', 'biblioteca_variantes.json', 'dotacao.json', 'fabrica.json', 'precos_armas.json', 'precos_unidades.json', 'toe_armas.json', 'toe_granadas.json', 'toe_veiculos.json', 'veiculos_rotulados.jsonl', 'blocos_sem_homens.json',
  // 14/11: medidas com um gancho em fs na suite inteira (o que o codigo do app le de research/): a tabela de equipamento
  // (tools/re/blocos.mjs, equipmentTable) e os moldes de roster (catalog moldes) ficavam fora do pacote
  'blocos.json', 'moldes.json', 'moldes_avulsos.json'];

// THE APP VERSION (14/11/2026, the author: the package shared with the community needs one). One place: the server
// reports it (/api/status, the banner, the diagnostics), the page shows it, the packager puts it in the folder and zip
// names and in the launcher's file properties. Not the API level (server.mjs), which is page/server compatibility.
// 1.0.1 (15/11): a maquina destruida na ultima linha do roster volta na vaga (tools/re/ressurreicao.mjs); a formacao do
// inimigo guardada com a pasta velha do app e achada na biblioteca da nova (forge.mjs inLibrary)
// 1.0.2 (15/11): o CMBS Roguelike.exe de outra pasta pergunta antes de reabrir a versao que ja esta rodando
// 1.0.3 (15/11, autor): sem a pergunta — o .exe de outra pasta fecha a versao que roda e sobe a dele
// 1.0.4 (15/11, autor): o Force ratio sem os creditos do inimigo (a proporcao so)
// 1.0.5 (25/11, autor): o avulso so no exercito da formacao, e a lista da forca desenha o avulso ja comprado
export const APP_VERSION = '1.0.5';

// O Node minimo: o codigo usa import.meta.dirname (20.11); o Node 18 trava na partida.
export const NODE_MINIMO = [20, 11];
