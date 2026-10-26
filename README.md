# 수업 코칭

선생님이 수업 녹음을 올리면, 처리 서버가 소리를 골라 카드 데이터 JSON 한 장을 만들고, 화면은 그 JSON만 읽습니다. 아이메이커스 그림 스튜디오는 이 앱으로 바뀌었습니다.

## 실행

```bash
cp .env.example .env
docker compose up -d
npm install
npm run migrate
npm run dev -- --host 0.0.0.0
```

브라우저 주소는 `http://127.0.0.1:43127` 입니다. API는 `43128`이고 Vite가 `/api`를 넘깁니다.

```bash
npm test
npm run typecheck
```

보관 기간이 지난 녹음을 바로 지울 때는 `npm run retention` 입니다. API 프로세스가 매일 한 번, 그리고 켜질 때도 같은 작업을 합니다.

## 파일 한도

25분 수업 영상은 수백 MB가 될 수 있습니다. 업로드 한도는 **1GiB** (`1073741824`바이트)이고, 데이터베이스 `uploads.byte_size` 검사와 같습니다. 기본 청크는 **5MiB**라서 연결이 끊기면 이어서 올립니다. 청크를 64KiB보다 작게 두지 마세요. 너무 작으면 1GiB 파일이 청크 개수 한도(4096)를 넘습니다.

녹음 파일은 `DATA_DIR`(기본 `data/`)에 있습니다. 재생 주소는 5분짜리 HMAC 서명 URL만 발급하고, 범위 요청으로 시각 이동을 받습니다.

## 처리 경계

입력은 소리 파일, 종목, 언어 모드(`english` | `korean` | `mixed`), 있으면 선생님이 이 앱에 올린 계획안 텍스트입니다. 출력은 카드 스키마를 만족하는 JSON 하나입니다. 전사 줄은 `start_sec`, `text`, `trusted`만 따로 저장합니다. 화면은 저장된 카드 JSON만 그리고, 처리 도중의 내부 필드를 직접 읽지 않습니다.

카드 약속은 `process/card_schema.json` 입니다. `contracts/card_schema.json` 은 같은 파일이어야 합니다. `process/process.py` 의 `features`, `merge`, `run` 이 처리 구현이고, `server/card/process-steps.ts` 가 그 세 명령을 그대로 호출합니다.

처리기는 `.env` 의 `PROCESSOR_ID` 로 고릅니다. 기본값은 `local-band` 입니다. 스키마를 통과한 `process/card_example_B_v1_1.json` 을 고정 출력으로 돌려줍니다. `schema_version` 이 1.1 이면 화면은 `area_reviews` 로 영역별 카드를 그립니다. 수업 날짜·반·종목·언어·영상/음성 여부와, 이 앱에 올린 계획안 텍스트만 입력에 맞춥니다. 올린 소리는 읽지 않고, 밖으로 보내지 않습니다. 다른 처리기 이름을 넣으면 연결하지 않고 거절합니다.

`process-run` 은 `server/card/run.ts` 가 `process.py run` 을 실제로 호출합니다. 전사는 이 컴퓨터에서 `scripts/transcribe_sherpa.py`(sherpa-onnx Whisper small int8 + Silero VAD)가 하고, 아이 이름을 가린 전사 텍스트만 Anthropic API로 보냅니다. 소리는 밖으로 보내지 않습니다. 키는 `.env` 의 `ANTHROPIC_API_KEY` 에서 읽고 화면이나 로그에 찍지 않습니다. 키가 없거나 전사·API·스키마 검증 중 하나라도 실패하면 업로드는 `failed` 로 남고 사유가 기록됩니다. 작업 폴더(전사 원문)는 끝나면 지웁니다. 25분 음성의 전사는 M 시리즈 맥북에서 약 2분입니다.

`process-run` 준비:

```bash
brew install ffmpeg python@3.12
python3.12 -m venv .venv
.venv/bin/pip install -r scripts/requirements-run.txt
mkdir -p models && cd models
curl -LO https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.tar.bz2
tar xjf sherpa-onnx-whisper-small.tar.bz2 && rm sherpa-onnx-whisper-small.tar.bz2
curl -LO https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx
```

`process.py` 는 `.venv/bin/python` 이 있으면 그것으로, 없으면 `python3` 으로 돌립니다(`PROCESS_PYTHON` 으로 바꿀 수 있음). `features` 와 `merge` 만 돌릴 때는 `process/requirements.txt` 로 충분합니다.

영상은 `ffmpeg -y -i 입력 -vn -ac 1 -ar 16000 출력.m4a`로 소리를 뽑은 뒤 원본을 지웁니다. 음성 파일은 그대로 둡니다. 같은 업로드는 `queued`를 원자적으로 `processing`으로 바꾼 뒤에만 처리합니다.

## 권한

Postgres 행 보안입니다. 앱 역할 `class_coach_app`은 슈퍼유저가 아니고 행 보안을 우회하지 않습니다. 선생님은 본인 행만, 관리자는 담당 선생님 행만, 대표는 같은 소속만 읽습니다. 다른 소속은 보이지 않습니다. 가입은 이메일뿐입니다. GTS는 초대 또는 승인만 받고 무료로 표시됩니다. `jungnlee1117@gmail.com` 으로 가입하면 GTS 대표가 되고, 그 계정이 이미 있으면 로그인할 때 소속 역할을 대표로 올립니다. 소속이 없으면 GTS 대표로 연결합니다. 다른 이메일로 새 소속을 만들면 그 소속의 대표이며 유료로 표시됩니다. 결제는 연결하지 않습니다. 대표는 같은 소속의 활성 선생님을 골라 영상이나 음성을 올릴 수 있고, 그 파일은 그 선생님의 수업으로 저장됩니다. 다른 소속에는 올리지 못하고, 관리자는 올리지 못합니다.

동의 문구 초안은 전문가 검토 전이라 가입·업로드 화면에 넣지 않습니다. 첫 업로드 전에 동의가 필요하다는 확인과 `consents` 기록만 있습니다.

## 아직 없는 것

발음 교정, "아이들은 이래요", 학부모 공개, 인사평가, 결제 연결과 구글·카카오 로그인은 없습니다. 아이 이름은 저장 전에 `[아이]`로 가립니다. 선생님 화면에만 원문을 보여주는 방법은 아직 정하지 않았습니다.
