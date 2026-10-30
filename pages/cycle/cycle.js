const app = getApp()
const api = require('../../utils/api.js')
const cycle = require('../../utils/cycle.js')
const subscribe = require('../../utils/subscribe.js')
const ui = require('../../utils/ui.js')

const CACHE_KEY = 'cycle_cache'
const CACHE_MS = 3 * 60 * 1000

Page({
  data: {
    list: [],
    pred: null,
    tips: [],
    phaseText: '',
    confidenceText: '',
    confidencePct: 0,
    trendWord: '',
    loading: true,
    showForm: false,
    editingId: null,
    periodOpts: [3, 4, 5, 6, 7],
    cycleOpts: [21, 24, 26, 28, 30, 32, 35],
    flowOpts: [
      { key: 'light', label: '少' },
      { key: 'normal', label: '正常' },
      { key: 'heavy', label: '多' }
    ],
    form: {
      start_date: '',
      end_date: '',
      period_length: 5,
      cycle_length: 28,
      flow: 'normal',
      symptom: '',
      note: ''
    }
  },

  onLoad() {
    this.setData({ 'form.start_date': cycle.text(new Date()) })
  },

  onShow() {
    if (app.isCoupled()) {
      this.load()
    } else {
      this.setData({ list: [], pred: null, loading: false })
    }
  },

  onPullDownRefresh() {
    this.load(true).finally(() => wx.stopPullDownRefresh())
  },

  onShareAppMessage() {
    return { title: '她的周期记录' }
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
      const rows = await api.listCycles(coupleId)
      wx.setStorageSync(CACHE_KEY, { at: Date.now(), data: rows })
      this.render(rows)
    } catch (e) {
      ui.err(e, '读取失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  render(rows) {
    const now = new Date()

    // 记录列表加工：加月日、持续天数、与上次的间隔
    const sorted = (rows || []).slice().sort((a, b) => {
      return a.start_date < b.start_date ? 1 : -1
    })
    for (let i = 0; i < sorted.length; i += 1) {
      const r = sorted[i]
      const d = cycle.parseDate(r.start_date)
      r._m = d ? (d.getMonth() + 1) + '月' : ''
      r._d = d ? d.getDate() : ''
      r._len = r.end_date ? cycle.diffDays(r.start_date, r.end_date) + 1 : 0
      // 与上一条（更早一次）的间隔
      const prev = sorted[i + 1]
      r._gap = prev ? cycle.diffDays(prev.start_date, r.start_date) : 0
      // 流量文案预计算：WXML 里不写方法调用
      r._flowLabel = this.flowLabel(r.flow)
    }

    const pred = cycle.predictNext(rows, now)
    const tips = cycle.reminders(pred, now)

    this.setData({
      list: sorted,
      pred: pred ? Object.assign({}, pred, {
        _nextText: cycle.cnText(pred.nextStart),
        _ovuText: cycle.cnText(pred.ovulation),
        _fertileText: cycle.cnText(pred.fertileStart) + ' ~ ' + cycle.cnText(pred.fertileEnd),
        _lastText: cycle.cnText(pred.lastStart)
      }) : null,
      tips: tips,
      phaseText: this.phaseText(pred),
      confidenceText: this.confidenceText(pred),
      confidencePct: pred ? Math.round(pred.learned.confidence * 100) : 0,
      trendWord: pred && pred.learned.trend && pred.learned.trend.slope > 0 ? '变长' : '变短'
    })
  },

  phaseText(p) {
    if (!p) return ''
    const map = { period: '经期中', fertile: '易孕期', normal: '安全期', none: '' }
    return map[p.phase] || ''
  },

  /** 置信度文案：不把不确定的说成确定的 */
  confidenceText(p) {
    if (!p) return ''
    const c = p.learned.confidence
    if (c >= 0.8) return '预测较准'
    if (c >= 0.5) return '预测中'
    if (c >= 0.2) return '学习中'
    return '样本不足'
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
            start_date: row.start_date,
            end_date: row.end_date || '',
            period_length: row.period_length || 5,
            cycle_length: row.cycle_length || 28,
            flow: row.flow || 'normal',
            symptom: row.symptom || '',
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
        start_date: cycle.text(new Date()),
        end_date: '',
        period_length: 5,
        cycle_length: 28,
        flow: 'normal',
        symptom: '',
        note: ''
      }
    })
  },

  closeForm() {
    this.setData({ showForm: false })
  },

  onStart(e) { this.setData({ 'form.start_date': e.detail.value }) },
  onEnd(e) { this.setData({ 'form.end_date': e.detail.value }) },
  onPeriodLen(e) { this.setData({ 'form.period_length': Number(e.currentTarget.dataset.pl) }) },
  onCycleLen(e) { this.setData({ 'form.cycle_length': Number(e.currentTarget.dataset.cl) }) },
  onFlow(e) { this.setData({ 'form.flow': e.currentTarget.dataset.flow }) },
  onSymptom(e) { this.setData({ 'form.symptom': e.detail.value }) },
  onNote(e) { this.setData({ 'form.note': e.detail.value }) },

  async submit() {
    const f = this.data.form
    if (!f.start_date) {
      ui.toast('选个开始日期')
      return
    }
    // 结束日期不能早于开始日期
    if (f.end_date && f.end_date < f.start_date) {
      ui.toast('结束日期不能早于开始')
      return
    }

    const coupleId = app.globalData.couple.id
    const payload = {
      owner_name: (app.globalData.profile && app.globalData.profile.owner_name) || null,
      start_date: f.start_date,
      end_date: f.end_date || null,
      period_length: f.period_length,
      cycle_length: f.cycle_length,
      flow: f.flow,
      symptom: f.symptom.trim() || null,
      note: f.note.trim() || null
    }

    try {
      if (this.data.editingId) {
        await api.updateCycle(coupleId, this.data.editingId, payload)
      } else {
        await api.createCycle(coupleId, payload)
        // 记录后请求订阅，攒微信提醒额度
        subscribe.requestSubscribe(['anniversary'], coupleId).catch(() => {})
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
    const ok = await ui.confirm({ title: '删掉这条记录', content: '删掉后预测会重新学', confirmText: '删除', danger: true })
    if (!ok) return
    try {
      await api.deleteCycle(app.globalData.couple.id, id)
      this.load(true)
    } catch (err) {
      ui.err(err, '删除失败')
    }
  },

  flowLabel(k) {
    const map = { light: '少', normal: '正常', heavy: '多' }
    return map[k] || ''
  }
})
