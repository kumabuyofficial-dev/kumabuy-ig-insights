const DEFAULT_FIELDS = [
  "date",
  "reach",
  "impressions",
  "profile_views",
  "website_clicks_1d",
  "follower_count",
  "media_engagement",
  "media_reach",
  "media_impressions",
  "media_saved",
  "media_shares",
  "media_comments_count",
  "media_like_count",
  "media_permalink",
  "media_caption",
  "media_product_type"
];

exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const accountId = params.accountId || process.env.WINDSOR_INSTAGRAM_ACCOUNT_ID || "demo";
    const industry = normalizeIndustry(params.industry || "一般服務業");
    const dateTo = params.dateTo || new Date().toISOString().slice(0, 10);
    const dateFrom = params.dateFrom || offsetDate(dateTo, -30);

    const rows = await getInstagramRows({ accountId, dateFrom, dateTo });
    const report = buildReport(rows, { accountId, industry, dateFrom, dateTo });

    return json(200, report);
  } catch (error) {
    return json(500, {
      error: "REPORT_FAILED",
      message: error.message
    });
  }
};

async function getInstagramRows({ accountId, dateFrom, dateTo }) {
  const apiKey = process.env.WINDSOR_API_KEY;
  const apiUrl = process.env.WINDSOR_API_URL;

  if (!apiKey || !apiUrl || accountId === "demo") {
    return demoRows();
  }

  const url = new URL(apiUrl);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("connector", "instagram");
  url.searchParams.set("accounts", accountId);
  url.searchParams.set("date_from", dateFrom);
  url.searchParams.set("date_to", dateTo);
  url.searchParams.set("fields", DEFAULT_FIELDS.join(","));

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Instagram data API returned ${response.status}`);
  }

  const payload = await response.json();
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.result)) return payload.result;

  return demoRows();
}

function buildReport(rows, meta = {}) {
  const industry = normalizeIndustry(meta.industry || "一般服務業");
  const cleanRows = rows.map(normalizeRow);
  const dailyRows = cleanRows.filter((row) => row.reach !== null);
  const mediaRows = cleanRows
    .filter((row) => row.media_permalink)
    .sort((a, b) => metricScore(b) - metricScore(a));

  const totalReach = sum(dailyRows, "reach");
  const totalProfileViews = sum(dailyRows, "profile_views");
  const totalWebsiteClicks = sum(dailyRows, "website_clicks_1d");
  const totalMediaReach = sum(mediaRows, "media_reach");
  const totalEngagement = sum(mediaRows, "media_engagement");
  const totalSavesShares = sum(mediaRows, "media_saved") + sum(mediaRows, "media_shares");
  const engagementRate = totalMediaReach ? totalEngagement / totalMediaReach : 0;
  const previous = splitPeriods(dailyRows);
  const reachChange = percentChange(sum(previous.current, "reach"), sum(previous.previous, "reach"));
  const profile = getIndustryProfile(industry);

  return {
    generatedAt: new Date().toISOString(),
    source: process.env.WINDSOR_API_KEY ? "connected" : "demo",
    accountId: meta.accountId || "demo",
    industry,
    dateFrom: meta.dateFrom || "2026-06-17",
    dateTo: meta.dateTo || "2026-07-17",
    summary: {
      totalReach,
      totalMediaReach,
      totalEngagement,
      totalSavesShares,
      engagementRate,
      totalProfileViews,
      totalWebsiteClicks,
      reachChange
    },
    chart: dailyRows.map((row) => ({
      date: row.date,
      reach: row.reach || 0
    })),
    topContent: mediaRows.slice(0, 5).map((row) => ({
      date: row.date,
      type: row.media_product_type || "POST",
      caption: row.media_caption || "",
      permalink: row.media_permalink,
      reach: row.media_reach || 0,
      engagement: row.media_engagement || 0,
      saves: row.media_saved || 0,
      shares: row.media_shares || 0,
      comments: row.media_comments_count || 0,
      likes: row.media_like_count || 0,
      score: metricScore(row)
    })),
    issues: buildIssues({ industry, profile, engagementRate, totalSavesShares, totalWebsiteClicks }),
    recommendations: buildRecommendations({ industry, profile, engagementRate, totalSavesShares, totalWebsiteClicks })
  };
}

function buildIssues({ industry, profile, engagementRate, totalSavesShares, totalWebsiteClicks }) {
  const issues = [
    {
      title: "受眾意圖不夠明確",
      body: `${industry} 的內容需要更快講清楚「適合誰、解決什麼問題、下一步怎麼做」。目前內容若只停在曝光，會讓有需求的觀眾不知道如何行動。`,
      impact: "高"
    },
    {
      title: totalSavesShares < 80 ? "收藏分享訊號不足" : "內容價值可再放大",
      body: `此類服務更需要「可保存、可轉傳、可比較」的內容。建議用 ${profile.proofFormats.join("、")} 提高信任與分享。`,
      impact: totalSavesShares < 80 ? "中" : "中低"
    },
    {
      title: totalWebsiteClicks <= 0 ? "導流動線偏弱" : "導流品質需要分層",
      body: `${profile.conversionPath}。如果每支內容的 CTA 都不同，使用者會猶豫；建議統一導到 LINE、品牌評估表或預約諮詢。`,
      impact: totalWebsiteClicks <= 0 ? "高" : "中"
    }
  ];

  if (engagementRate < 0.06) {
    issues.unshift({
      title: "互動誘因不足",
      body: "短影音前 3 秒需要更直接點出痛點或結果，並在結尾要求一個具體互動，例如留言關鍵字、私訊、保存清單。",
      impact: "高"
    });
  }

  return issues.slice(0, 3);
}

function buildRecommendations({ industry, profile, engagementRate, totalSavesShares, totalWebsiteClicks }) {
  const recommendations = [
    {
      title: "先做行業痛點系列",
      body: `下週規劃 3 支「${industry} 客戶最常遇到的問題」短影音。每支只講一個問題，格式用「錯誤做法 → 正確做法 → 預約/私訊下一步」。`
    },
    {
      title: "增加信任證據",
      body: `加入 ${profile.proofFormats.join("、")}。業主型帳號不能只靠知識分享，必須讓觀眾看到結果、流程與可信證據。`
    },
    {
      title: "統一轉換入口",
      body: `${totalWebsiteClicks <= 0 ? "目前網站點擊偏弱，" : "已有點擊訊號，"}建議所有內容先導向同一個入口：LINE 諮詢、品牌評估表或案例頁，避免每篇貼文導流分散。`
    },
    {
      title: "用市場語境更新內容角度",
      body: `${profile.marketAngle}。內容不要只說服務特色，要轉成客戶當下正在比較、擔心、猶豫的問題。`
    }
  ];

  if (engagementRate < 0.06) {
    recommendations.unshift({
      title: "重寫短影音開頭",
      body: `開頭改成「${profile.hookExample}」這類結果型或風險型鉤子，避免從自我介紹或背景說明開始。`
    });
  }

  if (totalSavesShares < 80) {
    recommendations.push({
      title: "每週固定一篇可保存內容",
      body: "至少產出一篇 checklist、費用比較、流程表或避雷清單。這類內容通常比單純觀點更容易被收藏與分享。"
    });
  }

  return recommendations.slice(0, 5);
}

function getIndustryProfile(industry) {
  const text = industry.toLowerCase();

  if (matchAny(text, ["餐飲", "咖啡", "甜點", "小吃", "火鍋", "早午餐"])) {
    return {
      proofFormats: ["新品前後對比", "客人回訪案例", "菜單組合推薦", "地點與排隊動線"],
      conversionPath: "餐飲類內容應導向訂位、外帶、地圖導航或 LINE 菜單，而不是只導向品牌介紹",
      marketAngle: "目前餐飲內容競爭重點在「到店理由」與「可拍可分享」，需要把招牌品項、價格帶與情境講清楚",
      hookExample: "第一次來這間店，先點這 3 樣就不踩雷"
    };
  }

  if (matchAny(text, ["醫美", "診所", "牙醫", "皮膚", "健康", "中醫"])) {
    return {
      proofFormats: ["流程拆解", "術前術後注意事項", "常見迷思破解", "專業人員說明"],
      conversionPath: "醫療與健康相關內容應導向預約諮詢與風險說明，避免過度承諾效果",
      marketAngle: "使用者更在意安全、風險、恢復期、價格透明與真實案例，內容要降低不確定感",
      hookExample: "做療程前，先確認這 3 件事再預約"
    };
  }

  if (matchAny(text, ["美業", "髮", "美甲", "美容", "睫毛", "紋繡"])) {
    return {
      proofFormats: ["前後對比", "風格分類", "價格與維持期", "客人改造案例"],
      conversionPath: "美業內容應導向預約、作品集與 LINE 詢問檔期",
      marketAngle: "美業決策高度依賴風格信任與成果想像，內容要讓客人快速判斷自己適不適合",
      hookExample: "臉型偏圓的人，這種髮型最容易顯臉小"
    };
  }

  if (matchAny(text, ["補習", "教育", "課程", "教學", "學校", "語言"])) {
    return {
      proofFormats: ["學習成果", "課程路徑", "家長常見問題", "前後測比較"],
      conversionPath: "教育類內容應導向試聽、課程諮詢或程度檢測",
      marketAngle: "家長與學員重視成果、師資、陪跑方式與是否適合自己程度，內容要降低報名風險",
      hookExample: "孩子成績卡住，通常不是不努力，而是少了這一步"
    };
  }

  if (matchAny(text, ["房仲", "建設", "代銷", "室內設計", "裝修", "建築"])) {
    return {
      proofFormats: ["案例前後對比", "預算拆解", "流程節點", "避雷清單"],
      conversionPath: "高單價服務應導向諮詢表單、案例頁與 LINE 初談",
      marketAngle: "高單價決策週期長，內容要建立專業信任、透明流程與風險控管",
      hookExample: "簽約前沒問這 5 件事，後面最容易追加預算"
    };
  }

  if (matchAny(text, ["電商", "品牌", "商品", "服飾", "保養", "食品"])) {
    return {
      proofFormats: ["使用情境", "開箱實測", "顧客評價", "比較表"],
      conversionPath: "商品類內容應導向商品頁、限時優惠、LINE 社群或再行銷名單",
      marketAngle: "電商品牌需要用短影音縮短理解時間，讓消費者快速知道差異、場景與購買理由",
      hookExample: "這個商品不是給所有人，是給有這個困擾的人"
    };
  }

  if (matchAny(text, ["顧問", "行銷", "b2b", "企業", "軟體", "系統", "會計", "法律"])) {
    return {
      proofFormats: ["案例拆解", "流程圖", "成本比較", "決策清單"],
      conversionPath: "B2B 與顧問服務應導向評估表、預約諮詢或案例下載",
      marketAngle: "B2B 決策者重視問題成本、導入風險與可衡量成果，內容要從痛點與 ROI 切入",
      hookExample: "如果你每月還在手動整理這件事，代表流程已經在漏錢"
    };
  }

  return {
    proofFormats: ["案例拆解", "常見問題", "流程說明", "比較清單"],
    conversionPath: "服務型業主應導向 LINE 諮詢、評估表或預約表單，避免只停留在曝光",
    marketAngle: "現在使用者會先比較、查證、觀望，內容需要同時處理信任、差異與下一步行動",
    hookExample: "大多數人卡住不是因為沒需求，而是不知道第一步怎麼選"
  };
}

function matchAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function splitPeriods(rows) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const midpoint = Math.floor(sorted.length / 2);
  return {
    previous: sorted.slice(0, midpoint),
    current: sorted.slice(midpoint)
  };
}

function normalizeIndustry(value) {
  return String(value || "一般服務業").trim().slice(0, 40);
}

function normalizeRow(row) {
  const normalized = { ...row };
  for (const key of Object.keys(normalized)) {
    if (normalized[key] === "" || normalized[key] === undefined) normalized[key] = null;
    if (typeof normalized[key] === "string" && normalized[key] !== "" && !Number.isNaN(Number(normalized[key]))) {
      normalized[key] = Number(normalized[key]);
    }
  }
  return normalized;
}

function metricScore(row) {
  return (
    (row.media_reach || 0) * 0.35 +
    (row.media_engagement || 0) * 2 +
    (row.media_saved || 0) * 5 +
    (row.media_shares || 0) * 4 +
    (row.media_comments_count || 0) * 3
  );
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

function percentChange(current, previous) {
  if (!previous) return current ? 1 : 0;
  return (current - previous) / previous;
}

function offsetDate(dateString, offsetDays) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function demoRows() {
  return [
    { date: "2026-06-17", reach: 890 },
    {
      date: "2026-06-17",
      media_engagement: 164,
      media_reach: 1394,
      media_saved: 30,
      media_shares: 18,
      media_comments_count: 88,
      media_like_count: 24,
      media_permalink: "https://www.instagram.com/reel/DZrz7GlBfy1/",
      media_caption: "免費腳本生成器，做短影音必備。",
      media_product_type: "REELS"
    },
    { date: "2026-06-18", reach: 429 },
    { date: "2026-06-24", reach: 199 },
    { date: "2026-06-25", reach: 607 },
    {
      date: "2026-06-25",
      media_engagement: 101,
      media_reach: 857,
      media_saved: 19,
      media_shares: 11,
      media_comments_count: 55,
      media_like_count: 14,
      media_permalink: "https://www.instagram.com/reel/DZ_0YU4qxNQ/",
      media_caption: "免費 IG 帳號檢測器測試版。",
      media_product_type: "REELS"
    },
    { date: "2026-06-26", reach: 82 },
    { date: "2026-06-27", reach: 12 },
    { date: "2026-06-28", reach: 5 },
    { date: "2026-07-02", reach: 316 },
    { date: "2026-07-09", reach: 420 },
    { date: "2026-07-17", reach: 195 }
  ];
}

module.exports.buildReport = buildReport;
module.exports.demoRows = demoRows;
