const assert = require('node:assert/strict');
const { constants, createDecipheriv, privateDecrypt } = require('node:crypto');
const test = require('node:test');

const {
  buildEventPayload,
  encryptPayloadForEndpoint,
  generateEndpointKeyPair,
} = require('../src/services/webhookCrypto.service');

test('buildEventPayload preserves variable fields while fixed fields win', () => {
  const payload = buildEventPayload({
    event_group: 'billing',
    event_name: 'invoice.created',
    created_at: 'client-created-at',
    current_version: 999,
    customerId: 'cus_123',
    payload: {
      amount: 499,
      created_at: 'nested-client-created-at',
    },
  });

  assert.equal(payload.event_group, 'billing');
  assert.equal(payload.event_name, 'invoice.created');
  assert.equal(payload.current_version, 1);
  assert.match(payload.created_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(payload.customerId, 'cus_123');
  assert.equal(payload.amount, 499);
});

test('encryptPayloadForEndpoint encrypts a payload that only the matching decryption key can open', () => {
  const firstKeys = generateEndpointKeyPair();
  const secondKeys = generateEndpointKeyPair();
  const payload = {
    accountId: 'acct_123',
    amount: 499,
    event_group: 'billing',
    event_name: 'invoice.created',
    created_at: '2026-09-01T13:45:00.000Z',
    current_version: 1,
  };

  const encrypted = encryptPayloadForEndpoint(payload, firstKeys.encryptionKey);
  const openedAesKey = privateDecrypt(
    {
      key: firstKeys.decryptionKey,
      oaepHash: 'sha256',
      padding: constants.RSA_PKCS1_OAEP_PADDING,
    },
    Buffer.from(encrypted.encrypted_key, 'base64')
  );
  const decipher = createDecipheriv(
    'aes-256-gcm',
    openedAesKey,
    Buffer.from(encrypted.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(encrypted.auth_tag, 'base64'));
  const decryptedPayload = JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(encrypted.encrypted_payload, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  );

  assert.equal(encrypted.algorithm, 'RSA-OAEP-SHA256/AES-256-GCM');
  assert.equal(Buffer.byteLength(openedAesKey), 32);
  assert.deepEqual(decryptedPayload, payload);
  assert.throws(
    () =>
      privateDecrypt(
        {
          key: secondKeys.decryptionKey,
          oaepHash: 'sha256',
          padding: constants.RSA_PKCS1_OAEP_PADDING,
        },
        Buffer.from(encrypted.encrypted_key, 'base64')
      )
  );
});
