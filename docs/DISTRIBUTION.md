# Project Analyzer 배포 가이드

이 문서는 Project Analyzer: Code Flow의 VSIX 및 VS Code Marketplace 배포
절차와, 자동화할 수 없는 소유자 결정을 구분한다. 현재 확장은 Rust native analyzer를
포함하므로 하나의 범용 VSIX가 아니라 실행 플랫폼별 VSIX로 배포한다.

## 배포 자산

- `media/project-analyzer-icon.png`: Marketplace에 표시되는 256×256 PNG
- `media/project-analyzer-marketplace.svg`: 편집 가능한 아이콘 원본이며 VSIX에서는 제외
- `media/project-analyzer.svg`: VS Code Activity Bar용 단색 24×24 아이콘
- `README.md`: Marketplace 상세 페이지와 설치 후 Extension Details에 표시되는 사용자 문서
- `CHANGELOG.md`: Marketplace Changelog 탭에 표시되는 변경 이력
- `SUPPORT.md`: 문제 보고에 필요한 정보와 민감 정보 처리 지침

Marketplace 아이콘은 작은 크기에서도 읽히도록 텍스트를 쓰지 않고, 두 입력 흐름이
하나의 결정 지점으로 합쳐져 효과로 이어지는 형태를 사용한다. 배경색은
`package.json.galleryBanner.color`와 같은 계열을 유지한다. PNG를 변경할 때에는 SVG 원본을
먼저 변경한 뒤 256×256로 다시 렌더링하고 패키지 테스트를 실행한다.

## 공개 배포 identity

현재 owner-controlled release identity는 다음과 같이 확정되어 있다.

- Marketplace extension: `newdlops.function-analysis`
- source repository: `https://github.com/newdlops/projectanalyzer`
- license: repository와 VSIX에 함께 포함되는 MIT License
- release set: macOS/Linux/Windows의 arm64와 x64, 총 6개 native target

Marketplace contributor 권한, Entra/OIDC 또는 PAT credential, production environment reviewer는
repository에 기록하지 않고 provider 설정으로 관리한다. 세부 설정과 retry 절차는
`docs/RELEASING.md`를 따른다.

## 릴리스 전 점검

```sh
npm test
npm run package:vsix
```

`npm test`는 Rust analyzer, TypeScript 단위 테스트, 배포 파일 allowlist를 모두 검증한다.
`npm run package:vsix`는 현재 호스트용 release analyzer를 빌드하고, 다른 플랫폼의 staged
binary를 제거한 뒤, 다음 이름으로 VSIX를 만든다.

```text
function-analysis-<version>-<target>.vsix
```

패키징이 끝나면 내장 검사기가 다음 조건을 확인한다.

- extension entrypoint와 정확히 하나의 native analyzer 존재
- Marketplace PNG, README, CHANGELOG, SUPPORT 존재
- 개발 소스와 다른 플랫폼 binary가 포함되지 않음
- archive, unpacked size, file count, 단일 파일 크기 예산 준수

테스트 후에는 다음도 확인한다.

- `git diff --check`
- `cargo fmt --check --manifest-path engine/analyzer/Cargo.toml`
- 생성된 VSIX를 깨끗한 VS Code profile에 설치
- Activity Bar 아이콘, Extension Details 아이콘, 함수 컨텍스트 메뉴 확인
- Function Visualizer child expansion과 Module Flow 줌/팬 smoke test

## 플랫폼별 패키징

`scripts/stage-runtime-engine.mjs`는 명령을 실행하는 OS/CPU의 Cargo release binary만
staging한다. 따라서 각 target은 해당 플랫폼 runner에서 `npm run package:vsix`로 빌드해야
한다. 한 머신에서 만든 binary의 폴더 이름만 바꾸어 다른 target으로 게시하면 안 된다.

초기 배포에서는 실제로 테스트한 target만 공개한다. 여러 target을 Marketplace에 올릴 때는
동일 버전의 VSIX를 target별로 모두 만든 뒤 publisher 관리 화면에서 업로드하거나,
`vsce publish --packagePath <target-vsix>`를 사용한다. 모든 target이 게시되기 전에는 release를
완료로 표시하지 않는다.

## 버전과 변경 이력

- 사용자 동작이나 분석 범위가 달라지면 patch 이상을 올리고 `CHANGELOG.md`를 함께 갱신한다.
- 동일 버전은 Marketplace에서 삭제한 뒤에도 재사용하지 않는다.
- pre-release는 SemVer suffix 대신 Marketplace의 pre-release publish flag를 사용한다.
- 실제 게시 전 마지막 패키지에서 `package.json`, CHANGELOG, VSIX 파일명의 버전이 같은지
  확인한다.

## 보안과 비밀 정보

- PAT, Entra credential, signing secret을 repository, 문서, npm script에 기록하지 않는다.
- CI credential은 provider secret store에서 publish job에만 주입한다.
- VSIX 업로드 전에 secret scan을 수행한다.
- 사용자가 제공한 source 또는 로그를 릴리스 fixture로 그대로 추가하지 않는다.
