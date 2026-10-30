/**
 * 订阅消息内容组装。
 *
 * ⚠️ 字段名与结构来自微信公众平台「我的模板」，不可臆测：
 *   点餐（模板 69187）：time1 下单时间 / thing4 下单用户 / thing5 菜品名称
 *                       time6 预约时间 / thing7 备注
 *   纪念日（模板 35877）：thing1 纪念日名称 / time2 日期 / thing4 提醒对象
 *                       thing5 关系角色 / time7 提醒时间
 *
 * 这些模板的字段都是**必填**，必须全部给值，缺一个就报 43101/47003。
 *
 * 格式硬要求：
 * - time  必须 YYYY-MM-DD HH:mm:ss（不能只给日期，time 类型不给秒也会被拒）
 * - thing ≤20 字符纯文字，超长微信直接拒收
 */

const config = require('./subscribe.config.js');

const pad = (n) => (n < 10 ? '0' + n : '' + n);

/** 按 YYYY-MM-DD HH:mm:ss 格式化，time 类型必须用这个格式 */
function formatTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

/** time 类型若没有时分秒信息，给出零值占位（格式必须完整） */
function formatSafeTime(date) {
  const s = formatTime(date);
  if (s) return s;
  return '1970-01-01 00:00:00';
}

/** thing 类型超长会被微信拒绝，这里主动截断 */
function thing(value, max) {
  const s = String(value == null ? '' : value).trim();
  const limit = max || config.FIELD_LIMITS.thing;
  return s.length > limit ? s.slice(0, limit) : s;
}

/** 必填字段兜底：空值时给一个有意义的默认，避免整条消息发送失败 */
function required(value, fallback) {
  const s = String(value == null ? '' : value).trim();
  return thing(s || fallback);
}

/**
 * 纪念日提醒内容。
 * @param {object} anniversary 纪念日记录
 * @param {object} countdown  countdown.describe() 的结果
 * @param {object} opts { toName 提醒对象昵称, role 关系角色 }
 */
function buildAnniversary(anniversary, countdown, opts) {
  const o = opts || {};
  const target = countdown ? countdown.target : null;
  const days = countdown ? countdown.days : 0;

  // 微信不允许营销文案，这里明确是服务提醒
  const title = days === 0
    ? '今天就是 ' + thing(anniversary.title)
    : thing(anniversary.title) + ' 还有 ' + days + ' 天';

  return {
    scene: 'anniversary',
    templateId: config.TEMPLATE_IDS.anniversary,
    title: title,
    data: {
      thing1: required(anniversary.title, '纪念日'),        // 纪念日名称
      time2: formatSafeTime(target),                         // 日期
      thing4: required(o.toName, 'TA'),                      // 提醒对象
      thing5: required(o.role, '情侣'),                      // 关系角色
      time7: formatSafeTime(new Date())                      // 提醒时间 = 推送时刻
    }
  };
}

/**
 * 点菜通知内容。
 * @param {object} order  点菜记录
 * @param {object} opts { from 下单人昵称, note 备注, when 预约时间 }
 */
function buildOrder(order, opts) {
  const o = opts || {};
  const name = required(order.dish_name, '做了道菜');
  const from = required(o.from, 'TA');

  return {
    scene: 'order',
    templateId: config.TEMPLATE_IDS.order,
    title: from + ' 点了 ' + thing(name),
    data: {
      time1: formatSafeTime(new Date()),                        // 下单时间
      thing4: from,                                             // 下单用户
      thing5: thing(name),                                      // 菜品名称
      time6: formatSafeTime(o.when ? new Date(o.when) : new Date()), // 预约时间
      thing7: required(o.note, '无特殊要求')                   // 备注
    }
  };
}

/**
 * 解析纯日期字符串（'YYYY-MM-DD'）。
 *
 * ⚠️ 不能直接用 new Date('2026-12-31')：那是按 UTC 零点解析的，
 *    在负时区机器上会退回前一天。期望日期是本地概念，必须按本地时区解析。
 */
function parseDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const s = String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * 愿望通知内容。
 *
 * 用途有两个：
 * 1. 写入 reminders.body —— 应用内提醒弹窗直接展示这段文案，**不依赖微信，立刻可用**
 * 2. 外部服务端下发订阅消息时的数据来源
 *
 * @param {object} wish  愿望记录
 * @param {object} opts  { from 许愿人昵称, toName 接收方昵称 }
 */
function buildWish(wish, opts) {
  const o = opts || {};
  const w = wish || {};
  const name = required(w.title, '一个愿望');
  const from = required(o.from, 'TA');
  const target = parseDateOnly(w.target_date);

  return {
    scene: 'wish',
    templateId: config.TEMPLATE_IDS.wish,
    title: from + ' 许了个愿望：' + thing(name),
    data: {
      thing1: name,                                            // 愿望内容
      thing2: from,                                            // 许愿人
      thing3: required(w.category, '想去'),                     // 愿望类型
      time4: formatSafeTime(target || new Date())              // 期望达成时间
    }
  };
}

module.exports = { formatTime, formatSafeTime, thing, parseDateOnly, buildAnniversary, buildOrder, buildWish };
