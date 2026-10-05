import asyncio
import hashlib
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import HTTPException

import server


@pytest.fixture(autouse=True)
def seed_user():
    yield


class MemoryCollection:
    def __init__(self, documents=None):
        self.documents = list(documents or [])

    async def delete_many(self, query):
        expires = query.get("expires_at", {}).get("$lte")
        if expires:
            self.documents = [
                document for document in self.documents
                if document.get("expires_at") > expires
            ]

    async def insert_one(self, document):
        self.documents.append(document)

    async def find_one_and_delete(self, query):
        for index, document in enumerate(self.documents):
            matches = all(document.get(key) == value for key, value in query.items() if key != "expires_at")
            expires = query.get("expires_at", {})
            matches = matches and document.get("expires_at") > expires.get("$gt", datetime.min.replace(tzinfo=timezone.utc))
            if matches:
                return self.documents.pop(index)
        return None


def test_google_start_redirects_to_google_and_stores_single_use_state(monkeypatch):
    states = MemoryCollection()
    monkeypatch.setattr(server, "db", SimpleNamespace(google_oauth_states=states))
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "client-id")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "client-secret")

    response = asyncio.run(server.google_auth_start(server.GOOGLE_OAUTH_WEB_REDIRECT))

    assert response.status_code == 302
    assert response.headers["location"].startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert len(states.documents) == 1
    assert states.documents[0]["redirect_uri"] == server.GOOGLE_OAUTH_WEB_REDIRECT
    assert "client-secret" not in response.headers["location"]


def test_google_start_rejects_unregistered_redirect(monkeypatch):
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "client-id")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "client-secret")

    with pytest.raises(HTTPException) as error:
        asyncio.run(server.google_auth_start("https://attacker.example/callback"))

    assert error.value.status_code == 400


def test_google_callback_validates_identity_and_redirects_with_one_time_code(monkeypatch):
    state = "oauth-state-value"
    nonce = "oauth-nonce-value"
    states = MemoryCollection([{
        "state_hash": hashlib.sha256(state.encode()).hexdigest(),
        "nonce": nonce,
        "redirect_uri": server.GOOGLE_OAUTH_WEB_REDIRECT,
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=5),
    }])
    codes = MemoryCollection()

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {"id_token": "signed-google-id-token"}

    class FakeHTTPClient:
        def __init__(self, timeout):
            assert timeout == 15

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, url, data):
            assert url == "https://oauth2.googleapis.com/token"
            assert data["client_id"] == "client-id"
            return FakeResponse()

    class FakeJwks:
        def get_signing_key_from_jwt(self, token):
            assert token == "signed-google-id-token"
            return SimpleNamespace(key="verified-google-key")

    async def upsert_user(*args, **kwargs):
        assert args[0] == "user@example.com"
        assert kwargs["provider_fields"] == {"google_sub": "google-sub"}
        return {"user_id": "google-user"}

    monkeypatch.setattr(server, "db", SimpleNamespace(
        google_oauth_states=states,
        google_oauth_codes=codes,
    ))
    monkeypatch.setattr(server.httpx, "AsyncClient", FakeHTTPClient)
    monkeypatch.setattr(server, "_google_jwks", FakeJwks())
    monkeypatch.setattr(server, "_upsert_user_by_email", upsert_user)
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "client-id")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "client-secret")
    monkeypatch.setattr(server.jwt, "decode", lambda *args, **kwargs: {
        "nonce": nonce,
        "sub": "google-sub",
        "email": "user@example.com",
        "email_verified": True,
        "name": "Google User",
    })

    response = asyncio.run(server.google_auth_callback(code="google-code", state=state))

    query = parse_qs(urlsplit(response.headers["location"]).query)
    assert response.status_code == 307
    assert len(query["auth_code"][0]) >= 40
    assert codes.documents[0]["code_hash"] == hashlib.sha256(query["auth_code"][0].encode()).hexdigest()
    assert "google-code" not in response.headers["location"]


def test_google_exchange_consumes_short_lived_code_once(monkeypatch):
    auth_code = "one-time-login-code-that-is-long-enough"
    codes = MemoryCollection([{
        "code_hash": hashlib.sha256(auth_code.encode()).hexdigest(),
        "user_id": "google-user",
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=1),
    }])
    users = SimpleNamespace(find_one=lambda *args, **kwargs: None)

    async def find_user(*args, **kwargs):
        return {
            "user_id": "google-user",
            "email": "user@example.com",
            "name": "Google User",
            "preferred_currency": "PYG",
        }

    users.find_one = find_user
    monkeypatch.setattr(server, "db", SimpleNamespace(
        google_oauth_codes=codes,
        users=users,
        user_sessions=MemoryCollection(),
    ))

    async def issue_session(user_id):
        assert user_id == "google-user"
        return "session-token"

    monkeypatch.setattr(server, "_issue_session", issue_session)
    result = asyncio.run(server.google_auth_exchange(server.GoogleCodeExchange(auth_code=auth_code)))

    assert result.session_token == "session-token"
    assert result.user.email == "user@example.com"
    assert codes.documents == []
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.google_auth_exchange(server.GoogleCodeExchange(auth_code=auth_code)))
    assert error.value.status_code == 401
