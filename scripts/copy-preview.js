import { copyFile, mkdir } from 'node:fs/promises';

// Publish the isolated, simulated design preview alongside the live connection test.
await mkdir('dist/mockups', { recursive: true });
await copyFile('mockups/iem.html', 'dist/mockups/iem.html');
