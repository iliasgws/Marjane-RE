const {test} = require('node:test');
const assert = require('node:assert/strict');
const {collect} = require('../firefox-extension/automation.js');

function driver() {
  const loaded = new Set();
  const actions = [];
  let time = 0;
  let running = true;
  const api = {
    current: () => running, now: () => time,
    async sleep(ms) { time += ms; },
    async loaded(ticket) { return loaded.has(ticket.id); },
    async open(ticket) { actions.push('open:' + ticket.id); loaded.add(ticket.id); },
    async close(ticket) { actions.push('close:' + ticket.id); },
    async closed() { return true; },
    progress() {}, stop() { running = false; }
  };
  return {api, actions, loaded};
}

test('loads sequentially, skips known details, and finishes with progress', async () => {
  const d = driver();
  d.loaded.add('ALREADY_LOADED');
  const result = await collect([{id: 'A'}, {id: 'ALREADY_LOADED'}, {id: 'B'}], d.api);
  assert.deepEqual(d.actions, ['open:A', 'close:A', 'open:B', 'close:B']);
  assert.deepEqual(result, {total: 3, completed: 3, attempted: 2, reason: 'complete'});
});

test('stop while awaiting a response leaves the modal alone and opens no next ticket', async () => {
  const d = driver();
  d.api.open = async ticket => { d.actions.push('open:' + ticket.id); };
  d.api.sleep = async () => d.api.stop();
  const result = await collect([{id: 'A'}, {id: 'B'}], d.api);
  assert.equal(result.reason, 'stopped');
  assert.deepEqual(d.actions, ['open:A']);
});

test('failed or uncaptured response times out rather than continuing blindly', async () => {
  const d = driver();
  d.api.open = async ticket => { d.actions.push('open:' + ticket.id); };
  await assert.rejects(collect([{id: 'A'}, {id: 'B'}], d.api), /timed out/);
  assert.deepEqual(d.actions, ['open:A']);
});

test('page/open/close errors stop the run without another click', async () => {
  const d = driver();
  d.api.close = async () => { throw new Error('Different dialog'); };
  await assert.rejects(collect([{id: 'A'}, {id: 'B'}], d.api), /Different dialog/);
  assert.deepEqual(d.actions, ['open:A']);
});

test('cancellation during an asynchronous loaded check prevents the click', async () => {
  const d = driver();
  d.api.loaded = async () => { d.api.stop(); return false; };
  assert.equal((await collect([{id: 'A'}], d.api)).reason, 'stopped');
  assert.deepEqual(d.actions, []);
});

test('does not open the next ticket until modal closure is verified', async () => {
  const d = driver();
  let checks = 0;
  d.api.closed = async () => ++checks >= 3;
  const result = await collect([{id: 'A'}, {id: 'B'}], d.api);
  assert.equal(result.completed, 2);
  assert.ok(checks >= 4);
  assert.deepEqual(d.actions, ['open:A', 'close:A', 'open:B', 'close:B']);
});

test('a close click that leaves the modal open stops instead of advancing', async () => {
  const d = driver();
  d.api.closed = async () => false;
  await assert.rejects(collect([{id: 'A'}, {id: 'B'}], d.api), /did not close/);
  assert.deepEqual(d.actions, ['open:A', 'close:A']);
});
