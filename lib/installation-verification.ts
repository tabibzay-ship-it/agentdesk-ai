import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { parse, type DefaultTreeAdapterMap } from "parse5";

export class InstallationVerificationError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "InstallationVerificationError";
  }
}

export function normalizeInstallationUrl(value: string): URL {
  let url: URL;

  try {
    if (value.length > 2048 || /[\u0000-\u001f\u007f\\]/.test(value)) throw new Error("Invalid URL");
    url = new URL(value.trim());
  } catch {
    throw new InstallationVerificationError(
      "Enter a full website URL beginning with http:// or https://.",
      "INVALID_URL"
    );
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username || url.password || !url.hostname
  ) {
    throw new InstallationVerificationError(
      "Use an HTTP or HTTPS website URL without a username or password.",
      "INVALID_URL"
    );
  }

  url.hash = "";
  return url;
}

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

function isElement(node: HtmlNode): node is HtmlElement {
  return "tagName" in node;
}

export function hasInstallationScript(
  html: string,
  pageUrl: URL,
  widgetUrl: URL,
  publicAgentId: string
): boolean {
  const document = parse(html, { scriptingEnabled: true });
  const elements: HtmlElement[] = [];
  const pending: HtmlNode[] = [document];
  while (pending.length) {
    const node = pending.pop()!;
    if (isElement(node)) {
      // Content in these elements does not execute as an installed widget.
      if (node.tagName === "template" || node.tagName === "noscript") {
        continue;
      }
      elements.push(node);
    }
    if ("childNodes" in node) {
      for (let index = node.childNodes.length - 1; index >= 0; index--) {
        pending.push(node.childNodes[index]);
      }
    }
  }

  let baseUrl = pageUrl;
  const firstBase = elements.find(
    (element) => element.tagName === "base" &&
      element.attrs.some((attribute) => attribute.name === "href")
  );
  if (firstBase) {
    try {
      baseUrl = new URL(
        firstBase.attrs.find((attribute) => attribute.name === "href")!.value,
        pageUrl
      );
    } catch {
      // Browsers fall back to the document URL for an invalid base URL.
    }
  }

  const javascriptTypes = new Set([
    "", "module", "text/javascript", "application/javascript",
    "text/ecmascript", "application/ecmascript", "application/x-javascript",
    "text/jscript", "text/livescript", "text/x-javascript", "text/x-ecmascript",
    "text/javascript1.0", "text/javascript1.1", "text/javascript1.2",
    "text/javascript1.3", "text/javascript1.4", "text/javascript1.5",
  ]);

  return elements.some((element) => {
    if (element.tagName !== "script" ||
      element.namespaceURI !== "http://www.w3.org/1999/xhtml") return false;

    const attributes = new Map(element.attrs.map(({ name, value }) => [name, value]));
    if (attributes.get("data-agent-id") !== publicAgentId ||
      !attributes.has("src") || attributes.has("nomodule")) return false;

    const type = (attributes.get("type") ?? "").trim().toLowerCase();
    if (!javascriptTypes.has(type)) return false;

    try {
      return new URL(attributes.get("src")!, baseUrl).href === widgetUrl.href;
    } catch {
      return false;
    }
  });
}

function hostnameWithoutBrackets(hostname: string) {
  return hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
}

function ipv6Words(address: string): number[] {
  let value = address.toLowerCase();
  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    const bytes = value.slice(lastColon + 1).split(".").map(Number);
    value = value.slice(0, lastColon + 1) +
      ((bytes[0] << 8) | bytes[1]).toString(16) + ":" +
      ((bytes[2] << 8) | bytes[3]).toString(16);
  }
  const halves = value.split("::");
  const left = halves[0] ? halves[0].split(":").map((part) => parseInt(part, 16)) : [];
  const right = halves[1] ? halves[1].split(":").map((part) => parseInt(part, 16)) : [];
  return halves.length === 2
    ? [...left, ...Array(8 - left.length - right.length).fill(0), ...right]
    : left;
}

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) ||
        (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }

  if (isIP(address) !== 6 || address.includes("%")) return false;
  const words = ipv6Words(address);
  // Only ordinary global unicast is accepted; mapped/translation/tunnel and
  // special-use ranges cannot be used to reach a private IPv4 destination.
  return (words[0] & 0xe000) === 0x2000 &&
    !(words[0] === 0x2001 && (words[1] < 0x0200 || words[1] === 0x0db8)) &&
    words[0] !== 0x2002 &&
    !(words[0] === 0x3fff && (words[1] & 0xf000) === 0);
}

function aborted(signal: AbortSignal): never {
  throw signal.reason instanceof Error ? signal.reason :
    new InstallationVerificationError("Website verification timed out.", "TIMEOUT");
}

async function resolveAddress(url: URL, allowLocalhost: boolean, signal: AbortSignal) {
  const hostname = hostnameWithoutBrackets(url.hostname).toLowerCase();
  if (signal.aborted) aborted(signal);
  const literalLocalhost = hostname === "localhost" ||
    hostname === "127.0.0.1" || hostname === "::1";
  if (literalLocalhost && allowLocalhost) {
    return { address: hostname === "::1" ? "::1" : "127.0.0.1", family: hostname === "::1" ? 6 : 4 };
  }

  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) {
      throw new InstallationVerificationError(
        "Private or local network addresses cannot be verified.", "PRIVATE_ADDRESS"
      );
    }
    return { address: hostname, family: isIP(hostname) };
  }

  let onAbort: (() => void) | undefined;
  const interruption = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const addresses = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }), interruption,
    ]);
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
      throw new InstallationVerificationError(
        "The website resolves to a private or unsupported network address.", "PRIVATE_ADDRESS"
      );
    }
    if (signal.aborted) aborted(signal);
    return addresses[0];
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

type PageResponse = { html?: string; redirect?: string };

async function requestPage(
  url: URL,
  address: { address: string; family: number },
  signal: AbortSignal,
  maxBytes: number
): Promise<PageResponse> {
  if (signal.aborted) aborted(signal);
  return new Promise((resolve, reject) => {
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(url, {
      method: "GET",
      agent: false,
      family: address.family,
      // Pin the checked DNS result while retaining the hostname for Host/TLS.
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      signal,
      headers: {
        Accept: "text/html, application/xhtml+xml",
        "Accept-Encoding": "identity",
        "User-Agent": "AgentDeskAI-InstallationVerifier/1.0",
      },
    }, (res) => {
      const status = res.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.destroy();
        resolve({ redirect: res.headers.location });
        return;
      }
      if (status < 200 || status >= 300) {
        res.destroy();
        reject(new InstallationVerificationError(
          `The website returned HTTP ${status}.`, "FETCH_FAILED"
        ));
        return;
      }
      const contentType = res.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase();
      if (contentType !== "text/html" && contentType !== "application/xhtml+xml") {
        res.destroy();
        reject(new InstallationVerificationError(
          "The website URL must return an HTML page.", "NOT_HTML"
        ));
        return;
      }
      if (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity") {
        res.destroy();
        reject(new InstallationVerificationError(
          "The website returned an unsupported compressed response.", "FETCH_FAILED"
        ));
        return;
      }
      let bytes = 0;
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          reject(new InstallationVerificationError(
            "The website HTML is too large to verify.", "PAGE_TOO_LARGE"
          ));
          req.destroy();
          res.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ html: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
      res.on("aborted", () => reject(new InstallationVerificationError(
        "The website stopped responding before verification completed.", "FETCH_FAILED"
      )));
    });
    req.on("error", reject);
    req.end();
  });
}

export type InstallationFetchOptions = {
  allowLocalhost: boolean;
  isAllowed: (url: URL) => boolean;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
};

export async function fetchInstallationPage(
  initialUrl: URL,
  options: InstallationFetchOptions
): Promise<{ html: string; url: URL }> {
  let url = normalizeInstallationUrl(initialUrl.href);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(
    new InstallationVerificationError("Website verification timed out.", "TIMEOUT")
  ), options.timeoutMs ?? 10_000);
  const maxRedirects = options.maxRedirects ?? 5;

  try {
    for (let redirects = 0; redirects <= maxRedirects; redirects++) {
      if (controller.signal.aborted) aborted(controller.signal);
      if (!options.isAllowed(url)) {
        throw new InstallationVerificationError(
          "This website is not in your Agent Domain Allowlist.", "ORIGIN_NOT_ALLOWED"
        );
      }
      const address = await resolveAddress(url, options.allowLocalhost, controller.signal);
      const response = await requestPage(url, address, controller.signal, options.maxBytes ?? 2 * 1024 * 1024);
      if (!response.redirect) return { html: response.html!, url };
      url = normalizeInstallationUrl(new URL(response.redirect, url).href);
    }
    throw new InstallationVerificationError(
      "The website redirected too many times.", "TOO_MANY_REDIRECTS"
    );
  } catch (error) {
    if (controller.signal.aborted) aborted(controller.signal);
    if (error instanceof InstallationVerificationError) throw error;
    throw new InstallationVerificationError(
      "Could not read the website. Check the URL and try again.", "FETCH_FAILED"
    );
  } finally {
    clearTimeout(timeout);
  }
}
