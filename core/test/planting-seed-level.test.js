const assert = require('node:assert/strict');
const test = require('node:test');

const { isSeedLockedByLevel } = require('../src/services/planting-service');
const { getAllSeeds, isEventSeedId } = require('../src/config/gameConfig');

test('event seeds at level 200 and above bypass the local planting level check regardless of size', () => {
  // 活动植物种子的 >=200 等级是官方占位值（星语铃花/泡泡棉花糖/森野黄金芽均为活动种子）
  for (const seedId of [29003, 29004, 29005]) {
    for (const plantSize of [1, 2]) {
      for (const requiredLevel of [200, '200', 201, 999]) {
        assert.equal(isSeedLockedByLevel({ requiredLevel, plantSize, seedId }, 1), false);
      }
    }
  }
});

test('normal seeds at level 200 and above follow their real unlock level', () => {
  // 官方已将普通种子真实等级开放到 200 以上（上限 240），不再享受活动占位豁免
  for (const requiredLevel of [200, 208, 217, 220, 240]) {
    assert.equal(isSeedLockedByLevel({ requiredLevel, seedId: 20189 }, requiredLevel - 1), true);
    assert.equal(isSeedLockedByLevel({ requiredLevel, seedId: 20189 }, requiredLevel), false);
  }
  // 无 seedId 的未知种子同样按真实等级判断（安全方向）
  assert.equal(isSeedLockedByLevel({ requiredLevel: 220 }, 1), true);
  assert.equal(isSeedLockedByLevel({ requiredLevel: 220 }, 220), false);
});

test('other seed levels retain their exact unlock boundary', () => {
  for (const requiredLevel of [1, 31, 199]) {
    assert.equal(isSeedLockedByLevel({ requiredLevel }, requiredLevel - 1), true);
    assert.equal(isSeedLockedByLevel({ requiredLevel }, requiredLevel), false);
    assert.equal(isSeedLockedByLevel({ requiredLevel }, requiredLevel + 1), false);
  }
});

test('configured level 200+ seeds: event seeds bypass, normal seeds enforce their real level', () => {
  const highLevelSeeds = getAllSeeds().filter(seed => seed.requiredLevel >= 200);
  assert.ok(highLevelSeeds.length >= 11);
  assert.ok(highLevelSeeds.some(seed => seed.seedId === 29005));
  // 鸡冠花（220 级）等普通种子必须存在且不在豁免集合中
  const cockscomb = highLevelSeeds.find(seed => seed.seedId === 20189);
  assert.ok(cockscomb, '普通高等级种子（鸡冠花）应已收录');
  assert.equal(cockscomb.requiredLevel, 220);
  assert.equal(isEventSeedId(cockscomb.seedId), false);
  for (const seed of highLevelSeeds) {
    if (isEventSeedId(seed.seedId)) {
      assert.equal(isSeedLockedByLevel(seed, 1), false, `活动种子 ${seed.name} (${seed.requiredLevel}) 应豁免`);
    } else {
      assert.equal(isSeedLockedByLevel(seed, seed.requiredLevel - 1), true, `普通种子 ${seed.name} (${seed.requiredLevel}) 低一级应锁定`);
      assert.equal(isSeedLockedByLevel(seed, seed.requiredLevel), false, `普通种子 ${seed.name} (${seed.requiredLevel}) 达到等级应解锁`);
    }
  }
});

test('bubble cotton candy keeps level 200 while the level 31 pumpkin remains locked', () => {
  const seeds = getAllSeeds();
  const bubble = seeds.find(seed => seed.seedId === 29004);
  assert.equal(bubble.requiredLevel, 200);
  assert.equal(isEventSeedId(bubble.seedId), true);
  assert.equal(isSeedLockedByLevel(bubble, 1), false);
  const pumpkin = seeds.find(seed => seed.seedId === 29998);
  assert.equal(pumpkin.requiredLevel, 31);
  assert.equal(isSeedLockedByLevel(pumpkin, 30), true);
  assert.equal(isSeedLockedByLevel(pumpkin, 31), false);
});
