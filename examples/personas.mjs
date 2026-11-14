// 浏览和切换人设。一个 Key 绑定一个人设，所以切换人设就是切换 Key。

import { GengWiki } from "gengwiki";

const client = new GengWiki();

// 当前 Key 绑定的人设，没有绑定时是 null
const current = await client.persona();
if (current) console.log(current.title, current.prompt);

// 浏览人设目录
for (const persona of await client.personas()) {
  console.log(persona.title, persona.description);
}

// 切换，之后的搜索也会换成这个 Key 的范围
const persona = await client.usePersona("温柔姐姐");

// 直接放进消息列表
const messages = [persona.asMessage(), { role: "user", content: "你好" }];
console.log(messages);
