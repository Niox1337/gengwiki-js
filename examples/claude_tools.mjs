// 让 Claude 自己查梗，并带上人设。需要 npm install @anthropic-ai/sdk。

import Anthropic from "@anthropic-ai/sdk";
import { GengWiki } from "gengwiki";

const client = new GengWiki();
const llm = new Anthropic();

// Claude 的系统提示不放在消息列表里
const persona = await client.persona();
const system = persona ? persona.prompt : "你是一个懂网络用语的助手。";

const messages = [{ role: "user", content: "躺平是什么意思？" }];

// 模型要用工具就执行，然后把结果交还给它，直到它不再需要工具
let reply;
for (;;) {
  reply = await llm.messages.create({ model: "claude-opus-5-5", max_tokens: 1024, system, messages, tools: client.tools.anthropic() });
  const results = await client.tools.run(reply);
  if (!results.length) break;
  messages.push({ role: "assistant", content: reply.content }, ...results);
}

console.log(reply.content[0].text);
