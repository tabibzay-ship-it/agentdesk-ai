/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const http = require("node:http");
const dns = require("node:dns/promises");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { pathToFileURL } = require("node:url");

async function runTests() {

// Keep the project test runner dependency-free: compile only this TypeScript
// helper using the TypeScript version already required by the application.
const projectRoot = process.env.AGENTDESK_PROJECT_ROOT || path.resolve(__dirname, "..");
const projectRequire = Module.createRequire(path.join(projectRoot, "package.json"));
const ts = projectRequire("typescript");
// parse5 is ESM. Dynamic import also works on the project's minimum Node 20.9.
const parse5 = await import(pathToFileURL(projectRequire.resolve("parse5")).href);
const helperPath = path.resolve(__dirname, "../lib/installation-verification.ts");
const helperModule = new Module(path.join(projectRoot, "lib/installation-verification.ts"), module);
helperModule.filename = path.join(projectRoot, "lib/installation-verification.ts");
helperModule.paths = Module._nodeModulePaths(projectRoot);
const originalRequire = helperModule.require.bind(helperModule);
helperModule.require = (specifier) => specifier === "parse5" ? parse5 : originalRequire(specifier);
helperModule._compile(ts.transpileModule(fs.readFileSync(helperPath, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, helperModule.filename);
const {
  normalizeInstallationUrl, hasInstallationScript, isPublicAddress,
  fetchInstallationPage, InstallationVerificationError,
} = helperModule.exports;

const agentId = "11111111-1111-4111-8111-111111111111";
const widgetUrl = new URL("https://agent.example/widget.js");
const pageUrl = new URL("https://customer.example/support/");
const script = `<script src="${widgetUrl}" data-agent-id="${agentId}" async></script>`;
const allowed = { allowLocalhost: true, isAllowed: () => true };
const hasScript = (html, url = pageUrl) => hasInstallationScript(html, url, widgetUrl, agentId);

test("matches one real script with the exact widget URL and owned public ID", () => {
  assert.equal(hasScript(script), true);
  assert.equal(hasScript(`<SCRIPT DATA-AGENT-ID='${agentId}' SRC='https://agent.example/widget.js'></SCRIPT>`), true);
  assert.equal(hasScript(script.replace("https://agent.example", "https://other.example")), false);
  assert.equal(hasScript(script.replace(agentId, "22222222-2222-4222-8222-222222222222")), false);
  assert.equal(hasScript(`<script src="${widgetUrl}"></script><script data-agent-id="${agentId}"></script>`), false);
});

test("rejects examples and inert markup instead of matching HTML substrings", () => {
  for (const html of [
    `<!-- ${script} -->`, `<template>${script}</template>`, `<noscript>${script}</noscript>`,
    `<textarea>${script}</textarea>`, `<script>const example = '${script}'</script>`,
    script.replace("<script", '<script type="application/json"'),
    script.replace("<script", "<script nomodule"),
    script.replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  ]) assert.equal(hasScript(html), false, html);
});

test("resolves relative script URLs against the real document base", () => {
  const relative = `<script src="/widget.js" data-agent-id="${agentId}"></script>`;
  assert.equal(hasScript(relative), false);
  assert.equal(hasScript(relative, new URL("https://agent.example/path/")), true);
  assert.equal(hasScript(`<base href="https://agent.example/assets/">${relative}`), true);
  assert.equal(hasScript(`<base href="https://other.example/"><base href="https://agent.example/">${relative}`), false);
  assert.equal(hasScript(`<template><base href="https://other.example/"></template>${relative}`, widgetUrl), true);
});

test("handles deeply nested HTML without recursive traversal overflow", () => {
  assert.equal(hasScript("<div>".repeat(12_000) + script + "</div>".repeat(12_000)), true);
});

test("does not accept script queries, fragments, credentials or lookalike widget names", () => {
  for (const source of [
    "https://agent.example/widget.js?x=1", "https://agent.example/widget.js#example",
    "https://attacker@agent.example/widget.js", "https://agent.example/other-widget.js",
    "https://agent.example/widget.js.backup",
  ]) assert.equal(hasScript(`<script src="${source}" data-agent-id="${agentId}"></script>`), false);
});

test("normalizes full HTTP(S) URLs and rejects credentials or non-web protocols", () => {
  assert.equal(normalizeInstallationUrl(" https://Example.com/path?q=1#part ").href, "https://example.com/path?q=1");
  for (const value of ["example.com", "file:///etc/passwd", "ftp://example.com/", "http://name:password@example.com/"]) {
    assert.throws(() => normalizeInstallationUrl(value), { code: "INVALID_URL" });
  }
});

test("blocks private, mapped, link-local, metadata, reserved and tunnel addresses", () => {
  for (const address of [
    "0.0.0.0", "10.0.0.1", "127.0.0.1", "100.64.0.1", "169.254.169.254",
    "172.16.0.1", "172.31.255.255", "192.168.0.1", "192.0.0.1", "192.0.2.1",
    "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "fc00::1", "fe80::1",
    "2001:db8::1", "2001::1", "2002:7f00:1::", "3fff::1", "not-an-ip",
  ]) assert.equal(isPublicAddress(address), false, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2001:4860:4860::8888", "2606:4700:4700::1111"]) {
    assert.equal(isPublicAddress(address), true, address);
  }
});

async function withWebsite(run) {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/valid" }).end();
    } else if (req.url === "/private-redirect") {
      res.writeHead(302, { Location: "http://169.254.169.254/metadata" }).end();
    } else if (req.url === "/loop") {
      res.writeHead(302, { Location: "/loop" }).end();
    } else if (req.url === "/plain") {
      res.setHeader("Content-Type", "text/plain");
      res.end(script);
    } else if (req.url === "/large") {
      res.end("a".repeat(1024));
    } else if (req.url === "/failed") {
      res.writeHead(503).end("unavailable");
    } else if (req.url === "/slow") {
      res.flushHeaders();
    } else {
      assert.equal(req.headers.authorization, undefined);
      assert.equal(req.headers.cookie, undefined);
      res.end(script);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try { await run(origin); }
  finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("fetches HTML and follows bounded redirects without forwarding user credentials", async () => {
  await withWebsite(async (origin) => {
    const visited = [];
    const result = await fetchInstallationPage(new URL(`${origin}/redirect`), {
      ...allowed, isAllowed(url) { visited.push(url.pathname); return true; },
    });
    assert.equal(result.html, script);
    assert.equal(result.url.href, `${origin}/valid`);
    assert.deepEqual(visited, ["/redirect", "/valid"]);
  });
});

test("rechecks allowlist before accessing a redirect destination", async () => {
  await withWebsite(async (origin) => {
    await assert.rejects(fetchInstallationPage(new URL(`${origin}/redirect`), {
      ...allowed, isAllowed: (url) => url.pathname === "/redirect",
    }), { code: "ORIGIN_NOT_ALLOWED" });
  });
});

test("blocks redirects to private services and production loopback targets", async () => {
  await withWebsite(async (origin) => {
    await assert.rejects(fetchInstallationPage(new URL(`${origin}/private-redirect`), allowed), { code: "PRIVATE_ADDRESS" });
    await assert.rejects(fetchInstallationPage(new URL(`${origin}/valid`), {
      ...allowed, allowLocalhost: false,
    }), { code: "PRIVATE_ADDRESS" });
  });
});

test("rejects non-HTML, oversized pages, failed responses and redirect loops", async () => {
  await withWebsite(async (origin) => {
    await assert.rejects(fetchInstallationPage(new URL(`${origin}/plain`), allowed), { code: "NOT_HTML" });
    await assert.rejects(fetchInstallationPage(new URL(`${origin}/large`), { ...allowed, maxBytes: 512 }), { code: "PAGE_TOO_LARGE" });
    await assert.rejects(fetchInstallationPage(new URL(`${origin}/failed`), allowed), { code: "FETCH_FAILED" });
    await assert.rejects(fetchInstallationPage(new URL(`${origin}/loop`), { ...allowed, maxRedirects: 1 }), { code: "TOO_MANY_REDIRECTS" });
  });
});

test("applies the total timeout while reading an unending response", async () => {
  await withWebsite(async (origin) => {
    await assert.rejects(fetchInstallationPage(new URL(`${origin}/slow`), {
      ...allowed, timeoutMs: 40,
    }), { code: "TIMEOUT" });
  });
});

test("rejects mixed public/private DNS answers even in development", async () => {
  const lookup = mock.method(dns, "lookup", async () => [
    { address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 },
  ]);
  try {
    await assert.rejects(fetchInstallationPage(new URL("https://public.example/"), allowed), { code: "PRIVATE_ADDRESS" });
  } finally { lookup.mock.restore(); }
});

test("pins the validated DNS address and preserves the original HTTP hostname", async () => {
  const lookup = mock.method(dns, "lookup", async () => [{ address: "8.8.8.8", family: 4 }]);
  let pinnedAddress;
  const transport = mock.method(http, "request", (url, options, onResponse) => {
    assert.equal(url.hostname, "public.example");
    assert.equal(options.agent, false);
    assert.equal(options.family, 4);
    options.lookup("public.example", {}, (error, address, family) => {
      assert.equal(error, null);
      assert.equal(family, 4);
      pinnedAddress = address;
    });
    const req = new EventEmitter();
    req.end = () => {
      const res = new PassThrough();
      res.statusCode = 200;
      res.headers = { "content-type": "text/html" };
      onResponse(res);
      res.end(script);
    };
    req.destroy = () => {};
    return req;
  });
  try {
    const result = await fetchInstallationPage(new URL("http://public.example/"), allowed);
    assert.equal(result.html, script);
    assert.equal(pinnedAddress, "8.8.8.8");
    assert.equal(lookup.mock.callCount(), 1);
  } finally {
    lookup.mock.restore();
    transport.mock.restore();
  }
});

test("applies the total timeout to DNS resolution", async () => {
  const lookup = mock.method(dns, "lookup", () => new Promise(() => {}));
  try {
    await assert.rejects(fetchInstallationPage(new URL("https://public.example/"), {
      ...allowed, timeoutMs: 40,
    }), { code: "TIMEOUT" });
  } finally { lookup.mock.restore(); }
});

test("returns typed, safe errors instead of leaking network details", async () => {
  const lookup = mock.method(dns, "lookup", async () => { throw new Error("internal-address-secret"); });
  try {
    await assert.rejects(fetchInstallationPage(new URL("https://public.example/"), allowed), (error) => {
      assert.ok(error instanceof InstallationVerificationError);
      assert.equal(error.code, "FETCH_FAILED");
      assert.equal(error.message.includes("internal-address-secret"), false);
      return true;
    });
  } finally { lookup.mock.restore(); }
});
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
