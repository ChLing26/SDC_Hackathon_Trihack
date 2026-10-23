"""Fixture-only browser regression checks; no backend, database, or AI calls.

Run with a Python environment providing Playwright and Chromium:
  python tests/browser/supplier_advice.py --url https://<preview-host>/
"""

import argparse
import copy
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


def request_fixture(request_id=91001, currency="MYR"):
    offers = [
        {
            "id": request_id * 10 + i,
            "supplierName": name,
            "supplierLocation": "Fixture warehouse",
            "distanceKm": 20 + i,
            "unitPrice": price,
            "shippingFee": shipping,
            "totalPrice": price * 10 + shipping,
            "currency": currency,
            "deliveryDays": days,
            "reliability": 0.9,
            "overallScore": 80,
            "priceScore": 80,
            "speedScore": 80,
            "proximityScore": 80,
            "reliabilityScore": 80,
            "rank": i,
        }
        for i, (name, price, shipping, days) in enumerate(
            [("Fixture Eligible", 10, 5, 2), ("Fixture Over Budget", 25, 20, 2),
             ("Fixture Late", 8, 5, 9)], 1
        )
    ]
    return {
        "id": request_id, "itemName": f"Fixture paper {request_id}",
        "quantity": 10, "budgetAmount": 200, "currency": currency,
        "requiredDeliveryDate": "2099-12-30", "deliveryLocation": "Fixture office",
        "requesterName": "Fixture requester", "status": "pending_approval",
        "offerCount": len(offers), "selectedSupplier": None,
        "createdAt": "2026-01-01T00:00:00Z", "offers": offers,
        "selectedOfferId": None, "managerName": None, "managerComment": None,
        "invoice": None,
    }


def advice_fixture(record, status="success", anomalies=True, deadline=False, revision=1):
    warnings = [
        {"offerId": record["offers"][1]["id"], "type": "UNUSUALLY_HIGH_SHIPPING",
         "severity": "medium", "message": "Fixture shipping warning for over-budget supplier."},
        {"offerId": record["offers"][2]["id"], "type": "INVALID_ROUTE",
         "severity": "high", "message": "Fixture route warning for late supplier."},
    ] if anomalies else []
    suppliers = []
    for i, offer in enumerate(record["offers"]):
        suppliers.append({
            "offerId": offer["id"], "supplierName": offer["supplierName"],
            "productSubtotal": offer["unitPrice"] * record["quantity"],
            "shippingFee": offer["shippingFee"], "totalPrice": offer["totalPrice"],
            "currency": "MYR", "deliveryDays": offer["deliveryDays"],
            "distanceKm": offer["distanceKm"], "withinBudget": i != 1,
            "meetsDeliveryRequirement": not deadline and i != 2,
            "anomalies": [w for w in warnings if w["offerId"] == offer["id"]],
        })
    return {
        "requestId": record["id"], "generatedAt": f"2026-01-01T00:00:{revision:02d}Z",
        "source": "illustrative_offers", "maxDeliveryDays": 0 if deadline else 3,
        "deadlinePassed": deadline, "deadlinePolicy": "stored_date_utc_midnight",
        "aiStatus": status,
        "advice": f"Fixture advice {record['id']} revision {revision}" if status == "success" else None,
        "suppliers": suppliers, "warnings": warnings,
    }


def run(browser, base_url, output):
    base_url = base_url.rstrip("/")
    origin = urlsplit(base_url)
    context = browser.new_context(
        viewport={"width": 1440, "height": 1000}, service_workers="block"
    )
    page = context.new_page()
    records = {i: request_fixture(i, "USD" if i == 91003 else "MYR")
               for i in (91001, 91002, 91003)}
    state = {"status": "success", "anomalies": True, "deadline": False,
             "revision": 1, "http_error": False, "hold": False}
    calls, forbidden, pending, crashes = [], [], [], []
    page.on("pageerror", lambda error: crashes.append(str(error)))

    def intercept(route):
        req = route.request
        url = urlsplit(req.url)
        # Fail closed before considering any fixtures. No API may reach a server.
        is_api = "/api/" in url.path or url.path.endswith("/api")
        if not is_api:
            if (url.scheme, url.netloc) == (origin.scheme, origin.netloc) and req.method == "GET":
                return route.continue_()
            return route.abort()
        path = url.path[url.path.index("/api"):]
        calls.append({"method": req.method, "path": path, "body": req.post_data})
        if req.method == "GET" and path == "/api/auth/me":
            return route.fulfill(json={"id": 99001, "name": "Fixture Buyer",
                                       "email": "fixture@example.invalid"})
        if req.method == "GET" and path == "/api/procurement/requests":
            return route.fulfill(json=list(records.values()))
        match = re.fullmatch(r"/api/procurement/requests/(\d+)(/advice)?", path)
        if match and int(match[1]) in records:
            record = records[int(match[1])]
            if req.method == "GET" and not match[2]:
                return route.fulfill(json=copy.deepcopy(record))
            if req.method == "POST" and match[2]:
                assert req.post_data_json == {"priority": "balanced"}
                if state["hold"]:
                    pending.append(route)
                    return
                if state["http_error"]:
                    return route.fulfill(status=503, json={"error": "Fixture provider unavailable"})
                return route.fulfill(json=advice_fixture(
                    record, state["status"], state["anomalies"],
                    state["deadline"], state["revision"]
                ))
        forbidden.append(calls[-1])
        return route.fulfill(status=599, json={"error": "Blocked unexpected fixture request"})

    context.route("**/*", intercept)
    panel = page.get_by_test_id("request-advice")
    button = page.get_by_test_id("button-supplier-advice")
    text = page.get_by_test_id("text-supplier-advice")
    passed = []

    def check(name):
        assert not forbidden, forbidden
        assert not crashes, crashes
        passed.append(name)
        print(f"PASS: {name}", flush=True)

    def visit(request_id):
        page.goto(f"{base_url}/requests/{request_id}")
        expect(page.get_by_test_id("text-item-name")).to_have_text(f"Fixture paper {request_id}")
        expect(panel).to_be_visible()

    try:
        visit(91001)
        expect(page.get_by_test_id("text-user-name")).to_have_text("Fixture Buyer")
        expect(text).to_have_count(0)
        assert not [c for c in calls if c["method"] == "POST"]
        check("mocked signed-in detail; no automatic advice call")

        state["hold"] = True
        button.click()
        expect(button).to_be_disabled()
        expect(panel.get_by_role("status")).to_contain_text("Validating totals and eligibility")
        assert len(pending) == 1
        page.screenshot(path=str(output / "loading.png"), full_page=True)
        state["hold"] = False
        pending.pop().fulfill(json=advice_fixture(records[91001]))
        expect(text).to_have_text("Fixture advice 91001 revision 1")
        expect(button).to_be_enabled()
        expect(button).to_have_text("Run checks again")
        eligible = page.get_by_test_id("advice-offer-910011")
        over = page.get_by_test_id("advice-offer-910012")
        late = page.get_by_test_id("advice-offer-910013")
        expect(eligible).to_contain_text("Within budget · Meets delivery estimate")
        expect(eligible).to_contain_text("105.00")
        expect(over).to_contain_text("Over budget")
        expect(over).to_contain_text("Warning: Fixture shipping warning")
        expect(late).to_contain_text("Misses delivery requirement")
        expect(late).to_contain_text("High warning: Fixture route warning")
        expect(eligible).not_to_contain_text("warning")
        expect(over).not_to_contain_text("route warning")
        expect(late).not_to_contain_text("shipping warning")
        expect(panel).to_contain_text("AI advice is informational only")
        expect(page.get_by_test_id("input-manager")).to_have_value("")
        expect(page.get_by_test_id("button-approve")).to_be_disabled()
        page.screenshot(path=str(output / "success.png"), full_page=True)
        check("loading, success, eligibility, isolated per-offer anomalies; manager review unchanged")

        for status in ("unavailable", "failed", "skipped"):
            state["status"] = status
            button.click()
            expect(panel).to_contain_text(f"AI status: {status}")
            expect(text).to_have_text("No AI advice was generated. Eligibility checks remain available.")
            expect(over).to_contain_text("Over budget")
            expect(late).to_contain_text("High warning")
            check(f"AI {status}: eligibility and warnings survive without invented advice")

        state.update(status="success", anomalies=False, revision=2)
        button.click()
        expect(text).to_have_text("Fixture advice 91001 revision 2")
        expect(panel).to_contain_text("No anomalies detected")
        expect(panel).not_to_contain_text("Fixture route warning")
        check("rerun replaces previous result; no-anomaly disclaimer")

        state["deadline"] = True
        button.click()
        expect(panel.get_by_role("alert")).to_have_text(
            "The stored delivery deadline has passed. No offer meets that deadline."
        )
        expect(eligible).to_contain_text("Misses delivery requirement")
        check("expired deadline warning and failed delivery eligibility")

        state.update(http_error=True, deadline=False)
        button.click()
        expect(panel.get_by_role("alert")).to_contain_text("Your procurement data has not changed")
        expect(text).to_have_count(0)
        expect(button).to_be_enabled()
        state.update(http_error=False, revision=3)
        button.click()
        expect(text).to_have_text("Fixture advice 91001 revision 3")
        check("HTTP error hides old result; manual retry recovers")

        # Real client navigation, not a full reload, must discard transient advice.
        page.get_by_test_id("link-back").click()
        expect(page).to_have_url(f"{base_url}/requests")
        page.get_by_role("link", name=re.compile("Fixture paper 91002")).click()
        expect(button).to_have_text("Check stored offers")
        expect(text).to_have_count(0)
        button.click()
        expect(text).to_have_text("Fixture advice 91002 revision 3")
        page.go_back()
        page.get_by_role("link", name=re.compile("Fixture paper 91001")).click()
        expect(text).to_have_count(0)
        button.click()
        expect(text).to_have_text("Fixture advice 91001 revision 3")
        check("client navigation between requests and return clears old advice")

        # Exercise actual 30-second React Query polling on a mounted detail page.
        records[91001]["quantity"] = 12
        records[91001]["budgetAmount"] = 250
        records[91001]["requiredDeliveryDate"] = "2099-12-29"
        records[91001]["offers"][0]["unitPrice"] = 11
        records[91001]["offers"][0]["totalPrice"] = 137
        expect(text).to_have_count(0, timeout=40000)
        expect(button).to_have_text("Check stored offers")
        state["revision"] = 4
        button.click()
        expect(text).to_have_text("Fixture advice 91001 revision 4")
        expect(eligible).to_contain_text("137.00")
        check("background detail refetch resets advice and next run uses fresh fixture")

        page.set_viewport_size({"width": 375, "height": 812})
        panel.scroll_into_view_if_needed()
        expect(button).to_be_visible()
        bounds = panel.bounding_box()
        assert bounds and bounds["x"] >= 0 and bounds["x"] + bounds["width"] <= 376, bounds
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
        page.screenshot(path=str(output / "mobile.png"), full_page=True)
        check("375px advice layout stays inside viewport without horizontal overflow")

        visit(91003)
        expect(button).to_be_disabled()
        expect(panel).to_contain_text("Advice currently supports MYR only. No currency conversion is performed.")
        expect(text).to_have_count(0)
        assert not [c for c in calls if c["path"].endswith("/91003/advice")]
        check("non-MYR detail disables advice without a provider request")

        visit(91001)
        expect(text).to_have_count(0)
        button.click()
        expect(text).to_have_text("Fixture advice 91001 revision 4")
        # Currency change on the mounted page must also discard a prior MYR result.
        records[91001]["currency"] = "USD"
        expect(button).to_be_disabled(timeout=40000)
        expect(text).to_have_count(0)
        expect(panel).to_contain_text("No currency conversion is performed")
        check("background currency change removes stale MYR advice")
    finally:
        report = {"passed": passed, "apiCalls": calls, "forbiddenRequests": forbidden,
                  "pageErrors": crashes, "isolation": "All API calls fulfilled in browser; no real sessions/providers/database"}
        (output / "report.json").write_text(json.dumps(report, indent=2))
        context.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", default="generated-artifacts/supplier-advice")
    parser.add_argument("--executable", help="Optional system Chromium executable for this environment")
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.executable)
        try:
            run(browser, args.url, output)
        finally:
            browser.close()
