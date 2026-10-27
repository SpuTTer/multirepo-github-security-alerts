import { reaction } from "mobx";
import {
  Diagnostic,
  DiagnosticSeverity,
  languages,
  Range,
  Uri,
  workspace,
} from "vscode";
import { CodeScanningAlertLocation, Store } from "./store";

export function registerDiagnosticsProvider(store: Store) {
  const diagnostics = languages.createDiagnosticCollection(
    "GitHub Security Alerts"
  );

  reaction(
    () =>
      store.repos.map((repo) => [
        repo.id,
        repo.isEnabled,
        repo.codeScanningAlerts?.map((alert) => [
          alert.updated_at,
          alert.most_recent_instance.location.path,
          alert.most_recent_instance.location.start_line,
          alert.most_recent_instance.location.end_line,
        ]),
      ]),
    () => {
      diagnostics.clear();

      for (const repo of store.repos) {
        if (!repo.isEnabled || !repo.codeScanningAlerts) {
          continue;
        }

        const alertsByPath = repo.codeScanningAlerts.reduce((map, alert) => {
          const location = alert.most_recent_instance.location;
          let doc = map.get(location.path);
          if (!doc) {
            doc = [];
            map.set(location.path, doc);
          }
          doc.push({
            location,
            message: alert.most_recent_instance.message.text,
            severity:
              alert.rule.security_severity_level || alert.rule.severity,
          });
          return map;
        }, new Map());

        for (let [path, alerts] of alertsByPath) {
          const fileUri = Uri.joinPath(repo.rootUri, path);
          const fileDiagnostics = alerts.map(
            (alert: {
              location: CodeScanningAlertLocation;
              message: string;
              severity: string;
            }) => {
              const range = new Range(
                alert.location.start_line - 1,
                alert.location.start_column - 1,
                alert.location.end_line - 1,
                alert.location.end_column - 1
              );

              let severity =
                alert.severity.toLowerCase() === "critical"
                  ? DiagnosticSeverity.Error
                  : DiagnosticSeverity.Warning;

              return new Diagnostic(range, alert.message, severity);
            }
          );

          diagnostics.set(fileUri, fileDiagnostics);
        }
      }
    }
  );
}
