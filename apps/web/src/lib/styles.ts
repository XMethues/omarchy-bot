import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({
  fillColumn: { flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingInline: 24,
    paddingBlock: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: "var(--color-border-secondary)",
    flexShrink: 0,
  },
  headerGrow: { flexGrow: 1, minWidth: 0 },
  headerTitle: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  composerWrap: {
    flexShrink: 0,
    paddingInline: 24,
    paddingBlock: 16,
    maxWidth: 860,
    width: "100%",
    marginInline: "auto",
    boxSizing: "border-box",
  },
  activityWrap: { paddingInline: 8 },
  approvalRow: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
    paddingInline: 8,
  },
});

export default styles;
