const app = getApp()
const api = require('../../utils/api.js')
const subscribe = require('../../utils/subscribe.js')
const ui = require('../../utils/ui.js')

// 本地菜谱库（游客可见，无需联网）。提到模块顶部，避免每次 buildList 都 require。
const LOCAL_RECIPES = require('../../utils/recipes.js')

const ADD_CATS = ['家常菜', '荤菜', '素菜', '汤羹', '主食', '凉菜', '川菜', '快手菜', '甜点', '早餐', '海鲜', '其它']
const ADD_TASTES = ['咸鲜', '清淡', '微辣', '香辣', '麻辣', '酸甜', '甜', '咸甜']
// 「喜欢吃」写入喜好表时用的标记，便于切换/识别
const LIKE_DETAIL = '❤️ 我喜欢吃的'

// 一页显示多少道菜。内置菜谱有 400 多道，一次性渲染会让列表卡到飞起，
// 这里只渲染一页，滚到底再追加。
const PAGE_SIZE = 30

Page({
  data: {
    categories: [],
    activeCat: '全部',
    // ⚠️ 这里只放**当前这一页**的列表项（见 toListItem / pickFiltered）。
    //    完整的菜谱（含食材、做法）留在 JS 侧的 this._recipes / this._custom，
    //    不进 data —— 否则几百道菜的 ingredients/steps 会被 setData 整份搬进视图层，
    //    而列表其实一个都用不到。
    filtered: [],
    hasMore: false,
    totalCount: 0,
    orders: [],
    showDetail: false,
    detail: null,
    keyword: '',
    loggedIn: false,
    likedSet: {},
    showAddForm: false,
    addCats: ADD_CATS,
    addTastes: ADD_TASTES,
    addForm: { name: '', emoji: '🍲', category: '家常菜', taste: '咸鲜', duration: '15', servings: '2', ingredients: '', steps: '', tips: '' }
  },

  onLoad() {
    // 完整菜谱只存在于 JS 侧，不进视图层
    this._recipes = []
    this._custom = []
    // 当前筛选出的完整结果（精简项），分页时从这里取
    this._filteredAll = []
  },

  /** 滚到底部：追加下一页 */
  onReachBottom() {
    this.loadMore()
  },

  /** 追加下一页 */
  loadMore() {
    if (!this.data.hasMore) return
    const shown = this.data.filtered.length
    const next = this._filteredAll.slice(shown, shown + PAGE_SIZE)
    if (!next.length) {
      this.setData({ hasMore: false })
      return
    }
    this.setData({
      filtered: this.data.filtered.concat(next),
      hasMore: shown + next.length < this._filteredAll.length
    })
  },

  onShow() {
    this.setData({ loggedIn: !!(app.globalData.session) })
    // 本地菜谱游客也能看
    this.loadAll()
    if (app.isCoupled()) {
      this.loadOrders()
      this.loadCustom()
      this.loadLiked()
    }
  },

  onPullDownRefresh() {
    this.loadAll()
    if (app.isCoupled()) {
      this.loadOrders()
      this.loadCustom()
      this.loadLiked()
    }
    wx.stopPullDownRefresh()
  },

  /** 全部菜谱（本地 + 双方自建），带完整的食材与做法 */
  allRecipes() {
    return this._recipes.concat(this._custom)
  },

  /** 按 id 找一条完整菜谱 */
  findRecipe(id) {
    return this.allRecipes().find((r) => String(r.id) === String(id)) || null
  },

  /**
   * 列表展示用的精简对象：只保留列表真正用到的字段。
   * 食材/做法只在打开详情时才需要，由 openDetail 从完整数据里取。
   */
  toListItem(r) {
    return {
      id: r.id,
      _cid: r._cid,
      name: r.name,
      emoji: r.emoji,
      category: r.category,
      taste: r.taste,
      duration: r.duration,
      servings: r.servings,
      _ingSummary: r._ingSummary,
      _custom: r._custom
    };
  },

  buildList() {
    this.mergeAndSet(this.allRecipes());
  },

  async loadAll() {
    try {
      // 内置菜谱是静态的，塑形（解析食材/做法）只做一次并缓存，
      // 不用每次 onShow 都重新解析 90 道菜
      if (!this._local) {
        this._local = LOCAL_RECIPES.map((r) => this.shapeLocal(r))
      }
      this._recipes = this._local
      this.mergeAndSet(this.allRecipes())
    } catch (e) {
      ui.toast('读取菜谱失败')
    }
  },

  shapeLocal(r) {
    const ingredients = Array.isArray(r.ingredients) ? r.ingredients : this.safeParse(r.ingredients)
    const steps = Array.isArray(r.steps) ? r.steps : this.safeParse(r.steps)
    return Object.assign({}, r, {
      _ingredients: ingredients,
      _steps: steps,
      _ingSummary: ingredients.slice(0, 4).join('、') + (ingredients.length > 4 ? ' 等' : ''),
      _custom: false
    })
  },

  shapeCustom(r) {
    const ingredients = this.safeParse(r.ingredients)
    const steps = this.safeParse(r.steps)
    return {
      id: 'c' + r.id,
      _cid: r.id,
      name: r.name,
      emoji: r.emoji || '🍲',
      category: r.category || '家常菜',
      taste: r.taste || '咸鲜',
      duration: r.duration || 15,
      servings: r.servings || 2,
      tips: r.tips || '',
      _ingredients: ingredients,
      _steps: steps,
      _ingSummary: ingredients.slice(0, 4).join('、') + (ingredients.length > 4 ? ' 等' : ''),
      _custom: true
    }
  },

  /**
   * 合并内置菜谱与双方自建菜谱，并一次性算出过滤结果。
   *
   * ⚠️ 原来这里分两步：setData({recipes}) 再 setData({filtered})，
   *    等于把全部菜谱完整数据（含食材做法）搬了两遍。
   *    现在只 setData 一次，且只送列表要用的精简字段。
   */
  mergeAndSet(recipes) {
    const cats = ['全部']
    for (const r of recipes) {
      if (r.category && cats.indexOf(r.category) === -1) cats.push(r.category)
    }
    const all = this.pickFiltered(recipes)
    this._filteredAll = all
    this.setData({
      filtered: all.slice(0, PAGE_SIZE),
      totalCount: all.length,
      hasMore: all.length > PAGE_SIZE,
      categories: cats
    })
  },

  /** 按当前分类与关键词过滤，返回精简后的列表项（完整结果） */
  pickFiltered(recipes) {
    const cat = this.data.activeCat
    const kw = (this.data.keyword || '').trim()
    const list = (recipes || []).filter((r) => {
      if (cat !== '全部' && r.category !== cat) return false
      if (kw && String(r.name || '').indexOf(kw) === -1) return false
      return true
    })
    return list.map((r) => this.toListItem(r))
  },

  safeParse(text) {
    if (!text) return []
    try {
      const arr = JSON.parse(text)
      return Array.isArray(arr) ? arr : [String(arr)]
    } catch (e) {
      return [String(text)]
    }
  },

  async loadCustom() {
    try {
      const rows = await api.listCustomRecipes(app.globalData.couple.id)
      this._custom = rows.map((r) => this.shapeCustom(r))
      this.buildList()
    } catch (e) {}
  },

  async loadLiked() {
    try {
      // 只取「爱吃」这一类（服务端已过滤），不用把全部喜好拉回来再筛
      const rows = await api.listLikedPreferences(app.globalData.couple.id)
      const set = {}
      for (const p of rows) {
        if (p.detail === LIKE_DETAIL) set[p.title] = p.id
      }
      this.setData({ likedSet: set })
      // 详情页打开时同步点赞态
      if (this.data.showDetail && this.data.detail) {
        this.setData({ 'detail._liked': !!set[this.data.detail.name] })
      }
    } catch (e) {}
  },

  async loadOrders() {
    if (!this._recipes.length) await this.loadAll()
    try {
      const orders = await api.listOrders(app.globalData.couple.id)
      const session = app.globalData.session
      this.setData({
        orders: orders.map((o) => Object.assign({}, o, {
          _isMine: o.owner_id === (session && session.user.id),
          _time: this.formatTime(o.created_at)
        }))
      })
    } catch (e) {}
  },

  formatTime(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    const now = new Date()
    const pad = (n) => (n < 10 ? '0' + n : '' + n)
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
      return '今天 ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
    }
    return (d.getMonth() + 1) + '月' + d.getDate() + '日'
  },

  onCat(e) {
    this.setData({ activeCat: e.currentTarget.dataset.cat })
    this.applyFilter()
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value })
    this.applyFilter()
  },

  applyFilter() {
    const all = this.pickFiltered(this.allRecipes())
    this._filteredAll = all
    this.setData({
      filtered: all.slice(0, PAGE_SIZE),
      totalCount: all.length,
      hasMore: all.length > PAGE_SIZE
    })
  },

  /** 未登录/未绑定：弹登录提示，返回 false；确认后登录并刷新自定义菜谱与喜好 */
  requireLogin() {
    const after = () => {
      this.setData({ loggedIn: true })
      this.loadCustom()
      this.loadLiked()
    }
    return ui.requireLogin(this, after)
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id
    // 从完整数据里取，详情面板要显示食材与做法
    const recipe = this.findRecipe(id)
    if (recipe) {
      const detail = Object.assign({}, recipe, { _liked: !!this.data.likedSet[recipe.name] })
      this.setData({ detail, showDetail: true })
    }
  },

  closeDetail() {
    this.setData({ showDetail: false, detail: null })
  },

  noop() {},

  /** 我喜欢吃：写入 TA 的喜好（category=爱吃），伴侣的喜好页同步可见；再点取消 */
  toggleLike(e) {
    const id = e.currentTarget.dataset.id
    const recipe = this.findRecipe(id)
    if (!recipe) return
    if (!this.requireLogin()) return
    const name = recipe.name
    const existId = this.data.likedSet[name]
    if (existId) {
      api.deletePreference(app.globalData.couple.id, existId).then(() => {
        const set = Object.assign({}, this.data.likedSet)
        delete set[name]
        this.setData({ likedSet: set })
        if (this.data.showDetail && this.data.detail && this.data.detail.name === name) {
          this.setData({ 'detail._liked': false })
        }
        ui.toast('已取消')
      }).catch((err) => ui.err(err, '操作失败'))
    } else {
      api.createPreference(app.globalData.couple.id, {
        owner_name: (app.globalData.profile && app.globalData.profile.owner_name) || null,
        category: '爱吃',
        title: name,
        detail: LIKE_DETAIL,
        is_favorite: true
      }).then((row) => {
        const set = Object.assign({}, this.data.likedSet)
        set[name] = row.id
        this.setData({ likedSet: set })
        if (this.data.showDetail && this.data.detail && this.data.detail.name === name) {
          this.setData({ 'detail._liked': true })
        }
        wx.showToast({ title: '已同步到 TA 的喜好', icon: 'success' })
      }).catch((err) => ui.err(err, '操作失败'))
    }
  },

  async order(e) {
    if (!this.requireLogin()) return
    const id = e.currentTarget.dataset.id
    const recipe = this.findRecipe(id)
    if (!recipe) return
    wx.showModal({
      title: '点这道菜',
      editable: true,
      placeholderText: '想说的话（可不填）',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await api.createOrder(app.globalData.couple.id, {
            recipe_id: recipe._cid || recipe.id,
            owner_name: (app.globalData.profile && app.globalData.profile.owner_name) || null,
            dish_name: recipe.name,
            note: (res.content || '').trim() || null
          })
          subscribe.requestSubscribe(['order'], app.globalData.couple.id)
          wx.showToast({ title: '已通知 TA', icon: 'success' })
          this.loadOrders()
        } catch (err) {
          ui.err(err, '点菜失败')
        }
      }
    })
  },

  async finishOrder(e) {
    const id = e.currentTarget.dataset.id
    try {
      await api.updateOrderStatus(app.globalData.couple.id, id, 'done')
      this.loadOrders()
    } catch (err) {
      ui.err(err, '操作失败')
    }
  },

  async delOrder(e) {
    const id = e.currentTarget.dataset.id
    const ok = await ui.confirm({ title: '删除这条点菜', content: '确定吗？', danger: true })
    if (!ok) return
    try {
      await api.deleteOrder(app.globalData.couple.id, id)
      this.loadOrders()
    } catch (err) {
      ui.err(err, '删除失败')
    }
  },

  /* ---------- 双方自定义菜谱 ---------- */

  openAddForm() {
    if (!this.requireLogin()) return
    this.setData({
      showAddForm: true,
      addForm: { name: '', emoji: '🍲', category: ADD_CATS[0], taste: ADD_TASTES[0], duration: '15', servings: '2', ingredients: '', steps: '', tips: '' }
    })
  },

  closeAddForm() {
    this.setData({ showAddForm: false })
  },

  onAdd(e) {
    this.setData({ ['addForm.' + e.currentTarget.dataset.field]: e.detail.value })
  },

  onAddCat(e) { this.setData({ 'addForm.category': e.currentTarget.dataset.cat }) },
  onAddTaste(e) { this.setData({ 'addForm.taste': e.currentTarget.dataset.taste }) },

  async submitAdd() {
    const f = this.data.addForm
    if (!f.name.trim()) {
      ui.toast('写个菜名吧')
      return
    }
    const split = (s) => s.split(/\n|，|,/).map((x) => x.trim()).filter(Boolean)
    const ingredients = split(f.ingredients)
    const steps = split(f.steps)
    if (!ingredients.length || !steps.length) {
      ui.toast('食材和做法都要填哦')
      return
    }
    try {
      await api.createCustomRecipe(app.globalData.couple.id, {
        name: f.name.trim(),
        emoji: (f.emoji || '🍲').trim() || '🍲',
        category: f.category,
        taste: f.taste,
        duration: Number(f.duration) || 15,
        servings: Number(f.servings) || 2,
        ingredients: ingredients,
        steps: steps,
        tips: (f.tips || '').trim() || null
      })
      this.setData({ showAddForm: false })
      this.loadCustom()
      wx.showToast({ title: '菜谱已添加', icon: 'success' })
    } catch (err) {
      ui.err(err, '添加失败')
    }
  },

  async delCustom(e) {
    const id = e.currentTarget.dataset.id
    const ok = await ui.confirm({ title: '删除这道菜', content: '确定吗？', danger: true })
    if (!ok) return
    try {
      await api.deleteCustomRecipe(app.globalData.couple.id, id)
      if (this.data.showDetail) this.setData({ showDetail: false, detail: null })
      this.loadCustom()
      ui.toast('已删除')
    } catch (err) {
      ui.err(err, '删除失败')
    }
  },

  onShareAppMessage() {
    return { title: '我发现一道好吃的菜', path: '/pages/recipe/recipe' }
  }
})
