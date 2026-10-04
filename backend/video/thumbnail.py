"""Thumbnail: Grok Imagine paints a text-free 16:9 image; the title is set in code so it is always crisp."""
import base64
from pathlib import Path

import requests
from PIL import Image, ImageDraw, ImageFont

from .config import THUMB_SIZE, xai_key

IMAGE_MODEL = "grok-imagine-image-2.0"
FONT_CANDIDATES = ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/HelveticaNeue.ttc",
                   "/Library/Fonts/Arial Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]


def generate_image(prompt: str, out: Path, *, session=requests) -> Path:
    r = session.post("https://api.x.ai/v1/images/generations", timeout=120,
                     headers={"Authorization": f"Bearer {xai_key()}"},
                     json={"model": IMAGE_MODEL, "prompt": f"{prompt}. No text, no letters, no logos.",
                           "n": 1, "aspect_ratio": "16:9", "response_format": "b64_json"})
    r.raise_for_status()
    out.write_bytes(base64.b64decode(r.json()["data"][0]["b64_json"]))
    return out


def _font(size: int):
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def _fit(draw, text: str, max_width: int, max_lines: int = 2):
    """Largest font (84 -> 40 px) at which the title wraps into at most two lines inside max_width."""
    for size in range(84, 39, -4):
        font, words, lines = _font(size), text.split(), [""]
        for word in words:
            trial = f"{lines[-1]} {word}".strip()
            if draw.textlength(trial, font=font) <= max_width:
                lines[-1] = trial
            else:
                lines.append(word)
        if len(lines) <= max_lines and all(draw.textlength(line, font=font) <= max_width for line in lines):
            return lines, font
    return lines[:max_lines], font


def overlay_title(src: Path, out: Path, title: str, accent_hex: str) -> Path:
    w, h = THUMB_SIZE
    img = Image.open(src).convert("RGB")
    scale = max(w / img.width, h / img.height)  # cover-crop to 16:9
    img = img.resize((round(img.width * scale), round(img.height * scale)))
    left, top = (img.width - w) // 2, (img.height - h) // 2
    img = img.crop((left, top, left + w, top + h))
    shade = Image.new("L", (w, h), 0)
    ImageDraw.Draw(shade).rectangle([0, int(h * 0.55), w, h], fill=170)  # darken the lower band for legibility
    img = Image.composite(Image.new("RGB", (w, h), "black"), img, shade.point(lambda v: v))
    draw = ImageDraw.Draw(img)
    lines, font = _fit(draw, title, max_width=w - 180)
    line_h = font.size + 12
    top = h - 72 - line_h * len(lines)
    draw.rectangle([64, top + 6, 76, h - 76], fill=accent_hex)
    for i, line in enumerate(lines):
        draw.text((100, top + i * line_h), line, font=font, fill="white")
    img.save(out, "JPEG", quality=90)
    return out
