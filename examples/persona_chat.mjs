// 在终端里和人设聊天，这里用 DeepSeek。直接回车退出。需要 npm install openai。

import { createInterface } from "node:readline/promises";
import OpenAI from "openai";
import { GengWiki } from "gengwiki";

const client = new GengWiki();
const llm = new OpenAI({ baseURL: "https://api.deepseek.com", apiKey: process.env.DEEPSEEK_API_KEY });
const rl = createInterface({ input: process.stdin, output: process.stdout });

// 选一个人设，它决定了说话风格和能查到的梗
const persona = await client.usePersona("毒舌老哥");
// 人设只管性格，查梗和发表情的步骤由 guide 告诉模型
const messages = [{ role: "system", content: `${persona.prompt}\n\n${await client.tools.guide()}` }];

for (let question = await rl.question("你 "); question; question = await rl.question("你 ")) {
  messages.push({ role: "user", content: question });

  // 模型要用工具就执行，然后把结果交还给它，直到它不再需要工具
  let reply;
  for (;;) {
    const completion = await llm.chat.completions.create({ model: "deepseek-chat", messages, tools: client.tools.openai() });
    reply = completion.choices[0].message;
    messages.push(reply);
    const results = await client.tools.run(reply);
    if (!results.length) break;
    messages.push(...results);
  }

  console.log(persona.title, reply.content);
}
rl.close();
