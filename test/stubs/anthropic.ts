/** Stands in for the @anthropic-ai/sdk package in the example tests. Each client answers with one tool call, then with text. */

export default class Anthropic {
  private replies = [
    { content: [{ type: "tool_use", id: "1", name: "search_memes", input: { q: "躺平" } }] },
    { content: [{ type: "text", text: "回答" }] },
  ];

  constructor(_options?: unknown) {}

  messages = { create: async (_body: unknown) => this.replies.shift() };
}
