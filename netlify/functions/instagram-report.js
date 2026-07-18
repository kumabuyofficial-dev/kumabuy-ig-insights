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
  const profile = withIndustryDefaults(getIndustryProfile(industry));
  const chartRows = buildChartRows({ dailyRows, mediaRows });
  const contentInsight = analyzeContentRows(mediaRows, profile);
  const availability = {
    hasReach: totalReach !== null,
    hasEngagement: totalEngagement !== null,
    hasSavesShares: totalSavesShares !== null,
    hasWebsiteClicks: totalWebsiteClicks !== null,
    contentCount: mediaRows.length,
    chartMetric: chartRows.metric
  };
  const topContent = mediaRows.slice(0, 5).map((row) => ({
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
  }));

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
    topContent,
    issues: buildIssues({ industry, profile, engagementRate, totalSavesShares, totalWebsiteClicks, availability, contentInsight }),
    recommendations: buildRecommendations({ industry, profile, engagementRate, totalSavesShares, totalWebsiteClicks, availability, contentInsight })
  };
}

function buildIssues({ industry, profile, engagementRate, totalSavesShares, totalWebsiteClicks, availability, contentInsight }) {
  const winningAngle = contentInsight.primaryAngle || profile.defaultAngle;
  const topSignal = contentInsight.strongestSignal || "內容反應";
  const topReference = contentInsight.topCaption ? `目前排行較前面的內容提到「${trimSentence(contentInsight.topCaption, 32)}」` : `目前可先從「${winningAngle}」觀察`;
  const issues = [
    {
      title: availability.hasReach ? profile.issueTitles.value : "部分曝光資料尚未回傳",
      body: availability.hasReach
        ? `${industry} 的受眾不是只看品項或服務名稱，通常是在確認 ${profile.customerValues.join("、")}。${profile.valueGap} 目前內容要更早講出客戶買完後的實際狀態，而不是等到影片後段才補說明。`
        : "目前已完成授權，但平台尚未回傳完整觸及或播放資料。這不代表帳號沒有曝光，診斷會先用已取得的收藏、分享、留言與內容主題判斷方向。",
      impact: "高"
    },
    {
      title: !availability.contentCount ? "近 30 天內容資料不足" : profile.issueTitles.content,
      body: !availability.contentCount
        ? "目前沒有足夠的內容列入排行。若帳號近期有發文，可能是平台資料同步尚未完成；若近期沒有發文，診斷應先從內容頻率與主題架構開始。"
        : `${topReference}，其中最值得讀的是${topSignal}。這代表觀眾對「${winningAngle}」有反應，但下一步要補上 ${profile.proofFormats.slice(0, 3).join("、")}，讓內容從被看見變成被保存、被比較或被詢問。`,
      impact: totalSavesShares !== null && totalSavesShares < 80 ? "中" : "中低"
    },
    {
      title: totalWebsiteClicks === null ? "導流資料尚未回傳" : totalWebsiteClicks <= 0 ? profile.issueTitles.conversion : "導流品質可以再分層",
      body: `${profile.conversionPath}。不要讓所有觀眾都走同一條路：剛認識的人需要收藏清單，正在比較的人需要證據，已經有需求的人需要明確的 LINE、表單或預約理由。`,
      impact: totalWebsiteClicks === null || totalWebsiteClicks <= 0 ? "高" : "中"
    }
  ];

  if (engagementRate !== null && engagementRate < 0.06) {
    issues.unshift({
      title: profile.issueTitles.hook,
      body: `目前互動偏低時，不要先要求觀眾留言，而是把開頭改成他正在猶豫的句子。${profile.decisionQuestion} 這類問題會比品牌自我介紹更容易引出停留、保存與私訊。`,
      impact: "高"
    });
  }

  return issues.slice(0, 3);
}

function buildRecommendations({ industry, profile, engagementRate, totalSavesShares, totalWebsiteClicks, availability, contentInsight }) {
  const winningAngle = contentInsight.primaryAngle || profile.defaultAngle;
  const topCaption = contentInsight.topCaption ? `排行較前面的內容有提到「${trimSentence(contentInsight.topCaption, 34)}」` : `目前可先從「${winningAngle}」切入`;
  const conversionLead = totalWebsiteClicks === null ? "目前平台尚未回傳導流資料，" : totalWebsiteClicks <= 0 ? "目前導流訊號偏弱，" : "已有導流訊號，";
  const recommendations = [
    {
      title: profile.actions.seriesTitle,
      body: `${topCaption}。下週先不要換成完全不同的主題，改成 ${profile.actions.seriesPlan}。這樣才能看出觀眾到底是被題材、證據、情境，還是下一步承諾打動。`
    },
    {
      title: profile.actions.valueTitle,
      body: `${industry} 的客戶更在意 ${profile.customerValues.join("、")}。下一批腳本要把賣點翻成「買完後會怎樣」：${profile.outcomeLine}`
    },
    {
      title: profile.actions.broadTitle,
      body: `安排一支適合接觸陌生受眾的內容，開頭接近「${profile.hookExample}」。這支先看保存、分享與留言，不急著用成交判斷，目的是找出外圈客群真的在意哪個問題。`
    },
    {
      title: profile.actions.conversionTitle,
      body: `${conversionLead}${profile.actions.conversionPlan}。結尾不要只寫歡迎詢問，要說清楚私訊或加入 LINE 後會得到什麼。`
    },
    {
      title: profile.actions.adTitle,
      body: `如果要投放，先從內容排行裡挑 ${contentInsight.adSignal || "保存、留言或分享較高"} 的主題改成廣告版。素材要在前 3 秒講清楚誰適合、為什麼現在需要看、下一步去哪裡，不要只把自然貼文直接加預算。`
    },
    {
      title: "補上讓人放心比較的證據",
      body: `下週至少補一支 ${profile.proofFormats[0]} 或 ${profile.proofFormats[1]}。台灣消費者常會先比較、查證、觀望，內容要讓他知道你不是只會說，而是真的能降低他的選擇風險。`
    },
    {
      title: "把標題改成客戶會搜尋的句子",
      body: `${profile.marketAngle}。標題盡量避開品牌自我介紹，改成客戶私下會問的問題，例如價格、適不適合、差異、風險、使用後的生活改變。`
    }
  ];

  if (engagementRate !== null && engagementRate < 0.06) {
    recommendations.unshift({
      title: profile.actions.hookTitle,
      body: `下週每支影片開頭都先回答一個明確問題，例如「${profile.hookExample}」。先讓觀眾覺得這支內容跟他現在的選擇有關，再進入品牌或服務說明。`
    });
  }

  if (totalSavesShares !== null && totalSavesShares < 80) {
    recommendations.push({
      title: profile.actions.saveTitle,
      body: `至少安排一篇 ${profile.proofFormats[2]}。目標不是把資訊塞滿，而是讓觀眾看完覺得「這個我之後會用到」，自然提高保存與分享。`
    });
  }

  return recommendations.slice(0, 5);
}

function getIndustryProfile(industry) {
  const text = industry.toLowerCase();

  if (matchAny(text, ["小吃", "攤商", "夜市", "早餐店", "便當", "飲料店", "鹽酥雞", "滷味"])) {
    return {
      proofFormats: ["必點品項清單", "排隊與出餐動線", "價格份量實拍", "附近地標路線"],
      conversionPath: "小吃攤商內容應導向地圖、營業時間、今日品項、外帶預訂或 LINE 點餐，而不是只做品牌印象",
      marketAngle: "小吃攤商的社群決策很短，觀眾通常想知道現在能不能買、值不值得繞過去、第一次點什麼不踩雷",
      hookExample: "第一次來這攤，先點這一袋就夠懂",
      customerValues: ["快速解饞", "不踩雷", "份量划算", "在地感"],
      defaultAngle: "必點與即時到店",
      decisionQuestion: "現在去買方便嗎、第一次該點什麼、排隊值不值得",
      valueGap: "小吃內容若只拍成品，觀眾很難判斷份量、等待時間與到店理由。",
      outcomeLine: "讓觀眾知道這一餐能解決什麼情境：下班順路買、宵夜解饞、朋友一起分食、或第一次來不會點錯。",
      issueTitles: {
        value: "到店理由還不夠即時",
        content: "排行內容還沒放大必點記憶點",
        conversion: "看完後不知道怎麼買",
        hook: "開頭還沒抓住想吃的瞬間"
      },
      actions: {
        hookTitle: "先把前三秒拍成「現在想吃」",
        seriesTitle: "把排行題材延伸成必點系列",
        seriesPlan: "一支拍招牌品項、一支拍份量與價格、一支拍從附近地標走到攤位",
        valueTitle: "把小吃價值講成當下情境",
        broadTitle: "測一支容易被朋友轉傳的品項",
        conversionTitle: "把購買資訊集中到同一個入口",
        conversionPlan: "每支內容固定出現營業時間、地點、今日供應、外帶方式或 LINE 點餐入口",
        adTitle: "用招牌品項測附近客群",
        saveTitle: "做一篇第一次來不踩雷清單"
      }
    };
  }

  if (matchAny(text, ["餐飲", "咖啡", "甜點", "火鍋", "早午餐", "餐酒", "酒吧", "餐廳"])) {
    return {
      proofFormats: ["聚餐情境菜單", "客人回訪案例", "套餐與客單拆解", "座位氛圍實拍"],
      conversionPath: "餐飲類內容應導向訂位、外帶、地圖導航或 LINE 菜單，而不是只導向品牌介紹",
      marketAngle: "餐廳品牌的競爭不只在好吃，而是在聚餐目的、客單是否合理、環境是否適合拍照與帶人來",
      hookExample: "這間店最適合的不是隨便吃飯，而是這 3 種聚餐情境",
      customerValues: ["聚會有面子", "好吃不踩雷", "氣氛到位", "預算可控"],
      defaultAngle: "聚餐情境與訂位理由",
      decisionQuestion: "這間店適合約誰、花這個客單值不值得、需不需要先訂位",
      valueGap: "餐廳內容若只拍菜色，觀眾會記得好看，但不一定知道哪一天、跟誰、為什麼該訂位。",
      outcomeLine: "讓觀眾想像吃完後的結果：聚餐不尷尬、招待有面子、拍照有質感、預算不失控。",
      issueTitles: {
        value: "聚餐理由還沒有說清楚",
        content: "排行內容還沒變成訂位理由",
        conversion: "看完後沒有被推向訂位或菜單",
        hook: "開頭還沒切中聚餐需求"
      },
      actions: {
        hookTitle: "先用聚餐情境重寫開頭",
        seriesTitle: "把排行題材延伸成聚餐決策系列",
        seriesPlan: "一支講適合誰聚餐、一支講客單與必點組合、一支講訂位前要知道的座位與時間",
        valueTitle: "把餐點翻成一場聚餐的結果",
        broadTitle: "測一支能被揪朋友看的內容",
        conversionTitle: "把訂位理由放到同一個入口",
        conversionPlan: "每支內容固定導向訂位、菜單、LINE 詢問包廂或外帶資訊，讓想約人的觀眾不用再自己找",
        adTitle: "用聚餐場景投放，不只投漂亮菜色",
        saveTitle: "做一篇聚餐點餐清單"
      }
    };
  }

  if (matchAny(text, ["醫美", "診所", "牙醫", "皮膚", "健康", "中醫"])) {
    return {
      proofFormats: ["流程拆解", "術前術後注意事項", "常見迷思破解", "專業人員說明"],
      conversionPath: "醫療與健康相關內容應導向預約諮詢與風險說明，避免過度承諾效果",
      marketAngle: "使用者更在意安全、風險、恢復期、價格透明與真實案例，內容要降低不確定感",
      hookExample: "做療程前，先確認這 3 件事再預約",
      customerValues: ["安心感", "專業可信", "變美或變健康的把握", "降低踩雷風險"],
      defaultAngle: "安全與效果疑慮",
      decisionQuestion: "這個療程或服務適不適合我，風險在哪裡"
    };
  }

  if (matchAny(text, ["美業", "髮", "美甲", "美容", "睫毛", "紋繡"])) {
    return {
      proofFormats: ["前後對比", "風格分類", "價格與維持期", "客人改造案例"],
      conversionPath: "美業內容應導向預約、作品集與 LINE 詢問檔期",
      marketAngle: "美業決策高度依賴風格信任與成果想像，內容要讓客人快速判斷自己適不適合",
      hookExample: "臉型偏圓的人，這種髮型最容易顯臉小",
      customerValues: ["變好看", "被稱讚", "風格認同", "提升自信"],
      defaultAngle: "適合自己的風格",
      decisionQuestion: "這個風格放在我身上會不會好看、好不好維持"
    };
  }

  if (matchAny(text, ["補習", "教育", "課程", "教學", "學校", "語言"])) {
    return {
      proofFormats: ["學習成果", "課程路徑", "家長常見問題", "前後測比較"],
      conversionPath: "教育類內容應導向試聽、課程諮詢或程度檢測",
      marketAngle: "家長與學員重視成果、師資、陪跑方式與是否適合自己程度，內容要降低報名風險",
      hookExample: "孩子成績卡住，通常不是不努力，而是少了這一步",
      customerValues: ["看得見進步", "少走冤枉路", "成就感", "家長安心"],
      defaultAngle: "學習卡關原因",
      decisionQuestion: "這門課是否真的能解決我現在的程度問題"
    };
  }

  if (matchAny(text, ["房仲", "建設", "代銷", "室內設計", "裝修", "建築"])) {
    return {
      proofFormats: ["案例前後對比", "預算拆解", "流程節點", "避雷清單"],
      conversionPath: "高單價服務應導向諮詢表單、案例頁與 LINE 初談",
      marketAngle: "高單價決策週期長，內容要建立專業信任、透明流程與風險控管",
      hookExample: "簽約前沒問這 5 件事，後面最容易追加預算",
      customerValues: ["降低風險", "資產安全", "生活品質升級", "專業把關"],
      defaultAngle: "高單價避雷",
      decisionQuestion: "這筆錢花下去會不會後悔，流程透明嗎"
    };
  }

  if (matchAny(text, ["電商", "品牌", "商品", "服飾", "保養", "食品", "生活用品", "零售", "選物"])) {
    return {
      proofFormats: ["使用情境", "開箱實測", "顧客評價", "比較表"],
      conversionPath: "商品類內容應導向商品頁、限時優惠、LINE 社群或再行銷名單",
      marketAngle: "電商品牌需要用短影音縮短理解時間，讓消費者快速知道差異、場景與購買理由",
      hookExample: "這個商品不是給所有人，是給有這個困擾的人",
      customerValues: ["生活更方便", "品味提升", "少買錯", "日常被照顧"],
      defaultAngle: "使用情境與比較",
      decisionQuestion: "我為什麼要買這個，而不是買便宜或常見的替代品"
    };
  }

  if (matchAny(text, ["旅宿", "飯店", "民宿", "觀光", "旅行", "露營", "景點"])) {
    return {
      proofFormats: ["房型與動線實拍", "行程安排", "交通與預算拆解", "真實住客體驗"],
      conversionPath: "旅宿與觀光內容應導向訂房頁、LINE 詢問空房、套裝行程或收藏清單",
      marketAngle: "旅遊消費重視期待感與安全感，內容要同時處理景色想像、交通便利、價格是否值得與適合誰去",
      hookExample: "這個地方適合放空，但不適合想跑很多景點的人",
      customerValues: ["放鬆感", "回憶感", "拍照分享", "安排省心"],
      defaultAngle: "適合情境與體驗期待",
      decisionQuestion: "這趟旅行適不適合我的預算、同行對象與時間",
      valueGap: "旅宿與觀光內容如果只拍漂亮畫面，觀眾會有感覺，但不一定能判斷要不要訂、適合誰去、怎麼安排。",
      outcomeLine: "讓觀眾先看見旅行後的狀態：有人幫他省規劃時間、同行的人玩得順、照片好看、休息真的有充到電。",
      issueTitles: {
        value: "期待感有了，決策資訊還不夠",
        content: "排行內容還沒整理成行程理由",
        conversion: "看完後不知道如何查空房或安排",
        hook: "開頭還沒說出適合誰去"
      },
      actions: {
        hookTitle: "先說清楚這趟適合誰",
        seriesTitle: "把排行題材延伸成一組行程參考",
        seriesPlan: "一支講適合的同行對象、一支講交通與預算、一支講入住或遊玩後的真實感受",
        valueTitle: "把景點翻成旅人想得到的狀態",
        broadTitle: "測一支讓人想收藏排行程的內容",
        conversionTitle: "把空房與行程詢問放到同一個入口",
        conversionPlan: "每支內容固定導向空房詢問、訂房頁、套裝行程、交通清單或 LINE 諮詢，不要只停在風景介紹",
        adTitle: "用明確旅遊情境放大素材",
        saveTitle: "做一篇兩天一夜或半日行程清單"
      }
    };
  }

  if (matchAny(text, ["健身", "瑜珈", "運動", "體態", "減脂", "營養", "保健"])) {
    return {
      proofFormats: ["成果紀錄", "動作教學", "菜單拆解", "錯誤姿勢示範"],
      conversionPath: "健身與保健內容應導向體驗課、初步評估、LINE 問卷或會員方案",
      marketAngle: "健康與體態內容不能只賣焦慮，要讓觀眾相信自己做得到，並知道下一步從哪裡開始",
      hookExample: "你不是沒毅力，是訓練順序一開始就排錯了",
      customerValues: ["自律成就感", "身體變好", "外型自信", "有人陪跑"],
      defaultAngle: "可達成的改變",
      decisionQuestion: "我這種狀況能不能開始，多久會看到變化"
    };
  }

  if (matchAny(text, ["親子", "母嬰", "兒童", "寵物", "毛孩", "幼兒"])) {
    return {
      proofFormats: ["情境示範", "安全說明", "使用前後差異", "新手常見問題"],
      conversionPath: "親子與寵物內容應導向 LINE 諮詢、產品清單、預約體驗或照護指南",
      marketAngle: "這類客戶最在意安心與被理解，內容要少一點硬賣，多處理照顧者的焦慮、選擇困難與安全疑慮",
      hookExample: "新手最容易忽略的不是用品，而是這個使用情境",
      customerValues: ["安心照顧", "少犯錯", "被理解", "家人生活更順"],
      defaultAngle: "新手照顧疑慮",
      decisionQuestion: "這個選擇對孩子、家人或毛孩是否安全合適"
    };
  }

  if (matchAny(text, ["金融", "保險", "理財", "貸款", "會計", "稅務"])) {
    return {
      proofFormats: ["案例情境", "費用與風險比較", "流程圖", "常見錯誤清單"],
      conversionPath: "金融與專業服務應導向初步評估、預約諮詢或需求表單，不適合只導向追蹤",
      marketAngle: "使用者害怕聽不懂、被推銷或做錯決策，內容要把複雜選擇翻成清楚情境與風險提醒",
      hookExample: "買之前先看懂這一點，才不會保障和需求對不上",
      customerValues: ["安全感", "少犯錯", "財務掌控感", "專業有人把關"],
      defaultAngle: "風險與選擇比較",
      decisionQuestion: "我現在的狀況需要哪一種方案，會不會買錯"
    };
  }

  if (matchAny(text, ["地方", "水電", "清潔", "搬家", "維修", "家事", "居家", "汽車", "機車"])) {
    return {
      proofFormats: ["前後對比", "流程透明", "價格範圍", "常見問題處理"],
      conversionPath: "地方生活服務應導向 LINE 報價、預約時間、服務範圍與案例頁",
      marketAngle: "在地服務的關鍵是可信、快速、價格透明。內容要讓觀眾知道你處理過類似問題，也知道聯絡後會怎麼進行",
      hookExample: "遇到這種狀況，先不要急著花大錢換新",
      customerValues: ["省麻煩", "快速解決", "價格安心", "有人可靠"],
      defaultAngle: "問題快速解決",
      decisionQuestion: "找你來處理會不會更快、更透明、更不踩雷"
    };
  }

  if (matchAny(text, ["顧問", "行銷", "b2b", "企業", "軟體", "系統", "會計", "法律"])) {
    return {
      proofFormats: ["案例拆解", "流程圖", "成本比較", "決策清單"],
      conversionPath: "B2B 與顧問服務應導向評估表、預約諮詢或案例下載",
      marketAngle: "B2B 決策者重視問題成本、導入風險與可衡量成果，內容要從痛點與 ROI 切入",
      hookExample: "如果你每月還在手動整理這件事，代表流程已經在漏錢",
      customerValues: ["效率提升", "降低成本", "決策有依據", "專業被支援"],
      defaultAngle: "營運痛點與成本",
      decisionQuestion: "這個服務能不能替我省時間、降風險或創造明確成果"
    };
  }

  return {
    proofFormats: ["案例拆解", "常見問題", "流程說明", "比較清單"],
    conversionPath: "服務型業主應導向 LINE 諮詢、評估表或預約表單，避免只停留在曝光",
    marketAngle: "現在使用者會先比較、查證、觀望，內容需要同時處理信任、差異與下一步行動",
    hookExample: "大多數人卡住不是因為沒需求，而是不知道第一步怎麼選",
    customerValues: ["少踩雷", "更安心", "更有效率", "得到專業協助"],
    defaultAngle: "選擇前的疑慮",
    decisionQuestion: "我為什麼要現在找你，而不是先觀望或找別家"
  };
}

function matchAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function withIndustryDefaults(profile) {
  const defaultIssueTitles = {
    value: "觀眾需要更快看見購買理由",
    content: "已有可延伸的內容角度",
    conversion: "看完後的下一步不夠清楚",
    hook: "互動誘因還不夠貼近決策場景"
  };
  const defaultActions = {
    hookTitle: "先重寫前三秒",
    seriesTitle: `把「${profile.defaultAngle || "選擇前的疑慮"}」做成一組系列`,
    seriesPlan: "一支講常見誤解、一支講實際選擇方式、一支講使用後能得到的改變",
    valueTitle: "把價值翻成顧客想要的結果",
    broadTitle: "用一支影片測大眾有感題材",
    conversionTitle: "把有需求的人導到同一個入口",
    conversionPlan: "至少 2 支內容要明確告訴觀眾私訊或加入 LINE 後能拿到什麼，例如比較表、報價前評估、案例清單或預約名額",
    adTitle: "先挑一支適合放大的素材",
    saveTitle: "每週固定一篇可保存內容"
  };

  return {
    proofFormats: profile.proofFormats || ["案例拆解", "常見問題", "流程說明", "比較清單"],
    conversionPath: profile.conversionPath || "內容應導向 LINE 諮詢、評估表、案例頁或預約表單，避免只停留在曝光",
    marketAngle: profile.marketAngle || "台灣消費者會先比較、查證、觀望，內容需要同時處理信任、差異與下一步行動",
    hookExample: profile.hookExample || "大多數人卡住不是因為沒需求，而是不知道第一步怎麼選",
    customerValues: profile.customerValues || ["少踩雷", "更安心", "更有效率", "得到專業協助"],
    defaultAngle: profile.defaultAngle || "選擇前的疑慮",
    decisionQuestion: profile.decisionQuestion || "我為什麼要現在找你，而不是先觀望或找別家",
    valueGap: profile.valueGap || "內容若只介紹產品或服務，觀眾會知道你在賣什麼，但不一定知道為什麼現在需要你。",
    outcomeLine: profile.outcomeLine || "讓觀眾知道購買後能更安心、更有效率、少踩雷，或更快做出正確選擇。",
    issueTitles: { ...defaultIssueTitles, ...(profile.issueTitles || {}) },
    actions: { ...defaultActions, ...(profile.actions || {}) }
  };
}

function analyzeContentRows(rows, profile) {
  if (!rows.length) {
    return {
      primaryAngle: profile.defaultAngle,
      topCaption: "",
      strongestSignal: "",
      hasContent: false
    };
  }

  const scored = rows.map((row) => {
    const caption = String(row.media_caption || "");
    const angle = classifyContentAngle(caption, profile);
    return {
      caption,
      angle,
      signal: strongestContentSignal(row),
      score: metricScore(row)
    };
  });

  const angleScores = scored.reduce((totals, item) => {
    totals[item.angle] = (totals[item.angle] || 0) + item.score + 1;
    return totals;
  }, {});
  const primaryAngle = Object.entries(angleScores).sort((a, b) => b[1] - a[1])[0]?.[0] || profile.defaultAngle;
  const top = scored.sort((a, b) => b.score - a.score)[0];

  return {
    primaryAngle,
    topCaption: top?.caption || "",
    strongestSignal: top?.signal || "",
    adSignal: top?.signal ? `${top.signal}較明確` : "",
    hasContent: true
  };
}

function classifyContentAngle(caption, profile) {
  const text = String(caption || "").toLowerCase();
  if (matchAny(text, ["不要", "錯", "雷", "失敗", "後悔", "避免", "注意", "小心", "問題"])) return "避雷與風險提醒";
  if (matchAny(text, ["比較", "差異", "vs", "哪個", "選", "適合", "推薦", "清單"])) return "選擇比較";
  if (matchAny(text, ["前後", "成果", "案例", "變化", "實測", "回饋", "見證"])) return "成果與信任證據";
  if (matchAny(text, ["流程", "步驟", "怎麼", "教學", "懶人包", "攻略", "指南"])) return "流程教學";
  if (matchAny(text, ["價格", "費用", "預算", "划算", "便宜", "貴", "成本"])) return "價格與預算";
  if (matchAny(text, ["療癒", "質感", "生活", "儀式", "氛圍", "放鬆", "品味", "日常"])) return "生活與情緒價值";
  return profile.defaultAngle;
}

function strongestContentSignal(row) {
  const signals = [
    ["保存", row.media_saved, 5],
    ["分享", row.media_shares, 5],
    ["留言", row.media_comments_count, 4],
    ["按讚", row.media_like_count, 2],
    ["觀看", row.media_views || row.media_reach, 0.15]
  ].filter(([, value]) => hasMetric(value));
  if (!signals.length) return "";
  return signals.sort((a, b) => Number(b[1]) * b[2] - Number(a[1]) * a[2])[0][0];
}

function trimSentence(value, maxLength) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength)}...`;
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
