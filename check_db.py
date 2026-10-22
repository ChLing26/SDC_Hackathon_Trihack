
import sqlite3
from pathlib import Path

# Find the database inside the src folder
db_path = (
    Path(__file__).resolve().parent
    / "src"
    / "business_supplier_selection.db"
)

print("Database path:", db_path)
print("Database exists:", db_path.exists())

if not db_path.exists():
    raise FileNotFoundError(
        f"Database not found: {db_path}"
    )

with sqlite3.connect(db_path) as conn:
    tables = conn.execute("""
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
        ORDER BY name
    """).fetchall()

    print("\n=== Database Tables ===")

    for (table_name,) in tables:
        print(f"\nTable: {table_name}")

        columns = conn.execute(
            f'PRAGMA table_info("{table_name}")'
        ).fetchall()

        for column in columns:
            print(
                f"  Column: {column[1]}, "
                f"Type: {column[2]}"
            )

print("\nDatabase inspection complete.")


with sqlite3.connect(db_path) as conn:
    print("\n=== Businesses ===")
    for row in conn.execute("""
        SELECT business_id, business_name
        FROM businesses
    """):
        print(row)

    print("\n=== Stationery Items ===")
    for row in conn.execute("""
        SELECT item_id, item_name, unit
        FROM stationery
    """):
        print(row)
