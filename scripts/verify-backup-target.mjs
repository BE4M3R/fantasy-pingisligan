import { assertBackupTarget } from "./environment.mjs";

try { assertBackupTarget(process.env); }
catch (error) { console.error(error.message); process.exitCode = 2; }
