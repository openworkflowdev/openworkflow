import { tsImport } from "tsx/esm/api";

// upstream ships ts, so we need tsx to load it from node_modules
const { default: antiSlop } = await tsImport(
  import.meta.resolve("oxlint-plugin-anti-slop"),
  import.meta.url,
);

export default antiSlop;
