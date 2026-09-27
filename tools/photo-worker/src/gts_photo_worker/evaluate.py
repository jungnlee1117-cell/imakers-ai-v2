"""Phase 1 정확도 측정. 수업 판별과 얼굴 판정을 따로 계산하고, 확정 기준값별 결과를 비교한다.

정답 CSV 형식 (UTF-8, 헤더 포함):
    file,session_id,student_ids
    김선생님/IMG_0001.HEIC,EC-유아A-2026-09-28-1600,S001;S003
    김선생님/IMG_0002.HEIC,,                     ← 수업 사진이 아니면 session_id를 비운다
student_ids에는 사진에 얼굴이 보이는 동의 학생만 적는다.
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from pathlib import Path

from .matching import (
    FACE_CONFIRMED,
    FACE_NEEDS_REVIEW,
    SESSION_MATCHED,
    FaceDecision,
    classify_face,
    resolve_duplicates,
)


@dataclass
class GroundTruth:
    file: str
    session_id: str
    student_ids: set[str]


def load_ground_truth(path: Path) -> list[GroundTruth]:
    with path.open(encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.DictReader(fh))
    result = []
    for row in rows:
        ids = {s.strip() for s in (row.get("student_ids") or "").replace(",", ";").split(";") if s.strip()}
        result.append(GroundTruth(row["file"].strip(), (row.get("session_id") or "").strip(), ids))
    return result


def latest_rows_by_file(log_rows: list[dict]) -> dict[str, list[dict]]:
    """같은 사진을 여러 번 처리했으면 가장 최근 처리 결과만 쓴다."""
    grouped: dict[str, dict[str, list[dict]]] = {}
    for row in log_rows:
        grouped.setdefault(row["file"], {}).setdefault(row["processed_at"], []).append(row)
    return {file: runs[max(runs)] for file, runs in grouped.items()}


def _scores(row: dict) -> list[tuple[str, float]]:
    raw = row.get("top_scores") or "[]"
    return [(str(sid), float(sim)) for sid, sim in json.loads(raw)]


def evaluate_sessions(truth: list[GroundTruth], by_file: dict[str, list[dict]]) -> dict:
    stats = {"total": 0, "auto_correct": 0, "auto_wrong": 0, "to_review": 0,
             "correct_reject": 0, "missing_in_log": 0, "wrong_files": []}
    for gt in truth:
        rows = by_file.get(gt.file)
        if not rows:
            stats["missing_in_log"] += 1
            continue
        stats["total"] += 1
        row = rows[0]
        matched = row["session_match"] == SESSION_MATCHED
        if gt.session_id:
            if matched and row["session_id"] == gt.session_id:
                stats["auto_correct"] += 1
            elif matched:
                stats["auto_wrong"] += 1
                stats["wrong_files"].append(gt.file)
            else:
                stats["to_review"] += 1
        elif matched:
            stats["auto_wrong"] += 1
            stats["wrong_files"].append(gt.file)
        else:
            stats["correct_reject"] += 1
    decided = stats["total"]
    stats["accuracy"] = round((stats["auto_correct"] + stats["correct_reject"]) / decided, 4) if decided else None
    return stats


def evaluate_faces(truth: list[GroundTruth], by_file: dict[str, list[dict]], high: float, mid: float,
                   min_margin: float, max_candidates: int) -> dict:
    """수업 판별이 맞은 사진만 대상으로 얼굴 판정을 평가한다."""
    tp = fp = fn = review_faces = photos = 0
    for gt in truth:
        rows = by_file.get(gt.file)
        if not rows or not gt.session_id:
            continue
        if rows[0]["session_match"] != SESSION_MATCHED or rows[0]["session_id"] != gt.session_id:
            continue
        photos += 1
        decisions = []
        for row in rows:
            if row.get("face_index", "") == "":
                continue
            scores = _scores(row)
            status, sid, sim, cands = classify_face(scores, high, mid, min_margin, max_candidates)
            decisions.append(FaceDecision(int(row["face_index"]), (0, 0, 0, 0), 0.0, status, sid, sim,
                                          cands, scores))
        resolve_duplicates(decisions, max_candidates, mid)
        predicted = {d.student_id for d in decisions if d.status == FACE_CONFIRMED}
        review_faces += sum(1 for d in decisions if d.status == FACE_NEEDS_REVIEW)
        tp += len(predicted & gt.student_ids)
        fp += len(predicted - gt.student_ids)
        fn += len(gt.student_ids - predicted)
    return {
        "high_threshold": round(high, 4),
        "photos": photos,
        "true_positive": tp,
        "false_positive": fp,
        "missed": fn,
        "review_faces": review_faces,
        "precision": round(tp / (tp + fp), 4) if tp + fp else None,
        "recall": round(tp / (tp + fn), 4) if tp + fn else None,
    }


def sweep(truth, by_file, mid: float, min_margin: float, max_candidates: int,
          start: float | None = None, stop: float = 0.8, step: float = 0.02) -> list[dict]:
    value = start if start is not None else mid
    results = []
    while value <= stop + 1e-9:
        results.append(evaluate_faces(truth, by_file, value, mid, min_margin, max_candidates))
        value += step
    return results


def recommend(results: list[dict], target_precision: float) -> dict | None:
    """정밀도 목표를 만족하는 가장 낮은 확정 기준값(=자동 확정이 가장 많은 값)."""
    for row in results:
        if row["precision"] is not None and row["precision"] >= target_precision:
            return row
    return None
