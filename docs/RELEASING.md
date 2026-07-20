# Releasing Project Analyzer

Project Analyzer is published as `newdlops.function-analysis`. Its Rust analyzer
is a native executable, so one release consists of six target-specific VSIX
packages rather than one universal archive.

## One-time Marketplace setup

1. Confirm that the Visual Studio Marketplace publisher ID is `newdlops` and
   that the publishing identity is a Contributor for that publisher.
2. In the GitHub repository, create an environment named
   `vscode-marketplace`. Add required reviewers if production publication should
   pause for approval.
3. Configure one of the authentication methods below. Never commit credentials
   to the repository.

### Preferred: Microsoft Entra ID and GitHub OIDC

The release workflow requests a short-lived GitHub OIDC token and uses
`vsce publish --azure-credential`; no long-lived Marketplace secret is stored.

1. Create a user-assigned managed identity in Azure and give it Reader access to
   the subscription used by `azure/login`.
2. Add a federated credential to that identity with these values:
   - issuer: `https://token.actions.githubusercontent.com`
   - audience: `api://AzureADTokenExchange`
   - subject: `repo:newdlops/projectanalyzer:environment:vscode-marketplace`
3. Add these variables to the `vscode-marketplace` GitHub environment:
   - `AZURE_CLIENT_ID`
   - `AZURE_TENANT_ID`
   - `AZURE_SUBSCRIPTION_ID`
4. Authenticate as the managed identity and retrieve its Visual Studio profile
   ID:

   ```sh
   az rest \
     --url https://app.vssps.visualstudio.com/_apis/profile/profiles/me \
     --resource 499b84ac-1321-427f-aa17-267ca6975798
   ```

5. Add the returned `id` as a Contributor in the `newdlops` Marketplace
   publisher management page.

When `AZURE_CLIENT_ID` is present, the workflow requires the other two Azure
variables and always selects this path.

### Temporary fallback: Marketplace PAT

If Entra ID has not been provisioned yet, add `VSCE_PAT` as a secret in the
`vscode-marketplace` GitHub environment. The token needs Marketplace `Manage`
scope and access to all organizations available to the publisher account.

Global Azure DevOps PATs retire on December 1, 2026. This fallback exists for
initial setup and should be removed after OIDC publication is verified.

## Release a version

The workflow never changes versions on its own. Prepare one immutable source tag:

1. Update `package.json` and `package-lock.json` together. For example:

   ```sh
   npm version 0.0.1036 --no-git-tag-version
   ```

2. Add the matching `## 0.0.1036 - YYYY-MM-DD` heading to `CHANGELOG.md`.
3. Validate the release locally:

   ```sh
   npm ci
   npm run release:check -- v0.0.1036
   npm test
   ```

4. Commit and push the release source, then create and push the matching tag:

   ```sh
   git tag v0.0.1036
   git push origin v0.0.1036
   ```

The tag starts `.github/workflows/release.yml`. It runs the complete test suite,
then builds and package-checks these targets on matching native runners:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`
- `win32-arm64`

Publication begins only when every package exists. The workflow publishes all
six packages to the Marketplace, tolerates already-published targets during a
retry, and creates or refreshes the GitHub release assets. `linux-armhf`, Alpine,
and Web targets are intentionally outside the current runtime support contract.

## Recover or retry

GitHub can rerun a failed release job directly. The `--skip-duplicate` publish
guard makes a retry safe after only some platform packages reached the
Marketplace.

For a manual recovery, run **Release VS Code Extension** from GitHub Actions and
enter an existing version tag. The workflow checks out that tag and rejects it
unless its value, manifest version, lockfile version, and changelog heading all
match.
