/** Host-issued UI result identity; never model input, source authority or a claim of neural authorship. */
export type NarrativePublicationMetadata = {
  /** Stable across this completed generation's pages, node lookups and retained UI routes/locales. */
  publicationId?: string;
  /** A terminal failure revokes the matching published result even after its original request settled. */
  publicationRevoked?: true;
};
