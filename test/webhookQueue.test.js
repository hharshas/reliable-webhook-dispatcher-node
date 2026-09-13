const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildDeliveryRequestBody,
  calculateRetryDelayMs,
  hasShipmentTimeFault,
  shouldRetryDelivery,
} = require('../src/services/webhookQueue.service');

test('shouldRetryDelivery retries transient statuses and timeout failures only', () => {
  assert.equal(shouldRetryDelivery({ statusCode: 400 }), false);
  assert.equal(shouldRetryDelivery({ statusCode: 404 }), false);
  assert.equal(shouldRetryDelivery({ statusCode: 408 }), true);
  assert.equal(shouldRetryDelivery({ statusCode: 429 }), true);
  assert.equal(shouldRetryDelivery({ statusCode: 500 }), true);
  assert.equal(shouldRetryDelivery({ statusCode: 503 }), true);
  assert.equal(shouldRetryDelivery({ errorCode: 'TIMEOUT' }), true);
});

test('calculateRetryDelayMs keeps jitter deterministic by sequence', () => {
  assert.equal(calculateRetryDelayMs(1, 7), calculateRetryDelayMs(1, 7));
  assert.notEqual(calculateRetryDelayMs(1, 7), calculateRetryDelayMs(1, 8));
  assert.ok(calculateRetryDelayMs(2, 7) > calculateRetryDelayMs(1, 7));
});

test('buildDeliveryRequestBody includes stable id and sequence metadata', () => {
  const body = buildDeliveryRequestBody({
    id: 'delivery-123',
    eventPayload: {
      event_group: 'orders',
      event_name: 'order.created',
      created_at: '2026-09-12T06:00:00.000Z',
      current_version: 1,
    },
    encryptedPayload: { algorithm: 'test' },
    sequence: 3,
  });

  assert.equal(body.id, 'delivery-123');
  assert.equal(body.sequence, 3);
  assert.equal(body.event_group, 'orders');
  assert.equal(body.event_name, 'order.created');
  assert.deepEqual(body.encrypted_payload, { algorithm: 'test' });
});

test('hasShipmentTimeFault rejects shipment time before payload creation time', () => {
  assert.equal(
    hasShipmentTimeFault({
      shipmentTime: new Date('2026-09-12T05:59:59.000Z'),
      payloadCreatedAt: new Date('2026-09-12T06:00:00.000Z'),
    }),
    true
  );
  assert.equal(
    hasShipmentTimeFault({
      shipmentTime: new Date('2026-09-12T06:00:00.000Z'),
      payloadCreatedAt: new Date('2026-09-12T06:00:00.000Z'),
    }),
    false
  );
});
