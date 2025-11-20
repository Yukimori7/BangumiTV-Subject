import pThrottle from "npm:p-throttle"; // 引入 p-throttle
import { dirname } from "https://deno.land/std@0.224.0/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.224.0/fs/mod.ts";

// 配置
const HOST = "https://api.bgm.tv";
const TIMEOUT_MS = 5000;
const REWRITE = true;
const START_INDEX = 0;
// 频率配置
const LIMIT_COUNT = 5;    // 多少个
const LIMIT_INTERVAL = 1000; // 多少毫秒 (1000ms = 1秒)

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36",
};

function decode(str: string = ""): string {
  if (str.length === 0) return "";
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "'");
}

// 抓取函数保持不变
async function fetchSubject(id: number, index: number, total: number, retryCount = 0): Promise<void> {
  const maxRetries = 3;
  const filePath = `./data/${Math.floor(id / 100)}/${id}.json`;

  try {
    await Deno.stat(filePath);
    if (!REWRITE) return;
  } catch {
    // 文件不存在，继续
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(`${HOST}/v0/subjects/${id}`, {
      headers: HEADERS,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.status === 404) {
      console.log(`⚪ 404 Not Found: ${id}.json [${index}/${total}]`);
      return;
    }

    if (res.status === 429) {
      // 如果真的遇到 429，抛出错误触发重试，或在这里做一个更长时间的等待
      throw new Error("Rate Limit Exceeded (429)");
    }

    if (!res.ok) {
      throw new Error(`HTTP Status ${res.status}`);
    }

    const data = await res.json();
    await ensureDir(dirname(filePath));
    const content = decode(JSON.stringify(data));
    await Deno.writeTextFile(filePath, content);

    console.log(`✅ Write to ${id}.json [${index}/${total}] - ${data.name || 'No Name'}`);

  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    const errorMsg = isTimeout ? 'Timeout' : (error as Error).message;

    if (retryCount < maxRetries) {
      console.warn(`🔄 Retry (${retryCount + 1}/${maxRetries}) ${id}.json: ${errorMsg}`);

      // 如果是 429 错误，建议等待更久一点
      const waitTime = errorMsg.includes("429") ? 5000 : 1000 * (retryCount + 1);
      await new Promise(r => setTimeout(r, waitTime));

      return fetchSubject(id, index, total, retryCount + 1);
    } else {
      console.error(`❌ [Error] Failed ${id}.json [${index}/${total}]: ${errorMsg}`);
    }
  }
}

async function main() {
  const idFiles = [
    "./ids/anime-bangumi-data.json",
    "./ids/rank-bangumi.json",
    "./ids/calendar.json",
  ];

  let allIds: number[] = [];

  for (const file of idFiles) {
    try {
      const content = await Deno.readTextFile(file);
      const ids = JSON.parse(content) as number[];
      allIds = allIds.concat(ids);
    } catch (e) {
      console.warn(`⚠️ Could not read ${file}, skipping...`);
    }
  }

  allIds = Array.from(new Set(allIds));
  console.log(`🚀 Starting fetch for ${allIds.length} subjects...`);
  console.log(`⏱️  Rate Limit: ${LIMIT_COUNT} requests per ${LIMIT_INTERVAL}ms`);

  // 1. 创建节流阀 (Throttle)
  // limit: 区间内最大执行次数
  // interval: 时间区间 (毫秒)
  const throttle = pThrottle({
    limit: LIMIT_COUNT,
    interval: LIMIT_INTERVAL
  });

  // 2. 包装原本的 fetchSubject 函数
  // throttledFetch 现在是一个“被限速”版本的函数
  const throttledFetch = throttle(fetchSubject);

  // 3. 创建任务
  const tasks = allIds.map((id, i) => {
    if (i < START_INDEX) return Promise.resolve();

    // 调用被限速的函数
    // p-throttle 会自动计算并在需要时延迟执行，确保不超速
    return throttledFetch(id, i, allIds.length);
  });

  // 4. 等待完成
  await Promise.all(tasks);

  console.log("🎉 All jobs done!");
}

if (import.meta.main) {
  await main();
}
