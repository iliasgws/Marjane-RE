"""mitmproxy addon: persist only redacted purchase-history metadata.

Use allow_hosts for the exact API host as well: filtering here controls logging,
not TLS interception. Never use -w (raw flow export) for this capture procedure.
"""

import json
import os
import re
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit


def target(url):
    parsed = urlsplit(url)
    if parsed.hostname != 'api-ayaline.marjane.ma':
        return None
    path = parsed.path
    if path == '/coral/order':
        template = path
    elif re.fullmatch(r'/customers/[^/]+/tickets/?', path):
        template = '/customers/{customerId}/tickets'
    elif re.fullmatch(r'/customers/[^/]+/tickets/[^/]+/[^/]+/?', path):
        template = '/customers/{customerId}/tickets/{serverId}/{ticketKey}'
    else:
        return None
    query = []
    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        safe = '<redacted>'
        if key in ('page', 'page_size') and re.fullmatch(r'[0-9]{1,6}', value):
            safe = value
        elif key == 'mode' and value == 'Marjane':
            safe = value
        elif key == 'sort[created_at]' and value in ('asc', 'desc'):
            safe = value
        elif key == 'status[]' and re.fullmatch(r'STATUS_[A-Z_]{1,40}', value):
            safe = value
        query.append({'name': key if re.fullmatch(r'[\w\[\]-]{1,80}', key) else '<redacted>',
                      'value': safe})
    return {'host': parsed.hostname, 'path': template, 'query': query}


def shape(value, depth=0):
    if value is None:
        return 'null'
    if isinstance(value, bool):
        return 'boolean'
    if isinstance(value, (int, float)):
        return 'number'
    if isinstance(value, str):
        return 'string'
    if depth >= 7:
        return 'array' if isinstance(value, list) else 'object'
    if isinstance(value, list):
        return {'type': 'array', 'sample': shape(value[0], depth + 1) if value else None}
    if isinstance(value, dict):
        return {key: shape(item, depth + 1) for key, item in list(value.items())[:100]
                if re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]{0,79}', key)}
    return 'unknown'


def header_names(headers):
    return sorted({key.lower() for key in headers.keys()
                   if re.fullmatch(r'[A-Za-z0-9-]{1,80}', key)})


class HistoryObserver:
    def emit(self, event):
        path = Path(os.environ['MARJANE_CAPTURE_PATH'])
        with path.open('a', encoding='utf-8') as output:
            output.write(json.dumps(event, ensure_ascii=False) + '\n')

    def running(self):
        self.emit({'event': 'proxy-ready', 'scope': 'Marjane history only'})

    def request(self, flow):
        match = target(flow.request.pretty_url)
        if match:
            self.emit({'event': 'request', 'target': match, 'method': flow.request.method,
                       'headerNames': header_names(flow.request.headers)})

    def response(self, flow):
        match = target(flow.request.pretty_url)
        if not match:
            return
        event = {'event': 'response', 'target': match, 'status': flow.response.status_code,
                 'headerNames': header_names(flow.response.headers)}
        content_range = flow.response.headers.get('content-range')
        if content_range is not None:
            event['contentRangeFormat'] = re.sub(r'\d+', '#', content_range)[:100]
        limit = 262144
        try:
            if len(flow.response.raw_content or b'') > limit:
                event['body'] = 'skipped: size limit'
            else:
                content = flow.response.content or b''
                if len(content) > limit:
                    event['body'] = 'skipped: size limit'
                else:
                    event['bodyShape'] = shape(json.loads(content))
        except (ValueError, UnicodeError):
            event['body'] = 'not JSON'
        self.emit(event)

    def error(self, flow):
        match = target(flow.request.pretty_url)
        if match:
            # Exception messages can contain private URLs; deliberately omit.
            self.emit({'event': 'proxy-error', 'target': match})


addons = [HistoryObserver()]
