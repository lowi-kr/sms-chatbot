# Architecture Overview

## Purpose

SMS Chatbot is a Cloudflare Worker application that turns inbound Telnyx SMS/MMS messages into an encrypted, stateful AI conversation. The Worker is the application boundary: it accepts the Telnyx webhook, applies access and content policy, coordinates persistence and model calls, and sends the response back through Telnyx. Cloudflare D1 supplies the durable SQLite-backed state store.

## High-level flow

```text
SMS received
    |
    v
Telnyx webhook
    |
    v
Cloudflare Worker
    |  validate event, identify sender, apply access/filter rules
    |  load conversation state and settings from D1
    v
OpenRouter API
    |  chat completion (and optional naming/memory extraction)
    v
D1 DB
    |  persist encrypted conversation data and updated state
    v
Encrypted response
    |
    v
Telnyx outbound SMS/MMS
```

In more detail:

1. A person sends an SMS or MMS to the Telnyx number.
2. Telnyx delivers an HTTP webhook event to the Worker. The Worker extracts the sender, recipient, message body, media information, and event metadata.
3. The Worker performs request/event handling, access-list checks, keyword/content filtering, command handling, and conversation selection. Commands such as `/new`, `/load`, `/memory`, and `/support` can change state without invoking the normal chat path.
4. For a normal message, the Worker loads the active conversation and relevant per-number settings from D1, decrypts only the data needed to construct the model context, and calls the configured OpenRouter model. Naming and memory extraction are separate configurable model operations when applicable.
5. The Worker encrypts message content and any durable memory before writing it to D1. It also updates conversation, usage, and settings-related state.
6. The generated answer is returned through Telnyx's messaging API. The application can also record operational metadata, such as roles, lengths, model names, and token counts, in the configured Google Sheet; ordinary message content is not sent there.

The companion dashboard is a separate client. It calls the Worker's `/api/*` administration endpoints for settings, access lists, usage, support tickets, and outbound messages.

## Data flow and encryption

Conversation messages are stored as ciphertext, not as ordinary plaintext. The application uses AES-256-GCM, an authenticated encryption mode that provides both confidentiality and integrity.

The conceptual storage flow is:

```text
plaintext message
    -> derive per-phone/purpose key with HKDF
    -> generate a fresh random nonce/IV
    -> AES-256-GCM encrypt
    -> store ciphertext plus the nonce/authentication data
```

When context is needed, the Worker retrieves the encrypted value, derives the same key, and decrypts and authenticates it in memory. If authentication fails, the value must be treated as invalid rather than trusted. A fresh nonce is required for each encryption operation; the nonce is not secret and can be stored with the ciphertext, while the key must remain secret.

HKDF derivation is scoped by phone number and purpose. Message data and memory use independent purpose strings (`msg` and `memory`), so the key used for one class of data is not reused as the other class's derived key. This limits the impact of accidental cross-use and keeps the two data domains cryptographically separated.

The same protection applies to durable per-phone memory (`memory.encrypted_facts`). Support tickets are intentionally a plaintext exception because they are a human-follow-up queue. Filtered or blocked content may also be logged in full for moderation, as described by the project privacy model.

## D1 usage

D1 is the Worker’s durable state layer. The schema is SQLite-compatible and includes indexes for the sender and conversation lookups used by the message path.

- `conversations` tracks a phone number's conversations, names, active selection, and timestamps.
- `messages` stores the user and assistant turns associated with a conversation. The `content` column contains encrypted message data; `conversation_id` preserves ordering and grouping.
- `memory` stores encrypted per-phone facts, the extraction checkpoint, and the `incognito` flag. The checkpoint prevents repeated extraction of the same history, while incognito controls whether memory is read or written.
- `settings` stores global configuration such as the chat, naming, and memory models, fallback behavior, token defaults, and the memory extraction threshold.
- `number_settings` stores per-phone model, fallback, token-limit, and token-usage overrides.
- `whitelist` and `blacklist` implement phone-number access control.
- `support_tickets` stores the intentionally plaintext support queue and its open/closed lifecycle.

Test mode is controlled by the Worker configuration (`TEST_MODE`, set in `wrangler.toml` or the deployed environment), rather than by conversation content. In test mode, the `/test` and `/test-ui` paths can exercise the pipeline in a browser and log replies instead of sending them through Telnyx. D1 still provides the conversation and configuration state needed for those runs. This separation means the deployment flag controls delivery behavior while D1 remains the source of durable application state.

## Telnyx integration and webhook handshake

Telnyx is the transport boundary for inbound and outbound SMS/MMS. The configured Telnyx messaging profile points its inbound webhook at the deployed Worker URL. Telnyx sends an event payload when a message arrives; the Worker accepts the webhook, parses the event, and routes supported message events into the chat pipeline.

The webhook handshake is an HTTP acknowledgement: after receiving a valid webhook request, the Worker returns a successful response so Telnyx knows the event was received. The Worker must respond promptly and avoid treating an inbound event as a browser form submission. Event processing then performs the application work—sender/access checks, D1 reads and writes, OpenRouter calls, and the outbound Telnyx API request. Duplicate or retried delivery should be handled defensively using the event/message identity where available, so a Telnyx retry does not unintentionally create duplicate application state or replies.

Outbound responses use the Telnyx API credentials configured as Worker secrets. Test mode deliberately bypasses live delivery while retaining a safe way to exercise the same routing and model behavior.

## Security model

The root `ENCRYPTION_KEY` is critical key material. It is supplied as a secret to the Worker runtime and must never be committed to the repository, placed in client-side code, or exposed through the admin API. The application uses that secret as the root for HKDF-derived keys scoped to a phone number and purpose, and uses AES-256-GCM to encrypt and authenticate stored message and memory content.

The admin API is designed not to decrypt or expose conversation content. Dashboard operations should therefore operate on metadata and configuration, while decryption remains inside the Worker’s protected runtime. Telnyx and OpenRouter credentials are also runtime secrets. Google Sheets receives metadata rather than ordinary message bodies. Losing or rotating `ENCRYPTION_KEY` makes existing ciphertext unreadable unless a deliberate, supported key-migration process is implemented; key rotation must therefore be planned as a data migration, not treated as a routine configuration change.

## Main components

| Component | Responsibility |
|---|---|
| Cloudflare Worker | HTTP routing, webhook handling, policy checks, orchestration, admin API, and delivery |
| Telnyx | Inbound webhook delivery and outbound SMS/MMS transport |
| OpenRouter | Configurable chat, naming, and memory-extraction model access |
| Cloudflare D1 | Durable conversations, encrypted messages/memory, settings, access lists, tickets, and usage |
| Google Sheets | Operational and moderation metadata logging |
| Companion dashboard | Administrative UI that calls the Worker's API |

The implementation is organized under `src/`: `handlers` contains webhook/test entry points, `core` contains the pipeline and delivery orchestration, `db` contains D1 helpers, `security` contains encryption and filtering, `integrations` contains external providers, and `admin` contains dashboard-facing APIs.
