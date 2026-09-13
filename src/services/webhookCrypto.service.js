const {
  constants,
  createCipheriv,
  generateKeyPairSync,
  publicEncrypt,
  randomBytes,
} = require('node:crypto');

const KEY_PAIR_OPTIONS = {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem',
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
  },
};

const RSA_ENCRYPTION_OPTIONS = {
  oaepHash: 'sha256',
  padding: constants.RSA_PKCS1_OAEP_PADDING,
};

const buildEventPayload = (body) => {
  const { event_group, event_name, payload, ...variableFields } = body;
  const hasPayload = Object.prototype.hasOwnProperty.call(body, 'payload');
  const nestedPayload =
    hasPayload && payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const primitivePayload =
    hasPayload && Object.keys(nestedPayload).length === 0 ? { payload } : {};

  return {
    ...variableFields,
    ...nestedPayload,
    ...primitivePayload,
    event_group,
    event_name,
    created_at: new Date().toISOString(),
    current_version: 1,
  };
};

const generateEndpointKeyPair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', KEY_PAIR_OPTIONS);

  return {
    encryptionKey: publicKey,
    decryptionKey: privateKey,
  };
};

const encryptPayloadForEndpoint = (payload, encryptionKey) => {
  const aesKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
  const encryptedPayload = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);

  return {
    algorithm: 'RSA-OAEP-SHA256/AES-256-GCM',
    encrypted_key: publicEncrypt(
      {
        key: encryptionKey,
        ...RSA_ENCRYPTION_OPTIONS,
      },
      aesKey
    ).toString('base64'),
    iv: iv.toString('base64'),
    auth_tag: cipher.getAuthTag().toString('base64'),
    encrypted_payload: encryptedPayload.toString('base64'),
  };
};

module.exports = {
  buildEventPayload,
  encryptPayloadForEndpoint,
  generateEndpointKeyPair,
};
