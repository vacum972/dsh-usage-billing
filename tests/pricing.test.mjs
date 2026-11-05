/**
 * Parser and period-rule tests for the usage-billing bundle.
 *
 * The pricing fixture is the official table of 2026-11-04 (peak/idle columns).
 * Run: node tests/pricing.test.mjs
 */
const mod = await import(new URL('../index.js', import.meta.url).href);

const assert = (condition, message) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
};
const equal = (actual, expected, message) => {
  if (actual !== expected) throw new Error(`FAIL: ${message}: expected ${expected}, got ${actual}`);
};

const FIXTURE = `# 模型 & 价格

## 模型细节

| 模型                      | 模型                    | 模型                    | deepseek-flash(1) | deepseek-v4-pro |
| ----------------------- | --------------------- | --------------------- | ----------------- | --------------- |
| 价格(2)                   | 百万tokens输入 / （缓存命中）  | 空闲时段                  | 0.02元            | 0.15元          |
| 价格(2)                   | 百万tokens输入 / （缓存命中）  | 高峰时段                  | 0.04元            | 0.30元          |
| 价格(2)                   | 百万tokens输入 / （缓存未命中） | 空闲时段                  | 1元               | 4.5元           |
| 价格(2)                   | 百万tokens输入 / （缓存未命中） | 高峰时段                  | 2元               | 9.0元           |
| 价格(2)                   | 百万tokens输出             | 空闲时段                  | 4元               | 13.5元          |
| 价格(2)                   | 百万tokens输出             | 高峰时段                  | 8元               | 27.0元          |
| 并发限制(3)                 | 并发限制(3)               | 并发限制(3)               | 2500              | 500             |
`;

const parsed = mod.parsePricingMarkdown(FIXTURE);
equal(parsed['deepseek-flash'].peak.cacheRead, 0.04, 'flash peak cache-hit price');
equal(parsed['deepseek-flash'].idle.cacheRead, 0.02, 'flash idle cache-hit price');
equal(parsed['deepseek-flash'].peak.cacheMiss, 2, 'flash peak cache-miss price');
equal(parsed['deepseek-flash'].idle.cacheMiss, 1, 'flash idle cache-miss price');
equal(parsed['deepseek-flash'].peak.output, 8, 'flash peak output price');
equal(parsed['deepseek-flash'].idle.output, 4, 'flash idle output price');
equal(parsed['deepseek-flash'].peak.cacheWrite, 0, 'flash cache-write is not billed');
equal(parsed['deepseek-v4-pro'].peak.cacheMiss, 9, 'pro peak cache-miss price');
equal(parsed['deepseek-v4-pro'].idle.cacheMiss, 4.5, 'pro idle cache-miss price');
equal(parsed['deepseek-v4-pro'].peak.output, 27, 'pro peak output price');
equal(parsed['deepseek-v4-pro'].idle.output, 13.5, 'pro idle output price');

// An incomplete document is rejected instead of poisoning the table.
let rejected = false;
try {
  mod.parsePricingMarkdown('| 模型 | 模型 | deepseek-flash(1) |\n| --- | --- | --- |\n| 价格(2) | 百万tokens输入 / （缓存命中） | 空闲时段 | 0.02元 |');
} catch {
  rejected = true;
}
assert(rejected, 'pricing parser rejects an incomplete table');
let emptyRejected = false;
try {
  mod.parsePricingMarkdown('');
} catch {
  emptyRejected = true;
}
assert(emptyRejected, 'pricing parser rejects an empty document');

// Holiday calendar parsing keeps statutory holidays and drops make-up workdays.
const holidayPayload = {
  code: 0,
  holiday: {
    '01-01': { holiday: true, name: '元旦' },
    '01-02': { holiday: true, name: '元旦' },
    '01-04': { holiday: false, name: '元旦后补班' },
    '02-14': { holiday: false, name: '春节前补班' },
    '02-15': { holiday: true, name: '春节' },
    '02-28': { holiday: false, name: '春节后补班' },
  },
};
const holidays = mod.parseHolidayYear(holidayPayload, 2026);
equal(holidays.join(','), '2026-01-01,2026-01-02,2026-02-15', 'holiday parser keeps only statutory holidays');

// Period resolution follows the published rule: weekdays in a peak window are
// peak unless the date is a statutory holiday.
const schedule = { peakWindows: [[540, 720], [840, 1080]], peakWeekdays: [1, 2, 3, 4, 5] };
const peakClock = () => ({ date: '2026-11-04', weekday: 3, minutes: 600 });
const lunchClock = () => ({ date: '2026-11-04', weekday: 3, minutes: 780 }); // 13:00, between windows
const weekendClock = () => ({ date: '2026-11-07', weekday: 6, minutes: 600 });
equal(mod.resolvePricingPeriod(peakClock, new Set(), schedule, 0), 'peak', 'weekday 10:00 is peak');
equal(mod.resolvePricingPeriod(peakClock, new Set(['2026-11-04']), schedule, 0), 'idle', 'statutory holiday is idle');
equal(mod.resolvePricingPeriod(peakClock, new Set(), { ...schedule, peakWeekdays: [6] }, 0), 'idle', 'other weekday is idle');
equal(mod.resolvePricingPeriod(lunchClock, new Set(), schedule, 0), 'idle', 'lunch gap is idle');
equal(mod.resolvePricingPeriod(weekendClock, new Set(), schedule, 0), 'idle', 'weekend is idle');
equal(mod.resolvePricingPeriod(() => ({ date: '2026-11-04', weekday: 3, minutes: 540 }), new Set(), schedule, 0), 'peak', 'window start is peak');
equal(mod.resolvePricingPeriod(() => ({ date: '2026-11-04', weekday: 3, minutes: 720 }), new Set(), schedule, 0), 'idle', 'window end is idle');

console.log('pricing test: OK');
