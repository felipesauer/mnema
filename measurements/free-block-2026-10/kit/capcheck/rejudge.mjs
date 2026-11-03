// Re-applies the criterion to a wire already recorded (no request, no cost).   node capcheck/rejudge.mjs <runDir> [needle]
import { readWireGz } from '../lib/run-common.mjs';
import { judge } from './criterion.mjs';

const [dir, needle = 'mnema'] = process.argv.slice(2);
console.log(JSON.stringify(judge(readWireGz(dir), { needle }), null, 2));
