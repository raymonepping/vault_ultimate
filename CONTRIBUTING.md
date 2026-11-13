# Contributing

This is a lab, built and run on one Mac. Changes are welcome as issues or
pull requests.

1. `make lab` (first run) or `make up`, then `make verify` before you change
   anything, so you know the starting point.
2. Keep to the tools' roles (`docs/architecture.md`, `docs/ownership.md`):
   declared Vault structure in Terraform, act by act (`var.act`), everything
   with a value, an order or a moment in Ansible, the story in
   `config/story.json` and `config/inventory.json`, containers through
   `scripts/compose.sh`, every operation through a `make` target.
3. Every container, volume and compose project starts with `vult-`; never
   touch another project's resources. Container names keep one dash, after
   the prefix (`vult-vault_1`).
4. Never print a token, key, password or the licence; show fingerprints.
   People and values are fictional: the GitHub repository is public. gitleaks
   runs in CI; never commit a certificate or key, not even a test one (make
   test fixtures at test time).
5. Before a pull request: `make lint`, `make test-unit`, `make tf-plan-all`
   (clean), `make verify`, and for console changes `make test-ui` (axe must
   report 0 violations; see `DESIGN.md`).
6. A change to a bootstrap policy (`vault/policies/bootstrap/`) needs the
   root-regen cycle in `docs/operations.md` or a rebuild from nothing;
   nothing else can widen them.
7. The console never claims more than Vault, the targets and GitHub said: no
   simulated status, an unreachable target is unknown (never refused), no
   number without its evidence rows, no value on screen (fingerprints only).
8. No em dashes in docs, comments or UI text.
