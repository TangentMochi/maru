import { mountRegistry } from "./js/registry.js";
import { load, state, subscribe, updateTab } from "./js/store.js";
import { mountTerminal } from "./js/terminal.js";

const terminal = document.querySelector("#terminal");
const renderTerminal = mountTerminal(terminal);
const renderRegistry = mountRegistry(document.querySelector("#registry"));

subscribe(() => {
  terminal.hidden = state.view === "registry";
  renderTerminal();
  renderRegistry();
});

load().catch((error) => updateTab({ status: `登録内容を読み込めませんでした: ${error}` }));
