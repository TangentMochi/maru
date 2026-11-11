/**
 * @typedef {{ label: string, value: string }} Option
 * @typedef {{
 *   id: string, label: string, name: string,
 *   target: "path" | "query" | "header" | "body",
 *   type: "text" | "number",
 *   options: Option[], required: boolean, default: string,
 * }} FieldDef
 * @typedef {{ id: string, name: string, method: string, url: string, fields: FieldDef[] }} RequestDef
 * @typedef {{ method: string, url: string, headers: Record<string, string>, body: string | null }} HttpRequest
 * @typedef {{ ok: true, request: HttpRequest } | { ok: false, message: string, fieldId: string | null }} BuildResult
 */

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export const TARGETS = [
  { value: "path", label: "パス" },
  { value: "query", label: "クエリ" },
  { value: "header", label: "ヘッダー" },
  { value: "body", label: "ボディ" },
];

export const TYPES = [
  { value: "text", label: "文字" },
  { value: "number", label: "数値" },
];

/** The value a field starts with before the operator types anything. */
export function initialValues(def) {
  return Object.fromEntries(def.fields.map((field) => [field.id, field.default]));
}

/**
 * @param {RequestDef} def
 * @param {Record<string, string>} values field id → entered text
 * @returns {BuildResult}
 */
export function buildRequest(def, values) {
  let url = def.url;
  const query = [];
  const headers = {};
  const body = {};

  for (const field of def.fields) {
    const value = (values[field.id] ?? "").trim();
    const placeholder = `{${field.name}}`;
    const needed = field.required || (field.target === "path" && url.includes(placeholder));
    if (value === "") {
      if (needed) return fail(`${field.label}を入力してください`, field.id);
      continue;
    }
    switch (field.target) {
      case "path":
        url = url.replaceAll(placeholder, encodeURIComponent(value));
        break;
      case "query":
        query.push([field.name, value]);
        break;
      case "header":
        headers[field.name] = value;
        break;
      case "body":
        if (field.type === "number") {
          const number = Number(value);
          if (Number.isNaN(number)) return fail(`${field.label}は数値で入力してください`, field.id);
          body[field.name] = number;
        } else {
          body[field.name] = value;
        }
        break;
    }
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return fail("宛先のURLが正しくありません", null);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return fail("宛先は http または https で指定してください", null);
  }
  for (const [name, value] of query) parsed.searchParams.append(name, value);

  const hasBody = Object.keys(body).length > 0;
  const hasContentType = Object.keys(headers).some((name) => name.toLowerCase() === "content-type");
  if (hasBody && !hasContentType) headers["Content-Type"] = "application/json";

  return {
    ok: true,
    request: {
      method: def.method,
      url: parsed.toString(),
      headers,
      body: hasBody ? JSON.stringify(body) : null,
    },
  };
}

function fail(message, fieldId) {
  return { ok: false, message, fieldId };
}

/** "大人1=1, 大人2=2" → options. An entry without "=" uses its text as both label and value. */
export function parseOptions(text) {
  return text
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      const at = entry.indexOf("=");
      if (at === -1) return { label: entry, value: entry };
      return { label: entry.slice(0, at).trim(), value: entry.slice(at + 1).trim() };
    });
}

export function formatOptions(options) {
  return options
    .map(({ label, value }) => (label === value ? label : `${label}=${value}`))
    .join(", ");
}
