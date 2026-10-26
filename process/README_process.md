# 처리 부분 (소리 → 카드 JSON)

## 구성
- `process.py` : 3개 명령 (features, merge, run)
- `card_schema.json` : 카드 JSON 약속 (앱과 같은 파일)
- `meta_b.json` : 수업 정보 입력 예시
- 예시 결과: `prompt_b.md`, `transcript_lines_b.json`, `card_b_auto.json`

## 흐름
1. `features` : 전사 파일 → 전사 줄(아이 이름 가림, 믿기 어려운 줄 표시) + 코드로 센 것(칭찬 표현, 규칙 질문) + AI에게 줄 `prompt.md`
2. (AI 분석) `prompt.md` 를 AI에 주면 JSON 하나가 돌아온다 → `analysis.json`
3. `merge` : features + analysis → `card.json` (스키마 검증 통과해야 저장)
4. `run` : 소리 파일 하나로 1~3 을 이어서 실행 (전사 → API 호출 → 합치기)

```
python3 -I process.py features --transcript out/t3.txt --meta meta_b.json --out work_b
python3 -I process.py merge --work work_b --analysis analysis_b.json --out card.json
```

## 시험한 것 / 못 한 것
- 시험함: 수업 B 전사로 `features` 와 `merge` 를 끝까지 실행, 스키마 검증 통과. 일부러 틀린 카드는 검증에서 막히는 것도 확인.
- 시험함: "평가에서 뺄 줄" 5개(오인식 의심 4개 + 수업과 무관한 문구 1개)를 코드가 모두 찾아냄.
- 시험함: 아이 이름 가리기. 수업 B에서 들린 아이 이름 12개 중 10개가 가려졌고 2개(Sheer, John)는 남음. 완벽하지 않으므로 `merge` 단계에서 AI 결과를 한 번 더 가리지만, 전사 줄 저장 단계의 가리기는 AI 기반으로 보강하는 것이 좋음.
- 시험함 (2026-10-25): 수업 B 음성(1527초)으로 `run` 을 끝까지 실행. 전사(sherpa-onnx Whisper small) 약 2분, 전체 213초, claude-sonnet-5-5 1회 호출(입력 7,872 / 출력 12,068 토큰), 스키마 검증 통과. 출력이 8000을 넘어 `max_tokens` 를 64000으로 올리고 스트리밍으로 받는다. "AI 가 손으로 만든 카드와 같은 품질인가"는 아직 비교하지 않음.
- 못 해 봄: 계획안 비교(계획안 텍스트 없음), 수업 A·C.

## 코드가 센 값과 손으로 센 값의 차이 (수업 B)
- 칭찬 표현: 코드 4회 vs 손 8회. 코드는 "Good job, Well done, Excellent" 처럼 분명한 표현만 센다. 같은 규칙으로 센 값끼리만 비교해야 한다.
- 규칙 질문: 코드 6회 vs 손 1회. 정의가 다르다(코드: "Can you ...?" 질문 수, 손: 규칙 소개 장면 수). 카드의 지표 이름을 "규칙을 질문으로 물은 횟수"로 바꿨다.
