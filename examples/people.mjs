// 查询人物，并选择模型怎么对待他们的语录。

import { GengWiki } from "gengwiki";

// off 不使用、cite 引用、use 直接使用、both 引用和使用
const client = new GengWiki({ quotes: "both" });

for (const person of await client.linkedPeople()) {
  console.log(person.name, person.bio);
}

for (const person of await client.people("作家")) {
  console.log(person.name, person.quotes.slice(0, 1));
}

console.log((await client.person("鲁迅")).memes);

// Key 关联的人物和语录用法都在 guide 里，放在人设后面就行
console.log(await client.tools.guide());
