from __future__ import annotations

import csv
import json
import os
from datetime import datetime
from pathlib import Path

from .imaging import KST

LOG_FIELDS = [
    "processed_at", "run_mode", "file", "file_hash", "teacher_folder", "teacher_id",
    "taken_at", "session_match", "session_id", "center_id", "class_id", "class_date",
    "candidate_sessions", "face_index", "det_score", "bbox", "face_status", "student_id",
    "similarity", "candidates", "top_scores", "uploaded", "error",
]
DELETION_FIELDS = ["deleted_at", "student_id", "reason", "embeddings_removed", "reference_dir_removed"]

REVIEW_FOLDERS = {
    "no_session": "수업판별불가",
    "no_exif": "촬영시간없음",
    "ambiguous": "수업후보여러개",
    "needs_review": "얼굴확인필요",
}


def now_kst() -> datetime:
    return datetime.now(KST)


def _append_csv(path: Path, fields: list[str], rows: list[dict]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    new_file = not path.exists() or path.stat().st_size == 0
    # 엑셀에서 한글이 깨지지 않도록 새 파일은 BOM을 붙인다.
    with path.open("a", encoding="utf-8-sig" if new_file else "utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        if new_file:
            writer.writeheader()
        writer.writerows(rows)


def append_recognition_log(records_dir: Path, rows: list[dict]) -> None:
    _append_csv(records_dir / "인식기록.csv", LOG_FIELDS, rows)


def append_deletion_log(records_dir: Path, row: dict) -> None:
    _append_csv(records_dir / "삭제기록.csv", DELETION_FIELDS, [row])


def read_recognition_log(records_dir: Path) -> list[dict]:
    path = records_dir / "인식기록.csv"
    if not path.exists():
        return []
    with path.open(encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def _empty_summary(day: str) -> dict:
    return {
        "date": day,
        "runs": 0,
        "photos_processed": 0,
        "photos_uploaded": 0,
        "photos_needs_review": 0,
        "session": {"matched": 0, "no_session": 0, "no_exif": 0, "ambiguous": 0},
        "faces": {"detected": 0, "confirmed": 0, "needs_review": 0, "ignored": 0, "too_small": 0},
        "auto_confirm_rate": None,
        "classes": {},
        "errors": [],
        "updated_at": None,
    }


class DailySummary:
    """기록/요약_YYYY-MM-DD.json. 하메스가 읽는 파일이라 학생 ID·이름은 넣지 않는다."""

    def __init__(self, records_dir: Path, day: str):
        self.path = records_dir / f"요약_{day}.json"
        self.data = _empty_summary(day)
        if self.path.exists():
            self.data.update(json.loads(self.path.read_text(encoding="utf-8")))

    def add_photo(self, session_match: str, session: dict | None, face_counts: dict,
                  needs_review: bool, uploaded: bool) -> None:
        d = self.data
        d["photos_processed"] += 1
        d["photos_uploaded"] += int(uploaded)
        d["photos_needs_review"] += int(needs_review)
        d["session"][session_match] = d["session"].get(session_match, 0) + 1
        for key, value in face_counts.items():
            d["faces"][key] = d["faces"].get(key, 0) + value
        if session:
            entry = d["classes"].setdefault(session["session_id"], {
                "center_name": session.get("center_name", ""),
                "class_id": session.get("class_id", ""),
                "class_name": session.get("class_name", ""),
                "class_date": session.get("class_date", ""),
                "photos": 0, "faces_confirmed": 0, "faces_needs_review": 0,
            })
            entry["photos"] += 1
            entry["faces_confirmed"] += face_counts.get("confirmed", 0)
            entry["faces_needs_review"] += face_counts.get("needs_review", 0)

    def add_error(self, file: str, error: str) -> None:
        self.data["errors"].append(
            {"at": now_kst().isoformat(timespec="seconds"), "file": file, "error": error[:500]}
        )

    def save(self) -> None:
        d = self.data
        d["runs"] += 1
        decided = d["faces"]["confirmed"] + d["faces"]["needs_review"]
        d["auto_confirm_rate"] = round(d["faces"]["confirmed"] / decided, 4) if decided else None
        d["updated_at"] = now_kst().isoformat(timespec="seconds")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, self.path)


def write_review_copy(review_dir: Path, day: str, reason: str, teacher_folder: str,
                      source: Path, file_hash: str, jpeg: bytes) -> Path:
    """원본이 아니라 축소·위치정보 제거본을 저장한다."""
    folder = review_dir / day / REVIEW_FOLDERS[reason]
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"{teacher_folder}_{source.stem}_{file_hash[:8]}.jpg"
    target.write_bytes(jpeg)
    return target
