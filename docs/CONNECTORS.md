# Connecting Integrations

This is a **banking-first** GRC platform, so the connector set is deliberately
small and banking-relevant. Every connector runs a **real, read-only audit**
against a live API. You supply credentials in the app (**Integrations → pick a
connector → Connect**); they are encrypted in the BYOK vault and decrypted only
at sync time. `.env` is only a dev fallback.

| Connector | What it proves | Access |
|-----------|----------------|--------|
| Google Cloud Platform | Encryption at rest, no public buckets, no SSH/RDP exposure | Live GCP service account |
| Google Workspace | MFA (2-Step Verification) enrollment | Live Workspace service account |
| Apache Fineract | Core-banking segregation of duties + audit trail | Self-hosted (open source) |
| Wazuh | Endpoint/EDR sensor coverage | Self-hosted (open source) |

> Use least-privilege, read-only scopes everywhere. These audits never write.

---

## GCP — project security posture
**Audits (read-only):** every GCS bucket enforces public-access prevention, no
firewall opens SSH/RDP (22/3389) to `0.0.0.0/0`, and optionally a named bucket's
encryption. Aggregated into one verdict.
1. Cloud Console → **IAM & Admin → Service Accounts → Create**.
2. Grant it a read-only role at the **project** level: **Viewer** (or the tighter **Security Reviewer**).
3. Enable the **Compute Engine API** on the project (for the firewall check).
4. **Keys → Add key → JSON** → download.

Fields: `service_account_json` (paste the whole JSON), `project_id`, `bucket_name` (optional).

## Google Workspace — identity posture
**Audits:** all active users enrolled in 2SV, every admin enrolled in 2SV, and no active account dormant (>90d).
1. Create a GCP **service account** and **enable domain-wide delegation** (note its client ID).
2. Admin console → **Security → API controls → Domain-wide delegation** → add the client ID with scope `https://www.googleapis.com/auth/admin.directory.user.readonly`.
3. Download the service-account **JSON key**.
4. Pick an admin email for the tool to impersonate.

Fields: `service_account_json`, `admin_email`.

## Apache Fineract — core-banking control posture
Apache Fineract is a real open-source core-banking ledger. Self-host it, then the
connector audits three banking governance controls (read-only):
- **Maker-checker (four-eyes)** approval is enabled globally,
- a **strong password policy** is active,
- the **audit trail** is populated (privileged actions are logged).

**Stand it up (Docker):**
```bash
git clone https://github.com/apache/fineract.git
cd fineract
docker compose up -d          # builds Fineract + its database
```
The API comes up at `https://localhost:8443/fineract-provider/api/v1` with a
**self-signed certificate** (the connector skips TLS verification by default).
Default tenant is `default`; the default seed login is `mifos` / `password`.

**Create a read-only API user (recommended):**
1. Log in to the Community App (or via API) as an admin.
2. **Admin → Users → Roles** → create a role granting only `READ`/checker
   permissions (no maker/create/update).
3. **Admin → Users** → create a user with that role → use it below.

Fields: `base_url` (e.g. `https://localhost:8443`), `username`, `password`, `tenant` (optional, default `default`).

## Wazuh — endpoint / EDR posture
Wazuh is a real open-source EDR/XDR. Self-host the manager, enroll at least one
agent, then the connector audits (read-only):
- **sensor coverage** — every enrolled agent (excluding the manager) is active,
- **no outdated agents** on a stale sensor version,
- the **security manager** daemons are all running.

**Stand it up (Docker, single-node):**
```bash
git clone https://github.com/wazuh/wazuh-docker.git -b v4.9.0
cd wazuh-docker/single-node
docker compose -f generate-indexer-certs.yml run --rm generator
docker compose up -d
```
The server API listens on `https://localhost:55000` (self-signed cert). Then
**enroll an agent** on a machine you want monitored (see the Wazuh "Deploying
agents" docs) so there is coverage data to audit.

**Create a read-only API user:**
1. Wazuh dashboard → **Server management → Security → Users**.
2. Create a user and assign the built-in **read-only** role/policy.

Fields: `base_url` (e.g. `https://localhost:55000`), `username`, `password`.

---

## After connecting
Click **Sync**. The audit runs against the live API and flips every imported
framework control this connector maps to (Passing/Failing) — no manual data
entry. An empty result (e.g. 0 agents, 0 users) reports **non-compliant**, not a
false green.

Connector → control mapping: GCP → *Encryption of Data at Rest*; Google
Workspace → *Multi-Factor Authentication*; Fineract → *Segregation of Duties
(Maker-Checker)* + *Audit Logging & Monitoring*; Wazuh → *Endpoint Detection &
Response Coverage*.
