"""Shopping Lists + Products History tests (new feature)"""
import pytest


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
