// 皮肤切换核心模块（纯前端实现）
// 偏好仅存本地新键 member_skin_id；不触碰任何既有存储键、不发起任何网络请求、不改动业务逻辑。
// 皮肤值异常时自动回落 classic，保证任何情况下页面都能正常渲染。

const SKIN_KEY = 'member_skin_id';
const SKIN_IDS = ['classic', 'paper', 'volt'];

// ============ 皮肤注册表 ============
// swatches：选择页色板条；nav：导航栏颜色（custom 导航页自动跳过）
// t：皮肤文案表（三套同结构；classic 为现有文案，paper/volt 为新皮肤文案）
const SKINS = {
  classic: {
    id: 'classic',
    name: '经典 · 豆沙玫瑰',
    desc: '现用外观 · 柔和暖色',
    swatches: ['#D4786E', '#FBFAF8', '#2A2122'],
    nav: { bg: '#FBFAF8', text: 'black' },
    t: {
      homeHeroTitle: '',
      homeHeroPre: '今日 ',
      homeHeroPost: ' 节课程',
      secNotices: '通知',
      secCoaches: '热门教练',
      secCourses: '近期课程',
      btnMore: '全部',
      btnBook: '预约',
      btnBooked: '已预约',
      btnWaitlist: '候补',
      btnWaitlisted: '候补中',
      btnEnded: '已结束',
      btnDone: '已完成',
      bookingTitle: '场次预约',
      countUnit: '节',
      detailCostLabel: '消耗次数',
      detailBookBtn: '立即预约',
      profilePass: '会员码',
      menuSkin: '皮肤外观',
      successWord: '预约成功',
      cancelWord: '已取消预约',
      sealChar: '栖',
      okBtn: '好的',
      coachK: 'COACH',
      lastK: 'RECORDS',
      noticePausedTitle: '暂不可约',
      noticePausedDesc: '套餐停卡中，复卡后可继续预约',
      stopBadge: '停卡中',
      stopNote: '停卡中 · 有效期冻结，复卡后继续',
      limitedTitle: '账号已限制',
      limitedDesc: '请联系门店处理',
      frozenTitle: '权益已冻结',
      frozenDesc: '套餐权益处理中，请联系门店',
      contactStore: '联系门店',
      recheck: '重新验证'
    }
  },
  paper: {
    id: 'paper',
    name: '纸上舞台',
    desc: '宋体大字 · 朱砂印章 · 刊物纸感',
    swatches: ['#F5F1E8', '#B93A26', '#221D15'],
    nav: { bg: '#F5F1E8', text: 'black' },
    t: {
      homeHeroTitle: '以舞为栖',
      homeHeroPre: '今日 ',
      homeHeroPost: ' 节课可约',
      secNotices: '栖事',
      secCoaches: '舞栖教练',
      secCourses: '待你登场',
      btnMore: '全部',
      btnBook: '预约',
      btnBooked: '已约',
      btnWaitlist: '候补',
      btnWaitlisted: '候补中',
      btnEnded: '已结束',
      btnDone: '已完成',
      bookingTitle: '场次预约',
      countUnit: '场',
      detailCostLabel: '消耗',
      detailBookBtn: '立即预约',
      profilePass: '入场券 · 到店出示签到',
      menuSkin: '皮肤外观',
      successWord: '预约成功',
      cancelWord: '已取消预约',
      sealChar: '栖',
      okBtn: '好的',
      coachK: 'COACH',
      lastK: 'RECORDS',
      noticePausedTitle: '暂停入场',
      noticePausedDesc: '套餐停卡中，复卡后可继续预约',
      stopBadge: '缓',
      stopNote: '停卡中 · 有效期冻结',
      limitedTitle: '暂停入场',
      limitedDesc: '账号已限制，请联系门店',
      frozenTitle: '暂缓使用',
      frozenDesc: '权益处理中，请联系门店',
      contactStore: '联系门店',
      recheck: '重新验证'
    }
  },
  volt: {
    id: 'volt',
    name: 'VOLT 舞力场',
    desc: '三色纪律 · 登场文化 · 俱乐部能量',
    swatches: ['#111310', '#F2F1ED', '#D7FF3B'],
    nav: { bg: '#F2F1ED', text: 'black' },
    t: {
      homeHeroTitle: "TODAY'S SHOWTIME",
      homeHeroPre: '今日 ',
      homeHeroPost: ' 场登场',
      secNotices: '今日播报',
      secCoaches: '带课教练',
      secCourses: '近期登场',
      btnMore: 'MORE',
      btnBook: '立即锁定',
      btnBooked: '舞社见',
      btnWaitlist: '候补排队',
      btnWaitlisted: '排队中',
      btnEnded: 'NEXT TIME',
      btnDone: '已登场',
      bookingTitle: '场次预约',
      countUnit: '场',
      detailCostLabel: 'COST',
      detailBookBtn: '立即锁定',
      profilePass: '入场 PASS · 到店出示',
      menuSkin: '皮肤外观',
      successWord: 'LOCKED',
      cancelWord: 'RELEASED',
      sealChar: '栖',
      okBtn: '好的，舞社见',
      coachK: 'COACH',
      lastK: 'LAST SESSION',
      noticePausedTitle: 'PAUSED',
      noticePausedDesc: '套餐停卡中，复卡后可继续预约',
      stopBadge: 'PAUSED',
      stopNote: 'PAUSED · 有效期已冻结',
      limitedTitle: 'ACCESS DENIED',
      limitedDesc: '账号已限制，请联系门店',
      frozenTitle: 'FROZEN',
      frozenDesc: '权益处理中，请联系门店',
      contactStore: '联系门店',
      recheck: '重新验证'
    }
  }
};

function resolveSkin(id) {
  return SKIN_IDS.indexOf(id) > -1 ? id : 'classic';
}

// 读取当前皮肤（含异常回落）
function getSkinId() {
  try {
    return resolveSkin(wx.getStorageSync(SKIN_KEY));
  } catch (e) {
    return 'classic';
  }
}

function setSkinId(id) {
  try {
    wx.setStorageSync(SKIN_KEY, resolveSkin(id));
  } catch (e) { /* 存储异常时静默：本次会话仍可用当前皮肤 */ }
}

function getSkin() {
  return SKINS[getSkinId()];
}

// 页面接入入口：onShow 时 this.setData(skin.pageState())
// options.nav === false 时跳过导航栏刷新（自定义导航页）
function pageState(options) {
  const skin = getSkin();
  if (!options || options.nav !== false) {
    try {
      wx.setNavigationBarColor({
        frontColor: '#000000',
        backgroundColor: skin.nav.bg,
        fail: function () { /* 自定义导航页或 tabBar 页会 fail，忽略 */ }
      });
    } catch (e) { /* 忽略 */ }
  }
  if (skin.id === 'paper') ensurePaperFont();
  return { skinId: skin.id, t: skin.t };
}

// VOLT 皮肤字体：base64 内嵌（Anton 海报字 / Space Grotesk 数字），全局加载一次
let _voltFontsLoaded = false;
function ensureVoltFonts() {
  if (_voltFontsLoaded) return;
  _voltFontsLoaded = true;
  try {
    const fonts = require('../styles/volt-fonts.js');
    const load = (family, source, weight) => {
      wx.loadFontFace({
        global: true,
        family: family,
        source: 'url("' + source + '")',
        weight: weight,
        desc: { style: 'normal' },
        fail: function () { /* 字体加载失败静默：回退系统字体 */ }
      });
    };
    load('AntonV', fonts.anton, 'normal');
    load('GroteskV', fonts.grotesk500, '500');
    load('GroteskV', fonts.grotesk700, '700');
  } catch (e) { /* 静默 */ }
}

// 系统弹窗确认键颜色（wx.showModal 的 confirmColor 随皮肤）
function confirmColor() {
  const id = getSkinId();
  return id === 'paper' ? '#B93A26' : (id === 'volt' ? '#111310' : '#D4786E');
}

// paper 可选增强：从自家服务器加载思源宋体子集（400/700 两个字重，同族按 weight 注册）
// 需将 docs/fonts/ 下两个 woff2 上传至服务器 /uploads/fonts/；加载失败静默，回退系统宋体栈
let _paperFontTried = false;
function ensurePaperFont() {
  if (_paperFontTried) return;
  _paperFontTried = true;
  const base = 'https://api.yuekeme.cn/uploads/fonts/';
  const load = function (weight, file) {
    try {
      wx.loadFontFace({
        global: true,
        family: 'NotoSerifSC',
        source: 'url("' + base + file + '")',
        weight: weight,
        desc: { style: 'normal' },
        fail: function () { /* 服务器无字体文件时静默，回退系统宋体栈 */ }
      });
    } catch (e) { /* 忽略 */ }
  };
  load('400', 'NotoSerifSC-Regular-subset.woff2');
  load('700', 'NotoSerifSC-Bold-subset.woff2');
}

// 皮肤列表（选择页用）
function skinList() {
  const current = getSkinId();
  return SKIN_IDS.map(function (id) {
    const s = SKINS[id];
    return {
      id: s.id,
      name: s.name,
      desc: s.desc,
      swatches: s.swatches,
      active: id === current
    };
  });
}

// 预约成功/取消的皮肤动效反馈：
// paper/volt 返回 skinSuccess 状态（交给 skin-success 组件渲染盖章/拳入）
// classic 返回 null，调用方继续走原有 toast/modal 提示
// info：可选票面数据 { name, date, weekDay, time, room, credits, remain }（volt 成功弹窗三行票面用）
function successState(kind, desc, info) {
  const id = getSkinId();
  if (id === 'classic') return null;
  const s = SKINS[id].t;
  return {
    visible: true,
    skin: id,
    kind: kind || 'success',
    word: (kind === 'cancel') ? s.cancelWord : s.successWord,
    seal: s.sealChar,
    desc: desc || '',
    okText: (kind === 'cancel' && id === 'volt') ? '好的，下次见' : s.okBtn,
    info: info || null
  };
}

// 关闭动效层（页面 onSkinSuccessOk 里调用）
function closeSuccess(page) {
  page.setData({ 'skinSuccess.visible': false });
}

module.exports = {
  confirmColor: confirmColor,
  ensurePaperFont: ensurePaperFont,
  ensureVoltFonts: ensureVoltFonts,
  SKIN_KEY: SKIN_KEY,
  SKINS: SKINS,
  SKIN_IDS: SKIN_IDS,
  resolveSkin: resolveSkin,
  getSkinId: getSkinId,
  setSkinId: setSkinId,
  getSkin: getSkin,
  pageState: pageState,
  skinList: skinList,
  successState: successState,
  closeSuccess: closeSuccess
};
