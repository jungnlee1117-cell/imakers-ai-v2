from __future__ import annotations

import io
import os
import time
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from gts_photo_worker.config import load_config
from gts_photo_worker.faces import DetectedFace


def make_jpeg(path: Path, color: tuple[int, int, int], taken_at: str | None = None,
              offset: str | None = None, gps: bool = False, size=(1200, 900)) -> Path:
    exif = Image.Exif()
    if taken_at:
        exif.get_ifd(0x8769)[36867] = taken_at
        if offset:
            exif.get_ifd(0x8769)[36881] = offset
    if gps:
        g = exif.get_ifd(0x8825)
        g[1] = "N"
        g[2] = (37.0, 32.0, 0.0)
    path.parent.mkdir(parents=True, exist_ok=True)
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, "JPEG", exif=exif, quality=95)
    path.write_bytes(buffer.getvalue())
    old = time.time() - 3600
    os.utime(path, (old, old))
    return path


def unit(values) -> np.ndarray:
    v = np.asarray(values, dtype=np.float32)
    return v / np.linalg.norm(v)


class FakeEngine:
    """이미지 평균 색으로 사진을 구분해 미리 정한 얼굴(좌표, 특징값)을 돌려준다."""

    def __init__(self):
        self.by_color: dict[tuple[int, int, int], list[tuple[tuple[int, int, int, int], np.ndarray]]] = {}

    def add(self, color, faces):
        self.by_color[color] = [(bbox, unit(vec)) for bbox, vec in faces]

    def _lookup(self, bgr):
        mean = bgr.reshape(-1, 3).mean(axis=0)[::-1]
        key = min(self.by_color, key=lambda c: np.abs(np.asarray(c) - mean).sum(), default=None)
        if key is None or np.abs(np.asarray(key) - mean).sum() > 12:
            return []
        return self.by_color[key]

    def detect(self, bgr):
        return [DetectedFace(bbox, 0.95, vec) for bbox, vec in self._lookup(bgr)]

    def embed(self, bgr, face):
        return face.raw


CONFIG = """
drive_root: "{drive}"
platform:
  mode: local
session_window:
  before_minutes: 15
  after_minutes: 30
face:
  high_threshold: 0.8
  mid_threshold: 0.5
  min_margin: 0.05
  max_candidates: 3
  min_face_px: 40
run:
  min_file_age_seconds: 60
"""


@pytest.fixture
def home(tmp_path: Path) -> Path:
    home = tmp_path / "사진분류"
    drive = tmp_path / "GTS수업사진"
    (drive / "김선생님").mkdir(parents=True)
    for sub in ("기준사진", "기록", "확인필요", "모델", "시간표"):
        (home / sub).mkdir(parents=True)
    (home / "config.yaml").write_text(CONFIG.format(drive=drive), encoding="utf-8")
    t = home / "시간표"
    (t / "선생님.csv").write_text("drive_folder_name,teacher_id\n김선생님,T001\n", encoding="utf-8")
    # 2026-09-28은 월요일
    (t / "시간표.csv").write_text(
        "session_id,teacher_id,center_id,center_name,class_id,class_name,date,weekday,start_time,end_time\n"
        ",T001,C03,엘리트코어,EC-KA,유아A반,,월,16:00,16:50\n"
        ",T001,C03,엘리트코어,EC-KB,유아B반,,월,17:00,17:50\n",
        encoding="utf-8",
    )
    (t / "출석명단.csv").write_text(
        "class_id,student_id,student_name,date,attended\n"
        "EC-KA,S001,김하준,,true\n"
        "EC-KA,S002,이서윤,,true\n"
        "EC-KA,S003,박도윤,,true\n"
        "EC-KA,S009,미동의,,true\n"
        "EC-KB,S004,최지우,,true\n",
        encoding="utf-8",
    )
    (t / "동의명단.csv").write_text(
        "student_id,face_consent,updated_at,revoked_at\n"
        "S001,true,2026-09-01,\nS002,true,2026-09-01,\nS003,true,2026-09-01,\n"
        "S004,true,2026-09-01,\nS009,false,2026-09-01,\n",
        encoding="utf-8",
    )
    return home


@pytest.fixture
def cfg(home: Path):
    return load_config(home)
