from datetime import datetime

from gts_photo_worker.imaging import KST
from gts_photo_worker.platform import LocalPlatform


def test_weekday_timetable_and_window(cfg):
    platform = LocalPlatform(cfg)
    assert platform.resolve_teacher("김선생님") == "T001"
    assert platform.resolve_teacher("모르는폴더") is None
    sessions = platform.find_sessions("T001", datetime(2026, 9, 28, 16, 20, tzinfo=KST))
    assert [s.session_id for s in sessions] == ["EC-KA-2026-09-28-1600"]
    # 화요일에는 수업 없음
    assert platform.find_sessions("T001", datetime(2026, 9, 29, 16, 20, tzinfo=KST)) == []
    # 16:50 종료 + 30분, 17:00 시작 - 15분 → 두 수업 모두 후보
    both = platform.find_sessions("T001", datetime(2026, 9, 28, 16, 55, tzinfo=KST))
    assert len(both) == 2


def test_roster_is_attendance_and_consent_filtered(cfg, home):
    platform = LocalPlatform(cfg)
    session = platform.find_sessions("T001", datetime(2026, 9, 28, 16, 20, tzinfo=KST))[0]
    ids = {s.student_id for s in platform.roster(session)}
    assert ids == {"S001", "S002", "S003"}  # S009 미동의 제외


def test_dated_attendance_overrides_regular_roster(cfg, home):
    path = home / "시간표" / "출석명단.csv"
    path.write_text(path.read_text(encoding="utf-8")
                    + "EC-KA,S001,김하준,2026-09-28,true\nEC-KA,S002,이서윤,2026-09-28,false\n",
                    encoding="utf-8")
    platform = LocalPlatform(cfg)
    session = platform.find_sessions("T001", datetime(2026, 9, 28, 16, 20, tzinfo=KST))[0]
    assert {s.student_id for s in platform.roster(session)} == {"S001"}
