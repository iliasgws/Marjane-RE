#!/usr/bin/env python3
"""Package only the extension's explicit public runtime files; no private captures."""
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'firefox-extension'
FILES = ('manifest.json', 'core.js', 'capture.js', 'automation.js', 'detail-controls.js', 'background.js', 'popup.html',
         'popup.js', 'popup.css', 'icon.svg', 'README.md')


def main():
    manifest = json.loads((SOURCE / 'manifest.json').read_text())
    version = manifest['version']
    if not all(part.isdigit() for part in version.split('.')):
        raise ValueError('Unexpected version format')
    output = ROOT / 'dist' / f'marjane-history-exporter-{version}.zip'
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in FILES:
            archive.write(SOURCE / name, name)
    print(output)


if __name__ == '__main__':
    main()
