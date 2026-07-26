# Function Logic 인지 부담 저감 UI 구현 플랜

> 상태: 구현 전 설계안
>
> 주 대상: Project Analyzer의 Function Visualizer / Function Logic Webview
>
> 구현 난이도 기준: Terra Medium이 단계별로 그대로 실행할 수 있는 수준
>
> 작성 원칙: AI 설명 없이도 사용자가 구조와 근거를 직접 읽을 수 있어야 한다
>
> 범위: UI 구조, interaction, Webview architecture, eval inline flow, 접근성, QA
>
> 비범위: 이번 문서 작성 단계에서 실제 UI 코드를 변경하는 일

---

## 0. 이 문서의 목적

이 문서는 Function Logic 화면을 “분석 결과를 많이 보여 주는 graph”에서
“사람이 순서대로 질문하고 직접 검증할 수 있는 실행 지도”로 바꾸기 위한 구현
계약이다.

최종 UI는 AI가 만든 해설을 읽지 않아도 다음 질문에 답할 수 있어야 한다.

1. 이 함수는 어디서 시작하고 어디서 끝나는가?
2. 주 흐름은 무엇이며 어느 지점에서 경로가 갈라지는가?
3. 선택한 경로에서 실제로 관련 있는 block은 무엇인가?
4. 한 값은 어디서 정의되고, 어떻게 바뀌며, 어디서 소비되거나 빠져나가는가?
5. 호출, 렌더, 이벤트, `eval` 같은 경계 뒤에는 어떤 흐름이 이어지는가?
6. 지금 보는 관계는 exact인가, inferred인가?
7. 각 node의 근거를 원본 소스 어디에서 확인할 수 있는가?

이 플랜의 핵심은 정보를 제거하는 것이 아니다. 한 번에 한 종류의 질문을
선명하게 만들고, 다른 정보는 공간 맥락을 보존한 채 조용하게 두는 것이다.

### 0.1 Terra Medium 실행 규칙

Terra Medium 구현자는 다음 규칙을 지킨다.

- Phase를 순서대로 수행하고 각 Phase의 완료 조건을 통과한 뒤 다음 Phase로 간다.
- 여러 Phase를 한 번에 큰 rewrite로 합치지 않는다.
- 새 dependency, graph library, font, icon package를 추가하지 않는다.
- 기존 VS Code semantic token과 editor/UI font 설정을 유지한다.
- analyzer 결과를 runtime 실행처럼 표현하지 않는다.
- graph traversal은 재귀가 아니라 명시적 queue/stack, visited set, bound를 사용한다.
- 사용자 worktree의 기존 변경을 덮어쓰거나 되돌리지 않는다.
- 기존 테스트를 삭제하거나 의미를 약화해 새 UI에 맞추지 않는다.
- 한 파일이 800줄을 넘기기 전에 책임 단위로 분리한다.
- UI 구현과 visual QA를 별개 완료 조건으로 취급한다.
- 이 문서에서 “반드시”라고 표시한 항목은 임의로 축소하지 않는다.
- 구현 중 계약 충돌이 발견되면 추측으로 우회하지 말고 `SPEC.md`와 이 문서를
  함께 갱신해 판단 근거를 남긴다.

---

## 1. 제품 목표와 성공 정의

### 1.1 대상 사용자

주 사용자는 다음 상황의 개발자다.

- 처음 보는 함수의 책임과 실행 경로를 빠르게 파악해야 한다.
- 오래전에 작성한 코드의 맥락을 다시 복구해야 한다.
- bug나 변경 영향 범위를 찾기 위해 특정 값이나 분기를 따라가야 한다.
- 동적 코드, callback, JSX render, event handler처럼 흐름이 끊겨 보이는 경계를
  확인해야 한다.
- 정적 분석 결과를 신뢰하되, 최종 판단은 원본 소스로 검증하려 한다.

### 1.2 핵심 Job to Be Done

> “코드를 한 줄씩 머릿속에서 실행하지 않고도, 함수의 가능한 실행 구조와 값의
> 변화를 눈으로 외부화하고, 필요한 순간 정확한 소스로 돌아가 검증하고 싶다.”

### 1.3 성공 상태

UI가 성공하면 사용자는 다음을 별도 AI 설명 없이 수행할 수 있다.

- start에서 exit까지 주 흐름을 추적한다.
- decision에서 가능한 arm과 선택된 arm을 구분한다.
- 선택하지 않은 arm이 사라진 것이 아니라 현재 scenario에서 제외됐음을 안다.
- 특정 variable을 선택하고 definition → update → consume/sink 순서를 따라간다.
- `eval` 내부 node가 host 함수 흐름의 어느 지점에서 실행되고 어디로 복귀하는지
  이해한다.
- `eval` 내부 node를 선택했을 때 graph와 Inspector가 같은 의미를 가리키며,
  명시적 source action 뒤 editor highlight도 같은 node를 가리킨다고 인식한다.
- call/render/event가 immediate call, deferred dispatch, definition-only 중 무엇인지
  구분한다.
- exact/inferred 차이를 색을 보지 않고도 line style과 text로 구분한다.

### 1.4 정량·정성 성공 기준

아직 실사용자 baseline이 없으므로 아래 수치는 제품 성과를 이미 달성했다고
주장하는 지표가 아니라, 구현 후 검증할 목표다.

- 첫 화면에서 value edge animation이 자동 시작되지 않는다.
- 기본 화면의 상시 legend 항목은 최대 3개다.
- graph node 하나가 상시 노출하는 semantic detail row는 최대 1줄이다.
- Tab을 한 번 눌러 graph에 진입한 뒤 모든 node를 순차 Tab할 필요 없이 arrow
  navigation으로 이동할 수 있다.
- lens 전환은 graph node의 위치와 크기를 바꾸지 않는다.
- 120 node / 일반 edge budget에서 lens·selection 변경은 O(V+E) 한 번으로 끝난다.
- active attention 상태는 한 시점에 하나다. 동시에 이동하는 marker도 하나다.
- 390, 768, 1280, 1600 CSS px 폭에서 page-level horizontal overflow가 없다.
- 200% text zoom에서도 주요 action label이 잘리거나 겹치지 않는다.
- reduced motion에서는 이동 animation 없이 같은 의미 상태를 즉시 표시한다.

### 1.5 비목표

다음은 이번 UI 개선의 목표가 아니다.

- AI chat이나 자동 설명 panel 추가
- 전체 repository raw graph를 한 화면에 표시
- force-directed layout 도입
- runtime trace처럼 보이는 시간축이나 빈도 heatmap
- static possible path를 “실제로 실행된 경로”라고 표현
- 새로운 SaaS dashboard, cyberpunk, neon, glassmorphism 스타일
- 외부 font 또는 icon library 추가
- graph를 decorative animation으로 꾸미기
- source text를 요약하거나 생략해 node를 작게 만드는 것
- mobile app 전용 interaction 도입
- analyzer가 알 수 없는 값을 UI에서 추측

---

## 2. 조사 근거와 현재 상태

### 2.1 적용한 디자인 기준

이번 계획은 다음 스킬과 자료를 적용했다.

- `ui-design-workflow`
  - 기존 design system, 인접 화면, 상태, responsive, functional/visual QA 분리
- `ui-ux-pro-max`
  - progressive disclosure, keyboard, focus, reduced motion, chart 대체 표현,
    semantic token, dense data 기준
- `impeccable`
  - 제품 truth를 `PRODUCT.md`에 먼저 기록하고, incumbent surface를 존중하면서
    Operate + Read 모드로 구조를 설계
- `web-design-guidelines`
  - native semantic control, visible focus, interruptible animation, long text,
    aria-live, large-list performance, dark theme, interaction state

`vercel-react-best-practices`는 현재 Function Logic Webview가 React/Next.js가 아니라
TypeScript가 생성하는 CSP-safe browser source이므로 적용하지 않는다. ImageGen,
문서, PDF, presentation 스킬은 저장소 내 Markdown 구현 플랜이라는 산출물과 맞지
않아 사용하지 않는다.

### 2.2 UI UX 데이터베이스 제안 중 채택하지 않는 것

자동 검색은 App Store landing, 외부 font, 별도 dark palette, dashboard card,
cyberpunk UI 같은 제안을 반환했다. 이들은 다음 이유로 채택하지 않는다.

- Function Logic은 판매용 landing이 아니라 VS Code 안의 고빈도 작업 화면이다.
- 제품의 visual authority는 VS Code theme token과 기존 graph vocabulary다.
- 외부 font는 editor font와 source text의 대응을 깨뜨린다.
- neon/glow는 confidence, selection, effect 색 의미와 경쟁한다.
- KPI card dashboard는 source-first 실행 흐름을 여러 독립 panel로 분해한다.

채택하는 원칙은 다음뿐이다.

- 고밀도이되 질문별로 progressive disclosure
- keyboard와 focus order를 visual order와 일치
- graph의 순서형 text alternative 제공
- 색 외에 line, border, shape, label을 함께 사용
- 150~300ms 이하의 원인-결과 motion
- 한 화면에서 1~2개 이하의 의미 있는 motion
- reduced motion과 forced colors 지원

### 2.3 현재 디자인 계약

현재 제품은 다음 visual language를 이미 갖고 있으며 이를 보존한다.

- VS Code background, foreground, border, focus, chart semantic token
- VS Code UI font와 editor font의 분리
- top-to-bottom rank와 side branch lane
- entry/exit capsule, decision rounded node, event dashed, embedded double border
- exact solid, inferred/back/exception dashed edge
- graph-first workspace와 graph를 덮지 않는 Inspector
- source label 전체 보존과 wrap
- same-canvas child attachment
- one-click source verification
- selected variable의 bounded value-flow playback

`DESIGN.md`는 현재 value-flow playback에 초점을 둔다. 구현 Phase 0에서 이 계약을
지우지 말고, 본 플랜의 전체 Function Logic attention model을 상위 section으로
추가해야 한다.

### 2.4 현재 구조

주요 파일과 책임은 다음과 같다.

| 영역 | 현재 파일 | 현재 책임 |
| --- | --- | --- |
| graph orchestration | `src/webview/codeFlow/functionLogicBrowserSource.ts` | graph 생성, edge/node, header, Inspector 결합, source action |
| graph visual | `src/webview/codeFlow/functionLogicGraphStyles.ts` | graph, node, edge, selection, responsive |
| selection | `src/webview/codeFlow/functionLogicSelectionBrowserSource.ts` | selected node, edge dim, Inspector detail |
| branch | `src/webview/codeFlow/branchChoices/` | branch choice projection과 DOM class |
| body focus | `src/webview/codeFlow/bodyFocus/` | compound region과 breadcrumb |
| values | `src/webview/codeFlow/dataFlow/` | binding selector, value SVG, playback |
| scenario | `src/webview/codeFlow/valuePreview/` | input과 safe calculation |
| Inspector | `src/webview/codeFlow/inspector/` | drawer shell, open state, responsive |
| viewport | `src/webview/codeFlow/viewport/` | pan, zoom, fit, center |
| layout | `src/application/codeFlow/functionLogicGraphLayout.ts` | deterministic node/edge layout |
| protocol | `src/protocol/functionLogic.ts` | Webview payload |
| projection | `src/application/codeFlow/codeFlowFunctionLogicProjection.ts` | analyzer → opaque payload |

### 2.5 현재 인지 부담의 구체적인 원인

#### A. node 하나가 너무 많은 질문에 동시에 답한다

현재 node는 조건에 따라 아래 정보를 모두 표시한다.

- kind
- body owner
- function label
- child count
- branch label
- complete source label
- value changes
- value accesses
- source location 또는 detail

사용자는 node를 볼 때 “이 statement가 무엇인가”와 “이 값이 어떻게 변했는가”,
“호출을 펼칠 수 있는가”, “어느 body에 속하는가”를 동시에 해석해야 한다.

#### B. 한 click이 여러 결과를 낸다

현재 graph node click은 상황에 따라 다음을 함께 수행한다.

- selection 변경
- Inspector 갱신
- graph edge 강조
- body focus 변경
- source evidence 열기
- child call/render/event attachment 또는 collapse

하나의 action에 여러 mental model이 결합되어 있어 사용자가 “선택만 했는지”,
“source로 이동한 것인지”, “graph 구조를 바꾼 것인지”를 예측하기 어렵다.

#### C. 강조 시스템이 서로 독립적이다

현재 다음 기능이 각각 별도 class를 직접 적용한다.

- selected node와 connected edge의 `active` / `dimmed`
- branch choice의 `choice-selected` / `choice-dimmed`
- value flow의 `selected`, `data-flow-related`
- playback source/target/past/active
- body focus current/nested
- child entering animation

기능별로는 맞더라도 조합 시 opacity와 border 우선순위가 CSS specificity에
의존한다. 사용자는 “왜 이 node가 흐린가”를 알기 어렵고, 구현자는 새 상태를
추가할수록 충돌을 추적하기 어렵다.

#### D. 기본 화면이 Values 질문까지 미리 켠다

현재 첫 binding을 자동 선택해 value relation을 표시할 수 있다. 사용자가 아직
함수 구조를 보려는 단계에서도 control edge와 value edge가 함께 경쟁한다.

#### E. 상시 legend가 과도하다

현재 header legend에는 exact, inferred, event, static code, callable, value change,
value flow, choice, repeat가 동시에 있다. graph를 읽기 전에 legend 자체를
학습해야 한다.

#### F. Inspector 정보 순서가 사용자의 현재 질문과 무관하다

Scenario Variables는 항상 최상단에 있고, selected block, playback, selector,
callees, signature, four-pass guide가 한 scroll 안에 놓인다. 구조를 읽는 사용자도
먼저 value editor를 지나야 한다.

#### G. graph는 keyboard와 screen reader에 과도한 비용을 준다

- 모든 node가 독립 button이므로 큰 graph에서 Tab stop이 매우 많다.
- interactive branch label이 SVG `text role="button"`이라 native button보다
  hit area와 semantics가 약하다.
- graph를 대체하는 순서형 목록이 없다.
- viewport arrow pan과 node arrow navigation의 역할이 분리되어 있지 않다.

#### H. 큰 orchestration 파일이 UI 상태 결합을 강화한다

`functionLogicBrowserSource.ts`는 800줄을 넘고 graph 생성, edge, node, header,
selection wiring을 함께 가진다. `functionLogicGraphStyles.ts`도 700줄대다. 여기에
새 lens와 eval region을 직접 추가하면 project file-size 기준과 책임 경계를
넘는다.

#### I. eval은 분석상 inline이지만 시각적 경계가 충분히 설명되지 않는다

현재 embedded block과 내부 block이 control graph에 존재하고 내부 evidence range도
제공할 수 있다. 그러나 사용자가 다음을 한눈에 구분할 명시적 UI contract가 없다.

- direct `eval`과 `globalThis.eval`
- immediate와 deferred/definition-only
- caller lexical scope bridge 유무
- host statement → embedded entry → embedded exit → host resume
- 내부 node의 exact substring evidence와 전체 literal fallback

### 2.6 현재 코드 audit 기준점

구현 시작 시 아래 위치를 먼저 다시 읽는다. line은 이 플랜 작성 시점 기준이며
코드가 바뀌면 symbol/function 이름을 기준으로 찾는다.

| 위치 | 현재 관찰 | 계획상 처리 |
| --- | --- | --- |
| `functionLogicBrowserSource.ts:240` | node click에서 selection 시작 | local selection만 유지 |
| `functionLogicBrowserSource.ts:255` | 같은 click에서 body focus | explicit Inspector action |
| `functionLogicBrowserSource.ts:258` | 같은 click에서 source editor open | explicit source action |
| `functionLogicBrowserSource.ts:261` | 같은 click에서 child expand | Calls lens action |
| `functionLogicBrowserSource.ts:443` | 상시 9-item legend | contextual 3-item + disclosure |
| `functionLogicBrowserSource.ts:526` | SVG text가 custom branch button | HTML native button layer |
| `functionLogicBrowserSource.ts:619` | node가 여러 semantic row를 함께 렌더 | stable semantic slot |
| `functionLogicSelectionBrowserSource.ts:32` | selection이 edge opacity를 직접 변경 | attention projection |
| `functionLogicDataFlowBrowserSource.ts:75` | 첫 binding 자동 선택 | explicit Values selection |
| `functionLogicDataFlowBrowserSource.ts:213` | value feature가 node class 직접 변경 | attention projection |
| `branchChoices/functionLogicBranchChoices.ts:232` | branch feature가 class 직접 변경 | semantic projection만 전달 |
| `inspector/functionLogicInspectorBrowserSource.ts:18` | 새 graph에서 항상 open | width-aware policy |
| `inspector/functionLogicInspectorBrowserSource.ts:113` | Scenario section 상단 고정 | Values lens section |
| `functionLogicGraphStyles.ts:284` | selection dim opacity를 개별 CSS가 소유 | central attention style |

현재 `outline:none` 사용은 모두 위반이라고 단정하지 않는다. 예를 들어 selected
node에는 box-shadow replacement가 있다. 구현자는 replacement가 실제 theme와
forced colors에서 보이는지 확인한 뒤에만 유지한다.

### 2.7 구조 대안 검토

기존 graph+drawer 관성에서 벗어나기 위해 다음 구조도 검토했다.

- strict character-cell grid
  - dense scan에는 강하지만 source line wrap, branch geometry, VS Code font 설정을
    깨뜨려 제외
- 하나의 continuous animated field
  - flow 방향을 직관화할 수 있으나 confidence와 source evidence보다 motion이
    앞서고 reduced-motion 대체가 약해 제외
- pivot/fan deck
  - 인접 node 비교에는 유리하지만 start→branch→merge topology와 loop를 왜곡해 제외
- step-only guided reader
  - 초심자에게 쉽지만 expert의 spatial overview와 자유 탐색을 잃어 제외
- source/graph equal split
  - evidence는 강하지만 좁은 editor에서 graph가 지나치게 작아지고 source editor와
    역할이 중복되어 제외
- graph-only semantic lenses
  - 시각적으로 가장 단순하지만 linear wayfinding과 accessible alternative가 약해
    단독 방향으로는 제외

최종 방향은 graph의 공간 관계를 유지하면서 bounded Static Flow Ledger를
동기화한다. 두 표현은 별도 제품 mode가 아니라 같은 selection/attention state의
서로 다른 읽기 표면이다.

---

## 3. 선택한 디자인 방향

### 3.1 방향 이름

**Question-Led Map + Ledger — 질문 주도 실행 지도와 정적 흐름 원장**

### 3.2 Thesis

Function Logic은 “모든 분석 layer를 동시에 보여 주는 graph”가 아니다. 동일한
공간 지도를 유지하면서 사용자의 현재 질문 하나만 전경으로 올리고, 선택 node
주변의 정적 읽기 순서를 작은 ledger로 동기화하는 code comprehension cockpit이다.
Map은 관계와 branch topology를 외부화하고, Ledger는 사용자가 “방금 어디를
읽었고 다음에 무엇을 볼지” 기억하지 않아도 되게 한다.

### 3.3 핵심 원리

1. **Recognition over recall**
   - legend를 외워야 이해되는 표현보다 node shape, enclosure, direct label을 쓴다.
2. **Focus plus context**
   - 관련 없는 항목을 삭제하지 않고 조용하게 남겨 mental map을 보존한다.
3. **Progressive disclosure**
   - source text는 유지하되 value row, call detail, evidence는 현재 lens와 selection에
     맞춰 노출한다.
4. **One question, one foreground**
   - Flow, Values, Calls, Effects 중 하나만 primary lens다.
5. **Stable geometry**
   - selection이나 lens 전환으로 node 위치·크기가 바뀌지 않는다.
6. **External memory**
   - 현재 lens, 선택 node, branch scenario, binding, body/eval scope를 화면에
     명시해 사용자가 기억하지 않아도 된다.
7. **Evidence at hand**
   - 모든 이해 경로는 exact source action으로 끝난다.

### 3.4 사용자가 읽는 순서

기본 읽기 순서는 다음 네 질문이다.

```text
START → DECIDE → CHANGE → FINISH
```

- **Start**: entry와 초기 state는 무엇인가?
- **Decide**: 어느 조건에서 경로가 바뀌는가?
- **Change**: 어떤 값, 외부 state, 호출 경계가 바뀌는가?
- **Finish**: return, throw, dispatch, resume은 어디인가?

기존 “Start / Choose / Do / Finish” 카드 네 개를 그대로 유지하지 않는다.
graph 위의 한 줄 Reading Rail로 통합하고, 각 항목은 해당 kind의 다음 node로
이동하는 실제 navigation action이 된다.

### 3.5 시각 세계

- palette: VS Code semantic theme token만 사용
- typography: VS Code UI font + editor code font
- surface: editor 안의 technical map, 얇은 경계와 명확한 selection
- density: compact하되 line-height와 focus ring을 희생하지 않음
- shape: control semantics를 위한 기존 node shape 유지
- color: secondary signal; text, line, border style을 항상 함께 사용
- motion: 인과를 설명하는 단일 marker 또는 boundary transition만 사용

### 3.6 거부하는 시각 방향

- card dashboard
- AI chat sidebar
- dark-only neon terminal
- node마다 glow, shadow, gradient를 주는 graph
- 모든 node가 pulse하거나 순서대로 등장하는 animation
- source text를 한 줄 ellipsis로 줄이는 compact mode
- flow마다 새 palette를 만드는 lens

---

## 4. 최종 Surface 구조

### 4.1 Wide layout

```text
┌──────────────────────────────── Function Context ────────────────────────────────┐
│ functionName(args) · Static paths · exact/inferred summary · source location     │
├──────────────────────────── Question / Lens Bar ──────────────────────────────────┤
│ [Flow] [Values] [Calls] [Effects]   Start → Decide → Change → Finish   [Legend]  │
├──────────────────────────────────────────────────────┬───────────────────────────┤
│                                                      │ Inspector                 │
│  Graph viewport                                      │ ─ Selected node           │
│                                                      │ ─ Static Flow Ledger      │
│  context ── RELATED ── [ACTIVE] ── RELATED           │ ─ Current question        │
│       ╲                   │                           │ ─ Lens-specific detail    │
│        muted branch      eval boundary               │ ─ Verify in source        │
│                                                      │                           │
│  pan / zoom / center / fit                           │                           │
├──────────────────────────────────────────────────────┴───────────────────────────┤
│ status / bounded-analysis gap / live announcement                                 │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Narrow layout

```text
┌──────────────── Function Context ────────────────┐
│ [Map] [Steps]                                    │
│ [Flow] [Values] [Calls] [Effects]                │
│                              [Legend] [Inspector] │
├──────────────────────────────────────────────────┤
│ Reading Rail: Start → Decide → Change → Finish   │
├──────────────── Graph viewport ──────────────────┤
│                                                  │
│                bounded graph                     │
│                                                  │
├──────────────── Inspector summary ───────────────┤
│ selected node · previous/current/next static step│
├──────────────── Expanded Inspector / Steps ──────┤
│ bounded ledger + lens detail with one scroll      │
└──────────────────────────────────────────────────┘
```

### 4.3 Surface hierarchy

우선순위는 아래와 같다.

1. selected node와 현재 action
2. active lens의 관련 path
3. selected node 전후의 Static Flow Ledger context
4. selected branch에서 reachable한 context
5. body/eval enclosure와 source boundary
6. 제외되거나 현재 질문과 무관한 context
7. optional guide, complete legend, advanced scenario detail

Inspector나 legend가 graph보다 먼저 시선을 끌면 실패다.

---

## 5. Lens 모델

### 5.1 Lens 목록

| Lens | 답하는 질문 | 전경 | 배경 |
| --- | --- | --- | --- |
| Flow | “어디로 진행하는가?” | entry, decision, loop, transfer, exit, selected branch | value row, call detail |
| Values | “이 값은 어떻게 변하는가?” | selected binding, definition/update/consume/sink, playback hop | unrelated control detail |
| Calls | “어느 코드 경계로 넘어가는가?” | call, render, event, embedded/callable, attached child | value annotations |
| Effects | “무엇을 바꾸거나 외부로 내보내는가?” | mutation, effect, sink, return, throw | pure operation detail |

### 5.2 기본 Lens

- 새 graph의 기본은 **Flow**다.
- binding을 자동 선택하지 않는다.
- value-flow SVG는 Values lens에서 binding을 직접 선택하기 전까지 숨긴다.
- child attachment 상태와 branch choice는 lens를 바꿔도 보존한다.
- lens는 analyzer나 Host layout을 다시 실행하지 않는다.

### 5.3 Lens control semantics

- native `<button type="button">` 네 개를 `role="toolbar"` 안에 둔다.
- 각 button은 `aria-pressed`를 사용한다.
- icon-only control로 만들지 않고 text label을 항상 표시한다.
- focus-visible은 VS Code focus border로 2px equivalent를 제공한다.
- hover, active, pressed, disabled 상태에서 layout bounds를 바꾸지 않는다.
- lens 전환은 120ms opacity/stroke transition만 허용한다.
- `prefers-reduced-motion`에서는 transition을 제거한다.

### 5.4 Lens별 Inspector

| Lens | Inspector 상단 | 다음 section | advanced |
| --- | --- | --- | --- |
| Flow | selected statement + outgoing path | branch cases / current path | body focus, full reading list |
| Values | selected binding + current value hop | Scenario Variables / calculation | all binding accesses |
| Calls | boundary kind + target | attach/collapse actions | all direct callees |
| Effects | exact/inferred effect summary | changed targets / sinks | related exits |

selected node summary와 source verification action은 모든 lens에서 고정한다.

### 5.5 Contextual legend

상시 legend는 현재 lens에 필요한 최대 3개만 보인다.

- Flow: exact, inferred, selected path
- Values: definition/update, consume, sink
- Calls: immediate, deferred/event, definition-only
- Effects: exact change, inferred change, sink/exit

전체 legend는 native `<details>` 또는 명시적 “Legend” disclosure로 연다.
구조 icon으로 emoji를 사용하지 않는다. CSS line swatch와 text를 사용한다.

---

## 6. Attention Projection

### 6.1 목적

selection, branch, binding, playback, body focus, eval focus가 각각 opacity를 직접
정하지 않게 한다. 모든 기능은 semantic state만 제공하고, 하나의 pure attention
projection이 최종 시각 단계를 결정한다.

### 6.2 상태

```ts
export type FunctionLogicLens = "flow" | "values" | "calls" | "effects";

export type FunctionLogicComprehensionState = {
  sessionKey: string;
  view: "map" | "steps";
  lens: FunctionLogicLens;
  selectedBlockId?: string;
  selectedBindingId?: string;
  branchChoiceEdgeIdsBySourceId: ReadonlyMap<string, string>;
  bodyFocusOwnerId?: string;
  embeddedFocusBoundaryId?: string;
  inspectorOpen: boolean;
  playback: {
    status: "idle" | "playing" | "paused" | "complete";
    activeHopIndex: number;
  };
};
```

browser runtime에서는 plain object/Map으로 사용할 수 있으나, public TypeScript
type은 위 의미를 유지한다. `view`는 narrow 화면에서 사용자가 직접 바꾼 선택만
session에 보존하며, wide 화면에서는 Map과 5-row Ledger window가 함께 보인다.
이 Webview는 browser route가 없는 VS Code panel이므로 lens/view를 URL query에
동기화하지 않는다. 대신 `sessionKey`가 같은 relayout에서만 보존하고 새 root나
graph version에서는 명시적으로 초기화한다.

### 6.3 Projection 출력

```ts
export type FunctionLogicAttentionLevel =
  | "active"
  | "related"
  | "context"
  | "muted";

export type FunctionLogicAttentionProjection = {
  nodeLevelById: ReadonlyMap<string, FunctionLogicAttentionLevel>;
  edgeLevelById: ReadonlyMap<string, FunctionLogicAttentionLevel>;
  excludedNodeIds: ReadonlySet<string>;
  excludedEdgeIds: ReadonlySet<string>;
  reasonByNodeId: ReadonlyMap<string, string>;
};
```

`reasonByNodeId`는 화면 copy가 아니라 test와 accessible summary에 사용할 bounded
semantic reason이다. 예: `selected`, `value-hop-target`, `branch-excluded`,
`embedded-context`.

### 6.4 우선순위

최종 attention은 아래 순서로 결정한다.

1. active playback endpoint 또는 직접 selected node → `active`
2. selected node의 1-hop predecessor/successor → `related`
3. active lens에 semantic하게 관련된 node/edge → `related`
4. selected branch에서 reachable하며 현재 body/eval frame 안인 항목 → `context`
5. current branch에서 제외되거나 focus frame 밖인 항목 → `muted`

예외:

- 사용자가 branch에서 제외된 node를 명시적으로 선택하면 selected node는
  `active`를 유지하고 Inspector에 “현재 branch scenario 밖의 node”를 표시한다.
- playback active가 selected node와 다르면 playback endpoint가 active이고 selected
  node는 related로 한 단계 낮춘다. active 두 개를 만들지 않는다.
- eval 내부 node 선택 시 해당 eval boundary는 `related`로 유지한다.
- source evidence를 열어도 attention state는 변하지 않는다.

### 6.5 DOM 표현

기존 opacity class를 점진적으로 다음 data attribute로 통합한다.

```html
<button
  class="logic-graph-node"
  data-attention="active"
  data-scenario="reachable"
  data-confidence="exact">
</button>
```

edge도 같은 attribute를 사용한다.

기존 `selected`, `choice-dimmed`, `data-flow-related`, `playback-active`는
migration 기간에 semantic hook으로만 남기고 opacity를 직접 소유하지 않는다.
최종 Phase에서는 visual opacity 규칙을 attention style 한 곳으로 이동한다.

### 6.6 Algorithm

반드시 반복 기반으로 구현한다.

1. graph mount 때 한 번:
   - `blocksById`
   - `incomingByTargetId`
   - `outgoingBySourceId`
   - `edgesById`
   - `blocksByKind`
   - `embeddedMembersByBoundaryId`
   를 만든다.
2. branch projection은 기존 `createFunctionLogicBranchChoiceProjection`을 재사용한다.
3. selected neighborhood는 incoming/outgoing index를 한 번 순회한다.
4. lens relevance는 kind와 binding/call/effect metadata를 순회한다.
5. body/eval focus가 있으면 queue + visited로 descendant membership을 계산한다.
6. 최종 level을 고정 우선순위 table로 합성한다.
7. DOM write는 `requestAnimationFrame` 한 번에서 batch한다.

재귀, 중첩 `querySelectorAll` 반복, node마다 전체 edge scan을 금지한다.

### 6.7 Complexity

- index 생성: O(V+E)
- state change projection: O(V+E+H)
- H는 active value hop 수이며 기존 max bound를 넘지 않는다.
- DOM read와 DOM write를 교차하지 않는다.
- projection 중 `getBoundingClientRect`, `offsetWidth`, `scrollTop`을 읽지 않는다.

---

## 7. Graph node 정보 구조

### 7.1 Stable node anatomy

모든 lens에서 node box의 geometry는 동일하다.

```text
┌ KIND · branch · confidence ─────────────┐
│ complete source-backed label            │
│ semantic slot: lens-relevant summary    │
└ source location / boundary relation ────┘
```

### 7.2 Row 규칙

#### Row 1: role

- kind text
- branch label
- `inferred`일 때만 confidence text
- body owner, child count, function label을 동시에 모두 넣지 않는다.
- 추가 의미는 최대 2개 compact badge만 허용한다.

#### Row 2: source

- source-authored line break와 indentation을 유지한다.
- ellipsis를 사용하지 않는다.
- `mountCodeSnippet`의 inert `textContent` token rendering을 유지한다.
- code font는 VS Code editor font를 사용한다.

#### Row 3: semantic slot

- node마다 최대 한 줄 높이를 예약한다.
- Flow: “2 paths”, “repeat”, “resume” 같은 structure summary
- Values: `total · UPDATED · 3 → 5`
- Calls: `audit() · immediate · exact`
- Effects: `FIELD order.status · assign`
- detail이 여러 개면 첫 항목 + `+N more`를 표시하고 Inspector에서 전체를 보인다.
- `+N more`는 hover tooltip에만 의존하지 않는다.
- source-derived identifier가 한 줄에 맞지 않으면 identifier 일부를 ellipsis로
  자르지 않는다. 대신 `1 value updated`, `2 child flows`처럼 count 기반 summary를
  사용하고 Inspector와 accessible label에서 complete text를 제공한다.
- semantic slot은 모든 lens에 같은 fixed line box를 사용해 wrap 때문에 node
  geometry가 바뀌지 않게 한다.

#### Row 4: meta

- compact source location 또는 embedded boundary breadcrumb
- detail prose 전체는 Inspector로 이동한다.

### 7.3 선택 시 geometry

- selected node의 크기, padding, border width가 바뀌지 않는다.
- box-shadow나 outline은 layout을 밀지 않는다.
- node 내부 detail을 선택 시 펼치지 않는다.
- 전체 detail은 Inspector에서 갱신한다.

### 7.4 의미별 shape

기존 grammar를 유지하고 명시적으로 제한한다.

| 의미 | shape/border | color role |
| --- | --- | --- |
| entry / exit | capsule | green semantic |
| decision / loop / switch / try | rounded control node | purple semantic |
| operation / call | rectangular | blue/focus semantic |
| render | rectangular + render label | blue semantic |
| event | dashed border | yellow/orange semantic |
| mutation / effect | solid left rule | orange semantic |
| embedded boundary | double border + enclosure header | blue semantic |
| callable definition | dashed + `not invoked` text | purple semantic |

색만으로 의미를 추가하지 않는다.

### 7.5 Click 책임 분리

반드시 한 action의 결과를 예측 가능하게 만든다.

- graph node primary click/Enter:
  - node 선택
  - Inspector summary 갱신
  - attention 갱신
- primary click은 VS Code text editor를 열지 않는다.
- Inspector 고정 영역의 `Open exact source` 또는
  `Open source expression` action이 evidence token을 보낸다.
- source action은 selected node 기준으로 한 번의 명시적 click이며, graph에서
  사용자의 위치와 selection을 보존한다.
- primary click은 child function을 attach/collapse하지 않는다.
- child attach/collapse는 Calls lens 또는 Inspector의 명시적
  “Open child flow” / “Collapse child flow” button으로 이동한다.
- body focus는 node click의 숨은 side effect가 아니다.
  - 해당 owner를 선택하면 Inspector에 “Focus this body” action을 표시한다.
- eval focus도 별도 “Focus eval region” action을 사용한다.

이 변경은 기존 README/SPEC의 “call block click으로 attach” 문구와 충돌하므로
Phase 0에서 명시적으로 계약을 갱신한다.

---

## 8. Edge와 branch interaction

### 8.1 Control edge

- exact: solid
- inferred/exception/back: dashed
- active: 2.4~2.6px equivalent
- related: base보다 약간 강함
- context: base
- muted: 낮은 opacity지만 완전히 숨기지 않음
- selected branch: line width + direct text label
- excluded branch: `muted` + Inspector text “Excluded by current branch choice”

### 8.2 Value edge

- Values lens와 selected binding이 있을 때만 보인다.
- control edge의 중앙 channel과 구분되는 기존 curved hop을 유지한다.
- consume은 dotted cue, sink는 double/striped cue와 text를 유지한다.
- inferred는 dash를 유지한다.
- playback가 끝나도 선택된 전체 route는 남아 spatial context를 제공한다.

### 8.3 Call / event edge

- immediate call: solid + `call`
- call return: dashed green semantic + `resume`
- event/deferred: dashed + `dispatch · no immediate return`
- definition-only: dashed + `defined · not invoked`
- edge text가 line style의 의미를 반복해 색 의존성을 없앤다.

### 8.4 Branch choice control

현재 interactive SVG `<text role="button">`는 native HTML button으로 교체한다.

구현 방식:

1. SVG에는 path와 non-interactive label만 둔다.
2. `logic-edge-choice-layer` HTML layer를 graph canvas 위에 추가한다.
3. selectable edge마다 layout의 `labelX`, `labelY`를 사용하는 absolute
   `<button type="button">`을 만든다.
4. button의 transform origin은 center다.
5. visual label은 compact해도 hit area는 최소 32×28 CSS px를 확보한다.
6. Inspector에는 같은 action의 full-size text button을 제공한다.
7. graph button과 Inspector button은 같은 branch controller를 호출한다.

VS Code desktop Webview라는 맥락에서 44px mobile touch target을 graph의 모든 edge
label에 강제하면 overlap이 심해진다. 따라서 graph canvas는 32×28 최소 hit area,
Inspector 대체 action은 36px 이상 높이를 사용한다. pointer coarse 환경에서는
media query로 44px까지 확장한다.

### 8.5 Branch selection 결과

- 선택된 arm, shared merge, 이후 continuation은 related/context로 남는다.
- sibling arm은 muted지만 위치와 label은 남는다.
- branch choice는 lens를 바꾸지 않는다.
- branch choice 변경 시 value playback은 정지하고 첫 hop으로 reset한다.
- selected binding 자체는 보존한다.
- branch reset은 모든 선택을 한 번에 해제한다.

### 8.6 Canvas layer와 stacking context

graph canvas는 하나의 의도적인 stacking context를 만들고 다음 scale만 사용한다.

| layer | z-index token | 내용 |
| --- | --- | --- |
| enclosure | 0 | body/eval compound frame |
| control edge | 10 | control path와 non-interactive label |
| value edge | 20 | selected binding hop |
| traveler | 24 | active value marker |
| graph node | 30 | semantic node button |
| selected node | 32 | focus ring이 edge에 가리지 않도록 한 selected node |
| edge choice | 40 | HTML branch choice button |

- `9999` 같은 임의 값은 사용하지 않는다.
- `transform`, `opacity`, `filter`가 새 stacking context를 만들 수 있음을 고려한다.
- choice layer가 node 위를 가로지르지 않도록 route/anchor overlap test를 둔다.
- Inspector는 canvas stacking context 밖의 grid sibling이며 graph 위에 overlay하지 않는다.
- child entry, lens transition이 layer 순서를 바꾸지 않는다.

---

## 9. Reading Rail과 Static Flow Ledger

### 9.1 Reading Rail

graph header 아래 한 줄로 다음을 표시한다.

```text
Start 1   →   Decisions 4   →   Changes 7   →   Finishes 2
```

- 각 항목은 button이다.
- 클릭하면 해당 category의 다음 reachable node를 선택한다.
- 마지막 node 뒤에서는 첫 node로 순환하되 live text로 알린다.
- count는 현재 branch scenario와 active graph composition을 반영한다.
- lens를 강제로 바꾸지 않는다.
- 현재 lens와 다른 category라면 node는 선택하되 Inspector에
  “Values lens에서 값 세부 정보 보기”처럼 명시적 action을 제공한다.

### 9.2 Static Flow Ledger

graph는 시각 사용자나 screen reader 사용자에게 유일한 표현이면 안 된다.
같은 attention/selection state를 공유하는 **Static Flow Ledger**를 만든다.

wide 화면의 Inspector에는 selected node를 중심으로 이전 2개, 현재 1개, 다음
2개를 보여 주는 5-row window를 항상 표시한다. “Show all N static steps”로 전체
ledger를 펼친다. 이 window는 별도 scroll 영역을 만들지 않는다.

narrow 화면에는 `Map / Steps` view control을 제공한다.

- Map이 기본이다.
- Steps는 graph를 삭제하지 않고 시각적으로 교체하며 같은 state를 공유한다.
- Steps에서 node를 선택하고 Map으로 돌아오면 같은 node가 선택되어 있다.
- lens, branch choice, selected binding, child attachment, eval focus가 보존된다.
- view 전환으로 analyzer/layout을 다시 실행하지 않는다.

- `<ol>`과 native button을 사용한다.
- 현재 branch에서 reachable한 node를 기본으로 표시한다.
- 정렬은 `layout.rank`, `layout.lane`, `x`, stable source order다.
- 각 node는 한 번만 포함한다.
- loop를 반복해서 펼치지 않는다.
- label은 “possible static reading order”라고 명시한다.
- 각 row는 kind, source label, confidence, outgoing summary를 포함한다.
- row action은 같은 selection controller를 사용한다.
- active row는 `aria-current="step"`을 사용한다.
- 최대 표시 수는 현재 graph block budget을 따른다.
- 많은 항목은 `content-visibility: auto`를 검토하되 Webview/Chromium 지원을
  확인하고 적용한다.
- branch에서 제외된 node를 “Show excluded context”로 포함할 수 있으나 기본
  ledger에서는 숨긴다. count와 copy로 제외된 항목 수를 알려 준다.
- Values lens에서는 selected binding과 관련된 step을 direct label로 표시하고,
  다른 step은 context로 유지한다.
- Calls/Effects lens도 같은 list를 다시 만들지 않고 semantic slot만 바꾼다.

### 9.3 Ledger는 runtime sequence가 아니다

다음 copy를 Help/description에 사용한다.

> “Ordered by the static graph layout. Branches and loops show possible structure,
> not an observed runtime sequence.”

UI heading에도 `Static Flow Ledger`라고 적고, “Execution trace”나 “Timeline”이라는
이름을 사용하지 않는다.

---

## 10. Keyboard model

### 10.1 Roving tabindex

- Webview의 첫 focusable 항목으로 평소에는 숨겨진 `Skip to graph`,
  `Skip to Static Flow Ledger`, `Skip to Inspector detail` anchor link를 제공하고
  focus될 때 보이게 한다. 각 target은 stable id와 programmatic focus target을
  가진다.
- graph node 중 selected node 하나만 `tabIndex=0`
- 나머지는 `tabIndex=-1`
- 선택이 없으면 entry가 0
- Tab은 graph toolbar → viewport → selected node → Inspector 순서로 이동
- 120개 node를 모두 Tab으로 통과하게 하지 않는다.

### 10.2 Node focus navigation

node가 focus된 상태:

- `ArrowDown`: outgoing target 중 가장 가까운 primary continuation
- `ArrowUp`: incoming source 중 가장 가까운 predecessor
- `ArrowLeft` / `ArrowRight`: 같은 rank의 이전/다음 lane node
- `Home`: root entry
- `End`: 현재 scenario의 첫 explicit exit
- `Enter` 또는 `Space`: node 선택
- `Escape`: Inspector가 열려 있으면 닫음

선택 후보가 여러 개면 아래 순서를 사용한다.

1. selected branch edge
2. exact edge
3. `next`, `true`, `iterate`, `case`, `exit`의 stable semantic priority
4. target center의 x 거리
5. edge id stable order

node keyboard handler는 viewport pan handler로 event가 올라가지 않게 처리한다.

### 10.3 Viewport focus

empty viewport가 focus된 상태:

- 기존 `+`, `-`, `0`, `C`, `F` 유지
- arrow key는 canvas pan에 사용 가능
- node focus와 역할이 명확히 다르다.
- `aria-keyshortcuts`와 visible help text를 현재 실제 shortcut과 일치시킨다.

### 10.4 Branch keyboard

- selected condition node의 HTML edge-choice button만 graph Tab order에 참여한다.
- 다른 edge choice는 `tabIndex=-1`
- Inspector의 branch action은 항상 일반 Tab order로 접근 가능하다.
- Enter/Space가 같은 toggle을 수행한다.

### 10.5 Focus 복원

- Inspector close → Inspector toggle
- lens 변경 → pressed lens button에 focus 유지
- child attach relayout → callsite node screen anchor와 focus 복원
- child collapse → collapse action을 소유한 callsite node로 복원
- source editor open 후 Webview로 복귀 → 이전 selected node 유지

---

## 11. Inspector 재구성

### 11.1 목적

Inspector는 모든 기능을 쌓는 drawer가 아니라 현재 질문에 필요한 detail과 action을
제공하는 보조 기억 장치다.

### 11.2 고정 영역

Inspector header:

- `FUNCTION INSPECTOR`
- selected node의 concise label
- 현재 lens
- close button

Inspector body 첫 section:

- kind + exact/inferred
- complete selected source label
- source location
- 현재 branch/body/eval context
- source precision에 맞는 “Open exact source” 또는
  “Open source expression” action

이 section은 lens와 무관하게 항상 첫 번째다.

### 11.3 Lens별 section 순서

#### Flow

1. selected node summary
2. 5-row Static Flow Ledger window
3. outgoing paths / branch choices
4. condition case table
5. current scenario summary
6. body/eval focus action
7. full Static Flow Ledger disclosure
8. function signature

#### Values

1. selected node + selected binding summary
2. 5-row Static Flow Ledger window
3. binding selector
4. value-flow playback
5. Scenario Variables
6. Scenario calculation
7. all accesses for selected node
8. full Static Flow Ledger disclosure

#### Calls

1. selected boundary summary
2. 5-row Static Flow Ledger window
3. explicit attach/collapse action
4. relation: immediate / render / event / deferred / definition-only
5. direct callees
6. current attached child breadcrumb
7. eval embedded context
8. full Static Flow Ledger disclosure

#### Effects

1. selected node summary
2. 5-row Static Flow Ledger window
3. changed values/fields/receivers
4. consume/sink
5. outgoing exit/throw/return
6. confidence and verification note
7. full Static Flow Ledger disclosure

### 11.4 Scenario Variables 정책 변경

현재 “항상 Inspector 최상단” 계약을 다음으로 바꾼다.

- Values lens에서는 상단 고정 영역 바로 아래에 둔다.
- 다른 lens에서는 compact “Open Values” summary만 표시한다.
- 사용자가 Values section을 pin하는 기능은 이번 범위에 넣지 않는다.
- 입력 session, custom variable, bounded evaluator는 그대로 보존한다.
- lens를 바꿔도 입력값은 삭제하지 않는다.

### 11.5 Inspector open 정책

- wide ≥ 1040px: 새 root graph에서 open
- medium 840~1039px: 이전 session 선택을 유지, 최초에는 closed
- narrow < 840px: summary row만 보이고 body는 collapsed
- node를 직접 선택해도 Inspector가 graph를 덮지 않는다.
- selected node summary는 narrow collapsed row에도 보인다.
- user open/close 상태는 same-root relayout에서 유지한다.

### 11.6 Scroll

- graph viewport와 Inspector body는 독립 scroll을 유지한다.
- Inspector 안에서 nested scroll은 Scenario variable list 한 곳만 허용한다.
- 전체 drawer와 reading list가 동시에 별도 scroll container가 되지 않게 한다.
- sticky header가 content를 가리지 않도록 scroll padding을 둔다.

---

## 12. Values lens와 animation

### 12.1 진입

- Values lens 진입만으로 binding을 자동 선택하지 않는다.
- selector는 “Choose a value to trace” empty state를 보인다.
- scenario row의 variable name이나 graph의 value summary를 누르면 같은 binding
  selection action을 호출한다.

### 12.2 Variable 선택

binding을 직접 선택하면:

1. Values lens가 아니면 Values lens로 전환한다.
2. binding button과 관련 node를 강조한다.
3. reachable value hop만 표시한다.
4. one bounded playback pass를 시작한다.
5. Inspector status에 현재 hop semantic을 text로 표시한다.

같은 binding을 다시 누르면 overlay를 끄되 scenario input은 유지한다.

### 12.3 Playback

기존 계약을 유지한다.

- initial graph render에서 motion 금지
- direct binding selection에서 1회 시작
- Play/Pause/Previous/Next/Replay
- 220ms hop
- active hop 하나와 endpoint 두 개만 transient emphasis
- interruptible
- branch change, binding change, graph close에서 reset
- reduced motion에서 marker travel 없이 active hop 상태 즉시 표시

### 12.4 Lens 이탈

- Values → 다른 lens:
  - playback pause
  - marker 숨김
  - selected binding은 보존
  - value edge는 숨김
- Values로 돌아오면 paused state를 복원하되 자동 재생하지 않는다.

### 12.5 Empty와 error

- binding 없음:
  - “No analyzer-backed values were found.”
  - Custom variable 기능은 유지
  - static value edge가 없음을 명시
- binding은 있으나 flow 없음:
  - “This value has no bounded definition-to-use route.”
  - scenario input과 local access는 계속 사용 가능
- evaluator unknown:
  - 원인 + 다음 검증 action
  - runtime call, getter, dynamic key 등을 실행하지 않았음을 명시

---

## 13. eval과 static embedded code의 inline 실행 흐름

이 section은 이전 요청의 핵심 요구사항이며 반드시 구현한다.

### 13.1 사용자에게 보여 줄 mental model

direct static eval은 host 함수 속에 놓인 작은 실행 영역이다.

```text
host statement
    ↓
┌─ eval · immediate · caller lexical scope ─────────┐
│ embedded entry                                    │
│ total += 2                                        │
│ if (total > 5) ─ true → audit(total)              │
│ embedded exit                                     │
└───────────────────────────────────────────────────┘
    ↓ resume host flow
return total
```

다음은 같은 표현을 사용하면 안 된다.

- `globalThis.eval`: global scope, caller lexical bridge 없음
- `Function(...)`: definition-only 또는 별도 invocation semantics
- timer string: deferred, immediate host return 없음
- stored code: definition-only/inferred
- dynamic string: 내부 graph 없음, explicit limitation
- shadowed `eval` identifier: 일반 call

### 13.2 Protocol metadata

UI가 label 문자열을 파싱해 eval 의미를 추측하지 않도록 명시적 metadata를 추가한다.

```ts
export type FunctionLogicEmbeddedConsumerPayload =
  | "directEval"
  | "globalEval"
  | "functionConstructor"
  | "timer"
  | "nodeVm"
  | "storedProgram";

export type FunctionLogicEmbeddedExecutionPayload =
  | "immediate"
  | "deferred"
  | "definition";

export type FunctionLogicEmbeddedScopePayload =
  | "callerLexical"
  | "global"
  | "isolated"
  | "unknown";

export type FunctionLogicEmbeddedSourcePrecisionPayload =
  | "exactNodeRange"
  | "hostExpressionRange";

export type FunctionLogicEmbeddedProgramId =
  `function-logic-embedded:${string}`;

export type FunctionLogicEmbeddedProgramPayload = {
  id: FunctionLogicEmbeddedProgramId;
  boundaryBlockId: string;
  consumer: FunctionLogicEmbeddedConsumerPayload;
  execution: FunctionLogicEmbeddedExecutionPayload;
  scope: FunctionLogicEmbeddedScopePayload;
  visibleBlockCount: number;
  omittedBlockCount: number;
};

export type FunctionLogicEmbeddedMembershipPayload = {
  programId: FunctionLogicEmbeddedProgramId;
  boundaryBlockId: string;
  role: "boundary" | "entry" | "statement" | "exit" | "callable";
  sourcePrecision: FunctionLogicEmbeddedSourcePrecisionPayload;
};
```

`FunctionLogicPayload`에 optional `embeddedPrograms` array를 추가하고,
`FunctionLogicBlockPayload`에는 optional `embeddedMembership`을 추가한다. program
공통 의미와 count를 모든 inner block에 복제하지 않는다.

### 13.3 Analyzer → protocol mapping

#### Analyzer

- `src/analyzer/functionLogic/types.ts`에 analyzer-local embedded context type 추가
- `src/analyzer/functionLogic/embeddedCode/types.ts`의 discovery/request 정보를
  expansion block metadata로 보존
- inner statement마다 boundary owner와 source precision을 기록
- analysis result에 bounded embedded program summary를 한 번만 기록
- direct/global scope 차이를 명시
- label이나 detail 문자열을 metadata source로 사용하지 않음

#### Application projection

- analyzer-local block/boundary id를 opaque protocol block id로 매핑
- `programId`도 snapshot-local opaque id로 hash
- member가 가리키는 program/boundary가 모두 projected됐을 때만 membership 전달
- raw file path/range를 embedded metadata에 넣지 않음
- evidence는 기존 opaque `evidenceToken`을 사용

#### Runtime validation

- protocol runtime validator가 optional field의 enum, id, non-negative count를 확인
- program id는 array 안에서 unique여야 한다.
- membership의 program과 boundary가 실제 payload에 존재하고 서로 일치해야 한다.
- boundary block의 membership role은 `boundary`여야 한다.
- 잘못된 optional embedded metadata는 해당 program/membership만 drop하고 graph
  block/edge 자체는 보존한다. core graph payload가 잘못된 경우와 구분한다.

### 13.4 Embedded region visual

새 `embeddedCode` Webview 모듈이 다음을 소유한다.

- boundary enclosure
- header label
- member lookup
- focus action
- selected inner node와 boundary의 연동
- responsive style

header 예시:

- `eval · immediate · caller scope · 4 steps`
- `global eval · immediate · global scope · 3 steps`
- `timer text · deferred · 5 steps`
- `stored code · definition only · inferred`

`caller scope`, `global scope`, `deferred`, `not invoked`는 색뿐 아니라 text로 쓴다.

### 13.5 기본 확장 정책

embedded inner node를 별도 drawer나 child graph로 숨기지 않는다.

- 분석 budget 안의 inner flow는 same canvas에 그대로 보인다.
- boundary enclosure로 하나의 chunk로 묶는다.
- large region도 임의 CSS collapse로 빈 layout 공간을 만들지 않는다.
- 분석 상한을 넘은 경우 boundary header에 `+N omitted by analysis limit`를 표시한다.
- 집중이 필요하면 “Focus eval region”으로 body-focus와 같은 focus+context 상태를
  사용한다.

### 13.6 eval focus

“Focus eval region”을 누르면:

- eval 내부 member와 boundary가 active/related
- host predecessor와 resume successor는 context
- 다른 host node는 muted
- node/edge geometry는 바뀌지 않음
- breadcrumb:
  - `Host function`
  - `eval(code)`
  - selected inner statement
- “Back to host flow” action으로 focus 해제

### 13.7 내부 node 선택 강조

eval 내부 node를 선택하면 반드시 다음이 동시에 일어난다.

1. inner node `active`
2. eval enclosure `related`
3. incoming/outgoing embedded edge `related`
4. host eval callsite와 resume edge `context`
5. Inspector에 `Inside eval · statement N of M`
6. Inspector의 inert code snippet에 complete inner statement 표시
7. Static Flow Ledger에서 같은 row `aria-current="step"`

다른 inner node를 선택할 때 enclosure나 canvas 위치가 흔들리면 안 된다.
그 뒤 `Open exact source` 또는 `Open source expression`을 누르면 해당 evidence
token의 source range를 editor에서 강조한다.

### 13.8 Source highlight precision

#### `exactNodeRange`

- plain literal/no-substitution template에서 internal node의 host literal substring을
  exact evidence로 연다.
- Inspector copy: `Exact range inside static eval text`
- source editor selection은 node마다 서로 다른 range여야 한다.

#### `hostExpressionRange`

literal concatenation, alias resolution, escape remap 등 exact offset을 보장할 수 없는
경우:

- host expression 또는 전체 literal evidence를 연다.
- Inspector copy:
  `Composed static text · the complete source expression is highlighted`
- graph node 자체의 selected emphasis는 유지한다.
- exact substring이라고 주장하지 않는다.

### 13.9 Value flow across eval

direct eval + caller lexical scope에서:

- host definition → eval inner read/write
- eval inner write → later host read
- branch와 loop-carried relation
을 같은 binding id와 Values lens로 표시한다.

global eval, isolated VM, definition-only에서는 caller lexical bridge를 표시하지 않는다.

### 13.10 eval interaction acceptance cases

반드시 fixture/test로 검증한다.

1. `const code = "total += 2; ..."; eval(code);`
   - host `total`과 inner write가 같은 value flow
2. `eval("let total = 1; audit(total);")`
   - 두 inner node가 서로 다른 exact source range
3. `flag && eval("audit();")`
   - true arm에만 embedded boundary
4. `globalThis.eval("total += 1")`
   - immediate지만 caller lexical bridge 없음
5. shadowed `eval`
   - embedded region 없음
6. literal-only concatenation
   - inner graph 존재, source precision fallback 명시
7. substitution template / runtime concatenation
   - inner graph 없음, dynamic limitation
8. invalid top-level eval control syntax
   - parse limitation과 host continuation 보존
9. bounded large embedded program
   - omitted count와 no infinite traversal
10. selected inner node
   - graph, Inspector, editor evidence가 같은 node를 가리킴

---

## 14. Calls, render, event 흐름

### 14.1 Calls lens

Calls lens는 다음 boundary만 전경으로 올린다.

- direct call
- constructor
- JSX render
- event registration/handler
- embedded code
- callable definition
- attached child entry/exit/resume

### 14.2 명시적 expansion

selected node Inspector에 relation별 action을 제공한다.

- `Open called function flow`
- `Open rendered component flow`
- `Open event handler flow`
- `Collapse attached flow`
- `Focus eval region`

button label은 “Open” 하나로 축약하지 않는다.

### 14.3 child loading

- action을 누르면 button disabled + `Loading child flow…`
- selected callsite와 canvas anchor를 유지
- 완료 시 boundary connector 한 개만 180~220ms fade/translate
- 모든 child node를 rank별 stagger animation하지 않는다.
- error 시 callsite 근처가 아니라 Inspector action 아래에 원인과 retry를 표시
- stale graph version response는 기존 guard로 무시

### 14.4 event

- registration continuation과 handler dispatch를 함께 보인다.
- handler → caller return edge를 만들지 않는다.
- text: `dispatch · no immediate return`
- event가 call처럼 보이지 않도록 dashed line과 label을 함께 사용한다.

---

## 15. Effects lens

### 15.1 전경 대상

- exact variable/property write
- receiver mutation candidate
- call/constructor/getter sink
- external message/network/storage effect candidate
- return/throw

### 15.2 exact와 inferred

- exact mutation: solid border/line + `exact`
- inferred receiver mutation: dashed + `inferred`
- reason을 Inspector에 표시
- warning/error 색을 일반 inferred에 사용하지 않는다.

### 15.3 값 표시

- graph node semantic slot에는 target + operation 하나만 표시
- `before → after`는 Scenario 계산 결과가 있을 때만 표시
- unknown은 값을 꾸며내지 않고 reason을 표시
- multiple reachable values는 임의 하나를 선택하지 않는다.

---

## 16. Responsive layout

### 16.1 Breakpoint

| 폭 | layout | Inspector |
| --- | --- | --- |
| ≥ 1040px | graph + right column | 기본 open, 300~390px |
| 840~1039px | graph + optional right column | 최초 closed, user state 유지 |
| 431~839px | graph 위, Inspector 아래 | summary row + expandable body |
| ≤ 430px | lens 2×2, single-column controls | 아래, compact |

breakpoint는 editor Webview 실제 폭을 기준으로 한다. user agent나 device 이름을
기준으로 분기하지 않는다.

### 16.2 Graph height

- wide: 기존 최대 76vh bounded workspace 유지
- narrow below-Inspector: graph가 최소 52vh 또는 360px 중 가능한 값을 확보
- Inspector expanded body는 최대 38~42vh
- viewport와 Inspector가 모두 화면 밖으로 밀려 page 전체가 이중 scroll되지 않게
  root layout을 검증

### 16.3 Narrow 우선순위

좁은 폭에서 숨기거나 접는 순서는 다음과 같다.

1. complete legend 접기
2. Inspector advanced sections 접기
3. Reading Rail label을 축약하되 text alternative 유지
4. lens를 2×2로 wrap

다음은 숨기지 않는다.

- active lens
- selected node summary
- source action
- graph viewport controls
- exact/inferred text
- current branch/binding/playback status

### 16.4 Long text

- identifier와 source label은 `overflow-wrap:anywhere` + `white-space:pre-wrap`
- flex/grid child에 `min-width:0`
- code를 ellipsis로 잘라 의미를 잃지 않음
- narrow node width는 layout engine이 계산하고 height를 늘림
- Inspector copy는 readable line-height를 유지

---

## 17. 상태 계약

모든 상태는 구현과 test에 포함한다.

| 상태 | Graph | Inspector | Action |
| --- | --- | --- | --- |
| loading root | 기존 graph가 있으면 유지, status만 갱신 | loading message | 중복 request disabled |
| empty | 빈 canvas 아님, 이유 text | 가능한 next step | source/function 다시 선택 |
| unsupported | 지원 범위와 limitation | source context | docs/other flow action |
| parse limited | 보존 가능한 graph 표시 | gap reason | source verify |
| default Flow | control graph만 전경 | selected summary | lens/reading rail |
| hover | contrast 증가, geometry 불변 | 없음 | 없음 |
| focus-visible | 2px equivalent ring | matching label | Enter/Space |
| selected | active node 1개 | complete detail | open source |
| branch selected | reachable path related | scenario summary | reset |
| branch excluded selected | node active + outside badge | excluded reason | reset/jump back |
| no binding | value edge 없음 | explanatory empty | custom variable |
| binding selected | relevant nodes/edge | playback + scenario | pause/next |
| playback playing | active hop 1개 | live status | pause |
| playback complete | route 유지 | complete status | replay |
| child loading | callsite active | inline progress | cancel은 필수 아님 |
| child error | 기존 graph 유지 | cause + retry | retry |
| child attached | same canvas | collapse action | collapse |
| eval exact | enclosure + inner nodes | exact range text | source |
| eval fallback | enclosure + inner nodes | composed text note | source expression |
| dynamic eval | no invented inner graph | limitation | source |
| narrow Steps view | Map과 같은 selection/lens state | full Static Flow Ledger | Map 복귀 |
| dense graph | LOD가 아니라 lens로 정리 | reading list bounded | fit/focus |
| reduced motion | 즉시 상태 전환 | 같은 status text | all actions |
| forced colors | system border/text | system focus | all actions |

### 17.1 Loading 정책

분석이 300ms보다 길어질 때:

- 이미 graph가 있으면 지우지 않고 stale overlay 없이 status만 표시
- 첫 load면 function skeleton을 꾸며내지 말고 bounded loading block을 표시
- `Loading…`에 ellipsis character `…` 사용
- 완료/실패 message는 `aria-live="polite"`

### 17.2 Error copy

error는 문제 + 복구 action을 포함한다.

나쁜 예:

> Failed.

좋은 예:

> Child flow could not be analyzed for this snapshot. Keep the current graph or
> retry after the file finishes parsing.

### 17.3 Disabled control

- 실제 실행할 수 없는 action은 native `disabled`를 사용한다.
- disabled와 loading을 같은 모양으로 처리하지 않는다.
- disabled 이유가 문맥상 명확하지 않으면 control 옆 helper text에 설명한다.
- disabled는 낮은 emphasis와 `not-allowed` cursor를 사용하되 text contrast를
  읽을 수 없을 정도로 낮추지 않는다.
- `aria-disabled`만 두고 click handler가 동작하는 상태를 만들지 않는다.

---

## 18. Accessibility 계약

### 18.1 Semantic HTML

- action은 `<button>`
- source navigation이 실제 link semantics를 가질 수 없으므로 Host message action은
  button 유지
- section heading은 실제 heading level 사용
- legend disclosure는 `<details>/<summary>` 또는 button + region
- Static Flow Ledger는 `<ol>`
- Scenario field는 visible `<label>`과 연결
- Scenario code/value input은 meaningful `name`, `autocomplete="off"`,
  `spellcheck="false"`를 사용한다.
- decorative SVG path/icon은 `aria-hidden="true"`
- source code, identifier, signature는 `translate="no"`를 사용한다.

### 18.2 Graph summary

viewport에 `aria-describedby`로 연결된 bounded summary를 둔다.

예:

> “Static function graph with 24 blocks, 4 decisions, 2 exits, and 1 inline eval
> region. Flow lens active. One branch choice applied.”

summary는 state change마다 과도하게 live announce하지 않는다. 직접 lens, branch,
binding action의 결과만 polite live region에 알린다.

### 18.3 Focus

- `outline:none`은 동등하거나 더 강한 focus-visible replacement가 있을 때만 사용
- forced colors에서 system `Highlight`/`CanvasText`로 focus를 표시
- mouse click에 불필요한 ring을 강제하지 않되 keyboard focus는 항상 보임
- DOM focus order는 visual order와 일치

### 18.4 Color와 contrast

- 일반 text 4.5:1 목표
- non-text graph line과 focus 3:1 목표
- exact/inferred, consume/sink, call/event는 color-only 금지
- VS Code theme별 token 조합을 실제 Light+, Dark+, High Contrast에서 측정
- `color-mix` fallback이 필요한 VS Code minimum Chromium 여부 확인

### 18.5 Motion

- `prefers-reduced-motion: reduce` 지원
- transform/opacity만 animation
- `transition: all` 금지
- animation 중 user action이 즉시 cancel 가능
- animation이 input을 block하지 않음

### 18.6 Text scale

- `--vscode-font-size`, `--vscode-editor-font-size` 상대 token 유지
- playback step, count, zoom percentage에는 `font-variant-numeric: tabular-nums`
- 200% zoom에서 button label wrap
- fixed px height 안에 text를 clip하지 않음
- graph node layout test에 긴 multi-line source 포함

### 18.7 Screen reader alternative

graph SVG 자체를 완전한 tree widget으로 과도하게 ARIA 모델링하지 않는다.
다음을 함께 제공한다.

- viewport summary
- roving node focus
- Static Flow Ledger `<ol>`
- Inspector의 path/value/call text
- source verification action

---

## 19. Motion contract

### 19.1 Token

```css
--logic-motion-instant: 0ms;
--logic-motion-fast: 120ms;
--logic-motion-base: 180ms;
--logic-motion-flow-hop: 220ms;
--logic-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
```

### 19.2 허용 motion

- lens semantic layer opacity: 120ms
- Inspector open/close: 170~180ms
- child boundary connector: 180~220ms
- value hop marker: 220ms

### 19.3 금지 motion

- initial graph 전체 stagger
- 모든 child node rank stagger
- hover scale
- continuous pulse/glow
- muted node fade loop
- viewport 자동 pan과 value marker 이동을 동시에 실행

### 19.4 선택 시 자동 pan

기본 node selection은 viewport를 자동 이동하지 않는다.

다음 경우에만 bounded `ensureVisible`을 사용한다.

- Reading Rail로 화면 밖 node를 선택
- keyboard arrow navigation으로 화면 밖 node로 이동
- Static Flow Ledger row에서 node 선택

`ensureVisible`은 150~180ms transform 또는 reduced-motion 즉시 이동이며, 현재
zoom을 유지한다.

---

## 20. Performance와 대형 graph

### 20.1 Budget

현재 제품 budget을 유지한다.

- Function Logic default block bound: 120
- configurable maximum: 300
- rendered graph broader bound: 500
- value-flow hop bound: 기존 1,500
- scenario work/item bound: 기존 SPEC 유지

### 20.2 Update 전략

- lens, selection, branch, binding state change로 graph DOM을 재생성하지 않는다.
- layout을 다시 계산하지 않는다.
- class/data attribute만 batch update한다.
- graph session마다 index를 한 번 생성하고 relayout 때 명시적으로 dispose한다.
- event listener를 node마다 중복 재등록하지 않도록 controller lifecycle을 둔다.

### 20.3 DOM read/write

나쁜 패턴:

```ts
for (const node of nodes) {
  const rect = node.getBoundingClientRect();
  node.style.opacity = compute(rect);
}
```

허용 패턴:

1. 필요한 geometry를 mount/resize 시 한 번 읽음
2. pure projection 계산
3. `requestAnimationFrame`에서 attribute write

### 20.4 LOD

이번 범위에서 node를 canvas/WebGL로 바꾸지 않는다.

- 300개 이하에서는 기존 HTML node + SVG edge를 유지
- 더 큰 graph는 analyzer/projector bound와 lazy child expansion으로 제한
- node label을 축약하는 LOD는 source fidelity를 깨므로 도입하지 않음

---

## 21. 모듈 설계

### 21.1 새 폴더

```text
src/webview/codeFlow/
  comprehension/
    index.ts
    types.ts
    functionLogicAttentionProjection.ts
    functionLogicComprehensionBrowserSource.ts
    functionLogicComprehensionStyles.ts
    functionLogicKeyboardNavigationBrowserSource.ts
  presentation/
    index.ts
    functionLogicGraphHeaderBrowserSource.ts
    functionLogicNodeBrowserSource.ts
    functionLogicEdgeBrowserSource.ts
  embeddedCode/
    index.ts
    functionLogicEmbeddedRegionBrowserSource.ts
    functionLogicEmbeddedRegionStyles.ts
```

### 21.2 책임

#### `comprehension`

- active lens와 session state
- pure attention projection
- keyboard navigation
- DOM adapter
- live announcement

다음을 소유하지 않는다.

- analyzer semantics 생성
- Host source open
- graph layout
- Scenario expression evaluation

#### `presentation`

- graph header와 Reading Rail markup
- stable node anatomy
- control edge와 HTML branch label layer
- visual-only formatting

다음을 소유하지 않는다.

- selection state
- branch reachability
- value evaluator

#### `embeddedCode`

- embedded region metadata presentation
- enclosure와 breadcrumb
- focus action
- exact/fallback copy

다음을 소유하지 않는다.

- embedded source parsing
- lexical bridge 계산
- evidence token 발급

### 21.3 기존 파일 축소

`functionLogicBrowserSource.ts`는 orchestration entrypoint만 남긴다.

목표 책임:

1. feature browser source 조합
2. graph session 생성/dispose
3. controller 연결
4. root render 반환

node/edge/header implementation을 새 `presentation` 모듈로 옮겨 500~650줄 이하를
목표로 한다.

`functionLogicGraphStyles.ts`는 base graph token과 imports만 남기고 새 style을
feature folder로 이동한다.

### 21.4 Public API

`comprehension/index.ts`가 다음만 export한다.

```ts
export {
  createFunctionLogicAttentionProjection
} from "./functionLogicAttentionProjection";

export type {
  FunctionLogicAttentionProjection,
  FunctionLogicComprehensionState,
  FunctionLogicLens
} from "./types";

export {
  getFunctionLogicComprehensionBrowserSource
} from "./functionLogicComprehensionBrowserSource";

export {
  getFunctionLogicComprehensionStyles
} from "./functionLogicComprehensionStyles";
```

다른 feature가 `comprehension` 내부 파일을 deep import하지 않는다.

### 21.5 Controller adapter

browser controller는 feature internals를 직접 호출하지 않고 adapter를 받는다.

```ts
type FunctionLogicComprehensionAdapters = {
  selectBlock(blockId: string, origin: SelectionOrigin): void;
  openEvidence(blockId: string): void;
  setBranchChoice(edgeId?: string): void;
  selectBinding(bindingId?: string): void;
  controlPlayback(action: PlaybackAction): void;
  setBodyFocus(ownerId?: string): void;
  setEmbeddedFocus(boundaryId?: string): void;
  attachDrillTarget(blockId: string, targetId: string): void;
};
```

실제 browser source는 type annotation 없이 생성될 수 있지만 계약과 test helper는
이 의미를 유지한다.

### 21.6 의존성 방향

```text
analyzer/embeddedCode
        ↓
application/codeFlow projection + layout
        ↓
protocol/functionLogic
        ↓
webview/codeFlow/functionLogicBrowserSource  (composition root)
        ├── comprehension  (state + pure attention projection)
        ├── presentation   (node/edge/header rendering)
        ├── inspector
        ├── dataFlow
        └── embeddedCode
```

- analyzer는 Webview type에 의존하지 않는다.
- presentation은 analyzer type에 의존하지 않고 comprehension의 public projection만
  소비한다.
- protocol은 DOM에 의존하지 않는다.
- comprehension pure projection은 VS Code API에 의존하지 않는다.
- comprehension controller는 inspector/dataFlow/embeddedCode 내부 파일을 import하지
  않고 composition root가 넘긴 adapter만 호출한다.
- Webview는 file path/range를 직접 받지 않는다.

---

## 22. 기존 파일별 변경 목록

### `PRODUCT.md`

- 이번 문서 작성과 함께 추가됨
- 구현 중 visual token이나 layout recipe를 넣지 않는다.
- 실사용자 evidence가 생겼을 때만 Evidence section을 갱신한다.

### `DESIGN.md`

- value-flow playback 계약을 보존
- 상위에 Function Logic global design direction 추가
- lens, attention priority, stable geometry, eval enclosure 기록
- 구현 후 실제 살아남은 motion/token만 확정값으로 갱신

### `SPEC.md`

다음 계약 변경을 명시한다.

- default Flow lens와 no default binding overlay
- lens-aware Inspector order
- node click 책임과 explicit child expansion
- Static Flow Ledger
- attention projection
- embedded context metadata와 exact/fallback highlight
- responsive breakpoint와 Inspector open policy
- accessibility와 keyboard model

### `README.md`

사용자 기능이 실제 완료된 뒤 다음을 갱신한다.

- Flow/Values/Calls/Effects 사용법
- variable click playback
- explicit child flow action
- eval inline region
- Static Flow Ledger와 keyboard

### `src/analyzer/functionLogic/types.ts`

- optional embedded context type
- field comment에 identity, scope, source precision 의미

### `src/analyzer/functionLogic/embeddedCode/*`

- discovery metadata를 expansion block까지 전달
- direct/global/shadowed/dynamic 구분 유지
- exact node range와 fallback 구분
- queue/budget 기존 원칙 유지

### `src/application/codeFlow/codeFlowFunctionLogicProjection.ts`

- embedded local id → opaque protocol id
- no label sniffing
- malformed optional context를 안전하게 생략

### `src/application/codeFlow/functionLogicGraphLayout.ts`

- stable one-row semantic slot을 node measurement에 반영
- HTML branch button label anchor는 기존 `labelX/Y` 재사용
- embedded boundary enclosure header padding 반영
- lens 전환으로 재계산하지 않음

### `src/protocol/functionLogic.ts`

- embedded context payload type
- comment로 static/non-runtime 의미 명시
- raw range/path를 추가하지 않음

### `src/webview/codeFlow/functionLogicBrowserSource.ts`

- node/edge/header function 추출
- comprehension controller 생성
- feature adapter wiring
- click side effect 분리
- source open을 selection action과 명시적으로 연결

### `src/webview/codeFlow/functionLogicSelectionBrowserSource.ts`

- 직접 edge opacity toggle 제거
- selected semantic state만 controller에 전달
- Inspector selected summary renderer 유지/분리

### `src/webview/codeFlow/branchChoices/*`

- pure reachability projection 재사용
- DOM adapter가 attention controller에 semantic state 전달
- HTML edge choice button 생성은 presentation으로 이동

### `src/webview/codeFlow/dataFlow/*`

- default selected binding 제거
- Values lens visibility
- playback lifecycle을 comprehension event와 동기화
- opacity class 소유권을 attention으로 이동

### `src/webview/codeFlow/bodyFocus/*`

- hidden node click side effect 제거
- explicit focus action
- embedded focus와 공통 focus-context 의미 공유
- hierarchy traversal 반복 기반 유지

### `src/webview/codeFlow/inspector/*`

- shell과 lens section 분리
- selected summary 고정
- Static Flow Ledger
- responsive open policy
- focus restore

### `src/webview/codeFlow/viewport/*`

- node arrow navigation과 viewport pan event 분리
- `ensureVisible` adapter 추가
- reduced-motion-aware bounded move

### `src/test/unit/functionVisualizerWebview.test.ts`

현재 1,800줄대이므로 새 기능 test를 계속 추가하지 않는다.

다음으로 분리한다.

```text
src/test/unit/functionVisualizer/
  functionVisualizerShell.test.ts
  functionVisualizerSelection.test.ts
  functionVisualizerValues.test.ts
  functionVisualizerEmbeddedCodeUi.test.ts
  functionVisualizerAccessibility.test.ts
  helpers/functionVisualizerRuntime.ts
```

기존 test를 단순 복사해 중복 실행하지 말고 책임별로 이동한다.

---

## 23. 구현 Phase

각 Phase는 독립 commit 단위로 만들 수 있어야 한다. 실제 commit 여부는 사용자
지시에 따른다.

### Phase 0 — 계약과 baseline 고정

#### 작업

1. `DESIGN.md`에 global Function Logic contract 추가
2. `SPEC.md`에 lens/selection/eval/accessibility 계약 추가
3. 기존 DOM runtime fixture를 별도 helper로 추출할 준비
4. 현재 UI의 functional baseline test 실행
5. representative fixture 목록 고정

#### fixture

- `complexOrderWorkflow.ts`
- `event_handler_flow.ts`
- `expression_branch_flow.ts`
- `jsx_component_flow.tsx`
- `embedded_code_programs.ts`
- direct eval const resolver inline fixture

#### 완료 조건

- 문서와 기존 행동의 intentional change가 표로 기록됨
- full typecheck 통과
- 기존 unit test 결과 기록
- 아직 visual behavior 변경 없음

### Phase 1 — Comprehension state와 attention pure module

#### 작업

1. `comprehension/types.ts`
2. `functionLogicAttentionProjection.ts`
3. graph index builder
4. reducer/event model
5. pure unit test

#### test case

- default Flow
- selected neighborhood
- branch excluded
- selected outside branch
- Values no binding
- selected binding
- playback active priority
- body focus
- eval focus
- malformed cycle
- depth/budget

#### 완료 조건

- recursion 없음
- O(V+E) 구조
- DOM import 없음
- 100% deterministic output

### Phase 2 — Presentation 분리와 stable node

#### 작업

1. graph header/node/edge를 `presentation` 폴더로 이동
2. `functionLogicBrowserSource.ts` 축소
3. node stable semantic slot
4. 9-item legend를 contextual legend로 변경
5. unicode structural glyph를 CSS swatch + text로 변경

#### 완료 조건

- main browser source 800줄 미만
- lens 없이도 기존 Flow 기능 유지
- node selection geometry 불변
- long source wrap test 통과

### Phase 3 — Lens Bar와 attention DOM adapter

#### 작업

1. lens toolbar
2. `data-attention`, `data-scenario`, `data-confidence`
3. 기존 visual opacity class migration
4. Reading Rail
5. live announcement

#### 완료 조건

- 한 상태에서 active node 1개
- lens 전환으로 graph layout 호출 0회
- lens 전환으로 DOM replacement 0회
- Flow 기본에서 value SVG hidden

### Phase 4 — Interaction 책임과 keyboard

#### 작업

1. node click에서 source open/child/body focus side effect 제거
2. explicit Inspector action 연결
3. roving tabindex
4. node arrow navigation
5. viewport pan event 분리
6. HTML branch choice layer

#### 완료 조건

- graph 진입 후 Tab 폭발 없음
- branch는 graph와 Inspector 양쪽에서 keyboard 가능
- focus restore test
- node click 결과가 local selection과 attention 갱신에 한정

### Phase 5 — Inspector lens-aware 재구성

#### 작업

1. selected summary 고정
2. lens별 section order
3. Scenario Variables를 Values lens로 이동
4. Static Flow Ledger
5. narrow `Map / Steps` view
6. responsive open policy

#### 완료 조건

- 선택 node와 source action이 모든 lens 첫 section
- narrow summary row 존재
- Map/Steps 전환에서 selection/lens/branch/binding state 보존
- Inspector가 graph overlay하지 않음
- Static Flow Ledger가 loop/cycle에서 유한

### Phase 6 — eval embedded context pipeline

#### 작업

1. analyzer metadata
2. application opaque mapping
3. protocol + runtime validation
4. embedded enclosure module
5. focus/breadcrumb
6. exact/fallback source copy

#### 완료 조건

- 10개 eval acceptance case 통과
- label sniffing 없음
- inner node selection 뒤 explicit source action의 editor evidence 일치
- direct/global scope 차이 text 표시
- dynamic eval에 invented graph 없음

### Phase 7 — Values lens와 playback 통합

#### 작업

1. default binding selection 제거
2. direct variable action에서 Values lens 진입
3. playback state를 comprehension controller에 연결
4. branch/lens change lifecycle
5. value attention class migration

#### 완료 조건

- initial motion 없음
- direct binding click만 1회 재생
- reduced motion 즉시 상태
- 다른 lens에서 value overlay 없음
- scenario input 보존

### Phase 8 — Calls/Effects와 motion 정리

#### 작업

1. explicit child action
2. relation copy
3. child entry animation 단순화
4. Effects lens semantic slot
5. unknown/inferred reason

#### 완료 조건

- child attach/collapse predictable
- event가 immediate call처럼 보이지 않음
- 한 번에 1~2개 이상 motion 없음
- `transition: all` 없음

### Phase 9 — Responsive, accessibility, performance

#### 작업

1. breakpoints
2. pointer coarse hit target
3. forced colors
4. 200% zoom
5. batch update/performance instrumentation
6. aria summary와 live message

#### 완료 조건

- viewport matrix visual QA
- keyboard-only task script 통과
- reduced motion/forced colors 검증
- O(V+E) projection
- layout read/write interleave 없음

### Phase 10 — Documentation과 release gate

#### 작업

1. README 사용자 흐름
2. SPEC 최종 실제 behavior 반영
3. DESIGN 실제 token/motion 반영
4. test 분리 완료
5. detector와 visual audit

#### 완료 조건

- `npm run check`
- 관련 unit tests
- `npm test`
- actual VS Code Extension Development Host visual QA
- remaining limitation 명시

---

## 24. Unit 및 integration test 계획

### 24.1 Pure attention test

새 파일:

`src/test/unit/functionLogicAttentionProjection.test.ts`

필수 case:

- no selection
- entry selection
- fork/merge
- loop/back edge
- selected branch
- nested independent choices
- value route
- playback priority
- call lens
- effect lens
- body focus
- eval focus
- cycle
- missing target
- maximum depth
- duplicate edge

### 24.2 Keyboard test

새 파일:

`src/test/unit/functionLogicKeyboardNavigation.test.ts`

필수 case:

- Down primary continuation
- selected branch priority
- Left/Right same rank
- Home/End
- cycle termination
- missing layout
- focus restore
- viewport handler propagation 차단

### 24.3 Protocol test

`src/test/unit/functionProtocol.test.ts`에 다음 추가:

- valid embedded context
- invalid enum
- negative count
- unknown boundary id
- duplicate program id와 membership/program mismatch
- optional field 없음의 backward compatibility
- raw path/range 미노출

### 24.4 Webview runtime test

분리된 test에서 확인:

- lens buttons와 `aria-pressed`
- Flow initial value layer hidden
- selected binding → Values + playback
- attention data attribute
- active item 1개
- HTML branch button
- Static Flow Ledger
- narrow Map/Steps state preservation
- roving tabindex
- selected eval inner node
- source postMessage token
- Inspector responsive semantic state

### 24.5 Architecture test

확인:

- `functionLogicBrowserSource.ts`가 embedded internals deep import하지 않음
- `comprehension`은 analyzer/VS Code API에 의존하지 않음
- `presentation`은 state를 직접 소유하지 않음
- recursive call pattern 없음
- browser source가 `eval`/`Function`으로 source를 실행하지 않음
- 새 source 파일이 800줄 이하

### 24.6 Layout test

- stable semantic slot height
- lens-independent node geometry
- long eval statement
- embedded enclosure header padding
- HTML branch label anchor
- node overlap guard
- edge label overlap guard
- child attachment anchor

---

## 25. Functional QA script

### 25.1 기본 흐름

1. `complexOrderWorkflow`를 연다.
2. Flow lens가 pressed인지 확인한다.
3. value edge가 보이지 않는지 확인한다.
4. Start → Decisions → Changes → Finishes를 각각 누른다.
5. selected node와 source editor highlight를 확인한다.
6. branch를 선택하고 sibling이 사라지지 않고 muted인지 확인한다.
7. reset 후 원래 context가 복구되는지 확인한다.

### 25.2 Values

1. Values lens 진입
2. empty selector state 확인
3. parameter 선택
4. playback 1회 시작
5. pause/previous/next/replay
6. branch 변경 후 reset
7. 다른 lens로 이동 후 marker 숨김
8. Values 복귀 후 자동 재생되지 않음
9. Scenario input 보존

### 25.3 Calls

1. call node 선택
2. local selection만 일어나고 source/child가 자동으로 열리지 않는지 확인
3. Calls lens의 explicit action으로 attach
4. callsite anchor 유지
5. collapse
6. event handler는 no-return dispatch인지 확인

### 25.4 eval

1. direct eval const fixture
2. eval boundary header 확인
3. inner write 선택
4. enclosure related 강조
5. `Open exact source` action 뒤 exact source substring
6. Values lens에서 host→eval→host binding route
7. Focus eval region
8. Back to host
9. global eval scope copy
10. concatenation fallback copy

### 25.5 Keyboard

1. mouse 없이 lens 선택
2. Tab으로 viewport/node 진입
3. arrow로 branch 이동
4. Enter로 source open
5. Inspector branch action
6. Escape close
7. Inspector toggle
8. Static Flow Ledger row 선택
9. child attach 후 focus 복원

---

## 26. Visual QA matrix

Functional test가 성공해도 visual QA를 별도로 수행한다.

### 26.1 Viewport

- 390×900
- 768×900
- 1024×900
- 1280×900
- 1600×1000

### 26.2 Theme

- Dark+
- Light+
- High Contrast Dark
- High Contrast Light 가능 시

### 26.3 환경

- default font
- editor font 16px
- window zoom 200%
- reduced motion
- forced colors
- pointer coarse emulation 가능 시

### 26.4 Fixture

- simple two-node
- nested branch + loop
- long identifiers/source line
- 100+ dense nodes
- many values
- no values
- event + render + child attach
- direct eval
- global eval
- large bounded embedded program
- parse limitation

### 26.5 눈으로 확인할 항목

- graph가 Inspector보다 먼저 보이는가?
- active/related/context/muted 차이가 light/dark에서 모두 보이는가?
- muted가 “없음”처럼 보이지 않는가?
- branch button이 edge와 겹치지 않는가?
- node source line이 잘리지 않는가?
- semantic slot이 node마다 같은 위치에 있는가?
- lens 전환 시 node가 흔들리지 않는가?
- eval enclosure가 nested card처럼 과도하게 무겁지 않은가?
- selected eval inner node와 boundary 관계가 즉시 보이는가?
- value marker 하나만 움직이는가?
- Inspector header와 source action이 scroll 밖으로 사라지지 않는가?
- 200% zoom에서 control이 overlap하지 않는가?

### 26.6 현재 제한

이 계획 작성 시 실제 VS Code Webview render를 연결할 browser session과 자동
screenshot fixture가 제공되지 않았다. 따라서 현재 코드를 직접 눈으로 검증했다고
주장하지 않는다. 구현자는 Phase 9~10에서 실제 Extension Development Host를 열고
위 matrix를 수행해야 한다.

---

## 27. 사용성 검증 계획

### 27.1 AI 없이 수행

검증 참가자에게 AI, README의 정답 설명, analyzer 내부 로그를 제공하지 않는다.
Function Visualizer와 원본 source만 제공한다.

### 27.2 Task

#### Task A — 구조

“이 함수의 시작, 주요 decision 2개, 가능한 종료를 찾고 설명하라.”

관찰:

- Reading Rail 사용 여부
- branch를 잘못 runtime path로 해석하는지
- source verification까지 도달하는지

#### Task B — 값

“`total`이 처음 정의된 곳부터 마지막 사용까지 따라가고, 어떤 지점에서 값이
바뀌는지 말하라.”

관찰:

- Values lens 발견
- selector와 scenario의 구분
- playback가 설명을 돕는지 방해하는지

#### Task C — eval

“`eval(code)` 내부에서 host `total`을 바꾸는 statement를 찾고, 원본 소스에서
그 범위를 검증하라.”

관찰:

- boundary 이해
- caller/global scope 구분
- inner node highlight와 source mapping 이해

#### Task D — 호출

“이 call 뒤에 실행될 수 있는 함수 흐름을 열고 다시 원래 함수로 돌아오라.”

관찰:

- explicit expansion action 발견
- call return과 event dispatch 구분
- mental map 보존

### 27.3 기록할 값

- task completion
- 잘못 선택한 action 수
- source verification 성공 여부
- branch/runtime 오해 여부
- 첫 meaningful action까지 시간
- 사용자가 말로 설명한 mental model
- keyboard-only completion

### 27.4 목표

첫 내부 검증 후 baseline을 기록하고 목표를 조정한다. baseline 없이 “30% 향상”
같은 숫자를 문서나 UI에 쓰지 않는다.

초기 acceptance 목표:

- 참가자 전원이 Task A에서 start와 exit를 찾음
- 참가자 전원이 Task C에서 eval inner node와 host source를 연결함
- static possible path를 observed runtime으로 말하는 참가자 0명
- keyboard-only reviewer가 모든 Task의 동등 action에 접근

---

## 28. Web Interface Guidelines audit 항목

구현 완료 전에 다음을 exact file/line으로 재검토한다.

### Accessibility

- icon-only button `aria-label`
- native button 사용
- form visible label
- graph summary와 text alternative
- heading hierarchy
- decorative SVG `aria-hidden`
- async/live status

### Focus

- 모든 interactive element `:focus-visible`
- replacement 없는 `outline:none` 없음
- drawer focus restore
- roving tabindex

### Animation

- reduced motion
- transform/opacity only
- `transition: all` 없음
- animation interruptible
- input block 없음

### Content

- long identifier
- empty array/string
- `min-width:0`
- wrap/overflow
- `…` character
- error에 recovery action

### Performance

- large list treatment
- layout read/write batch
- graph state change에서 DOM rebuild 없음

### Interaction

- hover/active/focus contrast
- SVG custom button 제거
- pointer coarse hit target
- drag/pan과 text selection 충돌

### Theme

- native select/input background와 foreground
- Light/Dark/High Contrast
- semantic token only

---

## 29. 명령과 검증 순서

구현자는 각 Phase에서 가능한 작은 test를 먼저 실행한다.

```sh
npm run check
```

새 pure test를 compile 후 선택 실행:

```sh
npm run compile
node --test out/test/unit/functionLogicAttentionProjection.test.js
node --test out/test/unit/functionLogicKeyboardNavigation.test.js
node --test out/test/unit/functionLogicEmbeddedCode.test.js
node --test out/test/unit/functionProtocol.test.js
```

Webview 관련 선택 test:

```sh
node --test out/test/unit/functionVisualizer/*.test.js
```

최종:

```sh
npm test
```

실제 glob/output 구조는 test 분리 결과에 맞춰 조정하되, 선택 test와 full suite
둘 다 실행한다.

UI 구현이 끝난 뒤 Impeccable detector를 changed target 전체에 한 번만 실행한다.

```sh
node /Users/lky/.agents/skills/impeccable/scripts/detect.mjs --json \
  src/webview/codeFlow/functionLogicBrowserSource.ts \
  src/webview/codeFlow/functionLogicGraphStyles.ts \
  src/webview/codeFlow/comprehension \
  src/webview/codeFlow/presentation \
  src/webview/codeFlow/embeddedCode \
  src/webview/codeFlow/inspector \
  src/webview/codeFlow/dataFlow
```

detector는 concept 선택 중간에 반복 실행하지 않는다.

---

## 30. 위험과 완화

### 위험 1 — lens가 정보를 숨겨 사용자가 놓친다

완화:

- node 위치와 context 유지
- semantic slot에 관련 정보 존재 count 표시
- Inspector에 lens 전환 action
- complete legend와 reading list

### 위험 2 — attention opacity가 복잡해진다

완화:

- 4단계만 사용
- central projection
- priority table unit test
- feature CSS가 opacity를 직접 소유하지 않음

### 위험 3 — Inspector 재배치가 기존 Scenario workflow를 깨뜨린다

완화:

- input state 유지
- Values lens에서 상단 배치
- scenario name click과 binding selection 공유
- 기존 evaluator test 그대로 유지

### 위험 4 — explicit child action의 발견성이 낮다

완화:

- node semantic slot에 `1 child flow`
- Calls lens에서 target 전경
- selected summary 바로 아래 full-label action
- Reading Rail/Inspector copy

### 위험 5 — eval metadata가 analyzer 전반을 오염시킨다

완화:

- optional embedded context
- embeddedCode module이 metadata 생성
- generic block/edge contract는 유지
- UI가 label을 파싱하지 않도록 최소 enum만 추가

### 위험 6 — exact source mapping을 과장한다

완화:

- `sourcePrecision` explicit
- exact/fallback copy
- evidence token은 기존 Host authority
- concatenation/alias/escape fixture

### 위험 7 — keyboard arrow와 pan이 충돌한다

완화:

- focus target별 handler
- node handler propagation 차단
- viewport focus와 node focus help 분리
- integration test

### 위험 8 — test 파일이 더 커진다

완화:

- Phase 0~2에서 runtime helper와 test 파일 분리
- 새 기능은 전용 test에만 추가

### 위험 9 — browser visual QA 부재

완화:

- Extension Development Host matrix를 release gate로 설정
- 기능 test 통과만으로 완료 처리하지 않음
- screenshot artifact를 향후 regression baseline으로 저장

---

## 31. 완료 Definition of Done

### Product / UX

- [ ] AI 설명 없이 4개 usability task를 수행할 수 있음
- [ ] Flow/Values/Calls/Effects가 질문별로 명확함
- [ ] default Flow 화면에 value overlay가 없음
- [ ] node click의 결과가 예측 가능함
- [ ] eval 내부 flow와 host resume이 한 canvas에서 보임
- [ ] selected eval node가 정확한 source 또는 정직한 fallback을 엶

### Visual

- [ ] VS Code visual language 보존
- [ ] graph가 primary focal surface
- [ ] active 1개, motion marker 1개
- [ ] lens 전환 geometry 불변
- [ ] contextual legend 최대 3개
- [ ] long text와 dense graph 처리
- [ ] Light/Dark/High Contrast 확인

### Interaction

- [ ] roving tabindex
- [ ] arrow navigation
- [ ] HTML branch button
- [ ] explicit call/eval/body action
- [ ] focus restore
- [ ] playback interruptible

### Accessibility

- [ ] semantic controls
- [ ] graph summary
- [ ] Static Flow Ledger
- [ ] narrow Map/Steps가 같은 state를 공유
- [ ] visible focus
- [ ] color-not-only
- [ ] reduced motion
- [ ] 200% zoom

### Architecture

- [ ] central attention projection
- [ ] O(V+E)
- [ ] no recursion
- [ ] no deep internal imports
- [ ] main implementation files 800줄 이하
- [ ] protocol/runtime validation
- [ ] no raw path/range in Webview payload

### Verification

- [ ] `npm run check`
- [ ] focused unit/integration tests
- [ ] `npm test`
- [ ] actual VS Code visual QA
- [ ] Impeccable detector 1회
- [ ] README/SPEC/DESIGN 동기화
- [ ] 남은 limitation 기록

---

## 32. Terra Medium 최종 작업 지시 요약

Terra Medium은 아래 순서를 그대로 따른다.

1. 이 문서, `PRODUCT.md`, `DESIGN.md`, `SPEC.md`, `README.md`를 읽는다.
2. 기존 dirty worktree를 확인하고 사용자 변경을 보존한다.
3. Phase 0에서 intentional behavior change를 문서에 먼저 고정한다.
4. pure attention state/projection부터 만들고 test한다.
5. graph header/node/edge를 책임별 모듈로 분리한다.
6. Flow/Values/Calls/Effects lens와 central attention DOM adapter를 연결한다.
7. node click에서 source open/child/body focus side effect를 제거하고 explicit
   action으로 옮긴다.
8. roving keyboard와 native HTML branch button을 만든다.
9. Inspector를 lens-aware 순서와 Static Flow Ledger로 재구성한다.
10. embedded context metadata를 analyzer → projection → protocol → Webview로 전달한다.
11. eval enclosure, focus, exact/fallback source highlight를 구현한다.
12. Values lens와 기존 playback를 새 state model에 통합한다.
13. child/event/effects 표현과 motion을 정리한다.
14. responsive, accessibility, performance pass를 수행한다.
15. typecheck, focused test, full test를 실행한다.
16. 실제 VS Code Extension Development Host에서 visual QA matrix를 수행한다.
17. detector를 한 번 실행하고 material finding을 수정한다.
18. README/SPEC/DESIGN을 실제 최종 behavior와 일치시킨다.

구현 중 가장 중요한 판단 기준은 다음 한 문장이다.

> 사용자가 지금 답하려는 질문과 무관한 정보는 사라지지 않되 조용해야 하고,
> 관련 정보는 색을 외우지 않아도 구조와 text만으로 따라갈 수 있어야 한다.
