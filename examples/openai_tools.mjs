// 让 OpenAI 的模型自己查梗，用 Chat Completions 接口。需要 npm install openai。

import OpenAI from "openai";
import { GengWiki } from "gengwiki";

const client = new GengWiki();
const llm = new OpenAI();

const messages = [{ role: "user", content: "躺平是什么意思？" }];

// 模型要用工具就执行，然后把结果交还给它，直到它不再需要工具
let reply;
for (;;) {
  const completion = await llm.chat.completions.create({ model: "gpt-5", messages, tools: client.tools.openai() });
  reply = completion.choices[0].message;
  const results = await client.tools.run(reply);
  if (!results.length) break;
  messages.push(reply, ...results);
}

console.log(reply.content);
