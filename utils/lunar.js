/**
 * 农历换算工具
 * 覆盖 1900-2100 年，纪念日的农历日期必须与真实日历一一对应，
 * 因此这里内置标准农历数据表（每年 1 个 16/20 位掩码）。
 */

var LUNAR_INFO = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0,
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
  0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
  0x0d520
];

var MIN_YEAR = 1900;
var MAX_YEAR = 2100;

// 农历月名
var MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
var DAY_NAMES = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'
];

/** 农历某年闰月月份，0 表示无闰月 */
function leapMonth(year) {
  return LUNAR_INFO[year - MIN_YEAR] & 0xf;
}

/** 农历某年闰月天数 */
function leapDays(year) {
  if (!leapMonth(year)) return 0;
  return (LUNAR_INFO[year - MIN_YEAR] & 0x10000) ? 30 : 29;
}

/** 农历某年总天数 */
function yearDays(year) {
  var sum = 348;
  var info = LUNAR_INFO[year - MIN_YEAR];
  for (var i = 0x8000; i > 0x8; i >>= 1) {
    if (info & i) sum += 1;
  }
  return sum + leapDays(year);
}

/** 农历某月天数 */
function monthDays(year, month) {
  if (month > 12 || month < 1) return -1;
  var info = LUNAR_INFO[year - MIN_YEAR];
  return (info & (0x10000 >> month)) ? 30 : 29;
}

/** 计算从 1900-01-31 到公历 date 的天数差 */
function daysBetweenBase(date) {
  var base = Date.UTC(1900, 0, 31);
  var cur = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((cur - base) / 86400000);
}

/** 公历 -> 农历 */
function solarToLunar(date) {
  var offset = daysBetweenBase(date);
  if (offset < 0) return null;
  var year = MIN_YEAR;
  var temp = 0;
  while (year <= MAX_YEAR) {
    temp = yearDays(year);
    if (offset < temp) break;
    offset -= temp;
    year += 1;
  }
  if (year > MAX_YEAR) return null;

  // 按真实顺序排出该年 12（或 13）个月：闰 m 月紧跟在 m 月之后
  var leap = leapMonth(year);
  var order = [];
  for (var m = 1; m <= 12; m += 1) {
    order.push({ month: m, isLeap: false });
    if (leap === m) order.push({ month: m, isLeap: true });
  }

  for (var k = 0; k < order.length; k += 1) {
    var cur = order[k];
    var days = cur.isLeap ? leapDays(year) : monthDays(year, cur.month);
    if (offset < days) {
      return {
        year: year,
        month: cur.month,
        day: offset + 1,
        isLeap: cur.isLeap,
        monthName: (cur.isLeap ? '闰' : '') + MONTH_NAMES[cur.month - 1] + '月',
        dayName: DAY_NAMES[offset]
      };
    }
    offset -= days;
  }
  return null;
}

/**
 * 农历 -> 公历。返回 Date，找不到对应公历日期时返回 null。
 * month 支持闰月；该年没有该闰月时会退化到常规月。
 */
function lunarToSolar(lunarYear, lunarMonth, lunarDay, isLeap) {
  if (lunarMonth < 1 || lunarMonth > 12) return null;
  if (lunarDay < 1 || lunarDay > 30) return null;
  if (lunarYear < MIN_YEAR || lunarYear > MAX_YEAR) return null;

  var leap = leapMonth(lunarYear);
  var useLeap = !!isLeap && leap === lunarMonth;
  var maxDay = useLeap ? leapDays(lunarYear) : monthDays(lunarYear, lunarMonth);
  if (lunarDay > maxDay) return null;

  var offset = 0;
  var y;
  for (y = MIN_YEAR; y < lunarYear; y += 1) {
    offset += yearDays(y);
  }
  for (var m = 1; m < lunarMonth; m += 1) {
    offset += monthDays(lunarYear, m);
    if (leap > 0 && m === leap) offset += leapDays(lunarYear);
  }
  if (useLeap) {
    offset += monthDays(lunarYear, lunarMonth);
  }
  offset += lunarDay - 1;

  var d = new Date(1900, 0, 31 + offset);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 农历日期文字，例如「农历八月十五」 */
function lunarText(lunar) {
  if (!lunar) return '';
  return '农历' + lunar.monthName + lunar.dayName;
}

/** 判断该农历年是否存在某闰月 */
function hasLeapMonth(year, month) {
  return leapMonth(year) === month;
}

/** 某年所有闰月月份，无则返回 0 */
function leapMonthOf(year) {
  return leapMonth(year);
}

/** 该农历年农历月份的天数（考虑闰月） */
function daysInLunarMonth(year, month, isLeap) {
  if (isLeap && leapMonth(year) === month) return leapDays(year);
  return monthDays(year, month);
}

/** 农历月文字，例如「八月」「闰四月」 */
function monthLabel(month, isLeap) {
  return (isLeap ? '闰' : '') + MONTH_NAMES[month - 1] + '月';
}

/** 农历日文字，例如「十五」 */
function dayLabel(day) {
  return DAY_NAMES[day - 1];
}

/** 完整农历文字，例如「农历八月十五」 */
function fullText(year, month, day, isLeap) {
  return '农历' + year + '年' + monthLabel(month, isLeap) + dayLabel(day);
}

module.exports = {
  solarToLunar: solarToLunar,
  lunarToSolar: lunarToSolar,
  lunarText: lunarText,
  hasLeapMonth: hasLeapMonth,
  leapMonthOf: leapMonthOf,
  daysInLunarMonth: daysInLunarMonth,
  monthLabel: monthLabel,
  dayLabel: dayLabel,
  fullText: fullText,
  MIN_YEAR: MIN_YEAR,
  MAX_YEAR: MAX_YEAR
};
