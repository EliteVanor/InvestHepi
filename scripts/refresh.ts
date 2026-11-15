/** Run the pipeline locally: `npm run refresh` (all sections) or `npm run refresh -- world`. */
import { refreshAll } from "../src/lib/pipeline";
import type { SectionId } from "../src/lib/types";

const arg = process.argv[2] as SectionId | undefined;
refreshAll(arg ? [arg] : undefined).then((r) => {
  console.log(JSON.stringify(r, null, 2));
});
