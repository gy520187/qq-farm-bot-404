const test = require('node:test');
const assert = require('node:assert/strict');

const {
  decodeFields,
  extractFriendGidsFromHex,
  hexToBuffer,
  readVarint,
} = require('../src/services/hex-protobuf-decoder');

function encodeVarint(value) {
  const bytes = [];
  let v = BigInt(value);
  while (v > 0x7Fn) {
    bytes.push(Number((v & 0x7Fn) | 0x80n));
    v >>= 7n;
  }
  bytes.push(Number(v));
  return Buffer.from(bytes);
}

function fieldVarint(fieldNumber, value) {
  const tag = Buffer.from([(fieldNumber << 3) | 0]);
  return Buffer.concat([tag, encodeVarint(value)]);
}

function fieldBytes(fieldNumber, content) {
  const tag = Buffer.from([(fieldNumber << 3) | 2]);
  const len = encodeVarint(content.length);
  return Buffer.concat([tag, len, content]);
}

function fieldString(fieldNumber, text) {
  return fieldBytes(fieldNumber, Buffer.from(text, 'utf8'));
}

function encodeGameFriend(gid) {
  const gidField = fieldVarint(1, gid);
  return fieldBytes(1, gidField);
}

function encodeFriendReply(gids) {
  return Buffer.concat(gids.map(gid => encodeGameFriend(gid)));
}

function encodeGateMessage(serviceName, methodName, body) {
  const meta = Buffer.concat([
    fieldString(1, serviceName),
    fieldString(2, methodName),
    fieldVarint(3, 2),
  ]);
  return Buffer.concat([fieldBytes(1, meta), fieldBytes(2, body)]);
}

test('readVarint decodes multi-byte values', () => {
  const buf = Buffer.from([0xE8, 0x07]);
  const result = readVarint(buf, 0);
  assert.equal(Number(result.value), 1000);
  assert.equal(result.bytesRead, 2);
});

test('decodeFields parses varint, string and nested message', () => {
  const buf = Buffer.concat([
    fieldString(1, 'gamepb.friendpb.FriendService'),
    fieldVarint(2, 300),
  ]);
  const fields = decodeFields(buf);
  assert.equal(fields.length, 2);
  assert.equal(fields[0].fieldNumber, 1);
  assert.equal(fields[0].value, 'gamepb.friendpb.FriendService');
  assert.equal(fields[1].fieldNumber, 2);
  assert.equal(fields[1].value, 300);
});

test('decodeFields treats binary length-delimited as nested message', () => {
  const inner = fieldVarint(1, 42);
  const outer = fieldBytes(3, inner);
  const fields = decodeFields(outer);
  assert.equal(fields.length, 1);
  assert.equal(fields[0].fieldNumber, 3);
  assert.ok(Array.isArray(fields[0].value));
  assert.equal(fields[0].value[0].fieldNumber, 1);
  assert.equal(fields[0].value[0].value, 42);
});

test('hexToBuffer normalizes spaces, newlines and 0x prefixes', () => {
  const buf = hexToBuffer('0x0A 0x05\n68656c6c6f');
  assert.ok(buf);
  assert.equal(buf.toString('hex'), '0a0568656c6c6f');
  assert.equal(hexToBuffer('zz'), null);
  assert.equal(hexToBuffer(''), null);
});

test('extracts gids from gatepb.Message hex', () => {
  const message = encodeGateMessage(
    'gamepb.friendpb.FriendService',
    'GetAll',
    encodeFriendReply([10001, 10002, 10003]),
  );
  const result = extractFriendGidsFromHex(message.toString('hex'));
  assert.deepEqual(result.gids, [10001, 10002, 10003]);
  assert.equal(result.source, 'gamepb.friendpb.FriendService');
});

test('extracts gids from bare reply body hex', () => {
  const reply = encodeFriendReply([90001, 90002]);
  const result = extractFriendGidsFromHex(reply.toString('hex'));
  assert.deepEqual(result.gids, [90001, 90002]);
});

test('extracts gids from SyncAll reply with method name', () => {
  const message = encodeGateMessage(
    'gamepb.friendpb.FriendService',
    'SyncAll',
    encodeFriendReply([70001]),
  );
  const result = extractFriendGidsFromHex(message.toString('hex'));
  assert.deepEqual(result.gids, [70001]);
});

test('deduplicates gids', () => {
  const message = encodeGateMessage(
    'gamepb.friendpb.FriendService',
    'GetAll',
    encodeFriendReply([10001, 10001, 10002]),
  );
  const result = extractFriendGidsFromHex(message.toString('hex'));
  assert.deepEqual(result.gids, [10001, 10002]);
});

test('filters zero and negative gids', () => {
  const message = encodeGateMessage(
    'gamepb.friendpb.FriendService',
    'GetAll',
    encodeFriendReply([0, 10001]),
  );
  const result = extractFriendGidsFromHex(message.toString('hex'));
  assert.deepEqual(result.gids, [10001]);
});

test('returns empty for unrelated service', () => {
  const message = encodeGateMessage(
    'gamepb.plantpb.PlantService',
    'AllLands',
    Buffer.from([0x08, 0x01]),
  );
  const result = extractFriendGidsFromHex(message.toString('hex'));
  assert.deepEqual(result.gids, []);
  assert.equal(result.source, '');
});

test('returns empty for invalid hex', () => {
  const result = extractFriendGidsFromHex('zzzz');
  assert.deepEqual(result.gids, []);
  assert.ok(result.message);
});

test('returns empty for empty input', () => {
  const result = extractFriendGidsFromHex('');
  assert.deepEqual(result.gids, []);
  assert.ok(result.message);
});