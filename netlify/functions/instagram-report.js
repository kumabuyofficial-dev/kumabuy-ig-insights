exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const account = normalizeAccount(params.account || "");
    const phylloAccountId = String(params.phylloAccountId || "").trim();
    const phylloUserId = String(params.phylloUserId || "").trim();
    const industry = normalizeIndustry(params.industry || "");
    const dateTo = params.dateTo || new Date().toISOString().slice(0, 10);
    const dateFrom = params.dateFrom || offsetDate(dateTo, -30);

    if (!account) {
      return json(400, {
        error: "ACCOUNT_REQUIRED",
        message: "請先填寫 Instagram 帳號。"
      });
    }

    if (!industry) {
      return json(400, {
        error: "INDUSTRY_REQUIRED",
        message: "請先選擇行業別 / 服務性質。"
      });
    }

    if (!isDataSourceConfigured()) {
      return json(503, {
        error: "PHYLLO_NOT_CONFIGURED",
        message: "Phyllo 尚未設定。請先在 Netlify 設定 PHYLLO_CLIENT_ID 與 PHYLLO_CLIENT_SECRET。"
      });
    }

    if (!phylloAccountId && !phylloUserId) {
      return json(409, {
        error: "INSTAGRAM_NOT_CONNECTED",
        message: "請先按「連接 Instagram 數據」完成授權，系統才會讀取該帳號的實際數據。"
      });
    }

    const { accountId, rows } = await getInstagramRows({ phylloAccountId, phylloUserId, account, dateFrom, dateTo });
    const report = buildReport(rows, { accountId: account, providerAccountId: accountId, industry, dateFrom, dateTo, source: "connected" });

    return json(200, report);
  } catch (error) {
    return json(500, {
      error: "REPORT_FAILED",
      message: error.message
    });
  }
};

async function getInstagramRows({ phylloAccountId, phylloUserId, account, dateFrom, dateTo }) {
  const accountId = phylloAccountId || (await findConnectedAccountId({ phylloUserId, account }));
  if (!accountId) {
    throw new Error("尚未找到已授權的 Instagram 帳號，請重新連接 Instagram 數據。");
  }

  const [profilesPayload, contentsPayload] = await Promise.all([
    phylloFetch(`/v1/profiles?account_id=${encodeURIComponent(accountId)}`),
    phylloFetch(`/v1/social/contents?account_id=${encodeURIComponent(accountId)}&from_date=${encodeURIComponent(dateFrom)}&to_date=${encodeURIComponent(dateTo)}`)
  ]);

  return {
    accountId,
    rows: normalizePhylloRows({
      profile: firstData(profilesPayload),
      contents: dataArray(contentsPayload),
      dateFrom,
      dateTo
    })
  };
}

async function findConnectedAccountId({ phylloUserId, account }) {
  if (!phylloUserId) return "";
  const payload = await phylloFetch(`/v1/accounts?user_id=${encodeURIComponent(phylloUserId)}`);
  const accounts = dataArray(payload);
  const normalizedAccount = normalizeAccount(account).toLowerCase();
  const instagramAccounts = accounts.filter((item) => {
    const platformName = String(item.work_platform?.name || item.work_platform_name || "").toLowerCase();
    return platformName.includes("instagram") || item.work_platform_id === process.env.PHYLLO_INSTAGRAM_WORK_PLATFORM_ID;
  });
  const matched = instagramAccounts.find((item) => normalizeAccount(item.username || item.platform_username || item.handle || "").toLowerCase() === normalizedAccount);
  return (matched || instagramAccounts[0] || {}).id || "";
}

function normalizePhylloRows({ profile, contents, dateFrom, dateTo }) {
  const profileMetrics = metricBag(profile);
  const profileRow = {
    date: dateTo,
    reach: metricValue(profileMetrics, ["reach", "impressions", "profile_views", "follower_count"]),
    impressions: metricValue(profileMetrics, ["impressions"]),
    profile_views: metricValue(profileMetrics, ["profile_views", "profile_view_count"]),
    website_clicks_1d: metricValue(profileMetrics, ["website_clicks", "website_clicks_1d", "external_link_taps"]),
    follower_count: metricValue(profileMetrics, ["follower_count", "followers_count", "subscriber_count"])
  };

  const contentRows = contents.map((item) => {
    const metrics = metricBag(item);
    const publishedAt = item.published_at || item.created_at || item.date || dateTo;
    const likeCount = metricValue(metrics, ["like_count", "likes"]);
    const commentCount = metricValue(metrics, ["comment_count", "comments"]);
    const saveCount = metricValue(metrics, ["save_count", "saves", "saved"]);
    const shareCount = metricValue(metrics, ["share_count", "shares"]);
    const viewCount = metricValue(metrics, ["views", "view_count", "video_views", "plays", "play_count"]);
    const reach = metricValue(metrics, ["reach", "impressions", "views", "view_count", "video_views", "plays", "play_count"]);
    const directEngagement = metricValue(metrics, ["engagement", "engagement_count", "total_engagement"]);
    const engagementParts = [likeCount, commentCount, saveCount, shareCount].filter(hasMetric);
    const engagement = directEngagement !== null ? directEngagement : engagementParts.length ? engagementParts.reduce((total, value) => total + Number(value), 0) : null;

    return {
      date: String(publishedAt).slice(0, 10),
      reach,
      media_reach: reach,
      media_impressions: metricValue(metrics, ["impressions"]),
      media_views: viewCount,
      media_engagement: engagement,
      media_saved: saveCount,
      media_shares: shareCount,
      media_comments_count: commentCount,
      media_like_count: likeCount,
      media_id: item.id || item.content_id || item.platform_content_id || "",
      media_permalink: item.url || item.permalink || item.link || "",
      media_caption: item.title || item.caption || item.description || "",
      media_product_type: item.type || item.content_type || item.format || item.media_type || "POST",
      is_media_content: true
    };
  });

  return [profileRow, ...contentRows].filter((row) => row.date >= dateFrom && row.date <= dateTo);
}

function buildReport(rows, meta = {}) {
  const industry = normalizeIndustry(meta.industry || "一般服務業");
  const cleanRows = rows.map(normalizeRow);
  const dailyRows = cleanRows.filter((row) => !row.is_media_content && hasMetric(row.reach));
  const mediaRows = cleanRows
    .filter((row) => row.is_media_content && hasContentSignal(row))
    .sort((a, b) => metricScore(b) - metricScore(a));

  const reachRows = mediaRows.filter((row) => hasMetric(row.media_reach));
  const profileReach = sum(dailyRows, "reach");
  const mediaReach = sum(reachRows, "media_reach");
  const totalReach = profileReach || mediaReach || null;
  const totalProfileViews = nullableSum(dailyRows, "profile_views");
  const totalWebsiteClicks = nullableSum(dailyRows, "website_clicks_1d");
  const totalMediaReach = mediaReach || null;
  const totalEngagement = nullableSum(mediaRows, "media_engagement");
  const totalSavesShares = nullableSum(mediaRows, "media_saved", "media_shares");
  const engagementRate = totalMediaReach && totalEngagement !== null ? totalEngagement / totalMediaReach : null;
  const previous = splitPeriods(dailyRows);
  const reachChange = dailyRows.length > 1 ? percentChange(sum(previous.current, "reach"), sum(previous.previous, "reach")) : null;
  const profile = getIndustryProfile(industry);
  const chartRows = buildChartRows({ dailyRows, mediaRows });
  const availability = {
    hasReach: totalReach !== null,
    hasEngagement: totalEngagement !== null,
    hasSavesShares: totalSavesShares !== null,
    hasWebsiteClicks: totalWebsiteClicks !== null,
    contentCount: mediaRows.length,
    chartMetric: chartRows.metric
  };

  return {
    generatedAt: new Date().toISOString(),
    source: meta.source || "connected",
    accountId: meta.accountId || "",
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
    availability,
    chart: chartRows.rows,
    topContent: mediaRows.slice(0, 5).map((row) => ({
      date: row.date,
      type: row.media_product_type || "POST",
      caption: row.media_caption || "",
      permalink: row.media_permalink,
      reach: row.media_reach,
      engagement: row.media_engagement,
      saves: row.media_saved,
      shares: row.media_shares,
      comments: row.media_comments_count,
      likes: row.media_like_count,
      score: metricScore(row)
    })),
    issues: buildIssues({ industry, profile, engagementRate, totalSavesShares, totalWebsiteClicks, availability }),
    recommendations: buildRecommendations({ industry, profile, engagementRate, totalSavesShares, totalWebsiteClicks, availability })
  };
}

function buildIssues({ industry, profile, engagementRate, totalSavesShares, totalWebsiteClicks, availability }) {
  const issues = [
    {
      title: availability.hasReach ? "受眾意圖需要更精準" : "觸及資料尚未回傳，不能用 0 判斷成效",
      body: availability.hasReach
        ? `${industry} 的內容需要更快講清楚「適合誰、解決什麼問題、下一步怎麼做」。目前應避免只追泛流量，而要把短影音任務拆成知名度、導流、信任與轉換。`
        : "目前已完成授權，但 Phyllo 尚未回傳觸及或播放類資料。報告會先用已取得的收藏、分享、留言與內容訊號判讀；觸及欄位不應被解讀為帳號真的沒有曝光。",
      impact: "高"
    },
    {
      title: !availability.contentCount ? "近 30 天內容資料不足" : totalSavesShares !== null && totalSavesShares < 80 ? "收藏分享訊號偏弱" : "內容價值可再放大",
      body: !availability.contentCount
        ? "目前沒有足夠的內容列入排行。若帳號近期有發文，可能是平台資料同步尚未完成；若近期沒有發文，診斷應先從內容頻率與主題架構開始。"
        : `此類服務更需要「可保存、可轉傳、可比較」的內容。建議用 ${profile.proofFormats.join("、")} 提高信任與分享，而不是只做漂亮畫面或日常紀錄。`,
      impact: totalSavesShares !== null && totalSavesShares < 80 ? "中" : "中低"
    },
    {
      title: totalWebsiteClicks === null ? "導流資料尚未回傳" : totalWebsiteClicks <= 0 ? "導流動線偏弱" : "導流品質需要分層",
      body: `${profile.conversionPath}。短影音如果只負責曝光，後面沒有 CTA、LINE 私域、評估表或再行銷受眾，泛流量很難變成有效名單。`,
      impact: totalWebsiteClicks === null || totalWebsiteClicks <= 0 ? "高" : "中"
    }
  ];

  if (engagementRate !== null && engagementRate < 0.06) {
    issues.unshift({
      title: "互動誘因不足",
      body: "短影音前 3 秒需要更直接點出痛點或結果，並在結尾要求一個具體互動，例如留言關鍵字、私訊、保存清單。",
      impact: "高"
    });
  }

  return issues.slice(0, 3);
}

function buildRecommendations({ industry, profile, engagementRate, totalSavesShares, totalWebsiteClicks, availability }) {
  const recommendations = [
    {
      title: "先定義短影音任務",
      body: `下週每支短影音先標記一個目的：品牌知名度、泛流量測試、信任養成、CTA 導流或廣告投放素材。${industry} 不應每支影片都同時想要爆紅與成交，任務不同，腳本、指標與 CTA 都要不同。`
    },
    {
      title: "套用七步驟短影音獲客",
      body: `用「鉤子 → 痛點 → 情境 → 解法 → 證據 → CTA → 承接頁」重寫 3 支內容。鉤子負責停留，痛點負責共鳴，證據負責信任，CTA 負責把流量導到 LINE、評估表、案例頁或預約諮詢。`
    },
    {
      title: "泛流量內容只測題材，不急著成交",
      body: `泛流量影片用 ${profile.hookExample} 這類結果型或風險型開頭，目標是測出大眾有感的角度。成功指標看播放、保存、分享與留言，不要用是否立刻成交來判斷。`
    },
    {
      title: "CTA 內容要承接名單與私域",
      body: `${totalWebsiteClicks === null ? "目前平台尚未回傳導流資料，" : totalWebsiteClicks <= 0 ? "目前導流訊號偏弱，" : "已有導流訊號，"}建議每週至少 2 支內容明確導向同一個入口：LINE 諮詢、品牌評估表、案例頁或預約表單。CTA 不要只寫「歡迎私訊」，要說明私訊後能拿到什麼。`
    },
    {
      title: "投放素材要和自然內容分開判斷",
      body: `適合投放的素材不是最美的影片，而是能在 3 秒內講出「誰的問題、為什麼現在要處理、下一步去哪裡」的影片。先用自然流量找出高保存或高留言題材，再做成廣告素材測試。`
    },
    {
      title: "增加信任證據",
      body: `加入 ${profile.proofFormats.join("、")}。業主型帳號不能只靠知識分享，必須讓觀眾看到結果、流程、比較與可信證據。`
    },
    {
      title: "用市場語境更新內容角度",
      body: `${profile.marketAngle}。內容不要只說服務特色，要轉成客戶當下正在比較、擔心、猶豫的問題。`
    }
  ];

  if (engagementRate !== null && engagementRate < 0.06) {
    recommendations.unshift({
      title: "重寫短影音開頭",
      body: `開頭改成「${profile.hookExample}」這類結果型或風險型鉤子，避免從自我介紹或背景說明開始。`
    });
  }

  if (totalSavesShares !== null && totalSavesShares < 80) {
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

function metricBag(item) {
  const bag = {};
  collectMetrics(item, bag);
  return bag;
}

function collectMetrics(value, bag) {
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    value.forEach((item) => collectMetrics(item, bag));
    return;
  }

  const metricName = value.name || value.metric || value.metric_name || value.metric_type || value.type || value.key;
  const metricValue = value.value ?? value.count ?? value.total;
  if (metricName && metricValue !== undefined) {
    bag[normalizeMetricKey(metricName)] = toNullableNumber(metricValue);
  }

  for (const [key, child] of Object.entries(value)) {
    if (child === null || child === undefined) continue;
    if (typeof child === "number" || (typeof child === "string" && child.trim() !== "" && !Number.isNaN(Number(child)))) {
      bag[normalizeMetricKey(key)] = toNullableNumber(child);
    } else if (typeof child === "object") {
      collectMetrics(child, bag);
    }
  }
}

function metricValue(metrics, aliases) {
  for (const alias of aliases) {
    const normalizedAlias = normalizeMetricKey(alias);
    if (metrics[normalizedAlias] !== undefined && metrics[normalizedAlias] !== null) return metrics[normalizedAlias];
  }
  return null;
}

function normalizeMetricKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function toNullableNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasMetric(value) {
  return Number.isFinite(Number(value));
}

function hasContentSignal(row) {
  return Boolean(
    row.media_permalink ||
      row.media_caption ||
      row.media_id ||
      hasMetric(row.media_reach) ||
      hasMetric(row.media_views) ||
      hasMetric(row.media_engagement) ||
      hasMetric(row.media_saved) ||
      hasMetric(row.media_shares) ||
      hasMetric(row.media_comments_count) ||
      hasMetric(row.media_like_count)
  );
}

function nullableSum(rows, ...keys) {
  let found = false;
  const total = rows.reduce((sumValue, row) => {
    return (
      sumValue +
      keys.reduce((keyTotal, key) => {
        if (!hasMetric(row[key])) return keyTotal;
        found = true;
        return keyTotal + Number(row[key]);
      }, 0)
    );
  }, 0);
  return found ? total : null;
}

function buildChartRows({ dailyRows, mediaRows }) {
  if (dailyRows.length) {
    return {
      metric: "reach",
      rows: dailyRows.map((row) => ({
        date: row.date,
        reach: Number(row.reach) || 0
      }))
    };
  }

  const mediaMetric =
    mediaRows.some((row) => hasMetric(row.media_reach)) ? "media_reach" : mediaRows.some((row) => hasMetric(row.media_engagement)) ? "media_engagement" : mediaRows.some((row) => hasMetric(row.media_saved) || hasMetric(row.media_shares)) ? "save_share" : "";

  if (!mediaMetric) return { metric: "", rows: [] };

  return {
    metric: mediaMetric,
    rows: mediaRows
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({
        date: row.date,
        reach: mediaMetric === "save_share" ? (Number(row.media_saved) || 0) + (Number(row.media_shares) || 0) : Number(row[mediaMetric]) || 0
      }))
  };
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
  return String(value || "").trim().slice(0, 40);
}

function normalizeAccount(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, "")
    .replace(/^@/, "")
    .replace(/\/.*$/, "")
    .slice(0, 80);
}

function isDataSourceConfigured() {
  return Boolean(process.env.PHYLLO_CLIENT_ID && process.env.PHYLLO_CLIENT_SECRET);
}

async function phylloFetch(path) {
  const response = await fetch(`${phylloBaseUrl()}${path}`, {
    headers: {
      accept: "application/json",
      authorization: `Basic ${Buffer.from(`${process.env.PHYLLO_CLIENT_ID}:${process.env.PHYLLO_CLIENT_SECRET}`).toString("base64")}`
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readablePhylloError(payload, response.status));
  }
  return payload;
}

function phylloBaseUrl() {
  const environment = phylloEnvironment();
  if (process.env.PHYLLO_BASE_URL) return process.env.PHYLLO_BASE_URL;
  if (environment === "production") return "https://api.getphyllo.com";
  if (environment === "staging") return "https://api.staging.getphyllo.com";
  return "https://api.sandbox.getphyllo.com";
}

function phylloEnvironment() {
  if (process.env.PHYLLO_ENVIRONMENT === "production") return "production";
  if (process.env.PHYLLO_ENVIRONMENT === "staging") return "staging";
  return "sandbox";
}

function dataArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.result)) return payload.result;
  return [];
}

function firstData(payload) {
  return dataArray(payload)[0] || {};
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readablePhylloError(payload, status) {
  const detail = payload.message || payload.error || payload.errors || payload;
  if (typeof detail === "string") return detail;
  return `Phyllo API returned ${status}: ${JSON.stringify(detail)}`;
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

module.exports.buildReport = buildReport;
