import * as backend from "./backend.js";
import { initialValues } from "./request.js";

/**
 * @typedef {{ seq: number, verdict: string, status: number | null, message: string, body: string }} Outcome
 */

/** The four tabs, named after the keyboard keys that switch to them. */
export const TABS = ["F1", "F2", "F3", "F4"];

/**
 * What one tab is working on. Tabs share the registered requests but nothing else,
 * so each can hold its own request, entered values, and response.
 */
function emptyTab() {
  return {
    /** @type {string | null} */
    selectedId: null,
    /** @type {Record<string, string>} field id → entered text, for the selected request */
    values: {},
    /** @type {string | null} */
    focusedFieldId: null,
    /** @type {"full" | "number" | "requests"} */
    keyMode: "requests",
    /** @type {string | null} id of the request awaiting a response */
    sending: null,
    /** @type {Outcome[]} responses received in this tab, oldest first */
    history: [],
    /** Index into `history` of the response on display. */
    shown: -1,
    /** Whether the response covers the key panel. */
    responseOpen: false,
    status: "",
  };
}

export const state = {
  /** @type {import("./request.js").RequestDef[]} */
  requests: [],
  /** @type {"form" | "registry"} */
  view: "form",
  tabs: TABS.map(() => emptyTab()),
  activeTab: 0,
  /**
   * The HTTP session shared by every tab. While "active", requests carry the cookies earlier
   * responses set; while "paused", the cookies are kept but neither sent nor updated.
   * The backend owns the session, and this mirrors what its commands report.
   * @type {"off" | "active" | "paused"}
   */
  session: "off",
};

const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
}

export function update(patch) {
  Object.assign(state, patch);
  for (const listener of listeners) listener();
}

/** Responses kept per tab; older ones drop off first. */
export const HISTORY_LIMIT = 50;

/** The response on display, or null when the history is empty. */
export function shownOutcome(index = state.activeTab) {
  const { history, shown } = tab(index);
  return history[shown] ?? null;
}

export function tab(index = state.activeTab) {
  return state.tabs[index];
}

/** Patches one tab; the active tab unless `index` says otherwise. */
export function updateTab(patch, index = state.activeTab) {
  state.tabs[index] = { ...state.tabs[index], ...patch };
  update({});
}

export function switchTab(index) {
  if (index !== state.activeTab) update({ activeTab: index });
}

/** Whether any tab is waiting on a response, which would land after the session changed under it. */
export function anySending() {
  return state.tabs.some(({ sending }) => sending !== null);
}

async function changeSession(command, status) {
  try {
    state.session = await command();
    updateTab({ status });
  } catch (error) {
    updateTab({ status: `セッションを切り替えられませんでした: ${error}` });
  }
}

/** Starts a session with no cookies, or resumes a paused one with the cookies it had. */
export function startSession() {
  const status =
    state.session === "paused"
      ? "セッションを再開しました。中断前の Cookie を引き続き使います"
      : "セッションを開始しました。終了するまで全タブで Cookie を引き継ぎます";
  return changeSession(backend.startSession, status);
}

/** Lets requests go out without the session's cookies, which stay as they were. */
export function pauseSession() {
  return changeSession(backend.pauseSession, "中断中です。Cookie を送らず、受け取っても覚えません（開始で再開）");
}

export function endSession() {
  return changeSession(backend.endSession, "セッションを終了しました。Cookie を破棄しました");
}

export function selectedRequest(index = state.activeTab) {
  const { selectedId } = tab(index);
  return state.requests.find((request) => request.id === selectedId) ?? null;
}

export function selectRequest(id, index = state.activeTab) {
  const def = state.requests.find((request) => request.id === id) ?? null;
  state.view = "form";
  updateTab(
    {
      selectedId: def?.id ?? null,
      values: def ? initialValues(def) : {},
      focusedFieldId: null,
      keyMode: def ? "full" : "requests",
      responseOpen: false,
      status: "",
    },
    index,
  );
}

export async function load() {
  let requests = await backend.loadRequests();
  if (requests === null) {
    requests = [sampleRequest()];
    await backend.saveRequests(requests);
  }
  state.requests = requests;
  state.session = await backend.sessionStatus();
  selectRequest(requests[0]?.id ?? null, 0);
}

/** Tabs whose request was deleted fall back to the request list. */
export async function replaceRequests(requests) {
  await backend.saveRequests(requests);
  state.requests = requests;
  state.tabs.forEach(({ selectedId }, index) => {
    const kept = requests.some((request) => request.id === selectedId);
    selectRequest(kept ? selectedId : null, index);
  });
}

function sampleRequest() {
  const count = (prefix) => [1, 2, 3, 4].map((n) => ({ label: `${prefix}${n}`, value: String(n) }));
  const field = (overrides) => ({
    id: crypto.randomUUID(),
    type: "text",
    options: [],
    required: false,
    default: "",
    ...overrides,
  });
  return {
    id: crypto.randomUUID(),
    name: "入場券",
    method: "POST",
    url: "https://httpbin.org/anything/{station}",
    fields: [
      field({ label: "駅", name: "station", target: "path", default: "tokyo" }),
      field({
        label: "使用日",
        name: "date",
        target: "query",
        options: [
          { label: "本日", value: "today" },
          { label: "明日", value: "tomorrow" },
          { label: "明後日", value: "day-after-tomorrow" },
        ],
      }),
      field({ label: "大人", name: "adult", target: "body", type: "number", options: count("大人") }),
      field({ label: "小児", name: "child", target: "body", type: "number", options: count("小児") }),
    ],
  };
}
