"""Deterministic recommendation test; never depends on a real business record."""

from pathlib import Path
import sqlite3
import tempfile
from unittest.mock import patch

from src import database_w_input as catalogue


def run_test():
    with tempfile.TemporaryDirectory() as directory:
        filename = str(Path(directory) / "recommendation-fixture.db")
        with patch.object(catalogue, "DB_NAME", filename):
            catalogue.create_database()
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
            results = catalogue.get_supplier_recommendations(1, "Ballpoint Pens", 10)
            assert len(results) == 2, "Missing expected fixture suppliers."
            assert [supplier["total_cost_rm"] for supplier in results] == [25, 30]
            assert [supplier["rank"] for supplier in results] == [1, 2]
            assert all(supplier["route_status"] == "OK" for supplier in results)
            assert results[0]["supplier_name"] == "Fixture A"
            assert catalogue.get_supplier_recommendations(99, "Ballpoint Pens", 10) == []
    print("Recommendation test passed: quantity, shipping, rank and business isolation.")


if __name__ == "__main__":
    # Assertion/import/DB failures deliberately exit nonzero instead of printing
    # an error and silently reporting script success.
    run_test()
