// src/lib/autosave.js — a small, testable autosave queue for the campaign workspace.
// Edits are merged into one pending patch and saved after a quiet period; edits made while a save is in flight
// wait and go out as the next save; a failed save keeps every edit (merged under anything typed since) and reports
// the error instead of retrying by itself, so a stale editor can never silently overwrite a newer version.
// `save(patch, version)` must resolve to { version } (the persisted version), or throw with `code: "stale"`.
export function createAutosave({ save, delay = 1200, version = null, onState = null, timers = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) } }) {
  let pending = null, timer = null, inFlight = null, error = null, savedAt = null, current = version;
  const state = () => ({ dirty: !!pending, saving: !!inFlight, error, version: current, savedAt });
  const emit = () => { if (onState) onState(state()); };
  function schedule() { if (timer) timers.clear(timer); timer = timers.set(() => { timer = null; flush(); }, delay); }
  // Merge an edit. Nothing is sent until the editor has been quiet for `delay`.
  function change(patch) {
    pending = { ...(pending || {}), ...patch };
    if (!error || error.code !== 'stale') { error = null; schedule(); }
    emit();
  }
  // Send what is pending now (or wait for the save in flight, then send what arrived meanwhile). A save that finishes
  // may start the next one for the edits made during it, so keep waiting while anything is in flight.
  async function flush() {
    if (timer) { timers.clear(timer); timer = null; }
    while (inFlight) await inFlight;
    if (!pending || (error && error.code === 'stale')) return state();
    const batch = pending; pending = null;
    inFlight = (async () => {
      try { const r = await save(batch, current); if (r && r.version != null) current = r.version; savedAt = Date.now(); error = null; }
      catch (e) { error = e; pending = { ...batch, ...(pending || {}) }; }
    })();
    emit();
    await inFlight; inFlight = null; emit();
    if (pending && !error) return flush();
    return state();
  }
  // After a reload: the editor now holds this version; pending edits may go out again.
  function reset(v) { current = v; error = null; if (pending) schedule(); emit(); }
  function retry() { if (error && error.code === 'stale') return Promise.resolve(state()); error = null; return flush(); }
  return { change, flush, reset, retry, state, get version() { return current; }, get pending() { return pending; } };
}
