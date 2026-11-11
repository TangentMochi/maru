import * as backend from "./backend.js";
import { h } from "./dom.js";
import { mountKeyPanel } from "./keypanel.js";
import { buildRequest } from "./request.js";
import {
  anySending,
  endSession,
  HISTORY_LIMIT,
  pauseSession,
  selectedRequest,
  shownOutcome,
  startSession,
  state,
  switchTab,
  tab,
  TABS,
  updateTab,
} from "./store.js";
import { NO, RECONSIDER, verdict, YES } from "./verdict.js";

/** Keys without an `action` exist only to match the real terminal and stay disabled. */
const FUNCTION_KEYS = [
  { label: "登録", action: "menu" },
  { label: "" },
  { label: "" },
  { label: "" },
  { label: "" },
  { label: "開始", action: "start" },
  { label: "終了", action: "end" },
  { label: "中断", action: "pause", tone: "red" },
  { label: "" },
  { label: "" },
  { label: "一括開始" },
  { label: "一括終了" },
  { label: "応答", action: "response" },
  { label: "消去", action: "clear" },
  { label: "履歴前", action: "older" },
  { label: "履歴後", action: "newer" },
];

const VERDICT_CLASS = { [YES]: "yes", [NO]: "no", [RECONSIDER]: "reconsider" };

function prettyBody(body) {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

/** The response lands in the tab that sent it, even if the operator has switched away. */
async function send() {
  const index = state.activeTab;
  const def = selectedRequest(index);
  const current = tab(index);
  if (!def || current.sending !== null) return;

  const built = buildRequest(def, current.values);
  if (!built.ok) {
    updateTab({ status: built.message, focusedFieldId: built.fieldId ?? current.focusedFieldId }, index);
    return;
  }

  const id = crypto.randomUUID();
  updateTab({ sending: id, status: `${def.name}を発信しました` }, index);

  let result;
  try {
    const response = await backend.sendRequest(id, built.request);
    result = { status: response.status, message: response.status_text, body: prettyBody(response.body) };
  } catch (error) {
    result = { status: null, message: String(error), body: "" };
  }
  const previous = tab(index).history;
  const seq = (previous.at(-1)?.seq ?? 0) + 1;
  const history = [...previous, { ...result, verdict: verdict(result.status), seq }].slice(-HISTORY_LIMIT);
  updateTab({ sending: null, status: "", responseOpen: true, history, shown: history.length - 1 }, index);
}

const ACTIONS = {
  start: () => startSession(),
  end: () => endSession(),
  menu: () => {
    state.view = "registry";
    updateTab({ status: "" });
  },
  pause: () => pauseSession(),
  response: () => updateTab({ responseOpen: !tab().responseOpen }),
  clear: () => updateTab({ history: [], shown: -1, responseOpen: false, status: "応答履歴を消去しました" }),
  older: () => updateTab({ shown: tab().shown - 1, responseOpen: true, status: "" }),
  newer: () => updateTab({ shown: tab().shown + 1, responseOpen: true, status: "" }),
};

const ENABLED = {
  start: () => state.session !== "active" && !anySending(),
  end: () => state.session !== "off" && !anySending(),
  pause: () => state.session === "active" && !anySending(),
  menu: () => tab().sending === null,
  response: () => shownOutcome() !== null,
  clear: () => tab().history.length > 0 && tab().sending === null,
  older: () => tab().shown > 0,
  newer: () => tab().shown < tab().history.length - 1,
};

export function mountTerminal(root) {
  const $ = (selector) => root.querySelector(selector);
  const renderKeys = mountKeyPanel(root);

  const functionButtons = FUNCTION_KEYS.map(({ label, action, tone }) => {
    const button = h(
      "button",
      { type: "button", className: `${tone ?? ""} ${label.length >= 4 ? "small" : ""}`, disabled: !action },
      label,
    );
    if (action) button.addEventListener("click", ACTIONS[action]);
    return { button, action };
  });
  $("#function-keys").append(...functionButtons.map(({ button }) => button));

  const tabButtons = TABS.map((label, index) => {
    const button = h("button", { type: "button", className: "mode-key" }, label);
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => switchTab(index));
    return button;
  });
  $("#mode-keys").append(...tabButtons);
  const tabNames = [...root.querySelectorAll(".tab-name")];

  document.addEventListener("keydown", (event) => {
    const index = TABS.indexOf(event.key);
    if (index === -1 || state.view !== "form") return;
    event.preventDefault();
    switchTab(index);
  });

  $("#send").addEventListener("click", send);
  $("#abort").addEventListener("click", () => tab().sending !== null && backend.cancelRequest(tab().sending));
  $("#side-menu").addEventListener("mousedown", (event) => event.preventDefault());
  $("#side-menu").addEventListener("click", () =>
    updateTab({ keyMode: tab().keyMode === "requests" ? "full" : "requests", responseOpen: false }),
  );

  const form = $("#form-view");
  form.addEventListener("focusin", (event) => {
    const id = event.target.dataset.field;
    if (id && id !== tab().focusedFieldId) updateTab({ focusedFieldId: id, responseOpen: false });
  });
  form.addEventListener("input", (event) => {
    const id = event.target.dataset.field;
    if (id) updateTab({ values: { ...tab().values, [id]: event.target.value }, responseOpen: false, status: "" });
  });
  form.addEventListener("click", (event) => {
    const id = event.target.dataset.labelFor;
    if (id) updateTab({ focusedFieldId: id, responseOpen: false });
  });
  form.addEventListener("keydown", (event) => {
    if (event.key === "Enter") send();
  });

  let renderedDef = null;

  function renderForm(def, current) {
    if (def !== renderedDef) {
      renderedDef = def;
      form.replaceChildren(
        ...(def?.fields ?? []).map((field) =>
          h(
            "div",
            { className: field.type === "number" ? "field narrow" : "field", dataset: { row: field.id } },
            h("button", { type: "button", className: "field-label", dataset: { labelFor: field.id } }, field.label),
            h("input", {
              type: "text",
              inputMode: field.type === "number" ? "decimal" : "text",
              autocomplete: "off",
              spellcheck: false,
              dataset: { field: field.id },
            }),
          ),
        ),
      );
    }
    for (const row of form.children) {
      const id = row.dataset.row;
      const input = row.querySelector("input");
      const value = current.values[id] ?? "";
      if (input.value !== value) input.value = value;
      const focused = id === current.focusedFieldId;
      row.classList.toggle("current", focused);
      if (focused && state.view === "form" && document.activeElement !== input) input.focus();
      if (!focused && document.activeElement === input) input.blur();
    }
  }

  return function render() {
    const def = selectedRequest();
    const current = tab();
    const sending = current.sending !== null;

    for (const { button, action } of functionButtons) {
      if (action) button.disabled = !ENABLED[action]();
    }
    tabButtons.forEach((button, index) => {
      button.classList.toggle("lit", index === state.activeTab);
      button.classList.toggle("busy", tab(index).sending !== null);
    });
    tabNames.forEach((box, index) => {
      const name = selectedRequest(index)?.name ?? "";
      box.textContent = name;
      box.title = name;
      box.classList.toggle("lit", index === state.activeTab);
    });
    $("#send").disabled = !def || sending;
    $("#abort").disabled = !sending;
    $("#side-menu").classList.toggle("active", current.keyMode === "requests");

    $("#request-name").textContent = def?.name ?? "";
    renderForm(def, current);
    $("#response-view").hidden = !current.responseOpen;

    const outcome = shownOutcome();
    if (outcome) {
      $("#verdict").textContent = outcome.verdict;
      $("#verdict").className = `verdict ${VERDICT_CLASS[outcome.verdict]}`;
      $("#status-code").textContent = outcome.status ?? "";
      $("#response-message").textContent = outcome.message;
      $("#response-body").textContent =
        `# ${outcome.seq}  (${current.shown + 1}/${current.history.length})\n\n${outcome.body}`;
    }

    renderKeys();
    $("#progress").textContent = sending ? "通信中…" : "準備完了";
    $("#progress").classList.toggle("running", sending);
    $("#status-message").textContent = current.status;
  };
}
