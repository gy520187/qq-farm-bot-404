const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// store 在模块加载时读取全局配置；先切到临时数据目录再 require
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-system-config-'));
process.env.FARM_DATA_DIR = dataDir;

const store = require('../src/models/store');

test('setSystemConfig persists napcatLoginEnabled toggle', () => {
  assert.equal(store.getSystemConfig(), null);

  const enabled = store.setSystemConfig({ napcatLoginEnabled: true });
  assert.equal(enabled.napcatLoginEnabled, true);
  assert.equal(store.getSystemConfig().napcatLoginEnabled, true);

  // 旧调用方只带自己的字段时，缺省字段应沿用当前值
  const partial = store.setSystemConfig({ serverUrl: 'wss://example.test/ws' });
  assert.equal(partial.napcatLoginEnabled, true);
  assert.equal(partial.serverUrl, 'wss://example.test/ws');

  const disabled = store.setSystemConfig({ napcatLoginEnabled: false });
  assert.equal(disabled.napcatLoginEnabled, false);
  assert.equal(store.getSystemConfig().napcatLoginEnabled, false);
});