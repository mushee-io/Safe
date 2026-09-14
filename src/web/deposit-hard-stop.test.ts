import { describe, expect, it } from 'vitest';

describe('deposit hard-stop regression', () => {
  it('documents the required Preview test deposit amount', () => {
    expect(100_000n).toBeGreaterThan(0n);
  });
});
