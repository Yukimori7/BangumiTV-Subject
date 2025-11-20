// id.ts
import * as cheerio from "npm:cheerio";
// 直接从 CDN 获取 json 数据，或者你也可以用 "npm:bangumi-data"
// 这里演示直接 import JSON (Deno 支持)
import bangumiData from "npm:bangumi-data" with { type: "json" };
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";

// 类型定义
interface BangumiSite {
  site: string;
  id: string;
}

interface BangumiItem {
  title: string;
  sites: BangumiSite[];
}

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36",
};

// 工具函数：确保目录存在并写入
async function writeJson(filePath: string, data: number[]) {
  const dir = join(".", "ids");
  await Deno.mkdir(dir, { recursive: true });

  // 去重并排序
  const uniqueData = Array.from(new Set(data)).sort((a, b) => a - b);
  await Deno.writeTextFile(filePath, JSON.stringify(uniqueData));
  console.log(`✅ Write to ${filePath} (Count: ${uniqueData.length})`);
}

// 工具函数：延时
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 工具函数：封装 fetch
async function fetchHtml(url: string): Promise<string> {
  try {
    console.log(`🌐 Fetching ${url}`);
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (error) {
    console.error(`❌ Error fetching ${url}:`, error);
    return "";
  }
}

async function buildIds() {
  // 1. 处理 bangumi-data
  console.log("--- Step 1: Extracting from bangumi-data ---");
  const bangumiDataIds: number[] = [];
  (bangumiData.items as unknown as BangumiItem[]).forEach((item) => {
    const find = item.sites.find((site) => site.site === "bangumi");
    if (find) {
      bangumiDataIds.push(parseInt(find.id));
    }
  });
  await writeJson("./ids/anime-bangumi-data.json", bangumiDataIds);

  // 2. 爬取 Rank
  console.log("--- Step 2: Scraping Rank Pages ---");
  const rankIds: number[] = [];
  const maxPage = 300; // 原代码是 300

  for (let i = 1; i <= maxPage; i++) {
    // 真正的限流：等待 500ms
    await delay(500);

    const url = `https://bgm.tv/anime/browser?sort=rank&page=${i}`;
    const html = await fetchHtml(url);
    if (!html) continue;

    const $ = cheerio.load(html);
    const ids = $("#browserItemList > li")
      .map((_, element) => {
        const idStr = $(element).attr("id"); // item_123
        return idStr ? parseInt(idStr.replace("item_", "")) : null;
      })
      .get()
      .filter((id) => id !== null) as number[];

    rankIds.push(...ids);
    // 每 10 页打印一次进度
    if (i % 10 === 0) console.log(`   Processed page ${i}/${maxPage}`);
  }
  await writeJson("./ids/rank-bangumi.json", rankIds);

  // 3. 爬取放送表 (Calendar)
  console.log("--- Step 3: Fetching Calendar ---");
  const calendarIds: number[] = [];
  try {
    const res = await fetch("https://api.bgm.tv/calendar", { headers: HEADERS });
    const calendar = await res.json();

    // 简单的类型断言
    calendar.forEach((item: any) => {
      if (item.items) {
        const ids = item.items.map((element: any) => parseInt(element.id));
        calendarIds.push(...ids);
      }
    });
  } catch (error) {
    console.error("Error fetching calendar", error);
  }
  await writeJson("./ids/calendar.json", calendarIds);

  console.log("🎉 Done!");
}

// 运行
if (import.meta.main) {
  await buildIds();
}
