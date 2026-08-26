from fastapi import FastAPI, APIRouter, HTTPException, Header, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import json
import re
import uuid
import httpx
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
from datetime import datetime, timezone, timedelta

from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

import bcrypt
import jwt
from jwt import PyJWKClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')

# Apple Sign In - audiences must include your bundle id AND host.exp.Exponent for Expo Go
APPLE_AUDIENCES = os.environ.get(
    'APPLE_AUDIENCES',
    'com.emergent.monthlyshop.aq7qrl,host.exp.Exponent',
).split(',')
_apple_jwks = PyJWKClient("https://appleid.apple.com/auth/keys", cache_keys=True)

# Facebook App ID (optional — if set, /api/auth/facebook is enabled)
FACEBOOK_APP_ID = os.environ.get('FACEBOOK_APP_ID', '')

app = FastAPI()
api_router = APIRouter(prefix="/api")

# ============ MODELS ============
class SessionRequest(BaseModel):
    session_id: str

class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    preferred_currency: str = "PYG"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class UserPublic(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    preferred_currency: str = "PYG"

class SessionResponse(BaseModel):
    session_token: str
    user: UserPublic

class Market(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str
    icon: str = "store"
    color: str = "#059669"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class MarketCreate(BaseModel):
    name: str
    icon: Optional[str] = "store"
    color: Optional[str] = "#059669"

class MarketUpdate(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None

class PurchaseItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    quantity: float = 1
    unit: Literal["un", "kg"] = "un"
    price: float
    category: Optional[str] = "otros"

class PurchaseItemCreate(BaseModel):
    name: str
    quantity: float = 1
    unit: Literal["un", "kg"] = "un"
    price: float
    category: Optional[str] = "otros"

class Purchase(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    market_id: str
    market_name: str
    currency: str = "PYG"
    items: List[PurchaseItem] = []
    total: float = 0
    note: Optional[str] = None
    date: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class PurchaseCreate(BaseModel):
    market_id: str
    currency: str = "PYG"
    items: List[PurchaseItemCreate]
    note: Optional[str] = None
    date: Optional[datetime] = None

class CurrencyUpdate(BaseModel):
    currency: str

class OCRRequest(BaseModel):
    image_base64: str
    currency: str = "PYG"

# ============ EMAIL/PASSWORD AUTH MODELS ============
class RegisterRequest(BaseModel):
    email: str
    password: str
    name: Optional[str] = None

class LoginRequest(BaseModel):
    email: str
    password: str

class AppleAuthRequest(BaseModel):
    identity_token: str
    name: Optional[str] = None
    email: Optional[str] = None

class FacebookAuthRequest(BaseModel):
    access_token: str

# ============ SHOPPING LISTS ============
class ShoppingListItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    quantity: float = 1
    unit: Literal["un", "kg"] = "un"
    category: Optional[str] = "otros"
    status: Literal["pending", "bought", "unavailable"] = "pending"
    paid_price: Optional[float] = None
    paid_market_id: Optional[str] = None
    paid_market_name: Optional[str] = None
    paid_at: Optional[datetime] = None
    note: Optional[str] = None

class ShoppingListItemCreate(BaseModel):
    name: str
    quantity: float = 1
    unit: Literal["un", "kg"] = "un"
    category: Optional[str] = "otros"
    note: Optional[str] = None

class ShoppingListItemUpdate(BaseModel):
    name: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[Literal["un", "kg"]] = None
    category: Optional[str] = None
    status: Optional[Literal["pending", "bought", "unavailable"]] = None
    paid_price: Optional[float] = None
    paid_market_id: Optional[str] = None
    note: Optional[str] = None

class ShoppingList(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str
    currency: str = "PYG"
    items: List[ShoppingListItem] = []
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ShoppingListCreate(BaseModel):
    name: str
    currency: str = "PYG"

class ShoppingListUpdate(BaseModel):
    name: Optional[str] = None
    currency: Optional[str] = None

# ============ AUTH HELPERS ============
async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.replace("Bearer ", "").strip()
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    expires_at = session.get("expires_at")
    if isinstance(expires_at, datetime):
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

# ---------- Auth helpers ----------
def _hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode()

def _verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False

def _norm_email(email: str) -> str:
    return email.strip().lower()

async def _issue_session(user_id: str) -> str:
    token = f"sess_{uuid.uuid4().hex}{uuid.uuid4().hex}"
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    return token

def _user_public(user: dict) -> UserPublic:
    return UserPublic(
        user_id=user["user_id"],
        email=user["email"],
        name=user.get("name") or user["email"],
        picture=user.get("picture"),
        preferred_currency=user.get("preferred_currency", "PYG"),
    )

async def _upsert_user_by_email(email: str, name: str, picture: Optional[str] = None,
                                  provider_fields: Optional[dict] = None) -> dict:
    email = _norm_email(email)
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        upd = {"name": existing.get("name") or name}
        if picture and not existing.get("picture"):
            upd["picture"] = picture
        if provider_fields:
            upd.update(provider_fields)
        await db.users.update_one({"user_id": existing["user_id"]}, {"$set": upd})
        return {**existing, **upd}
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    doc = {
        "user_id": user_id,
        "email": email,
        "name": name or email.split("@", 1)[0],
        "picture": picture,
        "preferred_currency": "PYG",
        "created_at": datetime.now(timezone.utc),
    }
    if provider_fields:
        doc.update(provider_fields)
    await db.users.insert_one(doc)
    return doc

# ============ AUTH ROUTES ============
@api_router.post("/auth/session", response_model=SessionResponse)
async def auth_session(payload: SessionRequest):
    session_id = payload.session_id
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")
    async with httpx.AsyncClient(timeout=15) as http:
        r = await http.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": session_id},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session_id")
    data = r.json()
    email = data.get("email")
    name = data.get("name") or email
    picture = data.get("picture")
    session_token = data.get("session_token")
    if not email or not session_token:
        raise HTTPException(status_code=401, detail="Missing auth data")

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one({"user_id": user_id}, {"$set": {"name": name, "picture": picture}})
        user = {**existing, "name": name, "picture": picture}
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user_obj = User(user_id=user_id, email=email, name=name, picture=picture)
        await db.users.insert_one(user_obj.dict())
        user = user_obj.dict()

    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })

    return SessionResponse(
        session_token=session_token,
        user=UserPublic(
            user_id=user["user_id"],
            email=user["email"],
            name=user["name"],
            picture=user.get("picture"),
            preferred_currency=user.get("preferred_currency", "PYG"),
        ),
    )

@api_router.get("/auth/me", response_model=UserPublic)
async def auth_me(user: dict = Depends(get_current_user)):
    return UserPublic(
        user_id=user["user_id"],
        email=user["email"],
        name=user["name"],
        picture=user.get("picture"),
        preferred_currency=user.get("preferred_currency", "PYG"),
    )

# ---------- Email + Password ----------
@api_router.post("/auth/register", response_model=SessionResponse)
async def auth_register(payload: RegisterRequest):
    email = _norm_email(payload.email)
    if "@" not in email or "." not in email:
        raise HTTPException(400, "Correo inválido")
    if len(payload.password) < 6:
        raise HTTPException(400, "La contraseña debe tener al menos 6 caracteres")
    if len(payload.password.encode("utf-8")) > 72:
        raise HTTPException(400, "Contraseña demasiado larga")
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        if existing.get("password_hash"):
            raise HTTPException(409, "Ya existe una cuenta con ese correo")
        await db.users.update_one(
            {"user_id": existing["user_id"]},
            {"$set": {"password_hash": _hash_password(payload.password),
                      "name": existing.get("name") or payload.name or email.split("@", 1)[0]}},
        )
        user = await db.users.find_one({"user_id": existing["user_id"]}, {"_id": 0})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        doc = {
            "user_id": user_id, "email": email,
            "name": payload.name or email.split("@", 1)[0],
            "picture": None, "preferred_currency": "PYG",
            "password_hash": _hash_password(payload.password),
            "created_at": datetime.now(timezone.utc),
        }
        await db.users.insert_one(doc)
        user = doc
    token = await _issue_session(user["user_id"])
    return SessionResponse(session_token=token, user=_user_public(user))

@api_router.post("/auth/login", response_model=SessionResponse)
async def auth_login(payload: LoginRequest):
    email = _norm_email(payload.email)
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not user.get("password_hash"):
        _verify_password(payload.password, "$2b$12$C6UzMDM.H6dfI/f/IKcEe.8H9rR4Qv8J7Xx0Y5F5o1Q5VQe1K4i")
        raise HTTPException(401, "Correo o contraseña incorrectos")
    if not _verify_password(payload.password, user["password_hash"]):
        raise HTTPException(401, "Correo o contraseña incorrectos")
    token = await _issue_session(user["user_id"])
    return SessionResponse(session_token=token, user=_user_public(user))

# ---------- Apple Sign In ----------
@api_router.post("/auth/apple", response_model=SessionResponse)
async def auth_apple(payload: AppleAuthRequest):
    try:
        signing_key = _apple_jwks.get_signing_key_from_jwt(payload.identity_token)
        decoded = jwt.decode(
            payload.identity_token, signing_key.key,
            algorithms=["RS256"], audience=APPLE_AUDIENCES,
            issuer="https://appleid.apple.com",
        )
    except Exception as e:
        raise HTTPException(401, f"Token de Apple inválido: {e}")
    apple_sub = decoded.get("sub")
    if not apple_sub:
        raise HTTPException(401, "Token de Apple sin identidad")
    email = decoded.get("email") or payload.email
    if not email:
        email = f"{apple_sub}@privaterelay.appleid.com"
    existing_by_sub = await db.users.find_one({"apple_sub": apple_sub}, {"_id": 0})
    if existing_by_sub:
        user = existing_by_sub
    else:
        user = await _upsert_user_by_email(
            email, payload.name or email.split("@", 1)[0],
            provider_fields={"apple_sub": apple_sub},
        )
    token = await _issue_session(user["user_id"])
    return SessionResponse(session_token=token, user=_user_public(user))

# ---------- Facebook Login ----------
@api_router.post("/auth/facebook", response_model=SessionResponse)
async def auth_facebook(payload: FacebookAuthRequest):
    if not FACEBOOK_APP_ID:
        raise HTTPException(503, "Facebook login no configurado")
    async with httpx.AsyncClient(timeout=15) as http:
        r = await http.get(
            "https://graph.facebook.com/me",
            params={"fields": "id,name,email,picture", "access_token": payload.access_token},
        )
    if r.status_code != 200:
        raise HTTPException(401, "Token de Facebook inválido")
    fb = r.json()
    fb_id = fb.get("id")
    email = (fb.get("email") or "").strip().lower() or f"{fb_id}@facebook.local"
    name = fb.get("name") or email.split("@", 1)[0]
    picture = ((fb.get("picture") or {}).get("data") or {}).get("url")
    existing_by_fb = await db.users.find_one({"facebook_id": fb_id}, {"_id": 0})
    if existing_by_fb:
        user = existing_by_fb
    else:
        user = await _upsert_user_by_email(email, name, picture=picture,
                                            provider_fields={"facebook_id": fb_id})
    token = await _issue_session(user["user_id"])
    return SessionResponse(session_token=token, user=_user_public(user))

@api_router.get("/auth/providers")
async def auth_providers():
    return {
        "email": True, "google": True, "apple": True,
        "facebook": bool(FACEBOOK_APP_ID),
        "facebook_app_id": FACEBOOK_APP_ID or None,
    }


@api_router.post("/auth/logout")
async def auth_logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.replace("Bearer ", "").strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}

@api_router.put("/auth/currency", response_model=UserPublic)
async def update_currency(payload: CurrencyUpdate, user: dict = Depends(get_current_user)):
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"preferred_currency": payload.currency}})
    user["preferred_currency"] = payload.currency
    return UserPublic(**{k: user.get(k) for k in ["user_id", "email", "name", "picture", "preferred_currency"]})

# ============ MARKETS ============
@api_router.get("/markets", response_model=List[Market])
async def list_markets(user: dict = Depends(get_current_user)):
    rows = await db.markets.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return [Market(**r) for r in rows]

@api_router.post("/markets", response_model=Market)
async def create_market(payload: MarketCreate, user: dict = Depends(get_current_user)):
    m = Market(user_id=user["user_id"], **payload.dict(exclude_none=True))
    await db.markets.insert_one(m.dict())
    return m

@api_router.put("/markets/{market_id}", response_model=Market)
async def update_market(market_id: str, payload: MarketUpdate, user: dict = Depends(get_current_user)):
    upd = {k: v for k, v in payload.dict().items() if v is not None}
    r = await db.markets.find_one_and_update(
        {"id": market_id, "user_id": user["user_id"]},
        {"$set": upd},
        return_document=True,
        projection={"_id": 0},
    )
    if not r:
        raise HTTPException(404, "Market not found")
    return Market(**r)

@api_router.delete("/markets/{market_id}")
async def delete_market(market_id: str, user: dict = Depends(get_current_user)):
    r = await db.markets.delete_one({"id": market_id, "user_id": user["user_id"]})
    if r.deleted_count == 0:
        raise HTTPException(404, "Market not found")
    return {"ok": True}

# ============ PURCHASES ============
@api_router.get("/purchases", response_model=List[Purchase])
async def list_purchases(month: Optional[str] = None, market_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {"user_id": user["user_id"]}
    if market_id:
        q["market_id"] = market_id
    if month:
        try:
            y, m = month.split("-")
            start = datetime(int(y), int(m), 1, tzinfo=timezone.utc)
            if int(m) == 12:
                end = datetime(int(y) + 1, 1, 1, tzinfo=timezone.utc)
            else:
                end = datetime(int(y), int(m) + 1, 1, tzinfo=timezone.utc)
            q["date"] = {"$gte": start, "$lt": end}
        except Exception:
            pass
    rows = await db.purchases.find(q, {"_id": 0}).sort("date", -1).to_list(1000)
    return [Purchase(**r) for r in rows]

@api_router.post("/purchases", response_model=Purchase)
async def create_purchase(payload: PurchaseCreate, user: dict = Depends(get_current_user)):
    market = await db.markets.find_one({"id": payload.market_id, "user_id": user["user_id"]}, {"_id": 0})
    if not market:
        raise HTTPException(404, "Market not found")
    items = [PurchaseItem(**i.dict()) for i in payload.items]
    total = sum(i.price * (i.quantity if i.quantity and i.quantity > 0 else 1) for i in items)
    p = Purchase(
        user_id=user["user_id"],
        market_id=market["id"],
        market_name=market["name"],
        currency=payload.currency,
        items=items,
        total=total,
        note=payload.note,
        date=payload.date or datetime.now(timezone.utc),
    )
    doc = p.dict()
    await db.purchases.insert_one(doc)
    return p

@api_router.get("/purchases/{purchase_id}", response_model=Purchase)
async def get_purchase(purchase_id: str, user: dict = Depends(get_current_user)):
    r = await db.purchases.find_one({"id": purchase_id, "user_id": user["user_id"]}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Purchase not found")
    return Purchase(**r)

@api_router.put("/purchases/{purchase_id}", response_model=Purchase)
async def update_purchase(purchase_id: str, payload: PurchaseCreate, user: dict = Depends(get_current_user)):
    existing = await db.purchases.find_one({"id": purchase_id, "user_id": user["user_id"]}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Purchase not found")
    market = await db.markets.find_one({"id": payload.market_id, "user_id": user["user_id"]}, {"_id": 0})
    if not market:
        raise HTTPException(404, "Market not found")
    items = [PurchaseItem(**i.dict()) for i in payload.items]
    total = sum(i.price * (i.quantity if i.quantity and i.quantity > 0 else 1) for i in items)
    updated = {
        "market_id": market["id"],
        "market_name": market["name"],
        "currency": payload.currency,
        "items": [i.dict() for i in items],
        "total": total,
        "note": payload.note,
        "date": payload.date or existing.get("date"),
    }
    await db.purchases.update_one({"id": purchase_id, "user_id": user["user_id"]}, {"$set": updated})
    doc = await db.purchases.find_one({"id": purchase_id, "user_id": user["user_id"]}, {"_id": 0})
    return Purchase(**doc)

@api_router.delete("/purchases/{purchase_id}")
async def delete_purchase(purchase_id: str, user: dict = Depends(get_current_user)):
    r = await db.purchases.delete_one({"id": purchase_id, "user_id": user["user_id"]})
    if r.deleted_count == 0:
        raise HTTPException(404, "Purchase not found")
    return {"ok": True}

# ============ REPORTS ============
@api_router.get("/reports/monthly")
async def monthly_report(month: Optional[str] = None, user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    if not month:
        month = f"{now.year:04d}-{now.month:02d}"
    y, m = month.split("-")
    start = datetime(int(y), int(m), 1, tzinfo=timezone.utc)
    end = datetime(int(y) + 1, 1, 1, tzinfo=timezone.utc) if int(m) == 12 else datetime(int(y), int(m) + 1, 1, tzinfo=timezone.utc)

    rows = await db.purchases.find({
        "user_id": user["user_id"],
        "date": {"$gte": start, "$lt": end},
    }, {"_id": 0}).to_list(2000)

    total_by_currency = {}
    by_market = {}
    by_category = {}
    by_day = {}
    purchase_count = len(rows)
    item_count = 0

    for r in rows:
        cur = r.get("currency", "PYG")
        total = r.get("total", 0)
        total_by_currency[cur] = total_by_currency.get(cur, 0) + total
        mkey = r.get("market_name", "Otro")
        by_market.setdefault(mkey, {})
        by_market[mkey][cur] = by_market[mkey].get(cur, 0) + total
        d = r.get("date")
        if isinstance(d, datetime):
            dk = d.strftime("%Y-%m-%d")
            by_day.setdefault(dk, {})
            by_day[dk][cur] = by_day[dk].get(cur, 0) + total
        for it in r.get("items", []):
            item_count += 1
            cat = it.get("category", "otros") or "otros"
            by_category.setdefault(cat, {})
            by_category[cat][cur] = by_category[cat].get(cur, 0) + it.get("price", 0) * it.get("quantity", 1)

    return {
        "month": month,
        "purchase_count": purchase_count,
        "item_count": item_count,
        "total_by_currency": total_by_currency,
        "by_market": by_market,
        "by_category": by_category,
        "by_day": by_day,
    }

# ============ OCR ============
@api_router.post("/receipt/scan")
async def scan_receipt(payload: OCRRequest, user: dict = Depends(get_current_user)):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(500, "LLM key not configured")
    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"ocr_{user['user_id']}_{uuid.uuid4().hex[:8]}",
            system_message=(
                "Eres un asistente experto en extraer productos de facturas y tickets de compra "
                "de supermercados de Paraguay y Latinoamérica. Devuelves SOLO JSON válido, sin texto adicional."
            ),
        ).with_model("openai", "gpt-5.4")

        prompt = (
            "Analiza esta imagen de una factura o ticket de supermercado. "
            "Extrae la siguiente información y devuélvela como JSON:\n"
            "{\n"
            '  "market_name": "nombre del supermercado o null",\n'
            '  "currency": "PYG|USD|EUR|BRL|ARS",\n'
            '  "total": número o null,\n'
            '  "items": [\n'
            '    { "name": "nombre del producto", "quantity": número (default 1), "unit": "un" o "kg", "price": número, "category": "verduras|frutas|carnes|lacteos|panaderia|bebidas|limpieza|higiene|otros" }\n'
            "  ]\n"
            "}\n\n"
            "Reglas importantes:\n"
            "- price es el precio total del item (no unitario)\n"
            "- Si es kg, unit='kg' y quantity puede ser decimal\n"
            "- Detecta la moneda por el formato: Gs./₲ = PYG, R$ = BRL, US$/$ = USD, € = EUR, AR$ = ARS\n"
            "- Devuelve SOLO el JSON, sin markdown ni explicaciones\n"
            "- Si no puedes leer nada, devuelve items: []"
        )

        image = ImageContent(image_base64=payload.image_base64)
        response = await chat.send_message(UserMessage(text=prompt, file_contents=[image]))
        text = response if isinstance(response, str) else str(response)

        # Strip markdown fences if present
        text = text.strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)

        # Try to find JSON object
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            text = match.group(0)

        parsed = json.loads(text)
        return parsed
    except json.JSONDecodeError as e:
        logger.error(f"OCR JSON parse error: {e}")
        return {"market_name": None, "currency": payload.currency, "total": None, "items": []}
    except Exception as e:
        logger.exception("OCR error")
        raise HTTPException(500, f"OCR failed: {str(e)}")

# ============ SHOPPING LISTS ROUTES ============
@api_router.get("/shopping-lists", response_model=List[ShoppingList])
async def list_shopping_lists(user: dict = Depends(get_current_user)):
    rows = await db.shopping_lists.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [ShoppingList(**r) for r in rows]

@api_router.post("/shopping-lists", response_model=ShoppingList)
async def create_shopping_list(payload: ShoppingListCreate, user: dict = Depends(get_current_user)):
    sl = ShoppingList(user_id=user["user_id"], name=payload.name.strip(), currency=payload.currency, items=[])
    await db.shopping_lists.insert_one(sl.dict())
    return sl

@api_router.get("/shopping-lists/{list_id}", response_model=ShoppingList)
async def get_shopping_list(list_id: str, user: dict = Depends(get_current_user)):
    r = await db.shopping_lists.find_one({"id": list_id, "user_id": user["user_id"]}, {"_id": 0})
    if not r:
        raise HTTPException(404, "List not found")
    return ShoppingList(**r)

@api_router.put("/shopping-lists/{list_id}", response_model=ShoppingList)
async def update_shopping_list(list_id: str, payload: ShoppingListUpdate, user: dict = Depends(get_current_user)):
    upd = {k: v for k, v in payload.dict().items() if v is not None}
    r = await db.shopping_lists.find_one_and_update(
        {"id": list_id, "user_id": user["user_id"]},
        {"$set": upd},
        return_document=True,
        projection={"_id": 0},
    )
    if not r:
        raise HTTPException(404, "List not found")
    return ShoppingList(**r)

@api_router.delete("/shopping-lists/{list_id}")
async def delete_shopping_list(list_id: str, user: dict = Depends(get_current_user)):
    r = await db.shopping_lists.delete_one({"id": list_id, "user_id": user["user_id"]})
    if r.deleted_count == 0:
        raise HTTPException(404, "List not found")
    return {"ok": True}

@api_router.post("/shopping-lists/{list_id}/items", response_model=ShoppingList)
async def add_shopping_list_item(list_id: str, payload: ShoppingListItemCreate, user: dict = Depends(get_current_user)):
    sl = await db.shopping_lists.find_one({"id": list_id, "user_id": user["user_id"]}, {"_id": 0})
    if not sl:
        raise HTTPException(404, "List not found")
    item = ShoppingListItem(**payload.dict())
    await db.shopping_lists.update_one(
        {"id": list_id, "user_id": user["user_id"]},
        {"$push": {"items": item.dict()}},
    )
    updated = await db.shopping_lists.find_one({"id": list_id, "user_id": user["user_id"]}, {"_id": 0})
    return ShoppingList(**updated)

@api_router.put("/shopping-lists/{list_id}/items/{item_id}", response_model=ShoppingList)
async def update_shopping_list_item(list_id: str, item_id: str, payload: ShoppingListItemUpdate, user: dict = Depends(get_current_user)):
    sl = await db.shopping_lists.find_one({"id": list_id, "user_id": user["user_id"]}, {"_id": 0})
    if not sl:
        raise HTTPException(404, "List not found")
    items = sl.get("items", [])
    idx = next((i for i, it in enumerate(items) if it.get("id") == item_id), -1)
    if idx == -1:
        raise HTTPException(404, "Item not found")

    upd_dict = payload.dict(exclude_unset=True)

    # If setting paid_market_id, also stamp the market name
    if "paid_market_id" in upd_dict and upd_dict["paid_market_id"]:
        market = await db.markets.find_one({"id": upd_dict["paid_market_id"], "user_id": user["user_id"]}, {"_id": 0})
        if market:
            upd_dict["paid_market_name"] = market["name"]

    # If status is set to bought and paid_at not set, stamp it
    if upd_dict.get("status") == "bought" and not items[idx].get("paid_at"):
        upd_dict["paid_at"] = datetime.now(timezone.utc)
    # Clear paid_at when unmarking bought
    if "status" in upd_dict and upd_dict["status"] != "bought":
        upd_dict["paid_at"] = None
        upd_dict.setdefault("paid_price", None)
        upd_dict.setdefault("paid_market_id", None)
        upd_dict.setdefault("paid_market_name", None)

    for k, v in upd_dict.items():
        items[idx][k] = v

    await db.shopping_lists.update_one(
        {"id": list_id, "user_id": user["user_id"]},
        {"$set": {"items": items}},
    )
    updated = await db.shopping_lists.find_one({"id": list_id, "user_id": user["user_id"]}, {"_id": 0})
    return ShoppingList(**updated)

@api_router.delete("/shopping-lists/{list_id}/items/{item_id}", response_model=ShoppingList)
async def delete_shopping_list_item(list_id: str, item_id: str, user: dict = Depends(get_current_user)):
    r = await db.shopping_lists.update_one(
        {"id": list_id, "user_id": user["user_id"]},
        {"$pull": {"items": {"id": item_id}}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "List not found")
    updated = await db.shopping_lists.find_one({"id": list_id, "user_id": user["user_id"]}, {"_id": 0})
    return ShoppingList(**updated)

# ============ PRODUCT HISTORY (for shopping list "select from previous") ============
@api_router.get("/products/history")
async def products_history(q: Optional[str] = None, user: dict = Depends(get_current_user)):
    # Aggregate every item ever purchased by the user, grouped by
    # normalised name, keeping the last price per market.
    rows = await db.purchases.find({"user_id": user["user_id"]}, {"_id": 0}).sort("date", -1).to_list(3000)

    products: dict = {}
    for r in rows:
        market_id = r.get("market_id")
        market_name = r.get("market_name", "Otro")
        currency = r.get("currency", "PYG")
        date = r.get("date")
        for it in r.get("items", []):
            raw = str(it.get("name", "")).strip()
            if not raw:
                continue
            key = raw.lower()
            entry = products.setdefault(key, {
                "name": raw,
                "category": it.get("category", "otros"),
                "unit": it.get("unit", "un"),
                "prices": {},
                "last_used": date,
            })
            if it.get("category"):
                entry["category"] = it["category"]
            price = it.get("price", 0)
            existing = entry["prices"].get(market_id)
            if not existing or (date and existing.get("date") and date > existing["date"]) or not existing.get("date"):
                entry["prices"][market_id] = {
                    "market_id": market_id,
                    "market_name": market_name,
                    "price": price,
                    "currency": currency,
                    "date": date,
                }
            if date and (not entry["last_used"] or date > entry["last_used"]):
                entry["last_used"] = date

    out = []
    for key, entry in products.items():
        prices_list = sorted(entry["prices"].values(), key=lambda x: x["price"])
        cheapest = prices_list[0] if prices_list else None
        out.append({
            "name": entry["name"],
            "category": entry["category"],
            "unit": entry["unit"],
            "prices": prices_list,
            "cheapest_market_id": cheapest["market_id"] if cheapest else None,
            "cheapest_market_name": cheapest["market_name"] if cheapest else None,
            "cheapest_price": cheapest["price"] if cheapest else None,
            "cheapest_currency": cheapest["currency"] if cheapest else None,
            "last_used": entry["last_used"],
        })
    if q:
        ql = q.lower().strip()
        out = [p for p in out if ql in p["name"].lower()]
    out.sort(key=lambda p: (p.get("last_used") or datetime.min.replace(tzinfo=timezone.utc)), reverse=True)
    return out[:200]

# ============ CURRENCIES ============
@api_router.get("/currencies")
async def currencies():
    return [
        {"code": "PYG", "name": "Guaraní Paraguayo", "symbol": "₲", "flag": "🇵🇾", "decimals": 0},
        {"code": "USD", "name": "Dólar Estadounidense", "symbol": "$", "flag": "🇺🇸", "decimals": 2},
        {"code": "EUR", "name": "Euro", "symbol": "€", "flag": "🇪🇺", "decimals": 2},
        {"code": "BRL", "name": "Real Brasileño", "symbol": "R$", "flag": "🇧🇷", "decimals": 2},
        {"code": "ARS", "name": "Peso Argentino", "symbol": "$", "flag": "🇦🇷", "decimals": 2},
    ]

@api_router.get("/")
async def root():
    return {"message": "Despensa API"}

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("startup")
async def startup_indexes():
    try:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("user_id", unique=True)
        await db.user_sessions.create_index("session_token", unique=True)
        await db.user_sessions.create_index("user_id")
        await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
        await db.markets.create_index([("user_id", 1), ("id", 1)])
        await db.purchases.create_index([("user_id", 1), ("date", -1)])
        await db.shopping_lists.create_index([("user_id", 1), ("created_at", -1)])
    except Exception as e:
        logger.warning(f"Index creation warning: {e}")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
