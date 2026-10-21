#!/usr/bin/env node
// Lance la CLI TypeScript via tsx, sans étape de compilation.
import { register } from 'tsx/esm/api';
register();
await import('../src/cli.ts');
