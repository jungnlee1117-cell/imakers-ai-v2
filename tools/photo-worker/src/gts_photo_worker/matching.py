"""수업 판별과 얼굴 판정 규칙. 모델·파일·네트워크와 무관한 순수 로직."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

import numpy as np

SESSION_MATCHED = "matched"
SESSION_NONE = "no_session"
SESSION_NO_EXIF = "no_exif"
SESSION_AMBIGUOUS = "ambiguous"

FACE_CONFIRMED = "confirmed"
FACE_NEEDS_REVIEW = "needs_review"
FACE_IGNORED = "ignored"


@dataclass(frozen=True)
class Session:
    session_id: str
    teacher_id: str
    center_id: str
    class_id: str
    class_date: str
    start: datetime
    end: datetime
    center_name: str = ""
    class_name: str = ""

    def to_dict(self) -> dict:
        return {
            "session_id": self.session_id,
            "teacher_id": self.teacher_id,
            "center_id": self.center_id,
            "center_name": self.center_name,
            "class_id": self.class_id,
            "class_name": self.class_name,
            "class_date": self.class_date,
            "start": self.start.isoformat(),
            "end": self.end.isoformat(),
        }


@dataclass
class SessionResult:
    match: str
    session: Session | None = None
    candidates: list[Session] = field(default_factory=list)


def sessions_in_window(
    sessions: list[Session], taken_at: datetime, before_minutes: int, after_minutes: int
) -> list[Session]:
    before = timedelta(minutes=before_minutes)
    after = timedelta(minutes=after_minutes)
    return [s for s in sessions if s.start - before <= taken_at <= s.end + after]


def decide_session(taken_at: datetime | None, candidates: list[Session]) -> SessionResult:
    """candidates: 이미 여유폭을 적용해 걸러진 후보. 추측으로 하나를 고르지 않는다."""
    if taken_at is None:
        return SessionResult(SESSION_NO_EXIF)
    unique = {s.session_id: s for s in candidates}
    if not unique:
        return SessionResult(SESSION_NONE)
    if len(unique) > 1:
        ordered = sorted(unique.values(), key=lambda s: (s.start, s.session_id))
        return SessionResult(SESSION_AMBIGUOUS, candidates=ordered)
    (only,) = unique.values()
    return SessionResult(SESSION_MATCHED, session=only)


@dataclass
class FaceDecision:
    face_index: int
    bbox: tuple[int, int, int, int]
    det_score: float
    status: str
    student_id: str | None = None
    similarity: float | None = None
    candidates: list[tuple[str, float]] = field(default_factory=list)
    top_scores: list[tuple[str, float]] = field(default_factory=list)
    """판정 근거(상위 5명 유사도). 기준값 재조정(evaluate)에만 쓰고 플랫폼에 보내지 않는다."""

    def to_upload(self) -> dict:
        return {
            "face_index": self.face_index,
            "bbox": list(self.bbox),
            "status": self.status,
            "student_id": self.student_id,
            "similarity": None if self.similarity is None else round(self.similarity, 4),
            "candidates": [
                {"student_id": sid, "similarity": round(sim, 4)} for sid, sim in self.candidates
            ],
        }


def score_face(
    embedding: np.ndarray, gallery: dict[str, np.ndarray]
) -> list[tuple[str, float]]:
    """gallery: 학생ID → (N, D) 정규화된 기준 특징값. 학생별 최대 코사인 유사도, 내림차순."""
    scores = []
    for student_id, refs in gallery.items():
        if len(refs) == 0:
            continue
        scores.append((student_id, float(np.max(refs @ embedding))))
    scores.sort(key=lambda item: (-item[1], item[0]))
    return scores


def classify_face(
    scores: list[tuple[str, float]],
    high: float,
    mid: float,
    min_margin: float,
    max_candidates: int,
) -> tuple[str, str | None, float | None, list[tuple[str, float]]]:
    if not scores or scores[0][1] < mid:
        return FACE_IGNORED, None, None, []
    top_id, top_sim = scores[0]
    runner_up = scores[1][1] if len(scores) > 1 else None
    clear_margin = runner_up is None or top_sim - runner_up >= min_margin
    if top_sim >= high and clear_margin:
        return FACE_CONFIRMED, top_id, top_sim, []
    candidates = [(sid, sim) for sid, sim in scores if sim >= mid][:max_candidates]
    return FACE_NEEDS_REVIEW, None, top_sim, candidates


def resolve_duplicates(decisions: list[FaceDecision], max_candidates: int, mid: float) -> None:
    """한 사진에서 같은 학생이 두 얼굴에 확정되면 가장 높은 얼굴만 남기고 나머지는 확인필요로."""
    best: dict[str, FaceDecision] = {}
    for decision in decisions:
        if decision.status != FACE_CONFIRMED:
            continue
        current = best.get(decision.student_id)
        if current is None or (decision.similarity or 0) > (current.similarity or 0):
            best[decision.student_id] = decision
    for decision in decisions:
        if decision.status == FACE_CONFIRMED and best[decision.student_id] is not decision:
            decision.status = FACE_NEEDS_REVIEW
            decision.student_id = None
            decision.candidates = [
                (sid, sim) for sid, sim in decision.top_scores if sim >= mid
            ][:max_candidates]
