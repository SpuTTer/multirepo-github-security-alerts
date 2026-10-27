import {
  commands,
  env,
  ExtensionContext,
  ProgressLocation,
  QuickPickItem,
  Range,
  Uri,
  window,
  workspace,
} from "vscode";
import { CONFIG_SECTION } from "./config";
import {
  CodeScanningAlert,
  DependabotAlert,
  DependabotAlertDependencyScope,
  RepoState,
  store,
} from "./store";
import {
  dismissCodeScanningAlert,
  dismissDependabotAlert,
  enableDependabot,
  refreshAlerts,
  refreshRepoAlerts,
  setAllReposEnabled,
  setRepoAccount,
  setRepoEnabled,
} from "./store/actions";
import {
  ensureAccountSession,
  getConfiguredDefaultAccount,
  listAccounts,
  setConfiguredDefaultAccount,
  signIn,
  signInWithNewAccount,
} from "./store/auth";
import {
  CodeScanningAlertNode,
  CodeScanningNode,
  DependabotAlertNode,
  DependabotNode,
  RepositoryNode,
} from "./tree/nodes";
import { showFileWithAlert, titleCase } from "./utils";

export async function registerCommands(context: ExtensionContext) {
  context.subscriptions.push(
    commands.registerCommand(`github-security.signIn`, signIn)
  );

  context.subscriptions.push(
    commands.registerCommand(
      `github-security.selectDefaultAccount`,
      async () => {
        const accounts = await listAccounts();
        const configured = getConfiguredDefaultAccount();
        const AUTO = "$(account) Account preferred by VS Code";
        const NEW = "$(add) Sign in with another account...";

        type AccountPick = QuickPickItem & { accountLabel?: string };
        const items: AccountPick[] = [
          {
            label: AUTO,
            description: configured ? undefined : store.account?.label,
            picked: !configured,
          },
          ...accounts.map((account) => ({
            label: `$(github) ${account.label}`,
            accountLabel: account.label,
            picked: configured === account.label,
          })),
          { label: NEW },
        ];

        const pick = await window.showQuickPick(items, {
          placeHolder:
            "Default GitHub account for repositories without their own account",
        });
        if (!pick) {
          return;
        }

        if (pick.label === AUTO) {
          await setConfiguredDefaultAccount(undefined);
          return;
        }

        let account = accounts.find((a) => a.label === pick.accountLabel);
        if (pick.label === NEW) {
          account = (await signInWithNewAccount())?.account;
        }
        if (!account) {
          return;
        }

        try {
          await ensureAccountSession(account);
        } catch {
          window.showErrorMessage(
            `Couldn't get a GitHub session for ${account.label}.`
          );
          return;
        }

        await setConfiguredDefaultAccount(account.label);
      }
    )
  );

  context.subscriptions.push(
    commands.registerCommand(`github-security.refresh`, () => refreshAlerts())
  );

  context.subscriptions.push(
    commands.registerCommand(
      `github-security.refreshRepository`,
      (node: RepositoryNode) => refreshRepoAlerts(node.repo)
    )
  );

  context.subscriptions.push(
    commands.registerCommand(
      `github-security.enableRepository`,
      (node: RepositoryNode) => setRepoEnabled(node.repo, true)
    ),
    commands.registerCommand(
      `github-security.disableRepository`,
      (node: RepositoryNode) => setRepoEnabled(node.repo, false)
    ),
    commands.registerCommand(`github-security.enableAllRepositories`, () =>
      setAllReposEnabled(true)
    ),
    commands.registerCommand(`github-security.disableAllRepositories`, () =>
      setAllReposEnabled(false)
    )
  );

  context.subscriptions.push(
    commands.registerCommand(
      `github-security.selectRepositoryAccount`,
      async (node: RepositoryNode) => {
        const { repo } = node;
        const accounts = await listAccounts();
        const DEFAULT = "$(account) Default account";
        const NEW = "$(add) Sign in with another account...";

        type AccountPick = QuickPickItem & { accountId?: string };
        const items: AccountPick[] = [
          {
            label: DEFAULT,
            description: store.account?.label,
            picked: !repo.account,
          },
          ...accounts.map((account) => ({
            label: `$(github) ${account.label}`,
            accountId: account.id,
            picked: repo.account?.id === account.id,
          })),
          { label: NEW },
        ];

        const pick = await window.showQuickPick(items, {
          placeHolder: `GitHub account to use for ${repo.owner}/${repo.name}`,
        });
        if (!pick) {
          return;
        }

        if (pick.label === DEFAULT) {
          await setRepoAccount(repo, undefined);
          return;
        }

        let account = accounts.find((a) => a.id === pick.accountId);
        if (pick.label === NEW) {
          account = (await signInWithNewAccount())?.account;
        }
        if (!account) {
          return;
        }

        try {
          await ensureAccountSession(account);
        } catch {
          window.showErrorMessage(
            `Couldn't get a GitHub session for ${account.label}.`
          );
          return;
        }

        await setRepoAccount(repo, { id: account.id, label: account.label });
      }
    )
  );

  context.subscriptions.push(
    commands.registerCommand(
      `github-security.remediate`,
      async (node: RepositoryNode) => {
        const { repo } = node;
        const command =
          workspace
            .getConfiguration(CONFIG_SECTION, repo.rootUri)
            .get<string>("remediateCommand")
            ?.trim() || "npm.cmd audit fix";

        if (/^npm(\.cmd)?\b/.test(command)) {
          try {
            await workspace.fs.stat(
              Uri.joinPath(repo.rootUri, "package.json")
            );
          } catch {
            window.showInformationMessage(
              `${repo.owner}/${repo.name} has no package.json at its root, so "${command}" can't run there.`
            );
            return;
          }
        }

        const terminal = window.createTerminal({
          name: `Remediate: ${repo.name}`,
          cwd: repo.rootUri,
        });
        terminal.show();
        terminal.sendText(command);
      }
    )
  );

  context.subscriptions.push(
    commands.registerCommand(
      `github-security.viewDependabotAdvisoryInBrowser`,
      (node: DependabotAlertNode) => {
        // TODO: Validate if this URL is provided by the API
        env.openExternal(
          Uri.parse(
            `https://github.com/advisories/${node.alert.security_advisory.ghsa_id}`
          )
        );
      }
    )
  );

  context.subscriptions.push(
    commands.registerCommand(
      `github-security.viewAlertInBrowser`,
      (node: DependabotAlertNode | CodeScanningAlertNode) => {
        env.openExternal(Uri.parse(node.alert.html_url));
      }
    )
  );

  function viewAlertsInBrowser(
    suffix: string,
    node?: RepositoryNode | DependabotNode | CodeScanningNode
  ) {
    const repo = node?.repo || store.repos[0];
    if (!repo) {
      return;
    }
    const url = `https://github.com/${repo.owner}/${repo.name}/security${suffix}`;
    env.openExternal(Uri.parse(url));
  }

  context.subscriptions.push(
    commands.registerCommand(
      `github-security.viewAlertsInBrowser`,
      (node?: RepositoryNode) => viewAlertsInBrowser("", node)
    )
  );

  context.subscriptions.push(
    commands.registerCommand(
      `github-security.viewCodeScanningAlertsInBrowser`,
      (node?: CodeScanningNode) => viewAlertsInBrowser("/code-scanning", node)
    )
  );

  context.subscriptions.push(
    commands.registerCommand(
      `github-security.viewDependabotAlertsInBrowser`,
      (node?: DependabotNode) => viewAlertsInBrowser("/dependabot", node)
    )
  );

  context.subscriptions.push(
    commands.registerCommand(
      `github-security.openDependabotAlertManifest`,
      (repo: RepoState, alert: DependabotAlert) => {
        const summarySuffix =
          alert.dependency.scope === DependabotAlertDependencyScope.development
            ? " (Development)"
            : "";

        showFileWithAlert(
          repo,
          alert.number,
          "dependabot",
          alert.dependency.manifest_path,
          `${alert.security_advisory.summary}${summarySuffix}`,
          alert.security_advisory.description,
          { search: alert.dependency.package.name }
        );
      }
    )
  );

  context.subscriptions.push(
    commands.registerCommand(
      `github-security.openCodeScanningAlertInstance`,
      async (repo: RepoState, alert: CodeScanningAlert) => {
        const location = alert.most_recent_instance.location;
        const selection = new Range(
          location.start_line - 1,
          location.start_column - 1,
          location.end_line - 1,
          location.end_column - 1
        );

        // Code scanning uses an "image//" prefix for build artifacts that were
        // only available in the scanning environment, so remove that.
        const path = location.path.startsWith("image//")
          ? location.path.substring(6)
          : location.path;

        await showFileWithAlert(
          repo,
          alert.number,
          "code-scanning",
          path,
          alert.most_recent_instance.message.text,
          alert.rule.help,
          { selection }
        );
      }
    )
  );

  const dismissReasons = {
    fix_started: "A fix has already been started",
    no_bandwidth: "No bandwidth to fix this",
    tolerable_risk: "Risk is tolerable to this project",
    inaccurate: "This alert is inaccurate or incorrect",
    not_used: "Vulnerable code is not actually used",
  };

  context.subscriptions.push(
    commands.registerCommand(
      `github-security.dismissDependabotAlert`,
      async (node: DependabotAlertNode) => {
        const items = Object.getOwnPropertyNames(dismissReasons).map(
          // @ts-ignore
          (reason) => ({ apiReason: reason, label: dismissReasons[reason] })
        );
        const selection = await window.showQuickPick(items, {
          placeHolder: "Select a reason to dismiss",
        });
        if (selection) {
          dismissDependabotAlert(
            node.repo,
            node.alert.number,
            selection.apiReason
          );
        }
      }
    )
  );

  const codeScanningDismissReasons = {
    "won't fix": "This alert is not relevant",
    "false positive": "This alert is not valid",
    "used in tests": "This alert is not in production code",
  };

  context.subscriptions.push(
    commands.registerCommand(
      `github-security.dismissCodeScanningAlert`,
      async (node: CodeScanningAlertNode) => {
        const items = Object.getOwnPropertyNames(
          codeScanningDismissReasons
        ).map((reason) => ({
          apiReason: reason,
          label: titleCase(reason),
          // @ts-ignore
          description: codeScanningDismissReasons[reason],
        }));
        const selection = await window.showQuickPick(items, {
          placeHolder: "Select a reason to dismiss",
        });
        if (selection) {
          dismissCodeScanningAlert(
            node.repo,
            node.alert.number,
            selection.apiReason
          );
        }
      }
    )
  );

  context.subscriptions.push(
    commands.registerCommand(
      `github-security.enableDependabot`,
      async (repo: RepoState) => {
        window.withProgress(
          {
            title: `Enabling Dependabot for ${repo.owner}/${repo.name}...`,
            location: ProgressLocation.Notification,
          },
          async () => {
            const succeeded = await enableDependabot(repo);
            if (succeeded) {
              return refreshRepoAlerts(repo);
            } else {
              setTimeout(async () => {
                const response = await window.showInformationMessage(
                  `You don't have permissions to enable dependabot on ${repo.owner}/${repo.name}.`,
                  "View settings"
                );
                if (response === "View settings") {
                  const uri = Uri.parse(
                    `https://github.com/${repo.owner}/${repo.name}/settings/security_analysis`
                  );
                  env.openExternal(uri);
                }
              }, 1);

              return;
            }
          }
        );
      }
    )
  );
}
