import * as stylex from "@stylexjs/stylex";

const workingPulse = stylex.keyframes({
  "0%, 100%": { opacity: 0.62 },
  "50%": { opacity: 1 },
});

const styles = stylex.create({
  fillColumn: {
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
  composerWrap: {
    width: "100%",
    maxWidth: 860,
    marginInline: "auto",
    boxSizing: "border-box",
  },
  composerDropZone: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-2)",
  },
  hiddenFileInput: {
    display: "none",
  },
  attachmentPreview: {
    width: "100%",
    overflow: "hidden",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--color-border)",
    borderRadius: "var(--radius-container)",
    backgroundColor: "var(--color-background-muted)",
  },
  attachmentThumbnail: {
    width: "var(--spacing-12)",
    minWidth: "var(--spacing-12)",
    overflow: "hidden",
    borderRadius: "var(--radius-element)",
    backgroundColor: "var(--color-background-muted)",
  },
  attachmentImage: {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  messageContent: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-2)",
    whiteSpace: "pre-wrap",
    minWidth: 0,
  },
  activityWrap: {
    paddingInline: "var(--spacing-2)",
  },
  workingIndicator: {
    color: "var(--color-text-secondary)",
    animationName: {
      default: workingPulse,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: "var(--duration-slow)",
    animationTimingFunction: "var(--ease-standard)",
    animationIterationCount: "infinite",
  },
});

export default styles;
