const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function harness() {
  let listener;
  const state = {url: 'https://www.marjane.ma/account/orders', hidden: false, modals: [], clicks: []};
  function button(label, id) {
    const card = {nodes: [{textContent: id}]};
    return {textContent: label, disabled: false, getClientRects: () => [{}], closest: () => card,
      click() { state.clicks.push(id); }, card};
  }
  state.buttons = [button('Détails du ticket', 'TEST_A'), button('Détails du ticket', 'TEST_B'),
    button('Payer', 'PAYMENT'), button('Détails du ticket', 'TEST_A_EXTRA')];
  const window = {};
  const context = vm.createContext({
    window, URL, NodeFilter: {SHOW_TEXT: 4},
    get location() { return new URL(state.url); },
    getComputedStyle: () => ({visibility: 'visible', display: 'block'}),
    document: {
      get visibilityState() { return state.hidden ? 'hidden' : 'visible'; },
      querySelectorAll(selector) { return selector === 'article button' ? state.buttons : state.modals; },
      createTreeWalker(card) {
        let index = -1;
        return {currentNode: null, nextNode() { this.currentNode = card.nodes[++index]; return !!this.currentNode; }};
      }
    },
    browser: {runtime: {id: 'extension', onMessage: {addListener(fn) { listener = fn; }}}}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../firefox-extension/detail-controls.js'), 'utf8'), context);
  const send = message => listener({type: 'marjane-ticket-control', ...message}, {id: 'extension'});
  return {state, send, listener: (...args) => listener(...args)};
}

test('discovers only exact loaded ticket cards and clicks no unrelated controls', async () => {
  const h = harness();
  const tickets = [{id: 'TEST_A'}, {id: 'TEST_B'}, {id: 'PAYMENT'}, {id: 'MISSING'}];
  const found = await h.send({command: 'discover', tickets});
  assert.equal(found.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(found.tickets)), tickets.slice(0, 2));
  assert.equal((await h.send({command: 'open', ticket: tickets[0]})).ok, true);
  assert.deepEqual(h.state.clicks, ['TEST_A']);
});

test('hidden/offsite pages, ambiguous cards and open dialogs are refused', async () => {
  const h = harness();
  h.state.hidden = true;
  assert.equal((await h.send({command: 'open', ticket: {id: 'TEST_A'}})).ok, false);
  h.state.hidden = false;
  h.state.url = 'https://www.marjane.ma/cart';
  assert.equal((await h.send({command: 'open', ticket: {id: 'TEST_A'}})).ok, false);
  h.state.url = 'https://www.marjane.ma/account/orders';
  h.state.buttons.push(h.state.buttons[0]);
  assert.equal((await h.send({command: 'open', ticket: {id: 'TEST_A'}})).ok, false);
  h.state.modals = [{getClientRects: () => [{}]}];
  assert.equal((await h.send({command: 'open', ticket: {id: 'TEST_B'}})).ok, false);
  assert.deepEqual(h.state.clicks, []);
});

test('closes only a matching ticket using the explicit Fermer control', async () => {
  const h = harness();
  const close = {getClientRects: () => [{}], disabled: false, click() { h.state.clicks.push('close'); }};
  h.state.modals = [{getClientRects: () => [{}], querySelectorAll(selector) {
    assert.equal(selector, 'button[aria-label="Fermer"]'); return [close];
  }}];
  h.state.url += '?order_number=TEST_B';
  assert.equal((await h.send({command: 'close', ticket: {id: 'TEST_A'}})).ok, false);
  assert.equal((await h.send({command: 'close', ticket: {id: 'TEST_B'}})).ok, true);
  assert.deepEqual(h.state.clicks, ['close']);
});

test('foreign senders cannot control the page', async () => {
  const h = harness();
  assert.equal(h.listener({type: 'marjane-ticket-control', command: 'open', ticket: {id: 'TEST_A'}}, {id: 'other'}), undefined);
  assert.deepEqual(h.state.clicks, []);
});

test('stale order_number without a modal does not block discovery or the next open', async () => {
  const h = harness();
  h.state.url += '?order_number=OLD_TICKET';
  const result = await h.send({command: 'discover', tickets: [{id: 'TEST_A'}]});
  assert.equal(result.tickets.length, 1);
  assert.equal((await h.send({command: 'closed', ticket: {id: 'OLD_TICKET'}})).closed, true);
  assert.equal((await h.send({command: 'open', ticket: {id: 'TEST_A'}})).ok, true);
  assert.deepEqual(h.state.clicks, ['TEST_A']);
});

test('waits for modal rendering and deduplicates close controls in nested dialog wrappers', async () => {
  const h = harness();
  h.state.url += '?order_number=TEST_A';
  assert.equal((await h.send({command: 'close', ticket: {id: 'TEST_A'}})).clicked, false);
  const close = {getClientRects: () => [{}], disabled: false, click() { h.state.clicks.push('close'); }};
  const wrapper = {getClientRects: () => [{}], querySelectorAll() { return [close]; }};
  h.state.modals = [wrapper, wrapper];
  assert.equal((await h.send({command: 'closed', ticket: {id: 'TEST_A'}})).closed, false);
  assert.equal((await h.send({command: 'close', ticket: {id: 'TEST_A'}})).clicked, true);
  assert.deepEqual(h.state.clicks, ['close']);
  h.state.modals = [];
  assert.equal((await h.send({command: 'closed', ticket: {id: 'TEST_A'}})).closed, true);
});

test('recognizes a site-auto-opened receipt only when captured ID and card both match', async () => {
  const h = harness();
  h.state.url += '?order_number=TEST_A';
  h.state.modals = [{getClientRects: () => [{}]}];
  const result = await h.send({command: 'existing', tickets: [{id: 'TEST_A', storeId: '7'}]});
  assert.equal(result.ok, true);
  assert.equal(result.ticket.id, 'TEST_A');
  assert.equal((await h.send({command: 'existing', tickets: [{id: 'TEST_B'}]})).ok, false);
  h.state.buttons = [];
  assert.equal((await h.send({command: 'existing', tickets: [{id: 'TEST_A'}]})).ok, false);
  assert.deepEqual(h.state.clicks, []);
});

test('stale URL without a visible modal needs no bootstrap close', async () => {
  const h = harness();
  h.state.url += '?order_number=TEST_A';
  const result = await h.send({command: 'existing', tickets: [{id: 'TEST_A'}]});
  assert.equal(result.ok, true);
  assert.equal(result.ticket, null);
});
