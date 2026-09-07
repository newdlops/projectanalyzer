# 함수 이해와 프레임워크 동작 분석

## 화면에서 읽는 순서

`한눈에 이해`는 작성된 함수 설명, 받는 값, 흐름이 갈리는 곳, 반환·오류·확인된 외부 효과를
먼저 보여 준다. 숫자는 표시된 직접 소유 코드 위치 수다. 실행 횟수나 분석되지 않은 효과의
부재를 뜻하지 않는다. 입력/판단/결과를 선택하면 대응 graph block과 `코드 이해`로 이동한다.
선택 Inspector는 해당 종류의 문장을 읽는 방법을 먼저 설명하고 기존 source detail을 보존한다.

프레임워크 근거가 있으면 `React/Django 동작 이해하기`를 펼칠 수 있다. 목록에서 필요한
항목만 열어 동작 시점, 설명, source caption, confidence를 확인한다. `그래프에서 찾기`는
현재 그래프에 매핑된 block으로, `근거 소스 열기`는 Host가 발행한 source span으로 이동한다.
문서나 코드 caption을 번역하거나 사업적 목적을 추측하지 않는다.

## 지원하는 근거

| 프레임워크 | 소스에서 확인하는 항목 | 구분하는 동작 |
| --- | --- | --- |
| React | JSX와 React import 또는 package detection | 렌더 계산과 화면 반영 |
| React | import alias/namespace의 useState/useReducer | 현재 렌더의 값과 다음 렌더 요청 |
| React | useEffect/useLayoutEffect, dependency 인수, inline cleanup | empty/dependency/every-commit/unknown dependency, 정리와 재설정 |
| React | useMemo/useCallback/useRef/useContext | 값 재사용, 함수 참조, ref 보관, provider 소비 |
| React | JSX on… 속성값 | 핸들러 전달과 속성 계산 중 즉시 호출 |
| Django | view/middleware unit, HTTP dispatch method | 설정이 연결할 때의 요청·응답 처리 |
| Django | import 소유 require_*, login_required, receiver | 메서드/인증 검사와 signal 등록 |
| Django | atomic decorator/with, on_commit | 트랜잭션/저장점과 커밋 콜백 |
| Django | 연결된 model, 기본 objects manager, 단일 대입 alias | lazy query 구성, 결과 평가, DB 쓰기 |
| Django | HttpResponse/JsonResponse 등, render, redirect | 응답 객체·템플릿 응답·리다이렉트 구성 |

함수 이름이나 `objects`, `useEffect` 같은 문자열만으로 framework API라고 분류하지 않는다.
실제 syntax import와 scope를 확인한다. React 자동 JSX runtime은 engine이 감지한 해당
package root 안에서만 추론한다. Django model import는 graph model unit의 이름과 source
module 경로를 함께 확인한다. 같은 파일의 직접 `models.Model` 상속도 인식한다.

`exact`는 import 소유 API의 syntax 근거가 있다는 뜻이다. 실제 호출되었다는 뜻은 아니다.
JSX의 component 역할, event 속성, Django convention/ORM에는 `inferred`를 보존한다.
사용자 정의 component가 on… 속성을 호출하는 방법, 사용자 정의 Manager/QuerySet/model의
override와 signal, 캐시·transaction의 실제 결과는 이 화면에서 확정하지 않는다.

## 범위와 한계

- 선택한 함수의 직접 syntax와 지원하는 inline Effect cleanup을 읽는다. 외부 callback body를
  호출 그래프 전체로 추적하거나 custom Hook 내부를 자동으로 펼치지 않는다.
- React의 HOC/wrapper를 통한 간접 callable ownership, class lifecycle, 동적 hook 재지정,
  renderer별 상세 동작, Next.js/서버 컴포넌트 실행 경계는 전용 분석 대상이 아니다.
- Django의 실제 URL resolution, middleware 등록 순서, inheritance/MRO, DRF serializer/viewset,
  custom manager, 모든 comprehension/evaluation 방식, 동적 import·reflection은 해석하지 않는다.
- 상수 alias 전파나 재할당 흐름을 증명하지 않는다. 모호한 alias와 shadow는 보수적으로 생략한다.
  비동기 ORM 호출은 직접 `await`된 경우에만 작업으로 분류하며, async Effect가 반환하는
  Promise를 React cleanup 함수로 취급하지 않는다.
- code가 예외적인 parser recovery 한계를 넘거나 source를 읽지 못하면 optional framework
  결과를 생략한다. 기존 function logic과 source navigation은 계속 사용할 수 있다.
- syntax 순회는 방문 집합, depth 기본 40/최대 100, 최대 30,000 node로 제한한다. source는
  1,000,000 UTF-16 code unit 이하, fact는 기본 16/최대 24개다. 알려진 생략 수와 limit을 표시한다.
  caption은 300자로 제한하지만 연결한 원본 source 범위는 그대로 보존한다.
- 요청, SQL, component render를 실행하지 않는다. 실제 실행 순서, query count, 성능·결과를
  관찰한 profiler가 아니다. 사실 목록의 위아래 순서는 source 탐색 순서다.

## 모듈 계약

- `src/analyzer/frameworkBehavior/index.ts`: `analyzeFunctionFrameworkBehavior`, source fact 타입.
- `src/application/codeFlow/functionTutor/frameworkBehaviorProjection.ts`: source range를 opaque
  graph/evidence token으로 치환. UI는 source path나 analyzer identity를 해석하지 않는다.
- `src/protocol/frameworkBehavior.ts`: optional Tutor payload, 기존 message protocol 사용.
- `src/webview/codeFlow/understanding/index.ts`: pure reading model과 retained DOM/CSS public API.
- `src/localization/frameworkBehaviorCatalog.ts`: 모든 동작 설명의 한국어/영어 쌍.

## 검증

2026-09-07 기준 실제 analyzer → Tutor builder → application projector → production Webview
HTML을 제공하는 로컬 harness로 확인했다. VS Code Host message는 기록하는 adapter로 대체했다.
내장 Browser는 사용 가능한 browser를 반환하지 않아 별도 Playwright Chromium을 사용했다.

- 신규 17개 unit test: React/Django fixture source 위치 snapshot, alias/shadow/closure/CBV helper,
  bounds/parse failure, 상대 package root, opaque projection, source-scoped overview counts.
- 신규 및 관련 Webview/localization/Inspector regression **79개 통과**, package tests **12개 통과**.
- 전체 TypeScript unit: **633개 중 628개 통과, 기존 실패 5개 유지**.
  `functionTutor.test.ts`의 type baseline, nested object representative, advanced private calls,
  logical-return continuation 네 건과 `sourceHighlightArchitecture.test.ts`의 기존 source shape 기대 한 건이다.
  이번 framework/reading 관련 신규 실패는 없다.
- TypeScript check/compile, package check tests 실행. Rust source와 runtime engine 구현은 변경하지 않았다.
- 1440×900, 768×1024, 390×844, 320×844에서 두 framework의 initial/expanded 상태와
  키보드 Enter, graph/evidence action, 최초 entry 가시성, locale/focus/disclosure 유지, 가로 overflow를 검사했다.
- 기존 reading/Inspector/Values/Scenario/Guide의 1440/768/390 흐름, long text, empty/loading/error와
  retry, light/dark/forced-colors, reduced-motion을 검사했다. browser error 및 실패 request는 없었다.
  94개 block의 dense fixture와 framework 근거 없음/추가 근거 생략 상태도 검사했다.
- Impeccable technical audit와 Web Interface Guidelines 검토를 적용했다. 새 UI detector의
  결과는 `[]`였다. token 색, native semantics, focus-visible, 44px touch action, bounded scroll을
  확인하고 initial camera/locale title/불완전 payload 처리 문제를 수정했다.
- 실제 VS Code에서 editor reveal을 클릭한 end-to-end 검증, screen reader 사용자 검증,
  실제 React/Django runtime 관찰은 수행하지 않았다.

검증 harness와 screenshot은 `/private/tmp/projectanalyzer-reading-qa/`에 있다. 개발용 harness는
VSIX에 포함하지 않는다. 새 모듈을 독립 파일로 유지하기 위해 package file-count 한도는
400에서 425로 조정하며 archive/unpacked/single-file byte 한도와 runtime allowlist는 유지한다.

### 0.0.1089 설치

`npm run package:vsix`로 macOS ARM64 package를 생성하고 VSIX allowlist/budget 검사와
release metadata 검사를 통과했다. 최종 package는 **410개 파일, archive 3.19 MiB,
unpacked 13.48 MiB**다. VS Code CLI로 `newdlops.function-analysis@0.0.1089` 설치를
확인했으며 설치된 React/Django adapter, understanding model/DOM, framework catalog의
다섯 모듈이 최종 build와 byte 단위로 일치했다. QA 전용 localhost server는 종료했다.

### UI 기술 audit

새 understanding surface에 대해 Impeccable technical audit와 Web Interface Guidelines를
적용했다. 일반적인 전체 제품 접근성 인증이나 독립적인 두 agent critique는 수행하지 않았다.

| 항목 | 점수 | 근거와 남은 범위 |
| --- | --- | --- |
| 접근성 | 3/4 | native 버튼/details, 이름, keyboard와 visible focus 확인. screen reader 미검증 |
| 성능 | 3/4 | DOM 유지, 방문/depth/fact 제한, 새 dependency 없음. 별도 profiler 미실행 |
| 반응형 | 3/4 | 320–1440px, touch와 source overflow 검사. canvas는 명시적 pan/zoom 필요 |
| 테마 | 3/4 | VS Code token 재사용, 기본 light/dark/forced-colors 확인. 임의 사용자 테마는 미검증 |
| 구현 일관성 | 4/4 | 독립 feature 경계, 원본 근거/추론 분리, detector 0건 |
| 합계 | 16/20 | 수정 후 해당 범위의 미해결 P0/P1 없음 |

수정한 주요 문제: `functionLogicViewportBrowserSource.ts`의 최초 entry 위치,
`functionVisualizerBrowserSource.ts`의 locale 함수 title 복원,
`functionUnderstandingModel.ts`의 부분 payload 처리와 DB write count.
`functionUnderstandingStyles.ts`에서 wrapping/forced-colors/focus/touch를 확인했다.

## 동작 설명의 기준 문서

- [React render and commit](https://react.dev/learn/render-and-commit)
- [React useEffect](https://react.dev/reference/react/useEffect),
  [useLayoutEffect](https://react.dev/reference/react/useLayoutEffect)
- [React events](https://react.dev/learn/responding-to-events),
  [useMemo](https://react.dev/reference/react/useMemo),
  [useCallback](https://react.dev/reference/react/useCallback),
  [useRef](https://react.dev/reference/react/useRef),
  [useContext](https://react.dev/reference/react/useContext)
- [Django URL dispatcher](https://docs.djangoproject.com/en/5.2/topics/http/urls/)
- [Django database queries](https://docs.djangoproject.com/en/5.2/topics/db/queries/)
- [Django transactions](https://docs.djangoproject.com/en/5.2/topics/db/transactions/)
- [Django signals](https://docs.djangoproject.com/en/5.2/topics/signals/)

프레임워크 버전별 모든 차이를 검사하지 않는다. 위 공개 API의 일반 계약을 source evidence와
연결하며, 프로젝트에서 확인되지 않은 실제 실행 환경이나 동작 결과는 만들어 내지 않는다.
