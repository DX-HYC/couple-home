/**
 * 愿望清单的纯逻辑：分类、归属判断、列表分组。
 *
 * 全部是纯函数，不碰 wx、不碰云端，因此可以单独跑单测
 * （见 tests/wish.test.js）。
 *
 * 设计要点：
 * - 愿望是**每人各写各的**，「谁写的」必须一眼可辨，所以列表里区分「我写的 / TA 写的」。
 * - 只有 open（待实现）和 done（已实现）两种状态，其它值一律按 open 处理，
 *   避免数据库里出现脏状态时列表渲染崩掉。
 */

/** 预设分类。emoji 放在这里，列表和提醒文案共用一份。 */
const CATEGORIES = [
  { key: '想去', emoji: '🧭' },
  { key: '想要', emoji: '🎁' },
  { key: '想做', emoji: '✨' },
  { key: '其他', emoji: '💫' }
];

/** 分类 key 列表（表单里的 chips 用） */
const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

/** 分类 emoji；未知分类给默认的 💫 */
function categoryEmoji(name) {
  const hit = CATEGORIES.find((c) => c.key === name);
  return hit ? hit.emoji : '💫';
}

/** 是否已实现：只认 'done'，其余（null / 'open' / 脏值）都算待实现 */
function isDone(wish) {
  return !!wish && wish.status === 'done';
}

/**
 * 解析日期。
 *
 * ⚠️ date 类型的列读回来是 'YYYY-MM-DD' 这种**纯日期**，
 *    而 new Date('2026-12-31') 会按 UTC 零点解析，
 *    在负时区机器上会退回前一天。这里显式按本地时区解析，避免日期偏移。
 */
function parseDate(value) {
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

/** 日期格式化：'2026-12-31' → '2026年12月31日' */
function formatDate(value) {
  const d = parseDate(value);
  if (!d) return value ? String(value) : '';
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

/**
 * 把一条数据库原始行整理成列表展示用的结构。
 *
 * @param {object} wish 数据库原始行
 * @param {string} myId 当前登录用户 id，用来判断是不是我写的
 * @returns {object|null}
 */
function describe(wish, myId) {
  if (!wish) return null;

  const mine = !!myId && !!wish.owner_id && wish.owner_id === myId;
  const done = isDone(wish);

  return {
    id: wish.id,
    title: wish.title || '',
    detail: wish.detail || '',
    category: wish.category || '其他',
    emoji: categoryEmoji(wish.category),
    targetDate: wish.target_date || '',
    targetText: wish.target_date ? '期望 ' + formatDate(wish.target_date) : '',
    status: done ? 'done' : 'open',
    done: done,
    doneAt: wish.done_at || '',
    doneText: done && wish.done_at ? '已实现 · ' + formatDate(wish.done_at) : '',
    mine: mine,
    // 「我写的 / TA 写的」——作者自己的名字没必要重复显示
    ownerText: mine ? '我写的' : ((wish.owner_name || 'TA') + ' 的愿望')
  };
}

/**
 * 把列表分成「待实现」和「已实现」两组。
 *
 * 排序规则：
 * - 待实现：填了期望日期的按日期近的在前，没填日期的沉底（永远实现不了的那类）
 * - 已实现：按完成时间倒序，刚实现的排最上面
 *
 * @param {Array} list 数据库原始行数组
 * @param {string} myId 当前登录用户 id
 * @returns {{open: Array, done: Array}}
 */
function group(list, myId) {
  const open = [];
  const done = [];

  for (const raw of list || []) {
    const item = describe(raw, myId);
    if (!item) continue;
    if (item.done) done.push(item);
    else open.push(item);
  }

  open.sort((a, b) => {
    if (a.targetDate && b.targetDate) {
      return a.targetDate < b.targetDate ? -1 : (a.targetDate > b.targetDate ? 1 : 0);
    }
    if (a.targetDate) return -1;
    if (b.targetDate) return 1;
    return 0;
  });

  done.sort((a, b) => {
    if (a.doneAt && b.doneAt) {
      return a.doneAt < b.doneAt ? 1 : (a.doneAt > b.doneAt ? -1 : 0);
    }
    return 0;
  });

  return { open: open, done: done };
}

/** 统计：待实现 / 已实现 / 我写的待实现 / TA 写的待实现 */
function stats(grouped) {
  const g = grouped || { open: [], done: [] };
  const mineOpen = g.open.filter((x) => x.mine).length;
  return {
    openCount: g.open.length,
    doneCount: g.done.length,
    totalCount: g.open.length + g.done.length,
    mineOpen: mineOpen,
    partnerOpen: g.open.length - mineOpen
  };
}

module.exports = {
  CATEGORIES,
  CATEGORY_KEYS,
  categoryEmoji,
  isDone,
  parseDate,
  formatDate,
  describe,
  group,
  stats
};
