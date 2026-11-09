const test = require('node:test');
const assert = require('node:assert');
const {
  COLLECTION_AUTO_CHECK_INTERVAL_MS,
  getCollectionUpgradeTarget,
  createCollectionAutoRunner,
} = require('../src/services/collection-auto');

test('getCollectionUpgradeTarget：无效条目返回 0', () => {
  assert.strictEqual(getCollectionUpgradeTarget(null), 0);
  assert.strictEqual(getCollectionUpgradeTarget(undefined), 0);
  assert.strictEqual(getCollectionUpgradeTarget({}), 0);
});

test('getCollectionUpgradeTarget：未持有藏品时跳过', () => {
  const item = { id: 730004, name: 'A', ownCount: 0, activated: false, starLevel: 0, maxStarLevel: 3, nextStarCosts: [{ itemId: 730004, count: 1 }] };
  assert.strictEqual(getCollectionUpgradeTarget(item), 0);
});

test('getCollectionUpgradeTarget：已激活且满星时跳过', () => {
  const item = { id: 730006, name: 'C', ownCount: 5, activated: true, starLevel: 3, maxStarLevel: 3, nextStarCosts: [] };
  assert.strictEqual(getCollectionUpgradeTarget(item), 0);
});

test('getCollectionUpgradeTarget：未激活但持有足够道具时激活', () => {
  const item = { id: 730004, name: 'A', ownCount: 2, activated: false, starLevel: 0, maxStarLevel: 3, nextStarCosts: [{ itemId: 730004, count: 1 }] };
  assert.strictEqual(getCollectionUpgradeTarget(item), 1);
});

test('getCollectionUpgradeTarget：已激活未满星且道具足够时升星', () => {
  const item = { id: 730005, name: 'B', ownCount: 3, activated: true, starLevel: 1, maxStarLevel: 3, nextStarCosts: [{ itemId: 730005, count: 2 }] };
  assert.strictEqual(getCollectionUpgradeTarget(item), 2);
});

test('getCollectionUpgradeTarget：道具不足时跳过', () => {
  const item = { id: 730005, name: 'B', ownCount: 1, activated: true, starLevel: 1, maxStarLevel: 3, nextStarCosts: [{ itemId: 730005, count: 2 }] };
  assert.strictEqual(getCollectionUpgradeTarget(item), 0);
});

test('getCollectionUpgradeTarget：升级消耗不含本藏品时按 1 个判断', () => {
  const item = { id: 730004, name: 'A', ownCount: 1, activated: false, starLevel: 0, maxStarLevel: 3, nextStarCosts: [{ itemId: 730099, count: 2 }] };
  assert.strictEqual(getCollectionUpgradeTarget(item), 1);
});

function createMockDeps(overrides = {}) {
  const calls = { upgrade: [], claimReward: 0, snapshot: 0 };
  const state = {
    collection_auto_upgrade: false,
    collection_auto_claim: false,
  };
  const deps = {
    getAutomation: () => state,
    getSnapshot: async () => {
      calls.snapshot += 1;
      return {
        series: [{
          items: [
            { id: 730004, name: 'A', ownCount: 2, activated: false, starLevel: 0, maxStarLevel: 3, nextStarCosts: [{ itemId: 730004, count: 1 }] },
            { id: 730005, name: 'B', ownCount: 1, activated: true, starLevel: 1, maxStarLevel: 3, nextStarCosts: [{ itemId: 730005, count: 2 }] },
            { id: 730006, name: 'C', ownCount: 5, activated: true, starLevel: 3, maxStarLevel: 3, nextStarCosts: [] },
          ],
        }],
        milestones: [{ reached: true, claimed: false }, { reached: true, claimed: true }],
      };
    },
    upgrade: async (collectionId) => {
      calls.upgrade.push(collectionId);
    },
    claimReward: async () => {
      calls.claimReward += 1;
    },
    report: () => {},
    now: () => 1000,
    ...overrides,
  };
  return { state, calls, deps };
}

test('createCollectionAutoRunner：开关关闭时不执行任何操作', async () => {
  const { state, calls, deps } = createMockDeps();
  const runner = createCollectionAutoRunner(deps);
  const result = await runner(true);
  assert.strictEqual(result, 0);
  assert.deepStrictEqual(calls.upgrade, []);
  assert.strictEqual(calls.claimReward, 0);
  assert.strictEqual(calls.snapshot, 0);
  assert.strictEqual(state.collection_auto_upgrade, false);
});

test('createCollectionAutoRunner：自动激活满足条件的藏品并领取奖励', async () => {
  const { state, calls, deps } = createMockDeps();
  state.collection_auto_upgrade = true;
  state.collection_auto_claim = true;
  const runner = createCollectionAutoRunner(deps);
  const result = await runner(true);
  assert.strictEqual(result, 2);
  assert.deepStrictEqual(calls.upgrade, [730004]);
  assert.strictEqual(calls.claimReward, 1);
});

test('createCollectionAutoRunner：只开激活时不领取评分奖励', async () => {
  const { state, calls, deps } = createMockDeps();
  state.collection_auto_upgrade = true;
  const runner = createCollectionAutoRunner(deps);
  const result = await runner(true);
  assert.strictEqual(result, 1);
  assert.deepStrictEqual(calls.upgrade, [730004]);
  assert.strictEqual(calls.claimReward, 0);
});

test('createCollectionAutoRunner：只开领取时激活达标的藏品', async () => {
  const { state, calls, deps } = createMockDeps();
  state.collection_auto_claim = true;
  const runner = createCollectionAutoRunner(deps);
  const result = await runner(true);
  assert.strictEqual(result, 1);
  assert.deepStrictEqual(calls.upgrade, []);
  assert.strictEqual(calls.claimReward, 1);
});

test('createCollectionAutoRunner：无可领取档位时不调用领奖', async () => {
  const { state, calls, deps } = createMockDeps();
  state.collection_auto_claim = true;
  deps.getSnapshot = async () => ({
    series: [],
    milestones: [{ reached: true, claimed: true }],
  });
  const runner = createCollectionAutoRunner(deps);
  const result = await runner(true);
  assert.strictEqual(result, 0);
  assert.strictEqual(calls.claimReward, 0);
});

test('createCollectionAutoRunner：激活时遇到预期错误跳过并继续', async () => {
  const { state, calls, deps } = createMockDeps();
  state.collection_auto_upgrade = true;
  const reports = [];
  deps.report = (message, result) => reports.push(result);
  deps.upgrade = async (collectionId) => {
    if (collectionId === 730004) throw new Error('藏品 A 道具不足：激活/升星需要 1 个，当前持有 0 个');
    calls.upgrade.push(collectionId);
  };
  const runner = createCollectionAutoRunner(deps);
  const result = await runner(true);
  assert.strictEqual(result, 0);
  assert.deepStrictEqual(calls.upgrade, []);
  assert.deepStrictEqual(reports, ['skip']);
});

test('createCollectionAutoRunner：激活时遇到非预期错误中断本轮', async () => {
  const { state, calls, deps } = createMockDeps();
  state.collection_auto_upgrade = true;
  const reports = [];
  deps.report = (message, result) => reports.push(result);
  deps.upgrade = async () => {
    throw new Error('网络异常');
  };
  const runner = createCollectionAutoRunner(deps);
  const result = await runner(true);
  assert.strictEqual(result, 0);
  assert.deepStrictEqual(calls.upgrade, []);
  assert.deepStrictEqual(reports, ['error']);
});

test('createCollectionAutoRunner：执行中关闭开关后停止后续藏品', async () => {
  const { state, calls, deps } = createMockDeps();
  state.collection_auto_upgrade = true;
  const items = [
    { id: 730004, name: 'A', ownCount: 2, activated: false, starLevel: 0, maxStarLevel: 3, nextStarCosts: [{ itemId: 730004, count: 1 }] },
    { id: 730005, name: 'B', ownCount: 2, activated: false, starLevel: 0, maxStarLevel: 3, nextStarCosts: [{ itemId: 730005, count: 1 }] },
  ];
  deps.getSnapshot = async () => ({ series: [{ items }], milestones: [] });
  deps.upgrade = async (collectionId) => {
    calls.upgrade.push(collectionId);
    state.collection_auto_upgrade = false;
  };
  const runner = createCollectionAutoRunner(deps);
  const result = await runner(true);
  assert.strictEqual(result, 1);
  assert.deepStrictEqual(calls.upgrade, [730004]);
});

test('createCollectionAutoRunner：间隔内不重复执行，force 可跳过间隔', async () => {
  const { state, calls, deps } = createMockDeps();
  state.collection_auto_upgrade = true;
  const runner = createCollectionAutoRunner(deps);
  await runner();
  await runner();
  assert.strictEqual(calls.snapshot, 1);
  await runner(true);
  assert.strictEqual(calls.snapshot, 2);
  assert.strictEqual(COLLECTION_AUTO_CHECK_INTERVAL_MS > 0, true);
});

test('createCollectionAutoRunner：并发调用只执行一次', async () => {
  const { state, calls, deps } = createMockDeps();
  state.collection_auto_upgrade = true;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  deps.getSnapshot = async () => {
    calls.snapshot += 1;
    await gate;
    return { series: [], milestones: [] };
  };
  const runner = createCollectionAutoRunner(deps);
  const first = runner(true);
  const second = runner(true);
  release();
  const results = await Promise.all([first, second]);
  assert.strictEqual(calls.snapshot, 1);
  assert.deepStrictEqual(results, [0, 0]);
});