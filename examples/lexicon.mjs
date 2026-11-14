// 个人词库，记录自己的词语和含义。

import { GengWiki } from "gengwiki";

const client = new GengWiki();

// 新建词库
const lexicon = await client.createLexicon("职场黑话", "工作里常听到的词");

// 添加词条
await client.addLexiconEntry(lexicon.id, "对齐", { aliases: ["拉齐"], note: "统一大家的想法", tags: ["职场"] });

// 在所有词库里搜索
for (const entry of await client.searchLexicons("拉齐")) {
  console.log(entry.term, entry.note);
}

// 列出我的词库
for (const item of await client.lexicons()) {
  console.log(item.name, item.entries);
}
