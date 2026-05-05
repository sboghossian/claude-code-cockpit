// Registers a require-cache override so any `require('vscode')` resolves to
// our stub. Used by `npm test` via `node --require ./test/register.js`.
'use strict';

const Module = require('node:module');
const path = require('node:path');

const stubPath = path.resolve(__dirname, 'vscodeStub.js');
const originalResolve = Module._resolveFilename;

Module._resolveFilename = function patched(request, parent, ...rest) {
  if (request === 'vscode') {
    return stubPath;
  }
  return originalResolve.call(this, request, parent, ...rest);
};
