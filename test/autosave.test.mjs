// test/autosave.test.mjs — the workspace's autosave queue: delayed saves coalesce, edits during a save wait
// for the next one, a failed save keeps every edit and reports, a stale save never retries by itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutosave } from '../src/lib/autosave.js';

// Manual timers: nothing fires until `tick()` is called, so the tests own the clock.
function fakeTimers() {
  const queue = []; let id = 0;
  return { set: (fn, ms) => { const t = { id: ++id, fn, ms }; queue.push(t); return t.id; }, clear: tid => { const i = queue.findIndex(t => t.id === tid); if (i >= 0) queue.splice(i, 1); }, tick: () => { const t = queue.shift(); if (t) t.fn(); return !!t; }, size: () => queue.length };
}
const flushMicro = () => new Promise(r => setTimeout(r, 0));

test('edits within the quiet period coalesce into one save with the merged patch and the editor version', async () => {
  const timers = fakeTimers(); const saves = [];
  const a = createAutosave({ save: async (patch, version) => { saves.push({ patch, version }); return { version: version + 1 }; }, version: 3, timers, delay: 500 });
  a.change({ subject: 'A' }); a.change({ subject: 'AB' }); a.change({ preheader: 'p' });
  assert.equal(timers.size(), 1, 'one pending timer, the earlier ones were cleared'); assert.equal(a.state().dirty, true);
  timers.tick(); await flushMicro();
  assert.equal(saves.length, 1); assert.deepEqual(saves[0], { patch: { subject: 'AB', preheader: 'p' }, version: 3 });
  assert.equal(a.version, 4); assert.equal(a.state().dirty, false); assert.equal(a.state().saving, false);
});

test('an edit made while a save is in flight goes out in a second save, on the new version, with only the new fields', async () => {
  const timers = fakeTimers(); const saves = []; let release;
  const a = createAutosave({ save: (patch, version) => new Promise(res => { saves.push({ patch, version }); release = () => res({ version: version + 1 }); }), version: 1, timers, delay: 100 });
  a.change({ subject: 'one' }); timers.tick(); await flushMicro();
  assert.equal(a.state().saving, true);
  a.change({ body: 'two' });                            // typed during the save
  assert.equal(a.state().dirty, true);
  release(); await flushMicro(); await flushMicro();
  assert.equal(saves.length, 2); assert.deepEqual(saves[1], { patch: { body: 'two' }, version: 2 });
  release(); await flushMicro(); await flushMicro();
  assert.equal(a.version, 3); assert.equal(a.state().dirty, false);
});

test('a failed save keeps every edit (merged under anything typed since) and reports the error; retry sends them again', async () => {
  const timers = fakeTimers(); let fail = true; const saves = [];
  const a = createAutosave({ save: async (patch, version) => { saves.push(patch); if (fail) throw new Error('network'); return { version: version + 1 }; }, version: 1, timers, delay: 100 });
  a.change({ subject: 'x', body: 'b1' }); timers.tick(); await flushMicro(); await flushMicro();
  assert.equal(a.state().error.message, 'network'); assert.equal(a.state().dirty, true, 'the edit is still pending');
  a.change({ body: 'b2' });                              // newer typing wins over the failed batch
  assert.deepEqual(a.pending, { subject: 'x', body: 'b2' });
  fail = false; await a.retry(); await flushMicro();
  assert.deepEqual(saves[1], { subject: 'x', body: 'b2' }); assert.equal(a.version, 2); assert.equal(a.state().error, null);
});

test('a stale save (someone saved a newer version) is not retried by itself; the edits wait until the editor reloads', async () => {
  const timers = fakeTimers(); const saves = [];
  const a = createAutosave({ save: async (patch, version) => { saves.push({ patch, version }); if (version === 1) throw Object.assign(new Error('stale'), { code: 'stale', version: 2 }); return { version: version + 1 }; }, version: 1, timers, delay: 100 });
  a.change({ subject: 'mine' }); timers.tick(); await flushMicro(); await flushMicro();
  assert.equal(a.state().error.code, 'stale'); assert.equal(a.state().dirty, true);
  a.change({ subject: 'mine 2' });
  assert.equal(timers.size(), 0, 'no save is scheduled while stale'); await a.flush(); assert.equal(saves.length, 1, 'flush does not resend a stale edit');
  a.reset(2);                                            // the editor reloaded version 2 and chose to keep typing
  assert.equal(timers.size(), 1); timers.tick(); await flushMicro(); await flushMicro();
  assert.deepEqual(saves[1], { patch: { subject: 'mine 2' }, version: 2 }); assert.equal(a.version, 3);
});

test('flush sends immediately (leaving the editor), and does nothing when there is nothing to send', async () => {
  const timers = fakeTimers(); const saves = [];
  const a = createAutosave({ save: async (patch, version) => { saves.push(patch); return { version: version + 1 }; }, version: 0, timers, delay: 1000 });
  await a.flush(); assert.equal(saves.length, 0);
  a.change({ name: 'Reminder' }); const s = await a.flush();
  assert.equal(saves.length, 1); assert.equal(timers.size(), 0); assert.equal(s.dirty, false); assert.equal(s.version, 1);
});

test('flush() called while a timer-started save is in flight resolves only after the edits made during that save are saved too', async () => {
  const timers = fakeTimers(); const saves = []; const releases = [];
  const a = createAutosave({ save: (patch, version) => new Promise(res => { saves.push({ patch, version }); releases.push(() => res({ version: version + 1 })); }), version: 1, timers, delay: 100 });
  a.change({ audience: { mode: 'all_subscribers' } }); timers.tick(); await flushMicro();   // save 1 in flight
  a.change({ audience: { mode: 'members' } });                                              // changed during the save
  let settled = null; const p = a.flush().then(s => { settled = s; return s; });             // "Continue" pressed now
  releases[0](); await flushMicro(); await flushMicro();
  assert.equal(settled, null, 'flush must not resolve while the second save (members) is still in flight');
  assert.equal(saves.length, 2); assert.deepEqual(saves[1].patch, { audience: { mode: 'members' } }); assert.equal(saves[1].version, 2);
  releases[1](); const s = await p;
  assert.equal(s.version, 3); assert.equal(s.dirty, false); assert.equal(s.saving, false);
});
