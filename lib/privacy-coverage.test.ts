import { describe, expect, it } from 'vitest';
import { findPrivacyGaps } from './privacy-coverage';

describe('privacy mode conceals every figure on the surface', () => {
  it('leaves no currency value unmarked', () => {
    // Privacy mode is a CSS blur, so it only reaches elements that carry a
    // marker. A figure rendered without one stays perfectly legible with the
    // eye closed, and neither the type checker nor a unit test on the engine
    // would notice. This is the check that does.
    const gaps = findPrivacyGaps();
    expect(
      gaps.map((gap) => `${gap.file}:${gap.line}  ${gap.text}`),
    ).toEqual([]);
  });
});
