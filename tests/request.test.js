import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRequest, formatOptions, initialValues, parseOptions } from "../src/js/request.js";

function field(overrides) {
  return {
    id: overrides.name,
    label: overrides.name,
    type: "text",
    options: [],
    required: false,
    default: "",
    ...overrides,
  };
}

function def(overrides) {
  return { id: "r", name: "テスト", method: "POST", url: "https://api.example.com/items", fields: [], ...overrides };
}

test("項目を指定した場所へ振り分ける", () => {
  const result = buildRequest(
    def({
      url: "https://api.example.com/users/{id}/tickets",
      fields: [
        field({ name: "id", target: "path" }),
        field({ name: "date", target: "query" }),
        field({ name: "X-Token", target: "header" }),
        field({ name: "adult", target: "body", type: "number" }),
        field({ name: "note", target: "body" }),
      ],
    }),
    { id: "a b", date: "10/30", "X-Token": "secret", adult: "2", note: "窓側" },
  );
  assert.deepEqual(result, {
    ok: true,
    request: {
      method: "POST",
      url: "https://api.example.com/users/a%20b/tickets?date=10%2F30",
      headers: { "X-Token": "secret", "Content-Type": "application/json" },
      body: JSON.stringify({ adult: 2, note: "窓側" }),
    },
  });
});

test("ボディ項目がなければボディも Content-Type も付けない", () => {
  const result = buildRequest(def({ method: "GET", fields: [field({ name: "q", target: "query" })] }), { q: "x" });
  assert.equal(result.request.body, null);
  assert.deepEqual(result.request.headers, {});
});

test("空欄の任意項目は送らない", () => {
  const result = buildRequest(
    def({ fields: [field({ name: "q", target: "query" }), field({ name: "note", target: "body" })] }),
    { q: "  ", note: "" },
  );
  assert.equal(result.request.url, "https://api.example.com/items");
  assert.equal(result.request.body, null);
});

test("URL に元からあるクエリは残す", () => {
  const result = buildRequest(
    def({ url: "https://api.example.com/items?v=1", fields: [field({ name: "q", target: "query" })] }),
    { q: "x" },
  );
  assert.equal(result.request.url, "https://api.example.com/items?v=1&q=x");
});

test("登録済みの Content-Type ヘッダーを上書きしない", () => {
  const result = buildRequest(
    def({ fields: [field({ name: "content-type", target: "header" }), field({ name: "a", target: "body" })] }),
    { "content-type": "application/vnd.api+json", a: "1" },
  );
  assert.deepEqual(result.request.headers, { "content-type": "application/vnd.api+json" });
});

test("必須項目が空なら、その項目を示して発信しない", () => {
  const result = buildRequest(
    def({ fields: [field({ name: "adult", label: "大人", target: "body", required: true })] }),
    {},
  );
  assert.deepEqual(result, { ok: false, message: "大人を入力してください", fieldId: "adult" });
});

test("URL で使うパス項目は必須として扱う", () => {
  const result = buildRequest(
    def({ url: "https://api.example.com/users/{id}", fields: [field({ name: "id", target: "path" })] }),
    { id: "" },
  );
  assert.equal(result.ok, false);
  assert.equal(result.fieldId, "id");
});

test("数値項目に数値以外が入っていれば発信しない", () => {
  const result = buildRequest(def({ fields: [field({ name: "adult", target: "body", type: "number" })] }), {
    adult: "二",
  });
  assert.equal(result.ok, false);
  assert.equal(result.fieldId, "adult");
});

test("URL が不正、または http(s) 以外なら発信しない", () => {
  assert.equal(buildRequest(def({ url: "example" }), {}).ok, false);
  assert.equal(buildRequest(def({ url: "file:///etc/passwd" }), {}).ok, false);
});

test("初期値は項目の default", () => {
  const values = initialValues(def({ fields: [field({ name: "key", target: "header", default: "abc" })] }));
  assert.deepEqual(values, { key: "abc" });
});

test("選択肢の文字列表現を往復できる", () => {
  const options = parseOptions("大人1=1, 大人2 = 2,,本日");
  assert.deepEqual(options, [
    { label: "大人1", value: "1" },
    { label: "大人2", value: "2" },
    { label: "本日", value: "本日" },
  ]);
  assert.deepEqual(parseOptions(formatOptions(options)), options);
});
