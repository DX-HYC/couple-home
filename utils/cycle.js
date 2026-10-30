/**
 * 经期记录与预测（含自主学习）。
 *
 * 为什么不能简单套用 28 天或平均间隔：
 * 每个人的周期都不同，而且同一个人在不同阶段也会有变化
 * （压力、作息、季节都会影响）。所以预测必须「跟着记录学」。
 *
 * 学习策略分三层，逐层细化：
 *
 * 1. 加权移动平均
 *    越近的记录越能反映当前状态，因此按时间远近给不同权重。
 *    权重 = 1/sqrt(1+age)，age 是「这条记录距今有多少个周期」。
 *    早期不规律的记录自动被稀释，不用手动决定「取最近几次」。
 *
 * 2. 趋势修正（线性回归）
 *    如果周期在持续变长或变短，用最小二乘拟合斜率，
 *    在加权平均的基础上叠加趋势项，避免系统性地偏早或偏晚。
 *    只在样本足够且 R² 显著时才启用，并限幅 ±3 天。
 *
 * 3. 置信度评估
 *    根据样本量与变异系数给出 0~1 的置信度。
 *    界面据此区分「预测」与「参考」，不把不确定的说成确定的。
 *
 * 自主学习的关键约束：模型只用**已发生的真实记录**训练，
 * 每新增一条记录就重新拟合，不需要保存任何中间状态。
 */

const pad = (n) => (n < 10 ? '0' + n : '' + n)

function parseDate(s) {
  const d = String(s || '').split('-')
  if (d.length !== 3) return null
  const x = new Date(Number(d[0]), Number(d[1]) - 1, Number(d[2]))
  if (isNaN(x.getTime())) return null
  return x
}

function text(d) {
  const x = d instanceof Date ? d : new Date(d)
  if (d == null || d === '' || isNaN(x.getTime())) return ''
  return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate())
}

/** 整天差（b - a） */
function diffDays(a, b) {
  const x = parseDate(text(a))
  const y = parseDate(text(b))
  if (!x || !y) return 0
  return Math.round((y.getTime() - x.getTime()) / 86400000)
}

function addDays(d, n) {
  const x = new Date(d.getTime())
  x.setDate(x.getDate() + n)
  return x
}

function cnText(d) {
  const x = d instanceof Date ? d : parseDate(d)
  if (!x) return ''
  return (x.getMonth() + 1) + '月' + x.getDate() + '日'
}

/* ==================== 自主学习 ==================== */

/**
 * 加权移动平均周期。
 *
 * @param {Array<number>} gaps 间隔序列
 * @returns {{weighted:number, plain:number, variance:number, cv:number}}
 */
function weightedCycle(gaps) {
  const list = (gaps || []).filter((g) => g >= 15 && g <= 60)
  if (!list.length) {
    return { weighted: 0, plain: 0, variance: 0, cv: 0 }
  }

  // 权重随「距今多少个周期」衰减，用平方根而非线性：
  // 线性衰减会让最近一条权重过高，一次异常就能带偏预测
  let wsum = 0
  let wavg = 0
  for (let i = 0; i < list.length; i += 1) {
    const age = list.length - 1 - i          // 0 = 最近
    const w = 1 / Math.sqrt(1 + age)
    wavg += list[i] * w
    wsum += w
  }
  wavg = wavg / wsum

  const plain = list.reduce((s, g) => s + g, 0) / list.length

  // 变异系数：反映规律程度。越小越规律，预测越可信
  const variance = list.reduce((s, g) => s + Math.pow(g - plain, 2), 0) / list.length
  const cv = plain > 0 ? Math.sqrt(variance) / plain : 1

  return {
    weighted: Math.round(wavg * 100) / 100,
    plain: Math.round(plain * 100) / 100,
    variance: Math.round(variance * 100) / 100,
    cv: Math.round(cv * 1000) / 1000
  }
}

/**
 * 线性趋势修正。
 * 对间隔序列做最小二乘拟合，返回斜率（天/周期）。
 * 斜率为正说明周期在变长。
 *
 * @returns {{slope:number, intercept:number, r2:number}}
 */
function trendSlope(gaps) {
  const list = (gaps || []).filter((g) => g >= 15 && g <= 60)
  const n = list.length
  if (n < 4) return { slope: 0, intercept: 0, r2: 0 }

  const xMean = (n - 1) / 2
  const yMean = list.reduce((s, g) => s + g, 0) / n

  let num = 0
  let den = 0
  for (let i = 0; i < n; i += 1) {
    num += (i - xMean) * (list[i] - yMean)
    den += Math.pow(i - xMean, 2)
  }
  if (den === 0) return { slope: 0, intercept: yMean, r2: 0 }

  const slope = num / den
  const intercept = yMean - slope * xMean

  // R²：拟合好坏。R² 低说明趋势不明显，不该用来修正
  let ssRes = 0
  let ssTot = 0
  for (let i = 0; i < n; i += 1) {
    const pred = slope * i + intercept
    ssRes += Math.pow(list[i] - pred, 2)
    ssTot += Math.pow(list[i] - yMean, 2)
  }
  const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0

  return { slope: slope, intercept: intercept, r2: r2 }
}

/**
 * 综合学习出的周期长度。
 *
 * 数据充足时优先用「加权平均 + 趋势修正」，不足时逐级退让：
 *   4+ 条且趋势显著 → 加权平均 + 斜率（限幅 ±3）
 *   2+ 条          → 加权平均
 *   1 条           → 用户填写的周期
 *   0 条           → 默认 28
 */
function learnCycle(gaps, userCycle) {
  const w = weightedCycle(gaps)
  const safeGaps = (gaps || []).filter((g) => g >= 15 && g <= 60)

  if (!safeGaps.length) {
    return {
      cycle: userCycle || 28,
      source: userCycle ? 'user' : 'default',
      confidence: 0,
      trendApplied: false,
      trend: { slope: 0, r2: 0 },
      detail: w
    }
  }

  const t = trendSlope(safeGaps)
  let base = w.weighted || w.plain
  let source = safeGaps.length >= 2 ? 'weighted' : 'user'

  // 只有一条间隔时，用户填写的值通常更可靠
  if (safeGaps.length < 2 && userCycle) {
    base = userCycle
    source = 'user'
  }

  let learned = base
  let trendApplied = false

  // 至少 4 条、R² >= 0.5、斜率够明显才认为趋势真实
  if (safeGaps.length >= 4 && t.r2 >= 0.5 && Math.abs(t.slope) > 0.1) {
    const delta = Math.max(-3, Math.min(3, t.slope))
    learned = base + delta
    trendApplied = true
  }

  // 合理性兜底
  if (learned < 20 || learned > 45) learned = base

  // 置信度：样本量 + 规律程度
  const sampleScore = Math.min(1, safeGaps.length / 6)
  const regularScore = Math.max(0, 1 - w.cv * 2)
  const confidence = Math.round(sampleScore * regularScore * 100) / 100

  return {
    cycle: Math.round(learned * 10) / 10,
    source: source,
    confidence: confidence,
    trendApplied: trendApplied,
    trend: t,
    detail: w
  }
}

/**
 * 预测下一次经期。
 *
 * @param {Array} records 全部记录
 * @param {Date}  [today]  基准日
 */
function predictNext(records, today) {
  const base = today ? new Date(today) : new Date()
  const list = (records || [])
    .map((r) => ({ r, d: parseDate(r.start_date) }))
    .filter((x) => x.d)
    .sort((a, b) => a.d.getTime() - b.d.getTime())

  if (!list.length) return null

  const last = list[list.length - 1]
  const lastStart = last.d

  // 真实间隔序列
  const gaps = []
  for (let i = 1; i < list.length; i += 1) {
    gaps.push(diffDays(list[i - 1].d, list[i].d))
  }

  const learned = learnCycle(gaps, last.r.cycle_length)
  const cycle = learned.cycle

  // 从最后一次开始按周期后推；已过期则继续顺延
  let predicted = addDays(lastStart, Math.round(cycle))
  while (diffDays(base, predicted) < 0) {
    predicted = addDays(predicted, Math.round(cycle))
  }

  // 易孕期：排卵通常在下一次经期前 14 天
  const ovulation = addDays(predicted, -14)
  const fertileStart = addDays(ovulation, -4)
  const fertileEnd = addDays(ovulation, +4)

  const periodLength = (last.r.period_length >= 1 && last.r.period_length <= 10)
    ? last.r.period_length : 5

  const sinceLast = diffDays(lastStart, base)
  let phase = 'none'
  if (sinceLast >= 0 && sinceLast < periodLength) phase = 'period'
  else if (base.getTime() >= fertileStart.getTime() && base.getTime() <= fertileEnd.getTime()) phase = 'fertile'
  else if (sinceLast >= periodLength) phase = 'normal'

  return {
    lastStart: lastStart,
    lastEnd: last.r.end_date ? parseDate(last.r.end_date) : null,
    periodLength: periodLength,
    cycle: cycle,
    learned: learned,
    cycleCount: list.length,
    gapCount: gaps.length,
    nextStart: predicted,
    daysToNext: diffDays(base, predicted),
    ovulation: ovulation,
    fertileStart: fertileStart,
    fertileEnd: fertileEnd,
    phase: phase,
    sinceLast: sinceLast
  }
}

/**
 * 温馨提醒文案。
 */
function reminders(pred, today) {
  if (!pred) return []
  const base = today ? new Date(today) : new Date()
  const out = []

  if (pred.phase === 'period') {
    const day = pred.sinceLast + 1
    if (day === 1) out.push('今天是经期第 1 天，注意休息，别碰凉的')
    else out.push('经期第 ' + day + ' 天，给她倒杯温水吧')
    const left = pred.periodLength - pred.sinceLast
    if (left === 1) out.push('明天大概就结束啦')
    else if (left > 1) out.push('预计还有 ' + left + ' 天结束')
  }

  if (pred.phase === 'fertile') {
    out.push('接下来几天是易孕期，如果有计划要多注意')
  }

  if (pred.daysToNext >= 0 && pred.daysToNext <= 7) {
    if (pred.daysToNext === 0) out.push('预测今天来，提前准备好')
    else if (pred.daysToNext === 1) out.push('预测明天来，提前准备好')
    else out.push('大约还有 ' + pred.daysToNext + ' 天，可以提前准备')
  }

  // 学习状态提示
  if (pred.gapCount >= 3) {
    const cv = pred.learned.detail.cv
    if (cv > 0.08) {
      out.push('你的周期不太规律（波动约 ' + Math.round(cv * 100) + '%），预测仅供参考')
    }
  }
  if (pred.learned.trendApplied) {
    const s = pred.learned.trend.slope
    if (s > 0.2) out.push('最近周期有变长的趋势，已按新规律调整预测')
    else if (s < -0.2) out.push('最近周期有变短的趋势，已按新规律调整预测')
  }

  return out
}

module.exports = {
  parseDate, text, diffDays, addDays, cnText,
  weightedCycle, trendSlope, learnCycle, predictNext, reminders
}
