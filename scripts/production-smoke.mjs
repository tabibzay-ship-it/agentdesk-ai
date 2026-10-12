import { connect } from "node:tls";

const origins = ["https://getagentdeskai.com", "https://www.getagentdeskai.com"];
const publicRoutes = ["/", "/login", "/register", "/forgot-password", "/reset-password"];

async function check(url, expected = [200]) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
  if (!expected.includes(response.status)) throw new Error(`${url} returned HTTP ${response.status}`);
  if (new URL(response.url).protocol !== "https:") throw new Error(`${url} did not remain on HTTPS`);
  return response;
}

for (const origin of origins) await check(origin);
for (const route of publicRoutes) await check(`${origins[0]}${route}`);
await check(`${origins[0]}/api/widget-settings?agentId=invalid`, [400]);

await new Promise((resolve, reject) => {
  const socket = connect({ host: "getagentdeskai.com", port: 443, servername: "getagentdeskai.com", rejectUnauthorized: true }, () => {
    const certificate = socket.getPeerCertificate();
    if (!certificate.valid_to || Date.parse(certificate.valid_to) <= Date.now()) reject(new Error("Production TLS certificate is expired."));
    else resolve();
    socket.end();
  });
  socket.setTimeout(15_000, () => socket.destroy(new Error("TLS verification timed out.")));
  socket.once("error", reject);
});

console.log("Production public-route, canonical-domain, API error-path, HTTPS, and TLS checks passed.");
