/* Frida CLI script: purchase-history metadata only. No token/header values,
 * customer IDs, ticket IDs, product names or response scalar values are sent.
 * Only the known API host and three history path patterns are observed.
 * peekBody reads a bounded copy, never consumes/replaces the app response body.
 */
'use strict';

function historyTarget(url) {
  if (String(url.host()) !== 'api-ayaline.marjane.ma') return null;
  const path = String(url.encodedPath());
  let template;
  if (path === '/coral/order') template = path;
  else if (/^\/customers\/[^/]+\/tickets\/?$/.test(path)) {
    template = '/customers/{customerId}/tickets';
  } else if (/^\/customers\/[^/]+\/tickets\/[^/]+\/[^/]+\/?$/.test(path)) {
    template = '/customers/{customerId}/tickets/{serverId}/{ticketKey}';
  } else return null;
  const query = [];
  for (let i = 0; i < url.querySize(); i++) {
    const name = String(url.queryParameterName(i));
    const raw = String(url.queryParameterValue(i));
    let value = '<redacted>';
    if ((name === 'page' || name === 'page_size') && /^\d{1,6}$/.test(raw)) value = raw;
    if (name === 'mode' && raw === 'Marjane') value = raw;
    if (name === 'sort[created_at]' && /^(asc|desc)$/.test(raw)) value = raw;
    if (name === 'status[]' && /^STATUS_[A-Z_]{1,40}$/.test(raw)) value = raw;
    query.push({name: /^[\w\[\]-]{1,80}$/.test(name) ? name : '<redacted>', value});
  }
  return {host: 'api-ayaline.marjane.ma', path: template, query};
}

function headerNames(headers) {
  const names = new Set();
  for (let i = 0; i < headers.size(); i++) {
    const name = String(headers.name(i)).toLowerCase();
    names.add(/^[a-z0-9-]{1,80}$/.test(name) ? name : '<redacted>');
  }
  return Array.from(names).sort();
}

function shape(value, depth) {
  if (value === null) return 'null';
  if (depth >= 7) return Array.isArray(value) ? 'array' : typeof value;
  if (Array.isArray(value)) return {type: 'array', sample: value.length ? shape(value[0], depth + 1) : null};
  if (typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).slice(0, 100)) {
      // Do not emit arbitrary dynamic map keys, which could be customer IDs.
      if (/^[A-Za-z_][A-Za-z_0-9]{0,79}$/.test(key)) result[key] = shape(value[key], depth + 1);
    }
    return result;
  }
  return typeof value;
}

Java.perform(function () {
  try {
    const RealCall = Java.use('okhttp3.internal.connection.RealCall');
    const method = RealCall['getResponseWithInterceptorChain$okhttp'].overload();
    method.implementation = function () {
      let target = null;
      let request;
      try {
        request = this.request();
        target = historyTarget(request.url());
        if (target) send({event: 'request', target, method: String(request.method()),
                          headerNames: headerNames(request.headers())});
      } catch (_) { /* Observation must not interrupt the request. */ }
      let response;
      try {
        response = method.call(this);
      } catch (error) {
        if (target) send({event: 'network-error', target}); // Exception text may contain a URL.
        throw error;
      }
      if (target) {
        try {
          const event = {event: 'response', target, status: response.code(),
                         headerNames: headerNames(response.headers())};
          const contentRange = response.header('content-range');
          // Preserve format only, not counts.
          if (contentRange !== null) event.contentRangeFormat = String(contentRange)
            .replace(/\d+/g, '#').replace(/[^A-Za-z#*\/ -]/g, '?').slice(0, 100);
          const body = response.body();
          if (body !== null) {
            const limit = 262144;
            const length = Number(body.contentLength());
            if (length > limit) event.body = 'skipped: size limit';
            else {
              const copy = response.peekBody(limit + 1);
              try {
                if (Number(copy.contentLength()) > limit) event.body = 'skipped: size limit';
                else {
                  try { event.bodyShape = shape(JSON.parse(String(copy.string())), 0); }
                  catch (_) { event.body = 'not JSON'; }
                }
              } finally { copy.close(); }
            }
          }
          send(event);
        } catch (_) { send({event: 'observation-error', target}); }
      }
      return response;
    };
    send({event: 'ready', scope: 'Marjane purchase history only'});
  } catch (_) {
    send({event: 'setup-error', reason: 'Expected OkHttp class/method unavailable'});
  }
});
