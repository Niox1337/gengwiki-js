// 用代码决定多少比例的回复可以玩梗、用语录和发表情，模型再按语境决定用不用、用哪个。

import { GengWiki } from "gengwiki";

const client = new GengWiki({ memeFrequency: 0.3, quoteFrequency: 0.2, stickerFrequency: 0.5 });

// guide 不随回复变化，放进系统提示词
const system = await client.tools.guide();

// 每条回复掷一次，prompt 放在用户的话后面
const question = "今天又要加班";
const turn = await client.turn(question);
const messages = [
  { role: "system", content: system },
  { role: "user", content: `${question}\n\n${turn.prompt}` },
];
console.log(turn.memes, turn.quotes, turn.stickers);

// 这条回复没掷中时，可以把发表情的工具也拿掉
const names = client.tools.openai().map((t) => t.function.name);
const tools = client.tools.openai(names.filter((n) => turn.stickers || n !== "search_stickers"));
console.log(messages, tools.length);
