const { getAutomation } = require('../models/store');
const { getUserState } = require('../utils/network');
const { log, toNum } = require('../utils/utils');
const mall = require('./mall');

// 限时商店藏品礼包商品 ID：1047 钻石藏品礼包、1048 金豆豆藏品礼包。
const COLLECTION_GIFT_GOODS_IDS = [1047, 1048];

// 藏品礼包每周限购 50 个，钻石/金豆豆是稀缺资源。
// 每轮自动购买把本周剩余额度一次买完；余额不足以买满剩余额度时整轮跳过，
// 避免部分购买造成频繁小额消耗。
const COLLECTION_GIFT_CHECK_INTERVAL_MS = 10 * 60 * 1000;

// 余额字段映射：货币 ID -> getUserState 字段
const COLLECTION_GIFT_BALANCE_KEYS = {
  1004: 'diamond',
  1005: 'goldBean',
};

/**
 * 判断商品是否可自动购买，返回本次购买数量（0 表示跳过）。
 * 每周限购数量由服务端 limit 字段返回；返回值为本周剩余额度，
 * 余额不足以买满剩余额度时整轮跳过。
 * 纯函数，便于测试。
 * @param {object} goods 商城商品（MallGoods 解码对象）
 * @param {object} balances 余额对象 { diamond, goldBean }
 * @param {number} now 当前秒级时间戳
 */
function getCollectionGiftPurchase(goods, balances, now = Date.now() / 1000) {
  const goodsId = toNum(goods && goods.goods_id);
  if (!COLLECTION_GIFT_GOODS_IDS.includes(goodsId)) return 0;

  const endTime = toNum(goods.end_time);
  if (endTime > 0 && endTime <= now) return 0;

  if (goods.enabled === false) return 0;

  const limit = mall.parseMallLimitInfo(goods.limit);
  const remaining = Math.max(0, limit.limitCount - limit.boughtNum);
  if (remaining <= 0) return 0;

  const price = mall.parseMallPriceInfo(goods.price);
  if (price.price <= 0) return 0;

  const balanceKey = COLLECTION_GIFT_BALANCE_KEYS[price.currencyId];
  if (!balanceKey) return 0;
  const balance = toNum(balances && balances[balanceKey]);
  if (balance < remaining * price.price) return 0;

  return remaining;
}

function createCollectionGiftBuyer({
  getAutomation,
  getBalance,
  getGoods,
  purchase,
  report,
  now = Date.now,
}) {
  let busy = false;
  let lastCheck = -Infinity;

  return async function autoBuyCollectionGifts(force = false) {
    if (busy || getAutomation().collection_gift_buy !== true || (!force && now() - lastCheck < COLLECTION_GIFT_CHECK_INTERVAL_MS)) {
      return 0;
    }
    busy = true;
    lastCheck = now();
    let bought = 0;
    try {
      const goods = await getGoods();
      let balances = getBalance();
      for (const item of goods) {
        if (getAutomation().collection_gift_buy !== true) break;
        const count = getCollectionGiftPurchase(item, balances, now() / 1000);
        if (!count) continue;
        await purchase(Number(item.goods_id), count);
        balances = getBalance();
        bought += count;
        report(`自动购买藏品礼包：${item.name || `商品 #${item.goods_id}`} x${count}`, 'success');
      }
    } catch (error) {
      report(`自动购买藏品礼包失败：${error.message}`, 'error');
    } finally {
      busy = false;
    }
    return bought;
  };
}

function getCollectionGiftBalance(state) {
  return {
    diamond: Math.max(0, toNum(state?.diamond)),
    goldBean: Math.max(0, toNum(state?.goldBean)),
  };
}

const autoBuyCollectionGifts = createCollectionGiftBuyer({
  getAutomation,
  getBalance: () => getCollectionGiftBalance(getUserState()),
  getGoods: () => mall.getAllMallGoods(),
  purchase: mall.purchaseMallGoods,
  report: (message, result) => log('商城', message, { module: 'shop', event: '藏品礼包自动购买', result }),
});

module.exports = {
  COLLECTION_GIFT_GOODS_IDS,
  COLLECTION_GIFT_CHECK_INTERVAL_MS,
  getCollectionGiftBalance,
  getCollectionGiftPurchase,
  createCollectionGiftBuyer,
  autoBuyCollectionGifts,
};