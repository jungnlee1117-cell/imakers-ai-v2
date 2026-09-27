from __future__ import annotations

import json
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Protocol

import numpy as np

from . import __version__
from .config import Config
from .faces import MODEL_TAG, DetectedFace, FaceStore
from .imaging import is_photo, load_bgr, prepare_photo, sha256_file
from .matching import (
    FACE_CONFIRMED,
    FACE_IGNORED,
    FACE_NEEDS_REVIEW,
    SESSION_MATCHED,
    FaceDecision,
    Session,
    classify_face,
    decide_session,
    resolve_duplicates,
    score_face,
)
from .platform import Platform, RosterStudent
from .records import (
    DailySummary,
    append_deletion_log,
    append_recognition_log,
    now_kst,
    write_review_copy,
)
from .state import ProcessedState, run_lock

Printer = Callable[[str], None]


class Engine(Protocol):
    def detect(self, bgr: np.ndarray) -> list[DetectedFace]: ...

    def embed(self, bgr: np.ndarray, face: DetectedFace) -> np.ndarray: ...


@dataclass
class PhotoResult:
    file: str
    file_hash: str
    teacher_folder: str
    teacher_id: str
    taken_at: str | None
    session_match: str
    session: Session | None
    candidate_sessions: list[Session]
    decisions: list[FaceDecision]
    too_small: int
    uploaded: bool = False

    @property
    def needs_review(self) -> bool:
        return self.session_match != SESSION_MATCHED or any(
            d.status == FACE_NEEDS_REVIEW for d in self.decisions
        )

    def face_counts(self) -> dict[str, int]:
        counts = {"detected": len(self.decisions) + self.too_small, "too_small": self.too_small,
                  "confirmed": 0, "needs_review": 0, "ignored": 0}
        for d in self.decisions:
            counts[d.status] += 1
        return counts

    def upload_metadata(self, width: int, height: int) -> dict:
        s = self.session
        return {
            "file_hash": self.file_hash,
            "original_filename": Path(self.file).name,
            "teacher_folder": self.teacher_folder,
            "teacher_id": self.teacher_id,
            "taken_at": self.taken_at,
            "session_match": self.session_match,
            "session_id": s.session_id if s else None,
            "center_id": s.center_id if s else None,
            "class_id": s.class_id if s else None,
            "class_date": s.class_date if s else None,
            "candidate_sessions": [c.to_dict() for c in self.candidate_sessions],
            "width": width,
            "height": height,
            # 무시한 얼굴(명단 밖·유사도 낮음)은 보내지 않는다.
            "faces": [d.to_upload() for d in self.decisions if d.status != FACE_IGNORED],
            "worker_version": __version__,
            "model": MODEL_TAG,
        }

    def log_rows(self, run_mode: str, error: str = "") -> list[dict]:
        s = self.session
        base = {
            "processed_at": now_kst().isoformat(timespec="seconds"),
            "run_mode": run_mode,
            "file": self.file,
            "file_hash": self.file_hash,
            "teacher_folder": self.teacher_folder,
            "teacher_id": self.teacher_id,
            "taken_at": self.taken_at or "",
            "session_match": self.session_match,
            "session_id": s.session_id if s else "",
            "center_id": s.center_id if s else "",
            "class_id": s.class_id if s else "",
            "class_date": s.class_date if s else "",
            "candidate_sessions": ";".join(c.session_id for c in self.candidate_sessions),
            "uploaded": str(self.uploaded).lower(),
            "error": error,
        }
        if not self.decisions:
            return [base]
        rows = []
        for d in self.decisions:
            rows.append({
                **base,
                "face_index": d.face_index,
                "det_score": round(d.det_score, 4),
                "bbox": json.dumps(list(d.bbox)),
                "face_status": d.status,
                "student_id": d.student_id or "",
                "similarity": "" if d.similarity is None else round(d.similarity, 4),
                "candidates": json.dumps([[sid, round(sim, 4)] for sid, sim in d.candidates]),
                "top_scores": json.dumps([[sid, round(sim, 4)] for sid, sim in d.top_scores]),
            })
        return rows


@dataclass
class RunReport:
    dry_run: bool
    processed: int = 0
    skipped_recent: int = 0
    errors: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    results: list[PhotoResult] = field(default_factory=list)

    def to_dict(self) -> dict:
        counts: dict[str, int] = {}
        for r in self.results:
            counts[r.session_match] = counts.get(r.session_match, 0) + 1
        return {
            "dry_run": self.dry_run,
            "processed": self.processed,
            "needs_review": sum(1 for r in self.results if r.needs_review),
            "session": counts,
            "skipped_recent": self.skipped_recent,
            "errors": self.errors,
            "warnings": self.warnings,
        }


def _names(roster: list[RosterStudent]) -> dict[str, str]:
    return {s.student_id: s.name for s in roster}


def _label(student_id: str, names: dict[str, str]) -> str:
    name = names.get(student_id)
    return f"{student_id}({name})" if name else student_id


def describe(result: PhotoResult, names: dict[str, str]) -> str:
    head = f"[{result.session_match}] {result.file}"
    when = result.taken_at[:16].replace("T", " ") if result.taken_at else "촬영시간 없음"
    if result.session_match != SESSION_MATCHED:
        extra = ""
        if result.candidate_sessions:
            extra = " 후보: " + ", ".join(
                f"{c.center_name} {c.class_name}({c.session_id})".strip() for c in result.candidate_sessions
            )
        return f"{head} {when} → 확인필요{extra}"
    s = result.session
    parts = [f"{head} {when} → {s.center_name} {s.class_name}({s.session_id})".rstrip()]
    confirmed = [d for d in result.decisions if d.status == FACE_CONFIRMED]
    review = [d for d in result.decisions if d.status == FACE_NEEDS_REVIEW]
    ignored = sum(1 for d in result.decisions if d.status == FACE_IGNORED) + result.too_small
    if confirmed:
        parts.append("확정: " + ", ".join(
            f"{_label(d.student_id, names)} {d.similarity:.2f}" for d in confirmed))
    for d in review:
        parts.append(f"확인필요(얼굴{d.face_index}): " + ", ".join(
            f"{_label(sid, names)} {sim:.2f}" for sid, sim in d.candidates))
    if ignored:
        parts.append(f"무시 {ignored}")
    if not result.decisions and not result.too_small:
        parts.append("얼굴 없음")
    return " | ".join(parts)


class Worker:
    def __init__(self, cfg: Config, platform: Platform, engine_factory: Callable[[], Engine],
                 printer: Printer = print):
        self.cfg = cfg
        self.platform = platform
        self._engine_factory = engine_factory
        self._engine: Engine | None = None
        self.out = printer

    @property
    def engine(self) -> Engine:
        if self._engine is None:
            self._engine = self._engine_factory()
        return self._engine

    # ---------- run ----------

    def run(self, dry_run: bool = False, limit: int | None = None) -> RunReport:
        cfg = self.cfg
        report = RunReport(dry_run=dry_run)
        if not cfg.drive_root.is_dir():
            raise FileNotFoundError(f"drive_root 폴더가 없습니다: {cfg.drive_root}")

        with run_lock(cfg.lock_file):
            state = ProcessedState(cfg.state_db)
            store = FaceStore(cfg.faces_db)
            try:
                registered = store.registered_ids()
                consented = {c.student_id for c in self.platform.consents() if c.face_consent}
                summary = DailySummary(cfg.records_dir, now_kst().date().isoformat())
                rosters: dict[str, list[RosterStudent]] = {}
                seen: set[str] = set()
                now = time.time()

                for teacher_dir in sorted(p for p in cfg.drive_root.iterdir() if p.is_dir()):
                    if teacher_dir.name.startswith("."):
                        continue
                    teacher = self.platform.resolve_teacher(teacher_dir.name)
                    if teacher is None:
                        report.warnings.append(f"선생님 매핑 없음, 폴더 건너뜀: {teacher_dir.name}")
                        continue
                    for path in sorted(teacher_dir.rglob("*")):
                        if limit is not None and report.processed >= limit:
                            break
                        if not path.is_file() or not is_photo(path):
                            continue
                        if now - path.stat().st_mtime < cfg.run.min_file_age_seconds:
                            report.skipped_recent += 1
                            continue
                        rel = str(path.relative_to(cfg.drive_root))
                        try:
                            digest = state.file_hash(path)
                        except OSError as err:
                            report.errors.append({"file": rel, "error": str(err)})
                            continue
                        if digest in seen or not state.should_process(digest, cfg.run.max_attempts):
                            continue
                        seen.add(digest)
                        try:
                            result, prepared = self._process(
                                path, rel, digest, teacher_dir.name, teacher,
                                registered, consented, rosters, store,
                            )
                            if not dry_run and self.platform.uploads_enabled:
                                self.platform.upload_photo(
                                    prepared.jpeg, result.upload_metadata(prepared.width, prepared.height)
                                )
                                result.uploaded = True
                        except Exception as err:  # 한 장 실패로 전체 실행을 멈추지 않는다
                            message = f"{type(err).__name__}: {err}"
                            report.errors.append({"file": rel, "error": message})
                            self.out(f"[error] {rel} {message}")
                            if not dry_run:
                                state.mark_error(digest, path, message)
                                summary.add_error(rel, message)
                            continue

                        report.processed += 1
                        report.results.append(result)
                        names = _names(rosters.get(result.session.session_id, [])) if result.session else {}
                        self.out(describe(result, names))
                        if dry_run:
                            continue
                        append_recognition_log(cfg.records_dir, result.log_rows(cfg.platform.mode))
                        summary.add_photo(
                            result.session_match,
                            result.session.to_dict() if result.session else None,
                            result.face_counts(), result.needs_review, result.uploaded,
                        )
                        if cfg.run.copy_review_images and result.needs_review:
                            reason = result.session_match if result.session_match != SESSION_MATCHED \
                                else FACE_NEEDS_REVIEW
                            write_review_copy(cfg.review_dir, summary.data["date"], reason,
                                              teacher_dir.name, path, digest, prepared.jpeg)
                        state.mark_done(digest, path)

                for warning in report.warnings:
                    self.out(f"[warn] {warning}")
                if not dry_run:
                    for warning in report.warnings:
                        summary.add_error("", warning)
                    summary.save()
            finally:
                state.close()
                store.close()
        return report

    def _process(self, path: Path, rel: str, digest: str, teacher_folder: str, teacher: str,
                 registered: set[str], consented: set[str],
                 rosters: dict[str, list[RosterStudent]], store: FaceStore):
        cfg = self.cfg
        prepared = prepare_photo(path, cfg.image.max_long_side, cfg.image.jpeg_quality)
        candidates = (
            self.platform.find_sessions(teacher, prepared.taken_at) if prepared.taken_at else []
        )
        session_result = decide_session(prepared.taken_at, candidates)
        session = session_result.session
        decisions: list[FaceDecision] = []
        too_small = 0

        if session_result.match == SESSION_MATCHED:
            if session.session_id not in rosters:
                rosters[session.session_id] = self.platform.roster(session)
            # 출석 + 동의 + 로컬 등록, 세 조건을 모두 만족하는 학생과만 비교한다.
            allowed = {s.student_id for s in rosters[session.session_id]} & consented & registered
            gallery = store.gallery(allowed)
            fc = cfg.face
            for face in self.engine.detect(prepared.bgr):
                if min(face.bbox[2], face.bbox[3]) < fc.min_face_px:
                    too_small += 1
                    continue
                scores = score_face(self.engine.embed(prepared.bgr, face), gallery)
                status, student_id, similarity, cands = classify_face(
                    scores, fc.high_threshold, fc.mid_threshold, fc.min_margin, fc.max_candidates
                )
                decisions.append(FaceDecision(
                    face_index=len(decisions) + too_small,
                    bbox=face.bbox,
                    det_score=face.score,
                    status=status,
                    student_id=student_id,
                    similarity=similarity,
                    candidates=cands,
                    top_scores=scores[:5],
                ))
            resolve_duplicates(decisions, fc.max_candidates, fc.mid_threshold)

        result = PhotoResult(
            file=rel,
            file_hash=digest,
            teacher_folder=teacher_folder,
            teacher_id=session.teacher_id if session and session.teacher_id else teacher,
            taken_at=prepared.taken_at.isoformat() if prepared.taken_at else None,
            session_match=session_result.match,
            session=session,
            candidate_sessions=session_result.candidates,
            decisions=decisions,
            too_small=too_small,
        )
        return result, prepared

    # ---------- register ----------

    def register(self, dry_run: bool = False, only: str | None = None) -> dict:
        cfg = self.cfg
        consents = {c.student_id: c for c in self.platform.consents()}
        consented = {sid for sid, c in consents.items() if c.face_consent}
        summary = {"registered": [], "skipped": [], "warnings": []}
        if not cfg.reference_dir.is_dir():
            raise FileNotFoundError(f"기준사진 폴더가 없습니다: {cfg.reference_dir}")

        store = FaceStore(cfg.faces_db)
        try:
            for folder in sorted(p for p in cfg.reference_dir.iterdir() if p.is_dir()):
                sid = folder.name
                if sid.startswith(".") or (only and sid != only):
                    continue
                if sid not in consented:
                    # 미동의 학생은 사진을 열지도 않는다(특징값 생성 금지).
                    summary["skipped"].append(sid)
                    summary["warnings"].append(f"{sid}: 얼굴 인식 동의 명단에 없어 건너뜀")
                    continue
                references = []
                for image_path in sorted(p for p in folder.iterdir() if p.is_file() and is_photo(p)):
                    bgr = load_bgr(image_path, cfg.image.max_long_side)
                    faces = [f for f in self.engine.detect(bgr)
                             if min(f.bbox[2], f.bbox[3]) >= cfg.face.min_face_px]
                    if len(faces) != 1:
                        summary["warnings"].append(
                            f"{sid}/{image_path.name}: 얼굴이 {len(faces)}개 검출되어 제외 (1명만 나온 사진 필요)")
                        continue
                    references.append((image_path.name, sha256_file(image_path),
                                       self.engine.embed(bgr, faces[0])))
                if not references:
                    summary["skipped"].append(sid)
                    summary["warnings"].append(f"{sid}: 사용할 수 있는 기준사진이 없음")
                    continue
                if len(references) < 3:
                    summary["warnings"].append(f"{sid}: 기준사진 {len(references)}장 (3~5장 권장)")
                if not dry_run:
                    store.replace_student(sid, references)
                summary["registered"].append({"student_id": sid, "references": len(references)})

            stale = sorted(store.registered_ids() - consented)
            if stale:
                summary["warnings"].append(
                    "동의 명단에 없는 등록 학생이 있습니다. `sync-consent`를 실행하세요: " + ", ".join(stale))
        finally:
            store.close()

        for item in summary["registered"]:
            self.out(f"[register{' dry-run' if dry_run else ''}] {item['student_id']} 기준사진 {item['references']}장")
        for warning in summary["warnings"]:
            self.out(f"[warn] {warning}")
        return summary

    # ---------- remove / sync-consent ----------

    def remove(self, student_id: str, reason: str = "manual", dry_run: bool = False) -> dict:
        cfg = self.cfg
        ref_dir = cfg.reference_dir / student_id
        if ref_dir.resolve().parent != cfg.reference_dir.resolve():
            raise ValueError(f"잘못된 학생 ID: {student_id}")
        store = FaceStore(cfg.faces_db)
        try:
            registered = student_id in store.registered_ids()
            has_dir = ref_dir.is_dir()
            if not dry_run:
                store.remove_student(student_id)
                if has_dir:
                    shutil.rmtree(ref_dir)
                store.vacuum()
                if registered or has_dir:
                    append_deletion_log(cfg.records_dir, {
                        "deleted_at": now_kst().isoformat(timespec="seconds"),
                        "student_id": student_id,
                        "reason": reason,
                        "embeddings_removed": str(registered).lower(),
                        "reference_dir_removed": str(has_dir).lower(),
                    })
        finally:
            store.close()
        result = {"student_id": student_id, "embeddings": registered, "reference_dir": has_dir}
        if registered or has_dir:
            self.out(f"[remove{' dry-run' if dry_run else ''}] {student_id} 특징값={registered} "
                     f"기준사진={has_dir} 사유={reason}")
        else:
            self.out(f"[remove] {student_id}: 삭제할 데이터가 없습니다")
        return result

    def sync_consent(self, dry_run: bool = False, force: bool = False) -> list[dict]:
        cfg = self.cfg
        consents = {c.student_id: c for c in self.platform.consents()}
        if not consents:
            raise RuntimeError("동의 명단이 비어 있습니다. 전체 삭제를 막기 위해 중단합니다.")
        store = FaceStore(cfg.faces_db)
        try:
            registered = store.registered_ids()
        finally:
            store.close()

        targets: dict[str, str] = {}
        for sid in registered:
            consent = consents.get(sid)
            if consent is None:
                targets[sid] = "not_in_consent_list"
            elif not consent.face_consent:
                targets[sid] = "consent_revoked"
        if cfg.reference_dir.is_dir():
            for folder in cfg.reference_dir.iterdir():
                consent = consents.get(folder.name)
                if folder.is_dir() and consent and not consent.face_consent and consent.revoked_at:
                    targets.setdefault(folder.name, "consent_revoked")

        if registered and not force and len(targets) > 3 and len(targets) > len(registered) / 2:
            raise RuntimeError(
                f"등록 학생 {len(registered)}명 중 {len(targets)}명이 삭제 대상입니다. "
                "동의 명단이 맞다면 --force로 다시 실행하세요.")

        removed = [self.remove(sid, reason, dry_run) for sid, reason in sorted(targets.items())]
        if not removed:
            self.out("[sync-consent] 삭제 대상 없음")
        return removed
