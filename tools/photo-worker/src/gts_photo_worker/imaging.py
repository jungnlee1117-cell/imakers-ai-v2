from __future__ import annotations

import hashlib
import io
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:  # pragma: no cover - HEIC만 못 읽고 나머지는 동작
    pass

KST = timezone(timedelta(hours=9))
PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".heic", ".heif", ".png"}

_EXIF_IFD = 0x8769
_DATETIME_ORIGINAL = 36867
_OFFSET_TIME_ORIGINAL = 36881
_OFFSET_RE = re.compile(r"^([+-])(\d{2}):?(\d{2})$")


@dataclass
class PreparedPhoto:
    taken_at: datetime | None
    jpeg: bytes
    """긴 변 max_long_side 이하로 줄이고 EXIF(GPS 포함)를 모두 제거한 JPG."""
    bgr: np.ndarray
    """jpeg와 같은 크기·방향의 이미지. 얼굴 좌표는 이 이미지 기준."""
    width: int
    height: int


def is_photo(path: Path) -> bool:
    return path.suffix.lower() in PHOTO_EXTENSIONS and not path.name.startswith(".")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_exif_datetime(value: str | None, offset: str | None) -> datetime | None:
    """EXIF 촬영 시각을 한국 시간으로 변환. 오프셋이 없으면 한국 시간으로 간주."""
    if not value:
        return None
    value = value.strip().rstrip("\x00")
    try:
        naive = datetime.strptime(value[:19], "%Y:%m:%d %H:%M:%S")
    except ValueError:
        return None
    tz = KST
    if offset:
        match = _OFFSET_RE.match(offset.strip().rstrip("\x00"))
        if match:
            sign = 1 if match.group(1) == "+" else -1
            tz = timezone(sign * timedelta(hours=int(match.group(2)), minutes=int(match.group(3))))
    return naive.replace(tzinfo=tz).astimezone(KST)


def read_taken_at(image: Image.Image) -> datetime | None:
    exif = image.getexif()
    sub = exif.get_ifd(_EXIF_IFD) if exif else {}
    return parse_exif_datetime(sub.get(_DATETIME_ORIGINAL), sub.get(_OFFSET_TIME_ORIGINAL))


def _resize(image: Image.Image, max_long_side: int) -> Image.Image:
    long_side = max(image.size)
    if long_side <= max_long_side:
        return image
    scale = max_long_side / long_side
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    return image.resize(size, Image.Resampling.LANCZOS)


def prepare_photo(path: Path, max_long_side: int, jpeg_quality: int) -> PreparedPhoto:
    """원본은 읽기만 한다. 결과는 메모리에만 만든다."""
    with Image.open(path) as original:
        taken_at = read_taken_at(original)
        icc_profile = original.info.get("icc_profile")
        image = ImageOps.exif_transpose(original).convert("RGB")
    image = _resize(image, max_long_side)

    buffer = io.BytesIO()
    save_args = {"quality": jpeg_quality, "optimize": True}
    if icc_profile:
        save_args["icc_profile"] = icc_profile
    # exif를 넘기지 않으므로 GPS를 포함한 메타데이터는 결과 JPG에 남지 않는다.
    image.save(buffer, format="JPEG", **save_args)
    rgb = np.asarray(image)
    bgr = np.ascontiguousarray(rgb[:, :, ::-1])
    return PreparedPhoto(
        taken_at=taken_at,
        jpeg=buffer.getvalue(),
        bgr=bgr,
        width=image.width,
        height=image.height,
    )


def load_bgr(path: Path, max_long_side: int) -> np.ndarray:
    with Image.open(path) as original:
        image = ImageOps.exif_transpose(original).convert("RGB")
    image = _resize(image, max_long_side)
    return np.ascontiguousarray(np.asarray(image)[:, :, ::-1])
