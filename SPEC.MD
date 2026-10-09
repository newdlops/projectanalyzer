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

Function Logic detail은 선택적으로 `Function Guide` payload를 포함할 수 있다. Guide는
기본적으로 모델 요청이나 source execution 없이 로컬 source documentation, owner 구조, 기존
architecture/semantic-flow index, direct graph caller/callee relation, declaration type/default,
literal union, direct branch constraint, Function Logic을 bounded하게 결합한다. Webview는
raw path/analyzer ID 대신 기존 opaque flow/block/edge/binding/evidence token만 받는다.
Guide는 코드베이스 위치, 입력, 결정, 작업/호출, 종료의 5개 고정 질문을 항상
ready/partial/unavailable 상태로 제공하며, claim마다 exact/inferred/unknown과 source
basis를 보존한다. `Source Path Scenarios`는 Guide 내부에서만 lazy하게 JSON expression IR을
해석한다. 서로 다른 callsite의 인자를 섞지 않고 uncertain/dynamic 값은 unknown 및 gap으로
남긴다. scenario interpreter는 path 8, step 240, loop block 3회 상한을 지키고 제한에
닿은 결과를 normal return으로 표시하지 않는다. TypeScript/JavaScript는 compiler AST
adapter, Python/Java는 parser header와 structured condition fallback,
Kotlin은 공식 문법으로 파싱한 callable/control/value adapter,
F#/OCaml/Elixir는 safe binding/header fallback을 사용한다. 지원하지 않는
write/call/alias는 추측하지 않는다.

Guide의 첫 영역은 선택적인 공통 `behaviorSummary`다. 소스 주석/KDoc의 목적 또는
명시적인 구조 집계, 입력과 기본값, 조건이 붙은 반환·예외, 최대 5개 주요 소스 단계,
호출·쓰기와 미확인 부분을 보여준다. 이름에서 업무 목적을 추측하지 않으며, 서로 다른
분기를 하나의 실행 순서나 반환값으로 합치지 않는다. 목록은 8개, graph 참조는 24개,
evidence는 8개, 항목 소스는 240자, 목적은 480자로 제한하고 생략 수를 표시한다.
주석이 없는 함수는 구조 근거를 표시한다. Summary가 없는 이전 payload는 기존 개요를 쓴다.

`Source Path Scenarios`에는 같은 Workspace 행에서 고른 대표 시나리오를 처음 3개,
확장하면 최대 5개 제공한다. 다른 시나리오는 기존 상세 표에서 확인한다. 대표 선택은
공유 seed/path 선택과 미리 보기를 사용하며 새 evaluator나 consumer를 만들지 않는다.
정적 경로는 실제 간선을 따라 개별적으로 계산하고 반복에는 visited set과 depth 제한을
적용한다. 분기가 없는 무인자 함수에도 경로가 있다. 최대 12개 경로, 경로당 5개 결정,
48개 탐색 상태, 기본·최대 깊이 300과 화면 행 48개를 유지한다. 제한된 경로는 명시적으로
표시한다. 시나리오 제목은 호출명에서 업무 동작을 추정하지 않는다.

`.kt`와 `.kts`는 top-level/member/local/extension 함수와 block/expression body,
`val`/`var`, `if`/`when`, 반복, `try`/`catch`/`finally`, 지원 가능한 루트 Elvis·safe call·
short circuit을 소스 근거로 연결한다. 생성자/init/accessor와 nested lambda/inline/coroutine
동작은 현재 함수의 직접 실행으로 섞지 않는다. Kotlin의 `evaluationMode: symbolic-only`는
JS 값 계산과 정적 입력 탐색을 막고 소스 경로 미리 보기·재생을 제공한다. 모델 예시 입력은
편집·적용할 수 있으며 실행 검증으로 취급하지 않는다. null 가능
타입과 생략 가능한 기본 인자는 구분한다. 갑작스러운 종료의 finally 경유, 런타임 수치
의미와 동적 dispatch 등 지원되지 않는 의미는 gap으로 남긴다.

입력 추천은 인터페이스의 필수 필드, 원래 callsite의 전체 인자 조합, 경계값과 앞서 통과해야
하는 조건을 함께 사용한다. 최대 384개 후보를 모은 뒤 실제로 확인한 분기 결과·종료·예외를
기준으로 기본 시나리오 12개를 선택한다. 목표 경로를 생성했다는 사실만으로 coverage를
부여하지 않는다. 반복 기반 TS/JS 정적 입력 검사기는 기본 128 step, block당 8 visit까지
지원 IR을 확인하고 알 수 없는 호출·alias write·제어 연결·언어에는 partial과 중단 이유를
남긴다. 확인하지 못한 분기는 도달 불가능하다는 증거가 아니다.

`Values & paths`의 기본 생성은 `빠른 시나리오 생성`이다. 전체 호출부 인자 조합을 시작점으로
선언된 입력 구조를 유지하며, 대입 이후 도달한 조건값의 국소 선형 변화를 추정한다.
숫자 경계와 제한된 문자열·배열 후보는 소스 IR에서 다시 확인하여 같은 조건의 반대 결과를
보인 쌍만 추천한다. 신경망 학습·특징 임베딩·외부 모델 없이 최대 192회 평가, 32개 조건,
4개 경계 쌍·8개 추가 사례를 사용한다. 32회마다 취소를 확인하며 이벤트 루프에 양보한다.
Host는 기본 요청에 5초, 선택 신경망 요청에 120초 제한을 적용한다.
순수 동기 내부 함수는 lexical AST의 정확한 호출 위치 또는 confidence `exact`인 graph 간선으로
연결한다. helper당 최대 64개 블록·128개 탐색 상태·16개 반환 경로와 4단계 호출을 허용한다.
함수 바인딩이 재대입되거나 호출 이름이 shadow되면 이전 선언을 확정 대상으로 사용하지 않는다.
4단계 제한은 catalog의 순서와 무관하게 실제 호출 체인에 적용한다.
부수 효과·captured binding·member write·예외·순환 호출은 확정 계산으로 바꾸지 않는다.
생략된 기본 인자와 사용하지 않는 인자·계산의 평가 여부도 보존한다. 소스가 바뀌면 새 모델을
만들고, 동일 스냅샷의 호출부/후보/예산별 결과를 최대 4개 재사용한다. 캐시 항목의 key와
결과는 각각 96KiB 이하이며 선언과 프로그램 인덱스는 WeakMap으로 소유한다.
Kotlin은 기존 symbolic-only 소스 시나리오와 Summary를 사용하고 숫자 입력 생성은 수행하지 않는다.

추가 탐색은 `신경망으로 추가 탐색`에서 요청한다. 함수별 자체 residual MLP를
로컬 CPU에서 학습하며 외부 모델, 계정, 원문 전달을 사용하지 않는다. 완전한 호출부 인자
조합과 선언된 입력 구조로 bounded 입력 공간을 만들고, 앞선 값 변경을 반영한 수치 비교,
문자열 비교 거리, 알려진 truthiness를 학습한다. 호출부 문자열과 대입·조건식에 연결된
토큰, 접두/접미 역변환, 길이·공백·대소문자·Unicode 변형을 후보로 만든다. 반환용 문구를
입력 근거로 사용하지 않는다. 문자열은 최대 512 UTF-16 단위·160개 후보, 원시값 배열은
원소 타입을 유지하며 길이 0~32를 탐색한다. 기존 숫자 원소는 별도 연속 좌표로 유지한다.
도달하지 않은 분기는 학습 label이 없다. 초기 최대 400개 고유 표본을 수집하고, 새로
도달한 안쪽 조건에 표본을 집중해 최대 3단계로 재학습한다. 각 단계는 최대 800개 표본,
32개 입력 좌표·192개 특징·16개 비교식을 사용한다. 별도 수집 표본은 고정된 4:1로
학습 / 검증에 배정하고 최적화 중 검사한 입력은 학습에만 추가한다. 검증 표본을 나중에
학습 표본으로 바꾸지 않으며, 후속 표본 생성은 학습 표본에서 시작한다. 여러 문자열 매개변수가 전체
특징 예산을 나눠 쓰며, 소스 구분자에서 얻은 문자열 조각은 결합 탐색 후보가 된다.
숫자 입력은 단계당 hidden tanh 24개·Adam 240 epoch, 문자열·배열 특징이 있으면
48개·360 epoch이고, 모두 linear residual을 가진다. 이미 만족한 바깥 조건의 고정 좌표는
유지한다. 학습에 사용하지 않은 표본의 정규화 평균 절대 오차를 표시하고
개별 비교식 오차가 0.25를 넘으면 추천을 보류한다. 학습된 입력 기울기로 경계 근처를
찾고, 이산 입력은 학습 예측 순위와 길이 다양성으로 후보를 고른 뒤 경계 양쪽을 정적으로
검사한다. 같은 조건에 가장 가까운 확인값 쌍을 우선하며 빈 입력 분기는 비어 있지 않은
짝과 함께 제공한다. `추천 값 채우기`는 완전한 검증 사례를 타입 기본값보다 우선한다.
문자열 설명은 실제 피연산자를 표시하고 긴 값은 최초 차이 위치와 길이를 제공한다.
지원하지 않는 문자열 메서드·외부 호출·프레임워크 상태는 추측하지 않는다.
신경망의 표본 수집·탐색 평가는
요청당 1,400회까지이며, 설명과 Host 검증은 생성한 최대 4쌍을 추가로 검사한다.
기본 분석과 화면 mount/locale/focus는 학습을 시작하지 않는다.
숫자 탐색 반경은 IR / Python bytecode 상수 및 입력 예시 최대 절댓값의 두 배를 올림한
2의 거듭제곱이며, 최소 16·최대 2^20이다. 이 정규화는 정수·소수 일치 입력의
불필요한 반올림을 피한다. Python의 명시적 `int` 매개변수는 정수만 탐색한다.

Python은 parser가 만든 제한된 bytecode를 Host 입력 검사기와 Webview 값 재생에서
공유한다. 작업 공간 Python을 실행하거나 import하지 않는다. 같은 파일의 순수 함수,
지역 대입, if/for/while/continue, 한 단계 comprehension, 문자열 분리·결합,
정수 계산·몫·나머지, 고정 길이 digit capture와 공백·선택 구분자·digit lookaround를
지원한다. 외부 호출, 중첩/반복 regex group, backreference, Unicode 숫자 변환,
mutable module collection 등은 미확인이다. 함수 8개·global 24개·bytecode 8,192 step·
반복 32회와 명시적인 stack/visited budget을 적용한다.

Python 문자열 후보는 정규식 형태와 최대 96회 사전 검사에서 찾은 비어 있지 않은
반환 사례를 바탕으로 중복·여러 줄·표식 조합을 만든다. 이 검사도 1,400회 한도에 포함한다.
후보는 최대 400개이며 digit 위치/범주와 regex match 수는 입력 특징이다.
대입과 순수 helper 호출을 통한 입력 출처도 유한 반복으로 추적해 비교 문자열과
접두/접미 후보를 보강한다. 문자열 일치 비교는 실제 문자열 거리와 피연산자를 보존한다.
검증 함수의 반환값이나 계산된 조건 피연산자는 입력 특징에 넣지 않는다.
첫 세 번의 분기를 별도 학습 대상으로 두며 witness는 동일한 반복 회차끼리 재검사한다.
실제 검사한 수치·문자열·변경값만 설명하고 도달하지 않은 분기는 label로 사용하지 않는다.

`추천 값 채우기`도 첫 클릭에서 동일한 빠른 모델 요청을 시작한다. 완료하면 검증된 사례를
채우고 해당 사례 설명을 선택한다. 대기 중에는 취소할 수 있고, 그 사이 편집한 값은
덮어쓰지 않는다. 실패·지원 부족은 기존 값을 유지하며 상태를 보여 준다.
TS/JS 경로에 조건 설명을 붙일 때도 완료된 정확한 재생 결과의 반환값을 보존한다.
제한에 걸렸거나 값이 미확인인 경로를 구체적 반환으로 표시하지 않는다.

요청 protocol은 `codeFlow/requestScenarioInputs`와 `codeFlow/cancelScenarioInputs`이며
payload는 현재 graphVersion, opaque flowId, nonnegative safe requestId와 선택적인
`fast`/`neural` mode만 받는다. mode 생략은 `fast`이다.
Host는 최근 전달한 함수 snapshot에만 요청을 허용하고 단일 pending 요청, 모드별 5초/120초 timeout,
취소, 중복 ID, graph/root 교체와 늦은 응답을 처리한다. 응답 `codeFlow/scenarioInputsLoaded`는
ready/empty/unavailable/cancelled/denied/timeout/invalid-response/failed/stale 중 하나와
새 model seed 및 숫자 생성/학습 진단만 전달한다. raw path 및 analyzer identity, 신경망 가중치와
학습 표본을 Webview에 노출하지 않는다.

모델 응답은 최대 48,000자 JSON, 시나리오 8개, 문자열 1,024자, 배열/객체 32개,
입력 depth 6으로 제한한다. 알려진 타입·literal union·필수 member shape와 전체 인자 조합을
검사한다. 별도 정적 검사로 경로를 확인하고 이미 확인한 동작만 반복하는 일반값을 거른다.
같은 조건의 결과가 달라지는 입력 쌍은 Host가 다시 확인한 경우 경계 설명용으로 허용한다.
한 번 추가한 경계를 반복 추천하지 않는다. 모델 origin은 inferred로 유지하고 추천 이유,
달라진 입력, 계산된 조건값과 정적 확인 범위를 따로 표시한다. 원래
입력/선택/재생 상태를 유지하며 사용자가 적용해야 값을 바꾼다. 모델 없는 상태와 재시도,
취소, keyboard focus, 한국어/영어를 지원한다. 공개 모듈과 세부 한계는
`docs/SCENARIO_INPUT_QUALITY.md`, `docs/NEURAL_SCENARIOS.md`를 따른다.

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

Scenario bundle payload v3 is additive to v2. It carries opaque call IDs plus
explicit await/optional invocation metadata; no source range, graph identity,
or browser-side name lookup is exposed. Source code is never executed: the
single bounded browser interpreter only consumes static programs. Awaited exact
local async calls, dormant synchronous generators consumed by zero-argument
`next()`, stable local methods, statically present/absent optional calls, and
plain non-derived constructors may be represented. Dynamic dispatch, unknown
optional presence, inheritance, async generators, iterator arguments, and
constructor/proxy/accessor behavior remain partial gaps. Scenarios retain the
existing 4-depth, 12-program, 360-block, 96-KiB, 600-expression, 1,200-work,
three-loop-visit, eight-path limits and cap generator yields at 24.

value change는 statement label을 다시 보여 주는 문자열이 아니라 변경 target을 별도
evidence로 보존한다. 대입, 증감, 삭제, 초기화, loop binding은 `exact`이며 source에 적힌
우변만 표시하고 runtime 값을 계산하지 않는다. `items.push(item)`, `queue.pop()`처럼 알려진
in-place method 이름은 receiver가 바뀔 가능성만 `inferred`로 표시한다. 호출 구현이나 receiver
type을 확인하지 못한 상태에서 exact mutation으로 승격하지 않는다. 한 block에서 발견한
서로 다른 source-level change는 모두 보존하고 target 종류는 `VAR`, `FIELD`, `RECEIVER`
텍스트로도 구분한다.

object/JSON 계열 값은 source에서 key를 증명할 수 있는 범위에서 field path로 확장한다.
TypeScript/JavaScript object literal과 Python dictionary의 명시적인 string/number/identifier key는
중첩 경로까지 `FIELD` exact change로 보존한다. object spread/dictionary unpack은 key 집합이
runtime 값에 의존하므로 owner `RECEIVER`의 inferred change로 남긴다. `Object.assign`, Python
`dict.update`, Java map-style mutator처럼 호출 또는 receiver type을 확정하지 못하는 경우에도
literal key별 `FIELD` hint를 추가할 수 있지만 confidence는 inferred를 유지한다. dynamic computed
key, alias, getter/setter 실행 결과를 exact field로 승격하지 않는다.

TypeScript/JavaScript, Python, Java Function Logic은 `valueBindings`와 `valueFlows`를
추가로 제공한다. parameter definition은 entry block, local/constant definition은 declaration
source를 포함하는 가장 구체적인 visible block에 둔다. 각 block은 같은 opaque binding identity의
`DEFINE`, `READ`, `WRITE`, `READ/WRITE` access를 가진다. read와 read/write access에서는 control-flow
predecessor를 역방향 queue로 탐색해 각 path에서 가장 가까운 definition 또는 write만 연결한다.
따라서 branch merge에는 둘 이상의 reaching definition이 보존되고 loop에서는 loop-carried
definition이 생길 수 있다. 탐색은 recursion 없이 visited/best-depth map, 최대 depth,
binding/access/flow hard limit를 적용하며 누락 수는 `parseLimited` gap으로 노출한다.

Webview는 이 semantic definition-to-use relation을 그대로 긴 직선으로 겹쳐 그리지 않는다.
선택 binding의 definition/write/use/sink block을 value-related node로 두고 control predecessor를
visited set과 명시적 queue로 역추적하여 각 path에서 가장 가까운 이전 value-related node까지만
하나의 visual hop으로 만든다. 따라서 `declaration -> use -> use -> sink`가 짧은 quadratic SVG
`Q` 포물선들로 이어진다. branch arm 사이를 source/layout 순서만으로 연결하지 않으며 join은
각 branch의 가장 가까운 use에서 별도 hop을 받는다. cycle은 target-seeded visited set과 최대 depth로
종료하고, BODY focus/deferred 관계로 control path가 잘린 경우 analyzer가 준 reaching definition을
fallback endpoint로 사용한다. visual hop은 최대 1,500개이며 semantic payload는 변경하지 않는다.

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

TypeScript/JavaScript control condition의 root boolean group은 parser가 증명한
predicate 평가 순서로 최대 6개 column, 실제 CFG short-circuit path 최대 32개 row의
`conditionTable`을 가질 수 있다. 각 row는 predicate별 `true`/`false`/`skipped`,
최종 boolean result, 첫 non-group target과 그 row를 구성하는 opaque true/false edge
identity를 보존한다. 이는 Cartesian truth table이나 source 실행이 아니다. Inspector에서
row를 선택하면 해당 edge들을 하나의 branch scenario로 함께 적용하고, 같은 완전 row를
다시 선택하면 그 decision source들만 해제한다. nested 독립 condition, 상한 초과 group,
불완전한 projection은 table을 보내지 않는다.

TypeScript/JavaScript control condition의 root boolean group은 parser가 증명한
predicate 평가 순서로 최대 6개 column, 실제 CFG short-circuit path 최대 32개 row의
`conditionTable`을 가질 수 있다. 각 row는 predicate별 `true`/`false`/`skipped`,
최종 boolean result, 첫 non-group target과 그 row를 구성하는 opaque true/false edge
identity를 보존한다. 이는 Cartesian truth table이나 source 실행이 아니다. Inspector에서
row를 선택하면 해당 edge들을 하나의 branch scenario로 함께 적용하고, 같은 완전 row를
다시 선택하면 그 decision source들만 해제한다. nested 독립 condition, 상한 초과 group,
불완전한 projection은 table을 보내지 않는다.

TypeScript/JavaScript control condition의 root boolean group은 parser가 증명한
predicate 평가 순서로 최대 6개 column, 실제 CFG short-circuit path 최대 32개 row의
`conditionTable`을 가질 수 있다. 각 row는 predicate별 `true`/`false`/`skipped`,
최종 boolean result, 첫 non-group target과 그 row를 구성하는 opaque true/false edge
identity를 보존한다. 이는 Cartesian truth table이나 source 실행이 아니다. Inspector에서
row를 선택하면 해당 edge들을 하나의 branch scenario로 함께 적용하고, 같은 완전 row를
다시 선택하면 그 decision source들만 해제한다. nested 독립 condition, 상한 초과 group,
불완전한 projection은 table을 보내지 않는다.

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

전용 Function Visualizer에는 `구문 흐름 / Statement flow`와 `함수 호출 / Function calls`
모드를 따로 제공한다. 기본 모드는 구문 흐름이며 모드 전환은 기존 DOM, 입력값, 선택,
확대·이동 상태를 보존한다. 함수 호출 안에는 기본 `호출 순서 / Call order`와
`호출 관계 / Call relationships` 보기가 있다. 최초 선택 시 root의 직접 호출을 읽고,
이후 사용자가 함수를 선택하여 하위 호출을 펼친다. 호출 관계에서는 여러 호출 지점을 노드 하나와
연결 하나로 묶어 그리고, 연결 선택 시 각 지점의 조건·반복·소스 위치를 개별 표시한다.

호출 순서는 선택한 상위 함수의 인터페이스, 분기·반복 선택, 원본 인자를 포함한 번호 순서로
시나리오 초안을 구성한다. 함수 안에서만 제어 흐름을 따라가며 하위 함수의 내부 호출은
해당 함수를 상위 함수로 선택해 별도로 읽는다. 아직 선택하지 않은 조건에서는 진행을 멈춘다.
반복은 0·1·2회를 명시적으로 가정하고, 매 방문의 분기 선택은 서로 독립적이다. 조기 반환,
`break`·`continue`, 반환할 인자 계산 뒤의 `finally`, 중첩 인자 호출의 평가 순서를 반영한다.
iterator 식은 한 번, while predicate는 종료 검사까지 반복해서 표시한다. 지연된 이벤트나
순서를 알 수 없는 관계는 즉시 호출 번호에 포함하지 않는다.

최대 8개 경로 예시를 제공하며 모든 경로를 열거하거나 입력의 실현 가능성을 입증했다고
표시하지 않는다. 조건과 횟수는 사용자의 가정이고 입력값은 미검증임을 항상 알린다.
초안은 이름·조건·방문별 호출·종료 상태를 복사할 수 있다. `상위 함수 입력값 확인`은
선택한 함수의 기존 Values 화면을 열며 현재 함수의 수동 입력값·graph DOM을 보존한다.
각 상위 함수의 초안은 보기와 언어 전환 중 유지되고 새 snapshot에서 초기화된다.
호출 순서의 **이 소스 경로 설명**, 관계의 **호출 구조 설명 / 이 호출부 설명**은
명시적인 사용자 요청으로만 로컬 또는 연결 모델을 실행한다. Host가 같은 정적 순서 함수를
사용하여 선택 조건·호출 대상·반복 방문을 고정하며, 호출부와 프로젝트 대상 함수의 원문을
제공한다. 모델은 역할·인자 전달·반환과 사용·상태/효과·도달 이유를 해설한다. 정적 관계의
confidence와 지연 실행을 유지하고 모델이 노드·연결·분기를 바꾸지 못하도록 응답을 검증한다.
명시적 인자는 언어 parser에서 읽으며 인자가 없는 호출의 전달 설명은 소스 사실로 고정한다.
한 요청은 최대 두 호출을 읽고 두 개를 넘는 해설은 호출별 읽기가 끝난 뒤 bounded 원문
근거로 전체 요약을 생성한다. 완료된 묶음을 취소·오류 후 유지하고 다음 요청은 남은 작업만
처리한다. 페이지와 호출 선택은 캐시만 읽으며 source/모드/언어 변경은 새 추론을 시작하지
않는다. 모델 문장과 효과·실행 결과는 미검증 추론이며 소스/정적 한계를 함께 표시한다.
0.0.1128은 한 번 누른 호출 해설의 원문 읽기·중간 응답·최종 요약 동안 같은 provider의
resource scope를 유지한다. 각 추론은 기존 FIFO 슬롯을 사용하고 최종 `ready`는 scope 정리가
끝난 뒤에만 보낸다. 정리 중 취소·snapshot 변경·실패는 성공으로 게시하지 않는다. 캐시
조회는 scope를 획득하지 않는다. 모델 입력·응답 schema·원문 상한과
role/inputs/output/effects/reason을 유지한다.
0.0.1145의 Webview는 응답 형태·언어 검증 함수와 그 순수 텍스트 검증 helper를 함께
직렬화한다. Host에서 검증한 한국어·영어 응답을 브라우저에서도 검사해 표시하며, helper
누락으로 정상 설명 표시가 중단되지 않도록 실제 생성 script의 완료·페이지·언어 전환을
검증한다. 기존 모델 문장의 의미 정확성을 이 형식·언어 검사로 보증하지 않는다.
0.0.1129의 local mode는 실제 parser가 확인한 단일 반환 본문과 정확한 호출부 사용을
다섯 상세 항목으로 읽을 수 있다. 인자→이름·선언 타입, 반환 식, 지역 저장/부모 반환,
명시적인 쓰기/호출과 도달 조건을 보존하고 inferred target은 조건부로 설명한다. 모든
완료 상세가 소스 proof와 일치한 경우에만 완전한 guard/조기 반환/지역 저장/반환의
6-node/6-edge·세 호출 recipe를 전체 요약으로 읽는다. callback/권한 flag는 Host-only이며
외부 prompt에서 제거한다. 다른 구현·제어 흐름·잘린 원문·상한 초과는 모델을 유지한다.
source-only recipe는 모델 runtime/weights/factory/download 없이 완료한다. open Plain Text
문서는 지원 확장자로 분석기를 선택하되 원문과 explicit editor language mode는 유지한다.
현재 함수 command의 빠른 single-file graph와 원본 source confidence는 유지한다.
호출 해설 원문은 name/kind/selection anchor가 일치하는 parser-owned 선언 범위를 우선하여
native graph의 선언 줄 범위에서도 본문을 유지한다. 기존 snippet 길이·줄 수 상한은 같다.
최종 summary/flow/limitations와 producer는 해당 reading의 모든 페이지 캐시에 반영한다.
현재 호출 선택과 각 페이지의 호출 상세는 유지하며 페이지 이동으로 모델을 실행하지 않는다.
0.0.1130은 동일한 소스 proof를 개별 호출 요약과 작은 완전한 비순환 경로/구조에 사용한다.
조건·지역 초기화/갱신·호출 인자와 선언 타입·반환 식·사용 위치를 모두 보존하고 경로 조건과
inferred dispatch를 가정으로 표시한다. 각 경로는 visited set과 64-node/128-state/8-path
상한을 사용하며 240/600자 요약 상한을 넘으면 자르지 않고 모델로 넘긴다. 숨은 인자 호출/
쓰기, 미확인 부모 동작, cycle과 비동기 실행 계약은 모델을 유지한다. Kotlin의 parser-owned
predicate group이 기존 CFG에 있으면 같은 표현식 guard를 다시 선택하지 않으며 동일 호출
텍스트가 본문에 나타나도 실제 predicate span 밖의 호출은 그 본문에 소유된다.
0.0.1131은 상세와 독립 소스 proof가 일치한 배치의 작은 증명 identity만 보관한다. 실제
인자·선언 타입·반환 식·호출부 사용·범위·confidence를 복사하고 원문 파일/이전 context는
보관하지 않는다. 같은 함수 원문과 scope/sequence/conditions의 최대 4배치·8호출만 마지막
요약으로 연결하며 전체 CFG와 기존 240/600자 상한을 다시 검증한다. 모델 prose·serialized
handle·중복/누락/다른 snapshot의 증명은 권한이 아니다. 증명과 callback은 외부 prompt 및
Webview protocol에서 제외하고 캐시 폐기와 함께 회수한다. 상세·인용·페이지와 모델 fallback은
유지한다.
0.0.1132의 callee 증명은 primitive 매개변수의 지역 초기화·갱신과 조건별 조기/최종 반환을
완전한 CFG 경로로 보존한다. 최대 32블록·128상태·4경로이며 reader 옵션 maxCalleeDepth로
탐색 깊이를 낮출 수 있다. 모든 본문 블록·연결·이름·식을 확인해야 하고 parameter/captured/
member/immutable 쓰기, 명시적 다른 호출, 반복, 미확인/암묵적 반환, 기본 인자와 잘린 본문은
모델을 유지한다. callee 내부 guard와 부모 호출의 도달 guard를 혼합하지 않고 조건부 지역
변경과 모든 반환식을 기존 다섯 항목 및 summary/flow에 연결한다. 숫자를 실행하거나
입력/업무 목적을 추측하지 않는다. 기존 160/180/240/600자 상한에서 한 항목이라도 넘으면
소스 사실을 잘라 맞추지 않고 모델을 유지한다. 기존 단일-return guard recipe는 확장된
callee 본문을 대신 설명할 수 없으며 일반 compiler로 모든 중간 변경을 다시 읽는다.
0.0.1133은 단독으로 호출 결과를 버리는 직접 함수 호출을 opaque callee 구문으로 읽는다.
AST의 한 source callsite와 문장이 정확히 일치하고 모든 명시적 인수가 확인한 primitive
식이어야 한다. 호출 위치·인수·순서를 보존하고 내부 구현·외부 효과는 미확인으로 표시한다.
호출 뒤의 구문·반환은 정상 복귀와 지역 값 유지 가정에서만 연결한다. 호출을 값/조건에
포함하거나 captured/member/콜백 인수, deferred 관계, eval/Function 또는 기존 상한을
넘으면 모델을 유지한다. 본문의 모든 callsite가 읽힌 경로에 소유되어야 한다.
완전한 positional primitive 선언과 명시적 인수의 1:1 대응은 Host가 inputs에 고정한다.
default/rest/optional/미확인 선언이나 180자를 넘는 전달 문구는 고정하지 않는다. 모델은
이 사실을 바꿀 수 없으며 local wire의 생략된 값은 Host가 복원한다. 다른 네 항목과 전체
흐름·인용은 유지한다. local 호출 prompt는 runtime wire와 같은 flat 스키마를 한 번만
전달하며 connected-model 기본 스키마, source 데이터, 출력 상한은 그대로다.
로컬 모델에서는 제공된 guard·loop와 deferred/dispatch 한계를 모두 보존하는 도달 조건
문구도 Host 소유의 `reason`으로 복원한다. 실제 실행으로 승격하지 않으며 전체 문구가
180자를 넘거나 제어 문자를 포함하거나 언어 검증에 맞지 않으면 원래 모델 필드를 유지한다.
완전한 대상 원문의 parser-owned 반환 목록과 정확히 같은 호출부 범위의 전체 식 사용을
확인한 경우, 모든 반환 구문·어휘적 범위와 저장/반환/폐기/await 사용도 180자 안에서
`output`으로 복원한다. 값·실제 도달·최종 완료는 미확인으로 유지한다. 최대 128블록·8반환·
32단계 소유 범위의 한계, 별도 callable/embedded, Kotlin non-local 반환과 Python lowered
try-else 등 불완전한 근거는 완전한 반환 목록으로 승격하지 않는다. 복원할 수 없는 경우
기존 모델 필드를 유지한다. 역할·효과·전체 요약과 흐름은 모델이 작성한다. 이 변경은
연결된 모델 스키마나 source-only 해설을 바꾸지 않는다.
명시적 쓰기·호출 구문도 반환과 같은 parsed 선언/control snapshot에서 읽으며, 모든 원문
구문·발생·인수·어휘적 범위를 180자 안에 함께 보존할 수 있을 때 local `effects`로 복원한다.
source 위치 순서는 평가·실행 순서가 아니고 실제 상태 변화/I/O 성공/정상 완료는 미확인이다.
목록이 비어도 암묵적 효과를 없다고 단정하지 않는다. 별도 nested callable/embedded와
완전히 담지 못한 표현식 쓰기·깊이·개수·문자열 한계는 모델 필드로 돌아간다. 동일한 텍스트의
다른 source occurrence는 보존한다. 역할·전체 summary/flow는 계속 모델이 작성한다.
0.0.1134는 내부 직접 호출의 결과를 지역 변수·반환식·조건식에서 사용하는 구문도 읽는다.
AST 위치와 가장 안쪽 소유 블록으로 호출을 연결하고 닫히는 source offset의 postorder로
중첩 인수·동일한 호출의 다른 발생을 보존한다. 내부 치환은 식의 닫힌 문법 검사에만 쓰며
출력·계산기·실행에는 전달하지 않는다. 원래 호출 식·대입·연산자·조건별 반환을 모두 유지하고
결과 타입/값·내부 구현·외부 효과를 미확인으로 명시한다. 다음 구문은 정상 복귀·지역 값 유지
가정이다. 구현을 재귀적으로 분석하거나 호출 결과를 primitive 값으로 입증하지 않는다.
캡처/member 인수, 수신자 호출, 숨은 expression guard, 콜백/deferred·spread·named 인수,
eval/Function, 120자 식·16개 식 내부 호출 또는 기존 본문/해설 상한 초과는 모델을 유지한다.
호출 없는 callee는 추가 parser·line index·callsite map 없이 기존 식 검사를 사용한다.
0.0.1135는 같은 callee의 확인한 매개변수·지역 변수에서 시작하는 점 member 경로와
수신자 호출을 source syntax로 읽는다. 선언 뒤의 객체 값을 primitive로 계산하지 않으며
getter·디스패치·객체/외부 상태 변화·결과 타입/값·효과를 미확인으로 보존한다. 객체 내용의
불변성을 가정하지 않고 정상 완료 가정에서만 소스 대입·호출·인수·연산자·반환을 연결한다.
Kotlin의 수신자 추론은 `inferredCalls`에 보존하며 graph confidence나 대상 구현을 승격하지
않는다. 기존 strict expression API는 member를 계속 거부하며 callee 전용 opt-in reader만
허용한다. captured root·receiver 쓰기·computed/optional 접근·call/apply/bind·callback/deferred,
기존 선언/경로/해설 상한은 모델에 남긴다. 부모 인수 평가와 객체 매개변수의 기존 제한도 유지한다.
0.0.1136은 같은 callee의 captured/module/external 읽기와 직접 외부 수신자 호출을 source
참조로 보존한다. callee 전용 외부 읽기 opt-in은 이름·접근·추론 dispatch를 기록하며 값/타입/
상태/효과는 미확인이다. 외부 객체나 binding을 조회·실행하지 않으며 primitive proof로
승격하지 않는다. 원래 대입·인수·연산자·조건·반환과 정상 완료 가정을 유지한다. strict 및
기존 object reader의 기본 모드는 captured root를 계속 거부한다. 외부/member 쓰기,
optional/computed 접근·callback·eval/Function·숨은 expression guard와 기존 상한은
모델을 유지한다. Kotlin modifier 검사는 선언 header에서만 수행하며 본문의 ordinary
identifier를 실행 modifier로 잘못 분류하지 않는다.
0.0.1137은 완전한 positional 선언의 객체·사용자 정의·collection·structural·nullable 타입을
source label로 읽는다. `analyzer/functionCalls.readFunctionCallSourceDeclaredParameters`는
정확한 parser 선언 근거·이름·타입·호출 모드를 확인하고 비primitive 입력을 `opaqueParameters`
로 보존한다. 타입을 resolve하거나 객체 대표값을 구성하지 않으며 값·런타임 타입·연산자/
getter/dispatch·외부 상태/효과는 미확인이다. 정상 완료 가정을 다섯 상세 항목과 연결된 흐름에
유지하고 opaque identity 반환도 body path를 보존하여 기존 primitive proof로 승격하지 않는다.
Kotlin named 타입의 runtime input-model 부재 gap만 해당 parameter의 정확한 선언 아래
source 읽기로 다루며 다른 parameter/source gap은 유지한다. 원문 타입은 비primitive일 때
code label로 표시하여 설명 언어와 다른 script의 타입 이름을 prose로 잘못 거부하지 않는다.
formal input 전달은 미지원 본문과 독립적으로 읽되, default 근거·optional/rest/destructuring/
callback·parameter/member 쓰기·optional/computed 접근과 기존 모든 상한은 유지한다.
0.0.1138은 부모의 속성/captured 읽기를 인자·조건·지역 변경·반환의 원래 source 식으로
연결한다. 호출부의 parser-matched 인수/수신자 읽기는 `callerReads`에 원래 operand 순서·
접근·외부 이름을 보존하며 callee body가 그 값/getter/상태/효과를 증명하지 않는다.
속성 조건의 참/거짓은 선택 경로의 가정이다. getter 재평가를 이전 값으로 대체하지 않고
값/연산자·getter·dispatch·외부 상태/효과 미확인 및 정상 완료 가정을 기존 상세/흐름에
유지한다. 호출 0개의 조기 반환도 소스 경로와 같은 bounds/cache를 사용한다.
전체 부모 경로는 동일 source key/text의 공통 prefix만 묶으며 같은 텍스트의 서로 다른
구문은 합치지 않는다. parameter/captured/member/immutable 쓰기, optional/computed,
숨은 호출/쓰기, callback/async/loop 및 기존 token/path/prose 한도는 모델을 유지한다.
0.0.1139은 완전한 동기 method의 선언/원문 경로를 source-only 방식으로 읽는다.
`sourceOnlyMethod`는 method parameter 선언만 읽으며 기존 evaluator의 `inputSummarySafe`
값이나 객체 구성/수신자 조회 권한을 바꾸지 않는다. `methodReceiver`는 이 문맥에서만 `this`
와 member 식을 원문으로 보존하고 strict/default reader는 계속 거부한다. method는
`methodSource`와 body path를 남겨 primitive leaf/compact recipe로 승격하지 않는다.
Host의 `sourceKind: method`는 실제 선언 근거이며 graph confidence와 별도로 모든 상세/
흐름에 후보 선택 조건을 유지한다. 수신자/값·타입·연산자/getter·dispatch·상태/효과는
미확인이고 정상 완료만 가정한다. class field initializer를 실제 `this` 값으로 대입하지 않는다.
caller/method 원문 operation은 순서대로 보존하고 공통 미확인 정보를 한 번 표시한다.
constructor/accessor·명시적 `this` parameter·default/rest/optional·간접/숨은 호출과
receiver/member 쓰기·callback/async/generator·Kotlin 실행 modifier·loop 및 기존 상한은 유지한다.
네이티브 TS 분석기는 top-level named function의 필수 단순 named-type receiver parameter와
같은 파일의 유일한 class/method를 `inferred` 후보로 연결한다. receiver 값/dispatch는 평가하지
않으며 unknown·generic·optional/default/rest/destructuring 타입, nested/type-parameter scope,
중복 owner/overload·shadow·직접 재할당은 unresolved로 유지한다. 정확한 source identity를
확인한 parser declaration 범위는 설명 snippet과 대상 소스 evidence에 함께 사용하고 기존
graph ID/range/confidence는 변경하지 않는다.
0.0.1141은 동기 plain 함수의 단일 `try` 값 반환과 한두 개의 직접 `finally` 호출을
독립 AST 영역과 전체 CFG/callsite coverage로 읽는다. 반환식 평가·보관 → 정리 호출 →
정상 완료 시 보관 결과 사용 순서를 보존하며, 단순화된 CFG의 return edge를 실제 정리
순서의 증거로 쓰지 않는다. 값/상태·호출 내부/효과·예외는 미확인이고 원문을 실행하지
않는다. primitive positional 선언만 사용하며 default/rest/opaque 입력, catch, 반환/throw
재정의, 쓰기, nested/async 제어, receiver/captured 읽기와 기존 상한은 모델을 유지한다.
정리 facts는 bodyPaths를 유지하므로 primitive leaf/legacy sync 평가로 승격하지 않는다.
다섯 상세 항목·원문 액션·candidate confidence·locale/scope cache는 그대로 유지한다.

0.0.1140은 정확한 async/suspend 선언과 complete acyclic source path를 읽되 evaluator에
비동기 실행 권한을 주지 않는다. `sourceExecution`은 TS/JS의 parser-owned async를 Promise
계약으로, Kotlin의 suspend header를 중단 가능 계약으로 구분한다. 중단/재개가 실제로
일어났다고 표시하지 않고 정상 완료만 가정한다. 모든 source await와
nested invocation의 원래 식·postorder·지역 변경·조건·반환은 기존 bounds 안에서 보존한다.
`asyncAwait` opt-in은 이 문맥의 구문만 읽으며 strict/default reader는 await-prefix를
평가하지 않는다. Kotlin의 일반 binding 이름 await는 기존 identifier 의미를 유지한다.
callee `execution`, caller `callerExecution`, 직접 use의 `awaited`는 서로 별도의 Host facts다.
raw Promise 저장/반환/버림을 이행값 사용으로 바꾸지 않고 async parent의 반환을 동기
callee의 계약과 혼동하지 않는다. 모든 진행은 성공 이행/정상 재개를 가정하며 실제 값,
거부/중단/취소/재개·시점/효과는 미확인이다. 후보 method의 dispatch 조건은 계속 표시한다.
standalone await에 대한 concrete Tutor body gap은 정확한 parameter 선언과 독립적으로
읽되 기존 input safety flag는 바꾸지 않는다. 전체 source CFG/expression/callsite coverage를
별도로 증명하며 parameter/default/type 근거 부족은 이 opt-in으로 우회하지 않는다.
비동기 facts는 body path를 남겨 primitive leaf/legacy sync recipe로 승격하지 않는다.
generator/async-generator·constructor/accessor·try/finally/loop·숨은/간접/optional/computed
호출·callback·parameter/member 쓰기·Kotlin inline/operator/external/expect 및 기존 prose,
source, token, path, cycle/depth 상한은 계속 모델을 유지한다. zero-call async 반환도 같은
Promise/suspend 계약과 cache를 사용한다. 모델·sampling·context/output/thread 상한은 유지한다.
순서 모델은 최대 512 블록·1,024 제어 연결, 하나의 경로는 1,024 탐색 단계·256 표시 항목으로
제한한다. 근거 부족과 한도는 표시하며 원본 소스를 실행하지 않는다.

호출 순서는 조건 판단(보라), 반복(주황), 호출(파랑), 반환·종료(초록)를 VS Code 테마색과
문구·기호로 구분한다. 예외는 빨강, 선택 대기·근거 부족은 노랑으로 표시하며 거짓 조건은
오류로 표시하지 않는다. 타임라인의 조건은 predicate 호출 이후, 해당 결과의 호출 이전에
배치하고 `수정`으로 같은 방문의 조건 선택란을 연다. 호출 관계 연결에도 같은 의미색을
적용하되 신뢰도 점선과 선택 상태를 유지하며 다른 함수를 흐리게 하지 않는다.

호출 조건은 CFG의 지배 관계와 언어별 식 구문을 함께 사용한다. 조기 반환을 피하는 조건,
분기 결과, TypeScript/JavaScript·Python·Kotlin의 단축 평가와 조건부 식, TypeScript의 optional
dispatch를 보존한다. predicate 자체를 평가하는 호출에는 그 결과를 선행 조건으로 붙이지
않고 합류한 분기의 결과도 이후 호출의 필수 조건으로 단정하지 않는다. `for`/`while` 안의
반복 호출과 자기 재귀/함수 사이 순환은 별도로 표시하며 횟수·종료·실제 런타임 실행을
추정하지 않는다. 프로젝트 대상의 exact/resolved/inferred 신뢰도를 유지한다.

함수 호출 모드는 비즈니스 로직에 집중하여 workspace 안에서 정의가 확인된 함수·메서드·
생성자만 노드로 표시한다. `len`, `append` 등의 내장·표준 라이브러리 호출, 미확인 대상,
workspace 밖의 소스, `site-packages`·`dist-packages`·가상환경·`node_modules`의 설치된
의존성은 제외한다. 이름만으로 내장 함수를 판별하지 않아 프로젝트에서 직접 정의한 `len`은
유지한다. Python import 및 lexical binding을 확인해 외부 호출이 이름만 같은 프로젝트
함수에 연결되지 않게 한다. 제외된 호출도 원본 조건·루프 표현식에는 그대로 남으며,
표시 한도나 한도 초과 개수는 소비하지 않는다. 이 범위는 모든 하위 펼침에도 적용한다.

이 모드의 snapshot당 상한은 프로젝트 함수 32개, 호출 지점 128개, 펼침 깊이 6이다.
Host의 한 요청은 최대 512개 구문 블록, 96개 호출 지점, 32개 대상을 분석한다. 응답은
`graphVersion`, opaque `sourceToken`, 단조 증가 `requestId`로 연결하며 root 변경·새
snapshot 이후 도착한 응답은 버린다. `functionCalls/load`는 경로나 임의 symbol ID를
받지 않는다. 편집 중인 root source override와 기존 source/evidence token 권한을 재사용한다.

세부 모듈 계약과 제약은 [FUNCTION_CALLS.md](FUNCTION_CALLS.md)에 기록한다.

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
Inspector를 열면 graph 위에 겹치지 않고 별도 우측 grid column을 차지하며, 839px 이하에서는
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

- graph 위 `한눈에 이해`에서 작성된 함수 설명과 입력/판단/결과를 먼저 읽는다.
  각 action은 해당 source block을 선택하고 graph와 Inspector로 이동한다.
  반환/오류/확인된 외부 효과는 직접 소유한 표시 block 수이며 실행 횟수가 아니다.
- React·Django source fact가 있으면 `프레임워크 동작 이해하기`를 제공한다.
  항목별 호출 시점, 동작 설명, source caption, confidence와 opaque 근거 이동을 제공하고
  실제 runtime scheduling·SQL 관찰과 구분한다. 기본 접힘과 locale 전환 시 상태를 보존한다.
- graph 옆 `함수 따라 읽기` 목차에서 소스 순서와 실제 block counter를 보존하며
  전체/분기/호출/종료 필터와 이전/다음 이동을 제공한다. 1039px 이하에서는 graph 위에서 접고 펼친다.
  목차와 한눈에 이해의 source 이동은 현재 배율을 유지하고, 화면보다 큰 block은 시작 부분을
  표시한다. 일반 선택에서 주변 node/edge/label의 불투명도를 낮추지 않으며 선택 강조는
  테두리와 선 굵기로 제공한다. 명시적인 본문 focus와 분기 제외 표시는 별도로 유지한다.
- Inspector의 `코드 이해`/`값과 경로`/`함수 정보` tab으로 선택 근거, 입력 실험, 함수 선언과
  연결 대상을 분리하고 현재 함수 signature는 `함수 정보`에 배치한다.
- 위에서 아래로 진행하는 control-flow rank
- 같은 rank에서 좌우로 분리되는 branch lane
- label, source detail, branch/callee badge 길이에 따라 달라지는 node width/height
- statement/branch/value-change/child-function/resume 텍스트를 `...` 또는 `…`로 자르지 않고
  전체 보존하며, 가로 폭 이후에는 줄바꿈 수만큼 node height를 확장
- analyzer source가 가진 물리적 줄바꿈과 indentation을 protocol까지 보존하고, graph node와
  선택 evidence의 code text를 keyword/literal/string/number/comment/operator/type/function token으로
  구분한다. token renderer는 반복 scanner와 `textContent` span만 사용하며 HTML 해석, source 실행,
  외부 syntax-highlighter runtime을 사용하지 않는다.
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
- 선택한 binding 하나의 possible definition-to-use relation을 nearest-use quadratic hop overlay로
  표시한다. declaration/use/sink를 짧게 이어 control edge의 중앙 channel과 구분하고, consume은
  dotted cue, sink는 double/striped cue와 텍스트로 구분하며 branch choice 밖 endpoint를 가진
  value hop은 control choice와 함께 흐리게 처리
- 모든 Function Logic Inspector의 `값과 경로` tab에 존재하는 Debug Variables 유사
  `Name`/`Scenario input` editor에서 parameter별 JSON/scalar 입력 또는 local/constant
  definition override를 입력하고 같은 binding의 graph/selection access row에 즉시 표시
- bounded `logic.tutor` seed 또는 지원되는 선언 parameter type이 있으면 Values의 명시적 추천
  action은 ranked first all-known serializable seed(없으면 first partial-known)를 기준으로 삼는다.
  seed의 known source/default/literal 값은 보존하고 missing/unknown만 보수적 declared-type
  representative로 보완한다. same-file typed array는 지원되는 element 하나를, tuple은 지원되는
  position을, complete required object shape은 literal-first 또는 `"sample"`/`0`/`false` leaf를
  사용하고 broad unshaped array/object만 명시적 `[]`/`{}` fallback을 사용한다. parameter `bindingId`만
  채운다. source/certainty/type 보완 수/남은 unavailable 수를 표시하고 source 실행, Host message,
  branch 자동 선택, playback 자동 시작은 없다. callable/unknown 및 실제 값을 모르는 enum이나
  literal union에는 임의 값을 만들지 않는다.
- TypeScript type 추천은 direct primitive/collection과 같은 파일의 alias/interface, readonly
  array, 호환 union, object intersection만 최대 depth/step/cycle guard 안에서 broad type으로
  정규화한다. imported type과 cyclic alias는 임의 해석하지 않고 unknown으로 유지한다.
- object parameter의 required property는 최대 2단계의 type-shaped JSON 대표값으로 만들고
  optional property는 생략한다. imported/cyclic/callable/unknown 또는 incomplete required shape은
  unavailable로 남기며 실행 가능한 가짜 값을 만들지 않는다. source order, first evidence precedence,
  structural deduplication, seed identity는 identical build에서 결정적이다.
- direct safe member predicate는 parameter의 typed field path를 보존하고, 해당 field의 true/false
  boundary value만 complete declared object representative에 반영한다. object parameter 전체를 scalar
  leaf로 대체하지 않는다. `&&`/`||` 조건의 atomic field predicate를 source order로 수집하며 typed
  string/array의 `.length` 조건은 bounded container value로 변환한다. 선언 타입이 없더라도 direct
  safe member predicate는 bounded object shape의 근거가 될 수 있지만, untyped `.length`처럼
  container kind가 모호한 경우에는 추측하지 않는다.
- Values는 root graph session과 opaque Tutor fingerprint별 browser-local Scenario Workspace를
  lazy로 연다. 사용자에게 보이는 row 단위는 input seed가 아니라 도달 가능한 path scenario다.
  Scenario/경로 조건/예상 효과·outcome/confidence·gap 네 data column과 별도 action column,
  선택 detail의 이름 있는 추천 input을 제공하며 idle/calculating/paused/ready/partial/error/empty
  상태를 텍스트와 polite live status로 유지한다. 평가가 concrete path를 만들지 못하면 bounded
  graph planner가 source-backed 조건 선택과 도달 효과만 symbolic scenario로 열거할 수 있지만,
  이때 실제로 계산하지 않은 parameter·중간값·반환값을 concrete value로 표시하지 않는다.
  row/path selection은 resolved evidence preview만 바꾸며 input, branch choice, graph block
  selection, viewport, playback, Host state를 바꾸지 않는다.
- Function Guide의 시나리오 disclosure는 동일한 native `details`를 유지하고 body만 갱신한다.
  Guide가 활성화되고 disclosure가 열려 있는 동안만 하나의 Scenario Workspace consumer를
  보유하며 반복 mode/locale 갱신은 추가 acquire나 toggle 계산을 만들지 않는다. graph 교체는
  Guide/Values 구독과 preview DOM registry를 해제한다. 같은 root/fingerprint의 relayout은
  입력·평가 결과를 재사용하고 다른 root/fingerprint로 이동하면 이전 workspace 결과를 비운다.
  명시적인 새 root 요청 또는 graph reset은 다음 함수의 로딩·실패 상태에서도 이전 결과를 비운다.
- symbolic path plan은 root/fingerprint당 한 번 만들고 모든 seed가 공유한다. 대표 요약은
  결과·오류·seed 추가 시에만 증가하는 `resultRevision`을 기준으로 갱신하며, 행 선택·locale·
  playback 갱신은 plan이나 대표 의미 계산을 반복하지 않는다. 계획에는 경로 12개, 분기 판단
  5개, 탐색 상태 48개, 깊이 300의 상한과 경로별 visited set을 적용한다.
- trace와 playback은 renderer별 한 번의 평가를 공유한다. editable input 또는 block/edge의
  선택 경로 제외 상태가 바뀌면 다시 평가하고, locale 변경은 표시 frame만 다시 만든다.
  frame cache는 마지막으로 조회한 binding 하나만 보유하며 graph renderer와 함께 해제한다.
- Apply Inputs는 known parameter binding identity만 쓰고, Apply & Play는 deterministic으로
  resolved된 scenario branch edge만 별도 snapshot과 함께 적용한다. unrelated choice는
  보존하고 touched prior choice를 restore할 수 있다. manual input/branch edit는 story를
  cancel하고 Custom/Modified로 표시한다. Scenario frame은 START 뒤 ordered transition이며
  same-binding exact visible lexical hop만 travel한다. Evaluator가 보존한 root block occurrence
  순서(반복 decision, 각 iteration body 변경, 반복/exit, continuation)를 그대로 frame으로
  투영하며, 알려진 mutation은 축약 없이 `variable: before → after`로 wrapping status/plaque에
  한 beat씩 표시한다. 나머지는 synthetic edge 없이 discrete calculation beat로 표시하며 reduced
  motion에서도 Play/Previous/Next의 동일한 textual order를 유지한다.
- 각 seed의 평가·symbolic path는 모두 독립 row가 되고 네 data column 뒤에 sibling
  Apply & Play action을 둔다. action은 그 row의 exact seed/path index를 preview한 뒤 기존 단일
  scheduler에 전달한다. 일반 row 선택과 keyboard 이동은 preview-only이며 path가 없는 row
  action은 이유와 함께 disabled다. active/paused/completed story는 localized row text로 드러내며
  active 중 재시작은 막고 complete 뒤 Replay를 제공한다. symbolic story는 START 입력 증거,
  source order의 계산·값 변경, 선택한 조건 결과, 도달한 외부 효과, terminal 결과를 차례로
  보여준다. 인접 block의 visible exact control/value edge가 있을 때만 token이 그 edge를 이동하고,
  그렇지 않으면 synthetic edge 없이 camera가 다음 source beat로 이동한다.
- Playback card는 browser-local native `Playback speed / 재생 속도` select로 `0.5×`, base
  `1×`, `1.5×`, `2×`만 허용한다. automatic transition/dwell 동안만 disabled이고, multiplier는
  remaining exact-hop duration 및 dwell을 나눈다. 변경은 start/reset/advance를 만들지 않으며
  card locale refresh에는 남지만 Host, workspace setting, persisted state에는 기록하지 않는다.
  reduced motion은 motion 없이 동일 ordered textual beat를 보존하고 speed는 남은 dwell cadence에만
  영향을 준다.
- editor는 Inspector의 `값과 경로` tab 최상단 non-shrinking row에 배치한다. analyzer binding row가 많으면
  variable list 내부만 bounded scroll하고, selected-block evidence가 길어도 editor를 압축하거나
  초기 viewport 밖으로 밀어내지 않는다.
- analyzer binding이 0개이거나 일부 이름을 놓친 경우에도 사용자가 lexical identifier 이름과
  초기값을 가진 `CUSTOM` variable을 최대 32개 추가/삭제할 수 있다. 같은 이름의 단일 analyzer
  binding이 이후 relayout에서 나타나면 session value를 그 실제 binding row로 승격한다.
- 선택 binding 및 그 값을 provenance로 갖는 downstream assignment의
  `DEFINED`/`CALCULATED`/`UPDATED`/`CONSUME`/`SINK` progression을 최대 80단계로 표시하며,
  source-backed initializer/assignment/compound assignment/increment를 `before -> after`로 계산
- 산술/비교/boolean/nullish/own-data member read와 JavaScript/Java 중첩 `?:`를 token/operator/value
  stack 기반으로 계산한다. exact property assignment/compound update/increment/delete는 Scenario에
  입력한 JSON-shaped plain object/array의 해당 경로만 반복 기반 copy-on-write로 복제해 계산하고,
  field path와 leaf `before -> after`를 표시한다. dynamic bracket key는 같은 Scenario의 known
  string/number binding일 때만 해석한다. call/constructor/getter/inferred receiver mutation,
  unknown-key mutation은 실행하지 않은 채 reason을 포함한 `unknown`으로 보존
- property write는 own data descriptor만 읽으며 최대 path depth 24를 적용한다. `__proto__`,
  `prototype`, `constructor`, accessor-backed field, non-plain prototype은 실행하지 않는다.
- 선택한 true/false/case control edge와 dimmed block을 계산 CFG에서 제외하고, choice가 없는
  merge에서 서로 다른 값은 임의 선택 없이 `multiple reachable values` unknown으로 합침
- scenario value의 `Name` label을 누르면 공용 binding selector가 같은 binding을 선택하여
  해당 label, definition/use graph node, value-flow edge를 함께 highlight
- scenario 입력은 root graph browser session 동안만 유지하고 편집 값 1,200자/graph label 240자/분석 row 120개,
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
- Guide가 있는 새 root graph는 모든 폭에서 Guide를 먼저 연다. Guide가 없는 경우 기존
  wide Inspector/narrow graph 기본값을 유지하며 사용자의 mode/open/close 선택과 각 surface의
  독립 scroll position은 같은 root relayout 동안 유지
- selected summary와 source action은 Inspector의 `코드 이해` tab 첫 section으로 유지한다.
  Scenario value editor와 binding selector/playback은 `값과 경로`, callee 목록과 signature는
  `함수 정보`에 배치하며 tab별 scroll position과 mounted input identity를 보존한다.
  static flow ledger는 source-order 목차로 대체한다. binding이 없으면 editable Scenario empty
  state는 유지하고 selector/playback은 숨긴다. callee가 없으면 빈 호출 surface를 만들지 않는다.
  긴 scenario variable list는 editor 내부에서 별도로 bounded scroll한다. Scenario 계산은 graph
  mount나 tab/locale 변경이 아니라 Workspace의 첫 직접 focus/pointer interaction에서 시작한다.
  `값과 경로`가 숨겨지면 해당 계산 consumer를 해제하고 playback을 일시정지하며 graph disposal에서
  나머지 자원을 해제한다. Function Guide는 별도 exclusive drawer mode를 유지한다.
- desktop에서는 graph와 별도 column, 작은 화면에서는 Guide가 graph 위, Inspect가 graph 아래
  별도 row, 명시적 toggle/close,
  `Escape`, `aria-expanded`/`aria-hidden`/`inert` 상태
- child function attachment로 graph를 다시 그려도 같은 root에서는 drawer open 상태 유지
- 빈 canvas의 primary drag, 어느 target에서나 middle drag, modifier 없는 two-axis trackpad
  wheel로 상하좌우 screen-space translation을 변경하고 graph 원점의 모든 방향을 지나 pan 가능
- 기본 header는 Guide·Fit과 접힌 Tools를 표시한다. Tools에는 `− / 현재 배율 / + / Center`,
  목차·Inspector·범례·overview를 넣고 목차도 처음에 접는다. 1%~300% bounded zoom. `Center`는 현재 배율을
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
- Kotlin ANTLR adapter 기반 source control, expression-arm write, lexical value fact 추출
- F#/OCaml/Elixir 공통 pipe-forward adapter 기반 input/stage/argument-insertion classification
- 언어 중립 structured-control contract로 branch container와 transfer를 구성
- `core/structuredFunctionLogicAnalyzer`의 generic source/node adapter 계약을 공유하고
  기존 Lezer entrypoint는 호환 wrapper로 유지
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

#### `analyzer/languages/kotlin`

- 공식 Kotlin 문법의 고정 revision과 ANTLR 4.13.2 생성 TS parser를 사용
- public `index.ts`에서 immutable source/node, callable/call fact, UTF-16 범위와
  `KotlinAnalyzer`를 제공하고 generated parser/context는 내부에 유지
- Kotlin 작업이 처음 발생할 때만 parser/runtime을 load하며 설치·실행에는 JVM이 필요 없음
- source hash별 snapshot을 최대 8개·합계 2MiB source text로 유지하고 token 100,000개,
  token nesting 128로 파싱 입력을 제한; 실패·제한은 diagnostic으로 보존
- 현재 선택 파일을 cache budget 안에서 우선하고 변경·닫힘·삭제·종료 때 stale snapshot 해제
- provenance, 재생성 명령과 명시적 문법 보정은 모듈 README/manifest에 기록

#### `application/codeFlow/functionTutor/behaviorSummary`

- public builder는 declaration, CFG와 이미 수집된 context를 받아 bounded common Summary 생성
- 반복 탐색과 scope boundary로 deferred/nested body를 현재 함수의 직접 작업에서 제외
- projection은 현재 graph의 opaque block/edge/evidence mapping만 사용
- `webview/codeFlow/tutor/summary`는 optional payload를 runtime 검증하고 기존 Guide에 렌더링
- representative projection은 공유 Workspace의 `resultRevision`에만 의존하며 I/O·추가 계산 없음

#### `application/functionNarratives` 및 `webview/functionNarratives`

- 로컬 provider는 미리 설치된 공식 CLI의 `llama-server` companion이 있는 Unix 환경에서
  같은 FIFO resource를 연속 요청에 재사용한다. 인증 key·socket은 0700 임시 폴더에 두며
  TCP listener·proxy·daemon·activation-time 추론을 사용하지 않는다. key는 0600이며
  source·prompt·응답·key 값은 process argv와 작업 이력에 넣지 않는다.
- `ModelTaskManager`는 다른 resource·일반 adapter 실행 전에 이전 resource 종료를 기다린다.
  실패·취소·timeout·dispose도 자식 종료 뒤에 슬롯을 해제한다. 성공 뒤에는 한 event-loop
  turn에서 호출자가 다음 chunk를 enqueue할 기회를 준다. 명시적인 page scope 안에서는
  비동기 준비·저장 사이에도 재사용하고 page 완료 전에 종료를 기다린다. scope가 없으면 큐가
  비면 바로 종료한다. 비동기 gap 중 scope 취소는 idle 모델을 해제하며 다른 scope의 lease는
  유지한다. scope는 실행 슬롯을 확보하지 않고 다른 resource 작업은 여전히 종료 뒤 실행한다.
  watchdog은 parent pipe EOF에도 모델을 종료한다. companion 없음·custom runner·Windows는
  기존 CLI를 사용하며 source 준비·개별 추론 deadline·단일 모델 슬롯 상한은 유지한다.
- `llm/functionNarratives/localWire`는 required const/single-enum metadata만 출력 schema에서
  제거하고 동일한 schema 슬롯에서 복원한다. code·when/outcome·input name/value는 모델 해설을 실제
  구문·경로·값에 연결하는 출력 토큰으로 유지하며 고정 scalar/조건 목록 변경도 거부한다. 모델이 제거된 metadata를 직접 반환하거나
  tuple 수·필수 필드·추가 필드를 바꾸면 거부한다. optional·union 분기는 축약하지 않는다.
  확장 전후 24,000자 상한과 원래 source/route/example/언어 검증을 유지한다.
- rich primary는 첫 두 구문을 source 순서로 values와 함께 읽는다. Host는 원래 code/source와
  일치하는 prefix만 재사용하며 미래 terminal을 선행 상태로 사용하지 않는다. 모델 출력에서
  고정 identity를 생략하더라도 각 schema 슬롯의 description은 실제 구문을 명시한다.
  서로 다른 구문의 text/syntax가 같은 경우 prefix 재사용을 멈추고 남은 구문을 다시 읽는다. 남은 모든
  node·반복 방문은 기존 bounded chunk로 처리한다. model worksheet는 도달한 구문과
  predicateResult를 구분하고 명시적인 Kotlin/TypeScript/Python primitive 입력만 type으로
  제한한다. alias·복합 type·외부 결과를 임의로 확정하지 않는다.

- 로컬 rich adapter는 첫 요청에서 입력과 첫 두 노드만 준비하고 모든 node 작업 후
  최종 summary를 생성한다. Native Host의 deadline/progress adapter도 final-summary/page-scope
  capability를 전달한다. 실제 `result`/`condition` 변수 쓰기는 synthetic 판단/반환 값과 구분해
  선행 상태로 이어준다. provisional paragraph/result는 공개·저장하지 않는다.
  후속 node 입력은 원래 inputs와 선행 model values만 유지하며 미래 결과·기존 문단은 제외한다.
  마지막 summary는 완료된 source-order code/value trace 최대 2,000자, 생략 개수와 terminal
  model result를 사용한다. 원래 inputs·steps·알려진 result를 변경하면 거부한다. summary 실패나
  취소는 완료된 node 작업을 보존하고 해당 단계만 재시도한다. 다른 provider의 기존 계약은 유지한다.
- 명시적인 primitive 반환 type, numeric IR write type은 실제 JSON kind로 제한하고 portable
  text로 encode한다. 계산식을 숫자로 수리하지 않는다. return 식의 연산은 모델이 설명한 뒤
  result 값을 쓰며 exact literal return/write·변경되지 않은 Boolean input guard·선언 전 표시는 source-owned
  사실을 사용한다. object/array 고정 결과는 값으로 비교하고 원래 JSON 순서를 복원한다.
  제한·생략 없는 exact primitive path이며 calls/accesses/unknown identifiers가 없을 때만
  assumptions/limitations를 []로 고정한다. 그 외 경로는 기존 미확인 정보 계약을 유지한다.
  이 계약은 모델 문장이나 실제 실행의 정확성 보장이 아니다.

- `webview/codeFlow/narrativeNotes`는 선택한 저장 시나리오의 `nodeDetails`를 현재 graph의
  verified identity adapter·layout과 결합한다. 해당 시나리오의 `graph.nodeIds`에 없는 노드와
  미해결 identity는 제외하고 반복 방문의 원래 node index·예시값·source를 보존한다.
  각 source node의 번호 버튼과 점선 참조로 graph 옆 노트를 열며 점선은 control edge가 아니다.
  노트는 구문·이유·효과·모델 예시값의 변화·원본 열기를 제공하고 LLM 미검증·생성 언어를 표시한다.
- 노트는 원본 graph geometry를 이동하지 않는 별도 rail에 배치한다. 열리는 긴 노트가 다음
  노트와 겹치지 않도록 배치하며 camera bounds만 확장한다. 번호 클릭은 배율을 유지한 최소
  pan, 숨기기는 선택한 source node로 복귀한다. hide/show 선택은 최대 16개 graph session에
  보존한다. IntersectionObserver로 상세 DOM을 최대 40개만 mount하고 모든 source anchor는
  유지한다. node/locale/paging/visibility는 inference를 요청하지 않으며 snapshot 교체·disposal은
  observer·subscription·note authority를 해제한다. source action은 저장 page/scenario/node index를
  고정하고 오래된 page/scenario에서 발생한 action을 거부한다.

- `buildFunctionNarrativeContext`는 선택 함수의 immutable source snapshot에서 최대 5개,
  합계 18,000자 스니펫을 구성한다. 본문 160줄/10,000자, 생략 시 별도 끝 20줄/2,000자,
  앞의 문서·상수 16줄/2,000자와 같은 파일의 직접 helper 최대 60줄/2,000자를 사용한다.
  raw 파일 경로와 analyzer identity를 LLM 또는 Webview에 전달하지 않는다.
  같은 identity·파일의 Function Logic이 제공하는 parser-owned `sourceRange`를 본문 범위로
  재사용한다. native graph가 선언 줄만 보존해도 실제 함수 본문을 포함하며 인접 함수의
  범위를 추측하지 않는다. graph identity·range와 기존 snippet 예산은 유지하고 추가 파싱은 없다.
- 같은 snapshot의 이미 계산된 Function Logic으로 optional `sourceFlow`를 구성한다.
  source route는 최대 3개/24 depth/128 탐색 작업/4,000자이며 entry 이후 첫 return/throw에서
  멈춘다. visited set은 route별로 유지하고 duplicate edge, deferred/callable boundary를
  제외한다. cycle, missing source/block, depth/control gap은 partial로 보존한다.
  `source-terminal`은 구문 경로의 끝이며 실제 실행·입력 도달 증거가 아니다.
- 기존 Tutor IR의 직접 conditional/binary definition은 source-backed `valueFacts` 최대 6개로,
  기존 complete static evaluation의 primitive 입력·판단·terminal은 `checkedExamples` 최대
  3개로 제공한다. 두 종류의 record는 합계 2,000자이며 추가 parsing/probing/source I/O는 없다.
  inferred block/edge, symbolic/partial 결과, 제공하지 않은 caller 값과 nested/deferred write는
  제외한다. 명시적 primitive type인 required Boolean의 정확한 direct predicate만
  matching true/false 입력으로 정규화한다. optional/nullable/alias/member 조건은
  원래 구문 선택을 유지한다.
- `context.limited`는 실제 source excerpt 생략만 표시한다. 경로 분석의 한계는
  `sourceFlow.limited`, 추가 fact/check의 예산 생략은 `groundingLimited`에 따로 보존한다.
  본문을 모두 제공한 Kotlin 함수에 정적 계산 한계만으로 코드 생략 안내를 표시하지 않는다.
- complete exact return/throw route 또는 complete primitive check가 있으면 provider에
  source frame을 제공한다. when/outcome/허용 source는 frame별로 고정하고 prose는 LLM이
  작성한다. 로컬 grammar는 tuple items와 const/enum으로 제한하며 Host는 두 provider의
  응답에서 frame 개수·순서·조건·terminal·인용을 다시 검증한다. 검증이 끝난 frame의 제목은
  Host가 조건을 ` · `로 연결한 최대 160자로 표시한다. 조건이 없으면 terminal을 사용한다.
  전체 조건은 근거에 유지하고 provider prompt/grammar와 모델의 문장은 변경하지 않는다.
  새 전체 분석은 complete/inferred/partial/implicit exit 경로 모두에 별도 고정 slot을 제공한다.
  실행 step이 없는 경로는 소유한 선언 인용만 제공하고 `code`를 생략한다. 로컬 JSON schema는
  빈 enum을 만들지 않으며 partial 예시의 결과는 `null`로 고정한다. Host는 해당 경로의
  지어낸 code를 계속 거부한다. implicit exit를 실제 실행이나 반환값 증거로 취급하지 않는다.
  `scenarioBatch.offset`이 없는 이전 context만 자유형 fallback을 유지한다.
  이 검사는 문장의 의미 정확성을
  보장하지 않는다. context identity에는 위의 source fact와 static check도 포함한다.
- `FunctionNarrativeProvider.generate`는 사용자 요청으로만 호출되는 교체 가능한 LLM 경계다.
  optional `prepare(language, signal)`는 source 없이 명시적 요청 때만 실행하며 추론 timeout보다
  먼저 끝난다. 기본 local adapter는 PC에 설치한 `llama-completion`과 기존 설정 GGUF 또는
  자동 준비한 Qwen3.5-4B Q4_K_M을 명시적 요청에만 실행한다. 8,192 token context, 출력 2,400 token, CPU thread 2개,
  offline mode와 JSON grammar를 사용한다. 프로세스는 요청 종료/취소 때 해제하며 공급자
  설정 변경을 포함해 한 Extension Host에서 하나만 실행한다. 요청 언어는 별도 system message로
  전달한다. 한국어의 자유 서술 필드는 한글로 시작하도록 bounded JSON grammar로 유도하고
  고정된 source 식은 유지한다. private 임시 user/system prompt와 JSON schema는 요청 종료 시 삭제한다.
  `--json-schema-file`로 source를 포함한 grammar도 argv 밖에서 전달한다.
  optional companion server는 한 명시적 전체 함수 요청 동안만 weights를 재사용하고,
  weights 로딩/health 준비는 별도 FIFO `prepare` 작업으로 기록한다. 소스만으로 완성되는
  응답은 준비 작업을 시작하지 않는다. 준비는 생성 token 없이 취소·180초 timeout·process
  cleanup을 공유하며, idle에는 모델을 유지하지 않는다. `generationMs`는 모델 준비 이후
  template 적용부터 전체 응답 수신까지의 시간이다. parser/Host 검증까지 포함한 전체 설명
  시간은 `benchmark-model-context.mjs`에서 별도로 측정한다. 첫 token이나 streaming을
  3초 완료로 대체하지 않으며, 작은 GGUF도 같은 source/언어/다섯 항목 검증을 거친다.
  `benchmark-model-scopes.mjs`는 실제 호출 Host의 overview/call/scenario를 새 manager와
  Host로 측정한다. source-free 준비는 제외하고 context 구성부터 전체 페이지 전달까지
  포함한다. 이전 설명/source KV cache는 재사용하지 않으며 고정 구문 필드가 생성문 의미
  검사를 대신할 수 없다. 공개 corpus의 생성한 flow에는 계산식·catch 반환·정리 인수가
  있어야 하며, 없는 숫자 인용·닫히지 않은 인용·반복 문장·다른 언어의 설명도 실패로
  기록한다. 이는 해당 corpus의 필요 조건 검사이며 일반 의미 판정이나 전체 함수 rich
  시나리오의 보증이 아니다.
  ChatML fallback의 Qwen3.5 assistant 접미부에 공식 비추론 `<think>`/`</think>` 경계를
  적용한다. 이미 완성된 접미부나 다른 모델의 template은 덧붙이지 않는다.
  각 추론의 FIFO 진입·취소·실패·provider switch·Host 종료 정리를 유지한다. 실행기의
  bounded help probe가 모두 광고한 선택 옵션만 적용하며 checkpoint 8개와 prompt RAM cache
  256 MiB를 별도로 제한한다. 짧은 JSON 응답에서 recurrent state 복사 비용이 관측되어
  speculative decoding은 광고된 `--spec-type none`으로 끈다. 공통 source user message와 task suffix의
  ChatML 경계를 명시해 source checkpoint를 재사용한다. 이전 모델 상태는 공통 prefix에
  넣지 않으며 source를 system instruction으로 취급하지 않는다. 기존 CLI와 다른
  템플릿의 single-user contract, context/output/thread/grammar/sampling 한도는 유지한다.
  local rich 준비·노드 요청은 완전한 exact primitive source route에 한해 bounded worksheet를
  즉시 구성할 수 있다. 최대 8개 typed input, 128개 후보, 32개 unique source operation과
  160자·64 token의 iterative primitive expression substitution만 허용한다. 조건 선택,
  직전/직후 지역 값, 연산자 의미·계산식·다음 구문과 원본 인용을 보존한다. call/access,
  unknown type/operator, coercion, zero divisor, Kotlin overflow/Float, nested binding declarations,
  loop/exception, inferred/partial/source gap 또는 carried model state 충돌은 기존 LLM으로
  넘긴다. 0.0.1120에서는 Kotlin Int의 0 방향 정수 나눗셈/나머지도 다루며, 0 divisor와
  overflow는 모델 분석으로 넘긴다. nested control block은 함수 scope의 기존 binding
  갱신만 허용하고 그 안의 선언·shadowing·nested callable은 거부한다. source는 실행하지 않는다.
  동일 snapshot·언어의 검증된 목적 요약 240자 하나만 재사용한다. 완료된 노드의 code·값과
  독립 source trace가 모두 일치하고 누락된 값이 없으면 최종 pathReason/stateChange를
  concrete 조건 대입·모든 지역 before/after·반환 근거로 고정할 수 있다. 220자를 넘는
  근거는 자르지 않고 기존 LLM에 맡긴다. 이 고정 근거는 현재 task에도 전달해 문단의
  판단·계산과 일관되게 설명한다. 0.0.1120은 complete 현재 trace와 독립적으로 계산한 다른
  source route/input이 있을 때 explanation·alternative도 소스 근거로 구성한다. 문단 1,800자,
  대안 600자를 넘는 근거는 자르지 않고 기존 모델 분석을 유지한다. 다른 route 탐색은 최대
  32개·depth 64로 제한하되 전체 lazy 경로 열거는 제한하지 않는다. 함수 전체의 목적만
  최초 한 번 선택한 local LLM이 summary 240자로 설명하고 이후 같은 snapshot·언어에서 재사용한다.
  미확인 call/access/type/effect는 source synthesis로 처리하지 않는다. Kotlin interpolation/Double
  literal과 JSON이 구분을 잃는 JS -0도 primitive worksheet에서 제외한다. 이름 없는 완전한
  Boolean constant source 조건은 TS/JS/Kotlin의 불가능한 if 선택을 열거에서 제외할 수 있지만,
  unknown 조건·다른 언어·symbolic loop pass는 그대로 보존한다. Host-only alternate path의
  graph identity는 외부 모델 prompt에 전달하지 않는다. UI는 모델·소스 해설/입력 예시와
  실제 실행 미검증을 표시하며, 전체 노드의 syntax/text/reason/effect/source/value는 보존한다.
  0.0.1121은 Host-owned `sourceWorksheet` port로 기존 Tutor IR interpreter를 재사용한다.
  TS/JS의 객체 속성·배열 읽기, 단독 객체 속성 변경, 소스로 resolution된 순수 helper가
  complete exact 경로의 모든 구문·선택과 일치할 때만 같은 source synthesis를 적용한다.
  입력 후보는 최대 128개·8개 parameter, 계산은 64 step·block당 1 visit·32 source operation,
  값은 depth 4·128 frame·container당 8 item·JSON 240자로 제한한다. 잘라낸 값을 쓰지 않는다.
  before/after 객체 전체, truthy 조건의 Boolean 결과, 원래 code·syntax와 operand 값을 보존한다.
  shadowing/repeated declaration, const 재대입, alias member write, external effect, loop/exception,
  helper source 누락·truncation, negative zero/non-finite 또는 완전한 반환·대안이 없으면 기존 모델
  경로를 유지한다. evaluator port와 원래 IR·binding identity는 외부 prompt에 넣지 않는다.
  0.0.1122는 선택된 source route의 방문 수를 IR의 block visit 한도로 사용한다(max 32,
  전체 64 step·32 source operation 유지). loop의 iterate/exit/repeat-exit은 각 방문의
  실제 Boolean 결과와 일치해야 하며, 같은 조건의 첫 결과를 재방문에 복사하지 않는다.
  primitive 경로는 반복이 있을 때 node identity와 전체 현재 state를 visited key로 사용해
  정지 cycle을 거부하고 각 source operation을 순서대로 대입한다. nested 선언·shadowing,
  Int overflow, 외부 효과와 미확인 반복은 계속 거부한다. 조건·본문·다시 조건·반환이 모두
  확인된 예시만 source 설명으로 구성하며 symbolic loop pass를 실제 반복 횟수로 간주하지 않는다.
  Kotlin while/do-while은 parser-owned predicate를 본문 span과 별도로 보존한다. TS/JS
  do-while은 최초 body 진입을 predicate보다 앞에 연결하고 body 내부 repeat/continue 및
  nested-control exit은 predicate에 남긴다. lazy iterator는 post-test body의 이미 방문한
  구간을 한 번만 다시 열고 depth/cycle 한도를 유지한다.
  함수 전체 graph의 구문이 단일 literal 비교 loop, 단일 counter 갱신, 같은 counter 반환,
  선택적 parameter→지역 변수 초기화뿐이고 현재·대안 trace가 모든 구문을 각각 확인하면
  `buildFunctionNarrativeLoopPurpose`가 목적도 정확한 source recipe로 구성할 수 있다.
  source/gap/inferred edge, 추가 분기·작업·반환 계산은 이 recipe에서 제외한다. generic runtime
  disclaimer와 실제 source 누락은 구분하며, 모든 retained node/edge와 인용을 검사한다.
  이 경우 `sourceFunctionPurpose`는 Host-only이며 외부 prompt에서 제거하고, local provider는
  모델 실행 없이 `Source analysis`/`소스 분석`으로 표시한다. 복잡한 목적은 모델에 남긴다.
  0.0.1123은 primitive 인수의 standalone 직접 호출(최대 4개)과 사용하지 않는 반환값을
  조건부 source trace로 읽을 수 있다. 모든 계산·조건·구문·인수는 여전히 순서대로
  대입하며, 호출 내부 동작·반환·예외·외부 상태는 미확인으로 보존한다. 호출은 실제로
  실행하지 않는다. 호출이 정상 복귀하고 이 함수의 지역 값을 유지한다는 가정을
  문단·대안·assumptions·limitations와 호출 뒤 노드의 축약 text 및 reason에도 표시한다.
  `hasCompleteSourceWorksheet`는 조건부 계산을 포함할 수 있지만,
  `hasCompletePrimitiveWorksheet`와 순수 factual analysis에는 미확인 호출을 허용하지 않는다.
  `eval`, 수신자 메서드, 객체/콜백/미확인 인수, 호출 반환값 사용, nested scope,
  exception 및 호출을 포함한 loop는 기존 모델 경로를 유지한다. 인수는 최대 8개,
  call 구문은 480자이며 기존 32구문·8입력·128후보·값/문단 길이 한도를 유지한다.
  `buildFunctionNarrativeSourcePurpose`는 기존 loop recipe에 더해, 전체 graph가 단일
  primitive counter 초기화·갱신 → 직접 호출들 → 같은 counter 반환이고 현재·대안의
  모든 인용과 계산이 맞는 경우 목적을 구성한다. 추가 분기·interleaved 계산·반환식,
  source 누락·helper·inferred edge는 이 recipe에서 제외한다. 정상 복귀와 지역 값 유지,
  내부 동작 미확인 조건을 목적에도 보존하고 240자를 넘으면 모델을 사용한다.
  0.0.1124의 complete Host는 `prepare`에 source-free `sourceReading` hint를 전달한다.
  local 설정에서는 이때 machine 설정만 AbortSignal별로 고정하고 binary/model의 stat,
  managed cache 검증·다운로드, local provider 생성과 모델 준비 작업을 시작하지 않는다.
  `buildSourceFunctionNarrativeResponse`가 기존 source worksheet 또는 현재·대안의
  matched synthesis를 만들 수 있으면 같은 Host validation을 거쳐 바로 사용한다.
  source만으로 목적이 불충분한 첫 단계는 기존 prepare queue에서 자동 모델 준비를
  수행한 뒤 inference queue에 들어간다. 다운로드·대기 시간은 inference deadline에
  포함하지 않고 binary 확인은 계속 대용량 다운로드보다 먼저 수행한다.
  withRun은 첫 실제 model 단계에서 provider의 기존 resource scope를 지연 획득해
  페이지·source 계산·비동기 저장 사이에도 유지하고, 취소·실패·종료 시 정리를 기다린다.
  cached purpose에는 Host-only `knownModelName`을 함께 보존해 새 AbortSignal이나
  변경된 설정에서 source-only 다음 페이지를 읽어도 원래 producer를 유지한다.
  이 필드는 외부 prompt에서 제거한다. explicit model-only prepare와 vscode 공급자 선택은
  기존 동작을 유지하고, manager disposal 이후에는 새 source 생성도 취소로 거부한다.
  0.0.1125는 non-null Kotlin Double과 Int의 numeric kind를 각 피연산자·inferred local
  binding별로 보존한다. Double 값이 현재 정수처럼 보여도 Int로 추측하지 않는다.
  Int / Int는 0 방향으로 버리고 Double이 포함된 나눗셈은 소수를 유지한다. 한 식 안의
  Int division과 Double division을 독립적으로 계산하고 syntax 설명도 각 실제 kind에
  맞춘다. mutable local의 numeric kind는 선언 뒤 바뀌지 않으며 narrowing/불일치 대입은
  거부한다. 기존 expression 160자·64 token, source 32구문·128후보 등의 한도는 유지한다.
  Float, Double?, Double과 Int?의 혼합 smart cast, identity 비교, signed-zero 구분 손실,
  non-finite·huge 값·Int overflow·미지원 변환은 모델 경로를 유지한다. 이 규칙은
  사용자 코드를 실행하거나 JVM typechecker를 대체하는 기능이 아니다.
  전체 graph가 primitive header의 mutation들 → 단일 return뿐이고 현재·대안 trace의
  모든 구문·값·인용이 맞으면 `buildFunctionNarrativeSourcePurpose`가 각 초기화·갱신과
  실제 반환 식을 모두 240자 안에서 읽어 목적을 구성한다. header의 default/arrow setup,
  추가 분기·helper·source 누락·inferred edge는 제외하고, 길이가 넘으면 모델을 유지한다.
  0.0.1126의 `buildAcyclicSourcePurpose`는 최대 32 graph node·8개의 acyclic route를
  depth 64의 반복 iterator로 끝까지 열거한다. 모든 route의 구문·현재 값·분기·반환을
  독립 source worksheet로 확인하고 모든 retained node의 인용을 포함해야 한다.
  mutation·condition·return만 허용하고 루프·미확인 호출·source/graph gap은 제외한다.
  각 조건의 true/false 및 모든 갱신·반환 식을 소스 순서대로 읽으며, 모든 경로의
  동일한 시작 계산만 한 번으로 묶는다. 중간 계산이나 조건을 앞으로 재배치하지 않는다.
  객체/배열 header는 snapshot-owned IR worksheet의 `bodyOnlyParameters` certificate가
  있어야 한다. parser의 parameter-default evidence·defaultValue·rest·parameter gap·
  비동기 실행이 있으면 이 certificate를 제공하지 않는다. primitive lexical guard와
  parser-owned header proof를 구분하고, 전체 purpose가 240자를 넘거나 route 하나라도
  검증되지 않거나 최대 route 수를 넘으면 자르지 않고 모델을 유지한다. 기존 explicit
  connected provider 선택·취소·모델 목적 캐시·Host validation은 유지한다.
  0.0.1127은 nullable Int/Boolean/String header 중 parser-lowered `name != null`
  Elvis 선언이 있고 두 피연산자를 포함한 모든 경로가 독립 확인된 경우에만 complete
  source purpose를 허용한다. operand-only mutation의 같은 source 인용에서 val/var와
  write target을 확인해 각 선택의 초기화 대상과 값을 보존한다. null만 대체 값을 선택하며
  0·false·빈 문자열은 null로 취급하지 않는다. nullable smart cast나 타입 컴파일 검증을
  대신하지 않으며 default/미확인 호출/불완전 경로는 계속 모델에 남긴다.
  모든 경로를 먼저 확인한 후 240자를 넘는 반복 요약에는 serial CFG join recipe를
  시도할 수 있다. true/false successor의 mutation-only arm을 visited set으로 확인하고
  첫 공통 node에서 합류한다. 각각의 action과 빈 arm의 값 유지, 합류 이후 갱신·조건·
  반환을 실제 순서로 한 번씩 보존해야 한다. nested control·cycle·미포함 node·길이 초과는
  그대로 모델을 유지한다. 기존 32 node·8 route·depth 64 한도는 올리지 않는다.
  session은 같은 immutable snapshot/locale의 validated source/model purpose를 이후
  페이지에서 재사용해 전체 purpose proof를 반복하지 않는다. 각 페이지의 completed
  값·현재 trace·대안은 계속 독립 검증하고 원래 producer·취소·disposal 동작을 보존한다.
  rich primary 응답의 `exampleInputs`는 `{name, value}`의 실제 JSON 값을 생성한다. 로컬
  adapter는 이를 기존 `{name, json}` 문자열 계약으로 인코딩하며 Boolean/null 경로 선택,
  입력 크기·깊이·유한 숫자·금지 key 검사와 Host의 source/route 검증은 유지한다. 소스 언어의
  객체·배열 리터럴 문자열을 JSON으로 추측 변환하거나 실행하지 않는다. node/call과 connected
  provider의 기존 응답 계약은 유지한다.
  선택 가능한 VS Code adapter는 연결된 Chat model의 token 한도를 확인한 뒤 실제
  `sendRequest`/response stream을 사용한다. 모델 학습·API key 보관은 하지 않는다.
- `shared/modelTasks.ModelTaskManager`는 한 Extension Host의 Guide·호출 해설·local/connected
  provider와 source-free 준비를 하나의 FIFO 실행 슬롯으로 관리한다. 실행 중 1개,
  대기 최대 32개, 종료 이력 최대 32개이며 새 요청은 다른 소유자의 작업을 선점하지 않는다.
  각 실제 추론은 슬롯을 얻은 뒤 180초 제한을 시작한다. 대기·다운로드는 추론 시간에서 제외한다.
  대기 취소는 adapter를 호출하지 않으며 실행 취소·timeout은 adapter 정리와 로컬 child close를
  기다린 후 다음 작업을 시작한다. 종료·실패·응답 검증 실패 후에도 대기열을 계속 처리한다.
  긴 함수의 경로·노드·호출 묶음은 각각 큐에 진입한다. 완료 캐시·페이지·노드 조회는 큐를
  만들거나 다른 pending 작업을 취소하지 않는다. 설정은 한 명시적 분석의 AbortSignal에 고정한다.
  별도 VS Code 창/원격 Host 간 추론 직렬화는 제공하지 않는다. 다운로드의 파일 lease는 유지한다.
  native **모델 작업 / Model Tasks** 명령·status bar는 현재 작업과 종료 이력을 읽고 명시적인
  개별/전체 취소 버튼만 대기열을 변경한다. 이력은 작업 ID·종류·함수 label·단계·시간과
  controlled 오류 분류만 유지한다. 로그에는 label·원문·prompt·응답·stderr를 포함하지 않는다.
  로컬 runner의 입력 한도·메모리·모델 로드·옵션·문법·종료 코드와 source-free 준비 실패를 구분한다.
- 응답은 최대 24,000자 JSON, summary 1,200자, 시나리오 1–4개, 각 step 1–5개,
  title 160자, scenario `explanation` 1,800자, 기타 설명 600자, 조건·가정 각 4개,
  미확인 부분 6개로 제한한다. 이 상한은 응답 한 페이지이며 함수 전체의 경로 수를 제한하지 않는다.
  전체 분석의 local/connected 요청은 현재 batch의 경로마다 정확히 한 slot을 요구한다.
  batch 없는 이전 local grammar는 시나리오 1–3개와 `explanation`·`text`·`reason`·
  `effect`를 요구한다. 이전 explanation 없는/text-only 응답은 계속 읽고 기존 필드로 문장을
  구성한다. 지침은 일관된 입력 하나의 분기 판단·실제 계산·다음 진행·조기 반환·결과를
  연결된 완전한 문장으로 설명하도록 요청한다. 무관한 함수 해설 예제는 포함하지 않는다.
  이는 프롬프트 개선이며 가중치 학습은 하지 않는다.
  현재 생산 context의 `detailLevel: "rich"`는 scenario `analysis.pathReason/stateChange/alternative`와
  step `syntax`를 요청한다. 각 필드의 portable 상한은 600자이며 Host/browser 언어 검사에도
  포함한다. 누적 조건에 입력을 대입한 이유, 실제 소스 순서의 상태/호출/반환, 다른 분기로
  바뀌는 실제 predicate를 분리한다. 구문 의미는 현재 소스에 있는 해당 언어의 문법만 설명한다.
  이 필드가 없는 이전 context/저장 응답은 계속 허용한다.
  각 step은 제공한 snippet ID와 그 범위 안의 최대 21줄을 참조해야 한다. 이 검사는
  위치와 형식의 유효성만 확인하며 LLM 설명의 사실성·경로 도달·실행을 검증하지 않는다.
  `shared/functionNarratives.isFunctionNarrativeLanguage`는 인용된 코드·문자열을 제외한
  설명의 문자 체계를 확인한다. Host는 source snapshot의 식을 유지하고 자유 서술의 언어가
  요청과 다르면 `language-mismatch`로 거부한다. 잘못된 언어는 캐시·source 표시·완료 결과에
  저장하지 않으며 browser도 설명을 다시 확인한다. 자동 재요청 없이 사용자가 재시도한다.
- 요청 `codeFlow/requestFunctionNarratives` / `codeFlow/cancelFunctionNarratives`는 현재
  graphVersion, opaque flowId, nonnegative safe requestId와 선택적인 cache-only pageIndex/
  pageLanguage만 받는다. Host는 최근 전달한 함수 8개를 유지하며 단일 pending 분석,
  관리 provider의 실제 실행별 180초 timeout(미관리 adapter의 묶음 fallback 90초/이전 단일 요청 45초), 취소·중복 ID·root/graph
  교체를 처리한다. 주변 코드까지 포함한 content hash와 locale로 검증된 결과를 재사용한다.
  선택적 opaque `nodeId`는 해당 언어의 저장 페이지 조회만 허용하며 pageIndex와 함께 받지
  않는다. 이 조회는 진행 중인 분석·페이지 요청을 대체하거나 모델 준비를 시작하지 않는다.
  오래된 함수 context가 8개 상한에서 만료되면 Host-issued source token으로 명시적으로
  다시 불러올 수 있다. 다시 불러오기는 추론을 시작하지 않는다.
- 응답 `codeFlow/functionNarrativesLoaded`는 status, modelName, 생성 언어, cacheHit,
  제한 여부, narrative, snippet 범위와 각 step의 Host-issued evidence token을 포함한다.
  전체 분석은 progress, completed/discovered/optional total/complete/sourceLimited와
  페이지 index/count/global offset을 제공한다. 열거가 끝날 때만 total을 확정한다.
  두 해설 protocol의 `working`은 현재 요청의 검증된 `ModelTaskProgress`만 전달한다.
  opaque task ID, prepare/inference 종류, queued/preparing/running/cancelling 단계와
  대기 순서·대기 수(0–32)를 포함하며 원문·응답을 포함하지 않는다. Browser는 작업 갱신 때
  상태 문구만 바꾸고 기존 문단·입력·focus를 유지한다. 오래된 task ID의 갱신은 무시한다.
  source range를 새 editor token으로 바꾸며 브라우저가 경로·prompt·모델 ID를 정하지 못한다.
- Guide의 짧은 source-backed purpose 다음 optional section은 Kotlin/symbolic-only 및 인자 없는
  함수도 제공한다. 생성 결과는 연결된 문단을 먼저 표시하고 조건·동작 순서·판단 근거·값과 흐름의
  변화·예상 결과·가정은 시나리오별 접힌 Source evidence에 둔다. 모두 literal text로 표시하며
  항상 LLM 추론·실제 실행 미검증과 생성 언어를 명시한다. 전체 정적 Summary, 질문, Source Path
  Scenarios는 처음에 접힌 Analysis details에 둔다. 부모 상세를 닫으면 해당 계산 consumer를
  해제하고 재생을 일시정지한다. 모델이 만든 예시 입력은 편집 가능한 Values와 경로 강조에
  사용하며 정적 확인값으로 취급하지 않는다. 첫 결과만 빈 입력을 채우고 명시적 시나리오 선택/
  예시 적용은 해당 입력으로 바꾼다. 진행률·페이지·locale 갱신은 사용자 편집을 유지한다.
  모델 없음·다운로드 실패·권한 거부·취소·timeout·invalid-response·language-mismatch·입력 한도·queue-full·failed·stale 및 두 locale 지원.
  초기 mount, focus, disclosure와 언어 전환은 LLM을 호출하지 않는다. pending에서는 Cancel만,
  현재 언어의 완료 결과에서는 추가 생성 버튼을 숨긴다. stale 상태는 Reload를 제공한다.
  요청 후 focus는 보이는 Cancel/Reload/Generate 또는 status로 복원하고 locale 변경은 근거
  disclosure 상태와 source button focus를 보존한다.
- `codeFlow/openFunctionNarrativeSource`는 graphVersion, flowId, contextId, 생성 language와
  scenario/step index와 선택적인 pageIndex/nodeIndex만 받는다. Host는 정확한 저장 페이지를 읽고 그 step/node의 evidence
  token을 해석한다. 같은 위치를 인용하는 다른 함수/언어의 설명으로 대체하지 않으며
  비동기 editor open 뒤에도 graph/context/cache 소유권을 다시 확인한다.
- `vscode/functionNarrativeDecorations`는 전체 source hash가 맞는 file 문서에만 최대
  20개 step의 번호를 줄별로 묶어 표시한다. hints는 120자 이하이며 native hover는 escaped,
  untrusted Markdown으로 전체 해설·모델·생성 언어·미검증 근거를 표시한다. 한 결과만 유지하며
  owner의 graph reset/disposal, 문서 수정/닫기, 명시적 지우기, 설정 해제 때 제거한다.
  editor 표시, source action, hover와 지우기는 모델 요청·소스 쓰기·graph 변경을 하지 않는다.

공개 API와 실제 모델 연결 조건은 `docs/FUNCTION_NARRATIVES.md`를 따른다.

#### 전체 소스 시나리오 분석과 페이지 저장

- `buildFunctionNarrativeScenarioGraph`는 같은 snapshot의 Function Logic을 source-backed
  인접 목록으로 투영한다. 전체 조건 경로는 `createFunctionNarrativeScenarioIterator`가
  반복 stack, 경로별 visited set과 depth guard로 lazy 열거한다. 최대 3개 preview와 별개로
  함수 전체의 경로 상한을 두지 않는다. exact/inferred를 유지하고 missing/unsupported/
  cycle/depth 경계는 partial prefix로 보존한다.
- loop는 skip, 한 symbolic body pass의 일반/continue 경로 후 exit, break로 추상화한다.
  모든 반복 횟수 조합을 열거하거나 입력 도달 가능성·외부 결과를 검증하지 않는다.
- `FunctionNarrativeScenarioRun`은 상세 context에서 경로 한 개, 이전 context에서 최대 2개,
  합계 경로 JSON 목표 5,000자로
  batch를 구성한다. 긴 단일 경로는 잘라내지 않고 단독 요청하며 응답 검증·저장이 완료된
  뒤에만 completed를 증가시킨다. 오류·취소는 미완료 batch를 보존하고 명시적 재개만 허용한다.
  모든 조건을 fixed when에 순서대로 보존한다. 긴 조건/loop 본문과 과밀 조건은 소스 줄
  참조/선택으로 압축하고 전체 sourceFlow 구문은 유지한다. 그래도 응답 상한에 맞지 않으면
  context-too-large로 실패한다. 일부 조건이나 시나리오를 버리고 완료로 표시하지 않는다.
- 검증된 prose는 `FunctionNarrativePageStore` port 뒤의 storage adapter가 private
  임시 폴더(0700)/JSON 파일(0600)에 저장한다. construction은 inert이고 read는 다시
  runtime 검증한다. graph/root/context eviction/disposal은 저장소를 해제하며 late write를
  취소한다. Host는 작은 page metadata와 현재 visible page만 유지한다.
- Guide는 한 페이지와 이전/다음 버튼, 완료 개수·페이지 범위를 표시한다. 분석 중 paging은
  비활성화하고 완료·취소·실패 후 완료된 페이지를 읽을 수 있다. locale별 독립 run을
  유지하며 페이지 요청·locale·focus·source action은 추론하지 않는다. source step 번호는
  global page offset을 적용하며 native annotation도 같은 번호로 현재 페이지만 표시한다.
- Qwen3.x 이름의 GGUF는 current llama-completion의 tool-template probe 대신 tool-free
  ChatML/`--no-jinja`/`--reasoning off`를 사용한다. local 8,192 context, 2,400 output,
  thread 2개, offline와 single-process lifecycle은 유지한다. 마켓 확장에는 모델·runner를
  포함하지 않는다. runner는 미리 설치하며 가중치는 첫 명시적 분석 요청에서 자동 다운로드한다.
- 상세 complete local batch는 summary 240자, title 64자, explanation 600자, analysis 각 필드
  220자, 종료/partial 접두부 대표 step 한 개, step text/syntax/reason/effect 각각 120/160/180/160자를 사용한다.
  assumptions와 limitations는 각각 최대 2개다. 이전 model-example batch의 160/280/80자와
  example 없는 context의 240/480/120자 예산은 유지한다.
  기존 portable 응답 최대값과 별개인 생성 예산이며 fixed scenario slot 개수는 줄이지 않는다.
  상세 생성은 `exampleInputs`를 먼저, 계산 해설 뒤에 `exampleResult`를 쓰고 Host가 기존
  `example`으로 정규화한다. 혼합 형태를 거부한다. source graph의 exact 직접 Boolean
  entry 선택을 그대로 유지하며 수정/optional/nullable/alias Boolean은 고정하지 않는다.
  Kotlin의 직접 nullable 입력은 lowering의 null/non-null 선택을 검증하고 partial 결과는 null이다.
  compound assignment의 연산자·피연산자·소스 순서를 named grounding에 보존한다.
  loweredPredicate는 분석기의 조건이며 원문 code와 구분한다. node code와 source가 target과
  정확히 일치해야 하며 실제 source 식만 노드 해설에 표시한다.
- `bindFunctionNarrativeGraph`는 같은 분석의 source CFG와 public projection의 block/edge를
  Host에서 연결한다. 모델에는 graph ID를 보내지 않으며 응답의 graph/nodeDetails ID를 거부한다.
  시나리오당 `example.inputs`는 선언한 모든 매개변수의 이름·JSON text와 표시 전용 result다.
  매개변수 32개, JSON 1,200자/방문 96/깊이 6/container 16을 제한하고 unsafe key/비유한 값/
  실행 구문을 거부한다. 상세 nodeTask는 원래 frame과 예시를 고정하고 최대 2개 target source의
  text/syntax/reason/effect와 예시 before/after를 검증한다. 응답은 새 steps만 반환한다.
  원래 문단·입력·조건·결과는 Host가 상속하므로 모델이 덮어쓸 수 없다.
  방문 순서상 앞의 해설에서 최대 8개 named after 값을 모델 상태로 전달하며 미래 값은 제외한다.
  상세 primary의 종료 인용은 중간 상태가 생기기 전의 값으로 노드 작업을 건너뛰지 않는다.
  모든 구문을 소스 순서로 해설한 뒤 일치하는 인용을 최신 노드 해설로 교체하며 진입 노드에
  이후 반환의 effect를 복사하지 않는다. primary의 값 표는 생략하고 nodeTask에서 검증한다.
  이전 nodeTask는 최대 3개 target과 원래 narrative 응답을 유지한다. source-owned 모든 방문을 설명한 뒤
  entry/exit를 모델 목적/결과 문장으로 보완한다. partial frontier에 반환 설명을 합성하지 않는다.
- Session은 완료 페이지를 디스크에 저장하고 미완료 한 페이지의 primary/node chunk만
  보존하여 취소·실패 후 완료된 추론을 다시 하지 않는다. node→page index와 browser의 8개
  selected-node cache는 전체 prose를 메모리에 쌓지 않는다. Compound renderer는 root public
  ID와 canvas ID를 기존 identity adapter로 양방향 연결하고 다른 함수의 노드를 root 요청에
  섞지 않는다. 선택 변경이 없는 playback/focus 알림은 노드 읽기 DOM을 다시 만들지 않는다.

#### `storage/localModels` 및 `vscode/functionNarrativeSetup`

- construction과 activation은 모델 I/O·다운로드·추론을 시작하지 않는다. preinstalled runner가
  유효할 때만 모델을 준비한다. 기존 machine `localModel` 파일은 재사용하고 빈/없는 경로는
  extension-global 저장소의 pinned Qwen3.5-4B Q4_K_M을 사용한다. 설정을 자동으로 덮어쓰지 않는다.
- public `createManagedLocalModelCache`와 `DEFAULT_FUNCTION_NARRATIVE_MODEL`은 framework-free
  `ManagedLocalModelCache` port를 구현한다. 기본 원본 revision, 2,740,937,888 byte 크기 및
  SHA-256은 확장 소유 상수다. 브라우저와 workspace는 다운로드 URL·파일 경로를 선택하지 못한다.
- HTTPS redirect 최대 8회, socket idle 60초, bounded streaming과 native progress를 사용한다.
  SHA-256이 맞는 파일만 atomic rename한다. 네트워크/취소 partial은 유지하며 explicit retry는
  validated Range로 이어받는다. Range 미지원은 재시작하고 checksum/oversize 실패는 폐기한다.
- 파일은 0600, 디렉터리는 0700으로 만들며 다운로드 lease로 창 사이 중복 전송을 방지한다.
  죽은 PID의 lease는 복구한다. 신호·native Cancel·Guide Cancel·extension disposal로 중단한다.
  큰 파일은 메모리에 누적하지 않는다. 완료 파일의 size/mtime/ctime/inode identity가 같을 때만
  Host 내 hash 검증 결과를 재사용한다. 모델 파일은 확장 업데이트에 걸쳐 유지된다.
- `prepare`는 한 explicit run의 provider를 고정한다. 준비 완료 후에만 inference deadline을
  시작하고 cached paging/완료 session 재조회는 prepare를 호출하지 않는다. download-failed는
  localized retry 안내이며 완료된 시나리오와 재개 가능한 session을 보존한다.

#### `shared/functionScenarios`

- public `createFunctionExecutionScenarioModeler`와 schema 1 계약으로 기존 Workspace
  경로를 입력·조건·순서 있는 호출/효과/쓰기·종료·가정·gap으로 정리
- source route와 계산값은 분리하고 실제 관찰 여부는 항상 `static`; 업무 목적이나
  외부 서비스의 성공을 추측하지 않음
- entry부터 ordered edge/occurrence를 검증하며 deferred/defines, missing block,
  연결되지 않은 suffix, terminal 이후 방문을 successful return으로 취급하지 않음
- loop 선택과 쓰기는 occurrence마다 보존; 조건 계산 작업 뒤에 분기 선택을 기록하고
  member before/after는 receiver가 아닌 구체적인 field target으로 표시
- `checked`와 `assumed`를 구분하며 `symbolic-only`는 stale concrete/value/checked
  metadata보다 우선; coverage는 표시 생략과 무관한 checked source choices만 집계하고
  `exhaustive: false` 유지
- scenario 48, route depth 300, steps 80(default)/120(max), representatives 5,
  input/condition/gap/assumption/evidence 표시 16/12/16/8/8로 제한
- 값 snapshot은 방문 96, 깊이 6, container 16, 문자열/key 240자로 제한하고 alias를
  복사; cycle/accessor/internal brand/sparse array/긴 key는 안전한 unknown/gap 처리
- Workspace `readModels()`에서 `resultRevision`별 catalog를 생성하고 Summary와 Values가
  같은 객체를 사용; idle mount/선택/재생/locale 변경은 재계산하지 않고 root disposal에서 해제
- 동일한 순수 구현을 browser에 한 번 emit하며 상세 계약·제약은 모듈 README에 기록

#### `analyzer/rust`

- Rust engine의 primary graph evidence 유지
- Rust가 file node만 제공하는 Java/Kotlin/F#/OCaml/Elixir 파일에 한해 in-process symbol/call graph를 병합
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
- `코드 이해`, `값과 경로`, `함수 정보`의 세 tab으로 selected block evidence,
  Scenario/값 도구, signature/direct callee를 구분한다. panel DOM은 유지하며 tab 전환은
  입력값, branch choice, graph selection, Host state를 바꾸거나 계산을 시작하지 않는다.
- 1040px 이상에서 기본 open, 좁은 화면에서는 명시적 `상세 보기`로 열고 840px 미만에서는
  graph 아래로 쌓는다. root/session별 open-state, tab, tab별 scroll position을 보존한다.
- direct graph/목차 selection은 `코드 이해`로, Guide의 input handoff는 `값과 경로`로 연다.
  Values를 떠나면 재생과 해당 scenario consumer를 일시정지하며 복귀는 자동 재개하지 않는다.
- keyboard toggle/close, Escape dismissal, `aria-expanded`/`aria-hidden`, closed-state `inert`
- analyzer, protocol, VS Code API에 의존하지 않는 browser-only public composition surface

#### `webview/codeFlow/reading`

- public `createFunctionReadingOutline`, `getFunctionReadingBrowserSource`,
  `getFunctionReadingStyles`로 source-order model과 DOM/CSS composition을 제공한다.
- 전달된 function별 source emission 순서에서 실제 graph node가 있는 unique block만
  최대 400개 보존한다. 순번, kind, depth, source line, confidence, child function label을
  표시하고 초과 개수를 명시한다. layout rank를 runtime 실행 순서로 해석하지 않는다.
- 전체/분기/호출/종료 필터와 이전/다음 탐색은 목차에만 적용한다. 분기는 condition/loop/
  switch/try, 호출은 call/effect/render/event 또는 concrete drill target을 가진 block,
  종료는 return/throw/exit다. count는 표시된 block 수이며 runtime path 수가 아니다.
- 목차를 선택하면 공용 comprehension selection, Inspector, viewport reveal API를 사용한다.
  branch/입력값/소스 실행/Host message는 자동 변경하지 않으며 raw analyzer identity도 해석하지 않는다.
- desktop에서는 graph 왼쪽, 1040px 미만에서는 기본 접힌 위쪽 목록으로 제공한다.
  list는 독립 scroll, roving tab stop, Arrow/Home/End, no-match 상태를 제공한다.
  locale refresh는 기존 버튼과 selection/filter/focus를 보존한다.
- 초기 선택은 entry block이며, 중복되던 5행 Static Flow Ledger를 이 목차로 대체한다.
  기호 안내는 native details로 필요할 때 펼친다.

#### `analyzer/frameworkBehavior`와 `webview/codeFlow/understanding`

- `analyzeFunctionFrameworkBehavior`는 제공된 source, callable range, framework metadata만
  사용한다. React는 TypeScript syntax, Django는 Lezer syntax adapter로 분리하며 source를
  실행하거나 파일을 직접 읽지 않는다. import alias, local/enclosing shadow, nested body를 구분한다.
- React는 import 소유 Hook API와 JSX/event 표현식을 분석한다. React import가 없는 JSX는
  해당 package root의 React detection이 있어야 추론한다. application이 engine의 상대 root를
  workspace 기준 절대 경로로 바꾼다. render, effect/cleanup, event 시점을 source order와 구분한다.
- Django는 import 소유 decorator/response/transaction API와 model unit에 연결된 ORM receiver를
  분석한다. 표준 Manager/QuerySet의 구성/평가/쓰기 규칙을 inferred fact로 제공한다. 재할당된
  query alias나 무관한 receiver는 분류하지 않는다. view convention은 HTTP dispatch method와
  helper를 구분하며 실제 URL 등록/요청/SQL 실행을 확정하지 않는다.
- syntax 순회는 visited set과 depth(기본 40, 최대 100), 30,000 node 제한을 사용한다.
  source 상한은 1,000,000 UTF-16 code unit, fact는 기본 16/최대 24개다. fact 생략 수와
  제한 여부를 payload에 보존한다. 300자 caption은 전체 소스를 대체하지 않으며 source action으로 연다.
- `projectFrameworkBehavior`는 raw range/file path를 제거하고 기존 evidence registry token과
  가능한 가장 작은 containing block의 opaque ID로 투영한다. Tutor payload의 optional field이며
  새 Webview request를 만들지 않는다. fingerprint에 framework 결과를 포함한다.
- `createFunctionUnderstandingModel`은 root program ID mapping, 표시 layout ID, 중복 및
  nested callable/embedded body를 확인한다. parent 순회는 visited와 configurable 최대 depth를
  사용한다. Django write fact는 같은 block의 외부 효과 count로 합쳐 중복을 제거한다.
- native button/details로 읽기와 설명을 제공한다. framework fact 목록은 높이 300px 안에서
  scroll하며 session 16개까지 disclosure state를 유지한다. 560px 이하에서는 reading action을
  세로 배치한다. 최초 viewport는 entry node를 보이게 하되 저장된 camera는 보존한다.
- 지원 계약, 비지원 범위와 검증 결과는 `docs/FRAMEWORK_BEHAVIOR.md`에 기록한다.

#### `webview/codeFlow/valuePreview`

- parameter/local/constant 및 user-added `CUSTOM` variable용 integrated Inspector bounded
  `Name`/`Scenario input` editor
- Inspector의 `값과 경로` tab 첫 부분에 배치하고 intrinsic row height를 보존하며, tracked/manual
  row 목록만 내부 scroll시켜 선택 block evidence의 크기와 무관하게 editor를 보이게 하는 layout contract
- analyzer binding이 없어도 lexical identifier와 초기값을 직접 추가하고, 이후 동일 이름의
  단일 analyzer binding이 나타나면 session value를 실제 binding으로 승격하는 fallback contract
- root/session별 입력 annotation과 graph/selection access label 동기화
- `Name` button과 공용 value-flow selection callback을 통한 label/node/edge highlight 동기화
- JSON/scalar input과 safe expression grammar를 분리한 browser-source 내부 모듈 및 이를 조합하는
  public Scenario evaluator surface
- token/operator/value stack 기반 arithmetic/comparison/boolean/nested ternary 계산과 own-data member read
- 반복형 CFG worklist, immutable binding state, merge lattice, cycle/safety bound를 사용한 branch-aware 전파
- program bundle의 실제 bounded occurrence 순서를 보존하는 80-frame Scenario-backed value progression
  (legacy CFG snapshot만 graph rank fallback 사용): explicit binding
  selection은 definition block의 `START name = value`에서 시작하고 entered input,
  source-derived state, 또는 explicit unknown을 표시한다. `initialize`/assign/update/
  increment/delete 및 unsupported write/readwrite는 `before → after`와
  exact/inferred/unknown text를 보존하는 change frame이며 최초 define/override는 START다.
  frames는 possible static flow일 뿐 runtime path가 아니며 기존 lexical hop이 있는 경우에만
  traveler/curve를 사용하며 token은 직선 보간이 아니라 기존 SVG path geometry를 sampling한다;
  derived/write frame은 새 semantic edge를 만들지 않는다.
- call/constructor/getter/source mutation/Host message/branch 자동 선택이 없는 browser-only 경계;
  input/branch/session 변경은 pending playback timer와 transient change effect를 취소하고
  START로 reset하며 graph selection, pan/zoom, source navigation, Inspector 상태는 변경하지 않음
- 그래프 render/선택은 START ready 상태에서 scheduler 없이 정지한다. Play/Replay만 진행을
  시작하며 transition은 하나의 취소 가능한 handle과 path당 lazy 32-point SVG cache를 사용한다.
  pause/reset/deselect/branch/session/graph disposal/document hidden은 즉시 취소하고 hidden 상태는
  명시적 Play 전까지 재개하지 않는다. exact path가 없거나 offscreen/disconnected/reduced-motion이면
  geometry work 없이 discrete arrival을 보존한다. 모든 Project Analyzer 소유 runtime/Webview surface는
  `projectAnalyzer.uiLanguage` Setting(`auto`/`ko`/`en`)을 사용한다. explicit 값이
  우선하고 auto/missing/invalid는 VS Code display language의 `ko`/`ko-*`만 한국어, 나머지는 영어로
  resolve한다. Host ready handshake와 exact-setting live update는 표면의 title/guide/control/status/ARIA/
  confidence/lang을 graph rebuild나 scheduler/geometry work 없이 in-place 변경하며 identifier와 carried value는
  source text를 유지한다. 해결된 sidebar Webview 보기 제목과 소유 editor-panel 제목은 즉시
  변경되는 예외다. Activity Bar 컨테이너, command/menu, Settings UI, extension label은
  immutable manifest/package-NLS contribution이므로 VS Code 표시 언어를 바꾸고 다시
  로드한 뒤에만 바뀌며, sidebar가 resolve되기 전에는 package-NLS 보기 이름을 fallback으로 쓴다.

#### `webview/codeFlow/typography`

- VS Code UI/editor font family와 font size에서 파생되는 Function Logic typography token
- sidebar 공유 graph와 전용 Function Visualizer가 사용하는 단일 public style surface

#### `webview/codePresentation`

- Function Visualizer와 Module Flow의 function-logic card가 공유하는 언어 중립 source token vocabulary
- 원문 문자와 줄바꿈을 1:1로 재구성할 수 있는 반복형 tokenizer와 인접 token 병합
- VS Code symbol/editor theme variable을 사용하는 token style과 `textContent` 전용 browser mount helper
- analyzer, application, protocol, VS Code API 및 dynamic code execution에 의존하지 않는 Webview 경계

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
- native analyzer stdout은 JSON parse를 위해 완전하게 보존하되 chunk마다 로그를 남기지 않고,
  process close에서 byte/chunk 수를 한 번만 기록한다. stderr는 전체 byte/chunk 수와 최대 8KiB
  preview만 유지하여 반복 경고와 무제한 진단 buffer를 만들지 않는다.
- compatibility Graph Panel을 사용하는 경로도 mode별 projection을 Host에서 먼저 수행하고
  `projectAnalyzer.maxRenderedNodes`(절대 최대 2,000)까지만 Webview로 보낸다. source/delivered/omitted
  count를 payload metadata로 보존하고, 동일 immutable graph object와 mode는 재전송하지 않는다.
  focus target이 직전 slice에 없을 때만 그 target을 seed로 새 bounded projection을 만든다.
- catalog 기본 노출 수는 최대 24개, 검색 응답은 최대 50개
- flow detail은 기본 depth 3, 최대 30 step
- function logic은 기본 120, 최대 300 statement block
- retained function-logic block의 value-change annotation은 모두 보존하되 runtime value
  propagation은 수행하지 않음
- lexical value flow는 함수당 최대 80개 unambiguous binding, 700 access fact,
  900 definition-to-use relation을 유지하고 추가 fact/relation은 gap count로 보고
- 선택 binding의 visual value routing은 최대 1,500 nearest-use quadratic hop을 유지하며
  predecessor 탐색에 visited set과 최대 depth를 적용
- Value playback uses only visible exact lexical SVG hops. Each hop caches bounded
  point samples and a distance-derived 1.4–2.8 second cadence before animation;
  missing, hidden, or dimmed geometry arrives discretely without synthesizing an
  edge. A foreground token and source-backed `before/input → operation → result`
  plaque sit above graph nodes. An armed pass follows through the viewport's
  central half by translation only, and any direct pan, zoom, Center, or Fit
  cancels that pass's follow without changing playback. Reduced motion keeps the
  same textual ordering, confidence, START/Δ/sink semantics, and controls.
- graph node의 lexical access row는 최대 8개만 렌더링하고 정확한 추가 row 수와 전체 retained
  binding selector를 별도로 제공
- scenario value editor는 최대 120 binding/입력당 1,200자이며 graph label은 240자 이내로
  줄인다. 선택 progression은 최대 80 access step으로 제한
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
- semantic definition-to-use relation의 declaration/use/sink hop 변환, branch arm 분리와 join,
  cycle/depth/hop limit, pruned-control fallback, quadratic SVG path 검증
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
  `DEFINED`/`CONSUME`/`SINK`/write-unknown progression, branch dim, 입력 1,200자/label 240자/120행/80-step bound,
  Host message/평가/branch 선택 부재 검증
- PARAM/LOCAL/CONST selector, bounded access row, 선택 binding SVG overlay, branch-choice dimming,
  attached function scope별 binding/value-flow identity 격리 검증
- 180자를 넘는 statement, 긴 value/target, 긴 child-function/resume label도 ellipsis 없이
  렌더링하고 내용 기반 node height가 증가하는지 검증
- multiline TypeScript/JSX/Python/Java/functional source의 줄바꿈 보존, token 원문 재구성,
  Function Visualizer/Module Flow 공통 syntax color class, hostile-looking source의 textContent 전용 mount 검증
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

## 18. Bounded Scenario Call Interpretation

Values Scenario can additionally interpret a Host-issued, JSON-only bundle of
synchronous TypeScript/JavaScript free-function programs. Calls are joined only
through opaque call IDs; the Webview receives no source text, file path, range,
graph identity, or name-based resolver. Evaluation uses typed define/assign/
return evidence rather than block labels or display statements, and recomputes
from fresh input state without messaging the Host.

The interpreter is bounded to call depth 4, 12 bundled programs, 360 blocks,
96 KiB payload, 600 expression items, 1,200 work items, and three visits per
loop block. Dynamic/ambiguous/unresolved calls, cycles, async/generator bodies,
effects, unsupported expressions, and budget exhaustion remain unknown with a
finite localized boundary reason; they are never executed or guessed.

The program machine records immutable before/after environments for each root
block occurrence. The Values trace and playback project those occurrences through
the existing exact identity adapter; layout rank must not reorder repeated visits.
Compound assignment captures the left value before the right expression and
uses the declared operator. Known own-data writes propagate across aliases,
nested containers, live expression references and caller argument environments.
Return/decision expressions finish before their block snapshot is recorded.

Object/array expressions preserve all supported members, including shorthand and
derived values. Unknown children, spreads, accessors, sparse source literals,
unresolved dynamic member reads and truncated containers cannot become complete
known data. Primitive loose equality follows coercion; object-to-primitive
conversion remains unsupported. The display preserves nested undefined, NaN,
infinities and negative zero instead of serializing them to null or omitting them.

Reference propagation uses iterative worklists with cycle guards: 64 invocation
environments, data depth 16, at most 64 own fields/items, 512 conversion frames and
1,024 alias-rewrite frames. Unsupported effects and failed writes conservatively
invalidate current state and the final exact-result claim, preserving the earlier
verified prefix. See [value inference](docs/VALUE_INFERENCE.md) for scope and QA.

## 19. Open Questions

- 최종 제품명에서 `Analyzer`를 유지할지 `Flow` 중심 이름으로 바꿀지
- decision/effect stage를 어느 수준의 evidence부터 자동 부여할지
- source callsite token을 definition token과 별도로 도입할지
- Python/Java import와 build metadata를 어느 수준까지 읽어 cross-file call confidence를
  높일지
- saved flow를 workspace 파일로 저장할지 extension storage에 저장할지
- editor canvas의 기본 grouping을 architecture layer와 source package 중 무엇으로 할지
- runtime observation adapter를 core 제품에 포함할지 별도 plugin으로 둘지
