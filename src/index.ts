#!/usr/bin/env node
import { installGlobalErrorHandlers, reportUncaught } from './cli/error-handler.js';
import { createCli } from './cli/index.js';

// Catch anything that escapes a command and report it with a defined exit
// code instead of Node's raw unhandled-rejection stack. `parse` dispatches
// async command actions, so a domain/runtime throw surfaces as an
// unhandledRejection — covered by installGlobalErrorHandlers; a synchronous
// throw during setup is caught below. Commander's own exits
// (--help/--version/bad args) are handled inside the command tree and never
// reach here.
installGlobalErrorHandlers();

try {
  createCli().parse(process.argv);
} catch (error) {
  process.exit(reportUncaught(error));
}
