import sqlite3

from src.database.connection import database_connection
from src.services.numbers import checked_quantity, checked_total

DB_NAME = None


def _database_path():
    if DB_NAME is not None:
        return DB_NAME
    from src.database import catalogue as catalogue_database
    return catalogue_database.DB_NAME


def get_supplier_recommendations(
    business_id: int,
    item_name: str,
    quantity: float,
) -> list[dict]:
    """Return eligible supplier offers ordered by calculated total cost."""
    checked_quantity(quantity)
    with database_connection(_database_path()) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("""
            SELECT
                s.supplier_name,
                p.item_name,
                p.unit,
                o.unit_price,
                o.delivery_fee,
                o.delivery_time,
                d.road_distance_km,
                d.driving_duration_min,
                d.route_status
            FROM supplier_offers o
            JOIN suppliers s ON o.supplier_id = s.supplier_id
            JOIN stationery p ON o.item_id = p.item_id
            JOIN supplier_distances d ON d.supplier_id = s.supplier_id
            WHERE d.business_id = ?
              AND p.item_name = ?
              AND d.route_status = 'OK'
        """, (business_id, item_name)).fetchall()

    recommendations = []
    for row in rows:
        item = dict(row)
        item["quantity"] = quantity
        item["total_cost_rm"] = checked_total(
            item["unit_price"], item["delivery_fee"], quantity,
        )
        recommendations.append(item)
    recommendations.sort(key=lambda item: item["total_cost_rm"])
    for rank, item in enumerate(recommendations, start=1):
        item["rank"] = rank
    return recommendations
