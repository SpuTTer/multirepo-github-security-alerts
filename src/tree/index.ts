import { reaction } from "mobx";
import {
  Disposable,
  Event,
  EventEmitter,
  TreeDataProvider,
  TreeItem,
  window,
  workspace,
} from "vscode";
import { CONFIG_SECTION } from "../config";
import { CodeScanningAlert, DependabotAlert, RepoState, Store } from "../store";
import { registerRiskDecorations } from "./decorations";
import {
  CodeScanningAlertNode,
  CodeScanningNode,
  DependabotAlertNode,
  DependabotNode,
  RepositoryNode,
  SeverityNode,
  TreeNode,
} from "./nodes";

const SeveritySortWeight: { [index: string]: number } = {
  critical: 4,
  error: 4,
  high: 3,
  medium: 2,
  moderate: 2,
  warning: 2,
  low: 1,
  note: 1,
};

function sortSeverities(severities: string[]) {
  return severities.sort(
    (a, b) => SeveritySortWeight[b] - SeveritySortWeight[a]
  );
}

class SecurityAlertsTreeProvider
  implements TreeDataProvider<TreeNode>, Disposable
{
  private _disposables: Disposable[] = [];

  private _onDidChangeTreeData = new EventEmitter<void>();
  public readonly onDidChangeTreeData: Event<void> =
    this._onDidChangeTreeData.event;

  constructor(private store: Store) {
    this._disposables.push(
      {
        dispose: reaction(
          () => [
            store.repos.map((repo) => [
              repo.id,
              repo.isEnabled,
              repo.isLoading,
              repo.account?.id,
              repo.dependabotAccessDenied,
              repo.dependabotAlerts?.map((alert) => [alert.updated_at]),
              repo.codeScanningAlerts?.map((alert) => [alert.updated_at]),
            ]),
            store.isSignedIn,
          ],
          () => {
            this._onDidChangeTreeData.fire();
          }
        ),
      },
      workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(CONFIG_SECTION)) {
          this._onDidChangeTreeData.fire();
        }
      }),
      registerRiskDecorations(store)
    );
  }

  groupCodeScanningAlerts(repo: RepoState, alerts: CodeScanningAlert[]) {
    const severities = new Set(
      sortSeverities(
        alerts.map(
          (alert) => alert.rule.security_severity_level || alert.rule.severity
        )
      )
    );

    return Array.from(severities).map(
      (severity) =>
        new SeverityNode(
          repo,
          severity!,
          alerts.filter(
            (alert) =>
              (alert.rule.security_severity_level || alert.rule.severity) ===
              severity
          ),
          CodeScanningAlertNode
        )
    );
  }

  groupDependabotAlerts(repo: RepoState, alerts: DependabotAlert[]) {
    const severities = new Set(
      sortSeverities(alerts.map((alert) => alert.security_advisory.severity))
    );
    return Array.from(severities).map(
      (severity) =>
        new SeverityNode(
          repo,
          severity!,
          alerts.filter(
            (alert) => alert.security_advisory.severity === severity
          ),
          DependabotAlertNode
        )
    );
  }

  getTreeItem(node: TreeNode): TreeItem {
    return node;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[] | undefined> {
    if (!element) {
      if (this.store.repos.length > 0 && this.store.isSignedIn) {
        return this.store.repos.map((repo) => new RepositoryNode(repo));
      }
    } else if (element instanceof RepositoryNode) {
      const { repo } = element;
      if (!repo.isEnabled) {
        return [];
      }
      if (repo.isLoading) {
        return [new TreeNode("Loading alerts...")];
      }
      return [
        new DependabotNode(repo, repo.dependabotAlerts),
        new CodeScanningNode(repo, repo.codeScanningAlerts),
      ];
    } else if (element instanceof DependabotNode) {
      if (element.alerts) {
        if (element.alerts.length > 0) {
          return this.groupDependabotAlerts(element.repo, element.alerts);
        } else {
          return [new TreeNode("No alerts found")];
        }
      } else if (element.repo.dependabotAccessDenied) {
        const node = new TreeNode("No access with current GitHub account");
        node.tooltip =
          `The GitHub account used for ${element.repo.owner}/${element.repo.name} ` +
          `can't read its Dependabot alerts. Pick a different account for this ` +
          `repository, or check the token's scopes.`;
        node.command = {
          command: "github-security.selectRepositoryAccount",
          title: "Select GitHub account",
          arguments: [new RepositoryNode(element.repo)],
        };
        return [node];
      } else {
        const node = new TreeNode("Enable alerts");
        node.command = {
          command: "github-security.enableDependabot",
          title: "Enable dependabot alerts",
          arguments: [element.repo],
        };
        return [node];
      }
    } else if (element instanceof CodeScanningNode) {
      if (element.alerts) {
        if (element.alerts.length > 0) {
          return this.groupCodeScanningAlerts(element.repo, element.alerts);
        } else {
          return [new TreeNode("No alerts found")];
        }
      } else {
        const node = new TreeNode("Find out more");
        node.command = {
          command: "vscode.open",
          arguments: [
            "https://docs.github.com/en/code-security/code-scanning/automatically-scanning-your-code-for-vulnerabilities-and-errors/about-code-scanning",
          ],
          title: "Find out more",
        };
        return [node];
      }
    } else if (element instanceof SeverityNode) {
      return element.alerts.map(
        // @ts-ignore
        (alert) => new element.alertNodeConstructor(element.repo, alert)
      );
    }
  }

  dispose() {
    this._disposables.forEach((disposable) => disposable.dispose());
  }
}

export function registerTreeProvider(store: Store) {
  const treeDataProvider = new SecurityAlertsTreeProvider(store);
  const tree = window.createTreeView(`github-security.alerts`, {
    showCollapseAll: true,
    treeDataProvider,
    canSelectMany: true,
  });

  const updateTitle = () => {
    tree.title = "Security";
    const isLoading = store.repos.some((repo) => repo.isLoading);
    const alerts = store.repos.reduce(
      (sum, repo) =>
        sum +
        (repo.dependabotAlerts?.length || 0) +
        (repo.codeScanningAlerts?.length || 0),
      0
    );

    if (store.isSignedIn && !isLoading && alerts > 0) {
      tree.title += ` (${alerts})`;
    }
  };

  reaction(
    () => [
      store.isSignedIn,
      store.repos.map((repo) => [
        repo.isLoading,
        repo.dependabotAlerts?.length,
        repo.codeScanningAlerts?.length,
      ]),
    ],
    updateTitle,
    { fireImmediately: true }
  );
}
