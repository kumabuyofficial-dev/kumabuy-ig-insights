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
    const dateTo = params.dateTo || new Date().toISOString().slice(0, 10);
    const dateFrom = params.dateFrom || offsetDate(dateTo, -30);

    const rows = await getInstagramRows({ accountId, dateFrom, dateTo });
    const report = buildReport(rows, { accountId, dateFrom, dateTo });

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
  const engagementRate = totalMediaReach ? totalEngagement / totalMediaReach : 0;
  const bestPost = mediaRows[0] || null;
  const previous = splitPeriods(dailyRows);
  const reachChange = percentChange(sum(previous.current, "reach"), sum(previous.previous, "reach"));

  return {
    generatedAt: new Date().toISOString(),
    source: process.env.WINDSOR_API_KEY ? "connected" : "demo",
    accountId: meta.accountId || "demo",
    dateFrom: meta.dateFrom || "2026-05-30",
    dateTo: meta.dateTo || "2026-06-29",
    summary: {
      totalReach,
      totalMediaReach,
      totalEngagement,
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
    insights: buildInsights({ totalReach, engagementRate, reachChange, bestPost, mediaRows }),
    recommendations: buildRecommendations({ engagementRate, bestPost, mediaRows, totalWebsiteClicks })
  };
}

function buildInsights({ totalReach, engagementRate, reachChange, bestPost, mediaRows }) {
  const insights = [];

  insights.push(`近 30 天累積觸及約 ${formatNumber(totalReach)}，${reachChange >= 0 ? "觸及正在回升" : "觸及較前期偏弱"}。`);

  if (bestPost) {
    insights.push(`最佳內容是 ${bestPost.date} 的 ${bestPost.media_product_type || "內容"}，觸及 ${formatNumber(bestPost.media_reach)}、互動 ${formatNumber(bestPost.media_engagement)}。`);
  }

  if (engagementRate >= 0.08) {
    insights.push(`內容互動率約 ${formatPercent(engagementRate)}，代表目前主題有明顯留言或收藏動機。`);
  } else {
    insights.push(`內容互動率約 ${formatPercent(engagementRate)}，可以加強 CTA、封面承諾與可收藏資訊密度。`);
  }

  const reelCount = mediaRows.filter((row) => row.media_product_type === "REELS").length;
  insights.push(`本期可辨識內容中有 ${reelCount} 支 Reels，可優先用短影音做測試與放大。`);

  return insights;
}

function buildRecommendations({ engagementRate, bestPost, mediaRows, totalWebsiteClicks }) {
  const recommendations = [
    {
      title: "延伸表現最佳主題",
      body: bestPost
        ? `把「${shortCaption(bestPost.media_caption)}」拆成 3 支系列短影音：教學版、案例版、工具清單版。`
        : "先用 3 到 5 支短影音測試明確主題，再用收藏、分享、留言判斷下一輪方向。"
    },
    {
      title: "把 CTA 從留言延伸到轉換",
      body: totalWebsiteClicks > 0
        ? "既然已有網站點擊，下一步應測試簡短落地頁與 UTM，追蹤每支內容帶來的名單。"
        : "目前應在個人檔案與貼文 CTA 補上明確下一步，例如免費檢測、腳本模板或私訊關鍵字。"
    },
    {
      title: "每週固定產出數據報告",
      body: "建議每週一自動整理觸及、互動、收藏、分享、留言與最佳內容，讓經營方向不只靠感覺。"
    }
  ];

  if (engagementRate < 0.06) {
    recommendations.unshift({
      title: "優先提高收藏與分享",
      body: "將內容改成更可保存的格式，例如檢查清單、步驟模板、錯誤對照表，並在影片前 3 秒說清楚收益。"
    });
  }

  if (mediaRows.length < 4) {
    recommendations.push({
      title: "增加測試樣本",
      body: "目前可分析內容數偏少，建議連續兩週每週至少 3 支 Reels，才能看出穩定主題訊號。"
    });
  }

  return recommendations;
}

function splitPeriods(rows) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const midpoint = Math.floor(sorted.length / 2);
  return {
    previous: sorted.slice(0, midpoint),
    current: sorted.slice(midpoint)
  };
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

function formatNumber(value) {
  return new Intl.NumberFormat("zh-TW").format(Math.round(value || 0));
}

function formatPercent(value) {
  return `${Math.round((value || 0) * 1000) / 10}%`;
}

function shortCaption(caption = "") {
  return caption.replace(/\s+/g, " ").slice(0, 28) || "最佳內容主題";
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
    { date: "2026-05-30", reach: 37 },
    { date: "2026-06-03", reach: 8 },
    { date: "2026-06-07", reach: 24 },
    { date: "2026-06-08", reach: 56 },
    { date: "2026-06-09", reach: 24 },
    { date: "2026-06-15", reach: 245 },
    {
      date: "2026-06-15",
      media_engagement: 28,
      media_reach: 303,
      media_saved: 4,
      media_shares: 5,
      media_comments_count: 10,
      media_like_count: 7,
      media_permalink: "https://www.instagram.com/reel/DZmvxSqKjFW/",
      media_caption: "記得登入 Claude 後，就可以無限使用啦 #ai工具 #自媒體",
      media_product_type: "REELS"
    },
    { date: "2026-06-16", reach: 39 },
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
      media_caption: "我們成功做了一套免費腳本生成器啦，做短影音必備 #ai工具應用 #ai行銷",
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
      media_caption: "免費 IG 帳號檢測器測試版，未來會申請 IG 官方審核連動後台數據 #免費IG帳號檢測器",
      media_product_type: "REELS"
    },
    { date: "2026-06-26", reach: 82 },
    { date: "2026-06-27", reach: 12 },
    { date: "2026-06-28", reach: 5 },
    { date: "2026-06-29", reach: 0 }
  ];
}

module.exports.buildReport = buildReport;
module.exports.demoRows = demoRows;
