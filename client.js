/**
 * Browser half of the usage-billing bundle.
 *
 * Registers one pill in `conversation.composer.dock` (order 2, after the host
 * `activity` and `usage` pills). The pill reads the Host `usageBilling` session
 * projection through the slot's `useProjection` hook; the dialog additionally
 * reads the signed-in account's recharge/bonus wallets through the account
 * Remote namespace (`ctx.remote.account.getBalance`) and keeps them fresh.
 *
 * The current peak/idle period is computed locally from the schedule the Host
 * publishes plus the browser clock, so the price shown follows the real clock
 * even between session events.
 */
window.__ModuleLoader__.load({
  id: '@vacum972/dsh-usage-billing',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;

    /** Locale namespace owned by this plugin. */
    const NS = 'usage-billing';

    const zh = {
      'pill.requests': '{count} 次',
      'pill.tokens': '{tokens} tok',
      'dialog.title': '用量与计费',
      'dialog.subtitle': '本会话累计 · 实时更新',
      'dialog.cost': '消费金额',
      'dialog.remaining': '剩余金额',
      'dialog.recharge': '充值余额',
      'dialog.bonus': '赠送余额',
      'dialog.balanceLoading': '读取中…',
      'dialog.balanceSignedOut': '登录后查看',
      'dialog.balanceFailed': '读取失败，点击重试',
      'dialog.balanceUnavailable': '不可用',
      'dialog.balanceUpdated': '{time} 更新',
      'dialog.balanceNote': '扣费优先使用赠送余额。',
      'dialog.requests': 'API 请求次数',
      'dialog.times': '{count} 次',
      'dialog.tokensTotal': 'Tokens 总计',
      'dialog.cacheRead': '缓存命中',
      'dialog.cacheWrite': '缓存写入',
      'dialog.output': '输出',
      'dialog.perRequest': '平均每次请求',
      'dialog.peakCost': '高峰时段消费',
      'dialog.idleCost': '空闲时段消费',
      'dialog.priceTitle': '当前时段价格',
      'dialog.period.peak': '高峰时段',
      'dialog.period.idle': '空闲时段',
      'dialog.period.discount': '{ratio} 折',
      'dialog.cacheMiss': '缓存未命中',
      'dialog.model': '模型',
      'dialog.unit': '{currency} / 百万 tokens',
      'dialog.source.docs': '官方文档',
      'dialog.source.config': '内置价目',
      'dialog.source.stale': '上次成功价目',
      'dialog.priceUpdated': '{time} 更新',
      'dialog.priceFailed': '价目自动更新失败，正在使用 {source}。',
      'dialog.holidayFailed': '节假日日历更新失败，高峰期判断可能包含法定节假日。',
      'dialog.peakReference': '高峰价：命中 {cacheRead} · 未命中 {cacheMiss} · 输出 {output}',
      'dialog.note': '本会话估算；平台「用量信息」为近 30 天全部会话合计，且不含 Search/Fetch 按次费。',
      'dialog.platformUsage': '查看平台用量 ↗',
      'a11y.dialog': '用量与计费详情',
      'a11y.pill': '用量与计费：{label}',
      'a11y.refresh': '刷新剩余金额',
    };

    const en = {
      'pill.requests': '{count} req',
      'pill.tokens': '{tokens} tok',
      'dialog.title': 'Usage & Billing',
      'dialog.subtitle': 'This session · live',
      'dialog.cost': 'Spend',
      'dialog.remaining': 'Remaining',
      'dialog.recharge': 'Topped-up balance',
      'dialog.bonus': 'Granted balance',
      'dialog.balanceLoading': 'Loading…',
      'dialog.balanceSignedOut': 'Sign in to view',
      'dialog.balanceFailed': 'Read failed, tap to retry',
      'dialog.balanceUnavailable': 'Unavailable',
      'dialog.balanceUpdated': 'updated {time}',
      'dialog.balanceNote': 'Granted balance is deducted first.',
      'dialog.requests': 'API requests',
      'dialog.times': '{count}',
      'dialog.tokensTotal': 'Total tokens',
      'dialog.cacheRead': 'Cache hit',
      'dialog.cacheWrite': 'Cache write',
      'dialog.output': 'Output',
      'dialog.perRequest': 'Average per request',
      'dialog.peakCost': 'Peak-period spend',
      'dialog.idleCost': 'Idle-period spend',
      'dialog.priceTitle': 'Current prices',
      'dialog.period.peak': 'Peak period',
      'dialog.period.idle': 'Idle period',
      'dialog.period.discount': '{ratio} of peak',
      'dialog.cacheMiss': 'Cache miss',
      'dialog.model': 'Model',
      'dialog.unit': '{currency} per 1M tokens',
      'dialog.source.docs': 'official document',
      'dialog.source.config': 'built-in prices',
      'dialog.source.stale': 'last successful prices',
      'dialog.priceUpdated': 'updated {time}',
      'dialog.priceFailed': 'Automatic price refresh failed; using {source}.',
      'dialog.holidayFailed': 'Holiday calendar refresh failed; peak windows may include statutory holidays.',
      'dialog.peakReference': 'Peak: hit {cacheRead} · miss {cacheMiss} · output {output}',
      'dialog.note': 'Session estimate; the Platform usage page aggregates the last 30 days and excludes per-request Search/Fetch fees.',
      'dialog.platformUsage': 'View Platform usage ↗',
      'a11y.dialog': 'Usage and billing details',
      'a11y.pill': 'Usage and billing: {label}',
      'a11y.refresh': 'Refresh remaining amount',
    };

    const CURRENCY_SYMBOLS = {
      CNY: '¥',
      USD: '$',
      EUR: '€',
      GBP: '£',
      JPY: '¥',
      HKD: 'HK$',
      TWD: 'NT$',
      KRW: '₩',
    };

    const CSS = [
      '.ub-root{min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));display:inline-flex}',
      '.ub-pill{box-sizing:border-box;border-radius:var(--dsw-radius-sm);max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;background:0 0;border:none;align-items:center;gap:6px;padding:1px 8px;display:inline-flex;cursor:pointer}',
      '.ub-pill:hover,.ub-pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '.ub-pill svg{flex:none;width:14px;height:14px}',
      '.ub-label{text-overflow:ellipsis;min-width:0;overflow:hidden}',
      '.ub-panel{z-index:1100;box-sizing:border-box;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);width:max-content;min-width:min(320px,100vw - 24px);max-width:min(460px,100vw - 24px);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;border:0;padding:12px;font-size:12px;line-height:16px;position:fixed;max-height:calc(100vh - 96px);overflow-y:auto;overscroll-behavior:contain}',
      '.ub-header{color:var(--dsw-alias-label-primary);justify-content:space-between;align-items:baseline;gap:16px;display:flex;font-weight:500}',
      '.ub-titleLabel{align-items:center;gap:6px;min-width:0;display:inline-flex}',
      '.ub-titleLabel svg{flex:none;width:14px;height:14px}',
      '.ub-titleValue{font-variant-numeric:tabular-nums}',
      '.ub-subtitle{color:var(--dsw-alias-label-tertiary);margin-top:2px}',
      '.ub-rule{border-top:.5px solid var(--dsw-alias-border-l2);margin:6px 0}',
      '.ub-cost{display:flex;justify-content:space-between;align-items:baseline;gap:16px}',
      '.ub-costLabel{color:var(--dsw-alias-label-tertiary)}',
      '.ub-costValue{color:var(--dsw-alias-label-primary);font-size:18px;line-height:22px;font-weight:600;font-variant-numeric:tabular-nums}',
      '.ub-balance{margin-top:3px;padding:6px 8px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md)}',
      '.ub-balanceHead{display:flex;justify-content:space-between;align-items:baseline;gap:12px}',
      '.ub-balanceLabel{color:var(--dsw-alias-label-tertiary)}',
      '.ub-balanceStatus{color:var(--dsw-alias-label-tertiary);background:0 0;border:none;padding:0;font:inherit;cursor:pointer;text-align:right}',
      '.ub-balanceStatus:hover{color:var(--dsw-alias-label-secondary);text-decoration:underline}',
      '.ub-balanceValue{color:var(--dsw-alias-label-primary);font-size:15px;line-height:20px;font-variant-numeric:tabular-nums;margin-top:1px}',
      '.ub-balanceValueMuted{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin-top:2px}',
      '.ub-balanceDetail{color:var(--dsw-alias-label-tertiary);display:flex;justify-content:space-between;gap:12px;margin-top:2px}',
      '.ub-balanceNote{color:var(--dsw-alias-label-tertiary);margin-top:2px}',
      '.ub-details{color:var(--dsw-alias-label-tertiary);grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:3px 16px;margin:0;display:grid}',
      '.ub-details dt,.ub-details dd{min-width:0;margin:0}',
      '.ub-details dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}',
      '.ub-section{align-items:center;color:var(--dsw-alias-label-primary);font-weight:500;margin-bottom:4px;display:flex;justify-content:space-between;gap:8px}',
      '.ub-badge{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);border-radius:var(--dsw-radius-sm);padding:0 6px;font-weight:400}',
      '.ub-unit{color:var(--dsw-alias-label-tertiary);margin-top:-2px;margin-bottom:4px}',
      '.ub-route{overflow-wrap:anywhere}',
      '.ub-note{color:var(--dsw-alias-label-tertiary);margin-top:6px}',
      '.ub-platform{border-top:.5px solid var(--dsw-alias-border-l2);margin-top:6px;padding-top:6px}',
      '.ub-platformLink{color:var(--dsw-alias-state-business-primary,var(--dsw-alias-label-secondary));text-decoration:none}',
      '.ub-platformLink:hover{text-decoration:underline}',
      '.ub-warn{color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-tertiary));margin-top:6px}',
      '.ub-priceActive{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
    ].join('\n');

    const MARGIN = 12;
    const GAP = 8;
    /** Keep clear of the window caption buttons when the panel is tall. */
    const TOP_SAFE = 48;
    const BALANCE_REFRESH_MS = 60_000;
    const PERIOD_REFRESH_MS = 15_000;

    const symbolOf = (currency) => {
      const code = String(currency ?? 'CNY').toUpperCase();
      return CURRENCY_SYMBOLS[code] ?? `${code} `;
    };

    const groupInteger = (text) => text.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    /**
     * Money text: symbol plus grouped digits; small amounts keep four decimals.
     * @param {number} value
     * @param {string} currency
     */
    const formatMoney = (value, currency) => {
      const amount = Number(value);
      if (!Number.isFinite(amount)) return `${symbolOf(currency)}0.00`;
      const digits = Math.abs(amount) >= 1 ? 2 : 4;
      const fixed = amount.toFixed(digits);
      const [whole, fraction] = fixed.split('.');
      return `${symbolOf(currency)}${groupInteger(whole)}${fraction === undefined ? '' : `.${fraction}`}`;
    };

    /**
     * Unit price text: two decimals at or above one, otherwise up to three significant decimals.
     * @param {number} value
     */
    const formatPrice = (value) => {
      const amount = Number(value);
      if (!Number.isFinite(amount)) return '0';
      if (amount >= 1 || amount === 0) return amount.toFixed(2);
      return amount.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    };

    const formatCount = (value) => groupInteger(String(Math.trunc(Number.isFinite(Number(value)) ? Number(value) : 0)));

    const formatCompactTokens = (value) => {
      const count = Number.isFinite(Number(value)) ? Number(value) : 0;
      if (count < 1000) return String(Math.trunc(count));
      if (count < 1e6) return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
      return `${(count / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`;
    };

    /**
     * Convert a Platform balance string to integer cents.
     * Accepts decimal strings with optional scientific notation, like the Platform
     * account page does; returns null for malformed values.
     * @param {unknown} value
     */
    const toCents = (value) => {
      const amount = Number(value);
      if (!Number.isFinite(amount)) return null;
      return amount >= 0 ? Math.floor(amount * 100 + 1e-6) : -Math.ceil(-amount * 100 - 1e-6);
    };

    /** Currency-symbol money text from integer cents. */
    const formatCents = (cents, currency) => {
      if (!Number.isFinite(cents)) return `${symbolOf(currency)}0.00`;
      const negative = cents < 0;
      const abs = Math.abs(cents);
      const whole = Math.floor(abs / 100);
      const fraction = String(abs % 100).padStart(2, '0');
      const sign = negative ? '-' : '';
      if (!negative && abs === 0) return `${symbolOf(currency)}0.00`;
      return `${sign}${symbolOf(currency)}${groupInteger(String(whole))}.${fraction}`;
    };

    /**
     * Display one raw Platform balance string, keeping the account page's
     * display rules: two decimals, positive sub-cent amounts as `<0.01`.
     * @param {unknown} raw
     * @param {string} currency
     */
    const formatRawBalance = (raw, currency) => {
      const cents = toCents(raw);
      if (cents === null) return null;
      if (cents === 0 && Number(raw) > 0) return `${symbolOf(currency)}<0.01`;
      return formatCents(cents, currency);
    };

    const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

    /**
     * Build a clock reporting the wall time in one IANA time zone.
     * @param {string} timeZone
     */
    const makeClock = (timeZone) => {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timeZone || 'Asia/Shanghai',
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
    };

    /**
     * The official period at one instant, from the schedule the Host published.
     * @param {object|undefined} schedule
     * @param {number} nowMs
     * @returns {'peak'|'idle'}
     */
    const resolvePeriod = (schedule, nowMs) => {
      if (schedule === undefined || schedule === null) return 'idle';
      const clock = makeClock(schedule.timeZone);
      const local = clock(nowMs);
      const holidays = Array.isArray(schedule.holidays) ? schedule.holidays : [];
      if (holidays.includes(local.date)) return 'idle';
      const weekdays = Array.isArray(schedule.peakWeekdays) ? schedule.peakWeekdays : [1, 2, 3, 4, 5];
      if (!weekdays.includes(local.weekday)) return 'idle';
      const windows = Array.isArray(schedule.peakWindows) ? schedule.peakWindows : [];
      for (const window of windows) {
        if (!Array.isArray(window) || window.length < 2) continue;
        if (local.minutes >= window[0] && local.minutes < window[1]) return 'peak';
      }
      return 'idle';
    };

    /** Discount ratio text such as `5` or `2.5` (idle price relative to peak). */
    const discountRatio = (peak, idle) => {
      const peakPrice = Number(peak?.cacheMiss);
      const idlePrice = Number(idle?.cacheMiss);
      if (!Number.isFinite(peakPrice) || peakPrice <= 0 || !Number.isFinite(idlePrice)) return null;
      const ratio = (idlePrice / peakPrice) * 10;
      return Number.isInteger(ratio) ? String(ratio) : ratio.toFixed(1);
    };

    /** Local clock time for a timestamp. */
    const formatClockTime = (ms) => {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
      const date = new Date(ms);
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${hours}:${minutes}`;
    };

    /** Tooltip text for a failed refresh: attempt time plus the failure reason. */
    const describeFailure = (attemptedAt, error) => {
      const reason = String(error ?? '');
      const time = formatClockTime(attemptedAt);
      return time === null ? reason : `${time} · ${reason}`;
    };

    /** Coin icon drawn with `currentColor` so it follows the host theme. */
    const coinIcon = () =>
      h(
        'svg',
        { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true },
        h('circle', { cx: 8, cy: 8, r: 6.1, fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 }),
        h('path', {
          d: 'M8 3.7v8.6M10.3 5.7c0-.9-.9-1.4-2.3-1.4s-2.3.5-2.3 1.4.9 1.3 2.3 1.6c1.5.3 2.3.8 2.3 1.7 0 .9-.9 1.4-2.3 1.4s-2.3-.5-2.3-1.4',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.1,
          strokeLinecap: 'round',
        }),
      );

    /** Wallet icon for the remaining-amount row. */
    const walletIcon = () =>
      h(
        'svg',
        { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true },
        h('rect', { x: 2, y: 4.2, width: 12, height: 8.2, rx: 1.6, fill: 'none', stroke: 'currentColor', strokeWidth: 1.1 }),
        h('path', { d: 'M2 6.8h12', fill: 'none', stroke: 'currentColor', strokeWidth: 1.1 }),
        h('circle', { cx: 11, cy: 9.7, r: 0.9, fill: 'currentColor' }),
      );

    /** Place the portaled panel above the pill, clamped into the viewport. */
    const usePanelPosition = (open, rootRef, panelRef, revision) => {
      const [pos, setPos] = React.useState(null);
      React.useLayoutEffect(() => {
        if (!open) {
          setPos(null);
          return undefined;
        }
        const place = () => {
          const anchor = rootRef.current;
          const panel = panelRef.current;
          if (anchor === null || panel === null) return;
          const anchorRect = anchor.getBoundingClientRect();
          const panelRect = panel.getBoundingClientRect();
          const viewportWidth = window.innerWidth;
          const viewportHeight = window.innerHeight;
          let left = anchorRect.left;
          const maxLeft = Math.max(MARGIN, viewportWidth - panelRect.width - MARGIN);
          left = Math.min(Math.max(MARGIN, left), maxLeft);
          let top = anchorRect.top - panelRect.height - GAP;
          if (top < TOP_SAFE) {
            // Not enough room above the composer: clamp below the caption area.
            top = Math.max(MARGIN, Math.min(TOP_SAFE, viewportHeight - panelRect.height - MARGIN));
          }
          setPos({ left: Math.round(left), top: Math.round(top), visibility: 'visible' });
        };
        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
          window.removeEventListener('resize', place);
          window.removeEventListener('scroll', place, true);
        };
      }, [open, revision, rootRef, panelRef]);
      return pos;
    };

    /** Dialog close on Escape and on any pointer outside the pill and panel. */
    const useDismiss = (open, setOpen, rootRef, panelRef) => {
      React.useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        const onPointerDown = (event) => {
          const target = event.target;
          if (!(target instanceof Node)) return;
          if (rootRef.current?.contains(target) === true) return;
          if (panelRef.current?.contains(target) === true) return;
          setOpen(false);
        };
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => {
          document.removeEventListener('keydown', onKeyDown);
          document.removeEventListener('pointerdown', onPointerDown, true);
        };
      }, [open, setOpen, rootRef, panelRef]);
    };

    const detailRow = (label, value, key) => [h('dt', { key: `${key}-label` }, label), h('dd', { key: `${key}-value` }, value)];

    return {
      inject: ['slots', 'locale', 'remote', 'remote.account'],
      /**
       * Mount this Client contribution.
       * @param {object} ctx - Client root context.
       */
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }));
        const t = ctx.locale.bind(NS);

        /** Build the metadata the account Remote methods carry. */
        const accountMetadata = () => {
          const boot = globalThis.__DSH_BOOT__;
          const bootVersion = boot !== null && typeof boot === 'object' && boot.release !== null && typeof boot.release === 'object' ? boot.release.version : undefined;
          return {
            version: typeof bootVersion === 'string' && bootVersion !== '' ? bootVersion : '0.2.1-rc.5',
            locale: ctx.locale.getSnapshot?.().active ?? 'zh-CN',
            timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
          };
        };

        /**
         * The composer dock pill and its details dialog.
         * @param {{useProjection: Function, t?: Function}} props - slot props.
         */
        function BillingPill(props) {
          const { useProjection } = props;
          const translate = typeof props.t === 'function' ? props.t : t;
          const data = typeof useProjection === 'function' ? useProjection('usageBilling') : undefined;
          const [open, setOpen] = React.useState(false);
          const [balance, setBalance] = React.useState({ status: 'loading', wallets: [], bonusWallets: [], updatedAt: null });
          const [balanceRefreshTick, setBalanceRefreshTick] = React.useState(0);
          const [now, setNow] = React.useState(() => Date.now());
          const rootRef = React.useRef(null);
          const panelRef = React.useRef(null);
          const pos = usePanelPosition(open, rootRef, panelRef, data);
          useDismiss(open, setOpen, rootRef, panelRef);

          // Account balance: read once on mount, then refresh while the dialog is
          // open so the remaining amount follows spending without extra traffic.
          React.useEffect(() => {
            let disposed = false;
            const refresh = async () => {
              // The account state carries the Platform usage page link; the
              // balance read is independent, so one failing never hides the other.
              let links;
              try {
                const stateResult = await ctx.remote.account.getState();
                if (disposed) return;
                if (stateResult !== null && typeof stateResult === 'object' && stateResult.ok === true) {
                  const candidate = stateResult.value?.links;
                  if (candidate !== null && typeof candidate === 'object' && typeof candidate.usageUrl === 'string' && candidate.usageUrl !== '') {
                    links = {
                      usageUrl: candidate.usageUrl,
                      ...(typeof candidate.topUpUrl === 'string' ? { topUpUrl: candidate.topUpUrl } : {}),
                    };
                  }
                }
              } catch (_error) {
                // The Platform link is optional; keep the balance rows working.
              }
              try {
                const result = await ctx.remote.account.getBalance(accountMetadata());
                if (disposed) return;
                if (result === null || typeof result !== 'object' || result.ok !== true) {
                  setBalance((previous) => ({ ...previous, status: 'failed', ...(links === undefined ? {} : { links }) }));
                  return;
                }
                const value = result.value;
                if (value === null || value === undefined) {
                  setBalance((previous) => ({ ...previous, status: 'signed-out', wallets: [], bonusWallets: [], updatedAt: null, ...(links === undefined ? {} : { links }) }));
                  return;
                }
                if (value.status !== 'ready') {
                  setBalance((previous) => ({ ...previous, status: 'failed', ...(links === undefined ? {} : { links }) }));
                  return;
                }
                setBalance((previous) => ({
                  status: 'ready',
                  wallets: Array.isArray(value.value) ? value.value : [],
                  bonusWallets: Array.isArray(value.bonusWallets) ? value.bonusWallets : [],
                  updatedAt: Date.now(),
                  links: links ?? previous.links,
                }));
              } catch (_error) {
                if (!disposed) setBalance((previous) => ({ ...previous, status: 'failed', ...(links === undefined ? {} : { links }) }));
              }
            };
            void refresh();
            if (!open) {
              return () => {
                disposed = true;
              };
            }
            const timer = setInterval(() => void refresh(), BALANCE_REFRESH_MS);
            return () => {
              disposed = true;
              clearInterval(timer);
            };
          }, [open, balanceRefreshTick]);

          // Local clock tick while the dialog is open: the peak/idle period and
          // prices follow the real clock even when no session event arrives.
          React.useEffect(() => {
            if (!open) return undefined;
            setNow(Date.now());
            const timer = setInterval(() => setNow(Date.now()), PERIOD_REFRESH_MS);
            return () => clearInterval(timer);
          }, [open]);

          if (data === undefined || data === null) return null;
          if (data.requests === 0 && data.totalTokens === 0) return null;

          const costText = formatMoney(data.cost, data.currency);
          const tokensText = formatCompactTokens(data.totalTokens);
          const label = [costText, translate('pill.requests', { count: data.requests }), translate('pill.tokens', { tokens: tokensText })].join(' · ');

          const rawPrices = data.prices ?? {};
          const flatPrice = rawPrices.peak === undefined && rawPrices.idle === undefined;
          const peakPrices = rawPrices.peak ?? rawPrices;
          const idlePrices = rawPrices.idle ?? rawPrices;
          const period = flatPrice ? 'idle' : resolvePeriod(data.schedule, now);
          const activePrices = period === 'peak' ? peakPrices : idlePrices;
          const ratio = discountRatio(peakPrices, idlePrices);
          const periodLabel = translate(period === 'peak' ? 'dialog.period.peak' : 'dialog.period.idle');
          const periodBadge = flatPrice ? null : period === 'idle' && ratio !== null ? translate('dialog.period.discount', { ratio }) : null;
          const priceUnit = translate('dialog.unit', { currency: data.currency });

          // ---- remaining amount -------------------------------------------------
          const preferredCurrency = String(data.currency ?? 'CNY').toUpperCase();
          const wallets = Array.isArray(balance.wallets) ? balance.wallets : [];
          const bonusWallets = Array.isArray(balance.bonusWallets) ? balance.bonusWallets : [];
          const currencyOf = (wallet) => String(wallet?.currency ?? '').toUpperCase();
          const rechargeWallet = wallets.find((wallet) => currencyOf(wallet) === preferredCurrency) ?? wallets[0];
          const bonusWallet =
            rechargeWallet === undefined
              ? bonusWallets.find((wallet) => currencyOf(wallet) === preferredCurrency) ?? bonusWallets[0]
              : bonusWallets.find((wallet) => currencyOf(wallet) === currencyOf(rechargeWallet));
          const balanceCurrency = String(rechargeWallet?.currency ?? bonusWallet?.currency ?? preferredCurrency).toUpperCase();
          let remainingText = null;
          let rechargeText = null;
          let bonusText = null;
          let balanceUnavailable = false;
          if (balance.status === 'ready') {
            const rechargeCents = rechargeWallet === undefined ? 0 : toCents(rechargeWallet.balance);
            const bonusCents = bonusWallet === undefined ? 0 : toCents(bonusWallet.balance);
            if (rechargeCents === null || bonusCents === null) {
              balanceUnavailable = true;
            } else {
              const totalCents = rechargeCents + bonusCents;
              remainingText =
                totalCents === 0 && (Number(rechargeWallet?.balance ?? 0) > 0 || Number(bonusWallet?.balance ?? 0) > 0)
                  ? `${symbolOf(balanceCurrency)}<0.01`
                  : formatCents(totalCents, balanceCurrency);
              rechargeText = rechargeWallet === undefined ? null : formatRawBalance(rechargeWallet.balance, rechargeWallet.currency);
              bonusText = bonusWallet === undefined ? null : formatRawBalance(bonusWallet.balance, bonusWallet.currency);
            }
          }
          const balanceStatusText =
            balance.status === 'ready'
              ? translate('dialog.balanceUpdated', { time: formatClockTime(balance.updatedAt) ?? '' })
              : balance.status === 'loading'
                ? translate('dialog.balanceLoading')
                : balance.status === 'signed-out'
                  ? translate('dialog.balanceSignedOut')
                  : translate('dialog.balanceFailed');
          const balanceValueText =
            balance.status === 'ready' && remainingText !== null
              ? remainingText
              : balance.status === 'ready' && balanceUnavailable
                ? translate('dialog.balanceUnavailable')
                : balance.status === 'loading'
                  ? translate('dialog.balanceLoading')
                  : balance.status === 'signed-out'
                    ? translate('dialog.balanceSignedOut')
                    : translate('dialog.balanceFailed');
          const bonusPositive = bonusText !== null && bonusText !== `${symbolOf(balanceCurrency)}0.00`;
          const platformUsageUrl =
            balance.links !== null &&
            typeof balance.links === 'object' &&
            typeof balance.links.usageUrl === 'string' &&
            balance.links.usageUrl !== ''
              ? balance.links.usageUrl
              : null;

          // ---- usage rows (session scope, compact) -------------------------------
          const usageRows = [
            detailRow(translate('dialog.requests'), translate('dialog.times', { count: data.requests }), 't-requests'),
            detailRow(translate('dialog.tokensTotal'), formatCount(data.totalTokens), 't-total'),
            data.requests > 0 ? detailRow(translate('dialog.perRequest'), formatMoney(data.cost / data.requests, data.currency), 't-average') : null,
          ].filter((row) => row !== null);

          const periodCostRows = [];
          if (data.periodCost !== null && data.periodCost !== undefined) {
            if (Number(data.periodCost.peak) > 0) {
              periodCostRows.push(detailRow(translate('dialog.peakCost'), formatMoney(data.periodCost.peak, data.currency), 'c-peak'));
            }
            if (Number(data.periodCost.idle) > 0) {
              periodCostRows.push(detailRow(translate('dialog.idleCost'), formatMoney(data.periodCost.idle, data.currency), 'c-idle'));
            }
          }

          const priceRows = [
            detailRow(translate('dialog.cacheMiss'), formatPrice(activePrices.cacheMiss), 'p-miss'),
            detailRow(translate('dialog.cacheRead'), formatPrice(activePrices.cacheRead), 'p-read'),
            activePrices.cacheWrite > 0 ? detailRow(translate('dialog.cacheWrite'), formatPrice(activePrices.cacheWrite), 'p-write') : null,
            detailRow(translate('dialog.output'), formatPrice(activePrices.output), 'p-output'),
            detailRow(
              translate('dialog.model'),
              h('span', { className: 'ub-route' }, data.model ?? '—'),
              'p-model',
            ),
          ].filter((row) => row !== null);

          const sourceLabel =
            data.pricing?.status === 'stale'
              ? translate('dialog.source.stale')
              : data.pricing?.source === 'docs'
                ? translate('dialog.source.docs')
                : translate('dialog.source.config');
          const priceUpdated = formatClockTime(data.pricing?.updatedAt);
          const peakReference = translate('dialog.peakReference', {
            cacheRead: formatPrice(peakPrices.cacheRead),
            cacheMiss: formatPrice(peakPrices.cacheMiss),
            output: formatPrice(peakPrices.output),
          });

          const dialogRows = [
            h('div', { className: 'ub-header', key: 'header' },
              h('span', { className: 'ub-titleLabel' }, coinIcon(), h('span', null, translate('dialog.title'))),
              h('span', { className: 'ub-titleValue' }, `${formatCount(data.totalTokens)} tok`),
            ),
            h('div', { className: 'ub-subtitle', key: 'subtitle' }, translate('dialog.subtitle')),
            h('div', { className: 'ub-rule', key: 'rule-1' }),
            h('div', { className: 'ub-cost', key: 'cost' },
              h('span', { className: 'ub-costLabel' }, translate('dialog.cost')),
              h('span', { className: 'ub-costValue' }, costText),
            ),
            h('div', { className: 'ub-balance', key: 'balance' },
              h('div', { className: 'ub-balanceHead' },
                h('span', { className: 'ub-balanceLabel' }, translate('dialog.remaining')),
                h('button', {
                  type: 'button',
                  className: 'ub-balanceStatus',
                  title: translate('a11y.refresh'),
                  onClick: () => setBalanceRefreshTick((value) => value + 1),
                }, balanceStatusText),
              ),
              balance.status === 'ready' && remainingText !== null
                ? h('div', { className: 'ub-balanceValue', key: 'balance-value' }, remainingText)
                : h('div', { className: 'ub-balanceValueMuted', key: 'balance-value' }, balanceValueText),
              balance.status === 'ready' && rechargeText !== null
                ? h('div', { className: 'ub-balanceDetail', key: 'balance-recharge' },
                    h('span', null, translate('dialog.recharge')),
                    h('span', null, rechargeText),
                  )
                : null,
              balance.status === 'ready' && bonusPositive
                ? h('div', { className: 'ub-balanceDetail', key: 'balance-bonus' },
                    h('span', null, translate('dialog.bonus')),
                    h('span', null, bonusText),
                  )
                : null,
              balance.status === 'ready' && bonusPositive
                ? h('div', { className: 'ub-balanceNote', key: 'balance-note' }, translate('dialog.balanceNote'))
                : null,
            ),
            h('div', { className: 'ub-rule', key: 'rule-2' }),
            h('dl', { className: 'ub-details', key: 'usage' }, usageRows),
            periodCostRows.length > 0 ? h('dl', { className: 'ub-details', key: 'period-cost', style: { marginTop: '8px' } }, periodCostRows) : null,
            h('div', { className: 'ub-rule', key: 'rule-3' }),
            h('div', { className: 'ub-section', key: 'price-title' },
              h('span', null, translate('dialog.priceTitle')),
              h('span', { className: 'ub-badge' }, `${periodLabel}${periodBadge === null ? '' : ` · ${periodBadge}`}`),
            ),
            h('div', { className: 'ub-unit', key: 'price-unit' }, priceUnit),
            h('dl', { className: 'ub-details', key: 'prices' }, priceRows),
            h('div', { className: 'ub-note', key: 'peak-reference' }, peakReference),
            h('div', { className: 'ub-note', key: 'source' },
              priceUpdated === null ? sourceLabel : `${sourceLabel} · ${translate('dialog.priceUpdated', { time: priceUpdated })}`,
            ),
            data.pricing?.error
              ? h(
                  'div',
                  {
                    className: 'ub-warn',
                    key: 'price-warn',
                    title: describeFailure(data.pricing.attemptedAt, data.pricing.error),
                  },
                  translate('dialog.priceFailed', { source: sourceLabel }),
                )
              : null,
            data.pricing?.holidayError
              ? h(
                  'div',
                  {
                    className: 'ub-warn',
                    key: 'holiday-warn',
                    title: describeFailure(data.pricing.attemptedAt, data.pricing.holidayError),
                  },
                  translate('dialog.holidayFailed'),
                )
              : null,
            h('div', { className: 'ub-note', key: 'note' }, translate('dialog.note')),
            platformUsageUrl === null
              ? null
              : h(
                  'div',
                  { className: 'ub-platform', key: 'platform-usage' },
                  h(
                    'a',
                    {
                      className: 'ub-platformLink',
                      href: platformUsageUrl,
                      target: '_blank',
                      rel: 'noreferrer noopener',
                    },
                    translate('dialog.platformUsage'),
                  ),
                ),
          ].filter((row) => row !== null);

          const panel = h(
            'div',
            {
              ref: panelRef,
              className: 'ub-panel',
              role: 'dialog',
              'aria-label': translate('a11y.dialog'),
              'data-usage-billing': true,
              style: pos ?? { visibility: 'hidden', left: 0, top: 0 },
            },
            dialogRows,
          );

          return h(
            React.Fragment,
            null,
            h('style', { key: 'ub-style', 'data-usage-billing-style': true }, CSS),
            h(
              'span',
              { ref: rootRef, className: 'ub-root', 'data-composer-stat': 'billing' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'ub-pill',
                  'aria-haspopup': 'dialog',
                  'aria-expanded': open,
                  'aria-label': translate('a11y.pill', { label }),
                  title: label,
                  onClick: () => setOpen((value) => !value),
                },
                coinIcon(),
                h('span', { className: 'ub-label' }, label),
              ),
            ),
            open ? ReactDOM.createPortal(panel, document.body) : null,
          );
        }

        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'billing',
              order: 2,
              locale: NS,
            },
            BillingPill,
          ),
        );
      },
    };
  },
});
