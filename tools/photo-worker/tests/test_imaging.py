import io
from datetime import datetime

from PIL import Image

from gts_photo_worker.imaging import KST, parse_exif_datetime, prepare_photo, sha256_file

from conftest import make_jpeg


def test_parse_exif_datetime_defaults_to_kst():
    assert parse_exif_datetime("2026:09:28 16:10:00", None) == datetime(2026, 9, 28, 16, 10, tzinfo=KST)


def test_parse_exif_datetime_converts_offset_to_kst():
    value = parse_exif_datetime("2026:09:28 07:10:00", "+00:00")
    assert value == datetime(2026, 9, 28, 16, 10, tzinfo=KST)


def test_parse_exif_datetime_rejects_garbage():
    assert parse_exif_datetime("0000:00:00 00:00:00", None) is None
    assert parse_exif_datetime("", None) is None


def test_prepare_photo_resizes_strips_metadata_and_keeps_original(tmp_path):
    src = make_jpeg(tmp_path / "a.jpg", (10, 20, 30), "2026:09:28 16:10:00", gps=True, size=(4032, 3024))
    before = sha256_file(src)
    prepared = prepare_photo(src, 2048, 90)
    assert sha256_file(src) == before
    assert prepared.taken_at == datetime(2026, 9, 28, 16, 10, tzinfo=KST)
    assert (prepared.width, prepared.height) == (2048, 1536)
    assert prepared.bgr.shape == (1536, 2048, 3)
    out = Image.open(io.BytesIO(prepared.jpeg))
    exif = out.getexif()
    assert not exif.get_ifd(0x8825)
    assert len(exif) == 0


def test_prepare_photo_without_exif(tmp_path):
    src = make_jpeg(tmp_path / "kakao.jpg", (10, 20, 30))
    assert prepare_photo(src, 2048, 90).taken_at is None
