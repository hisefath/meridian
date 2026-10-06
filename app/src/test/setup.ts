import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom swaps in its own typed-array realm, but web3.js / buffer-layout build Node Buffers
// and check `instanceof Uint8Array`. Point the global back at Node's constructor.
globalThis.Uint8Array = Object.getPrototypeOf(Buffer.prototype).constructor;

afterEach(cleanup);
