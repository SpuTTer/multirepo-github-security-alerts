import { observable, runInAction } from "mobx";
import * as vscode from "vscode";
import { RepoState, Store } from "./store";
import {
  getRepoAccount,
  isRepoDisabled,
  refreshRepoAlerts,
} from "./store/actions";

export interface Remote {
  readonly name: string;
  readonly fetchUrl?: string;
}

interface RepositoryState {
  remotes: Remote[];

  onDidChange: vscode.Event<void>;
}

export interface Repository {
  rootUri: vscode.Uri;
  state: RepositoryState;
}

interface GitAPI {
  state: string;
  repositories: Repository[];

  onDidOpenRepository: vscode.Event<Repository>;
  onDidCloseRepository: vscode.Event<Repository>;
}

async function getGitApi(): Promise<GitAPI | undefined> {
  const extension = vscode.extensions.getExtension("vscode.git");
  if (!extension) {
    return;
  }

  if (!extension.isActive) {
    await extension.activate();
  }

  return extension.exports.getAPI(1);
}

const GITHUB_PATTERN = /github\.com[/:]([^/:]+)\/([^/:]+?)(?:\.git)?\/?$/i;

function getGitHubRepository(repository: Repository) {
  const remote =
    repository.state.remotes.find(
      (item) =>
        item.name === "origin" &&
        item.fetchUrl &&
        GITHUB_PATTERN.test(item.fetchUrl)
    ) ||
    repository.state.remotes.find(
      (item) => item.fetchUrl && GITHUB_PATTERN.test(item.fetchUrl)
    );
  const match = remote?.fetchUrl && GITHUB_PATTERN.exec(remote.fetchUrl);

  if (!match) {
    return;
  }

  return {
    owner: match[1],
    name: match[2],
    rootUri: repository.rootUri,
  };
}

export async function initializeGit(
  context: vscode.ExtensionContext,
  store: Store
) {
  const git = await getGitApi();
  if (!git) {
    return;
  }

  const synchronizeRepositories = async () => {
    const discovered = git.repositories.flatMap((repository) => {
      const githubRepository = getGitHubRepository(repository);
      return githubRepository ? [githubRepository] : [];
    });

    const added: RepoState[] = [];
    const next: RepoState[] = [];

    for (const found of discovered) {
      const id = found.rootUri.toString();
      const existing = store.repos.find(
        (repo) =>
          repo.id === id &&
          repo.owner === found.owner &&
          repo.name === found.name
      );
      if (existing) {
        next.push(existing);
        continue;
      }
      const repo: RepoState = observable({
        id,
        owner: found.owner,
        name: found.name,
        rootUri: found.rootUri,
        isEnabled: !isRepoDisabled(id),
        account: getRepoAccount(found),
        dependabotAlerts: [],
        codeScanningAlerts: [],
        isLoading: false,
      });
      next.push(repo);
      added.push(repo);
    }

    next.sort((a, b) =>
      `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`)
    );

    const removed = store.repos.filter((repo) => !next.includes(repo));
    if (removed.length === 0 && added.length === 0) {
      return;
    }

    runInAction(() => {
      store.repos = next;
      if (
        store.visibleAlert &&
        !next.some((repo) => repo.id === store.visibleAlert!.repoId)
      ) {
        store.visibleAlert = undefined;
      }
    });

    await vscode.commands.executeCommand(
      "setContext",
      "github-security:enabled",
      next.length > 0
    );

    await Promise.all(added.map((repo) => refreshRepoAlerts(repo)));
  };

  const watchRepository = (repository: Repository) => {
    context.subscriptions.push(
      repository.state.onDidChange(() => {
        void synchronizeRepositories();
      })
    );
  };

  git.repositories.forEach(watchRepository);
  context.subscriptions.push(
    git.onDidOpenRepository((repository) => {
      watchRepository(repository);
      void synchronizeRepositories();
    }),
    git.onDidCloseRepository(() => {
      void synchronizeRepositories();
    })
  );

  await synchronizeRepositories();
}
