# GTS 수업 사진 분류 워커 (맥미니)

`docs/daily-note-spec.md` 4장의 맥미니 사진 워커 구현입니다. 선생님 드라이브 폴더의 새 사진을 찾아
**선생님 + 촬영 시간으로 수업을 판별**하고, **그 수업 출석·동의 학생과만 얼굴을 비교**해 아이별로 판정합니다.

- Phase 1(현재): 플랫폼 API 없이 로컬 CSV(시간표·출석·동의)로 판별하고, 결과는 맥미니에만 기록합니다.
- Phase 2: `config.yaml`의 `platform.mode`를 `api`로 바꾸면 gts-platform device API로 판별·업로드합니다.

## 얼굴 인식 모델과 라이선스

| 용도 | 모델 | 라이선스 | 출처 |
|---|---|---|---|
| 얼굴 검출 | YuNet (`face_detection_yunet_2023mar.onnx`) | MIT | [opencv_zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) |
| 얼굴 특징값 | SFace (`face_recognition_sface_2021dec.onnx`) | Apache-2.0 | [opencv_zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface) |

두 모델 모두 상업적 사용이 허용됩니다. InsightFace 계열(buffalo_l 등)은 비상업 전용이라 쓰지 않습니다.
모델 파일은 SHA-256을 코드에 고정해 두었고, 해시가 다르면 실행하지 않습니다.
정식 운영 전에 모델 학습 데이터 관련 조건을 한 번 더 법률 검토하는 것을 권장합니다.

실행 장치: SFace 특징값은 onnxruntime **CoreML**(Apple Silicon Neural Engine/GPU)로 계산하고, CoreML을 쓸 수 없으면 CPU로 계산합니다.
YuNet 검출은 OpenCV로 계산합니다(모델이 작아 CPU로 충분합니다). 실행할 때 `[info] 얼굴 특징값 실행 장치: ...`로 어떤 장치를 썼는지 표시합니다.

## 설치 (맥미니, 최초 1회)

```bash
# 이 폴더(tools/photo-worker)를 맥미니에 복사한 뒤
cd tools/photo-worker
python3 -m venv ~/GTS업무/도구/사진분류/.venv
~/GTS업무/도구/사진분류/.venv/bin/pip install .
alias gpw=~/GTS업무/도구/사진분류/.venv/bin/gts-photo-worker

gpw init              # ~/GTS업무/도구/사진분류/ 에 폴더·config.yaml·예시 CSV 생성
# config.yaml의 drive_root를 실제 동기화 경로로 수정
gpw download-models   # 모델 다운로드 (워커가 인터넷에서 받는 유일한 파일)
```

Python 3.10 이상이 필요합니다. 작업 폴더를 바꾸려면 `--home <경로>` 또는 환경변수 `GTS_PHOTO_WORKER_HOME`을 씁니다.

### Google Drive 설정

1. 맥미니 Google Drive 앱에 대표 계정으로 로그인합니다.
2. `GTS수업사진` 폴더만 **오프라인 사용 가능**으로 설정합니다(다른 문서는 스트리밍 상태로 둡니다).
3. 동기화 경로(보통 `~/Library/CloudStorage/GoogleDrive-<계정>/내 드라이브/GTS수업사진`)를 `config.yaml`의 `drive_root`에 적습니다.

워커는 원본 사진을 **읽기만** 합니다. 이동·수정·삭제하지 않습니다.
동기화 중인 파일을 건드리지 않도록 최근 60초 안에 수정된 파일은 다음 실행으로 미룹니다(`run.min_file_age_seconds`).

## 작업 폴더 구조 (`~/GTS업무/도구/사진분류/`)

```
config.yaml           설정 (토큰은 넣지 않음)
faces.db              동의 학생의 기준사진 특징값 (맥미니 로컬 전용)
기준사진/<학생ID>/     아이별 정면 사진 3~5장 (한 사진에 한 명만)
모델/                  YuNet, SFace
시간표/                Phase 1용 CSV (선생님·시간표·출석명단·동의명단·정답)
기록/인식기록.csv       사진·얼굴별 판정 기록 (학생ID·유사도 포함, 로컬 전용)
기록/요약_YYYY-MM-DD.json  하메스용 일일 요약 (학생 ID·이름 없음, 숫자만)
기록/삭제기록.csv       remove / sync-consent 삭제 기록
기록/처리상태.db        처리한 사진 해시, 재시도 횟수
확인필요/<날짜>/<사유>/  확인이 필요한 사진의 축소·위치정보 제거본
```

`확인필요` 사유 폴더: `수업판별불가`(수업 시간 밖), `촬영시간없음`(카톡 전달·스크린샷 등), `수업후보여러개`(겹치는 수업), `얼굴확인필요`(유사도 중간 얼굴).

## Phase 1 CSV (`시간표/`)

`init`이 예시 파일을 만듭니다. 엑셀에서 편집해 **CSV UTF-8**로 저장하세요.

- `선생님.csv`: `drive_folder_name,teacher_id,teacher_name` — 드라이브 폴더 이름과 선생님 ID 연결. 없는 폴더는 경고 후 건너뜁니다.
- `시간표.csv`: `session_id,teacher_id,center_id,center_name,class_id,class_name,date,weekday,start_time,end_time`
  - 매주 반복 수업은 `weekday`(월~일)를, 특정일 수업은 `date`(YYYY-MM-DD)를 채웁니다.
  - `session_id`를 비우면 `<class_id>-<날짜>-<시작HHMM>`으로 만듭니다(예: `EC-KA-2026-09-28-1600`).
- `출석명단.csv`: `class_id,student_id,student_name,date,attended` — `date`가 빈 행은 정규 반 명단이고,
  그날 날짜 행이 하나라도 있으면 그날은 날짜 행(실제 출석)만 씁니다. `attended=false`는 결석입니다.
- `동의명단.csv`: `student_id,face_consent,updated_at,revoked_at` — `face_consent`가 true인 학생만 등록·판정합니다.

## 명령

| 명령 | 하는 일 |
|---|---|
| `init` | 작업 폴더, `config.yaml`, 예시 CSV 생성 |
| `download-models` | 모델 다운로드·해시 확인 |
| `register [--student ID] [--dry-run]` | 동의 학생의 기준사진으로 특징값 생성. 동의 명단에 없는 폴더는 **사진을 열지 않고** 건너뛰고 경고. 얼굴이 정확히 1개인 사진만 사용 |
| `run [--dry-run] [--limit N] [--json]` | 새 사진 처리. 처리한 사진(파일 해시 기준)은 건너뜀. 오류 난 사진은 최대 3번 재시도 |
| `remove <학생ID> [--reason 사유] [--dry-run]` | 특징값·기준사진 삭제, 삭제 기록 남김 |
| `sync-consent [--dry-run] [--force]` | 동의 철회·명단에서 빠진 학생 자동 삭제. 동의 명단이 비었거나 절반 넘게 삭제되면 중단(`--force`로 해제) |
| `evaluate <정답.csv> [--target-precision 0.99]` | 수업 판별·얼굴 판정 정확도를 따로 계산하고 확정 기준값별 결과 표시 |

`--dry-run`은 업로드·기록·처리 표시를 전혀 하지 않고 판정 결과만 화면에 출력합니다.

### 판정 규칙

- 수업 판별: 촬영 시각(EXIF `DateTimeOriginal`, 오프셋이 있으면 한국 시간으로 변환, 없으면 한국 시간으로 간주)이
  `수업 시작 - 15분 ~ 수업 종료 + 30분`에 드는 그 선생님 수업이 정확히 1개일 때만 확정합니다. 0개·2개 이상·촬영시간 없음은 모두 확인필요입니다.
  파일 수정시각 등으로 촬영시간을 추측하지 않습니다.
- 얼굴 판정: `출석 ∩ 동의 ∩ 로컬 등록` 학생과만 비교합니다(학생별 기준사진 중 최대 코사인 유사도).
  - 1위 ≥ `high_threshold` 이고 2위와 차이 ≥ `min_margin` → 확정
  - 1위 ≥ `mid_threshold` → 확인필요, 후보 최대 3명
  - 그 외, 또는 `min_face_px`보다 작은 얼굴 → 무시. 사진 속 얼굴의 특징값은 **어디에도 저장하지 않습니다.**
  - 한 사진에서 같은 학생이 두 얼굴에 확정되면 유사도가 높은 얼굴만 확정하고 나머지는 확인필요로 돌립니다.

## Phase 1 테스트 절차 (1주일)

1. 동의 받은 학생의 기준사진을 `기준사진/<학생ID>/`에 3~5장 넣고 `register`를 실행합니다. 경고(얼굴 0개·여러 개)가 나온 사진은 교체합니다.
2. `시간표/` CSV를 실제 수업에 맞게 채웁니다.
3. 수업 사진이 쌓이면 `run`을 실행합니다. Phase 1은 local 모드라 업로드가 없고 `기록/`에만 쌓입니다. 화면으로만 보고 싶으면 `run --dry-run`.
4. 처리한 사진 중 일부(반마다 수십 장)에 대해 `시간표/정답.csv`를 작성합니다.
   ```
   file,session_id,student_ids
   김OO선생님/IMG_0001.HEIC,EC-KA-2026-09-28-1600,S001;S002
   김OO선생님/IMG_0002.HEIC,,
   ```
   `file`은 `인식기록.csv`의 `file` 열과 같은 값(드라이브 폴더 기준 경로)입니다. 수업 사진이 아니면 `session_id`를 비우고, `student_ids`에는 얼굴이 보이는 동의 학생만 적습니다.
5. `evaluate 시간표/정답.csv`로 결과를 봅니다.
   - 수업 판별: 자동 확정 정답/오답, 확인필요로 보낸 수. **자동 확정 오답은 0이어야 합니다.** 생기면 `session_window`를 줄입니다.
   - 얼굴 판정: 확정 기준값별 정밀도(잘못 확정하지 않는 비율)·재현율·확인필요 얼굴 수. 목표 정밀도(기본 0.99)를 만족하는 가장 낮은 값을 추천합니다.
6. 확정한 값을 `config.yaml`의 `face.high_threshold`(필요하면 `mid_threshold`, `min_margin`)에 적습니다.
   `인식기록.csv`에 상위 5명 유사도가 남아 있어 기준값을 바꿔도 사진을 다시 돌릴 필요가 없습니다.

초기 기준값(0.50 / 0.36)은 SFace 공개 권장값(0.363) 기반의 출발점입니다. 아이 얼굴·운동 중 사진에서의 정확도는 이 테스트로 확인해야 합니다.

## n8n 실행

Execute Command 노드에서 10분마다(13시~22시) 호출합니다.

```
# Cron: */10 13-21 * * *  (+ 22:00 한 번 더 원하면 0 22 * * *)
/Users/<사용자>/GTS업무/도구/사진분류/.venv/bin/gts-photo-worker run --json
```

- 이전 실행이 끝나지 않았으면 잠금 파일(`기록/.run.lock`) 때문에 바로 끝나고 종료 코드 0을 돌려줍니다.
- 종료 코드: `0` 정상, `3` 일부 사진 오류(실패 알림 대상), `1` 설정·모델·API 등 전체 오류(실패 알림 대상).
- 동의 동기화는 하루 1번 수업 전에 실행합니다: `gts-photo-worker sync-consent` (예: 매일 12:50).

## 장치 토큰 저장 (Phase 2)

토큰은 `config.yaml`이 아니라 macOS 키체인에 저장합니다. 맥미니에 Supabase service role key를 두지 않습니다.

```bash
security add-generic-password -s gts-photo-worker -a device-token -w '<플랫폼에서 발급한 토큰>' -U
```

처음 실행할 때 키체인 접근 허용 창이 뜨면 n8n과 같은 사용자 계정에서 "항상 허용"을 한 번 눌러둡니다.
키체인이 없는 개발 환경에서만 환경변수 `GTS_DEVICE_TOKEN`을 읽습니다.

## 네트워크

- 인터넷 통신은 `download-models`(모델 2개)와 `platform.base_url`(Phase 2, https만 허용) 두 곳뿐입니다. Phase 1 local 모드는 통신하지 않습니다.
- 더 엄격하게 하려면 macOS 방화벽 앱(LuLu 등)에서 워커의 Python이 `base_url` 도메인만 쓰도록 제한합니다.

## Phase 2 device API 계약 (플랫폼 구현 기준)

모든 요청에 `Authorization: Bearer <장치 토큰>`. 시간은 ISO 8601(+09:00).

- `GET /api/device/session?teacher=<드라이브 폴더 이름>&taken_at=<ISO>&before_minutes=15&after_minutes=30`
  → `{"sessions": [{"session_id","teacher_id","center_id","center_name","class_id","class_name","class_date","start","end"}]}`
  (여유폭을 적용해 걸리는 수업 전부. 워커가 0개/1개/여러 개를 판정)
- `GET /api/device/roster?session_id=` → `{"students": [{"student_id","name"}]}` (출석 ∩ 동의 학생만)
- `GET /api/device/consents` → `{"students": [{"student_id","face_consent","updated_at","revoked_at"}]}`
- `POST /api/device/photos` (multipart): `metadata`(JSON) + `file`(JPG, 긴 변 2048px, EXIF·GPS 제거). 같은 `file_hash`가 이미 있으면 409 → 워커는 성공으로 처리.
  ```json
  {
    "file_hash": "sha256", "original_filename": "IMG_0001.HEIC",
    "teacher_folder": "김OO선생님", "teacher_id": "T001", "taken_at": "2026-09-28T16:10:00+09:00",
    "session_match": "matched|no_session|no_exif|ambiguous",
    "session_id": "…", "center_id": "…", "class_id": "…", "class_date": "2026-09-28",
    "candidate_sessions": [ { "session_id": "…", "...": "…" } ],
    "width": 2048, "height": 1536,
    "faces": [
      {"face_index": 0, "bbox": [x, y, w, h], "status": "confirmed", "student_id": "S001", "similarity": 0.62, "candidates": []},
      {"face_index": 1, "bbox": [x, y, w, h], "status": "needs_review", "student_id": null, "similarity": 0.41,
       "candidates": [{"student_id": "S002", "similarity": 0.41}, {"student_id": "S003", "similarity": 0.39}]}
    ],
    "worker_version": "0.1.0", "model": "yunet-2023mar+sface-2021dec"
  }
  ```
  무시한 얼굴(명단 밖·유사도 낮음)은 보내지 않습니다. 수업 판별이 안 된 사진도 검토 화면에 보이도록 업로드합니다.

## 개발·테스트

```bash
pip install -e '.[dev]'
pytest                                    # 모델 없이 도는 단위·통합 테스트
GTS_TEST_MODELS_DIR=~/GTS업무/도구/사진분류/모델 GTS_TEST_FACE_IMAGE=<얼굴 사진> pytest   # 실제 모델 확인 포함
```
