import { runInAction } from "mobx";
import { ExtensionContext } from "vscode";
import {
  CodeScanningAlert,
  DependabotAlert,
  RepoAccount,
  RepoState,
  store,
} from ".";
import { getApi } from "./auth";

const DISABLED_REPOS_KEY = "github-security.disabledRepositories";
const REPO_ACCOUNTS_KEY = "github-security.repositoryAccounts";
let extensionContext: ExtensionContext | undefined;

export function initializeRepoSettings(context: ExtensionContext) {
  extensionContext = context;
}

export function isRepoDisabled(repoId: string) {
  return (
    extensionContext?.workspaceState
      .get<string[]>(DISABLED_REPOS_KEY, [])
      .includes(repoId) ?? false
  );
}

// Keyed by owner/name (not workspace path) so the choice follows the repo across workspaces.
function repoAccountKey(repo: { owner: string; name: string }) {
  return `${repo.owner}/${repo.name}`.toLowerCase();
}

export function getRepoAccount(repo: {
  owner: string;
  name: string;
}): RepoAccount | undefined {
  return extensionContext?.globalState.get<Record<string, RepoAccount>>(
    REPO_ACCOUNTS_KEY,
    {}
  )[repoAccountKey(repo)];
}

export async function setRepoAccount(
  repo: RepoState,
  account: RepoAccount | undefined
) {
  const accounts = {
    ...extensionContext?.globalState.get<Record<string, RepoAccount>>(
      REPO_ACCOUNTS_KEY,
      {}
    ),
  };
  const key = repoAccountKey(repo);
  if (account) {
    accounts[key] = account;
  } else {
    delete accounts[key];
  }
  await extensionContext?.globalState.update(REPO_ACCOUNTS_KEY, accounts);

  runInAction(() => {
    repo.account = account;
  });

  await refreshRepoAlerts(repo);
}

async function persistDisabledRepos() {
  const disabled = store.repos
    .filter((repo) => !repo.isEnabled)
    .map((repo) => repo.id);
  await extensionContext?.workspaceState.update(DISABLED_REPOS_KEY, disabled);
}

export async function setRepoEnabled(repo: RepoState, enabled: boolean) {
  if (repo.isEnabled === enabled) {
    return;
  }

  runInAction(() => {
    repo.isEnabled = enabled;
    if (!enabled) {
      repo.dependabotAlerts = [];
      repo.codeScanningAlerts = [];
      repo.isLoading = false;
      if (store.visibleAlert?.repoId === repo.id) {
        store.visibleAlert = undefined;
      }
    }
  });

  await persistDisabledRepos();

  if (enabled) {
    await refreshRepoAlerts(repo);
  }
}

export async function setAllReposEnabled(enabled: boolean) {
  await Promise.all(
    store.repos.map((repo) => setRepoEnabled(repo, enabled))
  );
}

// Per-repo sequence numbers so a stale refresh can't overwrite a newer one.
const refreshSequences = new Map<string, number>();

function isCurrent(repo: RepoState, sequence: number) {
  return (
    refreshSequences.get(repo.id) === sequence && store.repos.includes(repo)
  );
}

export async function enableDependabot(repo: RepoState) {
  const api = await getApi(repo);

  try {
    await api.repos.enableVulnerabilityAlerts({
      owner: repo.owner,
      repo: repo.name,
    });
    return true;
  } catch {
    // The user doesn't have permission to enable this
    return false;
  }
}

type DependabotResult =
  | { alerts: DependabotAlert[] }
  | { alerts: null; accessDenied: boolean };

async function listDependabotAlerts(
  repository: RepoState
): Promise<DependabotResult> {
  const api = await getApi(repository);

  try {
    const { data } = await api.request(
      "GET /repos/{owner}/{repo}/dependabot/alerts",
      {
        owner: repository.owner,
        repo: repository.name,
        per_page: 100,
        sort: "updated",
        state: "open",
      }
    );
    return { alerts: data as unknown as DependabotAlert[] };
  } catch (error: any) {
    // GitHub answers 403 "Dependabot alerts are disabled for this repository." when
    // it's off; any other 403/404 means the current account/token can't see the repo.
    const message: string = error?.message ?? "";
    const disabled =
      error?.status === 403 && /dependabot alerts are disabled/i.test(message);
    return { alerts: null, accessDenied: !disabled };
  }
}

async function listCodeScanningAlerts(
  repository: RepoState
): Promise<CodeScanningAlert[] | null> {
  const api = await getApi(repository);

  try {
    const { data } = await api.codeScanning.listAlertsForRepo({
      owner: repository.owner,
      repo: repository.name,
      per_page: 100,
      sort: "updated",
      state: "open",
    });

    return data as unknown as CodeScanningAlert[];
  } catch {
    // Code scanning isn't enabled on this repo
    return null;
  }
}

async function loadCodeScanningAlertDetails(
  repo: RepoState,
  alerts: CodeScanningAlert[],
  sequence: number
) {
  try {
    const api = await getApi(repo);
    const details = await Promise.allSettled(
      alerts.map(async (alert) => {
        const [alertResponse, instancesResponse] = await Promise.all([
          api.codeScanning.getAlert({
            owner: repo.owner,
            repo: repo.name,
            alert_number: alert.number,
          }),
          api.codeScanning.listAlertInstances({
            owner: repo.owner,
            repo: repo.name,
            alert_number: alert.number,
          }),
        ]);

        return {
          number: alert.number,
          help: alertResponse.data.rule.help,
          instances: instancesResponse.data as unknown as CodeScanningAlert[
            "additionalLocations"
          ],
        };
      })
    );

    if (!isCurrent(repo, sequence)) {
      return;
    }

    runInAction(() => {
      details.forEach((result) => {
        if (result.status !== "fulfilled") {
          return;
        }
        const alert = repo.codeScanningAlerts?.find(
          (item) => item.number === result.value.number
        );
        if (!alert) {
          return;
        }
        alert.rule.help = result.value.help;
        alert.additionalLocations = result.value.instances;
      });
    });
  } catch {}
}

export async function refreshRepoAlerts(repo: RepoState) {
  const sequence = (refreshSequences.get(repo.id) || 0) + 1;
  refreshSequences.set(repo.id, sequence);

  if (!store.isSignedIn || !repo.isEnabled) {
    repo.isLoading = false;
    return;
  }

  repo.isLoading = true;

  try {
    const [dependabotResult, codeScanningAlerts] = await Promise.all([
      listDependabotAlerts(repo),
      listCodeScanningAlerts(repo),
    ]);

    if (!isCurrent(repo, sequence)) {
      return;
    }

    runInAction(() => {
      repo.dependabotAlerts = dependabotResult.alerts;
      repo.dependabotAccessDenied =
        dependabotResult.alerts === null && dependabotResult.accessDenied;
      repo.codeScanningAlerts = codeScanningAlerts;
    });

    if (codeScanningAlerts) {
      void loadCodeScanningAlertDetails(repo, codeScanningAlerts, sequence);
    }
  } finally {
    if (isCurrent(repo, sequence)) {
      repo.isLoading = false;
    }
  }
}

export async function refreshAlerts() {
  await Promise.all(
    store.repos
      .filter((repo) => repo.isEnabled)
      .map((repo) => refreshRepoAlerts(repo))
  );
}

export async function dismissDependabotAlert(
  repo: RepoState,
  alertNumber: number,
  reason: string
) {
  const api = await getApi(repo);
  const { data } = await api.request(
    "PATCH /repos/{owner}/{repo}/dependabot/alerts/{alert_number}",
    {
      owner: repo.owner,
      repo: repo.name,
      alert_number: alertNumber,
      state: "dismissed",
      // @ts-ignore
      dismissed_reason: reason,
    }
  );
  repo.dependabotAlerts = repo.dependabotAlerts!.filter(
    (alert) => alert.number !== alertNumber
  );

  if (
    store.visibleAlert?.type === "dependabot" &&
    store.visibleAlert.repoId === repo.id &&
    store.visibleAlert.number === alertNumber
  ) {
    store.visibleAlert = undefined;
  }

  return data;
}

export async function dismissCodeScanningAlert(
  repo: RepoState,
  alertNumber: number,
  reason: string
) {
  const api = await getApi(repo);
  const { data } = await api.codeScanning.updateAlert({
    owner: repo.owner,
    repo: repo.name,
    alert_number: alertNumber,
    state: "dismissed",
    // @ts-ignore
    dismissed_reason: reason,
  });
  repo.codeScanningAlerts = repo.codeScanningAlerts!.filter(
    (alert) => alert.number !== alertNumber
  );
  if (
    store.visibleAlert?.type === "code-scanning" &&
    store.visibleAlert.repoId === repo.id &&
    store.visibleAlert.number === alertNumber
  ) {
    store.visibleAlert = undefined;
  }
  return data;
}
