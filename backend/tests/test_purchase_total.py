"""Regression tests for purchase total recalculation bug fix.

Bug: POST /api/purchases used to return total=price (ignoring quantity).
Fix: total = sum(price * quantity) on both POST and PUT.

Single-test flow to be safe under pytest-xdist (no module-scoped shared state).
"""


def test_purchase_total_recalc_post_and_put(auth_client, base_url):
    # 1. create market
    mr = auth_client.post(f"{base_url}/api/markets", json={
        "name": "TEST_TotalRecalc", "icon": "store", "color": "#059669"
    })
    assert mr.status_code == 200, mr.text
    market_id = mr.json()["id"]

    # 2. POST purchase: qty=3, price=10000 -> total must be 30000 (bug fix)
    pr = auth_client.post(f"{base_url}/api/purchases", json={
        "market_id": market_id,
        "currency": "PYG",
        "items": [{"name": "X", "quantity": 3, "unit": "un", "price": 10000}]
    })
    assert pr.status_code == 200, pr.text
    d = pr.json()
    assert d["total"] == 30000, f"POST expected total=30000 (10000*3), got {d['total']}"
    assert d["items"][0]["quantity"] == 3
    assert d["items"][0]["price"] == 10000
    pid = d["id"]

    # 3. GET verify persistence
    gr = auth_client.get(f"{base_url}/api/purchases/{pid}")
    assert gr.status_code == 200
    assert gr.json()["total"] == 30000

    # 4. PUT with qty=5 -> total must recompute to 50000
    ur = auth_client.put(f"{base_url}/api/purchases/{pid}", json={
        "market_id": market_id,
        "currency": "PYG",
        "items": [{"name": "X", "quantity": 5, "unit": "un", "price": 10000}]
    })
    assert ur.status_code == 200, ur.text
    ud = ur.json()
    assert ud["total"] == 50000, f"PUT expected total=50000 (10000*5), got {ud['total']}"
    assert ud["items"][0]["quantity"] == 5

    # 5. GET verify updated total persisted
    gr2 = auth_client.get(f"{base_url}/api/purchases/{pid}")
    assert gr2.status_code == 200
    assert gr2.json()["total"] == 50000

    # 6. cleanup
    dr = auth_client.delete(f"{base_url}/api/purchases/{pid}")
    assert dr.status_code == 200
    gr3 = auth_client.get(f"{base_url}/api/purchases/{pid}")
    assert gr3.status_code == 404


def test_purchase_multi_item_total(auth_client, base_url):
    mr = auth_client.post(f"{base_url}/api/markets", json={
        "name": "TEST_MultiItem", "icon": "store", "color": "#059669"
    })
    assert mr.status_code == 200
    market_id = mr.json()["id"]

    pr = auth_client.post(f"{base_url}/api/purchases", json={
        "market_id": market_id,
        "currency": "PYG",
        "items": [
            {"name": "A", "quantity": 2, "unit": "un", "price": 1500},    # 3000
            {"name": "B", "quantity": 1.5, "unit": "kg", "price": 8000},  # 12000
            {"name": "C", "quantity": 4, "unit": "un", "price": 2500},    # 10000
        ]
    })
    assert pr.status_code == 200, pr.text
    d = pr.json()
    assert d["total"] == 25000, f"Expected 3000+12000+10000=25000, got {d['total']}"

    # cleanup
    auth_client.delete(f"{base_url}/api/purchases/{d['id']}")
