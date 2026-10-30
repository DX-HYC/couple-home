/**
 * 媒体路径解析：云路径 -> 可展示的签名 URL。
 *
 * 两个关键点（都是踩过的坑）：
 * 1. SDK 的 bucket 层 createSignedUrl 返回 { data: { signedUrl }, error }，
 *    签名链接在 data.signedUrl 字段里。之前错取成 res.data.url || res.data，
 *    把整个对象塞给了 <image src>，图片必然加载失败渲染成白块。
 * 2. 路径必须在 shared/<uid>/ 目录（情侣共享）才能让对方也读到；
 *    users/<uid>/ 是私有目录（read: owner_and_admin），对方签名会被拒。
 *    本地临时路径（wxfile://、tmp://）无法签名，返回空让调用方跳过。
 */

function isLocalTempPath(path) {
  return /^(wxfile:|http:\/\/tmp|https:\/\/tmp|cloud:)/.test(String(path || ''))
}

function isHttpUrl(path) {
  return /^https?:\/\//.test(String(path || ''))
}

/**
 * 解析为可直接展示的 URL（带缓存，命中即返回，不发网络请求）。
 * @returns {Promise<string>} 失败或不可展示时返回 ''
 */
async function resolveSignedUrl(path) {
  const p = String(path || '')
  if (!p) return ''
  if (isHttpUrl(p)) return p
  if (isLocalTempPath(p)) return ''
  const signcache = require('./signcache.js')
  return signcache.resolve(p)
}

/**
 * 批量解析，失败的条目直接跳过。
 *
 * 签名走网络请求，逐个 await 会让 20 张照片串行等 20 次往返——
 * 这里并发发起（Promise.all），总耗时约等于最慢的那一个。
 * 并发上限分批，避免几十张图同时打过去被限流。
 */
async function resolveMany(paths) {
  const list = paths || []
  if (!list.length) return []
  const out = new Array(list.length)
  const CONCURRENCY = 6

  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const batch = list.slice(i, i + CONCURRENCY)
    const urls = await Promise.all(batch.map((p) => resolveSignedUrl(p)))
    for (let j = 0; j < batch.length; j += 1) {
      out[i + j] = urls[j]
    }
  }
  return out.filter(Boolean)
}

/**
 * 并发批量解析，返回 { [原路径]: url } 映射。
 * 单独实现而不复用 resolveMany——后者会过滤掉解析失败的项，导致索引错位。
 */
async function resolveMap(paths) {
  const list = paths || []
  if (!list.length) return {}
  const map = {}
  const CONCURRENCY = 6

  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const batch = list.slice(i, i + CONCURRENCY)
    const urls = await Promise.all(batch.map((p) => resolveSignedUrl(p)))
    for (let j = 0; j < batch.length; j += 1) {
      if (urls[j]) map[batch[j]] = urls[j]
    }
  }
  return map
}

/**
 * 渐进式解析：每解析完一批就回调一次，调用方可以边解析边渲染。
 *
 * 为什么要这个：
 * resolveMap 要等**所有**路径解析完才返回。20 张照片按 6 个一批就是 4 个批次，
 * 也就是 4 个网络往返的等待——这段时间列表里全是骨架，用户一张都看不到。
 * 渐进式让前 6 张签完就立刻上屏，剩下的陆续补齐。
 *
 * @param {string[]} paths
 * @param {Function} onBatch (map, batchPaths) => void，每批解析完调用一次
 * @param {object} [opts] { concurrency 每批数量，默认 6 }
 * @returns {Promise<object>} 全部解析完后的完整映射
 */
async function resolveMapProgressive(paths, onBatch, opts) {
  const list = paths || []
  const map = {}
  if (!list.length) {
    if (typeof onBatch === 'function') onBatch(map, [])
    return map
  }
  const concurrency = (opts && opts.concurrency) || 6

  for (let i = 0; i < list.length; i += concurrency) {
    const batch = list.slice(i, i + concurrency)
    const urls = await Promise.all(batch.map((p) => resolveSignedUrl(p)))
    for (let j = 0; j < batch.length; j += 1) {
      if (urls[j]) map[batch[j]] = urls[j]
    }
    if (typeof onBatch === 'function') onBatch(map, batch)
  }
  return map
}

module.exports = {
  resolveSignedUrl,
  resolveMany,
  resolveMap,
  resolveMapProgressive,
  isLocalTempPath,
  isHttpUrl
};
