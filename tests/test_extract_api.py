import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "extract_api", Path(__file__).resolve().parents[1] / "scripts/extract_api.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ExtractionTests(unittest.TestCase):
    def test_adapter_scope_and_duplicate_path_locations(self):
        result = module.extract([
            "r0 = ['outside', 'ignored'];",
            "r2 = function() { // Original name: ApiPurchaseToPurchaseAdapter, environment: r0",
            "    r0 = ['ticket_key', 'ticketNumber'];",
            "r2['ApiPurchaseToPurchaseAdapter'] = r6;",
            "r0 = ['after', 'ignored'];",
            "    r1 = '/{id}/tickets';",
            "    r0 = '/{id}/tickets';",
        ])
        adapter = result['purchase_adapters']['ApiPurchaseToPurchaseAdapter']
        self.assertEqual(adapter['mappings'], [
            {'source': 'ticket_key', 'target': 'ticketNumber', 'line': 3}
        ])
        self.assertEqual(result['path_candidates'], {'/{id}/tickets': [6, 7]})

    def test_no_invented_endpoints_or_mappings(self):
        result = module.extract(["r0 = r1.concat(r2);", "r0 = '/has spaces';"])
        self.assertEqual(result, {'purchase_adapters': {}, 'path_candidates': {}})


if __name__ == '__main__':
    unittest.main()
