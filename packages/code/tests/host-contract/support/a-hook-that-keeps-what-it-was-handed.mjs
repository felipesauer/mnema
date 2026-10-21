// A command hook that keeps the payload the host handed it, byte for byte, in the file it is told,
// and says nothing: what a case reads to know the shape a host gives an event.
//
// usage: node a-hook-that-keeps-what-it-was-handed.mjs <file>
import { readFileSync, writeFileSync } from 'node:fs';

writeFileSync(process.argv[2], readFileSync(0));
