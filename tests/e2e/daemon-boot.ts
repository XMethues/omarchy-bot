/**
 * Bun-side E2E entrypoint. The parent setup provides isolated storage and the
 * fake workers, while this process runs the real daemon main().
 */
import { main } from "../../apps/daemon/src/bootstrap/main.ts";

const { port } = await main();
console.log(`E2E_DAEMON_READY ${port}`);
