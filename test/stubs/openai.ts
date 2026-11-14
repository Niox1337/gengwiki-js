/** Stands in for the openai package in the example tests. Each client answers with one tool call, then with text. */

const ARGS = '{"q": "躺平"}';

export default class OpenAI {
  private chats = [
    { choices: [{ message: { content: null, tool_calls: [{ id: "1", function: { name: "search_memes", arguments: ARGS } }] } }] },
    { choices: [{ message: { content: "回答", tool_calls: null } }] },
  ];
  private replies = [
    { output: [{ type: "function_call", call_id: "1", name: "search_memes", arguments: ARGS }] },
    { output: [{ type: "message" }], output_text: "回答" },
  ];

  constructor(_options?: unknown) {}

  chat = { completions: { create: async (_body: unknown) => this.chats.shift() } };
  responses = { create: async (_body: unknown) => this.replies.shift() };
}
