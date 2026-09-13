# Node MVC Boilerplate

Simple Node.js + Express MVC boilerplate using PostgreSQL via Sequelize.

## Structure

```
src/
├── app.js              # Express app setup, middleware, route mounting
├── server.js           # Entry point — connects to DB and starts the server
├── config/
│   ├── index.js        # Reads env vars
│   └── database.js     # Sequelize connection instance
├── models/
│   ├── index.js                   # Aggregates and exports models
│   ├── item.model.js              # Sample "Item" Sequelize model
│   ├── webhookDelivery.model.js   # Durable webhook delivery queue rows
│   └── webhookEndpoint.model.js   # Registered webhook delivery URLs + encryption keys
├── controllers/
│   ├── item.controller.js     # Request handlers — validate input, call models
│   └── webhook.controller.js  # Register endpoints + enqueue deliveries
├── routes/
│   ├── index.js          # Aggregates route modules under /api
│   ├── item.routes.js    # /api/items routes
│   └── webhook.routes.js # Webhook register/deliver/status routes
├── services/
│   ├── webhookCrypto.service.js # Key generation and encrypted payloads
│   └── webhookQueue.service.js  # Queue enqueueing, worker pickup, retry logic
└── middlewares/
    ├── notFound.js       # 404 handler
    └── errorHandler.js   # Centralized error handler
```

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Create a `.env` file from the sample and fill in your PostgreSQL credentials:
   ```
   cp env.sample .env
   ```

3. Make sure the PostgreSQL database referenced by `DB_NAME` exists (create it manually — this boilerplate does not create the database itself, only its tables).

4. Start the server:
   ```
   npm start
   ```
   or, with auto-reload during development:
   ```
   npm run dev
   ```

On startup, the app connects to PostgreSQL and calls `sequelize.sync({ alter: true })`, which creates or updates tables from the model definitions. For a production project, replace this with proper `sequelize-cli` migrations.

## API

Base path: `/api/items`

| Method | Path            | Description       |
|--------|-----------------|--------------------|
| GET    | /api/items      | List all items     |
| GET    | /api/items/:id  | Get a single item  |
| POST   | /api/items      | Create an item     |
| PUT    | /api/items/:id  | Update an item     |
| DELETE | /api/items/:id  | Delete an item     |

Example create request body:
```json
{ "name": "Sample item", "description": "Optional description" }
```

### Webhook delivery

| Method | Path                    | Description                                      |
|--------|-------------------------|---------------------------------------------------|
| POST   | /api/register-endpoint  | Register a URL and receive a one-time decryption key |
| GET    | /api/register-endpoint  | List all registered URLs                            |
| POST   | /api/deliver-event      | Queue encrypted delivery jobs for every registered URL |
| GET    | /api/deliveries         | Inspect queued/retrying/delivered/failed deliveries |

Register a URL:
```json
{ "url": "https://example.com/webhooks/receiver" }
```

Registration creates a unique encryption/decryption key pair for that endpoint. The app stores the encryption key with the endpoint and returns the decryption key only once:
```json
{
  "id": 1,
  "url": "https://example.com/webhooks/receiver",
  "decryption_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "message": "Save this decryption_key now. It will not be shown again."
}
```

Deliver an event (broadcast to all registered URLs — no per-link filtering yet). Variable fields can be sent either inside `payload` or directly beside `event_group` and `event_name`:
```json
{
  "event_group": "orders",
  "event_name": "order.created",
  "payload": { "orderId": 123, "amount": 499 }
}
```

Before delivery, the app builds the plain event payload with fixed fields and variable fields, then encrypts it separately for each registered endpoint:
```json
{
  "orderId": 123,
  "amount": 499,
  "event_group": "orders",
  "event_name": "order.created",
  "created_at": "2026-09-01T13:20:00.000Z",
  "current_version": 1
}
```

`POST /api/deliver-event` returns `202 Accepted` after creating one queued delivery row per registered endpoint:
```json
{
  "queued": 1,
  "deliveries": [
    {
      "id": "a4d4f7d5-9b14-4d2b-a79b-badccf44d4b3",
      "url": "https://example.com/webhooks/receiver",
      "status": "queued",
      "sequence": 1,
      "next_attempt_at": "2026-09-01T13:20:00.000Z"
    }
  ]
}
```

A worker picks due rows from PostgreSQL and each registered URL receives an HTTP POST with an encrypted envelope:
```json
{
  "id": "a4d4f7d5-9b14-4d2b-a79b-badccf44d4b3",
  "sequence": 1,
  "event_group": "orders",
  "event_name": "order.created",
  "created_at": "2026-09-01T13:20:00.000Z",
  "current_version": 1,
  "encrypted_payload": {
    "algorithm": "RSA-OAEP-SHA256/AES-256-GCM",
    "encrypted_key": "base64...",
    "iv": "base64...",
    "auth_tag": "base64...",
    "encrypted_payload": "base64..."
  }
}
```

Reliability behavior:
- The app stores delivery jobs in `webhook_deliveries`, so API acceptance and webhook sending are separated.
- The same delivery `id` is sent on every retry, so clients can dedupe repeated attempts.
- `sequence` starts at `1` and increments on each retry. Retry jitter is deterministic from the sequence, which avoids all failed deliveries retrying at the same millisecond.
- Workers claim rows with PostgreSQL row locks and `skip locked`, so two workers do not process the same due delivery at the same time.
- `2xx` marks a delivery as `delivered`.
- `400`, `401`, `403`, `404`, etc. are permanent client-side failures and are not retried.
- `408`, `429`, `5xx`, network errors, and timeouts are retried up to 5 attempts.
- If `shipment_time` is ever before `payload_created_at`, the worker marks the job `failed` with `shipment_time_before_payload_created_at` and does not send it. That protects against bad clock/data corruption cases.

### System design interview summary

- **API layer:** `/api/register-endpoint` registers webhook URLs and creates a per-client key pair. We store only the public encryption key and return the private decryption key once.
- **Security:** Before delivery, the payload is encrypted independently per endpoint using hybrid encryption: RSA-OAEP-SHA256 protects a random AES-256-GCM key, and AES-GCM encrypts the actual payload.
- **Queue:** `/api/deliver-event` does not call customer URLs directly. It writes durable delivery rows to Postgres and returns `202 Accepted`, which keeps the producer fast even if customers are slow.
- **Workers:** Background workers poll due rows and claim them using DB row locks with `skip locked`. This allows multiple workers without duplicate pickup.
- **Idempotency:** Every delivery has a stable `id` that is included in every outbound payload and every retry. Clients store that id to ignore duplicate deliveries.
- **Retry policy:** Retry only transient failures: `408`, `429`, `5xx`, network errors, and timeouts. Do not retry permanent `4xx` responses like bad request or unauthorized.
- **Backoff and jitter:** Retries use exponential backoff plus deterministic jitter from `sequence`, reducing retry pileups after outages.
- **Ordering/debugging:** `sequence`, `attempts`, `status`, `last_status_code`, and `last_error` make retries explainable and observable.
- **Fault handling:** Impossible timestamps, such as `shipment_time < payload_created_at`, are treated as data faults and marked failed instead of being sent.
- **Scalability path:** For higher scale, this design can move from Postgres polling to Kafka/SQS/RabbitMQ while keeping the same delivery id, retry policy, encryption, and worker semantics.
