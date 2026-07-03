# Connecting Integrations

Every connector runs a **real, read-only audit** against a live vendor API. You
supply credentials in the app (**Integrations → pick a connector → Connect**);
they are encrypted in the BYOK vault and decrypted only at sync time. You do
**not** put these in `.env` — that's only a dev fallback. The one exception is
OAuth *app* credentials (see the GitHub OAuth note), which are developer-level
and live in `.env`.

For each connector below: create a **read-only** credential in the vendor, paste
the listed fields into the connect form, then click **Sync**.

> Use least-privilege, read-only scopes everywhere. These audits never write.

---

## AWS — account security posture
**Audits (CIS-style, read-only):** root-account MFA, an IAM password policy,
EBS default encryption, security groups exposing SSH/RDP to `0.0.0.0/0`,
CloudTrail enabled, and optionally a named S3 bucket's encryption. Aggregated
into one verdict (compliant only when all checks pass).
1. AWS Console → **IAM → Users → Create user** (or reuse a machine user).
2. Attach the AWS-managed **`SecurityAudit`** policy (read-only across services). Narrower alternative: `ReadOnlyAccess`.
3. **Security credentials → Create access key** → copy the key + secret.

Fields: `aws_access_key_id`, `aws_secret_access_key`, `region` (optional, default `us-east-1`), `bucket_name` (optional).

> EC2 and CloudTrail checks cover the chosen **region** only; multi-region trails still show up.

## GCP — GCS bucket encryption / public access
**Audits:** CMEK / public-access-prevention on a bucket.
1. Cloud Console → **IAM & Admin → Service Accounts → Create**.
2. Grant it **Storage Object Viewer** (or `storage.buckets.get`) on the bucket.
3. **Keys → Add key → JSON** → download.

Fields: `service_account_json` (paste the whole JSON), `bucket_name`, `project_id` (optional).

## Azure — Storage Account secure transfer + encryption
**Audits:** HTTPS-only + encryption on a storage account.
1. **Entra ID → App registrations → New registration**.
2. **Certificates & secrets → New client secret** → copy the value.
3. In the **storage account → Access control (IAM)** → assign the app the **Reader** role.
4. Note **tenant ID** (app Overview), **subscription ID**, **resource group**, **account name**.

Fields: `tenant_id`, `client_id`, `client_secret`, `subscription_id`, `resource_group`, `account_name`.

## Okta — MFA factor enrollment
**Audits:** every user has an active MFA factor.
1. Okta Admin → **Security → API → Tokens → Create token** → copy it.
2. Your org URL is `https://<your-org>.okta.com`.

Fields: `org_url`, `token`.

## Auth0 — MFA (Guardian) enrollment
**Audits:** every directory user has confirmed MFA enrollment.
1. Auth0 Dashboard → **Applications → Create** → **Machine to Machine**.
2. Authorize it for the **Auth0 Management API** with scopes `read:users`, `read:logs`, `read:roles`.
3. Copy **Domain**, **Client ID**, **Client Secret**.

Fields: `domain`, `client_id`, `client_secret`.

## Microsoft Entra ID — MFA / strong auth methods
**Audits:** every enabled user has a strong (non-password) auth method.
1. **Entra ID → App registrations → New registration**.
2. **API permissions → Add → Microsoft Graph → Application permissions**: `User.Read.All`, `UserAuthenticationMethod.Read.All` → **Grant admin consent**.
3. **Certificates & secrets → New client secret**.

Fields: `tenant_id`, `client_id`, `client_secret`.

## Google Workspace — 2-Step Verification enrollment
**Audits:** every active user is enrolled in 2SV.
1. Create a GCP **service account** and **enable domain-wide delegation** (note its client ID).
2. Admin console → **Security → API controls → Domain-wide delegation** → add the client ID with scope `https://www.googleapis.com/auth/admin.directory.user.readonly`.
3. Download the service-account **JSON key**.
4. Pick an admin email for the tool to impersonate.

Fields: `service_account_json`, `admin_email`.

## GitHub — repository security posture
**Audits:** branch protection, Dependabot alerts, secret scanning, visibility.

**Option A — Personal Access Token (simplest):**
1. GitHub → **Settings → Developer settings → Personal access tokens** → generate a token with `repo` + `read:org`.

Fields: `token`, `owner`, `repo`, `branch` (optional, defaults `main`).

**Option B — OAuth (developer setup, enables the "OAuth Web Connection" tab):**
1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. **Authorization callback URL:** `http://localhost:8001/api/integrations/github/callback`
   (match `PUBLIC_API_BASE_URL`).
3. Put the app's **Client ID/Secret** in `.env` as `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.
4. Users then click **OAuth Web Connection → Authorize**. With no owner/repo given, the sync audits the token's most recently active repos.

## Snyk — open vulnerabilities
**Audits:** open critical/high vulns across the org's projects.
1. Snyk → **Account settings → General → Auth Token** (or a service account token).
2. **Organization settings → Organization ID**.

Fields: `token`, `org_id`.

## CrowdStrike Falcon — sensor coverage
**Audits:** all hosts report full sensor functionality.
1. Falcon console → **Support → API Clients & Keys → Create API client** with scope **Hosts: Read**.
2. Copy client ID/secret; set the base URL for your cloud (US-1 `https://api.crowdstrike.com`, US-2 `https://api.us-2.crowdstrike.com`, EU `https://api.eu-1.crowdstrike.com`).

Fields: `client_id`, `client_secret`, `base_url` (optional, defaults US-1).

## Jamf Pro — FileVault disk encryption
**Audits:** all managed Macs report FileVault encryption.
1. Jamf Pro → **Settings → API roles and clients → API Roles** → create a role with **Read Computer Inventory**.
2. **API Clients** → create a client, assign the role → copy client ID/secret.
3. Base URL is `https://yourorg.jamfcloud.com`.

Fields: `base_url`, `client_id`, `client_secret`.

## Workday — active worker roster
**Audits:** worker records are retrievable (roster sync).
1. Build a **RaaS** (Report-as-a-Service) report, enable **Web Service** output, copy the **JSON** URL.
2. Create an **Integration System User (ISU)** with GET access to that report.

Fields: `report_url`, `username`, `password`.

---

## After connecting
Click **Sync**. The audit runs against the live API and flips every imported
framework control this connector maps to (Passing/Failing) — no manual data
entry. An empty result (e.g. 0 users, 0 repos) reports **non-compliant**, not a
false green.
