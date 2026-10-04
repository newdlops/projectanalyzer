# 함수 실행 시나리오 모델

이 모듈은 이미 계산하거나 소스에서 계획한 **하나의 경로**를 공통 읽기 모델로
정리한다. `Summary`의 대표 시나리오와 `Values`의 상세 화면이 같은 객체를 사용한다.
프로젝트 코드를 실행하거나 새 인터프리터, Webview consumer, 타이머를 만들지 않는다.

## Public API

`index.ts`는 `createFunctionExecutionScenarioModeler(input, options?)`와 계약 타입을
공개한다. `input`은 언어와 무관한 parameter, program block/edge/operation, binding
정보다. 기존 `FunctionTutorPayload`를 그대로 입력할 수 있다. 내부 구현을 직접
import하지 않는다.

```ts
import { createFunctionExecutionScenarioModeler } from "./index";

const modeler = createFunctionExecutionScenarioModeler(tutor);
const scenario = modeler.create({ seed, pathIndex: 0, path });
const catalog = modeler.catalog(workspaceRows);
```

- `create(row)`는 경로가 있는 행을 `FunctionExecutionScenario`로 바꾼다.
  아직 경로가 없는 행은 `undefined`다.
- `catalog(rows)`는 상한 안의 행을 모델링하고 최대 5개 대표 시나리오를 고른다.
  결과·조건·호출·쓰기·입력·가정이 다른 경로를 우선하며 원래 seed/path identity를 유지한다.
- `types.ts`는 source/evaluated 구분, 단계, 결과, gap, coverage의 JSON 계약을 정의한다.
- 구현 함수는 외부 runtime 참조 없이 작성해 동일한 컴파일된 함수를 Webview에
  emit한다. 순수 API와 실제 browser projection을 함께 테스트한다.

## 한 시나리오의 구조

| 필드 | 의미 |
| --- | --- |
| `schema`, `id`, `seedId`, `pathIndex` | 모델 버전과 원래 행의 선택·재생 identity |
| `basis` | `evaluated`: 기존 정적 계산기의 값 / `symbolic`: 소스 조건을 가정한 경로 |
| `observation` | 항상 `static`; 실제 프로그램이나 외부 서비스 실행을 관찰한 기록이 아님 |
| `inputs` | 이름·타입·생략 여부·확신도와 분리된 값 snapshot |
| `conditions` | 실제 통과한 간선 순서의 조건과 `checked` / `assumed` 구분 |
| `steps` | entry, 호출, 효과, 쓰기, 분기 선택, 문장, 종료를 방문 순서대로 기록 |
| `outcome` | 소스 종료식과 별도의 선택적 계산값; 미확인 종료는 `unknown` |
| `assumptions`, `gaps` | seed의 가정과 source/route/value 분석 제약 |
| `graph` | 검증된 현재 실행 범위 경로의 block/edge; 반복 방문과 간선 순서를 유지 |
| `omittedCounts` | 표시 상한 때문에 보이지 않는 항목 수 |
| `analysisLimited` | 분석 자체가 제한됐거나 이후 경로를 검증하지 못했는지 |

예를 들어 `const value = fetch(input); count += 1; save(value); return count;`는
`fetch 호출 → value 쓰기 → count 쓰기 → save 호출 → 반환` 순서로 정리한다.
조건식 안의 호출·쓰기는 해당 분기 결과 **앞**에 놓인다. 같은 loop block을 여러 번
방문하면 각 occurrence의 before/after와 선택 간선을 따로 사용한다. occurrence
정보 없이 반복된 쓰기의 값을 합쳐 붙이지 않는다.

필드 쓰기의 `targetName`은 `state["count"]` 같은 구체적 대상이다. 그 필드의
값 변화가 receiver 전체의 변화처럼 표시되지 않는다. source preview와 evidence
token은 기존 payload에서 가져오며 업무 목적이나 외부 부작용을 추측하지 않는다.
미지원 경계에서 evaluator가 기존 값을 unknown으로 무효화한 기록은 gap이다.
소스 쓰기로 확인한 연산의 unknown 값은 쓰기로 유지하되, 입력이 실제로 변경됐다는
근거 없는 쓰기 단계는 만들지 않는다.

## 확신과 완료 상태

`status: complete`는 모델에서 해당 source route와 종료를 확인했고 알려진 gap이
없다는 뜻이다. 외부 호출 성공, 입력의 실제 실행 가능성, 모든 경로의 발견을
보장하지 않는다. 외부·미확인 호출과 지원하지 않는 연산은 gap으로 남긴다.

`checked`는 기존 정적 계산기의 실제 선택이나 독립적으로 검증된 seed prefix다.
단순히 소스에서 나열한 분기는 `assumed`다. `symbolic-only` capability는 오래된
concrete flag, terminal value, checked prefix보다 우선한다. 현재 Kotlin은 이
capability를 사용하므로 source preview/재생은 가능하지만 계산값·검증된 분기·입력
적용을 제공하지 않는다.

경로는 entry부터 **순서가 있는** `edgeIds`로 검증한다. 필요한 경우 occurrence의
`selectedEdgeId`를 사용한다. 없는 block, 연결되지 않은 간선, 정의·지연 실행 경계,
상한 이후 suffix나 종료 뒤의 방문은 성공한 반환으로 취급하지 않는다. `finally`
continuation 같은 미지원 종료 처리도 명시적 gap으로 남긴다.

`coverage`는 발견한 source decision 간선 중 정적으로 확인한 간선 수를 센다.
반복 선택은 occurrence로 남기되 coverage에서는 동일 간선을 한 번만 센다.
조건 표시 상한에 잘린 loop exit도 집계한다. `exhaustive`는 항상 `false`다.
Workspace는 최대 48개 표시 행을 전달하므로 `omittedScenarioCount`는 전달된 행
안의 생략 수이며, Workspace 밖의 모든 가능한 경로 수를 의미하지 않는다.

## 자원과 수명

| 상한 | 기본값 / 최대값 |
| --- | --- |
| 한 route 깊이 | 300 / 300 |
| 모델링할 시나리오 | 48 / 48 |
| 한 시나리오 단계 | 80 / 120 |
| 대표 시나리오 | 5 / 5 |
| 입력 / 조건 / gap / 가정 / 항목별 evidence | 16 / 12 / 16 / 8 / 8 |
| 한 값의 방문 / 깊이 / container 항목 | 96 / 6 / 16 |
| source·값 문자열 / 객체 key | 240자 / 240자 |

값은 evaluator 환경을 참조하지 않는 bounded snapshot이다. 안전한 alias는
독립적으로 복사하고 ancestor cycle guard를 둔다. sparse array는 최대 16개의
dense prefix만 복사한다. accessor를 실행하지 않으며 함수·내부 brand·지원하지
않는 prototype·긴 key는 unknown/gap으로 처리한다. key를 잘라 다른 key와
충돌시키지 않는다. plain JSON 및 기존 정적 계산기 값을 입력으로 받으며 일반
Proxy 동작은 입력 계약 밖이다.

화면에서 단계나 조건이 생략되어도 검증된 terminal이 미완료가 되지는 않는다.
분석 상한은 표시 생략과 별도로 기록한다. 탐색은 stack/visited set을 쓰고 route
반복은 깊이 상한과 occurrence 단위로 처리한다.

Workspace `readModels()`는 처음에는 빈 catalog를 돌려주고, 명시적 scenario
활성화로 결과가 생긴 뒤 `resultRevision`마다 한 번 모델링한다. 선택·재생·언어
변경·Guide 재개방은 같은 catalog를 사용한다. root 교체나 dispose가 factory와
catalog를 해제한다. 전체 browser bundle에는 modeler 코드를 한 번만 emit한다.

## 검증

`src/test/unit/functionExecutionScenarioModel.test.ts`는 실제 emitter와 순수 API를
통해 interleaved 작업, loop occurrence, 경로 오류, capability, snapshot budget,
필드 대상, 공유 캐시와 Values 상세를 검증한다. 기존 Summary·symbolic scenario·
renderer lifecycle 테스트와 함께 실행한다. UI 레이아웃은 production renderer
fixture의 실제 브라우저에서 별도로 확인한다.
