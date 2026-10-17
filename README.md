# Marjane Browser Enhanced

Reverse-engineering notes for the Marjane Android app.

## Firefox history exporter

[Install and use the Firefox extension](firefox-extension/README.md) to export
loaded purchase history as JSON or CSV. Uses your existing website login;
no phone, proxy, credentials export or automatic API fetching.
Use **Load ticket details automatically** to open already-listed in-store tickets
one at a time and collect their product rows, with progress and a Stop button.

```sh
python3 scripts/package_extension.py
```

The unsigned ZIP is built under `dist/`. Load it temporarily through Firefox's
`about:debugging#/runtime/this-firefox` page; Firefox 142+ is required.

## Research notes

Start with [purchase history](docs/purchase-history.md): receipt list/detail
requests, response-field mappings, source references and verification gaps.

See also [phone login](docs/authentication.md) for the CAPTCHA/SMS flow and
the subsequent successful owner-assisted browser login.

Offline helpers (no API calls):

```sh
python3 scripts/extract_api.py work/bundle_js -o work/api
python3 scripts/history_requests.py online --filter delivered
python3 -m unittest discover -s tests
```

Generated decompilations live in ignored `work/`. Private device captures belong
in ignored `captures/`; do not commit credentials, tokens or personal receipts.
