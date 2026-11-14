// 搜索表情包并下载图片。

import { GengWiki } from "gengwiki";

const client = new GengWiki();

// 按配文、表情包名称或标签搜索
for (const sticker of await client.searchStickers("震惊", 3)) {
  console.log(sticker.caption, sticker.pack_title, sticker.url);

  // 下载到本地并返回路径，第二次不再下载
  console.log(await client.stickerImage(sticker.id));
}

// 列出这个 Key 能用的表情包
for (const pack of await client.stickerPacks()) {
  console.log(pack.title, pack.stickers.length);
}
