/**
 * Host-half unit test for the usage-billing bundle.
 *
 * Drives the registered `usageBilling` projection definition with synthetic
 * session events whose logged times select the official peak/idle period, then
 * checks counters, token buckets, per-period cost, the schedule payload, and the
 * view identity contract. Run: node tests/host.test.mjs
 */
const mod = await import(new URL('../index.js', import.meta.url).href);

if (typeof globalThis.fetch !== 'function') {
  // The plugin never fetches when autoRefresh is false; keep the import safe anyway.
  globalThis.fetch = async () => {
    throw new Error('network disabled in tests');
  };
}

/** Apply the Host half and capture the projection definition. */
function install(config) {
  let definition;
  const ctx = {
    effect(fn) {
      return fn();
    },
    sessionProjections: {
      register(def) {
        definition = def;
        return () => {};
      },
    },
  };
  mod.apply(ctx, config);
  return definition;
}

const assert = (condition, message) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
};
const equal = (actual, expected, message) => {
  if (actual !== expected) throw new Error(`FAIL: ${message}: expected ${expected}, got ${actual}`);
};
const close = (actual, expected, message) => {
  if (Math.abs(actual - expected) > 1e-9) throw new Error(`FAIL: ${message}: expected ${expected}, got ${actual}`);
};

const PEAK_TIME = Date.parse('2026-11-04T02:00:00Z'); // Wednesday 10:00 Asia/Shanghai
const IDLE_TIME = Date.parse('2026-11-04T13:00:00Z'); // Wednesday 21:00 Asia/Shanghai
const WEEKEND_TIME = Date.parse('2026-11-07T02:00:00Z'); // Saturday 10:00 Asia/Shanghai

/** Distinct peak/idle prices so every assertion proves the slot was applied. */
const CONFIG = {
  autoRefresh: false,
  currency: 'CNY',
  timeZone: 'Asia/Shanghai',
  peakWindows: ['09:00-12:00', '14:00-18:00'],
  peakWeekdays: [1, 2, 3, 4, 5],
  models: {
    'deepseek-flash': {
      peak: { cacheRead: 0.04, cacheMiss: 2, cacheWrite: 0, output: 8 },
      idle: { cacheRead: 0.02, cacheMiss: 1, cacheWrite: 0, output: 4 },
    },
  },
  default: {
    peak: { cacheRead: 0.3, cacheMiss: 10, cacheWrite: 0, output: 20 },
    idle: { cacheRead: 0.15, cacheMiss: 5, cacheWrite: 0, output: 10 },
  },
};

const definition = install(CONFIG);
assert(definition !== undefined, 'projection registered');
equal(definition.key, 'usageBilling', 'projection key');
equal(definition.stateVersion, 3, 'state version');

// --- fold ---------------------------------------------------------------
let state = definition.init({}, 0);
const drive = (event) => {
  state = definition.apply(state, event);
  definition.stateSchema.parse(state);
  return state;
};

const before = state;
equal(drive({ type: 'user/message', data: {}, time: PEAK_TIME }), before, 'unrelated event keeps state reference');

drive({ type: 'request/context', data: { provider: 'deepseek-account', model: 'deepseek-flash' }, time: PEAK_TIME });
equal(state.model, 'deepseek-flash', 'model folded from request/context');
equal(state.provider, 'deepseek-account', 'provider folded');

drive({ type: 'turn/start', data: { turn: 1 }, time: PEAK_TIME });
equal(state.turns, 1, 'turn counted');

// Peak attempt: 100000*2 + 400000*0.04 + 50000*8 = 0.616 CNY.
drive({
  type: 'assistant/message',
  data: {
    turn: 1,
    step: 1,
    usage: { inputTokens: 100000, outputTokens: 50000, cacheReadTokens: 400000 },
    stream: [],
  },
  time: PEAK_TIME,
});
equal(state.requests, 1, 'first attempt counted');
close(state.cost, 0.616, 'peak-period cost');
close(state.periodCost.peak, 0.616, 'peak bucket');
close(state.periodCost.idle, 0, 'idle bucket empty');

// A retried attempt settles at an idle instant: 1000*1 + 200*4 = 0.0018 CNY.
drive({ type: 'llm/retry-started', data: { turn: 1, step: 1 }, time: IDLE_TIME });
equal(state.last, null, 'retry resets the replacement slot');
drive({
  type: 'assistant/attempt',
  data: {
    turn: 1,
    step: 1,
    stream: [{ type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 1000, outputTokens: 200 } } }],
  },
  time: IDLE_TIME,
});
equal(state.requests, 2, 'retried attempt counted');
close(state.cost, 0.6178, 'cost adds idle-priced retry');
close(state.periodCost.idle, 0.0018, 'idle bucket holds the retry');

// A later attempt at an idle instant: 10*1 + 30*0.02 + 20*4 = 0.0000906 CNY.
drive({
  type: 'assistant/message',
  data: {
    turn: 1,
    step: 2,
    usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40 },
    stream: [],
  },
  time: IDLE_TIME,
});
equal(state.requests, 3, 'third attempt counted');
close(state.cost, 0.6178906, 'mixed-period cost total');

// --- view ---------------------------------------------------------------
const view = definition.wire.view(state);
definition.wire.viewSchema.parse(view);

equal(view.requests, 3, 'view requests');
equal(view.turns, 1, 'view turns');
equal(view.totalTokens, 101010 + 400030 + 40 + 50220, 'view total tokens');
close(view.cost, 0.6178906, 'view cost');
close(view.periodCost.peak, 0.616, 'view peak bucket');
close(view.periodCost.idle, 0.0018906, 'view idle bucket');
equal(view.prices.peak.cacheMiss, 2, 'view peak prices');
equal(view.prices.idle.cacheMiss, 1, 'view idle prices');
equal(view.prices.idle.cacheRead, 0.02, 'view idle cache-hit price');
equal(view.currency, 'CNY', 'view currency');
equal(view.schedule.timeZone, 'Asia/Shanghai', 'view time zone');
equal(view.schedule.peakWindows.length, 2, 'view peak windows');
equal(view.schedule.peakWeekdays.join(','), '1,2,3,4,5', 'view peak weekdays');
equal(view.schedule.holidays.length, 0, 'view holidays');
equal(view.pricing.source, 'config', 'view pricing source');
equal(view.pricing.status, 'fallback', 'view pricing status');
assert(definition.wire.view(state) === view, 'view reference stable for one state and revision');

// --- period selection ---------------------------------------------------
// A weekend instant is idle even inside a peak window.
const weekendDefinition = install(CONFIG);
let weekend = weekendDefinition.init({}, 0);
weekend = weekendDefinition.apply(weekend, { type: 'request/context', data: { provider: 'p', model: 'deepseek-flash' }, time: WEEKEND_TIME });
weekend = weekendDefinition.apply(weekend, {
  type: 'assistant/message',
  data: { turn: 1, step: 1, usage: { inputTokens: 1000000, outputTokens: 0 }, stream: [] },
  time: WEEKEND_TIME,
});
close(weekend.periodCost.idle, 1, 'weekend usage priced idle');

// A configured statutory holiday turns a weekday peak window into idle.
const holidayDefinition = install({ ...CONFIG, holidays: ['2026-11-04'] });
let holiday = holidayDefinition.init({}, 0);
holiday = holidayDefinition.apply(holiday, { type: 'request/context', data: { provider: 'p', model: 'deepseek-flash' }, time: PEAK_TIME });
holiday = holidayDefinition.apply(holiday, {
  type: 'assistant/message',
  data: { turn: 1, step: 1, usage: { inputTokens: 1000000, outputTokens: 0 }, stream: [] },
  time: PEAK_TIME,
});
close(holiday.periodCost.idle, 1, 'holiday usage priced idle');
close(holiday.periodCost.peak, 0, 'holiday adds no peak cost');

// Unknown model falls back to the configured default row.
const fallbackDefinition = install(CONFIG);
let fallback = fallbackDefinition.init({}, 0);
fallback = fallbackDefinition.apply(fallback, { type: 'request/context', data: { provider: 'p', model: 'made-up-model' }, time: PEAK_TIME });
fallback = fallbackDefinition.apply(fallback, {
  type: 'assistant/message',
  data: { turn: 1, step: 1, usage: { inputTokens: 1000000, outputTokens: 0 }, stream: [] },
  time: PEAK_TIME,
});
const fallbackView = fallbackDefinition.wire.view(fallback);
close(fallback.periodCost.peak, 10, 'unknown model uses the default peak row');
equal(fallbackView.prices.peak.cacheMiss, 10, 'fallback prices exposed');

// Replacement reprices the attempt under its own period.
const replaceDefinition = install(CONFIG);
let replaced = replaceDefinition.init({}, 0);
replaced = replaceDefinition.apply(replaced, { type: 'request/context', data: { provider: 'p', model: 'deepseek-flash' }, time: PEAK_TIME });
replaced = replaceDefinition.apply(replaced, {
  type: 'assistant/message',
  data: { turn: 1, step: 1, usage: { inputTokens: 1000000, outputTokens: 0 }, stream: [] },
  time: PEAK_TIME,
});
close(replaced.cost, 2, 'initial peak sample priced');
replaced = replaceDefinition.apply(replaced, {
  type: 'assistant/message',
  data: { turn: 1, step: 1, usage: { inputTokens: 2000000, outputTokens: 0 }, stream: [] },
  time: PEAK_TIME,
});
close(replaced.cost, 4, 'replacement reprices the whole attempt');
equal(replaced.periodCost.peak, 4, 'replacement keeps one peak contribution');
equal(replaced.totals.uncachedInputTokens, 2000000, 'replacement replaces token buckets');

// Malformed state is rejected before it can be checkpointed.
for (const broken of [
  { requests: -1, turns: 0, cost: 0, periodCost: { peak: 0, idle: 0 }, totals: {} },
  { requests: 0, turns: 0, cost: 0, periodCost: { peak: 0, idle: 0 }, totals: {} },
]) {
  let rejected = false;
  try {
    definition.stateSchema.parse(broken);
  } catch {
    rejected = true;
  }
  assert(rejected, 'state schema rejects invalid state');
}

console.log('host test: OK');
console.log(
  JSON.stringify({
    requests: view.requests,
    totalTokens: view.totalTokens,
    cost: view.cost,
    periodCost: view.periodCost,
  }),
);
