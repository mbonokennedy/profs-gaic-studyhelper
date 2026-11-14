const readline = require("node:readline/promises");
const { stdin: input, stdout: output } = require("node:process");

const rl = readline.createInterface({ input, output });
const messages = [];
const model = "qwen3-600m-inst-q4";

async function main() {
  console.log("QVAC Chat. Type exit to quit.\n");

  while (true) {
    const prompt = (await rl.question("You: ")).trim();

    if (prompt.toLowerCase() === "exit") break;
    if (!prompt) continue;

    messages.push({ role: "user", content: prompt });

    try {
      const response = await fetch(
        "http://127.0.0.1:11434/v1/chat/completions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            stream: false,
            max_tokens: 512
          })
        }
      );

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${await response.text()}`
        );
      }

      const data = await response.json();
      const reply = data.choices?.[0]?.message?.content;

      if (typeof reply !== "string") {
        throw new Error(`Unexpected response: ${JSON.stringify(data)}`);
      }

      messages.push({ role: "assistant", content: reply });
      console.log(`\nAI: ${reply}\n`);
    } catch (error) {
      messages.pop();
      console.error(`\nRequest failed: ${error.message}\n`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
