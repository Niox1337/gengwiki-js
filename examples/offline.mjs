// 提前下载内容，之后断网也能用。

import { GengWiki } from "gengwiki";

const client = new GengWiki();

// 下载这个 Key 能看到的全部内容，中断后再运行会接着下载
console.log(await client.sync({ images: true }));

// 这些读取都来自本地
console.log(await client.searchMemes("躺平"));
console.log(await client.persona());

// 想看最新内容时，让下一次读取走网络
client.refresh();
console.log(await client.searchMemes("躺平"));

// true 表示暂时连不上，读到的还是旧内容
console.log(client.stale);

// 这个客户端实际发出的请求数
console.log(client.requestCount);
