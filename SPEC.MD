# Project Analyzer VS Code Extension Specification

## 1. 개요

Project Analyzer는 코드베이스의 파일, 클래스, 함수, 메서드, 모듈 간 정적 호출 구조를 분석하고, 이를 VS Code 안에서 구조화된 시각 탐색기로 제공하는 확장 프로그램이다.

목표는 사용자가 낯선 프로젝트를 빠르게 이해하고, 특정 기능이 어떤 파일과 심볼을 거쳐 동작하는지 추적하며, 변경 영향 범위를 판단할 수 있도록 돕는 것이다.

## 2. 핵심 목표

- 프로젝트의 구조를 파일, 폴더, 모듈, 클래스, 함수 단위로 추출한다.
- 함수 호출, 메서드 호출, import/export, 상속, 구현, 참조 관계를 정적 분석으로 수집한다.
- 분석 결과를 방향성 그래프로 표현하고, VS Code Webview 기반 visual explorer에서 탐색할 수 있게 한다.
- 사용자가 그래프 노드에서 원본 코드 위치로 즉시 이동할 수 있게 한다.
- 대형 프로젝트에서도 점진적 분석, 캐싱, 필터링을 통해 실용적인 성능을 유지한다.
- 분석 결과를 사람이 읽기 쉬운 구조화 데이터로 보존하여 이후 검색, 요약, 리포팅, AI 보조 기능에 활용할 수 있게 한다.

## 3. 대상 사용자

- 새 코드베이스를 온보딩하는 개발자
- 레거시 시스템의 호출 흐름을 파악해야 하는 개발자
- 변경 영향 범위를 검토하는 리뷰어
- 프로젝트 구조 문서화를 자동화하려는 팀
- VS Code 안에서 코드 탐색과 구조 분석을 함께 수행하려는 사용자

## 4. 지원 범위

### 4.1 초기 지원 언어

1. TypeScript
2. JavaScript
3. Python

### 4.2 확장 지원 언어

향후 다음 언어를 추가 작업해야한다.

- Java
- Kotlin
- Go
- Rust
- C#
- C/C++

### 4.3 분석 대상

- 워크스페이스 폴더
- 단일 파일
- 선택된 폴더 또는 glob 패턴
- Git 변경 파일 집합
- 사용자가 명시적으로 제외하지 않은 source 파일

### 4.4 제외 대상

기본적으로 다음 경로는 분석에서 제외한다.

- `node_modules`
- `.git`
- `.vscode`
- `dist`
- `build`
- `out`
- `target`
- `coverage`
- `.venv`
- `venv`
- `__pycache__`
- 생성 파일, 번들 파일, lock 파일

사용자는 설정에서 include/exclude glob을 재정의할 수 있어야 한다.

## 5. 주요 기능

### 5.1 프로젝트 인덱싱

확장은 워크스페이스를 스캔하여 분석 가능한 파일 목록을 만든다.

인덱싱 결과에는 다음 정보가 포함된다.

- 파일 경로
- 언어
- 파일 크기
- 마지막 수정 시각
- content hash
- 분석 상태
- 발견된 top-level symbol 목록

파일 변경 이벤트가 발생하면 변경된 파일만 다시 분석한다.

### 5.2 심볼 추출

각 파일에서 다음 심볼을 추출한다.

- module
- namespace
- class
- interface
- enum
- function
- method
- constructor
- property
- variable
- imported symbol
- exported symbol

각 심볼은 다음 공통 필드를 가진다.

```ts
type SymbolNode = {
  id: string;
  kind: SymbolKind;
  name: string;
  qualifiedName: string;
  filePath: string;
  range: SourceRange;
  selectionRange: SourceRange;
  language: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
};
```

### 5.3 관계 추출

정적 분석은 다음 관계를 추출한다.

- `contains`: 파일, 클래스, 함수의 포함 관계
- `imports`: 파일 또는 모듈 import 관계
- `exports`: 파일 또는 모듈 export 관계
- `calls`: 함수 또는 메서드 호출 관계
- `references`: 심볼 참조 관계
- `extends`: 클래스 상속 관계
- `implements`: 인터페이스 구현 관계
- `overrides`: 메서드 override 관계
- `instantiates`: 클래스 생성 관계
- `uses`: 타입, 값, 상수 사용 관계

각 관계는 방향성을 가진다.

```ts
type GraphEdge = {
  id: string;
  kind: EdgeKind;
  sourceId: string;
  targetId: string;
  filePath: string;
  range?: SourceRange;
  confidence: "exact" | "resolved" | "inferred" | "unresolved";
  metadata?: Record<string, unknown>;
};
```

### 5.4 호출 그래프

호출 그래프는 함수, 메서드, 생성자 간의 `calls` 관계를 중심으로 구성한다.

필수 기능:

- 특정 함수 기준 upstream caller 보기
- 특정 함수 기준 downstream callee 보기
- 호출 depth 제한
- 재귀 호출 표시
- 외부 라이브러리 호출 접기
- unresolved call 별도 표시
- 동적 호출 또는 reflection성 호출은 inferred edge로 표시

### 5.5 파일 구조 그래프

파일 구조 그래프는 폴더, 파일, import/export 관계를 중심으로 구성한다.

필수 기능:

- 폴더 트리와 dependency graph 전환
- 순환 import 표시
- entry file에서 도달 가능한 파일 표시
- 변경 파일이 영향을 줄 수 있는 파일 표시
- test file과 source file 관계 표시

### 5.6 클래스 구조 그래프

클래스 구조 그래프는 class, interface, inheritance, implementation 관계를 중심으로 구성한다.

필수 기능:

- 상속 체인 보기
- 구현체 목록 보기
- 클래스 내부 메서드 펼침
- 메서드 override 관계 표시
- 생성자 호출 관계 표시

### 5.7 Visual Explorer

Visual Explorer는 VS Code Webview에서 제공한다.

필수 UI 영역:

- graph canvas
- breadcrumb
- search box
- filter panel
- selected node detail panel
- minimap
- depth control
- layout selector
- legend

지원 layout:

- hierarchical
- force-directed
- radial
- file tree
- dependency matrix

노드 상호작용:

- 클릭: detail panel 열기
- 더블 클릭: 원본 코드 위치로 이동
- 우클릭: context menu 표시
- hover: 간단한 symbol 정보 표시
- expand/collapse: 연결된 edge를 점진적으로 로드

필터:

- node kind
- edge kind
- language
- folder
- file glob
- public/private/exported 여부
- test/source 여부
- unresolved edge 포함 여부
- external dependency 포함 여부

### 5.8 코드 탐색 연동

그래프의 모든 코드 기반 노드는 VS Code editor와 연결되어야 한다.

필수 명령:

- Open Source
- Reveal in Explorer
- Find Callers
- Find Callees
- Show Containing File Graph
- Copy Qualified Name
- Copy Graph Node ID
- Export Subgraph

### 5.9 검색

사용자는 다음 단위로 검색할 수 있어야 한다.

- 파일명
- 심볼명
- qualified name
- edge kind
- path glob
- language
- unresolved symbol

검색 결과 선택 시 해당 노드로 그래프 viewport가 이동한다.

### 5.10 Export

분석 결과와 현재 그래프 뷰를 내보낼 수 있어야 한다.

지원 형식:

- JSON
- GraphML
- Mermaid
- DOT
- SVG
- PNG
- Markdown report

## 6. 아키텍처

### 6.1 VS Code Extension Host

Extension Host는 다음 역할을 담당한다.

- 명령 등록
- 설정 로드
- 파일 시스템 watcher 관리
- 분석 작업 스케줄링
- 분석 캐시 관리
- Webview 생성 및 메시지 브릿지
- editor navigation 처리

### 6.2 Analyzer Core

Analyzer Core는 Rust 기반 저수준 분석 엔진을 기본 구현으로 사용한다. VS Code Extension Host는 Rust 엔진을 child process로 실행하고, 엔진이 출력하는 ProjectGraph JSON을 Webview에 전달한다.

Extension Host 내부 TypeScript analyzer는 개발 중 fallback과 계약 테스트 용도로 유지한다.

주요 단계:

1. workspace scan
2. file classification
3. parser selection
4. AST parsing
5. symbol extraction
6. import/export resolution
7. reference resolution
8. relationship extraction
9. graph normalization
10. cache persistence

Analyzer Core는 언어별 analyzer plugin에 의존한다.

### 6.3 Language Analyzer Plugin

언어별 analyzer는 공통 인터페이스를 구현한다.

```ts
interface LanguageAnalyzer {
  languageId: string;
  extensions: string[];
  parse(file: SourceFile): Promise<ParsedFile>;
  extractSymbols(parsed: ParsedFile): Promise<SymbolNode[]>;
  extractEdges(parsed: ParsedFile, context: AnalysisContext): Promise<GraphEdge[]>;
  resolveReferences?(graph: ProjectGraph, context: AnalysisContext): Promise<GraphEdge[]>;
}
```

### 6.4 Graph Store

Graph Store는 분석 결과를 정규화하여 저장한다.

필수 기능:

- node CRUD
- edge CRUD
- node by file lookup
- edge by source lookup
- edge by target lookup
- subgraph query
- path query
- cycle detection
- graph diff

### 6.5 Webview Frontend

Webview는 그래프 렌더링과 사용자 상호작용을 담당한다.

권장 기술:

- React
- TypeScript
- Cytoscape.js 또는 React Flow
- Zustand 또는 Redux Toolkit
- CSS variables 기반 theme integration

Webview는 직접 파일 시스템에 접근하지 않고 extension host와 message passing으로 통신한다.

### 6.6 Message Protocol

Extension Host와 Webview는 typed message protocol을 사용한다.

예시:

```ts
type WebviewRequest =
  | { type: "graph/load"; payload: GraphLoadRequest }
  | { type: "graph/expand"; payload: ExpandRequest }
  | { type: "node/openSource"; payload: { nodeId: string } }
  | { type: "search/query"; payload: SearchRequest }
  | { type: "export/run"; payload: ExportRequest };

type ExtensionResponse =
  | { type: "graph/loaded"; payload: GraphPayload }
  | { type: "graph/updated"; payload: GraphPatch }
  | { type: "search/results"; payload: SearchResult[] }
  | { type: "error"; payload: ErrorPayload };
```

## 7. 데이터 모델

### 7.1 Source Range

```ts
type SourceRange = {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
};
```

라인과 문자는 VS Code API와 동일하게 0-based index를 사용한다.

### 7.2 Project Graph

```ts
type ProjectGraph = {
  workspaceRoot: string;
  version: string;
  generatedAt: string;
  nodes: SymbolNode[];
  edges: GraphEdge[];
  diagnostics: AnalysisDiagnostic[];
  metadata: {
    languages: string[];
    languageSummary?: LanguageSummary[];
    frameworks?: DetectedFramework[];
    frameworkUnits?: FrameworkUnit[];
    frameworkUnitEdges?: FrameworkUnitEdge[];
    fileCount: number;
    symbolCount: number;
    edgeCount: number;
  };
};
```

```ts
type LanguageSummary = {
  language: string;
  fileCount: number;
  percentage: number;
};

type DetectedFramework = {
  name: string;
  ecosystem: string;
  category: "frontend" | "backend" | "fullstack" | "test" | "build" | "desktop" | "mobile" | "unknown";
  confidence: "high" | "medium" | "low";
  rootPath?: string;
  evidence: string[];
};

type FrameworkUnit = {
  id: string;
  framework: string;
  rootPath: string;
  kind:
    | "app"
    | "route"
    | "operation"
    | "controller"
    | "view"
    | "model"
    | "serializer"
    | "component"
    | "service"
    | "repository"
    | "entity"
    | "schema"
    | "dependency"
    | "configuration"
    | "command"
    | "module"
    | "provider"
    | "middleware"
    | "unknown";
  name: string;
  qualifiedName?: string;
  filePath: string;
  range?: SourceRange;
  parentId?: string;
  metadata?: Record<string, unknown>;
};

type FrameworkUnitEdge = {
  id?: string;
  kind: "contains" | "routesTo" | "usesModel" | "renders" | "injects" | "calls" | "configures";
  sourceId: string;
  targetId: string;
  filePath?: string;
  range?: SourceRange;
  confidence?: "exact" | "resolved" | "inferred" | "unresolved";
  metadata?: Record<string, unknown>;
};
```

프레임워크 감지는 import graph보다 먼저 프로젝트 실행 모델을 이해하기 위한 상위
metadata로 취급한다. 모노레포에서는 framework `rootPath`를 기준으로 앱 단위
엔트리포인트 후보를 분리한다.

프레임워크가 감지되면 UI의 기본 탐색 단위는 file import가 아니라
`FrameworkUnit`이다. 예를 들어 Django는 `URLs -> Views -> Models`,
Next.js는 `App Routes -> Layouts -> Components`, FastAPI는
`Routers -> Endpoints -> Dependencies -> Schemas`처럼 프레임워크가 실제로
실행되는 의미 단위로 먼저 보여준다. file import tree는 raw dependency를
확인하는 보조 뷰로 유지한다.

초기 framework semantic adapter는 보수적인 convention 분석을 사용한다. Django
adapter는 감지된 `rootPath` 아래에서 `settings.py`, `urls.py`, `apps.py`,
`models.py`, `views.py`, `serializers.py`, `management/commands/*.py`를 우선
스캔하고 다음 단위를 생성한다.

- `configuration`: Django settings 파일
- `route`: URLConf 파일 또는 URL pattern 선언
- `app`: `apps.py`, `models.py`, `views.py`, `serializers.py` 중 하나 이상을 가진 앱 디렉터리
- `model`: `models.py`의 class 선언
- `view`: `views.py`의 function 또는 class 선언
- `serializer`: `serializers.py`의 class 선언
- `command`: management command 파일

앱 디렉터리 아래에서 발견된 semantic unit은 해당 `app` unit을 `parentId`로
가리키며, `frameworkUnitEdges`에는 `contains` edge를 기록한다. 어댑터가
정적으로 `path(...)`, `re_path(...)`의 view 참조를 단일 view unit으로 해석할 수
있으면 `routesTo` edge를 추가한다. `include(...)`, 동적 라우팅, 런타임 import,
설정 기반 alias는 추론하지 않고 후속 정밀 분석 단계에서 `inferred` 관계로
확장한다.

FastAPI adapter는 감지된 `rootPath` 아래의 Python 파일에서 다음 단위를 우선
생성한다.

- `module`: 의미 단위를 포함하는 Python module
- `app`: `FastAPI(...)` constructor 할당
- `route`: `@app.get(...)`, `@router.post(...)`, `@*.api_route(...)` decorator
- `controller`: route decorator 바로 아래의 endpoint function
- `schema`: Pydantic `BaseModel` class
- `dependency`: endpoint signature의 `Depends(...)` target
- `service`: service 파일 또는 `Service` 명명 규칙에 해당하는 class/function

FastAPI route decorator와 바로 아래 endpoint function은 `routesTo` edge로
연결한다. `include_router`, dependency injection graph, `response_model`과 schema
연결은 literal/static target을 더 엄밀히 해석하는 다음 단계에서 `configures`,
`injects`, `usesModel` edge로 확장한다.

Flask adapter는 감지된 `rootPath` 아래의 Python 파일에서 다음 단위를 우선
생성한다.

- `module`: 의미 단위를 포함하는 Python module
- `app`: `Flask(...)` constructor 할당
- `route`: `@app.route(...)`, `@bp.get(...)`, `@bp.route(...)` decorator
- `controller`: route decorator 바로 아래의 view function
- `middleware`: `before_request`, `after_request` hook function
- `service`: service 파일 또는 `Service` 명명 규칙에 해당하는 class/function

Flask route decorator와 바로 아래 view function은 `routesTo` edge로 연결한다.
Blueprint는 현재 타입 체계 안에서 `module`로 표현하고, blueprint registration과
prefix 합성은 다음 단계에서 `configures` edge로 확장한다.

React/Next.js adapter는 감지된 `rootPath` 아래의 `ts`, `tsx`, `js`, `jsx` 파일에서
다음 단위를 우선 생성한다.

- `module`: 의미 단위를 포함하는 source module
- `component`: PascalCase function/class/const component 또는 default export component
- `provider`: `Provider` suffix component
- `service`: `useXxx` hook function
- `schema`: schema 명명 규칙과 `z.object`, `yup.object`, `new Schema` 계열 선언
- `route`: Next.js `app/page`, `app/route`, `pages/*`, `pages/api/*`
- `layout`: Next.js `app/layout`, `pages/_app`, `pages/_document`

Next.js page route와 같은 파일의 component를 찾으면 `renders` edge로 연결한다.
동적 segment, route group, parallel route 표기는 경로 문자열에 보존하되 런타임
라우팅 계산은 하지 않는다.

Express/NestJS adapter는 감지된 `rootPath` 아래의 `ts`, `tsx`, `js`, `jsx` 파일에서
다음 단위를 우선 생성한다.

- `module`: 의미 단위를 포함하는 source module
- `route`: Express `app.get/post/...`, NestJS `@Get/@Post/...` method
- `controller`: Express handler function 또는 NestJS `@Controller` class
- `service`: NestJS `@Injectable` service 또는 service 파일/명명 규칙
- `provider`: NestJS `@Injectable` provider
- `middleware`: Express `app.use/router.use` non-route handler

Express route와 handler 이름을 정적으로 해석할 수 있으면 `routesTo` edge로
연결한다. NestJS controller class와 method route는 `contains` edge로 연결한다.
동적 router composition, imported handler alias, NestJS module provider graph는
다음 단계에서 더 엄밀한 symbol/import resolution으로 확장한다.

GraphQL adapter는 모든 요청이 공유하는 `/graphql` transport route를 실행
엔트리포인트로 취급하지 않는다. 감지된 `rootPath` 아래의 code-first schema에서
다음 단위를 생성한다.

- `schema`: resolver class 또는 conventional root type
- `operation`: `Query`, `Mutation`, `Subscription` root field

NestJS/TypeGraphQL 계열에서는 `@Resolver` class의 `@Query`, `@Mutation`,
`@Subscription` method를 operation으로 생성한다. nested object field를 해석하는
`@ResolveField`는 root operation에 포함하지 않는다. Strawberry에서는
`@strawberry.type`이 붙은 `Query`, `Mutation`, `Subscription` class의 sync/async
field를 추출한다. operation은 실제 callable 선언 위치를 보존하여 resolver와
downstream `calls` edge에 직접 연결한다. SDL-first schema와 inline Apollo/Yoga
resolver object, Graphene field, federation metadata, 동적 registration은 schema
field와 callable을 정적으로 연결하는 후속 adapter에서 지원한다. 중첩 GraphQL
selection이 object field resolver로 dispatch되는 흐름도 현재 root operation
flow에는 포함하지 않는다.

### 7.3 Diagnostics

분석 중 발생한 문제는 진단 정보로 보존한다.

```ts
type AnalysisDiagnostic = {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  filePath?: string;
  range?: SourceRange;
  details?: Record<string, unknown>;
};
```

## 8. 분석 정확도 정책

정적 분석은 완전한 실행 시맨틱을 보장하지 않는다. 따라서 모든 edge에는 confidence를 부여한다.

- `exact`: 언어 서버, 타입 시스템, AST resolution으로 정확히 연결됨
- `resolved`: import/export 또는 scope resolution으로 합리적으로 연결됨
- `inferred`: 이름, 패턴, framework convention으로 추론됨
- `unresolved`: 호출 또는 참조는 발견했지만 대상 심볼을 결정하지 못함

UI는 confidence를 시각적으로 구분해야 하며, unresolved edge를 숨기거나 표시할 수 있어야 한다.

## 9. 성능 요구사항

### 9.1 초기 분석

- 1,000개 파일 이하 프로젝트는 기본 설정에서 30초 이내에 초기 분석을 완료하는 것을 목표로 한다.
- 10,000개 파일 이상 프로젝트는 전체 분석 전에 progress, partial result, cancellation을 제공해야 한다.

### 9.2 점진 분석

- 단일 파일 변경 시 해당 파일과 직접 영향을 받는 import graph 범위만 재분석한다.
- 변경 파일 분석 결과는 기존 graph에 patch로 반영한다.

### 9.3 UI 성능

- 한 화면에 렌더링되는 노드는 기본 500개 이하로 제한한다.
- 큰 그래프는 clustering, paging, lazy expansion을 사용한다.
- layout 계산은 가능한 경우 Web Worker에서 수행한다.

### 9.4 캐싱

캐시는 workspace storage에 저장한다.

캐시 key:

- extension version
- analyzer version
- workspace root
- file path
- file content hash
- language analyzer version

캐시 무효화 조건:

- 파일 content hash 변경
- analyzer version 변경
- extension version의 breaking cache version 변경
- 사용자 분석 설정 변경

## 10. GUI Surfaces

확장은 Command Palette 중심 명령 대신 GUI 기반 흐름을 제공한다. Activity Bar의 Project Analyzer 사이드바는 분석 실행, 파일 탐색 트리, 그래프 브라우저 탭을 여는 제어 표면이며, 실제 그래프 canvas 탐색기는 별도의 editor tab WebviewPanel로 제공한다.

사이드바는 다음 GUI 액션을 제공한다.

- Analyze Workspace
- Analyze Current File
- VS Code Explorer 형태의 file tree 탐색
- Open Graph Browser
- Export graph
- Clear cache
- Cancel analysis

Graph Browser WebviewPanel은 다음 GUI 액션을 제공한다.

- Switch Files, Calls, and Classes views
- Project Root에서 시작하는 progressive graph expansion
- Folder, file, class, function, call child를 클릭으로 펼침
- 노드 더블 클릭 시 원본 코드 위치 열기

## 11. VS Code Settings

```json
{
  "projectAnalyzer.enabled": true,
  "projectAnalyzer.autoAnalyze": true,
  "projectAnalyzer.include": ["**/*.{ts,tsx,js,jsx,py}"],
  "projectAnalyzer.exclude": [
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/.venv/**",
    "**/venv/**"
  ],
  "projectAnalyzer.maxFileSizeKb": 1024,
  "projectAnalyzer.maxRenderedNodes": 500,
  "projectAnalyzer.defaultDepth": 2,
  "projectAnalyzer.includeExternalDependencies": false,
  "projectAnalyzer.showUnresolvedEdges": true,
  "projectAnalyzer.cache.enabled": true,
  "projectAnalyzer.cache.maxSizeMb": 256
}
```

## 12. UX 요구사항

- 분석 진행 중 상태 표시줄에 progress를 표시한다.
- 사용자가 언제든 분석을 취소할 수 있어야 한다.
- Webview가 열려 있을 때 분석 결과가 갱신되면 graph patch를 적용한다.
- 대형 그래프에서는 먼저 요약된 구조를 보여주고 사용자가 필요한 부분을 펼치게 한다.
- Request Flows는 기본적으로 section summary와 접힌 framework row까지만 만든다.
  GraphQL은 `framework -> rootPath scope(복수 root일 때) -> operation type count ->
  operation -> resolver/calls` 순서로 한 단계씩 펼친다.
- 현재 summary-first projection은 초기 row와 DOM 정보량을 제한한다. analyzer scan과
  semantic-flow index는 graph load 시 생성되며, server-side paging과 chunked
  expansion은 후속 protocol 과제로 둔다.
- 노드와 edge 스타일은 VS Code light/dark/high contrast theme을 따라야 한다.
- 오류가 발생해도 가능한 부분 결과를 표시한다.
- 빈 프로젝트 또는 지원하지 않는 언어만 있는 프로젝트에는 명확한 empty state를 제공한다.

## 13. 보안 및 개인정보

- 기본 동작은 로컬 분석이어야 한다.
- 사용자의 명시적 동의 없이 소스 코드를 외부 서비스로 전송하지 않는다.
- export 파일은 사용자가 선택한 위치에만 저장한다.
- Webview는 strict Content Security Policy를 사용한다.
- Webview script는 nonce 기반으로 로드한다.
- workspace 파일 경로와 코드 내용은 extension host 내부에서만 처리한다.

## 14. 오류 처리

분석기는 파일 단위 failure isolation을 보장한다.

- 한 파일 파싱 실패가 전체 분석 실패로 이어지면 안 된다.
- 파싱 실패 파일은 diagnostics에 기록한다.
- import resolution 실패는 unresolved edge로 기록한다.
- Webview message 처리 실패는 사용자에게 간결하게 표시하고 개발자 콘솔에 상세 정보를 기록한다.

## 15. 테스트 전략

### 15.1 Unit Tests

- path filtering
- language detection
- AST symbol extraction
- edge extraction
- graph normalization
- cache invalidation
- message protocol validation

### 15.2 Fixture Tests

언어별 fixture 프로젝트를 사용하여 실제 graph snapshot을 검증한다.

필수 fixture:

- TypeScript import/export
- TypeScript class inheritance
- JavaScript CommonJS
- Python module import
- Python class inheritance
- recursive function call
- circular dependency
- unresolved dynamic call

### 15.3 Integration Tests

- VS Code command registration
- workspace analysis command
- current file analysis command
- Webview open and message roundtrip
- graph node open source navigation
- export command

### 15.4 Performance Tests

- 1,000 files synthetic project
- 10,000 files synthetic project
- incremental update latency
- graph layout latency
- cache read/write latency

## 16. 비기능 요구사항

- TypeScript strict mode를 사용한다.
- Extension Host와 Webview 사이의 메시지는 런타임 검증을 거친다.
- 분석 파이프라인은 cancellation token을 지원한다.
- 긴 작업은 progress notification을 제공한다.
- 로그 레벨을 설정할 수 있어야 한다.
- 내부 graph format은 버전 필드를 가져야 한다.
- public API와 internal API를 구분한다.

## 17. 구현 마일스톤

### Milestone 1: Extension Skeleton

- VS Code extension scaffold
- Activity Bar sidebar view registration
- editor tab graph WebviewPanel
- settings schema
- Webview shell
- basic message protocol

### Milestone 2: Rust TypeScript/JavaScript Analysis

- file scanner
- Rust analyzer engine
- TypeScript/JavaScript parser boundary
- symbol extraction
- import/export resolution
- function and method call extraction
- JSON graph export

### Milestone 3: Visual Explorer MVP

- graph canvas
- progressive root-to-child expansion
- open source navigation from graph nodes

### Milestone 4: Rust Python Analysis

- Python parser boundary
- module import resolution
- function/class extraction
- call edge extraction
- Python fixture tests

### Milestone 5: Incremental Analysis and Cache

- file watcher
- content hash cache
- graph patch update
- clear cache sidebar action
- graph panel refresh after analysis
- performance telemetry without source code capture

### Milestone 6: Advanced Views

- class graph
- file dependency graph
- dependency matrix
- graph diff
- Mermaid/DOT/SVG/PNG export

## 18. Open Questions

- TypeScript/JavaScript Rust parser는 tree-sitter 기반으로 갈지, swc/oxc 계열 parser를 사용할지 결정해야 한다.
- Python Rust parser는 tree-sitter-python 기반으로 시작할지, RustPython parser 계열을 사용할지 결정해야 한다.
- multi-root workspace에서 graph를 workspace별로 분리할지 하나의 통합 graph로 제공할지 결정해야 한다.
- framework-specific convention 분석을 core에 둘지 plugin으로 분리할지 결정해야 한다.
- AI 요약 기능을 제품 범위에 포함할 경우 로컬/원격 처리 정책을 별도 정의해야 한다.

## 19. 완료 기준

MVP는 다음 조건을 만족하면 완료로 본다.

- 사용자가 Activity Bar의 Project Analyzer 사이드바를 열 수 있다.
- TypeScript/JavaScript 프로젝트를 분석하여 파일, 함수, 클래스, 호출 관계를 graph로 볼 수 있다.
- 그래프 노드를 더블 클릭하면 원본 코드 위치로 이동한다.
- 특정 함수의 caller/callee를 depth 제한과 함께 탐색할 수 있다.
- 분석 결과를 JSON으로 export할 수 있다.
- 파일 변경 후 재분석 결과가 Webview에 반영된다.
- 주요 분석 로직과 Webview message protocol에 테스트가 존재한다.
