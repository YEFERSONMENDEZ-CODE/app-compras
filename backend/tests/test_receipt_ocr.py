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
