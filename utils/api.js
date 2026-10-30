const { cloud } = require('./cloud.js')

/**
 * 数据访问层。
 * 每张情侣表的查询都强制带 couple_id 条件——该列由数据库 RLS 二次校验
 * （couple_id 必须属于当前用户所在的 couples 行），双保险保证情侣之间互不可见。
 */

/** 把底层技术错误翻译成用户能看懂的话 */
function friendlyMessage(error) {
  const code = error && error.code
  const raw = (error && error.message) || ''

  if (code === '42P01') return '数据表尚未初始化，请稍后重试'
  if (code === '42501') return '没有权限访问该数据'
  if (code === '23505') return '记录已存在'
  // 42703：列不存在。多见于刚 ALTER 加列后 PostgREST schema 缓存未刷新
  if (code === '42703' || /column .* does not exist/i.test(raw)) {
    return '数据正在更新中，请稍后重试'
  }
  // PostgREST：单行查询却返回 0 行或多行
  if (code === 'PGRST116' || /multiple \(or no\) rows returned|JSON object requested/i.test(raw)) {
    return '数据读取异常，请下拉重试'
  }
  if (/violates unique constraint/i.test(raw)) return '记录已存在'
  if (/network|failed to fetch/i.test(raw)) return '网络连接失败，请检查网络后重试'
  if (/timeout|ETIMEDOUT/i.test(raw)) return '请求超时，请稍后重试'
  if (/schema cache/i.test(raw)) return '数据正在更新中，请稍后重试'

  // 兜底时不要把整段英文抛给用户
  return '操作失败，请稍后重试'
}

function unwrap(result, fallbackMessage) {
  if (result && result.error) {
    // 记录原始错误再翻译：否则用户只看到「操作失败」，排查时无从下手
    console.error('[api] 原始错误', JSON.stringify({
      fallback: fallbackMessage || '',
      code: result.error.code || '',
      message: result.error.message || '',
      details: result.error.details || ''
    }))
    throw new Error(friendlyMessage(result.error) || fallbackMessage || '操作失败')
  }
  return result ? result.data : null
}

/**
 * 列表查询的条数上限。
 *
 * 情侣场景下真实数据量很小（几十~几百条），但一旦数据被灌坏或长期积累，
 * 不设上限就会一次拉全表，响应时间会被拖垮。
 * 这些值都远大于正常用量，只为兜住异常情况。
 */
const LIST_LIMIT = {
  anniversary: 100,
  diary: 100,
  albumItem: 500,
  order: 200,
  customRecipe: 100,
  reminder: 200,
  schedule: 200,
  preference: 300,
  cycle: 100,
  wish: 200
}

/* ---------------- 用户与登录 ---------------- */

async function getSession() {
  const res = await cloud.auth.getSession()
  return res && res.data ? res.data : null
}

async function wechatLogin() {
  const code = await new Promise((resolve, reject) => {
    wx.login({
      success: (r) => (r.code ? resolve(r.code) : reject(new Error('微信登录失败，请重试'))),
      fail: (e) => {
        console.error('[WorkBuddy Cloud] login failed', JSON.stringify({ stage: 'wx.login', message: e.errMsg }))
        reject(new Error(e.errMsg || '微信登录失败，请重试'))
      }
    })
  })
  const appid = wx.getAccountInfoSync().miniProgram.appId
  const res = await cloud.auth.signInWithWechat(code, appid)
  if (res && res.error) {
    // 登录错误保留原始信息便于排查，仅对已知的技术错误做翻译
    console.error('[couple] login error', JSON.stringify({ code: res.error.code, message: res.error.message }))
    throw new Error(friendlyMessage(res.error))
  }
  return res.data
}

/**
 * 确保 profile 存在并返回本人档案。
 * 微信登录不返回昵称，因此这里不猜测昵称，首次创建时留空，
 * 由用户在「我的」页用 nickname 输入框主动填写，避免双方都显示成同一个名字。
 */
async function ensureProfile() {
  const session = await getSession()
  if (!session) throw new Error('请先登录')
  const userId = session.user.id

  const existing = await cloud.database
    .from('profiles')
    .select('*')
    .eq('owner_id', userId)
    .maybeSingle()
  const found = unwrap(existing, '读取用户信息失败')
  if (found) return found

  const created = await cloud.database
    .from('profiles')
    .insert({ owner_name: null, avatar_url: null })
    .select()
  const rows = unwrap(created, '创建用户信息失败')
  return rows && rows[0] ? rows[0] : null
}

async function updateProfile(patch) {
  const session = await getSession()
  if (!session) throw new Error('请先登录')
  const payload = { updated_at: new Date().toISOString() }
  if (typeof patch.owner_name === 'string') payload.owner_name = patch.owner_name
  if (typeof patch.avatar_url === 'string') payload.avatar_url = patch.avatar_url
  const res = await cloud.database
    .from('profiles')
    .update(payload)
    .eq('owner_id', session.user.id)
    .select()
  const rows = unwrap(res, '更新用户信息失败')
  return rows && rows[0] ? rows[0] : null
}

/* ---------------- 情侣关系 ---------------- */

function randomCode(len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < len; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)]
  }
  return out
}

/** 查询自己当前的情侣关系（可能为空） */
async function getCouple() {
  const session = await getSession()
  if (!session) throw new Error('请先登录')
  // 分别按发起方和接受方查询再合并：user_a/user_b 可为 NULL，
  // 依赖单条 .or() 在 NULL 列上的行为不够确定。
  // 两次查询互不依赖，并行发起可以省掉一个网络往返。
  const [asA, asB] = await Promise.all([
    cloud.database.from('couples').select('*').eq('user_a', session.user.id).order('id', { ascending: false }),
    cloud.database.from('couples').select('*').eq('user_b', session.user.id).order('id', { ascending: false })
  ])

  const rowsA = unwrap(asA, '查询情侣关系失败') || []
  const rowsB = unwrap(asB, '查询情侣关系失败') || []
  const all = rowsA.concat(rowsB)
  if (!all.length) return null
  // 已绑定的关系优先，其次取最新一条待绑定记录
  all.sort((x, y) => (!!y.user_b) - (!!x.user_b) || y.id - x.id)
  return all[0]
}

/** 生成邀请码，等待对方绑定 */
/** 把 date + time 组装成 ISO 字符串；只有 date 时按本地 00:00 处理 */
function buildRelationAt(dateText, timeText) {
  const date = String(dateText || '').trim()
  if (!date) return null
  const time = String(timeText || '00:00').trim()
  const iso = `${date}T${time.length === 5 ? time : '00:00'}:00`
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

async function createInvite(relationDate, relationTime) {
  const session = await getSession()
  if (!session) throw new Error('请先登录')

  const existing = await getCouple()
  if (existing && existing.user_b) throw new Error('你已经绑定情侣啦')

  const relationAt = buildRelationAt(relationDate, relationTime)

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode(6)
    const check = await cloud.database.from('couples').select('id').eq('invite_code', code).maybeSingle()
    if (check && check.data) continue

    if (existing) {
      const res = await cloud.database
        .from('couples')
        .update({
          invite_code: code,
          relation_date: relationDate || null,
          relation_at: relationAt
        })
        .eq('id', existing.id)
        .eq('user_a', session.user.id)
        .select()
      const rows = unwrap(res, '生成邀请码失败')
      if (!rows || rows.length === 0) throw new Error('邀请码生成失败，请退出重进后再试')
      return rows[0]
    }
    const created = await cloud.database
      .from('couples')
      .insert({
        invite_code: code,
        relation_date: relationDate || null,
        relation_at: relationAt
      })
      .select()
    const rows = unwrap(created, '生成邀请码失败')
    if (!rows || rows.length === 0) throw new Error('邀请码生成失败，请退出重进后再试')
    return rows[0]
  }
  throw new Error('邀请码生成失败，请重试')
}

/**
 * 校验邀请码是否可用（用于输入框实时反馈）。
 * 绑定完成前对方读不到 couples 行，RLS 会过滤掉，所以必须走
 * SECURITY DEFINER 函数在库内查找。
 */
async function checkInvite(code) {
  const session = await getSession()
  if (!session) throw new Error('请先登录')
  const res = await cloud.database.rpc('find_couple_by_invite', { p_code: code })
  const rows = unwrap(res, '邀请码查询失败') || []
  if (!rows.length) return { exists: false, usable: false, reason: '邀请码不存在，请检查后重试' }
  const row = rows[0]
  if (row.inviter_id === session.user.id) {
    return { exists: true, usable: false, reason: '不能使用自己的邀请码' }
  }
  if (row.taken) {
    return { exists: true, usable: false, reason: '该邀请码已被使用' }
  }
  return { exists: true, usable: true }
}

/** 输入邀请码绑定对方 */
async function acceptInvite(code) {
  const session = await getSession()
  if (!session) throw new Error('请先登录')

  const mine = await getCouple()
  if (mine && mine.user_b) throw new Error('你已经绑定情侣啦')

  // 绑定动作同样要绕过 RLS：绑定期我尚未成为任何一方的成员，
  // 直接 update couples 会被 couples_update_member 策略拦下。
  const res = await cloud.database.rpc('accept_invite', { p_code: code })
  if (res && res.error) {
    const raw = (res.error.message || '')
    // 函数里 RAISE 的是中文业务提示，原样透出；其余技术错误才翻译
    if (/[\u4e00-\u9fa5]/.test(raw)) throw new Error(raw)
    throw new Error(friendlyMessage(res.error))
  }
  const rows = res.data || []
  if (!rows.length) throw new Error('绑定失败，邀请码可能已被使用')

  // RPC 返回行里带不回完整记录，重新读一次（此时已成为成员，RLS 放行）
  const after = await cloud.database
    .from('couples')
    .select('*')
    .eq('id', rows[0].pair_id)
    .maybeSingle()
  const record = unwrap(after, '读取情侣关系失败')
  if (!record) throw new Error('绑定失败，请重试')
  return record
}

/** 解除情侣关系（由发起人执行） */
async function unbind() {
  const session = await getSession()
  if (!session) throw new Error('请先登录')
  const couple = await getCouple()
  if (!couple) throw new Error('尚未绑定情侣')
  if (couple.user_a !== session.user.id) throw new Error('只有发起邀请的一方可以解除绑定')
  await cloud.database.from('couples').delete().eq('id', couple.id)
  // profiles 的更新策略只允许改自己的行，因此这里只能清自己那份；
  // 对方下次进入时会自行校验情侣关系并清掉残留的 couple_id
  await cloud.database.from('profiles').update({ couple_id: null, couple_role: null }).eq('owner_id', session.user.id)
  return true
}

/**
 * 修改「在一起」的时间，精确到分钟。
 * 绑定完成后双方都可修改，所以只要是该关系的成员即可，不限发起方。
 */
async function updateRelationTime(dateText, timeText) {
  const session = await getSession()
  if (!session) throw new Error('请先登录')
  const couple = await getCouple()
  if (!couple || !couple.user_b) throw new Error('尚未绑定情侣')

  const date = String(dateText || '').trim()
  if (!date) {
    // 允许清空起始时间
    const cleared = await cloud.database
      .from('couples')
      .update({ relation_date: null, relation_at: null })
      .eq('id', couple.id)
      .select()
    const clearedRows = unwrap(cleared, '修改失败')
    return clearedRows && clearedRows[0]
  }
  const relationAt = buildRelationAt(date, timeText)
  if (!relationAt) throw new Error('时间格式不正确，请重新选择')

  const res = await cloud.database
    .from('couples')
    .update({ relation_date: date, relation_at: relationAt })
    .eq('id', couple.id)
    .select()
  const rows = unwrap(res, '修改在一起时间失败')
  if (!rows || rows.length === 0) throw new Error('修改失败，请重试')
  return rows[0]
}

/**
 * 校验并修正自己的情侣关系。
 * 关系被发起方解除后，这边的 profile 上会残留 couple_id，需要自行清理
 * （profiles 的更新策略只允许改自己的行）。
 *
 * @param {object} profile  本人档案
 * @param {object} [knownCouple] 已经查好的情侣关系。传入可省掉一次查询；
 *        传 null 表示「确定没有情侣关系」，不要再查。
 */
async function reconcileProfile(profile, knownCouple) {
  const session = await getSession()
  if (!session || !profile) return profile
  const couple = knownCouple !== undefined ? knownCouple : await getCouple()
  const stale = profile.couple_id && (!couple || couple.id !== profile.couple_id || !couple.user_b)
  if (!stale) return profile
  const res = await cloud.database
    .from('profiles')
    .update({ couple_id: null, couple_role: null, updated_at: new Date().toISOString() })
    .eq('owner_id', session.user.id)
    .select()
  const rows = unwrap(res, '同步用户信息失败')
  return rows && rows[0] ? rows[0] : profile
}

/**
 * 同步自己的档案情侣信息。
 * profiles 的更新策略只允许改自己的行（owner_id = auth.uid()），
 * 所以双方各自写自己的那份——对方下次进入时会自行补上。
 */
async function syncProfiles(couple) {
  const session = await getSession()
  if (!session) return null
  const myRole = couple.user_a === session.user.id ? 'a' : 'b'
  const res = await cloud.database
    .from('profiles')
    .update({ couple_id: couple.id, couple_role: myRole, updated_at: new Date().toISOString() })
    .eq('owner_id', session.user.id)
    .select()
  const rows = unwrap(res, '同步用户信息失败')
  return rows && rows[0] ? rows[0] : null
}

/**
 * 按成员 id 读双方档案。
 * ids 已经知道时直接查，不必再回查 couples 表。
 */
async function listPartnersByIds(ids) {
  const valid = (ids || []).filter(Boolean)
  if (!valid.length) return []
  const res = await cloud.database.from('profiles').select('*').in('owner_id', valid)
  return unwrap(res, '读取伴侣信息失败') || []
}

async function listPartners(coupleId) {
  // 按 couples 表里的成员 id 查，不依赖 profiles.couple_id 是否已写入，
  // 避免绑定瞬间读不到对方资料的时序空档
  const couple = await cloud.database.from('couples').select('user_a, user_b').eq('id', coupleId).maybeSingle()
  const row = unwrap(couple, '读取伴侣信息失败')
  if (!row) return []
  return listPartnersByIds([row.user_a, row.user_b])
}

/* ---------------- 纪念日 ---------------- */

async function listAnniversaries(coupleId) {
  const res = await cloud.database
    .from('anniversaries')
    .select('*')
    .eq('couple_id', coupleId)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true })
    .limit(LIST_LIMIT.anniversary)
  return unwrap(res, '读取纪念日失败') || []
}

async function createAnniversary(coupleId, data) {
  const session = await getSession()
  const res = await cloud.database
    .from('anniversaries')
    .insert({
      couple_id: coupleId,
      owner_name: data.owner_name || null,
      title: data.title,
      calendar_type: data.calendar_type,
      month: data.month,
      day: data.day,
      start_year: data.start_year || null,
      emoji: data.emoji || '❤️',
      repeat_yearly: data.repeat_yearly !== false,
      remind_days: data.remind_days == null ? 7 : data.remind_days,
      sort_order: data.sort_order || 0
    })
    .select()
  const rows = unwrap(res, '创建纪念日失败')
  return rows && rows[0]
}

async function updateAnniversary(coupleId, id, patch) {
  const payload = {}
  if (patch.title != null) payload.title = patch.title
  if (patch.calendar_type != null) payload.calendar_type = patch.calendar_type
  if (patch.month != null) payload.month = patch.month
  if (patch.day != null) payload.day = patch.day
  if (patch.start_year !== undefined) payload.start_year = patch.start_year
  if (patch.emoji != null) payload.emoji = patch.emoji
  if (patch.repeat_yearly !== undefined) payload.repeat_yearly = patch.repeat_yearly
  if (patch.remind_days !== undefined) payload.remind_days = patch.remind_days
  const res = await cloud.database.from('anniversaries').update(payload).eq('couple_id', coupleId).eq('id', id).select()
  const rows = unwrap(res, '更新纪念日失败')
  return rows && rows[0]
}

async function deleteAnniversary(coupleId, id) {
  const res = await cloud.database.from('anniversaries').delete().eq('couple_id', coupleId).eq('id', id).select()
  return unwrap(res, '删除纪念日失败')
}

/* ---------------- 情侣日记 ---------------- */

async function listDiaries(coupleId, limit) {
  let query = cloud.database.from('diaries').select('*').eq('couple_id', coupleId).order('created_at', { ascending: false })
  query = query.limit(limit || LIST_LIMIT.diary)
  const res = await query
  return unwrap(res, '读取日记失败') || []
}

async function createDiary(coupleId, data) {
  const session = await getSession()
  const res = await cloud.database
    .from('diaries')
    .insert({
      couple_id: coupleId,
      // 微信登录不返回昵称（session.user.name 恒为空），显示名以 profile 为准
      owner_name: data.owner_name || null,
      avatar_url: data.avatar_url || null,
      content: data.content,
      images: data.images || null,
      mood: data.mood || null,
      weather: data.weather || null,
      location_name: data.location_name || null,
      latitude: data.latitude == null ? null : data.latitude,
      longitude: data.longitude == null ? null : data.longitude
    })
    .select()
  const rows = unwrap(res, '发表日记失败')
  return rows && rows[0]
}

async function deleteDiary(coupleId, id) {
  const res = await cloud.database.from('diaries').delete().eq('couple_id', coupleId).eq('id', id).select()
  return unwrap(res, '删除日记失败')
}

/* ---------------- 情侣相册 ---------------- */

async function listAlbums(coupleId) {
  const res = await cloud.database
    .from('albums')
    .select('*')
    .eq('couple_id', coupleId)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true })
  return unwrap(res, '读取相册分类失败') || []
}

async function createAlbum(coupleId, name, emoji) {
  const res = await cloud.database
    .from('albums')
    .insert({ couple_id: coupleId, name: name, emoji: emoji || '📁', sort_order: 0 })
    .select()
  const rows = unwrap(res, '创建相册分类失败')
  return rows && rows[0]
}

async function deleteAlbum(coupleId, id) {
  const items = await cloud.database.from('album_items').select('id, file_path').eq('couple_id', coupleId).eq('album_id', id)
  const rows = unwrap(items, '读取相册内容失败') || []
  await cloud.database.from('album_items').delete().eq('couple_id', coupleId).eq('album_id', id)
  const res = await cloud.database.from('albums').delete().eq('couple_id', coupleId).eq('id', id).select()
  unwrap(res, '删除相册失败')
  return rows
}

async function listAlbumItems(coupleId, albumId) {
  const res = await cloud.database
    .from('album_items')
    .select('*')
    .eq('couple_id', coupleId)
    .eq('album_id', albumId)
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT.albumItem)
  return unwrap(res, '读取相册内容失败') || []
}

/**
 * 一次取出全部相册内容（跨相册）。
 * 相册页要用它算每个分类的条数——逐个相册查询是 N 次串行请求，
 * 改成一次查询后在内存里按 album_id 分组，N 次降为 1 次。
 */
async function listAllAlbumItems(coupleId) {
  const res = await cloud.database
    .from('album_items')
    .select('*')
    .eq('couple_id', coupleId)
    .order('created_at', { ascending: false })
  return unwrap(res, '读取相册内容失败') || []
}

async function createAlbumItem(coupleId, albumId, data) {
  const session = await getSession()
  const res = await cloud.database
    .from('album_items')
    .insert({
      couple_id: coupleId,
      album_id: albumId,
      owner_name: data.owner_name || null,
      media_type: data.media_type || 'image',
      file_path: data.file_path,
      thumb_path: data.thumb_path || null,
      file_size: data.file_size || null,
      duration: data.duration || null,
      width: data.width || null,
      height: data.height || null,
      remark: data.remark || null
    })
    .select()
  const rows = unwrap(res, '上传失败')
  return rows && rows[0]
}

/**
 * 批量写入相册条目。
 *
 * 一次选 9 张图时，逐条 insert 是 9 次网络往返；批量 insert 只需 1 次，
 * 上传 9 张图的总耗时能省下 8 个往返。
 */
async function createAlbumItems(coupleId, albumId, items) {
  const list = (items || []).filter((x) => x && x.file_path)
  if (!list.length) return []
  const payload = list.map((data) => ({
    couple_id: coupleId,
    album_id: albumId,
    owner_name: data.owner_name || null,
    media_type: data.media_type || 'image',
    file_path: data.file_path,
    thumb_path: data.thumb_path || null,
    file_size: data.file_size || null,
    duration: data.duration || null,
    width: data.width || null,
    height: data.height || null,
    remark: data.remark || null
  }))
  const res = await cloud.database.from('album_items').insert(payload).select()
  const rows = unwrap(res, '上传失败')
  return rows || []
}

async function deleteAlbumItem(coupleId, id) {
  const res = await cloud.database.from('album_items').delete().eq('couple_id', coupleId).eq('id', id).select()
  return unwrap(res, '删除失败')
}

/* ---------------- 实时定位 ---------------- */

async function upsertLocation(coupleId, data) {
  const session = await getSession()

  // 不能用 maybeSingle：历史脏数据可能让同一用户存在多行，
  // 那样会直接抛 "multiple (or no) rows returned"。这里排序取最新一条。
  const existing = await cloud.database
    .from('locations')
    .select('*')
    .eq('couple_id', coupleId)
    .eq('owner_id', session.user.id)
    .order('updated_at', { ascending: false })
    .limit(1)
  const rows = unwrap(existing, '定位读取失败') || []
  const found = rows[0] || null

  const payload = {
    latitude: data.latitude,
    longitude: data.longitude,
    address: data.address || null,
    city: data.city || null,
    precision_m: data.precision || null,
    // 手动标注的地点优先级高于自动反查，持久化以免重进页面后被覆盖
    address_manual: !!data.addressManual,
    updated_at: new Date().toISOString()
  }

  if (found) {
    const res = await cloud.database
      .from('locations')
      .update(payload)
      .eq('id', found.id)
      .select()
    const updated = unwrap(res, '定位更新失败') || []
    // 顺带清掉可能残留的重复行，避免越积越多
    try {
      await cloud.database
        .from('locations')
        .delete()
        .eq('couple_id', coupleId)
        .eq('owner_id', session.user.id)
        .neq('id', found.id)
    } catch (e) {
      // 清理失败不影响主流程
    }
    return updated[0] || Object.assign({}, found, payload)
  }

  const created = await cloud.database
    .from('locations')
    .insert({
      couple_id: coupleId,
      owner_name: data.owner_name || null,
      latitude: data.latitude,
      longitude: data.longitude,
      address: data.address || null,
      city: data.city || null,
      precision_m: data.precision || null,
      address_manual: !!data.addressManual
    })
    .select()
  const inserted = unwrap(created, '定位上传失败')
  return (inserted && inserted[0]) || null
}

async function listLocations(coupleId) {
  const res = await cloud.database
    .from('locations')
    .select('*')
    .eq('couple_id', coupleId)
    .order('updated_at', { ascending: false })
  const rows = unwrap(res, '读取定位失败') || []
  // 按用户去重，只保留最新的那条，避免同一个人出现多次
  const latest = new Map()
  for (const row of rows) {
    if (!latest.has(row.owner_id)) latest.set(row.owner_id, row)
  }
  return Array.from(latest.values())
}

/* ---------------- 菜谱与点菜 ---------------- */

// 注意：内置菜谱已改为本地 utils/recipes.js（游客可见、无需联网），
// 原云端 recipes 表不再读取，故此处不再提供 listRecipes。

async function listOrders(coupleId) {
  const res = await cloud.database
    .from('recipe_orders')
    .select('*')
    .eq('couple_id', coupleId)
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT.order)
  return unwrap(res, '读取菜单失败') || []
}

async function createOrder(coupleId, data) {
  const session = await getSession()
  const res = await cloud.database
    .from('recipe_orders')
    .insert({
      couple_id: coupleId,
      recipe_id: data.recipe_id || null,
      owner_name: data.owner_name || null,
      dish_name: data.dish_name,
      note: data.note || null,
      servings: data.servings || 2,
      status: 'pending'
    })
    .select()
  const rows = unwrap(res, '点菜失败')
  return rows && rows[0]
}

async function updateOrderStatus(coupleId, id, status) {
  const payload = { status: status }
  if (status === 'done') {
    payload.done_at = new Date().toISOString()
    const session = await getSession()
    if (session) payload.cooker_id = session.user.id
  }
  const res = await cloud.database.from('recipe_orders').update(payload).eq('couple_id', coupleId).eq('id', id).select()
  const rows = unwrap(res, '更新失败')
  return rows && rows[0]
}

async function deleteOrder(coupleId, id) {
  const res = await cloud.database.from('recipe_orders').delete().eq('couple_id', coupleId).eq('id', id).select()
  return unwrap(res, '删除失败')
}

/* 双方自行添加的菜谱，按情侣共享 */
async function listCustomRecipes(coupleId) {
  const res = await cloud.database
    .from('recipes_custom')
    .select('*')
    .eq('couple_id', coupleId)
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT.customRecipe)
  return unwrap(res, '读取菜谱失败') || []
}

async function createCustomRecipe(coupleId, data) {
  const session = await getSession()
  const res = await cloud.database
    .from('recipes_custom')
    .insert({
      couple_id: coupleId,
      owner_name: (session && session.profile && session.profile.owner_name) || data.owner_name || null,
      name: data.name,
      emoji: data.emoji || '🍲',
      category: data.category || '家常菜',
      taste: data.taste || '咸鲜',
      duration: Number(data.duration) || 15,
      servings: Number(data.servings) || 2,
      ingredients: JSON.stringify(data.ingredients || []),
      steps: JSON.stringify(data.steps || []),
      tips: data.tips || null
    })
    .select()
  const rows = unwrap(res, '添加菜谱失败')
  return rows && rows[0]
}

async function deleteCustomRecipe(coupleId, id) {
  const res = await cloud.database.from('recipes_custom').delete().eq('couple_id', coupleId).eq('id', id).select()
  return unwrap(res, '删除菜谱失败')
}

/* ---------------- 提醒 ---------------- */

async function listReminders(coupleId, limit) {
  let query = cloud.database.from('reminders').select('*').eq('couple_id', coupleId).order('created_at', { ascending: false })
  query = query.limit(limit || LIST_LIMIT.reminder)
  const res = await query
  return unwrap(res, '读取提醒失败') || []
}

async function createReminder(coupleId, data) {
  const res = await cloud.database
    .from('reminders')
    .insert({
      couple_id: coupleId,
      kind: data.kind,
      title: data.title,
      body: data.body || null,
      link: data.link || null,
      remind_at: data.remind_at || null,
      is_read: false
    })
    .select()
  const rows = unwrap(res, '创建提醒失败')
  return rows && rows[0]
}

async function markRemindersRead(coupleId, kind) {
  let query = cloud.database.from('reminders').update({ is_read: true }).eq('couple_id', coupleId).eq('is_read', false)
  // 传 kind 时只标记该类型的提醒。
  // 不传则标记全部（首页「看过即已读」的老行为）。
  if (kind) query = query.eq('kind', kind)
  const res = await query.select()
  return unwrap(res, '更新提醒失败')
}

/* ---------------- 订阅消息 ---------------- */

async function saveSubscription(coupleId, templateId, subscribed) {
  const session = await getSession()
  if (!session) return null
  // 不能用 maybeSingle：同一用户同一模板若有多行会直接抛错，排序取最新一条
  const existing = await cloud.database
    .from('subscriptions')
    .select('*')
    .eq('owner_id', session.user.id)
    .eq('template_id', templateId)
    .order('updated_at', { ascending: false })
    .limit(1)
  const existingRows = unwrap(existing, '读取订阅状态失败') || []
  const found = existingRows[0] || null

  if (found) {
    const res = await cloud.database
      .from('subscriptions')
      .update({ subscribed: subscribed, couple_id: coupleId, updated_at: new Date().toISOString() })
      .eq('id', found.id)
      .select()
    const updated = unwrap(res, '更新订阅失败')
    return (updated && updated[0]) || null
  }
  const created = await cloud.database
    .from('subscriptions')
    .insert({ couple_id: coupleId, template_id: templateId, subscribed: subscribed })
    .select()
  const inserted = unwrap(created, '保存订阅失败')
  return (inserted && inserted[0]) || null
}

async function listSubscriptions() {
  const session = await getSession()
  if (!session) return []
  const res = await cloud.database.from('subscriptions').select('*').eq('owner_id', session.user.id)
  return unwrap(res, '读取订阅状态失败') || []
}

/* ---------------- 日程 ---------------- */

async function listSchedules(coupleId) {
  const res = await cloud.database
    .from('schedules')
    .select('*')
    .eq('couple_id', coupleId)
    .order('event_date', { ascending: true })
    .order('event_time', { ascending: true })
    .limit(LIST_LIMIT.schedule)
  return unwrap(res, '读取日程失败') || []
}

async function createSchedule(coupleId, data) {
  const session = await getSession()
  const res = await cloud.database
    .from('schedules')
    .insert({
      couple_id: coupleId,
      owner_name: data.owner_name || null,
      title: data.title,
      category: data.category || '日常',
      note: data.note || null,
      event_date: data.event_date,
      event_time: data.event_time || '09:00',
      repeat_rule: data.repeat_rule || 'once',
      priority: data.priority || 'normal',
      remind_before: data.remind_before == null ? 30 : data.remind_before
    })
    .select()
  const rows = unwrap(res, '创建日程失败')
  return rows && rows[0]
}

async function updateSchedule(coupleId, id, patch) {
  const payload = {}
  if (patch.title != null) payload.title = patch.title
  if (patch.category != null) payload.category = patch.category
  if (patch.note !== undefined) payload.note = patch.note
  if (patch.event_date != null) payload.event_date = patch.event_date
  if (patch.event_time != null) payload.event_time = patch.event_time
  if (patch.repeat_rule != null) payload.repeat_rule = patch.repeat_rule
  if (patch.priority != null) payload.priority = patch.priority
  if (patch.remind_before !== undefined) payload.remind_before = patch.remind_before
  if (patch.is_done !== undefined) {
    payload.is_done = !!patch.is_done
    payload.done_at = patch.is_done ? new Date().toISOString() : null
  }
  const res = await cloud.database.from('schedules').update(payload).eq('couple_id', coupleId).eq('id', id).select()
  const rows = unwrap(res, '更新日程失败')
  return rows && rows[0]
}

async function deleteSchedule(coupleId, id) {
  const res = await cloud.database.from('schedules').delete().eq('couple_id', coupleId).eq('id', id).select()
  return unwrap(res, '删除日程失败')
}

/* ---------------- 对方喜好 ---------------- */

async function listPreferences(coupleId) {
  const res = await cloud.database
    .from('preferences')
    .select('*')
    .eq('couple_id', coupleId)
    .order('category', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT.preference)
  return unwrap(res, '读取喜好失败') || []
}

/**
 * 只取「爱吃」类的喜好。
 * 菜谱页的「我喜欢吃」标记用它——原来拉全表（最多 300 条）再在 JS 里筛，
 * 传输量白白多几倍，服务端直接过滤掉更划算。
 */
async function listLikedPreferences(coupleId) {
  const res = await cloud.database
    .from('preferences')
    .select('*')
    .eq('couple_id', coupleId)
    .eq('category', '爱吃')
    .limit(LIST_LIMIT.preference)
  return unwrap(res, '读取喜好失败') || []
}

async function createPreference(coupleId, data) {
  const res = await cloud.database
    .from('preferences')
    .insert({
      couple_id: coupleId,
      owner_name: data.owner_name || null,
      category: data.category || '爱吃',
      title: data.title,
      detail: data.detail || null,
      is_favorite: data.is_favorite !== false
    })
    .select()
  const rows = unwrap(res, '添加喜好失败')
  return rows && rows[0]
}

async function updatePreference(coupleId, id, patch) {
  const payload = {}
  if (patch.category != null) payload.category = patch.category
  if (patch.title != null) payload.title = patch.title
  if (patch.detail !== undefined) payload.detail = patch.detail
  if (patch.is_favorite !== undefined) payload.is_favorite = !!patch.is_favorite
  const res = await cloud.database.from('preferences').update(payload).eq('couple_id', coupleId).eq('id', id).select()
  const rows = unwrap(res, '更新喜好失败')
  return rows && rows[0]
}

async function deletePreference(coupleId, id) {
  const res = await cloud.database.from('preferences').delete().eq('couple_id', coupleId).eq('id', id).select()
  return unwrap(res, '删除喜好失败')
}

/* ---------------- 愿望清单 ---------------- */

/**
 * 愿望清单：双方各写各的愿望，共享给对方。
 * status 只有 open（待实现）和 done（已实现）两种。
 */
async function listWishes(coupleId) {
  const res = await cloud.database
    .from('wishes')
    .select('*')
    .eq('couple_id', coupleId)
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT.wish)
  return unwrap(res, '读取愿望清单失败') || []
}

async function createWish(coupleId, data) {
  const session = await getSession()
  const res = await cloud.database
    .from('wishes')
    .insert({
      couple_id: coupleId,
      // owner_id 用来判定「是不是我写的」——只有作者能删自己的愿望
      owner_id: (session && session.user && session.user.id) || null,
      owner_name: data.owner_name || null,
      title: data.title,
      category: data.category || '想去',
      detail: data.detail || null,
      target_date: data.target_date || null,
      status: 'open',
      notified: false
    })
    .select()
  const rows = unwrap(res, '写下愿望失败')
  return rows && rows[0]
}

async function updateWish(coupleId, id, patch) {
  const payload = {}
  if (patch.title != null) payload.title = patch.title
  if (patch.category != null) payload.category = patch.category
  if (patch.detail !== undefined) payload.detail = patch.detail
  if (patch.target_date !== undefined) payload.target_date = patch.target_date
  if (patch.status !== undefined) {
    payload.status = patch.status
    // 标记实现时顺手记下完成时间；取消实现则清掉
    payload.done_at = patch.status === 'done' ? new Date().toISOString() : null
  }
  if (patch.notified !== undefined) payload.notified = !!patch.notified
  const res = await cloud.database.from('wishes').update(payload).eq('couple_id', coupleId).eq('id', id).select()
  const rows = unwrap(res, '更新愿望失败')
  return rows && rows[0]
}

async function deleteWish(coupleId, id) {
  const res = await cloud.database.from('wishes').delete().eq('couple_id', coupleId).eq('id', id).select()
  return unwrap(res, '删除愿望失败')
}

/* ---------------- 经期记录 ---------------- */

async function listCycles(coupleId) {
  const res = await cloud.database
    .from('cycles')
    .select('*')
    .eq('couple_id', coupleId)
    .order('start_date', { ascending: false })
    .limit(LIST_LIMIT.cycle)
  return unwrap(res, '读取经期记录失败') || []
}

async function createCycle(coupleId, data) {
  const res = await cloud.database
    .from('cycles')
    .insert({
      couple_id: coupleId,
      owner_name: data.owner_name || null,
      start_date: data.start_date,
      end_date: data.end_date || null,
      cycle_length: data.cycle_length == null ? 28 : data.cycle_length,
      period_length: data.period_length == null ? 5 : data.period_length,
      flow: data.flow || null,
      symptom: data.symptom || null,
      note: data.note || null
    })
    .select()
  const rows = unwrap(res, '记录经期失败')
  return rows && rows[0]
}

async function updateCycle(coupleId, id, patch) {
  const payload = {}
  if (patch.start_date != null) payload.start_date = patch.start_date
  if (patch.end_date !== undefined) payload.end_date = patch.end_date
  if (patch.cycle_length !== undefined) payload.cycle_length = patch.cycle_length
  if (patch.period_length !== undefined) payload.period_length = patch.period_length
  if (patch.flow !== undefined) payload.flow = patch.flow
  if (patch.symptom !== undefined) payload.symptom = patch.symptom
  if (patch.note !== undefined) payload.note = patch.note
  const res = await cloud.database.from('cycles').update(payload).eq('couple_id', coupleId).eq('id', id).select()
  const rows = unwrap(res, '更新经期记录失败')
  return rows && rows[0]
}

async function deleteCycle(coupleId, id) {
  const res = await cloud.database.from('cycles').delete().eq('couple_id', coupleId).eq('id', id).select()
  return unwrap(res, '删除经期记录失败')
}

module.exports = {
  cloud,
  getSession,
  wechatLogin,
  ensureProfile,
  updateProfile,
  getCouple,
  createInvite,
  checkInvite,
  acceptInvite,
  unbind,
  updateRelationTime,
  reconcileProfile,
  syncProfiles,
  listPartners,
  listPartnersByIds,
  listAnniversaries,
  createAnniversary,
  updateAnniversary,
  deleteAnniversary,
  listDiaries,
  createDiary,
  deleteDiary,
  listAlbums,
  createAlbum,
  deleteAlbum,
  listAlbumItems,
  listAllAlbumItems,
  createAlbumItem,
  createAlbumItems,
  deleteAlbumItem,
  upsertLocation,
  listLocations,
  listOrders,
  createOrder,
  updateOrderStatus,
  deleteOrder,
  listCustomRecipes,
  createCustomRecipe,
  deleteCustomRecipe,
  listReminders,
  createReminder,
  markRemindersRead,
  saveSubscription,
  listSubscriptions,
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  listPreferences,
  listLikedPreferences,
  createPreference,
  updatePreference,
  deletePreference,
  listCycles,
  createCycle,
  updateCycle,
  deleteCycle,
  listWishes,
  createWish,
  updateWish,
  deleteWish
}
