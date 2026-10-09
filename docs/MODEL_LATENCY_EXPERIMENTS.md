# 모델 준비 이후 전체 설명 시간 실험

목표는 모델 준비 이후 소스 입력 처리부터 **전체 설명 완료**까지 3초다. 첫 token, 캐시
응답이나 source-only 결과는 실제 모델 생성의 성공으로 세지 않는다. 함수 호출의 원문,
조건, 반환, 부수 효과, 다섯 상세 항목과 전체 요약을 유지한다.

## 2026-10-09 후속 비교

제품 상태는 `aa95940` / 0.0.1142이며 이 실험으로 managed default나 사용자 설정을
변경하지 않았다. Apple M5 Pro / 48 GiB에서 실제 모델을 사용했다. 공급된 공개 코드는
데이터로만 읽고 실행하지 않았다. 프로세스는 각 실험 종료 때 해제했다.

이 단계에서는 기존 0.8B·1.5B·2B·4B 비교에 더해 다른 구조의 Qwen3 1.7B를 검증했다.
고정된 한두 개 코드 예시로 출력 형식을 보여주고, 실제 원문과 조건·인수·confidence·
source 제한을 별도로 제공했다. 예시와 실제 소스의 이름·계산식·조건은 서로 다르다.
예시를 복사한 답변은 정확한 설명으로 간주하지 않는다.

### GGUF

원본은 [ggml-org Qwen3 1.7B](https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF/tree/daeb8e2d528a760970442092f6bf1e55c3b659eb)다.

- revision: `daeb8e2d528a760970442092f6bf1e55c3b659eb`
- 파일: `Qwen3-1.7B-Q4_K_M.gguf`
- bytes: `1282439264`
- SHA-256: `d2387ca2dbfee2ffabce7120d3770dadca0b293052bc2f0e138fdc940d9bc7b5`
- llama.cpp: build `10964`, commit `b29c606e2`

Qwen3의 공식 non-thinking assistant 접미부를 시험 어댑터에 적용했다. 실제 생성은
기존 context 8,192, 출력 2,400 token, thread 2, seed 42, temperature 0.2를 사용했다.
모든 항목을 받은 뒤 기존 Host parser로 언어·길이·고정 인자 전달과 다섯 필드를 검사했다.

반환식 `value + 5`, catch의 0, `observe(value)`와 미구현 동작을 함께 설명하는 응답이
이전 소형 모델보다 많았다. 그러나 일부 응답은 예시의 `x - 4`, -99나 `notify(x)`를
실제 함수의 flow에 섞거나 finally를 반환 이후로 표현했다. 형식 검증만으로 이 오류를
잡을 수 없었다. 전체 응답은 실험 조합에 따라 약 1.74–10.48초였으며 3초와 의미 정확성을
함께 충족했다고 결론 내릴 근거는 없다.

추가 비교는 다음과 같다. 서로 다른 실험의 최소값 하나를 제품 성능으로 제시하지 않는다.

- `mmap+mlock`과 소스 없는 초기 warmup: TS/KO 7.98초, TS/EN 10.48초,
  Kotlin/KO 6.19초, Kotlin/EN 2.79초. 가중치 고정만으로 일관된 개선을 입증하지 못했다.
- `poll=50`과 cleanup 출력 예시 하나: 4.40 / 1.74 / 4.35 / 4.42초.
  출력 예시 수도 달라 polling 하나의 효과로 분리할 수 없다. 예시를 잘못 복사한 flow가
  있어 빠른 한 건도 완료 기준의 성공이 아니다.
- decoder의 문자열 pattern/maxLength만 단순화하고 Host 검증을 유지한 비교:
  5.51 / 7.99 / 5.35 / 2.45초. 의미 오류가 남아 채택하지 않았다.
- 일반 JSON grammar: production wire/Host 검증에서 `invalid-response`로 거부됐다.

현재 하드웨어 자체의 속도와 형식 비용을 분리하려고 `llama-bench`도 실행했다.
`-pg 1000,180 -t 2 -r 2`의 두 native 결과는 2.84초와 7.87초였다. 실제 설명이나
의미 정확성을 검증한 결과는 아니며, 이에 근거해 설명이 3초에 완료된다고 주장하지 않는다.
관측 시점의 시스템 압축 메모리는 약 22GB였고 다른 프로세스의 CPU 부하도 높았다.
이 관측만으로 특정 설정이나 프로세스를 원인으로 확정하지 않는다. 다른 작업을 종료하거나
사용자의 시스템 설정을 변경하지 않았다.

### MLX + LLGuidance

Apple GPU 실행 경로도 별도 시험 환경에서 확인했다. 제품의 preinstalled runtime,
자동 다운로드, 취소·FIFO·idle cleanup 계약에 아직 통합하지 않았다.

- 모델: [공식 Qwen3 1.7B MLX 4bit](https://huggingface.co/Qwen/Qwen3-1.7B-MLX-4bit/tree/21457c6f51ed54a7c16e988c0844db973815c137)
- revision: `21457c6f51ed54a7c16e988c0844db973815c137`
- `model.safetensors`: `914316100` bytes,
  SHA-256 `42e688d626b3e144bf721af7517a82f3ea7e97bb5764fef1c89942bf9165072a`
- `tokenizer.json`: SHA-256 `aeb13307a71acd8fe81861d94ad54ab689df773318809eed3cbe794b4492dae4`
- Python 3.11.15; MLX 0.32.3; mlx-lm 0.32.0; LLGuidance 1.9.1

가중치와 tokenizer의 SHA-256을 확인했다. 실행 가능한 remote model code는 허용하지
않았다. 다운로드의 TLS 검증은 시스템 인증서로 유지했다. 모델 로딩, tokenizer/grammar
준비와 소스 없는 GPU 초기 계산 뒤 실제 원문을 입력했다. 제약 schema는 기존 wire와
같았고, stream을 내부적으로 모아 JSON 전체가 완성된 뒤에만 완료 시간을 측정했다.

| 입력 | 준비 이후 전체 응답 | 생성 token | 기존 Host 형식·언어·길이 검증 |
| --- | ---: | ---: | --- |
| TypeScript / 한국어 | 7.25초 | 230 | 통과 |
| TypeScript / 영어 | 6.36초 | 188 | 통과 |
| Kotlin / 한국어 | 5.24초 | 239 | 통과 |
| Kotlin / 영어 | 4.68초 | 206 | 통과 |

Host가 소유한 callId/inputs를 복원한 뒤 다섯 항목을 모두 확인했다. 반환식, catch의 0,
정확한 cleanup 인수와 미구현 동작을 검사했으며 TS/EN은 `sourceLimited`를 실제 코드의
guard로 서술해 거부했다. 다른 세 응답의 필수 구문 체크 통과도 자연어의 모든 의미를
증명하는 것은 아니다. 네 조합 모두 3초를 넘었다.

## 정적 조건 복원과 작업별 추가 학습

간결한 지시문, 상세 항목을 먼저 쓰는 순서, 구조화된 반환·효과, 항목별 질문을 시험했다.
일부 작은 모델 응답은 3초 안에 끝났지만 catch 반환이나 정확한 finally 인수를 누락하고
반환 계산을 변수 변경으로 설명했다. 이러한 실험용 입력 변경은 제품 코드에서 되돌렸다.
보조 0.8B로 4B를 검증하는 speculative decoding 실험도 전체 응답 3초를 만족하지 못했다.
새 실행 방식과 모델을 기본값으로 적용하지 않았다.

남긴 변경은 짧은 정적 도달 조건의 Host 복원과 conventional Qwen3의 non-thinking
assistant 접미부다. 조건 문구는 원문에서 확인한 모든 guard·loop와 deferred/dispatch
불확실성을 보존할 때만 고정하며, 다른 생성 필드와 전체 설명을 생략하지 않는다.
관련 호출/provider/전송 테스트 67개를 통과했다. 제어 문자와 escaped Kotlin 식별자를
고정 문구에 넣을 수 없는 경우 기존 모델 필드로 돌아가는 조건도 확인했다.

현재 기본 4B를 원래 production prompt와 전체 Host 검증으로 다시 측정한 결과는 다음과
같다. 준비 시간은 제외하고 입력 처리부터 전체 설명 완료까지 측정했다.

| 측정 | 결과 |
| --- | ---: |
| TypeScript/Kotlin × 한국어/영어 × 두 이름 변형 | 8건 |
| 전체 설명 시간 | 4.39–7.09초 |
| 3초 이내 | 0건 |
| 반환·catch·정확한 정리 인수·미구현 동작의 필요 조건 체크 | 2건 |

필요 조건 체크를 통과한 두 건도 모든 문장의 의미를 입증한 결과는 아니다. 기본 모델
교체나 목표 달성의 근거로 사용하지 않는다. 임시 폴더가 정리된 뒤의 재측정 결과는
`.local-models/experiments/three-second`에 보관했다. benchmark의 마지막 선택 인자로
출력 폴더를 지정할 수 있어 중단·재시작 후에도 raw response와 report를 확인할 수 있다.

후속 단계는 공식 Qwen3 1.7B MLX 4bit의 동일 revision/hash를 사용하는 별도 LoRA
실험이다. 실제 사용자 코드는 학습하지 않는다. 계산, 분기, 지역 변수 변경, while,
catch/finally, 구현 누락과 잘린 원문을 구분한 합성 학습 384건과 별도 검증 64건의 정답을
기존 Host parser와 wire decoder로 확인했다. 평가 함수의 이름과 `value + 5`/catch 0은
학습에 넣지 않았다. 원문을 자르지 않고 최대 1,784 token을 유지한다. 8 GiB의 프로세스
메모리 상한과 output loss masking을 사용한 두 단계 pilot은 학습·저장 경로를 확인했다.
loss나 저장 성공은 의미 정확성·전체 기능 검증·3초 목표의 달성을 입증하지 않는다.
학습 결과는 제품과 사용자 모델 설정에 적용하지 않았다.

같은 원문·schema·sampler로 준비 후 tokenization, 전체 JSON 생성, local pipe를 통한
production wire 복원/Host 검증까지 측정했다. 응답 캐시나 source-only 응답을 쓰지 않았다.
확장 프로그램에 통합한 runtime 결과가 아니라 별도 실험 실행기의 결과다.

| 1.7B MLX 실험 | 원문 필요 조건 통과 | 3초 이내 | 두 기준 동시 통과 |
| --- | ---: | ---: | ---: |
| 추가 학습 전 | 0/8 | 3/8 | 0/8 |
| 최초 60단계 추가 학습 | 1/8 | 5/8 | 0/8 |
| 숫자·이름 편중 보완 및 상세 우선 100단계 | 1/8 | 2/8 | 0/8 |

두 번째 학습은 함수 이름, 연산자와 예외 반환값을 본문 종류와 독립적으로 바꾸고
학습 1,536건/별도 검증 128건을 사용했다. 학습 loss는 내려갔지만 실제 평가에서는
제공된 대상 구현을 없는 것으로 설명하거나 catch/정리 호출을 누락했다. 원문 검사에
전체 flow의 정확한 정리 호출과 잘린 상세 문구 검사도 추가했다. 가장 빠른 값이나
학습 loss를 완료 근거로 삼지 않는다. 모델·adapter·출력 순서 변경은 제품에 적용하지
않았고 기존 기본 모델을 유지했다. 전체 시나리오와 호출 scope의 검증도 미완료다.

### 대상 원문 구분과 중복 flow 생성 제거

제공된 대상 정의를 없는 것으로 처리하는 오해를 확인해 세 가지 입력을 비교했다.
기존 입력 뒤에 대상 정의를 확인하는 문구를 붙인 경우 필요 조건 통과 2/8,
반환·효과를 먼저 출력한 경우 0/8이었다. 모든 원문과 스키마 필드를 유지한 대상별
원문 형식은 입력 token을 약 1,434→904(한국어), 968→708(영어)로 줄였지만,
그 자체의 정확도 통과는 0/8이었다. 이 형식과 제한된 전역 컨텍스트에서 대상 정의가
제공되는 반례를 추가 학습하니 반환식과 catch 0은 보존했으나 부수 호출·미확인 효과와
전체 flow의 누락이 남았다. 3초와 원문 필요 조건의 동시 통과는 0/8이었다.

다음 실험은 모델이 이미 작성한 도달 조건·전달·효과·반환을 Host가 연결해 flow를
구성하는 방식이다. source-only recipe나 기존 응답 캐시를 쓰지 않고 매번 모델이 원문을
읽는다. 다섯 상세와 부모 summary를 유지하며 모델 문장은 계속 미검증으로 취급한다.
원문 해석을 추가하거나 잘라내지 않고 600자를 넘는 전체 flow는 실패로 처리했다.

| 중복 flow 제거 실험 | 3초 이내 | 원문 필요 조건 통과 | 동시 통과 |
| --- | ---: | ---: | ---: |
| 추가 학습 전 | 7/8 | 0/8 | 0/8 |
| 해당 형식 100단계 학습 후 | 4/8 | 0/8 | 0/8 |

학습 후 정확한 정리 인수와 미구현 동작은 보존됐지만 catch 0을 누락했다. 일부 한국어
반환 설명은 같은 말을 반복하거나 잘못된 조건을 넣었다. 모델 생성과 Host 검증을 모두
마친 전체 시간으로 비교했으며 이 상태를 완료로 간주하지 않는다. source 형식, flow
projection과 새 adapter는 별도 실험에만 있고 제품에는 적용하지 않았다.

### 반환 구문 소유와 새 실제 응답 검증

0.0.1143은 parser가 확인한 모든 lexical 반환 구문과 정확한 호출부 사용을 함께 보존할
수 있을 때 local `output`을 Host가 복원한다. try/catch/finally와 분기 범위는 구문
소유일 뿐 계산값·도달·최종 완료의 증명이 아니다. caller use는 실제 같은 호출 범위에
한정하며 await 저장/반환/폐기를 구분한다. 같은 이름의 다른 함수로 복구되는 잘못된
selection도 거부한다. 불완전/누락/길이/언어/제어 문자 조건은 모델 생성으로 돌아간다.
모델에는 모든 원문 반환과 어휘적 범위를 제공하되, Host의 zero-based 좌표와 반환식
중복은 제외한다. 역할·효과·전체 summary/flow는 계속 모델이 생성한다.

Python except를 try 본문으로 잘못 분류하던 구문 근거를 수정했고, lowered try-else는
완전한 lexical 증거로 취급하지 않는다. 새 parser/formatter/wire와 기존 호출·메서드·
async/finally/connected/local/FIFO 경계의 관련 회귀 검사 120개가 통과했다. 이는 모델
자연어 의미나 3초 성능의 보증이 아니다.

새 구문 근거를 적용한 production provider의 4B 측정은 8건 모두 실제 모델 요청 1회,
다섯 상세 필드와 전체 summary/flow를 받았다. 준비 이후 완료는 **7.14–10.68초**, 3초
통과는 **0/8**이다. 반환·catch·정확한 부수 호출 인수·미구현 동작의 필요 조건 체크는
3/8이었다. 이 측정 후 모델 입력에서 중복 operands/좌표를 제외했으므로 서로 다른
입력 형식의 최소 시간을 개선율로 비교하지 않는다. 기준을 통과했다고 주장하지 않는다.

최종 압축된 원문 근거와 production provider로 conventional Qwen3 1.7B도 8건을 측정했다.
모두 실제 모델 요청과 다섯 상세·전체 summary/flow를 받았지만 정확한 부수 호출 인수나
미구현 동작을 누락했다. p95/max는 7.08초이고 3초와 원문 필요 조건의 동시 통과는 0/8이다.
기본 모델 교체의 근거로 쓰지 않는다.

별도 실험에서는 원문 효과를 구문 목록으로 보존하고 모델이 role/summary를 새로 쓰며
Host가 모든 상세를 flow에 연결하는 더 짧은 형식을 시험했다. conventional Qwen3 1.7B는
8/8을 0.58–1.74초에 끝냈으나 role을 함수 이름/콜러 분류로 쓰고 업무·로그 의미를
추정했다. 설명용 필드와 대상 이름을 분리한 2B 비교도 7/8만 3초 안에 끝났고 이름으로
업무/효과를 만들었다. 4B에서도 같은 오류와 3초 초과가 남았다. 필요 조건 검사 통과도
모든 의미의 정확성을 입증하지 않는다. 짧은 최저 시간으로 기본 모델을 바꾸지 않는다.

원문 반환을 복원한 MLX 추가 학습/flow projection 실험은 일부 영어 응답을 빠르게
만들었지만 한국어에서는 없는 지역 변경, 끊긴 문장과 반복을 확인했다. 추가 학습 후
free generation이 다시 악화되기도 했다. 모든 adapter, 효과 복원/flow projection,
설명용 wire alias와 MLX runtime은 실험용이며 제품에 포함하지 않았다. weights와 scratch
산출물은 ignored 폴더에만 유지하고 사용자 소스·설정과 managed default는 바꾸지 않는다.

### 4B의 MLX 실행 경로와 짧은 검토 단계

설치된 0.0.1143 / `c1df5ee`와 사용자 모델 설정은 이 단계에서 변경하지 않았다.
기존 원문·production prompt/wire를 그대로 사용하는 별도 MLX 4B 실행을 확인했다.
가중치는 [MLX Community Qwen3.5 4B 4bit](https://huggingface.co/mlx-community/Qwen3.5-4B-4bit/tree/0e7ffd5c629ef7719d4cbc04069232580bfa9d9c)
revision `0e7ffd5c629ef7719d4cbc04069232580bfa9d9c`로 고정했다.

- `model.safetensors`: 3,034,300,695 bytes,
  SHA-256 `5fb9acd0246866381cf8c5c354c6db1019f6498eec4ccb4f5edcc71ffeacb2db`
- `tokenizer.json`: SHA-256 `87a7830d63fcf43bf241c3c5242e96e62dd3fdc29224ca26fed8ea333db72de4`
- 원본 Qwen3.5 4B의 hidden size/layer/vocabulary/head/full-attention 설정과 일치했다.
  GGUF와 **같은 양자화 가중치**는 아니므로 실행기만의 개선율 비교로 쓰지 않는다.
- executable remote model code를 허용하지 않았다. TLS 검증을 유지한 HTTP 범위로
  중단된 byte prefix를 이어 받고, 전체 파일 SHA-256이 맞은 뒤에만 모델을 로드했다.

source-free 64-token prefill과 한 번의 incremental forward로 GPU 준비를 마쳤다.
이 준비는 사용자 코드를 읽거나 token을 sample하지 않는다. 그 뒤 매번 새 원문을
입력하고 tokenization, grammar 준비, 전체 JSON 생성과 기존 Host decode/검증을
함께 측정했다. response cache, source-only 응답, flow projection을 쓰지 않았다.

| MLX 4B full production 형식 | 결과 |
| --- | ---: |
| TypeScript/Kotlin × 두 이름 × 한국어/영어 | 8건 |
| 준비 후 전체 설명 | 7.50–13.63초 |
| 3초 이내 / 원문 필요 조건 동시 통과 | 0/8 |
| peak MLX allocation | 약 3.17 GiB |

모델은 일부 flow에서 정확한 정리 인수를 누락하고, 이름을 근거로 fee/audit 동작을
추정하거나 제공된 callee 구현을 불완전하다고 설명했다. runtime 변경을 제품에 적용하지
않는다. 작은 모델의 코드 echo도 finally가 값을 바꾼다거나 저장한다고 추정했다.
컴파일과 겹친 echo 실험의 초기 시간은 유효한 성능 비교에서 제외했다.

다음 실험은 conventional Qwen3 1.7B에서 source/prefix KV 상태를 재사용하며 내부 검토
64 tokens와 최종 응답 최대 2,336 tokens를 나눈 것이다. 합계는 기존 2,400 한도 안이며
두 요청·Host 검증을 모두 전체 시간에 넣는다. 내부 검토는 정적 사실로 승격하거나
설명으로 표시하지 않는다. 원문을 그대로 둔 검토/참조 별칭만으로는 추정된 I/O가 남았다.

호출 식별자를 전체 입력의 가역적인 별칭으로 바꾸고 모든 구문·연산·조건·인수·반환을
유지한 공개 corpus에서는 8/8이 1.62–2.75초에 끝났다. 단순 필요 조건 검사 통과 6/8은
전체 의미 정확성을 증명하지 않는다. 대문자 별칭의 복원, 한국어 명사형 문구, caller/callee
용어와 finally의 반환 완료 전 순서에 모호함이 있었다. 표시 형식을 강화한 후속 비교도
8/8을 약 1.22–1.49초에 끝냈지만 영어 문장 종료와 반환 순서가 미검증이었다.
finally 범위를 parser 근거로 보존한 후속 형식에서는 원문에 없는 ‘값이 없으면 0’ 조건이
생겼으며 일부 최종 flow가 기존 600자 한도를 넘겨 거부됐다. 이를 성공으로 세지 않는다.

이 별칭·검토·효과/flow 형식은 모두 별도 실험이다. Reflection, 동적 이름/속성 의미나
임의 원문에 대한 동등성은 증명하지 않았다. 실제 Host의 모든 scope, 다중 대상과 전체
시나리오가 통과하기 전에는 기본 모델이나 배포된 prompt/provider를 바꾸지 않는다.
가중치·part 파일·실험 실행기와 raw 응답은 ignored 실험 폴더에만 있고 제품에 포함하지 않는다.

### 명시적 쓰기·호출 근거의 production 복원

반환/효과 목록을 같은 exact 선언·control snapshot에서 수집하는 API를 구현했다.
각 source occurrence와 인수, try/catch/finally/조건/반복의 lexical 소유를 보존한다.
어휘적 원문 순서는 실제 평가·실행 순서가 아니며 상태 변화/I/O/완료는 미확인이다.
모든 구문을 180자 안에 넣지 못하면 모델 필드를 유지한다. nested callback 본문은 별도
즉시 호출로 추가하지 않고 표현식 안의 쓰기가 누락되면 완전한 no-write 목록으로 만들지
않는다. 기존 반환 검증과 호출·method·async/finally 경계의 안정된 출력 회귀 105개가 통과했다.

current production provider에서 1.7B로 8건 모두 실제 추론과 다섯 상세·summary/flow를
완료한 시간은 1.10–2.81초였다. 기존 필요 조건 체크는 8/8이었지만 **생성문을 직접 검토해
이를 정확한 설명의 성공으로 인정하지 않았다**. immutable 반환/효과/조건이 검사에 답한
동안 role은 ‘role/caller/호출/주문 처리’ 같은 분류였고, summary/flow에 원문에 없는
주문·수수료·감시/관찰과 부모 호출 조건이 생겼다. 고정된 필드 통과로 모델 의미가 검증되지는
않는다.

`benchmark-model-reading.mjs`는 이 공개 arithmetic/catch corpus의 모델 작성 role/summary/
flow를 별도로 검사한다. 실제 식별자 addFee는 허용하지만 업무 명사·미구현 호출 동작·
추가 입력 조건·복원되지 않은 별칭과 무의미한 역할을 실패로 기록한다. 새로운 counterexample
테스트 2개가 통과했다. 이 검사도 필요 조건이며 임의 모델 문장의 의미를 증명하지 않는다.
보존된 8건의 raw response를 새로운 생성문 검사로 다시 평가한 통과는 **0/8**이다.

call prose에 명시적인 별칭 calleeWork/parentWork/callFlow를 쓰는 전체 원문·전체 출력 비교도
생성 지시를 그대로 반복하거나 감사 식별자를 다른 언어로 바꾸고 관찰을 단정했다. 필드
별칭, 입력 별칭, 내부 검토와 projection은 이 때문에 여전히 실험용이며 제품에 적용하지
않았다. 기본/사용자 모델 설정도 유지했다. 3초 목표의 전체 의미·범위 검증은 미완료다.

### 실제 호출 Host의 새 응답과 구문별 해석 비교

0.0.1144 / `57fe41d`의 runtime과 설정을 유지하고 실제 호출 Host의 세 scope를 측정했다.
`benchmark-model-scopes.mjs`는 각 조합에 별도 manager/server와 Host를 만든다. static
graph 준비와 source-free 모델 준비는 제외하고, context 구성·실제 생성·Host 검증·전달과
모든 상세 페이지 조회를 전체 완료 시간에 포함한다. 첫 설명은 cache hit가 아니어야 하고
페이지는 새 모델 요청 없이 모두 읽혀야 한다. 이전 응답이나 source KV cache를 재사용하지
않는다. Kotlin/TypeScript × 한국어/영어 × overview/call/scenario의 12개 조합이다.

| conventional Qwen3 1.7B / 실제 Host | 준비 후 전체 완료 | 3초 이내 | 의미 필요 조건 동시 통과 |
| --- | ---: | ---: | ---: |
| 첫 측정 | 1.26–5.44초 | 9/12 | 0/12 |
| 최종 스크립트 재검증 | 1.66–6.75초 | 4/12 | 0/12 |

두 측정 모두 조합당 실제 모델 요청 1회와 완료 coverage, 다섯 상세, 전체 summary/flow,
Host 원문 evidence를 받았다. 그러나 role은 caller/role/호출 같은 분류로 남았고 일부
summary/flow는 없는 수수료·감시 동작을 단정했다. 모델 준비를 제외해도 시간 변동이
있으므로 첫 측정의 빠른 사례만으로 3초를 보장하지 않는다. 컴파일·패키징·테스트는
측정과 겹치지 않았다. 이 corpus는 호출의 선택 경로이며 전체 함수 rich 시나리오의
성능·의미 검증은 아니다.

새 의미 counterexample은 모델 작성 limitations, 추가 요금/감사 기록/관찰 효과,
반환 완료 뒤의 finally 호출, 입력 변경과 flow의 catch 반환 누락도 검사한다. 원문
반환식과 finally-before-return 설명이 통과하는 positive case도 유지했다. 패키지 및
평가 스크립트 테스트 19개가 통과했다. 이 제한된 검사는 일반 자연어 의미 판정기가 아니다.

1144 production provider의 4B 비교는 8개 모두 실제 모델 요청과 전체 필드를 받았으나
**7.59–12.37초**, 3초 통과 0/8이었다. 새 생성문 필요 조건으로 raw 응답을 재검토하면
통과 0/8이다. 고정 구문을 보존한 효과와 생성한 prose의 정확성을 구분한다.

별도 구문별 해석 실험에서는 원문·호출 맥락을 모두 제공하고, 부모 사용·try 반환·catch
반환·finally 호출에 각각 새로운 모델 문장을 받았다. 역할/요약/흐름은 이 문장을 빠짐없이
연결하고 기존 구문 상세를 복원했다. 1.7B의 생성 및 검증 시도는 1.13–2.52초였지만
최종 길이 검증 실패, 반환 계산의 caller/callee 혼동, 없는 로그와 누락된 예외·인수가
있어 성공은 0/8이다. 실패한 검증까지 3초 안에 끝난 것을 전체 설명 성공으로 세지 않는다.
이 해석 형식은 제품에 포함하지 않았다.

raw 응답·측정과 실험 코드는 ignored `.local-models/experiments/three-second`에만 있다.
측정 후 모든 모델 프로세스를 해제했다. 새로운 기본 모델, prompt 형식, 가중치나 runtime을
배포하지 않았으며 Default/QA 설치 버전은 0.0.1144다. 정확한 전체 설명의 3초 목표는 미완료다.

### 전체 production 형식을 추가 학습한 작은 모델

2026-10-10에는 기존 0.0.1144 runtime과 기본 모델을 유지한 채 conventional Qwen3
1.7B의 별도 LoRA 실험을 진행했다. 모든 원문과 기존 production prompt/schema를
유지하고, 모델이 role/summary/flow/limitations를 작성한 뒤 같은 Host parser가 다섯
상세를 복원·검증한다. 출력 축소, 식별자 별칭, flow projection이나 응답 cache는 없다.

추가 학습은 공개 합성 TypeScript/Kotlin × 한국어/영어의 8가지 구조에서 학습 1,536건,
검증 128건을 사용했다. 실제 parser의 반환·효과·결과 사용 근거를 입력에 넣었고,
평가에 쓰는 함수 이름·계산식·catch 값은 학습 corpus에서 제외했다. 첫 80-iteration
실험의 정답 일부가 한국어 첫 글자 grammar와 맞지 않아 수정했다. 수정된 정답
1,664건은 production grammar로 전체 completion과 EOS까지 검사해 모두 통과했다.
이는 label 형식 검사이며 설명의 의미나 모델 품질 검증은 아니다.

수정 후 fresh base에서 마지막 16개 layer에 rank 8/scale 20 LoRA를 200 iterations,
batch 1, learning rate 0.0001로 학습했다. 최장 1,953 tokens를 자르지 않았고 학습은
약 366초, peak allocation은 약 7.62 GiB였다. 추론은 4bit로 fuse한 별도 MLX 가중치를
사용했다. source-free 64-token prefill과 incremental forward 이후에 새 source의
tokenization·전체 생성·기존 decode/Host 검증까지 측정했다. 각 새 요청의 source KV는
재사용하지 않았다. 원본 GGUF와 다른 가중치/실행기이므로 실행기만의 개선율은 아니다.

| 추가 학습 1.7B / 전체 설명 | 건수 | 3초 이내 | 시간·원문 필요 조건 동시 통과 |
| --- | ---: | ---: | ---: |
| 실제 호출 Host overview/call/scenario × TS/Kotlin × 두 언어 | 12 | 9 | 9 |
| 이름·연산·상수·분기를 바꾼 별도 context | 32 | 8 | 7 |

실제 호출 Host의 완료 범위는 **1.15–3.90초**였고 TypeScript/한국어 세 scope는 모두
3초를 넘었다. 이 12건의 필요 조건 통과는 일반 정확도 증명이 아니다. 후속 32건은
뺄셈, 음수 guard, 지역 쓰기, catch/finally, 결합 분기, 감소 loop, 구현 누락과 잘린
소스를 포함했다. 새 context에 production provider 형식과 parser를 적용한 검사이며
32건 모두를 실제 호출 Host나 전체 rich 시나리오로 측정한 것은 아니다.

후속 결과에는 쓰기·반환 계산·loop 조건의 누락과 구현 없는 함수에 대한 반환 추정이
남았다. 숫자 존재만 확인하는 필요 조건을 통과해도 다른 분기의 계산을 빠뜨린 사례가
있었다. 한 생성은 약 61.89초 뒤 실패했다. 학습 validation loss나 짧은 12건의 결과로
기본 모델을 교체하지 않는다. MLX runtime, adapter와 추가 학습 가중치는 제품에 넣지
않았으며 사용자 설정과 설치 버전 0.0.1144를 유지했다.

### 원문 message 분리와 짧은 지시문의 부정 결과

동일 4B 모델에서 원문을 첫 user message, task/schema를 다음 user message로 나누는
후보를 기존 형식과 짝지어 비교했다. Kotlin/TypeScript × 두 언어에서 overview 후
scenario를 새로 생성한 총 16건이며 응답 cache는 사용하지 않았다. 두 형식 모두
scope 변경 후 다시 처리한 prompt는 **516 tokens**였다. 분리형의 cached token 10개
증가는 message 경계 자체였으며 source 재처리 절감의 근거가 아니었다.

기존 형식은 overview 7.03–16.41초, scenario 8.83–12.54초였고 분리형은 각각
12.17–16.71초, 11.30–21.32초였다. 모델 출력 길이와 시스템 부하가 달라 이 범위를
순수한 message 경계 비용으로 해석하지 않는다. 3초 개선을 입증하지 못해 후보 source,
test와 문서 변경을 되돌렸다.

별도 1.7B 비교에서는 중복 지시만 줄이고 전체 원문·schema·다섯 상세·summary/flow를
유지했다. 8건 중 5건이 3초 이내였으나 원문/언어 필요 조건 동시 통과는 **0/8**이었다.
일부 응답은 callee의 작업 대신 지시문이나 'call/콜러'를 쓰고 catch/정리 인수를
누락했다. 이 형식도 제품에 적용하지 않았다.

평가 스크립트는 생성한 flow의 실제 계산과 정리 인수, 없는 숫자 인용, 닫히지 않은
backtick, 반복 문장과 영어 응답의 다른 언어 prose를 별도로 검사하도록 보강했다.
고정된 반환·효과 필드로 생성문 누락을 숨길 수 없게 한 공개 corpus 전용 필요 조건이다.
새로운 조건을 적용한 과거 결과 재검토는 재생성 측정과 구분한다. raw 응답과 학습·측정
산출물은 ignored 실험 폴더에 보존했으며 모든 모델 프로세스는 종료했다. 추가 조건의
positive/counterexample을 포함해 패키지·평가 스크립트 테스트 20개가 통과했다.

### 별도 M5 실행기와 LFM 2.6B 비교

같은 날에는 prompt를 더 줄이는 대신 실행기와 모델 구조를 비교했다. 제품 runtime은
여전히 0.0.1144 / `57fe41d`이며 아래 실행기·가중치·템플릿 보정은 제품에 적용하지 않았다.
실험 중에는 compile·package·test를 실행하지 않았다.

[BaseRT 0.3.0](https://github.com/basecompute/baseRT/tree/v0.3.0)은 별도 로컬 평가 환경에서
공식 Qwen3.5 4B MLX 4bit checkpoint를 변환해 실행했다. converter의 검증은 packed
weight/scales/biases 201개와 f16 tensor 153개의 일치, 재양자화 0개를 보고했다. 이 검증은
전체 tensor의 독립 검증이나 원래 GGUF와의 동일성 증명이 아니다. engine 배포물의
SHA-256도 확인했다. engine은 별도 내부 평가에만 사용했으며 VSIX에는 포함하지 않았다.

원문 없는 준비 계산 뒤 실제 source와 기존 production wire/schema로 한 요청을 생성하고
기존 Host parser로 검증했다. native grammar 경로의 전체 생성·검증은 **14.96초**, 같은
형식의 LLGuidance mask 경로는 **8.96초**였다. 출력은 서로 달랐고 샘플링 경로도 달라
실행기 최적화율로 제시하지 않는다. LLGuidance 경로에서 관측한 prefill은 1.70초,
mask 0.50초, sampling 0.30초, decode forward 합계는 6.33초였다. forward 시간은 CPU
호출과 GPU 완료 대기를 포함하며 GPU kernel만의 시간이 아니다. 없는 요금·감사 로그를
서술했으므로 정확한 설명의 성공도 아니다. 실제 호출 Host 12개 scope나 전체 rich 시나리오를
완료한 결과로 세지 않는다. 초기 schema dialect 오류로 생성이 시작되지 않은 시도도 제외했다.

[공식 LFM2.5 2.6B GGUF](https://huggingface.co/LiquidAI/LFM2.5-2.6B-GGUF)는 다음 고정
artifact를 사용했다. 파일 전체의 bytes와 SHA-256을 확인한 뒤 offline runner에 제공했다.

- revision: `e7caca5d835a3901a8e0d63e94009429bafafdfc`
- 파일: `LFM2.5-2.6B-QAD-Q4_0.gguf`
- bytes: `1593894944`
- SHA-256: `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`

새 모델을 기존 production provider에 그대로 넣은 실제 호출 Host 12개 조합은 전체 설명
**2.58–5.60초**, 3초 이내 3/12였다. 각 조합은 새 manager/server를 사용하고 전체 summary/
flow, 다섯 상세, 모든 페이지와 source evidence를 완료했다. 그러나 계산식·정리 인수 누락과
미구현 audit의 동작 추정이 남아 원문 필요 조건 동시 통과는 0/12였다.

GGUF의 공식 template가 assistant의 열린 `<think>`에서 끝나는 점도 확인했다. raw
completion endpoint에서 즉시 JSON grammar를 적용하면 최종 답변 전환 없이 JSON을
생성하게 된다. 별도 adapter에서 빈 추론 구간만 `</think>`로 닫고 source/schema/sampling을
유지한 비교는 **2.26–6.60초**, 3초 이내 4/12였다. 이것을 공식 non-thinking 지원이나 품질
개선으로 단정하지 않는다. 초기 필요 조건 검사에서는 한 건이 속도와 함께 통과했으나 직접
검토하니 role이 함수 이름뿐이고 summary가 audit를 addFee 완료 뒤로 설명했다. 검사에 이
counterexample과 올바른 finally-before-completion 문장을 추가했으며, 보강된 검사로 raw
응답을 재평가한 결과는 원문 필요 조건 1/12, 시간·원문 동시 통과 **0/12**였다. 재평가는
새 생성의 시간 측정이 아니며 원래 report를 덮어쓰지 않는다.

[공식 DSpark draft](https://huggingface.co/LiquidAI/LFM2.5-2.6B-DSpark-GGUF)를 붙이는 비교도
진행했다. F16 draft는 revision `7bc2896af56d82ccc7e156800197408db464d63b`,
`663691776` bytes, SHA-256
`e198962c08903f3ba29f0ce6bf8e17f5e60bf85ec2f8673e1e2aab03508937e5`를 검증했다.
양쪽 모두 빈 추론 구간을 닫고 temperature 0, GPU placement 99, flash attention on,
기존 context/thread/output 한도를 사용했다. 이 두 arm 사이에서만 draft 유무를 비교하며
기존 temperature 0.2 측정과 decoder 하나의 개선율로 비교하지 않는다.

| LFM 2.6B greedy / 실제 Host 12개 scope | 전체 설명 | 3초 이내 | 시간·원문 필요 조건 동시 통과 |
| --- | ---: | ---: | ---: |
| draft 없는 대조군 | 2.52–6.76초 | 3/12 | 0/12 |
| DSpark F16, draft 최대 9 | 5.85–13.06초 | 0/12 | 0/12 |

raw 출력은 12쌍 중 11쌍만 byte 단위로 같았다. 따라서 전체 출력의 동등성을 입증했다고
주장하지 않는다. 첫 draft 응답의 runner timing은 제안 873 tokens 중 채택 168 tokens를
보고했다. 다른 기기·workload의 공식 speedup을 이 환경의 결과로 제시하지 않는다.
이번 비교에서는 가속 채택의 근거가 없고 source 해석 누락도 남았다.

생성한 48개 실제 Host 응답은 모두 보강된 필요 조건으로 별도 재검토했다. 전체 시간과
원문 필요 조건 동시 통과는 **0/48**이며, 이 검사조차 모든 문장의 의미를 증명하지는
않는다. counterexample과 패키지 관련 테스트 21개를 통과했고 모델 프로세스는 모두
해제했다. product source, managed download manifest와 사용자 모델 설정은 바꾸지 않았다.

이 비교의 raw report, 변환 파일과 adapter는 ignored 실험 폴더에만 보존한다. 작은 공개
corpus의 관측값이며 기본 모델 교체, 전체 함수 rich 시나리오의 검증이나 3초 목표 달성의
근거로 사용하지 않는다.

### 1.2B 비추론 모델과 전체 함수의 준비 이후 경계

모델 로딩과 전체 설명 완료를 나누어 측정하기 위해 공개 rich-function benchmark에
`model-ready` 경계를 추가했다. 이 경계는 source 없는 `prepare`를 같은 resource lease에서
먼저 기다린다. `preparationMs`는 별도이며 `fullExplanationMs`는 모든 scenario, node detail,
최종 synthesis와 페이지 저장이 끝날 때까지다. 기존 `milliseconds`는 준비를 포함한 전체
시간으로 남긴다. 한국어와 영어를 명시적으로 선택하고 report에 언어·측정 경계를 기록한다.

측정 대상은 실제 `FunctionNarrativeScenarioSession`과 production local provider다.
정적 graph/context 구성은 준비 전에 수행하며 페이지 store는 in-memory다. 따라서 이 수치를
정적 분석부터 Webview 표시까지의 전체 Host 완료 시간으로 제시하지 않는다. 기존 호출
benchmark의 실제 Host overview/call/scenario 측정과도 구분한다.

[공식 LFM2.5 1.2B Instruct](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct)는
2.6B와 다른 비추론 후보로 비교했다. 공식 문서는 한국어·영어 지원을 명시하지만 프로그래밍
용도로 권장하지 않는다. 기존 prompt, 전체 schema, sampling과 기능 범위를 바꾸지 않고
다음 [GGUF](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF)를 검증해 실행했다.

- revision: `8ed288026e23958ad9dfa92d53ed773a8eee7125`
- 파일: `LFM2.5-1.2B-Instruct-QAD-Q4_0.gguf`
- bytes: `695755488`
- SHA-256: `bb741ebb106d543e9de114b843a3d3d73d51c74b5801e69da2abde821a0cb3e1`

실제 호출 Host 12개 조합의 전체 설명은 **0.60–3.18초**, 3초 이내는 **11/12**였지만
시간과 원문 필요 조건을 함께 통과한 결과는 **0/12**였다. 직접 확인한 한국어 응답은
원문에 없는 반환값 10을 만들거나 try와 catch를 연속 실행으로 설명했다. 미구현 audit에
로그·정리 동작을 부여한 응답도 있었다. 작은 모델의 속도만으로 교체할 근거가 없다.

rich-function에는 호출 전후로 쓰기가 섞인 Kotlin/TypeScript 공개 fixture를 추가했다.
입력에 5를 더하고, `audit(adjusted)`를 호출하고, 지역 값을 2배로 갱신한 뒤 반환한다.
이 코드는 기존 closed purpose recipe 밖이므로 모델이 함수 원문을 새로 읽어 목적을
생성해야 한다. 전체 소스 worksheet, 모든 node detail, 계산·정상 복귀 가정과 미확인 호출
제한은 유지한다. 각 측정은 새 manager/server를 사용했으며 실제 model request는 한 번이다.

| 모델 | 함수 / 설명 언어 | 준비 이후 전체 session | 시간·보강된 필요 조건 동시 통과 |
| --- | --- | ---: | --- |
| LFM 1.2B | TypeScript / 한국어 | 0.98초 | 아니요 — 없는 반복 |
| LFM 1.2B | Kotlin / 한국어 | 0.47초 | 아니요 — 없는 반복·분기 |
| LFM 1.2B | TypeScript / 영어 | 0.27초 | 예 — 제한된 공개 필요 조건만 |
| LFM 1.2B | Kotlin / 영어 | 0.62초 | 아니요 — 미확인 audit 내부 동작 단정 |
| 기본 4B | TypeScript / 한국어 | 4.09초 | 아니요 — 3초 초과 |
| 기본 4B | TypeScript / 영어 | 1.17초 | 예 — 제한된 공개 필요 조건만 |
| 기본 4B | Kotlin / 한국어 | 1.41초 | 예 — 제한된 공개 필요 조건만 |
| 기본 4B | Kotlin / 영어 | 1.25초 | 아니요 — 미확인 audit 내부 동작 단정 |

처음의 coarse 검사는 빠른 네 개 1.2B 응답을 모두 통과시켰다. raw 목적을 직접 검토하니
한국어에 없는 반복·분기가 있었고, 두 모델의 Kotlin/영어 목적은 알 수 없는 audit 본문을
"auditing the result" 또는 "auditing that result"로 단정했다. 공개 corpus 검사에 이
counterexample을 추가했다. 실제 loop/branch와 단순히 audit 호출을 명시하는 문장은 허용한다.
원래 raw report의 시간과 판정을 덮어쓰지 않고 별도 rereview로 기록했다. 위 표는 보강된
검사의 재평가이며 새 생성 측정이 아니다. 이 필요 조건의 통과도 모든 문장의 정확성을
보장하거나 전체 언어·함수의 3초 달성을 입증하지 않는다.

반면 Kotlin guard와 TypeScript effect-prefix의 13.22ms / 8.77ms 결과는 source-only이며
model metrics가 0개였다. 새 성공 조건은 이러한 결과, 준비 실패, 부분 페이지, 누락된 node와
잘못된 시간을 실제 모델 읽기 성공에서 제외한다. 이 결과를 LLM 가속으로 제시하지 않는다.
자동 검증은 원문 값과 상태 전이, 미확인 호출, 목적의 명백한 반례를 함께 확인한다.

재현은 compile이 완료된 runtime에서 다음처럼 실행한다. 모델 다운로드와 무결성 확인은
별도로 완료해야 한다. `model-ready` 이전 `-`는 configuration-mode 인자의 자리다.

```sh
node scripts/benchmark-function-narratives.mjs - rich-ready \
  kotlin-interleaved-effects /absolute/path/to/model.gguf \
  /absolute/path/to/llama-completion full-run - model-ready ko
```

### 블록 병렬 생성의 제한된 실행 가능성 검사

토큰을 순서대로 생성하는 병목을 줄일 다른 방법으로
[공식 Fast-dLLM v2 1.5B](https://huggingface.co/Efficient-Large-Model/Fast_dLLM_v2_1.5B)의
블록 생성 구조를 검토했다. 고정 revision은 `25093b6f63300adfd57f72145083c8a528fe4f16`,
BF16 `model.safetensors`는 `3087467144` bytes, SHA-256은
`8d267bb8b935f2e15148ba1175b67dba70261a696ec931dd0a3b0f27f9f3c434`다. 전체 weight와
tokenizer의 크기·해시를 검증했다. Python 인증서 저장소 문제로 중단된 다운로드는 인증서
검증을 유지하는 macOS curl로 진행했으며, 검증 전 partial 파일은 모델로 사용하지 않았다.

Hub의 Python을 실행하지 않고 검토한 block attention mask·token shift·읽기 전용 prefix
KV 동작을 기존 MLX Qwen2 layer로 옮긴 **별도 초기 probe**다. 공식 구현과의 수치 동등성은
검증하지 않았다. greedy, block 32, subblock 8, threshold 0.9를 사용했으며 출력은 기존 전체
production prompt/wire와 Host parser로 검사했다. grammar는 생성 중 강제하지 않고 완료 후
검증했다. 따라서 기존 decoder와 동등한 실행기 성능 비교나 공식 모델의 성능 결과로 해석하지
않는다. source 없는 준비는 2.38초로 별도 측정했다.

첫 TypeScript/한국어 응답은 준비 이후 생성·Host 검사에 **5.45초**가 걸렸다. 입력 1,606,
출력 232 tokens, forward 157회였고 출력 JSON도 깨져 `invalid-response`였다. 원문에 없는
주문·수수료·조건을 영어로 만들었으며 필요한 상세도 누락했다. tokenizer 입력 변환 전의
네 번의 즉시 오류는 완료된 생성이나 설명 시간 측정으로 세지 않는다. 이 초기 probe만으로
기능·정확도·속도를 충족하지 못해 추가 조합과 제품 통합을 진행하지 않았다.

이번 변경은 측정 스크립트와 공개 반례·기록뿐이다. product source, 기본 모델 manifest,
사용자 설정과 설치된 0.0.1144를 바꾸지 않았다. 패키지·평가 스크립트 테스트 27개가 통과했고
모든 측정 프로세스는 종료했다. raw 파일·실험용 실행기는 ignored 실험 폴더에 보존한다.

### 예외 경로의 검증된 상세와 모델 목적을 분리한 실험

2026-10-10에는 `try/catch/finally`의 전체 소스 구조를 검증한 후 인자·반환·효과·도달 이유와
전체 flow를 Host가 보존하고, 모델이 **실제 caller/callee 원문을 새로 읽어 summary와 호출
역할만 자유 문장으로 작성하는 경로**를 구현해 측정했다. catch 대안의 inferred confidence,
finally 정상 완료 전까지 미확인인 반환, 모든 상세 필드와 원래 출력 상한을 유지했다.
미지원 구문·추가 연산·누락된 범위·catch binding shadow는 기존 전체 모델 경로를 사용했다.
이 실험의 flow는 Host가 작성했으므로 모델의 원문 이해를 입증하는 필드가 아니다.

실제 production Host/provider에서 TypeScript/Kotlin × 한국어/영어 ×
overview/call/scenario의 12개 조합을 각 한 번 새로 생성했다. 매 조합의 새 manager/server는
원문 없이 준비한 다음 측정을 시작했으며 이전 응답·source KV는 재사용하지 않았다.
원문 읽기·생성·Host 검사·전체 페이지 전달까지 **1.38–5.38초**, 9/12건이 3초 이내였다.
원문 토큰 457–571개, 출력 토큰 42–94개였고 모든 응답에 summary/flow와 다섯 상세 필드가
있었다. raw `model-scopes-Mk4aPX/report.json`의 최초 필요 조건 통과는 3/12였다.

실제 모델이 작성한 summary/role만 별도 검토하니 처음 통과한 세 한국어 응답도 원문에 없는
"추가 비용", "구매 금액", "최종 금액 기록"을 만들었다. 이 공개 corpus에는 해당 업무
규칙·통화·기록 구현이 없다. 영어에는 fee/audit 의미 단정과 끝맺지 않은 문장도 있었다.
공개 평가의 한국어 반례를 보완한 **재평가 결과는 0/12**다. 원래 생성 시간과 판정은 보존하고
`catch-purpose-rereview.json`에 재평가를 기록했다. 새 생성 측정이 아니며, source가 작성한
flow의 정확성을 모델의 원문 이해 증거로 세지 않는다. 이 필요 조건 검사는 일반적인 의미
정확성의 증명도 아니다.

이 경로는 품질과 모든 조합의 3초 기준을 충족하지 못했다. 구현 diff·기능 테스트·raw
출력은 ignored 실험 폴더에 보존하고 제품의 analyzer/provider 변경은 모두 되돌렸다.
기본 모델·사용자 설정은 유지하며 새 실험이나 모델을 설치하지 않는다.

### 별도로 확인하고 수정한 설명 표시 오류

넓은 회귀 검사에서 기존 호출 설명 Webview가 `isFunctionCallNarrativeLanguage`는
직렬화하지만 그 함수가 호출하는 `isFunctionCallNarrativeTextLanguage`를 빠뜨려,
정상 설명을 받으면 ReferenceError로 표시가 중단되는 문제를 확인했다. 0.0.1145에는
같은 public validator helper를 함께 직렬화하는 작은 수정만 runtime에 반영했다.
기존 source-navigation architecture test도 실제 함수 Inspector 파일의 명시적 소스 버튼을
검사하도록 갱신했다. 소스 이동 구현과 CSS는 바꾸지 않았다.

compile, 관련 회귀 테스트 245개, 패키지·평가 스크립트 테스트 27개가 통과했다.
Chrome에서 실제 생성 HTML과 Host에 명시적인 synthetic provider를 연결해
1440×900 Kotlin/영어, 390×844 Kotlin/한국어, 768×1024 TypeScript/영어 iframe viewport를
각각 렌더링했다. 설명 완료와 다섯 필드, 스크롤·줄바꿈을 시각적으로 확인했고 scenario,
overview, 단일 call 버튼과 캐시 페이지 앞뒤 이동을 직접 실행했다. 브라우저 오류는 0개,
캐시 페이지 이동의 추가 Host 요청은 0개였다. 이 화면 검증은 실제 모델 품질·속도 측정과
별개이며 모바일 장치나 native VS Code 안의 전 viewport 검증을 주장하지 않는다.
기존 side-tab 디자인 훅은 사용자 답변 대기 상태로 유지하며 ignore를 추가하지 않았다.

### 원문 대비 디코딩의 제한된 실행 검사

2026-10-10에는 프롬프트 문구나 가중치를 다시 고르는 대신
[Context-aware Decoding 논문](https://aclanthology.org/2024.naacl-short.69/)과
[저자 구현](https://github.com/xhan77/context-aware-decoding)의 방식으로, 같은 모델의
원문 포함 예측과 원문 제거 예측을 비교하는 별도 native probe를 작성했다. 실제 확장에는
연결하지 않았다. 기존 검증된 LFM2.5 1.2B QAD Q4_0 GGUF와 설치된 공식 llama.cpp
`b29c606e2`의 ABI·JSON grammar converter를 사용했다. 두 독립 sequence에 같은 출력
token을 넣고 `1.5 * source_logits - 0.5 * ablated_logits`를 grammar/sampling 전에
적용했다. 비교 가중치는 0과 0.5만 사용했다.

현재 production prompt와 전체 wire/schema를 사용했다. 응답 필드·원문·출력 상한을
줄이지 않았고 모든 다섯 상세 필드를 Host에서 복원했다. 고정 상세는 모델 이해의 증거로
세지 않았다. 실제 production server의 `/apply-template` 출력과 native renderer의
결과가 정확히 같은지 두 입력 모두 확인했다. 원문과 파서의 반환·효과 inventory만 제거한
입력도 같은 system message·안내 문장·schema를 사용했다. 원문 없는 고정 token으로
준비한 뒤 parent handshake로 측정을 시작했고, 전체 native 응답과 현행 Host parser가
끝날 때까지 측정했다. 별도 native 도구이므로 실제 Host transport·Webview 전달이나
전체 rich/heldout 성능 측정으로 제시하지 않는다.

TypeScript/한국어 overview 한 건에서 일반 native 생성은 **4.72초**(출력 204 tokens),
원문 대비 생성은 **2.86초**(157 tokens)였다. 후자는 3초 이내였지만 실제 flow에서
반환 계산·catch 조건·정확한 `audit(value)` 인수를 빠뜨리고, 내부 source-slot 이름과
존재하지 않는 component, 잘못된 역순을 만들었다. summary는 정상 try 뒤 catch가
이어지는 것처럼 설명하고 audit를 오류 상황에만 연결했다. role도 "역할/목적"이라는
자리표시자였다. **정확도와 3초를 함께 통과한 결과는 0/2**이며 추가 언어·scope 조합,
가중치 탐색이나 제품 통합을 진행하지 않았다. 이 두 건으로 방식 전체의 성능을 일반화하지
않으며, 일반 native 도구의 시간도 production server와 같은 성능이라고 해석하지 않는다.

최초 ablation은 source-dependent builder가 안내 문장도 생략하는 차이가 있어
`instruction-confounded-*` 파일로 분리 보존했다. 그 초기 비교는 일반 생성 4.44초,
원문 대비 생성 3.14초였고 후자는 자동 필요 조건을 통과했지만 수동 검토에서 catch의
0을 항상 반환하는 기본값으로 단정하는 오류와 일반 role을 확인했다. 같은 안내 문장으로
고친 뒤 위의 한 차례 비교를 진행했다. 초기 결과를 목표 달성이나 검증된 CAD 비교로
세지 않는다. 원래 raw·시간·판정을 덮어쓰지 않고 `cad-rereview.json`에 별도 검토를 남겼다.

공개 corpus의 평가에는 문장부호로 감싼 일반 role, 노출된 내부 호출 메타데이터,
예외 한정 없이 최종 결과를 0으로 단정하는 반례를 추가했다. 명시적인 예외 조건이 붙은
올바른 설명은 유지한다. 이 검사는 일반적인 의미 정확성의 증명이 아닌 제한된 필요 조건이다.
패키지·평가 스크립트 테스트 29개가 통과했으며 모든 실험 프로세스의 종료를 확인했다.
제품 runtime·기본 모델·설정·CSS와 설치된 0.0.1145는 유지한다.

## 남은 완료 기준

모델 변경, decoder 최적화 또는 입력 구조 변경을 채택하려면 다음을 함께 확인해야 한다.

1. 실제 원문과 가까운 호출 맥락을 읽는 모델 요청이 있어야 한다.
2. 전체 설명을 3초 이내 완료해야 한다. 출력 일부나 첫 token으로 대체하지 않는다.
3. Kotlin/TypeScript 및 한국어/영어에서 원문 계산·조건·모든 반환과 부수 효과를 보존한다.
4. 정적 source 제한/confidence를 프로그램의 조건이나 실제 실행으로 표현하지 않는다.
5. 출력 예시의 이름·계산식·인수·조건을 실제 설명에 복사하지 않는다.
6. 전체 시나리오와 호출 구조/호출/선택 경로를 실제 Host/provider 경계에서 검증한다.
7. 자동 다운로드·무결성·기존 custom model·FIFO·취소·idle 메모리 해제를 유지한다.

이번 결과는 더 작은 모델의 가능성과 현재 병목을 좁히는 근거다. 기본 모델 교체나
목표 달성의 근거로 사용하지 않는다.
