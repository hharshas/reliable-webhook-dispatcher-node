const { WebhookDelivery, WebhookEndpoint } = require('../models');
const {
  buildEventPayload,
  generateEndpointKeyPair,
} = require('../services/webhookCrypto.service');
const { enqueueDeliveries } = require('../services/webhookQueue.service');

// POST /api/register-endpoint
exports.registerEndpoint = async (req, res, next) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ message: 'url is required' });
    }
    const { encryptionKey, decryptionKey } = generateEndpointKeyPair();
    const endpoint = await WebhookEndpoint.create({ url, encryptionKey });

    res.status(201).json({
      id: endpoint.id,
      url: endpoint.url,
      decryption_key: decryptionKey,
      message: 'Save this decryption_key now. It will not be shown again.',
    });
  } catch (err) {
    if (err.name === 'SequelizeValidationError') {
      return res.status(400).json({ message: 'url must be a valid URL' });
    }
    next(err);
  }
};

// GET /api/register-endpoint
exports.listEndpoints = async (req, res, next) => {
  try {
    const endpoints = await WebhookEndpoint.findAll({
      attributes: ['id', 'url', 'createdAt', 'updatedAt'],
    });
    res.json(endpoints);
  } catch (err) {
    next(err);
  }
};

// POST /api/deliver-event
exports.deliverEvent = async (req, res, next) => {
  try {
    const { event_group, event_name } = req.body;
    if (!event_group || !event_name) {
      return res.status(400).json({ message: 'event_group and event_name are required' });
    }

    const endpoints = await WebhookEndpoint.findAll();
    const eventPayload = buildEventPayload(req.body);
    const deliveries = await enqueueDeliveries({ endpoints, eventPayload });

    res.status(202).json({
      queued: deliveries.length,
      deliveries: deliveries.map((delivery) => ({
        id: delivery.id,
        url: delivery.url,
        status: delivery.status,
        sequence: delivery.sequence,
        next_attempt_at: delivery.nextAttemptAt,
      })),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/deliveries
exports.listDeliveries = async (req, res, next) => {
  try {
    const deliveries = await WebhookDelivery.findAll({
      attributes: [
        'id',
        'url',
        'eventGroup',
        'eventName',
        'status',
        'attempts',
        'sequence',
        'nextAttemptAt',
        'lastStatusCode',
        'lastError',
        'deliveredAt',
        'createdAt',
      ],
      order: [['createdAt', 'DESC']],
    });
    res.json(deliveries);
  } catch (err) {
    next(err);
  }
};
