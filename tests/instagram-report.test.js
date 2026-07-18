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

console.log("instagram-report.test.js passed");
