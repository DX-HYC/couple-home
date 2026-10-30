const app = getApp()
const api = require('../../utils/api.js')
const countdown = require('../../utils/countdown.js')
const lunar = require('../../utils/lunar.js')
const subscribe = require('../../utils/subscribe.js')
const ui = require('../../utils/ui.js')

// 农历月（含闰月）按当前选中年份动态生成
Page({
  data: {
    list: [],
    showForm: false,
    editingId: null,
    title: '',
    calendarType: 'solar',
    emoji: '❤️',
    remindDays: 7,
    repeatYearly: true,
    solarMonth: 6,
    solarDay: 1,
    lunarYear: 2026,
    lunarMonth: 1,
    lunarDay: 1,
    lunarIsLeap: false,
    monthOptions: [],
    dayOptions: [],
    leapMonthOfYear: 0,
    leapLabel: '',
    canPrevLunarYear: true,
    canNextLunarYear: true,
    minLunarYear: 1900,
    maxLunarYear: 2100,
    validating: false,
    hint: ''
  },

  onShow() {
    if (!app.isCoupled()) {
      this.setData({ list: [] })
      return
    }
    this.load()
    this.startTicker()
  },

  onHide() {
    this.stopTicker()
  },

  onUnload() {
    this.stopTicker()
  },

  /** 每秒刷新倒计时的时分秒 */
  startTicker() {
    if (this.ticker) return
    this.tickCountdown()
    this.ticker = setInterval(() => this.tickCountdown(), 1000)
  },

  stopTicker() {
    if (this.ticker) {
      clearInterval(this.ticker)
      this.ticker = null
    }
  },

  /**
   * 逐条重算倒计时。
   * 只更新秒级字段，天数/日期不变时不做多余渲染。
   */
  tickCountdown() {
    const list = this.data.list
    if (!list || !list.length) return

    const now = new Date()
    let changed = false
    const next = list.map((row) => {
      // 第三个参数传真实时间，才能拿到「现在几点」算时分秒
      const desc = countdown.describe(row, now, now)
      if (!desc) return row
      const prev = row._countdown
      // prev 可能为 null（describe 算不出目标日时），必须判空再取字段
      if (prev && desc.hms === prev.hms && desc.days === prev.days) return row
      changed = true
      return Object.assign({}, row, { _countdown: desc })
    })

    if (changed) this.setData({ list: next })
  },

  /** 下拉刷新 */
  onPullDownRefresh() {
    if (!app.isCoupled()) {
      wx.stopPullDownRefresh()
      return
    }
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  async load() {
    try {
      const rows = await api.listAnniversaries(app.globalData.couple.id)
      const list = rows.map((a) => {
        const d = countdown.describe(a)
        return Object.assign({}, a, { _countdown: d })
      }).sort((x, y) => (x._countdown ? x._countdown.days : 1e9) - (y._countdown ? y._countdown.days : 1e9))
      this.setData({ list: list })
      this.checkReminders(rows)
    } catch (e) {
      ui.err(e, '读取失败')
    }
  },

  /** 内置强提醒：进入页面检查是否有即将到来的纪念日 */
  async checkReminders(rows) {
    // 每条只算一次 describe，避免重复计算（农历换算不便宜）
    const hits = []
    for (const a of rows) {
      const d = countdown.describe(a)
      if (d && d.days >= 0 && d.days <= (a.remind_days == null ? 7 : a.remind_days)) {
        hits.push({ anniversary: a, desc: d })
      }
    }
    if (!hits.length) return
    // 取最近的那条
    hits.sort((x, y) => x.desc.days - y.desc.days)

    const top = hits[0]
    const d = top.desc
    const msg = countdown.countdownText(d.days)
    wx.showModal({
      title: '💗 ' + top.anniversary.title,
      content: msg + '（' + d.targetText + '）\n记得给彼此一个惊喜',
      showCancel: false,
      confirmText: '知道啦'
    })
  },

  openForm(e) {
    const id = e.currentTarget.dataset.id
    if (id) {
      const item = this.data.list.filter((x) => String(x.id) === String(id))[0]
      if (!item) return
      const patch = {
        editingId: item.id,
        title: item.title,
        calendarType: item.calendar_type,
        emoji: item.emoji || '❤️',
        remindDays: item.remind_days,
        repeatYearly: item.repeat_yearly,
        solarMonth: item.month,
        solarDay: item.day,
        lunarMonth: item.month,
        lunarDay: item.day,
        lunarIsLeap: false,
        lunarYear: item.start_year || new Date().getFullYear()
      }
      this.setData(Object.assign({ showForm: true, hint: '' }, patch))
      this.buildMonthOptions(patch.lunarYear)
    } else {
      const y = new Date().getFullYear()
      this.setData({
        showForm: true,
        editingId: null,
        title: '',
        calendarType: 'solar',
        emoji: '❤️',
        remindDays: 7,
        repeatYearly: true,
        solarMonth: 6,
        solarDay: 1,
        lunarYear: y,
        lunarMonth: 1,
        lunarDay: 1,
        lunarIsLeap: false,
        hint: ''
      })
      this.buildMonthOptions(y)
    }
  },

  closeForm() {
    this.setData({ showForm: false, editingId: null })
  },

  noop() {},

  onTitle(e) { this.setData({ title: e.detail.value }) },

  onEmoji(e) { this.setData({ emoji: e.currentTarget.dataset.emoji }) },

  onCalendarType(e) {
    const t = e.currentTarget.dataset.type
    this.setData({ calendarType: t })
    if (t === 'lunar') this.buildMonthOptions(this.data.lunarYear)
  },

  onRemindDays(e) { this.setData({ remindDays: Number(e.currentTarget.dataset.days) }) },

  onRepeat(e) { this.setData({ repeatYearly: e.detail.value.length > 0 }) },

  /** 生成农历月份选项：12 个常规月 + 该年实际存在的闰月 */
  buildMonthOptions(year) {
    const leap = lunar.leapMonthOf(year)
    const options = []
    for (let m = 1; m <= 12; m += 1) {
      options.push({ month: m, isLeap: false, label: lunar.monthLabel(m, false) })
      if (leap === m) options.push({ month: m, isLeap: true, label: lunar.monthLabel(m, true) })
    }
    const cur = this.data
    const keepDay = cur.lunarDay
    this.setData({
      monthOptions: options,
      leapMonthOfYear: leap,
      leapLabel: leap > 0 ? lunar.monthLabel(leap, true) : '',
      lunarYear: year,
      canPrevLunarYear: year > cur.minLunarYear,
      canNextLunarYear: year < cur.maxLunarYear,
      dayOptions: this.buildDayOptions(year, cur.lunarMonth, cur.lunarIsLeap, keepDay)
    })
  },

  buildDayOptions(year, month, isLeap, keepDay) {
    const days = lunar.daysInLunarMonth(year, month, isLeap)
    const options = []
    for (let d = 1; d <= days; d += 1) options.push({ day: d, label: lunar.dayLabel(d) })
    const fixed = keepDay && keepDay <= days ? keepDay : 1
    return options.map((o) => Object.assign({}, o, { selected: o.day === fixed }))
  },

  onSolarMonth(e) { this.setData({ solarMonth: Number(e.currentTarget.dataset.m) }) },
  onSolarDay(e) { this.setData({ solarDay: Number(e.currentTarget.dataset.d) }) },
  onLunarMonth(e) {
    const month = Number(e.currentTarget.dataset.m)
    const isLeap = e.currentTarget.dataset.leap === '1'
    this.setData({
      lunarMonth: month,
      lunarIsLeap: isLeap,
      dayOptions: this.buildDayOptions(this.data.lunarYear, month, isLeap, this.data.lunarDay)
    })
  },
  onLunarDay(e) { this.setData({ lunarDay: Number(e.currentTarget.dataset.d) }) },

  onLunarYear(e) {
    const delta = Number(e.currentTarget.dataset.delta)
    const y = this.data.lunarYear + delta
    if (y < this.data.minLunarYear || y > this.data.maxLunarYear) return
    // 年份变化后，原闰月可能不存在，需重新生成月份与日期选项
    this.buildMonthOptions(y)
    const leap = lunar.leapMonthOf(y)
    let month = this.data.lunarMonth
    let isLeap = this.data.lunarIsLeap
    if (isLeap && leap !== month) isLeap = false
    this.setData({
      lunarMonth: month,
      lunarIsLeap: isLeap,
      dayOptions: this.buildDayOptions(y, month, isLeap, this.data.lunarDay)
    })
  },

  /** 保存前做真实日历校验：农历日期必须能换算成公历，否则拒绝保存 */
  async save() {
    if (this.data.validating) return
    const title = (this.data.title || '').trim()
    if (!title) {
      ui.toast('请填写纪念日名称')
      return
    }

    let month, day, startYear = null
    if (this.data.calendarType === 'lunar') {
      month = this.data.lunarMonth
      day = this.data.lunarDay
      const solar = lunar.lunarToSolar(this.data.lunarYear, month, day, this.data.lunarIsLeap)
      if (!solar) {
        ui.toast('这个农历日期在日历上不存在')
        return
      }
      startYear = this.data.lunarYear
    } else {
      month = this.data.solarMonth
      day = this.data.solarDay
      const probe = new Date(2024, month - 1, day)
      if (probe.getDate() !== day) {
        ui.toast('这个阳历日期在日历上不存在')
        return
      }
      startYear = new Date().getFullYear()
    }

    this.setData({ validating: true })
    const payload = {
      title: title,
      calendar_type: this.data.calendarType,
      month: month,
      day: day,
      start_year: startYear,
      emoji: this.data.emoji,
      remind_days: this.data.remindDays,
      repeat_yearly: this.data.repeatYearly
    }
    try {
      if (this.data.editingId) {
        await api.updateAnniversary(app.globalData.couple.id, this.data.editingId, payload)
      } else {
        await api.createAnniversary(app.globalData.couple.id, Object.assign({}, payload, {
          owner_name: (app.globalData.profile && app.globalData.profile.owner_name) || null
        }))
        // 新建后请求一次订阅授权，开启微信消息推送
        subscribe.requestSubscribe(['anniversary'], app.globalData.couple.id)
      }
      wx.showToast({ title: '已保存', icon: 'success' })
      this.setData({ showForm: false, editingId: null })
      this.load()
    } catch (e) {
      ui.err(e, '保存失败')
    } finally {
      this.setData({ validating: false })
    }
  },

  async del(e) {
    const id = e.currentTarget.dataset.id
    const ok = await ui.confirm({ title: '删除纪念日', content: '确定要删除这个纪念日吗？', danger: true })
    if (!ok) return
    try {
      await api.deleteAnniversary(app.globalData.couple.id, id)
      this.load()
    } catch (err) {
      ui.err(err, '删除失败')
    }
  }
})
