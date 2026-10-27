import {
  MarkdownString,
  ThemeColor,
  ThemeIcon,
  TreeItem,
  TreeItemCollapsibleState,
} from "vscode";
import {
  CodeScanningAlert,
  DependabotAlert,
  DependabotAlertDependencyScope,
  RepoState,
} from "../store";
import { RiskLevel, formatRiskDuration, getRepoRisk } from "../config";
import { titleCase } from "../utils";
import { repoDecorationUri } from "./decorations";

export class TreeNode extends TreeItem {
  constructor(
    label: string,
    collapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None
  ) {
    super(label, collapsibleState);
  }
}

export class RepositoryNode extends TreeNode {
  constructor(public repo: RepoState) {
    super(
      `${repo.owner}/${repo.name}`,
      repo.isEnabled
        ? TreeItemCollapsibleState.Expanded
        : TreeItemCollapsibleState.None
    );

    this.id = repo.id;
    this.tooltip = repo.account
      ? `${repo.rootUri.fsPath}\nGitHub account: ${repo.account.label}`
      : repo.rootUri.fsPath;

    if (!repo.isEnabled) {
      this.iconPath = new ThemeIcon(
        "repo",
        new ThemeColor("disabledForeground")
      );
      this.contextValue = "repository.disabled";
      this.description = "Disabled";
      return;
    }

    this.iconPath = new ThemeIcon("repo");
    this.contextValue = "repository.enabled";

    if (repo.isLoading) {
      this.description = "Loading...";
      return;
    }

    const risk = getRepoRisk(repo);
    let summary = "";
    if (risk) {
      const parts: string[] = [
        risk.alerts.length > 0
          ? `${risk.alerts.length} ${risk.label}`
          : risk.label,
      ];
      if (risk.days !== undefined) {
        parts.push(`for ${formatRiskDuration(risk.days)}`);
      }
      summary = parts.join(", ");
      if (risk.level === RiskLevel.slaBreached) {
        summary += " ***";
      }

      this.iconPath = new ThemeIcon("repo", risk.color);
      // Lets the decoration provider color the label.
      this.resourceUri = repoDecorationUri(repo);
    }

    const account = repo.account ? `@${repo.account.label}` : "";
    this.description = [summary, account].filter(Boolean).join(" · ");
  }
}

export class DependabotNode extends TreeNode {
  constructor(
    public repo: RepoState,
    public alerts: DependabotAlert[] | null
  ) {
    super("Dependabot", TreeItemCollapsibleState.Expanded);

    this.id = `${repo.id}/dependabot`;
    this.iconPath = new ThemeIcon("hubot", new ThemeColor("charts.blue"));
    this.contextValue = "dependabot";

    if (alerts && alerts.length > 0) {
      this.description = alerts.length.toString();
    }
  }
}

export class CodeScanningNode extends TreeNode {
  constructor(
    public repo: RepoState,
    public alerts: CodeScanningAlert[] | null
  ) {
    super("Code Scanning", TreeItemCollapsibleState.Expanded);

    this.id = `${repo.id}/code-scanning`;
    this.iconPath = new ThemeIcon(
      "search-stop",
      new ThemeColor("charts.green")
    );
    this.contextValue = "codeScanning";

    if (alerts && alerts.length > 0) {
      this.description = alerts.length.toString();
    }
  }
}

const SeverityColor: { [index: string]: string } = {
  critical: "red",
  error: "red",
  high: "orange",
  medium: "yellow",
  moderate: "yellow",
  warning: "yellow",
  low: "white",
  note: "white",
};

const SeverityIcon: { [index: string]: string } = {
  critical: "circle-slash",
  error: "circle-slash",
  high: "warning",
  medium: "warning",
  moderate: "warning",
  warning: "warning",
  low: "warning",
  note: "note",
};

export class SeverityNode extends TreeNode {
  constructor(
    public repo: RepoState,
    public severity: string,
    public alerts: any[],
    public alertNodeConstructor: Function
  ) {
    super(titleCase(severity), TreeItemCollapsibleState.Collapsed);

    const themeIcon = SeverityIcon[severity];
    const themeColor = `charts.${SeverityColor[severity]}`;
    this.iconPath = new ThemeIcon(themeIcon, new ThemeColor(themeColor));
    this.description = alerts.length.toString();
  }
}

export class DependabotAlertNode extends TreeNode {
  constructor(public repo: RepoState, public alert: DependabotAlert) {
    super(alert.security_advisory.summary);

    if (alert.dependency.scope === DependabotAlertDependencyScope.development) {
      this.description = "Development";
    }

    this.contextValue = "alert.dependabot";
    this.tooltip = new MarkdownString(alert.security_advisory.description);

    this.command = {
      command: "github-security.openDependabotAlertManifest",
      title: "Open manifest file",
      arguments: [repo, alert],
    };
  }
}

export class CodeScanningAlertNode extends TreeNode {
  constructor(public repo: RepoState, public alert: CodeScanningAlert) {
    super(alert.rule.description);

    this.contextValue = "alert.codeScanning";
    this.tooltip = new MarkdownString(alert.rule.help || "");

    const { path, start_line } = alert.most_recent_instance.location;
    this.description = `by ${alert.tool?.name} in ${path}:${start_line}`;

    this.command = {
      command: "github-security.openCodeScanningAlertInstance",
      title: "Open most recent instance",
      arguments: [repo, alert],
    };
  }
}
