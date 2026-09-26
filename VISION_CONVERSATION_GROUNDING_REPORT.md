# VISION CONVERSATION GROUNDING REPORT

## 결론

그림 분석과 대화를 `image → structured VisualContext → conversation` 경로로 연결했다.

실제 Claude Vision으로 돼지, 토끼, 자동차, 우주선, 추상 괴물 그림을 테스트한 결과:

- 5개 그림이 서로 다른 image hash와 Visual Context를 생성
- 각 첫 응답이 실제 시각 특징을 최소 하나 이상 직접 언급
- 그림별 질문이 코·꼬리·수염·바퀴·창문·날개·비대칭 눈 등에서 출발
- 추상 그림은 단일 label을 강제하지 않고 두 가능성과 uncertainties를 유지
- 후속 Claude 대화도 Visual Context의 `꼬불꼬불한 꼬리`를 실제 응답에 연결

## 1. 실제 Vision 분석 경로

| 경로 | 실제 image input | 분석 방식 | 표시 |
|---|---:|---|---|
| Mock | NO | hardcoded 관찰 + hash 계산 | `analysisSource: mock`, `visionProvider: mock:hardcoded-observations` |
| OpenAI | YES | Responses API의 `input_image` | `analysisSource: vision`, 실제 model 기록 |
| Claude | YES | Messages API의 base64 image content | `analysisSource: vision`, 실제 model 기록 |

질문 focus 추론과 intent 분류는 대화 제어 heuristic이며 object recognition을 수행하지 않는다. 실제 테스트는 `anthropic:claude-sonnet-4-6`으로 수행했다.

앱은 저장된 provider 선택을 우선하고, 저장값이 없으면 `VITE_AI_PROVIDER=openai|anthropic` 설정을 사용한다. Mock을 선택하면 실제 Vision이 아니며 개발 debug에서 명확히 구분된다.

## 2. Visual Context 구조

`analyzeDrawing(image)` 결과:

```json
{
  "likelySubjects": [
    { "label": "돼지", "confidence": 0.93 }
  ],
  "visualFeatures": [
    "얼굴 중앙의 동그란 코에 두 개의 콧구멍",
    "오른쪽에 살짝 말린 짧은 꼬리",
    "네 개의 짧고 굵은 다리"
  ],
  "expressions": [
    "정면을 바라보는 차분하고 순한 인상"
  ],
  "objects": [
    { "label": "꼬리", "confidence": 0.88 }
  ],
  "scene": "크림색 배경 위에 분홍빛 선으로 그려진 동물 한 마리가 화면 중앙에 서 있다.",
  "uncertainties": [
    "꼬리가 완전히 돌돌 말린 형태인지 짧게 휜 형태인지 다소 불분명하다."
  ],
  "imageHash": "sha256:a9a5a52388f42e11",
  "visionProvider": "anthropic:claude-sonnet-4-6",
  "analysisSource": "vision"
}
```

기존 `observations`도 confidence가 있는 상세 관찰 기록으로 유지하되, 대화 grounding에는 명시적인 `visualFeatures`, `expressions`, subject/object confidence를 사용한다.

## 3. Vision → 대화 구조

```text
analyzeDrawing(image)
  → VisualContext
  → respondToChild({
      drawingAnalysis: VisualContext,
      conversationHistory,
      memory,
      inputUnderstanding
    })
```

- `respondToChild` request schema가 Visual Context 전체를 요구
- Coach prompt에 Visual Context 전체가 포함됨
- SOCIAL/META_FEEDBACK 외 응답은 visual feature 또는 expression을 최소 하나 연결하도록 지시
- 응답에서 관찰 특징을 찾지 못하면 한 번 재생성
- 재생성 후에도 grounding이 없으면 실제 `visualFeatures[0]`을 connection에 연결

실제 후속 대화 검증:

```text
아이: 친구를 만나러 가
Claude: 친구를 만나러 가는 중이구나!
        꼬불꼬불한 꼬리가 살랑살랑 흔들릴 것 같아.
Claude 질문: 어떤 친구를 만나러 가는 거야?
```

`visualFeatureGrounded: true`를 확인했다.

## 4. 질문 생성과 focus taxonomy

focus taxonomy는 질문 문장을 고르는 template 목록으로 사용하지 않는다.

- 질문 생성 입력: 현재 Visual Context + 최근 대화 + Creative Memory + 아이 입력
- focus 용도: 생성된 질문을 사후 분류하고 최근 3개 반복을 차단
- 최근 focus와 겹치면 한 번 재생성
- 계속 겹치면 질문을 생략

즉 `identity/color/place/emotion` 순서로 질문을 돌리는 로직은 없다.

## 5. 새 그림 재분석

- 서버는 image data URL의 SHA-256 기반 version을 생성
- 서로 다른 그림은 서로 다른 `imageHash`를 가짐
- `Conversation`은 drawing data URL을 React key로 사용
- 그림이 바뀌면 component, Visual Context, 대화 상태가 새로 생성됨
- 이전 요청은 effect cleanup으로 무효화되어 늦은 응답이 새 그림에 적용되지 않음

Mock 회귀 테스트에서도 서로 다른 두 image data URL이 서로 다른 hash를 만드는 것을 확인했다.

## 6. 실제 5개 그림 결과

브라우저에서 단순한 아이 선화 형태를 PNG로 렌더링하고 실제 Claude Vision API에 전달했다.

### A. 돼지

- Hash: `sha256:a9a5a52388f42e11`
- Subject: `돼지` / `0.93`
- 특징: 큰 동그란 코, 콧구멍 두 개, 말린 꼬리, 짧은 다리 네 개
- 첫 응답:

> 코가 정말 크고 동그랗게 그려졌네요! 콧구멍 두 개도 또렷하게 찍혀 있어서 눈에 확 들어와요. 오른쪽 엉덩이 쪽에 살짝 말린 꼬리도 보이는데, 이 친구 지금 어디에 서 있는 걸까요?

**PASS** — 큰 코, 말린 꼬리, 돼지 추정.

### B. 토끼

- Hash: `sha256:e71984053283070c`
- Subject: `토끼` / `0.95`
- 특징: 긴 귀, 양쪽 수염, 둥근 얼굴, 작은 꼬리
- 첫 응답:

> 수염이 양쪽으로 세 가닥씩 시원하게 뻗어 있는 토끼네요! 몸도 엄청 통통하고 둥글어서 꽉 찬 느낌이 들어요. 옆에 달린 작은 동그란 꼬리도 귀엽게 콕 붙어 있는데, 이 토끼 지금 어디쯤 있는 걸까요?

**PASS** — 긴 귀와 수염 구조화, 토끼 추정, 실제 특징 기반 질문.

### C. 자동차

- Hash: `sha256:4e91cbdfcbb4d163`
- Subject: `자동차` / `0.97`
- 특징: 바퀴 두 개, 허브캡, 직사각형 차체, 앞뒤 창문
- 첫 응답:

> 바퀴 한가운데에 동그란 허브캡이 콕 박혀 있는 게 눈에 확 들어오네요! 파란 선으로 반듯하게 그려진 차인데, 창문도 앞뒤로 나란히 나뉘어 있고 트렁크 쪽이 살짝 툭 튀어나온 것도 보여요. 이 차, 지금 어디로 달려가는 중일까요?

**PASS** — 바퀴·차체·창문 언급, 이동 관련 질문.

### D. 우주선

- Hash: `sha256:e58f4bf670a03541`
- Subject: `로켓` / `0.97`
- 특징: 원형 창문, 양쪽 날개, 분사구, 별
- 첫 응답:

> 로켓이 양쪽 날개를 쫙 펼치고 위로 솟아오르는 것 같아! 가운데 동그란 창문이 두 겹으로 그려진 게 특히 눈에 띄는데, 저 창문 안에는 누가 타고 있을까?

**PASS** — 창문·날개·별 구조화, 우주 장면과 연결.

### E. 추상적인 괴물

- Hash: `sha256:eb2ab47671177113`
- Subject 후보:
  - `얼굴이 있는 사과` / `0.72`
  - `몬스터 캐릭터` / `0.55`
- 특징: 울퉁불퉁한 외곽선, 크기가 다른 분홍/보라 눈, 물결 입, 주황색 돌출 선
- uncertainties: 돌출 선이 가시/다리/털인지, 전체가 사과/몬스터/혼합 캐릭터인지 불명확
- 첫 응답:

> 분홍 눈이랑 보라 눈 크기가 서로 달라서 왠지 살짝 당황한 것 같은 표정이 재밌어요! 몸통 주변에 주황색 선이 여러 방향으로 삐져나와 있는데, 이게 가시인지 다리인지 궁금하다 — 이 친구, 어떻게 움직이는 걸까요?

**PASS** — 억지 단일 label 없음, 관찰 특징 우선, 불확실성 유지.

## 7. 첫 응답 차이와 grounding

| 그림 | 첫 관찰 출발점 | 질문 연결 |
|---|---|---|
| 돼지 | 큰 코·콧구멍·말린 꼬리 | 어디에 서 있는지 |
| 토끼 | 수염·둥근 몸·작은 꼬리 | 어디에 있는지 |
| 자동차 | 바퀴 허브캡·창문·차체 | 어디로 달리는지 |
| 우주선 | 날개·원형 창문 | 누가 타고 있는지 |
| 추상 괴물 | 크기가 다른 눈·돌출 선 | 어떻게 움직이는지 |

모든 첫 응답이 다르고, 각 응답에 해당 그림의 visual feature가 최소 하나 이상 포함됐다.

## 8. 개발 Debug

`import.meta.env.DEV`일 때만 대화 패널에서 확인 가능:

- image version/hash
- vision provider/model
- analysis source (`mock` 또는 `vision`)
- detected subjects와 confidence
- visual features
- conversation response source/model

production build에는 해당 debug panel이 렌더링되지 않는다.

## 9. 검증 결과

```text
TEST_API_BASE=http://127.0.0.1:43130/api npm run test:vision-grounding
5/5 actual Claude Vision calls succeeded

TEST_VISION_IDS=pig npm run test:vision-grounding
refined pig regression succeeded

npm run test:ai
15 passed / 0 failed

npm run typecheck:server
PASS

npm run build
PASS

npm run lint
PASS
```
