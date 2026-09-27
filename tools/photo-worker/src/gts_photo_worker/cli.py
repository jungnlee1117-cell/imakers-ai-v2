from __future__ import annotations

import argparse
import json
import sys
from importlib import resources
from pathlib import Path

from .config import Config, load_config, resolve_home
from .state import AlreadyRunning

EXIT_OK = 0
EXIT_FATAL = 1
EXIT_PARTIAL = 3


def _engine_factory(cfg: Config):
    def build():
        from .faces import FaceEngine

        engine = FaceEngine(cfg.models_dir, cfg.face.det_score_threshold, cfg.face.use_coreml)
        print(f"[info] 얼굴 특징값 실행 장치: {engine.provider}", file=sys.stderr)
        return engine

    return build


def _worker(cfg: Config):
    from .pipeline import Worker
    from .platform import make_platform

    return Worker(cfg, make_platform(cfg), _engine_factory(cfg))


def cmd_init(home: Path, _args) -> int:
    for sub in ("기준사진", "기록", "확인필요", "모델", "시간표"):
        (home / sub).mkdir(parents=True, exist_ok=True)
    package = resources.files("gts_photo_worker")
    config_path = home / "config.yaml"
    if not config_path.exists():
        config_path.write_text(package.joinpath("config.example.yaml").read_text(encoding="utf-8"),
                               encoding="utf-8")
        print(f"[init] {config_path} 생성")
    for name in ("선생님.csv", "시간표.csv", "출석명단.csv", "동의명단.csv", "정답.csv"):
        target = home / "시간표" / name
        if not target.exists():
            target.write_text(package.joinpath("templates", name).read_text(encoding="utf-8"),
                              encoding="utf-8-sig")
            print(f"[init] {target} 예시 파일 생성")
    print(f"[init] 완료. {config_path}의 drive_root를 수정한 뒤 download-models → register 순서로 진행하세요.")
    return EXIT_OK


def cmd_download_models(home: Path, _args) -> int:
    from .faces import MODELS, download_models

    cfg = load_config(home)
    for path in download_models(cfg.models_dir):
        print(f"[models] {path}")
    for model in MODELS:
        print(f"[models] {model.name}: {model.license}")
    return EXIT_OK


def cmd_register(home: Path, args) -> int:
    summary = _worker(load_config(home)).register(dry_run=args.dry_run, only=args.student)
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    return EXIT_OK


def cmd_run(home: Path, args) -> int:
    cfg = load_config(home)
    try:
        report = _worker(cfg).run(dry_run=args.dry_run, limit=args.limit)
    except AlreadyRunning:
        print("[run] 이전 실행이 아직 진행 중이라 이번 실행은 건너뜁니다.")
        return EXIT_OK
    data = report.to_dict()
    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        print(f"[run] 처리 {data['processed']}장, 확인필요 {data['needs_review']}장, "
              f"대기(동기화 중) {data['skipped_recent']}장, 오류 {len(data['errors'])}건"
              f"{' (dry-run: 업로드·기록 없음)' if args.dry_run else ''}")
    return EXIT_PARTIAL if report.errors else EXIT_OK


def cmd_remove(home: Path, args) -> int:
    _worker(load_config(home)).remove(args.student_id, reason=args.reason, dry_run=args.dry_run)
    return EXIT_OK


def cmd_sync_consent(home: Path, args) -> int:
    removed = _worker(load_config(home)).sync_consent(dry_run=args.dry_run, force=args.force)
    if args.json:
        print(json.dumps(removed, ensure_ascii=False, indent=2))
    return EXIT_OK


def cmd_evaluate(home: Path, args) -> int:
    from .evaluate import evaluate_sessions, latest_rows_by_file, load_ground_truth, recommend, sweep
    from .records import read_recognition_log

    cfg = load_config(home)
    truth = load_ground_truth(Path(args.truth).expanduser())
    by_file = latest_rows_by_file(read_recognition_log(cfg.records_dir))
    session_stats = evaluate_sessions(truth, by_file)
    fc = cfg.face
    rows = sweep(truth, by_file, fc.mid_threshold, fc.min_margin, fc.max_candidates)
    best = recommend(rows, args.target_precision)
    if args.json:
        print(json.dumps({"session": session_stats, "faces": rows, "recommended": best},
                         ensure_ascii=False, indent=2))
        return EXIT_OK

    s = session_stats
    print("== 수업 판별 ==")
    print(f"평가 사진 {s['total']}장 (기록에 없는 정답 {s['missing_in_log']}장)")
    print(f"  자동 확정·정답 {s['auto_correct']} | 자동 확정·오답 {s['auto_wrong']} | "
          f"확인필요로 보냄 {s['to_review']} | 수업 외 사진 올바르게 제외 {s['correct_reject']}")
    print(f"  정확도 {s['accuracy']}")
    for file in s["wrong_files"]:
        print(f"  ! 잘못 확정: {file}")
    print(f"\n== 얼굴 판정 (중간 기준 {fc.mid_threshold}, 차이 기준 {fc.min_margin}) ==")
    print("확정기준  정밀도   재현율   오확정  놓침  확인필요얼굴")
    for r in rows:
        mark = " ←현재" if abs(r["high_threshold"] - fc.high_threshold) < 1e-6 else ""
        print(f"  {r['high_threshold']:.2f}   {r['precision'] if r['precision'] is not None else '-':>6}  "
              f"{r['recall'] if r['recall'] is not None else '-':>6}  {r['false_positive']:>5}  "
              f"{r['missed']:>4}  {r['review_faces']:>6}{mark}")
    if best:
        print(f"\n정밀도 {args.target_precision} 이상인 가장 낮은 확정 기준값: {best['high_threshold']:.2f}")
    else:
        print(f"\n정밀도 {args.target_precision}을 만족하는 확정 기준값이 없습니다.")
    return EXIT_OK


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="gts-photo-worker", description="GTS 수업 사진 분류 워커")
    parser.add_argument("--home", help="작업 폴더 (기본 ~/GTS업무/도구/사진분류, 환경변수 GTS_PHOTO_WORKER_HOME)")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init", help="작업 폴더·config.yaml·예시 CSV 만들기")
    sub.add_parser("download-models", help="얼굴 모델 내려받기 (유일한 외부 다운로드)")

    p = sub.add_parser("register", help="동의 학생의 기준사진으로 특징값 생성")
    p.add_argument("--student", help="이 학생만 다시 등록")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("run", help="새 사진 처리")
    p.add_argument("--dry-run", action="store_true", help="업로드·기록·처리표시 없이 판정 결과만 출력")
    p.add_argument("--limit", type=int, help="이번 실행에서 처리할 최대 사진 수")
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("remove", help="학생 특징값·기준사진 삭제")
    p.add_argument("student_id")
    p.add_argument("--reason", default="manual", help="삭제 사유 (예: 퇴원, 동의철회)")
    p.add_argument("--dry-run", action="store_true")

    p = sub.add_parser("sync-consent", help="동의 철회된 학생 데이터 자동 삭제")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--force", action="store_true", help="대량 삭제 안전장치 해제")
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("evaluate", help="정답 CSV로 수업 판별·얼굴 판정 정확도 측정")
    p.add_argument("truth", help="정답 CSV 경로")
    p.add_argument("--target-precision", type=float, default=0.99)
    p.add_argument("--json", action="store_true")
    return parser


COMMANDS = {
    "init": cmd_init,
    "download-models": cmd_download_models,
    "register": cmd_register,
    "run": cmd_run,
    "remove": cmd_remove,
    "sync-consent": cmd_sync_consent,
    "evaluate": cmd_evaluate,
}


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    home = resolve_home(args.home)
    try:
        return COMMANDS[args.command](home, args)
    except (FileNotFoundError, ValueError, RuntimeError) as err:
        print(f"[error] {err}", file=sys.stderr)
        return EXIT_FATAL


if __name__ == "__main__":
    sys.exit(main())
