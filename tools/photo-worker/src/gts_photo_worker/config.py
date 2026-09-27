from __future__ import annotations

import os
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Any

import yaml

DEFAULT_HOME = Path("~/GTS업무/도구/사진분류").expanduser()
HOME_ENV = "GTS_PHOTO_WORKER_HOME"


@dataclass
class PlatformConfig:
    mode: str = "local"
    base_url: str = ""
    keychain_service: str = "gts-photo-worker"
    keychain_account: str = "device-token"
    timeout_seconds: float = 30


@dataclass
class LocalDataConfig:
    teachers_csv: str = "시간표/선생님.csv"
    timetable_csv: str = "시간표/시간표.csv"
    roster_csv: str = "시간표/출석명단.csv"
    consents_csv: str = "시간표/동의명단.csv"


@dataclass
class SessionWindowConfig:
    before_minutes: int = 15
    after_minutes: int = 30


@dataclass
class FaceConfig:
    high_threshold: float = 0.50
    mid_threshold: float = 0.36
    min_margin: float = 0.05
    max_candidates: int = 3
    det_score_threshold: float = 0.80
    min_face_px: int = 40
    use_coreml: bool = True


@dataclass
class ImageConfig:
    max_long_side: int = 2048
    jpeg_quality: int = 90


@dataclass
class RunConfig:
    min_file_age_seconds: int = 60
    max_attempts: int = 3
    copy_review_images: bool = True


@dataclass
class Config:
    home: Path
    drive_root: Path
    platform: PlatformConfig = field(default_factory=PlatformConfig)
    local_data: LocalDataConfig = field(default_factory=LocalDataConfig)
    session_window: SessionWindowConfig = field(default_factory=SessionWindowConfig)
    face: FaceConfig = field(default_factory=FaceConfig)
    image: ImageConfig = field(default_factory=ImageConfig)
    run: RunConfig = field(default_factory=RunConfig)

    @property
    def faces_db(self) -> Path:
        return self.home / "faces.db"

    @property
    def state_db(self) -> Path:
        return self.home / "기록" / "처리상태.db"

    @property
    def reference_dir(self) -> Path:
        return self.home / "기준사진"

    @property
    def records_dir(self) -> Path:
        return self.home / "기록"

    @property
    def review_dir(self) -> Path:
        return self.home / "확인필요"

    @property
    def models_dir(self) -> Path:
        return self.home / "모델"

    @property
    def lock_file(self) -> Path:
        return self.home / "기록" / ".run.lock"

    def local_path(self, relative: str) -> Path:
        path = Path(relative).expanduser()
        return path if path.is_absolute() else self.home / path


def _section(cls: type, raw: Any, name: str):
    if raw is None:
        return cls()
    if not isinstance(raw, dict):
        raise ValueError(f"config.yaml의 '{name}' 항목 형식이 잘못되었습니다.")
    known = {f.name for f in fields(cls)}
    unknown = set(raw) - known
    if unknown:
        raise ValueError(f"config.yaml '{name}'에 알 수 없는 항목: {', '.join(sorted(unknown))}")
    return cls(**raw)


def resolve_home(home: str | os.PathLike | None) -> Path:
    if home:
        return Path(home).expanduser()
    if os.environ.get(HOME_ENV):
        return Path(os.environ[HOME_ENV]).expanduser()
    return DEFAULT_HOME


def load_config(home: Path) -> Config:
    config_path = home / "config.yaml"
    if not config_path.exists():
        raise FileNotFoundError(
            f"{config_path} 가 없습니다. 먼저 `gts-photo-worker init`을 실행하세요."
        )
    raw = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    if not raw.get("drive_root"):
        raise ValueError("config.yaml에 drive_root가 필요합니다.")

    cfg = Config(
        home=home,
        drive_root=Path(raw["drive_root"]).expanduser(),
        platform=_section(PlatformConfig, raw.get("platform"), "platform"),
        local_data=_section(LocalDataConfig, raw.get("local_data"), "local_data"),
        session_window=_section(SessionWindowConfig, raw.get("session_window"), "session_window"),
        face=_section(FaceConfig, raw.get("face"), "face"),
        image=_section(ImageConfig, raw.get("image"), "image"),
        run=_section(RunConfig, raw.get("run"), "run"),
    )
    validate(cfg)
    return cfg


def validate(cfg: Config) -> None:
    if cfg.platform.mode not in ("local", "api"):
        raise ValueError("platform.mode는 local 또는 api 이어야 합니다.")
    if cfg.platform.mode == "api" and not cfg.platform.base_url.startswith("https://"):
        raise ValueError("platform.base_url은 https:// 주소여야 합니다.")
    if not 0 < cfg.face.mid_threshold <= cfg.face.high_threshold < 1:
        raise ValueError("face 기준값은 0 < mid_threshold <= high_threshold < 1 이어야 합니다.")
    if cfg.face.max_candidates < 1:
        raise ValueError("face.max_candidates는 1 이상이어야 합니다.")
