# Function Tutor 코드베이스 이해 업그레이드 구현 계획

> 상태: 구현 완료 — 최종 자동 검증 및 렌더링 검증 기록 포함
>
> 대상 구현자: Terra High 또는 동등한 코딩 에이전트
>
> 대상 제품: Project Analyzer: Code Flow VS Code Extension
>
> 기준 구현: 현재 완료된 Static Function Tutor
>
> 작성 목적: 구현자가 추가 제품 설계나 UI 재해석 없이 이 문서만 따라 기능을
> 수직 슬라이스로 구현하고 검증할 수 있게 한다.
>
> 길이 정책: 이 문서는 구현 명세이므로 줄 수 제한을 적용하지 않는다.

---

## 0. 이 문서가 대체하고 보존하는 것

기존
[`docs/plans/static-function-tutor-implementation-plan.md`](./static-function-tutor-implementation-plan.md)
는 Static Tutor의 최초 구현 기준이다. 해당 계획에서 정의한 다음 기반은 이미
구현되어 있으며 이번 업그레이드에서도 보존한다.

- LLM, 외부 API, network, token 사용 금지
- 사용자 source, `eval`, `new Function`, subprocess 실행 금지
- 타입, default, 정적 callsite tuple, 직접 branch boundary 기반 입력 추론
- bounded scenario seed와 browser-side structured IR interpreter
- exact / inferred / unknown과 source evidence 보존
- `Use These Inputs`를 통한 기존 Values scenario 연동
- Function Logic graph, lens, branch choice, value playback 상태 보존
- opaque block / edge / binding / evidence identity
- 반복 기반 traversal, `visited`, depth / item / payload budget

이번 문서는 기존 기능을 폐기하지 않고 **코드베이스 이해 기능으로 한 단계
확장하는 증분 계획**이다. 다만 다음 기존 UX 결정은 이 문서가 명시적으로
대체한다.

| 기존 결정 | 업그레이드 결정 |
|---|---|
| 상위 버튼 `Tutor` | 상위 버튼 `Function Guide` |
| 패널 제목 `Static Tutor` | eyebrow `SOURCE-BACKED GUIDE`, 제목 `Understand This Function` |
| scenario table이 첫 정보 | 코드베이스 맥락과 5개 읽기 질문이 첫 정보 |
| scenario 선택이 핵심 흐름 | guided question 선택이 핵심 흐름 |
| `Use These Inputs` | `Load Inputs into Values` |
| generic “4 passes” 카드가 별도 하단 섹션 | Function Guide의 5개 질문으로 통합 |
| Tutor evidence가 주로 입력 provenance | 문서, 소유 구조, architecture, caller, entrypoint, callee, block, effect, exit까지 확장 |

기존 계획의 interpreter, static value, scenario 안전 계약과 이 문서가 충돌하면
더 보수적인 계약을 적용한다.

---

## 1. 구현자가 따라야 할 규칙

1. 이 문서에서 “확정”으로 표시한 이름, 구조, 상태, budget을 다시 설계하지 않는다.
2. analyzer, application, protocol, Webview 경계를 우회하지 않는다.
3. raw source path, analyzer-local ID, raw graph node ID를 Webview에 보내지 않는다.
4. UI label이나 이미 렌더링된 문자열을 다시 분석 입력으로 파싱하지 않는다.
5. 함수명, 변수명, 파일명만으로 business purpose를 만들어 내지 않는다.
6. source documentation은 “문서가 이렇게 말한다”는 근거이지, runtime truth가
   아니다.
7. architecture layer와 business candidate는 기존
   `FunctionArchitectureAssessment`만 사용한다. Tutor 전용 이름 heuristic을
   추가하지 않는다.
8. entrypoint는 기존 `SemanticFlowIndex`가 보장하는 HTTP / GraphQL mapping만
   사용한다.
9. caller / callee는 기존 `FunctionIndex`와 graph call edge를 사용한다.
10. graph traversal은 queue / stack / `visited` 기반 반복 구현만 사용한다.
11. 모든 collection과 projection에는 명시적 max count와 omitted count를 둔다.
12. 새 일반 구현 파일은 650줄에서 분리를 검토하고 800줄을 넘기지 않는다.
13. 현재 797줄인 `functionTutorAnalyzer.ts`에는 기능 코드를 더 추가하지 않는다.
14. 기존 dirty worktree의 사용자 변경을 reset, restore, overwrite하지 않는다.
15. 각 phase는 compile과 해당 테스트가 통과한 상태로 끝낸다.
16. 기능 QA와 시각 QA를 별도 gate로 기록한다.
17. 실제 브라우저나 VS Code Webview를 열지 않았다면 시각 검증 완료를 주장하지
    않는다.

---

## 2. 한 문장 제품 정의

**Function Guide는 선택한 함수가 코드베이스에서 어디에 놓이고, 무엇을 입력으로
받고, 어떤 결정과 값 변화를 거쳐, 무엇을 호출하거나 바꾸고, 어떻게 끝날 수
있는지를 source-backed 정적 근거로 안내하는 로컬 코드 읽기 기능이다.**

기존 Static Tutor의 scenario 기능은 이 설명 모델의 “입력과 가능한 결과를
구체적인 사례로 비교하는 도구”로 남는다. 더 이상 Tutor 전체를 대표하지 않는다.

---

## 3. 현재 구현의 한계 진단

### 3.1 제품 의미가 scenario에 과도하게 좁혀져 있다

현재 `FunctionTutorPayload`는 다음 정보에 집중한다.

- parameter
- scenario seed
- bounded program
- evidence
- gap
- scenario coverage count

이 정보는 “이 입력이면 어떤 값이 나올 수 있는가?”에는 답하지만, 낯선 함수에서
사용자가 먼저 묻는 다음 질문에는 직접 답하지 못한다.

- 이 함수는 어느 class / module / file에 속하는가?
- route, handler, service, repository 중 어디에 가까운가?
- 어떤 진입점이나 caller에서 이 함수에 도달하는가?
- 이 함수가 호출하는 내부 함수와 외부 경계는 무엇인가?
- 코드에서 가장 먼저 읽어야 할 결정과 side effect는 무엇인가?
- source documentation은 무엇을 말하는가?
- 어느 source를 열어 답을 검증해야 하는가?

### 3.2 `Tutor` 버튼은 사용 결과를 예측하게 하지 못한다

현재 버튼은 다음 속성을 갖는다.

- text: `Tutor`
- title: `Show static tutor`
- state: `aria-pressed`

문제:

- “무엇을 가르치는가”가 드러나지 않는다.
- scenario 기능인지, chat인지, walkthrough인지 예측하기 어렵다.
- panel을 펼치는 disclosure인데 pressed state로 표현한다.
- 버튼을 눌러야만 generic intro가 보여 가치가 늦게 드러난다.

### 3.3 첫 화면이 코드 이해 순서와 맞지 않는다

현재 panel은 다음 순서다.

1. Static Tutor 제목
2. generic static/no-AI 안내
3. scenario count
4. scenario table
5. 선택 scenario description
6. 값 변화
7. Why these inputs
8. Unknowns & limits

낯선 함수에서는 일반적으로 “코드베이스 위치 → 입력 → 결정 → 수행하는 일 →
종료” 순서가 더 자연스럽다. 현재 UI는 입력 예시를 먼저 요구하여 사용자가
아직 함수 역할을 모르는 상태에서 표를 해석하게 한다.

### 3.4 이미 존재하는 코드베이스 인사이트를 사용하지 않는다

현재 Host에는 이미 다음 재사용 가능한 근거가 있다.

- `CodeFlowInsightCache.functionArchitecture`
- `CodeFlowInsightCache.semanticFlows`
- `ProjectGraph`의 caller / callee call edges
- `FunctionIndex`의 direct relation과 metrics
- `FunctionLogicAnalysis`의 block, decision, value, call, effect, exit
- outer `CodeFlowDetailPayload.origins`
- `FunctionLogicDrillTargetPayload`

Tutor build에는 현재 `ProjectGraph`, declaration, caller source reader만 전달된다.
따라서 코드베이스 역할과 주변 연결을 설명할 수 있는 근거를 활용하지 못한다.

### 3.5 projected evidence가 UI에서 충분히 행동으로 연결되지 않는다

Tutor payload에는 evidence token이 있지만 현재 panel의 `Why These Inputs?`는
source를 직접 여는 구체적인 evidence list가 아니라 source 종류를 설명하는
generic 문장이다.

사용자는 다음 행동을 할 수 있어야 한다.

- caller callsite 열기
- source documentation 열기
- architecture evidence가 나온 정의 열기
- 중요한 condition / mutation / effect block을 graph에서 보기
- return / throw source 열기

### 3.6 실패가 조용히 기능 부재가 된다

Host는 Tutor build 실패를 Function Logic 실패와 격리하지만, 최종 payload에서
Tutor를 생략한다. 사용자는 버튼이 없는 이유를 알 수 없다.

업그레이드에서는 Function Guide 자체가 unavailable payload를 가져야 한다.
scenario 분석이 실패해도 함수 내부 구조와 코드베이스 context가 있으면 partial
guide를 제공한다.

### 3.7 현재 `functionTutorAnalyzer.ts`는 확장 여유가 없다

현재 파일은 797줄이다. documentation, guide evidence, context mapping을 같은
파일에 추가하면 프로젝트 파일 길이 원칙을 즉시 위반한다.

첫 구현 phase는 behavior-preserving 분리여야 한다.

### 3.8 scenario 계산이 기본 guide 진입 비용이 되어서는 안 된다

현재 panel render는 각 seed의 결과를 table을 만들면서 계산한다. 업그레이드
후 기본 화면은 codebase context여야 하므로 scenario interpreter는
`Static Input Cases`를 명시적으로 열 때만 계산해야 한다.

---

## 4. 사용자와 핵심 작업

### 4.1 주 사용자

- 처음 보는 repository에서 함수 하나를 조사하는 개발자
- 오래된 코드에서 함수 역할을 다시 기억해야 하는 개발자
- code review 중 변경 영향과 boundary를 빠르게 확인하는 개발자
- runtime debugger나 AI 설명 없이 source evidence로 이해하려는 개발자

### 4.2 사용자의 시작 상태

- 편집기 cursor 또는 Code Flow Reader에서 한 concrete callable을 선택했다.
- 함수명과 signature만 대략 알고 있을 수 있다.
- 전체 call graph를 읽을 mental context는 아직 없다.
- 정적 분석과 실제 runtime을 구분해야 한다.

### 4.3 성공 상태

Function Guide를 연 뒤 사용자는 다음 문장을 자신의 말로 설명할 수 있어야 한다.

1. “이 함수는 코드베이스의 이 구조 안에 있고, 이 정도 근거로 이 layer로
   분류된다.”
2. “이 entrypoint / caller에서 도달할 수 있다.”
3. “이 입력과 상태가 내부로 들어온다.”
4. “이 결정들이 경로를 나눈다.”
5. “이 값, call, render, event, external boundary가 중요한 일이다.”
6. “이 return / throw / exit가 가능한 끝이다.”
7. “확실하지 않은 부분은 이것이며 source에서 이 위치를 열어 검증할 수 있다.”

### 4.4 기능 성공을 검증하는 질문

QA fixture마다 별도 AI 설명 없이 다음 질문에 UI만으로 답할 수 있어야 한다.

- 이 함수가 속한 class / module은 무엇인가?
- mapped entrypoint가 있는가?
- direct caller는 몇 개인가?
- 가장 중요한 branch 또는 loop는 무엇인가?
- 어떤 value가 바뀌는가?
- 어떤 local / external / unresolved boundary로 나가는가?
- 가능한 종료 종류는 무엇인가?
- 대표 static input case에서 무엇이 달라지는가?
- 어느 설명이 exact이고 어느 설명이 inferred / unknown인가?
- 답을 확인할 source action은 어디에 있는가?

---

## 5. 확정 제품 결정

### 5.1 사용자에게 보이는 이름

| 용도 | 확정 문구 |
|---|---|
| graph header 버튼 | `Function Guide` |
| 버튼 tooltip | `Open a source-backed guide to this function and its codebase context` |
| panel eyebrow | `SOURCE-BACKED GUIDE` |
| panel 제목 | `Understand This Function` |
| panel intro | `Read its codebase role, inputs, decisions, work, and outcomes. Static analysis only; no code is run.` |
| overview 제목 | `At a Glance` |
| guide navigation 제목 | `Read in 5 Questions` |
| chapter evidence | `Source Basis` |
| scenario subsection | `Static Input Cases` |
| scenario copy action | `Load Inputs into Values` |
| limitations | `Unknowns & Limits` |
| graph focus action | `Show on Graph` |
| source action | `Open Source` |

내부 TypeScript 이름은 migration risk를 줄이기 위해 `FunctionTutor*`를 유지한다.
사용자에게 보이는 명칭만 `Function Guide`로 바꾼다.

### 5.2 5개 고정 질문

질문의 순서와 문구는 고정한다.

1. `Where Does It Fit?`
2. `What Comes In?`
3. `What Changes the Path?`
4. `What Does It Change or Call?`
5. `How Can It Finish?`

각 질문은 다음 요소를 갖는다.

- 짧은 deterministic answer
- 1~5개의 source-backed fact
- certainty text
- 관련 graph block / edge
- source evidence action
- unavailable / partial 이유
- 다음 질문 이동

### 5.3 scenario 기능의 위치

- scenario는 삭제하지 않는다.
- scenario는 default chapter가 아니다.
- `What Comes In?`과 `How Can It Finish?`에서
  `Explore Static Input Cases` disclosure로 연다.
- disclosure를 열기 전 interpreter를 실행하지 않는다.
- scenario 결과는 codebase role 설명의 근거로 사용하지 않는다.
- scenario는 runtime example이나 test result로 표현하지 않는다.

### 5.4 Function Guide는 fifth lens가 아니다

- `Flow`, `Values`, `Calls`, `Effects` 4개 lens를 유지한다.
- Guide는 Inspector reading mode다.
- chapter별 `Show on Graph`가 적절한 기존 lens를 선택할 수 있다.
- chapter 선택만으로 lens, branch choice, binding selection을 바꾸지 않는다.
- graph focus는 별도 guide attention state다.

### 5.5 자동 행동 금지

Guide를 여는 순간 다음을 하지 않는다.

- graph pan / zoom
- source editor open
- branch choice 변경
- Values manual input 변경
- value playback 시작
- scenario 계산
- first chapter button으로 focus 이동
- toast 또는 modal 표시

명시적 `Show on Graph`, `Open Source`, `Load Inputs into Values`에서만 대응 행동을
수행한다.

### 5.6 설명의 정직성

허용:

- `Source documentation says …`
- `The current graph contains 3 direct callers.`
- `This function appears in 2 bounded entrypoint flows.`
- `Static structure shows 2 decisions and 1 loop.`
- `This possible input case may return …`
- `Architecture evidence classifies this as Application with medium confidence.`

금지:

- `This function handles orders.` — source doc / framework evidence 없이 이름만으로 생성
- `This branch usually runs.`
- `This function is called 3 times at runtime.`
- `This input returns 25.` — static 가능 경로인데 확정
- `This is pure.` — 현재 purity는 unknown
- `AI explanation`
- `Generated insight`
- `Executed path`

---

## 6. 디자인 방향과 디자인 계약

### 6.1 surface mode

Impeccable 분류는 `Operate + Read`다.

- Operate: graph와 source action으로 사용자가 조사 작업을 수행한다.
- Read: 함수의 구조와 주변 맥락을 단계적으로 이해한다.

브랜드 UI, landing page, onboarding tour가 아니다.

### 6.2 시각 방향

- 기존 VS Code semantic theme, UI font, editor font를 그대로 사용한다.
- 새 palette, custom font, gradient, glow, glass, hero, decorative illustration을
  추가하지 않는다.
- 정보 밀도는 높지만 한 번에 한 질문만 상세하게 보여준다.
- 카드 중첩보다 heading, definition list, divider, ordered navigation을 사용한다.
- color는 semantic state를 보조할 뿐 certainty와 relation은 text로도 표시한다.
- graph가 주 시각화이고 Guide는 구조화된 text alternative이자 navigation layer다.

### 6.3 specialist 조사 결과 적용

`ui-ux-pro-max` 결과에서 채택:

- progressive disclosure
- dense developer-tool layout
- graph에 대한 keyboard-readable text fallback
- visible labels
- reduced motion
- responsive wrapping

다음 자동 추천은 제품 계약과 충돌하므로 채택하지 않는다.

- custom JetBrains Mono / IBM Plex Sans
- 새 slate / green palette
- exaggerated typography
- funnel / marketing CTA 구조
- GSAP / scroll reveal

`web-design-guidelines`에서 구현 gate에 반영:

- disclosure button은 `aria-expanded` + `aria-controls`
- semantic heading / button / table / details 우선
- 모든 interactive element에 visible `:focus-visible`
- async scenario update는 polite live region
- long identifier는 wrapping 또는 bounded overflow
- reduced motion
- `transition: all` 금지
- color-only state 금지

### 6.4 정보 우선순위

1. 함수가 코드베이스에서 차지하는 위치
2. 5개 읽기 질문
3. 선택 질문의 answer와 source basis
4. graph / source로 이동하는 명시적 action
5. static input cases
6. unknowns, omitted facts, budgets

### 6.5 인지 부담 원칙

- 첫 panel에는 모든 caller와 scenario를 동시에 펼치지 않는다.
- count는 방향 감각에 필요한 경우만 보인다.
- “설명”과 “근거”를 분리한다.
- 각 fact는 한 가지 claim만 한다.
- selected chapter만 detail을 펼친다.
- scenario table은 disclosure 안에서 lazy render한다.
- 긴 source documentation은 summary 1개와 `Open Source`만 제공한다.
- 모든 omitted count를 별도 “and N more”로 표현한다.
- unknown을 빈 UI로 표현하지 않고 이유를 한 문장으로 보여준다.

---

## 7. 최종 UI topology

### 7.1 graph header

```text
Control & value flow

Show  [Flow] [Values] [Calls] [Effects]   [-] [80%] [+] [Center] [Fit]
                                            [Function Guide] [Inspector]
```

좁은 폭에서는 controls가 기존처럼 wrap한다. `Function Guide`를 icon-only로
줄이지 않는다. 짧은 `Tutor`로 되돌리지 않는다.

### 7.2 wide Inspector

```text
┌ FUNCTION INSPECTOR ────────────────────────────────┐
│ Selected block                                    │
├───────────────────────────────────────────────────┤
│ SOURCE-BACKED GUIDE                               │
│ Understand This Function                         │
│ Read its codebase role, inputs, decisions, work,  │
│ and outcomes. Static analysis only; no code is run.│
│                                                   │
│ At a Glance                                       │
│ Codebase Role  Application workflow · medium      │
│ Reached From   2 entrypoints · 4 direct callers   │
│ Internal Shape 3 decisions · 1 loop · 2 exits     │
│ Leads To       3 local · 1 external · 1 unresolved│
│                                                   │
│ Read in 5 Questions                               │
│ 1 Where Does It Fit?                    selected  │
│ 2 What Comes In?                                  │
│ 3 What Changes the Path?                          │
│ 4 What Does It Change or Call?                    │
│ 5 How Can It Finish?                              │
│                                                   │
│ Question 1 of 5                                   │
│ Where Does It Fit?                                │
│ Source documentation describes …                  │
│                                                   │
│ • Application layer · medium                      │
│ • POST /orders → OrdersController → this function │
│ • Owned by OrdersService                          │
│                                                   │
│ [Show on Graph]  [Open Source]                    │
│                                                   │
│ Source Basis                                      │
│ ▸ 3 source-backed facts                           │
│                                                   │
│ [Previous Question] [Next Question]               │
│                                                   │
│ ▸ Static Input Cases · 4 cases                    │
│ ▸ Unknowns & Limits · 2                           │
└───────────────────────────────────────────────────┘
```

### 7.3 narrow / stacked Inspector

- At a Glance는 1열 `<dl>`로 유지한다.
- chapter navigation은 항상 vertical list다.
- action은 wrap하고 text label을 유지한다.
- source chain은 horizontal graph가 아니라 vertical relation list로 렌더한다.
- table이 340px보다 좁으면 certainty를 scenario title 아래 text로 옮긴다.
- drawer 내부에서만 overflow하고 Webview 전체 horizontal scroll을 만들지 않는다.
- heading과 identifier는 `overflow-wrap: anywhere`를 사용한다.

### 7.4 코드베이스 context chain

좁은 drawer에서 network graph나 Sankey를 만들지 않는다. 다음 bounded text
relation을 사용한다.

```text
Reached From
POST /orders
  → OrdersController.create
  → OrdersService.place
  → selected function

Leads To
selected function
  → pricing.calculate       local · resolved
  → orders.save             repository · resolved
  → analytics.emit          external · inferred
```

- top inbound chain 최대 3개
- chain당 visible step 최대 6개
- outbound relation 최대 6개
- source action은 relation row에 명시적 button으로 제공
- arrow glyph만으로 relation을 전달하지 않고 `Reached From`, `Leads To`,
  relation text를 함께 제공

---

## 8. interaction contract

### 8.1 guide toggle

DOM:

```html
<button
  type="button"
  class="logic-guide-toggle"
  aria-expanded="false"
  aria-controls="logic-function-guide-<session>"
>
  Function Guide
</button>
```

규칙:

- `aria-pressed`를 사용하지 않는다.
- open하면 `aria-expanded="true"`.
- close하면 Guide section을 `hidden` 처리하고 guide attention을 clear한다.
- pointer click으로 open해도 focus를 panel로 강제 이동하지 않는다.
- keyboard로 close한 경우 focus는 toggle에 유지한다.
- 새 function fingerprint가 오면 open 여부는 제품 공통 preference로 보존하되
  selected chapter와 scenario state는 reset한다.

### 8.2 chapter navigation

- `<ol>` 안에 5개 `<button>`을 사용한다.
- selected item은 `aria-current="step"`이 아니라
  `aria-current="true"`를 사용한다. 이 guide는 runtime step이 아니다.
- Up / Down: 이전 / 다음 question으로 roving focus 이동
- Home / End: 첫 / 마지막 question
- Enter / Space: question 선택
- question 선택은 answer와 guide attention만 갱신한다.
- selected question에 graph block이 없으면 attention을 모두 clear한다.
- `Previous Question`, `Next Question`은 양 끝에서 disabled.
- question list로 어느 단계든 건너뛸 수 있다.

### 8.3 Show on Graph

명시적 action에서만:

1. chapter가 요구하는 lens로 전환한다.
2. primary block을 existing comprehension selection으로 선택한다.
3. guide attention block / edge set을 central state에 적용한다.
4. viewport에서 primary block이 완전히 보이지 않을 때만 bounded reveal을 한다.
5. graph node에 keyboard focus를 이동하지 않는다.
6. Inspector scroll position을 보존한다.
7. status live region에
   `Showing <question> evidence on the function graph`를 알린다.

chapter별 preferred lens:

| chapter | lens |
|---|---|
| Where Does It Fit? | `calls` |
| What Comes In? | `values` |
| What Changes the Path? | `flow` |
| What Does It Change or Call? | fact에 따라 `values`, `calls`, `effects` |
| How Can It Finish? | `effects` |

### 8.4 Open Source

- evidence token이 있는 fact에만 제공한다.
- 기존 `openLogicEvidence` callback을 재사용한다.
- raw file path / range를 browser message에 넣지 않는다.
- 여러 evidence가 있으면 source basis list의 각 row에 action을 제공한다.
- chapter header action은 가장 높은 certainty의 첫 evidence를 연다.
- source를 열어도 guide selection은 유지한다.

### 8.5 Static Input Cases

- disclosure button을 열 때 scenario calculation을 시작한다.
- first case를 먼저 계산하고 나머지는 event-loop에 양보하며 순차 계산한다.
- 계산 중 row outcome은 `Calculating…`.
- generation이 바뀌면 남은 calculation을 취소한다.
- row 선택은 possible path를 guide attention에 전달한다.
- `Load Inputs into Values`는 known input만 복사한다.
- 복사 후 Values lens로 이동하고 value rendering을 refresh한다.
- 복사 성공 status:
  `Loaded 2 known inputs into Values; 1 unknown input was skipped.`
- close 또는 다른 question 선택으로 scenario disclosure가 닫히지는 않는다.

### 8.6 상태 충돌 우선순위

central attention 우선순위:

1. keyboard-focused / selected graph node
2. active value playback hop
3. active Guide chapter 또는 selected static case
4. branch-choice reachable / excluded state
5. lens-related context
6. muted context

Guide는 별도 opacity system을 덧씌우지 않는다. 기존
`data-tutor-attention`을 최종적으로 제거하고 comprehension attention projection에
통합한다.

---

## 9. Function Guide 정적 지식 모델

### 9.1 지식 축

Function Guide는 다음 7개 source-backed 축을 결합한다.

1. `documentation`: source-authored JSDoc / docstring / JavaDoc / doc comment
2. `ownership`: file / module / namespace / class parent chain
3. `architecture`: existing intrinsic layer assessment
4. `inbound`: semantic entrypoint flow와 direct caller
5. `internal`: signature, parameter, decision, loop, value, effect, embedded, exit
6. `outbound`: local, external, unresolved callee
7. `scenario`: bounded input and possible outcome

### 9.2 근거가 없을 때

- documentation 없음:
  `No source documentation was found for this function.`
- architecture unclassified:
  `The current graph does not provide enough intrinsic evidence to classify its architectural layer.`
- semantic entrypoint 없음:
  `No mapped HTTP or GraphQL entrypoint reaches this function in the bounded semantic-flow index.`
- caller 없음:
  `No direct caller is present in the current graph snapshot.`
- callee 없음:
  `No outgoing call target is present in the current graph snapshot.`
- decision 없음:
  `No branch or loop is visible in the bounded function body.`
- value / effect 없음:
  `No classified value change or effect is visible in the bounded function body.`
- exit 없음:
  `No explicit return, throw, or exit block is visible; follow the final transfer.`

이 문구는 “실제로 없다”가 아니라 “현재 bounded snapshot에 보이지 않는다”는
범위를 유지한다.

### 9.3 source documentation 취급

- documentation text는 authored claim으로 표시한다.
- UI prefix는 항상 `Source documentation:`.
- documentation fact는 architecture certainty를 높이지 않는다.
- documentation fact는 call graph relation을 만들지 않는다.
- `@param`, `@returns`, `@throws`는 parameter / outcome fact의 보조 description으로만
  사용한다.
- HTML과 Markdown을 Webview에서 render하지 않는다. plain text로 전달하고
  `textContent`로 렌더한다.

---

## 10. analyzer-side 타입 확장

`src/analyzer/functionTutor/types.ts`에 다음 타입을 추가한다.

```ts
export type FunctionTutorDocumentationKind =
  | "jsdoc"
  | "docstring"
  | "javadoc"
  | "xml-doc"
  | "elixir-doc"
  | "comment";

export type FunctionTutorDocumentationTag = {
  kind: "parameter" | "returns" | "throws" | "remarks";
  parameterName?: string;
  text: string;
};

export type FunctionTutorDocumentationFact = {
  kind: FunctionTutorDocumentationKind;
  summary: string;
  tags: FunctionTutorDocumentationTag[];
  truncated: boolean;
  evidence: FunctionTutorEvidence[];
};
```

`FunctionTutorEvidence["kind"]`에 다음을 추가한다.

```ts
| "source-documentation"
| "source-owner"
| "architecture-layer"
| "semantic-entrypoint"
| "direct-caller"
| "direct-callee"
| "value-change"
| "effect-boundary"
| "terminal"
```

단, architecture / semantic / call relation evidence는 analyzer가 만들지 않고
application context collector가 동일 evidence contract를 재사용한다.

`FunctionTutorDeclarationAnalysis`:

```ts
export type FunctionTutorDeclarationAnalysis = {
  // existing fields
  documentation?: FunctionTutorDocumentationFact;
};
```

### 10.1 documentation budget

```ts
const MAX_DOCUMENTATION_SUMMARY_CHARS = 480;
const MAX_DOCUMENTATION_TAGS = 8;
const MAX_DOCUMENTATION_TAG_CHARS = 180;
const MAX_DOCUMENTATION_SCAN_LINES = 40;
```

- Unicode code point 경계에서 truncate한다.
- trailing `…`를 사용한다.
- whitespace를 single space로 normalize하되 code identifier text는 바꾸지 않는다.
- empty summary와 empty tags면 fact를 반환하지 않는다.
- source range는 실제 comment / docstring 범위다.

---

## 11. documentation adapter 구현

### 11.1 최종 폴더

```text
src/analyzer/functionTutor/
  documentation/
    index.ts
    typescriptTutorDocumentation.ts
    pythonTutorDocumentation.ts
    javaTutorDocumentation.ts
    functionalTutorDocumentation.ts
    functionTutorDocumentationText.ts
```

### 11.2 public API

```ts
export type FunctionTutorDocumentationInput = {
  functionNode: SymbolNode;
  sourceText: string;
  language: FunctionLogicLanguage;
};

export function analyzeFunctionTutorDocumentation(
  input: FunctionTutorDocumentationInput
): FunctionTutorDocumentationFact | undefined;
```

### 11.3 TypeScript / JavaScript

1. 기존 function-like AST node를 사용한다.
2. `ts.getJSDocCommentsAndTags` 또는 node의 JSDoc collection에서 declaration에
   직접 연결된 doc만 읽는다.
3. source file / class-level doc를 함수 doc로 fallback하지 않는다.
4. summary는 JSDoc comment의 첫 non-empty paragraph.
5. `@param`, `@returns` / `@return`, `@throws` / `@exception`, `@remarks`만 읽는다.
6. inline tag는 plain text로 flatten한다.
7. `@deprecated`, `@example`, custom tags는 이번 범위에서 표시하지 않고 omitted
   count를 만들지 않는다.
8. exact comment range를 evidence로 저장한다.

테스트:

- function declaration
- method
- arrow assigned to variable
- overload signature와 implementation
- detached nearby comment를 잘못 연결하지 않음
- HTML-looking content가 text로 보존됨
- long comment budget

### 11.4 Python

1. 선택 함수 body의 첫 logical statement만 검사한다.
2. 첫 statement가 string literal인 경우만 docstring으로 인정한다.
3. indentation scope를 벗어나면 중단한다.
4. triple single / double quote를 지원한다.
5. escaped quote와 multiline range를 보존한다.
6. reStructuredText / Google / NumPy doc sections를 semantic parser로 해석하지
   않는다.
7. 첫 paragraph를 summary로 사용한다.
8. `Args:`, `Returns:`, `Raises:`의 immediate simple rows만 bounded tag로 읽는다.
9. parser가 확실하지 않으면 summary만 반환하거나 gap을 남긴다.

### 11.5 Java

1. selected method / constructor declaration 바로 앞의 `/** … */`만 읽는다.
2. annotation 사이에 있어도 declaration에 attached된 comment만 허용한다.
3. `@param`, `@return`, `@throws`, `@exception`을 지원한다.
4. inline HTML을 plain text로 strip하되 text content는 보존한다.
5. overloaded method는 source range가 일치하는 declaration doc만 사용한다.

### 11.6 F# / OCaml / Elixir

F#:

- declaration 바로 위 연속 `///` line
- XML tag는 plain text

OCaml:

- declaration 바로 위 `(** … *)`
- nested comment는 기존 lexical helper가 안전하게 구분할 수 있을 때만

Elixir:

- selected `def` / `defp`에 바로 preceding `@doc """…"""` 또는 `@doc "…"`
- `@doc false`는 documentation 없음으로 처리

지원 불확실성은 전체 Tutor 실패가 아니라 documentation-only gap이다.

---

## 12. analyzer 파일 분리 선행 작업

현재 `functionTutorAnalyzer.ts`를 behavior-preserving 방식으로 분리한다.

```text
src/analyzer/functionTutor/
  functionTutorAnalyzer.ts               # routing / orchestration, 목표 <180줄
  typescript/
    typescriptTutorDeclaration.ts         # parameter / type facts
    typescriptTutorProgram.ts             # block / operation program
    typescriptTutorConstraints.ts         # direct parameter constraints
    typescriptTutorExpressions.ts         # expression / static value IR
    typescriptTutorSupport.ts             # range / operator / execution helpers
```

분리 규칙:

- public export는 `analyzeFunctionTutorDeclaration` 하나를 유지한다.
- 기존 snapshot / unit output을 변경하지 않는다.
- helper를 UI나 protocol로 export하지 않는다.
- 새로운 순환 import를 만들지 않는다.
- documentation analyzer는 routing layer에서 declaration 결과에 합친다.
- 분리 commit에서 copy, type, runtime behavior 변경을 섞지 않는다.

완료 gate:

- 기존 `functionTutor.test.ts` 모두 통과
- analyzer snapshot 동일
- 각 파일 <650줄 권장, <800줄 필수
- architecture import test 통과

---

## 13. application-side 코드베이스 context 타입

`src/application/codeFlow/functionTutor/types.ts`를 분리한다.

```text
src/application/codeFlow/functionTutor/
  types/
    index.ts
    functionTutorScenarioTypes.ts
    functionTutorContextTypes.ts
    functionTutorGuideTypes.ts
```

### 13.1 ownership

```ts
export type FunctionTutorOwnerFact = {
  nodeId: string;
  kind: "file" | "module" | "namespace" | "class";
  name: string;
  certainty: FunctionTutorCertainty;
  evidence: FunctionTutorEvidence[];
};
```

### 13.2 architecture

```ts
export type FunctionTutorArchitectureFact = {
  layer: ArchitecturalLayer;
  confidence: ArchitecturalLayerConfidence;
  businessLogic: BusinessLogicClassification;
  conflicted: boolean;
  alternatives: ArchitecturalLayer[];
  evidence: Array<{
    summary: string;
    certainty: FunctionTutorCertainty;
  }>;
};
```

mapping:

- architecture high → Tutor exact
- medium / low → Tutor inferred
- unknown → Tutor unknown

`purity`는 payload에 넣지 않는다. 현재 항상 unknown이므로 정보 가치가 없다.

### 13.3 inbound relation

```ts
export type FunctionTutorCallerFact = {
  nodeId: string;
  name: string;
  qualifiedName: string;
  kind: "function" | "method" | "constructor";
  callCount: number;
  certainty: FunctionTutorCertainty;
  evidence: FunctionTutorEvidence[];
};

export type FunctionTutorEntrypointChainFact = {
  id: string;
  kind: "http-route" | "graphql-operation";
  label: string;
  framework: string;
  certainty: FunctionTutorCertainty;
  steps: Array<{
    functionId?: string;
    name: string;
    role: SemanticFlowStepRole;
    resolution: SemanticFlowStepResolution;
    certainty: FunctionTutorCertainty;
  }>;
  evidence: FunctionTutorEvidence[];
};
```

### 13.4 outbound relation

```ts
export type FunctionTutorCalleeFact = {
  nodeId: string;
  name: string;
  kind: "local" | "external" | "unresolved";
  relation: "call" | "render" | "event";
  callCount: number;
  certainty: FunctionTutorCertainty;
  sourceBlockId?: string;
  evidence: FunctionTutorEvidence[];
};
```

### 13.5 codebase context

```ts
export type FunctionTutorCodebaseContext = {
  documentation?: FunctionTutorDocumentationFact;
  owners: FunctionTutorOwnerFact[];
  architecture?: FunctionTutorArchitectureFact;
  entrypoints: FunctionTutorEntrypointChainFact[];
  callers: FunctionTutorCallerFact[];
  callees: FunctionTutorCalleeFact[];
  counts: {
    totalEntrypointCount: number;
    omittedEntrypointCount: number;
    totalCallerCount: number;
    omittedCallerCount: number;
    totalLocalCalleeCount: number;
    totalExternalCalleeCount: number;
    totalUnresolvedCalleeCount: number;
    omittedCalleeCount: number;
  };
  gaps: FunctionTutorGap[];
};
```

---

## 14. 기존 FunctionIndex 재사용

### 14.1 cache 확장

`CodeFlowInsightSnapshot`:

```ts
export type CodeFlowInsightSnapshot = {
  functionArchitecture: FunctionArchitectureIndex;
  semanticFlows: SemanticFlowIndex;
  functionIndex: FunctionIndex;
};
```

`CodeFlowInsightCache.get`에서 immutable graph당 한 번만
`createFunctionIndex(graph, { includeInventoryRows: false })`를 호출한다.

검토 사항:

- `FunctionIndex`가 불필요한 row projection을 크게 만드는 경우
  `createFunctionRelationIndex`를 `src/graph/` public core로 추출하고
  Function Explorer와 Tutor가 함께 사용한다.
- Tutor만을 위한 두 번째 caller / callee grouping 구현을 만들지 않는다.
- performance test에서 cache miss 한 번과 cache hit 재사용을 검증한다.

### 14.2 FunctionTutorBuildInput 확장

```ts
export type FunctionTutorBuildInput = {
  graph: ProjectGraph;
  declaration: FunctionTutorDeclarationAnalysis;
  functionLogic: FunctionLogicAnalysis;
  architectureIndex: FunctionArchitectureIndex;
  semanticFlows: SemanticFlowIndex;
  functionIndex: FunctionIndex;
  readSourceText(filePath: string): Promise<string | undefined>;
};
```

`buildFunctionTutorModel`은 scenario model과 codebase context를 조합한다.

```ts
export type FunctionTutorBuildModel = {
  // existing fields
  context: FunctionTutorCodebaseContext;
  guide: FunctionTutorGuidePlan;
  availability: "ready" | "partial" | "unavailable";
};
```

---

## 15. 코드베이스 context collector

### 15.1 파일

```text
src/application/codeFlow/functionTutor/context/
  index.ts
  functionTutorContextCollector.ts
  functionTutorOwnerCollector.ts
  functionTutorEntrypointCollector.ts
  functionTutorRelationCollector.ts
  functionTutorRelationBlockMatcher.ts
  functionTutorContextRanking.ts
```

### 15.2 public API

```ts
export type CollectFunctionTutorContextInput = {
  graph: ProjectGraph;
  declaration: FunctionTutorDeclarationAnalysis;
  functionLogic: FunctionLogicAnalysis;
  architectureIndex: FunctionArchitectureIndex;
  semanticFlows: SemanticFlowIndex;
  functionIndex: FunctionIndex;
};

export function collectFunctionTutorCodebaseContext(
  input: CollectFunctionTutorContextInput
): FunctionTutorCodebaseContext;
```

모든 처리는 pure / synchronous다. source read는 documentation analyzer와 기존
callsite collector에서 이미 끝난다.

### 15.3 ownership 알고리즘

1. `nodesById` map을 만든다.
2. selected function `parentId`에서 시작한다.
3. queue가 아니라 single parent chain loop를 사용한다.
4. `visited`로 malformed cycle을 차단한다.
5. class / namespace / module / file만 유지한다.
6. workspace / folder는 UI owner chain에서 제외한다.
7. 최대 4개 owner를 안쪽 → 바깥쪽 순서로 저장한다.
8. cycle 또는 depth 초과는 context gap으로 남긴다.

`source-owner` evidence:

- node range가 있으면 exact
- synthetic module / file node이면 source evidence 없이 fact만 유지

### 15.4 architecture 알고리즘

1. `assessmentsByFunctionId.get(selected.id)`.
2. 없으면 architecture fact를 생략하고 gap.
3. `unclassified`도 fact로 보존한다.
4. evidence description 최대 3개.
5. alternatives 최대 3개.
6. conflicted true면 answer에서 단일 layer를 확정하지 않는다.
7. Tutor 전용 layer ranking을 추가하지 않는다.

### 15.5 entrypoint chain 알고리즘

1. `semanticFlows.flows` 중 `steps.some(step.functionId === selected.id)`만 유지.
2. flow의 entrypoint부터 selected function이 처음 나타나는 step까지 자른다.
3. chain이 6 step을 넘으면 entrypoint, selected 앞 4개, selected를 유지하고
   omitted count를 gap에 기록한다.
4. 동일 entrypointUnitId + 동일 selected index chain은 deduplicate.
5. confidence rank:
   - 모든 mapping / call edge가 exact / resolved → exact
   - inferred 하나 이상 → inferred
   - unresolved 포함 → unknown
6. HTTP와 GraphQL을 섞어 generic route로 표현하지 않는다.
7. 최대 4 chain.
8. ranking:
   - exact
   - shorter chain
   - label
   - stable flow ID

### 15.6 caller 알고리즘

1. `functionIndex.callersByNodeId.get(selected.id)`.
2. relation별 edge IDs를 graph edge map으로 resolve.
3. source range가 있는 call edge를 evidence로 보존.
4. aggregate certainty는 weakest confidence.
5. ranking:
   - exact / resolved
   - callCount descending
   - qualifiedName
   - nodeId
6. 최대 6 caller.
7. unresolved source node는 caller fact에 넣지 않고 gap.

`callCount`는 graph에 있는 distinct call edges / callsites 수이며 runtime count가
아니다. UI copy는 `callsite`라는 단어를 쓴다.

### 15.7 callee 알고리즘

1. `functionIndex.calleesByNodeId.get(selected.id)`.
2. local / external / unresolved kind를 보존.
3. call edge range와 `FunctionLogicCallsite`를 range로 match한다.
4. `FunctionLogicCallsite.blockId`가 있으면 우선 사용.
5. 없으면 smallest containing / overlapping Function Logic block을 찾는다.
6. rendered label text를 파싱하여 block을 찾지 않는다.
7. `render` / `event` relation은 Function Logic callsite relation을 우선한다.
8. 최대 8 callee.
9. ranking:
   - local resolved
   - external resolved
   - inferred
   - unresolved
   - callCount descending
   - name

### 15.8 context budget

```ts
const MAX_TUTOR_OWNER_FACTS = 4;
const MAX_TUTOR_ENTRYPOINT_CHAINS = 4;
const MAX_TUTOR_ENTRYPOINT_STEPS = 6;
const MAX_TUTOR_CALLERS = 6;
const MAX_TUTOR_CALLEES = 8;
const MAX_TUTOR_ARCHITECTURE_EVIDENCE = 3;
```

모든 omitted count는 payload에 남긴다.

---

## 16. guide plan 타입

### 16.1 fact

```ts
export type FunctionTutorGuideFactKind =
  | "documentation"
  | "owner"
  | "architecture"
  | "entrypoint"
  | "caller"
  | "parameter"
  | "decision"
  | "loop"
  | "value-change"
  | "call"
  | "render"
  | "event"
  | "effect"
  | "embedded"
  | "return"
  | "throw"
  | "exit"
  | "scenario"
  | "gap";

export type FunctionTutorGuideFact = {
  id: string;
  kind: FunctionTutorGuideFactKind;
  label: string;
  detail: string;
  certainty: FunctionTutorCertainty;
  blockIds: string[];
  edgeIds: string[];
  evidence: FunctionTutorEvidence[];
};
```

### 16.2 chapter

```ts
export type FunctionTutorGuideChapterKind =
  | "place"
  | "inputs"
  | "decisions"
  | "work"
  | "outcomes";

export type FunctionTutorGuideChapter = {
  id: string;
  ordinal: 1 | 2 | 3 | 4 | 5;
  kind: FunctionTutorGuideChapterKind;
  question:
    | "Where Does It Fit?"
    | "What Comes In?"
    | "What Changes the Path?"
    | "What Does It Change or Call?"
    | "How Can It Finish?";
  status: "ready" | "partial" | "unavailable";
  answer: FunctionTutorGuideAnswer;
  facts: FunctionTutorGuideFact[];
  preferredLens: "flow" | "values" | "calls" | "effects";
  primaryBlockId?: string;
  attentionBlockIds: string[];
  attentionEdgeIds: string[];
  gapIds: string[];
};
```

### 16.3 structured answer

final copy를 arbitrary prose로 저장하지 않는다.

```ts
export type FunctionTutorGuideAnswer =
  | {
      kind: "place";
      documentationSummary?: string;
      ownerNames: string[];
      architectureLayer?: ArchitecturalLayer;
      architectureConfidence?: ArchitecturalLayerConfidence;
      entrypointCount: number;
      callerCount: number;
    }
  | {
      kind: "inputs";
      parameterCount: number;
      defaultCount: number;
      exactCallsiteTupleCount: number;
      unknownParameterCount: number;
    }
  | {
      kind: "decisions";
      branchCount: number;
      loopCount: number;
      importantLabels: string[];
    }
  | {
      kind: "work";
      valueChangeCount: number;
      effectCount: number;
      localCalleeCount: number;
      externalCalleeCount: number;
      unresolvedCalleeCount: number;
      importantLabels: string[];
    }
  | {
      kind: "outcomes";
      returnCount: number;
      throwCount: number;
      exitCount: number;
      scenarioCount: number;
      limited: boolean;
    };
```

Webview copy builder는 이 structured answer만 사용한다.

### 16.4 complete plan

```ts
export type FunctionTutorGuidePlan = {
  chapters: [
    FunctionTutorGuideChapter,
    FunctionTutorGuideChapter,
    FunctionTutorGuideChapter,
    FunctionTutorGuideChapter,
    FunctionTutorGuideChapter
  ];
  initialChapterId: string;
  summary: {
    readyChapterCount: number;
    partialChapterCount: number;
    unavailableChapterCount: number;
  };
};
```

항상 5개 chapter를 반환한다. 정보가 없으면 chapter 자체를 숨기지 않고
unavailable answer를 제공한다.

---

## 17. guide planner

### 17.1 파일

```text
src/application/codeFlow/functionTutor/guide/
  index.ts
  functionTutorGuidePlanner.ts
  functionTutorPlaceChapter.ts
  functionTutorInputChapter.ts
  functionTutorDecisionChapter.ts
  functionTutorWorkChapter.ts
  functionTutorOutcomeChapter.ts
  functionTutorGuideRanking.ts
  functionTutorGuideIdentity.ts
```

### 17.2 public API

```ts
export type BuildFunctionTutorGuideInput = {
  declaration: FunctionTutorDeclarationAnalysis;
  context: FunctionTutorCodebaseContext;
  scenarios: FunctionTutorScenarioSeed[];
  summary: FunctionTutorBuildModel["summary"];
};

export function buildFunctionTutorGuide(
  input: BuildFunctionTutorGuideInput
): FunctionTutorGuidePlan;
```

### 17.3 chapter 1 — place

fact priority:

1. source documentation
2. owner chain
3. architecture assessment
4. mapped entrypoint chain
5. direct caller

status:

- ready: 위 fact 중 2종 이상
- partial: 1종
- unavailable: 0종

answer 규칙:

- documentation이 있으면
  `Source documentation` fact를 첫 줄로 보여준다.
- documentation이 없으면 structure summary부터 시작한다.
- architecture conflicted이면
  `Multiple architecture signals are present`로 표현한다.
- entrypoint와 caller count는 runtime frequency처럼 표현하지 않는다.

attention:

- direct caller는 local graph 밖이므로 attention block 없음
- selected function entry block을 primary block으로 사용
- mapped semantic flow 자체를 Function Logic graph에 새 node로 추가하지 않는다

### 17.4 chapter 2 — inputs

fact priority:

1. parameter declaration order
2. exact default
3. exact callsite tuple provenance
4. literal type / enum
5. inferred constraint boundary
6. unknown

fact 최대 5개. parameter가 많으면 첫 4개 + summary fact.

attention:

- parameter binding definition block
- parameter의 first read block
- 최대 block 8개

answer는 parameter count, default count, exact callsite tuple count, unknown count를
사용한다. parameter 이름으로 domain example을 만들지 않는다.

### 17.5 chapter 3 — decisions

대상:

- condition
- switch
- loop
- try / exception edge

ranking:

1. exact
2. outgoing distinct control edge count descending
3. condition table case count descending
4. source order
5. stable block ID

fact 최대 5개.

각 fact:

- label은 complete source-backed block label
- detail은 `2 possible static continuations`처럼 구조 count만 표현
- condition expression을 재파싱하지 않는다
- try는 exception/finally edge가 실제 있을 때만 decision fact

attention:

- fact block
- outgoing control edge
- direct target block
- 총 block 12, edge 16 budget

### 17.6 chapter 4 — work

대상:

- valueChanges
- call / render / event
- effect
- mutation
- immediate embedded code
- defines / deferred embedded boundary

ranking:

1. external-write / throw-adjacent effect
2. exact value change
3. local resolved call
4. render / event boundary
5. external call
6. inferred / unresolved
7. source order

business importance를 이름으로 추정하지 않는다.

fact grouping:

- 동일 binding의 연속 value change는 1개 summary fact로 group 가능
- 동일 callee relation의 여러 callsite는 callsite count로 group
- immediate / defines / deferred embedded relation은 서로 다른 label

### 17.7 chapter 5 — outcomes

대상:

- return
- throw
- exit
- break / continue는 함수 종료가 아니므로 primary outcome에서 제외
- scenario count와 gap

ranking:

1. throw
2. distinct return expression
3. explicit exit
4. fallthrough

fact 최대 5개.

answer:

- `2 return points and 1 throw are visible in the bounded function body.`
- scenario가 있으면
  `4 static input cases are available for comparing possible outcomes.`
- scenario result를 계산하기 전 특정 return value를 answer에 넣지 않는다.

### 17.8 fact별 source evidence 매핑

Guide planner는 fact 종류별로 다음 근거만 연결한다. 근거가 없는 fact에 임의로
선택 함수 전체 range를 붙이지 않는다.

| fact | source evidence |
|---|---|
| documentation | attached comment / docstring의 exact range |
| owner | concrete class / namespace / module declaration range; synthetic file owner는 action 없음 |
| architecture | source-structure rule이면 selected declaration range; framework semantic rule이면 해당 semantic step range; range를 찾지 못하면 description만 표시하고 action 없음 |
| entrypoint | bounded chain의 entrypoint 또는 handler step range |
| caller | selected function으로 들어오는 concrete call edge range |
| parameter / default | parameter declaration evidence |
| decision / loop | 해당 Function Logic block range |
| value-change | value-change를 포함한 Function Logic block range |
| call / render / event / effect | matched callsite 또는 block range |
| return / throw / exit | terminal Function Logic block range |
| scenario | seed를 만든 callsite / default / constraint evidence |
| gap | gap에 이미 연결된 evidence만 사용 |

추가 규칙:

- architecture evidence description 자체에는 range가 없으므로 위 표의 두 경우
  외에는 `Open Source`를 만들지 않는다.
- 동일 fact의 evidence는 certainty, source order, token 순으로 안정 정렬한다.
- evidence가 사라져도 claim은 `partial`로 유지하고 source action만 생략한다.
- caller / callee name에서 definition range를 추측하지 않는다.
- projected block / edge identity가 없으면 graph attention 대상에서만 제외하고
  text fact는 유지한다.

---

## 18. deterministic copy builder

### 18.1 파일

```text
src/webview/codeFlow/tutor/copy/
  index.ts
  functionTutorCopyBrowserSource.ts
```

### 18.2 함수

```js
function formatFunctionGuideAnswer(chapter, tutor)
function formatFunctionGuideFact(fact)
function formatFunctionGuideCertainty(certainty)
function formatFunctionGuideCount(count, singular, plural)
function formatFunctionGuideAvailability(status)
```

### 18.3 template 예시

place:

```text
Source documentation describes this callable as “<summary>”.
It is owned by <owners> and has <architecture> evidence with <confidence> confidence.
The bounded codebase graph shows <entrypoints> mapped entrypoints and <callers> direct callers.
```

documentation 없음:

```text
No source documentation was found. The bounded codebase graph places this
callable under <owners> and shows <callers> direct callers.
```

inputs:

```text
This callable declares 3 parameters. 1 has a source default, 2 exact callsite
tuples are available, and 1 parameter remains unknown.
```

decisions:

```text
The bounded body contains 2 branch decisions and 1 loop. Start with
“<first important label>”.
```

work:

```text
The bounded body shows 3 value changes, 2 possible effects, 4 local callees,
and 1 unresolved call target.
```

outcomes:

```text
The bounded body contains 2 return points and 1 throw. 4 static input cases can
compare possible outcomes without running source code.
```

### 18.4 copy budget

- chapter answer 최대 360자
- fact label 최대 120자
- fact detail 최대 220자
- context relation name 최대 160자
- `…` 사용
- identifier는 text를 바꾸지 않고 container에서 wrap

---

## 19. scenario subsystem 업그레이드

### 19.1 보존

- existing static values
- candidate selection
- callsite tuple integrity
- path / loop / step budgets
- structured expression evaluator
- before / after transitions
- graph attention

### 19.2 변경

- top-level table에서 chapter disclosure로 이동
- opening guide는 scenario를 계산하지 않음
- table title `Static Input Cases`
- action `Load Inputs into Values`
- `Why These Inputs?`는 case별 `Source Basis`로 통합
- generic limits는 panel bottom `Unknowns & Limits`
- selected case detail에 다음 추가:
  - first differing decision
  - value change count
  - terminal kind
  - bounded indicator

### 19.3 lazy calculation state

```ts
type FunctionTutorScenarioRuntimeState = {
  status: "idle" | "calculating" | "ready" | "error";
  generation: number;
  selectedSeedId?: string;
  selectedPathIndex: number;
  pendingSeedIds: string[];
  resultsBySeedId: Map<string, FunctionTutorScenarioPath[]>;
  errorMessage?: string;
};
```

알고리즘:

1. disclosure open.
2. generation increment.
3. selected 또는 first seed를 sync bounded 계산.
4. UI render.
5. remaining seed를 `setTimeout(runNext, 0)` 또는 기존 scheduler로 하나씩 계산.
6. 각 계산 후 live status는 매 row마다 announce하지 않고 완료 count를 debounce.
7. close / new fingerprint 시 generation mismatch로 중단.
8. error는 scenario subsection에만 격리.

`requestIdleCallback`만 의존하지 않는다. VS Code Webview availability가 달라질 수
있으므로 timeout fallback이 필수다.

---

## 20. protocol v2

### 20.1 version

`FunctionTutorPayload.version`을 `2`로 올린다.

Host와 Webview는 같은 extension package에서 배포되므로 장기 dual-version
renderer는 만들지 않는다. 단, malformed / missing v2 field는 UI error가 아니라
unavailable section으로 격리한다.

### 20.2 payload

```ts
export type FunctionTutorPayload = {
  version: 2;
  fingerprint: string;
  functionId: string;
  executionKind: "sync" | "async" | "generator" | "async-generator";
  availability: "ready" | "partial" | "unavailable";
  context: FunctionTutorCodebaseContextPayload;
  guide: FunctionTutorGuidePlanPayload;
  parameters: FunctionTutorParameterPayload[];
  seeds: FunctionTutorScenarioSeedPayload[];
  program: FunctionTutorProgramPayload;
  evidence: FunctionTutorEvidencePayload[];
  gaps: FunctionTutorGapPayload[];
  summary: FunctionTutorSummaryPayload;
};
```

`functionId`는 기존 projection context의 opaque `flowId`를 그대로 사용한다.
selected graph node ID를 새 field로 노출하거나 별도 hash identity를 만들지 않는다.

### 20.3 context payload

```ts
export type FunctionTutorCodebaseContextPayload = {
  documentation?: {
    kind: string;
    summary: string;
    tags: Array<{
      kind: "parameter" | "returns" | "throws" | "remarks";
      parameterName?: string;
      text: string;
    }>;
    truncated: boolean;
    evidenceTokens: CodeFlowEvidenceToken[];
  };
  owners: Array<{
    id: string;
    kind: "file" | "module" | "namespace" | "class";
    name: string;
    certainty: FunctionTutorPayloadCertainty;
    evidenceTokens: CodeFlowEvidenceToken[];
  }>;
  architecture?: {
    layer: string;
    confidence: "high" | "medium" | "low" | "unknown";
    businessLogic:
      | "domainRuleCandidate"
      | "applicationWorkflowCandidate"
      | "notBusinessLogic"
      | "unknown";
    conflicted: boolean;
    alternatives: string[];
    evidence: string[];
  };
  entrypoints: FunctionTutorEntrypointPayload[];
  callers: FunctionTutorCallerPayload[];
  callees: FunctionTutorCalleePayload[];
  counts: FunctionTutorContextCountPayload;
};
```

### 20.4 guide payload

```ts
export type FunctionTutorGuidePlanPayload = {
  initialChapterId: string;
  chapters: FunctionTutorGuideChapterPayload[];
  summary: {
    readyChapterCount: number;
    partialChapterCount: number;
    unavailableChapterCount: number;
  };
};

export type FunctionTutorGuideChapterPayload = {
  id: string;
  ordinal: 1 | 2 | 3 | 4 | 5;
  kind: "place" | "inputs" | "decisions" | "work" | "outcomes";
  question: string;
  status: "ready" | "partial" | "unavailable";
  answer: FunctionTutorGuideAnswerPayload;
  facts: FunctionTutorGuideFactPayload[];
  preferredLens: "flow" | "values" | "calls" | "effects";
  primaryBlockId?: string;
  attentionBlockIds: string[];
  attentionEdgeIds: string[];
  gapIds: string[];
};
```

### 20.5 protocol identity

- owner ID: `function-tutor-owner:<hash>`
- entrypoint ID: `function-tutor-entrypoint:<hash>`
- caller ID: `function-tutor-caller:<hash>`
- callee ID: `function-tutor-callee:<hash>`
- chapter ID: `function-tutor-chapter:<kind>:<hash>`
- fact ID: `function-tutor-fact:<kind>:<hash>`

raw IDs를 hash input으로 사용할 수 있지만 output에는 노출하지 않는다.

### 20.6 fingerprint

fingerprint input:

- flow ID
- payload version
- documentation summary hash
- architecture assessment stable fields
- bounded entrypoint / caller / callee raw identities
- guide fact identities
- scenario seed IDs
- program block IDs

source content 전체를 stringify하지 않는다.

---

## 21. projection

### 21.1 파일 분리

현재 `functionTutorProjection.ts`를 다음으로 분리한다.

```text
src/application/codeFlow/functionTutor/projection/
  index.ts
  functionTutorProjection.ts
  functionTutorContextProjection.ts
  functionTutorGuideProjection.ts
  functionTutorScenarioProjection.ts
  functionTutorEvidenceProjection.ts
  functionTutorIdentityProjection.ts
```

### 21.2 projection context

```ts
export type FunctionTutorProjectionContext = {
  flowId: CodeFlowId;
  blockIds: ReadonlyMap<string, string>;
  edgeIds: ReadonlyMap<string, string>;
  bindingIds: ReadonlyMap<string, string>;
  createEvidenceToken(
    filePath: string,
    range: SourceRange
  ): CodeFlowEvidenceToken | undefined;
};
```

callee definition navigation은 새 source-node token을 Tutor에 중복 전달하지 않는다.
이번 범위의 source action은 callsite / definition evidence range를 연다. child
function attach는 기존 Calls lens / Inspector action을 사용한다.

### 21.3 안전한 text

projection에서 다음을 bounded한다.

- documentation
- owner names
- architecture evidence descriptions
- entrypoint labels
- caller / callee names
- guide fact label / detail

Webview는 항상 `textContent`를 사용한다.

### 21.4 evidence dedup

- 동일 token은 `evidence` list에 한 번만.
- fact에는 token array만.
- token list stable sort.
- invalid range 또는 token 생성 실패는 fact를 삭제하지 않고 evidence 없는 partial
  fact로 남긴다.
- source action은 token이 있을 때만 렌더한다.

### 21.5 path privacy

금지:

- `workspaceRoot`
- absolute `filePath`
- analyzer node / edge ID
- caller source full text
- doc comment raw unbounded text

protocol v2에는 별도의 raw path 또는 context path field를 추가하지 않는다.
사용자에게 source 위치를 보여 주는 모든 `locationLabel`은 projection 단계에서
기존 `createSourceDisplayFormatter`로만 생성한다. owner / relation card는 이름만
표시하고, 위치 표시는 source evidence action의 `locationLabel`에만 둔다.

---

## 22. Host orchestration

### 22.1 publish flow

`CodeFlowHostDelivery.publishFunctionLogic`:

```text
read source
  → analyze Function Logic
  → analyze Tutor declaration + documentation
  → read cached architecture / semantic flow / function index
  → collect Tutor codebase context
  → build scenario model
  → build 5-question guide
  → project Function Logic + Tutor v2
  → post one detail payload
```

### 22.2 failure isolation

실패 domain을 분리한다.

| 실패 | 결과 |
|---|---|
| Function Logic analyzer | 기존 Function Logic failure |
| documentation adapter | guide partial, documentation gap |
| context collector | guide partial, context gap |
| scenario builder | guide 유지, Static Input Cases unavailable |
| guide planner | minimal unavailable guide, Function Logic 유지 |
| evidence token 또는 range projection 실패 | 해당 source action만 제거 |

Host catch에서 Tutor를 `undefined`로 완전히 지우지 않는다.

최소 fallback:

```ts
createUnavailableFunctionTutorModel({
  declaration,
  reason: "Function Guide could not build its optional context."
});
```

fallback도 `version: 2`, 5 unavailable chapters, gaps를 갖는다.

### 22.3 logging

허용 debug fields:

- availability
- documentation present boolean
- owners / entrypoints / callers / callees count
- ready / partial / unavailable chapter count
- scenario count
- gap count
- build milliseconds
- serialized byte estimate

금지:

- documentation text
- source path
- source line
- parameter value
- raw graph identity

---

## 23. Webview 모듈 구조

현재 `functionTutorBrowserSource.ts`가 interpreter, state, table, copy, DOM을
한 함수 string에 포함한다. 업그레이드 전에 분리한다.

```text
src/webview/codeFlow/tutor/
  index.ts
  functionTutorBrowserSource.ts              # composer only
  functionTutorIntegrationBrowserSource.ts
  functionTutorStyles.ts                     # style composer only
  state/
    functionTutorStateBrowserSource.ts
    functionTutorStateTypes.ts
  interpreter/
    functionTutorInterpreterBrowserSource.ts
    functionTutorExpressionBrowserSource.ts
    functionTutorObjectWriteBrowserSource.ts
  guide/
    functionTutorGuideBrowserSource.ts
    functionTutorOverviewBrowserSource.ts
    functionTutorChapterNavigationBrowserSource.ts
    functionTutorChapterDetailBrowserSource.ts
    functionTutorContextRelationsBrowserSource.ts
    functionTutorEvidenceBrowserSource.ts
  scenarios/
    functionTutorScenarioControllerBrowserSource.ts
    functionTutorScenarioTableBrowserSource.ts
    functionTutorTransitionTableBrowserSource.ts
  copy/
    functionTutorCopyBrowserSource.ts
  styles/
    functionTutorBaseStyles.ts
    functionTutorGuideStyles.ts
    functionTutorScenarioStyles.ts
    functionTutorResponsiveStyles.ts
    functionTutorAccessibilityStyles.ts
```

규칙:

- composer는 source string concat만 한다.
- interpreter는 DOM을 모른다.
- guide renderer는 evaluator를 직접 호출하지 않는다.
- scenario controller만 interpreter를 호출한다.
- integration adapter만 comprehension / valueFlow / openEvidence를 안다.
- React / Vue / new UI dependency를 추가하지 않는다.

---

## 24. Webview state model

```ts
export type FunctionTutorGuideState = {
  sessionKey: string;
  fingerprint: string;
  open: boolean;
  selectedChapterId: string;
  sourceBasisOpenByChapterId: Map<string, boolean>;
  limitsOpen: boolean;
  scenarioDisclosureOpen: boolean;
  scenario: FunctionTutorScenarioRuntimeState;
};
```

### 24.1 session rule

session key:

```text
<graph version>::<root function block id>::<tutor fingerprint>
```

- 동일 fingerprint rerender: state 보존
- 새 fingerprint: selected chapter를 initial로 reset
- graph version 변경: cache와 pending scenario generation clear
- panel close: state는 보존, attention만 clear
- extension detail remove: map entry 삭제

### 24.2 controller public surface

```js
{
  section,
  toggle,
  open(),
  close(),
  dispose(),
  selectChapter(chapterId),
  clearAttention(),
  getState()
}
```

### 24.3 render strategy

- panel shell은 한 번 생성한다.
- chapter 선택 시 overview 전체를 재생성하지 않는다.
- navigation selected attributes와 detail region만 갱신한다.
- scenario table은 disclosure open 후 mount한다.
- large array DOM write는 fragment로 batch한다.
- render 중 `getBoundingClientRect`를 호출하지 않는다.

---

## 25. comprehension과 graph integration

### 25.1 state 확장

`FunctionLogicComprehensionState`:

```ts
guideFocus?: {
  blockIds: string[];
  edgeIds: string[];
  primaryBlockId?: string;
};
```

events:

```ts
| {
    type: "set-guide-focus";
    blockIds: string[];
    edgeIds: string[];
    primaryBlockId?: string;
  }
| { type: "clear-guide-focus" }
```

### 25.2 attention projection

`createFunctionLogicAttentionProjection`이 Guide focus를 central projection으로
계산한다.

새 reason:

- `guide-primary`
- `guide-related`
- `guide-context`

DOM:

- 기존 `data-attention` 값과 class를 재사용한다.
- `data-attention-reason` 같은 Guide 전용 DOM 속성은 추가하지 않는다. reason은
  central comprehension state 내부에만 보존한다.
- `data-tutor-attention`은 migration phase 완료 후 제거한다.

### 25.3 no-state-corruption tests

각 테스트는 Guide 전후의 다음 state equality를 검증한다.

- branch choices
- selected binding
- embedded focus
- body focus
- value playback index / playing
- viewport transform
- selected graph block

`Show on Graph`만 selected block / lens를 의도적으로 변경할 수 있다.

### 25.4 viewport reveal

`FunctionLogicViewportController`의 public surface에 다음 method를 필수로 추가한다.

```js
revealBlocks(blockIds, options)
```

규칙:

1. layout map에서 bounded union bounds 계산.
2. 현재 visible world rect 안이면 no-op.
3. 현재 scale을 가능하면 유지.
4. 대상이 viewport보다 크면 max 0.9 fit scale로 축소.
5. transform only.
6. 170ms 이하 ease-out 또는 reduced-motion immediate.
7. explicit `Show on Graph`에서만 호출.

primary action 이후 node에 focus를 강제로 주지 않는다.

---

## 26. UI component 상세 계약

### 26.1 header

semantic:

- section
- eyebrow `<span>`
- title `<h3>` 또는 drawer heading hierarchy에 맞는 실제 heading
- intro `<p>`
- availability status `<span>`

availability:

- ready: 별도 badge 불필요
- partial: `Partial static coverage`
- unavailable: `Guide unavailable`

static/no-run 문구는 intro에 항상 보인다. badge 여러 개로 반복하지 않는다.

### 26.2 At a Glance

`<dl>` 사용.

rows:

1. `Codebase Role`
2. `Reached From`
3. `Internal Shape`
4. `Leads To`

값:

- Codebase Role: architecture + confidence 또는 `Unclassified`
- Reached From: entrypoint / direct caller count
- Internal Shape: branch / loop / value change / exit 중 non-zero 3개까지
- Leads To: local / external / unresolved callee count

count가 0이면 숨기지 않고 bounded absence를 표현한다.

### 26.3 question navigation

- 한 row 전체가 button
- ordinal은 별도 visible text
- status는 `Ready`, `Partial`, `Limited`
- selected row는 border + background + `aria-current`
- status를 color만으로 표시하지 않는다
- icon library를 새로 추가하지 않는다

### 26.4 chapter detail

순서:

1. `Question N of 5`
2. question heading
3. deterministic answer
4. fact list
5. primary action row
6. Source Basis details
7. Previous / Next

fact list row:

- semantic kind label
- claim
- certainty text
- evidence token이 하나 이상 있을 때만 `Open Source` button

fact가 0개면 empty prose를 표시하고 빈 list를 만들지 않는다.

### 26.5 source basis

`<details>` + `<summary>Source Basis · N facts</summary>`.

각 evidence:

- evidence kind의 사용자 문구
- certainty
- summary
- Open Source

동일 token은 한 번만.
raw source snippet은 표시하지 않는다.

### 26.6 Static Input Cases

`<details>` 내부:

- 설명
- calculation status
- semantic table
- selected case detail
- Load Inputs into Values
- case source basis

table columns wide:

1. Case
2. Inputs
3. Possible Outcome

certainty는 Case cell의 secondary line으로 이동한다.

selected row:

- button은 case title만 감싼다.
- `aria-current="true"`.
- table row 전체에 click handler를 두지 않는다.

### 26.7 Unknowns & Limits

- panel bottom의 하나의 details.
- context gap + chapter gap + scenario gap deduplicate.
- kind별 group:
  - Codebase Context
  - Static Inputs
  - Possible Paths
  - Language Support
- 최대 12개 visible.
- omitted count 표시.
- 각 gap에 해결 방법을 꾸며내지 않는다.
- evidence token이 있으면 Open Source.

---

## 27. 전체 UI 상태

### 27.1 ready

- 5 questions
- At a Glance
- chapter facts
- scenario disclosure

### 27.2 partial

- panel 정상 open
- partial coverage 문구
- 가능한 chapter는 usable
- unavailable chapter도 이유 표시
- source action은 available evidence에만

### 27.3 unavailable

- Function Guide button은 숨지 않는다.
- open 가능
- title / static notice 표시
- Function Logic 자체를 읽는 최소 5-question shell
- 이유:
  `The guide could not build source-backed context for this function. The Function Logic graph remains available.`
- retry button은 만들지 않는다. 같은 snapshot에서 결과가 달라지지 않는다.

### 27.4 documentation absent

- error가 아니다.
- place chapter에서 bounded absence 한 줄.

### 27.5 no entrypoint

- “unused”라고 말하지 않는다.
- mapped HTTP / GraphQL entrypoint가 current index에 없다고 표현한다.

### 27.6 no caller

- dead code라고 말하지 않는다.
- current graph snapshot에 direct caller가 없다고 표현한다.

### 27.7 no scenario

- guide는 usable.
- scenario disclosure disabled가 아니라 open 가능한 empty explanation.
- `Load Inputs into Values` 없음.

### 27.8 scenario calculating

- table skeleton card를 만들지 않는다.
- actual row와 `Calculating…` outcome.
- live region은 `Calculated 2 of 5 static input cases`.

### 27.9 scenario error

- guide 전체를 error로 만들지 않는다.
- subsection message:
  `Static input cases could not be calculated. Codebase context and source-backed questions remain available.`

### 27.10 long / dense

fixture:

- 160자 qualified name
- 480자 documentation
- 12 parameters
- 20 callers, 20 callees
- 12 scenarios
- 12 gaps
- 8 evidence items

budget 후 UI에서 no page horizontal scroll, no clipped action, no invisible focus.

---

## 28. accessibility contract

### 28.1 semantic requirements

- actual heading hierarchy
- disclosure: button + `aria-expanded` + `aria-controls`
- question navigation: ordered list + buttons
- overview: definition list
- scenarios: table / caption / scope
- evidence / limits: details / summary
- live updates: role status or `aria-live="polite"`
- graph remains separate labeled region

### 28.2 keyboard route

다음 순서를 mouse 없이 수행한다.

1. Function Guide toggle
2. question navigation
3. selected question Source Basis
4. Open Source
5. Show on Graph
6. Previous / Next
7. Static Input Cases disclosure
8. scenario rows
9. path selector
10. Load Inputs into Values
11. Unknowns & Limits
12. Inspector close

### 28.3 focus

- pointer click에 focus ring 강제 없음
- keyboard focus-visible 명확
- render 후 focus element가 제거되지 않음
- selected chapter rerender 시 button identity 유지
- panel close 시 toggle focus 유지
- source open 후 VS Code가 focus를 옮기는 것은 Host behavior이며 Guide가 되돌리지 않음

### 28.4 screen reader copy

- counts는 symbol-only로 읽히지 않음
- `→`는 decorative relation의 유일한 의미가 아님
- certainty를 visible text로 읽음
- scenario static nature를 caption에서 읽음
- omitted count를 읽음
- selected question 변경은 detail heading / polite status로 알림

### 28.5 forced colors / contrast

- selected row outline
- border color `CanvasText`
- active state `Highlight`
- graph focus가 opacity만으로 전달되지 않음
- certainty label text 유지

### 28.6 reduced motion

- drawer existing transition 제거
- guide question selection no animation
- viewport reveal immediate
- scenario row no decorative transition
- loading spinner를 추가하지 않음

---

## 29. responsive contract

### 29.1 supported contexts

- narrow stacked Webview: 약 390~520px content width
- tablet / split editor: 약 768~900px
- wide editor: 1040~1440px 이상
- Inspector side column: 280~390px
- 200% browser zoom

### 29.2 layout

- side Inspector에서는 single column.
- stacked Inspector에서도 single column.
- At a Glance value wrapping.
- action group `flex-wrap`.
- question row min-width 0.
- scenario table container width 100%.
- relation chain vertical.
- native select explicit foreground / background.

### 29.3 container-aware scenario table

가능하면 `container-type: inline-size`를 Guide section에 적용한다.

`@container (max-width: 340px)`:

- certainty column은 이미 없으므로 추가 column hide 없음
- inputs / outcome의 secondary detail은 wrap
- cell padding 감소
- selected detail이 table 아래 full width

container query가 지원되지 않아도 readable해야 한다.

---

## 30. performance, memory, payload budget

### 30.1 Host

```ts
const MAX_TUTOR_CONTEXT_BUILD_MS_WARN = 40;
const MAX_TUTOR_TOTAL_BUILD_MS_WARN = 80;
```

warn threshold이며 기능 cutoff가 아니다. 실제 cutoff는 item budget으로 보장한다.

- immutable graph cache reuse
- no repeated full source reads
- documentation은 selected source snapshot만
- caller source reads는 기존 max 6
- no recursive traversal

### 30.2 Webview

- Guide open 시 interpreter 0회
- chapter select 시 O(chapter facts + graph attention items)
- scenario results cache
- one seed per task
- no list virtualization 필요: 모든 visible list는 budget상 12 이하
- no layout read/write interleave

### 30.3 payload

```ts
const MAX_FUNCTION_TUTOR_PAYLOAD_BYTES = 96 * 1024;
const MAX_FUNCTION_TUTOR_CONTEXT_BYTES = 40 * 1024;
const MAX_FUNCTION_TUTOR_GUIDE_FACTS = 25;
const MAX_FUNCTION_TUTOR_EVIDENCE = 48;
const MAX_FUNCTION_TUTOR_GAPS = 24;
```

projection 후 byte estimate가 budget을 넘으면:

1. duplicate evidence 제거
2. low-priority caller / callee fact 제거
3. architecture evidence description 축소
4. documentation tag 축소
5. scenarios 축소
6. gap에 payload-budget limitation 추가

documentation summary, 5 chapter shell, primary exact facts는 끝까지 보존한다.

### 30.4 memory

- session state는 current detail + attached function fragments에만
- graph clear 시 cache clear
- pending timeout IDs dispose
- DOM listener를 detached section에 남기지 않음

---

## 31. 보안, privacy, 무토큰 계약

### 31.1 금지 import / API

Tutor production module에서 금지:

- OpenAI / Anthropic / model SDK
- `fetch`, `XMLHttpRequest`, WebSocket
- `eval`, `new Function`
- `child_process`
- `vm`
- `worker_threads` source execution
- test runner invocation
- dynamic package install

기존 unit test가 browser source function을 test harness에서 `new Function`으로
실행하는 것은 production source execution이 아니다. architecture test는
production paths와 test paths를 구분한다.

### 31.2 source text

- Host analyzer만 source text를 읽는다.
- Webview에 source body / doc raw block을 보내지 않는다.
- bounded documentation plain text만 projection한다.
- Webview는 code를 계산하지 않는다.
- embedded code는 기존 structured program만 사용한다.

### 31.3 object safety

기존 interpreter의 다음 guard를 유지한다.

- own-property only
- `__proto__`, `prototype`, `constructor` reject
- bounded array / object
- no getter invocation
- no call expression evaluation

---

## 32. 최종 의존성 방향

```text
analyzer/functionTutor
  → analyzer/functionLogic public types
  → shared

graph/functionIndex
  → shared

application/codeFlow/functionTutor/context
  → analyzer/functionTutor
  → graph/functionIndex
  → insights/architecturalLayers
  → insights/semanticFlow
  → shared

application/codeFlow/functionTutor/guide
  → analyzer/functionTutor
  → application functionTutor context/types
  → shared

application codeFlow projection
  → protocol

webview/codeFlow/tutor
  → protocol data only
  → existing browser controller callbacks
```

금지:

- analyzer → insights / application / protocol / Webview
- graph → application / Webview
- context collector → Webview
- Webview → filesystem / VS Code API 직접 호출
- Tutor → Function Explorer internal file deep import
- Function Logic analyzer → Tutor UI

---

## 33. 구현 phase

각 phase는 별도 session으로 수행해도 된다. phase 사이 compile이 깨지면 안 된다.

### Phase 0 — baseline과 contract 고정

작업:

1. 현재 Tutor 관련 test 목록 기록.
2. current payload fixture JSON snapshot 기록.
3. current wide / narrow UI screenshot은 구현 시작 시 별도 QA artifact로 기록.
4. `DESIGN.md`의 Static Function Tutor section을 이 문서의 Function Guide 계약으로
   갱신.
5. `PRODUCT.md` capability 문구를 scenario-only에서 codebase guide로 확장.
6. no-LLM / no-execution architecture baseline 확인.

테스트:

- `npm test`
- `npx tsc --noEmit` 또는 repo compile
- package tests

gate:

- baseline failure 0
- 현재 dirty changes 보존
- 변경 범위 문서화

### Phase 1 — behavior-preserving module split

작업:

1. analyzer split.
2. application builder split:
   - callsite collector
   - candidate builder
   - scenario planner
3. browser source split:
   - interpreter
   - scenario renderer
   - integration
4. projection split.

UI / payload behavior를 바꾸지 않는다.

테스트:

- existing Function Tutor tests
- browser source string safety tests
- line count architecture test

gate:

- snapshots 동일
- 각 source <800
- circular import 0

### Phase 2 — documentation analysis

작업:

1. types 추가.
2. common text normalizer.
3. TS / JS adapter.
4. Python adapter.
5. Java adapter.
6. functional adapter.
7. declaration result에 optional documentation.

테스트:

- language fixtures
- range
- truncation
- hostile markup text
- detached comment
- missing doc

gate:

- doc가 없어도 scenario output 동일
- source text Webview 전달 없음

### Phase 3 — cached function relation evidence

작업:

1. `CodeFlowInsightSnapshot.functionIndex`.
2. cache construction.
3. cache reuse tests.
4. 필요 시 graph relation core extraction.

gate:

- graph snapshot당 index 1회
- Function Explorer 회귀 없음
- large graph performance baseline 유지

### Phase 4 — context collector

작업:

1. ownership.
2. architecture.
3. entrypoint chains.
4. callers.
5. callees.
6. block matching.
7. budgets / gaps.

테스트:

- cycle parent
- multi-entrypoint
- no entrypoint
- duplicate caller edges
- local / external / unresolved callee
- callsite-to-block match
- deterministic shuffle
- budget omitted count

gate:

- raw path / ID 없는 application projection 준비
- 이름 heuristic 없음

### Phase 5 — 5-question guide planner

작업:

1. guide types.
2. identity.
3. each chapter builder.
4. ranking.
5. structured answer.
6. availability.

테스트:

- ready / partial / unavailable
- exact / inferred / unknown
- fixed 5 order
- deterministic input shuffle
- fact / attention budget
- no business purpose fabrication

gate:

- 모든 supported language에서 5 chapter 반환
- scenario 0이어도 guide 존재

### Phase 6 — protocol v2와 projection

작업:

1. protocol type v2.
2. context projection.
3. guide projection.
4. evidence dedup.
5. safe text.
6. fingerprint.
7. fixture migration.

테스트:

- JSON round trip
- opaque IDs
- raw absolute path reject
- evidence token validity
- payload byte budget
- missing token partial fact

gate:

- TypeScript compile
- existing detail payload tests updated
- Host/Webview contract 일치

### Phase 7 — Host orchestration과 failure domains

작업:

1. extended build input.
2. context + scenario + guide order.
3. unavailable fallback.
4. debug metrics.
5. failure isolation.

테스트:

- documentation throw
- context throw
- scenario throw
- projection missing evidence
- Function Logic still publishes
- guide button remains available

gate:

- optional subsystem 실패로 graph suppression 없음

### Phase 8 — Guide state와 toggle

작업:

1. `Function Guide` label.
2. `aria-expanded`.
3. session state.
4. panel shell.
5. close / dispose.
6. no focus stealing.

테스트:

- open / close
- focus stays
- state fingerprint reset
- graph change cancel
- unavailable payload

gate:

- `Tutor` user-visible top control 없음
- `aria-pressed` 제거

### Phase 9 — overview와 question UI

작업:

1. header / intro.
2. At a Glance `<dl>`.
3. question navigation.
4. detail.
5. fact list.
6. deterministic copy.
7. Source Basis.
8. Previous / Next.
9. `functionLogicBrowserSource.ts`의 기존 `createFunctionUnderstanding`,
   `createUnderstandingCard`, `createDecisionUnderstanding`,
   `createActionUnderstanding` 호출과 helper를 제거한다.
10. `functionLogicGraphStyles.ts`와 `functionLogicInspectorStyles.ts`의
    `.logic-understanding-*` style을 제거한다.

테스트:

- semantic DOM
- keyboard question navigation
- exact copy snapshots
- long text
- 0 counts
- conflicted architecture
- documentation prefix
- rendered tree와 browser source에 기존 `Understand this function in four passes`
  문구 및 `.logic-understanding-*` class가 남지 않음

gate:

- scenario 계산 없이 codebase explanation readable

### Phase 10 — graph attention 통합

작업:

1. comprehension state event.
2. central attention projection.
3. guide integration callback.
4. Show on Graph.
5. viewport reveal.
6. remove `data-tutor-attention`.

테스트:

- state priority
- close clear
- branch preservation
- value playback preservation
- no implicit viewport move
- explicit reveal
- reduced motion

gate:

- parallel opacity system 제거
- existing graph selection regression 0

### Phase 11 — Static Input Cases migration

작업:

1. disclosure.
2. lazy calculation controller.
3. renamed table.
4. case detail.
5. Load Inputs into Values.
6. scenario source basis.
7. cancellation.

테스트:

- guide open evaluator 0 calls
- disclosure first seed
- background remaining seeds
- generation cancel
- error isolation
- known / unknown input copy status

gate:

- current scenario capabilities 보존
- default cognitive load 감소

### Phase 12 — responsive / accessibility / state hardening

작업:

1. styles split.
2. narrow / stacked.
3. forced colors.
4. reduced motion.
5. 200% zoom.
6. long identifiers.
7. live announcements.
8. container fallback.

테스트:

- fake DOM keyboard
- computed responsive class / screenshot
- detector
- web guidelines audit

gate:

- high severity accessibility finding 0

### Phase 13 — documentation, package, real UI QA

문서:

- `README.md`
- `SPEC.MD`
- `PRODUCT.md`
- `DESIGN.md`
- old Tutor plan에 “baseline implemented / superseded UX” note

자동 검증:

- `npm test`
- compile
- architecture tests
- package VSIX
- package check
- `git diff --check`

실제 QA:

- dark theme
- light theme
- high contrast / forced colors
- reduced motion
- narrow / medium / wide
- keyboard full flow
- mouse full flow
- scenario error fixture
- partial language fixture
- no-source-doc fixture

gate:

- QA artifact가 package에 섞이지 않음
- console error 0
- claimed interactions 실제 수행

---

## 34. 파일별 변경 체크리스트

### analyzer

- [ ] `src/analyzer/functionTutor/types.ts`
- [ ] `src/analyzer/functionTutor/functionTutorAnalyzer.ts`
- [ ] `src/analyzer/functionTutor/typescript/`
- [ ] `src/analyzer/functionTutor/documentation/`
- [ ] `src/analyzer/functionTutor/nonTypeScriptTutorAdapter.ts`
- [ ] `src/analyzer/functionTutor/index.ts`

### graph / insights cache

- [ ] `src/graph/functionIndex.ts` 또는 relation core
- [ ] `src/graph/functionIndexTypes.ts`
- [ ] `src/application/codeFlow/codeFlowInsightCache.ts`

### application

- [ ] `src/application/codeFlow/functionTutor/types/`
- [ ] `src/application/codeFlow/functionTutor/context/`
- [ ] `src/application/codeFlow/functionTutor/guide/`
- [ ] `src/application/codeFlow/functionTutor/projection/`
- [ ] `src/application/codeFlow/functionTutor/functionTutorBuilder.ts`
- [ ] `src/application/codeFlow/functionTutor/index.ts`
- [ ] `src/application/codeFlow/codeFlowFunctionLogicProjection.ts`

### protocol / Host

- [ ] `src/protocol/functionTutor.ts`
- [ ] `src/protocol/functionLogic.ts`
- [ ] `src/webview/codeFlow/codeFlowHostDelivery.ts`

### Webview

- [ ] `src/webview/codeFlow/tutor/state/`
- [ ] `src/webview/codeFlow/tutor/interpreter/`
- [ ] `src/webview/codeFlow/tutor/guide/`
- [ ] `src/webview/codeFlow/tutor/scenarios/`
- [ ] `src/webview/codeFlow/tutor/copy/`
- [ ] `src/webview/codeFlow/tutor/styles/`
- [ ] `src/webview/codeFlow/tutor/functionTutorBrowserSource.ts`
- [ ] `src/webview/codeFlow/tutor/functionTutorIntegrationBrowserSource.ts`
- [ ] `src/webview/codeFlow/comprehension/`
- [ ] `src/webview/codeFlow/viewport/`
- [ ] `src/webview/codeFlow/presentation/functionLogicGraphHeaderBrowserSource.ts`
- [ ] `src/webview/codeFlow/functionLogicBrowserSource.ts`
- [ ] `src/webview/codeFlow/functionLogicGraphStyles.ts`
- [ ] 기존 `.logic-understanding-*` helper, markup, style, test expectation 제거

### tests

- [ ] `src/test/unit/functionTutorDocumentation.test.ts`
- [ ] `src/test/unit/functionTutorContext.test.ts`
- [ ] `src/test/unit/functionTutorGuidePlanner.test.ts`
- [ ] `src/test/unit/functionTutorProjection.test.ts`
- [ ] `src/test/unit/functionTutorInterpreter.test.ts`
- [ ] `src/test/unit/functionTutorWebview.test.ts`
- [ ] `src/test/unit/functionLogicAttentionProjection.test.ts`
- [ ] `src/test/unit/codeFlowWebview.test.ts`
- [ ] architecture tests
- [ ] package tests

---

## 35. 테스트 fixture

### 35.1 primary TypeScript codebase fixture

```text
src/test/fixtures/functionTutor/codebaseGuide/
  routes.ts
  ordersController.ts
  ordersService.ts
  pricing.ts
  ordersRepository.ts
  analytics.ts
```

구조:

```ts
/** Places a validated order and returns its persisted identifier. */
async function placeOrder(order: Order, priority = false): Promise<string> {
  if (!order.valid) {
    throw new InvalidOrderError(order.id);
  }
  const discount = priority ? 10 : 0;
  const total = calculateTotal(order.items, discount);
  await repository.save(order, total);
  analytics.emit("order.placed", order.id);
  return order.id;
}
```

graph:

- HTTP route → controller → service → `placeOrder`
- direct caller 2개
- local callee `calculateTotal`
- repository callee
- external analytics
- unresolved callee `optionalNotifier`
- decision 2개
- value change 2개
- throw 1개
- return 1개
- exact callsite tuple 2개

검증:

- documentation
- owner
- application / domain evidence depending existing classifier fixture
- entrypoint chain
- callers
- callees
- all 5 chapters
- scenarios

### 35.2 no-context fixture

- anonymous local function
- parent file만
- no doc
- no caller / callee
- straight return

Guide:

- place partial
- inputs ready 또는 partial
- decisions unavailable
- work unavailable
- outcomes ready

### 35.3 conflicting architecture fixture

- framework service semantic
- path-based conflicting evidence
- `conflicted: true`
- alternatives visible
- 단일 확정 layer copy 금지

### 35.4 large bounded fixture

- 30 callers
- 30 callees
- 8 entrypoint flows
- 15 decisions
- 20 effects
- 12 scenarios
- long docs / names

검증:

- max counts
- omitted
- payload <96KiB
- deterministic output
- UI overflow

### 35.5 unsupported / partial languages

- Python docstring + branch
- JavaDoc + method
- F# XML comment
- OCaml doc comment
- Elixir `@doc`
- documentation unavailable but Function Logic available

### 35.6 hostile content

documentation:

```text
</script><img src=x onerror=alert(1)> & "quoted"
```

검증:

- textContent only
- no DOM element creation
- no CSP violation

---

## 36. 테스트 매트릭스

### 36.1 documentation

- attached / detached
- overload
- multiline
- tags
- long
- empty
- markup
- Unicode
- language-specific range

### 36.2 context

- owner chain
- owner cycle
- architecture known / unclassified / conflicted
- HTTP / GraphQL entrypoint
- multiple chain
- no chain
- caller duplicate
- callee local / external / unresolved
- block mapping
- budgets
- deterministic shuffle

### 36.3 guide

- fixed question order
- answer structured fields
- ready / partial / unavailable
- fact priority
- attention bounds
- preferred lens
- gaps
- no fabricated role

### 36.4 projection

- opaque IDs
- evidence tokens
- no absolute path
- no raw graph ID
- text bounds
- byte budget
- fingerprint change
- JSON serializable

### 36.5 Webview

- toggle label
- aria-expanded
- no implicit scenario compute
- question keyboard nav
- Source Basis
- Open Source message
- Show on Graph
- lens selection explicit only
- attention clear
- scenario lazy calculation
- Load Inputs into Values
- error isolation
- focus preservation
- graph change cancellation

### 36.6 architecture

- no forbidden import
- no network
- no source execution
- no recursion in graph traversal
- source file length
- public boundary
- no circular dependency

---

## 37. 실제 브라우저 / VS Code QA inventory

### 37.1 functional flow

1. Visualize a documented TypeScript function.
2. Confirm `Function Guide` purpose from label and tooltip.
3. Open Guide.
4. Confirm no viewport movement and no scenario calculation.
5. Read At a Glance.
6. Select each question.
7. Open source basis.
8. Open one caller callsite.
9. Show decision on graph.
10. Confirm branch choices unchanged.
11. Show work on graph.
12. Open Static Input Cases.
13. Select second case.
14. Confirm possible path highlight.
15. Load inputs into Values.
16. Confirm Values lens and copied known inputs.
17. Close Guide.
18. Confirm attention cleared and prior graph state preserved.

### 37.2 viewports

- `390 × 844`
- `768 × 1024`
- `1440 × 900`
- actual Inspector side width 280px
- 200% zoom

### 37.3 dense states

- long doc
- 6 caller / 8 callee
- 5 facts
- 12 scenarios
- 12 limits
- long qualified names

### 37.4 themes / media

- default dark
- default light
- high contrast
- forced colors
- reduced motion

### 37.5 visual checks

- hierarchy
- no card nesting noise
- no horizontal page scroll
- no clipped buttons
- no table collapse
- selected question visible
- focus visible
- source basis readable
- graph remains dominant
- no new visual language

### 37.6 console

- runtime exception 0
- CSP error 0
- network request 0
- detached listener warning 0

---

## 38. 회귀 불변 조건

1. Function Logic graph는 Guide 없이 동일하게 동작한다.
2. 4개 lens를 유지한다.
3. branch choice는 Guide open / chapter select로 바뀌지 않는다.
4. value binding selection은 Guide open / chapter select로 바뀌지 않는다.
5. value playback은 Guide open으로 시작하거나 reset되지 않는다.
6. scenario preview는 manual Values input을 쓰지 않는다.
7. `Load Inputs into Values`만 Values input을 쓴다.
8. child attach / collapse behavior는 유지한다.
9. embedded immediate / defines / deferred 의미는 유지한다.
10. eval source를 실행하지 않는다.
11. source evidence token authorization은 active snapshot만.
12. unavailable Guide가 Function Logic payload를 막지 않는다.
13. scenario error가 codebase chapters를 막지 않는다.
14. raw source path가 payload에 없다.
15. graph layout은 Guide context node를 추가하지 않는다.

---

## 39. 위험과 고정 대응

### 위험 1 — “코드베이스 설명”이 이름 기반 요약으로 변질

대응:

- docs, architecture, semantic flow, call relation, Function Logic만 사용
- identifier-only purpose inference 금지
- architecture reuse
- forbidden-copy tests

### 위험 2 — documentation이 stale인데 truth처럼 보임

대응:

- `Source documentation` prefix
- authored claim과 static structure 분리
- documentation이 architecture confidence를 높이지 않음

### 위험 3 — Guide가 graph보다 큰 dashboard가 됨

대응:

- Inspector 안 single column
- 5 question progressive disclosure
- no chart library
- bounded relation list
- no equal card grid

### 위험 4 — header control 과밀

대응:

- existing wrap 유지
- icon-only 금지
- `Function Guide` 두 단어 유지
- viewport control과 visual group gap

### 위험 5 — attention layer 충돌

대응:

- comprehension central state
- explicit priority
- `data-tutor-attention` 제거
- state equality tests

### 위험 6 — Host payload 증가

대응:

- 96KiB hard budget
- context / fact limits
- evidence dedup
- payload tests

### 위험 7 — FunctionIndex 중복 비용

대응:

- immutable graph cache
- existing FunctionIndex reuse
- 필요 시 generic relation core extraction
- performance test

### 위험 8 — 모든 언어에서 documentation parsing 확대

대응:

- partial fact
- silent fallback 금지
- documentation absence는 error 아님
- language fixtures

### 위험 9 — guide text가 번역 불가능하게 분산

대응:

- copy browser source 한 모듈
- structured answer
- UI string inventory test
- 향후 l10n 이동 가능

### 위험 10 — scenario 기능 회귀

대응:

- interpreter behavior-preserving split
- 기존 tests 먼저
- lazy controller만 추가
- scenario fixture parity

---

## 40. 구현하지 말아야 할 것

- chat input
- prompt box
- AI badge / sparkle
- “Generate Explanation”
- natural-language Q&A
- function name embedding
- external model
- full repository summary
- new call graph canvas
- Sankey / force graph / chart dependency
- business-purpose filename heuristic
- runtime likelihood / frequency
- automatic source open
- automatic viewport pan
- automatic scenario execution
- forced linear onboarding
- completion confetti / gamification
- custom fonts
- new palette
- icon-only Function Guide button
- raw code comment HTML rendering
- source snippet copy into Webview
- interprocedural symbolic execution
- test generation / test execution

---

## 41. 권장 multi-session 경계

| Session | 범위 | 인계 산출물 |
|---|---|---|
| 1 | Phase 0–1 | docs contract, behavior-preserving module split |
| 2 | Phase 2 | documentation adapters and fixtures |
| 3 | Phase 3–4 | cached relation evidence, context collector |
| 4 | Phase 5 | 5-question guide planner |
| 5 | Phase 6 | protocol v2 and projection |
| 6 | Phase 7 | Host orchestration and failure isolation |
| 7 | Phase 8–9 | toggle, state, overview, questions |
| 8 | Phase 10 | central graph attention and viewport reveal |
| 9 | Phase 11 | lazy Static Input Cases |
| 10 | Phase 12 | responsive, accessibility, hardening |
| 11 | Phase 13 | docs, full tests, browser / VS Code QA, package |

각 인계 note:

- completed phase / gate
- changed files
- exact tests and results
- current payload version
- known gaps
- next exact file / function
- dirty worktree overlap

---

## 42. Definition of Done

### product

- [ ] top control is `Function Guide`
- [ ] purpose is predictable before opening
- [ ] scenario is no longer the first information
- [ ] 5 fixed questions are present
- [ ] codebase role, inbound, internal, outbound, outcomes are covered
- [ ] source documentation is labeled as authored documentation
- [ ] every claim is source-backed or explicitly unknown

### analysis

- [ ] documentation adapters
- [ ] existing architecture reuse
- [ ] existing semantic flow reuse
- [ ] existing FunctionIndex reuse
- [ ] owner, caller, callee, entrypoint budgets
- [ ] deterministic guide planner
- [ ] no name-based purpose inference

### protocol

- [ ] version 2
- [ ] opaque identities
- [ ] evidence tokens
- [ ] no absolute paths
- [ ] no raw IDs
- [ ] bounded text
- [ ] payload <96KiB

### UI

- [ ] At a Glance
- [ ] 5-question navigation
- [ ] chapter answer / facts / Source Basis
- [ ] Show on Graph
- [ ] Open Source
- [ ] Static Input Cases disclosure
- [ ] Load Inputs into Values
- [ ] Unknowns & Limits
- [ ] ready / partial / unavailable / calculating / error / empty

### graph integration

- [ ] central attention state
- [ ] no parallel Tutor opacity system
- [ ] no implicit pan
- [ ] explicit bounded reveal
- [ ] branch / value / embedded / playback state preserved

### accessibility

- [ ] semantic heading / dl / ol / button / table / details
- [ ] aria-expanded
- [ ] keyboard full flow
- [ ] focus-visible
- [ ] no focus theft
- [ ] live calculation status
- [ ] forced colors
- [ ] reduced motion
- [ ] 200% zoom
- [ ] long text

### quality

- [ ] source files <800 lines
- [ ] module boundaries
- [ ] unit / fixture / integration tests
- [ ] no forbidden API
- [ ] full `npm test`
- [ ] compile
- [ ] VSIX package check
- [ ] diff check
- [ ] actual rendered QA
- [ ] QA artifacts excluded from package

---

## 43. 최종 수용 기준

기능은 다음 문장을 모두 참으로 만들 때 완료다.

1. 사용자는 `Function Guide` 버튼만 보고 함수와 코드베이스 맥락을 읽는 기능임을
   예측할 수 있다.
2. Guide를 열면 scenario 계산 전에 함수의 owner, architecture evidence,
   entrypoint, caller, internal shape, outbound count를 볼 수 있다.
3. 사용자는 5개 질문을 어떤 순서로든 읽을 수 있다.
4. 각 질문에는 deterministic answer, certainty, source basis가 있다.
5. 중요한 local fact는 명시적 action으로 graph에서 볼 수 있다.
6. caller, documentation, block evidence는 opaque source action으로 검증할 수 있다.
7. scenario는 `Static Input Cases`에서 lazy하게 계산된다.
8. scenario result는 possible static outcome으로만 표현된다.
9. Guide open / chapter select는 기존 graph state와 viewport를 바꾸지 않는다.
10. explicit `Show on Graph`만 lens / selection / reveal을 수행한다.
11. context 또는 scenario 일부가 실패해도 나머지 Guide와 Function Logic은
    유지된다.
12. 모든 결과는 로컬 정적 분석이며 LLM, network, token, source execution을
    사용하지 않는다.

---

## 44. 최종 결정 요약

- 사용자 visible name은 `Function Guide`.
- panel은 `Understand This Function`.
- 기존 Static Tutor는 `Static Input Cases` subsection으로 유지.
- default UI는 codebase context와 5개 질문.
- source documentation, owner, architecture, semantic entrypoint, caller, callee,
  Function Logic, scenario를 결합.
- architecture와 semantic flow는 기존 index를 재사용.
- caller / callee는 existing FunctionIndex를 cache해 재사용.
- 설명은 structured facts → deterministic copy.
- 이름 기반 purpose inference 금지.
- Guide는 fifth lens가 아닌 Inspector reading mode.
- guide attention은 central comprehension state로 통합.
- open 시 focus, viewport, branch, values, playback을 바꾸지 않음.
- scenario는 disclosure open 후 lazy 계산.
- protocol v2, opaque ID, evidence token, 96KiB payload budget.
- no AI, no network, no token, no source execution.
- Terra High는 Phase 0부터 순서대로 구현하며 각 gate를 통과한 뒤 다음 phase로
  이동한다.
