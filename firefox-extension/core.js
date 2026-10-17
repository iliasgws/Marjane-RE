/* Local normalization only. No network, cookies, headers, storage or DOM access. */
(function (root) {
  'use strict';
  const HOSTS = new Set(['www.marjane.ma', 'marjane.ma', 'api-ayaline.marjane.ma']);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, 2000) : '';
  const first = (...values) => values.find(value => value !== undefined && value !== null && value !== '');
  function number(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value.trim())) return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }
  function endpoint(raw) {
    let url;
    try { url = new URL(raw); } catch (_) { return null; }
    if (url.protocol !== 'https:' || !HOSTS.has(url.hostname)) return null;
    const path = url.pathname.replace(/\/$/, '');
    if (path === '/coral/order' || path === '/front/customers/orders' || path === '/customers/services/documents/order') {
      return {kind: 'online-list', template: path};
    }
    if (/^\/coral\/order\/[^/]+$/.test(path)) return {kind: 'online-detail', template: '/coral/order/{orderId}'};
    if (/^\/customers\/services\/documents\/order\/[^/]+$/.test(path)) {
      return {kind: 'online-detail', template: '/customers/services/documents/order/{orderId}'};
    }
    const match = path.match(/^\/customers\/([^/]+)\/tickets(?:\/([^/]+)\/([^/]+))?$/);
    if (match) return {
      kind: match[3] ? 'receipt-detail' : 'receipt-list',
      template: match[3] ? '/customers/{customerId}/tickets/{serverId}/{ticketKey}' : '/customers/{customerId}/tickets',
      // Identity hints are used for deduplication, never exported as raw URLs.
      serverHint: match[2] ? decodeSafe(match[2]) : '',
      ticketHint: match[3] ? decodeSafe(match[3]) : ''
    };
    return null;
  }
  function decodeSafe(value) {
    try { return decodeURIComponent(value); } catch (_) { return value; }
  }
  function item(value) {
    if (!object(value)) return null;
    const product = object(value.product) ? value.product : {};
    return {
      name: text(first(value.name_item, value.title, value.label, value.name, product.label, product.name)),
      productCode: text(first(value.product_code, value.productCode, value.code, product.code)),
      quantity: number(value.quantity),
      price: number(first(value.price, value.unit_price, value.unitPrice)),
      lineTotal: number(first(value.total, value.total_price, value.totalPrice))
    };
  }
  function receipt(value, source) {
    if (!object(value)) return null;
    const ticket = object(value.ticket) ? value.ticket : value;
    if (!ticket.ticket_key && !ticket.ticketNumber && !Array.isArray(value.array_of_item)) return null;
    const id = text(first(ticket.ticket_key, ticket.ticketNumber, source.ticketHint));
    if (!id) return null;
    const storeId = text(first(ticket.server, ticket.shop?.id, source.serverHint));
    const items = Array.isArray(value.array_of_item) ? value.array_of_item : null;
    return {
      type: 'in-store', id, storeId,
      store: text(first(ticket.server_label, ticket.shop?.title)),
      date: text(first(ticket.create, ticket.date)),
      status: text(ticket.status),
      total: number(first(value.ticket_total, ticket.ticket_total_price, ticket.total)),
      totalDiscount: number(value.ticket_total_discount),
      detailsLoaded: source.kind === 'receipt-detail',
      items: items ? items.slice(0, 2000).map(item).filter(Boolean) : [],
      source: source.template
    };
  }
  function order(value, source) {
    if (!object(value)) return null;
    const id = text(first(value.uuid, value.reference, value.id));
    if (!id) return null;
    const items = first(value.content, value.contents, value.items);
    return {
      type: 'online', id, reference: text(first(value.reference, value.code)),
      storeId: text(first(value.entity?.id, value.entityId)),
      store: text(first(value.entity?.label, value.entity?.name)),
      date: text(first(value.created_at, value.createdAt, value.createdDate, value.date)),
      status: text(object(value.status) ? value.status.code : value.status),
      total: number(first(value.total, value.totalAmount)),
      totalDiscount: number(value.total_discount),
      detailsLoaded: source.kind === 'online-detail' || Array.isArray(items),
      items: Array.isArray(items) ? items.slice(0, 2000).map(item).filter(Boolean) : [],
      source: source.template
    };
  }
  function normalize(payload, source) {
    // Unwrap only known collection envelopes. Never traverse arbitrary profile,
    // config or authentication responses looking for something that resembles a receipt.
    let data = payload;
    if (object(data) && Object.hasOwn(data, 'data')) data = data.data;
    if (source.kind.endsWith('-list') && object(data)) {
      data = first(data.tickets, data.orders, data.results);
    }
    const values = Array.isArray(data) ? data : source.kind.endsWith('-detail') && object(data) ? [data] : [];
    const convert = source.kind.startsWith('receipt') ? receipt : order;
    return values.slice(0, 1000).map(value => convert(value, source)).filter(Boolean);
  }
  function key(record) { return JSON.stringify([record.type, record.storeId, record.id]); }
  function merge(previous, incoming) {
    if (!previous) return incoming;
    // A repeated summary must not erase products already loaded from a detail page.
    const rich = previous.detailsLoaded && !incoming.detailsLoaded ? previous : incoming;
    const other = rich === previous ? incoming : previous;
    const result = {...other, ...rich};
    for (const field of ['date', 'store', 'storeId', 'status', 'reference']) {
      if (!result[field] && other[field]) result[field] = other[field];
    }
    for (const field of ['total', 'totalDiscount']) {
      if (result[field] == null && other[field] != null) result[field] = other[field];
    }
    return result;
  }
  const COLUMNS = ['type', 'purchase_id', 'reference', 'date', 'store_id', 'store', 'status',
    'purchase_total', 'total_discount', 'details_loaded', 'product', 'product_code', 'quantity', 'price', 'line_total'];
  function csvCell(value) {
    let content = value == null ? '' : String(value);
    // Quoting alone does not prevent spreadsheet formula injection.
    if (typeof value === 'string' && (/^\s*[=+\-@]/.test(content) || /^[\t\r\n]/.test(content))) content = "'" + content;
    return '"' + content.replace(/"/g, '""') + '"';
  }
  function csv(records) {
    const rows = [COLUMNS];
    for (const record of records) {
      const items = record.items.length ? record.items : [{}];
      for (const entry of items) rows.push([
        record.type, record.id, record.reference, record.date, record.storeId, record.store, record.status,
        record.total, record.totalDiscount, record.detailsLoaded, entry.name, entry.productCode,
        entry.quantity, entry.price, entry.lineTotal
      ]);
    }
    return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  const api = {endpoint, normalize, key, merge, csv, csvCell};
  root.MarjaneExport = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
