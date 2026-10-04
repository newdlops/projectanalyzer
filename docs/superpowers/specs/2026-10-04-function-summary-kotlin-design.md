# 함수 행동 요약과 Kotlin 흐름 분석 설계

이 문서는 함수의 역할과 조건별 행동을 빠르게 읽고, 같은 근거를 그래프와 소스에서 확인하기 위한 설계다. Kotlin 구문 분석, 언어 공통 요약, 기존 Scenario Workspace 연동의 책임과 첫 지원 범위를 정의한다.

- 작성일: 2026-10-04
- 사용자 요청: 함수 흐름을 더 잘 파악할 수 있어야 하며, Kotlin 지원과 함수 기능·시나리오 Summary가 필요하다.
- 합의한 방향: 함수 요약 → 대표 시나리오 → 그래프·소스 근거. 기존 계산·캐시·지연 활성화 구조를 유지한다.
- 문서 상태: 채팅에서 합의한 방향을 구체화한 설계. 이 문서의 상세 범위 검토가 끝나면 구현 계획을 작성한다.
- 첫 대상: 일반 Kotlin 함수·클래스. Spring/Ktor/Android/Compose 전용 동작 해석은 이후 확장한다.

## 1. 사용자 경험과 성공 기준

선택한 함수에 대해 다음 질문에 순서대로 답한다.

1. 이 함수는 어디에서 사용되며 무엇을 처리하는가?
2. 어떤 입력과 조건이 행동을 바꾸는가?
3. 각 경로에서 어떤 호출·값 변경이 생기고 어떻게 종료하는가?
4. 이 설명의 근거는 어느 그래프 블록과 소스인가?

Function Guide의 기존 At a Glance 위치를 행동 Summary로 보강한다. 함수 서명과 기존 Inspector, 다섯 질문, 상세 Scenario Workspace는 유지한다. 요약에 근거가 없으면 그 한계를 직접 표시한다. 노드·분기 개수는 보조 정보로 접는다.

대표 시나리오는 처음에 최대 3개를 보여주고 펼치면 최대 5개를 보여준다. 계산된 다른 시나리오에는 기존 상세 표를 통해 접근한다. 이 숫자는 읽기 위한 표시 상한이며 모든 실행 경로를 분석했다는 의미가 아니다.

성공 기준은 Summary만 읽어도 입력, 주요 처리, 조건별 종료와 파악하지 못한 부분을 구분할 수 있고, 한 번의 명시적 선택으로 관련 그래프 또는 소스로 이동할 수 있는 것이다. 실제 코드 실행이나 이름만 보고 추측한 업무 설명을 제공하지 않는다.

## 2. 현재 구조와 선택한 접근

현재 구조에서 재사용할 부분:

- Function Logic의 블록·분기·호출·값 변경·종료 및 source range
- Function Tutor의 선언·입력 후보·소스 문서·호출 맥락·근거 토큰
- Guide와 Values가 공유하는 root/fingerprint 단위 Scenario Workspace
- 기존 그래프 강조, Show on Graph, Open Source, 입력 전달 및 단일 playback scheduler
- 한국어·영어 presentation descriptor와 VS Code 테마 토큰

현재 Kotlin은 Rust 파일 탐색기의 언어 식별 목록에 있으나 file-only 언어다. Extension의 기본 include glob, source language 추론, 언어 analyzer 등록, 함수 cursor resolver, Function Logic 및 Tutor에는 전용 지원이 없다. 파일 확장자만 추가해서는 함수 흐름을 분석할 수 없다.

기존 Guide의 문구와 배치만 바꾸면 빠르게 개선할 수 있지만 Kotlin 근거와 공통 행동 설명을 만들 수 없다. 따라서 언어 공통 행동 요약 모델을 추가하고 Kotlin 전용 구문 어댑터를 기존 분석 경계에 연결한다. 별도의 시나리오 엔진이나 그래프 저장소는 만들지 않는다.

## 3. 기능 범위

### 3.1 언어 공통 행동 Summary

기존에 Function Logic을 지원하는 언어와 Kotlin이 같은 Summary 계약을 사용한다. 분석 데이터가 적은 언어는 partial로 표시하며 지원 수준을 임의로 높이지 않는다.

| 영역 | 표시 내용 | 근거와 제한 |
| --- | --- | --- |
| 역할 | 소스 문서의 설명 또는 입력·호출·반환을 조합한 짧은 구조 설명 | 소스 문서와 구조 설명의 출처를 구분한다. 함수명만으로 업무 목적을 단정하지 않는다. |
| 호출 맥락 | 소유 클래스·모듈, 확인된 caller·entrypoint | 기존 bounded context를 사용한다. 없는 관계를 새로 추측하지 않는다. |
| 입력·결과 | 입력 이름·타입·기본값, 소스가 확인한 반환·예외 형태 | 구체적으로 계산한 값과 소스 표현식을 구분한다. |
| 흐름 개요 | 최대 5개 핵심 단계와 조건·반복 표시 | 분기를 포함한 모든 블록을 하나의 실행 순서처럼 나열하지 않는다. |
| 영향 | 확인한 호출·쓰기·외부 경계 | `repository.save` 호출을 확인했다는 사실과 DB 저장 성공은 다르다. |
| 파악하지 못한 부분 | 미지원 식, 외부 호출, 동적 dispatch, 분석 상한 | 누락을 성공 경로나 concrete 결과로 대체하지 않는다. |

호스트의 Summary planner는 entry에서 도달하는 현재 실행 scope의 블록을 bounded iterative traversal로 추린다. `defines`/`deferred` 내부를 현재 실행 단계로 섞지 않는다. 반복 횟수, 상호 배타적인 분기, finally 구간은 각각의 구조를 유지한다. 원래 코드 위치와 block/edge identity를 근거로 보존한다.

### 3.2 대표 시나리오 Summary

기존 Workspace가 만든 시나리오를 읽어서 다음 형태로 요약한다.

`입력·조건 → 주요 호출·값 변경 → 반환/예외/미확인 종료 → 근거·가정`

첫 화면에서 자동 계산을 시작하지 않는다. 사용자가 시나리오를 열면 Workspace의 단일 consumer로 계산하고, 이미 계산된 결과가 있으면 재사용한다. Summary와 상세 표의 선택은 동일한 seed ID/path index를 사용한다.

대표 선택은 계산 상태와 명시적 불확실성을 보존하면서 서로 다른 종료 종류, 호출·쓰기 조합, 분기 선택을 우선한다. 같은 경로라도 계산된 반환값이나 가정이 다르면 하나로 덮어쓰지 않는다. 생략한 표시 건수와 분석 제한을 구분한다.

`정상`, `실패`, `저장 성공` 같은 업무 이름은 소스 근거가 있는 경우에만 사용한다. 그 외에는 `조건 충족 시 반환`, `호출 후 반환`, `예외 발생 경로`처럼 확인 가능한 구조로 이름을 붙인다.

| 상태 | Summary의 의미 |
| --- | --- |
| concrete | 지원되는 bounded evaluator로 해당 입력·경로의 값을 계산했다. 외부 실행 결과를 확인한 것은 아니다. |
| symbolic | 코드의 분기 선택과 연결을 요약했다. 입력이 모든 조건을 만족한다거나 그 경로가 실제로 실행됨을 증명하지 않는다. |
| partial | 일부 구간 또는 값만 확인했고 gap·가정을 함께 보여준다. |

Summary 행 선택은 경로 preview와 공유 선택만 바꾼다. 입력 적용, branch choice 확정, playback, 소스 열기는 각각 기존 명시적 버튼으로 수행한다.

### 3.3 Kotlin 첫 지원 범위

| 분야 | 첫 지원 | 제한 |
| --- | --- | --- |
| 파일 | `.kt`, `.kts`, dirty editor source | `.kts`는 선언 함수가 대상이다. Gradle DSL의 실행·receiver 의미는 해석하지 않는다. |
| 선언·선택 | top-level/member/local/extension 함수, block/expression body, class/object/interface 소유 관계 | 중첩 callable의 body를 바깥 함수 실행 경로에 합치지 않는다. |
| 입력·문서 | 명시적 타입, nullable, literal 기본값, vararg, KDoc | nullable은 인자 생략 가능과 구분한다. 타입 추론과 복잡한 기본값은 미확인으로 남긴다. |
| 제어 흐름 | `if/else`, subject가 있거나 없는 `when`, `for/while/do`, `try/catch/finally` | 타입 해석 없이 sealed/enum의 exhaustiveness를 단정하지 않는다. |
| 표현식 흐름 | root `if/when`, `&&/||`, `?.`, `?:`, `?: return`, `?: throw` | initializer, 직접 대입, return, expression body에서 평가 순서를 보장할 수 있는 범위만 확장한다. 복잡한 argument 내부는 gap과 source evidence를 남긴다. |
| 값 흐름 | parameter, `val/var`, 선언·대입·increment의 source-backed read/write | `val`은 reference 재대입 불가를 뜻하며 객체 전체의 불변성으로 해석하지 않는다. |
| 종료·호출 | return/throw/break/continue, 확인 가능한 loop label, lexical direct call | extension overload·virtual dispatch·reflection·Java interop target은 유일한 근거가 없으면 exact로 해석하지 않는다. |
| lambda·비동기 | callable/deferred 경계와 `suspend` 선언 표시 | scope function/inline lambda의 실행·non-local return, coroutine scheduling은 첫 단계의 실행 경로 해석 대상에서 제외한다. |

첫 단계 Kotlin 시나리오는 **symbolic-only**다. 값 계산을 지원하는 것처럼 JavaScript evaluator에 Kotlin 산술·타입·컬렉션을 넣지 않는다. 조건·호출·종료와 소스 literal은 요약할 수 있지만, Kotlin Int 나눗셈·overflow·수신 객체 동작을 계산된 결과로 표시하지 않는다. 값 계산 입력 편집·적용은 지원 상태를 설명하고 비활성화한다. 그래프 경로 preview와 경로 playback은 기존 기능을 사용한다.

lambda 내부의 label return 또는 non-local return을 확인할 수 없는 경우, 바깥 함수의 완료로 연결하지 않는다. 해당 callable 경계와 gap을 남긴다. `suspend`만으로 suspension point나 실제 호출 시점을 단정하지 않는다.

class/object/interface는 함수의 소유 구조와 graph symbol로 지원한다. constructor/init/property accessor를 독립 함수 선택 대상으로 만드는 기능은 첫 단계에서 제외한다.

## 4. Kotlin parser와 수명

Kotlin 공식 ANTLR grammar의 고정된 snapshot에서 TypeScript parser를 생성하여 Extension Host에서 사용한다. Java 문법으로 Kotlin을 대체하거나 정규식만으로 중괄호·분기·문자열을 분리하지 않는다. 공식 grammar는 lexer, Unicode identifier, parser 규칙을 제공하고, ANTLR는 TypeScript 출력과 Node runtime을 지원한다. [Kotlin grammar](https://kotlinlang.org/grammar/), [ANTLR TypeScript target](https://github.com/antlr/antlr4/blob/master/doc/typescript-target.md)

선택 이유는 기존 동기 cursor resolver와 AST 기반 어댑터 계약을 유지하면서 별도 JVM 언어 서버와 native binary 없이 구문 근거를 제공할 수 있기 때문이다. 새로운 ANTLR runtime과 생성 파일이 필요하다. parser는 Kotlin이 필요할 때 처음 로드한다. grammar 생성에 필요한 도구는 개발·재생성 단계에만 사용하고 설치된 Extension은 생성 결과를 사용한다.

grammar revision, generator/runtime의 동일한 고정 버전, 생성 명령, 원본 license를 기록한다. 최신 문법 전체 지원을 자동으로 주장하지 않는다. 고정 grammar가 인식하지 못한 구문은 parse diagnostic과 partial/unavailable 상태로 표시한다. 일반 compile·패키징 과정에서 grammar를 내려받거나 재생성하지 않는다.

공유 `KotlinSyntaxSnapshot`에는 source fingerprint, parse tree, 선언 인덱스, line position index, parser diagnostics를 둔다. graph analyzer, cursor resolver, Function Logic, Kotlin Tutor는 같은 내용에 같은 snapshot을 사용한다. parser context 타입은 Kotlin 모듈 밖으로 노출하지 않는다.

| 상한 | 값·처리 |
| --- | --- |
| 파일 크기 | 기존 `maxFileSizeKb`를 존중한다. |
| Kotlin lexing | 파일당 최대 100,000 tokens, token 기준 괄호 nesting 128. 초과 시 parser 실행 전에 제한을 표시한다. |
| syntax cache | 최대 8파일, source text 합계 최대 2 MiB. 현재 editor/root 파일을 우선 유지하고 LRU로 퇴출한다. 이 수치는 AST heap 크기의 보장이 아니다. |
| Function Logic | 기존 기본 120/최대 300 block 상한을 유지한다. |
| Snapshot invalidation | 정규화한 path, content hash, grammar revision, parse entry `.kt/.kts`를 key로 사용한다. 변경·삭제·workspace 교체·dispose 시 퇴출한다. |

자체 tree/graph traversal은 stack·queue·visited set과 전달 가능한 depth 상한으로 구현한다. 생성 parser의 내부 구문 호출은 외부 parser 책임이며, 자체 재귀 visitor/listener walker는 사용하지 않는다. 토큰 상한과 nesting guard, syntax error·parser failure fixture로 중단을 검증한다.

UTF-16 VS Code source range 변환을 명시적으로 처리한다. 한글·emoji·CRLF·multiline string·주석을 포함한 cursor/range fixture가 같은 선언과 근거 위치를 가리켜야 한다.

## 5. 모듈과 데이터 흐름

```text
Source / dirty editor
  → KotlinSyntaxSnapshot
  → Kotlin graph analyzer / cursor resolver / Function Logic / Tutor adapter
  → 기존 graph·declaration·context + Behavior Summary planner
  → 기존 opaque ID·evidence token projection
  → Function Guide Summary
  → 사용자 활성화 시 기존 Scenario Workspace
  → 대표 시나리오 Summary / 기존 Values 상세 / 그래프 preview
```

| 책임 | 위치·public API |
| --- | --- |
| Kotlin 구문·캐시·선언 facts | `src/analyzer/languages/kotlin/`: `KotlinAnalyzer`, snapshot provider, immutable 선언·호출 facts. 생성 parser는 internal. |
| Kotlin 함수 graph | `src/analyzer/functionLogic/languages/kotlin/`: analyzer와 cursor resolver. 공통 `FunctionLogicAnalysis`를 반환한다. |
| Kotlin Tutor declaration | `src/analyzer/functionTutor/languages/kotlin/`: parameter/KDoc/gap와 symbolic-only program. TypeScript AST 또는 non-TS header regex에 의존하지 않는다. |
| 언어 공통 행동 요약 | `src/application/codeFlow/functionTutor/behaviorSummary/`: `buildFunctionBehaviorSummary`; 소스 facts와 공통 모델만 사용한다. |
| 표시용 계약·검증 | `src/protocol/functionLogic.ts`, `functionTutor.ts`, 기존 projection·message validation 경계. raw path/range를 opaque evidence로 변환한다. |
| 행동·시나리오 요약 UI | `src/webview/codeFlow/tutor/summary/`: bounded Summary renderer, 대표 행 projection, styles. 기존 Guide와 Workspace callbacks를 사용한다. |

Kotlin이 Rust의 file-only 경로에 머무는 동안 기존 Java/functional 언어와 같은 supplemental graph merge를 사용한다. Kotlin을 기본 include glob, source language inference, Extension analyzer 등록, supplemental 언어 목록, Function Logic/cursor dispatcher와 language union에 연결한다. Rust에서 Kotlin symbol extraction을 따로 중복 구현하지 않는다.

기존 `functionLogicBrowserSource.ts` 등 800줄에 가까운 entrypoint에는 작은 composition hook만 추가한다. Summary 계획·렌더링을 그 파일로 밀어 넣지 않는다. 다른 기능은 Kotlin의 internal parser 파일을 깊게 참조하지 않고 Kotlin public surface를 사용한다.

## 6. 공통 모델·protocol 계약

Behavior Summary의 semantic model은 다음을 포함한다.

- `status`: ready / partial / unavailable
- `purpose`: documentation 또는 structure 출처, source literal 또는 finite presentation descriptor, certainty와 evidence
- `inputs`, `outcomes`, `steps`, `impacts`: 각 항목의 stable ID, 의미·조건·scope, block/edge reference, certainty와 evidence
- `gaps`, `omittedCounts`, `limited`: 표시 생략과 분석 제한을 별도로 기록

표시용 배열은 inputs/outcomes/impacts/gaps 각각 최대 8개, steps 최대 5개로 제한한다. 항목당 block/edge reference는 각각 최대 24개, evidence token은 최대 8개다. purpose preview는 최대 480자, 항목 source preview는 최대 240자로 제한하고 원문은 Open Source로 확인한다. 이 상한 때문에 생략한 항목은 omittedCounts에 기록하며 소스 분석 실패와 구분한다.

Summary status는 현재 실행 scope에 대한 사실이 없으면 unavailable, 사실이 있으면서 관련 분석 gap이나 미확인 실행 경계가 있으면 partial, 요청한 구조 설명을 관련 gap 없이 만들 수 있으면 ready다. 소스 문서 부재 자체는 구조 설명이 가능할 때 오류가 아니다. 문서의 exact는 내용을 그대로 추출했다는 의미이며 작성자의 업무 설명이 실행 결과와 일치함을 검증했다는 뜻은 아니다.

protocol에서는 `FunctionTutorPayload.behaviorSummary`를 optional로 추가한다. 구형 payload는 기존 At a Glance를 표시한다. 추가 정보가 없는 언어를 오류로 처리하지 않는다. 기존 Tutor version 2/3의 필수 필드를 바꾸지 않는다.

`FunctionTutorProgramPayload.evaluationMode`도 optional로 추가한다. 기존 payload의 기본 동작은 유지하며 Kotlin은 `symbolic-only`를 명시한다. 이 mode에서는 concrete evaluator를 호출하지 않고 공통 symbolic planner를 사용한다. 새 field와 Kotlin language 값은 projection round-trip 및 runtime validation에서 확인한다.

호스트는 의미와 근거를 계획하고 Webview는 finite localization key를 렌더링한다. 사용자 소스 문서·이름·표현식은 literal로 보존한다. 화면에서 영어 문장을 다시 분석하여 그래프 의미나 cache key를 만들지 않는다. 모든 reference는 활성 snapshot의 opaque identity에 속해야 한다.

## 7. Scenario Workspace와 성능 계약

Summary를 위해 두 번째 입력 후보 생성, 전체 graph 탐색, interpreter, timer 또는 playback scheduler를 만들지 않는다. host Summary 계획은 이미 얻은 Function Logic·Tutor·context의 bounded facts를 사용하며 caller/source를 추가로 읽지 않는다.

필요한 기존 symbolic planner 보강은 다음으로 제한한다.

1. 선택한 root/fingerprint에서 symbolic plan을 한 번 만들고 여러 seed가 재사용한다. 각 seed는 이미 확인된 조건을 필터링한다.
2. 조건이 없는 함수도 하나의 straight-line symbolic 시나리오로 읽을 수 있다. 무인자 함수는 empty input tuple을 사용한다.
3. 다른 종료로 이어지는 경로를 하나의 reachability 집합·임의의 마지막 return으로 합치지 않는다. loop는 횟수 미확인과 반복 경계로 표시하고 finally를 보존한다.
4. 기존 최대 5 decision/12 symbolic path/48 표시 row 상한을 유지한다. 탐색 후보는 최대 48 state, route depth 기본 300으로 제한하고 호출 인자로 더 작은 depth를 받을 수 있다. 미탐색 조건과 끊긴 경로는 limited/gap으로 표시한다.

대표 시나리오 projection은 완료 결과 revision이 바뀔 때만 다시 만든다. 단순 선택·focus·locale·playback frame 변경은 symbolic plan 또는 값을 재계산하지 않는다. concrete 결과와 symbolic 결과를 서로 승격하지 않는다.

Guide와 Values는 같은 Workspace의 선택·결과·상태를 읽는다. Summary가 닫혔을 때는 consumer/subscriber를 해제한다. 같은 root relayout은 결과를 유지하고 다른 root나 실패한 root 전환은 이전 결과·DOM·label reference를 폐기한다. 기존 native details shell을 유지해 toggle 재렌더링 루프를 다시 만들지 않는다.

fingerprint는 source/graph identity, 분석 옵션, program/summary schema 및 grammar revision 변화에 대응한다. locale와 viewport는 semantic fingerprint에 넣지 않는다.

## 8. UI·상태·접근성

기존 VS Code foreground/background/border/focus/semantic confidence 토큰, UI/editor font, compact Inspector 간격, native details/table/list와 그래프 색상 의미를 재사용한다. 별도 색상 팔레트·카드 시스템·decorative animation을 추가하지 않는다.

정보 우선순위는 역할과 입력·결과 → 조건을 표시한 흐름 개요 → 대표 시나리오 → 상세 질문·근거·분석 제한이다. 주요 조작은 Show on Graph이며 source 열기와 값 적용은 별도 버튼이다. Summary 탐색만으로 그래프 branch/value state를 수정하지 않는다.

| 상태 | 화면 행동 |
| --- | --- |
| 초기/idle | static 행동 Summary와 시나리오 열기 안내. 자동 계산 없음. |
| loading/calculating | polite 상태 텍스트, 관련 영역만 busy 처리. 이전 root의 요약을 보여주지 않음. |
| ready/partial | 계산 종류·confidence·가정·gap을 텍스트로 표시. |
| empty | 확인 가능한 단계나 경로가 없다는 설명과 소스 확인 action. |
| unavailable/error | 미지원 구문·파일 읽기·parser 오류 원인. 기존 source navigation과 재시도 경로 유지. |
| selected/expanded | Guide·Values와 같은 시나리오 선택, 안정된 disclosure와 focus 유지. |
| disabled | Kotlin 값 계산처럼 미지원인 동작에는 설명을 붙여 비활성화. |
| 긴 문서/이름·많은 데이터 | identifier·조건 wrap, bounded preview와 자세히 보기, 분석 제한·표시 생략 건수 구분. |

keyboard selection, visible focus, `aria-expanded`/`aria-controls`, semantic heading/list/table와 text certainty를 유지한다. 새 행 선택과 disclosure를 키보드로 조작할 수 있어야 한다. 390/768/1440px에서 page-level 가로 overflow가 없어야 하며 좁은 Inspector는 기존 표의 세로 표시 규칙을 사용한다. reduced-motion과 forced-colors를 존중한다.

## 9. 검증과 완료 조건

### 기능 검증

- Kotlin fixture: block/expression body, nested/local/extension 함수, multiline signature, nullable/default/vararg, `if/when`, root `?.`/Elvis early exit, loop·label, try/finally, val/var write, KDoc, `.kts` 선언, dirty source.
- Kotlin 제한 fixture: lambda/non-local return, scope functions, suspend call, ambiguous overload/receiver, 미지원 최신 구문, parser error, token/depth/cache budget. 오해 가능한 exact 경로 또는 concrete 결과가 없어야 한다.
- cursor/range fixture: 한글·emoji·CRLF·주석·문자열의 가짜 괄호·분기, 같은 파일의 여러 함수와 중첩 callable 경계.
- graph fixture: cycle·중복 edge·깊이 상한·unresolved callee·finally·조건 없는 함수·무인자 함수. 서로 다른 종료가 한 시나리오로 섞이지 않아야 한다.
- Summary unit test: 기존 TS/JS/Python/Java/functional facts, documentation/structure 출처, conditional 단계, literal 결과와 계산 결과 구분, 누락·gap·표시 상한, 대표 선택과 stable reference.
- protocol test: Kotlin language, optional Summary/evaluationMode round-trip, legacy payload, 잘못된 reference와 malformed input 검증.
- Workspace test: Guide/Values 공유 선택, 열린 상태에서 root 교체·오류·복구, locale/relayout 유지, subscriber 해제, input/playback의 기존 동작.

### 성능 검증

- Kotlin을 사용하지 않는 세션에서는 Kotlin parser 초기화 0회.
- 같은 snapshot key가 cache에 유지되는 동안 graph/cursor/logic/tutor 분석은 1회 parse를 공유한다. source/grammar 변경 때 invalidation하며 cache eviction 후 필요한 재분석과 dispose를 확인한다.
- idle Summary는 Scenario 계산 0회. 활성화한 root는 symbolic plan 1회, 동일 seed 결과 재사용. 100회 선택·locale/frame 읽기로 평가 횟수가 증가하지 않는다.
- 앞서 추가한 renderer lifecycle, native disclosure, trace cache 성능 회귀 테스트를 통과한다.
- 대표 Kotlin 파일의 cold parse와 warm 선택, 최대 block Summary, 반복 root 교체의 시간·heap/RSS·retained snapshot을 각각 측정한다. 기존 TS/JS 함수는 현재 renderer 기준선과 전후 수치를 비교한다. Kotlin은 신규 지원이므로 cold/warm 및 반복 사용 수치를 기록한다. 자원 개선을 추정치로 주장하지 않는다.

### 시각·사용자 동작 검증

실제 생성 Webview를 브라우저에서 390×844, 768×1024, 1440×900 크기로 검사한다. Kotlin 함수 열기 → Summary → 시나리오 열기 → 경로 선택 → 그래프 강조 → 소스 action이 핵심 흐름이다. 기존 TS/JS Values 입력·playback도 회귀 확인한다.

초기·dense·long text·partial/disabled·loading/error/recovery 상태, 한국어/영어 전환, keyboard/focus, 좁은 표의 wrap을 기능 검증과 별도로 확인한다. 사용할 수 없는 실제 VS Code 통합이나 process 측정은 한계로 명시한다.

기본 검사 명령은 `npm run check`, `npm run compile`, 관련 compiled unit tests, `npm run engine:test`, `npm run test:package`다. 전체 unit suite의 이전 기준에는 기존 실패 4개가 있으므로 원인과 baseline을 비교하여 새 실패와 분리한다. 구현 후 SPEC.MD와 DESIGN.md의 언어·Guide·Scenario 계약을 함께 갱신한다.

## 10. 이번 범위 밖의 확장

- Kotlin concrete evaluator, JVM compiler/type checker, 전체 stdlib 모델링
- scope function·inline/non-local return의 interprocedural 실행 해석
- constructor/init/property accessor의 독립 함수 선택·시나리오
- coroutine/Flow scheduling, Spring/Ktor lifecycle, Compose recomposition·event dispatch
- Kotlin/Java overload 및 runtime polymorphism의 완전한 해석
- AI 업무 요약 자동 요청, source 실행, 그래프 전체 경로 완전성 증명
- 별도 시나리오 저장소·독립 renderer scheduler·Graph UI 전면 개편

이 확장들은 공통 요약 계약과 Kotlin의 명시적 gap을 통해 나중에 추가할 수 있다. 첫 배포의 완료 기준에 포함하지 않는다.
