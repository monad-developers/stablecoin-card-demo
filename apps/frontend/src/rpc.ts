export function firstSettled<T>(promises: readonly PromiseLike<T>[]): Promise<Awaited<T>> {
  return new Promise((resolve, reject) => {
    let pending = promises.length;
    let firstError: unknown;
    let hasError = false;

    for (const promise of promises) {
      Promise.resolve(promise).then(resolve, (error: unknown) => {
        if (!hasError) {
          firstError = error;
          hasError = true;
        }
        pending -= 1;
        if (pending === 0) reject(firstError);
      });
    }
  });
}
