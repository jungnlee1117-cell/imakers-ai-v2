import json
import os
import time

import pytest

from gts_photo_worker.faces import FaceStore
from gts_photo_worker.imaging import sha256_file
from gts_photo_worker.pipeline import Worker
from gts_photo_worker.platform import LocalPlatform
from gts_photo_worker.records import read_recognition_log
from gts_photo_worker.state import AlreadyRunning, run_lock

from conftest import FakeEngine, make_jpeg, unit

VEC = {
    "S001": [1, 0, 0, 0],
    "S002": [0, 1, 0, 0],
    "S003": [0, 0, 1, 0],
    "S004": [0, 0, 0, 1],
}
RED, GREEN, BLUE, GRAY, WHITE = (200, 0, 0), (0, 200, 0), (0, 0, 200), (120, 120, 120), (250, 250, 250)


def register_all(cfg):
    store = FaceStore(cfg.faces_db)
    for sid, vec in VEC.items():
        store.replace_student(sid, [("ref1.jpg", "hash", unit(vec))])
    store.close()


@pytest.fixture
def scenario(cfg):
    teacher = cfg.drive_root / "김선생님"
    engine = FakeEngine()
    engine.add(RED, [
        ((10, 10, 100, 100), [1, 0.05, 0, 0]),       # S001 확정
        ((200, 10, 100, 100), [0, 1, 1, 0]),          # S002/S003 비슷 → 확인필요
        ((400, 10, 20, 20), [1, 0, 0, 0]),            # 너무 작음
        ((600, 10, 100, 100), [0, 0, 0, 1]),          # S004: 다른 반 → 명단 밖이라 무시
    ])
    files = {
        "matched": make_jpeg(teacher / "IMG_0001.jpg", RED, "2026:09:28 16:10:00", gps=True),
        "no_exif": make_jpeg(teacher / "카톡사진.jpg", GREEN),
        "no_session": make_jpeg(teacher / "IMG_0002.jpg", BLUE, "2026:09:28 12:00:00"),
        "ambiguous": make_jpeg(teacher / "sub" / "IMG_0003.jpg", GRAY, "2026:09:28 16:55:00"),
    }
    make_jpeg(cfg.drive_root / "모르는선생님" / "IMG_9.jpg", RED, "2026:09:28 16:10:00")
    recent = make_jpeg(teacher / "IMG_recent.jpg", WHITE, "2026:09:28 16:10:00")
    os.utime(recent, None)
    (teacher / "video.mov").write_bytes(b"not a photo")
    register_all(cfg)
    return engine, files


def make_worker(cfg, engine, lines=None):
    out = lines.append if lines is not None else (lambda _: None)
    return Worker(cfg, LocalPlatform(cfg), lambda: engine, out)


def test_run_classifies_logs_and_skips_processed(cfg, scenario):
    engine, files = scenario
    hashes = {k: sha256_file(p) for k, p in files.items()}
    lines = []
    report = make_worker(cfg, engine, lines).run()

    assert report.processed == 4
    assert report.skipped_recent == 1
    assert any("모르는선생님" in w for w in report.warnings)
    by_file = {r.file.split("/")[-1]: r for r in report.results}
    assert by_file["IMG_0001.jpg"].session_match == "matched"
    assert by_file["카톡사진.jpg"].session_match == "no_exif"
    assert by_file["IMG_0002.jpg"].session_match == "no_session"
    amb = by_file["IMG_0003.jpg"]
    assert amb.session_match == "ambiguous" and len(amb.candidate_sessions) == 2

    matched = by_file["IMG_0001.jpg"]
    statuses = [(d.status, d.student_id) for d in matched.decisions]
    assert statuses == [("confirmed", "S001"), ("needs_review", None), ("ignored", None)]
    assert matched.too_small == 1
    review = matched.decisions[1]
    assert {sid for sid, _ in review.candidates} == {"S002", "S003"}
    # 명단 밖 학생(S004)은 비교 대상에도 없다
    assert all(sid != "S004" for d in matched.decisions for sid, _ in d.top_scores)
    meta = matched.upload_metadata(1200, 900)
    assert [f["status"] for f in meta["faces"]] == ["confirmed", "needs_review"]
    assert "top_scores" not in json.dumps(meta)

    # 원본은 그대로
    assert {k: sha256_file(p) for k, p in files.items()} == hashes

    rows = read_recognition_log(cfg.records_dir)
    assert {r["file"].split("/")[-1] for r in rows} == {"IMG_0001.jpg", "카톡사진.jpg", "IMG_0002.jpg", "IMG_0003.jpg"}
    assert all(r["uploaded"] == "false" for r in rows)

    summaries = list(cfg.records_dir.glob("요약_*.json"))
    assert len(summaries) == 1
    summary = json.loads(summaries[0].read_text(encoding="utf-8"))
    assert summary["photos_processed"] == 4
    assert summary["session"] == {"matched": 1, "no_session": 1, "no_exif": 1, "ambiguous": 1}
    assert summary["faces"]["confirmed"] == 1 and summary["faces"]["needs_review"] == 1
    assert summary["auto_confirm_rate"] == 0.5
    assert "S001" not in summaries[0].read_text(encoding="utf-8")

    review_files = {p.parent.name for p in cfg.review_dir.rglob("*.jpg")}
    assert review_files == {"수업판별불가", "촬영시간없음", "수업후보여러개", "얼굴확인필요"}

    again = make_worker(cfg, engine).run()
    assert again.processed == 0


def test_dry_run_writes_nothing(cfg, scenario):
    engine, _ = scenario
    lines = []
    report = make_worker(cfg, engine, lines).run(dry_run=True)
    assert report.processed == 4
    assert any("확정: S001(김하준)" in line for line in lines)
    assert not (cfg.records_dir / "인식기록.csv").exists()
    assert not list(cfg.records_dir.glob("요약_*.json"))
    assert not list(cfg.review_dir.rglob("*.jpg"))
    assert make_worker(cfg, engine).run(dry_run=True).processed == 4


def test_lock_prevents_concurrent_runs(cfg, scenario):
    engine, _ = scenario
    with run_lock(cfg.lock_file):
        with pytest.raises(AlreadyRunning):
            make_worker(cfg, engine).run()


def test_errors_are_retried_up_to_max_attempts(cfg, scenario):
    engine, _ = scenario
    broken = cfg.drive_root / "김선생님" / "broken.jpg"
    broken.write_bytes(b"not really a jpeg")
    old = time.time() - 3600
    os.utime(broken, (old, old))
    for _ in range(cfg.run.max_attempts):
        report = make_worker(cfg, engine).run()
        assert any("broken.jpg" in e["file"] for e in report.errors)
    assert not make_worker(cfg, engine).run().errors


def test_register_only_consented_students(cfg):
    engine = FakeEngine()
    colors = {"S001": (200, 0, 0), "S009": (0, 200, 0)}
    for sid, color in colors.items():
        for i in range(3):
            make_jpeg(cfg.reference_dir / sid / f"{i}.jpg", color)
    engine.add(colors["S001"], [((10, 10, 200, 200), VEC["S001"])])
    engine.add(colors["S009"], [((10, 10, 200, 200), VEC["S002"])])
    make_jpeg(cfg.reference_dir / "S002" / "group.jpg", (0, 0, 200))
    engine.add((0, 0, 200), [((10, 10, 200, 200), VEC["S002"]), ((300, 10, 200, 200), VEC["S003"])])

    summary = make_worker(cfg, engine).register()
    assert summary["registered"] == [{"student_id": "S001", "references": 3}]
    assert "S009" in summary["skipped"] and "S002" in summary["skipped"]
    assert any("S002/group.jpg" in w for w in summary["warnings"])
    store = FaceStore(cfg.faces_db)
    assert store.registered_ids() == {"S001"}
    store.close()


def test_remove_and_sync_consent(cfg, home):
    register_all(cfg)
    for sid in VEC:
        make_jpeg(cfg.reference_dir / sid / "ref1.jpg", (1, 2, 3))
    worker = make_worker(cfg, FakeEngine())

    worker.remove("S004", reason="퇴원")
    store = FaceStore(cfg.faces_db)
    assert "S004" not in store.registered_ids()
    store.close()
    assert not (cfg.reference_dir / "S004").exists()

    consents = home / "시간표" / "동의명단.csv"
    consents.write_text(consents.read_text(encoding="utf-8").replace(
        "S003,true,2026-09-01,", "S003,false,2026-09-30,2026-09-30"), encoding="utf-8")
    worker = make_worker(cfg, FakeEngine())
    assert [r["student_id"] for r in worker.sync_consent(dry_run=True)] == ["S003"]
    assert (cfg.reference_dir / "S003").exists()
    worker.sync_consent()
    assert not (cfg.reference_dir / "S003").exists()
    store = FaceStore(cfg.faces_db)
    assert store.registered_ids() == {"S001", "S002"}
    store.close()
    log = (cfg.records_dir / "삭제기록.csv").read_text(encoding="utf-8-sig")
    assert "S004,퇴원" in log and "S003,consent_revoked" in log


def test_sync_consent_guards_against_mass_deletion(cfg, home):
    store = FaceStore(cfg.faces_db)
    for i in range(8):
        store.replace_student(f"X{i}", [("r.jpg", "h", unit([1, 0, 0, 0]))])
    store.close()
    worker = make_worker(cfg, FakeEngine())
    with pytest.raises(RuntimeError, match="--force"):
        worker.sync_consent()
    assert len(worker.sync_consent(force=True)) == 8


def test_remove_rejects_path_traversal(cfg):
    with pytest.raises(ValueError):
        make_worker(cfg, FakeEngine()).remove("../기록")
