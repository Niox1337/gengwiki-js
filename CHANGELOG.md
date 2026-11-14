# 更新日志

## 0.1.0

第一个版本，功能和 Python 版 gengwiki 0.11.1 一致。

- 读取先查本机缓存，查不到或过期了才发请求，连不上时返回旧数据。缓存文件和 Key 文件与 Python 版通用。
- 同时提供 ESM 和 CommonJS，自带类型声明，支持 Node.js 20 及以上。
- 方法用驼峰命名并返回 Promise，数据字段和 API 一样用下划线命名。Python 版的关键字参数改成最后一个选项对象。
- 命令行 `npx gengwiki`，可以保存 Key、登录、切换人设、订阅标签和下载离线内容。
- 装上可选依赖 `@napi-rs/keyring` 后，Key 存进系统钥匙串。
- `client.tools` 提供 OpenAI Chat Completions、Responses API 和 Claude 的工具定义，`run()` 执行模型的工具调用。
