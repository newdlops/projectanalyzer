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

Analyzer Core는 언어 독립적인 분석 파이프라인이다.

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
    fileCount: number;
    symbolCount: number;
    edgeCount: number;
  };
};
```

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

## 10. VS Code Commands

확장은 다음 명령을 제공한다.

- `projectAnalyzer.openExplorer`
- `projectAnalyzer.analyzeWorkspace`
- `projectAnalyzer.analyzeCurrentFile`
- `projectAnalyzer.showCallGraph`
- `projectAnalyzer.showFileGraph`
- `projectAnalyzer.showClassGraph`
- `projectAnalyzer.findCallers`
- `projectAnalyzer.findCallees`
- `projectAnalyzer.exportGraph`
- `projectAnalyzer.clearCache`
- `projectAnalyzer.cancelAnalysis`

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
- command registration
- settings schema
- Webview shell
- basic message protocol

### Milestone 2: TypeScript/JavaScript Analysis

- file scanner
- TypeScript compiler API 기반 parser
- symbol extraction
- import/export resolution
- function and method call extraction
- JSON graph export

### Milestone 3: Visual Explorer MVP

- graph canvas
- search
- filter
- node detail panel
- open source navigation
- call depth expansion

### Milestone 4: Python Analysis

- Python parser integration
- module import resolution
- function/class extraction
- call edge extraction
- Python fixture tests

### Milestone 5: Incremental Analysis and Cache

- file watcher
- content hash cache
- graph patch update
- clear cache command
- performance telemetry without source code capture

### Milestone 6: Advanced Views

- class graph
- file dependency graph
- dependency matrix
- graph diff
- Mermaid/DOT/SVG/PNG export

## 18. Open Questions

- TypeScript 분석은 VS Code language service를 사용할지, 별도 TypeScript program을 생성할지 결정해야 한다.
- Python 분석은 tree-sitter 기반으로 시작할지, Pyright/Pylance 정보를 활용할지 결정해야 한다.
- multi-root workspace에서 graph를 workspace별로 분리할지 하나의 통합 graph로 제공할지 결정해야 한다.
- framework-specific convention 분석을 core에 둘지 plugin으로 분리할지 결정해야 한다.
- AI 요약 기능을 제품 범위에 포함할 경우 로컬/원격 처리 정책을 별도 정의해야 한다.

## 19. 완료 기준

MVP는 다음 조건을 만족하면 완료로 본다.

- 사용자가 VS Code 명령으로 Project Analyzer Explorer를 열 수 있다.
- TypeScript/JavaScript 프로젝트를 분석하여 파일, 함수, 클래스, 호출 관계를 graph로 볼 수 있다.
- 그래프 노드를 더블 클릭하면 원본 코드 위치로 이동한다.
- 특정 함수의 caller/callee를 depth 제한과 함께 탐색할 수 있다.
- 분석 결과를 JSON으로 export할 수 있다.
- 파일 변경 후 재분석 결과가 Webview에 반영된다.
- 주요 분석 로직과 Webview message protocol에 테스트가 존재한다.
