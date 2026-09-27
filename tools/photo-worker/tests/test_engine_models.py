"""실제 모델로 도는 확인. 모델 폴더와 얼굴이 있는 사진을 환경변수로 지정했을 때만 실행한다.

    GTS_TEST_MODELS_DIR=~/GTS업무/도구/사진분류/모델 GTS_TEST_FACE_IMAGE=/path/face.jpg pytest
"""

import os
from pathlib import Path

import cv2
import numpy as np
import pytest

from gts_photo_worker.faces import RECOGNIZER, FaceEngine
from gts_photo_worker.imaging import load_bgr

MODELS = os.environ.get("GTS_TEST_MODELS_DIR")
IMAGE = os.environ.get("GTS_TEST_FACE_IMAGE")

pytestmark = pytest.mark.skipif(not (MODELS and IMAGE), reason="실제 모델/사진이 지정되지 않음")


def test_onnxruntime_features_match_opencv_reference():
    engine = FaceEngine(Path(MODELS).expanduser(), 0.8, use_coreml=True)
    bgr = load_bgr(Path(IMAGE).expanduser(), 2048)
    faces = engine.detect(bgr)
    assert faces, "사진에서 얼굴을 찾지 못했습니다"

    ours = engine.embed(bgr, faces[0])
    reference = cv2.FaceRecognizerSF.create(str(Path(MODELS).expanduser() / RECOGNIZER.name), "")
    expected = reference.feature(reference.alignCrop(bgr, faces[0].raw))[0]
    expected = expected / np.linalg.norm(expected)
    assert float(ours @ expected) > 0.999

    smaller = cv2.resize(bgr, None, fx=0.6, fy=0.6)
    again = engine.detect(smaller)
    best = max(float(engine.embed(smaller, f) @ ours) for f in again)
    assert best > 0.5
