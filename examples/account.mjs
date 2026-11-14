// 登录后管理账号上的 Key。密码从环境变量读，不要写进代码。命令行的 gengwiki login 输入时不显示。

import { GengWiki } from "gengwiki";

const client = new GengWiki();

// 密码不会保存，只保存 7 天有效的 token
await client.keys.login("me@example.com", process.env.GENGWIKI_PASSWORD ?? "");

// 列出账号上的 Key
for (const key of await client.keys.list()) {
  console.log(key.name, key.prefix, key.last_used_at);
}

// 创建一个绑定人设的 Key，密钥只显示一次，所以会自动保存
const key = await client.keys.create("测试用", { persona: "毒舌老哥" });

// 换新密钥，旧密钥立即失效，本地缓存继续可用
await client.keys.rotate(key.name);

// 吊销，并清除本地数据
await client.keys.revoke(key.name);

client.keys.logout();
