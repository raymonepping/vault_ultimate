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
  console's own pieces (the four numbers, the act rail, evidence rows, the
  runner's output, the event list) in `console.css`, tokens only.
- Fonts: Hanken Grotesk Variable and JetBrains Mono Variable via
  `@fontsource-variable`, bundled, no external requests. Mono only for
  identifiers: paths, secret names, fingerprints, correlation ids, templates.
  Ligatures are off in code and output, so the CLI's `->` stays `->`.
- Icons: `lucide-react`; the GitHub mark is the footer's authored SVG (lucide
  has no brand marks). No emoji.
- CSP `style-src 'self'` and `script-src 'self'`: no inline styles or scripts.

## Console

- **The memorable element is the scoreboard.** Four numbers in the page's
  one ink hero: standing secrets, the longest remaining lifetime, unmanaged
  copies, the leak window. Each is a button that opens the witness rows it
  rests on: what was tried, the answer verbatim, when, the fingerprint.
- **The act rail** (0 to 6) shows done, now and next; only the next act has
  a button, and the API refuses any other. A wave runs on the host: its
  redacted output streams into "On the host" until it ends.
- **Credential states on the system's pills** (text on its own tint is AA):
  still works red (a standing secret is the problem), refused green, unknown
  amber (the target did not answer), gone or later a neutral `none` pill
  (muted ink on the hover wash).
- **A value is never on screen.** A fingerprint is (8 hex of SHA-256).
- **Vault's refusals are verbatim** (`CEILING_POLICY_DENIED`,
  `Invalid credentials (49)`); the "Vault said" drawer and the Proof page
  show them with the correlation id the audit log records.
- **Derived is labelled.** Timeline rows from no record of their own (an
  expiry) say so; the summary's sentences carry the row ids they cite.
- **Copy.** Plain verbs, sentence case, no all-caps eyebrows written by
  hand, no arrows on buttons.

## Pages

| Page | Route | Shows |
| --- | --- | --- |
| Scoreboard | `#/scoreboard` | The four numbers and their evidence, the act rail with the next act's button, Terraform's "what's left" verbatim |
| Acts | `#/acts` | One card per act: what it removes, how, when it ran, the witness rows it changed, Vault's answers (act 5's overreach, act 6's drill) |
| Witness | `#/witness` | Every try with its answer, lifetime and fingerprint; the secret zero; the copies; the residual and its reason |
| Investigation | `#/investigation` | Act 6: the evidence panel, the lease to revoke, Agent's fresh login, the deploy rotation with GitHub's and LocalStack's times, the cited summary or "not available", the timeline |
| Proof | `#/proof` | Every action by Saskia, newest first, with Vault's status and the correlation id; the stage reset behind a single-use confirmation |

## Verification

`make test-ui` (Playwright): Saskia signs in through Keycloak's real form;
act 0's numbers and their evidence; acts 1 to 6 from the act rail; act 6's
numbers; the revoke, Agent's fresh login and the rotation from the
Investigation page; axe WCAG 2.1 AA with zero violations on every page at
1440x900 and 390x844 at act 6, and signed out; TLS 1.3 and CSP; no legacy
value in a bundle or an API answer; foreign-origin writes, parameters in a
body and an unlisted lease refused; then the stage reset from the Proof page
back to the act 0 baseline. The journey writes `docs/screenshots/`.
