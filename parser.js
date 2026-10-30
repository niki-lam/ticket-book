/* 小票账本 · 本地解析器
   纯规则、无网络、无模型调用。页面与测试共用同一份文件。
   已知限制（写进测试结论，不隐藏）：
   - 金额取「最后一个数字」，一句话里出现两个金额时会取错；
   - 不支持「10.25」点号日期、不支持「上周三」这类相对周日期；
   - 中文数字（两块五、一百三）不识别。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TicketParser = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var CATS = {
    food: ["午餐", "早饭", "午饭", "晚饭", "早餐", "早午餐", "夜宵", "外卖", "咖啡", "奶茶",
           "火锅", "烧烤", "餐厅", "食堂", "零食", "水果", "聚餐", "吃了", "吃饭"],
    transport: ["打车", "滴滴", "出租车", "地铁", "公交", "高铁", "火车", "机票", "停车",
                "加油", "油费", "单车"],
    home: ["房租", "住宿", "酒店", "水费", "电费", "物业费", "物业", "宽带", "燃气"],
    shop: ["超市", "日用", "淘宝", "京东", "拼多多", "衣服", "洗衣", "纸巾", "化妆品", "理发"],
    other: []
  };

  var CAT_LABEL = { food: "餐饮", transport: "交通", home: "住宿", shop: "日用", other: "其他" };

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function shift(d, n) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() + n);
    return x;
  }
  function makeDate(y, m, dd) {
    var d = new Date(y, m - 1, dd);
    if (d.getFullYear() !== y || d.getMonth() !== m - 1 || d.getDate() !== dd) return null;
    return d;
  }

  var DATE_RULES = [
    { re: /(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*[日号]?/, kind: "ymd" },
    { re: /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/, kind: "md" },
    { re: /(\d{1,2})\s*号/, kind: "d" },
    { re: /后天/, kind: "rel", n: 2 },
    { re: /前天/, kind: "rel", n: -2 },
    { re: /昨天|昨日/, kind: "rel", n: -1 },
    { re: /今天|今日/, kind: "rel", n: 0 }
  ];

  /* 找出并摘下日期短语，返回 { date, index, len } */
  function findDate(text, now) {
    for (var i = 0; i < DATE_RULES.length; i++) {
      var rule = DATE_RULES[i];
      var m = text.match(rule.re);
      if (!m) continue;
      var date = null;
      if (rule.kind === "ymd") date = makeDate(+m[1], +m[2], +m[3]);
      else if (rule.kind === "md") date = makeDate(now.getFullYear(), +m[1], +m[2]);
      else if (rule.kind === "d") date = makeDate(now.getFullYear(), now.getMonth() + 1, +m[1]);
      else if (rule.kind === "rel") date = shift(now, rule.n);
      if (!date) continue;                       // 日期非法就当没写，不猜
      return { date: ymd(date), index: m.index, len: m[0].length };
    }
    return null;
  }

  function lastNumber(text) {
    var re = /(\d+(?:\.\d{1,2})?)/g, m, last = null;
    while ((m = re.exec(text))) last = { v: parseFloat(m[1]), index: m.index, len: m[0].length };
    return last;
  }

  function detectCat(text) {
    var best = { cat: "other", len: 0 };
    Object.keys(CATS).forEach(function (cat) {
      CATS[cat].forEach(function (kw) {
        if (text.indexOf(kw) > -1 && kw.length > best.len) best = { cat: cat, len: kw.length };
      });
    });
    return best.cat;
  }

  var NOISE = /^(?:我|今天|刚才|刚刚|花了|花了|花了|买了|支付|消费|一共|总共|合计|记|一笔|了|的|元|块|钱)+/;

  function cleanName(text) {
    return text
      .replace(/[¥￥]/g, " ")
      .replace(/(?:元|块钱|块|圆)/g, " ")
      .replace(NOISE, "")
      .replace(/^(?:花了|买了|支付|消费|一共|总共|合计|记一笔|记|了)+/, "")
      .replace(/[，,、。.：:;；\s]+/g, " ")
      .trim();
  }

  /* 一句话拆多笔：换行必拆；逗号分号仅在两侧都含数字时拆 */
  function splitSegments(text) {
    var out = [];
    text.split(/\n/).forEach(function (line) {
      var t = line.trim();
      if (!t) return;
      var parts = t.split(/[，,；;]/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (parts.length > 1) {
        var withNum = parts.filter(function (p) { return /\d/.test(p); });
        if (withNum.length >= 2) { out = out.concat(parts); return; }
      }
      out.push(t);
    });
    return out;
  }

  function parseOne(raw, now) {
    var text = raw.trim();
    var dm = findDate(text, now);
    var stripped = text;
    if (dm) stripped = stripped.slice(0, dm.index) + " " + stripped.slice(dm.index + dm.len);

    var am = lastNumber(stripped);
    if (!am) return { issue: "no-amount", raw: text };

    var rest = stripped.slice(0, am.index) + " " + stripped.slice(am.index + am.len);
    var name = cleanName(rest);

    return {
      name: name || CAT_LABEL[detectCat(text)],
      cat: detectCat(text),
      amt: Math.round(am.v * 100) / 100,
      date: dm ? dm.date : ymd(now),
      raw: text
    };
  }

  /* 对外 API：返回 { entries, issues } */
  function parseAll(text, now) {
    var base = now instanceof Date ? now : new Date();
    var entries = [], issues = [];
    splitSegments(String(text || "")).forEach(function (seg) {
      var r = parseOne(seg, base);
      if (r.issue) issues.push(r); else entries.push(r);
    });
    return { entries: entries, issues: issues };
  }

  return { parseAll: parseAll, CAT_LABEL: CAT_LABEL, CATS: CATS, _internal: { findDate: findDate, splitSegments: splitSegments } };
});
