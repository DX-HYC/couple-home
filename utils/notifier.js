/**
 * 纪念日提醒的判定与记录。
 *
 * 为什么放在前端：
 * 微信下发订阅消息必须调 api.weixin.qq.com 的 subscribe/send，
 * 该接口要求 access_token，而获取 token 需要小程序 AppSecret——AppSecret
 * 绝不能进前端代码（会被反编译拿走，导致小程序被劫持）。
 * 本项目的云服务只提供 database/auth/storage/llm，没有服务端函数通道，
 * 因此下发动作必须由外部服务端完成。
 *
 * 这里负责它之前的全部工作，打开小程序时执行：
 * 1. 找出「已到提醒时间」且「本次还没通知过」的纪念日
 * 2. 写入 reminders 表（记录要提醒什么、给谁、什么时候）
 * 3. 标记已处理，避免重复提醒
 *
 * 外部服务端只需定期读取 reminders 表里未处理且已到时间的记录，调微信接口下发。
 */

const api = require('./api.js')
const countdown = require('./countdown.js')
const message = require('./message.js')

/** kind 常量：与 reminders.kind 字段对应 */
const KIND_ANNIVERSARY = 'anniversary'
const KIND_ORDER = 'order'
const KIND_WISH = 'wish'

/**
 * 找出到点需要提醒的纪念日。
 *
 * 判定规则：目标日期距今 <= remind_days（含当天）即进入提醒窗口。
 * 生日这类每年重复的，一次只取「下一次发生」那一个。
 *
 * @returns {Array} 形如 { anniversary, countdown, days }
 */
function pickDue(anniversaries, baseDate) {
  const base = baseDate ? new Date(baseDate) : new Date()
  const out = []
  for (const a of anniversaries || []) {
    if (a.repeat_yearly === false) continue
    const cd = countdown.describe(a, base)
    if (!cd || cd.days < 0) continue
    // remind_days 为 0 表示只当天提醒
    const window = a.remind_days == null ? 7 : a.remind_days
    if (cd.days > window) continue
    out.push({ anniversary: a, countdown: cd, days: cd.days })
  }
  return out
}

/** 生成唯一标识：同一纪念日同一年只记一次 */
function dueKey(item) {
  const a = item.anniversary
  const target = item.countdown.target
  return KIND_ANNIVERSARY + ':' + a.id + ':' + target.getFullYear() + '-' +
    (target.getMonth() + 1) + '-' + target.getDate()
}

/**
 * 写入待提醒记录。
 * @returns {Promise<{created: number, skipped: number, items: Array}>}
 */
async function enqueueAnniversaries(anniversaries, opts) {
  const options = opts || {}
  const due = pickDue(anniversaries)
  if (!due.length) return { created: 0, skipped: 0, items: [] }

  // 已提醒过的 key（靠 title 里带唯一串来去重，reminders 表没有专门的 key 列）
  let existing = []
  try {
    existing = await api.listReminders(options.coupleId)
  } catch (e) {
    // 读取失败时保守处理：全部当作未提醒，会重复写入但不会漏
  }
  const seen = new Set((existing || [])
    .filter((r) => r.kind === KIND_ANNIVERSARY)
    .map((r) => r.title || ''))

  const created = []
  for (const item of due) {
    const key = dueKey(item)
    if (seen.has(key)) continue

    const msg = message.buildAnniversary(item.anniversary, item.countdown, {
      toName: options.toName,
      role: options.role
    })

    try {
      await api.createReminder(options.coupleId, {
        kind: KIND_ANNIVERSARY,
        // title 里带 key 既是标题也用于去重
        title: key,
        body: msg.title,
        link: '/pages/anniversary/anniversary',
        remind_at: new Date().toISOString()
      })
      created.push({ key: key, message: msg, item: item })
    } catch (e) {
      // 单条失败不阻断其它提醒
    }
  }

  return { created: created.length, skipped: due.length - created.length, items: created }
}

/**
 * 打开小程序时执行：把到点的纪念日写入 reminders 表。
 *
 * 真正的微信推送由外部服务端读取该表后完成——AppSecret 不能进前端。
 */
async function syncPendingReminders(opts) {
  const coupleId = (opts && opts.coupleId) || null
  if (!coupleId) return { created: 0, skipped: 0, items: [] }

  try {
    const list = await api.listAnniversaries(coupleId)
    return await enqueueAnniversaries(list, opts)
  } catch (e) {
    console.warn('[notifier] 生成提醒失败', e.message)
    return { created: 0, skipped: 0, items: [] }
  }
}

/**
 * 愿望清单通知：一方写下愿望后调用，把「TA 给你许了个愿望」写进提醒表。
 *
 * 与纪念日提醒的区别：
 * - 纪念日是**到点自动生成**（每次打开小程序时扫一遍），所以要做去重
 * - 愿望是**用户主动写下**时即时生成，一条愿望只生成一次，所以不做去重
 *
 * 写入后有两个接收方：
 * 1. 应用内：对方下次打开小程序时，首页会弹「有你的提醒」，点进去就是愿望清单
 * 2. 微信：外部服务端读 reminders 表后调用订阅消息接口下发（需配好模板）
 *
 * @param {object} wish 已写入 wishes 表的记录
 * @param {object} opts { coupleId, from 许愿人昵称, toName 接收方昵称 }
 * @returns {Promise<{created: number, message: object|null}>}
 */
async function enqueueWish(wish, opts) {
  const options = opts || {};
  if (!wish || !wish.id || !options.coupleId) return { created: 0, message: null };

  const msg = message.buildWish(wish, {
    from: options.from || 'TA',
    toName: options.toName || 'TA'
  });

  try {
    await api.createReminder(options.coupleId, {
      kind: KIND_WISH,
      // title 放唯一 key，正文放给用户看的文案
      title: 'wish:' + wish.id,
      body: msg.title,
      link: '/pages/wish/wish',
      remind_at: new Date().toISOString()
    });
    // 标记该愿望已生成过通知，避免重复写入
    await api.updateWish(options.coupleId, wish.id, { notified: true });
    return { created: 1, message: msg };
  } catch (e) {
    // 通知写失败不影响愿望本身——愿望已经存进数据库了
    console.warn('[notifier] 愿望通知写入失败', e.message);
    return { created: 0, message: msg };
  }
}

module.exports = {
  KIND_ANNIVERSARY,
  KIND_ORDER,
  KIND_WISH,
  pickDue,
  dueKey,
  enqueueAnniversaries,
  enqueueWish,
  syncPendingReminders
}
