import json

from gts_photo_worker.evaluate import (
    GroundTruth,
    evaluate_faces,
    evaluate_sessions,
    latest_rows_by_file,
    recommend,
    sweep,
)


def row(file, match, session_id, face_index="", scores=None, at="2026-09-28T16:20:00+09:00"):
    return {
        "processed_at": at, "file": file, "session_match": match, "session_id": session_id,
        "face_index": face_index, "top_scores": json.dumps(scores or []),
    }


LOG = [
    row("a.jpg", "matched", "S-A", "0", [["S001", 0.72], ["S002", 0.40]]),
    row("a.jpg", "matched", "S-A", "1", [["S002", 0.55], ["S001", 0.30]]),
    row("b.jpg", "matched", "S-B"),
    row("c.jpg", "no_session", ""),
    row("d.jpg", "no_exif", ""),
    row("e.jpg", "matched", "S-A", "0", [["S003", 0.65], ["S001", 0.2]]),
    row("a.jpg", "no_exif", "", at="2026-09-28T10:00:00+09:00"),
]
TRUTH = [
    GroundTruth("a.jpg", "S-A", {"S001", "S002"}),
    GroundTruth("b.jpg", "S-A", set()),
    GroundTruth("c.jpg", "", set()),
    GroundTruth("d.jpg", "S-A", set()),
    GroundTruth("e.jpg", "S-A", {"S001"}),
    GroundTruth("missing.jpg", "S-A", set()),
]


def test_latest_run_wins():
    by_file = latest_rows_by_file(LOG)
    assert len(by_file["a.jpg"]) == 2


def test_session_accuracy():
    stats = evaluate_sessions(TRUTH, latest_rows_by_file(LOG))
    assert stats["total"] == 5 and stats["missing_in_log"] == 1
    assert stats["auto_correct"] == 2
    assert stats["auto_wrong"] == 1 and stats["wrong_files"] == ["b.jpg"]
    assert stats["to_review"] == 1 and stats["correct_reject"] == 1


def test_face_sweep_tradeoff():
    by_file = latest_rows_by_file(LOG)
    low = evaluate_faces(TRUTH, by_file, 0.5, 0.36, 0.05, 3)
    assert (low["true_positive"], low["false_positive"], low["missed"]) == (2, 1, 1)
    high = evaluate_faces(TRUTH, by_file, 0.7, 0.36, 0.05, 3)
    assert (high["true_positive"], high["false_positive"], high["missed"]) == (1, 0, 2)
    assert high["review_faces"] == 2
    best = recommend(sweep(TRUTH, by_file, 0.36, 0.05, 3), 0.99)
    assert best is not None and 0.65 < best["high_threshold"] <= 0.72
