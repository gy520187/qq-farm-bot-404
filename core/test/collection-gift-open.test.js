const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COLLECTION_GIFT_ITEM_IDS,
  getCollectionGiftOpenPayloads,
  createCollectionGiftOpener,
} = require('../src/services/collection-gift-open');

test('collects collection gift payloads from bag items only', () => {
  assert.deepEqual(getCollectionGiftOpenPayloads([]), []);
  assert.deepEqual(getCollectionGiftOpenPayloads([
    { id: 101618, count: 2 },
    { id: 101619, count: 3 },
    { id: 1001, count: 10 },
  ]), [
    { id: 101618, count: 2 },
    { id: 101619, count: 3 },
  ]);
});

test('merges duplicate ids and ignores zero/invalid entries', () => {
  assert.deepEqual(getCollectionGiftOpenPayloads([
    { id: 101618, count: 2 },
    { id: 101618, count: 3 },
    { id: 101619, count: 0 },
    { id: 0, count: 5 },
    { id: -1, count: 5 },
    { id: 101619 },
  ]), [
    { id: 101618, count: 5 },
  ]);
  assert.ok(COLLECTION_GIFT_ITEM_IDS.includes(101618));
  assert.ok(COLLECTION_GIFT_ITEM_IDS.includes(101619));
});

test('respects switch, cooldown and serializes overlapping runs', async () => {
  let enabled = false;
  let opens = 0;
  let timestamp = 1990000000000;
  const buyer = createCollectionGiftOpener({
    getAutomation: () => ({ collection_gift_open: enabled }),
    getBagItems: async () => [{ id: 101618, count: 5 }],
    useItems: async () => { opens++; },
    report: () => {},
    now: () => timestamp,
  });
  await buyer();
  assert.equal(opens, 0);
  enabled = true;
  await Promise.all([buyer(), buyer()]);
  assert.equal(opens, 1);
  await buyer();
  assert.equal(opens, 1);
  timestamp = 1990006000000; // 冷却后
  await buyer();
  assert.equal(opens, 2);
});

test('force bypasses cooldown but still checks switch', async () => {
  let enabled = true;
  let opens = 0;
  const buyer = createCollectionGiftOpener({
    getAutomation: () => ({ collection_gift_open: enabled }),
    getBagItems: async () => [{ id: 101619, count: 1 }],
    useItems: async () => { opens++; },
    report: () => {},
    now: () => 1990000000000,
  });
  await buyer(true);
  assert.equal(opens, 1);
  await buyer(true);
  assert.equal(opens, 2);
  enabled = false;
  await buyer(true);
  assert.equal(opens, 2);
});

test('skips when no collection gifts in bag and reports failures observably', async () => {
  let used = false;
  const reports = [];
  const buyer = createCollectionGiftOpener({
    getAutomation: () => ({ collection_gift_open: true }),
    getBagItems: async () => [{ id: 1001, count: 10 }],
    useItems: async () => { used = true; },
    report: (...args) => reports.push(args),
    now: () => 1990000000000,
  });
  await buyer();
  assert.equal(used, false);
  assert.equal(reports.length, 0);

  const failing = createCollectionGiftOpener({
    getAutomation: () => ({ collection_gift_open: true }),
    getBagItems: async () => [{ id: 101618, count: 2 }],
    useItems: async () => { throw new Error('recorded failure'); },
    report: (...args) => reports.push(args),
    now: () => 1990006000000,
  });
  await failing();
  assert.match(reports[0][0], /recorded failure/);
  assert.equal(reports[0][1], 'error');
});

test('stops opening when switch is disabled during bag query', async () => {
  let enabled = true;
  let used = false;
  const buyer = createCollectionGiftOpener({
    getAutomation: () => ({ collection_gift_open: enabled }),
    getBagItems: async () => { enabled = false; return [{ id: 101618, count: 2 }]; },
    useItems: async () => { used = true; },
    report: () => {},
    now: () => 1990000000000,
  });
  await buyer();
  assert.equal(used, false);
});