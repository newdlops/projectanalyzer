# 함수 따라 읽기 UI 검증

## 0.0.1105: 정적 근거와 문장 연결

2026-10-05, 이미 계산한 Function Logic·Tutor의 근거를 LLM context에 연결했다.
화면 구조, CSS, 생성·소스 메시지 계약은 0.0.1104와 같다.

- 최종 VSIX를 기본 VS Code에 다시 설치했다. manifest와 변경된 런타임 모듈 13개의
  설치 파일이 빌드 출력과 일치했고 설치 목록의 `0.0.1105`를 확인했다.
- 이 프로젝트의 `Example.kt`를 다시 로드하고 실제 사용자 설정의 1.5B 모델로 한국어
  설명을 생성했다. 생성 중 취소에 포커스가 있었으며 완료 후 생성 버튼이 숨겨졌다.
  disabled/priority/ordinary 문단 3개와 접힌 소스 근거를 실제 accessibility tree에서 확인했다.
- 첫 설치 후보의 실제 스크린샷에서 전체 본문을 전달한 Kotlin 함수에도 코드 생략 안내가
  나타나는 문제를 확인해 수정했다. 최종 설치본의 새 응답에는 해당 안내가 없었다.
  symbolic 분석 한계와 source excerpt 생략을 별도 flag로 관리한다.
- 첫 근거를 펼쳐 **소스 · 1.1 · L3–3**을 눌렀고 `Example.kt` 편집기가 활성화되는 것과
  **Clear LLM Source Annotations** 동작이 등록된 것을 확인했다. 완료 후 모델 프로세스는
  남아 있지 않았다. 최종 화면 캡처와 native hover는 사용자의 다른 VS Code 창 작업으로
  수행하지 못했다.

세 viewport의 production HTML과 native hover 검증은 아래 0.0.1104 기록을 유지하며 이번에
재검사하지 않았다. 최종 TypeScript unit은 916개 중 912개 통과했고 기존 실패 4개는 같다.
새 근거 연결 테스트 11개, Rust 82개, 패키징 script 13개와 typecheck는 통과했다.
최종 VSIX는 493개 파일, archive 3.57MiB, unpacked 15.31MiB로 기존 상한을 통과했다.
실제 문장의 상세 guard/계산 오류는 [모델 검증 기록](FUNCTION_NARRATIVES.md)에 남겼다.

## 0.0.1104: 간단한 기본 화면과 문장형 설명

2026-10-05, Function Visualizer와 공용 Function Logic 렌더러를 함께 변경했다.
기본 header는 Guide·전체 보기와 접힌 도구를 표시한다. 목차·Inspector·확대·범례는 도구에서
펼친다. Guide는 짧은 source-backed purpose와 명시적 설명 생성부터 보여주고, 전체 정적 요약·
질문·경로 시나리오는 접힌 분석 상세에서 읽는다. 좁은 화면에서는 Guide를 그래프 위에 둔다.
LLM 시나리오는 연결된 문단으로 읽고 단계별 소스 근거는 별도로 펼친다.

| 검증 경계 | 실제 확인 |
| --- | --- |
| TypeScript 전체 unit | 905개 중 901개 통과, 기존 실패 4개 유지 |
| Rust / 패키징 script / 타입 | 82/82, 13/13, typecheck 통과 |
| 회귀 재현 | Guide open/closed·Guide/Code 독립 스크롤 재배치, pending/stale 포커스 RED→GREEN |
| 소스 표시 | 문단을 untrusted Markdown의 literal text로 전달, 기존 native lifecycle 테스트 5/5 |
| 기본 production HTML | Safari 390×844, 768×1024, 1440×900에서 새 기본 화면과 줄바꿈 확인 |
| 생성 결과 | 실제 3B Kotlin 응답을 재생해 문단·생성 언어·미검증 표시와 접힌 소스 근거 확인 |
| 긴 설명 | synthetic 4개×5단계와 긴 문단을 같은 세 크기에서 확인; 문서 가로 overflow 없음 |
| 상호작용 | 도구 열기/닫기, 확대·전체 보기·목차, 근거 펼침·locale 유지, 생성/취소 확인 |
| 예외 상태 | synthetic 모델 없음·invalid-response·stale/명시적 reload, 인자 없는 Kotlin, 분석 로딩·실패·정상 복원 확인 |

계측된 화면 오류는 0개였다. 기본 화면의 시나리오 workspace acquire는 0이며, 부모 분석 상세를
닫으면 consumer를 해제하고 locale 변경 때 재시작하지 않는 동작은 production browser source의
unit test로 확인했다. 실제 로컬 모델 추론 4회는 HTML 재생과 별도로 실행했고 의미 오류도
기록했다. 자세한 모델 응답과 한계는 [FUNCTION_NARRATIVES](FUNCTION_NARRATIVES.md)를 따른다.

UI 디자인 워크플로와 Impeccable의 distill/craft 검토를 적용했다. 기계 검사에는 기존 Guide의
선택 경로를 표시하는 3px 왼쪽 테두리 1건이 남았다. 이는 기존 의미 표시를 유지한 항목이다.
Web Interface Guidelines의 focus/숨김/native disclosure/줄바꿈 기준으로 변경 코드를 검토했고
리뷰에서 발견한 hidden action focus와 retained Guide 상태 문제를 수정했다. 이번 검증에서
light theme·forced colors·전체 키보드 사용자 흐름을 별도로 재검사했다는 의미는 아니다.

0.0.1104를 기본 VS Code에 설치하고 이 프로젝트의 Kotlin `classifyOrder`를 열었다.
새 기본 도구와 열린 Guide, 접힌 분석 상세를 확인했으며 사용자 설정의 실제 1.5B 모델로
한국어 설명 3개를 생성했다. 생성 중 포커스는 취소에 있었고 완료 후 생성 버튼은 숨겨졌다.
근거를 펼쳐 Tab으로 소스 버튼에 이동한 뒤 Enter로 원본 L3–4를 열었다. 편집기의 native
hover에서 시나리오 문단과 단계 해설을 확인했고, Guide로 돌아와 근거를 다시 접었다.
추론 완료와 소스/hover 확인 뒤 `llama-completion` 프로세스가 남아 있지 않았다.
이 확인은 소스 위치와 UI 연결 검증이다. 모델이 비활성/priority 단계에도 ordinary 줄을
인용하는 의미 오류가 있었으므로 내용 정확성은 별도 검토해야 한다.

임시 production fixture와 실제 모델 보고서는 `/private/tmp/projectanalyzer-llm-visual-qa.cjs`,
`/private/tmp/projectanalyzer-simple-prose-report.json`에 있다. 테스트·패키징 로그는
`/private/tmp/projectanalyzer-simple-ui-final-unit.log`, `projectanalyzer-simple-ui-rust.log`,
`projectanalyzer-simple-ui-package.log`에 보존했다. fixture와 모델은 제품 배포에 포함하지 않는다.

## 0.0.1088: 함수 따라 읽기 개편 기록

2026-09-07, Function Visualizer와 공용 Function Logic 렌더러의 읽기 흐름 개편 기록이다.

## 변경된 사용자 흐름

함수를 열면 시작 지점을 선택한 상태로 그래프를 보여 준다. 넓은 화면에서는 `함수 따라 읽기`
목차와 `코드 이해` 패널을 함께 표시한다. 목차에서 전체/분기/호출/종료를 고르고 코드 단계를
선택하면 같은 그래프 노드와 소스 근거를 확인할 수 있다. 이전/다음과 방향키는 목차의 소스
순서를 따른다. 이는 실행 순서나 실행 결과를 보장하는 탐색이 아니다.

Inspector는 `코드 이해`, `값과 경로`, `함수 정보`로 나눈다. 입력 컴포넌트를 유지한 채 탭을
전환하고 스크롤 위치를 각각 저장한다. 값 탭을 떠나면 해당 Scenario consumer를 해제하고
재생을 일시정지한다. Function Guide의 입력 불러오기는 `값과 경로`로 연결된다.

새 목차의 public API와 최대 400개 항목 제한은 [SPEC](../SPEC.MD)의
`webview/codeFlow/reading`에, 디자인 방향과 수용 기준은 [DESIGN](../DESIGN.md)에 기록했다.

## 기능 검증

| 확인 | 결과 |
| --- | --- |
| TypeScript `npm run check`, 최종 `npm run compile` | 통과 |
| 읽기 모델, Inspector, Function Visualizer, Code Flow, 관련 architecture 테스트 | 70/70 통과 |
| Rust 엔진 테스트 | 82/82 통과 |
| 패키징 스크립트 `npm run test:package` | 12/12 통과 |
| 전체 `npm test`의 unit 단계 | 616개 중 611개 통과, 5개 실패 |
| `git diff --check` | 통과 |

70개 UI 테스트에는 기존 child attachment, locale refresh, source action 회귀 검증과 새 목차의
소스 순서/중복/순환 parent/없는 layout ID/400개 한계 검증이 포함된다. Inspector 테스트는
큰 패널을 숨겼을 때 브라우저가 scrollTop을 축소하는 상황도 재현한다.

전체 테스트에서 실패한 항목은 이번 UI 작업에서 수정하지 않은 다음 테스트에 있다.
시작 시점에 analyzer와 Scenario 관련 미커밋 변경이 있었으며, 이 기록은 clean 기준점과의
전체 비교를 수행했다는 의미가 아니다.

| 테스트 | 관찰한 실패 |
| --- | --- |
| `functionTutor.test.ts`: type baseline bypasses unknown dynamic callsite arguments | 빈 문자열/배열 기대값과 `sample`/타입 기반 배열 대표값의 차이 |
| `functionTutor.test.ts`: builds nested object input representatives | 중첩 객체의 문자열/배열 대표값 기대 차이 |
| `functionTutor.test.ts`: advanced private Scenario calls | 예상한 `true` 반환 대신 unresolved 호출이 포함된 unknown 결과 |
| `functionTutor.test.ts`: logical-return continuations | 예상한 `true` 대신 `false` 반환 |
| `sourceHighlightArchitecture.test.ts`: explicit Inspector actions | Module Flow 소스 형태를 검사하는 정규식 불일치 |

unit 단계 실패로 `npm test`의 package 단계는 실행되지 않아 `npm run test:package`를 따로 실행했다.

## 실제 렌더링과 상호작용

앱 내 Browser 런타임에서 사용 가능한 브라우저 목록이 비어 있어 별도의 새 Playwright Chromium을
사용했다. 실제 analyzer → application projection → production Webview HTML을 로컬에서 렌더링하고
VS Code 테마 토큰을 주입했다. `acquireVsCodeApi` 경계만 메시지 기록용으로 대체했다.
브라우저 page/console 오류와 실패한 네트워크 요청은 없었다.

| 화면/상태 | 실제 확인 내용 |
| --- | --- |
| 1440×900, 768×1024, 390×844 | 초기 펼침 상태, 목차 필터/빈 결과, 행 선택, 이전·다음, 방향키/End, 그래프 선택 동기화 |
| 같은 세 크기 | 탭 키보드 이동, 입력값 유지, 추천 입력, 한국어→영어 전환 중 포커스와 필터 유지 |
| 같은 세 크기 | 명시적 Scenario 시작, Apply & Play, 값 탭 이탈 시 일시정지, 복귀 시 자동 재생하지 않음 |
| 같은 세 크기 | Guide 전환/질문/닫기와 포커스 복원, 명시적 소스 열기 메시지 |
| 큰 함수, 같은 세 크기 | `complexOrderWorkflow.ts`의 `processComplexOrderBatch`: 94개 단계, 분류상 분기 22개, End 포커스/스크롤, 필터와 다음 이동 |
| 320×844, 390×844 터치 에뮬레이션 | 44px 터치 버튼, 열린 목차의 122px/140px 스크롤 영역, 가로 넘침 없음 |
| 390×844 예외 상태 | 긴 함수명/코드, 빈 분석, 로딩, 실패 안내와 다시 분석 → 정상 상세 응답 복구 |
| 1440×900 | 밝은 테마의 선택/hover 대비, forced colors, reduced motion, 키보드 포커스 |
| 1440×900 탭 스크롤 | 값 패널 300px → 짧은 함수 정보 패널 → 값 패널 300px 복원 |

좁은 화면의 Inspector는 그래프 아래에 배치하며 페이지 세로 스크롤로 접근한다. 가로 넘침은
위 화면들에서 문서 전체 폭을 측정했고 스크린샷을 별도로 검토했다. 목차·표·상세 패널의
내부 스크롤은 의도된 동작이다.

검증 중 발견해 수정한 문제는 숨긴 Guide/탭이 CSS display 선언으로 노출되는 현상,
조건 표의 다음 대상 열 축소, 밝은 테마의 선택 hover 대비, Guide의 잘못된 grid 행,
터치 목차 높이 부족, 탭 전환 시 스크롤 초기화다. Impeccable 기계적 검사에서는 검출 항목이
없었고, [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md)
기준으로 숨김/포커스/키보드/넘침/테마를 검토했다.

로컬 QA 자료는 `/private/tmp/projectanalyzer-reading-qa/`에 있다. `preview.cjs`가 생성 HTML을
제공하고 `capture.cjs qa`, `dense`, `compact`, `scroll`이 브라우저 검증을 수행한다.
`qa-results.json`, `dense-results.json`, `compact-results.json`, 화면 PNG와 테스트 로그를 보존했다.
이 임시 harness는 로컬 Playwright 설치 경로를 사용하며 제품 빌드에 포함하지 않는다.

## 0.0.1088 설치 검증

사용자의 후속 설치·커밋·푸시 요청에 따라 manifest와 lockfile을 `0.0.1088`로 맞추고
CHANGELOG를 갱신했다. `release:check`와 Rust format check를 통과했다.
패키징에서 개발용 `.plan` 문서 유입을 발견해 `.vscodeignore`에 제외 규칙을 추가했다.

최종 `function-analysis-0.0.1088-darwin-arm64.vsix`는 396개 파일, archive 3.17 MiB,
unpacked 13.40 MiB로 패키지 검사를 통과했다. 기본 VS Code와 별도의 비어 있는 임시
user-data/extensions 디렉터리에 설치했고, 기본 설치 목록에서
`newdlops.function-analysis@0.0.1088`을 확인했다. 설치된 읽기 목차/탭/시나리오/번역 모듈이
빌드 출력과 같은지, 설치 경로의 모듈로 실제 HTML을 생성할 수 있는지, native analyzer의
실행 권한도 확인했다. UI 70개와 패키징 스크립트 12개 테스트는 통과했으며 앞서 기록한
전체 테스트 실패 5건은 수정하지 않았다.

## 0.0.1090 선택 시 흐림 회귀 수정

목차에서 큰 선언문을 선택할 때 전체 그래프 배율이 자동으로 줄어드는 현상을 재현했다.
94단계 fixture에서 1440px 화면은 100% → 약 47%, 768px는 약 33%, 390px는 약 24%로
바뀌었다. 별도로 일반 선택이 주변 edge/label을 불투명도 0.28로, 일부 context node를
0.78로 표시하는 것도 확인했다.

목차와 한눈에 이해의 명시적 source 이동은 배율을 유지한다. 큰 block은 첫 줄이 보이도록
이동하며 기존 Fit 기능은 전체 보기에 사용할 수 있다. 일반 읽기에서는 node/edge/label의
불투명도를 1로 유지하고 선택 테두리와 연결선 굵기로 현재 위치를 구분한다. 명시적인 분기
선택과 본문 focus의 제외 표시는 유지한다. 고대비 테마의 SVG 연결선이 면으로 채워져
그래프를 가리던 문제도 수정하고 선택 node에 시스템 Highlight 외곽선을 표시했다.

- 관련 unit 70/70, 패키징 스크립트 12/12, TypeScript check/compile, release metadata 통과.
- 실제 production HTML을 새 Playwright Chromium에서 1440×900, 768×1024, 390×844로 검증.
  앱 내 Browser는 연결 가능한 브라우저가 없어 사용하지 못했다.
- 일반 함수와 94단계 함수에서 펼치기, 행 선택, 이전/다음, End 이동 후 computed opacity 1과
  배율 100% 유지 확인. 사용자가 확대 버튼으로 지정한 125%도 목차와 overview 이동에서 유지.
- 직접 분기 선택 시 제외 경로 표시와 reset 복구, 필터/빈 결과, 키보드, 언어 전환, 값 보존,
  Scenario 재생/일시정지, Guide, 로딩/오류/복구 확인. 문서 가로 넘침과 브라우저 오류 없음.
- 밝은 테마 및 forced colors/reduced motion 스크린샷 검토. 고대비의 일반/선택 연결선은
  computed `fill: none`이며 선택 node의 외곽선이 보임을 확인.

이번 수정은 관련 테스트에 한정하여 검증했고 전체 suite 및 Rust 테스트는 재실행하지 않았다.
앞서 기록한 전체 suite의 기존 실패 5건은 이번 수정 범위에 포함하지 않는다. 재현 자료와
최종 결과는 같은 임시 QA 폴더의 `before-contrast-results.json`, `fixed-contrast-results.json`,
`reading-regression.log`, `fixed-*-contrast.png`, `1440-forced-colors*.png`에 보존했다.

`function-analysis-0.0.1090-darwin-arm64.vsix`는 410개 파일, archive 3.20 MiB,
unpacked 13.48 MiB로 패키지 검사를 통과했다. 기본 VS Code에 설치했고 설치 manifest의
버전 `0.0.1090`과 수정한 읽기/viewport/강조/고대비 관련 8개 모듈의 빌드 출력 일치를 확인했다.

## 확인하지 않은 경계

실제 VS Code Extension Development Host에서의 웹뷰 연결, 소스 editor reveal 및 장식,
OS 스크린리더, 실제 터치 장치는 이번 검증에 포함하지 않았다. 소스 열기와 다시 분석은
브라우저에서 올바른 기존 프로토콜 메시지가 나가고 응답에 따라 UI가 복구되는 범위까지 확인했다.
child attachment의 회귀 검증은 unit runtime에서 수행했으며 실제 브라우저의 Host 왕복을 검증한
것은 아니다. 위 analyzer/Module Flow 테스트 실패 5건도 남아 있다.
