const { buildReport } = require("./instagram-report");

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

console.log("instagram-report.test.js passed");
