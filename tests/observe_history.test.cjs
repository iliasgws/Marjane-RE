const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const context = vm.createContext({Java: {perform() {}}});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/observe_history.js'), 'utf8'), context);
const plain = value => JSON.parse(JSON.stringify(value));
const url = (pathname, pairs = [], host = 'api-ayaline.marjane.ma') => ({
  host: () => host, encodedPath: () => pathname, querySize: () => pairs.length,
  queryParameterName: i => pairs[i][0], queryParameterValue: i => pairs[i][1],
});

test('scope excludes unrelated hosts and endpoints', () => {
  assert.equal(context.historyTarget(url('/auth/authenticate')), null);
  assert.equal(context.historyTarget(url('/coral/order', [], 'other.example')), null);
  assert.equal(context.historyTarget(url('/coral/order/ORDER_ID')), null);
});

test('receipt identifiers and arbitrary query values are redacted', () => {
  const result = plain(context.historyTarget(url('/customers/SECRET_CUSTOMER/tickets/STORE/SECRET_TICKET', [
    ['token', 'SECRET_TOKEN'], ['page', '2'], ['reference', 'SECRET_REFERENCE'],
  ])));
  assert.equal(result.path, '/customers/{customerId}/tickets/{serverId}/{ticketKey}');
  assert.equal(result.query[1].value, '2');
  assert.ok(!JSON.stringify(result).includes('SECRET'));
});

test('query whitelist never prints malformed values', () => {
  const result = plain(context.historyTarget(url('/coral/order', [
    ['status[]', 'STATUS_DELIVERED'], ['status[]', 'secret'],
    ['page', 'SECRET'], ['sort[created_at]', 'desc'],
  ])));
  assert.deepEqual(result.query.map(x => x.value), ['STATUS_DELIVERED', '<redacted>', '<redacted>', 'desc']);
});

test('response inspection emits types, not receipt values', () => {
  const result = plain(context.shape({
    ticket: {card_key: 'SECRET_CARD'},
    array_of_item: [{name_item: 'SECRET_PRODUCT', price: 19.95}],
    '123456': 'dynamic map key',
  }, 0));
  assert.equal(result.ticket.card_key, 'string');
  assert.equal(result.array_of_item.sample.price, 'number');
  assert.ok(!Object.hasOwn(result, '123456'));
  assert.ok(!JSON.stringify(result).includes('SECRET'));
});
