import asyncio
import base64
from io import BytesIO

import pytest
from PIL import Image, ImageDraw, ImageFont

import server
from receipt_ocr import InvalidReceiptImage, parse_receipt_lines, scan_receipt_image


@pytest.fixture(autouse=True)
def seed_user():
    """These isolated OCR tests do not need the Mongo-backed integration fixture."""
    yield


def _receipt_image(text="LECHE 2 X 5.000 10.000"):
    image = Image.new("RGB", (1800, 180), "white")
    ImageDraw.Draw(image).text(
        (30, 35), text, fill="black", font=ImageFont.load_default(size=64)
    )
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def test_parse_receipt_lines_extracts_items_and_ignores_totals():
    items = parse_receipt_lines(
        ["LECHE 2 X 5.000 10.000", "PAN 1.500", "TOTAL 11.500", "VUELTO 500"]
    )

    assert items == [
        {
            "name": "LECHE",
            "quantity": 2.0,
            "unit": "un",
            "price": 5000.0,
            "category": "otros",
        },
        {
            "name": "PAN",
            "quantity": 1.0,
            "unit": "un",
            "price": 1500.0,
            "category": "otros",
        },
    ]


def test_parse_receipt_lines_handles_decimal_currency():
    assert parse_receipt_lines(["COFFEE 1,234.56"], "USD")[0]["price"] == 1234.56
    assert parse_receipt_lines(["COFFEE 1,25"], "EUR")[0]["price"] == 1.25


def test_scan_receipt_image_rejects_invalid_image():
    with pytest.raises(InvalidReceiptImage):
        scan_receipt_image(b"not an image")


def test_scan_endpoint_downscales_large_images_before_ocr(monkeypatch):
    dimensions = {}
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    class FakeOCREngine:
        def __call__(self, image):
            dimensions["shape"] = image.shape
            return [], None

    monkeypatch.setattr("receipt_ocr._ocr_engine", lambda: FakeOCREngine())
    image = Image.new("RGB", (3000, 2400), "white")
    output = BytesIO()
    image.save(output, format="PNG")
    payload = server.OCRRequest(
        image_base64=base64.b64encode(output.getvalue()).decode("ascii"),
        currency="PYG",
    )

    result = asyncio.run(server.scan_receipt(payload, user={"user_id": "test-user"}))

    assert result == {"currency": "PYG", "items": []}
    assert max(dimensions["shape"][:2]) == 2000


def test_scan_endpoint_uses_local_ocr_without_gemini_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    image_base64 = base64.b64encode(_receipt_image()).decode("ascii")
    payload = server.OCRRequest(image_base64=image_base64, currency="PYG")

    result = asyncio.run(server.scan_receipt(payload, user={"user_id": "test-user"}))

    assert result["currency"] == "PYG"
    assert result["items"]
    assert result["items"][0]["name"] == "LECHE"
    assert result["items"][0]["quantity"] == 2
    assert result["items"][0]["price"] == 5000


def test_gemini_scan_returns_structured_items_and_uses_free_flash_lite(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-api-key")
    request = {}

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {
                "candidates": [{
                    "content": {
                        "parts": [{
                            "text": (
                                '{"items":[{"name":"LECHE","quantity":2,'
                                '"unit":"un","price":5000}]}'
                            )
                        }]
                    }
                }]
            }

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def post(self, url, headers, json):
            request.update({"url": url, "headers": headers, "body": json})
            return FakeResponse()

    monkeypatch.setattr(server.httpx, "AsyncClient", lambda **_: FakeClient())
    result = asyncio.run(server._scan_receipt_with_gemini(_receipt_image(), "PYG"))

    assert request["url"].endswith("gemini-3.5-flash-lite:generateContent")
    assert request["headers"] == {"x-goog-api-key": "test-api-key"}
    assert request["body"]["contents"][0]["parts"][1]["inline_data"]["mime_type"] == "image/jpeg"
    assert result == [{
        "name": "LECHE",
        "quantity": 2,
        "unit": "un",
        "price": 5000,
        "category": "otros",
    }]


def test_scan_endpoint_uses_gemini_when_configured(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-api-key")
    called = {}

    async def fake_gemini_scan(image_bytes, currency):
        called["image_bytes"] = image_bytes
        called["currency"] = currency
        return [{"name": "PAN", "quantity": 1, "unit": "un", "price": 1500}]

    monkeypatch.setattr(server, "_scan_receipt_with_gemini", fake_gemini_scan)
    payload = server.OCRRequest(
        image_base64=base64.b64encode(_receipt_image()).decode("ascii"),
        currency="PYG",
    )

    result = asyncio.run(server.scan_receipt(payload, user={"user_id": "test-user"}))

    assert called["image_bytes"]
    assert called["currency"] == "PYG"
    assert result["items"][0]["name"] == "PAN"


def test_gemini_scan_reports_free_quota_exhaustion(monkeypatch):
    from fastapi import HTTPException

    monkeypatch.setenv("GEMINI_API_KEY", "test-api-key")

    class FakeResponse:
        status_code = 429

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def post(self, _url, **_):
            return FakeResponse()

    monkeypatch.setattr(server.httpx, "AsyncClient", lambda **_: FakeClient())
    with pytest.raises(HTTPException) as exc:
        asyncio.run(server._scan_receipt_with_gemini(_receipt_image(), "PYG"))

    assert exc.value.status_code == 429
    assert "límite gratuito" in exc.value.detail


def test_gemini_scan_logs_bad_request_reason_without_logging_api_key(monkeypatch, caplog):
    from fastapi import HTTPException

    api_key = "secret-test-api-key"
    monkeypatch.setenv("GEMINI_API_KEY", api_key)

    class FakeResponse:
        status_code = 400

        def json(self):
            return {
                "error": {
                    "message": f"Invalid request for key {api_key}: unsupported field",
                }
            }

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def post(self, _url, **_):
            return FakeResponse()

    monkeypatch.setattr(server.httpx, "AsyncClient", lambda **_: FakeClient())
    with pytest.raises(HTTPException) as exc:
        asyncio.run(server._scan_receipt_with_gemini(_receipt_image(), "PYG"))

    assert exc.value.status_code == 503
    assert "[REDACTED]" in caplog.text
    assert "unsupported field" in caplog.text
    assert api_key not in caplog.text
