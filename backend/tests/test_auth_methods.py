"""Tests for new auth methods: email/password, apple, facebook + provider status."""
import os
import uuid
import asyncio
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://monthly-shop-2.preview.emergentagent.com").rstrip("/")


def _cleanup_email(email: str):
    """Remove test user + their sessions before/after each test."""
    async def _do():
        c = AsyncIOMotorClient("mongodb://localhost:27017")
        db = c["test_database"]
        u = await db.users.find_one({"email": email.lower()})
        if u:
            await db.user_sessions.delete_many({"user_id": u["user_id"]})
            await db.users.delete_one({"user_id": u["user_id"]})
        c.close()
    asyncio.new_event_loop().run_until_complete(_do())


# ============ /api/auth/providers ============
def test_providers_shape():
    r = requests.get(f"{BASE_URL}/api/auth/providers", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["email"] is True
    assert data["google"] is True
    assert data["apple"] is True
    assert data["facebook"] is False
    assert data["facebook_app_id"] is None


# ============ /api/auth/register ============
@pytest.fixture
def fresh_email():
    email = f"TEST_reg_{uuid.uuid4().hex[:8]}@example.com"
    _cleanup_email(email)
    yield email
    _cleanup_email(email)


def test_register_valid_returns_session(fresh_email):
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": fresh_email, "password": "secret123", "name": "Maria"}, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "session_token" in data and data["session_token"].startswith("sess_")
    assert data["user"]["email"] == fresh_email.lower()
    assert data["user"]["name"] == "Maria"

    # verify /auth/me works with the returned token
    me = requests.get(f"{BASE_URL}/api/auth/me",
                      headers={"Authorization": f"Bearer {data['session_token']}"}, timeout=15)
    assert me.status_code == 200
    assert me.json()["email"] == fresh_email.lower()


def test_register_duplicate_returns_409(fresh_email):
    requests.post(f"{BASE_URL}/api/auth/register",
                  json={"email": fresh_email, "password": "secret123"}, timeout=15)
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": fresh_email, "password": "secret123"}, timeout=15)
    assert r.status_code == 409, r.text
    assert "Ya existe una cuenta" in r.json().get("detail", "")


def test_register_short_password_400():
    email = f"TEST_short_{uuid.uuid4().hex[:6]}@example.com"
    _cleanup_email(email)
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": email, "password": "abc"}, timeout=15)
    assert r.status_code == 400
    _cleanup_email(email)


def test_register_invalid_email_400():
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": "not-an-email", "password": "secret123"}, timeout=15)
    assert r.status_code == 400


# ============ /api/auth/login ============
def test_login_success_and_me(fresh_email):
    requests.post(f"{BASE_URL}/api/auth/register",
                  json={"email": fresh_email, "password": "secret123"}, timeout=15)
    r = requests.post(f"{BASE_URL}/api/auth/login",
                     json={"email": fresh_email, "password": "secret123"}, timeout=15)
    assert r.status_code == 200, r.text
    token = r.json()["session_token"]
    me = requests.get(f"{BASE_URL}/api/auth/me",
                      headers={"Authorization": f"Bearer {token}"}, timeout=15)
    assert me.status_code == 200
    assert me.json()["email"] == fresh_email.lower()


def test_login_wrong_password_401(fresh_email):
    requests.post(f"{BASE_URL}/api/auth/register",
                  json={"email": fresh_email, "password": "secret123"}, timeout=15)
    r = requests.post(f"{BASE_URL}/api/auth/login",
                     json={"email": fresh_email, "password": "wrongpass"}, timeout=15)
    assert r.status_code == 401
    assert "Correo o contraseña incorrectos" in r.json().get("detail", "")


def test_login_nonexistent_email_401():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                     json={"email": f"nobody_{uuid.uuid4().hex[:6]}@example.com", "password": "whatever"}, timeout=15)
    assert r.status_code == 401
    assert "Correo o contraseña incorrectos" in r.json().get("detail", "")


# ============ /api/auth/apple ============
def test_apple_invalid_token_401():
    r = requests.post(f"{BASE_URL}/api/auth/apple",
                     json={"identity_token": "not.a.real.jwt"}, timeout=15)
    assert r.status_code == 401
    assert "Token de Apple" in r.json().get("detail", "")


# ============ /api/auth/facebook ============
def test_facebook_not_configured_503():
    r = requests.post(f"{BASE_URL}/api/auth/facebook",
                     json={"access_token": "fake-token"}, timeout=15)
    assert r.status_code == 503
    assert "Facebook login no configurado" in r.json().get("detail", "")


# ============ Regression: existing test-token-abc123 still works ============
def test_regression_test_token_still_works():
    r = requests.get(f"{BASE_URL}/api/auth/me",
                     headers={"Authorization": "Bearer test-token-abc123"}, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "email" in body and "user_id" in body


def test_regression_markets_endpoint():
    r = requests.get(f"{BASE_URL}/api/markets",
                     headers={"Authorization": "Bearer test-token-abc123"}, timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_regression_currencies_public():
    r = requests.get(f"{BASE_URL}/api/currencies", timeout=15)
    assert r.status_code == 200
    codes = [c["code"] for c in r.json()]
    assert "PYG" in codes and "USD" in codes
