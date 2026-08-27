import { type Db, type DbOrTx, type Payment, payments, users } from "@habit-tracker/db";
import { desc, eq } from "drizzle-orm";

export class BillingRepository {
  constructor(private readonly db: Db) {}

  async createPayment(data: {
    userId: string;
    amount: number;
    currency: string;
  }): Promise<Payment> {
    const [row] = await this.db.insert(payments).values(data).returning();
    if (!row) throw new Error("insert returned no row");
    return row;
  }

  async updatePayment(
    id: string,
    patch: Partial<Pick<Payment, "status" | "stripePaymentIntentId">>,
    tx: DbOrTx = this.db
  ): Promise<Payment | null> {
    const [row] = await tx.update(payments).set(patch).where(eq(payments.id, id)).returning();
    return row ?? null;
  }

  findPayment(id: string, tx: DbOrTx = this.db): Promise<Payment | null> {
    return tx.query.payments.findFirst({ where: eq(payments.id, id) }).then((r) => r ?? null);
  }

  findByPaymentIntent(piId: string, tx: DbOrTx = this.db): Promise<Payment | null> {
    return tx.query.payments
      .findFirst({ where: eq(payments.stripePaymentIntentId, piId) })
      .then((r) => r ?? null);
  }

  listForUser(userId: string): Promise<Payment[]> {
    return this.db
      .select()
      .from(payments)
      .where(eq(payments.userId, userId))
      .orderBy(desc(payments.createdAt))
      .limit(50);
  }

  async setPlan(userId: string, plan: "free" | "pro", tx: DbOrTx = this.db): Promise<void> {
    await tx.update(users).set({ plan }).where(eq(users.id, userId));
  }
}
