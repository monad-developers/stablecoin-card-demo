import { expect, test } from "bun:test";

import { firstSettled } from "./rpc";

test("firstSettled resolves with the first resolved value", async () => {
  const first = Promise.withResolvers<string>();
  const second = Promise.withResolvers<string>();
  const result = firstSettled([first.promise, second.promise]);

  second.resolve("second");
  first.resolve("first");

  await expect(result).resolves.toBe("second");
});

test("firstSettled resolves when an earlier promise rejects", async () => {
  const first = Promise.withResolvers<string>();
  const second = Promise.withResolvers<string>();
  const error = new Error("provider failed");
  const result = firstSettled([first.promise, second.promise]);

  second.reject(error);
  first.resolve("first");

  await expect(result).resolves.toBe("first");
});

test("firstSettled rejects with the first error when every promise rejects", async () => {
  const first = Promise.withResolvers<string>();
  const second = Promise.withResolvers<string>();
  const firstError = new Error("first provider failed");
  const secondError = new Error("second provider failed");
  const result = firstSettled([first.promise, second.promise]);

  second.reject(firstError);
  first.reject(secondError);

  await expect(result).rejects.toBe(firstError);
});
