#!/usr/bin/env node
import { createCli } from './cli/index.js';

createCli().parse(process.argv);
