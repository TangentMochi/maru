import { h } from "./dom.js";
import { formatOptions, METHODS, parseOptions, TARGETS, TYPES } from "./request.js";
import { replaceRequests, state, tab, update } from "./store.js";

function newRequest() {
  return { id: crypto.randomUUID(), name: "", method: "GET", url: "https://", fields: [] };
}

function newField() {
  return {
    id: crypto.randomUUID(),
    label: "",
    name: "",
    target: "query",
    type: "text",
    options: [],
    required: false,
    default: "",
  };
}

/** @returns {string | null} what is missing, or null when every request can be saved. */
function problemIn(requests) {
  for (const request of requests) {
    const title = request.name || "（名称なし）";
    if (request.name.trim() === "") return "名称のないリクエストがあります";
    if (request.url.trim() === "") return `${title}: URLを入力してください`;
    for (const field of request.fields) {
      if (field.label.trim() === "") return `${title}: 表示名のない項目があります`;
      if (field.name.trim() === "") return `${title}: ${field.label}の送信名を入力してください`;
    }
  }
  return null;
}

function select(options, value, onChange) {
  const element = h(
    "select",
    {},
    ...options.map((option) => {
      const { value, label } = typeof option === "string" ? { value: option, label: option } : option;
      return h("option", { value }, label);
    }),
  );
  element.value = value;
  element.addEventListener("change", () => onChange(element.value));
  return element;
}

function textInput(value, onInput, props = {}) {
  const element = h("input", { type: "text", value, autocomplete: "off", spellcheck: false, ...props });
  element.addEventListener("input", () => onInput(element.value));
  return element;
}

export function mountRegistry(root) {
  /** Edits happen on this copy and reach the store only through 登録. */
  let draft = null;
  let editingId = null;
  let message = "";

  function open() {
    draft = structuredClone(state.requests);
    editingId = draft.find((request) => request.id === tab().selectedId)?.id ?? draft[0]?.id ?? null;
    message = "";
  }

  function close() {
    draft = null;
    update({ view: "form" });
  }

  async function save() {
    message = problemIn(draft) ?? "";
    if (message !== "") return draw();
    try {
      await replaceRequests(draft);
    } catch (error) {
      message = `保存できませんでした: ${error}`;
      return draw();
    }
    close();
  }

  function fieldRow(request, field) {
    const check = h("input", { type: "checkbox", id: `required-${field.id}`, checked: field.required });
    check.addEventListener("change", () => (field.required = check.checked));
    const remove = h("button", { type: "button" }, "削除");
    remove.addEventListener("click", () => {
      request.fields = request.fields.filter((other) => other !== field);
      draw();
    });
    return h(
      "tr",
      {},
      h("td", {}, textInput(field.label, (value) => (field.label = value))),
      h("td", {}, textInput(field.name, (value) => (field.name = value))),
      h("td", {}, select(TARGETS, field.target, (value) => (field.target = value))),
      h("td", {}, select(TYPES, field.type, (value) => (field.type = value))),
      h(
        "td",
        {},
        textInput(formatOptions(field.options), (value) => (field.options = parseOptions(value))),
      ),
      h("td", {}, textInput(field.default, (value) => (field.default = value))),
      h("td", { className: "center" }, check, h("label", { htmlFor: check.id })),
      h("td", {}, remove),
    );
  }

  function editor(request) {
    const addField = h("button", { type: "button" }, "項目追加");
    addField.addEventListener("click", () => {
      request.fields.push(newField());
      draw();
    });
    return h(
      "div",
      { className: "editor" },
      h(
        "div",
        { className: "field-row" },
        h("label", {}, "名称"),
        textInput(request.name, (value) => {
          request.name = value;
          root.querySelector(`[data-request="${request.id}"]`).textContent = value || "（名称なし）";
        }),
        h("label", {}, "メソッド"),
        select(METHODS, request.method, (value) => (request.method = value)),
      ),
      h(
        "div",
        { className: "field-row" },
        h("label", {}, "URL"),
        textInput(request.url, (value) => (request.url = value), {
          className: "wide",
          placeholder: "https://api.example.com/users/{id}",
        }),
      ),
      h("p", { className: "hint" }, "場所が「パス」の項目は、URL 内の {送信名} に入ります。選択肢は「大人1=1, 大人2=2」のように「表示=値」をカンマで区切ります。"),
      h(
        "div",
        { className: "sunken-panel fields" },
        h(
          "table",
          {},
          h(
            "thead",
            {},
            h("tr", {}, ...["表示名", "送信名", "場所", "種類", "選択肢", "初期値", "必須", ""].map((title) => h("th", {}, title))),
          ),
          h("tbody", {}, ...request.fields.map((field) => fieldRow(request, field))),
        ),
      ),
      h("div", { className: "field-row" }, addField),
    );
  }

  function draw() {
    const editing = draft.find((request) => request.id === editingId) ?? null;

    const list = h(
      "ul",
      { className: "tree-view request-list" },
      ...draft.map((request) => {
        const item = h(
          "li",
          { className: request.id === editingId ? "selected" : "", dataset: { request: request.id } },
          request.name || "（名称なし）",
        );
        item.addEventListener("click", () => {
          editingId = request.id;
          draw();
        });
        return item;
      }),
    );

    const button = (label, onClick, disabled = false) => {
      const element = h("button", { type: "button", disabled }, label);
      element.addEventListener("click", onClick);
      return element;
    };

    root.replaceChildren(
      h("div", { className: "title-bar" }, h("div", { className: "title-bar-text" }, "リクエスト登録")),
      h(
        "div",
        { className: "window-body registry-body" },
        h(
          "div",
          { className: "registry-side" },
          list,
          h(
            "div",
            { className: "field-row" },
            button("新規", () => {
              const request = newRequest();
              draft.push(request);
              editingId = request.id;
              draw();
            }),
            button(
              "削除",
              () => {
                draft = draft.filter((request) => request.id !== editingId);
                editingId = draft[0]?.id ?? null;
                draw();
              },
              editing === null,
            ),
          ),
        ),
        editing ? editor(editing) : h("div", { className: "editor empty" }, "「新規」でリクエストを追加してください。"),
      ),
      h(
        "div",
        { className: "registry-foot" },
        h("output", { className: "registry-message" }, message),
        button("登録", save),
        button("取消", close),
      ),
    );
  }

  return function render() {
    const visible = state.view === "registry";
    root.hidden = !visible;
    if (visible && draft === null) {
      open();
      draw();
    }
  };
}
