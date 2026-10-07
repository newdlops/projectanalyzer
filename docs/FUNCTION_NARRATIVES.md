# 코드 스니펫을 읽는 LLM 동작 시나리오

Function Guide의 **전체 시나리오 분석**은 함수 본문과 가까운 문서·상수, 같은 파일에
확인된 직접 helper 코드를 언어 모델에 전달해 목적과 동작 시나리오, 예시 입력·결과값과
각 경로의 노드 해설을 만든다.
Kotlin과 인자 없는 함수도 사용할 수 있다. 숫자 입력을 찾는 기존 로컬 모델과는 별도 기능이다.
문장형 설명은 로컬 LLM이 작성한다. 기본 함수 요약과 그래프, 생성에 쓰는 조건·소스 경로는
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
연속 요청 동안 재사용한다. private Unix socket과 임시 인증 key를 사용하고 대기열이 비면
종료한다. 취소·실패·다른 공급자로 전환·Host 종료도 프로세스를 정리하며, Host가 갑자기
끝나면 watchdog의 parent pipe EOF로 종료한다. model process는 한 FIFO 슬롯만 사용하고
context 8,192·output 2,400 token·모델 CPU thread 2개 상한을 유지한다. 별도 runtime을
다운로드하지 않으며 companion 없음·custom runner·Windows는 기존 CLI 방식으로 실행한다.

템플릿·JSON grammar·prefix cache 요청은 설치본과 같은 commit의
[llama.cpp server API](https://github.com/ggml-org/llama.cpp/blob/b29c606e2/tools/server/README.md)를 따른다.
cache prefix가 같아도 backend batch 방식에 따라 logits의 bit 단위 동일성을 보장하지 않으므로
실제 응답과 기존 Host 검증을 함께 확인한다.

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
