import os, asyncio, pytest, requests
from datetime import datetime, timezone, timedelta
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://monthly-shop-2.preview.emergentagent.com").rstrip("/")
TEST_TOKEN = "test-token-abc123"
TEST_USER_ID = "user_testabc123"
TEST_EMAIL = "test_despensa@example.com"

@pytest.fixture(scope="session")
def base_url():
    return BASE_URL

@pytest.fixture(scope="session", autouse=True)
def seed_user():
    async def _seed():
        c = AsyncIOMotorClient("mongodb://localhost:27017")
        db = c["test_database"]
        await db.users.update_one(
            {"user_id": TEST_USER_ID},
            {"$set": {"user_id": TEST_USER_ID, "email": TEST_EMAIL, "name": "Test User",
                      "preferred_currency": "PYG", "created_at": datetime.now(timezone.utc)}},
            upsert=True,
        )
        await db.user_sessions.update_one(
            {"session_token": TEST_TOKEN},
            {"$set": {"session_token": TEST_TOKEN, "user_id": TEST_USER_ID,
                      "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
                      "created_at": datetime.now(timezone.utc)}},
            upsert=True,
        )
        # cleanup previous test data
        await db.markets.delete_many({"user_id": TEST_USER_ID})
        await db.purchases.delete_many({"user_id": TEST_USER_ID})
        c.close()
    asyncio.get_event_loop().run_until_complete(_seed())
    yield

@pytest.fixture
def auth_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {TEST_TOKEN}"})
    return s

@pytest.fixture
def anon_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s
