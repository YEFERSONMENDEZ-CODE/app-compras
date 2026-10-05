# pyright: reportPrivateImportUsage=false, reportOptionalSubscript=false
from fastapi import FastAPI, APIRouter, HTTPException, Header, Depends
from fastapi.responses import RedirectResponse
from fastapi.security import APIKeyHeader
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import base64
import json
import hashlib
import secrets
import httpx
from pathlib import Path
from io import BytesIO
from pydantic import BaseModel, Field, ValidationError
from typing import List, Optional, Literal, Dict, Any, cast
from datetime import datetime, timezone, timedelta
from urllib.parse import urlencode, urlsplit, urlunsplit, parse_qsl
import bcrypt
import jwt
from jwt import PyJWKClient
from starlette.concurrency import run_in_threadpool
if __package__:
    from .receipt_ocr import (
        InvalidReceiptImage,
        MAX_IMAGE_BYTES,
        prepare_receipt_image,
        scan_receipt_image,
    )
else:
    from receipt_ocr import (
        InvalidReceiptImage,
        MAX_IMAGE_BYTES,
        prepare_receipt_image,
        scan_receipt_image,
    )

# Configuración del Logger
logger = logging.getLogger("uvicorn")

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Configuración MongoDB
mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'test_database')]

# Configuración Apple / Facebook
APPLE_AUDIENCES = os.environ.get(
    'APPLE_AUDIENCES',
    'com.emergent.monthlyshop.aq7qrl,host.exp.Exponent',
).split(',')
_apple_jwks = PyJWKClient("https://appleid.apple.com/auth/keys", cache_keys=True)
_google_jwks = PyJWKClient("https://www.googleapis.com/oauth2/v3/certs", cache_keys=True)
FACEBOOK_APP_ID = os.environ.get('FACEBOOK_APP_ID', '')
GOOGLE_OAUTH_WEB_REDIRECT = "https://despensa-web.onrender.com/"
GOOGLE_OAUTH_APP_REDIRECT = "frontend://auth"
GOOGLE_OAUTH_CALLBACK_DEFAULT = "https://app-compras-backend.onrender.com/api/auth/google/callback"

# Inicialización FastAPI
app = FastAPI(
    title="App Compras Backend",
    swagger_ui_parameters={"persistAuthorization": True}
)

api_key_header = APIKeyHeader(name="X-Session-Token", auto_error=False)
api_router = APIRouter(prefix="/api")

# ============ MODELS ============
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
    name: Optional[str] = None
    note: Optional[str] = None
    date: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class PurchaseCreate(BaseModel):
    market_id: str
    currency: str = "PYG"
    items: List[PurchaseItemCreate]
    name: Optional[str] = None
    note: Optional[str] = None
    date: Optional[datetime] = None

class CurrencyUpdate(BaseModel):
    currency: str

class OCRRequest(BaseModel):
    image_base64: str = Field(..., max_length=(MAX_IMAGE_BYTES * 4 // 3) + 16)
    currency: str = "PYG"

class GeminiReceiptItem(BaseModel):
    name: str = Field(..., min_length=1, max_length=150)
    quantity: float = Field(..., gt=0)
    unit: Literal["un", "kg"] = "un"
    price: float = Field(..., gt=0)
    category: str = "otros"

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

class GoogleCodeExchange(BaseModel):
    auth_code: str = Field(..., min_length=20, max_length=256)

# ============ SHOPPING LISTS MODELS ============
class ShoppingListItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    quantity: float = 1
    unit: Literal["un", "kg"] = "un"
    category: Optional[str] = "otros"
    status: Literal["pending", "bought", "unavailable"] = "pending"
    estimated_price: Optional[float] = None
    estimated_market_id: Optional[str] = None
    estimated_market_name: Optional[str] = None
    estimated_date: Optional[datetime] = None
    paid_price: Optional[float] = None
    paid_market_id: Optional[str] = None
    paid_market_name: Optional[str] = None
    paid_at: Optional[datetime] = None
    purchase_cycle_id: Optional[str] = None
    imported_purchase_id: Optional[str] = None
    note: Optional[str] = None

class ShoppingListItemCreate(BaseModel):
    name: str
    quantity: float = 1
    unit: Literal["un", "kg"] = "un"
    category: Optional[str] = "otros"
    status: Literal["pending", "bought", "unavailable"] = "pending"
    estimated_price: Optional[float] = None
    estimated_market_id: Optional[str] = None
    estimated_market_name: Optional[str] = None
    estimated_date: Optional[datetime] = None
    paid_price: Optional[float] = None
    paid_market_id: Optional[str] = None
    paid_market_name: Optional[str] = None
    paid_at: Optional[datetime] = None
    note: Optional[str] = None

class ShoppingListItemUpdate(BaseModel):
    name: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[Literal["un", "kg"]] = None
    category: Optional[str] = None
    status: Optional[Literal["pending", "bought", "unavailable"]] = None
    estimated_price: Optional[float] = None
    estimated_market_id: Optional[str] = None
    estimated_market_name: Optional[str] = None
    estimated_date: Optional[datetime] = None
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
def _google_oauth_config() -> tuple[str, str, str]:
    client_id = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "").strip()
    client_secret = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
    callback_url = os.environ.get("GOOGLE_OAUTH_REDIRECT_URI", GOOGLE_OAUTH_CALLBACK_DEFAULT).strip()
    return client_id, client_secret, callback_url


def _google_oauth_redirect_targets() -> set[str]:
    configured = os.environ.get("GOOGLE_OAUTH_ALLOWED_REDIRECTS", "")
    targets = configured.split(",") if configured.strip() else [
        GOOGLE_OAUTH_WEB_REDIRECT,
        GOOGLE_OAUTH_APP_REDIRECT,
    ]
    return {target.strip() for target in targets if target.strip()}


def _append_auth_query(url: str, **params: str) -> str:
    parts = urlsplit(url)
    query = parse_qsl(parts.query, keep_blank_values=True)
    query.extend((key, value) for key, value in params.items())
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


@api_router.get("/auth/google/start")
async def google_auth_start(redirect_uri: str):
    client_id, client_secret, callback_url = _google_oauth_config()
    if not client_id or not client_secret:
        raise HTTPException(status_code=503, detail="El inicio de sesión con Google aún no está configurado")
    if redirect_uri not in _google_oauth_redirect_targets():
        raise HTTPException(status_code=400, detail="URI de retorno no permitida")

    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    await db.google_oauth_states.delete_many({"expires_at": {"$lte": now}})
    await db.google_oauth_states.insert_one({
        "state_hash": hashlib.sha256(state.encode()).hexdigest(),
        "nonce": nonce,
        "redirect_uri": redirect_uri,
        "expires_at": now + timedelta(minutes=10),
    })

    query = urlencode({
        "client_id": client_id,
        "redirect_uri": callback_url,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "nonce": nonce,
        "prompt": "select_account",
    })
    response = RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{query}", status_code=302)
    response.headers["Cache-Control"] = "no-store"
    return response


@api_router.get("/auth/google/callback")
async def google_auth_callback(code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None):
    if not state:
        raise HTTPException(status_code=400, detail="Estado OAuth inválido")
    now = datetime.now(timezone.utc)
    state_doc = await db.google_oauth_states.find_one_and_delete({
        "state_hash": hashlib.sha256(state.encode()).hexdigest(),
        "expires_at": {"$gt": now},
    })
    if not state_doc:
        raise HTTPException(status_code=400, detail="La sesión de Google expiró o ya fue utilizada")
    redirect_uri = state_doc["redirect_uri"]
    if error or not code:
        return RedirectResponse(_append_auth_query(redirect_uri, auth_error="Inicio de sesión cancelado"))

    client_id, client_secret, callback_url = _google_oauth_config()
    if not client_id or not client_secret:
        return RedirectResponse(_append_auth_query(redirect_uri, auth_error="Google no está configurado en el servidor"))

    try:
        async with httpx.AsyncClient(timeout=15) as http:
            response = await http.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "code": code,
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "redirect_uri": callback_url,
                    "grant_type": "authorization_code",
                },
            )
        response.raise_for_status()
        id_token = response.json().get("id_token")
        if not id_token:
            raise ValueError("Google no devolvió un token de identidad")
        signing_key = await run_in_threadpool(_google_jwks.get_signing_key_from_jwt, id_token)
        claims = jwt.decode(
            id_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=client_id,
            issuer=["accounts.google.com", "https://accounts.google.com"],
        )
        if claims.get("nonce") != state_doc["nonce"]:
            raise ValueError("Nonce de Google inválido")
        email = _norm_email(str(claims.get("email") or ""))
        if not claims.get("sub") or not email or claims.get("email_verified") is not True:
            raise ValueError("La cuenta de Google no devolvió un correo verificado")
        user = await _upsert_user_by_email(
            email,
            str(claims.get("name") or email.split("@", 1)[0]),
            picture=claims.get("picture"),
            provider_fields={"google_sub": str(claims["sub"])},
        )
        auth_code = secrets.token_urlsafe(32)
        await db.google_oauth_codes.delete_many({"expires_at": {"$lte": now}})
        await db.google_oauth_codes.insert_one({
            "code_hash": hashlib.sha256(auth_code.encode()).hexdigest(),
            "user_id": user["user_id"],
            "expires_at": now + timedelta(minutes=2),
        })
    except Exception:
        logger.exception("Error completando el inicio de sesión propio de Google")
        return RedirectResponse(_append_auth_query(redirect_uri, auth_error="No se pudo validar la cuenta de Google"))

    return RedirectResponse(_append_auth_query(redirect_uri, auth_code=auth_code))


@api_router.post("/auth/google/exchange", response_model=SessionResponse)
async def google_auth_exchange(payload: GoogleCodeExchange):
    now = datetime.now(timezone.utc)
    await db.google_oauth_codes.delete_many({"expires_at": {"$lte": now}})
    code_doc = await db.google_oauth_codes.find_one_and_delete({
        "code_hash": hashlib.sha256(payload.auth_code.encode()).hexdigest(),
        "expires_at": {"$gt": now},
    })
    if not code_doc:
        raise HTTPException(status_code=401, detail="Código de inicio de sesión inválido o vencido")
    user = await db.users.find_one({"user_id": code_doc["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no encontrado")
    token = await _issue_session(user["user_id"])
    return SessionResponse(session_token=token, user=_user_public(user))

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
        "email": True,
        "google": bool(_google_oauth_config()[0] and _google_oauth_config()[1]),
        "apple": True,
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
        name=payload.name.strip() if payload.name and payload.name.strip() else None,
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
        "name": (
            payload.name.strip() if payload.name and payload.name.strip()
            else None if payload.name is not None
            else existing.get("name")
        ),
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

# ============ ESCANEO DE FACTURAS ============
async def _scan_receipt_with_gemini(image_bytes: bytes, currency: str) -> List[Dict[str, Any]]:
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="El escaneo con Gemini no está configurado")

    try:
        image = await run_in_threadpool(prepare_receipt_image, image_bytes)
    except InvalidReceiptImage as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    image_buffer = BytesIO()
    image.save(image_buffer, format="JPEG", quality=85, optimize=True)
    encoded_image = base64.b64encode(image_buffer.getvalue()).decode("ascii")

    prompt = (
        "Lee esta factura de supermercado. Devuelve solo los productos comprados, "
        "sin subtotal, total, impuestos, pagos ni vuelto. Para cada producto indica "
        "el nombre, la cantidad, la unidad (usa 'kg' solo si la factura indica kilos; "
        "en otro caso 'un') y el precio unitario como número. No inventes productos "
        "ni precios; omite las líneas ilegibles. La moneda de la factura es "
        f"{currency}. Si una línea muestra cantidad y precio total de línea, divide "
        "el total por la cantidad para obtener el precio unitario."
    )
    request_body = {
        "contents": [{
            "parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": "image/jpeg", "data": encoded_image}},
            ],
        }],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "properties": {
                    "items": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "name": {"type": "STRING"},
                                "quantity": {"type": "NUMBER"},
                                "unit": {"type": "STRING", "enum": ["un", "kg"]},
                                "price": {"type": "NUMBER"},
                            },
                            "required": ["name", "quantity", "unit", "price"],
                        },
                    },
                },
                "required": ["items"],
            },
            "maxOutputTokens": 2048,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=20) as http:
            response = await http.post(
                "https://generativelanguage.googleapis.com/v1beta/models/"
                "gemini-2.5-flash-lite:generateContent",
                headers={"x-goog-api-key": api_key},
                json=request_body,
            )
        if response.status_code == 429:
            raise HTTPException(
                status_code=429,
                detail="Se alcanzó el límite gratuito de Gemini. Intenta de nuevo más tarde.",
            )
        if response.status_code in (400, 403, 404):
            try:
                error_message = response.json().get("error", {}).get("message", "")
            except (ValueError, AttributeError):
                error_message = ""
            if not isinstance(error_message, str):
                error_message = ""
            safe_error_message = error_message.replace(api_key, "[REDACTED]")[:500]
            logger.error(
                "Gemini rechazó la solicitud de OCR (HTTP %s): %s",
                response.status_code,
                safe_error_message or "sin detalle",
            )
            raise HTTPException(
                status_code=503,
                detail="La configuración gratuita de Gemini no está disponible. Intenta más tarde.",
            )
        response.raise_for_status()
    except HTTPException:
        raise
    except httpx.TimeoutException as e:
        raise HTTPException(
            status_code=504,
            detail="Gemini tardó demasiado en leer la factura. Intenta de nuevo.",
        ) from e
    except httpx.HTTPStatusError as e:
        logger.error("Gemini OCR devolvió HTTP %s", e.response.status_code)
        raise HTTPException(
            status_code=503,
            detail="Gemini no pudo procesar la factura en este momento.",
        ) from e
    except httpx.RequestError as e:
        logger.exception("No se pudo conectar con Gemini para procesar la factura")
        raise HTTPException(
            status_code=503,
            detail="No se pudo conectar con Gemini. Intenta de nuevo más tarde.",
        ) from e

    try:
        response_text = response.json()["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(response_text)
        return [
            GeminiReceiptItem.model_validate(item).model_dump()
            for item in parsed["items"]
        ]
    except (KeyError, IndexError, TypeError, ValueError, ValidationError) as e:
        logger.exception("Gemini devolvió una respuesta OCR inválida")
        raise HTTPException(
            status_code=502,
            detail="Gemini no devolvió productos en un formato válido. Intenta otra vez.",
        ) from e


@api_router.post("/receipt/scan")
async def scan_receipt(payload: OCRRequest, user: Dict[str, Any] = Depends(get_current_user)):
    image_b64 = payload.image_base64
    currency = payload.currency or "PYG"

    if not image_b64:
        raise HTTPException(status_code=400, detail="Imagen no proporcionada")

    try:
        if "," in image_b64:
            image_b64 = image_b64.split(",", 1)[1]
        image_bytes = base64.b64decode(image_b64, validate=True)
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail="La imagen no tiene un formato base64 válido") from e

    if os.environ.get("GEMINI_API_KEY", "").strip():
        items = await _scan_receipt_with_gemini(image_bytes, currency)
    else:
        try:
            items = await run_in_threadpool(scan_receipt_image, image_bytes, currency)
        except InvalidReceiptImage as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except Exception as e:
            logger.exception("Error procesando factura con OCR local")
            raise HTTPException(status_code=503, detail="No se pudo procesar la factura con OCR local") from e

    return {"currency": currency, "items": items}

# ============ SHOPPING LISTS ROUTES ============
async def _backfill_shopping_list_history(row: Dict[str, Any], user_id: str) -> Dict[str, Any]:
    items = row.get("items", [])
    missing = [item for item in items if item.get("estimated_price") is None]
    if not missing:
        return row

    purchases = await db.purchases.find({"user_id": user_id}, {"_id": 0}).sort("date", -1).to_list(3000)
    changed = False
    for item in items:
        if item.get("estimated_price") is not None:
            continue
        item_name = " ".join(str(item.get("name", "")).split()).casefold()
        for purchase in purchases:
            previous = next(
                (entry for entry in purchase.get("items", [])
                 if " ".join(str(entry.get("name", "")).split()).casefold() == item_name),
                None,
            )
            if previous:
                item["estimated_price"] = previous.get("price")
                item["estimated_market_id"] = purchase.get("market_id")
                item["estimated_market_name"] = purchase.get("market_name")
                item["estimated_date"] = purchase.get("date")
                changed = True
                break

    if changed:
        await db.shopping_lists.update_one(
            {"id": row["id"], "user_id": user_id},
            {"$set": {"items": items}},
        )
    return row

@api_router.get("/shopping-lists", response_model=List[ShoppingList])
async def list_shopping_lists(user: Dict[str, Any] = Depends(get_current_user)):
    rows = await db.shopping_lists.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    rows = [await _backfill_shopping_list_history(row, user["user_id"]) for row in rows]
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
    r = await _backfill_shopping_list_history(r, user["user_id"])
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

    data = payload.dict()
    if data.get("status") == "pending" and data.get("estimated_price") is None:
        current_name = " ".join(str(data.get("name", "")).split()).casefold()
        purchases = await db.purchases.find({"user_id": user["user_id"]}, {"_id": 0}).sort("date", -1).to_list(3000)
        for latest_purchase in purchases:
            history_item = next(
                (entry for entry in latest_purchase.get("items", [])
                 if " ".join(str(entry.get("name", "")).split()).casefold() == current_name),
                None,
            )
            if history_item:
                data["estimated_price"] = history_item.get("price")
                data["estimated_market_id"] = latest_purchase.get("market_id")
                data["estimated_market_name"] = latest_purchase.get("market_name")
                data["estimated_date"] = latest_purchase.get("date")
                break
    if data.get("status") == "bought" and not data.get("paid_at"):
        data["paid_at"] = datetime.now(timezone.utc)
    if data.get("status") == "bought" and not data.get("purchase_cycle_id"):
        data["purchase_cycle_id"] = str(uuid.uuid4())

    if data.get("status") != "bought":
        data["paid_price"] = None
        data["paid_market_id"] = None
        data["paid_market_name"] = None
        data["paid_at"] = None
        data["purchase_cycle_id"] = None
        data["imported_purchase_id"] = None

    item = ShoppingListItem(**data)
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

    if upd_dict.get("status") == "bought" and items[idx].get("status") != "bought":
        upd_dict["purchase_cycle_id"] = str(uuid.uuid4())
        upd_dict["imported_purchase_id"] = None
    if upd_dict.get("status") == "bought" and items[idx].get("estimated_price") is None:
        current_name = " ".join(str(items[idx].get("name", "")).split()).casefold()
        purchases = await db.purchases.find({"user_id": user["user_id"]}, {"_id": 0}).sort("date", -1).to_list(3000)
        for latest_purchase in purchases:
            history_item = next(
                (entry for entry in latest_purchase.get("items", [])
                 if " ".join(str(entry.get("name", "")).split()).casefold() == current_name),
                None,
            )
            if history_item:
                upd_dict["estimated_price"] = history_item.get("price")
                upd_dict["estimated_market_id"] = latest_purchase.get("market_id")
                upd_dict["estimated_market_name"] = latest_purchase.get("market_name")
                upd_dict["estimated_date"] = latest_purchase.get("date")
                break

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
        upd_dict["purchase_cycle_id"] = None
        upd_dict["imported_purchase_id"] = None

    for k, v in upd_dict.items():
        items[idx][k] = v

    await db.shopping_lists.update_one(
        {"id": list_id, "user_id": user["user_id"]},
        {"$set": {"items": items}},
    )
    updated = await db.shopping_lists.find_one({"id": list_id, "user_id": user["user_id"]}, {"_id": 0})
    return ShoppingList(**cast(Dict[str, Any], updated))

@api_router.post("/shopping-lists/{list_id}/complete")
async def complete_shopping_list(list_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    """Import confirmed, priced list items into purchase history exactly once per buy cycle."""
    user_id = user["user_id"]
    shopping_list = await db.shopping_lists.find_one(
        {"id": list_id, "user_id": user_id}, {"_id": 0}
    )
    if not shopping_list:
        raise HTTPException(404, "List not found")

    items = shopping_list.get("items", [])
    to_import = [
        item for item in items
        if item.get("status") == "bought" and not item.get("imported_purchase_id")
    ]
    if not to_import:
        latest = await db.shopping_lists.find_one(
            {"id": list_id, "user_id": user_id}, {"_id": 0}
        )
        return {"list": latest, "purchases": [], "imported_count": 0}

    markets: Dict[str, Dict[str, Any]] = {}
    for item in to_import:
        if item.get("paid_price") is None or float(item["paid_price"]) <= 0:
            raise HTTPException(422, f"Confirma el precio de {item.get('name', 'un producto')} antes de registrar la lista")
        market_id = item.get("paid_market_id")
        if not market_id:
            raise HTTPException(422, f"Selecciona un mercado para {item.get('name', 'un producto')}")
        if market_id not in markets:
            market = await db.markets.find_one(
                {"id": market_id, "user_id": user_id}, {"_id": 0}
            )
            if not market:
                raise HTTPException(422, f"El mercado de {item.get('name', 'un producto')} ya no está disponible")
            markets[market_id] = market

    # Keep purchases from different markets/days separate; paid_at preserves the actual
    # purchase month, so a list imported after rollover still appears in its correct report.
    grouped: Dict[Any, List[Dict[str, Any]]] = {}
    now = datetime.now(timezone.utc)
    for item in to_import:
        paid_at = item.get("paid_at")
        if not isinstance(paid_at, datetime):
            paid_at = now
        if paid_at.tzinfo is None:
            paid_at = paid_at.replace(tzinfo=timezone.utc)
        group_key = (item["paid_market_id"], paid_at.date().isoformat())
        grouped.setdefault(group_key, []).append({**item, "_paid_at": paid_at})

    created: List[Purchase] = []
    for (market_id, _purchase_day), group in grouped.items():
        market = markets[market_id]
        cycles = sorted(
            item.get("purchase_cycle_id") or item["id"] for item in group
        )
        source_key = f"{user_id}:{list_id}:{market_id}:{','.join(cycles)}"
        purchase_id = str(uuid.uuid5(uuid.NAMESPACE_URL, source_key))
        purchase_items = [
            PurchaseItem(
                name=item["name"],
                quantity=item.get("quantity", 1),
                unit=item.get("unit", "un"),
                price=float(item["paid_price"]),
                category=item.get("category") or "otros",
            )
            for item in group
        ]
        purchase = Purchase(
            id=purchase_id,
            user_id=user_id,
            market_id=market_id,
            market_name=market["name"],
            currency=shopping_list.get("currency", "PYG"),
            items=purchase_items,
            total=sum(
                entry.price * (entry.quantity if entry.quantity and entry.quantity > 0 else 1)
                for entry in purchase_items
            ),
            name=shopping_list["name"],
            date=max(item["_paid_at"] for item in group),
        )
        # Use Mongo's unique _id as the idempotency key. A retry after interruption
        # safely reuses an already-written purchase rather than creating a duplicate.
        document = purchase.dict()
        document["_id"] = purchase_id
        await db.purchases.update_one(
            {"_id": purchase_id, "user_id": user_id},
            {"$setOnInsert": document},
            upsert=True,
        )
        saved = await db.purchases.find_one(
            {"_id": purchase_id, "user_id": user_id}, {"_id": 0}
        )
        created.append(Purchase(**cast(Dict[str, Any], saved)))

        for item in group:
            await db.shopping_lists.update_one(
                {"id": list_id, "user_id": user_id},
                {"$set": {"items.$[entry].imported_purchase_id": purchase_id}},
                array_filters=[{
                    "entry.id": item["id"],
                    "entry.purchase_cycle_id": item.get("purchase_cycle_id"),
                    "entry.status": "bought",
                }],
            )

    updated = await db.shopping_lists.find_one(
        {"id": list_id, "user_id": user_id}, {"_id": 0}
    )
    return {"list": updated, "purchases": created, "imported_count": len(to_import)}

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
        market_id = r.get("market_id")
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
                "prices": [],
            })

            price_entry = {
                "market_id": market_id,
                "market_name": market_name,
                "price": it.get("price", 0),
                "currency": currency,
                "date": date,
            }

            if not any(existing.get("market_name") == market_name for existing in entry["prices"]):
                entry["prices"].append(price_entry)

    result = []
    for product in products.values():
        prices = sorted(product["prices"], key=lambda x: (float(x.get("price", 0)) or 0, x.get("market_name") or ""))
        cheapest = prices[0] if prices else None
        entry = {
            **product,
            "prices": prices,
            "cheapest_market_id": cheapest.get("market_id") if cheapest else None,
            "cheapest_market_name": cheapest.get("market_name") if cheapest else None,
            "cheapest_price": cheapest.get("price") if cheapest else None,
            "cheapest_currency": cheapest.get("currency") if cheapest else None,
        }
        result.append(entry)

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