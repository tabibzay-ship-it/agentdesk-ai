import http from "node:http";

const host = "127.0.0.1";
const port = Number(process.env.AGENTDESK_MOCK_OPENAI_PORT || 55431);

function responseText(payload) {
  const serialized = JSON.stringify(payload);
  if (serialized.includes("SECOND_REVISION_REQUEST")) return "SECOND_REVISION_COMPLETE: The exported result was re-uploaded and revised again.";
  if (serialized.includes("FIRST_REVISION_REQUEST")) return "FIRST_REVISION_COMPLETE: The synthetic source was revised safely.";
  if (serialized.includes("SYNTHETIC_ATTACHMENT_MARKER_55421")) return "MOCK_ANALYSIS_CONFIRMED: SYNTHETIC_ATTACHMENT_MARKER_55421";
  return "AGENTDESK_LOCAL_MOCK_OK";
}

const server = http.createServer((request, reply) => {
  if (request.method !== "POST" || request.url !== "/v1/responses") {
    reply.writeHead(404, { "content-type": "application/json" });
    reply.end(JSON.stringify({ error: { message: "Not found" } }));
    return;
  }

  let raw = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { raw += chunk; });
  request.on("end", () => {
    let payload;
    try { payload = JSON.parse(raw); } catch { payload = null; }
    if (!payload || payload.model !== "gpt-5-mini" || payload.store !== false) {
      reply.writeHead(400, { "content-type": "application/json" });
      reply.end(JSON.stringify({ error: { message: "Unsafe or unexpected mock request configuration." } }));
      return;
    }
    const text = responseText(payload);
    const body = {
      id: `resp_local_${Date.now()}`,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "completed",
      model: "gpt-5-mini",
      output_text: text,
      output: [{
        id: `msg_local_${Date.now()}`,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text, annotations: [] }],
      }],
      usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 },
    };
    reply.writeHead(200, { "content-type": "application/json" });
    reply.end(JSON.stringify(body));
  });
});

server.listen(port, host, () => {
  process.stdout.write(`AgentDesk local mock listening at http://${host}:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
