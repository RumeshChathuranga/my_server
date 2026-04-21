// Thread-safe blocking queue for WebSocket message serialization.
// Multiple producers can call pushBack(); a single consumer calls popFront().
// When close() is called, all waiting consumers receive null.

export type Queue<T> = {
  pushBack: (item: T) => Promise<void>;
  popFront: () => Promise<T | null>;
  close: () => void;
};

export function createQueue<T>(): Queue<T> {
  type Taker = (item: T | null) => void;
  type Giver = (take: Taker) => void;

  const producers: { give: Giver; reject: (e: Error) => void }[] = [];
  const consumers: Taker[] = [];
  let closed = false;

  return {
    pushBack: (item: T): Promise<void> => {
      if (closed) return Promise.reject(new Error("Queue is closed"));

      return new Promise<void>((done, reject) => {
        const give: Giver = (take) => { take(item); done(); };

        if (consumers.length > 0) {
          give(consumers.shift()!);
        } else {
          producers.push({ give, reject });
        }
      });
    },

    popFront: (): Promise<T | null> => {
      if (closed) return Promise.resolve(null);

      return new Promise<T | null>((take) => {
        if (producers.length > 0) {
          producers.shift()!.give(take as Taker);
        } else {
          consumers.push(take as Taker);
        }
      });
    },

    close: (): void => {
      closed = true;
      producers.forEach((p) => p.reject(new Error("Queue closed")));
      consumers.forEach((c) => c(null));
      producers.length = 0;
      consumers.length = 0;
    },
  };
}