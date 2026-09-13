const sequelize = require('../config/database');
const Item = require('./item.model');
const WebhookDelivery = require('./webhookDelivery.model');
const WebhookEndpoint = require('./webhookEndpoint.model');

WebhookEndpoint.hasMany(WebhookDelivery, {
  foreignKey: 'webhookEndpointId',
  as: 'deliveries',
});
WebhookDelivery.belongsTo(WebhookEndpoint, {
  foreignKey: 'webhookEndpointId',
  as: 'endpoint',
});

module.exports = {
  sequelize,
  Item,
  WebhookDelivery,
  WebhookEndpoint,
};
