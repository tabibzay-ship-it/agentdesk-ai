import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => !/(^|\/)(package-lock\.json|test-results|theme-backup-)/.test(file));

const rules = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["OpenAI secret", /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/],
  ["Supabase secret key", /\bsb_secret_[A-Za-z0-9_-]{16,}\b/],
  ["GitHub token", /\bgh[opusr]_[A-Za-z0-9]{30,}\b/],
  ["Netlify token", /\bnfp_[A-Za-z0-9_-]{30,}\b/],
];

const findings = [];
for (const file of files) {
  let contents;
  try { contents = readFileSync(file, "utf8"); } catch { continue; }
  for (const [label, pattern] of rules) {
    if (pattern.test(contents)) findings.push(`${file}: possible ${label}`);
  }
}

if (findings.length) {
  console.error(["Potential committed secrets detected:", ...findings].join("\n"));
  process.exit(1);
}
console.log(`Secret scan passed for ${files.length} tracked and untracked candidate files.`);
