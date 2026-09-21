import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Prisma's defaults (5s to finish, 2s to get a connection) assume a database on the same machine.
 * Production is a pooled, serverless Postgres that scales to zero, so the first query after an idle
 * period pays a wake-up and every interactive transaction crosses a connection pooler. Under those
 * defaults the seed's bot writes and the sign-in transaction both die with "transaction already
 * closed", which reads as a broken app rather than a slow one.
 *
 * These bounds are not a licence to do more work inside a transaction: the Vercel function timeout
 * still cuts a request off first. They exist so a cold database is slow once instead of failing.
 */
const TRANSACTION_TIMEOUT_MS = 20_000;
const TRANSACTION_MAX_WAIT_MS = 10_000;

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    transactionOptions: { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
