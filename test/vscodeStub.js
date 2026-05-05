// Minimal stub for the `vscode` module so claudeData.ts -> logger.ts can be
// loaded under plain Node. The logger only touches OutputChannel methods.
'use strict';

const channel = {
  appendLine: () => {},
  show: () => {},
  dispose: () => {},
};

module.exports = {
  window: {
    createOutputChannel: () => channel,
  },
};
