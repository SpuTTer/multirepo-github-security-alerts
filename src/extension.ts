import * as vscode from "vscode";
import { registerCommands } from "./commands";
import { registerDiagnosticsProvider } from "./diagnostics";
import { initializeGit } from "./git";
import { store } from "./store";
import { initializeRepoSettings } from "./store/actions";
import { initializeAuth } from "./store/auth";
import { registerTreeProvider } from "./tree";
import { setExtensionUri } from "./utils";

export async function activate(context: vscode.ExtensionContext) {
  setExtensionUri(context.extensionUri);
  initializeRepoSettings(context);
  registerCommands(context);
  registerTreeProvider(store);
  registerDiagnosticsProvider(store);

  await initializeGit(context, store);
  initializeAuth();

  vscode.workspace
    .getConfiguration("comments")
    .update("openView", "never", vscode.ConfigurationTarget.Global);
}
