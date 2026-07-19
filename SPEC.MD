# Project Analyzer Product Specification

## 1. 제품 정의

Project Analyzer는 낯선 코드베이스를 빠르게 이해하도록 돕는 VS Code용
**Code Flow Reader**다.

이 제품은 프로젝트 전체를 분석 결과의 목록이나 거대한 그래프로 보여주는 도구가
아니다. 사용자가 선택한 진입점, 함수, 변경 지점에서 시작해 지금 이해하려는 코드와
관련된 흐름만 작고 검증 가능한 형태로 구성한다.

정적 분석과 그래프는 제품의 화면이 아니라 흐름을 만들기 위한 내부 증거 엔진이다.

### 1.1 유일한 제1목표

> 사용자가 코드베이스를 빠르고 정확하게 이해하고, 새로운 코드에서도 반복해서
> 사용할 수 있는 코드 읽기 마인드셋을 짧은 시간 안에 습득하게 한다.

모든 기능과 화면은 이 목표에 직접 기여해야 한다. 기여를 설명할 수 없는 기능은
기본 제품 범위에 포함하지 않는다.

### 1.2 제품 약속

사용자는 Project Analyzer를 통해 다음 질문에 답할 수 있어야 한다.

- 이 동작은 어디에서 시작되는가?
- 어떤 함수들이 책임을 이어받는가?
- 중요한 분기와 경계는 어디인가?
- 상태 변경이나 외부 효과는 어디에서 발생할 가능성이 있는가?
- 각 연결을 어떤 소스 코드에서 검증할 수 있는가?
- 분석이 모르는 부분과 사용자가 직접 확인해야 할 부분은 무엇인가?

### 1.3 제품이 아닌 것

Project Analyzer는 다음 제품이 되는 것을 목표로 하지 않는다.

- 전체 저장소를 한 화면에 펼치는 범용 그래프 뷰어
- 모든 언어 의미를 완전하게 증명하는 컴파일러 프런트엔드
- 정적 호출 관계를 실제 런타임 순서라고 주장하는 실행 시뮬레이터
- 코드 품질 점수와 지표를 나열하는 분석 대시보드
- 정해진 커리큘럼을 따라가게 하는 온보딩 학습 관리 도구
- 사람이 이해했는지를 방문 횟수나 완료율로 판정하는 진도 관리 도구
- AI 설명을 소스 증거보다 우선하는 코드 요약 도구

## 2. 핵심 코드 읽기 마인드셋

제품은 별도의 강의나 장문의 가이드 대신 모든 상호작용에 아래 읽기 순서를
반복적으로 적용한다.

```text
Boundary -> Responsibility -> Decision -> Effect -> Verify
```

### 2.1 Boundary

흐름을 파일 트리 한가운데서 시작하지 않는다. HTTP route, GraphQL operation,
event handler, CLI command, test, public function 또는 사용자가 선택한 심볼처럼
구체적인 시작점을 먼저 찾는다.

사용자에게 심을 질문은 다음과 같다.

> 무엇이 이 코드를 호출하거나 시작시키는가?

### 2.2 Responsibility

호출 하나하나를 동일한 중요도로 읽지 않는다. 책임이 다른 파일, 계층, 모듈로
넘어가는 지점을 우선 찾는다.

> 이 함수가 직접 소유하는 책임은 무엇이고, 다음 함수에 무엇을 넘기는가?

### 2.3 Decision

동작을 바꾸는 조건, 정책, 변환, orchestration 후보를 찾는다. 분석기가 이를
확실히 증명하지 못하면 `Decision candidate` 또는 `Unknown`으로 표현한다.

> 어느 지점에서 결과나 다음 경로가 달라지는가?

### 2.4 Effect

데이터베이스, 파일 시스템, 네트워크, 프로세스, 메시지 발행, 상태 변경 같은 경계를
찾는다. 이름이나 폴더만으로 효과를 단정하지 않는다.

> 이 흐름은 결국 무엇을 읽거나 바꾸는가?

### 2.5 Verify

시각화는 결론이 아니라 읽기 순서를 줄여 주는 인덱스다. 모든 concrete step은 원본
정의 또는 callsite로 이동할 수 있어야 하고, confidence와 coverage gap을 숨기지
않아야 한다.

> 이 연결을 어떤 코드 증거로 확인할 수 있는가?

## 3. 대상 사용자와 핵심 작업

### 3.1 대상 사용자

- 처음 보는 코드베이스에서 첫 변경을 준비하는 개발자
- 오래 보지 않은 기능의 맥락을 다시 복구하는 개발자
- 버그나 장애의 관련 호출 경로를 좁히는 개발자
- Pull Request가 어떤 진입점과 동작에 닿는지 확인하는 리뷰어
- 레거시 시스템의 대표 흐름을 팀에 설명해야 하는 개발자

### 3.2 핵심 작업

#### 작업 A: 대표 기능 이해

사용자는 route 또는 operation을 선택하고 entry에서 effect boundary까지 가능한
호출 흐름을 읽는다.

#### 작업 B: 임의 함수 이해

사용자는 함수명이나 source path를 검색하거나 현재 편집기의 심볼에서 시작한다.
제품은 함수 선언 주변의 단순 caller/callee 관계도를 기본 답으로 제시하지 않는다.
현재 source의 함수 body를 읽어 statement, condition, branch, loop, mutation, effect
candidate, return/throw를 source-backed control flow로 구성한다. 동시에 이 함수에
도달하는 알려진 upstream entrypoint를 맥락으로 제공한다. 직접 호출하는 concrete
함수는 현재 call block과 연결해 표시하고, 사용자가 선택했을 때만 하위 함수의 내부
flow를 분석해 현재 graph canvas 안에 block과 edge로 연결한다. attachment는
`callsite -> child flow -> resume -> caller continuation` 순서로 배치해 기존 분기와 호출
edge가 같은 선 위에서 경쟁하지 않게 한다. 사용자는 call block 재클릭으로 expansion을
접거나 breadcrumb로 별도 함수 탐색의 부모에 즉시 돌아갈 수 있다.

#### 작업 C: 변경 영향 파악

사용자는 변경한 함수에서 역방향으로 탐색해 어떤 request flow가 영향을 받을 수
있는지 확인한다.

#### 작업 D: 흐름 설명과 공유

사용자는 관련 없는 branch를 접고 중요한 step을 고정해, 소스 링크와 unknown을
포함한 작은 flow artifact로 저장하거나 내보낸다.

#### 작업 E: 프로젝트 책임 흐름 파악

사용자는 전체 symbol graph를 펼치지 않고 manifest package, framework root, 보수적으로
추론한 source area 단위로 프로젝트의 책임 경계를 본다. 모듈 간 실행, dependency,
external boundary 관계에서 관심 모듈을 선택하고, 필요한 지점만 함수 수준으로 확장한다.

## 4. 핵심 개념

### 4.1 Project Graph

분석기가 발견한 symbol, call, import, framework mapping, confidence를 보존하는 내부
증거 저장소다. Project Graph 전체는 기본 Webview payload나 첫 화면이 아니다.

### 4.2 Flow Query

사용자의 현재 질문을 표현하는 계약이다.

```ts
type FlowQuery = {
  root: EntrypointReference | SourceReference;
  direction: "downstream" | "upstream" | "context";
  maxDepth: number;
  maxSteps: number;
  target?: SourceReference;
  filters?: FlowFilters;
};
```

### 4.3 Code Flow

Project Graph에서 Flow Query에 맞게 투영한 작은 읽기 단위다. Code Flow는 전체
그래프의 복사본이 아니며 다음을 포함한다.

- 하나의 명확한 root
- bounded step 목록
- parent-child call 관계
- 접힌 branch와 생략 수
- source navigation token
- edge confidence와 resolution
- coverage gap
- 알려진 upstream entrypoint

### 4.4 Flow Step

사용자가 읽을 수 있는 하나의 코드 책임 지점이다.

```ts
type FlowStep = {
  id: string;
  parentId?: string;
  stage: "boundary" | "path" | "decision" | "effect" | "unknown";
  label: string;
  detail: string;
  depth: number;
  confidence?: "exact" | "resolved" | "inferred" | "unresolved";
  resolution: "concrete" | "external" | "unresolved";
  sourceToken?: string;
};
```

### 4.5 Project Module Index

Project Module Index는 Project Graph를 프로젝트 책임 경계 단위로 집계한 Host-side
분석 자산이다. 언어 문법의 `module` symbol이나 framework의 `module` unit과 동일한
개념이 아니다.

- manifest가 확인된 workspace package를 가장 강한 경계로 사용한다.
- 같은 root의 framework와 framework unit 증거는 하나의 module에 병합한다.
- 명시적 경계가 없는 source만 `apps`, `packages`, `services`, `src`, `app`, `lib`
  구조를 이용해 source area로 보수적으로 묶는다.
- workspace root는 direct file과 nested module의 fallback parent다.
- 중첩 package를 유지하고 각 file/callable은 가장 가까운 module 하나에만 직접 귀속한다.
- 부모 module의 descendant count와 자식의 direct count를 분리한다.
- module 내부 관계는 self-loop로 만들지 않고 내부 relation count로 보존한다.
- cross-module `calls`, `imports`, `exports`와 framework semantic relation을 종류별로
  집계하고 `exact`, `resolved`, `inferred`, `unresolved` count를 각각 유지한다.
- external node의 source-side `filePath`를 target ownership으로 사용하지 않으며 외부 또는
  unresolved target은 별도 external boundary로 집계한다.
- relation source evidence는 bounded sample만 유지하되 전체 evidence와 omitted count는
  정확하게 보존한다.

전체 Project Module Index는 Webview payload가 아니다. 현재 Module Flow는 초기 module/edge와
선택한 module 주변 관계만 bounded projection으로 받고, module을 펼칠 때 같은 canvas에
boundary function을 lazy하게 추가한다. retained/omitted 수를 함께 제공하므로 화면에 없는
module이나 relation을 관계가 없다는 뜻으로 해석하지 않는다.

### 4.6 Function Logic

Function Logic은 선택된 한 함수 내부의 가능한 제어 흐름이다. Project Graph의 call
edge를 재배열한 결과가 아니라 현재 source syntax에서 직접 만든 별도 분석 결과다.

```ts
type FunctionLogicLanguage =
  | "typescript" | "javascript" | "python" | "java" | "unsupported";

type FunctionLogicBlock = {
  id: string;
  kind:
    | "entry" | "condition" | "loop" | "switch" | "try"
    | "call" | "effect" | "mutation" | "operation"
    | "return" | "throw" | "break" | "continue" | "exit";
  label: string;
  depth: number;
  branchLabel?: string;
  confidence: "exact" | "inferred";
  sourceLocation?: string;
  evidenceToken?: string;
  drillTargets?: FunctionLogicDrillTarget[];
  valueChanges?: FunctionLogicValueChange[];
};

type FunctionLogicValueChange = {
  target: string;
  targetKind: "variable" | "property" | "receiver";
  operation: "initialize" | "assign" | "update" | "delete" | "iterate" | "mutate";
  operator: string;
  value?: string;
  confidence: "exact" | "inferred";
};

type FunctionLogicDrillTarget = {
  sourceToken: string;
  qualifiedName: string;
  confidence: "exact" | "resolved" | "inferred" | "unresolved";
  callsiteCount: number;
};

type FunctionLogicEdge = {
  sourceId: string;
  targetId: string;
  kind:
    | "next" | "true" | "false" | "iterate" | "repeat" | "exit"
    | "case" | "exception" | "finally" | "return" | "throw"
    | "break" | "continue";
  confidence: "exact" | "inferred";
};
```

block의 source 순서는 presentation order이며 실제 runtime 순서를 의미하지 않는다.
실행 가능성은 block 사이의 edge로 표현한다. effect는 이름 기반 추론일 수 있으므로
`inferred`를 유지하고 사용자가 callee source에서 검증하게 한다.

value change는 statement label을 다시 보여 주는 문자열이 아니라 변경 target을 별도
evidence로 보존한다. 대입, 증감, 삭제, 초기화, loop binding은 `exact`이며 source에 적힌
우변만 표시하고 runtime 값을 계산하지 않는다. `items.push(item)`, `queue.pop()`처럼 알려진
in-place method 이름은 receiver가 바뀔 가능성만 `inferred`로 표시한다. 호출 구현이나 receiver
type을 확인하지 못한 상태에서 exact mutation으로 승격하지 않는다. 한 block에서 발견한
서로 다른 source-level change는 모두 보존하고 target 종류는 `VAR`, `FIELD`, `RECEIVER`
텍스트로도 구분한다.

Function Logic payload는 중복을 제거한 direct concrete callee 목록과 각 block에 매칭된
drill target을 함께 제공한다. unresolved/external/self-recursive call은 새 함수 진입
token으로 만들지 않는다. 하위 함수는 eager recursive graph로 미리 합치지 않는다.
사용자가 함수 호출 block을 클릭할 때 한 함수씩 분석하고, 부모 graph를 유지한 채 해당
callsite에서 하위 함수의 block을 동일한 graph canvas에 연결한다. root와 로드된 child의
block/edge는 browser-only scope identity로 합치고 compound layered layout을 다시 계산한다.
callsite에 기존 `true`/`false`/`next` outgoing edge가 있으면 이를 명시적인 resume gateway로
옮기고 `callsite -> child entry -> child terminal -> resume -> 기존 continuation`으로 잇는다.
call edge와 call-return edge는 의미와 스타일을 구분한다. 각 edge는 node의 독립 source/target
port와 rank-gap track을 배정받고, child lane은 parent lane을 기준으로 정렬해 edge끼리 같은
선분을 공유하거나 관계없는 box를 통과하지 않게 한다.
별도의 child graph viewport나 card는 만들지 않는다. 같은 block을 다시 클릭하면 그
block에서 시작한 하위 expansion branch 전체를 접는다.

callsite attachment는 statement 종류가 아니라 언어 parser의 실제 call expression range를
사용한다. TypeScript/JavaScript는 compiler AST, Python/Java는 Lezer syntax tree,
F#/OCaml/Elixir는 pipe-forward stage range를 근거로 삼는다. 따라서 `if (isReady())`,
`while (hasNext())`, `switch (selectMode())`,
`match select_mode()`의 호출도 각각 condition/loop/switch block에 연결한다. `this.method()`와
`self.method()`는 현재 lexical owner의 concrete callable을 우선한다. 저수준 graph가
multiline 함수 body의 call edge를 놓친 경우에는 동일 이름의 concrete target이 하나뿐일
때만 `inferred`로 보완한다. 같은 위치에 explicit unresolved edge가 있거나 후보가 둘 이상이면
concrete target으로 승격하지 않는다.

### 4.7 Evidence

Evidence는 분석 결과의 근거다. definition, callsite, framework mapping, import binding,
runtime observation을 서로 다른 종류로 보존한다.

### 4.8 Coverage Gap

분석기가 경로를 완성하지 못한 이유다. ambiguous mapping, unresolved target, depth
limit, step limit을 정상적인 제품 상태로 표현한다.

## 5. 의미론과 정확성 규칙

### 5.1 정적 흐름은 실행 기록이 아니다

정적 `A -> B -> C`는 도달 가능한 calls 관계이며 실제 시간 순서를 의미하지 않는다.
UI는 정적 flow에 실행 시각, 호출 횟수, return 순서를 만들지 않는다.

함수 내부 `true`, `false`, `repeat`, `return` edge도 syntax가 허용하는 가능한 경로다.
조건 값, 반복 횟수, callee 내부 exception, callback 실행 시점이 관찰되었다고 주장하지
않는다.

Module Flow의 `calls`, `imports`, `exports`, framework semantic relation도 분석 snapshot에서
발견한 가능한 정적 책임 관계다. `Execution` lens는 call/framework execution 후보를 모아
보여 줄 뿐 실제 실행 순서나 빈도, latency, trace를 뜻하지 않는다. UI는 이를 항상
`Static responsibility relationships`로 표시한다.

### 5.2 confidence 보존

- `exact`: 타입 시스템, AST 또는 직접 framework mapping으로 확인
- `resolved`: scope/import 규칙으로 합리적으로 연결
- `inferred`: 이름, 폴더, convention으로 추론
- `unresolved`: 호출은 보이나 대상이 정해지지 않음

색상만으로 confidence를 전달하지 않는다. label, line style, badge, accessible text를
함께 사용한다.

### 5.3 observed evidence 분리

향후 runtime trace가 추가되더라도 정적 edge를 덮어쓰지 않는다. 같은 관계에
`Observed` evidence를 추가하고 어떤 실행 또는 테스트에서 관찰했는지 보존한다.

### 5.4 순서와 presentation 분리

사용자가 flow를 설명하기 위해 step을 강조하거나 숨길 수는 있지만, call 관계의
방향이나 analyzer evidence를 편집할 수는 없다. Presentation order가 causal order로
오해되지 않게 별도 필드로 보존한다.

### 5.5 Unknown 우선

근거가 부족한 역할, effect, business ownership, purity는 `Unknown`으로 남긴다.
부정확한 완성도보다 명시적인 빈칸을 선호한다.

## 6. UX 정보 구조

제품의 기본 정보 구조는 하나의 질문과 하나의 flow에 집중한다.

```text
Activity Bar: Start a Flow
  |- Entrypoints
  |- Find a Function
  `- Recent/Saved Flows

Editor context menu
  `- Visualize Current Function

Sidebar: Flow Launcher / Entrypoint Reader
  |- Visible See how modules connect / Open Module Flow CTA
  |- Reading frame
  |- Inter-function flow steps
  |- Inspect logic action
  `- Evidence and unknowns

Command Palette / Code Flow sidebar title
  `- Open Project Module Flow

Editor Tab: Function Visualizer
  |- Start / Choose / Do / Finish reading frame
  |- Root and child functions in one compound control-flow graph
  |- Selected graph-node evidence
  |- Call-block anchored child blocks and call connectors
  |- Nested branch collapse and cycle boundary
  |- Parent/back and function breadcrumbs
  |- Evidence and unknowns
  `- Source actions

Editor Tab: Module Flow
  |- Execution / Dependency / All boundaries lens
  |- Bounded module/edge scene and exact omitted counts
  |- SCC cycle groups and obstacle-safe orthogonal routes
  |- Selected module/edge detail and evidence
  |- Same-canvas boundary-function expansion
  `- Function Visualizer handoff
```

Project Map, Reading Plan, Guided Tour, Analysis Dashboard는 기본 navigation에 두지
않는다. Module Flow는 기존 전체 Project Map을 복구하는 기본 dashboard가 아니라 사용자가
명시적으로 여는 bounded project-responsibility 질문이다.

### 6.1 Empty State

분석 전 화면은 제품의 읽기 방식을 한 문장으로 알려주고 `Analyze Workspace`를
primary action으로 제공한다.

```text
Start at a boundary. Follow responsibility changes. Find effects. Verify in source.
```

지원 파일이 없거나 분석이 실패해도 다음 행동을 명확히 제공한다.

### 6.2 Start a Flow

사용자는 두 가지 시작 방식을 가진다.

#### Entrypoints

- HTTP route
- GraphQL Query, Mutation, Subscription
- 향후 event, job, CLI, test entrypoint

목록은 framework와 scope로 필터링할 수 있고 텍스트 검색을 지원한다. 초기 payload는
bounded summary이며 전체 function inventory를 전송하지 않는다.

#### Functions

함수명, qualified name, workspace-relative source path로 검색한다. 검색 결과는 source
token만 노출하며 analyzer ID와 host absolute path를 Webview로 보내지 않는다. 선택한
함수는 Function Logic Reader로 열고, entrypoint flow의 concrete 함수 step에도
`Inspect logic` action을 제공한다.

TypeScript/JavaScript/Python/Java 편집기의 함수, 메서드, 생성자, 지원되는 lambda와
F#/OCaml/Elixir의 named function 내부에서 `Visualize Current Function` context menu를
실행할 수 있다. 이 명령은
사이드바가 닫혀 있어도 확장을 활성화하고, 저장되지 않은 변경을 포함한 현재 document
snapshot에서 가장 안쪽 callable을 언어별 syntax parser로 해석한다. current-file graph를
활성화한 뒤 사이드바 상태와 독립된 Function Visualizer editor tab을 열고 해당 Function
Logic graph를 바로 표시한다.

명시적인 editor 요청은 sidebar open이나 auto workspace analysis를 요구하지 않는다. 가벼운
project analyzer가 익명 callback이나 function-valued property를 graph symbol로 만들지
못한 경우에도 parser의 exact declaration/selection range로 snapshot-local callable
node를 보강한다. 이 보강은 call edge를 추측하지 않으며 현재 함수 내부 시각화에만
필요한 source identity를 제공한다.

언어별 Function Logic 범위는 다음과 같다.

- TypeScript/JavaScript: compiler AST 기반 branch, loop, switch, try, call, mutation, exit
- Python: `if/elif/else`, `while/for`와 loop-else, `match/case`,
  `try/except/else/finally`, `with`, eager list/set/dictionary comprehension,
  deferred generator-argument comprehension, receiver-call chaining,
  call/mutation/return/raise/break/continue
- Java: `if/else`, while/for/enhanced-for/do, switch, `try/catch/finally`,
  try-with-resources, synchronized/labeled region, call/new/mutation/exit
- F#/OCaml/Elixir: `|>` input과 source-ordered stage, named stage callsite,
  F#/OCaml final-argument insertion, Elixir first-argument insertion

TypeScript/JavaScript/Python/Java는 expression-level boolean short-circuit와 callee exception을 별도 block으로
확장하지 않는다. Python의 monkey patching/decorator/descriptor와 Java의 virtual dispatch,
reflection/framework interception/thread scheduling은 runtime unknown으로 남긴다.
JSX/TSX 함수는 일반 statement flow에 더해 대문자 또는 member-style component tag를 exact
callsite로 보존한다. lowercase intrinsic tag는 호출로 만들지 않고, JSX attribute의 callback은
render 시 즉시 실행되는 경로로 합치지 않으며 커서로 선택했을 때 독립 함수로 분석한다.
`memo`/`forwardRef` wrapper 내부 callable은 바깥 binding을 함수 identity로 사용한다.
Python `with`와 `async with`는 context-manager header만 구조 block에 표시하고, 들여쓰기된
body statement는 source 순서의 별도 block으로 투영한 뒤 context 종료 후 statement로 잇는다.

Python의 eager comprehension은 하나의 assignment/call statement로 뭉개지 않는다. 첫 iterable
평가 뒤 각 `for`를 loop owner로, 각 `if`를 condition owner로, 최종 원소/entry 생성을 가장 안쪽
body block으로 투영한다. 여러 `for`와 `if`는 source의 평가 순서대로 중첩하고, filter 실패는
해당 loop의 repeat 지점으로, 가장 바깥 loop 종료는 comprehension 결과를 받는 assignment 또는
return으로 연결한다. comprehension target은 `← each` exact value change로 보존한다.

Python receiver-call chain은 `source().filter().map()` 전체를 하나의 call block으로 표시하지
않고 receiver를 만드는 안쪽 call부터 바깥 method call까지 별도 block으로 잇는다. 뒤 단계의
label은 `previous result`를 명시하고, exact callsite range와 전체 callee evidence는 유지한다.
각 단계는 독립적인 drill target을 가지므로 사용자가 block을 클릭하면 해당 함수의 내부 flow를
현재 canvas의 그 지점에 이어 붙일 수 있다. resolved graph edge를 우선 사용하되 lightweight
analyzer가 receiver method를 unresolved로 남긴 경우에는 parser가 확인한 chain stage에 한해
동일 파일/workspace의 유일한 함수 또는 명시적인 class constructor owner의 method를
`inferred`로 복구한다. 후보가 둘 이상이면 임의로 고르지 않고 unresolved 상태를 유지한다.

F#/OCaml/Elixir pipe-forward chain은 `input |> first |> second`를 하나의 expression box로
뭉개지 않고 complete input block과 각 stage block으로 source 순서대로 잇는다. F#/OCaml은
previous result가 stage의 마지막 인자, Elixir는 첫 인자로 전달된다는 언어 semantics를 detail에
보존한다. named local/module stage는 exact range를 가진 독립 drill target이며 동일 canvas에
하위 Function Logic을 이어 붙일 수 있다. 문자열과 comment 안의 `|>`는 stage가 아니고,
서로 독립된 pipeline은 한 chain으로 합치지 않는다. 함수 합성, computation expression/macro,
Haskell composition과 monadic bind는 pipe-forward로 가장하지 않고 analysis gap으로 남긴다.
지연 generator expression은 생성 시점과 advance 시점이 다르므로 standalone value일 때 eager
loop CFG로 가장하지 않고 containing block과 명시적 analysis gap에 남긴다. 단,
`consumer(item for item in values)` 또는 명시적으로 괄호를 쓴 generator가 call argument이면
`generator argument` loop와 item-yield body를 receiving call 앞에 구조적으로 표시한다. 이 loop,
filter, repeat, exit edge는 모두 `inferred`이며 callee가 실제로 iterable을 소비하는지, 몇 개를
소비하는지, 언제 중단하는지는 관찰했다고 주장하지 않는다. comprehension의 emitted expression
안에 다시 들어 있는 nested comprehension도 현재는 해당 emit block 내부에 남긴다.

### 6.3 Flow Reader와 Function Visualizer

Entrypoint Flow Reader는 좁은 sidebar에서 vertical ribbon을 사용한다. 선택 함수의
Function Visualizer는 별도 editor tab에서 node와 labeled edge로 이루어진 scrollable
control-flow graph를 기본 표현으로 사용한다. 전체 Project Graph가 아니라 현재 선택
함수의 bounded block만 layout 대상으로 삼는다.

필수 요소:

- flow title과 root 종류
- `Static path` 또는 `Observed path` 표시
- Boundary, Path, Decision, Effect, Unknown stage
- confidence badge
- workspace-relative source location
- one-click source open
- branch indent와 collapsed count
- coverage gap과 traversal limit
- 임의 함수에서 시작한 경우 알려진 upstream entrypoint

선택 함수에서는 같은 위치에 다음 요소를 제공한다.

- `Start -> Choose -> Do -> Finish` 네 단계 읽기 프레임과 실제 block counter 기반 설명
- 현재 함수 signature
- 위에서 아래로 진행하는 control-flow rank
- 같은 rank에서 좌우로 분리되는 branch lane
- label, source detail, branch/callee badge 길이에 따라 달라지는 node width/height
- statement/branch/value-change/child-function/resume 텍스트를 `...` 또는 `…`로 자르지 않고
  전체 보존하며, 가로 폭 이후에는 줄바꿈 수만큼 node height를 확장
- analyzer depth를 0~5 시각 단계로 정규화하고 기존 kind background 위에 옅은 tint를
  합성해 중첩 block을 구분하되, 색만으로 control 의미를 새로 부여하지 않음
- analyzer가 제공한 opaque parent block identity를 사용해 body를 가진 control owner와 모든
  descendant statement를 하나의 큰 compound frame으로 감싸고 control 이후 continuation은 제외
- compound frame은 child function을 붙인 최종 layout에서 반복 기반으로 재계산하며 pointer event를
  받지 않고, frame 뒤/edge 중간/node 앞의 layer 순서를 유지
- variable/property/receiver target과 operator/우변을 보여 주는 value-change row
- exact write는 실선, method-name 기반 receiver mutation은 inferred 점선으로 구분
- condition/loop/call/mutation/effect/exit kind
- `true`, `false`, `iterate`, `exit`, `return`, `throw` labeled edge
- `repeat`와 `continue`를 위한 외곽 back-edge channel
- loop body terminal에서 exit continuation으로 layout-only 순서 제약을 추가해 루프 종료 후
  statement를 전체 back-edge 고리 아래에 배치
- 중간 node를 가로지르지 않는 long-exit outer channel
- 모든 수평 edge segment를 rank 사이 빈 공간 또는 outer channel에만 배치하는 box obstacle guard
- 각 edge에 독립된 source/target port와 rank-gap track을 주는 edge-overlap guard
- exact solid edge와 inferred/exception/back dashed edge
- exact/inferred confidence
- workspace-relative statement location
- graph node 선택 시 detail, outgoing target, source action을 보여 주는 evidence panel
- 50%~160% bounded zoom과 양방향 scroll canvas
- exact statement를 여는 evidence action
- direct concrete callee 목록과 callsite count/confidence
- callsite range가 포함된 graph block 클릭 시 동일 canvas에 붙는 하위 함수 block/edge
- child loading/attachment로 graph layout이 다시 계산되어도 선택한 callsite의 viewport 상대
  위치를 유지하고, 새 child block/edge만 짧게 등장시키는 reduced-motion-aware animation
- callsite와 기존 caller continuation 사이에 child flow와 resume gateway를 삽입하는 연결 구조
- 색과 dash가 구분되는 call/call-return edge와 parent-aware child lane
- 같은 call block 재클릭 시 그 지점의 descendant expansion 전체를 제거하는 collapse action
- 최대 6단계, 총 32개 attached function의 iterative lazy expansion
- ancestor 함수를 다시 호출할 때 재분석하지 않고 cycle 상태를 표시하는 visited guard
- 별도 함수로 전환할 수 있는 parent back action과 함수 breadcrumb
- 함수당 최대 24개 direct callee와 omitted count
- parser limitation과 runtime unknown

### 6.4 Module Flow

사용자는 Code Flow sidebar 본문의 `See how modules connect` card와 큰 `Open Module Flow`
button, Command Palette 또는 sidebar title의 `Open Project Module Flow` action으로 workspace의
책임 경계를 전용 Module Flow editor tab에서 연다. 본문 CTA는 새 editor tab을 연다는 tooltip,
설명 text, keyboard focus ring, screen-reader description, opening/disabled 상태를 제공한다.
workspace가 없으면 빈 graph로 위장하지 않고 명시적인 unavailable 상태를 알린다. tab의 헤더는
이 화면이 runtime trace가 아닌 `Static responsibility relationships`임을 계속 표시한다.

초기 scene은 전체 Project Module Index가 아니라 최대 80개 module과 160개 edge로 제한하며,
전체/표시/생략 수를 함께 보여 준다. 사용자는 관계 질문에 따라 다음 lens를 선택한다.

- `Execution`: `calls`와 framework execution 후보 관계
- `Dependency`: `imports`, `exports`, `extends` dependency 관계
- `All boundaries`: execution과 dependency를 함께 보는 경계 관계
- external/inferred 포함 여부는 별도 filter이며 confidence를 지우지 않음

Module Flow canvas는 다음 읽기 규칙을 따른다.

- module/function box는 label, detail, metric, badge가 실제로 차지하는 폭과 줄 수에 따라
  220~420px 범위에서 폭과 높이가 달라짐
- retained label과 detail은 `...` 또는 `…`로 자르지 않고 줄바꿈으로 전체 표시
- strongly connected component는 하나의 cycle group enclosure로 묶고, component 사이
  condensation DAG는 위에서 아래로 배치
- edge는 직교 polyline과 독립 track/outer channel을 사용하고 source/target 이외의 box를
  통과하지 않음
- pair 사이 여러 relation은 하나의 route로 집계하되 relation kind, count, confidence count,
  evidence/omitted count를 잃지 않음
- module이나 edge를 선택하면 bounded relation/evidence detail과 source action을 같은 tab의
  detail rail에 표시
- toolbar의 `− / 현재 배율 / + / Fit`으로 1%~300% 범위의 bounded zoom을 조절하고 현재
  배율을 항상 표시함. `Fit`은 100%를 넘겨 확대하지 않으며 전체 graph를 screen-size padding
  안에 가운데 배치함
- viewport가 focus된 동안 `+`, `-`, `0`, `F`를 각각 확대, 축소, 100%, Fit으로 사용하고
  Ctrl/Cmd-wheel은 cursor 아래 world point를 유지함. modifier 없는 wheel은 native scroll을
  유지하고 빈 canvas drag 또는 middle drag는 layout 없이 native scroll offset만 바꿈
- detail rail이나 editor 크기가 바뀌면 `ResizeObserver`가 현재 world center를 유지하며 stage
  extent와 centered offset만 다시 계산함

boundary function이 있는 module box를 클릭하면 새 view/card로 이동하지 않고 그 module의
incoming/outgoing boundary function과 concrete call/containment edge를 현재 canvas에 lazy하게
합친다. child module expansion도 명시적인 action으로 같은 canvas에 한 layer씩 합친다. 확장 전
클릭한 module의 viewport 상대 위치를 anchor로 저장하고 layout 뒤 같은 지점으로 복원한다. 새
node/edge만 짧게 등장시키며 `prefers-reduced-motion` 환경에서는 animation을 생략한다.

확장된 concrete function의 action은 기존 Function Visualizer에 넘겨 statement-level control
flow와 source evidence를 계속 읽게 한다. Module Flow 자체는 함수 내부
statement를 복제하지 않으며 project responsibility에서 function logic으로 내려가는 handoff만
제공한다.

### 6.5 Evidence Detail

step 또는 edge를 선택하면 다음을 보여준다.

- 왜 이 step이 flow에 포함되었는가
- definition인지 callsite인지
- edge confidence와 resolution
- architecture/layer evidence가 있다면 그 근거
- 분석이 확인하지 못한 항목

### 6.6 Source Integration

- concrete step: 정확한 definition 열기
- function logic block: 정확한 statement 또는 condition expression 열기
- unresolved/external step: target definition으로 위장하지 않고 callsite 위치 표시
- active graph가 바뀌면 이전 source token 무효화
- active graph가 바뀌면 이전 statement evidence token도 무효화
- Module Flow panel snapshot이 바뀌면 이전 module/edge/function/evidence token 무효화
- source open은 이해 완료나 학습 완료로 기록하지 않음

### 6.7 Progressive Disclosure

- 최초에는 핵심 flow와 branch summary만 표시
- 한 번에 보여주는 concrete step 목표는 6~12개
- 사용자가 선택한 branch만 추가 확장
- 외부 라이브러리와 cross-cutting noise는 기본 접힘
- 전체 structure와 inventory는 검색 또는 명시적 context action 뒤에만 로드
- Module Flow는 bounded initial scene 뒤 선택한 module의 child/boundary function만 한 layer씩
  확장하고 전체 Host index를 browser에 전송하지 않음

## 7. MVP 범위

### 7.1 포함

- workspace/current-file 로컬 분석
- TypeScript, JavaScript, Python, Java callable extraction과 F#/OCaml/Elixir named function extraction
- HTTP/GraphQL entrypoint catalog
- entrypoint-centered bounded downstream flow
- 임의 concrete function 검색
- editor context menu에서 현재 지원 언어 callable 직접 시각화
- TypeScript/JavaScript/Python/Java statement-level control flow와
  F#/OCaml/Elixir pipe-forward function flow
- condition, branch, loop, switch, try, mutation, call, return/throw block
- 변수/프로퍼티 exact write와 receiver mutation 후보의 block-local value-change annotation
- 함수 내부 exact statement evidence navigation
- 함수 내부 effect candidate의 inferred confidence
- 함수가 포함된 알려진 entrypoint 표시
- manifest 기반 `projectPackageRoots` metadata와 nested package/framework/source-area module index
- sidebar 본문의 설명형 `Open Module Flow` CTA, Command Palette/sidebar title action 및 전용 editor tab
- Execution/Dependency/All boundaries lens의 최대 80 module/160 edge initial scene
- SCC cycle group, 가변 크기 box, 생략 없는 label, obstacle-safe orthogonal route
- 선택 module의 child/boundary function same-canvas lazy expansion과 Function Visualizer handoff
- module/edge bounded detail, representative evidence, exact omitted count
- confidence, unresolved, external, traversal gap 표시
- source navigation
- snapshot identity와 stale response rejection
- VS Code theme, keyboard, high contrast 지원

### 7.2 제외

- 전체 raw Project Graph 또는 무제한 force-directed graph를 기본 화면으로 제공
- cross-statement def-use chain, alias analysis, variable-level data-flow slicing
- expression-level short-circuit/ternary CFG
- runtime instrumentation과 trace collection
- AI가 생성한 자유 형식 설명
- collaboration server와 실시간 공동 편집
- architecture score, code health score, learning progress score
- 모든 언어와 framework의 동적 dispatch 완전 해석

## 8. 아키텍처

### 8.1 의존성 방향

```text
extension -> application/codeFlow -> insights/semanticFlow -> graph -> shared
extension/moduleVisualization -> extension/workspaceAnalysis -> analyzer -> graph -> shared
extension/moduleVisualization -> webview/moduleVisualizer -> application/moduleFlow
application/moduleFlow -> insights/projectModules -> graph -> shared
application/moduleFlow -> protocol/moduleFlow -> shared
webview/moduleVisualizer -> protocol/moduleFlow -> shared
extension -> analyzer/functionLogic -> shared
extension -> protocol/codeFlow -> shared
webview/codeFlow -> protocol/codeFlow -> shared
webview/functionVisualizer -> protocol/codeFlow -> shared
webview/functionVisualizer -> protocol/functionVisualizer -> shared
vscode/sourceNavigation -> shared
```

Webview는 Project Graph, 파일 시스템, VS Code API에 직접 접근하지 않는다.

### 8.2 모듈 책임

#### `insights/semanticFlow`

- framework entrypoint와 callable mapping
- bounded iterative traversal
- confidence와 coverage gap 보존
- Webview와 VS Code에 의존하지 않는 domain model

#### `insights/projectModules`

- neutral manifest, framework root, source-area fallback 경계 병합
- portable canonical path 기반 nearest-owner와 nested module parent 계산
- direct/descendant source exposure 분리
- cross-module relation과 confidence bucket 집계
- internal self-loop metric, external boundary, exact omission count 보존
- filesystem, Webview, VS Code에 의존하지 않는 pure domain model

#### `application/moduleFlow`

- 전체 Project Module Index와 raw Project Graph를 Host에 유지하는 snapshot-local projection
- Execution/Dependency/All boundaries lens별 relation 선택과 module pair 집계
- list 80/160, detail 40/5, expand 48/96 hard budget 및 exact omitted count 적용
- analyzer module/edge/function identity를 opaque protocol identity로 변환
- absolute path와 제어 문자를 제거한 safe label/location projection
- child module 또는 cross-module boundary function을 한 logical layer씩 반환하는 delta
- iterative SCC, condensation DAG rank, content-sized box, cycle enclosure 계산
- unrelated box를 통과하지 않는 orthogonal track/outer-channel edge routing
- VS Code API와 Webview DOM에 의존하지 않는 deterministic layout public surface

#### `application/codeFlow`

- 사용자 질문을 domain query로 변환
- catalog와 detail payload projection
- source display와 protocol budget 적용
- stage/label을 evidence보다 강하게 표현하지 않음
- function-local domain block을 opaque protocol identity와 safe source display로 변환
- retained block의 label/branch와 value-change target/operator/value를 생략 없는 JSON
  payload로 변환
- direct call edge를 callsite source range로 function-local block에 매칭
- 언어 parser의 call expression을 condition/loop/switch evidence range에 매칭
- 누락된 multiline-body edge는 unique concrete name일 때만 inferred target으로 보완
- concrete callee를 snapshot-local source token으로 변환하고 unique target budget 적용
- iterative longest-rank 계산과 branch lane 배치
- visible text 기반 variable node dimension과 rank별 최대 높이 누적
- repeat/continue와 long exit의 outer-channel edge routing
- source/target 외 node rectangle을 통과하지 않는 rank-gap connector routing

#### `analyzer/functionLogic`

- 현재 source에서 선택 함수 body를 정확한 이름과 선언 위치로 매칭
- 커서 위치를 포함하는 가장 안쪽 callable을 iterative syntax-tree traversal로 해석
- 익명 callable을 exact selection position으로 다시 매칭
- TypeScript/JavaScript compiler AST 기반 statement classification
- Python/Java Lezer adapter 기반 statement/callsite classification
- F#/OCaml/Elixir 공통 pipe-forward adapter 기반 input/stage/argument-insertion classification
- 언어 중립 structured-control contract로 branch container와 transfer를 구성
- 명시적 stack/container 기반 structured control-flow edge 구성
- source range, exact/inferred confidence, parser/runtime gap 보존
- Webview, protocol, VS Code API에 의존하지 않는 domain model

#### `analyzer/functionLogic/valueChanges`

- variable/property 초기화, 대입, 증감, 삭제와 loop binding의 exact evidence 추출
- common in-place method 이름을 이용한 receiver-mutation 후보 추출
- receiver method 의미는 항상 inferred로 유지하고 static type 형태의 receiver는 제외
- 언어별 AST/Lezer adapter와 공유하는 target/operation/confidence 계약
- block 내부 중복 annotation 제거, source 순서와 전체 target/operator/value text 보존

#### `analyzer/core/lezerSource`

- Python/Java graph analyzer와 Function Logic adapter가 함께 쓰는 immutable parser snapshot
- UTF-16 line/range 변환과 iterative child/descendant/error traversal
- 언어별 syntax module이 `functionLogic` 내부 구현에 역의존하지 않게 하는 공통 하위 경계

#### `analyzer/languages/python`, `analyzer/languages/java`, `analyzer/languages/functional`

- Function Logic과 같은 Lezer source snapshot으로 callable/type symbol 추출
- lexical owner, same-file, unique workspace evidence를 순서대로 적용하는 보수적 call resolution
- Python `self` member와 constructor, Java owner/qualified call과 constructor를 우선 해석
- Java overload는 arity가 일치할 때만 후보로 유지하며 type/virtual dispatch는 추측하지 않음
- functional profile registry가 F#/OCaml last-argument와 Elixir first-argument semantics를 분리
- iterative callable/pipe scan, UTF-16 range, 문자열/comment 제외, 독립 pipeline 경계를 공유

#### `analyzer/rust`

- Rust engine의 primary graph evidence 유지
- Rust가 file node만 제공하는 Java/F#/OCaml/Elixir 파일에 한해 in-process symbol/call graph를 병합
- supplement 대상 언어의 양 끝점이 모두 허용된 edge만 추가하여 언어 경계를 보존

#### `protocol/codeFlow`

- catalog request/response
- entrypoint selection
- source selection
- statement evidence selection
- flow detail과 failure
- runtime validation 가능한 JSON 계약

#### `protocol/moduleFlow`

- `moduleFlow/list`, `moduleFlow/detail`, `moduleFlow/expand`, `moduleFlow/openSource` request
- initial scene, detail, expansion delta, failure response의 JSON-only 계약
- list 80 module/160 edge, detail 40 relation/5 evidence, expand 48 node/96 edge 상한
- snapshot-local module/edge/function/evidence/source opaque identity
- `graphVersion`과 browser `requestId`를 이용한 stale/late response guard
- raw path/range와 analyzer ID를 request로 받지 않는 runtime validation

#### `protocol/functionVisualizer`

- 전용 editor tab graph snapshot version
- analyzer ID를 노출하지 않는 root function source token과 label
- 새 root를 열 때 이전 browser history를 무효화하는 session contract

#### `webview/codeFlow`

- start mode와 검색
- flow ribbon 렌더링
- Function Visualizer와 공유하는 positioned graph node, SVG edge/label, selection panel 렌더링
- confidence/unknown 표시
- source action
- 브라우저 상태와 late response rejection
- concrete 함수 선택을 전용 Function Visualizer tab으로 전달

#### `webview/moduleVisualizer`

- 재사용 가능한 전용 Module Flow WebviewPanel lifecycle
- panel snapshot마다 독립적인 graph delivery, source token, evidence token registry
- 기본 Execution lens와 Dependency/All boundaries, external/inferred filter
- bounded delta를 기존 scene에 merge하는 same-canvas child/boundary-function expansion
- merged scene node/edge budget과 oldest-expansion eviction을 담당하는 bounded expansion store
- variable-size box와 생략 없는 text, SCC cycle group, orthogonal routed edge 렌더링
- relayout 전 선택 module anchor capture와 복원, 새 node/edge만 적용하는 reduced-motion-aware animation
- viewport transform, selection/loading patch, scene rebuild를 서로 다른 invalidation tier로 분리하고
  하나의 animation-frame scheduler에서 병합
- scene wrapper 하나에 centered translate/scale을 적용하며 zoom, pan, selection, loading, resize는
  SCC/layout 계산과 graph DOM 재생성을 호출하지 않음
- module/edge/cycle identity별 keyed DOM registry와 bounded structural layout LRU를 사용해
  expansion/collapse에서도 retained element와 keyboard focus를 보존
- hidden panel browser context를 해제하고 active Host projection으로 rehydrate하는 lifecycle
- 선택 module/edge의 bounded detail/evidence rail과 Host-authorized source action
- concrete function을 기존 Function Visualizer에 전달하는 handoff
- `graphVersion`/`requestId`가 다른 response를 적용하지 않는 browser stale guard

#### `webview/functionVisualizer`

- VS Code WebviewPanel lifecycle과 독립 graph/source/evidence token session
- Start/Choose/Do/Finish 함수 읽기 프레임
- direct callee와 block-local graph attachment action
- root/child block을 한 canvas에 합치는 compound layout과 callsite connector
- root/child compound layout에서도 post-loop continuation을 loop-back 고리 아래에 유지
- callsite, child terminal, resume gateway를 잇는 call/call-return connector
- edge별 node port/rank track과 parent-aware lane ordering을 담당하는 routing module
- 별도 child graph/card를 만들지 않는 single-viewport renderer
- iterative descendant collapse, depth/total budget, ancestor-token cycle guard
- iterative breadcrumb history와 parent navigation
- 이미 방문한 token 재사용을 통한 call-cycle guard
- 새 root snapshot version으로 late child response rejection

#### `extension/currentFunctionVisualization`

- editor context menu command 등록과 current document snapshot 획득
- current-file analyzer 실행과 cursor target/analyzed symbol 매칭
- 분석기가 놓친 callable의 exact syntax-tree-backed graph node 보강
- 저장되지 않은 current source snapshot을 전용 Function Visualizer tab으로 직접 전달

#### `extension/workspaceAnalysis`

- workspace-only graph 획득 정책을 analyzer/cache/VS Code composition과 분리한 coordinator
- 현재 workspace fingerprint와 정확히 일치하는 cache entry만 재사용
- `latest` 또는 stale cache fallback을 제공하지 않음
- cache disabled, fingerprint 생성 실패, 빈 fingerprint에서는 fresh workspace analysis 실행
- exact fingerprint가 없는 fresh result는 재사용 cache로 저장하지 않음
- 동시에 들어온 acquisition을 하나의 single-flight promise로 공유하고 종료 후 retry 가능하게 정리
- cache/analysis graph metadata를 같은 normalized snapshot contract로 반환

#### `extension/moduleVisualization`

- `Open Module Flow` command와 Code Flow sidebar title action 등록
- workspace coordinator 결과를 Module Visualizer panel에 전달
- 열린 workspace가 없을 때 분석이나 빈 projection을 추측하지 않고 unavailable 상태 반환

### 8.3 탐색 구현 규칙

- queue 또는 stack 기반 반복 탐색
- visited set 필수
- 모든 query에 maxDepth와 maxSteps 적용
- function-local traversal에는 maxLogicBlocks 적용
- cycle과 converging branch를 finite하게 처리
- unresolved와 external target을 concrete node와 구분
- initial payload와 search result에 hard budget 적용
- Function Logic direct callee는 eager traversal하지 않고 최대 24개 unique target만 투영
- 하위 함수 진입은 한 단계씩 직렬 처리하고 graph attachment는 최대 depth 6, 총 32개로 제한
- attached ancestor의 source token은 visited guard로 재사용하고 별도 진입 history의 token은
  breadcrumb에서 재사용
- Module Flow initial/detail/expansion query에 각각 독립된 hard budget 적용
- Module Flow SCC와 condensation traversal은 명시적 stack/queue와 visited set으로 계산
- module expansion은 arbitrary recursive subtree를 요청하지 않고 child module 또는 boundary function
  한 logical layer만 반환

## 9. Protocol 원칙

- 모든 Webview request는 runtime validation을 통과해야 함
- graph snapshot version이 일치하지 않는 request/response는 무시
- 동일 query의 late response를 막기 위한 browser request ID 사용
- analyzer node ID와 absolute path는 tokenized surface에 노출하지 않음
- source token과 flow ID는 snapshot-local opaque identity
- statement evidence token도 snapshot-local opaque identity이며 raw path/range를 request로
  받지 않음
- Function Visualizer의 새 root마다 새 snapshot version을 발급해 late child response를 거부
- Module Flow의 module/edge/function/evidence identity도 panel snapshot-local opaque token이며
  raw graph identity나 path/range를 노출하지 않음
- 모든 Module Flow request/response는 `graphVersion`과 operation-local `requestId`가 현재 panel
  state와 일치할 때만 적용
- payload는 Map, Set, class instance 없이 JSON 직렬화 가능해야 함

## 10. 성능

- graph load 시 전체 graph는 Extension Host에 유지하고 Webview에는 shell과 bounded
  catalog만 전송
- catalog 기본 노출 수는 최대 24개, 검색 응답은 최대 50개
- flow detail은 기본 depth 3, 최대 30 step
- function logic은 기본 120, 최대 300 statement block
- retained function-logic block의 value-change annotation은 모두 보존하되 runtime value
  propagation은 수행하지 않음
- function logic의 direct concrete callee는 함수당 최대 24개이며 사용자 action 때만 분석
- Function Visualizer attached child는 최대 depth 6, 총 32개이며 한 번에 하나씩 Host에 요청
- compound function graph layout은 합쳐진 block/edge를 한 finite canvas에 배치하고
  edge별 port/rank track을 예약
- function search는 host-side index와 cursor/request identity 사용
- graph snapshot 동안 semantic-flow, function architecture, function index를 재사용
- project module index는 graph snapshot당 한 번 계산하고 전체 index는 Host에 유지
- Module Flow initial scene은 최대 80 module/160 edge만 전송
- Module Flow detail은 최대 40 relation/5 evidence, 한 expansion delta는 최대 48 node/96 edge로 제한
- 여러 expansion을 합친 Module Flow browser scene은 최대 500 node/1,000 edge이며, 새 branch를
  유지하기 위해 가장 오래된 expansion부터 반복적으로 해제한다.
- Module Flow scene layout은 structural payload가 바뀔 때만 계산하며 최근 base/expansion 조합은
  snapshot-local 2-entry LRU로 재사용. cache key는 전체 payload JSON 복사본이 아니라 snapshot,
  base request, expansion identity로 구성하며 zoom/scroll/selection/loading/entry state는 넣지 않음
- 연속 wheel/toolbar/resize/selection update는 animation frame당 한 번만 commit하고 retained
  node/edge/cycle DOM은 keyed reconciliation으로 재사용
- 빠르게 바뀌는 module/edge detail selection은 60ms 동안 마지막 target으로 합쳐 Host projection
  요청과 relation aggregation이 선택 횟수만큼 누적되지 않게 함
- 작은 Module Flow graph는 viewport 중앙에 두고 큰 graph stage에는 화면 기준 32px padding을 두며,
  card는 content visibility containment로 viewport 밖 paint 비용을 줄임
- Module Flow tab이 숨겨지면 Webview context, DOM registry, timer, observer를 해제하고 다시 보일 때
  Host가 보유한 현재 projection으로 복원하여 workspace analysis를 반복하지 않음
- workspace scan은 이미 열린 document만 editor snapshot을 사용하고 나머지 saved file은
  `workspace.fs.readFile`로 일시적으로 읽어 VS Code TextDocument cache에 누적하지 않음
- Rust workspace manifest는 iterable chunk와 stream backpressure로 전달하여 전체 source input의
  추가 결합 Buffer를 만들지 않으며 Extension Host 종료 시 소유한 analyzer child process를 종료
- analysis cache는 workspace 2개/current-file 8개/latest 1개 revision만 유지하고, 단일 graph가
  byte budget을 넘으면 저장하지 않음. persistence-disabled memory store는 active graph 하나만 유지
- module relation마다 대표 evidence는 최대 5개만 유지하고 모든 bounded payload에 exact omitted
  count를 함께 제공
- function logic은 선택 시 현재 editor document를 읽어 unsaved source도 반영
- Python/Java Lezer와 functional pipeline snapshot은 file content hash가 같을 때 재사용
- Python/Java/functional workspace callable index는 대상 file path/content hash 집합이 바뀔 때만 재구성
- 브라우저는 DOM에 보이는 flow와 검색 결과만 렌더링
- 대형 그래프에서도 사용자가 첫 유용한 flow를 선택하기 전 전체 row inventory를
  만들지 않음

## 11. 보안과 개인정보

- 기본 분석은 로컬에서 수행
- 명시적 동의 없이 source를 외부 서비스로 전송하지 않음
- Webview는 strict CSP와 nonce script 사용
- host absolute path와 analyzer identity를 tokenized payload에서 제거
- statement path/range는 Host registry에만 보존하고 Webview에는 opaque evidence token과
  safe display location만 전달
- Module Flow의 domain module/edge/function ID와 evidence path/range는 panel-local Host registry에만
  보존하고 Webview에는 opaque token만 전달
- export는 사용자가 선택한 위치에만 생성
- 브라우저 로그에 source content를 포함하지 않음

## 12. 접근성

- 모든 flow action은 키보드로 실행 가능
- stage와 confidence는 색상만으로 전달하지 않음
- value target kind와 exact/inferred 상태를 텍스트 및 solid/dashed border로 함께 전달
- tree/ribbon depth와 선택 상태에 ARIA 정보 제공
- focus 이동이 source open과 flow expansion 사이에서 예측 가능해야 함
- Module Flow의 relation lens, module/edge selection, expansion, source/Function Visualizer action을
  keyboard로 실행할 수 있어야 함
- VS Code light, dark, high contrast theme 사용
- reduced motion 환경에서 animation을 요구하지 않음

## 13. 테스트 전략

### 13.1 Domain

- cycle, duplicate edge, depth limit, step limit
- ambiguous handler, unresolved target, external target
- HTTP와 GraphQL entrypoint
- 임의 함수 downstream와 known entrypoint context
- confidence 약화 규칙
- if/else, nested branch, loop repeat/exit, switch, try, return/throw
- variable/property write exact classification과 receiver mutation inferred classification
- loop binding과 body mutation이 각자 소유 block에 남는지 검증
- Python functional-chain fixture로 constructor/variable receiver의 실행 순서, 단계별 drill target,
  중복 method owner 판별, subscript-key call의 chain 오탐 방지를 함께 검증
- F#/OCaml/Elixir fixture로 pipe stage 순서, first/final argument semantics, module owner drill target,
  문자열/comment 오탐과 독립 pipeline 분리를 검증
- function match failure, unsupported language, block limit
- manifest/framework/source-area module ownership, nested package, external boundary
- cross-module relation pair aggregation과 confidence/evidence/omitted count
- iterative SCC, cycle group, deterministic condensation rank, obstacle-safe orthogonal route

### 13.2 Application/Protocol

- catalog/detail hard budget
- opaque flow/source identity
- opaque statement evidence identity와 snapshot invalidation
- absolute path redaction
- malformed request rejection
- stale graph version rejection
- late search response rejection
- Module Flow list 80/160, detail 40/5, expand 48/96 budget clamp와 exact omitted count
- Module Flow module/edge/function/evidence opaque identity와 absolute path redaction
- malformed/stale/late Module Flow request rejection과 panel snapshot invalidation
- workspace coordinator exact fingerprint cache hit, cache miss, cache disabled, fingerprint failure,
  no-latest-fallback, single-flight/retry

### 13.3 Webview

- 분석 전 empty state
- entrypoint/function start mode 전환
- catalog 검색과 선택
- flow detail, gaps, confidence 렌더링
- function signature, graph nodes, labeled edges, node selection 렌더링
- graph node와 selection panel의 VAR/FIELD/RECEIVER value-change row 렌더링
- 180자를 넘는 statement, 긴 value/target, 긴 child-function/resume label도 ellipsis 없이
  렌더링하고 내용 기반 node height가 증가하는지 검증
- root/nested/deep block이 각각 depth tint class를 받고 최대 단계에서 안정적으로 clamp되는지 검증
- nested compound frame 포함 관계, continuation 제외, attached scope별 parent identity 격리,
  pointer-transparent group/edge/node layer 순서를 검증
- JSX custom component callsite, intrinsic 제외, callback scope 격리, memo/forwardRef binding 분석 검증
- child의 loading/loaded 재렌더링 동안 callsite의 viewport 상대 위치와 양방향 scroll이
  유지되고 새 child block/edge에만 entry animation class가 적용되는지 검증
- branch lane, loop back edge, long exit channel 렌더링
- loop 종료 후 statement가 loop body rank와 back-edge ring 바깥에 배치되는지 검증
- exact statement evidence action
- source action
- cache clear와 graph replacement reset
- keyboard와 accessible labels
- Module Flow 전용 tab, Execution/Dependency/All boundaries lens와 external/inferred filter
- 가변 크기 module/function box의 full label, SCC enclosure, box-crossing 없는 orthogonal edge
- module click의 same-canvas boundary-function merge, clicked-anchor scroll 복원, entry animation
- reduced-motion 환경의 animation 생략
- bounded module/edge detail, evidence/source action, Function Visualizer handoff
- graphVersion/requestId가 다른 list/detail/expand response 무시

### 13.4 Architecture

- initial publish가 Guided Tour/Reading Plan을 계산하거나 전송하지 않는지 확인
- Webview가 raw Project Graph 내부를 직접 해석하지 않는지 확인
- codeFlow public surface 밖의 deep import 방지
- traversal 재귀 호출 금지
- analyzer/functionLogic과 protocol/Webview 사이의 의존성 역전 확인
- Module Flow 전체 index가 Host에 남고 Webview payload가 hard budget을 지키는지 확인
- application/moduleFlow의 pure layout이 VS Code API/DOM에 의존하지 않는지 확인
- workspace coordinator가 latest/stale cache API를 의존성으로 받지 않는지 확인

## 14. 제품 전환과 제거 대상

### 14.1 즉시 제거되는 기본 경험

- Guide/Explore 탭
- 자동 선택된 한 개 mission
- Project Reading Plan
- 학습 stage와 visited progress
- Analysis Details 대시보드
- Browse Structure accordion
- 전체 그래프를 열기 위한 비활성 GUI action

### 14.2 유지하는 엔진 자산

- analyzer pipeline과 Rust engine
- Project Graph schema
- semantic-flow index
- change-impact traversal
- function architecture evidence
- function search index
- source token registry
- cache와 snapshot delivery

### 14.3 코드 정리 원칙

기존 Guided Tour, Reading Guide, Learning Journey의 Webview/Host 모듈과 중앙
message route는 제거한다. semantic-flow, architecture evidence처럼 새 CodeFlow가
직접 재사용할 수 있는 분석 자산은 UI 제품 가정과 분리해 유지한다. 분석 자산을
삭제하는 것과 제품 가정을 삭제하는 것을 구분한다.

## 15. 구현 마일스톤

### Milestone 1: Product Reset

- 새 제품 정의와 README
- Guide/Explore 기본 정보 구조 제거
- CodeFlow protocol/application/webview feature folder
- entrypoint catalog와 vertical Flow Reader
- function search와 entrypoint step에서 Function Logic Reader 열기

### Milestone 2: Function Logic Reader

- TypeScript/JavaScript compiler AST, Python/Java Lezer, F#/OCaml/Elixir pipeline current-source parsing
- statement/condition/loop/mutation/call/exit classification
- structured true/false/iterate/repeat/return/throw transfer
- exact statement evidence token과 source navigation
- bounded layered graph layout과 labeled control edge
- known entrypoint context와 parser/runtime gap
- 전용 Function Visualizer editor tab과 Start/Choose/Do/Finish 이해 프레임
- callsite와 resume gateway 사이에서 동일 canvas로 연결되는 lazy child function,
  edge-overlap guard, branch collapse, cycle guard

### Milestone 3: Flow Interaction

- caller/callee/context direction 전환
- branch lazy expansion
- direct callee lazy expansion과 set-as-root
- edge evidence detail
- editor context menu에서 현재 편집기 callable로 시작

### Milestone 4: Visual Canvas

- editor-tab horizontal flow lanes
- stable layout와 breadcrumbs
- sidebar와 editor selection 동기화
- flow pin/hide와 saved presentation
- Mermaid/SVG export

### Milestone 5: Change Understanding

- Git 변경 심볼에서 시작
- affected entrypoint cone
- base/head flow diff
- PR용 bounded flow artifact

### Milestone 6: Deeper Evidence

- type-backed JavaScript/TypeScript call resolution
- import/type-backed Python/Java call resolution과 Java overload/virtual dispatch 정밀화
- expression-level short-circuit, optional-chain, ternary control flow
- finally를 통과하는 abrupt completion의 정밀 모델
- data-flow slice 실험
- optional observed runtime evidence adapter

### Milestone 7: Module Flow (현재 구현)

Module Flow vertical slice는 현재 다음 범위를 제공한다. 모든 edge는 정적 분석으로 발견한
가능한 관계이며 observed runtime trace나 실행 순서가 아니다.

- manifest 기반 neutral `projectPackageRoots` analyzer metadata
- nested package, framework root, source-area fallback의 non-overlapping module index
- sidebar 본문의 설명형 `Open Module Flow` CTA, Command Palette/sidebar title action과 재사용 가능한 전용 editor tab
- cross-module Execution/Dependency/All boundaries lens와 external/inferred filter
- 초기 80 module/160 edge, detail 40 relation/5 evidence, expansion 48 node/96 edge budget
- SCC-aware layered module layout, cycle grouping, 가변 크기 box, 생략 없는 label
- 관계없는 box를 통과하지 않는 orthogonal edge track과 outer channel
- 선택 module의 child/boundary function을 현재 canvas에 lazy expansion
- clicked-module scroll anchor 유지와 reduced-motion-aware entry animation
- module/edge detail, evidence/source action, function에서 기존 Function Visualizer로 연결
- snapshot-local opaque identity와 `graphVersion`/`requestId` stale response guard
- exact workspace fingerprint cache만 재사용하고 latest/stale fallback을 하지 않는 coordinator

## 16. 성공 기준

정량 지표는 분석 데이터의 양이 아니라 이해 작업의 속도를 측정한다.

- 분석 완료 후 두 번 이하의 action으로 첫 flow를 열 수 있음
- 모든 concrete step에서 한 번의 action으로 source를 열 수 있음
- 선택 함수에서 condition, branch, effect candidate, exit를 declaration이 아닌 실제
  statement source로 한 번에 열 수 있음
- direct concrete callee를 해당 call block에서 동일 graph canvas에 붙이고 재클릭 한 번으로
  그 하위 branch를 접을 수 있음
- attached child가 callsite와 caller continuation 사이에 놓이고 call/control edge가 같은
  선분을 공유하지 않음
- 두 번 이하의 action으로 bounded Module Flow를 열고 Execution/Dependency/All boundaries 질문을
  전환할 수 있음
- Module Flow retained box의 label/detail이 생략되지 않고 cycle/edge route가 관계없는 box를
  가로지르지 않음
- module click 뒤 boundary function이 같은 canvas에 붙고 선택 anchor의 viewport 위치가 유지됨
- Module Flow function에서 한 번의 action으로 Function Visualizer statement graph를 열 수 있음
- 기본 flow가 스크롤 가능한 작은 단위로 유지됨
- 사용자가 5분 안에 entry, 주요 responsibility shift, effect 또는 unknown을 설명할 수 있음
- static/inferred 관계를 runtime fact로 오해하게 만드는 표기가 없음
- unresolved와 traversal limit이 숨겨지지 않음
- 새 graph snapshot에서 오래된 flow/source action이 실행되지 않음

## 17. 완료 정의

Product Reset MVP는 다음 조건을 모두 만족할 때 완료된다.

- Activity Bar 첫 화면이 `Start a Flow` 경험임
- Guided Tour와 Reading Plan이 production initial publish 경로에 없음
- 사용자가 HTTP/GraphQL entrypoint를 검색하고 flow를 열 수 있음
- 사용자가 임의 함수를 검색하고 그 함수 중심 flow context를 열 수 있음
- TypeScript/JavaScript/Python/Java 선택 함수가 statement-level logic block으로,
  F#/OCaml/Elixir 선택 함수가 source-ordered pipe-forward block으로 표시됨
- flow step에 stage, source, confidence, resolution이 표시됨
- source token으로 concrete definition을 열 수 있음
- evidence token으로 exact function statement를 열 수 있음
- 함수 검색, entrypoint step, editor context menu가 동일한 전용 Function Visualizer tab을
  열 수 있음
- direct callee를 lazy하게 현재 graph canvas에 붙이고 cycle에서는 ancestor 또는 기존
  breadcrumb를 재사용함
- `Open Module Flow`가 정확한 workspace snapshot의 bounded module scene을 전용 tab에 표시함
- Module Flow가 Execution/Dependency/All boundaries lens, SCC group, same-canvas boundary function,
  bounded detail/evidence와 Function Visualizer handoff를 제공함
- Module Flow cache가 exact fingerprint만 재사용하고 opaque token/stale response guard를 적용함
- coverage gap과 unknown이 별도 상태로 표시됨
- 관련 unit, protocol validation, Webview 테스트가 통과함
- README와 package description이 새 제품 약속을 반영함

## 18. Open Questions

- 최종 제품명에서 `Analyzer`를 유지할지 `Flow` 중심 이름으로 바꿀지
- decision/effect stage를 어느 수준의 evidence부터 자동 부여할지
- source callsite token을 definition token과 별도로 도입할지
- Python/Java import와 build metadata를 어느 수준까지 읽어 cross-file call confidence를
  높일지
- saved flow를 workspace 파일로 저장할지 extension storage에 저장할지
- editor canvas의 기본 grouping을 architecture layer와 source package 중 무엇으로 할지
- runtime observation adapter를 core 제품에 포함할지 별도 plugin으로 둘지
