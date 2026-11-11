import { h } from "./dom.js";
import { selectRequest, selectedRequest, state, tab, updateTab } from "./store.js";

const COLUMNS = 6;
const MIN_ROWS = 10;

const NUMBER_ROWS = [
  ["7", "8", "9"],
  ["4", "5", "6"],
  ["1", "2", "3"],
  ["0", ".", "-"],
  [
    { label: "訂正", edit: "backspace" },
    { label: "消去", edit: "clear" },
  ],
];

/**
 * A key is `{ label, on, press }`; null is a blank cell.
 * Each row is padded to the grid width, so every field's keys start on a new line.
 */
function rowsFor() {
  const current = tab();
  switch (current.keyMode) {
    case "requests":
      return chunk(
        state.requests.map((request) => ({
          label: request.name,
          on: request.id === current.selectedId,
          press: () => selectRequest(request.id),
        })),
      );
    case "number":
      return NUMBER_ROWS.map((row) =>
        row.map((key) => {
          const { label, edit } = typeof key === "string" ? { label: key, edit: key } : key;
          return { label, on: false, press: () => editFocusedField(edit) };
        }),
      );
    case "full": {
      const def = selectedRequest();
      if (!def) return [];
      return def.fields.flatMap((field) =>
        chunk(
          field.options.map((option) => ({
            label: option.label,
            on: current.values[field.id] === option.value,
            press: () =>
              updateTab({
                values: { ...current.values, [field.id]: option.value },
                focusedFieldId: field.id,
                status: "",
              }),
          })),
        ),
      );
    }
  }
}

function chunk(keys) {
  const rows = [];
  for (let i = 0; i < keys.length; i += COLUMNS) rows.push(keys.slice(i, i + COLUMNS));
  return rows;
}

function editFocusedField(edit) {
  const { focusedFieldId: id, values } = tab();
  if (id === null) {
    updateTab({ status: "入力する項目を選んでください" });
    return;
  }
  const current = values[id] ?? "";
  const next = edit === "backspace" ? current.slice(0, -1) : edit === "clear" ? "" : current + edit;
  updateTab({ values: { ...values, [id]: next }, status: "" });
}

export function mountKeyPanel(root) {
  const grid = root.querySelector("#key-grid");
  const tabs = [...root.querySelectorAll(".tab")];
  let keys = [];

  // Keep keyboard focus in the form while the operator presses on-screen keys.
  grid.addEventListener("mousedown", (event) => event.preventDefault());
  grid.addEventListener("click", (event) => {
    const cell = event.target.closest("[data-key]");
    if (cell) keys[Number(cell.dataset.key)].press();
  });
  for (const button of tabs) {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => updateTab({ keyMode: button.dataset.mode }));
  }

  return function render() {
    for (const button of tabs) button.classList.toggle("active", button.dataset.mode === tab().keyMode);

    const rows = rowsFor();
    while (rows.length < MIN_ROWS) rows.push([]);
    keys = [];
    grid.replaceChildren(
      ...rows.flatMap((row) =>
        Array.from({ length: COLUMNS }, (_, column) => {
          const key = row[column];
          if (!key) return h("span", { className: "key blank" });
          keys.push(key);
          return h(
            "button",
            { type: "button", className: key.on ? "key on" : "key", dataset: { key: keys.length - 1 } },
            key.label,
          );
        }),
      ),
    );
  };
}
