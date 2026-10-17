#!/usr/bin/env python3
"""Extract purchase adapter mappings and path *candidates* from hermes-dec output.

This is a lexical evidence index, not a JavaScript interpreter. Paths may be
fragments or unused code; methods, authentication and reachability are not inferred.
Only literal mapping pairs inside named purchase adapters are collected.
"""

import argparse
import hashlib
import json
import re
from pathlib import Path

ADAPTER = re.compile(r"Original name: (ApiPurchase\w*), environment:")
PAIR = re.compile(r"^\s*r\d+ = \['([^']+)', '([^']+)'\];$")
EXPORT = re.compile(r"\['(ApiPurchase\w*)'\] =")
PATH = re.compile(r"^\s*r\d+ = '(/[^'\s]+)';$")


def extract(lines):
    adapters = {}
    paths = {}
    active = None
    for number, line in enumerate(lines, 1):
        match = ADAPTER.search(line)
        if match:
            active = match.group(1)
            adapters[active] = {"line": number, "mappings": []}
        if active:
            match = PAIR.match(line)
            if match:
                adapters[active]["mappings"].append({
                    "source": match.group(1), "target": match.group(2),
                    "line": number,
                })
            match = EXPORT.search(line)
            if match and match.group(1) == active:
                adapters[active]["end_line"] = number
                active = None
        match = PATH.match(line)
        if match:
            paths.setdefault(match.group(1), []).append(number)
    return {"purchase_adapters": adapters, "path_candidates": paths}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", nargs="?", type=Path, default=Path("work/bundle_js"))
    parser.add_argument("-o", "--output", type=Path, default=Path("work/api"))
    args = parser.parse_args()
    data = args.bundle.read_bytes()
    result = extract(data.decode("utf-8", errors="replace").splitlines())
    result["source_sha256"] = hashlib.sha256(data).hexdigest()
    result["limitations"] = (
        "Lexical index only. Paths are candidates/fragments, not confirmed endpoints. "
        "Mappings omit transforms; inspect cited source lines. No network requests."
    )
    args.output.mkdir(parents=True, exist_ok=True)
    target = args.output / "evidence.json"
    target.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(f"{len(result['purchase_adapters'])} adapters; "
          f"{len(result['path_candidates'])} path candidates; wrote {target}")


if __name__ == "__main__":
    main()
