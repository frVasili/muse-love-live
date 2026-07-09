import {injectable} from 'inversify';
import {prisma} from '../utils/db.js';
import debug from '../utils/debug.js';

type Seconds = number;

type Options = {
  expiresIn: Seconds;
  key?: string;
};

const futureTimeToDate = (time: Seconds) => new Date(new Date().getTime() + (time * 1000));

@injectable()
export default class KeyValueCacheProvider {
  async get<T>(key: string): Promise<T | null> {
    const cachedResult = await prisma.keyValueCache.findUnique({
      where: {
        key,
      },
    });

    if (!cachedResult) {
      return null;
    }

    if (new Date() >= cachedResult.expiresAt) {
      await prisma.keyValueCache.delete({
        where: {
          key,
        },
      });
      return null;
    }

    return JSON.parse(cachedResult.value) as T;
  }

  async set<T>(key: string, value: T, expiresIn: Seconds): Promise<void> {
    const expiresAt = futureTimeToDate(expiresIn);
    await prisma.keyValueCache.upsert({
      where: {
        key,
      },
      update: {
        value: JSON.stringify(value),
        expiresAt,
      },
      create: {
        key,
        value: JSON.stringify(value),
        expiresAt,
      },
    });
  }

  async delete(key: string): Promise<void> {
    await prisma.keyValueCache.deleteMany({
      where: {
        key,
      },
    });
  }

  async wrap<T extends [...any[], Options], F>(func: (...options: any) => Promise<F>, ...options: T): Promise<F> {
    if (options.length === 0) {
      throw new Error('Missing cache options');
    }

    const functionArgs = options.slice(0, options.length - 1);

    const {
      key = JSON.stringify(functionArgs),
      expiresIn,
    } = options[options.length - 1] as Options;

    if (key.length < 4) {
      throw new Error(`Cache key ${key} is too short.`);
    }

    const cachedResult = await prisma.keyValueCache.findUnique({
      where: {
        key,
      },
    });

    if (cachedResult) {
      if (new Date() < cachedResult.expiresAt) {
        debug(`Cache hit: ${key}`);
        return JSON.parse(cachedResult.value) as F;
      }

      await prisma.keyValueCache.delete({
        where: {
          key,
        },
      });
    }

    debug(`Cache miss: ${key}`);

    const result = await func(...options as any[]);

    // Save result
    const value = JSON.stringify(result);
    const expiresAt = futureTimeToDate(expiresIn);
    await prisma.keyValueCache.upsert({
      where: {
        key,
      },
      update: {
        value,
        expiresAt,
      },
      create: {
        key,
        value,
        expiresAt,
      },
    });

    return result;
  }
}
