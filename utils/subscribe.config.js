/**
 * 订阅消息配置（集中在这里，不用改业务代码）
 *
 * 怎么填：登录 https://mp.weixin.qq.com → 功能 → 订阅消息 → 公共模板库
 * 挑好模板加入「我的模板」，把 tpl_ 开头的 ID 贴到下面。
 * 详细步骤见 docs/订阅消息配置指南.md
 */
const TEMPLATE_IDS = {
  // 点菜通知：dkq_mZyzOfRpyvBbUcpCYOQsYIA_fiVCoX4tGazLCu0
  order: 'dkq_mZyzOfRpyvBbUcpCYOQsYIA_fiVCoX4tGazLCu0',
  // 纪念日提醒：Aoq7MpHbQgO1Uy5hu1hfckQRfu5vuYGp4Lz1S5v0mEQ
  anniversary: 'Aoq7MpHbQgO1Uy5hu1hfckQRfu5vuYGp4Lz1S5v0mEQ',
  // 愿望通知：留空表示「还没配模板」。
  // 需要推送时：mp 后台 → 功能 → 订阅消息 → 公共模板库 挑一个模板加入「我的模板」，
  // 把 tpl_ 开头的 ID 贴到这里即可，不用改任何业务代码。
  // ⚠️ 留空时愿望功能照常可用（走应用内提醒，TA 进小程序就能看到），
  //    只是不会推送到微信。详见 docs/订阅消息配置指南.md
  wish: ''
}

/**
 * 微信订阅消息模板的完整下发结构。
 * ⚠️ 字段名必须与微信公众平台「我的模板」显示的完全一致，差一个字母就报 47003。
 * 以下均按你提供的后台截图填写（模板编号：点餐 69187 / 纪念日 35877）。
 */
const TEMPLATE_FIELDS = {
  /** 家庭点餐下单完成通知 */
  order: {
    time1: 'time1',   // 下单时间
    thing4: 'thing4', // 下单用户
    thing5: 'thing5', // 菜品名称
    time6: 'time6',   // 预约时间（今天吃 / 今晚吃）
    thing7: 'thing7'  // 备注（口味偏好）
  },
  /** 纪念日提醒 */
  anniversary: {
    thing1: 'thing1', // 纪念日名称
    time2: 'time2',   // 日期
    thing4: 'thing4', // 提醒对象（情侣昵称）
    thing5: 'thing5', // 关系角色（女朋友 / 老婆…）
    time7: 'time7'    // 提醒时间
  },
  /**
   * 愿望通知
   * ⚠️ 这里的字段名是**占位**，必须和你在「我的模板」里实际选的模板对齐。
   * 选好模板后核对 mp 后台显示的字段名，改这一处即可，业务代码不用动。
   */
  wish: {
    thing1: 'thing1', // 愿望内容
    thing2: 'thing2', // 许愿人
    thing3: 'thing3', // 愿望类型（想去 / 想要 / 想做）
    time4: 'time4'    // 期望达成时间
  }
}

/** 微信模板的字段格式限制（下发时必须遵守，违反会被拒收） */
const FIELD_LIMITS = {
  thing: 20,   // 纯文字，≤20 字符
  time: 19,    // 必须 YYYY-MM-DD HH:mm:ss
  phrase: 5
}

module.exports = { TEMPLATE_IDS, TEMPLATE_FIELDS, FIELD_LIMITS }
