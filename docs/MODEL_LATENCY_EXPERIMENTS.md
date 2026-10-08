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
