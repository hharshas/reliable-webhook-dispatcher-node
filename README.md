# Reliable Webhook Dispatcher

A simple Node.js project that shows how to build a reliable webhook delivery system.

This project includes:

- webhook registration
- encrypted payload delivery
- Postgres-backed queue (This is for the project only, for prod - SQS or Kafka is preferred - better for delayed message)
- background worker pickup (cron-like polling worker)
- retry handling
- idempotency using delivery ids
- jitter using sequence numbers
- basic delivery observability

## Tech Stack

- Node.js
- Express.js
- PostgreSQL
- Sequelize ORM
- Node.js `crypto`
- Node.js built-in test runner
- Postman collection for local testing

## Project Name

Recommended project/repo name:

```txt
reliable-webhook-dispatcher-node
```

Why this name:

- it is clear
- it is resume friendly
- it explains the main system design idea
- it is more specific than just `webhook-dispatcher`

## How It Works

Clients register their webhook URL using:

```txt
POST /api/register-endpoint
```

The app creates two keys:

- an encryption key, stored in our database
- a decryption key, returned to the client only once

When an event is delivered, the app does not directly call all client webhook URLs inside the API request.

Instead:

1. `/api/deliver-event` creates one queue row per registered webhook.
2. The queue row is stored in PostgreSQL in `webhook_deliveries`.
3. A background worker picks due rows from the queue.
4. The worker sends the encrypted payload to the client webhook URL.
5. The worker updates the delivery status.
6. Failed temporary deliveries are retried with backoff and jitter.

## Why Queue + Worker?

Direct webhook sending is risky because one slow or failing client can slow down the API.

Queue + worker is better because:

- the API responds quickly with `202 Accepted`
- deliveries are stored safely in PostgreSQL
- failed deliveries can be retried
- multiple workers can process jobs
- row locking prevents duplicate pickup
- clients can dedupe retries using the delivery `id`

## Setup

Install dependencies:

```bash
npm install
```

Create a `.env` file:

```bash
cp env.sample .env
```

For local Homebrew PostgreSQL on this machine, `.env` should look like:

```env
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=node_mvc_db
DB_USER=harsh.singh
DB_PASSWORD=
```

Make sure PostgreSQL is running:

```bash
/opt/homebrew/opt/postgresql@16/bin/pg_ctl -D /opt/homebrew/var/postgresql@16 start
```

Create the database if it does not exist:

```bash
createdb node_mvc_db
```

Run tests:

```bash
npm test
```

Start the app:

```bash
npm run dev
```

The app runs on:

```txt
http://localhost:3000
```

## Test With Postman

Import this file into Postman:

```txt
postman/reliable-webhook-dispatcher.postman_collection.json
```

The collection uses this variable:

```txt
baseUrl = http://localhost:3000
```

The collection includes:

- health check
- register webhook endpoint
- list registered endpoints
- queue webhook event
- list delivery jobs

## Test With A Local Webhook Receiver

Start this fake client webhook receiver in another terminal:

```bash
node -e "require('http').createServer((req,res)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{console.log(JSON.parse(b));res.end('ok')})}).listen(4000)"
```

Register the local receiver:

```bash
curl -X POST http://localhost:3000/api/register-endpoint \
  -H "Content-Type: application/json" \
  -d '{"url":"http://localhost:4000/hook"}'
```

Save the returned `decryption_key`. It is shown only once.

Queue an event:

```bash
curl -X POST http://localhost:3000/api/deliver-event \
  -H "Content-Type: application/json" \
  -d '{"event_group":"orders","event_name":"order.created","payload":{"orderId":123,"amount":499}}'
```

Check delivery status:

```bash
curl http://localhost:3000/api/deliveries
```

The worker runs automatically with the app and sends queued deliveries in the background.

## API Endpoints

### Health Check

```txt
GET /
```

Checks whether the app is running.

### Register Webhook Endpoint

```txt
POST /api/register-endpoint
```

Request:

```json
{
  "url": "http://localhost:4000/hook"
}
```

Response:

```json
{
  "id": 1,
  "url": "http://localhost:4000/hook",
  "decryption_key": "-----BEGIN PRIVATE KEY-----...",
  "message": "Save this decryption_key now. It will not be shown again."
}
```

### List Registered Endpoints

```txt
GET /api/register-endpoint
```

Returns registered webhook URLs without exposing stored encryption keys.

### Queue Event Delivery

```txt
POST /api/deliver-event
```

Request:

```json
{
  "event_group": "orders",
  "event_name": "order.created",
  "payload": {
    "orderId": 123,
    "amount": 499
  }
}
```

Response:

```json
{
  "queued": 1,
  "deliveries": [
    {
      "id": "delivery-uuid",
      "url": "http://localhost:4000/hook",
      "status": "queued",
      "sequence": 1,
      "next_attempt_at": "2026-09-13T00:00:00.000Z"
    }
  ]
}
```

### List Delivery Jobs

```txt
GET /api/deliveries
```

Shows delivery jobs and their current state:

- `queued`
- `in_progress`
- `retrying`
- `delivered`
- `failed`
- `dead`

## Outbound Webhook Payload

The client receives this payload:

```json
{
  "id": "delivery-uuid",
  "sequence": 1,
  "event_group": "orders",
  "event_name": "order.created",
  "created_at": "2026-09-13T00:00:00.000Z",
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

The real event data is inside `encrypted_payload`.

The client decrypts it using the `decryption_key` received during registration.

## Retry Rules

The worker retries temporary failures:

- `408`
- `429`
- `5xx`
- network errors
- timeouts

The worker does not retry permanent client errors:

- `400`
- `401`
- `403`
- `404`

Retries use exponential backoff plus deterministic jitter from `sequence`.
