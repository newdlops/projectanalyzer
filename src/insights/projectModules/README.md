# Project Modules Insight

`projectModules`는 analyzer의 `ProjectGraph`를 프로젝트 책임 경계와 경계 사이의
관계로 집계하는 순수 Host-side 도메인 모듈이다. 언어 문법의 `module` symbol이나
framework adapter가 만드는 `module` unit을 프로젝트 package와 혼용하지 않는다.

## Public API

```ts
import { createProjectModuleIndex } from "./insights/projectModules";

const index = createProjectModuleIndex(graph, {
  roots: optionalAdapterRoots
});
```

`ProjectModuleIndex`는 다음을 제공한다.

- nested module과 `parentModuleId`
- canonical path 및 graph node의 nearest-module ownership map
- module별 direct/descendant file과 callable count
- module 내부 relation count
- relation kind와 confidence별 cross-module aggregate
- bounded representative evidence와 exact omitted count
- external/unresolved boundary와 unowned evidence coverage

전체 index는 Extension Host에 유지한다. Webview adapter는 필요한 module과 relation만
opaque snapshot identity로 투영해야 하며 canonical root, analyzer node ID, absolute source
path를 브라우저에 직접 전달하지 않는다.

## Boundary precedence

같은 canonical root에 여러 증거가 있으면 아래 우선순위로 primary basis를 선택하되 모든
증거는 보존한다.

1. manifest-backed `workspacePackage`
2. detected `frameworkRoot`
3. inferred `sourceArea`
4. `workspaceRoot` fallback

명시적 package와 framework root는 nested boundary로 유지한다. 명시적 경계가 없는
source만 conventional directory heuristic으로 묶고, 각 file/callable은 가장 가까운
boundary 하나에만 직접 귀속한다. 탐색은 recursion 없이 parent walk와 visited set을 쓴다.

## Relation semantics

`calls`, `imports`, `exports`, 그리고 실행에 의미가 있는 framework unit relation만
집계한다. 같은 module 안의 evidence는 self-loop edge로 만들지 않는다. external node는
관찰한 source file을 자신의 `filePath`로 가지므로 target path ownership을 수행하지 않고
별도 external boundary로 보낸다.

Confidence는 대표값으로 축약하지 않고 `exact`, `resolved`, `inferred`, `unresolved`
bucket count를 유지한다. relation당 source evidence는 최대 5개지만 전체 evidence 수와
생략 수는 정확하게 남긴다.
