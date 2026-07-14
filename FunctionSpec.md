# Function Relationship Explorer Specification

## 1. 목적

Function Relationship Explorer는 프로젝트 안의 함수, 메서드, 생성자, 프레임워크 핸들러 간 호출 관계를 구조적으로 이해하기 위한 탐색기이다.

기존의 단순 `file -> function -> callers/callees` 나열은 함수 수가 늘어날수록 관계를 설명하지 못하고 노이즈가 된다. 이 스펙의 목표는 모든 함수 정보를 보존하면서도, 사용자가 실제 실행 흐름과 의미 있는 관계를 단계적으로 파악할 수 있게 하는 것이다.

핵심 원칙은 다음과 같다.

- 분석 결과에서 함수와 호출 관계를 임의로 누락하지 않는다.
- 기본 UI는 모든 함수를 펼쳐 보여주지 않는다.
- 숨긴 정보는 삭제가 아니라 요약, 접기, 필터, lazy loading, 검색, 전체 인벤토리로 접근 가능해야 한다.
- 함수 관계는 단순 목록이 아니라 entrypoint, framework unit, fan-in/fan-out, side effect, 외부 의존성, unresolved 호출을 기준으로 해석되어야 한다.

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

### 4.2 기본 화면은 요약 중심

초기 렌더링에서 모든 함수를 나열하지 않는다.

기본 화면은 다음 순서로 보여준다.

1. Project Map: 정규화된 rootPath scope 최대 3개
2. 선택된 scope의 lazy Reading Guide
3. Explore Code Flows disclosure
4. Browse Structure disclosure
5. Analysis Details disclosure

초기 Project Map에는 개별 함수, 파일, call edge, diagnostic, signal을 표시하지 않는다.
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

현재 경량화는 닫힌 branch의 row/DOM 생성을 막고, 최초 graph publication에서는 scope
summary 3개만 보낸다. scope 선택 시 area 최대 5개, representative path 최대 3개,
path당 step 최대 5개를 별도 요청한다. Function Index는 Explore Code Flows를 열기 전에는
생성하거나 전송하지 않는다. 최초 `graph/loaded`는 node/edge/path가 없는 고정 크기 shell만
전달한다. file import graph는 Browse Structure, overview fact/signal은 Analysis Details를
처음 열 때 각각 별도 요청한다. Extension Host는 graph snapshot별 semantic flow, Reading
Guide projector, overview와 function index core를 재사용한다. 그러나 analyzer scan과 전체
host-side graph는 graph load 시 생성한다. 현재의 lazy Structure payload와 Function row cap은
사용 가능한 cursor paging이 아니다. source streaming, relation path query, inventory의 실제
server-side chunk protocol은 Phase 5 범위로 남긴다.

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

Project Reading Guide는 다음 두 단계로 정보 예산을 강제한다.

1. `ProjectReadingGuideIndex`
   - normalized rootPath scope 최대 3개
   - 같은 scope의 framework와 HTTP/GraphQL operation type count 통합
   - 전체 candidate/omitted scope 수 보존
   - 개별 symbol, call edge, reading path는 포함하지 않음
2. `ProjectScopeReadingGuide`
   - 사용자가 선택한 한 scope만 lazy projection
   - source area 최대 5개
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

## 7. UI 구조

### 7.1 Project Map과 Reading Guide

첫 화면에는 프로젝트 구조를 빠르게 파악하는 고정 크기 Project Map만 둔다.

```text
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

- 초기 scope card는 최대 3개이고 개별 함수/file/signal row는 0개이다.
- 같은 normalized rootPath의 framework와 operation type을 한 카드에 합친다.
- scope 선택 전에는 source area와 reading path를 계산하거나 Webview로 보내지 않는다.
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

### 7.8 All Functions

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

- `project/readingGuideLoaded`는 scope summary 최대 3개만 전달한다.
- `project/readingGuideScope`는 graphVersion과 scopeId를 검증하고, 선택된 한 scope의
  area 최대 5개와 representative path 최대 3개만
  `project/readingGuideScopeLoaded`로 응답한다.
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
- 한 expanded section이 row 상한을 독점하지 않도록 모든 non-empty top-level section의
  header를 먼저 보존하고 남은 예산을 section prefix에 round-robin으로 배분한다.
- payload의 `nextCursor`와 `function/sectionRows`, `function/expand`, `function/search`,
  `function/inventory` contract는 정의되어 있지만 현재 provider는 실제 후속 page를
  제공하지 않는다.

따라서 “Webview가 필요한 row chunk만 요청하고 Extension Host가 cursor page를
응답한다”는 것은 Phase 5의 목표이다. 현 row cap을 server-side pagination 완료로
간주하지 않는다.

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

- 초기 Project Map은 scope 최대 3개만 렌더링하고 개별 function/file/signal row는 없어야 한다.
- graph publication 직후 `function/index` 요청과 Function Index payload는 0개여야 한다.
- Explore Code Flows는 기본 닫힘이고 open 시에만 lazy Function Index load가 발생해야 한다.
- Browse Structure와 Analysis Details는 open 시에만 각각 structure/overview payload를 요청해야 한다.
- scope 선택 시에만 area 최대 5개, path 최대 3개, step 최대 5개를 load해야 한다.
- 같은 analyzer version의 연속 분석이어도 오래된 snapshot token의 scope/function/structure/overview
  응답은 렌더링하지 않아야 한다.
- virtual list는 전체 row 수보다 훨씬 적은 DOM node만 유지해야 한다.
- All Functions inventory에서 기본 view에 숨겨진 함수를 검색할 수 있어야 한다.
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

1. 사용자는 기본 화면에서 normalized rootPath 기준 프로젝트 scope와 실행 surface를 최대 3개 카드로 파악할 수 있다.
2. 사용자는 특정 함수를 선택해 caller, callee, entrypoint path, downstream path를 볼 수 있다.
3. 사용자는 모든 함수를 All Functions inventory에서 찾을 수 있다.
4. 기본 화면에서 숨긴 함수 수와 이유가 diagnostics로 드러난다.
5. unresolved/external/inferred call은 누락되지 않고 별도 그룹으로 확인 가능하다.
6. 닫힌 accordion은 row 계산과 DOM 렌더링을 하지 않는다.
7. 큰 function graph에서도 virtual list로 DOM row 수를 제한한다.
8. cycle과 recursion은 무한 확장되지 않고 명시적으로 표시된다.
9. framework entrypoint와 handler는 raw call graph보다 우선적으로 의미 있게 표시된다.
10. export는 UI 필터와 무관하게 full function graph를 제공한다.
11. GraphQL root operation은 HTTP route와 별도로 집계되고 concrete resolver로 이동할 수 있다.
12. scope 선택 전에는 개별 reading path와 Function Index가 Webview에 전달되지 않는다.

## 17. 구현 단계

현재는 Phase 2/3의 일부와 guide-first disclosure가 동작한다. host-side semantic/function
index, two-stage Project Reading Guide, Project Brief, evidence-backed signals, bounded row
projection과 graph snapshot cache는 구현되었다. 초기 graph는 고정 크기 shell과 scope 3개만
전송하며 Structure, Overview, Function Index는 disclosure별 lazy request로 분리했다.
반면 아래 Phase 5의 cursor-backed paging, source streaming/chunked analysis, persistent
index cache와 대형 workspace 성능 기준 검증은 완료되지 않았다.

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
