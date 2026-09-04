# 01: Stream Response Blocks as Markdown

**What to build:** Make one Agent Response travel end to end as an ordered, incrementally persisted Response Block and render user and Bot content as safe Astryx Markdown while the Bot is working and after refresh.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] The common Agent contract represents Response start, delta, and end events with one stable Adapter-generated block ID.
- [x] Pi and the fake Agent preserve native text block boundaries and event order instead of buffering a whole Turn into one final Bot message.
- [x] A Response Block is created at start, updated by deltas, completed at end, and returned through the ordinary Thread API.
- [x] Failure, cancellation, worker loss, daemon recovery, or another abnormal terminal path removes any incomplete Response Block.
- [x] User text and live or completed Bot Responses render through Astryx Markdown inside filled message bubbles.
- [x] Adjacent Response Blocks remain separately persisted but may read as one visual response without crossing another content kind.
- [x] Raw HTML cannot inject markup; safe links open outside the workspace with `noopener noreferrer`.
- [x] HTTP(S) Markdown images load directly with no Referer, including public, private, loopback, and link-local destinations; dangerous non-HTTP schemes are rejected.
- [x] Focused conformance, daemon/API, and browser coverage proves streaming, persistence, refresh, abnormal cleanup, Markdown structures, links, images, and unchanged attachments.
- [x] The legacy Bot-text path remains temporarily available only as the expand side of the later contract ticket, keeping the workspace green.

## Answer

The end-to-end slice is implemented: ordered Response Blocks stream, persist, survive refresh, clean up when interrupted, and render safe Markdown with stable visual boundaries.
