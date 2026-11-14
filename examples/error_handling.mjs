// 处理错误。所有错误都继承自 GengWikiError。

import { AuthError, ForbiddenError, GengWiki, GengWikiError, NotFoundError, RateLimitError } from "gengwiki";

const client = new GengWiki();

try {
  console.log((await client.meme("不存在的梗")).body);
} catch (e) {
  if (e instanceof NotFoundError) {
    // 没找到，错误信息里会列出相近的结果
    console.log(e.message);
  } else if (e instanceof AuthError) {
    console.log("Key 无效或已吊销");
  } else if (e instanceof ForbiddenError) {
    console.log("Key 没有这项权限，或者配额用完了");
  } else if (e instanceof RateLimitError) {
    console.log(`请求太多，${e.retryAfter} 秒后再试`);
  } else if (e instanceof GengWikiError) {
    // 其他错误，比如服务器故障或者断网
    console.log(e.status, e.code, e.message);
  } else {
    throw e;
  }
}
