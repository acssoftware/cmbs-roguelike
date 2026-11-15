// Long operations (generating a force, a battle, a campaign file) take tens of seconds. They run
// as jobs so the browser never sits on a hanging request: the UI starts one, then polls and shows
// the steps as they land in the log. The job keeps its own slice of the trace, which is exactly
// what you want to read when something goes wrong.
//
// A CHECKLIST, NOT A SPINNER (08/11/2026, autor: "a leitura/escrita fica ali carregando sem dar nenhum feedback; outros
// usuarios podem achar que e erro e fecharem o app"). Each step is { step, state, ms }: `note(label)` closes the one that
// was running and opens the next; `note.plan([...])` lays the expected steps out up front as 'pending', so the player sees
// how far along it is; a planned step that never ran is dropped when the job ends. `note()` returns a promise that yields
// to the event loop (setImmediate): the heavy work is synchronous, and without `await note(...)` between its phases the
// server could not answer the page's poll until the whole thing was over — the list never moved.
import crypto from 'node:crypto';

const jobs = new Map();
const tick = () => new Promise((r) => setImmediate(r));

export function start(label, fn, { slug = null } = {}) {
  const id = crypto.randomBytes(4).toString('hex');
  const job = { id, label, slug, state: 'running', startedAt: new Date().toISOString(), steps: [], result: null, error: null };
  jobs.set(id, job);
  const agora = () => Date.now();
  const fecha = (estado) => {
    const s = job.steps.find((x) => x.state === 'running');
    if (s) { s.state = estado; s.ms = agora() - s.t0; }
  };
  const note = (step, extra) => {
    fecha('done');
    // the same label again (a map refused and drawn again) reopens its line instead of adding one
    const pend = job.steps.find((x) => x.state !== 'running' && x.step === step);
    const s = pend || { step };
    Object.assign(s, { t: new Date().toISOString(), t0: agora(), state: 'running', ...extra });
    if (!pend) {
      // a step that was not planned goes before the first pending one, so the list keeps reading in order
      const k = job.steps.findIndex((x) => x.state === 'pending');
      if (k < 0) job.steps.push(s); else job.steps.splice(k, 0, s);
    }
    return tick();
  };
  note.plan = (labels) => {
    for (const step of labels || []) if (!job.steps.some((x) => x.step === step)) job.steps.push({ step, state: 'pending' });
  };
  note.skip = (step) => { job.steps = job.steps.filter((x) => !(x.state === 'pending' && x.step === step)); };
  const fim = () => { job.steps = job.steps.filter((x) => x.state !== 'pending'); job.finishedAt = new Date().toISOString(); job.ms = agora() - Date.parse(job.startedAt); };
  Promise.resolve()
    .then(() => fn(note))
    .then((result) => { fecha('done'); fim(); job.result = result; job.state = 'done'; })
    .catch((e) => {
      fecha('failed'); fim();
      job.state = 'failed';
      job.error = { message: e.message, stack: String(e.stack || '').split('\n').slice(0, 12) };
    });
  return job;
}

export function get(id) { return jobs.get(id) || null; }

// O job de uma campanha que ainda roda (29/10): a pagina recarregada no meio dele volta a acompanha-lo.
export function activeFor(slug) { return [...jobs.values()].find((j) => j.state === 'running' && j.slug === slug) || null; }

// Whether a build is still going: Quit waits for it rather than leave a half-written battle behind.
export function running() { return [...jobs.values()].some((j) => j.state === 'running'); }

export function forget(olderThanMs = 60 * 60 * 1000) {
  const cut = Date.now() - olderThanMs;
  for (const [id, j] of jobs) if (j.finishedAt && Date.parse(j.finishedAt) < cut) jobs.delete(id);
}
