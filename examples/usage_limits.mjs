// 查看额度和用量，这两个总是读取最新数据。

import { GengWiki } from "gengwiki";

const client = new GengWiki();

// 当前额度
const limit = await client.rateLimit();
console.log(`今天 ${limit.used_today}/${limit.per_day}，这一分钟 ${limit.used_this_minute}/${limit.per_minute}`);

// 最近 30 天每天的请求数
for (const day of (await client.usage()).days) {
  console.log(day.day, day.requests);
}
