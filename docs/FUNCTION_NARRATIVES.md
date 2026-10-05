# 코드 스니펫을 읽는 LLM 동작 시나리오

Function Guide의 **설명 생성**은 함수 본문과 가까운 문서·상수, 같은 파일에
확인된 직접 helper 코드를 언어 모델에 전달해 목적과 동작 시나리오를 만든다.
Kotlin과 인자 없는 함수도 사용할 수 있다. 숫자 입력을 찾는 기존 로컬 모델과는 별도 기능이다.

## 사용 및 연결

1. PC에 llama.cpp의 `llama-completion` 실행 도구와 instruction-tuned GGUF 모델을 준비한다.
   기본 provider는 `local`이다. Homebrew 경로와 PATH를 확인하며, 다른 설치 경로는
   `projectAnalyzer.functionNarratives.localBinary`에 지정한다.
2. 함수를 시각화하면 Function Guide가 열린다. 짧은 목적을 읽고 **설명 생성**을 누른다.
   첫 요청에서 GGUF 파일을 선택하면 `projectAnalyzer.functionNarratives.localModel`에
   사용자 설정으로 저장한다. 프로젝트 설정이 실행 파일을 바꾸지 못하도록 machine scope를 쓴다.
3. 로컬 모델은 요청할 때만 실행하고 끝나거나 취소되면 프로세스를 종료한다.
   기본 문맥 8,192 token, 응답 2,400 token, CPU thread 2개와 GPU 자동 offload를 사용한다.
   같은 snapshot/언어의 결과를 재사용하며 설정 변경으로 두 모델이 동시에 실행되지 않는다.
4. 함수의 역할과 시나리오별 문단에서 조건·판단·계산·건너뛴 작업·예상 결과를 읽는다.
   접힌 **소스 근거**를 펼치면 조건, 번호가 붙은 동작, **판단 근거**, **값과 흐름의 변화**,
   예상 결과와 가정을 확인한다. 로컬 모델은 1–3개×최대 5단계, 연결 모델은 최대 4개×5단계다.
   각 단계의 **소스 · 1.2 · L…** 버튼은 Host가 확인한 원본 줄을 편집기에서 연다.
5. 원본 줄 끝에 `LLM 1.2` 번호와 짧은 해설이 표시된다. 표시한 줄의 hover에서 조건,
   문장형 설명·전체 동작·판단 근거·값의 변화·예상 결과·가정을 확인한다. 한 줄의 여러 시나리오는
   표시 하나로 묶는다. 소스 내용은 변경하지 않는다.

소스를 수정하거나 문서를 닫으면 오래된 표시를 제거한다. 최신 해설은 함수를 다시 불러와
생성한다. 편집기 제목의 지우기 버튼 또는 **Code Flow: Clear LLM Source Annotations**
명령으로 표시를 지울 수 있다. 같은 소스의 **소스** 버튼은 해당 함수·생성 언어의 검증된
캐시를 다시 표시하며 모델을 실행하지 않는다. `projectAnalyzer.functionNarratives.sourceDecorations`
설정으로 표시를 끌 수 있다. Git 비교의 이전 리비전 문서는 현재 파일의 표시를 지우지 않는다.

VS Code 연결 모델을 쓰려면 `projectAnalyzer.functionNarratives.provider`를 `vscode`로 바꾼다.
여러 등록 모델 중 선택하며 필요한 접근 동의는 VS Code UI를 따른다. 접근 실패, 잘못된
응답 또는 timeout 후 재시도는 다른 모델을 선택할 수 있다. 로그인·API key를 자동 처리하지 않는다.

기본 그래프 도구는 Guide·전체 보기와 접힌 **도구**다. 전체 함수 요약과 5개 읽기 질문,
기존 정적 경로 시나리오는 접힌 **분석 상세**에서 확인한다. 부모 상세를 닫으면 해당 시나리오
계산 소비자를 해제한다. 생성 중에는 취소만 보이고 현재 언어의 완료 결과에서는 생성 버튼을
숨긴다. 언어를 바꾸면 기존 문단과 펼침 상태를 유지하고 새 언어의 생성 버튼을 제공한다.

모델이나 실행 도구가 없으면 설정 안내를 표시한다. 모델을 VSIX에 포함하거나 자동 다운로드하지
않고, 키를 보관하지 않으며, 기본 분석·화면 전환·focus·언어 전환 때 추론하지 않는다.
로컬 모드는 source를 외부로 보내지 않는다. 연결 공급자의 전송 방식은 해당 설정을 따른다.
전체 저장소를 전달하지 않는다. context가 만료되면 **함수 다시 불러오기**로 복구한 뒤 다시 생성한다.

## 근거와 한계

LLM 설명은 항상 **추론 · 실제 실행 미검증**이다. JSON 형식과 소스 위치가 제공한 스니펫
범위 안인지 확인해도 설명의 의미가 맞다는 보장은 아니다. 소스 버튼은 검토 위치이며
경로 도달이나 실행 증거가 아니다. 기존 정적 시나리오의 입력값·coverage·graph selection을
변경하지 않으며 사용자 소스를 실행하거나 LLM tool call을 제공하지 않는다.

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
  `parseFunctionNarrative`, `FunctionNarrativeProvider`, `FunctionNarrativeError`.
- `shared/functionNarratives`: portable narrative/context types 및 동일한 Host/browser runtime validator.
  `FunctionNarrativeSourcePresenter`, `buildFunctionNarrativeSourceAnnotations`는 native source 표시 계약과
  줄별 번호 그룹화를 제공한다.
- `vscode/functionNarrativeProvider`: 실제 VS Code 모델 선택, token 확인, streaming, 취소와 오류 변환.
- `llm/functionNarratives`: `createLocalFunctionNarrativeProvider`, private prompt, localized line-numbered
  input, JSON grammar, output cap 및 종료를 기다리는 공용 process queue.
- `vscode/configuredFunctionNarrativeProvider`: machine 설정과 첫 GGUF 선택, local/VS Code provider 연결.
- `vscode/functionNarrativeDecorations`: 한 번에 검증된 결과 하나만 유지하는 native adapter.
  전체 문서의 hash, 실제 file URI와 표시 소유권을 확인하고 편집·닫기·설정 해제 때 지운다.
- `webview/codeFlow/functionNarrativesHostDelivery`: snapshot별 최대 8개 context, locale별 결과,
  단일 pending 요청과 45초 deadline, evidence token projection.
- `webview/functionNarratives`: inert reading section, strict reply correlation, bounded DOM,
  literal prose, locale/focus retention, disposal cancellation.
- `protocol/functionNarratives`: identity-only request/cancel, 정확한 context/locale/단계 source action,
  bounded structured result. 이전 text-only 단계도 읽으며 새 prompt는 explanation/reason/effect를 요청한다.

source context는 최대 5개/18,000자이며 결과는 최대 24,000자 JSON, 시나리오 4개×step 5개다.
시나리오의 `explanation`은 최대 1,800자다. 새 로컬 grammar에는 필수이며 이전 결과에는
선택 필드로 허용한다. 이전 결과는 기존 조건·단계·결과만 이어 문단을 구성한다.
cache는 owning surface/root의 수명에 속하고 새 snapshot 또는 disposal에서 해제한다.
주변 상수/helper까지 content identity에 포함한다. 확장이 백그라운드 모델을 유지하지 않는다.

## 로컬 검증 모델

현재 PC의 사용자 설정은 공식 [Qwen2.5-Coder-1.5B-Instruct-GGUF](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF)의
Q4_K_M 파일을 사용한다. 모델은 `.local-models/`에 별도로 보관하며 git과 VSIX에서 제외한다.
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
