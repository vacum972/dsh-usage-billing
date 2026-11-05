/**
 * Client-half smoke test for the usage-billing bundle.
 *
 * Evaluates the browser bundle's factory with stub React/react-dom, then calls
 * the registered composer-dock component with synthetic projection and account
 * data: pill text, dialog sections, live peak/idle period computation, and the
 * remaining-amount row. Run: node tests/client.test.mjs
 */

let captured;
globalThis.document = { body: {} };
globalThis.window = {
  __ModuleLoader__: {
    load(config) {
      captured = config;
    },
  },
};

let openInitially = false;
let fakeBalance;
const React = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children };
  },
  useState(initial) {
    if (initial === false && openInitially) return [true, () => {}];
    if (initial !== null && typeof initial === 'object' && initial.status === 'loading' && fakeBalance !== undefined) {
      return [fakeBalance, () => {}];
    }
    const value = typeof initial === 'function' ? initial() : initial;
    return [value, () => {}];
  },
  useRef(initial) {
    return { current: initial ?? null };
  },
  useEffect() {},
  useLayoutEffect() {},
};
const ReactDOM = {
  createPortal(node, container) {
    return { type: 'portal', node, container };
  },
};

await import(new URL('../client.js', import.meta.url).href);

const assert = (condition, message) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
};
const equal = (actual, expected, message) => {
  if (actual !== expected) throw new Error(`FAIL: ${message}: expected ${expected}, got ${actual}`);
};

assert(captured !== undefined, 'module loader registration ran');
equal(captured.id, '@vacum972/dsh-usage-billing', 'bundle id');

const moduleExports = captured.factory((request) => {
  if (request === 'react') return React;
  if (request === 'react-dom') return ReactDOM;
  throw new Error(`unexpected require: ${request}`);
});

assert(Array.isArray(moduleExports.inject), 'module declares inject');
equal(moduleExports.inject.join(','), 'slots,locale,remote,remote.account', 'module inject list');

let entry;
let dictionaries;
let namespace;
const balanceCalls = [];
const ctx = {
  effect(fn) {
    fn();
  },
  locale: {
    getSnapshot() {
      return { active: 'zh-CN' };
    },
    register(ns, dicts) {
      namespace = ns;
      dictionaries = dicts;
    },
    bind(ns) {
      const dictionary = dictionaries?.zh ?? {};
      return (key, vars) => {
        const template = dictionary[key];
        if (template === undefined) return key;
        if (vars === undefined) return template;
        return template.replace(/\{(\w+)\}/g, (full, name) =>
          Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : full,
        );
      };
    },
  },
  slots: {
    inject(owner, callback) {
      equal(owner, 'conversation.composer.dock', 'slot injected into the composer dock');
      return callback();
    },
    register(options, component) {
      entry = { options, component };
      return entry;
    },
  },
  remote: {
    account: {
      async getBalance(metadata) {
        balanceCalls.push(metadata);
        return {
          ok: true,
          value: {
            status: 'ready',
            value: [{ currency: 'CNY', balance: '100.50' }],
            bonusWallets: [{ currency: 'CNY', balance: '5.25' }],
          },
        };
      },
      async getProfile() {
        return { ok: true, value: { status: 'ready', value: {} } };
      },
      async getState() {
        return {
          ok: true,
          value: {
            status: 'credential-stored',
            links: {
              usageUrl: 'https://platform.deepseek.com/usage',
              topUpUrl: 'https://platform.deepseek.com/top_up',
            },
            attempt: null,
          },
        };
      },
      async watch() {},
    },
  },
};

moduleExports.apply(ctx);

assert(dictionaries !== undefined, 'locale dictionaries registered');
equal(namespace, 'usage-billing', 'locale namespace');
for (const key of Object.keys(dictionaries.zh)) {
  assert(key in dictionaries.en, `locale key ${key} present in en`);
}

equal(entry.options.name, 'conversation.composer.dock', 'entry slot');
equal(entry.options.id, 'billing', 'entry id');
equal(entry.options.order, 2, 'entry order after host usage pill');
equal(entry.options.locale, 'usage-billing', 'entry locale namespace');
assert(typeof entry.component === 'function', 'entry component');

const t = ctx.locale.bind(namespace);

/** Flatten an element tree into its text content. */
function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (typeof node === 'object') {
    if (node.type === 'portal') return textOf(node.node);
    return textOf(node.children);
  }
  return '';
}

/** Depth-first search for an element with the given prop value. */
function findByProp(node, prop, value) {
  if (node === null || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByProp(child, prop, value);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (node.props?.[prop] === value) return node;
  if (node.type === 'portal') return findByProp(node.node, prop, value);
  return findByProp(node.children, prop, value);
}

const PEAK_TIME = Date.parse('2026-11-04T02:00:00Z'); // Wednesday 10:00 Asia/Shanghai
const IDLE_TIME = Date.parse('2026-11-04T13:00:00Z'); // Wednesday 21:00 Asia/Shanghai

const sample = Object.freeze({
  requests: 12,
  turns: 3,
  provider: 'deepseek-account',
  model: 'deepseek-flash',
  uncachedInputTokens: 1000000,
  cacheReadTokens: 2000000,
  cacheWriteTokens: 0,
  outputTokens: 500000,
  totalTokens: 3500000,
  cost: 0.45,
  periodCost: { peak: 0.3, idle: 0.15 },
  currency: 'CNY',
  prices: Object.freeze({
    peak: Object.freeze({ cacheRead: 0.04, cacheMiss: 2, cacheWrite: 0, output: 8 }),
    idle: Object.freeze({ cacheRead: 0.02, cacheMiss: 1, cacheWrite: 0, output: 4 }),
  }),
  schedule: Object.freeze({
    timeZone: 'Asia/Shanghai',
    peakWindows: Object.freeze([Object.freeze([540, 720]), Object.freeze([840, 1080])]),
    peakWeekdays: Object.freeze([1, 2, 3, 4, 5]),
    holidays: Object.freeze([]),
  }),
  pricing: Object.freeze({
    source: 'docs',
    status: 'live',
    updatedAt: PEAK_TIME,
    error: null,
    holidaySource: 'calendar',
    holidayUpdatedAt: PEAK_TIME,
    holidayError: null,
  }),
});

const render = (nowMs, options = {}) => {
  const realNow = Date.now;
  Date.now = () => nowMs;
  try {
    return entry.component({
      useProjection: (key) => (key === 'usageBilling' ? ('data' in options ? options.data : sample) : undefined),
      t,
    });
  } finally {
    Date.now = realNow;
  }
};

// Closed pill.
openInitially = false;
const pillTree = render(PEAK_TIME);
assert(pillTree !== null, 'component renders with data');
const pill = findByProp(pillTree, 'data-composer-stat', 'billing');
assert(pill !== undefined, 'pill carries data-composer-stat=billing');
const trigger = findByProp(pill, 'aria-haspopup', 'dialog');
assert(trigger !== undefined, 'pill is a dialog trigger');
equal(trigger.props['aria-expanded'], false, 'dialog starts closed');
const pillText = textOf(pillTree);
for (const expected of ['¥0.4500', '12 次', '3.5M tok']) {
  assert(pillText.includes(expected), `pill text contains ${expected}`);
}

// Open dialog at a peak instant, with a ready account balance.
openInitially = true;
fakeBalance = {
  status: 'ready',
  wallets: [{ currency: 'CNY', balance: '100.50' }],
  bonusWallets: [{ currency: 'CNY', balance: '5.25' }],
  updatedAt: PEAK_TIME,
  links: {
    usageUrl: 'https://platform.deepseek.com/usage',
    topUpUrl: 'https://platform.deepseek.com/top_up',
  },
};
const peakTree = render(PEAK_TIME);
const peakTrigger = findByProp(peakTree, 'aria-haspopup', 'dialog');
equal(peakTrigger.props['aria-expanded'], true, 'dialog opens');
const peakPanel = findByProp(peakTree, 'role', 'dialog');
assert(peakPanel !== undefined, 'dialog panel rendered');
const peakText = textOf(peakTree);
for (const expected of [
  '消费金额',
  '剩余金额',
  '¥105.75',
  '充值余额',
  '¥100.50',
  '赠送余额',
  '¥5.25',
  'API 请求次数',
  'Tokens 总计',
  '当前时段价格',
  '高峰时段',
  'deepseek-flash',
  '缓存未命中',
  '¥0.0375',
  '3,500,000',
  '高峰时段消费',
  '空闲时段消费',
  '官方文档',
  '近 30 天',
]) {
  assert(peakText.includes(expected), `peak dialog contains ${expected}`);
}
// The compact dialog drops the per-bucket rows.
for (const removed of ['对话轮次', '输入（未缓存）', '缓存命中率']) {
  assert(!peakText.includes(removed), `peak dialog omits ${removed}`);
}

// The Platform usage link sits at the very bottom and points at the account page.
const platformLink = findByProp(peakTree, 'href', 'https://platform.deepseek.com/usage');
assert(platformLink !== undefined, 'platform usage link rendered');
equal(platformLink.props.target, '_blank', 'platform link opens a new page');
assert(peakText.includes('查看平台用量'), 'platform link text rendered');
assert(peakText.trim().endsWith('查看平台用量 ↗'), 'platform link is the last dialog row');

// The same data at an idle instant shows the idle period and its discount,
// without any new session event.
const idleTree = render(IDLE_TIME);
const idleText = textOf(idleTree);
for (const expected of ['空闲时段', '5 折', '0.02', '1.00']) {
  assert(idleText.includes(expected), `idle dialog contains ${expected}`);
}

// Signed-out account: the remaining row offers the sign-in hint, and without a
// link in the account state no Platform link is invented.
fakeBalance = { status: 'signed-out', wallets: [], bonusWallets: [], updatedAt: null };
const signedOutTree = render(PEAK_TIME);
const signedOutText = textOf(signedOutTree);
assert(signedOutText.includes('登录后查看'), 'signed-out hint shown');
assert(!signedOutText.includes('查看平台用量'), 'no platform link without account links');

// Failed account read: the row offers a retry hint.
fakeBalance = { status: 'failed', wallets: [], bonusWallets: [], updatedAt: null };
const failedText = textOf(render(PEAK_TIME));
assert(failedText.includes('读取失败，点击重试'), 'failed hint shown');

// Empty session: nothing to show.
const hiddenTree = render(PEAK_TIME, { data: { requests: 0, totalTokens: 0 } });
equal(hiddenTree, null, 'component hides before the first model call');

// Capability absent: nothing to show.
const absentTree = render(PEAK_TIME, { data: undefined });
equal(absentTree, null, 'component hides when the projection is absent');

console.log('client test: OK');
