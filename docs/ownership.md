# Ownership

Who creates, changes and removes each object. Terraform never owns what a
step of the story or a reset changes; `make tf-plan-all` stays empty after
both.

| Object | Owner | Notes |
| --- | --- | --- |
| vault-s, its Transit key and token role | Terraform `vault-seal` | |
| Seal tokens, init, root revocation | Ansible (`seal-init`, `seal-tokens`, `bootstrap`) | |
| Audit devices `file`, `stdout` | Terraform `vault-platform` | root namespace |
| Namespace `tidewell`, `kv/` (v2), `userpass/`, policy `vult-presenter` | Terraform `vault-platform` | the policy's one read path comes from `config/story.json` |
| Activation flags `secrets-sync`, `secrets-import` | Ansible `github-app` | read first, activated once |
| GitHub App `vaultsyncdemo`, destination `tidewell-github` | Ansible `github-app` | key from `.secrets/github/`; a destination that differs is reported, not rewritten |
| Destination `tidewell-localstack` | Ansible `destinations` | also removes associations whose copy LocalStack lost on a restart |
| The legacy secrets in LocalStack | Ansible `seed` | created when missing, from `config/story.json` |
| Saskia's userpass user and password | Ansible `people` | |
| `.build/stage/stage.json` | Ansible `stage` | names and counts only |
| Imported KV paths, associations, rotations | the story (the API, as Saskia) | `make stage-reset` (Ansible `stage-reset`) removes them |
| The copies in GitHub and in LocalStack | Vault (Secrets Sync) | removing the association deletes them |
| `.build/github/evidence.json` | `make github-evidence` (the host's `gh`) | names and update times only |
| The event list | the API (memory) | `make stage-reset` clears it |
