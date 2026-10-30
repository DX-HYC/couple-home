/**
 * 云存储上传（小程序端）。
 *
 * 为什么不用 SDK 的 storage.upload：
 * SDK 的小程序适配层 createMiniProgramFetch 只支持字符串 body
 * （源码明确抛「暂不支持非字符串 body」），传 ArrayBuffer/FormData 都会失败。
 *
 * 正确通道是签名上传 URL：
 * 1. cloud.storage.createSignedUploadUrl(path) 拿到带 token 的 signedUrl
 * 2. 用微信原生 wx.request PUT 该 URL，data 传 ArrayBuffer —— wx.request 支持二进制 body
 * 3. token 在 URL query 里，无需 Authorization 头
 *
 * 路径规则（由 SDK 强制校验）：users/<uid>/... 私有；shared/<ownerUid>/... 情侣共享。
 */

function readBuffer(filePath) {
  const fs = wx.getFileSystemManager()
  const buffer = fs.readFileSync(filePath)
  // iOS 上部分场景返回的是 ArrayBuffer，部分是 base64 字符串，统一归一化
  if (typeof buffer === 'string') {
    throw new Error('文件读取异常，请重新选择图片')
  }
  if (!buffer || buffer.byteLength === 0) {
    throw new Error('文件内容为空，请重新选择图片')
  }
  return buffer
}

function extOf(filePath, fallback) {
  const m = String(filePath || '').split('?')[0].match(/\.([A-Za-z0-9]{1,5})$/)
  return m ? m[1].toLowerCase() : fallback
}

/** 按扩展名猜 content-type，猜不出用兜底值 */
function contentTypeOf(filePath, fallback) {
  const ext = extOf(filePath, '')
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    heic: 'image/heic',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    m4v: 'video/x-m4v'
  }
  return map[ext] || fallback
}

function requestPut(url, buffer, contentType, extraHeaders) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: url,
      method: 'PUT',
      data: buffer,
      header: Object.assign({ 'content-type': contentType }, extraHeaders || {}),
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res)
        else reject(new Error('上传失败（HTTP ' + res.statusCode + '），请重试'))
      },
      fail: (e) => reject(new Error(e.errMsg || '上传失败，请检查网络'))
    })
  })
}

/**
 * 上传本地文件到云存储。
 * @param {string} filePath 本地临时路径
 * @param {string} cloudPath 云端相对路径（users/... 或 shared/...）
 * @param {object} [opts] { contentType, upsert }
 * @returns {Promise<string>} cloudPath
 */
async function uploadToStorage(filePath, cloudPath, opts) {
  const { cloud } = require('./cloud.js')
  const options = opts || {}
  const contentType = options.contentType || contentTypeOf(filePath, 'application/octet-stream')

  const signed = await cloud.storage.createSignedUploadUrl(cloudPath, { upsert: options.upsert !== false })
  if (signed && signed.error) {
    throw new Error(signed.error.message || '上传初始化失败')
  }
  const info = signed && signed.data
  if (!info || !info.signedUrl) throw new Error('上传初始化失败，请重试')

  const buffer = readBuffer(filePath)
  logger.log('[upload] PUT', JSON.stringify({ cloudPath: cloudPath, bytes: buffer.byteLength, type: contentType }))
  await requestPut(info.signedUrl, buffer, contentType, { 'x-upsert': options.upsert !== false ? 'true' : 'false' })
  logger.log('[upload] 成功', JSON.stringify({ cloudPath: cloudPath }))
  return cloudPath
}

/** 生成一个不易碰撞的文件名 */
function makeFileName(ext) {
  const rand = Math.floor(Math.random() * 1000000)
  return Date.now() + '_' + rand + '.' + (ext || 'bin')
}

/** 媒体上传到个人私有目录（仅自己可见，如暂存文件） */
async function uploadUserImage(uid, filePath, folder) {
  const { cloud } = require('./cloud.js')
  const ext = extOf(filePath, 'jpg')
  const name = makeFileName(ext)
  const path = cloud.storage.userPath(uid, (folder || 'images') + '/' + name)
  return uploadToStorage(filePath, path, { contentType: contentTypeOf(filePath, 'image/jpeg') })
}

/**
 * 媒体上传到情侣共享目录——双方都要能读的内容必须放这里。
 * users/<uid>/ 是私有目录（read: owner_and_admin），对方签名会被拒；
 * 日记图片、头像、相册都在 shared/ 下。
 */
async function uploadSharedImage(uid, filePath, folder) {
  const { cloud } = require('./cloud.js')
  const ext = extOf(filePath, 'jpg')
  const name = makeFileName(ext)
  const path = cloud.storage.sharedPath(uid, (folder || 'images') + '/' + name)
  return uploadToStorage(filePath, path, { contentType: contentTypeOf(filePath, 'image/jpeg') })
}

/** 媒体上传到情侣共享目录（相册照片视频） */
async function uploadSharedMedia(uid, filePath, mediaType) {
  const { cloud } = require('./cloud.js')
  const ext = extOf(filePath, mediaType === 'video' ? 'mp4' : 'jpg')
  const name = makeFileName(ext)
  const path = cloud.storage.sharedPath(uid, 'album/' + name)
  const fallback = mediaType === 'video' ? 'video/mp4' : 'image/jpeg'
  return uploadToStorage(filePath, path, { contentType: contentTypeOf(filePath, fallback) })
}

module.exports = { uploadToStorage, uploadUserImage, uploadSharedImage, uploadSharedMedia, makeFileName, contentTypeOf }
