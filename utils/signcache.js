/**
 * 签名链接缓存。
 *
 * 问题：每次进入页面都要重新为每张图片生成签名 URL（网络往返），
 * 导致列表「先空白后出现」、头像「闪一下」。签名 URL 有效期 1 小时，
 * 在有效期内重复请求纯属浪费。
 *
 * 这里做三层：
 * 1. 内存缓存 —— 页面间切换直接命中，切回来零延迟（解决闪烁）
 * 2. 磁盘缓存 —— 小程序重启后仍在，跳过冷启动的首次签名
 * 3. 并发去重 —— 同一路径同时被多个页面请求时只发一次网络请求
 */

const STORAGE_KEY = 'signed_url_cache_v1'
const TTL = 45 * 60 * 1000        // 缓存 45 分钟，留出 1 小时有效期的余量
const MAX_ENTRIES = 400
const PREFIX = 'https://'

let mem = Object.create(null)      // path -> { url, at }
let inflight = Object.create(null) // path -> Promise
let loaded = false

function loadDisk() {
  if (loaded) return
  loaded = true
  try {
    const raw = wx.getStorageSync(STORAGE_KEY)
    if (raw && typeof raw === 'object') {
      const now = Date.now()
      for (const k in raw) {
        const it = raw[k]
        if (it && typeof it.url === 'string' && now - it.at < TTL) {
          mem[k] = it
        }
      }
    }
  } catch (e) {
    // 存储不可用时退化为纯内存缓存
  }
}

let flushTimer = null
function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    try {
      const keys = Object.keys(mem)
      const out = {}
      // 超量时优先保留最近写入的
      const sorted = keys
        .map((k) => [k, mem[k]])
        .sort((a, b) => b[1].at - a[1].at)
        .slice(0, MAX_ENTRIES)
      for (const [k, v] of sorted) out[k] = v
      wx.setStorageSync(STORAGE_KEY, out)
    } catch (e) {
      // 写入失败不影响使用
    }
  }, 1500)
}

/** 取缓存（命中且未过期） */
function get(path) {
  loadDisk()
  const hit = mem[path]
  if (!hit) return ''
  if (Date.now() - hit.at > TTL) {
    delete mem[path]
    return ''
  }
  return hit.url
}

function put(path, url) {
  loadDisk()
  mem[path] = { url: url, at: Date.now() }
  scheduleFlush()
}

/** 清空缓存（用户退出登录、切换账号时调用） */
function clear() {
  mem = Object.create(null)
  inflight = Object.create(null)
  loaded = false
  try {
    wx.removeStorageSync(STORAGE_KEY)
  } catch (e) {}
}

/**
 * 取签名 URL，命中缓存则立即返回；未命中则请求并写入缓存。
 * 同一路径的并发请求会被合并成一次网络请求。
 */
async function resolve(path) {
  const p = String(path || '')
  if (!p) return ''
  // 已经是完整 http 链接，无需签名
  if (p.indexOf(PREFIX) === 0) return p

  const cached = get(p)
  if (cached) return cached

  if (inflight[p]) return inflight[p]

  const task = (async () => {
    try {
      const { cloud } = require('./cloud.js')
      const res = await cloud.storage.createSignedUrl(p, 3600)
      if (!res || res.error) return ''
      const data = res.data
      const url = data && (data.signedUrl || data.url || (typeof data === 'string' ? data : '')) || ''
      if (url) put(p, url)
      return url
    } catch (e) {
      return ''
    } finally {
      delete inflight[p]
    }
  })()

  inflight[p] = task
  return task
}

/**
 * 并发批量解析（6 个一批），保持与输入等长、顺序一致。
 * 缓存命中的项不会产生网络请求。
 */
async function resolveList(paths) {
  const list = paths || []
  const out = new Array(list.length)
  const CONCURRENCY = 6
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const batch = list.slice(i, i + CONCURRENCY)
    const urls = await Promise.all(batch.map((p) => resolve(p)))
    for (let j = 0; j < batch.length; j += 1) out[i + j] = urls[j]
  }
  return out
}

/** 转为 { path: url } 映射 */
async function resolveMap(paths) {
  const list = paths || []
  const urls = await resolveList(list)
  const map = {}
  for (let i = 0; i < list.length; i += 1) {
    if (urls[i]) map[list[i]] = urls[i]
  }
  return map
}

module.exports = { resolve, resolveList, resolveMap, clear, get, put }
