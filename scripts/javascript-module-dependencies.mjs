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
      index = cursor;      continue;    }

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


function skipJavaScriptQuoted(source, position, quote) {
  let cursor = position + 1;
  while (cursor < source.length) {
    if (source[cursor] === "\\") cursor += 2;
    else if (source[cursor] === quote) return cursor + 1;
    else cursor++;
  }
  throw new Error("Unterminated JavaScript string in template expression");
}

function canStartTemplateRegex(source, position) {
  let cursor = position - 1;
  while (cursor >= 0 && /\s/.test(source[cursor])) cursor--;
  const previous = source[cursor] ?? "";
  if ("([{,:;=!?&|+-*%^~<>".includes(previous)) return true;
  const word = source.slice(0, cursor + 1).match(/[a-z_$][a-z0-9_$]*$/i)?.[0];
  return ["return", "throw", "case", "delete", "void", "typeof", "instanceof", "in", "of", "yield", "await"].includes(word);
}

function skipJavaScriptRegex(source, position) {
  let cursor = position + 1;
  let inClass = false;
  while (cursor < source.length) {
    if (source[cursor] === "\\") cursor += 2;
    else if (source[cursor] === "[" && !inClass) { inClass = true; cursor++; }
    else if (source[cursor] === "]" && inClass) { inClass = false; cursor++; }
    else if (source[cursor] === "/" && !inClass) {
      cursor++;
      while (/[a-z]/i.test(source[cursor] ?? "")) cursor++;
      return cursor;
    } else if (/[\r\n]/.test(source[cursor])) break;
    else cursor++;
  }
  throw new Error("Unterminated JavaScript regular expression in template expression");
}

function findTemplateExpressionEnd(source, position) {
  let depth = 1;
  let cursor = position;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === "'" || character === '"') {
      cursor = skipJavaScriptQuoted(source, cursor, character);
      continue;
    }
    if (character.charCodeAt(0) === 96) {
      throw new Error("Cannot audit nested template inside JavaScript template expression");
    }
    if (character === "/" && source[cursor + 1] === "/") {
      cursor += 2;
      while (cursor < source.length && !/[\r\n]/.test(source[cursor])) cursor++;
      continue;
    }
    if (character === "/" && source[cursor + 1] === "*") {
      const close = source.indexOf("*/", cursor + 2);
      if (close < 0) throw new Error("Unterminated JavaScript comment in template expression");
      cursor = close + 2;
      continue;
    }
    if (character === "/" && canStartTemplateRegex(source, cursor)) {
      cursor = skipJavaScriptRegex(source, cursor);
      continue;
    }
    if (character === "{") depth++;
    else if (character === "}") {
      depth--;
      if (depth === 0) return cursor;
    }
    cursor++;
  }
  throw new Error("Unterminated JavaScript template expression");
}

function extractTemplateExpressions(raw) {
  const tick = String.fromCharCode(96);
  if (!raw.startsWith(tick) || !raw.endsWith(tick)) {
    throw new Error("Cannot audit malformed JavaScript template");
  }
  const expressions = [];
  const end = raw.length - 1;
  let cursor = 1;
  while (cursor < end) {
    if (raw[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (raw[cursor] === "$" && raw[cursor + 1] === "{") {
      const expressionStart = cursor + 2;
      const expressionEnd = findTemplateExpressionEnd(raw, expressionStart);
      expressions.push(raw.slice(expressionStart, expressionEnd));
      cursor = expressionEnd + 1;
      continue;
    }
    cursor++;
  }
  return expressions;
}

export function extractJavaScriptNetworkUrls(source, templateDepth = 0) {
  if (templateDepth > 10) throw new Error("JavaScript template expression depth exceeds 10");
  const tokens = tokenize(source);
  const urls = [];

  function literalUrl(token) {
    if (token?.type === "string") return token.value;
    if (token?.type !== "template") return undefined;

    const raw = token.value;
    if (!raw.startsWith("`") || !raw.endsWith("`")) {
      throw new Error("Cannot audit malformed JavaScript template URL");
    }
    const content = raw.slice(1, -1);
    const interpolation = content.indexOf("${");
    const prefix = interpolation < 0 ? content : content.slice(0, interpolation);
    if (prefix.includes(String.fromCharCode(92))) {
      throw new Error("Cannot audit escaped JavaScript template URL");
    }
    if (interpolation < 0) return prefix;
    if (!prefix.trim()) return undefined;
    if (prefix === "https://" || prefix === "http://") {
      throw new Error("Cannot audit incomplete interpolated JavaScript URL");
    }
    return prefix;
  }

  function staticUrlArgument(openIndex) {
    const direct = literalUrl(tokens[openIndex + 1]);
    if (direct !== undefined) return direct;
    if (tokens[openIndex + 1]?.value === "new" &&
        tokens[openIndex + 2]?.value === "URL" &&
        tokens[openIndex + 3]?.value === "(") {
      return literalUrl(tokens[openIndex + 4]);
    }
    return undefined;
  }

  function callOpenAfter(index) {
    if (tokens[index + 1]?.value === "(") return index + 1;
    if (tokens[index + 1]?.value === "?" &&
        tokens[index + 2]?.value === "." &&
        tokens[index + 3]?.value === "(") return index + 3;
    return -1;
  }

  function isMemberName(index, name) {
    const token = tokens[index];
    if (token?.value !== name) return false;
    if (token.type === "identifier" && tokens[index - 1]?.value === ".") return true;
    return token.type === "string" &&
      tokens[index - 1]?.value === "[" &&
      tokens[index + 1]?.value === "]";
  }

  function memberCallOpen(index) {
    return tokens[index]?.type === "string"
      ? callOpenAfter(index + 1)
      : callOpenAfter(index);
  }

  function auditCall(openIndex) {
    if (openIndex < 0) return;
    const value = staticUrlArgument(openIndex);
    if (value !== undefined) urls.push(value);
  }

  // Track simple, statically initialized aliases of network APIs. This catches
  // common refactors such as const request = fetch; request(url), while keeping
  // unrelated object methods out of the network audit.
  const functionAliases = new Map();
  const directApis = new Set(["fetch", "sendBeacon", "WebSocket", "EventSource"]);

  function memberApiAt(start) {
    const base = tokens[start];
    if (base?.type !== "identifier") return undefined;
    let member, next;
    if (tokens[start + 1]?.value === "." && tokens[start + 2]?.type === "identifier") {
      member = tokens[start + 2].value;
      next = start + 3;
    } else if (tokens[start + 1]?.value === "[" &&
        tokens[start + 2]?.type === "string" && tokens[start + 3]?.value === "]") {
      member = tokens[start + 2].value;
      next = start + 4;
    } else {
      return undefined;
    }

    if (["window", "globalThis", "self"].includes(base.value) && member === "fetch") {
      return { api: "fetch", next };
    }
    if (base.value === "navigator" && member === "sendBeacon") {
      return { api: "sendBeacon", next };
    }
    // XMLHttpRequest.open is an instance method; its stable HTTP-method/url
    // signature is checked again at the call site before a URL is recorded.
    if (member === "open") return { api: "open", next };
    return undefined;
  }

  function apiFromRhs(start) {
    const token = tokens[start];
    if (token?.type !== "identifier") return undefined;
    if (directApis.has(token.value)) return { api: token.value, next: start + 1 };
    const alias = functionAliases.get(token.value);
    if (alias) return { api: alias, next: start + 1 };
    return memberApiAt(start);
  }

  // A small fixed-point pass resolves aliases declared in either order and
  // bounded alias chains. Dynamic assignments and destructuring are purposely
  // not guessed; the verifier remains a static, fail-closed dependency audit.
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (let index = 0; index < tokens.length - 3; index++) {
      if (!["const", "let", "var"].includes(tokens[index]?.value)) continue;

      // Support renamed destructuring from known browser globals, e.g.
      // const { fetch: request } = window. Only literal property names and
      // explicit global sources are accepted.
      if (tokens[index + 1]?.value === "{") {
        let close = index + 2;
        while (close < tokens.length && close - index <= 32 && tokens[close]?.value !== "}") close++;
        if (tokens[close]?.value !== "}" || tokens[close + 1]?.value !== "=" ||
            tokens[close + 2]?.type !== "identifier") continue;
        const source = tokens[close + 2].value;
        const allowedSource = ["window", "globalThis", "self"].includes(source) || source === "navigator";
        if (!allowedSource) continue;
        let property = index + 2;
        while (property < close) {
          if (tokens[property]?.type !== "identifier") { property++; continue; }
          const propertyName = tokens[property].value;
          let aliasName = propertyName;
          let next = property + 1;
          if (tokens[next]?.value === ":") {
            if (tokens[next + 1]?.type !== "identifier") { property += 2; continue; }
            aliasName = tokens[next + 1].value;
            next += 2;
          }
          let api;
          if (["window", "globalThis", "self"].includes(source) &&
              ["fetch", "WebSocket", "EventSource"].includes(propertyName)) api = propertyName;
          if (source === "navigator" && propertyName === "sendBeacon") api = propertyName;
          if (api && functionAliases.get(aliasName) !== api) {
            functionAliases.set(aliasName, api);
            changed = true;
          }
          property = next;
          if (tokens[property]?.value === ",") property++;
        }
        continue;
      }

      if (tokens[index + 1]?.type !== "identifier" ||
          tokens[index + 2]?.value !== "=") continue;
      const name = tokens[index + 1].value;
      const resolved = apiFromRhs(index + 3);
      if (resolved && functionAliases.get(name) !== resolved.api) {
        functionAliases.set(name, resolved.api);
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];

    // fetch can be referenced directly, through window/globalThis, or with a
    // literal computed property. Optional calls preserve the same static first
    // argument and must not bypass the origin check.
    if (token.type === "identifier" && token.value === "fetch") {
      auditCall(callOpenAfter(index));
    } else if (token.type === "string" && token.value === "fetch" &&
        tokens[index - 1]?.value === "[" && tokens[index + 1]?.value === "]") {
      auditCall(callOpenAfter(index + 1));
    }

    if (token.type === "identifier" && token.value === "new" &&
        ["WebSocket", "EventSource"].includes(tokens[index + 1]?.value)) {
      auditCall(callOpenAfter(index + 1));
    }
    if (token.type === "identifier" && token.value === "new" &&
        tokens[index + 1]?.type === "identifier" &&
        tokens[index + 2]?.value === "[" &&
        tokens[index + 3]?.type === "string" &&
        ["WebSocket", "EventSource"].includes(tokens[index + 3].value) &&
        tokens[index + 4]?.value === "]") {
      auditCall(callOpenAfter(index + 4));
    }

    if (isMemberName(index, "sendBeacon")) auditCall(memberCallOpen(index));
    if (isMemberName(index, "open")) {
      const openIndex = memberCallOpen(index);
      if (openIndex >= 0 &&
          tokens[openIndex + 1]?.type === "string" &&
          /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i.test(tokens[openIndex + 1].value) &&
          tokens[openIndex + 2]?.value === ",") {
        const value = staticUrlArgument(openIndex + 2);
        if (value !== undefined) urls.push(value);
      }
    }

    const aliasApi = token.type === "identifier" ? functionAliases.get(token.value) : undefined;
    if (aliasApi) {
      const openIndex = callOpenAfter(index);
      if (aliasApi === "fetch" || aliasApi === "sendBeacon") {
        auditCall(openIndex);
      } else if (aliasApi === "open" && openIndex >= 0 &&
          tokens[openIndex + 1]?.type === "string" &&
          /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i.test(tokens[openIndex + 1].value) &&
          tokens[openIndex + 2]?.value === ",") {
        const value = staticUrlArgument(openIndex + 2);
        if (value !== undefined) urls.push(value);
      } else if (["WebSocket", "EventSource"].includes(aliasApi) &&
          tokens[index - 1]?.value === "new") {
        auditCall(openIndex);
      }
    }
  }

  // Template expressions execute JavaScript. Scan their code recursively rather
  // than treating the entire template token as inert text.
  for (const token of tokens) {
    if (token.type !== "template" || !token.value.includes("${")) continue;
    for (const expression of extractTemplateExpressions(token.value)) {
      urls.push(...extractJavaScriptNetworkUrls(expression, templateDepth + 1));
    }
  }

  return [...new Set(urls)];
}

const HTML_CHARACTER_REFERENCES = new Map([
  ["amp", "&"], ["quot", '"'], ["apos", "'"], ["lt", "<"], ["gt", ">"],
  ["colon", ":"], ["sol", "/"], ["quest", "?"], ["num", "#"], ["percnt", "%"],
  ["period", "."], ["equals", "="], ["lpar", "("], ["rpar", ")"],
  ["Tab", "\t"], ["NewLine", "\n"],
]);

export function decodeHtmlCharacterReferences(value) {
  return value.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+);?/gi, (entity, reference) => {
    if (reference[0] !== "#") {
      // Decode only explicitly supported named references. Numeric references
      // cover arbitrary encoded ASCII syntax; unknown names stay untouched.
      return HTML_CHARACTER_REFERENCES.get(reference) ??
        HTML_CHARACTER_REFERENCES.get(reference.toLowerCase()) ??
        entity;
    }
    const hexadecimal = reference[1]?.toLowerCase() === "x";
    const digits = reference.slice(hexadecimal ? 2 : 1);
    const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
    if (!Number.isInteger(codePoint) || codePoint === 0 || codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)) return "\uFFFD";
    return String.fromCodePoint(codePoint);
  });
}

export function extractInlineEventHandlers(html) {
  const handlers = [];
  let cursor = 0;

  function skipTagEnd(position) {
    let quote;
    while (position < html.length) {
      const character = html[position++];
      if (quote) {
        if (character === quote) quote = undefined;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        return position;
      }
    }
    throw new Error("Unterminated HTML tag while scanning event handlers");
  }

  while (cursor < html.length) {
    const opening = html.indexOf("<", cursor);
    if (opening < 0) break;
    cursor = opening;

    if (html.startsWith("<!--", cursor)) {
      const close = html.indexOf("-->", cursor + 4);
      if (close < 0) throw new Error("Unterminated HTML comment while scanning event handlers");
      cursor = close + 3;
      continue;
    }

    const next = html[cursor + 1];
    if (next === "!" || next === "?" || next === "/") {
      cursor = skipTagEnd(cursor + 2);
      continue;
    }
    if (!/[a-z]/i.test(next ?? "")) {
      cursor++;      continue;
    }
    cursor += 1;
    const nameStart = cursor;
    while (cursor < html.length && /[a-z0-9:-]/i.test(html[cursor])) cursor++;
    const tagName = html.slice(nameStart, cursor).toLowerCase();

    let tagClosed = false;
    while (cursor < html.length) {
      while (cursor < html.length && /\s/.test(html[cursor])) cursor++;
      if (html[cursor] === ">") {
        cursor++;
        tagClosed = true;
        break;
      }
      if (html[cursor] === "/" && html[cursor + 1] === ">") {
        cursor += 2;
        tagClosed = true;
        break;
      }

      const attributeStart = cursor;
      while (cursor < html.length && !/[\s=/>]/.test(html[cursor])) cursor++;
      if (cursor === attributeStart) {
        cursor++;
        continue;
      }
      const attributeName = html.slice(attributeStart, cursor).toLowerCase();
      while (cursor < html.length && /\s/.test(html[cursor])) cursor++;

      let value = "";
      if (html[cursor] === "=") {
        cursor++;
        while (cursor < html.length && /\s/.test(html[cursor])) cursor++;
        const quote = html[cursor] === '"' || html[cursor] === "'" ? html[cursor++] : undefined;
        const valueStart = cursor;
        if (quote) {
          while (cursor < html.length && html[cursor] !== quote) cursor++;
          if (cursor >= html.length) {
            throw new Error("Unterminated quoted HTML attribute while scanning event handlers");
          }
          value = html.slice(valueStart, cursor);
          cursor++;
        } else {
          while (cursor < html.length && !/[\s>]/.test(html[cursor])) cursor++;
          value = html.slice(valueStart, cursor);
        }
      }

      if (/^on[a-z][a-z0-9:_-]*$/i.test(attributeName)) {
        handlers.push(decodeHtmlCharacterReferences(value));
      }
    }

    if (!tagClosed) throw new Error("Unterminated HTML tag while scanning event handlers");

    // Script and style bodies are raw text in HTML. Do not interpret strings or
    // markup-looking source inside them as real element attributes.
    if (tagName === "script" || tagName === "style") {
      const closingPattern = new RegExp("</" + tagName + "\\s*>", "ig");
      closingPattern.lastIndex = cursor;
      const closing = closingPattern.exec(html);
      if (!closing) throw new Error("Unterminated HTML " + tagName + " element while scanning event handlers");
      cursor = closingPattern.lastIndex;
    }
  }

  return handlers;
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