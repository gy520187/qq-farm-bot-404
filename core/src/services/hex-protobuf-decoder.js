/**
 * 通用 Protobuf HEX 解码器
 *
 * 不依赖 proto 定义文件，按数字索引递归解析二进制消息：
 * - 支持 Varint（wire type 0，含 10 字节负数编码）
 * - 支持 64-bit / 32-bit 定长（wire type 1 / 5）
 * - 支持 Length-delimited（wire type 2），自动识别 UTF-8 文本或嵌套子消息
 * - 字段以数字索引显示，与在线解码工具行为一致
 *
 * 好友 GID 提取规则（与在线工具一致）：
 * 当消息中出现字符串 "gamepb.friendpb.FriendService" 时，定位
 * gatepb.Message 的 body（顶层字段 2），在 body 中取字段 1（repeated
 * GameFriend），每个元素的字段 1 即好友 GID。
 */

const FRIEND_SERVICE = 'gamepb.friendpb.FriendService';

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_FIXED32 = 5;

/**
 * 读取一个 Varint（LEB128，最多 10 字节）。
 * @param {Buffer} buffer
 * @param {number} offset
 * @returns {{ value: bigint, bytesRead: number }}
 */
function readVarint(buffer, offset) {
  let result = 0n;
  let shift = 0n;
  let bytesRead = 0;
  while (offset < buffer.length && bytesRead < 10) {
    const byte = buffer[offset];
    offset += 1;
    bytesRead += 1;
    result |= BigInt(byte & 0x7F) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7n;
  }
  return { value: result, bytesRead };
}

/**
 * 将 Varint 解码结果规范化为 number / bigint。
 * 10 字节且最高位符号位为 1 时按负数补码解释。
 */
function normalizeVarint(raw, bytesRead) {
  if (bytesRead >= 10 && raw >= (1n << 63n)) {
    const signed = raw - (1n << 64n);
    return signed >= BigInt(Number.MIN_SAFE_INTEGER) && signed <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(signed)
      : signed;
  }
  return raw <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(raw) : raw;
}

function isPrintableText(buffer) {
  if (!buffer || buffer.length === 0) return false;
  for (const byte of buffer) {
    if (byte === 0x09 || byte === 0x0A || byte === 0x0D) continue;
    if (byte < 0x20 || byte === 0x7F) return false;
  }
  return true;
}

/**
 * 尝试将 length-delimited 内容解释为嵌套消息。
 * 若递归解码得到至少一个字段则返回字段数组，否则返回 null。
 */
function tryDecodeAsMessage(bytes) {
  try {
    const fields = decodeFields(bytes, 1);
    return fields.length > 0 ? fields : null;
  } catch {
    return null;
  }
}

/**
 * 递归解码一段 protobuf 二进制为字段树。
 * @param {Buffer} buffer
 * @param {number} [depth] 递归深度，防止畸形数据无限递归
 * @returns {Array<{ fieldNumber: number, wireType: number, value: any }>}
 */
function decodeFields(buffer, depth = 0) {
  if (!buffer || buffer.length === 0 || depth > 16) return [];
  const fields = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    const tag = readVarint(buffer, offset);
    offset += tag.bytesRead;
    const fieldNumber = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 7n);
    if (fieldNumber === 0) break;

    if (wireType === WIRE_VARINT) {
      const raw = readVarint(buffer, offset);
      offset += raw.bytesRead;
      fields.push({ fieldNumber, wireType, value: normalizeVarint(raw.value, raw.bytesRead) });
    } else if (wireType === WIRE_FIXED64) {
      if (offset + 8 > buffer.length) break;
      fields.push({ fieldNumber, wireType, value: buffer.readBigUInt64LE(offset) });
      offset += 8;
    } else if (wireType === WIRE_LENGTH_DELIMITED) {
      const len = readVarint(buffer, offset);
      offset += len.bytesRead;
      const length = Number(len.value);
      if (length < 0 || offset + length > buffer.length) break;
      const bytes = buffer.subarray(offset, offset + length);
      offset += length;

      let value;
      if (isPrintableText(bytes)) {
        value = bytes.toString('utf8');
      } else {
        const nested = tryDecodeAsMessage(bytes);
        if (nested) {
          value = nested;
        } else {
          value = bytes.toString('hex');
        }
      }
      fields.push({ fieldNumber, wireType, value });
    } else if (wireType === WIRE_FIXED32) {
      if (offset + 4 > buffer.length) break;
      fields.push({ fieldNumber, wireType, value: buffer.readUInt32LE(offset) });
      offset += 4;
    } else {
      // wire type 3/4（group）不支持，停止解析避免误判
      break;
    }

    if (offset <= start) break;
  }
  return fields;
}

/**
 * 将用户输入的 HEX 文本规范化为 Buffer。
 * 支持空格、换行、逗号与 "0x" 前缀混排。
 */
function hexToBuffer(hex) {
  const text = String(hex || '').trim();
  if (!text) return null;
  const cleaned = text.replace(/0x/gi, '').replace(/[^0-9a-fA-F]/g, '');
  if (cleaned.length === 0 || cleaned.length % 2 !== 0) return null;
  return Buffer.from(cleaned, 'hex');
}

/**
 * 将解码值转换为安全的正整数，非安全整数返回 null。
 */
function toSafeNumber(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? value : null;
  }
  if (typeof value === 'bigint') {
    if (value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  }
  return null;
}

/**
 * 在字段树中递归查找指定的字符串值。
 */
function hasStringValue(fields, target) {
  if (!Array.isArray(fields)) return false;
  for (const field of fields) {
    if (field.value === target) return true;
    if (Array.isArray(field.value) && hasStringValue(field.value, target)) return true;
  }
  return false;
}

/**
 * 从一条消息字段树中提取好友 GID：
 * 取字段 1（repeated GameFriend）中每个元素的字段 1 正整数值。
 */
function extractGidsFromMessage(fields) {
  if (!Array.isArray(fields)) return [];
  const gids = [];
  for (const field of fields) {
    if (field.fieldNumber !== 1 || !Array.isArray(field.value)) continue;
    for (const item of field.value) {
      if (!item || item.fieldNumber !== 1) continue;
      const gid = toSafeNumber(item.value);
      if (gid !== null && gid > 0 && !gids.includes(gid)) gids.push(gid);
    }
  }
  return gids;
}

/**
 * 从 HEX 原始数据中提取好友 GID。
 * @param {string} hex
 * @returns {{ gids: number[], source: string, fields: Array, message?: string }}
 */
function extractFriendGidsFromHex(hex) {
  const buffer = hexToBuffer(hex);
  if (!buffer || buffer.length === 0) {
    return { gids: [], source: '', fields: [], message: 'HEX 数据无效' };
  }

  const fields = decodeFields(buffer);
  const hasFriendService = hasStringValue(fields, FRIEND_SERVICE);

  let gids = [];
  // 路径 1：gatepb.Message 形态，body 在顶层字段 2
  if (hasFriendService) {
    for (const field of fields) {
      if (field.fieldNumber === 2 && Array.isArray(field.value)) {
        gids = extractGidsFromMessage(field.value);
        if (gids.length > 0) break;
      }
    }
  }
  // 路径 2：裸回复体形态，字段 1 即为 repeated GameFriend
  if (gids.length === 0) {
    gids = extractGidsFromMessage(fields);
  }

  return {
    gids,
    source: hasFriendService ? FRIEND_SERVICE : '',
    fields,
    message: gids.length > 0
      ? (hasFriendService ? '' : '未检测到 FriendService 标识，已按裸回复体提取')
      : (hasFriendService ? '已识别 FriendService，但未提取到有效 GID' : '未提取到有效 GID'),
  };
}

module.exports = {
  FRIEND_SERVICE,
  decodeFields,
  extractFriendGidsFromHex,
  hexToBuffer,
  readVarint,
};