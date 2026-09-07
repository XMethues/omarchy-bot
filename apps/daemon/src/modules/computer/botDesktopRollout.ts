/** Distinguishes Bot Desktop Runtime rollout stages. Cage production code is removed. */
export const BOT_DESKTOP_ROLLOUT = Object.freeze({
  architectureSelection: true,
  conformancePass: true,
  productionCutover: true,
  cageRemoval: true,
  h264VideoTrackRemoval: true,
  webRtcRemoval: true,
  humanAcceptance: "pending",
});
