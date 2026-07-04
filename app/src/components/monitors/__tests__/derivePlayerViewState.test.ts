/**
 * Truth-table coverage for derivePlayerViewState.
 *
 * The live player used to infer its render layers from a tangle of overlapping
 * booleans (showMjpeg, showConnectingBadge, showNoVideo). Those are now a single
 * named PlayerViewState. This table pins the mapping for every combination of the
 * three inputs so a future edit to the derivation is caught here rather than as a
 * black-screen regression on a device the CI can't exercise.
 */

import { describe, it, expect } from 'vitest';
import { derivePlayerViewState, type PlayerViewState } from '../LiveMonitorPlayer';

type Row = {
  isWebRTC: boolean;
  hasVideoFrames: boolean;
  hasMjpegFrame: boolean;
  expected: PlayerViewState;
};

// All 2^3 input combinations.
const table: Row[] = [
  { isWebRTC: true, hasVideoFrames: true, hasMjpegFrame: true, expected: 'mse-playing' },
  { isWebRTC: true, hasVideoFrames: true, hasMjpegFrame: false, expected: 'mse-playing' },
  { isWebRTC: true, hasVideoFrames: false, hasMjpegFrame: true, expected: 'mjpeg-placeholder' },
  { isWebRTC: true, hasVideoFrames: false, hasMjpegFrame: false, expected: 'connecting' },
  { isWebRTC: false, hasVideoFrames: true, hasMjpegFrame: true, expected: 'mjpeg' },
  { isWebRTC: false, hasVideoFrames: true, hasMjpegFrame: false, expected: 'no-video' },
  { isWebRTC: false, hasVideoFrames: false, hasMjpegFrame: true, expected: 'mjpeg' },
  { isWebRTC: false, hasVideoFrames: false, hasMjpegFrame: false, expected: 'no-video' },
];

describe('derivePlayerViewState', () => {
  for (const { isWebRTC, hasVideoFrames, hasMjpegFrame, expected } of table) {
    it(`isWebRTC=${isWebRTC} hasVideoFrames=${hasVideoFrames} hasMjpegFrame=${hasMjpegFrame} -> ${expected}`, () => {
      expect(derivePlayerViewState({ isWebRTC, hasVideoFrames, hasMjpegFrame })).toBe(expected);
    });
  }

  it('WebRTC decoded frames win regardless of MJPEG placeholder', () => {
    expect(derivePlayerViewState({ isWebRTC: true, hasVideoFrames: true, hasMjpegFrame: true })).toBe('mse-playing');
  });

  it('MJPEG frame availability is what separates mjpeg from no-video', () => {
    expect(derivePlayerViewState({ isWebRTC: false, hasVideoFrames: false, hasMjpegFrame: true })).toBe('mjpeg');
    expect(derivePlayerViewState({ isWebRTC: false, hasVideoFrames: false, hasMjpegFrame: false })).toBe('no-video');
  });
});
