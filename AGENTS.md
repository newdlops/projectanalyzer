# 작업 지침

이 문서는 Project Analyzer VS Code Extension을 구현할 때 따라야 할 공통 작업 지침이다. 모든 코드 변경은 아래 원칙을 우선 적용한다.

## 1. 모듈화와 구조화

- 기능은 역할별로 명확히 분리한다.
- 새 기능을 추가할 때는 해당 기능을 대표하는 폴더를 만들고, 그 안에서 public API, 내부 구현, 타입, 테스트를 구분한다.
- 한 폴더가 여러 책임을 동시에 갖지 않도록 한다.
- 서로 다른 기능 모듈이 직접 내부 파일을 깊게 참조하지 않게 한다.
- 기능 간 연동은 명시적인 interface, service, adapter, registry, message protocol을 통해 수행한다.
- 순환 의존성은 만들지 않는다.
- 재귀 호출 구조는 기본적으로 사용하지 않는다. 트리/그래프 탐색이 필요한 경우 명시적인 queue, stack, visited set 기반 반복 구조를 우선 사용한다.
- 재귀가 불가피한 경우에는 종료 조건, 최대 depth, cycle guard를 주석과 테스트로 명확히 보장해야 한다.

## 2. 재사용성과 추상화

- 중복되는 로직은 helper, utility, service, adapter, abstraction으로 분리한다.
- 추상화는 실제 중복 제거, 의존성 역전, 테스트 편의성, 언어별 analyzer 확장성 중 하나 이상의 명확한 이점이 있을 때 도입한다.
- 과도하게 일반적인 추상화는 피한다. 현재 요구사항과 가까운 미래의 확장 지점에 맞춘다.
- 언어별 분석 로직은 공통 analyzer pipeline과 분리한다.
- VS Code API, 파일 시스템, Webview message, graph storage 같은 외부 경계는 adapter 계층으로 감싼다.
- 순수 로직은 가능한 한 framework와 extension host에 의존하지 않게 작성한다.
- 타입과 인터페이스를 먼저 정의하여 모듈 간 계약을 명확히 한다.

## 3. 파일 길이와 가독성

- 구현 소스 파일은 사람이 읽기 쉬운 크기로 유지한다.
- 일반적인 구현 파일은 500~800줄 범위 안에서 관리하는 것을 목표로 한다.
- 800줄을 넘기기 전에 책임 단위로 파일을 분리한다.
- 500줄보다 짧더라도 역할이 명확한 entrypoint, type definition, adapter, test helper, 설정 파일은 억지로 늘리지 않는다.
- 한 파일 안에 여러 큰 책임이 섞이면 줄 수가 800줄 미만이어도 분리한다.
- Markdown 문서는 줄 수 제한을 적용하지 않는다.
- 생성 파일, lock 파일, 번들 파일에는 이 기준을 적용하지 않는다.

## 4. 주석 규칙

- 각 파일 상단에는 파일의 책임과 포함된 주요 개념을 설명하는 주석을 둔다.
- 주요 함수에는 무엇을 처리하는지, 입력/출력의 의미, 중요한 side effect를 설명하는 주석을 둔다.
- 주요 클래스에는 책임, lifecycle, 협력 객체를 설명하는 주석을 둔다.
- 주요 모듈에는 public surface와 내부 구현 경계를 설명하는 주석을 둔다.
- 중요한 변수에는 값의 의미, 단위, 불변 조건, cache key 여부, graph identity 여부 등을 설명하는 주석을 둔다.
- 단순히 코드 그대로를 반복하는 주석은 작성하지 않는다.
- 복잡한 제어 흐름, fallback, 성능 최적화, cache invalidation, graph traversal 조건에는 판단 근거를 주석으로 남긴다.

## 5. 폴더 구조 원칙

기능별 폴더는 다음 형태를 기본으로 한다.

```text
src/
  extension/
  analyzer/
    core/
    languages/
      typescript/
      javascript/
      python/
  graph/
  webview/
  protocol/
  storage/
  vscode/
  shared/
  test/
```

- `extension/`: VS Code extension activation, command registration, lifecycle
- `analyzer/`: 정적 분석 파이프라인과 언어별 analyzer
- `graph/`: graph node, edge, query, diff, traversal
- `webview/`: Visual Explorer frontend
- `protocol/`: Extension Host와 Webview 사이의 typed message protocol
- `storage/`: cache, persisted graph, workspace storage
- `vscode/`: VS Code API adapter
- `shared/`: 환경과 무관한 공통 타입, utility
- `test/`: fixture, integration, performance test

폴더 구조는 구현이 진행되며 조정할 수 있지만, 책임 경계가 흐려지는 방향으로 변경해서는 안 된다.

## 6. 의존성 방향

기본 의존성 방향은 아래를 따른다.

```text
extension -> analyzer -> graph -> shared
extension -> storage -> shared
extension -> protocol -> shared
webview -> protocol -> shared
vscode -> shared
```

- `shared`는 상위 모듈에 의존하지 않는다.
- `graph`는 `extension`, `webview`, `vscode`에 의존하지 않는다.
- `analyzer`는 Webview 구현에 의존하지 않는다.
- `webview`는 파일 시스템과 VS Code API에 직접 접근하지 않는다.
- 양방향 의존이 필요해 보이면 interface를 분리하고 의존성 방향을 다시 설계한다.

## 7. 그래프 탐색 구현 규칙

- caller/callee 탐색, dependency traversal, cycle detection은 반복 기반 알고리즘으로 구현한다.
- 모든 graph traversal에는 visited set을 둔다.
- 사용자 설정 또는 호출 인자에서 최대 depth를 받을 수 있어야 한다.
- 대형 그래프에서는 전체 탐색보다 lazy expansion과 subgraph query를 우선한다.
- unresolved edge와 inferred edge는 exact edge와 섞어 처리하지 않고 confidence를 보존한다.

## 8. 테스트 기준

- 공통 로직은 unit test를 작성한다.
- analyzer는 fixture 기반 snapshot test를 작성한다.
- graph traversal은 cycle, duplicate edge, depth limit, unresolved node case를 포함한다.
- Webview protocol은 runtime validation test를 작성한다.
- 파일 길이, 모듈 경계, 순환 의존성은 가능한 경우 lint 또는 architecture test로 검증한다.

## 9. 문서 작성 기준

- Markdown 문서는 줄 수 제한 없이 필요한 만큼 자세히 작성한다.
- 설계 결정, tradeoff, 구현 제약은 문서에 남긴다.
- 새로운 주요 모듈이 추가되면 해당 모듈의 목적과 public API를 문서화한다.
- SPEC 변경이 필요한 기능 변경은 구현과 함께 SPEC도 갱신한다.

## 10. 변경 전 점검

코드 변경 전 다음을 확인한다.

- 이 변경이 어느 기능 폴더에 속하는가?
- 새 추상화가 필요한가, 아니면 기존 interface를 확장하면 되는가?
- 순환 의존성 또는 재귀 호출이 생기지 않는가?
- 파일 길이가 읽기 쉬운 범위를 유지하는가?
- public API와 internal implementation이 구분되는가?
- 테스트 또는 fixture가 필요한 변경인가?

## 11. 완료 전 점검

작업 완료 전 다음을 확인한다.

- 관련 테스트를 실행했거나, 실행하지 못한 이유를 기록했다.
- 새 파일과 주요 함수에 설명 주석이 있다.
- 중요한 변수의 의미가 코드 또는 주석으로 명확하다.
- 불필요한 중복이 남아 있지 않다.
- 모듈 경계가 유지된다.
- Markdown 문서는 필요한 내용을 충분히 담고 있다.
