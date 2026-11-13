// lib/importer.js: act 1's Secrets Import config (ansible/act-1.yml writes it
// with importConfig and runs `vault operator import` in a throwaway Vault
// container, the token on stdin).
//
// Measured (docs/capabilities.md): LocalStack's private address needs
// allowed_ipv4_cidrs; a second apply writes a new version. So one mapping per
// legacy secret that KV does not hold yet, by its exact name.
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
