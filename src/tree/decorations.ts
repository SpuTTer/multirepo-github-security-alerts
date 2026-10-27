import { reaction } from "mobx";
import {
  Disposable,
  EventEmitter,
  FileDecoration,
  FileDecorationProvider,
  Uri,
  window,
  workspace,
} from "vscode";
import {
  CONFIG_SECTION,
  RiskLevel,
  formatRiskDuration,
  getRepoRisk,
} from "../config";
import { RepoState, Store } from "../store";
import { titleCase } from "../utils";

const SCHEME = "github-security-repo";

// Tree items only get label color via a resourceUri + FileDecorationProvider.
export function repoDecorationUri(repo: RepoState) {
  return Uri.from({ scheme: SCHEME, path: `/${encodeURIComponent(repo.id)}` });
}

class RiskDecorationProvider implements FileDecorationProvider, Disposable {
  private _onDidChange = new EventEmitter<Uri | Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChange.event;
  private _disposables: Disposable[] = [];

  constructor(private store: Store) {
    this._disposables.push(
      {
        dispose: reaction(
          () =>
            store.repos.map((repo) => [
              repo.id,
              repo.isEnabled,
              repo.isLoading,
              repo.dependabotAlerts?.map(
                (alert) => `${alert.number}:${alert.security_advisory.severity}`
              ),
            ]),
          () => this._onDidChange.fire(undefined)
        ),
      },
      workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(CONFIG_SECTION)) {
          this._onDidChange.fire(undefined);
        }
      })
    );
  }

  provideFileDecoration(uri: Uri): FileDecoration | undefined {
    if (uri.scheme !== SCHEME) {
      return;
    }
    const id = decodeURIComponent(uri.path.slice(1));
    const repo = this.store.repos.find((item) => item.id === id);
    if (!repo || !repo.isEnabled || repo.isLoading) {
      return;
    }

    const risk = getRepoRisk(repo);
    if (!risk) {
      return;
    }
    const bySeverity = risk.alerts.reduce<Record<string, number>>(
      (acc, alert) => {
        const severity = alert.security_advisory.severity;
        acc[severity] = (acc[severity] || 0) + 1;
        return acc;
      },
      {}
    );
    const summary =
      Object.entries(bySeverity)
        .map(([severity, count]) => `${count} ${severity}`)
        .join(", ") || "no open Dependabot alerts";
    const duration =
      risk.days !== undefined ? ` for ${formatRiskDuration(risk.days)}` : "";
    const breached = risk.level === RiskLevel.slaBreached ? " (SLA breached)" : "";

    return {
      color: risk.color,
      tooltip: `${titleCase(risk.label)}${duration}${breached}: ${summary}`,
      propagate: false,
    };
  }

  dispose() {
    this._disposables.forEach((disposable) => disposable.dispose());
    this._onDidChange.dispose();
  }
}

export function registerRiskDecorations(store: Store): Disposable {
  const provider = new RiskDecorationProvider(store);
  return Disposable.from(
    provider,
    window.registerFileDecorationProvider(provider)
  );
}
