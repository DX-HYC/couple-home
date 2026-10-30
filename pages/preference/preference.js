const app = getApp()
const api = require('../../utils/api.js')
const ui = require('../../utils/ui.js')

const CACHE_KEY = 'preference_cache'
const CACHE_MS = 3 * 60 * 1000

const CATEGORIES = ['爱吃', '爱喝', '爱好', '想去', '避开', '其它']

Page({
  data: {
    list: [],
    groups: [],
    favCount: 0,
    avoidCount: 0,
    loading: true,
    showForm: false,
    editingId: null,
    categories: CATEGORIES,
    form: { category: '爱吃', title: '', detail: '', is_favorite: true }
  },

  onShow() {
    if (app.isCoupled()) {
      this.load()
    } else {
      this.setData({ list: [], groups: [], loading: false })
    }
  },

  onPullDownRefresh() {
    this.load(true).finally(() => wx.stopPullDownRefresh())
  },

  onShareAppMessage() {
    return { title: 'TA 的喜好清单' }
  },

  async load(force) {
    const coupleId = app.globalData.couple && app.globalData.couple.id
    if (!coupleId) return

    const cached = wx.getStorageSync(CACHE_KEY) || null
    if (!force && cached && cached.data && Date.now() - cached.at < CACHE_MS) {
      this.render(cached.data)
      this.setData({ loading: false })
      return
    }

    this.setData({ loading: true })
    try {
      const rows = await api.listPreferences(coupleId)
      wx.setStorageSync(CACHE_KEY, { at: Date.now(), data: rows })
      this.render(rows)
    } catch (e) {
      ui.err(e, '读取失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  render(rows) {
    const list = rows || []
    const favCount = list.filter((x) => x.is_favorite).length
    const avoidCount = list.length - favCount

    // 按分类分组，保持 CATEGORIES 的顺序
    const groups = []
    for (const cat of CATEGORIES) {
      const items = list.filter((x) => (x.category || '其它') === cat)
      if (items.length) groups.push({ category: cat, items: items })
    }
    // 数据库里可能有不在预设分类里的值，兜底成一组
    const known = CATEGORIES.concat(['其它'])
    const others = list.filter((x) => known.indexOf(x.category) === -1)
    if (others.length) {
      groups.push({ category: others[0].category, items: others })
    }

    this.setData({ list: list, groups: groups, favCount: favCount, avoidCount: avoidCount })
  },

  /* ---------- 表单 ---------- */

  openForm(e) {
    const id = (e.currentTarget.dataset && e.currentTarget.dataset.id) || null
    if (id) {
      const row = this.data.list.find((x) => String(x.id) === String(id))
      if (row) {
        this.setData({
          editingId: row.id,
          showForm: true,
          form: {
            category: row.category || '爱吃',
            title: row.title,
            detail: row.detail || '',
            is_favorite: row.is_favorite !== false
          }
        })
        return
      }
    }
    this.setData({
      editingId: null,
      showForm: true,
      form: { category: '爱吃', title: '', detail: '', is_favorite: true }
    })
  },

  closeForm() {
    this.setData({ showForm: false })
  },

  onCategory(e) { this.setData({ 'form.category': e.currentTarget.dataset.cat }) },
  onFav(e) { this.setData({ 'form.is_favorite': e.currentTarget.dataset.fav === '1' }) },
  onTitle(e) { this.setData({ 'form.title': e.detail.value }) },
  onDetail(e) { this.setData({ 'form.detail': e.detail.value }) },

  async submit() {
    const f = this.data.form
    if (!f.title.trim()) {
      ui.toast('写点什么吧')
      return
    }
    const coupleId = app.globalData.couple.id
    const payload = {
      owner_name: (app.globalData.profile && app.globalData.profile.owner_name) || null,
      category: f.category,
      title: f.title.trim(),
      detail: f.detail.trim() || null,
      is_favorite: f.is_favorite
    }

    try {
      if (this.data.editingId) {
        await api.updatePreference(coupleId, this.data.editingId, payload)
      } else {
        await api.createPreference(coupleId, payload)
      }
      this.setData({ showForm: false })
      this.load(true)
      wx.showToast({ title: '记下了', icon: 'success' })
    } catch (e) {
      ui.err(e, '保存失败')
    }
  },

  async del(e) {
    const id = e.currentTarget.dataset.id
    const ok = await ui.confirm({ title: '删掉这条', content: '确定不记了吗', confirmText: '删除', danger: true })
    if (!ok) return
    try {
      await api.deletePreference(app.globalData.couple.id, id)
      this.load(true)
    } catch (err) {
      ui.err(err, '删除失败')
    }
  }
})
