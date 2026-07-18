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
  const diagnosis = diagnoseAccount({
    mediaRows,
    totalReach,
    totalMediaReach,
    totalEngagement,
    totalSavesShares,
    totalWebsiteClicks,
    engagementRate,
    availability,
    contentInsight
  });
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
    issues: buildIssues({ industry, profile, engagementRate, totalSavesShares, totalWebsiteClicks, availability, contentInsight, diagnosis }),
    recommendations: buildRecommendations({ industry, profile, engagementRate, totalSavesShares, totalWebsiteClicks, availability, contentInsight, diagnosis })
  };
}

function buildIssues({ industry, profile, engagementRate, totalSavesShares, totalWebsiteClicks, availability, contentInsight, diagnosis }) {
  const winningAngle = contentInsight.primaryAngle || profile.defaultAngle;
  const topSignal = contentInsight.strongestSignal || "內容反應";
  const topReference = contentInsight.topCaption ? `目前排行較前面的內容提到「${trimSentence(contentInsight.topCaption, 32)}」` : `目前可先從「${winningAngle}」觀察`;
  const issueLibrary = {
    noContent: {
      title: "近 30 天內容資料不足",
      body: "目前沒有足夠的內容列入排行。若帳號近期有發文，可能是平台資料同步尚未完成；若近期沒有發文，診斷應先從內容頻率、主題架構與固定更新節奏開始。",
      impact: "高"
    },
    dataPartial: {
      title: "部分曝光資料尚未回傳",
      body: "目前已完成授權，但平台尚未回傳完整觸及或播放資料。這不代表帳號沒有曝光，診斷會先用已取得的收藏、分享、留言與內容主題判斷方向。",
      impact: "中"
    },
    hook: {
      title: profile.issueTitles.hook,
      body: `目前內容比較像在介紹「你有什麼」，但觀眾更快想確認的是 ${profile.customerValues.slice(0, 2).join("、")}。開頭要先處理「${profile.decisionQuestion}」，再進入服務或商品說明。`,
      impact: "高"
    },
    save: {
      title: profile.issueTitles.content,
      body: `${topReference}，但保存與分享訊號還不夠穩。這代表內容可能有被看見，卻還沒整理成觀眾會拿來比較、收藏或轉傳的資訊，例如 ${profile.proofFormats.slice(0, 3).join("、")}。`,
      impact: "高"
    },
    trust: {
      title: "信任證據還沒有跟上興趣",
      body: `${topReference}，其中最值得讀的是${topSignal}。觀眾已經對「${winningAngle}」有反應，下一步要補實際案例、流程、價格或適合條件，否則容易停在覺得有趣但不敢詢問。`,
      impact: "中"
    },
    conversion: {
      title: totalWebsiteClicks === null ? "導流資料尚未回傳" : profile.issueTitles.conversion,
      body: `${profile.conversionPath}。目前比較像讓觀眾看完內容就離開，應把不同成熟度的人分開承接：剛認識的人收藏清單，正在比較的人看證據，已有需求的人進 LINE、表單或預約。`,
      impact: "高"
    },
    narrow: {
      title: "內容題材還太集中",
      body: `目前排行內容多集中在「${winningAngle}」。這不是壞事，但若每支都用同一種角度，系統很難判斷受眾到底被題材、證據、情境還是價格打動。`,
      impact: "中"
    },
    scale: {
      title: "可以開始把有效題材變成放大素材",
      body: `${topReference}，且帳號已有可讀的互動訊號。接下來不要只看單支成效，應把高反應題材改成短影音、圖文、廣告素材與 LINE 承接頁，讓流量能往下走。`,
      impact: "中"
    },
    value: {
      title: profile.issueTitles.value,
      body: `${industry} 的受眾不是只看品項或服務名稱，通常是在確認 ${profile.customerValues.join("、")}。${profile.valueGap} 目前內容要更早講出客戶買完後的實際狀態。`,
      impact: "高"
    }
  };
  const issues = diagnosis.issueKeys.map((key) => issueLibrary[key]).filter(Boolean);

  if (engagementRate !== null && engagementRate < 0.06) {
    issues.unshift(issueLibrary.hook);
  }

  return uniqueByTitle(issues).slice(0, 3);
}

function buildRecommendations({ industry, profile, engagementRate, totalSavesShares, totalWebsiteClicks, availability, contentInsight, diagnosis }) {
  const winningAngle = contentInsight.primaryAngle || profile.defaultAngle;
  const topCaption = contentInsight.topCaption ? `排行較前面的內容有提到「${trimSentence(contentInsight.topCaption, 34)}」` : `目前可先從「${winningAngle}」切入`;
  const conversionLead = totalWebsiteClicks === null ? "目前平台尚未回傳導流資料，" : totalWebsiteClicks <= 0 ? "目前導流訊號偏弱，" : "已有導流訊號，";
  const actionLibrary = {
    hook: {
      title: profile.actions.hookTitle,
      body: `下週先重寫 3 支內容的前三秒。不要從品牌、品項或活動開始，改從「${profile.decisionQuestion}」這種猶豫切入，讓觀眾先覺得這支內容跟自己有關。`
    },
    series: {
      title: profile.actions.seriesTitle,
      body: `${topCaption}。下週先不要換成完全不同的主題，改成 ${profile.actions.seriesPlan}。這樣才能看出觀眾到底是被題材、證據、情境，還是下一步承諾打動。`
    },
    value: {
      title: profile.actions.valueTitle,
      body: `${industry} 的客戶更在意 ${profile.customerValues.join("、")}。下一批腳本要把賣點翻成「買完後會怎樣」：${profile.outcomeLine}`
    },
    broad: {
      title: profile.actions.broadTitle,
      body: `安排一支適合接觸陌生受眾的內容，開頭接近「${profile.hookExample}」。這支先看保存、分享與留言，不急著用成交判斷，目的是找出外圈客群真的在意哪個問題。`
    },
    conversion: {
      title: profile.actions.conversionTitle,
      body: `${conversionLead}${profile.actions.conversionPlan}。結尾不要只寫歡迎詢問，要說清楚私訊或加入 LINE 後會得到什麼。`
    },
    ad: {
      title: profile.actions.adTitle,
      body: `如果要投放，先從內容排行裡挑 ${contentInsight.adSignal || "保存、留言或分享較高"} 的主題改成廣告版。素材要在前 3 秒講清楚誰適合、為什麼現在需要看、下一步去哪裡，不要只把自然貼文直接加預算。`
    },
    proof: {
      title: "補上讓人放心比較的證據",
      body: `下週至少補一支 ${profile.proofFormats[0]} 或 ${profile.proofFormats[1]}。台灣消費者常會先比較、查證、觀望，內容要讓他知道你不是只會說，而是真的能降低他的選擇風險。`
    },
    search: {
      title: "把標題改成客戶會搜尋的句子",
      body: `${profile.marketAngle}。標題盡量避開品牌自我介紹，改成客戶私下會問的問題，例如價格、適不適合、差異、風險、使用後的生活改變。`
    },
    save: {
      title: profile.actions.saveTitle,
      body: `至少安排一篇 ${profile.proofFormats[2]}。目標不是把資訊塞滿，而是讓觀眾看完覺得「這個我之後會用到」，自然提高保存與分享。`
    },
    cadence: {
      title: "先把內容節奏補穩",
      body: `近 30 天可判讀內容偏少時，不要先追求爆款。下週先排 3 支固定欄位：一支回答「${profile.decisionQuestion}」、一支做 ${profile.proofFormats[0]}、一支導向 ${profile.conversionPath.replace(/^.*?應導向/, "").replace(/，.*$/, "")}。`
    }
  };

  const recommendations = diagnosis.actionKeys.map((key) => actionLibrary[key]).filter(Boolean);

  return uniqueByTitle(recommendations).slice(0, 5);
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

  if (matchAny(text, ["咖啡", "甜點", "蛋糕", "麵包", "烘焙", "下午茶"])) {
    return {
      proofFormats: ["招牌品項口味拆解", "適合時段與情境", "外帶禮盒實拍", "店內座位氛圍"],
      conversionPath: "咖啡甜點內容應導向訂位、外帶預留、禮盒訂購、地圖導航或 LINE 詢問口味與檔期",
      marketAngle: "咖啡甜點不只賣好吃，還賣放鬆、療癒、送禮體面與拍照分享。內容要讓觀眾知道這間店適合獨處、約會、聚會還是送禮。",
      hookExample: "如果你只是想找一間安靜坐一下，這種甜點組合最不容易踩雷",
      customerValues: ["療癒放鬆", "生活品味", "送禮體面", "拍照分享"],
      defaultAngle: "療癒情境與招牌品項",
      decisionQuestion: "這間店適合坐多久、點什麼、能不能外帶或送禮",
      valueGap: "甜點與咖啡內容若只拍美照，觀眾會覺得漂亮，但不一定知道適合什麼場合或該點哪一款。",
      outcomeLine: "讓觀眾知道買完後得到的是一段放鬆時間、一份有面子的禮，或一次不尷尬的約會選擇。",
      issueTitles: {
        value: "情境價值還沒有說完整",
        content: "排行內容還沒變成招牌記憶點",
        conversion: "看完後不知道如何預留或到店",
        hook: "開頭還沒切中療癒或送禮需求"
      },
      actions: {
        hookTitle: "先把前三秒改成使用情境",
        seriesTitle: "把排行題材延伸成招牌品項系列",
        seriesPlan: "一支講適合誰吃、一支講口味與價格、一支講外帶送禮或店內座位情境",
        valueTitle: "把甜點咖啡翻成生活片刻",
        broadTitle: "測一支讓人想約朋友的內容",
        conversionTitle: "把到店與外帶資訊集中",
        conversionPlan: "每支內容固定導向地圖、營業時間、口味預留、禮盒訂購或 LINE 詢問",
        adTitle: "用情境素材測附近與送禮客群",
        saveTitle: "做一篇第一次來點餐清單"
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

  if (matchAny(text, ["牙醫", "齒顎", "植牙", "矯正"])) {
    return {
      proofFormats: ["療程流程圖", "術前評估重點", "案例前後差異", "費用與期程說明"],
      conversionPath: "牙醫內容應導向初診評估、預約表單、LINE 諮詢或療程說明頁，避免只做成果展示",
      marketAngle: "牙醫決策週期長，患者在意痛不痛、花多久、費用怎麼算、醫師是否可信。內容要把恐懼與未知拆小。",
      hookExample: "想做矯正前，先看懂這 3 件事再約諮詢",
      customerValues: ["安心治療", "笑容自信", "費用可預期", "長期健康"],
      defaultAngle: "治療疑慮與評估流程",
      decisionQuestion: "我適不適合做、會不會痛、費用和時間能不能負擔",
      valueGap: "牙科內容若只放前後對比，患者仍然不知道自己能不能做、流程多長、風險在哪裡。",
      outcomeLine: "讓患者知道治療後能更敢笑、咀嚼更穩、問題被完整評估，而不是只看到漂亮成果照。",
      issueTitles: {
        value: "患者疑慮還沒被拆開",
        content: "排行內容還沒變成初診理由",
        conversion: "看完後不知道如何預約評估",
        hook: "開頭還沒回答患者最怕的問題"
      },
      actions: {
        hookTitle: "先回答患者最怕的問題",
        seriesTitle: "把排行題材延伸成初診前檢查系列",
        seriesPlan: "一支講適合條件、一支講流程與時間、一支講費用區間與常見誤解",
        valueTitle: "把療程翻成生活改善",
        broadTitle: "測一支患者會轉給家人的疑問",
        conversionTitle: "把評估入口說清楚",
        conversionPlan: "每支內容固定導向初診預約、LINE 諮詢、療程說明或檢查清單",
        adTitle: "用疑慮解答素材測高意圖客群",
        saveTitle: "做一篇初診前準備清單"
      }
    };
  }

  if (matchAny(text, ["中醫", "健康", "漢方", "調理", "復健", "物理治療"])) {
    return {
      proofFormats: ["症狀情境拆解", "調理流程", "生活習慣建議", "適合與不適合說明"],
      conversionPath: "中醫健康內容應導向初步諮詢、預約評估、生活檢測或 LINE 問卷",
      marketAngle: "健康調理內容要避免誇大，重點是讓觀眾理解自己的狀況、知道何時該評估，並建立長期信任。",
      hookExample: "你以為只是累，其實可能是這三種生活型態造成",
      customerValues: ["身體穩定", "有人判斷", "少亂試", "長期安心"],
      defaultAngle: "症狀背後的生活原因",
      decisionQuestion: "我的狀況該不該看、能不能改善、需要多久",
      valueGap: "健康內容若只講服務項目，觀眾無法對照自己的症狀，也不知道什麼時候該預約。",
      outcomeLine: "讓觀眾知道不是被推銷療程，而是有人幫他判斷狀況、調整生活，逐步找回穩定感。",
      issueTitles: {
        value: "症狀和服務還沒有接起來",
        content: "排行內容還沒形成健康判斷框架",
        conversion: "看完後不知道如何初步評估",
        hook: "開頭還沒切中身體困擾"
      },
      actions: {
        hookTitle: "先用症狀情境開頭",
        seriesTitle: "把排行題材延伸成自我檢查系列",
        seriesPlan: "一支講常見症狀、一支講生活原因、一支講什麼情況該預約評估",
        valueTitle: "把健康服務翻成穩定生活",
        broadTitle: "測一支容易被家人轉傳的健康提醒",
        conversionTitle: "把初步評估入口放清楚",
        conversionPlan: "每支內容固定導向 LINE 問卷、預約評估、症狀清單或衛教文章",
        adTitle: "用單一症狀素材測需求客群",
        saveTitle: "做一篇症狀觀察清單"
      }
    };
  }

  if (matchAny(text, ["醫美", "診所", "牙醫", "皮膚", "健康", "中醫"])) {
    return {
      proofFormats: ["療程適合條件", "恢復期與風險說明", "術前術後注意事項", "真實案例拆解"],
      conversionPath: "醫美診所內容應導向預約諮詢、適合度評估、風險說明與案例頁，避免過度承諾效果",
      marketAngle: "醫美消費者會跨 IG、Threads、Dcard 查證，現在更在意細節微調、安全感、恢復期與價格透明。",
      hookExample: "想做臉部微調前，先確認你是不是這 3 種狀況",
      customerValues: ["變好看但自然", "安心感", "專業可信", "降低踩雷風險"],
      defaultAngle: "適合度與安全疑慮",
      decisionQuestion: "這個療程適不適合我、風險在哪裡、恢復期能不能接受",
      valueGap: "醫美內容若只放效果照，觀眾仍然不知道自己適不適合，也會擔心過度推銷或效果不自然。",
      outcomeLine: "讓觀眾知道可以更自然地改善在意的地方，同時理解風險、恢復期與諮詢流程。",
      issueTitles: {
        value: "適合度與安全感還不夠",
        content: "排行內容還沒變成諮詢理由",
        conversion: "看完後不知道如何做適合度評估",
        hook: "開頭還沒處理療程猶豫"
      },
      actions: {
        hookTitle: "先用適合與不適合開場",
        seriesTitle: "把排行題材延伸成療程判斷系列",
        seriesPlan: "一支講適合條件、一支講恢復期與風險、一支講案例拆解與諮詢前準備",
        valueTitle: "把療程翻成自然改善",
        broadTitle: "測一支會被朋友私下轉傳的疑問",
        conversionTitle: "把諮詢前評估入口說清楚",
        conversionPlan: "每支內容固定導向 LINE 初評、預約諮詢、案例頁或注意事項清單",
        adTitle: "用疑慮解答素材做名單投放",
        saveTitle: "做一篇療程前檢查清單"
      }
    };
  }

  if (matchAny(text, ["髮廊", "髮", "剪髮", "染髮", "燙髮", "造型"])) {
    return {
      proofFormats: ["臉型髮型對照", "染燙前後對比", "整理難度說明", "設計師作品分類"],
      conversionPath: "髮廊內容應導向設計師作品集、LINE 預約、價格區間與檔期詢問",
      marketAngle: "髮廊決策看的是信任與想像：客人要先知道這個設計師懂不懂自己的臉型、風格與整理習慣。",
      hookExample: "如果你早上不想花太多時間整理，這種髮型先不要急著剪",
      customerValues: ["變好看", "好整理", "被稱讚", "風格更像自己"],
      defaultAngle: "適合臉型與整理難度",
      decisionQuestion: "這個髮型適不適合我、會不會難整理、設計師懂不懂我的風格",
      valueGap: "髮廊內容若只放成品照，客人很難判斷自己做完會不會一樣好看，也不知道日常好不好整理。",
      outcomeLine: "讓客人知道改完後不只變好看，還能更好整理、更像自己、出門更有自信。",
      issueTitles: {
        value: "風格適合度還沒說清楚",
        content: "排行內容還沒變成預約理由",
        conversion: "看完後不知道找誰預約",
        hook: "開頭還沒講出髮型痛點"
      },
      actions: {
        hookTitle: "先用臉型或整理困擾開頭",
        seriesTitle: "把排行題材延伸成風格判斷系列",
        seriesPlan: "一支講適合臉型、一支講整理難度、一支講設計師建議與預約前溝通",
        valueTitle: "把髮型翻成日常自信",
        broadTitle: "測一支會被朋友標記的髮型題材",
        conversionTitle: "把設計師與檔期入口說清楚",
        conversionPlan: "每支內容固定導向設計師作品集、LINE 預約、價格區間或檔期詢問",
        adTitle: "用前後對比測風格客群",
        saveTitle: "做一篇髮型整理清單"
      }
    };
  }

  if (matchAny(text, ["美業", "髮", "美甲", "美容", "睫毛", "紋繡"])) {
    return {
      proofFormats: ["款式維持期", "前後對比", "價格與耗時", "客人風格案例"],
      conversionPath: "美容美甲內容應導向作品集、LINE 預約、價目表、檔期與保養注意事項",
      marketAngle: "美容美甲的內容重點是風格信任、細節精緻度與維持期。客人要先想像自己做完後的氣質與生活場合。",
      hookExample: "如果你想要看起來乾淨但不誇張，這種款式最安全",
      customerValues: ["精緻感", "被稱讚", "風格認同", "維持漂亮"],
      defaultAngle: "風格細節與維持期",
      decisionQuestion: "這個款式適不適合我、能維持多久、價格和時間怎麼算",
      valueGap: "美容美甲內容若只放漂亮成品，客人仍然不知道維持期、照顧方式與自己適不適合。",
      outcomeLine: "讓客人知道做完後能更精緻、更有自己的風格，也知道怎麼維持漂亮。",
      issueTitles: {
        value: "風格與維持期還沒講清楚",
        content: "排行內容還沒整理成預約依據",
        conversion: "看完後不知道如何詢問檔期",
        hook: "開頭還沒切中變漂亮的理由"
      },
      actions: {
        hookTitle: "先用風格需求開頭",
        seriesTitle: "把排行題材延伸成款式選擇系列",
        seriesPlan: "一支講適合對象、一支講維持期與保養、一支講價格耗時與預約方式",
        valueTitle: "把款式翻成精緻生活感",
        broadTitle: "測一支容易被收藏的款式",
        conversionTitle: "把預約與價目資訊放清楚",
        conversionPlan: "每支內容固定導向作品集、價目表、LINE 預約、檔期或保養注意事項",
        adTitle: "用風格案例測高意圖客群",
        saveTitle: "做一篇款式選擇清單"
      }
    };
  }

  if (matchAny(text, ["線上課程", "線上", "知識產品", "直播課", "錄播"])) {
    return {
      proofFormats: ["課程章節地圖", "學員成果", "試看片段", "適合與不適合對象"],
      conversionPath: "線上課程內容應導向試看、課綱下載、講座報名、LINE 名單或課程頁",
      marketAngle: "線上課程消費者怕買了不看、學不會或不適合自己。內容要降低報名風險，先給他看得懂的成果路徑。",
      hookExample: "如果你學了很多還做不出來，通常不是缺課，而是少了這一步",
      customerValues: ["學得會", "省時間", "成就感", "少走冤枉路"],
      defaultAngle: "學習路徑與成果落地",
      decisionQuestion: "我現在程度適不適合、買了能不能真的做出成果",
      valueGap: "線上課程若只講內容很完整，學員仍然擔心自己會不會學完、用不用得出來。",
      outcomeLine: "讓學員知道報名後不是多收藏一門課，而是能照路徑做出具體成果。",
      issueTitles: {
        value: "學習成果路徑還不夠清楚",
        content: "排行內容還沒變成報名理由",
        conversion: "看完後不知道如何試看或報名",
        hook: "開頭還沒說中學習卡關"
      },
      actions: {
        hookTitle: "先用學員卡關開頭",
        seriesTitle: "把排行題材延伸成學習路徑系列",
        seriesPlan: "一支講適合對象、一支講課程成果、一支講試看或講座後能帶走什麼",
        valueTitle: "把課程翻成可完成的成果",
        broadTitle: "測一支學員會保存的教學內容",
        conversionTitle: "把試看與報名入口集中",
        conversionPlan: "每支內容固定導向試看、課綱、講座、LINE 名單或課程頁",
        adTitle: "用卡關問題測名單素材",
        saveTitle: "做一篇學習自評清單"
      }
    };
  }

  if (matchAny(text, ["補習", "教育", "課程", "教學", "學校", "語言"])) {
    return {
      proofFormats: ["學生前後測", "課程進度路徑", "家長常見問題", "試聽流程"],
      conversionPath: "補習班教育內容應導向試聽、程度檢測、LINE 諮詢或家長說明會",
      marketAngle: "家長重視的不只是成績，而是孩子是否被看見、是否穩定進步、老師能不能說清楚方法。",
      hookExample: "孩子成績卡住，通常不是不努力，而是少了這個學習順序",
      customerValues: ["看得見進步", "家長安心", "孩子成就感", "少走冤枉路"],
      defaultAngle: "學習卡關與進步證據",
      decisionQuestion: "這間補習班是否真的能看懂孩子問題，多久看得到變化",
      valueGap: "教育內容若只講師資和課程，家長仍然不知道孩子的問題能不能被解決。",
      outcomeLine: "讓家長知道孩子不是被塞更多課，而是有人找出卡關原因、陪他建立進步節奏。",
      issueTitles: {
        value: "家長還看不到孩子會怎麼進步",
        content: "排行內容還沒變成試聽理由",
        conversion: "看完後不知道如何檢測或試聽",
        hook: "開頭還沒說中家長焦慮"
      },
      actions: {
        hookTitle: "先用家長焦慮開頭",
        seriesTitle: "把排行題材延伸成學習問題系列",
        seriesPlan: "一支講卡關原因、一支講課程如何處理、一支講試聽或檢測能看見什麼",
        valueTitle: "把課程翻成孩子的進步",
        broadTitle: "測一支家長會轉傳的學習問題",
        conversionTitle: "把試聽與檢測入口說清楚",
        conversionPlan: "每支內容固定導向程度檢測、試聽、LINE 諮詢或家長說明會",
        adTitle: "用家長痛點素材收集名單",
        saveTitle: "做一篇家長觀察清單"
      }
    };
  }

  if (matchAny(text, ["法律", "律師", "會計", "稅務", "記帳"])) {
    return {
      proofFormats: ["情境案例", "流程與時程", "費用範圍", "文件準備清單"],
      conversionPath: "法律會計內容應導向初步諮詢、文件清單、預約表單或 LINE 問卷",
      marketAngle: "法律會計服務的痛點是怕做錯、怕被罰、怕聽不懂。內容要把複雜問題翻成可判斷的情境。",
      hookExample: "遇到這種狀況，先不要急著簽名或匯款",
      customerValues: ["降低風險", "有人把關", "清楚流程", "避免損失"],
      defaultAngle: "風險判斷與文件準備",
      decisionQuestion: "我現在需不需要找專業、會不會太晚、要準備什麼",
      valueGap: "專業服務若只講服務項目，客戶很難判斷自己的狀況是否需要處理。",
      outcomeLine: "讓客戶知道你能幫他把風險拆清楚、文件備齊，避免因為不懂而多花錢或出事。",
      issueTitles: {
        value: "風險情境還不夠具體",
        content: "排行內容還沒變成諮詢理由",
        conversion: "看完後不知道如何初步詢問",
        hook: "開頭還沒切中害怕出錯"
      },
      actions: {
        hookTitle: "先用會出事的情境開頭",
        seriesTitle: "把排行題材延伸成風險檢查系列",
        seriesPlan: "一支講常見錯誤、一支講需要準備的文件、一支講什麼情況該預約諮詢",
        valueTitle: "把專業翻成避免損失",
        broadTitle: "測一支客戶會收藏的避雷內容",
        conversionTitle: "把初談門檻降下來",
        conversionPlan: "每支內容固定導向文件清單、LINE 問卷、預約表單或初步諮詢說明",
        adTitle: "用風險情境素材測高意圖客群",
        saveTitle: "做一篇文件準備清單"
      }
    };
  }

  if (matchAny(text, ["自媒體", "行銷顧問", "內容顧問", "品牌陪跑", "社群顧問"])) {
    return {
      proofFormats: ["帳號健檢拆解", "案例前後差異", "內容流程圖", "轉換漏斗說明"],
      conversionPath: "自媒體行銷顧問內容應導向品牌評估表、LINE 諮詢、案例頁或陪跑方案說明",
      marketAngle: "業主不只想要流量，而是想知道內容能不能變成信任、名單與成交。內容要證明你能把策略落地。",
      hookExample: "帳號有發文卻沒有詢問，通常不是曝光太少，而是這段沒接好",
      customerValues: ["知道怎麼做", "有人陪跑", "少走冤枉路", "把內容變業績"],
      defaultAngle: "內容到成交的斷點",
      decisionQuestion: "找顧問後能不能真的執行，能不能看見名單與成交變化",
      valueGap: "行銷顧問內容若只講方法論，業主會覺得有道理，但不一定相信能套到自己的產業。",
      outcomeLine: "讓業主知道不是買一套課，而是有人幫他把定位、內容、短影音、導流與投放串起來執行。",
      issueTitles: {
        value: "業主還看不到落地方式",
        content: "排行內容還沒變成信任證據",
        conversion: "看完後不知道如何開始評估",
        hook: "開頭還沒說中業主的營收焦慮"
      },
      actions: {
        hookTitle: "先用業主卡關開頭",
        seriesTitle: "把排行題材延伸成帳號拆解系列",
        seriesPlan: "一支講內容斷點、一支講導流入口、一支講投放前要補的素材",
        valueTitle: "把顧問價值翻成可執行陪跑",
        broadTitle: "測一支業主會存下來的健檢內容",
        conversionTitle: "把評估表與LINE入口放清楚",
        conversionPlan: "每支內容固定導向品牌評估表、LINE 諮詢、案例頁或陪跑方案",
        adTitle: "用帳號問題素材收集評估名單",
        saveTitle: "做一篇內容漏斗檢查清單"
      }
    };
  }

  if (matchAny(text, ["房仲", "建設", "代銷", "房地產", "預售屋", "中古屋"])) {
    return {
      proofFormats: ["區域行情比較", "物件優缺點拆解", "貸款與總價試算", "賞屋避雷清單"],
      conversionPath: "房仲建設內容應導向賞屋預約、物件清單、LINE 諮詢、貸款試算或區域報告",
      marketAngle: "房地產決策高單價且週期長，買方在意的不只是漂亮物件，而是地段、總價、貸款壓力、未來生活與資產安全。",
      hookExample: "看房前先查這 3 件事，才不會被漂亮裝潢帶走",
      customerValues: ["資產安全", "生活品質升級", "降低踩雷", "決策有依據"],
      defaultAngle: "物件判斷與資產風險",
      decisionQuestion: "這個區域值不值得買、總價能不能負擔、會不會買錯",
      valueGap: "房產內容若只拍空間美感，客戶仍然不知道總價壓力、生活機能與物件風險。",
      outcomeLine: "讓客戶知道買的不只是房子，而是更穩定的生活安排、資產判斷與少踩雷的決策。",
      issueTitles: {
        value: "物件價值還沒拆成買方判斷",
        content: "排行內容還沒變成賞屋理由",
        conversion: "看完後不知道如何拿物件或預約",
        hook: "開頭還沒切中買房風險"
      },
      actions: {
        hookTitle: "先用買房風險開頭",
        seriesTitle: "把排行題材延伸成看房判斷系列",
        seriesPlan: "一支講區域生活機能、一支講總價貸款、一支講賞屋時該檢查的風險",
        valueTitle: "把物件翻成生活與資產判斷",
        broadTitle: "測一支會被買方收藏的避雷內容",
        conversionTitle: "把賞屋與物件清單入口放清楚",
        conversionPlan: "每支內容固定導向物件清單、區域報告、貸款試算、LINE 諮詢或賞屋預約",
        adTitle: "用區域痛點素材測買方名單",
        saveTitle: "做一篇賞屋檢查清單"
      }
    };
  }

  if (matchAny(text, ["室內設計", "裝修", "裝潢", "系統櫃", "建築"])) {
    return {
      proofFormats: ["完工前後對比", "預算拆解", "動線規劃", "材質與施工細節"],
      conversionPath: "室內設計裝修內容應導向需求表單、預算初評、案例頁、LINE 初談或丈量預約",
      marketAngle: "裝修客戶怕追加預算、溝通落差與施工風險。內容要把美感背後的預算、流程、材質與居住問題講清楚。",
      hookExample: "裝修前沒先想清楚這件事，後面最容易追加預算",
      customerValues: ["生活品質升級", "預算安心", "動線更順", "專業把關"],
      defaultAngle: "預算與生活動線",
      decisionQuestion: "這筆裝修預算花下去會不會後悔，流程透明嗎",
      valueGap: "裝修內容若只放完工美照，客戶會喜歡風格，但不知道預算、工期與生活問題是否能被解決。",
      outcomeLine: "讓客戶知道完工後不是只有漂亮，而是住起來更順、收納更好、預算更可控。",
      issueTitles: {
        value: "美感背後的實用價值還不夠",
        content: "排行內容還沒變成初談理由",
        conversion: "看完後不知道如何做預算初評",
        hook: "開頭還沒切中裝修擔心"
      },
      actions: {
        hookTitle: "先用裝修後悔點開頭",
        seriesTitle: "把排行題材延伸成裝修決策系列",
        seriesPlan: "一支講預算分配、一支講動線收納、一支講材質與工期注意事項",
        valueTitle: "把設計翻成住起來的改善",
        broadTitle: "測一支屋主會收藏的避雷內容",
        conversionTitle: "把預算初評入口說清楚",
        conversionPlan: "每支內容固定導向需求表單、預算初評、案例頁、LINE 初談或丈量預約",
        adTitle: "用預算與後悔點素材收集名單",
        saveTitle: "做一篇裝修預算清單"
      }
    };
  }

  if (matchAny(text, ["服飾", "配件", "穿搭", "女裝", "男裝", "飾品", "包包", "鞋"])) {
    return {
      proofFormats: ["身形穿搭示範", "一衣多穿", "材質細節", "尺寸與實穿心得"],
      conversionPath: "服飾配件內容應導向商品頁、尺寸表、穿搭合集、LINE 社群或限時優惠",
      marketAngle: "服飾配件消費者在意的是穿起來像不像自己、是否顯瘦顯質感、尺寸會不會買錯。",
      hookExample: "梨形身材選褲子，先避開這種版型",
      customerValues: ["穿出品味", "修飾身形", "被稱讚", "少買錯尺寸"],
      defaultAngle: "身形與情境穿搭",
      decisionQuestion: "這件適不適合我的身形、場合與日常風格",
      valueGap: "服飾內容若只拍模特兒好看，消費者仍然不知道自己穿起來會不會適合。",
      outcomeLine: "讓消費者知道買完後能更好搭、更有質感、更像自己，也降低尺寸買錯的風險。",
      issueTitles: {
        value: "穿搭適合度還沒說清楚",
        content: "排行內容還沒變成購買理由",
        conversion: "看完後不知道尺寸和購買入口",
        hook: "開頭還沒切中身形或場合"
      },
      actions: {
        hookTitle: "先用身形或場合開頭",
        seriesTitle: "把排行題材延伸成穿搭選擇系列",
        seriesPlan: "一支講適合身形、一支講一衣多穿、一支講尺寸與材質細節",
        valueTitle: "把服飾翻成風格與自信",
        broadTitle: "測一支容易被收藏的穿搭內容",
        conversionTitle: "把尺寸與購買資訊集中",
        conversionPlan: "每支內容固定導向尺寸表、商品頁、穿搭合集、LINE 社群或優惠入口",
        adTitle: "用身形痛點素材測購物客群",
        saveTitle: "做一篇尺寸與版型清單"
      }
    };
  }

  if (matchAny(text, ["保養", "食品", "保健", "營養", "飲品", "美妝", "保養食品"])) {
    return {
      proofFormats: ["成分與使用情境", "食用或使用週期", "適合與不適合族群", "真實回饋"],
      conversionPath: "保養食品內容應導向商品頁、成分說明、試用組、LINE 諮詢或回購提醒",
      marketAngle: "保養食品消費者重視安全、成分、長期感受與是否適合自己。內容要避免誇大，改用清楚情境與使用週期建立信任。",
      hookExample: "如果你常常外食又熬夜，先不要亂補，先看這個情境",
      customerValues: ["身心健康", "安心成分", "日常變穩", "被好好照顧"],
      defaultAngle: "成分信任與使用情境",
      decisionQuestion: "我適不適合用、多久有感、成分安不安全",
      valueGap: "保養食品內容若只講成分很厲害，消費者仍然不知道自己需不需要、怎麼用、能不能長期持續。",
      outcomeLine: "讓消費者知道這個商品如何融入日常，幫他更穩定、更安心地照顧自己。",
      issueTitles: {
        value: "成分和生活需求還沒接起來",
        content: "排行內容還沒變成信任證據",
        conversion: "看完後不知道如何選擇或試用",
        hook: "開頭還沒切中日常困擾"
      },
      actions: {
        hookTitle: "先用生活狀態開頭",
        seriesTitle: "把排行題材延伸成使用情境系列",
        seriesPlan: "一支講適合族群、一支講成分與用法、一支講使用週期與回購理由",
        valueTitle: "把商品翻成日常照顧",
        broadTitle: "測一支容易被收藏的保養提醒",
        conversionTitle: "把試用與選購入口說清楚",
        conversionPlan: "每支內容固定導向商品頁、成分說明、試用組、LINE 諮詢或回購提醒",
        adTitle: "用生活困擾素材測購買客群",
        saveTitle: "做一篇使用週期清單"
      }
    };
  }

  if (matchAny(text, ["生活用品", "家居", "收納", "清潔用品", "廚房", "日用品"])) {
    return {
      proofFormats: ["使用前後對比", "情境實測", "替代品比較", "收納或清潔步驟"],
      conversionPath: "生活用品內容應導向商品頁、組合包、使用教學、LINE 社群或再行銷名單",
      marketAngle: "生活用品的購買理由來自日常麻煩被解決。內容要把小痛點拍得具體，讓觀眾看見家裡、辦公室或育兒生活會變順。",
      hookExample: "如果你每天都被這個小麻煩卡住，先試這個整理方式",
      customerValues: ["生活更方便", "家裡更整齊", "省時間", "少買錯"],
      defaultAngle: "日常麻煩與使用情境",
      decisionQuestion: "這個東西真的比我現在用的好嗎，能不能解決我的小麻煩",
      valueGap: "生活用品內容若只介紹功能，觀眾很難感覺到自己的生活會因為它變輕鬆。",
      outcomeLine: "讓觀眾看到買完後少一個麻煩、空間更整齊、每天多省一點時間。",
      issueTitles: {
        value: "日常痛點還不夠具體",
        content: "排行內容還沒變成使用證據",
        conversion: "看完後不知道怎麼選組合",
        hook: "開頭還沒拍出生活卡點"
      },
      actions: {
        hookTitle: "先拍出每天都遇到的小麻煩",
        seriesTitle: "把排行題材延伸成使用實測系列",
        seriesPlan: "一支拍使用前後、一支拍替代品比較、一支拍適合哪些家庭或空間",
        valueTitle: "把功能翻成生活變順",
        broadTitle: "測一支容易被收藏的收納或清潔內容",
        conversionTitle: "把組合與購買入口集中",
        conversionPlan: "每支內容固定導向商品頁、組合包、使用教學、LINE 社群或優惠入口",
        adTitle: "用痛點前後對比做投放素材",
        saveTitle: "做一篇使用情境清單"
      }
    };
  }

  if (matchAny(text, ["電商", "品牌", "商品", "零售", "選物"])) {
    return {
      proofFormats: ["使用情境", "開箱實測", "顧客評價", "比較表"],
      conversionPath: "電商品牌內容應導向商品頁、限時優惠、LINE 社群、購物車或再行銷名單",
      marketAngle: "電商品牌需要用短影音縮短理解時間，讓消費者快速知道差異、場景、信任證據與購買理由。",
      hookExample: "這個商品不是給所有人，是給有這個困擾的人",
      customerValues: ["生活更方便", "品味提升", "少買錯", "日常被照顧"],
      defaultAngle: "使用情境與比較",
      decisionQuestion: "我為什麼要買這個，而不是買便宜或常見的替代品",
      valueGap: "電商內容若只拍商品，觀眾會知道你有賣，但不知道差異、信任證據與現在購買理由。",
      outcomeLine: "讓消費者知道商品如何改善他的生活、品味、效率或安心感，並降低買錯的疑慮。",
      issueTitles: {
        value: "商品差異還不夠明確",
        content: "排行內容還沒變成購買證據",
        conversion: "看完後沒有被帶到商品入口",
        hook: "開頭還沒切中購買動機"
      },
      actions: {
        hookTitle: "先用使用痛點開頭",
        seriesTitle: "把排行題材延伸成購買理由系列",
        seriesPlan: "一支講適合誰、一支講替代品比較、一支講顧客使用後的改變",
        valueTitle: "把商品翻成購買後的改變",
        broadTitle: "測一支陌生客也看得懂的痛點內容",
        conversionTitle: "把商品頁與LINE承接接好",
        conversionPlan: "每支內容固定導向商品頁、優惠、LINE 社群、購物車或再行銷入口",
        adTitle: "用比較與回饋素材做投放",
        saveTitle: "做一篇選購比較清單"
      }
    };
  }

  if (matchAny(text, ["汽車", "機車", "中古車", "保養廠", "改裝", "車行"])) {
    return {
      proofFormats: ["車況檢查清單", "保養前後差異", "價格與工項拆解", "常見故障案例"],
      conversionPath: "汽車機車內容應導向預約保養、估價表單、LINE 詢問、車款清單或試乘賞車",
      marketAngle: "汽機車消費者怕被坑、怕買錯、怕維修不透明。內容要把專業判斷翻成看得懂的安全與價格依據。",
      hookExample: "中古車看這裡，如果有這個狀況先不要急著下訂",
      customerValues: ["安全可靠", "價格透明", "少被坑", "車況安心"],
      defaultAngle: "車況判斷與價格透明",
      decisionQuestion: "這台車或這次維修值不值得，會不會被多收或買錯",
      valueGap: "汽機車內容若只拍車很帥或工法很專業，客戶仍然不知道自己要怎麼判斷車況與價格。",
      outcomeLine: "讓客戶知道你能幫他看懂車況、避開風險，花錢花得更安心。",
      issueTitles: {
        value: "車況與價格判斷還不夠透明",
        content: "排行內容還沒變成詢問理由",
        conversion: "看完後不知道如何估價或預約",
        hook: "開頭還沒切中怕買錯"
      },
      actions: {
        hookTitle: "先用車況風險開頭",
        seriesTitle: "把排行題材延伸成車況判斷系列",
        seriesPlan: "一支講常見故障、一支講工項價格、一支講預約檢查或試乘流程",
        valueTitle: "把專業翻成安心用車",
        broadTitle: "測一支車主會收藏的檢查內容",
        conversionTitle: "把估價與預約入口說清楚",
        conversionPlan: "每支內容固定導向 LINE 詢問、估價表單、保養預約、車款清單或試乘賞車",
        adTitle: "用避雷素材測高意圖車主",
        saveTitle: "做一篇車況檢查清單"
      }
    };
  }

  if (matchAny(text, ["婚禮", "攝影", "婚攝", "婚錄", "婚紗", "新秘"])) {
    return {
      proofFormats: ["完整作品集", "婚禮流程片段", "新人回饋", "風格與價格方案"],
      conversionPath: "婚禮攝影內容應導向檔期詢問、作品集、方案頁、LINE 諮詢或婚禮需求表",
      marketAngle: "婚禮服務買的是一次不能重來的安心感。新人在意風格、檔期、流程穩定、溝通是否放心。",
      hookExample: "婚禮當天最怕漏拍的，不是大合照，而是這些瞬間",
      customerValues: ["重要回憶被保存", "婚禮安心", "風格被理解", "不留遺憾"],
      defaultAngle: "回憶保存與流程安心",
      decisionQuestion: "這個團隊能不能拍出我想要的感覺，當天會不會漏掉重要畫面",
      valueGap: "婚禮攝影內容若只放精修美照，新人仍然不知道團隊是否穩、流程是否會照顧到細節。",
      outcomeLine: "讓新人知道交給你後，重要瞬間會被保存，婚禮當天也能少一件需要擔心的事。",
      issueTitles: {
        value: "一次性服務的安心感還不夠",
        content: "排行內容還沒變成檔期詢問理由",
        conversion: "看完後不知道如何詢問檔期",
        hook: "開頭還沒切中新人焦慮"
      },
      actions: {
        hookTitle: "先用婚禮不可重來的瞬間開頭",
        seriesTitle: "把排行題材延伸成婚禮安心系列",
        seriesPlan: "一支講必拍瞬間、一支講風格案例、一支講檔期與方案怎麼確認",
        valueTitle: "把作品翻成一生一次的安心",
        broadTitle: "測一支新人會收藏的婚禮提醒",
        conversionTitle: "把檔期與方案入口說清楚",
        conversionPlan: "每支內容固定導向作品集、檔期詢問、方案頁、LINE 諮詢或需求表",
        adTitle: "用風格與流程素材測準新人",
        saveTitle: "做一篇婚禮必拍清單"
      }
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
      decisionQuestion: "我這種狀況能不能開始，多久會看到變化",
      valueGap: "健身內容若只秀成果或動作，觀眾會羨慕，但不一定相信自己做得到，也不知道第一步該怎麼開始。",
      outcomeLine: "讓觀眾知道他得到的不只是訓練，而是身體變穩、外型更有自信，並有人陪他把習慣建立起來。",
      issueTitles: {
        value: "可達成感還不夠",
        content: "排行內容還沒變成體驗理由",
        conversion: "看完後不知道如何開始評估",
        hook: "開頭還沒切中身體焦慮"
      },
      actions: {
        hookTitle: "先用身體卡關開頭",
        seriesTitle: "把排行題材延伸成可開始系列",
        seriesPlan: "一支講常見錯誤、一支講適合程度、一支講體驗課或初評會做什麼",
        valueTitle: "把訓練翻成可達成的改變",
        broadTitle: "測一支觀眾會收藏的動作修正",
        conversionTitle: "把體驗與初評入口說清楚",
        conversionPlan: "每支內容固定導向體驗課、初步評估、LINE 問卷或會員方案",
        adTitle: "用卡關情境素材收集體驗名單",
        saveTitle: "做一篇新手訓練檢查清單"
      }
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
      decisionQuestion: "我現在的狀況需要哪一種方案，會不會買錯",
      valueGap: "金融與保險內容若只講商品名稱，客戶會更怕被推銷，也不確定自己的狀況是否適合。",
      outcomeLine: "讓客戶知道你是在幫他看懂風險、做出合適選擇，而不是急著成交方案。",
      issueTitles: {
        value: "風險與需求還沒對齊",
        content: "排行內容還沒變成諮詢理由",
        conversion: "看完後不知道如何初步評估",
        hook: "開頭還沒切中怕買錯"
      },
      actions: {
        hookTitle: "先用買錯風險開頭",
        seriesTitle: "把排行題材延伸成需求判斷系列",
        seriesPlan: "一支講常見錯誤、一支講適合條件、一支講初步評估會看哪些資料",
        valueTitle: "把方案翻成風險被管理",
        broadTitle: "測一支會被收藏的選擇比較",
        conversionTitle: "把初評入口說清楚",
        conversionPlan: "每支內容固定導向需求表單、LINE 初評、預約諮詢或案例情境",
        adTitle: "用風險情境素材測高意圖名單",
        saveTitle: "做一篇需求自評清單"
      }
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
      decisionQuestion: "這個服務能不能替我省時間、降風險或創造明確成果",
      valueGap: "B2B 內容若只說服務很完整，決策者很難判斷自己的問題成本、導入風險與投資回收。",
      outcomeLine: "讓決策者知道導入後能省下哪段流程、降低哪種風險、讓哪個指標變清楚。",
      issueTitles: {
        value: "問題成本還沒有算清楚",
        content: "排行內容還沒變成決策證據",
        conversion: "看完後不知道如何評估導入",
        hook: "開頭還沒切中營運痛點"
      },
      actions: {
        hookTitle: "先用營運損失開頭",
        seriesTitle: "把排行題材延伸成決策者系列",
        seriesPlan: "一支講問題成本、一支講導入流程與風險、一支講案例結果或評估表能看出什麼",
        valueTitle: "把顧問服務翻成可衡量成果",
        broadTitle: "測一支決策者會轉給同事的內容",
        conversionTitle: "把評估表和案例下載放清楚",
        conversionPlan: "每支內容固定導向評估表、預約諮詢、案例下載、ROI 試算或 LINE 初談",
        adTitle: "用成本痛點素材收集企業名單",
        saveTitle: "做一篇導入前決策清單"
      }
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

function diagnoseAccount({ mediaRows, totalReach, totalMediaReach, totalEngagement, totalSavesShares, totalWebsiteClicks, engagementRate, availability, contentInsight }) {
  const contentCount = mediaRows.length;
  const saveShareRate = totalMediaReach && totalSavesShares !== null ? totalSavesShares / totalMediaReach : null;
  const commentTotal = nullableSum(mediaRows, "media_comments_count");
  const commentRate = totalMediaReach && commentTotal !== null ? commentTotal / totalMediaReach : null;
  const hasConversionSignal = totalWebsiteClicks !== null && totalWebsiteClicks > 0;
  const hasInterestSignal = Boolean(
    (engagementRate !== null && engagementRate >= 0.06) ||
      (saveShareRate !== null && saveShareRate >= 0.018) ||
      (commentRate !== null && commentRate >= 0.004) ||
      (totalSavesShares !== null && totalSavesShares >= Math.max(30, contentCount * 10))
  );
  const hasScaleSignal = Boolean(
    contentCount >= 2 &&
      ((totalReach !== null && totalReach >= 5000) || (totalEngagement !== null && totalEngagement >= 300) || (totalSavesShares !== null && totalSavesShares >= 100))
  );
  const isTopicNarrow = contentInsight.angleCount <= 1 && contentCount >= 4;
  const hasWeakCaptions = contentInsight.captionSpecificity === "thin" && contentCount >= 2;

  if (!contentCount) {
    return {
      stage: "noContent",
      issueKeys: ["noContent", "dataPartial", "conversion"],
      actionKeys: ["cadence", "broad", "conversion", "search", "proof"]
    };
  }

  if (!availability.hasReach && !availability.hasEngagement && !availability.hasSavesShares) {
    return {
      stage: "dataPartial",
      issueKeys: ["dataPartial", "value", "conversion"],
      actionKeys: ["cadence", "series", "conversion", "proof", "search"]
    };
  }

  if (engagementRate !== null && engagementRate < 0.035) {
    return {
      stage: "hook",
      issueKeys: ["hook", hasWeakCaptions ? "value" : "save", "conversion"],
      actionKeys: ["hook", "broad", "value", "save", "conversion"]
    };
  }

  if (saveShareRate !== null && saveShareRate < 0.012 && totalSavesShares !== null && contentCount >= 2) {
    return {
      stage: "save",
      issueKeys: ["save", "value", "conversion"],
      actionKeys: ["save", "series", "proof", "conversion", "search"]
    };
  }

  if (!hasConversionSignal && hasInterestSignal) {
    return {
      stage: "conversion",
      issueKeys: ["conversion", "trust", isTopicNarrow ? "narrow" : "value"],
      actionKeys: ["conversion", "proof", "series", "ad", "search"]
    };
  }

  if (isTopicNarrow) {
    return {
      stage: "narrow",
      issueKeys: ["narrow", "trust", "conversion"],
      actionKeys: ["series", "broad", "proof", "conversion", "ad"]
    };
  }

  if (hasScaleSignal) {
    return {
      stage: "scale",
      issueKeys: ["scale", "conversion", "trust"],
      actionKeys: ["ad", "series", "conversion", "proof", "search"]
    };
  }

  return {
    stage: "value",
    issueKeys: ["value", "trust", "conversion"],
    actionKeys: ["value", "hook", "series", "conversion", "proof"]
  };
}

function analyzeContentRows(rows, profile) {
  if (!rows.length) {
    return {
      primaryAngle: profile.defaultAngle,
      topCaption: "",
      strongestSignal: "",
      adSignal: "",
      angleCount: 0,
      captionSpecificity: "none",
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
  const captionSpecificity = scoreCaptionSpecificity(rows.map((row) => row.media_caption || ""));

  return {
    primaryAngle,
    topCaption: top?.caption || "",
    strongestSignal: top?.signal || "",
    adSignal: top?.signal ? `${top.signal}較明確` : "",
    angleCount: Object.keys(angleScores).length,
    captionSpecificity,
    hasContent: true
  };
}

function scoreCaptionSpecificity(captions) {
  const joined = captions.join(" ").trim();
  if (!joined) return "none";
  const averageLength = captions.reduce((total, caption) => total + String(caption || "").trim().length, 0) / captions.length;
  const hasSpecificWords = /價格|費用|尺寸|預約|訂位|空房|試聽|試用|案例|流程|比較|清單|地點|營業|檔期|成分|預算|評估|初診|體驗/.test(joined);
  if (averageLength < 16 && !hasSpecificWords) return "thin";
  if (hasSpecificWords || averageLength >= 32) return "specific";
  return "medium";
}

function uniqueByTitle(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item || seen.has(item.title)) return false;
    seen.add(item.title);
    return true;
  });
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
