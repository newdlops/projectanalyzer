# 코드 스니펫을 읽는 LLM 동작 시나리오

Function Guide의 **전체 시나리오 분석**은 함수 본문과 가까운 문서·상수, 같은 파일에
확인된 직접 helper 코드를 언어 모델에 전달해 목적과 동작 시나리오, 예시 입력·결과값과
각 경로의 노드 해설을 만든다.
Kotlin과 인자 없는 함수도 사용할 수 있다. 숫자 입력을 찾는 기존 로컬 모델과는 별도 기능이다.
일반적인 함수 전체 목적은 로컬 LLM이 작성한다. 전체 구조까지 확인된 단순 반복 함수는
목적도 소스 규칙으로 구성해 모델을 실행하지 않는다. 소스와 입력으로 끝까지 확인한 경로는 기존 정적
분석과 bounded 계산 결과를 연결해 상세 문단·대안·노드 설명을 만든다. 확인하지 못한
구문과 외부 동작은 로컬 LLM 분석을 유지한다. 그래프와 생성에 쓰는 조건·소스 경로는
기존 정적 분석이 제공한다.

## 시나리오 그래프 노트

생성한 시나리오를 선택하거나 **그래프에서 보기**를 누르면 그 경로의 해설을 그래프 옆
노트로 읽는다. 각 노드의 `1.2` 같은 번호 버튼으로 해당 노트에 이동하며 현재 배율을
유지한다. **해설 펼치기**에서 실제 구문의 의미, 그 예시에서의 판단 근거, 값과 흐름의
변화, 모델 예시값과 **소스 열기**를 확인한다. 반복 방문은 같은 노트 안에서 별도로 표시한다.
**그래프 노트**로 숨기면 선택한 소스 노드로 돌아오고, 다시 열어도 모델을 실행하지 않는다.

페이지·선택·UI 언어가 바뀌면 그 시나리오의 저장된 노트를 사용한다. 다른 경로의 해설을
현재 경로의 것으로 표시하지 않으며 원문 수정·graph 교체·context 만료는 권한을 해제한다.
모든 노트에는 LLM 미검증과 생성 언어를 표시하고 예시값을 실제 실행이나 사용자 편집값으로
취급하지 않는다. 모델 준비/생성은 기존의 명시적 분석 버튼을 통해서만 실행한다.

모듈 public surface는 `webview/codeFlow/narrativeNotes`다. `projectNarrativeGraphNotes`
(scenario, visible node layouts, identity resolver)는 현재 경로의 해설만 결합하고 원래 node
index를 보존한다. `layoutNarrativeGraphNotes`는 원본 위치를 수정하지 않는 노트 배치를
계산한다. `getNarrativeGraphNotesBrowserSource`와 `getNarrativeGraphNoteStyles`는 렌더링과
테마를 제공한다. source action은 기존 검증된 Webview protocol을 재사용한다.
한 번에 상세 DOM은 최대 40개이며 viewport 근처 노트만 mount한다. 화면 밖 노트는 번호와
가벼운 anchor를 유지한다. 재귀, 상시 timer/animation, 추가 모델 호출이나 의존성을 추가하지 않는다.

## 함수 호출의 정적 분석과 LLM 해설

**함수 호출**의 정적 호출 관계·순서는 모델 없이 읽는다. **호출 순서**에서 분기와 반복을
선택한 뒤 **이 소스 경로 설명**을 누르면 그 가정의 경로를 설명한다. **호출 관계**에서는
선택한 함수의 **호출 구조 설명**, 연결의 **이 호출부 설명**으로 범위를 좁힌다.
역할, 명시적 인자 전달, 반환과 호출부의 사용, 상태/부수 효과, 도달 조건을 함께 읽고
**호출 위치 / 대상 함수 소스 열기 / 대상 함수 흐름 보기**로 근거와 다음 함수를 확인한다.

Host와 브라우저는 `shared/functionCalls`의 동일한 반복 기반 순서 계산을 사용한다.
정적 대상·분기·반복 방문·confidence·별도 dispatch를 고정하고 모델은 그 의미를 서술한다.
TypeScript/JavaScript, Kotlin, Python parser가 명시적 호출 인자를 읽으며 빈 목록을
확인했을 때의 입력 설명은 정적 문구로 고정한다. 미지원/생략 목록을 인자 없음으로 취급하지
않는다. Kotlin은 nested argument의 postorder, if arm, &&/||, Elvis와 safe-call 조건을
추가로 읽지만 기존 symbolic-only·scope/coroutine/dispatch 한계는 유지한다.

한 요청은 최대 두 호출부/방문, 최대 다섯 원문 스니펫이다. 부모 100줄/4,200자,
각 호출부 12줄/600자, 각 대상 60줄/1,800자로 제한하고 줄 번호·선언 범위를 보존한다.
두 호출보다 큰 묶음은 호출별 해설을 먼저 저장하고 마지막에 전체 흐름을 요약한다.
전체 요약은 최대 여덟 대상의 실제 원문 450자씩과 최대 여덟 이전 모델 해설을 받는다.
이전 모델 해설은 정적 사실로 승격하지 않는다. 생략·잘린 근거는 sourceLimited로 표시한다.
무인 실행, daemon, source 실행, 새 dependency, 기존 모델 context/output 상한 증가는 없다.

취소와 오류 후 완료된 호출을 유지한다. 이어서 생성은 남은 호출 또는 마지막 요약을 처리한다.
한 페이지는 두 호출을 전달하고 renderer는 선택한 호출 하나의 상세를 펼친다. 최대 여덟
최근 결과/페이지를 유지하며 캐시 조회는 준비·추론을 요청하거나 진행 중인 생성을 대체하지
않는다. locale 변경은 생성 언어를 표시하고 기존 설명을 유지한다. 조건/범위가 달라지면
별도의 결과를 사용한다. source snapshot/root/disposal 변경은 작업과 권한을 지운다.

Public API:

- `shared/functionCalls`: `traceFunctionCalls`, `exampleFunctionCallScenarios`와 portable
  route contracts. source expressions를 실행하지 않고 step/cycle bounds를 유지한다.
- `analyzer/functionCalls.readFunctionCallArguments`: parser가 확인한 명시적 인자 텍스트.
  최대 여덟 인자/각 160자이며 미확인은 `undefined`, 확인한 빈 호출은 `[]`다.
- `shared/functionCallNarratives`: task/target/chunk 계약, fixed empty-input wording,
  local JSON schema, 구조·언어 script 검증. 모델 사실성 검증 API는 아니다.
- `application/functionCallNarratives`: `buildFunctionCallNarrativePlan`,
  `buildFunctionCallNarrativeContext`, `buildFunctionCallNarrativePrompt`,
  `parseFunctionCallNarrative`. opaque 요청을 정적 계획과 bounded 원문으로 바꾸고 고정된
  alias 슬롯/입력 문구를 검증한다. 상한에서 끊긴 요약은 마지막 완전한 문장까지 표시한다.
- `FunctionCallsHostDelivery.explain/cancelExplanation/reset`: 최대 32개 정적 컨텍스트와
  여덟 해설 결과의 snapshot lifecycle. 기존 `FunctionNarrativeProvider`의 prepare/generate와
  동일한 로컬 프로세스/모델 준비를 공유한다. 준비는 추론 deadline 전에 실행한다.
- `protocol/functionCallNarratives`: `functionCalls/explain`, `cancelExplanation`,
  `explanationLoaded`; context ID, source token, scope, parser-owned 선택 key/value,
  cache-only page를 사용한다. browser의 원문·파일 경로·임의 graph identity는 거부한다.

모델은 여전히 문장을 잘못 설명하거나 지시 문구를 반복할 수 있다. JSON 구조·정적 대상·
인자·소스 위치 검증은 임의의 런타임 결과나 효과를 입증하지 않는다. Source 관계와
**LLM 추론 · 실제 실행 미검증**을 구분해서 읽는다.

## 사용 및 연결

0.0.1116부터 같은 설치 경로에 `llama-server`가 있는 macOS/Linux에서는 로컬 실행기를
연속 요청 동안 재사용한다. private Unix socket과 임시 인증 key를 사용한다. 0.0.1117의
명시적인 page scope는 비동기 준비·저장 사이에도 재사용한다. 0.0.1118부터는 한 번 누른 전체
함수 분석 요청이 모든 페이지를 마칠 때까지 model scope를 유지하고, 요청 종료 전에 프로세스
정리를 기다린다. 각 추론은 계속 FIFO에 따로 들어가므로 다른 소유자의 작업을 막지 않는다.
scope 밖에서는 대기열이 비면 종료한다. 취소·실패·다른 공급자로 전환·Host 종료도 프로세스를 정리하며, Host가 갑자기
끝나면 watchdog의 parent pipe EOF로 종료한다. model process는 한 FIFO 슬롯만 사용하고
context 8,192·output 2,400 token·모델 CPU thread 2개 상한을 유지한다. 별도 runtime을
다운로드하지 않으며 companion 없음·custom runner·Windows는 기존 CLI 방식으로 실행한다.

템플릿·JSON grammar·prefix cache 요청은 설치본과 같은 commit의
[llama.cpp server API](https://github.com/ggml-org/llama.cpp/blob/b29c606e2/tools/server/README.md)를 따른다.
cache prefix가 같아도 backend batch 방식에 따라 logits의 bit 단위 동일성을 보장하지 않으므로
실제 응답과 기존 Host 검증을 함께 확인한다.

0.0.1118의 `localAcceleration.detectLocalNarrativeAcceleration`은 첫 실제 추론에서 실행기의
`--help`를 5초·128 KiB로 제한해 확인한다. 광고한 옵션이 모두 있을 때만 checkpoint 8개,
최소 간격 64 token, prompt RAM cache 256 MiB를 사용한다. checkpoint 개수와 RAM cache는
별도 한도이며 256 MiB가 모델 전체 메모리 상한이라는 뜻은 아니다. 0.0.1118에서는
target model이 검증하는 `ngram-map-k`(lookup 4·draft 8)를 사용했으나, 0.0.1119에서는
짧은 JSON 응답의 recurrent state 복사 비용을 측정해 광고된 `--spec-type none`으로 끈다.
별도 draft 가중치는 받지 않는다. 기존 모델·sampling·상세 필드·context/output/thread 상한을 유지한다.
오래된 실행기나 probe 실패는 해당 선택 옵션 없이 동작한다.

`application/functionNarratives/primitiveWorksheet.buildPrimitiveWorksheetResponse(context, language)`는
rich 준비·노드 요청의 소스가 완전하고 정확한 primitive 경로일 때만 기존 응답 계약을 즉시
구성한다. Kotlin Int/Boolean/String와 TypeScript/JavaScript number/boolean/string의
작은 지역 대입, 비교, 부정, 덧셈·뺄셈·곱셈·나눗셈·나머지, lowered Elvis와 반환을 다룬다. 입력 후보는
최대 128개, 매개변수 8개, source operation 32개, expression 160자·token 64개로 제한한다.
각 조건이 선택 경로와 일치하는지 확인하고 source 순서의 직전/직후 값, 실제 연산자의 의미,
대입한 계산식과 다음 구문을 만든다. 코드를 실행하거나 외부 결과를 관찰하지 않는다.
0.0.1118–1119의 최종 목적·시나리오 문단·대안 설명은 로컬 LLM이 작성했다. 0.0.1120부터
완전한 소스 trace는 문단·대안도 구성하고, 선택한 로컬 LLM이 함수 전체 목적을 한 번 설명한다.

call/property access, coercion, 0 divisor, Kotlin overflow/Float·Double·interpolation, JS -0, 중첩 scope의 새 선언·shadowing,
loop/exception transfer, inferred/partial/truncated evidence, 긴 식과 알 수 없는 타입은
기존 LLM 요청으로 처리한다. focused worksheet는 이미 저장된 모델의 priorState와도 비교해
다른 값으로 조용히 덮어쓰지 않는다. 기존 JSON·언어·source/route·페이지·cache validation은
그대로 적용하며, source worksheet로도 실제 실행 검증이나 임의의 코드 의미를 보장하지 않는다.
`hasCompletePrimitiveWorksheet(context)`는 완료된 summary 입력·반환값을 동일한 source trace와
비교해 실제 미확인 작업이 없는 summary의 assumptions/limitations만 빈 배열로 고정한다.
반환값 불일치, helper/truncated evidence 또는 지원하지 않는 작업에서는 이 proof를 사용하지 않는다.
완전한 source trace를 독립적으로 읽으므로 `groundingLimited`가 bounded IR fact 선택만을
뜻하는 경우에도 사용할 수 있다. source excerpt의 누락·truncation과 inferred/partial 경로는
계속 거부한다.

0.0.1119의 `getPrimitiveWorksheetAnalysis(context, language)`는 summary의 완료된 code·값을
전체 source trace와 다시 비교한다. 누락된 값이 없고 전부 일치할 때만 기존 **경로를 선택한 이유**와
**상태와 효과**를 concrete 조건 대입·모든 지역 before/after·반환값으로 구성한다.
220자를 넘는 근거는 자르지 않고 모델이 기존 필드를 작성한다. 고정 근거는 출력 grammar에서
반복 생성하지 않지만 현재 summary task의 `sourceVerifiedAnalysis`에도 넣어 최종 문단이
같은 판단과 계산을 읽게 한다. 실제 실행을 관찰한 값은 아니다.
같은 source snapshot·언어의 검증된 함수 목적 요약 240자 하나를 다음 시나리오에서 재사용하고,
초기 준비 문구는 저장하지 않는다. 각 시나리오의 상세 문단·대안은 계속 모델이 새로 작성한다.
기존 노드 구문·동작·근거·효과·인용을 모두 유지하며 화면 배치도 유지한다.

### 0.0.1122 반복 방문과 전체 반복 목적의 소스 증명

같은 loop 노드의 첫 true 결과와 다음 false 결과를 별개 방문으로 읽는다. IR interpreter는
선택 source route의 방문 수를 budget으로 받고 모든 방문·분기·인용·반환을 순서대로 맞춘다.
primitive reader는 loop 경로에서 node identity와 전체 현재 state를 visited key로 사용한다.
정지 cycle, 잘못된 repeat-exit와 선택 route보다 긴 실제 계산은 source proof로 인정하지 않는다.
각 조건에 현재 피연산자를 대입하고 모든 갱신 직전/직후 값과 반환을 보존한다.

Kotlin while/do-while은 parser-owned predicate를 본문 span과 별도로 보존한다.
같은 호출 문구가 본문에도 있으면 그 호출을 predicate로 옮기지 않는다. TS/JS do-while은
첫 본문을 predicate보다 먼저 연결하고 body repeat/continue 및 마지막 nested-control exit은
predicate에 남긴다. lazy iterator는 post-test body를 한 번 다시 열고 depth/cycle 제한을 유지한다.
이 경로는 source 기반 symbolic 범위이며 모든 가능한 런타임 반복 횟수를 열거하지 않는다.

`buildFunctionNarrativeLoopPurpose(originalContext, completedTask, language)`는 전체 graph가
하나의 literal 비교 조건, 하나의 counter 갱신, 같은 counter 반환, 선택적인 입력→지역 변수
초기화뿐일 때 목적도 구성한다. 현재·대안의 complete trace가 모든 graph 구문을 포함하고
모든 node/edge의 source confidence와 target이 맞아야 한다. 추가 분기·작업·반환 계산,
truncated source나 미확인 body는 모델 목적을 유지한다. generic runtime disclaimer 자체와
실제 source 누락은 구분한다. 모델이 조건을 거꾸로 요약하거나 없는 금액/점수 의미를 붙인
실제 사례가 있어, 확인된 단순 recipe는 조건·첫 body timing·반환을 직접 설명한다.

Host-only `sourceFunctionPurpose`는 외부 prompt에서 제거하며 local provider는 이 경우
`소스 분석`/`Source analysis`로 표시하고 모델을 실행하지 않는다. 목적 240자·문단 1,800자·
대안 600자와 기존 node 상세 한도는 유지한다. 더 복잡한 의미는 로컬 모델을 사용한다.
실제 소스 코드를 실행한 관찰은 아니며 source recipe 적용을 모든 함수의 정확도 보장으로
확장하지 않는다.

공개 production-parser 반복 corpus에서 generation/페이지 저장/runner 확인·정리의 최종
관측이다. parser/context 구성은 timer 전에 실행되며 PC 부하에 따라 달라질 수 있다.

| 공개 함수 | 설치된 0.0.1121 | 최종 생성 시간 | 실제 모델 요청 | 반환 / 노드 |
| --- | ---: | ---: | --- | --- |
| TS 객체 while | 58.44초 | 60.11ms | 5 → 0 | 2/2 · 10/10 |
| Kotlin while | 67.90초 | 33.36ms | 7 → 0 | 2/2 · 12/12 |
| TypeScript while | 78.00초 | 29.05ms | 7 → 0 | 2/2 · 12/12 |
| Kotlin do-while | 별도 이전 비교 없음 | 20.94ms | 0 | 2/2 · 14/14 |
| TS do-while | 별도 이전 비교 없음 | 11.53ms | 0 | 2/2 · 14/14 |

최종 반환 10/10, graph node 62/62, syntax/text/reason/effect를 가진 구문 42/42와 5,991자를
보존했다. `do-while` 예시 `amount=1`은 body `1→2`, true 판단, body `2→3`, false 판단,
반환 3을 읽고 `amount=10`은 body `10→11` 후 false 판단과 반환 11을 읽는다.
기존 모델 pipeline은 이 corpus에서 잘못된 값/조건과 소스에 없는 전제를 포함했다.
누락된 model 파일·runner 상태에서도 해당 complete recipe의 두 상세 페이지를 생성하는
검사를 포함한다. 불완전한 경로, 긴/복잡한 반복과 외부 동작의 최적화는 남아 있다.

최종 검증은 관련 unit 87/87, 패키지 검사 15/15를 통과했다. 전체 unit은 1,084개 중
1,080개 통과이며 기존 4개 실패(동적 callsite 인수, nested-object 입력 대표값,
TS/JS private 시나리오 root, Inspector source-reveal 기대 형태)는 그대로 남아 있다.
darwin-arm64 VSIX는 512개 파일, 약 3.64MiB이며 기존 Rust 실행 파일을 유지한다.

격리된 공식 VS Code의 실제 실행 버전은 1.141.0이었다. 설치된 0.0.1122로 Kotlin
`do-while` 함수를 열고 전체 시나리오를 생성해 `소스 분석` 표시, 첫 예시의 두 본문 방문과
`1→2→3`, 다음 예시의 `10→11`과 반환 11, 저장된 결과 재사용을 확인했다. 그래프 노트와
가이드 모두 방문별 구문 의미·판단 근거·상태 변화 및 before/after 값을 보존했고,
`소스 열기 · L4`는 실제 본문 4행을 선택했다. 실제 1440×900 및 769×1025 창에서
설명 줄바꿈, 상세값 표, 가이드 스크롤과 소스 버튼을 시각적으로 확인했다. 터치·390px
모바일·다른 테마·전체 접근성 감사는 수행하지 않았다. 새 스타일 변경이나 hook ignore는
없으며 기존 그래프 종류별 의미를 나타내는 경계선은 유지한다.

Default와 `Function Language QA 1107` 프로필에 같은 VSIX를 설치한 뒤 각각 0.0.1122
등록을 확인했다. 배포 대상 JavaScript 478개와 native 실행 파일은 설치본과 byte 단위로
일치하며 VSIX 파일 수·크기 검사 및 runtime closure 검사에 오류가 없었다.

### 0.0.1121 객체·배열·내부 호출의 분석 결과 재사용

`addFunctionNarrativeValueGrounding(context, model)`는 TS/JS 모델에 snapshot-owned
`sourceWorksheet` port를 연결한다. 내부 `irWorksheet`는 기존
`evaluateFunctionTutorInputs`에 opt-in block observer를 전달해 각 구문의 before/after,
조건과 terminal 값을 받는다. 소스를 다시 parse하거나 실행하는 별도 interpreter는 만들지 않는다.
준비·노드·최종 summary는 기존 worksheet API를 유지하며 primitive reader 이후 이 port를
사용할 수 있다. `numberFunctionNarrativeContext`는 port를 모든 외부 prompt에서 제거한다.

완료된 interpreter 방문은 source route의 모든 구문·인용·분기와 순서대로 일치해야 한다.
객체 속성 변경은 객체 전체의 직전/직후 값을 보존하고, 객체 자체를 교체했다고 설명하지 않는다.
truthy 조건은 원래 피연산자 값과 Boolean 선택을 구분한다. `const`, 속성/인덱스 접근,
산술, 논리·조건 선택, 함수 인수와 반환의 실제 문법만 설명한다. 같은 파일의 소스로 resolution된
순수 helper는 기존 bounded summary compiler의 결과를 사용한다. helper 소스가 제공되지 않으면
최적화하지 않는다. 함수 목적은 여전히 모델이 작성하며, 이 의미를 정적 계산으로 입증하지는 않는다.

한 snapshot의 입력 후보는 128개·parameter 8개, trace는 64 step·block당 1 visit·source 구문 32개,
값은 depth 4·frame 128개·container당 8개·JSON 240자로 제한한다. 일부만 저장한 값이나 누락된
구문으로 complete trace를 만들지 않는다. shadowing/repeated declaration, const 재대입,
alias member write, 외부 효과, loop/exception, 음수 0·non-finite·불완전한 source/result/alternative는
기존 모델 pipeline을 유지한다. 현재 adapter가 shadowed 이름을 같은 binding에 합칠 수 있어
repeated define과 parameter shadowing도 별도로 거부한다.

공개 production-parser 예제에서 같은 Qwen3.5 4B 모델로 전체 경로 생성과 모델 정리까지
측정한 최종 관측이다. PC 부하와 모델 시작 비용을 포함하므로 일반적인 시간 한도는 아니다.

| 공개 함수 | 설치된 0.0.1120 | 최종 0.0.1121 | 실제 모델 요청 | 최종 반환 / 노드 |
| --- | ---: | ---: | --- | --- |
| 객체 입력·guard·연속 계산 | 53.31초 | 8.72초 | 5 → 1 | 2/2 · 10/10 |
| 객체 속성 변경 | 21.20초 | 4.73초 | 2 → 1 | 1/1 · 4/4 |
| 분기 있는 순수 helper와 기본 인수 | 21.05초 | 6.46초 | 2 → 1 | 1/1 · 4/4 |
| 배열 길이·첫 요소 읽기 | 34.47초 | 4.47초 | 4 → 1 | 2/2 · 8/8 |

새 결과는 반환 6/6, 노드 26/26, syntax/text/reason/effect가 있는 구문 14/14와
2,802자를 보존했다. 이전 결과는 이 예제의 반환 오류와 소스에 없는 전제 조건을 포함했고,
새 결과의 좁은 반환·노드·전제 검사는 실패가 없었다. 이 결과가 모든 함수의 정확도를
보장하지는 않는다. 별도 symbolic loop 예제는 기존 모델 pipeline을 사용했으며
잘못된 입력 형태·반환을 여전히 드러냈다. 반복 최적화와 그 정확도 문제는 남아 있다.

최종 unit 결과는 1,078개 중 1,074개 통과, 기존 Guide/input/source-reveal 실패 4개 유지다.
관련 worksheet/pure-helper 26개, packaging 15개, release metadata 검사는 통과했다.
새 구현 소스 모듈 하나를 추가한 VSIX는 기존 512-file 한도 안에 있다.
native symbol이 선언 줄만 갖더라도 helper의 모든 program block 인용이 공급된 excerpt에
포함되어야 한다. 선언만 있는 helper excerpt로 숨겨진 본문 결과를 보증하지 않는다.
설치된 Kotlin cursor/native graph/Host/실제 모델의 별도 검사는 두 경로의 반환 0/15,
노드 4+5개와 cache-only paging·소스 연결을 통과했고 실제 모델 요청은 한 번이었다.

분리된 Microsoft VS Code 1.115.0 환경의 설치된 0.0.1121로 공개 객체 입력 함수를
직접 열어 Rust native graph → 전체 시나리오 분석 → 두 번째 페이지 → `const` 노드 선택 →
실제 L3 소스 열기를 확인했다. 실제 Qwen3.5 응답과 source 계산의 입력 객체·결과 0/13,
const 의미, 네 상세 필드와 `선언 전 → 5` 표가 표시됐다. desktop 1440×900과 native 창
769×1025에서 긴 설명이 줄바꿈됐고, 좁은 창의 내부 스크롤로 값 표와 소스 버튼을 읽었다.
정확한 mobile/touch, 영어·테마 전환이나 전체 접근성 인증은 이번 검사에 포함하지 않았다.
페이지·노드·소스 이동 후 작업 목록은 준비 0.0초와 추론 10.9초의 두 항목만 유지했다.
추론 추가 없이 snapshot 결과를 재사용했으며 QA 전용 앱은 종료했다.
Impeccable detector는 관련 파일에서 새 finding이 없었다. 기존 의미별 graph-node border는
기존 파일 한정 예외 그대로 유지했으며 이번 작업에 새 ignore를 추가하지 않았다.

### 0.0.1120 소스 설명과 모델 목적

`primitiveWorksheet/narrative.selectPrimitiveNarrativeAlternative(context, path, inputs, language)`는
Host의 원본 CFG에서 최대 32개 경로·depth 64의 후보를 보고, 현재 조건 선택과 가까운
다른 source route의 typed 입력을 독립 계산한다. 총 경로 수를 제한하거나 다음 페이지를
생략하지 않는다. 분기가 없으면 다른 입력 예시로 같은 식을 계산하고, 추가 입력도 없으면
같은 반환 구문과 조건 분기 없음만 설명한다. 미확인 alternate 계산은 기존 모델 분석을 유지한다.

`buildPrimitiveNarrativeSynthesis(context, language)`는 현재 완료된 code·before/after·반환과
독립 source trace의 일치를 다시 확인한다. 문단에는 원래 입력, 각 조건의 대입/Boolean 결과,
실제 다음 구문, 모든 지역 계산·직전/직후 값과 전체 반환식을 순서대로 넣는다. 다른 입력 예시의
조건·지역 값과 반환도 독립 source trace에서 구성한다. 문단 1,800자·대안 600자를 넘으면
자르지 않고 모델 분석으로 넘긴다. 기존 구문/동작/근거/효과/인용/값 표는 모두 유지한다.

첫 complete source summary는 local provider가 **함수 전체 목적**만 모델에 요청한다.
선택 경로·모델 예시를 이 목적 prompt에 넣지 않아 조기 반환 한 경로에 목적이 편향되는 일을
줄인다. 이후 같은 snapshot·언어의 페이지는 source 문단과 저장한 목적을 즉시 합친다.
기존 모델·sampling·context/output/thread·FIFO·취소/정리 한도는 유지하고 background 추론은 없다.
Host-only `sourceAlternative`는 외부 모델 prompt에서 제거한다. 모델 목적의 의미까지 형식
검증으로 입증하는 것은 아니며 실제 실행도 미검증이다.

Kotlin Int `/`는 0 방향으로 소수 부분을 버리고 `%`는 나머지를 계산한다. 0 divisor,
Int overflow, Double literal, interpolation, boxed identity 비교, JSON이 구분을 잃는 JS -0는 소스 worksheet에서
제외한다. nested control block은 함수 scope의 기존 binding 갱신만 허용한다. 내부의 새 선언,
shadowing, nested callable, loop/exception은 모델 분석으로 넘긴다. 주석·문자열의 괄호와
keyword를 scope scanner가 코드로 오인하지 않고 Kotlin nested block comment도 처리한다.
정수/부동소수·boxing 구분은 [Kotlin 숫자 문서](https://kotlinlang.org/docs/numbers.html), nested comment는
[Kotlin 기본 문법](https://kotlinlang.org/docs/basic-syntax.html#comments)을 근거로 한다.
TS/JS/Kotlin의 이름 없는 complete
Boolean constant는 불가능한 if 선택만 제거하며 unknown predicate와 symbolic loop는 유지한다.

공개 production-parser corpus의 최종 관측은 다음과 같다. 모델 시작·전체 경로 생성·정리를
포함하며 PC 부하가 달라 수치 비율을 모든 함수에 적용할 수 없다.

| 공개 함수 | 0.0.1119 | 0.0.1120 | 실제 모델 요청 | 반환 / 노드 |
| --- | ---: | ---: | --- | --- |
| Kotlin guard | 16.13초 | 5.17초 | 2 → 1 | 2/2 · 9/9 |
| TypeScript 연속 대입 | 14.25초 | 4.58초 | 2 → 1 | 2/2 · 10/10 |
| Kotlin 숫자 Elvis | 13.09초 | 2.50초 | 2 → 1 | 2/2 · 10/10 |
| Kotlin mutable 계산 | 15.77초 | 5.73초 | 2 → 1 | 2/2 · 10/10 |
| Kotlin 숫자 분기 | 11.37초 | 5.37초 | 2 → 1 | 2/2 · 8/8 |
| Kotlin Boolean 반환 | 13.78초 | 4.35초 | 2 → 1 | 2/2 · 8/8 |
| Kotlin 두 guard | 27.18초 | 5.19초 | 3 → 1 | 3/3 · 14/14 |
| TypeScript 긴 계산 | 12.44초 | 4.44초 | 1 → 1 | 1/1 · 7/7 |
| Kotlin 문자열 Elvis | 13.15초 | 2.98초 | 2 → 1 | 2/2 · 10/10 |
| TypeScript 독립 guard·8경로 | 53.95초 | 2.92초 | 8 → 1 | 8/8 · 68/68 |
| Kotlin 정수 나눗셈 | 22.57초 | 5.00초 | 4 → 1 | 2/2 · 9/9 |
| TypeScript nested 외부 binding 갱신 | 48.60초 | 4.89초 | 6 → 1 | 2/2 · 11/11 |

12개 함수·30개 시나리오·174개 노드의 반환과 구문/동작/근거/효과가 통과했다.
8경로의 20개 갱신과 노드 해설 5,780자도 유지됐다. 초기 8경로 smoke는 7.16초,
그 다음 corpus 측정은 4.40초, 최종 관측은 2.92초였으며 모두 실제 추론 1회였다.
이 시간 편차를 숨기거나 2.92초를 지연 상한으로 주장하지 않는다. 원래 0.0.1117의
관측 221.63초와 비교할 때에도 같은 작은 공개 corpus의 비교라는 제약은 같다.
수동 문단 검토에서는 참/거짓 판단과 실제 next source operation·모든 계산·정확한
alternate 결과가 source trace와 일치했다. 호출·객체 접근·가려진 binding·다른 언어와
부분 source는 이 성능 증거의 범위가 아니며 기존 모델 pipeline이 남아 있다.

전체 회귀 1,070개 중 1,066개·패키징 15개가 통과했다. 기존 Function Guide 3개와
source-reveal architecture 1개 실패는 그대로다. 새 의존성·Rust source 변경은 없다.

실제 VS Code 1.115.0의 분리 QA 인스턴스에서 0.0.1120을 설치하고 Kotlin `GraphNotes.kt`의
**전체 시나리오 분석**을 눌렀다. 두 경로의 0/15 반환과 source paragraph·대안, val 구문·
10 + 5 = 15 근거·선언 전→15 값 표, L4 원본 줄 선택과 번호 표기를 확인했다.
페이지·노드·소스 이동 뒤 모델 이력은 준비 1회(0.0초)와 추론 1회(5.1초)만 남았고 대기는 0개였다.
원본/예시값을 편집하지 않고 1440×900과 769×1025 native 창에서 표시를 점검했다.
좁은 창의 Webview 폭은 약 421px이며 줄바꿈·내부 스크롤·값 표·소스 버튼 접근을 확인했다.
정확한 mobile browser viewport, 터치·다른 theme/locale·전체 접근성 인증은 이번 증거에 없다.
검사 후 전용 QA 인스턴스를 종료했다. 사용자의 기존 Code 창에는 재시작을 강제하지 않았다.

VSIX는 511파일·3.63 MiB로 기존 512파일 한도와 runtime closure를 통과했다. Default와
Function Language QA 1107에 0.0.1120이 등록됐고 설치된 JS 477개·native binary가
패키지와 일치했다. 설치본 cursor/native graph/Host replay도 7.67초에 반환 0/15,
9개 노드·실제 추론 1회·cache-only 페이지와 소스 이동을 확인했다. 현재 데이터는 source-proved
계산의 큰 속도 개선을 입증하지만 모든 call/property/loop나 모든 언어의 지연 감소를 입증하지 않는다.
Impeccable detector는 locale/session/graph styles에서 새 finding 0개였고, 기존 semantic
노드 표시의 파일 한정 side-tab 예외를 유지했다. 새 ignore는 추가하지 않았다.

### 0.0.1119 처리 시간과 품질 확인

동일 Qwen3.5-4B Q4_K_M·seed 42·temperature 0.2·context/output/thread 한도에서
production parser·grounding·session을 실행했다. 공개 기본·stress·fallback 12개 함수의
30개 시나리오 반환값과 174개 노드가 완료됐고, 구문/동작/근거/효과와 좁은 causal-language
점수는 통과했다. 모든 실행 후 소유한 model process가 종료됐다.

| 공개 함수 | 0.0.1119 최종 관측 | 실제 모델 요청 | 반환 / 노드 |
| --- | ---: | ---: | --- |
| Kotlin guard | 16.13초 | 2 | 2/2 · 9/9 |
| TypeScript 연속 대입 | 14.25초 | 2 | 2/2 · 10/10 |
| Kotlin 숫자 Elvis | 13.09초 | 2 | 2/2 · 10/10 |
| Kotlin mutable 계산 | 15.77초 | 2 | 2/2 · 10/10 |
| Kotlin 숫자 분기 | 11.37초 | 2 | 2/2 · 8/8 |
| Kotlin Boolean 반환 | 13.78초 | 2 | 2/2 · 8/8 |
| Kotlin 두 guard | 27.18초 | 3 | 3/3 · 14/14 |
| TypeScript 긴 연속 계산 | 12.44초 | 1 | 1/1 · 7/7 |
| Kotlin 문자열 Elvis | 13.15초 | 2 | 2/2 · 10/10 |
| TypeScript 독립 guard 3개·8경로 | 53.95초 | 8 | 8/8 · 68/68 |
| Kotlin integer division, 모델 fallback | 22.57초 | 4 | 2/2 · 9/9 |
| TypeScript nested scope, 모델 fallback | 48.60초 | 6 | 2/2 · 11/11 |

8경로 함수의 생성 token은 0.0.1118의 1,673에서 1,038로 약 38% 감소했고,
이전 73.87초 대비 최종 53.95초였다. 노드 해설 5,780자와 20개 대입 검사는 그대로다.
중간 동일-output-token A/B에서는 n-gram 켬 62.68초·끔 51.25초였지만 PC 부하가
달라 모든 함수의 시간 개선을 보장하지 않는다. 최종 기본 함수 일부는 이전 관측보다 느렸으며,
전체 처리 시간을 극단적으로 줄였다고 선언할 근거는 아직 부족하다.

수치·구조 점수는 자유 문장 전체의 의미 검증이 아니다. 실제 문단 수동 검토에서
guard의 “본문”을 모호하게 지칭하거나 다른 입력의 반환을 잘못 설명한 사례가 남았다.
현재 경로의 독립 source fact와 원본 노드 해설을 보존하지만, 모델 문단·대안의 의미 정확도는
완료 기준을 아직 충족하지 않는다. 이를 성공한 품질 검사로 합산하지 않는다.
fallback 함수의 숫자 반환 검증도 임의의 호출·loop·exception 정확도를 증명하지 않는다.

재현은 compile 후 `node scripts/benchmark-function-narratives.mjs - candidate release MODEL RUNNER full-run`.
`all`·`stress`·`fallback` 또는 개별 fixture selector로 범위를 줄일 수 있다.
전체 회귀 1,063개 중 1,059개와 패키징 15개가 통과했고, 기존 Function Guide 3개와
source-reveal architecture 1개 실패가 동일하게 남았다. 새 의존성과 Rust 변경은 없다.
VSIX는 508파일·3.63 MiB이며 기존 파일 한도와 runtime closure 검사를 통과했다.

실제 UI는 사전에 설치된 공식 VS Code 1.115.0을 별도 임시 user-data/extensions 경로로
실행해 검사했다. 0.0.1119 VSIX 설치·Reload Window 후 plaintext로 열린 `GraphNotes.kt`의
Kotlin 커서를 현재 함수 시각화 명령으로 분석하고, **전체 시나리오 분석**을 직접 눌렀다.
완료 상태, 0/15 반환, 다음 페이지의 snapshot 재사용 표시, `val` 구문·`10 + 5 = 15` 근거·
선언 전→15 값 표와 L4 소스 선택/번호 표시를 확인했다. 페이지·노드·소스 이동 뒤 이력은
source-free 준비 1회(0.0초), 추론 2회(9.9초·4.1초) 그대로였으며 대기 작업은 0개였다.
모델 프로세스가 남지 않았고 검사 후 이 별도 Code 인스턴스도 종료했다.

실제 native 창 1440×900과 769×1025에서 초기·생성 후·상세/소스 상태를 봤다.
좁은 창은 Explorer를 포함하므로 Webview 폭은 약 421px이며, Guide가 canvas 앞에 쌓이고
긴 구문 설명이 줄바꿈됐다. 내부 스크롤로 값 표와 소스 버튼에 도달했다. 390×844의 정확한
browser viewport, 터치, 다른 theme/언어, 전체 접근성 적합성은 이번에 검사하지 않았다.
기존 색상 토큰·native 버튼·노드 종류 표시는 유지했다. Impeccable detector는 변경 session과
graph styles에서 새 finding 0개였으며 기존 semantic side-tab의 파일 한정 예외를 유지하고
새 ignore는 추가하지 않았다. 화면에 표시되는 자유 문장의 의미 문제는 위 제한으로 남겼다.

Default와 Function Language QA 1107은 모두 0.0.1119로 등록됐고 설치된 JS 474개·native
binary가 패키지와 일치했다. runtime closure/mismatch는 0개다. QA의 자동 모델 준비 설정과
Default의 기존 모델 설정을 유지했다. 설치본 cursor/native graph/Host replay도 실제 모델로
16.77초에 두 경로와 9개 노드, 실제 추론 2회, cache-only 페이지·소스 이동을 확인했다.
이미 실행 중이던 사용자의 Code 창에는 재시작을 강제하지 않았다.

### 0.0.1118 처리 시간과 품질 확인

공개 fixture를 production parser·grounding·scenario session·실제 Qwen3.5-4B Q4_K_M으로
검증했다. 동일한 모델·seed 42·temperature 0.2·context 8,192·output 2,400·CPU thread 2개를
사용했다. 아래 시간은 설치된 0.0.1117과 후보를 순차 실행한 관측값이며 PC 부하에 따라 달라진다.

| 공개 함수 | 0.0.1117 | 0.0.1118 | 실제 모델 요청 | 후보 품질 |
| --- | ---: | ---: | --- | --- |
| Kotlin guard | 17.58초 | 10.03초 | 5 → 2 | 반환 2/2, 노드 9/9 |
| TypeScript 연속 대입 | 20.13초 | 8.76초 | 5 → 2 | 반환 2/2, 노드 10/10 |
| Kotlin 숫자 Elvis | 22.16초 | 9.15초 | 6 → 2 | 반환 2/2, 노드 10/10 |
| Kotlin mutable 계산 | 21.88초 | 10.53초 | 5 → 2 | 반환 2/2, 노드 10/10 |
| Kotlin 숫자 분기 | 21.59초 | 11.10초 | 4 → 2 | 반환 2/2, 노드 8/8 |
| Kotlin Boolean 반환 | 12.43초 | 11.63초 | 4 → 2 | 반환 2/2, 노드 8/8 |
| Kotlin 두 guard | 32.02초 | 17.09초 | 8 → 3 | 반환 3/3, 노드 14/14 |
| TypeScript 긴 연속 계산 | 19.32초 | 6.24초 | 4 → 1 | 반환 1/1, 대입 4/4, 노드 7/7 |
| Kotlin 문자열 Elvis | 25.14초 | 10.55초 | 6 → 2 | 반환 2/2, 대입 2/2, 노드 10/10 |
| TypeScript 독립 guard 3개·8경로 | 221.63초 | 73.87초 | 36 → 8 | 반환 8/8, 대입 20/20, 노드 68/68 |

후보 전체 26개 시나리오·154개 노드에서 반환·대입·구문/동작/근거/효과 필드와 좁은
causal-language 검사를 통과했다. 8경로의 실제 최종 문단도 입력·선택된 대입·반환·대안을
검토했다. 이전 버전의 추가 corpus에는 두 guard 반환 오답과 지어낸 입력 제약, 8경로의
null 반환/복제 prose가 있었으며 후보에서 나타나지 않았다. 모델이 생성하는 임의의 문장을
모두 증명하는 검사는 아니며 실제 실행은 여전히 미검증이다.

source worksheet 준비/노드 요청은 이 corpus에서 대체로 0.04–3ms였다. 실제 추론은
최종 문단에만 사용했고 모든 측정 후 소유한 model process가 종료됐다. 완료 시 관측한
runner RSS는 후보 약 3.2–3.4 GiB이며 model 전체의 메모리 상한이나 실제 peak 측정은 아니다.
실패한 짧은 JSON 키 실험과 source checkpoint가 재사용되지 않은 중간 실험은 출시에서 제외했다.

재현은 compile 후 `node scripts/benchmark-function-narratives.mjs - candidate all MODEL RUNNER full-run`,
`stress` 또는 fixture 이름을 사용한다. 이전 설치본은 runtime-root를 지정하고 `full-run`을
생략해 그 버전의 page lifetime으로 측정한다. `context-only` 진단은 마지막 인자로 지정하며
source context와 원문 응답은 private temporary directory에만 쓴다. source는 실행하지 않는다.

배포 시 `scripts/bundle-local-narrative-runtime.mjs`는 같은 폴더의 local adapter helper를
public `llm/functionNarratives/index.js`에 묶는다. source module과 개발용 compile output은
분리한 채 유지하며 watchdog은 독립 child entrypoint로 배송한다. 새 모듈을 추가하면서도
512파일 패키지 한도를 올리지 않는다. Node 외부 require·디렉터리·module cache 계약을
패키징 회귀로 확인하고 설치본의 실제 모델과 부모 종료 정리도 검증한다.

최종 회귀는 1,063개 중 1,059개 통과이며 기존 Function Guide type baseline/nested object/
advanced private Scenario 3개와 source-reveal architecture 1개의 실패가 그대로 남았다.
새 worksheet·capability·scope·취소/재개 회귀와 패키징 15개는 통과했다. Rust source는
변경하지 않았으며 release build로 같은 native binary를 재사용했다.
VSIX는 508파일·3.62 MiB이며 runtime closure 오류가 없다. Default와 Function Language QA
1107 프로필 설치 버전은 0.0.1118이고 설치된 JS 474개·native binary가 패키지와 일치했다.
설치본 cursor/plaintext Kotlin resolver·native graph·Host delivery를 실제 로컬 모델로 재생해
두 경로의 0/15 반환과 전체 9개 노드, 실제 추론 2회, cache-only 페이지·소스 이동을 확인했다.
이 설치본 재생은 21.17초였으며 live VS Code 버튼/화면 검증을 대신했다고 주장하지 않는다.

ChatML 로컬 경계에서는 공통 source evidence와 현재 task를 별도 user message로 보낸다.
source를 system 명령으로 승격하지 않으며 이전 모델 값은 task suffix에만 둔다. 정확한
message delimiter를 raw completion에 전달해 recurrent 모델이 task 앞의 source checkpoint를
재사용하도록 한다. 다른 템플릿과 CLI fallback은 single-user 계약을 유지한다.

`llm/functionNarratives/localWire.createLocalNarrativeWire(schema)`는 고정된 source 위치·
call ID를 모델 출력에서 반복하지 않도록 한다. code·when/outcome·input 이름/값은 설명의 근거가 되는
출력 토큰으로 유지한다. 복원은 동일한 source
슬롯만 사용하며, 모델이 그 값을 덮어쓰거나 순서·개수·필드 구조를 바꾸면 거부한다.
`localInput.buildLocalNarrativeInput(context)`는 선택 경로의 도달 정보와 Boolean 판단을
구분한다. 예를 들어 `!enabled=false` 뒤에 대입이 도달한다는 사실을 “대입 생략”으로
읽지 않도록 한다. 구체적 실행 여부가 확인됐다는 뜻은 아니며 미검증 표시를 유지한다.

rich primary의 처음 두 단계는 source 순서·예시값을 확인한 뒤 다음 node 요청에 재사용한다.
출력 schema의 각 단계 description에도 그 슬롯의 실제 구문을 붙인다. 다른 구문에 앞 단계의
text/syntax를 그대로 복사한 경우에는 그 앞까지의 prefix만 재사용하고 나머지를 node 요청으로
다시 읽는다. 이 검사도 임의의 문장 의미를 검증하는 것은 아니다.
오래된 terminal-only 응답은 선행 단계로 취급하지 않고 기존 방식으로 모든 노드를 읽는다.
따라서 상세 해설을 생략해서 속도를 높이지 않으며 저장 페이지·source action·취소 재개는
기존 contract를 사용한다.

1. 확장을 설치하고 PC에 llama.cpp의 `llama-completion` 실행 도구를 미리 준비한다.
   기본 provider는 `local`이다. Homebrew 경로와 PATH를 확인하며, 다른 설치 경로는
   `projectAnalyzer.functionNarratives.localBinary`에 지정한다.
2. 함수를 시각화하면 Function Guide가 열린다. 짧은 목적을 읽고 **전체 시나리오 분석**을 누른다.
   `localModel`이 비어 있거나 해당 파일이 없으면 Qwen3.5-4B Q4_K_M 가중치(2.74 GB)를
   자동 다운로드하고 무결성 확인 후 같은 요청의 분석을 시작한다. native 진행 알림과 Guide의
   **취소**로 다운로드를 중단할 수 있다. 다시 분석하면 임시 파일부터 이어받는다.
   기존 GGUF의 절대 경로를 `projectAnalyzer.functionNarratives.localModel`에 설정하면 그대로
   재사용한다. 프로젝트 설정이 실행 파일을 바꾸지 못하도록 machine scope를 쓴다.
3. 로컬 모델은 요청할 때만 실행하고 끝나거나 취소되면 프로세스를 종료한다.
   기본 문맥 8,192 token, 응답 2,400 token, CPU thread 2개와 GPU 자동 offload를 사용한다.
   발견한 소스 경로를 상세 해설 한 개씩 순차 분석한다. 전체 경로 수에는 3개/4개 상한을
   적용하지 않는다. 실제 추론 호출마다 실행 시작 이후 180초 제한을 사용하며, 같은 snapshot/언어의 결과를 재사용한다.
   취소·실패 후 **이어서 시나리오 분석**은 완료된 경로를 건너뛰고 미완료 묶음부터 재개한다.
   설정 변경으로 두 모델이 동시에 실행되지 않는다.
4. 함수의 역할과 시나리오별 문단에서 조건·판단·계산·건너뛴 작업·예상 결과를 읽는다.
   접힌 **소스 근거**를 펼치면 조건, 번호가 붙은 동작, **판단 근거**, **값과 흐름의 변화**,
   예상 결과와 가정을 확인한다. 응답 하나는 최대 2개이고 결과는 한 페이지씩 읽는다.
   문단 아래의 **이 경로를 선택하는 이유**, **상태와 부수 효과**, **다른 경로로 바뀌는 조건**은
   입력을 대입한 누적 조건, 도달한 계산·호출·반환과 경계/대체 분기를 각각 설명한다.
   상세 로컬 묶음은 summary 240자, 문단 600자, 위 세 필드 각각 220자, 종료/미완성 접두부의 대표 단계 한 개를
   사용한다. 단계의 text/syntax/reason/effect는 각각 120/160/180/160자다.
   모든 소스 노드를 최대 2개씩 순서대로 별도 해설하므로 대표 단계 상한이 노드 수를 제한하지 않는다.
   노드 응답은 새 steps만 반환하고 원래 시나리오·입력·결과는 Host가 보존한다.
   앞 노드의 모델 예시 값 최대 8개를 함께 전달해 계산을 이어가며 실제 실행값으로 취급하지 않는다.
   문단 생성 때의 종료 단계는 앞 계산이 끝난 노드 해설로 교체한다. 초기 생성의 추측한 중간값을
   반환 노드에 재사용하지 않으며, 함수 진입 노드는 이후 반환의 effect를 가져오지 않는다.
   이전 context의 2개 경로·3개 노드 묶음과 짧은 해설도 계속 읽을 수 있다.
   연결 모델의 portable 단계 상한은 5개다. 이 설명 길이 제한은 전체 경로 수와 별개다.
   **이전/다음 시나리오**는 저장된 결과만 읽으며 모델을 실행하지 않는다. 진행 중에는 완료한
   개수를, 경로 열거가 끝나면 전체 개수와 완료 여부를 표시한다.
   각 단계의 **소스 · 1.2 · L…** 버튼은 Host가 확인한 원본 줄을 편집기에서 연다.
   문단 아래에는 매개변수별 예시 입력과 예상 결과값이 표시된다. **시나리오 선택**은 해당
   경로를 강조하고 예시 입력을 채우며, **그래프에서 보기**는 경로를 화면에 맞춘다.
   **예시값 적용**은 Values 입력칸을 열고 첫 입력으로 포커스를 옮긴다.
5. 원본 줄 끝에 `LLM 1.2` 번호와 짧은 해설이 표시된다. 번호는 페이지를 넘어 이어지므로
   다섯 번째 시나리오의 첫 단계는 `LLM 5.1`이다. 현재 페이지의 표시만 유지한다. hover에서 조건,
   문장형 설명·전체 동작·판단 근거·값의 변화·예상 결과·가정을 확인한다. 한 줄의 여러 시나리오는
   표시 하나로 묶는다. 소스 내용은 변경하지 않는다.

소스를 수정하거나 문서를 닫으면 오래된 표시를 제거한다. 최신 해설은 함수를 다시 불러와
생성한다. 편집기 제목의 지우기 버튼 또는 **Code Flow: Clear LLM Source Annotations**
명령으로 표시를 지울 수 있다. 같은 소스의 **소스** 버튼은 해당 함수·생성 언어의 검증된
캐시를 다시 표시하며 모델을 실행하지 않는다. `projectAnalyzer.functionNarratives.sourceDecorations`
설정으로 표시를 끌 수 있다. Git 비교의 이전 리비전 문서는 현재 파일의 표시를 지우지 않는다.

**선택한 노드 해설**에서 그래프 또는 노드 목록으로 선택한 구문의 동작·구문 의미·판단 근거·값의
변화를 읽는다. 반복 방문은 각각 표시하며 다른 페이지의 노드는 저장된 해설만 불러온다.
구문 의미는 해당 언어의 실제 연산자·선언·단락 평가·반환을 설명한다. Kotlin의 safe call,
Elvis, `val`/`var` 등은 그 구문이 제공된 소스에 있을 때만 설명하도록 요청한다.
노드 해설 위에는 Host가 확인한 실제 소스 식을 표시한다. 변환된 null 조건은
`loweredPredicate`로 원문과 구분해 전달하므로 Elvis 경로가 소스 누락으로 중단되지 않는다.
노드의 effect는 그 구문 직후의 변화이며 뒤의 반환/대입을 이미 끝난 작업으로 서술하지 않도록 한다.
현재 경로가 지나지 않는 노드는 이를 명시하고 다른 시나리오의 예시와 함께 설명한다.
첫 결과만 빈 입력칸을 채운다. 페이지 이동·진행률 갱신·언어 전환은 사용자가 편집한 값을
덮어쓰지 않는다. 명시적으로 시나리오를 선택하거나 예시값을 적용하면 해당 예시로 바꾼다.
Kotlin도 예시 입력을 편집·삭제·추가할 수 있으며 **모델 예시 생성**은 Guide의 모델 분석을
연결한다. Kotlin 소스의 런타임 계산을 지원한다는 의미는 아니다.

VS Code 연결 모델을 쓰려면 `projectAnalyzer.functionNarratives.provider`를 `vscode`로 바꾼다.
여러 등록 모델 중 선택하며 필요한 접근 동의는 VS Code UI를 따른다. 접근 실패, 잘못된
응답 또는 timeout 후 재시도는 다른 모델을 선택할 수 있다. 로그인·API key를 자동 처리하지 않는다.

### 모델 작업 확인과 취소

Guide의 전체 시나리오와 함수 호출 해설은 한 Extension Host 안에서 같은 FIFO 대기열을 사용한다.
동시에 한 작업만 실행하고 최대 32개가 기다린다. 새 요청은 다른 화면의 작업을 취소하지 않는다.
화면에 **모델 작업 대기 · 순서 …**, **모델 준비 중**, **모델 실행 중**과 취소 후 정리 상태를
표시한다. 대기 시간과 가중치 준비 시간은 실제 추론의 180초 제한에 포함하지 않는다.
긴 함수의 각 경로·노드·호출 묶음은 새 순서로 들어가므로 다른 화면의 요청도 이어서 처리한다.

상태 표시줄의 **모델 작업** 또는 Command Palette의 **코드 흐름: 모델 작업**
(영문 **Code Flow: Model Tasks**)을 열면 진행 중·대기·최근 종료 작업을 확인할 수 있다.
목록을 여는 동작은 준비나 모델 실행을 시작하지 않는다. 오른쪽 취소 버튼은 해당 작업만,
상단 전체 취소 버튼은 현재 작업들을 취소한다. 완료된 설명과 저장 페이지는 유지한다.
대기 중 취소된 작업은 runner를 실행하지 않으며 실행 중 취소는 프로세스 종료와 임시 파일
정리를 기다린 뒤 다음 모델을 실행한다. 잘못된 응답이나 실행 실패 후에도 대기열은 이어진다.

**모델 요청에 실패했습니다**가 나타나면 모델 작업의 종료 이력에서 실패 분류를 확인한다.
로컬 runner의 메모리 할당·입력 한도·모델 파일 로드·옵션 미지원·응답 문법 준비 실패를
구분하고 분류하지 못한 프로세스 오류는 `exit-…` 또는 `signal-…` 코드로 표시한다.
최근 이력은 최대 32개이며 작업 정보만 유지한다. Project Analyzer 출력의 `model.task`에는
ID·종류·단계·대기/실행 시간·오류 분류만 남기며 함수 이름·원문·prompt·응답·stderr는 기록하지 않는다.

전역 대기열은 해당 Extension Host 범위다. 별도 VS Code 창이나 원격 Host는 각자의
대기열을 갖는다. 여러 창의 모델 다운로드를 조정하는 파일 lease와 추론 스케줄링은 별개다.
연결 공급자 취소는 VS Code cancellation token을 전달하지만 외부 서버의 실제 정리는
그 공급자가 담당한다. context/output/thread 상한과 명시적 생성 정책은 유지한다.

설명 언어는 `projectAnalyzer.uiLanguage`를 따른다. `ko`이면 한국어, `en`이면 영어로
요약과 시나리오 문단을 요청한다. `auto`는 VS Code 표시 언어가 한국어일 때 한국어,
그 외에는 영어를 사용하며 명시적 `ko`/`en`이 표시 언어보다 우선한다. 코드의 식·식별자·
반환 문자열은 원문을 유지한다. 언어를 바꾸는 것만으로 모델을 실행하지 않는다.
기존 결과에는 생성 언어를 표시하고, 새 언어의 **전체 시나리오 분석**을 누르면 해당 언어로 생성한다.
이미 생성한 언어로 돌아가면 그 언어의 캐시를 다시 읽는다. 로컬 실행에서는 요청 언어를
별도 system message로 전달하고 한국어 서술은 한글로 시작하도록 JSON grammar로 유도한다.
Host와 화면은 설명의 문자 체계를 확인하며 인용된 코드·반환 문자열은 원문으로 허용한다.
요청 언어와 다른 설명은 저장하거나 소스에 표시하지 않고 재시도 안내를 보여준다.
자동으로 다시 생성하지 않는다. 이 확인은 문장 의미나 내용의 정확성을 판정하지 않는다.

기본 그래프 도구는 Guide·전체 보기와 접힌 **도구**다. 전체 함수 요약과 5개 읽기 질문,
기존 정적 경로 시나리오는 접힌 **분석 상세**에서 확인한다. 부모 상세를 닫으면 해당 시나리오
계산 소비자를 해제한다. 생성 중에는 취소만 보이고 현재 언어의 완료 결과에서는 생성 버튼을
숨긴다. 언어를 바꾸면 기존 문단과 펼침 상태를 유지하고 새 언어의 생성 버튼을 제공한다.

실행 도구가 없으면 다운로드 전에 설정 안내를 표시한다. 가중치는 VSIX에 포함하지 않고 첫 분석
요청에서만 준비한다. 키를 보관하지 않으며 기본 분석·화면 전환·focus·언어 전환 때 다운로드하거나
추론하지 않는다.
로컬 모드는 source를 외부로 보내지 않는다. 연결 공급자의 전송 방식은 해당 설정을 따른다.
전체 저장소를 전달하지 않는다. context가 만료되면 **함수 다시 불러오기**로 복구한 뒤 다시 생성한다.

### 자동 모델 저장소

`storage/localModels.createManagedLocalModelCache`는 `ExtensionContext.globalStorageUri` 아래
`models/qwen3.5-4b-q4_k_m-00fe7986ff5f/Qwen3.5-4B-Q4_K_M.gguf`를 사용한다.
확장 업데이트와 workspace 전환 때 같은 파일을 재사용한다. 저장 위치는 VS Code가 지정한
global storage를 따르며 원격 Extension Host에서는 해당 Host의 저장소를 사용한다.
일반 분석 캐시 지우기는 모델을 삭제하지 않는다.

다운로드 원본은 [Unsloth GGUF의 고정 revision](https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/tree/e87f176479d0855a907a41277aca2f8ee7a09523)이다.
예상 파일 크기는 2,740,937,888 byte, SHA-256은
`00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4`다.
기본 [Qwen3.5-4B 모델](https://huggingface.co/Qwen/Qwen3.5-4B)은 Apache-2.0을 따른다.
다운로드는 HTTPS와 정상 TLS 검증을 사용하고 Hugging Face/CDN 접근이 필요하다.
실패 시 네트워크·프록시·저장 공간을 확인하고 명시적으로 재시도한다.

전송은 bounded buffer로 `.part` 파일에 쓰고, 재시도 시 Range와 전체 체크섬을 확인한다.
서버가 Range를 지원하지 않으면 처음부터 다시 받는다. 크기·체크섬이 맞아야 최종 파일로
atomic rename하며 잘못된 데이터는 사용하지 않는다. SHA-256 결과는 한 Host에서 파일 stat
identity가 유지될 때 재사용하고 다른 Host/재시작 또는 파일 변경 시 다시 확인한다.
여러 창은 PID/token 파일 lease로 다운로드를 공유하고 취소·Host disposal은 전송을 중단한다.
준비 단계에는 source를 전달하지 않으며 다운로드 시간은 실제 모델 호출별 180초 추론 제한에 포함하지 않는다.

## 근거와 한계

LLM 설명은 항상 **추론 · 실제 실행 미검증**이다. JSON 형식과 소스 위치가 제공한 스니펫
범위 안인지 확인해도 설명의 의미가 맞다는 보장은 아니다. 소스 버튼은 검토 위치이며
경로 도달이나 실행 증거가 아니다. 모델 예시는 편집 가능한 입력칸과 경로 강조에 사용하지만
정적 검증 결과나 관찰된 값으로 취급하지 않는다. 사용자 소스를 실행하거나 LLM tool call을
제공하지 않는다. 매개변수는 최대 32개, 입력 JSON은 각각 1,200자·방문 96·깊이 6·container
16개로 제한한다. 위험한 object key나 실행 구문은 거부한다. 결과값은 표시 전용 텍스트이고
외부 결과가 미확인이면 `null` 예시와 가정을 사용한다. 전달하지 않은 소스나 지원하지 않는
노드의 해설은 준비되지 않았다는 상태로 남기며 반환값으로 꾸미지 않는다.

부족한 helper, 외부 호출의 결과, source excerpt 생략은 가정과 미확인 부분으로 설명하도록
요청한다. 코드 주석·문자열은 명령이 아닌 데이터로 전달한다. 함수가 길면 본문 앞과 끝을
별도 스니펫으로 제공하고 제한 안내를 표시한다. 결과가 없는/잘못된 JSON, 제공하지 않은
소스 위치, 상한 초과 응답은 거부한다. 자동 재요청은 하지 않는다.

상세 해설은 프롬프트 지침으로 요청한다. 일관된 입력 역할, 조건의 참/거짓 근거,
실제 계산과 변수 변화, 다음 구문, 조기 반환으로 건너뛴 작업과 결과를 완전한 문장으로
연결하도록 요청하고 소스 줄 번호를 제공한다. 무관한 함수의 해설 예제는 제공하지 않는다.
현재 버전은 모델 가중치나 LoRA를 학습하지 않는다. 모델 응답은 길이뿐 아니라 실제 분기와
결과도 검토해야 한다. 특히 작은 모델은 자세한 형식을 따르더라도 잘못된 판단을 할 수 있다.

## 모듈의 public API

- `application/functionNarratives`: `buildFunctionNarrativeContext`, `buildFunctionNarrativePrompt`,
  `buildFunctionNarrativeSourceFlow`, `buildFunctionNarrativeScenarioGraph`,
  `createFunctionNarrativeScenarioIterator`, `FunctionNarrativeScenarioRun`, `addFunctionNarrativeValueGrounding`,
  `buildFunctionNarrativeScenarioFrames`, `parseFunctionNarrative`,
  `FunctionNarrativeProvider`, `FunctionNarrativeError`.
  `bindFunctionNarrativeGraph`는 기존 analyzer 순서를 public graph identity에 연결한다.
  `initializeFunctionNarrativeNodes`, `createFunctionNarrativeNodeTask`,
  `appendFunctionNarrativeNodes`, `finalizeFunctionNarrativeNodes`는 선택된 시나리오의 같은
  예시값으로 소스 노드 해설을 채우고, 진입·종료 및 반복 방문의 identity를 Host에서 부여한다.
  초기화의 선택 인자 `detailLevel: "rich"`는 primary 단계의 재사용을 늦춰 모든 노드가
  앞선 상태를 이어받게 한다. finalization은 그 해설로 일치하는 문단의 소스 근거를 갱신한다.
  `buildFunctionNarrativeRichGuidance`는 local/VS Code 공급자에 같은 인과·언어 구문 지침을 제공한다.
  `getFunctionNarrativeExampleConstraints`는 파서가 증명한 직접 Boolean/nullable 선택과
  partial 상태만 가져오며 임의의 숫자 조건 도달을 검증하지 않는다.
- `shared/functionNarratives`: portable narrative/context types 및 동일한 Host/browser runtime validator,
  요청 언어의 서술을 확인하는 `isFunctionNarrativeLanguage`.
  `isFunctionNarrativeExample`은 실행 없이 JSON 예시의 크기·깊이·안전한 key를 검사한다.
  `createFunctionNarrativeValidator`는 이 helper를 명시적으로 주입해 Webview 직렬화에도
  CommonJS module 참조가 남지 않게 한다.
  `FunctionNarrativeSourcePresenter`, `buildFunctionNarrativeSourceAnnotations`는 native source 표시 계약과
  줄별 번호 그룹화를 제공한다.
- `vscode/functionNarrativeProvider`: 실제 VS Code 모델 선택, token 확인, streaming, 취소와 오류 변환.
- `llm/functionNarratives`: `createLocalFunctionNarrativeProvider`, private prompt, localized line-numbered
  input, JSON grammar, output cap, controlled runner 진단과 종료를 기다리는 adapter.
- `shared/modelTasks`: `ModelTaskManager.run/cancel/cancelAll/snapshot/subscribe/dispose`,
  `getGlobalModelTaskManager`, `ModelTaskProgress`와 `isModelTaskProgress`.
  framework와 무관한 FIFO/실행 deadline/취소 정리/불변 snapshot/32개 이력을 제공한다.
- `application/functionNarratives`: `scheduleFunctionNarrativePreparation`,
  `scheduleFunctionNarrativeRequest`, `requestFunctionNarrative`, `MODEL_INFERENCE_TIMEOUT_MS`.
  domain 오류 변환, 중첩 adapter의 실행 슬롯 재사용, 완료 전 구조·언어 검증을 담당한다.
  `managesDeadlines` provider는 슬롯을 받은 뒤 제한을 시작하고 미관리 port는 Host fallback을 쓴다.
- `vscode/modelTasks.createModelTasksUi`: native status bar와 live Quick Pick.
  목록 읽기·언어 변경은 모델 작업을 만들지 않으며 명시적인 취소만 manager에 전달한다.
- `shared/localModels`: `ManagedLocalModelCache`, `LocalModelDescriptor`, bounded progress/error 계약.
- `storage/localModels`: `createManagedLocalModelCache`, `DEFAULT_FUNCTION_NARRATIVE_MODEL`.
  내부 HTTPS streaming/resume/hash와 cross-window lease를 native UI에서 분리한다.
- `vscode/functionNarrativeSetup`: `createConfiguredNarrativeProvider`는 machine 설정, runner preflight,
  source-free `prepare`와 native 진행·취소·오류 안내를 담당한다. 실행별 provider를 AbortSignal에 고정한다.
- `vscode/configuredFunctionNarrativeProvider`: VS Code API와 주입받은 모델 저장소를 위 adapter에 연결한다.
- `vscode/functionNarrativeDecorations`: 한 번에 검증된 결과 하나만 유지하는 native adapter.
  전체 문서의 hash, 실제 file URI와 표시 소유권을 확인하고 편집·닫기·설정 해제 때 지운다.
- `storage/functionNarrativePages`: `createFunctionNarrativePageStore`는 첫 저장 때만 private
  임시 폴더(0700)와 검증된 JSON 페이지(0600)를 만든다. 재조회 때 다시 검증하고 owner 해제 때
  폴더를 제거한다. 전체 모델 문장을 Host 메모리에 쌓지 않는다.
- `webview/codeFlow/functionNarrativesHostDelivery`: snapshot별 최대 8개 context, locale별 재개
  세션과 작은 페이지 metadata, 단일 pending 분석과 공유 provider의 실제 실행별 180초 deadline, evidence token projection.
  미관리 adapter의 90초 묶음/45초 단일 요청 fallback을 유지한다. 완료 캐시는 다른 pending 분석을 취소하지 않는다.
  `FunctionNarrativeScenarioSession.readNodePage`는 저장된 첫 해설 페이지를 node ID로 조회하며,
  모델을 호출하거나 화면의 선택 페이지·진행 중 request ID를 바꾸지 않는다.
- `webview/functionNarratives`: inert reading section, strict reply correlation, bounded DOM,
  literal prose, locale/focus retention, disposal cancellation.
- `protocol/functionNarratives`: identity-only request/cancel, cache-only `pageIndex`/`pageLanguage`/`nodeId`,
  progress/coverage/page 응답과 source-free `working` task 갱신, 정확한 context/locale/페이지/단계 source action과 bounded result.
  source action의 optional `nodeIndex`는 해당 저장 페이지의 정확한 노드 근거를 가리킨다.
  이전 text-only 단계도 읽으며 새 prompt는 explanation/reason/effect를 요청한다.

source context는 최대 5개/18,000자이며 실제 모델 응답 하나는 최대 24,000자 JSON이다.
노드 해설을 합친 저장 페이지는 최대 2개 시나리오와 시나리오별 최대 900개 node detail로
제한한다. Webview는 한 페이지와 최대 8개 선택 노드 해설만 보유하며 다른 저장 페이지의
전체 문장을 누적하지 않는다.
portable validator의 시나리오 4개×step 5개는 응답 상한이며 함수 전체의 경로 상한이 아니다.
시나리오의 `explanation`은 최대 1,800자다. 새 로컬 grammar에는 필수이며 이전 결과에는
선택 필드로 허용한다. 이전 결과는 기존 조건·단계·결과만 이어 문단을 구성한다.
현재 생산 context의 `detailLevel: "rich"`는 `analysis.pathReason/stateChange/alternative`와
단계별 `syntax`를 필수로 요청한다. portable 각 필드는 최대 600자이며 Host/browser가 함께
형식과 요청 언어를 검사한다. 이전 response에서는 선택 필드다. 상세 node task의
`{steps:[...]}` 응답은 다른 최상위 필드를 거부하고 저장된 문단·입력·조건·결과를 상속한다.
앞 값은 방문 순서상 target 이전의 해설에서만 가져오며 미래 노드의 값은 사용하지 않는다.
상세 생성 응답은 `exampleInputs`를 해설 전에, `exampleResult`를 해설·근거 뒤에 작성해
계산하기 전에 결과를 추측하는 모순을 줄인다. Host는 기존 portable `example` 계약으로
정규화하며 두 형태를 섞은 응답을 거부한다. 직접 Boolean의 고정 JSON 값과 Kotlin의
null 선택을 검사하고, partial 결과는 `null`을 요구한다. 수정/optional/nullable/alias Boolean
입력을 단순한 false로 고정하지 않는다. 숫자 결과의 의미 정확성은 이 구조 검사의 범위 밖이다.
로컬 primary 생성은 `{name, value}`의 실제 JSON 입력을 사용하고 provider adapter에서
`{name, json}` 문자열 계약으로 인코딩한다. Python 객체·배열 표기를 JSON 문자열로 반환하는
실패를 방지하며 기존 크기·깊이·유한 숫자·금지 key 검사를 유지한다. node/call 및 connected
모델의 계약은 변경하지 않는다. grammar의 generic JSON 값과 non-null union은
[llama.cpp의 JSON Schema 지원 범위](https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md)를
따르며 Host 검증을 대신하지 않는다.
고정 source 식이 포함된 JSON grammar도 0600 임시 파일로 전달하고 source를 argv에 넣지 않는다.
cache는 owning surface/root의 수명에 속하고 새 snapshot 또는 disposal에서 해제한다.
주변 상수/helper까지 content identity에 포함한다. 확장이 백그라운드 모델을 유지하지 않는다.

### 정적 근거와 LLM 문장의 경계

`buildFunctionNarrativeContext(node, source, helpers, analysis?)`는 같은 source snapshot의
기존 Function Logic을 받아 optional source route를 붙인다. source excerpt는 같은 identity·파일의
parser-owned `sourceRange`를 재사용한다. native
graph의 선언 줄 범위 때문에 본문이 사라지지 않으며 추가 파싱이나 인접 함수 범위 추측은 없다.
기존 snippet 문자·줄·tail 예산은 유지한다. `buildFunctionNarrativeSourceFlow`
는 언어별 parser를 다시 실행하지 않고 최대 3개 route, depth 24, 탐색 128회, 출력 4,000자로
투영한다. 옵션의 depth/path/character 상한은 각각 48/3/6,000이다. 첫 return/throw에서
멈추며 route별 visited set과 duplicate edge 제거를 사용한다. callback 정의·deferred route,
embedded/unknown/try boundary는 실제 현재 함수의 실행으로 합치지 않는다. 생략된 source나
cycle은 미완성 prefix로 남긴다. exact/inferred를 유지하며 `source-terminal`도 입력 도달이나
실제 실행을 증명하지 않는다. Kotlin의 symbolic-only 한계는 그대로 유지한다.
같은 줄에서 중복된 predicate 문자열이 있어도 실제 제공한 열 범위 밖의 구문을 인용하지 않는다.

`addFunctionNarrativeValueGrounding(context, model)`은 이미 만든 Tutor IR에서 직접
conditional/binary definition을 최대 6개, 기존 complete primitive static check를 최대
3개 가져온다. record 합계는 2,000자다. source가 없는 구문, nested/deferred write,
외부 caller 값, inferred 연결, partial/unknown 계산은 공유하지 않는다. 추가 source read,
모델 호출, input search나 프로젝트 코드 실행을 하지 않는다. required Boolean의 정확한
direct predicate는 `enabled = false`처럼 matching 입력으로 정규화한다. 명시적 primitive type만
사용하며 optional/nullable/alias type은 원래 predicate 선택을 유지한다. undefined나 null을
false와 같다고 단정하지 않는다.
checked example은 entry를 제외한 계산 경로의 모든 구문이 제공한 root source에 있어야 한다.

`context.limited`는 source excerpt가 실제 생략됐는지만 뜻한다. 분석 경로의 한계는
`sourceFlow.limited`, fact/check 예산에서 제외된 추가 record는 `groundingLimited`로 구분한다.
Kotlin의 symbolic 계산 한계가 있어도 본문 전체를 제공했다면 코드 생략 안내를 표시하지 않는다.

새 전체 분석은 `scenarioGraph`의 모든 acyclic 분기 조합을 lazy iterator로 열거한다.
재귀나 전체 경로 목록을 만들지 않고 stack·경로별 visited set·depth guard를 사용한다.
loop는 건너뛰기, 한 번의 symbolic body/continue, 재방문 후 exit, break 경로로 추상화한다.
반복 횟수의 모든 조합이나 실제 도달 가능성을 증명하지 않는다. 예외/추론 edge의 confidence를
유지하며 unsupported/cycle/depth/missing-source는 별도 partial 경로로 남긴다. 생략한 source나
partial 경로는 전체 발견 결과를 처리했더라도 추가 경로 가능성 안내를 표시한다.
모델에는 graph 전체 대신 현재 묶음의 경로만 전달하고, 이전의 최대 3개 sourceFlow preview는
이 새 분석의 전체 개수를 제한하지 않는다. 총 경로가 많으면 오래 걸릴 수 있으며 사용자가 취소한다.

`buildFunctionNarrativeScenarioFrames`는 새 `scenarioBatch`의 모든 경로에 고정 slot을 제공한다.
implicit exit·partial·inferred 경로도 각각 유지하고 모든 분기 조건을 순서대로 고정한다.
200자보다 긴 조건/loop 본문은 fixed when에 `root L174–180: iterate` 같은 소스 줄 참조와
선택을 기록한다. 전체 구문은 sourceFlow와 numbered snippet에 유지한다. 많은 조건이
portable when 상한을 넘으면 모든 조건을 줄 참조로 압축하고 순서·선택을 그대로 보존한다.
그래도 한도에 들어가지 않으면 `context-too-large`를 반환하며 조건을 잘라 완료로 처리하지
않는다. batch 없는 이전 context에서는 complete exact return/throw route 또는 complete
static example의 조건·terminal·소스 위치를 고정한다. 로컬 grammar의 각 scenario slot은
그 `when`, `outcome`, 허용된 source enum을 그대로 생성한다. VS Code 연결 모델에는 같은
frame을 지침으로 전달한다. Host parser가 응답 개수·순서·고정 필드·source 소유권을 다시
검증하며 다른 route의 반환값이나 소스로 바꾸면 응답을 거부한다. 검증한 frame의 `title`은
조건을 ` · `로 연결한 최대 160자이며 조건이 없으면 terminal을 사용한다. 응답 검증 후 Host가
이 제목을 적용하므로 모델 제목이 반대 분기를 이름 붙이지 못한다. 전체 조건은 근거에 남긴다.
이 표시용 제목은 provider 입력에 추가하지 않으며 기존 prompt와 grammar를 유지한다.
`summary`, `explanation`, 단계의 `text/reason/effect`는 모델 문장을 그대로 보존한다.
이 문장에는 오류가 남을 수 있다. batch 없는 이전 implicit exit, partial/inferred context는
모델 제목을 포함한 기존 자유형 응답을 사용한다.

로컬 schema는 설치한 runner revision의
[tuple items 및 const/enum 구현](https://github.com/ggml-org/llama.cpp/blob/b29c606e2/common/json-schema-to-grammar.cpp)을
사용한다. 실제 Qwen2.5-Coder 1.5B 응답에서 고정 field와 source enum이 유지되는 것도 확인했다.
출력 field는 기존 narrative 계약을 유지하며 같은 UI·native hover·소스 버튼을 사용한다.

## 로컬 검증 모델

새 검증 모델은 공식 [Qwen3.5-4B](https://huggingface.co/Qwen/Qwen3.5-4B)의
[Unsloth Q4_K_M GGUF](https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/tree/e87f176479d0855a907a41277aca2f8ee7a09523)다.
revision `e87f176479d0855a907a41277aca2f8ee7a09523`, 파일 `Qwen3.5-4B-Q4_K_M.gguf`,
2,740,937,888 bytes, SHA-256 `00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4`를
확인했다. 이 PC의 llama-completion 0.4.1/build 10964(`b29c606e2`)에서 text-only ChatML,
Jinja 끄기와 reasoning 끄기로 실제 추론했다. 현재 runner의 Qwen3.5 Jinja tool-template probe는
추론 전에 실패하므로 `Qwen3.`/`Qwen3-`로 시작하는 모델 파일명에 이 호환 옵션을 적용한다.

마켓 설치에는 모델이 포함되지 않는다. llama.cpp 실행 도구를 미리 설치하고 첫 **전체 시나리오
분석**을 요청하면 위 고정 revision의 GGUF를 자동 다운로드해 SHA-256을 검증한다.
다운로드는 확장 global storage에 보관하며 git과 VSIX에 넣지 않는다.
기존 `projectAnalyzer.functionNarratives.localModel` 파일이 있으면 그대로 사용한다.
이 PC에 이미 있던 비교용 모델은 `.local-models/`에 보관하며 git과 VSIX에서 제외한다.

0.0.1107까지 이 PC의 사용자 설정은 공식 [Qwen2.5-Coder-1.5B-Instruct-GGUF](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF)의
Q4_K_M 파일을 사용했다. 모델은 `.local-models/`에 별도로 보관하며 git과 VSIX에서 제외한다.
revision `f86cb2c1fa58255f8052cc32aeede1b7482d4361`, 1,117,320,768 bytes,
SHA-256 `cc324af070c2ecbfd324a30884d2f951a7ff756aba85cb811a6ec436933bb046`를 확인했다.
실제 Kotlin/한국어 추론과 source range 검증은 약 2.9초에 완료했다. 이 값은 작은 QA 함수 한 번의
측정이며 일반적인 속도를 보장하지 않는다. 작은 모델은 상수로 제외되는 경로도 가정 없이 설명할
수 있으므로 근거 줄과 정적 경로를 함께 검토해야 한다.

0.0.1103의 별도 비교에는 공식 [Qwen2.5-Coder-3B-Instruct-GGUF](https://huggingface.co/Qwen/Qwen2.5-Coder-3B-Instruct-GGUF)의
Q4_K_M을 사용했다. revision `f74adce6aa16316c625447af059dbebe4983757c`,
2,104,932,800 bytes, SHA-256
`724fb256bec1ff062b2f65e4569e871ad2e95ab2a3989723d1769c54294730b7`을 확인했다.
두 모델 모두 `.local-models/`에 보관하며, 비교를 위해 사용자 설정을 바꾸지 않았다.

## 0.0.1117 생성 계약

로컬 adapter의 `supportsFinalSummary(signal)` capability와 `withRun(language, signal,
operation)`은 준비된 동일 provider와 request signal에 연결된다. 초기 요청은 inputs와
첫 두 source node만 읽으며 임시 문단·결과를 사용자에게 보내지 않는다. 후속 node 작업은
원래 inputs와 앞 node의 최신 모델 값 최대 8개를 이어받는다. 초기 문단·미래 결과는 모델
입력에서 제외한다. 최종 `createFunctionNarrativeSummaryTask`는 완료된 code/value trace
최대 2,000자와 생략 개수를 전달하고, terminal node가 생성한 실제 JSON result가 있으면
그 값을 보존한다. 입력·steps·알려진 result를 바꾼 summary는 거부한다. summary 실패·취소는
완료된 node를 재생성하지 않고 마지막 단계만 재시도한다. capability 없는 연결 모델의
기존 흐름은 유지한다.

Kotlin/TypeScript declaration의 명시적 primitive 반환 type은 local JSON result kind를 제한한다.
adapter에 Python primitive 반환 type이 전달된 경우에도 같은 kind 제약을 적용한다.
numeric primitive IR write도 실제 JSON 숫자로 생성한다. 식 문자열을 숫자로 바꾸거나
사용자 소스를 실행하지 않는다. return 식은 전체 연산을 설명한 다음 result 값을 쓰도록
순서를 지정한다. source에 명시된 exact literal return/write, 변경되지 않은 Boolean input guard와
변수 선언 전 상태는 구조적 source facts를 보존한다. Kotlin의 direct input Elvis lowering은
null 판단·피연산자 선택과 다음 저장을 구분하고, 단순 입력/리터럴 저장의 반복 해설은 source facts를
사용한다. 긴 source 이름 때문에 prose 상한을 넘는 const 필드는 모델이 짧게 작성하도록 둔다.
source 변수 이름이 `result`/`condition`인 실제 쓰기는 synthetic 반환/판단 값과 구별해 다음 node에
이어준다. 중첩 고정 JSON 결과는 값으로 비교하고
원래 JSON 순서를 복원한다. source가 잘렸거나 type이 alias/unknown인 경우 임의로 확정하지 않는다.

완전하고 exact한 primitive source 경로에 calls/accesses/unknown identifiers가 없을 때만
assumptions/limitations를 []로 고정한다. 입력이 양수여야 한다는 등의 없는 조건을 모델이
추가하지 못하도록 하는 좁은 source 검사다. 생략·inferred route·외부 호출·미확인 type에는
적용하지 않으며 기존 gap 설명을 유지한다. 이 검사와 JSON validation은 문장 의미나 실제
런타임의 정확성 보장이 아니다.

page scope는 scheduler 실행 슬롯을 차지하지 않는다. 다른 model/adapter 작업은 이전
프로세스 종료 후 실행한다. 비동기 저장·prompt 준비 중 취소는 idle 모델을 해제하고 다른
page owner의 lease를 보존한다. complete session 조회·저장된 page/node 읽기·source 열기는
모델 준비나 추론을 실행하지 않는다.

## 0.0.1117 실제 모델 검증

같은 Qwen3.5-4B Q4_K_M 가중치, seed 42, temperature 0.2, context 8,192, output 2,400,
CPU thread 2개로 기존 설치본과 공개 production-parser corpus를 순서대로 측정했다.
model 준비/다운로드는 제외하고 프로세스 시작과 모든 node 및 최종 summary 생성은 포함한다.
저장소는 benchmark memory map을 사용한다.

| 공개 함수 | 설치된 0.0.1116 | 0.0.1117 전체 corpus 측정 |
| --- | ---: | ---: |
| Kotlin Boolean guard + 고정값 5 대입 | 27.32초 | 15.79초 |
| TypeScript guard + 대입·복합 곱셈 | 26.06초 | 17.23초 |
| Kotlin nullable 입력 + Elvis | 26.78초 | 23.70초 |
| 합계 | 80.16초 | 56.72초 |

이 한 쌍의 측정은 약 29% 짧았다. 같은 전체 측정의 추가 Kotlin mutable arithmetic,
numeric threshold, Boolean return은 각각 20.02초, 20.64초, 12.07초였다. 여섯 함수의
12개 source 경로와 55개 node를 완료했고 최종 JSON 반환값 12/12, 현재 대입값 7/7이
독립 formula oracle과 일치했다. 선택한 경로의 대입/반환을 건너뛴다고 설명하거나 다른 구문의
text/syntax를 복사하는 좁은 검사와 없는 prerequisites 검사도 통과했다. source를 실행한 결과가 아니다.

마지막 Elvis 판단/저장 구분 후 추가 측정은 44.43초였고, 단순 복사 해설을 source facts로
보존한 최종 재검증은 17.31초였다. 두 재검증 모두 반환값 2/2, 대입값 2/2, node 10/10과
같은 검사를 통과했다. source와 모델 상태를 실제 응답으로 확인했다. 이 별도 측정 시간을
위 연속 corpus 합계에 섞지 않는다. 실행 부하·응답 길이에 따른 변동이 있으며 모든 함수나
환경에서 같은 속도 향상을 보장하지 않는다.

각 page의 연속 요청에서는 benchmark 자신의 동일 watchdog PID를 관찰했고 page 사이에는
새 PID로 바뀌었다. 완료 후 `llama-server`/watchdog 프로세스가 남지 않았다. KV cache_n이
0인 요청도 있으므로 PID 재사용과 prefix-token 재사용을 구분한다. `all` selector로 여섯 함수,
`extended`로 추가 세 함수, 이름 selector로 한 함수를 재현할 수 있다. benchmark는 경로 완료뿐
아니라 oracle/좁은 품질 검사가 실패해도 exit code 1을 반환한다.

일부 자유 문장은 null 여부를 “유효함”으로 표현하거나 중간값을 조건 값으로 부르는 등
부정확한 용어를 쓸 수 있다. source-owned facts, JSON 종류, 숫자 oracle과 위 패턴 검사는
모든 문장 의미나 외부 결과를 검증하지 않는다. 기존 LLM 추론·실제 실행 미검증 표시를 유지한다.

## 0.0.1117 설치 및 Host 검증

- 실제 native UI의 자동 모델 준비·SHA-256 확인·두 경로 생성은 성공했다. 이때 숫자는
  맞지만 거짓 if 조건을 본문 실행으로 설명하는 문장이 있었다. native deadline/progress
  adapter가 final-summary/page-scope capability를 누락한 것이 원인이었다. 두 capability를
  전달하도록 수정했고 실제 Host 경로의 scope·최종 synthesis·cache-only 회귀를 추가했다.
- 수정된 production Host에서 같은 공개 `GraphNotes.kt`와 Rust `plaintext` 분석 결과를
  재생했다. workspace 실행은 18.30초, 최종 설치 파일 실행은 23.16초였고 각 5회 모델
  요청으로 두 경로를 완료했다. false/10 → 0, true/10 → 15 예시와 node 4개·5개를
  보존했다. 마지막 문단에서 앞서 관찰한 거짓 if 본문 실행 설명은 관찰되지 않았다.
  두 저장 page 조회 및 source evidence adapter 이동 1회는 추가 추론 없이 완료됐고
  실행 뒤 모델/watchdog 프로세스는 남지 않았다. memory page store를 사용하는 Host
  실행이며 source 코드 실행이나 최종 native 버튼 조작 검증과 구분한다.
- 마지막 설치 후 native 버튼 재검증은 창 재로드 뒤 AX 상태와 실제 화면의 불일치로
  완료하지 못했다. 최종 UI 전체 검증을 주장하지 않는다. 이번 backend 변경에서
  모바일·태블릿 viewport 검증은 수행하지 않았다.
- 최종 전체 Node unit 1,053개 중 1,049개 통과. 기존 declared-type 입력 대표값 두 건,
  advanced private Scenario, decorated source-reveal 네 실패가 남았다. 한 중간 실행의
  Rust fixture 프로세스 실패는 단독 재실행에서 통과했다. 빌드 출력을 다시 만드는
  packaging과 겹친 테스트 결과는 제외하고 최종 전체 실행을 분리했다.
- packaging script 14개, compile·release metadata·diff check를 통과했다. Rust 구현은
  바꾸지 않았으며 Rust unit suite는 별도로 재실행하지 않았다.
- Default 및 `Function Language QA 1107`에 0.0.1117을 설치했다. 두 profile 등록과
  설치된 JavaScript 478개·native binary가 빌드와 일치했고 runtime closure 오류가 없다.
  VSIX는 512개 파일·압축 3.62MiB·해제 15.44MiB로 기존 상한을 통과했다.

## 0.0.1116 검증 기록

실제 설치된 0.0.1115 provider/session을 기준으로 같은 Qwen3.5-4B Q4_K_M 가중치와
seed 42·temperature 0.2·context 8,192·output 2,400 token·CPU thread 2개를 사용했다.
공개 함수 세 개를 production parser와 Tutor grounding으로 구성했다. 이전 설치본은 두 번,
최종 code/route/input 출력 보존 빌드는 한 번 측정했다. 모델 준비/다운로드 시간은 제외하고
각 함수의 모델 시작과 모든 경로·노드 생성은 포함한다. benchmark의 page store는 memory map이며
native 저장소의 disk I/O는 별도다.

| 공개 함수 | 0.0.1115 두 측정 평균 | 최종 0.0.1116 한 측정 | 요청 수 |
| --- | ---: | ---: | ---: |
| Kotlin Boolean guard + 고정값 5 대입 | 60.02초 | 26.50초 | 5 → 3 |
| TypeScript guard + 대입·복합 곱셈 | 66.17초 | 25.70초 | 5 → 3 |
| Kotlin nullable 입력 + Elvis | 69.44초 | 28.38초 | 6 → 4 |
| 합계 | 195.63초 | 80.57초 | 16 → 10 |

이전 두 측정의 합계는 각각 222.05초·169.22초였다. 최종 측정은 그 평균보다 약 59%
짧았고 경로 6개·노드 29개를 모두 완료했다. 직접 숫자 결과 5/6은 oracle과 일치했다.
나머지 TypeScript 결과는 `15 * 2 = 30`이라는 계산식이며 입력 10의 oracle 30과 수동
비교했다. 그 결과는 benchmark의 직접 숫자 점수에는 포함하지 않아 보고서에는 5/6으로 기록된다.
도달한 대입 생략·거짓 guard의 조기 반환·복사된 text/syntax는 0건이었지만, TypeScript에
거짓 guard의 참 본문 진입을 주장하는 문장 1건이 남았다. 반환값과 구문 연결의 검증을
모든 문장 의미 검증으로 취급하지 않는다. 좁은 문장 패턴 검사와 실제 응답 검토이며
대형 함수·다른 모델·다른 환경에 대한 일반적인 속도·정확도 보장은 아니다.

- `scripts/benchmark-function-narratives.mjs`로 재현한다. compile 뒤 현재 workspace 또는
  이전 설치본을 runtime root로 지정하며 source는 parser 입력으로만 읽는다. formula oracle은
  benchmark가 직접 정의한 기준이며 사용자 source를 실행하지 않는다. 보고서·원문 응답은
  0700 임시 폴더의 0600 파일에만 저장하고 source·prompt·stderr를 원격으로 보내지 않는다.
- 최종 Elvis 후속 요청에서 prefix 1,418 token 재사용을 확인했다. 다른 요청은 cache 0도
  있었으므로 모든 chunk가 warm reuse된다는 성능 보장은 하지 않는다.
  한 모델 슬롯·HTTP worker 1개·모델 CPU thread 2개를 사용했다. 측정 뒤 실제 `llama`
  프로세스는 남지 않았다. idle 정리·다른 resource로 전환 시 종료 대기·cancel 시 reap·
  parent pipe EOF 때 SIGTERM을 무시하는 자식까지 강제 종료하는 회귀 테스트가 통과했다.
- 실제 cross-file TypeScript Host의 `zero()` 호출 설명도 같은 로컬 transport로 생성했다.
  한 호출의 source binding과 한국어 해설이 `ready`로 검증됐고 인자 없는 호출의 고정
  문구를 유지했다. 이 1회 smoke 측정은 약 10.23초였으며 일반적인 call 성능 지표가 아니다.
- 최종 설치본으로 공개 `GraphNotes.kt`와 실제 Rust `plaintext` 파일 분석 결과를 재생했다.
  생산 cursor resolver가 Kotlin `total`을 찾고 실제 CodeFlow Host가 로컬 모델을 3회 호출해
  두 경로를 `ready`로 완료했다. false/100 → 0, true/100 → 105 예시는 식과 일치했고
  source 순서의 노드 4개·5개를 보존했다. memory page store를 사용한 이 Host 실행은 38.94초였다.
  두 저장 페이지 조회와 원래 반환 줄의 source evidence adapter 호출 1회는 추가 추론 없이
  완료됐다. 이후 모델 프로세스는 남지 않았다. 이는 source 코드 실행이나 실제 native 버튼
  조작 검증이 아니다. 최종 route 보정 전 native UI에서는 생성 완료와 함께 참 입력을
  조기 반환으로 잘못 설명한 응답을 확인했으며, 마지막 UI 재실행은 다른 창으로 전환되어
  완료하지 못했다. 이번 backend 변경에서 새 viewport visual QA는 수행하지 않았다.
- 기본·`Function Language QA 1107` 프로필의 버전 등록은 0.0.1116이다. 설치된 JavaScript
  478개와 native binary가 최종 빌드와 일치하고 runtime closure 오류는 없다. VSIX는
  512개 파일·압축 3.61MiB·해제 15.40MiB로 기존 패키지 상한을 통과했다.
- 전체 Node unit 1,038개 중 1,034개 통과. 기존 declared-type 입력 대표값 두 건,
  advanced private Scenario, decorated source-reveal 네 실패는 그대로다. 새 wire·prefix·
  primitive input·resource lifecycle·socket auth·watchdog 회귀 13개가 모두 통과했다.
  패키징 script 14개, compile·release metadata·diff check도 통과했다. Rust 구현은
  바꾸지 않았으며 Rust unit suite를 별도로 재실행하지 않았다.
  code/input 출력 유지 보정 후 전체 1,038개를 다시 실행했으며 같은 기존 실패 네 건만
  남았다. 마지막 route 출력 유지 보정 후 관련 회귀 19개도 통과했다.

이 변경은 model weights를 학습하거나 교체하지 않는다. 고정 source metadata를 공급하는
Host와 내용을 쓰는 LLM의 역할을 구분하며 source/route/입력 검증을 완화하지 않는다.
기존 모델 의미 오류와 미지원 source/type/external 결과의 한계는 남아 있다. Windows와
companion이 없는 환경은 CLI fallback을 유지하며 위 서버 측정의 속도를 보장하지 않는다.

## 0.0.1115 검증 기록

- 기본·`Function Language QA 1107` 프로필에 0.0.1115를 설치했다. 설치된 JavaScript
  474개와 native binary가 빌드 출력과 일치하며 두 프로필의 버전 등록과 runtime closure를
  확인했다. VSIX는 508개 파일, 압축 3.60MiB·해제 15.37MiB로 패키지 상한을 통과했다.
  개발 도구의 `.impeccable` 캐시와 모델 가중치는 패키지에 포함하지 않는다.
- 공개 fixture `src/test/fixtures/functionNarrativeGraphNotesQaWorkspace/GraphNotes.kt`를
  실제 설치된 VS Code에서 분석했다. 자동 모델 준비 설정으로 기존 Qwen3.5-4B Q4_K_M
  캐시의 무결성을 확인했고 조기 반환·계산 경로 두 개가 모두 완료됐다. 준비 1회와 추론
  5회가 정상 종료됐으며 준비를 포함한 이번 작은 함수의 실행은 약 65초였다. 새 다운로드나
  설정 변경을 하지 않았고 이 단일 측정으로 일반적인 속도나 정확도를 보장하지 않는다.
- native 시나리오 1과 2에서 각각 해당 경로의 번호·노트·예시값을 확인했다. 저장된 두 번째
  페이지로 전환한 뒤에도 모델 작업은 완료 상태였다. 노트의 조건 줄·반환 줄 소스 버튼은
  기존 source protocol로 원본 편집기를 열었고 이후 추론 요청은 추가되지 않았다.
  완료 후 `llama` 실행 프로세스가 남아 있지 않았다.
- 이전에 실제 Qwen 모델이 생성한 공개 Kotlin `inspect` 응답 5개를 production HTML에
  재생해 Safari에서 확인했다. 이 fixture의 Host 응답은 재생용이며 새 추론은 아니다.
  세 저장 페이지의 노트가 시나리오 1부터 5까지 각각 4/5/6/7/7개 anchor로 바뀌었다.
  명시적 선택·그래프 표시·소스 열기·한영 전환이 추가 생성 없이 동작했고 UI 언어를
  영어로 바꿔도 한국어 모델 원문과 생성 언어 표시를 유지했다.
- CSS viewport 390×844, 768×1024, 1440×900의 실제 화면과 접근성 트리를 확인했다.
  모바일에서 전체 노트 본문을 펼치고 번호 이동·숨기기 후 선택한 소스 노드 복귀를
  확인했다. 확대율은 100%를 유지했고 계측된 가로 overflow와 브라우저 오류는 없었다.
  오류 안내와 부분 완료 후 대기·취소는 별도의 합성 Host 응답으로 확인했다. 취소 뒤에도
  완료된 4개 anchor·3개 상세 노트가 보존됐고 추가 분석 요청이 발생하지 않았다.
- 전체 Node 테스트 1,025개 중 1,021개 통과. 기존 declared-type 입력 대표값 두 건,
  advanced private Scenario, decorated source-reveal 실패 네 건은 0.0.1114와 같다.
  새 노트 테스트는 경로/복합 identity·반복 방문·literal text·원본 index·시나리오 권한·
  disposal·언어·60개 노트의 상세 DOM 40개 상한·touch scroll·단일 Tab 진입을 포함한다.
  패키징 script 14개, compile, release metadata와 diff check도 통과했다. Rust 구현은
  변경하지 않았으며 Rust unit suite를 별도로 재실행하지 않았다.
- 새 노트 모듈·뷰포트·해설 renderer 범위의 Impeccable 기계 검사 결과는 빈 배열이었다.
  최종 hook의 기존 graph-node `side-tab` 지적은 별도로 검토했다. 해당 테두리는 commit
  `c1f3407`부터 종류별 의미색을 표시하며 DESIGN.md의 기존 graph token 유지 원칙에 따른다.
  UI는 유지하고 `functionLogicGraphStyles.ts`의 해당 규칙만 공유 검사 예외에 등록했다.
  수동 UX/접근성 검토에서 버튼·disclosure·
  focus·overflow·기존 테마 token 사용을 확인했다. 실제 터치 장치와 light/forced-colors
  테마의 시각 검증은 하지 않았다. touch event 동작은 단위 테스트로 검증했다.

모델이 활성 경로의 조건이나 대입을 실행되지 않는다고 설명하는 의미 오류도 관찰했다.
그래프 노트는 저장된 모델 해설을 보여 주며, 형식·소스 연결 검증을 내용의 사실성이나
실제 실행 검증으로 취급하지 않는다. 모든 노트의 기존 미검증 표시를 유지한다.

## 0.0.1114 검증 기록

실제 신고된 Python 함수의 native 요청을 재현했다. 실행기가 `enum: []`를 거부하여 모델을
불러오기 전에 종료했고, native graph의 선언 줄 범위 때문에 본문이 입력에서 빠져 있었다.
본문 복원 뒤에는 모델이 예시 객체·배열을 Python 표기로 반환해 JSON 입력 검증에 실패하는
문제도 확인했다. 빈 경로의 code 생략, 기존 parser 범위 재사용, 로컬 JSON value 인코딩으로
세 원인을 수정했다. 경로·인용·입력 검증을 완화하거나 자동 재시도를 추가하지 않았다.

- 최초 실패 native 입력을 그대로 재생한 빈 partial 경로는 수정된 grammar에서 모델 실행과
  응답 검증을 통과했다. 다음으로 생산 Rust graph와 실제 신고 함수의 전체 본문을 사용한
  Host 검증에서 첫 두 시나리오의 모든 노드가 완료됐다. 그 뒤 일부 노드까지 총 19회 추론이
  정상 종료·검증됐다. 임시 CLI QA는 이후 진행 중인 자식 프로세스만 수동 종료했다.
- 설치한 기본 VS Code 0.0.1114를 해당 창에서 Reload Window한 뒤 같은 함수를 다시 분석했다.
  CFG 22블록·28연결을 유지했고, 한국어 시나리오·예시 입력·구문 해설이 실제 화면에 표시됐다.
  취소 버튼으로 종료한 뒤 완료 문장과 입력 예시, 이어서 분석 버튼이 보존됐다. native 로그의
  준비 작업과 완료 추론에 기존 `exit-1` 실패는 없었다.
- 전체 unit 1,019개 중 1,015개 통과. 신규 회귀 6개를 포함하며 기존 declared-type 입력
  대표값 2개, advanced private Scenario, decorated source-reveal 실패 4개는 그대로다.
  패키징 script 14개, compile, release metadata 및 diff check도 통과했다. Rust 구현은
  변경하지 않았으며 Rust unit suite를 별도로 재실행하지 않았다.
- VSIX는 504개 파일, 압축 3.59MiB·해제 15.35MiB로 기존 상한을 통과했다. 기본·
  `Function Language QA 1107` 프로필의 manifest는 0.0.1114이며, 설치 런타임 JS 470개와
  native binary가 빌드 출력과 일치하고 runtime closure 오류는 없다.

실제 신고 함수의 28개 경로 전체가 완료됐다는 검증은 아니다. native UI는 접근성 트리와
실제 생성·취소 상호작용으로 확인했으며 이번 backend 수정에서 새 viewport visual QA는
실행하지 않았다. 부정 조건을 반대로 설명한 모델 문장도 관찰했다. 형식·언어·인용 검증을
의미 정확성이나 실제 실행 검증으로 취급하지 않으며 기존 미검증 표시를 유지한다.
실제 소스·prompt·응답·runner stderr는 로컬 0600 QA 파일에만 두고 저장소·VSIX에 포함하지 않았다.

## 0.0.1113 검증 기록

- 실제 설치본의 Kotlin 함수에서 기존 Qwen3.5 모델 로드와 시나리오 3개 생성까지 확인했다.
  사용자가 알려준 단독 요청의 공통 `failed` 오류는 이 함수에서 재현하지 못했다.
  따라서 특정 실패의 원인을 대기열 충돌로 단정하지 않는다. 새 종료 이력과 controlled
  runner 분류는 재발 시 입력·메모리·로드·옵션·문법·종료 단계를 확인할 수 있게 한다.
- 최신 production Host, 정적 parser/graph, source registry, configured provider와 실제 PC의
  GGUF/`llama-completion`으로 TypeScript 호출·Kotlin 전체 Guide·Kotlin 호출을 함께 요청했다.
  실제 모델 요청 3회가 모두 구조·언어 검증을 통과하고 34.05초에 끝났다. adapter 실행과
  OS에서 관찰한 모델 프로세스는 최대 1개, 최대 대기 수는 2개였다. 대기 취소는 실행하지
  않았고 캐시 재조회는 준비/추론/종료 이력을 추가하지 않았다. 추가 다운로드는 없었다.
  이 검증의 외부 VS Code API port만 대체했으며 실제 모델 응답과 Host 검증은 대체하지 않았다.
- FIFO, 대기 취소, 실행 시작 이후 deadline, 종료까지 슬롯 유지, 실패 후 다음 요청,
  32개 이력/대기 상한, 불변 snapshot, malformed progress, mixed Guide/call fairness,
  local PID 종료 및 SIGTERM 무시 시 SIGKILL 정리, controlled stderr 분류/원문 비보관,
  connected API/stream stall과 best-effort stream close를 테스트했다.
  완료 Guide 캐시가 다른 함수의 pending 작업을 취소하지 않는 회귀도 포함한다.
- 최종 `npm test`의 Rust 82개는 통과했다. Node 1,013개 중 1,009개 통과,
  실패 4개는 이전 0.0.1112에서 확인된 declared-type 입력 두 건,
  advanced private Scenario 평가, decorated source reveal architecture 항목이다.
  수정한 모델 작업·응답·Host·browser·native UI port 테스트에는 새 실패가 없다.
  release metadata와 패키지 script 테스트 14개도 통과했다.
- Safari에서 최신 production renderer를 390×844, 768×1024, 1440×900 iframe으로
  각각 확인했다. 대기·실행·실패와 재시도, keyboard Enter 재시도/취소,
  완료 문단을 유지한 partial+queued 및 취소 상태를 Guide와 호출 화면에서 확인했다.
  각 크기의 문서 overflow는 false였고 replay의 JavaScript 오류는 없었다.
  이 화면 검증은 공개 fixture의 이전 실제 모델 응답을 재생하고 큐 상태를 합성한 것이다.
  위의 실제 동시 모델 검증과 구분한다. 물리 모바일 기기/touch gesture는 검사하지 않았다.
- 기본/QA 프로필에 설치하고 469개 shipped JavaScript와 native binary가 빌드와 같은지,
  각각 정확히 하나의 0.0.1113 등록을 갖는지 확인했다. native Command Palette에서
  **Code Flow: Model Tasks** 노출을 실제 확인했다. native empty/live Quick Pick·취소·focus·
  locale·종료 이력은 VS Code API port 테스트로 확인했다. 사용 중인 VS Code 창이 전환되어
  도구가 추가 UI 동작을 거부했으므로 native 목록의 전체 실화면 검증은 완료하지 못했다.
  임시 제한 모드 창은 닫았고 workspace trust나 기존 모델 설정을 바꾸지 않았다.
- 최종 darwin-arm64 VSIX는 503개 파일로 512개 상한 안에 있다. compiled runtime closure와
  native target 검사가 통과했고 가중치와 검증 중 기록한 원문/응답은 패키지에 포함하지 않았다.

### 변경 화면의 UI audit

`ui-design-workflow`의 기존 제품 변경 절차와 Impeccable scoped audit를 적용했다.
`browserSource.ts`, `readingBrowserSource.ts`, `modelTasks/nativeUi.ts`의 detector 결과는
finding 0개였으며 동적 browser source는 직접 검토했다. 다음 점수는 변경 영역에 대한
검토이며 제품 전체 WCAG 인증이나 모든 테마/device 검증을 뜻하지 않는다.

| 영역 | 점수 / 4 | 확인 근거와 남은 범위 |
| --- | --- | --- |
| 접근성 | 3 | 기존 semantic 버튼, polite live region과 focus 유지. 실제 Enter 재시도/취소. 대비 수치 전수 검사는 미실시. |
| 성능 | 4 | `working`은 상태 text만 갱신. 기존 문단 DOM 유지 테스트, 32개 queue/history와 기존 모델 상한. |
| 반응형 | 3 | 두 화면의 세 viewport에서 overflow 없음. 모바일 실기기/touch 미검증. |
| 테마 | 3 | 기존 VS Code token/native component 유지. 실제 dark theme 확인, light/high-contrast 실화면 미검증. |
| 구현 일관성 | 4 | source-free protocol, request/task 상관관계, 기존 상태 영역과 native Quick Pick 사용. 새 dependency/스타일 체계 없음. |
| 합계 | 17 / 20 | 변경 영역에서 P0/P1 finding 없음. native 목록 실화면 확인 범위는 위 기록을 따른다. |

[Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md)를
새로 읽고 변경 파일의 live 상태 알림, button semantics, focus, long text, locale 및 오류 다음
행동을 검토했다. 발견한 높은 우선순위의 접근성/UX 문제는 없었다. `nativeUi.ts`의 시간을
초 단위로 보여주는 고정 `toFixed(1)`은 두 locale에서 동일한 기술 단위로 사용한다.

## 0.0.1112 검증 기록

- 자동 준비한 Qwen3.5-4B Q4_K_M와 실제 `llama-completion`으로 production 호출 Host,
  언어별 parser, source token/evidence registry, configured local provider를 연결했다.
  기존 GGUF 캐시를 재사용했고 추가 네트워크 요청은 0회였다. TypeScript의 구조와 선택
  경로는 각각 준비/캐시 확인 1회, Kotlin의 구조는 준비/캐시 확인 1회였다. VS Code 설정과
  native 진행 알림 API만 QA port로 대체했다. 이번 검사는 전체 가중치를 다시 받지 않았다.

  | 소스 / 해설 언어 | 완료한 호출 해설 | 실제 모델 호출 | 전체 소요 시간 |
  | --- | --- | ---: | ---: |
  | TypeScript / 영어 | 구조 3/3·2페이지 + 선택 경로 2/2·1페이지 | 4 | 73.123초 |
  | Kotlin / 한국어 | 구조 3/3·2페이지 | 3 | 36.575초 |

  작은 fixture 각 1회 측정이다. 다른 파일에서 `addFee`의 `value + 5`와 `double`의 `value * 2`
  원문이 실제 입력에 포함되고, 정적 대상·confidence·순서·조건은 모델 생성 후에도 동일했다.
  마지막 구조 요약은 모든 호출 해설이 끝난 뒤 실제 대상 원문과 이전 해설을 함께 읽었다.
  정적 화면 로드, 완료 결과/페이지 재조회는 모델 준비와 추론을 만들지 않았다.
- 실제 Kotlin 응답이 `zero()`에 `enabled` 인자를 넘기는 것으로 잘못 설명해 parser가
  확인한 명시적 인자 목록을 입력에 추가했다. 확인된 빈 목록의 입력 문구는 정적 계약으로
  고정하고 다른 설명은 거부한다. 최종 실제 응답과 화면은 인자 없음 문구를 사용했다.
  문장 전체의 의미는 검증하지 않는다. 최종 Kotlin `double` 해설에도 `!enabled`가 거짓일
  때 호출되지 않는다는 잘못된 도달 설명이 남았고, limitations에는 지시 문구 반복이 있었다.
  조건 표시는 원래 정적 결과를 유지하며 **LLM 추론 · 실제 실행 미검증**을 함께 표시한다.
- production Function Visualizer HTML과 실제 기록한 해설을 Safari에서 재생했다.
  TypeScript를 390×844·1440×900, Kotlin을 390×844·768×1024에서 검사했다.
  호출 순서/관계 전환, 구조·선택 경로·개별 호출의 생성 버튼, native select의 키보드 선택,
  locale 변경 후 생성 언어/설명 보존, 캐시 다음 페이지, source 메시지, 좁은 화면의 상세
  줄바꿈을 확인했다. 검사한 화면에 가로 overflow와 계측된 JavaScript 오류는 없었다.
  초기 상태의 빈 페이지 버튼, 요약 상한에서 끊긴 문장, 미번역 confidence를 수정한 뒤
  다시 확인했다. 준비/다운로드 실패/부분 완료 후 취소와 재시도·이어서 생성 버튼은
  synthetic Host fixture로 검사했다. 취소 후 완료된 해설은 유지됐다.
  브라우저 생성 버튼은 실제 모델을 다시 실행하지 않는 replay adapter다. 개별 호출 UI는
  구조 응답의 해당 호출을 재사용하고, 개별 호출의 실제 요청 범위는 Host 통합 테스트로
  확인했다. source 버튼은 메시지만 기록했으며 native editor reveal, 대상 함수 흐름의
  후속 분석, VS Code 다운로드 알림의 시각 검증을 대신하지 않는다.
- Impeccable detector는 변경한 호출 renderer 범위에서 지적 사항을 반환하지 않았다.
  [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md)로
  native button/select, label, 의미 있는 `dl`, polite 상태 안내, focus 복구, locale/literal
  출력, hidden 상태와 overflow를 코드 검토했다. 점수는 변경 범위의 기술적 점검이다.

  | 차원 | 점수 / 4 | 근거와 검증 한계 |
  | --- | ---: | --- |
  | 접근성 | 3 | label·의미 구조·focus 확인; 전체 키보드/스크린리더/대비 계측 미완료 |
  | 성능 | 3 | 요청당 2개 호출·선택한 상세 1개·bounded 캐시; heap/CPU 정량 측정 없음 |
  | 테마 | 3 | 기존 VS Code 색상·폰트·focus 토큰; 전체 테마 대비 미검증 |
  | 반응형 | 3 | 세 viewport의 긴 문장과 상태 확인; 실제 터치/큰 글자 미검증 |
  | 구현 일관성 | 4 | 기존 호출 UI·provider·typed source 계약 재사용; detector 지적 없음 |
  | 합계 | **16 / 20** | 검사한 변경 범위에 한정하며 WCAG 인증이 아님 |

- 최종 전체 TypeScript 테스트 998개 중 993개가 통과하고 5개가 실패했다. 기존
  Function Guide declared-type 대표값 2개, advanced private Scenario, decorated
  source-reveal의 실패 4개와 로컬 프로세스 최초 기동 시간 테스트 1개다. 실제 추론이
  끝난 뒤 호출 해설/production Webview/Kotlin 인자/local provider의 관련 테스트 15개를
  다시 실행해 모두 통과했으며 프로세스 기동·종료 순서 테스트도 통과했다.
  별도 호출/순서/언어 기능·architecture 테스트 50개, Rust 82개, 패키징 script 14개도
  통과했다. compile, release metadata, diff check를 완료했다.
- 처음 만든 VSIX는 528개 파일로 512개 상한을 초과했다. 확장 진입점에서 도달하지 않는
  기존 런타임 출력 34개를 패키지에서 제외하고, 포함한 모듈의 정적 상대 `require` 의존성
  검사를 추가했다. 소스/테스트와 기존 파일 수·byte 예산은 유지했다. artifact-only CI
  검사는 플랫폼별 컴파일 출력 없이 기존 ZIP 경계를 검사한다.
- 최종 0.0.1112 darwin-arm64 VSIX는 494개 파일, 압축 3.57 MiB·해제 15.30 MiB다.
  기본 및 `Function Language QA 1107` 프로필에 설치하고 등록 버전과 런타임 460개의
  빌드 출력 byte 일치, native analyzer byte 일치를 확인했다. 기본 프로필의 기존 GGUF
  설정과 QA 프로필의 자동 다운로드 설정을 유지했다. 모델 가중치는 패키지에 포함하지
  않는다. QA용 Safari 탭과 서버를 닫았다. 설치 후 열린 native VS Code 창을 다시
  불러온 시각 검증은 수행하지 않았다.

## 0.0.1111 검증 기록

- 자동 준비한 Qwen3.5-4B Q4_K_M와 실제 `llama-completion`으로 production Host,
  source graph, local provider, page store를 함께 검증했다. 두 실행 모두 준비 1회,
  모델 캐시 확인 1회, 추가 네트워크 요청 0회였다. 기존 체크섬 검증 캐시를 재사용했으며
  이번 기록은 2.74 GB 전체 다운로드를 다시 수행한 기록이 아니다.

  | 소스 / 해설 언어 | 완료 경로 / 저장 페이지 | 실제 모델 호출 | 전체 소요 시간 |
  | --- | ---: | ---: | ---: |
  | TypeScript / 영어 | 2 / 2 | 5 | 88.620초 |
  | Kotlin / 한국어 | 3 / 3 | 10 | 171.057초 |

  작은 fixture 각 1회 측정이며 일반적인 성능이나 정확도를 보장하지 않는다.
  TypeScript는 조기 반환과 `(amount + 5) * 2`, Kotlin은 조기 반환과
  `(amount ?: 10) + 5`를 갖는다. Boolean/null 선택, 예시 최종값, 도달 node ID 순서,
  구문 해설 유무와 이전 지역값을 사용하는 반환 노드를 확인했다. 캐시 페이지 조회는
  추가 추론을 만들지 않았다. VS Code 설정·진행 알림 API는 QA port로 대체했다.
- 실제 검증 중 Kotlin의 non-null 입력에 기본값까지 더하는 오류와 미래 반환값을
  조기 노드에 재사용하는 문제를 발견했다. 입력부터 결과까지의 생성 순서, 원문 Elvis와
  lowered predicate 구분, bounded 이전 상태 전달을 보강한 뒤 최종 예시 결과는 통과했다.
  문장 전체의 의미 정확성을 증명하지는 않는다. 최종 Kotlin 응답에도 Elvis를 비교/삼항
  연산자로 부르거나 거짓인 분기들을 모두 참이라고 요약하는 표현이 남았다. TypeScript의
  일부 구문 설명은 일반적인 지시 문구를 반복했다. 이 결과는 정적 증명이나 실행 관찰이
  아니며 원문과 **추론 · 실제 실행 미검증** 표시를 함께 보여준다.
- production Function Visualizer HTML과 실제 생성 응답을 Safari에서 재생했다.
  TypeScript를 390×844·1440×900, Kotlin을 768×1024에서 확인했다. 경로별 설명 목록,
  좁은 화면의 줄바꿈, 선택한 노드의 원문/구문/값 변화 표, native select와 focus ring,
  페이지 선택, 그래프 선택, source 요청, locale 및 편집값 보존을 확인했다. 검사한 화면에
  가로 overflow와 계측된 JavaScript 오류는 없었다. 시나리오·노드·source 조회는 이미
  저장된 결과를 사용하며 새 분석 요청을 만들지 않았다.
  준비 중 안내/취소, 다운로드 오류/재시도, 부분 완료 후 취소/완료 결과 보존은 synthetic
  Host fixture로 검사했다. native VS Code 다운로드 알림이나 editor source reveal의
  시각 검증을 대신하지 않는다. Values 편집 후 Guide 재개방은 Safari QA adapter가
  후속 insight 메시지를 모두 구현하지 않아 end-to-end 완료를 주장하지 않는다.
- Impeccable detector는 변경한 renderer 범위에서 지적 사항을 반환하지 않았다.
  의미 있는 `dl`, native button/select, table caption/header, VS Code 색상/폰트/focus
  토큰, 한 페이지 렌더링, bounded node cache와 동일 DOM 보존을 점검했다.
  최신 Web Interface Guidelines로 label·상태 안내·locale·literal 출력·overflow를
  코드 검토했다. 아래 점수는 이번 변경과 검사한 화면 범위의 기술적 점검이며
  WCAG 적합성 인증이 아니다.

  | 차원 | 점수 / 4 | 근거와 검증 한계 |
  | --- | ---: | --- |
  | 접근성 | 3 | 의미 구조·label·focus 확인; 전체 키보드 경로/스크린리더/대비 계측 미완료 |
  | 성능 | 3 | 한 페이지·2개 노드 요청·캐시 재사용; renderer heap/CPU 정량 측정 없음 |
  | 테마 | 3 | 기존 VS Code 토큰 재사용; 모든 테마의 실제 대비 검증 없음 |
  | 반응형 | 3 | 세 viewport와 긴 문장 확인; 실제 터치/큰 글자 설정 미검증 |
  | 구현 일관성 | 4 | 기존 Guide 구조·typed source 계약 유지; detector 지적 없음 |
  | 합계 | **16 / 20** | Good, 검사 범위에 한정 |

  변경 UI에서 확인한 P0/P1/P2/P3 결함은 0개다. 위 모델 문장의 의미 오류는 별도의
  알려진 추론 한계이며 UI 감사 통과로 해소됐다고 취급하지 않는다.
- TypeScript 전체 테스트 987개 중 983개가 통과했다. 기존 Function Guide declared-type
  대표값 2개, advanced private Scenario, decorated source-reveal의 실패 4개는 남아 있다.
  마지막 prompt 변경 뒤 rich reading/configured provider/local provider/Host integration
  테스트 21개를 다시 실행해 모두 통과했다. 이전 상태 전달·terminal 재해석·부분 결과·
  캐시만 사용하는 조회·다운로드 회귀를 포함한 기능 테스트 54개, Rust 82개와 패키징
  script 13개도 통과했다. typecheck와 compile을 완료했다.
- 0.0.1111 darwin-arm64 VSIX는 512개 파일, 압축 3.62 MiB·해제 15.46 MiB로 기존
  패키지 상한을 통과했다. 기본 및 `Function Language QA 1107` 프로필에 설치하고
  양쪽 등록 버전과 런타임 파일 478개의 빌드 출력 byte 일치를 확인했다. 기본 프로필의
  기존 GGUF 설정과 QA 프로필의 자동 다운로드 설정을 유지했다. release metadata와
  diff check도 통과했다. QA용 Safari 탭·서버를 닫았고 `llama-completion` 프로세스는
  남아 있지 않았다. 설치 후 열려 있던 native VS Code 창을 재로드한 시각 검증은
  수행하지 않았다.

## 0.0.1110 검증 기록

- 자동 다운로드한 Qwen3.5-4B Q4_K_M와 실제 `llama-completion`으로 아래 응답을 검증했다.
  모델 준비와 캐시 확인은 실행별 한 번이며 각 실행의 추가 네트워크 요청은 0회였다.
  Kotlin 분류 함수는 5개 경로 전체와 3개 저장 페이지를 만들었다. 나머지 함수는
  `enabled`의 조기 반환과 `amount + 5`를 계산하는 2개 경로를 갖는다.

  | 소스 / 해설 언어 | 완료 경로 | 실제 모델 호출 | 전체 소요 시간 |
  | --- | ---: | ---: | ---: |
  | Kotlin 분류 / 한국어 | 5 / 5 | 8 | 182.183초 |
  | TypeScript / 영어 | 2 / 2 | 3 | 74.217초 |
  | TypeScript / 한국어 | 2 / 2 | 3 | 63.619초 |
  | Kotlin / 영어 | 2 / 2 | 2 | 50.871초 |

  이는 작은 fixture를 각각 한 번 실행한 측정이며 일반적인 성능·정확도 보장이 아니다.
  검증된 모든 결과에 매개변수 예시와 도달 노드 해설이 있었고, node ID 순서는 해당
  source route와 일치했다. TypeScript와 영어 Kotlin의 Boolean/숫자 입력 및 예시 결과를
  fixture 수식과 비교했다. 소스 프로그램을 실행하거나 모델 가중치를 학습하지 않았다.
- 실제 모델 응답을 production Function Visualizer HTML에 재생해 Safari에서 Kotlin을
  390×844, 768×1024, 1440×900으로, TypeScript 영어를 1440×900으로 확인했다.
  시나리오 선택, 예시값 적용, Kotlin 입력 수정, 노드 선택과 값 변화 표, 노드 소스 요청,
  모델 예시 버튼의 Guide 전환 및 locale 전환 때 추가 추론이 없는 것을 확인했다.
  검사한 viewport에서 가로 overflow와 계측된 JavaScript 오류는 없었다.
  준비 중 안내·취소와 다운로드 실패·재시도 안내는 명시적인 synthetic Host 응답으로
  확인했다. Safari QA의 Host 메시지는 replay adapter이며 실제 추론 검증과 구분한다.
- UI 검증에서 발견한 compound graph ID 연결과 모델 예시 버튼의 잘못된 Inspector
  전환을 수정했다. 실제 production HTML 통합 테스트는 graph/node/source/apply와
  저장된 해설의 재사용, 편집값·locale·focus 보존을 검증한다. 별도 Host 테스트는
  반복 방문, partial frontier, 취소 후 node chunk 재개, cache-only node 조회가 진행 중인
  요청을 대체하지 않는 경우와 32개 매개변수 상한을 포함한다.
- Impeccable의 접근성·성능·테마·반응형·표현 패턴을 변경 범위에서 점검했다.
  native 버튼/select, 명시적인 label, table caption/header scope, 상태 안내,
  테마 색상·focus ring, 긴 값 줄바꿈, 한 페이지 렌더링과 동일 노드 DOM 보존을 확인했다.
  detector는 변경한 renderer 파일에서 지적 사항을 반환하지 않았다.
  Web Interface Guidelines를 적용해 의미 구조·locale·literal 출력·경계 상태를 검토했다.
  전체 색상 대비 계측, 실제 터치 기기와 모든 키보드 경로는 이번 검사 범위에 포함하지 않았다.
- TypeScript 전체 테스트는 977개 중 973개가 통과했다. 기존 declared-type 대표값 2개,
  advanced private Scenario와 decorated source-reveal의 실패 4개는 이전 릴리스와 같다.
  기능 및 인접 architecture 테스트 46개, Rust 82개와 패키징 script 13개는 통과했다.
  다운로드 회귀에는 첫 수신량이 알림 제한 시간 안에 들어와도 진행·취소가 가능하고
  받은 partial bytes를 유지하는 결정적 테스트를 추가했다.
- 0.0.1110 darwin-arm64 VSIX는 512개 파일, 압축 3.61 MiB·해제 15.43 MiB로 기존
  패키지 상한을 통과했다. 모델 가중치는 포함하지 않는다. 기본 및
  `Function Language QA 1107` 프로필에 설치하고 두 프로필의 등록 버전을 확인했다.
  설치된 런타임 파일 478개가 빌드 출력과 byte 단위로 일치했다. 기본 프로필의 기존
  GGUF 설정과 QA 프로필의 자동 다운로드 설정을 유지했다.
  열려 있던 VS Code 창에서 새 버전을 다시 불러온 뒤의 native UI 검증은 완료하지 못했다.
  위 화면 검증은 production HTML을 사용하는 Safari 검사이며 설치 검증과 구분한다.

## 0.0.1109 검증 기록

- 생산 storage/network adapter로 고정 Hugging Face revision의 2,740,937,888 bytes를
  실제 다운로드했다. 67,199,610 bytes에서 취소한 뒤 HTTP 206과 일치하는 Content-Range로
  이어받았고, 완료 파일의 SHA-256을 독립적으로 다시 계산해 고정 값과 일치함을 확인했다.
  같은 cache의 다음 `ensure`는 추가 네트워크 요청 없이 파일을 재사용했다.
- 이 자동 다운로드 파일로 생산 configured provider → local provider → Host를 실행했다.
  공개 Kotlin `inspect(value)`의 5/5 경로가 한국어 설명으로 완료됐고 세 묶음·세 페이지를
  저장했다. 준비부터 모든 페이지 읽기까지 55.438초였으며 작은 함수 한 번의 측정이다.
  준비/모델 cache 확인은 각각 한 번, 모델 호출은 세 번이었다. 저장 페이지를 다시 읽어도
  준비·다운로드·추론 횟수가 늘지 않았다. VS Code 설정/알림 API는 QA port로 대체했고
  모델 실행은 실제 llama-completion을 사용했다. 완료 후 모델 프로세스는 없었다.
- 실제 전송은 Node의 정상 시스템 CA 검증을 켜서 실행했다. 이 PC의 기업 CA는 기본 Node
  trust store만으로 인식되지 않아 `--use-system-ca`가 필요했다. TLS 검증을 끄지 않았다.
  이 CLI 검증은 실제 VS Code Host의 프록시·인증서 설정 검증을 대신하지 않는다.
- 새 storage/setup/Host 집중 테스트 27개와 패키징 script 13개가 통과했다. 전체 TypeScript
  unit은 964개 중 960개 통과했다. 기존 declared-type 입력 대표값 2개, advanced private
  Scenario, decorated source-reveal의 실패 4개는 같다. check, compile, release metadata,
  diff check와 VSIX 상한 검사도 통과했다. Rust 소스는 바꾸지 않아 Rust 테스트를 재실행하지
  않았다. 비공개 source·prompt·모델 응답과 다운로드 파일은 git/VSIX에 포함하지 않았다.
- 생산 HTML을 실제 Safari에서 390×844 한국어 준비/취소, 768×1024 한국어 다운로드 실패,
  1440×900 영어 실패 상태로 확인했다. 이 응답 상태는 명시적인 QA fixture이며 실제 native
  다운로드 알림의 재생이 아니다. 취소 후 재분석 동작, 한영 전환, 긴 문장의 줄바꿈을
  확인했고 측정한 가로 overflow와 계측된 browser 오류는 없었다. 변경 범위의 Impeccable
  검사와 Web Interface Guidelines 검토에서도 추가 수정 항목은 없었다.
- 실제 VS Code QA 창은 함수 시각화 명령으로 활성화했지만 native 캡처가 이전 명령 palette를
  계속 표시하여 진행 알림의 시각 검증은 완료하지 못했다. 알림의 진행·취소·오류 연결은
  adapter 테스트로 확인했다. OS 스크린리더, 실제 터치 장치, 전체 접근성 인증은 확인하지 않았다.
- 0.0.1109 VSIX는 509개 파일, 압축 3.60 MiB·해제 15.38 MiB다. 기본 및 QA 프로필에
  설치했고 두 manifest의 버전과 설치된 런타임 JS 475개의 빌드 출력 일치를 확인했다.
  기본 프로필의 기존 GGUF 설정은 유지했고 QA 프로필의 빈 모델 경로는 자동 준비를 사용한다.

## 0.0.1108 검증 기록

기존 3개 source preview와 응답당 4개 validator 상한을 전체 함수의 시나리오 개수로
사용하지 않도록 바꿨다. 동일 snapshot의 Function Logic에서 발견한 경로를 모두 열거하고,
고정 경로 묶음마다 정확히 하나씩 설명을 검증·저장한다. 실제 생산 local provider와 Host,
Qwen3.5-4B Q4_K_M을 사용한 최종 순차 실행은 다음과 같다.

| QA 함수 | 완료/발견 경로 | 모델 호출 / 저장 페이지 | 전체 생성 시간 |
| --- | ---: | ---: | ---: |
| 복잡한 로컬 Python 함수, 한국어 | 16/16 | 16 / 16 | 609.833초 |
| Python 반복·continue·break 함수, 한국어 | 5/5 | 3 / 3 | 85.534초 |
| 독립 조건 3개의 TypeScript 함수, 한국어 | 8/8 | 4 / 4 | 101.292초 |
| Kotlin 조기 반환 함수, 영어 | 5/5 | 3 / 3 | 45.978초 |

각 함수의 최종 `coverage.complete=true`, 완료 개수와 저장 페이지의 시나리오 합계를
확인했다. 모든 저장 페이지를 다시 읽어도 모델 호출 수가 증가하지 않았다. 별도 프로세스를
순차 실행했으며 source는 프로젝트 밖의 로컬 QA 자료를 포함한다. 비공개 source·prompt·
모델 응답은 임시 경로에만 보관하고 저장소나 VSIX에 넣지 않았다. 시간은 각 함수 한 번의
측정으로 일반적인 성능을 보장하지 않는다.

초기 복잡한 Python 실행은 완료한 9개를 보존한 채 다음 묶음에서 45초 deadline에 걸렸다.
90초로 늘린 뒤에는 긴 고정 조건과 장황한 문단이 2,400 token 출력을 소진했다. 최종 수정은
긴 조건을 소스 줄 참조로 보존하고 로컬 문단·단계 길이를 줄인다. 경로 slot과 분기 선택을
제거하지 않았으며, 실패했던 경로를 포함한 최종 16개가 모두 완료됐다. 총 실행은 90초로
제한하지 않으며 각 묶음의 제한과 사용자의 명시적 취소를 사용한다.

기본 프로필과 `Function Language QA 1107` 프로필의 GGUF 경로를 Qwen3.5-4B로 바꿨다.
설치한 0.0.1108에서 Kotlin 한국어의 5개 문단, 세 페이지, 마지막 페이지의 `LLM 5.1`
원본 연결과 native hover를 확인했다. 문단을 모두 생성해도 문장 의미는 검증된 것으로
취급하지 않는다. 실제 마지막 문단은 `< 10`의 거짓 조건을 “10이 아니면”으로 잘못 풀어 썼다.
고정 조건과 terminal은 소스 frame 검증을 통과했고 미검증 추론 표시는 유지한다.

실행 중 `llama-completion` 한 프로세스의 RSS는 한 시점에 약 3.1GiB였다. 이는 peak나
전체 GPU 메모리 측정, 이전 모델과의 성능 비교가 아니다. 8,192 context token, 2,400 output
token, CPU thread 2개, offline 및 단일 프로세스 상한은 유지한다. renderer는 현재 페이지만
만들고 완료 문단은 private 임시 페이지로 보관한다. 페이지별 작은 metadata는 완료 개수에
따라 늘지만 전체 문단이나 전체 경로의 Cartesian product를 메모리에 적재하지 않는다.

최종 집중 테스트 53개는 모두 통과했다. 전체 TypeScript unit 실행은 942개 중 938개
통과했고 기존 declared-type 입력 대표값 2개, advanced private Scenario,
decorated source-reveal의 실패 4개는 같다. 패키징 script 13개, compile, release metadata,
diff check와 VSIX 상한 검사는 통과했다. Rust 소스는 변경하지 않았고 이번 변경에서
Rust 테스트를 재실행하지 않았다. 설치 manifest와 변경 런타임 JS 28개를 빌드 출력과
대조했고 mismatch가 없었다. type-only 계약 3개는 별도 JS가 없다.

실제 화면과 synthetic 상태의 구분은 [UI 검증 기록](FUNCTION_READING_UI_QA.md)을 따른다.
완료 개수는 captured control graph의 유한 구조 경로에 대한 것이며, 모든 반복 횟수나
실제 입력 도달 가능성·모델 문장의 의미 정확성을 보장하지 않는다. 0.0.1108 당시에는 모델
자동 다운로드를 제공하지 않았으며 고정 revision·SHA-256과 별도 설치 방법을 제공했다.

## 0.0.1107 검증 기록

- 최종 빌드의 실제 local provider → Host 경계에서 기존 Qwen2.5-Coder 1.5B Q4_K_M을
  한국어·영어로 실행했다. Kotlin/TypeScript는 명시적 설정과 다른 표시 언어를 사용해
  요청 언어가 우선하는 것도 확인했다. source read adapter와 설정 조회는 QA adapter로
  대체했으며, 아래 실행은 VS Code 화면 재생과 별개다.

  | 입력 함수 | 한국어 요약·시나리오 | 영어 요약·시나리오 |
  | --- | --- | --- |
  | Kotlin `classifyOrder(enabled, amount)` | 3개, 6.201초 | 3개, 5.963초 |
  | TypeScript `computeTotal(amount, enabled)` | 3개, 12.522초 | 3개, 8.852초 |
  | 복잡한 Python 스냅샷 처리 함수 | 1개, 5.155초 | 1개, 7.941초 |

  각 언어·함수의 1회 측정이며 일반적인 속도나 정확도를 보장하지 않는다. 위 실제 호출은
  6회, 추가 source read는 0회였다. 같은 언어 재요청과 이전 언어 복귀는 캐시를 사용했다.
  한국어 summary·문단·reason/effect가 모두 한국어로 반환됐다. native 설치본에서도
  Kotlin 두 언어와 해당 Python 한국어 생성을 별도로 확인했다.
- 한국어 설명이 전부 영어였던 이전 Python 응답을 회귀 대상으로 사용했다. 새 요청은
  별도 private system prompt를 전달하고 한글 시작의 bounded JSON pattern으로 prose를
  유도한다. prompt와 system 파일은 `0600`으로 기록하고 완료·오류·취소 때 함께 제거한다.
  기존 source const/enum, 8,192 context·2,400 output·thread 2개·45초·단일 프로세스 제한,
  seed 42·temperature 0.2를 유지했다. 자동 재시도나 모델 교체는 하지 않았다.
- Host는 구조·소스 검증 뒤 캡처한 요청 언어를 확인한다. 영어 설명을 한국어로 요청한
  regression에서 language-mismatch를 반환하고 캐시·evidence·annotation을 만들지 않으며,
  명시적 재요청 뒤 한국어 성공과 같은 언어 캐시를 확인했다. production renderer도 같은
  문자 확인을 적용하여 잘못된 ready payload를 성공으로 표시하지 않는다.
- 이 검사는 문자 체계에 대한 heuristic이다. 인용된 코드와 원본 식을 허용하며 문장 의미를
  평가하지 않는다. Kotlin 영어 summary는 `amount`를 Boolean이라고 했고 한국어 상세는
  거짓 조건의 경계값을 잘못 설명했다. TypeScript 한국어는 고정 추가값 5를 5%로 설명했다.
  Python 한국어도 실제 매개변수를 잘못 설명했다. 결과에 미검증 추론 표시를 유지한다.
- native Python의 후속 영어 생성은 invalid-response로 거부됐다. 별도 Host QA 영어 성공을
  모든 native 요청의 성공 보장으로 해석하지 않는다. UI는 기존 한국어 결과를 보존하고
  명시적 재시도 버튼을 제공했다. native Kotlin 영어 요청은 정상 완료됐다.
- 언어·Host delivery·Webview·local adapter 집중 테스트 24개가 모두 통과했다.
  전체 TypeScript unit 921개 중 917개 통과, 기존 declared-type 입력 대표값 2개·advanced
  private Scenario·decorated source reveal 실패 4개가 유지된다. compile, 패키징 script 13개,
  release metadata와 diff check를 통과했다. Rust 소스는 이번에 변경하지 않았다.
- 최종 VSIX는 494개 파일, 압축 3.57MiB·해제 15.32MiB다. 기본 및 QA 프로필의 0.0.1107
  설치와 변경 런타임 JS 10개의 빌드 일치를 확인했고 추론 프로세스는 남아 있지 않았다.
  실제 생성·소스·hover와 세 viewport·언어 전환·잘못된 언어·오류 복구 화면의 구체적 경계는
  [UI 검증 기록](FUNCTION_READING_UI_QA.md)을 따른다. private 소스·응답은 commit하지 않는다.

## 0.0.1106 검증 기록

- 설치된 0.0.1105의 실제 configuration adapter → configured local provider → Host 경계에서
  기존 Qwen2.5-Coder 1.5B Q4_K_M을 실행했다. 외부 VS Code 설정 저장소와 표시 언어만
  QA adapter로 대체했고 사용자 설정·모델 파일은 변경하지 않았다. `ko` 요청 때 표시 언어는
  `en-US`, `en` 요청 때는 `ko-KR`로 두어 명시적 설정이 우선하는지 확인했다.

  | 입력 함수 | 한국어 요약·시나리오 문단 | 영어 요약·시나리오 문단 |
  | --- | --- | --- |
  | Kotlin `classifyOrder(enabled, amount)` | 3개, 9.233초 | 3개, 8.366초 |
  | TypeScript `computeTotal(amount, enabled)` | 3개, 12.515초 | 3개, 13.498초 |

  위 시간은 작은 QA 함수의 각 1회 측정이다. 모델 호출은 4회, 추가 source read는 0회였다.
  같은 언어의 재요청과 한국어로 돌아온 요청은 캐시를 사용했다. 측정 결과를 일반 성능이나
  모델 설명의 의미 정확성으로 해석하지 않는다.
- 최종 0.0.1106의 local prompt는 네 경우 모두 설치된 0.0.1105와 byte 단위로 같고,
  연결 모델 prompt도 같다. 기존 실제 응답을 최종 parser에서 다시 검증하여 제목만 고정 조건으로
  표시하고 다른 필드와 모델 문장을 그대로 보존하는지 확인했다. 같은 텍스트를 현재 Host에
  재생한 결과도 source context가 원본과 같고 두 언어 캐시·소스 소유권을 유지했다.
- 한국어/영어 전환 및 생성에 관한 production Host/Webview integration과 관련 회귀 테스트
  52개가 통과했다. 전체 TypeScript는 916개 중 912개 통과, 기존 declared-type 입력 대표값
  2개·advanced private Scenario·decorated source reveal 실패 4개가 유지된다. typecheck와
  패키징 script 13개도 통과했다. Rust 구현은 이 릴리스에서 변경하지 않았다.
- 실제 영어 응답의 첫 Kotlin 제목은 `enabled=false` 조건에 반대되는 제목이었다.
  최종 화면 제목은 검증된 `enabled = false`를 표시한다. 이 수정은 문장 의미를 검증하지 않는다.
  Kotlin 영어 summary가 `amount`를 Boolean으로 잘못 설명하고, 일부 guard 효과·`Math.max`
  계산과 음수 처리 설명에도 오류가 남았다. 모든 설명에 미검증 추론 표시를 유지한다.
- 최종 production HTML에 네 실제 응답을 재생하여 Kotlin의 세 viewport, 언어 전환·명시적 생성·
  캐시 복원·근거 펼침, TypeScript 두 언어 렌더링을 확인했다. 이 화면 검증은 실제 모델 호출과
  별도이며 자세한 경계는 [UI 검증 기록](FUNCTION_READING_UI_QA.md)에 남겼다.
- 0.0.1106 darwin-arm64 VSIX는 493개 파일, 압축 3.57MiB·압축 해제 15.31MiB로 패키지
  상한 검사를 통과했다. VS Code 강제 설치 후 `newdlops.function-analysis@0.0.1106`을 확인했고
  설치 manifest와 관련 runtime JS 13개가 빌드 출력과 같았다. 추론 프로세스는 남아 있지 않다.
  작업 중인 VS Code 창을 다시 불러오거나 최신 native hover를 이번 릴리스에서 재검증하지 않았다.

## 0.0.1105 검증 기록

- 최종 TypeScript 전체 unit(`--test-concurrency=4`)은 916개 중 912개 통과했다. 0.0.1104의 declared-type 입력
  대표값 2개, advanced private Scenario, decorated source-reveal 실패 4개는 같다.
  새 근거 연결 테스트 11개는 모두 통과했고 optional/nullable/alias Boolean,
  route 순환·깊이·생략·추론 confidence, 소스 frame 검증을 포함한다. Rust 82개,
  패키징 script 13개, typecheck·compile·release metadata·diff check도 통과했다.
- 기존 0.0.1104와 같은 Kotlin `classifyOrder`, TypeScript `computeTotal` 및 1.5B 모델,
  seed 42, temperature 0.2, context/output/thread 상한으로 실제 생산 provider를 확인했다.
  최종 생성은 Kotlin 6.041초, TypeScript 8.344초였다. 각 1회 측정이며 일반적인 속도나
  정확도를 보장하지 않는다. 모델·사용자 설정을 바꾸지 않았다.
- 최종 Kotlin 문단은 disabled/priority/ordinary를 올바른 Boolean 및 금액 조건으로 설명했다.
  TypeScript 문단은 비활성 반환 0, 활성 경로의 고정 추가값 5/0을 설명했다. 이전의
  “5% 할인” 해석은 이 최종 응답에 없었다. JSON은 고정 조건·소스 terminal·같은 route의
  인용 범위를 통과했다. `Math.max`는 기존 정적 계산기의 지원 범위 밖이므로 해당 함수의
  숫자 반환값을 static verified example로 제공하지 않았다.
- 상세 단계에는 여전히 문제가 있었다. Kotlin의 통과한 guard에 대해 비활성 반환을 일반적으로
  서술했고, TypeScript는 high-value 경로의 base를 0으로 단정하고 `0 + 5 = 5`라고 했다.
  고정 field 검증을 문장 의미 검증으로 취급하지 않는다. 모든 LLM 결과에 미검증 추론 표시를
  유지하며 모델 가중치 학습, 자동 재시도, 추가 추론 call을 하지 않는다.
- 여러 prompt 후보도 실제 확인했다. source route JSON만 추가했을 때 비율 할인이 남았고,
  경로를 prose로만 전달했을 때 invalid response 및 Boolean/반환 혼동이 있었다. 최종 방식은
  source metadata를 고정하고 required Boolean input을 명시하는 방식이다.
- 최종 두 QA 함수의 context는 이후 nullability·visible-column 보강 뒤에도 실제 추론 기록과
  동일했다. 최종 VSIX는 493개 파일, 압축 3.57MiB·해제 15.31MiB로 상한을 통과했다.
  기본 VS Code에 설치하고 manifest·런타임 모듈 13개의 일치, 실제 Kotlin 문단 3개,
  코드 생략 안내 제거와 명시적 소스 열기를 확인했다. 구체적 UI 검증 범위는
  [설치 검증 기록](FUNCTION_READING_UI_QA.md)을 따른다. 완료 후 모델 프로세스는 없었다.

## 0.0.1104 검증 기록

- 실제 로컬 provider로 두 모델의 Kotlin/TypeScript 한국어 설명을 각각 한 번 생성했다.
  모두 검증 가능한 JSON·소스 범위와 시나리오별 문장형 `explanation`을 반환했다.
  기존 사용자 모델 설정과 context/output/thread 상한은 바꾸지 않았다.

  | 모델 | Kotlin `classifyOrder` | TypeScript 계산·조기 반환 함수 |
  | --- | ---: | ---: |
  | Qwen2.5-Coder 3B Q4_K_M | 18.409초, 3개 시나리오 | 15.841초, 3개 시나리오 |
  | Qwen2.5-Coder 1.5B Q4_K_M | 10.962초, 3개 시나리오 | 12.341초, 3개 시나리오 |

  작은 QA 함수 각 1회 측정이며 일반적인 속도·정확도를 보장하지 않는다. 3B Kotlin은
  ordinary/priority와 경계값 100을 문장으로 설명했지만 비활성 경우를 생략했다. 3B TypeScript는
  `150 + 5 = 155`를 설명했으나 비활성 경우의 문단과 결과가 모순됐다. 1.5B TypeScript는
  고정 추가값 5를 비율 할인으로 잘못 설명했다. 문장형 형식과 인용 검증을 사실 정확성으로
  취급하지 않으며 모든 결과에 미검증 추론 표시를 유지한다.
- 관련 변경의 TypeScript 전체 테스트는 905개 중 901개 통과했다. 기존 declared-type 입력
  대표값 2개, advanced private Scenario, decorated source-reveal 실패 4개는 같다.
  Rust 82개, 패키징 script 13개와 typecheck는 통과했다. Guide 재배치의 open/closed 및
  독립 Guide/Code 스크롤, pending/stale 포커스 회귀는 재현한 뒤 수정하고 테스트했다.
- production HTML의 세 viewport와 실제/합성 응답 상태는
  [UI 검증 기록](FUNCTION_READING_UI_QA.md)에 구분했다. 0.0.1104 VSIX는 488개 파일,
  압축 3.56MiB·압축 해제 15.28MiB로 기존 패키지 상한을 통과했다.
- 설치된 VS Code의 실제 1.5B Kotlin 한국어 응답으로 문단 3개, 접힌 근거,
  Tab/Enter 소스 열기와 문단을 포함한 native hover를 확인했다. 완료 후 모델 프로세스는
  남아 있지 않았다. 일부 단계의 의미와 인용 위치는 잘못됐으며 미검증 표시를 유지한다.

## 0.0.1103 검증 기록

- 설치된 VS Code에서 실제 1.5B 한국어 응답을 생성하고 원본 줄 끝의 단계 번호,
  상세 hover, 편집기 지우기, 소스 버튼을 통한 캐시 복원과 편집 시 자동 제거를 확인했다.
  QA 편집을 되돌리고 원본 탭을 닫았다. hover와 소스 동작은 모델을 다시 실행하지 않았다.
- production HTML을 사용하는 Safari 화면을 390×844, 768×1024, 1440×900에서 확인했다.
  아래 비교에서 얻은 실제 3B Kotlin 응답을 재생해 판단 근거·값 변화·소스 단계의 줄바꿈과
  읽기 순서를 확인했다. 4개×5단계의 긴 해설, pending/취소, 모델 없음, 잘못된 응답,
  만료·다시 불러오기와 영어 TypeScript 화면은 synthetic fixture로 확인했다.
  확인한 화면에 가로 overflow가 없었고 계측된 브라우저 오류는 0개였다.
- 같은 3B 모델에 이전 버전과 새 버전의 prompt를 각각 사용해 실제 응답을 비교했다.
  아래 해설 길이는 summary와 단계의 text/reason/effect를 연결한 문자열 길이이며, 속도는 작은 함수
  각각 한 번의 측정이다. 모델의 일반적인 성능이나 정확도를 보장하는 지표가 아니다.

  | QA 함수 | 이전 → 새 해설 길이 | 이전 → 새 단계 수 | 이전 → 새 추론 시간 |
  | --- | ---: | ---: | ---: |
  | Kotlin `classifyOrder` | 162 → 429 | 2 → 3 | 6.260 → 7.596초 |
  | TypeScript 계산·조기 반환 함수 | 343 → 758 | 6 → 10 | 8.946 → 13.638초 |

  새 Kotlin 응답은 `!enabled`의 판단과 조기 반환으로 건너뛰는 구문을 설명했지만,
  priority/ordinary 시나리오의 `enabled=true` 선행 조건과 ordinary 제목의 경계 표현이
  부족했다. TypeScript 응답은 `150 + 5 = 155`, 비활성 입력의 조기 반환 `0`,
  `50 + 0 = 50`을 구체적으로 설명했다. 일부 시나리오는 통과한 guard 단계를 생략했다.
- 현재 1.5B 모델은 새 상세 형식을 따르면서도 분기와 반환값을 잘못 설명하거나 해설 예제의
  값을 복사했다. 형식·인용 검증 통과를 의미 정확성으로 취급하지 않는다. 모델 가중치 학습은
  수행하지 않았다. 실제 추론 완료 후 `llama-completion` 프로세스가 남아 있지 않았다.
- source 표시, 상세 해설, Host 전달, browser와 Kotlin 통합 관련 테스트 24개를 통과했다.
  전체 TypeScript 테스트는 898개 중 894개 통과했다. 이전에 기록된 declared-type
  입력 대표값 2개, advanced private Scenario와 decorated source-reveal 실패 4개는 같다.
  Rust 82개, 패키징 script 13개, typecheck와 release metadata 검사는 통과했다.
- 0.0.1103 VSIX는 488개 파일, 압축 3.56MiB, 압축 해제 15.27MiB로 기존 상한을 통과했다.
  별도 모델 파일을 포함하지 않았으며, 설치된 VS Code에서 새 소스 표시를 확인했다.

## 0.0.1102 검증 기록

- 설치된 VS Code 확장에서 Kotlin `classifyOrder`를 열고 첫 GGUF 선택, 한국어 목적 요약,
  실제 모델이 생성한 시나리오 2개와 원본 소스 열기를 확인했다. 완료 후 해당 모델 프로세스가
  남아 있지 않았으며 모델 경로는 사용자 설정에 저장됐다.
- production HTML을 사용하는 Safari QA 화면을 390×844, 768×1024, 1440×900에서 확인했다.
  실제 Kotlin 응답을 재생했고 긴 텍스트, pending/취소, 모델 없음, 잘못된 응답, 만료 복구는
  명시적인 synthetic fixture로 확인했다. 가로 overflow와 브라우저 오류는 없었다.
- TypeScript 단위 테스트는 886개 중 882개 통과했다. 이전 릴리스에서 확인된 declared-type
  입력 대표값 2개, advanced private Scenario, decorated source-reveal 항목의 실패 4개는 같다.
  신규 narrative 테스트 22개와 패키징 script 테스트 13개는 모두 통과했다.
- 타입만 선언한 모듈에서 발생하는 빈 JavaScript 출력 중 다른 출력 파일이 참조하지 않는 것만
  compile 후 제외한다. 런타임 export, side effect와 참조된 출력은 유지한다. VSIX 검사에서
  483개 파일, 압축 3.55MiB, 압축 해제 15.25MiB로 기존 상한을 통과했다.
