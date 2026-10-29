# Optional account AI

Core tracking works without AI. In **Settings → AI**, each signed-in account
chooses **Anthropic, OpenAI or Google Gemini** and supplies its own direct API
key. Subscription login, custom API URLs, local models, Azure/Vertex/enterprise
variants and automatic provider/model failover are not supported.

## Setup and changes

1. Choose a provider and enter a key. **Refresh models** asks that provider for
   available models and stores an encrypted, account-owned draft for 30 minutes.
   No health records are sent. Listings are advisory: not every listed model
   supports every task or has available quota.
2. Choose a primary model and, optionally, a separate document model. Leaving
   the document selection blank explicitly uses the primary model for documents.
3. **Test connection and documents** submits fictional text, a one-page PDF and
   an image to the selected models. This can incur provider charges. No account
   health data is included. Successful text and document tests are required for
   the exact selection before saving; changing a selection invalidates the test.
4. **Save AI settings** activates this configuration for subsequent requests.
   Saving makes no provider request and sends no health data. No server restart
   is required. Discarding a draft leaves the working saved configuration intact.

Keys are masked/write-only after submission, encrypted with the existing
server-controlled AES-GCM key and excluded from ordinary JSON health exports.
They are not placed in browser storage. Other accounts, delegates and PATs
cannot read or change these settings. Health questions and document imports
for owned dependents use the signed-in account's configuration; delegates
cannot spend the owner's key. The existing token-owner summary-refresh API
uses that token owner's configuration and retains its scope requirements.

Changing a key/provider/model changes its configuration revision. Old requests
are checked before sending, after the provider response and before saved
results/cache writes. Removal disables new calls and clears setup drafts; a
provider request already received by the provider cannot be recalled. Safe,
dated query history identifies its provider/model and earlier configurations;
automatic reuse requires matching current records, person and configuration.
Pre-context-version query output and legacy potentially pooled interaction
alerts/checks are retained in storage but withheld from current results.
Run fresh interaction checks after upgrading. Removing a key does not erase
copies in separately retained volume backups.

## Errors and recovery

Authentication/permission failures, quota/rate limits, unavailable models,
timeouts, unreadable saved keys and incomplete output have sanitized messages.
Provider response bodies, prompts and credentials are never reflected in those
errors. A failure does not silently try another model/provider/key or replace
the working configuration. Refresh and test another selection, or replace the
key. Expired/replaced drafts must be refreshed and tested again. If another
tab saved settings, reload Settings before editing the new revision.

Back up the complete `/data` volume, including the database, uploads and keys.
The saved configuration survives sign-out and container recreation only when
that volume and the matching encryption key are retained. Restoring the wrong
key cannot decrypt credentials; restore the matching key or submit a new one.
See [upgrade/restore](UPGRADING.md) and [security](../SECURITY.md).

## Legacy environment migration

`ANTHROPIC_API_KEY` no longer enables AI automatically, and `ANTHROPIC_MODEL`
or `ANTHROPIC_MODEL_EXTRACTION` no longer select models. Only an administrator
can explicitly copy the legacy environment key into **their own** encrypted
draft from Settings → AI. They must discover, select, test and save as above.
Nothing is assigned to other accounts. Remove legacy environment secrets from
the deployment separately after migration; changing live configuration is an
operator action. App settings remain authoritative while those variables exist.

## Data transfer and verification limits

Using an AI feature sends its authorized health context or uploaded document to
the chosen provider. The provider's API terms, retention, region and account
policies apply; this app does not promise zero retention or medical accuracy.
OpenAI requests use Responses with `store:false`; that does not replace the
provider's wider data policy. Extraction stays staged for review and preserves
existing file/date/schema/reconciliation checks. AI cannot approve clinical
imports for you.

Adapters use the official [OpenAI Responses](https://developers.openai.com/api/docs/guides/text?api-mode=responses)
and [file inputs](https://developers.openai.com/api/docs/guides/file-inputs),
[Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create)
and [model capabilities](https://platform.claude.com/docs/en/api/models/list),
and [Gemini generateContent](https://ai.google.dev/api/generate-content) and
[model discovery](https://ai.google.dev/api/models). Endpoints are fixed on
the server; credentials are sent in headers and redirects are refused.

Local fixtures and mocked responses verify plumbing and safety boundaries.
Real text/document requests for all three providers, provider extraction
accuracy and complete physical-phone acceptance remain separate pending gates.
