# 코드 스니펫을 읽는 LLM 동작 시나리오

Function Guide의 **전체 시나리오 분석**은 함수 본문과 가까운 문서·상수, 같은 파일에
확인된 직접 helper 코드를 언어 모델에 전달해 목적과 동작 시나리오, 예시 입력·결과값과
각 경로의 노드 해설을 만든다.
Kotlin과 인자 없는 함수도 사용할 수 있다. 숫자 입력을 찾는 기존 로컬 모델과는 별도 기능이다.
문장형 설명은 로컬 LLM이 작성한다. 기본 함수 요약과 그래프, 생성에 쓰는 조건·소스 경로는
기존 정적 분석이 제공한다.

## 사용 및 연결

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
   발견한 소스 경로를 한 번에 최대 2개씩 순차 분석한다. 전체 경로 수에는 3개/4개 상한을
   적용하지 않는다. 실제 추론 호출마다 90초 제한을 사용하며, 같은 snapshot/언어의 결과를 재사용한다.
   취소·실패 후 **이어서 시나리오 분석**은 완료된 경로를 건너뛰고 미완료 묶음부터 재개한다.
   설정 변경으로 두 모델이 동시에 실행되지 않는다.
4. 함수의 역할과 시나리오별 문단에서 조건·판단·계산·건너뛴 작업·예상 결과를 읽는다.
   접힌 **소스 근거**를 펼치면 조건, 번호가 붙은 동작, **판단 근거**, **값과 흐름의 변화**,
   예상 결과와 가정을 확인한다. 응답 하나는 최대 2개이고 결과는 한 페이지씩 읽는다.
   모델 예시가 포함된 로컬 묶음은 출력 한도 안에서 끝나도록 최대 3단계, summary 160자,
   문단 280자, 단계의 text/reason/effect 각각 80자로 제한한다.
   문단의 단계와 별도로 빠진 소스 노드를 최대 3개씩 해설하므로 문단의 단계 상한이 노드 수를
   제한하지 않는다. 노드 추론은 같은 시나리오의 예시 입력을 고정해 사용한다.
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

**선택한 노드 해설**에서 그래프 또는 노드 목록으로 선택한 구문의 동작·판단 근거·값의
변화를 읽는다. 반복 방문은 각각 표시하며 다른 페이지의 노드는 저장된 해설만 불러온다.
현재 경로가 지나지 않는 노드는 이를 명시하고 다른 시나리오의 예시와 함께 설명한다.
첫 결과만 빈 입력칸을 채운다. 페이지 이동·진행률 갱신·언어 전환은 사용자가 편집한 값을
덮어쓰지 않는다. 명시적으로 시나리오를 선택하거나 예시값을 적용하면 해당 예시로 바꾼다.
Kotlin도 예시 입력을 편집·삭제·추가할 수 있으며 **모델 예시 생성**은 Guide의 모델 분석을
연결한다. Kotlin 소스의 런타임 계산을 지원한다는 의미는 아니다.

VS Code 연결 모델을 쓰려면 `projectAnalyzer.functionNarratives.provider`를 `vscode`로 바꾼다.
여러 등록 모델 중 선택하며 필요한 접근 동의는 VS Code UI를 따른다. 접근 실패, 잘못된
응답 또는 timeout 후 재시도는 다른 모델을 선택할 수 있다. 로그인·API key를 자동 처리하지 않는다.

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
준비 단계에는 source를 전달하지 않으며 다운로드 시간은 실제 모델 호출별 90초 추론 제한에 포함하지 않는다.

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
- `shared/functionNarratives`: portable narrative/context types 및 동일한 Host/browser runtime validator,
  요청 언어의 서술을 확인하는 `isFunctionNarrativeLanguage`.
  `isFunctionNarrativeExample`은 실행 없이 JSON 예시의 크기·깊이·안전한 key를 검사한다.
  `createFunctionNarrativeValidator`는 이 helper를 명시적으로 주입해 Webview 직렬화에도
  CommonJS module 참조가 남지 않게 한다.
  `FunctionNarrativeSourcePresenter`, `buildFunctionNarrativeSourceAnnotations`는 native source 표시 계약과
  줄별 번호 그룹화를 제공한다.
- `vscode/functionNarrativeProvider`: 실제 VS Code 모델 선택, token 확인, streaming, 취소와 오류 변환.
- `llm/functionNarratives`: `createLocalFunctionNarrativeProvider`, private prompt, localized line-numbered
  input, JSON grammar, output cap 및 종료를 기다리는 공용 process queue.
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
  세션과 작은 페이지 metadata, 단일 pending 분석과 실제 모델 호출별 90초 deadline, evidence token projection.
  source graph 없는 이전 계약은 45초 단일 요청 fallback을 유지한다.
  `FunctionNarrativeScenarioSession.readNodePage`는 저장된 첫 해설 페이지를 node ID로 조회하며,
  모델을 호출하거나 화면의 선택 페이지·진행 중 request ID를 바꾸지 않는다.
- `webview/functionNarratives`: inert reading section, strict reply correlation, bounded DOM,
  literal prose, locale/focus retention, disposal cancellation.
- `protocol/functionNarratives`: identity-only request/cancel, cache-only `pageIndex`/`pageLanguage`/`nodeId`,
  progress/coverage/page 응답, 정확한 context/locale/페이지/단계 source action과 bounded result.
  source action의 optional `nodeIndex`는 해당 저장 페이지의 정확한 노드 근거를 가리킨다.
  이전 text-only 단계도 읽으며 새 prompt는 explanation/reason/effect를 요청한다.

source context는 최대 5개/18,000자이며 실제 모델 응답 하나는 최대 24,000자 JSON이다.
노드 해설을 합친 저장 페이지는 최대 2개 시나리오와 시나리오별 최대 900개 node detail로
제한한다. Webview는 한 페이지와 최대 8개 선택 노드 해설만 보유하며 다른 저장 페이지의
전체 문장을 누적하지 않는다.
portable validator의 시나리오 4개×step 5개는 응답 상한이며 함수 전체의 경로 상한이 아니다.
시나리오의 `explanation`은 최대 1,800자다. 새 로컬 grammar에는 필수이며 이전 결과에는
선택 필드로 허용한다. 이전 결과는 기존 조건·단계·결과만 이어 문단을 구성한다.
cache는 owning surface/root의 수명에 속하고 새 snapshot 또는 disposal에서 해제한다.
주변 상수/helper까지 content identity에 포함한다. 확장이 백그라운드 모델을 유지하지 않는다.

### 정적 근거와 LLM 문장의 경계

`buildFunctionNarrativeContext(node, source, helpers, analysis?)`는 같은 source snapshot의
기존 Function Logic을 받아 optional source route를 붙인다. `buildFunctionNarrativeSourceFlow`
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
