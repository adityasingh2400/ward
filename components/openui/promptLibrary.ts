/**
 * Server-safe OpenUI library: identical contracts to the client library but
 * with null renderers — used exclusively for library.prompt() in API routes
 * and for parser validation in tests.
 */
import { defineComponent, createLibrary } from "@openuidev/react-lang";
import { z } from "zod/v4";
import { DEFS, DASHBOARD_DEF, DefName } from "./defs";

const leaves = (Object.keys(DEFS) as DefName[]).map((name) =>
  defineComponent({
    name,
    description: DEFS[name].description,
    props: DEFS[name].props,
    component: () => null,
  })
);

const Dashboard = defineComponent({
  name: "Dashboard",
  description: DASHBOARD_DEF.description,
  props: z.object({
    ...DASHBOARD_DEF.baseProps,
    items: z.array(z.union(leaves.map((l) => l.ref) as [z.ZodType, ...z.ZodType[]])).describe("dashboard widgets, ordered by importance"),
  }),
  component: () => null,
});

export const promptLibrary = createLibrary({ components: [Dashboard, ...leaves], root: "Dashboard" });
