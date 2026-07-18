const { buildReport } = require("../netlify/functions/instagram-report");

const report = buildReport([
  {
    date: "2026-06-17",
    reach: 890,
    media_reach: 1394,
    media_engagement: 164,
    media_saved: 30,
    media_shares: 18,
    media_comments_count: 88,
    media_like_count: 24,
    media_permalink: "https://www.instagram.com/reel/example/",
    media_caption: "免費腳本生成器 #ai工具 #ai行銷",
    media_product_type: "REELS"
  }
]);

if (!report.summary.totalReach || !report.recommendations.length) {
  throw new Error("Report builder did not produce expected output.");
}

const partialReport = buildReport(
  [
    {
      date: "2026-07-17",
      media_saved: 28,
      media_caption: "生活用品常見挑選錯誤",
      media_product_type: "REELS",
      is_media_content: true
    }
  ],
  { industry: "生活用品", source: "connected" }
);

if (partialReport.summary.totalReach !== null || partialReport.summary.totalSavesShares !== 28 || partialReport.topContent.length !== 1) {
  throw new Error("Partial Phyllo data should stay truthful and still produce ranked content.");
}

const recommendationText = partialReport.recommendations.map((item) => `${item.title} ${item.body}`).join("\n");
if (/七步驟|泛流量內容只測題材|CTA 內容要承接名單/.test(recommendationText)) {
  throw new Error("Recommendations should not expose internal strategy formulas.");
}

if (!recommendationText.includes("生活更方便") && !recommendationText.includes("品味提升")) {
  throw new Error("Industry-specific customer values should be used in recommendations.");
}

const sampleRows = [
  {
    date: "2026-07-11",
    media_reach: 2400,
    media_engagement: 260,
    media_saved: 45,
    media_shares: 18,
    media_comments_count: 12,
    media_caption: "第一次來先點這三樣，不用怕踩雷",
    media_product_type: "REELS",
    is_media_content: true
  }
];
const restaurantText = buildReport(sampleRows, { industry: "餐飲品牌", source: "connected" }).recommendations.map((item) => `${item.title} ${item.body}`).join("\n");
const snackText = buildReport(sampleRows, { industry: "小吃攤商", source: "connected" }).recommendations.map((item) => `${item.title} ${item.body}`).join("\n");
const travelText = buildReport(sampleRows, { industry: "旅宿觀光", source: "connected" }).recommendations.map((item) => `${item.title} ${item.body}`).join("\n");

if (!restaurantText.includes("訂位") || !restaurantText.includes("聚餐")) {
  throw new Error("Restaurant recommendations should focus on dining occasions and booking.");
}

if (!snackText.includes("營業時間") || !snackText.includes("地點")) {
  throw new Error("Snack stall recommendations should focus on immediate buying details.");
}

if (!travelText.includes("空房") || !travelText.includes("行程")) {
  throw new Error("Travel recommendations should focus on availability and itinerary planning.");
}

const industryExpectations = {
  餐飲品牌: ["聚餐", "訂位"],
  咖啡甜點: ["療癒", "外帶"],
  小吃攤商: ["營業時間", "地點"],
  旅宿觀光: ["空房", "行程"],
  醫美診所: ["療程", "諮詢"],
  牙醫診所: ["初診", "費用"],
  中醫健康: ["症狀", "評估"],
  髮廊美業: ["髮型", "設計師"],
  美容美甲: ["款式", "檔期"],
  健身教練: ["體驗課", "初評"],
  補習班教育: ["試聽", "檢測"],
  線上課程: ["試看", "課綱"],
  法律會計: ["文件", "諮詢"],
  B2B顧問服務: ["評估表", "案例"],
  自媒體行銷顧問: ["品牌評估表", "陪跑"],
  電商品牌: ["商品頁", "購物"],
  服飾配件: ["尺寸", "穿搭"],
  保養食品: ["成分", "試用"],
  生活用品: ["使用", "組合"],
  房仲建設: ["賞屋", "貸款"],
  室內設計裝修: ["預算", "丈量"],
  汽車機車: ["估價", "預約"],
  婚禮攝影: ["檔期", "作品集"]
};

for (const [industry, expectedWords] of Object.entries(industryExpectations)) {
  const reportText = buildReport(sampleRows, { industry, source: "connected" }).recommendations.map((item) => `${item.title} ${item.body}`).join("\n");
  if (!expectedWords.every((word) => reportText.includes(word))) {
    throw new Error(`${industry} recommendations should include industry-specific terms: ${expectedWords.join(", ")}`);
  }
}

const weakHookRows = [
  {
    date: "2026-07-10",
    media_reach: 6000,
    media_engagement: 60,
    media_saved: 3,
    media_shares: 1,
    media_comments_count: 0,
    media_caption: "新品上市",
    media_product_type: "REELS",
    is_media_content: true
  },
  {
    date: "2026-07-12",
    media_reach: 4200,
    media_engagement: 35,
    media_saved: 2,
    media_shares: 0,
    media_comments_count: 0,
    media_caption: "活動開跑",
    media_product_type: "REELS",
    is_media_content: true
  }
];
const conversionGapRows = [
  {
    date: "2026-07-10",
    media_reach: 1800,
    media_engagement: 240,
    media_saved: 80,
    media_shares: 32,
    media_comments_count: 20,
    media_caption: "梨形身材選褲子，先避開這種版型",
    media_product_type: "REELS",
    is_media_content: true
  },
  {
    date: "2026-07-12",
    media_reach: 2200,
    media_engagement: 260,
    media_saved: 92,
    media_shares: 38,
    media_comments_count: 24,
    media_caption: "上班穿搭尺寸怎麼抓才不顯壯",
    media_product_type: "REELS",
    is_media_content: true
  },
  {
    date: "2026-07-17",
    reach: 10,
    website_clicks_1d: 0
  }
];
const scaleRows = [
  {
    date: "2026-07-10",
    media_reach: 9000,
    media_engagement: 720,
    media_saved: 220,
    media_shares: 130,
    media_comments_count: 65,
    media_caption: "小個子穿長裙，比例要先看這裡",
    media_product_type: "REELS",
    is_media_content: true
  },
  {
    date: "2026-07-11",
    media_reach: 7600,
    media_engagement: 610,
    media_saved: 180,
    media_shares: 90,
    media_comments_count: 42,
    media_caption: "通勤穿搭如何看起來乾淨又不無聊",
    media_product_type: "REELS",
    is_media_content: true
  },
  {
    date: "2026-07-17",
    reach: 50,
    website_clicks_1d: 18
  }
];

const weakHookActions = buildReport(weakHookRows, { industry: "服飾配件", source: "connected" }).recommendations.map((item) => item.title).join("\n");
const conversionGapActions = buildReport(conversionGapRows, { industry: "服飾配件", source: "connected" }).recommendations.map((item) => item.title).join("\n");
const scaleActions = buildReport(scaleRows, { industry: "服飾配件", source: "connected" }).recommendations.map((item) => item.title).join("\n");

if (weakHookActions === conversionGapActions || conversionGapActions === scaleActions || weakHookActions === scaleActions) {
  throw new Error("Same industry should produce different action plans when account signals differ.");
}

if (!weakHookActions.includes("身形") && !weakHookActions.includes("場合")) {
  throw new Error("Weak engagement account should prioritize hook rewriting for fashion.");
}

if (!conversionGapActions.includes("尺寸") || !conversionGapActions.includes("購買")) {
  throw new Error("High-interest low-conversion account should prioritize shopping handoff for fashion.");
}

if (!scaleActions.includes("廣告") && !scaleActions.includes("短片")) {
  throw new Error("Strong account should prioritize scale-ready ad creative.");
}

console.log("instagram-report.test.js passed");
