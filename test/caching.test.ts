import { faker } from '@faker-js/faker';
import promiseCoalesce from 'promise-coalesce';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { caching, Cache, MemoryConfig, memoryStore, createCache } from '../src';
import { sleep } from './utils';

// Allow the module to be mocked so we can assert
// the old and new behavior for issue #417
vi.mock('promise-coalesce', async () => {
  const actualModule =
    await vi.importActual<typeof promiseCoalesce>('promise-coalesce');

  return {
    ...actualModule,
    coalesceAsync: vi
      .fn()
      .mockImplementation((key: string, fn: () => Promise<unknown>) => {
        if (key.startsWith('mock_no_coalesce')) {
          return Promise.resolve(fn());
        }
        return actualModule.coalesceAsync(key, fn);
      }),
  };
});

describe('caching', () => {
  let cache: Cache;
  let key: string;
  let value: string;
  const defaultTtl = 100;

  describe('constructor', () => {
    it('should from store', async () => {
      const store = memoryStore();
      await expect(caching(store)).resolves.toBeDefined();
    });
  });

  describe('get() and set()', () => {
    beforeEach(async () => {
      cache = await caching('memory');
      key = faker.string.alpha(20);
      value = faker.string.sample();
    });

    it('lets us set and get data in cache', async () => {
      await cache.set(key, value, defaultTtl);
      await sleep(20);
      await expect(cache.get(key)).resolves.toEqual(value);
    });

    it('should error no isCacheable value', () =>
      expect(cache.set(key, undefined)).rejects.toStrictEqual(
        new Error('no cacheable value undefined'),
      ));
    it('should error no isCacheable value', () =>
      expect(cache.store.mset([[key, undefined]])).rejects.toStrictEqual(
        new Error('no cacheable value undefined'),
      ));

    it('lets us set and get data without a callback', async () => {
      cache = await caching(async (arg?: MemoryConfig) => memoryStore(arg));
      await cache.set(key, value, defaultTtl);
      await sleep(20);
      await expect(cache.get(key)).resolves.toEqual(value);
    });

    it('lets us set and get data without options object or callback', async () => {
      cache = await caching(async (arg?: MemoryConfig) => memoryStore(arg));
      await cache.set(key, value);
      await sleep(20);
      await expect(cache.get(key)).resolves.toEqual(value);
    });
  });

  describe('mget() and mset()', function () {
    let key2: string;
    let value2: string;
    const store = 'memory';

    beforeEach(async () => {
      key = faker.string.sample(20);
      value = faker.string.sample();
      key2 = faker.string.sample(20);
      value2 = faker.string.sample();

      cache = await caching(store, {
        ttl: defaultTtl,
      });
    });

    it('lets us set and get several keys and data in cache', async () => {
      await cache.store.mset(
        [
          [key, value],
          [key2, value2],
        ],
        defaultTtl,
      );
      await sleep(20);
      await expect(cache.store.mget(key, key2)).resolves.toStrictEqual([
        value,
        value2,
      ]);
    });

    it('lets us set and get data without options', async () => {
      await cache.store.mset(
        [
          [key, value],
          [key2, value2],
        ],
        defaultTtl,
      );
      await sleep(20);
      await expect(cache.store.mget(key, key2)).resolves.toStrictEqual([
        value,
        value2,
      ]);
    });
  });

  describe('del()', function () {
    beforeEach(async () => {
      cache = await caching('memory');
      key = faker.string.sample(20);
      value = faker.string.sample();
      await cache.set(key, value, defaultTtl);
    });

    it('deletes data from cache', async () => {
      await expect(cache.get(key)).resolves.toEqual(value);
      await cache.del(key);
      await expect(cache.get(key)).resolves.toBeUndefined();
    });

    describe('with multiple keys', function () {
      let key2: string;
      let value2: string;

      beforeEach(async () => {
        cache = await caching('memory');
        key2 = faker.string.sample(20);
        value2 = faker.string.sample();
        await cache.store.mset(
          [
            [key, value],
            [key2, value2],
          ],
          defaultTtl,
        );
      });

      it('deletes an an array of keys', async () => {
        await expect(cache.store.mget(key, key2)).resolves.toStrictEqual([
          value,
          value2,
        ]);
        await cache.store.mdel(key, key2);
        await expect(cache.store.mget(key, key2)).resolves.toStrictEqual([
          undefined,
          undefined,
        ]);
      });
    });
  });

  describe('reset()', () => {
    let key2: string;
    let value2: string;

    beforeEach(async () => {
      cache = await caching('memory');
      key = faker.string.sample(20);
      value = faker.string.sample();
      await cache.set(key, value);
      key2 = faker.string.sample(20);
      value2 = faker.string.sample();
      await cache.set(key2, value2);
    });

    it('clears the cache', async () => {
      await cache.reset();
      await expect(cache.get(key)).resolves.toBeUndefined();
      await expect(cache.get(key2)).resolves.toBeUndefined();
    });
  });

  describe('keys()', () => {
    let keyCount: number;
    let savedKeys: string[];

    beforeEach(async () => {
      keyCount = 10;
      cache = await caching('memory');

      savedKeys = (
        await Promise.all(
          Array.from({ length: keyCount }).map(async (_, i) => {
            const key = (i % 3 === 0 ? 'prefix' : '') + faker.string.sample(20);
            value = faker.string.sample();
            await cache.set(key, value);
            return key;
          }),
        )
      ).sort((a, b) => a.localeCompare(b));
    });

    it('calls back with all keys in cache', () =>
      expect(
        cache.store.keys().then((x) => x.sort((a, b) => a.localeCompare(b))),
      ).resolves.toStrictEqual(savedKeys));
  });

  describe('wrap()', () => {
    beforeEach(async () => {
      cache = await caching('memory');
      key = faker.string.sample(20);
      value = faker.string.sample();
    });

    it('lets us set the ttl to be milliseconds', async () => {
      const ttl = 2 * 1000;
      await cache.wrap(key, async () => value, ttl);
      await expect(cache.get(key)).resolves.toEqual(value);

      await sleep(ttl);

      await expect(cache.get(key)).resolves.toBeUndefined();
      await expect(cache.wrap(key, async () => 'foo')).resolves.toEqual('foo');
    });

    it('lets us set the ttl to be a function', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const sec = faker.number.int({ min: 2, max: 4 });
      value = faker.string.sample(sec * 2);
      const fn = vi.fn((v: string) => (v.length / 2) * 1000);
      await cache.wrap(key, async () => value, fn);
      await expect(cache.get(key)).resolves.toEqual(value);
      await expect(cache.wrap(key, async () => 'foo')).resolves.toEqual(value);

      expect(fn).toHaveBeenCalledTimes(1);
      await sleep(sec * 1000);
      await expect(cache.get(key)).resolves.toBeUndefined();
    });

    it('calls fn to fetch value on cache miss', async () => {
      const fn = vi.fn().mockResolvedValue(value);
      const ttl = 2 * 1000;

      // Confirm the cache is empty.
      await expect(cache.get(key)).resolves.toBeUndefined();

      // The first request will populate the cache.
      fn.mockClear(); // reset count
      await expect(cache.wrap(key, fn, ttl)).resolves.toBe(value);
      await expect(cache.get(key)).resolves.toBe(value);
      expect(fn).toHaveBeenCalledTimes(1);

      // The second request will return the cached value.
      fn.mockClear(); // reset count
      await expect(cache.wrap(key, fn, ttl)).resolves.toBe(value);
      await expect(cache.get(key)).resolves.toBe(value);
      expect(fn).toHaveBeenCalledTimes(0);
    });

    it('does not call fn to fetch value on cache hit', async () => {
      const fn = vi.fn().mockResolvedValue(value);
      const ttl = 2 * 1000;

      // Confirm the cache is contains the value.
      await cache.set(key, value, ttl);
      await expect(cache.get(key)).resolves.toBe(value);

      // Will find the cached value and not call the generator function.
      fn.mockClear(); // reset count
      await expect(cache.wrap(key, fn, ttl)).resolves.toBe(value);
      await expect(cache.get(key)).resolves.toBe(value);
      expect(fn).toHaveBeenCalledTimes(0);
    });

    it('calls fn once to fetch value on cache miss when invoked multiple times', async () => {
      const fn = vi.fn().mockResolvedValue(value);
      const ttl = 2 * 1000;

      // Confirm the cache is empty.
      await expect(cache.get(key)).resolves.toBeUndefined();

      // Simulate several concurrent requests for the same value.
      const results = await Promise.allSettled([
        cache.wrap(key, fn, ttl), // 1
        cache.wrap(key, fn, ttl), // 2
        cache.wrap(key, fn, ttl), // 3
        cache.wrap(key, fn, ttl), // 4
        cache.wrap(key, fn, ttl), // 5
        cache.wrap(key, fn, ttl), // 6
        cache.wrap(key, fn, ttl), // 7
        cache.wrap(key, fn, ttl), // 8
        cache.wrap(key, fn, ttl), // 9
        cache.wrap(key, fn, ttl), // 10
      ]);

      // Assert that the function was called exactly once.
      expect(fn).toHaveBeenCalledTimes(1);

      // Assert that all requests resolved to the same value.
      results.forEach((result) => {
        expect(result).toMatchObject({
          status: 'fulfilled',
          value,
        });
      });
    });
  });

  describe('issues', () => {
    beforeEach(async () => {
      cache = await caching('memory');
      key = faker.string.sample(20);
      value = faker.string.sample();
    });

    it('#183', async () => {
      await expect(cache.wrap('constructor', async () => 0)).resolves.toEqual(
        0,
      );
    });

    it('#417', async () => {
      // This test emulates the undesired behavior reported in issue 417.
      // See the wrap() tests for the resolution.
      key = 'mock_no_coalesce';
      const fn = vi.fn().mockResolvedValue(value);
      const ttl = 2 * 1000;

      // Confirm the cache is empty.
      await expect(cache.get(key)).resolves.toBeUndefined();

      // Simulate several concurrent requests for the same value.
      const results = await Promise.allSettled([
        cache.wrap(key, fn, ttl), // 1
        cache.wrap(key, fn, ttl), // 2
        cache.wrap(key, fn, ttl), // 3
        cache.wrap(key, fn, ttl), // 4
        cache.wrap(key, fn, ttl), // 5
        cache.wrap(key, fn, ttl), // 6
        cache.wrap(key, fn, ttl), // 7
        cache.wrap(key, fn, ttl), // 8
        cache.wrap(key, fn, ttl), // 9
        cache.wrap(key, fn, ttl), // 10
      ]);

      // Assert that the function was called multiple times (bad).
      expect(fn).toHaveBeenCalledTimes(10);

      // Assert that all requests resolved to the same value.
      results.forEach((result) => {
        expect(result).toMatchObject({
          status: 'fulfilled',
          value,
        });
      });
    });

    it('#533', async () => {
      await expect(
        (async () => {
          cache = await caching('memory', {
            ttl: 5 * 1000,
            refreshThreshold: 4 * 1000,
          });

          await cache.wrap('refreshThreshold', async () => 0);
          await new Promise((resolve) => {
            setTimeout(resolve, 2 * 1000);
          });
          await cache.wrap('refreshThreshold', async () => 1);
          await new Promise((resolve) => {
            setTimeout(resolve, 500);
          });
          await cache.wrap('refreshThreshold', async () => 2);
          await new Promise((resolve) => {
            setTimeout(resolve, 500);
          });
          return cache.wrap('refreshThreshold', async () => 3);
        })(),
      ).resolves.toEqual(1);
    });
  });
});

describe('createCache', () => {
  it('should create cache instance by store', async () => {
    const store = memoryStore();
    const cache1 = await caching(store);
    const cache2 = createCache(store);
    expect(cache1.store).toBe(cache2.store);
    Object.entries(cache1).forEach(([key, value]) => {
      expect(cache2[key as keyof Cache].toString()).toBe(value.toString());
    });
  });
});
