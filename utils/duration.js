/**
 * 在一起时长。
 *
 * 起止时间精确到秒：
 * - 起：couples.relation_at（timestamp with time zone），缺失时退回 relation_date（按东八区 00:00:00 解析）
 * - 止：当前时刻；未绑定完成时不计时
 *
 * 展示拆成「天 时 分 秒」四段，避免出现 4147171 这种没人读得懂的数字。
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

/** 解析起始时间；relation_date 是 date 类型，要按东八区补 00:00:00 */
function resolveStart(couple) {
  if (!couple) return null;
  if (couple.relation_at) {
    const d = new Date(couple.relation_at);
    return isNaN(d.getTime()) ? null : d;
  }
  if (couple.relation_date) {
    // 'YYYY-MM-DD' 会被 new Date 解析成 UTC，这里手动按本地时区构造
    const parts = String(couple.relation_date).slice(0, 10).split('-').map(Number);
    if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
      return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
    }
    const d = new Date(couple.relation_date);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** 取本地零点，用于按自然日计算天数 */
function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
}

/** 两个时刻相差的整天数（按自然日，不含首尾各一天） */
function calendarDaySpan(start, end) {
  const a = startOfDay(start).getTime()
  const b = startOfDay(end).getTime()
  return Math.round((b - a) / DAY)
}

/**
 * 计算时长明细。
 * @returns {{days,hours,minutes,seconds,totalMs,started,valid,text,short}}
 */
function duration(couple, nowDate) {
  const start = resolveStart(couple);
  const now = nowDate ? new Date(nowDate) : new Date();
  if (!start || isNaN(now.getTime())) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, totalMs: 0, started: false, valid: false, text: '', short: '' };
  }
  // 起始时间填在未来的，按 0 秒处理（用户可能先选了还没到的日子）
  const totalMs = Math.max(0, now.getTime() - start.getTime());

  // 「在一起」按自然日计，含起始当天：7月17日 -> 10月15日 算 91 天。
  // 时分秒仍取精确差值，所以同一天内显示「1 天 14:23:07」而不是 0 天。
  // 起始时间在未来时（totalMs 被截断为 0）不显示 1 天，保持 0。
  const days = totalMs === 0
    ? (now.getTime() >= start.getTime() ? 1 : 0)
    : calendarDaySpan(start, now) + 1;
  const hours = Math.floor((totalMs % DAY) / HOUR);
  const minutes = Math.floor((totalMs % HOUR) / MINUTE);
  const seconds = Math.floor((totalMs % MINUTE) / SECOND);

  const text = `${days} 天 ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  const short = `${days} 天 ${pad(hours)} 时 ${pad(minutes)} 分 ${pad(seconds)} 秒`;

  return { days, hours, minutes, seconds, totalMs, started: true, valid: true, text, short, start };
}

/** 各段的展示文案，WXML 不能调用 pad/toFixed，所以在 JS 里算好 */
function segments(couple, nowDate) {
  const d = duration(couple, nowDate);
  if (!d.valid) return { hasValue: false, days: '0', hours: '00', minutes: '00', seconds: '00', text: '' };
  return {
    hasValue: true,
    days: String(d.days),
    hours: pad(d.hours),
    minutes: pad(d.minutes),
    seconds: pad(d.seconds),
    text: d.text,
    short: d.short
  };
}

/** 起止时间的可读文案 */
function startText(couple) {
  const start = resolveStart(couple);
  if (!start) return '';
  return (
    start.getFullYear() + '年' + (start.getMonth() + 1) + '月' + start.getDate() + '日 ' +
    pad(start.getHours()) + ':' + pad(start.getMinutes())
  );
}

/** 把 datetime 选择器的值拆成 date 和 time 两部分 */
function splitDateTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return { date: '', time: '00:00' };
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s]?(\d{2}:\d{2})?/);
  if (!m) return { date: '', time: '00:00' };
  return { date: m[1], time: m[2] || '00:00' };
}

module.exports = { duration, segments, startText, splitDateTime, pad };