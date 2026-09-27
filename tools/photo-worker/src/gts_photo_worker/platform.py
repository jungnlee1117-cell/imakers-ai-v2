"""플랫폼 연결. Phase 1은 LocalPlatform(CSV), Phase 2부터 DeviceApiPlatform(device API)."""

from __future__ import annotations

import csv
import json
import os
import shutil
import subprocess
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time
from pathlib import Path
from typing import Protocol

from .config import Config
from .imaging import KST
from .matching import Session, sessions_in_window

TOKEN_ENV = "GTS_DEVICE_TOKEN"

_WEEKDAYS = {
    "월": 0, "화": 1, "수": 2, "목": 3, "금": 4, "토": 5, "일": 6,
    "mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6,
}
_TRUE = {"true", "1", "y", "yes", "o", "동의", "t"}


@dataclass(frozen=True)
class Consent:
    student_id: str
    face_consent: bool
    updated_at: str = ""
    revoked_at: str = ""


@dataclass(frozen=True)
class RosterStudent:
    student_id: str
    name: str = ""


class Platform(Protocol):
    uploads_enabled: bool

    def resolve_teacher(self, folder_name: str) -> str | None: ...

    def find_sessions(self, teacher: str, taken_at: datetime) -> list[Session]: ...

    def roster(self, session: Session) -> list[RosterStudent]: ...

    def consents(self) -> list[Consent]: ...

    def upload_photo(self, jpeg: bytes, metadata: dict) -> dict: ...


def _read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        raise FileNotFoundError(f"{path} 가 없습니다.")
    with path.open(encoding="utf-8-sig", newline="") as fh:
        return [
            {(k or "").strip(): (v or "").strip() for k, v in row.items()}
            for row in csv.DictReader(fh)
        ]


def _parse_time(value: str) -> time:
    return datetime.strptime(value, "%H:%M").time()


class LocalPlatform:
    """Phase 1: 플랫폼 대신 로컬 CSV로 수업 판별·명단·동의 상태를 제공. 업로드하지 않는다."""

    uploads_enabled = False

    def __init__(self, cfg: Config):
        data = cfg.local_data
        self._before = cfg.session_window.before_minutes
        self._after = cfg.session_window.after_minutes
        self._teachers = {
            row["drive_folder_name"]: row["teacher_id"]
            for row in _read_csv(cfg.local_path(data.teachers_csv))
            if row.get("drive_folder_name") and row.get("teacher_id")
        }
        self._timetable = _read_csv(cfg.local_path(data.timetable_csv))
        self._roster_rows = _read_csv(cfg.local_path(data.roster_csv))
        self._consent_rows = _read_csv(cfg.local_path(data.consents_csv))

    def resolve_teacher(self, folder_name: str) -> str | None:
        return self._teachers.get(folder_name)

    def sessions_on(self, teacher: str, day: date) -> list[Session]:
        sessions = []
        for row in self._timetable:
            if row.get("teacher_id") != teacher:
                continue
            if row.get("date"):
                if date.fromisoformat(row["date"]) != day:
                    continue
            elif row.get("weekday"):
                key = row["weekday"].lower()
                weekday = _WEEKDAYS.get(key[:3], _WEEKDAYS.get(key[:1]))
                if weekday != day.weekday():
                    continue
            else:
                continue
            start = datetime.combine(day, _parse_time(row["start_time"]), KST)
            end = datetime.combine(day, _parse_time(row["end_time"]), KST)
            session_id = row.get("session_id") or f"{row['class_id']}-{day.isoformat()}-{start:%H%M}"
            sessions.append(
                Session(
                    session_id=session_id,
                    teacher_id=teacher,
                    center_id=row.get("center_id", ""),
                    center_name=row.get("center_name", ""),
                    class_id=row["class_id"],
                    class_name=row.get("class_name", ""),
                    class_date=day.isoformat(),
                    start=start,
                    end=end,
                )
            )
        return sessions

    def find_sessions(self, teacher: str, taken_at: datetime) -> list[Session]:
        taken_at = taken_at.astimezone(KST)
        return sessions_in_window(
            self.sessions_on(teacher, taken_at.date()), taken_at, self._before, self._after
        )

    def roster(self, session: Session) -> list[RosterStudent]:
        rows = [r for r in self._roster_rows if r.get("class_id") == session.class_id]
        dated = [r for r in rows if r.get("date") == session.class_date]
        chosen = dated if dated else [r for r in rows if not r.get("date")]
        consented = {c.student_id for c in self.consents() if c.face_consent}
        seen: dict[str, RosterStudent] = {}
        for row in chosen:
            sid = row.get("student_id", "")
            if sid and sid in consented and row.get("attended", "true").lower() in _TRUE:
                seen[sid] = RosterStudent(sid, row.get("student_name", ""))
        return list(seen.values())

    def consents(self) -> list[Consent]:
        result = []
        for row in self._consent_rows:
            if not row.get("student_id"):
                continue
            result.append(
                Consent(
                    student_id=row["student_id"],
                    face_consent=row.get("face_consent", "").lower() in _TRUE,
                    updated_at=row.get("updated_at", ""),
                    revoked_at=row.get("revoked_at", ""),
                )
            )
        return result

    def upload_photo(self, jpeg: bytes, metadata: dict) -> dict:
        raise RuntimeError("local 모드에서는 업로드하지 않습니다.")


def read_device_token(cfg: Config) -> str:
    """토큰은 macOS 키체인에서 읽는다. 키체인이 없는 개발 환경에서만 환경변수를 쓴다."""
    if shutil.which("security"):
        result = subprocess.run(
            [
                "security", "find-generic-password",
                "-s", cfg.platform.keychain_service,
                "-a", cfg.platform.keychain_account,
                "-w",
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    token = os.environ.get(TOKEN_ENV, "").strip()
    if token:
        return token
    raise RuntimeError(
        "장치 토큰을 찾을 수 없습니다. README의 '장치 토큰 저장' 절차로 키체인에 저장하세요."
    )


class ApiError(RuntimeError):
    def __init__(self, status: int, body: str):
        super().__init__(f"플랫폼 API 오류 {status}: {body[:300]}")
        self.status = status


def _session_from_api(item: dict) -> Session:
    return Session(
        session_id=str(item["session_id"]),
        teacher_id=str(item.get("teacher_id", "")),
        center_id=str(item.get("center_id", "")),
        center_name=item.get("center_name", ""),
        class_id=str(item["class_id"]),
        class_name=item.get("class_name", ""),
        class_date=item["class_date"],
        start=datetime.fromisoformat(item["start"]).astimezone(KST),
        end=datetime.fromisoformat(item["end"]).astimezone(KST),
    )


class DeviceApiPlatform:
    """Phase 2: gts-platform device API. 이 워커가 부르는 외부 주소는 base_url 하나뿐이다."""

    uploads_enabled = True

    def __init__(self, cfg: Config, token: str | None = None):
        self._base = cfg.platform.base_url.rstrip("/")
        self._timeout = cfg.platform.timeout_seconds
        self._before = cfg.session_window.before_minutes
        self._after = cfg.session_window.after_minutes
        self._token = token or read_device_token(cfg)

    def _request(self, method: str, path: str, params: dict | None = None,
                 body: bytes | None = None, content_type: str | None = None) -> dict:
        url = f"{self._base}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        headers = {"Authorization": f"Bearer {self._token}", "Accept": "application/json"}
        if content_type:
            headers["Content-Type"] = content_type
        request = urllib.request.Request(url, data=body, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                payload = response.read().decode("utf-8")
        except urllib.error.HTTPError as err:
            raise ApiError(err.code, err.read().decode("utf-8", "replace")) from None
        return json.loads(payload) if payload else {}

    def resolve_teacher(self, folder_name: str) -> str | None:
        # 플랫폼이 teachers.drive_folder_name으로 선생님을 찾는다.
        return folder_name

    def find_sessions(self, teacher: str, taken_at: datetime) -> list[Session]:
        data = self._request("GET", "/api/device/session", {
            "teacher": teacher,
            "taken_at": taken_at.astimezone(KST).isoformat(),
            "before_minutes": self._before,
            "after_minutes": self._after,
        })
        return [_session_from_api(item) for item in data.get("sessions", [])]

    def roster(self, session: Session) -> list[RosterStudent]:
        data = self._request("GET", "/api/device/roster", {"session_id": session.session_id})
        return [RosterStudent(str(s["student_id"]), s.get("name", "")) for s in data.get("students", [])]

    def consents(self) -> list[Consent]:
        data = self._request("GET", "/api/device/consents")
        return [
            Consent(
                student_id=str(s["student_id"]),
                face_consent=bool(s.get("face_consent")),
                updated_at=s.get("updated_at") or "",
                revoked_at=s.get("revoked_at") or "",
            )
            for s in data.get("students", [])
        ]

    def upload_photo(self, jpeg: bytes, metadata: dict) -> dict:
        boundary = uuid.uuid4().hex
        parts = [
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"metadata\"\r\n"
            f"Content-Type: application/json\r\n\r\n".encode(),
            json.dumps(metadata, ensure_ascii=False).encode("utf-8"),
            f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
            f"filename=\"{metadata['file_hash']}.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n".encode(),
            jpeg,
            f"\r\n--{boundary}--\r\n".encode(),
        ]
        try:
            return self._request(
                "POST", "/api/device/photos", body=b"".join(parts),
                content_type=f"multipart/form-data; boundary={boundary}",
            )
        except ApiError as err:
            if err.status == 409:
                return {"duplicate": True}
            raise


def make_platform(cfg: Config) -> Platform:
    if cfg.platform.mode == "api":
        return DeviceApiPlatform(cfg)
    return LocalPlatform(cfg)
