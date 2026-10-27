import { Octokit } from "@octokit/rest";
import { when } from "mobx";
import {
  authentication,
  AuthenticationSession,
  AuthenticationSessionAccountInformation,
  commands,
  window,
  workspace,
} from "vscode";
import { CONFIG_SECTION } from "../config";
import { RepoState, store } from "./";
import { refreshAlerts } from "./actions";
let loginSession: string | undefined;

const STATE_CONTEXT_KEY = `github-security:state`;
const STATE_SIGNED_IN = "SignedIn";
const STATE_SIGNED_OUT = "SignedOut";

const DEFAULT_ACCOUNT_SETTING = "defaultAccount";

const REPO_SCOPE = "repo";
const SECURITY_SCOPE = "security_events";
export const AUTH_SCOPES = [REPO_SCOPE, SECURITY_SCOPE];

export function getConfiguredDefaultAccount() {
  return (
    workspace
      .getConfiguration(CONFIG_SECTION)
      .get<string>(DEFAULT_ACCOUNT_SETTING, "")
      .trim() || undefined
  );
}

export async function setConfiguredDefaultAccount(label: string | undefined) {
  await workspace
    .getConfiguration(CONFIG_SECTION)
    .update(DEFAULT_ACCOUNT_SETTING, label ?? "", true);
}

function sameLabel(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
}

export async function getApi(repo?: RepoState) {
  return new Octokit({
    auth: await getTokenForRepo(repo),
  });
}

async function getTokenForRepo(repo?: RepoState) {
  if (!repo?.account || repo.account.id === store.account?.id) {
    return store.token;
  }

  try {
    const session = await authentication.getSession("github", AUTH_SCOPES, {
      account: repo.account,
      silent: true,
    });
    if (session) {
      return session.accessToken;
    }
  } catch {}

  // No usable session for the pinned account; the request will fail and the
  // tree will surface it as an access problem rather than silently switching accounts.
  return undefined;
}

export async function listAccounts() {
  return authentication.getAccounts("github");
}

// Prompts (if needed) so a pinned account has a session with the required scopes.
export async function ensureAccountSession(
  account: AuthenticationSessionAccountInformation
) {
  try {
    isSigningIn = true;
    return await authentication.getSession("github", AUTH_SCOPES, {
      account,
      createIfNone: true,
    });
  } finally {
    isSigningIn = false;
  }
}

export async function signInWithNewAccount() {
  try {
    isSigningIn = true;
    return await authentication.getSession("github", AUTH_SCOPES, {
      forceNewSession: true,
    });
  } catch {
    return undefined;
  } finally {
    isSigningIn = false;
  }
}

const TOKEN_RESPONSE = "Sign in";
export async function ensureAuthenticated() {
  if (store.isSignedIn) {
    return;
  }

  const response = await window.showErrorMessage(
    "You need to sign-in with GitHub to perform this operation.",
    TOKEN_RESPONSE
  );
  if (response === TOKEN_RESPONSE) {
    await signIn();
  }
}

async function getSession(isInteractiveSignIn: boolean = false) {
  try {
    if (isInteractiveSignIn) {
      isSigningIn = true;
    }

    let session: AuthenticationSession | undefined;
    const configured = getConfiguredDefaultAccount();

    if (configured) {
      // The setting wins over whatever account VS Code would otherwise prefer.
      const accounts = await authentication.getAccounts("github");
      const account = accounts.find((a) => sameLabel(a.label, configured));

      if (account) {
        session = await authentication.getSession("github", AUTH_SCOPES, {
          account,
          createIfNone: isInteractiveSignIn,
          silent: !isInteractiveSignIn,
        });
      } else if (isInteractiveSignIn) {
        // Not signed in to the configured account at all, so a fresh login is required.
        session = await authentication.getSession("github", AUTH_SCOPES, {
          forceNewSession: true,
        });
        if (session && !sameLabel(session.account.label, configured)) {
          window.showWarningMessage(
            `Signed in as ${session.account.label}, but the default GitHub ` +
              `account setting is "${configured}". Update the setting or sign in ` +
              `with that account.`
          );
        }
      }
    } else {
      // Once a default account is known, stick to it so adding a second account
      // (for a per-repo override) doesn't silently change the default.
      if (!isInteractiveSignIn && store.account) {
        session = await authentication.getSession("github", AUTH_SCOPES, {
          account: store.account,
          silent: true,
        });
      }
      if (!session) {
        session = await authentication.getSession("github", AUTH_SCOPES, {
          createIfNone: isInteractiveSignIn,
        });
      }
    }

    if (session) {
      loginSession = session?.id;
    }

    isSigningIn = false;

    return session;
  } catch {}
}

export async function getToken() {
  return store.token;
}

async function markUserAsSignedIn(
  session: AuthenticationSession,
  refreshUI: boolean = true
) {
  loginSession = session.id;

  store.isSignedIn = true;
  store.token = session.accessToken;
  store.account = { id: session.account.id, label: session.account.label };

  if (refreshUI) {
    commands.executeCommand("setContext", STATE_CONTEXT_KEY, STATE_SIGNED_IN);
    await refreshAlerts();
  }
}

function markUserAsSignedOut() {
  loginSession = undefined;

  store.isSignedIn = false;

  commands.executeCommand("setContext", STATE_CONTEXT_KEY, STATE_SIGNED_OUT);
}

let isSigningIn = false;
export async function signIn() {
  const session = await getSession(true);

  if (session) {
    await markUserAsSignedIn(session);
    return true;
  }
}

async function attemptSilentSignin(refreshUI: boolean = true) {
  const session = await getSession();

  if (session) {
    await markUserAsSignedIn(session, refreshUI);
  } else {
    await markUserAsSignedOut();
  }
}

export async function initializeAuth() {
  await when(() => store.repos.length > 0);

  workspace.onDidChangeConfiguration(async (e) => {
    if (
      e.affectsConfiguration(`${CONFIG_SECTION}.${DEFAULT_ACCOUNT_SETTING}`)
    ) {
      await attemptSilentSignin();
    }
  });

  authentication.onDidChangeSessions(async (e) => {
    if (e.provider.id === "github") {
      // @ts-ignore
      if (e.added.length > 0) {
        // This session was added based on an extension-triggered
        // sign-in, and so we don't need to do anything further to process it.
        if (isSigningIn) {
          isSigningIn = false;
          return;
        }

        // The end-user just signed in to the extension via the
        // VS Code account UI, and therefore, we need
        // to grab the session token/etc.
        await attemptSilentSignin();
        // @ts-ignore
      } else if (e.changed.length > 0 && e.changed.includes(loginSession)) {
        await attemptSilentSignin(false);
      }
      // @ts-ignore
      else if (e.removed.length > 0 && e.removed.includes(loginSession)) {
        // TODO: Implement sign out support
      }
    }
  });

  await attemptSilentSignin();
}
