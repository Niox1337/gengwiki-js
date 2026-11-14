# gengwiki-js

梗Wiki 的 JavaScript 和 TypeScript SDK，支持 Node.js 20 及以上。自带类型声明，`import` 和 `require` 都能用。

```bash
npm install gengwiki
```

到[个人中心](https://gengwiki.com/me)创建 Key，然后保存到本机，之后的代码里就不用再写它了。

```bash
npx gengwiki keys add 老哥      # 粘贴时不显示，也不会留在命令历史里
npx gengwiki status            # 查看当前 Key、人设、内容和额度
```

```js
import { GengWiki } from "gengwiki";
// CommonJS 写成 const { GengWiki } = require("gengwiki");

const client = new GengWiki();             // 也可以传入 Key，或者设置环境变量 GENGWIKI_API_KEY

await client.searchMemes("躺平");
(await client.meme("tang-ping")).body;
(await client.persona()).asMessage();      // { role: "system", content: "..." }
```

所有读取都先查本机缓存，查不到或过期了才发请求，所以方法都返回 Promise。数据字段和 API 一样用下划线命名，比如 `meme.usage_scenario`。

没有 Key 也能用，只是只有梗Wiki 热门的 20 个梗和 10 个人物，没有人设和表情包。第一次调用 `client.turn()` 时返回的 `notice` 会提醒去哪里拿 Key，可以把它转给运行机器人的人。不想没有 Key 时也玩梗，传入 `guestMemes: false`，`turn()` 就不带梗，只保留这条提醒。

更多用法见 [examples/](https://github.com/Niox1337/gengwiki-js/tree/main/examples)。

## 切换人设

一个 Key 终身绑定一个人设，所以切换人设就是切换到绑定了它的 Key。没有这样的 Key 时，登录后会自动创建一个并保存。

```js
const persona = await client.usePersona("温柔姐姐");   // 按标题或 id
const messages = [persona.asMessage(), { role: "user", content: "你好" }];
```

`client.personas("关键词")` 可以浏览人设目录。Claude 的系统提示不放在消息列表里，所以要写成 `system: persona.prompt`。

## 命令行

安装后可以用 `npx gengwiki`，全局安装后直接用 `gengwiki`。

```bash
gengwiki login                # 登录，密码不会保存
gengwiki status               # 当前站点、Key、人设、内容、缺的权限和额度
gengwiki search 躺平           # 也有 meme、trending、personas
gengwiki use 温柔姐姐           # 切换人设
gengwiki tags                 # 全部标签
gengwiki subscribe 游戏         # 订阅标签，也有 unsubscribe，不带标签时列出已订阅的
gengwiki sync --images        # 下载全部内容供离线使用
gengwiki keys                 # 也有 add、use、remove、secret、remote、rotate、revoke
```

代码里用 `await client.status()` 可以拿到同样的内容，包括人设名字，梗、表情、人物和语录的数量，Key 缺的权限，以及数据是不是旧的。Key 无效时会抛出 `AuthError`。

## 给大模型用的工具

```js
const tools = client.tools.openai();        // OpenAI 和 DeepSeek 等的 Chat Completions
// client.tools.responses()                 // OpenAI 的 Responses API
// client.tools.anthropic()                 // Claude

for (;;) {
  const reply = (await llm.chat.completions.create({ model, messages, tools })).choices[0].message;
  const results = await client.tools.run(reply);
  if (!results.length) break;
  messages.push(reply, ...results);
}
```

Claude 的回复用法相同，只是追加时写成 `{ role: "assistant", content: reply.content }`。Responses API 把 `response` 传给 `run`，追加时写成 `input.push(...response.output, ...results)`。

人设只需要写性格和说话方式。查梗和发表情的步骤放在 `client.tools.guide()` 里，它还列出了这个 Key 关联的人物和能用的全部表情说明，放在系统提示词里人设的后面就行。

```js
const system = `${(await client.persona()).prompt}\n\n${await client.tools.guide()}`;
```

模型默认用 Markdown 图片发表情。如果你的程序能自己发图片，传入自己的规则，比如 `client.tools.guide("发送时调用 send_sticker，传入这条说明。")`。

想让模型不等提问就玩梗，把 `await client.memePrompt(用户的话)` 放进提示词。它会优先带上这句话提到的梗，再随机补一些 Key 范围内的梗和热门梗，并告诉模型只在非常贴切时才用。`client.matchMemes(用户的话)` 返回这句话提到了哪些梗，可以用来决定机器人要不要插话。两个方法都不调用模型，缓存好之后也不发请求。

想让模型也用某个标签的热梗，就订阅这个标签。

```js
await client.tags();                 // 全部标签，每个带 name 和 count，用得最多的在前
await client.subscribe("游戏");       // 返回这个标签的前 5 名，标签不存在时抛出 NotFoundError
client.subscriptions();              // ["游戏"]
await client.unsubscribe("游戏");
```

订阅存在本机，所有 Key 共用，需要 `trending:read`。`client.turn()`、`client.memePrompt()` 和 `client.matchMemes()` 都会带上每个订阅标签的前 5 名，它们在随机选梗时有保留名额，已经绑定在 Key 上的梗不会重复出现。要按聊天分别订阅的话，自己保存标签，再传入 `{ tags: ["游戏"] }`，它会代替保存的订阅。

`client.searchMemes()` 只搜 Key 范围内的梗。`client.findMemes()` 还会搜订阅标签的前 5 名和热门榜，`search_memes` 工具和命令行的 `gengwiki search` 用的是它。Key 范围以外的梗只有释义和使用场景，完整解释和例句读不到。

共有 7 个工具，分别是 `search_memes`、`get_meme`、`trending_memes`、`search_stickers`、`search_people`、`get_person` 和 `search_lexicon`。可以用 `client.tools.openai(["search_memes"])` 只选其中几个。`client.tools.call(名字, 参数)` 自己执行一个工具，参数可以是对象或 JSON 字符串，出错时也返回 JSON，不会抛异常。

用户问“XX是什么梗”时，`client.turn()` 会带上查到的资料，模型不用再调用工具就能回答。不用 `turn()` 的话，`client.explain(用户的话)` 单独返回这段资料，不是这类问题时返回空字符串。

梗Wiki 查不到的词会到一个公开的备用词库里找同名的梗，`search_memes`、`get_meme` 工具、`client.turn()` 和 `client.explain()` 都会用上。不想把词发出去就传入 `backup: false`。只发送查不到的那个词，2 秒超时，出错时当作没查到。结果在本机缓存一天，查不到的缓存一小时。`client.backupMemes(词)` 可以直接查，不受这个开关影响，查到的梗没有 slug。

## 人物

```js
await client.person("鲁迅");        // 特定人物，按 id、名字或别名，附带提到他的梗
await client.people("作家");        // 全部人物，可以搜索，不受 Key 范围限制
await client.linkedPeople();       // 这个 Key 关联的人物
```

Key 关联的人物会自动进入 `client.tools.guide()`，模型不用查就认识他们。人物有语录时，用 `quotes` 选择模型怎么对待语录，这会改变提示词里的指令，也决定工具结果带不带语录。

| `quotes` | 含义 |
|---|---|
| `off` | 不使用。提示词和工具结果都不带语录，并要求模型不要引用 |
| `cite` | 引用，这是默认值。贴切时照抄原话并说明是谁说的 |
| `use` | 直接使用。语境合适时整条回复只发一句语录原话，不加其他文字，用户问起出处时如实说 |
| `both` | 引用和使用。两种都可以，优先只发语录原话 |

```js
const client = new GengWiki({ quotes: "both" });
```

需要 Key 勾选了 `people:read`，旧 Key 没有这个权限，要新建一个。

## 添加自己的内容

```js
await client.addWord("电子榨菜", "吃饭时看的视频");
await client.addSticker(await readFile("doge.png"), "狗头");
await client.addPersona("毒舌猫", "你是一只说话很毒的猫……");
await client.addPerson("老王", "隔壁宿舍的室友", ["今天不学了"]);

await client.removeWord("电子榨菜");   // 返回删掉了几个，没找到时是 0
```

这些内容只有自己的 Key 能用，不公开，也不用审核。词进入你的个人词库，用户的话里出现它时 `client.turn()` 会把解释带给模型。表情放进私有表情包，人物关联到当前 Key，马上就能用。Key 的人设创建后不能改，新的人设要在[我的组合](https://gengwiki.com/me)新建一个组合选它。

表情最大 1MB，边长不超过 500。同名的词、人设和人物会更新，不会重复添加。需要 Key 有 `self:write`，每个 Key 都有。

## 频率

三个 0 到 1 的参数决定多少比例的回复可以主动玩梗、用语录和发表情。每条回复由代码掷一次，掷中了才把素材给模型，模型再按语境决定用不用、用哪个，所以实际比例不会超过这个数。

掷中后模型会尽量用上一个梗，认真求助或倾诉时除外。掷中的回复大约一半会用上梗，所以 `memeFrequency: 0.2` 大约对应一成的回复。比例因模型和人设而异，也可能有硬凑的情况，觉得太多就调低。

```js
const client = new GengWiki({ memeFrequency: 0.3, quoteFrequency: 0.2, stickerFrequency: 0.5 });

const system = await client.tools.guide();   // 放进系统提示词，不随回复变化
const turn = await client.turn(question);    // 每条回复调用一次，不调用模型
const messages = [
  { role: "system", content: system },
  { role: "user", content: `${question}\n\n${turn.prompt}` },
];
```

| 参数 | 默认值 | 说明 |
|---|---|---|
| `memeFrequency` | 0.2 | 掷中时 `turn.prompt` 带上一批梗，并要求模型尽量用上一个。模型被问到时仍然可以查梗 |
| `quoteFrequency` | 1 | 掷中时带上语录。`use` 和 `both` 掷中后这条回复可以只发语录原话，和梗同时掷中时二选一。Key 没有关联带语录的人物，或者 `quotes: "off"` 时无效 |
| `stickerFrequency` | 1 | 掷中时带上表情说明 |

- 没掷中时不带素材，`turn.prompt` 里会写明这条回复不要主动用。`turn.memes`、`turn.quotes` 和 `turn.stickers` 是这次掷的结果，可以用来拿掉工具，比如没掷中时不给模型 `search_stickers`。
- 用户的话里提到“表情”“斗图”“来张图”“发张图”时算表情掷中，提到“语录”“名言”“金句”时算语录掷中，只有频率为 0 时例外。
- 频率为 0 时不带素材，`search_stickers` 工具也不再返回结果。直接调用 `client.searchStickers()` 不受频率影响。
- 频率为 1 时，表情说明和语录留在 `guide()` 里，方便模型服务的提示词缓存。频率在 0 和 1 之间时，它们只在掷中的回复里出现，所以只调用 `guide()` 不调用 `turn()` 的话，模型拿不到它们。
- `turn(用户的话, { memes: true })` 强制掷中梗，适合已经决定要插话的机器人，模型仍然会判断贴不贴切。

`client.memePrompt()` 不掷骰子，措辞也更谨慎，模型只在非常贴切时才用。想按频率来就用 `client.turn()`。

## 缓存和离线

缓存存在 `~/.gengwiki/<站点>/cache.sqlite3`，用的是 Node.js 自带的 `node:sqlite`。当前 Node.js 没有它时只缓存在内存里。

```js
await client.sync({ images: true });   // 下载这个 Key 能看到的全部内容，第二次运行不再发请求
client.refresh();                      // 让下一次读取走网络，旧数据留作备用
client.stale;                          // true 表示暂时连不上，读到的是旧数据
client.requestCount;                   // 这个客户端实际发出的请求数
client.close();                        // 用完后关闭缓存
```

连不上梗Wiki 时会返回旧数据，并暂停发请求一分钟，或者等完服务器给的 Retry-After。

## Key 存在哪里

Key 和登录令牌默认存在 `~/.gengwiki/<站点>/keys.json`，是只有当前用户能读的明文文件，和 `~/.aws/credentials` 一样。想放进系统钥匙串（Windows 凭据管理器、macOS 钥匙串、Linux Secret Service），就装上下面这个可选依赖。

```bash
npm install @napi-rs/keyring
```

装好后，下一次保存时密钥就会移进钥匙串，文件里只留一个引用。没有钥匙串的环境（比如 Docker 容器）会继续用文件并记一条警告。之后卸载这个依赖时，文件里的引用读不出来，会明确报错，不会丢数据。

## 开发

```bash
npm install
npm run typecheck
npm test
npm run build
```

测试在本机起一个假的梗Wiki 服务，不连真实服务，`examples/` 里的每个例子也会跑一遍。
