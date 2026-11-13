# DESIGN.md: vault_ultimate console

The Tidewell Ferries console follows **Vault daylight glass**, the house system for
every Vault project (canonical implementation: Arcanium; contract: the
`vault-ui-design` skill). Light frosted panes, black ink, one dark ink hero per
page, strong status colours that hold WCAG AA. This file states only what
vault_ultimate adds or decides on top of it.

## Stack

- React 19 + Vite 8 + Tailwind v4 (`web/`), served by nginx over TLS 1.3 with
  the lab CA's listener certificate (`make gen-certs`).
- `web/src/styles/vault-glass.css` is the skill's file, unchanged;
  `shell.css` is vault_codex's copy. Shared layout in `app.css`; this
  console's own pieces (the two-way map, fingerprints, the places, the event
  list) in `sync.css`, tokens only.
- Fonts: Hanken Grotesk Variable and JetBrains Mono Variable via
  `@fontsource-variable`, bundled, no external requests. Mono only for
  identifiers: paths, secret names, fingerprints, correlation ids, templates.
  Ligatures are off in code and output, so the CLI's `->` stays `->`.
- Icons: `lucide-react`; the GitHub mark is the footer's authored SVG (lucide
  has no brand marks). No emoji.
- CSP `style-src 'self'` and `script-src 'self'`: no inline styles or scripts.

## Console

- **The memorable element is the two-way map.** The legacy store on the
  left with an arrow into Vault (pulled, Secrets Import); GitHub Actions and
  the AWS copy on the right with arrows out of Vault (pushed, Secrets Sync).
  Each arrow carries the state Vault reports and the time of the last change.
  It sits inside each page's single ink hero: full on Overview, compact on
  the act pages, one column with downward arrows on a phone.
- **States on the system's pills** (text on its own tint is AA): synced
  healthy, failed rejected, anything still in progress pending, "not
  associated" and "absent" a neutral `none` pill (muted ink on the hover
  wash; the indigo `manual` pill is under AA on glass).
- **A value is never on screen.** A fingerprint is (8 hex of SHA-256), and
  a copy that differs from Vault says "differs from Vault".
- **GitHub's word is labelled.** Its record shows its own age and turns
  "stale: read before the last sync" when Vault synced after it was read.
- **Vault's refusals are verbatim.** Every step's result carries Vault's
  status and errors; the "Vault said" drawer and the Proof page show them
  with the correlation id the audit log records.
- **Copy.** Plain verbs (pulled, pushed, removed), sentence case, no
  all-caps eyebrows written by hand, no arrows on buttons.

## Pages

| Page | Route | Shows |
| --- | --- | --- |
| Overview | `#/overview` | The full map, pull and push in two sentences each, what each place holds |
| Bring home | `#/home` | The legacy store with fingerprints; Show the plan, then Import; the CLI output verbatim; what Vault holds now (version, labels, fingerprint) |
| Send out | `#/out` | Both destinations (template, granularity), push and remove, Vault's status per secret, GitHub's own record with its age |
| Change once | `#/change` | Rotate the delivery key; Vault, the AWS copy and GitHub side by side, polled every 3 s |
| Proof | `#/proof` | Every step by Saskia, newest first, with Vault's answers and the correlation id |

## Verification

`make test-ui` (Playwright, 22 tests): axe WCAG 2.1 AA with zero violations
on every page at 1440x900 and 390x844 with the story in a shown state, and
on the signed-out form; TLS 1.3 and CSP; no legacy or rotated value on any
page or in any bundle; a foreign-origin write and a step with parameters
refused; the four acts from the real buttons against GitHub and LocalStack.
`make screenshots` refreshes `docs/screenshots/`.
