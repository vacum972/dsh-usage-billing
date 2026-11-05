/**
 * Host half of the usage-billing bundle.
 *
 * Folds the durable session log into one whole-log session projection:
 * - `requests` — provider attempts, i.e. calls to the model API (one
 *   `assistant/message` or `assistant/attempt` settlement each, retries included);
 * - `turns` — opened turns;
 * - token buckets — exactly the token-meter fold semantics, so provider-reported
 *   usage replaces the previous sample of the same attempt;
 * - `model`/`provider` — the newest `request/context` route;
 * - `cost` — every attempt priced by the official peak/idle period in force at
 *   that attempt's logged time (plus a per-period split);
 * - the current price table, the peak/idle schedule, and the holiday calendar,
 *   refreshed from DeepSeek's official pricing document.
 *
 * The document and holiday endpoints are Host-only network reads; a failed read
 * keeps the last good table (or the shipped defaults) and reports the failure in
 * the wire view. The Client half reads everything through
 * `useProjection('usageBilling')`.
 *
 * @module @vacum972/dsh-usage-billing
 */

/** Tokens are priced per one million. */
const PRICE_UNIT = 1_000_000;

/** Shipped model price rows; the official table of 2026-11-04. */
const SHIPPED_MODELS = Object.freeze({
  'deepseek-flash': {
    peak: { cacheRead: 0.04, cacheMiss: 2, cacheWrite: 0, output: 8 },
    idle: { cacheRead: 0.02, cacheMiss: 1, cacheWrite: 0, output: 4 },
  },
  'deepseek-v4-pro': {
    peak: { cacheRead: 0.3, cacheMiss: 9, cacheWrite: 0, output: 27 },
    idle: { cacheRead: 0.15, cacheMiss: 4.5, cacheWrite: 0, output: 13.5 },
  },
});

/** Fallback row for a model the official table does not list. */
const SHIPPED_DEFAULT = SHIPPED_MODELS['deepseek-flash'];

/** Legacy model ids the official footnotes bill at Flash prices. */
const MODEL_ALIASES = Object.freeze({
  'deepseek-v4-flash': 'deepseek-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-flash',
});

/** Official pricing document (Chinese markdown source page). */
const OFFICIAL_PRICING_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing.md';

/** Public holiday calendar endpoint; `{year}` is replaced. */
const HOLIDAY_URL = 'https://timor.tech/api/holiday/year/{year}';

/** Peak windows as minutes from local midnight (Beijing 09:00-12:00, 14:00-18:00). */
const DEFAULT_PEAK_WINDOWS = Object.freeze([
  [9 * 60, 12 * 60],
  [14 * 60, 18 * 60],
]);

const DEFAULT_PEAK_WEEKDAYS = Object.freeze([1, 2, 3, 4, 5]);

const isCount = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const finiteNumber = (value, fallback) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;

const asObject = (value) => (value !== null && typeof value === 'object' ? value : {});

const asString = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);

/**
 * Normalize one peak/idle price block, filling unstated fields from a base.
 * @param {unknown} raw
 * @param {{cacheRead:number,cacheMiss:number,cacheWrite:number,output:number}} base
 */
function normalizePrices(raw, base) {
  const source = asObject(raw);
  return {
    cacheRead: finiteNumber(source.cacheRead, base.cacheRead),
    cacheMiss: finiteNumber(source.cacheMiss, base.cacheMiss),
    cacheWrite: finiteNumber(source.cacheWrite, base.cacheWrite),
    output: finiteNumber(source.output, base.output),
  };
}

/**
 * Normalize one model row (`{ peak, idle }`).
 * @param {unknown} raw
 * @param {{peak:object, idle:object}} base
 */
function normalizeModelRow(raw, base) {
  const source = asObject(raw);
  return {
    peak: normalizePrices(source.peak, base.peak),
    idle: normalizePrices(source.idle, base.idle),
  };
}

/** Deep-clone a model row. */
const cloneModelRow = (row) => ({
  peak: { ...row.peak },
  idle: { ...row.idle },
});

/**
 * Parse `'HH:MM-HH:MM'` peak windows into `[startMinutes, endMinutes]` pairs.
 * @param {unknown} raw
 * @param {Array<[number, number]>} fallback
 */
function normalizeWindows(raw, fallback) {
  if (!Array.isArray(raw)) return fallback.map(([start, end]) => [start, end]);
  const windows = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const match = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(entry.trim());
    if (match === null) continue;
    const start = Number(match[1]) * 60 + Number(match[2]);
    const end = Number(match[3]) * 60 + Number(match[4]);
    if (start < 0 || start >= 1440 || end <= start || end > 1440) continue;
    windows.push([start, end]);
  }
  return windows.length > 0 ? windows : fallback.map(([start, end]) => [start, end]);
}

/**
 * Normalize the holiday list (`YYYY-MM-DD` strings).
 * @param {unknown} raw
 */
function normalizeHolidays(raw) {
  if (!Array.isArray(raw)) return [];
  const dates = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && !dates.includes(trimmed)) dates.push(trimmed);
  }
  return dates;
}

/**
 * Normalize the row config. A plugin without a Config export receives the raw
 * patch value, so this is the only validation boundary.
 * @param {unknown} raw
 */
function normalizeConfig(raw) {
  const source = asObject(raw);
  const models = Object.create(null);
  for (const [name, row] of Object.entries(SHIPPED_MODELS)) {
    models[name] = cloneModelRow(row);
  }
  for (const [name, row] of Object.entries(asObject(source.models))) {
    if (typeof name !== 'string' || name === '') continue;
    const base = models[name] ?? SHIPPED_DEFAULT;
    models[name] = normalizeModelRow(row, base);
  }
  const fallback = normalizeModelRow(source.default, SHIPPED_DEFAULT);
  return {
    currency: asString(source.currency) ?? 'CNY',
    timeZone: asString(source.timeZone) ?? 'Asia/Shanghai',
    peakWindows: normalizeWindows(source.peakWindows, DEFAULT_PEAK_WINDOWS),
    peakWeekdays: Array.isArray(source.peakWeekdays)
      ? [...new Set(source.peakWeekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
      : [...DEFAULT_PEAK_WEEKDAYS],
    holidays: normalizeHolidays(source.holidays),
    autoRefresh: source.autoRefresh !== false,
    refreshMinutes: Math.max(1, Math.floor(finiteNumber(source.refreshMinutes, 30))),
    priceUrl: asString(source.priceUrl) ?? OFFICIAL_PRICING_URL,
    holidayUrl: source.holidayUrl === '' ? undefined : (asString(source.holidayUrl) ?? HOLIDAY_URL),
    fetchTimeoutMs: Math.max(1000, Math.floor(finiteNumber(source.fetchTimeoutMs, 15000))),
    models,
    default: fallback,
  };
}

const zeroBuckets = () => ({
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

/**
 * Convert provider usage into the four disjoint prompt-side billing buckets.
 * @param {{inputTokens:number,outputTokens:number,cacheReadTokens?:number,cacheWriteTokens?:number}} usage
 */
const bucketsFrom = (usage) => ({
  uncachedInputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  cacheReadTokens: usage.cacheReadTokens ?? 0,
  cacheWriteTokens: usage.cacheWriteTokens ?? 0,
});

const bucketsEqual = (left, right) =>
  left.uncachedInputTokens === right.uncachedInputTokens &&
  left.outputTokens === right.outputTokens &&
  left.cacheReadTokens === right.cacheReadTokens &&
  left.cacheWriteTokens === right.cacheWriteTokens;

const addReplacing = (totals, previous, next) => ({
  uncachedInputTokens:
    totals.uncachedInputTokens - (previous?.uncachedInputTokens ?? 0) + next.uncachedInputTokens,
  outputTokens: totals.outputTokens - (previous?.outputTokens ?? 0) + next.outputTokens,
  cacheReadTokens: totals.cacheReadTokens - (previous?.cacheReadTokens ?? 0) + next.cacheReadTokens,
  cacheWriteTokens:
    totals.cacheWriteTokens - (previous?.cacheWriteTokens ?? 0) + next.cacheWriteTokens,
});

/**
 * Priced cost of one usage sample under one price block.
 * @param {{uncachedInputTokens:number,outputTokens:number,cacheReadTokens:number,cacheWriteTokens:number}} buckets
 * @param {{cacheRead:number,cacheMiss:number,cacheWrite:number,output:number}} prices
 */
const costOf = (buckets, prices) =>
  (buckets.uncachedInputTokens * prices.cacheMiss +
    buckets.cacheReadTokens * prices.cacheRead +
    buckets.cacheWriteTokens * prices.cacheWrite +
    buckets.outputTokens * prices.output) /
  PRICE_UNIT;

/**
 * The final raw `usage` chunk of one durable attempt settlement.
 * @param {Array<{type:string, chunk?:{type:string, usage?:unknown}}>} stream
 */
function lastUsageChunk(stream) {
  if (!Array.isArray(stream)) return undefined;
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index];
    if (record?.type === 'chunk' && record.chunk?.type === 'usage') return record.chunk.usage;
  }
  return undefined;
}

/**
 * The usage one durable Assistant settlement reports for its attempt, if any.
 * Mirrors the token meter: an explicit final sample wins over the streamed one,
 * and malformed samples are ignored instead of corrupting the projection.
 * @param {{type:string, data:any}} event
 */
function usageOf(event) {
  const sample =
    event.type === 'assistant/message'
      ? (event.data?.usage ?? lastUsageChunk(event.data?.stream))
      : lastUsageChunk(event.data?.stream);
  if (sample === null || typeof sample !== 'object') return undefined;
  const { inputTokens, outputTokens } = sample;
  if (!isCount(inputTokens) || !isCount(outputTokens)) return undefined;
  const cacheReadTokens = sample.cacheReadTokens ?? 0;
  const cacheWriteTokens = sample.cacheWriteTokens ?? 0;
  if (!isCount(cacheReadTokens) || !isCount(cacheWriteTokens)) return undefined;
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens };
}

// ---------------------------------------------------------------------------
// Time-slot pricing
// ---------------------------------------------------------------------------

/** Weekday index from the short English weekday name. */
const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Build a clock that reports the wall time in one IANA time zone.
 * @param {string} timeZone
 * @returns {(ms:number) => {date:string, weekday:number, minutes:number}}
 */
function makeClock(timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  return (ms) => {
    const parts = {};
    for (const part of formatter.formatToParts(new Date(ms))) {
      if (part.type !== 'literal') parts[part.type] = part.value;
    }
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
      minutes: Number(parts.hour) * 60 + Number(parts.minute),
    };
  };
}

/**
 * The official period at one instant: `'peak'` during a configured weekday
 * window that is not a statutory holiday, `'idle'` otherwise.
 * Exported for the tests, like {@link parsePricingMarkdown}.
 * @param {(ms:number)=>{date:string, weekday:number, minutes:number}} clock
 * @param {Set<string>} holidays - statutory holiday dates (`YYYY-MM-DD`).
 * @param {{peakWindows:Array<[number,number]>, peakWeekdays:number[]}} schedule
 * @param {number} ms - epoch milliseconds.
 * @returns {'peak'|'idle'}
 */
export function resolvePricingPeriod(clock, holidays, schedule, ms) {
  const local = clock(Number.isFinite(ms) ? ms : Date.now());
  if (holidays.has(local.date)) return 'idle';
  if (!schedule.peakWeekdays.includes(local.weekday)) return 'idle';
  for (const [start, end] of schedule.peakWindows) {
    if (local.minutes >= start && local.minutes < end) return 'peak';
  }
  return 'idle';
}

/**
 * Parse the official Chinese pricing markdown into model price rows.
 * Exported for the tests and for maintainers checking the parser against a new page.
 * @param {string} markdown - document source.
 * @returns {Record<string,{peak:object, idle:object}>}
 * @throws when the header or any expected price row is missing.
 */
export function parsePricingMarkdown(markdown) {
  const lines = String(markdown ?? '').split(/\r?\n/);
  const header = lines.find((line) => line.includes('|') && line.includes('模型') && /deepseek-/.test(line));
  if (header === undefined) throw new Error('pricing: model header not found');
  const models = [];
  for (const cell of splitTableRow(header)) {
    const match = /^(deepseek-[a-z0-9-]+)/i.exec(cell);
    if (match !== null && !models.includes(match[1])) models.push(match[1]);
  }
  if (models.length === 0) throw new Error('pricing: no model columns found');

  const rows = Object.create(null);
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    const cells = splitTableRow(line);
    if (cells.length < 3 + models.length) continue;
    if (!cells[0].startsWith('价格')) continue;
    const category = cells[1] ?? '';
    const period = cells[2] ?? '';
    const bucket = /缓存命中/.test(category)
      ? 'cacheRead'
      : /缓存未命中/.test(category)
        ? 'cacheMiss'
        : /输出/.test(category)
          ? 'output'
          : null;
    const kind = /空闲/.test(period) ? 'idle' : /高峰/.test(period) ? 'peak' : null;
    if (bucket === null || kind === null) continue;
    const values = cells.slice(3, 3 + models.length);
    models.forEach((model, index) => {
      const value = parseMoney(values[index]);
      if (value === null) return;
      if (rows[model] === undefined) rows[model] = { peak: {}, idle: {} };
      rows[model][kind][bucket] = value;
    });
  }

  for (const model of models) {
    const row = rows[model];
    if (row === undefined) throw new Error(`pricing: no price rows for ${model}`);
    for (const kind of ['peak', 'idle']) {
      for (const bucket of ['cacheRead', 'cacheMiss', 'output']) {
        if (typeof row[kind][bucket] !== 'number') {
          throw new Error(`pricing: ${model} ${kind} ${bucket} price missing`);
        }
      }
      // DeepSeek does not bill cache writes; the table has no row for them.
      row[kind].cacheWrite = 0;
    }
  }
  return rows;
}

/** Split a markdown table row into trimmed cells, dropping the outer pipes. */
function splitTableRow(line) {
  const cells = line.split('|');
  if (cells.length > 2) return cells.slice(1, -1).map((cell) => cell.trim());
  return cells.map((cell) => cell.trim());
}

/** Parse one price cell such as `0.02元`, `4.5元`, or `2`. */
function parseMoney(cell) {
  const match = /([0-9]+(?:\.[0-9]+)?)/.exec(String(cell ?? ''));
  return match === null ? null : Number(match[1]);
}

/**
 * Parse one year of holiday JSON into statutory holiday date keys.
 * @param {unknown} payload - `{ holiday: { 'MM-DD': { holiday: boolean } } }`.
 * @param {number} year
 */
export function parseHolidayYear(payload, year) {
  const holiday = asObject(asObject(payload).holiday);
  const dates = [];
  for (const [key, value] of Object.entries(holiday)) {
    if (asObject(value).holiday !== true) continue;
    const match = /^(\d{2})-(\d{2})$/.exec(key);
    if (match === null) continue;
    const date = `${year}-${match[1]}-${match[2]}`;
    if (!dates.includes(date)) dates.push(date);
  }
  return dates;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

const stateSchema = {
  parse(value) {
    if (value === null || typeof value !== 'object') throw new Error('usage-billing: state must be an object');
    if (!isCount(value.requests)) throw new Error('usage-billing: invalid request count');
    if (!isCount(value.turns)) throw new Error('usage-billing: invalid turn count');
    if (typeof value.cost !== 'number' || !Number.isFinite(value.cost) || value.cost < 0) {
      throw new Error('usage-billing: invalid accumulated cost');
    }
    for (const key of ['peak', 'idle']) {
      const part = value.periodCost?.[key];
      if (typeof part !== 'number' || !Number.isFinite(part) || part < 0) {
        throw new Error(`usage-billing: invalid ${key} period cost`);
      }
    }
    const totals = value.totals ?? {};
    for (const key of ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']) {
      if (!isCount(totals[key])) throw new Error(`usage-billing: invalid token bucket ${key}`);
    }
    return value;
  },
};

const viewSchema = {
  parse(value) {
    if (value === null || typeof value !== 'object') throw new Error('usage-billing: view must be an object');
    if (!isCount(value.requests) || !isCount(value.turns)) throw new Error('usage-billing: invalid counters');
    if (typeof value.totalTokens !== 'number' || !Number.isFinite(value.totalTokens)) {
      throw new Error('usage-billing: invalid token total');
    }
    if (typeof value.cost !== 'number' || !Number.isFinite(value.cost)) {
      throw new Error('usage-billing: invalid cost');
    }
    if (typeof value.currency !== 'string') throw new Error('usage-billing: invalid currency');
    if (value.prices === null || typeof value.prices !== 'object') {
      throw new Error('usage-billing: invalid price table');
    }
    if (value.schedule === null || typeof value.schedule !== 'object') {
      throw new Error('usage-billing: invalid schedule');
    }
    return value;
  },
};

/** Services required by this Host half. */
export const inject = ['sessionProjections'];

/**
 * Register the `usageBilling` session projection.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host plugin context.
 * @param {unknown} config - this row's config from the loader patch.
 */
export function apply(ctx, config) {
  const settings = normalizeConfig(config);
  const clock = makeClock(settings.timeZone);

  /** Current model rows; the shipped/config rows until the official document parses. */
  let priceTable = {
    models: settings.models,
    fallback: settings.default,
    source: 'config',
    status: 'fallback',
    updatedAt: null,
    error: null,
  };
  /** Statutory holiday dates in the configured time zone; configured values until the calendar reads. */
  let holidays = new Set(settings.holidays);
  let holidaySource = 'config';
  let holidayUpdatedAt = null;
  let holidayError = null;
  /** Bumped on every successful refresh so views are rebuilt on the next publication. */
  let pricingRevision = 0;
  /** When the last refresh attempt started; shown as a tooltip on failure warnings. */
  let refreshAttemptedAt = null;

  /**
   * Resolve the price row for one model id (aliases included).
   * @param {string|null} model
   */
  const modelRow = (model) => {
    const id = model === null ? null : (MODEL_ALIASES[model] ?? model);
    return (id !== null && priceTable.models[id]) || priceTable.fallback;
  };

  /**
   * Resolve the price block for one model and period.
   * @param {string|null} model
   * @param {'peak'|'idle'} period
   */
  const priceBlock = (model, period) => modelRow(model)[period === 'peak' ? 'peak' : 'idle'];

  /**
   * Fetch text with a bounded timeout.
   * @param {string} url
   */
  const fetchText = async (url) => {
    const response = await fetch(url, {
      headers: {
        'user-agent': 'dsh-usage-billing/1.1 (+plugin)',
        accept: 'text/markdown,text/plain,application/json',
      },
      signal: AbortSignal.timeout(settings.fetchTimeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  };

  /** Read the official pricing document into the in-memory table. */
  const refreshPricing = async () => {
    if (settings.priceUrl === '') return;
    try {
      const markdown = await fetchText(settings.priceUrl);
      const models = parsePricingMarkdown(markdown);
      // Keep configured rows for models the document does not list.
      const merged = Object.create(null);
      for (const [name, row] of Object.entries(settings.models)) merged[name] = cloneModelRow(row);
      for (const [name, row] of Object.entries(models)) {
        merged[name] = {
          peak: { ...row.peak },
          idle: { ...row.idle },
        };
      }
      priceTable = {
        models: merged,
        fallback: settings.default,
        source: 'docs',
        status: 'live',
        updatedAt: Date.now(),
        error: null,
      };
      pricingRevision += 1;
    } catch (error) {
      priceTable = {
        ...priceTable,
        status: priceTable.source === 'docs' ? 'stale' : 'fallback',
        error: String(error?.message ?? error),
      };
      pricingRevision += 1;
    }
  };

  /** Read statutory holidays for the current and (late in the year) next year. */
  const refreshHolidays = async () => {
    if (settings.holidayUrl === undefined) return;
    const now = clock(Date.now());
    const year = Number(now.date.slice(0, 4));
    const years = [year];
    if (now.date.slice(5, 7) >= '11') years.push(year + 1);
    try {
      const dates = new Set(settings.holidays);
      let readAny = false;
      for (const targetYear of years) {
        try {
          const text = await fetchText(settings.holidayUrl.replace('{year}', String(targetYear)));
          for (const date of parseHolidayYear(JSON.parse(text), targetYear)) dates.add(date);
          readAny = true;
        } catch (error) {
          if (targetYear === year) throw error;
        }
      }
      holidays = dates;
      holidaySource = 'calendar';
      holidayUpdatedAt = Date.now();
      holidayError = null;
      pricingRevision += 1;
      if (!readAny) throw new Error('holiday calendar: no year read');
    } catch (error) {
      holidayError = String(error?.message ?? error);
      pricingRevision += 1;
    }
  };

  /** Refresh every external input; never throws. */
  const refreshAll = async () => {
    refreshAttemptedAt = Date.now();
    await Promise.all([refreshPricing(), refreshHolidays()]);
  };

  if (settings.autoRefresh) {
    ctx.effect(() => {
      let disposed = false;
      let timer;
      const healthy = () =>
        (settings.priceUrl === '' || priceTable.status === 'live') &&
        (settings.holidayUrl === undefined || holidayError === null);
      const schedule = (delayMs) => {
        timer = setTimeout(() => void run(), delayMs);
        if (typeof timer.unref === 'function') timer.unref();
      };
      const run = async () => {
        if (disposed) return;
        // Refresh failures are already reflected in the wire view; never leak a rejection.
        await refreshAll().catch(() => {});
        if (disposed) return;
        // A failed attempt (transient network, proxy not ready at startup) retries
        // after two minutes instead of waiting a full refresh period.
        schedule(healthy() ? settings.refreshMinutes * 60_000 : 120_000);
      };
      void run();
      return () => {
        disposed = true;
        clearTimeout(timer);
      };
    });
  }

  const viewCache = new WeakMap();

  /**
   * Build, cache, and return the wire view of one state.
   * The cache keeps `Object.is` stable while both the state and the refreshed
   * pricing remain unchanged, which is what suppresses needless publication.
   * @param {object} state
   */
  const buildView = (state) => {
    const cached = viewCache.get(state);
    if (cached !== undefined && cached.revision === pricingRevision) return cached.value;
    const row = modelRow(state.model);
    const totals = state.totals;
    const totalTokens =
      totals.uncachedInputTokens +
      totals.cacheReadTokens +
      totals.cacheWriteTokens +
      totals.outputTokens;
    const value = Object.freeze({
      requests: state.requests,
      turns: state.turns,
      provider: state.provider,
      model: state.model,
      uncachedInputTokens: totals.uncachedInputTokens,
      cacheReadTokens: totals.cacheReadTokens,
      cacheWriteTokens: totals.cacheWriteTokens,
      outputTokens: totals.outputTokens,
      totalTokens,
      cost: Math.round(state.cost * 1e8) / 1e8,
      periodCost: {
        peak: Math.round(state.periodCost.peak * 1e8) / 1e8,
        idle: Math.round(state.periodCost.idle * 1e8) / 1e8,
      },
      currency: settings.currency,
      prices: Object.freeze({
        peak: Object.freeze({ ...row.peak }),
        idle: Object.freeze({ ...row.idle }),
      }),
      schedule: Object.freeze({
        timeZone: settings.timeZone,
        peakWindows: Object.freeze(settings.peakWindows.map(([start, end]) => Object.freeze([start, end]))),
        peakWeekdays: Object.freeze([...settings.peakWeekdays]),
        holidays: Object.freeze([...holidays].sort()),
      }),
      pricing: Object.freeze({
        source: priceTable.source,
        status: priceTable.status,
        updatedAt: priceTable.updatedAt,
        attemptedAt: refreshAttemptedAt,
        error: priceTable.error,
        holidaySource,
        holidayUpdatedAt,
        holidayError,
      }),
    });
    viewCache.set(state, { revision: pricingRevision, value });
    return value;
  };

  /** One attempt settlement's priced contribution. */
  const pricedSample = (state, buckets, period) => {
    const prices = priceBlock(state.model, period);
    return costOf(buckets, prices);
  };

  const definition = {
    key: 'usageBilling',
    stateVersion: 3,
    stateSchema,
    init: () => ({
      requests: 0,
      turns: 0,
      provider: null,
      model: null,
      cost: 0,
      periodCost: { peak: 0, idle: 0 },
      totals: zeroBuckets(),
      last: null,
    }),
    /**
     * Fold one committed session event.
     * @param {object} state - previous state.
     * @param {{type:string, data:any, time?:number}} event - committed event.
     */
    apply: (state, event) => {
      switch (event.type) {
        case 'turn/start':
          return { ...state, turns: state.turns + 1 };
        case 'request/context': {
          const provider = typeof event.data?.provider === 'string' ? event.data.provider : null;
          const model = typeof event.data?.model === 'string' ? event.data.model : null;
          if (provider === state.provider && model === state.model) return state;
          return { ...state, provider, model };
        }
        case 'llm/retry-started':
          if (state.last === null) return state;
          if (state.last.turn !== event.data?.turn || state.last.step !== event.data?.step) return state;
          // A retried attempt starts a new replacement slot, so the next sample adds.
          return { ...state, last: null };
        case 'assistant/message':
        case 'assistant/attempt': {
          const turn = event.data?.turn;
          const step = event.data?.step;
          // Every settlement is one provider attempt, failed retries included.
          const next = { ...state, requests: state.requests + 1 };
          const sample = usageOf(event);
          if (sample === undefined) return next;
          const buckets = bucketsFrom(sample);
          const previous =
            state.last !== null && state.last.turn === turn && state.last.step === step
              ? state.last
              : undefined;
          if (previous !== undefined && bucketsEqual(previous.buckets, buckets)) return next;
          // Price the sample with the route and official time slot that produced it.
          const period = resolvePricingPeriod(clock, holidays, settings, event.time);
          const contribution = pricedSample(state, buckets, period);
          const previousCost = previous === undefined ? 0 : (previous.cost ?? 0);
          const previousPeriod = previous === undefined ? null : (previous.period ?? 'idle');
          const periodCost = { ...state.periodCost };
          if (previousPeriod !== null) {
            periodCost[previousPeriod] = Math.max(0, periodCost[previousPeriod] - previousCost);
          }
          periodCost[period] += contribution;
          return {
            ...next,
            cost: Math.max(0, state.cost - previousCost + contribution),
            periodCost,
            totals: addReplacing(state.totals, previous?.buckets, buckets),
            last: { turn, step, buckets, cost: contribution, period },
          };
        }
        default:
          return state;
      }
    },
    wire: {
      viewSchema,
      view: buildView,
    },
  };

  ctx.effect(() => {
    const dispose = ctx.sessionProjections.register(definition);
    return () => {
      if (typeof dispose === 'function') dispose();
    };
  });
}
