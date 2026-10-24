"""Deterministic supplier-ranking checks using a disposable SQLite fixture."""

from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from src.database import catalogue as catalogue_database
from src.services import catalogue


class RecommendationChecks(unittest.TestCase):
    def test_ranking_uses_quantity_shipping_and_business_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            filename = str(Path(directory) / "recommendation-fixture.db")
            with (
                patch.object(catalogue_database, "DB_NAME", filename),
                patch.object(catalogue, "DB_NAME", filename),
            ):
                catalogue_database.create_database()
                with sqlite3.connect(filename) as connection:
                    connection.executescript("""
                        INSERT INTO businesses VALUES (1, 'Fixture buyer', 'Fixture', 3, 101);
                        INSERT INTO suppliers VALUES (1, 'Fixture A', '', 'Fixture', 3, 101);
                        INSERT INTO suppliers VALUES (2, 'Fixture B', '', 'Fixture', 3, 101);
                        INSERT INTO stationery VALUES (1, 'Ballpoint Pens', 'unit');
                        INSERT INTO supplier_offers VALUES (1, 1, 1, 2, 5, '12:00:00');
                        INSERT INTO supplier_offers VALUES (2, 2, 1, 1, 20, '12:00:00');
                        INSERT INTO supplier_distances VALUES (1, 1, 10, 20, 'OK');
                        INSERT INTO supplier_distances VALUES (1, 2, 5, 10, 'OK');
                    """)
                results = catalogue.get_supplier_recommendations(
                    1, "Ballpoint Pens", 10,
                )
                self.assertEqual(len(results), 2)
                self.assertEqual(
                    [supplier["total_cost_rm"] for supplier in results],
                    [25, 30],
                )
                self.assertEqual([supplier["rank"] for supplier in results], [1, 2])
                self.assertTrue(
                    all(supplier["route_status"] == "OK" for supplier in results)
                )
                self.assertEqual(results[0]["supplier_name"], "Fixture A")
                self.assertEqual(
                    catalogue.get_supplier_recommendations(
                        99, "Ballpoint Pens", 10,
                    ),
                    [],
                )


if __name__ == "__main__":
    unittest.main()
