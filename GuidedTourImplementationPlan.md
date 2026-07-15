# Project-Specific Guided Tour Implementation Plan

## 1. 문서 상태

- 상태: Phase 2 POC vertical slice 구현 완료, 제품 검토 대기
- 작성 기준일: 2026-07-14
- 대상 제품: Project Analyzer VS Code Extension
- 자동 검증: `npm run check`, Rust engine 79개, TypeScript unit 204개, package 7개 통과
- 관련 현재 계약: [`FunctionSpec.md`](./FunctionSpec.md)
- 관련 현재 구현: `projectReadingGuide`, `semanticFlow`, `architecturalLayers`, `projectLearningJourney`

이 문서는 자유 탐색 중심 Project Reading Plan을, 실제 프로젝트 근거를 따라 한 단계씩 가르치는
**Project-Specific Guided Tour**로 전환하기 위한 구현 계획이다. 2026-07-14 기준으로 아래의 POC
vertical slice가 적용되었으며, 나머지 phase와 acceptance criteria는 release 목표로 유지한다.

### 1.1 구현된 POC 범위

- 모든 normalized scope의 기존 Reading Guide 후보를 같은 comparator로 비교해 primary path 하나를
  자동 선택한다. 별도의 Guided Tour ranking은 만들지 않았다.
- Guided Tour domain은 primary-path result만 소비해 mission 하나와 stop 최대 5개 또는 honest
  unavailable 결과를 만든다.
- sidebar는 `Guide | Explore`로 분리되고 Guide가 기본이다. 기존 Project Reading Plan, Function
  Explorer, Structure, Analysis Details는 Explore에 그대로 남는다.
- 한 번에 current stop 하나만 표시한다. `Why now`, `Look for`, question, `Move on when`, layer
  evidence와 unknown을 함께 제공한다.
- POC protocol에는 concrete function **definition**이 있는 stop만 전달한다. 내부 function/path/scope
  identity와 절대경로는 opaque ID, snapshot-local source token, 안전한 상대 위치로 바뀐다.
- source-open은 graph/mission/stop/token/request tuple을 Host에서 검증한다. editor open 성공과 같은
  tuple의 acknowledgment 전에는 `Next stop`을 표시하지 않으며, 실패하면 같은 stop을 Retry한다.
- mission을 만들 수 없으면 임의 파일을 추천하지 않고 이유와 관찰 evidence를 보여준 뒤
  `Explore evidence`로 이동시킨다.

### 1.2 POC에서 의도적으로 미룬 범위

- decorator/framework evidence와 incoming callsite의 임의 source range 열기
- stop당 required anchor 2개와 anchor별 acknowledgment
- unavailable fallback anchor를 직접 여는 protocol CTA
- source-backed related test 탐색과 verification stop
- navigation 상태 저장, explain-back note, 이해도 또는 readiness 판정
- HTTP/GraphQL 외 실행 surface와 true multi-root workspace
- release용 integration fixture 전체와 수동 acceptance script 완료

따라서 이번 POC는 “자동 선택된 실제 함수 정의를 차례로 읽게 하는 흐름”을 검토하는 깊이다.
아래에서 decorator/callsite, multi-anchor, verification을 요구하는 항목은 후속 release gate이며 현재
구현 완료 주장에 포함하지 않는다.

## 2. 결정 요약

다음 제품 결정을 구현의 기준으로 삼는다.

1. 기본 화면은 scope와 추천 목록을 먼저 보여주지 않는다.
2. 분석이 끝나면 도구가 가장 근거가 좋은 실제 실행 흐름 하나를 자동으로 선택한다.
3. 사용자는 한 번에 하나의 mission과 하나의 current stop만 본다.
4. 각 stop은 `왜 보는가`, `어디를 여는가`, `무엇을 찾는가`, `무엇을 설명할 수 있어야 하는가`를 제공한다.
5. 자유 검색, scope 선택, 그래프, 전체 함수 목록은 **Explore** 영역에 보존한다.
6. current stop 이동과 source open은 학습 완료, 이해, 숙련으로 표현하지 않는다.
7. Guided Tour는 기존 architecture assessment를 소비할 뿐 layer나 business ownership을 새로 확정하지 않는다.
8. 근거가 부족하면 가짜 mission을 만들지 않고, tour를 만들지 못한 정확한 이유와 다음 조사 행동을 보여준다.

핵심 제품 계약은 다음 한 문장이다.

> 사용자가 선택지를 설계하게 하지 말고, 도구가 근거와 불확실성을 포함한 첫 번째 읽기 경로를 제시한다.

## 3. 현재 경험의 문제

현재 구현은 이전보다 더 정확한 정보는 제공하지만, 교육 책임을 사용자에게 넘긴다.

- 사용자가 먼저 scope를 골라야 한다.
- 최대 3개의 recommended entrypoint 중 하나를 다시 골라야 한다.
- path를 펼쳐도 각 함수에서 무엇을 확인해야 하는지 알려주지 않는다.
- `START HERE`, layer, confidence는 있지만 다음 행동과 관찰 질문이 연결되지 않는다.
- source를 연 뒤 무엇을 확인하면 되는지, 언제 다음 함수로 이동할지 기준이 없다.
- Project Learning Journey는 프로젝트별 수업이 아니라 정적인 방법론 설명에 가깝다.
- Guide와 Explore가 같은 화면에 섞여 있어 초보 사용자는 계속 결정을 내려야 한다.

따라서 현재 경험은 “지도와 범례를 제공하는 분석기”에는 가깝지만, “경로를 안내하는 교사”에는
미치지 못한다.

## 4. 목표와 비목표

### 4.1 목표

Guided Tour의 첫 release는 사용자가 다음 질문에 답하도록 돕는다.

- 이 동작을 무엇이 시작하는가?
- 첫 번째 concrete handler는 어디인가?
- 업무 결정을 내릴 가능성이 가장 높은 함수는 어디인가?
- 상태 또는 효과 경계는 어디인가?
- 각 함수에서 어떤 입력, 분기, 위임, 상태 변경을 확인해야 하는가?
- 정적 분석으로 아직 알 수 없는 것은 무엇인가?

목표 사용자 경험은 다음과 같다.

```text
Analyze Workspace
  -> 도구가 첫 mission 자동 선택
  -> 정확한 첫 source 함수 제시
  -> 현재 함수에서 볼 항목 최대 3개 제시
  -> source open 성공 확인
  -> 다음 함수와 그 이유 제시
  -> 경계 또는 근거 공백까지 이동
  -> 전체 흐름 explain-back checklist 제시
  -> 다른 tour 또는 자유 탐색으로 이동
```

### 4.2 비목표

첫 release에서는 다음을 구현하거나 주장하지 않는다.

- runtime frequency 또는 business criticality 자동 판정
- pure business logic 증명
- 프로젝트 목적, 소유자, 사용자 영향의 자동 생성
- 화면 방문을 `Confirmed`, `Demonstrated`, mastered, onboarding complete로 승격
- source 내용을 근거 없이 요약하는 생성형 설명
- 사용자 승인 없는 build, test, 실행 명령 수행
- HTTP/GraphQL 이외 모든 execution surface 동시 지원
- VS Code의 여러 workspace folder를 동시에 스캔하는 true multi-root 지원
- 관련 테스트가 실제 동작 전체를 보장한다고 주장

### 4.3 교육 프로세스

이 기능은 단순한 화면 순서가 아니라, 큰 코드베이스를 파악할 때 필요한 분석 절차를 제품 동작으로
고정한다. 모든 단계는 실제 프로젝트 evidence, 사용자의 확인 질문, 다음 단계의 종료 조건을 함께 가진다.

| 단계 | 도구가 책임지는 것 | 사용자가 확인하는 것 | 단계 결과 |
| --- | --- | --- | --- |
| Orient | 근거가 가장 완전한 mission 하나와 선택 이유 제시 | 왜 이 흐름이 첫 학습 예시인지 | trigger와 분석 한계 |
| Trace | entrypoint에서 concrete handler까지 mapping | framework가 실제 source에 연결되는 방식 | first source stop |
| Locate decisions | Domain/Application/Workflow Bridge 후보 표시 | 조건, 계산, orchestration 중 실제 책임 | decision focus와 unknown |
| Find effects | repository/model/side-effect 또는 resolution gap까지 안내 | 상태 변경과 외부 효과가 시작되는 위치 | effect boundary 또는 evidence gap |
| Verify | 현재는 source-open, 후속에는 source-backed test 연결 | 분석 설명과 코드가 일치하는지 | 관찰한 evidence와 남은 질문 |
| Explain back | trigger, decision, effect, unknown checklist 제공 | 자신의 말로 흐름을 재구성 | path explored 상태, 이해도 자동 판정 없음 |

즉, Guide는 `가설 제시 -> 근거 추적 -> source 확인 -> 불확실성 기록 -> 설명 재구성`을 반복한다.
Explore는 이 과정에서 가설을 넓히거나 반례를 찾을 때 쓰는 보조 조사면이다.

## 5. 제품 UX 계약

### 5.1 기본 정보 구조

기본 sidebar는 다음 순서를 사용한다.

```text
[Guide] [Explore]

Guide (default)
  Project Guided Tour
  Mission: Understand POST /orders
  Why this mission
  Goal

  Step 1 of 4 · Handler
  OrdersController.create
  Why now
  Look for
    - request input이 application 함수로 변환되는 지점
    - handler가 위임하는 다음 concrete callable
    - validation과 business decision의 경계
  Question before moving on
  [Open this function]

  After required source-anchor acknowledgments
  Move on when: explain which collaborator receives control next
  [Next stop]

  Evidence & unknowns [collapsed]
  Learning method and roadmap [collapsed]

Explore
  Existing scope map and alternative flows
  Explore Code Flows
  Browse Structure
  Analysis Details
```

초기 화면에서 scope card, 3개 flow 목록, source area 목록은 primary content가 아니다. 이 정보는
삭제하지 않고 `Explore` surface로 이동한다. Guide와 Explore를 세로로
동시에 펼쳐 놓지 않으며, 기본 surface는 항상 Guide다.

### 5.2 Mission 계약

한 mission은 하나의 source-backed 실행 흐름을 학습 단위로 만든다.

필수 표시 항목:

- 실제 entrypoint 또는 operation 이름
- 자동 선택 이유
- 사용자가 설명할 수 있어야 하는 최종 목표
- mapping 및 layer evidence의 신뢰도
- stop 1~5개와 navigable source anchor 최소 1개
- 알려진 boundary 또는 분석 공백
- purity, runtime importance, ownership 등 남은 unknown
- tour 종료 시 explain-back checklist

mission 제목은 실제 분석 label과 관찰 가능한 도달 범위를 함께 사용한다.

- complete path: `Trace <entrypoint> to its effect boundary`
- handler-only path: `Inspect the handler for <entrypoint>`
- resolution gap: `Investigate the unresolved handoff from <entrypoint>`

`Understand <entrypoint>`, `Critical flow`, `most important`, `core business flow`처럼 전체 이해나 근거 없는
중요도를 암시하는 표현은 사용하지 않는다.

현재 Reading Plan의 `START HERE`는 business candidate를 뜻하고 실행 시작점처럼 보일 수 있다.
Guided Tour에서는 이 표현을 사용하지 않는다.

- `Trigger`: route 또는 operation
- `First source stop`: concrete handler 또는 resolver
- `Decision focus`: Domain/Application/Workflow Bridge 후보
- `Effect boundary`: repository/model/side-effect

### 5.3 Stop 계약

한 stop은 한 가지 현재 행동만 제공한다.

| 필드 | 의미 |
| --- | --- |
| `Why now` | 앞 stop과 현재 stop의 관계 |
| `Open` | 아직 열지 않은 다음 required source anchor를 여는 단일 primary action |
| `Look for` | source에서 확인할 항목, 최대 3개 |
| `Question` | 다음으로 이동하기 전에 스스로 답할 질문 1개 |
| `Move on when` | 자동 채점 없이 다음 단계로 넘어갈 자기 점검 기준 1개 |
| `Evidence` | layer, mapping, topology 근거 |
| `Unknown` | 분석기가 증명하지 못한 내용 |

`Next stop`은 현재 stop을 이해했다고 판정하지 않는다. UI 문구는 `current stop`, `opened`, `next stop`을
사용하고 `completed`, `passed`, `mastered`를 사용하지 않는다.

한 stop의 primary action은 다음 상태 머신을 따른다. `Back`과 Explore 전환은 secondary navigation이며
primary action 개수에 포함하지 않는다.

```text
navigable + unopened anchor -> Open next exact required anchor
required anchors all opened -> Move on when 표시 + Next stop
open failed                 -> Retry same anchor
evidence-only stop          -> limitation과 확인 질문 표시 + Continue
```

`Next stop`을 누를 수 있다는 사실은 자기 점검 문장을 충족했다는 시스템 판정이 아니다. 다만 source가
있는 stop은 모든 required anchor의 open acknowledgment 전까지 Next를 primary action으로 제시하지 않는다.

### 5.4 Guide와 Explore 분리

- **Guide**: 도구가 하나의 경로를 선택하고 순서를 책임진다.
- **Explore**: 사용자가 scope, flow, function, graph를 자유롭게 선택한다.

기존 Project Reading Plan, Function Explorer, Browse Structure, Analysis Details는 Explore의
근거 도구로 유지한다. Guided Tour 때문에 complete inventory나 unresolved evidence를 삭제하지 않는다.
Guide에서 Explore로 전환할 때는 현재 mission의 scope와 가능한 경우 current function 문맥을 유지한다.

### 5.5 상태별 화면

| 상태 | 기본 화면 |
| --- | --- |
| graph 없음 | `Analyze Workspace`와 tour가 만들어지는 조건 설명 |
| 분석 중 | `Finding one source-backed tour...` 진행 상태 |
| mission 준비 | 한 mission과 current stop |
| entrypoint는 있으나 handler mapping 실패 | mapping gap과 정확한 다음 조사 행동 |
| 지원 entrypoint 없음 | exact fallback이 있으면 anchor와 확인 질문, 없으면 지원 한계와 CTA 없음 |
| traversal 제한 | 확인된 stop까지만 표시하고 limit 이후는 unknown |
| source open 실패 | opened 처리하지 않고 오류와 Retry 제공 |
| stale graph 응답 | 현재 화면에 적용하지 않고 새 snapshot mission 유지 |

## 6. Evidence와 교육 문구 정책

Guided Tour는 새 architecture classifier가 아니다. 다만 기존 Reading Guide와 공유하는 추천 rank는
“교육 경로의 완전성”을 첫 기준으로 명시적으로 개선한다. 이 변경은 두 화면이 같은 첫 경로를 고르도록
`projectReadingGuide`의 단일 comparator에만 구현한다.

```text
complete handler -> Domain candidate -> explicit boundary
  -> complete handler -> Application candidate -> explicit boundary
  -> complete handler -> Workflow Bridge -> explicit boundary
  -> complete handler -> explicit boundary without a decision candidate
  -> partial handler -> Domain/Application/Workflow Bridge candidate
  -> concrete handler only
  -> concrete handler followed by unresolved/traversal-limited evidence
```

같은 completeness tier에서는 exact entrypoint-handler mapping을 inferred mapping보다 먼저 고른 뒤,
candidate kind/confidence와 target distance를 비교한다.

완전한 경로가 없으면 mission 목표를 축소한다. 예를 들어 explicit boundary가 없으면 “효과 경계까지
이해”가 아니라 “decision owner 후보를 확인하고 관찰되지 않은 effect를 기록”하는 mission으로 만든다.

교육 문구는 고정된 rule template과 구조화된 분석 사실에서만 생성한다.

- Interface handler: 입력 변환, validation, 다음 collaborator를 확인하도록 안내한다.
- Application candidate: orchestration 순서, transaction/effect ordering, domain 위임 여부를 확인한다.
- Domain candidate: 조건, 계산, invariant, state transition을 확인하되 purity를 단정하지 않는다.
- Workflow Bridge: pass-through인지 decision owner인지 검증하게 하고 layer는 `Unclassified`로 유지한다.
- Data access/model: 읽고 쓰는 상태, transaction, error semantics를 확인한다.
- Side effect: payload, 실패 처리, retry/timeout 근거를 확인한다.
- External/unresolved: infrastructure로 확정하지 않고 non-local 또는 resolution gap으로 설명한다.
- Conflicted assessment: 가능한 layer와 충돌 근거를 보여주고 business target으로 승격하지 않는다.

함수 이름만으로 책임, 데이터 변경, 장애 처리, business rule을 만들어내지 않는다. 템플릿에 필요한
구조적 근거가 없으면 질문을 더 일반적으로 만들고 `Unknown`을 남긴다.

## 7. Mission 선택과 stop 구성

### 7.1 Primary mission 선택

기존 `ProjectReadingPath` ranking을 단일 source of truth로 사용한다. Guided Tour가 별도 중요도
점수를 만들지 않는다.

1. 모든 normalized scope에서 uniquely mapped flow 후보를 본다.
2. 각 후보는 기존 step/depth cap으로 bounded reading path를 transient projection한다. architecture target과
   boundary가 rank 입력이므로 선택 전에 path projection 자체를 생략하지 않는다.
3. 공유 comparator는 learning completeness, entrypoint-handler mapping confidence, candidate kind/confidence,
   target distance 순서로 비교한다. 이 개선은 기존 scope recommendation에도 함께 적용한다.
4. 그 뒤에는 기존 `compareSemanticFlows()`의 stable tie-break를 그대로 사용한다. Guided Tour 전용
   comparator는 만들지 않는다.
5. 전체 후보 목록과 scope source area는 materialize하지 않고 top-1 path와 exact diagnostics만 유지한다.
6. 현재 하나의 analyzed `ProjectGraph` 안에 있는 여러 normalized application scope를 한 후보 집합으로
   보고 하나만 고른다. 완전히 같은 rank는 stable scope identity와 기존 flow identity로 결정하며
   선택된 scope를 mission에 표시한다. 이는 VS Code true multi-root workspace 지원을 뜻하지 않는다.
7. primary mission 하나만 만든다. 다른 flow 탐색은 기존 bounded Explore 경로를 사용한다.

현재 `ProjectReadingGuideProjector`가 full host-side scope index를 소유하므로, 이 index를 다시
구축하지 않는다. projector의 public surface에
`projectPrimaryPath(): ProjectPrimaryReadingPathResult` API를 추가한다. 이 API는 mapped flow 후보를
한 번 순회하며 bounded transient path 하나와 현재 winner만 메모리에 유지한다. 모든 scope에
`projectScope()`를 호출해 source area까지 projection하거나, Guided Tour가 scope index와 path rank를
복제하는 구현은 허용하지 않는다.

### 7.2 Stop 구성

기본 stop 순서는 다음과 같다.

1. concrete handler 또는 resolver
2. Domain/Application/Workflow Bridge target
3. target과 boundary 사이의 필수 concrete collaborator
4. repository/model/side-effect boundary
5. Phase 3 이후 source-backed related test가 있을 때 verification stop

entrypoint route/operation은 mission trigger로 표시한다. 같은 함수가 여러 역할을 가지면 중복 stop을
제거한다. 각 navigable stop은 definition, framework mapping, 다음 callsite 중 최소 하나의 exact source
anchor를 가진다. `Look for`는 이 anchor를 참조해야 하며, 일반 질문만 있고 위치 근거가 없으면 해당
항목을 Unknown으로 낮춘다.

unresolved/external/traversal gap도 교육상 필요한 stop이 될 수 있다. exact callsite가 있으면 navigable
evidence-gap stop으로 만들고, 열 수 있는 위치가 전혀 없으면 evidence-only stop으로 만든다. ready
mission의 모든 stop이 concrete일 필요는 없지만, mission 전체에는 navigable stop이 최소 하나 있어야 한다.

stop 선택은 반복 기반 parent-chain 복원을 사용한다. 모든 traversal에는 `visited` set과 depth/
step limit을 둔다. 5개 상한 때문에 business target과 explicit boundary가 사라지지 않도록 기존
bounded learning chain 규칙을 재사용한다.

### 7.3 Mission을 만들 수 없는 경우

다음은 ready mission이 아니라 명시적 `unavailable` 결과다.

- 지원하는 execution surface evidence가 없음
- entrypoint evidence는 있지만 mapped concrete handler가 없음
- 후보 path에서 navigable source anchor를 가진 stop을 만들 수 없음

`ProjectPrimaryReadingPathResult`는 path가 없을 때도 supported entrypoint, mapped handler, mapping gap,
navigable anchor의 exact count와 가장 구체적인 fallback target을 반환한다. Guided Tour는 이 진단으로
`reason`, `observedEvidence`, `nextAction`을 만든다.

`nextAction`은 최대 하나만 제공한다. 실행 가능한 action이라면 단순한 `Browse` 링크가 아니라 반드시
`target`, `왜 여는가`, `무엇을 확인할 것인가`를 포함한다.

- mapping 실패: 해당 route/operation의 framework mapping 또는 source evidence anchor
- handler 이후 gap: 확인된 caller의 exact callsite anchor
- 여러 mapping gap: 해당 scope와 reason으로 prefiltered된 Explore mapping-gap view
- concrete target이 전혀 없음: 임의 파일을 추천하지 않고 지원 한계를 설명하는 `none`

traversal limit이 있어도 확인된 navigable stop이 있으면 mission은 유지하고 이후 구간을 Unknown으로
표시한다. snapshot 교체는 domain 실패가 아니라 host delivery의 stale-response 처리 대상이다.

## 8. 제안 도메인 모델

`projectReadingGuide`의 public primary-path 결과는 선택 성공 여부와 진단을 함께 보존한다.

```ts
type ProjectPrimaryReadingPathResult =
  | {
      status: "selected";
      path: ProjectPrimaryReadingPath;
      diagnostics: ProjectPrimaryReadingPathDiagnostics;
    }
  | {
      status: "unavailable";
      diagnostics: ProjectPrimaryReadingPathDiagnostics;
    };

type ProjectPrimaryReadingPath = Omit<ProjectReadingPath, "steps"> & {
  steps: readonly ProjectPrimaryReadingStep[];
};

type ProjectPrimaryReadingStep = ProjectReadingStep & {
  sourceAnchors: {
    definition?: ProjectReadingEvidenceAnchor;
    incomingCallsite?: ProjectReadingEvidenceAnchor;
    frameworkEvidence?: ProjectReadingEvidenceAnchor;
  };
};

type ProjectPrimaryReadingPathDiagnostics = {
  supportedEntrypointCount: number;
  mappedHandlerCount: number;
  mappingGapCount: number;
  eligiblePathCount: number;
  navigableAnchorCount: number;
  fallback: ProjectPrimaryReadingFallback;
};

type ProjectPrimaryReadingFallback =
  | {
      kind: "sourceEvidence";
      anchor: ProjectReadingEvidenceAnchor;
    }
  | {
      kind: "prefilteredMappingGaps";
      scopeId?: string;
      reason: "handlerNotMapped" | "resolutionGap";
    }
  | {
      kind: "none";
    };

type ProjectReadingEvidenceAnchor = {
  locationKind: "definition" | "callsite" | "frameworkEvidence";
  ownerFunctionId?: string;
  filePath: string;
  range: SourceRange;
  label: string;
};
```

`projectPrimaryReadingPath.ts`는 path를 transient projection할 때 graph node definition, incoming call edge의
callsite, framework unit의 mapping evidence를 step별로 함께 보존한다. 기존 `ProjectReadingStep`의 단일
definition location만으로 callsite를 재구성하지 않는다. Guided Tour는 이 public anchor만 골라 쓰며 raw
graph, edge, framework unit을 다시 조회하지 않는다.

새 Guided Tour 모델은 `src/insights/guidedTour/` 아래의 host-independent 순수 도메인으로 둔다. 이
모듈은 raw graph, semantic flow, architecture index를 다시 판정하지 않고
`ProjectPrimaryReadingPathResult`만 소비한다.
따라서 Reading Guide, Search, Guided Tour가 서로 다른 추천 결과를 만드는 경로를 차단한다.

```ts
type GuidedTourProjection =
  | {
      availability: "ready";
      mission: GuidedTourMission;
    }
  | {
      availability: "unavailable";
      unavailable: GuidedTourUnavailable;
    };

type GuidedTourMission = {
  id: string;
  scopeId: string;
  pathId: string;
  title: string;
  trigger: string;
  objective: string;
  selection: {
    evidenceKind:
      | "domainCandidate"
      | "applicationCandidate"
      | "workflowBridgeCandidate"
      | "mappedBoundaryPath"
      | "concreteHandlerInvestigation";
    reasons: string[];
    unknowns: string[];
  };
  stops: GuidedTourStop[];
  explainBack: string[];
  exitCriteria: string;
};

type GuidedTourStop = GuidedTourNavigableStop | GuidedTourEvidenceOnlyStop;

type GuidedTourStopBase = {
  id: string;
  order: number;
  label: string;
  whyNow: string;
  lookFor: GuidedTourLookFor[];
  question: string;
  moveOnWhen: string;
  evidence: string[];
  unknowns: string[];
  transitionToNext?: GuidedTourTransitionEvidence;
};

type GuidedTourNavigableStop = GuidedTourStopBase & {
  mode: "navigable";
  kind:
    | "handler"
    | "decisionCandidate"
    | "collaborator"
    | "boundary"
    | "evidenceGap"
    | "verification";
  architecture?: ProjectReadingArchitecture;
  anchors: readonly [GuidedTourSourceAnchor, ...GuidedTourSourceAnchor[]];
  primaryAnchorId: string;
  requiredAnchorIds: readonly [string, ...string[]];
};

type GuidedTourEvidenceOnlyStop = GuidedTourStopBase & {
  mode: "evidenceOnly";
  kind: "evidenceGap";
  architecture?: ProjectReadingArchitecture;
  anchors: readonly [];
};

type GuidedTourSourceAnchor = {
  id: string;
  locationKind: "definition" | "callsite" | "frameworkEvidence";
  ownerFunctionId?: string;
  filePath: string;
  range: SourceRange;
  label: string;
};

type GuidedTourLookFor = {
  instruction: string;
  anchorId: string;
  evidenceRuleId: string;
};

type GuidedTourTransitionEvidence = {
  explanation: string;
  kind: "frameworkMapping" | "call" | "boundary" | "analysisGap";
  anchorId?: string;
};

type GuidedTourUnavailable = {
  reason: "noSupportedEntrypoint" | "handlerNotMapped" | "noNavigableAnchor";
  explanation: string;
  observedEvidence: string[];
  nextAction:
    | {
        kind: "openAnchor";
        target: GuidedTourSourceAnchor;
        label: string;
        lookFor: string;
      }
    | {
        kind: "openPrefilteredExplore";
        destination: "mappingGaps" | "supportedEntrypoints";
        scopeId?: string;
        label: string;
        lookFor: string;
      }
    | {
        kind: "none";
        explanation: string;
      };
};
```

한 navigable stop의 anchor는 최대 2개로 제한한다. `primaryAnchorId`, `requiredAnchorIds`,
`Look for.anchorId`, `transitionToNext.anchorId`는 같은 stop의 anchor만 참조해야 하며 runtime validation으로
검사한다. MVP의 `Look for` anchor는 모두 required여야 한다. UI는 required 순서대로 하나씩 열고 모두
acknowledge된 뒤에만 Next를 primary action으로 바꾼다.

Domain identity와 path는 host 안에서만 사용한다. protocol adapter는 이를 opaque token과 안전한
relative label로 변환한다.

Webview navigation 상태는 분석 사실과 분리한다.

```ts
type GuidedTourBrowserState = {
  graphVersion: string;
  missionId: string;
  activeSurface: "guide" | "explore";
  currentStopIndex: number;
  sourceOpenedAnchorIds: string[];
};
```

이 상태에는 `understood`, `confirmed`, `demonstrated`, `complete` 필드를 추가하지 않는다.

## 9. 모듈 구조와 의존성

```text
src/
  insights/
    projectReadingGuide/
      index.ts                       # projectPrimaryPath public API 추가
      projectPrimaryReadingPath.ts   # graph-wide bounded top-1 selection
    guidedTour/
      index.ts
      types.ts
      stopProjector.ts
      stopInstructions.ts
      guidedTourProjector.ts
  application/
    projectInsights/
      index.ts
      projectInsightCache.ts
    sourcePresentation/
      index.ts
      safeSourceLabel.ts
    guidedTour/
      index.ts
      guidedTourPayload.ts
      guidedTourProjectionService.ts
  protocol/
    guidedTour.ts
    sourceNavigation.ts              # SourceAnchorToken 추가
  webview/
    sidebarShell/
      index.ts
      sidebarBrowserState.ts
      sidebarMessageRouter.ts
    guidedTour/
      index.ts
      guidedTourBrowserSource.ts
      guidedTourHostDelivery.ts
      guidedTourSourceAnchorRegistry.ts
      guidedTourStyles.ts
  test/
    unit/
      guidedTourProjector.test.ts
      guidedTourPayload.test.ts
      guidedTourHostDelivery.test.ts
      guidedTourSourceAnchorRegistry.test.ts
      guidedTourArchitecture.test.ts
```

의존성 방향:

```text
guidedTour insight
  -> projectReadingGuide
       -> architecturalLayers
       -> semanticFlow
       -> shared

application/guidedTour
  -> insights/guidedTour
  -> protocol/guidedTour

webview browser
  -> protocol/guidedTour shape only
```

중요한 구조 규칙:

- `guidedTour`는 VS Code API, Webview DOM, protocol payload에 의존하지 않는다.
- `guidedTour`는 `projectReadingGuide`의 public `ProjectPrimaryReadingPathResult`만 소비하며 raw graph,
  semantic flow, architecture index를 직접 참조하지 않는다.
- 현재 여러 insight를 소유하면서 `application/projectOverview/` 아래에 있는 `ProjectInsightCache`를
  `application/projectInsights/`로 이동한다. migration 동안 기존 index에는 임시 re-export만 둔다.
- cache는 framework semantics, semantic flow, architecture, reading path, token-free Guided Tour domain
  projection을 같은 immutable graph snapshot에서 한 번만 계산한다.
- random-salted `SourceAnchorToken`을 포함한 protocol payload는 Guided Tour anchor registry가 현재 snapshot에
  대해 활성화된 뒤 publish 시점에 생성한다. token-bearing payload를 graph cache에 저장하지 않는다.
- anchor registry는 token과 source range만 연결하지 않는다. 발급 시
  `(graphVersion, missionPayloadId, stopPayloadId, anchorPayloadId, token)` 전체를 host anchor에 결합하고,
  open request의 모든 identity가 같은 binding과 일치할 때만 VS Code navigation을 허용한다.
- Reading Guide payload의 relative-path/filename fallback/label bounding을
  `application/sourcePresentation/` public helper로 추출해 Guided Tour와 공유한다.
- mission title에 analyzer의 raw flow name을 그대로 전달하지 않는다. 고정된 title template과 bounded,
  safe entrypoint label을 사용한다.
- 현재 `explorerViewProvider.ts`가 800줄이므로 새 feature dispatch를 직접 누적하지 않는다.
  `guidedTourHostDelivery.ts`로 snapshot validation, source open ack, response publication을 분리한다.
- `explorerSidebarScript.ts`도 현재 799줄이므로 Guided Tour state와 message branch를 직접 누적하지 않는다.
  Phase 2 통합 전에 browser state 생성과 message routing을 `webview/sidebarShell/`로 추출한다.
- 파일이 800줄을 넘기기 전에 selector, instruction template, payload adapter를 책임별로 분리한다.

## 10. Protocol과 lifecycle

### 10.1 Initial delivery

현재 초기 payload는 개별 function을 보내지 않는다. Guided Tour에서는 이 정책을 의도적으로
다음처럼 변경한다.

- `graph/loaded`: 기존 고정 크기 shell 유지
- `project/guidedTourLoaded`: primary mission 1개, stop 최대 5개 즉시 전달
- `project/readingGuideLoaded`: scope summary 최대 3개를 Explore용으로 유지
- 다른 path, Function Index, Structure, Overview는 Explore에서 계속 lazy load

primary mission payload도 고정 상한이므로 large repository에서 Webview transfer가 graph 크기에
비례하지 않는다.

Host publication 순서는 다음으로 고정한다.

1. `SidebarGraphDelivery.activate()`로 snapshot version을 확정한다.
2. `GuidedTourSourceAnchorRegistry.activate()`로 같은 snapshot의 anchor-token namespace를 연다.
3. `ProjectInsightCache`에서 token-free Guided Tour projection을 읽는다.
4. payload adapter가 stop당 최대 2개의 definition/callsite/evidence anchor를 opaque token과 safe label로 바꾼다.
5. `withGuidedTourVersion()`으로 delivery version을 붙인 뒤 Webview에 게시한다.

이 순서 때문에 cache hit 여부와 무관하게 이전 snapshot의 token이 새 mission payload에 들어갈 수 없다.

### 10.2 제안 message

```ts
type GuidedTourRequest =
  | {
      type: "project/guidedTourOpenSource";
      payload: {
        graphVersion: string;
        missionId: GuidedTourMissionPayloadId;
        stopId: GuidedTourStopPayloadId;
        anchorId: GuidedTourSourceAnchorPayloadId;
        sourceAnchorToken: SourceAnchorToken;
        requestId: number;
      };
    };

type GuidedTourResponse =
  | { type: "project/guidedTourLoaded"; payload: GuidedTourPayload }
  | { type: "project/guidedTourSourceOpened"; payload: GuidedTourSourceOpenedPayload }
  | { type: "project/guidedTourSourceOpenFailed"; payload: GuidedTourSourceOpenFailurePayload };
```

source 방문은 Webview click 시점이 아니라 Extension Host가 snapshot과 anchor token을 검증하고 editor open을
성공시킨 ack 이후에만 기록한다. `requestId`, `graphVersion`, `missionId`, `stopId`, `anchorId`가 모두 현재
in-flight action과 일치해야 한다.

`GuidedTourSourceAnchorRegistry`의 host-only binding은 다음 의미를 가진다.

```ts
type GuidedTourSourceAnchorBinding = {
  graphVersion: string;
  missionId: GuidedTourMissionPayloadId;
  stopId: GuidedTourStopPayloadId;
  anchorId: GuidedTourSourceAnchorPayloadId;
  token: SourceAnchorToken;
  source: HostSourceAnchor;
};
```

registry는 payload 생성 중 이 tuple을 한 번에 발급하고, open 요청에서는 tuple 전체로 resolve한다.
다른 stop의 token, 다른 mission의 anchor ID, stale graphVersion을 섞은 요청은 source가 유효한 range여도
거부한다. Webview가 보낸 file path나 range로 navigation target을 재구성하지 않는다.

### 10.3 Privacy와 budget

- mission 최대 1개
- stop 최대 5개
- source anchor 최대 stop당 2개
- stop당 `lookFor` 최대 3개
- mission reason/unknown 최대 각 3개
- stop evidence/unknown 최대 각 2개
- serialized payload 목표: 16 KiB 미만
- analyzer function ID, call edge ID, absolute workspace path는 protocol에 포함하지 않음
- source navigation은 definition/callsite/framework evidence를 가리키는 snapshot-local opaque anchor token만 사용
- 외부 workspace source는 filename-only 안전 축약 사용
- 사용자가 향후 작성하는 explain-back note는 telemetry로 전송하지 않음

## 11. 단계별 구현 계획

### Phase 0. 계약과 baseline 고정

목표: 구현 전 현재와 목표 경험의 차이를 테스트 가능한 계약으로 고정한다.

작업:

- 이 계획과 `FunctionSpec.md`의 Guided Tour 목표 연결
- current UI baseline test에 scope/flow 선택이 필요한 현재 행동 명시
- `FunctionSpec.md`의 scope-first 요구와 테스트를 `현재 계약`, Guided Tour 요구를 `target 계약`으로 구분
- 구현 release에서 교체할 README/FunctionSpec/acceptance 항목의 migration checklist 작성
- target acceptance test 이름을 skipped/TODO로 만들지 않고 문서 체크리스트로 먼저 관리
- payload budget과 금지 표현 목록 확정

완료 조건:

- 목표 UX, 비목표, privacy, evidence 정책에 미결정 충돌이 없다.

### Phase 1. Guided Tour 순수 도메인

목표: 기존 분석 결과에서 deterministic primary mission과 stop instruction을 생성한다.

작업:

- `ProjectInsightCache`를 `application/projectInsights/`로 이동하고 임시 re-export로 호환성 유지
- `ProjectReadingGuideProjector.projectPrimaryPath()`와 `ProjectPrimaryReadingPathResult` 추가
- 공유 Reading Guide comparator에 learning-completeness tier와 mapping-confidence rank를 추가하고 기존
  scope 추천에도 동일 적용
- 모든 mapped flow의 bounded path를 하나씩 transient projection하는 고정 크기 top-1 구현
- path가 없어도 unavailable 원인을 구분할 exact diagnostics와 targeted fallback 보존
- primary step마다 definition, incoming callsite, framework mapping anchor를 graph projection 시 보존
- primary path 선택 과정에서 모든 scope guide/source area를 생성하지 않는 lifecycle 보장
- `src/insights/guidedTour/` public/internal/type 경계 생성
- `ProjectPrimaryReadingPathResult`만 입력받는 mission projection 구현
- navigable/evidence-only handler, decision candidate, boundary, gap stop 구성
- layer/role별 anchor-backed `lookFor`, question, `moveOnWhen`, transition template 구현
- ready/unavailable projection 구현
- 이동한 `ProjectInsightCache`에 token-free domain projection 추가

테스트:

- complete Domain > complete Application > complete Workflow Bridge > complete mapped path > partial path 선택
- 같은 completeness에서는 exact mapping의 Application path가 inferred mapping의 Domain path보다 우선
- incomplete path는 mission objective와 unknown을 실제 도달 범위로 축소
- 기존 scope recommendation의 첫 path와 project-wide primary comparator 결과 일치
- reversed input에서도 동일 mission/stop
- direct repository path, unresolved/external path의 과잉 business 추론 방지
- cycle, duplicate, converging branch, depth/step limit
- no entrypoint, unmapped handler, no navigable anchor의 exact unavailable reason
- concrete call은 target definition과 incoming callsite를 모두 보존하고 unresolved call은 callsite만 보존
- 10,000 flow에서도 bounded transient top-1과 정확한 candidate/diagnostic count
- primary path 선택만으로 scope source-area projection이 실행되지 않음
- insight가 application/protocol/webview/VS Code에 의존하지 않는 architecture test

완료 조건:

- 한 graph snapshot에서 primary mission이 정확히 0개 또는 1개다.
- mission이 있으면 navigable source anchor를 가진 stop이 최소 1개다.
- 모든 instruction은 rule ID로 설명 가능하다.

### Phase 2. Bounded protocol과 기본 Guided UI

목표: 분석 직후 사용자 선택 없이 첫 mission과 current stop을 보여준다.

작업:

- `protocol/guidedTour.ts`와 runtime validation 추가
- Reading Guide의 path/filename/label sanitization을 `application/sourcePresentation/`으로 추출
- safe label, opaque mission/stop ID, `SourceAnchorToken` payload adapter 구현
- snapshot-local `GuidedTourSourceAnchorRegistry`와 definition/callsite/evidence range validation 구현
- registry token을 graph/mission/stop/anchor payload identity 전체에 결합하고 tuple resolve 구현
- anchor registry activate 이후에만 token-bearing payload를 생성하는 publication 순서 고정
- `withGuidedTourVersion()` snapshot projection 추가
- `project/guidedTourLoaded` initial bounded delivery 추가
- `guidedTourHostDelivery.ts`로 stale guard와 source-open ack 분리
- 799줄인 `explorerSidebarScript.ts`의 browser state/message routing을 `sidebarShell/`로 먼저 추출
- 기본 HTML을 one mission/one current stop 구조로 변경
- accessible `Guide | Explore` tab surface를 추가하고 Guide를 기본 선택
- scope map과 기존 recommended flow 목록을 `Explore project`로 이동
- unopened/opened/failed/evidence-only primary-action state machine과 Back navigation 구현
- exact source anchor, `moveOnWhen`, evidence disclosure 구현
- unavailable fallback은 exact anchor 또는 prefiltered destination만 허용하고, 없으면 CTA를 만들지 않음
- source open 성공 ack 이후에만 source-opened anchor state 갱신
- 현재의 정적 orientation 3-action progress UI는 제거
- learning roadmap은 별도 collapsed disclosure로 유지
- 구현 release 직전에 FunctionSpec의 scope-first 기본 UI·테스트·acceptance를 target 계약으로 교체하고 README 갱신

테스트:

- initial UI에 primary mission 1개와 current stop 1개만 렌더링
- source open 전에는 source-opened anchor state가 증가하지 않음
- failed/stale open은 source-opened anchor state를 변경하지 않음
- required anchor 전체의 open acknowledgment 전에는 Next가 primary action으로 나타나지 않음
- callsite/decorator anchor가 정확한 source range를 열고 조작된 token/range는 거부
- stop/mission/anchor ID와 다른 token을 교차 조합한 요청은 Host에서 거부
- unavailable은 구체적인 target/look-for를 제공하거나 action 없음으로 정직하게 종료
- next/back은 mission 밖으로 벗어나지 않음
- keyboard activation, focus 이동, `aria-current="step"`, live-region 중복 안내 방지
- Guide/Explore는 tab semantics를 사용하고 동시에 두 surface를 렌더링하지 않음
- HTML/label은 `textContent`만 사용하고 untrusted source를 markup으로 삽입하지 않음
- 10,000 function fixture에서도 initial mission payload budget 유지
- `explorerViewProvider.ts`, `explorerSidebarScript.ts`와 새 구현 파일이 800줄을 넘지 않는 architecture test

완료 조건:

- 분석 후 첫 exact source anchor까지 사용자의 사전 선택이 0회다.
- 기본 화면에 동시에 보이는 primary CTA가 1개다.
- scope 또는 flow를 고르지 않고 첫 source를 열 수 있다.

이 단계가 첫 Guided Tour MVP release gate다.

### Phase 3. 관련 테스트와 verification stop

목표: source 읽기를 behavior evidence 확인으로 연결한다.

작업:

- `src/insights/testEvidence/` 또는 동등한 독립 모듈 설계
- test callable의 direct/indirect call, import/reference 근거로 mission function 연결
- name-only 유사성은 mapping 근거로 사용하지 않음
- 가장 강한 source-backed related test 최대 1개를 verification stop으로 추가
- 테스트가 없거나 mapping이 약하면 `No related test identified` unknown 표시
- test source open 후 확인할 정상/실패 expectation 질문 제공

테스트:

- direct test call > indirect call > import-only evidence 순위
- 같은 이름의 무관한 test false positive 방지
- test path precedence와 production function layer 분리
- related test가 없어도 mission 자체는 유지
- verification stop을 추가해도 5-stop cap과 target/boundary 보존

완료 조건:

- 근거가 있을 때만 related test가 표시된다.
- UI는 related test를 coverage proof로 표현하지 않는다.
- 이 완료 조건은 Phase 2 MVP와 분리된 Phase 3 release gate다.

### Phase 4. execution surface와 project context 확장

목표: HTTP/GraphQL 중심 tour를 실제 프로젝트의 다른 시작점으로 확장한다.

우선순위:

1. CLI command
2. scheduled job / worker
3. event or message handler
4. lifecycle/bootstrap
5. frontend user interaction

작업:

- transport 전용 `SemanticFlowEntrypointKind`를 무리하게 늘리기 전에 generic execution-surface 계약 설계
- 각 surface별 trigger 문구와 stop template 추가
- README, ADR, config 등 non-code evidence를 mission context에 연결하되 목적/ownership은 Confirmed로 자동 승격하지 않음
- 사용자 또는 repository 설정으로 preferred tour와 layer override를 선언하는 별도 evidence source 검토

완료 조건:

- 새 surface가 기존 HTTP/GraphQL ranking과 privacy/limit 계약을 깨지 않는다.
- 지원하지 않는 surface는 Unknown 또는 unavailable 결과로 명확히 남는다.

### Phase 5. explain-back와 demonstrated evidence

목표: 방문 기록을 넘어 사용자의 설명과 실행 증거를 별도 상태로 보관한다.

작업 전 필수 결정:

- note 저장 위치와 보존 기간
- workspace-local/private 기본값
- maintainer confirmation 주체와 audit trail
- 실행 명령 승인 및 결과 redaction 정책

가능한 후속 기능:

- mission-specific explain-back note
- 사용자가 직접 실행한 test/build 결과 첨부
- maintainer-confirmed correction과 analyzer rule feedback
- graph change 후 stale evidence review

이 단계 전까지 제품은 `Confirmed`와 `Demonstrated`를 프로젝트별 상태로 기록하지 않는다.

## 12. 테스트 전략과 release gate

### 12.1 Domain unit tests

- mission selection rank와 stable identity
- complete learning path 우선과 incomplete objective 축소
- unavailable diagnostic counts와 targeted fallback
- instruction template의 layer/role별 출력
- source anchor reference, transition evidence, `moveOnWhen`의 정합성
- business candidate와 contextual bridge의 분리
- boundary, unresolved, external, conflict, limit 처리
- stop deduplication과 cap
- 반복 기반 traversal과 visited guard

### 12.2 Protocol tests

- JSON-only payload
- absolute path와 analyzer identity 비노출
- source anchor token scope와 range validation
- graph/mission/stop/anchor/token tuple binding과 cross-stop token swap rejection
- anchor 최대 2개, required ordering, `Look for`/transition cross-reference validation
- budget과 omitted count
- malformed request runtime rejection
- stale graph/mission/request correlation

### 12.3 Webview tests

- one mission, one current stop, one primary CTA
- Guide가 Explore보다 먼저 렌더링
- scope/flow/function 목록 기본 접힘
- unopened/opened/failed/evidence-only action 상태 전이
- navigation/source-open state와 understanding 표현 분리
- accessible name, keyboard, focus, live region
- empty, unavailable, limited, failed 상태

### 12.4 Integration fixtures

Phase 2 MVP 최소 fixture:

1. controller -> application service -> domain policy -> repository
2. handler -> generic local workflow -> repository
3. handler -> unresolved/non-local call
4. route detected but handler mapping missing
5. HTTP/GraphQL entrypoint가 없는 source-only project
6. cycle과 depth limit을 포함한 large flow
7. decorator mapping과 다음 collaborator callsite range가 있는 anchored flow

Phase 3에서는 1번 fixture에 direct/indirect/import-only related test 변형을 추가한다.

### 12.5 수동 acceptance script

새 사용자가 fixture repository에서 다음을 수행한다.

1. Analyze Workspace 클릭
2. scope나 flow를 고르지 않고 첫 mission 확인
3. 첫 exact source anchor 열기
4. `Look for`가 가리키는 decorator/callsite/definition 확인
5. `Move on when`으로 자기 점검 후 Next stop으로 boundary까지 이동
6. explain-back checklist로 trigger, decision candidate, effect, unknown을 말하기
7. Explore에서 다른 flow와 전체 함수 검색 가능 여부 확인

Release 전에 이 script에서 “어디를 눌러야 할지 모르겠다”는 선택 지점이 없어야 한다.

## 13. Acceptance Criteria

Guided Tour MVP는 다음 조건을 모두 만족해야 한다.

1. eligible path가 있으면 primary mission 정확히 하나를 자동 선택하고, 없으면 unavailable 하나를 보여준다.
2. 사용자는 scope와 flow를 먼저 선택하지 않고 exact source anchor를 열 수 있다.
3. 기본 화면에는 current stop 하나와 primary action 하나만 있다.
4. mission은 실제 entrypoint label, 선택 이유, 목표, unknown을 보여준다.
5. 각 navigable stop은 exact anchor, `Why now`, anchor-backed `Look for` 최대 3개, question과
   `Move on when` 각 1개를 제공한다.
6. Domain/Application/Workflow Bridge의 서로 다른 confidence 의미를 보존한다.
7. Workflow Bridge는 계속 `Unclassified`이며 business ownership이나 purity proof가 아니다.
8. external/unresolved call은 infrastructure 또는 effect로 자동 분류되지 않는다.
9. source open 성공 ack 전에는 source-opened anchor 상태가 변경되지 않는다.
10. navigation/source-open 상태는 이해 완료 또는 readiness score로 표현되지 않는다.
11. 근거가 부족하면 ready mission 대신 unavailable 이유를 보여주고, 구체적인 target이 있을 때만
    target/look-for가 있는 next action 최대 하나를 제공한다.
12. 기존 scope map, Function Explorer, Structure, Analysis Details, full search는 Explore에서 유지된다.
13. initial Guided Tour payload는 repository 크기와 무관한 고정 상한을 갖는다.
14. protocol에는 absolute workspace path와 path-bearing analyzer identity가 없다.
15. cycle, shuffled input, stale response에서도 deterministic하고 안전하다.
16. keyboard만으로 source open, back, next, disclosures를 조작할 수 있다.
17. Phase 2 MVP는 related test 연결을 주장하지 않으며 verification stop은 Phase 3 gate로 남긴다.
18. 실행 trigger, first source stop, decision focus를 서로 다른 개념으로 표시한다.
19. shared rank는 complete handler-to-decision-to-boundary path를 partial path보다 먼저 고른다.
20. required source anchor 전체의 acknowledgment 전에는 Next가 primary action이 아니며,
    evidence-only stop만 Continue를 쓴다.
21. 구현 release 시 FunctionSpec과 README의 scope-first 기본 계약을 Guide-first target 계약으로 교체한다.
22. Host는 graph/mission/stop/anchor/token 소속이 모두 일치하는 source-open 요청만 실행한다.

## 14. 위험과 완화책

| 위험 | 완화책 |
| --- | --- |
| 잘못된 mission이 첫인상을 지배 | 선택 이유와 confidence 표시, Explore 전환 제공 |
| 템플릿이 또 다른 모의 온보딩처럼 보임 | 실제 definition/decorator/callsite anchor와 evidence를 모든 문구에 연결 |
| 질문이 source 내용을 안다고 가장함 | anchor-backed 구조 질문만 사용하고 근거가 없으면 Unknown 유지 |
| Guide가 complete inventory를 숨김 | Explore, search, diagnostics, export를 그대로 유지 |
| 초기 payload가 다시 커짐 | mission 1, stop 5, prompt/evidence 고정 cap |
| source click만으로 학습 완료처럼 보임 | source-opened 상태만 ack 이후 기록하고 완료 점수는 만들지 않음 |
| 새 로직이 기존 rank와 충돌 | shared Reading Guide comparator 하나를 개선하고 두 UI가 재사용 |
| provider와 Webview 파일 비대화 | host delivery 분리와 sidebar state/message router 선행 추출 |
| 다른 stop의 token을 섞은 source-open 요청 | registry가 graph/mission/stop/anchor/token tuple 전체를 검증 |
| 관련 test 오탐 | name-only mapping 금지, confidence와 unknown 표시 |

## 15. 확정 결정과 후속 결정

### 15.1 이번 계획에서 확정

- 기본 화면은 Guided Tour다.
- primary mission은 자동 선택한다.
- scope/flow 목록은 secondary Explore다.
- Guided Tour는 생성형 source 요약을 사용하지 않는다.
- learning progress와 navigation/source-open state를 분리한다.
- external call만으로 effect/infrastructure를 추론하지 않는다.
- mission payload는 초기 전달하되 고정 상한을 둔다.
- MVP는 HTTP/GraphQL의 기존 evidence를 우선 재사용한다.
- complete learning path를 partial path보다 먼저 고르는 shared comparator를 사용한다.
- 각 navigable stop은 exact definition/decorator/callsite anchor와 `Move on when`을 가진다.
- 단일 analyzed graph 안의 여러 application scope에서는 project-wide top-1 하나를 고른다.

### 15.2 구현 전 또는 후속 phase에서 결정

- 후속 alternative mission 기능을 추가할지, 추가한다면 same-scope/project-wide 중 무엇으로 할지
- navigation/source-open 상태를 session memory, `workspaceState`, 별도 storage 중 어디에 보관할지
- explain-back note를 저장할지와 privacy 기본값
- 사용자 layer/tour correction을 analyzer rule로 승격하는 승인 절차
- 실제 test/build command 실행 UX와 권한 모델
- VS Code true multi-root workspace의 scan/cache/snapshot/mission 선택 정책

## 16. 최종 완료 정의

이 계획은 UI에 새 카드 하나를 추가하는 것으로 완료되지 않는다. 다음 결과가 함께 충족되어야 한다.

- 사용자가 결정하지 않아도 첫 실제 source 경로가 나타난다.
- 각 navigable stop에 exact source anchor와 구체적인 관찰 질문이 있다.
- 단계 이동 이유가 앞뒤 함수 관계로 설명된다.
- 분석기가 모르는 사실은 Unknown으로 남는다.
- 자유 탐색과 complete inventory는 손실되지 않는다.
- source open과 navigation state가 snapshot-safe하다.
- large repository에서도 초기 payload와 DOM이 bounded다.
- unit, protocol, Webview, fixture, architecture test가 모두 통과한다.
- `FunctionSpec.md`와 `README.md`가 실제 구현 상태에 맞게 함께 갱신된다.
