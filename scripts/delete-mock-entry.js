#!/usr/bin/env node

const readline = require("readline");
const {
  readLibrary,
  writeLibrary,
  deleteEntry,
  listEntries,
  promptForEntrySelection
} = require("./mock-library-utils");

function createInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer));
  });
}

async function main() {
  const rl = createInterface();

  try {
    const library = readLibrary();
    if (!library.entries.length) {
      console.log("\nNo mock entries found.");
      return;
    }

    console.log("\n=== Delete Mock Library Entry ===\n");
    const { entryId } = await promptForEntrySelection({
      ask: (question) => ask(rl, question),
      library,
      allowCreate: false,
      header: "Select the entry to delete"
    });

    if (!entryId) {
      console.log("\nNo entry selected. Aborting.");
      return;
    }

    console.log("\nYou are about to delete:");
    const entries = listEntries(library);
    const target = entries.find((entry) => entry.id === entryId);
    if (target) {
      console.log(`- ${target.title}`);
      if (target.sourcePdf?.path) {
        console.log(`  Source PDF: ${target.sourcePdf.path}`);
      }
    }

    const confirmation = await ask(rl, `\nType the entry ID (${entryId}) to confirm deletion: `);
    if (confirmation.trim() !== entryId) {
      console.log("\nConfirmation did not match. Nothing deleted.");
      return;
    }

    const removed = deleteEntry(library, entryId);
    if (!removed) {
      console.error("\nEntry not found. Nothing deleted.");
      return;
    }

    writeLibrary(path.basename(__filename), library);
    console.log(`\nDeleted entry: ${entryId}`);
  } catch (error) {
    console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}

const path = require("path");

main();
