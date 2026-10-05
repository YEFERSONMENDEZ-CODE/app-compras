"""Offline receipt OCR and conservative line-item parsing."""
import re
from io import BytesIO
from functools import lru_cache
from typing import Any, Dict, Iterable, List, Optional

import numpy as np
from PIL import Image, ImageOps
from rapidocr_onnxruntime import RapidOCR


MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 20_000_000
# RapidOCR's detector resizes inputs to this side length internally, but only
# after receiving a full-size NumPy array. Resize first to bound per-scan memory.
MAX_OCR_IMAGE_SIDE = 2000
_PRICE_AT_END = re.compile(
    r"(?P<amount>(?:[$₲]\s*)?\d[\d.,]*)(?:\s*(?:₲|Gs\.?|PYG|USD|EUR|BRL|ARS))?\s*$",
    re.IGNORECASE,
)
_QUANTITY = re.compile(r"(?<!\w)(\d+(?:[.,]\d+)?)\s*[xX]\s*")
_NON_ITEM_LINE = re.compile(
    r"^\s*(?:subtotal|sub\s*total|total|descuento|discount|iva|impuesto|"
    r"efectivo|vuelto|cambio|tarjeta|pago|ruc|timbrado|factura|fecha|hora)\b",
    re.IGNORECASE,
)


class InvalidReceiptImage(ValueError):
    """Raised when the supplied bytes are not a supported, safe-sized image."""


@lru_cache(maxsize=1)
def _ocr_engine() -> RapidOCR:
    # The OCR models ship with rapidocr-onnxruntime; no API key or model download.
    return RapidOCR()


def _parse_amount(raw: str, currency: str) -> Optional[float]:
    value = re.sub(r"[$₲\s]", "", raw)
    value = re.sub(r"(?:Gs\.?|PYG|USD|EUR|BRL|ARS)$", "", value, flags=re.IGNORECASE)
    if not value or not re.fullmatch(r"\d[\d.,]*", value):
        return None

    comma, dot = value.rfind(","), value.rfind(".")
    decimal_separator: Optional[str] = None
    if comma >= 0 and dot >= 0:
        separator = "," if comma > dot else "."
        trailing = len(value) - max(comma, dot) - 1
        if trailing in (1, 2):
            decimal_separator = separator
    elif comma >= 0 or dot >= 0:
        separator = "," if comma >= 0 else "."
        trailing = len(value) - value.rfind(separator) - 1
        if currency.upper() != "PYG" and trailing in (1, 2):
            decimal_separator = separator

    if decimal_separator:
        decimal_index = value.rfind(decimal_separator)
        whole = re.sub(r"[.,]", "", value[:decimal_index])
        fraction = value[decimal_index + 1 :]
        normalized = f"{whole}.{fraction}"
    else:
        normalized = re.sub(r"[.,]", "", value)

    try:
        amount = float(normalized)
    except ValueError:
        return None
    return amount if amount > 0 else None


def parse_receipt_lines(lines: Iterable[str], currency: str = "PYG") -> List[Dict[str, Any]]:
    """Extract likely product rows while excluding common receipt totals."""
    items: List[Dict[str, Any]] = []
    for raw_line in lines:
        line = " ".join(str(raw_line).split()).strip()
        if not line or _NON_ITEM_LINE.match(line):
            continue

        price_match = _PRICE_AT_END.search(line)
        if not price_match:
            continue
        total_price = _parse_amount(price_match.group("amount"), currency)
        if total_price is None:
            continue

        name = line[: price_match.start()].strip(" -:|.")
        quantity = 1.0
        quantity_match = _QUANTITY.search(name)
        if quantity_match:
            try:
                quantity = float(quantity_match.group(1).replace(",", "."))
            except ValueError:
                quantity = 1.0
            name = (name[: quantity_match.start()] + name[quantity_match.end() :]).strip(" -:|.")
            # Receipts often print "2 x unit-price line-total"; use the line total
            # divided by quantity and exclude the preceding unit price from the name.
            unit_price_match = _PRICE_AT_END.search(name)
            if unit_price_match:
                name = name[: unit_price_match.start()].strip(" -:|.")
        if not name or quantity <= 0:
            continue

        items.append(
            {
                "name": name,
                "quantity": quantity,
                "unit": "un",
                "price": round(total_price / quantity, 2),
                "category": "otros",
            }
        )
    return items


def scan_receipt_image(image_bytes: bytes, currency: str = "PYG") -> List[Dict[str, Any]]:
    """Run bundled, CPU-based OCR on a JPEG/PNG and return likely receipt items."""
    if not image_bytes or len(image_bytes) > MAX_IMAGE_BYTES:
        raise InvalidReceiptImage("La imagen está vacía o supera el límite permitido.")

    try:
        with Image.open(BytesIO(image_bytes)) as source:
            width, height = source.size
            if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
                raise InvalidReceiptImage("La resolución de la imagen supera el límite permitido.")
            source.thumbnail(
                (MAX_OCR_IMAGE_SIDE, MAX_OCR_IMAGE_SIDE),
                Image.Resampling.LANCZOS,
            )
            image = np.asarray(ImageOps.exif_transpose(source).convert("RGB"))[:, :, ::-1].copy()
    except InvalidReceiptImage:
        raise
    except Exception as e:
        raise InvalidReceiptImage("El archivo no es una imagen compatible válida.") from e
    if image.size == 0:
        raise InvalidReceiptImage("El archivo no es una imagen JPEG o PNG válida.")

    output, _ = _ocr_engine()(image)
    lines = [row[1] for row in output or [] if len(row) > 1 and row[1]]
    return parse_receipt_lines(lines, currency)
