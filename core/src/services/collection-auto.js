const { getAutomation } = require('../models/store');
const { log, toNum } = require('../utils/utils');

// 藏品自动任务检查间隔：藏品道具主要来自礼包/活动，10 分钟一次足够。
const COLLECTION_AUTO_CHECK_INTERVAL_MS = 10 * 60 * 1000;

/**
 * 判断某个藏品是否值得自动激活/升星，返回本次需要消耗的本藏品数量（0 表示跳过）。
 * - 未持有藏品（ownCount < 1）跳过；
 * - 已激活且满星跳过；
 * - 升级消耗里包含本藏品时要求持有数量足够；没有明确消耗时至少持有 1 个。
 * 纯函数，便于测试。
 * @param {object} item 藏品快照条目（GetCollectionRsp 的 series[].items[]）
 * @returns {number} 需要消耗的数量；0 表示跳过
 */
function getCollectionUpgradeTarget(item) {
  if (!item) return 0;
  const ownCount = toNum(item.ownCount);
  if (ownCount < 1) return 0;
  if (item.activated && toNum(item.starLevel) >= toNum(item.maxStarLevel)) return 0;
  const costs = Array.isArray(item.nextStarCosts) ? item.nextStarCosts : [];
  const selfCost = costs.find(cost => toNum(cost.itemId) === toNum(item.id));
  const need = selfCost ? toNum(selfCost.count) : 1;
  return ownCount >= need ? need : 0;
}

const EXPECTED_UPGRADE_ERROR_PATTERN = /尚未获得|已达最高星级|道具不足/;

function isExpectedUpgradeError(error) {
  const message = String((error && error.message) || '');
  return EXPECTED_UPGRADE_ERROR_PATTERN.test(message);
}

function createCollectionAutoRunner({
  getAutomation,
  getSnapshot,
  upgrade,
  claimReward,
  report,
  now = Date.now,
}) {
  let busy = false;
  let lastCheck = -Infinity;

  return async function runCollectionAuto(force = false) {
    if (busy) return 0;
    const autoUpgrade = getAutomation().collection_auto_upgrade === true;
    const autoClaim = getAutomation().collection_auto_claim === true;
    if (!autoUpgrade && !autoClaim) return 0;
    if (!force && now() - lastCheck < COLLECTION_AUTO_CHECK_INTERVAL_MS) return 0;
    busy = true;
    lastCheck = now();
    let actions = 0;
    try {
      const snapshot = await getSnapshot();
      if (autoUpgrade) {
        const items = (snapshot && snapshot.series || []).flatMap(series => series.items || []);
        for (const item of items) {
          if (getAutomation().collection_auto_upgrade !== true) break;
          const need = getCollectionUpgradeTarget(item);
          if (!need) continue;
          try {
            await upgrade(toNum(item.id));
            actions += 1;
            report(`自动激活藏品：${item.name || `#${item.id}`}`, 'success');
          } catch (error) {
            // 道具不足、已达最高星级等可预期失败静默跳过，继续下一个藏品；
            // 网络/限流等服务端异常直接抛出，中断本轮避免重复请求。
            if (isExpectedUpgradeError(error)) {
              report(`跳过藏品 ${item.name || `#${item.id}`}：${error.message}`, 'skip');
            } else {
              throw error;
            }
          }
        }
      }
      if (autoClaim && getAutomation().collection_auto_claim === true) {
        const milestones = Array.isArray(snapshot && snapshot.milestones) ? snapshot.milestones : [];
        if (milestones.some(row => row.reached && !row.claimed)) {
          try {
            await claimReward();
            actions += 1;
            report('自动领取藏品评分奖励', 'success');
          } catch (error) {
            report(`自动领取藏品评分奖励失败：${error.message}`, 'error');
          }
        }
      }
    } catch (error) {
      report(`藏品自动任务执行失败：${error.message}`, 'error');
    } finally {
      busy = false;
    }
    return actions;
  };
}

const runCollectionAuto = createCollectionAutoRunner({
  getAutomation,
  getSnapshot: () => require('./collections').getCollectionsSnapshot(),
  upgrade: (collectionId) => require('./collections').upgradeCollection(collectionId),
  claimReward: () => require('./collections').claimCollectionReward(),
  report: (message, result) => log('藏品', message, { module: 'collection', event: '藏品自动任务', result }),
});

module.exports = {
  COLLECTION_AUTO_CHECK_INTERVAL_MS,
  getCollectionUpgradeTarget,
  isExpectedUpgradeError,
  createCollectionAutoRunner,
  runCollectionAuto,
};