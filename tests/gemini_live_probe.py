"""Opt-in provider-connectivity check using active AI code and synthetic quotes.

Exit 77 means blocked/not run, NOT passed. No response body or secret is printed.
Requires an explicitly authorized live call; normal test discovery excludes it.
"""

import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main():
    if os.environ.get("RUN_LIVE_GEMINI_TEST") != "1":
        print("BLOCKED: live Gemini probe requires explicit RUN_LIVE_GEMINI_TEST=1.")
        return 77
    try:
        import src.services.ai_advisor as ai_advisor
        if ai_advisor.client is None:
            print("BLOCKED: Gemini credential is not configured; no request sent.")
            return 77
        result = ai_advisor.get_smart_advice(
            suppliers=[{
                "name": "Synthetic connectivity fixture",
                "product_price_rm": 20, "shipping_rm": 5,
                "delivery_days": 2, "distance_km": 4,
            }],
            budget=30, max_delivery_days=3, priority="balanced",
        )
        if not isinstance(result, str) or not result.strip():
            print("FAIL: active Gemini code did not return non-empty advice.")
            return 1
    except Exception:
        print("FAIL: live Gemini request failed; provider details suppressed.")
        return 1
    print("PASS: active Gemini code returned advice from a live request. "
          "Connectivity only; recommendation correctness is not certified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
