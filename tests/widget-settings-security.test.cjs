/* eslint-disable @typescript-eslint/no-require-imports -- Node security test harness. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const publicId = '22222222-2222-4222-8222-222222222222';
function compile(file, imports, logs = []) {
  const compiledModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module: compiledModule, exports: compiledModule.exports, URL, Response, Headers,
    process: { env: { NODE_ENV: 'production', AGENTDESK_APP_ORIGIN: 'https://agentdesk.example' } },
    console: { error(...values) { logs.push(values); } },
    require(name) {
      if (name === 'server-only') return {};
      if (Object.hasOwn(imports, name)) return imports[name];
      throw new Error('Unexpected import: ' + name);
    },
  }, { filename: file });
  return compiledModule.exports;
}
const origin = compile('lib/origin-security.ts', {});
function fixture(options = {}) {
  const { saved = null, fail = null } = options;
  const active = Object.hasOwn(options, 'active') ? options.active : true;
  const queries = [], logs = [];
  const route = compile('app/api/widget-settings/route.ts', {
    '@/lib/origin-security': origin,
    'next/server': { NextResponse: { json: Response.json } },
    '@supabase/supabase-js': { createClient() { return {
      from(table) {
        queries.push(table);
        const builder = {
          select() { return builder; }, eq() { return builder; },
          async maybeSingle() {
            if (fail === table) return { data: null, error: { message: 'PRIVATE_DIAGNOSTIC' } };
            return { error: null, data: table === 'agent_settings'
              ? { user_id: 'INTERNAL_OWNER', public_agent_id: publicId, is_active: active, allowed_domains: ['customer.example'] }
              : saved };
          },
        };
        return builder;
      },
    }; } },
  }, logs);
  function request(value = 'https://customer.example') {
    return new Request('https://agentdesk.example/api/widget-settings?agentId=' + publicId,
      { headers: value === undefined ? {} : { Origin: value } });
  }
  return { route, queries, logs, request };
}
test('public widget status requires explicit boolean true for defaults and saved settings', async () => {
  for (const saved of [null, { agent_name: 'Support', welcome_message: 'Welcome', primary_color: '#123456' }]) {
    for (const active of [true, false, null, undefined, 'true', 1, 0]) {
      const f = fixture({ active, saved });
      const response = await f.route.GET(f.request());
      assert.equal(response.status, 200);
      assert.equal((await response.json()).isActive, active === true);
    }
  }
});
test('widget domain rejection stops before private widget retrieval and returns no CORS grant', async () => {
  for (const value of ['null', 'https://evil.example', 'https://sub.customer.example', 'https://customer.example/path']) {
    const f = fixture();
    const response = await f.route.GET(f.request(value));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(f.queries.includes('widget_settings'), false);
  }
  const f = fixture();
  const missing = new Request('https://agentdesk.example/api/widget-settings?agentId=' + publicId);
  assert.equal((await f.route.GET(missing)).status, 403);
  assert.equal(f.queries.includes('widget_settings'), false);
});
test('public widget response bounds personalization and omits internal ownership fields', async () => {
  const f = fixture({ saved: { agent_name: 'A'.repeat(500), welcome_message: 'B'.repeat(5000), primary_color: 'url(javascript:unsafe)', user_id: 'INTERNAL_OWNER', private_note: 'PRIVATE_DIAGNOSTIC' } });
  const response = await f.route.GET(f.request());
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['agentName', 'isActive', 'locale', 'position', 'primaryColor', 'size', 'theme', 'welcomeMessage']);
  assert.equal(body.agentName.length, 100);
  assert.equal(body.welcomeMessage.length, 1000);
  assert.equal(body.primaryColor, '#2563eb');
  assert.equal(JSON.stringify(body).includes('INTERNAL_OWNER'), false);
  assert.equal(JSON.stringify(body).includes('PRIVATE_DIAGNOSTIC'), false);
});
test('public widget database failures expose only generic response and log messages', async () => {
  for (const fail of ['agent_settings', 'widget_settings']) {
    const f = fixture({ fail });
    const response = await f.route.GET(f.request());
    assert.equal(response.status, 500);
    assert.equal(JSON.stringify(await response.json()).includes('PRIVATE_DIAGNOSTIC'), false);
    assert.equal(JSON.stringify(f.logs).includes('PRIVATE_DIAGNOSTIC'), false);
  }
});
