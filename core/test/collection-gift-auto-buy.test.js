const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getCollectionGiftPurchase,
  createCollectionGiftBuyer,
  getCollectionGiftBalance,
} = require('../src/services/collection-gift-auto-buy');

// price 字段：corepb.Item（field1=货币ID，field2=数量）
const diamondGift = {
  goods_id: 1047,
  name: '钻石藏品礼包',
  enabled: true,
  end_time: 2000000000,
  price: Buffer.from([8, 236, 7, 16, 40]),
  limit: Buffer.from([8, 0, 16, 0, 24, 50]),
};
const goldBeanGift = {
  goods_id: 1048,
  name: '金豆豆藏品礼包',
  enabled: true,
  end_time: 2000000000,
  price: Buffer.from([8, 237, 7, 16, 172, 2]),
  limit: Buffer.from([8, 0, 16, 0, 24, 50]),
};

test('buys the full weekly remaining quota when balance covers it', () => {
  assert.equal(getCollectionGiftPurchase(diamondGift, { diamond: 2000, goldBean: 300 }, 1990000000), 50);
  assert.equal(getCollectionGiftPurchase(goldBeanGift, { diamond: 40, goldBean: 15000 }, 1990000000), 50);
});

test('rejects when balance cannot cover the full remaining quota', () => {
  assert.equal(getCollectionGiftPurchase(diamondGift, { diamond: 1999, goldBean: 300 }, 1990000000), 0);
  assert.equal(getCollectionGiftPurchase(goldBeanGift, { diamond: 40, goldBean: 14999 }, 1990000000), 0);
});

test('returns partial remaining quota when some were already bought this week', () => {
  const bought10 = Buffer.from([8, 0, 16, 10, 24, 50]);
  assert.equal(getCollectionGiftPurchase({ ...diamondGift, limit: bought10 }, { diamond: 1600, goldBean: 300 }, 1990000000), 40);
  const bought40 = Buffer.from([8, 0, 16, 40, 24, 50]);
  assert.equal(getCollectionGiftPurchase({ ...diamondGift, limit: bought40 }, { diamond: 400, goldBean: 300 }, 1990000000), 10);
});

test('rejects non-collection goods, expired offers, sold out and unsupported currencies', () => {
  assert.equal(getCollectionGiftPurchase({ ...diamondGift, goods_id: 9999 }, { diamond: 10000 }, 1990000000), 0);
  assert.equal(getCollectionGiftPurchase({ ...diamondGift, end_time: 1990000000 }, { diamond: 10000 }, 1990000000), 0);
  const soldOut = Buffer.from([8, 0, 16, 50, 24, 50]);
  assert.equal(getCollectionGiftPurchase({ ...diamondGift, limit: soldOut }, { diamond: 10000 }, 1990000000), 0);
  const couponPrice = Buffer.from([8, 234, 7, 16, 25]);
  assert.equal(getCollectionGiftPurchase({ ...diamondGift, price: couponPrice }, { diamond: 10000 }, 1990000000), 0);
  assert.equal(getCollectionGiftPurchase({ ...diamondGift, price: Buffer.from([8, 0, 16, 0]) }, { diamond: 10000 }, 1990000000), 0);
  assert.equal(getCollectionGiftPurchase({ ...diamondGift, enabled: false }, { diamond: 10000 }, 1990000000), 0);
});

test('respects switch, serializes overlapping runs and uses cooldown', async () => {
  let enabled = false;
  let purchases = 0;
  let timestamp = 1990000000000;
  const buyer = createCollectionGiftBuyer({
    getAutomation: () => ({ collection_gift_buy: enabled }),
    getBalance: () => ({ diamond: 2000, goldBean: 15000 }),
    getGoods: async () => [diamondGift],
    purchase: async () => { purchases++; },
    report: () => {},
    now: () => timestamp,
  });
  await buyer();
  assert.equal(purchases, 0);
  enabled = true;
  await Promise.all([buyer(), buyer()]);
  assert.equal(purchases, 1);
  await buyer();
  assert.equal(purchases, 1);
  timestamp = 1990006000000; // 冷却后
  await buyer();
  assert.equal(purchases, 2);
});

test('force bypasses cooldown but still checks switch and quota', async () => {
  let enabled = true;
  let purchases = 0;
  let timestamp = 1990000000000;
  const buyer = createCollectionGiftBuyer({
    getAutomation: () => ({ collection_gift_buy: enabled }),
    getBalance: () => ({ diamond: 2000, goldBean: 15000 }),
    getGoods: async () => [diamondGift],
    purchase: async () => { purchases++; },
    report: () => {},
    now: () => timestamp,
  });
  await buyer(true);
  assert.equal(purchases, 1);
  await buyer(true); // force 忽略冷却，但商品 limit 未变，仍会尝试购买
  assert.equal(purchases, 2);
  enabled = false;
  await buyer(true);
  assert.equal(purchases, 2);
});

test('stops buying when switch is disabled during query and keeps failures observable', async () => {
  let enabled = true;
  let purchased = false;
  const reports = [];
  const buyer = createCollectionGiftBuyer({
    getAutomation: () => ({ collection_gift_buy: enabled }),
    getBalance: () => ({ diamond: 2000, goldBean: 15000 }),
    getGoods: async () => { enabled = false; return [diamondGift]; },
    purchase: async () => { purchased = true; throw new Error('recorded failure'); },
    report: (...args) => reports.push(args),
    now: () => 1990000000000,
  });
  await buyer();
  assert.equal(purchased, false);
  assert.equal(reports.length, 0);
  enabled = true;
  const buyer2 = createCollectionGiftBuyer({
    getAutomation: () => ({ collection_gift_buy: enabled }),
    getBalance: () => ({ diamond: 2000, goldBean: 15000 }),
    getGoods: async () => [diamondGift],
    purchase: async () => { purchased = true; throw new Error('recorded failure'); },
    report: (...args) => reports.push(args),
    now: () => 1990006000000,
  });
  await buyer2();
  assert.equal(purchased, true);
  assert.match(reports[0][0], /recorded failure/);
  assert.equal(reports[0][1], 'error');
});

test('uses live balances and retries insufficient funds on next check', async () => {
  const state = { diamond: 1999, goldBean: 14999 };
  let timestamp = 1990000000000;
  const purchases = [];
  const reports = [];
  const buyer = createCollectionGiftBuyer({
    getAutomation: () => ({ collection_gift_buy: true }),
    getBalance: () => getCollectionGiftBalance(state),
    getGoods: async () => [diamondGift, goldBeanGift],
    purchase: async (...args) => purchases.push(args),
    report: (...args) => reports.push(args),
    now: () => timestamp,
  });
  await buyer();
  assert.equal(purchases.length, 0);
  state.diamond = 2000;
  state.goldBean = 15000;
  timestamp += 600000;
  await buyer();
  assert.deepEqual(purchases, [[1047, 50], [1048, 50]]);
  assert.deepEqual(getCollectionGiftBalance({ diamond: 50, goldBean: 100 }), { diamond: 50, goldBean: 100 });
  assert.deepEqual(getCollectionGiftBalance({}), { diamond: 0, goldBean: 0 });
});