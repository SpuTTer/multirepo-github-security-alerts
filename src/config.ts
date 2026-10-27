import { ThemeColor, workspace } from "vscode";
import { AlertSeverity, DependabotAlert, RepoState } from "./store";

export const CONFIG_SECTION = "githubSecurity";

export enum RiskLevel {
  slaBreached = "slaBreached",
  high = "high",
  medium = "medium",
  low = "low",
}

const SLA_DAYS_KEY = "highRiskSlaDays";
const DEFAULT_SLA_DAYS = 14;

const RISK_SETTINGS = {
  [RiskLevel.slaBreached]: {
    label: "high risk",
    colorKey: "slaBreachedColor",
    defaultColor: "charts.red",
  },
  [RiskLevel.high]: {
    label: "high risk",
    severitiesKey: "highRiskSeverities",
    defaultSeverities: [AlertSeverity.critical, AlertSeverity.high],
    colorKey: "highRiskColor",
    defaultColor: "charts.orange",
  },
  [RiskLevel.medium]: {
    label: "medium risk",
    severitiesKey: "mediumRiskSeverities",
    defaultSeverities: [AlertSeverity.medium],
    colorKey: "mediumRiskColor",
    defaultColor: "charts.yellow",
  },
  [RiskLevel.low]: {
    label: "low risk",
    colorKey: "lowRiskColor",
    defaultColor: "charts.green",
  },
} as const;

export interface RepoRisk {
  level: RiskLevel;
  // Human-readable status, e.g. "high risk" (SLA breach is flagged via `level`).
  label: string;
  // Open Dependabot alerts that fall in this level.
  alerts: DependabotAlert[];
  // Whole days since the oldest alert in this level was opened.
  days?: number;
  color: ThemeColor;
}

// Resolved against the repo's root so folder-level settings win in multi-root workspaces.
// Returns undefined when Dependabot alerts couldn't be read (disabled or access denied),
// so the repo is shown without any risk highlight rather than as low risk.
export function getRepoRisk(repo: RepoState): RepoRisk | undefined {
  if (!repo.isEnabled || repo.dependabotAlerts === null) {
    return;
  }
  const config = workspace.getConfiguration(CONFIG_SECTION, repo.rootUri);
  const severitiesFor = (level: RiskLevel.high | RiskLevel.medium) => {
    const { severitiesKey, defaultSeverities } = RISK_SETTINGS[level];
    const value = config.get<string[]>(severitiesKey, [...defaultSeverities]);
    return new Set(value.map((severity) => severity.toLowerCase()));
  };
  const high = severitiesFor(RiskLevel.high);
  const medium = severitiesFor(RiskLevel.medium);

  const alerts = repo.dependabotAlerts;
  const byLevel: Record<RiskLevel.high | RiskLevel.medium | RiskLevel.low, DependabotAlert[]> = {
    high: [],
    medium: [],
    low: [],
  };
  for (const alert of alerts) {
    const severity = alert.security_advisory.severity;
    if (high.has(severity)) {
      byLevel.high.push(alert);
    } else if (medium.has(severity)) {
      byLevel.medium.push(alert);
    } else {
      byLevel.low.push(alert);
    }
  }

  // Low is the fallback, so a repo with no alerts is low risk.
  const bucket = byLevel.high.length
    ? RiskLevel.high
    : byLevel.medium.length
    ? RiskLevel.medium
    : RiskLevel.low;
  const days = getRiskDays(byLevel[bucket]);

  // High risk escalates to SLA breached once the oldest high-risk alert exceeds the SLA.
  const slaDays = config.get<number>(SLA_DAYS_KEY, DEFAULT_SLA_DAYS);
  const level =
    bucket === RiskLevel.high &&
    days !== undefined &&
    Number.isFinite(slaDays) &&
    slaDays >= 0 &&
    days > slaDays
      ? RiskLevel.slaBreached
      : bucket;
  const { label, colorKey, defaultColor } = RISK_SETTINGS[level];
  const colorId = config.get<string>(colorKey)?.trim() || defaultColor;

  return {
    level,
    label,
    alerts: byLevel[bucket],
    days,
    color: new ThemeColor(colorId),
  };
}

// Whole days since the oldest alert was opened on the repo (created_at), not since the advisory was published.
export function getRiskDays(alerts: DependabotAlert[]): number | undefined {
  const oldest = alerts.reduce<number | undefined>((min, alert) => {
    const created = Date.parse(alert.created_at);
    if (Number.isNaN(created)) {
      return min;
    }
    return min === undefined || created < min ? created : min;
  }, undefined);
  if (oldest === undefined) {
    return;
  }
  return Math.max(0, Math.floor((Date.now() - oldest) / 86_400_000));
}

export function formatRiskDuration(days: number) {
  return days === 1 ? "1 day" : `${days} days`;
}
