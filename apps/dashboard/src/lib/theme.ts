import { createServerFn } from "@tanstack/react-start";
import { getCookie, setCookie } from "@tanstack/react-start/server";
import * as z from "zod";

const postThemeValidator = z.union([z.literal("light"), z.literal("dark")]);
export type T = z.infer<typeof postThemeValidator>;
const storageKey = "_preferred-theme";

export const getThemeServerFn = createServerFn().handler(() =>
  postThemeValidator.catch("light").parse(getCookie(storageKey)),
);

export const setThemeServerFn = createServerFn({ method: "POST" })
  .validator(postThemeValidator)
  .handler(({ data }) => {
    setCookie(storageKey, data);
  });
