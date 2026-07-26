# Product

<!-- impeccable:product-schema 1 -->

> 근거 범위: 사용자가 이번 대화에서 “AI 도움 없이도 시각화만으로 코드를
> 파악”하는 목표를 직접 확정했다. 그 외 제품 사실은 `README.md`, `SPEC.md`,
> `package.json`, 현재 구현과 test에서 확인한 repository evidence다. 사용자
> 연구 수치, 조직·숙련도 분포, 공식 접근성 등급은 확인되지 않았으며 아래에서
> 미결정으로 표시한다.

## Platform

web

Project Analyzer의 사용자 인터페이스는 VS Code 데스크톱 Extension Host 안에서
동작하는 Webview다. 일반 브라우저용 웹 애플리케이션이나 VS Code Web Extension은
현재 제품 범위가 아니다. 이 사실은 `package.json`의 VS Code contribution과
`README.md`의 설치·실행 조건을 근거로 한다.

## Users

주 사용자는 처음 보거나 오래되어 기억이 흐려진 코드베이스를 읽는 개발자다.
사용자는 함수 하나, 진입점 하나, 또는 모듈 책임 하나에서 시작해 다음 질문에
답하려 한다.

- 이 동작은 어디서 시작하고 어디서 끝나는가?
- 어느 조건에서 실행 경로가 갈라지거나 다시 합쳐지는가?
- 어떤 값이 정의되고, 바뀌고, 소비되거나 외부로 전달되는가?
- 호출, 렌더, 이벤트, 동적 코드 경계 뒤에는 어떤 코드가 이어지는가?
- 각 관계를 실제 소스의 어느 위치에서 검증할 수 있는가?

현재 요청에서 사용자는 AI 설명이 없어도 시각화 자체만으로 인간이 코드를
파악할 수 있어야 한다는 목표를 명시했다. 팀 규모, 숙련도 분포, 접근성 보조기기
사용 비율은 아직 확정되지 않았다.

## Product Purpose

Project Analyzer는 낯선 코드의 구조와 가능한 실행 흐름을 bounded,
source-backed 시각화로 바꾸어 개발자가 직접 읽고 검증하도록 돕는다. 성공은
많은 분석 정보를 한 화면에 나열하는 것이 아니라, 사용자가 다음 관계를
스스로 설명하고 소스로 확인할 수 있는 상태다.

- 주 실행 흐름과 대안 경로
- 결정, 반복, 예외, 종료
- 값의 정의·변경·소비·sink
- 함수 호출, 렌더, 이벤트 dispatch, embedded code 경계
- exact, inferred, unresolved 사이의 확실성 차이

## Positioning

제품은 전체 저장소의 raw graph나 AI가 만든 요약에서 시작하지 않는다. 사용자가
선택한 구체적인 함수나 진입점에서 시작해 질문에 필요한 범위만 반복 기반으로
탐색하고, 모든 보이는 단계에 source evidence와 confidence를 유지한다. 따라서
시각적 설명과 원본 코드 검증이 같은 작업 흐름 안에 있고, 정적 분석을 관찰된
런타임 실행으로 가장하지 않는다.

## Operating Context

- 사용자는 VS Code 편집기에서 커서를 함수 안에 놓고 **Visualize Current
  Function**을 실행하거나, Code Flow Reader에서 구체적인 함수를 선택한다.
- Function Visualizer는 별도 editor tab의 bounded graph workspace로 열린다.
- 사용자는 node와 branch를 선택하고, pan/zoom하고, 값을 추적하고, 연결된 함수나
  handler를 같은 canvas에 점진적으로 붙이고, exact statement를 편집기에서 연다.
- 분석은 로컬 workspace와 현재 문서 snapshot을 대상으로 하며 unsaved edit도
  포함할 수 있다.
- 분석과 시각화는 코드 읽기를 돕는 정적 도구다. Webview의 scenario 계산은
  제한된 안전한 표현식만 다루며 사용자 소스나 dynamic code를 실행하지 않는다.

## Capabilities and Constraints

- TypeScript, JavaScript, JSX/TSX, Python, Java, F#, OCaml, Elixir의 서로 다른
  수준의 Function Logic 분석을 제공한다.
- control flow, branch choice, loop, mutation/effect, value flow, scenario value,
  call/render/event drill, compound body focus, static embedded-code program을
  하나의 source-first 읽기 모델에 결합한다.
- **Function Guide**는 선택한 함수의 source documentation, owner 구조,
  architecture evidence, bounded entrypoint/direct caller/callee relation, Function Logic을
  결합해 코드베이스 위치·입력·결정·작업·종료를 5개 질문으로 안내한다. 기존의 static
  input case 비교는 그 안의 progressive-disclosure 도구이며, LLM, network, token,
  source execution은 사용하지 않는다. 불확실한 값·지원하지 않는 연산·budget은 gap으로
  보인다.
- graph는 설정과 분석 budget으로 제한한다. 전체 repository graph를 Function
  Logic 기본 화면으로 렌더링하지 않는다.
- graph traversal과 hierarchy 계산은 queue/stack, visited set, depth/node budget을
  사용하는 반복 알고리즘이어야 한다.
- exact, inferred, unresolved 의미를 합치지 않으며, 정적 가능 경로를 실제 실행
  순서나 빈도로 표현하지 않는다.
- UI는 VS Code semantic theme, UI/editor font setting, keyboard와 editor
  interaction 관례를 보존해야 한다. 별도 폰트나 독립 브랜드 palette는 사용하지
  않는다.
- analyzer, application projection, protocol, Webview 표현은 명시적 계약으로
  분리한다. Webview는 파일 시스템이나 VS Code API에 직접 접근하지 않는다.
- formal usability benchmark와 정식 접근성 적합성 등급은 아직 미결정이다.

## Brand Commitments

- 제품명은 **Project Analyzer: Code Flow**다.
- 문구는 source-first, 구체적, 검증 가능하고 과장하지 않는 어조를 사용한다.
- “observed”, “executed”, “will happen” 같은 런타임 확정 표현은 실제 관찰
  데이터가 없는 정적 경로에 사용하지 않는다.
- UI는 VS Code 안의 전문 개발 도구처럼 보여야 하며, 외부 SaaS dashboard,
  cyberpunk terminal, 게임화된 graph, AI chat shell처럼 보이면 안 된다.

## Evidence on Hand

- `README.md`: 제품 목적, 지원 언어, 주요 사용자 흐름과 Function Visualizer 기능
- `SPEC.md`: bounded graph, source evidence, Function Logic, embedded code, value
  flow, viewport, Inspector의 상세 계약
- `DESIGN.md`: 선택된 lexical value의 정적 흐름 playback에 대한 기존 디자인 계약
- `src/test/fixtures/functionLogic/`: 언어·제어 흐름·embedded code를 포함한 실제형 fixture
- `src/test/unit/`: analyzer, layout, protocol, Webview interaction, architecture test
- `media/project-analyzer.svg`, `media/project-analyzer-icon.png`: 현재 제품 아이콘

실사용자 인터뷰, task-completion 시간, 오류율, 접근성 사용자 테스트, heatmap,
상용 고객 증언은 현재 저장소에 없다. 향후 UI 문서나 화면은 이를 꾸며내면 안 된다.

## Product Principles

1. **시각화가 먼저 설명한다.** AI나 장문의 안내를 읽기 전에 구조, 방향, 변화,
   경계가 눈으로 구분되어야 한다.
2. **질문에 필요한 범위만 보인다.** bounded 시작점과 점진적 확장으로 전체
   graph의 복잡도를 사용자에게 전가하지 않는다.
3. **확실성과 근거를 보존한다.** 가능한 관계와 확인된 관계를 구분하고, 사용자가
   소스에서 즉시 검증할 수 있게 한다.
4. **맥락을 잃지 않고 집중한다.** focus를 좁힐 때 주변 구조와 공간 위치를
   유지하여 사용자의 정신적 지도를 깨지 않는다.
5. **전문가의 속도와 초심자의 발견 가능성을 함께 지킨다.** 직접 조작, keyboard,
   progressive disclosure, 설명 가능한 상태를 같은 기능에 제공한다.
6. **정적 추론의 한계를 숨기지 않는다.** Function Guide의 source basis, confidence,
   Unknowns & Limits를 함께 보여 주고 가능한 경로를 runtime 결과처럼 표현하지 않는다.

## Accessibility & Inclusion

현재 구현과 제품 계약은 keyboard 접근, visible focus, reduced motion, forced
colors, 색 이외의 shape/dash/text 단서, 긴 코드·식별자 보존을 요구한다. 복잡한
graph는 그 자체만으로 접근 가능한 표현이 아니므로 순서형 텍스트/목록 대안을
제공해야 한다. 정식 WCAG 적합성 목표와 screen-reader 사용자 테스트 범위는
구현 플랜에서 제안하되 제품 결정으로는 아직 미확정이다.
