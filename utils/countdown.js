const lunar = require('./lunar.js')

/**
 * 纪念日倒计时。
 * 阳历：直接按公历月日推算下一次发生日。
 * 农历：按农历月日逐年换算成公历，再取今年/明年中尚未过期的最近一次。
 * 全部通过真实农历日历表换算，不会出现「农历八月十五」错位的问题。
 */

const DAY = 86400000;

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 今天零点 */
function today() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** 两个日期相差天数（按零点计算，忽略时分秒） */
function diffDays(from, to) {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY);
}

/**
 * 计算下一次发生的公历日期。
 * repeatYearly=false 时只返回起始那年的日期。
 */
function nextOccurrence(anniversary, baseDate) {
  const base = baseDate ? startOfDay(baseDate) : today();
  const { calendar_type, month, day, start_year, repeat_yearly } = anniversary;

  if (calendar_type === 'lunar') {
    const anchorYear = start_year || base.getFullYear()
    // 农历没有「起始年之前」的年份，逐年向后推至 MAX_YEAR
    let lunarYear = anchorYear
    if (!repeat_yearly) {
      const s = lunar.lunarToSolar(lunarYear, month, day, false)
      return s
    }
    // 从锚点年份开始，最多向后找 4 年（覆盖闰月退化的极端情况）
    for (let i = 0; i <= 4; i += 1) {
      const y = anchorYear + i
      const s = lunar.lunarToSolar(y, month, day, false)
      if (s && diffDays(base, s) >= 0) return s
    }
    // 锚点年份早于今天（历史纪念日），改从今年开始找
    const thisYear = base.getFullYear()
    for (let y = thisYear; y <= Math.min(thisYear + 2, lunar.MAX_YEAR); y += 1) {
      const s = lunar.lunarToSolar(y, month, day, false)
      if (s && diffDays(base, s) >= 0) return s
    }
    return null
  }

  // 阳历
  const year = start_year || base.getFullYear()
  if (!repeat_yearly) {
    return new Date(year, month - 1, day)
  }
  let candidate = new Date(base.getFullYear(), month - 1, day)
  if (diffDays(base, candidate) < 0) {
    candidate = new Date(base.getFullYear() + 1, month - 1, day)
  }
  return candidate
}

/**
 * 完整的倒计时信息。
 * days = 0 表示就是今天。
 *
 * @param {object} anniversary
 * @param {Date}   [baseDate]  以哪天为基准算目标日期
 * @param {Date}   [nowDate]   「现在几点」，用于算时分秒；不传用真实时间
 */
function describe(anniversary, baseDate, nowDate) {
  const base = baseDate ? startOfDay(baseDate) : today()
  const target = nextOccurrence(anniversary, base)
  if (!target) return null

  const days = diffDays(base, target)
  const targetLunar = lunar.solarToLunar(target)

  /**
   * 年份文案：第 N 年 = 目标年 - 起始年。
   *
   * 生日场景：2002 年出生，2002 那个是「出生」，之后每年过一个生日。
   * 2003 是第 1 个生日 …… 2027 是第 25 个（也是 25 周岁）。
   * 所以差值 2027 - 2002 = 25 正好是第 25 个生日，不能再加 1。
   *
   * 纪念日场景：2026-07-17 在一起，2027-07-17 是「在一起 1 年」，同样等于差值。
   *
   * 起始当年（差值 0）不显示年份——那天是起始本身，不是「过了 0 年」。
   */
  const anchor = anniversary.start_year || base.getFullYear()
  const years = target.getFullYear() - anchor
  const yearText = years > 0 ? '第 ' + years + ' 年' : ''

  /**
   * 时分秒倒计时。
   *
   * 天数是自然日口径（今天到目标之间夹了多少个整天），
   * 所以时分秒只能是**今天还没过完的那部分**——即距今天午夜还剩多久。
   * 两者相加才是真实剩余时间：252 天 + 12:00:00 = 还有 252 天 12 小时。
   *
   * ⚠️ 千万别拿 (target - now) 的毫秒差直接拆，那会得到 6048:00:00 这种
   * 「几千小时」的荒谬值（252 天 × 24）。
   */
  const now = nowDate ? new Date(nowDate) : new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const untilMidnightMs = Math.max(0, nextMidnight.getTime() - now.getTime());
  const hours = Math.floor(untilMidnightMs / (60 * 60 * 1000));
  const minutes = Math.floor((untilMidnightMs % (60 * 60 * 1000)) / (60 * 1000));
  const seconds = Math.floor((untilMidnightMs % (60 * 1000)) / 1000);
  const pad2 = (n) => (n < 10 ? '0' + n : '' + n);

  return {
    target: target,
    targetText: target.getFullYear() + '年' + (target.getMonth() + 1) + '月' + target.getDate() + '日',
    lunarText: targetLunar ? lunar.lunarText(targetLunar) : '',
    days: days,
    isToday: days === 0,
    isPast: days < 0,
    yearText: yearText,
    hours: hours,
    minutes: minutes,
    seconds: seconds,
    hms: pad2(hours) + ':' + pad2(minutes) + ':' + pad2(seconds),
    weekday: '周' + '日一二三四五六'[target.getDay()]
  }
}

/** 格式化列表展示：今天 / 明天 / N 天后 */
function countdownText(days) {
  if (days === 0) return '就是今天'
  if (days === 1) return '明天'
  return '还有 ' + days + ' 天'
}

module.exports = {
  nextOccurrence,
  describe,
  countdownText,
  diffDays,
  today,
  pad
}
