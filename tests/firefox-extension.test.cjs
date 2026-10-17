const {test} = require('node:test');
const assert = require('node:assert/strict');
const core = require('../firefox-extension/core.js');
const {observe} = require('../firefox-extension/capture.js');

const list = core.endpoint('https://api-ayaline.marjane.ma/customers/TEST_CUSTOMER/tickets?mode=Marjane');
const detail = core.endpoint('https://api-ayaline.marjane.ma/customers/TEST_CUSTOMER/tickets/7/TEST_TICKET');
const summary = {ticket_key: 'TEST_TICKET', server: 7, create: '2026-01-02 10:20:30',
  server_label: null, ticket_total_price: 39.5};
const receipt = {ticket: {ticket_key: 'TEST_TICKET', create: summary.create, card_key: 'PRIVATE_CARD'},
  ticket_total: 35, ticket_total_discount: 4.5, ticket_total_price: 39.5,
  array_of_item: [{name_item: 'Produit, "test" 🛒', price: 17.5, quantity: 2,
    hierarchy: {description: 'Test', reference: 'CLASS'}}],
  array_of_payment_mean: [{data_1: 'CB AUTO', data_2: '35'}],
  token: 'PRIVATE_TOKEN', phone: 'PRIVATE_PHONE', delivery_address: {street: 'PRIVATE_ADDRESS'}};

test('only explicit HTTPS history endpoints on exact hosts are eligible', () => {
  for (const url of [
    'https://other.example/coral/order', 'https://api-ayaline.marjane.ma.evil.example/coral/order',
    'http://api-ayaline.marjane.ma/coral/order', 'https://api-ayaline.marjane.ma/coral/auth/phone',
    'https://www.marjane.ma/account/orders', 'https://api-ayaline.marjane.ma/customers/TEST_CUSTOMER',
    'https://api-ayaline.marjane.ma/coral/order/rating/check', 'not a URL'
  ]) assert.equal(core.endpoint(url), null, url);
  assert.equal(core.endpoint('https://api-ayaline.marjane.ma/front/customers/orders').kind, 'online-list');
  assert.equal(core.endpoint('https://api-ayaline.marjane.ma/coral/order/TEST_ORDER').kind, 'online-detail');
});

test('receipt list and nested detail normalize to the same identity', () => {
  const a = core.normalize([summary], list)[0];
  const b = core.normalize(receipt, detail)[0];
  assert.equal(core.key(a), core.key(b));
  assert.equal(b.storeId, '7'); // Detail lacks server: the route supplies it.
  assert.equal(b.items[0].name, 'Produit, "test" 🛒');
  assert.equal(b.items[0].quantity, 2);
  assert.equal(b.total, 35);
  assert.equal(b.totalDiscount, 4.5);
  assert.equal(b.detailsLoaded, true);
  assert.equal(b.items[0].lineTotal, null); // Never invent price * quantity semantics.
});

test('merge preserves product details but fills a missing store label', () => {
  const a = core.normalize([{...summary, server_label: 'Test store'}], list)[0];
  const b = core.normalize(receipt, detail)[0];
  const merged = core.merge(b, a);
  assert.equal(merged.items.length, 1);
  assert.equal(merged.total, 35);
  assert.equal(merged.store, 'Test store');
});

test('whitelisted export omits identity, address, payment and credential fields', () => {
  const output = JSON.stringify(core.normalize(receipt, detail));
  for (const value of ['PRIVATE_CARD', 'PRIVATE_TOKEN', 'PRIVATE_PHONE', 'PRIVATE_ADDRESS', 'TEST_CUSTOMER']) {
    assert.ok(!output.includes(value));
  }
  assert.ok(!output.includes('array_of_payment_mean'));
});

test('known collection envelopes and legacy online orders are supported', () => {
  assert.equal(core.normalize({data: [summary]}, list).length, 1);
  assert.equal(core.normalize({tickets: [summary]}, list).length, 1);
  assert.equal(core.normalize({message: 'Error'}, detail).length, 0);
  assert.equal(core.normalize([], list).length, 0);
  assert.equal(core.normalize(null, list).length, 0);
  const source = core.endpoint('https://api-ayaline.marjane.ma/front/customers/orders');
  const [record] = core.normalize([{uuid: 'TEST_ORDER', reference: 'TEST_REF', total: '12.50',
    created_at: '2026-01-02', status: {code: 'STATUS_DELIVERED'},
    content: [{label: 'Test product', quantity: '2', price: '6.25'}]}], source);
  assert.equal(record.type, 'online');
  assert.equal(record.total, 12.5);
  assert.equal(record.items[0].price, 6.25);
});

test('CSV protects formulas, escapes quotes/newlines and preserves Unicode', () => {
  for (const value of ['=CMD()', '+formula', '-formula', '@formula', '  =formula', '\tfoo']) {
    assert.ok(core.csvCell(value).startsWith('"\''));
  }
  assert.equal(core.csvCell(-2), '"-2"');
  assert.equal(core.csvCell('a"b\nc'), '"a""b\nc"');
  const csv = core.csv(core.normalize(receipt, detail));
  assert.ok(csv.startsWith('\uFEFF"type"'));
  assert.ok(csv.includes('Produit, ""test"" 🛒'));
  assert.equal(csv.split('\r\n').length, 3);
  const summaryCsv = core.csv(core.normalize([summary], list));
  assert.ok(summaryCsv.includes('TEST_TICKET'));
});

function fakeFilter() {
  return {writes: [], closed: false, disconnected: false,
    write(data) { this.writes.push(Buffer.from(data)); },
    close() { this.closed = true; }, disconnect() { this.disconnected = true; }};
}
const asBuffer = bytes => Uint8Array.from(bytes).buffer;

test('stream forwards every original byte, handles split UTF-8, and closes before parsing', () => {
  const bytes = Buffer.from(JSON.stringify(receipt));
  const filter = fakeFilter();
  let parsed;
  observe(filter, {limit: 10000, complete(value) { assert.equal(filter.closed, true); parsed = value; },
    skipped() { assert.fail('Unexpected skip'); }, failed() { assert.fail('Unexpected error'); }});
  for (let i = 0; i < bytes.length; i += 3) filter.ondata({data: asBuffer(bytes.subarray(i, i + 3))});
  filter.onstop();
  assert.deepEqual(Buffer.concat(filter.writes), bytes);
  assert.deepEqual(parsed, receipt);
});

test('oversize capture disconnects only after forwarding the current chunk', () => {
  const filter = fakeFilter();
  let skips = 0;
  observe(filter, {limit: 3, complete() { assert.fail('Must not parse'); },
    skipped() { skips++; }, failed() { assert.fail('Unexpected error'); }});
  filter.ondata({data: asBuffer(Buffer.from('1234'))});
  assert.equal(filter.disconnected, true);
  assert.equal(Buffer.concat(filter.writes).toString(), '1234');
  filter.onstop();
  assert.equal(skips, 1);
});

test('malformed JSON is forwarded and closed; pause and stream errors disconnect', () => {
  const filter = fakeFilter();
  let skips = 0;
  const stop = observe(filter, {limit: 100, complete() { assert.fail(); }, skipped() { skips++; }, failed() {}});
  filter.ondata({data: asBuffer(Buffer.from('<html>error</html>'))});
  filter.onstop();
  stop();
  assert.equal(filter.closed, true);
  assert.equal(skips, 1);
  const second = fakeFilter();
  let errors = 0;
  observe(second, {limit: 100, complete() {}, skipped() {}, failed() { errors++; }});
  second.onerror();
  assert.equal(second.disconnected, true);
  assert.equal(errors, 1);
});
