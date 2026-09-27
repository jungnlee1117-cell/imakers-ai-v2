from datetime import datetime

import numpy as np

from gts_photo_worker.imaging import KST
from gts_photo_worker.matching import (
    FACE_CONFIRMED,
    FACE_IGNORED,
    FACE_NEEDS_REVIEW,
    SESSION_AMBIGUOUS,
    SESSION_MATCHED,
    SESSION_NO_EXIF,
    SESSION_NONE,
    FaceDecision,
    Session,
    classify_face,
    decide_session,
    resolve_duplicates,
    score_face,
    sessions_in_window,
)


def session(sid, start, end):
    day = datetime(2026, 9, 28, tzinfo=KST)
    h1, m1 = start
    h2, m2 = end
    return Session(sid, "T001", "C03", sid, "2026-09-28",
                   day.replace(hour=h1, minute=m1), day.replace(hour=h2, minute=m2))


def at(h, m):
    return datetime(2026, 9, 28, h, m, tzinfo=KST)


A = session("A", (16, 0), (16, 50))
B = session("B", (17, 30), (18, 20))


def test_window_boundaries_are_inclusive():
    assert sessions_in_window([A], at(15, 45), 15, 30) == [A]
    assert sessions_in_window([A], at(15, 44), 15, 30) == []
    assert sessions_in_window([A], at(17, 20), 15, 30) == [A]
    assert sessions_in_window([A], at(17, 21), 15, 30) == []


def test_decide_session_cases():
    assert decide_session(None, [A]).match == SESSION_NO_EXIF
    assert decide_session(at(12, 0), []).match == SESSION_NONE
    matched = decide_session(at(16, 10), [A])
    assert matched.match == SESSION_MATCHED and matched.session == A
    overlap = decide_session(at(17, 18), sessions_in_window([A, B], at(17, 18), 15, 30))
    assert overlap.match == SESSION_AMBIGUOUS
    assert [s.session_id for s in overlap.candidates] == ["A", "B"]
    assert overlap.session is None


def test_score_face_uses_best_reference_per_student():
    gallery = {
        "S1": np.array([[1, 0], [0, 1]], dtype=np.float32),
        "S2": np.array([[0.6, 0.8]], dtype=np.float32),
    }
    scores = score_face(np.array([0, 1], dtype=np.float32), gallery)
    assert scores[0] == ("S1", 1.0)
    assert scores[1][0] == "S2"


def test_classify_face_thresholds_and_margin():
    assert classify_face([("S1", 0.9), ("S2", 0.3)], 0.8, 0.5, 0.05, 3)[:2] == (FACE_CONFIRMED, "S1")
    status, sid, sim, cands = classify_face([("S1", 0.6), ("S2", 0.55), ("S3", 0.52), ("S4", 0.51)],
                                            0.8, 0.5, 0.05, 3)
    assert status == FACE_NEEDS_REVIEW and sid is None and len(cands) == 3
    status, _, _, cands = classify_face([("S1", 0.85), ("S2", 0.83)], 0.8, 0.5, 0.05, 3)
    assert status == FACE_NEEDS_REVIEW and [c[0] for c in cands] == ["S1", "S2"]
    assert classify_face([("S1", 0.4)], 0.8, 0.5, 0.05, 3)[0] == FACE_IGNORED
    assert classify_face([], 0.8, 0.5, 0.05, 3)[0] == FACE_IGNORED


def test_same_student_confirmed_twice_keeps_best_only():
    a = FaceDecision(0, (0, 0, 1, 1), 0.9, FACE_CONFIRMED, "S1", 0.85, [], [("S1", 0.85), ("S2", 0.6)])
    b = FaceDecision(1, (0, 0, 1, 1), 0.9, FACE_CONFIRMED, "S1", 0.92, [], [("S1", 0.92)])
    resolve_duplicates([a, b], 3, 0.5)
    assert b.status == FACE_CONFIRMED and b.student_id == "S1"
    assert a.status == FACE_NEEDS_REVIEW and a.student_id is None
    assert a.candidates == [("S1", 0.85), ("S2", 0.6)]
