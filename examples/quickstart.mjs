// 搜索梗，查看详情和热门榜。运行前先用 gengwiki keys add 保存 Key。

import { GengWiki } from "gengwiki";

const client = new GengWiki();

// 搜索，标题和别名都能搜到
for (const meme of await client.searchMemes("躺平", 5)) {
  console.log(meme.title, meme.summary);
}

// 查看详情，可以用 slug，也可以用标题或别名
const meme = await client.meme("躺平");
console.log(meme.body);
console.log(meme.usage_scenario);
console.log(meme.usage_examples);

// 全站热门榜
for (const hot of await client.trending("", 10)) {
  console.log(hot.title, hot.heat);
}
