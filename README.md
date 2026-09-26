# 아이메이커스 AI V2.1

6–10세 어린이가 자신의 그림에서 시작해 AI와 대화하고, 생각을 확장한 뒤 이미지로 펼쳐보는 창작 스튜디오 프로토타입입니다.

## 실행

```bash
npm install
npm run dev -- --host 0.0.0.0
```

`npm run dev`는 Vite frontend와 Express API를 함께 실행합니다. 프로덕션 frontend 빌드는 `npm run build`, 서버 type check는 `npm run typecheck:server`로 확인할 수 있습니다.

## 현재 범위

- 터치/포인터 그림판과 이미지 업로드
- 불확실성을 전제로 한 그림 관찰
- 이전 답변을 연결하는 AI 코치 대화
- 세션 단위 Creative Memory
- 사용자 동의 후 시각화
- 원본/확장 이미지 나란히 비교
- 자연어 수정과 V1/V2/V3 버전 탐색
- AI/Image Provider 어댑터

기본값은 브라우저에서 바로 체험 가능한 mock provider입니다.

## 실제 AI 연결

`.env.example`을 `.env`로 복사하고 provider와 API 백엔드 주소를 지정합니다.

```env
VITE_AI_PROVIDER=openai
VITE_AI_API_BASE=/api
```

시작 화면 우측 상단에서 체험(mock), OpenAI, Claude를 선택할 수 있습니다. 프론트엔드는 다음 백엔드 엔드포인트를 사용합니다.

- `POST /api/analyze-drawing`
- `POST /api/respond-to-child`
- `POST /api/summarize-memory`
- `POST /api/generate-image`
- `POST /api/edit-image`

OpenAI/Anthropic API 키는 `VITE_` 환경 변수에 넣지 마세요. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`처럼 서버 전용 환경 변수로 관리해야 합니다. Provider 계약은 `src/providers/types.ts`, 원격 어댑터는 `src/providers/index.ts`, mock 동작은 `src/providers/mock.ts`에 있습니다.

Cloud adapter는 `server/providers/openai.ts`와 `server/providers/anthropic.ts`에 있습니다. Claude는 자체 이미지 생성 API가 없으므로 Claude 대화를 선택해도 시각화는 기본적으로 OpenAI image provider를 사용합니다.

동일한 10개 시나리오 비교:

```bash
npm run test:providers
```

평가 기준과 기록은 `AI_PROVIDER_COMPARISON.md`를 참고하세요.

## Creative Memory

세션 동안 다음을 구분해 기억합니다.

- `mainSubject`: 아이가 확인한 중심 대상
- `confirmedFacts`: 아이가 확정한 설정
- `rejectedIdeas`: 거절한 AI 아이디어
- `childPreferences`: 크기, 분위기 등 선호
- `mood`: 이미지 생성에 사용할 분위기
- `askedQuestions`: 반복을 피해야 하는 이전 질문

실제 서비스에서는 이 객체 전체를 대화 및 이미지 생성 요청에 포함하도록 설계되어 있습니다.
# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
