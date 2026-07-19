# Project Analyzer Support

Project Analyzer is a local, source-backed code-flow visualizer. A useful report
should distinguish a missing static-analysis relationship from a rendering or
extension-host failure.

## Before reporting a problem

1. Confirm the source language is listed in the README coverage table.
2. Run **Clear Analysis Cache** from the Code Flow sidebar and reproduce once.
3. Open **View -> Output -> Project Analyzer** and retain the relevant lines.
4. Reduce the report to the smallest source example that still shows the issue.
5. Check whether the graph labels the relationship `inferred` or `unresolved`.

## Report template

Include the following information:

- Project Analyzer version
- VS Code version
- operating system and CPU architecture
- source language and file extension
- whether the file was saved or contained unsaved edits
- exact command or UI action used
- expected graph shape
- actual graph shape or error message
- minimal, non-proprietary reproduction source
- relevant Project Analyzer output lines

For performance reports, also include approximate workspace file count, include
and exclude globs, configured file-size limit, and the point at which CPU or
memory use remains elevated.

## Sensitive source and security reports

Do not attach proprietary source, credentials, access tokens, private paths, or
complete workspace logs. Redact diagnostic material before sharing it. Until a
public repository and dedicated security contact are configured, use the same
private channel through which the VSIX was distributed for security-sensitive
reports.

## Current distribution status

This build is marked Preview. Public Marketplace publisher, repository, license,
and durable support metadata are intentionally not fabricated by the package;
the distributor must configure those owner-controlled values before public
publication.
