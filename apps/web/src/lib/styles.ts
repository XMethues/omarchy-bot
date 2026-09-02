import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({
  fillColumn: { flexGrow: 1, minWidth: 0, minHeight: 0 },
  scrollArea: { flexGrow: 1, overflowY: "auto", minHeight: 0 },
  composer: { alignItems: "flex-end" },
  stretch: { alignItems: "stretch" },
  computerColumn: {
    width: 360,
    flexShrink: 0,
    overflowY: "auto",
    minHeight: 0,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: "var(--astryx-border-secondary, #ddd)",
  },
  messageStart: { paddingInlineEnd: 48 },
  messageEnd: { paddingInlineStart: 48 },
  snapshot: { display: "block", width: "100%", height: "auto" },
  recheck: {
    all: "unset",
    cursor: "pointer",
    display: "flex",
    gap: 4,
    alignItems: "center",
  },
});

export default styles;
