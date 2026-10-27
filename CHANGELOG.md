## v0.5.0 (10/27/26)

- Added SLA tracking for high-risk repositories: a repository is marked **SLA BREACHED** when its oldest open high-risk Dependabot alert exceeds the configured threshold.
- New setting `githubSecurity.highRiskSlaDays` controls the threshold (default `14` days) and can be set per repository folder.
- New setting `githubSecurity.slaBreachedColor` controls the breached repository color (default `charts.red`). High-risk repositories within the SLA now default to `charts.orange` to distinguish them from breached repositories.
- Risk duration is measured from the oldest open alert's creation date, not the advisory publication date.

## v0.4.1 (10/26/26)

- Fixed risk colors not rendering: the `githubSecurity.*RiskColor` settings now default to VS Code's built-in `charts.red`, `charts.yellow`, and `charts.green` instead of extension-defined color IDs.
- The **Default Account** setting now has a link that opens the signed-in account picker directly from the Settings UI.

## v0.4.0 (10/26/26)

- Repositories are now color-coded by risk level in the `Security` view: **High Risk** (red), **Medium Risk** (yellow), and **Low Risk** (green). A repository is high risk if it has any open Dependabot alert with a high-risk severity, medium risk if it has any medium-risk alert, and low risk otherwise (including when it has no open alerts).
- Each repository shows a summary such as `5 total, 2 high risk, for 12 days`, where the duration is measured from the oldest alert at that risk level.
- New settings `githubSecurity.highRiskSeverities` (default `critical`, `high`) and `githubSecurity.mediumRiskSeverities` (default `medium`) control the classification, and `githubSecurity.highRiskColor` / `mediumRiskColor` / `lowRiskColor` accept any theme color ID. All settings can be set per repository folder.
- Repositories whose Dependabot alerts can't be read (Dependabot disabled, or the signed-in account lacks access) are shown with no risk color instead of being reported as low risk.
- The `NPM Audit Fix` action is now `Remediate`, and the command it runs is configurable via `githubSecurity.remediateCommand` (default `npm.cmd audit fix`, per repository folder).
- Builds are now published as GitHub Releases with the `.vsix` attached.

## v0.3.0 (10/26/26)

- The `Security` view now shows every GitHub repository in the workspace at once, each in its own collapsible section with its own Dependabot and Code Scanning nodes. The repository selector command and status bar item have been removed.
- Added a per-repository `Refresh Repository Alerts` action; the view-level refresh now refreshes all repositories.
- Code scanning diagnostics are reported for all repositories simultaneously.
- Repositories can be individually enabled or disabled from the tree (right-click or inline eye icon), with `Enable All` / `Disable All` in the view menu. Disabled repositories fetch no alerts and are remembered per workspace.
- Added a per-repository `NPM Audit Fix` action that runs `npm audit fix` in a terminal at the repository root.

## v0.1.0 (10/26/26)

- Forked from [lostintangent/github-security-alerts](https://github.com/lostintangent/github-security-alerts) as **Multi-Repo GitHub Security Alerts**.
- Added a repository selector for multi-root workspaces. The selected repository is remembered per workspace, and code scanning diagnostics and alert file navigation use its folder.
- The alert comment avatar is now served from the bundled extension icon instead of a remote CDN.
- Upgraded `@octokit/rest` to v22 and build tooling to current versions to clear security advisories. Minimum VS Code version is now 1.94.

## v0.0.5 (06/09/23)

- Fixed an issue with the parsing of the repository remote URL. Previously, it only supported HTTPS format, but now it also works with SSH format.

## v0.0.4 (02/20/23)

- Show a friendly error message when a security alert is associated with a non-existing file

## v0.0.3 (11/10/22)

- Fixed a rendering issue with comments

## v0.0.2 (10/26/22)

- Added support for the `Note` severity type, that Code scanning supports
- Fixed the `View Alerts in GitHub` command in the `Security` view's toolbar
- Code scanning alerts now display the tool that discovered them (e.g. CodeQL, ESLint)

## v0.0.1 (10/20/22)

- Initial release! 🚀
