# Project Learning Journey and Function Relationship Explorer Specification

## 1. 목적

Project Analyzer의 중심은 분석 결과를 나열하는 대시보드가 아니라, 사용자가 낯선 프로젝트를
근거를 따라 단계적으로 이해하도록 돕는 **evidence-based Project Learning Journey**이다.
Function Relationship Explorer는 이 여정에서 함수, 메서드, 생성자, 프레임워크 핸들러 간
호출 관계를 조사하고 source에서 검증하기 위한 핵심 도구이다.

기존의 단순 `file -> function -> callers/callees` 나열은 함수 수가 늘어날수록 관계를 설명하지
못하고 노이즈가 된다. 이 스펙의 목표는 모든 함수 정보를 보존하면서도 사용자가 왜 이
프로젝트가 존재하는지, 요청이 어디로 들어와 무엇을 거쳐 상태와 외부 시스템에 닿는지,
어떻게 안전하게 변경하고 실패를 다루는지를 누적 학습하게 하는 것이다.

핵심 원칙은 다음과 같다.

- 학습 순서는 큰 맥락에서 concrete source와 실행 증명으로 좁혀 간다.
- 자동 분석이 아는 사실, 추론한 내용, 사람에게 확인한 맥락, 직접 실행해 증명한 결과를 섞지 않는다.
- 완성형 여정은 근거가 없으면 설명을 만들지 않고 `Unknown`과 확인할 질문을 보여준다.
- 분석 결과에서 함수와 호출 관계를 임의로 누락하지 않는다.
- 기본 UI는 모든 함수를 펼쳐 보여주지 않는다.
- 숨긴 정보는 삭제가 아니라 요약, 접기, 필터, lazy loading, 검색, 전체 인벤토리로 접근 가능해야 한다.
- 함수 관계는 단순 목록이 아니라 entrypoint, framework unit, fan-in/fan-out, side effect, 외부 의존성, unresolved 호출을 기준으로 해석되어야 한다.

### 1.1 Project Learning Journey

목표 로드맵은 다음 순서로 구성한다. 완성형 여정에서는 각 단계가 앞 단계의 어휘와 증거를
재사용하지만, 현재 vertical slice는 순서가 있는 syllabus만 보여주며 선행 조건이나 단계별
진행을 강제하지 않는다.

| 단계 | 사용자가 답할 질문 |
| --- | --- |
| Context | 이 프로젝트는 왜 존재하고, 범위와 주요 용어는 무엇인가? |
| Architecture | 시스템 경계, 실행 진입점, 주요 구성 요소는 어떻게 나뉘는가? |
| Critical Flows | 대표 요청이나 작업 하나가 어떤 source 경로를 따라 실행되는가? |
| Data & Dependencies | 어디에서 상태를 읽고 쓰며, 어떤 내부·외부 시스템에 의존하는가? |
| Quality & Change | 기대 동작은 어디에서 검증되고, 변경 영향은 어떻게 확인하는가? |
| Operations & Failure | 배포된 시스템을 어떻게 관찰하고, 실패를 진단·복구하는가? |
| Hands-on Proof | 작은 실제 작업을 수행해 이해를 어떤 결과물로 증명할 수 있는가? |
| Continuous Refresh | 코드와 운영 지식이 바뀔 때 학습 근거를 어떻게 다시 확인하는가? |

목표 제품에서 모든 단계는 같은 UX 계약을 따른다. 현재는 다음 orientation action card에만
이 여섯 필드를 읽기 전용으로 적용한다.

```text
Why -> Learn -> Inspect evidence -> Do -> Explain back -> Exit criteria
```

- **Why**: 지금 이 단계를 배우는 이유와 다음 단계에 미치는 영향을 설명한다.
- **Learn**: 알아야 할 개념, 용어, 시스템 관계를 작은 단위로 제시한다.
- **Inspect evidence**: source, 설정, 테스트, 문서, 분석 근거로 설명을 추적한다.
- **Do**: 탐색, 실행, 디버깅, 작은 변경처럼 관찰 가능한 행동을 수행한다.
- **Explain back**: 사용자가 흐름과 판단 근거를 자신의 말로 설명하게 한다.
- **Exit criteria**: 다음 단계로 넘어가기 전에 확인할 답변이나 결과물을 명시한다.

상태는 단일 완료 점수가 아니라 근거의 출처와 검증 수준을 나타낸다.

| 상태 | 의미 |
| --- | --- |
| `Unknown` | 현재 분석과 사람의 확인 어디에도 충분한 근거가 없다. |
| `Discovered` | analyzer가 source나 설정에서 직접 발견한 사실이다. |
| `Inferred` | analyzer가 정적 관계와 규칙으로 추론했으며 추가 확인이 필요하다. |
| `Confirmed` | 사람이 코드 밖의 목적·맥락 또는 해석을 확인했다. 자동으로 부여하지 않는다. |
| `Demonstrated` | 사용자가 실행, 디버깅, 테스트, 작은 변경 결과로 이해를 증명했다. |

`Discovered`나 화면 방문을 `Confirmed` 또는 `Demonstrated`로 승격하지 않는다. 모든 단계를
보았다는 이유만으로 `mastered` 또는 `onboarding complete`라고 표시하지 않는다. 현재 UI는
각 roadmap stage에 허용할 evidence level과 필요한 evidence를 정적으로 안내할 뿐, 프로젝트별
상태를 자동 할당하거나 `Confirmed`/`Demonstrated`를 기록하지 않는다.

### 1.2 현재 Learning Journey vertical slice

현재 구현은 전체 8단계 로드맵을 안내하되, 다음 세 행동의 **visited progress**만 다룬다.

1. **Map project**: Project Map에서 scope detail을 연다.
2. **Trace one representative request**: source-backed representative path 하나를 펼친다.
3. **Verify in source**: concrete path step의 source-open action을 editor에 요청한다.

이 진행 표시는 사용자가 세 조사 행동을 방문했다는 뜻일 뿐, 내용을 이해했거나 학습 여정을
마쳤다는 판정이 아니다. 현재 UI는 `Why`, `Learn`, `Inspect evidence`, `Do`, `Explain back`,
exit criteria를 읽기 전용 학습 프레임으로 제시한다. 사용자의 답변을 수집·검토하거나 사람의
`Confirmed`, 실행 기반 `Demonstrated`를 기록하는 상호작용은 후속 vertical slice이다.

### 1.3 현재 Project-Specific Guided Tour POC

현재 POC는 사용자가 scope와 recommended path를 먼저 고르는 흐름을 기본 경험에서 제거하고, 실제
분석 근거로 선택한 프로젝트별 읽기 경로 하나를 단계적으로 안내한다. 1.2의 기존 visited progress와
scope-first Reading Plan은 삭제하지 않고 `Explore`의 보조 학습 자료로 남긴다.

- 분석 직후 현재 analyzed graph의 모든 application scope에서 primary path 하나만 자동 선택한다.
- shared rank는 complete handler-to-decision-to-boundary path를 partial path보다 먼저 선택한다.
- 기본 `Guide` surface에는 mission 하나, current stop 하나, primary source action 하나만 표시한다.
- 각 POC navigable stop은 exact function definition, `Why now`, source-reading `Look for`, 확인 질문,
  `Move on when`, evidence와 unknown을 제공한다.
- 기존 Project Map, recommended paths, Function Explorer, Structure, Analysis Details는 `Explore`에 보존한다.
- source-open 성공 acknowledgment 이후에만 source-opened 상태를 기록하고 이해·완료 점수로 승격하지 않는다.
- 근거가 없으면 합성 mission 대신 unavailable 이유를 제공하고, 구체적 target이 있을 때만 다음 조사
  행동 최대 하나를 제공한다.

이는 “scope 선택 전 개별 path를 전달하지 않는다”는 기존 Reading Plan 규칙의 bounded 예외다.
`graph/loaded`는 계속 고정 크기 shell이고, `project/guidedTourLoaded`는 primary mission 1개와
definition-backed stop 최대 5개를 초기 전달한다. 다른 path와 전체 inventory는 계속 lazy load한다.
현재 source-open correlation은 graph/mission/stop/token/request까지 검증한다. decorator/callsite의
임의 range, multi-anchor acknowledgment, related test 연결은 후속 release gate다. 상세 구현 상태와
남은 단계는 [`GuidedTourImplementationPlan.md`](./GuidedTourImplementationPlan.md)를 따른다.

## 2. 문제 정의

함수 호출 분석은 다음 두 요구가 충돌한다.

1. **완전성**
   - 프로젝트의 모든 function-like symbol이 분석 결과에 포함되어야 한다.
   - 모든 `calls` edge, unresolved call, inferred call, external call이 추적 가능해야 한다.
   - parser 실패, dynamic call, framework dispatch처럼 확정할 수 없는 영역도 diagnostics로 드러나야 한다.

2. **이해 가능성**
   - 수천 개 함수를 flat list로 보여주면 구조 파악에 도움이 되지 않는다.
   - caller/callee 직접 목록만 보여주면 기능 흐름, 진입점, 역할, 영향 범위를 파악하기 어렵다.
   - 기본 화면은 사용자가 먼저 볼 가치가 높은 흐름과 관계부터 보여줘야 한다.

따라서 Function Explorer는 **complete graph inventory**와 **progressive semantic view**를 분리한다.

## 3. 범위

### 3.1 포함 대상

Function Explorer는 다음 function-like symbol을 대상으로 한다.

- top-level function
- class method
- constructor
- nested function
- arrow function assigned to a named variable
- function expression assigned to a named variable
- exported function
- default exported function
- framework handler
- route callback
- CLI command handler
- test function 또는 test case callback
- lifecycle hook
- async task handler
- event handler
- unresolved callable placeholder
- external callable placeholder

### 3.2 초기 지원 언어

- TypeScript
- JavaScript
- Python

### 3.3 초기 지원 프레임워크 맥락

- Django
- FastAPI
- Flask
- Express
- NestJS
- GraphQL (NestJS code-first, Strawberry)
- Next.js
- React
- pytest 또는 unittest
- Jest 또는 Vitest

프레임워크별 의미 분석은 계속 확장 가능해야 한다. Function Explorer는 framework detector가 제공하는 semantic unit과 결합하지만, framework 정보가 없더라도 raw call graph inventory는 반드시 제공해야 한다.

## 4. 핵심 설계 원칙

### 4.1 누락 금지

Function Explorer에서 “숨김”은 UI 표현 방식일 뿐, 데이터 삭제가 아니다.

다음 항목은 항상 추적 가능해야 한다.

- 분석된 모든 callable node
- callable node가 속한 파일
- callable node의 container
- callable node의 framework unit
- callable node의 direct callers
- callable node의 direct callees
- entrypoint에서 callable node까지의 알려진 경로
- callable node에서 leaf/external/unresolved call까지의 알려진 경로
- unresolved call
- inferred call
- external dependency call
- parser 실패로 분석하지 못한 파일
- analyzer가 의도적으로 제외한 파일과 제외 사유

기본 트리에서 보이지 않는 함수는 `All Functions`, search, filter, selected function inspector, export를 통해 반드시 찾을 수 있어야 한다.

### 4.2 기본 화면은 행동 중심

초기 렌더링에서 모든 함수를 나열하지 않는다.

기본 화면은 다음 순서로 보여준다.

1. `Guide | Explore` surface tab, Guide 기본 선택
2. 자동 선택된 Guided Tour mission 하나와 current definition stop 하나
3. current stop의 source-open primary action, acknowledgment 후 `Move on when`과 Next
4. Explore 안의 Project Reading Plan과 보조 Learning Journey disclosure
5. Explore Code Flows, Browse Structure, Analysis Details disclosure

Explore의 초기 Project Map에는 개별 함수, 파일, call edge, diagnostic, signal을 표시하지 않는다.
같은 rootPath의 NestJS/GraphQL과 HTTP/Query/Mutation/Subscription은 하나의 scope에
합친다. Reading Guide의 path는 transport별로 선택한 source-backed 대표 예시이지 핵심
함수나 비즈니스 중요도 판정이 아니다. 기존 Project Brief와 Analysis Signals는
Analysis Details를 연 뒤에만 렌더링한다.

### 4.3 관계 우선

함수는 이름순 목록보다 관계와 역할을 기준으로 탐색되어야 한다.

우선순위는 다음 정보를 기준으로 계산한다.

- entrypoint와의 거리
- framework semantic unit 여부
- fan-in count
- fan-out count
- downstream depth
- external dependency 호출 여부
- database/model/ORM 호출 여부
- network/file/process side effect 여부
- unresolved call 포함 여부
- current file 또는 selected symbol과의 관련성

### 4.4 Lazy Loading

트리 row는 필요할 때 계산한다.

- 닫힌 accordion의 row는 생성하지 않는다.
- 닫힌 tree branch의 child row는 생성하지 않는다.
- 장기적으로 expensive relation path는 사용자가 펼치거나 선택할 때 계산한다.
- full inventory는 별도 요청 시 chunk 단위로 로드한다.

현재 경량화는 닫힌 branch의 row/DOM 생성을 막고, 최초 graph publication에서는 scope summary
3개와 별도의 primary mission 1개/definition stop 최대 5개만 보낸다. scope 선택 시 area 최대 5개, representative path 최대 3개,
path당 step 최대 5개를 별도 요청한다. Function Index는 Explore Code Flows를 열기 전에는
생성하거나 전송하지 않는다. 최초 `graph/loaded`는 node/edge/path가 없는 고정 크기 shell만
전달한다. file import graph는 Browse Structure, overview fact/signal은 Analysis Details를
처음 열 때 각각 별도 요청한다. Extension Host는 graph snapshot별 semantic flow, Reading
Guide projector, overview와 function index core를 재사용한다. 그러나 analyzer scan과 전체
host-side graph는 graph load 시 생성한다. Function search에는 cursor page가 동작하지만,
현재의 lazy Structure payload와 일반 Function section row cap은 사용 가능한 cursor paging이
아니다. source streaming, relation path query, inventory의 실제 server-side chunk protocol은
Phase 5 범위로 남긴다.

### 4.5 Virtual List

DOM에는 현재 viewport 근처 row만 렌더링한다.

- row height는 고정값을 기본으로 한다.
- overscan을 둔다.
- scroll position은 accordion open/close와 graph refresh 이후 가능하면 유지한다.
- row data와 DOM node는 분리한다.

## 5. 데이터 모델

### 5.1 Function Node

기존 `SymbolNode`를 유지하되 Function Explorer에서는 다음 derived metadata를 계산한다.

```ts
type FunctionNodeView = {
  id: string;
  symbolId: string;
  kind: "function" | "method" | "constructor" | "handler" | "external" | "unresolved";
  name: string;
  qualifiedName: string;
  filePath: string;
  range: SourceRange;
  containerId?: string;
  frameworkUnitId?: string;
  entrypointIds: string[];
  role: FunctionRole;
  tags: FunctionTag[];
  metrics: FunctionMetrics;
  confidence: "exact" | "resolved" | "inferred" | "unresolved";
};
```

### 5.2 Function Role

```ts
type FunctionRole =
  | "entrypoint"
  | "routeHandler"
  | "controller"
  | "service"
  | "repository"
  | "modelOperation"
  | "serializer"
  | "schema"
  | "component"
  | "hook"
  | "eventHandler"
  | "cliCommand"
  | "test"
  | "utility"
  | "adapter"
  | "factory"
  | "lifecycle"
  | "external"
  | "unresolved"
  | "unknown";
```

역할은 정적 분석, framework unit, 파일 경로, naming convention, import target, call target metadata를 조합하여 추론한다.

역할 추론이 확정적이지 않으면 `confidence`를 낮추고 `tags`에 판단 근거를 보존한다.

### 5.3 Function Tag

```ts
type FunctionTag =
  | "async"
  | "exported"
  | "defaultExport"
  | "private"
  | "public"
  | "recursive"
  | "cycleMember"
  | "leaf"
  | "orchestrator"
  | "sharedUtility"
  | "sideEffect"
  | "database"
  | "network"
  | "filesystem"
  | "process"
  | "frameworkDispatch"
  | "dynamicCall"
  | "externalCall"
  | "unresolvedCall"
  | "testOnly";
```

### 5.4 Function Metrics

```ts
type FunctionMetrics = {
  directCallerCount: number;
  directCalleeCount: number;
  transitiveCallerCount?: number;
  transitiveCalleeCount?: number;
  entrypointDistance?: number;
  reachableEntrypointCount: number;
  unresolvedCallCount: number;
  externalCallCount: number;
  cycleSize?: number;
};
```

`directCallerCount`와 `directCalleeCount`는 call edge 개수가 아니라 서로 다른 caller와
callee identity 수이다. 같은 caller가 같은 callee를 여러 번 호출한 edge는 근거로
보존하지만 hotspot 영향 범위를 부풀리지 않는다. 원시 call-site 수가 필요한 화면은
relation의 edge identity를 별도로 집계한다.

Transitive metric은 큰 프로젝트에서 비용이 커질 수 있으므로 lazy 계산한다. 계산 결과는 graph version과 function id를 key로 캐싱한다.

### 5.5 Function Call Edge

기존 `GraphEdge(kind: "calls")`를 유지하되 Function Explorer는 다음 metadata를 해석한다.

```ts
type FunctionCallEdgeMetadata = {
  callName?: string;
  callExpression?: string;
  callType?:
    | "direct"
    | "method"
    | "constructor"
    | "callbackRegistration"
    | "frameworkDispatch"
    | "eventBinding"
    | "dynamic"
    | "external"
    | "unresolved";
  argumentCount?: number;
  receiverName?: string;
  importSource?: string;
  framework?: string;
  evidence?: string[];
};
```

Unresolved call은 삭제하지 않고 unresolved callable placeholder node로 연결한다.

External call은 external callable placeholder node로 연결한다. 단, 외부 라이브러리 내부로 더 확장하지 않는다.

## 6. 완전성 모델

### 6.1 Function Universe

분석 결과에는 `FunctionUniverse` 개념이 필요하다.

```ts
type FunctionUniverse = {
  graphVersion: string;
  callableNodeCount: number;
  callEdgeCount: number;
  externalCallableCount: number;
  unresolvedCallableCount: number;
  parserFailureCount: number;
  excludedFileCount: number;
  hiddenByDefaultViewCount: number;
};
```

`hiddenByDefaultViewCount`는 UI가 보여주지 않은 함수 수를 명시적으로 알려준다. 이 값은 누락이 아니라 collapsed/filtered 상태를 의미한다.

### 6.2 Coverage Diagnostics

Function Explorer는 항상 coverage summary를 제공한다.

필수 항목:

- analyzed source files
- skipped files
- parser failed files
- callable nodes discovered
- call edges discovered
- unresolved calls
- inferred calls
- external calls
- functions visible in current view
- functions hidden by collapsed branches
- functions hidden by active filters

사용자가 “왜 함수가 보이지 않는가”를 추적할 수 있어야 한다.

Project Reading Guide는 Learning Journey의 자동 분석 근거이며 다음 두 단계로 정보 예산을
강제한다. 이 projection만으로 Context나 Architecture 전체를 확인했다고 판정하지 않는다.

1. `ProjectReadingGuideIndex`
   - normalized rootPath scope 최대 3개
   - 같은 scope의 framework와 HTTP/GraphQL operation type count 통합
   - 전체 candidate/omitted scope 수 보존
   - 개별 symbol, call edge, reading path는 포함하지 않음
2. `ProjectScopeReadingGuide`
   - 사용자가 선택한 한 scope만 lazy projection
   - source area 최대 5개
   - area당 workspace-relative 대표 file label 최대 3개
   - 서로 다른 HTTP/Query/Mutation/Subscription surface의 representative path 최대 3개
   - path당 source step 최대 5개
   - omitted area/path/step 수 보존

POSIX, Windows drive, UNC path는 host OS와 무관한 lexical normalizer로 identity를 만든다.
`.`/`..`, slash, trailing separator, Windows case folding을 처리하고 file은 가장 구체적인
scope에 한 번만 귀속한다. source area는 folder 구조 근거이며 business module 또는
bounded context 판정이 아니다.

Analysis Details 안의 Project Brief는 다음 세 사실을 정확히 한 줄씩 전달한다.

- Scope & Stack: analyzed file/callable과 analyzer가 기록한 language/framework root
- Execution Surface: HTTP route, GraphQL root operation, mapped handler와 mapping gap
- Analysis Coverage: diagnostic, unresolved/inferred call, ambiguous/unmapped entrypoint,
  bounded traversal gap

Analysis Signals의 현재 범주는 `analysisCoverage`, `entrypointCoverage`,
`unresolvedExecution`이다. Domain radar는 최대 5개 item을 선택하고 전체 candidate 수와
omitted 수를 보존하며, Webview payload는
최대 3개만 표시한다. 표시 근거의 diagnostic/entrypoint/framework/function/edge identity도
종류별 최대 3개만 전송하며 나머지는 omitted count로 남긴다. signal은 측정된 분석
공백이지 runtime defect 판정이 아니다.

대형 그래프에서는 diagnostic/gap count와 candidate/affected/evidence count를 정확히
집계하되 전체 public candidate 배열을 만들거나 정렬하지 않는다. category winner와 고정
top-K만 유지하고, 선택 후보의 domain evidence identity는 종류별 최대 8개를 두 번째
pass에서 수집한다.

### 6.3 All Functions Inventory

기본 화면은 모든 함수를 보여주지 않지만, `All Functions` inventory는 반드시 제공해야 한다.

Inventory 요구사항:

- virtual list 기반
- file path, qualified name, role, tags, caller count, callee count 표시
- 이름 검색
- 파일 경로 필터
- role 필터
- framework 필터
- confidence 필터
- external/unresolved 포함 토글
- test/generated/migration 포함 토글
- 정렬: relevance, path, name, fan-in, fan-out, unresolved count

Inventory는 “마지막 안전망”이다. 기본 semantic view가 어떤 함수를 요약하거나 숨기더라도 inventory에서 찾을 수 있어야 한다.

현재 검색 vertical slice는 Explore Code Flows 안에서 이름, qualified name, source path를
대소문자 구분 없이 검색한다. Webview는 external/unresolved를 제외하도록 고정하며 빈 query는
concrete function/method/constructor 전체를 탐색한다. Webview는 한 번에
50개를 요청하고 host는 어떤 요청도 100개보다 크게 응답하지 않는다. 응답은 exact total과
opaque next cursor를 보존하고 concrete 결과만 단일 클릭/Enter source navigation target이
된다. 검색 request/response는 browser requestId를 함께 보존하여 같은 query로 다시 보낸 이전
request가 늦게 도착해도 현재 검색에 적용하지 않는다. external/unresolved toggle,
role/framework/confidence/test/generated/migration UI 필터와 다중 정렬은 후속 범위이다.

## 7. UI 구조

### 7.1 Guided Tour와 Explore evidence

첫 화면은 도구가 선택한 source-backed current stop을 먼저 안내한다. 기존 Project Learning
Journey, Project Map과 Reading Guide는 Explore에서 경로를 넓히고 반례를 찾는 근거 도구다.

```text
Guide
  Mission 1
    Current stop 1 of N
    Why now -> Look for -> Question -> Open this function
    [source-open ACK 이후]
    Move on when -> Next stop

Explore
  Project Learning Journey [collapsed]
  Project Map
    NestJS + GraphQL
    apps/api · 44 HTTP · GraphQL Q12 M8 S1
    apps/admin · Django · 18 HTTP
    +2 more scopes

    [scope 선택 후]
    Source areas (최대 5)
    Representative reading paths (최대 3, 기본 접힘)
```

표시 규칙:

- Guide는 mission 하나와 current stop 하나만 표시하고 source-open ACK 전에는 Next를 표시하지 않는다.
- POC stop은 concrete definition만 source target으로 사용한다.
- 8단계 로드맵은 현재 자동 분석 범위를 전체 교육 과정으로 오해하지 않게 항상 안내한다.
- visited progress는 scope detail open, representative path disclosure, concrete source-open 요청의
  세 UI 행동만 반영한다. 자동 분석의 신뢰도나 사용자의 이해도 점수가 아니다.
- Explore의 초기 scope card는 최대 3개이고 개별 함수/file/signal row는 0개이다.
- 같은 normalized rootPath의 framework와 operation type을 한 카드에 합친다.
- scope 선택 전에는 source area와 reading path를 계산하거나 Webview로 보내지 않는다.
- source area에는 workspace-relative 대표 file label을 최대 3개 표시하되 navigation target으로
  만들지 않는다.
- reading path의 각 source step에는 workspace-relative `file:line`을 표시한다. workspace 밖
  source는 절대경로 대신 filename-only 안전 축약을 사용한다.
- concrete step의 위치는 definition이며, unresolved/external call step의 edge-local 위치만
  `call site:`로 명시해 target 정의처럼 보이지 않게 한다. non-call framework mapping 위치는
  `evidence:`로 구분한다.
- concrete function step만 source 이동 버튼이 된다. unresolved/external target identity는
  source node로 위장하지 않는다.
- representative path는 transport diversity와 명시적 semantic boundary를 기준으로 고른
  정적 구조 예시이며 runtime 순서나 business importance를 의미하지 않는다.
- area/path/step의 생략 수를 각각 표시한다.

### 7.2 Detail Disclosures

top-level disclosure는 정확히 다음 3개로 구성하며 모두 기본 닫힘이다.

```text
Explore Code Flows
Browse Structure
  Components | Files
Analysis Details
  Project Brief
  Analysis Signals
```

Explore Code Flows를 처음 펼칠 때만 Function Index를 요청한다. Browse Structure를 처음
펼칠 때만 file/import 구조 payload를 요청하고, 한 번에 Components 또는 Files 중 선택된
한 tree만 렌더링한다. Analysis Details를 처음 펼칠 때만 overview payload를 요청한 뒤 기존
Project Brief 3개 fact와 최대 3개 Analysis Signal을 DOM에 만든다.

### 7.3 Request Flows

Request Flows는 HTTP route와 GraphQL root operation을 프로젝트 실행 흐름의
시작점으로 보여준다. 기타 CLI, test, lifecycle 진입점은 Other Entrypoints에서
확인한다.

예시:

```text
Request Flows
  Django
    GET /users/ -> views.user_list
      UserService.list
      UserRepository.find_active
      UserSerializer.serialize
      external: django.db.models.QuerySet.filter
  CLI
    manage.py command import_users
      handle
      parse_csv
      save_user
  GraphQL
    apps/api
      Query (128)
        user -> UsersResolver.user
      Mutation (24)
      Subscription (3)
```

표시 규칙:

- 기본 상태에는 section summary와 접힌 framework row만 표시한다.
- GraphQL framework를 펼치면 복수 root일 때 rootPath scope를 먼저, 그 다음
  Query/Mutation/Subscription count를 표시한다.
- operation type을 펼치기 전에는 operation row를 생성하지 않는다.
- operation을 펼치면 resolver와 bounded downstream calls를 표시한다.
- child expansion은 lazy loading한다.
- 같은 helper가 여러 entrypoint에서 호출되면 중복 표시하되 shared marker를 붙인다.
- 너무 긴 path는 `N more downstream calls` row로 접는다.

### 7.4 Framework Handlers

Framework Handlers는 프레임워크별 의미 단위와 call graph를 결합한다.

예시:

```text
Framework Handlers
  Django / apps/shop
    Views
      ProductListView.get
    Models
      Product.save
    Signals
      update_product_index
  FastAPI / apps/api
    GET /products
      list_products
```

Framework detector가 제공하는 unit이 있으면 이를 우선한다. 없으면 raw callable role inference로 fallback한다.

### 7.5 Hotspots

Hotspots는 구조 이해에 중요한 함수를 우선 보여준다.

필수 그룹:

- High fan-in: 여러 곳에서 호출되는 공통 함수
- High fan-out: 많은 하위 호출을 수행하는 orchestration 함수
- Cycles: recursive 또는 strongly connected component
- Side effects: DB, network, filesystem, process 호출로 이어지는 함수
- Unresolved-heavy: unresolved call이 많은 함수

Hotspots는 전체를 대체하지 않는다. 구조 이해를 위한 shortcut이다.

High fan-in/out 순위는 서로 다른 caller/callee identity로 계산한다. 동일한 두 함수
사이의 반복 호출 edge 수만 많다는 이유로 hotspot에 올리지 않는다.

### 7.6 Selected Function

사용자가 파일, 함수 row, 검색 결과를 선택하면 Selected Function section이 가장 유용한 상세 정보를 보여준다.

필수 정보:

- 함수 이름과 위치
- 역할과 tags
- direct callers
- direct callees
- entrypoint path
- downstream summary
- unresolved/external calls
- related framework unit
- source open action

예시:

```text
Selected Function: UserService.list
  Reached From
    GET /users/ -> user_list -> UserService.list
  Calls
    UserRepository.find_active
    UserSerializer.serialize
  Called By
    user_list
    admin_user_export
  External / Unresolved
    external: django.db.models.QuerySet.filter
```

### 7.7 Unresolved / External

Unresolved와 external은 노이즈로 보일 수 있지만 누락하면 안 된다.

기본 표시:

```text
Unresolved / External
  Unresolved calls: 42
    by source function
    by call name
  External dependencies: 18
    django
    requests
    react
```

각 그룹을 펼치면 호출한 함수와 위치를 표시한다.

### 7.8 All Functions 목표 UI

이 절은 dedicated inventory의 최종 목표이다. 현재 구현은 Explore Code Flows 상단의 server-side
검색 vertical slice이며, 별도 inventory filter/sort controls와 section cursor paging은 아직 없다.

All Functions는 기본적으로 닫혀 있다.

열면 검색 input과 filter controls를 먼저 보여주고, row는 virtual list로 표시한다.

기본 row:

```text
qualifiedName                     role        callers  callees  tags
apps.users.views.user_list        route       0        3        entrypoint, database
apps.users.service.UserService    service     2        4        sharedUtility
```

## 8. Ranking

Function Explorer는 기본 정렬에 relevance score를 사용한다.

```text
score =
  entrypointWeight
  + frameworkWeight
  + fanInWeight
  + fanOutWeight
  + sideEffectWeight
  + unresolvedWeight
  + currentContextWeight
  - noisePenalty
```

### 8.1 가중치 원칙

- entrypoint는 높은 점수를 받는다.
- framework handler는 높은 점수를 받는다.
- 직접 호출이 많은 함수는 orchestration 후보로 높게 본다.
- 여러 곳에서 호출되는 함수는 shared dependency 후보로 높게 본다.
- DB/network/filesystem/process side effect가 있으면 높게 본다.
- unresolved가 많으면 사용자가 확인할 가치가 있으므로 높게 본다.
- test-only, generated, migration은 기본 view에서는 낮게 보되 inventory에서 접근 가능해야 한다.

### 8.2 정렬 안정성

같은 score에서는 다음 순서로 정렬한다.

1. framework root path
2. file path
3. source line
4. qualified name

정렬은 deterministic해야 하며, 동일 graph version에서 렌더링마다 순서가 바뀌면 안 된다.

## 9. Traversal

### 9.1 반복 기반 탐색

call graph traversal은 재귀 대신 명시적 queue/stack과 visited set을 사용한다.

필수 옵션:

- direction: callers, callees, both
- maxDepth
- maxRows
- includeExternal
- includeUnresolved
- includeInferred
- includeTests
- stopAtFrameworkBoundary
- stopAtExternal

### 9.2 Cycle 처리

recursive call 또는 cycle은 무한 확장하지 않는다.

표시 예:

```text
Cycle: 3 functions
  A -> B -> C -> A
```

Cycle group은 펼칠 수 있지만, 이미 방문한 function으로 돌아가는 edge는 cycle marker로 표시한다.

### 9.3 Shared Function 처리

여러 경로에서 반복 등장하는 shared function은 중복을 완전히 제거하지 않는다. 사용자는 각 entrypoint에서 해당 함수가 호출된다는 사실을 알아야 한다.

대신 다음 marker를 붙인다.

- `shared by N entrypoints`
- `already shown in this path`
- `open canonical location`

## 10. 분석 파이프라인 요구사항

### 10.1 Symbol Extraction

분석기는 모든 function-like symbol을 수집해야 한다.

특히 다음 케이스를 놓치면 안 된다.

- TypeScript/JavaScript arrow function assignment
- object literal method
- class method
- constructor
- exported anonymous default function
- React component function
- hook function
- callback argument
- Python nested function
- Python class method
- Django CBV method
- FastAPI route function
- Flask route function
- Express callback
- NestJS controller method
- NestJS GraphQL Query/Mutation/Subscription 및 ResolveField 제외
- Strawberry sync/async root operation과 imported service call
- test callback

### 10.2 Call Extraction

다음 호출 형태를 구분해야 한다.

- direct call: `foo()`
- method call: `obj.foo()`
- constructor call: `new Foo()`
- Python constructor-like call: `Foo()`
- imported symbol call
- callback registration
- route handler binding
- decorator-based framework binding
- dynamic property call
- unresolved identifier call
- external package call

### 10.3 Framework Binding

프레임워크에서 호출 흐름이 코드상 direct call로 보이지 않아도 semantic edge를 만들어야 한다.

예:

- URL route -> Django view
- Django view -> serializer/model usage
- FastAPI route decorator -> route function
- Express router -> handler callback
- NestJS controller route -> method
- Next.js page route -> component
- React component -> hook/component call

이 edge는 일반 direct call과 구분하기 위해 `confidence`와 metadata를 보존한다.

React와 JSX 기반 UI의 함수 내부 읽기에서는 component relation만 나열하지 않는다. JSX return의
intrinsic/custom element, prop evaluation, conditional child, event binding을 source-backed block으로
펼친다. custom tag는 `renders` 의미를 유지하고 direct call로 승격하지 않으며, concise `.map`
callback의 반복 렌더링은 receiver 실행 의미를 정적으로 보장할 수 없으므로 inferred로 표시한다.

### 10.4 현재 정확도 경계

현재 Rust analyzer는 compiler frontend가 아닌 경량 syntax analyzer이다.

- Python은 stateful scanner가 comment와 single/double/triple-quoted string을 공백으로
  masking하되 UTF-8 byte offset과 CRLF/line index를 유지한다. 같은 snapshot을 symbol,
  call, import, binding, shadowing pass에서 공유한다.
- Python `class`, `def`, `async def`는 whole-keyword와 ASCII identifier/signature
  delimiter를 검사하여 `classify`, `default_value` 같은 prefix를 declaration으로
  오인하지 않는다.
- 위 처리는 알려진 string/docstring/prefix false positive를 줄이는 lexical boundary이며
  Python AST, scope graph, type resolver를 대신하지 않는다.
- JavaScript/TypeScript symbol/call 추출은 여전히 text/line heuristic이다. multiline,
  computed/dynamic syntax와 receiver type을 완전하게 해석하지 않으며 AST/type resolution은
  아직 없다.
- 일반 JS/TS/Python call의 same-file lexical/qualified-name match는 `resolved`, file-wide
  unique-name fallback은 `inferred`로 기록한다. parser/type proof가 없는 name match는
  `exact`로 승격하지 않는다.
- 함수 parameter와 직접 식별 가능한 단순 local binding이 같은 이름을 가리면 bare call을
  top-level callable에 연결하지 않고 unresolved로 보존한다. destructuring과 multiline
  binding은 여전히 AST frontend 범위로 남는다.
- dynamic dispatch, ambiguous import, runtime registration, 지원하지 않는 syntax는
  unresolved로 남거나 누락될 수 있으며 coverage signal과 confidence를 통해 이를 숨기지
  않는다.
- analyzer 내부 scanner는 UTF-8 byte offset을 유지하지만 공개 `SourceRange`는 VS Code
  계약에 맞는 UTF-16 code unit으로 변환한다. symbol/call/import뿐 아니라 route와 GraphQL
  operation 같은 framework unit 위치에도 같은 변환을 적용한다.

## 11. 캐싱

Function Explorer는 graph cache 위에 semantic insight cache와 function index projection
cache를 둔다.

Cache key:

```text
function-index::{workspaceFingerprint}::{graphVersion}
function-view::{graphVersion}::{sectionId}::{expandedStateHash}::{filterHash}
function-path::{graphVersion}::{functionId}::{direction}::{maxDepth}
```

Invalidation 조건:

- graph version 변경
- source file content hash 변경
- framework unit metadata 변경
- filter 변경
- expanded tree state 변경

Function index는 extension host 또는 worker에서 계산하고, Webview는 가능한 한 row projection만 받아 렌더링한다.

현재 `ProjectInsightCache`는 하나의 immutable graph identity에 대해 SemanticFlowIndex와
Project Overview payload를 한 번 생성한다. `FunctionIndexProjector`는 callable node,
caller/callee map, metric, flow/hotspot model을 한 번 만들고 expanded row state마다 새 row
array만 projection한다. graph 변경과 cache clear는 두 cache를 모두 무효화한다.

## 12. 성능 요구사항

### 12.1 렌더링

- 열린 accordion만 렌더링한다.
- 닫힌 accordion은 row를 계산하지 않는다.
- row DOM은 virtual list로 제한한다.
- 10,000 row inventory에서도 DOM node는 viewport + overscan 수준이어야 한다.
- scroll handler는 requestAnimationFrame으로 throttle한다.

### 12.2 계산

- semantic flow와 scope index는 graph load 시 1회 계산한다.
- direct caller/callee index는 Explore Code Flows 첫 open 시 1회 계산한다.
- semantic-flow/overview와 function-index core는 같은 graph의 row expansion에서 재사용한다.
- transitive path는 선택/확장 시 lazy 계산한다.
- fan-in/fan-out은 index에서 즉시 조회한다.
- cycle/SCC 계산은 큰 그래프에서 별도 job으로 분리할 수 있어야 한다.
- framework role inference는 index build 단계에서 수행한다.

### 12.3 대형 프로젝트 기준

초기 목표:

- 10,000 functions graph load 후 sidebar first paint 500ms 이내
- accordion open 후 first rows 300ms 이내
- scroll frame drop 없이 virtual list 유지
- selected function direct relation 표시 200ms 이내
- depth 3 traversal 1초 이내

수치는 개발 중 측정 기반으로 조정할 수 있지만, 테스트 기준은 반드시 유지해야 한다.

## 13. Protocol

Function Explorer가 커지면 sidebar에 전체 graph를 매번 넘기는 방식은 한계가 있다.

장기적으로 다음 message protocol을 도입한다.

```ts
type FunctionExplorerRequest =
  | { type: "function/summary"; payload: { graphVersion: string } }
  | { type: "function/sectionRows"; payload: FunctionSectionRowsRequest }
  | { type: "function/expand"; payload: FunctionExpandRequest }
  | { type: "function/search"; payload: FunctionSearchRequest }
  | { type: "function/select"; payload: { functionId: string } }
  | { type: "function/inventory"; payload: FunctionInventoryRequest };
```

```ts
type FunctionSectionRowsRequest = {
  sectionId: "entrypoints" | "frameworkHandlers" | "hotspots" | "selected" | "unresolvedExternal" | "allFunctions";
  cursor?: string;
  limit: number;
  filters: FunctionFilters;
};
```

현재 구현된 경계는 다음과 같다.

- `project/guidedTourLoaded`는 graph-wide primary mission 최대 1개와 definition-backed stop 최대
  5개 또는 unavailable reason 하나를 전달한다.
- `project/guidedTourOpenSource`는 graphVersion, missionId, stopId, sourceToken, requestId를 모두
  검증한다. Host가 editor open에 성공한 뒤 동일 tuple의 `project/guidedTourSourceOpened`를 보내며,
  실패하면 `project/guidedTourSourceOpenFailed`로 Retry 가능 상태를 유지한다.
- `project/readingGuideLoaded`는 scope summary 최대 3개만 전달한다.
- `project/readingGuideScope`는 graphVersion과 scopeId를 검증하고, 선택된 한 scope의
  area 최대 5개, area당 안전한 대표 file label 최대 3개, representative path 최대 3개만
  `project/readingGuideScopeLoaded`로 응답한다.
- selected scope payload의 source label은 workspace-relative 경로 또는 filename-only 축약이며,
  절대 workspace root는 Webview protocol 경계를 넘지 않는다.
- concrete source action은 snapshot-local opaque `sourceToken`만 전달하며 path-bearing analyzer
  function/symbol ID는 Reading Guide와 search payload에 직렬화하지 않는다.
- `project/loadOverview`를 Analysis Details가 처음 열릴 때 보내며,
  `project/overviewLoaded`는 정확히 3개 fact와 최대 3개 signal을 전달한다.
- 초기 `graph/loaded`는 node, edge, diagnostic, 절대 workspace path가 없는 고정 크기
  shell이다. Browse Structure가 `graph/loadStructure`를 요청한 뒤에만
  `graph/structureLoaded`로 file/import node와 edge 및 필요한 framework metadata를 보낸다.
- analyzer의 고정 schema version을 stale guard로 사용하지 않는다. Extension Host가 새
  immutable graph object마다 Webview snapshot token을 발급하고 모든 lazy request/response가
  같은 token을 확인한다.
- 초기 graph publication은 `function/indexLoaded`를 보내지 않는다. 사용자가 Explore Code
  Flows를 열어 `function/index`를 요청한 뒤에만 host-side cache에서 expansion state에
  맞는 row를 projection하고 `function/indexLoaded`는 최대 500 row를 전달한다.
- `function/search`는 같은 graph snapshot의 cached Function Index core에서 name,
  qualified name, file path를 검색하고 `function/searchLoaded`로 최대 100 row, exact total,
  opaque next cursor를 전달한다. cursor는 graphVersion, normalized query, completeness filter에
  결합되며 Webview 기본 page 크기는 50이다. requestId도 응답에 echo하여 graphVersion과 query가
  같더라도 취소되거나 교체된 요청의 늦은 응답을 거부한다.
- graph 부재나 host projection 실패는 같은 requestId/query를 가진 `function/searchFailed`로
  응답하며, Webview는 일치하는 in-flight 검색만 종료하고 입력을 retry 가능한 상태로 둔다.
- cursor는 Webview 전송/렌더링 row를 제한하지만 현재 각 page query는 host의 cached node 전체를
  scan하고 전체 match를 정렬한다. host 계산량과 full graph memory를 chunking한 것은 아니다.
- 한 expanded section이 row 상한을 독점하지 않도록 모든 non-empty top-level section의
  header를 먼저 보존하고 남은 예산을 section prefix에 round-robin으로 배분한다.
- `function/sectionRows`, `function/expand`, `function/inventory` contract와 일반 payload의
  `nextCursor`는 정의되어 있지만 현재 provider는 검색 이외 section/inventory 후속 page를
  제공하지 않는다.

검색 이외의 section과 inventory에도 “Webview가 필요한 row chunk만 요청하고 Extension
Host가 cursor page를 응답한다”는 구조를 적용하는 것은 Phase 5의 목표이다. 현 row cap을
일반 server-side pagination 완료로 간주하지 않는다.

## 14. Export

분석 결과 완전성을 보장하기 위해 Function Explorer는 export를 지원해야 한다.

필수 export:

- full function inventory JSON
- full call edge JSON
- unresolved call report
- external dependency call report
- entrypoint flow report
- selected function relationship report

Export는 UI 필터와 무관하게 full graph 기준 export 옵션을 제공해야 한다.

## 15. 테스트 전략

### 15.1 Unit Tests

- callable node detection
- call edge indexing
- role inference
- fan-in/fan-out metric
- repeated call-site가 distinct-caller/callee hotspot을 부풀리지 않는지 검증
- unresolved call preservation
- external call preservation
- cycle detection
- traversal depth limit
- relevance sorting
- hidden count calculation
- filter correctness

### 15.2 Fixture Tests

필수 fixture:

- TypeScript named function call
- TypeScript arrow function assignment
- TypeScript class method call
- JavaScript CommonJS callback
- React component and hook
- Express route handler
- NestJS controller method
- Python function call
- Python class method call
- Django function-based view
- Django class-based view
- Django model method
- FastAPI route function
- Flask route function
- recursive function call
- circular call graph
- unresolved dynamic call
- external package call
- Python string/docstring/comment masking과 declaration keyword boundary
- same-file name match와 unique-name fallback confidence 구분

### 15.3 UI Tests

- Guide/Explore tabpanel 중 Guide가 기본 선택되고, mission 하나/current stop 하나만 보여야 한다.
- matching source-open acknowledgment 전에는 Next가 없어야 하며 stale/mismatched ACK는 무시해야 한다.
- source-open failure는 opened로 기록하지 않고 같은 stop의 Retry를 제공해야 한다.
- unavailable Guide는 이유와 evidence를 표시하고 Explore로 가는 명시적 CTA를 제공해야 한다.
- Explore의 초기 Project Map은 scope 최대 3개만 렌더링하고 개별 function/file/signal row는 없어야 한다.
- graph publication 직후 `function/index` 요청과 Function Index payload는 0개여야 한다.
- Explore Code Flows는 기본 닫힘이고 open 시에만 lazy Function Index load가 발생해야 한다.
- Browse Structure와 Analysis Details는 open 시에만 각각 structure/overview payload를 요청해야 한다.
- scope 선택 시에만 area 최대 5개, path 최대 3개, step 최대 5개를 load해야 한다.
- selected scope의 area file label은 최대 3개이고 비대화형이어야 하며, path step의 source
  location은 절대 workspace path를 포함하지 않아야 한다.
- 같은 analyzer version의 연속 분석이어도 오래된 snapshot token의 scope/function/structure/overview
  응답은 렌더링하지 않아야 한다.
- virtual list는 전체 row 수보다 훨씬 적은 DOM node만 유지해야 한다.
- All Functions inventory에서 기본 view에 숨겨진 함수를 검색할 수 있어야 한다.
- function search는 stale graph 응답을 거부하고 cursor page 사이에 중복/누락이 없어야 하며,
  10,000개 match에서도 한 payload가 100 row를 넘지 않아야 한다.
- 실제 절대경로를 포함하는 analyzer symbol ID도 search/Reading Guide JSON에는 나타나지 않아야
  하며, 이전 snapshot의 sourceToken은 새 graph에서 resolve되지 않아야 한다.
- unresolved/external group은 count와 상세 row를 모두 제공해야 한다.
- selected function 변경 시 inspector가 direct caller/callee/path를 갱신해야 한다.
- 접힌 GraphQL framework는 Query/Mutation/Subscription count까지만 표시해야 한다.
- operation type을 펼치기 전에는 operation row가 없어야 한다.
- 복수 GraphQL rootPath는 scope별 operation을 섞지 않아야 한다.
- Analysis Details를 펼치면 Project Brief는 정확히 3개 fact만 렌더링해야 한다.
- Analysis Signals는 Analysis Details 안에서 최대 3개이며 evidence identity와 omitted count를 보존해야 한다.
- 초기 sidebar graph shell은 10,000개 file/import fixture에서도 일정 크기이고 path를 포함하지 않아야 한다.
- lazy structure payload에는 callable node와 calls edge가 없어야 한다.

### 15.4 Completeness Tests

Completeness test는 Function Explorer의 핵심이다.

각 fixture에서 다음을 검증한다.

- analyzer가 발견한 callable node 수와 Function Universe callable count가 일치한다.
- analyzer가 발견한 calls edge 수와 Function Universe call edge count가 일치한다.
- default view에 표시되지 않은 함수 수가 hidden count에 반영된다.
- hidden 함수가 All Functions inventory에서 검색된다.
- unresolved call이 삭제되지 않고 unresolved group에 표시된다.
- external call이 삭제되지 않고 external group에 표시된다.
- parser failure가 coverage diagnostics에 표시된다.

## 16. Acceptance Criteria

Function Explorer는 다음 조건을 만족해야 한다.

1. 사용자는 전체 8단계 Project Learning Journey와 현재 지원하는 세 행동의 범위를 구분할 수 있다.
2. Map project, Trace one representative request, Verify in source의 visited progress는 실제
   UI 행동 후에만 갱신되며 이해 완료 상태로 표현되지 않는다.
3. roadmap은 `Discovered`/`Inferred`/`Confirmed`/`Demonstrated`/`Unknown`의 의미와 단계별
   필요 evidence를 안내하되, 현재 프로젝트의 상태로 자동 할당하지 않는다.
4. 사용자는 Explore에서 normalized rootPath 기준 프로젝트 scope와 실행 surface를 최대 3개 카드로 파악할 수 있다.
5. 사용자는 특정 함수를 선택해 caller, callee, entrypoint path, downstream path를 볼 수 있다.
6. 사용자는 모든 함수를 All Functions inventory에서 찾을 수 있다.
7. 기본 화면에서 숨긴 함수 수와 이유가 diagnostics로 드러난다.
8. unresolved/external/inferred call은 누락되지 않고 별도 그룹으로 확인 가능하다.
9. 닫힌 accordion은 row 계산과 DOM 렌더링을 하지 않는다.
10. 큰 function graph에서도 virtual list로 DOM row 수를 제한한다.
11. cycle과 recursion은 무한 확장되지 않고 명시적으로 표시된다.
12. framework entrypoint와 handler는 raw call graph보다 우선적으로 의미 있게 표시된다.
13. export는 UI 필터와 무관하게 full function graph를 제공한다.
14. GraphQL root operation은 HTTP route와 별도로 집계되고 concrete resolver로 이동할 수 있다.
15. Guided Tour primary path를 제외한 다른 reading path와 Function Index는 scope 선택 또는 Explore
    disclosure 전에는 Webview에 전달되지 않는다.
16. selected scope의 source context는 상대경로 또는 안전 축약만 사용하며, 대표 area file은
    source navigation target이 아니다.
17. 사용자는 concrete callable 전체를 이름 또는 source path로 bounded 검색하고 결과의
    source를 바로 열 수 있다.
18. eligible path가 있으면 기본 Guide에 mission 하나가 자동 선택되고 current definition stop 하나만 보인다.
19. matching source-open acknowledgment 전에는 Next가 나타나지 않고 방문을 이해 완료로 표현하지 않는다.
20. 기존 Project Reading Plan과 상세 탐색 기능은 Explore에서 유지된다.

## 17. 구현 단계

현재 Learning Journey vertical slice는 전체 8단계 로드맵을 보여주고 Map project, Trace one
representative request, Verify in source의 visited progress만 기록한다. 이것은 학습 완료나
준비도 판정이 아니다. 현재 action card는 `Why -> Learn -> Inspect evidence -> Do -> Explain
back -> Exit criteria` 계약을 읽기 전용으로 보여준다. 후속 단계에서 답변 검토와
`Confirmed`/`Demonstrated` 근거 기록을 순차적으로 구현한다.

분석 도구 측면에서는 Phase 2/3의 일부와 guide-first disclosure가 동작한다. host-side semantic/function
index, two-stage Project Reading Guide, Project Brief, evidence-backed signals, bounded row
projection과 graph snapshot cache는 구현되었다. 초기 graph는 고정 크기 shell과 scope 3개만
전송하며 Structure, Overview, Function Index는 disclosure별 lazy request로 분리했다.
검색에는 snapshot-bound cursor paging이 동작한다. 반면 아래 Phase 5의 일반 section/inventory
paging, source streaming/chunked analysis, persistent index cache와 대형 workspace 성능 기준
검증은 완료되지 않았다.

### Phase 1: Current Tree Stabilization

- Project Map scope 3개와 lazy scope Reading Guide
- Explore Code Flows 기본 닫힘과 초기 Function Index 미생성
- lazy rendering
- virtual list
- row cache
- hidden count 표시
- All Functions section 추가

### Phase 2: Function Index

- direct caller/callee index를 extension host로 이동
- Function Universe 생성
- coverage diagnostics 생성
- role/tag/metric 계산
- unresolved/external grouping

### Phase 3: Semantic Views

- Entrypoints section
- Framework Handlers section
- Hotspots section
- Selected Function section
- framework unit과 function node 연결

### Phase 4: Completeness and Export

- All Functions inventory 필터/검색
- full function inventory export
- unresolved/external report export
- completeness fixture tests

### Phase 5: Protocol and Scaling

- Webview 전체 graph 전달 축소
- function row chunk protocol
- path query protocol
- index cache persistence
- large workspace performance tests

### Phase 6: Project-Specific Guided Tour (POC in review)

- Project Reading Guide의 기존 rank를 재사용하는 graph-wide bounded primary-path API
- complete learning path와 entrypoint-handler mapping confidence 우선으로 공유 comparator 개선
- primary-path result와 unavailable diagnostics만 소비하는 host-independent Guided Tour domain projection
- mission 1개, current stop 1개, stop 최대 5개의 bounded protocol
- POC: definition용 snapshot-local source token과 단계별 `Move on when`
- POC: graph/mission/stop/token/request 전체 소속을 검증하는 source-open acknowledgment
- `Guide | Explore` surface 분리와 Guide 기본 선택
- stale snapshot guard
- 현재의 정적 3-action orientation progress 제거와 8단계 roadmap의 보조 자료화
- POC: unavailable, shuffled input, large flow, protocol swap, stale ACK, keyboard fixture 검증
- 후속: decorator/callsite 임의 range, required multi-anchor, related test와 integration fixture

세부 구현 순서와 release gate는
[`GuidedTourImplementationPlan.md`](./GuidedTourImplementationPlan.md)를 따른다.

## 18. 중요한 설계 결정

### 18.1 전체 함수를 기본 트리에 모두 표시하지 않는다

이 결정은 누락이 아니다. 기본 트리는 이해를 돕기 위한 semantic projection이다.

완전성은 다음 경로로 보장한다.

- Function Universe count
- Coverage Diagnostics
- All Functions inventory
- Search
- Export
- Unresolved / External section

### 18.2 Unresolved call은 실패가 아니라 분석 결과이다

정적 분석에서 unresolved call은 자연스럽게 발생한다. 이를 숨기면 사용자는 분석 품질을 오해한다.

Unresolved call은 다음 정보를 포함해야 한다.

- 호출한 함수
- 호출 위치
- 호출 표현식
- 추론 실패 이유
- 가능한 후보가 있으면 후보 목록

### 18.3 Framework dispatch는 call graph의 일부로 본다

프레임워크는 실제 실행 흐름을 코드상 direct call로 드러내지 않는 경우가 많다.

따라서 route, controller, view, signal, lifecycle, hook 같은 dispatch 관계는 일반 direct call과 구분된 semantic edge로 call flow에 포함한다.

### 18.4 Graph View와 Function Explorer는 분리한다

그래프 렌더러가 비활성화되어도 Function Explorer는 독립적으로 동작해야 한다.

Function Explorer는 sidebar tree, inventory, selected inspector 중심으로 먼저 완성한다. 이후 graph renderer가 안정화되면 선택 함수의 subgraph를 별도 panel로 연결한다.

### 18.5 Analysis Signal은 결함 판정이 아니다

현재 signal은 analyzer diagnostic, mapping gap, traversal bound, mapped flow 안의 unresolved
call처럼 source-backed evidence가 있는 분석 공백만 나타낸다. 파일명, 함수명, external
dependency 존재, graph topology만으로 보안/성능/운영 위험을 추측하지 않는다. 더 강한
판정을 추가하려면 별도의 rule identity, severity 근거, source evidence, false-positive
정책과 검증 fixture가 먼저 필요하다.

### 18.6 학습 상태와 방문 상태를 분리한다

화면을 열거나 source로 이동한 이벤트는 학습 행동을 시작했다는 근거다. 코드 밖의 맥락을
사람에게 확인했거나 실제 작업을 수행했다는 근거는 아니다. 따라서 visited progress,
`Discovered`/`Inferred`, `Confirmed`, `Demonstrated`를 서로 자동 변환하지 않는다. 제품은
전체 여정을 본 상태를 숙련이나 온보딩 완료로 표현하지 않는다. 현재 slice는 단계별 accepted
evidence level과 필요한 evidence만 정적으로 표시한다. 향후 프로젝트별 상태를 도입할 때는
근거가 없는 항목에 `Unknown`과 다음 확인 질문을 남겨야 한다.
