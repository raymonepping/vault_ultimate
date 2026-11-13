// lib/importer.js: Act 1, Secrets Import (D12, D19). The API image carries
// the Enterprise vault binary (api/Containerfile); this module writes an
// import config from config/story.json and runs `vault operator import`
// with the presenter's token in the child's environment, never in argv.
//
// Measured (docs/capabilities.md): flags go before plan|apply; credentials
// come from the environment; LocalStack's private address needs
// allowed_ipv4_cidrs; a JSON SecretString is not parsed; a second apply
// writes a new version. So one mapping per legacy secret that KV does not
// hold yet, and nothing to import is a refusal, not a second version.
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const q = (s) => JSON.stringify(String(s)); // an HCL string is a JSON string here (no ${ in the names)
const reEscape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// importConfig({ secrets: [{aws_name, kv_name}], address, namespace, mount, localstackIp }) -> HCL
export function importConfig({ secrets, address, namespace, mount = "kv", localstackIp }) {
  const blocks = [
    `source_aws {\n  name = "legacy"\n  allowed_ipv4_cidrs = [${q(`${localstackIp}/32`)}]\n}`,
    `destination_vault {\n  name = "tidewell"\n  address = ${q(address)}\n  namespace = ${q(namespace)}\n  mount = ${q(mount)}\n}`,
  ];
  secrets.forEach((s, i) => {
    blocks.push(
      `mapping {\n  name = "legacy-${i}"\n  source = "legacy"\n  destination = "tidewell"\n` +
        `  filter = ${q(`Secret.Name == ${JSON.stringify(s.aws_name)}`)}\n` +
        `  transform "regexp" {\n    from = ${q(`^${reEscape(s.aws_name)}$`)}\n    to = ${q(s.kv_name)}\n  }\n}`,
    );
  });
  return blocks.join("\n\n") + "\n";
}

// The CLI prints names and progress, never a value; a token-shaped string is
// still cut out before the output reaches an event or a response.
export const cleanOutput = (s) =>
  String(s)
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/hv[sbr]\.[A-Za-z0-9_-]{20,}/g, "[token removed]")
    .replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z \[INFO\] +/gm, "")
    .trim()
    .slice(0, 8_000);

// The CLI exits 0 even when every write was refused (measured): its own
// "not imported" list decides.
export const importFailed = (output) => /Secrets not imported|^Error/im.test(output);

// runImport(step, { token, config, vaultAddr, timeoutMs, bin }) -> { ok, code, output }
export async function runImport(step, { token, config, vaultAddr, timeoutMs = 90_000, bin = process.env.VAULT_BIN || "vault" }) {
  if (step !== "plan" && step !== "apply") throw new Error(`unknown import step ${step}`);
  const dir = await mkdtemp(join(tmpdir(), "import-"));
  const file = join(dir, "import.hcl");
  try {
    await writeFile(file, config, { mode: 0o600 });
    const args = ["operator", "import", `-config=${file}`, ...(step === "apply" ? ["-auto-approve"] : []), step];
    return await new Promise((resolve) => {
      const child = spawn(bin, args, {
        env: {
          PATH: process.env.PATH,
          HOME: tmpdir(),
          VAULT_ADDR: vaultAddr,
          VAULT_CACERT: process.env.VAULT_CACERT || "/etc/vult/ca-chain.pem",
          VAULT_TOKEN: token,
          // Every AWS call (STS too) goes to LocalStack, trusting the lab CA
          // through SSL_CERT_DIR (AWS_CA_BUNDLE breaks the client: probe).
          AWS_ENDPOINT_URL: process.env.LOCALSTACK_URL || "https://localstack:4566",
          SSL_CERT_DIR: process.env.SSL_CERT_DIR || "/etc/ssl/certs:/etc/vult",
          AWS_ACCESS_KEY_ID: "test",
          AWS_SECRET_ACCESS_KEY: "test",
          AWS_REGION: process.env.VULT_AWS_REGION || "eu-west-1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      const add = (b) => {
        if (out.length < 64_000) out += b;
      };
      child.stdout.on("data", add);
      child.stderr.on("data", add);
      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      child.on("error", (e) => {
        clearTimeout(timer);
        resolve({ ok: false, code: null, output: `could not start ${bin}: ${e.code || e.message}` });
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        const tail = signal ? `\n(stopped: ${signal} after ${timeoutMs / 1000} s)` : "";
        const output = cleanOutput(out + tail);
        resolve({ ok: code === 0 && !importFailed(output), code, output });
      });
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
