# Function Guide UI 검증 및 개선 구현 계획

> 문서 상태: 구현 전 확정 계획
> 작성일: 2026-07-26
> 기준 코드: `16161d9` (`feat(webview): 그래프 헤더와 Function Tutor 읽기 화면을 통합`)
> 대상 제품: Project Analyzer VS Code Extension의 Function Logic Webview
> 대상 기능: `Function Guide` disclosure, Inspector 결합, 5개 질문 읽기 흐름,
> `Static Input Cases`, 그래프/Values handoff
> 구현 모델 목표: Terra Medium이 추가 UI 설계 없이 이 문서의 순서와 계약만 따라
> 구현할 수 있어야 한다.

---

## 0. 이 문서를 구현할 때 지켜야 할 우선순위

구현 중 판단이 충돌하면 다음 순서를 따른다.

1. 이 문서의 `P0/P1 수용 기준`
2. `DESIGN.md`의 Function Guide 정적 분석·정직성 계약
3. `PRODUCT.md`의 source-first, bounded, no-AI, no-runtime-execution 원칙
4. 루트 `AGENTS.md`의 모듈 경계, 파일 길이, 주석, 테스트 규칙
5. 기존 Function Logic/Inspector의 VS Code 시각 언어
6. 구현 편의

이 문서는 UI 개선 계획이다. 분석 결과의 의미, static interpreter의 안전 경계,
evidence token 보안 모델, 기존 네 개 lens의 의미를 재설계하지 않는다.

구현자는 다음 작업을 임의로 추가하지 않는다.

- 새 palette 또는 custom font
- React 전환
- chart library
- AI/LLM 설명
- source 실행
- 새 graph canvas
- runtime likelihood나 실행 빈도
- icon-only `Function Guide`
- modal/onboarding tour
- 자동 source open
- Guide를 다섯 번째 lens로 변경

---

## 1. 한 줄 결론

현재 Function Guide의 핵심 정보구조는 타당하다.

- `At a Glance`
- 고정된 5개 질문
- 한 번에 한 질문의 상세
- source-backed fact와 certainty
- 명시적인 graph/source action
- lazy `Static Input Cases`
- `Unknowns & Limits`

그러나 현재 구현은 다음 이유로 UI 완료 판정을 받을 수 없다.

1. `Function Guide`를 눌러도 닫힌 Inspector가 열리지 않아 화면상 아무 변화가
   없을 수 있다.
2. Guide가 Inspector의 선택 블록 아래에 붙어 있어 열려도 첫 화면 밖에 있을 수
   있다.
3. 질문 이동과 scenario 계산 때 전체 Guide DOM을 재생성하여 keyboard focus와
   native disclosure focus가 사라질 수 있다.
4. Guide를 계산 도중 닫으면 scenario 계산이 다시 시작되지 않는 상태가 생긴다.
5. 좁은 화면에서 certainty 열을 단순히 숨겨 정적 추론의 불확실성이 사라진다.
6. Inspector 제목은 계속 `Selected block`으로 남아 Guide의 사용 목적을 흐린다.
7. 정적 안내문을 live region으로 사용하면서 실제 계산 진행률은 제대로 알리지
   않는다.
8. main fact, chapter action, Source Basis에 `Open Source`가 반복되어 시각 노이즈와
   tab stop이 과도하다.

따라서 개선의 핵심은 “카드를 예쁘게 다듬기”가 아니라 다음 세 가지다.

1. Inspector를 `inspect`와 `guide`의 명시적 읽기 모드로 만든다.
2. Function Guide를 stable DOM shell과 작은 상태 controller로 재구성한다.
3. scenario를 선택 목록 + 상세 영역으로 바꾸고, 계산 상태를 pause/resume 가능한
   state machine으로 만든다.

---

## 2. 검증 범위와 사용한 UI 방법론

### 2.1 적용한 UI 스킬

| 스킬 | 이번 검증에서 사용한 역할 |
|---|---|
| `ui-design-workflow` | 기존 design system, 인접 Inspector, 모든 UI 상태, 기능 QA와 visual QA 분리 |
| `ui-ux-pro-max` | dense developer tool, progressive disclosure, keyboard, focus, reflow, touch 기준 |
| `impeccable` | cognitive load, hierarchy, redundancy, mode clarity, persona 기반 critique |
| `web-design-guidelines` | semantic HTML, focus-visible, async status, long text, native select, animation 규칙 |

React/Next.js 구현이 아니므로 `vercel-react-best-practices`는 적용하지 않는다.

### 2.2 확인한 코드와 제품 계약

주요 확인 파일:

- `PRODUCT.md`
- `DESIGN.md`
- `docs/plans/function-tutor-codebase-understanding-upgrade-plan.md`
- `src/webview/codeFlow/functionLogicBrowserSource.ts`
- `src/webview/codeFlow/presentation/functionLogicGraphHeaderBrowserSource.ts`
- `src/webview/codeFlow/viewport/functionLogicViewportBrowserSource.ts`
- `src/webview/codeFlow/inspector/functionLogicInspectorBrowserSource.ts`
- `src/webview/codeFlow/inspector/functionLogicInspectorStyles.ts`
- `src/webview/codeFlow/tutor/functionTutorGuideBrowserSource.ts`
- `src/webview/codeFlow/tutor/functionTutorGuideStyles.ts`
- `src/webview/codeFlow/tutor/functionTutorIntegrationBrowserSource.ts`
- `src/webview/codeFlow/comprehension/functionLogicComprehensionBrowserSource.ts`
- `src/webview/codeFlow/dataFlow/functionLogicDataFlowBrowserSource.ts`
- `src/webview/codeFlow/valuePreview/functionLogicValuePreviewBrowserSource.ts`
- `src/protocol/functionTutor.ts`
- `src/application/codeFlow/functionTutor/functionTutorGuidePlanner.ts`
- `src/test/unit/codeFlowWebview.test.ts`
- `src/test/unit/functionVisualizerWebview.test.ts`
- `src/test/unit/helpers/sidebarWebviewRuntime.ts`

### 2.3 최신 Web Interface Guidelines 대조

2026-07-26 기준 최신
[Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md)
원문을 다시 조회해 다음 항목을 대조했다.

- semantic element 우선
- async update의 polite live status
- visible `:focus-visible`
- `outline: none` 금지
- long text와 empty state
- `prefers-reduced-motion`
- `transition: all` 금지
- native select의 foreground/background
- button hover/active/focus hierarchy
- 구체적인 action label

### 2.4 Impeccable detector 결과와 한계

다음 detector를 현재 source에 실행했다.

```text
node /Users/lky/.agents/skills/impeccable/scripts/detect.mjs --json \
  src/webview/codeFlow/tutor/functionTutorGuideBrowserSource.ts \
  src/webview/codeFlow/tutor/functionTutorGuideStyles.ts \
  src/webview/codeFlow/tutor/functionTutorIntegrationBrowserSource.ts \
  src/webview/codeFlow/functionLogicBrowserSource.ts
```

결과는 `[]`였다. 즉 detector가 찾는 일반적인 markup anti-pattern은 없었다.

이 결과는 다음을 보증하지 않는다.

- disclosure가 실제 보이는 위치에 열리는가
- focus가 rerender 후 유지되는가
- async state가 resume되는가
- 좁은 폭에서 의미가 사라지지 않는가
- Inspector와 Guide의 mental model이 명확한가

이 항목들은 manual source/state audit에서 별도로 발견했다.

### 2.5 이번 검증에서 수행하지 못한 것

현재 세션에는 연결 가능한 브라우저가 없었다. 브라우저 제어를 시작했지만
`No browser is available`로 종료됐다.

따라서 이번 문서는 다음 성격이다.

- 수행함: source audit, state-flow audit, design contract 대조, 접근성/인지 부담
  heuristic review, detector
- 수행하지 못함: 실제 VS Code Webview screenshot, viewport별 layout 확인,
  실제 keyboard tab order, screen reader, theme별 visual QA

이 문서를 “실제 렌더링 visual sign-off”로 간주하면 안 된다. 구현 완료 조건에는
별도의 real-browser/VS Code QA gate를 둔다.

독립된 두 번째 reviewer가 수행하는 formal critique도 실행하지 않았다. 아래
점수와 우선순위는 단일 검토자의 코드 기반 결과이며 사용자 연구 수치가 아니다.

---

## 3. 현재 구현 구조

### 3.1 현재 topology

```text
Function Logic graph
├─ graph header
│  ├─ Show: Flow / Values / Calls / Effects
│  ├─ viewport: − / 100% / + / Center / Fit
│  ├─ Function Guide toggle
│  └─ Inspector toggle
└─ graph workspace
   ├─ graph viewport
   └─ Inspector drawer
      └─ scroll
         ├─ selected block panel
         ├─ Function Guide section
         ├─ Values editor
         ├─ scenario trace
         ├─ playback
         ├─ value toolbar
         ├─ static ledger
         ├─ callees
         └─ signature
```

중요한 현재 순서:

- `functionLogicInspectorBrowserSource.ts:64`에서 `selectionPanel`이 먼저
  `scroll`에 들어간다.
- `functionLogicBrowserSource.ts:313-322`에서 Guide가 나중에
  `appendSections`로 추가된다.
- Guide toggle은 Guide section의 `hidden`만 바꾸고 `inspector.open()`을 호출하지
  않는다.

즉 `Function Guide`를 눌렀을 때:

- Inspector가 닫혀 있으면 Guide는 열렸지만 보이지 않는다.
- Inspector가 열려 있어도 selected block detail이 길면 Guide는 fold 아래에서
  열릴 수 있다.
- Inspector header는 계속 `FUNCTION INSPECTOR / Selected block`이다.

### 3.2 현재 Guide render 방식

```text
toggle click
  └─ render()
      ├─ clearElement(content)
      ├─ header/intro/status 새로 생성
      ├─ overview 새로 생성
      ├─ question buttons 5개 새로 생성
      ├─ selected chapter 새로 생성
      ├─ scenarios details/table 새로 생성
      └─ limits details 새로 생성
```

다음 이벤트도 같은 전체 `render()`를 호출한다.

- question click
- question ArrowUp/ArrowDown/Home/End
- Previous/Next
- Static Input Cases toggle
- scenario 한 건 계산 완료
- scenario row 선택
- path select 변경

따라서 native `<details>`, summary, focused button, select를 포함한 interactive element
identity가 계속 바뀐다.

### 3.3 현재 scenario lifecycle

```text
idle
  └─ details open
      └─ scenarioStarted = true
          └─ seed 0 계산
              └─ render
                  └─ setTimeout(seed 1)
```

Guide를 닫으면 `runNext`는 `!open` 때문에 종료된다. 그러나
`scenarioStarted`는 계속 `true`라서 다시 Guide를 열어도
`startScenarioCalculation()`이 즉시 return한다.

이 상태에서는 남은 case가 영구히 `Calculating…`에 머물 수 있다.

---

## 4. 타당한 부분과 반드시 보존할 부분

이번 개선에서 아래 구조는 유지한다.

### 4.1 타당한 정보구조

- 다섯 질문은 코드 이해의 mental model로 적절하다.
- 질문 순서가 고정되어 recognition을 돕는다.
- 한 번에 한 chapter만 상세하게 보이는 progressive disclosure는 적절하다.
- `At a Glance`는 질문 전에 방향 감각을 제공한다.
- `Source Basis`와 `Unknowns & Limits`는 정적 분석의 정직성을 지킨다.
- scenario를 기본으로 실행하지 않는 결정은 적절하다.
- graph를 주 시각화로 유지하고 Guide를 sidecar text alternative로 두는 구조가
  적절하다.

### 4.2 타당한 기술 선택

- native button/details/table/select 사용
- `aria-expanded`, `aria-controls`
- question roving tab stop의 방향키 모델
- VS Code semantic token 사용
- `prefers-reduced-motion`
- `forced-colors`
- long text의 `overflow-wrap`
- bounded 5 facts, 12 scenarios
- 명시적 `Show on Graph`, `Open Source`, `Load Inputs`

### 4.3 보존할 제품 불변 조건

1. Guide open만으로 graph lens를 바꾸지 않는다.
2. Guide open만으로 viewport를 움직이지 않는다.
3. Guide open만으로 source를 열지 않는다.
4. Guide open만으로 branch/value/playback state를 바꾸지 않는다.
5. Guide open만으로 scenario를 계산하지 않는다.
6. question 선택은 guide attention만 갱신할 수 있다.
7. `Show on Graph`만 lens/selection/bounded reveal을 수행한다.
8. `Open Source`만 editor source navigation을 수행한다.
9. `Load Inputs`만 known value를 Values에 쓴다.
10. 모든 문구는 possible static structure이며 runtime 결과가 아니다.

---

## 5. 코드 기반 heuristic baseline

아래 점수는 0~4의 구현 baseline이다.

| 항목 | 점수 | 근거 |
|---|---:|---|
| 시스템 상태 가시성 | 1 | Guide가 보이지 않을 수 있고 계산 progress live status가 없음 |
| 사용자 언어와의 일치 | 3 | 5개 질문과 source-backed 용어는 명확함 |
| 사용자 제어와 자유 | 2 | disclosure/Previous/Next는 있으나 focus와 resume가 깨짐 |
| 일관성 | 2 | VS Code token은 일관되지만 Inspector/Guide mode가 혼합됨 |
| 오류 예방 | 2 | unknown load는 막지만 중단 계산 상태를 복구하지 못함 |
| 기억보다 인식 | 3 | 5개 질문이 항상 보임 |
| 유연성과 효율 | 2 | 방향키가 있으나 rerender가 keyboard 흐름을 끊음 |
| 미니멀리즘 | 2 | header/status/evidence action 중복 |
| 오류 인지와 복구 | 1 | scenario 오류/중단의 재시도·resume 경로가 없음 |
| 도움과 한계 설명 | 3 | Source Basis/Unknowns & Limits가 존재 |

합계는 `21/40`이다.

이 점수는 사용성 측정값이 아니다. 구현 전 우선순위를 비교하기 위한 코드 기반
baseline이다.

목표는 모든 항목을 억지로 4로 만드는 것이 아니다. 구현 후 P0 항목을 모두 제거하고
다음 항목이 최소 3이 되게 한다.

- 시스템 상태 가시성
- 사용자 제어와 자유
- 일관성
- 유연성과 효율
- 오류 인지와 복구
- 미니멀리즘

---

## 6. 발견한 문제와 우선순위

### 6.1 요약표

| ID | 우선순위 | 문제 | 대표 위치 |
|---|---|---|---|
| FG-UI-001 | P0 | Guide toggle이 닫힌 Inspector를 열지 않음 | `functionTutorGuideBrowserSource.ts:23-26` |
| FG-UI-002 | P0 | Guide가 selected block 뒤에 있어 fold 아래에서 열림 | `functionLogicBrowserSource.ts:313-322` |
| FG-UI-003 | P0 | 전체 rerender로 focus와 details/select identity가 사라짐 | `functionTutorGuideBrowserSource.ts:28-55` |
| FG-UI-004 | P0 | 계산 도중 Guide close 후 scenario가 resume되지 않음 | `functionTutorGuideBrowserSource.ts:57-67` |
| FG-UI-005 | P0 | 좁은 폭에서 certainty를 숨겨 의미가 소실됨 | `functionTutorGuideStyles.ts:45` |
| FG-UI-006 | P1 | Inspector header와 Guide 목적이 충돌함 | Inspector header + Guide title |
| FG-UI-007 | P1 | static disclaimer가 live status이고 실제 progress는 미고지 | Guide source `:34-35`, scenario |
| FG-UI-008 | P1 | At a Glance가 retained array/fact 수로 total을 축소 표시 | Guide source `:132-135` |
| FG-UI-009 | P1 | heading hierarchy와 answer 대비가 약함 | Guide styles `:8-10` |
| FG-UI-010 | P1 | Open Source가 최대 11회 이상 중복될 수 있음 | Guide source `:152-157` |
| FG-UI-011 | P1 | 4열 scenario table이 280~390px drawer에 과밀함 | Guide source `:86-100` |
| FG-UI-012 | P1 | scenario row가 최대 12개 tab stop을 만듦 | Guide source `:90-99` |
| FG-UI-013 | P1 | partial/unavailable/error가 충분히 구분되지 않음 | Guide source `:35`, `:153` |
| FG-UI-014 | P1 | `initialChapterId`를 무시하고 항상 index 0을 사용 | Guide source `:15` |
| FG-UI-015 | P1 | path select ID가 고정되어 panel 간 충돌 가능 | Guide source `:107` |
| FG-UI-016 | P2 | certainty/layer/confidence raw enum이 그대로 노출됨 | Guide source `:119`, `:135`, `:152` |
| FG-UI-017 | P2 | coarse pointer에서도 Guide target이 26px | Guide styles `:26` |
| FG-UI-018 | P2 | graph header의 3개 작업군이 시각적으로 한 덩어리임 | header/viewport styles |
| FG-UI-019 | P1 | 현재 Webview test가 label 존재만 확인함 | `codeFlowWebview.test.ts:248-265` |

### 6.2 FG-UI-001/002 — disclosure가 보이지 않는 문제

사용자 영향:

- 버튼을 눌렀지만 아무 일도 일어나지 않은 것으로 보인다.
- `aria-expanded="true"`인데 controlled content가 닫힌 drawer 안에 있다.
- 기능의 사용 의의를 설명하기 전에 신뢰를 잃는다.

수정 기준:

- Guide toggle이 `closed → guide` 상태를 요청하면 Inspector drawer를 연다.
- Guide가 Inspector scroll의 첫 reading surface가 된다.
- selected block/tools와 Guide를 동시에 같은 scroll flow에 섞지 않는다.
- open 시 toggle focus는 그대로 둔다.
- open 시 viewport/lens/selection/scenario는 그대로 둔다.

### 6.3 FG-UI-003 — stable focus 위반

사용자 영향:

- `Previous Question`을 누르면 눌렀던 button이 DOM에서 제거된다.
- `<details>` summary를 열자마자 해당 details가 교체된다.
- scenario 계산 한 건마다 focused row/select가 교체된다.
- screen reader virtual cursor와 keyboard focus가 예측하기 어려워진다.

수정 기준:

- Guide shell, question buttons, details summary, live region은 panel 생명주기 동안 동일
  DOM identity를 유지한다.
- question change는 chapter body만 교체한다.
- scenario progress는 cell/text node만 갱신한다.
- keyboard question 이동은 새 selected question button에 focus한다.
- Previous/Next는 새 chapter heading에 focus한다.
- pointer question click은 clicked button focus를 유지한다.

### 6.4 FG-UI-004 — 계산 중단 복구 불가

사용자 영향:

- 일부 row가 계속 `Calculating…`으로 남는다.
- Guide를 닫았다 여는 일반 행동이 기능을 고장낸다.
- retry button도 없고 원인도 표시되지 않는다.

수정 기준:

- Guide close 또는 scenario disclosure close는 계산을 `paused`로 만든다.
- reopen은 계산되지 않은 첫 seed부터 resume한다.
- 이미 성공/실패한 seed는 다시 계산하지 않는다.
- 새 function/fingerprint 또는 dispose만 generation을 폐기한다.
- partial error와 all error를 구분한다.

### 6.5 FG-UI-005 — certainty 정보 소실

사용자 영향:

- 가장 좁고 인지 부담이 큰 환경에서 exact/inferred/unknown 구분이 사라진다.
- 제품의 핵심 약속인 “정적 불확실성을 숨기지 않는다”와 충돌한다.

수정 기준:

- 어떤 breakpoint에서도 certainty text를 `display: none` 하지 않는다.
- case list에서는 certainty를 case title 아래 secondary text로 둔다.
- selected detail에서 certainty를 다시 명시한다.
- transition table도 certainty를 유지한다.

### 6.6 FG-UI-006 — 두 개의 mental model 혼합

현재 drawer header:

```text
FUNCTION INSPECTOR
Selected block
<block label>
```

그 아래에:

```text
SOURCE-BACKED GUIDE
Understand This Function
```

이 구조는 사용자가 “지금 선택 블록을 보는가, 함수 전체를 읽는가”를 계속
재해석하게 만든다.

수정 기준:

- Inspector drawer는 한 시점에 `inspect` 또는 `guide` 중 하나만 보인다.
- drawer header도 active mode에 맞춰 바뀐다.
- graph는 두 모드 모두 계속 보인다.
- 다른 mode의 DOM/state는 유지하되 `hidden`으로 비활성화한다.

### 6.7 FG-UI-007 — status 역할 혼동

현재 `"Static source-backed evidence. No code is run."`은 상태 변화가 아니라
provenance 안내다. 이를 `role="status"`에 넣고 rerender마다 다시 만드는 것은
불필요한 announcement를 만들 수 있다.

수정 기준:

- provenance는 일반 visible text다.
- live region은 한 번 만들고 처음에는 비운다.
- graph action, scenario start/progress milestone/completion/error에만 사용한다.
- scenario body는 계산 중 `aria-busy="true"`다.

### 6.8 FG-UI-008 — At a Glance undercount

현재 `Reached From`은 total count가 아니라 retained array 길이를 사용한다.
decision/outcome은 semantic count가 아니라 retained fact 수를 사용한다.

예:

- 실제 direct caller 9개
- payload에 retained caller 6개
- 현재 UI는 `6 direct callers`
- 사용자는 bounded omission을 total로 오해할 수 있다.

수정 기준:

- inbound/outbound는 `context.counts.total*`를 사용한다.
- omitted count를 `+N not shown`으로 표시한다.
- internal shape는 prose parsing이나 fact array 길이가 아니라 structured chapter
  count를 사용한다.
- structured count가 없는 fallback은 `N source-backed facts`라고만 말한다.

### 6.9 FG-UI-009/010 — hierarchy와 중복 action

현재 문제:

- Guide title과 모든 h3가 같은 크기다.
- 가장 중요한 deterministic answer가 description color다.
- fact마다 Open Source
- chapter action의 첫 Open Source
- Source Basis마다 Open Source

fact 5개가 모두 evidence를 가지면 source action만 최대 11개가 된다.

수정 기준:

- drawer header가 Guide 제목을 담당한다.
- Guide body에서 kicker/title 중복을 제거한다.
- answer는 foreground/body size로 올린다.
- main fact list에서는 source button을 제거한다.
- chapter action에는 `Open First Source` 최대 1개만 둔다.
- 모든 fact별 source action은 collapsed `Source Basis` 안에서만 둔다.

### 6.10 FG-UI-011/012 — scenario 과밀과 tab path

현재 4열:

```text
Case | Inputs | Possible outcome | Certainty
```

Inspector 실제 폭은 280~390px이다. 각 cell이 여러 줄이 되면서 row 비교가
어려워지고, 최대 12개 case button이 모두 tab stop이다.

수정 기준:

- case 선택 table은 `Case | Possible Outcome` 두 열만 사용한다.
- Inputs와 Certainty는 selected case detail로 옮긴다.
- case title 아래에도 certainty를 짧게 표시한다.
- scenario row button은 roving tab stop을 사용한다.
- ArrowUp/ArrowDown/Home/End를 지원한다.
- 모든 case는 screen reader table 관계를 유지한다.

---

## 7. 확정 디자인 방향

### 7.1 이름

**Focused Source-Backed Sidecar**

### 7.2 목적

Function Guide는 dashboard가 아니다. 사용자가 graph의 공간 맥락을 유지한 채
함수 전체를 다섯 질문으로 읽는 집중형 sidecar다.

### 7.3 시각 원칙

1. graph가 항상 주 시각화다.
2. drawer에는 한 시점에 한 reading job만 보인다.
3. Guide는 heading, definition list, ordered navigation, divider를 사용한다.
4. 중첩 card grid를 만들지 않는다.
5. color는 의미를 보조하며 text/border style을 함께 쓴다.
6. exact/inferred/unknown을 숨기지 않는다.
7. 가장 중요한 answer가 가장 높은 대비를 가진다.
8. detail은 사용자가 disclosure를 열 때만 보인다.
9. motion은 drawer의 기존 transform/opacity 외에 추가하지 않는다.
10. 5개 질문은 항상 visible하여 recall 대신 recognition을 사용한다.

### 7.4 인지 부담 예산

한 화면의 주요 선택 단위:

- graph header: `Show`, `View`, `Read`의 3개 group
- Guide navigation: 5개 고정 질문이지만 하나의 ordered group
- chapter primary actions: 최대 2개
- fact main list: 기본 최대 3개, 나머지는 `More Facts`
- scenario list: 하나의 roving tab group

5개 질문은 일반적인 4개 working-memory 권고보다 하나 많다. 그러나 질문이
안정적인 순서로 고정되고 한 group으로 묶이며 상세는 하나만 보이므로 유지한다.
질문을 숨기는 dropdown으로 바꾸지 않는다.

---

## 8. 목표 UI topology

### 8.1 graph header

```text
Control & value flow

Show [Flow] [Values] [Calls] [Effects]
View [−] [100%] [+] [Center] [Fit]
Read [Function Guide] [Inspector]
```

wide에서는 한 줄 또는 자연스러운 wrap이다.

narrow에서는 group 단위로 wrap한다.

```text
Show [Flow] [Values] [Calls] [Effects]
View [−] [100%] [+] [Center] [Fit]
Read [Function Guide] [Inspector]
```

규칙:

- `Show`, `View`, `Read` label을 화면에 표시한다.
- 각 group은 `role="group"`과 구체적인 `aria-label`을 가진다.
- group 내부 gap은 2~3px, group 사이 gap은 8px이다.
- `Function Guide` text를 줄이거나 icon-only로 바꾸지 않는다.
- Guide와 Inspector button은 같은 drawer의 서로 다른 mode를 연다.

### 8.2 Guide mode drawer

```text
┌ FUNCTION GUIDE ─────────────────────────────── [×] ┐
│ Understand This Function                          │
│ Source-backed static analysis · no code runs      │
├───────────────────────────────────────────────────┤
│ Read its codebase role, inputs, decisions, work,  │
│ and outcomes.                                     │
│                                                   │
│ [Partial Guide message — only when needed]        │
│                                                   │
│ ▾ At a Glance                                     │
│ Role           Application · Medium confidence    │
│ Reached From   2 entrypoints · 9 direct callers   │
│ Inside         3 decisions · 1 loop · 2 endings   │
│ Leads To       3 local · 1 external · 1 unresolved│
│                                                   │
│ 5 Questions                                       │
│ ┃ 1  Where Does It Fit?                           │
│   2  What Comes In?              Partial evidence │
│   3  What Changes the Path?                       │
│   4  What Does It Change or Call?                 │
│   5  How Can It Finish?                           │
│                                                   │
│ Where Does It Fit?                                │
│ The current graph provides …                      │
│                                                   │
│ Source documentation                  [Exact]     │
│ Calculates a bounded amount.                      │
│                                                   │
│ Application layer                    [Inferred]   │
│ Architecture evidence classifies …                │
│                                                   │
│ [Show on Graph] [Open First Source]                │
│ ▸ Source Basis · 2 facts                           │
│                                                   │
│ [Next: What Comes In?]                            │
│                                                   │
│ ▸ Static Input Cases · 4                           │
│ ▸ Unknowns & Limits · 2                            │
└───────────────────────────────────────────────────┘
```

### 8.3 inspect mode drawer

기존 Inspector 정보는 유지한다.

```text
┌ FUNCTION INSPECTOR ────────────────────────── [×] ┐
│ Selected Block                                    │
│ return total                                      │
├───────────────────────────────────────────────────┤
│ selected block evidence                           │
│ Values / trace / playback / ledger / calls …      │
└───────────────────────────────────────────────────┘
```

### 8.4 Static Input Cases open

```text
▾ Static Input Cases · 4
  Compare bounded possible paths from inferred inputs.
  No source code runs.

  2 of 4 cases calculated

  Case                         Possible Outcome
  ┃ Default amount             May return 15
    Exact
    Boundary value             Calculating…
    Inferred
    Missing optional value     Could not calculate
    Unknown

  Selected Case
  Default amount

  Inputs
  amount     10                    Exact

  Possible Path [Path 1 of 2 ▾]
  This is a possible static path, not a runtime result.

  [Load Inputs & Open Values]

  Value       Possible Change       Evidence
  total       Unknown → 15          Inferred
```

어떤 폭에서도 certainty를 숨기지 않는다.

---

## 9. Inspector mode model

### 9.1 상태

```ts
type FunctionLogicInspectorMode = "inspect" | "guide";

type FunctionLogicInspectorViewState = {
  open: boolean;
  mode: FunctionLogicInspectorMode;
  scrollTopByMode: {
    inspect: number;
    guide: number;
  };
};
```

실제 browser source는 TypeScript를 실행하지 않으므로 plain object로 구현한다.
위 type은 계약 설명용이다.

### 9.2 DOM 구조

목표:

```text
aside.logic-inspector-drawer
├─ header.logic-inspector-header
│  ├─ eyebrow
│  ├─ h2
│  ├─ subtitle
│  ├─ persistent announcement
│  └─ close button
└─ div.logic-inspector-scroll
   ├─ section.logic-inspector-guide-mode
   └─ div.logic-inspector-inspect-mode
      ├─ selection panel
      └─ existing tool sections
```

규칙:

- active mode만 `hidden = false`.
- inactive mode는 `hidden = true`.
- drawer가 닫히면 drawer에 `aria-hidden="true"`와 `inert = true`.
- mode section을 CSS opacity만으로 숨기지 않는다.
- mode section의 DOM은 제거하지 않는다.
- Guide scenario 결과와 question selection은 mode switch 후에도 유지한다.

### 9.3 toggle 의미

`Function Guide`와 `Inspector`는 mutually exclusive disclosure다.

| 현재 상태 | 입력 | 결과 |
|---|---|---|
| closed | Function Guide | drawer open + guide mode |
| closed | Inspector | drawer open + inspect mode |
| guide open | Function Guide | drawer close |
| guide open | Inspector | drawer 유지 + inspect mode |
| inspect open | Inspector | drawer close |
| inspect open | Function Guide | drawer 유지 + guide mode |

`aria-expanded`:

- drawer가 guide mode로 보일 때 Guide만 `true`
- drawer가 inspect mode로 보일 때 Inspector만 `true`
- drawer가 닫히면 둘 다 `false`

두 toggle 모두 `aria-pressed`를 사용하지 않는다.

### 9.4 header copy

inspect mode:

| element | text |
|---|---|
| eyebrow | `FUNCTION INSPECTOR` |
| h2 | `Selected Block` |
| subtitle | 현재 selected block label |
| aside label | h2와 subtitle로 구성 |

guide mode:

| element | text |
|---|---|
| eyebrow | `FUNCTION GUIDE` |
| h2 | `Understand This Function` |
| subtitle | `Source-backed static analysis · no code runs` |
| aside label | `Function Guide` |

Guide body에서 기존 `SOURCE-BACKED GUIDE`와 `Understand This Function`을 다시
렌더하지 않는다.

### 9.5 focus 규칙

- Guide/Inspector toggle로 open할 때 toggle focus를 유지한다.
- pointer와 keyboard open 모두 close button으로 자동 이동하지 않는다.
- close button 클릭 또는 Escape는 활성 mode toggle로 focus를 돌린다.
- graph node의 직접 activation은 inspect mode를 연다.
- `Show on Graph`은 guide mode를 유지하며 graph node로 focus를 이동하지 않는다.
- `Load Inputs & Open Values`는 명시적인 handoff이므로 inspect mode로 전환하고
  Values editor의 heading 또는 첫 loaded input으로 focus한다.

### 9.6 scroll 규칙

mode별 scroll을 별도로 저장한다.

전환 순서:

1. 현재 `scroll.scrollTop`을 현재 mode key에 저장한다.
2. inactive section을 hidden 처리한다.
3. next section을 visible 처리한다.
4. animation frame에서 next mode의 저장된 scrollTop을 복원한다.

다음 행동은 guide scroll을 바꾸지 않는다.

- `Show on Graph`
- `Open Source`
- graph attention refresh
- scenario 한 건 계산 완료

`Previous/Next`는 새 chapter heading이 보이도록 최소한의 nearest scroll만 허용한다.

### 9.7 Inspector session lifecycle

현재 module-global 단일 `functionLogicInspectorSessionKey/open` 조합은 여러 attached
function graph가 동시에 존재할 때 마지막 생성 instance의 상태가 다른 instance에
영향을 줄 수 있다.

다음 bounded registry로 바꾼다.

```js
const functionLogicInspectorStateBySession = new Map();
const MAX_FUNCTION_LOGIC_INSPECTOR_SESSIONS = 16;
```

규칙:

- key는 기존 `choiceSessionKey`.
- 같은 session key의 graph relayout은 `open`, `mode`, mode별 scroll을 복원한다.
- 처음 보는 session key는 기존 기준을 유지한다.
  - `min-width: 1040px`: inspect mode open
  - 그보다 좁음: closed, last mode는 inspect
- 다른 함수/session에서 Guide mode를 자동으로 열지 않는다.
- user action으로 state를 바꿀 때 registry를 갱신한다.
- 16개를 넘으면 insertion order상 가장 오래된 key를 반복문으로 제거한다.
- 재귀나 unbounded map을 사용하지 않는다.

Guide chapter/scenario state는 mounted panel 안에서 close/open과 mode switch 동안
보존한다. 새 tutor fingerprint로 새 panel이 만들어지면 초기화한다. 이 UI 개선에서
서로 다른 fingerprint 사이의 scenario result cache는 추가하지 않는다.

---

## 10. Function Guide state model

### 10.1 상태 구조

```ts
type FunctionGuideScenarioPhase =
  | "idle"
  | "running"
  | "paused"
  | "complete"
  | "complete-with-errors"
  | "error";

type FunctionGuideState = {
  active: boolean;
  disposed: boolean;
  selectedChapterIndex: number;
  selectedSeedId?: string;
  selectedPathIndex: number;
  overviewExpanded: boolean;
  scenariosExpanded: boolean;
  limitsExpanded: boolean;
  expandedFactChapterIds: Set<string>;
  scenario: {
    phase: FunctionGuideScenarioPhase;
    generation: number;
    nextSeedIndex: number;
    completedCount: number;
    errorCount: number;
    resultsBySeed: Map<string, FunctionTutorScenarioPathPayload[]>;
    errorsBySeed: Map<string, string>;
  };
};
```

실제 generated browser JS에서는 plain object, `Map`, `Set`으로 구현한다.

### 10.2 초기화

1. `chapters`에서 `tutor.guide.initialChapterId`와 같은 ID를 찾는다.
2. 찾으면 해당 index를 선택한다.
3. 찾지 못하면 첫 chapter를 선택한다.
4. seed가 있으면 첫 seed ID를 저장하지만 계산은 하지 않는다.
5. `overviewExpanded = true`
6. `scenariosExpanded = false`
7. `scenario.phase = "idle"`
8. result/error map은 비운다.

### 10.3 state 불변 조건

- selectedChapterIndex는 `0 <= index < chapters.length`.
- chapter가 없으면 0으로 두되 chapter region은 empty state를 렌더한다.
- selectedSeedId는 현재 tutor seed 중 하나이거나 undefined다.
- selectedPathIndex는 selected result path 범위를 벗어나면 0이다.
- result와 error map에 같은 seed ID를 동시에 두지 않는다.
- `completedCount = resultsBySeed.size + errorsBySeed.size`.
- `nextSeedIndex`는 이미 완료된 seed를 건너뛴다.
- disposed state에서는 timer가 DOM/callback을 갱신하지 않는다.

### 10.4 question selection

question 선택은:

- selectedChapterIndex 갱신
- question nav의 `aria-current`/tabIndex 갱신
- chapter body만 교체
- 해당 chapter의 guide attention 적용

question 선택은 하지 않음:

- lens 변경
- graph selection 변경
- viewport reveal
- branch/value/playback 변경
- scenario selected case/path reset

선택 chapter에 graph evidence가 없으면 empty guide attention을 보내 기존 Guide
attention을 clear한다.

### 10.5 active/deactive

`activate()`:

- `active = true`
- section visible
- scenario disclosure가 open이고 계산이 미완료면 resume

`deactivate()`:

- `active = false`
- running scenario를 paused로 변경
- guide/scenario attention clear
- chapter, disclosure, result는 유지

`dispose()`:

- `disposed = true`
- generation 증가
- timer의 다음 작업 중단
- callback 호출 중단

---

## 11. stable DOM 구현 계약

### 11.1 한 번만 만드는 shell

panel 생성 시 한 번만 만든다.

- Guide intro
- availability region
- At a Glance details/summary/content
- question navigation heading/list/buttons
- chapter region container
- persistent live status
- Static Input Cases details/summary/body
- Unknowns & Limits details/summary/body

금지:

- state event마다 `clearElement(content)`
- 계산 case마다 전체 table 재생성
- details toggle handler 안에서 해당 details 교체

### 11.2 region별 update

| state change | 갱신 허용 영역 |
|---|---|
| question change | nav attributes + chapter region |
| Show on Graph | persistent status text |
| scenario open | scenario phase/progress/body |
| seed calculated | 해당 row outcome + progress + selected detail |
| scenario selection | row attributes + selected detail |
| path selection | selected detail transition table |
| availability | availability region |

### 11.3 element identity test

test runtime에서 다음 ID를 비교한다.

- selected question button의 generated element ID
- Static Input Cases summary ID
- persistent live status ID
- scenario row button ID

관련 없는 state update 전후에 동일해야 한다.

### 11.4 panel-scoped ID

module browser source에 sequence를 둔다.

```js
let functionTutorPanelSequence = 0;
```

panel 생성 때 증가시키고 다음 ID를 만든다.

```text
logic-function-guide-<sequence>
logic-function-guide-<sequence>-chapter
logic-function-guide-<sequence>-status
logic-function-guide-<sequence>-path
logic-function-guide-<sequence>-scenarios
```

`functionId` 문자열만으로 DOM ID를 만들지 않는다.

두 panel이 동시에 있을 때 모든 ID가 유일해야 한다.

---

## 12. At a Glance 개선

### 12.1 표시 항목

항목은 4개로 고정한다.

| term | 값의 source |
|---|---|
| `Role` | architecture layer/confidence 또는 owner fallback |
| `Reached From` | total entrypoint/caller counts |
| `Inside` | structured decision/loop/ending counts |
| `Leads To` | total local/external/unresolved callee counts |

### 12.2 total과 omitted

`Reached From`:

```text
2 entrypoints · 9 direct callers
+3 relations not shown
```

`Leads To`:

```text
3 local · 1 external · 1 unresolved
+2 relations not shown
```

omitted가 0이면 두 번째 줄을 만들지 않는다.

### 12.3 semantic chapter counts

현재 `answer.counts`는 `Record<string, number>`이지만 planner는 `factCount`만 넣는다.
다음 optional key를 명시적인 type으로 추가한다.

```ts
type FunctionTutorGuideChapterCounts = {
  factCount: number;
  parameterCount?: number;
  exactCallsiteTupleCount?: number;
  decisionCount?: number;
  loopCount?: number;
  valueChangeCount?: number;
  effectBlockCount?: number;
  outgoingRelationCount?: number;
  returnCount?: number;
  throwCount?: number;
  exitCount?: number;
};
```

수정 위치:

- `src/application/codeFlow/functionTutor/types.ts`
- `src/protocol/functionTutor.ts`
- `src/application/codeFlow/functionTutor/functionTutorGuidePlanner.ts`
- 관련 projection tests

payload version은 올리지 않는다.

이유:

- 기존 `counts` object 안에 optional number key를 추가하는 backward-compatible 확장
- source/evidence identity 변화 없음
- Webview가 새 key가 없을 때 fallback 가능

### 12.4 planner count 값

`place`:

```ts
{ factCount: retained.length }
```

`inputs`:

```ts
{
  factCount: retained.length,
  parameterCount: input.declaration.parameters.length,
  exactCallsiteTupleCount
}
```

`decisions`:

```ts
{
  factCount: facts.length,
  decisionCount: branchCount,
  loopCount
}
```

`work`:

```ts
{
  factCount: retained.length,
  valueChangeCount: changeCount,
  effectBlockCount: effectCount,
  outgoingRelationCount: total retained-independent outgoing count
}
```

`outcomes`:

```ts
{
  factCount: retained.length,
  returnCount,
  throwCount,
  exitCount
}
```

### 12.5 fallback

semantic count가 없으면 prose를 parse하지 않는다.

허용 fallback:

```text
3 source-backed structure facts
```

금지 fallback:

- fact 3개를 `3 decisions`라고 부르기
- answer text에서 숫자를 regex로 추출하기

### 12.6 humanized label

architecture layer:

| raw | visible |
|---|---|
| `interface` | `Interface` |
| `application` | `Application` |
| `domain` | `Domain` |
| `dataAccess` | `Data Access` |
| `infrastructure` | `Infrastructure` |
| `crossCutting` | `Cross-Cutting` |
| `test` | `Test` |
| `unclassified` | `Unclassified` |

unknown raw 값은 camelCase를 공백으로 분리하고 첫 글자만 대문자로 표시한다.
분류 의미를 새로 추론하지 않는다.

confidence:

| raw | visible |
|---|---|
| `high` | `High confidence` |
| `medium` | `Medium confidence` |
| `low` | `Low confidence` |
| `unknown` | `Unknown confidence` |

---

## 13. question navigation

### 13.1 semantics

```html
<nav aria-labelledby="<questions-heading-id>">
  <h3 id="<questions-heading-id>">5 Questions</h3>
  <ol>
    <li><button ...>...</button></li>
  </ol>
</nav>
```

selected button:

```html
aria-current="true"
tabindex="0"
aria-controls="<chapter-region-id>"
```

unselected:

```html
aria-current="false"
tabindex="-1"
```

기존 설계와 맞춰 `aria-current="step"`은 사용하지 않는다. runtime step이 아니다.

### 13.2 row content

각 row는 세 영역이다.

```text
ordinal | question | exceptional evidence state
```

ready는 별도 text를 표시하지 않는다.

partial:

```text
Partial evidence
```

unavailable:

```text
No evidence
```

state는 색만으로 전달하지 않는다.

### 13.3 keyboard

- ArrowDown: 다음 question, 마지막에서는 첫 question으로 wrap
- ArrowUp: 이전 question, 첫 question에서는 마지막으로 wrap
- Home: 첫 question
- End: 마지막 question
- Enter/Space: native button click
- Tab: 선택 question button 하나만 tab stop

방향키 이동 시:

1. selected index 갱신
2. chapter region 갱신
3. 새 selected question button focus

### 13.4 pointer

pointer click 시 clicked button identity를 유지한다.
chapter region만 바꾼다.

### 13.5 Previous/Next

고정 문구 대신 목적지를 포함한다.

```text
Previous: Where Does It Fit?
Next: What Changes the Path?
```

첫 chapter에서는 Previous를 렌더하지 않는다.
마지막 chapter에서는 Next를 렌더하지 않는다.
disabled button 두 개를 항상 유지하지 않는다.

click 후 새 chapter h3에 `tabindex="-1"`을 두고 focus한다.

---

## 14. chapter, facts, evidence

### 14.1 chapter hierarchy

순서:

1. heading row
2. deterministic answer
3. `Key Facts`
4. primary actions
5. `Source Basis`
6. Previous/Next

heading row:

```text
What Comes In?        Partial evidence
```

ready chapter는 badge를 만들지 않는다.

### 14.2 answer

현재 description foreground 대신:

- color: `var(--vscode-foreground)`
- size: `var(--logic-font-body)`
- line-height: `1.5`
- margin: `0`
- `text-wrap: pretty`

answer를 callout card나 quote block으로 만들지 않는다.

### 14.3 certainty text

| raw | badge visible text | title |
|---|---|---|
| `exact` | `Exact` | `Direct source evidence` |
| `inferred` | `Inferred` | `Bounded static inference` |
| `unknown` | `Unknown` | `Static evidence is incomplete` |

기존 `.flow-badge.confidence` visual vocabulary를 재사용한다.

- Exact: solid
- Inferred: dashed
- Unknown: dotted
- text 항상 존재

### 14.4 fact 수

main list:

- 0: chapter-specific empty message
- 1~3: 모두 표시
- 4~5: 처음 3개 표시 + native details `More Facts · N`

`More Facts` disclosure는 fact detail을 숨길 뿐 Source Basis를 대체하지 않는다.

### 14.5 fact row

```text
<fact label>               [Exact]
<fact detail>
```

- fact label: foreground, weight 700
- fact detail: descriptionForeground
- code identifier인 label/detail 조각은 가능한 범위에서 `translate="no"`와 editor font
- main fact row에는 `Open Source` button 없음

### 14.6 primary actions

최대 2개:

1. `Show on Graph`
2. `Open First Source`

`Show on Graph`:

- graph target이 있을 때만 렌더
- Guide의 primary action style
- click 후 Guide mode/focus/scroll 유지
- status: `Showing evidence for “<question>” on the function graph.`

graph target이 없으면 disabled button 대신 다음 helper를 표시한다.

```text
No graph location is available for this question.
```

`Open First Source`:

- 가장 먼저 projection된 evidence token이 있을 때만 렌더
- secondary action
- editor navigation 후 Guide state 유지

### 14.7 Source Basis

summary:

```text
Source Basis · 3 facts
```

각 row:

```text
Source documentation · Exact       [Open Source]
Application layer · Inferred       [Open Source]
Owner: OrdersService · Exact       No source location
```

button visible text는 `Open Source`, `aria-label`은
`Open source for <fact label>`로 구체화한다.

evidence token이 없는 fact는 button을 만들지 않고
`No source location` text를 표시한다.

---

## 15. availability, empty, error 상태

### 15.1 Guide availability

ready:

- banner 없음
- provenance text만 header subtitle에 존재

partial:

```text
Partial Guide
Source evidence is limited for 2 of 5 questions. Limited facts remain marked below.
```

unavailable:

```text
Limited Guide
Source-backed context is unavailable for this function. Function Logic remains
available in Inspector.
```

unavailable여도:

- Guide toggle을 숨기지 않는다.
- 5개 question shell을 유지한다.
- available fact가 있으면 표시한다.
- `Unknowns & Limits`를 유지한다.

### 15.2 chapter empty

partial인데 fact가 0이면 data invariant violation이므로 unavailable처럼 렌더한다.

문구:

```text
No source-backed facts are available for this question in the bounded analysis.
Review Unknowns & Limits for the missing evidence.
```

### 15.3 no scenario seed

```text
No safe static input cases were inferred.
Use “What Comes In?” and “Unknowns & Limits” to review the available evidence.
```

### 15.4 per-case error

row outcome:

```text
Could not calculate this case
```

selected detail:

```text
This case could not be calculated within the bounded static interpreter.
Its inferred inputs remain available below.
```

error가 있어도 known inputs load는 허용한다.

### 15.5 all-case error

```text
Static cases could not be calculated. Review the inferred inputs and
Unknowns & Limits; no source code was run.
```

---

## 16. Static Input Cases state machine

### 16.1 transition

```text
idle
  └─ disclosure open
      └─ running
          ├─ all success ────────────────> complete
          ├─ some success/some error ────> complete-with-errors
          ├─ all error ──────────────────> error
          └─ disclosure/Guide close ─────> paused

paused
  ├─ disclosure + Guide active ──────────> running
  └─ new function/dispose ───────────────> discarded
```

### 16.2 queue 구현

재귀를 사용하지 않는다.

`setTimeout(runNext, 0)` 또는 동등한 task yielding은 허용한다. 각 callback에서:

1. disposed 확인
2. generation 확인
3. Guide active 확인
4. scenariosExpanded 확인
5. 다음 미완료 seed를 반복문으로 찾기
6. 한 seed만 계산
7. 해당 row/progress/detail 갱신
8. 다음 timer 예약

close 시 timer handle을 clear할 수 있으면 clear한다. clear하지 못한 callback도
guard에서 즉시 return해야 한다.

### 16.3 pause/resume

pause:

- phase `paused`
- result/error 유지
- nextSeedIndex 유지
- pending row는 `Not calculated yet`로 표시 가능

resume:

- 이미 result/error가 있는 seed 건너뛰기
- 첫 미완료 seed부터 계속
- 중복 계산 금지

### 16.4 progress

visible:

```text
3 of 12 cases calculated
```

live announcement:

- start: `Calculating 12 static cases.`
- 4건마다: `4 of 12 static cases calculated.`
- final success: `12 static cases are ready.`
- final partial: `11 static cases are ready; 1 could not be calculated.`
- all error: `Static cases could not be calculated.`

매 case마다 live region을 갱신하지 않는다.

scenario body:

```html
aria-busy="true"  // running
aria-busy="false" // otherwise
```

### 16.5 case list table

columns:

1. `Case`
2. `Possible Outcome`

case row header 안에 button:

```html
aria-current="true|false"
tabindex="0|-1"
```

button content:

```text
Default amount
Exact
```

outcome:

- pending: `Calculating…`
- paused and not started: `Not calculated yet`
- error: `Could not calculate`
- return: `May return <value>`
- throw: `May throw <value or type>`
- other terminal: humanized possible terminal
- limited: append visible `Bounded`

### 16.6 case keyboard

- ArrowDown: next
- ArrowUp: previous
- Home: first
- End: last
- no wrap for case list
- selected row preview는 guide attention만 갱신
- lens/selection/viewport는 변경하지 않음

### 16.7 selected case detail

selected detail은 table 아래 full width다.

구조:

1. h4 `Selected Case`
2. case title + certainty
3. input definition list
4. path selector if path > 1
5. possible-static disclaimer
6. `Load Inputs & Open Values`
7. transition table

input:

```text
amount    10       Exact
context   Unknown  Unknown
```

unknown reason이 bounded text로 있으면 selected detail에서 표시한다.

### 16.8 path select

- ID는 panel-scoped
- label `Possible Path`
- option `Path 1 of 3`, `Path 2 of 3 · Bounded`
- explicit foreground/background/border
- path 변경은 selected detail만 update
- select identity는 유지하고 transition body만 교체

### 16.9 transition table

4열 Before/After 구조를 3열로 바꾼다.

```text
Value | Possible Change | Evidence
```

Possible Change:

```text
10 → 15
Unknown → "ready"
```

화살표만 의미가 되지 않도록 column heading `Possible Change`를 유지한다.

모든 certainty는 Evidence cell에 text badge로 표시한다.

---

## 17. Values handoff

### 17.1 action copy

현재:

```text
Load Inputs into Values
```

개선:

```text
Load Inputs & Open Values
```

이 문구는 value를 쓰는 것뿐 아니라 Inspector mode가 전환됨을 미리 알린다.

### 17.2 실행 순서

1. selected seed의 input을 순회한다.
2. `unknown`은 쓰지 않는다.
3. 기존 parameter name/binding mapping으로 manual Values map에 쓴다.
4. loaded/skipped count를 계산한다.
5. Values lens로 전환한다.
6. value rendering을 refresh한다.
7. Guide를 deactivate하되 state/result는 유지한다.
8. Inspector를 inspect mode로 연다.
9. Values editor가 보이도록 reveal한다.
10. 첫 loaded input 또는 Values editor heading에 focus한다.
11. Values editor의 persistent status에 결과를 표시한다.

### 17.3 success copy

all known:

```text
Loaded 2 inputs from Static Input Cases.
```

unknown skipped:

```text
Loaded 2 known inputs; skipped 1 unknown input.
```

none known:

- action disabled
- helper: `All inferred inputs are unknown.`

### 17.4 필요한 adapter API

`createFunctionTutorIntegration`이 Inspector를 받도록 변경한다.

목표 signature:

```js
createFunctionTutorIntegration(
  logic,
  comprehension,
  valueFlowRendering,
  viewportController,
  inspector
)
```

`valueFlowRendering`에 다음 capability를 추가한다.

```js
revealValueEditor(options) {
  // status text 적용
  // first loaded input 또는 heading focus
}
```

구체적인 source range나 VS Code API를 Guide가 직접 다루지 않는다.

---

## 18. graph interaction 계약

### 18.1 question 선택

허용:

- `comprehension.setGuideFocus`

금지:

- `setLens`
- `activateBlock`
- `viewport.revealBlocks`

### 18.2 Show on Graph

순서:

1. preferred lens 설정
2. primary block을 focus 이동 없이 activate
3. guide attention 적용
4. attention block을 bounded reveal
5. Guide status 갱신

다음 상태를 바꾸지 않는다.

- branch choice
- manual Values
- playback position
- scenario selected seed/path
- Guide scroll
- keyboard focus

### 18.3 scenario row 선택

- scenario path block/edge를 guide focus에 적용
- lens/selection/viewport 변경 없음
- Guide mode 유지

### 18.4 graph node 직접 선택

사용자가 graph node를 직접 click/keyboard activate하면:

- graph selection 변경
- inspect mode open
- Guide state 보존
- Guide attention clear
- graph node focus 동작 유지

이것은 사용자가 Guide에서 selected-block inspection으로 명시적으로 이동한 것으로
간주한다.

### 18.5 Guide close

- guide attention clear
- scenario preview clear
- scenario running이면 pause
- branch/value/playback/viewport/selection 유지
- selected chapter/seed/path/result 유지

---

## 19. 접근성 계약

### 19.1 semantic structure

| UI | element |
|---|---|
| drawer | `<aside aria-labelledby>` |
| drawer title | `<h2>` |
| intro/availability | `<p>` 또는 labeled region |
| At a Glance | `<details>` + `<dl>` |
| questions | `<nav>` + `<h3>` + `<ol>` + `<button>` |
| chapter | `<section aria-labelledby>` + `<h3>` |
| facts | `<ul>` |
| Source Basis | `<details>` + `<ul>` |
| scenarios | `<details>` + `<table>` |
| selected input | `<dl>` |
| transitions | `<table>` |
| limits | `<details>` + `<ul>` |
| action | `<button>` |
| async status | persistent `role="status"` |

### 19.2 heading hierarchy

- drawer h2
- body section h3
- selected scenario/detail h4
- heading level을 CSS를 위해 건너뛰지 않는다.

### 19.3 full keyboard route

mouse 없이:

1. `Read` group
2. Function Guide
3. At a Glance summary
4. selected question button
5. Show on Graph
6. Open First Source
7. More Facts if present
8. Source Basis
9. Source Basis source buttons
10. Previous/Next
11. Static Input Cases
12. selected case row
13. path select
14. Load Inputs & Open Values
15. Unknowns & Limits
16. close

question/case roving tab stop 덕분에 모든 item이 Tab 순서에 들어가지 않는다.

### 19.4 focus-visible

다음 모두 visible focus가 있어야 한다.

- Guide/Inspector toggle
- close
- details summary
- question
- primary/secondary/source action
- case row
- path select
- Values target

기본:

```css
outline: 1px solid var(--vscode-focusBorder);
outline-offset: 1px;
```

forced colors:

```css
outline: 2px solid Highlight;
```

### 19.5 status

- static provenance를 live region에 두지 않는다.
- live region은 persistent node다.
- `aria-atomic="true"`.
- scenario progress는 지나치게 자주 announce하지 않는다.
- error message는 다음 행동을 포함한다.

### 19.6 color-independent state

- selected: background + left border/outline + `aria-current`
- inferred: text + dashed border
- unknown: text + dotted border
- partial/unavailable: visible text
- error: visible text

### 19.7 reflow와 zoom

정식 WCAG 적합성을 이번 작업에서 선언하지 않는다. 그러나 다음을 구현 gate로
사용한다.

- 200% zoom
- 280px Guide container
- page-level horizontal scroll 0
- hidden certainty 0
- clipped focus outline 0

### 19.8 code/identifier

- code-shaped value는 editor font
- 가능한 요소에 `translate="no"`
- long identifier는 `overflow-wrap: anywhere`
- 의미 있는 source text를 ellipsis로만 숨기지 않는다.

---

## 20. responsive 계약

### 20.1 container query

Guide 자체:

```css
.logic-function-guide {
  container-type: inline-size;
}
```

viewport media query만 사용하지 않는다. 실제 Guide 폭은 Webview viewport가 아니라
Inspector column에 의해 결정된다.

### 20.2 기본값

기본 CSS는 가장 좁은 280px에서도 동작하는 single column이다.

- overview 1열
- actions wrap
- case table 2열
- selected detail full width
- transition table 3열

### 20.3 `@container (min-width: 340px)`

- overview dl을 `max-content minmax(0, 1fr)` 두 열로 변경
- chapter action을 inline wrap
- question state text를 오른쪽 column에 둠

### 20.4 `@container (max-width: 339px)`

- overview term/value 수직
- primary action은 width 100%
- secondary source action은 content width
- question row는 ordinal + content의 2열
- exceptional state는 question 아래
- cell padding 4px

### 20.5 fallback

container query 미지원 시 좁은 기본값이 읽혀야 한다.
기존 `@media (max-width: 520px)`는 page viewport fallback으로만 남길 수 있다.

### 20.6 금지

- `nth-child(4) { display:none }`
- whole Guide의 `overflow-x:auto`
- fixed pixel width table
- nowrap identifier
- action label 축약
- horizontal card carousel

---

## 21. visual token과 CSS 계약

### 21.1 typography

| 역할 | token |
|---|---|
| drawer h2 | `--logic-font-large` |
| section h3 | `--logic-font-body` |
| main answer | `--logic-font-body` |
| body/detail | `--logic-font-small` |
| metadata | `--logic-font-tiny` |
| code/value | `--logic-code-small` 또는 `--logic-code-body` |

### 21.2 spacing

기존 dense tool 간격을 유지한다.

| 관계 | 값 |
|---|---:|
| inline metadata | 2~3px |
| row inner gap | 4px |
| related controls | 6px |
| section internal | 8px |
| major section | 10~12px |

### 21.3 button hierarchy

primary:

- `Show on Graph`
- `Load Inputs & Open Values`

token:

- foreground: `--vscode-button-foreground`
- background: `--vscode-button-background`
- hover: `--vscode-button-hoverBackground`

secondary:

- `Open First Source`
- Previous/Next

token:

- secondary foreground/background/border

source basis row:

- text/link-like button
- `--vscode-textLink-foreground`
- transparent background
- hover underline 또는 list hover

### 21.4 target size

desktop:

- 최소 높이 26px

`@media (pointer: coarse)`:

- Guide toggle/action/question/case/summary hit area 최소 44px
- close button 44×44px

VS Code desktop density는 유지하되 coarse pointer에서만 확대한다.

### 21.5 selected state

selected question/case:

- active selection background
- active selection foreground
- 2px left indicator 또는 inset outline
- `aria-current`

색만으로 선택을 전달하지 않는다.

### 21.6 forced colors

- 모든 button/details/table boundary는 `CanvasText`
- selected outline은 `Highlight`
- active text는 `HighlightText`가 필요한 경우 사용
- certainty border style 유지

### 21.7 motion

- 새 question/scenario animation 없음
- drawer 기존 transform/opacity만 유지
- `prefers-reduced-motion`에서 drawer transition 제거
- loading spinner 추가 금지
- `transition: all` 금지

---

## 22. 모든 UI 상태 matrix

| 영역 | 상태 | visible 요구 |
|---|---|---|
| drawer | closed | drawer hidden/inert, both toggles false |
| drawer | inspect | inspect visible, Guide hidden |
| drawer | guide | Guide visible, inspect hidden |
| Guide | ready | no warning banner |
| Guide | partial | Partial Guide banner |
| Guide | unavailable | Limited Guide banner + usable shell |
| chapter | ready | answer/facts/actions |
| chapter | partial | Partial evidence text |
| chapter | unavailable | empty reason + limits direction |
| chapter | no graph target | helper, no dead Show button |
| chapter | no source | no source button, Source Basis reason |
| facts | 0 | chapter-specific empty |
| facts | 1~3 | all visible |
| facts | 4~5 | 3 visible + More Facts |
| scenarios | closed/idle | no calculation |
| scenarios | open/running | progress + aria-busy |
| scenarios | paused | retained result + pending text |
| scenarios | complete | all outcomes |
| scenarios | partial error | success and error rows |
| scenarios | all error | actionable error |
| scenarios | empty | no-safe-case explanation |
| scenario | selected | aria-current + detail |
| scenario | no known inputs | disabled load + reason |
| scenario | multi-path | labeled unique select |
| transition | empty | no empty table |
| limits | 0 | `No additional static limits were reported.` |
| limits | >0 | bounded list + count |
| text | long | wrap, no page horizontal scroll |
| pointer | coarse | 44px targets |
| media | forced colors | visible boundaries/state |
| media | reduced motion | no transition |

---

## 23. 목표 모듈 구조

현재 `functionTutorGuideBrowserSource.ts` 167줄은 짧지만 여러 책임을 한 줄에 압축해
갖고 있다. 개선 시 한 파일을 700줄까지 늘리지 말고 역할을 분리한다.

목표:

```text
src/webview/codeFlow/tutor/
  index.ts
  functionTutorBrowserSource.ts
  functionTutorIntegrationBrowserSource.ts
  functionTutorStyles.ts
  functionTutorGuideBrowserSource.ts          # public composer only
  functionTutorGuideStyles.ts                 # public style composer only
  guide/
    functionTutorGuideStateBrowserSource.ts   # state, scenario phase, invariants
    functionTutorGuideShellBrowserSource.ts   # stable shell, activate/deactivate
    functionTutorGuideOverviewBrowserSource.ts
    functionTutorGuideChapterBrowserSource.ts
    functionTutorGuideScenarioBrowserSource.ts
    functionTutorGuideFormattingBrowserSource.ts
    functionTutorGuideShellStyles.ts
    functionTutorGuideChapterStyles.ts
    functionTutorGuideScenarioStyles.ts
    index.ts                                  # internal composition exports
```

원칙:

- `tutor/index.ts`의 public export는 유지한다.
- interpreter는 `functionTutorBrowserSource.ts`에 유지한다.
- Guide internal file이 Inspector 내부 파일을 deep import하지 않는다.
- integration adapter만 Guide/Inspector/comprehension/value-flow를 연결한다.
- generated browser helper 선언 순서는 formatter → state → overview/chapter/scenario
  → shell 이어야 한다.

---

## 24. 파일별 정확한 변경 계획

### 24.1 `src/webview/codeFlow/inspector/functionLogicInspectorBrowserSource.ts`

변경:

1. `open boolean`과 active `mode`를 분리한다.
2. `guideModeRegion`, `inspectModeRegion`을 만든다.
3. selection panel과 기존 append section은 inspectModeRegion에 넣는다.
4. mode-aware header updater를 만든다.
5. `registerGuide(panel)` public method를 추가한다.
6. `openInspect()`, `openGuide()`, `close()`, `showInspectSection()`을 추가한다.
7. 기존 `open()`은 direct selected-block action 호환을 위해 `openInspect()` alias로
   남기거나 모든 callsite를 바꾼 뒤 제거한다.
8. mode별 scrollTop 저장/복원을 추가한다.
9. Escape/close focus가 active mode toggle로 돌아가게 한다.
10. close 시 registered Guide `deactivate()`를 호출한다.
11. aside `aria-labelledby`를 mode-aware h2에 연결한다.
12. 단일 global open state를 session-keyed, 최대 16개 bounded registry로 바꾼다.

주석:

- class 책임과 lifecycle
- mode switch의 focus/scroll side effect
- Guide DOM을 제거하지 않는 이유

### 24.2 `src/webview/codeFlow/inspector/functionLogicInspectorStyles.ts`

변경:

- mode region layout
- header h2 margin/font
- mode subtitle wrap
- persistent announcement visually hidden style
- coarse pointer 44px
- forced colors
- 기존 drawer geometry 유지

금지:

- Guide 전용 palette
- active mode opacity-only hiding

### 24.3 `src/webview/codeFlow/presentation/functionLogicGraphHeaderBrowserSource.ts`

변경:

- Guide/Inspector를 `logic-reader-controls` group으로 감싼다.
- visible `Read` label.
- viewport group과 reader group을 controls에 append.
- optional Guide가 없으면 `Read [Inspector]` 유지.
- `append(undefined)` 방어 유지.

### 24.4 `src/webview/codeFlow/viewport/functionLogicViewportBrowserSource.ts`

변경:

- viewport group 안 visible `View` label 추가.
- 기존 `role=group`, aria-label 유지.
- announcement는 visually hidden 상태 유지.

### 24.5 `src/webview/codeFlow/viewport/functionLogicViewportStyles.ts`

변경:

- `.logic-control-group`, `.logic-control-label` 공통 style을 presentation 또는
  viewport style 한 곳에만 정의.
- group 간 8px, 내부 2~3px.
- narrow group wrap.
- label이 button과 분리되어 orphan되지 않게 group 자체를 wrap unit으로 둔다.

### 24.6 `src/webview/codeFlow/functionLogicBrowserSource.ts`

현재:

```js
createFunctionTutorIntegration(
  logic, comprehension, valueFlowRendering, viewportController
)
```

목표:

```js
createFunctionTutorIntegration(
  logic,
  comprehension,
  valueFlowRendering,
  viewportController,
  inspector
)
```

변경:

- tutor panel을 `inspector.appendSections`에 넣지 않는다.
- `inspector.registerGuide(tutorRendering)` 호출.
- 다른 sections만 inspect region에 append.
- direct node selection의 `inspector.open()`은 inspect mode를 연다.
- graph dispose에서 tutor panel `dispose()`를 호출할 경로를 연결한다.

### 24.7 `src/webview/codeFlow/tutor/functionTutorGuideBrowserSource.ts`

public composer로 축소한다.

```ts
export function getFunctionTutorGuideBrowserSource(): string {
  return `
    ${getFunctionTutorGuideFormattingBrowserSource()}
    ${getFunctionTutorGuideStateBrowserSource()}
    ${getFunctionTutorGuideOverviewBrowserSource()}
    ${getFunctionTutorGuideChapterBrowserSource()}
    ${getFunctionTutorGuideScenarioBrowserSource()}
    ${getFunctionTutorGuideShellBrowserSource()}
  `;
}
```

직접 큰 renderer를 두지 않는다.

### 24.8 `guide/functionTutorGuideStateBrowserSource.ts`

포함:

- initial chapter resolve
- scenario phase object
- next unfinished seed lookup
- pause/resume/dispose guards
- selected seed/path normalization
- progress count

DOM을 생성하지 않는다.

### 24.9 `guide/functionTutorGuideShellBrowserSource.ts`

포함:

- panel-scoped ID
- stable shell 생성
- Guide intro/availability
- subview mount
- activate/deactivate/dispose
- question event coordination
- persistent live status
- public panel surface

return:

```js
{
  section,
  toggle,
  activate,
  deactivate,
  dispose,
  getState
}
```

### 24.10 `guide/functionTutorGuideOverviewBrowserSource.ts`

포함:

- 4-row At a Glance
- total/omitted formatting
- structured semantic count fallback
- architecture/confidence humanization 호출

### 24.11 `guide/functionTutorGuideChapterBrowserSource.ts`

포함:

- question nav stable buttons
- chapter region render
- fact limit 3 + More Facts
- certainty badge
- primary actions
- Source Basis
- Previous/Next focus

### 24.12 `guide/functionTutorGuideScenarioBrowserSource.ts`

포함:

- stable details/body
- two-column case table
- roving case keyboard
- state machine scheduling
- progress/aria-busy
- selected detail
- unique path select
- transition table

interpreter 구현을 복사하지 않는다.
기존 `functionTutorRunScenario`만 호출한다.

### 24.13 `guide/functionTutorGuideFormattingBrowserSource.ts`

포함:

- plural
- architecture layer
- confidence
- certainty
- possible outcome
- terminal
- progress
- bounded omitted text

raw source identifier를 의미적으로 추론하지 않는다.

### 24.14 style files

`functionTutorGuideStyles.ts`는 세 style source를 합친다.

- shell
- chapter
- scenario

CSS를 한 줄에 여러 selector/선언으로 압축하지 않는다.
각 selector block을 읽을 수 있게 작성한다.

### 24.15 `src/webview/codeFlow/tutor/functionTutorIntegrationBrowserSource.ts`

변경:

- Inspector argument
- `onGuideFocus`: attention only
- `onShowGraph`: 기존 explicit graph change
- `onLoadInputs`: known write + Values lens + inspect handoff
- close/deactivate: guide attention clear
- cross-feature action side effect 주석

### 24.16 `src/webview/codeFlow/dataFlow/functionLogicDataFlowBrowserSource.ts`

변경:

- Values editor reveal/focus/status용 public adapter 추가
- Guide 내부 state를 알지 않음
- section reference와 editor internal focus target을 value preview adapter에 위임

### 24.17 `src/webview/codeFlow/valuePreview/functionLogicValuePreviewBrowserSource.ts`

변경:

- external loaded-values status를 existing polite status surface에 표시할 API
- first loaded parameter input focus 또는 heading fallback
- heading focus용 `tabindex=-1`
- focus는 explicit Guide load handoff에서만 호출

### 24.18 application/protocol

수정:

- typed chapter counts
- planner semantic counts
- projection spread 유지
- protocol version 2 유지

### 24.19 docs

구현과 함께:

- `DESIGN.md` Function Guide section에 Inspector mode, stable focus, two-column
  scenario, `Load Inputs & Open Values` copy 반영
- `PRODUCT.md`는 제품 의미가 변하지 않으므로 원칙적으로 수정하지 않음
- 실제 SPEC 파일이 저장소에 없으므로 존재하지 않는 `SPEC.md`를 새로 만들지 않음

---

## 25. test 구조 계획

### 25.1 새 test file

`src/test/unit/functionTutorGuideWebview.test.ts`를 만든다.

기존 `codeFlowWebview.test.ts`는 684줄이므로 Function Guide의 상세 interaction을 더
넣지 않는다. 기존 smoke test는 유지하거나 새 test로 옮긴 뒤 최소 smoke만 남긴다.

### 25.2 fixture helper

`src/test/unit/helpers/functionTutorGuideFixtures.ts`

builder:

```ts
createFunctionTutorGuideFixture(overrides?)
createFunctionTutorGuidePartialFixture()
createFunctionTutorGuideUnavailableFixture()
createFunctionTutorGuideDenseFixture()
createFunctionTutorGuideMultiPathFixture()
```

dense fixture:

- facts 5
- scenarios 12
- gaps 12
- long owner/caller/callee names
- omitted counts
- exact/inferred/unknown 모두
- partial/unavailable chapter
- transition long values

### 25.3 fake DOM runtime 확장

`sidebarWebviewRuntime.ts`에 필요한 최소 기능만 추가한다.

- `querySelector` for rendered class/attribute
- details `.open`
- `.inert`
- `.tabIndex`
- `scrollIntoView` record
- `isConnected`
- `clickByClass`
- `getRenderedElementIdByTitle`
- `getRenderedPropertyByClass`
- `toggleDetailsByTitle(title, open)`
- class/ancestor 내 tabIndex count
- focus target 조회

runtime helper가 Function Guide 전용 selector를 hardcode하지 않게 한다.

### 25.4 P0 regression tests

#### Test 1 — closed Inspector에서 Guide가 보임

1. narrow default로 Inspector closed fixture.
2. Function Guide click.
3. drawer `aria-hidden=false`.
4. Guide `aria-expanded=true`.
5. Inspector `aria-expanded=false`.
6. Guide mode visible.
7. inspect mode hidden.
8. Guide content가 selected block 뒤가 아니라 active region의 유일 content.

#### Test 2 — stable focus

1. Guide open.
2. selected question element ID 저장.
3. ArrowDown.
4. 새 selected question focus 확인.
5. scenario 계산 update.
6. question nav/summary element identity 유지 확인.

#### Test 3 — pause/resume

1. scenarios open.
2. 일부 seed 계산.
3. Guide close.
4. phase paused.
5. reopen.
6. 남은 seed 계산 완료.
7. 성공 seed 중복 호출 없음.

#### Test 4 — certainty not hidden

source/style architecture assertion:

- narrow media/container rule에 certainty `display:none` 없음.
- selected case detail에 certainty formatter 사용.

### 25.5 Inspector mode tests

- Function Guide → Inspector switch
- Inspector → Function Guide switch
- active button 다시 click하면 close
- Escape가 active toggle로 focus return
- close button focus return
- mode별 scrollTop restore
- graph node direct click은 inspect mode
- Show on Graph는 guide mode 유지
- same session relayout state restore
- new session wide/narrow default
- 17번째 session에서 가장 오래된 registry entry 제거
- 다른 session에 Guide mode가 자동 전파되지 않음

### 25.6 question tests

- initialChapterId 반영
- 5개 고정 순서
- `aria-current`
- roving tabIndex
- Up/Down wrap
- Home/End
- pointer click focus identity
- Previous/Next destination label
- Previous/Next heading focus
- question select는 lens/selection/viewport를 변경하지 않음
- Show on Graph만 lens/selection/reveal

### 25.7 overview tests

- total caller/entrypoint 사용
- omitted 표시
- decision/loop/ending semantic counts
- fact count fallback 문구
- raw enum humanization
- zero count 문구
- unclassified/unknown

### 25.8 chapter/evidence tests

- answer hierarchy classes
- 3 facts visible + More Facts
- main facts에 source button 없음
- chapter Open First Source 최대 1
- Source Basis에 fact별 source action
- evidence 없는 row reason
- graph target 없는 helper
- partial/unavailable visible text

### 25.9 scenario tests

- closed 시 interpreter 0회
- open 시 시작
- aria-busy
- progress milestone
- row roving keyboard
- selected detail
- pending/paused/error/limited
- multi-path unique select
- 두 panel ID 유일
- known/unknown input display
- 3-column transition
- all success/partial error/all error
- disclosure close pause/reopen resume
- dispose 후 DOM update 없음

### 25.10 Values handoff tests

- known only write
- unknown skip
- status copy
- Values lens
- inspect mode
- Values editor reveal
- focus first loaded/fallback heading
- Guide state preserved on reopen

### 25.11 architecture tests

- 파일 800줄 미만
- public composer/internal boundary
- no circular imports
- no recursion in scenario queue
- no `eval`, `Function`, source execution 추가
- no network
- no raw file path
- no custom font/palette
- no `transition: all`
- no certainty hide

---

## 26. 구현 phase와 gate

각 phase는 앞 phase의 test가 통과한 후 진행한다.

### Phase 0 — baseline과 failing tests

변경:

- 새 fixture helper
- 새 Function Guide Webview test file
- fake DOM 최소 확장
- FG-UI-001/003/004/005를 재현하는 failing test

gate:

- 기존 tests는 계속 통과
- 새 tests가 정확한 현재 결함으로 fail
- snapshot text가 아니라 behavior를 검증

### Phase 1 — Inspector two-mode foundation

변경:

- inspect/guide region
- mode-aware toggles/header/focus/scroll
- `registerGuide`
- graph header Read group

gate:

- closed→guide visible
- mode switch
- Escape/close focus
- 기존 selected block Inspector tests 통과
- graph selection이 inspect mode를 열음

### Phase 2 — stable Guide shell

변경:

- internal guide folder
- stable shell/state
- initialChapterId
- persistent live status
- availability
- no whole-content clear

gate:

- question nav/summary identity 유지
- open만으로 scenario 실행 0
- open만으로 graph state 변화 0

### Phase 3 — overview/chapter hierarchy

변경:

- structured counts
- At a Glance total/omitted
- humanized copy
- fact 3 + More Facts
- action hierarchy
- Source Basis dedup

gate:

- undercount 없음
- raw enum visible 없음
- main source action 수 bounded
- partial/unavailable/empty tests

### Phase 4 — scenario controller와 master-detail

변경:

- pause/resume state machine
- two-column case table
- roving case focus
- selected detail
- unique path ID
- 3-column transition table
- progress/aria-busy/live milestone

gate:

- scenario lifecycle 전체 test
- close/reopen resume
- certainty information loss 0
- duplicate ID 0

### Phase 5 — Values handoff

변경:

- integration Inspector argument
- Values reveal/focus/status adapter
- copy `Load Inputs & Open Values`

gate:

- known/unknown write
- explicit mode handoff
- focus가 hidden Guide button에 남지 않음
- Guide state restore

### Phase 6 — CSS/accessibility/responsive

변경:

- readable style split
- container queries
- focus/forced colors/coarse pointer
- header group hierarchy

gate:

- `npm run check`
- relevant unit tests
- style architecture assertions
- detector `[]` 또는 발견 항목 수정

### Phase 7 — docs와 real rendered QA

변경:

- `DESIGN.md`
- 필요 test notes
- browser/VS Code visual fixes

gate:

- 아래 실제 QA matrix 완료
- screenshot/확인 결과 기록
- visual defect 0 또는 명시적 known limitation

---

## 27. 명령과 test gate

Phase별 빠른 gate:

```text
npm run check
npm run compile
node --test out/test/unit/functionTutorGuideWebview.test.js
node --test out/test/unit/codeFlowWebview.test.js
node --test out/test/unit/functionVisualizerWebview.test.js
node --test out/test/unit/functionTutor.test.js
```

최종:

```text
npm test
npm run package:check
```

주의:

- `npm test`는 engine test, clean compile, 모든 unit test, package test를 포함한다.
- compile 전 `out`을 clean하므로 작업 중 임시 산출물을 source로 취급하지 않는다.
- test를 실행하지 못하면 완료로 표시하지 않고 정확한 이유를 남긴다.

detector 재실행:

```text
node /Users/lky/.agents/skills/impeccable/scripts/detect.mjs --json \
  src/webview/codeFlow/tutor \
  src/webview/codeFlow/inspector \
  src/webview/codeFlow/presentation
```

detector가 clean이어도 actual rendered QA를 생략하지 않는다.

---

## 28. 실제 브라우저/VS Code QA

### 28.1 도구 조건

이번 계획 작성 세션에서는 browser가 없었다.

구현 완료 세션에서는:

1. in-app browser 또는 연결된 browser가 있으면 실제 Webview를 사용한다.
2. 사용자의 OS focus를 빼앗지 않는 headless/기존 연결 경로를 우선한다.
3. GUI만 가능하고 focus를 가져와야 한다면 임의로 실행하지 말고 limitation을
   기록하거나 사용자 승인을 받는다.
4. 단순 HTML mock만 보고 VS Code Webview QA를 대체하지 않는다.

### 28.2 fixture

최소:

- documented TypeScript function
- 5 facts
- 12 scenarios
- partial evidence
- unavailable chapter
- long qualified caller/callee
- omitted inbound/outbound
- multi-path transition
- unknown input
- scenario error

### 28.3 viewport

확인:

- Webview `390 × 844`
- Webview `768 × 1024`
- Webview `1440 × 900`
- actual Inspector content width `280px`
- `320px`
- `390px`
- 200% zoom

### 28.4 themes/media

- VS Code Default Dark
- VS Code Default Light
- High Contrast Dark
- High Contrast Light 가능 시
- forced colors emulation 가능 시
- reduced motion
- coarse pointer emulation 가능 시

### 28.5 functional path

1. Inspector를 닫는다.
2. Function Guide를 누른다.
3. drawer와 Guide가 즉시 보이는지 확인한다.
4. graph viewport/lens/branch/value/playback이 그대로인지 확인한다.
5. At a Glance total/omitted를 읽는다.
6. 5개 question을 pointer로 이동한다.
7. keyboard Arrow/Home/End로 이동한다.
8. focus가 사라지지 않는지 확인한다.
9. Source Basis를 열고 source action을 사용한다.
10. Show on Graph을 사용한다.
11. Guide focus/scroll 유지 확인.
12. Static Input Cases를 연다.
13. 계산 중 닫았다 다시 열어 resume 확인.
14. case keyboard 이동.
15. multi-path 변경.
16. unknown/error/limited 확인.
17. Load Inputs & Open Values.
18. inspect mode/Values/focus/status 확인.
19. Function Guide 재open 후 chapter/scenario state 확인.
20. graph node 직접 click 후 inspect mode 확인.
21. Escape/close focus return 확인.

### 28.6 visual checks

- graph가 여전히 주 시각화
- drawer header가 active mode와 일치
- Guide button 목적이 header group과 결과 화면으로 즉시 이해됨
- At a Glance가 card dashboard처럼 보이지 않음
- selected question이 과도한 색 없이 분명함
- answer가 metadata보다 높은 대비
- exact/inferred/unknown이 text와 border로 구분
- source button 중복 노이즈 감소
- case/outcome 비교 가능
- certainty가 어느 폭에서도 사라지지 않음
- page horizontal scroll 없음
- focus outline clipping 없음
- long text가 control을 밀어내지 않음
- coarse pointer target 겹침 없음

### 28.7 console

- uncaught exception 0
- CSP error 0
- network request 0
- duplicate ID warning 0
- detached timer/listener 문제 0

### 28.8 결과 기록

최종 handoff에 다음을 남긴다.

- 실제 확인한 route/command
- 확인한 viewport
- 확인한 theme
- 수행한 interaction
- 수정한 visual defect
- 남은 limitation

확인하지 않은 항목을 확인했다고 쓰지 않는다.

---

## 29. 위험과 고정 대응

### 위험 1 — mode refactor가 기존 Inspector를 숨김

대응:

- Phase 1에서 Guide 내용보다 먼저 mode container만 도입
- existing selected block/Values/calls tests 유지
- inactive DOM 제거 금지

### 위험 2 — Guide open이 graph resize를 유발

Inspector drawer open 자체는 기존처럼 graph viewport width를 바꿀 수 있다.
이는 drawer disclosure의 기존 결과다.

그러나 금지:

- Guide가 추가로 pan/zoom
- question selection이 reveal

viewport resize 시 기존 center-preserving controller 계약을 유지한다.

### 위험 3 — question automatic attention이 Show on Graph과 혼동

대응:

- question selection은 opacity/attention만
- Show on Graph은 lens/selection/reveal
- button copy와 status로 명시
- tests에서 두 path 분리

### 위험 4 — mode switch가 Values handoff focus를 잃음

대응:

- Guide button을 hidden 처리하기 전에 destination 결정
- next frame에 Values target focus
- target 없으면 Values section heading fallback

### 위험 5 — timer가 detached DOM을 갱신

대응:

- dispose flag
- generation
- active/scenariosExpanded guard
- timer handle
- graph dispose integration

### 위험 6 — semantic count가 payload를 깨뜨림

대응:

- optional numeric key
- payload version 유지
- projector spread
- bounded count only
- payload size test 유지

### 위험 7 — header group label로 좁은 폭이 더 복잡해짐

대응:

- group 단위 wrap
- label은 tiny font
- icon 추가 없음
- 320/390/200% actual QA

### 위험 8 — More Facts와 Source Basis가 disclosure 중첩

대응:

- More Facts는 4개 이상일 때만
- Source Basis는 evidence navigation 역할
- 둘의 label/copy를 명확히 구분
- 실제 QA에서 과도하면 fact 5개 모두 노출로 되돌리되 source action dedup은 유지

마지막 항목만 visual QA 결과에 따라 허용되는 조정이다. 다른 interaction 계약은
재설계하지 않는다.

---

## 30. 구현하지 말아야 할 세부 항목

- Guide 내부 sticky header 추가
- question dropdown으로 5개 질문 숨기기
- five-step progress bar
- completion checkmark/gamification
- source fact마다 card
- scenario chart
- certainty color-only dot
- spinner
- skeleton shimmer
- auto-scroll graph
- question마다 animated graph transition
- Guide open 시 첫 question으로 focus 강제 이동
- Guide open 시 first scenario 계산
- scenario row 전체를 `<div onclick>`으로 구현
- disabled button에 tooltip만으로 이유 전달
- fixed `logic-guide-path` ID
- `display:none` certainty
- answer prose에서 count parsing
- source path를 Webview에 전달
- `innerHTML`로 analyzer text 삽입

---

## 31. Definition of Done

### 31.1 P0

- [ ] 닫힌 Inspector에서 Function Guide click 시 Guide가 즉시 보인다.
- [ ] Guide가 selected block 아래 fold에서 열리지 않는다.
- [ ] question/scenario update가 stable interactive DOM identity를 보존한다.
- [ ] keyboard focus가 rerender 때문에 body로 떨어지지 않는다.
- [ ] scenario close/reopen이 pause/resume된다.
- [ ] 좁은 폭에서도 certainty가 모두 보인다.

### 31.2 목적과 인지 부담

- [ ] graph header가 Show/View/Read로 chunking된다.
- [ ] Function Guide와 Inspector mode가 한눈에 구분된다.
- [ ] drawer header가 active mode와 일치한다.
- [ ] answer가 가장 읽기 쉬운 본문 hierarchy다.
- [ ] source action 중복이 제거된다.
- [ ] 5개 질문은 visible이지만 상세는 하나만 보인다.
- [ ] scenario는 case comparison과 selected detail로 분리된다.

### 31.3 정확성과 정직성

- [ ] At a Glance는 total count를 사용한다.
- [ ] omitted count가 보인다.
- [ ] internal shape는 structured count를 사용한다.
- [ ] exact/inferred/unknown text가 항상 보인다.
- [ ] possible static path를 runtime result로 쓰지 않는다.
- [ ] partial/unavailable/error 이유가 보인다.

### 31.4 interaction

- [ ] Guide/Inspector toggle의 aria-expanded가 visible mode와 일치한다.
- [ ] Guide open만으로 lens/selection/viewport/scenario가 바뀌지 않는다.
- [ ] question 선택은 guide attention만 갱신한다.
- [ ] Show on Graph만 explicit graph handoff를 한다.
- [ ] graph node 직접 선택은 inspect mode로 전환한다.
- [ ] Load Inputs & Open Values는 known input만 쓰고 Values로 이동한다.
- [ ] mode별 scroll과 Guide state가 보존된다.

### 31.5 accessibility

- [ ] semantic heading/nav/ol/button/dl/table/details
- [ ] question/case roving tab
- [ ] full keyboard path
- [ ] visible focus
- [ ] persistent live region
- [ ] aria-busy
- [ ] forced colors
- [ ] reduced motion
- [ ] coarse pointer 44px
- [ ] 200% zoom
- [ ] long text

### 31.6 quality

- [ ] 새 source file은 책임별로 분리되고 800줄 미만이다.
- [ ] 주요 file/function/class에 책임 주석이 있다.
- [ ] Guide internal이 Inspector 내부를 deep import하지 않는다.
- [ ] no recursion
- [ ] no source execution/network/LLM
- [ ] `npm run check`
- [ ] relevant unit tests
- [ ] full `npm test`
- [ ] `npm run package:check`
- [ ] detector
- [ ] actual rendered QA

---

## 32. Terra Medium 구현 체크리스트

구현자는 아래 순서를 그대로 따른다.

1. 이 문서와 `DESIGN.md` Function Guide section을 다시 읽는다.
2. dirty worktree를 확인하고 unrelated change를 건드리지 않는다.
3. Phase 0 failing behavior tests를 먼저 만든다.
4. fake DOM helper를 Function Guide에 종속되지 않는 방식으로 확장한다.
5. Inspector에 inspect/guide region을 추가한다.
6. 두 toggle의 상태표를 그대로 구현한다.
7. close/Escape focus와 mode별 scroll을 구현한다.
8. Function Guide를 Inspector append section에서 제거하고 `registerGuide`로 연결한다.
9. Guide renderer를 internal module로 분리한다.
10. stable shell을 먼저 만든다.
11. `initialChapterId`를 적용한다.
12. whole-content rerender를 제거한다.
13. question nav와 chapter region update를 분리한다.
14. persistent status/provenance를 분리한다.
15. typed semantic count를 추가한다.
16. At a Glance total/omitted/fallback을 구현한다.
17. fact/action/Source Basis 중복을 제거한다.
18. scenario state machine을 구현한다.
19. two-column case table과 selected detail을 구현한다.
20. unique panel/path ID를 구현한다.
21. Values explicit handoff를 구현한다.
22. CSS를 shell/chapter/scenario로 분리한다.
23. container query와 no-hidden-certainty를 구현한다.
24. ready/partial/unavailable/calculating/paused/error/empty/dense state test를 채운다.
25. `npm run check`.
26. relevant compiled unit tests.
27. `npm test`.
28. `npm run package:check`.
29. detector.
30. 실제 VS Code/browser QA.
31. visual defect를 고치고 QA를 한 번 더 반복한다.
32. `DESIGN.md`를 최종 구현과 맞춘다.
33. diff에서 unrelated change, generated artifact, raw path, source execution을 확인한다.
34. 모든 DoD가 참일 때만 완료로 보고한다.

---

## 33. 최종 수용 문장

구현 완료 후 다음 문장이 모두 참이어야 한다.

1. 사용자는 `Read · Function Guide`를 보고 함수 이해용 reading surface임을 예측할
   수 있다.
2. 닫힌 Inspector에서도 Function Guide를 누르면 첫 클릭에 Guide가 보인다.
3. drawer header만 보고 현재 selected block을 보는지 Function Guide를 읽는지 알 수
   있다.
4. Guide를 여는 것만으로 graph와 scenario가 움직이지 않는다.
5. 사용자는 5개 질문을 keyboard와 pointer로 이동하면서 focus를 잃지 않는다.
6. At a Glance는 bounded retained item 수를 total로 가장하지 않는다.
7. 중요한 answer, fact, certainty, source basis의 hierarchy가 분명하다.
8. source action은 검증 가능하지만 main reading flow를 button으로 뒤덮지 않는다.
9. scenario는 좁은 drawer에서도 case/outcome을 비교할 수 있다.
10. exact/inferred/unknown은 어떤 viewport에서도 사라지지 않는다.
11. 계산 중 Guide를 닫았다 다시 열어도 남은 case가 이어서 계산된다.
12. Load Inputs & Open Values는 명시적으로 Values workflow로 handoff한다.
13. 모든 결과가 정적 가능성임을 UI만으로 알 수 있다.
14. no LLM, no token, no network, no source execution 계약이 유지된다.
15. 실제 렌더링 검수까지 끝나야 UI 개선이 완료된다.
