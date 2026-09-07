/** Stable framework contracts shared by analysis, projection and presentation. */
export const FRAMEWORK_BEHAVIOR_KINDS = [
  "react-render", "react-state", "react-effect-mount", "react-effect-deps",
  "react-effect-every", "react-effect-dynamic", "react-layout-effect", "react-cleanup",
  "react-memo", "react-callback", "react-ref", "react-context", "react-event", "react-event-eager",
  "django-view", "django-method", "django-auth", "django-atomic", "django-commit", "django-signal",
  "django-query-lazy", "django-query-read", "django-query-write", "django-response", "django-render",
  "django-redirect", "django-middleware"
] as const;

export type FrameworkBehaviorKind = typeof FRAMEWORK_BEHAVIOR_KINDS[number];
export type FunctionFramework = "react" | "django";
export type FrameworkBehaviorRole = "component" | "hooks" | "view" | "signal" | "middleware" | "usage";
export type FrameworkBehaviorPhase = "render" | "commit" | "event" | "request" | "query" | "response" | "registration";
