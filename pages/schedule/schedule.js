const app = getApp()
const api = require('../../utils/api.js')
const scheduleLib = require('../../utils/schedule.js')
const subscribe = require('../../utils/subscribe.js')
const ui = require('../../utils/ui.js')

const CACHE_KEY = 'schedule_cache'
const CACHE_MS = 3 * 60 * 1000

/** 强提醒：进入页面时扫描并弹出（提前 remind_before 分钟内） */
const REMIND_CHECK_MS = 20 * 1000

Page({
  data: {
    list: [],
    todayList: [],
    loading: true,
    showForm: false,
    editingId: null,
    categories: scheduleLib.CATEGORIES,
    priorityList: [
      { key: 'normal', label: '普通' },
      { key: 'high', label: '重要' },
      { key: 'urgent', label: '紧急' }
    ],
    repeatList: [
      { key: 'once', label: '仅此一次' },
      { key: 'daily', label: '每天' },
      { key: 'weekly', label: '每周' },
      { key: 'monthly', label: '每月' },
      { key: 'yearly', label: '每年' }
    ],
    remindList: scheduleLib.REMIND_OPTIONS,
    form: {
      title: '',
      event_date: '',
      event_time: '09:00',
      category: '日常',
      priority: 'normal',
      repeat_rule: 'once',
      remind_before: 30,
      note: ''
    }
  },

  onLoad() {
    const today = scheduleLib.dateText(new Date())
    this.setData({ 'form.event_date': today })
  },

  onShow() {
    if (app.isCoupled()) {
      this.load()
      this.startReminder()
    } else {
      this.setData({ list: [], todayList: [], loading: false })
    }
  },

  onHide() {
    this.stopReminder()
  },

  onUnload() {
    this.stopReminder()
  },

  onPullDownRefresh() {
    this.load(true).finally(() => wx.stopPullDownRefresh())
  },

  /* ---------- 数据 ---------- */

  async load(force) {
    const coupleId = app.globalData.couple && app.globalData.couple.id
    if (!coupleId) return

    // 缓存：先渲染旧的，避免白屏
    const cached = wx.getStorageSync(CACHE_KEY) || null
    if (!force && cached && cached.data && Date.now() - cached.at < CACHE_MS) {
      this.render(cached.data)
      this.setData({ loading: false })
      return
    }

    this.setData({ loading: true })
    try {
      const rows = await api.listSchedules(coupleId)
      wx.setStorageSync(CACHE_KEY, { at: Date.now(), data: rows })
      this.render(rows)
    } catch (e) {
      ui.err(e, '读取失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  /** 加工列表：算倒计时、区分今天 */
  render(rows) {
    const now = new Date()
    const decorated = (rows || []).map((r) => {
      const item = Object.assign({}, r)
      const next = scheduleLib.nextOccurrence(r, now)
      item._clock = (r.event_time || '').slice(0, 5)
      item._when = next
        ? scheduleLib.formatWhen(scheduleLib.dateText(next), r.event_time, now)
        : '已结束'
      item._remain = scheduleLib.remainText(
        next ? next.getTime() - now.getTime() : 0
      )
      item._next = next
      // 标签文案预计算：WXML 里不写方法调用（避免每次渲染重复执行）
      item._priorityLabel = this.priorityLabel(r.priority)
      item._repeatLabel = this.repeatLabel(r.repeat_rule)
      return item
    })

    // 今天要做的（含今天到点但未完成的）
    const todayList = decorated.filter((x) => {
      if (x.is_done) return false
      const d = x._next || scheduleLib.toDate(x.event_date, x.event_time)
      return d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
    })

    // 排序：未完成在前，然后按时间
    decorated.sort((a, b) => {
      if (!!a.is_done !== !!b.is_done) return a.is_done ? 1 : -1
      const at = (a._next || scheduleLib.toDate(a.event_date, a.event_time)).getTime()
      const bt = (b._next || scheduleLib.toDate(b.event_date, b.event_time)).getTime()
      return at - bt
    })

    this.setData({ list: decorated, todayList: todayList })
  },

  /* ---------- 强提醒 ---------- */

  startReminder() {
    if (this.remindTimer) return
    this.checkReminders()
    this.remindTimer = setInterval(() => this.checkReminders(), REMIND_CHECK_MS)
  },

  stopReminder() {
    if (this.remindTimer) {
      clearInterval(this.remindTimer)
      this.remindTimer = null
    }
  },

  /**
   * 强提醒：距开始时间在 remind_before 分钟内的未完成日程会弹窗。
   * 每条只提醒一次（用 _notified 标记），避免每 20 秒重复弹。
   */
  checkReminders() {
    const now = Date.now()
    const due = this.data.list.filter((x) => {
      if (x.is_done || x._notified) return false
      if (!x._next) return false
      const delta = x._next.getTime() - now
      const before = (x.remind_before || 0) * 60000
      // 已开始但还没超过 5 分钟的也算（刚好错过提醒时间点）
      return delta <= before && delta > -5 * 60000
    })
    if (!due.length) return

    // 取最近的一条弹，其余标记已提醒
    due.sort((a, b) => (a._next.getTime() - b._next.getTime()))
    const target = due[0]
    this.markNotified(target.id)

    wx.showModal({
      title: '⏰ ' + target.title,
      content: scheduleLib.formatWhen(
        scheduleLib.dateText(target._next), target.event_time, new Date()
      ) + ' 开始\n' + (target.note || '别忘了哦'),
      confirmText: '知道啦',
      cancelText: target.is_done ? '' : '标记完成',
      success: (r) => {
        if (r.cancel) this.toggleDone({ currentTarget: { dataset: { id: target.id } } })
      }
    })
  },

  markNotified(id) {
    const list = this.data.list.map((x) => {
      return x.id === id ? Object.assign({}, x, { _notified: true }) : x
    })
    this.setData({ list: list })
  },

  /* ---------- 表单 ---------- */

  openForm(e) {
    const id = e.currentTarget.dataset.id
    if (id) {
      const row = this.data.list.find((x) => String(x.id) === String(id))
      if (row) {
        this.setData({
          editingId: row.id,
          showForm: true,
          form: {
            title: row.title,
            event_date: row.event_date,
            event_time: row.event_time || '09:00',
            category: row.category || '日常',
            priority: row.priority || 'normal',
            repeat_rule: row.repeat_rule || 'once',
            remind_before: row.remind_before == null ? 30 : row.remind_before,
            note: row.note || ''
          }
        })
        return
      }
    }
    this.setData({
      editingId: null,
      showForm: true,
      form: {
        title: '',
        event_date: scheduleLib.dateText(new Date()),
        event_time: '09:00',
        category: '日常',
        priority: 'normal',
        repeat_rule: 'once',
        remind_before: 30,
        note: ''
      }
    })
  },

  closeForm() {
    this.setData({ showForm: false })
  },

  onTitle(e) { this.setData({ 'form.title': e.detail.value }) },
  onNote(e) { this.setData({ 'form.note': e.detail.value }) },
  onDate(e) { this.setData({ 'form.event_date': e.detail.value }) },
  onTime(e) { this.setData({ 'form.event_time': e.detail.value }) },
  onCategory(e) { this.setData({ 'form.category': e.currentTarget.dataset.cat }) },
  onPriority(e) { this.setData({ 'form.priority': e.currentTarget.dataset.pri }) },
  onRepeat(e) { this.setData({ 'form.repeat_rule': e.currentTarget.dataset.rep }) },
  onRemind(e) {
    this.setData({ 'form.remind_before': Number(e.currentTarget.dataset.rem) })
  },

  async submit() {
    const f = this.data.form
    if (!f.title.trim()) {
      ui.toast('填个标题吧')
      return
    }
    if (!f.event_date) {
      ui.toast('选个日期')
      return
    }

    const coupleId = app.globalData.couple.id
    const payload = {
      owner_name: (app.globalData.profile && app.globalData.profile.owner_name) || null,
      title: f.title.trim(),
      event_date: f.event_date,
      event_time: f.event_time,
      category: f.category,
      priority: f.priority,
      repeat_rule: f.repeat_rule,
      remind_before: f.remind_before,
      note: f.note.trim() || null
    }

    try {
      if (this.data.editingId) {
        await api.updateSchedule(coupleId, this.data.editingId, payload)
      } else {
        await api.createSchedule(coupleId, payload)
        // 新建后请求订阅授权，攒微信推送额度
        subscribe.requestSubscribe(['anniversary'], coupleId).catch(() => {})
      }
      this.setData({ showForm: false })
      this.load(true)
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (e) {
      ui.err(e, '保存失败')
    }
  },

  async toggleDone(e) {
    const id = e.currentTarget.dataset.id
    const row = this.data.list.find((x) => String(x.id) === String(id))
    if (!row) return
    try {
      await api.updateSchedule(app.globalData.couple.id, id, { is_done: !row.is_done })
      this.load(true)
    } catch (err) {
      ui.err(err, '操作失败')
    }
  },

  async del(e) {
    const id = e.currentTarget.dataset.id
    const ok = await ui.confirm({ title: '删除日程', content: '删掉就找不回来了', confirmText: '删除', danger: true })
    if (!ok) return
    try {
      await api.deleteSchedule(app.globalData.couple.id, id)
      this.load(true)
    } catch (err) {
      ui.err(err, '删除失败')
    }
  },

  /* ---------- WXML 里用的简单映射 ---------- */
  priorityLabel(key) {
    const map = { normal: '普通', high: '重要', urgent: '紧急' }
    return map[key] || '普通'
  },

  repeatLabel(key) {
    const map = {
      once: '', daily: '每天', weekly: '每周',
      monthly: '每月', yearly: '每年'
    }
    return map[key] || ''
  }
})
