const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const protobuf = require('protobufjs');

const { normalizeCollections, getMutationCatalog } = require('../src/services/collections');

const FIXTURE = {
  details: [{
    category: 1,
    collections: [
      { collection_id: 710001, star_level: 2, is_new: true, first_obtained_time: 1700000000, own_count: 3 },
      { collection_id: 700001, star_level: 1, is_new: false, first_obtained_time: 0, own_count: 1 },
    ],
    pedestals: [{ pedestal_id: 610201, is_new: false }],
    wished: [{ series_id: 1001, collection_id: 710002, cooldown_until: 1700003600 }],
    claimed_reward_score: 400,
    current_score: 1500,
    collection_like_count: 0,
    pedestal_like_count: 0,
  }],
  display_slots: [{ slot_type: 1, display: { category: 1, item_id: 710001, pedestal_id: 610100 } }],
};

test('normalizeCollections 归一化系列/星级/里程碑/展台/许愿/展示', () => {
  const snapshot = normalizeCollections(FIXTURE);

  assert.equal(snapshot.category, 1);
  assert.equal(snapshot.score, 1500);
  assert.equal(snapshot.claimedScore, 400);
  assert.equal(snapshot.activatedCount, 2);
  assert.equal(snapshot.totalCount, 30);

  // 系列按 display_order 排序，5 个系列全部保留
  assert.deepEqual(snapshot.series.map(s => s.id), [1001, 2002, 2001, 3001, 4001]);
  const s1001 = snapshot.series[0];
  assert.equal(s1001.name, '氧气精灵');
  assert.equal(s1001.rarityName, '普通');
  assert.equal(s1001.activatedCount, 1);
  assert.equal(s1001.totalCount, 6);

  // 已拥有藏品状态
  const owned = s1001.items.find(i => i.id === 710001);
  assert.equal(owned.activated, true);
  assert.equal(owned.starLevel, 2);
  assert.equal(owned.isNew, true);
  assert.equal(owned.ownCount, '3');
  assert.equal(owned.displayed, true);
  assert.equal(owned.score, 720); // rarity=1 star=2 → "720;1080;1800;9000"[0]
  assert.equal(owned.maxStarLevel, 5);
  assert.ok(owned.image, '藏品应有图标');
  assert.notEqual(owned.name, '藏品710001');

  // 升星消耗：items_need "0:4;1001:4000000"，id=0 回退藏品自身
  assert.equal(owned.nextStarCosts.length, 2);
  assert.equal(owned.nextStarCosts[0].itemId, 710001);
  assert.equal(Number(owned.nextStarCosts[0].count), 4);
  assert.equal(owned.nextStarCosts[1].itemId, 1001);

  // 许愿标记
  const wished = s1001.items.find(i => i.id === 710002);
  assert.equal(wished.wished, true);
  assert.equal(wished.activated, false);

  // 未拥有藏品
  const s2002 = snapshot.series.find(s => s.id === 2002);
  const jello = s2002.items.find(i => i.id === 700001);
  assert.equal(jello.activated, true); // fixture 里 star_level=1
  assert.equal(jello.starLevel, 1);
  assert.equal(jello.name, '棉芽');
  assert.equal(jello.score, 600); // rarity=2 star=1 → "400;600;1000;5000"[1]

  // 里程碑：400 分已领取，下一档为未领取
  assert.equal(snapshot.milestones.length, 22);
  assert.equal(snapshot.milestones[0].score, 400);
  assert.equal(snapshot.milestones[0].claimed, true);
  assert.equal(snapshot.milestones[0].reached, true);
  assert.equal(snapshot.nextRewardScore, snapshot.milestones[1].score);

  // 已生效增益只累计已领取档位（level 1 → 节省10%肥料）
  assert.equal(snapshot.currentBuffs.length, 1);
  assert.equal(snapshot.currentBuffs[0].name, '节省10%肥料');
  assert.equal(snapshot.currentBuffs[0].value, 1);
  assert.equal(snapshot.currentBuffs[0].description, '1%概率节省10%肥料');

  // 展示位
  assert.deepEqual(snapshot.display, { itemId: '710001', pedestalId: '610100' });

  // 展台：默认展台拥有 + 服务端返回的 610201 拥有
  assert.equal(snapshot.pedestals.length, 8);
  assert.equal(snapshot.pedestals.find(p => p.id === 610100).owned, true);
  assert.equal(snapshot.pedestals.find(p => p.id === 610201).owned, true);
  assert.equal(snapshot.pedestals.find(p => p.id === 610202).owned, false);
});

test('normalizeCollections 缺少蓝晶 detail 时抛出明确错误', () => {
  assert.throws(() => normalizeCollections({ details: [] }), /蓝晶藏品/);
  assert.throws(() => normalizeCollections({ details: [{ category: 2 }] }), /蓝晶藏品/);
});

test('collectionpb 编解码往返后 normalizeCollections 正确处理 int64', async () => {
  const root = new protobuf.Root();
  await root.load([path.join(__dirname, '../src/proto/collectionpb.proto')], { keepCase: true });
  const Reply = root.lookupType('gamepb.collectionpb.GetCollectionsReply');
  const encoded = Reply.encode(Reply.create(FIXTURE)).finish();
  const decoded = Reply.decode(encoded);

  const snapshot = normalizeCollections(decoded);
  assert.equal(snapshot.display.itemId, '710001');
  assert.equal(snapshot.series[0].items.find(i => i.id === 710001).ownCount, '3');
  assert.equal(snapshot.score, 1500);
});

test('藏品写操作前置校验（不连网，固定快照）', () => {
  const { assertCanUpgrade, assertCanDisplay, assertClaimable } = require('../src/services/collections');

  const makeSnapshot = (overrides = {}) => ({
    milestones: [],
    series: [{
      id: 3001,
      items: [{
        id: 730004,
        name: '鹊桥仙',
        ownCount: '1',
        activated: false,
        starLevel: 0,
        maxStarLevel: 5,
        nextStarCosts: [{ itemId: 730004, count: '1' }],
      }],
    }],
    ...overrides,
  });

  // 未获得不可激活
  const missing = makeSnapshot();
  missing.series[0].items[0].ownCount = '0';
  assert.throws(() => assertCanUpgrade(missing, 730004), /尚未获得/);

  // 持有足够可激活
  const pending = makeSnapshot();
  assert.doesNotThrow(() => assertCanUpgrade(pending, 730004));

  // 已激活但道具不足不可升星
  const insufficient = makeSnapshot();
  insufficient.series[0].items[0].activated = true;
  insufficient.series[0].items[0].starLevel = 1;
  insufficient.series[0].items[0].ownCount = '0';
  assert.throws(() => assertCanUpgrade(insufficient, 730004), /道具不足/);

  // 满星不可升
  const maxed = makeSnapshot();
  maxed.series[0].items[0].activated = true;
  maxed.series[0].items[0].starLevel = 5;
  maxed.series[0].items[0].ownCount = '10';
  assert.throws(() => assertCanUpgrade(maxed, 730004), /已达最高星级/);

  // 未激活不可展示
  assert.throws(() => assertCanDisplay(makeSnapshot(), 730004), /尚未激活/);
  const activated = makeSnapshot();
  activated.series[0].items[0].activated = true;
  assert.doesNotThrow(() => assertCanDisplay(activated, 730004));

  // 无可领奖励
  assert.throws(() => assertClaimable(makeSnapshot()), /没有可领取/);
  const claimable = makeSnapshot({ milestones: [{ reached: true, claimed: false }] });
  assert.doesNotThrow(() => assertClaimable(claimable));
  const allClaimed = makeSnapshot({ milestones: [{ reached: true, claimed: true }] });
  assert.throws(() => assertClaimable(allClaimed), /没有可领取/);
});

test('藏品写操作协议固定 hex 回归（2026-11-09 抓包解密）', async () => {
  const root = new protobuf.Root();
  await root.load([path.join(__dirname, '../src/proto/collectionpb.proto')], { keepCase: true });

  // UpgradeCollection：请求 {1: category=1, 2: collection_id=730004}
  const UpgradeReq = root.lookupType('gamepb.collectionpb.UpgradeCollectionRequest');
  const upgradeReqHex = Buffer.from(UpgradeReq.encode(UpgradeReq.create({ category: 1, collection_id: 730004 })).finish()).toString('hex');
  assert.equal(upgradeReqHex, '08011094c72c');

  // UpgradeCollection 回复 {1: 1, 2: 730004, 3: star_level=1, 4: current_score=4400}
  const UpgradeRsp = root.lookupType('gamepb.collectionpb.UpgradeCollectionReply');
  const upgradeDecoded = UpgradeRsp.toObject(UpgradeRsp.decode(Buffer.from('08011094c72c180120b022', 'hex')), { longs: String });
  assert.deepEqual(upgradeDecoded, { category: '1', collection_id: '730004', star_level: '1', current_score: '4400' });

  // SwitchSceneDisplay：请求 {1: DisplaySlot{1: slot_type=1, 2: DisplayInfo{1: category, 2: item_id, 3: pedestal_id=0}}}
  const DisplayReq = root.lookupType('gamepb.collectionpb.SwitchSceneDisplayRequest');
  const displayReqHex = Buffer.from(DisplayReq.encode(DisplayReq.create({
    display_slot: { slot_type: 1, display: { category: 1, item_id: 730004, pedestal_id: 0 } },
  })).finish()).toString('hex');
  assert.equal(displayReqHex, '0a0c0801120808011094c72c1800');

  // SwitchSceneDisplay 回复 {1: DisplaySlot{1: slot_type=1, 2: DisplayInfo{1: category, 2: item_id}}}
  const DisplayRsp = root.lookupType('gamepb.collectionpb.SwitchSceneDisplayReply');
  const displayDecoded = DisplayRsp.toObject(DisplayRsp.decode(Buffer.from('0a0a0801120608011094c72c', 'hex')), { longs: String });
  assert.deepEqual(displayDecoded, { display_slot: { slot_type: 1, display: { category: 1, item_id: '730004' } } });

  // ClaimCollectionReward：请求 {1: category=1}
  const ClaimReq = root.lookupType('gamepb.collectionpb.ClaimCollectionRewardRequest');
  const claimReqHex = Buffer.from(ClaimReq.encode(ClaimReq.create({ category: 1 })).finish()).toString('hex');
  assert.equal(claimReqHex, '0801');

  // ClaimCollectionReward 回复 {2: current_score=4400, 3: claimed_reward_score=4300, 4: packed [2000,3100,4300]}
  const ClaimRsp = root.lookupType('gamepb.collectionpb.ClaimCollectionRewardReply');
  const claimDecoded = ClaimRsp.toObject(ClaimRsp.decode(Buffer.from('10b02218cc212206d00f9c18cc21', 'hex')), { longs: String });
  assert.deepEqual(claimDecoded, { current_score: '4400', claimed_reward_score: '4300', claimed_scores: [2000, 3100, 4300] });
});

test('getMutationCatalog 三类分组、display 过滤与命名图片映射', () => {
  const catalog = getMutationCatalog();

  // 常规（tag=无）：1冰冻 2爱心 3暗化 4湿润 5黄金 10绵绵 14晶辉 15比熊，按官方 sort 排序
  assert.deepEqual(catalog.normal.map(r => r.id).sort((a, b) => a - b), [1, 2, 3, 4, 5, 10, 14, 15]);
  assert.equal(catalog.normal.length, 8);
  // 装扮（tag=装扮）：7塔塔 9月华 11蝶梦 16乐园 17奶茶
  assert.deepEqual(catalog.decoration.map(r => r.id).sort((a, b) => a - b), [7, 9, 11, 16, 17]);
  // hide_ui=true 的 13 喜鹊不出现
  assert.ok(!catalog.normal.some(r => r.id === 13));
  assert.ok(!catalog.decoration.some(r => r.id === 13));

  // 图片走本地命名文件映射，不是数字 id
  const frozen = catalog.normal.find(r => r.id === 1);
  assert.equal(frozen.image, '/game-config/seed_images_named/mutant/frozen.png');
  const naicha = catalog.decoration.find(r => r.id === 17);
  assert.equal(naicha.image, '/game-config/seed_images_named/mutant/naicha.png');

  // 变异概率公开
  assert.ok(Array.isArray(frozen.probabilities));
  assert.ok(frozen.probabilities.length > 0);
  assert.equal(typeof frozen.probabilities[0].percent, 'number');

  // 宝典藏品系列：display=true 的 2002 果冻花园被过滤
  assert.deepEqual(catalog.collections.map(s => s.id), [1001, 2001, 3001, 4001]);
  const s1001 = catalog.collections[0];
  assert.equal(s1001.name, '氧气精灵');
  assert.equal(s1001.rarityName, '普通');
  assert.equal(s1001.items.length, 6);
  assert.equal(s1001.items[0].name.length > 0, true);
  // 变异规则概率保留一位小数（117 → 1.2）
  assert.ok(s1001.mutationRules.length > 0);
  const rule = s1001.mutationRules.find(r => r.name === '4小时·普通');
  assert.equal(rule.probability, 1.2);
  assert.equal(rule.guarantee, 120);
});
