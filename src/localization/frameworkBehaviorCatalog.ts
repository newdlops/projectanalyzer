/** Plain-language framework contracts; source snippets stay separate from translated prose. */
import type { FrameworkBehaviorKind } from "../shared/frameworkBehavior";

const en: Record<FrameworkBehaviorKind, [string, string]> = {
  "react-render": ["React calculates this component's UI", "When React renders this component, it calls the function to calculate JSX. The DOM is updated in a separate commit; a render does not always change the DOM."],
  "react-state": ["State carries information between renders", "The setter requests a later render with new state. Values already read in the current render remain that render's snapshot."],
  "react-effect-mount": ["Effect with an empty dependency list", "Setup runs after the component commits. An empty list adds no dependency-change reruns. Remounts and the extra development Strict Mode cycle can run it again."],
  "react-effect-deps": ["Effect follows these dependencies", "After a commit with changed dependencies, React runs the previous cleanup and then the new setup. This callback is separate from rendering."],
  "react-effect-every": ["Effect has no dependency list", "Setup runs after each commit. If there is a cleanup, React runs it before the next setup and when the component is removed."],
  "react-effect-dynamic": ["Effect dependencies need inspection", "The dependency list is not an inline array, so this analysis cannot establish which changes rerun the Effect."],
  "react-layout-effect": ["Layout Effect runs before paint", "After DOM changes, React runs this layout work before the browser paints. Long work here can delay the visible update."],
  "react-cleanup": ["Release the previous Effect's work", "React calls this returned cleanup before replacing the Effect setup and on removal. Its place in the source is not its execution time."],
  "react-memo": ["Reuse a calculated value", "React may reuse the calculation when dependencies match. This is a render-time optimization, not a guarantee that the function runs only once."],
  "react-callback": ["Keep a callback reference", "React caches a function reference according to its dependencies. useCallback itself does not call that function."],
  "react-ref": ["Retain a value without requesting a render", "The ref object persists between renders. Writing current does not by itself ask React to render again."],
  "react-context": ["Read the nearest matching provider", "This value comes from the nearest provider above the component. A changed context value can cause consumers to render again."],
  "react-event": ["Pass a handler for a later interaction", "This on… prop passes a callback value. Native React events invoke handlers on interaction; a custom component controls how its prop is used."],
  "react-event-eager": ["This call happens while JSX is calculated", "The expression calls the function while creating the prop. Its return value becomes the handler prop; the call does not wait for the event."],
  "django-view": ["Django dispatches a matched request here", "When the URL configuration selects this view, Django supplies the request and URL arguments. The view's response continues through response middleware."],
  "django-method": ["Check the HTTP method before the body", "This Django decorator restricts accepted HTTP methods. A rejected method produces a not-allowed response without running the view body."],
  "django-auth": ["Check login before entering the view", "login_required checks authentication and normally redirects an unauthenticated request to login. It does not establish other permission checks."],
  "django-atomic": ["Group database work in a transaction", "An atomic scope can roll back database writes when an exception escapes it. Nested scopes use savepoints; leaving an inner scope does not guarantee a final commit."],
  "django-commit": ["Defer the callback until a successful commit", "on_commit registers work for successful transaction completion. A rollback discards it; with no open transaction it runs immediately."],
  "django-signal": ["Register a signal receiver", "The receiver decorator connects this function to the supplied signal. The signal's sender invokes it; this is not an ordinary direct callsite."],
  "django-query-lazy": ["Build a query before fetching results", "For a standard Django Manager or QuerySet, this method builds or refines a lazy query. This call alone does not prove that rows were fetched."],
  "django-query-read": ["Request a database result", "For a standard Django QuerySet, this operation requests a result or evaluates rows. Caching and custom implementations affect the actual SQL; query counts are not known here."],
  "django-query-write": ["Request a database change", "This model or QuerySet operation may write to the database. Overrides, signals and transactions affect the result; bulk operations do not behave like per-object save()."],
  "django-response": ["Construct the HTTP response", "This creates a response object. Django sends it after the view returns and response processing completes; streaming content can be generated later."],
  "django-render": ["Render a template into a response", "Django combines the template and context to create an HttpResponse. Template evaluation can also access lazy data supplied in the context."],
  "django-redirect": ["Return a redirect response", "This creates a redirect response with a destination. The browser makes a separate request if it follows that redirect."],
  "django-middleware": ["Wrap request and response processing", "Configured middleware can inspect a request before the view and a response on the way back. It can also return early without reaching the view."]
};

const ko: Record<FrameworkBehaviorKind, [string, string]> = {
  "react-render": ["React가 이 함수로 화면을 계산합니다", "React가 렌더할 때 함수를 호출해 JSX를 계산합니다. 실제 DOM 반영은 그다음 단계이며, 렌더했다고 항상 DOM이 바뀌는 것은 아닙니다."],
  "react-state": ["렌더 사이에 값을 기억합니다", "상태 변경 함수는 새 상태로 다시 렌더하도록 요청합니다. 현재 렌더에서 이미 읽은 값은 그 렌더의 값으로 남습니다."],
  "react-effect-mount": ["빈 의존성 배열을 가진 Effect입니다", "화면에 반영된 뒤 설정 함수가 실행됩니다. 의존성 변경으로 재실행되지는 않지만, 재마운트나 개발용 Strict Mode 검사에서는 다시 실행될 수 있습니다."],
  "react-effect-deps": ["이 값들이 바뀌면 Effect를 갱신합니다", "의존성이 달라진 렌더가 반영되면 이전 정리 함수를 호출하고 새 설정 함수를 실행합니다. 이 콜백은 렌더 계산과 시점이 다릅니다."],
  "react-effect-every": ["의존성 배열이 없는 Effect입니다", "렌더 결과가 반영될 때마다 설정 함수가 실행됩니다. 정리 함수가 있다면 다음 설정 전과 컴포넌트가 제거될 때 호출합니다."],
  "react-effect-dynamic": ["Effect 의존성을 더 확인해야 합니다", "의존성이 배열 리터럴로 주어지지 않아 어떤 값의 변경이 재실행을 만드는지 이 분석에서 확정할 수 없습니다."],
  "react-layout-effect": ["브라우저가 그리기 전에 실행합니다", "DOM을 바꾼 뒤 화면을 그리기 전에 레이아웃 작업을 실행합니다. 이 작업이 오래 걸리면 화면 표시도 늦어질 수 있습니다."],
  "react-cleanup": ["이전 Effect의 작업을 정리합니다", "새 설정으로 바꾸기 전과 컴포넌트가 제거될 때 이 정리 함수를 호출합니다. 소스에 적힌 위치와 실제 호출 시점은 다릅니다."],
  "react-memo": ["계산한 값을 재사용할 수 있습니다", "의존성이 같으면 이전 계산값을 재사용할 수 있습니다. 렌더 중 계산을 줄이는 최적화이며, 한 번만 실행된다는 보장은 아닙니다."],
  "react-callback": ["함수 참조를 유지합니다", "의존성에 따라 함수 참조를 재사용합니다. useCallback 자체가 전달받은 함수를 실행하지는 않습니다."],
  "react-ref": ["다시 렌더하지 않고 값을 보관합니다", "같은 ref 객체를 렌더 사이에 유지합니다. current 값을 바꾸는 것만으로는 React에 다시 렌더하도록 요청하지 않습니다."],
  "react-context": ["가장 가까운 Provider의 값을 읽습니다", "상위에서 가장 가까운 동일 Context의 Provider 값을 사용합니다. Context 값이 달라지면 이를 읽는 컴포넌트가 다시 렌더될 수 있습니다."],
  "react-event": ["나중에 호출할 핸들러를 전달합니다", "on… 속성에 콜백 값을 전달합니다. 기본 React 이벤트는 사용자 동작 때 호출하며, 사용자 정의 컴포넌트는 그 속성을 어떻게 사용할지 직접 결정합니다."],
  "react-event-eager": ["이 호출은 JSX를 계산할 때 실행됩니다", "속성값을 만들면서 함수를 바로 호출합니다. 반환값이 핸들러 속성에 들어가며, 이 호출 자체가 이벤트를 기다리지는 않습니다."],
  "django-view": ["Django가 요청을 이 뷰로 연결합니다", "URL 설정에서 이 뷰가 선택되면 요청 객체와 URL 인수를 전달합니다. 뷰가 반환한 응답은 응답 미들웨어 처리를 거칩니다."],
  "django-method": ["본문에 들어가기 전에 HTTP 메서드를 확인합니다", "이 Django 데코레이터는 허용할 HTTP 메서드를 제한합니다. 허용하지 않는 요청이면 뷰 본문을 실행하지 않고 거부 응답을 만듭니다."],
  "django-auth": ["뷰 실행 전에 로그인 여부를 확인합니다", "login_required는 인증 여부를 확인하며, 보통 비로그인 요청을 로그인 화면으로 보냅니다. 다른 권한 검사까지 확인한 것은 아닙니다."],
  "django-atomic": ["DB 작업을 트랜잭션으로 묶습니다", "예외가 atomic 범위 밖으로 전달되면 DB 변경을 되돌릴 수 있습니다. 중첩 범위는 저장점을 사용하며, 안쪽 범위를 끝냈다고 최종 커밋된 것은 아닙니다."],
  "django-commit": ["커밋이 성공한 뒤 콜백을 실행합니다", "on_commit은 트랜잭션 성공 뒤의 작업을 등록합니다. 롤백되면 실행하지 않으며, 열린 트랜잭션이 없다면 바로 실행합니다."],
  "django-signal": ["신호를 받을 함수를 등록합니다", "receiver 데코레이터가 이 함수를 지정한 signal에 연결합니다. 일반적인 직접 호출 대신 해당 신호를 보내는 쪽에서 호출하게 됩니다."],
  "django-query-lazy": ["아직 결과를 읽지 않고 쿼리를 구성합니다", "일반적인 Django Manager·QuerySet에서는 조회 조건을 만들거나 추가하는 단계입니다. 이 호출만으로 DB의 행을 읽었다고 단정할 수 없습니다."],
  "django-query-read": ["DB 결과를 요청하거나 조회를 평가합니다", "일반적인 Django QuerySet에서는 결과를 요청하거나 행을 읽는 단계입니다. 캐시와 사용자 정의 구현에 따라 실제 SQL은 달라지며 쿼리 횟수는 확정하지 않습니다."],
  "django-query-write": ["DB에 변경을 요청합니다", "이 모델·QuerySet 작업은 DB에 쓸 수 있습니다. 재정의된 메서드, signal, 트랜잭션이 결과에 영향을 주며 bulk 작업은 개별 save()와 동작이 다릅니다."],
  "django-response": ["HTTP 응답 객체를 만듭니다", "뷰가 반환하고 응답 처리를 마친 뒤 Django가 전송할 객체입니다. 스트리밍 응답의 내용은 나중에 만들어질 수 있습니다."],
  "django-render": ["템플릿과 데이터로 응답을 만듭니다", "템플릿에 context를 적용해 HttpResponse를 만듭니다. 템플릿이 context의 지연 데이터를 읽으면서 조회가 평가될 수도 있습니다."],
  "django-redirect": ["다른 주소로 이동할 응답을 만듭니다", "이동할 주소를 담은 리다이렉트 응답을 만듭니다. 브라우저가 이 응답을 따르면 별도의 새 요청을 보냅니다."],
  "django-middleware": ["요청과 응답의 앞뒤를 감쌉니다", "설정된 미들웨어는 뷰 실행 전 요청과 반환된 응답을 처리합니다. 중간에 응답을 반환하면 뷰까지 도달하지 않을 수도 있습니다."]
};

/** Appends matched bilingual keys without translating source-owned subjects. */
export function getFrameworkBehaviorCatalogSource(): string {
  const flatten = (catalog: typeof en) => Object.fromEntries(Object.entries(catalog).flatMap(([key, [title, detail]]) => [["framework-" + key, title], ["framework-" + key + "-detail", detail]]));
  return `Object.assign(projectAnalyzerUiCopy.en, ${JSON.stringify(flatten(en))}); Object.assign(projectAnalyzerUiCopy.ko, ${JSON.stringify(flatten(ko))});`;
}
