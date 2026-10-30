/**
 * 首页功能入口清单。
 *
 * 为什么单独放一个文件：
 * 1. 它是**内容**不是页面逻辑——首页只负责渲染，分类和文案集中在这里，
 *    以后调整分组只动这一个文件，不用在页面里翻。
 * 2. 纯数据、无依赖，可以直接被单测引用。
 * 3. 首页 index.js 原本 13KB，抽出后瘦了一大截，可读性明显变好。
 *
 * 分组说明：
 *   记录我们   —— 留下两个人的回忆
 *   一起生活   —— 一起做的事
 *   关心与日常 —— 关于对方，以及每天都会用到的小功能
 *
 * 卡片统一按「每行 3 条」排布（33.33% 宽），不论组里有几条，
 * 卡片尺寸完全一致。只有最后一组是 4 条，会多排一行，末尾单独一张。
 *
 * tint 是图标底色：10 个入口用几组柔和色系交替排列，
 * 既保持整体统一，又不会一眼望去全是同一个粉色方块。
 */

const FEATURE_GROUPS = [
  {
    title: '记录我们',
    items: [
      { key: 'anniversary', emoji: '💗', name: '纪念日', desc: '阳历农历', tint: '#FFECF2' },
      { key: 'diary', emoji: '📖', name: '情侣日记', desc: '记录点滴', tint: '#FFF1E4' },
      { key: 'album', emoji: '📷', name: '情侣相册', desc: '双人共享', tint: '#E9F1FF' }
    ]
  },
  {
    title: '一起生活',
    items: [
      { key: 'recipe', emoji: '🍳', name: '点菜做饭', desc: '416 道家常菜', tint: '#FFF3DA' },
      { key: 'schedule', emoji: '📅', name: '日程', desc: '约定提醒', tint: '#EFE9FF' },
      { key: 'wish', emoji: '✨', name: '愿望清单', desc: '写下心愿', tint: '#E3F6F1' }
    ]
  },
  {
    title: '关心与日常',
    items: [
      { key: 'preference', emoji: '💝', name: 'TA 的喜好', desc: '爱吃的想去的', tint: '#FFECF2' },
      { key: 'location', emoji: '📍', name: '实时位置', desc: '看看 TA 在哪', tint: '#E9F1FF' },
      { key: 'cycle', emoji: '🌸', name: '经期记录', desc: '自动学习预测', tint: '#E3F6F1' },
      { key: 'weather', emoji: '🌤', name: '天气', desc: '实时本地天气', tint: '#FFF1E4' }
    ]
  }
]

/** 功能总数（首页显示「共 N 项」，避免手写数字过期） */
const FEATURE_COUNT = FEATURE_GROUPS.reduce((n, g) => n + g.items.length, 0)

/** 所有功能的 key 集合，用于校验跳转路由与清单一致 */
const FEATURE_KEYS = FEATURE_GROUPS.reduce((keys, g) => keys.concat(g.items.map((i) => i.key)), [])

module.exports = { FEATURE_GROUPS, FEATURE_COUNT, FEATURE_KEYS }
