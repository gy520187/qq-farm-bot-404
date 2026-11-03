const { getAutomation } = require('../models/store');
const { getItemById } = require('../config/gameConfig');
const { log, toNum } = require('../utils/utils');
const warehouse = require('./warehouse');

// 藏品礼包物品 ID：101618 钻石藏品礼包、101619 金豆豆藏品礼包。
// 购买后需在背包中“开启”才能获得藏品、催化剂、种子礼包与金币。
const COLLECTION_GIFT_ITEM_IDS = [101618, 101619];

// 自动开启检查间隔：10 分钟（与自动购买保持一致）
const COLLECTION_GIFT_OPEN_INTERVAL_MS = 10 * 60 * 1000;

/**
 * 从背包物品中提取藏品礼包的开具负载（物品 ID -> 数量）。
 * 纯函数，便于测试。
 * @param {Array} items 背包物品列表（BagReply 解码后的 items）
 */
function getCollectionGiftOpenPayloads(items) {
  const map = new Map();
  for (const item of items || []) {
    const id = toNum(item && item.id);
    const count = Math.max(0, toNum(item && item.count));
    if (id <= 0 || count <= 0) continue;
    if (COLLECTION_GIFT_ITEM_IDS.includes(id)) map.set(id, (map.get(id) || 0) + count);
  }
  return Array.from(map.entries()).map(([id, count]) => ({ id, count }));
}

function createCollectionGiftOpener({
  getAutomation,
  getBagItems,
  useItems,
  report,
  now = Date.now,
}) {
  let busy = false;
  let lastCheck = -Infinity;

  return async function autoOpenCollectionGifts(force = false) {
    if (busy || getAutomation().collection_gift_open !== true || (!force && now() - lastCheck < COLLECTION_GIFT_OPEN_INTERVAL_MS)) {
      return 0;
    }
    busy = true;
    lastCheck = now();
    let opened = 0;
    try {
      const items = await getBagItems();
      const payloads = getCollectionGiftOpenPayloads(items);
      for (const payload of payloads) {
        if (getAutomation().collection_gift_open !== true) break;
        await useItems([{ itemId: payload.id, count: payload.count, uid: 0 }]);
        const info = getItemById(payload.id);
        const label = info && info.name ? String(info.name) : `物品#${payload.id}`;
        opened += payload.count;
        report(`自动开启藏品礼包：${label} x${payload.count}`, 'success');
      }
    } catch (error) {
      report(`自动开启藏品礼包失败：${error.message}`, 'error');
    } finally {
      busy = false;
    }
    return opened;
  };
}

const autoOpenCollectionGifts = createCollectionGiftOpener({
  getAutomation,
  getBagItems: async () => {
    const bag = await warehouse.getBag();
    return warehouse.getBagItems(bag);
  },
  useItems: warehouse.batchUseItems,
  report: (message, result) => log('仓库', message, { module: 'warehouse', event: '藏品礼包自动开启', result }),
});

module.exports = {
  COLLECTION_GIFT_ITEM_IDS,
  COLLECTION_GIFT_OPEN_INTERVAL_MS,
  getCollectionGiftOpenPayloads,
  createCollectionGiftOpener,
  autoOpenCollectionGifts,
};