/**
 * 日程。
 *
 * 与纪念日的区别：纪念日是「每年重复的那一天」，日程是「带具体时间的安排」，
 * 因此有明确的日期+时间，并且需要计算「还有多久到点」用于强提醒。
 *
 * 本模块只做纯计算，不依赖数据库，便于独立测试。
 */

/** 重复规则 */
const REPEAT = {
  once: '仅此一次',
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
  yearly: '每年'
}

/** 重要程度 */
const PRIORITY = {
  normal: '普通',
  high: '重要',
  urgent: '紧急'
}

/** 分类 */
const CATEGORIES = ['日常', '约会', '纪念日', '工作', '旅行', '其他']

/** 提前提醒的选项（分钟） */
const REMIND_OPTIONS = [
  { value: 0, label: '准点' },
  { value: 15, label: '15 分钟' },
  { value: 30, label: '30 分钟' },
  { value: 60, label: '1 小时' },
  { value: 1440, label: '1 天' }
]

const pad = (n) => (n < 10 ? '0' + n : '' + n)

/** 日期部分 YYYY-MM-DD */
function dateText(d) {
  const x = d instanceof Date ? d : new Date(d)
  // 空串/undefined 会变成 1970-01-01，必须先判空
  if (d == null || d === '' || isNaN(x.getTime())) return ''
  return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate())
}

/**
 * 把「日期 + 时间」拼成本地 Date。
 * 日程的时间是 HH:mm，按本地时区解析。
 */
function toDate(eventDate, eventTime) {
  const t = String(eventTime || '00:00')
  const parts = t.split(':')
  const h = Number(parts[0]) || 0
  const m = Number(parts[1]) || 0
  const s = Number(parts[2]) || 0
  const d = String(eventDate || '').split('-')
  return new Date(Number(d[0]), Number(d[1]) - 1, Number(d[2]), h, m, s)
}

/** 距目标还有多少毫秒（负数表示已过） */
function remainMs(eventDate, eventTime, now) {
  const t = toDate(eventDate, eventTime)
  return t.getTime() - (now ? new Date(now).getTime() : Date.now())
}

/** 人类可读的倒计时文案 */
function remainText(ms) {
  if (ms <= 0) return '已过期'
  const min = Math.floor(ms / 60000)
  if (min < 1) return '马上'
  if (min < 60) return min + ' 分钟后'
  const h = Math.floor(min / 60)
  if (h < 24) return h + ' 小时 ' + (min % 60) + ' 分后'
  const d = Math.floor(h / 24)
  return d + ' 天 ' + (h % 24) + ' 小时后'
}

/**
 * 格式化展示用的日期时间。
 * @param {Date} [today] 基准日，用于「今天/明天」判定；不传用真实今天
 */
function formatWhen(eventDate, eventTime, today) {
  const d = toDate(eventDate, eventTime)
  if (isNaN(d.getTime())) return ''
  const base = today ? new Date(today) : new Date()
  const baseMidnight = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  const sameDay = d.getFullYear() === baseMidnight.getFullYear() &&
    d.getMonth() === baseMidnight.getMonth() && d.getDate() === baseMidnight.getDate()
  const clock = pad(d.getHours()) + ':' + pad(d.getMinutes())
  const datePart = (d.getMonth() + 1) + '月' + d.getDate() + '日'
  if (sameDay) return '今天 ' + clock
  // 明天
  const tomorrow = new Date(baseMidnight.getFullYear(), baseMidnight.getMonth(), baseMidnight.getDate() + 1)
  if (d.getFullYear() === tomorrow.getFullYear() &&
      d.getMonth() === tomorrow.getMonth() && d.getDate() === tomorrow.getDate()) {
    return '明天 ' + clock
  }
  return datePart + ' ' + clock
}

/**
 * 下一次发生的时间（按重复规则往后推）。
 * 用于重复日程显示「下一次」以及判断是否已过期。
 */
function nextOccurrence(schedule, now) {
  const base = now ? new Date(now) : new Date()
  const cur = toDate(schedule.event_date, schedule.event_time)
  if (isNaN(cur.getTime())) return null
  if (cur.getTime() >= base.getTime()) return cur

  const rule = schedule.repeat_rule || 'once'
  if (rule === 'once') return null

  const next = new Date(cur.getTime())
  if (rule === 'daily') {
    while (next.getTime() < base.getTime()) next.setDate(next.getDate() + 1)
  } else if (rule === 'weekly') {
    while (next.getTime() < base.getTime()) next.setDate(next.getDate() + 7)
  } else if (rule === 'monthly') {
    next.setMonth(next.getMonth() + 1)
    while (next.getTime() < base.getTime()) next.setMonth(next.getMonth() + 1)
  } else if (rule === 'yearly') {
    next.setFullYear(next.getFullYear() + 1)
    while (next.getTime() < base.getTime()) next.setFullYear(next.getFullYear() + 1)
  }
  return next
}

module.exports = {
  REPEAT, PRIORITY, CATEGORIES, REMIND_OPTIONS,
  dateText, toDate, remainMs, remainText, formatWhen, nextOccurrence
}
