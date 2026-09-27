from __future__ import annotations

import hashlib
import sqlite3
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

from .imaging import KST


@dataclass(frozen=True)
class ModelFile:
    name: str
    url: str
    sha256: str
    license: str


DETECTOR = ModelFile(
    name="face_detection_yunet_2023mar.onnx",
    url="https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
    sha256="8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    license="MIT",
)
RECOGNIZER = ModelFile(
    name="face_recognition_sface_2021dec.onnx",
    url="https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
    sha256="0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    license="Apache-2.0",
)
MODELS = (DETECTOR, RECOGNIZER)
MODEL_TAG = "yunet-2023mar+sface-2021dec"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def download_models(models_dir: Path) -> list[Path]:
    """모델 파일을 받는 유일한 외부 통신. 해시가 맞지 않으면 저장하지 않는다."""
    models_dir.mkdir(parents=True, exist_ok=True)
    saved = []
    for model in MODELS:
        target = models_dir / model.name
        if target.exists() and _sha256(target) == model.sha256:
            saved.append(target)
            continue
        with urllib.request.urlopen(model.url, timeout=120) as response:
            data = response.read()
        digest = hashlib.sha256(data).hexdigest()
        if digest != model.sha256:
            raise RuntimeError(f"{model.name} 해시 불일치 ({digest}). 다운로드를 중단합니다.")
        tmp = target.with_suffix(".part")
        tmp.write_bytes(data)
        tmp.replace(target)
        saved.append(target)
    return saved


def verify_models(models_dir: Path) -> None:
    for model in MODELS:
        path = models_dir / model.name
        if not path.exists():
            raise FileNotFoundError(
                f"모델 파일 {path} 가 없습니다. `gts-photo-worker download-models`를 먼저 실행하세요."
            )
        if _sha256(path) != model.sha256:
            raise RuntimeError(f"모델 파일 {path} 해시가 다릅니다. 다시 내려받으세요.")


@dataclass
class DetectedFace:
    bbox: tuple[int, int, int, int]
    score: float
    raw: np.ndarray


class FaceEngine:
    """YuNet(검출) + SFace(특징값). SFace는 onnxruntime으로 돌려 Apple Silicon에서 CoreML을 쓴다."""

    def __init__(self, models_dir: Path, det_score_threshold: float, use_coreml: bool = True):
        verify_models(models_dir)
        if hasattr(cv2, "utils") and hasattr(cv2.utils, "logging"):
            cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_ERROR)
        self._detector = cv2.FaceDetectorYN.create(
            str(models_dir / DETECTOR.name), "", (320, 320), det_score_threshold, 0.3, 5000
        )
        recognizer_path = str(models_dir / RECOGNIZER.name)
        # alignCrop(랜드마크 기준 112x112 정렬)에만 사용
        self._aligner = cv2.FaceRecognizerSF.create(recognizer_path, "")
        self._session = None
        self.provider = "opencv-cpu"
        try:
            import onnxruntime as ort

            options = ort.SessionOptions()
            options.log_severity_level = 3
            available = ort.get_available_providers()
            providers = ["CPUExecutionProvider"]
            if use_coreml and "CoreMLExecutionProvider" in available:
                providers.insert(0, "CoreMLExecutionProvider")
            self._session = ort.InferenceSession(recognizer_path, options, providers=providers)
            self._input_name = self._session.get_inputs()[0].name
            self.provider = self._session.get_providers()[0]
        except ImportError:
            pass

    def detect(self, bgr: np.ndarray) -> list[DetectedFace]:
        height, width = bgr.shape[:2]
        self._detector.setInputSize((width, height))
        _, faces = self._detector.detect(bgr)
        if faces is None:
            return []
        result = []
        for row in faces:
            x, y, w, h = (int(round(v)) for v in row[:4])
            x0, y0 = max(0, x), max(0, y)
            x1, y1 = min(width, x + w), min(height, y + h)
            result.append(DetectedFace((x0, y0, x1 - x0, y1 - y0), float(row[14]), row))
        result.sort(key=lambda f: (f.bbox[0], f.bbox[1]))
        return result

    def embed(self, bgr: np.ndarray, face: DetectedFace) -> np.ndarray:
        aligned = self._aligner.alignCrop(bgr, face.raw)
        if self._session is not None:
            blob = cv2.dnn.blobFromImage(aligned, 1.0, (112, 112), (0, 0, 0), True, False)
            vector = self._session.run(None, {self._input_name: blob})[0][0]
        else:
            vector = self._aligner.feature(aligned)[0]
        vector = np.asarray(vector, dtype=np.float32)
        return vector / (np.linalg.norm(vector) + 1e-12)


class FaceStore:
    """faces.db: 동의한 학생의 기준사진 특징값만 저장. 맥미니 밖으로 내보내지 않는다."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._conn = sqlite3.connect(path)
        self._conn.execute("PRAGMA secure_delete = ON")
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS students (
                student_id TEXT PRIMARY KEY,
                registered_at TEXT NOT NULL,
                reference_count INTEGER NOT NULL,
                model TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS embeddings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
                reference_file TEXT NOT NULL,
                reference_sha256 TEXT NOT NULL,
                vector BLOB NOT NULL
            );
            CREATE INDEX IF NOT EXISTS embeddings_student ON embeddings(student_id);
            """
        )
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    def replace_student(
        self, student_id: str, references: list[tuple[str, str, np.ndarray]]
    ) -> None:
        now = datetime.now(KST).isoformat(timespec="seconds")
        with self._conn:
            self._conn.execute("DELETE FROM embeddings WHERE student_id = ?", (student_id,))
            self._conn.execute(
                "INSERT OR REPLACE INTO students VALUES (?, ?, ?, ?)",
                (student_id, now, len(references), MODEL_TAG),
            )
            self._conn.executemany(
                "INSERT INTO embeddings (student_id, reference_file, reference_sha256, vector)"
                " VALUES (?, ?, ?, ?)",
                [
                    (student_id, name, digest, np.asarray(vec, dtype=np.float32).tobytes())
                    for name, digest, vec in references
                ],
            )

    def remove_student(self, student_id: str) -> bool:
        with self._conn:
            self._conn.execute("DELETE FROM embeddings WHERE student_id = ?", (student_id,))
            cursor = self._conn.execute("DELETE FROM students WHERE student_id = ?", (student_id,))
        return cursor.rowcount > 0

    def vacuum(self) -> None:
        self._conn.execute("VACUUM")

    def registered_ids(self) -> set[str]:
        return {row[0] for row in self._conn.execute("SELECT student_id FROM students")}

    def gallery(self, student_ids: set[str] | list[str]) -> dict[str, np.ndarray]:
        wanted = set(student_ids)
        grouped: dict[str, list[np.ndarray]] = {}
        for student_id, blob in self._conn.execute("SELECT student_id, vector FROM embeddings"):
            if student_id in wanted:
                grouped.setdefault(student_id, []).append(np.frombuffer(blob, dtype=np.float32))
        return {sid: np.vstack(vectors) for sid, vectors in grouped.items()}
