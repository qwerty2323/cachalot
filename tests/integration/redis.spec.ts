import Redis, { Redis as RedisType } from "ioredis";
import RedisStorageAdapter from "../../src/adapters/RedisStorageAdapter";
import { runAdapterTests } from "./adapter-agnostic";

const redis: RedisType = new Redis();
const adapter = new RedisStorageAdapter(redis, { lockExpireTimeout: 50 });

describe("Redis adapter", () => {
  beforeEach(() => {
    redis.flushall();
  });
  afterAll(() => {
    redis.disconnect();
  });

  runAdapterTests(redis.get.bind(redis), redis.set.bind(redis), adapter);
});
