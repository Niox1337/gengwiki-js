// 客户端的常用选项。

import { GengWiki } from "gengwiki";

// 自建服务时可以传入 baseUrl 和 siteUrl，或者设置环境变量 GENGWIKI_API_URL 和 GENGWIKI_SITE_URL
// 想改数据目录可以传入 home，或者设置环境变量 GENGWIKI_HOME
const client = new GengWiki({ timeout: 5 });

try {
  console.log(await client.searchMemes("躺平"));
} finally {
  // 关闭本地缓存
  client.close();
}
