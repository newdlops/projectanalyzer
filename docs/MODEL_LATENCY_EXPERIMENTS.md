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

### 원문 없는 준비와 공통 안내문 KV 재사용

2026-10-10에는 사용자 원문을 준비 단계에 넣지 않고, 요청마다 같은 공통 안내문만 미리
계산하는 경로를 별도 실험으로 구현했다. 준비 완료 뒤에 전체 현재 원문을 새로 읽으며,
이전 설명·원문 KV·예제 정답을 재사용하지 않는다. 출력 필드·상한·현재 production
prompt/schema/grammar와 sampler도 유지했다. 첫 native hook은 번들 내부 provider에
연결되지 않아 `source-free-prefix-xhNGjL`을 계측 무효로 표시했다. 모든 소비자가 끝난 뒤
일반 compile을 실행하고 factory 연결과 실제 준비 receipt를 확인한 실험만 따로 기록했다.

설치된 공식 llama.cpp `b29c606e2`의
[server 문서](https://github.com/ggml-org/llama.cpp/blob/b29c606e2/tools/server/README.md)는
`n_predict: 0`을 prompt 처리 전용으로 설명하지만, 실제 `/completion`은 출력 token
한 개를 생성했다. raw에는 `n_predict: 0`, `tokens_predicted: 1`, content가 세 개의
backtick으로 함께 남아 있다. 해당 버전의
[server 구현](https://github.com/ggml-org/llama.cpp/blob/b29c606e2/tools/server/server-context.cpp)도
prompt 완료 후 sampling하고 생성 budget을 검사하는 순서다. source-free라도
**출력 0 tokens** 준비 조건에 맞지 않아 즉시 중단했다. 이를 정상 prefill-only 준비로
취급하거나 그 뒤의 요청 시간을 유효한 prefix-cache 비교로 세지 않는다.
`source-free-prefix-aGidWe/warm-preparation.jsonl-raw`에 응답을 보존했다.

별도로 공식 native BOS/EOS forward warmup만 활성화해 같은 전체 rich session의
TypeScript/한국어 interleaved-effects 한 건을 비교했다. 원문 없는 준비는 3.43→2.28초,
준비 후 전체 설명은 **1.70→3.67초**였다. 두 응답 모두 581 prompt/41 output tokens였고
원문 필요 조건을 통과했으나 warmup 쪽은 3초를 넘었다. 하나의 비교에서 개선을 입증하지
못했으며, 시스템 부하나 출력 단계 변동을 분리한 일반적인 성능 결론도 아니다.
`source-free-prefix-H6Hyxf/report.json`을 보존하고 제품의 warmup 설정은 유지했다.

MLX 실험에는 이미 보유한 `model-1.7b-aligned-fused`를 사용했다. 이 가중치는 이전의
넓은 heldout 검증에서 기본 모델 채택이 거절된 상태이며 이번에 새로 학습·다운로드하지
않았다. 한국어/영어 × call/rich 네 공통 안내문을 실제 tokenizer/template으로 계산한 뒤
준비 완료를 알렸다. 비교 양쪽 모두 같은 네 안내문과 고정 forward를 미리 계산하고,
재사용 쪽만 원문 없는 KV를 보존했다. 요청마다 전체 token prefix가 정확히 같은지
확인하고 cache를 복제해 남은 **전체 원문과 schema**를 처리했다. 보존된 cache의 모든
byte와 offset을 SHA-256으로 검사해 요청 전후 불변을 확인했다. 검사·복제 비용도 전체
응답 시간에 포함했다. 불일치·미완성 생성은 성공으로 세지 않는다.

현재 provider의 FIFO/resource 경계와 Host parser를 거친 네 쌍의 결과는 다음과 같다.
시간은 모델 준비 후 새 원문 처리부터 전체 생성·Host parse 완료까지이며, 실제 outer
Host transport나 Webview 전달·전체 rich/heldout 조합의 측정은 아니다.

| 공개 사례 | 재사용 없음 | 안내문 KV 재사용 | 검토 결과 |
| --- | ---: | ---: | --- |
| TypeScript/한국어 뺄셈 | 1.780초 | 1.433초 | 전체 응답 byte 일치, 필요 조건 통과 |
| TypeScript/한국어 음수 분기 | 5.134초 | 5.289초 | 필요 조건 통과, 양쪽 모두 3초 초과 |
| Kotlin/한국어 뺄셈 | 1.626초 | 1.488초 | 전체 응답 byte 일치, 필요 조건 통과 |
| Kotlin/영어 분기·catch | 1.497초 | 1.545초 | 양쪽 모두 catch 반환 누락과 잘못된 반환 설명 |

한국어 call 안내문은 675 tokens, 영어는 409 tokens를 재사용했다. 네 prefix 보존에
**196 MiB**가 들었다. 이는 prefix KV 할당량이며 전체 worker peak 메모리 측정값은 아니다.
prefill은 3/4건, 전체 응답은 2/4건에서 줄었다. TypeScript 뺄셈은 오히려 prefill이
370→429ms로 늘고 출력 단계가 1,383→959ms로 줄어, 전체 시간 감소를 안내문 cache의
고유 효과로 단정할 수 없다. 음수 분기는 prefill이 805→234ms로 줄어도 출력 단계가
4,314→4,994ms로 늘었다. 원문 필요 조건과 전체 3초를 함께 만족한 건수는 양쪽 모두
**2/4**이며, 그 필요 조건은 일반적인 의미 정확성의 증명이 아니다.

원문 크기에 따라 고정 상세 budget이 달라지므로 모델이 쓴 필드를 role로만 한정하지
않았다. 각 실제 schema→wire에서 가변 필드를 확인해 output/effects도 함께 검토했다.
분기·catch 사례는 양쪽 모두 catch의 `-3` 반환을 빠뜨리고, `valueArg < 0`이 아닌
경로의 `valueArg * 4`도 14로 잘못 설명했다. 생성된 effects는 14 반환을 단정하고
정확한 `inspectValue(valueArg)` 호출을 빠뜨렸다. 모든 모델 작성 문장이 같은 쌍도
2/4뿐이다. 고정 상세의 정확성으로 이 오류를 상쇄하거나 모델 이해 통과로 세지 않는다.

`mlx-instruction-cache-P7A2pj/report.json`의 원래 응답·시간·판정과 두 준비 receipt를
보존하고 `rereview.json`에 별도 검토를 기록했다. 초기 cache fingerprint의 NumPy
bfloat16 변환 오류는 정확한 uint8 byte view로 수정했다. 실패했던
`mlx-instruction-cache-4Ne0iB`의 네 control 응답은 유효한 paired 최적화 비교에서
제외했다. 모든 실험 프로세스가 종료됐으며 추가 prompt/model 탐색이나 제품 통합은
진행하지 않았다. 일반 compile과 패키지·평가 스크립트 테스트 29개가 통과했다.
runtime·기본 모델·사용자 설정·CSS와 설치된 **0.0.1145**는 유지한다.

### 출력 단계 계측과 제약 검사 겹치기

후속 네 건의 새 원문 생성에 token 간격과 CPU grammar 작업 계측을 추가했다.
`mlx-instruction-cache-6pKqNr`의 전체 응답은 **1.145–1.318초**였고, 네 응답 모두 앞선
안내문 cache 실험의 응답과 byte가 같았다. 이전 5.289초의 음수 분기도 1.318초에
끝났으므로 이를 계측 코드가 해결한 성능 문제로 제시하지 않는다. CPU mask 계산은
24.7–157.2ms였으며, token 소비 시간에는 GPU 동기화 대기가 포함된다. lazy graph 생성
시간이나 CPU 대기만으로 GPU forward·sampler의 개별 시간을 단정하지 않는다.

[LLGuidance의 canonical fast-forward 방식](https://github.com/guidance-ai/llguidance/blob/main/docs/fast_forward.md)도
현재 전체 wire/schema에서 CPU로 검사했다. 실제 완료된 공개 응답 네 건에서 고정 token은
각 5/5/5/7개였으며 모두 한 token짜리 구간이었다. 여러 token의 forward를 한 번으로
묶을 기회는 0건이었다. 이 검사는 새 모델 설명 생성이나 속도 측정이 아니며,
`ff-token-opportunity.json`을 보존하고 별도 jump decoder 구현은 진행하지 않았다.

다음에는 원문·prompt·grammar·sampler·출력 상한을 유지하고, 앞선 token이 준비된 뒤
기존 model forward graph를 먼저 enqueue해 CPU mask 검사와 겹치는 경로를 구현했다.
`mlx-instruction-cache-gFPPBk/overlap-rereview.json`의 네 쌍 모두 전체 응답 byte가
같았지만 전체 시간은 2/4건만 줄었다. 음수 분기는 1.506→3.371초였고 필요 조건과
전체 3초를 함께 만족한 건수는 control 3/4, overlap 2/4였다. 앞선 결합 분기 오류도
그대로였다. 시스템 변동과 분리한 일반적인 개선을 입증하지 못해 제품에 적용하지 않았다.

### 학습 정답의 잘못된 분기식 복제 수정

추가 학습에 쓴 1,664건을 다시 검사해 **160건의 확실한 정답 오류**를 확인했다.
훈련 144건, 검증 16건이다. 기존 생성기가 `/[+*\-]/`로 계산식을 고르면서 단항 음수
리터럴도 계산식으로 취급했다. 예를 들어 원문은 다음처럼 서로 다른 식을 반환한다.

```typescript
function convert(raw: number): number {
  if (raw < 2) { return -9; }
  return raw + 2;
}
```

그런데 role 정답은 `조건 raw < 2에 따라 -9 또는 -9를 반환합니다`였다. 음수 상수를
다른 경로의 계산식으로 다시 선택한 생성 오류이며, 이 결함이 실제 모델 오류 전체의
원인이라고 단정하지는 않는다.

공개 offline helper `scripts/model-reading-supervision.mjs`의
`createTwoReturnBranchSupervision(target, locale, sourceText)`로 각 반환식을 자기
소스 슬롯에서 읽도록 수정했다. 완전한 declaration이 `if`의 반환과 뒤의 반환만 포함하는지
함께 확인한다. TypeScript/Kotlin의 중괄호 및 Kotlin의 단일 문장 if를 지원하고,
잘린 inventory·중첩 경로·catch·사이의 throw/write/loop·너무 긴 정답은 거부한다.
기존 문장 형식과 confidence를 유지하고 잘못 복제된 fallback 식만 바꾼다. 이 helper는
학습 정답용이며 실제 inference·Host flow 작성·확장 runtime에는 연결하지 않는다.

첫 보정 실험은 같은 160개 role을 고치면서 문장 형식도 바꿨다. 원문·입력·나머지 정답을
보존하고 모든 1,664건의 Host parser 및 decoder grammar/EOS 통과를 확인했다.
fresh base에서 같은 seed/LoRA 설정으로 200 iterations를 학습했고, 약 281.94초와
peak allocation 8,009.78 MiB를 사용했다. 기존 가중치와 분리한 4bit/group 128 파일은
914,316,110 bytes이며 설치하지 않았다.

이 모델의 새 TypeScript/Kotlin × 한국어/영어 × 여덟 구조, 총 32건은 전체 설명
**1.16–5.12초**, 22건이 3초 이내였다. 당시 필요 조건은 20건, 시간과 동시 통과는
15건이었다. 그러나 전체 가변 필드·flow·실제 호출 인수를 별도 재검토하니 원문에 없는
`mapInput(seed)`를 쓰고, 결합 분기에서 catch의 `-3`을 비음수 경로의 결과로 설명하며
`valueArg * 4`를 빠뜨린 사례가 남았다. 구현 누락·잘린 본문에서 미확인 반환·효과를
서술하지 않은 응답도 있었다.

`label-repair-rereview.json`의 같은 제한적 필요 조건으로 다시 보면 원래 보존된 control은
19/32, 새 문구 보정은 10/32이며 원래 시간과 동시에 통과한 건수는 양쪽 모두 6/32였다.
32개 입력 context는 byte가 같다. 서로 다른 시점의 시간은 matched runtime 비교가
아니므로 속도 개선을 정답 보정의 효과로 제시하지 않는다. 선택한 실제 반례와 필요
조건 검사는 일반적인 의미 정확성의 증명도 아니다. 첫 보정 모델은 채택하지 않았고
원래 응답·시간·판정과 corpus를 모두 보존했다.

후속 실험에서는 문장 형식을 원래대로 유지하고 잘못 복제된 fallback 식만 바꿨다.
`training-data-production-branch-fixed.json`의 SHA-256은
`b63c1d5374b99f014350012610133aa402fe62e066f74b916fec1f653eb9f32b`이며,
144개 훈련·16개 검증 role 외의 원문·입력·정답은 그대로다. 모든 1,664건의 Host
parser 및 grammar/EOS 검증을 다시 통과했다. 별도의 fresh base와 같은 seed/LoRA
설정으로 200 iterations를 학습했고 **281.17초**, peak allocation **7,777.97 MiB**를
사용했다. 4bit/group 128 병합 가중치의 SHA-256은
`adcbcc60d6980c631f33cfd16882852a1ed1d762e92227d1b04a570d429b8411`이다.
파일 크기는 914,316,110 bytes이며 기존 모델과 분리해 보존했다.

`production-holdouts-xrVbWN/report.json`의 같은 독립 사례 32건에서 전체 설명은
**0.885–9.114초**였다. 20건이 3초 이내, 필요 조건 통과는 18건, 동시 통과는 12건이었다.
`branch-fixed-label-rereview.json`에서도 같은 필요 조건 결과가 나왔으나, 실제 문장을
읽으니 통과한 TypeScript/영어 결합 분기조차 catch의 `-3`에 `valueArg < 0` 조건을
잘못 붙였다. 이 12건을 의미 정확성과 시간 목표의 달성 건수로 간주하지 않는다.

추가 반례는 완전한 영어 뺄셈 본문을 구현 누락으로 설명하기, 한국어 음수 조건 뒤집기,
영어 반복문에서 실제 지역 변수 갱신을 부정하기, 누락된 callee 대신 caller 본문을
설명하기, 잘린 본문의 미확인 나머지를 `otherwise 14`로 단정하기였다. 한국어 반복
설명은 문장을 되풀이했고 Kotlin 응답은 EOS로 끝나도 code span이 미완성이었다.
다른 필드의 정확한 설명으로 이런 문장을 상쇄하지 않는다.

입력 context 32개는 원래 control과 byte가 같지만 서로 다른 시점의 시간은 matched
성능 비교가 아니다. 두 보정 모델 모두 현재 provider/resource 경계와 Host parser까지의
측정이며 outer Host 전달·전체 scope·rich 검증을 대신하지 않는다. 이미 필수 설명
정확성과 3초 조건을 만족하지 못해 제품 통합이나 설치, 추가 모델·학습 설정 탐색으로
확장하지 않았다. 학습·병합·평가 프로세스는 모두 종료됐고 원래 모델을 유지했다.

### 실제 모델 작성 필드의 평가 범위 보완

`scripts/benchmark-model-reading.mjs`의
`collectModelAuthoredCallReadingTexts(reading, wireSchema)`는 해당 요청의 실제 wire
schema에 남은 summary/flow/limitations와 다섯 call prose 필드를 수집한다.
Host에서 복원한 const/singleton 필드와 call ID는 모델 이해의 근거에서 제외한다.
tuple 수가 다른 schema는 거부해 다른 요청의 필드를 실수로 평가하지 않는다.
`checkPublicModelReading`의 세 번째 인자로 이 schema를 전달하면 생성된 output/effects의
허위 주장도 검사한다. schema 없는 과거 호출은 summary/flow/role 검사만 유지한다.
공개 context/scopes benchmark에는 실제 요청 context의 schema를 연결했다.
scopes의 공개 한 호출 corpus에서 provenance가 모호하면 성공으로 세지 않는다.
기존 실제 Host의 overview/call/scenario 응답 12건으로 schema 연결이 모두 유효한지도
재검사했다(`model-prose-host-provenance-review.json`). 보존된 응답의 schema 검증이며
새 모델 생성·시간 측정이나 실제 모델 정확성 통과를 의미하지 않는다.

고정 상세가 정확한 상태에서 가변 output이 catch 값을 무조건 반환한다고 주장하거나
가변 effects가 미구현 로그 동작을 단정하는 반례를 추가했다. offline 보정 helper의
음수 리터럴·반환 순서·candidate confidence·Kotlin 구문·불완전 소스·길이 검사와 함께
패키지·평가 스크립트 테스트 **36개**가 통과했다. 제품 runtime·기본 모델·사용자 설정·
CSS와 설치된 **0.0.1145**는 유지한다.

### 잘린 본문을 완전한 분기로 가르친 정답 수정

분기식 보정 후의 1,664건을 원문과 독립적으로 대조해 **추가 160건**의 확실한 role
오류를 확인했다. 훈련 144건, 검증 16건이며 앞선 완전한 분기식 오류와 다른 행이다.
예를 들어 원문이 `if (raw < 2) { return -9; }` 뒤에서 잘려도 정답은
`Return -9 when raw < 2, otherwise -9`였다. 같은 응답의 output/effects는 나머지 결과와
효과를 미확인으로 설명하므로 내부 모순도 있었다. 감사는 학습 corpus 자체만 읽었고
heldout 응답을 정답으로 사용하지 않았다(`training-source-contract-audit.json`).

`createTruncatedReturnBranchSupervision(target, locale, snippet)`을 공개 offline helper에
추가했다. target이 가리키는 helper snippet의 identity·잘림 표시·confidence·보이는 단일
if/return을 확인한다. 완전한 함수·다른 snippet·구현 누락·추가 statement에는 이 보정을
적용하지 않는다. 기존의 정확했던 원본 label 문구와 candidate 표시를 그대로 복원해
보이지 않는 otherwise 결과를 단정하지 않도록 했다. inference나 extension runtime에서
설명을 대신 작성하는 기능은 아니다.

`training-data-production-source-fixed.json`은 이전의 완전한 분기 160건 보정을 유지하고
잘린 본문 160개 role만 추가로 고쳤다. 원문·prompt·schema·다른 설명 필드는 그대로다.
SHA-256은 `f4bf1e4d23ad232ee05df9d03d94588f6edb404bd482e391cb3de13debe23c51`이며
1,664건 모두 Host parser와 decoder grammar/EOS 검증을 통과했다. 제한적인 source 감사에서
앞서 확인한 두 정답 결함은 더 나타나지 않았다. 이는 모든 정답의 의미 정확성을 증명하지
않는다. 학습의 if 조건은 `< 양수`, compound write는 `+=`만 포함했고, 음수 guard와
분기·catch 결합 사례는 0건이라는 별도 범위 한계도 확인했다.

동일한 fresh base·seed·LoRA 설정·200 iterations 학습은 **323.48초**, peak allocation
**7,885.87 MiB**를 사용했다. 분리한 4bit/group 128 가중치는 914,316,110 bytes이며
SHA-256은 `a056d73d570d30756739dc51b150cb2f2088827881dec93efd452c964df65403`이다.
기존 corpus·가중치와 분리해 보존했고 설치하지 않았다.

`production-holdouts-4OT9eR/report.json`의 같은 32개 새 원문에서 30건의 전체 응답이
완료됐고 2건은 JSONDecodeError로 실패했다. 18건이 전체 3초 이내였으며, 기존 필요
조건은 24건, 그 조건과 시간의 동시 통과는 15건이었다. 실패를 포함한 최대 시간은
**31.624초**다. 보정된 영어 partial role에는 미확인 표현이 생겼지만 flow/output은
여전히 보이지 않는 `otherwise valueArg`를 만들었고, TypeScript output에는 원문 `14`
대신 `114`가 있었다. 한국어 partial output은 반환 내용 대신 효과 설명을 복사했다.
누락 callee의 반환값·부수 호출 부재 단정, 완전한 Kotlin 본문의 잘림 오인, 단순 쓰기의
반복 조건 창작, 결합 분기의 계산·catch 반환 누락도 남았다.

숫자 복사 검사를 `findUnsupportedQuotedSourceLiterals(authoredTexts, source)`로 공유하고
단독 숫자뿐 아니라 인용된 식 안의 decimal token도 검사하도록 보완했다. `14`와 `114`,
다른 필드의 올바른 값과 틀린 값, identifier의 숫자를 구별하는 회귀 테스트를 추가했다.
이 검사는 제한된 산술 fixture의 원문 복사 필요 조건이며, 계산으로 도출한 상수나 일반적인
프로그램 의미를 검증하는 도구가 아니다. 패키지·평가 스크립트 테스트 **41개**가 통과했다.

`partial-source-label-rereview.json`에서 바로 전 모델과 새 모델을 같은 provenance·숫자
검사로 재검토하면 필요 조건은 **18/32→22/32**, 원래 시간과의 동시 통과는 **12→14**다.
32개 context는 byte가 같고 원래 응답·시간·판정은 보존했다. 서로 다른 시점의 시간이므로
matched 성능 개선의 증거가 아니며, 위의 실제 반례 때문에 이 숫자를 정확성 통과로
간주하지 않는다. 실패한 두 생성의 이전 진단에는 final stop reason이 없어 길이 제한과
종료 token의 어느 문제였는지 단정하지 않는다. 후속 private worker는 완성 여부를 JSON
parse 전에 확인하고 실패 기록에 finishReason/outputTokens를 남기도록 보완했다.

필수 정확성과 전체 3초를 함께 입증하지 못해 새 모델을 채택하지 않았고 outer Host의
전체 scope/rich 검증으로 확대하지 않았다. 학습·병합·평가 프로세스는 모두 종료됐다.
제품 runtime·기본 모델·사용자 설정·CSS와 설치된 **0.0.1145**를 유지한다.

### Kotlin 합성 원문의 문장 구분자와 preflight 수정

완전한 Kotlin 분기에 `returnSyntax`가 없었던 원인을 별도로 조사했다. 보존된 평가용
원문에는 `if (...) { return 14 } return valueArg * 4`처럼 같은 줄의 `}`와 다음
`return` 사이에 문장 구분자가 없었다. Kotlin의
[공식 문장 문법](https://kotlinlang.org/spec/statements.html#code-blocks)과
[문법 정의](https://kotlinlang.org/spec/syntax-and-grammar.html)는 statements 사이에
newline 또는 semicolon을 요구한다. 제품 ANTLR 파서는 이름을 복구해 graph symbol을
만들었지만 정확한 function owner를 찾지 못했고 source inventory도 제공하지 않았다.

`kotlin-statement-separator-audit.json`은 뺄셈·음수 guard·분기/catch 결합·반복문 네
원문에 original/semicolon/newline을 적용한 12개 결과다. 잘못된 세 종류에 줄바꿈이나
세미콜론을 넣자 정확한 선언과 반환·변경 inventory가 복원됐고, 원래 유효했던 뺄셈은
그대로였다. 잘못된 평가 입력을 받아들이도록 제품 analyzer를 느슨하게 바꾸지 않았다.
로컬 Kotlin compiler는 없어 compiler/type 검증으로 표현하지 않는다.

학습 corpus 자체를 별도로 검사하니 완전한 Kotlin 반복문 **104건**에도 같은 결함이
있었다. 훈련 96건, 검증 8건이며 누락·의도적으로 잘린 예제는 이 완전성 검사에서
제외했다(`kotlin-training-source-audit.json`). 이전 Host 응답 및 decoder grammar 검사는
응답 형태를 확인했으므로 잘못된 입력 소스를 발견하지 못했다.

별도 `training-data-production-kotlin-fixed.json`에서 이 104건의 `} return` 사이에만
줄바꿈을 추가했다. 공백을 제외한 원문 token과 기존 summary/flow/role 정답을 보존하고,
실제 파서의 반환·변경 정보와 현재 제품 schema로 해당 행의 prompt/wire를 다시 만들었다.
해당 104건은 기존 role/output/effects 가변 wire에서 role 가변 wire로 바뀌었다.
output/effects는 기존 제품의 source syntax 슬롯으로 복원되며, 모델에 전달되는 전체
소스나 summary/flow를 줄이거나 정적 설명으로 대체하지 않았다. 나머지 **1,560행**은
byte 수준에서 동일하다. corpus SHA-256은
`d0168043019a2f1d1e7dfc692c612f886af9a43047532091d507d848933c9ff8`이다.

`production-kotlin-source-repair.json`에서 1,248개 완전한 TypeScript/Kotlin fixture의
선언·inventory를 확인했고, 완전한 Kotlin 624건에 parser diagnostics가 없었다.
전체 1,664건의 Host 응답 및 decoder grammar/EOS 검사도 통과했다. 이전 corpus·가중치·
응답은 보존했고, 이 학습 데이터 보정에는 heldout 응답을 사용하지 않았다.

공개 offline helper `scripts/model-reading-fixture-validation.mjs`의
`assertCompleteModelFixtureSyntax(callee, syntax, label, options)`는 복구된 선언과 누락된
source inventory를 거부한다. 유효한 선언의 보수적인 `limited` 표시는 그대로 허용하며,
균일한 inventory가 필요한 공개 context benchmark만 `requireCompleteInventories: true`를
명시한다. 유효한 `notify(...)`의 inferred effect 때문에 inventory가 제한된 경우를
문법 오류와 혼동하지 않는다. 제품 runtime에는 연결하지 않았다. 복구 선언·누락·형태 오류·
의도적인 제한 metadata·빈 inventory를 다루는 회귀 검사를 포함해 **45개** 패키지/평가
스크립트 테스트가 통과했다.

새 평가의 preflight는 완전한 context 24개를 확인했다. Kotlin의 음수 guard·분기/catch
결합·반복문 × 한국어/영어 **6개 context**만 유효한 원문과 inventory로 바뀌었고,
나머지 **26개**는 기존과 byte가 같다(`production-holdout-preflight-ASXDP5/report.json`).
입력이 바뀐 Kotlin 6건의 이전 시간과 이후 시간을 matched 속도 비교로 사용하지 않는다.
이 준비 결과만으로 모델 정확도나 3초 달성을 주장하지 않는다.

같은 fresh base·seed·LoRA 설정·200 iterations의 학습은 **279.96초**, peak allocation
**8,107.13 MiB**를 사용했다. 별도 4bit/group 128 가중치는 914,316,110 bytes이며
SHA-256은 `010808620d6c2a59ddb21e5ae81ae858d33996b678fcb5753e25a797deb8191e`다.
기존 가중치를 덮어쓰거나 설치하지 않았다.

`production-holdouts-pzA4Ig/report.json`에서 32건 모두 새 전체 응답이 완료됐고
소요 시간은 **1.012–10.498초**, 3초 이내는 **21건**이었다. 자동 필요 조건은 26건,
시간과 동시 통과는 18건이었다. 실제 wire의 모델 작성 필드를 32건 모두 읽은
`kotlin-source-rereview.json`에는 **19건의 확실한 반례**를 별도로 기록했다.
18건을 의미 정확성과 시간 목표의 달성 건수로 해석하지 않는다.

영어 뺄셈은 없는 분기를, TypeScript 영어 단순 쓰기는 없는 finally를 만들었다.
한국어 catch role은 역할 설명 대신 후보 본문 문구를 반복했다. 한국어 결합 분기에서는
catch가 `valueArg * 4`를 반환한다고 설명하고 실제 `-3`을 빠뜨렸으며, summary가 부모의
`seedValue`를 callee의 `valueArg`로 바꿨다. 영어 결합 분기는 올바른 flow와 함께
catch를 빠뜨린 가변 output과 닫히지 않은 code span을 출력했다. Kotlin 영어 반복문의
반환 조건·fallback도 잘못됐다. 반복문 flow의 문장 반복, 구현이 없는 한국어 callee의
`seedValue < 10` 및 반환 `10` 창작, 잘린 본문의 `otherwise valueArg`나 `other` 반환과
미확인 효과의 부정도 남았다. 정확한 role·flow·복원된 필드가 다른 가변 필드의 오류를
상쇄하도록 평가하지 않았다.

Kotlin 한국어 반복문은 447 output tokens를 만들었고 decode 구간만 약 9.995초였다.
같은 token 수의 다른 응답에서도 시간 편차가 있어 문법 수정만의 속도 개선율을 주장하지
않는다. 새 trial은 full prompt/provider/current Host parser 경계의 측정이며 outer Host
전달과 전체 scope/rich 완료를 대신하지 않는다. 이미 필수 정확성과 3초를 함께 입증하지
못했으므로 이 모델의 제품 통합이나 추가 scope/rich 생성으로 확대하지 않았다.

학습·병합·평가 프로세스는 모두 종료됐다. 제품 runtime·기본 모델·사용자 설정·CSS와
설치된 **0.0.1145**를 유지하며, 이번 변경은 offline fixture 검사와 검증 기록이다.

### 학습 구조 범위의 공백 보완

Kotlin 문법을 고친 보존 corpus 1,664건을 독립적으로 다시 검사했다.
`kotlin-fixed-supervision-coverage-audit.json`의 제한된 source/prose 검사는 모순을 찾지
못했지만, 훈련에는 **분기와 catch의 결합 0건, 음수 guard 0건, `-=` 갱신 0건**이었다.
모델이 틀린 구조와 학습 범위의 공백이 겹쳤다. 이것만으로 모든 모델 오류의 원인이
학습 범위라고 단정하지는 않는다.

별도 corpus에 훈련 **432건**, 검증 **108건**을 추가했다. 계산·음수 guard·지역 쓰기·
catch/finally·분기/catch 결합·감소 반복·구현 누락·잘린 본문을 포함한다. 완전한 소스는
같은 본문에 exact/inferred와 외부 omission metadata를 독립적으로 변화시켜 이 표시를
입력 조건으로 배우지 않도록 했다. Kotlin/TypeScript와 한국어/영어를 모두 포함하고,
평가 corpus와 다른 함수명·변수·상수를 사용했다. 기존 1,664행은 그대로 보존했다.

`scripts/model-reading-coverage-fixtures.mjs`는 이 제한된 fixture의 source renderer와
전체 정답 설명을 제공한다. 실제 학습 전에는 별도 생성기가 제품 parser로 60종의 완전한
본문을 읽어 반환식의 then/try/catch 소속과 finally 호출·쓰기 소속을 대조했다.
Kotlin 30개 본문에는 parser diagnostics가 없었다. 공통 TypeScript loop inventory는
predicate를 보존하지 않으므로 TypeScript AST의 실제 WhileStatement.expression으로
반복 조건을 따로 확인했으며, runtime inventory를 강화하거나 만들어 넣지 않았다.
구현 누락과 잘린 소스의 반환·효과는 각 가변 설명 필드에서 미확인으로 남겼다.

`production-coverage-independent-audit.json`은 생성된 wire를 label renderer와 별도로
검사했다. 전체 **2,204건**의 current prompt/schema와 Host 응답 검사가 통과했고,
decoder grammar/EOS도 모두 통과했다. 실제 고정 입력 mapping 1,976건을 대조했다.
완전한 예제의 사용되지 않는 input-template placeholder는 schema 소유 입력으로
교체돼 학습 wire에 들어가지 않았으며, 공개 fixture helper도 선언된 매개변수를 표시한다.
추가 검증 원문은 전체 훈련 원문과 분리했다. 필요 조건 검사에서 문제가 없다는 사실을
일반적인 자연어 의미 정확성의 증명으로 해석하지 않는다.

`training-data-production-coverage.json`의 SHA-256은
`a7b9687356d89cfd5d1c40af09ea72b2f97b1c215014e6689f67bebf9375f0eb`이며,
훈련 1,968건·검증 236건이다. 전체 소스·summary/flow·다섯 호출 상세와 현재의 출력 제한을
유지했다. 모델이 소스를 읽는 실제 inference 대신 이 fixture 설명을 사용하는 경로는 없다.
학습 데이터 생성과 감사는 heldout 응답을 읽지 않았다. 평가 preflight의 32개 context는
직전 유효한 Kotlin trial과 전부 byte가 같았다(`production-holdout-preflight-tMyUZF/report.json`).

회귀 검사를 포함한 패키지/평가 스크립트 테스트 **51개**가 통과했다. 같은 fresh base·seed·
LoRA/optimizer 설정으로 200 iterations를 학습하는 데 **278.98초**, peak allocation
**8,214.09 MiB**를 사용했다. 별도 4bit/group 128 가중치는 914,316,110 bytes이며
SHA-256은 `0f108892f6a78484612beb845dfcfae4988f92e1987bc7b37abb349c703c1514`다.

`production-holdouts-dTtU48/report.json`의 새 전체 응답 32건은 **0.872–4.372초**에
완료됐다. 3초 이내는 **25건**, 자동 필요 조건 통과는 26건, 둘 다 통과는 21건이었다.
32건의 실제 모델 작성 필드를 모두 읽고 `coverage-rereview.json`에 **확실한 반례 13건**을
기록했다. 단순 쓰기의 `n -= 3`을 무시한 반환 설명, 실제 쓰기를 부정하는 flow,
결합 분기의 잘못된 catch 반환, 구현이 없거나 잘린 본문의 반환·효과 창작이 남았다.
영어 결합 분기의 가변 output은 유효한 JSON/EOS여도 180자 경계에서 `completi`로 끝났다.
완료된 문장을 요구하므로 이것도 실패다. 자동 검사 21건을 의미 정확성과 시간의 동시
달성으로 해석하지 않으며, 별도 실행의 최대 시간 차이를 속도 개선율로 사용하지 않는다.
outer Host 전달·전체 scope·rich 시나리오는 이 결과로 입증되지 않았다. 이 가중치는
채택하거나 설치하지 않았다.

`coverage-wire-layout-audit.json`은 응답을 읽지 않고 실제 훈련 입력과 평가 preflight만
비교했다. 평가 32건의 source 구조·언어·locale·wire layout 조합은 전부 훈련에 존재했다.
따라서 남은 오류를 출력 layout 예제의 부재로 설명하거나 동일한 구조를 무작정 추가하지
않는다. 설치된 MLX sampler는 길이별로 정렬한 singleton batch를 한 epoch 안에서 중복
없이 순회한다. 기존 200-step 실험은 훈련 1,968건 중 **최대 200건(10.16%)**에만 update를
적용할 수 있었다. 과거 실제 선택 index의 trace는 없어 어느 행을 배웠는지는 단정하지 않는다.

이에 같은 1.7B fresh base·seed 42·rank 8·scale 20·dropout 0·16 layers·Adam 1e-4·
batch 1의 update 설정을 유지하고, iteration 수를 훈련 행 수 **1,968**로 정한 완전한
한 epoch를 실행했다. 긴 실행의 report/eval/save 간격은 각각 40/200/200 steps로 정했다.
이전 짧은 실행의 간격은 10/80/40이었다. 이 관찰·저장 주기 차이를 숨기거나 학습 시간의
차이를 iteration 수만의 효과로 해석하지 않는다.
완료된 200-step snapshot과 앞선 짧은 실행의 최종 adapter는 `cmp`로 byte가 같음을
확인했다. 두 SHA-256은 `7eb7fd45457c2374f1fbd66ed65b62e387341ced2702551ea82c5eadf9c00fec`다.
이는 이 시점의 update 결과를 대조한 수치 control이며, 과거 실제 선택 index의 trace나
전체 epoch의 정확도·완료 시간을 입증하지는 않는다.
전체 prompt와 정답을 보존하고 실제 yielded batch의 index를 기록했다. 훈련 종료 후
**1,968개 서로 다른 index**와 모든 update의 완료를 확인했다. trace SHA-256은
`8d715df24e5f8a4e7e334829a9a9938136b7ce28d249a1e30c95f170f2175d40`이다.
훈련은 **2,774.34초(약 46분 14초)**, peak MLX allocation **8,509.81 MiB**를 사용했다.
완료된 훈련 기록과 trace를 별도로 검사한 뒤 병합했다. 새 4bit/group 128 가중치는
914,316,110 bytes이며 SHA-256은
`63b84afa8e7916230f8f83b07f647231d301186ebe8f6edb305da4cfb2c55ec4`다.

`production-holdout-preflight-MP3B4C/report.json`의 32개 context는 직전 coverage trial과
전부 byte가 같다. `production-holdouts-4TdJnv/report.json`에서 새 전체 응답 32건은
**1.049–5.720초**에 완료됐다. 3초 이내는 **23건**, 자동 필요 조건 통과는 30건,
둘 다 통과는 21건이었다. `coverage-epoch-rereview.json`에 실제 모델 작성 필드 32건을
모두 읽은 결과와 **확실한 반례 2건**을 기록했다. 이번 응답에서는 쓰기 순서와 누락·잘린
구현의 미확인 설명에 앞선 오류가 반복되지 않았지만, 일반 정확도 보장으로 해석하지 않는다.

TypeScript 영어 결합 분기는 catch의 `-3`와 finally의 `inspectValue(valueArg)`를
빠뜨리고 내부 호출이 없다고 설명했다. Kotlin 영어 결합 분기는 본문에 없는
`valueArg = 14` 초기화를 만들고, 부모 인수 `seedValue`를 callee의 지역 초기화로
설명했다. 실제 조건·일반 반환과 finally를 빠뜨리고 쓰기·내부 호출도 부정했다.
복원된 source syntax 필드가 가변 flow/role/output의 오류를 상쇄하도록 평가하지 않았다.

추론 worker의 누적 peak는 **MLX allocation 1,752.20 MiB**, **OS RSS 1,425.64 MiB**였다.
두 값은 준비 구간을 포함한 서로 다른 측정치이며, 부모 Host와 VS Code 전체 메모리는
포함하지 않는다. 한국어 잘린 본문의 TypeScript/Kotlin 설명은 모델 작성 문장이 byte가
같고 각각 225 output tokens였지만, 전체 시간은 **2.960/5.720초**, decode는
**2.594/5.369초**였다. prompt 구간은 0.346/0.327초였다. 이 차이를 Kotlin 자체의 비용이나
cold prefill만의 문제로 확정하지 않으며, 별도 실행의 시간 차이로 개선율을 만들지 않는다.

4bit 병합의 영향만 분리하기 위해 실패한 영어 두 context를 입력 전용 preflight에서 읽고,
같은 base와 실제 학습한 floating LoRA를 병합 없이 사용했다.
`coverage-epoch-unfused-0F8HhA/report.json`의 두 새 응답에서도 부모 인수를 callee의
지역 초기화로 만들고, 참인 분기의 실제 `14`를 `-3`으로 바꾸며 finally를 빠뜨렸다.
전체 시간은 **4.187/2.468초**였다. 병합을 제거하는 것만으로 실패가 해결되지 않았다.
이 두 건으로 모든 수치 오차의 영향을 부정하거나 일반 성능을 주장하지 않는다.

같은 folded 모델에 인수→매개변수 binding과 callee 내부 초기화를 구분하고 각 분기·catch
반환과 finally 호출을 보존하라는 고정 안내만 추가해 두 context를 다시 확인했다.
전체 원문·wire·필드·출력 제한은 유지했다.
`coverage-epoch-call-boundary-QcJPvp/report.json`의 TypeScript 영어 응답은 여전히
catch/finally를 빠뜨리고 내부 호출을 부정했다. Kotlin 영어 flow는 finally를 포함했지만
없는 `valueArg = seedValue` 초기화를 만들었고 role도 잘못됐다. 가변 output은 180자
경계에서 열린 code span의 `inspectValue(valueAr` 조각으로 끝났다. 전체 시간은
**1.378/4.773초**였다. 이 안내도 제품 prompt에 반영하지 않았다. 추가 안내를 계속
붙이는 것만으로 정확도나 3초를 입증했다고 해석하지 않는다.

훈련·병합·32건 평가·두 건 수치 분리·두 건 안내 확인 프로세스는 모두 종료됐다. 제품 runtime과 설치된
**0.0.1145**는 유지한다. 새 가중치를 채택하지 않았으며, 실제 outer Host 전달·전체 scope·
rich 완료와 3초 목표는 아직 입증되지 않았다.

### 설명 생성 순서와 샘플링 연산 확인

`calls-first-layout-grammar.json`은 실제 1.7B tokenizer와 설치된 LLGuidance로,
JSON `properties`의 순서가 생성 순서를 제한함을 확인했다. 기본 wire는 summary를
먼저 요구하고 calls를 먼저 시작하면 거부했다. root properties에서 calls만 앞으로
옮기면 calls로 시작하는 prefix를 받아들였다. required 배열의 순서를 함께 바꿀 필요는
없었다. 이 검사는 모델 실행이나 설명 정확도·속도 측정이 아니다.

같은 full-epoch 가중치와 두 영어 결합 분기 context에서 calls를 summary/flow보다 먼저
생성했다. 실제 원문, 모든 필드·제한과 원래 identity 기반 wire decoder를 유지하고
전체 schema 제약의 동등성도 검사했다. `coverage-epoch-calls-first-4KqfJN/report.json`의
새 전체 설명은 TypeScript **1.581초**, Kotlin **4.975초**였다. 모델 요청은 각각 한 번이며
기존 Host parser를 거쳤지만 실제 outer Host 전달을 측정한 결과는 아니다.

`calls-first-layout-review.json`에 모든 생성 필드를 읽은 **반례 2건**을 기록했다. 두 role은
완전한 callee 본문을 잘린 본문이라고 설명했다. TypeScript flow는 catch의 `-3`을 finally의
선택으로 잘못 옮겼고, 가변 output은 180자 경계에서 불완전한 절로 끝났다. Kotlin output은
일반 반환과 catch를 빠뜨렸고 flow는 finally 호출을 누락하며 내부 호출도 부정했다.
이 순서 변경은 제품에 적용하지 않았다. 앞선 잘못된 flow만이 뒤 필드 오류의 원인이라는
가설이나 정확도·3초 개선은 입증되지 않았다.

설치된 MLX sampler는 top-p에서 전체 vocabulary를 정렬하고 이어서 top-k와 categorical
sampling을 수행한다. `stock-sampler-cost.json`은 원문·모델 가중치 없는 합성 tensor에서
이 연산의 비용만 측정했다. vocabulary 151,936, 서로 다른 분포·mask의 여섯 설정에서
전체 sampler의 중앙값은 **약 0.79–2.79ms**였다. 이 수치를 실제 모델 decode의 시간
비중으로 해석하거나, 각 설정 간 시간 차이를 분포 자체의 영향으로 단정하지 않는다.

이어 동일한 sampler를 `mx.compile`로 감싼 경로를 비교했다. temperature 0.2, top-p 0.95,
top-k 40과 연산 순서는 유지했다. float32/bfloat16 × 세 분포 × 두 mask의 12개 설정에서
실행 순서를 번갈아 바꾸고 같은 입력·초기 난수 상태로 **768쌍**을 실행했다.
`compiled-sampler-comparison.json`에서 선택 token과 갱신된 난수 상태는 모두 같았다.
중앙값은 8/12 설정에서 감소했지만 감소량은 최대 약 **0.023ms**였고 나머지 네 설정은
늘었다. 의미 있는 완료 시간 개선을 입증하지 못해 실제 모델이나 제품 실행기로 확대하지
않았다. 이 합성 비교를 새 소스 설명 768건 또는 전체 3초 측정으로 세지 않는다.

### 학습 손실의 응답·EOS 경계 점검

전체 epoch의 encoder는 이미 원문 prompt를 전부 입력으로 유지하면서 prompt 위치의
손실을 제외했다. 따라서 남은 오류를 prompt 전체를 학습하는 설정 탓으로 설명하지 않는다.
다만 설치된 trainer의 기본 loss는 exclusive sequence length와 같은 위치까지 target으로
포함했다. stock iterator가 EOS 뒤에 붙인 첫 zero-padding token도 손실에 들어갔다.
현재 tokenizer에서 token 0은 `!`다.

`completion-loss-boundary-audit.json`은 stock iterator와 실제 SDK loss의 작은 fixture에서
target 위치와 gradient를 직접 검사했다. prefix 뒤 응답 두 token과 EOS인 위치 3/4/5 외에
padding 위치 6도 기본 loss의 gradient가 있었다. 실험용 `completion_loss.py`의 exclusive
end 보정에서는 위치 3/4/5만 남고 원문 prompt·EOS·응답은 보존됐다. 이어 전체 **2,204행**의
실제 tokenizer 결과에서 경계를 열거해 훈련 1,968행·검증 236행 모두에 같은 추가 padding
target이 있음을 확인했다. 보정된 응답+EOS target은 각각 266,027/35,183개이며 최대 길이는
기존과 같은 2,028 tokens다. 전체 행에 gradient 실험을 반복한 결과는 아니다.

이 점검은 추가 padding target을 입증했으며, 기존 영어 결합 분기 오류나 추론 지연의 원인임을
입증하지 않았다. 이 경계 점검이 끝난 시점에는 새 학습을 실행하지 않았다. 후속 학습과
새 응답은 아래에 별도로 기록한다. grammar·모델·합성 sampler·loss 검증 프로세스는 모두 종료됐고 제품 runtime과 설치된
**0.0.1145**를 유지한다. 실제 outer Host·전체 scope·rich 완료 및 3초 목표는 여전히 미달이다.

### 패딩 손실 보정 후 동일 순서 학습과 역할 재읽기

`completion_loss.py`의 exclusive-end 보정을 적용해 같은 fresh 1.7B base와 동일한
1,968행을 한 차례 학습했다. 원문·응답·EOS·최대 길이 2,028 tokens와 seed 42,
rank 8/scale 20/dropout 0/16 layers/Adam 1e-4/batch 1/최대 sequence 3,072를 유지했다.
report/eval/save 간격도 앞선 전체 epoch와 같은 40/200/200이다. 변경한 학습 의미는
EOS 뒤 padding target의 제외와 그에 맞는 유효 target 수의 정규화다.

`training-epoch-adapter-production-coverage-exclusive-eos-result.json`은 **1,968개 서로
다른 행의 update 완료**, 소스·정답 무절단과 이전 전체 epoch와 byte가 같은 처리 trace를
확인했다. trace SHA-256은 `8d715df24e5f8a4e7e334829a9a9938136b7ce28d249a1e30c95f170f2175d40`이다.
학습은 **2,508.41초(약 41분 48초)**, peak MLX allocation **8,598.05 MiB**를 사용했다.
별도 실행의 학습 시간 차이를 손실 보정의 속도 개선율로 해석하지 않는다.
완료 기록·trace를 다시 검사한 뒤 만든 4bit/group 128 병합본은 914,316,110 bytes이며
SHA-256은 `9e39d6964fb1fc4fe154edaf4a25262881a9bfe579d48c7f1020cf180002d444`다.

`production-holdout-preflight-sX8qoB/report.json`의 32개 context는 기존 preflight와 전부
byte가 같다. `coverage-epoch-exclusive-eos-9110Q3/report.json`에서 실패했던 영어 결합 분기
두 건을 새로 생성했다. 전체 설명은 TypeScript **1.268초**, Kotlin **1.237초**였다.
각각 실제 모델 요청 한 번과 기존 Host parser를 거쳤다. 두 응답의 flow/output은 조건·
일반 반환·catch 반환과 finally를 보존했지만, role은 완전한 callee를 잘린 본문이라고
설명했다. `exclusive-eos-rereview.json`에 실제 생성 필드를 모두 읽고 두 반례를 기록했다.
따라서 전체 32건·실제 outer Host·rich로 확대하거나 새 가중치를 채택하지 않았다.
worker 누적 peak는 MLX allocation **1,711.90 MiB**, OS RSS **1,398.05 MiB**였으며
Host와 VS Code 전체 메모리를 포함하지 않는다.

이어 전체 설명 생성 후 동일 원문을 다시 읽어 role만 모델이 새로 작성하는 두 단계 경로를
별도 실험했다. 원래 설명은 먼저 full wire로 검증하고, 재읽기에도 원래 source data와
metadata를 전부 제공했다. 새 모델 role만 합치고 다섯 상세의 다른 항목과 summary/flow는
보존했다. 정적 답변으로 대체하지 않았으며 원래 role 160자 제한도 유지했다. 원문·완전성
flag·누락/부분 구현·target 수·다른 상세·최종 Host 제한의 회귀 검사 **8개**가 통과했다.

`coverage-epoch-exclusive-eos-role-reread-k0ZLHn/report.json`의 전체 완료는 두 실제 모델
요청을 모두 포함해 **5.871/3.562초**였다. 새 role은 정상 `valueArg * 4` 반환을 catch에
잘못 배정했다. Kotlin은 exact 관계도 candidate라고 불렀다. 첫 단계의 실제 생성 필드는
앞선 단일 요청과 byte가 같고, 최종 결과의 role 외 필드는 모두 보존됐다. 그러나 첫 단계
자체도 3.986/2.864초로 달라졌으므로 전체 시간 차이를 재읽기 비용만의 영향으로 단정하지
않는다. 이 방식도 채택하지 않았으며 추가 안내문이나 재시도를 계속 붙이지 않았다.

`compound-source-diversity-audit.json`은 기존 자료만 읽어 결합 분기의 고유 소스와 metadata
반복을 구분했다. 언어·locale별 훈련 16행은 **고유 소스 4세트**, 검증 4행은 **1세트**다.
exact/inferred와 task.sourceLimited 양쪽 값, 실제 wire layout은 이미 포함돼 있다.
네 소스에서는 이름·비교식·상수·계산식·catch 값이 네 묶음으로 함께 변한다. 이 결과는
독립적인 소스 조합을 더 확인할 근거이며, 남은 오류의 원인을 입증한 것은 아니다.
진행 중인 학습 자료나 기존 corpus를 바꾸거나 heldout 응답을 새 학습에 쓰지 않았다.

훈련·병합·두 단일 요청·두 재읽기 요청과 회귀 검사 프로세스는 모두 종료됐다.
제품 runtime과 설치된 **0.0.1145**를 유지한다. 두 빠른 응답을 전체 3초·정확도 달성으로
해석하지 않으며 실제 outer Host·전체 scope·rich 완료 기준도 그대로 남아 있다.

## 복합 분기의 독립 조합과 학습 전 검증

기존 결합 분기 자료에서 이름·비교식·상수·계산식·catch 반환값이 네 묶음으로 함께
변한다는 관찰에 따라, 소스 조합을 확장했다. 이는 남은 역할 설명 오류의 원인을
확정한 조치가 아니며 작은 모델의 새 설명으로 검증해야 할 가설이다.

오프라인 public helper `scripts/model-reading-compound-fixtures.mjs`는 다음 API를 제공한다.
제품 runtime은 이 모듈이나 정답 문장을 가져오지 않는다.

- `compoundCases(split, kind)`는 `training`/`valid`와 `combined`/`partial`/`missing`에
  맞는 고유 소스 descriptor를 반환한다. 사용하지 않는 차원의 반복은 제외한다.
- `compoundSpec(kind, language, descriptor)`는 TypeScript/Kotlin 소스와 그 소유 표현을
  만든다. 설명 문장은 기존 `coverageReading`을 재사용한다. 실제 추론에 정적 설명을
  주입하거나 heldout의 생성 응답으로 정답을 만들지 않는다.

비교 연산·비교 상수·일반 계산 연산·조기 반환값·catch 반환값을 각각 4수준으로 두고
OA(16,5,4,2)로 조합했다. 각 요인 쌍은 16가지 수준 쌍을 모두 포함하지만 4⁵가지의
전체 조합은 아니다. 함수/인수/매개변수 이름군과 계산 피연산자 수준은 각 16행에
별도로 교차한다. 훈련은 이름군 2개와 피연산자 2개, 검증은 새 이름군 1개와 새
피연산자 2개를 사용한다. 검증용 숫자 풀도 별도로 구성했다.

같은 이름의 완전·부분·누락 구현을 함께 제공한다. 부분 구현은 직접 if/return만 보이는
미완성 선언이며, 완전한 try 본문의 prefix라고 주장하지 않는다. 완전 본문에는
exact/inferred 및 root sourceLimited 양쪽 값을 유지하고, target.sourceLimited는 false다.
부분 본문은 target 제한과 잘림 flag를 유지한다. 누락 구현에는 매개변수 선언을 만들지
않는다. scope는 소스마다 회전하며 모든 의미 조합과 scope의 전체 교차를 주장하지 않는다.

기존 **2,204행**을 보존한 새 corpus는 훈련 **3,256행**, 검증 **880행**이다. 추가분은
각각 1,288/644행이며 SHA-256은
`67ded9ef4d3a0bdce95cfb70925e64dcde89b750c4f0a559b794a4a03255c717`이다.
언어별 완전한 훈련 소스 64개와 검증 소스 32개, 총 **192개**를 실제 parser로 검사했다.
세 반환값의 try/조건/catch 소유권, finally 호출 위치, 부모의 반환 사용을 확인했고
Kotlin 복구 구문을 허용하지 않았다. 부분 구현 384행은 기존의 제한된 잘림 guard도 통과했다.
전체 설명을 wire에 투영하기 전에 1,932개 추가 행의 모든 문장 길이·원문 인용·confidence·
미확인 효과를 검사했다. 원문이나 설명을 잘라 제한에 맞추지 않았다.

`production-compound-independent-audit.json`은 renderer를 가져오지 않고 실제 corpus와
native parser에서 요인을 다시 추출했다. 12개 언어/이름/피연산자 그룹의 각 10개 요인 쌍,
총 **120개 검사**에서 모두 16개의 서로 다른 수준 쌍을 확인했다. 새 검증 소스는 기존
자료를 포함한 모든 훈련 소스와 겹치지 않는다. 전체 **4,136행**의 현재 production prompt·
schema·wire decode·Host parser가 일치했고 선언이 있는 **3,896행**의 실제 인수 매핑도
확인했다. 이는 문장의 모든 의미나 실제 모델의 정확도를 입증하는 검사는 아니다.

`production-compound-tokenization-audit.json`은 전체 4,136행의 정답과 EOS가 실제
LLGuidance schema에서 완료되는지 확인했다. 최대 sequence는 기존과 같은 **2,028 tokens**다.
훈련 prompt 4,637,589 tokens와 응답+EOS target 534,763개, 검증 prompt 1,289,120 tokens와
target 169,935개를 보존했다. 기존에 gradient로 확인한 exclusive-end 손실 코드를 그대로
사용하며 응답+EOS만 학습하고 뒤 padding은 제외한다. 이 손실 보정의 정확도 개선은 아직
채택 근거가 없다.

새 helper의 6개 회귀 검사를 포함한 `npm run test:package` **57개**가 통과했다.
다음 학습은 기존 seed/model에서 새로 시작하는 **3,256 update의 한 번의 완전한 pass**로
제한한다. 기존 adapter를 이어서 학습하거나 임의의 추가 epoch를 반복하지 않는다.
기존 rank/scale/layers/optimizer·원래 단일 요청 prompt/wire·전체 원문·출력 한도를 유지한다.
90분 상한, 실제 yielded-index trace 및 모든 update 종료 검사를 적용하며 중간 snapshot을
완료로 해석하지 않는다. 현재 자료와 사전 검증은 모델의 정확도·3초 완료·실제 outer Host·
전체 scope·rich 달성의 증거가 아니며 설치된 **0.0.1145**를 유지한다.

## 독립 조합 전체 학습과 확장 검증

`training-epoch-adapter-production-compound-exclusive-eos-result.json`에서 새 corpus의
**3,256개 서로 다른 행의 update 완료**와 원문·응답·EOS 무절단을 확인했다. 기존 seed 42,
rank 8/scale 20/16 layers/Adam 1e-4/batch 1 및 exclusive-end 손실을 유지했다. 기존 adapter를
이어 학습하지 않았다. 실제 yielded-index trace SHA-256은
`ad5d6ca72f06343980291d4c635aff7681d0f34078ffaee85e7003cb9917be05`다.
학습은 **4,722.25초(약 78분 42초)**, peak MLX allocation **8,638.02 MiB**였다. 이는 오프라인
학습 자원이며 추론의 메모리나 설명 시간을 뜻하지 않는다.

전체 완료·trace·corpus·손실 코드의 hash를 확인한 뒤 별도 4bit/group 128 가중치로
병합했다. 914,316,110 bytes이며 SHA-256은
`d0897d47139255bf679994252c5b78505e71aa676634f9ca1921aa9498e56212`다.
기존 가중치·설정·설치 모델을 보존했다. `production-holdout-preflight-jVsTvM/report.json`의
32개 context는 기존 `MP3B4C` preflight와 모두 byte가 같다. 완전 본문 24개와 의도적인
누락/잘림 8개이며, source-free 준비 이후 매번 전체 원문으로 새 설명을 생성했다.
원래 단일 요청 prompt/wire/출력 한도를 유지했고 안내문·재읽기 단계를 추가하지 않았다.

`compound-exclusive-eos-pilot-Y2dJ1q/report.json`의 새 영어 결합 분기 설명은 TypeScript
**1.429초**, Kotlin **2.439초**였다. 각각 실제 모델 호출 한 번, cached tokens 0, 출력
192 tokens다. 실제 생성 summary/flow/role/output과 복원된 다섯 상세를 모두 읽었다.
이 두 필요 사례에서는 이전의 잘린 본문이라는 역할 오류가 사라졌고, 조건·try의 두
반환·catch 반환·반환 완료 전 finally 호출·미확인 내부 동작과 정상 완료 조건을 보존했다.
두 사례의 통과를 전체 정확도나 실제 outer Host의 3초 완료로 해석하지 않았다.

이어서 `production-holdouts-h5ogvh/report.json`에서 한국어/영어·TypeScript/Kotlin의
**32개 설명을 모두 새로 생성**했다. 원문 숫자·필수 flow 사실 등에 대한 기존 자동 검사는
32개가 통과했지만, **25개만 3초 이내**였고 범위는 **0.960~4.598초**였다. 각 설명에는
실제 모델 호출 한 번과 Host parser 처리가 있으며 모든 cached tokens는 0이다.

`compound-all32-rereview.json`에 32개 실제 생성 필드와 다섯 최종 상세를 모두 읽은
결과를 기록했다. 자동 통과만으로 채택할 수 없는 다음 반례가 있다.

- 한국어 누락 구현 2개는 flow에서 호출부의 입력 전달을 **없는 대상 본문의 작업**으로
  설명했다. role/output/effects의 미확인 표현이 이 별도 긍정 주장을 정당화하지 않는다.
- 한국어 쓰기 사례 2개와 Kotlin 한국어 loop는 flow 문장을 그대로 반복했다.
- Kotlin 한국어 loop의 “종료 조건이 참인 동안 … 반환”은 불명확한 종료 설명이다.
  이 문구만으로 조건의 반대 의미를 단정하지 않으며 명확한 조건 반전 오류로 세지 않았다.

`findUnavailableCalleeBodyClaims(reading, context, wireSchema)`를 오프라인 검증 모듈에
추가했다. 단일 callee의 본문이 제공되지 않았는데 모델이 본문 작업을 긍정하는 좁은
한국어/영어 표현을 찾는다. 실제 생성 필드만 검사하고, 제공되거나 잘린 helper 본문과
다중 호출 flow에는 이 판정을 적용하지 않는다. 다른 문장의 “미확인”이 근거 없는 본문
주장을 가리지 않도록 문장별로 처리한다. 일반 의미 검증기나 runtime 응답 교정기는 아니다.
4개 새 회귀 검사를 포함한 관련 테스트 **16개**, 전체 `npm run test:package` **61개**가
통과했다. 실제 32개 응답에서는 누락 구현 2개가 이 검사에도 걸린다.

`compound-label-ownership-audit.json`은 현재 corpus만 읽었다. 전체 **4,136행** 중 본문이
없는 target은 **240개**이며, 좁은 본문 작업 표현과 18자 이상의 동일한 flow 문장 반복은
각각 **0개**다. 데이터나 가중치를 바꾸지 않았고 heldout 응답을 읽어 정답을 만들지 않았다.
문자열 검색 결과는 다른 모든 문장의 의미가 맞다는 증명도, 모델 오류의 원인 증명도
아니다. 따라서 이번 결과만으로 잘못된 학습 문장이 원인이라고 하거나 추가 학습을 반복할
근거로 삼지 않는다.

시간 변동은 출력 길이만의 문제가 아니다. 영어 쓰기 두 응답은 실제 생성 wire가 byte로
같고 **121 tokens**다. TypeScript/Kotlin의 전체 완료는 **1.240/2.892초**, prefill은
**0.289/0.325초**, decode는 **0.940/2.548초**였다. prompt는 1,180/1,178 tokens이며
캐시 응답은 없다. 작은 prefill 차이와 같은 출력이 이 decode 차이를 설명하지 않지만,
GPU 대기·grammar 처리·token 이동·sampler·iteration 중 원인은 아직 분리하지 않았다.
다음 성능 검증은 원문·출력·generation 설정을 유지한 실제 전체 생성 경로의 profiling이다.
source-free sampler 실험이나 임의의 안내문/추가 epoch/다른 정밀도 반복으로 대체하지 않는다.

32개 실행의 worker 누적 peak는 MLX allocation **1,752.20 MiB**, OS RSS **1,426.58 MiB**다.
이는 Host와 VS Code 전체 메모리가 아니다. 훈련·병합·두 pilot·32개 실행은 모두 정상
종료됐고, 테스트는 모델 프로세스 종료 후 실행했다. 의미·시간 반례 때문에 이 모델을
채택하거나 실제 outer Host/전체 scope/rich/native 변환으로 확대하지 않았다.
제품 runtime과 설치된 **0.0.1145**를 유지하며 목표는 아직 달성하지 않았다.

## 실제 생성 단계 계측과 모델 그래프 컴파일

`compound-generation-profile-n2aZ3A/report.json`에서 동일한 완전 본문 다섯 개를
기본 실행, 관찰 계측, 단계별 완료를 기다리는 진단 계측으로 각각 새로 읽었다.
**15개 실제 모델 요청** 모두 원래 prompt/wire/schema, temperature 0.2/top-p 0.95/top-k 40,
출력 2,400 tokens/24,000 characters, prefill 512 및 캐시 없는 원문 읽기를 유지했다.
모델 준비 이후 전체 생성과 Host parser까지 측정했으며 실제 outer Host 전달은 아니다.
원문과 다섯 가지 최종 상세를 모두 읽었고, 각 사례의 Host 정규화 후 전체 설명이
세 실행에서 byte로 같았다. 관찰/진단 실행의 실제 생성 wire와 prompt hash도 같았다.

관찰 계측은 모델 graph 작성, token 읽기, grammar consume/mask 계산, sampler graph
작성의 wall time과 현재 Python thread CPU time을 나눴다. 진단 계측은 한 token의
model logits와 sampler 결과를 명시적으로 평가했다. 버리는 다중 token prefill logits를
추가로 평가하지 않았다. **lazy graph 작성 시간은 GPU 계산 시간이 아니며**, 평가 대기에는
Metal dispatch·실행·동기화·스케줄링이 함께 들어간다. Wall time에서 한 thread의 CPU time을
뺀 값을 순수 GPU 시간으로 부르지 않는다. 계측·파일 기록 비용은 전체 요청에 포함된다.

`compound-generation-profile-review.json`의 주요 관찰은 다음과 같다.

- 한국어 catch/복합 분기의 mask 계산은 관찰 실행에서 각각 **341.49/496.68ms thread CPU**였다.
  영어 쓰기 두 사례는 **28.51/31.05ms**였다. Token 읽기의 GPU 대기를 이 CPU 비용에 합치지 않았다.
- Kotlin 복합 분기의 관찰 실행은 **7.152초**였다. Mask 계산은 wall **1,049.66ms**와
  thread CPU **496.68ms**, token 읽기는 wall **2,305.92ms**와 thread CPU **50.85ms**였다.
  CPU 작업 외의 대기·스케줄링도 크지만 이 측정만으로 OS/GPU 원인을 확정하지 않는다.
- 진단 실행의 영어 쓰기 TypeScript/Kotlin은 model 평가 대기가 **723.34/2,644.04ms**였다.
  해당 구간의 p95는 **6.59/94.72ms**, 최대는 **14.03/159.84ms**였다. 단계별 평가가
  overlap을 바꾸므로 이 수치를 기본 실행의 단계별 소요나 속도 개선으로 제시하지 않는다.
- 관찰 실행 다섯 개의 한 token model graph 작성은 **113~343ms thread CPU 합계**였다.
  이 반복 비용을 줄일 후보로 sampler가 아닌 모델 decode graph의 컴파일을 확인했다.

### KV 위치를 명시한 컴파일 후보와 실제 원문 비교

원래 Qwen3 layer와 가중치·bf16 KV·attention을 재사용하는 private functional decode를
작성했다. 위치를 tensor 입력으로 받고 모든 유효 KV를 전달한다. Python 정수 위치를
처음 trace에 고정하지 않는다. 한 token decode만 이 경로를 사용하고 원래 SDK prefill을
유지한다. KV 저장을 concatenate 방식으로 바꾼 영향과 컴파일 영향을 구별하기 위해
기본 SDK, functional 미컴파일, functional 컴파일의 세 경로를 따로 비교했다.

`functional-decode-feasibility.json`은 원문 없는 고정 입력의 수치 검사다. Prefix 길이
64/257/1,023과 서로 다른 입력 token 세 개를 사용한 두 후보의 **18개 비교**에서 logits와
모든 layer의 **유효 KV 수치 차이는 0**이었다. 한 signature의 컴파일 trace는 한 번이었다.
모델은 실행했지만 token을 샘플링하거나 소스 설명을 생성하지 않았다. 이 수치 검사를
새 설명 18개나 실제 생성 준비의 완전성으로 세지 않는다.

`compound-functional-comparison-CXvRGW/terminal-review.json`에는 다섯 원문을 실행 순서를
앞뒤로 바꿔 각 경로에서 두 번 읽은 **30개 새 전체 설명**이 있다. 한 worker를 종료한 뒤
다음 worker를 준비했다. 모두 실제 모델 호출 한 번, cached tokens 0이며 앞서 직접 읽은
다섯 설명과 Host 정규화 후 전체 byte가 같다. 결과는 다음과 같다.

| 경로 | 3초 이내 | 평균 | 최대 |
| --- | --- | --- | --- |
| 기본 SDK | 9/10 | 1.716초 | 3.520초 |
| Functional 미컴파일 | 8/10 | 1.959초 | 3.140초 |
| Functional 컴파일 | 9/10 | 2.081초 | 3.082초 |

이 실행의 집계 driver는 **종료 코드 1**이었다. 실제 생성 이후 컴파일 trace가 준비 시의
1개에서 3개로 늘어 준비 게이트에 걸렸다. 30개 개별 결과는 assertion 전에 보존됐지만
정상 집계 `report.json`은 만들어지지 않았다. 이를 성공한 준비 검증으로 고치거나
원래 결과를 덮어쓰지 않았다. 순서를 바꾼 비교도 시스템 부하를 완전히 통제하지 못하며,
컴파일 경로가 전체 3초나 안정적인 개선을 입증하지 못했다.

이후 실제 SDK 생성 stream에서 int32/uint32 입력을 고정 EOS로 미리 실행했다. 원문 읽기와
샘플링 없이 두 signature의 컴파일을 마친 뒤 원래 worker 준비를 거쳐 hook을 설치했다.
`functional-decode-readiness-review.json`의 **두 새 설명**은 준비 trace 2개, 생성 중 추가
trace 0개이며 앞서 읽은 설명과 전체 byte가 같다. TypeScript 쓰기는 **1.163초**, Kotlin
복합 분기는 **4.768초**였다. 준비 누락은 이 두 사례에서 보완됐지만 느린 완료가 남았으므로
초기 컴파일만을 지연 원인으로 삼지 않고 후보를 채택하지 않았다. 이전 30개를 단순히
실패한 준비 게이트를 교체하려는 목적으로 다시 실행하지 않았다.

### JSON 전용 slicer의 동일성 검사

설치된 LLGuidance는 mask 최적화용 `general_slices()`와 `json_slices()`를 제공한다.
`json-slices-mask-parity.json`은 기록된 **실제 wire 706 tokens**와 한국어 원래 regex의
summary/flow/role 길이 경계 **12개**를 CPU에서 재생했다. MaxLength 240/600/160과
한국어 시작 조건을 유지했다. **1,907개 prefix**에서 vocabulary **151,936개**의 모든 mask
bit가 같았고, 길이 한도 이하는 허용하고 초과는 두 방식 모두 거부했다.

현재 설치 버전에서는 두 API가 반환하는 slice 설정 목록 자체가 **동일했다**. 같은 설정의
시간 차이를 최적화 효과로 해석하지 않고 실제 모델 비교로 확대하지 않았다. 이 재생은
모델이나 새 설명을 실행하지 않았으며 전체 요청 시간 측정도 아니다. 다음 진단은 한국어
길이 제한 regex가 native grammar의 mask 비용에 주는 영향을 분리하는 것이다. Pattern의
유한 길이를 제거해도 maxLength가 적용된다고 가정하지 않고 원래 문자·언어·길이 한도의
동등성을 먼저 검증해야 한다.

이번 계측 helper의 CPU 회귀 테스트 **4개**와 Python/Node 구문 검사를 실행했다. 이전
공개 코드의 package 테스트 **61개 통과 기록**은 유지하며 문서만 바뀐 이번 작업에서
재실행했다고 주장하지 않는다. 모든 실험 프로세스는 종료됐고 runtime/UI/기본 모델/
설치된 **0.0.1145**는 바꾸지 않았다. 앞선 누락 본문 설명 오류와 반복 문장, 실제 Host의
전체 scope/rich 검증 및 전체 3초 완료 기준은 계속 미충족이다.

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
