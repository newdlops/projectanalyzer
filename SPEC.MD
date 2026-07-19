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

### 4.5 Function Logic

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
사용한다. TypeScript/JavaScript는 compiler AST, Python/Java는 Lezer syntax tree를 근거로
삼는다. 따라서 `if (isReady())`, `while (hasNext())`, `switch (selectMode())`,
`match select_mode()`의 호출도 각각 condition/loop/switch block에 연결한다. `this.method()`와
`self.method()`는 현재 lexical owner의 concrete callable을 우선한다. 저수준 graph가
multiline 함수 body의 call edge를 놓친 경우에는 동일 이름의 concrete target이 하나뿐일
때만 `inferred`로 보완한다. 같은 위치에 explicit unresolved edge가 있거나 후보가 둘 이상이면
concrete target으로 승격하지 않는다.

### 4.6 Evidence

Evidence는 분석 결과의 근거다. definition, callsite, framework mapping, import binding,
runtime observation을 서로 다른 종류로 보존한다.

### 4.7 Coverage Gap

분석기가 경로를 완성하지 못한 이유다. ambiguous mapping, unresolved target, depth
limit, step limit을 정상적인 제품 상태로 표현한다.

## 5. 의미론과 정확성 규칙

### 5.1 정적 흐름은 실행 기록이 아니다

정적 `A -> B -> C`는 도달 가능한 calls 관계이며 실제 시간 순서를 의미하지 않는다.
UI는 정적 flow에 실행 시각, 호출 횟수, return 순서를 만들지 않는다.

함수 내부 `true`, `false`, `repeat`, `return` edge도 syntax가 허용하는 가능한 경로다.
조건 값, 반복 횟수, callee 내부 exception, callback 실행 시점이 관찰되었다고 주장하지
않는다.

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
  |- Reading frame
  |- Inter-function flow steps
  |- Inspect logic action
  `- Evidence and unknowns

Editor Tab: Function Visualizer
  |- Start / Choose / Do / Finish reading frame
  |- Root and child functions in one compound control-flow graph
  |- Selected graph-node evidence
  |- Call-block anchored child blocks and call connectors
  |- Nested branch collapse and cycle boundary
  |- Parent/back and function breadcrumbs
  |- Evidence and unknowns
  `- Source actions
```

Project Map, Reading Plan, Guided Tour, Analysis Dashboard는 기본 navigation에 두지
않는다.

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

TypeScript/JavaScript/Python/Java 편집기에서는 함수, 메서드, 생성자, 지원되는 lambda
내부에 커서를 두고 `Visualize Current Function` context menu를 실행할 수 있다. 이 명령은
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
  `try/except/else/finally`, `with`, call/mutation/return/raise/break/continue
- Java: `if/else`, while/for/enhanced-for/do, switch, `try/catch/finally`,
  try-with-resources, synchronized/labeled region, call/new/mutation/exit

네 언어 모두 expression-level boolean short-circuit와 callee exception을 별도 block으로
확장하지 않는다. Python의 monkey patching/decorator/descriptor와 Java의 virtual dispatch,
reflection/framework interception/thread scheduling은 runtime unknown으로 남긴다.

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
- callsite와 기존 caller continuation 사이에 child flow와 resume gateway를 삽입하는 연결 구조
- 색과 dash가 구분되는 call/call-return edge와 parent-aware child lane
- 같은 call block 재클릭 시 그 지점의 descendant expansion 전체를 제거하는 collapse action
- 최대 6단계, 총 32개 attached function의 iterative lazy expansion
- ancestor 함수를 다시 호출할 때 재분석하지 않고 cycle 상태를 표시하는 visited guard
- 별도 함수로 전환할 수 있는 parent back action과 함수 breadcrumb
- 함수당 최대 24개 direct callee와 omitted count
- parser limitation과 runtime unknown

### 6.4 Evidence Detail

step 또는 edge를 선택하면 다음을 보여준다.

- 왜 이 step이 flow에 포함되었는가
- definition인지 callsite인지
- edge confidence와 resolution
- architecture/layer evidence가 있다면 그 근거
- 분석이 확인하지 못한 항목

### 6.5 Source Integration

- concrete step: 정확한 definition 열기
- function logic block: 정확한 statement 또는 condition expression 열기
- unresolved/external step: target definition으로 위장하지 않고 callsite 위치 표시
- active graph가 바뀌면 이전 source token 무효화
- active graph가 바뀌면 이전 statement evidence token도 무효화
- source open은 이해 완료나 학습 완료로 기록하지 않음

### 6.6 Progressive Disclosure

- 최초에는 핵심 flow와 branch summary만 표시
- 한 번에 보여주는 concrete step 목표는 6~12개
- 사용자가 선택한 branch만 추가 확장
- 외부 라이브러리와 cross-cutting noise는 기본 접힘
- 전체 structure와 inventory는 검색 또는 명시적 context action 뒤에만 로드

## 7. MVP 범위

### 7.1 포함

- workspace/current-file 로컬 분석
- TypeScript, JavaScript, Python, Java callable extraction
- HTTP/GraphQL entrypoint catalog
- entrypoint-centered bounded downstream flow
- 임의 concrete function 검색
- editor context menu에서 현재 TypeScript/JavaScript/Python/Java callable 직접 시각화
- TypeScript/JavaScript/Python/Java 함수 내부 statement-level control flow
- condition, branch, loop, switch, try, mutation, call, return/throw block
- 함수 내부 exact statement evidence navigation
- 함수 내부 effect candidate의 inferred confidence
- 함수가 포함된 알려진 entrypoint 표시
- confidence, unresolved, external, traversal gap 표시
- source navigation
- snapshot identity와 stale response rejection
- VS Code theme, keyboard, high contrast 지원

### 7.2 제외

- 전체 프로젝트 force-directed graph를 기본 화면으로 제공
- variable-level data-flow slicing
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

#### `application/codeFlow`

- 사용자 질문을 domain query로 변환
- catalog와 detail payload projection
- source display와 protocol budget 적용
- stage/label을 evidence보다 강하게 표현하지 않음
- function-local domain block을 opaque protocol identity와 safe source display로 변환
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
- 언어 중립 structured-control contract로 branch container와 transfer를 구성
- 명시적 stack/container 기반 structured control-flow edge 구성
- source range, exact/inferred confidence, parser/runtime gap 보존
- Webview, protocol, VS Code API에 의존하지 않는 domain model

#### `analyzer/core/lezerSource`

- Python/Java graph analyzer와 Function Logic adapter가 함께 쓰는 immutable parser snapshot
- UTF-16 line/range 변환과 iterative child/descendant/error traversal
- 언어별 syntax module이 `functionLogic` 내부 구현에 역의존하지 않게 하는 공통 하위 경계

#### `analyzer/languages/python`, `analyzer/languages/java`

- Function Logic과 같은 Lezer source snapshot으로 callable/type symbol 추출
- lexical owner, same-file, unique workspace evidence를 순서대로 적용하는 보수적 call resolution
- Python `self` member와 constructor, Java owner/qualified call과 constructor를 우선 해석
- Java overload는 arity가 일치할 때만 후보로 유지하며 type/virtual dispatch는 추측하지 않음

#### `analyzer/rust`

- Rust engine의 primary graph evidence 유지
- Rust가 file node만 제공하는 Java 파일에 한해 in-process Java symbol/call graph를 병합
- supplement 대상 언어의 양 끝점이 모두 허용된 edge만 추가하여 언어 경계를 보존

#### `protocol/codeFlow`

- catalog request/response
- entrypoint selection
- source selection
- statement evidence selection
- flow detail과 failure
- runtime validation 가능한 JSON 계약

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

## 9. Protocol 원칙

- 모든 Webview request는 runtime validation을 통과해야 함
- graph snapshot version이 일치하지 않는 request/response는 무시
- 동일 query의 late response를 막기 위한 browser request ID 사용
- analyzer node ID와 absolute path는 tokenized surface에 노출하지 않음
- source token과 flow ID는 snapshot-local opaque identity
- statement evidence token도 snapshot-local opaque identity이며 raw path/range를 request로
  받지 않음
- Function Visualizer의 새 root마다 새 snapshot version을 발급해 late child response를 거부
- payload는 Map, Set, class instance 없이 JSON 직렬화 가능해야 함

## 10. 성능

- graph load 시 전체 graph는 Extension Host에 유지하고 Webview에는 shell과 bounded
  catalog만 전송
- catalog 기본 노출 수는 최대 24개, 검색 응답은 최대 50개
- flow detail은 기본 depth 3, 최대 30 step
- function logic은 기본 120, 최대 300 statement block
- function logic의 direct concrete callee는 함수당 최대 24개이며 사용자 action 때만 분석
- Function Visualizer attached child는 최대 depth 6, 총 32개이며 한 번에 하나씩 Host에 요청
- compound function graph layout은 합쳐진 block/edge를 한 finite canvas에 배치하고
  edge별 port/rank track을 예약
- function search는 host-side index와 cursor/request identity 사용
- graph snapshot 동안 semantic-flow, function architecture, function index를 재사용
- function logic은 선택 시 현재 editor document를 읽어 unsaved source도 반영
- Python/Java Lezer parse snapshot은 file content hash가 같을 때 재사용
- Python/Java workspace callable index는 대상 file path/content hash 집합이 바뀔 때만 재구성
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
- export는 사용자가 선택한 위치에만 생성
- 브라우저 로그에 source content를 포함하지 않음

## 12. 접근성

- 모든 flow action은 키보드로 실행 가능
- stage와 confidence는 색상만으로 전달하지 않음
- tree/ribbon depth와 선택 상태에 ARIA 정보 제공
- focus 이동이 source open과 flow expansion 사이에서 예측 가능해야 함
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
- mutation exact classification과 effect inferred classification
- function match failure, unsupported language, block limit

### 13.2 Application/Protocol

- catalog/detail hard budget
- opaque flow/source identity
- opaque statement evidence identity와 snapshot invalidation
- absolute path redaction
- malformed request rejection
- stale graph version rejection
- late search response rejection

### 13.3 Webview

- 분석 전 empty state
- entrypoint/function start mode 전환
- catalog 검색과 선택
- flow detail, gaps, confidence 렌더링
- function signature, graph nodes, labeled edges, node selection 렌더링
- branch lane, loop back edge, long exit channel 렌더링
- loop 종료 후 statement가 loop body rank와 back-edge ring 바깥에 배치되는지 검증
- exact statement evidence action
- source action
- cache clear와 graph replacement reset
- keyboard와 accessible labels

### 13.4 Architecture

- initial publish가 Guided Tour/Reading Plan을 계산하거나 전송하지 않는지 확인
- Webview가 raw Project Graph 내부를 직접 해석하지 않는지 확인
- codeFlow public surface 밖의 deep import 방지
- traversal 재귀 호출 금지
- analyzer/functionLogic과 protocol/Webview 사이의 의존성 역전 확인

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

- TypeScript/JavaScript compiler AST와 Python/Java Lezer current-source parsing
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
- TypeScript/JavaScript/Python/Java 선택 함수가 statement-level logic block과 가능한 transfer로
  표시됨
- flow step에 stage, source, confidence, resolution이 표시됨
- source token으로 concrete definition을 열 수 있음
- evidence token으로 exact function statement를 열 수 있음
- 함수 검색, entrypoint step, editor context menu가 동일한 전용 Function Visualizer tab을
  열 수 있음
- direct callee를 lazy하게 현재 graph canvas에 붙이고 cycle에서는 ancestor 또는 기존
  breadcrumb를 재사용함
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
