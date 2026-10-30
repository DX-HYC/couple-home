const api = require('./api.js')
const config = require('./subscribe.config.js')

/**
 * 微信订阅消息。
 *
 * ⚠️ 重要限制：个人小程序只能用「一次性订阅」——用户点一次「允许」，
 * 只能发一条消息，额度用完即止。所以必须在多个节点请求授权来攒额度，
 * 而不能指望「订阅一次就一直推」。
 *
 * 模板 ID 填在 subscribe.config.js 里，不用改业务代码。
 * 申请步骤见 docs/订阅消息配置指南.md
 */

const TEMPLATES = [
  { id: config.TEMPLATE_IDS.anniversary, name: '纪念日提醒', scene: 'anniversary' },
  { id: config.TEMPLATE_IDS.order, name: '点菜通知', scene: 'order' },
  // 愿望通知：模板 ID 未配置时会被 readyTemplates() 自动过滤掉，
  // 不会发起多余的授权弹窗（愿望功能仍走应用内提醒，照常可用）
  { id: config.TEMPLATE_IDS.wish, name: '愿望通知', scene: 'wish' }
];

/** 已配置的模板 */
function readyTemplates() {
  return TEMPLATES.filter((t) => !!t.id)
}

/** 是否已配置模板 ID —— 未配置时不发起订阅请求 */
function templatesReady() {
  return readyTemplates().length > 0
}

/** 某个场景是否已配置 */
function hasTemplate(scene) {
  const t = TEMPLATES.find((x) => x.scene === scene)
  return !!(t && t.id)
}

/**
 * 拉起订阅授权。必须在用户点击行为中调用。
 * @param {Array} scenes 需要授权的场景；不传表示全部
 * @param {number} coupleId 当前情侣关系 id，用于把订阅记录关联到情侣
 * 返回 { granted, count, map }：granted 表示是否至少授权了一个模板。
 */
function requestSubscribe(scenes, coupleId) {
  if (!templatesReady()) {
    return Promise.resolve({ granted: false, map: {}, reason: 'not-configured' })
  }
  const wanted = readyTemplates().filter((t) => !scenes || scenes.indexOf(t.scene) !== -1)
  const ids = wanted.map((t) => t.id).filter(Boolean)
  if (!ids.length) return Promise.resolve({ granted: false, map: {}, reason: 'not-configured' })

  // 微信限制：一次最多 3 个模板
  if (ids.length > 3) ids.length = 3

  return new Promise((resolve) => {
    wx.requestSubscribeMessage({
      tmplIds: ids,
      success: async (res) => {
        const map = {}
        let granted = 0
        for (const t of wanted) {
          const val = res[t.id]
          map[t.scene] = val === 'accept'
          if (val === 'accept') {
            granted += 1
            try {
              // ⚠️ coupleId 必须传真实的，否则 subscriptions.couple_id 会写成 null，
              // 订阅记录与情侣关系彻底脱钩
              await api.saveSubscription(coupleId, t.id, true)
            } catch (e) {
              // 订阅状态记录失败不阻断授权结果
            }
          }
        }
        resolve({ granted: granted > 0, count: granted, map: map })
      },
      fail: (e) => {
        const msg = (e && e.errMsg) || ''
        console.warn('[subscribe] 授权失败', JSON.stringify({ errMsg: msg }))
        resolve({ granted: false, map: {}, reason: 'rejected' })
      }
    })
  })
}

module.exports = { TEMPLATES, templatesReady, readyTemplates, hasTemplate, requestSubscribe }
