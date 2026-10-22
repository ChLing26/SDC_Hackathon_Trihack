from pathlib import Path
import sys

# Make the src folder importable
PROJECT_DIR = Path(__file__).resolve().parent
SRC_DIR = PROJECT_DIR / "src"

sys.path.insert(0, str(SRC_DIR))

from src.database_w_input import get_supplier_recommendations

# Replace these with actual values from your database
BUSINESS_ID = 1
ITEM_NAME = "Ballpoint Pens"
QUANTITY = 10

try:
    results = get_supplier_recommendations(
        business_id=BUSINESS_ID,
        item_name=ITEM_NAME,
        quantity=QUANTITY
    )

    print("\n=== Supplier Recommendations ===")
    print("Number of suppliers:", len(results))

    for supplier in results:
        print(supplier)

except Exception as error:
    print("Test failed:", type(error).__name__, error)
