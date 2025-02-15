import { ExpireOptions, WriteOptions, Storage, ReadWriteOptions } from "../storage/Storage";
import { LockedKeyRetrieveStrategy, LockedKeyRetrieveStrategyTypes } from "../LockedKeyRetrieveStrategy";
import { Logger } from "../Logger";
import { WaitForResultLockedKeyRetrieveStrategy } from "../locked-key-retrieve-strategies/WaitForResultLockedKeyRetrieveStrategy";
import { RunExecutorLockedKeyRetrieveStrategy } from "../locked-key-retrieve-strategies/RunExecutorLockedKeyRetrieveStrategy";
import { Executor, ExecutorContext, runExecutor } from "../Executor";
import { Record } from "../storage/Record";

export interface ManagerOptions extends ExpireOptions {
  prefix?: string;
  hashKeys?: boolean;
  logger: Logger;
  storage: Storage;
  refreshAheadFactor?: number;
  lockedKeyRetrieveStrategies?: [string, LockedKeyRetrieveStrategy][];
}

export abstract class BaseManager {
  protected constructor(options: ManagerOptions) {
    this.logger = options.logger;
    this.storage = options.storage;
    this.lockedKeyRetrieveStrategies = new Map([
      [
        LockedKeyRetrieveStrategyTypes.waitForResult,
        new WaitForResultLockedKeyRetrieveStrategy({
          keyLockCheckFn: this.storage.keyIsLocked.bind(this),
          getRecord: this.storage.get.bind(this),
          logger: this.logger,
        }),
      ],
      [LockedKeyRetrieveStrategyTypes.runExecutor, new RunExecutorLockedKeyRetrieveStrategy()],
    ]);

    if (Array.isArray(options.lockedKeyRetrieveStrategies)) {
      options.lockedKeyRetrieveStrategies.forEach(([name, strategy]) => {
        this.lockedKeyRetrieveStrategies.set(name, strategy);
      });
    }
  }

  protected storage: Storage;

  protected lockedKeyRetrieveStrategies: Map<string, LockedKeyRetrieveStrategy>;

  protected logger: Logger;

  public abstract get<R>(key: string, executor: Executor<R>, options: ReadWriteOptions<R>): Promise<R>;

  public abstract set<R>(key: string, value: R, options?: WriteOptions<R>): Promise<Record<R>>;

  public del(key: string): Promise<boolean> {
    return this.storage.del(key);
  }

  protected async updateCacheAndGetResult<R>(
    context: ExecutorContext<R>,
    options: ReadWriteOptions<R>
  ): Promise<R> {
    const lockedKeyRetrieveStrategy = this.getLockedKeyRetrieveStrategy(
      options.lockedKeyRetrieveStrategyType
    );
    let isKeySuccessfullyLocked = false;

    try {
      isKeySuccessfullyLocked = await this.storage.lockKey(context.key);
    } catch (keyLockError: unknown) {
      this.logger.error(
        `Error occurred while trying to lock key "${context.key}". Reason: ${
          (keyLockError as Error).message
        }. Running executor`
      );

      return runExecutor(context.executor);
    }

    if (!isKeySuccessfullyLocked) {
      return lockedKeyRetrieveStrategy.get(context);
    }

    try {
      this.logger.trace(`Running executor for key "${context.key}"`);
      const executorResult = await runExecutor(context.executor);

      await this.set(context.key, executorResult, options);

      return executorResult;
    } finally {
      await this.storage.releaseKey(context.key);
    }
  }

  protected getLockedKeyRetrieveStrategy(
    strategyName: string = LockedKeyRetrieveStrategyTypes.runExecutor
  ): LockedKeyRetrieveStrategy {
    const strategy = this.lockedKeyRetrieveStrategies.get(strategyName);

    if (!strategy) {
      throw new Error(`Cannot find "${strategyName}" locked key retrieve strategy`);
    }

    return strategy;
  }
}
