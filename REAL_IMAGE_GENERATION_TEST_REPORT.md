# REAL IMAGE GENERATION TEST REPORT

## 결론

**실제 FAL API 요청은 전송됐지만 이미지 생성은 실패했다.**

- 실행일: 2026-09-26 (UTC)
- Image provider: `fal`
- 생성 모델: `fal-ai/flux-pro/kontext/text-to-image`
- 편집 모델: `fal-ai/flux-pro/kontext`
- Mock 사용: **NO**
- 실제 FAL 호출: **YES**
- 실제 FAL 호출 성공: **NO**
- FAL 응답: HTTP `403` — `User is locked. Reason: TOP_UP.`
- 비밀 키 값 출력/기록: **NO**

`FAL_KEY`는 Runtime Secret으로 서버에 주입되어 인증 헤더를 포함한 실제 요청이 FAL endpoint까지 도달했다. 그러나 FAL 계정이 결제/크레딧 충전을 요구하는 잠금 상태여서 첫 생성 요청을 거부했다. 구현은 실패 시 Mock으로 fallback하지 않으므로 이 결과는 Mock 이미지로 대체되지 않았다.

## 실행 시나리오

| 단계 | 요청 | 결과 | 새 image asset / image ID |
|---|---|---|---|
| 1 | 돼지 + 숲 + 빨간 가방 + 선물 | **FAIL** — FAL HTTP 403 `TOP_UP` | 생성되지 않음 |
| 2 | 밤으로 바꿔줘 | **NOT RUN** — 1단계 source asset 없음 | 생성되지 않음 |
| 3 | 돼지를 더 크게 해줘 | **NOT RUN** — 2단계 source asset 없음 | 생성되지 않음 |

테스트 명령:

```bash
npm run test:fal-images
```

이 테스트는 1단계 결과 URL을 2단계 `image_url`로, 2단계 결과 URL을 3단계 `image_url`로 전달한다. 각 응답에 대해 `provider === "fal"`, `isMock === false`, URL/ID 고유성, `previousImageId` 체인을 검사하도록 구현했다. 이번 실행에서는 1단계가 upstream에서 거부되어 후속 assertion까지 도달하지 못했다.

## 검증 결과

| 검증 항목 | 상태 | 근거 |
|---|---|---|
| 실제 FAL API 호출 성공 여부 | **FAIL** | FAL endpoint가 HTTP 403 `TOP_UP` 반환 |
| 원본 그림 보존 | **BLOCKED** | 비교할 생성 이미지가 없음 |
| 단계별 새 image asset / image ID | **BLOCKED** | 첫 asset 생성 전에 거부됨 |
| KEEP / CHANGE의 실제 이미지 반영 | **BLOCKED** | 이미지 출력이 없어 시각 검증 불가 |
| Mock 사용 여부 | **PASS — Mock 미사용** | 요청 provider는 `fal`, 실제 FAL 오류가 그대로 반환됐고 fallback 없음 |

## 구현 및 정적 검증

- UI Image provider 선택지에 `FAL · FLUX Kontext` 추가
- `VITE_IMAGE_PROVIDER=fal` 설정 지원
- `FAL_KEY`는 서버 환경 변수로만 사용
- FLUX Kontext text-to-image 생성 및 image-to-image 편집 어댑터 추가
- 편집 단계에서 FAL HTTPS asset URL과 `previousImageId` 전달 지원
- 각 성공 응답은 `fal-<UUID>` 형식의 새 image ID를 생성하고 `isMock: false`로 표시
- `npm run typecheck:server`: PASS
- `npm run build`: PASS
- `npm run lint`: PASS

## 재검증 조건

FAL 계정 잠금 해제 또는 크레딧 충전 후 같은 명령을 다시 실행해야 한다. 그 전에는 원본 보존, 단계별 asset/ID, KEEP/CHANGE 반영 여부를 실제 이미지 기준으로 판정할 수 없다.
