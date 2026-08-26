"""Despensa backend API tests"""
import base64, pytest

# --- Currencies ---
def test_currencies_returns_5_including_pyg(anon_client, base_url):
    r = anon_client.get(f"{base_url}/api/currencies")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list) and len(data) == 5
    codes = [c["code"] for c in data]
    assert set(codes) == {"PYG", "USD", "EUR", "BRL", "ARS"}
    pyg = next(c for c in data if c["code"] == "PYG")
    assert pyg["symbol"] == "₲" and pyg["decimals"] == 0

# --- Auth ---
def test_auth_session_rejects_invalid_session_id(anon_client, base_url):
    r = anon_client.post(f"{base_url}/api/auth/session", json={"session_id": "invalid_xyz_zzz"})
    assert r.status_code == 401

def test_authenticated_endpoint_requires_bearer(anon_client, base_url):
    r = anon_client.get(f"{base_url}/api/markets")
    assert r.status_code == 401

def test_auth_me_works_with_seeded_token(auth_client, base_url):
    r = auth_client.get(f"{base_url}/api/auth/me")
    assert r.status_code == 200
    d = r.json()
    assert d["email"] == "test_despensa@example.com"
    assert d["preferred_currency"] == "PYG"

# --- Markets CRUD ---
@pytest.fixture(scope="module")
def market_state():
    return {}

def test_markets_create(auth_client, base_url, market_state):
    r = auth_client.post(f"{base_url}/api/markets", json={"name": "TEST_Superseis", "icon": "store", "color": "#059669"})
    assert r.status_code == 200
    d = r.json()
    assert d["name"] == "TEST_Superseis" and d["id"]
    market_state["id"] = d["id"]

def test_markets_list_contains_created(auth_client, base_url, market_state):
    r = auth_client.get(f"{base_url}/api/markets")
    assert r.status_code == 200
    ids = [m["id"] for m in r.json()]
    assert market_state["id"] in ids

def test_markets_update(auth_client, base_url, market_state):
    mid = market_state["id"]
    r = auth_client.put(f"{base_url}/api/markets/{mid}", json={"name": "TEST_Stock"})
    assert r.status_code == 200
    assert r.json()["name"] == "TEST_Stock"

# --- Purchases CRUD ---
@pytest.fixture(scope="module")
def purchase_state():
    return {}

def test_purchase_create_requires_valid_market(auth_client, base_url):
    r = auth_client.post(f"{base_url}/api/purchases", json={
        "market_id": "nonexistent-market",
        "currency": "PYG",
        "items": [{"name": "Leche", "quantity": 1, "unit": "un", "price": 5000}]
    })
    assert r.status_code == 404

def test_purchase_create_ok(auth_client, base_url, market_state, purchase_state):
    r = auth_client.post(f"{base_url}/api/purchases", json={
        "market_id": market_state["id"],
        "currency": "PYG",
        "items": [
            {"name": "Leche", "quantity": 2, "unit": "un", "price": 5000, "category": "lacteos"},
            {"name": "Manzana", "quantity": 1.5, "unit": "kg", "price": 12000, "category": "frutas"}
        ],
        "note": "TEST_note"
    })
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["market_id"] == market_state["id"]
    assert d["currency"] == "PYG"
    assert len(d["items"]) == 2
    assert d["total"] > 0
    purchase_state["id"] = d["id"]

def test_purchase_get_by_id(auth_client, base_url, purchase_state):
    r = auth_client.get(f"{base_url}/api/purchases/{purchase_state['id']}")
    assert r.status_code == 200
    assert r.json()["id"] == purchase_state["id"]

def test_purchase_list(auth_client, base_url, purchase_state):
    r = auth_client.get(f"{base_url}/api/purchases")
    assert r.status_code == 200
    assert any(p["id"] == purchase_state["id"] for p in r.json())

# --- Reports ---
def test_monthly_report(auth_client, base_url):
    r = auth_client.get(f"{base_url}/api/reports/monthly")
    assert r.status_code == 200
    d = r.json()
    for k in ("month", "purchase_count", "item_count", "total_by_currency", "by_market", "by_category", "by_day"):
        assert k in d
    assert "PYG" in d["total_by_currency"]
    assert d["purchase_count"] >= 1
    assert d["item_count"] >= 2

# --- Currency update ---
def test_update_currency(auth_client, base_url):
    r = auth_client.put(f"{base_url}/api/auth/currency", json={"currency": "USD"})
    assert r.status_code == 200
    assert r.json()["preferred_currency"] == "USD"
    # revert
    auth_client.put(f"{base_url}/api/auth/currency", json={"currency": "PYG"})

# --- OCR ---
def _tiny_jpeg_b64():
    # 1x1 JPEG
    b = bytes.fromhex(
        "FFD8FFE000104A46494600010101006000600000FFDB004300080606070605080707"
        "070909080A0C140D0C0B0B0C1912130F141D1A1F1E1D1A1C1C20242E2720222C231C"
        "1C2837292C30313434341F27393D38323C2E333432FFC0000B080001000101011100"
        "FFC4001F0000010501010101010100000000000000000102030405060708090A0BFF"
        "C400B5100002010303020403050504040000017D01020300041105122131410613516107"
        "227114328191A1082342B1C11552D1F02433627282090A161718191A25262728292A"
        "3435363738393A434445464748494A535455565758595A636465666768696A737475"
        "767778797A838485868788898A92939495969798999AA2A3A4A5A6A7A8A9AAB2B3B4"
        "B5B6B7B8B9BAC2C3C4C5C6C7C8C9CAD2D3D4D5D6D7D8D9DAE1E2E3E4E5E6E7E8E9EA"
        "F1F2F3F4F5F6F7F8F9FAFFDA0008010100003F00FBD0FFD9"
    )
    return base64.b64encode(b).decode()

def test_ocr_scan_returns_items_gracefully(auth_client, base_url):
    r = auth_client.post(f"{base_url}/api/receipt/scan", json={
        "image_base64": _tiny_jpeg_b64(),
        "currency": "PYG"
    }, timeout=120)
    # Must not be 500; either 200 with items list or graceful fallback
    assert r.status_code == 200, f"OCR returned {r.status_code}: {r.text[:300]}"
    d = r.json()
    assert "items" in d
    assert isinstance(d["items"], list)
