// AS INVARIANTES DO ESTADO DE UMA CAMPANHA (05/10/2026, plano da varredura de QA, fase 0). Puras: recebem o `state`
// (o state.json) e devolvem a lista do que esta errado, em frases; vazia quando o estado e coerente. Servem ao teste,
// a varredura (depois de cada passo) e a quem precisar conferir um estado antes de gravar.
// 'choose' (E176): a campanha com caminho criada, esperando a escolha da batalha 1; nenhuma batalha montada.
// 'brief' (18/10): forcas aplicadas, a batalha ainda nao gerada — o Intel antes do Prepare (state.next). Na batalha 1 a
// campanha pode estar sem forca em 'choose' e 'brief': ela e comprada no Quartermaster (raiseForce).
const ESTAGIOS = new Set(['choose', 'brief', 'play', 'result', 'over']);

export function invariantesDoEstado(state) {
  const erros = [];
  const err = (m) => erros.push(m);
  if (!ESTAGIOS.has(state.stage)) err(`stage "${state.stage}" is not one of ${[...ESTAGIOS].join(', ')}`);
  if (!Number.isFinite(state.credits)) err(`credits is ${state.credits}`);
  else if (state.credits < 0) err(`credits are negative (${state.credits})`);
  // O LIVRO-RAZAO (29/10, bateria da economia): creditos = ledgerBase + degraus + coberturas + bonus + reembolsos - gastos
  // (a escada, 30/10; reward e stipend sao as chaves de antes, que os fixtures do QA ainda trazem)
  if (Array.isArray(state.ledger) && Number.isFinite(state.ledgerBase) && Number.isFinite(state.credits)) {
    const conta = state.ledger.reduce((a, e) => a + (e.step || 0) + (e.cover || 0) + (e.bonus || 0) + (e.reward || 0) + (e.stipend || 0) + (e.refund || 0) - (e.spend || 0), state.ledgerBase);
    if (Math.round(conta) !== Math.round(state.credits)) err(`credits are ${state.credits} but the ledger adds up to ${Math.round(conta)}`);
  }
  // nenhuma unidade devolve na venda mais do que custou: o pago nunca e negativo nem falta
  const semPago = (state.units || []).filter((u) => u.paid !== undefined && !(Number.isFinite(u.paid) && u.paid >= 0));
  if (semPago.length) err(`${semPago.length} units with an invalid paid price (${semPago[0].name}: ${semPago[0].paid})`);
  // o resultado pendente existe exatamente no estagio de resultado, e o retrato da loja so nele
  if ((state.stage === 'result') !== !!state.pending) err(`stage ${state.stage} with ${state.pending ? 'a' : 'no'} pending result`);
  if (state.shopSnapshot && state.stage !== 'result') err(`a quartermaster snapshot outside the result stage (${state.stage})`);
  const units = state.units || [];
  const ids = new Set(units.map((u) => u.coreId));
  if (ids.size !== units.length) err(`${units.length - ids.size} repeated core ids in units`);
  if (state.coreUnits != null && state.coreUnits !== units.length) err(`coreUnits says ${state.coreUnits} but there are ${units.length} units`);
  // SEM FORCA (18/10): a campanha nasce sem ela e a compra no Quartermaster da batalha 1, depois do caminho. Ate la nao ha
  // unidade, compra nem credito gasto, e o estagio e a escolha da batalha 1 ou o brief dela.
  if (!state.coreFile) {
    if (units.length) err(`${units.length} units but no core file`);
    if (state.stage !== 'choose' && state.stage !== 'brief') err(`stage ${state.stage} without a force`);
    if (state.stage === 'brief' && state.next?.n !== 1) err('the brief of a battle after the first without a force');
    if ((state.purchased || []).length) err('purchases without a force');
    if (Number.isFinite(state.rulesUsed?.startingCredits) && state.credits !== state.rulesUsed.startingCredits) err(`credits ${state.credits} without a force (the campaign started with ${state.rulesUsed.startingCredits})`);
  } else if (!units.length) err('a core file with no units');
  const presentes = new Set(units.filter((u) => u.present).map((u) => u.coreId));
  const fora = (nome, lista) => { const x = (lista || []).filter((id) => !ids.has(id)); if (x.length) err(`${nome} names core ids that are not units: ${x.slice(0, 5).join(', ')}`); };
  fora('lost', state.lost); fora('purchased', state.purchased); fora('standDown', state.standDown);
  fora('sold', (state.sold || []).map((x) => x.coreId));
  fora('attrs', Object.keys(state.attrs || {}).map(Number)); fora('record', Object.keys(state.record || {}).map(Number));
  fora('cleanBattles', Object.keys(state.cleanBattles || {}).map(Number));
  const tiradoEmCampo = (state.standDown || []).filter((id) => presentes.has(id));
  if (tiradoEmCampo.length) err(`stood down but present: ${tiradoEmCampo.slice(0, 5).join(', ')}`);
  const vendidoEmCampo = (state.sold || []).map((x) => x.coreId).filter((id) => presentes.has(id));
  if (vendidoEmCampo.length) err(`sold but present: ${vendidoEmCampo.slice(0, 5).join(', ')}`);
  // uma batalha por entrada do historico, antes da atual (no resultado, a atual ainda nao entrou)
  if (state.stage !== 'over' && (state.history || []).length !== (state.battleNumber || 1) - 1) err(`history has ${(state.history || []).length} battles at battle ${state.battleNumber}`);
  const vistos = new Set((state.seenSaves || []).map((p) => String(p).toLowerCase()));
  const naoVistos = (state.history || []).filter((h) => h.save && !vistos.has(String(h.save).toLowerCase()));
  if (naoVistos.length) err(`${naoVistos.length} history saves not in seenSaves`);
  // O CAMINHO (E176): pontos nunca negativos; a rota tem um no por batalha ate a atual, e o escolhido segue o atual
  // um caminho sem o Start vazio e do formato de antes de 11/10: `loadState` o descarta na leitura, nada a conferir
  if (state.path && (state.path.nodes || []).some((x) => x.id === 'start')) {
    if (!Number.isFinite(state.ops) || state.ops < 0) err(`operational points are ${state.ops}`);
    const rota = state.path.route || [];
    // a rota comeca no Start: a batalha n e route[n]; no 'choose' so o Start
    const esperada = state.stage === 'choose' ? 1 : (state.battleNumber || 1) + 1;
    if (state.stage !== 'over' && rota.length !== esperada) err(`the path route has ${rota.length} nodes at battle ${state.battleNumber} (${state.stage})`);
    const atual = (state.path.nodes || []).find((x) => x.id === state.path.at);
    if (!atual) err(`the current node ${state.path.at} is not on the path`);
    if (state.path.chosen && !(atual?.edges || []).includes(state.path.chosen)) err(`the chosen node ${state.path.chosen} does not follow ${state.path.at}`);
    if (state.path.chosen && state.stage !== 'result' && state.stage !== 'choose') err(`a chosen node outside the result and choose stages (${state.stage})`);
  }
  if (state.stage === 'brief') {
    if (!state.next || !Number.isInteger(state.next.n)) err('the brief stage without the battle to prepare (state.next)');
    if (state.current) err('a battle is built in the brief stage');
    if (state.next && state.next.n !== (state.battleNumber || 1)) err(`the battle to prepare is ${state.next?.n} at battle ${state.battleNumber}`);
  }
  // O KIT-OUT (19/10): a batalha de mentira da Special Forces, montada ('play') ou lida ('result'), enquanto a batalha
  // de verdade espera em `state.next`. Nao tem numero: o da campanha e o da batalha que espera.
  const kitMontado = state.stage === 'play' && !!state.current?.kitOut;
  const kitLido = state.stage === 'result' && !!state.pending?.result?.kitOut;
  if (state.next && state.stage !== 'brief' && !kitMontado && !kitLido) err(`a battle to prepare outside the brief stage (${state.stage})`);
  if (kitMontado || kitLido) {
    const kn = kitMontado ? state.current.n : state.pending.result.battle;
    if (!state.next) err('a kit-out without the battle it comes before (state.next)');
    else if (state.next.n !== kn || state.next.kitOut !== 'pending') err(`the kit-out of battle ${kn} before battle ${state.next.n} (${state.next.kitOut})`);
    if (kn !== (state.battleNumber || 1)) err(`the kit-out of battle ${kn} at battle ${state.battleNumber}`);
  }
  if (state.next?.kitOut && !['pending', 'done'].includes(state.next.kitOut)) err(`the kit-out is "${state.next.kitOut}"`);
  if (state.slotShift != null && !(Number.isInteger(state.slotShift) && state.slotShift >= 0)) err(`slotShift is ${state.slotShift}`);
  if (state.current?.afterKitOut && state.stage !== 'play' && state.stage !== 'result' && state.stage !== 'over') err(`a battle after a kit-out in the ${state.stage} stage`);
  if (state.stage === 'choose') {
    if (!state.path) err('the choose stage without a battle path');
    if (state.current) err('a battle is built in the choose stage');
  }
  return erros;
}
