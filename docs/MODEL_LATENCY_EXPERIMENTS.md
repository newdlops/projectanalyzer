# 모델 준비 이후 전체 설명 시간 실험

목표는 모델 준비 이후 소스 입력 처리부터 **전체 설명 완료**까지 3초다. 첫 token, 캐시
응답이나 source-only 결과는 실제 모델 생성의 성공으로 세지 않는다. 함수 호출의 원문,
조건, 반환, 부수 효과, 다섯 상세 항목과 전체 요약을 유지한다.

2026-10-12 추가 검증까지 제품 runtime과 설치 버전은 **0.0.1145**다. 0.6B의 최초
일곱 전체 설명은 의미 7/7, 의미와 3초 동시 통과 5/7이었다. 단일 mask 정렬 생략과
Q/K 정규화·위치 변환 융합 후보도 각각 5/7과 1/7에 그쳐 채택하지 않았다. 후속 K/V
캐시 쓰기 통합 후보는 설명을 모두 보존하고 6/7을 통과했지만 Kotlin 지역 쓰기가
3.138초여서 역시 채택하지 않았다. 아래의 추적 결과나 빠른 개별 응답으로 기존 실패를
교체하지 않으며 3초 목표는 미완료다.

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

## 한국어 native grammar의 중복 길이 검증 제거

설치된 LLGuidance **1.9.1**의 [문자열 compiler 원문](https://github.com/guidance-ai/llguidance/blob/f0971424ec072d3e4d4196bcc7f31a2f60527df9/parser/src/json/compiler.rs#L735)을
확인했다. Pattern과 minLength/maxLength가 함께 있으면 둘의 regex를 교차한다.
이 동작을 llama.cpp의 pattern 우선 처리와 같다고 가정하지 않았다. 현재 한국어 prose의
원래 pattern은 Hangul 첫 글자와 나머지 허용 문자 **0~limit-1개**를 이미 제한한다.
Native compiler에만 넘기는 별도 복사본에서, 이 정확한 유한 pattern과 minLength 1/
maxLength limit가 일치하는 경우의 중복 길이 키를 제거하는 helper를 작성했다.
**모델이 읽는 원래 prompt/wire/schema와 원문은 그대로**이며 pattern의 문자·길이 제한도
유지한다. 영어, 인식하지 못한 pattern, const/enum 및 schema처럼 생긴 고정 JSON 데이터는
바꾸지 않는다. Cycle/depth/node guard가 있는 반복 탐색으로 구현했다. 일반적인 JSON Schema
rewrite의 안전성을 주장하는 helper가 아니라 설치된 native compiler의 좁은 실험이다.

`test_grammar_canonical.py`의 **6개 회귀 검사**는 복사본 독립성, 고정 데이터/실제 schema
경계, 유한 문자 조합, 공유 참조, cycle/depth/node 한도와 인식하지 못한 제약 보존을 확인했다.
`canonical-grammar-mask-parity.json`에서는 원래 32개 wire schema를 양쪽 방식으로 컴파일했다.
한국어 16개만 바뀌었고 영어 16개는 그대로이며 양쪽 native warning은 0개였다.
기록된 실제 wire **706 tokens/5개 사례**, summary/flow/role 길이 경계 **15개** 및
Unicode/escape/control 문자 **16개**를 재생했다. **2,787개 prefix**에서 vocabulary
**151,936개 전체 bit**가 같았고 길이 한도 이하는 허용하고 초과는 거부했다.
이 CPU 재생에서는 모델을 불러오거나 새 설명을 생성하지 않았다.

한국어 두 실제 wire 재생의 mask thread CPU 합계는 다음과 같다. 길이 경계 재생 시간을
모델 설명 시간으로 세거나, GPU 동기화 대기를 이 CPU 비용으로 합치지 않았다.

| 기록된 wire | 원래 grammar | 중복 길이 제거 | CPU 감소 |
| --- | --- | --- | --- |
| TypeScript catch/finally | 171.47ms | 11.34ms | 93.38% |
| Kotlin 복합 분기/catch/finally | 214.29ms | 14.23ms | 93.36% |

`compound-canonical-comparison-srdjzc/report.json`에서는 세 완전 본문을 원래/후보 순서를
앞뒤로 바꿔 각각 두 번 읽었다. **12개 새 설명**이며 한 arm의 worker를 종료한 뒤 다음
worker를 준비했다. 양쪽 모두 같은 진단 wrapper로 원래 worker loop를 사용하고,
원래 단일 요청 prompt/wire, sampling, prefill 512와 출력 2,400 tokens/24,000 characters를
유지했다. 매번 실제 모델 호출 한 번, cached tokens 0이며 원문·출력을 자르지 않았다.
준비 뒤 전체 생성과 Host parser까지 측정했고 실제 outer Host 전달은 아니다.
원래 schema의 hash와 무변경을 확인했다. 각 사례의 **실제 생성 wire hash와 Host 정규화 후
전체 응답 byte가 모든 실행에서 같았다**. 앞서 읽은 세 전체 설명과도 byte가 같다.
현재 응답의 계산·반환·조건·finally/미확인 설명과 다섯 최종 상세를 다시 읽었다.

| Native schema | 3초 이내 | 평균 전체 완료 | 최대 전체 완료 |
| --- | --- | --- | --- |
| 원래 제약 | 3/6 | 3.354초 | 6.777초 |
| 중복 길이 제거 | 1/6 | 4.063초 | 5.305초 |

한국어 복합 분기는 후보에서도 **3.262~5.263초**였다. Schema가 바뀌지 않은 영어 사례도
기본 **0.937~2.447초**, 후보 **4.550~5.305초**로 달랐다. CPU 재생의 개선과 실제 전체
시간의 변동을 구별하며, 이 비교에서 전체 개선이나 안정적인 3초를 주장하지 않는다.
앞선 누락 본문 설명 오류와 반복 문장도 이 native-only 변경으로 해결하지 않았다.
후보를 채택하거나 32개/전체 scope/rich로 확대하지 않았다.

## 실제 Metal command buffer의 완료 시각 진단

설치된 MLX **0.32.3**의 [pinned Metal 실행 원문](https://github.com/ml-explore/mlx/blob/64ea011cb65f14d9ce2737e60db9a4ae91ed7441/mlx/backend/metal/device.cpp#L516)을
확인하고 private worker 프로세스 안에서만 동작하는 계측을 작성했다. 원래 commit을
같은 command buffer로 한 번 호출하고 완료 callback에서 시각을 기록한다. 다른 앱이나
시스템 정책을 바꾸지 않는다. 기록은 최대 16,384개이며 callback과 commit 반환의 기록이
끝난 뒤 복사한다. 1초 수집 한도 뒤 미완료 callback이나 overflow가 있으면 완전한
profile로 인정하지 않는다. 원래 model graph/grammar/sampler에 fence를 추가하지 않았다.

Apple의 [GPUStartTime 문서](https://developer.apple.com/documentation/metal/mtlcommandbuffer/gpustarttime?language=objc)에
따라 GPU 시작·종료 시각은 완료 callback 이후 읽고 같은 system-mach-time 단위의 host
시각과 비교했다. [KernelStartTime](https://developer.apple.com/documentation/metal/mtlcommandbuffer/kernelstarttime)은
**CPU의 command scheduling 시각**이며 GPU kernel 시작 시각으로 해석하지 않는다.
GPU command buffer 경과 구간은 preemption을 포함할 수 있으므로 active hardware occupancy로
부르지 않는다. 제출 후 GPU 시작까지의 간격에도 자기 queue의 작업·의존성이 들어갈 수
있어 다른 앱의 경합으로 확정하지 않는다. 겹치는 구간은 합집합으로 계산하며 각 buffer의
대기 합계를 전체 요청의 critical path로 더하지 않는다.

두 고정 배열 실행에서 계산 결과가 정확히 같고 완료 상태와 양수 GPU timestamp를
확인했다. 모델 로딩·샘플링·소스 설명이 없는 검증이다. 순수 interval helper의 **6개
회귀 검사**는 중첩/인접/역순 구간, 빈 구간, 잘못된 timestamp, 합계와 합집합의 차이,
token window clipping 및 commit 반환 전에 GPU가 시작할 수 있는 음수 차이를 보존한다.

`compound-metal-profile-tSemm0/report.json`은 변경하지 않은 두 완전 본문의 **새 설명 2개**다.
원래 단일 요청·원문·출력 한도와 sampling을 유지했고 cached tokens는 0이다. 두 실제 wire
hash와 Host 정규화 후 전체 설명은 앞서 읽은 응답과 같았다. Native callback과 yield 기록,
파일 저장 비용이 전체 시간에 포함되므로 다음 수치를 비계측 속도 개선으로 사용하지 않는다.

| 원문 | 전체 완료 | Command buffers | GPU 경과 구간 합집합 | CPU scheduling 구간 합집합 |
| --- | --- | --- | --- | --- |
| TypeScript 영어 쓰기 | 2.739초 | 2,075 | 2,601.74ms | 49.96ms |
| Kotlin 한국어 복합 분기 | 3.544초 | 3,184 | 2,977.48ms | 94.30ms |

첫 yield 구간에는 prefill과 lookahead가 포함될 수 있다. 이 구간을 제외한 가장 느린
yield 간격은 각각 **53.50/95.17ms**, 그 안의 GPU 경과 구간 합집합은 **52.76/93.15ms**였다.
이는 진단 실행의 시간 위치를 좁히지만 GPU 내부의 계산·메모리 대기·preemption을 분리하지는
못한다. 현재 환경에는 `xctrace`가 없었으며 해당 도구로 kernel별 분석을 수행하지 않았다.

### 작업 묶음 크기의 한 가지 진단과 기각

위 command 수와 pinned 실행기의 분할 조건을 근거로 **한 가지** 작업 묶음 후보만 확인했다.
MLX가 문서화한 [작업 수/자원 한도 환경 변수](https://github.com/ml-explore/mlx/blob/64ea011cb65f14d9ce2737e60db9a4ae91ed7441/docs/src/usage/environment_variables.rst#L108)를
private worker에서만 각각 **1,024 operations/1,024 MiB**로 설정했다. 전체 decode를 적은
buffer로 묶는 진단이며 기존 **8 GiB 메모리 상한과 256 MiB allocator cache 상한**은 유지했다.
원래 prompt/원문/grammar/sampler/model/출력 한도도 그대로다. 환경 값은 준비 receipt에
기록했고 시스템 전역 설정으로 저장하지 않았다.

`compound-metal-profile-larger-JdJKgp/report.json`의 **새 설명 2개**는 실제 wire hash와
Host 정규화 후 전체 byte가 기존 응답과 같았고 callback 미완료/overflow는 없었다.

| 원문 | 기본 진단의 buffer 수 | 큰 묶음의 buffer 수 | 큰 묶음의 전체 완료 |
| --- | --- | --- | --- |
| TypeScript 영어 쓰기 | 2,075 | 247 | 1.383초 |
| Kotlin 한국어 복합 분기 | 3,184 | 404 | 7.632초 |

제출 횟수는 줄었지만 Kotlin의 GPU 경과 구간 합집합은 **6,654.70ms**였다. 별도 준비와
계측이 있는 두 실행을 matched causal speedup으로 주장하지 않는다. 큰 묶음에서도
전체 3초를 넘었으므로 비계측 반복 matrix나 다른 한도 값 탐색으로 확대하지 않았다.
작업 수만 감소한 것을 목표 달성으로 보거나 제품 기본값에 적용하지 않는다.
두 요청의 worker 누적 peak MLX allocation은 기본 **1,752.20 MiB**, 큰 묶음
**1,996.74 MiB**였다. OS RSS peak는 각각 **1,457.69/1,425.47 MiB**이며 allocator 지표와
다른 측정이다. Host나 VS Code 전체 메모리로 제시하지 않는다.

이번 작업의 실제 새 설명은 총 **16개**이며 서로 다른 원문은 **3개**다. 반복 실행을
새로운 독립 원문 16개나 전체 scope/rich 검증으로 세지 않는다. CPU helper 검사 12개와
Python/Node 구문 검사, native build 및 고정 배열 검증을 실행했다. 공개 package 테스트
61개는 앞선 통과 기록이며 이번 문서 변경에서 다시 실행하지 않았다. 모든 모델 worker는
종료됐고 runtime/UI/기본 모델/버전/설치된 **0.0.1145**를 유지한다. Native 비용의 원인을
좁혔지만 기존 모델의 의미 오류와 실제 outer Host/전체 scope/rich/전체 3초 기준은 미충족이다.

## 실제 실행기 메타데이터와 생성 구간 projection 결합

목표는 **모델 준비 뒤 원문을 읽는 새 요청부터 전체 설명 완료까지 3초**로 유지한다.
다운로드·로딩·FIFO 대기는 제외하지만 원문이나 응답을 줄이지 않는다. 이번 private
비교는 기존 provider의 FIFO/자원 소유권, 전체 wire decode/정규화와 Host parser까지
측정했다. 실제 outer Host 전달과 모든 scope/rich 기능을 검증한 것은 아니다.

### 지원 counter와 요청 QoS의 확인

Apple의 [counter 지원 조회 절차](https://developer.apple.com/documentation/metal/gpu-counters-and-counter-sample-buffers)에
따라 실제 장치의 기능을 조회했다. `metal-capabilities.json`에서 Apple M5 Pro의
architecture는 `applegpu_g17s`, counter set은 `timestamp/GPUTimestamp` 하나였다.
Sampling point는 stage만 지원하고 dispatch/draw/blit는 지원하지 않았다. 지원하지
않는 dispatch counter를 호출하거나 GPU 내부의 연산·메모리 대기를 측정했다고 하지 않는다.
이 조회는 모델 로딩·샘플링·소스 설명이 없으며 시스템 정책을 바꾸지 않았다.

기존 완료 timestamp 계측을 별도 private native library로 확장해 실제 제출 스레드의
요청 QoS와 pipeline 함수 이름, dispatch 수를 기록했다. 원래 commit/encoder 메서드는
같은 인자로 전달하며 GPU 명령·fence를 추가하지 않는다. Kernel 이름 registry는
1,024개, 각 command buffer의 이름별 slot은 16개로 제한하고 초과 수를 따로 남긴다.
Native/ctypes record 크기를 확인했고 고정 identity 배열 검증에서 결과가 정확히 같았다.
순수 집계 helper의 **6개 검사**는 누락 ID, overflow, 수량 불일치, 잘못된 QoS와 빈
buffer를 검증한다.

`compound-metal-profile-executor-KNVCxo/report.json`의 실제 새 설명 2개는 앞서 읽은
응답과 생성 wire hash 및 Host 정규화 후 전체 byte가 같았다. 모든 제출에서 QoS 조회가
성공했고 요청 값은 **33(userInteractive)**였다. 이는 이 실행의 요청 QoS가 낮다는
가설을 지지하지 않는다. [pthread QoS 정의](https://github.com/apple-oss-distributions/libpthread/blob/main/include/pthread/qos.h)의
요청 값과 실제 override/유효 GPU 우선순위는 구별하며 우선순위 변경은 하지 않았다.

| 원문 | 전체 완료 | Command buffers | 전체 dispatch | 이름을 연결한 dispatch | slot 초과 dispatch |
| --- | --- | --- | --- | --- | --- |
| TypeScript 영어 쓰기 | 0.966초 | 1,898 | 78,452 | 77,476 | 976 |
| Kotlin 한국어 복합 분기 | 1.897초 | 3,172 | 127,750 | 126,150 | 1,600 |

연결률은 각각 **98.756%/98.748%**, registry 초과와 미등록 ID는 0이다. Slot 초과분을
숨겨 100% coverage로 제시하지 않는다. 관찰된 QMV fast 호출은 **24,034/39,400회**,
RMS normalization은 **14,116/23,040회**였다. 가장 긴 command buffer의 GPU 경과는
**6.003/6.029ms**였다. 이 수치를 kernel 호출 수에 비례해 배분하거나 kernel별 시간으로
해석하지 않는다. 완료 callback/encoder 관찰이 scheduling에 영향을 주므로 두 요청의
3초 통과를 비계측 성능 개선이나 전체 목표 달성으로 사용하지 않는다.

### 여러 입력 행을 결합한 첫 후보의 수치 실패

실제 QMV 호출 수를 근거로 같은 입력을 쓰는 Q/K/V와 gate/up의 quantized 행을 묶는
별도 private 구현을 작성했다. 원래 affine 4bit/group128 weight/scales/biases의 저장
byte를 그대로 연결하고 각 행의 일치를 검사한다. Dequantization/requantization,
모델 파일·정밀도·원문·prompt·grammar·sampling·출력 한도 변경은 하지 않았다.

첫 전체 모델 검사에서 Q/K/V를 모든 입력에 결합하면 **64행 prefill부터 실패**했다.
Argmax는 같았지만 최대 logit 차이는 **1.03125**, active KV 차이는 **5.125**였다.
`projection-fusion-feasibility-failed.json`에 실제 반례를 보존하고 새 설명 비교로
진행하지 않았다. Argmax 일치나 허용 오차 완화로 실패를 통과시키지 않는다.

`projection-operator-parity.json`의 source-free 연산 검사 네 조건으로 차이를 좁혔다.
64행 Q/K/V의 최대 차이는 각각 **0.03125/0.03125/0.015625**였지만 단일 행에서는 세
출력이 모두 byte 단위로 같았다. Gate/up은 64행과 단일 행 모두 byte가 같았다.

[MLX 0.32.3 pinned split-K 구현](https://github.com/ml-explore/mlx/blob/64ea011cb65f14d9ce2737e60db9a4ae91ed7441/mlx/backend/metal/quantized.cpp#L1152)은
출력 폭과 입력 행 수로 K 분할 수를 정하고 입력 dtype으로 부분합을 저장한다.
64행/입력 폭 2,048에서 원래 Q의 분할은 4, K/V는 8인 반면 결합 출력 폭 4,096이면
2가 된다. 이는 원문 수식과 모델 차원으로 계산한 설명이며 실제 grid를 계측한 값은
아니다. 같은 split-K kernel 이름이어도 reduction 분할과 bf16 반올림은 달라질 수 있다.
저장 가중치 byte 일치만으로 계산 결과 일치를 보장할 수 없다는 반례다.

### 단일 행 생성만 결합한 후보의 비교와 기각

여러 행의 원문 prefill/batch는 원래 모듈을 그대로 호출하고 **전체 입력 행이 하나일
때만** 결합한 QMV를 사용하도록 범위를 제한했다. 원래 SDK cache, normalization,
RoPE, attention, SwiGLU/down projection을 유지한다. Q/K/V만 결합한 경우와 gate/up도
결합한 경우를 각각 prefix 1/64/257/1,023 및 이후 고정 토큰 세 개로 검사했다.
`projection-decode-fusion-feasibility.json`의 **32개 비교 모두 전체 logit과 active KV
byte가 정확히 같고 최대 차이는 0**이었다. 소스나 설명을 생성한 검사는 아니다.

결합 weight는 Q/K/V만 **124,780,544byte(119MiB)**, gate/up 포함
**499,122,176byte(476MiB)**다. 이 구현은 원래 prefill 모듈도 보유하므로 해당 복사본이
추가 상주한다. 생성 시 quantized matmul 호출은 layer당 2개/3개 줄지만 전체 GPU
dispatch나 전체 시간이 같은 비율로 줄어든다고 주장하지 않는다.

수치 검사를 통과한 gate/up 포함 후보 하나만 전체 원문으로 비교했다.
`compound-projection-decode-comparison-FMx3GV/report.json`은 완전한 원문 세 개를
control → candidate → candidate → control 순서로 읽은 **새 설명 12개**다. 준비는
각 worker에서 기존 64+1 EOS forward만 수행하며 소스 상태·답변·KV를 미리 보유하지
않는다. 모델/구현 hash와 원래 wire를 확인했고 단일 요청·cached tokens 0·seed42·
temperature0.2/top-p0.95/top-k40·prefill512·8GiB 메모리/256MiB allocator cache 한도를
유지했다. Canonical grammar나 command-buffer 한도 후보를 함께 적용하지 않았다.

모든 요청의 실제 wire hash와 정규화 후 전체 응답은 해당 사례의 이전 응답 및 다른
arm과 정확히 같고 prompt token 수도 같았다. 세 전체 응답을 원문과 함께 다시 읽어
계산/쓰기, try/catch의 모든 반환, Kotlin 조건의 양쪽 결과, finally 호출과 미확인
동작·정상 복귀 조건, summary/flow 및 다섯 상세 필드를 확인했다.

| 원문 | 원래 전체 완료 두 번 | 결합 후보 전체 완료 두 번 |
| --- | --- | --- |
| TypeScript 영어 쓰기 | 1.003 / 3.721초 | 0.945 / 0.970초 |
| TypeScript 한국어 catch/finally | 3.964 / 2.822초 | 1.846 / 2.224초 |
| Kotlin 한국어 복합 분기 | 5.121 / 2.299초 | 6.975 / 2.880초 |

원래 arm은 **3/6**이 3초 이내(평균 **3.155초**, 최대 **5.121초**), 후보는 **5/6**
(평균 **2.640초**, 최대 **6.975초**)였다. 두 반복과 세 원문에서의 관찰이며 통계적
일반 개선이나 안정적인 3초를 입증하지 않는다. 후보의 가장 느린 결과를 재실행으로
제외하지 않았고 더 큰 matrix나 다른 결합 설정의 탐색으로 확대하지 않았다.

Worker 누적 peak MLX allocation은 원래 최대 **1,752.20MiB**, 후보
**2,228.20MiB**로 증가했다. OS RSS peak는 각각 **1,421.31/1,421.58MiB**이며 MLX
allocation과 다른 지표다. 둘 다 준비를 포함한 worker 누적 peak이고 요청별 delta나
Host/VS Code 전체 peak가 아니다. 수치·설명 일치에도 3초 기준과 자원 목표를 만족하지
못해 후보를 채택하지 않는다.

이번 작업은 서로 다른 원문 **3개**, 실제 새 설명 **14개**(계측 2개 + 비교 12개)다.
별도로 source-free 실패 반례 한 개, primitive 네 조건, decode 비교 32개, CPU 집계
검사 6개, Python/Node 구문 검사와 native build/고정 배열 검증을 수행했다.
공개 package 테스트 61개는 이전 실제 통과 기록이며 이번 문서 변경에서 다시
실행하지 않았다. 모든 소유 worker가 종료됐다. 기존 1.7B 모델의 누락 본문 설명 오류와
반복 문장, 실제 outer Host/전체 scope/rich/일반적인 전체 3초 기준은 여전히 미충족이며
runtime/UI/기본 모델/설치 버전 **0.0.1145**를 유지한다.

## Sampler의 동일 연산 생략과 정렬 공유

앞선 실제 kernel inventory에 sort/partition/merge 반복이 있었으므로 설치된
[MLX-LM 0.32.0 sampler](https://github.com/ml-explore/mlx-lm/blob/v0.32.0/mlx_lm/sample_utils.py)를
확인했다. 원래 순서는 전체 vocabulary top-p → top-k → temperature categorical이다.
이 순서나 확률 분포를 바꾸지 않고 중복 작업을 줄일 수 있는지 두 가지로 나눠 확인했다.
이전에 효과가 작았던 동일 sampler의 compile 실험을 다시 실행한 것은 아니다.

### 허용 토큰이 적을 때의 identity top-k

유효한 finite/negative-infinity logits에서 문법이 허용한 토큰이 40개 이하라면 top-k=40은
유한한 항목을 제거하지 않는다. Private CPU helper는 이미 있는 32-bit mask를 세며 GPU
logits를 읽지 않는다. 빈 mask, 잘못된 shape/dtype/batch/threshold는 원래 연산으로
돌아간다. Signed mask는 unsigned view로 센다. 음수의 절댓값을 세는 signed popcount로
`-1`을 1bit로 잘못 세지 않으며 padding bit는 보수적으로 포함한다. 이 경계의 **8개 CPU
검사**가 통과했다.

`grammar-topk-opportunities.json`은 기존 다섯 실제 응답의 token 기록에 대응하는
**706개 원래 native grammar prefix mask**를 재생했다. 모델을 로드하거나 새 설명을
생성하지 않았다. 전체 151,936bit mask에서 각 기록당 12개, 합계 **60/706개(8.50%)**만
이 조건을 만족했다. 추가 lookahead/EOS sampler 호출 전체를 센 값은 아니다. Mask
집계의 thread CPU 합계는 사례별 **0.44~1.89ms**였다.

`grammar-topk-identity-parity.json`은 float32/bfloat16, 허용 개수 1/2/39/40/41/512,
세 분포의 **36조건 × 16seed = 576쌍**이다. 원래 전체 top-p와 categorical을 유지하고
identity 조건에서만 top-k를 생략했다. 전체 필터 log-probability byte, temperature 뒤
전체 probability byte, 선택 token과 갱신된 RNG 상태가 모두 같았다. 이는 모델 없는
합성 배열 비교이며 새 소스 설명 576개가 아니다.

Identity 조건 24개의 sampler 중앙값 절감은 **0.115~0.579ms**였다. 가장 큰 합성
절감에 기록된 12단계를 곱해도 약 **6.95ms**이며 실제 요청의 절감이나 상한을 측정한
값은 아니다. 적용 가능한 비중이 작아 이 후보의 새 모델 비교로 확대하지 않았다.

### 모든 토큰에서 정렬을 한 번 공유하는 후보

같은 버전의 [pinned Metal 정렬 구현](https://github.com/ml-explore/mlx/blob/64ea011cb65f14d9ce2737e60db9a4ae91ed7441/mlx/backend/metal/sort.cpp#L322)에서
`ArgSort`와 `ArgPartition`은 모두 같은 `gpu_merge_sort(..., true)`를 호출한다.
[argsort 문서](https://ml-explore.github.io/mlx/build/html/python/_autosummary/mlx.core.argsort.html)는
동점의 원래 순서를 보존한다고 명시한다. 반면 [argpartition의 일반 API 계약](https://ml-explore.github.io/mlx/build/html/python/_autosummary/mlx.core.argpartition.html)은
partition 내부 순서를 보장하지 않으므로 이 최적화를 다른 backend/버전에 일반화하지 않는다.

Private 후보는 원래 log-probabilities의 안정된 내림차순 index를 한 번 구한다.
그 index에서 전체 오름차순 값을 복원해 원래 float32 exp, reverse exclusive cumsum,
전체 mass와 top-p threshold를 그대로 계산한다. 이어 같은 index의 top40과 원래 top-p
조건의 교집합을 남긴다. 먼저 top40만으로 확률을 정규화하거나 top-p를 top-k 뒤로
옮기지 않는다. Temperature0.2와 원래 categorical/RNG 연산도 유지한다.

`shared-sampler-sort-parity.json`의 **32조건 × 32seed = 1,024쌍**은 float32/bfloat16에서
dense/희소 분포, 전체 동점, signed zero, top40 경계의 39/40/41개 plateau와 exp 극단값을
포함한다. 전체 필터 log-probability/probability byte와 support, 선택 token, 갱신 RNG가
모두 같았다. 각 조건의 sampler 중앙값은 **0.023~1.432ms** 감소했으나 합성 배열의
관찰이다. 입력 조건은 유효한 finite/negative-infinity logits이며 NaN/positive-infinity나
일반 backend의 동점 계약까지 증명한 것은 아니다.

### 원래 전체 소스의 새 설명 비교

수치 검사를 통과한 정렬 공유만 실제 원문에 적용했다.
`compound-shared-sampler-comparison-JJ9qvG/report.json`은 동일한 완전 본문 세 개를
control → shared → shared → control로 읽은 **새 설명 12개**다. 각 arm은 준비 단계에
같은 float32/bfloat16 고정 filter 배열 두 개를 평가한다. Categorical을 호출하거나
소스 token을 읽지 않으며 준비 전후 RNG가 같음을 확인했다. 기존 64+1 EOS model forward,
모델 graph/가중치, 원래 source/context/prompt/wire/native grammar/sampling/출력 한도,
8GiB 메모리/256MiB allocator cache 한도를 유지했다. Projection 결합이나 canonical
grammar를 함께 적용하지 않았다.

준비 뒤 provider 요청부터 전체 wire decode/정규화와 Host parser까지 측정했다.
각 요청은 실제 model call 한 번, cached tokens 0이다. 실제 wire hash와 정규화 후
전체 설명은 같은 사례의 이전 응답 및 다른 arm과 모두 정확히 같고 prompt token 수도
같았다. 세 원문과 summary/flow 및 다섯 상세 필드를 다시 읽어 쓰기/반환, try/catch와
Kotlin 양쪽 조건, finally와 미확인 내부 동작·정상 복귀 조건을 확인했다.

| 원문 | 원래 전체 완료 두 번 | 정렬 공유 전체 완료 두 번 |
| --- | --- | --- |
| TypeScript 영어 쓰기 | 1.264 / 0.962초 | 3.375 / 0.912초 |
| TypeScript 한국어 catch/finally | 2.270 / 2.422초 | 3.150 / 1.634초 |
| Kotlin 한국어 복합 분기 | 2.791 / 7.866초 | 2.338 / 3.239초 |

원래 arm은 **5/6**이 3초 이내(평균 **2.929초**, 최대 **7.866초**), 정렬 공유는
**3/6**(평균 **2.441초**, 최대 **3.375초**)였다. 평균이나 최대 하나만 골라 일반적인
개선 또는 안정적인 3초를 주장하지 않는다. 실패 결과를 재실행으로 제외하지 않았고
32원문/전체 scope/rich로 확대하지 않았다.

Worker 누적 peak MLX allocation은 두 arm 모두 최대 **1,752.20MiB**였다. OS RSS
peak는 각각 **1,419.61/1,419.92MiB**이며 준비를 포함한 worker의 누적 값이다.
모델 준비/Host/VS Code 전체 메모리 또는 요청별 allocation delta와 구별한다.

이번 단계는 실제 새 설명 **12개/서로 다른 원문 3개**와 별도의 기록 mask 706개,
모델 없는 수치 비교 576+1,024쌍 및 CPU 검사 8개다. Python/Node 구문 검사와
문서 diff 검사를 수행했고 공개 package 61개는 앞선 실제 통과 기록으로 유지했다.
모든 소유 프로세스는 종료됐다. 정렬 공유의 수치·응답 보존과 연산 절감은 확인했지만
전체 3초 기준과 기존 모델 의미 오류, 실제 outer Host/전체 scope/rich는 여전히
미충족이다. 제품 runtime/UI/기본값/설치 버전 **0.0.1145**를 바꾸지 않는다.

## Packed 가중치의 중복 상주 제거와 최적화 조합 검증

앞선 decode-only projection 결합은 단일 token의 연산과 원래 multi-row prefill을
구분해 수치를 보존했지만 원래 projector의 가중치도 남겨 **476MiB**를 추가로
상주시켰다. 새 private 구현은 q/k/v/gate/up의 원래 shape를 유지하면서 각 prefill
projector가 packed 가중치의 해당 row view를 참조하게 한다. Decode에서만 앞서
검증한 결합을 사용한다. 모델 파일, 저장 가중치 byte, dtype, 원래 multi-row prefill
연산 shape를 바꾸지 않는다.

### 원래 가중치와 수치·상주 메모리 비교

`shared-projection-weights-parity.json`의 **37개 실제 모델 비교**는 다음을 포함한다.

- Batch1의 prefix1/64/257/512/1023, batch2의 prefix1/64/257 각각에서 prefill과
  뒤따르는 세 개의 one-token decode를 비교한 32개.
- Batch1에서 512+511 chunked prefill과 세 decode를 비교한 5개.

각 control은 원래 Python array 객체를 실제로 복원한다. Candidate와 control이
같은 새 view를 참조하는 비교가 아니며 복원된 객체 identity도 검사했다. 전체
logit byte와 28개 layer의 활성 K/V byte, dtype/shape/offset이 모두 같고 차이는
0이었다. 단순 argmax 일치나 허용 오차 비교로 대체하지 않았다. 원래 projector의
140개 binding과 weight/scales/biases 총 420개 view도 원래 shape/dtype를 유지한다.

수치 비교 뒤 원래 control 참조를 해제하고 GC/allocator cache 정리를 수행했다.
원래 source-free 64+1 EOS forward 후 KV를 버리고 다시 측정한 결과는 다음과 같다.

| MLX 활성 메모리 관찰 | Bytes |
| --- | ---: |
| Packing 전 원래 모델 | 914,245,640 |
| Packed 가중치와 원래 control을 함께 보유 | 1,413,367,816 |
| 원래 control 해제 후 | 914,245,640 |
| Source-free readiness 및 KV 해제 후 | 914,245,640 |
| 해제한 원래 저장 가중치 | 499,122,176 |

추가 활성 가중치 메모리는 실제로 **0 byte**였다. 이는 이 구현/모델에서 측정한
상주 중복 제거 결과이며 OS 전체 RAM이나 일반적인 peak의 보증이 아니다. 수치
probe의 peak MLX 약 **3,350.69MiB**는 원래 control과 두 비교용 KV를 포함하므로
실제 설명 요청의 peak로 제시하지 않는다. 이 probe는 소스를 읽거나 token을
sampling하지 않았고 새 설명 37개를 생성한 것이 아니다.

### 세 가지 검증된 연산 절감의 고정 조합

새 후보는 가중치 공유, 앞서 2,787개 mask를 비교한 native-only Korean schema
canonicalization, 전체 확률/token/RNG가 같은 1,024쌍의 one-sort sampler를 함께
사용한다. 원래 prompt/wire schema/source/context, temperature0.2/top-p0.95/top-k40,
출력 한도와 EOS 완료 조건, 8GiB 메모리/256MiB allocator cache 한도를 유지했다.
Original schema hash와 native-only compiler schema hash는 별도로 남긴다.

양쪽 arm은 준비 단계에서 source-free float32/bfloat16 고정 filter 배열 두 개를
평가하고 RNG가 변하지 않았음을 확인한다. 실제 source나 출력 token을 준비에
사용하지 않고 기존 64+1 EOS model forward와 KV 해제를 유지한다. Ready 시 추가
활성 가중치 0 byte와 control 참조 해제를 실제 요청 metrics에도 남긴다.

`compound-integrated-latency-comparison-Q1kQQM/report.json`은 같은 완전 원문 세 개를
control → integrated → integrated → control로 읽은 **새 설명 12개**다. 준비 이후
provider 요청부터 전체 wire decode/정규화 및 실제 Host parser 완료까지 측정했다.
각 요청은 model call 한 번, cached tokens 0이며 모든 arm의 전체 raw wire hash와
정규화 후 설명이 같았다. 이전에 검토한 같은 원문의 응답과도 정확히 같았다.

| 원문 | 원래 전체 완료 두 번 | 조합 후보 전체 완료 두 번 |
| --- | --- | --- |
| TypeScript 영어 쓰기 | 0.995 / 0.986초 | 1.084 / 1.436초 |
| TypeScript 한국어 catch/finally | 3.699 / 1.725초 | 2.043 / 1.709초 |
| Kotlin 한국어 복합 분기 | 7.370 / 2.952초 | 2.554 / 2.154초 |

후보는 **6/6**이 3초 이내(평균 **1.830초**, 최대 **2.554초**), control은 **4/6**
(평균 **2.954초**, 최대 **7.370초**)였다. Worker 누적 peak MLX는 후보/control
각각 **1,711.20/1,752.20MiB**, OS RSS peak는 **1,275.875/1,470.00MiB**였다.
준비를 포함한 worker 누적 값이며 Host/VS Code 전체나 요청별 allocation delta가
아니다. 세 원문의 두 번 반복 결과만으로 일반적인 성능 개선을 확정하지 않는다.

### 전체 32개 원문으로 확대했을 때의 실패 보존

예비 후보가 6/6을 통과해 `compound-integrated-all32-LZWlR2/report.json`에서
원래 holdout **32개 언어·locale 사례 전체**를 한 번씩 새로 읽었다. 완전 본문 24개와 의도적으로
본문이 없거나 부분적인 8개를 모두 포함했다. 원래 source/context와 현재 wire의
일치를 먼저 검사하고 원문·응답을 줄이거나 response/KV cache를 사용하지 않았다.
Provider 요청부터 Host parser 완료까지 같은 기준으로 측정했다.

| 전체 32개 관찰 | 결과 |
| --- | ---: |
| 실제 새 model call / cached tokens | 32 / 0 |
| 3초 이내 | 27/32 |
| 최소 / 평균 / 최대 | 1.105 / 2.412 / 5.736초 |
| 원래 필요 조건 / runtime 설정 검사 | 32/32 / 32/32 |
| 이전 전체 응답과 byte 일치 | 32/32 |
| Worker 누적 peak MLX / RSS | 1,814.20 / 1,272.77MiB |

3초 초과는 TS 영어 guard **3.869초**, TS 한국어 누락 본문 **5.552초**, TS 영어
누락 본문 **3.091초**, Kotlin 한국어 복합 분기 **5.736초**, Kotlin 영어 부분 본문
**5.240초**였다. 실패를 제외하거나 재실행해 덮어쓰지 않았다. 이전 32개와는 별도
실행이므로 두 실행의 평균 차이를 matched speedup으로 계산하지 않는다.

전체 source/context와 최종 응답이 byte 단위로 같아 앞선 실제 32개 수동 검토의
결과도 그대로 적용된다. TS/Kotlin 한국어 누락 본문의 **2개 내부 동작 단정**과
한국어 TS/Kotlin 쓰기 및 Kotlin loop의 **3개 반복 flow**가 모두 남았다. 새 offline
검토는 다섯 최종 상세 필드와 authored summary/flow를 Host가 변경하지 않았음도
검사했다. 필요 조건 32/32 통과를 의미 정확성의 증명으로 제시하지 않는다.

측정 중 한 번 관찰한 시스템 메모리 압박만으로 느린 요청의 원인을 paging이라고
단정하지 않는다. 설치된 SDK의 `stream_generate`는 이미 생성 동안 recommended
wired limit을 적용하고 복원한다. 시스템 정책이나 다른 앱을 변경하지 않았다.

이번 단계는 원문·locale 사례 **32개**, 새 설명 **44개**(예비 비교 12개 + 전체 검증 32개),
별도의 source-free 실제 모델 수치 비교 37개와 Python/Node 구문 검사다. 모든
소유 handle과 worker는 종료됐고 원래 실패 artifact도 보존했다. 가중치 중복은
해결됐지만 안정적인 전체 3초와 모델 의미 정확성은 충족하지 못해 채택하지 않는다.
실제 outer Host/전체 scope/rich도 미검증이다. 공개 package 61개는 앞선 통과 기록이며
이번 문서 변경에서 다시 실행하지 않았다. 제품 runtime/UI/기본값/설치 버전
**0.0.1145**를 유지한다.

## Flow의 소스 소유 관계와 JSON 구조 공백 검증

이전 모델의 본문 소유 관계 혼동과 반복 flow를 해결하기 위해 private 출력 계약을
구현했다. 모델이 작성하는 flow를 긴 문자열에서 `sourceId`/`text`를 가진 3~5개
객체로 바꾸며, sourceId는 실제 제공된 함수 본문 ID 또는 미확인 근거의 null이다.
Summary와 모든 호출 상세 필드, limitations, 원래 source/context 및 전체 flow
600자 한도를 유지한다. 변환은 모든 text를 원래 순서대로 공백 하나로 연결하며
내용을 삭제·수정·정적으로 채우지 않는다. 중복·불완전·상한 초과 출력은 원문 그대로
보존하고 거부한다. 이 새로운 transport와 prompt는 이전 wire와 같다고 주장하지 않는다.

원문/나머지 schema slot 보존, 모든 작성 문자 보존, 누락/부분 본문, 중복, 전체
길이, 잘못된 ID/필드, 한국어 제한의 **8개 경계 검사**가 통과했다. 이는 transport
검증이며 sourceId가 맞는 자연어 의미까지 증명하지 않는다.

### 구조 공백으로 출력 한도를 소진한 첫 실제 요청

`compound-source-owned-flow-jJzVGZ`의 첫 TS 한국어 누락 본문 요청은 준비 이후
**33.537초**에 `Incomplete generation: length`로 실패했다. 첫 문장 객체 뒤에서
2,342개의 구조 공백을 생성했고 전체 JSON 문자열 바깥의 공백은 2,343개였다.
2,400토큰 한도에 도달한 부분 출력과 실패 이유를 보존했다. 계획한 초기 7사례 중
실제로 요청한 것은 이 **1개뿐**이며 나머지 여섯 개는 실행하지 않았다. 성공 metrics가
없어도 부분 생성의 2,400토큰은 실제 모델 요청 한 번의 증거다. 0회 생성으로 세지 않는다.

설치된 LLGuidance1.9.1의 [JSON compiler](https://github.com/guidance-ai/llguidance/blob/f0971424ec072d3e4d4196bcc7f31a2f60527df9/parser/src/json/compiler.rs#L163)는
기본적으로 구조 공백에 길이 상한 없는 패턴을 사용한다. 새 native-only wrapper는
`whitespace_flexible:false`, `whitespace_pattern:null`, comma/colon separator를
명시해 compact JSON을 생성하게 한다. 문자열 **안의** 공백·Unicode·escape나
schema의 JSON 값은 바꾸지 않는다. 이미 생성된 출력을 후처리해 공백을 제거한
것이 아니며 formatting token의 허용 집합은 달라지므로 mask/확률 동일성도 주장하지 않는다.

**7개 native parser 검사**는 원래 32개 wire와 새 32개 transport schema의 compact
값을 모두 허용하고, 원래 schema를 변경하지 않았음을 확인했다. 문자열 내부의
공백·한글·emoji·escaped control도 보존한다. 첫 객체 뒤의 space/tab/newline/carriage
반복과 저장된 실제 실패 prefix는 원래 문법에서 허용되지만 compact 문법에서 거부된다.
모델 가중치를 로드하지 않은 CPU 검사다. 새 원문 설명 64개를 생성한 것이 아니다.

### 공백 반복을 막아도 작성 문장의 반복은 남음

`compound-source-owned-flow-compact-jYxWN6/report.json`은 기존의 다섯 오류 사례와
TS 영어 guard, Kotlin 영어 복합 분기·예외 처리를 읽은 **새 요청 7개**다. 모든 요청이
EOS까지 JSON을 생성했고 구조 공백은 0개였지만, 일곱 개 모두 flow 객체의 text를
그대로 반복해 거부됐다. 이를 dedup하거나 정적 설명으로 채우지 않았다. Host가
받은 완성 설명은 **0개**다. 전체 실제 생성 필드와 원문을 읽어 다음도 확인했다.

- 누락 본문 두 사례는 부모의 입력 전달·결과 사용만 반복하며 flow에서 대상의
  미확인 동작을 설명하지 않았다. effects의 모호한 소유 관계를 명백한 내부 동작
  단정으로 과장해 세지는 않는다.
- 쓰기와 loop 사례는 지역 계산을 반복하며 명확한 대상 반환·초기화 설명이 부족했다.
  Callee 소유 태그 아래 부모의 결과 사용도 섞였다.
- Kotlin 영어 복합 분기의 첫 객체에는 조건·catch·finally·정확한 인수와 미확인 동작이
  있었으나 뒤의 두 객체가 반복됐고, 전체 연결 문장은 **662자**로 원래 600자도 넘었다.

첫 요청의 준비 후 실패는 **5.921초**다. 이후 여섯 실패 시간은 **준비 후 설명 시간으로
비교할 수 없다**. 실제 scheduler가 검증 실패 후 모델을 해제하므로 다음 요청의 타이머에
새 process import와 source-free 재준비가 포함됐다. 일곱 개 readiness 기록으로 이를
확인했고 기존 실패 시간을 보존했다. Ready의 preparedMs를 사후 차감하지 않는다.
해당 driver의 정확한 snapshot을 보관하고 향후 driver는 매 요청 타이머 **앞에서**
prepare를 기다리게 수정했다. 이미 실패한 일곱 사례를 다시 실행해 덮어쓰지 않았다.
공개 benchmark는 이미 이 준비 경계를 지키고 있어 변경하지 않았다.

이 일곱 소유 worker의 누적 peak 중 최대 MLX는 **1,909.90MiB**, RSS는
**1,273.59MiB**였고, 매 readiness의 추가 활성 가중치는 0이었다. 하나의 worker가
계속 상주한 일곱 요청이나 Host/VS Code 전체 peak로 표현하지 않는다.

### 원래 wire에서 compact formatting만 분리한 비교

새 배열 형식의 영향과 공백 제어를 구분하기 위해 기존 원문·prompt·wire·전체
필드·sampling·출력 상한을 그대로 사용했다. `compound-original-wire-compact-ZhYnww`
비교는 네 사례를 original → compact → compact → original로 읽은 **새 요청 16개**다.
Original arm도 앞선 가중치 공유/canonical/one-sort 조합을 사용하며 이번 차이는
native 구조 공백 설정뿐이다. 매 요청 prepare는 타이머 밖에서 완료하고 전체
provider/wire/Host parser 완료까지 측정했다. Model call 한 번, cached tokens 0이다.

| 원문·locale 사례 | 원래 JSON 두 번 | Compact JSON 두 번 |
| --- | --- | --- |
| TS 한국어 누락 본문 | 3.945 / 2.506초 | 2.586 / 1.621초 |
| Kotlin 한국어 복합 분기 | 3.346 / 2.488초 | 8.245 / 4.259초 |
| TS 영어 guard | 2.266 / 1.375초 | 4.749 / 1.840초 |
| Kotlin 영어 부분 본문 | 2.518 / 3.578초 | 4.427 / 2.389초 |

원래 설정은 **5/8**이 3초 이내(평균 **2.753초**, 최대 **3.945초**), compact는
**4/8**(평균 **3.764초**, 최대 **8.245초**)였다. 사례별 모든 raw wire hash와
정규화 후 전체 설명은 서로 및 이전 수동 검토한 응답과 같았다. 따라서 이전 TS
한국어 누락 본문의 소유 관계 오류도 그대로 남았다. Host 형식 통과 16개를 의미가
정확한 완성 설명 16개로 세지 않는다. 이 결과로 안정적인 3초나 성능 개선을 주장하지
않으며 32사례로 재확대하지 않았다.

Worker 누적 최대 MLX는 original/compact **1,729.20/1,814.20MiB**, RSS는
**1,276.17/1,274.56MiB**다. 요청마다 추가 활성 가중치는 0이지만 allocator/OS
peak 차이까지 원인으로 해석하지 않는다. 준비를 포함한 worker 값이며 전체 VS Code
메모리나 요청별 allocation delta가 아니다.

추가로 현재 corpus 4,136행을 read-only로 확인했다. Training 3,256행 중 flow가
문자열인 것은 **3,036행**, 없는 것은 220행이며 validation 880행은 문자열 860행,
없는 것 20행이다. 새 source-owned 배열 target/schema는 양쪽 모두 **0행**이다.
정확한 source-key 기준 training 1,028개와 validation 178개는 겹치지 않았고,
기존 평가의 16개 source-key도 두 split에 없었다. 평가 응답은 이 audit에서 읽지
않았고 corpus/가중치를 바꾸거나 학습하지 않았다. 형식 coverage 관찰이며 실패의
원인이나 새 라벨·학습의 성능 개선을 입증하지 않는다.

이번 단계는 **실제 모델 요청 24개**(부분 생성 1개 + 거부된 structured JSON 7개 +
원래 형식의 Host 통과 JSON 16개), 언어·locale 사례 **9개**, 언어·원문 쌍 **8개**다.
순수 경계 검사 8개와 native parser 검사 7개, Python/Node 구문 검사, 보존된 실제
출력·source의 검토를 수행했다. 첫 native 검사 6개는 원래 wire 32개 검사를 더하기
전 통과 기록이며 별개의 모델 실험으로 세지 않는다. 모든 소유 handle과 worker는
종료됐다. 공개 package 61개는 이전 실제 통과 기록이고 이번 문서 변경에서 재실행하지
않았다. 새 모델 학습이나 runtime/UI/기본값/버전/설치는 진행하지 않았다.
**0.0.1145**를 유지하며 전체 3초·정확성·실제 outer Host/전체 scope/rich 목표는 미완료다.

## 원문에서 만드는 flow 소유자 학습 라벨

새 형식을 실제 학습 데이터로 검증하기 위해 기존 corpus를 보존한 별도 라벨 생성기를
구현했다. 기존 flow를 문장으로 나누거나 평가 응답을 복사하지 않는다. TypeScript AST와
Kotlin의 공개 native syntax API에서 호출자·대상 선언, 반환식, 조건, 지역 쓰기,
try/catch/finally 소유 범위와 호출 인수를 독립적으로 읽는다. 이 도구는 **오프라인
합성 학습 예제 전용**이며 extension inference에서 import하지 않는다.

공개 helper 경계는 다음과 같다.

- `scripts/model-reading-source-ownership-evidence.mjs`의
  `readModelReadingDeclaration(snippet, language)`는 원래 source snapshot과 span을
  보존한 작은 statement IR을 반환한다. AST 탐색은 visited set과 명시적 queue를 사용하며
  depth 16/container 128 상한을 둔다. 임의 코드 분석기를 대신하지 않는다.
- `scripts/model-reading-source-ownership-supervision.mjs`의
  `createSourceOwnedFlowSupervision(context, locale)`는 그 원문만으로 3~5개의
  `{sourceId,text}`와 별도 claim ledger를 만든다. 호출·인수 전달과 정상 반환값 사용은
  부모, 계산·조건·반환·지역 쓰기·finally 호출은 대상 본문에 연결한다. 없는 구현과 잘린
  나머지는 `null` 근거와 명시적인 미확인 설명으로 남긴다.
- 지원 범위를 벗어난 문장, 추가 작업, nested scope, 복수 대상, deferred 호출, 다른
  인수·본문 ID, 미제공 구현으로 잘못 표현될 수 있는 자기/부모 재호출은 거부한다.
  이 제한을 실제 제품의 지원 언어·scenario·rich 기능 축소에 사용하지 않는다.

부분 본문은 원문에 없는 tail을 만들어 설명하지 않는다. 기존 corpus의 **단일 조건부
반환으로 끝나는 미완성 선언**에 한해서 검증용 닫는 중괄호 하나를 별도 native parse에
추가한다. 원래 snippet/prompt에는 이를 넣지 않으며, positive claim의 span은 모두 원래
제공된 source 안에 있어야 한다. 검증용 suffix와 `nativeParseComplete:false`를 기록해
원래 선언을 완전한 구문으로 주장하지 않는다. 나머지 결과·쓰기·호출·효과·완료는 미확인이다.

기존 3,256/880개 training/validation 행과 source를 유지한 별도 corpus의 SHA-256은
`9653cdac2650a1c822835454646f16887b5a70442cde12a7d31d4f274fc1a8ed`다.
전체 설명 **3,896행**(training 3,036/validation 860)의 flow만 소스 소유자 문장으로
교체했다. Summary, calls의 원래 모든 모델 필드, limitations와 비-flow schema는 그대로다.
Flow가 없는 호출 상세 **240행**(220/20)은 context·schema·prompt·completion을 모두
원래 byte 표현으로 보존했다. 모든 full source, source/confidence/deferred 정보와 scope도
유지했다. 전체 flow는 최대 **500 Unicode scalar**로 원래 600 상한 안에 들어갔다.

Training의 산술/guard/쓰기/loop/catch/finally/복합/누락/부분 예제는 각각 독립 native
source로 읽었다. 정확한 source-key는 training 1,028개, validation 178개, 기존 평가
16개이며 세 집합은 서로 겹치지 않는다. 평가 **응답**은 라벨 생성·audit에 읽지 않았다.
Generator를 다시 호출하지 않는 별도 audit가 4,136행의 source와 비-flow 필드 보존,
source를 가진 claim **21,052개**, 미확인 claim **2,864개**, 부분 본문 600행의 경계를
확인했다. 모든 행이 실제 현재 wire 복원과 Host parser를 통과했다. 이는 라벨의 범위와
전송 형식 검사이며 일반 의미 정답 판정기는 아니다.

실제 고정 tokenizer와 LLGuidance 1.9.1 compact/canonical native grammar에서도
**4,136/4,136행**의 완전한 response와 EOS를 검사했다. 최대 sequence는 **2,509 tokens**,
prompt **2,212**, response **326**이며 원래 3,072 학습/8,192 문맥/2,400 출력 token
상한 안에 있다. 원문·응답을 자르지 않았고 response-through-EOS loss 경계를 보존했다.
이 검사는 CPU/tokenizer만 사용했고 가중치를 로드하거나 학습하지 않았다.

새 회귀 검사는 8개 source shape, 두 언어·locale, exact/inferred, 독립 compound recipe,
잘린 단일 statement 반환, 숨은 추가 작업·getter·scope·재호출의 거부를 포함한다. 기존
missing-body 회귀 테스트는 그대로 유지하고 새 테스트를 별도 파일로 분리했다.
새 검사 10개와 기존 검사 전체를 포함한 `npm run test:package` **71/71개**가 실제
통과했다. 별도 corpus/Host 검사와 CPU tokenizer/native grammar 검사도 종료됐다.
라벨 통과만으로 실제 모델의 소유 관계 오류·반복 문장·전체 3초가 개선됐다고 주장하지
않는다. 그 판단에는 별도로 준비 경계 밖의 모델 로딩을 제외한 새 inference와 전체
필드/범위 검증이 필요하다. 제품 runtime/기본 모델/UI/버전/설치는 **0.0.1145** 그대로다.

## Source-owned corpus 한 번 학습 후 실제 7사례 검증

별도 `adapter-source-owned-flow-exclusive-eos`는 원래 1.7B 4bit base에서 시작해
**3,256개 서로 다른 training 행을 한 번씩** 처리한 뒤 정상 종료했다. Resume나
추가 epoch는 없었다. 실제 yielded-index trace와 종료 후 결과 파일을 확인했다.
기존 source·모든 응답 필드·response-through-EOS loss·rank 8/scale 20/learning rate
0.0001/seed 42/batch 1을 유지했으며, 원문과 정답을 자르지 않았다. 학습 시간은
**6,482,835ms**, 학습 중 peak MLX는 **10,528.66MiB**다. 이는 일회성 학습 수치이며
익스텐션 inference 메모리나 설명 시간으로 사용하지 않는다.

기존 모델을 덮어쓰지 않은 별도 4bit fused 파일의 SHA-256은
`626668459f8a3014f803e5db6684eef1ace1eb036b14237636f5e339600244a8`이며,
크기는 **914,316,110 bytes**다. 이 **새 가중치 자체**에서 수행한 37개 source-free
full-logit/모든 active KV byte 비교가 모두 같았다. 원래 배열을 복원한 뒤 control
가중치를 해제했고, 준비 후 추가 active weight는 **0 bytes**였다. 이전 모델의 수치
검사를 새 모델의 근거로 대체하지 않았다. 이 검사는 실제 함수 설명을 생성하지 않는다.

`trained-source-owned-flow-ld7niF/report.json`에는 고정된 **새 모델 요청 7개**의
원문·모든 실제 출력·실패·소유자 단계·계측을 보존했다. 매 요청 **앞에서** source-free
prepare를 기다린 뒤 provider.generate 시작부터 실제 현재 Host parser 종료까지
측정했다. 실패 후 worker를 해제한 다음 요청도 로딩이 타이머에 들어가지 않는다.
원래 full source/summary/flow/다섯 호출 상세 필드/wire 복원/상한/sampling을 유지했고,
각 요청의 model call은 1회, cached token은 0이다. 실제 outer VS Code Host는 아니다.

| 원문 사례 | 준비 후 전체 완료/실패 | Host 형식 통과 | 원문·전체 필드 수동 검토 |
| --- | --- | --- | --- |
| TypeScript 한국어 누락 본문 | 1.916초 | 예 | 통과 — 부모 작업과 미제공 대상 동작을 구분 |
| Kotlin 한국어 누락 본문 | 2.012초 | 예 | 통과 — 미제공 본문을 명시적 미확인으로 보존 |
| TypeScript 한국어 지역 쓰기 | 3.349초 | 예 | 실패 — 없는 내부 호출을 주장하고 계산·갱신·반환 설명 누락 |
| Kotlin 한국어 지역 쓰기 | 2.405초 | 예 | 실패 — 계산·갱신 표현을 반복하며 반환 설명이 불명확 |
| Kotlin 한국어 감소 loop | 10.554초 | 아니요 | 실패 — 같은 표현 반복과 미완성 문장 |
| TypeScript 영어 음수 guard | 1.212초 | 예 | 통과 — 정확한 조건·분기 반환·fallback 계산 보존 |
| Kotlin 영어 복합 분기/catch/finally | 2.243초 | 예 | 통과 — 반환 선택·finally 호출·미확인 구현·정상 완료 조건 보존 |

Host 형식과 기존 필요 조건은 **6/7**, 형식 통과 및 3초는 **5/7**이지만, 수동 의미
검토까지 함께 통과한 3초 설명은 **4/7**이다. Kotlin 영어 복합 사례의 role/output에는
exact 관계인데도 불필요한 candidate 한정이 남아 있으며, 이를 일반 confidence 검증
완료로 해석하지 않는다. 단어·식의 존재와 JSON 통과를 의미 정답으로 세지 않는다.
Loop의 **1,163개 실제 생성 token**과 native 필드 상한까지 반복된 원문을 모두 보존했다.
이를 dedup·정적 문장·출력 일부로 고치지 않았고 실패를 재실행해 지우지 않았다.

이 worker들의 누적 peak 중 최대 MLX는 **1,910.20MiB**, RSS는 **1,274.84MiB**다.
준비 및 실패 후 재시작을 포함한 worker 값이며, 요청별 allocation delta나 전체
VS Code/Host 메모리가 아니다. 모든 소유 worker와 실행 handle은 정상 종료했다.

실패 후에는 추가 학습 대신 입력 경계와 export를 별도로 점검했다.

- 가중치를 로드하지 않은 in-memory pipe mock에서 **변경하지 않은 실제 provider**를
  실행해 전체 설명 training/validation **3,896행**의 요청 messages/schema가 frozen
  corpus와 byte 표현으로 같음을 확인했다. 호출 상세 전용 240행은 이 typed provider
  검사에서 제외했다. 별도 7개 mock payload의 실제 고정 tokenizer 길이도 각각 보존된
  실제 worker의 prompt-token 계측과 같았다. 길이 일치만으로 실제 IPC payload 전체
  hash 일치를 주장하지 않는다. Mock fixture 응답은 새 모델 설명으로 세지 않는다.
- 사전에 고정한 첫 KO TS/Kotlin 쓰기/loop/guard training/validation **12행**, 정답과
  EOS **2,144 targets**를 teacher-force해 기존 fused와 학습 직후 어댑터를 비교했다.
  평균 NLL은 **0.150972 / 0.146585**, top-one 정답 token은 **2,067 / 2,076**이었다.
  학습·sampling·새 precision export·새 완성 설명은 각각 0회다. 이 작은 corpus 표본의
  점수 차이만으로 실제 생성 오류의 원인이나 export 영향 부재를 입증하지 않는다.
- 독립 native 선언 audit에서 training의 서로 다른 함수 이름은 **24개**, 매개변수는
  **25개**, 지역 변수는 **5개**였다. 기존 평가의 함수·매개변수·지역 변수 이름은 모두
  training에 없었다. 이는 정상적인 heldout 조건과 lexical coverage 관찰이며,
  이름이 다르다는 사실을 오류 원인으로 단정하거나 평가 정답을 학습에 넣지 않았다.

이 단계의 실제 새 완성 설명 요청은 **7개**다. Teacher-forcing/tokenizer/pipe mock/
native audit는 실제 생성 수에 더하지 않는다. 새 가중치를 채택하지 않았고 all32나
native conversion/실제 outer Host/전체 scope/rich 검증으로 확대하지 않았다.
공개 package **71개 통과**는 앞선 실제 코드 검사 기록이며 이 문서 변경에서 다시
실행하지 않았다. 제품 runtime/기본 모델/버전/설치는 **0.0.1145** 그대로이고,
목표는 **미완료**다.

### 지역 변수 이름만 바꾼 세 가지 진단

이름 민감도를 분리하기 위해 앞선 세 실패 원문의 지역 binding `n`만 training에 있던
`adjusted`로 바꿨다. 기존 평가 응답을 정답으로 학습하지 않았고, 함수·매개변수 이름은
그대로다. 독립 native parse에서 지역 이름과 source 좌표를 제외한 control IR이 같음을
확인했다. 계산식·연산자·조건·반환 순서는 보존하고, 변경된 원문에 맞춰 반환/효과 구문
좌표를 다시 계산했다. 나머지 context와 모델 작성 schema는 원래 사례와 같았다.
이 변형은 **진단 전용**이며 원래 source를 보존해야 하는 제품 동작으로 채택하지 않는다.

같은 가중치·worker·sampling·상한에서 고정된 변형 세 개를 한 번씩 읽었다.
`source-owned-local-counterfactual-ud8fKF/report.json`의 전체 완료는 TS 쓰기
**1.845초**, Kotlin 쓰기 **1.728초**, Kotlin loop **2.219초**다. 세 응답 모두 Host와
기존 필요 조건을 통과했지만 전체 원문·모든 모델 문장·다섯 복원 필드를 읽은 의미
검토는 **0/3**이었다. TS는 갱신 대상과 계산 입력을 혼동하고 role을 반복했으며,
Kotlin 쓰기는 없는 호출과 반환 누락, loop는 지역 변수를 미구현 호출로 오인하고
반복 종료 후 반환을 누락했다. 구문에서 복원된 필드로 모델 오류를 보완했다고 세지 않는다.

이 진단은 **새 요청 3개**이며 원래 목표 표본은 **0개**다. 앞선 원문 7개에서 정확성·
3초를 함께 만족한 **4/7** 판정을 바꾸지 않는다. 같은 이름·prompt의 반복 실행이나
대응 순서를 바꾼 성능 비교가 아니므로 시간 차이를 개선율로 제시하지 않는다.
이름 변경만으로 문제를 해결하지 못했으며 추가 학습·새 모델·precision 변경·설치도
하지 않았다. 모든 실행 handle과 소유 worker는 종료됐다.

### 원래 응답 형식을 유지한 native 제어 구조 입력

지역 변수 이름을 바꾸는 진단도 실패해, 원문에서 직접 얻은 제어 구조를 추가 입력으로
제공하는 별도 도구를 구현했다. `scripts/model-reading-source-control-evidence.mjs`의
`createModelReadingSourceControlEvidence(context)`는 기존 native 선언 reader를 사용해
호출자·대상별 지역 binding, 초기화·갱신·반환, 중첩 `if`/`while`/`try`/`catch`/`finally`,
명시적 호출 목록을 기계적인 객체로 반환한다. 별도 ledger의 모든 code/expression은
해당 소유자의 원래 snapshot 안에 있어야 한다. 자연어 설명이나 대체 응답은 만들지 않는다.

본문의 complete/truncated/missing 상태와 graph 관계의 exact/inferred/unresolved를
분리했다. 대상 안의 자기/부모 호출도 원래 부모 edge의 exact confidence를 빌리지 않는다.
미제공 구현·잘린 tail·실제 dispatch·효과·완료는 입증하지 않는다. 명시적 호출 목록이
완전하다는 표시는 제공된 전체 본문의 명시적 구문에만 해당한다. Queue/visited와
depth 16/node 128 상한을 유지하고, 지원하는 작은 합성 문법·단일 직접 호출 범위를
벗어나면 거부한다. 이 helper는 **오프라인 실험 전용**이며 제품 analyzer나 inference의
지원 범위를 줄이거나 대체하지 않는다.

새 회귀 검사 7개는 두 native 언어의 계산/loop 소유 범위, loop 밖 반환, catch/finally,
부분/누락 본문, 잘못된 ID/인수/재귀 binding, 내부 호출의 confidence 혼동을 포함한다.
`npm run test:package`는 기존 검사와 합쳐 **78/78개**가 실제 통과했다.

별도 실제 provider의 CPU pipe audit **3,903개 payload**(training 3,036/validation
860/기존 고정 사례 7개)는 새 metadata block만 제거하면 원래 messages와 byte 표현이
같고 source·출력 schema가 보존됨을 확인했다. 소유 source의 정확한 span **19,238개**를
검사했다. 준비 중에는 원문을 읽지 않았고, mock 응답은 새 모델 설명으로 세지 않았다.
호출 상세 전용 240행은 이 전체 설명 provider 검사에서 제외했다.

실제 모델에서는 앞서 학습한 같은 1.7B 4bit 가중치·sampling·상한·source-owned 출력
형식을 유지했다. 기존 전체 source/prompt에 native metadata만 더했으며 새 자연어 hint,
추가 학습, source 이름 변경, precision 변경, 정적 설명은 없다. **요청 타이머 안에서**
native parse와 metadata 직렬화를 수행했다. Source-free 모델 준비 이후부터 현재 Host
parser 완료/거부까지의 결과는 `source-owned-control-evidence-t7NfpA/report.json`에
모든 원문·raw 출력·소유자 단계·실패와 함께 보존했다.

| 원래 사례 | 준비 후 전체 완료/실패 | Host 형식 통과 | 전체 문장·다섯 필드 수동 검토 |
| --- | --- | --- | --- |
| TypeScript 한국어 누락 본문 | 2.028초 | 예 | 통과 — 부모 작업과 미제공 대상 동작 구분 |
| Kotlin 한국어 누락 본문 | 2.226초 | 예 | 통과 — 구현·효과·완료 미확인 보존 |
| TypeScript 한국어 지역 쓰기 | 2.374초 | 예 | 실패 — 초기화·갱신을 반환 대상으로 나열하고 role 반복·깨진 코드 인용 |
| Kotlin 한국어 지역 쓰기 | 7.304초 | 아니요 | 실패 — 산술 반복·없는 내부 호출·반환 누락·미완성 문장 |
| Kotlin 한국어 감소 loop | 5.868초 | 아니요 | 실패 — 조건 반복·감소 동작과 loop 종료 후 반환 누락 |
| TypeScript 영어 음수 guard | 1.293초 | 예 | 통과 — 정확한 조건·분기 반환·fallback 계산 |
| Kotlin 영어 복합 분기/catch/finally | 2.474초 | 예 | 통과 — 분기/catch 반환·finally 호출·미확인 구현·정상 완료 조건 |

Host는 **5/7**, 필요 조건 검사는 **4/7**, 수동 의미와 3초를 함께 통과한 것은 **4/7**이다.
한국어 쓰기/loop의 실패를 구문에서 복원한 상세 필드로 보완했다고 세지 않는다.
Kotlin 영어 복합 role/output의 불필요한 candidate 한정은 여전히 남아 있으며 일반
confidence 검증 완료로 해석하지 않는다. 새로운 입력만으로 세 실패를 해결하지 못했다.
한 번씩 고정 순서로 읽은 사례이므로 이전 실행 대비 시간 차이를 개선율로 제시하지 않는다.

각 실제 요청은 model call 1회/cache 0이며, native evidence 생성은 **0.83~161.02ms**로
전체 시간에 포함했다. Worker 누적 peak의 최대 MLX는 **1,824.90MiB**, RSS는
**1,273.27MiB**다. 준비와 실패 후 재시작을 포함한 worker 측정이며 전체 VS Code/Host나
요청별 추가 메모리로 해석하지 않는다. 실제 모델 요청은 이번 입력 변형 **7개**, 앞선
학습 후 원래 입력 7개와 이름 진단 3개를 합치면 **17개**다. CPU mock/audit는 더하지 않는다.
모든 실행 handle과 소유 worker가 종료됐다. 이 경로는 **거부**했고 all32·실제 outer Host·
전체 scope/rich 검증이나 제품 설치로 확대하지 않았다. 제품 runtime/기본값/UI/버전/설치는
**0.0.1145** 그대로이며 전체 목표는 미완료다.

### 보존된 전체 응답과 native flow의 token 점수 진단

추가 학습이나 새 모델 비교 대신, 앞선 두 입력 방식의 원래 7개 context를 그대로 둔
점수 전용 진단을 수행했다. 각 실제 raw 응답과, **flow만** 독립 native source 라벨로
바꾼 참조를 비교했다. Summary/calls/limitations의 원래 오류도 그대로 남겼으므로 참조를
올바른 전체 응답으로 부르지 않는다. 원문과 모든 응답을 보존하고 실제 모델의 sampling,
추가 학습, 정적 응답 제공, 응답 교정은 각각 0회다.

CPU native grammar 검사는 **28개 전체 경로**(7개 source × 두 입력 × 두 응답),
response와 EOS **8,612 targets**를 허용했다. 첫 CPU 검사에는 이미 종료한 matcher에
EOS를 다시 consume하는 진단 코드 오류가 있었고 실패와 native API 점검을 보존했다.
실제 worker의 EOS 종료 경계에 맞춘 별도 v2가 전체 검사를 통과했다. 제품 오류나 새
generation 실패로 세지 않는다.

같은 기존 1.7B fused 가중치로 모든 target의 teacher-forced logit을 읽었다. 원래 응답을
줄이지 않고 새 cache에 전체 source/prompt를 읽었으며, 원래 multi-row model 연산을
사용했다. 점수는 temperature 1의 미필터 log-sum-exp로 계산한 NLL이다. 실제 sampling
확률·설명 시간·의미 정답률로 해석하지 않는다. 내용이 같은 **8쌍**은 모든 target 점수와
집계가 정확히 같았다.

| Kotlin 한국어 loop의 callee flow | 원래 입력의 평균 native-masked NLL | native 제어 입력의 평균 native-masked NLL |
| --- | --- | --- |
| 보존된 반복 문장 | 0.0231 | 0.0168 |
| 원문에서 만든 flow 참조 | 0.7245 | 0.7231 |

낮은 NLL은 해당 teacher-forced 경로의 높은 모델 점수다. 반복 문장은 길이가 다르고
문맥을 스스로 반복하므로 이 차이를 정확도 비교나 일반 원인 증명으로 사용하지 않는다.
올바른 native flow의 target을 grammar가 막는다는 관찰은 없었으며, 단순한 grammar
형식 변경만으로 해결할 근거는 부족하다. 첫 token 차이는 표현 방식 차이일 수도 있다.

예전 worker가 실제 sampled token ID를 저장하지 않아 여기서는 raw 문자열의 canonical
tokenization을 사용했다. 원래 loop와 제어 입력의 Kotlin 쓰기는 보존된 생성 token 수와
각각 **2개/1개** 차이가 났다. 나머지 길이가 같아도 sampled 경로의 동일성을 입증하지
않는다. `source-owned-prose-probe-v2/report.json`과 각 target 점수·검토를 보존했다.
진단 peak MLX는 **1,901.27MiB**, release 후 active는 **8 bytes**였으며 worker 설명 자원
측정으로 대체하지 않는다. 모든 handle이 종료됐고 이 단계의 실제 새 설명은 **0개**다.

### 지역 동작에 연결한 다섯 문장 출력의 부정 결과

Native 제어 입력만 더해도 지역 상태 설명이 반복돼, 각 동작의 출력 문장을 독립적으로
연결하는 별도 contract를 구현했다. 오프라인 `native-operation-flow.cjs`의
`createNativeOperationFlowContract(context, base, evidence, locale)`는 완전한
초기화/갱신 또는 while/반환 본문에서만 flow를 다섯 칸으로 연결한다. 순서는 부모 인수
전달, 대상 초기화, 대상 갱신 또는 반복, 대상 반환, 정상 복귀 시 부모 결과 사용이다.
각 schema 칸에는 native event와 소유자가 있고 `sourceId`는 해당 본문으로 고정한다.
자연어 `text`와 기존 모델 작성 필드는 계속 모델이 작성하며, 구문 기반 상세 복원의
기존 경계도 유지한다.

원래 전체 source, 기존 600자 flow 합계와 summary/calls/limitations 한도를 유지하고,
문장을 고치거나 자르지 않는다. 일반 코드 지원을 이 작은 실험 문법으로 축소하지 않는다.
지역 상태가 없는 나머지 네 context는 앞선 typed contract/input 그대로다.
두 native 언어의 loop 내부 갱신과 loop 밖 반환, 소유자/문장 수 불일치 및 전체 overflow의
거부, 생성 문자의 무변경을 확인한 private 계약 검사 **3개**가 통과했다. 실제 provider
pipe mock **7개**, 소유 source span **16개**, native grammar/EOS **7개**도 통과했다.
변경한 schema와 guidance만 원래대로 되돌리면 이전 실제 mock 입력과 byte 표현이 같다.
Mock 문장은 전송 검사 전용이며 모델 응답이나 정확도 사례가 아니다.

`native-operation-flow-5R9nBA/report.json`의 고정 7개 실제 요청은 같은 가중치·sampling·
cache 0/model call 1회와 준비 이후 타이머를 유지했다. Native 분석·schema 생성·전체
generation·현재 Host parser 완료/거부를 포함하며 실제 outer VS Code Host는 아니다.

| 원래 사례 | 준비 후 전체 완료/실패 | Host 및 3초 | 전체 원문·문장·다섯 상세 검토 |
| --- | --- | --- | --- |
| TypeScript 한국어 누락 본문 | 1.874초 | 통과 | 통과 |
| Kotlin 한국어 누락 본문 | 2.042초 | 통과 | 통과 |
| TypeScript 한국어 지역 쓰기 | 2.602초 | 통과 | 실패 — 대상 초기화를 인수 전달로 표현하고 갱신·반환 의미 혼동 |
| Kotlin 한국어 지역 쓰기 | 8.897초 | 실패 | 실패 — 세 문장과 role에서 지역 변수·입력을 반복하며 미완성 |
| Kotlin 한국어 감소 loop | 2.910초 | 통과 | 실패 — 지역 변수·호출 인수 설정을 혼동하고 반복을 조건 계산으로 표현 |
| TypeScript 영어 음수 guard | 1.216초 | 통과 | 통과 |
| Kotlin 영어 복합 분기/catch/finally | 2.178초 | 통과 | 통과 — 불필요한 candidate 한정은 남음 |

형식·3초와 필요 조건은 **6/7**이지만, 전체 의미와 3초를 함께 통과한 것은 **4/7**이다.
변경된 지역 상태 세 사례의 의미 통과는 **0/3**이다. 소유자 ID·동작 칸·원문 식이
존재하는 것만으로 문장이 그 동작을 설명한다고 세지 않는다. 빠른 Kotlin loop도 잘못된
문장이 있어 성공이 아니다. 미완성 쓰기는 **1,168 actual output tokens**와 전체 raw를
보존했다. 나머지 네 입력의 실제 raw 출력은 앞선 것과 byte가 같았지만 새로 생성한
반복 사례이므로 독립 source coverage가 늘었다고 하지 않는다.

Worker 누적 peak는 MLX **1,912.51MiB**, RSS **1,272.11MiB**다. 준비 및 실패 후 재시작을
포함하며 전체 Host 메모리나 요청별 추가 allocation이 아니다. 이번 actual 요청 **7개**를
합쳐 source-owned 학습 후 실제 요청은 **24개**다. 점수 전용 28경로/CPU mock은 더하지 않는다.
모든 실행 handle과 소유 worker가 종료됐다. 이 contract도 **거부**했고 all32/native 변환/
실제 outer Host/전체 scope/rich로 확대하지 않았다. 공개 package 78개 통과는 앞선 실제
코드 검사 기록이며 이 문서 변경에서 재실행하지 않았다. 제품 runtime/기본 모델/UI/버전/
설치는 **0.0.1145**를 유지하며 목표는 미완료다.

추가 read-only coverage audit는 frozen corpus 전체를 native source로 읽었다. 새 다섯
동작 칸에 해당하는 지역 상태 예제는 training **456개**(쓰기 228/loop 228), validation
**60개**(쓰기 32/loop 28)였다. 모두 기존 세 문장 label이고 다섯 동작별 label 및 해당
event-bound schema는 각각 **0개**였다. 평가 응답은 읽지 않았고 corpus/라벨/가중치를
수정하지 않았다. 이는 새 contract의 학습 형식 공백이며 실제 실패의 원인이나 추가
학습의 개선 가능성을 입증하지 않는다. 추가 training은 수행하지 않았다.

### Native 동작별 학습 데이터의 독립 구현과 검증

다섯 칸 inference contract는 유지하고, 그 형식의 학습 예제가 없던 공백을 별도 데이터로
보완했다. 공개 오프라인 모듈 `scripts/model-reading-native-operations/`의 aggregate
entrypoint는 `index.mjs`이며 public API는 다음과 같다.

- `createNativeOperationFlowPlan(context)`: 원래 context만 받아 native parser로 소유자와
  동작을 도출한다. 완전한 초기화/갱신 또는 단일 갱신 while/동일 지역 변수 반환에만 다섯
  operation slot을 만든다. 누락·부분·다른 모양은 native evidence를 유지하되 slot은 없다.
- `createNativeOperationFlowContract(context, base, locale)`: 위 plan에서 flow schema와
  guidance를 만든다. 추론 전용 public 경계는 `contract.mjs`다. 이전 private pilot의
  schema/guidance와 같으며 label 모듈을 import하지 않는다. decoder는 개수와 소유자를
  검사한 뒤 원래 raw 문자열을 base decoder에 전달한다. 합계 한도·문장 검증은 기존
  decoder가 처리하고, 잘못된 문장을 고치지 않는다.
- `createNativeOperationFlowSupervision(context, locale)`: 오프라인 학습 전용 API다.
  원문만 받아 부모 전달, 대상 초기화, 갱신 또는 반복, 대상 반환, 정상 복귀 시 부모 결과
  사용을 독립적인 다섯 문장으로 만든다. 반복 조건의 참 방향과 반복 종료 경로를 보존한다.
  후보 confidence를 승격하지 않으며, 지원되지 않는 모양에는 label을 만들지 않는다.

Positive claim에는 실제 소유 본문의 원문 span과 식이 있다. “명시적 내부 호출 없음”은
반환문의 span만으로 입증하지 않는다. 완전한 native 본문 및 전체 invocation inventory를
별도 absence assertion으로 보존하고 독립 audit가 본문 전체를 다시 순회한다. 기존 답변,
평가 응답이나 오래된 return/effect inventory는 label 생성기에 전달하지 않는다.
이 문장은 학습 target이며 추론 응답·fallback·repair에 사용하지 않는다.

`model-reading-native-operations.test.mjs`의 9개 검사는 두 언어/두 locale, exact/inferred,
식·조건의 source counterfactual, loop 안 갱신과 밖 반환, 누락/부분/숨은 호출, 원문과
raw 무변경, 잘못된 소유자·문장 수 및 base decoder 오류 전달을 다룬다. 최초 실행에서
추가 invocation을 parser 오류로 예상한 검사가 실패했다. 이 구문은 native evidence에서
허용되는 모양이므로 지원 slot과 label이 없음을 검사하도록 구분했고, 이후 package
검사 **87/87**이 통과했다. 실제 runtime의 aggregate bound 및 전체 Host 검사는 별도
아래 corpus audit로 확인했다. UI·browser·outer VS Code QA는 이번 단계에서 수행하지 않았다.

별도 frozen corpus `training-data-native-operations.json`의 SHA-256은
`11e0ee5da5e919e1de4d5eed790a9d7710677e7d9f631f31b0ab5c621143f61a`다.
기존 원본 corpus와 모델은 보존했다.

| 분할 | 전체 | 동작별 flow label | 기존 flow 보존 | call-only row 전체 보존 |
| --- | ---: | ---: | ---: | ---: |
| training | 3,256 | 456 | 2,580 | 220 |
| validation | 880 | 60 | 800 | 20 |

모든 원문/context와 summary/calls/limitations는 기존 데이터와 byte 표현이 같다.
원문 shape별 label은 training 쓰기 228/loop 228, validation 쓰기 32/loop 28이다.
타입·locale 분포는 각각 training 228/228, validation 30/30이다. 원문 집합은 기존
training 1,028/validation 178을 보존하며 서로 겹치지 않는다. 평가 source의 기존 분리
증명도 동일 context를 통해 유지된다. Label 생성 시 평가 응답을 읽지 않았다.

전체 reading 3,896개의 messages에는 실제 실패 pilot과 같은 native control metadata를
포함했다. 516개 지역 상태 label 외의 flow와 모든 비-flow 필드는 바꾸지 않았다. 전체
reading의 private contract byte 검사 **3,896개**, 독립 native positive span **2,836개**,
완전한 본문의 호출 부재 검사 **516개**, 원래 wire와 현재 Host parser roundtrip
**4,136개**가 통과했다. 전체 연결 flow 최대 길이는 원래 한도 안의 **500 scalar**다.

새 provider는 추론 label API를 사용하지 않는다. 실제 provider의 FIFO/pipe에 fixture를
통과시켜 학습/validation reading **3,896개**의 messages/schema를 frozen corpus와
byte 비교했다. 원래 고정 7개 평가 context의 messages/schema도 기존 pilot 입력과
같았다. 총 **3,903 payload**, mock child 1개 생성/종료를 확인했다. 이 fixture는 새
모델 응답·정확도·지연 측정으로 세지 않는다.

고정 tokenizer와 현재 worker의 canonical Korean/compact JSON grammar로 전체 응답과
EOS를 검사해 **4,136/4,136**이 통과했다. 학습 데이터의 전체 prompt는 **6,697,257 tokens**,
응답 및 EOS target은 **733,709개**다. 전체 sequence 최대 **3,326 tokens**는 종전 학습
할당 3,072를 넘으므로, 자르지 않고 다음 512 배수인 **3,584**를 할당하도록 했다.
추론 context 8,192/output 2,400 및 response-through-EOS loss 경계는 그대로다.

이 준비 단계에서 정한 실행은 원래 `model-1.7b`에서 별도 adapter로 시작하는 새 full pass 한 번이다.
기존 adapter를 이어서 학습하거나 epoch/learning rate/precision을 순회하지 않는다.
rank 8/scale 20/마지막 16개 layer/Adam 1e-4/seed 42/batch 1/3,256 updates를 유지한다.
유한 학습 wall ceiling **9,600초**는 종전 측정 full pass 시간에 전체 token 작업량 비율
**1.1651**과 25% 여유를 적용하고 600초 단위로 올린 값이다. 사용자 요청의 3초 추론
목표를 늘린 것이 아니다. 모든 실제 yielded index와 전체 완료를 확인하기 전에는
학습 완료로 세지 않는다.

학습 시작 전 이 단계의 실제 새 모델 설명은 **0개**이며, 데이터/문법/전송 검사는 모델의
품질이나 속도 개선을 입증하지 않는다. 새 가중치의 원래 7개 전체 의미·3초 검증이
먼저이며, 성공해야 all32/native 변환/실제 outer Host/모든 scope/full rich/자원 경계를
확대한다. 제품 runtime·기본 모델·버전·설치는 **0.0.1145**를 유지하며 목표는 미완료다.

### 연산별 supervision 완료와 원래 7개 설명 검증

새 adapter는 원래 1.7B base에서 한 번 학습했고, 실제 학습 handle은 정상 종료됐다.
전체 **3,256개의 서로 다른 index**가 한 번씩 처리됐음을 종료 후 별도로 확인했다.
전체 reading 3,036개 중 새 연산별 flow는 456개이고, 별도 기존 call-only는 220개다.
두 언어와 두 locale은 각각 1,628개다. 원문·답변은 자르지 않았고 sealed corpus/code/loss/config의
hash도 일치했다. 학습은 **7,449,144ms**, 일회성 학습 peak MLX는 **13,871.22MiB**였다.
이는 추론 상주 메모리나 확장 자원 사용량으로 해석하지 않는다.

별도 4bit/group128 모델의 전체 가중치는 **914,316,110 bytes**, SHA-256은
`be0ed65853fd44f3b66089d3092c1d4e20948e69d59c55836966ceaedb9f22a4`다.
이전 가중치를 덮어쓰지 않았다. 새 가중치에서도 원래 배열과 공유 view의 전체 logit/
활성 KV byte를 **37개** 비교해 모두 일치했다. 원래 control을 해제하고 source-free
준비를 마친 뒤 활성 가중치는 **914,245,640 bytes**로 동일해, 추가 상주 가중치는 0이다.
수치 비교 peak에는 비교용 두 cache와 control이 포함되므로 추론 peak로 세지 않는다.

`native-operation-supervision-qsr5Xp/report.json`의 실제 7개 요청은 실패한 이전
native-operation pilot과 **동일한 전체 원문/messages/schema**를 사용했다. 달라진 것은
한 번 학습한 가중치다. 모델 준비 이후 native evidence 생성·전체 generation·현행 Host
parser 완료까지 측정했다. 실제 outer VS Code Host/Webview 전달은 이 측정에 포함하지
않았다. 각 요청은 실제 model call 1회/cache 0이며 응답을 수정하거나 재시도하지 않았다.

| 원래 사례 | 전체 설명 완료 | 전체 원문·summary/flow·다섯 상세 검토 | 3초 이내 |
| --- | ---: | --- | --- |
| TypeScript 한국어 누락 본문 | 2.647초 | 통과 — 대상 동작·반환·효과는 미확인 | 예 |
| Kotlin 한국어 누락 본문 | 5.005초 | 통과 — 대상 본문을 추정하지 않음 | 아니요 |
| TypeScript 한국어 지역 쓰기 | 2.821초 | 통과 — 초기화·갱신·반환과 소유자 구분 | 예 |
| Kotlin 한국어 지역 쓰기 | 3.010초 | 통과 — 정확한 초기화·갱신·반환 | 아니요 |
| Kotlin 한국어 감소 loop | 5.705초 | 통과 — 조건 중 갱신 반복, loop 밖 반환 | 아니요 |
| TypeScript 영어 음수 guard | 2.451초 | 통과 — 정확한 조건·분기 값·fallback 계산 | 예 |
| Kotlin 영어 복합 분기/catch/finally | 2.740초 | 통과 — catch 경로·정확한 finally 인수·완료 조건·미확인 구현 | 예 |

Host와 기존 필요 조건은 **7/7**, 전체 수동 의미 검토도 **7/7**이다. 이전에 실패한
지역 쓰기·loop 세 건은 모두 정확한 연산과 소유자를 설명했고 반복 출력이 사라졌다.
그러나 전체 의미와 3초를 함께 통과한 것은 **4/7**, 지역 상태 세 건에서는 **1/3**이다.
3.010초도 실패로 남겼다. 모델이 기존에 작성하던 모든 prose 칸을 보존했으며 기존 wire의
source fact 복원도 그대로 사용했다. 다섯 상세 필드 전체가 항상 모델 생성문이라고
주장하지 않는다. 일곱 사례의 의미 판정은 일반 정확도나 모든 scope 검증을 대신하지 않는다.

Worker 누적 peak의 최대는 MLX **1,912.81MiB**, OS RSS **1,277.59MiB**다. 이는 parent/
전체 VS Code process tree의 peak가 아니다. 학습·fusion·수치 비교·pilot handle과 소유
worker는 모두 종료됐다. 새 가중치는 **지연 기준 미충족으로 채택하지 않았고**, all32/
native 변환/실제 outer Host/모든 scope/full rich로 확대하지 않았다. 공개 package
**87개 통과**는 변경되지 않은 공개 코드에 대한 앞선 실제 검사 기록이다. 이번 단계의
후속 검증 도구는 Node 구문 검사 2개/Python AST 검사 2개를 통과한 뒤 실행했다.

### 같은 원문·가중치·응답의 토큰별 지연 관찰

지연의 위치를 보기 위해 Kotlin 누락 본문과 감소 loop 두 건만 별도 진단으로 반복했다.
`native-operation-latency-profile-W8JCj3/report.json`과 완전한 sidecar에는 실제 SDK가
뽑은 token ID, yield 간격, 기존 GC event와 CPU 사용 counter를 보존했다. 관찰자는 원래
SDK의 yield object를 그대로 전달하며, 추가 tensor 평가/동기화나 sampler 변경을 하지
않는다. Sidecar는 원래 응답을 flush한 뒤 쓴다. 기존 provider·전체 source/schema·sampling/
상한은 동일하다. 두 응답의 raw wire와 전체 decoded response는 각각 위 pilot과 byte
일치했다. 계측·요청 순서·환경의 영향을 분리한 실험은 아니므로 개선율로 쓰지 않는다.

- 누락 본문은 **2.082초**, 첫 yield **330.99ms**, 이후 가장 긴 간격은 **15.92ms**였다.
  원래 5.005초 실패를 새 통과로 교체하지 않는다.
- Loop는 **5.436초**로 지연을 다시 관찰했다. 첫 yield가 **2,463.34ms**였고, 이후
  첫 32개 간격의 중앙값은 **33.56ms**였다. 65~96번째는 중앙값 **7.27ms**, 최대
  **8.75ms**였다. 20ms 초과 간격은 처음 49개 위치 안에서 관찰됐다.
- 두 stream 모두 기존 Python GC event는 **0개**였다. Loop의 stream wall은
  **5,348.65ms**, process CPU user+system 합계는 약 **1,118.89ms**였다. 이는 GPU
  kernel 시간이나 pipeline compile의 원인 증명이 아니다. 정확한 실행기 내부 구간은
  아직 분리하지 않았다.

이 두 건은 실제 새 생성 **진단 반복 2회**, 새로운 사례 coverage **0개**다. 원래
7개 gate의 의미/3초 판정 **4/7**과 모든 실패를 유지한다. 계측 worker도 정상 종료됐고,
공개 runtime·기본 모델·Default/QA 설치는 **0.0.1145**다. 다음 작업은 입력 전처리 및
초기 decode의 실행 비용을 좁히는 진단이며, 다른 모델·학습 epoch·prompt·precision
순회나 답변 축소/복원으로 3초를 통과시킨 것으로 세지 않는다.

### 원문 없는 입력 크기 진단과 SDK 구간별 관찰

동일한 새 가중치에서 원문·grammar·sampling 없이 고정 EOS 배열을 순서대로 실행했다.
입력/후속 행 수는 앞서 관찰한 요청과 같은 **1,988/240**, **3,023/244**이며 마지막
조합을 한 번 반복했다. 각 행의 전체 logits와 KV 완료를 기다리는 진단이므로 실제 SDK의
lookahead/overlap과 다르다. 설명 생성·새 원문 coverage·3초 통과 자료로 사용하지 않는다.

첫 실행은 모든 forward 후 보고서 metadata에서 없는 `mx.promote_types` API를 호출해
종료 코드 1이었다. 원래 stdout과 실패를 보존했고 전체 step 보고서를 성공으로 만들지
않았다. V2는 모델 작업을 그대로 두고 dtype metadata와 중간 기록만 고쳤다. 전체
**245개 유한 logit tensor와 56개 활성 KV tensor**가 반복 사이에 byte 일치했고 RNG는
변하지 않았다. 비교용 객체를 해제한 뒤 추가 활성 memory는 0 bytes였다.

| 원문 없는 V2 실행 | Prefill | 후속 1행 forward 합계 |
| --- | --- | --- |
| 첫 1,988/240 | 661.62ms | 7,152.19ms |
| 첫 3,023/244 | 1,544.21ms | 4,237.00ms |
| 반복 3,023/244 | 1,238.50ms | 6,492.82ms |

반복의 후속 계산이 더 느려 일정한 warmup 효과를 입증하지 못했다. 자료는
`native-operation-source-free-shapes-v2-report.json`에 있다. Model-only 직렬 실행의
수치 일치가 실제 요청의 지연 원인을 확정하지는 않는다.

이어서 원래 SDK 연산 순서에 CPU timer만 넣어 Kotlin 누락 본문/감소 loop를 진단
반복했다. `native-operation-stage-profile-cfR9sa/report.json`과 sidecar에 기록했다.
추가 tensor 평가/동기화 없이 모델 graph 작성, 기존 token 읽기, native grammar,
sampling graph와 dispatch 호출을 나눴다. 원래 SDK/worker 파일은 수정하지 않았으며
파생 코드의 타이머 편집을 되돌리면 원문 byte가 복원되는지 검사했다.

| SDK 구간 관찰 | 누락 본문 | 감소 loop |
| --- | --- | --- |
| 전체 생성·Host parser 완료 | 2.918초 | 2.244초 |
| Prefill 완료 대기 합계 | 733.70ms | 482.74ms |
| 생성 model graph 작성 합계 | 141.00ms | 140.27ms |
| 기존 token 읽기 대기 합계 | 1,501.82ms | 1,144.49ms |
| Native grammar mask 계산 합계 | 25.48ms | 23.34ms |
| Native token consume 합계 | 2.64ms | 2.57ms |
| Async dispatch 호출 합계 | 343.40ms | 344.95ms |

Token 읽기에는 이전 GPU 작업의 완료를 기다리는 시간이 들어간다. 이를 token 복사만의
비용이나 순수 GPU kernel 시간으로 해석하지 않는다. 중첩된 processor 합계와 그 내부
구간도 더하지 않는다. 두 raw wire/완전한 Host 응답은 원래 pilot과 byte 일치했지만
이번 빠른 진단 두 건으로 원래 **4/7** 판정이나 5초대 실패를 교체하지 않는다.

### Grammar용 전체 token 이력 제거 후보의 검증과 기각

SDK는 grammar processor용 전체 token 이력을 이어 붙인 뒤 새 부분만 읽는다. 고정
prompt는 int32, 실제 sampler ID는 uint32여서 이력은 int64가 된다. Native grammar는
첫 호출에서 prompt를 소비하지 않고 이후 새 ID만 필요하므로, 이 전달 경로만 바꾼
단일-owner 어댑터를 구현했다. 전체 prompt의 모델 처리, 모든 문장/필드, model/cache/
sampling/yield 코드는 유지한다. 다른 processor나 여러 입력 행은 거절한다. 파생 SDK와
worker의 선언된 편집을 역으로 적용해 나머지 원문 byte가 같은지 확인했다.

첫 replay 검사는 EOS 이후에도 native matcher가 오류 상태가 아니라고 잘못 가정해
실패했다. 고정 SDK의 lookahead는 이미 `NoExtension`으로 끝난 matcher에 EOS를 한 번
더 전달한다. Native matcher는 `InternalError`이면서 stopped 상태가 되고 기존 worker는
원래 stopped 분기를 유지한다. 검사도 이 원래 동작의 동일성을 비교하도록 고쳤으며
첫 실패를 보존했다. 종료 정책을 바꿔 통과시키지는 않았다.

수정한 `incremental-grammar-parity-v3.json`은 **1,615개 전체 vocabulary mask**와
**63개 전체 masked logit/확률/선택 token/RNG 비교**를 통과했다. 각 mask는 151,936개
vocabulary bit를 비교했다. 두 token 열은 실제 SDK ID이고 나머지 다섯은 저장 wire의
canonical re-tokenization이므로 원래 sampled history라고 표현하지 않는다. 확률 검사는
합성 logits를 사용했으며 모델 로딩·새 설명·지연 검증은 0개다.

첫 실제 연결은 어댑터가 통합 worker의 compiler wrapper 설치 전에 native 클래스를
보관한 오류로 실패했다. 원래 canonical/compact compiler와 schema receipt를 우회해
`Missing native-only schema evidence`가 발생했다. 7개 요청을 시도했지만 수신한 완료
응답/metrics는 0개다. 이 0개는 실패한 child 내부에서 sampling이 없었다는 뜻이 아니다.
`incremental-grammar-candidate-wUVkG6`와 별도 실패 annotation을 보존했다. 생성자에서
현재 compiler wrapper를 참조하도록 연결을 고쳤고, 실제 wrapper 호출 검사와 위 전체
동일성 검사를 통과한 뒤 다음 단일 후보를 실행했다.

`incremental-grammar-candidate-v2-vcwdTq/report.json`은 원래 일곱 원문을 한 번씩 새로
읽은 결과다. 모든 실제 raw wire와 최종 Host 응답이 원래 pilot과 byte 일치했다. 전체
원문·summary/flow·다섯 최종 상세를 다시 읽었고 **의미 검토 7/7**을 유지했다. 기존 source
fact 복원이 있는 상세를 모두 모델 작성 문장으로 계산하지 않는다.

| 이력 제거 후보 | 전체 설명 완료 | 의미 및 3초 |
| --- | --- | --- |
| TypeScript 한국어 누락 본문 | 5.128초 | 실패 |
| Kotlin 한국어 누락 본문 | 2.441초 | 통과 |
| TypeScript 한국어 지역 쓰기 | 3.041초 | 실패 |
| Kotlin 한국어 지역 쓰기 | 5.309초 | 실패 |
| Kotlin 한국어 감소 loop | 3.703초 | 실패 |
| TypeScript 영어 음수 guard | 4.105초 | 실패 |
| Kotlin 영어 복합 분기/catch/finally | 3.328초 | 실패 |

후보는 **1/7**만 전체 3초를 만족했고 최대는 **5,309.378292ms**였다. 전체 token 이력
concat과 int64 확장을 제거한 것만으로 지연이 해결되지 않아 채택하지 않았다. 환경·순서
변동을 분리한 비교가 아니므로 이 수치만으로 인과적 성능 악화율도 주장하지 않는다.
후보 worker의 누적 MLX peak는 **1,912.81 MiB**, RSS peak는 **1,270.97 MiB**이며 전체
VS Code process tree memory가 아니다. Source-free 준비·원래 입력/출력 상한·sampling·
cached tokens 0·중복 가중치 활성 memory 0을 유지했다.

모든 audit/모델 handle과 소유 worker는 종료했다. 공개 runtime source를 바꾸지 않은
진단이므로 앞선 package 테스트 **87개** 통과 기록을 유지하고 전체 테스트를 반복하지
않았다. 새 private Python/Node 구문 검사, native replay/확률 검사와 위 실제 요청 검증은
수행했다. 공개 runtime·기본 모델·Default/QA 설치는 **0.0.1145**이며, 원래 7개 판정
**4/7**도 보존한다. 실제 outer Host·전체 scope/rich 및 3초 목표는 아직 미완료다.

### Native 확정 토큰 구간의 제출 순서 변경과 기각

설치된 LLGuidance 1.9.1의 `deep_copy`/`compute_ff_tokens`를 사용해, 현재 native schema에서
다음 토큰이 하나로 확정되는 구간을 검사했다. API의 강제 byte/token 처리는
[해당 revision의 원문](https://github.com/guidance-ai/llguidance/blob/f0971424ec072d3e4d4196bcc7f31a2f60527df9/parser/src/api.rs#L62)을
참고했다. 원래 matcher를 바꾸지 않고 복사본의 각 전체 vocabulary mask가 정확히 한
token만 허용하는지 검증한다. EOS 포함, 출력 잔여 한도 초과, 오류/정지 및 검증된 최대
길이 9를 넘는 구간은 기존 한 token 경로로 처리한다. 강제 토큰을 정적 답변으로 넣거나
모델·head·sampler 계산을 생략하는 구현이 아니다.

`native-forced-run-audit.json`은 원래 일곱 응답의 replay다. 두 token 열은 실제 SDK ID,
나머지 다섯은 저장 wire의 canonical re-tokenization이다. 원래/control matcher와
**3,216개 전체 mask 쌍**이 같았고, 원래 matcher를 변경하지 않았다. 겹치지 않는 유효
구간은 **70개**, 후속 행은 **221개**, 최대 길이는 **9**였다. 예전 출력 형식에서 다중
token 절감이 없었던 결과를 새 형식의 결과로 교체하지 않는다. 이 검사는 모델 로딩·
sampling·새 설명이 모두 0개다.

새 private model helper는 입력이 알려진 짧은 구간에서 layer 바깥/token 안쪽 순서로
lazy graph를 작성한다. 각 embedding, attention/KV, MLP 및 head 연산은 원래
**batch 1/길이 1** shape와 uint32 입력을 유지한다. 여러 token을 하나의 QMM으로
바꾸지 않는다. 모든 행의 전체 logits와 원래 full-vocabulary sampler도 계산한다.
따라서 위 221행은 제출 순서를 묶을 기회이며 모델 계산 221회를 없앴다는 뜻이 아니다.

`native-forced-run-numeric.json`은 같은 1.7B 가중치의 source-free 실제 모델 검사다.
Prefix 64에서 길이 2/3/4/5/6/8/9, prefix 255/3,023/3,068에서 길이 9,
prefix 1,988에서 길이 4를 비교했다. **11개 조건의 전체 유한 logit tensor 68개와
활성 KV tensor 616개가 byte 일치**했고 최대 차이는 0이었다. 원래 weight 객체 identity와
RNG도 유지했다. 비교 데이터를 해제한 뒤 활성 memory는 전후 **914,245,640 bytes**로
추가분이 0이었다. 비교 peak **2,270.69 MiB**에는 두 비교용 cache와 전체 control logits가
포함되므로 실제 생성 peak로 사용하지 않는다. 이 검사 역시 새 설명은 0개다.

이후 기존 SDK의 one-token lookahead와 sampler를 유지하는 제한된 queue를 연결했다.
Native singleton 구간의 후속 graph만 미리 제출하고 실제로 선택된 ID를 반환할 때마다
원래 mask에서 기대한 ID와 같은지 확인한다. 모델 없는 실제 SDK 검사는 출력 한도
1/2/3/9/64, 확률적 영어/Unicode, 길이 9 초과 구간의 fallback을 포함했다.
`native-forced-run-scheduler-parity.json`의 **8개 조건/77개 전체 log-probability tensor**와
선택 ID·최종 RNG·논리 cache offset이 모두 같았다. 7개 native batch를 실제로 사용했고,
출력 한도를 넘겨 queue를 만들지 않았다. EOS lookahead의 원래 native stopped/error
동작도 유지했다. 이는 합성 logits의 scheduler 검증이며 실제 Qwen3 수치 검사를 대신하지 않는다.

`native-forced-run-candidate-cU6tnv/report.json`은 이 두 검사를 통과한 경로로 원래 일곱
소스를 한 번씩 새로 읽은 결과다. 기존 frozen provider, 전체 원문·schema·sampling·출력
상한·source-free 준비·FIFO/취소/worker 소유권과 shipped Host parser를 유지했다. 실제
raw wire와 전체 Host 응답이 **7/7 byte 일치**했다. 모든 원문과 summary/flow/다섯 최종
상세를 직접 다시 읽어 **의미 검토 7/7**을 확인했다. Source fact 복원으로 채워진 기존
상세를 모델이 모두 작성했다고 계산하지 않는다.

| Native 확정 구간 제출 후보 | 전체 설명 완료 | 의미 및 3초 |
| --- | --- | --- |
| TypeScript 한국어 누락 본문 | 3.722초 | 실패 |
| Kotlin 한국어 누락 본문 | 3.127초 | 실패 |
| TypeScript 한국어 지역 쓰기 | 4.373초 | 실패 |
| Kotlin 한국어 지역 쓰기 | 3.646초 | 실패 |
| Kotlin 한국어 감소 loop | 3.402초 | 실패 |
| TypeScript 영어 음수 guard | 1.816초 | 통과 |
| Kotlin 영어 복합 분기/catch/finally | 4.305초 | 실패 |

실제 queue 반환/미리 작성한 후속 행은 모두 일치했고 합계 **221개**였다. 후보의 전체
3초 통과는 **1/7**, 최대 **4,373.24025ms**여서 채택하지 않는다. 원래 **4/7**과 이력
제거 후보 **1/7**은 각각의 실패 기록으로 유지한다. 새 설명은 7개이며 새로운 독립
원문 coverage는 0개다. 환경·순서 변동을 통제한 비교가 아니므로 개선율을 주장하지 않는다.
후보 worker의 누적 MLX peak는 **1,910.20 MiB**, RSS peak는 **1,272.52 MiB**이며
전체 Host/VS Code memory가 아니다. Cached tokens와 추가 활성 가중치는 모두 0이었다.

모든 소유 audit/model handle과 worker는 종료했다. Python/Node 구문 검사, native replay,
전체 수치 및 SDK scheduler 검사와 위 실제 요청 검증을 수행했다. 공개 runtime 코드를
바꾸지 않아 앞선 package **87개 통과** 기록을 유지하고 전체 테스트를 반복하지 않았다.
실제 outer Host·전체 scope/rich 검증과 3초 목표는 미완료이며, runtime·기본 모델·
Default/QA 설치 **0.0.1145**를 유지한다.

### 512행 원문 입력에서 MLP gate/up만 결합한 후보

앞선 모든 입력의 Q/K/V 결합은 split-K 반올림 차이로 기각했고, gate/up의 64행
primitive는 byte 일치했다. 이를 근거로 새 후보는 원래 SDK의 **512행 prefill**에서만
gate/up을 함께 계산한다. Q/K/V prefill, 다른 입력 shape, 한 token decode, 원래
SwiGLU/down projection·정밀도·가중치 파일은 유지한다. 기존 packed storage의 view를
사용해 새 가중치를 복사하지 않는다. 다른 prefill 길이로 설정을 순회하지 않았다.

`prefill-gate-up-numeric.json`은 같은 1.7B 가중치에서 EOS 또는 JSON 구조 ID만 사용했다.
Prefix 64/513/1,025/1,684/1,988/3,023을 SDK와 같이 512행씩 처리하고 마지막 prompt
token을 남겼다. **6개 조건에서 전체 normalized hidden tensor 18개, 후속 전체 logit
tensor 24개, 활성 KV tensor 2,352개가 byte 일치**했고 최대 차이는 0이었다. 원래 weight
객체 identity와 RNG도 같았다. 비교 데이터를 해제한 뒤 활성 memory는 전후
**914,245,640 bytes**, 추가분 0이었다. 이 검사는 원래 SDK가 버리는 마지막 prefill
hidden도 평가해 비교했으며, **2,250.32 MiB** peak에는 비교용 cache가 들어간다.
실제 추론의 시간/peak나 새 설명으로 사용하지 않는다.

Private hook은 검증한 MLP factory만 연결하며 원래 SDK/worker 파일·grammar·sampling은
수정하지 않는다. Weak model reference와 정수 counter만 읽어 source/KV 소유권을
늘리지 않는다. 실제 receipt에는 변경된 gate/up shape를 명시하고, 기존의
`originalMultiRowPrefillShapes`를 false로 바로잡았다. Source-free 64+1 준비에서
512행 후보를 실행하지 않았음을 확인한 뒤 실제 요청을 시작했다.

`prefill-gate-up-candidate-wXpCVB/report.json`의 원래 일곱 전체 소스는 각각 한 번씩 새로
생성했다. 실제 raw wire와 전체 Host 응답 모두 **7/7 byte 일치**했다. 원문과
summary/flow/다섯 최종 상세를 다시 읽어 **의미 검토 7/7**을 확인했다. 기존 source fact
복원으로 채워지는 상세를 모두 모델 작성 문장으로 표현하지 않는다.

| 512행 MLP prefill 후보 | 전체 설명 완료 | 의미 및 3초 |
| --- | --- | --- |
| TypeScript 한국어 누락 본문 | 1.931초 | 통과 |
| Kotlin 한국어 누락 본문 | 2.069초 | 통과 |
| TypeScript 한국어 지역 쓰기 | 2.121초 | 통과 |
| Kotlin 한국어 지역 쓰기 | 2.320초 | 통과 |
| Kotlin 한국어 감소 loop | 3.680초 | 실패 |
| TypeScript 영어 음수 guard | 1.736초 | 통과 |
| Kotlin 영어 복합 분기/catch/finally | 2.735초 | 통과 |

실제 request별 fused graph 작성 수는 512행 chunk 수 × 28 layers와 일치했고 총
**756회**였다. 이는 GPU dispatch 완료 횟수나 kernel 시간 측정이 아니다. 3초 통과는
**6/7**, 최대 **3,680.424375ms**여서 후보를 채택하지 않았다. 환경·순서 변동을 통제한
실험이 아니므로 이전 4/7·1/7·1/7과 비교해 인과적 개선율을 주장하지 않는다. 각 실패를
보존하고 같은 후보나 tail shape를 반복해 느린 결과를 교체하지 않았다.

Worker 누적 MLX peak는 **1,912.81 MiB**, RSS peak는 **1,273.81 MiB**이며 전체
VS Code memory가 아니다. Cached tokens·추가 활성 가중치는 0이었다. 모든 소유
모델/audit handle과 worker는 종료했다. 새 Python AST/Node 구문 검사, 모델 없는 hook
연결 확인, 위 수치 및 실제 요청 검증을 수행했다. 공개 runtime source는 변경하지 않아
앞선 package **87개 통과** 기록을 유지하며 전체 테스트를 반복하지 않았다. 실제 outer
Host·전체 scope/rich 및 3초 목표는 미완료이고 runtime/Default/QA 설치는 **0.0.1145**다.

### 같은 전체 작업을 읽는 0.6B 후보의 학습 전 준비

여러 1.7B 실행 비용 절감에도 전체 지연 실패가 남아, 같은 Qwen3 계열의 더 작은
후보 하나를 함수 설명용 합성 데이터로 학습할 준비를 했다. 이는 범용 모델·epoch·
prompt 설정을 순회하는 비교가 아니다. 원래 source/schema/설명 항목과 학습 설정은
유지하고 매 token의 모델 계산 및 가중치 traffic을 크게 줄일 수 있는지 확인할 후보다.
모델 크기만으로 정확도나 전체 3초를 입증하지 않는다.

[공식 Qwen3 0.6B MLX 4bit](https://huggingface.co/Qwen/Qwen3-0.6B-MLX-4bit/tree/173234aa840d113125e9f2271100ddbaf16c9620)의
revision은 `173234aa840d113125e9f2271100ddbaf16c9620`다. 가중치 파일은
**316,825,742 bytes**, SHA-256
`36162e7f72fe3eca308471e55161269e4605ab87d2666ae1f33ef800749c97dd`이며 다운로드 뒤
공식 LFS hash와 일치했다. Data 파일 8개만 받았고 다른 파일도 Git blob ID 또는 LFS
SHA-256으로 검증했다. 모델 구조는 hidden/intermediate **1,024/3,072**, 28 layers,
vocabulary 151,936, affine4bit/group128이다. 이는 inference peak memory가 아니다.

어휘·merges·tokenizer JSON은 기존과 byte 일치했지만 공식 `chat_template`는 달랐다.
공식 파일은 보존하고 별도 base 폴더에서 그 필드 하나만 기존 1.7B 양식으로 맞췄다.
가중치는 같은 저장 파일을 참조하며 복사하거나 requantize하지 않았다. 채팅 양식을
속도용으로 축소하지 않고 기존 전체 prompt를 그대로 유지하기 위한 호환 처리다.

`small-model06-tokenization-audit.json`은 실제 tokenizer와 native grammar로
**4,136건의 전체 prompt·completion·EOS token 배열이 기존과 정확히 같음**을 확인했다.
학습 3,256/검증 880, 최대 전체 길이 **3,326 tokens**, 할당 **3,584**로 원문·답변을
자르지 않는다. 236개 native schema에서 모든 label/EOS가 허용됐고 원래 Host/provider,
source disjointness 및 completion-through-EOS loss 검사도 유지했다. 공식 파일은 다시
hash해 변경되지 않았음을 확인했다.

학습 준비 코드는 기존 rank8/scale20/dropout0, 16 LoRA layers, Adam1e-4, seed42,
batch1의 **서로 다른 학습 3,256건 한 번**을 유지한다. Yielded row와 실제 완료 update를
구분해 기록하고 tool 종료 후 독립 검증해야 완전한 학습으로 인정한다. 이 단계의
다운로드/토큰 검사는 모델 설명 생성·품질·지연 증거가 아니며 기존 실패와 모든 scope/
lifecycle 완료 기준을 유지한다. 기본 모델·runtime·Default/QA 설치는 **0.0.1145**다.

### 0.6B 한 차례 학습 완료와 첫 전체 설명 측정

준비한 설정 그대로 서로 다른 **3,256건을 한 번** 학습했고 실제 tool이 정상 종료됐다.
종료 후 독립 검증에서 전체 index trace의 중복·누락이 없음을 확인했다. Kotlin/
TypeScript와 한국어/영어는 각각 1,628건이며, 원래 source·응답·completion-through-EOS
loss를 유지했다. 전체 학습 시간은 약 **101.4분**이다. 학습 중 누적 MLX peak
**11,185.19 MiB**는 일시적인 학습 비용이며 추론 memory로 사용하지 않는다.

새 어댑터를 별도 affine4bit/group128 모델로 병합했다. 모델 파일은 **316,825,700 bytes**
(약 **302.15 MiB**), SHA-256은
`92a3a9585dbb562df951797ad699dd302caaf328f2c7f09e19471d98f73f9bc1`다. 기존 공식 base와
1.7B 모델은 보존했다. 병합 후 저장된 실제 tokenizer로 **4,136건의 전체 prompt·응답·EOS
배열과 고정 일곱 IPC prompt의 모든 token**이 기존과 정확히 같음을 다시 확인했다.
원문이나 설명 항목을 줄여 얻은 작은 모델 결과가 아니다.

새 가중치에서 별도로 수행한 수치 검사는 **37개 전체 logit/활성 KV tensor 쌍**이 byte
일치했고 최대 차이는 0이었다. 원래 weight reference 복구와 control 해제 후 활성
memory는 **316,768,264 bytes**, 추가 활성 가중치는 0이었다. 이전 1.7B의 수치 검사를
새 모델의 증거로 재사용하지 않았다. 이후 모델 없는 pipe 검사는 **3,903건**의 전체
message/schema, 실제 새 worker 경로와 기존 Host fixture parser 연결을 확인했다.
Fixture 응답은 모델 설명 품질이나 지연 증거로 계산하지 않는다.

`small-model06-native-operation-4SGhif/report.json`은 기존 일곱 전체 입력을 각각 한 번씩
새로 생성한 결과다. Source-free 모델 준비 이후 `provider.generate`에서 shipped Host
parser 완료까지 측정했다. 다운로드·준비·FIFO 대기는 제외하며 전체 source 처리,
생성·decode·검증은 포함한다. 실제 outer VS Code Host의 전달 완료 측정은 아직 아니다.

| 0.6B 첫 측정 | 전체 설명 완료 | 의미 및 3초 |
| --- | --- | --- |
| TypeScript 한국어 누락 본문 | 3.326초 | 실패 |
| Kotlin 한국어 누락 본문 | 1.754초 | 통과 |
| TypeScript 한국어 지역 쓰기 | 1.925초 | 통과 |
| Kotlin 한국어 지역 쓰기 | 2.076초 | 통과 |
| Kotlin 한국어 감소 loop | 2.954초 | 통과 |
| TypeScript 영어 음수 guard | 3.768초 | 실패 |
| Kotlin 영어 복합 분기/catch/finally | 2.435초 | 통과 |

모든 원문, 실제 raw summary/flow/call 문장과 최종 다섯 상세를 직접 검토해 **의미 검토
7/7**을 확인했다. 누락 본문과 내부 호출의 unknown, 지역 계산·갱신, 반복 조건,
try/catch/finally와 정상 완료 조건을 유지했다. 기존 source fact 복원으로 채워지는
상세를 전부 모델 작성 문장으로 계산하지 않는다. 첫 측정의 전체 3초 통과는 **5/7**,
최대 **3,767.88825ms**여서 후보를 채택하지 않았다. 더 작은 모델에서도 이 고정 사례들의
설명은 유지됐지만, 이 결과가 범용 정확도나 모든 기능의 3초 완료를 보장하지 않는다.

Worker 누적 MLX peak는 **1,085.48 MiB**, RSS peak는 **724.77 MiB**다. 각각 source-free
준비를 포함하는 worker 누적 peak이며 전체 VS Code process tree의 memory가 아니다.
Cached tokens와 추가 활성 가중치는 0이었다. 서로 다른 출력·환경·순서를 통제한 비교가
아니므로 이전 모델 대비 인과적인 속도 개선율은 주장하지 않는다.

### 0.6B의 지연 두 건에 대한 관찰 전용 추적

실패한 TypeScript 한국어 누락 본문/영어 음수 guard만 같은 가중치·전체 입력·schema·
sampling으로 추적했다. 기존 SDK 연산에 monotonic clock과 scalar event 기록만 추가하고
tensor 평가·동기화를 추가하지 않았다. 실제 raw 및 최종 응답 byte는 두 건 모두 첫
0.6B 응답과 같았다. 추적 시간 **2,427.026209ms/1,569.001750ms**는 진단용 반복이며
첫 실패 시간 **3,325.876334ms/3,767.88825ms**를 교체하거나 새 coverage로 계산하지 않는다.

추적기가 기존 한국어 parser 인자를 영어 사례에도 넘긴 오류 한 건을 보존했다. 저장된
같은 전체 응답으로 한국어 검증의 오류를 재현하고 올바른 영어 검증을 수행해, 첫 측정의
모든 parsed field와 같음을 확인했다. 모델을 재요청하지 않았으며 이 영어 추적 시간을
성공한 Host 전달 시간으로 표현하지 않는다.

첫 추적의 prefill 평가 합계는 **396.55ms**, grammar token 읽기는 **632.27ms**, async
제출은 **879.18ms**였다. 영어 추적은 각각 **290.26ms/140.97ms/655.26ms**다. Grammar의
하위 span을 processor 합계에 다시 더하지 않는다. 이는 dependency 대기와 scheduling을
포함하는 CPU wall-clock 구간이므로 분리된 GPU 시간이나 최초 지연의 단일 원인으로
해석하지 않는다. 최초와 같은 크기의 지연이 재현되지 않았다는 사실만으로 준비 횟수나
모델·prompt·정밀도·학습 설정을 순회하지 않았다.

모든 학습·병합·audit·모델 tool과 소유 worker는 실제 종료했다. 전체 학습 trace/파일
무결성, 병합 후 tokenizer/native grammar, 새 가중치 수치/활성 memory, pipe wiring,
일곱 fresh 설명 및 수동 의미 검토, 관찰 전용 두 추적과 올바른 locale의 저장 응답 검증을
수행했다. 공개 runtime source를 바꾸지 않아 앞선 package **87개 통과** 기록을 유지하며
전체 테스트를 반복하지 않았다. 실제 outer Host·모든 scope·full-rich의 단계/값/최종 종합과
다운로드/lifecycle 검증은 미실행이다. 현재 private provider는 summary를 포함하는 call
작업에 한정되므로 detail-only와 non-call의 전체 wire 경로도 통합 전에 유지해야 한다.
Runtime·기본 모델·Default/QA 설치는 **0.0.1145**이며 3초 목표는 미완료다.

### 단일 native mask에서 동일한 정렬만 생략한 0.6B 후보

문법의 실제 전체 vocabulary mask가 token 하나만 허용하고, 기존 SDK가 계산한 해당
token의 정규화 log-probability가 정확히 0일 때 top-p/top-k의 결과는 입력과 같다. 새
private 경로는 이 조건에서만 정렬 filter를 생략한다. Mask는 읽기만 하고 certificate는
한 번만 소비한다. 조건에 맞지 않거나 certificate가 오래된 경우 원래 full-sort filter로
처리한다. 정규화 값은 실제 scalar read로 확인하므로 추가 동기화 비용도 측정에 포함한다.

모든 model/head/logsumexp 계산, 원래 전체 vocabulary categorical 연산과 RNG 호출은
유지한다. 확정 ID를 직접 응답하거나 모델 계산을 생략하는 경로가 아니다. 원래
temperature0.2/top-p0.95/top-k40, 전체 source/schema/설명 항목, prefill512 및 source-free
64+1 준비도 유지했다. 가중치·정밀도·학습·prompt 설정을 변경하지 않았다.

`small-model06-singleton-filter-parity.json`은 float32/bfloat16의 **184개 조건**을 검사했다.
160개 identity 조건과 24개 fallback 조건에서 **전체 filter 및 확률 tensor의 모든 byte,
선택 ID와 최종 RNG가 일치**했다. 양/음의 zero, 여러 vocabulary 위치·EOS, 정규화 전
서로 다른 유한 값, nonzero certificate 거부와 2/3/40/41개 허용 mask, certificate 재사용
거부를 포함했다. 이는 source-free 합성 확률 검사이며 새 설명이나 속도 증거가 아니다.

`small-model06-singleton-filter-Un8AZX/report.json`은 같은 0.6B 가중치와 기존 일곱 전체
입력으로 한 번씩 새로 생성했다. 원래 모델 호출과 one-token lookahead를 포함한 sampler
호출 수가 유지됐으며, 실제 identity filter 생략과 추가 scalar read는 각각 **306회**였다.
원래 0.6B의 raw wire와 전체 Host 응답이 **7/7 byte 일치**했고, 모든 source와
summary/flow/다섯 상세를 직접 다시 읽어 **의미 검토 7/7**을 확인했다.

| 단일 mask 정렬 생략 후보 | 전체 설명 완료 | 의미 및 3초 |
| --- | --- | --- |
| TypeScript 한국어 누락 본문 | 1.320초 | 통과 |
| Kotlin 한국어 누락 본문 | 4.212초 | 실패 |
| TypeScript 한국어 지역 쓰기 | 1.698초 | 통과 |
| Kotlin 한국어 지역 쓰기 | 2.060초 | 통과 |
| Kotlin 한국어 감소 loop | 5.689초 | 실패 |
| TypeScript 영어 음수 guard | 1.785초 | 통과 |
| Kotlin 영어 복합 분기/catch/finally | 1.925초 | 통과 |

전체 3초 통과는 **5/7**, 최대 **5,688.744ms**여서 채택하지 않았다. Kotlin 누락 본문은
prompt **175.18ms**/output **3,843.75ms**, 감소 loop는 **379.17ms/5,197.10ms**였다.
이 후보의 느린 두 건은 생성 단계에 시간이 집중됐다. 환경·순서를 통제한 paired 비교가
아니므로 정렬 생략의 인과적인 효과나 추가 scalar read가 지연 증가의 유일한 원인이라고
주장하지 않는다. 첫 0.6B 결과와 이 후보의 모든 실패를 각각 보존하며 재시도로 교체하지
않는다. 새 설명은 7개이고 새로운 독립 원문 coverage는 0개다.

Worker 누적 MLX peak는 **1,055.53 MiB**, RSS peak는 **710.06 MiB**이며 전체 VS Code
memory가 아니다. Cached tokens·추가 활성 가중치는 0이고, source-free 준비에서 새
sampler가 실행되지 않았음을 확인했다. 새 Python/Node 구문 검사, 전체 확률·ID·RNG
검사, 실제 request의 mask/sampler 연결 및 전체 응답 일치 검증과 수동 의미 검토를
수행했다. 모든 소유 수치 검사/model tool과 worker는 실제 종료했다. 공개 runtime은
변경하지 않았으며 기존 package **87개 통과** 기록을 유지한다. 실제 outer Host·전체
scope/full-rich·다운로드/lifecycle 및 3초 목표는 미완료이고 runtime/Default/QA 설치는
**0.0.1145**다.

### 0.6B의 호출 스레드 CPU와 Metal 구간을 함께 관찰

기존 단계 추적은 wall-clock만 기록해 실제 호출 스레드 CPU 작업과 다른 시간의 구분이
불가능했다. 새 private observer는 각 기존 span에 `time.thread_time_ns`를 추가하고,
기존 native Metal completion/QoS/kernel inventory 계측을 함께 사용했다. 원래 SDK의
yield scalar와 tensor 연산만 관찰하며 추가 tensor evaluation·GPU 명령·샘플링은 없다.
정책·command buffer 설정·가중치·원문·schema·출력 범위·원래 64+1 준비도 유지했다.

Python과 native host clock은 stream 시작 시 앞뒤 timestamp로 정렬하고 오차를 기록했다.
실제 오차 상한은 한국어 **0.000167ms**, 영어 **0.000500ms**였다. 겹치는 command buffer의
GPU elapsed interval은 합집합으로 계산한다. 호출 스레드 CPU는 다른 host thread의 CPU를
포함하지 않으며 wall minus CPU를 특정 대기 원인으로 단정하지 않는다. GPU elapsed
interval도 preemption을 포함할 수 있어 실제 점유율과 같지 않다.

`small-model06-combined-profile-mTg785/report.json`은 최초 0.6B에서 실패한 TypeScript
한국어 누락 본문과 영어 음수 guard를 **각각 한 번**, 같은 소유 worker에서 순서대로
추적했다. 두 응답의 전체 raw wire·전달된 설명·parsed field가 최초 결과와 byte 단위로
같았다. 모든 원문과 summary/flow/다섯 상세를 다시 읽었다. 영어는 올바른 영어 parser를
사용했다. 이전 단계 추적의 잘못된 한국어 parser 호출과 오류 기록은 그대로 보존했다.

| 관찰 전용 요청 | 전체 설명 | Stream wall | 호출 스레드 CPU | GPU interval 합집합 |
| --- | ---: | ---: | ---: | ---: |
| TypeScript 한국어 누락 본문 | 1,638.62ms | 1,605.18ms | 1,322.27ms | 1,048.91ms |
| TypeScript 영어 음수 guard | 4,232.66ms | 4,204.38ms | 1,329.35ms | 1,998.40ms |

CPU와 GPU는 겹쳐 실행되므로 위 열을 더하거나 빼서 전체 지연을 분해하지 않는다.
한국어의 기존 async dispatch span은 wall **879.95ms**, 호출 스레드 CPU **790.90ms**였다.
영어의 token-history grammar read는 wall **1,709.29ms**, 호출 스레드 CPU **40.23ms**이며
그 구간과 겹친 GPU interval 합집합은 **1,148.28ms**였다. 이 read는 processor 하위
span이므로 processor 합계에 다시 더하지 않는다. 영어의 가장 긴 후속 yield 구간은
**284.38ms**였지만 그 안의 관측 GPU 합집합은 **13.66ms**였다. 관측 GPU 실행만으로
설명되지 않는 긴 구간도 존재한다. 이를 다른 앱의 경쟁, 특정 kernel의 비용이나 scheduling
정책의 문제로 확정하지 않는다.

완료된 command buffer는 **2,995/1,881개**, 모두 requested QoS **33**이었다. Pending
callback과 record overflow는 0이다. 원래 응답을 먼저 flush한 뒤 callback 종료·record
복사·kernel 이름 수집에 **25.71/21.05ms**가 들었다. 기존 native callback 대기는 최대
1초이며 실제 GPU 동기화 명령을 추가하지 않는다. Parent는 응답 timer 밖에서 저장 완료
marker를 최대 5초 기다려 다음 요청과 종료가 sidecar 기록을 자르지 않게 했다. 계측과
응답 후 작업은 다음 요청의 scheduling에도 영향을 줄 수 있다.

실행 전 합집합·시계 정렬·잘못된 record 거부의 CPU-only **10개 검사**, Python 구문과
실제 thread-clock span 검사를 통과했다. 이 두 fresh 설명은 진단용 반복이며 **새 독립
원문 coverage 0개**이고 3초 성공 증거가 아니다. Report SHA-256은
`eaaa8a4db63be6691b2d93087ac1117b9c9c154964379883feacd866f0eecb61`, 수동 검토 기록은
`small-model06-combined-profile-review.json`에 있다. 모든 소유 tool/worker는 실제 종료했다.

### Q/K 정규화·위치 변환을 한 커널로 묶은 0.6B 후보

반복되는 Q/K RMSNorm 두 번과 RoPE 두 번을 한 single-row 커널로 묶는 private 후보를
구현했다. 계산은 고정된 MLX 0.32.3의
[RMSNorm](https://github.com/ml-explore/mlx/blob/v0.32.3/mlx/backend/metal/kernels/rms_norm.metal)과
[RoPE](https://github.com/ml-explore/mlx/blob/v0.32.3/mlx/backend/metal/kernels/rope.metal)를
따랐다. RMSNorm의 float32 reduction 뒤 bfloat16 변환, bfloat16 weight 곱과 두 번째
반올림, 그 결과를 float32로 읽는 RoPE 순서를 보존했다. 128-wide head의 32-lane SIMD와
lane당 4개 reduction, precise rsqrt·fast sin/cos를 유지했다. Safe math mode는 stock
[kernel build의 `-fno-fast-math`](https://github.com/ml-explore/mlx/blob/v0.32.3/mlx/backend/metal/kernels/CMakeLists.txt)에 맞췄다.
정밀도·학습·모델·prompt·샘플링·buffer/QoS 설정을 순회하지 않았다.

Batch/sequence가 각각 1일 때만 융합하고 모든 multi-row/batch는 원래 attention으로
처리한다. 원래 projection·SDPA·SDK cache 쓰기·head·logsumexp·전체 vocabulary
categorical/RNG 호출은 유지했다. 원래 packed-weight release 뒤 같은 tensor 참조에
wrapper를 붙이며 가중치를 복제하지 않는다. Readiness는 기존 source-free 64+1과
두 dtype filter 준비 그대로다. 소스에 의존하는 추가 준비나 응답/KV cache는 없다.

첫 source-free numeric audit는 학습된 28개 layer의 Q/K norm weight와 zero/작은 값/큰 값,
offset 0/1/63/64/1023/2048/8191의 **252쌍**, 전체 model logits와 모든 활성 SDK KV의
**37쌍**에서 byte 일치·최대 차이 0을 기록했다. 이후 전체 active-memory assertion에서
**exit 1**로 끝났다. 비교 기준은 합성 RNG 입력을 만들기 전이었고, assertion 당시 값은
기록하지 않아 최초 차이를 사후에 특정하지 않는다. 이 실패를 정상 종료로 바꾸지 않았다.

별도 allocation 진단에서는 융합 전·후, 원래 모듈 복원, 양쪽 원래 64+1 준비 후 모두
**316,768,264 bytes**로 같았다. 첫 allocation 진단은 이후 지원하지 않는
`mx.random.state` item assignment 때문에 **exit 1**이었다. Public `seed()`로 수정한
진단도 모든 관측을 기록한 뒤, 이미 baseline에 있던 seed key를 다시 추가로 계산한
잘못된 assertion 때문에 **exit 1**이었다. 두 실패는 helper의 오류이며 그대로 보존했다.

마지막 저장 관측에서 seed→seed는 active memory 차이 **0 bytes**, 합성 입력을 만든 뒤
폐기하면 **+8 bytes**, 다시 public seed로 바꾸면 **0 bytes**였다. RNG의 logical 8-byte
view와 두 key의 16-byte split storage를 구분해야 한다. 첫 allocation 진단은 이전 key
참조까지 보유해 +16 bytes를 기록했다. 원래 RNG 참조 복원에 성공했다고 주장하지 않는다.

`small-model06-qk-numeric-review.json`은 GPU를 다시 실행하지 않고 고정된 component/hash와
저장된 252+37개 전체 byte 비교, 원래/융합 readiness의 추가 가중치 **0 bytes**를 검토했다.
이 완전한 핵심 관측으로 한 번의 full-source 후보 실행만 진행했다. 실패한 부수 assertion
세 개나 audit suite 전체가 통과했다고 간주하지 않는다. 검토 SHA-256은
`fd9dcc922922f86bfd5d8e88f6bc93457349251b186cf719579452ff2bcc5328`이다.

`small-model06-qk-norm-rope-od2lkl/report.json`은 원래 일곱 전체 입력으로 각각 한 번씩
새 설명을 생성했다. 원래 0.6B의 전체 raw wire·Host 전달 응답·parsed field가 **7/7 byte
일치**했고, 모든 원문과 summary/flow/다섯 상세를 직접 다시 읽어 **의미 검토 7/7**을
확인했다. Source-limited/dispatch/실제 완료의 미확인, 쓰기와 loop의 순서, catch/finally
및 미구현 내부 호출을 유지했다. 실제 outer Host 전달을 측정한 결과는 아니다.

| Q/K 융합 후보 | 전체 설명 완료 | 의미 및 3초 |
| --- | ---: | --- |
| TypeScript 한국어 누락 본문 | 5.566초 | 실패 |
| Kotlin 한국어 누락 본문 | 3.313초 | 실패 |
| TypeScript 한국어 지역 쓰기 | 4.559초 | 실패 |
| Kotlin 한국어 지역 쓰기 | 7.764초 | 실패 |
| Kotlin 한국어 감소 loop | 7.090초 | 실패 |
| TypeScript 영어 음수 guard | 1.751초 | 통과 |
| Kotlin 영어 복합 분기/catch/finally | 5.546초 | 실패 |

전체 3초 통과는 **1/7**, 최대 **7,763.656416ms**여서 채택하지 않았다. 실제 fused
attention 호출은 **44,660회**, 원래 multi-row fallback 호출은 **952회**였다. 원래
one-token lookahead까지 포함해 예상 호출 수와 일치했고 source-free 64+1 준비의
fused/fallback 각 28회도 확인했다. Runtime/연결 실패는 0개다. 이 호출 수는 관측 scalar
counter이며 개별 kernel의 GPU 시간이나 전체 속도 개선을 입증하지 않는다.

Kotlin 지역 쓰기의 prompt/output은 **515.52ms/7,076.15ms**, 감소 loop는
**1,679.85ms/5,052.33ms**였다. 서로 다른 시점의 unpaired 실행이므로 이 후보가 지연을
증가시킨 단일 원인이나 인과적인 속도 개선율을 단정하지 않는다. 모든 기존 실패와 이번
실패를 각각 유지한다. 같은 후보를 재시도하거나 kernel/정밀도/준비 설정을 순회하지 않았다.
새 전체 설명은 7개이고 새 독립 원문 coverage는 0개다.

Worker 누적 peak MLX는 **1,005.40 MiB**, RSS는 **709.28 MiB**이며 원래 readiness를
포함하고 전체 VS Code memory가 아니다. 수치·메모리 진단과 full-source 생성 tool/worker는
모두 실제 종료했다. Report SHA-256은
`f3406ec2b03fc15909430fa2c77fb3106574cefad8ec925de3d9c995715ea4b5`, 수동 검토는
`small-model06-qk-candidate-manual-review.json`이다. 공개 runtime은 바꾸지 않아 앞선
package **87개 통과** 기록을 유지하고 전체 package 검사를 반복하지 않았다. 실제 outer
Host·전체 scope/full-rich·다운로드/lifecycle·3초 목표는 미완료다. Runtime·Default/QA
설치는 **0.0.1145**를 유지했다.

### 실패한 Q/K 후보의 CPU와 Metal 구간 추적

같은 Q/K 후보의 TypeScript 한국어 누락 본문과 Kotlin 한국어 지역 쓰기 요청 두 개만
추적했다. 이전에 실패한 후보의 시간 기록은 교체하지 않는다. 원래의 calling-thread CPU
clock과 passive Metal observer에 Q/K 함수 전체 및 custom-kernel graph builder의
nested span을 추가했다. Tensor 평가·복사·동기화, GPU 작업, prompt나 sampling은 추가하지
않았다. CPU-only forwarding/예외 전달 **4개 검사**, JavaScript/Python 구문을 확인한 뒤
한 worker에서 두 새 설명을 생성했고 실제 tool/worker 종료를 확인했다.

| 관측 항목 | TS 한국어 누락 본문 | Kotlin 한국어 지역 쓰기 |
| --- | ---: | ---: |
| 전체 설명 | 3,855.99ms | 1,678.88ms |
| Stream wall | 3,817.95ms | 1,411.43ms |
| Stream calling-thread CPU | 1,412.39ms | 955.50ms |
| 관측 GPU interval 합집합 | 3,345.63ms | 1,166.27ms |
| Prefill 평가 wall / CPU | 1,519.69 / 191.06ms | 240.96 / 134.61ms |
| Model graph wall / CPU | 368.87 / 348.08ms | 245.01 / 240.22ms |
| Q/K 함수 wall / CPU | 85.03 / 77.39ms | 54.83 / 51.21ms |
| 내부 custom graph wall / CPU | 40.81 / 36.13ms | 26.82 / 24.22ms |
| Async dispatch wall / CPU | 760.32 / 708.37ms | 481.50 / 470.12ms |
| Grammar token read wall / CPU | 1,023.06 / 29.92ms | 345.34 / 16.53ms |

Q/K 함수와 내부 custom graph는 model graph 안의 nested span이므로 합산하지 않는다.
관측 CPU는 해당 호출 thread에 한정되고, GPU elapsed에는 preemption이 포함될 수 있다.
서로 겹치는 CPU/GPU 구간을 더하거나 GPU interval을 실제 점유율로 해석하지 않는다.
계측이 없는 일곱 실패 기록의 지연 원인을 이 두 관측만으로 확정하지 않는다.

Custom kernel은 각각 **6,860/6,412회**로 예상 호출 수 모두를 관측했다. 같은 trace의
`gg2_copybfloat16bfloat16`는 **14,224/13,608회**였다. 이 inventory는 복사 경로를 조사할
근거이며 각 copy의 호출 원인이나 개별 GPU 시간을 입증하지 않는다. 설치된 고정 SDK의
`mlx_lm/models/cache.py`를 직접 확인하면 stock KVCache는 K와 V를 별도 storage에 각각
slice update한다. 다음 후보는 이 두 쓰기를 합치는 구현으로 한정했다.

두 raw wire·Host 전달 응답·모든 parsed field는 실패한 Q/K 후보와 일치했다. 전체
원문과 다섯 상세를 다시 읽었으며 누락 구현의 미확인과 지역 갱신 순서를 유지했다.
응답 후 native collection은 **12.66/11.92ms**, clock alignment 불확실성은
**0.000292/0.0003335ms**였다. 계측·sidecar 수집은 scheduling에 영향을 줄 수 있으므로
두 요청 모두 **진단용 반복, 새 독립 원문 coverage 0개, 성능 통과 증거 아님**으로 남겼다.

Report `small-model06-qk-combined-profile-8Plt4I/report.json` SHA-256은
`ed872ea30d889061ecdc5cfc2462f29882ab959d3392ce9668069a03603f9e2e`, 전체 검토 기록은
`small-model06-qk-combined-profile-review.json`이다. 이전 Q/K 일곱 요청의 **의미 및 3초
통과 1/7** 결과는 그대로다. 준비 중 문자열 치환 개수 assertion 하나는 모델 실행 전에 실패했고,
아직 공개하지 않은 generator의 치환 범위를 수정한 뒤에만 artifacts를 봉인했다.

### K/V 캐시 쓰기를 통합한 0.6B 후보

Private `fused_qk_packed_kv.py`는 봉인된 Q/K kernel의 계산 순서를 그대로 두고 V를 계산
없이 K 옆에 복사한다. Leading K/V 축 하나를 가진 cache storage를 사용해 single-row
attention마다 cache slice update를 한 번 수행한다. SDK가 지원하는 model cache factory를
통해 설치하며 원래 **256-row 증설**, 활성 K/V shape·dtype·값, mask와 trim을 유지한다.
Multi-row/batch attention은 원래 계산을 사용하고 해당 cache 입력만 K/V 축으로 모은다.
원래 projection·SDPA·head·전체 vocabulary sampling·RNG·grammar는 유지했다.

새 수치 검증은 **실제 exit 0**으로 끝났다. 앞선 Q/K 보조 audit의 exit 1 세 개를
바꾸거나 그 실패 suite를 통과로 간주하지 않는다.

- 28개 learned norm weight와 경계 값, 일곱 offset의 **Q/K/V 252쌍**이 전부 byte 일치했다.
  V의 signed zero까지 원본과 비교했다.
- Batch 1/2에서 **cache 쓰기·확장·trim 후 재쓰기 52쌍**의 모든 활성 K/V byte와
  offset·할당 capacity bytes가 원래 SDK cache와 같았다.
- 원래 단일/다중 row, batch 1/2, 분할 prefill과 decode의 **전체 모델 37쌍**에서 모든
  raw logit와 28개 layer의 활성 K/V byte가 일치했고 최대 차이는 0이었다.
- 원래 source-free 64+1 준비 뒤, wrapper 부착, 후보의 같은 64+1 입력 뒤, 원래 모듈과
  cache factory 복원 뒤 active memory는 모두 **316,768,264 bytes**였다. 추가 가중치는
  **0 bytes**이고 readiness의 RNG는 같았다. 이 상주 검사는 합성 RNG 입력 생성 전에
  별도로 끝내 이전 helper의 잘못된 메모리 기준을 반복하지 않았다.

수치 report `small-model06-packed-kv-parity.json` SHA-256은
`16c1e56ecbc20a7ffbe7a35d8b1279014f3ad6dfaa2cfe944f28c16383a3c90b`다. 이후 새 후보로
원래 일곱 전체 입력을 **한 번씩** 실행했다. 모델·학습·prompt·출력 항목·precision·
sampling·buffer/QoS·준비 입력을 순회하지 않았고 실패 요청을 재시도하지 않았다.

| K/V 쓰기 통합 후보 | 전체 설명 완료 | 의미 및 3초 |
| --- | ---: | --- |
| TypeScript 한국어 누락 본문 | 1.141초 | 통과 |
| Kotlin 한국어 누락 본문 | 2.829초 | 통과 |
| TypeScript 한국어 지역 쓰기 | 2.045초 | 통과 |
| Kotlin 한국어 지역 쓰기 | 3.138초 | 실패 |
| Kotlin 한국어 감소 loop | 1.521초 | 통과 |
| TypeScript 영어 음수 guard | 0.929초 | 통과 |
| Kotlin 영어 복합 분기/catch/finally | 2.636초 | 통과 |

전체 raw wire·Host 전달 응답·parsed field는 원래 0.6B 응답과 **7/7 byte 일치**했다.
원문, summary/flow, 호출의 role/inputs/output/effects/reason을 모두 다시 읽어 의미 검토
**7/7**을 확인했다. 모델 prose와 정적 syntax 소유 필드를 구분하고 누락 구현·실제 완료의
미확인, 쓰기·반복 순서, 분기 반환·catch·finally를 유지했다. Runtime/연결 실패는 0개다.

그러나 의미와 전체 3초의 동시 통과는 **6/7**, 최대 **3,137.597833ms**다. 137.60ms의
초과도 실패로 남기며 후보를 채택하지 않았다. Fused attention **44,660회**, 원래
multi-row fallback **952회**, 원래 source-free 64+1 입력의 fused/fallback 각 **28회**를
확인했다. 이는 scalar 호출 수이며 실제 GPU dispatch 감소량이나 인과적인 속도 개선율을
입증하지 않는다. 서로 다른 시점의 실행 결과를 직접적인 개선율로 비교하지 않는다.

Worker 누적 peak MLX는 **1,207.46 MiB**, RSS는 **712.16 MiB**다. 상주 가중치 동등성과
전체 생성 peak memory는 다른 관측이며 이번 후보의 peak 감소는 입증되지 않았다.
원래 준비를 포함한 worker 관측이고 전체 VS Code 메모리가 아니다.

Report `small-model06-packed-kv-VIGQFz/report.json` SHA-256은
`b7cd1da95b83b27b5bb9c8471500fa7705c5e44300a3dfe9a55f7f10ed8d3d17`, 수동 검토 기록은
`small-model06-packed-kv-candidate-manual-review.json`이다. 모든 소유 model/audit tool과
worker는 실제 종료했다. 이번 새 전체 설명은 **9개**(Q/K 진단 2개와 새 후보 7개)이며
새 독립 원문 coverage는 **0개**다. 독립 holdout·실제 outer Host·전체 scope/full-rich·
다운로드/lifecycle gate는 열지 않았다. 공개 runtime·package·Default/QA 설치는
**0.0.1145**로 유지하며, 공개 runtime 변경이 없어 앞선 package 87개 통과 검사를
반복하지 않았다. 3초 목표는 미완료다.

### K/V 통합 후보의 생성 지연과 prefill peak 추적

앞선 K/V 통합 후보에서 실패한 Kotlin 한국어 지역 쓰기 요청 하나를 진단했다. 이전의
**의미 및 3초 통과 6/7** 기록을 유지한다. Source·전체 출력·준비·sampling은 유지하고,
기존 passive CPU/Metal observer에 cache 조립·쓰기의 nested span과 MLX 메모리 counter
읽기를 추가했다. Counter는 getter 세 개만 읽고 tensor 평가·동기화·보관이나 allocator
설정·peak reset을 수행하지 않는다. CPU-only counter/forwarding/예외 전달 **12개 검사**와
JavaScript/Python 구문을 확인한 뒤 새 설명 한 개를 생성했다.

전체 설명은 **3,249.86375ms**, stream wall은 **2,982.56ms**, calling-thread CPU는
**1,234.56ms**, 관측 GPU interval 합집합은 **2,483.11ms**였다. Grammar token read는
wall **1,350.23ms**, 해당 thread CPU **25.44ms**, GPU overlap **1,298.21ms**로 관측됐다.
이 wall 구간을 grammar CPU 비용으로 해석하지 않는다. Model graph의 wall/CPU는
**341.87/310.67ms**, async dispatch는 **744.70/609.61ms**, prefill 평가는
**409.76/166.59ms**였다. Nested span과 겹치는 GPU 구간을 합산하지 않는다.

관측 command buffer는 **2,367개**, kernel dispatch는 **99,062개**였다. Inventory에서
`rmsbfloat16` **13,713회**, `vv_Addbfloat16` **12,824회**, `gg2_copybfloat16bfloat16`
**6,888회**를 확인했다. Dispatch metadata overflow **3,211회**도 보존했다. 이 호출 수는
개별 kernel 시간이나 지연 원인, GPU 점유율을 입증하지 않는다. GPU elapsed에는
preemption이 포함될 수 있으며 외부 앱이나 priority의 영향은 확인하지 않았다.

메모리 counter **935개 지점**의 읽기 bracket 합계는 **0.804256ms**였다. 누적 peak의
최댓값 **1,394,585,466 bytes(1,329.98 MiB)**를 마지막 `prefill_after_eval`에서 처음
관측했고 이후 decode 종료까지 증가하지 않았다. 관측 active 최댓값은
**724,020,894 bytes(690.48 MiB)**였다. Counter는 그 시점의 전역 값이며 개별 연산의
할당량이나 peak 발생 원인을 확정하지 않는다. 원래 readiness도 누적 peak에 포함된다.

Raw wire·전달 응답·parsed field는 앞선 같은 요청과 일치했다. 전체 원문과 모든 설명을
읽어 곱셈 초기화→감소→반환, 정상 완료 조건의 부모 반환을 확인했다. 실제 tool은 exit 0으로
끝났고 worker도 종료했다. 이 요청은 **진단용 반복, 새 독립 원문 coverage 0개, 성능 통과
증거 아님**이다. Report `small-model06-packed-profile-dJn6pg/report.json` SHA-256은
`2fa229759b474efc6bcdbc9add3c047896567884304482e6ce52c1709592c4dd`, 검토 기록은
`small-model06-packed-profile-review.json`이다. 반복되는 잔차 덧셈과 RMS 정규화를 다음
구현 대상으로 정했으며 이 변경으로 prefill peak가 감소한다고 주장하지 않는다.

### 잔차 덧셈과 post-attention RMS 정규화 통합 후보

Private `fused_residual_norm.py`는 앞선 Q/K·K/V 통합을 유지하고 single-row block의
`h = x + attention`과 이어지는 post-attention RMSNorm을 한 kernel로 처리한다. 원래
중간 `bfloat16` 반올림과 RMSNorm의 **256 thread·thread당 네 값** reduction 순서를
보존한다. 이후 MLP가 사용할 normalized 값과 마지막 잔차 덧셈에 필요한 원래 `h`를
함께 반환한다. Input norm·MLP·마지막 잔차 덧셈·projection·SDPA·head·전체 vocabulary
sampler·grammar는 유지한다. Multi-row/batch와 source prefill은 원래 block 계산이다.
원래 block·attention·cache factory를 복원할 수 있고 추가 가중치를 만들지 않는다.

새 수치 audit은 **실제 exit 0**으로 종료했다. 28개 learned weight와 signed zero,
상쇄·작은 값·큰 값·반올림 경계를 포함한 **잔차/정규화 336쌍**이 byte 일치했다.
**전체 모델 37쌍**의 모든 raw logit와 28개 layer의 활성 K/V byte 및 할당 capacity도
일치했고 최대 차이는 0이었다. 변경하지 않은 앞선 cache 검사 52개는 참조만 하며 다시
실행하거나 새 검사 수에 넣지 않았다. 원래 준비 뒤·부착·같은 준비 입력 뒤·복원 뒤
active memory는 모두 **316,768,264 bytes**, 추가 가중치는 **0 bytes**, readiness RNG는
동일했다. Report `small-model06-residual-norm-parity.json` SHA-256은
`292395044c97964b84c0652dfbbe7f128a0df1ab05661131344c3f771406e24c`다.

같은 일곱 원문을 새 후보로 **한 번씩** 실행했다. 모델·가중치·prompt·출력 항목·precision·
sampling·buffer/QoS·source-free 64+1 준비 입력을 유지하고 실패 요청을 재시도하지 않았다.

| 잔차/RMSNorm 통합 후보 | 전체 설명 완료 | 의미 및 3초 |
| --- | ---: | --- |
| TypeScript 한국어 누락 본문 | 3.106초 | 실패 |
| Kotlin 한국어 누락 본문 | 3.344초 | 실패 |
| TypeScript 한국어 지역 쓰기 | 3.563초 | 실패 |
| Kotlin 한국어 지역 쓰기 | 7.020초 | 실패 |
| Kotlin 한국어 감소 loop | 3.355초 | 실패 |
| TypeScript 영어 음수 guard | 2.511초 | 통과 |
| Kotlin 영어 복합 분기/catch/finally | 2.238초 | 통과 |

전체 원문·raw wire·전달 응답·parsed field는 원래 0.6B 결과와 **7/7 일치**했다.
Summary/flow와 role/inputs/output/effects/reason을 전부 읽어 **의미 7/7**을 확인했다.
누락 구현의 미확인, 지역 갱신·반복 순서, 두 분기 반환, catch·finally와 정상 완료 조건을
유지했다. 모델 prose와 정적 syntax 소유 필드를 구분한다. 연결/runtime 실패는 0개다.
그러나 의미와 전체 3초의 동시 통과는 **2/7**, 최대 **7,020.236583ms**여서 채택하지
않았다. 서로 다른 시점의 실행으로 인과적인 속도 개선이나 저하를 단정하지 않는다.

Fused attention/잔차 정규화는 각각 **44,660회**, multi-row fallback은 각각 **952회**로
예상 호출 수와 일치했다. 같은 source-free 준비에서도 네 counter가 각각 28회였다.
Worker 누적 peak MLX는 **1,215.40 MiB**, RSS는 **705.66 MiB**이며 readiness를 포함한다.
전체 VS Code 메모리나 prefill peak 감소를 입증하는 값이 아니다.

Report `small-model06-residual-norm-mt21YA/report.json` SHA-256은
`ff305e5dcd7723d709a7e3b9b277d043491a084a3b582306c64aae48c829d1ce`, 수동 검토는
`small-model06-residual-pilot-manual-review.json`이다. 마지막 tool 출력이 유실돼 pilot
종료 코드는 **미관측(null)**으로 기록했다. 같은 handle 재조회가 closed/unknown을 반환했고,
driver PID 부재·dispose 후 기록된 worker 종료 marker·완성된 일곱 응답을 독립 확인했다.
종료 코드 0을 추정하거나 모델을 재실행하지 않았다. 복구 receipt는
`small-model06-residual-terminal-recovery.json`이다. 소유 model/audit handle과 worker는
모두 종료했고 새 전체 설명은 **8개**(진단 1개·새 후보 7개), 새 독립 원문 coverage는
**0개**다. 독립 holdout·outer Host·전체 scope/full-rich·다운로드/lifecycle gate는 아직
열지 않았다. 공개 runtime·package·Default/QA 설치는 **0.0.1145**를 유지하며, 공개 runtime
변경이 없어 앞선 package 87개 통과 검사를 반복하지 않았다. 3초 목표는 미완료다.

### 직전 token의 CPU 읽기보다 먼저 model graph 보내기

앞선 trace에서 grammar token read의 wall **1,350.23ms** 중 해당 thread CPU는
**25.44ms**였다. 고정 SDK는 다음 model graph를 만든 후 직전 sampled token을 CPU로
읽고 grammar mask를 작성한 뒤, 다음 sample의 전체 graph를 enqueue한다. 새 private
`early_forward_dispatch.py`와 파생 worker는 **CPU token 읽기 전에 기존 마지막 행의
raw logits를 `mx.async_eval`로 제출**한다. 모델 계산이 직전 token에 의존하는 관계는
그대로이며 CPU와 GPU의 실행 순서만 바꾼다. 앞서 실패한 overlap은 token 읽기 **이후**에
제출했으므로 이번 경로와 다르다.

앞선 Q/K·K/V 통합 경로는 유지하고 잔차/RMSNorm 후보는 포함하지 않았다. 기존 모델·head·
전체 vocabulary sampler의 계산을 생략하지 않는다. 원문·prompt·schema·출력 항목·
sampling·precision·buffer/QoS·source-free 64+1 준비 입력을 유지했다. Grammar마다
scalar 제출 수만 보관하고 tensor를 추가로 유지하지 않는다. 파생 worker의 실제 Grammar
class를 추출해 최초 호출·decode·EOS와 enqueue/consume/mask 오류 전달을 확인하는
**CPU-only 7개 검사**가 통과했다. 모델이나 MLX를 import하는 검사가 아니다.

새 수치 audit은 **실제 exit 0**으로 종료했다. 단일/다중 행·batch 1/2·분할 prefill과
decode의 **전체 모델 37쌍**에서 모든 raw logit·28개 layer의 활성 K/V byte·offset·
할당 capacity가 일치했다. 각 쌍의 첫 batch 행에서 **151,936개 전체 확률**, 선택 token과
원래 categorical RNG 상태도 일치했다. 같은 sampler에 source-free sparse mask를 쓴
수치 비교이며 실제 요청의 모든 sampler step을 기록한 검사는 아니다. 변경하지 않은 앞선
Q/K/V 252쌍과 cache 52쌍은 참조만 하고 새 검사 수에 넣지 않았다. 원래 준비 뒤·부착·
같은 준비 입력 뒤·복원 뒤 active memory는 모두 **316,768,264 bytes**, 추가 가중치는
**0 bytes**, readiness RNG는 같았다. 수치 report `small-model06-early-forward-parity.json`
SHA-256은 `ec3ba3e6c0ba209a88beb5a1f0928802c2d5207520f61759bd3cc19756bb5bcd`다.

같은 일곱 전체 원문을 새 경로로 **한 번씩** 실행했다. 모델·prompt·설정 순회나 실패 요청
재시도는 하지 않았다. Source-free 준비 완료 뒤 요청부터 shipped Host parser의 전체
응답 처리 완료까지 잰 결과다.

| CPU token 읽기 전 제출 후보 | 전체 설명 완료 | 의미 및 3초 |
| --- | ---: | --- |
| TypeScript 한국어 누락 본문 | 4.158초 | 실패 |
| Kotlin 한국어 누락 본문 | 1.641초 | 통과 |
| TypeScript 한국어 지역 쓰기 | 1.683초 | 통과 |
| Kotlin 한국어 지역 쓰기 | 5.510초 | 실패 |
| Kotlin 한국어 감소 loop | 1.836초 | 통과 |
| TypeScript 영어 음수 guard | 0.970초 | 통과 |
| Kotlin 영어 복합 분기/catch/finally | 1.885초 | 통과 |

원문·raw wire·전달 응답·parsed field는 원래 0.6B 결과와 **7/7 일치**했다. 전체 원문과
summary/flow 및 호출의 다섯 상세를 모두 다시 읽어 의미 **7/7**을 확인했다. 누락 구현과
실제 완료의 미확인, 지역 갱신·loop·분기 반환·catch·finally를 유지했다. 연결/runtime
실패는 0개다. 의미와 전체 3초 동시 통과는 **5/7**, 최대 **5,510.413291ms**여서
채택하지 않았다. 이전 후보의 실패를 교체하지 않으며 unpaired 시간 차이로 인과적인 개선율을
단정하지 않는다.

실제 CPU 읽기 전 제출은 **1,595회**로 각 요청의 원래 one-token lookahead를 포함한
예상 step 수와 같았다. 원래 준비에는 추가 제출이 0회였으며 fused attention
**44,660회**, multi-row fallback **952회**도 유지했다. Worker 누적 peak MLX는
**1,171.49 MiB**, RSS는 **706.41 MiB**이며 readiness를 포함한다. Peak 감소나 전체
VS Code 메모리를 입증하는 비교가 아니다.

Report `small-model06-early-forward-fIfSBi/report.json` SHA-256은
`9d2935231cbcf83d8c0c1ae603c8d6b688e9388fc5116f4b3e8390ddc4da4778`, 전체 검토는
`small-model06-early-forward-pilot-manual-review.json`이다. 수치 audit·pilot 모두 실제
exit 0으로 종료했고 소유 worker도 종료했다. 새 전체 설명은 **7개**, 새 독립 원문 coverage는
**0개**다. 독립 holdout·outer Host·전체 scope/full-rich·다운로드/lifecycle gate는 열지
않았다. 공개 runtime·package·Default/QA 설치는 **0.0.1145**를 유지한다. 공개 runtime
변경이 없어 앞선 package 87개 통과 검사는 반복하지 않았다. 3초 목표는 미완료다.

### 고정 single-row MLP graph 컴파일과 생성 stream 정렬

앞선 profile에서 반복되는 Python model graph 작성이 확인됐다. 기존 `PackedMLP`는
gate/up projection·split·SwiGLU·down projection을 매 token마다 연결한다. Private
`compiled_single_row_mlp.py`는 **(1, 1, 1024) bfloat16 입력**에 한해 같은 계산을 고정
graph로 컴파일한다. 여섯 quantized weight/scales/bias 배열을 명시적 입력으로 전달하며
원래 배열을 복사하거나 상수로 캡처하지 않는다. 원래 SwiGLU·4bit/group128 matmul과
중간 반올림을 유지한다. Multi-row/batch와 다른 dtype은 실제 원래 MLP로 처리한다.
앞선 Q/K·공유 K/V 경로는 유지하고 잔차/RMSNorm·early-forward 후보는 포함하지 않는다.
함수 소스·prompt·출력 항목·모델 가중치·sampler·precision·buffer/QoS는 유지했다.

가중치 배열의 동일 참조·fallback·오류 전달을 확인하는 **CPU-only 8개 검사**가 통과했다.
첫 수치 audit에서 28개 MLP와 signed zero·작은 값·큰 값·반올림 경계 등 **출력 336쌍**,
**전체 모델 37쌍**의 모든 raw logit·활성 K/V byte·offset·할당 capacity가 일치했다.
원래 준비 뒤·부착·같은 준비 입력 뒤·복원 뒤 active memory는 모두
**316,768,264 bytes**, 추가 가중치는 **0 bytes**, readiness RNG는 같았다. Report
`small-model06-compiled-mlp-parity.json` SHA-256은
`1435ca4730a11ad1d7162b4df53b6f24e5d4c389a9a34969687385eee5809812`다.
최종 tool 출력이 유실돼 수치 audit 종료 코드는 **미관측(null)**이다. 같은 handle의
closed/unknown·해당 프로세스 부재·완성된 수치 증거를 독립 확인했고 종료 코드 0을
추정하지 않았다. 복구 기록은 `small-model06-compiled-mlp-numeric-terminal-recovery.json`이다.

첫 실제 요청인 TypeScript 한국어 누락 본문은 **1,166.642292ms**에 끝났고 원문·raw wire·
전달 응답·parsed field는 기존 결과와 같았다. 전체 설명을 읽어 의미는 확인했지만 준비
직후 compile trace **1회**가 실제 생성 후 **2회**로 늘어 실행 검증에 실패했다.
`small-model06-compiled-mlp-G1d86o`의 첫 응답과 **실제 exit 1**을 보존하고 나머지 여섯
요청을 실행하지 않았다. 이 빠른 실패 응답을 3초 통과로 인정하지 않는다. 수동 검토
`small-model06-compiled-mlp-failure-review.json`은 의미 1개·채택 가능한 시간 통과 0개다.

원인은 준비와 생성의 실행 맥락 차이다. 설치된 SDK는 `generation_stream`에서 생성하지만
원래 worker의 source-free 준비는 그 stream 밖에서 실행했다. MLX 0.32.3의 compile
cache는 입력 shape/dtype 외에 현재 stream도 구분한다.
[MLX compile cache 구현](https://github.com/ml-explore/mlx/blob/v0.32.3/mlx/compile.cpp)
이에 파생 `mlx-production-worker-generation-ready.py`는 **원래 EOS 64+1 준비의 다섯
문장만 기존 SDK 생성 stream 안에서 실행**한다. 새 모델 호출·입력·dtype 준비를 추가하지
않는다. 실제 파생 worker의 준비 AST를 추출해 동일 입력·순서·stream 복원·오류 전달을
검사한 **CPU-only 7개 검사**가 통과했다. 최초 실패는 이 수정으로 덮어쓰지 않는다.

생성 stream에서 새로 비교한 **MLP 336쌍·전체 모델/KV 37쌍**도 byte 일치했고 최대
차이는 0이었다. 준비 뒤와 audit 종료의 compile trace는 모두 **1회**이며 동일 active
memory·RNG를 유지했다. 변경하지 않은 앞선 cache 검사 52개는 참조만 하고 새 검사 수에
넣지 않았다. 이 수치 audit은 **실제 exit 0**으로 종료했다. Report
`small-model06-compiled-mlp-generation-stream-parity.json` SHA-256은
`5743248eef3f077e20ac69702a9d4cb495cc0127802115ba3ea1e6d80f187cff`다.

수정한 실행 경로에서 같은 일곱 전체 원문을 **한 번씩** 새로 읽었다. Source-free 준비
완료 뒤 요청부터 shipped Host parser의 전체 응답 처리 완료까지 측정했다.

| 고정 MLP·생성 stream 준비 후보 | 전체 설명 완료 | 의미 및 3초 |
| --- | ---: | --- |
| TypeScript 한국어 누락 본문 | 1.114초 | 통과 |
| Kotlin 한국어 누락 본문 | 1.204초 | 통과 |
| TypeScript 한국어 지역 쓰기 | 1.280초 | 통과 |
| Kotlin 한국어 지역 쓰기 | 1.377초 | 통과 |
| Kotlin 한국어 감소 loop | 1.272초 | 통과 |
| TypeScript 영어 음수 guard | 0.703초 | 통과 |
| Kotlin 영어 복합 분기/catch/finally | 1.284초 | 통과 |

원문·raw wire·전달 응답·parsed field는 원래 0.6B 결과와 **7/7 일치**했다. 전체 원문과
summary/flow·role/inputs/output/effects/reason을 전부 읽어 의미 **7/7**, 의미와 전체
3초 동시 통과 **7/7**, 최대 **1,377.011ms**를 확인했다. 누락 구현·실제 완료의 미확인,
지역 갱신 순서·callee loop·두 분기 반환·catch·finally를 유지했다. 모델이 작성한 prose와
정적 syntax 소유 필드를 구분한다. 모든 실제 요청에서 compile trace는 **1회**로 유지됐고
추가 재컴파일은 **0회**였다. 연결/runtime 검증 실패도 0개다.

Fused attention과 compiled MLP는 각각 **44,660회**, multi-row fallback은 각각
**952회**였으며 준비 counter는 각각 28회였다. Worker 누적 peak MLX는
**1,182.46 MiB**, RSS는 **702.75 MiB**로 readiness를 포함한다. 전체 VS Code 메모리,
prefill peak 감소나 서로 다른 시점의 시간 차이에 따른 인과적 속도 개선을 입증하지 않는다.

Report `small-model06-compiled-mlp-generation-stream-kilO8z/report.json` SHA-256은
`136334e1c4d09f04e937498d627f2fb11f44089dba700eec402f9f991ab076c8`, 전체 검토는
`small-model06-compiled-mlp-generation-stream-pilot-manual-review.json`이다. Tool은
일곱 응답과 worker 종료를 반환했지만 최종 종료 코드는 누락했다. 같은 handle 재조회,
driver PID 부재·dispose 후 marker·완성된 report로 종료를 독립 확인했으며 종료 코드는
**미관측(null)**로 남겼다. 복구 기록은
`small-model06-compiled-mlp-generation-stream-terminal-recovery.json`이다. 재실행하지 않았다.

고정 일곱 건 통과 후 기존에 동결한 **32개 전체 원문**을 같은 실행 경로에서 한 번씩
검증했다. TypeScript/Kotlin × 한국어/영어 × subtract·음수 guard·지역 쓰기·
catch/cleanup·복합 분기/catch·감소 loop·누락 본문·잘린 본문이다. 원래 원문 32개와
flow 외 응답 항목을 전부 유지했다. 기존 pilot 일곱 맥락과 후보에 추가된 **25개 맥락**을
포함하므로 32개 모두 처음 본 독립 원문이라고 부르지 않는다. 실패 시간 재시도나
모델·prompt·설정 변경은 하지 않았다.

전체 설명 완료는 **637.127791–1,527.485750ms**였고 자동 원문 검사·실행 검증은
**32/32** 통과했다. 전체 원문·raw wire·전달 응답의 모든 모델 작성 문장을 실제로 읽었으며
parsed field와 전달 값의 완전 일치도 확인했다. 의미 **32/32**, 의미와 전체 3초 동시
통과 **32/32**다. 원문의 계산·비교 연산자·지역 갱신 순서·반복 조건·두 반환·catch·
finally의 인수를 보존했다. 누락/잘린 구현의 나머지 동작·효과·실제 완료를 미확인으로
유지했으며 parent 결과 사용의 정상 복귀 조건을 보존했다. 이미 본 일곱 건은 원래
0.6B raw wire와 전달/parsed 값도 일치했다. 모델 작성 필드와 syntax 소유 필드를 구분했다.

Compile trace는 준비부터 32개 요청 종료까지 **1회**이며 추가 재컴파일과 연결/runtime
실패는 0개다. Fused attention/compiled MLP는 각각 **190,624회**, multi-row fallback은
각각 **4,088회**였다. Worker 누적 peak MLX **1,182.46 MiB**, RSS **708.14 MiB**는
readiness를 포함한다. 전체 VS Code 메모리나 peak 감소를 입증하는 값이 아니다.

Report `small-model06-compiled-mlp-stream-holdouts-GqtRA5/report.json` SHA-256은
`ec2305ea5329798391fa33a48ba225da6a31454f0daa2e5f9c2d920cbed4ac9f`, 전체 검토
`small-model06-compiled-mlp-stream-holdout-manual-review.json` SHA-256은
`a200ea0832e15b26cb6ad4704ee1a645c6120f70e8704caa0e6b0a11d4c30e1b`다. 이 평가
driver는 **실제 exit 0**으로 종료했고 소유 worker도 종료했다. 이 후보의 함수 전체 호출
설명 검증 통과는 실제 outer Host·전체 scope/detail-only·full-rich·다운로드/lifecycle·
설치 검증을 대체하지 않는다. 해당 연결 검증을 다음 gate로 열었다. 공개 runtime·package·
Default/QA 설치는 **0.0.1145**를 유지하며 제품 채택과 3초 목표 전체 완료는 아직 미검증이다.

### 전체 작업 연결 검증: 빠른 호출 응답과 full-rich 실패

고정 일곱 건과 동결 32건의 검토를 마친 후 private adapter를 실제 작업 범위에 연결했다.
지원되는 단일 호출 전체 설명은 기존 source-owned/native-operation 경로를 유지하고,
detail-only·overview·선택 경로·여러 대상·일반 시나리오/node/final-synthesis는 원래 전체
wire/schema/prompt로 처리한다. 제한된 원문 parser가 거부하는 문법도 모델 생성 전에 원래
전체 형식으로 보낸다. 모든 분기는 **같은 소유 worker와 FIFO manager**를 사용하며 원문,
출력 항목, 가중치, sampling 설정을 유지한다. 정적 응답 대체나 실패 응답 재생성은 없다.

CPU 검증 **41개**에서 기존 32건의 실제 adapter 요청 schema/message와 전달 응답이
전부 일치했다. 다른 범위의 원래 전체 형식·원문 유지, parser 거부 시 분기, 동일 worker의
FIFO 직렬 처리와 해제를 확인했다. Fake worker 검사는 의미/속도 또는 새 원문 coverage로
계산하지 않는다.

실제 `FunctionCallsHostDelivery`로 TypeScript/Kotlin × 한국어/영어 ×
overview/call/scenario **12건**을 새로 생성했다. 각 요청은 source-free 준비를 마친 뒤
원문 구성·생성·Host parsing·모든 page 읽기 완료까지 측정했다. 모든 page는 model을 다시
부르지 않는 cache 읽기였고 전체 설명은 **404.949833–1,614.875042ms**였다. 하지만
모델 작성 flow/role이 callee의 catch 반환·계산 또는 finally `audit(value)`를 충분히
설명하지 않아 원문 필요 조건 **0/12**였다. 일부 한국어 응답은 `addFee`를 `addF`/`addFi`로
잘못 썼다. 원래 syntax 소유 output/effects에 구문이 남아 있다는 이유로 모델 읽기의
누락을 통과시키지 않았다. 실제 원문·raw·전달·Host 응답을 모두 읽었고 의미와 3초 동시
통과는 **0/12**로 기록했다.

실제 call 요청에서 기존 제한 parser의 범위 차이도 확인했다. TypeScript의 `export`
modifier를 거부하고, Kotlin Host가 반환하는 `resolved` confidence를 기존 synthetic
`exact`/`inferred` vocabulary에 포함하지 않았다. 해당 원문이나 confidence를 바꾸지 않고
원래 전체 wire로 보냈다. 이 fallback의 JSON 파싱 성공은 모델 의미 검증 통과가 아니다.

같은 두 언어/locale의 detail-only 요청 **4건**은 **204.207–499.539833ms**에 생성·파싱을
마쳤다. 전체 raw/전달/parsed 상세를 원문과 대조하니 한국어 두 건은 순차
`n = valueArg * 4; n -= 3; return n`에 존재하지 않는 **try/catch**를 설명했다.
영어 두 건은 일반적인 calculate/update/return 문장이라 구체적인 연산을 읽었음을 충분히
확인하지 못했다. 한국어의 확실한 반례와 영어의 미확인 상세를 구분하며, 의미와 전체
3초 통과로 인정한 것은 **0/4**다.

처음 full-rich 구간을 연결할 때 검증기가 원래 benchmark의 비동기 IIFE를 기다리지 않아
다음 구간을 먼저 시작했다. 단일 worker 소유권 검사가 이를 차단했고 실제 driver는
**exit 1**, 준비 중이던 소유 child는 종료됐다. 첫 rich phase의 조기 exit-0 marker는
성공이 아니며 이 구간에서 완성된 모델 응답은 **0개**다. 실패 파일과 16개 실제 완료된
호출/상세 응답을 보존했다. 원래 benchmark IIFE에 top-level `await`와 파일 이동에 필요한
상대 경로만 추가했고, 이미 실행한 호출/상세 16건은 반복하지 않았다.

수정한 검증기로 원래 interleaved-effects 원문을 **4개 전체 rich session**에서 측정했다.
실제 `FunctionNarrativeScenarioSession`이 scenario→남은 node/value→최종 summary의
**세 번의 모델 요청**을 수행하고 모든 page/node를 마칠 때까지 잰 값이다.

| 전체 rich session | 준비 후 전체 설명 | 의미 및 3초 |
| --- | ---: | --- |
| TypeScript 한국어 | 4.848초 | 실패 |
| TypeScript 영어 | 7.544초 | 실패 |
| Kotlin 한국어 | 5.979초 | 실패 |
| Kotlin 영어 | 5.188초 | 실패 |

네 session 모두 구조상 완료됐지만 의미와 전체 3초 동시 통과는 **0/4**다. 모든 실제
raw/전달 모델 작성 필드와 원문을 읽었다. 외부 `audit(adjusted)` 호출 **이전**의
`adjusted = amount + 5`에도 정확한 수치 대신 `null` 또는 caller/callee 설명 문장을
넣었다. 선언·갱신·호출을 서로 다른 동작으로 설명하지 못하고 최종 synthesis도 잘못된
값과 설명을 이어받았다. Audit 구현/실제 완료의 미확인도 올바르게 유지하지 못했다.
정상 audit 복귀를 전제로 한 수학적 반환값과 실제 실행 완료를 구분하며, 외부 호출 전
선언값의 확실한 반례만으로도 의미 실패를 확인할 수 있다. 원래 step/value/synthesis
필드와 모든 원문은 줄이지 않았다.

이 연결 검증의 새 실제 model 응답은 **28개**이며 사용자 단위 전체 읽기는 **20건**이다.
모든 요청에서 source KV 재사용은 0이고 compile trace는 소유 worker당 1회로 유지됐다.
수치 최적화의 runtime 검증 실패는 없었다. Worker 누적 peak MLX **1,025.10 MiB**,
RSS **707.00 MiB**는 readiness를 포함하며 전체 VS Code 메모리나 peak 감소의 근거가
아니다. 두 driver 모두 실제 exit 1로 끝났고 모든 소유 worker는 종료했다. 모델·prompt·
precision·sampling 설정 순회나 실패 응답 재시도는 하지 않았다.

실패 검토 `small-model06-complete-task-failure-review.json` SHA-256은
`19302127b46a5338b9e1ba30618ee7bcc13be5356d25be763f20bc61cebc27d3`다. Rich report
`small-model06-awaited-rich-gates-NB30Qw/report.json` SHA-256은
`278eac3d12b238f473345ca924a0dd072480dbd31d2902977786c54f92c5eb98`이다. 앞선
고정 일곱 건·32건 성공과 기존 실패는 그대로 남기며, 이 **전체 작업 후보는 미채택**이다.
빠른 단일 호출 결과로 상세/전체 시나리오 지원을 대신 입증할 수 없다. 다운로드·무결성·
custom model·취소/idle lifecycle와 설치 gate를 통과했다고 주장하지 않는다. 공개
runtime/package/Default·QA 설치는 **0.0.1145**이고 3초 목표는 미완료다.

## 실제 Host 계약 수정과 한 번의 전체 rich 읽기 검증 — 미채택

다음 구현에서는 앞서 관찰한 두 가지 Host 경계 차이를 수정했다. TypeScript 선언의
`export`/`default` modifier를 원문 그대로 허용하고, Kotlin의 `resolved` confidence를
다른 값으로 변환하지 않고 보존했다. Async/generator나 추가 최상위 선언, 알 수 없는
confidence는 계속 제한 parser 밖으로 처리한다. 전체 요약이 있는 단일 대상의
overview/call/scenario가 같은 source-owned operation 계약을 사용하며, 원문·span·
정적 근거와 원래 상세 필드는 유지한다. 공개 runtime에 적용하지 않은 별도 private
파생 파일이며 기존 실패 파일과 원본 parser는 변경하지 않았다.

전체 rich 읽기에는 명시적인 `generateRichReading` API를 추가했다. 모델이 **한 응답**에
모든 원문 구문의 `syntax`/`text`/`reason`/`effect`/`values`와 최종 요약·설명·analysis·
입력·결과·가정을 생성한다. 기존 primary parser, 두 구문 단위 node parser, final
summary parser로 모두 검증한 뒤 원문 소유 graph ID를 결합하고 페이지를 저장한다.
나중의 `generate` 호출에 이전 응답을 반환하는 방식은 사용하지 않았다. 원래 primary의
첫 두 구문 view와 전체 nodeDetails를 함께 유지하며, 이후 구문과 최종 설명을 삭제하거나
잘못된 값을 원문 평가기로 고치지 않는다. 새 작업을 설명하기 위해 prompt의 “첫 두
구문” 지시 한 곳만 “모든 도달 구문을 순서대로”로 변경했다. 모든 원문과 다른 지시는
유지했고 모델·정밀도·sampler·RNG·KV·출력 한도는 변경하지 않았다.

모델 실행 전 **CPU 검증 105개**가 통과했다. 기존 32건의 payload/schema/guidance/
decode 동등성과 실제 Host 12건의 원문/근거 경계를 50개 검증으로 확인했다. Rich
필드 보존·잘못된 값의 무수정·누락/위조 거부 28개, 실제 provider/FIFO/Session의
취소·저장 실패 후 재개·cache-only 조회·리소스 해제·반복 graph ID의 서로 다른
occurrence·8구문 보존 27개를 확인했다. 예전 실패 응답을 합친 것은 CPU fixture
구성에 한정하며 새 추론·의미·시간의 성공으로 세지 않았다. Prompt suffix와 live
grounding 함수의 직렬화 차이 때문에 실패한 CPU 검증/reader도 별도 파일로 보존했다.

준비 영수증 `small-model06-complete-reading-gate-preparation.json` SHA-256은
`c0ea5b146e73dea8e9f01e80fb8eac2c489f5262ea103eba1cf89075a2298d1b`다. 고정한 새
구현을 실제 Host 12건과 전체 rich 4건에서 각각 한 번씩 실행했다. 원문은 앞선 실패
검증과 같으므로 새로운 독립 source coverage로 세지 않는다.

| 실제 Host 요청 | 모델 준비 후 전체 설명 | 내용과 3초 동시 통과 |
| --- | ---: | --- |
| TypeScript 한국어 overview / call / scenario | 3.097 / 1.331 / 4.150초 | call 1건 |
| TypeScript 영어 overview / call / scenario | 1.037 / 1.987 / 3.145초 | overview·call 2건 |
| Kotlin 한국어 overview / call / scenario | 1.524 / 3.909 / 1.363초 | overview·scenario 2건 |
| Kotlin 영어 overview / call / scenario | 1.712 / 2.561 / 1.127초 | 0건: 반환 상세 미완성 |

12건 모두 생성·Host 파싱을 마쳤고 기존 자동 검사와 3초를 통과한 것은 **8/12**다.
모든 새 raw 작성 문장을 읽고 전달된 설명과 대조하니, 호출 흐름은 12건 모두 인수 전달,
try/catch 반환 선택, finally의 `audit`, 미제공 audit 본문/완료의 미확인, 정상 완료 시
부모 반환을 포함했다. 다만 Kotlin 영어 세 건의 자유 `output` 상세는 finally/audit만
설명하고 `value + 5` 또는 `0`라는 반환 선택을 빠뜨렸다. 다른 role/flow에 있는 설명으로
해당 필드의 미완성을 대신 통과시키지 않았다. 요청된 상세까지 내용 검증 통과는
**9/12**, 내용과 전체 3초 동시 통과는 **5/12**다. 5개 상세 필드의 key와 원래 상수
필드는 보존했고, 자유 `output`을 이전 응답의 상수로 잘못 비교한 reader 실패도 남겼다.

| 단일 응답 전체 rich 읽기 | 모델 준비 후 전체 설명 | 결과 |
| --- | ---: | --- |
| TypeScript 한국어 | 8.407초 | 전체 구문·페이지 완료, 의미 실패 |
| TypeScript 영어 | 8.132초 | 전체 구문·페이지 완료, 의미 실패 |
| Kotlin 한국어 | 6.378초 | 전체 구문·페이지 완료, 의미 실패 |
| Kotlin 영어 | 19.345초 | 2,400 output token 한도에서 생성 실패 |

완료된 세 건은 모두 원래 **4구문·6 graph node**와 최종 설명을 보존했다. 그러나
외부 audit **이전**의 `amount + 5`부터 틀린 값·null·호출 설명 문장을 넣었고, 구문별
설명과 최종 설명도 caller/callee 개념을 잘못 적용했다. Audit의 정상 복귀를 가정한
조건부 계산과 실제 완료의 미확인을 구분하지 못했다. 이 확실한 반례로 세 건을 모두
거부했다. Kotlin 영어는 첫 example input의 숫자 생성을 반복하다 한도에 도달했다.
그 partial raw와 `Incomplete generation: length`를 보존했으며 입력값 제한·재시도·
응답 수정으로 통과시키지 않았다. 전체 rich의 의미와 3초 통과는 **0/4**다.

완료된 rich 응답의 output token은 각각 **734 / 609 / 754개**, decode 시간은
**6.624 / 7.724 / 5.885초**였다. Prefill은 **1.554 / 0.275 / 0.329초**였다. 요청 수를
세 번에서 한 번으로 줄이는 것만으로 완료 시간이 개선되지는 않았다. 한 번의 전체
읽기는 정확한 값과 설명을 생성하는 능력, 충분한 decode 속도를 함께 갖춰야 한다.

이번에는 **16개 실제 fresh model 요청** 중 **15개 provider 응답**이 완료됐고 한 건은
생성 중 실패했다. 실패 건의 완료 metrics가 0개인 것은 추론을 실행하지 않았다는 뜻이
아니다. 완료된 15개 metrics에서 source KV 재사용 0, compile trace 1, 추가 상주 가중치
0을 확인했다. 실패한 생성의 같은 metrics는 제공되지 않아 성공으로 주장하지 않는다.
Worker 누적 peak MLX **1,466.11 MiB**, RSS **712.92 MiB**는 readiness를 포함하고 전체
VS Code 메모리나 메모리 감소를 입증하지 않는다. 실제 driver는 **exit 1**이며 소유
worker 16개 모두 종료했다.

학습/검증 corpus **4,136건 전체**의 형식도 별도로 조사했다. Training 3,256건은 전체
호출 읽기 3,036건과 detail-only 220건, validation 880건은 전체 호출 읽기 860건과
detail-only 20건이다. **Rich context, scenario completion, nodeTask, summaryTask,
단계별 values, 숫자 example input/result, 전체 rich 필드의 감독 예시는 모두 0건**이다.
`resolved` confidence의 예시도 없었다. Rich 작업 형식의 감독 공백은 확인됐지만 이것이
실패의 유일한 원인이라거나, 새 감독 데이터만으로 3초를 달성할 수 있다는 증거는 아니다.
이 조사에서 모델/학습은 실행하지 않았고 평가 응답을 학습 데이터로 사용하지 않았다.

형식 조사 `small-model06-complete-task-format-coverage.json` SHA-256은
`94fddb967eb084ee045aeac244846bf4d114e20b13725050456ac7334ff35a82`다. 최종 검토
`small-model06-complete-reading-manual-review.json` SHA-256은
`eb394fe110176c01439c0a5b42870dfe5cb4c945ef5b069f95ebf990d69544ce`이고, 실제 trial
report SHA-256은 `7fe7de5af5c316acef7bcba7d43a1ff466ef54070bc49b017a1595153c63d916`다.
모든 실패와 이전 고정 7건/32건 성공을 보존했다. 기존 detail-only 4건의 실패는 그대로
남아 있고 새 구현에서 반복하지 않았다. 전체 작업 후보는 **미채택**, 공개 runtime/
package/설치 변경은 없으며 **0.0.1145**를 유지한다. **3초 목표는 미완료**다.

## 전체 작업 학습과 입력 구조 후속 검증 — 미채택

형식의 감독 공백을 보완하는 별도 0.6B 후보에서 전체 학습 2,920건과 응답·EOS
697,695 token의 한 번의 학습 pass를 완료했다. 입력과 출력의 일부만 학습하거나 중간
checkpoint를 골라 평가하지 않았다. 최종 tensor와 실행 경로의 수치·메모리 검증 후
새 Kotlin 한국어 함수의 네 전체 경로를 한 번씩 생성했다.

이 실제 시도는 **24.168초 후 실패**했으며 전달된 완성 page는 **0개**다. 네 raw 응답은
생성됐지만 한 응답은 기존 구조 검증에 실패했고 네 응답 모두 의미 검증에 실패했다.
모델이 제시한 입력은 문자열 길이가 달라 숫자 `-1`을 반환해야 했는데 결과를 모두
`null`로 썼다. 숫자 상태에 변수 이름·코드 조각을 쓰거나 함수 목적을 잘못 설명한
경우도 있었다. 이 시간은 성공한 전체 설명의 완료 시간이 아니다. 전체 685개 필드의
검토에서 16개 위반을 남겼으며 실패한 source family와 그 이름·연산·언어·locale·범위
변형을 다시 추론해 성공 사례로 교체하지 않는다. 학습 loss와 수치 동등성의 개선은
새 함수의 정확한 설명이나 3초 완료를 입증하지 않았다.

실패 결정 `three-second-low-lr-complete-candidate-rejection-v58.json` SHA-256은
`7bc7751eb35b437af87d2e559a2d2d0f36fefcf7b1111ecb19e3efeae957e79c`다. 모델 응답을
평가기·템플릿으로 고치거나 정적 계산값으로 대체하지 않았고 기존 실패를 보존했다.

그 뒤 설명 문장과 예시 값은 각 소스 노드가 독립적으로 소유하도록 유지하면서 native
응답의 필수 필드 이름·정적 상수만 Host가 복원하는 별도 tuple 계약을 구현했다.
CPU에서 원래 학습·검증·동결 진단 **3,888건 전체**의 schema·응답·원문 경계를
복원했다. 긴 시나리오 reference 응답 token은 20.22% 줄었지만 입력 token은 10.37%
늘었다. 첫 입력 구조의 5건 window 초과를 보존하고 반복 field layout만 별도로
묶은 다음 구조에서는 전체 3,888건이 기존 8,192 window와 2,400 출력 reserve를
통과했다. 최대 입력은 5,781 token이었다. 이는 reference의 CPU tokenizer 결과이며
모델이 이 형식으로 정확하게 생성했다는 증거나 실제 속도 측정은 아니다.

GPU 실행에서는 소스 없는 별도 layer별 compiled tail을 구현했다. 원래 실행·기존
최적화·새 실행 사이 raw logit/KV **5,130쌍**이 정확히 같고 전체 8,192 window,
요청별 cache 소유권과 메모리 해제를 확인했다. 그러나 사전에 고정한 네 긴 입력의
한 forward wave는 16.714→15.335ms, 속도 비율 **1.08993**으로 요구한 **1.10**에
미달했다. 기준을 낮추거나 같은 실험을 반복하지 않고 미채택했다. Prefill·grammar·
sampling·설명 생성을 제외한 소스 없는 연산 측정이며 전체 설명 시간으로 해석하지 않는다.

마지막으로 tuple의 이중 인코딩된 compiler metadata를 직접 JSON으로 바꿨다. 원문과
설명 필드·native schema·응답·EOS는 모두 그대로 복원됐다. 계약 테스트 6개와 실제
Host/provider의 CPU teacher 통합 테스트 7개가 통과했고 취소·실패·disk page·여러 경로·
순차 fallback을 확인했다. 전체 3,888건의 토큰 한도도 통과했으며 최대 입력은 5,706
token이었다. Native grammar 증거는 동일 schema/응답에 대한 앞선 실제 전체 검사를
합성한 것으로, 새 grammar 실행을 했다고 세지 않는다.

| 전체 CPU 진단 | 이전 입력 token | 직접 metadata 입력 token | 차이 |
| --- | ---: | ---: | ---: |
| 학습 2,920건 | 6,922,905 | 6,927,909 | +5,004 |
| 검증 868건 | 2,036,834 | 2,036,854 | +20 |
| 전체 시나리오 68건 | 262,024 | 259,614 | −2,410 |
| 호출 설명 32건 | 59,155 | 59,155 | 0 |
| 합계 3,888건 | 9,280,918 | 9,283,532 | +2,614 |

시나리오의 입력 문자열은 3.56% 줄었지만 실제 token 감소는 0.92%였다. 전체에서는
192건 감소·3,212건 동일·484건 증가였다. 문자 길이 감소만으로 tokenizer 비용의
감소를 보장할 수 없어 이 형식도 채택하지 않았다. 증가한 요청을 제외하거나 평가 후
다른 형식으로 바꿔 결과를 부풀리지 않았다. CPU 결정 `direct-owner-prompt-v62/decision.json`
SHA-256은 `471a7359a03d29d775cdf76354b18b6369db033a812936f04446f01934870927`다.

입력 구조 검증과 GPU 합성 연산에서는 새 모델 설명 요청·학습·실패 함수의 재추론이
없었다. 전체 설명의 LLM 소유 범위를 유지하며 공개 runtime·설치·모델은 변경하지
않았다. **0.0.1145 유지, 전체 의미와 준비 후 3초 목표 미완료**다.

## 원문 보존 입력과 가중치 공유의 추가 검증

설명의 모든 소스 노드·필드·값·경로를 유지하는 조건에서 입력 구조, 한국어 어휘,
GPU 가중치 접근을 각각 구현하고 검증했다. 아래 결과는 전체 설명 3초 완료의 증거가
아니다. 모델이 준비된 뒤 원문 입력부터 **정확한 전체 설명 완료까지 3,000ms**라는
기준을 유지한다.

V63 입력은 동일한 tuple 검증 조건만 표준 JSON Schema `$ref`로 묶는다. 각 노드의
원문 설명·지역 상수·값 schema와 LLM이 작성할 문장·값의 소유권은 그대로다. 전체
blueprint와 원래 schema를 정확히 복원하며 다른 instruction·원문·응답·EOS는 바꾸지
않았다. 계약 테스트 6개와 실제 Host/provider의 CPU teacher 통합 테스트 7개가
통과했다. 전체 3,888건에서 V60 대비 입력 token 증가가 없고, 252건이 감소했다.

| 전체 CPU 진단 | V60 입력 token | V63 입력 token | 차이 |
| --- | ---: | ---: | ---: |
| 학습 2,920건 | 6,922,905 | 6,918,479 | −4,426 |
| 검증 868건 | 2,036,834 | 2,035,274 | −1,560 |
| 전체 시나리오 68건 | 262,024 | 255,158 | −6,866 |
| 호출 설명 32건 | 59,155 | 59,155 | 0 |
| 합계 3,888건 | 9,280,918 | 9,268,066 | −12,852 |

최대 전체 입력 5,501 token과 원래 출력 reserve 2,400의 합은 7,901로 기존 8,192
window 안에 들어갔다. 시나리오 입력 감소 2.62%의 비교 대상은 V60이다. Tuple 도입
전의 원래 시나리오 입력 237,396 token보다는 여전히 약 7.48% 많다. Native grammar
증거는 동일 schema·응답에 대한 V59의 실제 전체 검사 결과를 합성했으며 새 grammar
실행으로 세지 않는다. CPU 입력 준비만 통과했고 모델 학습·추론·설치에는 적용하지
않았다. `owner-template-prompt-v63/decision.json` SHA-256은
`b1b6b340b14553e41ab35817f9dda06f0ff5d8d896b0220a49ab762e70440e72`다.

V64 GPU 구현은 동일 가중치 tile 안에서 각 요청의 원래 단일 행 연산을 순서대로
실행했다. 원본 projector 113개와 요청 수 1–8 전체에서 raw 결과 **4,068쌍**이 정확히
같았다. 하지만 사전 고정한 8개 요청의 어휘 출력 연산은 2.734→1.612ms, 비율
**1.69632**로 요구한 **2.0**에 미달했다. 단독 QKV 비용도 원본의 1.05842배로 한도
1.05를 넘었고 종료 전 논리적 메모리 해제 검사도 실패했다. CPU weakref 재현은
Python `locals()`의 frame 참조 보존 가능성을 뒷받침했지만 실제 GPU 해제 실패를
무효화하지 않는다. 해당 실행과 기준을 변경하거나 반복하지 않고 미채택했다.
`locality-projection-v64/decision.json` SHA-256은
`9cb67396b64b6c5e423e2e57447a7161c81f523a1d36ac24fd5bd9d4fc145ffd`다.

V65 CPU 실험은 기존 모델의 151,936 출력 행 중 원래 tokenizer가 이름을 부여하지
않은 267개 행을 확인하고, 별도 tokenizer에 한국어 단어 264개를 추가했다. 어휘는
학습 응답 2,920건만 사용해 고정했으며 검증·동결 소스로 고르지 않았다. 문장·응답
template·JSON 조각을 token으로 만들거나 문장을 다른 노드와 공유하지 않았다.
기존 vocabulary/special ID·EOS·chat template을 보존했고 원래 모델 파일은 바꾸지
않았다. CPU 단위 테스트 7개와 단어 경계·공백 검사 2,112개가 통과했다.

전체 3,888건의 원문 입력·응답 UTF-8 복원이 정확했고, 새 tokenizer로 각 전체 native
응답의 grammar·종료 EOS·EOS 단독 terminal mask를 **실제로** 검사해 모두 통과했다.
모든 응답과 EOS 학습 대상·기존 한도도 보존했다. 전체 reference 응답 token은
858,953→811,451로 줄었지만 **입력 증가 198건, 응답 증가 2건**이 발생했다. 긴
시나리오의 입력은 255,158→255,485로 오히려 늘고 응답은 30,588→30,048로 줄었다.
독립 단어 token이 기존 BPE의 인접 공백·문장부호 결합을 나눌 수 있어 단어 자체의
절감이 전체 요청 절감을 보장하지 않았다. 고정한 요청별 token 비증가 기준에 따라
미채택했으며 어휘·기준을 재선택하거나 실패 요청을 제외하지 않았다. 추가 단어의
모델 가중치는 학습하지 않았으므로 이 tokenizer를 기존 모델과 함께 사용하지 않는다.
`lexical-padding-v65/decision.json` SHA-256은
`5e4ed857e9182a2b924695cd8544b9e1e523d96fedd50e4b2825f332974bf1a4`다.

V66은 가중치의 실제 quantized 정수 word와 scale/bias를 최대 네 요청이 공유해 읽는
새 GPU 구현이다. 요청별 activation·누산·결과와 원래 부동소수점 식·SIMD reduction·
BF16 반올림을 유지했다. 단독 요청은 원래 native projector를 사용하도록 측정 전에
고정했고, 5–7개 요청의 마지막 tile도 실제 요청만 읽고 썼다. CPU 테스트 9개가
통과했으며 한 번의 GPU 실행에서 전체 **4,068 raw 결과 쌍**과 각 case의 원래
316,768,264-byte 상주량이 정확했다. 명시적인 container로 정리한 새 audit의 종료
전 할당은 원래 **8 bytes**로 돌아왔으며 프로세스 종료도 확인했다. 이는 V66의
해제 증거이며 V64의 실패를 지우지 않는다.

하지만 V66의 8개 요청 어휘 출력 연산은 2.666→1.857ms, 비율 **1.43590**으로
동일한 **2.0** 기준에 미달했다. 단독 요청 세 case는 1.05 비용 한도 안에 있었지만
여러 요청의 QKV·gate-up은 원본보다 느렸다. 전체 12개 고정 측정 case와 모든
실패를 보존하고 미채택했다. 일부 연산만 골라 통과했다고 보고하거나 같은 구현을
재측정하지 않았다. `reused-word-projection-v66/decision.json` SHA-256은
`8f99261cb6a45d79dd34d739ad349109b5135e7101cd5607e31d0cd217e961a7`다.

GPU 측정에는 prefill·grammar·sampling·실제 함수 설명 생성이 포함되지 않았다.
CPU 자료의 token 절감이나 소스 없는 연산 개선을 실제 설명 시간으로 환산하지
않는다. 새 모델 설명 요청과 학습은 없었고, 이전 모델·runtime·source family 실패는
그대로 유지한다. **공개 runtime·모델·설치 변경 없음, 0.0.1145 유지, 정확한 전체
설명과 준비 후 3초 목표 미완료**다.

## 병렬 SIMD와 원래 scalar 작업 순서의 후속 검증

V67은 요청마다 원래 SIMD 계산을 병렬로 유지하고, quantized 가중치·scale/bias만
2,176-byte threadgroup tile로 공유했다. CPU 테스트 11개와 한 번의 GPU 실행에서
원본 projector 113개·요청 수 1–8의 **4,068 raw 결과 쌍**이 모두 정확히 같았다.
각 case의 원래 상주량을 유지했고 종료 전 할당도 원래 **8 bytes**로 돌아왔다.

고정한 12개 성능 case는 통과하지 못했다. 8개 요청 어휘 출력의 control/candidate
중앙값은 30.524/32.968ms, 비율 **0.925865**로 요구한 2.0에 미달했고 단독 요청 세
case도 1.05 비용 한도를 넘었다. 측정 interval의 max/min 비율이 최대 18.23까지
흔들렸고, 실행 직후 load average는 99.25/85.90/63.33, 논리 CPU 수는 15였다.
이 사후 관측은 성능 변동의 원인을 입증하거나 실패를 무효화하지 않는다. 기존 실행을
반복하거나 일부 interval만 고르지 않고 미채택으로 보존했다.
`shared-tile-projection-v67/decision.json` SHA-256은
`9f1e05f3f0aae255b90b4249009b1776f6d2fc6982f680a81aae2e3809e92524`다.

V68 CPU 준비에서는 원래 64-thread scalar 계산과 부동소수점 식을 그대로 두고,
같은 출력 가중치 tile의 요청별 작업 그룹이 인접하도록 논리적 인덱스만 바꿨다.
요청 loop·공유 메모리·요청 간 barrier·dummy row는 없다. 실제 GPU scheduling과
cache 재사용 효과는 이 CPU 준비 단계에서는 미검증이었다. 계산 경계·원문 소유권·부하 검사에 관한
CPU 테스트 15개가 통과했고 Python 모듈 7개를 파싱했다.

새 비반복 GPU 실험을 시작하기 전 실제 CPU당 1분 load <=1.0, 5분 load <=1.5를
확인하는 별도 admission guard를 구현했다. 최초 관측은 0.820/3.948이어서 모델과
GPU를 초기화하지 않고 보류했다. 다음 관측도 0.751/2.378로 보류였다. 이 guard는
비공개 실험의 준비 조건이며 제품 요청을 지연시키거나 전체 설명의 기다린 시간을
3초 측정에서 제외하는 기능이 아니다. CPU 부하 통과만으로 GPU 시간의 안정성을
보장하지도 않는다. 고정한 GPU 결과·메모리·2.0/1.05 성능 기준은 그대로 유지한다.
`interleaved-projection-v68/preparation-decision.json` SHA-256은
`6da98dc9f4153620478e412de31c028ba4e3e459cdb87a5edb8765bde3f66fa1`다.

이후 실제 CPU당 1분/5분 load가 0.660/0.949로 내려왔을 때 V68의 첫 GPU 실행을
시작했다. 원래 projector 113개·요청 수 1–8의 **4,068 raw 결과 쌍**이 모두 같았고,
모든 case의 원래 상주량과 종료 전 **8 bytes** 복귀도 통과했다. 실제 session54713,
PID65142의 terminal `9bf5bd`는 exit1이었으며, 별도 관측 `9753e4`에서 해당 PID가
사라진 것도 확인했다.

V68의 8개 요청 어휘 출력 control/candidate 중앙값은 7.059/3.497ms,
비율 **2.018823**으로 해당 2.0 기준을 넘었다. 그러나 단독 어휘 출력의
candidate/control 비용은 **1.079680**으로 고정한 1.05 한도를 넘어 전체 성능 검증은
실패했다. QKV·gate-up 단독 비용은 각각 1.035416/0.938901이었다. gate-up 8개도
0.458/1.008ms로 느려졌다. 12개 case·각 variant의 10개 교대 interval·interval당
16회 호출과 전체 출력 검사를 모두 보존했고, 유리한 일부 case만 채택하거나
실행을 반복하지 않았다. CPU admission 통과는 나중의 성능 실패를 무효화하지 않는다.
`interleaved-projection-v68/gpu-decision.json` SHA-256은
`df2179ab917b5f9651477c0f106f26cb82de8013a60dd32613ff9f1c95e7be83`다.

V69는 입력을 stack하고 출력을 slice하는 중간 연산을 제거하고, 실제 요청마다
별도 입력 pointer와 출력 buffer를 연결했다. 원래 scalar 계산·입력 guard·단독
native 경로는 유지했다. CPU 테스트 16개와 Python 모듈 파싱 7개가 통과했고,
한 번의 GPU 실행에서 **4,068 raw 결과 쌍·모든 case의 원래 상주량·종료 전
8 bytes 복귀**도 통과했다. 그러나 8개 요청 어휘 출력 control/candidate 중앙값
3.439/2.091ms, 비율 **1.645180**은 요구한 2.0에 미달했고, QKV 단독 요청 비용
**1.219565**도 1.05를 넘었다. 모든 12개 case와 interval을 보존해 미채택으로
판정했다. 실제 session26858/PID91430의 terminal `9a9409`는 exit1이었고,
`b8895d`에서 해당 PID가 사라진 것을 별도로 확인했다. V68의 실패 실행을 반복한
것이 아니라 실제 GPU 입력·출력 ABI와 중간 연산을 변경한 별도 후보였다.
`direct-row-projection-v69/decision.json` SHA-256은
`2484f77e19a33631f1bbe58b4e5603ec98a297d816e1edf8816487a7c9b63dc7`다.

V67·V68·V69는 소스 없는 연산 검증이며, 모두 고정 성능 기준에 따라 미채택이다.
전체 모델 logit/KV·sampler·설명 생성·학습·실패 함수 재추론·공개 runtime·설치
변경은 없었다. V68 audit의 14.63초와 peak 474,316,940 MLX bytes는 연산 검증의
진단 수치이며 실제 제품의 전체 설명 시간이나 process RAM이 아니다.
**0.0.1145 유지, 전체 설명의 정확성과 준비 후 3초 목표 미완료**다.

## 요청별 원래 샘플링 호출을 묶는 별도 검증

V70은 여러 요청의 원래 full-filter 함수를 하나의 tuple 실행 그래프로 묶었다.
전체 151,936-token stable sort·top-p 0.95·top40·temperature 0.2·categorical·
요청별 seed42 key split은 유지했다. 확률·logit·필터 결과·key를 stack하거나
공유하지 않았고, 단독 요청·혼합 dtype·원래 native singleton certificate 경로도
보존했다. CPU 경계·준비 상태 테스트 16개와 원래 RNG 연산의 AST 동일성 검사를
통과했다.

첫 GPU 실행에서 full-filter·token·key·draw count **514개 비교**가 모두 정확히
같았다. 두 dtype·요청 수 1–8·순서 변경·혼합 dtype fallback·실제 retain 8→3→1을
포함한다. 외부 RNG는 그대로였고, 숫자 검증·12개 성능 case·최종 해제 뒤 할당은
모두 원래 **8 bytes**였다. control/candidate 각각 **5,050회**의 합성 categorical
draw를 실제 수행했다. 모델·소스·grammar·함수 설명 생성은 없었다.

고정한 성능 기준은 실패했다. 8개 요청의 6개 경우 중 5개가 요구한 1.10 속도
비율에 미달했다. bfloat16 dense/sparse/ties 비율은 1.008626/1.002821/0.990890이었다.
float32 ties 단독 비용 1.072861과 bfloat16 sparse 단독 비용 1.053021도 1.05를
넘었다. 12개 case·variant당 10개 교대 interval·interval당 8회 호출·모든 sampled
token history와 최종 key 검사를 보존했고, 유리한 경우만 고르거나 다시 실행하지
않았다. 실제 session99223/PID57087은 terminal `b7c983` exit1로 끝났고,
`3ade16`에서 해당 PID가 사라진 것도 확인했다.
`grouped-sampler-v70/decision.json` SHA-256은
`4e93875d53050ec9502311b19f89801d47402647ccb221cce32d389e44ea6cdb`다.

이 후보는 미채택이며 전체 모델·grammar·sampler 통합, 설명 정확도와 3초 완료를
입증하지 않는다. 공개 runtime·설치본은 0.0.1145를 유지한다.

## 작은 모델의 완전한 tuple-wire 학습 입력 준비

V71은 V59의 손실 없는 응답 형식과 V63의 검증된 prompt를 전체 학습 2,920건·검증
868건에 결합했다. 원문·호출 맥락·schema·언어·설명·반환값·종료 토큰을 보존했으며,
별도로 고정한 진단 요청 100건은 두 split에서 모두 제외했다. CPU 단위 테스트
11개와 Python 모듈 파싱 3개가 통과했다. 실제 CPU tokenizer의 전체 3,788건 검사,
저장한 토큰 배열의 행별 hash 검사, 실제 SDK `iterate_batches`의 전체 CPU 배치
검사가 모두 통과했다. 마지막 검사는 MLX driver를 초기화했지만 GPU 계산·모델
가중치 로딩·학습·설명 생성은 수행하지 않았다.

학습 대상인 응답·EOS 토큰은 697,695 → **624,170**으로 73,525개(약 10.54%) 줄었다.
반면 prompt 토큰은 6,618,845 → **6,918,479**로 약 4.53% 늘었다. 검증 대상은
202,975개다. 출력 토큰 감소를 전체 학습 비용이나 설명 속도의 개선으로 해석하지
않는다. 설명과 모든 경로·노드의 값은 여전히 각각 LLM이 생성해야 한다.

완전한 학습·검증 sequence의 최대 길이는 5,181/5,180이었다. 실제 SDK negative
control에서 예전 5,120 제한은 학습 index 2,680의 61개 토큰과 마지막 EOS를 잘랐다.
이 배치는 학습에 사용하지 않았다. 새 6,144 제한에서는 전체 행·응답·EOS·loss mask가
보존됐다. 원래 모델 window 8,192와 출력 허용량 2,400은 유지한다.
`tuple-training-input-v71/decision.json` SHA-256은
`4273e5fa21b634a9069caec283774d9412173f2fc8b9e2a8509688f5ee47aa79`다.

이는 새 학습 입력 준비의 검증이다. 새 응답 길이에 맞는 loss 균형, 학습 데이터만
사용하는 안정성 기준선, 전체 1-pass trainer를 고정해야 학습을 시작할 수 있다.
이후에도 최종 모델의 새 독립 함수 정확도와 실제 Host의 전체 설명 3초를 검증해야
한다. 새 모델 학습·기본 모델 교체·버전 변경·설치는 아직 없었다.

V72는 이 새 입력 전체의 source 분류와 연결된 source group 81개를 다시 계산해
기존 학습 정책과 대조했다. 학습 2,920건의 모든 유리수 가중치가 같았다. 정책은
완전한 응답·EOS의 **행별 평균 loss**에 가중치를 곱하므로, 응답 길이 변화가
함수 유형·언어·기능별 학습 비중을 바꾸지 않는다. 검증 868건은 여전히 가중치
없이 monitoring에만 사용하며, frozen 요청은 포함하지 않는다. CPU 테스트 10개가
통과했다.

동일한 학습 전용 48건·24개 group을 새 입력으로 고정하고 원본 0.6B 모델 및 초기
LoRA에서 총 **96회**의 teacher-forced 계산을 실제 수행했다. variant당 응답·EOS
10,803개 전체의 NLL·SDK NLL·top-token·시작 위치 벡터가 정확히 같았다. 두 평균
NLL은 3.0507729018960212였고 기존 초기 drift 기준을 통과했다. 초기 LoRA는 기존과
같은 F32 배열 224개·parameter 2,883,584개였다. 계산 중 RNG는 바뀌지 않았으며
종료 후 외부 RNG 복구와 MLX active allocation의 원래 **8 bytes** 복귀를 확인했다.
실제 session33604/PID33432의 terminal `a57a4d`는 exit0이었고, `9f209f`에서 해당
PID가 사라진 것도 확인했다.
`tuple-learning-prerequisites-v72/decision.json` SHA-256은
`d0b1c42ad9bafc47c055dad2cbe447f977d70b5ce1356fbc69dbee2945510522`다.

기준선 진단의 57.354초는 함수 설명 생성 시간이 아니다. optimizer update·sampling·
설명 생성·adapter 저장은 없었다. 다음에는 새 SDK CPU trace의 전체 순서와 고정
안정성 검사를 사용하는 trainer가 필요하다. 학습 정확도·새 함수 설명의 정확도·
실제 Host의 3초 완료는 여전히 미검증이며, 공개 runtime·설치본은 그대로다.

## 완전한 tuple-wire 학습 실행 연결

V73은 전체 입력·학습 순서·optimizer report를 구분하는 계약 테스트 5개를 통과했다.
첫 실제 CPU 배치 실행은 `completion_loss`의 하위 폴더 import 오류로 첫 행 이전에
실패했다. 모델 로딩·optimizer update·설명 생성은 모두 0이었다. 실패한 실행과
코드를 보존하고 반복하지 않았다.
`tuple-full-training-v73/decision.json` SHA-256은
`2f9b9da777f6f47b15073a0f64d8af649a8edce81f7b49d5111af045c71dc194`다.

V74는 기존 loss 함수들을 검증된 파일 경로와 hash로 명시적으로 연결했다.
`sys.path`나 기존 loss 계산은 바꾸지 않았고, 이름이 같은 외부 모듈은 거부한다.
기존 V73 입력·배치 계약은 수정 없이 재사용했다. import 경계 테스트 3개, 기존
실제 CPU compile/gradient 테스트 3개, 새 기준선에 기존 안정성 정책을 적용하는
테스트 4개가 추가로 통과했다. 전체 3,788건의 실제 CPU 배치에서도 완전한
원문·설명·EOS·mask·학습 순서와 47종의 동적 가중치가 보존됐다. 검증 데이터는
항상 가중치 없이 monitoring에만 사용한다.

Python 모듈 9개와 고정한 SDK 호출 경계를 검사한 뒤, 원본 0.6B에서 학습률 1e-5·
전체 2,920 update·batch/accumulation 1·seed42·최종 모델만 저장하는 한 번의 학습을
고정했다. 완전한 응답·EOS 대상은 624,170개이며 sequence allocation은 6,144다.
기존 LoRA 구성과 0/200/600/1200/2000/2920의 안정성 검사 기준은 유지했다.
`tuple-full-training-v74/training-seal.json` SHA-256은
`f16bc0605d8ea4362e083a43330993d9697d324ce4a9614abb64a50702c9a724`다.

실제 session56642/PID92415에서 학습을 시작했다. 초기 안정성 검사 48건·10,803개
대상이 통과했고, SDK callback `b11423`에서 첫 **20회 optimizer update·4,283개
완전한 응답/EOS 대상**의 실제 완료를 확인했다. 학습 loss는 행별 가중치가 적용된
값이므로 기준선의 가중치 없는 NLL과 직접 비교하지 않는다. 이는 전체 학습 완료나
새 함수 설명의 품질·속도 증명이 아니다. 전체 2,920회·모든 안정성 검사·최종
가중치 무결성·해제 검증은 계속 진행 중이며, 새 독립 함수의 전체 설명과 실제 Host
3초 검증 전에는 기본 모델·버전·설치본을 바꾸지 않는다.

V74의 실제 callback `24a393`에서 **640회 update·136,574개 응답/EOS 대상**의
완료를 확인했다. 200회와 600회의 고정 안정성 검사가 통과했으며, 학습 전용
48건의 평균 NLL은 초기 3.05077에서 각각 1.65279, 1.05188로 내려갔다. 이는
학습 중 퇴행을 검사한 결과다. 새 함수 설명의 정확도나 3초 완료를 증명하지
않으며, 일부 update만 끝난 상태를 전체 학습 완료로 처리하지 않는다.

V75는 학습 종료 후 사용할 독립 CPU 검증 도구를 고정했다. 원문에 연결된 전체
응답/EOS 벡터, 모든 학습 순서·유리수 가중치·실제 optimizer 보고, 최종 LoRA
배열 224개의 이름·F32 타입·shape·유한값·파일 범위와 메모리/RNG 해제를 검사한다.
손상·부분 trace·잘못된 순서/가중치·성급한 종료 주장 등을 거부하는 CPU 테스트
18개와 Python 모듈 10개의 파싱이 통과했다. 이미 끝난 0/200/600회 검사의
원본 벡터도 독립적으로 재계산해 확인했다.
`tuple-final-verification-v75/preparation.json` SHA-256은
`f86749a6c7ad0d789a0878719422f590dfee28c1adcc9ffcb7bfb8b061dbbf6a`다.

실제 session56642의 terminal과 PID92415의 종료를 확인해야 최종 검증을 시작할
수 있다. 실행 중인 상태에서 두 preflight가 완료 기록과 최종 검증을 거부하는
것도 실제 확인했다. 이 준비 작업은 모델 로딩·추가 학습·설명 생성을 하지
않았고, 기존 학습 소유권을 유지했다. 최종 검증이 통과해도 새 독립 함수의
전체 설명과 실제 Host의 3초 검사는 별도로 필요하다.

## 새 숫자 반환 함수의 독립 검증 준비

V76은 실패한 두 algorithm family를 재사용하지 않고, 증가 비용의 예산 내 합계를
구하는 `affordablePrefix(limit, budget)`를 작성했다. 음수 예산은 -1, 반복 없음은
0이며, 1·2·3…의 다음 비용이 남은 예산보다 크면 더하기 전에 현재 합계를
반환한다. 다음 비용과 남은 예산이 같으면 더한다. 이는 기존 단일 값의 고정
threshold 증가, Euclidean remainder 교환, 두 문자열의 mismatch 집계와 목적·
상태 의존성·조기 종료가 다르다. 전체 학습·검증 원문과의 hash 중복 검사도
수행했으며, hash 부재만으로 의미상 새 family라고 판단하지 않는다.

Kotlin/TypeScript 및 한국어/영어의 네 action에서 전체 **16개 경로·88개 소스
occurrence·16개 저장 페이지**를 기존 Host/native parser와 validator로 전달하고
정리하는 것을 확인했다. 기존 certified 예시 14개는 독립 계산과 대조했고,
나머지 2개도 완전한 원문 경로에 도달하는 독립 정답으로 작성했다. 경계값과
2,460개 입력의 별도 삼각수 공식 대조를 포함한 테스트 5개가 통과했다.

첫 읽기 전용 probe는 한국어 alternative가 ASCII 식별자로 시작해 기존 언어
pattern에 거부됐다. 정답 문구의 시작을 고친 뒤 모든 경로가 통과했으며,
validator는 변경하지 않았다. 전체 설명 필드·값·confidence·unknown은 유지한다.
`three-second-budget-heldouts-construction-v76.json` SHA-256은
`bd6242a1144ad92c131852ab4f5b1df157c5624cd07a20053a00e6d1415e4bfd`다.

이는 모델 응답을 읽지 않고 작성한 offline 정답이며 학습 데이터에 넣지 않는다.
새 gate 전체의 tuple prompt·grammar·토큰 증명과 최종 모델 무결성 검증 전에는
neural 평가에 사용하지 않는다. 이번 준비 작업을 모델 정확도·속도 개선으로
해석하지 않으며, 공개 버전과 설치본은 0.0.1145를 유지한다.

## 전체 학습 종료와 최종 입력 검증

V74의 실제 session56642는 terminal `f86e93`에서 exit0으로 종료됐다. PID92415의
부재도 별도로 확인했다. 전체 **2,920회 update·624,170개 응답/EOS 대상**을
처리했고, 0/200/600/1200/2000/2920의 여섯 고정 안정성 검사가 모두 통과했다.
학습 시간은 약 **137.108분**이었다. 종료 후 MLX active allocation은 원래
**8 bytes**로 복귀했으며 모델·optimizer 소유자 해제와 외부 MLX/NumPy RNG
복구가 확인됐다. 설명 sampling과 새 함수의 실제 모델 요청은 없었다.

V75 독립 CPU 검증에서도 146개의 실제 optimizer 보고, 모든 원문/응답/순서/
유리수 가중치와 여섯 원본 안정성 벡터를 확인했다. 최종 adapter는 F32 배열
224개·parameter 2,883,584개였고 이름·shape·유한값·파일 범위와 hash 검사가
통과했다. 학습 전용 48건의 평균 NLL은 3.05077 → **0.20594**였다. 이 수치는
새 함수 설명의 정확도나 속도 증명이 아니다.
`tuple-final-verification-v75/verification.json` SHA-256은
`7b055110ea398cd56abd7914792f1bf0bd808e4ceec3ca4065442cefc4f2ec83`이며,
최종 adapter SHA-256은
`75f162ab47ef4f8fa25eeac279c74533fd3b1a112b23988200fa13bb18b11870`다.

V77은 기존의 미노출 action 32개와 새 숫자 반환 action 4개를 결합해 전체
100개 요청을 구성했다. 모든 원문·전체 설명·다섯 반환 타입·호출 scope를
보존했다. 200개의 기존/새 native grammar와 EOS 소비는 통과했지만, 한국어
요청 2개는 출력 허용량을 포함해 원래 입력 창을 초과했다. V78–V81의 읽기
전용 크기 검사 결과도 보존했으며, 소스·출력·경로를 자르거나 한도를 늘리지
않았다. 실패한 준비본은 채택하거나 학습/모델 요청에 사용하지 않았다.

V82는 반복되는 compiler 스키마/안내를 참조로 묶고, owner 메타데이터의
이중 JSON 인코딩과 const 래퍼를 손실 없이 표현했다. 빈 배열만 허용하는
스키마는 동등한 `const: []`로 나타내고 원래 구조로 정확히 복원한다. 원래
task 지시는 모두 유지하며 새 compiler alias 설명만 명시적으로 덧붙인다.
native 응답 schema·모델이 작성할 설명/값·함수와 부모/callee 원문·confidence·
unknown은 그대로다. 최종 단위 테스트 2개와 실제 Host/저장 페이지/취소/대기
순서/해제 테스트 8개가 통과했다.

V83은 학습 2,920건·monitoring 868건·새 평가 요청 100건의 **전체 3,888건**을
실제 CPU tokenizer와 원본 토큰 배열로 대조했다. 모든 응답/EOS 토큰이
동일했고, 전체 입력 창·출력 허용량·stdio 한도를 통과했다. prompt 토큰이
늘어난 행은 0개였다. 새 요청 100건의 합계는 318,663 → **308,854**토큰,
최대 입력은 5,779토큰이었다. 기존 출력 허용량 2,400을 더한 **8,179**는
원래 창 8,192 이내다. 이 projected 사본으로 추가 학습하지 않았다.
`full-packed-input-v83/decision.json` SHA-256은
`0a06eca2446fa3b17aeba996be389e359b65d24603449fc6bf63118599b22d06`다.

이후 최종 모델의 tensor/fusion·numeric·joint·runtime 검증을 완료하고 새
독립 함수의 실제 모델 응답을 측정했다. 결과는 다음 절과 같다. 공개 버전과
설치본은 0.0.1145를 유지한다.

## 최종 작은 모델의 실제 전체 설명 평가

V84는 최종 V74 adapter만 사용해 원래 SDK로 한 번 fusion했다. 독립 CPU
검사에서 **704개 tensor**의 이름·shape·dtype·유한값·파일 범위를 확인했다.
adapter가 적용된 336개는 모두 변경됐고, 나머지 368개는 원래 base와 byte
단위로 같았다. canonical tokenizer/template 복원 중 가중치는 변경되지
않았다. 최종 Q4/group128 가중치 파일은 **316,825,700 bytes**이며 SHA-256은
`f6d776da569023dc69ef1188661a758c6f5f449398e8ea68d6b7ea0333f75b30`다.

V85의 수치 검사에서는 기존 계산과 전체 logits·28개 layer의 KV cache가
byte 단위로 같았다. 원래 짧은 geometry와 전체 학습 최대 길이 **5,181**,
전체 inference allocation **8,192**를 유지했다. projection/compiled 비교
각 51개, 별도 MLP 비교 336개, inference window 비교 각 19개가 통과했다.
모든 residency 단계는 316,768,264 bytes로 같았고 추가 가중치가 남지 않았다.

V86에서도 기존 **14개 synthetic stream·206개 sampling 전이**를 모두
검증했다. 전체 vocabulary logits/filter/token/RNG key, EOS, 디코딩,
완료 JSON, 명시적 취소 stream의 KV와 소유자 해제 검사가 통과했다. V85와
V86은 코드 소스를 읽거나 함수 설명을 생성하는 시험이 아니다.

V87은 검증된 worker를 byte 변경 없이 연결하고, provider의 worker 경로와
독립 검증된 V82 prompt codec 연결만 바꿨다. 기존 Host, scheduler, validator,
FIFO, 취소와 해제 코드는 유지했다. 모든 원문·응답 필드를 유지하는 CPU
거부/입력 검사 8개와 준비되지 않은 실행 거부 검사도 통과했다. 새 평가
순서는 **36개 전체 action·100개 요청·68개 rich 경로·316개 source occurrence·
40개 호출·92개 저장 페이지·28개 final callee body**로 고정했다. Kotlin/
TypeScript, 한국어/영어, 다섯 반환 유형과 기존 호출 scope를 유지했다.

실제 모델 평가는 첫 action인 Kotlin/한국어 `affordablePrefix(limit, budget)`의
**네 경로를 모두** 요청했다. 모델 준비만 측정 전에 완료했고, 소스 분석부터
전체 응답·기존 검증·페이지 처리·자원 해제까지 하나의 Host timer에 넣었다.
가중치·입력·schema hash가 준비본과 같았고 원문/KV를 다른 요청에서 재사용하지
않았다. 응답을 고치거나 실패한 출력을 잘라내지 않았다.

| 요청 경로 | 실제 출력 token | 검토 결과 |
| --- | ---: | --- |
| 음수 budget의 조기 반환 | 163 | `budget=0`인데 음수 조건을 참으로 설명하고 숫자 반환에 `null`을 출력했다. 설명 필드는 예시 문구나 placeholder였다. |
| 첫 비용을 감당하지 못해 반환 | 957 | 복원된 source 값은 해당 경로와 맞았지만, 모든 node 설명과 summary/analysis가 필드 이름과 반복 문자열이었다. |
| loop 갱신 뒤 종료 | 2,400 | 기존 출력 한도에서 JSON이 끝나지 않았다. node 설명과 analysis에 같은 예시/조건 문구를 반복했다. |
| loop에 들어가지 않고 반환 | 1,921 | 복원된 source 값은 해당 경로와 맞았지만, 덧셈이 없는 경로에 반복 덧셈 문구를 넣었고 원인·상태 변화·alternative 설명이 없었다. |

전체 시도는 **63,363.063 ms**였다. worker의 tokenization/generation은
62,599.704 ms, 전체 packet은 62,682.158 ms였다. 이 측정에서 대부분의
시간은 모델 요청에 쓰였으며, renderer의 실제 시각 성능을 측정한 결과는
아니다. **성공한 전체 설명과 전달 페이지는 0개**이므로 63.4초를 성공한
설명 완료 시간으로 해석하지 않는다. 3초 기준을 통과하지 못했다.

준비된 모델과 요청 종료 후 active allocation은 모두 **316,768,264 bytes**였다.
MLX peak는 3,070.094 MiB, process peak RSS는 693.672 MiB였다. worker는
요청 상태를 남기지 않고 정상 종료했고, 평가 runner의 실제 exit1과 양쪽
PID 부재를 별도로 확인했다. 전체 raw 요청·native 응답·복원된 응답·실패를
보존했다. 별도 의미 검토는 네 요청의 모든 raw 출력, 완결된 세 응답의
**151개 leaf field**, 미완결 응답의 전체 partial 출력과 필수 필드 거부를
포함한다. JSON 완결 여부와 설명의 정확도는 별도로 판단했다.

첫 action 실패로 현재 평가 계획은 종료했다. 나머지 35개 action은 실행하지
않았다. 실패한 전체 budget 알고리즘 family는 가중치·이름·연산자·언어·locale·
scope 변경으로 재시험하지 않는다. 기준·원문·설명 필드·LLM 역할을 축소해
통과시키지 않는다. 이 0.6B 후보는 기본 모델로 채택하거나 설치하지 않았다.
다음 개선에서는 실제로 관찰된 설명 일반화 실패와 반복 출력, 전체 모델
요청 비용을 함께 해결해야 한다. **전체 설명 3초 목표는 미달성**이다.

주요 증거 SHA-256은 다음과 같다.

- tensor proof: `77b96bc46be04f66bb735944260f444e78b17b22e31555296b4f2c004bdc24e9`
- numeric proof: `2607e7cb5145f9dcc53db99b66cfe6f9966e3c3081efe07507f675aad3b87a72`
- joint proof: `28a10fa1d7e1ccb950ae0d3f800270bbbdaeb424a37e2e03cc84bf9effdb8879`
- runtime binding: `60ac66358523c0f9f4fdaae8a797176e0cdbf627e3cf878ef0ab4a044ad48438`
- closed plan: `d79929b681343d05e49ac419b1f5f0dd8b46757f50edca834004ef86921fda82`
- actual action report: `3d036783a4b64fb251d8cc154ac200b22538cbef3eadfeb8fb1a61963aae2864`
- separate meaning review: `801650f2e7d3ae70392ecc784dd6e9b484182d1f89bf74f7fe582bd311260fba`

## 구간별 비용 측정과 입력 묶음 검증

V87에서 실제 모델 요청이 전체 시도의 대부분을 차지했으므로, 다음 작업은
모델 내부 비용을 분리하는 source-free 진단이었다. 실패한 실제 함수 family를
다시 요청하지 않았다. 준비된 모델에서 원래 worker·MLP·sampler·문법·평가
barrier를 유지한 채 Python 표준 `cProfile`을 사용했다.

첫 V88 진단은 모든 synthetic 출력이 같았지만 종료 allocation이 **16 bytes**로
남아 원래 **8 bytes** 검사에 실패했다. V89의 모델 없는 복구 probe도 RNG
state의 item assignment를 지원하지 않아 실패했다. 두 최초 결과를 보존하고
코드를 수정하거나 동일 실행을 다시 하지 않았다.

MLX 0.32.3의 state는 thread-local key를 읽는 sentinel이고, `key(uint64)`는
상위/하위 uint32 두 word로 구성된다. V90은 저장한 두 word를 uint64로
복원해 지원되는 `seed()` API로 원래 key를 돌려놓았다. 모델 없는 실제 GPU
probe에서 sentinel identity, 원래 다음 default 난수와 advanced key,
최종 **8-byte allocation**을 확인했다. 이 변경은 실험 도구의 종료 처리이며
extension과 request sampler를 바꾸지 않는다.
[MLX state 구현](https://github.com/ml-explore/mlx/blob/v0.32.3/python/src/random.cpp),
[MLX key 구현](https://github.com/ml-explore/mlx/blob/v0.32.3/mlx/random.cpp).

V90의 모델 진단에는 길이 **3,289/4,911/5,675/4,587**의 EOS 정수 token 입력과
48개의 작은 정수만 생성하는 synthetic JSON grammar를 사용했다. 함수 원문,
instruction, reference 설명은 모델에 주지 않았다. 일반 실행과 profile 실행의
**전체 8개 stream**이 완결됐고 raw JSON·48개 값·종료 사유·출력/추가 draw
수가 모두 같았다. 각 stream은 98개 출력 token과 99개 draw를 기록했다.
종료 후 원래 RNG와 8-byte allocation을 복구했고 실제 exit0 및 PID 부재도
확인했다.

일반 실행은 **8,440.892 ms**, profile 실행은 **5,009.913 ms**였다. 둘은 같은
로직이며 이 시간 차이를 최적화 효과로 사용하지 않는다. profile 구간은 다음과
같다. 구간 시간은 내부 호출을 포함하고, mask 시간은 sampling에 포함된다.

| profile 구간 | 시간 |
| --- | ---: |
| 모델 입력 처리(prefill) | 2,483.547 ms |
| 다음 token의 모델 계산과 평가 barrier | 2,297.039 ms |
| mask·정규화·sampling과 평가 barrier | 197.636 ms |
| native mask만 측정한 내부 호출 | 15.191 ms |
| 최초 schema compiler | 1.752 ms |

이 값은 CPU wall time과 GPU 동기화 대기를 포함하며 GPU device timestamp가
아니다. 실제 함수의 tokenization·설명 품질·전체 Host 완료 시간도 측정하지
않았다. 관찰된 주요 비용은 모델 입력 처리와 반복 forward였다.

V91은 완전한 **512-token BF16 입력 묶음**을 원래 MLP에 함께 보내는 하나의
고정 후보를 구현했다. 모든 UID와 입력 행을 보존하며, singleton·짧거나 섞인
길이·decode 형태·F32는 원래 호출을 유지했다. 새 가중치나 precision 변경은
없었다. CPU contract 검사 4개가 통과했다.

속도 측정 전에 실제 최종 모델의 **28개 MLP·308개 cohort·1,400개 출력**을
원래 comparator로 비교했다. 전체 shape/dtype/finite/byte 검사가 통과했다.
입력에는 signed zero와 subnormal도 포함했다. 가중치 객체 identity와 종료
residency는 유지됐고, 마지막 allocation은 8 bytes로 복구됐다.

이후 각 조건의 3회 warmup과 순서를 번갈아 수행한 23쌍을 모두 보존했다.
고정 기준은 8개 묶음에서 2배 이상 가속, singleton 비용은 1.05배 이하였다.

| 조건 | 원본 median | 후보 median | 원본/후보 속도 배율 | 판정 |
| --- | ---: | ---: | ---: | --- |
| BF16 8개 묶음 | 289.131 ms | 290.484 ms | 0.9953 | 2배 가속 기준 실패 |
| BF16 singleton | 31.995 ms | 32.195 ms | 0.9938 | singleton 비용 한도 통과 |
| F32 singleton | 43.782 ms | 43.073 ms | 1.0165 | singleton 비용 한도 통과 |

전체 후보는 실패로 기록했다. 좋은 조건만 골라 채택하거나 기준을 바꾸지
않았고 동일 후보를 다시 측정하지 않는다. whole-model cache/취소 통합이나
실제 함수 요청에 사용하지 않았다. V90/V91은 입력 비용과 계산 비용의 다음
최적화 대상을 좁히는 근거이며, **전체 설명 3초 목표를 증명하지 않는다**.
설치본과 공개 버전은 0.0.1145다.

- V90 실제 종료·profile 증거: `a39272d3639e3578eb20620c8738d1576d08ee6187839da3d0a3f3b4e32cf36b`
- V91 전체 수치·성능 거부 증거: `91caf14b8ddb867dafa24db9d7e56c024fc963067a947d773dcacf68fbc6f813`

## 전체 준비 입력의 토큰 비용과 새 스키마 표현 거부

2026-10-12 인계 이후에는 종료된 실험을 재시작하지 않고, 기록된 다음 작업인
전체 준비 입력의 CPU 비용 분석을 수행했다. V92는 기존 V83의 **2,920개 학습
입력·868개 monitoring 입력·100개 준비 평가 입력**, 합계 **3,888개**를 읽었다.
이 입력을 다시 학습하거나 실제 모델에 요청하지 않았다. 금지된 함수 family의
원문을 CPU로 읽는 것과 neural 재시험은 구분했다.

원래 tokenizer와 chat template로 각 전체 입력을 처리해, 저장된 전체 prompt
token 배열과 **모든 byte가 같은지** 확인했다. 같은 token을 두 구간에 더하지
않도록 실제 offset으로 비용을 분해했다. 경계를 가로지르는 token은 별도로
집계했다. JSON의 `const`, 설명, 원문 문자열을 schema로 오인하지 않았으며
모든 입력의 구간 합계가 원래 전체 token 수와 일치했다.

| 전체 입력 묶음 | 전체 prompt token | 원래 지침 | compiler schema·metadata | 원문 본문 문자열 |
| --- | ---: | ---: | ---: | ---: |
| 학습 입력 2,920개 | 6,910,212 | 48.19% | 18.39% | 3.00% |
| monitoring 입력 868개 | 2,032,388 | 47.96% | 16.53% | 3.57% |
| 준비 평가 입력 100개 | 308,854 | 42.96% | 27.54% | 3.54% |

표의 지침은 system·task·output instruction 합계다. compiler 항목에는 전체
source/slot binding, schema keyword·제약·설명·소유자 annotation·manifest가
포함된다. 원문 본문은 `snippets[].text` 문자열 구간만 뜻하며, 나머지 source
facts·조건·역할·호출 정보는 별도 집계했다. 이 비율은 입력 token 비용이고
모델의 GPU 시간이나 실제 함수 설명 완료 시간의 비율은 아니다.

V93은 이 근거에서 출발한 **하나의 고정된 새 prompt 표현**이었다. 인접한
문자열 type/길이/pattern, 배열 길이/추가 항목 제약을 짧은 그룹으로 묶고,
canonical `$comment` JSON을 한 번만 인코딩했다. 모든 compiler object는
키 순서까지 원래 JSON으로 복원했다. 원문·부모/근접 callee·소스별 설명·
전체 지침·native schema·모델이 작성할 전체 값과 설명 필드는 그대로 두고,
표현 해독 지침만 명시적으로 추가했다. 충돌·미지원 입력과 이득 없는 입력은
원래 요청 전체를 사용했다. 원래 출력과 EOS의 **861,213개 target**도 모두
저장된 배열과 byte가 같았고, 기존 window·output·stdio 한도를 유지했다.

| 전체 입력 묶음 | 원래 prompt token | 후보 prompt token | 입력 token 증가 사례 |
| --- | ---: | ---: | ---: |
| 학습 입력 2,920개 | 6,910,212 | 6,881,525 | 1,204개 |
| monitoring 입력 868개 | 2,032,388 | 2,027,362 | 384개 |
| 준비 평가 입력 100개 | 308,854 | 306,778 | 12개 |

전체 원문을 보존하는 역변환 자체는 통과했지만, 해독 지침까지 포함한 실제
전체 token 비용은 **1,600개 입력에서 증가**했다. 합계 절감도 **35,789 /
9,251,454 token, 0.386847%**에 그쳤다. 전체 입력의 token 비증가 기준을
통과하지 못해 **후보 전체를 거부**했다. 유리한 입력만 고르거나 기준을
완화하지 않았으며, 같은 표현을 수정해 재실행하지 않는다.

비용 집계의 source/offset 경계 검사 7개와 새 표현의 정확한 역변환·literal
격리·예약 키 충돌·cycle/depth·전체 fallback 검사 9개가 통과했다. 실제
전체 audit은 V92 exit0, V93 construction exit0, V93 token audit exit1로
종료했고 소유한 audit PID의 부재를 확인했다. 모델·GPU 실행과 학습은 0회다.
제품 코드, 설치 모델과 공개 버전 0.0.1145는 바꾸지 않았다.

이 결과는 단순한 schema 축약만으로 현재 지연과 품질 문제를 해결할 근거가
부족하다는 뜻이다. 다음 개선은 실제 decode 계산/스케줄링에서 새 병목을
해소하거나, 전체 맥락과 LLM 책임을 유지하는 설명 품질 개선의 근거를 먼저
확보해야 한다. **정확한 전체 설명 3초 목표는 계속 미달성**이다.

- V92 전체 비용 증거: `485d7e4bc072b13efe2f9b018505004d8fd9536293d5a1f6dc4b09bbd807788e`
- V93 전체 token/target 증거: `219d29e351c224101bf39f7eb82f865ea08d12c0bd64f22c50a60104aef7fa01`
- V93 전체 거부 결정: `05dd6f23935e579184e064ebf73ee74fb04d63de21059ff6490c254a66c643d5`

## Decode 수치 거부와 runtime에 맞춘 전체 학습 입력 준비

V94는 이전 V91의 512-token prefill 묶음과 구분되는 **단일 token decode
MLP 행 묶음**을 구현했다. 기존 M=1 batch-axis projection과도 달리 원래
2차원 quantized weight에 M=2/4/8 행을 전달했다. 가중치·dtype·양자화·
SwiGLU·전체 출력·UID를 보존했지만, 다른 행 geometry의 반올림 결과가
같다고 가정하지 않고 먼저 실제 모델에서 검증했다.

원래 28개 MLP에 대해 BF16 1/2/4/8개, 순서가 다른 UID, F32, prefill,
mixed-length fallback을 포함한 **1,372개 전체 출력 비교**를 수행했다.
원래 shape/dtype/finite/byte comparator를 변경하지 않았다.

| 실제 비교 조건 | 비교 수 | 원래 출력과 byte가 다른 수 |
| --- | ---: | ---: |
| BF16 decode 2개 묶음 | 56 | 56 |
| BF16 decode 4개 묶음 | 112 | 112 |
| BF16 decode 8개 묶음 | 224 | 224 |
| 순서가 다른 BF16 UID 8개 묶음 | 224 | 224 |
| 원래 singleton/F32/prefill/mixed fallback | 756 | 0 |

모든 묶음의 모든 층에서 수치 동일성을 통과하지 못해 **후보 전체를 거부**했다.
수치 실패 후 속도를 측정하지 않았다. 가중치 객체 identity와 종료 시
**316,768,264 model bytes**는 유지했고, 외부 RNG를 복구한 뒤 최종 allocation은
원래 **8 bytes**였다. 실제 exit1 및 PID 부재를 확인했다. source/model 설명
요청과 sampler draw는 0회다. 이 결과는 MLP 연산의 검사이며 whole-model
logits/KV/문법/sampling/실제 설명 품질·Host 시간의 새 검증은 아니다.

이후에는 실제 학습 입력과 runtime 표현·반환 범위의 차이를 CPU로 확인했다.
V95의 첫 전체 감사는 monitoring에서 빠진 반환 유형도 정확히 두 개일
것이라는 검사 가정이 잘못되어 중단됐다. 첫 코드·실패·실제 exit1을 보존했다.
V95 전체 감사를 통과했다고 기록하거나 수정해 재실행하지 않았다.

V96은 별도의 **전체 runtime-aligned 학습 입력 준비**다. 실제 V74 seal이
지정한 **2,920개 학습·868개 monitoring**, 합계 **3,788개**의 모든 원문,
context, native schema, 모델 정답, confidence/unknowns, split과 행 순서를
보존했다. 입력 message만 이미 검증된 최종 V83 runtime 표현과 맞췄다.
**학습 143개·monitoring 48개**의 message가 바뀌었으며, 나머지는 그대로다.
전체 **827,145개 native target/EOS**와 input/window/grammar 증거는 불변
V83 결과와 정확한 identity로 연결했다. 새로운 tokenization이나 neural
품질 검사를 했다는 뜻은 아니다. 준비된 평가 source/teacher를 학습 자료에
넣지 않았다.

이 준비본에는 원래 실제 학습 입력에 없었던 세 compiler 표현이 포함된다.
현재 저장된 실제 V87 실패 요청 네 개는 모두 학습에서 보지 못했던 V82
comment 표현을 사용했었다. 그러나 이 차이나 아래의 범위 누락만으로 이전
설명 실패의 원인을 증명하지는 않는다. 입력을 맞춘 자료를 준비한 것이며
모델을 다시 학습하거나 요청한 결과는 아니다.

| rich 작업의 실제 선언 반환 유형 | 학습 행 | monitoring 행 |
| --- | ---: | ---: |
| numeric | 188 | 84 |
| Boolean | 24 | 8 |
| String | 24 | 0 |
| nullable numeric | 0 | 0 |
| nullable String | 0 | 0 |

nullable parameter가 있는 예제를 nullable return 예제로 세지 않았다.
call task의 선언 반환 유형도 자료에 없는 경우 추측하지 않았다. 전체 root
읽기에서 다섯 반환 유형×Kotlin/TypeScript×한국어/영어의 **20개 조합**을
따로 확인했으며, 학습에서는 nullable 반환 **8개 조합**, monitoring에서는
String/nullable 반환 **12개 조합**이 비어 있다. node/summary-only 예제나
다른 locale의 예제로 이 누락을 숨기지 않았다.

새 준비본의 입력 표현 차이는 해소했지만 실제 반환 유형 누락이 남아 있어
**학습 허용 상태는 false**다. 기존 자료를 전부 유지하면서 금지된 family나
reserved 평가 source와 다른 새 원문으로 해당 root 읽기 조합을 보완해야
한다. 이후에도 전체 teacher 의미·native grammar/token/소유권을 확인하고,
실제 새 모델의 모든 scope 의미와 전체 Host 3초 검증을 통과해야 한다.
세 단계의 CPU 계약 검사는 합계 **15개**가 통과했다. 새 학습·실제 함수
neural 요청·제품 변경·설치는 없고 **3초 목표는 계속 미달성**이다.

- V94 수치 거부 결정: `187b95ef6f917b7691386bd25f5543d71f798492a316836c0476577073c1e292`
- V95 최초 CPU 감사 실패: `36a924e284758054a0e1f984929cef238ddfb1b1ee7d28a6b3484bb421da549f`
- V96 전체 입력 준비: `e0da4a69155778f036430842715eef681c5af520960c6e0f4766a96a0dcb50e9`
- V96 실제 종료·누락 판정: `1ae05e896366cf7f0c6eea07227655a30b80983f4d703368e30c683b5d7c234c`

## 실제 nullable 반환·String monitoring 범위 보완

V97은 V96에서 확인한 누락을 보완하는 **새 원문 10개·52개 전체 root 예제**를
작성했다. 학습에는 실제 null/Boolean guard 뒤에 nullable numeric/String을
반환하는 두 family, monitoring에는 Boolean으로 고르는 String, ceiling과
비교하는 nullable product, 빈 문자열을 검사하는 nullable concatenation의
세 별도 family를 추가했다. 기존 학습·monitoring·예약 평가 source와의 전체
원문/hash/정규화 source 부재와 whole-algorithm 의미 차이를 함께 검토했다.
세 영구 neural 금지 family와 이전 parent/helper 금지는 유지했다.

첫 독점 V97 생성은 TypeScript live worksheet의 `owns` 함수가
`structuredClone`에 전달돼 실패했다. 최초 코드·실패·실제 exit1을 보존하고
수정해 재실행하지 않았다. V98은 **live 소유권 검사와 JSON 감사 snapshot을
구분하는 adapter**를 추가했다. model payload와 source-certified 값은 원래
live context에서 처리하고, 모든 직렬화 가능 source/graph/type/data를 snapshot에
보존했다. callable 경로와 소유권 검사 receipt는 따로 남겼다. snapshot을
runtime worksheet로 사용하지 않으며 실제 runtime은 전체 source에서 다시
구성해야 한다. 역치환으로 원래 V97 builder의 모든 byte가 복구된다.

V98 실제 생성은 원래 Host/provider/native codec/validator와 디스크 페이지
저장을 사용했다. Kotlin/TypeScript×한국어/영어의 **20개 action·52개 전체 경로·
148개 source occurrence**가 모두 전달됐고 페이지·capture 자원도 닫혔다.
학습 24행과 monitoring 28행을 추가해 **2,944개 학습·896개 monitoring**이
됐다. 기존 3,788개 행의 원문·context/schema·정답·split·순서는 그대로다.
source-certified 예제 44개는 독립 scalar reference와 비교했고, 나머지 8개는
실제 경로와 모든 graph occurrence를 만족하는 예제를 독립적으로 골랐다.

| rich 작업의 실제 선언 반환 유형 | 학습 행 | monitoring 행 |
| --- | ---: | ---: |
| numeric | 188 | 84 |
| Boolean | 24 | 8 |
| String | 24 | 8 |
| nullable numeric | 12 | 8 |
| nullable String | 12 | 12 |

학습과 monitoring 모두 다섯 반환×두 언어×두 locale의 **20개 full-root
조합**이 채워졌고 runtime compiler 표현의 미노출도 남지 않았다. 자료의
존재를 실제 모델 일반화나 3초 완료의 근거로 사용하지 않는다.

전체 **3,840행**의 실제 token 배열을 생성해 모든 기존 **827,145개 target/EOS
byte**를 보존했다. 새 52개 native/object grammar pair는 완성된 실제 target
token과 terminal EOS를 모두 받아들였다. 합계 target/EOS는 **840,699개**,
최대 전체 sequence는 **5,059 token**이다. 원래 8,192 window·2,400 output·
196,608-byte 요청 한도 안에서 모두 통과했다. source/target/EOS를 자르거나
monitoring·reserved teacher를 학습으로 옮기지 않았다.

별도 의미 검토는 실제 선택 입력에 대한 controlled TypeScript oracle,
Kotlin 예제의 같은 범위 정수 연산, **1,788개 original teacher leaf·748개
model prose field·148개 source occurrence**를 포함했다. 모든 고유 한국어/
영어 문장을 읽었고 원문 연산·null 결과·분기·지역 상태·전체 목적을 확인했다.
String monitoring의 source-certified active/inactive 값이 같다는 한계는
명시했으며 branch identity는 원래 code·graph outcome으로 별도 확인했다.
원래 계약이 source-only literal/Boolean prose를 복원하는 경계도 유지했다.
`narrative.steps`를 전체 graph occurrence 목록으로 오인하지 않았다.

reference/경로/잘못된 source/Int overflow 검사 6개와 live worksheet/snapshot
격리 검사 3개가 통과했다. 생성과 token audit의 실제 exit0, 소유 PID 부재,
증거 hash를 확인했다. **새 model load·학습·source neural 요청·설치는 0회**다.
학습 전에는 전체 자료의 기존 equal-per-source-component/completion objective,
실제 SDK shuffle/loss/mask stream과 final-only 안정성·자원 보존을 검증해야
한다. 이후 새 고정 전체 pass 후보와 실제 all-scope 의미·전체 Host 3초
기준이 필요하며 **목표는 계속 미달성**이다.

- V97 첫 생성 실패: `2ba864544b9541c8e3f6bc59f9c3bd407094d5287a0bed76da1e11a0c59fcfd3`
- V98 전체 생성: `7f4bde4780084d73d356cf768a93641519b978ccde0b6be7519ccdb0f92b61bc`
- V98 전체 token/grammar/EOS 증거: `b947fb0e1db371c6d83ab0b29f711ce1dbafec56d055c26863d5a9b64a54108b`
- V98 전체 teacher 의미 검토: `9e48a1096c4882682a62509f68fba6a668821fea7abc6b653942f585df73c9f9`
- V98 준비·종료 결정: `2c7b0c00f4bb81e5872b5178b9750646826159b205c6fb72ed6dea45bd84cecb`

## V99: 전체 정렬 자료의 원래 objective와 실제 SDK CPU 스트림

V98 전체 **3,840행**에 원래 equal-per-completion hierarchy를 재적용했다.
기존 classifier·source connectivity·balance·completion/EOS loss는 수정하지
않았고, 새 5개 source family는 검토된 전체 원문·이름·타입·split과 정확히
일치할 때만 별도 adapter에서 허용했다. curriculum의 nullable-input 분류와
실제 root 반환형 coverage를 분리해 기록했다.

기존 **3,788개 source owner와 component identity**를 보존했다. 새 10개
원문을 포함한 component는 **91개**다. 전체 학습 2,944행의 양의 Rational
weight를 다시 계산했고, 각 stage의 objective mass **0.25**, rich primitive
type의 mass **0.05**를 유지했다. 전체 행 수와 family partition이 바뀌어
기존 2,920행의 수치 weight는 달라졌지만 원래 정책은 동일하다. monitoring
896행과 reserved source에는 optimizer weight를 부여하지 않았다.

실제 변경 없는 SDK `iterate_batches`와 원래 V73 public ledger/stream을
사용한 CPU 감사에서 모든 3,840행이 통과했다. stable length sort·seed42
순서, 전체 source/response/EOS byte, **47개 동적 Rational weight**, prompt/
padding 제외와 첫 response/마지막 EOS 포함을 확인했다. 학습 target/EOS
**630,150개**, monitoring **210,549개**를 모두 보존했다. optimizer 보고를
실제 학습으로 시뮬레이션하지 않았다.

policy 6개·array admission 5개·원래 compiled loss/gradient 3개 테스트가
통과했다. 처음 MLX import는 sandbox Metal 접근 실패로 테스트 시작 전에
거부됐고, 필요한 권한으로 같은 CPU 테스트를 실행했다. 전체 SDK 감사는
실제 exit0와 PID 부재를 확인했다. 모델/optimizer/source neural 요청은 0회다.

- 전체 objective: `ede4aab37fb739e72e532d8fd0c0b0f055242e3a1b0ed409b59d2f731e2ea1a5`
- 실제 전체 SDK CPU 증거: `3e500f7c5cf7c61f482206b31b6f8280f91347c4139a86ba00b728cafc257a05`
- V99 준비·종료 결정: `bdd55ccc172ef8ca0108cd99b888b3f858f6e6cc17411f1f28e332a9e1c71776`

## V100/V101: 전체 새 반환 자료의 안정성 검증과 고정 전체 학습 시작

V100은 원래 **48개 training-only owner·24개 group**을 현재 전체 입력에
다시 연결하고, **새 nullable 학습 24행 전부**를 추가했다. 총 **72행·32개
group**이며 monitoring/heldout을 선택하지 않았다. 원래 V54 evaluator와
모든 수치 기준·검사 시점 **0/200/600/1200/2000/2920**은 유지한다.
원래 final2920 improvement 검사도 남기고, 실제 마지막 update **2944**의
검사를 추가했다. 원래 48행과 새 24행의 global/group 검사는 독립적이어서
추가 행의 개선이 기존 행의 악화를 가리지 않는다.

원본 0.6B 모델을 한 번 로드해 원본과 zero-B LoRA에서 **144회**의 전체
teacher-forced forward를 실행했다. 각 variant의 전체 **16,783개 target/EOS**
NLL vector를 보존했다. 원래 48행 평균 NLL **3.0483297103**, 새 24행 평균
**3.3660131448**, zero-LoRA 평균 NLL 최대 차이 **0**이며 두 initial guard가
통과했다. RNG 보존·원래 active allocation **8 bytes**로 해제·실제 exit0·
소유 PID 부재를 확인했다. 97,356.788ms는 이 진단 전체 실행 시간이며
설명 지연 측정이 아니다. policy/admission 8개 테스트가 통과했다. 이
실행에는 optimizer·sampler·설명 요청·adapter 저장이 없다.

V101은 원래 V74 trainer를 변경하지 않고 역변환 가능한 전체 byte recipe로
새 trainer를 만들었다. 변경은 자료 수, V100 public guard 연결, 버전/상태,
학습 후 canonical asset hash 확인이다. 원래 학습률 **1e-5**, **1 epoch**,
seed42, batch/accumulation1, LoRA layers16/rank8/scale20/dropout0, BF16 base/
F32 adapter, SDK gradient checkpointing, allocation6144, memory10GiB/cache256MiB,
time10200seconds, **final-only** 저장을 유지한다. iterations2944·maxSequence5059는
전체 자료에 따른 값이다. 이전 adapter를 로드하거나 setting sweep을 하지
않는다. 추가 fixed trainer admission 3개 테스트와 preflight가 통과했다.

실제 **한 번의 전체 학습**을 시작했다. 실행 세션은 **12644**, 소유 PID는
**15853**이고, optimizer 전 iteration0의 원래 48행·새 24행 guard가 통과했다.
최종 adapter와 2,944개 완료 update 증거는 아직 없다. 진행/종료 상태는
`checkpoint.json`, 실제 `completed-update-reports.jsonl`, `training-result.json`
및 해당 소유 세션으로 확인한다. 종료되거나 실패한 attempt를 재시작하지
않으며 다른 모델을 동시에 로드하지 않는다.

- V100 전체 panel: `fd7e797f3625ec693806bdbef12d585dfdb89db05fc492946008b877594929b0`
- V100 실제 fresh/zero-LoRA baseline: `e0ac907fcfd5e762d7c7d8b2027442afacd16571923d5f2fbaa77e83f47af038`
- V100 준비·종료 결정: `e688b67a45a8d6d3a8efafaa61f437c9b72d49669614fe0786c8fc023e6468a6`
- V101 단일 전체 학습 seal: `3eda9323bab85025856a11c1540ebd77a632d1558802b4ddd6eadfd430f20022`

현재까지 제품 코드·설치 버전은 **0.0.1145** 그대로다. 전체 학습·최종
무결성/해제 후에도 새로운 non-banned family의 모든 scope/field/route에
대한 실제 모델 설명 의미·정확성 및 올바른 전체 Host **≤3000ms** 검증이
필요하다. **목표는 아직 미달성**이며 실패 후보를 출시하거나 설치하지 않는다.

## V102/V103: 새 숫자 family와 전체 92개 frozen 평가 요청 준비

영구 금지된 숫자 family를 `calculated-nonnegative-difference-factor-product`
라는 새 전체 소스로 교체했다. `left-right`의 계산 결과가 음수면 0을,
그 외에는 그 결과와 `factor`의 곱을 반환한다. factor의 부호를 검사하지
않으므로 반환 곱은 음수일 수도 있다. remainder·String mismatch·budget
loop 및 새 nullable 학습 family와 다르며, 학습/monitoring 자료에 넣지
않았다. Kotlin/TypeScript·한국어/영어의 모든 **4 action·8 path·28 source
occurrence**를 유지했다.

독립 TypeScript VM/Kotlin Int 연산, 음수 factor·동등 경계·Int overflow·
signed zero·전체 graph/prose/value/final 필드 검사 5개가 통과했다. 첫 draft
테스트의 TypeScript `-0` 기대값 오류와 원래 schema 길이를 넘은 참고
문구 실패는 독점 생성 전에 보존·수정했다. 원래 기준을 완화하지 않았다.
실제 Host/codec/validator/디스크 해제와 8개 native/object grammar/EOS pair,
전체 **29,616 prompt token·3,124 target/EOS·maxSequence5,011**을 검증했다.
별도 의미 검토는 **336 teacher leaf·152 prose field**를 포함했다. 모든
고유 KO/EN 문구를 읽었다. 실제 source-certified 예제의 두 경로 결과가
모두 0이라는 한계를 명시했다. 값만으로 곱셈이나 경로의 정확성을 판정할
수 없으며 원문·code·graph·전체 설명과 분석을 함께 검토해야 한다.

V103은 이 새 8개 요청과 기존 **32개 미실행 non-banned action의 84개
요청을 전부** 합쳤다. 종료된 V77/V87 executable catalog/builder를 호출하지
않고 원래 V77 자료와 실제 V83 전체 입력을 불변 hash로 직접 연결했다.
모든 caller/callee source, context, schema, 자유 prose/value, confidence/
unknowns, compiler 밖 지침과 fallback 요청을 보존했다. 원래 scope를
줄이거나 유리한 행만 고르지 않았다.

전체는 **36 action·92 request·60 rich route·256 source occurrence·40 call·
84 disk page·28 final callee body**다. 다섯 반환형×KT/TS×KO/EN의 **20개
full-root 조합**을 포함한다. catalog 경계 검사 4개와 전체 92개 실제
retokenization 검사가 통과했다. 모든 전체 sequence/target/EOS byte가
원래 V83 또는 V102 owner 배열과 같았고, 실제 LLGuidance가 92개 native
target과 terminal EOS를 모두 받아들였다. 합계 **271,667 prompt token·
28,724 target/EOS**, maxPrompt **5,203**, maxSequence **5,937**이며 원래
8192/2400/196608-byte 한도 안이다. 실제 CPU exit0/PID 부재를 확인했다.
모델·source neural 요청은 0회이며 **모델 의미/전체 Host 지연 증거가 아니다**.

- V102 frozen 숫자 준비 결정: `c31e1f968aeb862d164b501b4472487476c0fe8acf7bec5b26bb361ba9a63730`
- V103 전체 생성: `6b243fc76e4f934222404ce7dcb996ac32842b623a4c1b6e4c2e07521a4959d9`
- V103 실제 전체 token/grammar/EOS: `bb9b45909dafe19755a930c112d01ba33d7c38097d03018dca18ab13e60aa589`
- V103 전체 scope 준비 결정: `1cd35d797aaa02b53278f74509624486b9247c04dd4cb29fa39b4e65e249ebc0`

## V104: 실제 최종 종료를 기다리는 독립 증거 검사 준비

원래 V75 adapter public inspector를 그대로 재사용한다. 최종 파일의 모든
**224 F32 array·2,883,584개 유한 parameter**, 이름/shape/offset/전체 file
extent를 검사하며 모델을 로드하지 않는다. 원래 전체 trace 함수를 정확한
function byte로 추출해 수와 마지막 보고만 바꾼 역변환 가능한 recipe를
준비했다. 실제 전체 **2,944개 owner·630,150 target/EOS·148개 완료 보고**를
요구하며, interval20 보고 147개 이후 **마지막 2,944회 보고**가 빠지면
실패한다. 이전 hardcoded dataset loader나 종료 entrypoint는 실행하지 않는다.

각 안정성 검사의 원래 48개+새 24개, 총 **72 owner·16,783개 NLL/top-token
entry**를 CPU에서 다시 계산한다. source/target byte와 실제 저장된 평균·
accuracy·독립 원래/새 정책 결정이 모두 일치해야 한다. 실제 완료된
**0/200/600/1200** vector를 재검증했고, partial prefix·누락된 final report·
잘못된 동적 weight·오염 NLL/source owner를 포함한 검사 5개가 통과했다.
첫 draft의 숫자 치환 역변환 충돌은 테스트 시작 전 보존·수정했다.
합성 보고와 이전 immutable adapter의 header 검사는 API 검사이며 실제
현재 학습의 종료나 품질을 뜻하지 않는다.

V101 학습은 **소유 세션12644/PID15853에서 계속 실행 중**이다. 기록된
실제 완료 prefix는 **2,120회·453,558 target/EOS**이고, 이후 최신 상태는
실제 `completed-update-reports.jsonl` 및 소유 세션을 확인한다. 원래/새
guard0/200/600/1200/2000이 통과했다. 1200회의 평균 NLL은 원래 48행
**0.5607026517**, 새 24행 **0.8830051017**이다. 추가로 실제2000 guard의
전체16,783-entry vector를 독립 재계산했고, 원래48행 **0.3277042358**,
새24행 **0.4018687598**과 두 고정 정책의 통과가 일치했다. 최종 adapter·전체 완료·
최종 해제·실제 새로운 source NN/3초 검증은 아직 없다. 학습률/epoch/
checkpoint를 바꾸지 않으며 다른 GPU 모델을 동시에 로드하지 않는다.

- V104 독립 최종 검사 준비: `df35ff8948c02f945dd67b70eb3b7e6d40d9b2f03c966728124d66e6091c6f31`

실제 소유 학습의 exit0/PID 부재·전체 ledger·7개 guard·final-only adapter·
원본 asset·RNG/8-byte cleanup을 확인한 후에만 최종 CPU 감사를 시작한다.
그 뒤에도 fixed fusion/tensor/numeric/joint-runtime 검증, V103 전체 source
의미와 올바른 전체 Host **≤3000ms**, 제품 통합·QA·release/install이 필요하다.
**목표는 계속 미달성**이며 제품/설치 버전은 **0.0.1145**다.

## V105~V108: 실제 전체 학습 완료·최종 모델 생성·새 가중치 수학/공동 스트림 검증

V101의 실제 소유 세션12644/PID15853이 **exit0**로 종료됐다. 전체
**2,944개 distinct update·148개 완료 보고·630,150 target/EOS**를 처리했고,
원래 검사 시점 및 actual-final을 포함한 **0/200/600/1200/2000/2920/2944**
검사가 모두 통과했다. 마지막 평균 NLL은 원래48행 **0.1878828771**,
새24행 **0.2274369092**다. 학습 전체 시간 **7,874,875.654ms**는 실제 학습
시간이며 설명 지연이 아니다. final-only adapter가 저장됐고, source/target/
EOS를 자르거나 부분 adapter를 재개하지 않았다. 원본 자산 hash, NumPy/
MLX RNG 보존, 원래 **8 active bytes**로 해제, 실제 소유 PID 부재를 확인했다.

V105 실제 최종 CPU 감사는 모든 source/target/동적 weight/SDK 순서·148개
완료 보고·7개 raw72-owner/16,783-entry NLL/top-token 관측·224 F32 array/
2,883,584 finite parameter·전체 file extent·설정·원본 자산을 독립 검사해
통과했다. 모델 생성 KV의 검사는 아래 V107/V108에 해당한다.
종료/소유/partial/final-ready 경계 검사 4개도
통과했다. 합성 terminal/API 제어를 실제 종료 증거로 사용하지 않았다.

V106은 이 **한 최종 adapter**를 원래 SDK의 **Q4/group128** 수학으로 한 번
합쳤다. 원래8GiB/cache256MiB/time180seconds 제한과 canonical tokenizer
archive/복원을 유지했다. CPU 경계·tensor/SDK·fusion 소유/해제 검사 6개와
실제 GPU exit0/PID 부재·RNG/8-byte cleanup을 확인했다. 이후 독립 CPU
감사가 **704개 array 전체**의 shape/dtype/finite/file extent를 확인했고,
선언된 adapted array **336개**가 바뀌며 나머지 **368개**는 원본 byte와
같았다. tokenizer/config는 canonical byte로 복원됐다. 원본 weight와
의도적으로 합쳐진 weight는 각자의 hash로 확인했으며 같은 파일로 취급하지
않았다. 이전 종료된 V75/V84 executable을 수정하거나 다시 실행하지 않았다.

V107은 **새 모델961f4852…**에서 원래 function/cache/readiness 수학의 전체
byte identity를 유지한 수치 검사를 한 번 실행했다. **51 projection pair·
51 compiled pair·336 MLP pair**, **19+19 full8192-window pair**의 유한 logits/
active KV/할당 byte/MLP 출력이 모두 일치했다. 원래 더 큰 **5,181-token**
geometry를 유지해 새 실제 최대5,059를 포함했고 모든 작은 geometry와
3 decode를 유지했다. 모델만의 **316,768,264 bytes**, 추가 packed weight
0bytes, readiness RNG, 한 번의 compile을 확인했다. 실제 exit0/PID 부재를
확인했다. **32,594.486ms는 합성 수치 진단 시간**이며 설명 지연이 아니다.

V108은 새 가중치에서 원래 모든 function/class/case body를 보존한
**14 reference/candidate 전체 합성 스트림**을 비교했다. **206개 token/key
transition**, 전체 normalized logits·초기/terminal/cancelled KV·complete raw/
parsed text·EOS extra draw·sampler/grammar/cache 소유 해제가 모두 같았다.
결과는 **13개 전체 완료와 명시적 취소1개**다. source-free 준비/모든 소유
해제 뒤에도 모델만의316,768,264bytes와 outside RNG/weight owner가 같았다.
실제 exit0/PID 부재를 확인했다. 합성 reference/candidate draw 총합은
424개이며 **실제 함수 source/설명 요청은 0회**다.

- V105 실제 최종 감사: `d0bbcb7f0e00360f78abb2dfdb2210b6a6307eb9b62322a42df99c0914b514ac`
- V101 final-only adapter: `f3f3cd2e75abbf290cdb908486c96547853e5cb27995de8ba70510ece2edde47`
- V106 새 모델 weight: `961f4852834d70c2d20044280db9a1414cbdaf48d37e54faa31286e9d65d2ef2`
- V106 전체 tensor/asset 결정: `da39353be5e3f1d75a11fda5078794a8f7301ea5677cef491492a4f8f2091c46`
- V107 실제 수치 terminal: `e2a93893cbc8958be979dc654ae56abf41b26a7b5fd94e612d6d87599269f4a3`
- V108 실제 공동 스트림 terminal: `d50761c96a998ebf58ec406d2f2cd599aecb2ffc0d74a02fb7b2a18b0f1fbab1`

이 증거는 새 모델의 기본 수학·owner·sampler/decoder 구현을 확인한다.
실제 source의 자유 설명 의미나 전체 Host3초를 입증하지 않는다. 다음에는
V103 전체 **36action·92request·20root 조합·60rich route·40call·28 final callee
body**를 유지한 새 실제 runtime 계획을 CPU에서 검증한 뒤 whole action을
하나씩 실행하고 모든 실제 필드를 검토해야 한다. 실제 quality/time 실패는
family 전체를 모든 weight/이름/언어/locale/scope 변형에서 재추론 금지로
기록하고 계획을 폐기한다. 모델/precision/sampler/scope sweep이나 유리한
사례 선택을 하지 않는다. **목표는 아직 미달성**, 제품/설치0.0.1145다.

## V109: 새 최종 모델의 첫 실제 전체 함수 평가 실패

새 모델961f4852…의 실제 source runtime은 원래 V87 worker와 input-audit의
전체 byte를 그대로 유지했다. provider와 action runner는 새 모델/폴더/상태
binding만 바뀌며 역변환으로 원본 전체 byte를 확인했다. source 분석·모든
검증·disk page 읽기·요청/모델/store 해제를 포함한 원래 전체 Host timer와
3,000ms 기준을 유지했다. CPU refusal5개, 전체 catalog/실제 Host 검사4개가
통과했다. 후자의 실제 Host 검사는 새 Kotlin/TypeScript·한국어/영어 4개
action의 8개 경로·28개 소스 occurrence와 native 입력 byte를 전부 확인했다.
오프라인 reference를 CPU validator에만 사용했으며 모델에 답을 전달하지 않았다.

전체 **36action/92request** 계획을 봉인한 후 첫 **Kotlin/한국어
scaleNonnegativeGap(left,right,factor)** 함수의 **두 경로 전체**를 한 번
실행했다. 모델 준비 이후 소스 파싱부터 모든 완료/해제까지 실제 Host 시간은
**22,295.021333ms**다. 두 native response의 prompt token은 **3,962/4,313**,
output token은 **951/204**이며 EOS를 포함한 sampled token은 **952/205**다.
단일 cohort의 tokenization+generation은 **21,318.576583ms**, 전체 packet은
**21,382.340792ms**다. 이 시간을 두 요청으로 나누어 개별 지연으로 표시하지
않는다. 이전 V87과 함수/경로/출력이 다르므로 속도 개선 비교로 사용하지 않는다.

원래 parser/validator는 두 응답을 받아 모든 **2개 경로·7개 소스 occurrence·
2개 disk page**를 전달했다. 원본 소스/지침/schema 입력 byte는 준비 자료와
일치하고 source-free readiness·fresh KV/owner 해제·모델 child exit0와
요청 상태 미보존도 확인했다. root runner는 시간 실패 때문에 실제 **exit1**로
끝났으며 root/model PID 둘 다 부재를 관측했다. 형식 통과가 설명 의미의
통과를 뜻하지 않는 결과다.

독립 검토는 두 native 확장의 **87개 leaf/빈 collection**, 전달 페이지의
**244개 leaf**, 모든 **41개 자유 prose/빈 collection**을 포함한다. 참 경로의
대입은 difference=-10을 저장하는데 설명은 중간 계산을 하지 않는다고 한다.
조건/요약/분석/가정에는 소스에 없는 Elvis lowering 문장을 반복한다. 거짓
경로에서는 대입의 근거에 조건식을 쓰고, 곱셈 대입의 효과를 반환으로 잘못
표현한다. summary/alternative는 실제 두 분기와 factor의 검사되지 않은
부호를 설명하지 못하고, limitations는 산술 표현10이라는 무관한 문장이다.
따라서 **전체 의미와 전체 3초 모두 실패**다.

고정 source 값·code·graph·literal-return 설명은 기존 계약이 복원한 값이며
모델이 계산이나 자유 설명을 맞혔다는 증거로 사용하지 않는다. 실제 선택된
두 예시의 반환값이 모두0이므로, 결과값 일치만으로 일반 곱셈/분기 의미를
입증할 수도 없다. 모든 raw request/wire/native expansion/페이지/검토 결과를
그대로 보존하고 수정·잘라내기·재추론하지 않았다.

- runtime binding: `f726b3f901e63f6c9722a68205d019ae67714f51afce9b47e267cb4543363690`
- 전체92개 계획: `65a625ff3cb412382a74f8063dd6dbae03678339df24f21de5e31d0d7a9d7445`
- 실제 소유 세션39331/root PID58396/model PID58415, exit1: `918176`
- 두 PID 부재 관측: `8b34dc`
- 전체 필드 의미 검토: `297be0dc49967e464660fdd7a82b7353208a1f8f2caecaed353e6a476adae7ce`

`calculated-nonnegative-difference-factor-product` family 전체를 모든 이름·
연산자·언어·locale·scope·weight 변형에서 neural 재추론 금지로 기록하고
**92개 계획 전체를 폐기했다**. 남은 **35action/90request는 실행하지 않았다**.
앞선 세 family 금지와 별도의 기존 parent/helper 금지를 유지한다. 최종 학습
NLL·byte-exact 수치 증거를 실제 새 소스 자유 설명의 일반화/정확성으로
대체할 수 없다. 다음은 실제 원본 입력/출력의 CPU 비용·학습/추론 직렬화
일관성 감사로 실패 원인을 구체화하는 작업이다. 제품 채택·버전 변경·설치
없이 **0.0.1145**를 유지하며 **목표는 미달성**이다.

## V110~V111: 학습 후 Q4 fusion에서 실제 목표 손실 증가 확인

V109의 실제 의미 실패 뒤, 앞선 수치 검사가 비교한 대상을 다시 확인했다.
V107/V108은 **같은 fused 가중치**에서 원래 수학과 최적화한 수학을 비교했다.
학습 중의 **원래 Q4 base+F32 LoRA 연산**과 최종 fusion 이후 사이의 학습
목표 보존은 확인하지 않았다. 실제 SDK `LoRALinear.fuse`는 원본을 dequantize한
뒤 low-rank delta를 더하고 다시 quantize한다. 이를 바로 원인으로 단정하지
않고 동일한 전체 학습 검증자료에서 직접 측정했다.

V110 준비는 실행 전 CPU 감사에서 예상 메모리를 8bytes 중복 계산한 것을
발견해 폐기했다. 실제 원래 model active316,768,264bytes에는 이미 RNG가
포함돼 있었다. V110 code/preparation/rejection을 그대로 보존했고 GPU나
teacher-forced forward를 실행하지 않았다. V111은 실제 V107/V109 관측값을
기준으로 별도 준비했다. 전체 vector/잘린 target/다른 owner/nonfinite 거부
검사 4개가 통과했다.

V111은 새 모델 후보를 고르는 실험 없이 **이미 고정된 fused 모델 하나**를
로드했다. 원래 48행과 추가한 nullable24행, **전체 72개 학습 owner와
16,783개 response/EOS target**을 동일한 원래 순수 statistics 함수로 측정했다.
학습 후 저장된 실제 unfused-final vector는 독립 CPU 검사 뒤 재사용했으며
이전 종료된 executable을 재실행하지 않았다. 학습자료의 source prompt
199,246tokens를 실제 forward했으므로 **source-free 검사가 아니다**.
금지된 family는 없고, 새로운 함수 설명·샘플링·optimizer update는 0회다.

| 고정 학습자료 | 학습 직후 NLL | fusion 후 NLL | 학습 직후 정답 token 정확도 | fusion 후 정답 token 정확도 |
| --- | ---: | ---: | ---: | ---: |
| 원래48행 | 0.187883 | 1.328835 | 95.56% | 67.96% |
| 추가24행 | 0.227437 | 1.683378 | 95.22% | 61.75% |
| 전체72행 | 0.201068 | 1.447016 | 95.44% | 65.89% |

표는 원래 guard와 같은 **행별 평균**이며 2,944개 학습자료 전체나 실제 새로운
설명 품질의 정확도가 아니다. **72개 owner 모두** 평균 NLL이 증가했다.
전체 target의 NLL/SDK NLL/top-token/start vector를 저장하고 CPU에서 전부
재계산해 기록과 일치했다. 동일 후보의 최적화가 byte-exact여도 잘못 변환된
학습 가중치를 보존할 수 있다는 검증의 한계를 실제로 확인한 것이다.

실제 세션43828/PID94704가 **exit0**로 끝났고 PID 부재를 관측했다.
72forward와 모든 target을 완료했으며 원래 RNG와 **8 active bytes**로
해제, 모델 파일 hash 보존을 확인했다. **41,990.359ms는 이 진단 시간**이고
함수 설명 지연이 아니다. 새 retention 임계값·허용 오차를 만들거나
유리한 행만 선택하지 않았다.

- V110 실행 전 admission rejection: `6ea122`
- V111 준비: `bd2ef0f6186b6bded0d57e2facc3f5633535c929c20465b7ecaae8d917756b62`
- 실제 exit0: `acff9b`, PID 부재: `084d80`
- 모든72행/16,783target vector: `70ee8e8e36e4479e0d1755fda094eb1dd1b76a0a56a84f8dcdd993dc520951a3`
- 독립 CPU 재계산·실제 terminal: `0582d0c0c7a80b682b86bb83226e791e4eaf0c44736d6128784186ae919414ac`

다음 수정 방향은 **원본 base와 변경하지 않은 최종 LoRA의 학습 당시 연산을
그대로 유지하는 런타임**이다. 모델/dtype/LR/epoch/sampler sweep을 하지
않고, 고정 원본 base/최종 adapter가 저장된 최종 관측을 복원하는지 먼저
전체 학습 검증자료로 확인한다. 이후에도 실제 새로운 전체 source 설명의
의미·완료 **≤3000ms**와 제품 통합·QA·release/install은 별도로 필요하다.
V109 실패 family의 모든 weight 변형 재추론 금지와 폐기된92개 계획은 유지한다.
**목표는 미달성**이고 제품/설치 버전은 **0.0.1145**다.

## V112: 원본 base+최종 LoRA의 학습 관측 전체 byte 복원

V111에서 확인한 fusion 단계의 손실을 해결하기 위해, 실제 저장된 원본 Q4
base와 **변경하지 않은 최종 F32 LoRA**를 원래 SDK `load(adapter_path=...)`로
직접 불러오는 공개 경계 `aligned-unfused-control-v112/trained_model.py`를
작성했다. 원본/adapter hash, 전체 safetensors extent, 224 F32 array·
2,883,584 parameter, rank8/scale20/dropout0/16layers를 확인한다. fusion,
requantization, 재학습, precision 변경, checkpoint 선택을 수행하지 않는다.

첫 authoring 단계에서 파일 tensor extent를 전체 live model 크기로 취급한
CPU admission 오류를 발견했다. 실제 base에는 파일 extent 이외의
20,488bytes도 포함되어 있었다. 이 draft 실패를 `f2d648`로 보존하고,
독점 준비 전에 실제 이전 base 관측+온전한 F32 adapter bytes로 수정했다.
관련 전체 vector/owner/target·SDK loader·자산/소유 기준 검사 **6개**가 통과했다.

실제 제어 측정은 **동일한 72개 학습 owner·16,783개 전체 response/EOS
target**에서 원래 순수 statistics 함수를 사용했다. 학습 중 저장된 최종
관측과 새 관측의 **F32 NLL, F32 SDK NLL, uint32 top-token, int64 starts**가
dtype와 **모든 byte에서 일치**했다. 정답 token의 행별 평균은 95.44%, NLL은
0.201068로 정확히 복원됐다. CPU에서 전체 vector와 모든 owner/target을
다시 비교해 원본 file/result/terminal 연결을 확인했다.

이는 학습 결과가 저장되거나 로드되는 단계의 오류가 아니라, 이후 Q4 fusion
파이프라인에서 손상됐다는 직접 근거다. 새로운 소스 설명의 일반화나 완료
3초를 입증하지는 않는다. source prompt199,246tokens를 읽는 학습자료 검사이며
source-free 검사가 아니다. 금지 family나 새로운 함수 설명·샘플링·optimizer
update는 없다. 새 모델을 고르는 sweep 없이 **기존 원본 base와 기존 최종
adapter의 학습 당시 연산**을 보존했다.

실제 세션86222/PID21622의 **exit0와 PID 부재**를 확인했다. 로드 중
328,302,600activebytes는 실제 기존 base316,768,264bytes+최종 adapter
11,534,336bytes이며 RNG를 두 번 더하지 않았다. 모든 소유 해제 후 원래
**8activebytes/RNG**로 돌아왔고 base/adapter 파일은 그대로다.
**52,446.233ms는 진단 시간**이며 실제 함수 설명 시간이 아니다.

- V112 준비: `4552cbc1f4a259feab4e596a538f6956ed966f883cdc63e872a69a69c5f1e724`
- 실제 exit0: `c4a6eb`, PID 부재: `4fb4ea`
- 실제 전체 vector: `52cbb3a1138960c7357999bfd1403bc638d6a4521ec04170175dded3710cec60`
- 독립 CPU byte 감사와 실제 terminal: `1860ea551920eae40a229cfa76b73041be530ae346d9a28cba6e399540117852`

다음은 이 **학습 연산을 보존하는 준비 모델 runtime**을 구성하고, LoRALinear
wrapper에 맞춰 최적화를 검증하는 작업이다. 기존 fused 전용 helper를 그대로
적용하지 않으며 전체 trained-model numeric/KV/joint sampler/owner 검증이
필요하다. 그런 다음 네 영구 금지 family를 제외한 실제로 새로운 전체 source
계획과 모든 기존 미노출 scope/return 조합을 확인한다. 폐기된92개 계획이나
실패한 family를 다른 weight로 다시 실행하지 않는다. 실제 정확한 전체
Host **≤3000ms**·제품 통합/QA/release/install은 **여전히 미완료**다.

## V113~V116: 학습 연산 보존 최적화의 전체 수치·공동 스트림 검증

V113은 원본 Q4 행 공유와 최종 F32 LoRA 연산을 함께 지원하는 비공개
`trained_runtime` 모듈을 구현했다. projection·소유권·attention·compiled MLP를
분리하고, low-rank 두 F32 matmul/scale/BF16 cast/addition을 원래 순서로
유지했다. prefill/multi-row는 실제 원래 module과 matrix geometry를 사용한다.
원래 base/최종 adapter의 파일이나 dtype·학습률·epoch·sampler를 바꾸지 않았다.

실제 모델은 **보정 없는12개 MLP와 보정 있는16개 MLP**다. 서로 다른 원래
연산의 고정 graph가 각각 한 번씩 compile되며 전체28개 레이어를 처리한다.
이를 fused 모델의 단일 graph로 잘못 취급하거나, LoRA 보정을 삭제하거나,
레이어 일부만 최적화한 결과를 전체 모델의 검증으로 사용하지 않았다.

첫 draft의 실제4개 GPU 계산 검사는 통과했지만 해제 후8bytes 검사는
실패했다(`1e6764`). 별도 source-free 진단은 모델/KV 해제 뒤 **12bytes**,
전역 trained compiled callable을 해제한 뒤 **8bytes**를 관측했다(`262980`).
이전 code 전체와 첫 실패를 보존하고, compile callable을 모델 수명에 묶었다.
배율은 원래 F32 곱셈과 같은 임시 입력으로 전달해 cached scalar도 남기지
않는다. 수정 후 전체 모델/레이어/KV·준비 상태 memory·해제 검사 **5개**가
실제로 통과했다(`64b66d`). 첫 진단의 문법 오류도 GPU 전 draft 실패로 보존했다.

그 뒤 V113의 **독점 전체 수치 검사**를 한 번 실행했다. 기존6개 순수 비교
함수의 body를 byte 그대로 재사용하고 original geometry를 유지했다.
**51 projection+51 compiled pair**, **19+19 full8192-window pair**의 모든
logits·각 레이어 active K/V byte·할당 capacity가 같았다. 원래 더 큰
**5,181-token** 학습 geometry도 유지했다. **28개 레이어×12가지 입력=336개
MLP 사례**는 random/pattern/mixed exponent·양/음0·tiny/large·unit·half-ULP를
포함하며 모두 byte가 같다. 두 graph는 각각1회이고, 준비/해제 전후
모델만의 **328,302,600activebytes**가 유지돼 추가 model weight copy가 없다.
전체 검사가 실제 exit0/PID 부재·원래 RNG/8-byte 해제·원본 자산 불변을
통과했다. **41,079.619ms는 수치 진단 시간**이며 설명 지연이 아니다.

공동 스트림 준비 중 V114는 원래 `dict/list/range` case 표현을
`ast.literal_eval`로 읽는 CPU 오류로 GPU 전에 실패했다(`a0b12c`). V115는
case parser를 보완했지만 metadata 참조 치환이 `scalar_proof`까지 바꿔
GPU 전 gate에서 실패했다(`d8044c`). 두 최초 code/준비/실패를 모두 보존하고
재실행하지 않았다. V116은 그 참조를 바로잡고, **7개 CPU 검사**와 실제
실행의 **모든 pre-GPU gate**를 launch write만 제외하고 통과했다(`2c8028`).

V116 실제 공동 검사는 원래 **12개 function/class body·4개 case·14개
reference/candidate 스트림**을 그대로 유지했다. **206개 token/key transition**,
전체 normalized logits·초기/terminal/cancelled KV·native raw/parsed 값·EOS
lookahead·sampler/compilation owner가 모두 같다. **13개 전체 완료와 명시적
취소1개**를 유지했다. 준비와 각 case 해제 후 model-only328,302,600bytes,
outside RNG·원래 weight owner가 유지되고, 마지막 model/compile 해제 후에는
원래 **8bytes**로 돌아왔다. 실제 exit0/PID 부재를 확인했다.

206은 이번 실제 reference/candidate 관측값이다. 이전 모델의 같은 숫자를
새 모델의 결과에 강제하거나 짧은 스트림을 골라 실행하지 않았다. 합성 draw
합계는 **reference218+candidate206=424**이며 실제 source/설명/timing은
**0회**다. 이 증거를 새로운 함수 자유 prose나 전체3초의 증거로 사용하지 않는다.

- V113 전체 수치 준비: `a253f0ea6b31659ca4f8f39357048e16b57aaeedc6563ab5548d6424983e22bb`
- 실제 numeric 세션38963/PID14100 exit0: `addcf7`, PID 부재: `df3d7a`
- 실제 full numeric terminal: `12f9dabba22171a1768d6e751fc46f620ba27b9c6efe48dc58fcb3a8ab50b978`
- V116 전체 joint 준비: `5eea8ddb769233324e1fc918d35752ceabf56ff4e69607229baceb9e84d9ac74`
- 실제 joint 세션93955/PID76670 exit0: `c90bb9`, PID 부재: `c4bca7`
- 실제 전체 joint proof: `a4cef60b6043dec1f84a9223139fd54e109873e7e8ce47ab935b273ceaf707d7`
- 독립 CPU 전체 결과 확인·terminal: `82846aaf7bdecc0c12474e28d19cc082fc5582329debadad7a810db7b4a78b1f`

다음은 이 준비 모델을 실제 complete-source worker/provider/whole Host에
연결하는 작업이다. 원래 sampler·전체 지침/source/schema/field·validator·
timer·UID별fresh KV·disk/자원 해제를 보존한다. 새로운 numeric family와
기존32action/84개 미노출 요청·전체20return 조합/모든 scope를 유지하는
**새 계획**을 CPU에서 검증한 뒤, 전체 action과 모든 필드 의미·시간을 확인한다.
폐기된92개 계획과 네 금지 family는 모든 weight 변형에서도 재실행하지 않는다.
**정확한 전체 Host≤3000ms·제품 통합/QA/release/install은 여전히 미완료**다.

## V117~V119: 학습 연산을 보존한 실제 전체 설명의 실패

V117은 새 `clampToWindow(value, lower, upper)`를 준비했다. `value < lower`이면
`lower`, 그 조건이 거짓이고 `value > upper`이면 `upper`, 그 외에는 `value`를
반환한다. 엄격한 `<`/`>`이며 경계 순서를 검증하거나 재정렬하지 않는다.
Kotlin/TypeScript·한국어/영어의 **12개 요청·세 경로씩·32개 소스 occurrence**를
실제 Host에서 준비했다. 전체 grammar/EOS와 독립 reference448개 teacher leaf·
212개 설명 필드를 오프라인 검토했고, 학습이나 실제 모델 설명 요청은 없었다.

V118은 새12개에 기존 V103의 **미노출84개 요청을 모두** 연결했다.
**36개 action·96개 요청·64개 rich 경로·260개 소스 occurrence·40개 호출·
88개 disk page·28개 final callee 본문**, 다섯 반환×언어×locale의20개 조합을
유지했다. 기존84개의 source/context/schema/target와 noncompiler 지침은 모든
바이트가 같다. 전체282,585 prompt token·29,696 target/EOS와 기존
8192/2400/196608 제한을 확인했다. builder 종료 전에 의존 preflight를 실행한
CPU 실패를 보존했다. 실제 builder 종료 후 전체96개 감사는 통과했다.
stdout의 옛 `rows:92`는 잘못된 표기이며 admission/archive/proof는 모두96개다.
봉인된 결과를 수정하거나 다시 실행하지 않았다.

V119는 원본 Q4 base와 최종 F32 LoRA를 V113의 검증된 runtime에 연결했다.
전체 수치·공동 스트림 증거와12개 CPU 검사를 유지했다. 실험용 전송 계층이
두 graph를 받도록 연결했고, 기존 Host 실행/시간 경계와 cleanup 블록은 모든
바이트가 같다. source-free64+1 준비·두 graph·모델328,302,600 bytes·EOF 후
실제 정상 종료/최종8 bytes 해제를 확인했다. 최초 draft 테스트의 API 필드명
오류를 보존한 뒤 봉인 전에 수정했다.

첫 **Kotlin/한국어 함수의 세 경로를 모두** 실제 실행했다. 원문 입력 일치,
parser 완료,8개 소스 occurrence,3개 disk page와 모델/스토어 cleanup은 통과했다.
모델 준비 이후 소스 처리부터 전체 완료/해제까지 **13,779.76825ms**로3초를
초과했다. 11,609 prompt token·1,049 output token·1,052 실제 sample을 기록했다.
tokenization/generation13,229.97225ms와 나머지 Host549.796ms를 확인했다.
Host 처리만 줄여서는 현재 생성 시간을3초 이내로 만들 수 없다.

설명 의미도 실패했다. 원문 `<`에 대해 `<=`/`>=`를 설명하고 `0 > 10 = true`라고
서술했다. 조건 평가를 Boolean 지역값 저장으로 표현하고, 분기 없는 함수라고
주장했다. 마지막 경로의 정수 반환10을 `false`로 설명했다. codec으로 복원된
고정 입력·값·그래프가 맞는다는 사실은 이런 자유 설명의 오류를 상쇄하지 않는다.
**65개 native leaf·116개 복원 leaf·328개 전달 leaf·57개 설명 필드**를 모두
검토했다. 공유된 reference DAG를 cycle처럼 거부한 최초 검토 CPU 실패를
보존하고, 직렬화되는 각 occurrence를 검토하도록 고친 뒤 결과를 한 번 저장했다.
실제 neural 결과는 변경하지 않았다.

session72250/root14461/model14493은 실제 runner exit1/model child exit0,
두 PID 부재를 확인했다. **`ordered-two-bound-direct-return-selection` 전체 함수군을
weights·이름·연산자·언어·locale·scope 변형까지 영구 neural 금지**했다. 금지
함수군은5개다. 전체96개 계획을 폐기했고 나머지35개 action·93개 요청은 실행하지
않았다. 같은 함수나 폐기된 계획을 재시험하지 않는다.

증거 SHA-256:

- V117 오프라인 decision: `b14752a9a49d5b0eb48959042f879955b44b7e1fa5bc101a1bfb5d6b30e103ab`
- V118 전체96개 decision: `b9471d1e2cdb2b3f3ddd236692a57e04992501fdf5773d5f6e00994bc6923e7d`
- V119 전체 의미 검토: `ed41a6d40ba58b0cf732630c64c354090e3113d0708bc3399d67d5695511f2fe`
- V119 실제 실패 decision: `5b005b44ff04ffd443504abd9755283fbfc8616956b836f5d4c1e258d2b9fce7`

## V120~V121: 전체 관측 분석과 현재 학습 모델의 합성 비용

V120은 기존 최종 관측을 CPU에서 읽어 **72개 학습 owner·16,783개 target/EOS를
모두** 재검증했다. 전체 completion을 tokenizer로 다시 확인했고, V112의 복원된
NLL/top-token vector와 모든 바이트가 같다. 모든 target을 문자열, 다른 scalar,
JSON 구조/경계, EOS에 한 번씩 집계했다. 모델 forward나 source 설명 요청은 없었다.

전체 token을 합쳐 계산하면 NLL0.2515646245, top-token accuracy94.1608%다.
이전72개 owner별 평균0.2010675545/95.4446%와는 **집계 방식이 다르다**.
모델 관측이 바뀐 결과가 아니다. 문자열 literal955개 중396개에는 정답 prefix를
넣은 상태에서도 top-token 오류가 있고, 전체980개 오류 중907개는 문자열에 속했다.
이 token 점수는 전체 문장이나 새 함수의 설명 의미를 증명하지 않는다.
실제 자유 생성 실패와 같은 것으로 계산하거나 acceptance 기준을 바꾸지 않았다.

V121은 이전 V90의 합성 case **네 개를 데이터로만** 사용해, 원본 base+최종 F32
adapter/current trained runtime으로 control4개와 cProfile4개, **전체8개 stream**을
새로 실행했다. 입력은 EOS ID뿐이고 출력은0/1/2 정수48개 배열이다. 실제 함수,
지침, teacher 문장이나 금지된 소스를 모델에 제공하지 않았다. original sampler,
512-token prefill,8192/2400 제한과 각 UID의 fresh KV/grammar를 유지했다.

전체 raw 값과 output/sample/EOS count는 control과 profile에서 모두 같다.
base/trained graph는 각각 한 번, idle 모델328,302,600 bytes, 최종8 bytes와
원래 RNG/모델/adapter를 확인했다. session42898/PID54361은 실제 exit0/PID 부재다.
control4,485.914208ms와 profile4,439.496958ms의 차이를 속도 향상으로 주장하지 않는다.

profile의 inclusive CPU wall time은 prefill2,027.5175ms, model forward/eval
2,274.648332ms, mask/normalize/sample120.771081ms다. GPU wait가 포함되고
내부 native mask8.474701ms 같은 nested 값을 다시 더하지 않는다. **정수 문법의
비용은 실제 bounded Korean/English 문자열 문법의 비용을 대표하지 않는다.**
이 합성 시간을 실제 함수의3초 완료 시간으로 환산하거나 모델 품질 근거로 사용하지
않는다. 다음에는 소스나 소스에서 가져온 const/code 없이 문자열 문법의 비용을
확인하고, 설명 역할과 전체 target 정렬 문제를 별도로 검토해야 한다.

- V120 전체 CPU 분석: `d98750b11b696973f260b3633bcaa042cda985eaaf4f78462ead7f4a86256e73`
- V120 실제 terminal: `5597606b8d1deeb4adcc8ac1098519c81222b76d619d4f4002a91c90cc249532`
- V121 실제 terminal: `b4f6c6b259671e986c75dae02183786daa584beb71ccbf51e71a76378732ab66`

제품/설치 버전은 **0.0.1145**다. 후보는 채택하지 않았고,
**정확한 전체 Host≤3000ms·제품 통합/QA/release/install은 계속 미완료**다.

## V122~V123: 문자열 진단 실패와 전체 native mask 재생

V122는 같은 원본 base·최종 F32 adapter에서 네 EOS-only 길이와 member당
48개 문자열·1..160 scalar 제한을 준비했다. 한국어 anchored pattern 두 개와
일반 문자열 문법 두 개다. 일반 문법은 영어 출력을 강제하지 않는다.
실제 native 경계까지13개 CPU 검사가 통과했다. 최초 HF tokenizer wrapper
호출 오류를 보존하고 GPU 실행 전에 수정했다.

실제 첫 control 네 stream 중 한국어 문법 두 개는 완료됐지만 일반 문법 두 개가
**2,400 output token의 length 결과**로 끝났다. 각 output/sample 수는677/678,
2400/2401,1897/1898,2400/2401이었다. 모든 완성/부분 raw 응답을 보존했고,
scope나 budget을 줄여 재실행하지 않았다. control282,264.729167ms는 완료된
paired 프로파일 시간이나 실제 함수 시간으로 해석하지 않는다. **profile 단계는
실행하지 않았다.** session70181/PID94640 실제exit1/PID 부재, 원래 model/adapter/
RNG와 최종8 bytes를 확인했다. 실제 함수나 금지 소스를 모델에 제공하지 않았다.

V123은 추가 모델 실행 없이 **학습2,944개·모니터링896개·준비 평가96개·실제 완료
응답3개**, 전체3,939개를 CPU native matcher에서 재생했다. 모든3,936개 archived
response/EOS의 **870,395개 target**이 원래 token 배열과 같다. 각 token 앞의
full-vocabulary mask를 확인하고 전체 mask sequence를 fingerprint했다.
원래 schema/canonicalizer/native consume/exclusive EOS를 유지했고 오류는0개다.
초안 admission의 placeholder test receipt는 거부·보존했고 실제 CPU 검사 receipt로
새 준비를 만들었다. session34422/PID40687 실제exit0/PID 부재다.

실제 생성 응답의 sampled token IDs는 보존되지 않았으므로 text를 canonical하게
재인코딩했다. output count는311/312/419로 원래312/313/424와 다르고,
EOS 포함1,045개는 실제 sample1,052개와 다르다. 이 차이를 같다고 처리하지 않는다.
세 응답의 CPU 재생은 compilation13.915957ms, mask136.082708ms,
consume2.983673ms다. 이 수치는 **알려진 문자열 상태의 CPU 작업**이며, 실제
모델·GPU·sampler 비용이나 whole Host13.78초를 직접 분해한 관측이 아니다.
실제 함수3초와 설명 의미는 계속 미검증 상태다.

## V124~V126: 설명 필드 이름 복원과 전체 응답 보존

V119에는 syntax/reason/effect와 summary/반환 의미가 혼동된 설명이 있었다.
이를 다루기 위해 named model-field codec을 CPU에서 구현했다. 원래 source schema를
기존 pure inverse로 복구하고, `syntax`, `text`, `reason`, `effect`, `analysis`,
`summary` 같은 원래 이름을 객체 필드로 노출한다. optional/union 제약은 통째로
유지하며 schema가 보장한 single value만 ledger에서 복원한다. 모델 문장을
작성·수정·축약하거나 다른 owner로 복사하지 않는다.

V124의 실제3개 응답에 대한 직접 codec 검사에서는 모든 값과 문장이 보존됐지만,
전체 감사에서 **3,909/3,939개가 실패**했다. 연결부가 원래 ordered-slot→owner-tuple
순서를 반대로 구성했고24개 원래 fallback을 처리하지 않았다. 성공30개만 골라
사용하지 않았으며 최초 실패와 코드는 그대로 보존했다.

V125는 core named codec을 유지하고 연결 순서와 whole original fallback을
복구했다. 실제 call/rich/완료 응답 fixture를 포함한4개 CPU 검사 후, **3,939개
모든 응답의 값·모델 문장·원래 native lexical byte**가 복원됨을 확인했다.
원래 source/context/noncompiler message는 변경하지 않았다. 오류0개,
session71815/PID68613 실제exit0/PID 부재다. V124는 수정하거나 재실행하지 않았다.

V126은 모든3,939개 named output을 원래 tokenizer·native grammar에서 다시
검증했다. **991,075개 target/EOS**, 가장 긴 응답999 token으로 원래
2,400-token/24,000-character 제한과 exclusive EOS를 모두 통과했다.
원래871,440개보다 token이 늘었으므로 속도 향상을 주장하지 않는다.
session32569/PID74669 실제exit0/PID 부재이며 모델·학습·source NN은0회다.

현재 통과한 범위는 **전체 값/문장 복원 및 output 문법/EOS/budget**이다.
새 compiler input adapter, 신뢰된 output mode 지침, 전체 prompt8192/stdIO196608
제한은 아직 검증되지 않았다. 그 작업을 완료한 뒤에도 실제 모델의 설명 의미·
prepared-model 전체 Host≤3000ms와 제품 통합/QA/release/install은 별도로 필요하다.
다섯 neural 금지 함수군과 폐기한96개 계획을 유지하며, 제품/설치는0.0.1145다.

증거 SHA-256:

- V122 최초 control 실패: `9ac3aaf1c08f91edc566c6bf19f7b1b95bf36da4eeddf2747740315f8f4e3a7b`
- V123 전체 CPU mask/EOS: `c67b2a6f4e058c8d1f543175e3aaf8b3578052491db61888e471991b1cb1338d`
- V124 전체 연결 실패: `ee716dcfb90ee007a725f7c9e65d2a09b4c9c795ff40f2c1a132e63586322ce8`
- V125 전체 named roundtrip: `70ed6615d4e5f3dc7e100243d2b1aa4c66e93a66d94c7e647bed59b6a0487f2e`
- V126 전체 named output: `cce727956a8969bf0ab2e46da6dba7430fbdf031d11f28b16b56006425413b19`

## V127~V130: 전체 named 입력 검증과 새 전체 평가 범위

V127은 원래 compiler JSON 한 줄과 신뢰된 footer/system 출력 mode만 새 source schema 표현으로 바꾼다. 원문·부모/근접 callee·필드·값·confidence·unknown·나머지 지침을 유지하고, 원래 compiler recipe를 사용해 전체 native payload와 응답의 lexical byte를 독립적으로 복원한다. 모호하거나 지원하지 않는 요청은 전체 원래 요청을 유지한다. 전체3,939개에서 오류0개,3,915개 변환·24개 whole fallback이며 CPU 검사5개가 통과했다.

V128은 전체3,939개 새 prompt/response/EOS를 원래 tokenizer/native grammar에서 확인했다. prompt9,017,891개·target/EOS991,075개, 최대prompt5,420·최대sequence6,216이며 기존8192 window/2400 output 예약/196608 stdio bytes/24000 output characters를 유지했다. 모델·학습·source NN은0회다. 필드 이름을 노출하거나 byte를 복원하는 검사는 설명 정확성이나 속도 개선의 증거가 아니다.

V129은 새 numeric 함수 `encodeState(active, visible)`를 준비했다. 지역 encoded를0으로 초기화하고, active가 참일 때1, visible이 참일 때2를 독립적으로 더해 반환한다. Kotlin/TS·KO/EN 네action의 모든16경로·80구문 발생과 원래 Host/값/문장/codec/validator/disposal을 검증했다. 영어 참조 목적 문장이 원래 길이 제한을 넘었던 초안 실패를 보존하고, 의미를 유지하며 제한 안에 작성했다. 실제 원문에는 입력 검증·else·early return·외부 상태 변경이 없다.

V130은 새16개와 **원래 미노출84개 전부**를 합쳤다. 전체36actions/100requests/68rich routes/308source occurrences/40calls/92disk pages/28final callee bodies와 다섯 반환×KT/TS×KO/EN20개 full-root cell을 유지했다. 원래84개의 context/schema/prose/noncompiler message는 named inverse로 모든 byte가 복원되며, 전체100개 prompt/native target/EOS가 원래 budget을 통과했다. 이전 폐기 builder/catalog 실행, optimizer/monitor 추가, 좋은 행만 선택은 없었다.

## V131~V133: 실제 전체 생성 실패와 모든 설명 필드 검토

V131은 원래 base와 변경 없는 최종 F32 adapter, V113 두 compiled graph 및 V116 sampler/취소/resource 증거를 유지했다. backend worker는 V119와 byte 동일하고, provider·전체 Host timer·input audit는 실험 경로 외의 원래 동작을 유지했다. 요청별 V82 contract 뒤에 V127 named adapter를 붙였으며 모든 raw/native/expanded 응답을 보존했다. CPU14개 검사와 source-free 준비/EOF가 통과했다.

실제 첫 Kotlin/한국어 함수는 **네 경로·20구문 발생·네 disk page 전체**를 처리했다. 원문/입력 byte, native grammar/EOS, 원래 파서, 2graphs, idle328,302,600 bytes와 종료 후8 bytes/childexit0를 유지했다. 그러나 prepared-model 전체 Host는 **57,687.038375ms**로3초 기준을 실패했다. tokenization+generation은53,886.267958ms이며 나머지 Host는3,800.770417ms다. 각 request prompt는4709/4377/4377/4038, output은570/552/473/443, sample/EOS는571/553/474/444였다. 서로 다른 함수/경로의 V11913.779초와 단순 속도 비교하지 않는다.

V132 review는 Host `{context, locale, taskKind, response}` wrapper를 직접 context로 읽어 최초 CPU 실패했다. 첫 코드/실패를 보존했다. V133은 실제 context 연결을 바로잡고, 원래 파서가 공유하는 step/nodeDetails 객체를 **실제 저장 JSON의 모든 경로**로 inventory했다. shared-reference 초안 오류도 보존했다. 새 모델 실행 없이 네 경로의 **75개 model prose field 전부**를 검토했다.36개 incorrect·31개 incomplete·8개 correct이며, native107/expanded183/delivered551 leaf를 모두 기록했다. 원래 typed 값·source example·모든 source occurrence와 원래 codec/Host에서의 문장 byte 보존도 확인했다.

대표 오류는 active/visible Boolean을 변경되는 numeric 지역 변수로 취급하기, `+=2`를1저장으로 설명하기, visible=false 경로에서2를 더했다고 말하기, return을 지역 대입/다음 구문 진행으로 설명하기, 서로 독립적인 플래그에 의존성을 만들기다. summary/alternative를 static disclaimer로 채우거나 static example을 관찰한 실행처럼 표현하기도 했다. 문법을 통과한 JSON이나 복원된 고정 값이 이 의미 오류를 상쇄하지 않는다.

전체100개 계획을 폐기했고 **나머지35actions/96requests는 실행하지 않았다.** `two-independent-boolean-flags-additive-bit-code` 전체 family를 모든weights·이름·연산자·언어·locale·scope 변형에 대해 영구 neural 금지했다. 기존 다섯 금지를 유지해 현재 여섯 개다. 실제 session49185/root57921/model57974는 runnerexit1/childexit0/PID 부재이며 재poll/재실행하지 않는다. 기존 model/adapter hash는 유지되고 제품/설치는0.0.1145다.

## V134~V135: 원래 전체 학습/모니터링 데이터의 표현 정렬

V131 모델은 원래 tuple 표현으로 학습했지만 실제 요청/출력은 새 named 표현이었다. 이 차이가 모든 실패의 원인이라고 증명하지 않았으며, 표현 정렬의 품질·속도 개선도 아직 검증하지 않았다. V134는 **원래 학습2,944개·monitor896개 전체**를 V127/V128 named 형식으로 정렬했다.3,824개 입력/응답 표현이 바뀌고16개 whole original fallback은 유지됐다. 원문/context/응답 의미의 전체 byte inverse, 원래 positive rational weights·split/order·source component·stage/type/language/family hierarchy를 유지했다. 새 평가나 실패 모델 문장을 학습에 넣지 않았고 모든84reserved/all6failed source owner를 제외했다.

새 complete training target/EOS는717,709개, monitor는237,628개다. prompt는각6,681,710개/2,041,515개이며 양쪽 최대sequence5,103으로 **기존6144 학습 할당** 안에 있다. V128에서 모든 prompt/answer/EOS를 그대로 복사해 원래 public substrate가 전체3,840개를 확인했다. 출력 일부나 EOS를 제거하지 않았고 optimizer update는0회다.

V135는 원래 real SDK iterator/ledger/loss 경계를 MLX CPU에서 확인했다. **학습2,944개 distinct row 전체의 실제 stable length-sort/seed42 순서**,47개 rational weights,717,709개 complete target/EOS,896개 항상 unweighted monitor와237,628개 target/EOS가 통과했다. 모델·optimizer·sampling·source NN은0회다. 이 CPU 확인을 실제 학습 업데이트나 새 모델의 의미/속도 통과로 처리하지 않는다.

다음 단계는 원래72개 training-only stability owner와 모든 coverage group,0/200/600/1200/2000/2920/2944 일곱 guard를 새 **전체** named token에 연결하는 것이다. 원래 threshold와 originalbase/1epoch/LR1e-5/seed42/batch1/LoRA16 rank8 scale20 dropout0/final-only/no resume를 유지하고, 준비와 fresh zero-adapter guard가 통과한 뒤에만 단일 full pass를 실행한다. 새 full pass/독립 final audit/새 비금지 전체 neural 의미·Host3000ms/제품 통합·기능·시각 QA/release/install은 아직 수행하지 않았다.

증거 SHA-256:

- V127 whole input inverse: `a5f2f880a1fc9940aba247c697e0ac8034feba122eb426e5e66f10ddfcf37c2b`
- V128 whole prompt/native/EOS admission: `5661bb1ee4de02203ff7344bac65d235d3704163f3cf166c477d97e580b8c586`
- V129 fresh complete references: `64d03654445740a7be2d3f102ece15dd8dbea85908d1e6ab9e6322810ea8c4f6`
- V130 whole100 catalog decision: `53743b767a8c5d73579c6765af5cce7be1c1652ca2b38dfbd82208f6ee9774bb`
- V131 first actual source terminal: `190b078087b5e31cc3f13bd56c2ecdd592176406c52bd57706cf43ccecbb23d3`
- V133 complete actual meaning review: `f7bbe664e51bb8e48a98280c898ee96a88ef709d939a72fdd9a58533b607e4f3`
- V134 named whole3840 objective: `d962049cb56f5509328b0c012c6dcb07b9cf6750632c6299b532efdde8581257`
- V135 actual SDK whole3840 CPU: `d50e1b5ebc44be18fcee588a8b6763f96c0401c32a1b5d85f08b01a056cb8ece`

제품/설치는 **0.0.1145**이며 새 후보를 채택하지 않았다. 전체 목표는 계속 active·미달 상태다. 모든 이번 owned job은 종료됐고 live tool/model process는 없다.

## V136~V137: 전체 named baseline 통과와 단일 전체 학습 실행 중

V136은 원래 V100의 **72개 training-only owner/32개 그룹**을 그대로 유지하고 전체 named prompt/response/EOS에 연결했다.48개 legacy와24개 nullable full-root의 선택·순서·source context·원래 row identity·rational weight를 유지했다. 모니터링/heldout 대체, target 일부 제거, loss에 따른 선택은 없다. 원래 통계 함수·독립 old/new group threshold와0/200/600/1200/2000/2920/2944 일곱 schedule을 그대로 사용한다. 원문/target/weight/split/중복 변경을 거부하는 CPU3개 검사가 통과했다.

실제 원래 base 및 새 zero LoRA에서72회씩 **144회 teacher-forced forward**가 완료됐다. 전체20,275개 target/EOS의 `nll`, `sdk_nll`, `top_tokens`, `starts`가 두 variant 사이에서 dtype와 모든 byte가 같았다. 원래 초기 stability guard·measurement RNG·mode 및 종료 후8-byte allocation 복원이 통과했다. session96390/PID91386 actualexit0/PID 부재를 확인했다. 모델 로드는1회이며 optimizer update/sample/source explanation은0회다. 이 baseline은 실제 새 함수 설명 정확성이나3초 완료의 증거가 아니다.

V137은 **단 한 번의 original-base 전체 named 학습**을 고정했다. 전체2,944 optimizer rows/717,709 target-EOS,896 unweighted monitor rows/237,628 target-EOS와 실제 SDK 순서/가중치를 유지한다.1epoch/LR1e-5/seed42/batch1/accumulation1/LoRA16layers/rank8/scale20/dropout0/6144 allocation/no resume/final-only 및 원래10200초/resource bound는 바꾸지 않았다. 원래 V101 trainer의 SDK/callback/guard/실제update report/final save/cleanup lifecycle은 byte 단위로 역복원되며, full target count와 completion-status metadata만 변경됐다. 설정/SDK/loss/stream 변경을 거부하는 CPU3개 검사와 실제preflight가 통과했다.

현재 학습은 **실제 live session55468/PID99592**에서 진행 중이다. 원래72개 전체의0-step guard가 통과했고, 실제 SDK가 update state를 evaluate한 뒤 **80개 완료 update/20,482개 target**을 보고했다. 첫20개 report의train loss는1.4464096069다. 이 수치는 partial 학습 보고이며 전체훈련/모든group의학습효과나 실제 설명 의미/지연을 증명하지 않는다. `training-result.json`과 final adapter는 아직 없다. 전체2,944개 distinct updates/717,709 targets,200/600/1200/2000/2920/2944 여섯 guard, final-only 저장·assets/RNG8bytes/실제terminal/PID부재는 계속 확인해야 한다. 이전 같은 설정의 전체실행은 약131분이었으므로 경과시간만으로 종료를 판단하지 않는다.

다음 turn은 **동일 live handle/process를 재검증하고 관찰**한다. marker/lock/artifact만으로live나terminal을 추정하거나 같은 작업을 재시작하지 않는다. 전체학습 이후에도 독립 final audit, 원래84개미노출을모두유지한새비금지full-scope neural 의미/Host3000ms, 제품통합·기능·시각QA/release/install이 필요하다. 여섯 whole-family 금지와 폐기한source계획을 유지한다. 제품/설치는0.0.1145이며 전체 목표는active·미달이다.

증거 SHA-256:

- V136 freshwhole72baseline terminal: `b731ba29d250347c990f6825dab81791dbdcaf0c23cbe3e9b6cbd1f1e89b10bc`
- V137 singlefixedfullpass seal: `2380b6264607595d6b9f76530d3d4a3bd605cee00a6312b15787d1ed1caa3a27`
- V137 partialactualprogress/livehandle: `d103f0b32543a33ce1a045bb6631f3bdb7f1c3dc72e7c1d91d00c880c2dd11ff`

## V138~V139: 입력 변환 중복 제거와 독립 최종 감사 준비

V138은 V127 요청 변환에서 같은 source/compiler와 old/named wire를 반복 생성·검증하던 작업을 줄였다. 신뢰된 system/footer, 유일한 전체compiler JSON, 독립 원래compiler 재생성과 lexical byte equality, 원래native schema equality, source schema factoring/inverse equality, 원문/context/noncompiler message 보존은 유지했다. 독립 V127 역변환 API를 그대로 사용한다. 각 요청이 자기 wire를 소유하며, 다른 owner의 source/KV/응답 캐시나 모델 문장 수정은 없다.

기존3,939개 전체와 현재100개 frozen/4개 실제응답을 모두 포함한 **4,043개 frame**에서 새 payload와 전체 응답 byte가 V127과 같고, 원래 native payload/response가 모든 byte로 독립 복원됐다. 기존84개 평가가 두 catalog에 포함되므로4,043은 서로 다른source개수로 주장하지 않는다.4,011개 변환/32개 whole fallback이며 오류0개다. 새16개 전체경로, 실제네응답, 변조/모호한입력/fallback/독립역변환/요청격리를 포함한CPU4개 검사도 통과했다. frame loader의 code/README를JSON으로읽은초안실패를보존하고 exclusive감사전에 수정했다.

모든4,043개에서 reference/candidate의 실행순서를 번갈아 CPU생성시간을 관측했다. 전체reference25,206.543389ms/candidate13,413.737418ms로 해당factory작업은 약46.8% 적었다. **각factory 내부검사를 포함하며, 생성후 외부전체byte/inverse증명만 timing밖이다.** 닫힌proof의 `validationExcludedFromBothConstructionTimings`는 이 외부검사를 뜻하며 terminal에범위를명시했다. V137학습이동시에실행되는CPU관측이므로 모델속도·전체Host3초로 환산하지 않는다. 실제NNpayload/target/token/nativegrammar/budget을 바꾸지 않았으며 모델/sourceNN은0회다. session22024/PID20487 actualexit0/PID부재를확인했고 재실행하지 않는다.

V137학습은 여전히 **session55468/PID99592에서live**다. 문서snapshot에서 실제620개update/151,375개target이보고됐고, 원래72개 항목의0/200/600-step guard가 모두통과했다.200-step의legacy48/new24 meanNLL은0.90927684/1.07624425,600-step은0.61635611/0.73195681이다. 같은 training-only owner의raw20,275개loss/sdk/top/source/target/EOS와mean/accuracy/policy를 CPU에서독립재구성했다. 이 관측은 학습안정성이고 새로운 함수설명정확성이나latency가 아니다. 나머지1200/2000/2920/2944 guard, 전체2944update/717709target과final-only/actualexit/RNG8/assets는미완료다.

V139는 실제학습종료뒤 사용할 독립CPU감사runner를 결과가나오기전에고정했다. 원래pure trace verifier/rawadapter inspector/raw72guard policy를 현재경로·대상개수·실제session/PID에역복원가능하게연결했다. foreign/live/중복terminal/partialupdate/cleanup/asset실패와변조된NLL/통계/source를거부하는6개CPU검사가통과했다. 실제0/200guard각20,275개전체벡터를 재검증했고,600guard도별도read-onlyCPU재검증이통과했다. **실제PID가live이므로 terminalRecordingReady/finalAuditReady는둘다false**였다. Syntheticcontrol을실제terminal로저장하지않았다.

독립최종감사는 actualterminal+PID부재 이후에만 전체2,944 distinctsource/148 evaluatedreport/717,709target-EOS,일곱raw72owner/20,275target guard,224개F32finaladapter/2,883,584parameters,원래baseassets/외부RNG8bytes를확인한다. 아직최종감사는실행하지않았다. 이후newweight원래arithmetic/numeric/전체14sampler-cancel-resource proof,원래84개미노출과모든20return-language-locale cell/fullsource/context/type/confidence/unknown을유지한새비금지neural평가/Host3000ms,제품통합·기능·시각QA/release/install이계속필요하다. 여섯wholefamily금지/폐기한source계획/제품0.0.1145를유지하고목표는active다.

증거 SHA-256:

- V137 livepartialprogress/guard600: `58d9757b281adb5907afc0c95a726ef00adae0e076027d88f6e987c074ea8b87`
- V138 whole4043 byteproof terminal: `b1e06b3352fa0de8650104cac0741e48c898a579411f6517ff1763fa67d1ddea`
- V139 independentCPUfinalaudit preparation: `8c95728c39c69b89904fab0f1aec0006a4c02af64e8c80a20096438e0bb7563b`

## V140~V141: 새 최종 가중치의 전체 수치·sampler 검증 코드 준비

V137은 여전히 실제 session55468/PID99592에서 단일고정전체학습중이다. 문서snapshot은 **1060개 evaluatedupdate/257,726개target**이며, 원래72개guard0/200/600만통과했다. 전체2,944개update/717,709개target-EOS와1200/2000/2920/2944 guard/final-only/actualterminal/PID부재/assets/RNG8bytes/독립V139audit는미완료다. 부분train/monitor loss로새함수설명정확성이나3초완료를추정하지않는다.

V140은 새가중치검증의CPU경계와원래runtime수치범위를학습결과전에고정했다. 원래Q4base+**독립최종감사를마친224개F32adapter만**로드하며, actualV137ownedterminal/PID부재/모든2944rows148reports717709targets/일곱raw72owner20275target guard/asset/RNG를요구한다. Live/foreign/partial/failed/unaudited상태를거부하는CPU2개검사가통과했다. 기존모델이나부분adapter를선택하지않고fusion/requantization/model·dtype·parameter변경을하지않는다.

원래numerichelper **여섯함수body가byte동일**하며 기존51projection+51compiled pair,19+19전체8192window pair,28layers×12patterns=336MLP를모두유지했다. 기존최대5181geometry를제거하지않고, 현재named데이터최대5103token경계를prefill512×9+495 및세decode로 **13+13pair추가**했다. 전체모델수치비교는166pair다. Logit/KV활성byte/할당capacity/dtype/shape/weightowner/두graph/extraweight0/RNG8bytecleanup과모든원래source-free조건을유지한다. Geometry누락·경계축소·byte비교약화를거부하는CPU2개검사도통과했다.

V141은 같은새가중치에서실행할 **원래14개joint stream 전체**를준비했다. 원래12개function/class body와네syntheticcase/length/UID/cancel이byte동일하다.13개wholecompletion과하나의explicitcancel,전체normalizedlogits/각sampledtoken·advancedkey/KV/nativegrammar/EOS/fullraw/value/output/lookahead/각ownerclosure/source-free64+1/최종8byte조건을유지한다. 원래수치범위나new13+13pair를빼면거부하고,live모델연결을거부하는CPU3개검사가통과했다. 새로운가중치에서는draw수가달라질수있으므로원래206회를새결과로가정하지않는다. 실제같은새가중치의reference/candidatehistories전체를비교한다.

현재준비의총CPU7개검사는통과했지만 **finalBindingReady와jointBindingReady는둘다false**다. 학습이살아있으므로새모델/Metal/GPU수치/sampler/sourceNN은0회이고,가중치연결·수치/joint성공을주장하지않는다. Actualfullpass/독립finalaudit 이후한번의V140최종binding→전체numeric166/336실행→actualterminal/PID부재/8bytes→V141binding→전체14joint실행순서만허용한다. 실제sourcefield의미·정확한전체Host3000ms와모든84미노출/20rootcell/전체원문·부모/근접callee·필드·type/confidence/unknowns·제품통합/기능·시각QA/release/install은계속미완료다. 여섯wholefamily금지와제품0.0.1145를유지하며전체목표는active다.

증거 SHA-256:

- V137 livepartial runtimepreparation snapshot: `a34bbb793e8aef03dc21c42cb1a2b0c3329edec2ea2f68b2770d90cafbfd99cb`
- V140 fullnumeric CPU preparation: `09c1e880b982c39a94ba68890c2195c5893e86466d84a4af1587f7d2cd632c6b`
- V141 all14joint CPU scope preparation: `aa5697f50eb74f3b68cb6523bbaeff3b9dbedc5af4e7eb19214516f39b996c21`

## V137: 1,200-step 전체 guard 통과와 독립 원시 벡터 재검증

실제 동일 학습 session55468/PID99592에서 원래72개 전체의 **1,200-step guard가 통과**했다. Legacy48 meanNLL은0.3921879958467352,원래nullable24는0.6229709986672461이다. 이 값은 training-only 안정성 관측이며 새 함수의 의미·생성 지연 증거로 사용하지 않는다. 현재 문서snapshot은1280개 evaluatedupdate/311,508개target이고 실제live진행은 이보다 빠를 수 있다.

원래0/200/600/1200의 **네 guard 모두**에서72개owner/20,275개fullresponse-EOS,source byte/target digest,loss/sdk/top dtype·shape·범위와각mean/accuracy/recorded policy를 unchanged CPU verifier로 독립재구성했다. 각snapshot SHA와완전한72행을기록했으며GPU/model/optimizer/sourceNN은이재검증에서0회다. 기존guard를수정·rerun하거나favorable subset을고르지않았다.

전체2,944 distinctupdate/717,709target과2000/2920/2944 세guard,final-only 저장·actualterminal/PID부재·assets/RNG8byte 및독립최종감사는아직미완료다. 동일livehandle을관찰하고재시작/partialresume/설정변경/두번째모델로드를하지않는다. V140/V141은CPUcodescope준비상태이며currentweights/GPU수치/joint를실행하지않았다. 실제 전체새source의미/Host3000ms와제품통합·기능·시각QA/release/install,원래84미노출/20rootcell/전체source-context/type/confidence/unknown보존은여전히필요하다. 여섯wholefamily금지/제품0.0.1145/전체목표active를유지한다.

- V137독립네guard/livepartial기록: `a3c2ec3d4f2f0394c85610deb71a965b0ea2abd3dcaf4e4d32bf0ea58a3d44a4`

## V137: 2,000-step 전체 guard 독립 검증

동일 실제 학습 session55468/PID99592에서 2,000-step의 원래72개 guard가 통과했다. Legacy48 meanNLL은0.2243912757114673, nullable24는0.3006702242302774다. CPU에서 전체20,275개 target/EOS의 raw NLL/sdk/top/source/범위/통계와 원래 policy를 독립 재구성했고, 실제 CPU exit0을 확인했다. 이로써0/200/600/1200/2000의 다섯 guard가 독립 검증됐다. 학습 데이터 안정성으로 생성 설명의 의미나 지연을 추정하지 않는다.

현재 문서 snapshot은 **2,500/2,944 evaluated updates, 608,472/717,709 targets**다. 실제 세션이 계속 실행 중이며 2920/2944 guards, final-only 저장, 실제 terminal/PID부재/RNG8/assets와 독립 최종감사는 미완료다. 재시작, 설정 변경, 부분 재개, 두 번째 모델 로드를 하지 않았다.

## V142~V145: 새 숫자 함수의 전체 평가 준비와 원래 토큰 한도 보존

새 숫자 함수는 정수 배열을 순서대로 읽고 직전 양수 상태에 따라 양수 구간 시작 횟수를 세는 `ordered-integer-array-positive-run-start-count`다. 여섯 금지 함수군의 이름·연산자 변형을 재사용하지 않았으며 전체 optimizer/monitor source owner와 겹치지 않는다. Kotlin/TypeScript 및 한국어/영어의 네 원래 구조적 경로를 모두 보존했다. 독립 TypeScript 실행은 빈 배열, 양수 연속 구간, 0·음수 경계, 시작 상태와 긴 배열을 검증했다. 원래 analyzer의 네 경로에는 빈 배열/단일 원소 예시를 사용하며 모든 입력의 실행을 관찰했다고 주장하지 않는다.

V142 draft의 iterator slot/기존 문자 한도 실패를 보존하고 수정한 다섯 reference 검사는 통과했다. 첫 exclusive builder는 새28개 occurrence와 기존 delivered assertion20의 불일치로 실패했다. 실제 exit1/PID부재와 첫 실패를 보존했고 이 builder를 수정하거나 재실행하지 않았다. V143은 새 버전에서 원래 Host 전 경계를 검사한 뒤 **16개 전체 경로·112개 source occurrence·16개 disk page**와 original capture/parser/codec/validator/dispose를 통과했다. Kotlin iterator slot의 범위 밖 값과 uncertified source facts를 그대로 보존했다. 실제 exit0/PID부재이며 모델이나 source NN 요청은0회다.

V144는 모든 원래84 미노출 요청과20 return-language-locale cell을 결합했다. 전체36 action/100 request/68 rich route/340 rich occurrence/40 call/92 disk page/28 final callee body를 보존하고 세 scope 검사와 전체 inverse를 통과했다. 전체100 token/grammar/EOS 검사를 실행했지만 `frozen:0`의 complete prompt5797+원래 output allowance2400이8192를 **5token 초과**했다. 나머지 검사는 통과했으나 전체 후보를 거부했다. 실제 construction exit0/token audit exit1/PID부재와 전체 결과를 보존하고 해당 독점 작업을 재실행하지 않는다.

V145는 trusted compiler의 긴 format discriminator만 integer1로 표현한다. 전체 source schema, recipe, source/context/noncompiler messages, native schema와 모든 응답 byte는 유지되며 original discriminator를 복원한 뒤 독립 V127 inverse로 원본을 검증한다. Unsupported 입력은 원래 전체 fallback을 유지한다. 네 CPU 검사가 통과했고, **원래4043+새100=4143개 전체 frame**의 입력·응답·inverse byte 검사가 오류0으로 통과했다.4103개는 projected,40개는 whole fallback이다. Duplicate source가 포함된 frame 수이며4143개 고유 함수라고 주장하지 않는다. 모든 원래3939/이전100/새100의 target-EOS vector digest4139개가 그대로 일치하며 나머지 네 actual 응답도 전체 byte inverse로 검증됐다.

전체4143 tokenizer/native grammar/EOS와 원래8192/2400/196608byte/24000character 한도가 오류0으로 통과했다. 총 prompt9,632,564/target-EOS1,075,176, 최대 prompt **5791**, 최대 실제 sequence7104다. 새100 최대prompt5791+원래2400 allowance=8191로 한도를 유지했다. Inverse/token job은 실제 exit0/PID부재, MLX/model/sourceNN/optimizer/monitor 추가0회다. 기존 모델·가중치·sampler·학습seal·한도를 변경하지 않았다.

V145는 prompt discriminator가 고정 V137 학습 표현과 다르므로 실제 생성 설명의 의미가 미검증이다. 현재 준비된 V140의 original166/336 범위를 줄이지 않고 **새 최대5791의 전체 prefill/decode geometry 수치 검증을 추가**해야 한다. 실제 V137 fullpass/terminal/독립 final audit, 새 최종 가중치의 numeric 및 원래14 joint stream이 모두 통과한 뒤 새 catalog/runtime binding이 필요하다. V145 마지막100 `positive-run-frozen:0..99`만 허용 평가 범위이며 archived4043에는 여섯 금지 source가 포함되므로 neural 입력으로 사용하지 않는다. 원래84/20cells/전체 부모·callee·fields/type/confidence/unknown와 actual whole Host3000ms/제품 통합/기능·시각QA/release/install은 계속 필수다. 제품0.0.1145와 전체 목표active를 유지한다.

증거 SHA-256:

- V137 guard2000 독립 기록: `7bb094475433e8ff591acd97c195483cbe86c7168de7cdf59a5f399ce424c4af`
- V137 current snapshot2500: `0069522ea8225d99bba2b7bedfe89bd54493a2a798bfd8ad00528fb00dc859a1`
- V142 첫 exclusive CPU 실패: `254f2fc6e0f01b31f5413f0ad589f8716e14ebebccf3d3ba7e4ac379b432e74b`
- V143 전체 새16 references terminal: `df5ff41b15fc1fa2852834f01b35848152d6a77fa02eed0c1a72185ef06769ca`
- V144 전체100 budget 거부: `1f4c32fbd5a57e9a1a7885eb00632c81c485a2e53ce5174b986b00f0c76bc23e`
- V145 전체4143 byte/token terminal: `c54eb8a5392c5f49b9a58200b54d75f5913ece7b8aab6661dece76c100a66085`
- V145 whole inverse: `49dbcaa846b3cb068e801db1b03d7430be17a6346e89ea3cdfb98bbb963a5e0d`
- V145 whole token/grammar/EOS: `17f03d067852b45e8a3624e43a8e199f8cda677007dcff2e52abced95d0f4306`

## V137~V141, V146~V150: 전체 학습·수치 완료 후 실제 소스 설명 실패

V137 단일 고정 named-representation 학습이 **2,944 update/717,709 target-EOS 전체를 완료**하고 실제 session55468 exit0/PID99592부재로 종료됐다.2,920/2,944-step의 원래72개 guard도 통과했다. 최종 legacy48/nullable24 meanNLL은0.12213361383715589/0.19604222628514148이다. 원래 base,1epoch,1e-5,seed42/2944모든row/rationalweights/896unweightedmonitor/final-only를 유지했다. TrainingDuration9158255.77037502ms, 최종adapter SHA는`5131e24cd751b13b786a1d82dde9449ec0e3e916f0da0658d3d308611ae5606d`다. 모델·optimizer 해제와 외부MLX/NumPy RNG 및8byte 복원을 확인했다. 학습 자체는 설명 품질이나3초 완료를 증명하지 않는다.

V139는 실제 ownedterminal과PID부재를 기록한 뒤, 전체2944 distinctowner/148 evaluatedreports/717709target/일곱72-owner20275-target rawguard/224F32 tensor·2883584parameter/baseassets/RNG8을 CPU에서 독립 검증했다. 실제 exit0이며 최종audit도 통과했다. 이전 부분 학습을 선택하거나 학습을 재개하지 않았다.

새 최종가중치의 V140 **원래166 full-model pair+336 MLP**가 모두 byte일치했다. V146은 기존 scope를 줄이지 않고 V145입력최대5791의512×11+159 전체prefill12조각/3decode를두implementation에서 추가15+15 비교했다. 추가30도fulllogit/KV/dtype/shape/capacity와RNG/owner조건을통과하여 **총196 model+336 MLP**가완료됐다. 각각actualexit0/PID부재/최종8byte,originalbase+F32adapter보존과extraweight0/두graph를확인했다. V141의 원래14joint도13whole+1explicitcancel/206candidate transition/fullhistory·key·KV·native·output·lookahead·owner를통과했다. Reference218/candidate206 draw의차이는명시적으로취소한stream의reference tail이며,전체218회가동일했다고주장하지않는다. 모두source-free증거이며source품질/latency증거가아니다.

V147은 V145의마지막100eligible compact frame만원래36action/20rootcell/84unexposed/68richroute/340occurrence/40call/92page/28finalcallee로고정했다. Archived4143 CPU자료는neural범위가아니다. V148은새모델·현재fullnumeric196/336·14joint와전체100scope를동시에요구했다. Worker의원래다섯functionbody/64+1source-freeReady/twoGraph/FIFO/UIDfreshKV/sampler/nativevalidators/EOF/RNG8은그대로다. CPU gate3개와actualHost·codec·input/client6개검사후새전체계획을sealed했고,actualsource-freeworker ready/EOF도source0/실제root-childexit0/PID부재로통과했다.

첫실제source는 **Kotlin/한국어 `countPositiveRuns`,전체4paths/28occurrences/4modelrequests**다. Native4response와모든raw/expandedwire를보존했고전체source/schema/staticinputbyte및ready/모델ownedclose가통과했다. 그러나 **전체Host81609.14291699999ms**로3000ms를초과했으며,원래validator의`invalid-response`와wholeaction실패로 **전달path/page0**이었다. Rootsession49497/PID95535 실제exit1/부재,modelchild95621 exit0/부재를확인했다. 출력일부나첫token을latency로대체하지않고실제whole실패를기록했다. 제품source/기존Host/설치변경은없다.

V149는모든네rawnative/expandedresponse를별도로보존하고native205/expanded284leaf 및28occurrence를전부inventory했다. 모델이작성한prose140개를수동검토해 **34correct/44incomplete/62incorrect**로판정했다. 모든step의syntax/action/reason/effect와title/explanation/analysis3fields/summary/limitation을포함했다. 네example 모두declaredIntArray `values`를scalar0로출력하고본문에서는[0]으로바꿔설명했다. Negation을다른비교로설명하고,0+1을0+true=0으로바꾸며,comparison이상태를변경한다고하거나iterator exit를return으로바꾸고정수counter를null로반환한다고설명했다. 완전한source/graphstep은그대로지만내용은정확하지않다. 원래native/expanded/views나modelsentence를수정하지않았다.

첫전체실패후 **전체100계획을폐기**했고나머지35actions96requests는실행하지않았다. 일곱째family `ordered-integer-array-positive-run-start-count`를모든weights/names/operators/languages/locales/scopes와parent/helper변형에서영구neural금지했다. 기존여섯wholefamily금지도유지한다. 실패source/plan을재실행하거나favorable subset·teacher/staticprose·repair·threshold완화로통과시키지않는다.

V150의독립CPU읽기에서는원래IntArray examplevalue schema가`{}`여서scalar0와array[0]를모두허용함을확인했다. 이domain gap은잘못된prose를설명하거나정당화하는원인으로단정하지않는다. 실제복합tokenization+generation **78964.47312500095ms**,wholepacket79102.68825001549ms,aggregateprompt20652/output3189/sampling3193을기록했다. 이숫자는prefill/decoder/GPU만의시간이아니며permemberlatency를유도하지않는다. 현재wholegoal은accuracy/latency모두미달이다.

학습과numeric/joint는종료되어currentlivehandle없다. 후속작업은generictypedexample/whole-source comprehension/actualruntimecost를개선할때도LLM의모든값·문장작성책임과전체original84/20cells/source/context/parent/callee/field/confidence/unknown을유지해야한다. 모든일곱failedfamily와종료job을재poll/수정/retry하지않고model/dtype/LR/epoch/sampler sweep도하지않는다. 제품0.0.1145를유지하며원래wholeHost3000ms·전체정확성·제품통합·기능/시각QA·release/install이충족돼야전체goal을완료한다.

증거 SHA-256:

- V139 전체최종감사: `e54e81ba7b132d032b7a3aae39994cb546a4bfdd853d0420dc620e5acd45ca35`
- V140 실제166/336 terminal: `2a957f9996b4a0467ff6c98aee557d7fc5664c83601934d8cb6487f20433f6ad`
- V146 추가30 terminal: `7f52e538a4436b3f895cc0aed413f10547ce812ac96cd7d93953dec88af52d8d`
- V141 실제14joint terminal: `67903622e9560e78b65a09c008be644aa0f22a0990146d23daa347f1d83f4548`
- V147 eligible100 terminal: `491f5d79beea8100aa7821274d326d940dd28f6fe64c97f6db220d3a86cd1f90`
- V148 첫실제whole failure terminal: `5c4f85e757c9fe430e4eb6410a1f95c28ccea189f3068e3845665c398f6039ce`
- V149 전체140prose검토: `bca626d4d53e1ec53b2a36ccbf266c9ba9bd328416e636a3ae45636be77fa2fa`
- V149 전체계획폐기결정: `14b65264f363e42f4c1dc016ccea8f1e509b0bd3ea0c678737c22aa8b70bf5cb`
- V150 실제domain/복합cost증거: `3c2b18b0a48ebfa7a87eae84412ca9f21838f6fa87a8b46b76fabbba34beded8`

## V151: 모델 책임을 유지한 선언 배열 예시 계약 수정

V150에서확인한IntArray valueSchema{}가scalar0를허용하는gap을generic source code에서수정했다. `src/llm/functionNarratives/typedValues`의public `createDeclaredValueSchema`와`matchesDeclaredValueSchema`를localgrammar/normalizer가공유한다. Kotlinprimitive arrays/Array<T>,TS-JSpostfixarrays/readonly/nestedarrays의실제arrayshape와알려진itemkind를검증한다. Kotlinnullablecontainer/nullableelement를분리하고nonnullroute는containernull만제외한다. 미확인alias/itemkind는추측하지않으며기존primitive/null/portable한도·source-route·node/call/connected계약을유지한다.

모델이선택한array길이·원소값·모든prose는유지하며scalar0나문자열배열리터럴을array로복구하지않는다. 반복기반typepeeling/matching은cycle/depth/workguard를갖는다. 이kind계약은source실행·언어별numericrange·설명semantics의증명이아니다. 구현/공개API와제약은SPEC.MD및moduleREADME에기록했다.

기존실험의outdependency를보존하려고V151별도outDir에TypeScript전체를컴파일했다. oldout/llm/responseSchema.js·localResponse.js SHA는그대로다. 최초compile이진행중일때테스트를먼저호출해artifactmissing exit1이났으며test0회였다. 이launch결과를보존했고실제tsc exit0이후의tests를사용한다. 새typedValue8/기존response-wire15/provider-rich-call26의 **49개고유tests가통과**했다. scalar/문자열배열/잘못된원소kind거부,빈·중첩array와nullableelement,unknownaliases/cycleguard,modelauthoredprose/values와fullcontext불변 및기존FIFO/cancel/timeout/ownedEOF/legacycontracts를검증했다.

Immutable V148expandedresponse4개를새normalizer에CPU로제공해잘못된scalarIntArray예시가모두거부됨을확인했다. 모델이나sourceNN을재실행하지않고원본·응답·prose를수정하지않았다. 일곱wholefamily금지와폐기한100plan은유지한다. 새GPU/model/sourceNN0이며currentproduct0.0.1145설치변경없다. Source/SPEC작업본은worktree에보존하고문서만publication한다.

Latency경로를CPU코드로확인한결과기존SingleRowCohort는이미독립UID별M1/ownKVgraphs를한forward barrier에서co-schedule하고sampler는별도eval한다. Sharedforward자체를새최적화로간주하지않는다. Source-free실질적새진단·구현은기존model/math/sampler/history/UID/모든source·field·caps·RNG8조건을보존해야한다. 이번kind수정은V148잘못된140prose와81.609초완료를개선했다는증거가아니며,정확한wholeHost3000ms/전체84·20cells/제품QA/release/install이여전히필요하다.

- V151구현·실제compile/tests/baseline보존증거: `47ae8313f5d3ec89f6dac2c8dc264bd53fbf21c4d56fa39342c2df488c49b095`
- 네immutablebadresponse의새CPU거부: `686c58b08bb11b4a3c833c2c1b6caf13b387dac6cd627a908ad4f26eee527a31`

## V152~V154: forward/sampling 단일 평가의 전체 바이트 검증과 혼합된 시간 결과

V152는 기존 독립 UID별 M1 forward와 원래 sampling 연산을 한 평가 경계에서 수행한다. 원래 prefill512, 모델·dtype·전체 vocabulary151936·stable sort·global top-p·key split·원래8192/2400/8/출력 한도를 유지한다. 미평가 wave에서는 UID 제거를 거부하고, 실패 시 pending graph를 처리한 뒤 모든 요청 owner의 정리를 시도한다. 기존 준비 모델과 가중치 검사 코드는 그대로 사용하며, 과거 6개 family 수 검사만 현재 7개 금지 family의 정확한 목록을 요구하도록 강화했다. Public product source에는 통합하지 않았다.

CPU 8개 검사가 통과했다. 첫 V152 독점 준비 builder는 과거 helper가 경로 앞에 삽입한 같은 이름의 scope_test를 가져오는 import 오류로 실패했다. 실제 exit1/model0과 첫 실패를 보존했고 builder는 수정·재실행하지 않았다. V153의 별도 CPU builder는 현재 scope helper를 파일 경로로 지정해 동일 전체 조건을 고정했다.

새 GPU 검사에서 기존 14개 stream을 모두 유지하고 5,791-token 전체 입력을 추가했다. **15 reference/candidate stream, 14 whole completion + 1 explicit cancellation, 217 compared transitions**의 전체 raw/normalized logits·sample token·advanced key·initial/terminal KV·capacity·raw/parsed native·lookahead count가 바이트 단위로 일치했다. Reference229/candidate217 차이는 취소한 reference tail12이며 229개 모두를 비교했다고 주장하지 않는다. 원래 model allocation328302600bytes, weight identity/두 graph/outside RNG와 최종8bytes를 보존했다. Actual session43575/PID16552 exit0/PID부재를 확인했다. Source 설명 요청0회이며 이 관측형 검사를 시간 증거로 사용하지 않는다.

V154는 logits/key/KV hash observer를 제거한 새 성능 측정이다. 원래 동일5조건을 모두 유지해 control/candidate를 각각1회씩 고정된 교대 순서로 실행했다. 준비 후 새 grammar/KV/sampler/detokenizer 생성부터 전체 생성·정리까지 wall time을 측정하고 결과 비교는 timer 밖에서 했다. CPU3개 검사와 actual session25713/PID24293 exit0/PID부재, 전체 raw/native/count 일치 및 매 조건의 model-only allocation/최종8bytes/outside MLX·NumPy RNG 보존을 확인했다.

| 전체 합성 조건 | 기존 코드 ms | 후보 ms | 후보 변화 |
|---|---:|---:|---:|
| 단일 UID | 532.748583 | 672.847167 | +26.30% |
| 길이가 다른 2 UID | 1232.821000 | 484.896292 | −60.67% |
| 길이가 다른 8 UID | 3705.400125 | 2940.974167 | −20.63% |
| 명시적 취소 | 702.189875 | 864.089625 | +23.06% |
| 전체 5,791-token 입력 | 2277.087042 | 2400.692208 | +5.43% |

세 조건은 더 느렸다. 한 번씩 측정한 결과로 전반적 개선이나 반복 가능한 속도 향상을 입증하지 않으며, 빠른 행만 골라 채택하지 않는다. 전부 합성 native JSON이며 실제 함수의 의미·전체 설명 Host3000ms 증거가 아니다. 후보는 제품에 채택·설치하지 않았다. 원래 sampler CPU 코드를 확인하니 이미 전체 stable argsort는 한 번뿐이므로 중복 정렬 제거도 새 최적화가 아니다. 다음 작업은 최대 입력 prefill과 긴 출력 decode/native-mask/normalize/sample의 실질 비용을 분리하거나 새 구현을 검증하는 것이다.

V151 source/SPEC 작업본과 기존 out, 일곱 neural 금지 family, 원래84/20cells/전체source·context·parent·callee·fields·confidence·unknown와 모델의 값·문장 작성 책임을 유지한다. 제품0.0.1145/전체목표active미달이며 실제 전체 정확성·Host3000ms·제품통합/기능·시각QA/release/install은 계속 미완료다. 닫힌 V152/V153/V154 독점 작업을 재실행하지 않는다.

증거 SHA-256:

- V153 CPU preparation: `94fe8b8d376487de46880f5a257ed864eda4f58f07a7966ec98d06e7c8bd3422`
- V152 전체15/217 proof: `062fd1cc27a1ec9d6b30851c36ce071edf89af1bbe3889ec4e2972fab5f5b867`
- V152 actual terminal: `aab97a936e9d1b8fd7948a1fe7e32c5e8ce44b02d2b45c5b11e2e29d2039725b`
- V154 전체5조건 paired result: `2e51ac7eb645deb179e0a28000219af66e68743574267c757385a42874738f81`
- V154 actual terminal: `889e8710abfd3aa48eff131903911d5573f985466912296b4c19d88128316102`

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
