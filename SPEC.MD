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
  | "typescript" | "javascript" | "python" | "java"
  | "fsharp" | "ocaml" | "elixir" | "unsupported";

type FunctionLogicBlock = {
  id: string;
  kind:
    | "entry" | "condition" | "loop" | "switch" | "try"
    | "render" | "event" | "call" | "effect" | "mutation" | "operation"
    | "return" | "throw" | "break" | "continue" | "exit";
  label: string;
  depth: number;
  branchLabel?: string;
  confidence: "exact" | "inferred";
  sourceLocation?: string;
  evidenceToken?: string;
  drillTargets?: FunctionLogicDrillTarget[];
  valueChanges?: FunctionLogicValueChange[];
  valueAccesses?: FunctionLogicValueAccess[];
};

type FunctionLogicValueChange = {
  target: string;
  targetKind: "variable" | "property" | "receiver";
  operation: "initialize" | "assign" | "update" | "delete" | "iterate" | "mutate";
  operator: string;
  value?: string;
  confidence: "exact" | "inferred";
};

type FunctionLogicValueBinding = {
  id: string;
  name: string;
  kind: "parameter" | "local" | "constant";
  definitionBlockId: string;
  confidence: "exact" | "inferred";
};

type FunctionLogicValueAccess = {
  bindingId: string;
  name: string;
  bindingKind: "parameter" | "local" | "constant";
  access: "define" | "read" | "write" | "readwrite";
  usage?: "consume" | "sink";
  confidence: "exact" | "inferred";
};

type FunctionLogicValueFlow = {
  id: string;
  bindingId: string;
  sourceBlockId: string;
  targetBlockId: string;
  targetAccess: "read" | "readwrite";
  targetUsage?: "consume" | "sink";
  confidence: "exact" | "inferred";
};

type FunctionLogicDrillTarget = {
  sourceToken: string;
  qualifiedName: string;
  confidence: "exact" | "resolved" | "inferred" | "unresolved";
  callsiteCount: number;
  relation?: "call" | "render" | "event";
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

TypeScript/JavaScript, Python, Java Function Logic은 `valueBindings`와 `valueFlows`를
추가로 제공한다. parameter definition은 entry block, local/constant definition은 declaration
source를 포함하는 가장 구체적인 visible block에 둔다. 각 block은 같은 opaque binding identity의
`DEFINE`, `READ`, `WRITE`, `READ/WRITE` access를 가진다. read와 read/write access에서는 control-flow
predecessor를 역방향 queue로 탐색해 각 path에서 가장 가까운 definition 또는 write만 연결한다.
따라서 branch merge에는 둘 이상의 reaching definition이 보존되고 loop에서는 loop-carried
definition이 생길 수 있다. 탐색은 recursion 없이 visited/best-depth map, 최대 depth,
binding/access/flow hard limit를 적용하며 누락 수는 `parseLimited` gap으로 노출한다.

read semantics는 access 종류와 독립적인 `usage`로 보존한다. condition, arithmetic/boolean
expression, local initializer, call receiver처럼 함수 내부 계산에 참여하는 read는 `consume`다.
return/throw/yield, call/new argument, JSX prop/child/component 전달, object/array aggregate 저장,
property/element assignment 우변처럼 직접 lexical binding 추적이 끝나는 source boundary는
`sink`다. `sink`는 보안 취약점이나 위험한 목적지를 뜻하지 않으며 callee 실행, runtime 값 이동,
heap/alias taint가 관찰되었다는 주장도 아니다. 하나의 block에 같은 binding의 consume와 sink가
모두 있으면 서로 다른 access/flow semantics로 보존한다.

TypeScript/JavaScript `const`와 Java `final` local은 exact constant다. Python은 const keyword가
없으므로 함수 안에서 한 번만 정의된 대문자 이름만 inferred constant로 분류한다. concise JSX
`.map` callback parameter는 inferred render-loop definition으로 포함하지만 event callback body는
별도 handler Function Logic에 남긴다. source-only pass에서 같은 철자의 shadowed declaration을
정확히 구분할 수 없으면 해당 이름 전체를 생략한다. 이 contract는 lexical static flow이며
runtime value, alias/heap/property flow, closure capture, interprocedural data flow를 계산하지 않는다.

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
event relation은 synchronous call attachment와 다르게 처리한다. 등록 block의 기존 outgoing
control edge는 그대로 두고 `event binding -> handler entry`를 별도의 dashed dispatch branch로
붙인다. handler terminal에서 registration continuation으로 돌아오는 call-return edge나 resume
gateway를 만들지 않는다. 이는 event 발생 시점과 횟수를 관측했다는 뜻이 아니라, source에
보이는 handler 등록 관계만 보존한 것이다.

`true`, `false`, `case` edge label과 선택 block의 동일 transfer는 keyboard로 선택할 수 있다.
한 decision source에서는 한 edge만 활성 choice로 유지하며, nested decision의 choice는 서로
합성한다. 선택된 edge에서 시작한 후속 흐름은 shared merge와 그 뒤의 reachable continuation까지
강조하고 sibling alternative는 흐리게 표시한다. 재선택은 해당 choice를 해제하고 `Reset choices`는
전체 choice를 해제한다. 이 projection은 runtime trace가 아닌 static hypothetical scenario다.
projection traversal은 root에서 시작해 명시적인 queue, visited/minimum-depth map, 호출 인자의
maximum depth를 사용하며 재귀하지 않는다. 따라서 repeat/cycle edge가 있어도 bounded하게 종료한다.
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
  `- Function-card anchored same-canvas Function Logic
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

- TypeScript/JavaScript: compiler AST 기반 branch, loop, switch, try, call, mutation, exit,
  root 및 arm-nested ternary/`&&`/`||`/`??` expression flow, JSX event attribute와
  listener/event-property handler registration, parameter/local/`const` lexical value flow와
  inferred concise JSX `.map` callback parameter, JSX element/collection의 first-class
  `COMPONENT` value flow, consume/sink read semantics, static text embedded program과
  다중 callable definition scope
- Python: `if/elif/else`, `while/for`와 loop-else, `match/case`,
  `try/except/else/finally`, `with`, eager list/set/dictionary comprehension,
  deferred generator-argument comprehension, receiver-call chaining,
  call/mutation/return/raise/break/continue, parameter/local과 inferred uppercase constant flow,
  call argument/return/raise/aggregate sink semantics
- Java: `if/else`, while/for/enhanced-for/do, switch, `try/catch/finally`,
  try-with-resources, synchronized/labeled region, call/new/mutation/exit,
  parameter/local/exact `final` constant flow, argument/return/throw/aggregate sink semantics
- F#/OCaml/Elixir: `|>` input과 source-ordered stage, named stage callsite,
  F#/OCaml final-argument insertion, Elixir first-argument insertion

TypeScript/JavaScript는 control condition, initializer, direct `=` assignment, return,
switch value, concise arrow body의 root ternary와 `&&`, `||`, `??`를 별도 block으로
확장한다. 선택된 root ternary의 then/else arm에 다시 들어 있는 ternary도 명시적 stack으로
끝까지 계획하며 각 condition의 parent identity, 상대 depth, then/else label과 최종 merge를
보존한다. boolean context는 실제 truthy/falsy short-circuit 순서를 보존하고, value context는
선택된 branch를 기존 mutation/call/return block에 다시 합친다. optional chaining과 더 큰
call argument 안쪽에 포함된 branch expression은 안전한 평가 순서를 보장할 수 없어 containing
statement에 유지한다. Python/Java의 일반 expression-level boolean short-circuit와 모든 언어의
callee exception도 별도 block으로 확장하지 않는다. JSX output을 직접 선택하는 ternary와
`&&`, `||`, `??`는 기존 render branch로 확장하며 nested JSX ternary도 level별 condition,
parent, branch label을 보존한다. Python의
monkey patching/decorator/descriptor와 Java의 virtual dispatch,
reflection/framework interception/thread scheduling은 runtime unknown으로 남긴다.

TypeScript/JavaScript의 static code text는 일반 string value와 분리된 embedded-code 경계로
해석한다. direct/global `eval`, `Function` constructor/call, `setTimeout`/`setInterval` string
handler, Node `vm.runInContext`/`runInNewContext`/`runInThisContext`/`compileFunction`의 code
argument는 string literal, no-substitution template, explicit `js`/`ts` code tag 또는 literal-only
`+` concatenation이 정적으로 완성될 때만 parser에 전달한다. 저장된 literal은 function/control/
multi-statement 구조를 parser가 확인한 경우에만 `inferred` embedded program으로 보존한다.
일반 prose string, substitution template, identifier argument, runtime concatenation은 code로
실행하거나 추측하지 않는다.

하나의 embedded program 안에 여러 function declaration, function-valued variable, arrow,
method/accessor와 nested function이 존재할 수 있다. root program과 각 callable body는 명시적
queue로 독립 CFG를 만들고 `callable` block의 `defines` edge는 body가 분석되었지만 호출되지
않았음을 뜻한다. immediate eval/vm 경계는 embedded exit 뒤 host statement로 복귀한다.
`Function`/stored program은 definition-only, timer string은 `deferred` no-immediate-return 경로다.
embedded scope도 ternary/boolean/JSX 확장, callsite, parameter/local/constant value flow,
consume/sink를 재사용하지만 Scenario evaluator는 immediate edge로 도달한 scope만 계산한다.
모든 내부 evidence는 원래 host literal range로 remap하고 virtual owner block ID로 같은 range의
callsite를 구분한다.
JSX/TSX 함수의 initializer, direct assignment, consumed expression, return은 일반 statement
flow 안에서 lexical consumer 바로 앞의 source-ordered render subgraph로 확장한다.
intrinsic/custom element, prop·child call expression, conditional render, event binding을 각각
`render`/`call`/`condition`/`event` block으로 보존한다. 대문자 또는 member-style component tag는
exact render relation이며 direct JavaScript call로 가장하지 않는다. lowercase intrinsic tag도
구조 block으로 표시하지만 callee로 만들지 않는다. concise `.map(item => <Item />)` callback은
receiver dispatch와 반복 횟수를 확인할 수 없으므로 `loop`와 component render relation을
`inferred`로 보존한다. JSX attribute의 callback body는 render 시 실행되는 경로로 합치지 않고,
event dispatch 경계로 표시한 뒤 커서로 선택했을 때 독립 함수로 분석한다. named reference는
`event` drill target으로 보존해 같은 canvas에 별도 handler branch로 붙일 수 있지만 parent
render path로 돌아오는 edge는 만들지 않는다.
`memo`/`forwardRef` wrapper 내부 callable은 바깥 binding을 함수 identity로 사용한다.
`[<A />, <B />, <C />]` 형태의 array는 JSX component collection consumer와 각 element의
독립 render/drill target을 보존한다. 이 collection을 direct identifier 또는 element access로
받는 unambiguous local은 lexical kind와 별도로 `component` semantic role을 이어받고, 선언에서
선택 local과 return까지 기존 bounded definition-to-use flow로 연결한다. 이 role은 JSX element
creation과 render relation을 first-class static value로 표현할 뿐 해당 JavaScript 평가 시점의
framework component 실행을 뜻하지 않는다. call result, property alias, dynamic mutation,
reconciliation/scheduling은 runtime unknown으로 남긴다.
`addEventListener(event, handler)`, EventEmitter-style `on`/`once`/`addListener`,
`subscribe(handler)`, `target.onmessage = handler`도 registration statement를 `event` block으로
표시한다. 등록 호출 자체의 API method를 handler call로 펼치지 않고 stable named handler만
별도 relation으로 해석한다. `addEventListener`와 JSX attribute는 explicit syntax이며,
receiver type을 확인하지 못한 generic method/property spelling은 `inferred`를 유지한다.
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
Function Visualizer는 별도 editor tab에서 node와 labeled edge로 이루어진 free-pan
control-flow graph를 기본 표현으로 사용한다. viewport는 native scroll bound 대신 하나의
`translate + scale` transform을 사용하는 infinite-style canvas다. 전체 Project Graph가 아니라 현재 선택
함수의 bounded block만 layout 대상으로 삼는다. 전용 tab은 가로 최대 폭 제한을 두지 않고
graph viewport가 editor 높이의 최대 76%를 사용하는 bounded fixed-height box로 graph를 주 작업
영역으로 유지한다.
root 화면의 상단 chrome은 함수 title과 graph metric을 같은 행에 배치하고 source/static context만
짧은 보조 행으로 유지한다. 정상 idle status와 단일 root breadcrumb는 높이를 차지하지 않으며,
분석/attach/error 상태와 실제 parent-child history가 생겼을 때만 각각 다시 표시한다. upstream
entrypoint가 없으면 section 전체를 숨기고, 존재할 때는 `Reached from` inline strip으로 표시한다.
Inspector를 열면 graph 위에 겹치지 않고 별도 우측 grid column을 차지하며, 720px 이하에서는
graph 아래의 별도 고정 높이 row로 이동한다. drawer body는 workspace 높이 안에서 독립적으로
scroll하고 긴 evidence가 graph canvas의 크기나 위치를 밀어내지 않는다.

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

- right-side Inspector drawer 안의 `Start -> Choose -> Do -> Finish` 네 단계 읽기 프레임과
  실제 block counter 기반 설명
- Inspector drawer 안의 현재 함수 signature
- 위에서 아래로 진행하는 control-flow rank
- 같은 rank에서 좌우로 분리되는 branch lane
- label, source detail, branch/callee badge 길이에 따라 달라지는 node width/height
- statement/branch/value-change/child-function/resume 텍스트를 `...` 또는 `…`로 자르지 않고
  전체 보존하며, 가로 폭 이후에는 줄바꿈 수만큼 node height를 확장
- analyzer depth를 0~5 시각 단계로 정규화하고 기존 kind background 위에 옅은 tint를
  합성해 중첩 block을 구분하되, 색만으로 control 의미를 새로 부여하지 않음
- analyzer가 제공한 opaque parent block identity를 사용해 body를 가진 control owner와 모든
  descendant statement를 하나의 큰 compound frame으로 계산하고 control 이후 continuation은 제외
- 초기 projection은 각 body hierarchy의 최외곽 compound frame만 표시한다. 내부 `BODY` owner를
  선택하면 해당 owner의 frame 하나를 새 최외곽 frame으로 승격하고, ancestor breadcrumb,
  `Parent body`, `Outermost` action으로 상위 또는 초기 projection에 복귀한다. 이 전환은 node/edge
  layout, branch choice, 함수 attach 상태를 변경하지 않는다.
- compound frame은 child function을 붙인 최종 layout에서 visited set을 둔 반복 기반 hierarchy로
  재계산하며 malformed parent cycle을 안정적으로 끊는다. frame은 pointer event를 받지 않고,
  frame 뒤/edge 중간/node 앞의 layer 순서를 유지한다.
- variable/property/receiver target과 operator/우변을 보여 주는 value-change row
- exact write는 실선, method-name 기반 receiver mutation은 inferred 점선으로 구분
- `PARAM`/`LOCAL`/`CONST` binding selector와 block-local `DEFINE`/`WRITE` 및
  `CONSUME`/`SINK` read semantics; read/write는 `CONSUME / WRITE` 또는 `SINK / WRITE`로
  함께 표시하고 node에서는 최대 8개 row와 정확한 추가 개수를 표시
- 선택한 binding 하나의 possible definition-to-use overlay를 별도 arrow/style로 표시하고,
  consume은 dotted cue, sink는 double/striped cue와 텍스트로 구분하며 branch choice 밖 endpoint를
  가진 value edge는 control choice와 함께 흐리게 처리
- 모든 Function Logic Inspector에 항상 존재하는 Debug Variables 유사
  `Name`/`Scenario input` editor에서 parameter별 JSON/scalar 입력 또는 local/constant
  definition override를 입력하고 같은 binding의 graph/selection access row에 즉시 표시
- editor는 Inspector의 최상단 non-shrinking row에 배치한다. analyzer binding row가 많으면
  variable list 내부만 bounded scroll하고, selected-block evidence가 길어도 editor를 압축하거나
  초기 viewport 밖으로 밀어내지 않는다.
- analyzer binding이 0개이거나 일부 이름을 놓친 경우에도 사용자가 lexical identifier 이름과
  초기값을 가진 `CUSTOM` variable을 최대 32개 추가/삭제할 수 있다. 같은 이름의 단일 analyzer
  binding이 이후 relayout에서 나타나면 session value를 그 실제 binding row로 승격한다.
- 선택 binding 및 그 값을 provenance로 갖는 downstream assignment의
  `DEFINED`/`CALCULATED`/`UPDATED`/`CONSUME`/`SINK` progression을 최대 80단계로 표시하며,
  source-backed initializer/assignment/compound assignment/increment를 `before -> after`로 계산
- 산술/비교/boolean/nullish/own-data member read와 JavaScript/Java 중첩 `?:`를 token/operator/value
  stack 기반으로 계산하고, call/constructor/getter/dynamic heap mutation/inferred receiver mutation은
  실행하지 않은 채 reason을 포함한 `unknown`으로 보존
- 선택한 true/false/case control edge와 dimmed block을 계산 CFG에서 제외하고, choice가 없는
  merge에서 서로 다른 값은 임의 선택 없이 `multiple reachable values` unknown으로 합침
- scenario value의 `Name` label을 누르면 공용 binding selector가 같은 binding을 선택하여
  해당 label, definition/use graph node, value-flow edge를 함께 highlight
- scenario 입력은 root graph browser session 동안만 유지하고 값 240자/분석 row 120개,
  사용자 추가 이름 80자/row 32개로 제한하며,
  Host 전송/source 변경/branch 자동 선택을 수행하지 않음; evaluator는 420자/180 token expression과
  1,200 work item의 명시적 상한을 사용
- UI text는 `--vscode-font-size`/`--vscode-font-family`, source와 value text는
  `--vscode-editor-font-size`/`--vscode-editor-font-family`를 기준으로 상대 크기를 계산
- condition/loop/call/mutation/effect/exit kind
- `true`, `false`, `iterate`, `exit`, `return`, `throw` labeled edge
- keyboard-accessible `true`, `false`, `case` choice와 선택 경로의 merge/후속 흐름 강조,
  전체 choice reset
- `repeat`와 `continue`를 위한 외곽 back-edge channel
- loop body terminal에서 exit continuation으로 layout-only 순서 제약을 추가해 루프 종료 후
  statement를 전체 back-edge 고리 아래에 배치
- 중간 node를 가로지르지 않는 long-exit outer channel
- 모든 수평 edge segment를 rank 사이 빈 공간 또는 outer channel에만 배치하는 box obstacle guard
- 각 edge에 독립된 source/target port와 rank-gap track을 주는 edge-overlap guard
- exact solid edge와 inferred/exception/back dashed edge
- exact/inferred confidence
- workspace-relative statement location
- graph node 선택 시 자동으로 열리고 detail, outgoing target, source action을 보여 주는
  graph-adjacent right-side Inspector drawer
- analyzer binding 유무와 관계없이 모든 새 root graph에서 Scenario tools를 찾을 수 있도록
  Inspector를 처음부터 열고, 사용자가 닫은 상태는 같은 root의 relayout 동안 유지
- Inspector 최상단의 non-shrinking scenario value editor, binding selector, 전체 direct callee
  목록, signature, 읽기 가이드와 drawer 내부 독립 scroll; 긴 scenario variable list는 editor
  내부에서 별도로 bounded scroll
- desktop에서는 graph와 별도 column, 작은 화면에서는 graph 아래 별도 row, 명시적 toggle/close,
  `Escape`, `aria-expanded`/`aria-hidden`/`inert` 상태
- child function attachment로 graph를 다시 그려도 같은 root에서는 drawer open 상태 유지
- 빈 canvas의 primary drag, 어느 target에서나 middle drag, modifier 없는 two-axis trackpad
  wheel로 상하좌우 screen-space translation을 변경하고 graph 원점의 모든 방향을 지나 pan 가능
- `− / 현재 배율 / + / Center / Fit` control과 1%~300% bounded zoom. `Center`는 현재 배율을
  유지한 채 전체 graph 중심을 viewport 중심에 맞추고, `Fit`은 양 축과 screen padding을 함께
  계산해 100% 이하에서 전체 graph를 가운데 배치
- viewport focus 상태의 `+`, `-`, `0`, `C`, `F` shortcut과 cursor world point를 유지하는
  Ctrl/Cmd-wheel focal zoom
- pan translation은 non-finite CSS transform을 막기 위해 ±10,000,000 screen pixel에서만
  numeric guard하고 일반 사용 중 보이는 canvas boundary를 만들지 않음
- Inspector/editor resize에는 기존 world center를, child attachment relayout에는 선택 callsite의
  screen position을 보존하며 pan/zoom은 analyzer 또는 graph layout을 다시 실행하지 않음
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
- 서로 다른 edge가 수직으로 교차하면 수평 edge에 곡선 line-jump를 그리고 교차점 바로 위에
  진행 방향 삼각형을 표시함. 가까운 교차점은 하나의 bridge로 묶되 endpoint와 동일 edge의
  자기 교차에는 bridge를 만들지 않음
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
- 빈 canvas를 이동 없이 클릭하거나 `Escape`를 누르면 module focus, lazy expansion, 관련 pending
  request를 해제하고 현재 lens/filter의 초기 bounded module scene으로 복원
- detail rail이나 editor 크기가 바뀌면 `ResizeObserver`가 현재 world center를 유지하며 stage
  extent와 centered offset만 다시 계산함

boundary function이 있는 module box를 클릭하면 새 view/card로 이동하지 않고 그 module의
incoming/outgoing boundary function과 concrete call/containment edge를 현재 canvas에 lazy하게
합친다. child module expansion도 명시적인 action으로 같은 canvas에 한 layer씩 합친다. 확장 전
클릭한 module의 viewport 상대 위치를 anchor로 저장하고 layout 뒤 같은 지점으로 복원한다. 새
node/edge만 짧게 등장시키며 `prefers-reduced-motion` 환경에서는 animation을 생략한다.

module 선택은 component expansion의 단일 focus 경계다. 다른 module을 선택하면 이전 module이
소유한 boundary function과 그 아래 Function Logic branch를 즉시 해제하고, 새로 클릭한 module의
component만 연결한다. child-module expansion은 다음 module을 선택하기 위한 탐색 context이므로
유지한다. 이전 module의 boundary-function 또는 function-logic 요청이 아직 진행 중이면 browser의
pending correlation을 제거하여 늦은 response가 이전 component를 다시 붙이지 못하게 한다.

module focus가 활성화되면 현재 bounded scene에서 선택 module을 기준으로 incoming edge만 따라간
ancestor 집합과 outgoing edge만 따라간 descendant 집합을 별도로 반복 탐색한다. 두 집합의 합과
그 endpoint를 모두 포함하는 edge만 layout에 전달하여 무관한 component와 공통 ancestor에서
갈라지는 sibling branch를 숨긴다. traversal은 `visited set`, 명시적 queue, scene node 수 기반
maximum depth를 사용한다. function 또는 statement block detail을 선택해도 소유 module focus는
유지한다. focus를 해제하면 expansion store까지 비워 처음 전달된 module/edge만 다시 표시한다.

확장된 entry/boundary function card를 선택하면 별도 Webview로 전환하지 않고 그 card를 anchor로
최대 48개 function block과 96개 control edge를 현재 Module Flow canvas에 이어 붙인다. function
card에서 entry block으로 명시적인 진입 edge를 만들고, `true`/`false`/`case`/loop/return 등의
Function Logic edge 의미를 유지한다. 같은 function card를 다시 선택하면 해당 function-local
branch만 접는다. relayout 뒤에도 function card의 viewport 상대 위치를 복원하며 새 block/edge에는
최대 12단계의 짧은 staggered animation만 적용한다. `prefers-reduced-motion`에서는 이를 생략한다.
함수 definition과 statement evidence는 detail rail의 명시적 source action으로 열 수 있다.

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
- Module Flow는 bounded initial scene 뒤 선택한 module의 child/boundary function과 선택한
  function의 statement flow만 lazy하게 확장하고 전체 Host index/source를 browser에 전송하지 않음.
  module component focus는 한 번에 하나이며 다른 module을 선택하면 이전 function/statement
  branch를 해제하되 child-module 탐색 context는 유지
- 선택 module이 있으면 bounded scene의 directional ancestor/descendant lineage만 표시하고,
  focus가 없으면 lazy branch가 없는 초기 module scene 전체를 표시

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
- TypeScript/JavaScript root/arm-nested ternary와 `&&`/`||`/`??` short-circuit expression flow
- TypeScript/JavaScript static code literal의 root program, 다중/nested callable body,
  immediate/definition/deferred flow
- `true`/`false`/`case` 선택을 합성하는 bounded, cycle-safe 후속 흐름 projection
- condition, branch, loop, switch, try, mutation, call, return/throw block
- 변수/프로퍼티 exact write와 receiver mutation 후보의 block-local value-change annotation
- TypeScript/JavaScript/Python/Java parameter/local/constant의 block-local access와 bounded
  reaching-definition flow, branch merge 및 loop-carried relation
- 함수 내부 exact statement evidence navigation
- 함수 내부 effect candidate의 inferred confidence
- 함수가 포함된 알려진 entrypoint 표시
- manifest 기반 `projectPackageRoots` metadata와 nested package/framework/source-area module index
- sidebar 본문의 설명형 `Open Module Flow` CTA, Command Palette/sidebar title action 및 전용 editor tab
- Execution/Dependency/All boundaries lens의 최대 80 module/160 edge initial scene
- SCC cycle group, 가변 크기 box, 생략 없는 label, obstacle-safe orthogonal route와
  교차 edge의 line-jump/direction cue
- 선택 module의 child/boundary function 및 function-card anchored statement flow의 same-canvas lazy expansion
- module/edge bounded detail, representative evidence, exact omitted count
- confidence, unresolved, external, traversal gap 표시
- source navigation
- snapshot identity와 stale response rejection
- VS Code theme, keyboard, high contrast 지원

### 7.2 제외

- 전체 raw Project Graph 또는 무제한 force-directed graph를 기본 화면으로 제공
- interprocedural def-use chain, alias/heap/property analysis, runtime value 계산과 closure capture
- F#/OCaml/Elixir lexical binding-level data-flow slicing
- call argument 내부의 nested expression flow와 optional-chain 세부 CFG
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
- 수직 교차점의 deterministic bridge cluster와 local direction path 계산
- VS Code API와 Webview DOM에 의존하지 않는 deterministic layout public surface

#### `application/codeFlow`

- 사용자 질문을 domain query로 변환
- catalog와 detail payload projection
- source display와 protocol budget 적용
- stage/label을 evidence보다 강하게 표현하지 않음
- function-local domain block을 opaque protocol identity와 safe source display로 변환
- retained block의 label/branch와 value-change target/operator/value를 생략 없는 JSON
  payload로 변환
- analyzer binding/value-flow identity를 snapshot-local opaque binding/block/flow identity로
  변환하고 consume/sink semantics를 유지하며 raw parser identity를 browser에 노출하지 않음
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
- access와 독립된 consume/sink lexical usage 분류 및 value-flow target까지 의미 보존
- Webview, protocol, VS Code API에 의존하지 않는 domain model

#### `analyzer/functionLogic/valueChanges`

- variable/property 초기화, 대입, 증감, 삭제와 loop binding의 exact evidence 추출
- common in-place method 이름을 이용한 receiver-mutation 후보 추출
- receiver method 의미는 항상 inferred로 유지하고 static type 형태의 receiver는 제외
- 언어별 AST/Lezer adapter와 공유하는 target/operation/confidence 계약
- block 내부 중복 annotation 제거, source 순서와 전체 target/operator/value text 보존

#### `analyzer/functionLogic/dataFlow`

- language-neutral binding/access/definition-to-use public contract
- TypeScript/JavaScript AST와 Python/Java Lezer language adapter에서 lexical fact 추출
- entry/declaration range를 가장 구체적인 visible Function Logic block에 mapping
- CFG predecessor queue, best-depth/visited guard, definition kill semantics를 이용한 bounded
  reaching-definition projection
- branch merge, loop-carried definition, duplicate edge, depth/flow limit을 recursion 없이 처리
- shadowed/ambiguous source name, runtime alias/value/property/interprocedural flow는 추측하지 않음

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

- `moduleFlow/list`, `moduleFlow/detail`, `moduleFlow/expand`, `moduleFlow/functionLogic`,
  `moduleFlow/openSource` request
- initial scene, detail, module expansion delta, correlated function-logic, failure response의 JSON-only 계약
- list 80 module/160 edge, detail 40 relation/5 evidence, module expand 및 function logic 각각
  48 node(or block)/96 edge 상한
- snapshot-local module/edge/function/module-evidence/function-statement-evidence/source opaque identity
- `graphVersion`과 browser `requestId`를 이용한 stale/late response guard
- raw path/range와 analyzer ID를 request로 받지 않는 runtime validation

#### `protocol/functionVisualizer`

- 전용 editor tab graph snapshot version
- analyzer ID를 노출하지 않는 root function source token과 label
- 새 root를 열 때 이전 browser history를 무효화하는 session contract

#### `webview/codeFlow`

- start mode와 검색
- flow ribbon 렌더링
- Function Visualizer와 공유하는 positioned graph node, SVG edge/label, Inspector drawer 렌더링
- confidence/unknown 표시
- source action
- 브라우저 상태와 late response rejection
- concrete 함수 선택을 전용 Function Visualizer tab으로 전달

#### `webview/codeFlow/inspector`

- graph viewport를 덮지 않는 right-side grid column과 반응형 below-graph row
- graph와 drawer의 bounded fixed height 및 drawer body의 독립 vertical scroll
- selected block evidence, value binding selector, signature, reading guide, direct callee surface 구성
- 모든 새 session의 discoverable 기본 open과 root/session별 사용자 open-state 유지,
  relayout-safe DOM 재생성
- keyboard toggle/close, Escape dismissal, `aria-expanded`/`aria-hidden`, closed-state `inert`
- analyzer, protocol, VS Code API에 의존하지 않는 browser-only public composition surface

#### `webview/codeFlow/valuePreview`

- parameter/local/constant 및 user-added `CUSTOM` variable용 상시 표시 bounded
  `Name`/`Scenario input` editor
- Inspector의 첫 section으로 배치하고 intrinsic row height를 보존하며, tracked/manual row 목록만
  내부 scroll시켜 선택 block evidence의 크기와 무관하게 editor를 보이게 하는 layout contract
- analyzer binding이 없어도 lexical identifier와 초기값을 직접 추가하고, 이후 동일 이름의
  단일 analyzer binding이 나타나면 session value를 실제 binding으로 승격하는 fallback contract
- root/session별 입력 annotation과 graph/selection access label 동기화
- `Name` button과 공용 value-flow selection callback을 통한 label/node/edge highlight 동기화
- JSON/scalar input과 safe expression grammar를 분리한 browser-source 내부 모듈 및 이를 조합하는
  public Scenario evaluator surface
- token/operator/value stack 기반 arithmetic/comparison/boolean/nested ternary 계산과 own-data member read
- 반복형 CFG worklist, immutable binding state, merge lattice, cycle/safety bound를 사용한 branch-aware 전파
- graph rank 순서의 bounded `DEFINED`/`CALCULATED`/`UPDATED`/`CONSUME`/`SINK` progression
- call/constructor/getter/source mutation/Host message/branch 자동 선택이 없는 browser-only 경계

#### `webview/codeFlow/typography`

- VS Code UI/editor font family와 font size에서 파생되는 Function Logic typography token
- sidebar 공유 graph와 전용 Function Visualizer가 사용하는 단일 public style surface

#### `webview/codeFlow/viewport`

- DOM과 독립된 scale/pan clamp, default/Center/Fit, focal zoom, resize-preservation geometry
- background/middle pointer drag, two-axis trackpad pan, Ctrl/Cmd-wheel zoom browser controller
- 1%~300% zoom과 ±10,000,000px numeric pan guard를 사용하는 단일 session transform
- live percentage, `Center`, `Fit`, keyboard shortcut, `aria-keyshortcuts` control surface
- Inspector resize의 world center와 child-function relayout의 selected callsite screen anchor 보존
- analyzer/application/protocol/VS Code API에 의존하지 않는 browser-only public boundary

#### `webview/moduleVisualizer`

- 재사용 가능한 전용 Module Flow WebviewPanel lifecycle
- panel snapshot마다 독립적인 graph delivery, source token, module evidence token 및 function-statement
  evidence token registry
- 기본 Execution lens와 Dependency/All boundaries, external/inferred filter
- bounded delta를 기존 scene에 merge하는 same-canvas child/boundary-function expansion
- 발급된 function card만 해석하는 Host-side Function Logic delivery와 browser-local scene adapter
- function card에서 entry block으로 이어지는 attachment edge, control-flow edge 의미, block-local
  value change/access detail
- merged scene node/edge budget과 oldest-expansion eviction을 담당하는 bounded expansion store
- function-logic child를 수용할 때 그 anchor를 소유한 parent expansion을 eviction에서 보호하고,
  parent collapse/eviction 뒤 orphan child를 반복적으로 정리
- variable-size box와 생략 없는 text, SCC cycle group, orthogonal routed edge 및
  교차점 line-jump/direction cue 렌더링
- relayout 전 선택 module/function anchor capture와 복원, 새 node/edge만 적용하는 bounded stagger 및
  reduced-motion-aware animation
- viewport transform, selection/loading patch, scene rebuild를 서로 다른 invalidation tier로 분리하고
  하나의 animation-frame scheduler에서 병합
- scene wrapper 하나에 centered translate/scale을 적용하며 zoom, pan, selection, loading, resize는
  SCC/layout 계산과 graph DOM 재생성을 호출하지 않음
- module/edge/cycle identity별 keyed DOM registry와 bounded structural layout LRU를 사용해
  expansion/collapse에서도 retained element와 keyboard focus를 보존
- hidden panel browser context를 해제하고 active Host projection으로 rehydrate하는 lifecycle
- 선택 module/edge의 bounded detail/evidence rail과 Host-authorized source action
- function/logic-block detail rail의 명시적인 definition/exact-statement source action
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
- embedded code는 candidate당 decoded text 24,000자, literal-only 조각 64개, 함수당 region
  16개와 동일한 maxLogicBlocks를 적용하고 callable scope queue를 반복 처리
- lexical value flow predecessor traversal에는 binding별 best-depth/visited guard와 function block
  수 기반 최대 depth를 적용
- cycle과 converging branch를 finite하게 처리
- unresolved와 external target을 concrete node와 구분
- initial payload와 search result에 hard budget 적용
- Function Logic direct callee는 eager traversal하지 않고 최대 24개 unique target만 투영
- 하위 함수 진입은 한 단계씩 직렬 처리하고 graph attachment는 최대 depth 6, 총 32개로 제한
- attached ancestor의 source token은 visited guard로 재사용하고 별도 진입 history의 token은
  breadcrumb에서 재사용
- Module Flow initial/detail/module-expansion/function-logic query에 각각 독립된 hard budget 적용
- Module Flow SCC와 condensation traversal은 명시적 stack/queue와 visited set으로 계산
- module expansion은 arbitrary recursive subtree를 요청하지 않고 child module 또는 boundary function
  한 logical layer만 반환
- function-logic expansion은 현재 scene에 발급된 function identity만 허용하고 한 번에 한 함수의
  bounded source-backed block/edge만 반환

## 9. Protocol 원칙

- 모든 Webview request는 runtime validation을 통과해야 함
- graph snapshot version이 일치하지 않는 request/response는 무시
- 동일 query의 late response를 막기 위한 browser request ID 사용
- analyzer node ID와 absolute path는 tokenized surface에 노출하지 않음
- source token과 flow ID는 snapshot-local opaque identity
- statement evidence token도 snapshot-local opaque identity이며 raw path/range를 request로
  받지 않음
- lexical binding과 definition-to-use edge도 snapshot-local opaque identity이며 analyzer/parser
  binding key를 payload에 노출하지 않음
- Function Visualizer의 새 root마다 새 snapshot version을 발급해 late child response를 거부
- Module Flow의 module/edge/function/module-evidence/function-statement-evidence identity도 panel
  snapshot-local opaque token이며
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
- lexical value flow는 함수당 최대 80개 unambiguous binding, 700 access fact,
  900 definition-to-use relation을 유지하고 추가 fact/relation은 gap count로 보고
- graph node의 lexical access row는 최대 8개만 렌더링하고 정확한 추가 row 수와 전체 retained
  binding selector를 별도로 제공
- scenario value editor는 최대 120 binding/값당 240자, 선택 progression은 최대 80 access step으로 제한
- function logic의 direct concrete callee는 함수당 최대 24개이며 사용자 action 때만 분석
- Function Visualizer attached child는 최대 depth 6, 총 32개이며 한 번에 하나씩 Host에 요청
- compound function graph layout은 합쳐진 block/edge를 한 finite canvas에 배치하고
  edge별 port/rank track을 예약
- function search는 host-side index와 cursor/request identity 사용
- graph snapshot 동안 semantic-flow, function architecture, function index를 재사용
- project module index는 graph snapshot당 한 번 계산하고 전체 index는 Host에 유지
- Module Flow initial scene은 최대 80 module/160 edge만 전송
- Module Flow detail은 최대 40 relation/5 evidence, 한 expansion delta는 최대 48 node/96 edge로 제한
- Module Flow function-logic request도 최대 48 block/96 edge이며 source는 Host에서 요청 시 한 번만
  읽고 기존 language analyzer와 opaque Function Logic projector를 재사용
- 여러 expansion을 합친 Module Flow browser scene은 최대 500 node/1,000 edge이며, 새 branch를
  유지하기 위해 가장 오래된 expansion부터 반복적으로 해제한다. 단, function-logic branch는
  자신을 소유한 boundary-function expansion을 밀어내지 못하며 둘을 합친 크기가 예산을 넘으면
  child 요청 자체를 거부한다.
- Module Flow browser는 선택 module 하나의 boundary-function/Function Logic branch만 유지하고,
  focus가 바뀌면 이전 module 소유 branch와 해당 pending request correlation을 반복 기반으로 제거
- Module Flow scene layout은 structural payload가 바뀔 때만 계산하며 최근 base/expansion 조합은
  snapshot-local 2-entry LRU로 재사용. cache key는 전체 payload JSON 복사본이 아니라 snapshot,
  base request, focused module, expansion identity로 구성하며 zoom/scroll/selection/loading/entry
  state는 넣지 않음
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
- Module Flow의 domain module/edge/function ID와 module/function-statement evidence path/range는
  panel-local Host registry에만 보존하고 Webview에는 opaque token만 전달
- Scenario input text와 계산 state는 browser session 안에만 두고 Host message/persistence 대상에서 제외;
  JSON/scalar parse와 제한된 expression evaluation은 Webview 내부에서만 수행하며 dynamic code 실행 금지
- export는 사용자가 선택한 위치에만 생성
- 브라우저 로그에 source content를 포함하지 않음

## 12. 접근성

- 모든 flow action은 키보드로 실행 가능
- stage와 confidence는 색상만으로 전달하지 않음
- value target kind와 exact/inferred 상태를 텍스트 및 solid/dashed border로 함께 전달
- lexical binding kind/access를 `PARAM`/`LOCAL`/`CONST`와 `DEFINE`/`WRITE`/
  `CONSUME`/`SINK` 텍스트로 전달하고 consume/sink line pattern, selector keyboard button,
  `aria-pressed`, Scenario calculation step label을 함께 제공
- tree/ribbon depth와 선택 상태에 ARIA 정보 제공
- focus 이동이 source open과 flow expansion 사이에서 예측 가능해야 함
- Module Flow의 relation lens, module/edge/function selection, same-canvas expansion 및 source action을
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
- TypeScript/JavaScript/Python/Java binding 종류와 access, branch merge의 multiple reaching
  definition, consume/sink 분류와 target projection, loop cycle/duplicate edge/depth limit,
  shadowed-name omission 검증
- concise JSX `.map` callback parameter의 inferred loop definition과 render-use flow 검증
- embedded fixture로 ordinary/dynamic string 오탐 방지, literal concatenation, direct eval,
  timer, Function constructor, stored/tagged program, 다중·nested callable CFG, virtual callsite,
  lexical value flow, block/region limit과 non-execution Scenario 경계 검증
- JSX element array의 element별 render/drill target, collection consumer, direct indexed/local
  `COMPONENT` role 전파와 return까지의 definition-to-use flow 검증
- Python functional-chain fixture로 constructor/variable receiver의 실행 순서, 단계별 drill target,
  중복 method owner 판별, subscript-key call의 chain 오탐 방지를 함께 검증
- F#/OCaml/Elixir fixture로 pipe stage 순서, first/final argument semantics, module owner drill target,
  문자열/comment 오탐과 독립 pipeline 분리를 검증
- function match failure, unsupported language, block limit
- manifest/framework/source-area module ownership, nested package, external boundary
- cross-module relation pair aggregation과 confidence/evidence/omitted count
- iterative SCC, cycle group, deterministic condensation rank, obstacle-safe orthogonal route
- endpoint/self-crossing을 제외한 edge bridge cluster, 곡선 path, 양방향 local direction cue

### 13.2 Application/Protocol

- catalog/detail hard budget
- opaque flow/source identity
- opaque statement evidence identity와 snapshot invalidation
- analyzer binding/value-flow identity의 opaque projection과 block endpoint remapping
- absolute path redaction
- malformed request rejection
- stale graph version rejection
- late search response rejection
- Module Flow list 80/160, detail 40/5, expand 48/96 budget clamp와 exact omitted count
- Module Flow function-logic 48/96 clamp, issued function-card authorization, statement evidence token
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
- graph node와 Inspector drawer의 VAR/FIELD/RECEIVER value-change row 렌더링
- full-width/76vh graph viewport와 signature/guide/value preview/value selector/callee/selection의 drawer 내부 배치
- free pointer/trackpad pan, cursor focal zoom, 1%~300% clamp, Center/Fit/keyboard action,
  grid transform과 Host message 부재 검증
- desktop adjacent column과 narrow below-graph row에서 Inspector가 graph를 덮지 않는지,
  bounded fixed height와 drawer 내부 독립 scroll을 유지하는지 검증
- node selection auto-open, toggle/close/Escape, ARIA/inert, child relayout open-state 유지 검증
- VS Code UI/editor font variable 연동과 고정 px font-size 회귀 검증
- preview input/clear/relayout 유지, `Name` click의 label/node/edge 선택 동기화,
  `DEFINED`/`CONSUME`/`SINK`/write-unknown progression, branch dim, 240자/120행/80-step bound,
  Host message/평가/branch 선택 부재 검증
- PARAM/LOCAL/CONST selector, bounded access row, 선택 binding SVG overlay, branch-choice dimming,
  attached function scope별 binding/value-flow identity 격리 검증
- 180자를 넘는 statement, 긴 value/target, 긴 child-function/resume label도 ellipsis 없이
  렌더링하고 내용 기반 node height가 증가하는지 검증
- root/nested/deep block이 각각 depth tint class를 받고 최대 단계에서 안정적으로 clamp되는지 검증
- nested compound geometry 포함 관계와 continuation 제외, 최외곽-only 초기 projection,
  nested owner click 승격, parent/outermost 복귀, relayout focus 유지, cycle guard,
  attached scope별 parent identity 격리, pointer-transparent group/edge/node layer 순서를 검증
- JSX intrinsic/custom render block, prop call, nested conditional branch, event boundary,
  first-class component collection/local flow, inferred `.map` 반복, callback scope 격리,
  memo/forwardRef binding 분석 검증
- JSX named handler와 listener/property registration의 event relation, registration 이후
  continuation 보존, handler no-return attachment 검증
- child의 loading/loaded 재렌더링 동안 callsite의 viewport 상대 위치와 free-pan transform이
  유지되고 새 child block/edge에만 entry animation class가 적용되는지 검증
- branch lane, loop back edge, long exit channel 렌더링
- loop 종료 후 statement가 loop body rank와 back-edge ring 바깥에 배치되는지 검증
- exact statement evidence action
- source action
- cache clear와 graph replacement reset
- keyboard와 accessible labels
- Module Flow 전용 tab, Execution/Dependency/All boundaries lens와 external/inferred filter
- 가변 크기 module/function box의 full label, SCC enclosure, box-crossing 없는 orthogonal edge와
  교차점 bridge/direction cue
- module click의 same-canvas boundary-function merge, clicked-anchor scroll 복원, entry animation
- function click의 same-canvas statement graph merge, function-to-entry connector, function-anchor 복원,
  staggered new-block/edge animation, 재클릭 collapse
- parent boundary-function branch가 function-logic child의 eviction으로 제거되지 않고 parent 제거 시
  orphan function graph도 함께 정리되는지 검증
- reduced-motion 환경의 animation 생략
- bounded module/edge/function-block detail과 definition/exact-statement source action
- graphVersion/requestId가 다른 list/detail/expand/function-logic response 무시

### 13.4 Architecture

- initial publish가 Guided Tour/Reading Plan을 계산하거나 전송하지 않는지 확인
- Webview가 raw Project Graph 내부를 직접 해석하지 않는지 확인
- codeFlow public surface 밖의 deep import 방지
- traversal 재귀 호출 금지
- analyzer/functionLogic과 protocol/Webview 사이의 의존성 역전 확인
- Module Flow 전체 index가 Host에 남고 Webview payload가 hard budget을 지키는지 확인
- Module Flow Function Logic delivery가 기존 analyzer/application projector를 재사용하고 browser scene
  adapter가 Host analyzer identity를 추가로 노출하지 않는지 확인
- Module Flow component-focus selector가 child-module navigation을 보존하면서 선택되지 않은
  module의 function/statement branch와 late response authority를 제거하는지 확인
- Module Flow directional-lineage filter가 cycle, duplicate edge, depth limit, unresolved endpoint에서
  반복 기반으로 ancestor/descendant만 유지하고 sibling branch를 제외하는지 확인
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
- true/false/case edge 및 detail transfer 선택, shared merge 이후 continuation projection
- TypeScript/JavaScript/Python/Java parameter/local/constant access와 bounded iterative
  reaching-definition overlay
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
- optional-chain 및 안전한 nested-expression evaluation-order control flow
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
- 수직 edge 교차점의 곡선 bridge와 진행 방향 표시
- 선택 module의 child/boundary function을 현재 canvas에 lazy expansion
- 선택 function card에서 statement-level Function Logic을 현재 canvas에 lazy expansion
- module focus 변경 시 이전 module의 function/statement branch를 해제하고 선택 module component만 유지
- 선택 module의 directional ancestor/descendant만 표시하고 빈 canvas/`Escape` 해제 시 초기 scene 복원
- clicked-module/function scroll anchor 유지와 reduced-motion-aware staggered entry animation
- module/edge/function-block detail과 definition/exact-statement source action
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
- 다른 module click 뒤 이전 module의 function/statement component가 canvas에 남지 않음
- module focus 중 무관/sibling node가 보이지 않고 focus 해제 뒤 초기 node가 모두 복원됨
- Module Flow function에서 한 번의 action으로 statement graph가 같은 canvas에 이어 붙고 선택
  function anchor의 viewport 위치가 유지됨
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
  single-module directional-lineage focus와 초기 scene 복원, function-card anchored statement flow,
  bounded detail/evidence 및 교차 edge의 bridge/direction cue를 제공함
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
