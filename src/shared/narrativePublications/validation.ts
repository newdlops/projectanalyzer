/** Portable validators are serialized into both reading widgets; no environment, source or model dependencies. */
export function isNarrativePublicationId(value: unknown): value is string {
  return typeof value === "string" && /^narrative-publication:[0-9a-f]{32}$/u.test(value);
}

/** Only an identified, source-free terminal failure can withdraw prose; ready/progress/data-bearing frames cannot. */
export function isNarrativePublicationRevocation(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.publicationRevoked === true && isNarrativePublicationId(record.publicationId) && record.narrative === undefined
    && typeof record.graphVersion === "string" && record.graphVersion.length > 0 && record.graphVersion.length <= 512
    && Number.isSafeInteger(record.requestId) && (record.requestId as number) >= 0 && ["ko", "en"].includes(record.language as string)
    && ["failed", "stale", "cancelled", "timeout", "invalid-response", "language-mismatch", "context-too-large", "unavailable", "denied", "download-failed", "queue-full"].includes(record.status as string);
}
