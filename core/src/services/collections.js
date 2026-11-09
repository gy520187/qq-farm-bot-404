/**
 * 藏品宝典（蓝晶藏品）
 * 移植自上游 muyuewang/qq-farm-bot-404 79c465f（collections.ts），
 * 协议：gamepb.collectionpb.CollectionService（category=1 蓝晶）。
 * 写操作（激活/升星/切换展示/领评分奖励）字段号来自 2026-11-09 官方抓包解密（historical-plaintext-capture），
 * 见 core/docs/collection-write-protocol.md；许愿/换展台等其余写操作未验证，不提供。
 */

const fs = require('node:fs');
const { getItemById, getItemImageById } = require('../config/gameConfig');
const { getResourcePath } = require('../config/runtime-paths');

const CATEGORY = 1; // 蓝晶藏品
const rarityNames = ['', '普通', '稀有', '珍品', '天工'];

// 本地 mutant/ 目录为命名文件（另加 18.png 数字文件），官方 icon 字段不完整，
// 显式维护 id → 文件名映射。id 13 喜鹊 hide_ui=true 不进目录。
const MUTANT_IMAGE_BY_ID = {
    1: 'frozen', 2: 'love', 3: 'dark', 4: 'moist', 5: 'golden',
    6: 'haha', 7: 'tata', 8: 'lotus', 9: 'moon', 10: 'mian',
    11: 'butterfly', 12: 'lightning', 14: 'crystal', 15: 'bichon',
    16: 'leyuan', 17: 'naicha', 18: '18',
};

let cache = null;

/** 惰性加载藏品相关配置表（首次调用时读盘并缓存） */
function ensureConfig() {
    if (cache) return cache;
    const config = (name) => JSON.parse(fs.readFileSync(getResourcePath('gameConfig', 'collections', `${name}.json`), 'utf8'));
    cache = {
        seriesConfig: config('CollectionSeries'),
        itemConfig: config('CollectionItem'),
        starConfig: config('CollectionStarLevelNeed'),
        scoreConfig: config('CollectionScore'),
        rewardConfig: config('CollectionScoreReward'),
        conditionConfig: config('CollectionCondition'),
        pedestalConfig: config('CollectionPedestal'),
        groupConfig: config('CollectionGroup'),
        probabilities: config('MutantPublicity'),
        buffs: JSON.parse(fs.readFileSync(getResourcePath('gameConfig', 'BuffCfg.json'), 'utf8')),
        mutants: JSON.parse(fs.readFileSync(getResourcePath('gameConfig', 'MutantEffect.json'), 'utf8')),
    };
    return cache;
}

const quantity = (value) => (value == null ? '0' : String(value));

function rewards(value, collectionId) {
    if (!value) return [];
    return String(value).split(';').filter(Boolean).map((part) => {
        const [id, count] = part.split(':');
        const itemId = id === '0' ? collectionId : Number(id);
        return { itemId, count, name: getItemById(itemId)?.name || `物品${itemId}`, image: getItemImageById(itemId) };
    });
}

function conditionText(value) {
    if (!value) return [];
    const { seriesConfig, conditionConfig } = ensureConfig();
    return String(value).split(';').filter(Boolean).map((id) => {
        const condition = conditionConfig.find((row) => row.condition_id === Number(id));
        if (!condition) return '解锁条件待确认';
        const series = seriesConfig.find((row) => row.series_id === condition.target_series_id);
        if (condition.condition_type === 3) return `${series?.series_name || '指定系列'}中${condition.required_count}款藏品达到${condition.required_star_level}星`;
        return '解锁条件待确认';
    });
}

function buffDto(row) {
    const value = Number(row.attr_value) / 100;
    return {
        id: row.id, name: row.attr_id, value,
        description: row.attr_id === '节省10%肥料' ? `${value}%概率节省10%肥料` : `${row.attr_id} +${value}%`,
    };
}

function mutationRules(seriesId) {
    const { groupConfig } = ensureConfig();
    return groupConfig.filter((row) => row.series_id === seriesId)
        .sort((a, b) => a.display_order - b.display_order)
        .map((row) => ({ name: row.group_name, probability: Number((row.public_probability / 100).toFixed(1)), guarantee: row.display_guarantee }));
}

function normalizeCollections(reply) {
    const {
        seriesConfig, itemConfig, starConfig, scoreConfig,
        rewardConfig, pedestalConfig, buffs,
    } = ensureConfig();
    const detail = (reply.details || []).find((row) => row.category === CATEGORY);
    if (!detail) throw new Error('当前账号未返回蓝晶藏品信息');
    const owned = new Map((detail.collections || []).map((row) => [quantity(row.collection_id), row]));
    const display = (reply.display_slots || []).find((row) => row.display?.category === CATEGORY)?.display;
    const score = detail.current_score;
    const claimedScore = detail.claimed_reward_score;
    const series = seriesConfig.filter((row) => Number(row.category) === CATEGORY)
        .sort((a, b) => a.display_order - b.display_order).map((row) => {
            const items = itemConfig.filter((item) => item.series_id === row.series_id)
                .sort((a, b) => a.display_order - b.display_order).map((item) => {
                    const state = owned.get(String(item.item_id));
                    const starLevel = state?.star_level || 0;
                    const definition = getItemById(item.item_id);
                    const nextStar = starConfig.find((entry) => entry.series_id === row.series_id && entry.star_level === starLevel + 1);
                    const scores = scoreConfig.find((entry) => entry.star_level === starLevel && Number(entry.category) === CATEGORY);
                    return {
                        id: item.item_id, name: definition?.name || `藏品${item.item_id}`, description: definition?.desc || '',
                        image: getItemImageById(item.item_id), starLevel, maxStarLevel: 5,
                        ownCount: quantity(state?.own_count), activated: starLevel > 0, isNew: state?.is_new === true,
                        score: scores ? Number(String(scores.score).split(';')[row.series_rarity - 1]) : 0,
                        displayed: display ? quantity(display.item_id) === String(item.item_id) : false,
                        wished: (detail.wished || []).some((wish) => quantity(wish.collection_id) === String(item.item_id)),
                        requirements: conditionText(item.unlock_condition_ids),
                        nextStarCosts: rewards(nextStar?.items_need || null, item.item_id),
                    };
                });
            return {
                id: row.series_id, name: row.series_name, rarity: row.series_rarity, rarityName: rarityNames[row.series_rarity],
                description: row.desc || '', requirements: conditionText(row.unlock_condition_ids), mutationRules: mutationRules(row.series_id), items,
                activatedCount: items.filter((item) => item.activated).length, totalCount: items.length,
            };
        });
    const milestones = rewardConfig.filter((row) => Number(row.category) === CATEGORY)
        .sort((a, b) => a.score - b.score).map((row) => ({
            level: row.level, score: row.score, claimed: row.score <= claimedScore, reached: row.score <= score,
            rewards: rewards(row.rewards), buffs: buffs.filter((buff) => buff.source_type === '藏品属性' && Number(buff.source_param) === row.level).map(buffDto),
        }));
    const currentBuffs = new Map();
    for (const milestone of milestones.filter((row) => row.claimed)) {
        for (const buff of milestone.buffs) currentBuffs.set(buff.name, buff);
    }
    return {
        category: CATEGORY, score, claimedScore,
        activatedCount: series.reduce((sum, row) => sum + row.activatedCount, 0),
        totalCount: series.reduce((sum, row) => sum + row.totalCount, 0),
        nextRewardScore: milestones.find((row) => !row.claimed)?.score ?? null,
        currentBuffs: [...currentBuffs.values()], milestones, series,
        display: display && Number(display.item_id) > 0 ? { itemId: quantity(display.item_id), pedestalId: quantity(display.pedestal_id) } : null,
        pedestals: pedestalConfig.filter((row) => Number(row.category) === CATEGORY).map((row) => ({
            id: row.pedestal_id, name: getItemById(row.pedestal_id)?.name || '展台', image: getItemImageById(row.pedestal_id),
            owned: row.is_default === 1 || (detail.pedestals || []).some((item) => quantity(item.pedestal_id) === String(row.pedestal_id)),
        })),
        updatedAt: Date.now(),
    };
}

let pendingSnapshot = null;
function getCollectionsSnapshot() {
    if (pendingSnapshot) return pendingSnapshot;
    const request = (async () => {
        const { sendMsgAsync } = require('../utils/network');
        const { types } = require('../utils/proto');
        const body = types.GetCollectionsRequest.encode(types.GetCollectionsRequest.create({ categories: [CATEGORY] })).finish();
        const reply = await sendMsgAsync('gamepb.collectionpb.CollectionService', 'GetCollections', body);
        return normalizeCollections(types.GetCollectionsReply.decode(reply.body));
    })();
    pendingSnapshot = request;
    request.finally(() => { if (pendingSnapshot === request) pendingSnapshot = null; }).catch(() => {});
    return request;
}

/** 将 int64 回复字段转成字符串，保持与前端快照一致 */
function stringifyReply(reply) {
    const out = {};
    for (const [key, value] of Object.entries(reply)) {
        if (value && typeof value === 'object' && typeof value.toNumber === 'function') out[key] = String(value.toNumber());
        else out[key] = value;
    }
    return out;
}

/** 在快照中查找藏品条目，不存在则抛错。 */
function findCollectionItem(snapshot, collectionId) {
    const item = snapshot.series.flatMap(series => series.items).find(row => Number(row.id) === Number(collectionId));
    if (!item) throw new Error(`未找到藏品 ${collectionId}`);
    return item;
}

/** 激活/升星前置校验：未获得不可激活、满星不可升星、对应藏品道具不足不可操作。 */
function assertCanUpgrade(snapshot, collectionId) {
    const item = findCollectionItem(snapshot, collectionId);
    if (!item.activated && Number(item.ownCount) < 1) throw new Error(`藏品 ${item.name} 尚未获得，无法激活`);
    if (item.activated && item.starLevel >= item.maxStarLevel) throw new Error(`${item.name} 已达最高星级`);
    const need = item.nextStarCosts.find(cost => Number(cost.itemId) === Number(collectionId));
    if (need && Number(item.ownCount) < Number(need.count)) throw new Error(`${item.name} 道具不足：激活/升星需要 ${need.count} 个，当前持有 ${item.ownCount} 个`);
    return item;
}

/** 切换展示前置校验：未激活不可展示。 */
function assertCanDisplay(snapshot, collectionId) {
    const item = findCollectionItem(snapshot, collectionId);
    if (!item.activated) throw new Error(`${item.name} 尚未激活，无法展示`);
    return item;
}

/** 领奖前置校验：存在已达成未领取的评分档位。 */
function assertClaimable(snapshot) {
    const hasClaimable = snapshot.milestones.some(milestone => milestone.reached && !milestone.claimed);
    if (!hasClaimable) throw new Error('当前没有可领取的评分奖励');
}

/** 激活/升星藏品：消耗对应藏品道具，服务端校验库存与消耗。 */
async function upgradeCollection(collectionId) {
    const snapshot = await getCollectionsSnapshot();
    assertCanUpgrade(snapshot, collectionId);

    const { sendMsgAsync } = require('../utils/network');
    const { types } = require('../utils/proto');
    const body = types.UpgradeCollectionRequest.encode(types.UpgradeCollectionRequest.create({
        category: CATEGORY,
        collection_id: Number(collectionId),
    })).finish();
    const reply = await sendMsgAsync('gamepb.collectionpb.CollectionService', 'UpgradeCollection', body);
    const decoded = types.UpgradeCollectionReply.decode(reply.body);
    return { ...stringifyReply(decoded), snapshot: await getCollectionsSnapshot() };
}

/** 切换场景展示：把已激活藏品放到场景展示位。 */
async function switchSceneDisplay(collectionId, pedestalId = 0) {
    const snapshot = await getCollectionsSnapshot();
    assertCanDisplay(snapshot, collectionId);

    const { sendMsgAsync } = require('../utils/network');
    const { types } = require('../utils/proto');
    const body = types.SwitchSceneDisplayRequest.encode(types.SwitchSceneDisplayRequest.create({
        display_slot: {
            slot_type: 1,
            display: { category: CATEGORY, item_id: Number(collectionId), pedestal_id: Number(pedestalId) },
        },
    })).finish();
    const reply = await sendMsgAsync('gamepb.collectionpb.CollectionService', 'SwitchSceneDisplay', body);
    const decoded = types.SwitchSceneDisplayReply.decode(reply.body);
    return { ...stringifyReply(decoded), snapshot: await getCollectionsSnapshot() };
}

/** 领取评分奖励：一次性领取所有已达成未领取档位。 */
async function claimCollectionReward() {
    const snapshot = await getCollectionsSnapshot();
    assertClaimable(snapshot);

    const { sendMsgAsync } = require('../utils/network');
    const { types } = require('../utils/proto');
    const body = types.ClaimCollectionRewardRequest.encode(types.ClaimCollectionRewardRequest.create({
        category: CATEGORY,
    })).finish();
    const reply = await sendMsgAsync('gamepb.collectionpb.CollectionService', 'ClaimCollectionReward', body);
    const decoded = types.ClaimCollectionRewardReply.decode(reply.body);
    return { ...stringifyReply(decoded), snapshot: await getCollectionsSnapshot() };
}

function getMutationCatalog() {
    const { mutants, probabilities, seriesConfig, itemConfig } = ensureConfig();
    const effects = mutants.filter((row) => !row.hide_ui).sort((a, b) => (a.sort || 0) - (b.sort || 0)).map((row) => {
        const [action, value] = String(row.actions || '').split(':').map(Number);
        const effect = action === 2 ? `数量 ×${value}` : action === 3 ? `售价 ×${value}` : action === 4 ? `产出 ${row.fruit_name}` : '';
        const imageName = MUTANT_IMAGE_BY_ID[row.id];
        return {
            id: row.id, name: row.effect_name, tag: row.tag,
            image: imageName ? `/game-config/seed_images_named/mutant/${imageName}.png` : '',
            effect, description: row.tips || '',
            probabilities: probabilities.filter((entry) => entry.mutant_id === row.id)
                .map((entry) => ({ rarity: entry.rarity, percent: entry.public_probability / 100 })),
        };
    });
    return {
        normal: effects.filter((row) => row.tag === '无'),
        decoration: effects.filter((row) => row.tag === '装扮'),
        collections: seriesConfig.filter((row) => Number(row.category) === CATEGORY && !row.display)
            .sort((a, b) => a.display_order - b.display_order).map((row) => ({
                id: row.series_id, name: row.series_name, rarityName: rarityNames[row.series_rarity], description: row.desc, mutationRules: mutationRules(row.series_id),
                items: itemConfig.filter((item) => item.series_id === row.series_id)
                    .sort((a, b) => a.display_order - b.display_order).map((item) => ({
                        id: item.item_id, name: getItemById(item.item_id)?.name || `藏品${item.item_id}`, image: getItemImageById(item.item_id),
                    })),
            })),
    };
}

module.exports = {
    getCollectionsSnapshot, normalizeCollections, getMutationCatalog,
    findCollectionItem, assertCanUpgrade, assertCanDisplay, assertClaimable,
    upgradeCollection, switchSceneDisplay, claimCollectionReward,
};
