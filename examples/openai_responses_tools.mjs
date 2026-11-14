// 让 OpenAI 的模型自己查梗，用 Responses 接口。需要 npm install openai。

import OpenAI from "openai";
import { GengWiki } from "gengwiki";

const client = new GengWiki();
const llm = new OpenAI();

const input = [{ role: "user", content: "躺平是什么意思？" }];

// 模型要用工具就执行，然后把结果交还给它，直到它不再需要工具
let response;
for (;;) {
  response = await llm.responses.create({ model: "gpt-5", input, tools: client.tools.responses() });
  const results = await client.tools.run(response);
  if (!results.length) break;
  input.push(...response.output, ...results);
}

console.log(response.output_text);
