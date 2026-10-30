const app = getApp()
const api = require('../../utils/api.js')
const ui = require('../../utils/ui.js')
const wishLib = require('../../utils/wish.js')
const notifier = require('../../utils/notifier.js')
const subscribe = require('../../utils/subscribe.js')

const CACHE_KEY = 'wish_cache'
const CACHE_MS = 60 * 1000

Page({
  data: {
    loading: true,
    coupled: false,
    openList: [],
    doneList: [],
    stats: { openCount: 0, doneCount: 0, totalCount: 0, mineOpen: 0, partnerOpen: 0 },
    showForm: false,
    editingId: null,
    categories: wishLib.CATEGORY_KEYS,
    form: { title: '', category: '想去', detail: '', target_date: '' },
    saving: false,
    todayText: ''
  },

  onLoad() {
    // 日期选择器的默认值必须是合法日期，空串在部分基础库上会告警
    const now = new Date()
    this.setData({
      todayText: now.getFullYear() + '-' +
        (now.getMonth() + 1 < 10 ? '0' : '') + (now.getMonth() + 1) + '-' +
        (now.getDate() < 10 ? '0' : '') + now.getDate()
    })
  },

  onShow() {
    const coupled = app.isCoupled()
    this.setData({ coupled: coupled })
    if (coupled) {
      this.load()
    } else {
      this.setData({ loading: false, openList: [], doneList: [] })
    }
  },

  onPullDownRefresh() {
    this.load(true).finally(() => wx.stopPullDownRefresh())
  },

  onShareAppMessage() {
    return { title: '我们的愿望清单' }
  },

  /** 当前登录用户 id，用来判断愿望是不是「我写的」 */
  myId() {
    const s = app.globalData.session
    return (s && s.user && s.user.id) || null
  },

  /** 找到一条愿望（待实现 + 已实现两张表里一起找） */
  findWish(id) {
    const all = this.data.openList.concat(this.data.doneList)
    return all.find((x) => String(x.id) === String(id)) || null
  },

  async load(force) {
    const couple = app.globalData.couple
    if (!couple) return

    // 缓存的是**原始行**，不是渲染后的结构——
    // 这样换个人登录同一台设备时，「我写的 / TA 写的」仍然能正确区分
    const cached = wx.getStorageSync(CACHE_KEY) || null
    if (!force && cached && cached.data && cached.coupleId === couple.id && Date.now() - cached.at < CACHE_MS) {
      this.render(cached.data)
      this.setData({ loading: false })
      return
    }

    this.setData({ loading: true })
    try {
      const rows = await api.listWishes(couple.id)
      wx.setStorageSync(CACHE_KEY, { at: Date.now(), coupleId: couple.id, data: rows })
      this.render(rows)
      // 看过愿望清单就把「愿望提醒」标记为已读，避免首页反复弹同一条
      this.markNotifiedRead()
    } catch (e) {
      ui.err(e, '读取愿望清单失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  render(rows) {
    const grouped = wishLib.group(rows, this.myId())
    this.setData({
      openList: grouped.open,
      doneList: grouped.done,
      stats: wishLib.stats(grouped)
    })
  },

  async markNotifiedRead() {
    const couple = app.globalData.couple
    if (!couple) return
    try {
      await api.markRemindersRead(couple.id, notifier.KIND_WISH)
    } catch (e) {
      // 标记失败不影响使用
    }
  },

  /* ---------- 表单 ---------- */

  /**
   * 愿望清单是两个人一起用的，这里做两级拦截：
   * 未登录 → 引导登录；已登录但没绑情侣 → 提示先去邀请。
   */
  ensureCoupled() {
    if (!app.globalData.session) {
      ui.requireLogin(this, () => {
        const coupled = app.isCoupled()
        this.setData({ coupled: coupled })
        if (coupled) this.load(true)
      })
      return false
    }
    if (!app.isCoupled()) {
      ui.alert('愿望清单要等你们绑定情侣后才能一起写，先邀请 TA 吧', '还不能用')
      return false
    }
    return true
  },

  openForm(e) {
    if (!this.ensureCoupled()) return
    const id = (e.currentTarget.dataset && e.currentTarget.dataset.id) || null
    if (id) {
      const row = this.findWish(id)
      if (!row) return
      // 只能改自己的愿望——TA 的心愿不该被第三个人改写
      if (!row.mine) {
        ui.alert('这是 TA 的愿望，只能 TA 自己修改', '改不了')
        return
      }
      this.setData({
        editingId: row.id,
        showForm: true,
        form: {
          title: row.title,
          category: row.category,
          detail: row.detail,
          target_date: row.targetDate
        }
      })
      return
    }
    this.setData({
      editingId: null,
      showForm: true,
      form: { title: '', category: '想去', detail: '', target_date: '' }
    })
  },

  closeForm() {
    this.setData({ showForm: false })
  },

  onTitle(e) { this.setData({ 'form.title': e.detail.value }) },
  onDetail(e) { this.setData({ 'form.detail': e.detail.value }) },
  onCategory(e) { this.setData({ 'form.category': e.currentTarget.dataset.cat }) },
  onDateChange(e) { this.setData({ 'form.target_date': e.detail.value }) },
  clearDate() { this.setData({ 'form.target_date': '' }) },

  async submit() {
    if (!this.ensureCoupled()) return
    const f = this.data.form
    const title = (f.title || '').trim()
    if (!title) {
      ui.toast('写下你的愿望吧')
      return
    }

    const couple = app.globalData.couple
    const editing = !!this.data.editingId
    this.setData({ saving: true })

    // ⚠️ 订阅授权必须在「用户点击」的同步上下文里发起，所以先发起、不 await，
    // 后面保存完再等它。模板没配好时 requestSubscribe 会直接返回，
    // 不会弹窗，也不影响保存流程。
    // 这里额外包一层 try：万一它同步抛错，也不能连带愿望本身保存失败。
    let subPromise = Promise.resolve()
    try {
      subPromise = Promise.resolve(subscribe.requestSubscribe(['wish'], couple.id)).catch(() => {})
    } catch (e) {
      subPromise = Promise.resolve()
    }

    try {
      const payload = {
        title: title,
        category: f.category || '想去',
        detail: (f.detail || '').trim() || null,
        target_date: f.target_date || null
      }

      let saved = null
      if (editing) {
        saved = await api.updateWish(couple.id, this.data.editingId, payload)
      } else {
        saved = await api.createWish(couple.id, Object.assign({
          owner_name: app.myName()
        }, payload))
      }

      // 通知对方：写入提醒表 → TA 进小程序就能看到（配好模板还能推到微信）
      let notified = false
      if (!editing && saved) {
        const r = await notifier.enqueueWish(saved, {
          coupleId: couple.id,
          from: app.myName() || 'TA',
          toName: app.partnerName()
        })
        notified = r.created > 0
      }

      await subPromise

      this.setData({ showForm: false })
      this.load(true)
      if (editing) ui.ok('已更新')
      else if (notified) ui.ok('已通知 TA')
      else ui.ok('写下来啦')
    } catch (e) {
      ui.err(e, '保存失败')
    } finally {
      this.setData({ saving: false })
    }
  },

  /* ---------- 操作 ---------- */

  /** 标记实现 / 取消实现 */
  async toggleDone(e) {
    if (!this.ensureCoupled()) return
    const id = e.currentTarget.dataset.id
    const row = this.findWish(id)
    if (!row) return
    const next = row.done ? 'open' : 'done'
    try {
      await api.updateWish(app.globalData.couple.id, id, { status: next })
      this.load(true)
    } catch (err) {
      ui.err(err, '操作失败')
    }
  },

  /** 删除：只允许删自己写的 */
  async del(e) {
    const id = e.currentTarget.dataset.id
    const row = this.findWish(id)
    if (!row) return
    if (!row.mine) {
      ui.alert('这是 TA 的愿望，只能 TA 自己删除', '删不了')
      return
    }
    const ok = await ui.confirm({
      title: '删掉这个愿望',
      content: '删了就找不回来了',
      confirmText: '删除',
      danger: true
    })
    if (!ok) return
    try {
      await api.deleteWish(app.globalData.couple.id, id)
      this.load(true)
    } catch (err) {
      ui.err(err, '删除失败')
    }
  }
})
