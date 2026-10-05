"""Shopping Lists + Products History tests (new feature)"""
import pytest
from datetime import datetime, timedelta, timezone


_STATE = {"list": {}, "item": {}}


@pytest.fixture
def market_id(auth_client, base_url):
    if "market_id" not in _STATE:
        r = auth_client.post(f"{base_url}/api/markets", json={"name": "TEST_SL_Market", "color": "#059669"})
        assert r.status_code == 200
        _STATE["market_id"] = r.json()["id"]
    return _STATE["market_id"]


@pytest.fixture
def second_market_id(auth_client, base_url):
    if "second_market_id" not in _STATE:
        r = auth_client.post(f"{base_url}/api/markets", json={"name": "TEST_SL_Market2", "color": "#DC2626"})
        assert r.status_code == 200
        _STATE["second_market_id"] = r.json()["id"]
    return _STATE["second_market_id"]


@pytest.fixture
def list_state():
    return _STATE["list"]


@pytest.fixture
def item_state():
    return _STATE["item"]


# --- Products history seed (create purchases at two markets for the same items) ---
def test_seed_purchases_for_history(auth_client, base_url, market_id, second_market_id):
    r1 = auth_client.post(f"{base_url}/api/purchases", json={
        "market_id": market_id, "currency": "PYG",
        "items": [
            {"name": "Leche", "quantity": 1, "unit": "un", "price": 8000, "category": "lacteos"},
            {"name": "Manzana", "quantity": 1, "unit": "kg", "price": 15000, "category": "frutas"},
        ]
    })
    assert r1.status_code == 200, r1.text
    r2 = auth_client.post(f"{base_url}/api/purchases", json={
        "market_id": second_market_id, "currency": "PYG",
        "items": [
            {"name": "Leche", "quantity": 1, "unit": "un", "price": 7500, "category": "lacteos"},
        ]
    })
    assert r2.status_code == 200, r2.text


# --- /products/history ---
def test_products_history_returns_aggregated_and_cheapest(auth_client, base_url):
    r = auth_client.get(f"{base_url}/api/products/history")
    assert r.status_code == 200
    products = r.json()
    assert isinstance(products, list) and len(products) >= 1
    names = [p["name"].lower() for p in products]
    assert "leche" in names
    leche = next(p for p in products if p["name"].lower() == "leche")
    # Multi-market -> prices sorted cheapest first
    assert len(leche["prices"]) >= 2
    assert leche["prices"][0]["price"] <= leche["prices"][1]["price"]
    assert leche["cheapest_market_name"] is not None
    assert leche["cheapest_price"] == leche["prices"][0]["price"]


def test_products_history_search_filter(auth_client, base_url):
    r = auth_client.get(f"{base_url}/api/products/history", params={"q": "manz"})
    assert r.status_code == 200
    products = r.json()
    assert len(products) >= 1
    assert all("manz" in p["name"].lower() for p in products)


def test_products_history_returns_list_of_prices_with_cheapest(auth_client, base_url):
    r = auth_client.get(f"{base_url}/api/products/history")
    assert r.status_code == 200
    products = r.json()
    leche = next(p for p in products if p["name"].lower() == "leche")
    assert isinstance(leche["prices"], list)
    assert len(leche["prices"]) >= 2
    assert leche["prices"][0]["price"] <= leche["prices"][1]["price"]
    assert leche["cheapest_price"] == leche["prices"][0]["price"]


# --- Shopping Lists CRUD ---
def test_create_shopping_list(auth_client, base_url, list_state):
    r = auth_client.post(f"{base_url}/api/shopping-lists", json={"name": "TEST_ListaSemana", "currency": "PYG"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["name"] == "TEST_ListaSemana"
    assert d["currency"] == "PYG"
    assert d["items"] == []
    assert d["id"]
    list_state["id"] = d["id"]


def test_list_shopping_lists_contains_new(auth_client, base_url, list_state):
    r = auth_client.get(f"{base_url}/api/shopping-lists")
    assert r.status_code == 200
    ids = [x["id"] for x in r.json()]
    assert list_state["id"] in ids


def test_get_shopping_list_by_id(auth_client, base_url, list_state):
    r = auth_client.get(f"{base_url}/api/shopping-lists/{list_state['id']}")
    assert r.status_code == 200
    assert r.json()["id"] == list_state["id"]


def test_get_shopping_list_other_user_404(anon_client, base_url, list_state):
    # anon (no auth) is 401; use auth_client with random id to prove 404
    r = anon_client.get(f"{base_url}/api/shopping-lists/{list_state['id']}")
    assert r.status_code == 401


def test_get_nonexistent_list_returns_404(auth_client, base_url):
    r = auth_client.get(f"{base_url}/api/shopping-lists/does-not-exist")
    assert r.status_code == 404


# --- Items: add / update / delete ---
def test_add_item_to_list(auth_client, base_url, list_state, item_state):
    r = auth_client.post(
        f"{base_url}/api/shopping-lists/{list_state['id']}/items",
        json={"name": "Leche", "quantity": 2, "unit": "un", "category": "lacteos"},
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert len(d["items"]) == 1
    it = d["items"][0]
    assert it["name"] == "Leche"
    assert it["status"] == "pending"
    assert it["paid_price"] is None
    assert it["estimated_price"] == 7500
    assert it["estimated_market_id"] == _STATE["second_market_id"]
    assert it["estimated_market_name"] == "TEST_SL_Market2"
    item_state["id"] = it["id"]


def test_add_second_item(auth_client, base_url, list_state):
    r = auth_client.post(
        f"{base_url}/api/shopping-lists/{list_state['id']}/items",
        json={"name": "Pan", "quantity": 1, "unit": "un", "category": "panaderia"},
    )
    assert r.status_code == 200
    assert len(r.json()["items"]) == 2


def test_update_item_bought_stamps_market_and_date(auth_client, base_url, list_state, item_state, market_id):
    r = auth_client.put(
        f"{base_url}/api/shopping-lists/{list_state['id']}/items/{item_state['id']}",
        json={"status": "bought", "paid_price": 8500, "paid_market_id": market_id},
    )
    assert r.status_code == 200, r.text
    d = r.json()
    it = next(x for x in d["items"] if x["id"] == item_state["id"])
    assert it["status"] == "bought"
    assert it["paid_price"] == 8500
    assert it["paid_market_id"] == market_id
    assert it["paid_market_name"] == "TEST_SL_Market"
    assert it["paid_at"] is not None
    assert it["estimated_price"] == 7500
    assert it["estimated_market_name"] == "TEST_SL_Market2"


def test_update_item_back_to_pending_resets_paid_fields(auth_client, base_url, list_state, item_state):
    r = auth_client.put(
        f"{base_url}/api/shopping-lists/{list_state['id']}/items/{item_state['id']}",
        json={"status": "pending"},
    )
    assert r.status_code == 200, r.text
    d = r.json()
    it = next(x for x in d["items"] if x["id"] == item_state["id"])
    assert it["status"] == "pending"
    assert it["paid_price"] is None
    assert it["paid_market_id"] is None
    assert it["paid_market_name"] is None
    assert it["paid_at"] is None


def test_update_item_status_unavailable(auth_client, base_url, list_state, item_state):
    r = auth_client.put(
        f"{base_url}/api/shopping-lists/{list_state['id']}/items/{item_state['id']}",
        json={"status": "unavailable"},
    )
    assert r.status_code == 200
    it = next(x for x in r.json()["items"] if x["id"] == item_state["id"])
    assert it["status"] == "unavailable"


def test_delete_item(auth_client, base_url, list_state, item_state):
    r = auth_client.delete(f"{base_url}/api/shopping-lists/{list_state['id']}/items/{item_state['id']}")
    assert r.status_code == 200
    d = r.json()
    assert all(x["id"] != item_state["id"] for x in d["items"])


def test_delete_shopping_list(auth_client, base_url, list_state):
    r = auth_client.delete(f"{base_url}/api/shopping-lists/{list_state['id']}")
    assert r.status_code == 200
    # verify gone
    r2 = auth_client.get(f"{base_url}/api/shopping-lists/{list_state['id']}")
    assert r2.status_code == 404


def test_complete_list_imports_only_bought_once_and_reports_spend(auth_client, base_url, market_id):
    list_response = auth_client.post(
        f"{base_url}/api/shopping-lists",
        json={"name": "TEST_ImportarLista", "currency": "PYG"},
    )
    assert list_response.status_code == 200, list_response.text
    shopping_list = list_response.json()
    list_id = shopping_list["id"]
    created_purchase_ids = []

    try:
        item_ids = {}
        for item in [
            {"name": "Importar leche", "category": "lista_import_regression", "quantity": 2},
            {"name": "Importar arroz", "category": "lista_import_regression", "quantity": 1},
            {"name": "Pendiente excluido", "category": "lista_import_regression", "quantity": 1},
            {"name": "No disponible excluido", "category": "lista_import_regression", "quantity": 1},
        ]:
            added = auth_client.post(
                f"{base_url}/api/shopping-lists/{list_id}/items", json=item
            )
            assert added.status_code == 200, added.text
            item_ids[item["name"]] = added.json()["items"][-1]["id"]

        bought_values = [
            ("Importar leche", 100),
            ("Importar arroz", 300),
        ]
        for name, price in bought_values:
            updated = auth_client.put(
                f"{base_url}/api/shopping-lists/{list_id}/items/{item_ids[name]}",
                json={"status": "bought", "paid_price": price, "paid_market_id": market_id},
            )
            assert updated.status_code == 200, updated.text

        unavailable_item_id = item_ids["No disponible excluido"]
        unavailable = auth_client.put(
            f"{base_url}/api/shopping-lists/{list_id}/items/{unavailable_item_id}",
            json={"status": "unavailable"},
        )
        assert unavailable.status_code == 200, unavailable.text

        current_month = datetime.now(timezone.utc).strftime("%Y-%m")
        report_before = auth_client.get(
            f"{base_url}/api/reports/monthly", params={"month": current_month}
        ).json()
        response = auth_client.post(f"{base_url}/api/shopping-lists/{list_id}/complete")
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["imported_count"] == 2
        assert len(result["purchases"]) == 1
        purchase = result["purchases"][0]
        created_purchase_ids.append(purchase["id"])
        assert purchase["name"] == shopping_list["name"]
        assert purchase["total"] == 500
        assert {item["name"] for item in purchase["items"]} == {
            "Importar leche", "Importar arroz"
        }
        assert result["list"]["items"][
            next(i for i, item in enumerate(result["list"]["items"]) if item["name"] == "Importar leche")
        ]["imported_purchase_id"] == purchase["id"]
        assert next(item for item in result["list"]["items"] if item["name"] == "Pendiente excluido")["status"] == "pending"
        assert next(item for item in result["list"]["items"] if item["name"] == "No disponible excluido")["status"] == "unavailable"

        report_after = auth_client.get(
            f"{base_url}/api/reports/monthly", params={"month": current_month}
        ).json()
        before_category = report_before.get("by_category", {}).get("lista_import_regression", {}).get("PYG", 0)
        after_category = report_after.get("by_category", {}).get("lista_import_regression", {}).get("PYG", 0)
        assert after_category - before_category == 500

        repeated = auth_client.post(f"{base_url}/api/shopping-lists/{list_id}/complete")
        assert repeated.status_code == 200, repeated.text
        assert repeated.json()["imported_count"] == 0
        assert repeated.json()["purchases"] == []

        # The saved list remains reusable: unchecking a bought item starts a new
        # purchase cycle without changing the purchase already in history.
        milk_id = item_ids["Importar leche"]
        pending_again = auth_client.put(
            f"{base_url}/api/shopping-lists/{list_id}/items/{milk_id}",
            json={"status": "pending"},
        )
        assert pending_again.status_code == 200, pending_again.text
        rebought = auth_client.put(
            f"{base_url}/api/shopping-lists/{list_id}/items/{milk_id}",
            json={"status": "bought", "paid_price": 120, "paid_market_id": market_id},
        )
        assert rebought.status_code == 200, rebought.text
        reused = auth_client.post(f"{base_url}/api/shopping-lists/{list_id}/complete")
        assert reused.status_code == 200, reused.text
        assert reused.json()["imported_count"] == 1
        second_purchase = reused.json()["purchases"][0]
        created_purchase_ids.append(second_purchase["id"])
        assert second_purchase["id"] != purchase["id"]
        assert second_purchase["total"] == 240
        assert auth_client.get(f"{base_url}/api/shopping-lists/{list_id}").status_code == 200

        month_purchases = auth_client.get(
            f"{base_url}/api/purchases", params={"month": current_month}
        ).json()
        assert sum(p["id"] == purchase["id"] for p in month_purchases) == 1
        assert sum(p["id"] == second_purchase["id"] for p in month_purchases) == 1
    finally:
        for purchase_id in created_purchase_ids:
            auth_client.delete(f"{base_url}/api/purchases/{purchase_id}")
        auth_client.delete(f"{base_url}/api/shopping-lists/{list_id}")


def test_previous_month_purchases_stay_in_history_and_monthly_report(auth_client, base_url, market_id):
    now = datetime.now(timezone.utc)
    previous_month_date = datetime(now.year, now.month, 1, tzinfo=timezone.utc) - timedelta(days=1)
    previous_month = previous_month_date.strftime("%Y-%m")
    current_month = now.strftime("%Y-%m")
    category = "archive_regression"
    before = auth_client.get(
            f"{base_url}/api/reports/monthly", params={"month": previous_month}
    ).json()
    before_total = before.get("by_category", {}).get(category, {}).get("PYG", 0)

    response = auth_client.post(
            f"{base_url}/api/purchases",
            json={
                "market_id": market_id,
                "currency": "PYG",
                "name": "TEST_CompraArchivada",
                "date": previous_month_date.isoformat(),
                "items": [{"name": "Producto archivado", "price": 123, "category": category}],
            },
    )
    assert response.status_code == 200, response.text
    purchase_id = response.json()["id"]
    try:
            current = auth_client.get(
                f"{base_url}/api/purchases", params={"month": current_month}
            ).json()
            archived = auth_client.get(
                f"{base_url}/api/purchases", params={"month": previous_month}
            ).json()
            assert all(row["id"] != purchase_id for row in current)
            assert any(row["id"] == purchase_id for row in archived)

            report = auth_client.get(
                f"{base_url}/api/reports/monthly", params={"month": previous_month}
            ).json()
            assert report["by_category"][category]["PYG"] - before_total == 123
    finally:
            auth_client.delete(f"{base_url}/api/purchases/{purchase_id}")
