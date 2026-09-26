# REAL USER FLOW FIX REPORT

## 범위

이번 수정은 입력 intent 처리와 Motion mock 노출 문제만 다뤘다.

- 새 창작 기능 추가 없음
- 이미지 생성 provider 및 FAL/FLUX 구조 변경 없음
- Claude Coach의 Empathy/Memory prompt 전면 재작성 없음
- 게임·대시보드 추가 없음

## 원인

### 1. 모든 입력을 창작 설정으로 처리

기존 normalizer는 `raw`, `normalized`, `meaning`만 만들고 발화 목적을 구분하지 않았다. Mock과 원격 Coach 모두 이 값을 작품 내용으로 취급할 수 있었고, Mock은 모든 입력을 `understoodInputs`와 `confirmedFacts`에 추가했다.

그 결과:

- 짧은 답이 직전 질문과 분리됨
- 감사·인사가 작품 설정에 들어감
- 앱 피드백이 캐릭터 이름처럼 해석될 수 있음

### 2. 내부 이해 값을 사용자 응답 템플릿으로 사용

Mock provider의 일반 fallback이 `${meaning}이라는 뜻으로 이해했어`를 그대로 출력했다. `normalized`와 `meaning`이라는 내부 데이터가 사용자 문장으로 노출된 직접 원인이다.

### 3. 질문을 만드는 조건이 대화 문맥보다 턴 수를 우선

Mock provider는 초기 2턴에 별도 감정 질문을 추가했고, 시각화 준비 조건을 만족하면 질문이 없어도 동의 질문을 붙였다. 짧은 ANSWER 뒤에도 Claude가 만든 다음 질문을 그대로 노출했다.

### 4. Motion Studio가 mock segmentation을 실제 결과처럼 표시

`MotionStudio`의 객체는 이미지 분석 결과가 아니었다.

- 고정 객체명: `하늘과 구름`, `배경의 특별한 곳`
- 고정 `sourceRegion` 좌표
- 고정 pin 3개
- `MockMotionInterpreter`

토끼 그림과 무관한 객체가 실제 인식 결과처럼 표시된 이유다.

## 수정

### Intent 분류

입력을 응답 생성 전에 다음 다섯 종류로 분류한다.

- `CREATIVE_CONTENT`
- `ANSWER`
- `SOCIAL`
- `META_FEEDBACK`
- `COMMAND`

규칙 우선순위는 META_FEEDBACK → SOCIAL → COMMAND → ANSWER → CREATIVE_CONTENT이다. 직전 AI 질문이 있고 짧게 답한 입력은 ANSWER로 연결한다. `파랑색`, `노랑색`은 내부적으로 각각 `파란색`, `노란색`으로 정규화한다.

### SOCIAL / META_FEEDBACK 경계

SOCIAL과 META_FEEDBACK은 Claude 호출 전에 짧은 규칙 응답으로 처리한다.

- Creative Memory를 변경하지 않음
- `understoodInputs`에도 작품 정보로 추가하지 않음
- 질문을 붙이지 않음
- META_FEEDBACK을 이름 확인 로직에 전달하지 않음

응답 예:

- `고마워` → `나도 같이 만들어서 재밌었어 😊`
- `대화가 자연스럽지 않아` → `맞아, 방금 대화가 조금 어색했네. 같은 말을 반복하지 않고 자연스럽게 이어가볼게.`

### 짧은 ANSWER 처리

- 직전 AI 발화를 normalizer와 Coach context에 전달
- 색 질문에 대한 짧은 답을 질문 문맥에 연결
- ANSWER 응답 뒤의 자동 후속 질문을 최종 응답 경계에서 제거
- `~라는 뜻으로 이해했어`, `~이라고 이해했어`가 생성되면 한 번 재생성
- Mock의 턴 수 기반 감정 질문 제거

`normalized`와 `meaning`은 Creative Memory와 provider prompt context에서만 사용하고 사용자에게 내부 해석 문장으로 읽어주지 않는다.

### Motion 노출 차단

실제 segmentation이 없으므로 출시 상태의 Motion 진입 버튼을 제거했다.

사용자 화면에는 다음 준비 상태만 표시한다.

> 움직임 기능 준비 중  
> 그림 속 친구를 정확히 찾는 기능을 준비하고 있어요.

`하늘과 구름`, `배경의 특별한 곳`, 고정 대상 번호, preset/속도/방향/크기 제어는 실제 사용자 flow에서 노출되지 않는다. 기존 mock 구현은 개발 코드로 남아 있지만 사용자 진입 경로와 UI에서 분리됐다.

## 요청된 실제 사용자 테스트

| 테스트 | 결과 | 확인 내용 |
|---|---|---|
| TEST 1: `어떤 색이면 좋을까?` → `파랑색` | **PASS** | ANSWER, `파란색` 정규화, 직전 질문 연결, 금지 문구 없음 |
| TEST 2: `고마워` | **PASS** | SOCIAL, 자연스러운 응답, 질문 없음, Creative Memory 불변 |
| TEST 3: `대화가 자연스럽지 않아` | **PASS** | META_FEEDBACK, 이름 확인 없음, Creative Memory 불변 |
| TEST 4: `어떤 색으로 할까?` → `노랑색` | **PASS** | ANSWER, `노란색` 문맥 응답, 금지 문구·강제 질문 없음 |
| TEST 5: 토끼 그림 + Motion | **PASS** | 준비 상태만 노출, mock 객체명과 진입 버튼 미노출 |

### 실제 Claude 확인

현재 Claude 모델(`claude-sonnet-5`)로 ANSWER 경로를 실제 호출했다.

입력:

```text
AI: 어떤 색이면 좋을까?
User: 파랑색
```

확인 결과:

- reaction: `파란색 토끼구나! 시원하고 멋진 느낌일 것 같아.`
- connection: `가운데 토끼 모양에 파란색을 입혀볼 수 있겠다!`
- question: 빈 문자열
- 금지된 `뜻으로 이해했어` 표현 없음

SOCIAL과 META_FEEDBACK API 경로도 실제 호출해 `intent-rules` 응답, 빈 질문, Creative Memory 불변을 확인했다.

## 자동 검증 결과

```text
npm run test:ai
11 passed / 0 failed

npm run test:e2e -- e2e/art-motion-flow.spec.ts
1 passed / 0 failed

npm run typecheck:server
PASS

npm run build
PASS

npm run lint
PASS
```

브라우저 e2e는 그림 작성 → 대화 → 시각화까지 진행한 뒤 Motion 준비 상태가 보이고, `내 그림 움직여보기`, `하늘과 구름`, `배경의 특별한 곳`이 없는지 확인한다.
