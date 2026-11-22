const MAX_TOKENS = 250_000;

function readString(source, start) {
  const quote = source[start];
  let value = "";
  let cursor = start + 1;
  while (cursor < source.length) {
    const character = source[cursor++];
    if (character === quote) return { value, next: cursor };
    if (character === "\r" || character === "\n") throw new Error("Unterminated JavaScript string");
    if (character !== "\\") {
      value += character;
      continue;
    }
    if (cursor >= source.length) throw new Error("Unterminated JavaScript escape");
    const escaped = source[cursor++];
    if (escaped === "\n") continue;
    if (escaped === "\r") {
      if (source[cursor] === "\n") cursor++;
      continue;
    }
    const simple = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0" };
    if (Object.hasOwn(simple, escaped)) {
      value += simple[escaped];
    } else if (escaped === "x") {
      const hex = source.slice(cursor, cursor + 2);
      if (!/^[0-9a-f]{2}$/i.test(hex)) throw new Error("Invalid JavaScript hex escape");
      value += String.fromCharCode(Number.parseInt(hex, 16));
      cursor += 2;
    } else if (escaped === "u") {
      if (source[cursor] === "{") {
        const close = source.indexOf("}", cursor + 1);
        if (close < 0) throw new Error("Invalid JavaScript Unicode escape");
        const point = Number.parseInt(source.slice(cursor + 1, close), 16);
        if (!Number.isInteger(point) || point > 0x10ffff) throw new Error("Invalid JavaScript Unicode escape");
        value += String.fromCodePoint(point);
        cursor = close + 1;
      } else {
        const hex = source.slice(cursor, cursor + 4);
        if (!/^[0-9a-f]{4}$/i.test(hex)) throw new Error("Invalid JavaScript Unicode escape");
        value += String.fromCharCode(Number.parseInt(hex, 16));
        cursor += 4;
      }
    } else {
      value += escaped;
    }
  }
  throw new Error("Unterminated JavaScript string");
}

function canStartRegex(previous) {
  if (!previous) return true;
  if (previous.type === "identifier") {
    return ["return", "throw", "case", "delete", "void", "typeof", "instanceof", "in", "of", "yield", "await"].includes(previous.value);
  }
  return ["(", "[", "{", ",", ";", ":", "=", "!", "?", "&", "|", "+", "-", "*", "%", "~", "^", "<", ">", "=>"].includes(previous.value);
}

function tokenize(source) {
  const tokens = [];
  let cursor = 0;
  while (cursor < source.length) {
    if (tokens.length > MAX_TOKENS) throw new Error("JavaScript module token limit exceeded");
    const character = source[cursor];
    if (/\s/.test(character)) {
      cursor++;
      continue;
    }
    if (character === "/" && source[cursor + 1] === "/") {
      cursor += 2;
      while (cursor < source.length && source[cursor] !== "\n" && source[cursor] !== "\r") cursor++;
      continue;
    }
    if (character === "/" && source[cursor + 1] === "*") {
      const close = source.indexOf("*/", cursor + 2);
      if (close < 0) throw new Error("Unterminated JavaScript comment");
      cursor = close + 2;
      continue;
    }
    if (character === "/" && canStartRegex(tokens.at(-1))) {
      const start = cursor++;
      let inClass = false;
      let closed = false;
      while (cursor < source.length) {
        if (source[cursor] === "\\") {
          cursor += 2;
        } else if (source[cursor] === "[" && !inClass) {
          inClass = true;
          cursor++;
        } else if (source[cursor] === "]" && inClass) {
          inClass = false;
          cursor++;
        } else if (source[cursor] === "/" && !inClass) {
          cursor++;
          while (cursor < source.length && /[a-z]/i.test(source[cursor])) cursor++;
          closed = true;
          break;
        } else if (source[cursor] === "\n" || source[cursor] === "\r") {
          break;
        } else {
          cursor++;
        }
      }
      if (!closed) throw new Error("Unterminated JavaScript regular expression");
      tokens.push({ type: "regex", value: source.slice(start, cursor) });
      continue;
    }
    if (character === "'" || character === '"') {
      const string = readString(source, cursor);
      tokens.push({ type: "string", value: string.value });
      cursor = string.next;
      continue;
    }
    if (character.charCodeAt(0) === 96) {
      const start = cursor++;
      let interpolation = false;
      while (cursor < source.length) {
        if (source[cursor] === "\\") {
          cursor += 2;
        } else if (source.charCodeAt(cursor) === 96) {
          cursor++;
          break;
        } else {
          if (source[cursor] === "$" && source[cursor + 1] === "{") interpolation = true;
          cursor++;
        }
      }
      if (source.charCodeAt(cursor - 1) !== 96) throw new Error("Unterminated JavaScript template literal");
      const raw = source.slice(start, cursor);
      if (interpolation && /\bimport\s*\(/.test(raw)) {
        throw new Error("Cannot audit dynamic import inside a template literal");
      }
      tokens.push({ type: "template", value: raw });
      continue;
    }
    if (/[a-z_$]/i.test(character)) {
      const start = cursor++;
      while (cursor < source.length && /[a-z0-9_$]/i.test(source[cursor])) cursor++;
      tokens.push({ type: "identifier", value: source.slice(start, cursor) });
      continue;
    }
    tokens.push({ type: "punct", value: character });
    cursor++;
  }
  return tokens;
}

export function extractJavaScriptDependencies(source) {
  const tokens = tokenize(source);
  const modules = [];
  const resources = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== "identifier") continue;

    if (token.value === "new" && tokens[index + 1]?.value === "URL" &&
        tokens[index + 2]?.value === "(" && tokens[index + 3]?.type === "string" &&
        tokens[index + 4]?.value === "," && tokens[index + 5]?.value === "import" &&
        tokens[index + 6]?.value === "." && tokens[index + 7]?.value === "meta" &&
        tokens[index + 8]?.value === "." && tokens[index + 9]?.value === "url") {
      const resource = tokens[index + 3].value;
      resources.push(resource);
      if (/\.m?js(?:[?#]|$)/i.test(resource)) modules.push(resource);
      index += 9;
      continue;
    }

    if (token.value === "importScripts" && tokens[index + 1]?.value === "(") {
      let cursor = index + 2;
      while (cursor < tokens.length && tokens[cursor].value !== ")") {
        if (tokens[cursor].type !== "string") {
          throw new Error("Cannot audit non-literal importScripts dependency");
        }
        modules.push(tokens[cursor].value);
        cursor++;
        if (tokens[cursor]?.value === ",") cursor++;
        else if (tokens[cursor]?.value !== ")") throw new Error("Cannot audit importScripts arguments");
      }
      if (tokens[cursor]?.value !== ")") throw new Error("Unterminated importScripts call");
      index = cursor;
      continue;
    }

    if (token.value === "new" && ["Worker", "SharedWorker"].includes(tokens[index + 1]?.value) &&
        tokens[index + 2]?.value === "(" && tokens[index + 3]?.type === "string") {
      modules.push(tokens[index + 3].value);
      index += 3;
      continue;
    }

    if (token.value === "serviceWorker" && tokens[index + 1]?.value === "." &&
        tokens[index + 2]?.value === "register" && tokens[index + 3]?.value === "(" &&
        tokens[index + 4]?.type === "string") {
      modules.push(tokens[index + 4].value);
      index += 4;
      continue;
    }

    if (token.value === "import") {
      const next = tokens[index + 1];
      if (next?.value === ".") continue; // import.meta
      if (next?.value === "(") {
        const specifier = tokens[index + 2];
        if (specifier?.type !== "string") throw new Error("Cannot audit non-literal JavaScript dynamic import");
        if (tokens[index + 3]?.value !== ")") throw new Error("Cannot audit JavaScript dynamic import options");
        modules.push(specifier.value);
        index += 3;
        continue;
      }
      if (next?.type === "string") {
        modules.push(next.value);
        index++;
        continue;
      }
      for (let cursor = index + 1; cursor < tokens.length && cursor - index < 100; cursor++) {
        if (tokens[cursor].value === ";") break;
        if (tokens[cursor].value === "from" && tokens[cursor + 1]?.type === "string") {
          modules.push(tokens[cursor + 1].value);
          index = cursor + 1;
          break;
        }
        if (tokens[cursor].value === "import" || tokens[cursor].value === "export") break;
      }
      continue;
    }

    if (token.value === "export" && (tokens[index + 1]?.value === "*" || tokens[index + 1]?.value === "{")) {
      for (let cursor = index + 2; cursor < tokens.length && cursor - index < 100; cursor++) {
        if (tokens[cursor].value === ";") break;
        if (tokens[cursor].value === "from" && tokens[cursor + 1]?.type === "string") {
          modules.push(tokens[cursor + 1].value);
          index = cursor + 1;
          break;
        }
        if (tokens[cursor].value === "import" || tokens[cursor].value === "export") break;
      }
    }
  }
  return { modules: [...new Set(modules)], resources: [...new Set(resources)] };
}

export function extractInlineJavaScript(html) {
  const scripts = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (getAttribute(match[1], "src") !== undefined) continue;
    const type = (getAttribute(match[1], "type") ?? "").trim().toLowerCase();
    if (type === "" || type === "module" || /^(?:text|application)\/(?:javascript|ecmascript)(?:\s*;|$)/.test(type)) {
      scripts.push(match[2]);
    }
  }
  return scripts;
}

function getAttribute(attributes, name) {
  const pattern = new RegExp("(?:^|\\s)" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i");
  const match = attributes.match(pattern);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}
