const { randomUUID } = require('node:crypto');
const { Op } = require('sequelize');
const { sequelize, WebhookDelivery } = require('../models');
const { encryptPayloadForEndpoint } = require('./webhookCrypto.service');

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_LOCK_MS = 30000;
const DEFAULT_TIMEOUT_MS = 5000;
const RETRYABLE_4XX = new Set([408, 429]);

const shouldRetryDelivery = ({ statusCode, errorCode }) => {
  if (errorCode === 'TIMEOUT' || errorCode === 'NETWORK') return true;
  if (!statusCode) return false;
  if (RETRYABLE_4XX.has(statusCode)) return true;
  return statusCode >= 500;
};

const calculateRetryDelayMs = (attempt, sequence) => {
  const baseDelay = 1000 * 2 ** Math.max(attempt - 1, 0);
  const jitter = (sequence * 997) % 1000;
  return Math.min(baseDelay + jitter, 60000);
};

const hasShipmentTimeFault = ({ shipmentTime, payloadCreatedAt }) =>
  new Date(shipmentTime).getTime() < new Date(payloadCreatedAt).getTime();

const buildDeliveryRequestBody = ({ id, eventPayload, encryptedPayload, sequence }) => ({
  id,
  sequence,
  event_group: eventPayload.event_group,
  event_name: eventPayload.event_name,
  created_at: eventPayload.created_at,
  current_version: eventPayload.current_version,
  encrypted_payload: encryptedPayload,
});

const enqueueDeliveries = async ({ endpoints, eventPayload }) => {
  const now = new Date();
  const deliveries = endpoints.map((endpoint) => {
    const id = randomUUID();
    const sequence = 1;
    const encryptedPayload = encryptPayloadForEndpoint(eventPayload, endpoint.encryptionKey);
    const requestBody = buildDeliveryRequestBody({ id, eventPayload, encryptedPayload, sequence });

    return {
      id,
      webhookEndpointId: endpoint.id,
      url: endpoint.url,
      eventGroup: eventPayload.event_group,
      eventName: eventPayload.event_name,
      requestBody,
      payloadCreatedAt: new Date(eventPayload.created_at),
      shipmentTime: now,
      nextAttemptAt: now,
      sequence,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
    };
  });

  return WebhookDelivery.bulkCreate(deliveries, { returning: true });
};

const claimDueDeliveries = async ({ workerId, batchSize = DEFAULT_BATCH_SIZE, lockMs = DEFAULT_LOCK_MS } = {}) =>
  sequelize.transaction(async (transaction) => {
    const now = new Date();
    const deliveries = await WebhookDelivery.findAll({
      where: {
        status: ['queued', 'retrying'],
        nextAttemptAt: { [Op.lte]: now },
        [Op.or]: [{ lockedUntil: null }, { lockedUntil: { [Op.lt]: now } }],
      },
      order: [['nextAttemptAt', 'ASC']],
      limit: batchSize,
      lock: transaction.LOCK.UPDATE,
      skipLocked: true,
      transaction,
    });

    const lockedUntil = new Date(Date.now() + lockMs);
    await Promise.all(
      deliveries.map((delivery) =>
        delivery.update(
          {
            status: 'in_progress',
            lockedBy: workerId,
            lockedUntil,
          },
          { transaction }
        )
      )
    );

    return deliveries;
  });

const markDeliveryForRetry = async (delivery, { statusCode, errorMessage }) => {
  const attempts = delivery.attempts + 1;
  const sequence = delivery.sequence + 1;

  if (attempts >= delivery.maxAttempts) {
    await delivery.update({
      attempts,
      sequence,
      status: 'dead',
      lockedBy: null,
      lockedUntil: null,
      lastStatusCode: statusCode || null,
      lastError: errorMessage,
    });
    return;
  }

  const nextAttemptAt = new Date(Date.now() + calculateRetryDelayMs(attempts, sequence));
  await delivery.update({
    attempts,
    sequence,
    status: 'retrying',
    nextAttemptAt,
    shipmentTime: nextAttemptAt,
    lockedBy: null,
    lockedUntil: null,
    lastStatusCode: statusCode || null,
    lastError: errorMessage,
    requestBody: {
      ...delivery.requestBody,
      sequence,
    },
  });
};

const finishDelivery = async (delivery, response) => {
  const attempts = delivery.attempts + 1;
  if (response.ok) {
    await delivery.update({
      attempts,
      status: 'delivered',
      deliveredAt: new Date(),
      lockedBy: null,
      lockedUntil: null,
      lastStatusCode: response.status,
      lastError: null,
    });
    return;
  }

  if (shouldRetryDelivery({ statusCode: response.status })) {
    await markDeliveryForRetry(delivery, {
      statusCode: response.status,
      errorMessage: `retryable status ${response.status}`,
    });
    return;
  }

  await delivery.update({
    attempts,
    status: 'failed',
    lockedBy: null,
    lockedUntil: null,
    lastStatusCode: response.status,
    lastError: `non-retryable status ${response.status}`,
  });
};

const sendDelivery = async (delivery, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  if (hasShipmentTimeFault(delivery)) {
    await delivery.update({
      status: 'failed',
      lockedBy: null,
      lockedUntil: null,
      lastError: 'shipment_time_before_payload_created_at',
    });
    return;
  }

  try {
    const response = await fetch(delivery.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(delivery.requestBody),
      signal: AbortSignal.timeout(timeoutMs),
    });
    await finishDelivery(delivery, response);
  } catch (err) {
    const errorCode = err.name === 'TimeoutError' || err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK';
    if (shouldRetryDelivery({ errorCode })) {
      await markDeliveryForRetry(delivery, {
        errorMessage: err.message,
      });
      return;
    }
    await delivery.update({
      attempts: delivery.attempts + 1,
      status: 'failed',
      lockedBy: null,
      lockedUntil: null,
      lastError: err.message,
    });
  }
};

const processDueDeliveries = async ({ workerId, batchSize, lockMs, timeoutMs } = {}) => {
  const deliveries = await claimDueDeliveries({
    workerId: workerId || `worker-${process.pid}`,
    batchSize,
    lockMs,
  });
  await Promise.all(deliveries.map((delivery) => sendDelivery(delivery, { timeoutMs })));
  return deliveries.length;
};

const startWebhookWorker = ({ intervalMs = 5000, workerId = `worker-${process.pid}` } = {}) => {
  const timer = setInterval(() => {
    processDueDeliveries({ workerId }).catch((err) => {
      console.error('Webhook worker failed:', err);
    });
  }, intervalMs);

  return timer;
};

module.exports = {
  buildDeliveryRequestBody,
  calculateRetryDelayMs,
  claimDueDeliveries,
  enqueueDeliveries,
  hasShipmentTimeFault,
  processDueDeliveries,
  shouldRetryDelivery,
  startWebhookWorker,
};
