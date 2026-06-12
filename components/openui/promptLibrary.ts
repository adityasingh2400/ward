/**
 * Server-safe OpenUI library: identical contracts to the client library but
 * with null renderers — used exclusively for library.prompt() in API routes.
 */
import { defineComponent, createLibrary } from "@openuidev/react-lang";
import { DEFS, DefName } from "./defs";

const stubs = (Object.keys(DEFS) as DefName[]).map((name) =>
  defineComponent({
    name,
    description: DEFS[name].description,
    props: DEFS[name].props,
    component: () => null,
  })
);

export const promptLibrary = createLibrary({ components: stubs, root: "Dashboard" });
