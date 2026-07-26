# Static Function Tutor 구현 계획

> 상태 변경 (2026-07-26): 이 계획의 정적 입력·시나리오 기반 구현은 완료되었다.
> 사용자 경험은 `function-tutor-codebase-understanding-upgrade-plan.md`의 Function
> Guide로 대체되었으며, 이 문서는 Static Input Cases의 안전 계약을 설명하는
> historical baseline으로 보존한다.

> 상태: 구현 전 확정 계획
> 대상 구현자: Terra High 또는 동등한 코딩 에이전트
> 대상 제품: Project Analyzer: Code Flow VS Code Extension
> 작성 목적: 추가 설계 없이 이 문서의 순서와 계약만으로 구현할 수 있게 한다.
> 구현 범위: 정적 입력 추론, bounded 시나리오 생성, 분기·상태 변화 추론,
> 결정론적 설명 생성, Tutor UI, 근거 표시, 테스트와 문서화
> 명시적 제외: LLM, 외부 API, 사용자 코드 실행, 런타임 계측, 임의 코드 평가

---

## 0. 이 문서의 사용법

이 문서는 아이디어 제안서가 아니라 구현 명세다. 구현자는 아래 규칙을 따른다.

1. 이 문서의 “확정 결정”을 다시 설계하지 않는다.
2. 단계별 완료 조건을 통과하기 전 다음 단계의 UI를 넓게 구현하지 않는다.
3. 각 단계는 컴파일되고 관련 단위 테스트가 통과하는 수직 슬라이스로 남긴다.
4. analyzer, application projection, protocol, Webview 경계를 우회하지 않는다.
5. UI 문자열이나 이미 렌더링된 label을 분석 입력으로 다시 파싱하지 않는다.
6. 정적 분석이 알 수 없는 값은 `unknown`으로 보존한다. 보기 좋은 결과를 위해
   값을 만들어 내지 않는다.
7. 그래프·경로·구문 탐색은 queue/stack, `visited`, depth/budget을 쓰는 반복
   알고리즘으로 구현한다. 재귀는 사용하지 않는다.
8. 일반 구현 파일은 800줄을 넘기지 않는다. 650줄에 도달하면 분리 여부를 먼저
   점검하고 800줄 전에 책임 단위로 분리한다.
9. 새 파일 상단과 주요 public 함수·클래스에는 AGENTS.md의 주석 규칙을 따른다.
10. 문서 마지막의 Definition of Done을 모두 만족해야 완료로 보고한다.

---

## 1. 한 문장 제품 정의

**Static Function Tutor는 함수의 선언 타입·기본값·조건식·정적 호출 문맥에서
대표 입력을 추론하고, 그 입력으로 가능한 분기와 값 변화를 bounded 정적
시나리오로 계산하여 표와 짧은 결정론적 설명으로 보여주는 로컬 코드 읽기
기능이다.**

Tutor는 사용자의 코드를 실행하지 않는다. 실제 실행을 관찰하지 않는다. LLM이나
네트워크를 호출하지 않는다. 따라서 화면의 모든 결과는 “실행 결과”가 아니라
“근거가 있는 가능한 정적 경로”다.

---

## 2. 확정 제품 결정

### 2.1 사용자에게 보이는 이름

- 상위 진입점: `Tutor`
- 패널 제목: `Static Tutor`
- 시나리오 목록 제목: `Possible Scenarios`
- 값 변화 상세 제목: `Estimated Value Changes`
- 근거 상세 제목: `Why These Inputs?`
- 기존 Scenario editor로 복사하는 버튼: `Use These Inputs`
- 분석 한계 상세 제목: `Unknowns & Limits`

한국어 locale을 별도로 추가하는 작업은 이번 범위가 아니다. 기존 UI가 영어
문구를 사용하므로 새 문구도 영어로 구현한다. 향후 locale 파일이 도입되면
문자열을 옮길 수 있도록 한 파일에서 생성한다.

### 2.2 Tutor의 정보 구조

Tutor는 기존 `Flow`, `Values`, `Calls`, `Effects` 의미 렌즈에 추가되는 다섯 번째
렌즈가 아니다.

- 기존 렌즈는 “현재 그래프를 어떤 의미로 강조할지”를 결정한다.
- Tutor는 “여러 추론 입력과 가능한 결과를 비교하며 읽는 방법”을 제공한다.
- 따라서 Tutor는 Inspector의 별도 읽기 모드로 열린다.
- Tutor를 열어도 현재 렌즈와 graph layout은 바뀌지 않는다.
- Tutor 시나리오 행을 선택하면 graph에 임시 attention projection만 적용한다.
- Tutor를 닫거나 preview를 해제하면 기존 렌즈·선택·branch choice를 그대로
  복원한다.

### 2.3 계산 시점

- 선언·호출 문맥 수집과 시나리오 seed 생성은 Extension Host에서 bounded하게
  수행한다.
- Webview는 payload를 받은 즉시 모든 시나리오를 계산하지 않는다.
- 사용자가 Tutor를 처음 열 때 Webview의 안전한 정적 interpreter가 시나리오를
  계산한다.
- 계산 결과는 현재 detail session과 tutor fingerprint를 key로 캐시한다.
- 새로운 root function detail이 도착하면 이전 계산을 취소하고 cache를 버린다.
- 같은 함수에서 렌즈·선택만 바뀌면 결과를 재계산하지 않는다.

### 2.4 기존 Scenario editor와의 관계

- 기존 Values 렌즈의 수동 Scenario 입력은 그대로 유지한다.
- Tutor preview는 수동 Scenario 값을 덮어쓰지 않는다.
- `Use These Inputs`를 눌렀을 때만 선택된 Tutor 입력 중 표현 가능한 값을 기존
  Scenario editor에 복사한다.
- 복사 후 Values 렌즈로 전환하고 기존 value preview를 실행한다.
- `unknown`, rest tuple, 표현 불가능한 symbol 값은 복사하지 않고 해당 매개변수
  옆에 이유를 알린다.
- 이 동작은 Webview 로컬 상태 변경이며 Host message를 보내지 않는다.

### 2.5 `eval`과 embedded code

- Tutor는 기존 Function Logic embedded-code expansion 결과를 소비한다.
- `eval` 문자열 자체를 Tutor가 새로 실행하거나 평가하지 않는다.
- analyzer가 이미 안전하게 정적 발견한 immediate embedded program만 동일한
  시나리오 경로에 포함한다.
- `defines` 또는 `deferred` embedded program은 현재 호출 경로에 실행된 것으로
  섞지 않는다.
- 선택된 시나리오가 immediate embedded block을 지나면 기존 embedded node와
  해당 내부 block을 graph에서 함께 강조한다.
- embedded code 내부의 조건과 값 변화에도 일반 block과 동일한 step 번호,
  certainty, source evidence를 제공한다.
- embedded 경계를 해석할 수 없으면 `unknown` gap을 남기고 외부 block 이후의
  가능한 경로를 과도하게 확정하지 않는다.

### 2.6 지원 언어 완료 기준

기존 Function Logic 지원 언어를 모두 adapter surface에 연결한다.

- TypeScript / JavaScript / JSX / TSX
- Python
- Java
- F#
- OCaml
- Elixir

지원 수준은 언어별 문법 능력에 따라 다를 수 있으나, 기능 전체를 완료했다고
보고하려면 모든 언어가 다음 중 하나를 명시적으로 반환해야 한다.

1. 타입·기본값·조건·호출 인자를 근거로 한 시나리오
2. 지원 가능한 일부 근거만 쓴 partial 시나리오와 구체적인 gap
3. 안전한 추론 근거가 없다는 empty 상태와 구체적인 gap

adapter가 없어서 조용히 TypeScript parser로 fallback하는 동작은 금지한다.

---

## 3. 목표와 비목표

### 3.1 목표

1. 사용자가 함수만 선택해도 별도 입력 없이 대표 시나리오를 볼 수 있다.
2. 각 시나리오의 입력이 어디서 왔는지 타입·기본값·호출 위치·조건 근거로
   확인할 수 있다.
3. 여러 분기 결과를 Cartesian product 폭발 없이 대표 사례로 비교할 수 있다.
4. 선택된 시나리오에서 값이 `before → after`로 어떻게 변하는지 순서형 표로
   읽을 수 있다.
5. return, throw, effect, unresolved call, embedded boundary를 가능한 경로의
   결과로 구분할 수 있다.
6. 짧은 description만 읽어도 “어떤 입력에서 어느 분기로 들어가 무엇이
   바뀌고 무엇을 반환할 수 있는지” 대략 파악할 수 있다.
7. 모든 추론에 certainty와 source evidence를 보존한다.
8. 대형 함수·많은 호출자·loop·unknown 조건에서도 UI를 멈추지 않고 bounded
   결과를 반환한다.
9. keyboard, screen reader, reduced motion, forced colors에서 동일한 정보를
   사용할 수 있다.
10. Tutor 코드 경로에 LLM·network·source execution이 없음을 architecture
    test로 검증한다.

### 3.2 비목표

- 실제 런타임 값이나 branch frequency 관찰
- test case 자동 생성·실행
- symbolic execution의 완전성 또는 formal verification
- interprocedural heap analysis
- 외부 라이브러리 함수 본문 실행 또는 요약
- getter, proxy, decorator, macro, reflection의 런타임 의미 재현
- async scheduling, event loop, thread interleaving 재현
- I/O, database, filesystem, network 결과 추측
- `eval`, `new Function`, VM, subprocess로 사용자 코드 실행
- LLM 설명, 임베딩, API 요청, 토큰 소비
- 자연어 질문·답변 chat UI
- path coverage 100% 보장
- Tutor를 기본 graph UI보다 우선하는 새 화면으로 재설계

---

## 4. 사용자 성공 기준

### 4.1 주 사용자 흐름

1. 사용자가 함수 detail을 연다.
2. 기존 graph와 Inspector에서 `Tutor`를 누른다.
3. “타입·기본값·호출 문맥으로 만든 가능한 정적 예”라는 범위를 한 줄로 확인한다.
4. 시나리오 표에서 입력·가능한 경로·변화 수·결과·확실성을 비교한다.
5. 한 행을 선택한다.
6. graph에서 그 시나리오가 지나가는 block과 edge만 attention을 받는다.
7. 아래 값 변화 표에서 step별 `before → after`를 읽는다.
8. 필요한 경우 `Why These Inputs?`에서 입력 근거를 열어 source를 확인한다.
9. 더 자세히 추적하려면 `Use These Inputs`로 기존 Values scenario에 복사한다.

### 4.2 성공을 증명하는 관찰 가능한 행동

브라우저/VS Code QA에서 다음이 가능해야 한다.

- 10초 이내에 첫 시나리오의 입력과 결과를 말할 수 있다.
- 서로 다른 두 시나리오가 어느 branch에서 달라지는지 표와 graph에서 찾을 수
  있다.
- exact callsite input과 inferred boundary input을 시각적·텍스트로 구분할 수
  있다.
- 값 변화가 없는 시나리오와 값이 실제로 바뀌는 시나리오를 구분할 수 있다.
- unknown이 생긴 이유를 `Unknowns & Limits`에서 source-backed 문구로 찾을 수
  있다.
- Tutor가 코드를 실행하지 않았다는 사실을 패널의 고정 안내에서 확인할 수 있다.

정식 사용자 연구 수치나 WCAG 적합성 등급은 현재 근거가 없으므로 제품 문구에
꾸며 넣지 않는다.

---

## 5. 기존 구현과의 결합 지점

구현 전 아래 기존 계약을 보존한다.

### 5.1 analyzer

- `src/analyzer/functionLogic/types.ts`
  - `FunctionLogicAnalysis`
  - `FunctionLogicBlock`
  - `FunctionLogicCondition`
  - `FunctionLogicEdge`
  - `FunctionLogicValueChange`
- `src/analyzer/functionLogic/dataFlow/`
  - parameter/local/constant binding
  - definition/read/write/sink flow
- `src/analyzer/functionLogic/embeddedCode/`
  - immediate/defines/deferred boundary
- 언어별 Function Logic analyzer

Tutor analyzer는 위 타입을 소비하지만 Function Logic analyzer가 Tutor UI나
protocol에 의존하게 만들지 않는다.

### 5.2 application projection

- `src/application/codeFlow/codeFlowFunctionLogicProjection.ts`
- `src/application/codeFlow/conditionCases/`

기존 condition case projection은 최대 6 columns, 32 rows의 bounded 요약이다.
Tutor의 seed 생성은 이를 UI 문자열로 읽지 않고 analyzer의 structured condition
IR을 사용한다. condition case table은 기존 기능으로 그대로 유지한다.

### 5.3 protocol

- `src/protocol/functionLogic.ts`
- opaque graph/block/binding/edge IDs
- source evidence token

Tutor payload에도 raw filesystem path나 analyzer 내부 ID를 노출하지 않는다.
projection 단계에서 opaque ID와 evidence token으로 변환한다.

### 5.4 Host delivery

- `src/webview/codeFlow/codeFlowHostDelivery.ts`
- `readSourceText(filePath)`
- 현재 graph snapshot
- source/evidence registry

Host는 incoming `calls` edge의 source file을 bounded하게 읽어 callsite argument
문맥을 수집한다. 전체 graph를 새로 분석하거나 Webview가 filesystem을 읽게 하지
않는다.

### 5.5 Webview

- `src/webview/codeFlow/functionLogicBrowserSource.ts`
- `src/webview/codeFlow/comprehension/`
- `src/webview/codeFlow/inspector/`
- `src/webview/codeFlow/valuePreview/`
- `src/webview/codeFlow/dataFlow/`
- fake DOM test runtime

현재 `functionLogicBrowserSource.ts`는 이미 파일 길이 상한에 가깝다. Tutor 구현을
이 파일에 직접 추가하지 않는다. public browser-source composer 호출 몇 줄만
추가하고 나머지는 `src/webview/codeFlow/tutor/`로 분리한다.

---

## 6. 최종 의존성 구조

```text
language source / graph call edges
              │
              ▼
src/analyzer/functionTutor/
  declaration facts + constraints + expression IR + gaps
              │
              ▼
src/application/codeFlow/functionTutor/
  callsite context + candidate domains + scenario seed selection
              │
              ▼
src/protocol/functionTutor.ts
  opaque IDs + JSON-safe bounded payload
              │
              ▼
src/webview/codeFlow/tutor/
  bounded static interpreter + descriptions + table + graph attention
```

허용 의존성:

```text
functionTutor analyzer -> functionLogic analyzer types -> shared
functionTutor application -> analyzer + graph + protocol types -> shared
protocol -> shared
webview tutor -> protocol + existing webview public controllers
Host delivery -> analyzer/application/protocol adapters
```

금지 의존성:

```text
analyzer -> webview
analyzer -> vscode
webview -> filesystem
webview -> vscode API
protocol -> analyzer implementation
functionLogic core -> Tutor UI
Tutor evaluator -> TypeScript compiler API
Tutor UI -> raw analyzer IDs or raw file paths
```

---

## 7. 최종 폴더 구조

다음 구조를 기준으로 구현한다. 파일 책임이 커지면 같은 폴더 안에서 더 나누되
public surface는 바꾸지 않는다.

```text
src/
  analyzer/
    functionTutor/
      index.ts
      types.ts
      staticValue.ts
      expressionIr.ts
      functionTutorAnalyzer.ts
      parameterDomain.ts
      constraintCollector.ts
      gapCollector.ts
      languages/
        types.ts
        typescript/
          typescriptTutorAdapter.ts
          typescriptParameterFacts.ts
          typescriptConstraintFacts.ts
          typescriptExpressionIr.ts
          typescriptCallsiteFacts.ts
        python/
          pythonTutorAdapter.ts
          pythonParameterFacts.ts
          pythonConstraintFacts.ts
          pythonExpressionIr.ts
          pythonCallsiteFacts.ts
        java/
          javaTutorAdapter.ts
          javaParameterFacts.ts
          javaConstraintFacts.ts
          javaExpressionIr.ts
          javaCallsiteFacts.ts
        functional/
          functionalTutorAdapter.ts
          functionalParameterFacts.ts
          functionalConstraintFacts.ts
          functionalExpressionIr.ts
          functionalCallsiteFacts.ts
  application/
    codeFlow/
      functionTutor/
        index.ts
        types.ts
        functionTutorContextCollector.ts
        functionTutorCandidateBuilder.ts
        functionTutorScenarioPlanner.ts
        functionTutorCoverage.ts
        functionTutorProjection.ts
        functionTutorFingerprint.ts
  protocol/
    functionTutor.ts
  webview/
    codeFlow/
      tutor/
        index.ts
        types.ts
        functionTutorBrowserSource.ts
        functionTutorControllerBrowserSource.ts
        functionTutorInterpreterBrowserSource.ts
        functionTutorExpressionBrowserSource.ts
        functionTutorDescriptionBrowserSource.ts
        functionTutorTableBrowserSource.ts
        functionTutorAttentionBrowserSource.ts
        functionTutorStyles.ts
        functionTutorCopy.ts
  test/
    fixtures/
      functionTutor/
        typescript/
        javascript/
        python/
        java/
        functional/
    unit/
      functionTutor*.test.ts
```

`src/analyzer/functionLogic/tutor/`에 구현하지 않는다. Tutor는 Function Logic
결과를 소비하지만 입력 domain·호출 문맥·시나리오 계획이라는 별도 책임을 가진다.

---

## 8. 핵심 타입 계약

아래 타입 이름과 의미를 기준으로 한다. 세부 필드 추가는 가능하지만 삭제·의미
변경은 이 문서와 SPEC 갱신 없이 하지 않는다.

### 8.1 JSON-safe 정적 값

JavaScript의 `undefined`, `NaN`, `Infinity`, symbol, bigint를 protocol에 직접
넣지 않는다. 모든 값은 discriminated union으로 표현한다.

```ts
export type FunctionTutorStaticValue =
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "null" }
  | { readonly kind: "undefined" }
  | {
      readonly kind: "array";
      readonly items: readonly FunctionTutorStaticValue[];
      readonly truncated: boolean;
    }
  | {
      readonly kind: "object";
      readonly entries: readonly FunctionTutorObjectEntry[];
      readonly truncated: boolean;
    }
  | {
      readonly kind: "enum";
      readonly typeName?: string;
      readonly memberName: string;
      readonly underlying?: FunctionTutorScalarValue;
    }
  | {
      readonly kind: "unknown";
      readonly reason: FunctionTutorUnknownReason;
      readonly detail?: string;
    };

export type FunctionTutorScalarValue =
  | Extract<FunctionTutorStaticValue, { readonly kind: "boolean" }>
  | Extract<FunctionTutorStaticValue, { readonly kind: "number" }>
  | Extract<FunctionTutorStaticValue, { readonly kind: "string" }>
  | Extract<FunctionTutorStaticValue, { readonly kind: "null" }>
  | Extract<FunctionTutorStaticValue, { readonly kind: "undefined" }>;

export interface FunctionTutorObjectEntry {
  readonly key: string;
  readonly value: FunctionTutorStaticValue;
}

export type FunctionTutorUnknownReason =
  | "dynamic-call"
  | "unsupported-expression"
  | "unsupported-type"
  | "missing-source"
  | "ambiguous-binding"
  | "alias-budget"
  | "depth-budget"
  | "value-budget"
  | "loop-budget"
  | "path-budget"
  | "external-state"
  | "language-gap"
  | "not-inferred";
```

불변 조건:

- `number.value`는 `Number.isFinite(value) === true`여야 한다.
- 정수는 `Number.isSafeInteger(value) === true` 범위만 number로 보존한다. Java
  `long`이나 Python `int`가 이를 넘으면 반올림하지 않고 `unsupported-type`
  unknown과 gap을 만든다.
- object key는 own data key로만 취급한다.
- `__proto__`, `prototype`, `constructor`는 object write/read 대상에서
  거부하고 `unsupported-expression` gap을 만든다.
- array 최대 8 items, object 최대 8 entries, nested value 최대 depth 2다.
- 초과분은 버리고 `truncated: true`와 별도 gap을 남긴다.
- 값 비교와 hash에는 object entry key 정렬을 사용한다.
- UI display string을 다시 값으로 파싱하지 않는다.

### 8.2 certainty와 provenance

```ts
export type FunctionTutorCertainty = "exact" | "inferred" | "unknown";

export type FunctionTutorEvidenceKind =
  | "parameter-type"
  | "parameter-default"
  | "literal-union"
  | "enum-member"
  | "callsite-argument"
  | "branch-constraint"
  | "type-representative"
  | "embedded-code"
  | "fallback";

export interface FunctionTutorEvidenceRef {
  readonly kind: FunctionTutorEvidenceKind;
  readonly certainty: FunctionTutorCertainty;
  readonly range?: SourceRange;
  readonly summary: string;
}
```

`SourceRange`는 `src/shared/types.ts`의 기존 타입을 import한다. analyzer
내부에서는 source range를 쓸 수 있다. protocol projection 후에는 range
대신 opaque evidence token을 쓴다.

표시 규칙:

- `exact`: source literal, 선언 default, 명시 enum/literal union
- `inferred`: 타입 대표값, condition boundary에서 만든 이웃값, 제한된 alias 해석
- `unknown`: 안전하게 결정할 수 없는 동적 값

`exact`는 “실제 런타임에서 반드시 이 값”이라는 뜻이 아니다. “해당 정적
근거에서 literal/default를 정확히 읽음”이라는 뜻이다. UI tooltip과 문서에 이
정의를 그대로 사용한다.

### 8.3 매개변수 facts

```ts
export type FunctionTutorParameterTypeKind =
  | "boolean"
  | "number"
  | "string"
  | "null"
  | "undefined"
  | "literal-union"
  | "enum"
  | "array"
  | "tuple"
  | "object"
  | "callable"
  | "unknown";

export interface FunctionTutorParameterFact {
  readonly id: string;
  readonly bindingId?: string;
  readonly name: string;
  readonly index: number;
  readonly callingMode:
    | "positional"
    | "positional-only"
    | "keyword-only"
    | "rest-positional"
    | "rest-keyword";
  readonly typeKind: FunctionTutorParameterTypeKind;
  readonly typeText?: string;
  readonly optional: boolean;
  readonly rest: boolean;
  readonly defaultValue?: FunctionTutorStaticValue;
  readonly memberFacts: readonly FunctionTutorMemberFact[];
  readonly declarationEvidence: readonly FunctionTutorEvidenceRef[];
  readonly gaps: readonly FunctionTutorGap[];
}

export interface FunctionTutorMemberFact {
  readonly path: readonly string[];
  readonly typeKind: FunctionTutorParameterTypeKind;
  readonly optional: boolean;
  readonly literalValues: readonly FunctionTutorStaticValue[];
}
```

`typeText`는 표시 전용이다. seed 생성이나 evaluator가 `typeText` 문자열을
재파싱하지 않는다.

### 8.4 표현식 IR

언어별 source expression을 Webview에서 재파싱하지 않도록 공통 IR을 만든다.

```ts
export type FunctionTutorExpressionIr =
  | { readonly kind: "literal"; readonly value: FunctionTutorStaticValue }
  | { readonly kind: "binding"; readonly bindingId: string }
  | {
      readonly kind: "member";
      readonly object: FunctionTutorExpressionIr;
      readonly path: readonly string[];
      readonly optional: boolean;
    }
  | {
      readonly kind: "unary";
      readonly operator: "not" | "plus" | "minus" | "typeof";
      readonly operand: FunctionTutorExpressionIr;
    }
  | {
      readonly kind: "binary";
      readonly operator:
        | "eq"
        | "neq"
        | "strict-eq"
        | "strict-neq"
        | "lt"
        | "lte"
        | "gt"
        | "gte"
        | "add"
        | "subtract"
        | "multiply"
        | "divide"
        | "modulo"
        | "in";
      readonly left: FunctionTutorExpressionIr;
      readonly right: FunctionTutorExpressionIr;
    }
  | {
      readonly kind: "logical";
      readonly operator: "and" | "or" | "nullish";
      readonly members: readonly FunctionTutorExpressionIr[];
    }
  | {
      readonly kind: "conditional";
      readonly condition: FunctionTutorExpressionIr;
      readonly whenTrue: FunctionTutorExpressionIr;
      readonly whenFalse: FunctionTutorExpressionIr;
    }
  | {
      readonly kind: "array";
      readonly items: readonly FunctionTutorExpressionIr[];
    }
  | {
      readonly kind: "object";
      readonly entries: readonly {
        readonly key: string;
        readonly value: FunctionTutorExpressionIr;
      }[];
    }
  | {
      readonly kind: "unsupported";
      readonly reason: FunctionTutorUnknownReason;
      readonly summary: string;
    };
```

제약:

- call expression은 실행 가능한 IR로 변환하지 않는다.
- 안전한 내장 연산은 별도 allowlist로만 추가한다.
- v1 allowlist는 `typeof`, nullish check, direct `.length`, scalar arithmetic,
  scalar comparison, boolean logic뿐이다.
- getter 가능성이 있는 arbitrary member read는 exact가 아니라 inferred 또는
  unknown으로 처리한다.
- IR node count는 함수당 최대 400개다. 초과 시 unsupported node와 gap을 넣는다.

### 8.5 조건 constraint

```ts
export type FunctionTutorConstraintOperator =
  | "truthy"
  | "falsy"
  | "eq"
  | "neq"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "nullish"
  | "non-nullish"
  | "length-eq"
  | "length-lt"
  | "length-lte"
  | "length-gt"
  | "length-gte"
  | "one-of"
  | "type-is";

export interface FunctionTutorConstraintFact {
  readonly id: string;
  readonly blockId: string;
  readonly parameterId: string;
  readonly memberPath: readonly string[];
  readonly operator: FunctionTutorConstraintOperator;
  readonly operand?: FunctionTutorStaticValue;
  readonly operands?: readonly FunctionTutorStaticValue[];
  readonly trueOutcome: string;
  readonly falseOutcome: string;
  readonly certainty: FunctionTutorCertainty;
  readonly evidence: readonly FunctionTutorEvidenceRef[];
}
```

v1은 parameter 또는 parameter의 direct bounded member path만 constraint 대상으로
삼는다. local 값이 parameter에서 단순 alias된 경우에만 최대 4 hop까지 원래
parameter로 추적한다. arbitrary data flow를 새 symbolic solver로 만들지 않는다.

### 8.6 block program

Webview interpreter가 UI label을 해석하지 않도록 analyzer가 block별 정적 동작을
구조화한다.

```ts
export interface FunctionTutorProgram {
  readonly entryBlockId: string;
  readonly blocks: readonly FunctionTutorProgramBlock[];
  readonly edges: readonly FunctionTutorProgramEdge[];
  readonly bindings: readonly FunctionTutorProgramBinding[];
  readonly gaps: readonly FunctionTutorGap[];
  readonly budgets: FunctionTutorAnalysisBudgets;
}

export type FunctionTutorBudgetName =
  | "expression-nodes"
  | "constraints"
  | "alias-hops"
  | "value-depth"
  | "value-items";

export interface FunctionTutorAnalysisBudgets {
  readonly applied: readonly {
    readonly name: FunctionTutorBudgetName;
    readonly used: number;
    readonly limit: number;
    readonly truncated: boolean;
  }[];
}

export interface FunctionTutorProgramBinding {
  readonly bindingId: string;
  readonly parameterId?: string;
  readonly name: string;
  readonly kind: "parameter" | "local" | "constant";
  readonly certainty: FunctionTutorCertainty;
}

export interface FunctionTutorProgramEdge {
  readonly edgeId: string;
  readonly sourceBlockId: string;
  readonly targetBlockId: string;
  readonly kind: FunctionLogicEdgeKind;
  readonly label?: string;
  readonly certainty: FunctionTutorCertainty;
}

export interface FunctionTutorProgramBlock {
  readonly blockId: string;
  readonly kind: FunctionLogicBlockKind;
  readonly operations: readonly FunctionTutorOperation[];
  readonly decision?: FunctionTutorDecision;
  readonly terminal?: FunctionTutorTerminal;
  readonly embeddedRelation?: "immediate" | "defines" | "deferred";
}

export type FunctionTutorOperation =
  | {
      readonly kind: "define";
      readonly bindingId: string;
      readonly value: FunctionTutorExpressionIr;
    }
  | {
      readonly kind: "assign";
      readonly target: FunctionTutorAssignmentTarget;
      readonly value: FunctionTutorExpressionIr;
      readonly operator?: "set" | "add" | "subtract" | "multiply" | "divide";
    }
  | {
      readonly kind: "increment";
      readonly target: FunctionTutorAssignmentTarget;
      readonly delta: 1 | -1;
    }
  | {
      readonly kind: "effect";
      readonly effectKind: "call" | "render" | "event" | "external-write" | "yield";
      readonly summary: string;
      readonly certainty: FunctionTutorCertainty;
    }
  | {
      readonly kind: "unsupported";
      readonly summary: string;
      readonly reason: FunctionTutorUnknownReason;
    };

export type FunctionTutorAssignmentTarget =
  | { readonly kind: "binding"; readonly bindingId: string }
  | {
      readonly kind: "member";
      readonly bindingId: string;
      readonly path: readonly string[];
    };

export interface FunctionTutorDecision {
  readonly expression: FunctionTutorExpressionIr;
  readonly outcomes: readonly {
    readonly objectiveId?: string;
    readonly edgeId: string;
    readonly label: string;
    readonly matches:
      | { readonly kind: "boolean"; readonly value: boolean }
      | { readonly kind: "case"; readonly value: FunctionTutorStaticValue }
      | { readonly kind: "default" }
      | { readonly kind: "exception" }
      | { readonly kind: "loop-exit" };
  }[];
}

export type FunctionTutorTerminal =
  | {
      readonly kind: "return";
      readonly value?: FunctionTutorExpressionIr;
    }
  | {
      readonly kind: "throw";
      readonly value?: FunctionTutorExpressionIr;
    }
  | { readonly kind: "break" }
  | { readonly kind: "continue" }
  | { readonly kind: "exit" };
```

block operation은 source order를 보존한다. 하나의 block에 decision 전후 operation이
섞이는 언어 구조는 analyzer가 필요하면 block program을 synthetic step으로
분리하되 기존 graph node identity와 evidence를 잃지 않는다.

### 8.7 gap

```ts
export type FunctionTutorGapKind =
  | "unsupported-parameter"
  | "unsupported-expression"
  | "unresolved-callsite"
  | "dynamic-argument"
  | "ambiguous-overload"
  | "alias-budget"
  | "condition-budget"
  | "value-budget"
  | "scenario-budget"
  | "path-budget"
  | "loop-budget"
  | "embedded-boundary"
  | "missing-source"
  | "language-support";

export interface FunctionTutorGap {
  readonly kind: FunctionTutorGapKind;
  readonly summary: string;
  readonly parameterId?: string;
  readonly blockId?: string;
  readonly certainty: "unknown";
  readonly evidence?: readonly FunctionTutorEvidenceRef[];
}
```

gap summary는 사용자에게 그대로 노출할 수 있는 짧고 구체적인 문장으로 만든다.
예: `Argument 2 comes from a function call, so its value stays unknown.`

### 8.8 declaration 결과

```ts
export interface FunctionTutorDeclarationAnalysis {
  readonly functionNode: SymbolNode;
  readonly language: string;
  readonly executionKind: "sync" | "async" | "generator" | "async-generator";
  readonly parameters: readonly FunctionTutorParameterFact[];
  readonly constraints: readonly FunctionTutorConstraintFact[];
  readonly program: FunctionTutorProgram;
  readonly gaps: readonly FunctionTutorGap[];
  readonly summary: {
    readonly parameterCount: number;
    readonly constraintCount: number;
    readonly programBlockCount: number;
    readonly limited: boolean;
  };
}
```

이 타입이 analyzer의 최종 public 결과다. callsite tuple, candidate, scenario seed,
opaque protocol ID는 application layer에서 결합한다.

---

## 9. 분석 budget 상수

초기 버전은 설정 surface를 늘리지 않고 다음 internal constants를 사용한다.
성능 fixture 결과가 필요성을 증명하기 전 package setting을 추가하지 않는다.

```ts
export const FUNCTION_TUTOR_LIMITS = {
  maxParameters: 12,
  maxParameterMembers: 8,
  maxValueDepth: 2,
  maxArrayItems: 8,
  maxObjectEntries: 8,
  maxExpressionNodes: 400,
  maxConstraints: 64,
  maxAliasHops: 4,
  maxIncomingCallsites: 8,
  maxCallerFiles: 6,
  maxCallsiteTuples: 4,
  maxCandidatesPerParameter: 8,
  maxScenarios: 12,
  maxObjectives: 48,
  maxPathsPerScenario: 8,
  maxStepsPerPath: 240,
  maxLoopIterations: 3,
  hardMaxLoopIterations: 8,
  maxBindingStates: 80,
  maxValueTransitions: 160,
  maxVisitedStateHashes: 512,
} as const;
```

모든 truncation은 조용히 일어나면 안 된다.

- analyzer payload에 gap을 남긴다.
- UI 상단 summary에 `Limited` badge를 표시한다.
- `Unknowns & Limits`에서 어떤 budget이 적용됐는지 설명한다.
- raw source나 값은 log하지 않고 count와 elapsed time만 진단 log에 남긴다.

---

## 10. 언어 adapter public 계약

```ts
export interface FunctionTutorLanguageAdapter {
  readonly languages: readonly string[];

  analyzeDeclaration(
    input: FunctionTutorDeclarationInput,
  ): FunctionTutorDeclarationAnalysis;

  analyzeCallsite(
    input: FunctionTutorCallsiteInput,
  ): FunctionTutorCallsiteAnalysis;
}

export interface FunctionTutorDeclarationInput {
  readonly functionNode: SymbolNode;
  readonly sourceText: string;
  readonly functionLogic: FunctionLogicAnalysis;
  readonly limits: typeof FUNCTION_TUTOR_LIMITS;
}

export interface FunctionTutorCallsiteInput {
  readonly targetFunction: Pick<
    SymbolNode,
    "id" | "name" | "qualifiedName" | "language"
  >;
  readonly callerFilePath: string;
  readonly callerSourceText: string;
  readonly callEdge: GraphEdge;
  readonly limits: typeof FUNCTION_TUTOR_LIMITS;
}

export interface FunctionTutorCallsiteAnalysis {
  readonly matchedTarget: boolean;
  readonly tuple?: FunctionTutorCallsiteTuple;
  readonly gaps: readonly FunctionTutorGap[];
}
```

adapter registry는 정확히 하나의 adapter만 선택한다.

- 정확한 language alias 목록을 `index.ts`에서 정규화한다.
- 선택 실패 시 `language-support` gap을 반환한다.
- analyzer exception은 Host까지 throw하지 않고 해당 callsite/declaration의
  `language-support` 또는 `unsupported-expression` gap으로 격리한다.
- cancellation은 Host generation token에서 처리하며 parser 내부를 전역 상태로
  만들지 않는다.

---

## 11. 언어별 선언 분석 규칙

### 11.1 공통 순서

모든 adapter는 아래 순서로 동일한 의미를 만든다.

1. target function의 선언 syntax node를 source range로 다시 찾는다.
2. 매개변수를 source order로 수집한다.
3. type, annotation, default, optional/rest 여부를 structured fact로 변환한다.
4. Function Logic block range와 language AST node를 range overlap으로 연결한다.
5. condition/switch/match expression에서 parameter constraint를 수집한다.
6. assignment/definition/return/throw expression을 공통 IR로 변환한다.
7. 변환하지 못한 expression마다 구체적인 gap을 만든다.
8. block·edge reference가 Function Logic에 없는 syntax는 독립 graph를 만들지 않고
   가장 가까운 evidence block의 unsupported operation으로 연결한다.
9. budget 적용 후 stable source order로 정렬한다.

Function Logic label, `detail`, graph node text, HTML text를 파싱해서 AST facts를
만드는 구현은 금지한다.

### 11.2 TypeScript / JavaScript / JSX / TSX

`typescript` compiler API를 사용하고 기존 Function Logic parser 생성 helper를
재사용한다. 같은 source를 한 요청에서 두 번 parse하지 않도록 가능하면 parse
context를 analyzer pipeline에서 전달한다. 기존 public API 변경이 커지면 첫
버전은 request-scoped parse cache를 사용하되 전역 cache는 만들지 않는다.

매개변수 처리:

- identifier parameter: 직접 binding 생성
- optional token: `optional: true`
- initializer: safe constant expression이면 `defaultValue`
- rest parameter: `rest: true`, type element facts를 보존
- destructuring parameter:
  - synthetic top-level parameter ID를 만든다.
  - binding element를 `memberFacts` path로 기록한다.
  - computed property, nested depth > 2는 gap으로 남긴다.
- 타입:
  - `boolean`, `number`, `string`, `null`, `undefined`
  - literal type union
  - enum declaration/member
  - array/tuple
  - inline type literal/interface의 required/optional property
  - type reference는 같은 source file 또는 TypeChecker가 이미 제공되는 경우에만
    bounded resolve한다.
  - conditional type, mapped type, generic constraint, imported unresolved type은
    `unknown` 또는 안전한 primitive constraint까지만 사용한다.
- JavaScript:
  - initializer, JSDoc type, condition constraint, callsite literal 순서로 근거를
    쓴다.
  - 이름으로 타입을 추측하지 않는다.

condition 처리:

- `if`, ternary, `while`, `do`, `for` condition
- `switch` discriminant와 literal case
- `&&`, `||`, `??`, unary `!`
- `===`, `!==`, `==`, `!=`, `<`, `<=`, `>`, `>=`
- `typeof x === "string"` 등 primitive type check
- `x == null`, `x !== null`, `x !== undefined`
- `x.length` scalar comparison
- literal array의 `includes(x)`는 receiver와 argument가 모두 안전한 literal일
  때만 `one-of`

v1에서 명시적으로 gap 처리:

- arbitrary method call result
- user-defined type guard body
- getter/proxy semantics
- optional chain이 외부 object graph로 이어지는 경우
- template literal에 동적 expression이 포함된 경우
- spread가 동적 값인 object/array
- `instanceof`의 runtime prototype semantics
- closure capture가 parameter와 직접 alias되지 않은 경우

### 11.3 Python

기존 Lezer Python syntax tree 또는 repository의 Python analyzer parse helper를
재사용한다.

매개변수 처리:

- positional-only, positional-or-keyword, keyword-only를 source order와 별도
  calling mode로 보존한다.
- `*args`, `**kwargs`를 rest parameter로 표시한다.
- literal default `True`, `False`, number, string, `None`, bounded list/dict/tuple을
  safe constant로 변환한다.
- annotation:
  - `bool`, `int`, `float`, `str`, `None`
  - `Optional[T]`, `T | None`
  - `Literal[...]`
  - `list[T]`, `tuple[...]`, `dict[str, T]`
  - 같은 파일의 `Enum` member
  - dataclass/TypedDict는 기존 analyzer가 구조를 안전하게 찾을 수 있을 때만
    bounded member facts로 변환
- annotation string은 import/실행하지 않는다. syntax literal 내부를 제한적으로
  parse하거나 unknown으로 둔다.

condition 처리:

- truthiness, `not`
- `==`, `!=`, `<`, `<=`, `>`, `>=`
- `is None`, `is not None`
- `in`/`not in` with literal tuple/list/set
- `len(x)` comparison: callee가 built-in identifier `len`이고 shadowing evidence가
  없을 때만 inferred
- boolean `and`, `or`
- `match` literal/enum-like case는 parser 지원 범위에서 처리

gap:

- descriptor/property access
- overloaded operators
- arbitrary comprehension/generator
- dynamic `__getattr__`
- imported annotation resolution
- decorators가 signature를 변경할 가능성

### 11.4 Java

기존 Lezer Java syntax tree 또는 Java analyzer parse helper를 재사용한다.

매개변수 처리:

- primitive `boolean`, numeric primitives, `char`
- boxed primitive는 null 가능 inferred domain을 추가
- `String`
- array
- same-file enum
- same-file record 또는 단순 field declaration은 depth 2 member facts
- varargs
- annotation은 타입 근거로 실행하거나 해석하지 않는다.
- overload target은 graph edge target symbol과 parameter count/range를 함께
  확인한다. 일치하지 않으면 `ambiguous-overload` gap을 남긴다.

condition 처리:

- Java scalar comparison과 boolean logic
- null equality
- `.length` array, `.length()` String은 receiver type이 확인될 때만
- switch literal/enum case
- ternary

gap:

- autoboxing side effect를 포함한 arbitrary method call
- getter/member method
- reflection
- inheritance를 통한 dynamic dispatch 결과
- overloaded operator에 해당하는 library abstraction

### 11.5 F# / OCaml / Elixir

세 언어는 `functionalTutorAdapter` public surface를 공유하되 내부 dialect
strategy를 구분한다. 각 strategy는 기존 functional Function Logic analyzer의
syntax range와 language tag를 재사용한다.

최소 완료 범위:

- 함수 매개변수 이름과 source order
- literal default 개념이 없는 언어에서는 default를 만들지 않음
- bool/number/string/null-like literal
- tuple/list literal의 bounded 값
- direct `if`/`case`/`match` literal branch
- direct parameter 비교와 truthiness
- direct local binding·rebind가 Function Logic value change로 이미 추출된 경우
  assignment-like IR
- return에 해당하는 terminal expression의 bounded IR

언어별 주의:

- F#: discriminated union case는 same-file declaration을 찾을 수 있을 때 enum-like
  candidate로 만든다.
- OCaml: variant constructor와 pattern literal을 같은 파일에서 확인할 수 있을
  때만 candidate로 만든다.
- Elixir: atom은 `{ kind: "enum", memberName: ":atom" }` 형태로 보존하고 arbitrary
  atom을 string으로 합치지 않는다.
- pattern destructuring은 depth 2까지만 member fact로 만든다.
- guard는 scalar comparison/null-like/type predicate의 allowlist만 변환한다.

parser가 해당 구조를 안정적으로 제공하지 않으면 pseudo parsing을 추가하지
않고 `language-support` gap을 반환한다. empty Tutor도 기능적 결과다.

---

## 12. 호출 문맥 수집

### 12.1 incoming edge 선택

`FunctionTutorContextCollector`는 현재 graph snapshot에서 다음 조건으로 edge를
선택한다.

1. `edge.kind === "calls"`
2. `edge.targetId === selectedFunction.id`
3. source node와 file path를 확인할 수 있음
4. exact/resolved confidence를 inferred보다 먼저 정렬
5. 동일 file/range edge를 deduplicate
6. source file path, range start, edge ID 순서로 stable sort
7. `maxIncomingCallsites`, `maxCallerFiles` 적용

전체 repository를 추가 traversal하지 않는다. 현재 graph snapshot에 있는
incoming edge만 사용한다. 향후 lazy incoming query가 도입되면 이 collector의
adapter 뒤에 연결한다.

### 12.2 source 읽기

- target source는 기존 `publishFunctionLogic` 경로의 source snapshot을 재사용한다.
- caller source는 기존 `readSourceText(filePath)` adapter를 사용한다.
- 동일 caller file은 요청당 한 번만 읽는다.
- 최대 6개 파일을 `Promise.all`로 읽되 collection 순서는 stable sort 결과로
  복원한다.
- read 실패는 전체 Tutor 실패가 아니라 해당 file의 `missing-source` gap이다.
- active unsaved target document는 기존 source snapshot을 우선한다.
- caller의 unsaved snapshot을 제공하는 기존 adapter가 있으면 사용하고, 없으면
  disk source임을 evidence summary에 명시한다.
- generation token이 바뀌면 결과를 publish하지 않는다.

### 12.3 call expression 매칭

각 language adapter는 edge range 주변의 가장 작은 enclosing call expression을
찾는다.

- range가 callee identifier, 전체 call, argument 중 어디를 가리켜도 enclosing
  call을 찾을 수 있어야 한다.
- callee name만 같다는 이유로 target을 match하지 않는다.
- graph target identity, qualified name, member owner, argument count, overload
  facts 중 가능한 근거를 결합한다.
- match가 불충분하면 `matchedTarget: false`와 `unresolved-callsite` gap을 반환한다.
- optional/deferred callback registration은 normal direct call tuple로 섞지 않는다.

### 12.4 argument tuple

```ts
export interface FunctionTutorCallsiteTuple {
  readonly id: string;
  readonly arguments: readonly FunctionTutorArgumentFact[];
  readonly certainty: FunctionTutorCertainty;
  readonly evidence: readonly FunctionTutorEvidenceRef[];
}

export interface FunctionTutorArgumentFact {
  readonly parameterId: string;
  readonly value: FunctionTutorStaticValue;
  readonly certainty: FunctionTutorCertainty;
  readonly omitted: boolean;
  readonly evidence: readonly FunctionTutorEvidenceRef[];
}
```

tuple 규칙:

- 한 callsite의 argument 조합은 끝까지 한 tuple로 보존한다.
- 서로 다른 callsite의 첫 번째·두 번째 argument를 섞어 새 tuple을 만들지 않는다.
- positional/named/default/rest mapping은 언어 규칙을 따른다.
- omitted argument에 declaration default가 있으면 default candidate를 연결하되
  evidence에 callsite omission과 declaration default 둘 다 남긴다.
- literal, bounded array/object/tuple, unary numeric literal은 exact로 읽는다.
- 같은 caller file의 `const`/immutable local alias는 최대 4 hop, 동일 lexical
  scope, write가 하나뿐일 때만 inferred로 해석한다.
- mutable alias, function return, property read, call, getter 가능 access는
  `unknown(dynamic-call|external-state|ambiguous-binding)`이다.
- spread/rest mapping을 완전히 확인할 수 없으면 known prefix와 unknown rest를
  함께 보존한다.
- 최대 4개의 tuple만 seed 우선순위에 넣는다. 나머지는 truncation gap으로
  집계한다.

### 12.5 callsite precedence

candidate source 우선순위:

1. exact callsite literal tuple
2. declaration default
3. literal union / enum member
4. exact condition equality literal
5. inferred immutable alias callsite tuple
6. branch boundary candidate
7. type representative
8. unknown

이 순위는 시나리오 표의 첫 행 순서에도 반영한다. 단, 중복 tuple은 canonical
value hash로 제거한다.

---

## 13. 매개변수 candidate domain

### 13.1 공통 candidate 타입

```ts
export interface FunctionTutorInputCandidate {
  readonly id: string;
  readonly parameterId: string;
  readonly value: FunctionTutorStaticValue;
  readonly certainty: FunctionTutorCertainty;
  readonly source:
    | "callsite"
    | "default"
    | "literal-type"
    | "enum"
    | "constraint-boundary"
    | "type-representative"
    | "unknown";
  readonly coversObjectiveIds: readonly string[];
  readonly evidence: readonly FunctionTutorEvidenceRef[];
}
```

ID는 display label이 아니라 stable canonical hash로 만든다.

```text
candidate:<parameter-id>:<canonical-value>:<source>
```

hash helper는 repository의 기존 stable hash utility가 있으면 재사용한다. 없으면
`shared`에 FNV-1a 등 단순 결정론적 non-cryptographic hash를 추가하되 구현
주석으로 graph identity가 아닌 session-local opaque seed임을 밝힌다.

### 13.2 boolean

생성 순서:

1. exact callsite boolean
2. default boolean
3. constraint equality
4. `false`
5. `true`

중복 제거 후 최대 8개를 적용한다.

### 13.3 number

생성 순서:

1. exact callsite/default/literal type
2. equality operand `k`
3. 각 `<`, `<=`, `>`, `>=` boundary `k`에 대해 `k - step`, `k`, `k + step`
4. representative `0`, `1`, `-1`

`step` 규칙:

- integer type 또는 integer literal만 관찰된 parameter: `1`
- float 가능: `1`을 기본으로 하되 `Number.EPSILON`을 candidate로 만들지 않는다.
- boundary가 finite가 아니면 candidate를 만들지 않는다.
- Java byte/short/int/long range를 넘는 값은 버린다.
- unsigned evidence가 있는 경우 음수 representative를 버린다.

`NaN`, `Infinity`, `-Infinity`, negative zero는 명시적 source literal 근거가 없는
한 생성하지 않는다.

### 13.4 string

생성 순서:

1. exact callsite/default/literal union/equality
2. empty constraint 또는 truthiness 구분용 `""`
3. type representative `"sample"`

`"sample"`은 항상 inferred이며 UI에서 `Type example`로 표시한다. identifier
이름으로 이메일, URL, status 같은 의미 값을 만들어 내지 않는다.

### 13.5 null / undefined / optional

- source 언어에 따라 `null`, `None`, `nil`을 canonical `null`로 mapping한다.
- JavaScript/TypeScript omitted optional은 `undefined`.
- Python omitted default와 explicit `None`은 구분한다.
- Java boxed/reference type은 source evidence가 있을 때 null candidate를 포함한다.
- optional parameter는 omitted candidate를 만들되 call mapping에서 omission을
  별도 flag로 보존한다.

### 13.6 literal union / enum

- source order로 literal/member candidate를 만든다.
- 최대 8개를 넘으면 condition 또는 callsite에서 참조된 member를 먼저 선택한다.
- enum member의 underlying scalar가 안전하게 확인되면 함께 저장한다.
- UI는 member name을 우선 표시하고 underlying value는 evidence detail에 둔다.

### 13.7 array / tuple

candidate:

1. exact bounded callsite/default
2. empty `[]`
3. element domain이 알려진 경우 `[representative]`
4. `.length` boundary가 있으면 필요한 최소 길이의 placeholder array

규칙:

- 최대 length 8
- length boundary가 8보다 크면 해당 boundary objective를 exact하게 cover하려
  하지 않고 `value-budget` gap을 남긴다.
- element unknown이면 임의 object를 만들지 않고 `unknown` item 또는 empty만
  사용한다.
- tuple은 position별 fact가 있을 때만 합성한다.

### 13.8 object

candidate:

1. exact bounded callsite/default object
2. required member만 채운 baseline
3. optional member를 하나씩 추가/제거한 boundary variant
4. direct member constraint를 만족/불만족하는 variant

규칙:

- depth 2, entries 8
- required field domain이 unknown이면 field value도 unknown으로 둔다.
- prototype-sensitive key 금지
- recursive type는 visited type ID set으로 cycle을 끊고 unknown
- 모든 optional field 조합의 Cartesian product를 만들지 않는다.
- 한 시나리오 objective에 필요한 member만 변경하고 나머지는 baseline을 유지한다.

### 13.9 callable / unsupported

callback/function parameter를 실행 가능한 값으로 만들지 않는다.

- callsite가 function symbol을 넘겨도 `{ kind: "unknown", reason:
  "unsupported-type" }`
- callback invoked block은 possible effect로 남긴다.
- branch가 callback identity와 literal 비교하는 매우 제한된 경우에도 identity를
  source string으로 모사하지 않는다.

---

## 14. scenario seed 계획

### 14.1 seed 타입

```ts
export interface FunctionTutorScenarioSeed {
  readonly id: string;
  readonly ordinal: number;
  readonly title: string;
  readonly inputs: readonly FunctionTutorScenarioInput[];
  readonly source: "callsite" | "default" | "branch" | "type" | "mixed";
  readonly certainty: FunctionTutorCertainty;
  readonly objectiveIds: readonly string[];
  readonly evidence: readonly FunctionTutorEvidenceRef[];
  readonly gaps: readonly FunctionTutorGap[];
}

export interface FunctionTutorScenarioInput {
  readonly parameterId: string;
  readonly value: FunctionTutorStaticValue;
  readonly omitted: boolean;
  readonly certainty: FunctionTutorCertainty;
  readonly evidence: readonly FunctionTutorEvidenceRef[];
}

export interface FunctionTutorCoverageObjective {
  readonly id: string;
  readonly kind:
    | "callsite-tuple"
    | "condition-true"
    | "condition-false"
    | "switch-case"
    | "loop-body"
    | "loop-exit"
    | "exception-path"
    | "nullish"
    | "non-nullish"
    | "default-input"
    | "type-baseline";
  readonly blockId?: string;
  readonly weight: number;
}
```

### 14.2 생성 순서

1. parameter facts와 candidates를 만든다.
2. condition/switch outcome을 coverage objective로 만든다.
3. exact/inferred callsite tuple을 그대로 seed로 추가한다.
4. default 우선 baseline을 한 개 만든다.
5. default가 없는 parameter는 가장 높은 근거 candidate를 baseline에 사용한다.
6. 각 objective를 만족하는 최소 변경 tuple을 baseline에서 만든다.
7. canonical tuple hash로 deduplicate한다.
8. greedy coverage selection으로 최대 12개를 선택한다.
9. stable title, ordinal, certainty, evidence를 부여한다.

### 14.3 greedy selection

Cartesian product는 절대 만들지 않는다.

반복 알고리즘:

```text
selected = exact callsite tuples in stable order
covered = objectives covered by selected
candidates = baseline + objective-specific tuples

while selected.length < maxScenarios and candidates not empty:
  for each candidate:
    score =
      sum(weight of uncovered objective)
      + provenance bonus
      - unknown input penalty
      - duplicate-path heuristic penalty
  choose highest score
  tie-break by canonical tuple hash
  add to selected
  mark objectives covered
  remove candidate
```

weight:

```text
exact callsite tuple: 100
condition true/false: 40
switch case: 40
nullish/non-nullish: 35
default input: 30
loop body/exit: 20
exception path: 15
type baseline: 10
```

provenance bonus:

```text
exact: +20
inferred: +5
unknown: -15 per unknown parameter
```

호출 tuple이 12개 제한을 모두 차지하지 않도록 exact callsite tuple도 최대 4개로
이미 제한한다.

### 14.4 scenario title

결정론적 template만 사용한다.

- exact callsite: `Callsite Example 1`
- declaration defaults 중심: `Declared Defaults`
- condition objective: `<short parameter label> · <operator> <value>`
- nullish: `<parameter> · Missing or null`
- type baseline: `Type Baseline`
- zero parameter: `No-input Static Path`

title에 source expression 전체를 넣지 않는다. 48자를 넘으면 middle ellipsis가
아니라 끝 ellipsis `…`로 줄이고 full label을 accessible description에 보존한다.

### 14.5 zero/too-many parameter

- 매개변수 0개: 단 하나의 `No-input Static Path`
- 12개 초과:
  - 앞 12개만 임의 선택하지 않는다.
  - condition, mutation, return에 참조되는 parameter를 먼저 고른다.
  - 나머지는 unknown input로 남기고 `scenario-budget` gap을 표시한다.
- 모든 parameter가 unknown이어도 하나의 partial seed를 생성하여 함수 구조를
  볼 수 있게 한다.

### 14.6 seed 안정성

동일한 function source, graph snapshot, limits에서:

- seed ID와 순서가 동일해야 한다.
- Set/Map iteration order에 암묵적으로 의존하지 않는다.
- file path는 protocol ID에 포함하지 않는다.
- callsite source order와 canonical value order를 명시적으로 sort한다.
- test snapshot으로 안정성을 검증한다.

### 14.7 application build model

analyzer 결과와 callsite/planner 결과를 projection에 넘길 때 다음 application
타입을 사용한다.

```ts
export interface FunctionTutorBuildModel {
  readonly declaration: FunctionTutorDeclarationAnalysis;
  readonly callsites: readonly FunctionTutorCallsiteTuple[];
  readonly candidatesByParameter: ReadonlyMap<
    string,
    readonly FunctionTutorInputCandidate[]
  >;
  readonly objectives: readonly FunctionTutorCoverageObjective[];
  readonly seeds: readonly FunctionTutorScenarioSeed[];
  readonly gaps: readonly FunctionTutorGap[];
  readonly summary: {
    readonly exactCallsiteTupleCount: number;
    readonly coveredObjectiveCount: number;
    readonly totalObjectiveCount: number;
    readonly limited: boolean;
  };
}
```

`ReadonlyMap`은 application 내부 타입이다. projection은 이를 stable array로 바꾼
뒤 JSON-safe protocol payload를 만든다.

### 14.8 planned coverage와 computed coverage

- planner의 `coveredObjectiveCount`는 seed가 의도한 **planned coverage**다.
- UI loading 전 payload summary를 표시해야 한다면 `N planned outcomes`라고
  명시한다.
- interpreter 계산이 끝나면 모든 scenario path의 실제
  `FunctionTutorBranchOutcome` objective ID union으로 **computed coverage**를
  다시 계산한다.
- ready 상태의 `{covered}/{total} branch outcomes` badge는 computed coverage만
  사용한다.
- unknown condition fork로 도달한 outcome도 “possible static outcome”으로
  covered에 포함하되 certainty를 unknown으로 보존한다.
- budget 때문에 fork하지 못한 outcome은 covered에 포함하지 않는다.
- total은 program decision outcome 중 source edge와 연결된 bounded outcome 수다.
- parameter constraint가 없어 candidate로 직접 유도할 수 없는 outcome도 total에
  포함하고 gap/limit에서 이유를 설명한다.

---

## 15. Webview 정적 interpreter

### 15.1 분리 이유

기존 `functionLogicScenarioEvaluatorBrowserSource.ts`는 사용자가 입력한 한 Scenario를
빠르게 preview하기 위한 bounded evaluator다. Tutor는 다음 추가 요구가 있다.

- 여러 seed
- unknown 조건에서 bounded path fork
- loop iteration
- step별 before/after transition
- return/throw/effect summary
- path certainty와 truncation
- structured cross-language IR

따라서 기존 파일에 기능을 계속 추가하지 않는다.

1. 공통 안전 값 operation을 작은 helper로 추출한다.
2. 기존 Scenario evaluator의 public behavior와 tests는 유지한다.
3. Tutor 전용 interpreter는 structured IR을 소비한다.
4. 가능한 helper만 공유하고 두 evaluator의 결과 계약을 억지로 합치지 않는다.

### 15.2 실행 상태

```ts
export interface FunctionTutorPathState {
  readonly id: string;
  readonly currentBlockId: string;
  readonly environment: ReadonlyMap<string, FunctionTutorStaticValue>;
  readonly steps: readonly FunctionTutorStepResult[];
  readonly branchOutcomes: readonly FunctionTutorBranchOutcome[];
  readonly transitions: readonly FunctionTutorValueTransition[];
  readonly effects: readonly FunctionTutorEffectResult[];
  readonly loopVisits: ReadonlyMap<string, number>;
  readonly visitedStateHashes: ReadonlySet<string>;
  readonly certainty: FunctionTutorCertainty;
  readonly gaps: readonly FunctionTutorRuntimeGap[];
  readonly terminal?: FunctionTutorTerminalResult;
}
```

실제 구현은 성능을 위해 내부 mutable builder를 사용할 수 있으나 외부 result는
readonly JSON-safe object로 freeze 가능한 형태를 반환한다. fork할 때 전체
environment를 매번 deep copy하지 말고 bounded shallow structural copy를 사용한다.

initial environment:

- seed input을 parameter의 `bindingId`에 넣는다.
- omitted + default는 planner가 이미 default value로 seed에 넣고
  `omitted: true`를 보존한다.
- unresolved parameter는 unknown value를 넣는다.
- local/constant binding은 source의 `define` operation을 만날 때까지 state에 없다.
- closure capture는 analyzer가 명시적 binding bridge를 제공한 경우만 넣고,
  그렇지 않으면 `external-state` unknown이다.

### 15.3 work queue 알고리즘

재귀를 사용하지 않는다.

```text
queue = [initial state at entry]
completed = []
global steps = 0

while queue not empty and completed.length < maxPaths:
  state = queue.shift()

  if state has terminal:
    completed.push(state)
    continue

  if step/path/state budget exceeded:
    append bounded gap
    completed.push(as truncated state)
    continue

  block = blockById[state.currentBlockId]
  if missing:
    append unknown gap
    completed.push(state)
    continue

  apply block operations in source order
  record transitions/effects

  if block terminal:
    evaluate terminal expression
    complete state
    continue

  if block decision:
    evaluate condition
    known outcome -> enqueue matching edge
    unknown outcome -> fork only feasible bounded outcomes
    continue

  enqueue stable ordered outgoing control edges
```

queue ordering:

- exact/known path before unknown fork
- edge source order
- true/case before false/default only when source order is unavailable
- embedded immediate edge at its source position

### 15.4 expression evaluation

`functionTutorExpressionBrowserSource.ts`는 pure function collection이다.

```ts
evaluateTutorExpression(
  expression: FunctionTutorExpressionIr,
  environment: ReadonlyMap<string, FunctionTutorStaticValue>,
): FunctionTutorEvaluationResult
```

결과:

```ts
export interface FunctionTutorEvaluationResult {
  readonly value: FunctionTutorStaticValue;
  readonly certainty: FunctionTutorCertainty;
  readonly gaps: readonly FunctionTutorRuntimeGap[];
}
```

규칙:

- scalar comparison은 언어 adapter가 canonical semantic operator로 변환한 범위만
  처리한다.
- `strict-eq`와 `eq`의 language semantics 차이는 adapter의 normalized literal
  domain에서 구분한다. cross-language coercion을 새로 구현하지 않는다.
- unknown operand가 있으면 기본적으로 unknown이다.
- `and`, `or`, `nullish`는 short-circuit 순서를 보존한다.
- division by zero, invalid arithmetic는 unknown과 gap이다.
- string + string, number + number만 `add`; 혼합 coercion은 unknown이다.
- member read는 own bounded object/array와 allowlisted `length`만 처리한다.
- object write는 prototype-sensitive key를 거부한다.
- unsupported IR은 source를 실행하지 않고 그대로 unknown을 반환한다.
- 어떤 코드 경로에도 `eval`, `new Function`, dynamic import, Worker source,
  script element 삽입을 사용하지 않는다.

### 15.5 block operation

`define`:

- expression을 평가한다.
- binding state가 없으면 before를 `undefined`로 기록할 수 있지만 UI에서는
  `Not defined → value`로 표시한다.

`assign`:

- RHS를 먼저 평가한다.
- compound operator이면 현재 target 값을 읽고 safe scalar operation을 한다.
- known target + known RHS만 exact/inferred 결과를 만든다.
- unknown target/value는 transition을 생략하지 않고 `? → ?`와 reason을 남긴다.

`increment`:

- finite number만 계산한다.
- 그 외에는 unknown transition.

`effect`:

- call/render/event/external-write를 실행하지 않는다.
- `Possible call`, `Possible render`, `Possible event`, `Possible external write`로
  기록한다.
- Function Logic relation confidence를 보존한다.

`unsupported`:

- step과 gap을 기록한다.
- control flow 자체를 끊어야 할 근거가 없으면 다음 edge로 진행하되 certainty를
  `unknown`으로 낮춘다.

### 15.6 condition outcome

known boolean:

- matching edge 하나만 enqueue
- branch outcome certainty는 expression certainty

known switch/case:

- canonical scalar/enum 비교
- first matching case 또는 default

unknown:

- feasible outgoing edge를 최대 `maxPathsPerScenario` 안에서 fork
- 각 fork에 `Condition could not be resolved statically.` gap
- path certainty를 `unknown`
- 이미 path limit에 닿으면 모든 edge를 fork하지 않고 `path-budget` terminal
  summary 하나를 만든다.

사용자가 기존 UI에서 선택한 branch choice는 Tutor의 자동 추론 입력으로 사용하지
않는다. Tutor는 독립적으로 가능한 path를 보여준다. 단, graph preview attention을
그릴 때만 기존 branch choice 상태를 덮지 않는 별도 projection layer를 사용한다.

### 15.7 loop

loop body를 최대 3회만 순환한다.

- loop block/edge마다 visit count
- 동일 `blockId + canonical environment hash`를 다시 만나면 stable-state로 보고
  loop를 종료하는 possible exit path를 우선한다.
- known false condition이면 즉시 exit
- known true이지만 exit를 찾지 못하면 3회 후 `loop-budget`
- unknown condition이면 body 1개와 exit 1개 path로 fork하되 전체 path budget 준수
- `break`는 nearest loop exit edge
- `continue`는 nearest loop condition edge
- analyzer가 nearest loop relation을 제공하지 못하면 gap

hard max 8은 future internal override를 위한 방어선이다. 기본 UI가 이를 바꾸는
control을 제공하지 않는다.

### 15.8 embedded program

- `embeddedRelation === "immediate"`: outer environment에서 analyzer가 연결한
  lexical bridge binding만 embedded block에 전달한다.
- embedded local binding은 outer binding과 이름이 같아도 ID가 다르면 shadowing을
  보존한다.
- embedded write가 bridge target으로 명시된 경우에만 outer environment 갱신
- `defines`, `deferred`: effect/available program으로 기록하고 path에 진입하지 않음
- embedded IR gap은 outer source certainty를 자동으로 exact에서 unknown으로
  전부 낮추지 않고 해당 block 이후 관련 binding만 unknown 처리

### 15.9 cancellation과 chunking

시나리오 1~4개는 한 microtask에서 계산해도 되지만, elapsed time이 4ms를 넘으면
다음 scenario를 `requestAnimationFrame` 또는 기존 Webview scheduler로 넘긴다.

controller는 generation integer를 갖는다.

```text
open/new payload -> generation += 1
each chunk captures generation
before and after chunk -> compare
mismatch -> abandon result without DOM write
```

계산 중 새 function detail, panel close, Webview disposal이 오면 취소한다.

### 15.10 cache

cache key:

```text
<detail-session-id>:<tutor-fingerprint>:<interpreter-version>
```

fingerprint 입력:

- opaque function ID
- parameter facts
- scenario seeds
- program blocks/edges/IR
- limits

source text와 raw file path는 key에 넣지 않는다. cache는 Webview memory only이며
workspace storage에 persist하지 않는다.

### 15.11 async와 generator

- interpreter는 Promise, coroutine, task, iterator를 실행하거나 schedule하지
  않는다.
- async function의 source-local known `return x`는 terminal `return`으로 계산하되
  description에서 `may resolve with x`라고 표현한다.
- `await` operand가 literal이어도 실제 scheduling semantics를 재현하지 않는다.
  analyzer가 safe expression을 보존할 수 있으면 inferred value로 계속하고,
  arbitrary promise/call이면 `external-state` unknown이다.
- generator의 `yield x`는 terminal return이 아니라 `yield` possible effect와
  step으로 기록한다. path는 다음 block으로 bounded하게 이어갈 수 있다.
- `yield*`, Python `yield from`, async generator delegation은 unsupported gap이다.
- generator를 호출한 caller가 iteration하지 않았을 수 있으므로 UI는
  `May yield`, `Possible generator step`만 사용한다.

---

## 16. interpreter 결과 계약

### 16.1 scenario 결과

```ts
export interface FunctionTutorScenarioResult {
  readonly scenarioId: string;
  readonly title: string;
  readonly description: string;
  readonly inputs: readonly FunctionTutorScenarioInputResult[];
  readonly paths: readonly FunctionTutorPathResult[];
  readonly primaryPathId?: string;
  readonly branchCoverage: FunctionTutorBranchCoverageSummary;
  readonly transitionCount: number;
  readonly resultSummary: FunctionTutorResultSummary;
  readonly certainty: FunctionTutorCertainty;
  readonly limited: boolean;
  readonly gaps: readonly FunctionTutorRuntimeGap[];
}

export interface FunctionTutorPathResult {
  readonly id: string;
  readonly ordinal: number;
  readonly blockIds: readonly string[];
  readonly edgeIds: readonly string[];
  readonly steps: readonly FunctionTutorStepResult[];
  readonly branchOutcomes: readonly FunctionTutorBranchOutcome[];
  readonly transitions: readonly FunctionTutorValueTransition[];
  readonly effects: readonly FunctionTutorEffectResult[];
  readonly terminal?: FunctionTutorTerminalResult;
  readonly certainty: FunctionTutorCertainty;
  readonly truncated: boolean;
  readonly gaps: readonly FunctionTutorRuntimeGap[];
}
```

### 16.2 step

```ts
export interface FunctionTutorStepResult {
  readonly ordinal: number;
  readonly blockId: string;
  readonly kind:
    | "entry"
    | "decision"
    | "definition"
    | "mutation"
    | "effect"
    | "embedded"
    | "return"
    | "throw"
    | "unknown";
  readonly summary: string;
  readonly certainty: FunctionTutorCertainty;
  readonly evidenceToken?: string;
}
```

step summary는 protocol payload에서 받은 trusted structured label fragment를
조합한다. `innerHTML`에 넣지 않고 `textContent`로 렌더링한다.

### 16.3 값 transition

```ts
export interface FunctionTutorValueTransition {
  readonly ordinal: number;
  readonly blockId: string;
  readonly bindingId: string;
  readonly targetLabel: string;
  readonly before: FunctionTutorStaticValue;
  readonly after: FunctionTutorStaticValue;
  readonly operation: "define" | "set" | "add" | "subtract" | "increment" | "decrement";
  readonly certainty: FunctionTutorCertainty;
  readonly reason?: string;
  readonly evidenceToken?: string;
}
```

동일 block에서 동일 binding이 여러 번 바뀌면 source order대로 별도 transition을
유지한다. UI에서 임의로 마지막 값만 남기지 않는다.

### 16.4 terminal

```ts
export type FunctionTutorTerminalResult =
  | {
      readonly kind: "return";
      readonly value: FunctionTutorStaticValue;
      readonly certainty: FunctionTutorCertainty;
    }
  | {
      readonly kind: "throw";
      readonly value: FunctionTutorStaticValue;
      readonly certainty: FunctionTutorCertainty;
    }
  | {
      readonly kind: "exit" | "truncated" | "unknown";
      readonly certainty: FunctionTutorCertainty;
      readonly reason?: string;
    };
```

### 16.5 보조 결과 타입

```ts
export interface FunctionTutorScenarioInputResult {
  readonly parameterId: string;
  readonly label: string;
  readonly value: FunctionTutorStaticValue;
  readonly omitted: boolean;
  readonly certainty: FunctionTutorCertainty;
  readonly evidenceTokens: readonly string[];
}

export interface FunctionTutorBranchOutcome {
  readonly objectiveId?: string;
  readonly blockId: string;
  readonly edgeId: string;
  readonly label: string;
  readonly outcome: "true" | "false" | "case" | "default" | "unknown";
  readonly certainty: FunctionTutorCertainty;
  readonly evidenceToken?: string;
}

export interface FunctionTutorEffectResult {
  readonly blockId: string;
  readonly kind: "call" | "render" | "event" | "external-write" | "yield";
  readonly summary: string;
  readonly certainty: FunctionTutorCertainty;
  readonly evidenceToken?: string;
}

export interface FunctionTutorBranchCoverageSummary {
  readonly coveredObjectiveIds: readonly string[];
  readonly coveredCount: number;
  readonly totalCount: number;
}

export type FunctionTutorResultSummary =
  | {
      readonly kind: "return" | "throw";
      readonly value: FunctionTutorStaticValue;
      readonly alternatePathCount: number;
    }
  | {
      readonly kind: "exit" | "unknown" | "truncated";
      readonly alternatePathCount: number;
      readonly reason?: string;
    };

export interface FunctionTutorRuntimeGap {
  readonly kind:
    | FunctionTutorGapKind
    | "malformed-program"
    | "missing-reference"
    | "invalid-operation"
    | "cancelled";
  readonly summary: string;
  readonly blockId?: string;
  readonly bindingId?: string;
}
```

`cancelled` result는 UI error로 render하지 않는다. controller가 stale generation을
폐기하기 위한 internal result다.

### 16.6 primary path

여러 path가 생기면 표 한 행에는 한 primary summary가 필요하다.

선택 순위:

1. non-truncated
2. higher certainty
3. terminal return/throw/exit가 있는 path
4. fewer gaps
5. stable ordinal

행에 `+N possible paths` badge를 표시하여 primary path가 유일한 결과처럼 보이지
않게 한다. 행 선택 후 detail에서 path selector를 제공한다.

---

## 17. 결정론적 description 생성

LLM을 사용하지 않는다. `functionTutorDescriptionBrowserSource.ts`의 pure template
함수로 생성한다.

### 17.1 입력 요약

- 최대 3개 parameter를 `name = value`로 표시
- 4개 이상이면 `and N more inputs`
- unknown은 `name is unknown`
- object/array는 bounded compact formatter
- 각 value formatter 최대 40자

### 17.2 경로 요약 재료

우선순위:

1. 의미 있는 branch outcome 최대 2개
2. 값 변화 최대 2개
3. terminal result
4. possible effect 1개
5. unknown count

entry, 단순 operation, synthetic block label을 모두 description에 나열하지 않는다.

### 17.3 template

기본:

```text
With {inputs}, this possible static path {branch phrase},
{change phrase}, and {terminal phrase}.
```

branch 없음:

```text
With {inputs}, this possible static path {change phrase}
and {terminal phrase}.
```

unknown path:

```text
With {inputs}, static analysis finds {path count} possible paths.
{known summary}. {unknown count} values remain unknown.
```

no changes:

```text
With {inputs}, this possible static path makes no tracked value changes
and {terminal phrase}.
```

truncated:

```text
With {inputs}, this static estimate reaches the analysis limit after
{step count} steps. Earlier changes are shown below.
```

문구 규칙:

- `will`, `executed`, `observed`, `always returns` 금지
- `possible`, `static`, `may`, `estimated` 중 적어도 하나 포함
- 정확성 badge가 exact여도 runtime 확정형 문구 금지
- async function terminal은 `may resolve with`, generator effect는 `may yield`
- source identifier는 `textContent`, `translate="no"` 대상
- description 최대 240자; 초과 시 clause 우선순위로 제거하고 마지막에 `…`
- 고정 영문 copy는 `functionTutorCopy.ts` 한 파일에 둔다.

### 17.4 예시

```text
With amount = 120 and member = true, this possible static path enters
the member discount branch, changes discount from 0 to 20, and may return 100.
```

```text
With order.status = "pending" and ready = unknown, static analysis finds
2 possible paths. One path may update status to "ready"; 1 value remains unknown.
```

이 예시는 구현 fixture의 기대 문구로 사용하되 실제 block label과 formatter가
달라지면 의미를 유지하는 범위에서 snapshot을 갱신한다.

---

## 18. protocol 계약

### 18.1 새 파일

`src/protocol/functionTutor.ts`에 Webview에 전달할 타입만 둔다. analyzer type을
deep import하지 않는다.

```ts
export interface FunctionTutorPayload {
  readonly version: 1;
  readonly fingerprint: string;
  readonly functionId: string;
  readonly executionKind: "sync" | "async" | "generator" | "async-generator";
  readonly parameters: readonly FunctionTutorParameterPayload[];
  readonly seeds: readonly FunctionTutorScenarioSeedPayload[];
  readonly program: FunctionTutorProgramPayload;
  readonly evidence: readonly FunctionTutorEvidencePayload[];
  readonly gaps: readonly FunctionTutorGapPayload[];
  readonly summary: FunctionTutorPayloadSummary;
}

export interface FunctionTutorPayloadSummary {
  readonly inferredScenarioCount: number;
  readonly exactCallsiteTupleCount: number;
  readonly coveredObjectiveCount: number;
  readonly totalObjectiveCount: number;
  readonly limited: boolean;
}
```

protocol의 나머지 field는 다음 구조로 고정한다.

```ts
import type {
  CodeFlowEvidenceToken,
  FunctionLogicBlockPayloadKind,
  FunctionLogicEdgePayloadKind,
} from "./functionLogic";

export type FunctionTutorPayloadCertainty = "exact" | "inferred" | "unknown";
export type FunctionTutorUnknownReasonPayload =
  | "dynamic-call"
  | "unsupported-expression"
  | "unsupported-type"
  | "missing-source"
  | "ambiguous-binding"
  | "alias-budget"
  | "depth-budget"
  | "value-budget"
  | "loop-budget"
  | "path-budget"
  | "external-state"
  | "language-gap"
  | "not-inferred";
export type FunctionTutorGapPayloadKind =
  | "unsupported-parameter"
  | "unsupported-expression"
  | "unresolved-callsite"
  | "dynamic-argument"
  | "ambiguous-overload"
  | "alias-budget"
  | "condition-budget"
  | "value-budget"
  | "scenario-budget"
  | "path-budget"
  | "loop-budget"
  | "embedded-boundary"
  | "missing-source"
  | "language-support";
export type FunctionTutorParameterTypePayloadKind =
  | "boolean"
  | "number"
  | "string"
  | "null"
  | "undefined"
  | "literal-union"
  | "enum"
  | "array"
  | "tuple"
  | "object"
  | "callable"
  | "unknown";

export type FunctionTutorStaticValuePayload =
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "null" }
  | { readonly kind: "undefined" }
  | {
      readonly kind: "array";
      readonly items: readonly FunctionTutorStaticValuePayload[];
      readonly truncated: boolean;
    }
  | {
      readonly kind: "object";
      readonly entries: readonly {
        readonly key: string;
        readonly value: FunctionTutorStaticValuePayload;
      }[];
      readonly truncated: boolean;
    }
  | {
      readonly kind: "enum";
      readonly typeName?: string;
      readonly memberName: string;
      readonly underlying?:
        | { readonly kind: "boolean"; readonly value: boolean }
        | { readonly kind: "number"; readonly value: number }
        | { readonly kind: "string"; readonly value: string }
        | { readonly kind: "null" }
        | { readonly kind: "undefined" };
    }
  | {
      readonly kind: "unknown";
      readonly reason: FunctionTutorUnknownReasonPayload;
      readonly detail?: string;
    };

export type FunctionTutorExpressionPayload =
  | { readonly kind: "literal"; readonly value: FunctionTutorStaticValuePayload }
  | { readonly kind: "binding"; readonly bindingId: string }
  | {
      readonly kind: "member";
      readonly object: FunctionTutorExpressionPayload;
      readonly path: readonly string[];
      readonly optional: boolean;
    }
  | {
      readonly kind: "unary";
      readonly operator: "not" | "plus" | "minus" | "typeof";
      readonly operand: FunctionTutorExpressionPayload;
    }
  | {
      readonly kind: "binary";
      readonly operator:
        | "eq"
        | "neq"
        | "strict-eq"
        | "strict-neq"
        | "lt"
        | "lte"
        | "gt"
        | "gte"
        | "add"
        | "subtract"
        | "multiply"
        | "divide"
        | "modulo"
        | "in";
      readonly left: FunctionTutorExpressionPayload;
      readonly right: FunctionTutorExpressionPayload;
    }
  | {
      readonly kind: "logical";
      readonly operator: "and" | "or" | "nullish";
      readonly members: readonly FunctionTutorExpressionPayload[];
    }
  | {
      readonly kind: "conditional";
      readonly condition: FunctionTutorExpressionPayload;
      readonly whenTrue: FunctionTutorExpressionPayload;
      readonly whenFalse: FunctionTutorExpressionPayload;
    }
  | {
      readonly kind: "array";
      readonly items: readonly FunctionTutorExpressionPayload[];
    }
  | {
      readonly kind: "object";
      readonly entries: readonly {
        readonly key: string;
        readonly value: FunctionTutorExpressionPayload;
      }[];
    }
  | {
      readonly kind: "unsupported";
      readonly reason: FunctionTutorUnknownReasonPayload;
      readonly summary: string;
    };

export interface FunctionTutorParameterPayload {
  readonly id: string;
  readonly bindingId?: string;
  readonly name: string;
  readonly index: number;
  readonly callingMode:
    | "positional"
    | "positional-only"
    | "keyword-only"
    | "rest-positional"
    | "rest-keyword";
  readonly typeKind: FunctionTutorParameterTypePayloadKind;
  readonly typeText?: string;
  readonly optional: boolean;
  readonly rest: boolean;
}

export interface FunctionTutorScenarioSeedPayload {
  readonly id: string;
  readonly ordinal: number;
  readonly title: string;
  readonly source: "callsite" | "default" | "branch" | "type" | "mixed";
  readonly certainty: FunctionTutorPayloadCertainty;
  readonly inputs: readonly {
    readonly parameterId: string;
    readonly value: FunctionTutorStaticValuePayload;
    readonly omitted: boolean;
    readonly certainty: FunctionTutorPayloadCertainty;
    readonly evidenceTokens: readonly CodeFlowEvidenceToken[];
  }[];
  readonly objectiveIds: readonly string[];
  readonly evidenceTokens: readonly CodeFlowEvidenceToken[];
  readonly gapIds: readonly string[];
}

export type FunctionTutorOperationPayload =
  | {
      readonly kind: "define";
      readonly bindingId: string;
      readonly value: FunctionTutorExpressionPayload;
    }
  | {
      readonly kind: "assign";
      readonly target:
        | { readonly kind: "binding"; readonly bindingId: string }
        | {
            readonly kind: "member";
            readonly bindingId: string;
            readonly path: readonly string[];
          };
      readonly value: FunctionTutorExpressionPayload;
      readonly operator?: "set" | "add" | "subtract" | "multiply" | "divide";
    }
  | {
      readonly kind: "increment";
      readonly target:
        | { readonly kind: "binding"; readonly bindingId: string }
        | {
            readonly kind: "member";
            readonly bindingId: string;
            readonly path: readonly string[];
          };
      readonly delta: 1 | -1;
    }
  | {
      readonly kind: "effect";
      readonly effectKind: "call" | "render" | "event" | "external-write" | "yield";
      readonly summary: string;
      readonly certainty: FunctionTutorPayloadCertainty;
    }
  | {
      readonly kind: "unsupported";
      readonly summary: string;
      readonly reason: FunctionTutorUnknownReasonPayload;
    };

export interface FunctionTutorDecisionPayload {
  readonly expression: FunctionTutorExpressionPayload;
  readonly outcomes: readonly {
    readonly objectiveId?: string;
    readonly edgeId: string;
    readonly label: string;
    readonly matches:
      | { readonly kind: "boolean"; readonly value: boolean }
      | { readonly kind: "case"; readonly value: FunctionTutorStaticValuePayload }
      | { readonly kind: "default" }
      | { readonly kind: "exception" }
      | { readonly kind: "loop-exit" };
  }[];
}

export type FunctionTutorTerminalPayload =
  | { readonly kind: "return"; readonly value?: FunctionTutorExpressionPayload }
  | { readonly kind: "throw"; readonly value?: FunctionTutorExpressionPayload }
  | { readonly kind: "break" }
  | { readonly kind: "continue" }
  | { readonly kind: "exit" };

export interface FunctionTutorProgramPayload {
  readonly entryBlockId: string;
  readonly blocks: readonly {
    readonly blockId: string;
    readonly kind: FunctionLogicBlockPayloadKind;
    readonly label: string;
    readonly operations: readonly FunctionTutorOperationPayload[];
    readonly decision?: FunctionTutorDecisionPayload;
    readonly terminal?: FunctionTutorTerminalPayload;
    readonly embeddedRelation?: "immediate" | "defines" | "deferred";
    readonly evidenceToken?: CodeFlowEvidenceToken;
  }[];
  readonly edges: readonly {
    readonly edgeId: string;
    readonly sourceBlockId: string;
    readonly targetBlockId: string;
    readonly kind: FunctionLogicEdgePayloadKind;
    readonly label?: string;
    readonly certainty: FunctionTutorPayloadCertainty;
  }[];
  readonly bindings: readonly {
    readonly bindingId: string;
    readonly parameterId?: string;
    readonly name: string;
    readonly kind: "parameter" | "local" | "constant";
    readonly certainty: FunctionTutorPayloadCertainty;
  }[];
  readonly budgets: readonly {
    readonly name:
      | "expression-nodes"
      | "constraints"
      | "alias-hops"
      | "value-depth"
      | "value-items";
    readonly used: number;
    readonly limit: number;
    readonly truncated: boolean;
  }[];
}

export interface FunctionTutorEvidencePayload {
  readonly token: CodeFlowEvidenceToken;
  readonly kind:
    | "parameter-type"
    | "parameter-default"
    | "literal-union"
    | "enum-member"
    | "callsite-argument"
    | "branch-constraint"
    | "type-representative"
    | "embedded-code"
    | "fallback";
  readonly certainty: FunctionTutorPayloadCertainty;
  readonly summary: string;
  readonly sourceLabel?: string;
}

export interface FunctionTutorGapPayload {
  readonly id: string;
  readonly kind: FunctionTutorGapPayloadKind;
  readonly summary: string;
  readonly parameterId?: string;
  readonly blockId?: string;
  readonly evidenceTokens: readonly CodeFlowEvidenceToken[];
}
```

architecture test는
`src/protocol/functionTutor.ts`가 `src/analyzer/` 또는
`src/application/`을 import하지 않는지 검증한다.

`FunctionLogicPayload`에 optional field를 추가한다.

```ts
readonly tutor?: FunctionTutorPayload;
```

optional인 이유:

- 구버전 fixture와 payload compatibility
- 지원하지 않는 detail kind
- 분석 실패 격리

function target인데 tutor가 없으면 UI는 “unavailable” 상태를 보여주되 graph는
정상 작동한다.

### 18.2 protocol ID

Webview payload에서:

- function/block/edge/binding ID는 기존 projection의 opaque ID
- parameter ID도 session-scoped opaque ID
- evidence는 token
- file path와 raw analyzer range는 없음
- evidence opening은 기존 `Open source` message와 registry를 사용

analyzer 내부 ID나 source range를 protocol에 직접 spread하지 않는다.

### 18.3 value limits validation

projection 단계에서 runtime guard를 둔다.

- finite number
- string 최대 200자, 초과 시 표시용 truncate + gap
- array/object depth·size
- unique object keys
- prototype-sensitive key 거부
- known union `kind`
- block/edge/binding reference 존재 확인
- seed당 parameter 하나당 input 최대 하나

guard 실패:

- 개발 test에서는 명시적 error
- production publish에서는 Tutor payload만 제외하고 diagnostic count log
- Function Logic 전체 detail은 계속 전달

### 18.4 request message

초기 구현에는 새 Host request를 추가하지 않는다.

- Tutor 선언·seed·program은 bounded payload로 Function Logic detail과 함께 전달
- Webview 계산만 lazy
- source evidence 열기는 기존 request 사용

실제 측정에서 payload가 큰 경우에만 후속 SPEC으로 `codeFlow/requestTutor` lazy
message를 제안한다. 이번 구현자가 임의로 round trip protocol을 추가하지 않는다.

---

## 19. projection

`src/application/codeFlow/functionTutor/functionTutorProjection.ts`의 책임:

1. analyzer facts의 raw IDs를 기존 Function Logic projection ID map으로 변환
2. parameter ID를 opaque token으로 변환
3. source range를 evidence registry token으로 등록
4. IR binding/block/edge reference를 검증
5. value limit sanitize
6. stable order
7. fingerprint 생성
8. protocol payload 반환

projection input:

```ts
export interface FunctionTutorProjectionInput {
  readonly build: FunctionTutorBuildModel;
  readonly functionLogicProjectionIds: FunctionLogicProjectionIdMap;
  readonly evidenceRegistry: SourceEvidenceRegistry;
  readonly sessionId: string;
}
```

기존 `codeFlowFunctionLogicProjection.ts`가 ID map을 내부 local로만 갖고 있다면
다음처럼 분리한다.

- `FunctionLogicProjectionIdMap` 타입을 application 내부 public 파일로 이동
- Function Logic projection과 Tutor projection이 같은 map instance를 사용
- map creation은 한 번
- protocol import cycle이 생기지 않게 application 타입과 protocol 타입 분리

Tutor projection이 기존 payload를 다시 파싱해 ID를 추정하면 안 된다.

---

## 20. Host orchestration

### 20.1 새 orchestration helper

`codeFlowHostDelivery.ts`가 800줄에 접근하지 않게 다음 helper를 추가한다.

```text
src/webview/codeFlow/functionTutorHostDelivery.ts
```

책임:

1. target source/functionLogic을 입력으로 받음
2. declaration analyzer 실행
3. incoming callsite context 수집
4. candidate와 seed 계획
5. projection
6. diagnostic timing 반환

public 함수:

```ts
export async function buildFunctionTutorPayload(
  input: BuildFunctionTutorPayloadInput,
): Promise<FunctionTutorPayloadBuildResult>
```

Host helper가 Webview browser-source 코드에 의존하면 안 된다.

### 20.2 실패 격리

try/catch 경계:

- declaration parse
- caller file read
- 각 callsite parse
- candidate/seed planner
- projection validation

하나의 callsite 실패는 다른 tuple을 버리지 않는다. declaration 분석이 실패하면
Tutor unavailable 결과를 반환하지만 Function Logic publish는 계속한다.

### 20.3 진단

기존 output/log adapter가 있으면 다음 count/time만 debug level로 기록한다.

```text
function id hash
language
parameter count
incoming edge count
caller files read
callsite tuples accepted
scenario seed count
gap count by kind
analysis elapsed ms
payload byte estimate
```

기록 금지:

- parameter name/value
- source expression
- file path
- source text
- description text

---

## 21. Webview 상태 모델

### 21.1 상태

`src/webview/codeFlow/tutor/types.ts`:

```ts
export interface FunctionTutorUiState {
  readonly open: boolean;
  readonly status: "idle" | "computing" | "ready" | "empty" | "error";
  readonly selectedScenarioId?: string;
  readonly selectedPathId?: string;
  readonly expandedEvidence: boolean;
  readonly expandedLimits: boolean;
  readonly previewApplied: boolean;
  readonly errorMessage?: string;
}
```

computed result는 UI state와 분리된 cache에 둔다.

### 21.2 기존 comprehension state와 결합

- comprehension public controller에 `openTutor`, `closeTutor`,
  `isTutorOpen`만 노출한다.
- 렌즈 enum에 `"tutor"`를 추가하지 않는다.
- Tutor open 중 렌즈 control은 계속 보이고 작동한다.
- 렌즈 변경 시 Tutor panel은 열린 채 selected scenario를 유지한다.
- graph root/detail session 변경 시 Tutor selection과 cache는 reset한다.
- 일반 block selection은 Tutor open을 닫지 않는다.
- Inspector narrow mode에서 graph node를 선택하면 node detail을 우선 보여주고,
  `Back to Tutor` breadcrumb/button으로 돌아간다.

### 21.3 preview layer

Tutor attention은 다음 구조를 전달한다.

```ts
export interface FunctionTutorAttentionProjection {
  readonly scenarioId: string;
  readonly pathId: string;
  readonly blockIds: ReadonlySet<string>;
  readonly edgeIds: ReadonlySet<string>;
  readonly activeTransitionBlockId?: string;
  readonly certaintyByBlockId: ReadonlyMap<string, FunctionTutorCertainty>;
}
```

기존 branch choice와 value-flow classes를 직접 제거하거나 덮어쓰지 않는다.
새 `data-tutor-attention`/class namespace를 사용한다.

priority:

1. keyboard/source selected node
2. active value-flow playback hop
3. Tutor selected path attention
4. lens baseline

Tutor attention 때문에 기존 selected node의 source highlight가 바뀌면 안 된다.

---

## 22. UI 설계 계약

### 22.1 디자인 방향

Visitor mode는 **Operate + Read**다.

- 사용자는 Tutor 자체를 조작하는 것이 목적이 아니라 함수를 이해하는 것이
  목적이다.
- 기존 graph가 공간적 맥락을 담당하고 Tutor 표가 순서·비교·텍스트 대안을
  담당한다.
- VS Code semantic theme, 기존 font, spacing, border, button 언어를 보존한다.
- 별도 브랜드 palette, gradient, glassmorphism, 큰 hero, card grid, chat bubble,
  avatar, sparkle/AI icon을 추가하지 않는다.
- exact/inferred/unknown은 색뿐 아니라 label, icon shape 또는 border style로
  구분한다.
- 값 변화 숫자와 step 번호는 `font-variant-numeric: tabular-nums`.
- code identifier/value는 editor monospace token을 사용하고 `translate="no"`.

### 22.2 Tutor 진입점

기존 Inspector 또는 Function Logic toolbar의 의미 렌즈 옆 별도 action group에
`Tutor` text button을 추가한다.

DOM:

```html
<button
  type="button"
  class="function-tutor-toggle"
  aria-pressed="false"
  aria-controls="function-tutor-panel"
>
  Tutor
</button>
```

규칙:

- icon-only가 아니다. `Tutor` text를 항상 보인다.
- pressed/open, hover, active, focus-visible, disabled 상태를 구현한다.
- payload가 계산 중이어도 버튼을 disable하지 않는다. 열면 loading 상태를 보인다.
- target이 function이 아니면 native `disabled`로 focus를 제거하지 않고
  `aria-disabled="true"`와 `aria-describedby` reason을 사용한다. click/Enter/Space
  handler는 no-op이고 상태를 바꾸지 않는다.
- button을 열 때 panel heading에 programmatic focus를 강제로 옮기지 않는다.
  keyboard 사용자가 Enter로 열었을 때만 panel의 heading 또는 첫 scenario row로
  명시적 focus 이동을 고려하되 기존 toolbar roving focus를 깨지 않는다.

### 22.3 패널 topology

```text
┌ Static Tutor ─────────────────────────────── [Close] ┐
│ Static examples from types, defaults, and callsites.│
│ No source code is executed and no AI is used.       │
│ [6 scenarios] [8/10 branches] [2 unknowns] [Limited]│
├ Possible Scenarios ─────────────────────────────────┤
│ Scenario | Inferred Inputs | Possible Path | ...    │
│ selected row
├ Selected Scenario ──────────────────────────────────┤
│ deterministic description                           │
│ [Path 1 of 2] [Use These Inputs]                    │
│ Step | Statement | Target | Before → After | ...    │
├ Why These Inputs? ──────────────────────────────────┤
│ collapsed evidence disclosure                      │
├ Unknowns & Limits ──────────────────────────────────┤
│ collapsed unless material gaps exist               │
└─────────────────────────────────────────────────────┘
```

시각적 hierarchy:

1. scenario comparison table
2. selected scenario description
3. value transition table
4. evidence and limits disclosure

intro와 badges가 table보다 시각적으로 크거나 강하면 안 된다.

### 22.4 고정 안내 문구

패널 heading 바로 아래:

```text
Static examples from types, defaults, and callsites.
No source code is executed and no AI is used.
```

두 번째 문구는 첫 방문에만 숨기는 toast가 아니라 panel에 항상 남긴다.
“No tokens used”를 primary UI에 반복하지 않는다. About/help tooltip에는
`Runs locally without an LLM or token usage.`를 포함할 수 있다.

### 22.5 summary badges

순서:

1. `{N} scenarios`
2. `{covered}/{total} branch outcomes`
3. `{N} unknowns` — 0이면 표시하지 않아도 됨
4. `Limited` — budget/truncation이 있을 때만

badge는 button이 아니므로 pointer cursor나 hover affordance를 주지 않는다.
추가 설명이 필요하면 badge가 아니라 `Unknowns & Limits` disclosure에 둔다.
`total === 0`이면 `No branch outcomes`로 표시하고 `0/0`을 쓰지 않는다.

### 22.6 scenario table

wide layout columns:

| Column | 내용 | 폭/표시 규칙 |
|---|---|---|
| Scenario | title + source badge | 9–13rem, 2줄 허용 |
| Inferred Inputs | 최대 3개 `name = value`, 나머지 count | 가장 넓은 열, code wrap |
| Possible Path | primary branch phrase + `+N paths` | 2줄 |
| Changes | transition count, 주요 target | tabular number |
| Result | return/throw/exit/unknown | compact code value |
| Confidence | Exact/Inferred/Unknown | text label 포함 |

semantic markup:

```html
<div class="function-tutor-table-scroll" tabindex="0"
     aria-label="Possible scenarios table">
  <table>
    <caption class="sr-only">
      Statically inferred input scenarios and possible outcomes
    </caption>
    <thead>
      <tr>
        <th scope="col">Scenario</th>
        ...
      </tr>
    </thead>
    <tbody>
      <tr data-selected="true">...</tr>
    </tbody>
  </table>
</div>
```

행 선택 구현:

- `<tr>` 자체를 가짜 button으로 만들지 않는다.
- 첫 cell에 full-row selection 의미를 갖는 text `<button>`을 둔다.
- button의 accessible name:
  `Select {scenario title}: {compact input summary}`
- 선택 row는 background, left inset indicator, `aria-current="true"` 중 하나를
  button에 적용한다.
- row 내부 source link는 별도 `<button>` 또는 기존 source navigation action이며
  selection event와 충돌하지 않게 propagation을 명시적으로 처리한다.
- hover만으로 detail을 바꾸지 않는다.

keyboard:

- Tab으로 scenario button 사이를 이동할 수 있다.
- table controller에 focus가 있을 때 ArrowUp/ArrowDown으로 이전/다음 scenario,
  Home/End로 처음/마지막 scenario를 선택하는 roving tabindex를 구현한다.
- Enter/Space는 선택.
- Escape는 Tutor를 닫지 않고 임시 preview만 clear한다. Close button이 명시적
  닫기 동작이다.
- keyboard selection 후 선택 row가 scroll container 밖이면
  `scrollIntoView({ block: "nearest", inline: "nearest" })`; reduced motion 여부와
  무관하게 `behavior: "auto"`.

### 22.7 selected scenario header

구성:

- scenario title
- certainty badge
- deterministic description
- path selector
- `Use These Inputs` action
- optional `Clear Preview` action

path selector:

- path 하나: `1 possible path` text, control 없음
- path 2개 이상: native `<select>` 또는 compact segmented list
- v1은 native `<select>`를 사용한다.
- `<label for>` 제공
- VS Code foreground/background/border token을 명시하여 dark/light/HC에서 native
  select가 깨지지 않게 한다.
- option: `Path 1 · returns 100`, `Path 2 · result unknown`

`Use These Inputs`:

- specific text label 유지
- 복사 가능한 known parameter가 없으면 `aria-disabled="true"`로 동작을 막되
  keyboard focus는 유지
- disabled reason을 바로 아래 hint 또는 `aria-describedby`로 제공
- 성공 후 toast 대신 button 옆 `Inputs copied to Values.`를
  `role="status" aria-live="polite"`로 표시
- 2초 뒤 시각적으로 사라져도 screen reader announcement가 중복되지 않게
  state를 정리

### 22.8 값 변화 table

columns:

| Column | 의미 |
|---|---|
| Step | selected path의 순서 |
| Statement | block kind와 source-backed 짧은 label |
| Target | binding/member path |
| Before → After | 변환 값 |
| Certainty | Exact/Inferred/Unknown + 짧은 reason |

규칙:

- 변화가 없는 decision/effect step을 모두 이 표에 넣지 않는다.
- 값 변화 table은 transition만 보여준다.
- branch/effect/terminal은 description 아래 compact ordered step strip/list로
  별도 표시할 수 있다.
- before와 after가 deep equal이어도 source에 명시적 assignment가 있으면
  `unchanged assignment`로 표시하고 count에 포함한다.
- 값 formatter는 maximum depth·length를 지키며 full bounded value를 accessible
  label/title에 제공한다.
- unknown은 `?`만 단독 사용하지 않고 `Unknown`과 reason을 표시한다.
- source evidence가 있으면 Statement text를 source open button으로 만든다.
- source open은 기존 protocol action만 사용한다.

빈 변화 상태:

```text
No tracked value changes on this possible path.
Branches and the possible result are still shown above.
```

narrow `< 620px`에서는 scenario와 같은 dual representation 원칙으로 transition
table 대신 ordered list + definition list를 표시한다. 한 item은
Step → Statement → Target → Before → After → Certainty 순서다. before/after를
한 줄에 억지로 유지하지 않는다.

### 22.9 branch/effect step 요약

description과 transition table 사이에 최대 8개의 compact ordered steps를
표시한다.

```text
1  Check amount ≥ 100        True
2  Check member              True
3  Update discount           0 → 20
4  Return amount - discount  100
```

8개 초과:

- 첫 6개 + terminal 1개
- `Show all N steps` disclosure
- disclosure 내부는 ordered list
- 50개를 넘을 수 없도록 interpreter budget이 이미 제한하지만 DOM 생성 전
  defensive cap 240을 검사

### 22.10 Why These Inputs?

native `<details>`/`<summary>`를 우선 사용한다. 기존 browser runtime이 details
interaction을 충분히 지원하지 않으면 semantic button + region으로 구현한다.

각 parameter row:

```text
amount = 120
Exact callsite argument
Called from checkout.ts:42
[Open Source]
```

```text
member = false
Inferred branch boundary
Covers the false outcome of `if (member)`
[Open Source]
```

source path를 직접 문자열로 protocol에서 받지 않는다. display label은 evidence
registry가 허용한 workspace-relative label만 사용하거나 기존 source action의
label 정책을 재사용한다.

### 22.11 Unknowns & Limits

material gap이 있으면 heading 옆 count badge를 표시하고 disclosure를 기본
collapsed로 둔다. 단, 결과가 전부 unknown이거나 truncated면 기본 open한다.

gap group:

- Inputs
- Expressions
- Calls & external state
- Paths & loops
- Embedded code
- Language support

각 item은:

- 무엇을 알 수 없는가
- 왜 그런가
- 어떤 결과에 영향을 주는가
- source evidence action이 있는가

“Analysis failed” 같은 일반 문구만 보여주지 않는다.

### 22.12 responsive layout

Webview는 editor width가 유동적이므로 viewport width 기준으로 다음 topology를
쓴다.

wide `>= 920px`:

- 6-column scenario table
- transition 5-column table
- Inspector가 기존 wide adjacent layout을 유지

medium `620px–919px`:

- Scenario, Inputs, Result, Confidence 4 columns
- Possible Path와 Changes는 Scenario cell 아래 secondary line
- transition table에서 Statement/Target을 한 cell로 합친다.

narrow `< 620px`:

- wide/medium용 semantic table과 동일한 data/state에서 narrow용 `<ol>` +
  `<li>` + `<dl>` representation을 함께 생성한다.
- media query로 한 representation만 `display`한다. `display: none`인 쪽의
  interactive control은 accessibility tree와 tab order에서도 제외된다.
- narrow item의 scenario title은 selection `<button>`, 나머지 field는
  `<dt>/<dd>`로 label을 보존한다.
- CSS `::before` content만으로 label을 만들지 않는다.
- item 안 order:
  Scenario → Inputs → Path → Changes → Result → Confidence
- action은 full-width가 아니라 content-width로 유지하되 최소 target 높이는 기존
  VS Code control 규칙과 일치시킨다.
- table과 list가 각각 별도 selection state를 갖지 않게 controller의 단일
  `selectedScenarioId`를 구독한다.

table scroll:

- code value가 매우 길면 table 자체 scroll container만 `overflow-x: auto`
- page/root에 `overflow-x: hidden`으로 문제를 숨기지 말고 offending cell에
  `min-width: 0`, `overflow-wrap: anywhere` 적용
- scroll container는 keyboard focus 가능하고 visible focus를 갖는다.

### 22.13 상태별 UI

#### loading/computing

- heading과 intro는 즉시 표시
- panel region `aria-busy="true"`
- `Computing static scenarios…`를 `role="status"`로 한 번 알림
- layout shift가 크지 않도록 table header 아래 3개의 low-contrast skeleton row
- skeleton은 shimmer animation 금지; reduced motion과 무관한 정적 placeholder
- Close와 기존 graph interaction은 계속 가능

#### ready

- 첫 scenario를 자동 선택하되 keyboard focus는 이동하지 않는다.
- graph attention은 사용자가 행을 직접 선택하기 전에는 자동 적용하지 않는다.
- table과 selected detail 표시

#### empty

```text
No safe input examples could be inferred for this function.
The function graph is still available. Check Unknowns & Limits for the
unsupported types or expressions.
```

- “Retry” button은 같은 payload에서 의미가 없으므로 제공하지 않는다.
- source 근거가 있으면 `Open Function` action 제공

#### partial

- 가능한 scenario는 정상 표시
- `Partial`을 confidence badge로 새로 만들지 않고 `N unknowns`와 `Limited` 사용
- known 결과와 unknown reason을 같은 행에서 분리

#### error

```text
Static Tutor could not analyze this function.
The Function Logic graph is unchanged.
```

- internal exception text/stack 노출 금지
- 닫기와 Open Function 가능
- debug log location을 일반 사용자 copy에 넣지 않음

#### disabled/unavailable

- non-function target: `Tutor is available for function details.`
- missing payload: `Static Tutor is unavailable for this analysis result.`
- button disabled reason accessible

#### long/dense data

- parameter 12개, scenario 12개, transition 160개 fixture
- identifier/value wrap
- scenario table은 virtualize하지 않는다(최대 12)
- transition 160개는 initial selected path에서 40개만 render하고
  `Show next 40` progressive disclosure를 사용한다.
- `content-visibility`는 fake DOM/VS Code compatibility를 확인한 뒤에만 사용한다.

### 22.14 focus

- 모든 action은 native button/select/details 사용
- `:focus-visible`에 existing VS Code focus border
- `outline: none`은 동일 요소에 명확한 focus replacement가 있을 때만
- 선택 background와 focus ring을 별도 layer로 유지
- panel close 후 focus는 원래 Tutor toggle로 복원
- source를 열었다 돌아왔을 때 Webview state가 유지되면 이전 scenario button의
  roving tabindex를 유지
- programmatic rerender가 focused element를 매번 교체하지 않게 keyed DOM update
  또는 focus restoration을 구현

### 22.15 색과 certainty

기존 semantic token만 사용한다.

- exact: normal foreground + solid marker + `Exact`
- inferred: description foreground + dashed marker + `Inferred`
- unknown: warning foreground를 남용하지 않고 disabled/description foreground +
  hollow marker + `Unknown`
- error에만 error token
- `Limited`는 warning token 사용 가능
- selected: existing list active selection background/foreground

forced colors:

- `forced-color-adjust`를 무분별하게 끄지 않는다.
- marker는 border style과 text label을 유지한다.
- selected row는 `CanvasText` outline 또는 existing high contrast border.

### 22.16 motion

- panel open: 기존 Inspector transition이 있다면 그대로 재사용
- scenario selection: active row/graph attention opacity 120–180ms
- transform 이동, pulsing, travelling dot, 자동 재생 금지
- `transition: all` 금지; `opacity`, `background-color`, `border-color`만 명시
- user input 즉시 interrupt
- `prefers-reduced-motion: reduce`에서 duration 0
- initial render와 계산 중 animation 없음

### 22.17 UX copy 금지 표현

금지:

- `Executed path`
- `Actual value`
- `This will return`
- `AI analysis`
- `Smart prediction`
- `Most likely` — frequency 근거가 없음
- `Common input` — 관찰 근거가 없음
- `100% coverage`

사용:

- `Possible static path`
- `Inferred input`
- `Exact source literal`
- `Estimated value change`
- `May return`
- `Unknown from a dynamic call`
- `Limited to 3 loop iterations`

---

## 23. 접근성 acceptance contract

### 23.1 semantic requirements

- panel에 unique heading과 labelled region
- wide/medium scenario와 transition은 semantic table
- narrow scenario는 ordered list + definition list라는 동등한 text alternative
- column `th scope="col"`
- action은 button, source navigation은 기존 navigation semantic
- input/select에 visible label
- async status는 `aria-live="polite"`
- `aria-busy` 종료 보장
- decorative icon `aria-hidden="true"`
- identifier/value `translate="no"`
- status badge의 의미가 색에만 의존하지 않음

### 23.2 keyboard acceptance

keyboard만으로:

1. Tutor 열기
2. scenario table 진입
3. 다음/이전/처음/마지막 scenario 선택
4. path 변경
5. value transition source 열기
6. evidence disclosure 열기
7. `Use These Inputs`
8. preview clear
9. panel 닫기

focus trap은 만들지 않는다. Webview 전체 keyboard navigation과 공존한다.

### 23.3 screen reader announcement

알림 대상:

- 계산 시작/완료
- scenario 선택 시 `Selected {title}, {N} possible paths`
- input copy 성공/부분 성공
- error

알리지 않을 대상:

- graph 각 node class 변화
- hover
- badge 반복
- skeleton row

### 23.4 zoom, contrast, long content

- VS Code/Webview zoom 200%에서 전체 page horizontal scroll 없음
- table-specific scroll은 허용
- long identifier 120자, string value 200자 fixture
- light/dark/high contrast theme
- certainty label을 숨기지 않음
- editor font 크기 변경을 px 고정 height로 자르지 않음

---

## 24. 성능·메모리 acceptance contract

### 24.1 Host

대표 budget 최대 입력에서:

- incoming caller file 최대 6
- edge 최대 8
- parse/request scoped
- target Tutor 분석 목표 50ms median, 200ms p95를 초기 측정 기준으로 기록
- 이 수치는 release claim이 아니라 regression baseline

CI 환경 편차 때문에 wall-clock hard fail은 넓은 상한 fixture test에서만 사용한다.
주요 회귀 검사는 count/budget invariant다.

### 24.2 payload

- typical 함수 Tutor JSON 예상 50KB 이하
- hard defensive upper bound 500KB
- upper bound 초과 시 lower-priority evidence detail과 candidate를 stable order로
  줄이고 `value-budget`/`scenario-budget` gap
- program control structure와 selected seed를 먼저 보존
- string source excerpt 전체를 payload에 넣지 않음

### 24.3 Webview

- scenario table 최대 12 rows
- transition initial render 최대 40 rows
- DOM write batch
- render 중 `getBoundingClientRect`, `offsetHeight`, `offsetWidth` 반복 금지
- 실제 필요한 한 번의 scroll/focus 측정만 interaction 후 수행
- computation chunk 4ms yield
- detail replacement cancellation
- closed Tutor에서 interpreter 계산 없음

### 24.4 memory

- 현재 detail session 하나만 cache
- 이전 function cache 즉시 release
- path state가 complete되면 queue builder reference release
- evidence token map은 기존 detail lifecycle을 따름
- raw source를 Webview cache에 복제하지 않음

---

## 25. 보안·개인정보·무토큰 계약

### 25.1 금지 API

Tutor analyzer/application/Webview source에서 다음을 사용하지 않는다.

- `eval`
- `new Function`
- `vm`
- `child_process`
- dynamic user-source `import()`
- `fetch`
- `XMLHttpRequest`
- `WebSocket`
- OpenAI/Anthropic/LLM SDK
- clipboard/network 자동 전송
- hidden Webview form submit

기존 extension 전체에 해당 API가 있을 수 있으므로 architecture test는 Tutor
directory와 Tutor host helper import graph를 대상으로 한다.

### 25.2 source execution 금지

- source expression을 JavaScript string으로 변환해 실행하지 않음
- call expression을 interpreter가 invoke하지 않음
- constructor/getter/property method를 invoke하지 않음
- embedded code도 analyzer가 만든 IR만 읽음
- enum 값을 resolve하려고 module을 import하지 않음
- annotation/decorator/macro를 실행하지 않음

### 25.3 network와 토큰

- Tutor action은 Host message가 없어도 계산 가능
- source evidence open 외에는 외부/Host request 없음
- network dependency 없음
- LLM token counter나 API key setting 없음
- package dependency에 AI SDK 추가 없음

### 25.4 architecture test

Tutor source 파일을 읽어 다음 pattern을 금지하는 test를 추가한다.

```text
\beval\s*\(
new\s+Function\b
\bfetch\s*\(
XMLHttpRequest
WebSocket
child_process
from\s+["']openai
from\s+["']@anthropic
vscode\.postMessage
```

`eval`이라는 source feature label을 타입/string literal로 표현해야 하므로 단순
substring 금지가 아니라 executable-call pattern을 검사한다.

---

## 26. 구현 단계

각 단계는 “작업”, “테스트”, “완료 gate”를 모두 수행한다. 단계 번호를 건너뛰지
않는다.

### Phase 0 — baseline과 변경 경계 고정

#### 작업

1. 시작 시 `git status --short`를 기록하고 사용자 변경을 구분한다.
2. 다음 파일의 현재 line count를 기록한다.
   - `src/webview/codeFlow/functionLogicBrowserSource.ts`
   - `src/webview/codeFlow/codeFlowHostDelivery.ts`
   - `src/application/codeFlow/codeFlowFunctionLogicProjection.ts`
3. 관련 기존 test baseline을 실행한다.
   - Function Logic analyzer
   - Scenario evaluator
   - condition cases
   - Code Flow Webview
   - architecture tests
4. `PRODUCT.md`, `DESIGN.md`, `SPEC.MD`, 기존 cognitive-load plan의 Tutor 관련
   제약을 작업 노트에 요약한다.
5. 새 directory와 public dependency direction을 architecture test 초안으로
   먼저 고정한다.

#### 테스트

```bash
npm run check
npm test
```

전체 test가 이미 실패하면 이번 작업과 무관한 baseline failure를 정확히 기록하고
관련 test subset이 clean한지 확인한다. 기존 사용자 변경을 되돌리지 않는다.

#### 완료 gate

- 기존 failure와 신규 failure를 구분할 수 있음
- 수정 예정 파일과 새 파일 목록 확정
- 800줄에 가까운 파일에 Tutor 구현을 직접 넣지 않기로 test/구조에 반영

### Phase 1 — static value, IR, analyzer public types

#### 작업

1. `src/analyzer/functionTutor/types.ts`에 public analysis 타입을 추가한다.
2. `staticValue.ts`에 다음 pure helper를 구현한다.
   - constructor/guard
   - canonical sort
   - canonical stringify/hash input
   - depth/entry truncation
   - deep equality
   - safe compact display metadata가 아닌 analyzer-side debug formatter
3. `expressionIr.ts`에 IR node guard와 node budget counter를 구현한다.
4. `languages/types.ts`에 adapter interface를 구현한다.
5. `index.ts`에서 internal 파일을 deep import하지 않아도 되는 public export만
   제공한다.
6. 모든 파일 header와 주요 함수 comment를 작성한다.

#### 테스트

새 파일:

- `src/test/unit/functionTutorStaticValue.test.ts`
- `src/test/unit/functionTutorExpressionIr.test.ts`
- `src/test/unit/functionTutorArchitecture.test.ts`

case:

- finite number guard
- undefined/null distinction
- stable object key order
- nested depth 2
- array/object truncation
- prototype-sensitive key
- unknown reason preservation
- 400 IR node budget
- no recursive traversal
- analyzer module이 webview/vscode/protocol 구현을 import하지 않음

#### 완료 gate

- `npm run check`
- 새 unit tests 통과
- protocol이나 UI는 아직 변경하지 않음

### Phase 2 — TypeScript 선언 adapter와 program IR

#### 작업

1. TypeScript parser context를 생성하는 adapter를 구현한다.
2. parameter facts:
   - identifier, optional, default, rest, destructuring
   - primitive, union literal, enum, array/tuple, object member
3. constraint collector:
   - truthy/falsy
   - comparison/nullish/type/length
   - switch/ternary/logical
4. expression IR:
   - literal/binding/member/unary/binary/logical/conditional/array/object
   - assignment/definition/return/throw
   - unsupported call/effect
5. Function Logic block/edge range와 연결한다.
6. immediate/defines/deferred embedded relation을 program에 연결한다.
7. source order와 budget gap을 보존한다.

#### fixture

```text
src/test/fixtures/functionTutor/typescript/
  parameter-domains.ts
  branch-boundaries.ts
  object-mutations.ts
  loops-and-terminals.ts
  dynamic-gaps.ts
  embedded-eval.ts
```

`embedded-eval.ts`에는 다음을 포함한다.

- direct literal `eval` immediate block
- outer parameter read
- embedded local shadow
- embedded condition
- embedded mutation bridge
- defined/deferred code가 current path에 섞이지 않는 case
- dynamic eval string gap

#### 테스트

- fixture snapshot은 structured facts/IR을 검증
- label string이 아니라 range/ID가 맞는지 검증
- call expression이 unsupported effect이며 실행 IR이 아님
- compound condition과 short-circuit order
- source-order operations
- embedded node별 highlight 가능한 block ID
- async return/await gap과 generator yield
- budget/truncation

#### 완료 gate

- TypeScript/JavaScript fixture가 같은 adapter로 올바르게 분기
- dynamic expression이 guess 없이 gap
- 기존 Function Logic tests 무회귀
- source 파일별 800줄 미만

### Phase 3 — incoming callsite context와 TypeScript tuple

#### 작업

1. `FunctionTutorContextCollector`를 구현한다.
2. graph incoming call edge filtering/sort/dedup/budget을 구현한다.
3. caller file read cache를 request scope로 구현한다.
4. TypeScript call expression locator를 구현한다.
5. positional/default/rest argument mapping을 구현한다.
6. bounded immutable local alias resolver를 iterative worklist로 구현한다.
7. callsite tuple stable ID와 evidence를 만든다.
8. `functionTutorHostDelivery.ts` skeleton을 추가하되 아직 production payload에
   연결하지 않는다.

#### 테스트

새 파일:

- `functionTutorContextCollector.test.ts`
- `functionTutorTypescriptCallsites.test.ts`

case:

- exact literal tuple
- omitted default
- const alias 1–4 hop
- mutable alias unknown
- function call argument unknown
- spread known prefix/unknown rest
- member call target identity
- same name different symbol rejected
- duplicate edge
- inferred vs exact order
- 8 edge/6 file/4 tuple cap
- caller read failure isolation
- unsaved target snapshot preserved
- cycle in alias resolution

#### 완료 gate

- 서로 다른 callsite argument가 혼합되지 않음
- file read count가 budget 이하
- 하나의 parse/read failure가 전체 collector를 실패시키지 않음

### Phase 4 — candidate builder와 scenario planner

#### 작업

1. parameter kind별 candidate builder를 구현한다.
2. canonical value dedup을 구현한다.
3. constraint를 coverage objective로 변환한다.
4. baseline tuple builder를 구현한다.
5. objective-specific 최소 변경 tuple을 구현한다.
6. greedy selection과 deterministic tie-break를 구현한다.
7. seed title/certainty/evidence/gap을 생성한다.
8. fingerprint의 analyzer-side canonical input을 만든다.

#### 테스트

새 파일:

- `functionTutorCandidateBuilder.test.ts`
- `functionTutorScenarioPlanner.test.ts`
- `functionTutorScenarioStability.test.ts`

case:

- boolean false/true
- number boundary `99, 100, 101`
- string equality + empty + sample
- optional/null/undefined
- enum/literal union cap
- array length boundary
- object direct member variant
- recursive object cycle
- exact callsite precedence
- no Cartesian product
- objective coverage score
- max 12 scenarios
- zero parameter
- >12 parameter prioritization
- unknown-only partial seed
- 100 repeated runs identical ID/order snapshot

#### 완료 gate

- 어떤 fixture도 candidate Cartesian product를 생성하지 않음
- 모든 truncation에 gap
- exact tuple이 첫 순서에서 보존
- seed title이 runtime claim을 하지 않음

### Phase 5 — protocol과 projection

#### 작업

1. `src/protocol/functionTutor.ts`를 추가한다.
2. `FunctionLogicPayload.tutor?`를 추가한다.
3. 기존 projection에서 shared opaque ID map을 public application type으로
   분리한다.
4. Tutor projection을 구현한다.
5. evidence registry token 연결을 구현한다.
6. runtime payload validator를 구현한다.
7. payload size estimator와 stable trimming을 구현한다.
8. Host delivery에서 optional Tutor payload를 실제 detail에 포함한다.
9. declaration/collector/planner/projection 실패를 Function Logic delivery와
   격리한다.

#### 테스트

새 파일:

- `functionTutorProjection.test.ts`
- `functionTutorProtocol.test.ts`
- `functionTutorHostDelivery.test.ts`

기존 수정:

- `codeFlowDeliveryArchitecture.test.ts`
- `codeFlowProjection.test.ts`
- protocol runtime validation tests

case:

- raw file path 없음
- analyzer raw ID 없음
- 모든 program reference가 payload에 존재
- malformed value reject
- evidence token open mapping
- optional payload compatibility
- >500KB trim
- Tutor failure 후 Function Logic detail still published
- one Host detail message, no new Tutor request

#### 완료 gate

- 기존 Webview가 `tutor` field를 무시해도 정상 동작
- protocol JSON stringify 성공
- payload validator와 opaque ID tests 통과

### Phase 6 — Tutor expression evaluator와 interpreter

#### 작업

1. 기존 Scenario evaluator의 공유 가능한 value helper를 안전하게 추출한다.
2. 기존 tests를 먼저 통과시켜 behavior 변화가 없음을 확인한다.
3. structured IR evaluator를 구현한다.
4. iterative path queue를 구현한다.
5. operation/transition/effect/terminal 결과를 구현한다.
6. unknown condition fork를 구현한다.
7. loop visit/state hash/budget을 구현한다.
8. embedded immediate bridge를 구현한다.
9. cancellation generation과 chunk scheduler를 구현한다.
10. primary path selection을 구현한다.

#### 테스트

새 파일:

- `functionTutorExpressionEvaluator.test.ts`
- `functionTutorInterpreter.test.ts`
- `functionTutorInterpreterLoops.test.ts`
- `functionTutorInterpreterEmbedded.test.ts`
- `functionTutorInterpreterBudgets.test.ts`

case:

- scalar arithmetic/comparison/logical short circuit
- invalid mixed coercion
- object/array read/write
- prototype guard
- define/set/compound/increment
- condition interleaved with mutation
- known branch one path
- unknown branch bounded fork
- switch/default
- return/throw
- effect not executed
- loop false/true/unknown
- break/continue
- stable-state cycle
- embedded immediate, shadowing, bridge
- defines/deferred excluded
- async resolve wording 재료와 generator yield effect
- max paths/steps/transitions/states
- cancellation before/after chunk
- deterministic primary path

#### 완료 gate

- interpreter 구현에 재귀 없음
- executable `eval`/`new Function` 없음
- 기존 manual Scenario evaluator tests 무회귀
- max fixture가 bounded time에 종료

### Phase 7 — description과 formatter

#### 작업

1. `functionTutorCopy.ts`에 모든 fixed UI copy를 모은다.
2. value compact/full formatter를 구현한다.
3. input/branch/change/terminal phrase builder를 구현한다.
4. 240자 clause budget을 구현한다.
5. unknown/truncated/multi-path templates를 구현한다.
6. runtime 확정 표현 guard를 test helper로 추가한다.

#### 테스트

새 파일:

- `functionTutorDescription.test.ts`
- `functionTutorValueFormatter.test.ts`

case:

- zero/1/3/4+ inputs
- long identifier/value
- no branches/no changes/no terminal
- known return/throw
- multiple paths
- unknown count
- truncated
- embedded step
- exact source literal이 runtime certainty로 표현되지 않음
- forbidden words regex
- text length 240 이하
- `…` 사용

#### 완료 gate

- 모든 scenario result에 비어 있지 않은 description
- forbidden runtime claim 없음
- formatter가 HTML을 생성하지 않음

### Phase 8 — Tutor panel과 상태 controller

#### 작업

1. `src/webview/codeFlow/tutor/` public composer를 추가한다.
2. comprehension controller에 Tutor open/close public method만 연결한다.
3. header/Inspector에 `Tutor` text button을 추가한다.
4. loading/ready/empty/partial/error/unavailable 상태를 렌더링한다.
5. scenario semantic table을 구현한다.
6. row selection·roving keyboard·scroll behavior를 구현한다.
7. selected description/path selector를 구현한다.
8. transition table과 progressive rows를 구현한다.
9. evidence/limits disclosure를 구현한다.
10. `Use These Inputs` adapter를 기존 Scenario editor public API에 연결한다.
11. source open을 기존 evidence action에 연결한다.
12. Tutor attention projection을 graph presentation layer에 추가한다.
13. selected node/value playback/branch choice 우선순위를 구현한다.
14. wide/medium/narrow CSS를 구현한다.
15. reduced motion/forced colors/focus-visible을 구현한다.

#### 파일 길이

- `functionLogicBrowserSource.ts`에는 composer 연결만 추가
- Tutor browser-source 한 파일이 650줄을 넘으면 controller/table/attention을
  즉시 분리
- CSS도 panel/table/responsive가 혼합되어 650줄을 넘으면 styles module 분리

#### 테스트

새 파일:

- `functionTutorWebview.test.ts`
- `functionTutorKeyboard.test.ts`
- `functionTutorAttention.test.ts`
- `functionTutorAccessibilityArchitecture.test.ts`
- `functionTutorResponsiveArchitecture.test.ts`

기존 수정:

- `codeFlowWebview.test.ts`
- `currentFunctionVisualizationArchitecture.test.ts`
- `sourceHighlightArchitecture.test.ts`

case:

- button aria-pressed/controls
- panel intro/no-AI copy
- loading aria-busy/live
- semantic table/caption/th
- row button and accessible name
- Arrow/Home/End
- selection does not mutate lens/manual Scenario
- Escape clears preview only
- close restores toggle focus
- path selector label
- copy success/partial/disabled
- transition no-data state
- evidence source action
- unknown default open condition
- narrow ordered-list topology와 단일 tab order
- long text wrapping
- exact/inferred/unknown text labels
- reduced motion
- no `transition: all`
- no clickable div/span
- no unexpected Host message

#### 완료 gate

- fake DOM tests 통과
- 기존 Flow/Values/Calls/Effects 동작 무회귀
- Tutor 선택으로 source를 자동 열지 않음
- graph attention이 selected/source/value playback state를 파괴하지 않음

### Phase 9 — Python adapter

#### 작업

1. Python parameter facts와 calling mode를 구현한다.
2. annotation/default/optional/literal domain을 구현한다.
3. constraint/IR를 구현한다.
4. positional/named/keyword-only/varargs callsite mapping을 구현한다.
5. Python-specific gap을 구현한다.
6. common planner/interpreter를 그대로 사용하고 Python-specific evaluator
   분기를 Webview에 넣지 않는다.

#### fixture

```text
src/test/fixtures/functionTutor/python/
  parameter_domains.py
  named_calls.py
  branch_boundaries.py
  mutations_and_loops.py
  dynamic_gaps.py
```

#### 테스트

- annotation 없음 + callsite literal
- Optional/Literal/list/dict/tuple
- default/omitted/explicit None
- named/keyword-only
- `*args`, `**kwargs`
- truthiness/is None/in/len
- mutation/rebind
- arbitrary call unknown
- decorator gap

#### 완료 gate

- Python fixture에서 meaningful scenario 또는 explicit gap
- TypeScript-specific syntax가 common layer에 누출되지 않음

### Phase 10 — Java adapter

#### 작업

1. primitive/boxed/String/array/enum/record facts
2. parameter/varargs
3. constraints/switch/IR
4. callsite overload validation과 tuple mapping
5. null/object gap

#### fixture

```text
src/test/fixtures/functionTutor/java/
  ParameterDomains.java
  OverloadedCalls.java
  BranchBoundaries.java
  MutationsAndLoops.java
  DynamicGaps.java
```

#### 테스트

- primitive boundaries/ranges
- boxed null
- enum case
- array length/String length
- varargs
- overload accepted/rejected
- record direct field
- method/getter unknown
- loop budget

#### 완료 gate

- ambiguous overload가 잘못된 exact tuple을 만들지 않음
- numeric candidate가 Java type range를 넘지 않음

### Phase 11 — F# / OCaml / Elixir adapter

#### 작업

1. dialect strategy registry를 구현한다.
2. function parameter, literal, direct branch, binding, terminal IR을 구현한다.
3. same-file variant/DU/atom candidate를 구현한다.
4. pattern/guard bounded 분석을 구현한다.
5. unsupported parser structure에 명시적 language gap을 반환한다.
6. 각 언어 callsite에서 안전한 literal tuple만 구현한다.

#### fixture

```text
src/test/fixtures/functionTutor/functional/
  tutor_pipeline.fs
  tutor_pipeline.ml
  tutor_pipeline.ex
```

각 fixture:

- bool/number/string
- if/case/match
- literal/variant/atom
- local binding 변화
- return-like terminal
- unsupported dynamic call

#### 완료 gate

- 세 언어 모두 Tutor payload를 반환
- 의미 있는 근거가 없으면 empty + named gap
- dialect 간 literal semantics를 string parsing으로 뭉개지 않음

### Phase 12 — hardening, performance, architecture

#### 작업

1. 모든 budget boundary fixture를 추가한다.
2. malformed payload fuzz-like table tests를 추가한다.
3. Tutor import graph와 forbidden API architecture test를 완성한다.
4. file length architecture check에 새 source를 포함한다.
5. cancellation/race tests를 추가한다.
6. payload size·Host elapsed·Webview chunk instrumentation을 측정한다.
7. duplicate helper를 정리하되 public contract를 바꾸지 않는다.
8. error copy와 recovery를 점검한다.

#### 테스트

- 12 parameters
- 64 constraints
- 8 callsites/6 files
- 12 scenarios
- 8 paths/scenario
- 240 steps/path
- 160 transitions
- graph cycle
- alias cycle
- type cycle
- missing block/edge/binding
- duplicate/stale evidence
- detail A 계산 중 detail B 도착
- Tutor close during compute
- repeated open uses cache
- new fingerprint invalidates cache

#### 완료 gate

- hard fixture가 무한 loop/stack overflow 없이 종료
- old detail DOM write 없음
- Tutor source 금지 API test 통과
- 모든 implementation source 800줄 미만

### Phase 13 — 문서, 실제 UI 검증, release gate

#### 문서

다음을 갱신한다.

- `SPEC.MD`
  - Static Tutor product truth
  - analysis/protocol/budget/certainty
  - UI/state/accessibility contract
- `PRODUCT.md`
  - tokenless static tutor capability
- `DESIGN.md`
  - 기존 value-flow 디자인을 유지하며 Tutor reading mode 계약 추가
- `README.md`
  - 사용자 기능 요약과 제한
- 필요하면 `docs/`의 architecture 문서

문구는 “실행”이나 “AI 생성 설명”으로 표현하지 않는다.

#### 자동 검증

```bash
npm run check
npm test
npm run package:check
```

package artifact까지 바뀌는 경우:

```bash
npm run release:check
```

#### 실제 VS Code/Webview 기능 QA

다음 fixture function을 각각 연다.

1. TypeScript exact callsite + branch boundary
2. TypeScript embedded eval
3. Python named/default
4. Java overload/enum
5. F#/OCaml/Elixir 최소 지원
6. unknown-only dynamic input
7. maximum dense fixture

각 fixture에서:

- Tutor open/close
- compute/cancel/cache
- scenario row/path selection
- graph attention
- source evidence open
- `Use These Inputs`
- branch choice/manual Scenario 보존
- value playback 공존
- empty/partial/limited/error

#### viewport

실제 rendered Webview를 다음 representative content width에서 확인한다.

- narrow: 약 390px
- medium: 약 768px
- wide: 약 1440px

VS Code sidebar/editor layout 때문에 정확한 browser viewport가 content width와
다를 수 있으므로 screenshot과 실제 panel content width를 함께 기록한다.

#### theme/a11y

- VS Code light
- VS Code dark
- high contrast 또는 forced-colors 가능한 환경
- 200% zoom
- keyboard-only
- reduced motion
- screen reader가 가능하면 heading/table/status smoke test

#### 시각 QA 완료 gate

- 텍스트 겹침, 잘림, page-level horizontal overflow 없음
- selected/focus/hover/disabled 구분
- dense table scan 가능
- graph와 Tutor가 동시에 너무 강하게 강조되지 않음
- unknown/limited가 warning red sea가 되지 않음
- 실제로 확인하지 않은 viewport/theme/a11y를 완료했다고 기록하지 않음

#### Impeccable/Web guideline 검사

UI 구현이 끝난 뒤 한 번만 detector를 실행한다.

```bash
node /Users/lky/.agents/skills/impeccable/scripts/detect.mjs \
  --json src/webview/codeFlow/tutor \
  src/webview/codeFlow/inspector \
  src/webview/codeFlow/comprehension
```

최신 Web Interface Guidelines로 changed UI 파일을 검토한다.

- semantic actions
- label/aria-live
- focus-visible
- reduced motion
- explicit transitions
- long content/overflow
- table semantics
- no layout reads in render

#### 최종 완료 gate

- 자동 test 전체 통과
- 실제 기능·시각 QA 기록
- 문서 갱신
- 알려진 제한을 release note에 명시
- Definition of Done 전 항목 통과

---

## 27. 파일별 변경 체크리스트

구현자는 실제 repository 구조가 이미 분리되어 있는 경우 가장 가까운 public
module을 재사용할 수 있다. 하지만 아래 책임은 반드시 존재해야 한다.

### 27.1 analyzer

#### `src/analyzer/functionTutor/index.ts`

- public types와 `analyzeFunctionTutorDeclaration`만 export
- language internal helper export 금지
- file header public/internal boundary comment

#### `types.ts`

- analyzer public domain types
- protocol import 금지
- VS Code API import 금지

#### `staticValue.ts`

- safe value constructors/guards
- canonicalization
- bounded traversal
- no recursive traversal

#### `expressionIr.ts`

- IR types/guards
- node budget
- executable code 없음

#### `functionTutorAnalyzer.ts`

- adapter registry dispatch
- error isolation
- declaration analysis 합성
- UI copy 생성 금지

#### language files

- parameter, constraint, IR, callsite 책임 분리
- parser-specific type는 language folder 밖으로 노출 금지
- source label 파싱 금지

### 27.2 application

#### `functionTutorContextCollector.ts`

- graph/readSourceText adapter orchestration
- bounded incoming edge/file selection
- no UI/protocol formatting

#### `functionTutorCandidateBuilder.ts`

- parameter fact → candidate
- deterministic order/dedup

#### `functionTutorScenarioPlanner.ts`

- objective
- baseline
- greedy selection
- titles are short deterministic labels only

#### `functionTutorCoverage.ts`

- objective scoring/coverage summary
- interpreter result coverage와 analyzer objective를 ID로 연결

#### `functionTutorProjection.ts`

- opaque ID/evidence
- protocol value sanitize
- reference validation

#### `functionTutorFingerprint.ts`

- canonical fingerprint
- raw file path/source 미포함

### 27.3 protocol

#### `src/protocol/functionTutor.ts`

- JSON-safe readonly types
- runtime guard 또는 guard public surface
- analyzer implementation import 금지

#### `src/protocol/functionLogic.ts`

- optional `tutor?` 한 필드
- 기존 field 의미 변경 금지

### 27.4 Host

#### `functionTutorHostDelivery.ts`

- target declaration + incoming callsite + planner + projection
- failure isolation
- cancellation/generation
- bounded diagnostics

#### `codeFlowHostDelivery.ts`

- helper 호출
- payload 연결
- 기존 Function Logic delivery lifecycle 유지
- Tutor details 직접 구현 금지

### 27.5 Webview

#### `functionTutorBrowserSource.ts`

- browser script composer
- dependency source order
- CSP compatible

#### `functionTutorControllerBrowserSource.ts`

- UI state/cache/generation
- open/close/compute/select/copy
- renderer details를 과도하게 포함하지 않음

#### `functionTutorInterpreterBrowserSource.ts`

- iterative path engine
- DOM 접근 없음
- Host message 없음

#### `functionTutorExpressionBrowserSource.ts`

- pure IR evaluator
- source execution 없음

#### `functionTutorDescriptionBrowserSource.ts`

- pure template
- DOM 접근 없음

#### `functionTutorTableBrowserSource.ts`

- semantic DOM construction
- keyboard
- table/detail/disclosures
- 모든 source text는 `textContent`

#### `functionTutorAttentionBrowserSource.ts`

- graph class/data attribute projection
- existing presentation priority 준수
- source navigation 없음

#### `functionTutorStyles.ts`

- VS Code tokens
- responsive
- focus/reduced motion/forced colors
- no hardcoded brand palette

#### `functionTutorCopy.ts`

- fixed English copy
- runtime certainty 금지 문구 검토

### 27.6 tests

각 production module에는 가장 가까운 pure unit test를 둔다. browser-source는 기존
fake DOM runtime을 재사용하고 새 jsdom dependency를 추가하지 않는다.

---

## 28. 전체 테스트 매트릭스

### 28.1 입력 추론

| Case | 기대 결과 |
|---|---|
| type only boolean | false/true inferred candidates |
| type only number | 0/1/-1 inferred baseline |
| default scalar | exact declaration candidate |
| exact call literal | first exact callsite scenario |
| immutable alias call | inferred callsite scenario |
| mutable alias call | unknown dynamic/ambiguous |
| literal union | source-order candidates |
| enum | member candidates |
| optional | omitted/undefined or language equivalent |
| nullable | null + non-null representative |
| object required fields | depth-2 bounded baseline |
| object optional fields | objective-specific variant only |
| recursive type | cycle cut + unknown |
| callback | unknown, never invoked |
| too many parameters | referenced-first + gap |

### 28.2 constraint

| Expression | Candidates/objectives |
|---|---|
| `if (flag)` | false, true |
| `amount >= 100` | 99, 100, 101 |
| `count < 0` | -1, 0, 1 as applicable |
| `status === "ready"` | ready + non-equal baseline |
| `value == null` | nullish/non-nullish |
| `items.length > 0` | empty/non-empty |
| `typeof x === "string"` | type-is branch; unknown if union unavailable |
| `switch mode` | literal cases + default |
| `a && b` | short-circuit objectives without full product |
| user call predicate | unknown, fork bounded |

### 28.3 execution

| Case | 기대 결과 |
|---|---|
| define local | Not defined → value |
| simple assignment | before → after |
| compound assignment | calculated transition |
| increment/decrement | ±1 |
| object member write | safe own path update |
| prototype key | rejected + gap |
| condition after mutation | mutated environment used |
| known branch | one path |
| unknown branch | bounded multiple paths |
| return | possible return |
| throw | possible throw |
| call | possible effect, no execution |
| loop false | zero body iteration |
| loop true with break | bounded body + exit |
| infinite/static true | loop limit |
| control cycle | state hash guard |
| missing edge | unknown terminal |

### 28.4 embedded eval

| Case | 기대 결과 |
|---|---|
| literal immediate eval | inner blocks included |
| outer parameter read | lexical bridge known |
| inner local shadow | outer binding unchanged |
| inner direct bridge write | outer transition when analyzer says bridge |
| inner branch | node-level branch attention |
| dynamic eval string | never execute; gap |
| defined function string | current path excludes body |
| deferred callback string | current path excludes body |

### 28.5 UI

| State/interaction | 기대 결과 |
|---|---|
| open | panel, no automatic graph attention |
| first compute | busy → ready |
| reopen | cache, no recompute |
| new detail | cancel/reset |
| select row | table/detail/graph sync |
| select alternate path | detail/attention sync |
| Escape | preview only clear |
| close | focus returns, lens preserved |
| Use These Inputs | known values copied, Values lens |
| unknown-only input | disabled/partial explanation |
| source evidence | existing source action |
| manual Scenario exists | not overwritten without action |
| branch choice exists | preserved |
| value playback active | higher attention priority |
| narrow | stacked labelled rows |
| long content | wrap/table-local scroll |
| reduced motion | no transition |
| high contrast | text/border certainty visible |

### 28.6 failure

| Failure | 격리 |
|---|---|
| declaration parse | Tutor unavailable; graph remains |
| one caller read | other callers remain |
| one callsite parse | tuple omitted + gap |
| projection invalid ref | Tutor payload omitted |
| interpreter malformed block | selected scenario error/gap |
| DOM render exception | Tutor error panel; graph remains |
| stale compute completion | ignored by generation |
| payload over limit | stable trim + Limited |

---

## 29. 대표 acceptance fixture

### 29.1 할인 계산

```ts
export function calculateDiscount(
  amount: number,
  member: boolean,
): number {
  let discount = 0;
  if (amount >= 100) {
    discount += 10;
  }
  if (member) {
    discount += 10;
  }
  return amount - discount;
}

calculateDiscount(120, true);
calculateDiscount(getAmount(), false);
```

필수 seed:

1. exact callsite `(120, true)`
2. dynamic partial `(unknown, false)`
3. amount below boundary `(99, baseline member)`
4. amount at boundary `(100, baseline member)`
5. member opposite outcome를 덮는 최소 시나리오

모든 `amount × member` product를 만들 필요는 없다. 최대 12개 안에서 각 branch
true/false objective를 덮으면 된다.

exact callsite 예상 primary path:

```text
discount: Not defined → 0
discount: 0 → 10
discount: 10 → 20
return: 100
```

예상 description:

```text
With amount = 120 and member = true, this possible static path enters
both discount branches, changes discount from 0 to 20, and may return 100.
```

### 29.2 object state

```ts
type Order = {
  status: "pending" | "ready";
  total: number;
};

export function prepareOrder(order: Order, approved?: boolean) {
  if (!approved) {
    return { ok: false, status: order.status };
  }
  order.status = "ready";
  order.total += 5;
  return { ok: true, status: order.status };
}

prepareOrder({ status: "pending", total: 20 }, true);
```

필수:

- exact object callsite
- approved true/false/omitted
- direct member transition
- input object baseline depth 2
- `Use These Inputs`로 bounded JSON 복사 가능
- mutation은 실제 external heap write라고 확정하지 않고 tracked object estimate로
  표현

### 29.3 dynamic unknown

```ts
export function route(request: RequestLike) {
  const role = request.getRole();
  if (role === "admin") {
    audit(request);
    return "admin";
  }
  return "user";
}
```

필수:

- `request.getRole()`을 실행하지 않음
- role condition unknown
- 최대 2 possible paths
- audit는 possible call effect
- input object를 임의로 `{ role: "admin" }`으로 꾸며내지 않음
- description에 unknown count

### 29.4 embedded code

```ts
export function evaluateRule(score: number) {
  let label = "low";
  eval(`
    if (score >= 10) {
      label = "high";
    }
  `);
  return label;
}
```

기존 embedded analyzer가 이 literal을 immediate program으로 확장했다는 전제에서:

- boundary 9/10/11
- outer `score` bridge
- inner condition node 강조
- `label` transition
- return estimate

동일 코드가 dynamic template substitution, variable string, deferred relation이면
실행하지 않고 gap을 표시한다.

### 29.5 loop

```ts
export function sumPositive(values: number[]) {
  let total = 0;
  for (const value of values) {
    if (value < 0) {
      break;
    }
    total += value;
  }
  return total;
}
```

필수:

- empty and one-element inferred array candidates only if element domain known
- arbitrary list 길이/값을 완전 탐색하지 않음
- 3 iteration limit
- transition history
- unknown element이면 body/exit bounded fork
- `Limited to 3 loop iterations` gap when relevant

---

## 30. 회귀 방지 불변 조건

1. 기존 Function Logic payload field의 의미를 바꾸지 않는다.
2. 기존 Values Scenario editor는 Tutor 없이 동일하게 작동한다.
3. 기존 branch choice는 Tutor preview로 mutate되지 않는다.
4. 기존 value-flow playback은 Tutor attention보다 높은 active-hop 우선순위를
   갖는다.
5. Tutor 행 선택은 source를 자동으로 열지 않는다.
6. Tutor 계산은 Host message를 보내지 않는다.
7. source evidence action만 기존 Host message를 사용한다.
8. incoming callsite 수집은 현재 graph snapshot budget 밖으로 repository를
   traversal하지 않는다.
9. raw source/file path는 Tutor protocol에 없다.
10. exact/inferred/unknown을 하나의 boolean confidence로 축약하지 않는다.
11. static result를 runtime result로 표현하지 않는다.
12. unknown을 UI 편의를 위해 guessed literal로 바꾸지 않는다.
13. language adapter 오류가 Function Logic graph를 막지 않는다.
14. embedded immediate/defines/deferred 의미를 합치지 않는다.
15. 모든 traversal은 반복 기반이며 visited/budget을 갖는다.
16. 모든 새 implementation source는 800줄 미만이다.
17. user-visible action은 semantic control이다.
18. light/dark/high contrast에서 색 외 certainty 단서가 있다.
19. reduced motion에서 transition이 없다.
20. LLM/network/source execution dependency가 없다.

---

## 31. 위험과 고정 대응

### 위험 1 — symbolic execution 범위가 계속 커짐

대응:

- 공통 IR allowlist 고정
- unsupported gap을 정상 결과로 취급
- interprocedural call 실행 금지
- v1 constraint는 parameter/direct member만

### 위험 2 — scenario 조합 폭발

대응:

- callsite tuple 보존
- objective-specific 최소 변경
- greedy coverage
- max 12
- no Cartesian product architecture/unit test

### 위험 3 — UI가 runtime 실행처럼 보임

대응:

- 고정 no-run copy
- `possible/static/may`
- certainty provenance
- forbidden copy tests
- 실제 runtime frequency/likelihood 없음

### 위험 4 — 기존 graph의 인지 부담 증가

대응:

- Tutor는 별도 Inspector mode
- 첫 render 자동 attention 없음
- 한 selected path만 임시 강조
- 기존 lens/layout 유지
- table이 graph의 텍스트·순서 대안

### 위험 5 — 여러 attention layer 충돌

대응:

- 명시적 presentation priority
- Tutor namespace class/data attribute
- clear/close restore test
- selected source/value playback 우선

### 위험 6 — callsite edge가 정확하지 않음

대응:

- adapter가 source AST로 target을 재검증
- exact/resolved 우선
- 불확실하면 tuple 거부 + gap
- 이름-only match 금지

### 위험 7 — object mutation이 alias/heap 의미를 과장

대응:

- bounded local environment estimate라고 문구
- external alias propagation 없음
- getter/proxy unknown
- direct own member only

### 위험 8 — 언어별 parser 능력 차이

대응:

- adapter public contract 통일
- common Webview IR
- 언어별 explicit gap
- silent fallback 금지
- 모든 지원 언어 fixture

### 위험 9 — Host/Webview latency

대응:

- bounded caller reads
- payload eager, computation lazy
- 4ms chunk
- generation cancellation
- one-session cache
- count/timing instrumentation

### 위험 10 — 기존 큰 파일 악화

대응:

- 새 feature folder
- Host helper
- browser composer only
- architecture line-count test

---

## 32. 구현 중 판단이 필요한 경우의 우선순위

문서에 없는 세부 충돌이 발생하면 다음 순서로 결정한다.

1. 사용자 source 안전과 무실행 계약
2. exact/inferred/unknown 근거 보존
3. bounded 종료와 UI responsiveness
4. 기존 Function Logic/Scenario behavior 보존
5. analyzer/application/protocol/Webview 의존성 방향
6. keyboard와 semantic alternative
7. stable deterministic output
8. 더 많은 추론 coverage
9. 시각적 polish

더 많은 scenario를 보여주기 위해 안전·certainty·budget을 희생하지 않는다.

---

## 33. 구현자가 만들지 말아야 할 것

- Tutor chat box
- prompt input
- AI badge/sparkle
- “Generate explanation” button
- source code를 Webview에서 실행하는 sandbox
- test runner 연결
- call graph 전체 재탐색
- 새 graph layout
- fifth semantic lens
- 모든 parameter candidate 조합
- likelihood score
- branch percentage
- fabricated sample domain based on parameter name
- raw file path protocol
- uncontrolled debug source logging
- Tutor 전용 parallel design system
- React/Vue 도입
- 새 chart library
- 장식용 animated graph

---

## 34. 권장 작업 세션 경계

멀티 세션으로 구현하더라도 각 세션은 다음 경계에서 끝낸다. 중간에 compile이
깨진 상태로 인계하지 않는다.

| Session | 범위 | 인계 산출물 |
|---|---|---|
| 1 | Phase 0–1 | baseline, types, value/IR tests |
| 2 | Phase 2 | TS declaration/program adapter |
| 3 | Phase 3–4 | callsites, candidates, seeds |
| 4 | Phase 5 | protocol, projection, Host payload |
| 5 | Phase 6 | interpreter |
| 6 | Phase 7–8 core | copy, panel, table |
| 7 | Phase 8 integration | graph attention, Scenario copy, a11y |
| 8 | Phase 9 | Python |
| 9 | Phase 10 | Java |
| 10 | Phase 11 | functional languages |
| 11 | Phase 12 | hardening/performance |
| 12 | Phase 13 | docs, browser/VS Code QA, full gate |

각 인계 note:

- 완료 phase/gate
- 변경 파일
- 실행 test와 결과
- known gaps
- 다음 정확한 시작 파일/함수
- dirty worktree에서 사용자 소유 변경과 Tutor 변경 구분

---

## 35. Definition of Done

### 분석

- [ ] 선언 타입·annotation·default에서 bounded candidate를 만든다.
- [ ] 정적 incoming callsite tuple을 보존한다.
- [ ] direct branch constraint boundary를 만든다.
- [ ] 모든 candidate에 provenance/certainty/evidence가 있다.
- [ ] Cartesian product 없이 최대 12 scenario를 만든다.
- [ ] 모든 지원 언어가 scenario 또는 explicit gap을 반환한다.

### interpreter

- [ ] structured IR만 계산한다.
- [ ] mutation과 condition을 source order로 계산한다.
- [ ] unknown branch를 bounded fork한다.
- [ ] loop/cycle/path/step/value budget이 있다.
- [ ] return/throw/effect/embedded semantics가 구분된다.
- [ ] 호출·eval·사용자 코드를 실행하지 않는다.
- [ ] cancellation과 deterministic cache가 동작한다.

### protocol/architecture

- [ ] Tutor payload는 JSON-safe다.
- [ ] raw path/analyzer ID가 없다.
- [ ] evidence token을 사용한다.
- [ ] module dependency direction을 지킨다.
- [ ] 기존 Function Logic failure domain과 격리된다.
- [ ] source 파일이 800줄 미만이다.
- [ ] forbidden API architecture test가 통과한다.

### UI

- [ ] Tutor는 별도 Inspector reading mode다.
- [ ] 기존 4개 lens를 유지한다.
- [ ] 고정 static/no-run 안내가 있다.
- [ ] scenario comparison table이 있다.
- [ ] 선택된 path의 값 transition table이 있다.
- [ ] 결정론적 description이 있다.
- [ ] Why These Inputs와 Unknowns & Limits가 있다.
- [ ] Use These Inputs가 명시적 action으로만 기존 Scenario를 바꾼다.
- [ ] graph attention이 기존 selection/branch/value state를 보존한다.
- [ ] loading/empty/partial/error/disabled/long/dense 상태가 있다.

### 접근성/시각

- [ ] semantic button/table/label/heading을 쓴다.
- [ ] keyboard 전체 흐름을 수행할 수 있다.
- [ ] visible focus와 focus restore가 있다.
- [ ] async update가 적절히 announce된다.
- [ ] certainty가 색에만 의존하지 않는다.
- [ ] reduced motion과 forced colors를 지원한다.
- [ ] narrow/medium/wide 실제 rendered UI를 확인했다.
- [ ] 200% zoom과 긴 identifier를 확인했다.
- [ ] visual QA와 functional QA를 별도로 기록했다.

### 테스트/문서

- [ ] fixture 기반 analyzer tests
- [ ] candidate/scenario determinism tests
- [ ] interpreter budget/cycle tests
- [ ] protocol validation tests
- [ ] Webview interaction/a11y tests
- [ ] architecture/no-LLM/no-execution tests
- [ ] `npm run check`
- [ ] `npm test`
- [ ] `npm run package:check`
- [ ] `SPEC.MD`, `PRODUCT.md`, `DESIGN.md`, `README.md` 갱신
- [ ] 알려진 제한을 최종 보고에 명시

---

## 36. 최종 사용자 수용 기준

기능은 다음 문장을 모두 참으로 만들 때 완료다.

1. 사용자가 함수만 열고 Tutor를 눌러 대표 입력 시나리오를 볼 수 있다.
2. 각 입력이 타입, default, callsite, condition 중 어디서 왔는지 확인할 수 있다.
3. 서로 다른 시나리오의 possible branch, 값 변화, return/throw/effect를 표로
   비교할 수 있다.
4. 한 시나리오를 선택하면 graph의 해당 node/edge와 embedded 내부 block까지
   임시 강조된다.
5. 값 변화는 source order의 `before → after`로 읽을 수 있다.
6. 설명은 짧고 결정론적이며 runtime 실행을 주장하지 않는다.
7. unknown과 budget limit은 숨지 않고 이유를 보여준다.
8. 사용자가 명시적으로 요청할 때만 Tutor 입력이 기존 Values Scenario로
   복사된다.
9. 기능 전체는 로컬 정적 분석이며 LLM·network·token·source execution을
   사용하지 않는다.
10. 기존 graph, lens, branch choice, value playback, source highlight가
    회귀하지 않는다.

---

## 37. 최종 확정 사항 요약

- 기능명은 `Static Tutor`, 진입점은 `Tutor`.
- Tutor는 렌즈가 아니라 Inspector reading mode.
- analyzer가 structured parameter/constraint/program IR을 만든다.
- Host가 현재 graph의 incoming callsite를 bounded하게 수집한다.
- callsite argument는 tuple로 보존한다.
- candidate는 type/default/callsite/constraint에서 만든다.
- scenario는 greedy coverage로 최대 12개.
- Webview interpreter는 structured IR을 iterative queue로 계산한다.
- unknown condition은 최대 8 path로 bounded fork.
- loop 기본 최대 3회.
- description은 template 기반, 최대 240자.
- UI는 scenario table + selected path + value transition table.
- exact/inferred/unknown과 source evidence를 항상 보존.
- `Use These Inputs`만 기존 manual Scenario를 변경.
- immediate embedded eval만 기존 analyzer IR을 통해 path에 포함.
- 사용자 source, call, eval은 실행하지 않음.
- LLM/API/network/token 사용 없음.
- 모든 지원 언어는 adapter 또는 explicit gap.
- 실제 VS Code narrow/medium/wide, theme, keyboard, reduced motion QA 필수.
