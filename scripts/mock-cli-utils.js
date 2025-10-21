const readline = require("readline");
const clipboardModule = require("clipboardy");
const clipboardy = clipboardModule?.default ?? clipboardModule;

function createInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

function closeInterface(rl) {
  rl.close();
}

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

function previewSnippet(text, maxLength = 240) {
  if (typeof text !== "string" || text.length === 0) {
    return "(empty)";
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

async function copyPromptToClipboard(prompt, { label = "Prompt", previewLength = 240 } = {}) {
  await clipboardy.write(prompt);
  console.log(`\n${label} copied to your clipboard.`);
  console.log("Preview:");
  console.log(previewSnippet(prompt, previewLength));
}

function logNextSteps(steps = []) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return;
  }
  console.log("\nNext steps:");
  steps.forEach((step, index) => {
    console.log(`  ${index + 1}. ${step}`);
  });
  console.log("");
}

async function deliverPrompt(rl, prompt, {
  label = "Prompt",
  previewLength = 240,
  steps = [],
  waitMessage = null
} = {}) {
  await copyPromptToClipboard(prompt, { label, previewLength });
  logNextSteps(steps);
  if (waitMessage) {
    await ask(rl, waitMessage);
  }
}

async function collectMultilineInput(rl, {
  promptLabel = "input",
  endKeyword = "END",
  allowSkip = true
} = {}) {
  console.log(`\nPaste the ${promptLabel} now. Press ENTER on an empty line when you're done.`);
  if (endKeyword) {
    console.log(`Type ${endKeyword} on its own line to finish early.`);
  }
  if (allowSkip) {
    console.log("Press ENTER immediately to skip.\n");
  } else {
    console.log("");
  }

  const lines = [];
  while (true) {
    const line = await ask(rl, "> ");
    const trimmed = line.trim();
    if (lines.length === 0 && trimmed.length === 0) {
      if (!allowSkip) {
        continue;
      }
      return "";
    }
    if (trimmed.toUpperCase() === endKeyword.toUpperCase()) {
      break;
    }
    if (trimmed.length === 0) {
      break;
    }
    lines.push(line);
  }

  return lines.join("\n").trim();
}

async function collectJsonInput(rl, { promptLabel = "cleaned JSON", endKeyword = "END" } = {}) {
  return collectMultilineInput(rl, {
    promptLabel,
    endKeyword,
    allowSkip: true
  });
}

module.exports = {
  createInterface,
  closeInterface,
  ask,
  previewSnippet,
  copyPromptToClipboard,
  deliverPrompt,
  collectMultilineInput,
  collectJsonInput
};
