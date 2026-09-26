# REAL IMAGE GENERATION TEST REPORT

## 결론

**PASS — 실제 FAL / FLUX.1 Kontext로 생성 1회와 연속 편집 2회가 모두 성공했다.**

- 실행일: 2026-09-26 (UTC)
- Provider: `fal`
- Mock 사용: **NO** (`isMock: false` 3/3)
- 비밀 키 값 출력/기록: **NO**
- 최종 검증 비용: **$0.12** (`$0.04 × 3 images`)
- 최종 결과: 돼지·숲·빨간 가방·선물 생성, 밤 전환, 돼지 확대가 모두 실제 이미지에 반영됨

## 실제 model / endpoint

| 용도 | Model ID | Endpoint |
|---|---|---|
| 최초 생성 | `fal-ai/flux-pro/kontext/text-to-image` | `POST https://fal.run/fal-ai/flux-pro/kontext/text-to-image` |
| 후속 편집 | `fal-ai/flux-pro/kontext` | `POST https://fal.run/fal-ai/flux-pro/kontext` |

두 모델의 공식 가격은 각각 이미지 1장당 `$0.04`이다. API 응답에는 token/compute usage가 별도로 제공되지 않아 생성 장수 기준 비용을 기록했다.

## 최종 검증 체인

| 단계 | 요청 | Image ID | latency | 비용 |
|---|---|---|---:|---:|
| 1 | 돼지 + 숲 + 빨간 가방 + 친구에게 줄 선물 | `fal-7a179b84-7607-404b-b567-caa06de83a3b` | 5,598 ms | $0.04 |
| 2 | 밤으로 바꿔줘 | `fal-f81f3361-83e9-4d1f-8a8a-bf71b164f5a4` | 10,799 ms | $0.04 |
| 3 | 돼지를 더 크게 해줘 | `fal-353a2c06-9dc5-4ccd-8cc5-85f893e5effc` | 12,153 ms | $0.04 |

### Asset URL과 연결

1. 생성: `https://v3b.fal.media/files/b/0aabf964/W3kFPLQTiBJnSQ4olZGAi_64993005f70743f0b72080b03393c700.png`
2. 밤 편집: `https://v3b.fal.media/files/b/0aabf965/0Qb_0UOM0SCyS5y4uXXQM_361cff3c7c3a4ed095d1983a1352efcd.png`
   - `previousImageId`: `fal-7a179b84-7607-404b-b567-caa06de83a3b`
3. 돼지 확대: `https://v3b.fal.media/files/b/0aabf966/9K5m8br5_CUWlKhnU3twg_55055bb4b3444c969234025d8be29ed7.png`
   - `previousImageId`: `fal-f81f3361-83e9-4d1f-8a8a-bf71b164f5a4`

세 파일은 모두 실제 `1024 × 1024` PNG이며 URL, image ID, SHA-256이 모두 다르다.

| 단계 | SHA-256 |
|---|---|
| 1 | `c68a557f4180f6654aff64f5357b2893cf1c2928d92430e3fa095e3d1197b603` |
| 2 | `9dfc37aacc0a4d4f976eac2f197d9895ba480617c6d35a990941768cd674209d` |
| 3 | `1eef9ad55d238ff9dc3e7363630f63a253bd60c26b3f903860560bb962995b81` |

## 시각 검증

### 1. 최초 생성

**PASS**

- 둥근 분홍색 돼지가 중심 주인공으로 보임
- 나무·꽃·풀·숲길이 명확함
- 빨간 배낭이 명확하게 보임
- 리본으로 포장된 선물을 두 손으로 들고 있음
- 밝은 낮의 동화책 일러스트 스타일이 반영됨

### 2. “밤으로 바꿔줘”

**PASS**

- `CHANGE`: 밝은 낮이 짙은 파란 밤, 달, 별, 달빛으로 변경됨
- `KEEP`: 같은 분홍색 돼지의 얼굴·몸·포즈, 빨간 배낭, 선물, 숲길, 동화책 스타일이 유지됨
- 원본 1단계 asset은 덮어쓰지 않고 별도 URL/ID로 보존됨
- 조명에 맞춘 색·명암과 일부 배경 디테일은 재렌더링됐지만, 요청과 무관한 핵심 요소의 소실은 없음

### 3. “돼지를 더 크게 해줘”

**PASS**

- `CHANGE`: 2단계보다 돼지의 머리와 몸이 프레임에서 더 크게 보임
- `KEEP`: 밤, 달, 별, 숲, 빨간 배낭, 선물, 캐릭터 정체성, 화풍이 유지됨
- 2단계 구도와 배경은 대부분 유지됨
- 생성형 편집 특성상 얼굴선·선물 위치·식물 디테일에 소폭 재렌더링이 있으나 의미가 바뀌거나 요소가 불필요하게 추가/삭제되지는 않음

## 항목별 판정

| 검증 항목 | 판정 | 근거 |
|---|---|---|
| 실제 FAL API 호출 성공 | **PASS** | 실제 FAL URL 3개와 FLUX Kontext 응답 수신 |
| 실제 model/endpoint 기록 | **PASS** | 생성/편집 Model ID와 endpoint를 위에 기록 |
| 원본 그림 보존 | **PASS** | 각 source asset이 별도 URL/ID/SHA로 남고 다음 편집의 입력으로 연결됨 |
| 단계별 새 asset / image ID | **PASS** | URL, ID, SHA가 3단계 모두 고유 |
| KEEP / CHANGE 반영 | **PASS** | 밤 전환과 돼지 확대가 반영되고 핵심 요소 유지 |
| 불필요한 요소 변경 방지 | **PASS (minor redraw)** | 핵심 의미·소품·배경 유지, 세부 픽셀만 소폭 재렌더링 |
| Mock 사용 여부 | **PASS — 미사용** | 모든 응답 `provider: fal`, `isMock: false`; fallback 없음 |
| 각 호출 비용/사용량 | **PASS** | 최종 3회 각각 1 image, `$0.04`; 합계 `$0.12` |

## 실행 및 비용 참고

테스트 명령:

```bash
npm run test:fal-images
```

최종 검증 전에 prompt 결함을 발견하기 위한 성공 응답 6회가 추가로 발생했다. 해당 재시도 비용은 `$0.24`이며, 이번 충전 후 전체 성공 호출 비용은 **$0.36** (`9 images × $0.04`)이다. 최초 크레딧 잠금 상태의 HTTP 403 요청은 이미지가 생성되지 않아 위 이미지 비용 합계에 포함하지 않았다.

정적 검증은 `npm run typecheck:server`, `npm run build`, `npm run lint`로 수행한다.
