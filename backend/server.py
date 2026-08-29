# pyright: reportPrivateImportUsage=false, reportOptionalSubscript=false
from fastapi import FastAPI, APIRouter, HTTPException, Header, Depends
from fastapi.security import APIKeyHeader
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import json
import uuid
import base64
import httpx
import google.generativeai as genai
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Dict, Any, cast
from datetime import datetime, timezone, timedelta
import bcrypt
import jwt
from jwt import PyJWKClient
import google.generativeai as genai
from google.oauth2.credentials import Credentials

# Configuración del Logger
logger = logging.getLogger("uvicorn")

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Configuración MongoDB
mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'test_database')]

# Configuración Gemini API Key
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

if GEMINI_API_KEY.startswith("AQ."):
    # Soporte para tokens de proyectos Google Cloud / AI Studio (AQ...)
    credentials = Credentials(token=GEMINI_API_KEY)
    genai.configure(credentials=credentials)
else:
    # Soporte para claves de API estándar (AIzaSy...)
    genai.configure(api_key=GEMINI_API_KEY)

# Configuración Apple / Facebook
APPLE_AUDIENCES = os.environ.get(
    'APPLE_AUDIENCES',
    'com.emergent.monthlyshop.aq7qrl,host.exp.Exponent',
).split(',')
_apple_jwks = PyJWKClient("https://appleid.apple.com/auth/keys", cache_keys=True)
FACEBOOK_APP_ID = os.environ.get('FACEBOOK_APP_ID', '')

# Inicialización FastAPI
app = FastAPI(
    title="App Compras Backend",
    swagger_ui_parameters={"persistAuthorization": True}
)

api_key_header = APIKeyHeader(name="X-Session-Token", auto_error=False)
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

# ============ SHOPPING LISTS MODELS ============
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
async def get_current_user(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
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
    return cast(Dict[str, Any], user)

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

def _user_public(user: Optional[Dict[str, Any]]) -> UserPublic:
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return UserPublic(
        user_id=str(user.get("user_id", "")),
        email=str(user.get("email", "")),
        name=str(user.get("name") or user.get("email", "")),
        picture=cast(Optional[str], user.get("picture")),
        preferred_currency=str(user.get("preferred_currency", "PYG")),
    )

async def _upsert_user_by_email(email: str, name: str, picture: Optional[str] = None,
                                provider_fields: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    email = _norm_email(email)
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        upd: Dict[str, Any] = {"name": existing.get("name") or name}
        if picture and not existing.get("picture"):
            upd["picture"] = picture
        if provider_fields:
            upd.update(provider_fields)
        await db.users.update_one({"user_id": existing["user_id"]}, {"$set": upd})
        return {**existing, **upd}
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    doc: Dict[str, Any] = {
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
        user=_user_public(user),
    )

@api_router.get("/auth/me", response_model=UserPublic)
async def auth_me(user: Dict[str, Any] = Depends(get_current_user)):
    return _user_public(user)

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
async def update_currency(payload: CurrencyUpdate, user: Dict[str, Any] = Depends(get_current_user)):
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"preferred_currency": payload.currency}})
    user["preferred_currency"] = payload.currency
    return _user_public(user)

# ============ MARKETS ============
@api_router.get("/markets", response_model=List[Market])
async def list_markets(user: Dict[str, Any] = Depends(get_current_user)):
    rows = await db.markets.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return [Market(**cast(Dict[str, Any], r)) for r in rows]

@api_router.post("/markets", response_model=Market)
async def create_market(payload: MarketCreate, user: Dict[str, Any] = Depends(get_current_user)):
    m = Market(user_id=user["user_id"], **payload.dict(exclude_none=True))
    await db.markets.insert_one(m.dict())
    return m

@api_router.put("/markets/{market_id}", response_model=Market)
async def update_market(market_id: str, payload: MarketUpdate, user: Dict[str, Any] = Depends(get_current_user)):
    upd = {k: v for k, v in payload.dict().items() if v is not None}
    r = await db.markets.find_one_and_update(
        {"id": market_id, "user_id": user["user_id"]},
        {"$set": upd},
        return_document=True,
        projection={"_id": 0},
    )
    if not r:
        raise HTTPException(404, "Market not found")
    return Market(**cast(Dict[str, Any], r))

@api_router.delete("/markets/{market_id}")
async def delete_market(market_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    r = await db.markets.delete_one({"id": market_id, "user_id": user["user_id"]})
    if r.deleted_count == 0:
        raise HTTPException(404, "Market not found")
    return {"ok": True}

# ============ PURCHASES ============
@api_router.get("/purchases", response_model=List[Purchase])
async def list_purchases(month: Optional[str] = None, market_id: Optional[str] = None, user: Dict[str, Any] = Depends(get_current_user)):
    q: Dict[str, Any] = {"user_id": user["user_id"]}
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
    return [Purchase(**cast(Dict[str, Any], r)) for r in rows]

@api_router.post("/purchases", response_model=Purchase)
async def create_purchase(payload: PurchaseCreate, user: Dict[str, Any] = Depends(get_current_user)):
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
async def get_purchase(purchase_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    r = await db.purchases.find_one({"id": purchase_id, "user_id": user["user_id"]}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Purchase not found")
    return Purchase(**cast(Dict[str, Any], r))

@api_router.put("/purchases/{purchase_id}", response_model=Purchase)
async def update_purchase(purchase_id: str, payload: PurchaseCreate, user: Dict[str, Any] = Depends(get_current_user)):
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
    return Purchase(**cast(Dict[str, Any], doc))

@api_router.delete("/purchases/{purchase_id}")
async def delete_purchase(purchase_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    r = await db.purchases.delete_one({"id": purchase_id, "user_id": user["user_id"]})
    if r.deleted_count == 0:
        raise HTTPException(404, "Purchase not found")
    return {"ok": True}

# ============ REPORTS ============
@api_router.get("/reports/monthly")
async def monthly_report(month: Optional[str] = None, user: Dict[str, Any] = Depends(get_current_user)):
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

    total_by_currency: Dict[str, float] = {}
    by_market: Dict[str, Dict[str, float]] = {}
    by_category: Dict[str, Dict[str, float]] = {}
    by_day: Dict[str, Dict[str, float]] = {}
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

# ============ OCR / GEMINI ESCANEO DE FACTURAS ============
@api_router.post("/receipt/scan")
async def scan_receipt(payload: OCRRequest, user: Dict[str, Any] = Depends(get_current_user)):
    image_b64 = payload.image_base64
    currency = payload.currency or "PYG"

    if not image_b64:
        raise HTTPException(status_code=400, detail="Imagen no proporcionada")

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500, 
            detail="La clave GEMINI_API_KEY no está configurada en el archivo .env"
        )

    try:
        genai.configure(api_key=api_key)  # type: ignore

        if "," in image_b64:
            image_b64 = image_b64.split(",", 1)[1]

        image_bytes = base64.b64decode(image_b64)
        model = genai.GenerativeModel("gemini-1.5-flash")

        prompt = f"""
        Analiza esta imagen de factura/ticket y extrae los ítems comprados.
        Devuelve EXCLUSIVAMENTE un objeto JSON válido con esta estructura exacta (sin formato markdown ni texto explicativo):
        {{
          "currency": "{currency}",
          "items": [
            {{
              "name": "Nombre del producto",
              "quantity": 1,
              "unit": "un",
              "price": 5000,
              "category": "otros"
            }}
          ]
        }}
        """

        response = model.generate_content([
            {"mime_type": "image/jpeg", "data": image_bytes},
            prompt
        ])

        clean_text = (response.text or "").strip().replace("```json", "").replace("```", "").strip()
        parsed = json.loads(clean_text)

        return parsed

    except Exception as e:
        logger.error(f"Error procesando escaneo con Gemini: {e}")
        raise HTTPException(status_code=500, detail="Error de la IA al leer la factura")

# ============ SHOPPING LISTS ROUTES ============
@api_router.get("/shopping-lists", response_model=List[ShoppingList])
async def list_shopping_lists(user: Dict[str, Any] = Depends(get_current_user)):
    rows = await db.shopping_lists.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [ShoppingList(**cast(Dict[str, Any], r)) for r in rows]

@api_router.post("/shopping-lists", response_model=ShoppingList)
async def create_shopping_list(payload: ShoppingListCreate, user: Dict[str, Any] = Depends(get_current_user)):
    sl = ShoppingList(user_id=user["user_id"], name=payload.name.strip(), currency=payload.currency, items=[])
    await db.shopping_lists.insert_one(sl.dict())
    return sl

@api_router.get("/shopping-lists/{list_id}", response_model=ShoppingList)
async def get_shopping_list(list_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    r = await db.shopping_lists.find_one({"id": list_id, "user_id": user["user_id"]}, {"_id": 0})
    if not r:
        raise HTTPException(404, "List not found")
    return ShoppingList(**cast(Dict[str, Any], r))

@api_router.put("/shopping-lists/{list_id}", response_model=ShoppingList)
async def update_shopping_list(list_id: str, payload: ShoppingListUpdate, user: Dict[str, Any] = Depends(get_current_user)):
    upd = {k: v for k, v in payload.dict().items() if v is not None}
    r = await db.shopping_lists.find_one_and_update(
        {"id": list_id, "user_id": user["user_id"]},
        {"$set": upd},
        return_document=True,
        projection={"_id": 0},
    )
    if not r:
        raise HTTPException(404, "List not found")
    return ShoppingList(**cast(Dict[str, Any], r))

@api_router.delete("/shopping-lists/{list_id}")
async def delete_shopping_list(list_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    r = await db.shopping_lists.delete_one({"id": list_id, "user_id": user["user_id"]})
    if r.deleted_count == 0:
        raise HTTPException(404, "List not found")
    return {"ok": True}

@api_router.post("/shopping-lists/{list_id}/items", response_model=ShoppingList)
async def add_shopping_list_item(list_id: str, payload: ShoppingListItemCreate, user: Dict[str, Any] = Depends(get_current_user)):
    sl = await db.shopping_lists.find_one({"id": list_id, "user_id": user["user_id"]}, {"_id": 0})
    if not sl:
        raise HTTPException(404, "List not found")
    item = ShoppingListItem(**payload.dict())
    await db.shopping_lists.update_one(
        {"id": list_id, "user_id": user["user_id"]},
        {"$push": {"items": item.dict()}},
    )
    updated = await db.shopping_lists.find_one({"id": list_id, "user_id": user["user_id"]}, {"_id": 0})
    return ShoppingList(**cast(Dict[str, Any], updated))

@api_router.put("/shopping-lists/{list_id}/items/{item_id}", response_model=ShoppingList)
async def update_shopping_list_item(list_id: str, item_id: str, payload: ShoppingListItemUpdate, user: Dict[str, Any] = Depends(get_current_user)):
    sl = await db.shopping_lists.find_one({"id": list_id, "user_id": user["user_id"]}, {"_id": 0})
    if not sl:
        raise HTTPException(404, "List not found")
    items = sl.get("items", [])
    idx = next((i for i, it in enumerate(items) if it.get("id") == item_id), -1)
    if idx == -1:
        raise HTTPException(404, "Item not found")

    upd_dict = payload.dict(exclude_unset=True)

    if "paid_market_id" in upd_dict and upd_dict["paid_market_id"]:
        market = await db.markets.find_one({"id": upd_dict["paid_market_id"], "user_id": user["user_id"]}, {"_id": 0})
        if market:
            upd_dict["paid_market_name"] = market["name"]

    if upd_dict.get("status") == "bought" and not items[idx].get("paid_at"):
        upd_dict["paid_at"] = datetime.now(timezone.utc)
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
    return ShoppingList(**cast(Dict[str, Any], updated))

@api_router.delete("/shopping-lists/{list_id}/items/{item_id}", response_model=ShoppingList)
async def delete_shopping_list_item(list_id: str, item_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    r = await db.shopping_lists.update_one(
        {"id": list_id, "user_id": user["user_id"]},
        {"$pull": {"items": {"id": item_id}}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "List not found")
    updated = await db.shopping_lists.find_one({"id": list_id, "user_id": user["user_id"]}, {"_id": 0})
    return ShoppingList(**cast(Dict[str, Any], updated))

# ============ PRODUCT HISTORY ============
@api_router.get("/products/history")
async def products_history(q: Optional[str] = None, user: Dict[str, Any] = Depends(get_current_user)):
    rows = await db.purchases.find({"user_id": user["user_id"]}, {"_id": 0}).sort("date", -1).to_list(3000)

    products: Dict[str, Any] = {}
    for r in rows:
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
            })
            if market_name not in entry["prices"]:
                entry["prices"][market_name] = {
                    "price": it.get("price", 0),
                    "currency": currency,
                    "date": date,
                }

    result = list(products.values())
    if q:
        q_lower = q.lower()
        result = [p for p in result if q_lower in p["name"].lower()]

    return result

# ============ REGISTER ROUTER & MIDDLEWARE ============
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)